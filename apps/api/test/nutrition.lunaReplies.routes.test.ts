// A badly formed reply from the scanner never shows a member a wrong food as if it
// were sure (ROADMAP 33a-iii). The replies go in where OpenAI's would, through the
// real adapter and the real scan route: five came back from Luna on real plates and
// failed a whole scan (fixtures/luna-replies-refused.json), the rest are the shapes
// beside them that nobody has seen yet.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { z } from "zod";
import { mealPhotoAnalysisSchema, type MealPhotoAnalysis } from "@app/shared";
import { buildApp } from "../src/app.js";
import type { FoodReference } from "../src/modules/nutrition/openfoodfacts.adapter.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import { createOpenAiVisionProvider } from "../src/modules/nutrition/vision.adapter.js";
import { MEAL_PHOTO } from "./fixtures/mealPhoto.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");
const PASSWORD = "luna-replies-test-password-1"; // gitleaks:allow
const EMAIL = "luna-replies@example.com";
const env = { NODE_ENV: "test", DATABASE_URL: url ?? "", WEB_ORIGIN: "http://localhost:5173", JWT_SECRET: "luna-replies-test-secret-0123456789-32", LOG_LEVEL: "error" }; // gitleaks:allow

const refused = z.array(z.object({ photo: z.string(), reply: z.unknown() })).parse(JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "luna-replies-refused.json"), "utf8")));
const realReply = (photo: string): unknown => {
  const found = refused.find((one) => one.photo === photo);
  if (found === undefined) throw new Error(`no reply for ${photo}`);
  return found.reply;
};

/** Dal the tables have, with the figures a plate of it carries. */
const DAL = ["dal", "dal", null, 150, 170, 9, 25, 4];
/** What each real reply puts on the sheet: name, and where its numbers are from. A table food's calories follow the measure its row starts at, which USDA's table changes where it is loaded, so only an estimate's are pinned, by the test of its own below. The first row of the second plate is USDA's where that table is loaded and the model's estimate where it is not, as on GitHub. */
const REAL_ROWS: Record<string, unknown[]> = {
  "dish_1561574783.png": [["Leafy green salad", "estimate"]],
  "dish_1559157919.png": [[expect.stringMatching(/^Mixed (salad )?greens/), expect.stringMatching(/^(usda|estimate)$/)], ["Spinach (raw)", "curated"], ["Blueberries", "curated"], ["Walnuts", "curated"]],
  "dish_1564689168.png": [["Salad (green, no dressing)", "curated"], ["Chickpeas (cooked)", "curated"], ["Paneer (Indian cottage cheese)", "curated"], ["Cucumber", "curated"], ["Red onion", "estimate"], ["Tomato", "curated"]],
};
const reply = (items: unknown[], unknown_items: unknown[] = []) => ({ meal_name: "Plate", items, unknown_items, photo_quality: "good" });

