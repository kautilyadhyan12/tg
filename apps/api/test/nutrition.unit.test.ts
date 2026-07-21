import { describe, expect, it } from "vitest";
import { CURATED_FOODS, findCurated, searchCurated } from "../src/modules/nutrition/foods.js";
import { CONTAINER_PRIORS, COUNTABLE_PRIORS, DENSITY_G_PER_ML, dishwareGrams, resolvePortion } from "../src/modules/nutrition/portion-priors.js";
import { MEAL_VISION_PROMPT, createVisionProvider } from "../src/modules/nutrition/vision.adapter.js";
import { VISION_INPUT_MICRO_USD_PER_MILLION, VISION_OUTPUT_MICRO_USD_PER_MILLION, visionCostMicro } from "../src/modules/nutrition/service.js";
import { missingTargetInputSchema, nutritionTargetsResponseSchema } from "@app/shared";
import { ACTIVITY_BY_FREQUENCY, REQUIRED_TARGET_INPUTS, calculateTargets, missingTargetInputs, resolveTargets } from "../src/modules/nutrition/targets.js";

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

  it("prompt bans nutrition arithmetic and cost math is integer micro-USD", () => {
    expect(MEAL_VISION_PROMPT).toContain("Never output calories");
    // Qwen3.6 27B (groq.com/pricing 2026-07-16): $0.60/1M in, $3.00/1M out.
    expect(VISION_INPUT_MICRO_USD_PER_MILLION).toBe(600_000n);
    expect(VISION_OUTPUT_MICRO_USD_PER_MILLION).toBe(3_000_000n);
    expect(visionCostMicro(100, 200)).toBe(660n);
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
  // them. R9.5: written failing first.
  const wrap = (evidence: unknown) =>
    ((): typeof fetch => () => Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(evidence) } }],
      model: "m", usage: { prompt_tokens: 2002, completion_tokens: 130 },
    }), { status: 200, headers: { "content-type": "application/json" } })))();

  it("normalizes the REAL Scout reply (numeric confidence, string fill_level/container)", async () => {
    const provider = createVisionProvider("dummy-key", "m", wrap({ // gitleaks:allow
      meal_name: "Pizza", cuisine_guess: "Italian",
      items: [{ name: "Pizza", canonical_hint: "Margherita Pizza", container: "None", fill_level: "full", size_class: "large", count: 1, confidence: 0.9 }],
      scale_anchors: [{ type: "plate", notes: "large pizza" }],
      unknown_items: [], photo_quality: "good",
    }));
    const result = await provider.analyze("AA==", "image/jpeg");
    const item = result.evidence.items[0];
    expect(item?.confidence).toBe("high");   // 0.9 → high (≥0.75)
    expect(item?.fill_level).toBeNull();     // non-numeric string → unknown
    expect(item?.container).toBeNull();      // "None" → null
    expect(result.evidence.photo_quality).toBe("good");
  });

  it("normalizes the REAL Qwen reply (capitalized photo_quality, N/A fill_level)", async () => {
    const provider = createVisionProvider("dummy-key", "m", wrap({ // gitleaks:allow
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
    expect(result.evidence.items[0]?.confidence).toBe("high");
    expect(result.evidence.photo_quality).toBe("good");
  });

  it("confidence bands: numbers map ≥0.75 high, ≥0.4 medium, else low; enum strings pass case-insensitively", async () => {
    const mk = (confidence: unknown) => createVisionProvider("dummy-key", "m", wrap({ // gitleaks:allow
      meal_name: "x", cuisine_guess: null,
      items: [{ name: "x", canonical_hint: "x", container: null, fill_level: null, size_class: null, count: null, confidence }],
      scale_anchors: [], unknown_items: [], photo_quality: "good",
    })).analyze("AA==", "image/jpeg");
    expect((await mk(0.75)).evidence.items[0]?.confidence).toBe("high");
    expect((await mk(0.5)).evidence.items[0]?.confidence).toBe("medium");
    expect((await mk(0.1)).evidence.items[0]?.confidence).toBe("low");
    expect((await mk("Medium")).evidence.items[0]?.confidence).toBe("medium");
  });

  it("passes reasoning_effort none ONLY for qwen/ models (T3 advisory: pin the prefix coupling)", async () => {
    const bodies: unknown[] = [];
    const capture: typeof fetch = (_url, init) => {
      if (typeof init?.body !== "string") throw new Error("expected string body");
      bodies.push(JSON.parse(init.body));
      return Promise.resolve(new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ meal_name: "x", cuisine_guess: null, items: [], scale_anchors: [], unknown_items: [], photo_quality: "good" }) } }],
        model: "m", usage: { prompt_tokens: 1, completion_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } }));
    };
    await createVisionProvider("dummy-key", "qwen/qwen3.6-27b", capture).analyze("AA==", "image/jpeg"); // gitleaks:allow
    await createVisionProvider("dummy-key", "meta-llama/other", capture).analyze("AA==", "image/jpeg"); // gitleaks:allow
    expect(bodies[0]).toMatchObject({ reasoning_effort: "none" });
    expect(bodies[1]).not.toHaveProperty("reasoning_effort");
  });

  it("a numeric-STRING confidence still fails closed (T3 advisory: degrade, never guess)", async () => {
    const provider = createVisionProvider("dummy-key", "m", wrap({ // gitleaks:allow
      meal_name: "x", cuisine_guess: null,
      items: [{ name: "x", canonical_hint: "x", container: null, fill_level: null, size_class: null, count: null, confidence: "0.9" }],
      scale_anchors: [], unknown_items: [], photo_quality: "good",
    }));
    await expect(provider.analyze("AA==", "image/jpeg")).rejects.toThrow("vision malformed evidence shape");
  });

  it("strictly rejects a vision reply that smuggles kcal into an item and retains usage for ledger", async () => {
    const fetchImpl: typeof fetch = () => Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ meal_name: "Dal", cuisine_guess: "north_indian", items: [{ name: "Dal", canonical_hint: "dal", container: null, fill_level: null, size_class: null, count: null, confidence: "high", kcal: 100 }], scale_anchors: [], unknown_items: [], photo_quality: "good" }) } }],
      model: "scout", usage: { prompt_tokens: 10, completion_tokens: 20 },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const provider = createVisionProvider("dummy-key", "scout", fetchImpl); // gitleaks:allow
    await expect(provider.analyze("AA==", "image/jpeg")).rejects.toMatchObject({ usage: { model: "scout", tokensIn: 10, tokensOut: 20 } });
  });
});

