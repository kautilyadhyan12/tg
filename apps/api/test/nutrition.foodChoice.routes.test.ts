// Recommended For You's choice for food (ROADMAP Stage 5 31f; spec Part 6 §16.6) against REAL
// Postgres. DATABASE_URL-gated; needs migration 0200. The first block is the job's worst thing:
// one person's pick read or changed by another account. Then where the choice starts, the pick
// itself (happy path, validation, sent twice, two phones at once), and a plan built after
// picking Suggested.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { dietPlanResponseSchema, type DietPlanResponse } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { EmailSender } from "../src/modules/auth/email.js";
import type { FoodSearchProvider } from "../src/modules/nutrition/openfoodfacts.adapter.js";
import { foodChoiceOf, type GymsForChoice } from "../src/modules/nutrition/dietPlanService.js";
import { EMPTY_WEEK, type Picked, type StoredDays } from "../src/modules/nutrition/dietPlanRepo.js";

describe("where the choice starts, every case", () => {
  const oneMeal: StoredDays = [[], [], [{ mealType: "lunch", items: [] }], [], [], [], []];
  const IRON = "00000000-0000-4000-8000-000000000001";
  const OAK = "00000000-0000-4000-8000-000000000002";
  const none: GymsForChoice = { live: [], newestGiven: null };
  const ironNoPlan: GymsForChoice = { live: [IRON], newestGiven: null };
  const ironGave: GymsForChoice = { live: [IRON], newestGiven: IRON };
  const bothOakNewest: GymsForChoice = { live: [IRON, OAK], newestGiven: OAK };
  const gym = (gymId: string): Picked => ({ choice: "gym", gymId });
  const of = (choice: "suggested" | "mine"): Picked => ({ choice, gymId: null });
  const cases: readonly [picked: Picked | null, days: StoredDays, gyms: GymsForChoice, shown: Picked, why: string][] = [
    [null, EMPTY_WEEK, none, of("suggested"), "no pick, no plan, no gym: the app's ideas"],
    [null, oneMeal, none, of("mine"), "no pick, a meal on any day of the week: their plan"],
    [null, oneMeal, ironNoPlan, of("mine"), "a gym that gave nothing does not take the start"],
    [null, oneMeal, ironGave, gym(IRON), "no pick, a gym gave a plan: the gym's, before their own"],
    [null, EMPTY_WEEK, bothOakNewest, gym(OAK), "two gyms gave one: the newest given"],
    [of("suggested"), oneMeal, ironGave, of("suggested"), "picked Suggested: kept, whatever a gym gave"],
    [of("suggested"), EMPTY_WEEK, none, of("suggested"), "picked Suggested, no plan"],
    [of("mine"), EMPTY_WEEK, ironGave, of("mine"), "picked My plan with none yet: My plan, which offers Build my own"],
    [of("mine"), oneMeal, none, of("mine"), "picked My plan with a plan"],
    [gym(IRON), EMPTY_WEEK, ironNoPlan, gym(IRON), "picked a gym that gave nothing: kept, the phone says so"],
    [gym(IRON), oneMeal, bothOakNewest, gym(IRON), "picked one of two gyms: kept, not the newest"],
    [gym(OAK), oneMeal, ironNoPlan, of("mine"), "picked a gym they left: back to the start, their plan"],
    [gym(OAK), EMPTY_WEEK, ironGave, gym(IRON), "picked a gym they left, another gave one: that one"],
    [gym(OAK), EMPTY_WEEK, none, of("suggested"), "picked a gym they left, nothing else: the app's ideas"],
  ];
  it.each(cases)("%# · %s", (picked, days, gyms, shown) => {
    expect(foodChoiceOf(picked, days, gyms)).toEqual(shown);
  });
});

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
const PLAN_ANSWERS = {
  weightGoal: "maintain", age: 30, gender: "female", heightCm: 165, weightKg: 70,
  dayActivity: "sitting", trainingDays: 3, sessionMinutes: 45, diet: "non_vegetarian", mealsPerDay: 3,
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
const silentAuthSender = (): EmailSender => ({
  sendVerificationEmail: () => Promise.resolve(),
  sendPasswordResetEmail: () => Promise.resolve(),
  sendSignInCodeEmail: () => Promise.resolve(),
});
const noExternal: FoodSearchProvider = { search: () => Promise.resolve([]) };

let ipCounter = 0;
const nextIp = () => `10.31.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

d("Recommended For You's choice for food (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const inject = (opts: { method: "GET" | "POST" | "PUT" | "PATCH"; url: string; body?: unknown; cookies?: Cookies }) =>
    api().inject({
      method: opts.method,
      url: opts.url,
      remoteAddress: nextIp(),
      headers: opts.body !== undefined ? { "content-type": "application/json" } : {},
      cookies: opts.cookies ?? {},
      ...(opts.body !== undefined ? { payload: JSON.stringify(opts.body) } : {}),
    });
  const person = async (name: string): Promise<Cookies> => {
    const email = `foodchoice-${name}@example.com`;
    expect((await inject({ method: "POST", url: "/v1/auth/register", body: { email, password: PASSWORD, displayName: "Choice Fixture" } })).statusCode).toBe(201);
    const login = await inject({ method: "POST", url: "/v1/auth/login", body: { email, password: PASSWORD } });
    expect(login.statusCode).toBe(200);
    const cookies = cookieMap(login);
    expect((await inject({ method: "PATCH", url: "/v1/users/me/onboarding", body: PLAN_ANSWERS, cookies })).statusCode).toBe(200);
    return cookies;
  };
  const parsed = (res: { statusCode: number; body: string }): DietPlanResponse => {
    expect(res.statusCode, res.body).toBe(200);
    return dietPlanResponseSchema.parse(JSON.parse(res.body));
  };
  const read = async (cookies: Cookies) => parsed(await inject({ method: "GET", url: "/v1/nutrition/diet-plan", cookies }));
  const pick = (cookies: Cookies, body: unknown) => inject({ method: "PUT", url: "/v1/nutrition/diet-plan/choice", body, cookies });
  const putDay = (cookies: Cookies, day: number, body: unknown) => inject({ method: "PUT", url: `/v1/nutrition/diet-plan/days/${String(day)}`, body, cookies });
  const make = async (cookies: Cookies) =>
    parsed(await inject({ method: "POST", url: "/v1/nutrition/diet-plan/make", body: { changeId: randomUUID() }, cookies }));
  const stored = async (name: string) =>
    await sql<{ choice: string }[]>`
      SELECT c.choice FROM recommended_choices c JOIN users u ON u.id = c.user_id
      WHERE u.email = ${`foodchoice-${name}@example.com`} AND c.kind = 'food'`;

  const mine = sql`SELECT id FROM users WHERE email LIKE 'foodchoice-%@example.com'`;
  const clear = async () => {
    await sql`DELETE FROM recommended_choices WHERE user_id IN (${mine})`;
    await sql`DELETE FROM diet_plans WHERE user_id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'foodchoice-%@example.com'`;
  };

  beforeAll(async () => {
    await clear();
    app = await buildApp(loadConfig(baseEnv), { emailSender: silentAuthSender(), nutrition: { foodSearchProvider: noExternal } });
  }, 60_000);
  afterAll(async () => {
    if (app !== undefined) await app.close();
    await clear();
    await sql.end({ timeout: 5 });
  }, 60_000);

  describe("THE WORST THING: one person's pick read or changed by another account", () => {
    it("each account reads and changes only its own pick; signed out is refused", { timeout: 60_000 }, async () => {
      const ana = await person("ana");
      const ben = await person("ben");
      await make(ana);
      await make(ben);
      expect((await read(ana)).choice).toBe("mine");
      // Ben picks Suggested: Ana's stays My plan, on the server and in her read.
      expect(parsed(await pick(ben, { choice: "suggested" })).choice).toBe("suggested");
      expect((await read(ana)).choice).toBe("mine");
      expect(await stored("ana")).toEqual([{ choice: "mine" }]);
      expect(await stored("ben")).toEqual([{ choice: "suggested" }]);
      // Ana picks Suggested, then My plan: Ben's stays his.
      await pick(ana, { choice: "suggested" });
      await pick(ana, { choice: "mine" });
      expect((await read(ben)).choice).toBe("suggested");
      expect((await read(ana)).choice).toBe("mine");
      // No account at all: refused, and nobody's pick changes.
      expect((await pick({}, { choice: "suggested" })).statusCode).toBe(401);
      expect((await inject({ method: "GET", url: "/v1/nutrition/diet-plan" })).statusCode).toBe(401);
      expect(await stored("ana")).toEqual([{ choice: "mine" }]);
      // The route names nobody: an id sent beside the pick is refused, never followed.
      const benId = (await sql<{ id: string }[]>`SELECT id FROM users WHERE email = 'foodchoice-ben@example.com'`)[0]?.id;
      expect((await pick(ana, { choice: "mine", userId: benId })).statusCode).toBe(400);
      expect(await stored("ben")).toEqual([{ choice: "suggested" }]);
    });
  });

  describe("where it starts", () => {
    it("no plan: Suggested, with nothing stored; a plan made: My plan", { timeout: 60_000 }, async () => {
      const cookies = await person("start");
      expect((await read(cookies)).choice).toBe("suggested");
      expect(await stored("start")).toEqual([]);
      expect((await make(cookies)).choice).toBe("mine");
      expect((await read(cookies)).choice).toBe("mine");
    });
  });

  describe("the pick", () => {
    it("is kept, and every read after it, on any phone, shows it", { timeout: 60_000 }, async () => {
      const cookies = await person("keep");
      await make(cookies);
      expect(parsed(await pick(cookies, { choice: "suggested" })).choice).toBe("suggested");
      // A second phone signed in to the same account reads the same pick.
      const login = await inject({ method: "POST", url: "/v1/auth/login", body: { email: "foodchoice-keep@example.com", password: PASSWORD } });
      expect((await read(cookieMap(login))).choice).toBe("suggested");
      // The plan itself is untouched by the pick.
      const plan = await read(cookies);
      expect(plan.days.some((day) => day.meals.length > 0)).toBe(true);
    });

    it("My plan with no plan yet stays My plan", { timeout: 60_000 }, async () => {
      const cookies = await person("none-yet");
      const reply = parsed(await pick(cookies, { choice: "mine" }));
      expect(reply.choice).toBe("mine");
      expect(reply.days.every((day) => day.meals.length === 0)).toBe(true);
    });

    it("refuses what is not a choice, and changes nothing", { timeout: 60_000 }, async () => {
      const cookies = await person("refused");
      for (const body of [{}, { choice: "gym" }, { choice: "Suggested" }, { choice: null }, { choice: "mine", extra: 1 }, "mine"]) {
        expect((await pick(cookies, body)).statusCode, JSON.stringify(body)).toBe(400);
      }
      expect(await stored("refused")).toEqual([]);
      // Round one, L1: the table holds only the choices the server can read, and the gym's names a gym (31g).
      const id = (await sql<{ id: string }[]>`SELECT id FROM users WHERE email = 'foodchoice-refused@example.com'`)[0]?.id ?? "";
      await expect(sql`INSERT INTO recommended_choices (user_id, kind, choice) VALUES (${id}, 'food', 'coach')`).rejects.toThrow(/recommended_choices_choice_check/);
      await expect(sql`INSERT INTO recommended_choices (user_id, kind, choice) VALUES (${id}, 'food', 'gym')`).rejects.toThrow(/recommended_choices_gym_check/);
    });

    it("sent twice is one pick, one row", { timeout: 60_000 }, async () => {
      const cookies = await person("twice");
      const [a, b] = await Promise.all([pick(cookies, { choice: "suggested" }), pick(cookies, { choice: "suggested" })]);
      expect(parsed(a).choice).toBe("suggested");
      expect(parsed(b).choice).toBe("suggested");
      expect(await stored("twice")).toEqual([{ choice: "suggested" }]);
    });

    it("two phones picking at once: one row, and every read agrees with it", { timeout: 60_000 }, async () => {
      const cookies = await person("race");
      await Promise.all([pick(cookies, { choice: "suggested" }), pick(cookies, { choice: "mine" })]);
      const rows = await stored("race");
      expect(rows).toHaveLength(1);
      expect((await read(cookies)).choice).toBe(rows[0]?.choice);
    });
  });

  describe("a plan built after picking Suggested", () => {
    it("the first meals put in an empty week show My plan; a later change leaves the pick alone", { timeout: 60_000 }, async () => {
      const cookies = await person("built");
      await pick(cookies, { choice: "suggested" });
      expect((await make(cookies)).choice).toBe("mine");
      await pick(cookies, { choice: "suggested" });
      // The week already had meals: making it again is not a first plan.
      expect((await make(cookies)).choice).toBe("suggested");
      expect((await read(cookies)).choice).toBe("suggested");
    });

    it("round one A: a first meal added by hand in Build my own shows My plan; a meal added to another day later leaves the pick alone", { timeout: 60_000 }, async () => {
      const cookies = await person("by-hand");
      await pick(cookies, { choice: "suggested" });
      const meal = { mealType: "breakfast", items: [{ canonical: "banana", grams: 120 }, { canonical: "oatmeal", grams: 240 }] };
      const first = parsed(await putDay(cookies, 1, { changeId: randomUUID(), meals: [meal] }));
      expect(first.days[0]?.meals).toHaveLength(1);
      expect(first.choice).toBe("mine");
      expect(await stored("by-hand")).toEqual([{ choice: "mine" }]);
      await pick(cookies, { choice: "suggested" });
      expect(parsed(await putDay(cookies, 2, { changeId: randomUUID(), meals: [meal] })).choice).toBe("suggested");
      // Emptying the week and putting a meal in again is a first plan again.
      await putDay(cookies, 1, { changeId: randomUUID(), meals: [] });
      await putDay(cookies, 2, { changeId: randomUUID(), meals: [] });
      expect(parsed(await putDay(cookies, 3, { changeId: randomUUID(), meals: [meal] })).choice).toBe("mine");
    });
  });
});
