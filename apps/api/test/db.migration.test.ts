// P0.3 migration/seed proof (runs against a real Postgres — Neon branch).
// Requires DATABASE_URL pointing at a database that has had `pnpm --filter api
// migrate` applied. Skips visibly when unset so unit CI stays green; the
// migration CI job / local Neon-branch run is where this executes.
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { seed } from "../src/db/seed.js";
import { ORG_PRIVILEGES } from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

d("0001_init on a real database", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 2 });

  it("created every Part 4 §2 table", async () => {
    const expected = [
      "users", "auth_identities", "refresh_tokens",
      "gyms", "gym_codes", "gym_members", "gym_staff",
      "plans", "subscriptions", "invoices", "webhook_events",
      "exercises", "exercise_definitions", "definition_bundles",
      "workouts", "workout_sets", "workout_templates",
      "meal_logs", "user_dishware", "meal_log_corrections", "body_measurements",
      "coach_threads", "coach_messages", "kb_chunks",
      "streaks", "achievements", "user_achievements", "challenges",
      "challenge_participants", "leaderboard_snapshots",
      "runs", "saved_routes", "run_schedules", "geo_cache",
      "usage_daily", "api_cost_events",
      "org_daily_stats", "gym_usage_reports",
      "push_tokens", "feature_flags", "audit_log", "trace_samples",
    ];
    const rows = await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
    const present = new Set(rows.map((r) => r["tablename"] as string));
    for (const t of expected) {
      expect(present.has(t), `missing table: ${t}`).toBe(true);
    }
    const views = await sql`SELECT viewname FROM pg_views WHERE schemaname = 'public'`;
    expect(views.map((v) => v["viewname"] as string)).toContain("org_member_stats");
  });

  it("0005 adds meal origin with a default and strict CHECK", async () => {
    const columns = await sql`
      SELECT column_default, is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name='meal_logs' AND column_name='origin'`;
    expect(columns[0]?.["column_default"]).toContain("manual");
    expect(columns[0]?.["is_nullable"]).toBe("NO");
    const owner = await sql<{ id: string }[]>`INSERT INTO users (display_name) VALUES ('p26a-origin-check') RETURNING id`;
    const ownerId = owner[0]?.id;
    if (ownerId === undefined) throw new Error("origin-check fixture insert failed");
    await expect(sql`INSERT INTO meal_logs
      (user_id,taken_at,items,kcal_point,kcal_low,kcal_high,portion_source,nutrition_sources,calc_version,origin)
      VALUES (${ownerId},now(),'[]',0,0,0,'default',ARRAY['curated'],1,'invalid')`).rejects.toMatchObject({ code: "23514" });
    await sql`DELETE FROM users WHERE id=${ownerId}`;
  });

  it("0006 adds user_fitness_profiles: 1:1 PK, ported CHECKs, cascade", async () => {
    // 1:1 with users — user_id IS the PK, no surrogate id.
    const pk = await sql`
      SELECT a.attname FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'user_fitness_profiles'::regclass AND i.indisprimary`;
    expect(pk.map((r) => r["attname"] as string)).toEqual(["user_id"]);

    const owner = await sql<{ id: string }[]>`
      INSERT INTO users (display_name) VALUES ('ofp-ddl-check') RETURNING id`;
    const ownerId = owner[0]?.id;
    if (ownerId === undefined) throw new Error("fitness-profile fixture insert failed");

    // Each CHECK holds the value set ported from the old Mongo model.
    for (const [col, bad] of [
      ["gender", "yes"],
      ["fitness_level", "expert"],
      ["preferred_workout_time", "midnight"],
    ] as const) {
      await expect(
        sql`INSERT INTO user_fitness_profiles (user_id, ${sql(col)}) VALUES (${ownerId}, ${bad})`,
      ).rejects.toMatchObject({ code: "23514" });
    }

    // NULL passes every CHECK — the wizard may save a partial profile.
    await sql`INSERT INTO user_fitness_profiles (user_id) VALUES (${ownerId})`;
    const defaulted = await sql`
      SELECT onboarding_completed FROM user_fitness_profiles WHERE user_id = ${ownerId}`;
    expect(defaulted[0]?.["onboarding_completed"]).toBe(false);

    // FK is ON DELETE CASCADE. NB this fires on a HARD delete only; Part 4 §5.2
    // tombstones the users row instead, so the Day-14 worker must delete this
    // table explicitly (DECISIONS 2026-07-15).
    await sql`DELETE FROM users WHERE id = ${ownerId}`;
    const orphans = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM user_fitness_profiles WHERE user_id = ${ownerId}`;
    expect(orphans[0]?.n).toBe("0");
  });

  // 120s: two full seed passes = many sequential round-trips over a WAN
  // pooler; 30s flaked once under load (P2.5a PROVE) — headroom, not a bug.
  //
  // THE BOOK ASSERTED HERE IS THE RULED ONE, and every number is traceable:
  //  · gym bands + boundaries — Kd, DECISIONS :17902 §1a/§1b (bands 1-2 raised
  //    to $35/$50; boundaries rounded to 0-300 / 301-500 / 501-1000 /
  //    1001-1500 / 1501-2100), over :17366 §1's ratified table for bands 3-5
  //    and the whole INR book.
  //  · seat_cap IS the band boundary in code (:17902 §4) — a cap asserted
  //    nowhere was how the old book stayed stale through two rulings.
  //  · individual tiers — :17366 §1 ($10 international, $5 India) with Kd's
  //    2026-08-25 ₹449 and "one month free" (yearly = 11x monthly).
  //  · gym trial 30 days — Kd :16548, superseding the spec's 7.
  //  · scan/route allowances — :17366 §1/§2 (paid 20/day, gym member 5/day,
  //    free 2/day) and the OWED re-seed line's route_gen 2/day.
  it("seed is idempotent and matches the ruled price book", { timeout: 120_000 }, async () => {
    type PlanRow = {
      code: string;
      price_minor: number;
      currency: string;
      interval: string;
      seat_cap: number | null;
      trial_days: number;
      rank: number;
      active: boolean;
      entitlements: Record<string, unknown>;
      member_entitlements: Record<string, unknown> | null;
    };
    // EVERY READ IN THIS TEST IS SCOPED TO THE ROWS THE SEED OWNS, and that is
    // a CLASS fix rather than a one-line one (:1239).
    //
    // Round 2's Low-1 named the active-codes assertion below; running this file
    // together with `orgs.routes.test.ts` then failed HERE instead, on
    // `expected 22 to be 21` — the idempotency comparison counting that suite's
    // temporary `zz_orgs_cap1` row, which appeared between the two reads. Same
    // defect, one line up, found only because the two suites were run in ONE
    // invocation rather than separately. Nine files seed against one shared
    // database (:13746) and this file is one of the two that assert global
    // shape, so anything unscoped here is a race waiting for a parallel run.
    //
    // The scope is the seed's own naming convention, written out literally
    // rather than derived from `planRows` — a test whose inputs and subject
    // share a source proves only that the source is self-consistent (:3610).
    const readBook = async (): Promise<Map<string, PlanRow>> => {
      const rows = await sql<PlanRow[]>`
        SELECT code, price_minor, currency, "interval", seat_cap, trial_days, rank,
               active, entitlements, member_entitlements
        FROM plans
        WHERE code = 'free' OR code LIKE 'pro\_%' OR code LIKE 'org\_%'
        ORDER BY code`;
      return new Map(rows.map((r) => [r.code, r]));
    };

    // THE TEST BUILDS ITS OWN LEGACY ROW, and this is not housekeeping — it is
    // what makes the retirement OBSERVABLE ON ANY DATABASE.
    //
    // The retirement is an UPDATE, so it can only switch off a row that already
    // exists. On a database that never ran the old seed there is nothing to
    // retire, the statement matches nothing, and deleting it changes NOTHING —
    // measured: mutant O111 is RED against a database carrying the six legacy
    // rows and **ALIVE against a fresh one**. A guarantee whose verdict depends
    // on which database you point at is a guarantee nobody can rely on, and the
    // fresh-database ALIVE would read as "the retirement has no test" to the
    // next chat (:5104 F5, from the fixture side).
    //
    // So the precondition is created here rather than inherited: one real
    // legacy code, ACTIVE, with the pre-ruling price and cap it genuinely had.
    // That is exactly the state a long-lived database is in, and after seeding
    // it must come back inactive.
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, "interval",
                         seat_cap, trial_days, rank, entitlements, member_entitlements, active)
      VALUES ('org_micro', 'org', 'plan.org_micro', 99900, 'INR', 'month',
              25, 7, 10, '{}'::jsonb, '{}'::jsonb, true)
      ON CONFLICT (code) DO UPDATE SET active = true`;

    await seed(url ?? "");
    const first = await readBook();
    await seed(url ?? "");
    const byCode = await readBook();
    // Idempotency is about the CONTENT, not the row count: a second pass that
    // repriced a row would have kept the count identical.
    expect(byCode.size).toBe(first.size);
    for (const [code, row] of first) expect(byCode.get(code), code).toEqual(row);

    const row = (code: string): PlanRow => {
      const r = byCode.get(code);
      expect(r, `missing plan ${code}`).toBeDefined();
      if (r === undefined) throw new Error(`missing plan ${code}`);
      return r;
    };
    const day = (limit: number) => ({ window: "day", limit });

    // ---- consumer -------------------------------------------------------
    const consumer: [string, number, string, string, number][] = [
      // code, price_minor, currency, interval, trial_days
      ["free", 0, "INR", "month", 0],
      ["pro_in_m", 44900, "INR", "month", 7],
      ["pro_in_y", 493900, "INR", "year", 7],
      ["pro_us_m", 1000, "USD", "month", 7],
      ["pro_us_y", 11000, "USD", "year", 7],
    ];
    for (const [code, minor, currency, interval, trialDays] of consumer) {
      const r = row(code);
      expect(r.price_minor, `${code} price`).toBe(minor);
      expect(r.currency, `${code} currency`).toBe(currency);
      expect(r.interval, `${code} interval`).toBe(interval);
      expect(r.trial_days, `${code} trial days`).toBe(trialDays);
      expect(r.seat_cap, `${code} is not an org plan`).toBeNull();
      expect(r.active, `${code} active`).toBe(true);
    }
    expect(row("free").rank).toBe(0);
    expect(row("pro_in_m").rank).toBe(10);

    // ---- gym bands, both books -------------------------------------------
    const bands: [string, number, string, number][] = [
      // code, price_minor, currency, seat_cap
      ["org_b1_us_m", 3500, "USD", 300],
      ["org_b2_us_m", 5000, "USD", 500],
      ["org_b3_us_m", 6900, "USD", 1000],
      ["org_b4_us_m", 9900, "USD", 1500],
      ["org_b5_us_m", 12900, "USD", 2100],
      ["org_b1_in_m", 150000, "INR", 300],
      ["org_b2_in_m", 250000, "INR", 500],
      ["org_b3_in_m", 450000, "INR", 1000],
      ["org_b4_in_m", 650000, "INR", 1500],
      ["org_b5_in_m", 850000, "INR", 2100],
    ];
    for (const [code, minor, currency, seatCap] of bands) {
      const r = row(code);
      expect(r.price_minor, `${code} price`).toBe(minor);
      expect(r.currency, `${code} currency`).toBe(currency);
      expect(r.seat_cap, `${code} seat cap`).toBe(seatCap);
      expect(r.interval, `${code} interval`).toBe("month");
      expect(r.trial_days, `${code} trial days`).toBe(30);
      expect(r.rank, `${code} rank`).toBe(10);
      expect(r.active, `${code} active`).toBe(true);
      expect(r.member_entitlements?.["meal_scan"], `${code} member scans`).toEqual(day(5));
    }

    // WHAT A GYM CAN BE SOLD IS EXACTLY THESE TEN, AND THIS IS THE ASSERTION
    // WITH THE MOST TEETH IN THE FILE. It fails three different ways at once:
    // a book that is ABSENT (the state this card found — no USD org row had
    // ever been seeded), an EXTRA active row (a retirement that did not stick,
    // or a code accidentally listed in both the seed and the retired list), and
    // a code that quietly changed name.
    //
    // **It replaced a per-code check of the six RETIRED rows, and the reason is
    // the T3 round-1 Critical (:5104's shape, one layer out): that check
    // required those rows to EXIST, and on a database that never held them the
    // retirement is an UPDATE matching nothing.** Six tests passed only because
    // the dev machine's database still carried pre-card rows — true of a RUN,
    // false of the code (:13746).
    //
    // **SCOPED TO THE SEED'S OWN `org_` NAMESPACE — round-2 Low-1, and it is a
    // RACE the first version could lose.** `orgs.routes.test.ts` creates a
    // one-seat plan `zz_orgs_cap1` for the length of its run, so an unscoped
    // count sees ELEVEN while that suite is running: nine files seed against
    // one shared database (:13746), and this is the second assertion in this
    // file to be caught by that. **Reproduced rather than reasoned: with that
    // row present this line failed, `received` ending `"zz_orgs_cap1"`.** It
    // also reddened the mutation harness's control, aborting a sweep before it
    // began. The prefix keeps every tooth — an absent book, an extra `org_`
    // row, a rename, a retirement that did not stick — while ignoring rows the
    // seed does not own.
    //
    // **CONSEQUENCE, so the next person naming a plan knows: the `org_` prefix
    // is now load-bearing.** An org plan seeded under a different prefix would
    // be invisible here. Every ruled code has it, and the seed builds them from
    // one template, so the convention is cheap to keep.
    const activeOrgCodes = await sql<{ code: string }[]>`
      SELECT code FROM plans
      WHERE audience = 'org' AND active AND code LIKE 'org\_%'
      ORDER BY code`;
    expect(activeOrgCodes.map((r) => r.code)).toEqual([
      "org_b1_in_m", "org_b1_us_m", "org_b2_in_m", "org_b2_us_m", "org_b3_in_m",
      "org_b3_us_m", "org_b4_in_m", "org_b4_us_m", "org_b5_in_m", "org_b5_us_m",
    ]);
    // The legacy row this test switched ON above must have been switched back
    // OFF by the seed — the retirement's own subject, named directly so the
    // failure says "the retirement did not fire" rather than "expected 11 codes".
    expect(row("org_micro").active, "the seed must retire a legacy plan row").toBe(false);

    // ---- allowances -------------------------------------------------------
    expect(row("pro_us_m").entitlements["meal_scan"], "paid scans").toEqual(day(20));
    expect(row("pro_us_m").entitlements["route_gen"], "paid routes").toEqual(day(2));
    expect(row("free").entitlements["meal_scan"], "free scans").toEqual(day(2));
  });

  it("subs_one_live_uq rejects a second live subscription (23505)", async () => {
    const [user] = await sql`
      INSERT INTO users (display_name) VALUES ('uq-test') RETURNING id`;
    const [plan] = await sql`SELECT id FROM plans WHERE code = 'pro_in_m'`;
    const userId = user?.["id"] as string;
    const planId = plan?.["id"] as string;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('user', ${userId}, ${planId}, 'active', 'razorpay')`;
    let code = "";
    try {
      await sql`
        INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
        VALUES ('user', ${userId}, ${planId}, 'trialing', 'razorpay')`;
    } catch (e) {
      code = (e as { code?: string }).code ?? "";
    }
    expect(code).toBe("23505");
    // A non-live (canceled) row for the same owner is allowed — history stacks.
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('user', ${userId}, ${planId}, 'canceled', 'razorpay')`;
  });

  it("gym_members_live_uq blocks duplicate live membership but allows rejoin", async () => {
    const [owner] = await sql`INSERT INTO users (display_name) VALUES ('owner') RETURNING id`;
    const [member] = await sql`INSERT INTO users (display_name) VALUES ('member') RETURNING id`;
    const ownerId = owner?.["id"] as string;
    const memberId = member?.["id"] as string;
    const [gym] = await sql`
      INSERT INTO gyms (slug, name, owner_user_id)
      VALUES (${`uq-gym-${Date.now().toString()}`}, 'UQ Gym', ${ownerId}) RETURNING id`;
    const gymId = gym?.["id"] as string;
    await sql`INSERT INTO gym_members (gym_id, user_id) VALUES (${gymId}, ${memberId})`;
    let code = "";
    try {
      await sql`INSERT INTO gym_members (gym_id, user_id) VALUES (${gymId}, ${memberId})`;
    } catch (e) {
      code = (e as { code?: string }).code ?? "";
    }
    expect(code).toBe("23505");
    // Leave, then rejoin: history rows stack (Part 4 §3.2).
    await sql`
      UPDATE gym_members SET removed_at = now()
      WHERE gym_id = ${gymId} AND user_id = ${memberId} AND removed_at IS NULL`;
    await sql`INSERT INTO gym_members (gym_id, user_id) VALUES (${gymId}, ${memberId})`;
    const rows = await sql`
      SELECT count(*)::int AS n FROM gym_members
      WHERE gym_id = ${gymId} AND user_id = ${memberId}`;
    expect(rows[0]?.["n"]).toBe(2);
  });

  // T3 round 1 F4 — the "belt" had no test. Every rejection in
  // workouts.sync.test.ts is Zod's, returning 400 before the DB is reached, so
  // nothing proved these three constraints existed, let alone bit. That absence
  // is precisely why F1 and F2 shipped: the card claimed "enforced twice" while
  // one of the two enforcements was wrong and the other was missing. These go
  // straight at the table, past every schema.
  it("0009 workout_sets CHECKs bite at the DB, not just at Zod", async () => {
    // R2 minor: clean BOTH fixtures up front, not only after. A run that dies
    // mid-test used to leak this user row, and the next run then failed on the
    // leftover instead of on the thing under test.
    await sql`DELETE FROM workouts WHERE user_id IN
      (SELECT id FROM users WHERE display_name = 'log-only-ddl-check')`;
    await sql`DELETE FROM users WHERE display_name = 'log-only-ddl-check'`;
    const owner = await sql<{ id: string }[]>`
      INSERT INTO users (display_name) VALUES ('log-only-ddl-check') RETURNING id`;
    const userId = owner[0]?.id;
    if (userId === undefined) throw new Error("log-only fixture insert failed");
    const ex = await sql<{ id: string }[]>`SELECT id FROM exercises WHERE slug = 'squat'`;
    const exerciseId = ex[0]?.id;
    if (exerciseId === undefined) throw new Error("squat must be seeded for this test");

    const workoutId = "dddddddd-1111-4111-8111-00000000dd01";
    // Clean BEFORE, not only after: a run that fails mid-test leaves the row
    // behind and every later run then dies on the PK instead of on the thing
    // under test — a fixture failure wearing the costume of a real one.
    await sql`DELETE FROM workouts WHERE id = ${workoutId}`;
    await sql`
      INSERT INTO workouts (id, user_id, started_at, platform, engine_version,
                            sets_count, total_reps, duration_ms)
      VALUES (${workoutId}, ${userId}, now(), 'web', '1.0.0', 0, 0, 0)`;

    /** One set row. Columns are listed explicitly rather than via the dynamic
     *  `sql({…})` helper, which cannot type `rep_scores` as smallint[]. */
    const insertSet = (
      setIndex: number,
      c: {
        mode?: string | null;
        reps?: number;
        avgFormScore?: number | null;
        repScores?: number[] | null;
        faultCounts?: Record<string, number>;
        engineVersion?: string | null;
        definitionVersion?: number | null;
      },
    ) => sql`
      INSERT INTO workout_sets (workout_id, user_id, exercise_id, started_at,
                                set_index, mode, reps, duration_ms,
                                avg_form_score, rep_scores, fault_counts,
                                engine_version, definition_version)
      VALUES (${workoutId}, ${userId}, ${exerciseId}, now(), ${setIndex},
              ${c.mode ?? null}, ${c.reps ?? 0}, 1000, ${c.avgFormScore ?? null},
              ${c.repScores ?? null}::smallint[],
              ${sql.json(c.faultCounts ?? {})}, ${c.engineVersion ?? null},
              ${c.definitionVersion ?? null})`;

    // R2-F2: every case names the constraint it expects. Without that, case 5
    // below was rejected by the PROVENANCE check, not the log-only one — so the
    // three score clauses of log_only_unscored_check could be deleted with the
    // suite still green. A rejection is only evidence for the rule that caused it.
    const rejects = (p: Promise<unknown>, constraint: string) =>
      expect(p).rejects.toMatchObject({ code: "23514", constraint_name: constraint });

    // mode_check: only the two ruled values exist.
    await rejects(insertSet(1, { mode: "guessed" }), "workout_sets_mode_check");

    // engine_provenance_check — F1's exact bypass: a fully SCORED set with NO
    // provenance and NO mode. The first version of this constraint accepted it,
    // because `NULL IS DISTINCT FROM 'engine'` is TRUE.
    await rejects(
      insertSet(2, { avgFormScore: 90, repScores: [90, 91] }),
      "workout_sets_engine_provenance_check",
    );
    // …and with mode declared, which the first version DID catch.
    await rejects(
      insertSet(3, { mode: "engine", avgFormScore: 90 }),
      "workout_sets_engine_provenance_check",
    );
    // R2-F3: a FAULT LIST is score evidence too, and was NOT covered — a row
    // with faults and no provenance was accepted until round 2.
    await rejects(
      insertSet(9, { faultCounts: { shallow_depth: 3 } }),
      "workout_sets_engine_provenance_check",
    );

    // log_only_unscored_check — F2's exact bypass: "nothing analysed this, and
    // here is the engine that analysed it". The first version accepted it.
    await rejects(
      insertSet(4, { mode: "log_only", engineVersion: "1.0.0", definitionVersion: 1 }),
      "workout_sets_log_only_unscored_check",
    );

    // The three SCORE clauses of log_only_unscored_check need the sibling out of
    // the way to be provable. A log-only row carrying a score ALSO lacks
    // provenance, so engine_provenance_check rejects it first and Postgres
    // reports THAT name — which is how round 2 found these three clauses had no
    // assertion of their own.
    //
    // Rather than drop the sibling (DDL inside a transaction takes a lock and
    // starved the pool), the DEPLOYED predicate is fetched from the catalog and
    // evaluated on its own against candidate rows. This runs the real
    // constraint expression — not a copy of it, which would drift — and needs
    // no locks, no transaction and no writes.
    const [defRow] = await sql<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'workout_sets'::regclass
        AND conname = 'workout_sets_log_only_unscored_check'`;
    const predicate = defRow?.def.replace(/^CHECK\s*/i, "");
    if (predicate === undefined) throw new Error("log_only_unscored_check is not on the table");

    /** Evaluate the deployed predicate against one hypothetical row. */
    const holds = async (row: {
      avg_form_score: number | null;
      rep_scores: number[] | null;
      fault_counts: Record<string, number>;
    }): Promise<boolean | null> => {
      const [r] = await sql<{ ok: boolean | null }[]>`
        SELECT ${sql.unsafe(predicate)} AS ok
        FROM (VALUES (
          'log_only'::text,
          ${row.avg_form_score}::smallint,
          ${row.rep_scores}::smallint[],
          ${sql.json(row.fault_counts)}::jsonb,
          NULL::text,
          NULL::int
        )) AS t(mode, avg_form_score, rep_scores, fault_counts, engine_version,
                definition_version)`;
      return r?.ok ?? null;
    };

    // The honest log-only row satisfies it…
    expect(await holds({ avg_form_score: null, rep_scores: null, fault_counts: {} })).toBe(true);
    // …and each score clause on its own makes it FALSE. Delete any one of the
    // three from the constraint and the matching line here goes red.
    expect(
      await holds({ avg_form_score: 80, rep_scores: null, fault_counts: {} }),
      "avg_form_score clause is not load-bearing",
    ).toBe(false);
    expect(
      await holds({ avg_form_score: null, rep_scores: [80], fault_counts: {} }),
      "rep_scores clause is not load-bearing",
    ).toBe(false);
    expect(
      await holds({ avg_form_score: null, rep_scores: null, fault_counts: { shallow_depth: 1 } }),
      "fault_counts clause is not load-bearing",
    ).toBe(false);

    // A log-only row carrying a score is rejected in the REAL configuration
    // too — by whichever of the two fires first, which is all that matters here.
    await expect(
      insertSet(5, { mode: "log_only", avgFormScore: 80 }),
    ).rejects.toMatchObject({ code: "23514" });

    // The legitimate shapes still insert: log-only, engine, the migrate-mongo
    // shape (Part 4 §7: 'legacy-py' / 0), and a pre-0009-style row (mode NULL
    // with provenance present). None may be broken by a constraint added for a
    // different case.
    await insertSet(6, { mode: "log_only", reps: 10 });
    await insertSet(7, {
      mode: "engine",
      reps: 5,
      avgFormScore: 88,
      repScores: [88],
      engineVersion: "1.0.0",
      definitionVersion: 1,
    });
    await insertSet(8, {
      reps: 5,
      avgFormScore: 70,
      engineVersion: "legacy-py",
      definitionVersion: 0,
    });

    const kept = await sql`
      SELECT count(*)::int AS n FROM workout_sets WHERE workout_id = ${workoutId}`;
    expect(kept[0]?.["n"]).toBe(3);

    await sql`DELETE FROM workouts WHERE id = ${workoutId}`;
    await sql`DELETE FROM users WHERE id = ${userId}`;
  });

  /** T3 Low-5 — a PERMANENT GUARD (:5348 rule 5) for a class this repo has no
   *  other defence against: the SAME vocabulary written down twice.
   *
   *  `ORG_PRIVILEGES` in `@app/shared` and migration `0013`'s CHECK list the
   *  same six strings, and **nothing bound them**, so each direction of drift
   *  fails somewhere far from the edit:
   *    · add a privilege to the code without a migration ⇒ `createOrgAttempt`
   *      writes it into a role template and Postgres raises an unmapped 23514 —
   *      **CREATING A GYM 500s**, not merely appointing somebody;
   *    · drop one from the CHECK ⇒ `privilegesFor`'s filter silently narrows
   *      every stored row, and everybody quietly loses a power.
   *
   *  It reads the DEPLOYED predicate rather than a copy of the DDL — the
   *  `log_only_unscored_check` test's own lesson, one table over. */
  it("0013's privilege CHECK lists exactly the privileges the code knows", async () => {
    const [defRow] = await sql<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'gym_staff'::regclass
        AND conname = 'gym_staff_privileges_check'`;
    const def = defRow?.def;
    if (def === undefined) throw new Error("gym_staff_privileges_check is not on the table");

    // Every quoted string inside the deployed ARRAY[...] literal.
    //
    // **`[^']*` and not `[a-z][a-z.]*` — T3 round 2, Low-2.** The narrow pattern
    // silently skipped any privilege whose name falls outside `[a-z.]`, so a
    // `tv_token` added to the database was INVISIBLE to the guard and it stayed
    // green — a drift detector that cannot see half the vocabulary. The
    // reviewer measured it: `CHECK + tv.token` went RED, `CHECK + tv_token`
    // stayed GREEN. The catalogue :11429 names includes a TV-mode token, so
    // this was not a hypothetical shape.
    const inCheck = [...def.matchAll(/'([^']*)'::text/g)].map((m) => m[1]).sort();
    expect(inCheck).toEqual([...ORG_PRIVILEGES].sort());
  });

  /** MIGRATION `0014`'s BACKFILL, and it is the one thing standing between the
   *  gym-details card and shipping DEAD.
   *
   *  `privilegesFor` prefers the STORED set over the role template, so an owner
   *  appointed before `org.manage` existed carries a set without it and is 403'd
   *  on their own gym — and the "change everyone on this role too?" button that
   *  would re-grant it belongs to a card that is not built. The template's own
   *  half is pinned in `orgs.routes.test.ts`; this is the half that covers rows
   *  that were already in the database when the migration landed.
   *
   *  **THE OBVIOUS VERSION OF THIS TEST CANNOT FAIL, and it was written and
   *  measured before this one replaced it.** "No owner row is missing the
   *  privilege" is a query that comes back empty on any database with no owner
   *  rows — and the local docker Postgres this suite is meant to run against has
   *  `owner_rows=0` (measured 2026-08-26). A green assertion over an empty set
   *  is :5104 F5's shape and :18652's C/H-3 exactly: a verdict that depends on
   *  which database you point it at is worse than a missing one.
   *
   *  **So the test BUILDS ITS OWN LEGACY ROW** (:18652's own fix for O111) — an
   *  owner carrying the pre-`0014` six — and runs the backfill **read out of the
   *  shipped migration file**, never a copy re-typed here. A guard that asserts
   *  a hand-written copy of the thing it guards is the defect :12227 recorded;
   *  reading the artifact is the same standard `pg_get_constraintdef` holds the
   *  CHECK to one test above.
   *
   *  Rolled back, so nothing this test creates survives it. */
  it("0014's backfill gives a pre-existing owner the new privilege", async () => {
    const migration = await readFile(
      new URL("../drizzle/0014_org_manage_and_country.sql", import.meta.url),
      "utf8",
    );
    // The statement, taken whole out of the file. `--> statement-breakpoint` is
    // drizzle's own separator, so each chunk is one statement exactly as the
    // migrator ran it — leading `--` comments and all, which Postgres ignores.
    //
    // Matched on `array_append` rather than on the chunk STARTING with UPDATE:
    // the statement is preceded by its own comment block, so the strict version
    // found nothing and this test failed loudly on its first run. That failure
    // is worth recording rather than tidying away — it is the proof that this
    // test genuinely reads the shipped file, which is the whole reason it is
    // written this way.
    const chunks = migration.split("--> statement-breakpoint").map((s) => s.trim());
    const matches = chunks.filter((s) => s.includes("array_append"));
    const backfill = matches[0];
    if (matches.length !== 1 || backfill === undefined || !backfill.includes("UPDATE")) {
      throw new Error(
        `0014 no longer contains exactly one backfill UPDATE (found ${String(matches.length)})`,
      );
    }

    const legacySix = [
      "codes.invite", "codes.manage", "members.confirm",
      "members.read", "members.remove", "staff.manage",
    ];

    await sql
      .begin(async (tx) => {
        const [user] = await tx<{ id: string }[]>`
          INSERT INTO users (display_name) VALUES ('zz-0014-legacy-owner') RETURNING id`;
        const userId = user?.id;
        if (userId === undefined) throw new Error("legacy-owner fixture insert failed");
        const [gym] = await tx<{ id: string }[]>`
          INSERT INTO gyms (slug, name, owner_user_id)
          VALUES ('zz-0014-legacy', 'zz 0014 legacy', ${userId}) RETURNING id`;
        const gymId = gym?.id;
        if (gymId === undefined) throw new Error("legacy-owner gym insert failed");
        await tx`
          INSERT INTO gym_staff (gym_id, user_id, role, privileges)
          VALUES (${gymId}, ${userId}, 'owner', ${legacySix})`;

        // THE SUBJECT EXISTS AND IS IN THE STATE THE BACKFILL IS FOR. Without
        // this the whole test could run against a row that already had the
        // privilege and still go green.
        const [before] = await tx<{ privileges: string[] }[]>`
          SELECT privileges FROM gym_staff WHERE gym_id = ${gymId} AND user_id = ${userId}`;
        expect(before?.privileges).not.toContain("org.manage");

        await tx.unsafe(backfill);

        const [after] = await tx<{ privileges: string[] }[]>`
          SELECT privileges FROM gym_staff WHERE gym_id = ${gymId} AND user_id = ${userId}`;
        expect(after?.privileges).toContain("org.manage");
        // Nothing else moved — a backfill that rewrote the set instead of adding
        // to it would take powers away from the very people it is repairing.
        for (const p of legacySix) expect(after?.privileges).toContain(p);

        throw new Error("ROLLBACK-0014-BACKFILL-FIXTURE");
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.message === "ROLLBACK-0014-BACKFILL-FIXTURE") return;
        throw err;
      });
  });

  /** MIGRATION `0015`'s BACKFILL, and it had NO GUARD AT ALL until T3 round 1
   *  (Low-1) — which is the highest-value item that round found.
   *
   *  **Measured before this test was written: delete `0015`'s UPDATE entirely and
   *  every suite stays green.** On a fresh database every owner row is written by
   *  `createOrg` from the role template, which already carries `billing.manage`,
   *  so no test anywhere has a PRE-`0015` subject. `O134` mutates the template,
   *  not the migration. The card's own SQL comment says *"Without this line the
   *  card ships DEAD"* — a claim nothing could falsify, which is exactly the
   *  shape rule 4 exists to catch.
   *
   *  Same construction as `0014`'s, deliberately: build the legacy row rather
   *  than hope one exists (:18652's fix for O111), and run the statement **read
   *  out of the shipped migration file** rather than a copy re-typed here
   *  (:12227). Rolled back, so nothing it creates survives it. */
  it("0015's backfill gives a pre-existing owner the billing privilege", async () => {
    const migration = await readFile(
      new URL("../drizzle/0015_billing_manage_and_provider_none.sql", import.meta.url),
      "utf8",
    );
    const chunks = migration.split("--> statement-breakpoint").map((s) => s.trim());
    const matches = chunks.filter((s) => s.includes("array_append"));
    const backfill = matches[0];
    if (matches.length !== 1 || backfill === undefined || !backfill.includes("UPDATE")) {
      throw new Error(
        `0015 no longer contains exactly one backfill UPDATE (found ${String(matches.length)})`,
      );
    }

    // The seven an owner carried after `0014` and before `0015` — every
    // ORG_PRIVILEGE except the one this migration mints.
    const legacySeven = ORG_PRIVILEGES.filter((p) => p !== "billing.manage");
    expect(legacySeven).toHaveLength(ORG_PRIVILEGES.length - 1);

    await sql
      .begin(async (tx) => {
        const [user] = await tx<{ id: string }[]>`
          INSERT INTO users (display_name) VALUES ('zz-0015-legacy-owner') RETURNING id`;
        const userId = user?.id;
        if (userId === undefined) throw new Error("legacy-owner fixture insert failed");
        const [gym] = await tx<{ id: string }[]>`
          INSERT INTO gyms (slug, name, owner_user_id)
          VALUES ('zz-0015-legacy', 'zz 0015 legacy', ${userId}) RETURNING id`;
        const gymId = gym?.id;
        if (gymId === undefined) throw new Error("legacy-owner gym insert failed");
        await tx`
          INSERT INTO gym_staff (gym_id, user_id, role, privileges)
          VALUES (${gymId}, ${userId}, 'owner', ${[...legacySeven]})`;

        // THE SUBJECT IS IN THE STATE THE BACKFILL IS FOR — without this the
        // test could run against a row that already had it and still go green.
        const [before] = await tx<{ privileges: string[] }[]>`
          SELECT privileges FROM gym_staff WHERE gym_id = ${gymId} AND user_id = ${userId}`;
        expect(before?.privileges).not.toContain("billing.manage");

        await tx.unsafe(backfill);

        const [after] = await tx<{ privileges: string[] }[]>`
          SELECT privileges FROM gym_staff WHERE gym_id = ${gymId} AND user_id = ${userId}`;
        expect(after?.privileges).toContain("billing.manage");
        // Nothing else moved. A backfill that REPLACED the set instead of
        // appending would strip seven powers off the very owners it repairs —
        // and the gym's last owner losing `staff.manage` is a lockout.
        for (const p of legacySeven) expect(after?.privileges).toContain(p);

        // A NON-OWNER IS UNTOUCHED. The statement's `role = 'owner'` is the
        // whole of its blast radius, and without this a backfill that dropped
        // that clause — handing every receptionist the billing tick — passes
        // every assertion above.
        const [staffUser] = await tx<{ id: string }[]>`
          INSERT INTO users (display_name) VALUES ('zz-0015-legacy-manager') RETURNING id`;
        const staffId = staffUser?.id;
        if (staffId === undefined) throw new Error("legacy-manager fixture insert failed");
        await tx`
          INSERT INTO gym_staff (gym_id, user_id, role, privileges)
          VALUES (${gymId}, ${staffId}, 'manager', ${[...legacySeven]})`;
        await tx.unsafe(backfill);
        const [manager] = await tx<{ privileges: string[] }[]>`
          SELECT privileges FROM gym_staff WHERE gym_id = ${gymId} AND user_id = ${staffId}`;
        expect(manager?.privileges).not.toContain("billing.manage");

        // AND THE OWNER ROW IS UNCHANGED BY THE SECOND RUN — the migration's own
        // "idempotent by its own WHERE" claim. The run above is the second one,
        // so this test already EXERCISED idempotency and never asserted it
        // (T3 round 2, rule 4's list, item 3): without this, a backfill that
        // appended a DUPLICATE on every run would pass everything above.
        const [ownerAfterSecond] = await tx<{ privileges: string[] }[]>`
          SELECT privileges FROM gym_staff WHERE gym_id = ${gymId} AND user_id = ${userId}`;
        expect(ownerAfterSecond?.privileges).toEqual(after?.privileges);
        expect(
          ownerAfterSecond?.privileges.filter((p) => p === "billing.manage"),
        ).toHaveLength(1);

        throw new Error("ROLLBACK-0015-BACKFILL-FIXTURE");
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.message === "ROLLBACK-0015-BACKFILL-FIXTURE") return;
        throw err;
      });
  });

  /** `gyms.country` and its shape CHECK, proven by CAUSING it rather than by
   *  reading the DDL back — the same standard `0013`'s CHECK is held to.
   *
   *  The constraint is SHAPE ONLY (two capitals) on purpose: whether we are OPEN
   *  in a country is `supportedCountrySchema`'s answer, in code, and that list
   *  grows as Kd opens markets. A copy of it in DDL would need a migration per
   *  country and would go stale silently in between.
   *
   *  Inside a rolled-back transaction so the row never lands. */
  it("0014's country column refuses anything that is not two capitals", async () => {
    const refused: string[] = [];
    for (const bad of ["us", "USA", "U", "u1", ""]) {
      try {
        await sql.begin(async (tx) => {
          await tx`
            INSERT INTO gyms (slug, name, country, owner_user_id)
            VALUES (${`zz-country-check-${bad || "empty"}`}, 'zz country check', ${bad},
                    (SELECT id FROM users LIMIT 1))`;
          throw new Error("ROLLBACK-AFTER-UNEXPECTED-SUCCESS");
        });
      } catch (err) {
        const code = typeof err === "object" && err !== null && "code" in err ? err.code : null;
        if (code === "23514") refused.push(bad);
      }
    }
    expect(refused).toEqual(["us", "USA", "U", "u1", ""]);

    // POSITIVE CONTROL — without it a column that refused EVERYTHING would
    // satisfy the loop above (:7104's PG1: a table of only-should-fail rows is
    // satisfied by a constraint that passes nothing).
    let accepted = false;
    try {
      await sql.begin(async (tx) => {
        await tx`
          INSERT INTO gyms (slug, name, country, owner_user_id)
          VALUES ('zz-country-check-ok', 'zz country check ok', 'DE',
                  (SELECT id FROM users LIMIT 1))`;
        accepted = true;
        throw new Error("ROLLBACK");
      });
    } catch {
      /* rolled back on purpose */
    }
    expect(accepted).toBe(true);
  });
});
