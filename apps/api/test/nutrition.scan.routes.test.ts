// ROADMAP 7a-iii-b — the scanner prices every food it sees, through the routes a
// person uses: scanned, stepped, saved, edited later, and unreachable by anyone
// else. A food no table has is the model's own estimate; a table food whose
// energy is three times from what the model saw is another food, and gives way.
// Kd's eight plates run through the same route and the same lookups.
//
// The foods here carry nonsense words ("qwzx…", "zqxscanroute"), and every USDA
// fixture is keyed above 90,000,000, so this file answers the same whether or not
// the machine has had `tools/import-usda.ts` run against it. The eight plates'
// USDA rows are the real ones, copied whole (below): on a machine with the table
// loaded, a real row and its copy tie on everything but the id, and the sheet
// shows the same food either way.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { z } from "zod";
import { mealPhotoAnalysisSchema, mealPreviewSchema, mealSchema, mealVisionEvidenceSchema, type Meal, type MealPhotoAnalysis, type MealVessel, type VisionEvidence, type VisionItem } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import type { FoodSearchProvider } from "../src/modules/nutrition/openfoodfacts.adapter.js";
import type { VisionProvider } from "../src/modules/nutrition/vision.adapter.js";
import { importUsda } from "../tools/usda-table.js";
import { USDA_NUTRIENTS, type UsdaEntry, type UsdaNutrient, type UsdaRelease } from "../tools/usda-files.js";

const sentry = vi.hoisted(() => ({ init: vi.fn(), captureException: vi.fn(), httpIntegration: vi.fn() }));
vi.mock("@sentry/node", () => sentry);

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");
const PASSWORD = "scan7b-safe-test-password-1"; // gitleaks:allow
const env = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "scan7b-test-secret-0123456789abcdef-32", // gitleaks:allow
  LOG_LEVEL: "error",
  GROQ_API_KEY: "scan7b-fake-provider-key", // gitleaks:allow
};
const jpeg = (() => { const bytes = Buffer.alloc(1200, 1); bytes[0] = 0xff; bytes[1] = 0xd8; bytes[2] = 0xff; return bytes.toString("base64"); })();

const USDA_ID = 90_000_301;
/** One name, two ways made: the survey release's pickled at 34 kcal per 100 g, and
 *  SR Legacy's raw at 16, which the release rule alone would never pick. */
const PICKLED_ID = 90_000_302;
const RAW_ID = 90_000_303;
/** The eight plates' USDA rows, from here up. */
const PLATE_ROWS_FROM = 90_000_310;
const LAST_ID = 90_000_399;

/** Every USDA row the eight plates' foods can find by name (`usdaFoodForScan`'s
 *  WHERE), copied from the loaded table on 2026-09-16 — FNDDS 2024-10-31 and SR
 *  Legacy 2018-04, public domain: release, description, kcal, protein, carbohydrate,
 *  fat and fibre per 100 g, and the first household measure. The other plates'
 *  foods not on our list (caffe latte, avocado toast, cherry tomato, toast, banana
 *  toast, egg bacon toast) find none in either release. */
