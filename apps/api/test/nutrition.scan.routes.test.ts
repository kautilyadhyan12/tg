// ROADMAP 7a-iii-b — the scanner prices every food it sees, through the routes a
// person uses: scanned, stepped, saved, edited later, and unreachable by anyone
// else. A food no table has is the model's own estimate; a table food whose
// energy is three times from what the model saw is another food, and gives way.
//
// The foods here carry nonsense words ("qwzx…", "zqxscanroute"), and the one
// USDA fixture is keyed above 90,000,000, so this file answers the same whether
// or not the machine has had `tools/import-usda.ts` run against it.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { z } from "zod";
import { mealPhotoAnalysisSchema, mealSchema, type Meal, type MealPhotoAnalysis, type MealVessel, type VisionEvidence, type VisionItem } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import type { FoodSearchProvider } from "../src/modules/nutrition/openfoodfacts.adapter.js";
import type { VisionProvider } from "../src/modules/nutrition/vision.adapter.js";
import { importUsda } from "../tools/usda-table.js";
import { USDA_NUTRIENTS, type UsdaNutrient } from "../tools/usda-files.js";

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

d("the scanner prices every food it sees (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 4 });
  const vision = scripted();
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let alice = "";
  let bob = "";

  const api = () => { if (app === undefined) throw new Error("beforeAll did not run"); return app; };
  const inject = (method: "GET" | "POST" | "PATCH", path: string, access: string, body?: unknown) =>
    api().inject({
      method, url: path,
      cookies: access === "" ? {} : { accessToken: access },
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(body) }),
    });
  const session = async (email: string): Promise<string> => {
    await inject("POST", "/v1/auth/register", "", { email, password: PASSWORD, displayName: "Scan fixture" });
    const login = await inject("POST", "/v1/auth/login", "", { email, password: PASSWORD });
    return login.cookies.find((c) => c.name === "accessToken")?.value ?? "";
  };
  const scan = async (access: string, evidence: VisionEvidence): Promise<MealPhotoAnalysis> => {
    vision.queue.push(evidence);
    const res = await inject("POST", "/v1/nutrition/analyze-photo", access, { imageBase64: jpeg, mimeType: "image/jpeg" });
    expect(res.statusCode, res.body).toBe(200);
    return mealPhotoAnalysisSchema.parse(res.json());
  };
  const mealOf = (body: string): Meal => mealSchema.parse(z.object({ meal: z.unknown() }).parse(JSON.parse(body)).meal);
  const clean = async (): Promise<void> => {
    await sql`DELETE FROM meal_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'scan7b-%@example.com')`;
    await sql`DELETE FROM api_cost_events WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'scan7b-%@example.com')`;
    await sql`DELETE FROM users WHERE email LIKE 'scan7b-%@example.com'`;
    await sql`DELETE FROM usda_food_portions WHERE fdc_id = ${USDA_ID}`;
    await sql`DELETE FROM usda_foods WHERE fdc_id = ${USDA_ID}`;
  };

  beforeAll(async () => {
    await clean();
    const figures = new Map<UsdaNutrient, number | null>(USDA_NUTRIENTS.map((n, at) => [n.key, at + 1]));
    for (const [key, value] of [["kcal", 213], ["proteinG", 11.5], ["carbsG", 27.3], ["fatG", 6.4]] as const) figures.set(key, value);
    await importUsda(sql, [["fndds", [{ fdcId: USDA_ID, description: "Zqxscanroute, cooked", figures, portions: [{ seqNum: 1, amount: null, unit: "1 cup", gramWeight: 240 }] }]]]);
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

  it("prices a food our list lacks from the USDA table, by the food's own name", async () => {
    const sheet = await scan(await session("scan7b-erin@example.com"), plate(seen("Zqxscanroute", "zqxscanroute", [240, 480, 24, 60, 16])));
    expect(sheet.items).toHaveLength(1);
    // USDA's own measure (1 cup, 240 g) is the portion, as a table food's portion always was until 7a-iv.
    expect(sheet.items[0]).toMatchObject({ name: "Zqxscanroute, cooked", canonical: `usda_fndds_${String(USDA_ID)}`, nutritionSource: "usda", gramsPoint: 240, kcalPoint: 511 });
  }, 60_000);
});
