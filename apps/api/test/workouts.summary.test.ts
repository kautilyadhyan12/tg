// GET /v1/workouts/:id/summary against REAL Postgres (R9.2) — the post-workout
// screen's payload. DATABASE_URL-gated, same rig as workouts.history.test.ts.
//
// Two things this file is for beyond the happy path:
//   1. THE CROSS-TENANT DENIAL (R3.2) — a foreign id must read as absent.
//   2. THE PERMANENT GUARD (Kd's review/fix rule 5, DECISIONS :5348): a
//      table-driven sweep asserting EVERY workout-scoped :id route denies
//      another user's id. Cross-account leakage is the class this card is most
//      exposed to, and a guard over the route TABLE catches the route someone
//      adds next year, which a per-route test never will.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { seed } from "../src/db/seed.js";
import { workoutSummarySchema } from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "summary-test-secret-0123456789ab-32", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;

const daysAgoIso = (offsetDays: number): string => {
  const d0 = new Date();
  const utcNoon = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate(), 12, 0, 0);
  return new Date(utcNoon - offsetDays * 86_400_000).toISOString();
};

const engineSet = (setIndex: number, opts: { durationMs?: number; score?: number; exercise?: string } = {}) => ({
  exercise: opts.exercise ?? "squat",
  setIndex,
  reps: 5,
  durationMs: opts.durationMs ?? 21_000,
  avgFormScore: opts.score ?? 84,
  repScores: [80, 82, 85, 86, 87],
  faultCounts: {},
  tempoMsAvg: 3900,
  romStats: null,
  view: "side",
  holdMs: null,
  calibration: null,
  engineVersion: "1.0.0",
  definitionVersion: 1,
});

/** A hand-counted set — nothing scored it, so the summary must say so rather
 *  than grade it.
 *
 *  Every scoring field is spelled out as an explicit NULL because that is what
 *  the contract's log-only branch demands (`logOnlySetSummarySchema` is
 *  `.strict()` and pins each one). Omitting them makes the whole payload fail
 *  the union and the sync 400s — which is how the first run of this suite
 *  produced a 404 from the summary route and looked like a summary bug. */
const logOnlySet = (setIndex: number, exercise = "squat") => ({
  exercise,
  setIndex,
  mode: "log_only" as const,
  reps: 8,
  durationMs: 30_000,
  tempoMsAvg: null,
  romStats: null,
  holdMs: null,
  // 'unknown', NOT null: `viewSchema` is an enum of front|side|unknown with no
  // null member, and a hand-counted set has no camera view to report — which is
  // precisely what 'unknown' means. (Written as null first; the union error
  // named it.)
  view: "unknown" as const,
  calibration: null,
  avgFormScore: null,
  repScores: null,
  faultCounts: {},
  engineVersion: null,
  definitionVersion: null,
});