const PLATE_USDA_ROWS: readonly (readonly [UsdaRelease, string, number, number, number, number, number | null, number, string])[] = [
  ["fndds", "Pumpkin seeds, NFS", 574, 29.84, 14.71, 49.05, 6.5, 144, "cup, without shell"],
  ["fndds", "Pumpkin seeds, salted", 567, 29.49, 14.54, 48.47, 6.4, 144, "cup, without shell"],
  ["fndds", "Pumpkin seeds, unsalted", 574, 29.84, 14.71, 49.05, 6.5, 144, "cup, without shell"],
  ["fndds", "Lemon, raw", 29, 1.1, 9.32, 0.3, 2.8, 65, "fruit"],
  ["fndds", "Lemon pie filling", 354, 4.71, 68.92, 6.93, 0.4, 260, "cup"],
  ["fndds", "Lemon juice, 100%, NS as to form", 22, 0.35, 6.9, 0.24, 0.3, 31, "fl oz (no ice)"],
  ["fndds", "Lemon juice, 100%, freshly squeezed", 22, 0.35, 6.9, 0.24, 0.3, 31, "fl oz (no ice)"],
  ["fndds", "Lemon juice, 100%, canned or bottled", 17, 0.45, 5.62, 0.07, 0.7, 31, "fl oz (no ice)"],
  ["fndds", "Pumpkin, canned, cooked", 56, 1.08, 7.86, 2.82, 2.8, 245, "cup"],
  ["fndds", "Pumpkin, cooked", 52, 1.05, 6.77, 2.84, 0.5, 230, "cup"],
  ["fndds", "Lemon-butter sauce", 671, 0.8, 0.74, 74, 0, 16, "tablespoon"],
  ["fndds", "Iced Coffee, brewed", 1, 0.09, 0, 0.02, 0, 30, "fl oz"],
  ["fndds", "Iced Coffee, brewed, decaffeinated", 0, 0.08, 0, 0, 0, 30, "fl oz"],
  ["fndds", "Iced Coffee, pre-lightened and pre-sweetened", 31, 0.25, 4.94, 1.12, 0, 31, "fl oz"],
  ["fndds", "Coffee, Iced Latte", 27, 1.75, 2.81, 1.01, 0, 30, "fl oz"],
  ["fndds", "Coffee, Iced Latte, nonfat", 19, 1.78, 2.82, 0.07, 0, 30, "fl oz"],
  ["fndds", "Coffee, Iced Latte, with non-dairy milk", 24, 1.36, 2.83, 0.79, 0.1, 30, "fl oz"],
  ["fndds", "Coffee, Iced Latte, flavored", 40, 1.69, 6.09, 0.98, 0, 31, "fl oz"],
  ["fndds", "Coffee, Iced Latte, nonfat, flavored", 32, 1.72, 6.1, 0.08, 0, 31, "fl oz"],
  ["fndds", "Coffee, Iced Latte, with non-dairy milk, flavored", 31, 0.59, 5.16, 0.84, 0, 31, "fl oz"],
  ["fndds", "Coffee, Iced Latte, decaffeinated", 27, 1.75, 2.82, 1.01, 0, 30, "fl oz"],
  ["fndds", "Coffee, Iced Latte, decaffeinated, nonfat", 19, 1.79, 2.83, 0.07, 0, 30, "fl oz"],
  ["fndds", "Coffee, Iced Latte, decaffeinated, with non-dairy milk", 18, 0.61, 1.86, 0.86, 0.1, 30, "fl oz"],
  ["fndds", "Coffee, Iced Latte, decaffeinated, flavored", 40, 1.69, 6.12, 0.99, 0, 31, "fl oz"],
  ["fndds", "Coffee, Iced Latte, decaffeinated, nonfat, flavored", 32, 1.73, 6.13, 0.08, 0, 31, "fl oz"],
  ["fndds", "Coffee, Iced Latte, decaffeinated, with non-dairy milk, flavored", 31, 0.59, 5.18, 0.84, 0.1, 31, "fl oz"],
  ["fndds", "Coffee, Iced Cafe Mocha", 50, 1.58, 8.95, 0.91, 0, 31, "fl oz"],
  ["fndds", "Coffee, Iced Cafe Mocha, nonfat", 43, 1.61, 8.96, 0.07, 0, 31, "fl oz"],
  ["fndds", "Coffee, Iced Cafe Mocha, with non-dairy milk", 42, 0.55, 8.07, 0.78, 0, 31, "fl oz"],
  ["fndds", "Coffee, Iced Cafe Mocha, decaffeinated", 51, 1.59, 8.99, 0.92, 0, 31, "fl oz"],
  ["fndds", "Coffee, Iced Cafe Mocha, decaffeinated, nonfat", 43, 1.62, 9, 0.06, 0, 31, "fl oz"],
  ["fndds", "Coffee, Iced Cafe Mocha, decaffeinated, with non-dairy milk", 42, 0.55, 8.1, 0.78, 0, 31, "fl oz"],
  ["sr_legacy", "Lemons, raw, without peel", 29, 1.1, 9.32, 0.3, 2.8, 212, "cup, sections"],
  ["sr_legacy", "Lemon juice, raw", 22, 0.35, 6.9, 0.24, 0.3, 244, "cup"],
  ["sr_legacy", "Lemon juice from concentrate, canned or bottled", 17, 0.45, 5.62, 0.07, 0.7, 15, "tbsp"],
  ["sr_legacy", "Lemon peel, raw", 47, 1.5, 16, 0.3, 10.6, 6, "tbsp"],
  ["sr_legacy", "Lemon juice from concentrate, bottled, CONCORD", 24, 0.4, 5.37, 0.07, null, 15, "tbsp"],
  ["sr_legacy", "Lemon juice from concentrate, bottled, REAL LEMON", 17, 0.47, 5.66, 0.07, 0.7, 15, "tbsp"],
  ["sr_legacy", "Pumpkin leaves, cooked, boiled, drained, without salt", 21, 2.72, 3.39, 0.22, 2.7, 71, "cup"],
  ["sr_legacy", "Pumpkin, raw", 26, 1, 6.5, 0.1, 0.5, 116, "cup (1\" cubes)"],
  ["sr_legacy", "Pumpkin, cooked, boiled, drained, without salt", 20, 0.72, 4.9, 0.07, 1.1, 245, "cup, mashed"],
  ["sr_legacy", "Pumpkin, canned, without salt", 34, 1.1, 8.09, 0.28, 2.9, 245, "cup"],
  ["sr_legacy", "Lemon grass (citronella), raw", 99, 1.82, 25.31, 0.49, null, 67, "cup"],
  ["sr_legacy", "Pumpkin flowers, raw", 15, 1.03, 3.28, 0.07, null, 33, "cup"],
  ["sr_legacy", "Pumpkin flowers, cooked, boiled, drained, without salt", 15, 1.09, 3.3, 0.08, 0.9, 134, "cup"],
  ["sr_legacy", "Pumpkin leaves, raw", 19, 3.15, 2.33, 0.4, null, 39, "cup"],
  ["sr_legacy", "Pumpkin pie mix, canned", 104, 1.09, 26.39, 0.13, 8.3, 270, "cup"],
  ["sr_legacy", "Pumpkin, flowers, cooked, boiled, drained, with salt", 15, 1.09, 3.18, 0.08, 0.9, 134, "cup"],
  ["sr_legacy", "Pumpkin leaves, cooked, boiled, drained, with salt", 21, 2.72, 3.39, 0.22, 2.7, 71, "cup"],
  ["sr_legacy", "Pumpkin, cooked, boiled, drained, with salt", 18, 0.72, 4.31, 0.07, 1.1, 245, "cup, mashed"],
  ["sr_legacy", "Pumpkin, canned, with salt", 34, 1.1, 8.09, 0.28, 2.9, 245, "cup"],
];

