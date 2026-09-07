// Part 4 §5.2 Day-14 hard delete, against REAL Postgres (R9.2 — no SQL mocks).
// DATABASE_URL-gated; requires migrations 0001-0007 applied and seed.ts run
// (exercises + achievements are FK targets).
//
// This is the only code in the repo that irreversibly destroys user data, so
// the suite is weighted toward proving who is NOT touched: the 13-day user,
// the restored user, and the bystander whose every table is asserted intact
// one by one. "It deleted the right rows" is the easy half.
//
// ⚠ READ BEFORE POINTING THIS AT A DATABASE YOU CARE ABOUT.
// purgeDueUsers() selects EVERY account past the window — that is the
// product behaviour, not a test shortcut — so running this suite purges any
// due soft-deleted account in the target DB, not only its own fixtures.
// Observed on the dev Neon branch 2026-07-22: the first green run purged 8
// pre-existing soft-deleted rows, all @example.com fixtures left by earlier
// suites. Harmless there, and irrelevant on prod (which starts EMPTY, and
// where the worker does this on a schedule anyway) — but a suite that
// silently destroys data outside its own fixtures must say so out loud.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { purgeDueUsers, purgeUser } from "../src/modules/privacy/purge.js";
import { lockDueUserForPurge, recordPurge } from "../src/modules/privacy/repo.js";
import {
  ADDRESS_KEYED_PURGE_TABLES,
  CASCADE_COLLECTED_TABLES,
  DIRECT_DELETE_TABLES,
  PII_TABLES,
  USER_LINKED_NOT_PURGED_TABLES,
} from "../src/modules/privacy/tables.js";
import { DPDP_RETENTION_DAYS } from "../src/retention.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const DAY_MS = 24 * 60 * 60 * 1000;

// Fixture identifiers must be unique per run (the suite re-runs against the
// same Neon branch) and `users.email` is UNIQUE.
let seq = 0;
const uniq = (): string => `${String(Date.now())}-${String(seq++)}`;
const uniqEmail = (prefix: string): string => `${prefix}-${uniq()}@example.com`;

/** Structural match for FastifyBaseLogger — the worker passes the real pino
 *  logger; the tests pass this. No `as` cast anywhere (R2.2). */
interface TestLogger {
  lines: { level: string; obj: Record<string, unknown> }[];
  info(o: object, m?: string): void;
  warn(o: object, m?: string): void;
  error(o: object, m?: string): void;
}

function testLogger(): TestLogger {
  const lines: { level: string; obj: Record<string, unknown> }[] = [];
  const push = (level: string) => (o: object) => {
    lines.push({ level, obj: { ...o } });
  };
  return { lines, info: push("info"), warn: push("warn"), error: push("error") };
}

/** Did a run emit this event anywhere? The warn/error paths are behaviour and
 *  were shipped untested through rounds 1-2, which is how their findings
 *  survived (R9). */
const anyEvent = (log: TestLogger, event: string): boolean =>
  log.lines.some((l) => l.obj["event"] === event);

