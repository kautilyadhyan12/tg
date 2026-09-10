// Part 4 §5.2 — the data-export right, against REAL Postgres (R9.2, no SQL
// mocks). DATABASE_URL-gated; needs migrations 0001-0007 + seed.ts.
//
// The weight of this suite is on what must NEVER appear in the file: another
// user's rows (the export is the mirror of the delete side's cross-tenant
// bug — three tables cannot be safely read by a user_id column) and any
// credential. "It returned my data" is the easy half.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { dpdpExportSchema } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { buildUserExport } from "../src/modules/privacy/export.js";
import { CONSENT_EXPORT_LIMIT, EXPORT_READERS } from "../src/modules/privacy/exportRepo.js";
import {
  CONSENT_PROOF_RETENTION_DAYS,
  CONSENT_PROOF_RETENTION_YEARS,
} from "../src/retention.js";
import { getTableColumns } from "drizzle-orm";
import { coachMessages, coachThreads } from "../src/db/schema/coach.js";
import { workouts } from "../src/db/schema/training.js";
import {
  INTERNAL_COLUMNS_BY_TABLE,
  INTERNAL_COLUMNS_EVERYWHERE,
} from "../src/modules/privacy/export.js";
import {
  DIRECT_DELETE_TABLES,
  EXPORT_EXCLUDED_TABLES,
  EXPORTED_TABLES,
  PII_TABLES,
} from "../src/modules/privacy/tables.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

