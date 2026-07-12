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
    expect(VISION_INPUT_MICRO_USD_PER_MILLION).toBe(110_000n);
    expect(VISION_OUTPUT_MICRO_USD_PER_MILLION).toBe(340_000n);
    expect(visionCostMicro(100, 200)).toBe(79n);
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
