import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { MORE_NOT_KNOWN, sumMoreNutrients, type MoreNutrients, type VisionEvidence } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import { createOpenFoodFactsProvider } from "../src/modules/nutrition/openfoodfacts.adapter.js";
import type { VisionProvider, VisionResult } from "../src/modules/nutrition/vision.adapter.js";
import { importUsda } from "../tools/usda-table.js";
import { USDA_NUTRIENTS, type UsdaEntry, type UsdaNutrient } from "../tools/usda-files.js";

// The ten further figures of a food in a meal (ROADMAP 34a): fibre, sugars,
// saturated and unsaturated fat, sodium, potassium, calcium, iron, magnesium and vitamin D, from
// the food table or a product's label. A figure nobody measured is not known,
// never 0, and a label's grams of sodium are milligrams here.

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");
const PASSWORD = "p34a-safe-test-password-1"; // gitleaks:allow
const env = { NODE_ENV: "test", DATABASE_URL: url ?? "", WEB_ORIGIN: "http://localhost:5173", JWT_SECRET: "p34a-test-secret-0123456789abcdef-32", LOG_LEVEL: "error" }; // gitleaks:allow

const FIRST_ID = 90_001_001;
const LAST_ID = 90_001_099;

// Three rows of the USDA table as it stood on 2026-10-13 (SR Legacy 173468,
// 173410 and 167512), kept under ids of this file's own. The biscuits are the
// case that matters: USDA gives them no unsaturated fat, potassium, calcium,
// magnesium or vitamin D. Unsaturated fat is USDA's mono and poly together.
type Row = { kcal: number; proteinG: number; carbsG: number; fatG: number; monoFatG: number | null; polyFatG: number | null } & Omit<MoreNutrients, "unsatFatG">;
const SALT: Row = { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, monoFatG: 0, polyFatG: 0, fiberG: 0, sugarsG: 0, satFatG: 0, sodiumMg: 38758, potassiumMg: 8, calciumMg: 24, ironMg: 0.33, magnesiumMg: 1, vitaminDUg: 0 };
const BUTTER: Row = { kcal: 717, proteinG: 0.85, carbsG: 0.06, fatG: 81.11, monoFatG: 21.021, polyFatG: 3.043, fiberG: 0, sugarsG: 0.06, satFatG: 51.368, sodiumMg: 643, potassiumMg: 24, calciumMg: 24, ironMg: 0.02, magnesiumMg: 2, vitaminDUg: 0 };
const BISCUITS: Row = { kcal: 307, proteinG: 5.88, carbsG: 41.18, fatG: 13.24, monoFatG: null, polyFatG: null, fiberG: 1.2, sugarsG: 5.88, satFatG: 2.941, sodiumMg: 1059, potassiumMg: null, calciumMg: null, ironMg: 2.12, magnesiumMg: null, vitaminDUg: null };
// SR Legacy 173944, "Bananas, raw": the entry our list's Banana cites.
const BANANA_ID = 173_944;
const BANANA: Row = { kcal: 89, proteinG: 1.09, carbsG: 22.84, fatG: 0.33, monoFatG: 0.032, polyFatG: 0.073, fiberG: 2.6, sugarsG: 12.23, satFatG: 0.112, sodiumMg: 1, potassiumMg: 358, calciumMg: 5, ironMg: 0.26, magnesiumMg: 27, vitaminDUg: 0 };

const entry = (fdcId: number, description: string, row: Row): UsdaEntry => {
  const figures = new Map<UsdaNutrient, number | null>();
  for (const n of USDA_NUTRIENTS) figures.set(n.key, null);
  for (const [key, value] of Object.entries(row)) figures.set(key as UsdaNutrient, value);
  return { fdcId, description, figures, portions: [] };
};
const SALT_C = `usda_fndds_${String(FIRST_ID)}`;
const BUTTER_C = `usda_fndds_${String(FIRST_ID + 1)}`;
const BISCUITS_C = `usda_fndds_${String(FIRST_ID + 2)}`;

