// ROADMAP Stage 5 33b-i (Kd, 2026-10-30) — a food no list has, added with the person's own numbers:
// its name, the grams eaten, and its protein, carbs and fat, which price it (4, 4 and 9 kcal a gram).
// Through the routes the phone uses, on the real Postgres: a typed meal, a photo's meal, the preview,
// and a later change of its amount.
//
// The worst thing: a request names an own food's canonical as if it were a food of the lists, and is
// priced at figures nobody typed for it.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { STANDARD_DISHES, mealPreviewSchema, mealResponseSchema, type VisionEvidence } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { CURATED_FOODS } from "../src/modules/nutrition/foods.js";
import { createMemoryRedis } from "../src/redis.js";
import type { FoodSearchProvider } from "../src/modules/nutrition/openfoodfacts.adapter.js";
import type { VisionProvider } from "../src/modules/nutrition/vision.adapter.js";
import { MEAL_PHOTO } from "./fixtures/mealPhoto.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");
const PASSWORD = "own33b-safe-test-password-1"; // gitleaks:allow
const env = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "own33b-test-secret-0123456789abcdef-3333", // gitleaks:allow
  LOG_LEVEL: "error",
};
/** 150 g of chicken taco: 18 g protein, 20 g carbs, 9 g fat — 72 + 80 + 81 = 233 kcal. */
const TACO = { name: "Chicken taco", grams: 150, own: { proteinG: 18, carbsG: 20, fatG: 9 } };
const PLATE: VisionEvidence = {
  meal_name: "Taco plate",
  items: [{ name: "Tacos with beef", canonical_hint: "qwzx beef taco", count: 2, grams: 150, kcal: 300, protein_g: 15, carbs_g: 30, fat_g: 13 }],
  unknown_items: [],
  photo_quality: "good",
};
const scanner: VisionProvider = { analyze: () => Promise.resolve({ evidence: PLATE, tokensIn: 600, tokensOut: 200 }) };
/** A packaged-food search that answers any words, as Open Food Facts can: a name the server gave an own
 *  food finds a product here, so only the server's own guard keeps it from being priced as one. */
const anyWords: FoodSearchProvider = {
  search: (query) => Promise.resolve(query.startsWith("own_")
    ? [{ canonical: "off_9999", name: "Forged taco", kcal: 900, proteinG: 1, carbsG: 1, fatG: 99, fiberG: null, serving: 100, unit: "g", source: "openfoodfacts" }]
    : []),
};