d("DPDP data export (real Postgres)", () => {
  const sql = postgres(url ?? "", { max: 4 });
  let exerciseId = "";
  let challengeId = "";
  const madeUsers: string[] = [];

  beforeAll(async () => {
    const ex = await sql<{ id: string }[]>`SELECT id FROM exercises WHERE slug = 'squat' LIMIT 1`;
    const found = ex[0];
    if (found === undefined) throw new Error("seed.ts must run first (exercises)");
    exerciseId = found.id;
    const ch = await sql<{ id: string }[]>`
      INSERT INTO challenges (scope, template_code, starts_on, ends_on)
      VALUES ('global', 'dpdp_export_fixture', current_date, current_date + 7)
      RETURNING id`;
    challengeId = ch[0]?.id ?? "";
  });

  afterAll(async () => {
    if (madeUsers.length > 0) {
      // Children first — these tables' rows hang off parents we delete below.
      await sql`DELETE FROM workout_sets WHERE user_id = ANY(${madeUsers})`;
      await sql`DELETE FROM workouts WHERE user_id = ANY(${madeUsers})`;
      await sql`DELETE FROM meal_logs WHERE user_id = ANY(${madeUsers})`;
      await sql`DELETE FROM coach_threads WHERE user_id = ANY(${madeUsers})`;
      // Drive the REAL list, never a copy of it (T3 F4). The literal that used
      // to sit here silently missed `user_xp` when that table was added, and
      // only the FK cascade from the `users` delete below covered it — i.e. it
      // worked by accident. This is the exact drift DIRECT_DELETE_TABLES exists
      // to kill, and privacy.purge.test.ts already loops it. Re-deleting the
      // four handled above is a harmless no-op.
      for (const t of DIRECT_DELETE_TABLES) {
        await sql`DELETE FROM ${sql(t)} WHERE user_id = ANY(${madeUsers})`;
      }
      await sql`DELETE FROM consent_log WHERE user_id = ANY(${madeUsers})`; // no cascade: kept as proof
      await sql`DELETE FROM users WHERE id = ANY(${madeUsers})`;
    }
    if (challengeId !== "") await sql`DELETE FROM challenges WHERE id = ${challengeId}`;
    await sql.end();
  });

  const uniq = () => `${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`;

  /** A user with one row in every exported table, so an assertion that a
   *  table came back EMPTY can never pass by accident. */
  async function makeUser(label: string): Promise<{ userId: string; name: string }> {
    const name = `Export Fixture ${label}`;
    const rows = await sql<{ id: string }[]>`
      INSERT INTO users (email, display_name, password_hash, hash_algo)
      VALUES (${`dpdp-exp-${label}-${uniq()}@example.com`}, ${name},
              ${"$2a$10$fixtureHashNotARealPassword000000000000000000000000000"}, 'bcrypt')
      RETURNING id`;
    const userId = rows[0]?.id ?? "";
    madeUsers.push(userId);

    await sql`INSERT INTO auth_identities (user_id, provider, subject)
              VALUES (${userId}, 'google', ${"sub-" + userId})`;
    await sql`INSERT INTO user_fitness_profiles (user_id, age, gender, height_cm, medical_conditions)
              VALUES (${userId}, 31, 'female', 165, ${`asthma-${label}`})`;
    await sql`INSERT INTO user_health_screenings (user_id, has_condition, check_first)
              VALUES (${userId}, true, 'cleared')`;
    await sql`INSERT INTO consent_log (user_id, purpose, wording_version, wording, app_version)
              VALUES (${userId}, 'health_step', 'v1', ${`wording-${label}`}, 'test')`;
    const wId = randomUUID();
    await sql`INSERT INTO workouts (id, user_id, started_at, platform, engine_version, quality_flags)
              VALUES (${wId}, ${userId}, now(), 'web', '1.0.0', ${sql.array(["anticheat-marker"])})`;
    await sql`INSERT INTO workout_sets
              (workout_id, user_id, exercise_id, started_at, set_index, duration_ms,
               engine_version, definition_version)
              VALUES (${wId}, ${userId}, ${exerciseId}, now(), 0, 60000, '1.0.0', 1)`;
    await sql`INSERT INTO workout_templates (user_id, name, items)
              VALUES (${userId}, ${`Template ${label}`}, ${sql.json([])})`;
    await sql`INSERT INTO body_measurements (user_id, measured_at, weight_kg)
              VALUES (${userId}, now(), 71.50)`;
    const meal = await sql<{ id: string }[]>`
      INSERT INTO meal_logs (user_id, taken_at, items, kcal_point, kcal_low, kcal_high,
                             portion_source, nutrition_sources, calc_version)
      VALUES (${userId}, now(), ${sql.json([])}, 300, 250, 350, 'default',
              ${sql.array(["curated"])}, 1)
      RETURNING id`;
    await sql`INSERT INTO meal_log_corrections (meal_log_id, field, original, corrected)
              VALUES (${meal[0]?.id ?? ""}, ${`grams-${label}`}, ${sql.json({ g: 100 })}, ${sql.json({ g: 120 })})`;
    await sql`INSERT INTO user_dishware (user_id, label, container_class, volume_ml)
              VALUES (${userId}, ${`Katori ${label}`}, 'katori', 175)`;
    // legacy_mongo_id is set on a NON-users table on purpose: the strip must
    // apply everywhere, which is the contradiction T3 F5 found.
    const th = await sql<{ id: string }[]>`
      INSERT INTO coach_threads (user_id, title, legacy_mongo_id)
      VALUES (${userId}, ${`Thread ${label}`}, ${`legacy-${label}-${uniq()}`})
      RETURNING id`;
    // ...and the coach metering columns T3 F6 found riding along.
    await sql`INSERT INTO coach_messages (thread_id, role, content, model, tokens_in, tokens_out, cost_micro, currency)
              VALUES (${th[0]?.id ?? ""}, 'user', ${`question from ${label}`},
                      'internal-model-marker', 900, 120, 4200, 'USD')`;
    // runs.id and workouts.id are client-generated (no DB default) — the only
    // two such tables in the export list.
    await sql`INSERT INTO runs (id, user_id, started_at, duration_s, distance_m)
              VALUES (${randomUUID()}, ${userId}, now(), 1800, 5000)`;
    await sql`INSERT INTO saved_routes (user_id, name, polyline, distance_m)
              VALUES (${userId}, ${`Route ${label}`}, ${`polyline-${label}`}, 5000)`;
    await sql`INSERT INTO run_schedules (user_id, rule) VALUES (${userId}, ${sql.json({})})`;
    await sql`INSERT INTO user_achievements (user_id, code) VALUES (${userId}, 'first_workout')`;
    await sql`INSERT INTO streaks (user_id, current, longest) VALUES (${userId}, 3, 5)`;
    await sql`INSERT INTO user_xp (user_id, total_xp) VALUES (${userId}, 456)`;
    await sql`INSERT INTO challenge_participants (challenge_id, user_id)
              VALUES (${challengeId}, ${userId})`;
    await sql`INSERT INTO push_tokens (user_id, token, platform)
              VALUES (${userId}, ${"tok-" + userId}, 'android')`;
    return { userId, name };
  }

  it("exports every listed table, and the envelope parses", { timeout: 60_000 }, async () => {
    const u = await makeUser("all");
    const out = await buildUserExport({ sql }, u.userId);

    // The contract, not a hand-rolled shape check.
    expect(() => dpdpExportSchema.parse(out)).not.toThrow();
    // Every exported table present AND non-empty — the fixture seeded each.
    for (const t of EXPORTED_TABLES) {
      expect({ t, n: out.data[t]?.length ?? -1 }).toEqual({ t, n: 1 });
    }
    expect(out.user["display_name"]).toBe(u.name);
    // The consent log rides beside the PII tables (kept after a purge, still
    // the person's own record) — present, and carrying the words verbatim.
    expect(out.data["consent_log"]).toHaveLength(1);
    expect(out.data["consent_log"]?.[0]).toMatchObject({ purpose: "health_step", wording: "wording-all" });
    // Nothing was cut, and the envelope says so out loud rather than by an
    // absent key (the same reason every table keeps an empty array).
    expect(out.truncated).toEqual({});

    // T3 round 2, F6: the `now` seam's doc claimed "so exportedAt is
    // assertable" while no caller or test ever passed one — a claim with
    // nothing behind it. It is asserted now, so the sentence is true.
    const fixed = new Date("2026-07-23T09:15:00.000Z");
    const stamped = await buildUserExport({ sql, now: () => fixed }, u.userId);
    expect(stamped.exportedAt).toBe("2026-07-23T09:15:00.000Z");
  });

  // The consent read is the ONE capped read in the export, so it is the one
  // that can hand a person less than they have. Before this test the cap was
  // silent: deleting `LIMIT ${CONSENT_EXPORT_LIMIT}` left the whole suite green
  // (measured at the 3b re-check), because no fixture ever had two consent
  // rows. Three things are asserted — the file stops at the cap, it says how
  // many rows exist, and WHICH rows survived — so neither the ceiling, the
  // count nor the ordering can be dropped.
  it("caps the consent log, SAYS the file is short, and keeps the NEWEST taps", { timeout: 90_000 }, async () => {
    const u = await makeUser("capped");
    // makeUser seeded one, and it must be the NEWEST row of the set. Add
    // exactly the ceiling below it, so one row cannot fit and the cap has to
    // choose an end to drop.
    //
    // STAMPED FROM THE FIXTURE'S OWN ROW, not from `now()`. `now()` is the
    // statement's transaction time, and makeUser runs ~20 inserts before this
    // one: on a loaded database that took over a second, which put `now() - 1s`
    // AFTER the fixture's row and made "the newest" ambiguous. Green scoped,
    // red in the full suite — the fixture must not depend on how fast the
    // database is.
    await sql`
      INSERT INTO consent_log (user_id, purpose, wording_version, wording, app_version, recorded_at)
      SELECT ${u.userId}, 'plan_screen', 'v1', 'older-' || g::text, 'test',
             (SELECT c.recorded_at FROM consent_log c WHERE c.user_id = ${u.userId})
               - (g * interval '1 second')
      FROM generate_series(1, ${CONSENT_EXPORT_LIMIT}) AS g`;

    const out = await buildUserExport({ sql }, u.userId);
    expect(() => dpdpExportSchema.parse(out)).not.toThrow();
    expect(out.data["consent_log"]).toHaveLength(CONSENT_EXPORT_LIMIT);
    expect(out.truncated["consent_log"]).toEqual({
      returned: CONSENT_EXPORT_LIMIT,
      total: CONSENT_EXPORT_LIMIT + 1,
    });

    // WHICH thousand came back. The counts above pass whichever end is cut, and
    // the envelope never says which — so the export must keep the person's most
    // recent taps (the wording they agreed to last), the same end the list route
    // shows. Ordered oldest-first, this suite stayed green while silently
    // dropping makeUser's own row, the newest one of all.
    const wordings = (out.data["consent_log"] ?? []).map((r) => r["wording"]);
    expect(wordings[0]).toBe("wording-capped"); // the newest, first in the file
    expect(wordings).toContain("older-1"); // the second-newest survives
    expect(wordings).not.toContain(`older-${String(CONSENT_EXPORT_LIMIT)}`); // the oldest is the one cut
    // ...and the row carries EXACTLY the six columns the read enumerates: not
    // `total`, the carrier the count now rides in, and not a seventh column
    // added to the SELECT and forgotten by the filter that drops it.
    expect(Object.keys((out.data["consent_log"] ?? [])[0] ?? {}).sort()).toEqual([
      "app_version",
      "id",
      "purpose",
      "recorded_at",
      "wording",
      "wording_version",
    ]);
  });

  it("NEVER includes credentials or excluded tables", { timeout: 60_000 }, async () => {
    const u = await makeUser("creds");
    const out = await buildUserExport({ sql }, u.userId);
    const serialized = JSON.stringify(out);

    // The absolute rule: no password material anywhere in the file.
    expect(Object.keys(out.user)).not.toContain("password_hash");
    expect(Object.keys(out.user)).not.toContain("hash_algo");
    expect(serialized).not.toContain("$2a$"); // the fixture's bcrypt prefix
    expect(serialized).not.toContain("fixtureHashNotARealPassword");
    // legacy_mongo_id is an internal id, deliberately omitted.
    expect(Object.keys(out.user)).not.toContain("legacy_mongo_id");
    // Excluded tables never appear as keys, and their values never leak.
    for (const t of Object.keys(EXPORT_EXCLUDED_TABLES)) {
      expect(Object.keys(out.data)).not.toContain(t);
    }
    expect(serialized).not.toContain(`tok-${u.userId}`); // the push token

    // INTERNAL COLUMNS, stripped from every table (T3 F5/F6/F7). Mutation
    // testing proved the assertions above could NOT see these: removing the
    // strip left this test green, the same blindness the review caught in the
    // rate-limit test. Each value below is seeded by the fixture, so a green
    // here means the strip ran — not that the column was never there.
    expect(serialized).not.toContain("legacy-"); // legacy_mongo_id, ALL tables
    expect(serialized).not.toContain("internal-model-marker"); // coach metering
    expect(serialized).not.toContain("cost_micro");
    expect(serialized).not.toContain("tokens_in");
    expect(serialized).not.toContain("anticheat-marker"); // workouts.quality_flags
    // ...and the user's own message content is UNTOUCHED by the strip.
    expect(serialized).toContain("question from creds");
  });

  it("contains NO row belonging to another user", { timeout: 60_000 }, async () => {
    // The tenancy proof (R3.2/R9.2). It matters most for the three tables the
    // delete side proved cannot be read by a user_id column.
    const mine = await makeUser("mine");
    const theirs = await makeUser("theirs");

    // THE POISON ROW — without it this test cannot catch the bug it is named
    // for. Both users' rows are otherwise well-formed, so reading
    // workout_sets by its denormalised user_id would return exactly the right
    // rows and the test would pass with the defect live. This is a set that
    // BELONGS to `theirs` (it is in their workout) but carries `mine`'s id in
    // the denormalised column — the shape the Day-14 card's F6 proved real.
    // Ownership-true reading must leave it out of my export.
    const theirWorkout = await sql<{ id: string }[]>`
      SELECT id FROM workouts WHERE user_id = ${theirs.userId} LIMIT 1`;
    await sql`INSERT INTO workout_sets
              (workout_id, user_id, exercise_id, started_at, set_index, duration_ms,
               engine_version, definition_version)
              VALUES (${theirWorkout[0]?.id ?? ""}, ${mine.userId}, ${exerciseId}, now(),
                      99, 12345, 'poison-marker', 1)`;

    const out = await buildUserExport({ sql }, mine.userId);
    const serialized = JSON.stringify(out);

    // The poison row is theirs, and must not appear in my export.
    expect(serialized).not.toContain("poison-marker");

    // Nothing of theirs, by identity or by any seeded value.
    expect(serialized).not.toContain(theirs.userId);
    expect(serialized).not.toContain("theirs");
    // And every table returned exactly the one row that is mine.
    for (const t of EXPORTED_TABLES) {
      expect({ t, n: out.data[t]?.length ?? -1 }).toEqual({ t, n: 1 });
    }
  });

  it("a user with no data gets every key, empty — never a missing key", {
    timeout: 60_000,
  }, async () => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO users (email, display_name) VALUES (${`dpdp-exp-empty-${uniq()}@example.com`}, 'Empty')
      RETURNING id`;
    const userId = rows[0]?.id ?? "";
    madeUsers.push(userId);

    const out = await buildUserExport({ sql }, userId);
    for (const t of EXPORTED_TABLES) {
      // Present and empty — "no data" must be distinguishable from "not exported".
      expect({ t, rows: out.data[t] }).toEqual({ t, rows: [] });
    }
  });

});

// ── the route (fastify.inject): authn, the download header, the rate cap ────
d("GET /v1/users/me/export (route)", () => {
  const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let ipCounter = 0;
  const nextIp = () => `10.7.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

  const api = () => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const inject = (o: { method: "GET" | "POST"; url: string; body?: unknown; cookies?: Record<string, string> }) =>
    api().inject({
      method: o.method,
      url: o.url,
      remoteAddress: nextIp(),
      headers: o.body !== undefined ? { "content-type": "application/json" } : {},
      cookies: o.cookies ?? {},
      ...(o.body !== undefined ? { payload: JSON.stringify(o.body) } : {}),
    });

  beforeAll(async () => {
    await sql`DELETE FROM users WHERE email LIKE 'dpdp-exproute-%@example.com'`;
    app = await buildApp(
      loadConfig({
        NODE_ENV: "test",
        DATABASE_URL: url ?? "",
        WEB_ORIGIN: "http://localhost:5173",
        JWT_SECRET: "export-test-secret-0123456789abcdef-32", // dummy test value, gitleaks:allow
        LOG_LEVEL: "error",
      }),
    );
  }, 60_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    await sql`DELETE FROM users WHERE email LIKE 'dpdp-exproute-%@example.com'`;
    await sql.end({ timeout: 5 });
  });

  const signIn = async (email: string) => {
    const reg = await inject({
      method: "POST",
      url: "/v1/auth/register",
      body: { email, password: PASSWORD, displayName: "Export Route" },
    });
    expect(reg.statusCode).toBe(201);
    const login = await inject({ method: "POST", url: "/v1/auth/login", body: { email, password: PASSWORD } });
    expect(login.statusCode).toBe(200);
    return Object.fromEntries(login.cookies.map((c) => [c.name, c.value]));
  };

  it("401s without a session", { timeout: 30_000 }, async () => {
    const res = await inject({ method: "GET", url: "/v1/users/me/export" });
    expect(res.statusCode).toBe(401);
  });

  it("returns the envelope as a download", { timeout: 60_000 }, async () => {
    const cookies = await signIn(`dpdp-exproute-ok-${String(Date.now())}@example.com`);
    const res = await inject({ method: "GET", url: "/v1/users/me/export", cookies });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="aihomegym-export-\d{4}-\d{2}-\d{2}\.json"$/);
    // Parsed through the REAL contract, over the real HTTP path.
    const parsed = dpdpExportSchema.safeParse(JSON.parse(res.body));
    expect(parsed.success).toBe(true);
    expect(res.body).not.toContain("password_hash");
  });

  // T3 F2 — the case the first version of this suite was DELIBERATELY blind
  // to. It gave every request a fresh IP "so the per-USER dimension is being
  // proven", which meant nothing exercised two members behind one address —
  // and the shipped limiter counted an IP bucket, so user B's FIRST EVER
  // export returned 429 because user A had spent three. A gym on one
  // connection is the literal pilot deployment (P6). Same failure the tenancy
  // test nearly had: a test that cannot see the bug it is named for.
  it("one member's exports do NOT lock out another on the same IP", {
    timeout: 90_000,
  }, async () => {
    const sharedIp = "203.0.113.77";
    const injectFrom = (cookies: Record<string, string>) =>
      api().inject({ method: "GET", url: "/v1/users/me/export", remoteAddress: sharedIp, cookies });

    const a = await signIn(`dpdp-exproute-nat-a-${String(Date.now())}@example.com`);
    const b = await signIn(`dpdp-exproute-nat-b-${String(Date.now())}@example.com`);

    // A spends their whole allowance from the shared address.
    for (let i = 0; i < 3; i++) expect((await injectFrom(a)).statusCode).toBe(200);
    // B has exported nothing. They must still be served.
    expect((await injectFrom(b)).statusCode).toBe(200);
  });

  it("caps exports per user (Kd-ruled 3/hour)", { timeout: 90_000 }, async () => {
    const cookies = await signIn(`dpdp-exproute-cap-${String(Date.now())}@example.com`);
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) {
      // Each from a DIFFERENT IP, so it is the per-USER dimension being
      // proven, not the per-IP one.
      const res = await inject({ method: "GET", url: "/v1/users/me/export", cookies });
      codes.push(res.statusCode);
    }
    expect(codes.slice(0, 3)).toEqual([200, 200, 200]);
    expect(codes[3]).toBe(429);
  });
});

