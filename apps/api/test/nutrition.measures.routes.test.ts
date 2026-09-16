// ROADMAP 7a-iv-a — adding a food by measure, through the routes a person uses
// (RULINGS 2026-09-16, the portion redesign): the search gives every food its
// measures, a meal is saved by one of them with its grams worked out by the
// server, a saved dish is weighed by the food's own cup, an edit keeps the measure
// an item was logged by, and nobody can use another person's dish or meal.
//
// The USDA fixtures are keyed above 90,000,000 and carry the nonsense word
// "zqxmeasure". Our list's Apple cites USDA's SR Legacy 171688: its rows below are
// the real ones, copied from the loaded table on 2026-09-16, and are written only
// where the table does not already hold them — so a machine with the whole table
// and one without answer alike, and a loaded table is never touched.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { z } from "zod";
import { foodSearchResponseSchema, mealPreviewSchema, mealSchema, type FoodSearchItem, type Meal } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import { findCurated } from "../src/modules/nutrition/foods.js";
import type { FoodReference, FoodSearchProvider } from "../src/modules/nutrition/openfoodfacts.adapter.js";
import { importUsda } from "../tools/usda-table.js";
import { USDA_NUTRIENTS, type UsdaEntry, type UsdaNutrient, type UsdaPortion } from "../tools/usda-files.js";

const sentry = vi.hoisted(() => ({ init: vi.fn(), captureException: vi.fn(), httpIntegration: vi.fn() }));
vi.mock("@sentry/node", () => sentry);

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");
const PASSWORD = "measure7a-safe-test-password-1"; // gitleaks:allow
const env = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "measure7a-test-secret-0123456789abcdef-32", // gitleaks:allow
  LOG_LEVEL: "error",
  GROQ_API_KEY: "measure7a-fake-provider-key", // gitleaks:allow
};

const FIRST_ID = 90_000_401;
const LAST_ID = 90_000_499;
/** Survey-release porridge: 71 kcal per 100 g, by the cup (234 g) or the tablespoon (15 g). */
const PORRIDGE_ID = 90_000_401;
const PORRIDGE = `usda_fndds_${String(PORRIDGE_ID)}`;
/** SR Legacy nuts, whose half cup weighs 70 g: a millilitre of them is 70 / 120 g. */
const NUTS_ID = 90_000_402;
const NUTS = `usda_sr_${String(NUTS_ID)}`;
/** Frozen greens as SR Legacy writes frozen kale (169239): a first row of amount 0,
 *  94 g for a 10 oz package, beside the package's real 284 g. */
const GREENS_ID = 90_000_403;
const GREENS = `usda_sr_${String(GREENS_ID)}`;
const APPLE_ID = 171_688;

const entry = (fdcId: number, description: string, kcal: number, portions: UsdaPortion[]): UsdaEntry => {
  const figures = new Map<UsdaNutrient, number | null>(USDA_NUTRIENTS.map((n) => [n.key, null]));
  for (const [key, value] of [["kcal", kcal], ["proteinG", 2.5], ["carbsG", 12], ["fatG", 1.5], ["fiberG", 1.7]] as const) figures.set(key, value);
  return { fdcId, description, figures, portions };
};
const at = (seqNum: number, unit: string, gramWeight: number, amount: number | null = 1): UsdaPortion => ({ seqNum, amount, unit, gramWeight });

/** One packaged product, served by its label's pot. */
const packaged: FoodSearchProvider = {
  search: (query) => Promise.resolve(query.includes("zqxmeasure")
    ? [{ canonical: "off_zqxmeasure_pot", name: "Zqxmeasure yogurt · Brand", kcal: 96, proteinG: 4, carbsG: 12, fatG: 3.4, fiberG: null, serving: 125, unit: "pot", source: "openfoodfacts" } satisfies FoodReference]
    : []),
};

