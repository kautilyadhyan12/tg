// P1.10d/P2.1 — POST /v1/workouts/sync route + repo tests against a REAL
// Postgres (R9.2 — no SQL mocks). DATABASE_URL-gated like db.migration.test.ts:
// skips visibly when unset; requires migrations 0001–0003 and the seed applied.
// P2.1: the SYNC_DEV_USER_ID seam is GONE — every request authenticates with a
// real cookie obtained via /v1/auth (the P1.10d carry-forward re-proof).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { seed } from "../src/db/seed.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "sync-Test-password-1";

const set = (setIndex: number, extra: Record<string, unknown> = {}) => ({
  exercise: "squat",
  setIndex,
  reps: 5,
  durationMs: 21000,
  avgFormScore: 84,
  repScores: [80, 82, 85, 86, 87],
  faultCounts: { shallow_depth: 2 },
  tempoMsAvg: 3900,
  romStats: { kneeMinAvgDeg: 96 },
  view: "side",
  holdMs: null,
  calibration: null,
  engineVersion: "1.0.0",
  definitionVersion: 1,
  ...extra,
});

const payload = (workoutId: string, sets: unknown[]) => ({
  workoutId,
  startedAt: "2026-07-10T09:30:00.000Z",
  platform: "web",
  engineVersion: "1.0.0",
  defsVersion: 1,
  sets,
  traceSample: null,
});

type App = Awaited<ReturnType<typeof buildApp>>;

