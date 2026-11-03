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
import { suggestAfterWorkout, suggestMeals, type SuggestInput } from "../src/modules/nutrition/suggest.js";
import { getAfterWorkoutIdeas } from "../src/modules/nutrition/service.js";
import { hourInTz } from "../src/modules/gamification/streak.js";
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
  const login = async (name: string): Promise<Cookies> =>
    cookieMap(await inject({ method: "POST", url: "/v1/auth/login", body: { email: `ideas-${name}@example.com`, password: PASSWORD } }));

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

  const idOf = async (name: string): Promise<string> => {
    const rows = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${`ideas-${name}@example.com`}`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("no such person");
    return id;
  };
  const proteinTarget = async (cookies: Cookies): Promise<number> =>
    (JSON.parse((await inject({ method: "GET", url: "/v1/nutrition/targets", cookies })).body) as { targets: { proteinG: number } }).targets.proteinG;
  const proteinEaten = async (id: string): Promise<number> =>
    Number((await sql<{ p: string }[]>`SELECT coalesce(sum(protein_g), 0) AS p FROM meal_logs WHERE user_id = ${id}`)[0]?.p ?? 0);
  /** The reply against the rule's own answer for these numbers, at the hour before or after the request (a reply may straddle one). */
  const expectRule = async (cookies: Cookies, numbers: Omit<SuggestInput, "hour">, before: number, zone = "UTC"): Promise<void> => {
    const reply = await ok(cookies);
    const at = [before, hourInTz(new Date(), zone)].map((hour) => suggestMeals({ ...numbers, hour }).meals);
    expect(at.some((meals) => JSON.stringify(meals) === JSON.stringify(reply.meals))).toBe(true);
  };

  const clear = async () => {
    await sql`DELETE FROM workouts WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'ideas-%@example.com')`;
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
    const id = await idOf("log");
    const hour = hourInTz(new Date(), "UTC");
    const numbers = {
      day: after.day, diet: "vegetarian_eggs", mealsPerDay: 3, kcalTarget: 1817, kcalEaten: saved, mealsLogged: 1, afterWorkout: false,
      protein: { weightKg: 70, dayTargetG: await proteinTarget(cookies), eatenG: await proteinEaten(id) },
    } as const;
    await expectRule(cookies, { ...numbers, seed: ideasSeed(id, 1) }, hour);
    expect(after.meals).not.toEqual(suggestMeals({ ...numbers, hour, seed: id }).meals);
  });

  it("the protein eaten today is read: the same calories of chicken or of rice draw different ideas, each the rule's", { timeout: 60_000 }, async () => {
    const chicken = await eater("chicken", "non_vegetarian");
    const rice = await eater("rice", "non_vegetarian");
    const hour = hourInTz(new Date(), "UTC");
    const kcalChicken = await log(chicken, [{ canonical: "chicken_breast_grilled", grams: 300 }]);
    // Rice of the same calories, near enough: the two differ in protein, not in the meals' sizes.
    const kcalRice = await log(rice, [{ canonical: "rice_white_cooked", grams: Math.round((kcalChicken / 130) * 100) }]);
    const target = await proteinTarget(chicken);
    for (const [cookies, name, kcal] of [[chicken, "chicken", kcalChicken], [rice, "rice", kcalRice]] as const) {
      const id = await idOf(name);
      await expectRule(cookies, {
        seed: ideasSeed(id, 1), day: (await ok(cookies)).day, diet: "non_vegetarian", mealsPerDay: 3, kcalTarget: 1817, kcalEaten: kcal, mealsLogged: 1,
        afterWorkout: false, protein: { weightKg: 70, dayTargetG: target, eatenG: await proteinEaten(id) },
      }, hour);
    }
    const mean = (r: Extract<MealIdeasResponse, { status: "ok" }>) => {
      const all = r.meals.flatMap((m) => m.ideas);
      return all.reduce((n, i) => n + i.totals.proteinG, 0) / all.length;
    };
    expect(mean(await ok(rice))).toBeGreaterThan(mean(await ok(chicken)));
  });

  it("a workout that ended within two hours makes the next meal the meal after it; one that ended three hours ago does not", { timeout: 60_000 }, async () => {
    const cookies = await eater("workout", "vegetarian");
    const id = await idOf("workout");
    const hour = hourInTz(new Date(), "UTC");
    const numbers = (afterWorkout: boolean) => ({
      seed: ideasSeed(id, 0), day: "", diet: "vegetarian", mealsPerDay: 3, kcalTarget: 1817, kcalEaten: 0, mealsLogged: 0, afterWorkout,
      protein: { weightKg: 70, dayTargetG: 0, eatenG: 0 },
    } as const);
    const target = await proteinTarget(cookies);
    const day = (await ok(cookies)).day;
    const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
    await sql`INSERT INTO workouts (id, user_id, started_at, ended_at, platform, engine_version)
      VALUES (gen_random_uuid(), ${id}, ${new Date(old.getTime() - 45 * 60 * 1000)}, ${old}, 'android', 'test')`;
    await expectRule(cookies, { ...numbers(false), day, protein: { weightKg: 70, dayTargetG: target, eatenG: 0 } }, hour);
    // The line under each idea (31d-ii): no idea speaks of a workout three hours gone.
    const whys = async () => (await ok(cookies)).meals.flatMap((m, at) => m.ideas.map((i) => `${String(at)}:${i.why}`));
    expect(await whys()).not.toContain("0:after_workout");
    const recent = new Date(Date.now() - 30 * 60 * 1000);
    await sql`INSERT INTO workouts (id, user_id, started_at, ended_at, platform, engine_version)
      VALUES (gen_random_uuid(), ${id}, ${new Date(recent.getTime() - 45 * 60 * 1000)}, ${recent}, 'android', 'test')`;
    await expectRule(cookies, { ...numbers(true), day, protein: { weightKg: 70, dayTargetG: target, eatenG: 0 } }, hour);
    expect(await whys()).toContain("0:after_workout");
    expect((await whys()).filter((w) => w.endsWith("after_workout") && !w.startsWith("0:"))).toEqual([]);
    // The two differ, so the check above tells them apart.
    const p = { weightKg: 70, dayTargetG: target, eatenG: 0 };
    expect(suggestMeals({ ...numbers(true), day, protein: p, hour }).meals).not.toEqual(suggestMeals({ ...numbers(false), day, protein: p, hour }).meals);
    // Somebody else's workout is not theirs.
    const other = await eater("otherworkout", "vegetarian");
    const otherId = await idOf("otherworkout");
    await expectRule(other, { ...numbers(false), seed: ideasSeed(otherId, 0), day, protein: { weightKg: 70, dayTargetG: target, eatenG: 0 } }, hour);
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

  it("the person's own time zone decides: in India no beef or pork, in New York no Indian dish, through the real route", { timeout: 60_000 }, async () => {
    const india = await eater("india", "non_vegetarian", 6);
    const usa = await eater("usa", "vegetarian", 6);
    await sql`UPDATE users SET timezone = 'Asia/Kolkata' WHERE email = 'ideas-india@example.com'`;
    await sql`UPDATE users SET timezone = 'America/New_York' WHERE email = 'ideas-usa@example.com'`;
    // Each reply is the rule's own for the person's region, so a reply that merely happened to draw no such food cannot pass.
    for (const [cookies, name, diet, region, zone] of [[india, "india", "non_vegetarian", "india", "Asia/Kolkata"], [usa, "usa", "vegetarian", "west", "America/New_York"]] as const) {
      const hour = hourInTz(new Date(), zone);
      const reply = await ok(cookies);
      await expectRule(cookies, {
        seed: ideasSeed(await idOf(name), 0), day: reply.day, diet, mealsPerDay: 6, kcalTarget: 1817, kcalEaten: 0, mealsLogged: 0,
        afterWorkout: false, region, protein: { weightKg: 70, dayTargetG: await proteinTarget(cookies), eatenG: 0 },
      }, hour, zone);
    }
    const names = async (cookies: Cookies) => (await ok(cookies)).meals.flatMap((m) => m.ideas).flatMap((i) => i.items).map((i) => i.name);
    const inIndia = await names(india);
    expect(inIndia.length).toBeGreaterThan(0);
    for (const n of inIndia) expect(/beef|pork|^steak|chili con carne|bolognese|cobb|paella|bibimbap|rice and beans with meat/i.test(n), n).toBe(false);
    const inUsa = await names(usa);
    expect(inUsa.length).toBeGreaterThan(0);
    for (const n of inUsa) expect(/curry|\bdal\b|masala|tandoori|sambar|khichdi|roti|chapati/i.test(n), n).toBe(false);
  });

  it("the ideas after a workout read the person's weight and time zone: the rule's own for a person in India", { timeout: 60_000 }, async () => {
    await eater("afterindia", "non_vegetarian", 3);
    await sql`UPDATE users SET timezone = 'Asia/Kolkata' WHERE email = 'ideas-afterindia@example.com'`;
    const id = await idOf("afterindia");
    // A workout of an earlier day: its meal is sized to a usual meal, with nothing eaten.
    const workout = { id: "11111111-2222-4333-8444-555555555555", startedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), kcalBurned: 450 };
    const got = await getAfterWorkoutIdeas({ sql }, id, workout);
    const targets = JSON.parse((await inject({ method: "GET", url: "/v1/nutrition/targets", cookies: await login("afterindia") })).body) as { targets: { kcal: number } };
    const want = suggestAfterWorkout({
      seed: `${id}|${workout.id}`, diet: "non_vegetarian", kcalBurned: 450, weightKg: 70, region: "india",
      day: { mealsPerDay: 3, kcalTarget: targets.targets.kcal, kcalEaten: 0, mealsLogged: 0 },
    });
    expect(got.ideas).toEqual(want);
    expect(got.ideas).not.toEqual(suggestAfterWorkout({
      seed: `${id}|${workout.id}`, diet: "non_vegetarian", kcalBurned: 450, weightKg: null,
      day: { mealsPerDay: 3, kcalTarget: targets.targets.kcal, kcalEaten: 0, mealsLogged: 0 },
    }));
  });

  it("without a sign-in: 401", async () => {
    expect((await inject({ method: "GET", url: "/v1/nutrition/suggestions" })).statusCode).toBe(401);
  });
});