d("a badly formed scanner reply (real route, real adapter, real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 2 });
  let next: unknown = null;
  /** What the food search finds. */
  let listed: FoodReference[] = [];
  const openAi: typeof fetch = () => Promise.resolve(new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(next) } }],
    usage: { prompt_tokens: 981, completion_tokens: 136 },
  }), { status: 200, headers: { "content-type": "application/json" } }));
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let access = "";
  // Each scan is two days after the last, so no scan meets this file's own daily limit or pause.
  let redisNow = Date.now();
  const scan = async (evidence: unknown): Promise<{ status: number; body: string }> => {
    if (app === undefined) throw new Error("beforeAll did not run");
    next = evidence;
    redisNow += 2 * 24 * 60 * 60 * 1000;
    const res = await app.inject({
      method: "POST", url: "/v1/nutrition/analyze-photo", cookies: { accessToken: access },
      headers: { "content-type": "application/json" }, payload: JSON.stringify({ imageBase64: MEAL_PHOTO, mimeType: "image/jpeg" }),
    });
    return { status: res.statusCode, body: res.body };
  };
  const sheet = async (evidence: unknown): Promise<MealPhotoAnalysis> => {
    const res = await scan(evidence);
    expect(res.status, res.body).toBe(200);
    return mealPhotoAnalysisSchema.parse(JSON.parse(res.body));
  };
  const rows = (read: MealPhotoAnalysis) => read.items.map((item) => [item.name, item.nutritionSource, item.kcalPoint]);

  beforeAll(async () => {
    await sql`DELETE FROM subscriptions WHERE owner_type='user' AND owner_id IN (SELECT id FROM users WHERE email=${EMAIL})`;
    await sql`DELETE FROM api_cost_events WHERE user_id IN (SELECT id FROM users WHERE email=${EMAIL})`;
    await sql`DELETE FROM users WHERE email=${EMAIL}`;
    app = await buildApp(loadConfig(env), {
      redis: createMemoryRedis(() => redisNow),
      nutrition: { visionProvider: createOpenAiVisionProvider("dummy-key", "gpt-6-luna", openAi), foodSearchProvider: { search: () => Promise.resolve(listed) } }, // gitleaks:allow
    });
    const post = (path: string, body: unknown) => {
      if (app === undefined) throw new Error("no app");
      return app.inject({ method: "POST", url: path, headers: { "content-type": "application/json" }, payload: JSON.stringify(body) });
    };
    const registered = await post("/v1/auth/register", { email: EMAIL, password: PASSWORD, displayName: "Luna Replies" });
    expect(registered.statusCode, registered.body).toBe(201);
    const userId = registered.json<{ userId: string }>().userId;
    access = (await post("/v1/auth/login", { email: EMAIL, password: PASSWORD })).cookies.find((c) => c.name === "accessToken")?.value ?? "";
    await sql`INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider) SELECT 'user', ${userId}, id, 'active', 'pilot' FROM plans WHERE code='pro_us_m'`;
  }, 60_000);
  afterAll(async () => {
    if (app !== undefined) await app.close();
    await sql.end({ timeout: 5 });
  });

  it("a packaged food on a photo's sheet: its whole pack is priced as offered, and a photo never starts a row there", { timeout: 30_000 }, async () => {
    const body = "140999990200";
    let sum = 0;
    for (const [at, digit] of Array.from(body).reverse().entries()) sum += Number(digit) * (at % 2 === 0 ? 3 : 1);
    const code = `${body}${String((10 - (sum % 10)) % 10)}`;
    await sql`INSERT INTO off_products (code, name, kcal, protein_g, carbs_g, fat_g, serving_size, quantity, numbers_fit, allergens, traces, listed_as_typed) VALUES (${code}, 'Scanned yoghurt', 100, 4, 15, 3, '30 g', '50 g', true, '{}', '{}', '{}') ON CONFLICT (code) DO NOTHING`;
    try {
      const canonical = `off_${code}`;
      listed = [{ canonical, name: "Scanned yoghurt", kcal: 100, proteinG: 4, carbsG: 15, fatG: 3, fiberG: null, serving: 30, unit: "g", source: "openfoodfacts", pack: { grams: 50, volume: false } }];
      const read = await sheet(reply([["Scanned yoghurt", "scanned yoghurt", 1, 50, 50, 2, 8, 2]]));
      const row = read.items[0];
      expect(row?.canonical).toBe(canonical);
      expect(row?.measures.map((m) => m.id)).toContain("pack");
      expect(row?.startsAt.measure).not.toBe("pack");
      if (app === undefined) throw new Error("no app");
      const priced = await app.inject({
        method: "POST", url: "/v1/nutrition/meals/preview", cookies: { accessToken: access }, headers: { "content-type": "application/json" },
        payload: JSON.stringify({ scanToken: read.scanToken, items: [{ canonical, measure: "pack", amount: 1 }] }),
      });
      expect(priced.statusCode, priced.body).toBe(200);
      expect(priced.json<{ items: { gramsPoint: number; kcalPoint: number }[] }>().items[0]).toMatchObject({ gramsPoint: 50, kcalPoint: 50 });
    } finally {
      listed = [];
      await sql`DELETE FROM off_products WHERE code = ${code}`;
    }
  });

  it("a food the model could not name stays out of the total: its figures in unknown_items are never a row", { timeout: 30_000 }, async () => {
    // The shape Luna really wrote, beside a food it did name.
    const read = await sheet(reply([DAL], [["zqx brown pieces", null, 6, 180, 900, 12, 55, 90]]));
    expect(read.items.map((item) => item.name)).toEqual(["Dal (lentil curry)"]);
    expect(read.unknownItems).toEqual(["zqx brown pieces"]);
    expect(JSON.stringify(read.items)).not.toContain("zqx");
    expect(read.totals.kcalPoint).toBe(read.items[0]?.kcalPoint);
  });

  it("a food Luna says she cannot identify, in her real words, stays out of the total, and is named under Not in the total", { timeout: 60_000 }, async () => {
    // From saved real replies, then the wordings a reviewer tried.
    const said = [
      "unidentified brown cooked food pieces", "unknown yellow food", "unidentified browned fruit pieces", "unidentifiable food in a small bowl",
      "a grey-speckled food on the right cannot be identified", "brown cooked food pieces", "diced orange food", "white curd-like food",
      "fried item", "yellow food, possibly a cut piece of fruit or another soft food",
      "Unknown meat", "Mystery meat", "Not sure", "Cannot tell", "Unsure", "Other", "No food", "Food",
    ];
    for (const name of said) {
      const read = await sheet(reply([DAL, [name, null, 1, 180, 900, 12, 55, 90]]));
      expect(read.items.map((item) => item.name), name).toEqual(["Dal (lentil curry)"]);
      expect(read.unknownItems, name).toEqual([name]);
      expect(read.totals.kcalPoint, name).toBe(read.items[0]?.kcalPoint);
    }
  });

  it("a real food with those words inside its name, or a hedge beside it, stays on the sheet as what it is", { timeout: 30_000 }, async () => {
    expect(rows(await sheet(reply([["zqx food cake", null, 1, 100, 300, 5, 50, 8]])))).toEqual([["Zqx food cake", "estimate", 300]]);
    expect(rows(await sheet(reply([["zqxchicken, possibly thigh", null, 1, 100, 200, 25, 0, 10]])))).toEqual([["Zqxchicken, possibly thigh", "estimate", 200]]);
  });

  it("a name with no kind of food in it, with a hint that has one, is that hint's food", { timeout: 30_000 }, async () => {
    const read = await sheet(reply([["fried item", "zqxsamosa", 1, 100, 260, 5, 30, 12]]));
    expect(rows(read)).toEqual([["Zqxsamosa", "estimate", 260]]);
    expect(read.unknownItems).toEqual([]);
  });

  it("a name this rule has never heard of stays what it is: the model's estimate, never a table's food", { timeout: 30_000 }, async () => {
    expect(rows(await sheet(reply([["pale lump", null, 1, 100, 200, 5, 20, 8]])))).toEqual([["Pale lump", "estimate", 200]]);
  });

  it("a name that says it cannot be identified never asks a table, even with a hint", { timeout: 30_000 }, async () => {
    expect((await sheet(reply([DAL, ["Unidentified pieces", "dal", 1, 150, 170, 9, 25, 4]]))).unknownItems).toEqual(["Unidentified pieces"]);
    // A hint that says so is no name to ask by: the food's own name and figures stand.
    expect(rows(await sheet(reply([["zqx pieces", "unidentified food", 1, 100, 200, 5, 20, 8]])))).toEqual([["Zqx pieces", "estimate", 200]]);
  });

  it("a reply with no food that can go on the sheet asks for the photo again, free, never an empty sheet", { timeout: 60_000 }, async () => {
    const onlyThese: [string, unknown][] = [
      ["the word unknown", reply([["unknown", null, 1, 35, 50, 1, 12, 0]])],
      ["N/A, and an unknown list", reply([["N/A", null, 1, 35, 50, 1, 12, 0]], [["unknown", null, 1, 35, 50, 1, 12, 0]])],
      ["a name with no figures", reply([["zqx leaf", null, null, null, null, null, null, null]])],
      ["a food she says she cannot identify", reply([["unidentified brown cooked food pieces", null, 6, 180, 350, 12, 55, 12]])],
    ];
    for (const [label, evidence] of onlyThese) {
      const res = await scan(evidence);
      expect(res.status, label).toBe(422);
      const body = z.object({ error: z.string(), message: z.string(), retakeToken: z.string() }).parse(JSON.parse(res.body));
      expect([body.error, body.message], label).toEqual(["retake_required", "Please retake the photo in better light with the full plate visible."]);
      expect(res.body, label).not.toContain("scanToken");
    }
  });

  it("a very long name from the model is cut to what a row can hold", { timeout: 30_000 }, async () => {
    const read = await sheet(reply([DAL], [["z".repeat(600), null, 1, 35, 50, 1, 12, 0], "y".repeat(600)]));
    expect(read.unknownItems).toEqual(["z".repeat(200), "y".repeat(200)]);
  });

  it("two replies from the old prompt with no food on the sheet ask for the photo again, and show none", { timeout: 30_000 }, async () => {
    for (const photo of ["dish_1558373008.png", "dish_1559233445.png"]) {
      const res = await scan(realReply(photo));
      expect(res.status, photo).toBe(422);
      expect(JSON.parse(res.body), photo).toMatchObject({ error: "retake_required", message: "Please retake the photo in better light with the full plate visible." });
      expect(res.body, photo).not.toMatch(/brown|yellow|"items"/);
    }
  });

  it("three real replies whose foods had no canonical_hint are read, every food on the sheet", { timeout: 30_000 }, async () => {
    const seen: Record<string, unknown[]> = {};
    for (const photo of Object.keys(REAL_ROWS)) seen[photo] = (await sheet(realReply(photo))).items.map((item) => [item.name, item.nutritionSource]);
    expect(seen).toEqual(REAL_ROWS);
  });

  it("a food with no canonical_hint no table knows is shown as the estimate it is, never as a table's food", { timeout: 30_000 }, async () => {
    expect(rows(await sheet(reply([["zqx leaf", null, 1, 75, 35, 2, 5, 1]])))).toEqual([["Zqx leaf", "estimate", 35]]);
    // With dal's own energy too, so only the name can keep it off dal's row.
    expect(rows(await sheet(reply([["zqx stew", null, 1, 150, 170, 9, 25, 4]])))).toEqual([["Zqx stew", "estimate", 170]]);
  });

  it("with no canonical_hint, the energy check still stands: a name a table has, with another food's energy, is not that table's food", { timeout: 30_000 }, async () => {
    // Dal is about 110 kcal per 100 g; 500 per 100 g is another food, so it reads as the model's estimate.
    expect(rows(await sheet(reply([["dal", null, 1, 100, 500, 9, 25, 40]])))).toEqual([["Dal", "estimate", 500]]);
  });

  it("a food named only by a word that says there is none is no row and no name, whatever figures it carries", { timeout: 30_000 }, async () => {
    for (const word of ["unknown", "N/A", " none ", "   "]) {
      const read = await sheet(reply([DAL, [word, null, 1, 35, 50, 1, 12, 0]], [[word, null, 1, 35, 50, 1, 12, 0]]));
      expect(read.items.map((item) => item.name), JSON.stringify(word)).toEqual(["Dal (lentil curry)"]);
      expect(read.unknownItems, JSON.stringify(word)).toEqual([]);
    }
  });

  it("a food whose slots are out of place is read as nothing: the scan fails and asks again, never a sheet of shifted figures", { timeout: 30_000 }, async () => {
    const broken: [string, unknown][] = [
      ["no name and no hint", reply([[null, null, 1, 100, 100, 1, 1, 1]])],
      ["no name, a hint", reply([[null, "dal", 1, 100, 100, 1, 1, 1]])],
      ["a number where the hint goes", reply([["dal", 150, 1, 100, 100, 1, 1, 1]])],
      ["a slot missing: its grams would read as a count", reply([["dal", null, 150, 170, 9, 25, 4]])],
      ["a word in unknown_items that is no text or list", reply([DAL], [7])],
      ["an object in unknown_items", reply([DAL], [{ name: "x" }])],
    ];
    for (const [label, evidence] of broken) {
      const res = await scan(evidence);
      expect(res.status, label).toBe(422);
      expect(JSON.parse(res.body), label).toMatchObject({ error: "retake_required", message: "We could not read that photo. Please retake it with the full plate in frame." });
    }
  });
});