d("POST /v1/workouts/sync (real Postgres, real cookie authn)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  let cookieA = ""; // accessToken values from real logins
  let cookieB = "";
  let userA = "";
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const baseEnv = {
    NODE_ENV: "test",
    DATABASE_URL: url ?? "",
    WEB_ORIGIN: "http://localhost:5173",
    JWT_SECRET: "sync-test-secret-0123456789abcdef-32",
    LOG_LEVEL: "error",
  };

  const inject = (
    body: unknown,
    headers: Record<string, string>,
    accessToken: string | null = cookieA,
  ) =>
    api().inject({
      method: "POST",
      url: "/v1/workouts/sync",
      headers: { "content-type": "application/json", ...headers },
      cookies: accessToken === null ? {} : { accessToken },
      payload: JSON.stringify(body),
    });

  const post = (body: { workoutId: string }, accessToken: string | null = cookieA) =>
    inject(body, { "idempotency-key": body.workoutId }, accessToken);

  /** Register + login a fixture user through the real auth module. */
  const session = async (email: string, name: string): Promise<{ userId: string; access: string }> => {
    const reg = await api().inject({
      method: "POST",
      url: "/v1/auth/register",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email, password: PASSWORD, displayName: name }),
    });
    if (reg.statusCode !== 201) throw new Error(`register failed: ${reg.body}`);
    const { userId } = reg.json<{ userId: string }>();
    const login = await api().inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email, password: PASSWORD }),
    });
    if (login.statusCode !== 200) throw new Error(`login failed: ${login.body}`);
    const access = login.cookies.find((c) => c.name === "accessToken")?.value ?? "";
    return { userId, access };
  };

  // 90s: a full seed pass over a WAN connection to the Neon branch, plus two
  // register(bcrypt cost 10)+login round-trips (P1.10d budgeted 60s pre-auth).
  beforeAll(async () => {
    await seed(url ?? ""); // idempotent; provides the 3 exercise rows
    // Workouts FK is RESTRICT: a prior run's workouts must go before its users.
    await sql`DELETE FROM workouts WHERE user_id IN
      (SELECT id FROM users WHERE email LIKE 'p21-sync-%@example.com')`;
    await sql`DELETE FROM users WHERE email LIKE 'p21-sync-%@example.com'`;
    app = await buildApp(loadConfig(baseEnv));
    const a = await session("p21-sync-a@example.com", "sync-test-a");
    const b = await session("p21-sync-b@example.com", "sync-test-b");
    userA = a.userId;
    cookieA = a.access;
    cookieB = b.access;
    await sql`DELETE FROM workouts WHERE user_id IN (${a.userId}, ${b.userId})`;
  }, 90_000);

  afterAll(async () => {
    // app is undefined if beforeAll died — don't mask the real failure.
    if (app !== undefined) await app.close();
    await sql.end({ timeout: 5 });
  });

  it("401 dark with no cookie (production posture — the P1.10d seam is gone)", async () => {
    const wid = "aaaaaaaa-0000-4000-8000-000000000000";
    const res = await post(payload(wid, [set(1)]), null);
    expect(res.statusCode).toBe(401);
  });

  it("401 with a garbage access token", async () => {
    const wid = "aaaaaaaa-0000-4000-8000-000000000001";
    const res = await post(payload(wid, [set(1)]), "not-a-jwt");
    expect(res.statusCode).toBe(401);
  });

  it("happy path: 201, workout + sets persisted verbatim, aggregates derived", { timeout: 30_000 }, async () => {
    const wid = "aaaaaaaa-1111-4111-8111-000000000001";
    const res = await post(payload(wid, [set(1), set(2), set(4, { reps: 3, avgFormScore: 90, repScores: [90, 90, 91] })]));
    expect(res.statusCode).toBe(201);
    expect(res.json<Record<string, unknown>>()).toEqual({ workoutId: wid, status: "created" });

    const [w] = await sql`SELECT * FROM workouts WHERE id = ${wid}`;
    expect(w?.["user_id"]).toBe(userA);
    expect(w?.["sets_count"]).toBe(3);
    expect(w?.["total_reps"]).toBe(13);
    expect(w?.["avg_form_score"]).toBe(86); // round((84+84+90)/3)
    expect(w?.["duration_ms"]).toBe(63000);
    // P2.3: 2B §2.2 kcal now computed at sync — 3 sets × (6.0 MET × 70 kg
    // fallback × 21000/3.6e6 h) = 7.35 → 7.
    expect(w?.["kcal_point"]).toBe(7);
    expect(w?.["kcal_calc_version"]).toBe(1);
    expect(w?.["bundle_version"]).toBe(1);

    const sets = await sql<
      { set_index: number; rep_scores: number[]; fault_counts: Record<string, number> }[]
    >`
      SELECT set_index, reps, rep_scores, fault_counts FROM workout_sets
      WHERE workout_id = ${wid} ORDER BY set_index`;
    // Non-contiguous setIndex preserved verbatim (1, 2, 4 — manual reset skips).
    expect(sets.map((s) => s["set_index"])).toEqual([1, 2, 4]);
    expect(sets[0]?.["rep_scores"]).toEqual([80, 82, 85, 86, 87]);
    expect(sets[0]?.["fault_counts"]).toEqual({ shallow_depth: 2 });
  });

  it("validation failure: unknown key / overflow / duplicate setIndex / empty sets → 400, nothing persisted", { timeout: 30_000 }, async () => {
    const wid = "aaaaaaaa-1111-4111-8111-000000000002";
    const cases: unknown[] = [
      { ...payload(wid, [set(1)]), extraKey: true }, // .strict()
      payload(wid, [set(40000)]), // smallint overflow → 400, never a PG 500 (T3)
      payload(wid, [set(1, { reps: 100000 })]), // smallint overflow
      payload(wid, [set(1), set(1)]), // duplicate setIndex would desync aggregates (T3)
      payload(wid, []), // empty engine workout must not be creatable (DECISIONS)
    ];
    for (const bad of cases) {
      const res = await inject(bad, { "idempotency-key": wid });
      expect(res.statusCode).toBe(400);
    }
    const rows = await sql`SELECT 1 FROM workouts WHERE id = ${wid}`;
    expect(rows.length).toBe(0);
  });

  it("Idempotency-Key mismatch / missing → 400", async () => {
    const wid = "aaaaaaaa-1111-4111-8111-000000000003";
    const body = payload(wid, [set(1)]);
    const mismatch = await inject(body, { "idempotency-key": "aaaaaaaa-1111-4111-8111-000000000099" });
    expect(mismatch.statusCode).toBe(400);
    const missing = await inject(body, {});
    expect(missing.statusCode).toBe(400);
  });

  it("retried sync is a no-op: same POST twice → one workout, one set of rows", { timeout: 30_000 }, async () => {
    const wid = "aaaaaaaa-1111-4111-8111-000000000004";
    const body = payload(wid, [set(1), set(2)]);
    const first = await post(body);
    expect(first.statusCode).toBe(201);
    const second = await post(body);
    expect(second.statusCode).toBe(200);
    expect(second.json<Record<string, unknown>>()).toEqual({ workoutId: wid, status: "duplicate" });
    const [w] = await sql`SELECT count(*)::int AS n FROM workouts WHERE id = ${wid}`;
    const [s] = await sql`SELECT count(*)::int AS n FROM workout_sets WHERE workout_id = ${wid}`;
    expect(w?.["n"]).toBe(1);
    expect(s?.["n"]).toBe(2);
  });

  it("concurrent duplicate POSTs: exactly one workout, no 500 (T3 P1.10c: cross-tab flush)", { timeout: 30_000 }, async () => {
    const wid = "aaaaaaaa-1111-4111-8111-000000000005";
    const body = payload(wid, [set(1)]);
    const results = await Promise.all([post(body), post(body), post(body)]);
    for (const r of results) expect([200, 201]).toContain(r.statusCode);
    const [w] = await sql`SELECT count(*)::int AS n FROM workouts WHERE id = ${wid}`;
    const [s] = await sql`SELECT count(*)::int AS n FROM workout_sets WHERE workout_id = ${wid}`;
    expect(w?.["n"]).toBe(1);
    expect(s?.["n"]).toBe(1);
  });

  it("cross-tenant denial END-TO-END: user B's real cookie posting user A's workoutId → 404, rows untouched (P2.1 re-proof)", { timeout: 30_000 }, async () => {
    const wid = "aaaaaaaa-1111-4111-8111-000000000006";
    await post(payload(wid, [set(1)])); // owned by A (cookie A)
    const res = await post(payload(wid, [set(1), set(2)]), cookieB);
    expect(res.statusCode).toBe(404);
    const [s] = await sql`SELECT count(*)::int AS n FROM workout_sets WHERE workout_id = ${wid}`;
    expect(s?.["n"]).toBe(1); // B's extra set was NOT attached to A's workout
    const [w] = await sql`SELECT user_id FROM workouts WHERE id = ${wid}`;
    expect(w?.["user_id"]).toBe(userA); // ownership unchanged
  });

  it("unknown exercise slug: workout accepted (200-class, NOT a parking 4xx), set skipped + flagged", { timeout: 30_000 }, async () => {
    const wid = "aaaaaaaa-1111-4111-8111-000000000007";
    const res = await post(payload(wid, [set(1), set(2, { exercise: "not_in_catalog" })]));
    expect(res.statusCode).toBe(201);
    const [w] = await sql`
      SELECT sets_count, total_reps, quality_flags FROM workouts WHERE id = ${wid}`;
    expect(w?.["sets_count"]).toBe(1); // aggregates cover persisted sets only
    expect(w?.["quality_flags"]).toEqual(["unknown_exercise"]);
    const [s] = await sql`SELECT count(*)::int AS n FROM workout_sets WHERE workout_id = ${wid}`;
    expect(s?.["n"]).toBe(1);
  });
});