// T3 round 2, F2 — LIFTED OUT of the DATABASE_URL-gated describe above.
// This guard touches no SQL: it compares the export list against the delete
// list. Gated, it ran NOWHERE, because CI's test job supplies no
// DATABASE_URL — and it is the guard standing between a list that drifted
// and a broken DPDP export. Ungated, it runs on every merge TODAY.
describe("DPDP export list (no database)", () => {
  // R3-F1. Round 1 typed EXPORT_READERS' key; round 2 typed this map's key;
  // round 3 found the VALUES still bare strings — the same defect one level
  // down, inside its own fix, three times. A column name cannot be typed, so
  // it is asserted against the REAL drizzle schema. Probed by the reviewer:
  // "cost_micro" -> "cost_micros" passed tsc AND passed everything CI runs,
  // while shipping our per-request cost in every user's download. This runs
  // WITHOUT a database, so unlike the rest of the suite CI executes it.
  it("every stripped column actually exists on its table", () => {
    const columnsOf = (t: Parameters<typeof getTableColumns>[0]): string[] =>
      Object.values(getTableColumns(t)).map((c) => c.name);
    const byTable: Record<string, string[]> = {
      coach_messages: columnsOf(coachMessages),
      workouts: columnsOf(workouts),
      // carries legacy_mongo_id, so the everywhere-list has a real table to
      // be checked against (the guard caught its absence immediately).
      coach_threads: columnsOf(coachThreads),
    };
    for (const [table, cols] of Object.entries(INTERNAL_COLUMNS_BY_TABLE)) {
      const real = byTable[table] ?? [];
      expect({ table, known: real.length > 0 }).toEqual({ table, known: true });
      for (const col of cols) {
        // A name that is not a real column strips nothing and ships the data.
        expect({ table, col, exists: real.includes(col) }).toEqual({
          table,
          col,
          exists: true,
        });
      }
    }
    // The everywhere-list must be real on at least one table, or it is a typo.
    for (const col of INTERNAL_COLUMNS_EVERYWHERE) {
      const anywhere = Object.values(byTable).some((cols) => cols.includes(col));
      expect({ col, exists: anywhere }).toEqual({ col, exists: true });
    }
  });

  it("the export list and the delete list cannot drift apart", () => {
    // The structural guard (the Day-14 card's lesson): a table added to the
    // §5.2 delete list must be either exported or explicitly excluded, so
    // adding one forces a decision about BOTH rights.
    // Widened deliberately: the compiler already proves an excluded table
    // cannot be in EXPORTED_TABLES (it narrows the type), which is a guarantee
    // worth having — but this guard has to run at RUNTIME over the whole list.
    const exported: readonly string[] = EXPORTED_TABLES;
    for (const t of PII_TABLES) {
      const decided = exported.includes(t) || t in EXPORT_EXCLUDED_TABLES;
      expect({ t, decided }).toEqual({ t, decided: true });
    }
    // "Every exported table has a reader" is now enforced by the COMPILER
    // (EXPORT_READERS is keyed by ExportedTable — T3 F3), so the old runtime
    // `!== undefined` check is provably dead and lint rejects it. What is
    // still worth asserting at runtime is that the two sets are the same
    // SIZE, which catches a reader map that drifted in either direction.
    expect(Object.keys(EXPORT_READERS).length).toBe(EXPORTED_TABLES.length);
    expect(EXPORTED_TABLES.length + Object.keys(EXPORT_EXCLUDED_TABLES).length).toBe(
      PII_TABLES.length,
    );
  });
});

