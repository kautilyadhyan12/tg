// A person's own diet plan (ROADMAP 34e-i) against REAL Postgres. DATABASE_URL-gated;
// needs migration 0109. The first block is the job's worst thing through the routes:
// a vegan's or vegetarian's plan holding meat, fish, egg or milk, made or swapped, and
// a plan below the calories of somebody the app may not cut. Then each route: the
// happy path, a validation failure, the stranger, and a change sent twice.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  DIET_LABEL_CAUTION, FOOD_ALLERGY_CAUTION, dietAllows, dietPlanResponseSchema, mealMeasuresResponseSchema, nutritionTargetsResponseSchema, planItemChoice,
  type Diet, type DietPlanResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { EmailSender } from "../src/modules/auth/email.js";
import type { FoodSearchProvider } from "../src/modules/nutrition/openfoodfacts.adapter.js";
import { foodOf, tableLowest } from "./foodDietByTable.js";

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
/** Counts the searches that would go out to Open Food Facts. */
let searches = 0;
const noExternal: FoodSearchProvider = {
  search: () => {
    searches++;
    return Promise.resolve([]);
  },
};
type Res = { statusCode: number; body: string };

let ipCounter = 0;
const nextIp = () => `10.12.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
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
/** The same person losing weight: 1,267 kcal a day where the plan may cut. */
const LOSING = { ...PLAN_ANSWERS, weightGoal: "lose", targetWeightKg: 65, pace: "steady" };

d("diet plan routes (real Postgres)", () => {
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

  const makeUser = async (name: string, answers: Record<string, unknown> | null): Promise<Cookies> => {
    const email = `dietplan-${name}@example.com`;
    const reg = await inject({ method: "POST", url: "/v1/auth/register", body: { email, password: PASSWORD, displayName: "Plan Fixture" } });
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

  const parsed = (res: { statusCode: number; body: string }): DietPlanResponse => {
    expect(res.statusCode, res.body).toBe(200);
    return dietPlanResponseSchema.parse(JSON.parse(res.body));
  };
  const read = async (cookies: Cookies) => parsed(await inject({ method: "GET", url: "/v1/nutrition/diet-plan", cookies }));
  const make = (cookies: Cookies, body: unknown = { changeId: randomUUID() }) =>
    inject({ method: "POST", url: "/v1/nutrition/diet-plan/make", body, cookies });
  const putDay = (cookies: Cookies, day: number | string, body: unknown) =>
    inject({ method: "PUT", url: `/v1/nutrition/diet-plan/days/${String(day)}`, body, cookies });
  const swap = (cookies: Cookies, day: number | string, body: unknown) =>
    inject({ method: "POST", url: `/v1/nutrition/diet-plan/days/${String(day)}/swap`, body, cookies });
  const errorOf = (res: { body: string }) => (JSON.parse(res.body) as { error: string }).error;
  const messageOf = (res: { body: string }) => (JSON.parse(res.body) as { message: string }).message;
  const idOf = async (name: string): Promise<string> => {
    const rows = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${`dietplan-${name}@example.com`}`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error(`no fixture ${name}`);
    return id;
  };
  /** Until `n` requests wait on a plan row the test itself holds. */
  const waiting = async (n: number) => {
    for (let tries = 0; tries < 400; tries++) {
      const rows = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND query LIKE '%FROM diet_plans WHERE user_id%FOR UPDATE%'`;
      if ((rows[0]?.n ?? 0) >= n) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`${String(n)} requests never waited on the plan`);
  };
  const foodsOf = (plan: DietPlanResponse): string[] => plan.days.flatMap((day) => day.meals.flatMap((m) => m.items.map((i) => i.canonical)));
  const wrongFor = (diet: Diet, canonicals: readonly string[]): string[] =>
    [...new Set(canonicals)].map(foodOf)
      .filter((f) => !dietAllows(diet, f.diet) || !dietAllows(diet, tableLowest(f)))
      .map((f) => f.name);

  const mine = sql`SELECT id FROM users WHERE email LIKE 'dietplan-%@example.com'`;
  const clear = async () => {
    await sql`DELETE FROM diet_plans WHERE user_id IN (${mine})`;
    await sql`DELETE FROM meal_logs WHERE user_id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'dietplan-%@example.com'`;
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

  describe("THE WORST THING: a plan holding what the person does not eat, or less than they may eat", () => {
    it("a vegan's, a vegetarian's and an egg-eating vegetarian's week, made and every meal swapped: no meat, fish, egg or milk the diet rules out", { timeout: 120_000 }, async () => {
      for (const diet of ["vegan", "vegetarian", "vegetarian_eggs"] as const) {
        const cookies = await eater(`worst-${diet}`, diet, 4);
        const made = parsed(await make(cookies));
        const foods = foodsOf(made);
        expect(foods.length, diet).toBeGreaterThan(20);
        let swapped = made;
        for (const day of swapped.days) {
          for (const [at] of day.meals.entries()) {
            swapped = parsed(await swap(cookies, day.day, { changeId: randomUUID(), meal: at }));
            foods.push(...foodsOf(swapped));
          }
        }
        expect(wrongFor(diet, foods), diet).toEqual([]);
        expect(swapped.labelCaution).toBe(DIET_LABEL_CAUTION);
        expect(swapped.caution).toBe(FOOD_ALLERGY_CAUTION);
      }
    });

    it("a meat eater who becomes vegan: the plan made before reads which foods their diet no longer eats, and a swap gives a vegan meal", { timeout: 60_000 }, async () => {
      const cookies = await eater("turned", "non_vegetarian", 3);
      const made = parsed(await make(cookies));
      expect(made.days.every((d) => d.meals.every((m) => m.outsideDiet.length === 0))).toBe(true);
      expect((await inject({ method: "PATCH", url: "/v1/users/me/onboarding", body: { diet: "vegan" }, cookies })).statusCode).toBe(200);
      const now = await read(cookies);
      const flagged = now.days.flatMap((d) => d.meals.flatMap((m, at) => (m.outsideDiet.length > 0 ? [{ day: d.day, at, m }] : [])));
      expect(flagged.length).toBeGreaterThan(0);
      for (const { m } of flagged) {
        const wrong = m.items.filter((i) => !dietAllows("vegan", foodOf(i.canonical).diet)).map((i) => i.name);
        expect(m.outsideDiet).toEqual(wrong);
      }
      // Every meal that is not flagged holds only vegan foods.
      const unflagged = now.days.flatMap((d) => d.meals.filter((m) => m.outsideDiet.length === 0).flatMap((m) => m.items.map((i) => i.canonical)));
      expect(wrongFor("vegan", unflagged)).toEqual([]);
      const first = flagged[0];
      if (first === undefined) throw new Error("nothing flagged");
      const swapped = parsed(await swap(cookies, first.day, { changeId: randomUUID(), meal: first.at }));
      const meal = swapped.days[first.day - 1]?.meals[first.at];
      expect(meal?.outsideDiet).toEqual([]);
      expect(wrongFor("vegan", meal?.items.map((i) => i.canonical) ?? [])).toEqual([]);
    });

    it("under 18: every day is made to at least the calories the rings show, never a cut, past what eight meals hold too, and a swap never lowers it", { timeout: 120_000 }, async () => {
      const ringsOf = async (cookies: Cookies) => {
        const res = await inject({ method: "GET", url: "/v1/nutrition/targets", cookies });
        return nutritionTargetsResponseSchema.parse(JSON.parse(res.body)).targets;
      };
      const adultRings = await ringsOf(await makeUser("adult", { ...LOSING, diet: "non_vegetarian", mealsPerDay: 3 }));
      const TEENS = [
        // Losing weight: the rings hold the whole burn, never a cut.
        { name: "teen", answers: { ...LOSING, age: 16, diet: "non_vegetarian", mealsPerDay: 3 } },
        // A burn past what six meals of the meal ideas' sizes hold (3,200 kcal).
        { name: "bigteen", answers: { weightGoal: "maintain", age: 17, gender: "male", heightCm: 185, weightKg: 85, dayActivity: "active", trainingDays: 6, sessionMinutes: 90, diet: "vegan", mealsPerDay: 3 } },
        // Gaining, past what eight meals hold (4,100 kcal): the amounts are made bigger.
        { name: "hugeteen", answers: { weightGoal: "gain", targetWeightKg: 130, pace: "steady", age: 17, gender: "male", heightCm: 200, weightKg: 120, dayActivity: "very_active", trainingDays: 7, sessionMinutes: 120, diet: "vegetarian", mealsPerDay: 2 } },
      ];
      const kcals: number[] = [];
      for (const { name, answers } of TEENS) {
        // No route saves an age under 18 since the app became 18+; the rules still hold a row from before.
        const cookies = await makeUser(name, { ...answers, age: 40 });
        await sql`UPDATE user_fitness_profiles SET age = ${answers.age} WHERE user_id = ${await idOf(name)}`;
        const rings = await ringsOf(cookies);
        if (name === "teen") expect(rings?.kcal).toBe(rings?.tdee);
        const kcal = rings?.kcal ?? Infinity;
        kcals.push(kcal);
        const plan = parsed(await make(cookies));
        for (const day of plan.days) {
          expect(day.planned.kcal, `${name} day ${String(day.day)}`).toBeGreaterThanOrEqual(kcal);
          expect(day.off?.kcal).toBe(day.planned.kcal - kcal);
        }
        // Every meal of Monday swapped, one after the other: the day stays at or over.
        let week = plan;
        for (let meal = 0; meal < (plan.days[0]?.meals.length ?? 0); meal++) {
          const res = await swap(cookies, 1, { changeId: randomUUID(), meal });
          if (res.statusCode === 409 && errorOf(res) === "no_other_meal") continue;
          week = parsed(res);
        }
        expect(week.days[0]?.planned.kcal, `${name} after swaps`).toBeGreaterThanOrEqual(kcal);
      }
      const [teenKcal = 0, bigKcal = 0, hugeKcal = 0] = kcals;
      expect(adultRings?.kcal).toBeLessThan(teenKcal);
      expect(bigKcal).toBeGreaterThan(3200);
      expect(hugeKcal).toBeGreaterThan(4100);
    });
  });

  describe("A planned meal logged, as the phone sends it (ROADMAP 34e-ii-a)", () => {
    it("Undo of a swap, the day sent back whole as it stood, puts back the same foods at the same numbers", { timeout: 30_000 }, async () => {
      const cookies = await eater("undo", "non_vegetarian", 4);
      const made = parsed(await make(cookies));
      const before = made.days[0];
      if (before === undefined) throw new Error("no Monday");
      const swapped = parsed(await swap(cookies, 1, { changeId: randomUUID(), meal: 1 }));
      expect(swapped.days[0]?.meals[1]).not.toEqual(before.meals[1]);
      const meals = before.meals.map((m) => ({ mealType: m.mealType, items: m.items.map((i) => ({ canonical: i.canonical, grams: i.gramsPoint })) }));
      const undone = parsed(await putDay(cookies, 1, { changeId: randomUUID(), meals }));
      expect(undone.days[0]).toEqual(before);
    });

    it("a swap or an Undo made from a day another device has since changed is refused, and changes nothing", { timeout: 30_000 }, async () => {
      const cookies = await eater("twophones", "non_vegetarian", 4);
      const made = parsed(await make(cookies));
      const monday = made.days[0];
      if (monday === undefined) throw new Error("no Monday");
      const shown = monday.version;
      // The other phone swaps meal 1.
      const other = parsed(await swap(cookies, 1, { changeId: randomUUID(), meal: 1 }));
      // This phone, still showing the old day, swaps meal 1: refused.
      const stale = await swap(cookies, 1, { changeId: randomUUID(), meal: 1, version: shown });
      expect(stale.statusCode).toBe(409);
      expect(errorOf(stale)).toBe("plan_changed");
      // And Undo of a swap made from the old day: refused, the other phone's change kept.
      const meals = monday.meals.map((m) => ({ mealType: m.mealType, items: m.items.map((i) => ({ canonical: i.canonical, grams: i.gramsPoint })) }));
      const undo = await putDay(cookies, 1, { changeId: randomUUID(), version: shown, meals });
      expect(undo.statusCode).toBe(409);
      expect(errorOf(undo)).toBe("plan_changed");
      expect(await read(cookies)).toEqual(other);
      // From the day as it is now, both go through.
      const now = other.days[0]?.version;
      expect((await swap(cookies, 1, { changeId: randomUUID(), meal: 1, version: now })).statusCode).toBe(200);
    });

    it("every meal of a made week saves at the numbers the plan showed, and sent twice is one meal", { timeout: 60_000 }, async () => {
      const cookies = await eater("logged", "non_vegetarian", 4);
      const plan = parsed(await make(cookies));
      const meals = plan.days.flatMap((d) => d.meals);
      expect(meals.length).toBeGreaterThan(20);
      for (const meal of meals) {
        const body = {
          id: randomUUID(),
          mealName: meal.items.map((i) => i.name).join(" + ").slice(0, 200),
          takenAt: new Date().toISOString(),
          mealType: meal.mealType,
          items: meal.items.map((i) => ({ canonical: i.canonical, grams: i.gramsPoint })),
        };
        const first = await inject({ method: "POST", url: "/v1/nutrition/meals", body, cookies });
        expect(first.statusCode, first.body).toBe(201);
        const saved = (JSON.parse(first.body) as { meal: { id: string; mealType: string; totals: typeof meal.totals } }).meal;
        expect(saved.mealType).toBe(meal.mealType);
        expect(saved.totals).toEqual(meal.totals);
        const again = await inject({ method: "POST", url: "/v1/nutrition/meals", body, cookies });
        expect((JSON.parse(again.body) as { meal: { id: string } }).meal.id).toBe(saved.id);
      }
    });
  });

  describe("THE WORST THING (34e-ii-b): a meal the person built logs at other numbers than the plan shows", () => {
    // Real wording of foods people make at home, with own numbers as people type them: whole, tenths,
    // and protein, carbs and fat that add up to the whole weight.
    const OWN = [
      { name: "Mum's dal", grams: 250, own: { proteinG: 12.3, carbsG: 30.1, fatG: 7.7 } },
      { name: "Protein shake (my recipe)", grams: 330, own: { proteinG: 31, carbsG: 9, fatG: 3 } },
      { name: "Homemade granola", grams: 45, own: { proteinG: 4.5, carbsG: 29.7, fatG: 10.8 } },
      { name: "Ghee", grams: 10, own: { proteinG: 0, carbsG: 0, fatG: 10 } },
      { name: "Pão de queijo da vó", grams: 1.5, own: { proteinG: 0.5, carbsG: 0.5, fatG: 0.5 } },
    ];

    it("a day built from the lists and the person's own foods logs, meal by meal, at the plan's numbers", { timeout: 60_000 }, async () => {
      const cookies = await makeUser("built", null);
      const plan = parsed(await putDay(cookies, 3, {
        changeId: randomUUID(),
        meals: [
          { mealType: "breakfast", items: [OWN[2], { canonical: "banana", grams: 118 }, OWN[4]] },
          { mealType: "lunch", items: [{ canonical: "rice", grams: 180 }, OWN[0], OWN[3]] },
          { mealType: "snack", items: [OWN[1]] },
        ],
      }));
      const meals = plan.days[2]?.meals ?? [];
      expect(meals.map((m) => m.items.map((i) => i.name))).toEqual([
        ["Homemade granola", expect.any(String), "Pão de queijo da vó"],
        [expect.any(String), "Mum's dal", "Ghee"],
        ["Protein shake (my recipe)"],
      ]);
      for (const meal of meals) {
        const body = { id: randomUUID(), mealName: "Planned", takenAt: new Date().toISOString(), mealType: meal.mealType, items: meal.items.map(planItemChoice) };
        const res = await inject({ method: "POST", url: "/v1/nutrition/meals", body, cookies });
        expect(res.statusCode, res.body).toBe(201);
        const saved = (JSON.parse(res.body) as { meal: { totals: typeof meal.totals; items: { canonical: string; kcalPoint: number }[] } }).meal;
        expect(saved.totals).toEqual(meal.totals);
        // The same names, so the phone counts the meal as the plan's meal logged.
        expect(saved.items.map((i) => i.canonical)).toEqual(meal.items.map((i) => i.canonical));
      }
    });

    it("a sweep of 240 own foods as people type them, tenths and whole weights included: each logs at the plan's own numbers", { timeout: 120_000 }, async () => {
      const cookies = await makeUser("ownsweep", null);
      const weights = [1.5, 7, 15, 33, 45, 60, 99, 120, 150.5, 200, 250, 333, 480, 500, 750];
      const foods = Array.from({ length: 240 }, (_, n) => {
        const grams = weights[n % weights.length] ?? 100;
        // Protein, carbs and fat in tenths of a gram, a third of the time adding up to the whole weight.
        const tenths = Math.round(grams * 10);
        const p = (n * 37) % (tenths + 1);
        const c = (n * 53) % (tenths - p + 1);
        const whole = n % 3 === 0 ? tenths - p - c : (n * 11) % (tenths - p - c + 1);
        // The server refuses tenths whose sum comes out a hair over the weight in floating point, as it
        // does for a logged meal: a tenth less there.
        const f = p / 10 + c / 10 + whole / 10 > grams ? whole - 1 : whole;
        return { name: `Food ${String(n)}`, grams, own: { proteinG: p / 10, carbsG: c / 10, fatG: f / 10 } };
      });
      const meals = Array.from({ length: 8 }, (_, m) => ({ mealType: "snack", items: foods.slice(m * 30, m * 30 + 30) }));
      const plan = parsed(await putDay(cookies, 4, { changeId: randomUUID(), meals }));
      const kept = plan.days[3]?.meals ?? [];
      expect(kept.flatMap((m) => m.items).length).toBe(240);
      for (const meal of kept) {
        const choices = meal.items.map(planItemChoice);
        const body = { id: randomUUID(), mealName: "Planned", takenAt: new Date().toISOString(), mealType: meal.mealType, items: choices };
        const res = await inject({ method: "POST", url: "/v1/nutrition/meals", body, cookies });
        expect(res.statusCode, res.body).toBe(201);
        const saved = (JSON.parse(res.body) as { meal: { totals: typeof meal.totals; items: { kcalPoint: number; proteinG: number; carbsG: number; fatG: number }[] } }).meal;
        expect(saved.items.map((i) => [i.kcalPoint, i.proteinG, i.carbsG, i.fatG])).toEqual(meal.items.map((i) => [i.kcalPoint, i.proteinG, i.carbsG, i.fatG]));
        expect(saved.totals).toEqual(meal.totals);
      }
    });

    it("round one H1: a change made from an older copy of the day is refused when only an amount or an own number changed since", { timeout: 30_000 }, async () => {
      const cookies = await makeUser("staleamount", null);
      const first = parsed(await putDay(cookies, 2, {
        changeId: randomUUID(),
        meals: [
          { mealType: "breakfast", items: [{ canonical: "banana", grams: 118 }] },
          { mealType: "lunch", items: [{ canonical: "rice", grams: 180 }, OWN[0]] },
        ],
      }));
      const old = first.days[1]?.version;
      // Phone A: more rice. Phone B, still showing 180 g, changes breakfast: refused, A's rice kept.
      const a = parsed(await putDay(cookies, 2, {
        changeId: randomUUID(), version: old,
        meals: [{ mealType: "breakfast", items: [{ canonical: "banana", grams: 118 }] }, { mealType: "lunch", items: [{ canonical: "rice", grams: 300 }, OWN[0]] }],
      }));
      const b = await putDay(cookies, 2, {
        changeId: randomUUID(), version: old,
        meals: [{ mealType: "breakfast", items: [{ canonical: "banana", grams: 200 }] }, { mealType: "lunch", items: [{ canonical: "rice", grams: 180 }, OWN[0]] }],
      });
      expect(b.statusCode).toBe(409);
      expect(errorOf(b)).toBe("plan_changed");
      expect((await read(cookies)).days[1]).toEqual(a.days[1]);
      // Only the own food's protein changed: the day is another day.
      const fatter = { ...OWN[0], own: { ...OWN[0]?.own, proteinG: 20 } };
      const c = parsed(await putDay(cookies, 2, { changeId: randomUUID(), version: a.days[1]?.version, meals: [{ mealType: "lunch", items: [{ canonical: "rice", grams: 300 }, fatter] }] }));
      expect(c.days[1]?.version).not.toBe(a.days[1]?.version);
      const d = await swap(cookies, 2, { changeId: randomUUID(), meal: 0, version: a.days[1]?.version });
      expect(d.statusCode).toBe(409);
      expect(errorOf(d)).toBe("plan_changed");
      // The version reads the same however often the day is read.
      expect((await read(cookies)).days[1]?.version).toBe(c.days[1]?.version);
    });

    it("round one H3: Undo of a swap away from a meal of the person's own foods puts them back at their numbers", { timeout: 30_000 }, async () => {
      const cookies = await eater("undoown", "non_vegetarian");
      const before = parsed(await putDay(cookies, 1, { changeId: randomUUID(), meals: [{ mealType: "breakfast", items: [OWN[0], OWN[2]] }] })).days[0];
      if (before === undefined) throw new Error("no Monday");
      const swapped = parsed(await swap(cookies, 1, { changeId: randomUUID(), meal: 0, version: before.version }));
      const meals = before.meals.map((m) => ({ mealType: m.mealType, items: m.items.map(planItemChoice) }));
      const undone = parsed(await putDay(cookies, 1, { changeId: randomUUID(), version: swapped.days[0]?.version, meals }));
      expect(undone.days[0]?.meals).toEqual(before.meals);
    });

    it("round one H4: a planned product whose search is forgotten logs from the plan at the plan's numbers; never another person's plan", { timeout: 30_000 }, async () => {
      const cookies = await eater("plannedoff", "non_vegetarian");
      const stranger = await eater("plannedstranger", "non_vegetarian");
      const made = parsed(await make(cookies));
      const userId = await idOf("plannedoff");
      const like = made.days[0]?.meals[0]?.items[0];
      if (like === undefined) throw new Error("no planned food");
      // A product of the search, put in the plan more than a day ago, with a measure: its search is gone.
      const bar = { ...like, name: "Zqxlog bar · Brand", canonical: "off_zqxlog_gone", gramsPoint: 50, gramsRange: [50, 50], nutritionSource: "openfoodfacts", kcalPoint: 200, kcalLow: 200, kcalHigh: 200, measure: { id: "piece", name: "bar", amount: 1 } };
      const stored = made.days.map((d, at) => d.meals.map((m, j) => ({ mealType: m.mealType, items: at === 0 && j === 0 ? [bar, ...m.items.slice(1)] : m.items })));
      await sql`UPDATE diet_plans SET days = ${sql.json(stored)} WHERE user_id = ${userId}`;
      const meal = (await read(cookies)).days[0]?.meals[0];
      if (meal === undefined) throw new Error("no meal");
      const body = (planned: unknown) => ({
        id: randomUUID(), mealName: "Planned", takenAt: new Date().toISOString(), mealType: meal.mealType, items: meal.items.map(planItemChoice),
        ...(planned === undefined ? {} : { planned }),
      });
      // Without saying it is the plan's meal, the product is not found: the hole round one ran.
      const unsaid = await inject({ method: "POST", url: "/v1/nutrition/meals", body: body(undefined), cookies });
      expect(unsaid.statusCode).toBe(400);
      expect(errorOf(unsaid)).toBe("unknown_food");
      // From the plan: saved at the plan's own numbers, the bar still "1 bar" (round one L1).
      const res = await inject({ method: "POST", url: "/v1/nutrition/meals", body: body({ day: 1, meal: 0 }), cookies });
      expect(res.statusCode, res.body).toBe(201);
      const saved = (JSON.parse(res.body) as { meal: { totals: typeof meal.totals; items: { canonical: string; kcalPoint: number; measure?: unknown }[] } }).meal;
      expect(saved.totals).toEqual(meal.totals);
      expect(saved.items[0]).toMatchObject({ canonical: "off_zqxlog_gone", kcalPoint: 200, measure: { id: "piece", name: "bar", amount: 1 } });
      // Another meal of the plan, or other amounts: priced from the lists, never at the plan's numbers.
      const elsewhere = await inject({ method: "POST", url: "/v1/nutrition/meals", body: body({ day: 1, meal: 1 }), cookies });
      expect(elsewhere.statusCode).toBe(400);
      // A stranger naming the same day and meal reaches only their own plan.
      const theirs = await inject({ method: "POST", url: "/v1/nutrition/meals", body: body({ day: 1, meal: 0 }), cookies: stranger });
      expect(theirs.statusCode).toBe(400);
      expect(errorOf(theirs)).toBe("unknown_food");
    });

    it("re-check Low: a meal kept on the phone from before its own food's numbers changed is saved as it was sent, not at the plan's new numbers", { timeout: 30_000 }, async () => {
      const cookies = await makeUser("plannedownold", null);
      parsed(await putDay(cookies, 3, { changeId: randomUUID(), meals: [{ mealType: "snack", items: [OWN[3]] }] }));
      // The phone kept the meal when Ghee was 5 g protein and 5 g fat; the plan now holds 10 g fat.
      const old = { name: "Ghee", grams: 10, own: { proteinG: 5, carbsG: 0, fatG: 5 } };
      const body = { id: randomUUID(), mealName: "Planned", takenAt: new Date().toISOString(), mealType: "snack", items: [old], planned: { day: 3, meal: 0 } };
      const res = await inject({ method: "POST", url: "/v1/nutrition/meals", body, cookies });
      expect(res.statusCode, res.body).toBe(201);
      const saved = (JSON.parse(res.body) as { meal: { items: { proteinG: number; fatG: number }[] } }).meal;
      expect(saved.items[0]).toMatchObject({ proteinG: 5, fatG: 5 });
    });

    it("an own food sent back as the phone sends it is kept at the same numbers when another meal of the day changes", { timeout: 30_000 }, async () => {
      const cookies = await makeUser("keepown", null);
      const first = parsed(await putDay(cookies, 1, { changeId: randomUUID(), meals: [{ mealType: "dinner", items: [OWN[0], OWN[1]] }] }));
      const dinner = first.days[0]?.meals[0];
      if (dinner === undefined) throw new Error("no dinner");
      const again = parsed(await putDay(cookies, 1, {
        changeId: randomUUID(),
        meals: [{ mealType: "breakfast", items: [{ canonical: "banana", grams: 100 }] }, { mealType: "dinner", items: dinner.items.map(planItemChoice) }],
      }));
      expect(again.days[0]?.meals[1]?.totals).toEqual(dinner.totals);
      expect(again.days[0]?.meals[1]?.items.map((i) => i.canonical)).toEqual(dinner.items.map((i) => i.canonical));
    });

    it("own numbers heavier than the food are refused, and the day is left as it was", { timeout: 30_000 }, async () => {
      const cookies = await makeUser("heavyown", null);
      const res = await putDay(cookies, 1, { changeId: randomUUID(), meals: [{ mealType: "lunch", items: [{ name: "Salad", grams: 50, own: { proteinG: 40, carbsG: 20, fatG: 0 } }] }] });
      expect(res.statusCode).toBe(400);
      expect(errorOf(res)).toBe("own_numbers_too_heavy");
      expect((await read(cookies)).days[0]?.meals).toEqual([]);
    });
  });

  describe("GET /v1/nutrition/diet-plan/days/:day/meals/:meal/measures", () => {
    const measures = (cookies: Cookies, day: number | string, meal: number | string) =>
      inject({ method: "GET", url: `/v1/nutrition/diet-plan/days/${String(day)}/meals/${String(meal)}/measures`, cookies });

    it("gives each food of the meal its own measures, in the meal's order, an own food its weight only", { timeout: 30_000 }, async () => {
      const cookies = await makeUser("measures", null);
      parsed(await putDay(cookies, 5, {
        changeId: randomUUID(),
        meals: [{ mealType: "breakfast", items: [{ canonical: "banana", grams: 118 }, { name: "Homemade granola", grams: 45, own: { proteinG: 4.5, carbsG: 29.7, fatG: 10.8 } }] }],
      }));
      const res = await measures(cookies, 5, 0);
      expect(res.statusCode, res.body).toBe(200);
      const body = mealMeasuresResponseSchema.parse(JSON.parse(res.body));
      expect(body.measures.length).toBe(2);
      expect(body.measures[0]?.some((m) => m.id !== "g")).toBe(true);
      expect(body.measures[1]?.map((m) => m.id)).toEqual(["g", "oz"]);
    });

    it("refuses a meal past the day's last, a day out of the week, and a stranger", { timeout: 30_000 }, async () => {
      const owner = await makeUser("measowner", null);
      const stranger = await makeUser("measstranger", null);
      parsed(await putDay(owner, 2, { changeId: randomUUID(), meals: [{ mealType: "lunch", items: [{ canonical: "rice", grams: 180 }] }] }));
      expect((await measures(owner, 2, 1)).statusCode).toBe(404);
      expect((await measures(owner, 8, 0)).statusCode).toBe(400);
      expect((await measures(owner, 2, 8)).statusCode).toBe(400);
      expect((await measures(owner, 2, "x")).statusCode).toBe(400);
      // The stranger has no plan of their own: the owner's meal is not reached.
      expect((await measures(stranger, 2, 0)).statusCode).toBe(404);
      expect((await measures({}, 2, 0)).statusCode).toBe(401);
    });
  });

  describe("GET /v1/nutrition/diet-plan", () => {
    it("a person with no plan reads seven empty days, the day's targets and whether the app can make one", { timeout: 30_000 }, async () => {
      const plan = await read(await eater("empty", "non_vegetarian"));
      expect(plan.days.map((d) => d.day)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(plan.days.every((d) => d.meals.length === 0 && d.planned.kcal === 0)).toBe(true);
      expect(plan.days[0]?.target?.kcal).toBe(1817);
      expect(plan.days[0]?.off?.kcal).toBe(-1817);
      expect(plan.make).toEqual({ status: "ok" });
      expect(plan.labelCaution).toBeNull();
    });

    it("says which answers are missing, or that setup is not finished, and makes nothing", { timeout: 30_000 }, async () => {
      const none = await makeUser("none", PLAN_ANSWERS);
      expect((await read(none)).make).toEqual({ status: "needs_answers", missing: ["diet", "mealsPerDay"] });
      const refused = await make(none);
      expect(refused.statusCode).toBe(409);
      expect(errorOf(refused)).toBe("needs_answers");

      const noPlan = await makeUser("noplan", { diet: "vegan", mealsPerDay: 3 });
      const plan = await read(noPlan);
      expect(plan.make).toEqual({ status: "needs_plan", reason: "setup" });
      expect(plan.days[0]?.target).toBeNull();
      const unfinished = await make(noPlan);
      expect(errorOf(unfinished)).toBe("needs_plan");
      expect(messageOf(unfinished)).toBe("Finish setup to get a meal plan.");

      // Setup is finished, but the target weight is behind them: they are asked for a new goal.
      const passed = await makeUser("passed", { ...PLAN_ANSWERS, weightGoal: "lose", targetWeightKg: 75, pace: "steady", diet: "vegan", mealsPerDay: 3 });
      expect((await read(passed)).make).toEqual({ status: "needs_plan", reason: "new_goal" });
      const refusedPassed = await make(passed);
      expect(errorOf(refusedPassed)).toBe("needs_plan");
      expect(messageOf(refusedPassed)).toBe("Set a new goal to get a meal plan.");
    });

    it("needs a signed-in person", async () => {
      expect((await inject({ method: "GET", url: "/v1/nutrition/diet-plan" })).statusCode).toBe(401);
      expect((await make({})).statusCode).toBe(401);
      expect((await putDay({}, 1, { changeId: randomUUID(), meals: [] })).statusCode).toBe(401);
      expect((await swap({}, 1, { changeId: randomUUID(), meal: 0 })).statusCode).toBe(401);
    });
  });

  describe("POST /v1/nutrition/diet-plan/make", () => {
    it("makes the week to the person's meals a day, sized to their calories", { timeout: 30_000 }, async () => {
      const cookies = await eater("make", "non_vegetarian", 4);
      const plan = parsed(await make(cookies));
      for (const day of plan.days) {
        expect(day.meals.map((m) => m.mealType)).toEqual(["breakfast", "lunch", "snack", "dinner"]);
        expect(day.planned.kcal).toBeGreaterThanOrEqual(1817);
        expect(day.planned.kcal).toBeLessThanOrEqual(1817 + 182);
        // Each meal is priced as a logged meal is: its totals are its foods'.
        for (const meal of day.meals) expect(meal.totals.kcalPoint).toBe(meal.items.reduce((n, i) => n + i.kcalPoint, 0));
      }
      expect(await read(cookies)).toEqual(plan);
    });

    it("sent twice, it is made once; made again with a new id, the week is another", { timeout: 30_000 }, async () => {
      const cookies = await eater("twice", "vegetarian");
      const changeId = randomUUID();
      const first = parsed(await make(cookies, { changeId }));
      // The person changes Monday, then the first make arrives again (its reply was lost).
      parsed(await putDay(cookies, 1, { changeId: randomUUID(), meals: [] }));
      const again = parsed(await make(cookies, { changeId: changeId.toUpperCase() }));
      expect(again.days[0]?.meals).toEqual([]);
      expect(again.days.slice(1)).toEqual(first.days.slice(1));
      const fresh = parsed(await make(cookies));
      expect(fresh.days).not.toEqual(first.days);
    });

    it("sent again after the person cleared an answer, it returns the plan the first send made", { timeout: 30_000 }, async () => {
      const cookies = await eater("retry", "vegan");
      const changeId = randomUUID();
      const first = parsed(await make(cookies, { changeId }));
      expect((await inject({ method: "PATCH", url: "/v1/users/me/onboarding", body: { diet: null }, cookies })).statusCode).toBe(200);
      expect(errorOf(await make(cookies))).toBe("needs_answers");
      expect(parsed(await make(cookies, { changeId })).days).toEqual(first.days);
    });

    it("makes only the days named, and leaves the others as they are", { timeout: 30_000 }, async () => {
      const cookies = await eater("days", "vegan");
      const before = parsed(await make(cookies));
      const after = parsed(await make(cookies, { changeId: randomUUID(), days: [3] }));
      expect(after.days[2]).not.toEqual(before.days[2]);
      expect([...after.days.slice(0, 2), ...after.days.slice(3)]).toEqual([...before.days.slice(0, 2), ...before.days.slice(3)]);
    });

    it("refuses a body it cannot read", { timeout: 30_000 }, async () => {
      const cookies = await eater("makebad", "vegan");
      for (const body of [{}, { changeId: "not-an-id" }, { changeId: randomUUID(), days: [8] }, { changeId: randomUUID(), days: [1, 1] }, { changeId: randomUUID(), extra: 1 }]) {
        const res = await make(cookies, body);
        expect(res.statusCode, JSON.stringify(body)).toBe(400);
        expect(errorOf(res)).toBe("validation_error");
      }
    });
  });

  describe("PUT /v1/nutrition/diet-plan/days/:day", () => {
    it("keeps the day as the person sends it, priced by the server, with no setup answers needed", { timeout: 30_000 }, async () => {
      const cookies = await makeUser("own", null);
      const plan = parsed(await putDay(cookies, 2, {
        changeId: randomUUID(),
        meals: [
          { mealType: "breakfast", items: [{ canonical: "banana", grams: 120 }, { canonical: "oatmeal", grams: 240 }] },
          { mealType: "dinner", items: [{ canonical: "rice", grams: 200 }] },
        ],
      }));
      const tuesday = plan.days[1];
      expect(tuesday?.meals.map((m) => m.mealType)).toEqual(["breakfast", "dinner"]);
      expect(tuesday?.meals[0]?.items.map((i) => i.gramsPoint)).toEqual([120, 240]);
      expect(tuesday?.planned.kcal).toBe(tuesday?.meals.reduce((n, m) => n + m.totals.kcalPoint, 0));
      expect(tuesday?.planned.kcal).toBeGreaterThan(0);
      expect(tuesday?.target).toBeNull();
      expect(plan.days.filter((d) => d.meals.length > 0).map((d) => d.day)).toEqual([2]);
    });

    it("changes an amount, removes a meal, and clears the day", { timeout: 30_000 }, async () => {
      const cookies = await eater("edit", "non_vegetarian");
      const made = parsed(await make(cookies));
      const monday = made.days[0];
      const [first, ...rest] = monday?.meals ?? [];
      if (first === undefined) throw new Error("Monday has no meal");
      const bigger = first.items.map((i) => ({ canonical: i.canonical, grams: i.gramsPoint * 2 }));
      const edited = parsed(await putDay(cookies, 1, {
        changeId: randomUUID(),
        meals: [{ mealType: first.mealType, items: bigger }, ...rest.slice(1).map((m) => ({ mealType: m.mealType, items: m.items.map((i) => ({ canonical: i.canonical, grams: i.gramsPoint })) }))],
      }));
      expect(edited.days[0]?.meals.length).toBe((monday?.meals.length ?? 0) - 1);
      expect(edited.days[0]?.meals[0]?.totals.kcalPoint).toBeGreaterThan(first.totals.kcalPoint);
      expect(edited.days.slice(1)).toEqual(made.days.slice(1));

      const cleared = parsed(await putDay(cookies, 1, { changeId: randomUUID(), meals: [] }));
      expect(cleared.days[0]?.meals).toEqual([]);
    });

    it("a packaged product no longer remembered stays in the day while another meal changes; a new amount of it is refused, as for a logged meal", { timeout: 30_000 }, async () => {
      const cookies = await eater("packaged", "non_vegetarian");
      const made = parsed(await make(cookies));
      const userId = await idOf("packaged");
      const like = made.days[0]?.meals[0]?.items[0];
      if (like === undefined) throw new Error("no planned food");
      // An Open Food Facts product put in the day more than a day ago: its search is forgotten.
      const bar = { ...like, name: "Zqxplan bar · Brand", canonical: "off_zqxplan_gone", gramsPoint: 50, gramsRange: [50, 50], nutritionSource: "openfoodfacts", kcalPoint: 200, kcalLow: 200, kcalHigh: 200 };
      const stored = made.days.map((d, at) => d.meals.map((m, j) => ({ mealType: m.mealType, items: at === 0 && j === 0 ? [bar] : m.items })));
      await sql`UPDATE diet_plans SET days = ${sql.json(stored)} WHERE user_id = ${userId}`;
      const chosen = (meals: readonly { mealType: string; items: readonly { canonical: string; gramsPoint: number }[] }[]) =>
        meals.map((m) => ({ mealType: m.mealType, items: m.items.map((i) => ({ canonical: i.canonical, grams: i.gramsPoint })) }));
      const day = stored[0] ?? [];

      // Another meal removed: the bar is kept at its saved price.
      const after = parsed(await putDay(cookies, 1, { changeId: randomUUID(), meals: chosen(day.slice(0, -1)) }));
      expect(after.days[0]?.meals[0]?.items).toEqual([bar]);
      expect(after.days[0]?.meals.length).toBe(day.length - 1);

      // A new amount of it would have to be priced again on a later day: not put in a plan (re-check, H3b).
      const twoBars = await putDay(cookies, 1, { changeId: randomUUID(), meals: [{ mealType: day[0]?.mealType, items: [{ canonical: "off_zqxplan_gone", grams: 100 }] }] });
      expect(twoBars.statusCode).toBe(400);
      expect(errorOf(twoBars)).toBe("not_for_plan");
      expect(messageOf(twoBars)).toBe("This food can’t go in a meal plan. Take it off, then save. You can still log it to a meal.");
    });

    it("sent twice, the second does not undo what came between", { timeout: 30_000 }, async () => {
      const cookies = await eater("puttwice", "non_vegetarian");
      const changeId = randomUUID();
      const body = { changeId, meals: [{ mealType: "lunch", items: [{ canonical: "apple", grams: 150 }] }] };
      parsed(await putDay(cookies, 5, body));
      parsed(await putDay(cookies, 5, { changeId: randomUUID(), meals: [] }));
      const again = parsed(await putDay(cookies, 5, body));
      expect(again.days[4]?.meals).toEqual([]);
    });

    it("refuses a day that is not one, a body it cannot read, and a food that is not on the list", { timeout: 30_000 }, async () => {
      const cookies = await eater("putbad", "vegan");
      const meals = [{ mealType: "lunch", items: [{ canonical: "apple", grams: 150 }] }];
      for (const day of ["0", "8", "monday", "1.5"]) {
        expect((await putDay(cookies, day, { changeId: randomUUID(), meals })).statusCode, day).toBe(400);
      }
      for (const body of [
        { meals },
        { changeId: randomUUID(), meals: [{ mealType: "brunch", items: meals[0]?.items }] },
        { changeId: randomUUID(), meals: [{ mealType: "lunch", items: [] }] },
        { changeId: randomUUID(), meals: [{ mealType: "lunch", items: [{ canonical: "apple", grams: -1 }] }] },
        { changeId: randomUUID(), meals: Array.from({ length: 9 }, () => meals[0]) },
        { changeId: randomUUID(), meals: [{ mealType: "lunch", items: [{ canonical: "apple", grams: 150, kcalPoint: 1 }] }] },
      ]) {
        const res = await putDay(cookies, 1, body);
        expect(res.statusCode, JSON.stringify(body)).toBe(400);
        expect(errorOf(res)).toBe("validation_error");
      }
      // A food no search returned is not searched for: a day of 240 such foods must not send 240 searches out.
      const before = searches;
      const unknown = await putDay(cookies, 1, { changeId: randomUUID(), meals: [{ mealType: "lunch", items: [{ canonical: "zz-no-such-food-anywhere", grams: 100 }] }] });
      expect(unknown.statusCode).toBe(400);
      expect(errorOf(unknown)).toBe("unknown_food");
      expect(searches).toBe(before);
      expect((await read(cookies)).days[0]?.meals).toEqual([]);
    });
  });

  describe("POST /v1/nutrition/diet-plan/days/:day/swap", () => {
    it("swaps one meal for other foods of the same kind, near its calories, and leaves the rest", { timeout: 30_000 }, async () => {
      const cookies = await eater("swap", "vegetarian_eggs");
      const made = parsed(await make(cookies));
      const changeId = randomUUID();
      const swapped = parsed(await swap(cookies, 4, { changeId, meal: 1 }));
      const before = made.days[3]?.meals[1];
      const after = swapped.days[3]?.meals[1];
      expect(after?.mealType).toBe(before?.mealType);
      expect(after?.items.map((i) => i.canonical).sort()).not.toEqual(before?.items.map((i) => i.canonical).sort());
      expect(Math.abs((after?.totals.kcalPoint ?? 0) - (before?.totals.kcalPoint ?? 0))).toBeLessThanOrEqual((before?.totals.kcalPoint ?? 0) * 0.25);
      expect(swapped.days[3]?.meals.filter((_, i) => i !== 1)).toEqual(made.days[3]?.meals.filter((_, i) => i !== 1));
      expect(swapped.days.filter((_, i) => i !== 3)).toEqual(made.days.filter((_, i) => i !== 3));

      // Sent again (its reply was lost): the meal is not swapped a second time.
      expect(parsed(await swap(cookies, 4, { changeId, meal: 1 }))).toEqual(swapped);
    });

    it("a meal that is not there is not found; a person with no diet answer is told to give it", { timeout: 30_000 }, async () => {
      const cookies = await eater("swapnone", "vegan");
      const res = await swap(cookies, 1, { changeId: randomUUID(), meal: 0 });
      expect(res.statusCode).toBe(404);
      parsed(await make(cookies));
      expect((await swap(cookies, 1, { changeId: randomUUID(), meal: 7 })).statusCode).toBe(404);

      const own = await makeUser("swapown", null);
      parsed(await putDay(own, 1, { changeId: randomUUID(), meals: [{ mealType: "lunch", items: [{ canonical: "rice", grams: 200 }] }] }));
      const refused = await swap(own, 1, { changeId: randomUUID(), meal: 0 });
      expect(refused.statusCode).toBe(409);
      expect(errorOf(refused)).toBe("needs_answers");
    });

    it("refuses a body it cannot read", { timeout: 30_000 }, async () => {
      const cookies = await eater("swapbad", "vegan");
      for (const body of [{ meal: 0 }, { changeId: randomUUID() }, { changeId: randomUUID(), meal: -1 }, { changeId: randomUUID(), meal: 8 }, { changeId: randomUUID(), meal: 0.5 }]) {
        expect((await swap(cookies, 1, body)).statusCode, JSON.stringify(body)).toBe(400);
      }
      expect((await swap(cookies, 9, { changeId: randomUUID(), meal: 0 })).statusCode).toBe(400);
    });
  });

  describe("a stranger", () => {
    it("never reads, changes or swaps another person's plan: each route reaches only the signed-in person's own", { timeout: 60_000 }, async () => {
      const owner = await eater("owner", "vegan");
      const stranger = await eater("stranger", "non_vegetarian");
      const plan = parsed(await make(owner));
      const changeId = randomUUID();

      expect((await read(stranger)).days.every((d) => d.meals.length === 0)).toBe(true);
      // The stranger sends the owner's own change id: it is a change of the stranger's plan only.
      parsed(await putDay(stranger, 1, { changeId, meals: [] }));
      expect((await swap(stranger, 1, { changeId: randomUUID(), meal: 0 })).statusCode).toBe(404);
      parsed(await make(stranger, { changeId: randomUUID(), days: [2] }));

      expect(await read(owner)).toEqual(plan);
      // The owner's change of the same id is still the owner's to make.
      expect(parsed(await putDay(owner, 1, { changeId, meals: [] })).days[0]?.meals).toEqual([]);
    });
  });

  describe("two changes at the same instant", () => {
    it("the same change sent twice at once is made once; two different ones are both made, one after the other", { timeout: 60_000 }, async () => {
      const cookies = await eater("race", "non_vegetarian");
      const changeId = randomUUID();
      const body = { changeId, meals: [{ mealType: "lunch", items: [{ canonical: "apple", grams: 150 }] }] };
      const [a, b] = await Promise.all([putDay(cookies, 6, body), putDay(cookies, 6, body)]);
      expect(parsed(a).days[5]).toEqual(parsed(b).days[5]);
      const rows = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM diet_plans p, unnest(p.recent_changes) AS c
        WHERE p.user_id = (SELECT id FROM users WHERE email = 'dietplan-race@example.com') AND c = ${changeId}::uuid`;
      expect(rows[0]?.n).toBe(1);

      const [mon, tue] = await Promise.all([
        putDay(cookies, 1, { changeId: randomUUID(), meals: [{ mealType: "dinner", items: [{ canonical: "rice", grams: 200 }] }] }),
        putDay(cookies, 2, { changeId: randomUUID(), meals: [{ mealType: "dinner", items: [{ canonical: "banana", grams: 120 }] }] }),
      ]);
      expect(mon.statusCode).toBe(200);
      expect(tue.statusCode).toBe(200);
      const both = await read(cookies);
      expect(both.days[0]?.meals.length).toBe(1);
      expect(both.days[1]?.meals.length).toBe(1);
      expect(both.days[5]?.meals.length).toBe(1);
    });

    it("two swaps of one meal at once: the first is made, the second is told the plan has changed", { timeout: 60_000 }, async () => {
      const cookies = await eater("swaprace", "vegetarian");
      const made = parsed(await make(cookies));
      const userId = await idOf("swaprace");
      let both: Promise<Res[]> = Promise.resolve([]);
      // The test holds the person's row, so both swaps have read the meal before either is made.
      await sql.begin(async (tx) => {
        await tx`SELECT 1 FROM diet_plans WHERE user_id = ${userId} FOR UPDATE`;
        both = Promise.all([swap(cookies, 2, { changeId: randomUUID(), meal: 0 }), swap(cookies, 2, { changeId: randomUUID(), meal: 0 })]);
        await waiting(2);
      });
      const results = await both;
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      expect(results.filter((r) => r.statusCode === 409).map(errorOf)).toEqual(["plan_changed"]);
      const after = await read(cookies);
      expect(after.days[1]?.meals[0]).not.toEqual(made.days[1]?.meals[0]);
      expect(after.days[1]?.meals.slice(1)).toEqual(made.days[1]?.meals.slice(1));
    });

    it("a swap of a meal the day lost since it was read is refused, and the day is left as the other change made it", { timeout: 60_000 }, async () => {
      const cookies = await eater("swapgone", "vegan");
      const made = parsed(await make(cookies));
      const userId = await idOf("swapgone");
      const changed = made.days.map((day, at) => day.meals.slice(at === 2 ? 1 : 0).map((m) => ({ mealType: m.mealType, items: m.items })));
      let one: Promise<Res> = Promise.resolve({ statusCode: 0, body: "" });
      await sql.begin(async (tx) => {
        await tx`SELECT 1 FROM diet_plans WHERE user_id = ${userId} FOR UPDATE`;
        one = swap(cookies, 3, { changeId: randomUUID(), meal: 0 });
        await waiting(1);
        // Another change of the day comes first: its first meal is removed.
        await tx`UPDATE diet_plans SET days = ${tx.json(changed)} WHERE user_id = ${userId}`;
      });
      const res = await one;
      expect(res.statusCode).toBe(409);
      expect(errorOf(res)).toBe("plan_changed");
      expect((await read(cookies)).days[2]?.meals).toEqual(made.days[2]?.meals.slice(1));
    });
  });
});