/** A USDA fixture: the four figures a meal is priced from and fibre, the rest
 *  unmeasured, served by one household measure. */
const usdaFixture = (fdcId: number, description: string, [kcal, protein, carbs, fat, fiber]: readonly [number, number, number, number, number | null], [grams, unit]: readonly [number, string]): UsdaEntry => {
  const figures = new Map<UsdaNutrient, number | null>(USDA_NUTRIENTS.map((n) => [n.key, null]));
  for (const [key, value] of [["kcal", kcal], ["proteinG", protein], ["carbsG", carbs], ["fatG", fat], ["fiberG", fiber]] as const) figures.set(key, value);
  return { fdcId, description, figures, portions: [{ seqNum: 1, amount: 1, unit, gramWeight: grams }] };
};

/** No packaged product for any food scanned here — but a search for an estimate's
 *  canonical answers, as the live search answers almost any text, so a request that
 *  let an est_ canonical reach it would price a forged estimate as that product. */
const packagedSearch: FoodSearchProvider = {
  search: (query) => Promise.resolve(query.startsWith("est_")
    ? [{ canonical: "off_forged", name: "Forged product", kcal: 250, proteinG: 5, carbsG: 25, fatG: 14, fiberG: null, serving: 100, unit: "g", source: "openfoodfacts" }]
    : []),
};

/** A food as the scanner reads the model's list, figures as given. */
const seen = (name: string, hint: string, figures: [grams: number, kcal: number, protein: number, carbs: number, fat: number] | null, more: { vessel?: MealVessel; fill?: number; count?: number } = {}): VisionItem => ({
  name, canonical_hint: hint, vessel: more.vessel ?? null, fill_level: more.fill ?? null, size_class: null, count: more.count ?? null,
  grams: figures?.[0] ?? null, kcal: figures?.[1] ?? null, protein_g: figures?.[2] ?? null, carbs_g: figures?.[3] ?? null, fat_g: figures?.[4] ?? null,
});
const plate = (...items: VisionItem[]): VisionEvidence => ({ meal_name: "Qwzx plate", items, unknown_items: [], photo_quality: "good" });

