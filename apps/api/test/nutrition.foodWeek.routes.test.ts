// Your week in food (ROADMAP 34f-i) against REAL Postgres. DATABASE_URL-gated; needs
// migration 0110. The first block is the job's worst thing: another person's meals in
// somebody's week. Then the route's happy path, a validation failure, the person's own
// time zone, the targets kept on the day a meal is logged, and a week across a change.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { foodWeekResponseSchema, nutritionTargetsResponseSchema, type FoodWeekResponse } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { EmailSender } from "../src/modules/auth/email.js";
import type { FoodSearchProvider } from "../src/modules/nutrition/openfoodfacts.adapter.js";
import { dayInTz } from "../src/modules/gamification/streak.js";
import { spanDays } from "../src/modules/nutrition/foodWeek.js";

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
const nextIp = () => `10.14.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

/** A plan that keeps the weight (users.onboarding.routes.test.ts's golden person). */
const PLAN_ANSWERS = {
  weightGoal: "maintain", age: 30, gender: "female", heightCm: 165, weightKg: 70,
  dayActivity: "sitting", trainingDays: 3, sessionMinutes: 45,
};

/** A food item as a saved meal holds it. */
const item = (kcal: number, proteinG: number, source = "usda", sodiumMg: number | null = null) => ({
  name: "Fixture food", canonical: "rice_white_cooked", gramsPoint: 100, gramsRange: [90, 110], portionSource: "default",
  nutritionSource: source, kcalPoint: kcal, kcalLow: kcal, kcalHigh: kcal, proteinG, carbsG: 0, fatG: 0,
  more: { fiberG: null, sugarsG: null, satFatG: null, unsatFatG: null, sodiumMg, potassiumMg: null, calciumMg: null, ironMg: null, magnesiumMg: null, vitaminDUg: null },
});

d("your week in food (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const inject = (opts: { method: "GET" | "POST" | "PATCH" | "PUT"; url: string; body?: unknown; cookies?: Cookies }) =>
    api().inject({
      method: opts.method,
      url: opts.url,
      remoteAddress: nextIp(),
      headers: opts.body !== undefined ? { "content-type": "application/json" } : {},
      cookies: opts.cookies ?? {},
      ...(opts.body !== undefined ? { payload: JSON.stringify(opts.body) } : {}),
    });

  const makeUser = async (name: string, answers: Record<string, unknown> | null = PLAN_ANSWERS): Promise<{ cookies: Cookies; id: string }> => {
    const email = `foodweek-${name}@example.com`;
    const reg = await inject({ method: "POST", url: "/v1/auth/register", body: { email, password: PASSWORD, displayName: "Week Fixture" } });
    expect(reg.statusCode).toBe(201);
    const login = await inject({ method: "POST", url: "/v1/auth/login", body: { email, password: PASSWORD } });
    expect(login.statusCode).toBe(200);
    const cookies = cookieMap(login);
    if (answers !== null) {
      expect((await inject({ method: "PATCH", url: "/v1/users/me/onboarding", body: answers, cookies })).statusCode).toBe(200);
    }
    const rows = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error(`no fixture ${name}`);
    return { cookies, id };
  };

  const week = async (cookies: Cookies, days?: number): Promise<FoodWeekResponse> => {
    const res = await inject({ method: "GET", url: `/v1/nutrition/food-week${days === undefined ? "" : `?days=${String(days)}`}`, cookies });
    expect(res.statusCode, res.body).toBe(200);
    return foodWeekResponseSchema.parse(JSON.parse(res.body));
  };
  /** A meal saved straight into the table, at an exact time. */
  const putMeal = async (userId: string, takenAt: Date, items: Omit<ReturnType<typeof item>, "more">[]) => {
    const kcal = items.reduce((n, i) => n + i.kcalPoint, 0);
    const protein = items.reduce((n, i) => n + i.proteinG, 0);
    await sql`
      INSERT INTO meal_logs (user_id, taken_at, items, kcal_point, kcal_low, kcal_high, protein_g, carbs_g, fat_g,
                             portion_source, nutrition_sources, calc_version)
      VALUES (${userId}, ${takenAt}, ${sql.json(items)}, ${kcal}, ${kcal}, ${kcal}, ${protein}, 0, 0,
              'default', ${[...new Set(items.map((i) => i.nutritionSource))]}, 1)`;
  };
  const todayIn = (tz: string) => dayInTz(new Date(), tz);
  /** Noon UTC on a day: the same day in every zone from UTC-11 to UTC+11. */
  const noonOf = (day: string) => new Date(`${day}T12:00:00Z`);

  const mine = sql`SELECT id FROM users WHERE email LIKE 'foodweek-%@example.com'`;
  const clear = async () => {
    await sql`DELETE FROM meal_logs WHERE user_id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'foodweek-%@example.com'`;
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

  describe("THE WORST THING: another person's meals in somebody's week", () => {
    it("two people's meals on the same days: each week holds only its own, and their kept targets stay apart", async () => {
      const a = await makeUser("worst-a");
      const b = await makeUser("worst-b");
      const days = spanDays(todayIn("UTC"), 7);
      for (const day of days.slice(0, 6)) {
        await putMeal(a.id, noonOf(day), [item(500, 20)]);
        await putMeal(b.id, noonOf(day), [item(3000, 200, "estimate")]);
      }
      const yesterday = days[5] ?? "";
      await sql`INSERT INTO food_day_targets (user_id, day, kcal, protein_g, carbs_g, fat_g) VALUES (${b.id}, ${yesterday}, 4000, 300, 400, 100)`;
      const wa = await week(a.cookies, 30);
      const filled = wa.days.filter((x) => x.meals > 0);
      expect(filled).toHaveLength(6);
      for (const x of filled) expect(x).toMatchObject({ meals: 1, kcal: 500, proteinG: 20, about: false });
      expect(wa.days.find((x) => x.day === yesterday)?.targets?.kcal).not.toBe(4000);
      const wb = await week(b.cookies);
      expect(wb.days.filter((x) => x.meals > 0).every((x) => x.kcal === 3000 && x.about)).toBe(true);
      expect(wb.days.find((x) => x.day === yesterday)?.targets?.kcal).toBe(4000);
    });

    it("nobody signed in is refused, and no query names a person", async () => {
      expect((await inject({ method: "GET", url: "/v1/nutrition/food-week" })).statusCode).toBe(401);
      const a = await makeUser("worst-query");
      const res = await inject({ method: "GET", url: `/v1/nutrition/food-week?userId=${a.id}`, cookies: a.cookies });
      expect(res.statusCode).toBe(400);
    });
  });

  it("answers the last 7 days by default and 30 on asking; any other span is refused", async () => {
    const { cookies } = await makeUser("spans");
    const seven = await week(cookies);
    expect(seven.span).toBe(7);
    expect(seven.days).toHaveLength(7);
    expect(seven.days.at(-1)).toMatchObject({ day: todayIn("UTC"), today: true });
    expect((await week(cookies, 30)).days).toHaveLength(30);
    for (const bad of ["14", "0", "seven", "-7"]) {
      const res = await inject({ method: "GET", url: `/v1/nutrition/food-week?days=${bad}`, cookies });
      expect(res.statusCode, bad).toBe(400);
    }
  });

  it("adds up a day's meals: the four figures, an estimate makes it about, fibre and salt with the foods that lack them", async () => {
    const { cookies, id } = await makeUser("sums");
    const days = spanDays(todayIn("UTC"), 7);
    const day = days[3] ?? "";
    const plain = days[2] ?? "";
    const withMore = (kcal: number, protein: number, fiberG: number | null, sodiumMg: number | null) => {
      const it = item(kcal, protein, "usda", sodiumMg);
      return { ...it, more: { ...it.more, fiberG } };
    };
    const savedBeforeMore = { name: "Old food", canonical: "rice_white_cooked", gramsPoint: 100, gramsRange: [90, 110], portionSource: "default", nutritionSource: "usda", kcalPoint: 100, kcalLow: 100, kcalHigh: 100, proteinG: 1.1, carbsG: 0, fatG: 0 };
    await putMeal(id, noonOf(day), [withMore(300, 10.1, 2.1, 120), withMore(200, 5.2, null, 80)]);
    await putMeal(id, new Date(`${day}T15:00:00Z`), [item(400, 20.3, "estimate"), savedBeforeMore]);
    await putMeal(id, noonOf(plain), [withMore(500, 25, 3, 400)]);
    const w = await week(cookies);
    expect(w.days.find((x) => x.day === day)).toMatchObject({
      meals: 2, kcal: 1000, proteinG: 36.7, about: true,
      fiberG: { amount: 2.1, notKnown: 3 }, sodiumMg: { amount: 200, notKnown: 2 },
    });
    expect(w.days.find((x) => x.day === plain)).toMatchObject({ meals: 1, about: false, fiberG: { amount: 3, notKnown: 0 } });
  });

  it("puts a meal on the day of the person's own time zone", async () => {
    const { cookies, id } = await makeUser("zone");
    await sql`UPDATE users SET timezone = 'Asia/Kolkata' WHERE id = ${id}`;
    const today = todayIn("Asia/Kolkata");
    const days = spanDays(today, 7);
    const twoAgo = days[4] ?? "";
    const threeAgo = days[3] ?? "";
    // 23:30 in Kolkata two days ago is 18:00 UTC that day; 00:15 in Kolkata is 18:45 UTC the day before.
    await putMeal(id, new Date(`${twoAgo}T18:00:00Z`), [item(400, 10)]);
    await putMeal(id, new Date(`${threeAgo}T18:45:00Z`), [item(600, 10)]);
    // 23:30 stays on its day; 00:15 is the next day there, though UTC still reads the day before.
    const w = await week(cookies);
    expect(w.days.find((x) => x.day === twoAgo)).toMatchObject({ meals: 2, kcal: 1000 });
    expect(w.days.find((x) => x.day === threeAgo)).toMatchObject({ meals: 0, kcal: 0 });
  });

  it("keeps today's targets once a meal of today is logged, and reads an older day against the targets kept on it", async () => {
    const { cookies, id } = await makeUser("kept");
    const targetsRes = await inject({ method: "GET", url: "/v1/nutrition/targets", cookies });
    const now = nutritionTargetsResponseSchema.parse(JSON.parse(targetsRes.body)).targets;
    if (now === null) throw new Error("the golden person has targets");
    const logged = await inject({
      method: "POST", url: "/v1/nutrition/meals", cookies,
      body: { mealName: "Lunch", takenAt: new Date().toISOString(), items: [{ canonical: "rice_white_cooked", grams: 200 }] },
    });
    expect(logged.statusCode, logged.body).toBe(201);
    const today = todayIn("UTC");
    const kept = await sql<{ day: string; kcal: number; protein_g: number }[]>`
      SELECT day::text AS day, kcal, protein_g FROM food_day_targets WHERE user_id = ${id}`;
    expect(kept).toEqual([{ day: today, kcal: now.kcal, protein_g: now.proteinG }]);

    // A meal logged today for an earlier day keeps nothing for that day.
    const days = spanDays(today, 7);
    const earlier = days[2] ?? "";
    const backfill = await inject({
      method: "POST", url: "/v1/nutrition/meals", cookies,
      body: { mealName: "Old dinner", takenAt: noonOf(earlier).toISOString(), items: [{ canonical: "rice_white_cooked", grams: 200 }] },
    });
    expect(backfill.statusCode).toBe(201);
    expect((await sql`SELECT 1 FROM food_day_targets WHERE user_id = ${id} AND day = ${earlier}::date`).length).toBe(0);

    // A week across a change: the person's numbers were bigger three days ago.
    const before = days[3] ?? "";
    await sql`INSERT INTO food_day_targets (user_id, day, kcal, protein_g, carbs_g, fat_g) VALUES (${id}, ${before}, 3000, 200, 300, 100)`;
    await putMeal(id, noonOf(before), [item(now.kcal, now.proteinG)]);
    const w = await week(cookies);
    expect(w.days.find((x) => x.day === before)).toMatchObject({
      targets: { kcal: 3000, proteinG: 200, carbsG: 300, fatG: 100 }, targetsOfTheDay: true, bands: { kcal: "under", proteinG: "under" },
    });
    expect(w.days.find((x) => x.day === earlier)).toMatchObject({ targets: { kcal: now.kcal }, targetsOfTheDay: false });
    expect(w.days.at(-1)).toMatchObject({ today: true, targetsOfTheDay: true });
    // Today is shown and not counted: the two finished days with meals are judged.
    expect(w.facts.kcal.judged).toBe(2);
  });

  it("changing one's own numbers keeps them as today's", async () => {
    const { cookies, id } = await makeUser("own");
    const put = await inject({ method: "PUT", url: "/v1/nutrition/targets", cookies, body: { source: "own", kcal: 2400, proteinG: 150, carbsG: 250, fatG: 80 } });
    expect(put.statusCode, put.body).toBe(200);
    const kept = await sql<{ kcal: number }[]>`SELECT kcal FROM food_day_targets WHERE user_id = ${id} AND day = ${todayIn("UTC")}::date`;
    expect(kept.map((r) => r.kcal)).toEqual([2400]);
  });

  it("with the questions not answered, shows what was eaten and judges nothing", async () => {
    const { cookies, id } = await makeUser("noplan", null);
    const yesterday = spanDays(todayIn("UTC"), 2)[0] ?? "";
    await putMeal(id, noonOf(yesterday), [item(800, 30, "usda", 900)]);
    const w = await week(cookies);
    expect(w.days.find((x) => x.day === yesterday)).toMatchObject({
      kcal: 800, targets: null, bands: null, sodiumMg: { amount: 900, notKnown: 0 },
    });
    expect(w.facts.proteinG).toEqual({ under: 0, on: 0, over: 0, judged: 0 });
    expect((await sql`SELECT 1 FROM food_day_targets WHERE user_id = ${id}`).length).toBe(0);
  });
});
