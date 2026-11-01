// GET /v1/nutrition/suggestions (ROADMAP 34d-i) against REAL Postgres.
// DATABASE_URL-gated. The first test is the job's worst thing, through the
// route: each person's ideas follow their OWN diet answer. The route takes no
// input, so there is nothing to fail validation; the stranger is somebody with
// no sign-in, and a signed-in person can only ever read their own.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { DIET_LABEL_CAUTION, FOOD_ALLERGY_CAUTION, dietAllows, mealIdeasResponseSchema, type Diet, type MealIdeasResponse } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { EmailSender } from "../src/modules/auth/email.js";
import { CURATED_FOODS } from "../src/modules/nutrition/foods.js";
import { ideasSeed } from "../src/modules/nutrition/service.js";
import { suggestMeals } from "../src/modules/nutrition/suggest.js";
import type { FoodSearchProvider } from "../src/modules/nutrition/openfoodfacts.adapter.js";

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
type Cookies = Record<string, string>;

const silentAuthSender = (): EmailSender => ({
  sendVerificationEmail: () => Promise.resolve(),
  sendPasswordResetEmail: () => Promise.resolve(),
  sendSignInCodeEmail: () => Promise.resolve(),
});
const noExternal: FoodSearchProvider = { search: () => Promise.resolve([]) };