// ── Nutrition targets: the Mifflin-St Jeor port ───────────────────────────────
// Every constant below is QUOTED from backend-ml/app/routers/nutrition.py with
// its line number (Part 0 rule 4 / R5.4) — re-deriving or "improving" one is
// forbidden. Goldens are hand-computed from the ported formula, then pinned.
describe("nutrition targets (ported calculator, nutrition.py:98-179)", () => {
  it("preserves the activity multiplier table verbatim (nutrition.py:140-141)", () => {
    expect(ACTIVITY_BY_FREQUENCY).toEqual({ 1: 1.2, 2: 1.375, 3: 1.375, 4: 1.55, 5: 1.55, 6: 1.725, 7: 1.9 });
  });

  // R7.2 (T3 round 1) — the required-input list is DERIVED from the shared
  // contract, not declared twice. Asserted against the LITERAL five, because
  // round 2 caught the first version comparing the derivation to itself
  // (`expect(x).toEqual(x)`, unfailable). Changing the shared enum must break
  // a test deliberately: these five are a Kd ruling, not an implementation
  // detail, and dropping one silently would let a target be computed from a
  // null coerced to 0.
  it("keeps the required-input list at exactly the five Kd-ruled fields", () => {
    expect(REQUIRED_TARGET_INPUTS).toEqual(["age", "gender", "heightCm", "weightKg", "exerciseFrequency"]);
    // The second assertion here was `expect(x).toEqual(x)` again (T3 round 3
    // F11) — deleted rather than reworded. The literal above is the guard.
  });

  // T3 round 3 F10: `.options` returns zod's own internal array, so exporting
  // it unfrozen let any consumer reorder the shared contract in place.
  it("exposes the required-input list as a frozen copy, not the schema's array", () => {
    expect(Object.isFrozen(REQUIRED_TARGET_INPUTS)).toBe(true);
    expect(REQUIRED_TARGET_INPUTS).not.toBe(missingTargetInputSchema.options);
  });

  // The contract's refine(), which the TYPES cannot express — both impossible
  // pairings typecheck fine and were accepted by the bare shape (T3 round 2).
  it("rejects both impossible target/missing pairings at the contract boundary", () => {
    const t = { bmr: 1320, tdee: 2046, kcal: 1646, proteinG: 120, carbsG: 189, fatG: 46 };
    expect(nutritionTargetsResponseSchema.safeParse({ targets: t, missing: [] }).success).toBe(true);
    expect(nutritionTargetsResponseSchema.safeParse({ targets: null, missing: ["age"] }).success).toBe(true);
    // No targets AND nothing missing — a prompt that names no fields.
    expect(nutritionTargetsResponseSchema.safeParse({ targets: null, missing: [] }).success).toBe(false);
    // Targets computed despite an unmet input — a fabricated number.
    expect(nutritionTargetsResponseSchema.safeParse({ targets: t, missing: ["age"] }).success).toBe(false);
  });

  // female → −161 (:127). Hand-computed: bmr = 10·60 + 6.25·165 − 5·30 − 161 =
  // 1320.25; tdee = ×1.55 (freq 4) = 2046.3875; weight_loss −400 (:149) =
  // 1646.3875; protein 60×2.0 (:161) = 120; fat = kcal·0.25/9 = 45.7330;
  // carbs = (kcal − 4·120 − 9·fat)/4 = 188.6977. Rounded only at the end.
  it("computes the female / weight_loss golden exactly", () => {
    expect(calculateTargets({ age: 30, gender: "female", heightCm: 165, weightKg: 60, exerciseFrequency: 4, fitnessGoals: ["weight_loss"] }))
      .toEqual({ bmr: 1320, tdee: 2046, kcal: 1646, proteinG: 120, carbsG: 189, fatG: 46 });
  });

  // male → +5 (:129). bmr = 750 + 1125 − 125 + 5 = 1755; tdee = ×1.725 = 3027.375;
  // muscle_gain +300 (:151) = 3327.375; protein 75×2.2 (:159) = 165.
  it("computes the male / muscle_gain golden exactly", () => {
    expect(calculateTargets({ age: 25, gender: "male", heightCm: 180, weightKg: 75, exerciseFrequency: 6, fitnessGoals: ["muscle_gain"] }))
      .toEqual({ bmr: 1755, tdee: 3027, kcal: 3327, proteinG: 165, carbsG: 459, fatG: 92 });
  });

  // Mifflin-St Jeor defines only two formulas; the salvage's `else` (:128-129)
  // catches everything that is not "female". Ported as-is — inventing a
  // midpoint for other/prefer_not_to_say would be re-deriving a constant.
  it("routes other / prefer_not_to_say through the else (+5) branch", () => {
    const male = calculateTargets({ age: 25, gender: "male", heightCm: 180, weightKg: 75, exerciseFrequency: 6, fitnessGoals: [] });
    for (const gender of ["other", "prefer_not_to_say"])
      expect(calculateTargets({ age: 25, gender, heightCm: 180, weightKg: 75, exerciseFrequency: 6, fitnessGoals: [] })).toEqual(male);
  });

  // THE SALVAGE QUIRK, ported deliberately: the kcal adjustment tests
  // weight_loss FIRST (:148-151) while the protein split tests muscle_gain
  // FIRST (:158-161). With BOTH goals set they therefore disagree — kcal cuts
  // 400 while protein uses the bulking 2.2 g/kg. Pinned so no future edit
  // "tidies" it into consistency without a ruling.
  it("keeps the opposite goal precedence of the kcal and protein branches", () => {
    expect(calculateTargets({ age: 25, gender: "male", heightCm: 180, weightKg: 75, exerciseFrequency: 6, fitnessGoals: ["weight_loss", "muscle_gain"] }))
      .toEqual({ bmr: 1755, tdee: 3027, kcal: 2627, proteinG: 165, carbsG: 328, fatG: 73 });
  });

  it("applies the goal adjustment branches and the 1200 kcal floor (:149,:151,:153,:155)", () => {
    const base = { age: 25, gender: "male" as const, heightCm: 180, weightKg: 75, exerciseFrequency: 6 };
    const none = calculateTargets({ ...base, fitnessGoals: [] });
    expect(none.kcal).toBe(3027); // tdee unchanged (:153)
    expect(calculateTargets({ ...base, fitnessGoals: ["weight_loss"] }).kcal).toBe(none.kcal - 400);
    expect(calculateTargets({ ...base, fitnessGoals: ["muscle_gain"] }).kcal).toBe(none.kcal + 300);
    // Floor: bmr = 350 + 875 − 400 − 161 = 664; tdee ×1.2 = 796.8; −400 = 396.8 → 1200.
    expect(calculateTargets({ age: 80, gender: "female", heightCm: 140, weightKg: 35, exerciseFrequency: 1, fitnessGoals: ["weight_loss"] }))
      .toMatchObject({ bmr: 664, tdee: 797, kcal: 1200 });
  });

  // carbs = (kcal − 4·protein − 9·fat)/4 goes NEGATIVE for a heavy, short,
  // old profile; max(carbs_g, 50) (:174) is what stops it.
  it("applies the 50 g carbohydrate floor (:174)", () => {
    expect(calculateTargets({ age: 120, gender: "female", heightCm: 51, weightKg: 200, exerciseFrequency: 1, fitnessGoals: ["weight_loss"] }))
      .toMatchObject({ kcal: 1469, proteinG: 400, carbsG: 50 });
  });

  it("selects the protein-per-kg constant per goal (:158-163)", () => {
    const base = { age: 25, gender: "male" as const, heightCm: 180, weightKg: 75, exerciseFrequency: 6 };
    expect(calculateTargets({ ...base, fitnessGoals: ["muscle_gain"] }).proteinG).toBe(Math.round(75 * 2.2));
    expect(calculateTargets({ ...base, fitnessGoals: ["weight_loss"] }).proteinG).toBe(Math.round(75 * 2.0));
    expect(calculateTargets({ ...base, fitnessGoals: ["general_fitness"] }).proteinG).toBe(Math.round(75 * 1.6));
  });

  // Kd ruling (this card): all five inputs are REQUIRED — each moves the
  // number materially, and the salvage's 70 kg / 170 cm / 25 y / "male"
  // defaults (:103-106) are exactly the fabrication the Card-7 F2 ruling
  // struck down. An empty goal list is a real answer (:152-153), not missing.
  // T3 round 5: `=== null` missed `undefined`, so an OPTIONAL required field
  // would never have been reported — the same F1 failure, fourth shape. This
  // test enumerates the CLASS (null · undefined · key absent), because rounds
  // 3 and 4 each verified only the single mutation the previous round named.
  it("treats every shape of absence as missing, not just an explicit null", () => {
    const base = { age: 30, gender: "female", heightCm: 165, weightKg: 60, exerciseFrequency: 4, fitnessGoals: [] };
    expect(missingTargetInputs(base)).toEqual([]);
    expect(missingTargetInputs({ ...base, age: null })).toEqual(["age"]);
    expect(missingTargetInputs({ ...base, age: undefined as unknown as null })).toEqual(["age"]);
    const ageAbsent: Record<string, unknown> = { ...base };
    delete ageAbsent["age"];
    expect(missingTargetInputs(ageAbsent as unknown as typeof base)).toEqual(["age"]);
  });

  it("reports every missing required input, and treats empty goals as answered", () => {
    const complete = { age: 30, gender: "female", heightCm: 165, weightKg: 60, exerciseFrequency: 4, fitnessGoals: [] };
    expect(missingTargetInputs(complete)).toEqual([]);
    expect(missingTargetInputs({ ...complete, age: null })).toEqual(["age"]);
    expect(missingTargetInputs({ age: null, gender: null, heightCm: null, weightKg: null, exerciseFrequency: null, fitnessGoals: [] }))
      .toEqual(["age", "gender", "heightCm", "weightKg", "exerciseFrequency"]);
  });

  it("resolveTargets withholds targets entirely when anything is missing", () => {
    expect(resolveTargets({ age: 30, gender: "female", heightCm: 165, weightKg: 60, exerciseFrequency: 4, fitnessGoals: ["weight_loss"] }))
      .toEqual({ targets: { bmr: 1320, tdee: 2046, kcal: 1646, proteinG: 120, carbsG: 189, fatG: 46 }, missing: [] });
    expect(resolveTargets({ age: 30, gender: "female", heightCm: null, weightKg: 60, exerciseFrequency: 4, fitnessGoals: [] }))
      .toEqual({ targets: null, missing: ["heightCm"] });
  });
});
