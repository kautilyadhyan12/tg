// P2.3 — history/progress/gamification routes + sync-side effects against
// REAL Postgres (R9.2). DATABASE_URL-gated; requires migrations 0001–0004 and
// runs the seed (exercises + achievements). Fixture days are RELATIVE to the
// run date so streak reconciliation can never rot the suite.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { seed } from "../src/db/seed.js";
import { lockXpForUser } from "../src/modules/gamification/repo.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "history-test-secret-0123456789abcd-32", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;

/** ISO instant `offsetDays` ago at a fixed mid-day UTC hour (stays inside the
 *  same UTC calendar day regardless of when the suite runs). */
const daysAgoIso = (offsetDays: number): string => {
  const d0 = new Date();
  const utcNoon = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate(), 12, 0, 0);
  return new Date(utcNoon - offsetDays * 86_400_000).toISOString();
};
const dayOf = (iso: string): string => iso.slice(0, 10);

const squatSet = (setIndex: number, durationMs = 21_000) => ({
  exercise: "squat",
  setIndex,
  reps: 5,
  durationMs,
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
});

d("workouts history + progress + gamification (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  let userA = "";
  let cookieA = "";
  let cookieB = "";
  let userB = "";
  const workoutIds: string[] = [];
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const inject = (opts: {
    method: "GET" | "POST" | "PATCH";
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
      body: { email, password: PASSWORD, displayName: "P23 Fixture" },
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

  const sync = async (workoutId: string, startedAt: string, sets: unknown[], access = cookieA) => {
    const res = await inject({
      method: "POST",
      url: "/v1/workouts/sync",
      body: { workoutId, startedAt, platform: "web", engineVersion: "1.0.0", defsVersion: 1, sets, traceSample: null },
      access,
      headers: { "idempotency-key": workoutId },
    });
    return res;
  };

  beforeAll(async () => {
    await seed(url ?? "");
    await sql`DELETE FROM workouts WHERE user_id IN
      (SELECT id FROM users WHERE email LIKE 'p23-%@example.com')`;
    await sql`DELETE FROM users WHERE email LIKE 'p23-%@example.com'`;
    app = await buildApp(loadConfig(baseEnv));
    const a = await session("p23-alice@example.com");
    const b = await session("p23-bob@example.com");
    userA = a.userId;
    cookieA = a.access;
    userB = b.userId;
    cookieB = b.access;
  }, 120_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    await sql.end({ timeout: 5 });
  });

  it("sync computes kcal server-side (2B §2.2: MET×weight×hours, 70 kg fallback) and starts the streak", { timeout: 30_000 }, async () => {
    const id = crypto.randomUUID();
    workoutIds.push(id);
    const startedAt = daysAgoIso(2);
    const res = await sync(id, startedAt, [squatSet(1), squatSet(2)]);
    expect(res.statusCode).toBe(201);

    const [w] = await sql<{ kcal_point: number; kcal_calc_version: number }[]>`
      SELECT kcal_point, kcal_calc_version FROM workouts WHERE id = ${id}`;
    // squat met 6.0 (seed), no weight → 70 kg: 2 × (6×70×21000/3.6e6) = 4.9 → 5
    expect(w?.kcal_point).toBe(5);
    expect(w?.kcal_calc_version).toBe(1);

    const [s] = await sql<{ current: number; last_activity_date: string }[]>`
      SELECT current, last_activity_date::text FROM streaks WHERE user_id = ${userA}`;
    expect(s?.current).toBe(1);
    expect(s?.last_activity_date).toBe(dayOf(startedAt)); // UTC fallback (GAP-3)

    const earned = await sql<{ code: string }[]>`
      SELECT code FROM user_achievements WHERE user_id = ${userA}`;
    expect(earned.map((e) => e.code)).toContain("first_workout");
  });

  it("a RETRIED sync (same Idempotency-Key) changes nothing: kcal, streak, awards (R3.5)", { timeout: 30_000 }, async () => {
    const id = workoutIds[0];
    if (id === undefined) throw new Error("fixture ordering");
    const res = await sync(id, daysAgoIso(2), [squatSet(1), squatSet(2)]);
    expect(res.statusCode).toBe(200);
    expect(res.json<{ status: string }>().status).toBe("duplicate");

    const [w] = await sql<{ kcal_point: number }[]>`SELECT kcal_point FROM workouts WHERE id = ${id}`;
    expect(w?.kcal_point).toBe(5);
    const [s] = await sql<{ current: number }[]>`SELECT current FROM streaks WHERE user_id = ${userA}`;
    expect(s?.current).toBe(1);
    const n = await sql<{ code: string }[]>`
      SELECT code FROM user_achievements WHERE user_id = ${userA} AND code = 'first_workout'`;
    expect(n.length).toBe(1);
    // XP is RECOMPUTED, not $inc'd, so the retry leaves it unchanged — a naive
    // increment would read 240. 50 base + 20 excellent-form + 50 bronze badge.
    const [x] = await sql<{ total_xp: number }[]>`SELECT total_xp FROM user_xp WHERE user_id = ${userA}`;
    expect(x?.total_xp).toBe(120);
  });

  it("real weight changes the kcal number (2B §2.3's accuracy lever)", { timeout: 30_000 }, async () => {
    const patch = await inject({ method: "PATCH", url: "/v1/users/me", body: { weightKg: 100 }, access: cookieA });
    expect(patch.statusCode).toBe(200);
    const id = crypto.randomUUID();
    workoutIds.push(id);
    await sync(id, daysAgoIso(2), [squatSet(1, 3_600_000)]); // 1 h active
    const [w] = await sql<{ kcal_point: number }[]>`SELECT kcal_point FROM workouts WHERE id = ${id}`;
    expect(w?.kcal_point).toBe(600); // 6 × 100 × 1h
  });

  it("streak increments across consecutive days; streak_3 lands (Part 7 §3.1)", { timeout: 30_000 }, async () => {
    for (const offset of [1, 0]) {
      const id = crypto.randomUUID();
      workoutIds.push(id);
      const res = await sync(id, daysAgoIso(offset), [squatSet(1)]);
      expect(res.statusCode).toBe(201);
    }
    const [s] = await sql<{ current: number; longest: number }[]>`
      SELECT current, longest FROM streaks WHERE user_id = ${userA}`;
    expect(s?.current).toBe(3);
    expect(s?.longest).toBe(3);
    const earned = await sql<{ code: string }[]>`
      SELECT code FROM user_achievements WHERE user_id = ${userA}`;
    expect(earned.map((e) => e.code)).toContain("streak_3");
  });

  it("GET /v1/workouts pages by cursor without dupes; foreign user sees nothing (R3.2)", { timeout: 30_000 }, async () => {
    const all = await inject({ method: "GET", url: "/v1/workouts?limit=100", access: cookieA });
    expect(all.statusCode).toBe(200);
    const allItems = all.json<{ items: { id: string }[] }>().items;
    expect(allItems.length).toBe(4);

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let hop = 0; hop < 10; hop++) {
      const q: string =
        cursor === null
          ? "/v1/workouts?limit=2"
          : `/v1/workouts?limit=2&cursor=${encodeURIComponent(cursor)}`;
      const page = await inject({ method: "GET", url: q, access: cookieA });
      expect(page.statusCode).toBe(200);
      const body = page.json<{ items: { id: string }[]; nextCursor: string | null }>();
      seen.push(...body.items.map((i) => i.id));
      cursor = body.nextCursor;
      if (cursor === null) break;
    }
    expect(seen).toEqual(allItems.map((i) => i.id));
    expect(new Set(seen).size).toBe(seen.length);

    const asB = await inject({ method: "GET", url: "/v1/workouts?limit=100", access: cookieB });
    expect(asB.json<{ items: unknown[] }>().items.length).toBe(0);
  });

  it("GET /v1/workouts/:id serves the sets to the owner; 404 for foreign and malformed ids", { timeout: 30_000 }, async () => {
    const id = workoutIds[0];
    if (id === undefined) throw new Error("fixture ordering");
    const mine = await inject({ method: "GET", url: `/v1/workouts/${id}`, access: cookieA });
    expect(mine.statusCode).toBe(200);
    const detail = mine.json<{ sets: { exerciseSlug: string; faultCounts: Record<string, number> }[] }>();
    expect(detail.sets.length).toBe(2);
    expect(detail.sets[0]?.exerciseSlug).toBe("squat");
    expect(detail.sets[0]?.faultCounts).toEqual({ shallow_depth: 2 });

    expect((await inject({ method: "GET", url: `/v1/workouts/${id}`, access: cookieB })).statusCode).toBe(404);
    expect((await inject({ method: "GET", url: "/v1/workouts/not-a-uuid", access: cookieA })).statusCode).toBe(404);
  });

  it("progress endpoints aggregate correctly (progress.py port)", { timeout: 30_000 }, async () => {
    const overview = await inject({ method: "GET", url: "/v1/progress/overview?period=7d", access: cookieA });
    expect(overview.statusCode).toBe(200);
    const o = overview.json<{
      totalWorkouts: number;
      totalKcal: number;
      avgFormScore: number;
      currentStreak: number;
      longestStreak: number;
      consistencyPct: number;
    }>();
    expect(o.totalWorkouts).toBe(4);
    expect(o.totalKcal).toBe(5 + 600 + 4 + 4); // per-workout points, summed
    expect(o.avgFormScore).toBe(84);
    expect(o.currentStreak).toBe(3);
    expect(o.longestStreak).toBe(3);
    expect(o.consistencyPct).toBe(Math.min(100, Math.round((4 / 7) * 100)));

    const trend = await inject({ method: "GET", url: "/v1/progress/trend?period=30d", access: cookieA });
    const points = trend.json<{ points: { date: string; workouts: number }[] }>().points;
    expect(points.length).toBe(3); // three distinct days
    expect(points.reduce((a, p) => a + p.workouts, 0)).toBe(4);

    const heatmap = await inject({ method: "GET", url: "/v1/progress/heatmap", access: cookieA });
    expect(heatmap.json<{ days: unknown[] }>().days.length).toBe(3);

    const dist = await inject({ method: "GET", url: "/v1/progress/distribution?period=30d", access: cookieA });
    expect(dist.json<{ families: { family: string; sets: number }[] }>().families).toEqual([
      { family: "F1", sets: 5 },
    ]);

    const records = await inject({ method: "GET", url: "/v1/progress/records", access: cookieA });
    const r = records.json<{
      maxKcalWorkout: { workoutId: string; value: number } | null;
      longestWorkout: { value: number } | null;
      bestAvgForm: { value: number } | null;
      totalWorkouts: number;
      longestStreak: number;
    }>();
    expect(r.maxKcalWorkout?.value).toBe(600);
    expect(r.maxKcalWorkout?.workoutId).toBe(workoutIds[1]);
    expect(r.longestWorkout?.value).toBe(3_600_000);
    expect(r.bestAvgForm?.value).toBe(84);
    expect(r.totalWorkouts).toBe(4);
    expect(r.longestStreak).toBe(3);
  });

  it("progress query is strict: bad period / unknown keys are 400", { timeout: 30_000 }, async () => {
    expect((await inject({ method: "GET", url: "/v1/progress/overview?period=2d", access: cookieA })).statusCode).toBe(400);
    expect((await inject({ method: "GET", url: "/v1/progress/trend?nope=1", access: cookieA })).statusCode).toBe(400);
  });

  it("late offline workout RESTORES a lost streak (Part 7 §3.5 replay — T3 finding 1)", { timeout: 60_000 }, async () => {
    // B works out on day-3 and day-1: the day-2 gap means current = 1.
    await sync(crypto.randomUUID(), daysAgoIso(3), [squatSet(1)], cookieB);
    await sync(crypto.randomUUID(), daysAgoIso(1), [squatSet(1)], cookieB);
    let [s] = await sql<{ current: number }[]>`SELECT current FROM streaks WHERE user_id = ${userB}`;
    expect(s?.current).toBe(1);
    // The missing day arrives late from an offline queue → replay bridges it.
    await sync(crypto.randomUUID(), daysAgoIso(2), [squatSet(1)], cookieB);
    [s] = await sql<{ current: number }[]>`SELECT current FROM streaks WHERE user_id = ${userB}`;
    expect(s?.current).toBe(3);
  });

  it("hook failure heals on retry: erased streak state is recomputed by a duplicate sync (T3 finding 2)", { timeout: 30_000 }, async () => {
    // Simulate "workout committed, hook crashed before persisting": the
    // workout rows exist but the streak row does not.
    await sql`DELETE FROM streaks WHERE user_id = ${userA}`;
    const id = workoutIds[0];
    if (id === undefined) throw new Error("fixture ordering");
    const res = await sync(id, daysAgoIso(2), [squatSet(1), squatSet(2)]);
    expect(res.json<{ status: string }>().status).toBe("duplicate"); // retry path
    const [s] = await sql<{ current: number; longest: number }[]>`
      SELECT current, longest FROM streaks WHERE user_id = ${userA}`;
    expect(s?.current).toBe(3); // fully recomputed from history
    expect(s?.longest).toBe(3);
  });

  it("GET /v1/gamification/me: streak + earned achievements; lazy freeze reconciliation runs (GAP-5)", { timeout: 30_000 }, async () => {
    const me = await inject({ method: "GET", url: "/v1/gamification/me", access: cookieA });
    expect(me.statusCode).toBe(200);
    const body = me.json<{
      streak: { current: number; longest: number; freezesAvailable: number };
      xp: {
        total: number;
        level: number;
        xpInLevel: number;
        xpForNext: number;
        progressPct: number;
        nextLevelAt: number;
      };
      achievements: { code: string }[];
    }>();
    expect(body.streak.current).toBe(3);
    const codes = body.achievements.map((a) => a.code);
    expect(codes).toEqual(expect.arrayContaining(["first_workout", "streak_3"]));
    // 4 workouts (all excellent form) + 2 streak-continuation days + 2 bronze
    // badges = 200 + 80 + 20 + 100 = 400 → level 3 (base 348, next 722).
    expect(body.xp).toEqual({
      total: 400,
      level: 3,
      xpInLevel: 52,
      xpForNext: 374,
      progressPct: 13.9,
      nextLevelAt: 722,
    });

    // E2E of the lazy sweep: user B is handed a streak with a missed day and
    // one banked freeze — reading /me must spend it and keep the streak.
    const missedFrom = dayOf(daysAgoIso(2));
    await sql`
      INSERT INTO streaks (user_id, current, longest, last_activity_date, freezes_available)
      VALUES (${userB}, 5, 5, ${missedFrom}, 1)
      ON CONFLICT (user_id) DO UPDATE SET current = 5, longest = 5,
        last_activity_date = ${missedFrom}, freezes_available = 1`;
    const bMe = await inject({ method: "GET", url: "/v1/gamification/me", access: cookieB });
    const b = bMe.json<{
      streak: { current: number; freezesAvailable: number; lastActivityDate: string };
      xp: { total: number; level: number };
    }>();
    expect(b.streak.current).toBe(5);
    expect(b.streak.freezesAvailable).toBe(0);
    expect(b.streak.lastActivityDate).toBe(dayOf(daysAgoIso(1)));
    // Cross-user isolation: B's XP is B's own (3 workouts + 2 continuations +
    // 2 bronze badges = 150 + 60 + 20 + 100 = 330 → level 2), never A's 400.
    // The manual streak override above does NOT recompute XP (a direct SQL
    // write, not a sync), proving /me reads the STORED value rather than
    // recomputing on read.
    expect(b.xp.total).toBe(330);
    expect(b.xp.level).toBe(2);
  });

  it("XP recompute serializes concurrent syncs even before the user_xp row exists (T3 F1)", { timeout: 30_000 }, async () => {
    // The first-ever-sync case: no user_xp row yet, so a `SELECT … FOR UPDATE`
    // would lock NOTHING and let two syncs race to a lost update. The advisory
    // lock serializes regardless — proven by driving the REAL lockXpForUser on
    // two LIVE transactions (the DPDP concurrency-test precedent, not a
    // sequential stand-in). A random id needs no row: the lock is keyed by user
    // id, not by a row. MUTATION CHECK: emptying lockXpForUser makes B acquire
    // immediately, so the `toBe(false)` below fails.
    const uid = crypto.randomUUID();
    const cA = await sql.reserve();
    const cB = await sql.reserve();
    try {
      await cA`begin`;
      await lockXpForUser(cA, uid); // A holds the advisory lock

      let bAcquired = false;
      const bP = (async () => {
        await cB`begin`;
        await lockXpForUser(cB, uid); // BLOCKS until A commits
        bAcquired = true;
      })();

      await new Promise((r) => setTimeout(r, 400));
      expect(bAcquired).toBe(false); // serialized: B is waiting on A's lock

      await cA`commit`; // release the advisory lock
      await bP;
      expect(bAcquired).toBe(true); // B proceeds only after A committed
      await cB`commit`;
    } finally {
      cA.release();
      cB.release();
    }
  });

  it("history/progress/gamification all 401 without a cookie", { timeout: 30_000 }, async () => {
    for (const path of ["/v1/workouts", "/v1/progress/overview", "/v1/gamification/me"]) {
      expect((await inject({ method: "GET", url: path })).statusCode).toBe(401);
    }
  });
});
