import { afterEach, describe, expect, it, vi } from "vitest";
import { GRAM } from "../src/modules/nutrition/measures.js";
import {
  MEAL_SCAN_MEDIA_RESOLUTION,
  MEAL_VISION_MODELS,
  MEAL_VISION_PROMPT,
  VISION_MAX_OUTPUT_TOKENS,
  VISION_TIMEOUT_MS,
  VisionProviderError,
  createGeminiVisionProvider,
  createGroqVisionProvider,
  createMealVisionProvider,
  visionCostMicro,
} from "../src/modules/nutrition/vision.adapter.js";
import { servingOf } from "../src/modules/nutrition/openfoodfacts.adapter.js";
import type { ScanPrice } from "../src/modules/nutrition/scanMatch.js";
import { scanSheet } from "../src/modules/nutrition/service.js";
import { loadConfig, type AppConfig } from "../src/config.js";
import { MAX_ITEM_GRAMS, MAX_PHOTO_COUNT, MAX_SCAN_FOODS, NO_VALUE_WORDS, RETIRED_EVIDENCE_FIELDS, isNoValueWord, nutritionTargetsResponseSchema, type PlanAnswers } from "@app/shared";
import { targetsFromPlan } from "../src/modules/nutrition/targets.js";
import { resolvePlan } from "../src/modules/plan/maths.js";