// Ungated for the same reason as the block above: no SQL, and CI runs it.
describe("consent-proof retention window (no database)", () => {
  // The window is a legal promise — "six years from the deletion date" — kept
  // as a whole number of DAYS, and the rounding may only ever err long. The
  // plain `6 * 365` this shipped with erred SHORT by two days for a 2026
  // deletion (2190 against 2192), which no route test, type or migration could
  // see: the constant is only ever compared with itself. Real dates instead.
  it("is never shorter than six calendar years, wherever the leap days fall", () => {
    const spanDays = (isoDay: string): number => {
      const from = new Date(`${isoDay}T00:00:00.000Z`);
      const to = new Date(from);
      to.setUTCFullYear(to.getUTCFullYear() + CONSENT_PROOF_RETENTION_YEARS);
      return Math.round((to.getTime() - from.getTime()) / 86_400_000);
    };
    // Six-year spans hold one or two 29 Februaries: 2191 or 2192 days.
    const spans = ["2025-01-01", "2026-03-01", "2026-09-09", "2027-07-15", "2030-11-30"].map(spanDays);
    const longest = Math.max(...spans);
    expect(longest).toBe(2192); // the fixture itself must cover the long case
    expect(CONSENT_PROOF_RETENTION_DAYS).toBeGreaterThanOrEqual(longest);
    // ...and not generously long either: at most a day past the promise.
    expect(CONSENT_PROOF_RETENTION_DAYS - longest).toBeLessThanOrEqual(1);
  });
});