// One hit of the app's own search address (search.openfoodfacts.org/search) for
// "campbell cream of mushroom soup" on 2026-10-13, as it came: every figure in
// grams per 100 g, and of the ten only fibre, sugars, saturated fat and sodium.
const SOUP = {
  code: "0051000129680", product_name: "Campbell's soup cream of mushroom",
  nutriments: { "energy-kcal_100g": 83, proteins_100g: 1.67, sugars_100g: 0.83, fat_100g: 5.83, salt_100g: 1.8125, sodium_100g: 0.725, fiber_100g: 0, "saturated-fat_100g": 0.83, carbohydrates_100g: 6.67 },
};
const SOUP_C = "off_0051000129680";
// The same figures under a name no food table has, so a photo of it is priced by
// its label on a machine with the USDA files loaded and on one without.
const BROTH = { code: "90001090", product_name: "Zqxlabel broth", nutriments: SOUP.nutriments };
const BROTH_C = "off_90001090";
const labels = createOpenFoodFactsProvider((input) => {
  const q = new URL(input instanceof Request ? input.url : input).searchParams.get("q") ?? "";
  return Promise.resolve(new Response(JSON.stringify({ hits: q.includes("mushroom") ? [SOUP] : q.includes("zqxlabel") ? [BROTH] : [] }), { status: 200 }));
});

const evidence: VisionEvidence = {
  meal_name: "Banana and stew",
  items: [
    { name: "Banana", canonical_hint: "banana", count: 1, grams: null, kcal: null, protein_g: null, carbs_g: null, fat_g: null },
    { name: "Zqxmore stew", canonical_hint: "zqxmore stew", count: null, grams: 200, kcal: 180, protein_g: 9, carbs_g: 14, fat_g: 8 },
    { name: "Zqxmore butter", canonical_hint: "zqxmore butter salted", count: null, grams: 10, kcal: null, protein_g: null, carbs_g: null, fat_g: null },
    { name: "Zqxlabel broth", canonical_hint: "zqxlabel broth", count: null, grams: 120, kcal: null, protein_g: null, carbs_g: null, fat_g: null },
  ],
  unknown_items: [],
  photo_quality: "good",
};
const vision: VisionProvider = { analyze: () => Promise.resolve({ evidence, tokensIn: 100, tokensOut: 200 } satisfies VisionResult) };
const jpeg = (() => { const bytes = Buffer.alloc(1200, 1); bytes[0] = 0xff; bytes[1] = 0xd8; bytes[2] = 0xff; return bytes.toString("base64"); })();

interface Item { canonical: string; gramsPoint: number; nutritionSource: string; more?: MoreNutrients }
interface MealReply { id: string; itemsVersion: string; items: Item[] }

