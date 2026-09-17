// ROADMAP 7a-iii-b — the scanner prices every food it sees, through the routes a
// person uses: scanned, corrected, saved, edited later, and unreachable by anyone
// else. A food no table has is the model's own estimate; a table food whose
// energy is three times from what the model saw is another food, and gives way.
// ROADMAP 7a-iv-b — each row starts at one of its food's own measures where the
// photo's count of it weighs near what the photo saw, else at the photo's grams.
// The test plates — Kd's eight and PR #71's review cases — run through the same
// route and the same lookups.
//
// The foods here carry nonsense words ("qwzx…", "zqxscanroute"), and every USDA
// fixture is keyed above 90,000,000, so this file answers the same whether or not
// the machine has had `tools/import-usda.ts` run against it. The eight plates'
// USDA rows are the real ones, copied whole (below): on a machine with the table
// loaded, a real row and its copy tie on everything but the id, and the sheet
// shows the same food either way. The USDA entries our list's foods on the plates
// cite are the real ones under their own ids (fixtures/usda-plate-foods.json),
// written only where the table does not hold them and removed only if written.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { z } from "zod";
import { mealPhotoAnalysisSchema, mealPreviewSchema, mealSchema, mealVisionEvidenceSchema, type Meal, type MealPhotoAnalysis, type MealPhotoItem, type VisionEvidence, type VisionItem } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import type { FoodSearchProvider } from "../src/modules/nutrition/openfoodfacts.adapter.js";
import type { VisionProvider } from "../src/modules/nutrition/vision.adapter.js";
import * as repo from "../src/modules/nutrition/repo.js";
import { importUsda } from "../tools/usda-table.js";
import { USDA_NUTRIENTS, type UsdaEntry, type UsdaNutrient, type UsdaPortion, type UsdaRelease } from "../tools/usda-files.js";

const sentry = vi.hoisted(() => ({ init: vi.fn(), captureException: vi.fn(), httpIntegration: vi.fn() }));
vi.mock("@sentry/node", () => sentry);
// The USDA measures read, counted and passed through to the real one: a photo sheet's
// preview reads them once, not once a row (the review of PR #76, L4).
vi.mock("../src/modules/nutrition/repo.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/modules/nutrition/repo.js")>();
  return { ...real, usdaPortionsFor: vi.fn(real.usdaPortionsFor) };
});

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

/** Every household measure, as the loaded table holds them, of the three USDA foods
 *  the eight plates' sheets show: a row starts at one of them, so the copy carries
 *  them all, under USDA's own numbers. */
const PICKED_USDA_PORTIONS: ReadonlyMap<string, readonly UsdaPortion[]> = new Map([
  ["Pumpkin, cooked", [{ seqNum: 1, amount: null, unit: "1 cup", gramWeight: 230 }, { seqNum: 2, amount: null, unit: "1 cup, mashed", gramWeight: 250 }]],
  ["Lemon, raw", [{ seqNum: 1, amount: null, unit: "1 fruit", gramWeight: 65 }, { seqNum: 2, amount: null, unit: "1 slice or wedge", gramWeight: 8 }, { seqNum: 3, amount: null, unit: "1 cup", gramWeight: 200 }]],
  ["Iced Coffee, pre-lightened and pre-sweetened", [
    { seqNum: 1, amount: null, unit: "1 fl oz", gramWeight: 31 }, { seqNum: 2, amount: null, unit: "1 cup (8 fl oz)", gramWeight: 248 },
    { seqNum: 3, amount: null, unit: "1 small", gramWeight: 372 }, { seqNum: 4, amount: null, unit: "1 medium", gramWeight: 496 },
    { seqNum: 5, amount: null, unit: "1 large", gramWeight: 620 },
  ]],
]);

/** A USDA fixture: the four figures a meal is priced from and fibre, the rest
 *  unmeasured, served by one household measure, or by the measures given. */
