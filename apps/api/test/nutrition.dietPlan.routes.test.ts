// A person's own diet plan (ROADMAP 34e-i) against REAL Postgres. DATABASE_URL-gated;
// needs migration 0106. The first block is the job's worst thing through the routes:
// a vegan's or vegetarian's plan holding meat, fish, egg or milk, made or swapped, and
// a plan below the calories of somebody the app may not cut. Then each route: the
// happy path, a validation failure, the stranger, and a change sent twice.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  DIET_LABEL_CAUTION, FOOD_ALLERGY_CAUTION, dietAllows, dietPlanResponseSchema, nutritionTargetsResponseSchema,
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
const noExternal: FoodSearchProvider = { search: () => Promise.resolve([]) };

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
  const foodsOf = (plan: DietPlanResponse): string[] => plan.days.flatMap((day) => day.meals.flatMap((m) => m.items.map((i) => i.canonical)));
  const wrongFor = (diet: Diet, canonicals: readonly string[]): string[] =>
    [...new Set(canonicals)].map(foodOf)
      .filter((f) => !dietAllows(diet, f.diet) || !dietAllows(diet, tableLowest(f)))
      .map((f) => f.name);

  const mine = sql`SELECT id FROM users WHERE email LIKE 'dietplan-%@example.com'`;
  const clear = async () => {
    await sql`DELETE FROM diet_plans WHERE user_id IN (${mine})`;
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

    it("under 18, losing weight: every day is made to the whole daily burn the rings show, never a cut", { timeout: 60_000 }, async () => {
      const teen = await makeUser("teen", { ...LOSING, age: 16, diet: "non_vegetarian", mealsPerDay: 3 });
      const adult = await makeUser("adult", { ...LOSING, diet: "non_vegetarian", mealsPerDay: 3 });
      const ringsOf = async (cookies: Cookies) => {
        const res = await inject({ method: "GET", url: "/v1/nutrition/targets", cookies });
        return nutritionTargetsResponseSchema.parse(JSON.parse(res.body)).targets;
      };
      const teenRings = await ringsOf(teen);
      const adultRings = await ringsOf(adult);
      expect(teenRings?.noCalorieCut).toBe(true);
      expect(teenRings?.kcal).toBe(teenRings?.tdee);
      expect(adultRings?.kcal).toBeLessThan(teenRings?.kcal ?? 0);

      const plan = parsed(await make(teen));
      for (const day of plan.days) {
        expect(day.target?.kcal).toBe(teenRings?.kcal);
        expect(day.planned.kcal).toBeGreaterThanOrEqual(Math.round((teenRings?.kcal ?? 0) * 0.9));
        expect(day.off?.kcal).toBe(day.planned.kcal - (teenRings?.kcal ?? 0));
      }
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
      expect(plan.make).toEqual({ status: "needs_plan" });
      expect(plan.days[0]?.target).toBeNull();
      expect(errorOf(await make(noPlan))).toBe("needs_plan");
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
        expect(Math.abs(day.planned.kcal - 1817)).toBeLessThanOrEqual(182);
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
      const unknown = await putDay(cookies, 1, { changeId: randomUUID(), meals: [{ mealType: "lunch", items: [{ canonical: "zz-no-such-food-anywhere", grams: 100 }] }] });
      expect(unknown.statusCode).toBe(400);
      expect(errorOf(unknown)).toBe("unknown_food");
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
  });
});
