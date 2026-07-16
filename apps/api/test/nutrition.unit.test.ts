import { describe, expect, it } from "vitest";
import { CURATED_FOODS, findCurated } from "../src/modules/nutrition/foods.js";
import { CONTAINER_PRIORS, COUNTABLE_PRIORS, DENSITY_G_PER_ML, resolvePortion } from "../src/modules/nutrition/portion-priors.js";
import { MEAL_VISION_PROMPT, createVisionProvider } from "../src/modules/nutrition/vision.adapter.js";
import { VISION_INPUT_MICRO_USD_PER_MILLION, VISION_OUTPUT_MICRO_USD_PER_MILLION, visionCostMicro } from "../src/modules/nutrition/service.js";

describe("P2.6a nutrition pure pipeline", () => {
  it("preserves all 130 curated rows with unique source lines", () => {
    expect(CURATED_FOODS).toHaveLength(130);
    expect(new Set(CURATED_FOODS.map((f) => f.sourceLine)).size).toBe(130);
    expect(findCurated("roti")?.sourceLine).toBe(151);
    expect(findCurated("dal")?.kcal).toBe(110);
    expect(findCurated("paneer")?.proteinG).toBe(18);
    expect(findCurated("idli")?.serving).toBe(30);
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
