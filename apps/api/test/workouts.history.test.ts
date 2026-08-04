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

  // ── the date window ────────────────────────────────────────────────────────
  // Why it exists: without it a client wanting ONE MONTH must page backwards
  // from today until it arrives, and a capped walk gives up and draws an EMPTY
  // month — which reads as "you never trained" (the web calendar, 2026-08-04).
  // Fixtures above are two workouts at day-2 and one each at day-1 and day-0,
  // all at 12:00 UTC, so every bound below lands cleanly between them.
  it("GET /v1/workouts?from&to returns exactly the window, half-open", { timeout: 30_000 }, async () => {
    const dayTwoOnly = await inject({
      method: "GET",
      url: `/v1/workouts?limit=100&from=${encodeURIComponent(daysAgoIso(2))}&to=${encodeURIComponent(daysAgoIso(1))}`,
      access: cookieA,
    });
    expect(dayTwoOnly.statusCode).toBe(200);
    const older = dayTwoOnly.json<{ items: { id: string; startedAt: string }[] }>().items;
    // `from` INCLUSIVE: both day-2 workouts are in. `to` EXCLUSIVE: the day-1
    // one is not, even though the bound is its exact instant — that is what
    // lets adjacent months tile without double-counting a midnight workout.
    expect(older.length).toBe(2);
    expect(older.every((i) => dayOf(i.startedAt) === dayOf(daysAgoIso(2)))).toBe(true);

    // THE CONTROL. Without it, a window that returns nothing at all would pass
    // the assertion above by simply being broken in the other direction.
    const newer = await inject({
      method: "GET",
      url: `/v1/workouts?limit=100&from=${encodeURIComponent(daysAgoIso(1))}`,
      access: cookieA,
    });
    const recent = newer.json<{ items: { id: string }[] }>().items;
    expect(recent.length).toBe(2);
    expect(recent.map((i) => i.id).some((id) => older.map((o) => o.id).includes(id))).toBe(false);
  });

  it("the window composes with cursor paging, and never leaks another user's rows", { timeout: 30_000 }, async () => {
    const window = `from=${encodeURIComponent(daysAgoIso(2))}&to=${encodeURIComponent(daysAgoIso(1))}`;
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let hop = 0; hop < 5; hop++) {
      const url: string =
        cursor === null
          ? `/v1/workouts?limit=1&${window}`
          : `/v1/workouts?limit=1&${window}&cursor=${encodeURIComponent(cursor)}`;
      const page = await inject({ method: "GET", url, access: cookieA });
      expect(page.statusCode).toBe(200);
      const body = page.json<{ items: { id: string }[]; nextCursor: string | null }>();
      seen.push(...body.items.map((i) => i.id));
      cursor = body.nextCursor;
      if (cursor === null) break;
    }
    expect(seen.length).toBe(2);
    expect(new Set(seen).size).toBe(2);

    // R3.2: the window is not a way around tenancy.
    const asB = await inject({
      method: "GET",
      url: `/v1/workouts?limit=100&${window}`,
      access: cookieB,
    });
    expect(asB.statusCode).toBe(200);
    expect(asB.json<{ items: unknown[] }>().items.length).toBe(0);
  });

  it("a window can NARROW the plan read-gate but never widen it (Part 4 §0.2)", { timeout: 60_000 }, async () => {
    // A user of its own, so the far-past fixture cannot disturb the streak and
    // XP assertions the shared fixtures above and below depend on.
    const c = await session("p23-carol@example.com");
    const old = crypto.randomUUID();
    const recent = crypto.randomUUID();
    expect((await sync(old, daysAgoIso(200), [squatSet(1)], c.access)).statusCode).toBe(201);
    expect((await sync(recent, daysAgoIso(5), [squatSet(1)], c.access)).statusCode).toBe(201);

    const res = await inject({
      method: "GET",
      url: `/v1/workouts?limit=100&from=${encodeURIComponent(daysAgoIso(365))}`,
      access: c.access,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ items: { id: string }[]; limitedToDays: number | null }>();
    // Asked for a year; the free plan's 90-day gate still decides. The stored
    // workout is NOT deleted — it is a read gate — and the response still says
    // so, which is what lets the screen explain itself instead of drawing a
    // blank month (P2.4 GAP-4).
    expect(body.items.map((i) => i.id)).toEqual([recent]);
    expect(body.limitedToDays).toBe(90);
  });

  it("an inverted or unparseable window is a 400, never a silently empty page", { timeout: 30_000 }, async () => {
    const inverted = await inject({
      method: "GET",
      url: `/v1/workouts?from=${encodeURIComponent(daysAgoIso(1))}&to=${encodeURIComponent(daysAgoIso(2))}`,
      access: cookieA,
    });
    // Zero rows would be indistinguishable from "you never trained" — the exact
    // confusion this whole card exists to remove.
    expect(inverted.statusCode).toBe(400);

    const equal = daysAgoIso(2);
    const empty = await inject({
      method: "GET",
      url: `/v1/workouts?from=${encodeURIComponent(equal)}&to=${encodeURIComponent(equal)}`,
      access: cookieA,
    });
    expect(empty.statusCode).toBe(400);

    expect((await inject({ method: "GET", url: "/v1/workouts?from=last-tuesday", access: cookieA })).statusCode).toBe(400);
    expect((await inject({ method: "GET", url: "/v1/workouts?from=2026-08-01", access: cookieA })).statusCode).toBe(400);
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
    expect(b.xp.total).toBe(330);
    expect(b.xp.level).toBe(2);
  });

  it("GET /me READS stored XP — it does not recompute on read", { timeout: 30_000 }, async () => {
    // T3 F1: round 1 claimed the streaks override above proved this. It did
    // NOT — recomputeXp never reads `streaks` (it derives from workouts +
    // activity days + user_achievements), so a recompute-on-read would have
    // returned 330 just the same. The assertion could not fail for the reason
    // it named. This one CAN: poison the stored value with a number no
    // recompute could ever produce; a recompute-on-read clobbers it back to 330.
    // Capture the real value rather than hard-coding the restore (T3 round 3):
    // writing back a literal 330 would duplicate a number the system DERIVES —
    // the same copy-of-a-derived-value shape as the F4 cleanup list.
    const [before] = await sql<{ total_xp: number }[]>`
      SELECT total_xp FROM user_xp WHERE user_id = ${userB}`;
    const stored = before?.total_xp ?? 0;
    try {
      await sql`UPDATE user_xp SET total_xp = 999 WHERE user_id = ${userB}`;
      const me = await inject({ method: "GET", url: "/v1/gamification/me", access: cookieB });
      expect(me.statusCode).toBe(200);
      const body = me.json<{ xp: { total: number; level: number } }>();
      expect(body.xp.total).toBe(999); // stored value served verbatim
      expect(body.xp.level).toBe(4); // …and the level is DERIVED from it (999 ≥ 722)
      // The stored row is untouched by the read (no write-on-read).
      const [row] = await sql<{ total_xp: number }[]>`
        SELECT total_xp FROM user_xp WHERE user_id = ${userB}`;
      expect(row?.total_xp).toBe(999);
    } finally {
      // Restore in a finally so a failed assertion cannot strand the poison.
      await sql`UPDATE user_xp SET total_xp = ${stored} WHERE user_id = ${userB}`;
    }
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
    let releaseA = (): void => {};
    const aHolds = new Promise<void>((r) => (releaseA = r));
    let aLocked = (): void => {};
    const aReady = new Promise<void>((r) => (aLocked = r));

    // A opens a REAL transaction (repo.lockXpForUser only accepts one — T3 F2)
    // and holds the lock until we let go.
    const aP = sql.begin(async (tx) => {
      await lockXpForUser(tx, uid);
      aLocked();
      await aHolds;
    });
    // Race, not a bare await (T3 round 3): if A's transaction REJECTS (pool
    // starvation, connection error) aLocked never fires, so a bare `await
    // aReady` would hang past the `try` — never reaching the finally, leaving
    // aP's rejection unhandled, and reporting a 30 s timeout instead of the
    // real cause. This surfaces A's error as the failure.
    await Promise.race([aReady, aP]);

    // B must get PAST `begin` and be blocked ON THE LOCK ITSELF. Round 1 timed a
    // window that also contained B's `begin` round-trip, so the "not acquired"
    // assertion could pass merely because B had not yet REACHED the lock — a
    // vacuous pass proving nothing (T3 F3). And that is not theoretical: this
    // test FAILED on the first run of the fix because opening B's second Neon
    // connection (TLS handshake) took longer than 400 ms. So B now SIGNALS from
    // inside its transaction and we wait for that signal — no duration is
    // assumed for the setup, and the sleep below measures only BLOCKAGE.
    let bEntered = (): void => {};
    const bInTx = new Promise<void>((r) => (bEntered = r));
    let bAcquired = false;
    const bP = sql.begin(async (tx) => {
      bEntered(); // inside the tx: `begin` has already round-tripped
      await lockXpForUser(tx, uid); // BLOCKS until A commits
      bAcquired = true;
    });

    try {
      await bInTx; // deterministic: B is genuinely inside its transaction
      await new Promise((r) => setTimeout(r, 400));
      expect(bAcquired).toBe(false); // …and genuinely blocked on A's lock

      releaseA(); // A commits, releasing the advisory lock
      await aP;
      await bP;
      expect(bAcquired).toBe(true); // B proceeds only after A committed
    } finally {
      releaseA(); // never strand A's transaction if an assertion throws
      await Promise.allSettled([aP, bP]); // and never leak an unhandled rejection
    }
  });

  it("the SYNC PATH actually takes that lock — the call site, not just the primitive", { timeout: 60_000 }, async () => {
    // T3 round 3: the test above drives lockXpForUser DIRECTLY on a synthetic
    // id, so deleting the call in service.recomputeXp left the whole suite
    // green — a serial recompute is bit-identical with or without a lock. The
    // type only stops the wrong ARGUMENT; it cannot see a DELETED CALL. This
    // test covers the wiring: hold the lock for a REAL user, then drive a real
    // POST /v1/workouts/sync for that user and require it to BLOCK.
    //
    // The proof signal is the LOCK GRAPH, NOT a stopwatch — these syncs take
    // seconds, so "it hadn't finished after N ms" would be the F3 vacuous pass
    // again. And it is scoped to THIS holder's backend pid, because "the only
    // advisory lock in the codebase" does NOT mean "the only contender" (T3
    // round 4): workouts.sync.test.ts fires three concurrent POSTs of one
    // workout for one user, whose duplicate path still runs the hook, and
    // vitest runs suites on up to 4 threads against ONE database — so a plain
    // `pg_locks … NOT granted` count is satisfiable by a foreign suite.
    // `pg_blocking_pids` asks the only question that cannot be answered by
    // anyone else's contention: is a backend blocked BY US?
    let releaseHolder = (): void => {};
    const holderHolds = new Promise<void>((r) => (releaseHolder = r));
    let holderLocked = (): void => {};
    const holderReady = new Promise<void>((r) => (holderLocked = r));
    let holderPid = 0;

    const holderP = sql.begin(async (tx) => {
      const [me] = await tx<{ pid: number }[]>`SELECT pg_backend_pid()::int AS pid`;
      holderPid = me?.pid ?? 0;
      await lockXpForUser(tx, userB); // a REAL user, the one the sync will use
      holderLocked();
      await holderHolds;
    });
    await Promise.race([holderReady, holderP]);

    // try opens HERE (T3 round 4 #5): everything that can throw while the lock
    // is held must be inside it, or a throw strands the holder's transaction on
    // the shared pool and leaks syncP's rejection.
    // Declared OUTSIDE the try so `finally` can DRAIN it (T3 round 5 #4):
    // round 4 narrowed the drain to [holderP], so a throw at the assertions
    // below returned the test with the sync's INSERT still in flight on the
    // shared pool, landing during the next test and teardown. A parked catch
    // silences the warning; it does not stop the write.
    let syncP: Promise<Awaited<ReturnType<typeof sync>>> | undefined;
    try {
      expect(holderPid).toBeGreaterThan(0);

      let syncDone = false;
      // BOTH branches flip the flag (T3 round 5 #1). Round 4 flipped it only on
      // fulfilment, so a REJECTING sync left it false: the poll burned its full
      // 20 s, the `await syncP` that would surface the real error was never
      // reached, and the test reported "expected 0 to be greater than 0" —
      // blaming a deleted call site for a failed request, which is precisely
      // the report #2 was written to eliminate. Worse, round 4's own parked
      // catch (#5) removed the unhandled-rejection warning that had been the
      // last surviving trace of it: two fixes in one commit, the second
      // disarming the first. Re-throwing here keeps `await syncP` authoritative.
      syncP = sync(crypto.randomUUID(), daysAgoIso(0), [squatSet(1)], cookieB).then(
        (r) => {
          syncDone = true;
          return r;
        },
        (e: unknown) => {
          syncDone = true;
          throw e;
        },
      );
      // Park a no-op handler so a rejection can never surface as an UNHANDLED
      // one if an assertion below throws first. This marks the promise handled
      // WITHOUT swallowing it — `await syncP` still rethrows the real error.
      syncP.catch(() => undefined);
      // Read the flag through a typed accessor: TS narrows a `let x = false`
      // to the literal `false` because the only mutation is inside a callback
      // it cannot see run, which makes every `!syncDone` below an
      // "always truthy" lint error. A `boolean`-returning function is the
      // honest fix (no `as` cast, which R2.2 bans here).
      const isSyncDone = (): boolean => syncDone;

      const blockedByHolder = async (): Promise<number> => {
        const [row] = await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND wait_event = 'advisory'
            AND ${holderPid} = ANY(pg_blocking_pids(pid))`;
        return row?.n ?? 0;
      };

      // Poll until the sync is DEMONSTRABLY blocked BY US. If the call site is
      // removed, no such waiter appears and the assertion below fails — the
      // mutation this test exists for. Bail out the moment the sync finishes,
      // so a failed REQUEST is reported as itself rather than as a missing
      // waiter 20 s later (round 4 #2 — F3's own shape, reintroduced).
      let waiters = 0;
      for (let i = 0; i < 100 && waiters === 0 && !isSyncDone(); i++) {
        waiters = await blockedByHolder();
        if (waiters === 0 && !isSyncDone()) await new Promise((r) => setTimeout(r, 200));
      }
      if (isSyncDone()) expect((await syncP).statusCode).toBe(201); // surfaces the real cause
      expect(waiters).toBeGreaterThan(0); // the sync path asked for OUR lock…
      expect(isSyncDone()).toBe(false); // …and is parked on it

      releaseHolder();
      await holderP;
      const res = await syncP;
      expect(res.statusCode).toBe(201); // and completes normally once released
    } finally {
      releaseHolder();
      // Drain BOTH (round 5 #4): the sync's INSERT must not still be in flight
      // when this test returns. The dead `allSettled([syncP])` that used to sit
      // after the await above is gone — it settled an already-awaited promise.
      await Promise.allSettled([holderP, syncP ?? Promise.resolve()]);
    }
  });

  it("history/progress/gamification all 401 without a cookie", { timeout: 30_000 }, async () => {
    for (const path of ["/v1/workouts", "/v1/progress/overview", "/v1/gamification/me"]) {
      expect((await inject({ method: "GET", url: path })).statusCode).toBe(401);
    }
  });
});
