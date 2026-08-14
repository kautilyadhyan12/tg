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

/** A set the user counted themselves (Part 6 §3.6 log-only mode). Every scoring
 *  field is at its empty value, because nothing measured this set. */
const logSet = (setIndex: number, extra: Record<string, unknown> = {}) => ({
  exercise: "squat",
  setIndex,
  reps: 10,
  durationMs: 30000,
  mode: "log_only",
  avgFormScore: null,
  repScores: null, // T3 F5: the contract says NULL, exactly as the column does
  faultCounts: {},
  tempoMsAvg: null,
  romStats: null,
  view: "unknown",
  holdMs: null,
  calibration: null,
  engineVersion: null,
  definitionVersion: null,
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
      // A startedAt that PASSES the date FORMAT check and is not a real
      // instant: `+25:30` is an offset no clock has. The schema refuses it now
      // (T3 round 1 on the date window, the class fix) — asserted HERE, at the
      // route, because the schema test proves what the parser does and this
      // proves what the ENDPOINT does. Without it the class fix's sync half is
      // a promise the API layer never makes: the same string used to reach the
      // driver and answer 500, which the client's retry policy reads as
      // transient and would replay forever.
      { ...payload(wid, [set(1)]), startedAt: "2026-07-10T09:30:00+25:30" },
      // The 2026-08-07 duration/rest fields: negative, zero-duration, non-int
      // and over-int4-in-ms values are all refused at the parse boundary —
      // a value Zod passed but PG overflowed would 500, which the client's
      // retry policy reads as transient (a poison payload, P1.10d T3).
      { ...payload(wid, [set(1)]), durationSeconds: -5 },
      { ...payload(wid, [set(1)]), durationSeconds: 0 },
      { ...payload(wid, [set(1)]), durationSeconds: 2_147_484 }, // floor(INT4_MAX/1000) + 1
      { ...payload(wid, [set(1)]), durationSeconds: 90.5 },
      { ...payload(wid, [set(1)]), restSeconds: -1 },
      { ...payload(wid, [set(1)]), restSeconds: 2_147_484 },
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

  it("durationSeconds + restSeconds → timer stored as duration_ms, kcal v2 stamped and computed", { timeout: 30_000 }, async () => {
    const wid = "aaaaaaaa-1111-4111-8111-000000000010";
    // One engine set: span 21000 ms, 5 reps × 3900 ms tempo → 19500 ms of rep
    // time at MET 6 (squat, seed), 1500 ms of in-set idle at REST_MET 1.8.
    // Timer 300 s (cap not binding: 300000 − 19500 ≫ 1500) + 60 s rest.
    // kcal = 6×70×(19500/3.6e6) + 1.8×70×((1500 + 60000)/3.6e6)
    //      = 2.275 + 2.1525 = 4.4275 → 4.  (v1 on this payload was 2.45 → 2.)
    const body = { ...payload(wid, [set(1)]), durationSeconds: 300, restSeconds: 60 };
    const res = await post(body);
    expect(res.statusCode).toBe(201);
    const [w] = await sql`SELECT duration_ms, kcal_point, kcal_calc_version FROM workouts WHERE id = ${wid}`;
    expect(w?.["duration_ms"]).toBe(300_000); // the TIMER, not Σ set spans (21000)
    expect(w?.["kcal_calc_version"]).toBe(2);
    expect(w?.["kcal_point"]).toBe(4);

    // A retry carrying a DIFFERENT timer is still a no-op: the stored duration
    // is the first write's (ON CONFLICT DO NOTHING), never silently re-priced.
    const retryBody = { ...body, durationSeconds: 900 };
    const retry = await post(retryBody);
    expect(retry.statusCode).toBe(200);
    expect(retry.json<Record<string, unknown>>()).toEqual({ workoutId: wid, status: "duplicate" });
    const [after] = await sql`SELECT duration_ms, kcal_point FROM workouts WHERE id = ${wid}`;
    expect(after?.["duration_ms"]).toBe(300_000);
    expect(after?.["kcal_point"]).toBe(4);
  });

  it("watchedMs → stored, kcal v3 stamped, and the UNWATCHED stretch costs nothing", { timeout: 30_000 }, async () => {
    // The 2026-08-14 card end to end. Same set as the v2 test — span 21000 ms,
    // 5 reps, tempo 3900 — but the camera could only WATCH 6000 ms of it.
    // v3 charges the watched time at MET 6 and the unwatched 15000 ms at
    // nothing (v2 would have billed it at REST_MET):
    //   6×70×(6000/3.6e6) + 1.8×70×(60000/3.6e6) = 0.7 + 2.1 = 2.8 → 3.
    // The v2 test above prices the SAME payload without watchedMs at 4, so the
    // stamp and the number both move — a version that changed the stamp alone
    // would pass a weaker assertion than this one.
    const wid = "aaaaaaaa-1111-4111-8111-000000000012";
    const body = {
      ...payload(wid, [set(1, { watchedMs: 6000 })]),
      durationSeconds: 300,
      restSeconds: 60,
    };
    expect((await post(body)).statusCode).toBe(201);
    const [w] = await sql`SELECT kcal_point, kcal_calc_version FROM workouts WHERE id = ${wid}`;
    expect(w?.["kcal_calc_version"]).toBe(3);
    expect(w?.["kcal_point"]).toBe(3);
    const [s] = await sql`SELECT watched_ms FROM workout_sets WHERE workout_id = ${wid}`;
    expect(s?.["watched_ms"]).toBe(6000);
  });

  it("a set the camera watched end to end prices EXACTLY as v2 priced it", { timeout: 30_000 }, async () => {
    // THE PROMISE MADE TO KD IN THE PLAN: an ordinary workout, where nothing was
    // ever out of shot, does not change at all. Watched == span, so v3's rep
    // term collapses to v2's and the in-set idle is the same 1500 ms:
    //   6×70×(19500/3.6e6) + 1.8×70×((1500+60000)/3.6e6) = 4.4275 → 4,
    // the identical figure the v2 test asserts on the identical sets.
    const wid = "aaaaaaaa-1111-4111-8111-000000000013";
    const body = {
      ...payload(wid, [set(1, { watchedMs: 21_000 })]),
      durationSeconds: 300,
      restSeconds: 60,
    };
    expect((await post(body)).statusCode).toBe(201);
    const [w] = await sql`SELECT kcal_point, kcal_calc_version FROM workouts WHERE id = ${wid}`;
    expect(w?.["kcal_calc_version"]).toBe(3);
    expect(w?.["kcal_point"]).toBe(4);
  });

  it("a watched time longer than the set is CLAMPED on the way in, not trusted", { timeout: 30_000 }, async () => {
    // R3.1 / v1 §14: the client measures it, the server bills from it, so the
    // one thing it may never do is exceed the set it describes. Clamped in
    // code rather than by a CHECK on purpose — a constraint violation is a 500
    // and the client's retry policy would jam that user's queue on it forever.
    const wid = "aaaaaaaa-1111-4111-8111-000000000014";
    const body = {
      ...payload(wid, [set(1, { watchedMs: 999_999 })]),
      durationSeconds: 300,
      restSeconds: 60,
    };
    expect((await post(body)).statusCode).toBe(201);
    const [s] = await sql`SELECT watched_ms, duration_ms FROM workout_sets WHERE workout_id = ${wid}`;
    expect(s?.["watched_ms"]).toBe(21_000);
    expect(s?.["watched_ms"]).toBe(s?.["duration_ms"]);
  });

  it("a hand-counted set stores NULL and does not pull the workout into v3", { timeout: 30_000 }, async () => {
    // NULL is "nobody told us", not "watched for zero". A log-only set has no
    // camera behind it, so it must not select a formula named for a number it
    // cannot have — it stays on v2 and prices exactly as it did before.
    const wid = "aaaaaaaa-1111-4111-8111-000000000015";
    const body = { ...payload(wid, [logSet(1)]), durationSeconds: 300, restSeconds: 60 };
    expect((await post(body)).statusCode).toBe(201);
    const [w] = await sql`SELECT kcal_calc_version FROM workouts WHERE id = ${wid}`;
    expect(w?.["kcal_calc_version"]).toBe(2);
    const [s] = await sql`SELECT watched_ms FROM workout_sets WHERE workout_id = ${wid}`;
    expect(s?.["watched_ms"]).toBeNull();
  });

  it("cross-tenant denial: a stranger cannot rewrite the watched time on your workout", { timeout: 30_000 }, async () => {
    // R3.2 on THIS card's column. The two denial tests above prove the route
    // refuses a foreign workoutId; this one proves what that refusal protects
    // now that a stored number decides what a user is billed — user B posting
    // A's id with a wildly different watched time must not move A's row.
    const wid = "aaaaaaaa-1111-4111-8111-000000000016";
    const mine = {
      ...payload(wid, [set(1, { watchedMs: 6000 })]),
      durationSeconds: 300,
      restSeconds: 60,
    };
    expect((await post(mine)).statusCode).toBe(201);
    const theirs = { ...payload(wid, [set(1, { watchedMs: 21_000 })]), durationSeconds: 300, restSeconds: 60 };
    const res = await post(theirs, cookieB);
    expect(res.statusCode).toBe(404);
    const [w] = await sql`SELECT user_id, kcal_point FROM workouts WHERE id = ${wid}`;
    expect(w?.["user_id"]).toBe(userA);
    expect(w?.["kcal_point"]).toBe(3);
    const [s] = await sql`SELECT watched_ms FROM workout_sets WHERE workout_id = ${wid}`;
    expect(s?.["watched_ms"]).toBe(6000);
    const [n] = await sql`SELECT count(*)::int AS n FROM workout_sets WHERE workout_id = ${wid}`;
    expect(n?.["n"]).toBe(1);
  });

  it("fields ABSENT → v1 formula, v1 stamp, Σ-of-sets duration — byte-identical pre-card behaviour", { timeout: 30_000 }, async () => {
    // The happy-path test above already pins this (duration 63000, version 1,
    // kcal 7) — this case exists to say so EXPLICITLY next to the v2 test, and
    // to pin the pair that matters for old queued payloads: same sets, no new
    // fields, nothing about the row changes.
    const wid = "aaaaaaaa-1111-4111-8111-000000000011";
    const res = await post(payload(wid, [set(1)]));
    expect(res.statusCode).toBe(201);
    const [w] = await sql`SELECT duration_ms, kcal_point, kcal_calc_version FROM workouts WHERE id = ${wid}`;
    expect(w?.["duration_ms"]).toBe(21_000); // Σ set spans, as before the card
    expect(w?.["kcal_calc_version"]).toBe(1);
    expect(w?.["kcal_point"]).toBe(2); // 6 × 70 × (21000/3.6e6) = 2.45 → 2
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

  // ── log-only sets (Kd-ruled 2026-08-01) ────────────────────────────────────
  // Part 6 §3.6's degradation floor promises "your workout still counts". Only
  // 3 of the 58 catalog exercises have a definition, so nearly every real set
  // is user-counted; refusing them meant they lived ONLY on the legacy backend,
  // and would be lost outright the day it is switched off.

  it("a log-only set is accepted and stored as one, with no invented provenance", { timeout: 30_000 }, async () => {
    const wid = "aaaaaaaa-1111-4111-8111-000000000008";
    // defsVersion NULL — T3 F3/option A: a client with no definition bundle
    // loaded has no bundle version to report, and `1` would be a lie about
    // which bundle produced this. The workout-level engineVersion stays a real
    // string because it now means "the build the CLIENT was running".
    const body = { ...payload(wid, [logSet(1), logSet(2, { reps: 12 })]), defsVersion: null };
    const res = await inject(body, { "idempotency-key": wid });
    expect(res.statusCode).toBe(201);

    const [bundle] = await sql`SELECT bundle_version FROM workouts WHERE id = ${wid}`;
    expect(bundle?.["bundle_version"]).toBeNull(); // stored as unknown, not as 1

    const [w] = await sql`
      SELECT sets_count, total_reps, avg_form_score, duration_ms FROM workouts WHERE id = ${wid}`;
    expect(w?.["sets_count"]).toBe(2);
    expect(w?.["total_reps"]).toBe(22); // the reps COUNT — that is the promise
    // No set was scored, so the workout has no form score. Not 0 — unknown.
    expect(w?.["avg_form_score"]).toBeNull();

    const sets = await sql<
      {
        mode: string;
        avg_form_score: number | null;
        rep_scores: number[] | null;
        fault_counts: Record<string, number>;
        engine_version: string | null;
        definition_version: number | null;
      }[]
    >`
      SELECT mode, avg_form_score, rep_scores, fault_counts, engine_version,
             definition_version
      FROM workout_sets WHERE workout_id = ${wid} ORDER BY set_index`;
    expect(sets.map((s) => s["mode"])).toEqual(["log_only", "log_only"]);
    for (const s of sets) {
      expect(s["avg_form_score"]).toBeNull();
      // NULL, not []: an empty array would claim a scoring pass that found none.
      expect(s["rep_scores"]).toBeNull();
      expect(s["fault_counts"]).toEqual({});
      expect(s["engine_version"]).toBeNull(); // never a '0'/'none' sentinel
      expect(s["definition_version"]).toBeNull();
    }
  });

  it("a log-only set cannot smuggle a form claim — the schema refuses it", { timeout: 30_000 }, async () => {
    const wid = "aaaaaaaa-1111-4111-8111-000000000009";
    const cases: unknown[] = [
      payload(wid, [logSet(1, { avgFormScore: 95 })]), // a score for a set nothing watched
      payload(wid, [logSet(1, { repScores: [90, 91] })]), // per-rep scores likewise
      payload(wid, [logSet(1, { repScores: [] })]), // and not even an empty array (F5)
      payload(wid, [logSet(1, { faultCounts: { shallow_depth: 1 } })]), // faults likewise
      payload(wid, [logSet(1, { engineVersion: "1.0.0" })]), // provenance it does not have
      payload(wid, [logSet(1, { definitionVersion: 1 })]),
    ];
    for (const bad of cases) {
      const res = await inject(bad, { "idempotency-key": wid });
      expect(res.statusCode).toBe(400);
    }
    const rows = await sql`SELECT 1 FROM workouts WHERE id = ${wid}`;
    expect(rows.length).toBe(0);
  });

  it("an ENGINE set still MUST carry its provenance — the relaxation is not general", { timeout: 30_000 }, async () => {
    const wid = "aaaaaaaa-1111-4111-8111-00000000000a";
    const cases: unknown[] = [
      payload(wid, [set(1, { engineVersion: null })]),
      payload(wid, [set(1, { definitionVersion: null })]),
      payload(wid, [set(1, { mode: "engine", engineVersion: null })]),
      payload(wid, [set(1, { mode: "made_up_mode" })]), // only two kinds exist
      payload(wid, [set(1, { engineVersion: "" })]), // F6: an empty version proves nothing
      { ...payload(wid, [set(1)]), engineVersion: "" }, // F3: nor at workout level
    ];
    for (const bad of cases) {
      const res = await inject(bad, { "idempotency-key": wid });
      expect(res.statusCode).toBe(400);
    }
    const rows = await sql`SELECT 1 FROM workouts WHERE id = ${wid}`;
    expect(rows.length).toBe(0);
  });

  it("a payload with NO mode is still accepted and stored as engine (older clients)", { timeout: 30_000 }, async () => {
    const wid = "aaaaaaaa-1111-4111-8111-00000000000b";
    // `set()` omits `mode` entirely — the shape every client shipped before this
    // card sends. It must keep working, and must not be recorded as unknown.
    const res = await post(payload(wid, [set(1)]));
    expect(res.statusCode).toBe(201);
    const [s] = await sql`SELECT mode FROM workout_sets WHERE workout_id = ${wid}`;
    expect(s?.["mode"]).toBe("engine");
  });

  it("a MIXED workout keeps each kind honest, and averages only what was scored", { timeout: 30_000 }, async () => {
    const wid = "aaaaaaaa-1111-4111-8111-00000000000c";
    const res = await post(payload(wid, [set(1, { avgFormScore: 90 }), logSet(2, { reps: 10 })]));
    expect(res.statusCode).toBe(201);

    const [w] = await sql`
      SELECT sets_count, total_reps, avg_form_score FROM workouts WHERE id = ${wid}`;
    expect(w?.["sets_count"]).toBe(2);
    expect(w?.["total_reps"]).toBe(15); // 5 scored + 10 typed: both count
    // 90, NOT round((90+0)/2)=45. The unscored set must not drag the average
    // down as though it had scored zero.
    expect(w?.["avg_form_score"]).toBe(90);

    const sets = await sql<{ mode: string }[]>`
      SELECT mode FROM workout_sets WHERE workout_id = ${wid} ORDER BY set_index`;
    expect(sets.map((s) => s["mode"])).toEqual(["engine", "log_only"]);
  });

  it("the detail read tells the two kinds apart", { timeout: 30_000 }, async () => {
    const wid = "aaaaaaaa-1111-4111-8111-00000000000d";
    await post(payload(wid, [set(1), logSet(2)]));
    const res = await api().inject({
      method: "GET",
      url: `/v1/workouts/${wid}`,
      cookies: { accessToken: cookieA },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      sets: { mode: string | null; engineVersion: string | null; repScores: number[] | null }[];
    }>();
    expect(body.sets.map((s) => s.mode)).toEqual(["engine", "log_only"]);
    expect(body.sets[1]?.engineVersion).toBeNull();
    // Served as null, not [] — a reader must be able to see there was no scoring.
    expect(body.sets[1]?.repScores).toBeNull();
  });

  it("cross-tenant denial holds for a log-only workout too", { timeout: 30_000 }, async () => {
    const wid = "aaaaaaaa-1111-4111-8111-00000000000e";
    await post(payload(wid, [logSet(1)])); // user A creates it
    const res = await api().inject({
      method: "POST",
      url: "/v1/workouts/sync",
      headers: { "idempotency-key": wid },
      cookies: { accessToken: cookieB }, // user B claims the same id
      payload: payload(wid, [logSet(1, { reps: 99 })]),
    });
    expect(res.statusCode).toBe(404);
    const [w] = await sql`SELECT user_id, total_reps FROM workouts WHERE id = ${wid}`;
    expect(w?.["user_id"]).toBe(userA); // ownership and data untouched
    // A's original logSet reps (10), NOT B's attempted 99 — asserted against
    // both numbers so this cannot pass by coincidence if the fixture changes.
    expect(w?.["total_reps"]).toBe(10);
    expect(w?.["total_reps"]).not.toBe(99);
  });
});
