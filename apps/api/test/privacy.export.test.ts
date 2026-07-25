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
import { EXPORT_READERS } from "../src/modules/privacy/exportRepo.js";
import { getTableColumns } from "drizzle-orm";
import { coachMessages, coachThreads } from "../src/db/schema/coach.js";
import { workouts } from "../src/db/schema/training.js";
import {
  INTERNAL_COLUMNS_BY_TABLE,
  INTERNAL_COLUMNS_EVERYWHERE,
} from "../src/modules/privacy/export.js";
import {
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
      for (const t of [
        "user_dishware",
        "runs",
        "saved_routes",
        "run_schedules",
        "body_measurements",
        "workout_templates",
        "user_achievements",
        "streaks",
        "challenge_participants",
        "auth_identities",
        "user_fitness_profiles",
        "push_tokens",
      ]) {
        await sql`DELETE FROM ${sql(t)} WHERE user_id = ANY(${madeUsers})`;
      }
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
      INSERT INTO users (email, display_name, weight_kg, password_hash, hash_algo)
      VALUES (${`dpdp-exp-${label}-${uniq()}@example.com`}, ${name}, 71.50,
              ${"$2a$10$fixtureHashNotARealPassword000000000000000000000000000"}, 'bcrypt')
      RETURNING id`;
    const userId = rows[0]?.id ?? "";
    madeUsers.push(userId);

    await sql`INSERT INTO auth_identities (user_id, provider, subject)
              VALUES (${userId}, 'google', ${"sub-" + userId})`;
    await sql`INSERT INTO user_fitness_profiles (user_id, age, gender, height_cm, medical_conditions)
              VALUES (${userId}, 31, 'female', 165, ${`asthma-${label}`})`;
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

    // T3 round 2, F6: the `now` seam's doc claimed "so exportedAt is
    // assertable" while no caller or test ever passed one — a claim with
    // nothing behind it. It is asserted now, so the sentence is true.
    const fixed = new Date("2026-07-23T09:15:00.000Z");
    const stamped = await buildUserExport({ sql, now: () => fixed }, u.userId);
    expect(stamped.exportedAt).toBe("2026-07-23T09:15:00.000Z");
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
