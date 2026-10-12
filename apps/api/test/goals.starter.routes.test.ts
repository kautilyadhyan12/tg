// The starter goals (ROADMAP Stage 5 item 30b) against REAL Postgres. DATABASE_URL-gated;
// needs migration 0100. The first block is the job's worst thing: nobody under 18 or with
// a yes on the health question is handed a weight to lose. Then: the set and its numbers,
// given once, a removed goal stays removed, and nobody gets anybody else's.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { MAX_GOALS, goalsResponseSchema, type Goal } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { EmailSender } from "../src/modules/auth/email.js";

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
const nextIp = () => `10.11.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

/** goals.routes.test.ts's golden person: burns 1,817 kcal a day, and a plan that may cut
 *  eats 1,267. At 16 the same answers burn 1,901. */
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
const FINISH = { diet: "non_vegetarian", mealsPerDay: 3, onboardingCompleted: true };
const NO_CONDITION = { hasCondition: false };

/** A Wednesday. The week is 9 to 15 March. */
const NOW = new Date("2026-03-11T10:00:00Z");

type Cookies = Record<string, string>;

d("starter goals (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
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
    const email = `goalst-${name}@example.com`;
    const reg = await inject({ method: "POST", url: "/v1/auth/register", body: { email, password: PASSWORD, displayName: "Starter Fixture" } });
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
  /** Setup from its first answer to Finish, by the real routes. */
  const finishSetup = async (cookies: Cookies, answers: unknown, healthAnswer: unknown): Promise<void> => {
    await answer(cookies, answers);
    await health(cookies, healthAnswer);
    await answer(cookies, FINISH);
  };
  const finished = async (name: string, answers: unknown = LOSING_ANSWERS, healthAnswer: unknown = NO_CONDITION) => {
    const user = await makeUser(name);
    await finishSetup(user.cookies, answers, healthAnswer);
    return user;
  };

  const list = async (cookies: Cookies): Promise<Goal[]> => {
    const res = await inject({ method: "GET", url: "/v1/goals", cookies });
    expect(res.statusCode).toBe(200);
    return goalsResponseSchema.parse(JSON.parse(res.body)).goals;
  };
  const kinds = (goals: readonly Goal[]) => goals.map((g) => g.kind);
  const of = (goals: readonly Goal[], kind: Goal["kind"]): Goal => {
    const goal = goals.find((g) => g.kind === kind);
    if (goal === undefined) throw new Error(`no ${kind} goal in the list`);
    return goal;
  };
  const remove = (cookies: Cookies, id: string) => inject({ method: "DELETE", url: `/v1/goals/${id}`, cookies });

  const clear = async () => {
    await sql`DELETE FROM users WHERE email LIKE 'goalst-%@example.com'`;
  };

  beforeAll(async () => {
    await clear();
    app = await buildApp(loadConfig(baseEnv), { emailSender: silentAuthSender(), goals: { now: () => NOW } });
  }, 60_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    await clear();
    await sql.end({ timeout: 5 });
  }, 60_000);

  describe("THE WORST THING: nobody the plan may not cut is handed a weight to lose", () => {
    it("under 18: no weight goal, and the calories goal is the whole daily burn", { timeout: 60_000 }, async () => {
      const { cookies } = await finished("teen", { ...LOSING_ANSWERS, age: 16 });
      const goals = await list(cookies);
      expect(kinds(goals)).toEqual(["training_days", "active_minutes", "calories_within", "protein"]);
      expect(of(goals, "calories_within")).toMatchObject({ target: 1901, held: null });
    });

    it("a yes on the health question, cleared: no weight goal, and nothing less to eat", { timeout: 60_000 }, async () => {
      const { cookies } = await finished("yes-cleared", LOSING_ANSWERS, { hasCondition: true, checkFirst: "cleared" });
      const goals = await list(cookies);
      expect(kinds(goals)).toEqual(["training_days", "active_minutes", "calories_within", "protein"]);
      expect(of(goals, "calories_within").target).toBe(1817);
    });

    it("Safe mode: no weight goal and no effort goal either", { timeout: 60_000 }, async () => {
      const { cookies } = await finished("yes-notyet", LOSING_ANSWERS, { hasCondition: true, checkFirst: "not_yet" });
      const goals = await list(cookies);
      expect(kinds(goals)).toEqual(["training_days", "calories_within", "protein"]);
      expect(of(goals, "calories_within").target).toBe(1817);
    });

    it("no goal the app gives is held on the day it is given", { timeout: 60_000 }, async () => {
      for (const [name, age, healthAnswer] of [
        ["held-teen", 17, NO_CONDITION],
        ["held-yes", 40, { hasCondition: true, checkFirst: "cleared" }],
        ["held-safe", 40, { hasCondition: true, checkFirst: "not_yet" }],
      ] as const) {
        const { cookies } = await finished(name, { ...LOSING_ANSWERS, age }, healthAnswer);
        for (const g of await list(cookies)) expect(g.held, `${name} ${g.kind}`).toBeNull();
      }
    });

    it("the weight goal is refused afterwards too, by the route a person adds one with", { timeout: 60_000 }, async () => {
      const { cookies } = await finished("teen-adds", { ...LOSING_ANSWERS, age: 16 });
      await list(cookies);
      const res = await inject({
        method: "PUT",
        url: `/v1/goals/${randomUUID()}`,
        body: { kind: "weight", period: null, target: null, exerciseId: null },
        cookies,
      });
      expect(res.statusCode).toBe(409);
      expect(kinds(await list(cookies))).not.toContain("weight");
    });
  });

  describe("the set", () => {
    it("an adult losing weight: five goals, set by the app, each with the person's own number", { timeout: 60_000 }, async () => {
      const { cookies } = await finished("adult");
      const goals = await list(cookies);
      expect(kinds(goals)).toEqual(["training_days", "active_minutes", "calories_within", "protein", "weight"]);
      for (const g of goals) expect(g.setBy, g.kind).toBe("app");
      expect(of(goals, "training_days")).toMatchObject({ period: "week", target: 3, current: 0, reached: false });
      expect(of(goals, "active_minutes")).toMatchObject({ period: "week", target: 135, current: 0, reached: false });
      expect(of(goals, "calories_within")).toMatchObject({ period: "day", target: 1267, direction: "at_most" });
      expect(of(goals, "protein").target).toBeGreaterThan(0);
      expect(of(goals, "weight")).toMatchObject({ target: 65, current: 70, direction: "at_most", reached: false });
    });

    it("keeping weight: the weight goal is to stay steady, with no target", { timeout: 60_000 }, async () => {
      const { cookies } = await finished("keeps", { ...LOSING_ANSWERS, weightGoal: "maintain", targetWeightKg: null, pace: null });
      const weight = of(await list(cookies), "weight");
      expect(weight).toMatchObject({ direction: "steady", target: null, current: 70, held: null });
    });

    it("nothing is given before setup is finished, and the set comes once it is", { timeout: 60_000 }, async () => {
      const { cookies } = await makeUser("midway");
      await answer(cookies, LOSING_ANSWERS);
      await health(cookies, NO_CONDITION);
      expect(await list(cookies)).toEqual([]);
      await answer(cookies, FINISH);
      expect(await list(cookies)).toHaveLength(5);
    });

    it("the numbers are today's answers: days changed before the first read are the days given", { timeout: 60_000 }, async () => {
      const { cookies } = await finished("changed");
      await answer(cookies, { trainingDays: 5, sessionMinutes: 30 });
      const goals = await list(cookies);
      expect(of(goals, "training_days").target).toBe(5);
      expect(of(goals, "active_minutes").target).toBe(150);
    });
  });

  describe("given once", () => {
    it("a second read gives the same five goals, not five more", { timeout: 60_000 }, async () => {
      const { cookies } = await finished("twice");
      const first = (await list(cookies)).map((g) => g.id);
      expect(first).toHaveLength(5);
      expect((await list(cookies)).map((g) => g.id)).toEqual(first);
    });

    it("five reads at the same instant give one set", { timeout: 60_000 }, async () => {
      const { cookies, userId } = await finished("race");
      const all = await Promise.all([1, 2, 3, 4, 5].map(() => list(cookies)));
      for (const goals of all) expect(goals).toHaveLength(5);
      const [row] = await sql<{ n: string }[]>`SELECT count(*) AS n FROM user_goals WHERE user_id = ${userId}`;
      expect(Number(row?.n)).toBe(5);
    });

    it("a goal the person removed stays removed, even after setup is done again", { timeout: 60_000 }, async () => {
      const { cookies } = await finished("removes");
      const goals = await list(cookies);
      expect((await remove(cookies, of(goals, "active_minutes").id)).statusCode).toBe(204);
      expect(kinds(await list(cookies))).toEqual(["training_days", "calories_within", "protein", "weight"]);

      expect((await inject({ method: "DELETE", url: "/v1/users/me/onboarding", cookies })).statusCode).toBe(200);
      await finishSetup(cookies, LOSING_ANSWERS, NO_CONDITION);
      expect(kinds(await list(cookies))).toEqual(["training_days", "calories_within", "protein", "weight"]);
    });

    it("every goal removed: the list stays empty", { timeout: 60_000 }, async () => {
      const { cookies } = await finished("empties");
      for (const g of await list(cookies)) expect((await remove(cookies, g.id)).statusCode).toBe(204);
      expect(await list(cookies)).toEqual([]);
      expect(await list(cookies)).toEqual([]);
    });

    it("a goal the person already keeps stays theirs: no second one, and its number is not changed", { timeout: 60_000 }, async () => {
      const user = await makeUser("own");
      await answer(user.cookies, LOSING_ANSWERS);
      await health(user.cookies, NO_CONDITION);
      const id = randomUUID();
      const body = { kind: "training_days", period: "week", target: 6, exerciseId: null };
      // Kept before setup is finished, so the app's own would be a second of its kind.
      expect((await inject({ method: "PUT", url: `/v1/goals/${id}`, body, cookies: user.cookies })).statusCode).toBe(201);
      await answer(user.cookies, FINISH);

      const goals = await list(user.cookies);
      expect(kinds(goals)).toEqual(["training_days", "active_minutes", "calories_within", "protein", "weight"]);
      expect(of(goals, "training_days")).toMatchObject({ id, target: 6, setBy: "user" });
    });

    it("a starter goal the person changes is theirs from then on", { timeout: 60_000 }, async () => {
      const { cookies } = await finished("changes");
      const days = of(await list(cookies), "training_days");
      const body = { kind: "training_days", period: "week", target: 4, exerciseId: null };
      expect((await inject({ method: "PUT", url: `/v1/goals/${days.id}`, body, cookies })).statusCode).toBe(200);
      expect(of(await list(cookies), "training_days")).toMatchObject({ id: days.id, target: 4, setBy: "user" });
    });

    it("a person two short of the most goals gets two, in the set's order, and never more than the most", { timeout: 60_000 }, async () => {
      const user = await makeUser("full");
      await answer(user.cookies, LOSING_ANSWERS);
      await health(user.cookies, NO_CONDITION);
      const kept = MAX_GOALS - 2;
      await sql`
        INSERT INTO user_goals (id, user_id, kind, period, target, exercise_id)
        SELECT gen_random_uuid(), ${user.userId}, 'reps_in_set', NULL, 10, id
        FROM exercises WHERE status = 'live' ORDER BY slug LIMIT ${kept}`;
      const [row] = await sql<{ n: string }[]>`SELECT count(*) AS n FROM user_goals WHERE user_id = ${user.userId}`;
      expect(Number(row?.n), "the catalog holds enough live exercises").toBe(kept);
      await answer(user.cookies, FINISH);

      const goals = await list(user.cookies);
      expect(goals).toHaveLength(MAX_GOALS);
      expect(kinds(goals.filter((g) => g.setBy === "app"))).toEqual(["training_days", "active_minutes"]);
      expect(await list(user.cookies)).toHaveLength(MAX_GOALS);
    });
  });

  describe("nobody gets anybody else's", () => {
    it("one person finishing setup gives the other nothing, and their goals cannot be removed by a stranger", { timeout: 60_000 }, async () => {
      const a = await finished("mine");
      const b = await makeUser("stranger");
      const mine = await list(a.cookies);
      expect(mine).toHaveLength(5);
      expect(await list(b.cookies)).toEqual([]);

      const [given] = await sql<{ n: string }[]>`SELECT count(*) AS n FROM user_goals WHERE user_id = ${b.userId}`;
      expect(Number(given?.n)).toBe(0);
      for (const g of mine) expect((await remove(b.cookies, g.id)).statusCode, g.kind).toBe(404);
      expect((await list(a.cookies)).map((g) => g.id)).toEqual(mine.map((g) => g.id));
    });

    it("two people's sets share no goal", { timeout: 60_000 }, async () => {
      const a = await finished("pair-a");
      const b = await finished("pair-b", { ...LOSING_ANSWERS, trainingDays: 5 });
      const idsA = (await list(a.cookies)).map((g) => g.id);
      const goalsB = await list(b.cookies);
      expect(goalsB.filter((g) => idsA.includes(g.id))).toEqual([]);
      expect(of(goalsB, "training_days").target).toBe(5);
      expect(of(await list(a.cookies), "training_days").target).toBe(3);
    });

    it("nobody signed in is refused", async () => {
      expect((await inject({ method: "GET", url: "/v1/goals" })).statusCode).toBe(401);
    });
  });
});
