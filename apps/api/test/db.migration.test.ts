// P0.3 migration/seed proof (runs against a real Postgres — Neon branch).
// Requires DATABASE_URL pointing at a database that has had `pnpm --filter api
// migrate` applied. Skips visibly when unset so unit CI stays green; the
// migration CI job / local Neon-branch run is where this executes.
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { seed } from "../src/db/seed.js";
import { currentWeightKg } from "../src/modules/nutrition/repo.js";
import {
  GYM_CHEER_PRESETS,
  GYM_NUDGE_PRESETS,
  ORG_PRIVILEGES,
  consentPurposeSchema,
  equipmentSchema,
  fitnessGoalSchema,
  orgTypeSchema,
  weightGoalSchema,
} from "@app/shared";

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

  /** `0021`'s PRESET CHECK LISTS EXACTLY THE FOUR LINES THE CODE KNOWS — the
   *  privilege guard above, applied to Kd's :29961 ruling 4 the day the table was
   *  created rather than a card later.
   *
   *  **THE RULING IS *"no free-text box"*, AND THIS IS WHAT MAKES IT A PROPERTY
   *  OF THE DATABASE.** The Zod enum refuses a typed sentence at the boundary;
   *  this refuses one that arrives any other way, including from a future writer
   *  in this repo that never passes through the route.
   *
   *  **BOTH DIRECTIONS OF DRIFT FAIL SOMEWHERE FAR FROM THE EDIT, which is the
   *  reason this is pinned at all** (the privilege CHECK's own recorded shape):
   *    · add a fifth preset to `GYM_CHEER_PRESETS` without a migration ⇒ the
   *      route accepts it, the INSERT raises an unmapped 23514, and **pressing
   *      the button 500s**;
   *    · drop one from the CHECK ⇒ a preset the screen still offers becomes
   *      unsendable for one member of staff and nobody learns why.
   *
   *  It reads the DEPLOYED predicate, never a copy of the DDL — `pg_catalog` is
   *  also the only thing that can tell you the migration RAN, since a `.sql` file
   *  the journal does not name is applied silently and reports success
   *  (:28221 §6). */
  it("0021's preset CHECK lists exactly the cheer presets the code knows", async () => {
    const [defRow] = await sql<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'gym_cheers'::regclass
        AND conname = 'gym_cheers_preset_check'`;
    const def = defRow?.def;
    if (def === undefined) throw new Error("gym_cheers_preset_check is not on the table");

    // `[^']*` for the privilege guard's own recorded reason: a narrow character
    // class silently skips any name that falls outside it, which is a drift
    // detector that cannot see half its vocabulary.
    const inCheck = [...def.matchAll(/'([^']*)'::text/g)].map((m) => m[1]).sort();
    expect(inCheck).toEqual([...GYM_CHEER_PRESETS].sort());
  });

  /** `0022`'s PRESET CHECK, the same guard on the same day for the same reason —
   *  Part 3 §4.1's nudge, whose four lines Kd approved at :36816.
   *
   *  **A COPY OF A GUARD IS NOT A GUARD FOR THE COPY**, which is why this is
   *  written out rather than folded into the test above with a loop: the two
   *  tables carry DIFFERENT vocabularies, and a parameterised version would pass
   *  if both constraints named the same four strings. `gym_nudges` naming the
   *  cheer's presets is precisely the mistake a copy-paste build makes.
   *
   *  **BOTH DIRECTIONS OF DRIFT FAIL FAR FROM THE EDIT**, exactly as above: a
   *  fifth name in `GYM_NUDGE_PRESETS` without a migration 500s the button on an
   *  unmapped 23514; a name dropped from the CHECK makes a line the screen still
   *  offers unsendable, and nobody learns why. */
  it("0022's preset CHECK lists exactly the nudge presets the code knows", async () => {
    const [defRow] = await sql<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'gym_nudges'::regclass
        AND conname = 'gym_nudges_preset_check'`;
    const def = defRow?.def;
    if (def === undefined) throw new Error("gym_nudges_preset_check is not on the table");

    const inCheck = [...def.matchAll(/'([^']*)'::text/g)].map((m) => m[1]).sort();
    expect(inCheck).toEqual([...GYM_NUDGE_PRESETS].sort());
    // AND THE TWO TABLES DO NOT SHARE A VOCABULARY — the assertion that makes
    // the one above non-vacuous if a build ever copies the wrong array across.
    expect(inCheck).not.toEqual([...GYM_CHEER_PRESETS].sort());
  });

  /** `0023`'s SIGN-IN CODE TABLE, read back off the deployed catalogue like
   *  `0017`'s and `0019`'s — never off the `.sql`. The purpose CHECK is what
   *  keeps the sign-in door and the deletion confirmation two different keys
   *  (a code for one must never open the other); the attempts CHECK is the
   *  floor under "five wrong guesses". Both are proven by CAUSING them. */
  it("0023's sign-in code constraints exist on the deployed database", async () => {
    const rows = await sql<{ name: string; def: string }[]>`
      SELECT conname AS name, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'sign_in_codes'::regclass AND contype = 'c'
      ORDER BY conname`;
    const byName = new Map(rows.map((r) => [r.name, r.def.replace(/\s+/g, " ")]));
    expect([...byName.keys()].sort()).toEqual(["sign_in_codes_attempts_check", "sign_in_codes_purpose_check"]);
    expect(byName.get("sign_in_codes_purpose_check")).toContain("'sign_in'");
    expect(byName.get("sign_in_codes_purpose_check")).toContain("'delete_account'");
    expect(byName.get("sign_in_codes_attempts_check")).toContain("attempts >= 0");

    const refused = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ code: "23514" });
    await refused(sql`
      INSERT INTO sign_in_codes (email, purpose, code_hash, expires_at)
      VALUES ('zz-0023@example.com', 'reset_password', repeat('0', 64), now())`);
    await refused(sql`
      INSERT INTO sign_in_codes (email, purpose, code_hash, expires_at, attempts)
      VALUES ('zz-0023@example.com', 'sign_in', repeat('0', 64), now(), -1)`);
    // Positive control, rolled back: a legitimate row is accepted.
    let accepted = false;
    try {
      await sql.begin(async (tx) => {
        await tx`
          INSERT INTO sign_in_codes (email, purpose, code_hash, expires_at)
          VALUES ('zz-0023@example.com', 'delete_account', repeat('0', 64), now())`;
        accepted = true;
        throw new Error("ROLLBACK");
      });
    } catch {
      /* rolled back on purpose */
    }
    expect(accepted).toBe(true);
    // No FK to users — by design (an address may have no account yet).
    const fks = await sql`
      SELECT 1 FROM pg_constraint WHERE conrelid = 'sign_in_codes'::regclass AND contype = 'f'`;
    expect(fks).toHaveLength(0);
  });

  /** `0024`'s ORG TYPE CHECK LISTS EXACTLY THE TYPES `orgTypeSchema` KNOWS — the
   *  guard `0021` and `0022` carry, for the same reason: a `.sql` file the
   *  journal does not name is applied silently and reports success.
   *
   *  Both directions fail far from the edit. A type in the enum without a
   *  migration 500s the create route on an unmapped 23514 (the route test
   *  covers that). A type in the CHECK without the enum is the direction only
   *  this test covers: a row written with it is refused on the way OUT at
   *  `repo.ts`'s parse, which turns every `/v1/orgs/mine` read into a 500 for
   *  everyone whose list contains that row. */
  it("0024's org type CHECK lists exactly the types orgTypeSchema knows", async () => {
    const [defRow] = await sql<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'gyms'::regclass AND conname = 'gyms_org_type_check'`;
    const def = defRow?.def;
    if (def === undefined) throw new Error("gyms_org_type_check is not on the table");

    const inCheck = [...def.matchAll(/'([^']*)'::text/g)].map((m) => m[1]).sort();
    expect(inCheck).toEqual([...orgTypeSchema.options].sort());
    // The read side keeps `clinic` for legacy rows even though the door refuses
    // it — the assertion that keeps this test about the READ vocabulary.
    expect(inCheck).toContain("clinic");
  });

  /** `0025`'s TWO TABLES, read back off the deployed catalogue. The screening's
   *  second CHECK is the contradiction guard (a yes must choose; a no cannot be
   *  "cleared"); the consent purpose CHECK lists exactly the screens the shared
   *  enum knows. Both proven by CAUSING them, and the consent log's FK to users
   *  is NOT a cascade — the row is kept as proof after a purge. */
  it("0025's health screening and consent log constraints exist on the deployed database", async () => {
    const owner = await sql<{ id: string }[]>`
      INSERT INTO users (email, display_name) VALUES ('zz-0025@example.com', 'zz 0025')
      ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`;
    const ownerId = owner[0]?.id ?? "";
    const refused = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ code: "23514" });
    try {
      await refused(sql`INSERT INTO user_health_screenings (user_id, has_condition, check_first) VALUES (${ownerId}, true, NULL)`);
      await refused(sql`INSERT INTO user_health_screenings (user_id, has_condition, check_first) VALUES (${ownerId}, false, 'cleared')`);
      await refused(sql`INSERT INTO user_health_screenings (user_id, has_condition, check_first) VALUES (${ownerId}, true, 'later')`);
      await refused(sql`INSERT INTO consent_log (user_id, purpose, wording_version, wording, app_version) VALUES (${ownerId}, 'marketing', 'v1', 'w', 'a')`);

      const [defRow] = await sql<{ def: string }[]>`
        SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'consent_log'::regclass AND conname = 'consent_log_purpose_check'`;
      const inCheck = [...(defRow?.def ?? "").matchAll(/'([^']*)'::text/g)].map((m) => m[1]).sort();
      expect(inCheck).toEqual([...consentPurposeSchema.options].sort());

      const fk = await sql<{ confdeltype: string }[]>`
        SELECT confdeltype FROM pg_constraint WHERE conrelid = 'consent_log'::regclass AND contype = 'f'`;
      expect(fk.map((r) => r.confdeltype)).toEqual(["a"]); // NO ACTION: never cascades
      // One row per person: the primary key IS user_id, by name, not merely
      // "some primary key exists".
      const pk = await sql<{ attname: string }[]>`
        SELECT a.attname FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = 'user_health_screenings'::regclass AND i.indisprimary`;
      expect(pk.map((r) => r.attname)).toEqual(["user_id"]);
    } finally {
      await sql`DELETE FROM consent_log WHERE user_id = ${ownerId}`;
      await sql`DELETE FROM users WHERE id = ${ownerId}`;
    }
  });

  /** `0026`'s ONBOARDING v2 COLUMNS, read back off the deployed catalogue: the
   *  four left after 0028 dropped `main_goal` (0028's own tests below cover
   *  the weight choice that replaced it). Each CHECK is proven by CAUSING it,
   *  and NULL is proven to pass all four: a half-finished wizard is the normal
   *  state of this table. */
  it("0026's onboarding answer columns exist on the deployed database, with their CHECKs", async () => {
    const owner = await sql<{ id: string }[]>`
      INSERT INTO users (email, display_name) VALUES ('zz-0026@example.com', 'zz 0026')
      ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`;
    const ownerId = owner[0]?.id ?? "";
    const refused = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ code: "23514" });
    try {
      await sql`INSERT INTO user_fitness_profiles (user_id) VALUES (${ownerId}) ON CONFLICT DO NOTHING`;
      // Every one of the four is NULLable — the wizard saves as it goes.
      const nulls = await sql<{ n: string }[]>`
        SELECT count(*)::text AS n FROM user_fitness_profiles
        WHERE user_id = ${ownerId} AND pace IS NULL
          AND day_activity IS NULL AND push_ups_max IS NULL AND plank_hold_seconds IS NULL`;
      expect(nulls[0]?.n).toBe("1");

      await refused(sql`UPDATE user_fitness_profiles SET pace = 'extreme' WHERE user_id = ${ownerId}`);
      await refused(sql`UPDATE user_fitness_profiles SET day_activity = 'lying_down' WHERE user_id = ${ownerId}`);
      await refused(sql`UPDATE user_fitness_profiles SET push_ups_max = -1 WHERE user_id = ${ownerId}`);
      await refused(sql`UPDATE user_fitness_profiles SET push_ups_max = 501 WHERE user_id = ${ownerId}`);
      await refused(sql`UPDATE user_fitness_profiles SET plank_hold_seconds = -1 WHERE user_id = ${ownerId}`);
      await refused(sql`UPDATE user_fitness_profiles SET plank_hold_seconds = 3601 WHERE user_id = ${ownerId}`);
    } finally {
      await sql`DELETE FROM users WHERE id = ${ownerId}`;
    }
  });

  /** MIGRATION `0028`: screen 1's weight choice is stored, `main_goal` is gone,
   *  and the goals and the equipment are CHECKed, read back off the deployed
   *  catalogue.
   *
   *  Each value set carries the `0024` guard for the same reason: a `.sql`
   *  file the journal does not name is applied silently and reports success,
   *  and both directions of a drift fail far from the edit. A value in the
   *  enum without the migration 400s nothing and 500s the save on an unmapped
   *  23514; a value in the CHECK without the enum is the direction only this
   *  test covers — a row written with it is refused on the way OUT, at the
   *  service's parse, turning that person's every onboarding read into a 500.
   *  Each CHECK is also proven by CAUSING it, and NULL passes all three. */
  it("0028 stores the weight choice, drops main_goal, and checks the goals and the equipment", async () => {
    const [col] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_name = 'user_fitness_profiles' AND column_name = 'main_goal'`;
    expect(col?.n, "user_fitness_profiles.main_goal still exists").toBe(0);
    const valuesIn = async (name: string) => {
      const [row] = await sql<{ def: string }[]>`
        SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'user_fitness_profiles'::regclass AND conname = ${name}`;
      if (row === undefined) throw new Error(`${name} is not on the table`);
      return [...new Set([...row.def.matchAll(/'([^']*)'::text/g)].map((m) => m[1]))].sort();
    };
    expect(await valuesIn("user_fitness_profiles_weight_goal_check")).toEqual([...weightGoalSchema.options].sort());
    expect(await valuesIn("user_fitness_profiles_fitness_goals_check")).toEqual([...fitnessGoalSchema.options].sort());
    expect(await valuesIn("user_fitness_profiles_available_equipment_check")).toEqual([...equipmentSchema.options].sort());

    const owner = await sql<{ id: string }[]>`
      INSERT INTO users (email, display_name) VALUES ('zz-0028@example.com', 'zz 0028')
      ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`;
    const ownerId = owner[0]?.id ?? "";
    const refused = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ code: "23514" });
    try {
      await sql`INSERT INTO user_fitness_profiles (user_id) VALUES (${ownerId}) ON CONFLICT DO NOTHING`;
      const nulls = await sql<{ n: string }[]>`
        SELECT count(*)::text AS n FROM user_fitness_profiles
        WHERE user_id = ${ownerId} AND weight_goal IS NULL AND fitness_goals IS NULL AND available_equipment IS NULL`;
      expect(nulls[0]?.n).toBe("1");
      await refused(sql`UPDATE user_fitness_profiles SET weight_goal = 'keep' WHERE user_id = ${ownerId}`);
      await refused(sql`UPDATE user_fitness_profiles SET fitness_goals = ARRAY['weight_loss'] WHERE user_id = ${ownerId}`);
      await refused(sql`UPDATE user_fitness_profiles SET available_equipment = ARRAY['barbell'] WHERE user_id = ${ownerId}`);
      await refused(sql`UPDATE user_fitness_profiles SET available_equipment = ARRAY['none', 'gym'] WHERE user_id = ${ownerId}`);
      // What the screens send is taken.
      await sql`
        UPDATE user_fitness_profiles
        SET weight_goal = 'maintain', fitness_goals = ARRAY['muscle_gain', 'balance'], available_equipment = ARRAY['gym', 'dumbbells']
        WHERE user_id = ${ownerId}`;
      await sql`UPDATE user_fitness_profiles SET available_equipment = ARRAY['none'] WHERE user_id = ${ownerId}`;
    } finally {
      await sql`DELETE FROM users WHERE id = ${ownerId}`;
    }
  });

  /** MIGRATION `0028`'s DATA STATEMENTS, read out of the shipped file and run
   *  on the old shapes they exist for — on a TEMPORARY copy of the table, so
   *  this test never locks or alters the live one that other suites are
   *  writing to at the same moment. The copy carries the old `main_goal`
   *  column and none of 0028's CHECKs; its weight-choice CHECK goes on, the
   *  old rows are built, and the three statements run — twice, to prove the
   *  second run finds nothing to do. Then the file's own two list CHECKs go on
   *  over the result. All of it is rolled back. One subject per branch:
   *  weight loss · build muscle, on the list, off it, and beside a Weight Loss
   *  tick (asked, never given a weight choice: RULINGS 2026-09-11) · a goal
   *  that kept the weight, with no list and beside a Weight Loss tick · the old form (no main goal) with
   *  Weight Loss ticked, the same answer as "Lose weight" · a row with nothing
   *  to change · "none" beside equipment, "none" alone, and equipment alone. */
  it("0028 moves every old answer: weight loss to lose, the goals that kept the weight to maintain, Build muscle to asked", async () => {
    const migration = await readFile(new URL("../drizzle/0028_many_goals_and_a_gym.sql", import.meta.url), "utf8");
    const chunks = migration.split("--> statement-breakpoint").map((s) => s.trim());
    const onCopy = (s: string) => s.replaceAll('"user_fitness_profiles"', '"ufp_0028"');
    const moves = chunks.filter((s) => s.includes('UPDATE "user_fitness_profiles"')).map(onCopy);
    if (moves.length !== 3) throw new Error(`0028 no longer holds exactly three data statements (found ${String(moves.length)})`);
    const checks = chunks
      .filter((s) => /ADD CONSTRAINT "user_fitness_profiles_(weight_goal|fitness_goals|available_equipment)_check"/.test(s))
      .map(onCopy);
    const [weightCheck, ...listChecks] = checks;
    if (weightCheck === undefined || listChecks.length !== 2) {
      throw new Error(`0028 no longer adds its three CHECKs (found ${String(checks.length)})`);
    }

    await sql
      .begin(async (tx) => {
        await tx`CREATE TEMP TABLE ufp_0028 (LIKE user_fitness_profiles INCLUDING DEFAULTS) ON COMMIT DROP`;
        await tx`ALTER TABLE ufp_0028 ADD COLUMN main_goal text`;
        await tx.unsafe(weightCheck);
        const person = async (row: {
          mainGoal: string | null;
          goals: string[] | null;
          equipment?: string[];
          target?: number;
          pace?: string;
        }): Promise<string> => {
          const [r] = await tx<{ user_id: string }[]>`
            INSERT INTO ufp_0028 (user_id, main_goal, fitness_goals, available_equipment, target_weight_kg, pace)
            VALUES (gen_random_uuid(), ${row.mainGoal}, ${row.goals}, ${row.equipment ?? null}, ${row.target ?? null}, ${row.pace ?? null})
            RETURNING user_id`;
          if (r === undefined) throw new Error("fixture insert failed");
          return r.user_id;
        };
        const loser = await person({ mainGoal: "weight_loss", goals: ["weight_loss", "flexibility"], target: 65, pace: "steady" });
        const builder = await person({ mainGoal: "muscle_gain", goals: ["muscle_gain", "posture"], target: 75, pace: "steady" });
        const builderOffList = await person({ mainGoal: "muscle_gain", goals: ["posture"] });
        const builderTickedLoss = await person({ mainGoal: "muscle_gain", goals: ["weight_loss", "muscle_gain"] });
        const keeper = await person({ mainGoal: "flexibility", goals: null });
        const keeperTickedLoss = await person({ mainGoal: "flexibility", goals: ["weight_loss"] });
        const oldForm = await person({ mainGoal: null, goals: ["weight_loss", "muscle_gain", "stress_relief"] });
        const settled = await person({ mainGoal: null, goals: ["posture"] });
        const nonePair = await person({ mainGoal: null, goals: null, equipment: ["none", "dumbbells"] });
        const noneAlone = await person({ mainGoal: null, goals: null, equipment: ["none"] });
        const kit = await person({ mainGoal: null, goals: null, equipment: ["dumbbells", "kettlebells"] });

        const stateOf = async (userId: string) => {
          const [r] = await tx<
            {
              weight_goal: string | null;
              fitness_goals: string[] | null;
              available_equipment: string[] | null;
              target_weight_kg: string | null;
              pace: string | null;
            }[]
          >`
            SELECT weight_goal, fitness_goals, available_equipment, target_weight_kg, pace
            FROM ufp_0028 WHERE user_id = ${userId}`;
          return r;
        };
        const expected: [string, Record<string, unknown>][] = [
          [loser, { weight_goal: "lose", fitness_goals: ["flexibility"], target_weight_kg: "65.00", pace: "steady" }],
          // Asked, never given a weight choice; the target and pace stay.
          [builder, { weight_goal: null, fitness_goals: ["muscle_gain", "posture"], target_weight_kg: "75.00", pace: "steady" }],
          [builderOffList, { weight_goal: null, fitness_goals: ["muscle_gain", "posture"] }],
          // The main goal outranks a Weight Loss tick still on the old list.
          [builderTickedLoss, { weight_goal: null, fitness_goals: ["muscle_gain"] }],
          [keeper, { weight_goal: "maintain", fitness_goals: ["flexibility"] }],
          // Here too the main goal outranks the old Weight Loss tick: no calorie cut.
          [keeperTickedLoss, { weight_goal: "maintain", fitness_goals: ["flexibility"] }],
          // Weight Loss ticked on the old form is kept as "Lose weight".
          [oldForm, { weight_goal: "lose", fitness_goals: ["muscle_gain", "stress_relief"] }],
          [settled, { weight_goal: null, fitness_goals: ["posture"] }],
          [nonePair, { available_equipment: ["dumbbells"] }],
          [noneAlone, { available_equipment: ["none"] }],
          [kit, { available_equipment: ["dumbbells", "kettlebells"] }],
        ];
        for (let run = 1; run <= 2; run += 1) {
          for (const statement of moves) await tx.unsafe(statement);
          for (const [userId, state] of expected) expect(await stateOf(userId), `run ${String(run)}: ${userId}`).toMatchObject(state);
        }
        // The two list CHECKs 0028 adds hold over everything its statements left.
        for (const statement of listChecks) await tx.unsafe(statement);
        throw new Error("ROLLBACK-0028-BACKFILL-FIXTURE");
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.message === "ROLLBACK-0028-BACKFILL-FIXTURE") return;
        throw err;
      });
  });

  /** MIGRATION `0027`: BODY WEIGHT HAS NO COPY. `users.weight_kg` is gone, the
   *  history's `source` has its CHECK, and an age under the app's floor is
   *  unanswered — all read back off the deployed catalogue. */
  it("0027 dropped users.weight_kg and checks body_measurements.source", async () => {
    const [col] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'weight_kg'`;
    expect(col?.n, "users.weight_kg still exists").toBe(0);

    const [def] = await sql<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'body_measurements'::regclass AND conname = 'body_measurements_source_check'`;
    if (def === undefined) throw new Error("body_measurements_source_check is not on the table");
    const inCheck = [...def.def.matchAll(/'([^']*)'::text/g)].map((m) => m[1]).sort();
    expect(inCheck).toEqual(["manual", "self_reported"]);

    const [u] = await sql<{ id: string }[]>`
      INSERT INTO users (email, display_name) VALUES ('zz-0027@example.com', 'zz 0027')
      ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`;
    if (u === undefined) throw new Error("fixture user insert failed");
    try {
      // The CHECK bites: a third value is refused, the two known ones are not.
      await expect(
        sql`INSERT INTO body_measurements (user_id, measured_at, source) VALUES (${u.id}, now(), 'imported')`,
      ).rejects.toMatchObject({ code: "23514" });
      await sql`INSERT INTO body_measurements (user_id, measured_at, weight_kg, source) VALUES (${u.id}, now(), 70, 'manual')`;
      await sql`INSERT INTO body_measurements (user_id, measured_at, weight_kg, source) VALUES (${u.id}, now(), 71, 'self_reported')`;
    } finally {
      await sql`DELETE FROM users WHERE id = ${u.id}`;
    }
  });

  /** MIGRATION `0027`'s PART 1 (0026's backfill, run once more before the
   *  column goes) and PART 4 (ages under 16 cleared). The legacy states are
   *  BUILT here — the column is re-added inside a transaction that is rolled
   *  back, since the deployed database no longer has it — and the statements
   *  are run **read out of the shipped file**. The subjects, one per branch of
   *  the two backfill statements plus those that must be left alone: a weight
   *  with no row · a weight with a newer, different row (the column was
   *  written directly after it) · an emptied column over a weighed row (a
   *  clear under the old code) · a weight whose newest row already carries it
   *  (untouched) · two SOFT-DELETED accounts still inside their undo window,
   *  one per statement · a purged tombstone (NULL column, no rows), untouched.
   *  Then the whole thing again, to prove it finds nothing the second time. */
  it("0027's backfill puts a typed row under every weight that had none, and only those; ages under 16 become unanswered", async () => {
    const migration = await readFile(new URL("../drizzle/0027_weight_one_source.sql", import.meta.url), "utf8");
    const chunks = migration.split("--> statement-breakpoint").map((s) => s.trim());
    const backfill = chunks.filter((s) => s.includes('INSERT INTO "body_measurements"'));
    if (backfill.length !== 2) {
      throw new Error(`0027 no longer contains exactly two backfill INSERTs (found ${String(backfill.length)})`);
    }
    const ageClear = chunks.find((s) => s.includes('UPDATE "user_fitness_profiles" SET "age" = NULL'));
    if (ageClear === undefined) throw new Error("0027 no longer clears ages under 16");

    await sql
      .begin(async (tx) => {
        await tx`ALTER TABLE users ADD COLUMN weight_kg numeric(5,2)`;
        const user = async (name: string, weight: number | null, status = "active") => {
          const [u] = await tx<{ id: string }[]>`
            INSERT INTO users (display_name, weight_kg, status) VALUES (${name}, ${weight}, ${status}) RETURNING id`;
          if (u === undefined) throw new Error(`${name} fixture insert failed`);
          return u.id;
        };
        const weighIn = async (userId: string, weight: number | null, at: string) => {
          await tx`
            INSERT INTO body_measurements (user_id, measured_at, weight_kg, metrics, source)
            VALUES (${userId}, ${at}, ${weight}, '{}', 'manual')`;
        };
        const noRow = await user("zz-0027-no-row", 80);
        const differs = await user("zz-0027-differs", 80);
        await weighIn(differs, 82, "2026-05-01T10:00:00Z");
        const emptied = await user("zz-0027-emptied", null);
        await weighIn(emptied, 82, "2026-05-01T10:00:00Z");
        const agrees = await user("zz-0027-agrees", 82);
        await weighIn(agrees, 82, "2026-05-01T10:00:00Z");
        const gone = await user("zz-0027-gone", 80, "deleted");
        await tx`UPDATE users SET deleted_at = now() WHERE id = ${gone}`;
        const goneEmptied = await user("zz-0027-gone-emptied", null, "deleted");
        await tx`UPDATE users SET deleted_at = now() WHERE id = ${goneEmptied}`;
        await weighIn(goneEmptied, 82, "2026-05-01T10:00:00Z");
        const purged = await user("zz-0027-purged", null, "deleted");
        // Part 4's subjects: an age from the old 13-and-over form, and one the app accepts.
        const young = await user("zz-0027-young", null);
        await tx`INSERT INTO user_fitness_profiles (user_id, age) VALUES (${young}, 15)`;
        const adult = await user("zz-0027-adult", null);
        await tx`INSERT INTO user_fitness_profiles (user_id, age) VALUES (${adult}, 16)`;

        const rowsOf = async (userId: string) =>
          tx<{ weight_kg: string | null; source: string; newest: boolean }[]>`
            SELECT weight_kg, source, measured_at > '2026-05-01T10:00:00Z' AS newest
            FROM body_measurements WHERE user_id = ${userId} AND source = 'self_reported'`;
        const ageOf = async (userId: string) =>
          (await tx<{ age: number | null }[]>`SELECT age FROM user_fitness_profiles WHERE user_id = ${userId}`)[0]?.age;

        for (let pass = 1; pass <= 2; pass += 1) {
          for (const s of backfill) await tx.unsafe(s);
          await tx.unsafe(ageClear);
          // Exactly the rows that make the one-source rule true, each the
          // newest thing in that person's history.
          expect(await rowsOf(noRow), `pass ${String(pass)}`).toEqual([{ weight_kg: "80.00", source: "self_reported", newest: true }]);
          expect(await rowsOf(differs), `pass ${String(pass)}`).toEqual([{ weight_kg: "80.00", source: "self_reported", newest: true }]);
          expect(await rowsOf(emptied), `pass ${String(pass)}`).toEqual([{ weight_kg: null, source: "self_reported", newest: true }]);
          expect(await rowsOf(agrees), `pass ${String(pass)}`).toEqual([]);
          expect(await rowsOf(gone), `pass ${String(pass)}`).toEqual([{ weight_kg: "80.00", source: "self_reported", newest: true }]);
          expect(await rowsOf(goneEmptied), `pass ${String(pass)}`).toEqual([{ weight_kg: null, source: "self_reported", newest: true }]);
          expect(await rowsOf(purged), `pass ${String(pass)}`).toEqual([]);
          expect(await ageOf(young), `pass ${String(pass)}`).toBeNull();
          expect(await ageOf(adult), `pass ${String(pass)}`).toBe(16);
        }

        // What the rows are FOR: once the column is gone, the live reader
        // every screen calls returns the number the column held, so nothing
        // vanishes — including for the soft-deleted person once restoreUser
        // brings them back.
        for (const [userId, expected] of [[noRow, 80], [differs, 80], [emptied, null], [agrees, 82], [gone, 80], [goneEmptied, null]] as const) {
          expect(await currentWeightKg(tx, userId), userId).toBe(expected);
        }
        throw new Error("ROLLBACK-0027-BACKFILL-FIXTURE");
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.message === "ROLLBACK-0027-BACKFILL-FIXTURE") return;
        throw err;
      });
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

    /** The seven an owner carried after `0014` and before `0015`.
     *
     *  **WRITTEN OUT RATHER THAN DERIVED FROM `ORG_PRIVILEGES`, and the change
     *  was made deliberately when the ninth privilege landed (:28107).** The
     *  derived version — *every privilege except `billing.manage`* — had two
     *  faults that both grew silently: the fixture row it built became
     *  HISTORICALLY IMPOSSIBLE (a 2026-08-27 owner could not hold
     *  `attendance.read`, minted five days later), and its own length assertion
     *  went on passing because it compared one moving number to another. **A
     *  variable called `legacySeven` holding eight names is :27659's shape — an
     *  instrument overstating what it did.**
     *
     *  This is a statement about WHAT `0015` FOUND when it ran, which is a fact
     *  about the past and cannot drift. Every privilege added since is
     *  irrelevant to it, and the count below is now a real check rather than an
     *  identity. */
    const legacySeven = [
      "members.read",
      "codes.invite",
      "codes.manage",
      "members.confirm",
      "members.remove",
      "staff.manage",
      "org.manage",
    ] as const;
    expect(legacySeven).toHaveLength(7);
    // Every one of them is still a real privilege — the fixture must not drift
    // into naming something the CHECK would refuse.
    for (const p of legacySeven) expect(ORG_PRIVILEGES).toContain(p);

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

  /** THE FOUR CHECKS AND THE UNIQUE READ BACK OUT OF THE DEPLOYED CATALOGUE,
   *  never off the migration file — :20222's lesson. A hand-written migration
   *  that was edited after it was applied, or applied to a database somebody had
   *  already touched, is invisible to a test that reads the `.sql`.
   *
   *  **The exact strings are the assertion.** A CHECK loosened from `> ` to `>=`
   *  or a range widened by one is exactly the class this card names as risk 4
   *  (the touching boundary), and it would leave every other test in the suite
   *  green. */
  it("0017's opening-hours constraints exist on the deployed database", async () => {
    const rows = await sql<{ name: string; def: string }[]>`
      SELECT conname AS name, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid IN ('gym_hours'::regclass, 'gym_closures'::regclass, 'gyms'::regclass)
        AND conname IN ('gym_hours_weekday_check', 'gym_hours_opens_check',
                        'gym_hours_closes_check', 'gym_hours_order_check',
                        'gym_closures_note_len_check', 'gyms_hours_mode_check')
      ORDER BY conname`;
    const byName = new Map(rows.map((r) => [r.name, r.def.replace(/\s+/g, " ")]));

    expect([...byName.keys()].sort()).toEqual([
      "gym_closures_note_len_check",
      "gym_hours_closes_check",
      "gym_hours_opens_check",
      "gym_hours_order_check",
      "gym_hours_weekday_check",
      "gyms_hours_mode_check",
    ]);

    // BOTH BOUNDS ON EVERY RANGE — T3 round 1's Low-8. The first version
    // asserted only the upper halves, so a CHECK loosened at the BOTTOM
    // (`opens_minute >= -600`, an hour before yesterday) stayed green here,
    // which is the exact class this test's own header names as its reason for
    // existing.
    expect(byName.get("gym_hours_weekday_check")).toContain("weekday >= 1");
    expect(byName.get("gym_hours_weekday_check")).toContain("weekday <= 7");
    expect(byName.get("gym_hours_opens_check")).toContain("opens_minute >= 0");
    expect(byName.get("gym_hours_opens_check")).toContain("opens_minute <= 1439");
    expect(byName.get("gym_hours_closes_check")).toContain("closes_minute >= 1");
    expect(byName.get("gym_hours_closes_check")).toContain("closes_minute <= 1440");
    // The strict `>` is what makes a zero-length session impossible; `>=` would
    // admit one and nothing else in the suite would notice.
    expect(byName.get("gym_hours_order_check")).toContain("closes_minute > opens_minute");
    expect(byName.get("gyms_hours_mode_check")).toContain("'unset'");
    expect(byName.get("gyms_hours_mode_check")).toContain("'open_24h'");
    expect(byName.get("gyms_hours_mode_check")).toContain("'scheduled'");

    const uq = await sql<{ def: string }[]>`
      SELECT indexdef AS def FROM pg_indexes
      WHERE tablename = 'gym_closures' AND indexname = 'gym_closures_gym_day_uq'`;
    expect(uq[0]?.def).toContain("UNIQUE");
    expect(uq[0]?.def).toMatch(/\(gym_id, day\)/);
  });

  /** `0019`'s ATTENDANCE CONSTRAINTS, read back off the deployed catalogue like
   *  `0017`'s (:20222) — never off the `.sql`, which says nothing about a
   *  database somebody has already touched.
   *
   *  **`gym_attendance_slot_key_agrees_check` IS THE ONE THAT MATTERS AND IT IS
   *  ASSERTED IN BOTH ARMS.** It is what makes Kd's ruling of 2026-09-01
   *  (:27992 — a second visit in a different session counts again) enforceable
   *  rather than remembered: a writer that sets `slot_key` to a constant
   *  silently reverts every gym to one visit a day, the UNIQUE still holding and
   *  every refusal test still green. A CHECK asserted in one arm only would be
   *  satisfied by a constraint that had lost the other. */
  it("0019's attendance constraints exist on the deployed database", async () => {
    const rows = await sql<{ name: string; def: string }[]>`
      SELECT conname AS name, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'gym_attendance'::regclass
        AND contype = 'c'
      ORDER BY conname`;
    const byName = new Map(rows.map((r) => [r.name, r.def.replace(/\s+/g, " ")]));

    expect([...byName.keys()].sort()).toEqual([
      "gym_attendance_hours_status_check",
      "gym_attendance_method_check",
      "gym_attendance_session_pairing_check",
      "gym_attendance_session_range_check",
      "gym_attendance_slot_key_agrees_check",
    ]);

    // ALL FIVE STATUSES, by name. A vocabulary that lost one would let a reader
    // store a state no screen has words for.
    for (const status of [
      "in_session",
      "open_24h",
      "outside_hours",
      "closed_day",
      "hours_unset",
    ]) {
      expect(byName.get("gym_attendance_hours_status_check")).toContain(`'${status}'`);
    }
    // `qr` is in the vocabulary BEFORE anything can write it (:26469 §4) — the
    // two ways in are stored as different things from day one, and widening a
    // CHECK on a live attendance table later is the migration nobody wants.
    expect(byName.get("gym_attendance_method_check")).toContain("'manual'");
    expect(byName.get("gym_attendance_method_check")).toContain("'qr'");

    // BOTH ARMS OF THE PAIRING: a window is present exactly when the status is
    // `in_session`. One arm alone admits a row that claims a session and names
    // none, which is the reader's whole premise.
    const pairing = byName.get("gym_attendance_session_pairing_check") ?? "";
    expect(pairing).toContain("session_opens_minute IS NOT NULL");
    expect(pairing).toContain("session_opens_minute IS NULL");
    expect(pairing).toContain("session_closes_minute > session_opens_minute");

    // BOTH BOUNDS ON BOTH ENDS — 0017's Low-8 lesson, applied to the copy. A
    // window that cannot hold what `gym_hours` holds is not a copy of it.
    const range = byName.get("gym_attendance_session_range_check") ?? "";
    expect(range).toContain("session_opens_minute >= 0");
    expect(range).toContain("session_opens_minute <= 1439");
    expect(range).toContain("session_closes_minute >= 1");
    expect(range).toContain("session_closes_minute <= 1440");

    // THE SLOT KEY AGREES WITH WHAT IT CLAIMS, in both arms.
    const slot = byName.get("gym_attendance_slot_key_agrees_check") ?? "";
    expect(slot).toContain("slot_key = hours_status");
    expect(slot).toMatch(/session_opens_minute\)?::text/);
    expect(slot).toMatch(/session_closes_minute\)?::text/);

    // THE UNIQUE IS THE RULING: a member, a gym, a DAY and a SLOT. Dropping
    // `slot_key` from it collapses two sessions into one visit; dropping `day`
    // makes a second visit tomorrow impossible.
    const uq = await sql<{ def: string }[]>`
      SELECT indexdef AS def FROM pg_indexes
      WHERE tablename = 'gym_attendance'
        AND indexname = 'gym_attendance_gym_user_day_slot_uq'`;
    expect(uq[0]?.def).toContain("UNIQUE");
    expect(uq[0]?.def).toMatch(/\(gym_id, user_id, day, slot_key\)/);

    // AND THE NINTH PRIVILEGE IS IN THE DDL, not merely in TypeScript. Without
    // this the card compiles, passes every unit test, and 500s the first time an
    // owner ticks the box — the failure the type system cannot see.
    const priv = await sql<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conname = 'gym_staff_privileges_check'`;
    expect(priv[0]?.def).toContain("attendance.read");
  });

  /** `0018`'s CLOCK COLUMN, read back off the deployed catalogue like `0017`'s
   *  (:20222) — never off the `.sql`, which says nothing about a database
   *  somebody has already touched.
   *
   *  **The DEFAULT is the assertion that matters.** Every gym alive on the day
   *  this landed already had its hours drawn on a 24-hour clock, so `24h`
   *  changes nothing anybody is looking at. A default of `12h` would silently
   *  re-render every existing gym's screens — :26736's rule ("nothing is
   *  invented on a gym's behalf") applied to a second column. */
  it("0018's clock column exists, is constrained, and defaults to the clock already on screen", async () => {
    const def = await sql<{ column_default: string | null; is_nullable: string }[]>`
      SELECT column_default, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'gyms' AND column_name = 'clock_format'`;
    expect(def[0]?.column_default).toContain("'24h'");
    expect(def[0]?.is_nullable).toBe('NO');

    const check = await sql<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'gyms'::regclass AND conname = 'gyms_clock_format_check'`;
    const text = check[0]?.def.replace(/\s+/g, ' ');
    expect(text).toContain("'12h'");
    expect(text).toContain("'24h'");

    // A third value is refused AT THE DATABASE, not only by Zod — and the
    // positive control is the pair above being accepted, which the app's own
    // suites drive on every gym they make.
    let refused = false;
    try {
      await sql.begin(async (tx) => {
        await tx`
          INSERT INTO gyms (slug, name, clock_format, owner_user_id)
          VALUES ('zz-clock-check', 'zz clock check', 'am_pm',
                  (SELECT id FROM users LIMIT 1))`;
        throw new Error('ROLLBACK-AFTER-UNEXPECTED-SUCCESS');
      });
    } catch (err) {
      const code = typeof err === 'object' && err !== null && 'code' in err ? err.code : null;
      if (code === '23514') refused = true;
    }
    expect(refused).toBe(true);
  });

  /** `0020` GIVES THE GYM'S DAY SOMEWHERE TO PUT ATTENDANCE, and this test is
   *  the readback :28221 §6 made mandatory: a hand-written migration the
   *  journal does not name is INVISIBLE to `drizzle-kit migrate`, which then
   *  prints *"migrations applied successfully"* having applied nothing. The
   *  failure is silent and GREEN, so the columns are asked of `pg_catalog`
   *  rather than assumed from the presence of a `.sql` file.
   *
   *  **THE DEFAULT IS HONEST ONLY BECAUSE THE TABLE WAS EMPTY.** A `DEFAULT 0`
   *  backfills every existing row with a claim — "nobody came that day" — and
   *  `org_daily_stats` had NO WRITER at all before this card, so the claim is
   *  about no rows. That is asserted rather than remembered: any row that
   *  predated the migration would carry a fabricated zero. */
  it("0020's visit columns exist on the deployed database and invented no history", async () => {
    const cols = await sql<
      { column_name: string; data_type: string; is_nullable: string; column_default: string | null }[]
    >`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'org_daily_stats' AND column_name IN ('visits', 'visitors')
      ORDER BY column_name`;
    expect(cols.map((c) => c.column_name)).toEqual(["visitors", "visits"]);
    for (const col of cols) {
      expect(col.data_type).toBe("integer");
      expect(col.is_nullable).toBe("NO");
      expect(col.column_default).toBe("0");
    }

    // The rollup writes `visits`/`visitors` and leaves `avg_form_score` NULL for
    // a day nobody was graded on — so a row whose scored_sets is 0 must not be
    // carrying a fabricated 0.0 average. Asserted over whatever the suite finds
    // rather than over a fixture: this is a guarantee about the WRITER, and a
    // row written by any other means would break it just as badly.
    const fabricated = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM org_daily_stats
      WHERE scored_sets = 0 AND avg_form_score IS NOT NULL`;
    expect(fabricated[0]?.n).toBe(0);

    // POSITIVE CONTROL, AND WITHOUT IT THE ASSERTION ABOVE IS VACUOUS.
    // `org_daily_stats` is empty outside the overview suite and its only writer
    // cleans up after itself, so that count runs over ZERO ROWS and is green
    // whatever the writer does — a test whose verdict depends on which suite
    // happens to be mid-run (:26947 §2's class: a name wider than its query).
    // A violating row is planted inside a rolled-back transaction to prove the
    // query can actually see one.
    let sawViolation = false;
    try {
      await sql.begin(async (tx) => {
        await tx`
          INSERT INTO gyms (slug, name, owner_user_id)
          VALUES ('zz-ods-fabricated', 'zz ods fabricated', (SELECT id FROM users LIMIT 1))`;
        // EVERY WORKOUT-SIDE COLUMN IS NOT NULL WITH NO DEFAULT, and omitting
        // them refuses the row with a 23502 that this `catch` would have
        // swallowed into a silent `false`. Only `visits`/`visitors` default,
        // because `0020` added them to a table that already had rows to answer
        // for. The fixture was wrong about the product and the database said so.
        await tx`
          INSERT INTO org_daily_stats
            (gym_id, day, active_members, workouts, sets, total_reps, minutes,
             scored_sets, avg_form_score, new_members, removed_members)
          VALUES ((SELECT id FROM gyms WHERE slug = 'zz-ods-fabricated'),
                  DATE '2020-01-01', 0, 0, 0, 0, 0, 0, 42.0, 0, 0)`;
        const seen = await tx<{ n: number }[]>`
          SELECT count(*)::int AS n FROM org_daily_stats
          WHERE scored_sets = 0 AND avg_form_score IS NOT NULL`;
        sawViolation = (seen[0]?.n ?? 0) === 1;
        throw new Error("ROLLBACK");
      });
    } catch {
      /* rolled back on purpose */
    }
    expect(sawViolation).toBe(true);
  });

  /** `hours_mode` DEFAULTS TO `unset` AND NOTHING BACKFILLED IT — :26736's rule
   *  made checkable. A migration that helpfully wrote `'scheduled'` onto
   *  existing rows, or a DDL default of anything else, is how every gym in the
   *  database starts telling its members it is closed. */
  it("0017 leaves every existing gym saying nothing about its hours", async () => {
    const def = await sql<{ column_default: string | null; is_nullable: string }[]>`
      SELECT column_default, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'gyms' AND column_name = 'hours_mode'`;
    expect(def[0]?.column_default).toContain("'unset'");
    expect(def[0]?.is_nullable).toBe("NO");

    /** **THE MIGRATION FILE ITSELF CONTAINS NO WRITE, and this is the assertion
     *  that actually carries the guarantee — T3 round 1's Low-3.**
     *
     *  The live-data check below used to be the whole test, and it observed only
     *  `scheduled`-with-no-rows. **A migration that back-filled `open_24h` onto
     *  all 112 gyms — telling every member their gym never closes, which is
     *  :26736's falsehood in its loudest form — left it GREEN**, and so did the
     *  `column_default` assertion above, since a DDL default of `'unset'` plus a
     *  separate `UPDATE` satisfies both. The test's name claimed the guarantee;
     *  its query checked a corner of it.
     *
     *  Reading the shipped artefact is the same standard `pg_get_constraintdef`
     *  holds above, and unlike a live count it cannot be weakened by whatever
     *  else is in a shared database. */
    const sqlText = await readFile(
      new URL("../drizzle/0017_gym_hours.sql", import.meta.url),
      "utf8",
    );
    const statements = sqlText
      .split("--> statement-breakpoint")
      .map((chunk) =>
        chunk
          .split("\n")
          .filter((line) => !line.trimStart().startsWith("--"))
          .join("\n")
          .trim(),
      )
      .filter((chunk) => chunk.length > 0);
    expect(statements.length).toBeGreaterThan(0); // the split still yields something
    for (const statement of statements) {
      // ANCHORED AT THE START OF THE STATEMENT, not "contains the word". The
      // first version matched `ON DELETE cascade` inside the two foreign-key
      // ALTERs and failed on correct DDL — a guard that cries wolf gets deleted
      // by the next person, which is worse than not having it. A row-writing
      // statement BEGINS with its verb.
      expect(statement, "0017 must not write a row").not.toMatch(/^\s*(UPDATE|INSERT|DELETE)\b/i);
    }
    // The positive control for the anchor above: this migration DOES contain
    // `ON DELETE cascade`, so a naive "contains the word" check would be
    // satisfied by the wrong thing, and a future edit that loosened the regex
    // back would go unnoticed without this line.
    expect(sqlText).toMatch(/ON DELETE cascade/i);

    // AND THE LIVE HALF, now stated as the guarantee rather than a corner of it:
    // no gym holds a mode it was not given BY A PERSON — every real change goes
    // through `setGymHours`, which writes `org.hours_set` in the same
    // transaction. Scoped this way rather than as a whole-table count so a
    // sibling suite's own gyms cannot turn it red (:23128's shape); the hours
    // suite resets `hours_mode` before it deletes anything, so no teardown
    // window can violate it either.
    const invented = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n
      FROM gyms g
      WHERE g.hours_mode <> 'unset'
        AND NOT EXISTS (
          SELECT 1 FROM audit_log a
          WHERE a.gym_id = g.id AND a.action = 'org.hours_set'
        )`;
    expect(invented[0]?.n).toBe(0);
  });
});