d("adding a food by measure (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 4 });
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let alice = "";
  let bob = "";
  let wroteApple = false;

  const api = () => { if (app === undefined) throw new Error("beforeAll did not run"); return app; };
  const inject = (method: "GET" | "POST" | "PATCH", path: string, access: string, body?: unknown) =>
    api().inject({
      method, url: path,
      cookies: access === "" ? {} : { accessToken: access },
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(body) }),
    });
  const session = async (email: string): Promise<string> => {
    await inject("POST", "/v1/auth/register", "", { email, password: PASSWORD, displayName: "Measure fixture" });
    const login = await inject("POST", "/v1/auth/login", "", { email, password: PASSWORD });
    return login.cookies.find((c) => c.name === "accessToken")?.value ?? "";
  };
  const search = async (q: string): Promise<FoodSearchItem[]> => {
    const res = await inject("GET", `/v1/nutrition/foods?q=${encodeURIComponent(q)}&limit=15`, alice);
    expect(res.statusCode, res.body).toBe(200);
    return foodSearchResponseSchema.parse(res.json()).items;
  };
  const mealOf = (body: string): Meal => mealSchema.parse(z.object({ meal: z.unknown() }).parse(JSON.parse(body)).meal);
  const manual = (access: string, items: unknown[]) =>
    inject("POST", "/v1/nutrition/meals", access, { mealName: "Zqxmeasure meal", takenAt: new Date().toISOString(), items });
  const errorOf = (res: { statusCode: number; json: () => unknown }): [number, string] =>
    [res.statusCode, z.object({ error: z.string() }).parse(res.json()).error];
  const clean = async (): Promise<void> => {
    await sql`DELETE FROM meal_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'measure7a-%@example.com')`;
    await sql`DELETE FROM user_dishware WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'measure7a-%@example.com')`;
    await sql`DELETE FROM users WHERE email LIKE 'measure7a-%@example.com'`;
    await sql`DELETE FROM usda_food_portions WHERE fdc_id BETWEEN ${FIRST_ID} AND ${LAST_ID}`;
    await sql`DELETE FROM usda_foods WHERE fdc_id BETWEEN ${FIRST_ID} AND ${LAST_ID}`;
  };

  beforeAll(async () => {
    await clean();
    wroteApple = (await sql`SELECT 1 FROM usda_foods WHERE fdc_id = ${APPLE_ID}`).length === 0;
    await importUsda(sql, [
      ["fndds", [entry(PORRIDGE_ID, "Zqxmeasure porridge, cooked", 71, [at(1, "1 cup", 234, null), at(2, "1 tablespoon", 15, null)])]],
      ["sr_legacy", [
        entry(NUTS_ID, "Zqxmeasure nuts, raw", 607, [at(1, "cup", 70, 0.5), at(2, "nut", 1.2), at(3, "oz", 28.35)]),
        entry(GREENS_ID, "Zqxmeasure greens, frozen", 29, [at(0, "package (10 oz)", 94, 0), at(1, "cup", 67, 0.33), at(2, "package (10 oz)", 284), at(3, "Guideline amount per cup of vegetable", 30, null)]),
        ...(wroteApple
          ? [entry(APPLE_ID, "Apples, raw, with skin (Includes foods for USDA's Food Distribution Program)", 52, [
              at(1, "cup, quartered or chopped", 125), at(2, "cup slices", 109), at(3, "large (3-1/4\" dia)", 223),
              at(4, "medium (3\" dia)", 182), at(5, "small (2-3/4\" dia)", 149), at(6, "extra small (2-1/2\" dia)", 101),
              at(7, "NLEA serving", 242),
            ])]
          : []),
      ]],
    ]);
    app = await buildApp(loadConfig(env), { redis: createMemoryRedis(), nutrition: { foodSearchProvider: packaged } });
    alice = await session("measure7a-alice@example.com");
    bob = await session("measure7a-bob@example.com");
  }, 60_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    await clean();
    if (wroteApple) {
      await sql`DELETE FROM usda_food_portions WHERE fdc_id = ${APPLE_ID}`;
      await sql`DELETE FROM usda_foods WHERE fdc_id = ${APPLE_ID}`;
    }
    await sql.end({ timeout: 5 });
  });

  it("gives every food the search returns its measures and the one it starts at", async () => {
    const brief = (food: FoodSearchItem | undefined) => [food?.measures.map((m) => `${m.id} ${m.name} ${String(m.grams)}`), food?.startsAt];
    const ounce = "oz oz 28.349523125";

    const porridge = (await search("zqxmeasure porridge")).find((f) => f.canonical === PORRIDGE);
    expect(brief(porridge)).toEqual([["usda-1 cup 234", "usda-2 tablespoon 15", "g g 1", ounce], { measure: "usda-1", amount: 1 }]);

    const nuts = (await search("zqxmeasure nuts")).find((f) => f.canonical === NUTS);
    expect(brief(nuts)).toEqual([["usda-1 half cup 70", "usda-2 nut 1.2", "g g 1", ounce], { measure: "usda-1", amount: 1 }]);

    // A food of our list: its own serving, then the measures of the USDA entry it cites.
    const apple = (await search("apple")).find((f) => f.canonical === "apple");
    expect(brief(apple)).toEqual([[
      "serving apple 180", "usda-1 cup, quartered or chopped 125", "usda-2 cup slices 109", "usda-3 large (3-1/4\" dia) 223",
      "usda-4 medium (3\" dia) 182", "usda-5 small (2-3/4\" dia) 149", "usda-6 extra small (2-1/2\" dia) 101", "usda-7 NLEA serving 242",
      "g g 1", ounce,
    ], { measure: "serving", amount: 1 }]);

    // A packaged product: its label's pack.
    const pot = (await search("zqxmeasure yogurt")).find((f) => f.canonical === "off_zqxmeasure_pot");
    expect(brief(pot)).toEqual([["serving pot 125", "g g 1", ounce], { measure: "serving", amount: 1 }]);

    // Never a row of amount 0 whose text states none, nor a survey filler: the
    // greens' package is its real 284 g, and the importer served it by its cup.
    const greens = (await search("zqxmeasure greens")).find((f) => f.canonical === GREENS);
    expect(brief(greens)).toEqual([["usda-1 0.33 cup 67", "usda-2 package (10 oz) 284", "g g 1", ounce], { measure: "usda-1", amount: 1 }]);
    expect([greens?.serving, greens?.unit]).toEqual([67, "0.33 cup"]);
  }, 60_000);

  let mealId = "";

  it("saves a food by one of its measures, the grams worked out by the server, and previews the same", async () => {
    const items = [
      { canonical: "apple", measure: "usda-4", amount: 1.5 },
      { canonical: PORRIDGE, measure: "usda-2", amount: 3 },
      { canonical: "off_zqxmeasure_pot", measure: "serving", amount: 2 },
    ];
    const preview = await inject("POST", "/v1/nutrition/meals/preview", alice, { items });
    expect(preview.statusCode, preview.body).toBe(200);
    const saved = await manual(alice, items);
    expect(saved.statusCode, saved.body).toBe(201);
    const meal = mealOf(saved.body);
    mealId = meal.id;
    const apple = findCurated("apple");
    if (apple === null) throw new Error("apple is on the list");
    // 1.5 × 182 g = 273 g of apple at 52 kcal per 100 g: 142 kcal. 3 × 15 g = 45 g of
    // porridge at 71: 32 kcal. 2 × 125 g = 250 g of yogurt at 96: 240 kcal.
    expect(meal.items.map((i) => [i.canonical, i.gramsPoint, i.kcalPoint, i.measure])).toEqual([
      ["apple", 273, Math.round((apple.kcal * 273) / 100), { id: "usda-4", name: "medium (3\" dia)", amount: 1.5 }],
      [PORRIDGE, 45, 32, { id: "usda-2", name: "tablespoon", amount: 3 }],
      ["off_zqxmeasure_pot", 250, 240, { id: "serving", name: "pot", amount: 2 }],
    ]);
    expect(meal.items.map((i) => i.portionSource)).toEqual(["default", "default", "default"]);
    expect(mealPreviewSchema.parse(preview.json()).items).toEqual(meal.items);
  }, 60_000);

  it("refuses a measure the food does not have, and an amount too small or too large to log", async () => {
    // A measure id another food has, but this one does not.
    expect(errorOf(await manual(alice, [{ canonical: "apple", measure: "usda-99", amount: 1 }]))).toEqual([400, "unknown_measure"]);
    // USDA's porridge serves by its cup, which is its first measure, not a serving of its own.
    expect(errorOf(await manual(alice, [{ canonical: PORRIDGE, measure: "serving", amount: 1 }]))).toEqual([400, "unknown_measure"]);
    // The greens' 94 g "package" row and their survey filler are no measures to log by.
    expect(errorOf(await manual(alice, [{ canonical: GREENS, measure: "usda-0", amount: 1 }]))).toEqual([400, "unknown_measure"]);
    expect(errorOf(await manual(alice, [{ canonical: GREENS, measure: "usda-3", amount: 1 }]))).toEqual([400, "unknown_measure"]);
    // Not a measure id at all, and no amount a meal item may weigh.
    expect(errorOf(await manual(alice, [{ canonical: "apple", measure: "cup", amount: 1 }]))).toEqual([400, "validation_error"]);
    expect(errorOf(await manual(alice, [{ canonical: "apple", measure: "g", amount: 10_001 }]))).toEqual([400, "validation_error"]);
    expect(errorOf(await manual(alice, [{ canonical: "apple", measure: "usda-1", amount: 81 }]))).toEqual([400, "portion_out_of_range"]);
    expect(errorOf(await manual(alice, [{ canonical: NUTS, measure: "usda-2", amount: 0.25 }]))).toEqual([400, "portion_out_of_range"]);
    // The preview refuses what the save refuses.
    expect(errorOf(await inject("POST", "/v1/nutrition/meals/preview", alice, { items: [{ canonical: "apple", measure: "usda-99", amount: 1 }] }))).toEqual([400, "unknown_measure"]);
  }, 60_000);

  it("weighs a saved dish by the food's own cup, keeps the dish on the item, and never uses another person's dish", async () => {
    const dish = await inject("POST", "/v1/nutrition/dishware", alice, { label: "My blue bowl", containerClass: "custom", volumeMl: 360 });
    expect(dish.statusCode, dish.body).toBe(201);
    const dishwareId = z.object({ dishware: z.object({ id: z.string().uuid() }) }).parse(dish.json()).dishware.id;

    // Half of 360 ml of nuts whose half cup is 70 g: 360 × 0.5 × 70 / 120 = 105 g.
    // Half of it of apple, which has no plain cup: Appendix B's 1 g a millilitre, 180 g.
    const saved = await manual(alice, [{ canonical: NUTS, dishwareId, fillLevel: 0.5 }, { canonical: "apple", dishwareId, fillLevel: 0.5 }]);
    expect(saved.statusCode, saved.body).toBe(201);
    expect(mealOf(saved.body).items.map((i) => [i.canonical, i.gramsPoint, i.portionSource, i.measure])).toEqual([
      [NUTS, 105, "user_dishware", { id: "dish", name: "My blue bowl", amount: 0.5 }],
      ["apple", 180, "user_dishware", { id: "dish", name: "My blue bowl", amount: 0.5 }],
    ]);

    // Bob holds Alice's dish's id and gets nothing from it.
    expect(errorOf(await manual(bob, [{ canonical: NUTS, dishwareId, fillLevel: 0.5 }]))).toEqual([400, "unknown_dishware"]);
    expect(errorOf(await inject("POST", "/v1/nutrition/meals/preview", bob, { items: [{ canonical: NUTS, dishwareId, fillLevel: 0.5 }] }))).toEqual([400, "unknown_dishware"]);
  }, 60_000);

  it("keeps a measure when an edit sends the item back at its grams, and takes it off for new grams", async () => {
    // Adding an ingredient sends the meal's other items back at their stored grams.
    const added = await inject("PATCH", `/v1/nutrition/meals/${mealId}`, alice, {
      items: [
        { canonical: "apple", grams: 273 },
        { canonical: PORRIDGE, grams: 45 },
        { canonical: "off_zqxmeasure_pot", grams: 250 },
        { canonical: NUTS, measure: "usda-2", amount: 10 },
      ],
    });
    expect(added.statusCode, added.body).toBe(200);
    expect(mealOf(added.body).items.map((i) => [i.canonical, i.gramsPoint, i.measure?.name, i.measure?.amount])).toEqual([
      ["apple", 273, "medium (3\" dia)", 1.5],
      [PORRIDGE, 45, "tablespoon", 3],
      ["off_zqxmeasure_pot", 250, "pot", 2],
      [NUTS, 12, "nut", 10],
    ]);

    // New grams are grams: the measure no longer says what the item holds.
    const regrammed = await inject("PATCH", `/v1/nutrition/meals/${mealId}`, alice, { items: [{ canonical: "apple", grams: 200 }] });
    expect(regrammed.statusCode, regrammed.body).toBe(200);
    const [apple] = mealOf(regrammed.body).items;
    expect([apple?.gramsPoint, apple?.measure]).toEqual([200, undefined]);

    // A meal can hold one food twice: each keeps its own measure, matched by its
    // place in the meal, whichever of the two is measured.
    const twice = async (items: unknown[], resend: unknown[]) => {
      const created = await manual(alice, items);
      expect(created.statusCode, created.body).toBe(201);
      const edited = await inject("PATCH", `/v1/nutrition/meals/${mealOf(created.body).id}`, alice, { items: resend });
      expect(edited.statusCode, edited.body).toBe(200);
      return mealOf(edited.body).items.map((i) => [i.canonical, i.gramsPoint, i.measure?.name ?? null]);
    };
    expect(await twice(
      [{ canonical: "apple", grams: 100 }, { canonical: "apple", measure: "usda-4", amount: 1 }],
      [{ canonical: "apple", grams: 100 }, { canonical: "apple", grams: 182 }, { canonical: NUTS, measure: "usda-2", amount: 10 }],
    )).toEqual([["apple", 100, null], ["apple", 182, "medium (3\" dia)"], [NUTS, 12, "nut"]]);
    expect(await twice(
      [{ canonical: "apple", measure: "usda-4", amount: 1 }, { canonical: "apple", grams: 182 }],
      [{ canonical: "apple", grams: 182 }, { canonical: "apple", grams: 182 }],
    )).toEqual([["apple", 182, "medium (3\" dia)"], ["apple", 182, null]]);

    // A stranger can neither read the meal nor change it by a measure.
    expect((await inject("GET", `/v1/nutrition/meals/${mealId}`, bob)).statusCode).toBe(404);
    expect((await inject("PATCH", `/v1/nutrition/meals/${mealId}`, bob, { items: [{ canonical: "apple", measure: "serving", amount: 1 }] })).statusCode).toBe(404);
    expect((await inject("PATCH", `/v1/nutrition/meals/${mealId}`, "", { items: [{ canonical: "apple", measure: "serving", amount: 1 }] })).statusCode).toBe(401);
  }, 60_000);
});
