import { describe, expect, it } from "vitest";
import { CONTAINER_PRIORS, COUNTABLE_PRIORS, DENSITY_G_PER_ML, dishwareGrams, resolvePortion } from "../src/modules/nutrition/portion-priors.js";
import { MEAL_VISION_PROMPT, createVisionProvider } from "../src/modules/nutrition/vision.adapter.js";
import { VISION_INPUT_MICRO_USD_PER_MILLION, VISION_OUTPUT_MICRO_USD_PER_MILLION, visionCostMicro } from "../src/modules/nutrition/service.js";
import { nutritionTargetsResponseSchema, type PlanAnswers } from "@app/shared";
import { targetsFromPlan } from "../src/modules/nutrition/targets.js";
import { resolvePlan } from "../src/modules/plan/maths.js";

describe("P2.6a nutrition pure pipeline", () => {
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