d("a food no list has, added with the person's own numbers (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 4 });
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let alice = "";

  const api = () => { if (app === undefined) throw new Error("beforeAll did not run"); return app; };
  const inject = (method: "GET" | "POST" | "PATCH", path: string, access: string, body?: unknown) =>
    api().inject({
      method, url: path,
      cookies: access === "" ? {} : { accessToken: access },
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(body) }),
    });
  const session = async (email: string): Promise<string> => {
    await inject("POST", "/v1/auth/register", "", { email, password: PASSWORD, displayName: "Own food fixture" });
    const login = await inject("POST", "/v1/auth/login", "", { email, password: PASSWORD });
    return login.cookies.find((c) => c.name === "accessToken")?.value ?? "";
  };
  const clean = async (): Promise<void> => {
    await sql`DELETE FROM meal_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'own33b-%@example.com')`;
    await sql`DELETE FROM api_cost_events WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'own33b-%@example.com')`;
    await sql`DELETE FROM users WHERE email LIKE 'own33b-%@example.com'`;
  };
  const now = () => new Date().toISOString();

  beforeAll(async () => {
    await clean();
    app = await buildApp(loadConfig(env), { redis: createMemoryRedis(), nutrition: { visionProvider: scanner, foodSearchProvider: anyWords } });
    alice = await session("own33b-alice@example.com");
  }, 60_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    await clean();
    await sql.end({ timeout: 5 });
  });

  it("the worst thing: an own food's name sent as a food of the lists prices nothing", async () => {
    const id = randomUUID();
    const saved = await inject("POST", "/v1/nutrition/meals", alice, { id, mealName: "Lunch", takenAt: now(), items: [TACO] });
    expect(saved.statusCode, saved.body).toBe(201);
    const canonical = mealResponseSchema.parse(saved.json()).meal.items[0]?.canonical ?? "";
    expect(canonical).toBe("own_chicken_taco");
    for (const item of [{ canonical, grams: 100 }, { canonical: "own_anything", grams: 100 }, { canonical, measure: "g", amount: 50 }]) {
      const typed = await inject("POST", "/v1/nutrition/meals", alice, { mealName: "Again", takenAt: now(), items: [item] });
      expect(typed.statusCode, typed.body).toBe(400);
      expect(typed.json<{ error: string }>().error).toBe("unknown_food");
      const priced = await inject("POST", "/v1/nutrition/meals/preview", alice, { items: [item] });
      expect(priced.statusCode, priced.body).toBe(400);
    }
  });

  it("a typed meal keeps it by its name, priced from the person's own numbers, and saved once", async () => {
    const id = randomUUID();
    const body = { id, mealName: "Chicken taco", takenAt: now(), mealType: "dinner", items: [TACO, { ...TACO, grams: 100, own: { proteinG: 10, carbsG: 10, fatG: 5 } }] };
    const first = await inject("POST", "/v1/nutrition/meals", alice, body);
    expect(first.statusCode, first.body).toBe(201);
    const again = await inject("POST", "/v1/nutrition/meals", alice, body);
    expect(again.statusCode, again.body).toBe(200);
    const meal = mealResponseSchema.parse(first.json()).meal;
    expect(meal.items.map((i) => [i.name, i.canonical, i.nutritionSource, i.gramsPoint, i.kcalPoint, i.proteinG, i.carbsG, i.fatG])).toEqual([
      ["Chicken taco", "own_chicken_taco", "own", 150, 233, 18, 20, 9],
      ["Chicken taco", "own_chicken_taco_2", "own", 100, 125, 10, 10, 5],
    ]);
    expect(meal.totals.kcalPoint).toBe(358);
    const [{ count } = { count: "" }] = await sql<{ count: string }[]>`SELECT count(*) FROM meal_logs WHERE id = ${id}`;
    expect(count).toBe("1");
    const preview = await inject("POST", "/v1/nutrition/meals/preview", alice, { items: [TACO] });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(mealPreviewSchema.parse(preview.json()).totals.kcalPoint).toBe(233);
  });

  it("refuses numbers that weigh more than the food, and an empty name", async () => {
    const heavy = await inject("POST", "/v1/nutrition/meals/preview", alice, { items: [{ ...TACO, grams: 40 }] });
    expect(heavy.statusCode, heavy.body).toBe(400);
    expect(heavy.json<{ error: string }>().error).toBe("own_numbers_too_heavy");
    const unnamed = await inject("POST", "/v1/nutrition/meals/preview", alice, { items: [{ ...TACO, name: "  " }] });
    expect(unnamed.statusCode).toBe(400);
    const typedKcal = await inject("POST", "/v1/nutrition/meals/preview", alice, { items: [{ ...TACO, kcal: 50 }] });
    expect(typedKcal.statusCode).toBe(400);
  });

  it("a photo's meal takes one in place of a food the photo got wrong, and its preview equals its save", async () => {
    const scan = await inject("POST", "/v1/nutrition/analyze-photo", alice, { imageBase64: MEAL_PHOTO, mimeType: "image/jpeg" });
    expect(scan.statusCode, scan.body).toBe(200);
    const { scanToken } = scan.json<{ scanToken: string }>();
    const preview = await inject("POST", "/v1/nutrition/meals/preview", alice, { scanToken, items: [TACO] });
    expect(preview.statusCode, preview.body).toBe(200);
    const saved = await inject("POST", "/v1/nutrition/meals", alice, { id: randomUUID(), scanToken, takenAt: now(), mealType: "dinner", items: [TACO] });
    expect(saved.statusCode, saved.body).toBe(201);
    const meal = mealResponseSchema.parse(saved.json()).meal;
    expect(meal.origin).toBe("photo");
    expect(meal.items.map((i) => [i.name, i.nutritionSource, i.kcalPoint])).toEqual([["Chicken taco", "own", 233]]);
    expect(mealPreviewSchema.parse(preview.json()).items).toEqual(meal.items);
  });

  it("changed later, it keeps its own numbers, grown with its grams, and has grams to be measured by", async () => {
    const saved = await inject("POST", "/v1/nutrition/meals", alice, { id: randomUUID(), mealName: "Taco", takenAt: now(), items: [TACO] });
    const meal = mealResponseSchema.parse(saved.json()).meal;
    const measures = await inject("GET", `/v1/nutrition/meals/${meal.id}/measures`, alice);
    expect(measures.statusCode, measures.body).toBe(200);
    expect(measures.json<{ measures: { id: string }[][] }>().measures[0]?.map((m) => m.id)).toEqual(["g", "oz"]);
    const changed = await inject("PATCH", `/v1/nutrition/meals/${meal.id}`, alice, {
      items: [{ from: 0, canonical: meal.items[0]?.canonical, grams: 300 }], itemsVersion: meal.itemsVersion, changeId: randomUUID(),
    });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(mealResponseSchema.parse(changed.json()).meal.items.map((i) => [i.name, i.nutritionSource, i.gramsPoint, i.kcalPoint])).toEqual([["Chicken taco", "own", 300, 466]]);
  });
  // A meal eaten from one dish (Kd, 2026-10-30): the foods keep the proportions they had, the dish
  // holds them all, and the same dish applied again gives the same grams (round one's High 2: shares
  // spent as volume skewed a meal toward its denser foods, and drifted on every tap).
  describe("a meal eaten from one dish", () => {
    const bowl = STANDARD_DISHES[2].id;
    const canonicalOf = (start: string): string => {
      const food = CURATED_FOODS.find((f) => f.name.startsWith(start));
      if (food === undefined) throw new Error(`${start} is on our list`);
      return food.canonical;
    };
    const priced = async (items: unknown[]) => {
      const res = await inject("POST", "/v1/nutrition/meals/preview", alice, { items });
      expect(res.statusCode, res.body).toBe(200);
      return mealPreviewSchema.parse(res.json()).items.map((i) => i.gramsPoint);
    };
    /** As the phone works out the parts: each food's grams over the meal's. */
    const partsOf = (grams: readonly number[]) => {
      const total = grams.reduce((a, b) => a + b, 0);
      return grams.map((g) => Math.round((g / total) * 1000) / 1000);
    };

    // Foods of unequal density, in equal and unequal amounts; three foods; each dish fill.
    it.each([
      ["rice and dal, equal", ["Rice (white", "Dal"], [150, 150], 1],
      ["salad and dal, equal", ["Salad", "Dal"], [150, 150], 1],
      ["salad and rice, unequal", ["Salad", "Rice (white"], [60, 180], 0.75],
      ["milk and potato chips", ["Milk", "Potato chips"], [240, 30], 0.5],
      ["rice, dal and paneer", ["Rice (white", "Dal", "Paneer"], [200, 100, 50], 1],
    ] as const)("%s keep their proportions, fill the dish, and come out the same applied again", async (_, names, grams, fill) => {
      const canonicals = names.map(canonicalOf);
      const before = await priced(canonicals.map((canonical, i) => ({ canonical, grams: grams[i] })));
      const shared = (from: readonly number[]) =>
        priced(canonicals.map((canonical, i) => ({ canonical, dishwareId: bowl, fillLevel: fill, share: partsOf(from)[i] })));
      const once = await shared(before);
      // In the proportions they had, within the rounding of a part to a thousandth and a gram.
      for (const [i, g] of once.entries()) {
        const want = ((before[i] ?? 0) / before.reduce((a, b) => a + b, 0)) * once.reduce((a, b) => a + b, 0);
        expect(Math.abs(g - want), `${names[i] ?? ""}: ${String(g)} g against ${String(want)} g`).toBeLessThanOrEqual(2);
      }
      // Together they fill the dish: each food's grams over what a dish of it alone weighs.
      const alone = await Promise.all(canonicals.map(async (canonical) => (await priced([{ canonical, dishwareId: bowl, fillLevel: 1 }]))[0] ?? 1));
      const filled = once.reduce((sum, g, i) => sum + g / (alone[i] ?? 1), 0);
      expect(Math.abs(filled - fill)).toBeLessThan(0.02);
      // The same dish tapped again: the same grams.
      const twice = await shared(once);
      for (const [i, g] of twice.entries()) expect(Math.abs(g - (once[i] ?? 0))).toBeLessThanOrEqual(1);
    });

    it("is kept on the meal as each food's part, refuses a part past the whole, and works on a meal already logged", async () => {
      const [rice, dal] = [canonicalOf("Rice (white"), canonicalOf("Dal")];
      const saved = await inject("POST", "/v1/nutrition/meals", alice, {
        id: randomUUID(), mealName: "Rice and dal", takenAt: now(),
        items: [{ canonical: rice, dishwareId: bowl, fillLevel: 1, share: 0.6 }, { canonical: dal, dishwareId: bowl, fillLevel: 1, share: 0.4 }],
      });
      expect(saved.statusCode, saved.body).toBe(201);
      expect(mealResponseSchema.parse(saved.json()).meal.items.map((i) => i.measure)).toEqual([
        { id: "dish", name: "Bowl", amount: 1, share: 0.6 },
        { id: "dish", name: "Bowl", amount: 1, share: 0.4 },
      ]);
      for (const share of [0, 1.2]) {
        const bad = await inject("POST", "/v1/nutrition/meals/preview", alice, { items: [{ canonical: rice, dishwareId: bowl, fillLevel: 1, share }] });
        expect(bad.statusCode).toBe(400);
      }
      // A logged meal's foods shared out of half a bowl, its own food kept: the rice alone fills it.
      const typed = await inject("POST", "/v1/nutrition/meals", alice, { id: randomUUID(), mealName: "Plate", takenAt: now(), items: [{ canonical: rice, grams: 100 }, TACO] });
      const plate = mealResponseSchema.parse(typed.json()).meal;
      const changed = await inject("PATCH", `/v1/nutrition/meals/${plate.id}`, alice, {
        items: [{ from: 0, canonical: rice, dishwareId: bowl, fillLevel: 0.5, share: 1 }, { from: 1 }], itemsVersion: plate.itemsVersion, changeId: randomUUID(),
      });
      expect(changed.statusCode, changed.body).toBe(200);
      const halfBowl = (await priced([{ canonical: rice, dishwareId: bowl, fillLevel: 0.5 }]))[0];
      expect(mealResponseSchema.parse(changed.json()).meal.items.map((i) => [i.gramsPoint, i.nutritionSource])).toEqual([[halfBowl, "curated"], [150, "own"]]);
    });
  });
});