d("DPDP Day-14 purge (real Postgres)", () => {
  const sql = postgres(url ?? "", { max: 4 });
  let exerciseId = "";
  let challengeId = "";
  const madeUsers: string[] = [];
  const madeEmails: string[] = [];

  beforeAll(async () => {
    const ex = await sql<{ id: string }[]>`SELECT id FROM exercises WHERE slug = 'squat' LIMIT 1`;
    const found = ex[0];
    if (found === undefined) throw new Error("seed.ts must run first (exercises)");
    exerciseId = found.id;
    // challenges is NOT seeded (verified 2026-07-22) — challenge_participants
    // needs a parent, so the fixture makes its own.
    const ch = await sql<{ id: string }[]>`
      INSERT INTO challenges (scope, template_code, starts_on, ends_on)
      VALUES ('global', 'dpdp_test_fixture', current_date, current_date + 7)
      RETURNING id`;
    challengeId = ch[0]?.id ?? "";
  });

  afterAll(async () => {
    // Fixtures only: never a blanket DELETE.
    if (madeUsers.length > 0) {
      await sql`DELETE FROM audit_log WHERE target_id = ANY(${madeUsers})`;
      await sql`DELETE FROM leaderboard_snapshots WHERE board LIKE 'dpdp_test_%'`;
      for (const t of DIRECT_DELETE_TABLES) {
        await sql`DELETE FROM ${sql(t)} WHERE user_id = ANY(${madeUsers})`;
      }
      await sql`DELETE FROM sign_in_codes WHERE email = ANY(${madeEmails})`;
      await sql`DELETE FROM users WHERE id = ANY(${madeUsers})`;
    }
    if (challengeId !== "") await sql`DELETE FROM challenges WHERE id = ${challengeId}`;
    await sql.end();
  });

  /** A user plus one row in every table §5.2 requires to be gone.
   *  `deletedDaysAgo: null` = an active account. */
  async function makeUser(
    email: string,
    deletedDaysAgo: number | null,
  ): Promise<{ userId: string; mealCorrectionId: string; coachMessageId: string }> {
    const deletedAt = deletedDaysAgo === null ? null : new Date(Date.now() - deletedDaysAgo * DAY_MS);
    const status = deletedDaysAgo === null ? "active" : "deleted";
    const rows = await sql<{ id: string }[]>`
      INSERT INTO users (email, display_name, weight_kg, status, deleted_at)
      VALUES (${email}, 'Fixture Person', 72.50, ${status}, ${deletedAt})
      RETURNING id`;
    const userId = rows[0]?.id ?? "";
    madeUsers.push(userId);
    madeEmails.push(email);

    // Keyed on the ADDRESS, not the id, and with no foreign key — the table
    // the FK walk below cannot see (tables.ts, ADDRESS_KEYED_PURGE_TABLES).
    await sql`INSERT INTO sign_in_codes (email, purpose, code_hash, expires_at)
              VALUES (${email}, 'sign_in', ${"h-" + userId}, now() + interval '10 minutes')`;
    await sql`INSERT INTO auth_identities (user_id, provider, subject)
              VALUES (${userId}, 'google', ${"sub-" + userId})`;
    await sql`INSERT INTO user_fitness_profiles (user_id, age, gender, height_cm, medical_conditions)
              VALUES (${userId}, 31, 'female', 165, 'fixture: asthma')`;
    // workouts.id and runs.id have NO default — they are client-generated by
    // design (Part 4 §1: "client-generated only where the spec says").
    const w = await sql<{ id: string }[]>`
      INSERT INTO workouts (id, user_id, started_at, platform, engine_version)
      VALUES (gen_random_uuid(), ${userId}, now(), 'web', '1.0.0') RETURNING id`;
    const workoutId = w[0]?.id ?? "";
    await sql`INSERT INTO workout_sets
              (workout_id, user_id, exercise_id, started_at, set_index, duration_ms,
               engine_version, definition_version)
              VALUES (${workoutId}, ${userId}, ${exerciseId}, now(), 0, 60000, '1.0.0', 1)`;
    await sql`INSERT INTO workout_templates (user_id, name, items)
              VALUES (${userId}, 'Fixture template', ${sql.json([])})`;
    await sql`INSERT INTO body_measurements (user_id, measured_at, weight_kg)
              VALUES (${userId}, now(), 72.50)`;
    const meal = await sql<{ id: string }[]>`
      INSERT INTO meal_logs (user_id, taken_at, items, kcal_point, kcal_low, kcal_high,
                             portion_source, nutrition_sources, calc_version)
      VALUES (${userId}, now(), ${sql.json([])}, 300, 250, 350, 'default',
              ${sql.array(["curated"])}, 1)
      RETURNING id`;
    const mealId = meal[0]?.id ?? "";
    const corr = await sql<{ id: string }[]>`
      INSERT INTO meal_log_corrections (meal_log_id, field, original, corrected)
      VALUES (${mealId}, 'grams', ${sql.json({ g: 100 })}, ${sql.json({ g: 120 })})
      RETURNING id`;
    await sql`INSERT INTO user_dishware (user_id, label, container_class, volume_ml)
              VALUES (${userId}, 'Fixture katori', 'katori', 175)`;
    const th = await sql<{ id: string }[]>`
      INSERT INTO coach_threads (user_id, title) VALUES (${userId}, 'Fixture thread')
      RETURNING id`;
    const threadId = th[0]?.id ?? "";
    const msg = await sql<{ id: string }[]>`
      INSERT INTO coach_messages (thread_id, role, content)
      VALUES (${threadId}, 'user', 'fixture question') RETURNING id`;
    await sql`INSERT INTO runs (id, user_id, started_at, duration_s, distance_m)
              VALUES (gen_random_uuid(), ${userId}, now(), 1800, 5000)`;
    await sql`INSERT INTO saved_routes (user_id, name, polyline, distance_m)
              VALUES (${userId}, 'Fixture route', 'abc123', 5000)`;
    await sql`INSERT INTO run_schedules (user_id, rule) VALUES (${userId}, ${sql.json({})})`;
    await sql`INSERT INTO user_achievements (user_id, code) VALUES (${userId}, 'first_workout')`;
    await sql`INSERT INTO streaks (user_id, current, longest) VALUES (${userId}, 3, 5)`;
    await sql`INSERT INTO user_xp (user_id, total_xp) VALUES (${userId}, 123)`;
    await sql`INSERT INTO challenge_participants (challenge_id, user_id)
              VALUES (${challengeId}, ${userId})`;
    // Day 0 deletes push tokens; this row stands in for one that outlived it
    // (a failed Day-0 write, or a later writer) — T3 F5.
    await sql`INSERT INTO push_tokens (user_id, token, platform)
              VALUES (${userId}, ${"tok-" + userId}, 'android')`;

    return {
      userId,
      mealCorrectionId: corr[0]?.id ?? "",
      coachMessageId: msg[0]?.id ?? "",
    };
  }

  // Every PII table that carries a user_id column, so emptiness can be
  // asserted by owner regardless of whether the row is deleted directly or
  // by cascade. workout_sets is cascade-collected (F6) but keeps a
  // denormalised user_id, so it is checkable here too; the two truly
  // ownerless tables (meal_log_corrections, coach_messages) are checked by
  // seeded id in the test.
  const USER_ID_TABLES = [...DIRECT_DELETE_TABLES, "workout_sets"] as const;

  /** Rows still held for this user in each user-keyed table. */
  async function directCounts(userId: string): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const t of USER_ID_TABLES) {
      const r = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM ${sql(t)} WHERE user_id = ${userId}`;
      out[t] = r[0]?.n ?? -1;
    }
    return out;
  }

  const run = (opts: { now?: Date; dryRun?: boolean; limit?: number } = {}) =>
    purgeDueUsers({ sql, log: testLogger() }, opts);

  /** Same run, but the log is inspectable — the warn paths are behaviour. */
  async function runLogged(opts: { limit?: number } = {}) {
    const log = testLogger();
    const result = await purgeDueUsers({ sql, log }, opts);
    return { result, log };
  }

  const markersFor = async (userId: string): Promise<number> =>
    (
      await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM audit_log
        WHERE action = 'user.purged' AND target_id = ${userId}`
    )[0]?.n ?? -1;

  it("purges at the window and NOT before (fake clock)", { timeout: 60_000 }, async () => {
    const early = await makeUser(uniqEmail("dpdp-early"), 13);
    const due = await makeUser(uniqEmail("dpdp-due"), DPDP_RETENTION_DAYS);
    const old = await makeUser(uniqEmail("dpdp-old"), 20);

    await run();

    expect((await directCounts(early.userId))["streaks"]).toBe(1);
    expect((await directCounts(due.userId))["streaks"]).toBe(0);
    expect((await directCounts(old.userId))["streaks"]).toBe(0);
  });

  it("leaves NO row in any §5.2 table, cascades included", { timeout: 60_000 }, async () => {
    const u = await makeUser(uniqEmail("dpdp-all"), 20);

    // Every table starts populated — otherwise a green test proves nothing.
    const before = await directCounts(u.userId);
    for (const t of USER_ID_TABLES) expect({ t, n: before[t] }).toEqual({ t, n: 1 });

    await run();

    const after = await directCounts(u.userId);
    for (const t of USER_ID_TABLES) expect({ t, n: after[t] }).toEqual({ t, n: 0 });

    // The two cascade-collected tables carry no user_id, so they are checked
    // by the exact row id seeded for this user.
    const corr = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM meal_log_corrections WHERE id = ${u.mealCorrectionId}`;
    const msg = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM coach_messages WHERE id = ${u.coachMessageId}`;
    expect({ corrections: corr[0]?.n, messages: msg[0]?.n }).toEqual({ corrections: 0, messages: 0 });

    // Guard: the assertion above must cover the whole compliance list.
    expect(PII_TABLES.length).toBe(DIRECT_DELETE_TABLES.length + CASCADE_COLLECTED_TABLES.length);
  });

  it("removes the ADDRESS from every address-keyed table, before the tombstone nulls it", { timeout: 60_000 }, async () => {
    // sign_in_codes holds the email with no user_id and no FK, so the id-keyed
    // purge and the FK walk both miss it on their own, and §5.2's whole point
    // at Day 14 is that the address is gone.
    const email = uniqEmail("dpdp-addr");
    const u = await makeUser(email, 20);
    const bystanderEmail = uniqEmail("dpdp-addr-bystander");
    const bystander = await makeUser(bystanderEmail, 1);

    for (const t of ADDRESS_KEYED_PURGE_TABLES) {
      const before = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM ${sql(t)} WHERE email = ${email}`;
      expect({ t, n: before[0]?.n }).toEqual({ t, n: 1 });
    }

    await run();

    for (const t of ADDRESS_KEYED_PURGE_TABLES) {
      const after = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM ${sql(t)} WHERE email = ${email}`;
      expect({ t, n: after[0]?.n }).toEqual({ t, n: 0 });
      const kept = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM ${sql(t)} WHERE email = ${bystanderEmail}`;
      expect({ t, bystander: kept[0]?.n }).toEqual({ t, bystander: 1 });
    }
    expect((await directCounts(u.userId))["streaks"]).toBe(0);
    expect((await directCounts(bystander.userId))["streaks"]).toBe(1);
  });

  it("anonymizes the users row to a tombstone and KEEPS it", { timeout: 60_000 }, async () => {
    const u = await makeUser(uniqEmail("dpdp-tomb"), 20);
    await run();
    const row = (
      await sql<
        { email: string | null; display_name: string; weight_kg: string | null; status: string }[]
      >`SELECT email, display_name, weight_kg, status FROM users WHERE id = ${u.userId}`
    )[0];
    expect(row).toEqual({
      email: null,
      display_name: "Deleted user",
      weight_kg: null,
      status: "deleted",
    });
  });

  it("tombstones TWO users in one run (multiple NULL emails)", { timeout: 60_000 }, async () => {
    // users.email is UNIQUE. Postgres permits many NULLs under a unique
    // constraint; if that were ever not true, the second purge in a batch
    // would fail and this is the test that says so.
    const a = await makeUser(uniqEmail("dpdp-two-a"), 20);
    const b = await makeUser(uniqEmail("dpdp-two-b"), 20);
    const res = await run();
    expect(res.errors).toBe(0);
    const rows = await sql<{ email: string | null }[]>`
      SELECT email FROM users WHERE id IN (${a.userId}, ${b.userId})`;
    expect(rows.map((r) => r.email)).toEqual([null, null]);
  });

  it("purging one user leaves a bystander's every table intact", { timeout: 60_000 }, async () => {
    // The tenancy proof for a batch mutation — this job has no HTTP surface,
    // so this IS its cross-tenant denial case (R3.2/R9.2).
    const victim = await makeUser(uniqEmail("dpdp-victim"), 20);
    const bystander = await makeUser(uniqEmail("dpdp-bystander"), 1);

    await run();

    const left = await directCounts(bystander.userId);
    for (const t of DIRECT_DELETE_TABLES) expect({ t, n: left[t] }).toEqual({ t, n: 1 });
    const msg = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM coach_messages WHERE id = ${bystander.coachMessageId}`;
    expect(msg[0]?.n).toBe(1);
    const still = (
      await sql<{ email: string | null }[]>`SELECT email FROM users WHERE id = ${bystander.userId}`
    )[0];
    expect(still?.email).not.toBeNull();
    expect((await directCounts(victim.userId))["streaks"]).toBe(0);
  });

  it("is idempotent: a second run purges nobody again", { timeout: 60_000 }, async () => {
    const u = await makeUser(uniqEmail("dpdp-idem"), 20);
    const first = await run();
    expect(first.purged).toBeGreaterThanOrEqual(1);
    const second = await run();
    expect({ purged: second.purged, errors: second.errors }).toEqual({ purged: 0, errors: 0 });
    const marks = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM audit_log
      WHERE action = 'user.purged' AND target_id = ${u.userId}`;
    expect(marks[0]?.n).toBe(1);
  });

  it(
    "scrubs display_name for the purged user only, EVERY matching element",
    { timeout: 60_000 },
    async () => {
      const victim = await makeUser(uniqEmail("dpdp-lb-v"), 20);
      const other = await makeUser(uniqEmail("dpdp-lb-o"), 1);
      const board = `dpdp_test_${uniq()}`;
      // The victim appears TWICE (two boards/periods folded into one snapshot).
      // Round 2's DETECTOR counted rows, not elements, so a second surviving
      // element read as clean (F2). The scrub is element-wise, so both go.
      await sql`
        INSERT INTO leaderboard_snapshots (board, period, entries)
        VALUES (${board}, '2026-07', ${sql.json([
          { user_id: victim.userId, display_name: "Victim Name", value: 90, rank: 1 },
          { user_id: other.userId, display_name: "Other Name", value: 80, rank: 2 },
          { user_id: victim.userId, display_name: "Victim Again", value: 70, rank: 3 },
        ])})`;

      await run();

      const snap = (
        await sql<{ entries: { user_id: string; display_name: string; rank: number }[] }[]>`
          SELECT entries FROM leaderboard_snapshots WHERE board = ${board}`
      )[0];
      expect(snap?.entries).toEqual([
        { user_id: victim.userId, display_name: "Deleted user", value: 90, rank: 1 },
        { user_id: other.userId, display_name: "Other Name", value: 80, rank: 2 },
        { user_id: victim.userId, display_name: "Deleted user", value: 70, rank: 3 },
      ]);
    },
  );

  // T3 round 3, F1/F2/F5 — the class, not the case. Rounds 1-3 each tried a
  // per-user TEXT heuristic to answer "did any name survive?" and each was
  // defeated by the next shape. The redesign asks the DECIDABLE structural
  // question "is every snapshot the documented shape?" once per run; any
  // other shape is drift → fail-closed (no markers) + a loud run failure.
  // Parameterised over the exact shapes that beat the previous rounds.
  for (const [label, entries] of [
    ["array with a foreign name key (userId/displayName)", [{ userId: "X", displayName: "N" }]],
    ["a non-array object with a nested name", { note: "rebuilt", rows: [{ display_name: "N" }] }],
  ] as const) {
    it(`a snapshot in a shape the scrub cannot certify (${label}) fails the run closed`, {
      timeout: 60_000,
    }, async () => {
      const u = await makeUser(uniqEmail("dpdp-drift"), 20);
      const board = `dpdp_test_${uniq()}`;
      await sql`INSERT INTO leaderboard_snapshots (board, period, entries)
                VALUES (${board}, '2026-07', ${sql.json(entries)})`;

      const { result, log } = await runLogged();

      // The run cannot certify: drift detected, loudly, and NO marker written.
      expect(result.schemaDriftSnapshots).toBeGreaterThanOrEqual(1);
      expect(anyEvent(log, "dpdp.purge.schema_drift")).toBe(true);
      expect(result.purged).toBe(0);
      expect(await markersFor(u.userId)).toBe(0);
      // Fail-closed does NOT mean fail-to-erase: the data is still destroyed.
      expect((await directCounts(u.userId))["streaks"]).toBe(0);
      // And the user is still due next run — a persistent loud failure until
      // the P4 scrub is fixed, never a silent write-off.
      const second = await runLogged();
      expect(second.result.schemaDriftSnapshots).toBeGreaterThanOrEqual(1);

      await sql`DELETE FROM leaderboard_snapshots WHERE board = ${board}`;
    });
  }

  it("empty and other-user-only snapshots are NOT drift", { timeout: 60_000 }, async () => {
    const u = await makeUser(uniqEmail("dpdp-nodrift"), 20);
    const b1 = `dpdp_test_${uniq()}`;
    const b2 = `dpdp_test_${uniq()}`;
    await sql`INSERT INTO leaderboard_snapshots (board, period, entries)
              VALUES (${b1}, '2026-07', ${sql.json([])}),
                     (${b2}, '2026-07', ${sql.json([{ user_id: "someone-else", display_name: "N", value: 1, rank: 1 }])})`;
    const { result } = await runLogged();
    expect(result.schemaDriftSnapshots).toBe(0);
    expect(await markersFor(u.userId)).toBe(1);
    await sql`DELETE FROM leaderboard_snapshots WHERE board IN (${b1}, ${b2})`;
  });

  // T3 round 3, F6 — the standalone workout_sets delete was cross-tenant.
  it("does NOT delete a set whose workout belongs to another, active user", {
    timeout: 60_000,
  }, async () => {
    const victim = await makeUser(uniqEmail("dpdp-f6-v"), 20);
    const bystander = await makeUser(uniqEmail("dpdp-f6-b"), null); // active
    // A set inside the BYSTANDER's workout, but carrying the victim's id in
    // its denormalised user_id column — the exact poison row round 3 probed.
    const wId = randomUUID();
    await sql`INSERT INTO workouts (id, user_id, started_at, platform, engine_version)
              VALUES (${wId}, ${bystander.userId}, now(), 'web', '1.0.0')`;
    await sql`INSERT INTO workout_sets
              (workout_id, user_id, exercise_id, started_at, set_index, duration_ms,
               engine_version, definition_version)
              VALUES (${wId}, ${victim.userId}, ${exerciseId}, now(), 0, 1, '1.0.0', 1)`;

    await run();

    const survived = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM workout_sets WHERE workout_id = ${wId}`;
    expect(survived[0]?.n).toBe(1); // the bystander's set is untouched
    // and the victim's own data is gone
    expect((await directCounts(victim.userId))["streaks"]).toBe(0);

    await sql`DELETE FROM workout_sets WHERE workout_id = ${wId}`;
    await sql`DELETE FROM workouts WHERE id = ${wId}`;
  });

  // T3 round 4, F3/V1 — the concurrency guard, contended by TWO LIVE
  // transactions, not replayed sequentially. Round 3's test ran the second
  // attempt AFTER the first had committed (the easy post-commit path), which
  // is exactly why a guard that fails a true race passed it. This drives the
  // race: A locks the users row and holds it; B's guard blocks on that lock;
  // A writes the marker and commits; B unblocks and MUST see the marker and
  // return "skipped" — so exactly one marker exists. Reproduced on Neon that
  // the single-statement guard writes TWO here; the two-statement guard, one.
  it("two concurrent runners write exactly ONE marker (real race)", {
    timeout: 60_000,
  }, async () => {
    const u = await makeUser(uniqEmail("dpdp-race"), 20);
    const cutoff = new Date(Date.now() - DPDP_RETENTION_DAYS * 24 * 60 * 60 * 1000);

    const cA = await sql.reserve();
    const cB = await sql.reserve();
    try {
      await cA`begin`;
      await cB`begin`;

      // A takes the lock and (would) purge — guard true, marker not yet committed.
      const aProceed = await lockDueUserForPurge(cA, u.userId, cutoff);
      expect(aProceed).toBe(true);

      // B's guard starts now and BLOCKS on A's row lock — do not await yet.
      const bProceedP = lockDueUserForPurge(cB, u.userId, cutoff);

      // A commits its marker while B is blocked.
      await recordPurge(cA, u.userId, { deletedAt: new Date(), retentionDays: DPDP_RETENTION_DAYS });
      await cA`commit`;

      // B unblocks; the fresh-snapshot marker check must now see A's marker.
      const bProceed = await bProceedP;
      expect(bProceed).toBe(false);
      if (bProceed) {
        await recordPurge(cB, u.userId, { deletedAt: new Date(), retentionDays: DPDP_RETENTION_DAYS });
      }
      await cB`commit`;
    } finally {
      cA.release();
      cB.release();
    }

    expect(await markersFor(u.userId)).toBe(1);
  });

  // The guard also skips a user already fully purged in a prior run, and a
  // restored one — the ordinary (non-race) paths, kept as their own case.
  it("the guard skips an already-purged or restored user", { timeout: 60_000 }, async () => {
    const purged = await makeUser(uniqEmail("dpdp-done"), 20);
    await run();
    expect(await markersFor(purged.userId)).toBe(1);
    const cutoff = new Date(Date.now() - DPDP_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    expect(await sql.begin((tx) => purgeUser(tx, purged.userId, cutoff))).toBe("skipped");
    expect(await markersFor(purged.userId)).toBe(1);

    const restored = await makeUser(uniqEmail("dpdp-back"), 20);
    await sql`UPDATE users SET status = 'active', deleted_at = NULL WHERE id = ${restored.userId}`;
    expect(await sql.begin((tx) => purgeUser(tx, restored.userId, cutoff))).toBe("skipped");
  });

  it("warns when a batch comes back full", { timeout: 60_000 }, async () => {
    await makeUser(uniqEmail("dpdp-batch"), 20);
    const { log } = await runLogged({ limit: 1 });
    expect(anyEvent(log, "dpdp.purge.batch_full")).toBe(true);
  });

  it("never purges an account restored inside the window", { timeout: 60_000 }, async () => {
    const u = await makeUser(uniqEmail("dpdp-restored"), 20);
    // What restoreUser does: status back to active, deleted_at cleared.
    await sql`UPDATE users SET status = 'active', deleted_at = NULL WHERE id = ${u.userId}`;
    await run();
    expect((await directCounts(u.userId))["streaks"]).toBe(1);
  });

  it("dry run reports the work and writes nothing", { timeout: 60_000 }, async () => {
    const u = await makeUser(uniqEmail("dpdp-dry"), 20);
    const res = await run({ dryRun: true });
    expect(res.dryRun).toBe(true);
    expect(res.scanned).toBeGreaterThanOrEqual(1);
    expect(res.purged).toBe(0);
    expect((await directCounts(u.userId))["streaks"]).toBe(1);
    const marks = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM audit_log
      WHERE action = 'user.purged' AND target_id = ${u.userId}`;
    expect(marks[0]?.n).toBe(0);
  });

  it("one failing user does not stop the others", { timeout: 60_000 }, async () => {
    const bad = await makeUser(uniqEmail("dpdp-bad"), 20);
    const good = await makeUser(uniqEmail("dpdp-good"), 20);
    const res = await purgeDueUsers(
      {
        sql,
        log: testLogger(),
        // Test-only seam (the buildApp overrides precedent): the loop's error
        // isolation is the behaviour under test, and no FK in the schema can
        // block a delete (verified), so a real failure has to be injected.
        purgeOne: async (tx, userId, cutoff) => {
          if (userId === bad.userId) throw new Error("injected failure");
          return await purgeUser(tx, userId, cutoff);
        },
      },
      {},
    );
    expect(res.errors).toBeGreaterThanOrEqual(1);
    expect((await directCounts(good.userId))["streaks"]).toBe(0);
    expect((await directCounts(bad.userId))["streaks"]).toBe(1);
  });

  /** THE PERMANENT GUARD FOR A CLASS THAT HAS NOW HAPPENED TWICE (:5348 rule
   *  5). `gym_join_applications` joined the SPEC-GAP list a card late in
   *  2026-08-19, `gym_attendance` a card late in 2026-09-02, and both were
   *  found by a person reading `tables.ts` — the second one by a reviewer
   *  rather than by the card that created the table. The enumeration method
   *  IS the failure mode: it only runs when somebody remembers to run it.
   *
   *  So the database is asked instead, and the question is deliberately the
   *  weakest one that still bites: not "is this table purged" — that is the
   *  ruling nobody has made yet — but **"has anybody LOOKED at it"**. A new
   *  table carrying a user id is red on the day it is created, and the fix is
   *  one line on whichever list its author decides it belongs to.
   *
   *  **WHAT IT CANNOT SEE, so no future round reads it as a completeness
   *  proof** (:27659): it walks FOREIGN KEYS, so it is blind to exactly what
   *  `tables.ts`'s own hand scan was blind to — `subscriptions.owner_id` is
   *  polymorphic and carries none — and blind to identity stored inside jsonb.
   *  It narrows the gap; it does not close it. */
  it("every table with a foreign key to users is on one of the privacy lists", async () => {
    const linked = await sql<{ tbl: string; col: string }[]>`
      SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      WHERE c.contype = 'f' AND c.confrelid = 'users'::regclass
      ORDER BY 1, 2`;

    // POSITIVE CONTROL FIRST: an empty or broken scan would satisfy the real
    // assertion below with nothing to say (:7104's PG1). A floor rather than a
    // count, because this number only ever grows and an equality here would be
    // the brittle assertion this test exists to replace.
    expect(linked.length).toBeGreaterThan(20);
    expect(linked.map((r) => r.tbl)).toContain("workouts");

    const accounted = new Set<string>([...PII_TABLES, ...USER_LINKED_NOT_PURGED_TABLES]);
    const unaccounted = [...new Set(linked.map((r) => r.tbl))]
      .filter((t) => !accounted.has(t))
      .sort();
    expect(unaccounted).toEqual([]);
  });

  /** THE OTHER DIRECTION, and it is the one that rots quietly: a list of names
   *  nothing checks can outlive the tables it names, and a renamed table would
   *  leave the check above passing while the entry protects nothing. */
  it("no name on the not-purged list has gone stale", async () => {
    const rows = await sql<{ tbl: string }[]>`
      SELECT c.relname AS tbl
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'`;
    const real = new Set(rows.map((r) => r.tbl));
    expect(USER_LINKED_NOT_PURGED_TABLES.filter((t) => !real.has(t))).toEqual([]);
  });
});