/** The model's replies, in order. */
function scripted(): VisionProvider & { queue: VisionEvidence[] } {
  const queue: VisionEvidence[] = [];
  return {
    queue,
    analyze() {
      const evidence = queue.shift();
      if (evidence === undefined) throw new Error("no reply scripted");
      return Promise.resolve({ evidence, tokensIn: 600, tokensOut: 250 });
    },
  };
}

// 120 g of a fritter no table has, at 300 kcal: 6 g protein, 30 g carbohydrate and
// 17 g fat make 297 kcal, so it is an estimate — 250 kcal, 5 g, 25 g and 14.17 g per 100 g.
const FRITTER = seen("Qwzx fritter", "qwzx fritter", [120, 300, 6, 30, 17], { count: 2 });
// Our list's dal (145 kcal per 100 g) in a katori ¾ full, which the model saw at 113. Appendix B's
// katori holds 150–200 ml, so ¾ full is 113–150 g and the portion 132 g, 191 kcal.
const DAL = seen("Dal", "dal", [150, 170, 9, 25, 4], { vessel: "katori", fill: 0.75 });

type App = Awaited<ReturnType<typeof buildApp>>;

d("the scanner prices every food it sees (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 4 });
  const vision = scripted();
  let app: App | undefined;
  let alice = "";
  let bob = "";

  const api = () => { if (app === undefined) throw new Error("beforeAll did not run"); return app; };
  const injectOn = (target: App, method: "GET" | "POST" | "PATCH", path: string, access: string, body?: unknown) =>
    target.inject({
      method, url: path,
      cookies: access === "" ? {} : { accessToken: access },
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(body) }),
    });
  const inject = (method: "GET" | "POST" | "PATCH", path: string, access: string, body?: unknown) => injectOn(api(), method, path, access, body);
  const sessionOn = async (target: App, email: string): Promise<string> => {
    await injectOn(target, "POST", "/v1/auth/register", "", { email, password: PASSWORD, displayName: "Scan fixture" });
    const login = await injectOn(target, "POST", "/v1/auth/login", "", { email, password: PASSWORD });
    return login.cookies.find((c) => c.name === "accessToken")?.value ?? "";
  };
  const session = (email: string): Promise<string> => sessionOn(api(), email);
  const scanOn = async (target: App, access: string, evidence: VisionEvidence): Promise<MealPhotoAnalysis> => {
    vision.queue.push(evidence);
    const res = await injectOn(target, "POST", "/v1/nutrition/analyze-photo", access, { imageBase64: jpeg, mimeType: "image/jpeg" });
    expect(res.statusCode, res.body).toBe(200);
    return mealPhotoAnalysisSchema.parse(res.json());
  };
  const scan = (access: string, evidence: VisionEvidence): Promise<MealPhotoAnalysis> => scanOn(api(), access, evidence);
  const mealOf = (body: string): Meal => mealSchema.parse(z.object({ meal: z.unknown() }).parse(JSON.parse(body)).meal);
  const clean = async (): Promise<void> => {
    await sql`DELETE FROM meal_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'scan7b-%@example.com')`;
    await sql`DELETE FROM api_cost_events WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'scan7b-%@example.com')`;
    await sql`DELETE FROM users WHERE email LIKE 'scan7b-%@example.com'`;
    await sql`DELETE FROM usda_food_portions WHERE fdc_id BETWEEN ${USDA_ID} AND ${LAST_ID}`;
    await sql`DELETE FROM usda_foods WHERE fdc_id BETWEEN ${USDA_ID} AND ${LAST_ID}`;
  };

  beforeAll(async () => {
    await clean();
    const figures = new Map<UsdaNutrient, number | null>(USDA_NUTRIENTS.map((n, at) => [n.key, at + 1]));
    for (const [key, value] of [["kcal", 213], ["proteinG", 11.5], ["carbsG", 27.3], ["fatG", 6.4]] as const) figures.set(key, value);
    const plateRows = (release: UsdaRelease): UsdaEntry[] => PLATE_USDA_ROWS.flatMap(([r, description, kcal, protein, carbs, fat, fiber, grams, unit], at) =>
      r === release ? [usdaFixture(PLATE_ROWS_FROM + at, description, [kcal, protein, carbs, fat, fiber], [grams, unit])] : []);
    await importUsda(sql, [
      ["fndds", [
        { fdcId: USDA_ID, description: "Zqxscanroute, cooked", figures, portions: [{ seqNum: 1, amount: null, unit: "1 cup", gramWeight: 240 }] },
        usdaFixture(PICKLED_ID, "Zqxscanpick, pickled", [34, 0.9, 7, 0.2, 1.6], [150, "cup"]),
        ...plateRows("fndds"),
      ]],
      ["sr_legacy", [usdaFixture(RAW_ID, "Zqxscanpick, raw", [16, 0.68, 3.4, 0.1, 1.6], [116, "cup slices"]), ...plateRows("sr_legacy")]],
    ]);
    app = await buildApp(loadConfig(env), { redis: createMemoryRedis(), nutrition: { visionProvider: vision, foodSearchProvider: packagedSearch } });
    alice = await session("scan7b-alice@example.com");
    bob = await session("scan7b-bob@example.com");
  }, 60_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    await clean();
    await sql.end({ timeout: 5 });
  });

  it("lists a food no table has as the model's estimate, stepped, saved and changed later at its own figures", async () => {
    const sheet = await scan(alice, plate(FRITTER, DAL));
    expect(sheet.unknownItems).toEqual([]);
    const [fritter, dal] = sheet.items;
    expect(fritter).toMatchObject({
      name: "Qwzx fritter", canonical: "est_qwzx_fritter", nutritionSource: "estimate", portionSource: "default",
      gramsPoint: 120, gramsRange: [120, 120], kcalPoint: 300, proteinG: 6, carbsG: 30, fatG: 17, pieces: 2,
    });
    expect(fritter?.per100g?.kcal).toBe(250);
    // Our list's dal is still our list's, portioned as it always was (Appendix B's katori).
    expect(dal).toMatchObject({ name: "Dal (lentil curry)", canonical: "dal_lentil_curry", nutritionSource: "curated", gramsPoint: 132, kcalPoint: 191 });
    expect(dal?.per100g).toBeUndefined();

    // The stepper halves the fritters: the server prices the estimate at its own figures.
    const preview = await inject("POST", "/v1/nutrition/meals/preview", alice, { scanToken: sheet.scanToken, items: [{ canonical: "est_qwzx_fritter", grams: 60 }, { canonical: "dal_lentil_curry", grams: 132 }] });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json<{ items: { kcalPoint: number; proteinG: number; fatG: number }[] }>().items[0]).toMatchObject({ kcalPoint: 150, proteinG: 3, fatG: 8.5 });

    // An estimate the scan never gave is no food: the confirm is refused, and the scan survives it.
    const forged = await inject("POST", "/v1/nutrition/meals", alice, { scanToken: sheet.scanToken, takenAt: new Date().toISOString(), items: [{ canonical: "est_qwzx_fritter", grams: 180 }, { canonical: "est_qwzx_forged", grams: 100 }] });
    expect(forged.statusCode, forged.body).toBe(400);
    expect(forged.json<{ error: string }>().error).toBe("unknown_food");

    const saved = await inject("POST", "/v1/nutrition/meals", alice, { scanToken: sheet.scanToken, takenAt: new Date().toISOString(), items: [{ canonical: "est_qwzx_fritter", grams: 180 }, { canonical: "dal_lentil_curry", grams: 132 }] });
    expect(saved.statusCode, saved.body).toBe(201);
    const meal = mealOf(saved.body);
    expect(meal.items[0]).toMatchObject({ canonical: "est_qwzx_fritter", nutritionSource: "estimate", gramsPoint: 180, kcalPoint: 450, proteinG: 9, carbsG: 45, fatG: 25.5 });
    expect(meal.nutritionSources.sort()).toEqual(["curated", "estimate"]);

    // Its grams changed a day later: priced from the figures the meal carries, with no table to ask.
    const edited = await inject("PATCH", `/v1/nutrition/meals/${meal.id}`, alice, { items: [{ canonical: "est_qwzx_fritter", grams: 240 }, { canonical: "dal_lentil_curry", grams: 132 }] });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(mealOf(edited.body).items[0]).toMatchObject({ gramsPoint: 240, kcalPoint: 600, proteinG: 12, carbsG: 60, fatG: 34, per100g: meal.items[0]?.per100g });
    expect((await inject("GET", `/v1/nutrition/meals/${meal.id}`, alice)).json<{ meal: Meal }>().meal.totals.kcalPoint).toBe(600 + 191);

    // A stranger can neither read the meal nor change it.
    expect((await inject("GET", `/v1/nutrition/meals/${meal.id}`, bob)).statusCode).toBe(404);
    expect((await inject("PATCH", `/v1/nutrition/meals/${meal.id}`, bob, { items: [{ canonical: "est_qwzx_fritter", grams: 1 }] })).statusCode).toBe(404);
    expect((await inject("GET", `/v1/nutrition/meals/${meal.id}`, alice)).json<{ meal: Meal }>().meal.items[0]?.gramsPoint).toBe(240);
  }, 60_000);

  it("never prices an estimate by name: not in a new meal, a preview, or another meal", async () => {
    const takenAt = new Date().toISOString();
    const manual = await inject("POST", "/v1/nutrition/meals", alice, { mealName: "Forged", takenAt, items: [{ canonical: "est_qwzx_fritter", grams: 100 }] });
    expect([manual.statusCode, manual.json<{ error: string }>().error]).toEqual([400, "unknown_food"]);
    const preview = await inject("POST", "/v1/nutrition/meals/preview", alice, { items: [{ canonical: "est_qwzx_fritter", grams: 100 }] });
    expect([preview.statusCode, preview.json<{ error: string }>().error]).toEqual([400, "unknown_food"]);
    // Bob's own meal cannot take in Alice's estimate: its figures are hers, and only her meal carries them.
    const own = await inject("POST", "/v1/nutrition/meals", bob, { mealName: "Bob's dal", takenAt, items: [{ canonical: "dal_lentil_curry", grams: 100 }] });
    expect(own.statusCode, own.body).toBe(201);
    const borrowed = await inject("PATCH", `/v1/nutrition/meals/${mealOf(own.body).id}`, bob, { items: [{ canonical: "dal_lentil_curry", grams: 100 }, { canonical: "est_qwzx_fritter", grams: 100 }] });
    expect([borrowed.statusCode, borrowed.json<{ error: string }>().error]).toEqual([400, "unknown_food"]);
  }, 60_000);

  // Each test below scans as a person of its own: a free account has two scans a day.
  it("names a food nothing has and the model gave no usable number for, and prices nothing for it", async () => {
    // 500 kcal with no protein, carbohydrate or fat behind it is no number.
    const sheet = await scan(await session("scan7b-carol@example.com"), plate(seen("Qwzx vlorp", "qwzx vlorp", [100, 500, 0, 0, 0]), seen("Qwzx blank", "qwzx blank", null), DAL));
    expect(sheet.items.map((i) => i.canonical)).toEqual(["dal_lentil_curry"]);
    expect(sheet.unknownItems).toEqual(["Qwzx vlorp", "Qwzx blank"]);
  }, 60_000);

  it("gives a table food three times from the model's own energy way to the estimate", async () => {
    // What the model called dal carries 450 kcal per 100 g; our list's dal carries 145.
    const sheet = await scan(await session("scan7b-dan@example.com"), plate(seen("Dal makhani", "dal", [100, 450, 10, 50, 23])));
    expect(sheet.items).toHaveLength(1);
    expect(sheet.items[0]).toMatchObject({ name: "Dal makhani", canonical: "est_dal_makhani", nutritionSource: "estimate", gramsPoint: 100, kcalPoint: 450 });
  }, 60_000);

  it("prices a food our list lacks from the USDA table, served by the grams the model saw, not by USDA's measure", async () => {
    const erin = await session("scan7b-erin@example.com");
    // Three pieces the model saw at 180 g: USDA's own measure is one cup of 240 g, so
    // the old rule's cup times the count would read 720 g, and the measure alone 240.
    const sheet = await scan(erin, plate(seen("Zqxscanroute", "zqxscanroute", [180, 380, 19, 48, 12], { vessel: "plate", count: 3 })));
    expect(sheet.items).toHaveLength(1);
    expect(sheet.items[0]).toMatchObject({
      name: "Zqxscanroute, cooked", canonical: `usda_fndds_${String(USDA_ID)}`, nutritionSource: "usda",
      gramsPoint: 180, gramsRange: [180, 180], portionSource: "default", pieces: 3, kcalPoint: 383,
    });
    // With no grams from the model, USDA's measure, once, whatever the count.
    const unweighed = await scan(erin, plate(seen("Zqxscanroute", "zqxscanroute", null, { vessel: "plate", count: 2 })));
    expect(unweighed.items[0]).toMatchObject({ canonical: `usda_fndds_${String(USDA_ID)}`, gramsPoint: 240, pieces: null, kcalPoint: 511 });
  }, 60_000);

  it("asks the USDA table with the energy the model saw, so the entry it names is the one made the way the plate shows", async () => {
    const fay = await session("scan7b-fay@example.com");
    // 50 g at 8 kcal is 16 per 100 g: SR Legacy's raw entry, though the survey release comes first by the release rule.
    const seenRaw = await scan(fay, plate(seen("Zqxscanpick", "zqxscanpick", [50, 8, 0, 2, 0])));
    expect(seenRaw.items[0]).toMatchObject({ name: "Zqxscanpick, raw", canonical: `usda_sr_${String(RAW_ID)}`, gramsPoint: 50, kcalPoint: 8 });
    // With no energy to go by, the release rule: the survey release's pickled entry.
    const unseen = await scan(fay, plate(seen("Zqxscanpick", "zqxscanpick", null)));
    expect(unseen.items[0]).toMatchObject({ name: "Zqxscanpick, pickled", canonical: `usda_fndds_${String(PICKLED_ID)}` });
  }, 60_000);

  // ── Kd's eight plates (2026-09-16) ─────────────────────────────────────────
  // The model's replies to his eight photos, as it wrote them on 2026-09-16 with
  // this card's prompt (the text only; no photo is in the repository), scanned
  // through the route: our list as it is, no packaged products, and the USDA rows
  // above — so a change to how a food is looked up, priced or portioned shows here
  // as a diff. Our list's portions keep the rule they had before this card until
  // 7a-iv (Kd, RULINGS 2026-09-16): bacon 100 g where the model saw 30.
  describe("Kd's eight plates", () => {
    const PLATES = join(import.meta.dirname, "fixtures", "plates");
    /** Each row as the sheet shows it: name, tag, grams, kcal, the stepper's pieces. */
    type Row = [string, string, number, number, number | null];
    const EXPECTED: Record<string, Row[]> = {
      // The toast plate: every food is on the sheet, and the latte, which no table
      // names, is the model's own figures.
      "download-1.json": [
        ["French bread / sourdough", "curated", 100, 272, 2], ["Avocado", "curated", 100, 160, null], ["Egg (fried)", "curated", 50, 98, 1],
        ["Bacon (cooked)", "curated", 100, 548, null], ["Brie", "curated", 28, 94, null], ["Ham (sliced)", "curated", 28, 46, 1],
        ["Apple", "curated", 180, 94, 1], ["Almonds", "curated", 28, 162, null], ["latte", "estimate", 240, 130, 1],
      ],
      // The model saw iced coffee at 40 kcal per 100 g: USDA's brewed one (1) and its
      // decaffeinated one (0) are other drinks, and the pre-lightened one (31) agrees.
      "download-2.json": [
        ["avocado toast with egg", "estimate", 220, 380, 1], ["Asparagus (cooked)", "curated", 100, 22, null], ["cherry tomatoes", "estimate", 60, 11, 6],
        ["Pork sausage (cooked)", "curated", 46, 150, 2], ["Shrimp (cooked)", "curated", 100, 99, null], ["Iced Coffee, pre-lightened and pre-sweetened", "usda", 200, 62, 1],
      ],
      // Pumpkin at the 60 g the model saw, in its two pieces — not USDA's cup twice (460 g).
      "download-3.json": [
        ["Chicken breast (cooked)", "curated", 100, 165, null], ["Shrimp (cooked)", "curated", 100, 99, null], ["Egg (whole, large)", "curated", 50, 72, 1],
        ["Broccoli (cooked)", "curated", 100, 35, null], ["Corn (cooked)", "curated", 100, 96, null], ["Pumpkin, cooked", "usda", 60, 31, 2],
        ["Orange juice", "curated", 240, 108, 1],
      ],
      // Two lemon wedges at 40 g, not USDA's whole fruit (65 g).
      "download-4.json": [
        ["Salmon (cooked)", "curated", 100, 206, null], ["Roast potatoes", "curated", 100, 126, null], ["Broccoli (cooked)", "curated", 100, 35, null],
        ["Lemon, raw", "usda", 40, 12, 2],
      ],
      "download-5.json": [
        ["avocado toast", "estimate", 120, 280, 1], ["Eggs (scrambled)", "curated", 50, 75, 1], ["Strawberries", "curated", 100, 32, null],
      ],
      "download-6.json": [
        ["bread", "estimate", 60, 160, 2], ["Peanut butter", "curated", 32, 191, null], ["Jam", "curated", 20, 56, null],
        ["Avocado", "curated", 100, 160, null], ["Eggs (scrambled)", "curated", 50, 75, 1], ["Blueberries", "curated", 100, 57, null],
        ["Raspberries", "curated", 100, 52, null],
      ],
      "download.json": [
        ["banana toast", "estimate", 220, 450, 1], ["egg bacon toast", "estimate", 250, 420, 1], ["Iced Coffee, pre-lightened and pre-sweetened", "usda", 250, 78, 1],
      ],
      "minimalist-meal-planner-inspiration-idea-120.json": [
        ["Egg (hard-boiled)", "curated", 150, 233, 3], ["Roast potatoes", "curated", 100, 126, null], ["Chicken breast (cooked)", "curated", 100, 165, null],
        ["Corn (cooked)", "curated", 100, 96, null], ["Broccoli (cooked)", "curated", 100, 35, null],
      ],
    };
    const files = readdirSync(PLATES).filter((name) => name.endsWith(".json")).sort();
    const replyOf = (file: string): VisionEvidence => mealVisionEvidenceSchema.parse(JSON.parse(readFileSync(join(PLATES, file), "utf8")));
    // An app of their own, over the same database and the same model replies: a store
    // of its own, so the eight people scanning here count against no sign-in limit the
    // tests above share (twenty requests an address).
    let platesApp: App | undefined;
    const plates = (): App => { if (platesApp === undefined) throw new Error("beforeAll did not run"); return platesApp; };
    beforeAll(async () => {
      platesApp = await buildApp(loadConfig(env), { redis: createMemoryRedis(), nutrition: { visionProvider: vision, foodSearchProvider: packagedSearch } });
    }, 60_000);
    afterAll(async () => {
      if (platesApp !== undefined) await platesApp.close();
    });

    it("are all here, each a reply the schema reads", () => {
      expect(files).toEqual(Object.keys(EXPECTED).sort());
      for (const file of files) expect(mealVisionEvidenceSchema.safeParse(JSON.parse(readFileSync(join(PLATES, file), "utf8"))).success, file).toBe(true);
    });

    for (const [at, [file, rows]] of Object.entries(EXPECTED).entries()) {
      it(`${file}: every food the model saw is on the sheet, as pinned, and priced as the confirm will price it`, async () => {
        const evidence = replyOf(file);
        const access = await sessionOn(plates(), `scan7b-plate-${String(at)}@example.com`);
        const sheet = await scanOn(plates(), access, evidence);
        expect(sheet.items.map((i): Row => [i.name, i.nutritionSource, i.gramsPoint, i.kcalPoint, i.pieces])).toEqual(rows);
        // Nothing is dropped: every food the model listed is a row, and nothing is named as left out.
        expect(sheet.unknownItems).toEqual([]);
        expect(sheet.items).toHaveLength(evidence.items.length);
        // An estimate row carries its figures, and at the model's grams its kcal is the model's own.
        for (const [i, row] of sheet.items.entries()) {
          if (row.nutritionSource === "estimate") {
            expect(row.canonical.startsWith("est_"), row.name).toBe(true);
            expect(row.per100g, row.name).toBeDefined();
            expect(row.kcalPoint, row.name).toBe(evidence.items[i]?.kcal);
          } else {
            expect(row.per100g, row.name).toBeUndefined();
          }
        }
        // The draft behind the sheet holds the same foods: priced at the sheet's grams, each row is what the sheet shows.
        const res = await injectOn(plates(), "POST", "/v1/nutrition/meals/preview", access, { scanToken: sheet.scanToken, items: sheet.items.map((i) => ({ canonical: i.canonical, grams: i.gramsPoint })) });
        expect(res.statusCode, res.body).toBe(200);
        const preview = mealPreviewSchema.parse(res.json());
        expect(preview.items.map((i) => [i.name, i.nutritionSource, i.gramsPoint, i.kcalPoint])).toEqual(rows.map(([name, source, grams, kcal]) => [name, source, grams, kcal]));
      }, 60_000);
    }
  });
});
