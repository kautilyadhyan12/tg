import { describe, expect, it } from "vitest";
import { CURATED_FOODS, findCurated, searchCurated } from "../src/modules/nutrition/foods.js";
import { CONTAINER_PRIORS, COUNTABLE_PRIORS, DENSITY_G_PER_ML, dishwareGrams, resolvePortion } from "../src/modules/nutrition/portion-priors.js";
import {
  MEAL_SCAN_MEDIA_RESOLUTION,
  MEAL_VISION_MODELS,
  MEAL_VISION_PROMPT,
  RETIRED_EVIDENCE_FIELDS,
  RETIRED_ITEM_FIELDS,
  VisionProviderError,
  createGeminiVisionProvider,
  createGroqVisionProvider,
  createMealVisionProvider,
} from "../src/modules/nutrition/vision.adapter.js";
import { visionCostMicro } from "../src/modules/nutrition/service.js";
import { loadConfig, type AppConfig } from "../src/config.js";
import { nutritionTargetsResponseSchema, type PlanAnswers } from "@app/shared";
import { targetsFromPlan } from "../src/modules/nutrition/targets.js";
import { resolvePlan } from "../src/modules/plan/maths.js";

describe("P2.6a nutrition pure pipeline", () => {
  it("preserves the curated rows with unique source lines (130 salvage + the Kd curd row)", () => {
    // 130 from food_database.py + 1 Kd-approved USDA row (Curd / Dahi,
    // sourceLine 0 = non-salvage; DECISIONS 2026-07-18).
    expect(CURATED_FOODS).toHaveLength(131);
    expect(new Set(CURATED_FOODS.map((f) => f.sourceLine)).size).toBe(131);
    expect(findCurated("roti")?.sourceLine).toBe(151);
    expect(findCurated("dal")?.kcal).toBe(110);
    expect(findCurated("paneer")?.proteinG).toBe(18);
    expect(findCurated("idli")?.serving).toBe(30);
  });

  // Card 5c — food name aliases: the Card-5b smoke roti case ("Flatbread
  // Stack" → 0 curated matches → 0 kcal) plus common Indian/English synonyms
  // the curated table's English labels miss. Naming metadata only.
  it("resolves synonym aliases to curated canonicals without breaking exact hits (Card 5c)", () => {
    // THE REPORTED INPUT (cutover.md:129-132): vision emitted the descriptive
    // "Flatbread Stack", not the bare synonym — pinning "flatbread" alone was a
    // straw man that passed while the real bug stayed live (T3 finding 1).
    expect(findCurated("Flatbread Stack")?.canonical).toBe("roti_chapati");
    expect(findCurated("flatbread")?.canonical).toBe("roti_chapati");
    expect(findCurated("chapati")?.canonical).toBe("roti_chapati");
    expect(findCurated("phulka")?.canonical).toBe("roti_chapati");
    expect(findCurated("aloo")?.canonical).toBe("potato_baked");
    expect(findCurated("rajma")?.canonical).toBe("kidney_beans_cooked");
    expect(findCurated("capsicum")?.canonical).toBe("bell_pepper");
    // aliases never disturb the exact-name hits the row-inventory test pins.
    expect(findCurated("roti")?.sourceLine).toBe(151);
    expect(findCurated("dal")?.kcal).toBe(110);
    // an aliased food surfaces in the search dropdown too.
    expect(searchCurated("flatbread", 5).some((f) => f.canonical === "roti_chapati")).toBe(true);
    expect(searchCurated("aloo", 5).some((f) => f.canonical === "potato_baked")).toBe(true);
    // Noise words reveal a real head noun but NEVER invent one: a compound dish
    // whose head we don't stock still drops honestly (Card 5b's empty state) —
    // "Aloo Paratha" must NOT become potato, and "Beef Stew" not ground beef.
    expect(findCurated("Pizza Slice")?.canonical).toBe("pizza_cheese");
    expect(findCurated("Aloo Paratha")).toBeNull();
    expect(findCurated("Beef Stew")).toBeNull();
    // T3 F1 (the regression this card SHIPPED): a temperature/freshness word is
    // NOT arrangement — stripping it changed food identity, and the bare head
    // then fuzzy-matched ACROSS word boundaries ("tea" inside s-TEA-k, "ham"
    // inside HAM-burger). Both must drop honestly, never mis-resolve.
    expect(findCurated("Hot Tea")).toBeNull();          // was → steak
    expect(findCurated("Hot Chocolate")).toBeNull();    // was → dark chocolate
    expect(findCurated("Ham Slice")).toBeNull();        // "ham" ⊄ hamburger by token
    expect(findCurated("Iced Coffee")).toBeNull();
    // T3 advisory RESOLVED (Kd, DECISIONS 2026-07-18): curd/dahi no longer
    // alias to GREEK yogurt (that was a ~3× protein lie). A real Curd / Dahi
    // row was added, so they resolve to their OWN honest macros — never Greek
    // yogurt's 10 g protein.
    expect(findCurated("curd")?.canonical).toBe("curd_dahi");
    expect(findCurated("dahi")?.canonical).toBe("curd_dahi");
    expect(findCurated("curd")?.proteinG).toBe(3.5);
    expect(findCurated("curd")?.proteinG).not.toBe(10); // not Greek yogurt
    // A prototype key is not an alias (T3 finding 4).
    expect(findCurated("constructor")).toBeNull();
    expect(findCurated("__proto__")).toBeNull();
  });

  it("the vision prompt nudges toward common local food names (Card 5c)", () => {
    expect(MEAL_VISION_PROMPT.toLowerCase()).toContain("roti");
  });

  // Card 5c2: the confirm-time dishware arm and the scan-time rung-1 resolver
  // MUST compute grams identically — dishwareGrams is the one shared formula
  // (volume × fill × density), so a bowl measured in the photo flow and the
  // same bowl chosen at confirm can never disagree.
  it("dishwareGrams equals the resolver's saved-dishware rung for the same inputs (Card 5c2)", () => {
    // dal = medium density (1.0): 180 × 0.75 × 1.0 = 135.
    expect(dishwareGrams(180, 0.75, "dal")).toBe(135);
    // thick sabzi density 1.1: 200 × 1 × 1.1 = 220; thin rasam 0.95: 150 × 0.5 × 0.95 = 71.
    expect(dishwareGrams(200, 1, "dry_sabzi")).toBe(220);
    expect(dishwareGrams(150, 0.5, "rasam")).toBe(71);
    // Equality with the resolver's rung-1 branch on the SAME dish + fill + food.
    for (const [vol, fill, hint] of [[180, 0.75, "dal"], [250, 0.5, "sabzi"], [150, 1, "rasam"]] as const) {
      const viaResolver = resolvePortion(
        { canonicalHint: hint, container: "my_bowl", fillLevel: fill, sizeClass: null, count: null },
        [{ containerClass: "my_bowl", volumeMl: vol, foodHint: null }],
        100,
      );
      expect(viaResolver.gramsPoint).toBe(dishwareGrams(vol, fill, hint));
      expect(viaResolver.portionSource).toBe("user_dishware");
    }
  });

  it("copies Appendix B priors and resolves count > dishware > regional > default", () => {
    expect(CONTAINER_PRIORS.standard_katori).toEqual([150, 200]);
    expect(COUNTABLE_PRIORS.roti).toEqual([35, 45]);
    expect(DENSITY_G_PER_ML).toEqual({ thin: 0.95, medium: 1, thick: 1.1 });
    expect(resolvePortion({ canonicalHint: "roti", container: null, fillLevel: null, sizeClass: null, count: 2 }, [], 40)).toEqual({ gramsPoint: 80, gramsRange: [70, 90], portionSource: "regional_prior" });
    expect(resolvePortion({ canonicalHint: "dal", container: "my_bowl", fillLevel: 0.5, sizeClass: null, count: null }, [{ containerClass: "my_bowl", volumeMl: 180, foodHint: null }], 100)).toEqual({ gramsPoint: 90, gramsRange: [90, 90], portionSource: "user_dishware" });
    expect(resolvePortion({ canonicalHint: "dal", container: "standard_katori", fillLevel: 0.5, sizeClass: null, count: null }, [], 100)).toEqual({ gramsPoint: 88, gramsRange: [75, 100], portionSource: "regional_prior" });
    expect(resolvePortion({ canonicalHint: "mystery", container: null, fillLevel: null, sizeClass: null, count: null }, [], 100)).toEqual({ gramsPoint: 100, gramsRange: [100, 100], portionSource: "default" });
  });

  it("prompt bans nutrition arithmetic; every scanner model carries its list price; cost math is integer micro-USD per model", () => {
    expect(MEAL_VISION_PROMPT).toContain("Never output calories");
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

  it("the reply is trimmed to what the app reads (RULINGS 2026-09-15); the plate-reading instructions are whole", () => {
    // Asked for: what the service reads. Not asked for: what nothing ever read.
    expect(MEAL_VISION_PROMPT).toContain("meal_name, items [{name,canonical_hint,container,fill_level,size_class,count}], unknown_items, photo_quality");
    for (const retired of [...RETIRED_EVIDENCE_FIELDS, ...RETIRED_ITEM_FIELDS]) expect(MEAL_VISION_PROMPT).not.toContain(retired);
    expect(MEAL_VISION_PROMPT).toContain("leave out any field you cannot fill");
    // Kd's reading instructions, word for word (RULINGS 2026-08-24: the prompt is not shortened).
    expect(MEAL_VISION_PROMPT).toContain(
      'For canonical_hint, prefer the common everyday or local name of the dish over a generic or fancy description — for example "roti" not "flatbread stack", "dal" not "lentil stew", "paneer" not "cottage cheese", "biryani" not "rice dish". Count only reliably countable items. Say unknown instead of guessing. Never output calories, kcal, grams, quantities by weight, protein, carbohydrates, fat, fibre, or any nutrition arithmetic.',
    );
  });

  it("resolver covers thali_section weight-prior and density-class branches (T3 R9 gap)", () => {
    // thali_section prior is GRAMS (100–150), not ml×density (Appendix B).
    expect(
      resolvePortion({ canonicalHint: "dal", container: "thali_section", fillLevel: 1, sizeClass: null, count: null }, [], 100),
    ).toEqual({ gramsPoint: 125, gramsRange: [100, 150], portionSource: "regional_prior" });
    // Density classes over the same katori: thin rasam 0.95 vs thick sabzi 1.1.
    const thin = resolvePortion({ canonicalHint: "rasam", container: "standard_katori", fillLevel: 1, sizeClass: null, count: null }, [], 100);
    const thick = resolvePortion({ canonicalHint: "dry_sabzi", container: "standard_katori", fillLevel: 1, sizeClass: null, count: null }, [], 100);
    expect(thin.gramsRange).toEqual([Math.round(150 * 0.95), Math.round(200 * 0.95)]);
    expect(thick.gramsRange).toEqual([Math.round(150 * 1.1), Math.round(200 * 1.1)]);
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

  // ── Vision model swap card (2026-07-16): the browser smoke proved BOTH real
  // Groq vision models return field formats the strict schema rejected, 422ing
  // every scan. These two fixtures are VERBATIM real completions captured that
  // day (Scout + Qwen on the same pizza photo); the adapter must normalize
  // them — and, since the reply was trimmed (RULINGS 2026-09-15), drop the
  // fields the scanner no longer asks for rather than fail a reply that still
  // carries them. R9.5: written failing first.
  const wrap = (evidence: unknown) =>
    ((): typeof fetch => () => Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(evidence) } }],
      model: "m", usage: { prompt_tokens: 2002, completion_tokens: 130 },
    }), { status: 200, headers: { "content-type": "application/json" } })))();

  it("normalizes the REAL Scout reply (string fill_level/container) and drops the fields no longer asked for", async () => {
    const provider = createGroqVisionProvider("dummy-key", "m", wrap({ // gitleaks:allow
      meal_name: "Pizza", cuisine_guess: "Italian",
      items: [{ name: "Pizza", canonical_hint: "Margherita Pizza", container: "None", fill_level: "full", size_class: "large", count: 1, confidence: 0.9 }],
      scale_anchors: [{ type: "plate", notes: "large pizza" }],
      unknown_items: [], photo_quality: "good",
    }));
    const result = await provider.analyze("AA==", "image/jpeg");
    const item = result.evidence.items[0];
    expect(item?.fill_level).toBeNull();     // non-numeric string → unknown
    expect(item?.container).toBeNull();      // "None" → null
    expect(item).not.toHaveProperty("confidence");
    expect(result.evidence).not.toHaveProperty("cuisine_guess");
    expect(result.evidence).not.toHaveProperty("scale_anchors");
    expect(result.evidence.photo_quality).toBe("good");
    expect(result).toMatchObject({ tokensIn: 2002, tokensOut: 130 });
  });

  it("normalizes the REAL Qwen reply (capitalized photo_quality, N/A fill_level)", async () => {
    const provider = createGroqVisionProvider("dummy-key", "m", wrap({ // gitleaks:allow
      meal_name: "Margherita Pizza", cuisine_guess: "Italian",
      items: [
        { name: "Pizza", canonical_hint: "Margherita Pizza", container: "none", fill_level: "N/A", size_class: "Large", count: 1, confidence: 0.95 },
        { name: "Basil leaves", canonical_hint: "Fresh Basil", container: "none", fill_level: "N/A", size_class: "Small", count: 1, confidence: 0.9 },
      ],
      scale_anchors: [{ type: "Countertop", notes: "Speckled granite surface visible around the pizza" }],
      unknown_items: [], photo_quality: "Good",
    }));
    const result = await provider.analyze("AA==", "image/jpeg");
    expect(result.evidence.items).toHaveLength(2);
    expect(result.evidence.items[0]?.size_class).toBe("Large");
    expect(result.evidence.photo_quality).toBe("good");
  });

  it("a field the model leaves out is unknown, never guessed: null; no unknown_items is none; no items is none", async () => {
    const provider = createGroqVisionProvider("dummy-key", "m", wrap({ // gitleaks:allow
      meal_name: "x", items: [{ name: "x", canonical_hint: "x" }], photo_quality: "good",
    }));
    expect((await provider.analyze("AA==", "image/jpeg")).evidence).toEqual({
      meal_name: "x", items: [{ name: "x", canonical_hint: "x", container: null, fill_level: null, size_class: null, count: null }],
      unknown_items: [], photo_quality: "good",
    });
    const bare = createGroqVisionProvider("dummy-key", "m", wrap({ photo_quality: "poor" })); // gitleaks:allow
    expect((await bare.analyze("AA==", "image/jpeg")).evidence).toEqual({ meal_name: null, items: [], unknown_items: [], photo_quality: "poor" });
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

  it("strictly rejects a vision reply that smuggles kcal into an item, or names no item, and retains usage for the ledger", async () => {
    const groq = (evidence: unknown): typeof fetch => () => Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(evidence) } }],
      model: "scout", usage: { prompt_tokens: 10, completion_tokens: 20 },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const smuggled = createGroqVisionProvider("dummy-key", "scout", groq({ meal_name: "Dal", items: [{ name: "Dal", canonical_hint: "dal", kcal: 100 }], unknown_items: [], photo_quality: "good" })); // gitleaks:allow
    await expect(smuggled.analyze("AA==", "image/jpeg")).rejects.toMatchObject({ message: "vision malformed evidence shape", usage: { tokensIn: 10, tokensOut: 20 } });
    const nameless = createGroqVisionProvider("dummy-key", "scout", groq({ meal_name: "Dal", items: [{ canonical_hint: "dal" }], unknown_items: [], photo_quality: "good" })); // gitleaks:allow
    await expect(nameless.analyze("AA==", "image/jpeg")).rejects.toMatchObject({ message: "vision malformed evidence shape", usage: { tokensIn: 10, tokensOut: 20 } });
  });

  // ── The scanner on Gemini (RULINGS 2026-08-24; 3.5 Flash-Lite since
  // 2026-09-15). Two real replies captured on 2026-09-15, VERBATIM but for the
  // thought signature, which nothing reads: Kd's salmon plate at low
  // resolution with the trimmed prompt, and a 64×64 orange square — a photo
  // with no meal on it — under the earlier prompt, so it still carries the
  // fields that were retired.
  const SALMON_REPLY = {
    candidates: [{ content: { parts: [{ text: '{"meal_name": "salmon with roasted potatoes and broccoli", "items": [{"name": "salmon fillets", "canonical_hint": "salmon", "container": "plate", "size_class": "medium", "count": 2}, {"name": "roasted potatoes", "canonical_hint": "potatoes", "container": "plate", "size_class": "small", "count": 9}, {"name": "broccoli florets", "canonical_hint": "broccoli", "container": "plate", "size_class": "large", "count": 1}, {"name": "lemon wedges", "canonical_hint": "lemon", "container": "plate", "size_class": "small", "count": 2}], "photo_quality": "good"}', thoughtSignature: "(96 characters)" }], role: "model" }, finishReason: "STOP", index: 0 }],
    usageMetadata: { promptTokenCount: 498, candidatesTokenCount: 166, totalTokenCount: 664, promptTokensDetails: [{ modality: "IMAGE", tokenCount: 256 }, { modality: "TEXT", tokenCount: 242 }], serviceTier: "standard" },
    modelVersion: "gemini-3.5-flash-lite", responseId: "u8yoasTzFcXUqfkPq5SjoQM",
  };
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

  it("Gemini: reads the REAL salmon-plate reply, and the REAL no-meal reply as a poor photo with its retired fields dropped", async () => {
    const good = await createGeminiVisionProvider("k", "gemini-3.5-flash-lite", geminiFetch(SALMON_REPLY).fetchImpl).analyze("AA==", "image/jpeg");
    expect(good.evidence.meal_name).toBe("salmon with roasted potatoes and broccoli");
    expect(good.evidence.items.map((i) => [i.canonical_hint, i.count, i.fill_level, i.container])).toEqual([
      ["salmon", 2, null, "plate"], ["potatoes", 9, null, "plate"], ["broccoli", 1, null, "plate"], ["lemon", 2, null, "plate"],
    ]);
    expect(good.evidence.unknown_items).toEqual([]);
    expect(good).toMatchObject({ tokensIn: 498, tokensOut: 166 });
    const none = await createGeminiVisionProvider("k", "gemini-3.5-flash-lite", geminiFetch(NO_MEAL_REPLY).fetchImpl).analyze("AA==", "image/png");
    expect(none.evidence).toEqual({ meal_name: null, items: [], unknown_items: [], photo_quality: "poor" });
    expect(none).toMatchObject({ tokensIn: 798, tokensOut: 39 });
  });

  it("Gemini: thought parts are skipped and billed as output; a blocked prompt, an empty reply, broken JSON and a smuggled kcal each fail closed with the usage kept", async () => {
    const withThoughts = { candidates: [{ content: { parts: [{ text: "let me look", thought: true }, { text: '{"meal_name":"x","items":[],"unknown_items":[],"photo_quality":"good"}' }] } }], usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 40, thoughtsTokenCount: 60 } };
    expect(await createGeminiVisionProvider("k", "m", geminiFetch(withThoughts).fetchImpl).analyze("AA==", "image/jpeg")).toMatchObject({ tokensIn: 500, tokensOut: 100, evidence: { meal_name: "x" } });
    const cases: [string, unknown, number][] = [
      ["vision blocked", { candidates: [], promptFeedback: { blockReason: "SAFETY" }, usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 0 } }, 0],
      ["vision empty completion", { candidates: [{ content: { parts: [] } }], usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 0 } }, 0],
      ["vision malformed evidence JSON", { candidates: [{ content: { parts: [{ text: "{not json" }] } }], usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 5 } }, 5],
      ["vision malformed evidence shape", { candidates: [{ content: { parts: [{ text: '{"meal_name":"x","items":[{"name":"x","canonical_hint":"x","kcal":100}],"unknown_items":[],"photo_quality":"good"}' }] } }], usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 50 } }, 50],
      ["vision malformed completion", { candidates: "nope" }, 0],
    ];
    for (const [message, reply, tokensOut] of cases) {
      const err = await failure(createGeminiVisionProvider("k", "m", geminiFetch(reply).fetchImpl).analyze("AA==", "image/jpeg"));
      expect(err.message, message).toBe(message);
      expect(err.usage, message).toEqual({ tokensIn: message === "vision malformed completion" ? 0 : 500, tokensOut });
    }
  });

  it("Gemini: an HTTP error and a network failure carry no usage — nothing was billed, nothing is ledgered", async () => {
    const http = await failure(createGeminiVisionProvider("k", "m", geminiFetch({ error: { code: 429 } }, 429).fetchImpl).analyze("AA==", "image/jpeg"));
    expect(http.message).toBe("vision HTTP 429");
    expect(http.usage).toBeUndefined();
    const down: typeof fetch = () => Promise.reject(new Error("ECONNRESET"));
    const network = await failure(createGeminiVisionProvider("k", "m", down).analyze("AA==", "image/jpeg"));
    expect(network.message).toBe("vision network failure");
    expect(network.usage).toBeUndefined();
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