const usdaFixture = (fdcId: number, description: string, [kcal, protein, carbs, fat, fiber]: readonly [number, number, number, number, number | null], [grams, unit]: readonly [number, string], portions?: readonly UsdaPortion[]): UsdaEntry => {
  const figures = new Map<UsdaNutrient, number | null>(USDA_NUTRIENTS.map((n) => [n.key, null]));
  for (const [key, value] of [["kcal", kcal], ["proteinG", protein], ["carbsG", carbs], ["fatG", fat], ["fiberG", fiber]] as const) figures.set(key, value);
  return { fdcId, description, figures, portions: portions === undefined ? [{ seqNum: 1, amount: 1, unit, gramWeight: grams }] : [...portions] };
};

/** The USDA entries our list's foods on the plates cite (fixtures/usda-plate-foods.json). */
const citedUsdaSchema = z.object({
  foods: z.array(z.object({
    fdcId: z.number().int(), release: z.enum(["fndds", "sr_legacy"]), description: z.string(),
    figures: z.tuple([z.number(), z.number(), z.number(), z.number(), z.number().nullable()]),
    portions: z.array(z.tuple([z.number().int(), z.number().nullable(), z.string(), z.number()])),
  }).strict()),
});
const CITED_USDA = citedUsdaSchema.parse(JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "usda-plate-foods.json"), "utf8"))).foods;

/** No packaged product for any food scanned here — but a search for an estimate's
 *  canonical answers, as the live search answers almost any text, so a request that
 *  let an est_ canonical reach it would price a forged estimate as that product. */
const packagedSearch: FoodSearchProvider = {
  search: (query) => Promise.resolve(query.startsWith("est_")
    ? [{ canonical: "off_forged", name: "Forged product", kcal: 250, proteinG: 5, carbsG: 25, fatG: 14, fiberG: null, serving: 100, unit: "g", source: "openfoodfacts" }]
    : []),
};

