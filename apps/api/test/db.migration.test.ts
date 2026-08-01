// P0.3 migration/seed proof (runs against a real Postgres — Neon branch).
// Requires DATABASE_URL pointing at a database that has had `pnpm --filter api
// migrate` applied. Skips visibly when unset so unit CI stays green; the
// migration CI job / local Neon-branch run is where this executes.
import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { seed } from "../src/db/seed.js";

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
  it("seed is idempotent and matches the Part 5 §1 price book", { timeout: 120_000 }, async () => {
    await seed(url ?? "");
    const first = await sql`SELECT count(*)::int AS n FROM plans`;
    await seed(url ?? "");
    const second = await sql`SELECT count(*)::int AS n FROM plans`;
    expect(second[0]?.["n"]).toBe(first[0]?.["n"]);

    const book = await sql`
      SELECT code, price_minor, currency, "interval", seat_cap, rank
      FROM plans ORDER BY code`;
    const byCode = new Map(book.map((r) => [r["code"] as string, r]));
    const expectPrice = (code: string, minor: number, cur: string): void => {
      const row = byCode.get(code);
      expect(row, `missing plan ${code}`).toBeDefined();
      expect(row?.["price_minor"]).toBe(minor);
      expect(row?.["currency"]).toBe(cur);
    };
    expectPrice("free", 0, "INR");
    expectPrice("pro_in_m", 14900, "INR");
    expectPrice("pro_in_y", 99900, "INR");
    expectPrice("pro_us_m", 399, "USD");
    expectPrice("pro_us_y", 2999, "USD");
    expectPrice("org_micro", 99900, "INR");
    expectPrice("org_micro_clinic", 149900, "INR");
    expectPrice("org_starter", 149900, "INR");
    expectPrice("org_standard", 199900, "INR");
    expectPrice("org_growth", 349900, "INR");
    expectPrice("org_scale", 499900, "INR");
    expect(byCode.get("free")?.["rank"]).toBe(0);
    expect(byCode.get("pro_in_m")?.["rank"]).toBe(10);
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
});