d("GET /v1/workouts/:id/summary (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  let cookieA = "";
  let cookieB = "";
  let userA = "";
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const inject = (opts: {
    method: "GET" | "POST";
    url: string;
    body?: unknown;
    access?: string;
    headers?: Record<string, string>;
  }) =>
    api().inject({
      method: opts.method,
      url: opts.url,
      headers: {
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(opts.headers ?? {}),
      },
      cookies: opts.access !== undefined && opts.access !== "" ? { accessToken: opts.access } : {},
      ...(opts.body !== undefined ? { payload: JSON.stringify(opts.body) } : {}),
    });

  const session = async (email: string): Promise<{ userId: string; access: string }> => {
    const reg = await inject({
      method: "POST",
      url: "/v1/auth/register",
      body: { email, password: PASSWORD, displayName: "Summary Fixture" },
    });
    if (reg.statusCode !== 201) throw new Error(`register failed: ${reg.body}`);
    const { userId } = reg.json<{ userId: string }>();
    const login = await inject({
      method: "POST",
      url: "/v1/auth/login",
      body: { email, password: PASSWORD },
    });
    const access = login.cookies.find((c) => c.name === "accessToken")?.value ?? "";
    return { userId, access };
  };

  /** Sync a workout, and FAIL LOUDLY if the fixture itself was rejected.
   *
   *  The throw is the point. On this suite's first run a malformed log-only
   *  fixture 400'd here, the workout was never stored, and the summary route
   *  correctly answered 404 — which surfaced as "the summary is broken". A
   *  setup step that fails silently turns every assertion downstream of it into
   *  a claim about the wrong thing (:5034's "a smoke doc's SETUP is part of the
   *  claim", one level in). */
  const sync = async (workoutId: string, startedAt: string, sets: unknown[], access: string) => {
    const res = await inject({
      method: "POST",
      url: "/v1/workouts/sync",
      body: {
        workoutId,
        startedAt,
        platform: "web",
        engineVersion: "1.0.0",
        defsVersion: 1,
        sets,
        traceSample: null,
      },
      access,
      headers: { "idempotency-key": workoutId },
    });
    if (res.statusCode !== 201 && res.statusCode !== 200) {
      throw new Error(`fixture sync rejected (${String(res.statusCode)}): ${res.body}`);
    }
    return res;
  };

  const summary = (id: string, access: string) =>
    inject({ method: "GET", url: `/v1/workouts/${id}/summary`, access });

  beforeAll(async () => {
    await seed(url ?? "");
    await sql`DELETE FROM workouts WHERE user_id IN
      (SELECT id FROM users WHERE email LIKE 'sum-%@example.com')`;
    await sql`DELETE FROM users WHERE email LIKE 'sum-%@example.com'`;
    app = await buildApp(loadConfig(baseEnv));
    const a = await session("sum-alice@example.com");
    const b = await session("sum-bob@example.com");
    userA = a.userId;
    cookieA = a.access;
    cookieB = b.access;
  }, 120_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    await sql.end({ timeout: 5 });
  });

  it("serves the workout's OWN numbers, and the payload satisfies the shared contract", { timeout: 30_000 }, async () => {
    const id = crypto.randomUUID();
    // Two squat sets of 21 s and 39 s = 60 s active; chair_squat makes it two
    // DISTINCT exercises across three sets, which is what exercisesCount counts.
    await sync(
      id,
      daysAgoIso(3),
      [
        engineSet(1, { durationMs: 21_000 }),
        engineSet(2, { durationMs: 39_000 }),
        engineSet(3, { durationMs: 30_000, exercise: "chair_squat" }),
      ],
      cookieA,
    );

    const res = await summary(id, cookieA);
    expect(res.statusCode).toBe(200);
    // Parse, don't trust: the response must BE the contract, not merely resemble
    // it. A hand-picked field check would pass on a payload missing half its keys.
    const body = workoutSummarySchema.parse(res.json());

    expect(body.workoutId).toBe(id);
    expect(body.activeSeconds).toBe(90); // 21 + 39 + 30
    expect(body.exercisesCount).toBe(2); // squat, chair_squat — not 3 sets
    expect(body.formAccuracy).toBe(84);
    expect(body.caloriesBurned).not.toBeNull();
    // 50 base + 20 excellent-form (84 ≥ 80). No continuation: it is the only day.
    expect(body.xpEarned).toBe(70);
    expect(body.mealSuggestions.length).toBeGreaterThan(0);
    expect(body.stretches.length).toBeGreaterThan(0);
  });

  it("an UNSCORED (all hand-counted) workout reports formAccuracy NULL and base XP only", { timeout: 30_000 }, async () => {
    const id = crypto.randomUUID();
    await sync(id, daysAgoIso(30), [logOnlySet(1), logOnlySet(2)], cookieA);

    const res = await summary(id, cookieA);
    expect(res.statusCode).toBe(200);
    const body = workoutSummarySchema.parse(res.json());
    // NULL, never 0. A 0 here renders as grade D — "Keep practicing" in red —
    // on a workout nobody scored, which is :2444's defect exactly.
    expect(body.formAccuracy).toBeNull();
    expect(body.xpEarned).toBe(50);
    expect(body.activeSeconds).toBe(60);
  });

  it("the streak-continuation bonus lands on a workout the day after another", { timeout: 30_000 }, async () => {
    // Two consecutive days, so the SECOND is a continuation and earns +10.
    // Asserted end-to-end (not just in the unit test) because the day bucketing
    // runs through the user's timezone and the DB, neither of which the pure
    // function sees.
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    await sync(first, daysAgoIso(11), [logOnlySet(1)], cookieA);
    await sync(second, daysAgoIso(10), [logOnlySet(1)], cookieA);

    const firstBody = workoutSummarySchema.parse((await summary(first, cookieA)).json());
    const secondBody = workoutSummarySchema.parse((await summary(second, cookieA)).json());
    expect(firstBody.xpEarned).toBe(50); // nothing before it
    expect(secondBody.xpEarned).toBe(60); // 50 + streak_day
  });

  it("names a personal record the workout actually holds, and stays silent otherwise", { timeout: 30_000 }, async () => {
    // A deliberately huge workout so it takes the duration record outright.
    const big = crypto.randomUUID();
    await sync(big, daysAgoIso(1), [engineSet(1, { durationMs: 600_000, score: 95 })], cookieA);
    const bigBody = workoutSummarySchema.parse((await summary(big, cookieA)).json());
    expect(bigBody.personalRecords).toContain("Longest workout session!");

    // …and a small one on the same account claims nothing.
    const small = crypto.randomUUID();
    await sync(small, daysAgoIso(1), [engineSet(1, { durationMs: 5_000, score: 60 })], cookieA);
    const smallBody = workoutSummarySchema.parse((await summary(small, cookieA)).json());
    expect(smallBody.personalRecords).not.toContain("Longest workout session!");
  });

  it("meal ideas follow the workout's OWN calorie band", { timeout: 30_000 }, async () => {
    // An hour of jump_squat (met 8.0, 70 kg fallback) = 8 × 70 × 1 h = 560 kcal,
    // which clears the >400 band; the tiny workout above sits in the low one.
    // Same account, different answers — which is the whole point of the card:
    // the old rig served one canned payload for every workout, so this screen
    // was unjudgeable. (First written as 30 minutes = 280 kcal, which is the
    // MIDDLE band — the arithmetic, not the code, was wrong.)
    const hot = crypto.randomUUID();
    await sync(hot, daysAgoIso(1), [engineSet(1, { durationMs: 3_600_000, exercise: "jump_squat" })], cookieA);
    const hotBody = workoutSummarySchema.parse((await summary(hot, cookieA)).json());
    expect(hotBody.caloriesBurned ?? 0).toBeGreaterThan(400);
    expect(hotBody.mealSuggestions).toHaveLength(3);
    expect(hotBody.mealSuggestions[0]?.meal).toBe("Protein shake + banana");
  });

  it("CROSS-TENANT: another user's workout is 404, byte-identical to an unknown id (R3.2)", { timeout: 30_000 }, async () => {
    const id = crypto.randomUUID();
    await sync(id, daysAgoIso(4), [engineSet(1)], cookieA);
    // It exists and Alice can read it…
    expect((await summary(id, cookieA)).statusCode).toBe(200);

    // …and to Bob it is indistinguishable from a workout that never existed.
    const foreign = await summary(id, cookieB);
    const unknown = await summary(crypto.randomUUID(), cookieB);
    expect(foreign.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(404);
    // Same body shape too: a different message would be an existence oracle.
    expect(foreign.json<{ error: string }>().error).toBe(unknown.json<{ error: string }>().error);
  });

  it("a non-uuid id is 404, not a 500 from the SQL layer", { timeout: 30_000 }, async () => {
    expect((await summary("not-a-uuid", cookieA)).statusCode).toBe(404);
  });

  it("signed out is 401 — authn runs before anything reads the DB", { timeout: 30_000 }, async () => {
    expect((await summary(crypto.randomUUID(), "")).statusCode).toBe(401);
  });

  // ── THE PERMANENT GUARD (Kd's rule 5) ──────────────────────────────────────
  // Not "does the summary deny a foreign id" — that is the test above. This
  // asserts the PROPERTY over every workout-scoped :id route at once, so a route
  // added later is covered by construction. Extend the list when you add one;
  // the guard's own first assertion fails if the list is empty, because a sweep
  // over nothing is the shape that has already reported a false pass in this
  // project (:4855, a run where not one mutant executed).
  it("GUARD: every workout-scoped :id route denies another user's id", { timeout: 30_000 }, async () => {
    const id = crypto.randomUUID();
    await sync(id, daysAgoIso(6), [engineSet(1)], cookieA);

    const routes = [`/v1/workouts/${id}`, `/v1/workouts/${id}/summary`];
    expect(routes.length).toBeGreaterThan(0);

    for (const route of routes) {
      const mine = await inject({ method: "GET", url: route, access: cookieA });
      const theirs = await inject({ method: "GET", url: route, access: cookieB });
      const anon = await inject({ method: "GET", url: route, access: "" });
      // The owner can read it — without this the denial below would pass on a
      // route that is simply broken for everyone.
      expect(mine.statusCode, `${route} for its owner`).toBe(200);
      expect(theirs.statusCode, `${route} for a stranger`).toBe(404);
      expect(anon.statusCode, `${route} signed out`).toBe(401);
      expect(theirs.body, `${route} must not leak the workout to a stranger`).not.toContain(id);
    }
  });

  it("GUARD: the summary never contains another user's workout id", { timeout: 30_000 }, async () => {
    // Belt and braces on the same class from the other direction: Bob syncs his
    // own workout, then reads his own summary, and Alice's ids appear nowhere.
    const alice = crypto.randomUUID();
    const bob = crypto.randomUUID();
    await sync(alice, daysAgoIso(7), [engineSet(1)], cookieA);
    await sync(bob, daysAgoIso(7), [engineSet(1)], cookieB);
    const res = await summary(bob, cookieB);
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(alice);
    expect(res.body).not.toContain(userA);
  });
});