let ipCounter = 0;
const nextIp = () => `10.11.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

/** A plan that keeps the weight: 1,817 kcal a day (users.onboarding.routes.test.ts's golden person). */
const PLAN_ANSWERS = {
  weightGoal: "maintain",
  age: 30,
  gender: "female",
  heightCm: 165,
  weightKg: 70,
  dayActivity: "sitting",
  trainingDays: 3,
  sessionMinutes: 45,
};

const DIET_OF = new Map(CURATED_FOODS.map((f) => [f.canonical, f.diet]));

d("meal ideas route (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const inject = (opts: { method: "GET" | "POST" | "PATCH"; url: string; body?: unknown; cookies?: Cookies }) =>
    api().inject({
      method: opts.method,
      url: opts.url,
      remoteAddress: nextIp(),
      headers: opts.body !== undefined ? { "content-type": "application/json" } : {},
      cookies: opts.cookies ?? {},
      ...(opts.body !== undefined ? { payload: JSON.stringify(opts.body) } : {}),
    });

  const makeUser = async (name: string, answers: Record<string, unknown> | null): Promise<Cookies> => {
    const email = `ideas-${name}@example.com`;
    const reg = await inject({ method: "POST", url: "/v1/auth/register", body: { email, password: PASSWORD, displayName: "Ideas Fixture" } });
    expect(reg.statusCode).toBe(201);
    const login = await inject({ method: "POST", url: "/v1/auth/login", body: { email, password: PASSWORD } });
    expect(login.statusCode).toBe(200);
    const cookies = cookieMap(login);
    if (answers !== null) {
      expect((await inject({ method: "PATCH", url: "/v1/users/me/onboarding", body: answers, cookies })).statusCode).toBe(200);
    }
    return cookies;
  };
  const eater = (name: string, diet: Diet, mealsPerDay = 3) => makeUser(name, { ...PLAN_ANSWERS, diet, mealsPerDay });

  const ideas = async (cookies: Cookies): Promise<MealIdeasResponse> => {
    const res = await inject({ method: "GET", url: "/v1/nutrition/suggestions", cookies });
    expect(res.statusCode).toBe(200);
    return mealIdeasResponseSchema.parse(JSON.parse(res.body));
  };
  const ok = async (cookies: Cookies): Promise<Extract<MealIdeasResponse, { status: "ok" }>> => {
    const reply = await ideas(cookies);
    if (reply.status !== "ok") throw new Error(`expected ideas, got ${reply.status}`);
    return reply;
  };
  const log = async (cookies: Cookies, items: { canonical: string; grams: number }[], takenAt = new Date(), mealType?: "snack" | "lunch"): Promise<number> => {
    const body = { mealName: "A meal", takenAt: takenAt.toISOString(), items, ...(mealType === undefined ? {} : { mealType }) };
    const res = await inject({ method: "POST", url: "/v1/nutrition/meals", cookies, body });
    expect(res.statusCode).toBe(201);
    return (JSON.parse(res.body) as { meal: { totals: { kcalPoint: number } } }).meal.totals.kcalPoint;
  };

  const clear = async () => {
    await sql`DELETE FROM meal_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'ideas-%@example.com')`;
    await sql`DELETE FROM users WHERE email LIKE 'ideas-%@example.com'`;
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

  it("THE WORST THING: a vegan beside a meat eater is offered only what a vegan eats", { timeout: 60_000 }, async () => {
    const vegan = await eater("vegan", "vegan");
    const meat = await eater("meat", "non_vegetarian");
    const vegetarian = await eater("vegetarian", "vegetarian");
    const eggs = await eater("eggs", "vegetarian_eggs");
    for (const [cookies, diet] of [[vegan, "vegan"], [vegetarian, "vegetarian"], [eggs, "vegetarian_eggs"], [meat, "non_vegetarian"]] as const) {
      const reply = await ok(cookies);
      const items = reply.meals.flatMap((m) => m.ideas).flatMap((i) => i.items);
      expect(items.length).toBeGreaterThan(0);
      // Told to check labels, and only they are.
      expect(reply.labelCaution, diet).toBe(diet === "non_vegetarian" ? null : DIET_LABEL_CAUTION);
      for (const item of items) {
        const foodDiet = DIET_OF.get(item.canonical);
        expect(foodDiet, item.name).toBeDefined();
        expect(dietAllows(diet, foodDiet ?? "non_vegetarian"), `${diet}: ${item.name}`).toBe(true);
      }
    }
  });

  it("three meals of the day's calories, the allergy line, and the same ideas when asked again", { timeout: 60_000 }, async () => {
    const cookies = await eater("day", "non_vegetarian");
    const reply = await ok(cookies);
    expect(reply.kcalLeft).toBe(1817);
    expect(reply.meals.map((m) => m.kcalTarget)).toEqual([606, 606, 606]);
    expect(reply.meals.every((m) => m.ideas.length === 3)).toBe(true);
    expect(reply.caution).toBe(FOOD_ALLERGY_CAUTION);
    expect(await ok(cookies)).toEqual(reply);
  });

  it("an idea logged as it stands is saved at the calories it showed, and the next reply counts it", { timeout: 60_000 }, async () => {
    const cookies = await eater("log", "vegetarian_eggs");
    const first = await ok(cookies);
    const idea = first.meals[0]?.ideas[0];
    if (idea === undefined) throw new Error("no idea to log");
    const saved = await log(cookies, idea.items.map((i) => ({ canonical: i.canonical, grams: i.grams })));
    expect(saved).toBe(idea.totals.kcal);

    const after = await ok(cookies);
    expect(after.kcalLeft).toBe(1817 - saved);
    expect(after.meals.length).toBe(2);
    // A meal logged draws other ideas: the reply is the rule's for the person's id AND the meals logged.
    const rows = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = 'ideas-log@example.com'`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("no such person");
    const numbers = { day: after.day, diet: "vegetarian_eggs", mealsPerDay: 3, kcalTarget: 1817, kcalEaten: saved, mealsLogged: 1 } as const;
    expect(after.meals).toEqual(suggestMeals({ ...numbers, seed: ideasSeed(id, 1) }).meals);
    expect(after.meals).not.toEqual(suggestMeals({ ...numbers, seed: id }).meals);
  });

  it("a meal of another day is not counted, and nothing is suggested once the day is eaten", { timeout: 60_000 }, async () => {
    const cookies = await eater("days", "non_vegetarian");
    await log(cookies, [{ canonical: "rice_white_cooked", grams: 1000 }], new Date(Date.now() - 30 * 60 * 60 * 1000));
    expect((await ok(cookies)).kcalLeft).toBe(1817);

    const eaten = await log(cookies, [{ canonical: "rice_white_cooked", grams: 1400 }]);
    const done = await ok(cookies);
    expect(done.kcalLeft).toBe(1817 - eaten);
    expect(done.meals).toEqual([]);
    expect(done.caution).toBe(FOOD_ALLERGY_CAUTION);
  });

  it("the day is the person's own: a meal an hour before THEIR midnight is yesterday's, one an hour after is today's", { timeout: 60_000 }, async () => {
    // Kiritimati is fourteen hours ahead of UTC all year, so both meals fall on ONE day of UTC.
    const zone = "Pacific/Kiritimati";
    const cookies = await eater("zone", "non_vegetarian");
    await sql`UPDATE users SET timezone = ${zone} WHERE email = 'ideas-zone@example.com'`;
    const now = new Date();
    const theirDay = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    const theirMidnight = Date.parse(`${theirDay}T00:00:00Z`) - 14 * 60 * 60 * 1000;
    const hour = 60 * 60 * 1000;
    // Where they are less than an hour into the day, "an hour after midnight" is 30 minutes ahead; a meal may be.
    const after = new Date(Math.min(theirMidnight + hour, now.getTime() + hour / 2));
    await log(cookies, [{ canonical: "rice_white_cooked", grams: 500 }], new Date(theirMidnight - hour));
    const today = await log(cookies, [{ canonical: "rice_white_cooked", grams: 300 }], after);

    const reply = await ok(cookies);
    expect(reply.day).toBe(theirDay);
    expect(reply.kcalLeft).toBe(1817 - today);
  });

  it("a snack, and a bite under the least a meal holds, are eaten and are not a meal", { timeout: 60_000 }, async () => {
    const cookies = await eater("snack", "non_vegetarian");
    const snack = await log(cookies, [{ canonical: "rice_white_cooked", grams: 300 }], new Date(), "snack");
    const bite = await log(cookies, [{ canonical: "rice_white_cooked", grams: 100 }]);
    expect(bite).toBeLessThan(150);
    const before = await ok(cookies);
    expect(before.kcalLeft).toBe(1817 - snack - bite);
    expect(before.meals.length).toBe(3);

    await log(cookies, [{ canonical: "rice_white_cooked", grams: 300 }], new Date(), "lunch");
    expect((await ok(cookies)).meals.length).toBe(2);
  });

  it("nobody is given ideas on a guessed answer: the missing ones are named", { timeout: 60_000 }, async () => {
    expect(await ideas(await makeUser("none", PLAN_ANSWERS))).toEqual({ status: "needs_answers", missing: ["diet", "mealsPerDay"] });
    expect(await ideas(await makeUser("nodiet", { ...PLAN_ANSWERS, mealsPerDay: 3 }))).toEqual({ status: "needs_answers", missing: ["diet"] });
    expect(await ideas(await makeUser("nomeals", { ...PLAN_ANSWERS, diet: "vegan" }))).toEqual({ status: "needs_answers", missing: ["mealsPerDay"] });
    expect(await ideas(await makeUser("new", null))).toEqual({ status: "needs_answers", missing: ["diet", "mealsPerDay"] });
  });

  it("no calorie number yet: no ideas", { timeout: 60_000 }, async () => {
    expect(await ideas(await makeUser("noplan", { diet: "vegan", mealsPerDay: 3 }))).toEqual({ status: "needs_plan" });
  });

  it("a person the plan may not cut is sized to the whole daily burn", { timeout: 60_000 }, async () => {
    const teen = await makeUser("teen", { ...PLAN_ANSWERS, weightGoal: "lose", targetWeightKg: 65, pace: "steady", diet: "non_vegetarian", mealsPerDay: 3 });
    // No route saves an age under 18 since the app became 18+ (RULINGS 2026-09-15); the floor stays for a row from before.
    await sql`UPDATE user_fitness_profiles SET age = 16 WHERE user_id = (SELECT id FROM users WHERE email = 'ideas-teen@example.com')`;
    const targets = JSON.parse((await inject({ method: "GET", url: "/v1/nutrition/targets", cookies: teen })).body) as { targets: { kcal: number } };
    expect(targets.targets.kcal).toBe(1901);
    expect((await ok(teen)).kcalLeft).toBe(1901);
  });

  it("without a sign-in: 401", async () => {
    expect((await inject({ method: "GET", url: "/v1/nutrition/suggestions" })).statusCode).toBe(401);
  });
});