describe("P2.6a nutrition pure pipeline", () => {
  it("the vision prompt nudges toward common local food names (Card 5c)", () => {
    expect(MEAL_VISION_PROMPT.toLowerCase()).toContain("roti");
  });

  it("reads a count that is not a whole number from 1 to the sheet's stepper as unknown, and keeps the item", async () => {
    // A bad count never loses a paid scan: the item stays, its count unknown.
    expect(MAX_PHOTO_COUNT).toBe(30);
    const reply = (items: unknown[]) => wrap({ meal_name: "x", unknown_items: [], photo_quality: "good", items });
    // One list per food (RULINGS 2026-09-16): the count is the third slot, and
    // null is how the model says it has none — a slot cannot be left out of a list.
    const item = (count: unknown): unknown[] => ["x", "x", count, 100, 100, 0, 25, 0];
    const counts = async (...values: unknown[]) => {
      const provider = createGroqVisionProvider("dummy-key", "m", reply(values.map(item))); // gitleaks:allow
      return (await provider.analyze("AA==", "image/jpeg")).evidence.items.map((scanned) => scanned.count);
    };
    expect(await counts(1, 30, null)).toEqual([1, 30, null]);
    const bad = [31, 400, 0, -2, 2.5, 30.5, "3", "many", true, {}, []];
    expect(await counts(...bad)).toEqual(bad.map(() => null));
  });

  it("every scanner model carries its list price; cost math is integer micro-USD per model", () => {
    // Prices read 2026-09-15: Gemini 3.5 Flash-Lite $0.30 in / $2.50 out per
    // 1M tokens (ai.google.dev/gemini-api/docs/pricing); Groq qwen3.6-27b
    // $0.60 / $3.00 (console.groq.com/docs/models).
    expect(MEAL_VISION_MODELS).toEqual({
      "gemini-3.5-flash-lite": { provider: "gemini", inputMicroUsdPerMillion: 300_000n, outputMicroUsdPerMillion: 2_500_000n },
      "qwen/qwen3.6-27b": { provider: "groq", inputMicroUsdPerMillion: 600_000n, outputMicroUsdPerMillion: 3_000_000n },
    });
    // 530 in + 230 out on Gemini: 159 + 575 micro-USD.
    expect(visionCostMicro("gemini-3.5-flash-lite", 530, 230)).toBe(734n);
    expect(visionCostMicro("qwen/qwen3.6-27b", 100, 200)).toBe(660n);
    // Rounded half up, never a float: one Gemini input token is 0.3 micro-USD → 0; two are 0.6 → 1.
    expect(visionCostMicro("gemini-3.5-flash-lite", 1, 0)).toBe(0n);
    expect(visionCostMicro("gemini-3.5-flash-lite", 2, 0)).toBe(1n);
    expect(visionCostMicro("gemini-3.5-flash-lite", 0, 0)).toBe(0n);
  });

  it("the reply is one list per food with the model's own figures (RULINGS 2026-09-16); the plate-reading instructions are whole", () => {
    // Asked for: what the service reads, slot by slot in the order the schema reads them.
    // One object: the first scan of the trimmed prompt came back as `[{…}]` (ROADMAP 7a-iv-d).
    expect(MEAL_VISION_PROMPT).toContain(
      "Return one JSON object only, with meal_name, items, unknown_items, photo_quality, where every item is one list: [name, canonical_hint, count, grams, kcal, protein_g, carbs_g, fat_g].",
    );
    expect(MEAL_VISION_PROMPT).toContain("write null in any slot you cannot fill");
    // Not asked for: what nothing ever read (RULINGS 2026-09-15), and the vessel, how full
    // it looked and a size word, which nothing read once a row started by its count and
    // grams (ROADMAP 7a-iv-d) — nor the vessel list, which was only the vessel's.
    for (const retired of [...RETIRED_EVIDENCE_FIELDS, "confidence", "vessel", "fill_level", "size_class", "katori", "tumbler"]) {
      expect(MEAL_VISION_PROMPT, retired).not.toContain(retired);
    }
    expect(MEAL_VISION_PROMPT).toContain("meal_name must be a short name for the meal; count must be a positive integer;");
    // The model's own figures, always, and without the ".0" that bills tokens for nothing
    // (the shape check wrote "150.0" for every whole number); "Never output calories" went
    // with the redesign (RULINGS 2026-09-15).
    expect(MEAL_VISION_PROMPT).toContain("grams, kcal, protein_g, carbs_g and fat_g must be numbers, your own estimate for the portion shown, always filled, and never end in .0;");
    expect(MEAL_VISION_PROMPT).not.toContain("Never output calories");
    // A count is of whole pieces only: the form ROADMAP 7a-iv reads.
    expect(MEAL_VISION_PROMPT).toContain("Count whole pieces only, never slices, chunks or pieces cut from a bigger item.");
    // …and never without the two slots the evidence contract requires of every item.
    expect(MEAL_VISION_PROMPT).toContain("Every item always has both name and canonical_hint; a food you cannot name goes in unknown_items, not in items.");
    // Kd's reading instructions, word for word (RULINGS 2026-08-24: the prompt is not shortened).
    expect(MEAL_VISION_PROMPT.startsWith("Identify visible foods and portion evidence. ")).toBe(true);
    expect(MEAL_VISION_PROMPT).toContain(
      'For canonical_hint, prefer the common everyday or local name of the dish over a generic or fancy description — for example "roti" not "flatbread stack", "dal" not "lentil stew", "paneer" not "cottage cheese", "biryani" not "rice dish". Count only reliably countable items. Say unknown instead of guessing.',
    );
  });

  it("lists no more foods than the reply's output cap holds, and names any other food in unknown_items", async () => {
    expect([MAX_SCAN_FOODS, VISION_MAX_OUTPUT_TOKENS]).toEqual([20, 1000]);
    expect(MEAL_VISION_PROMPT).toContain(`List at most ${String(MAX_SCAN_FOODS)} items, and put the name of any other food you see in unknown_items.`);
    // Measured on Kd's plates (HANDOFF 2026-09-16): 155 output tokens for the 3 foods of
    // "download", 393 for the 9 of "download (1)" — about 40 a food. A full list stays
    // under nine tenths of the cap, so a reply is never cut off into JSON nothing reads.
    // Those were three slots a food longer than today's; the shorter reply wrote 303
    // tokens for all 9 foods of "download (1)" (HANDOFF 2026-09-17), inside this bound.
    const perFood = (393 - 155) / (9 - 3);
    expect(155 + perFood * (MAX_SCAN_FOODS - 3)).toBeLessThan(0.9 * VISION_MAX_OUTPUT_TOKENS);
    // A reply that lists more anyway is still read, never failed: its first foods are the
    // rows, and every food past them is named after what the model named itself.
    const food = (at: number) => [`Food ${String(at + 1)}`, "dal", null, 100, 145, 9, 19, 4];
    const reply = (count: number) => createGroqVisionProvider("dummy-key", "m", wrap({ // gitleaks:allow
      meal_name: "x", items: Array.from({ length: count }, (_, at) => food(at)), unknown_items: ["Mystery sauce"], photo_quality: "good",
    }));
    const exactly = (await reply(MAX_SCAN_FOODS).analyze("AA==", "image/jpeg")).evidence;
    expect([exactly.items.length, exactly.unknown_items]).toEqual([MAX_SCAN_FOODS, ["Mystery sauce"]]);
    for (const count of [MAX_SCAN_FOODS + 1, 30]) {
      const { evidence } = await reply(count).analyze("AA==", "image/jpeg");
      expect(evidence.items.map((i) => i.name), String(count)).toEqual(Array.from({ length: MAX_SCAN_FOODS }, (_, at) => `Food ${String(at + 1)}`));
      expect(evidence.unknown_items, String(count)).toEqual(["Mystery sauce", ...Array.from({ length: count - MAX_SCAN_FOODS }, (_, at) => `Food ${String(MAX_SCAN_FOODS + at + 1)}`)]);
    }
    // A food past them whose name says there is none is named by its hint, as its row would be, and the sheet
    // shows it under "Not in the total" beside the rest.
    const nameless = ["N/A", "zqx vlorp", null, 100, 145, 9, 19, 4];
    const { evidence: long } = await createGroqVisionProvider("dummy-key", "m", wrap({ // gitleaks:allow
      meal_name: "x", items: [...Array.from({ length: MAX_SCAN_FOODS }, (_, at) => food(at)), nameless, food(MAX_SCAN_FOODS + 1)], unknown_items: ["Mystery sauce"], photo_quality: "good",
    })).analyze("AA==", "image/jpeg");
    expect(long.unknown_items).toEqual(["Mystery sauce", "zqx vlorp", "Food 22"]);
    const priced = long.items.map((): ScanPrice => ({ kind: "estimate", per100g: { kcal: 145, proteinG: 9, carbsG: 19, fatG: 4 }, grams: 100, overruled: null }));
    const sheet = scanSheet(long, priced, () => [GRAM]);
    expect([sheet.items.length, sheet.unknownItems]).toEqual([MAX_SCAN_FOODS, ["Mystery sauce", "zqx vlorp", "Food 22"]]);
    // More than 30 is no plate's reply, as the contract has always said.
    await expect(reply(31).analyze("AA==", "image/jpeg")).rejects.toMatchObject({ message: "vision malformed evidence shape" });
  });

  it("OpenFoodFacts adapter: kJ→kcal, array names, fallback URL, malformed → [] (T3 R9 gap)", async () => {
    const { createOpenFoodFactsProvider } = await import("../src/modules/nutrition/openfoodfacts.adapter.js");
    // kJ fallback (energy_100g is kJ) + array product_name (Search-a-licious).
    const hit = { hits: [{ product_name: ["Paneer Cubes", "alt"], nutriments: { energy_100g: 1230 }, serving_size: "30 g" }] };
    const p1 = createOpenFoodFactsProvider(() => Promise.resolve(new Response(JSON.stringify(hit), { status: 200 })));
    const foods1 = await p1.search("paneer", 5);
    expect(foods1[0]?.name).toBe("Paneer Cubes");
    expect(foods1[0]?.kcal).toBeCloseTo(1230 / 4.184, 3);
    expect(foods1[0]?.serving).toBe(30);
    // No code → name-slug canonical (fallback).
    expect(foods1[0]?.canonical).toBe("off_paneer_cubes");
    // T3 manual-off-foods: barcode makes canonicals UNIQUE per product, and
    // physically impossible per-100g values are dropped, never served.
    const hit2 = { hits: [
      { code: "8901063014312", product_name: "Peanut Butter", nutriments: { "energy-kcal_100g": 588 } },
      { code: 8901063999999, product_name: "Peanut Butter", nutriments: { "energy-kcal_100g": 612 } },
      { product_name: "Prank Bar", nutriments: { "energy-kcal_100g": 1e9 } },
    ] };
    const p5 = createOpenFoodFactsProvider(() => Promise.resolve(new Response(JSON.stringify(hit2), { status: 200 })));
    const foods5 = await p5.search("peanut butter", 5);
    expect(foods5.map((f) => f.canonical)).toEqual(["off_8901063014312", "off_8901063999999"]);
    expect(foods5.some((f) => f.name === "Prank Bar")).toBe(false);
    // Each jar reads with its brand (RULINGS 2026-09-14): the search service
    // sends a list, the legacy search a comma-separated string, and a brand the
    // name already holds is not repeated.
    const branded = { hits: [
      { code: "1", product_name: "Peanut butter", brands: ["Happy Shopper", "Other"], nutriments: { "energy-kcal_100g": 563 } },
      { code: "2", product_name: "Peanut Butter", brands: "Peanut Butter & Co, Other", nutriments: { "energy-kcal_100g": 563 } },
      { code: "3", product_name: "Kabayan's Peanut Butter", brands: ["Kabayan's Peanut Butter"], nutriments: { "energy-kcal_100g": 571 } },
      { code: "4", product_name: "Crunchy peanut butter", nutriments: { "energy-kcal_100g": 590 } },
    ] };
    const p6 = createOpenFoodFactsProvider(() => Promise.resolve(new Response(JSON.stringify(branded), { status: 200 })));
    expect((await p6.search("peanut butter", 5)).map((f) => f.name)).toEqual([
      "Peanut butter · Happy Shopper",
      "Peanut Butter · Peanut Butter & Co",
      "Kabayan's Peanut Butter",
      "Crunchy peanut butter",
    ]);
    // Two brands' jars with no barcode and one name stay two foods: the fallback
    // canonical is the name as shown, brand included, so picking the second
    // never saves the first.
    const codeless = { hits: [
      { product_name: "Peanut butter", brands: "Happy Shopper", nutriments: { "energy-kcal_100g": 563 } },
      { product_name: "Peanut butter", brands: "Whole Earth", nutriments: { "energy-kcal_100g": 616 } },
    ] };
    const p7 = createOpenFoodFactsProvider(() => Promise.resolve(new Response(JSON.stringify(codeless), { status: 200 })));
    expect((await p7.search("peanut butter", 5)).map((f) => [f.canonical, f.name, f.kcal])).toEqual([
      ["off_peanut_butter_happy_shopper", "Peanut butter · Happy Shopper", 563],
      ["off_peanut_butter_whole_earth", "Peanut butter · Whole Earth", 616],
    ]);
    // First URL fails → legacy CGI fallback answers with `products`.
    let calls = 0;
    const p2 = createOpenFoodFactsProvider(() => {
      calls++;
      if (calls === 1) return Promise.resolve(new Response("oops", { status: 503 }));
      return Promise.resolve(
        new Response(JSON.stringify({ products: [{ product_name: "Dal Fry", nutriments: { "energy-kcal_100g": 120 } }] }), { status: 200 }),
      );
    });
    const foods2 = await p2.search("dal", 5);
    expect(calls).toBe(2);
    expect(foods2[0]?.name).toBe("Dal Fry");
    expect(foods2[0]?.kcal).toBe(120);
    // Malformed / network-down on both → defined degrade to [].
    const p3 = createOpenFoodFactsProvider(() => Promise.reject(new Error("ECONNRESET")));
    expect(await p3.search("anything", 5)).toEqual([]);
    const p4 = createOpenFoodFactsProvider(() => Promise.resolve(new Response("not json", { status: 200 })));
    expect(await p4.search("anything", 5)).toEqual([]);
  });

  it("reads a label's serving as the grams it gives, by the pack or measure it names", async () => {
    const labels: [string | undefined, number, string][] = [
      // The pack a label names is its unit, and the grams or millilitres beside it the serving.
      ["1 bottle (65 ml)", 65, "bottle"], ["1 can (250 ml)", 250, "can"], ["1 bar (68 g)", 68, "bar"],
      ["1 pot (125g)", 125, "pot"], ["1 cup (240 ml)", 240, "cup"], ["65 ml (1 bottle)", 65, "bottle"],
      ["one bar (40g)", 40, "bar"], ["1/2 cup (120 ml)", 120, "half cup"], ["½ cup (125 ml)", 125, "half cup"],
      // Never the first number: an ounce, two spoonfuls or eight fluid ounces are not 1, 2 or 8 g.
      ["1 oz (28 g)", 28, "oz"], ["28 g (1 oz)", 28, "oz"], ["2 tbsp (32 g)", 32, "2 tbsp"],
      ["8 fl oz (240 ml)", 240, "8 fl oz"], ["2 biscuits (25 g)", 25, "2 biscuits"],
      // Centilitres and ounces converted where the label gives no grams or millilitres.
      ["33 cl", 330, "ml"], ["1 can (12 fl oz)", 354.9, "can"], ["1 oz", 28.3, "oz"],
      ["30 g", 30, "g"], ["250ml", 250, "ml"], ["1,5 g", 1.5, "g"], ["Per 100g", 100, "g"],
      // A glass or a grapefruit in the name is no gram or litre.
      ["1 glass (200 ml)", 200, "glass"], ["1 grapefruit (123 g)", 123, "grapefruit"], ["30 gummies", 100, "g"],
      // No weight, or more than a meal item may weigh, is no label: 100 g by the gram.
      ["1 bottle", 100, "g"], ["", 100, "g"], [undefined, 100, "g"], ["99999 g", 100, "g"], ["0 g", 100, "g"],
    ];
    for (const [label, grams, unit] of labels) expect(servingOf(label), String(label)).toEqual({ grams, unit });
    // The adapter serves each product by its label, and its label's pack is one of its measures (measures.ts).
    const { createOpenFoodFactsProvider } = await import("../src/modules/nutrition/openfoodfacts.adapter.js");
    const yakult = { hits: [{ code: "4901392000034", product_name: "Yakult Original", brands: "Yakult", serving_size: "1 bottle (65 ml)", nutriments: { "energy-kcal_100g": 65 } }] };
    const [product] = await createOpenFoodFactsProvider(() => Promise.resolve(new Response(JSON.stringify(yakult), { status: 200 }))).search("yakult", 1);
    expect(product).toMatchObject({ serving: 65, unit: "bottle" });
  });

  // ── Vision model swap card (2026-07-16): the browser smoke proved BOTH real
  // Groq vision models return field formats a strict schema rejected, 422ing
  // every scan — a word for a number ("full", "N/A"), "None" for a container,
  // capitalized enums. The reply is one list per food since 2026-09-16 (RULINGS),
  // and those same variants, written in it, must still read: a word where a
  // number belongs is unknown, and the fields the scanner no longer asks for
  // are dropped rather than failing a reply that still carries them.
  const wrap = (evidence: unknown) =>
    ((): typeof fetch => () => Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(evidence) } }],
      model: "m", usage: { prompt_tokens: 2002, completion_tokens: 130 },
    }), { status: 200, headers: { "content-type": "application/json" } })))();

  it("reads the format variants real replies carried as unknown, and drops the fields no longer asked for", async () => {
    const provider = createGroqVisionProvider("dummy-key", "m", wrap({ // gitleaks:allow
      meal_name: "Margherita Pizza", cuisine_guess: "Italian",
      items: [
        ["Pizza", "Margherita Pizza", 1, 400, 1000, 44, 120, 38],
        ["Basil leaves", "Fresh Basil", "N/A", "full", 0, 0, 0, 0],
      ],
      scale_anchors: [{ type: "Countertop", notes: "Speckled granite surface visible around the pizza" }],
      unknown_items: [], photo_quality: "Good",
    }));
    const result = await provider.analyze("AA==", "image/jpeg");
    expect(result.evidence.items.map((i) => [i.count, i.grams, i.kcal])).toEqual([[1, 400, 1000], [null, null, 0]]);
    expect(result.evidence).not.toHaveProperty("cuisine_guess");
    expect(result.evidence).not.toHaveProperty("scale_anchors");
    expect(result.evidence.photo_quality).toBe("good");
    expect(result).toMatchObject({ tokensIn: 2002, tokensOut: 130 });
  });

  it("a slot the model cannot fill is unknown, never guessed; no unknown_items is none; no items is none", async () => {
    const provider = createGroqVisionProvider("dummy-key", "m", wrap({ // gitleaks:allow
      meal_name: "x", items: [["x", "x", null, null, null, null, null, null]], photo_quality: "good",
    }));
    expect((await provider.analyze("AA==", "image/jpeg")).evidence).toEqual({
      meal_name: "x",
      items: [{ name: "x", canonical_hint: "x", count: null, grams: null, kcal: null, protein_g: null, carbs_g: null, fat_g: null }],
      unknown_items: [], photo_quality: "good",
    });
    const bare = createGroqVisionProvider("dummy-key", "m", wrap({ photo_quality: "poor" })); // gitleaks:allow
    expect((await bare.analyze("AA==", "image/jpeg")).evidence).toEqual({ meal_name: null, items: [], unknown_items: [], photo_quality: "poor" });
    const itemsOf = async (items: unknown[][]) =>
      (await createGroqVisionProvider("dummy-key", "m", wrap({ meal_name: "x", items, photo_quality: "good" })).analyze("AA==", "image/jpeg")).evidence.items; // gitleaks:allow
    // A meal name that says there is none is no name, however it is spelled.
    for (const word of NO_VALUE_WORDS) {
      for (const spelled of [word, word.toUpperCase(), word.charAt(0).toUpperCase() + word.slice(1), `  ${word} `]) {
        const said = createGroqVisionProvider("dummy-key", "m", wrap({ meal_name: spelled, items: [["x", "x", null, 100, 100, 0, 25, 0]], photo_quality: "good" })); // gitleaks:allow
        const { evidence } = await said.analyze("AA==", "image/jpeg");
        expect(evidence.meal_name, JSON.stringify(spelled)).toBeNull();
      }
    }
    // Every number is one the sheet can use or unknown: grams above nothing and no
    // more than an item may weigh, kcal and macros of zero or more.
    expect(await itemsOf([
      ["x", "x", null, 0, -1, "12", true, {}],
      ["x", "x", null, MAX_ITEM_GRAMS, 0, 0, 0, 0],
      ["x", "x", null, MAX_ITEM_GRAMS + 1, 12.5, 1.5, 2.5, 0.5],
    ])).toEqual([
      { name: "x", canonical_hint: "x", count: null, grams: null, kcal: null, protein_g: null, carbs_g: null, fat_g: null },
      { name: "x", canonical_hint: "x", count: null, grams: MAX_ITEM_GRAMS, kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
      { name: "x", canonical_hint: "x", count: null, grams: null, kcal: 12.5, protein_g: 1.5, carbs_g: 2.5, fat_g: 0.5 },
    ]);
    // Every word the prompt gives the model for a value it does not have is one of them, read from
    // the prompt itself: its "write … in any slot you cannot fill" and its "Say … instead of guessing".
    const writing = /write (\S+) in any slot you cannot fill/.exec(MEAL_VISION_PROMPT)?.[1];
    const said = /Say (\S+) instead of guessing/.exec(MEAL_VISION_PROMPT)?.[1];
    expect([writing, said]).toEqual(["null", "unknown"]);
    for (const word of [writing ?? "", said ?? ""]) expect(isNoValueWord(word), word).toBe(true);
    // A real name that holds one of the words keeps it.
    const real = createGroqVisionProvider("dummy-key", "m", wrap({ meal_name: "Unknown dish", items: [["x", "x", null, 100, 100, 0, 25, 0]], photo_quality: "good" })); // gitleaks:allow
    expect((await real.analyze("AA==", "image/jpeg")).evidence.meal_name).toBe("Unknown dish");
  });

  it("passes reasoning_effort none ONLY for qwen/ models (T3 advisory: pin the prefix coupling)", async () => {
    const bodies: unknown[] = [];
    const capture: typeof fetch = (_url, init) => {
      if (typeof init?.body !== "string") throw new Error("expected string body");
      bodies.push(JSON.parse(init.body));
      return Promise.resolve(new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ meal_name: "x", items: [], unknown_items: [], photo_quality: "good" }) } }],
        model: "m", usage: { prompt_tokens: 1, completion_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } }));
    };
    await createGroqVisionProvider("dummy-key", "qwen/qwen3.6-27b", capture).analyze("AA==", "image/jpeg"); // gitleaks:allow
    await createGroqVisionProvider("dummy-key", "meta-llama/other", capture).analyze("AA==", "image/jpeg"); // gitleaks:allow
    expect(bodies[0]).toMatchObject({ reasoning_effort: "none" });
    expect(bodies[1]).not.toHaveProperty("reasoning_effort");
  });

  it("strictly rejects a reply whose food is not one list of eight slots with a name, or that adds a field, and retains usage for the ledger", async () => {
    const groq = (evidence: unknown): typeof fetch => () => Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(evidence) } }],
      model: "scout", usage: { prompt_tokens: 10, completion_tokens: 20 },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const dal = { meal_name: "Dal", items: [["Dal", "dal", null, 100, 100, 0, 25, 0]], unknown_items: [], photo_quality: "good" };
    const broken: [string, unknown][] = [
      // The field names the reply used before 2026-09-16 are no longer read.
      ["an item in the old field form", { meal_name: "Dal", items: [{ name: "Dal", canonical_hint: "dal", kcal: 100 }], unknown_items: [], photo_quality: "good" }],
      // Nor the eleven slots it had before ROADMAP 7a-iv-d: its grams would read as a count.
      ["the eleven slots of the reply before", { meal_name: "Dal", items: [["Dal", "dal", "katori", 0.75, "medium", null, 100, 100, 0, 25, 0]], photo_quality: "good" }],
      // A slot missing or one too many shifts every slot after it, so neither is read.
      ["seven slots", { meal_name: "Dal", items: [["Dal", "dal", null, 100, 100, 0, 25]], photo_quality: "good" }],
      ["nine slots", { meal_name: "Dal", items: [["Dal", "dal", null, 100, 100, 0, 25, 0, 1]], photo_quality: "good" }],
      ["no name", { meal_name: "Dal", items: [["", "dal", null, 100, 100, 0, 25, 0]], photo_quality: "good" }],
      ["a canonical_hint that is not text", { meal_name: "Dal", items: [["Dal", 7, null, 100, 100, 0, 25, 0]], photo_quality: "good" }],
      ["a field the contract does not have", { meal_name: "Dal", items: [], photo_quality: "good", total_kcal: 500 }],
      // One object in a list is that object (below); anything else in a list is no reply.
      ["two objects in a list", [dal, dal]],
      ["an empty list", []],
      ["a list of the items alone", dal.items],
      ["an object in a list in a list", [[dal]]],
    ];
    expect(await createGroqVisionProvider("dummy-key", "scout", groq(dal)).analyze("AA==", "image/jpeg")).toMatchObject({ evidence: { meal_name: "Dal" } }); // gitleaks:allow
    for (const [label, evidence] of broken) {
      const provider = createGroqVisionProvider("dummy-key", "scout", groq(evidence)); // gitleaks:allow
      await expect(provider.analyze("AA==", "image/jpeg"), label).rejects.toMatchObject({ message: "vision malformed evidence shape", usage: { tokensIn: 10, tokensOut: 20 } });
    }
  });

  // ── The scanner on Gemini (RULINGS 2026-08-24; 3.5 Flash-Lite since
  // 2026-09-15). Three real replies. Two to today's prompt, on 2026-09-17 (HANDOFF),
  // the model's text exactly as it wrote it, in Gemini's envelope with the tokens
  // that call billed: Kd's salmon plate, and the first scan of the prompt, which came
  // back as its object in a list. And a 64×64 orange square on 2026-09-15, a photo
  // with no meal on it, VERBATIM but for the thought signature, under an earlier
  // prompt, so it still carries the fields that were retired.
  const gemini = (text: string, tokensIn: number, tokensOut: number) => ({
    candidates: [{ content: { parts: [{ text }], role: "model" }, finishReason: "STOP", index: 0 }],
    usageMetadata: { promptTokenCount: tokensIn, candidatesTokenCount: tokensOut, totalTokenCount: tokensIn + tokensOut },
    modelVersion: "gemini-3.5-flash-lite",
  });
  const SALMON_REPLY = gemini(
    '{"meal_name": "Baked salmon with roasted potatoes and broccoli", "items": [["salmon fillet", "salmon", 2, 250, 520, 52, 0, 32], ["roasted potato", "roasted potatoes", 10, 150, 130, 3, 27, 2], ["broccoli", "broccoli", 1, 120, 40, 4, 8, 0], ["lemon wedge", "lemon", 3, 30, 9, 0, 3, 0]], "unknown_items": [], "photo_quality": "good"}',
    558, 148,
  );
  const LISTED_REPLY = gemini(
    '[{"meal_name": "Grilled chicken and shrimp meal", "items": [["shrimp", "shrimp", 7, 100, 99, 18, 0, 1], ["chicken thigh", "chicken", 1, 150, 315, 27, 0, 22], ["soft boiled egg", "egg", 2, 100, 143, 13, 1, 10], ["broccoli", "broccoli", 1, 80, 28, 3, 6, 0], ["corn", "corn", 1, 70, 60, 2, 14, 1], ["pumpkin slice", "pumpkin", 3, 60, 15, 0, 4, 0], ["orange juice", "orange juice", 1, 200, 90, 1, 21, 0]], "unknown_items": [], "photo_quality": "good"}]',
    565, 235,
  );
  const NO_MEAL_REPLY = {
    candidates: [{ content: { parts: [{ text: '{"meal_name": null, "cuisine_guess": null, "items": [], "scale_anchors": [], "unknown_items": [], "photo_quality": "poor"}', thoughtSignature: "(96 characters)" }], role: "model" }, finishReason: "STOP", index: 0 }],
    usageMetadata: { promptTokenCount: 798, candidatesTokenCount: 39, totalTokenCount: 837, promptTokensDetails: [{ modality: "IMAGE", tokenCount: 529 }, { modality: "TEXT", tokenCount: 269 }], serviceTier: "standard" },
    modelVersion: "gemini-3.5-flash-lite", responseId: "qMCoauvCBdaug8UPruDiyQY",
  };
  const urlOf = (input: Parameters<typeof fetch>[0]): string => (typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const geminiFetch = (reply: unknown, status = 200) => {
    const seen: { url: string; init: RequestInit | undefined }[] = [];
    const fetchImpl: typeof fetch = (input, init) => {
      seen.push({ url: urlOf(input), init });
      return Promise.resolve(new Response(JSON.stringify(reply), { status, headers: { "content-type": "application/json" } }));
    };
    return { seen, fetchImpl };
  };
  const failure = async (p: Promise<unknown>): Promise<VisionProviderError> => {
    try { await p; } catch (err) { if (err instanceof VisionProviderError) return err; throw err; }
    throw new Error("expected the scan to fail");
  };
  const sentBody = (call: { init: RequestInit | undefined } | undefined): unknown => {
    if (typeof call?.init?.body !== "string") throw new Error("expected a string body");
    return JSON.parse(call.init.body);
  };

  it("Gemini: the key rides in a header never the URL; prompt before photo, JSON mode, minimal thinking, low resolution, a timeout", async () => {
    const { seen, fetchImpl } = geminiFetch(SALMON_REPLY);
    await createGeminiVisionProvider("dummy-gemini-key", "gemini-3.5-flash-lite", fetchImpl).analyze("AA==", "image/jpeg"); // gitleaks:allow
    const [call] = seen;
    expect(call?.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent");
    expect(call?.url).not.toContain("dummy-gemini-key");
    expect(call?.init?.method).toBe("POST");
    expect(call?.init?.headers).toEqual({ "content-type": "application/json", "x-goog-api-key": "dummy-gemini-key" }); // gitleaks:allow
    expect(call?.init?.signal).toBeInstanceOf(AbortSignal);
    const contents = [{ role: "user", parts: [{ text: MEAL_VISION_PROMPT }, { inlineData: { mimeType: "image/jpeg", data: "AA==" } }] }];
    expect(sentBody(call)).toEqual({
      contents,
      generationConfig: { maxOutputTokens: 1000, responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "minimal" }, mediaResolution: "MEDIA_RESOLUTION_LOW" },
    });
    expect(MEAL_SCAN_MEDIA_RESOLUTION).toBe("MEDIA_RESOLUTION_LOW");
    // Left to the model when asked to be: no mediaResolution key at all.
    const plain = geminiFetch(SALMON_REPLY);
    await createGeminiVisionProvider("k", "gemini-3.5-flash-lite", plain.fetchImpl, null).analyze("AA==", "image/jpeg");
    expect(sentBody(plain.seen[0])).toEqual({
      contents,
      generationConfig: { maxOutputTokens: 1000, responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "minimal" } },
    });
  });

  it("Gemini: reads the REAL salmon-plate reply, the REAL reply listed in a list, and the REAL no-meal reply as a poor photo with its retired fields dropped", async () => {
    const good = await createGeminiVisionProvider("k", "gemini-3.5-flash-lite", geminiFetch(SALMON_REPLY).fetchImpl).analyze("AA==", "image/jpeg");
    expect(good.evidence.meal_name).toBe("Baked salmon with roasted potatoes and broccoli");
    expect(good.evidence.items.map((i) => [i.name, i.canonical_hint, i.count, i.grams, i.kcal, i.protein_g, i.carbs_g, i.fat_g])).toEqual([
      ["salmon fillet", "salmon", 2, 250, 520, 52, 0, 32],
      ["roasted potato", "roasted potatoes", 10, 150, 130, 3, 27, 2],
      ["broccoli", "broccoli", 1, 120, 40, 4, 8, 0],
      ["lemon wedge", "lemon", 3, 30, 9, 0, 3, 0],
    ]);
    expect(good.evidence.unknown_items).toEqual([]);
    expect(good).toMatchObject({ tokensIn: 558, tokensOut: 148 });
    // Its object in a list is that object, every food read, never a lost paid scan.
    const listed = await createGeminiVisionProvider("k", "gemini-3.5-flash-lite", geminiFetch(LISTED_REPLY).fetchImpl).analyze("AA==", "image/jpeg");
    expect(listed.evidence.meal_name).toBe("Grilled chicken and shrimp meal");
    expect(listed.evidence.items.map((i) => [i.canonical_hint, i.count, i.grams])).toEqual([
      ["shrimp", 7, 100], ["chicken", 1, 150], ["egg", 2, 100], ["broccoli", 1, 80], ["corn", 1, 70], ["pumpkin", 3, 60], ["orange juice", 1, 200],
    ]);
    expect(listed).toMatchObject({ tokensIn: 565, tokensOut: 235 });
    const none = await createGeminiVisionProvider("k", "gemini-3.5-flash-lite", geminiFetch(NO_MEAL_REPLY).fetchImpl).analyze("AA==", "image/png");
    expect(none.evidence).toEqual({ meal_name: null, items: [], unknown_items: [], photo_quality: "poor" });
    expect(none).toMatchObject({ tokensIn: 798, tokensOut: 39 });
  });

  it("Gemini: thought parts are skipped and billed as output; a blocked prompt, an empty reply, broken JSON and a food in the old field form each fail closed with the usage kept", async () => {
    const withThoughts = { candidates: [{ content: { parts: [{ text: "let me look", thought: true }, { text: '{"meal_name":"x","items":[],"unknown_items":[],"photo_quality":"good"}' }] } }], usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 40, thoughtsTokenCount: 60 } };
    expect(await createGeminiVisionProvider("k", "m", geminiFetch(withThoughts).fetchImpl).analyze("AA==", "image/jpeg")).toMatchObject({ tokensIn: 500, tokensOut: 100, evidence: { meal_name: "x" } });
    // What the model answered and cannot be used is "unreadable", with the usage it reports.
    const cases: [string, unknown, number][] = [
      ["vision blocked", { candidates: [], promptFeedback: { blockReason: "SAFETY" }, usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 0 } }, 0],
      ["vision empty completion", { candidates: [{ content: { parts: [] } }], usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 0 } }, 0],
      ["vision malformed evidence JSON", { candidates: [{ content: { parts: [{ text: "{not json" }] } }], usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 5 } }, 5],
      ["vision malformed evidence shape", { candidates: [{ content: { parts: [{ text: '{"meal_name":"x","items":[{"name":"x","canonical_hint":"x","kcal":100}],"unknown_items":[],"photo_quality":"good"}' }] } }], usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 50 } }, 50],
    ];
    for (const [message, reply, tokensOut] of cases) {
      const err = await failure(createGeminiVisionProvider("k", "m", geminiFetch(reply).fetchImpl).analyze("AA==", "image/jpeg"));
      expect([err.message, err.kind, err.usage], message).toEqual([message, "unreadable", { tokensIn: 500, tokensOut }]);
    }
  });

  type MakeProvider = (f: typeof fetch) => ReturnType<typeof createGroqVisionProvider>;
  const viaGemini: MakeProvider = (f) => createGeminiVisionProvider("k", "m", f);
  const viaGroq: MakeProvider = (f) => createGroqVisionProvider("k", "m", f);
  const makers: [string, MakeProvider][] = [["gemini", viaGemini], ["groq", viaGroq]];

  it("an empty answer from the model is unreadable with its usage kept, on both providers", async () => {
    const reply = (body: unknown): typeof fetch => () => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
    const groqUsage = { prompt_tokens: 300, completion_tokens: 1000 };
    const empties: [string, MakeProvider, unknown][] = [
      ["gemini, no parts", viaGemini, { candidates: [{ content: { parts: [] } }], usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 1000 } }],
      ["gemini, an empty part", viaGemini, { candidates: [{ content: { parts: [{ text: "" }] } }], usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 1000 } }],
      ["groq, empty content", viaGroq, { choices: [{ message: { content: "" } }], usage: groqUsage }],
      ["groq, null content", viaGroq, { choices: [{ message: { content: null } }], usage: groqUsage }],
      ["groq, no content", viaGroq, { choices: [{ message: {} }], usage: groqUsage }],
    ];
    for (const [label, make, body] of empties) {
      const err = await failure(make(reply(body)).analyze("AA==", "image/jpeg"));
      expect([err.message, err.kind, err.usage], label).toEqual(["vision empty completion", "unreadable", { tokensIn: 300, tokensOut: 1000 }]);
    }
  });

  it("no reply from the model carries no usage: 408, 429 and every 5xx are the scanner's outage, every other HTTP status a refusal, on both providers", async () => {
    const outage = (status: number): boolean => status === 408 || status === 429 || status >= 500;
    for (const [provider, make] of makers) {
      for (let status = 300; status <= 599; status++) {
        const answers: typeof fetch = () => Promise.resolve(new Response(status === 304 ? null : JSON.stringify({ error: { code: status } }), { status }));
        const err = await failure(make(answers).analyze("AA==", "image/jpeg"));
        expect([err.message, err.kind, err.usage], `${provider} ${String(status)}`).toEqual([`vision HTTP ${String(status)}`, outage(status) ? "unavailable" : "refused", undefined]);
      }
    }
    expect([400, 401, 403, 404, 413].map(outage)).toEqual([false, false, false, false, false]);
    expect([408, 429, 500, 502, 503, 504].map(outage)).toEqual([true, true, true, true, true, true]);
  });

  it("a network failure and a reply that is not the provider's are the scanner's outage, on both providers, with no usage", async () => {
    const notJson: typeof fetch = () => Promise.resolve(new Response("<html>busy</html>", { status: 200 }));
    const down: typeof fetch = () => Promise.reject(new Error("ECONNRESET"));
    for (const [provider, make] of makers) {
      const network = await failure(make(down).analyze("AA==", "image/jpeg"));
      expect([network.message, network.kind, network.usage], provider).toEqual(["vision network failure", "unavailable", undefined]);
      const html = await failure(make(notJson).analyze("AA==", "image/jpeg"));
      expect([html.message, html.kind, html.usage], provider).toEqual(["vision non-JSON response", "unavailable", undefined]);
      for (const envelope of [{ choices: "nope", candidates: "nope" }, { choices: [], candidates: "nope" }]) {
        const broken = await failure(make(geminiFetch(envelope).fetchImpl).analyze("AA==", "image/jpeg"));
        expect([broken.message, broken.kind, broken.usage], `${provider} ${JSON.stringify(envelope)}`).toEqual(["vision malformed completion", "unavailable", undefined]);
      }
    }
    // A Groq reply that breaks the evidence contract is the model's answer, as on Gemini.
    const groqBroken = await failure(createGroqVisionProvider("k", "m", wrap({ meal_name: "x", items: [{ name: "x", canonical_hint: "x", kcal: 1 }], photo_quality: "good" })).analyze("AA==", "image/jpeg"));
    expect([groqBroken.message, groqBroken.kind, groqBroken.usage]).toEqual(["vision malformed evidence shape", "unreadable", { tokensIn: 2002, tokensOut: 130 }]);
  });

  describe("a provider that never answers", () => {
    afterEach(() => { vi.restoreAllMocks(); });
    it("is given up on after 30 seconds, on both providers, and reads as the scanner's outage", async () => {
      expect(VISION_TIMEOUT_MS).toBe(30_000);
      for (const make of [createGeminiVisionProvider, createGroqVisionProvider]) {
        // The clock is the platform's: the timeout's own signal is handed back
        // already fired, and the fetch below answers only when its signal fires.
        const fired = AbortSignal.abort(new DOMException("The operation timed out.", "TimeoutError"));
        const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(fired);
        const signals: (AbortSignal | null | undefined)[] = [];
        const hangs: typeof fetch = (_input, init) => {
          signals.push(init?.signal);
          return new Promise((_resolve, reject) => {
            const signal = init?.signal;
            if (signal?.aborted === true) reject(new Error("aborted"));
            signal?.addEventListener("abort", () => { reject(new Error("aborted")); });
          });
        };
        const err = await failure(make("k", "m", hangs).analyze("AA==", "image/jpeg"));
        expect([err.message, err.kind, err.usage], make.name).toEqual(["vision network failure", "unavailable", undefined]);
        expect(timeout.mock.calls, make.name).toEqual([[30_000]]);
        expect(signals, make.name).toHaveLength(1);
        expect(signals[0], make.name).toBe(fired);
        timeout.mockRestore();
      }
    });

    it("is given up on after 3 seconds for a packaged-product search, both addresses together, with no products", async () => {
      const { OFF_SEARCH_TIMEOUT_MS, createOpenFoodFactsProvider } = await import("../src/modules/nutrition/openfoodfacts.adapter.js");
      expect(OFF_SEARCH_TIMEOUT_MS).toBe(3_000);
      // As above: the deadline's own signal is handed back already fired, and
      // each address answers only when its signal fires.
      const fired = AbortSignal.abort(new DOMException("The operation timed out.", "TimeoutError"));
      const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(fired);
      const signals: (AbortSignal | null | undefined)[] = [];
      const hangs: typeof fetch = (_input, init) => {
        signals.push(init?.signal);
        return new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted === true) reject(new Error("aborted"));
          signal?.addEventListener("abort", () => { reject(new Error("aborted")); });
        });
      };
      expect(await createOpenFoodFactsProvider(hangs).search("milk", 3)).toEqual([]);
      // ONE deadline for the search: the fallback address is tried under the
      // same one, never given three seconds of its own.
      expect(timeout.mock.calls).toEqual([[3_000]]);
      expect(signals).toHaveLength(2);
      expect(signals.every((signal) => signal === fired)).toBe(true);
    });
  });

  it("createMealVisionProvider follows MEAL_VISION_MODEL and is null while that model's own key is unset", async () => {
    const base = { NODE_ENV: "test", DATABASE_URL: "postgres://x:y@localhost:5432/z", WEB_ORIGIN: "http://localhost:5173", JWT_SECRET: "p26a-test-secret-0123456789abcdef-32" }; // gitleaks:allow
    expect(loadConfig(base).MEAL_VISION_MODEL).toBe("gemini-3.5-flash-lite");
    expect(createMealVisionProvider(loadConfig(base))).toBeNull();
    expect(createMealVisionProvider(loadConfig({ ...base, GROQ_API_KEY: "g" }))).toBeNull(); // the spare's key does not run Gemini
    expect(createMealVisionProvider(loadConfig({ ...base, MEAL_VISION_MODEL: "qwen/qwen3.6-27b" }))).toBeNull();
    expect(createMealVisionProvider(loadConfig({ ...base, MEAL_VISION_MODEL: "qwen/qwen3.6-27b", GEMINI_API_KEY: "k" }))).toBeNull();
    // Each model's provider calls its own host.
    const urls: string[] = [];
    const capture: typeof fetch = (input) => { urls.push(urlOf(input)); return Promise.resolve(new Response("{}", { status: 500 })); };
    const run = async (config: AppConfig): Promise<void> => {
      const provider = createMealVisionProvider(config, capture);
      if (provider === null) throw new Error("expected a provider");
      await provider.analyze("AA==", "image/jpeg").catch(() => undefined);
    };
    await run(loadConfig({ ...base, GEMINI_API_KEY: "k" }));
    await run(loadConfig({ ...base, MEAL_VISION_MODEL: "qwen/qwen3.6-27b", GROQ_API_KEY: "g" }));
    expect(urls).toEqual([
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
      "https://api.groq.com/openai/v1/chat/completions",
    ]);
    // A model with no price row cannot be configured at all.
    expect(() => loadConfig({ ...base, MEAL_VISION_MODEL: "gemini-2.5-flash-lite" })).toThrow(/MEAL_VISION_MODEL/);
  });
});