/** A food as the scanner reads the model's list, figures as given. */
const seen = (name: string, hint: string, figures: [grams: number, kcal: number, protein: number, carbs: number, fat: number] | null, more: { count?: number } = {}): VisionItem => ({
  name, canonical_hint: hint, count: more.count ?? null,
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
// Our list's dal (145 kcal per 100 g), which the model saw at 150 g and did not count:
// the row starts at those 150 g, 218 kcal — never a dish the person saved.
const DAL = seen("Dal", "dal", [150, 170, 9, 25, 4]);

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
  /** The cited entries this run wrote, because the table did not hold them. */
  let wroteCited: number[] = [];
  const clean = async (): Promise<void> => {
    await sql`DELETE FROM meal_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'scan7b-%@example.com')`;
    await sql`DELETE FROM api_cost_events WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'scan7b-%@example.com')`;
    await sql`DELETE FROM users WHERE email LIKE 'scan7b-%@example.com'`;
    await sql`DELETE FROM usda_food_portions WHERE fdc_id BETWEEN ${USDA_ID} AND ${LAST_ID}`;
    await sql`DELETE FROM usda_foods WHERE fdc_id BETWEEN ${USDA_ID} AND ${LAST_ID}`;
    if (wroteCited.length > 0) {
      await sql`DELETE FROM usda_food_portions WHERE fdc_id = ANY(${wroteCited}::int[])`;
      await sql`DELETE FROM usda_foods WHERE fdc_id = ANY(${wroteCited}::int[])`;
      wroteCited = [];
    }
  };

  beforeAll(async () => {
    await clean();
    const figures = new Map<UsdaNutrient, number | null>(USDA_NUTRIENTS.map((n, at) => [n.key, at + 1]));
    for (const [key, value] of [["kcal", 213], ["proteinG", 11.5], ["carbsG", 27.3], ["fatG", 6.4]] as const) figures.set(key, value);
    const plateRows = (release: UsdaRelease): UsdaEntry[] => PLATE_USDA_ROWS.flatMap(([r, description, kcal, protein, carbs, fat, fiber, grams, unit], at) =>
      r === release ? [usdaFixture(PLATE_ROWS_FROM + at, description, [kcal, protein, carbs, fat, fiber], [grams, unit], PICKED_USDA_PORTIONS.get(description))] : []);
    const held = new Set((await sql<{ fdc_id: number }[]>`SELECT fdc_id FROM usda_foods WHERE fdc_id = ANY(${CITED_USDA.map((f) => f.fdcId)}::int[])`).map((r) => r.fdc_id));
    const cited = CITED_USDA.filter((f) => !held.has(f.fdcId));
    wroteCited = cited.map((f) => f.fdcId);
    const citedRows = (release: UsdaRelease): UsdaEntry[] => cited.flatMap((f) => (f.release !== release ? [] : [
      usdaFixture(f.fdcId, f.description, f.figures, [0, ""], f.portions.map(([seqNum, amount, unit, gramWeight]) => ({ seqNum, amount, unit, gramWeight }))),
    ]));
    await importUsda(sql, [
      ["fndds", [
        { fdcId: USDA_ID, description: "Zqxscanroute, cooked", figures, portions: [{ seqNum: 1, amount: null, unit: "1 cup", gramWeight: 240 }] },
        usdaFixture(PICKLED_ID, "Zqxscanpick, pickled", [34, 0.9, 7, 0.2, 1.6], [150, "cup"]),
        ...plateRows("fndds"),
        ...citedRows("fndds"),
      ]],
      ["sr_legacy", [usdaFixture(RAW_ID, "Zqxscanpick, raw", [16, 0.68, 3.4, 0.1, 1.6], [116, "cup slices"]), ...plateRows("sr_legacy"), ...citedRows("sr_legacy")]],
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

  it("lists a food no table has as the model's estimate, corrected, saved and changed later at its own figures", async () => {
    const sheet = await scan(alice, plate(FRITTER, DAL));
    expect(sheet.unknownItems).toEqual([]);
    const [fritter, dal] = sheet.items;
    // An estimate has only grams and ounces, so it starts at the grams the model saw.
    expect(fritter).toMatchObject({
      name: "Qwzx fritter", canonical: "est_qwzx_fritter", nutritionSource: "estimate", portionSource: "default",
      gramsPoint: 120, gramsRange: [120, 120], kcalPoint: 300, proteinG: 6, carbsG: 30, fatG: 17,
      measures: [{ id: "g", name: "g", grams: 1 }, { id: "oz", name: "oz", grams: 28.349523125 }], startsAt: { measure: "g", amount: 120 }, portionEstimated: true,
    });
    expect(fritter?.per100g?.kcal).toBe(250);
    // Our list's dal starts at the grams the model saw too: nothing counted, and no katori read.
    expect(dal).toMatchObject({ name: "Dal (lentil curry)", canonical: "dal_lentil_curry", nutritionSource: "curated", gramsPoint: 150, kcalPoint: 218, startsAt: { measure: "g", amount: 150 }, portionEstimated: true });
    expect(dal?.per100g).toBeUndefined();

    // Half the fritters, by the measure the sheet sends: the server prices the estimate at its own figures.
    const preview = await inject("POST", "/v1/nutrition/meals/preview", alice, { scanToken: sheet.scanToken, items: [{ canonical: "est_qwzx_fritter", measure: "g", amount: 60 }, { canonical: "dal_lentil_curry", measure: "g", amount: 150 }] });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json<{ items: { kcalPoint: number; proteinG: number; fatG: number }[] }>().items[0]).toMatchObject({ kcalPoint: 150, proteinG: 3, fatG: 8.5 });
    // An estimate is served by the grams the photo saw, which no measure of it names.
    const byServing = await inject("POST", "/v1/nutrition/meals/preview", alice, { scanToken: sheet.scanToken, items: [{ canonical: "est_qwzx_fritter", measure: "serving", amount: 1 }] });
    expect([byServing.statusCode, byServing.json<{ error: string }>().error]).toEqual([400, "unknown_measure"]);

    // An estimate the scan never gave is no food: the confirm is refused, and the scan survives it.
    const forged = await inject("POST", "/v1/nutrition/meals", alice, { scanToken: sheet.scanToken, takenAt: new Date().toISOString(), items: [{ canonical: "est_qwzx_fritter", grams: 180 }, { canonical: "est_qwzx_forged", grams: 100 }] });
    expect(forged.statusCode, forged.body).toBe(400);
    expect(forged.json<{ error: string }>().error).toBe("unknown_food");

    const saved = await inject("POST", "/v1/nutrition/meals", alice, { scanToken: sheet.scanToken, takenAt: new Date().toISOString(), items: [{ canonical: "est_qwzx_fritter", measure: "oz", amount: 6 }, { canonical: "dal_lentil_curry", measure: "g", amount: 150 }] });
    expect(saved.statusCode, saved.body).toBe(201);
    const meal = mealOf(saved.body);
    // Six ounces are 170 g of fritter at 250 kcal per 100 g.
    expect(meal.items[0]).toMatchObject({ canonical: "est_qwzx_fritter", nutritionSource: "estimate", gramsPoint: 170, kcalPoint: 425, proteinG: 8.5, carbsG: 42.5, fatG: 24.1, measure: { id: "oz", name: "oz", amount: 6 } });
    expect(meal.nutritionSources.sort()).toEqual(["curated", "estimate"]);

    // Its grams changed a day later: priced from the figures the meal carries, with no table to ask.
    const edited = await inject("PATCH", `/v1/nutrition/meals/${meal.id}`, alice, { items: [{ canonical: "est_qwzx_fritter", grams: 240 }, { canonical: "dal_lentil_curry", grams: 150 }] });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(mealOf(edited.body).items[0]).toMatchObject({ gramsPoint: 240, kcalPoint: 600, proteinG: 12, carbsG: 60, fatG: 34, per100g: meal.items[0]?.per100g });
    expect((await inject("GET", `/v1/nutrition/meals/${meal.id}`, alice)).json<{ meal: Meal }>().meal.totals.kcalPoint).toBe(600 + 218);

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

  it("never weighs a scanned food by a saved dish the person did not pick (RULINGS 2026-07-18)", async () => {
    const gus = await session("scan7b-gus@example.com");
    // The web's Medium bowl is saved as Appendix B's standard katori, which is what a
    // katori the model named once read as — so a scan used to weigh this dal as 400 ml.
    const dish = await inject("POST", "/v1/nutrition/dishware", gus, { label: "Medium bowl", containerClass: "standard_katori", volumeMl: 400 });
    expect(dish.statusCode, dish.body).toBe(201);
    const sheet = await scan(gus, plate(DAL));
    // The grams the model saw, as for a person with no dish saved: 150 g, never the dish's.
    expect(sheet.items[0]).toMatchObject({ canonical: "dal_lentil_curry", gramsPoint: 150, portionSource: "default", startsAt: { measure: "g", amount: 150 } });
    // Nor is the dish one of the measures a count starts a row at (the review of PR
    // #76): one dal the model saw at 350 g is within 30 % of the 400 g the dish
    // holds of dal (its cup is 240 g, a gram a millilitre), and of no measure the
    // dal has (one 240 g cup is 110 g off) — so it starts at the photo's grams.
    const counted = await scan(gus, plate(seen("Dal", "dal", [350, 508, 21, 58, 9], { count: 1 })));
    expect(counted.items[0]).toMatchObject({ canonical: "dal_lentil_curry", gramsPoint: 350, startsAt: { measure: "g", amount: 350 }, portionEstimated: true });
    expect(counted.items[0]?.measures.map((m) => m.id)).not.toContain("dish");
  }, 60_000);

  it("gives a table food three times from the model's own energy way to the estimate", async () => {
    // What the model called dal carries 450 kcal per 100 g; our list's dal carries 145.
    const sheet = await scan(await session("scan7b-dan@example.com"), plate(seen("Dal makhani", "dal", [100, 450, 10, 50, 23])));
    expect(sheet.items).toHaveLength(1);
    expect(sheet.items[0]).toMatchObject({ name: "Dal makhani", canonical: "est_dal_makhani", nutritionSource: "estimate", gramsPoint: 100, kcalPoint: 450 });
  }, 60_000);

  it("prices a food our list lacks from the USDA table, and starts it at USDA's own measure only where the photo's count of it agrees with the grams", async () => {
    const erin = await session("scan7b-erin@example.com");
    const route = `usda_fndds_${String(USDA_ID)}`;
    const measures = [{ id: "usda-1", name: "cup", grams: 240 }, { id: "g", name: "g", grams: 1 }, { id: "oz", name: "oz", grams: 28.349523125 }];
    // Three pieces the model saw at 180 g, and one at 250 g, in one photo: three of
    // USDA's 240 g cup are 720 g, so the first starts at its 180 g, an estimate; one
    // cup is near 250 g, so the second starts at it.
    const sheet = await scan(erin, plate(
      seen("Zqxscanroute", "zqxscanroute", [180, 380, 19, 48, 12], { count: 3 }),
      seen("Zqxscanroute", "zqxscanroute", [250, 530, 27, 67, 17], { count: 1 }),
    ));
    expect(sheet.items).toHaveLength(2);
    expect(sheet.items[0]).toMatchObject({
      name: "Zqxscanroute, cooked", canonical: route, nutritionSource: "usda",
      gramsPoint: 180, gramsRange: [180, 180], portionSource: "default", kcalPoint: 383, measures, startsAt: { measure: "g", amount: 180 }, portionEstimated: true,
    });
    expect(sheet.items[1]).toMatchObject({ canonical: route, gramsPoint: 240, kcalPoint: 511, measures, startsAt: { measure: "usda-1", amount: 1 }, portionEstimated: false });
    // Priced as the sheet sends it, by the measure each row starts at, each is what the sheet shows.
    const preview = await inject("POST", "/v1/nutrition/meals/preview", erin, { scanToken: sheet.scanToken, items: sheet.items.map((i) => ({ canonical: i.canonical, measure: i.startsAt.measure, amount: i.startsAt.amount })) });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(mealPreviewSchema.parse(preview.json()).items.map((i) => [i.gramsPoint, i.kcalPoint])).toEqual([[180, 383], [240, 511]]);
    // With no grams from the model, where Add food starts it — USDA's first measure, once, whatever the count — marked an estimate.
    const unweighed = await scan(erin, plate(seen("Zqxscanroute", "zqxscanroute", null, { count: 2 })));
    expect(unweighed.items[0]).toMatchObject({ canonical: route, gramsPoint: 240, kcalPoint: 511, startsAt: { measure: "usda-1", amount: 1 }, portionEstimated: true });
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

  // ── The test plates ─────────────────────────────────────────────────────────
  // Kd's eight plates are the model's replies to his eight photos, as it wrote them
  // on 2026-09-16 with 7a-iii-b's prompt (the text only; no photo is in the
  // repository), with the vessel, fill and size slots that prompt asked for taken
  // out (ROADMAP 7a-iv-d), so every row pinned below is the one those replies gave
  // before. The review plates are the cases PR #71's four reviews found in the
  // old portion code, which read the words of a food's name, written as the model's
  // form writes them: a count of whole pieces and the grams it saw. What a count of
  // cut bits, a container or a serving word once did to a portion is now the grams'
  // to say (ROADMAP 7a-iv-b). Each plate is scanned through the route — our list as
  // it is, no packaged products, and the USDA rows above — so a change to how a food
  // is looked up, priced or started shows here as a diff, and a new finding is a new
  // plate, never a new word list (RULINGS 2026-09-15).
  describe("the test plates", () => {
    const PLATES = join(import.meta.dirname, "fixtures", "plates");
    /** Each row as the sheet shows it: name, tag, where it starts — "2 × slice", or
     *  "~60 g" at the photo's own grams, an estimate — and its grams and kcal. */
    type Row = [string, string, string, number, number];
    const startOf = (row: MealPhotoItem): string => {
      const measure = row.measures.find((m) => m.id === row.startsAt.measure);
      return row.portionEstimated ? `~${String(row.gramsPoint)} g` : `${String(row.startsAt.amount)} × ${measure?.name ?? "no measure"}`;
    };
    const EXPECTED: Record<string, Row[]> = {
      // The toast plate: every food is on the sheet, and the latte, which no table
      // names, is the model's own figures. Bacon starts at the 30 g the photo saw, no
      // longer our list's 100 g (RULINGS 2026-09-16); ten grams of almonds counted 1
      // are no one 1 g almond (RULINGS 2026-09-17).
      "download-1.json": [
        ["French bread / sourdough", "curated", "2 × slice", 100, 272], ["Avocado", "curated", "1 × NLEA Serving", 50, 80], ["Egg (fried)", "curated", "1 × egg", 46, 90],
        ["Bacon (cooked)", "curated", "~30 g", 30, 164], ["Brie", "curated", "~50 g", 50, 167], ["Ham (sliced)", "curated", "1 × slice", 28, 46],
        ["Apple", "curated", "~40 g", 40, 21], ["Almonds", "curated", "~10 g", 10, 58], ["latte", "estimate", "~240 g", 240, 130],
      ],
      // The model saw iced coffee at 40 kcal per 100 g: USDA's brewed one (1) and its
      // decaffeinated one (0) are other drinks, and the pre-lightened one (31) agrees;
      // one of its 248 g cups is near the 200 g the photo saw.
      "download-2.json": [
        ["avocado toast with egg", "estimate", "~220 g", 220, 380], ["Asparagus (cooked)", "curated", "~60 g", 60, 13], ["cherry tomatoes", "estimate", "~60 g", 60, 11],
        ["Pork sausage (cooked)", "curated", "2 × serving", 96, 312], ["Shrimp (cooked)", "curated", "~75 g", 75, 74], ["Iced Coffee, pre-lightened and pre-sweetened", "usda", "1 × cup (8 fl oz)", 248, 77],
      ],
      // Pumpkin at the 60 g the model saw in its two pieces: two of USDA's cups are 460 g.
      "download-3.json": [
        ["Chicken breast (cooked)", "curated", "~150 g", 150, 248], ["Shrimp (cooked)", "curated", "~90 g", 90, 89], ["Egg (whole, large)", "curated", "1 × egg", 50, 72],
        ["Broccoli (cooked)", "curated", "~60 g", 60, 21], ["Corn (cooked)", "curated", "~50 g", 50, 48], ["Pumpkin, cooked", "usda", "~60 g", 60, 31],
        ["Orange juice", "curated", "1 × cup", 248, 112],
      ],
      // Two lemon wedges at 40 g: two of USDA's 8 g wedges are 16 g.
      "download-4.json": [
        ["Salmon (cooked)", "curated", "2 × half fillet", 356, 733], ["Roast potatoes", "curated", "~200 g", 200, 252], ["Broccoli (cooked)", "curated", "~150 g", 150, 53],
        ["Lemon, raw", "usda", "~40 g", 40, 12],
      ],
      // 100 g of scrambled eggs are no large egg of 61 g (RULINGS 2026-09-16).
      "download-5.json": [
        ["avocado toast", "estimate", "~120 g", 120, 280], ["Eggs (scrambled)", "curated", "~100 g", 100, 149], ["Strawberries", "curated", "1 × cup, halves", 152, 49],
      ],
      "download-6.json": [
        ["bread", "estimate", "~60 g", 60, 160], ["Peanut butter", "curated", "1 × 2 tbsp", 32, 191], ["Jam", "curated", "1 × tbsp", 20, 56],
        ["Avocado", "curated", "1 × NLEA Serving", 50, 80], ["Eggs (scrambled)", "curated", "~120 g", 120, 179], ["Blueberries", "curated", "~50 g", 50, 29],
        ["Raspberries", "curated", "~40 g", 40, 21],
      ],
      // A 250 g mug of iced coffee is one of its 248 g cups, never USDA's 496 g "medium".
      "download.json": [
        ["banana toast", "estimate", "~220 g", 220, 450], ["egg bacon toast", "estimate", "~250 g", 250, 420], ["Iced Coffee, pre-lightened and pre-sweetened", "usda", "1 × cup (8 fl oz)", 248, 77],
      ],
      "minimalist-meal-planner-inspiration-idea-120.json": [
        ["Egg (hard-boiled)", "curated", "3 × egg", 150, 233], ["Roast potatoes", "curated", "~120 g", 120, 151], ["Chicken breast (cooked)", "curated", "1 × cup, chopped or diced", 140, 231],
        ["Corn (cooked)", "curated", "1 × ear medium (6-3/4\" to 7-1/2\" long)", 103, 99], ["Broccoli (cooked)", "curated", "1 × half cup, chopped", 78, 27],
      ],
      // Whole pieces whose count agrees with the grams start at that many.
      "review-counts.json": [
        ["Chicken nuggets", "curated", "6 × nugget", 96, 295], // six 16 g nuggets, not one
        ["Chicken nuggets", "curated", "6 × nugget", 96, 295], // "nugget pieces" are nuggets
        ["Pizza (cheese)", "curated", "3 × slice", 321, 854],
        ["Egg (hard-boiled)", "curated", "2 × egg", 100, 155],
        ["Roti / Chapati (homemade flatbread, no fat)", "curated", "8 × roti", 320, 646], // a stack of eight is eight
        ["Almonds", "curated", "20 × almond", 24, 139],
        ["Grapes", "curated", "~50 g", 50, 35], // ten grapes are no ten of USDA's "10 grapes"
        ["Coke / cola", "curated", "3 × can", 1110, 466],
        ["Pancakes", "curated", "3 × pancake", 150, 423],
        ["Ham (sliced)", "curated", "3 × slice", 84, 138],
        ["Whole wheat bread", "curated", "2 × slice", 64, 161],
        ["Banana bread", "curated", "2 × slice", 120, 391], // slices, not bananas
        ["Egg roll (vegetable, fried)", "curated", "2 × roll", 128, 346],
        ["Roti / Chapati (homemade flatbread, no fat)", "curated", "2 × roti", 80, 162], // the homemade one
        ["Veggie burger", "curated", "1 × patty", 100, 177], // its own patty, not an egg
      ],
      // A count of bits cut from a food, or of plates, is no count of the food: the grams say.
      "review-cut-bits.json": [
        ["Banana", "curated", "~60 g", 60, 53], // banana slices ×10, not ten bananas
        ["Banana", "curated", "~60 g", 60, 53], // sliced banana ×10
        ["Hot dog", "curated", "~100 g", 100, 296], // eight hot dog pieces, not eight hot dogs
        ["Beef stew", "curated", "~255 g", 255, 273], // six chunks, not six cups
        ["Tortilla (flour)", "curated", "~48 g", 48, 147], // twelve pieces of one tortilla
        ["Orange", "curated", "~130 g", 130, 61], // six segments of one orange
        ["Cheddar cheese", "curated", "~30 g", 30, 121], // ten cubes, not ten slices
        ["Egg (hard-boiled)", "curated", "~100 g", 100, 155], // four halves of two eggs
        ["Chicken nuggets", "curated", "~190 g", 190, 583], // two plates of nuggets, not two nuggets
        ["Palak paneer (spinach and cheese curry)", "curated", "~200 g", 200, 202], // eight cubes, not eight cups
        ["Apple", "curated", "~150 g", 150, 78], // eight slices, not eight apples
        ["Constructor", "estimate", "~50 g", 50, 50], // a name every object answers to
      ],
      // A vessel or a serving word in the name changes nothing: the grams say.
      "review-vessels.json": [
        ["Wine (red)", "curated", "1 × glass", 150, 128], // wine the photo saw at 150 g is its 150 g pour
        ["Coffee (black)", "curated", "~120 g", 120, 1], // a cup of coffee at 120 g: its 240 g cup is far
        ["Coffee (black)", "curated", "2 × cup", 480, 5], // two mugs at 650 g: two cups are within 30 %
        ["Beer (regular)", "curated", "3 × can", 1068, 459], // three mugs at 975 g
        ["Yogurt (plain, low-fat)", "curated", "2 × container", 340, 214], // two pots shown as cups
        ["Cereal (cornflakes)", "curated", "~45 g", 45, 164], // a bowl, never 375 g of water
        ["Cereal (cornflakes)", "curated", "~90 g", 90, 329], // two bowls, never 750 g
        ["Almonds", "curated", "1 × cup, whole", 143, 828], // their own cup, not 240 g
        ["Rice (white, cooked)", "curated", "1 × cup", 158, 205], // its own cup, not 240 g
        ["Dal (lentil curry)", "curated", "2 × cup", 480, 696], // two large bowls at 550 g
        ["Rice (white, cooked)", "curated", "~300 g", 300, 390], // three servings in a bowl
        ["Chicken nuggets", "curated", "6 × nugget", 96, 295], // six servings of nuggets are six nuggets
        ["Beef stew", "curated", "2 × cup", 510, 546], // two bowls of stew chunks at 510 g
        ["Ramen bowl", "curated", "~9800 g", 9800, 12446], // 25 bowls would weigh more than an item may
        ["Pho (beef)", "curated", "1 × bowl", 400, 308], // pho at 400 g is its bowl
        ["Smoothie (fruit)", "curated", "1 × glass", 324, 214],
      ],
    };
    const files = readdirSync(PLATES).filter((name) => name.endsWith(".json")).sort();
    const replyOf = (file: string): VisionEvidence => mealVisionEvidenceSchema.parse(JSON.parse(readFileSync(join(PLATES, file), "utf8")));
    // Apps of their own, over the same database and the same model replies: a store
    // each, so the people scanning here count against no sign-in limit the tests
    // above share (twenty requests an address) — Kd's eight on one, the review
    // plates on the other.
    let platesApp: App | undefined;
    let reviewApp: App | undefined;
    const appFor = (file: string): App => {
      const target = file.startsWith("review-") ? reviewApp : platesApp;
      if (target === undefined) throw new Error("beforeAll did not run");
      return target;
    };
    beforeAll(async () => {
      platesApp = await buildApp(loadConfig(env), { redis: createMemoryRedis(), nutrition: { visionProvider: vision, foodSearchProvider: packagedSearch } });
      reviewApp = await buildApp(loadConfig(env), { redis: createMemoryRedis(), nutrition: { visionProvider: vision, foodSearchProvider: packagedSearch } });
    }, 60_000);
    afterAll(async () => {
      if (platesApp !== undefined) await platesApp.close();
      if (reviewApp !== undefined) await reviewApp.close();
    });

    it("are all here, each a reply the schema reads", () => {
      expect(files).toEqual(Object.keys(EXPECTED).sort());
      for (const file of files) expect(mealVisionEvidenceSchema.safeParse(JSON.parse(readFileSync(join(PLATES, file), "utf8"))).success, file).toBe(true);
    });

    for (const [at, [file, rows]] of Object.entries(EXPECTED).entries()) {
      it(`${file}: every food the model saw is on the sheet, as pinned, and priced as the confirm will price it`, async () => {
        const evidence = replyOf(file);
        const target = appFor(file);
        const access = await sessionOn(target, `scan7b-plate-${String(at)}@example.com`);
        const sheet = await scanOn(target, access, evidence);
        if (process.env["PRINT_PLATES"] === "1") console.log(`PLATE ${file} ${JSON.stringify(sheet.items.map((i): Row => [i.name, i.nutritionSource, startOf(i), i.gramsPoint, i.kcalPoint]))}`);
        expect(sheet.items.map((i): Row => [i.name, i.nutritionSource, startOf(i), i.gramsPoint, i.kcalPoint])).toEqual(rows);
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
        // The draft behind the sheet holds the same foods and the same measures: sent as
        // the sheet sends each row, by the measure it starts at, each is what the sheet shows.
        const portionReads = vi.mocked(repo.usdaPortionsFor);
        portionReads.mockClear();
        const res = await injectOn(target, "POST", "/v1/nutrition/meals/preview", access, { scanToken: sheet.scanToken, items: sheet.items.map((i) => ({ canonical: i.canonical, measure: i.startsAt.measure, amount: i.startsAt.amount })) });
        expect(res.statusCode, res.body).toBe(200);
        // Every row goes by measure, and all their measures are ONE read.
        expect(portionReads).toHaveBeenCalledTimes(1);
        const preview = mealPreviewSchema.parse(res.json());
        expect(preview.items.map((i) => [i.name, i.nutritionSource, i.gramsPoint, i.kcalPoint])).toEqual(rows.map(([name, source, , grams, kcal]) => [name, source, grams, kcal]));
      }, 60_000);
    }
  });
});
