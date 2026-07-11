// P1.10d — POST /v1/workouts/sync route + repo tests against a REAL Postgres
// (R9.2 — no SQL mocks). DATABASE_URL-gated like db.migration.test.ts: skips
// visibly when unset; requires migrations 0001+0002 and the seed applied.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { seed } from "../src/db/seed.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

// Fixture identities (uuid v4 shapes, fixed for reproducibility; rows are
// cleaned up per run keyed on these ids).
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

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

const inject = (
  app: Awaited<ReturnType<typeof buildApp>>,
  body: unknown,
  headers: Record<string, string>,
) =>
  app.inject({
    method: "POST",
    url: "/v1/workouts/sync",
    headers: { "content-type": "application/json", ...headers },
    payload: JSON.stringify(body),
  });

const post = (
  app: Awaited<ReturnType<typeof buildApp>>,
  body: { workoutId: string },
) => inject(app, body, { "idempotency-key": body.workoutId });

d("POST /v1/workouts/sync (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  const api = (): Awaited<ReturnType<typeof buildApp>> => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const baseEnv = {
    NODE_ENV: "test",
    DATABASE_URL: url ?? "",
    WEB_ORIGIN: "http://localhost:5173",
  };

  // 60s: a full seed pass over a WAN connection to the Neon branch (the
  // migration test budgets 30s for the same seed; this hook also inserts
  // fixtures and boots the app).
  beforeAll(async () => {
    await seed(url ?? ""); // idempotent; provides the 3 exercise rows
    await sql`
      INSERT INTO users (id, display_name) VALUES
        (${USER_A}, 'sync-test-a'), (${USER_B}, 'sync-test-b')
      ON CONFLICT (id) DO NOTHING`;
    // Clean slate for fixture users (FK cascade removes their sets).
    await sql`DELETE FROM workouts WHERE user_id IN (${USER_A}, ${USER_B})`;
    app = await buildApp(loadConfig({ ...baseEnv, SYNC_DEV_USER_ID: USER_A }));
  }, 60_000);

  afterAll(async () => {
    // app is undefined if beforeAll died — don't mask the real failure.
    if (app !== undefined) await app.close();
    await sql.end({ timeout: 5 });
  });

  it("401s when the auth seam is unset (production posture)", async () => {
    const dark = await buildApp(loadConfig(baseEnv));
    const wid = "aaaaaaaa-0000-4000-8000-000000000000";
    const res = await post(dark, payload(wid, [set(1)]));
    expect(res.statusCode).toBe(401);
    await dark.close();
  });

  it("config refuses the seam in production AND when NODE_ENV is merely omitted", () => {
    expect(() =>
      loadConfig({ ...baseEnv, NODE_ENV: "production", SYNC_DEV_USER_ID: USER_A }),
    ).toThrow(/SYNC_DEV_USER_ID/);
    // Omitted NODE_ENV defaults to "development" — the seam must still refuse
    // (a prod box that forgot NODE_ENV must not silently authenticate; T3).
    const noNodeEnv = { DATABASE_URL: baseEnv.DATABASE_URL, WEB_ORIGIN: baseEnv.WEB_ORIGIN };
    expect(() => loadConfig({ ...noNodeEnv, SYNC_DEV_USER_ID: USER_A })).toThrow(
      /SYNC_DEV_USER_ID/,
    );
  });

  it("happy path: 201, workout + sets persisted verbatim, aggregates derived", { timeout: 30_000 }, async () => {
    const wid = "aaaaaaaa-1111-4111-8111-000000000001";
    const res = await post(api(),payload(wid, [set(1), set(2), set(4, { reps: 3, avgFormScore: 90, repScores: [90, 90, 91] })]));
    expect(res.statusCode).toBe(201);
    expect(res.json<Record<string, unknown>>()).toEqual({ workoutId: wid, status: "created" });

    const [w] = await sql`SELECT * FROM workouts WHERE id = ${wid}`;
    expect(w?.["user_id"]).toBe(USER_A);
    expect(w?.["sets_count"]).toBe(3);
    expect(w?.["total_reps"]).toBe(13);
    expect(w?.["avg_form_score"]).toBe(86); // round((84+84+90)/3)
    expect(w?.["duration_ms"]).toBe(63000);
    expect(w?.["kcal_point"]).toBeNull(); // 2B §2.2 deferred (DECISIONS)
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
      const res = await post(api(), bad as { workoutId: string });
      expect(res.statusCode).toBe(400);
    }
    const rows = await sql`SELECT 1 FROM workouts WHERE id = ${wid}`;
    expect(rows.length).toBe(0);
  });

  it("Idempotency-Key mismatch / missing → 400", async () => {
    const wid = "aaaaaaaa-1111-4111-8111-000000000003";
    const body = payload(wid, [set(1)]);
    const mismatch = await inject(api(),body, { "idempotency-key": "aaaaaaaa-1111-4111-8111-000000000099" });
    expect(mismatch.statusCode).toBe(400);
    const missing = await inject(api(),body, {});
    expect(missing.statusCode).toBe(400);
  });

  it("retried sync is a no-op: same POST twice → one workout, one set of rows", { timeout: 30_000 }, async () => {
    const wid = "aaaaaaaa-1111-4111-8111-000000000004";
    const body = payload(wid, [set(1), set(2)]);
    const first = await post(api(),body);
    expect(first.statusCode).toBe(201);
    const second = await post(api(),body);
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
    const results = await Promise.all([post(api(),body), post(api(),body), post(api(),body)]);
    for (const r of results) expect([200, 201]).toContain(r.statusCode);
    const [w] = await sql`SELECT count(*)::int AS n FROM workouts WHERE id = ${wid}`;
    const [s] = await sql`SELECT count(*)::int AS n FROM workout_sets WHERE workout_id = ${wid}`;
    expect(w?.["n"]).toBe(1);
    expect(s?.["n"]).toBe(1);
  });

  it("cross-tenant denial: user B posting user A's workoutId → 404, rows untouched", { timeout: 30_000 }, async () => {
    const wid = "aaaaaaaa-1111-4111-8111-000000000006";
    await post(api(),payload(wid, [set(1)])); // owned by USER_A
    const appB = await buildApp(loadConfig({ ...baseEnv, SYNC_DEV_USER_ID: USER_B }));
    const res = await post(appB, payload(wid, [set(1), set(2)]));
    expect(res.statusCode).toBe(404);
    const [s] = await sql`SELECT count(*)::int AS n FROM workout_sets WHERE workout_id = ${wid}`;
    expect(s?.["n"]).toBe(1); // B's extra set was NOT attached to A's workout
    await appB.close();
    // NOTE for P2.1: with real authn this case must be re-proven end-to-end
    // (cookie of B, workout of A) — here the seam substitutes the identity.
  });

  it("unknown exercise slug: workout accepted (200-class, NOT a parking 4xx), set skipped + flagged", { timeout: 30_000 }, async () => {
    const wid = "aaaaaaaa-1111-4111-8111-000000000007";
    const res = await post(api(),payload(wid, [set(1), set(2, { exercise: "not_in_catalog" })]));
    expect(res.statusCode).toBe(201);
    const [w] = await sql`
      SELECT sets_count, total_reps, quality_flags FROM workouts WHERE id = ${wid}`;
    expect(w?.["sets_count"]).toBe(1); // aggregates cover persisted sets only
    expect(w?.["quality_flags"]).toEqual(["unknown_exercise"]);
    const [s] = await sql`SELECT count(*)::int AS n FROM workout_sets WHERE workout_id = ${wid}`;
    expect(s?.["n"]).toBe(1);
  });
});