// ── Nutrition targets: the macro rings' numbers ARE the plan's ────────────────
// ROADMAP 4a-iii: GET /v1/nutrition/targets reshapes the person's own plan
// (plan/maths.ts) and computes nothing of its own, so the rings and the
// onboarding screens can never show two daily numbers. The first calculator
// here (the nutrition.py port: days a week as the activity factor, a fixed
// −400 / +300) is retired, and its goldens with it.
describe("nutrition targets read the plan", () => {
  /** The golden person of users.onboarding.routes.test.ts. */
  const golden: PlanAnswers = {
    goal: "lose", age: 30, gender: "female", heightCm: 165, weightKg: 70, targetWeightKg: 65,
    pace: "steady", dayActivity: "sitting", trainingDays: 3, sessionMinutes: 45, today: "2026-09-11",
  };
  const planOf = (answers: PlanAnswers) => {
    const { plan } = resolvePlan(answers);
    if (plan === null) throw new Error(`expected a plan for ${JSON.stringify(answers)}`);
    return plan;
  };

  it("carries the plan's own numbers, field by field", () => {
    expect(targetsFromPlan(resolvePlan(golden))).toEqual({
      targets: { bmr: 1420, tdee: 1817, kcal: 1267, proteinG: 140, carbsG: 98, fatG: 35, noCalorieCut: false },
      missing: [],
      targetWrongSide: false,
    });
    // A gain, a hold, and a heavy body whose protein is counted at BMI 30: each
    // field is still the plan's own.
    for (const answers of [
      { ...golden, goal: "gain", targetWeightKg: 75 },
      { ...golden, goal: "maintain" },
      { ...golden, gender: "male", age: 35, heightCm: 175, weightKg: 120, targetWeightKg: 90 },
    ] satisfies PlanAnswers[]) {
      const plan = planOf(answers);
      expect(targetsFromPlan(resolvePlan(answers)).targets, JSON.stringify(answers)).toEqual({
        bmr: plan.restingBurnKcal,
        tdee: plan.dailyBurnKcal,
        kcal: plan.targetKcal,
        proteinG: plan.proteinG,
        carbsG: plan.carbsG,
        fatG: plan.fatG,
        noCalorieCut: false,
      });
    }
  });

  it("says a cut was held back exactly when the plan's no_deficit flag does, and then eats the whole burn", () => {
    for (const answers of [
      { ...golden, health: { hasCondition: true, safeMode: false } },
      { ...golden, health: { hasCondition: true, safeMode: true } },
      { ...golden, age: 16 },
    ] satisfies PlanAnswers[]) {
      const targets = targetsFromPlan(resolvePlan(answers)).targets;
      expect(targets, JSON.stringify(answers)).toMatchObject({ noCalorieCut: true });
      expect(targets?.kcal, JSON.stringify(answers)).toBe(targets?.tdee);
    }
    // No cut asked for is no cut held back: a hold, and a gain under 18.
    for (const answers of [
      { ...golden, goal: "maintain" },
      { ...golden, goal: "gain", targetWeightKg: 75, age: 16 },
    ] satisfies PlanAnswers[]) {
      expect(targetsFromPlan(resolvePlan(answers)).targets?.noCalorieCut, JSON.stringify(answers)).toBe(false);
    }
  });

  it("with the target on the wrong side of the weight, gives no number and says so, never as a question left open", () => {
    // A loss target kept when the goal changed to Muscle Gain in Settings, or a
    // weight that reached its target: the plan holds the weight, and the rings
    // do not pass that off as the goal's number (Kd, 2026-09-11). The person
    // HAS a target, so it is not among the answers still missing.
    for (const answers of [
      { ...golden, targetWeightKg: 80 },
      { ...golden, targetWeightKg: 70 },
      { ...golden, targetWeightKg: 80, age: 16 },
      { ...golden, goal: "gain", targetWeightKg: 65 },
    ] satisfies PlanAnswers[]) {
      expect(planOf(answers).flags, JSON.stringify(answers)).toContainEqual({ code: "target_wrong_direction" });
      expect(targetsFromPlan(resolvePlan(answers)), JSON.stringify(answers)).toEqual({ targets: null, missing: [], targetWrongSide: true });
    }
  });

  it("with an answer missing, gives no number and the plan's own list of questions", () => {
    // What someone who finished the old form has: no one goal, no "your day".
    const oldForm: PlanAnswers = { age: 30, gender: "female", heightCm: 165, weightKg: 70, trainingDays: 3, sessionMinutes: 45, today: "2026-09-11" };
    expect(targetsFromPlan(resolvePlan(oldForm))).toEqual({ targets: null, missing: ["goal", "dayActivity"], targetWrongSide: false });
    expect(targetsFromPlan(resolvePlan({ today: "2026-09-11" })).missing).toEqual([
      "goal", "age", "gender", "heightCm", "weightKg", "dayActivity", "trainingDays", "sessionMinutes",
    ]);
  });

  // The contract's refine(), which the TYPES cannot express: every impossible
  // pairing below typechecks fine and would pass the bare shape.
  it("rejects every impossible pairing of a number, the questions missing and a wrong-side target", () => {
    const t = { bmr: 1420, tdee: 1817, kcal: 1267, proteinG: 140, carbsG: 98, fatG: 35, noCalorieCut: false };
    const ok = (body: unknown) => nutritionTargetsResponseSchema.safeParse(body).success;
    expect(ok({ targets: t, missing: [], targetWrongSide: false })).toBe(true);
    expect(ok({ targets: null, missing: ["goal"], targetWrongSide: false })).toBe(true);
    expect(ok({ targets: null, missing: [], targetWrongSide: true })).toBe(true);
    // No number and no reason for it: a prompt that names nothing.
    expect(ok({ targets: null, missing: [], targetWrongSide: false })).toBe(false);
    // A number beside an unanswered question: a number built from a gap.
    expect(ok({ targets: t, missing: ["goal"], targetWrongSide: false })).toBe(false);
    // A number beside a wrong-side target: the held weight passed off as the goal's number.
    expect(ok({ targets: t, missing: [], targetWrongSide: true })).toBe(false);
    // Both reasons at once: a plan still missing an answer raises no flags.
    expect(ok({ targets: null, missing: ["goal"], targetWrongSide: true })).toBe(false);
    // The field is always sent.
    expect(ok({ targets: t, missing: [] })).toBe(false);
    // The old calculator's key names a question no screen asks any more.
    expect(ok({ targets: null, missing: ["exerciseFrequency"], targetWrongSide: false })).toBe(false);
  });
});
