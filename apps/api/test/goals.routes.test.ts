// Goals routes (ROADMAP Stage 5 item 30a) against REAL Postgres. DATABASE_URL-gated;
// needs migration 0099. The first block is the job's worst thing: nobody under 18 or
// with a yes on the health question is given a weight to lose or less to eat. Then, per
// route: the happy path, a validation failure and the stranger; then the measuring, on
// the person's own day.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { MAX_GOALS, goalsResponseSchema, type Goal } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { EmailSender } from "../src/modules/auth/email.js";
import { DIRECT_DELETE_TABLES } from "../src/modules/privacy/tables.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "ofp-test-secret-0123456789abcdef-32", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;

const silentAuthSender = (): EmailSender => ({
  sendVerificationEmail: () => Promise.resolve(),
  sendPasswordResetEmail: () => Promise.resolve(),
  sendSignInCodeEmail: () => Promise.resolve(),
});

let ipCounter = 0;
const nextIp = () => `10.9.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

/** users.onboarding.routes.test.ts's golden person: burns 1,817 kcal a day, and a plan
 *  that may cut eats 1,267. At 16 the same answers burn 1,901. */
const LOSING_ANSWERS = {
  weightGoal: "lose",
  age: 30,
  gender: "female",
  heightCm: 165,
  weightKg: 70,
  targetWeightKg: 65,
  pace: "steady",
  dayActivity: "sitting",
  trainingDays: 3,
  sessionMinutes: 45,
};

/** A Wednesday. The week is 9 to 15 March. */
const NOW = new Date("2026-03-11T10:00:00Z");

type Cookies = Record<string, string>;

d("goals routes (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  let squatId = "";
  let lungeId = "";
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const inject = (opts: { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; url: string; body?: unknown; cookies?: Cookies }) =>
    api().inject({
      method: opts.method,
      url: opts.url,
      remoteAddress: nextIp(),
      headers: opts.body !== undefined ? { "content-type": "application/json" } : {},
      cookies: opts.cookies ?? {},
      ...(opts.body !== undefined ? { payload: JSON.stringify(opts.body) } : {}),
    });

  const makeUser = async (name: string) => {
    const email = `goal-${name}@example.com`;
    const reg = await inject({ method: "POST", url: "/v1/auth/register", body: { email, password: PASSWORD, displayName: "Goal Fixture" } });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await inject({ method: "POST", url: "/v1/auth/login", body: { email, password: PASSWORD } });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };

  const answer = async (cookies: Cookies, body: unknown): Promise<void> => {
    expect((await inject({ method: "PATCH", url: "/v1/users/me/onboarding", body, cookies })).statusCode).toBe(200);
  };
  const health = async (cookies: Cookies, body: unknown): Promise<void> => {
    expect((await inject({ method: "PUT", url: "/v1/users/me/health-screening", body, cookies })).statusCode).toBe(200);
  };

  const put = (cookies: Cookies, id: string, body: unknown) => inject({ method: "PUT", url: `/v1/goals/${id}`, body, cookies });
  const list = async (cookies: Cookies): Promise<Goal[]> => {
    const res = await inject({ method: "GET", url: "/v1/goals", cookies });
    expect(res.statusCode).toBe(200);
    return goalsResponseSchema.parse(JSON.parse(res.body)).goals;
  };
  const one = async (cookies: Cookies, id: string): Promise<Goal> => {
    const goal = (await list(cookies)).find((g) => g.id === id);
    if (goal === undefined) throw new Error(`goal ${id} is not in the list`);
    return goal;
  };
  const errorOf = (res: { body: string }) => (JSON.parse(res.body) as { error: string }).error;

  const WEIGHT = { kind: "weight", period: null, target: null, exerciseId: null };
  const CALORIES = { kind: "calories_within", period: "day", target: null, exerciseId: null };
  const week = (target: number) => ({ kind: "training_days", period: "week", target, exerciseId: null });

  const mine = sql`SELECT id FROM users WHERE email LIKE 'goal-%@example.com'`;
  const clear = async () => {
    await sql`DELETE FROM gym_attendance WHERE user_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE owner_user_id IN (${mine})`;
    // Workouts and meals do not go with the users row; the rest of what these tests make does.
    await sql`DELETE FROM workouts WHERE user_id IN (${mine})`;
    await sql`DELETE FROM meal_logs WHERE user_id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'goal-%@example.com'`;
  };

  beforeAll(async () => {
    await clear();
    const ex = await sql<{ id: string; slug: string }[]>`SELECT id, slug FROM exercises WHERE status = 'live' ORDER BY slug LIMIT 2`;
    squatId = ex[0]?.id ?? "";
    lungeId = ex[1]?.id ?? "";
    expect(squatId, "the exercise catalog is seeded").not.toBe("");
    expect(lungeId).not.toBe("");
    app = await buildApp(loadConfig(baseEnv), { emailSender: silentAuthSender(), orgs: { now: () => NOW } });
  }, 60_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    await clear();
    await sql.end({ timeout: 5 });
  }, 60_000);

  describe("THE WORST THING: no weight to lose and no less to eat for a person the plan may not cut", () => {
    it("under 18: a weight to lose is refused, and the calories goal is the whole daily burn", { timeout: 60_000 }, async () => {
      const { cookies } = await makeUser("teen");
      await answer(cookies, { ...LOSING_ANSWERS, age: 16 });
      await health(cookies, { hasCondition: false });

      const refused = await put(cookies, randomUUID(), WEIGHT);
      expect(refused.statusCode).toBe(409);
      expect(errorOf(refused)).toBe("goal_held");
      expect(await list(cookies)).toEqual([]);

      const id = randomUUID();
      expect((await put(cookies, id, CALORIES)).statusCode).toBe(201);
      expect(await one(cookies, id)).toMatchObject({ target: 1901, direction: "at_most", held: null });
    });

    it("a yes on the health question: the same, cleared by a professional or not", { timeout: 60_000 }, async () => {
      for (const [name, checkFirst] of [["cleared", "cleared"], ["notyet", "not_yet"]] as const) {
        const { cookies } = await makeUser(`yes-${name}`);
        await answer(cookies, LOSING_ANSWERS);
        await health(cookies, { hasCondition: true, checkFirst });
        const refused = await put(cookies, randomUUID(), WEIGHT);
        expect(refused.statusCode, name).toBe(409);
        expect(errorOf(refused)).toBe("goal_held");
        const id = randomUUID();
        expect((await put(cookies, id, CALORIES)).statusCode).toBe(201);
        expect((await one(cookies, id)).target, name).toBe(1817);
      }
    });

    it("a yes with the age not answered yet still holds a weight to lose", { timeout: 60_000 }, async () => {
      const { cookies } = await makeUser("yes-no-age");
      await answer(cookies, { weightGoal: "lose" });
      await health(cookies, { hasCondition: true, checkFirst: "cleared" });
      const refused = await put(cookies, randomUUID(), WEIGHT);
      expect(refused.statusCode).toBe(409);
      expect(errorOf(refused)).toBe("goal_held");
    });

    it("a goal kept from before the answer changed is held on the next read, and comes back when the answer does", { timeout: 60_000 }, async () => {
      const { cookies } = await makeUser("changes");
      await answer(cookies, LOSING_ANSWERS);
      await health(cookies, { hasCondition: false });
      const weightId = randomUUID();
      const caloriesId = randomUUID();
      expect((await put(cookies, weightId, WEIGHT)).statusCode).toBe(201);
      expect((await put(cookies, caloriesId, CALORIES)).statusCode).toBe(201);
      expect(await one(cookies, weightId)).toMatchObject({ target: 65, current: 70, direction: "at_most", reached: false, held: null });
      expect((await one(cookies, caloriesId)).target).toBe(1267);

      await health(cookies, { hasCondition: true, checkFirst: "cleared" });
      expect(await one(cookies, weightId)).toMatchObject({
        target: null,
        current: null,
        reached: null,
        held: { code: "no_weight_loss", reasons: ["health_answer"] },
      });
      expect((await one(cookies, caloriesId)).target).toBe(1817);

      await health(cookies, { hasCondition: false });
      expect(await one(cookies, weightId)).toMatchObject({ target: 65, held: null });
      expect((await one(cookies, caloriesId)).target).toBe(1267);
    });

    it("numbers the person typed for the rings, once under what keeps the weight, are not the calories goal's", { timeout: 60_000 }, async () => {
      const { cookies } = await makeUser("own-numbers");
      await answer(cookies, LOSING_ANSWERS);
      await health(cookies, { hasCondition: false });
      const own = { source: "own", kcal: 1300, proteinG: 100, carbsG: 150, fatG: 40 };
      expect((await inject({ method: "PUT", url: "/v1/nutrition/targets", body: own, cookies })).statusCode).toBe(200);
      const id = randomUUID();
      expect((await put(cookies, id, CALORIES)).statusCode).toBe(201);
      expect((await one(cookies, id)).target).toBe(1300);
      const protein = randomUUID();
      expect((await put(cookies, protein, { kind: "protein", period: "day", target: null, exerciseId: null })).statusCode).toBe(201);
      expect((await one(cookies, protein)).target).toBe(100);

      await health(cookies, { hasCondition: true, checkFirst: "cleared" });
      expect((await one(cookies, id)).target).toBe(1817);
    });

    it("Safe mode: an effort goal is refused and a kept one held; coming in and eating goals go on", { timeout: 60_000 }, async () => {
      const { cookies } = await makeUser("safe");
      await answer(cookies, { ...LOSING_ANSWERS, weightGoal: "maintain", targetWeightKg: null, pace: null });
      await health(cookies, { hasCondition: false });
      const burned = randomUUID();
      const reps = randomUUID();
      expect((await put(cookies, burned, { kind: "calories_burned", period: "week", target: 1500, exerciseId: null })).statusCode).toBe(201);
      expect((await put(cookies, reps, { kind: "reps_in_set", period: null, target: 20, exerciseId: squatId })).statusCode).toBe(201);
      expect(await one(cookies, burned)).toMatchObject({ target: 1500, current: 0, held: null });

      await health(cookies, { hasCondition: true, checkFirst: "not_yet" });
      for (const id of [burned, reps]) {
        expect(await one(cookies, id)).toMatchObject({ target: null, current: null, reached: null, held: { code: "safe_mode" } });
      }
      for (const body of [
        { kind: "active_minutes", period: "day", target: 30, exerciseId: null },
        { kind: "calories_burned", period: "day", target: 300, exerciseId: null },
        { kind: "reps_in_set", period: null, target: 10, exerciseId: lungeId },
        // Changing a held goal is refused too.
        { kind: "calories_burned", period: "week", target: 3000, exerciseId: null },
      ]) {
        const res = await put(cookies, body.kind === "calories_burned" && body.period === "week" ? burned : randomUUID(), body);
        expect(res.statusCode, body.kind).toBe(409);
        expect(errorOf(res)).toBe("goal_held");
      }
      const days = randomUUID();
      expect((await put(cookies, days, week(3))).statusCode).toBe(201);
      expect(await one(cookies, days)).toMatchObject({ target: 3, current: 0, held: null });
      // Keeping the weight is not a weight to lose.
      expect((await put(cookies, randomUUID(), WEIGHT)).statusCode).toBe(201);
      expect((await put(cookies, randomUUID(), CALORIES)).statusCode).toBe(201);
    });
  });

  it("every route requires authentication", { timeout: 30_000 }, async () => {
    const id = randomUUID();
    expect((await inject({ method: "GET", url: "/v1/goals" })).statusCode).toBe(401);
    expect((await put({}, id, week(3))).statusCode).toBe(401);
    expect((await inject({ method: "DELETE", url: `/v1/goals/${id}` })).statusCode).toBe(401);
  });

  it("add, the same request again, change, remove", { timeout: 60_000 }, async () => {
    const { userId, cookies } = await makeUser("happy");
    const empty = await inject({ method: "GET", url: "/v1/goals", cookies });
    expect(JSON.parse(empty.body)).toEqual({ goals: [], max: MAX_GOALS });

    const id = randomUUID();
    const first = await put(cookies, id, week(3));
    expect(first.statusCode).toBe(201);
    const goal = (JSON.parse(first.body) as { goal: Goal }).goal;
    expect(goal).toMatchObject({
      id,
      kind: "training_days",
      period: "week",
      setBy: "user",
      unit: "days",
      direction: "at_least",
      target: 3,
      current: 0,
      reached: false,
      held: null,
      needs: null,
      window: { start: "2026-03-09", end: "2026-03-15" },
      exerciseId: null,
      exerciseSlug: null,
    });

    // Sent twice: one goal.
    const again = await put(cookies, id, week(3));
    expect(again.statusCode).toBe(200);
    expect(await list(cookies)).toHaveLength(1);

    // A goal the app set becomes the person's own once they change it.
    await sql`UPDATE user_goals SET set_by = 'app' WHERE id = ${id}`;
    expect((await one(cookies, id)).setBy).toBe("app");
    const changed = await put(cookies, id, { kind: "training_days", period: "month", target: 12, exerciseId: null });
    expect(changed.statusCode).toBe(200);
    expect(await one(cookies, id)).toMatchObject({ period: "month", target: 12, setBy: "user", window: { start: "2026-03-01", end: "2026-03-31" } });

    const named = randomUUID();
    expect((await put(cookies, named, { kind: "reps_in_set", period: null, target: 15, exerciseId: squatId })).statusCode).toBe(201);
    const slug = await sql<{ slug: string }[]>`SELECT slug FROM exercises WHERE id = ${squatId}`;
    expect(await one(cookies, named)).toMatchObject({ exerciseId: squatId, exerciseSlug: slug[0]?.slug, window: null });

    expect((await inject({ method: "DELETE", url: `/v1/goals/${id}`, cookies })).statusCode).toBe(204);
    expect((await inject({ method: "DELETE", url: `/v1/goals/${id}`, cookies })).statusCode).toBe(404);
    expect((await list(cookies)).map((g) => g.id)).toEqual([named]);
    const rows = await sql`SELECT id FROM user_goals WHERE user_id = ${userId}`;
    expect(rows).toHaveLength(1);
  });

  it("refuses what does not fit, and writes nothing", { timeout: 60_000 }, async () => {
    const { userId, cookies } = await makeUser("invalid");
    const id = randomUUID();
    const bad: [string, unknown][] = [
      ["a period the kind does not take", { kind: "training_days", period: "day", target: 1, exerciseId: null }],
      ["no period where one is needed", { kind: "training_days", period: null, target: 3, exerciseId: null }],
      ["eight training days in a week", { kind: "training_days", period: "week", target: 8, exerciseId: null }],
      ["no target", { kind: "training_days", period: "week", target: null, exerciseId: null }],
      ["a typed weight", { kind: "weight", period: null, target: 60, exerciseId: null }],
      ["typed calories", { kind: "calories_within", period: "day", target: 900, exerciseId: null }],
      ["reps with no exercise", { kind: "reps_in_set", period: null, target: 10, exerciseId: null }],
      ["an exercise on a kind that names none", { kind: "streak", period: null, target: 7, exerciseId: squatId }],
      ["a kind nothing records yet", { kind: "run_distance", period: "week", target: 10, exerciseId: null }],
      ["who set it", { ...week(3), setBy: "app" }],
      ["somebody's id", { ...week(3), userId: randomUUID() }],
      ["a missing field", { kind: "training_days", period: "week", target: 3 }],
      ["nothing", {}],
    ];
    for (const [name, body] of bad) {
      const res = await put(cookies, id, body);
      expect(res.statusCode, name).toBe(400);
      expect(errorOf(res), name).toBe("validation_error");
    }
    expect((await put(cookies, "not-an-id", week(3))).statusCode).toBe(400);
    expect((await inject({ method: "DELETE", url: "/v1/goals/not-an-id", cookies })).statusCode).toBe(400);

    const unknown = await put(cookies, id, { kind: "reps_in_set", period: null, target: 10, exerciseId: randomUUID() });
    expect(unknown.statusCode).toBe(400);
    expect(errorOf(unknown)).toBe("unknown_exercise");

    expect(await sql`SELECT id FROM user_goals WHERE user_id = ${userId}`).toHaveLength(0);
  });

  it("a stranger cannot read, change or remove somebody else's goal", { timeout: 60_000 }, async () => {
    const owner = await makeUser("owner");
    const stranger = await makeUser("stranger");
    const id = randomUUID();
    expect((await put(owner.cookies, id, week(3))).statusCode).toBe(201);

    expect(await list(stranger.cookies)).toEqual([]);
    // The same id, and even the same body: it reads as no goal, and nothing changes.
    for (const body of [week(5), week(3), { kind: "streak", period: null, target: 7, exerciseId: null }]) {
      const res = await put(stranger.cookies, id, body);
      expect(res.statusCode).toBe(404);
      expect(errorOf(res)).toBe("not_found");
    }
    expect((await inject({ method: "DELETE", url: `/v1/goals/${id}`, cookies: stranger.cookies })).statusCode).toBe(404);

    expect(await one(owner.cookies, id)).toMatchObject({ target: 3, period: "week" });
    const rows = await sql<{ user_id: string }[]>`SELECT user_id FROM user_goals WHERE id = ${id}`;
    expect(rows).toEqual([{ user_id: owner.userId }]);
    expect(await sql`SELECT id FROM user_goals WHERE user_id = ${stranger.userId}`).toHaveLength(0);
  });

  it("one goal of each kind, period and exercise; a goal keeps its kind; no more than the limit", { timeout: 60_000 }, async () => {
    const { userId, cookies } = await makeUser("rules");
    const id = randomUUID();
    expect((await put(cookies, id, week(3))).statusCode).toBe(201);

    const twice = await put(cookies, randomUUID(), week(4));
    expect(twice.statusCode).toBe(409);
    expect(errorOf(twice)).toBe("goal_exists");
    // Another period is another goal; moving it onto the first one's period is not.
    const month = randomUUID();
    expect((await put(cookies, month, { kind: "training_days", period: "month", target: 12, exerciseId: null })).statusCode).toBe(201);
    const moved = await put(cookies, month, week(4));
    expect(moved.statusCode).toBe(409);
    expect(errorOf(moved)).toBe("goal_exists");
    expect(await one(cookies, month)).toMatchObject({ period: "month", target: 12 });

    const otherKind = await put(cookies, id, { kind: "gym_visits", period: "week", target: 3, exerciseId: null });
    expect(otherKind.statusCode).toBe(409);
    expect(errorOf(otherKind)).toBe("goal_kind_fixed");
    const reps = randomUUID();
    expect((await put(cookies, reps, { kind: "reps_in_set", period: null, target: 10, exerciseId: squatId })).statusCode).toBe(201);
    const otherExercise = await put(cookies, reps, { kind: "reps_in_set", period: null, target: 10, exerciseId: lungeId });
    expect(otherExercise.statusCode).toBe(409);
    expect(errorOf(otherExercise)).toBe("goal_kind_fixed");

    // Fill up to the limit with reps goals, one exercise each.
    const have = (await list(cookies)).length;
    await sql`
      INSERT INTO user_goals (id, user_id, kind, target, exercise_id)
      SELECT gen_random_uuid(), ${userId}, 'reps_in_set', 10, e.id
      FROM (SELECT id FROM exercises WHERE id <> ${squatId} ORDER BY slug LIMIT ${MAX_GOALS - have}) e`;
    expect(await list(cookies)).toHaveLength(MAX_GOALS);
    const over = await put(cookies, randomUUID(), { kind: "streak", period: null, target: 7, exerciseId: null });
    expect(over.statusCode).toBe(409);
    expect(errorOf(over)).toBe("goal_limit");
    // Changing one already kept is not adding one.
    expect((await put(cookies, id, week(5))).statusCode).toBe(200);
    expect(await sql`SELECT id FROM user_goals WHERE user_id = ${userId}`).toHaveLength(MAX_GOALS);
  });

  it("the same new goal sent twice at the same instant is one goal", { timeout: 60_000 }, async () => {
    const { userId, cookies } = await makeUser("race");
    const id = randomUUID();
    const both = await Promise.all([put(cookies, id, week(3)), put(cookies, id, week(3))]);
    expect(both.map((r) => r.statusCode).sort()).toEqual([200, 201]);
    // Two different ids for the same goal at once: one is kept.
    const pair = await Promise.all([
      put(cookies, randomUUID(), { kind: "streak", period: null, target: 7, exerciseId: null }),
      put(cookies, randomUUID(), { kind: "streak", period: null, target: 7, exerciseId: null }),
    ]);
    expect(pair.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(await sql`SELECT id FROM user_goals WHERE user_id = ${userId}`).toHaveLength(2);
  });

  it("measures each goal from what the person did, on their own day", { timeout: 60_000 }, async () => {
    const { userId, cookies } = await makeUser("measured");
    const other = await makeUser("measured-other");
    await answer(cookies, LOSING_ANSWERS);
    await health(cookies, { hasCondition: false });
    // 15:30 in Kolkata on Wednesday 11 March.
    await sql`UPDATE users SET timezone = 'Asia/Kolkata' WHERE id = ${userId}`;

    const workout = async (who: string, startedAt: string, kcal: number, minutes: number, reps: number, exerciseId: string) => {
      const [w] = await sql<{ id: string }[]>`
        INSERT INTO workouts (id, user_id, started_at, platform, engine_version, sets_count, total_reps, duration_ms, kcal_point)
        VALUES (gen_random_uuid(), ${who}, ${startedAt}, 'web', 'test', 1, ${reps}, ${minutes * 60_000}, ${kcal}) RETURNING id`;
      await sql`
        INSERT INTO workout_sets (workout_id, user_id, exercise_id, started_at, set_index, reps, duration_ms, engine_version, definition_version)
        VALUES (${w?.id ?? ""}, ${who}, ${exerciseId}, ${startedAt}, 0, ${reps}, 60000, '1.0.0', 1)`;
    };
    // 00:30 on the 11th in Kolkata, the 10th in UTC: today for this person.
    await workout(userId, "2026-03-10T19:00:00Z", 200, 20, 12, squatId);
    // Monday the 9th.
    await workout(userId, "2026-03-09T06:00:00Z", 300, 30, 18, squatId);
    // 23:30 on Sunday the 8th in Kolkata: last week, this month.
    await workout(userId, "2026-03-08T18:00:00Z", 400, 40, 9, lungeId);
    // January: this year only.
    await workout(userId, "2026-01-15T06:00:00Z", 500, 50, 5, squatId);
    // Last year, and somebody else's: never counted.
    await workout(userId, "2025-12-20T06:00:00Z", 900, 90, 4, squatId);
    await workout(other.userId, "2026-03-11T06:00:00Z", 999, 99, 99, squatId);

    const meal = async (who: string, takenAt: string, kcal: number, proteinG: number) => {
      await sql`
        INSERT INTO meal_logs (user_id, taken_at, items, kcal_point, kcal_low, kcal_high, protein_g, portion_source, nutrition_sources, calc_version)
        VALUES (${who}, ${takenAt}, ${sql.json([])}, ${kcal}, ${kcal}, ${kcal}, ${proteinG}, 'default', ${sql.array(["curated"])}, 1)`;
    };
    await meal(userId, "2026-03-11T03:00:00Z", 400, 30.5);
    await meal(userId, "2026-03-11T08:00:00Z", 600, 40.2);
    // 23:30 on the 10th in UTC is 05:00 on the 11th in Kolkata.
    await meal(userId, "2026-03-10T23:30:00Z", 100, 5);
    await meal(userId, "2026-03-09T08:00:00Z", 2500, 150);
    await meal(userId, "2026-02-20T08:00:00Z", 2000, 100);
    await meal(other.userId, "2026-03-11T08:00:00Z", 5000, 500);

    const [gym] = await sql<{ id: string }[]>`
      INSERT INTO gyms (slug, name, owner_user_id) VALUES (${`goal-gym-${randomUUID()}`}, 'Goal fixture gym', ${userId}) RETURNING id`;
    const visit = async (who: string, day: string) => {
      await sql`
        INSERT INTO gym_attendance (gym_id, user_id, marked_by_user_id, day, method, hours_status, slot_key)
        VALUES (${gym?.id ?? ""}, ${who}, ${who}, ${day}::date, 'manual', 'hours_unset', 'hours_unset')`;
    };
    for (const day of ["2026-03-11", "2026-03-10", "2026-03-02", "2026-01-05", "2025-12-30"]) await visit(userId, day);
    await visit(other.userId, "2026-03-09");

    const today = new Date().toISOString().slice(0, 10);
    await sql`
      INSERT INTO streaks (user_id, current, longest, last_activity_date) VALUES (${userId}, 5, 9, ${today}::date)
      ON CONFLICT (user_id) DO UPDATE SET current = 5, longest = 9, last_activity_date = ${today}::date`;

    const want: [Record<string, unknown>, number, number | null][] = [
      [{ kind: "training_days", period: "week", target: 3 }, 2, 3],
      [{ kind: "training_days", period: "month", target: 3 }, 3, 3],
      [{ kind: "training_days", period: "year", target: 10 }, 4, 10],
      [{ kind: "calories_burned", period: "day", target: 250 }, 200, 250],
      [{ kind: "calories_burned", period: "week", target: 500 }, 500, 500],
      [{ kind: "calories_burned", period: "month", target: 1000 }, 900, 1000],
      [{ kind: "calories_burned", period: "year", target: 1400 }, 1400, 1400],
      [{ kind: "active_minutes", period: "day", target: 20 }, 20, 20],
      [{ kind: "active_minutes", period: "week", target: 60 }, 50, 60],
      [{ kind: "active_minutes", period: "year", target: 100 }, 140, 100],
      [{ kind: "gym_visits", period: "week", target: 2 }, 2, 2],
      [{ kind: "gym_visits", period: "month", target: 4 }, 3, 4],
      [{ kind: "gym_visits", period: "year", target: 4 }, 4, 4],
      [{ kind: "food_logged_days", period: "week", target: 3 }, 2, 3],
      [{ kind: "food_logged_days", period: "year", target: 3 }, 3, 3],
      [{ kind: "streak", period: null, target: 7 }, 5, 7],
      [{ kind: "reps_in_set", period: null, target: 20, exerciseId: squatId }, 18, 20],
      [{ kind: "reps_in_set", period: null, target: 9, exerciseId: lungeId }, 9, 9],
      [{ kind: "calories_within", period: "day", target: null }, 1100, 1267],
      [{ kind: "protein", period: "day", target: null }, 76, null],
      [{ kind: "weight", period: null, target: null }, 70, 65],
    ];
    const ids: string[] = [];
    for (const [body] of want) {
      const id = randomUUID();
      ids.push(id);
      const res = await put(cookies, id, { exerciseId: null, ...body });
      expect(res.statusCode, JSON.stringify(body)).toBe(201);
    }
    const goals = await list(cookies);
    expect(goals.map((g) => g.id)).toEqual(ids);
    goals.forEach((g, i) => {
      const row = want[i];
      if (row === undefined) throw new Error("a goal nobody asked for");
      const [body, current, target] = row;
      const name = `${g.kind} ${String(g.period)}`;
      expect(g.kind, name).toBe(body["kind"]);
      expect(g.current, name).toBe(current);
      if (target !== null) expect(g.target, name).toBe(target);
      expect(g.held, name).toBeNull();
      const expected = g.kind === "weight" ? false : g.direction === "at_most" ? current <= (g.target ?? 0) : current >= (g.target ?? Infinity);
      expect(g.reached, name).toBe(expected);
    });
    // The stranger's own list is their own.
    expect(await list(other.cookies)).toEqual([]);
  });

  it("goals go with the account's data: the row is the person's own", { timeout: 30_000 }, () => {
    expect(DIRECT_DELETE_TABLES).toContain("user_goals");
  });
});