d("the ten further figures of a food in a meal (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 4 });
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let alice = "";
  let bob = "";
  let bananaAdded = false;

  const api = () => { if (app === undefined) throw new Error("beforeAll did not run"); return app; };
  const inject = (method: "GET" | "POST" | "PATCH", path: string, access: string, body?: unknown) =>
    api().inject({
      method, url: path, cookies: access === "" ? {} : { accessToken: access },
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(body) }),
    });
  const session = async (email: string): Promise<string> => {
    await inject("POST", "/v1/auth/register", "", { email, password: PASSWORD, displayName: "Figures fixture" });
    const login = await inject("POST", "/v1/auth/login", "", { email, password: PASSWORD });
    return login.cookies.find((c) => c.name === "accessToken")?.value ?? "";
  };
  const users = sql`SELECT id FROM users WHERE email LIKE 'p34a-%@example.com'`;
  const wipe = async (): Promise<void> => {
    await sql`DELETE FROM meal_logs WHERE user_id IN (${users})`;
    await sql`DELETE FROM users WHERE email LIKE 'p34a-%@example.com'`;
    await sql`DELETE FROM usda_foods WHERE fdc_id BETWEEN ${FIRST_ID} AND ${LAST_ID}`;
  };
  const save = async (access: string, items: { canonical: string; grams: number }[]): Promise<MealReply> => {
    const res = await inject("POST", "/v1/nutrition/meals", access, { mealName: "Figures", takenAt: new Date().toISOString(), items });
    if (res.statusCode !== 201) throw new Error(res.body);
    return res.json<{ meal: MealReply }>().meal;
  };
  const moreOf = (meal: { items: Item[] }, canonical: string): MoreNutrients | undefined =>
    meal.items.find((i) => i.canonical === canonical)?.more;

  beforeAll(async () => {
    await wipe();
    await importUsda(sql, [["fndds", [entry(FIRST_ID, "Zqxmore salt, table", SALT), entry(FIRST_ID + 1, "Zqxmore butter, salted", BUTTER), entry(FIRST_ID + 2, "Zqxmore biscuits, refrigerated dough", BISCUITS)]]]);
    // A machine that has had the USDA files loaded holds the banana's entry, and
    // it is left as it is; one that has not is given it, and it is taken away after.
    const held = await sql`SELECT 1 FROM usda_foods WHERE fdc_id = ${BANANA_ID}`;
    if (held.length === 0) {
      await importUsda(sql, [["sr_legacy", [entry(BANANA_ID, "Bananas, raw", BANANA)]]]);
      bananaAdded = true;
    }
    app = await buildApp(loadConfig(env), { redis: createMemoryRedis(), nutrition: { visionProvider: vision, foodSearchProvider: labels } });
    alice = await session("p34a-alice@example.com");
    bob = await session("p34a-bob@example.com");
  }, 60_000);
  afterEach(async () => { await sql`DELETE FROM meal_logs WHERE user_id IN (${users})`; });
  afterAll(async () => {
    if (app !== undefined) await app.close();
    await wipe();
    if (bananaAdded) await sql`DELETE FROM usda_foods WHERE fdc_id = ${BANANA_ID}`;
    await sql.end({ timeout: 5 });
  });

  it("a figure nobody measured is not known, never 0, and sodium is in milligrams from the table and from a label", async () => {
    // The label is found by a search first, as a person finds it.
    const found = await inject("GET", "/v1/nutrition/foods?q=zqxnone%20mushroom&limit=5", alice);
    expect(found.json<{ items: { canonical: string }[] }>().items.map((f) => f.canonical)).toContain(SOUP_C);

    const meal = await save(alice, [{ canonical: BISCUITS_C, grams: 50 }, { canonical: SALT_C, grams: 6 }, { canonical: SOUP_C, grams: 120 }]);
    // 50 g of biscuits: half of USDA's row, and its five gaps stay gaps.
    expect(moreOf(meal, BISCUITS_C)).toEqual({ fiberG: 0.6, sugarsG: 2.9, satFatG: 1.5, unsatFatG: null, sodiumMg: 530, potassiumMg: null, calciumMg: null, ironMg: 1.1, magnesiumMg: null, vitaminDUg: null });
    // A teaspoon of salt, 6 g: 38,758 mg per 100 g is 2,325 mg.
    expect(moreOf(meal, SALT_C)).toEqual({ fiberG: 0, sugarsG: 0, satFatG: 0, unsatFatG: 0, sodiumMg: 2325, potassiumMg: 0, calciumMg: 1, ironMg: 0, magnesiumMg: 0, vitaminDUg: 0 });
    // The soup: Open Food Facts keeps 0.725 g of sodium per 100 g, which is 870 mg
    // in 120 g. What the search did not send is not known.
    expect(moreOf(meal, SOUP_C)).toEqual({ ...MORE_NOT_KNOWN, fiberG: 0, sugarsG: 1, satFatG: 1, sodiumMg: 870 });

    // The meal's sum says how many foods gave no figure, and adds only those that did.
    const sum = sumMoreNutrients(meal.items);
    expect(sum.sodiumMg).toEqual({ amount: 3725, notKnown: 0 });
    expect(sum.magnesiumMg).toEqual({ amount: 0, notKnown: 2 });
    expect(sum.potassiumMg).toEqual({ amount: 0, notKnown: 2 });

    // Read again, it is what was saved; nobody else can read it.
    const again = await inject("GET", `/v1/nutrition/meals/${meal.id}`, alice);
    expect(again.json<{ meal: MealReply }>().meal.items).toEqual(meal.items);
    expect((await inject("GET", `/v1/nutrition/meals/${meal.id}`, bob)).statusCode).toBe(404);
    expect((await inject("GET", `/v1/nutrition/meals/${meal.id}`, "")).statusCode).toBe(401);
  });

  it("a food of our list reads the USDA entry it cites, and a CoFID food has its fibre alone", async () => {
    const meal = await save(alice, [{ canonical: "banana", grams: 120 }, { canonical: "muesli", grams: 45 }]);
    expect(moreOf(meal, "banana")).toEqual({ fiberG: 3.1, sugarsG: 14.7, satFatG: 0.1, unsatFatG: 0.1, sodiumMg: 1, potassiumMg: 430, calciumMg: 6, ironMg: 0.3, magnesiumMg: 32, vitaminDUg: 0 });
    expect(moreOf(meal, "muesli")).toEqual({ ...MORE_NOT_KNOWN, fiberG: 4 });
  });

  it("what is shown before saving is what is saved, and a changed amount changes the figures with it", async () => {
    const items = [{ canonical: BUTTER_C, grams: 10 }, { canonical: BISCUITS_C, grams: 50 }];
    const preview = await inject("POST", "/v1/nutrition/meals/preview", alice, { items });
    const meal = await save(alice, items);
    expect(preview.json<{ items: Item[] }>().items).toEqual(meal.items);
    expect(moreOf(meal, BUTTER_C)?.sodiumMg).toBe(64);

    const edit = { itemsVersion: meal.itemsVersion, items: [{ canonical: BUTTER_C, grams: 30, from: 0 }, { from: 1 }] };
    const shown = await inject("POST", `/v1/nutrition/meals/${meal.id}/preview`, alice, edit);
    const changed = await inject("PATCH", `/v1/nutrition/meals/${meal.id}`, alice, edit);
    expect(changed.statusCode, changed.body).toBe(200);
    const after = changed.json<{ meal: MealReply }>().meal;
    expect(shown.json<{ items: Item[] }>().items).toEqual(after.items);
    expect(moreOf(after, BUTTER_C)).toEqual({ fiberG: 0, sugarsG: 0, satFatG: 15.4, unsatFatG: 7.2, sodiumMg: 193, potassiumMg: 7, calciumMg: 7, ironMg: 0, magnesiumMg: 1, vitaminDUg: 0 });
    // The food left alone is exactly as it was saved.
    expect(after.items[1]).toEqual(meal.items[1]);
    // Somebody else changing it is told there is no such meal, and nothing changes.
    expect((await inject("PATCH", `/v1/nutrition/meals/${meal.id}`, bob, edit)).statusCode).toBe(404);
  });

  it("a food priced by the person's own numbers has none of the ten, and gets them back with its table's numbers", async () => {
    const meal = await save(alice, [{ canonical: BUTTER_C, grams: 10 }]);
    const own = await inject("PATCH", `/v1/nutrition/meals/${meal.id}`, alice, {
      itemsVersion: meal.itemsVersion, items: [{ canonical: BUTTER_C, grams: 10, from: 0, own: { proteinG: 1, carbsG: 1, fatG: 5 } }],
    });
    const typed = own.json<{ meal: MealReply }>().meal;
    expect(typed.items[0]?.nutritionSource).toBe("own");
    expect(typed.items[0]?.more).toEqual(MORE_NOT_KNOWN);
    const back = await inject("PATCH", `/v1/nutrition/meals/${meal.id}`, alice, {
      itemsVersion: typed.itemsVersion, items: [{ canonical: BUTTER_C, grams: 10, from: 0, own: null }],
    });
    expect(back.json<{ meal: MealReply }>().meal.items[0]?.more?.sodiumMg).toBe(64);
  });

  it("a photo's foods have their figures on the sheet: from the list, the table and a label, and none for a food the scanner priced itself", async () => {
    const res = await inject("POST", "/v1/nutrition/analyze-photo", alice, { imageBase64: jpeg, mimeType: "image/jpeg" });
    expect(res.statusCode, res.body).toBe(200);
    const sheet = res.json<{ scanToken: string; items: Item[] }>();
    expect(sheet.items.map((i) => i.nutritionSource)).toEqual(["curated", "estimate", "usda", "openfoodfacts"]);
    const butterGrams = sheet.items.find((i) => i.canonical === BUTTER_C)?.gramsPoint ?? 0;
    const soupGrams = sheet.items.find((i) => i.canonical === BROTH_C)?.gramsPoint ?? 0;
    expect(moreOf(sheet, "banana")?.potassiumMg).toBe(430);
    expect(sheet.items[1]?.more).toEqual(MORE_NOT_KNOWN);
    expect(moreOf(sheet, BUTTER_C)?.sodiumMg).toBe(Math.round(6.43 * butterGrams));
    expect(moreOf(sheet, BROTH_C)).toMatchObject({ sodiumMg: Math.round(7.25 * soupGrams), potassiumMg: null });

    // The table's row is read again when the meal is saved: what the sheet was
    // sent, and what is kept with the photo, is never what is saved.
    await sql`UPDATE usda_foods SET sodium_mg = 999 WHERE fdc_id = ${FIRST_ID + 1}`;
    try {
      const saved = await inject("POST", "/v1/nutrition/meals", alice, {
        scanToken: sheet.scanToken, takenAt: new Date().toISOString(),
        items: sheet.items.map((i) => ({ canonical: i.canonical, grams: i.gramsPoint })),
      });
      expect(saved.statusCode, saved.body).toBe(201);
      const meal = saved.json<{ meal: MealReply }>().meal;
      expect(moreOf(meal, BUTTER_C)?.sodiumMg).toBe(Math.round(9.99 * butterGrams));
      expect(moreOf(meal, "banana")?.potassiumMg).toBe(430);
      expect(meal.items[1]?.more).toEqual(MORE_NOT_KNOWN);
      expect(moreOf(meal, BROTH_C)?.sodiumMg).toBe(Math.round(7.25 * soupGrams));
    } finally {
      await sql`UPDATE usda_foods SET sodium_mg = ${BUTTER.sodiumMg} WHERE fdc_id = ${FIRST_ID + 1}`;
    }
  });

  it("a meal saved before the figures were kept still reads, each food counted as not known", async () => {
    const meal = await save(alice, [{ canonical: BUTTER_C, grams: 10 }, { canonical: BISCUITS_C, grams: 50 }]);
    await sql`UPDATE meal_logs SET items = (SELECT jsonb_agg(item - 'more') FROM jsonb_array_elements(items) AS item) WHERE id = ${meal.id}`;
    const res = await inject("GET", `/v1/nutrition/meals/${meal.id}`, alice);
    expect(res.statusCode, res.body).toBe(200);
    const old = res.json<{ meal: MealReply }>().meal;
    expect(old.items.map((i) => i.more)).toEqual([undefined, undefined]);
    expect(sumMoreNutrients(old.items).sodiumMg).toEqual({ amount: 0, notKnown: 2 });
  });
});
