import { afterEach, describe, expect, it, vi } from "vitest";
import { findCurated } from "../src/modules/nutrition/foods.js";
import { CONTAINER_PRIORS, CONTAINER_WORDS, COUNTABLE_PRIORS, COUNT_RULES, CUT_WORDS, DENSITY_G_PER_ML, WHOLE_PIECES, WHOLE_VOLUME_UNITS, dishwareGrams, resolvePortion, type SavedDishware } from "../src/modules/nutrition/portion-priors.js";
import {
  MEAL_SCAN_MEDIA_RESOLUTION,
  MEAL_VISION_MODELS,
  MEAL_VISION_PROMPT,
  VISION_TIMEOUT_MS,
  VisionProviderError,
  createGeminiVisionProvider,
  createGroqVisionProvider,
  createMealVisionProvider,
} from "../src/modules/nutrition/vision.adapter.js";
import { servingOf } from "../src/modules/nutrition/openfoodfacts.adapter.js";
import { visionCostMicro } from "../src/modules/nutrition/service.js";
import { loadConfig, type AppConfig } from "../src/config.js";
import { MAX_ITEM_GRAMS, MAX_PHOTO_COUNT, RETIRED_EVIDENCE_FIELDS, RETIRED_ITEM_FIELDS, nutritionTargetsResponseSchema, type PlanAnswers } from "@app/shared";
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
        { grams: 100, unit: "g" },
      );
      expect(viaResolver.gramsPoint).toBe(dishwareGrams(vol, fill, hint));
      expect(viaResolver.portionSource).toBe("user_dishware");
    }
  });

  it("copies Appendix B priors and resolves count > dishware > regional > default", () => {
    expect(CONTAINER_PRIORS.standard_katori).toEqual([150, 200]);
    expect(COUNTABLE_PRIORS.roti).toEqual([35, 45]);
    expect(DENSITY_G_PER_ML).toEqual({ thin: 0.95, medium: 1, thick: 1.1 });
    expect(resolvePortion({ canonicalHint: "roti", container: null, fillLevel: null, sizeClass: null, count: 2 }, [], { grams: 40, unit: "roti" })).toEqual({ gramsPoint: 80, gramsRange: [70, 90], portionSource: "regional_prior", pieces: 2 });
    expect(resolvePortion({ canonicalHint: "dal", container: "my_bowl", fillLevel: 0.5, sizeClass: null, count: null }, [{ containerClass: "my_bowl", volumeMl: 180, foodHint: null }], { grams: 100, unit: "g" })).toEqual({ gramsPoint: 90, gramsRange: [90, 90], portionSource: "user_dishware", pieces: null });
    expect(resolvePortion({ canonicalHint: "dal", container: "standard_katori", fillLevel: 0.5, sizeClass: null, count: null }, [], { grams: 100, unit: "g" })).toEqual({ gramsPoint: 88, gramsRange: [75, 100], portionSource: "regional_prior", pieces: null });
    expect(resolvePortion({ canonicalHint: "mystery", container: null, fillLevel: null, sizeClass: null, count: null }, [], { grams: 100, unit: "g" })).toEqual({ gramsPoint: 100, gramsRange: [100, 100], portionSource: "default", pieces: null });
  });

  it("counts pieces: the Appendix B piece a hint ends in, else the food's own piece times the count, never a weight", () => {
    const counted = (canonicalHint: string, count: number, serving: { grams: number; unit: string }) =>
      resolvePortion({ canonicalHint, container: null, fillLevel: null, sizeClass: null, count }, [], serving);
    const one = (grams: number, pieces: number | null) => ({ gramsPoint: grams, gramsRange: [grams, grams], portionSource: "default", pieces });
    const prior = (lo: number, hi: number, pieces: number) => ({ gramsPoint: Math.round((lo + hi) / 2), gramsRange: [lo, hi], portionSource: "regional_prior", pieces });
    expect(counted("chicken_nuggets", 6, { grams: 16, unit: "nugget" })).toEqual(one(96, 6));
    // "Pieces" counts whole things only of the pieces people count as pieces: six
    // nugget pieces are six nuggets, four meatball pieces four meatballs, three
    // pizza pieces three slices, and a roti's, idli's or samosa's pieces are
    // Appendix B's, as the plain name is.
    expect(counted("chicken nugget pieces", 6, { grams: 16, unit: "nugget" })).toEqual(one(96, 6));
    expect(counted("meatball pieces", 4, { grams: 43, unit: "meatball" })).toEqual(one(172, 4));
    expect(counted("pizza pieces", 3, { grams: 107, unit: "slice" })).toEqual(one(321, 3));
    expect(counted("roti pieces", 3, { grams: 40, unit: "roti" })).toEqual(prior(105, 135, 3));
    expect(counted("pieces of roti", 3, { grams: 40, unit: "roti" })).toEqual(counted("roti", 3, { grams: 40, unit: "roti" }));
    expect(counted("idli pieces", 4, { grams: 38, unit: "idli" })).toEqual(prior(120, 200, 4));
    expect(counted("samosa pieces", 3, { grams: 75, unit: "samosa" })).toEqual(prior(180, 300, 3));
    expect(counted("puri pieces", 6, { grams: 25, unit: "g" })).toEqual(prior(120, 180, 6));
    expect(counted("bread slice pieces", 2, { grams: 30, unit: "slice" })).toEqual(prior(50, 60, 2));
    // "Pieces" of anything else are bits cut or torn from one: eight hot dog pieces
    // are one hot dog, not eight, and so for a quesadilla, a tortilla, a pita, a
    // sausage, a dosa, a paratha, a fruit, a potato and an egg.
    expect(counted("hot dog pieces", 8, { grams: 102, unit: "hot dog" })).toEqual(one(102, null));
    expect(counted("quesadilla pieces", 6, { grams: 120, unit: "quesadilla" })).toEqual(one(120, null));
    expect(counted("tortilla pieces", 12, { grams: 48, unit: "tortilla" })).toEqual(one(48, null));
    expect(counted("pita pieces", 8, { grams: 60, unit: "pita" })).toEqual(one(60, null));
    expect(counted("sausage pieces", 10, { grams: 23, unit: "link" })).toEqual(one(23, null));
    expect(counted("dosa pieces", 2, { grams: 80, unit: "dosa" })).toEqual(one(80, null));
    expect(counted("paratha pieces", 4, { grams: 79, unit: "paratha" })).toEqual(one(79, null));
    expect(counted("banana pieces", 10, { grams: 120, unit: "banana" })).toEqual(one(120, null));
    expect(counted("potato pieces", 8, { grams: 150, unit: "potato" })).toEqual(one(150, null));
    expect(counted("boiled egg pieces", 4, { grams: 50, unit: "egg" })).toEqual(one(50, null));
    expect(counted("Boiled Eggs", 2, { grams: 50, unit: "egg" })).toEqual({ gramsPoint: 100, gramsRange: [100, 100], portionSource: "regional_prior", pieces: 2 });
    expect(counted("masala_dosa", 2, { grams: 100, unit: "g" })).toEqual({ gramsPoint: 200, gramsRange: [160, 240], portionSource: "regional_prior", pieces: 2 });
    // A two-word key is both its words: two pizza slices are the pizza's own
    // slices, two bread slices Appendix B's, and "vada" alone is no medu vada.
    expect(counted("pizza slices", 2, { grams: 107, unit: "slice" })).toEqual(one(214, 2));
    expect(counted("bread slices", 2, { grams: 30, unit: "slice" })).toEqual({ gramsPoint: 55, gramsRange: [50, 60], portionSource: "regional_prior", pieces: 2 });
    expect(counted("medu vada", 2, { grams: 70, unit: "g" })).toEqual({ gramsPoint: 100, gramsRange: [80, 120], portionSource: "regional_prior", pieces: 2 });
    expect(counted("vada", 2, { grams: 70, unit: "g" })).toEqual(one(70, null));
    // A key inside a word, or before the hint's own last word, is another food.
    expect(counted("veggie_burger", 1, { grams: 100, unit: "patty" })).toEqual(one(100, 1));
    expect(counted("eggplant", 2, { grams: 100, unit: "g" })).toEqual(one(100, null));
    expect(counted("banana_bread", 2, { grams: 60, unit: "slice" })).toEqual(one(120, 2));
    // A serving by weight is never multiplied: ten grapes are not ten 100 g servings.
    expect(counted("grapes", 10, { grams: 100, unit: "g" })).toEqual(one(100, null));
    expect(counted("almonds", 12, { grams: 28, unit: "oz" })).toEqual(one(28, null));
    // A count beside a cut counts cuts: ten banana slices are one banana's
    // serving, not ten bananas, by the food's own piece or by Appendix B's.
    expect(counted("banana slices", 10, { grams: 120, unit: "banana" })).toEqual(one(120, null));
    expect(counted("sliced banana", 10, { grams: 120, unit: "banana" })).toEqual(one(120, null));
    expect(counted("apple_slices", 8, { grams: 180, unit: "apple" })).toEqual(one(180, null));
    expect(counted("Orange Segments", 6, { grams: 150, unit: "orange" })).toEqual(one(150, null));
    expect(counted("halved boiled eggs", 4, { grams: 50, unit: "egg" })).toEqual(one(50, null));
    expect(counted("cheese cubes", 10, { grams: 30, unit: "slice" })).toEqual(one(30, null));
    // …unless the cut is the serving itself.
    expect(counted("sliced bread", 2, { grams: 30, unit: "slice" })).toEqual(one(60, 2));
    expect(counted("ham slices", 3, { grams: 28, unit: "slice" })).toEqual(one(84, 3));
    // Pieces are counted whatever they sit in: a plate of six nuggets is six
    // nuggets, and three pancakes on a saved plate are three pancakes.
    expect(counted("plate of nuggets", 6, { grams: 16, unit: "nugget" })).toEqual(one(96, 6));
    expect(counted("stack of pancakes", 3, { grams: 50, unit: "pancake" })).toEqual(one(150, 3));
    expect(
      resolvePortion({ canonicalHint: "pancakes", container: "my_plate", fillLevel: 1, sizeClass: null, count: 3 }, [{ containerClass: "my_plate", volumeMl: 500, foodHint: null }], { grams: 50, unit: "pancake" }),
    ).toEqual(one(150, 3));
  });

  it("counts vessels: a food served in a can, pot, glass, cup or bowl is that many of what the photo shows it in", () => {
    const vessels = (canonicalHint: string, count: number | null, serving: { grams: number; unit: string }, container: string | null = null, dishware: SavedDishware[] = []) =>
      resolvePortion({ canonicalHint, container, fillLevel: container === null ? null : 1, sizeClass: null, count }, dishware, serving);
    const one = (grams: number, pieces: number | null) => ({ gramsPoint: grams, gramsRange: [grams, grams], portionSource: "default", pieces });
    const beer = { grams: 350, unit: "can" };
    const yogurt = { grams: 170, unit: "container" };
    // Shown in nothing the rungs know, one is the food's own serving, whatever
    // the hint calls the vessel: three bottles of beer, two glasses, two yogurt cups.
    expect(vessels("beer", 2, beer)).toEqual(one(700, 2));
    expect(vessels("cans of beer", 2, beer)).toEqual(one(700, 2));
    expect(vessels("bottles of beer", 3, beer)).toEqual(one(1050, 3));
    expect(vessels("glasses of beer", 2, beer)).toEqual(one(700, 2));
    expect(vessels("yogurt cups", 2, yogurt)).toEqual(one(340, 2));
    expect(vessels("red_wine", 2, { grams: 150, unit: "glass" })).toEqual(one(300, 2));
    expect(vessels("coffee", 2, { grams: 240, unit: "cup" })).toEqual(one(480, 2));
    // In a container the rungs know, one is that container: three beers in mugs are
    // three mugs, however the hint names them, and one beer in a mug is one mug.
    const mugs = { gramsPoint: 975, gramsRange: [900, 1050], portionSource: "regional_prior", pieces: 3 };
    expect(vessels("beer", 3, beer, "mug")).toEqual(mugs);
    expect(vessels("beer mugs", 3, beer, "mug")).toEqual(mugs);
    expect(vessels("beer", 1, beer, "mug")).toEqual({ gramsPoint: 325, gramsRange: [300, 350], portionSource: "regional_prior", pieces: 1 });
    // A yogurt's cup is its own pot, with a count or without one, never the 240 ml cup.
    expect(vessels("yogurt cups", 2, yogurt, "cup")).toEqual(one(340, 2));
    expect(vessels("yogurt", null, yogurt, "cup")).toEqual(one(170, null));
    // A food served by the cup, in a cup, is its own cup as full as the photo shows,
    // never Appendix B's 240 ml of water: two cups of cornflakes are 60 g, not 480 g.
    expect(vessels("coffee", null, { grams: 240, unit: "cup" }, "cup")).toEqual(one(240, null));
    expect(resolvePortion({ canonicalHint: "coffee", container: "cup", fillLevel: 0.5, sizeClass: null, count: null }, [], { grams: 240, unit: "cup" })).toEqual(one(120, null));
    expect(vessels("cornflakes", 2, { grams: 30, unit: "cup" }, "cup")).toEqual(one(60, 2));
    expect(vessels("cups of cornflakes", 2, { grams: 30, unit: "cup" })).toEqual(one(60, 2));
    expect(vessels("bottles of yakult", 3, { grams: 65, unit: "bottle" })).toEqual(one(195, 3));
    // A dish the person saved beats everything (§3.4), times the count: two beers
    // in their 568 ml pint glass are two glasses, and in their 330 ml can two cans.
    const pint = [{ containerClass: "pint_glass", volumeMl: 568, foodHint: null }];
    expect(vessels("beer", 1, beer, "pint_glass", pint)).toEqual({ gramsPoint: 568, gramsRange: [568, 568], portionSource: "user_dishware", pieces: 1 });
    expect(vessels("beer", 2, beer, "pint_glass", pint)).toEqual({ gramsPoint: 1136, gramsRange: [1136, 1136], portionSource: "user_dishware", pieces: 2 });
    expect(vessels("beer", 2, beer, "can", [{ containerClass: "can", volumeMl: 330, foodHint: null }])).toEqual({ gramsPoint: 660, gramsRange: [660, 660], portionSource: "user_dishware", pieces: 2 });
    expect(vessels("yogurt", 1, yogurt, "my_bowl", [{ containerClass: "my_bowl", volumeMl: 300, foodHint: null }])).toEqual({ gramsPoint: 300, gramsRange: [300, 300], portionSource: "user_dishware", pieces: 1 });
    // A dish the person saved for another food is not theirs for this one.
    expect(vessels("beer", 2, beer, "pint_glass", [{ containerClass: "pint_glass", volumeMl: 568, foodHint: "milk" }])).toEqual(one(700, 2));
    // A count of bits cut from a vessel's serving is no count of vessels: six chunks
    // of beef stew are one cup of stew, not six, and eight paneer cubes one cup of
    // palak paneer; nor are "pieces" of a drink cans of it.
    expect(vessels("beef stew chunks", 6, { grams: 255, unit: "cup" })).toEqual(one(255, null));
    expect(vessels("palak paneer cubes", 8, { grams: 200, unit: "cup" })).toEqual(one(200, null));
    expect(vessels("beer pieces", 4, beer)).toEqual(one(350, null));
  });

  it("weighs a vessel the hint measures its food by as the photo's container, where that is empty", () => {
    const hinted = (canonicalHint: string, count: number | null, serving: { grams: number; unit: string }, container: string | null = null, dishware: SavedDishware[] = []) =>
      resolvePortion({ canonicalHint, container, fillLevel: null, sizeClass: null, count }, dishware, serving);
    const coffee = { grams: 240, unit: "cup" };
    // Two mugs of coffee are two mugs, as coffee shown in two mugs is, not two cups.
    expect(hinted("mugs of coffee", 2, coffee)).toEqual({ gramsPoint: 650, gramsRange: [600, 700], portionSource: "regional_prior", pieces: 2 });
    expect(hinted("mugs of coffee", 2, coffee)).toEqual(hinted("coffee", 2, coffee, "mug"));
    expect(hinted("a mug of coffee", null, coffee)).toEqual(hinted("coffee", null, coffee, "mug"));
    // The longest Appendix B name the words before "of" end in, and the person's own dish.
    expect(hinted("a large bowl of dal", null, { grams: 100, unit: "g" })).toEqual({ gramsPoint: 275, gramsRange: [250, 300], portionSource: "regional_prior", pieces: null });
    expect(hinted("two katori or small bowls of dal", null, { grams: 100, unit: "g" })).toEqual(hinted("dal", null, { grams: 100, unit: "g" }, "katori_or_small_bowl"));
    expect(hinted("bowls of pho", 2, { grams: 400, unit: "bowl" }, null, [{ containerClass: "bowl", volumeMl: 500, foodHint: null }])).toEqual({ gramsPoint: 1000, gramsRange: [1000, 1000], portionSource: "user_dishware", pieces: 2 });
    // Cans, bottles and glasses have no Appendix B size, so they are the food's serving.
    expect(hinted("cans of coke", 3, { grams: 370, unit: "can" })).toEqual({ gramsPoint: 1110, gramsRange: [1110, 1110], portionSource: "default", pieces: 3 });
    expect(hinted("glasses of wine", 2, { grams: 150, unit: "glass" })).toEqual({ gramsPoint: 300, gramsRange: [300, 300], portionSource: "default", pieces: 2 });
    // The photo's own container wins, and a hint with no "of" names none: cup
    // noodles are a food, not a 240 ml cup.
    expect(hinted("mugs of coffee", 2, coffee, "cup")).toEqual(hinted("coffee", 2, coffee, "cup"));
    expect(hinted("cup noodles", null, { grams: 64, unit: "cup" })).toEqual({ gramsPoint: 64, gramsRange: [64, 64], portionSource: "default", pieces: null });
    expect(hinted("cream of wheat", null, { grams: 100, unit: "g" })).toEqual({ gramsPoint: 100, gramsRange: [100, 100], portionSource: "default", pieces: null });
  });

  it("scales a food's own serving by how full its container looks only where the serving is all the container holds", () => {
    // A cup of cornflakes, a can, a bottle, a pot or a pack is the whole of its
    // container, so a half-full one is half the serving. A glass of wine, a bowl of
    // pho, a small or a portion is a pour or a helping, the same weight however full
    // its glass or bowl looks (Part 2B §3.5 applies fill to a container's volume).
    const WHOLE = ["bag", "bottle", "box", "can", "carton", "container", "cup", "half cup", "jar", "pack", "package", "packet", "pot", "pouch", "sachet", "tub"];
    expect([...WHOLE_VOLUME_UNITS].sort()).toEqual(WHOLE);
    expect([...COUNT_RULES].filter(([unit, rule]) => rule === "vessel" && !WHOLE.includes(unit)).map(([unit]) => unit).sort()).toEqual(["bowl", "glass", "portion", "small"]);
    expect(WHOLE.filter((unit) => COUNT_RULES.get(unit) !== "vessel")).toEqual([]);
    const shown = (unit: string, container: string, fillLevel: number | null) =>
      resolvePortion({ canonicalHint: "test food", container, fillLevel, sizeClass: null, count: null }, [], { grams: 50, unit }).gramsPoint;
    for (const unit of COUNT_RULES.keys()) {
      for (const fillLevel of [null, 1, 0.4]) {
        expect(shown(unit, unit, fillLevel), `${unit} at ${String(fillLevel)}`).toBe(WHOLE.includes(unit) ? Math.round(50 * (fillLevel ?? 1)) : 50);
      }
    }
    // A sealed pack's other name is its own container too: a yogurt pot shown as a cup.
    for (const unit of ["container", "pot", "tub"]) expect(shown(unit, "cup", 0.4), unit).toBe(20);
  });

  it("counts the containers a hint names in the plural before its \"of\", whatever the food's unit, cuts or pieces", () => {
    const dishware = [{ containerClass: "flask", volumeMl: 500, foodHint: null }, { containerClass: "my_plate", volumeMl: 600, foodHint: null }];
    const at = (canonicalHint: string, count: number | null, unit: string, container: string | null = null) =>
      resolvePortion({ canonicalHint, container, fillLevel: null, sizeClass: null, count }, dishware, { grams: 50, unit });
    const plural = (word: string): string => (/(?:s|sh|ch|x)$/.test(word) ? `${word}es` : `${word}s`);
    // What each container is, by hand: the words of its name a plural may count it by.
    const APPENDIX_B_KINDS: Record<string, readonly string[]> = {
      small_katori: ["katori"], katori_or_small_bowl: ["katori", "bowl"], standard_katori: ["katori"], large_katori: ["katori"],
      large_bowl: ["bowl"], serving_bowl: ["bowl"], steel_tumbler: ["tumbler"], chai_cup: ["cup"], thali_section: ["section"],
      cup: ["cup"], cereal_bowl: ["bowl"], mug: ["mug"], tablespoon: ["tablespoon"], teaspoon: ["teaspoon"],
    };
    // Names the photo writes itself, the kind first or last, with a serving word,
    // a size or a food in them, and one with no container word at all.
    const FREE_TEXT_KINDS: Record<string, readonly string[]> = {
      "serving bowl": ["bowl"], serving_plate: ["plate"], "wine glass": ["glass"], "bowl or plate": ["bowl", "plate"],
      "bowl with lid": ["bowl"], "bowl (small)": ["bowl"], "plate with rice": ["plate"], "cup and saucer": ["cup"],
      "steel plate (thali)": ["plate"], "bowl (1 serving)": ["bowl"], "glass bowl": ["glass", "bowl"], "steel flask": ["flask"],
    };
    for (const [unit, rule] of COUNT_RULES) {
      // Where the rungs know one container's size (Appendix B's, a dish the person
      // saved, the photo's own of the same name), the count is that many
      // containers, and a cut or "pieces" after the "of" is what fills them, not
      // what is counted.
      const sizedHints = [["large bowls of test food", null], ["flasks of test food", null], ["bowls of test food", "serving_bowl"], ["plates of test food", "my_plate"], ["cups of test food", "chai_cup"]] as const;
      for (const [hint, container] of sizedHints) {
        const one = at(hint, null, unit, container);
        expect(one.portionSource, `${hint} by ${unit}`).not.toBe("default");
        for (const tail of ["", " chunks", " slices", " pieces"]) {
          expect(at(`${hint}${tail}`, 3, unit, container), `${hint}${tail} by ${unit}`).toEqual({
            gramsPoint: one.gramsPoint * 3, gramsRange: [one.gramsRange[0] * 3, one.gramsRange[1] * 3], portionSource: one.portionSource, pieces: 3,
          });
        }
      }
      // Where they do not, one is the serving of a food served by a vessel, and the
      // count is not used for any other food, nor its pieces counted.
      for (const hint of ["bowls of test food", "plates of test food", "trays of test food", "katoris of test food", "tumblers of test food", "jars of test food"]) {
        for (const tail of ["", " chunks", " pieces"]) {
          expect(at(`${hint}${tail}`, 3, unit), `${hint}${tail} by ${unit}`).toEqual(
            rule === "vessel"
              ? { gramsPoint: 150, gramsRange: [150, 150], portionSource: "default", pieces: 3 }
              : { gramsPoint: 50, gramsRange: [50, 50], portionSource: "default", pieces: null },
          );
        }
      }
      // A serving word names the food's own serving, so its plural counts servings.
      for (const hint of ["servings of test food", "portions of test food", "helpings of test food"]) {
        for (const tail of ["", " chunks", " pieces"]) {
          expect(at(`${hint}${tail}`, 3, unit), `${hint}${tail} by ${unit}`).toEqual({ gramsPoint: 150, gramsRange: [150, 150], portionSource: "default", pieces: 3 });
        }
      }
      for (const tail of ["", " chunks", " slices", " pieces"]) {
        // One container's count is of what it holds, as the same food shown in that container is.
        expect(at(`a large bowl of test food${tail}`, 3, unit), `a large bowl of test food${tail} by ${unit}`).toEqual(at(`test food${tail}`, 3, unit, "large_bowl"));
        expect(at(`a plate of test food${tail}`, 3, unit), `a plate of test food${tail} by ${unit}`).toEqual(at(`test food${tail}`, 3, unit, "plate"));
        // A plural the photo's container is not is counted as the food shown in that
        // container: scoops in a cup are not cups, nor mugs in a katori katoris.
        expect(at(`scoops of test food${tail}`, 3, unit, "cup"), `scoops of test food${tail} by ${unit}`).toEqual(at(`test food${tail}`, 3, unit, "cup"));
        expect(at(`mugs of test food${tail}`, 3, unit, "standard_katori"), `mugs of test food${tail} by ${unit}`).toEqual(at(`test food${tail}`, 3, unit, "standard_katori"));
        expect(at(`handfuls of test food${tail}`, 3, unit, "my_plate"), `handfuls of test food${tail} by ${unit}`).toEqual(at(`test food${tail}`, 3, unit, "my_plate"));
        // A plural that names no container says how the food lies, and its count is
        // read as its singular's is: a stack of eight rotis is eight rotis either way.
        for (const word of ["stack", "pile", "heap", "row", "layer", "handful", "plateful", "scoop", "bunch"]) {
          expect(at(`${plural(word)} of test food${tail}`, 3, unit), `${plural(word)} of test food${tail} by ${unit}`).toEqual(at(`${word} of test food${tail}`, 3, unit));
        }
      }
      // A plural counts the photo's containers only where it names what the
      // container is: the words of its name that name a container, wherever they
      // stand, and never a serving word where another is; a name with none is its
      // last word. So three servings in a serving bowl, or thalis in a thali
      // section, are the food shown in it; three bowls in a bowl with lid, and three
      // katoris or three bowls in a katori or small bowl, are three of it.
      for (const [names, sized] of [[APPENDIX_B_KINDS, true], [FREE_TEXT_KINDS, false]] as const) {
        for (const [name, kinds] of Object.entries(names)) {
          for (const word of name.split(/[^a-z]+/).filter((w) => w !== "" && w !== "or")) {
            for (const tail of ["", " chunks", " pieces"]) {
              const hint = `${plural(word)} of test food${tail}`;
              const one = at(hint, null, unit, name);
              const containers = sized || rule === "vessel"
                ? { gramsPoint: one.gramsPoint * 3, gramsRange: [one.gramsRange[0] * 3, one.gramsRange[1] * 3], portionSource: one.portionSource, pieces: 3 }
                : one;
              expect(at(hint, 3, unit, name), `${hint} in ${name} by ${unit}`).toEqual(kinds.includes(word) ? containers : at(`test food${tail}`, 3, unit, name));
            }
          }
        }
      }
      // A container named in the plural is what its singular is.
      for (const [hint, name] of [["bowls of test food", "glass bowl"], ["flasks of test food", "steel flask"]] as const) {
        expect(at(hint, 3, unit, `${name}s`), `${hint} in ${name}s by ${unit}`).toEqual(at(hint, 3, unit, name));
      }
    }
    expect(Object.keys(APPENDIX_B_KINDS).sort()).toEqual(Object.keys(CONTAINER_PRIORS).sort());
    // The containers a plural before "of" can count where the photo shows none: what
    // each Appendix B container is, the vessel and pack units that name a container
    // (not a measure, "half cup", or a size, "small"), a plate, a tray and the
    // serving words. A dish the person saved counts by its own name ("flasks" above).
    expect([...CONTAINER_WORDS].sort()).toEqual([
      "bag", "bottle", "bowl", "box", "can", "carton", "container", "cup", "glass", "helping", "jar", "katori",
      "mug", "pack", "package", "packet", "plate", "portion", "pot", "pouch", "sachet", "section", "serving",
      "tablespoon", "teaspoon", "tray", "tub", "tumbler",
    ]);
    // A cut or "pieces" before the "of" names the cut or the pieces, not a container,
    // and is read as the same word after the food is, by every unit.
    for (const unit of COUNT_RULES.keys()) {
      for (const word of [...CUT_WORDS.keys(), "piece", "pieces"]) {
        expect(at(`${word} of test food`, 3, unit), `${word} of test food by ${unit}`).toEqual(at(`test food ${word}`, 3, unit));
      }
    }
    expect(at("slices of test food", 3, "cup")).toEqual({ gramsPoint: 50, gramsRange: [50, 50], portionSource: "default", pieces: null });
    expect(at("pieces of test food", 3, "nugget")).toEqual({ gramsPoint: 150, gramsRange: [150, 150], portionSource: "default", pieces: 3 });
  });

  it("reads servings, stacks and piles, and containers named kind first, by the food list's own servings", () => {
    // Each hint's food and serving are the list's, found as the scan finds them.
    const listed = (hint: string, canonical: string): { grams: number; unit: string } => {
      const food = findCurated(hint);
      if (food?.canonical !== canonical) throw new Error(`${hint} is ${food?.canonical ?? "no food"}, not ${canonical}`);
      return { grams: food.serving, unit: food.unit };
    };
    const at = (hint: string, canonical: string, count: number, container: string | null = null) =>
      resolvePortion({ canonicalHint: hint, container, fillLevel: null, sizeClass: null, count }, [], listed(hint, canonical));
    const flat = (grams: number, pieces: number | null) => ({ gramsPoint: grams, gramsRange: [grams, grams], portionSource: "default", pieces });
    const nugget = listed("servings of chicken nuggets", "chicken_nuggets").grams;
    const rice = listed("servings of rice", "rice_white_cooked").grams;
    const pancake = listed("stacks of pancakes", "pancakes").grams;
    const stew = listed("bowls of beef stew chunks", "beef_stew").grams;
    const palakPaneer = listed("cups of palak paneer cubes", "palak_paneer").grams;
    // Six servings of nuggets are six nuggets, in a serving bowl or on a serving
    // plate as on nothing: a serving bowl is a bowl, not a serving, and so is a bowl
    // whose name ends in one.
    for (const container of ["serving_bowl", "serving bowl", "serving_plate", "bowl (1 serving)", null]) {
      expect(at("servings of chicken nuggets", "chicken_nuggets", 6, container), String(container)).toEqual(flat(6 * nugget, 6));
    }
    // Three servings of rice, or two of pasta, in a serving bowl are that bowl, as
    // rice shown in it is; on nothing, three of rice's servings.
    expect(at("servings of rice", "rice_white_cooked", 3, "serving_bowl")).toEqual({ gramsPoint: 350, gramsRange: [300, 400], portionSource: "regional_prior", pieces: null });
    expect(at("servings of pasta", "pasta_cooked", 2, "serving_bowl")).toEqual(at("pasta", "pasta_cooked", 2, "serving_bowl"));
    expect(at("servings of rice", "rice_white_cooked", 3)).toEqual(flat(3 * rice, 3));
    // A container named by a serving word alone is that serving: three servings of
    // rice in a "serving", portions in a "portion" or helpings in a "helping" are
    // three of rice's servings, as on nothing.
    for (const word of ["serving", "portion", "helping"]) {
      expect(at(`${word}s of rice`, "rice_white_cooked", 3, word), word).toEqual(flat(3 * rice, 3));
    }
    // Stacks and piles are how food lies, not what it sits in: eight rotis, six
    // pancakes and ten nuggets are that many, and six stew chunks one cup of stew.
    expect(at("stacks of roti", "roti_chapati", 8)).toEqual({ gramsPoint: 320, gramsRange: [280, 360], portionSource: "regional_prior", pieces: 8 });
    expect(at("stacks of pancakes", "pancakes", 6)).toEqual(flat(6 * pancake, 6));
    expect(at("piles of chicken nuggets", "chicken_nuggets", 10)).toEqual(flat(10 * nugget, 10));
    expect(at("piles of beef stew chunks", "beef_stew", 6)).toEqual(flat(stew, null));
    // A container named kind first is that kind: two bowls of stew chunks in a bowl
    // with lid are two bowls, as in a bowl; two plates of nuggets on a plate with
    // rice are plates of no known size, so the count is not used, as on a plate;
    // and two cups of palak paneer cubes in a cup and saucer are two cups.
    for (const container of ["bowl", "bowl with lid", "bowl (small)"]) {
      expect(at("bowls of beef stew chunks", "beef_stew", 2, container), container).toEqual(flat(2 * stew, 2));
    }
    for (const container of ["plate", "plate with rice", "steel plate (thali)"]) {
      expect(at("plates of chicken nuggets", "chicken_nuggets", 2, container), container).toEqual(flat(nugget, null));
    }
    expect(at("cups of palak paneer cubes", "palak_paneer", 2, "cup and saucer")).toEqual(flat(2 * palakPaneer, 2));
    // Katoris or bowls in a katori or small bowl are that many of it, 175 g each.
    for (const hint of ["katoris of test food", "bowls of test food"]) {
      expect(resolvePortion({ canonicalHint: hint, container: "katori_or_small_bowl", fillLevel: null, sizeClass: null, count: 3 }, [], { grams: 100, unit: "g" }), hint)
        .toEqual({ gramsPoint: 525, gramsRange: [450, 600], portionSource: "regional_prior", pieces: 3 });
    }
  });

  it("never finds a container, piece or mound on an object's prototype", () => {
    const rice = { grams: 100, unit: "g" };
    const plain = { gramsPoint: 100, gramsRange: [100, 100], portionSource: "default", pieces: null };
    for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
      expect(resolvePortion({ canonicalHint: "rice", container: name, fillLevel: 1, sizeClass: null, count: null }, [], rice), name).toEqual(plain);
      expect(resolvePortion({ canonicalHint: "rice", container: null, fillLevel: null, sizeClass: name, count: null }, [], rice), name).toEqual(plain);
      expect(resolvePortion({ canonicalHint: `${name} of rice`, container: null, fillLevel: null, sizeClass: null, count: 2 }, [], rice), name).toEqual(plain);
      expect(resolvePortion({ canonicalHint: name, container: null, fillLevel: null, sizeClass: null, count: 2 }, [], { grams: 50, unit: name }), name).toEqual({ ...plain, gramsPoint: 50, gramsRange: [50, 50] });
    }
  });

  it("uses no count that would weigh more than one item of a meal may, nor one past the stepper", async () => {
    const ramen = { grams: 490, unit: "bowl" };
    const bowls = (count: number) => resolvePortion({ canonicalHint: "ramen bowl", container: null, fillLevel: null, sizeClass: null, count }, [], ramen);
    expect(MAX_ITEM_GRAMS).toBe(10_000);
    expect(bowls(20)).toEqual({ gramsPoint: 9800, gramsRange: [9800, 9800], portionSource: "default", pieces: 20 });
    expect(bowls(21)).toEqual({ gramsPoint: 490, gramsRange: [490, 490], portionSource: "default", pieces: null });
    // The cap is on the top of the range, not its middle: 29 mugs of coffee are
    // 9,425 g in the middle and 10,150 g at the top, so the count is not used.
    const mugs = (count: number, canonicalHint = "coffee", container: string | null = "mug") =>
      resolvePortion({ canonicalHint, container, fillLevel: null, sizeClass: null, count }, [], { grams: 240, unit: "cup" });
    const oneMug = { gramsPoint: 325, gramsRange: [300, 350], portionSource: "regional_prior", pieces: null };
    expect(mugs(28)).toEqual({ gramsPoint: 9100, gramsRange: [8400, 9800], portionSource: "regional_prior", pieces: 28 });
    expect(mugs(29)).toEqual(oneMug);
    expect(mugs(30)).toEqual(oneMug);
    expect(mugs(29, "mugs of coffee", null)).toEqual(oneMug);
    expect(mugs(28, "mugs of coffee", null)).toEqual(mugs(28));
    // The scan reads a count that is not a whole number from 1 to the sheet's
    // stepper as unknown, and keeps the item: a bad count never loses a paid scan.
    expect(MAX_PHOTO_COUNT).toBe(30);
    const reply = (items: unknown[]) => wrap({ meal_name: "x", unknown_items: [], photo_quality: "good", items });
    const item = { name: "x", canonical_hint: "x", container: null, fill_level: null, size_class: null };
    const counts = async (...values: unknown[]) => {
      const provider = createGroqVisionProvider("dummy-key", "m", reply(values.map((count) => ({ ...item, count })))); // gitleaks:allow
      return (await provider.analyze("AA==", "image/jpeg")).evidence.items.map((scanned) => scanned.count);
    };
    expect(await counts(1, 30, null)).toEqual([1, 30, null]);
    const bad = [31, 400, 0, -2, 2.5, 30.5, "3", "many", true, {}, []];
    expect(await counts(...bad)).toEqual(bad.map(() => null));
    // A count left out is unknown, as every field the model cannot fill is (RULINGS 2026-09-15).
    expect((await createGroqVisionProvider("dummy-key", "m", reply([item])).analyze("AA==", "image/jpeg")).evidence.items.map((scanned) => scanned.count)).toEqual([null]); // gitleaks:allow
  });

  it("reads a count of every serving unit the same way in every container: pieces, vessels, or not at all", () => {
    const dishware = [{ containerClass: "my_glass", volumeMl: 400, foodHint: null }];
    for (const [unit, rule] of COUNT_RULES) {
      const serving = { grams: 50, unit };
      for (const container of [null, "mug", "cup", "standard_katori", "thali_section", "my_glass", "no_such_vessel", "glass", "bowl", "can", unit]) {
        for (const fillLevel of [null, 0.5]) {
          const seen = { canonicalHint: "test food", container, fillLevel, sizeClass: null };
          const uncounted = resolvePortion({ ...seen, count: null }, dishware, serving);
          expect(uncounted.pieces, unit).toBeNull();
          for (const count of [1, 3]) {
            const expected =
              rule === "piece" ? { gramsPoint: 50 * count, gramsRange: [50 * count, 50 * count], portionSource: "default", pieces: count }
              : rule === "vessel" ? { gramsPoint: uncounted.gramsPoint * count, gramsRange: [uncounted.gramsRange[0] * count, uncounted.gramsRange[1] * count], portionSource: uncounted.portionSource, pieces: count }
              : uncounted;
            expect(resolvePortion({ ...seen, count }, dishware, serving), `${unit} ×${String(count)} in ${container ?? "nothing"}`).toEqual(expected);
          }
        }
      }
    }
    // A cut word makes a count one of cut bits whatever the unit's rule, piece, vessel
    // or none, in every container: the count is not used, and the grams are the
    // uncounted ones. Only a unit that is itself the cut (a slice, a half) counts it.
    expect([...COUNT_RULES.keys()].filter((unit) => CUT_WORDS.get(unit) === unit)).toEqual(["half", "slice"]);
    for (const [unit, rule] of COUNT_RULES) {
      for (const container of [null, "mug", "cup", "my_glass"]) {
        const seen = { canonicalHint: "test food", container, fillLevel: null, sizeClass: null };
        const uncounted = resolvePortion({ ...seen, count: null }, dishware, { grams: 50, unit });
        const plain = resolvePortion({ ...seen, count: 4 }, dishware, { grams: 50, unit });
        for (const [word, cut] of CUT_WORDS) {
          const got = resolvePortion({ ...seen, canonicalHint: `test food ${word}`, count: 4 }, dishware, { grams: 50, unit });
          const own = (unit === "half" || unit === "slice") && unit === cut && rule !== "none";
          expect(got, `${word} of ${unit} in ${container ?? "nothing"}`).toEqual(own ? plain : uncounted);
        }
      }
    }
    // "Pieces" counts whole things of exactly these pieces, written out here so the
    // list cannot change without this test: the serving units and Appendix B keys
    // people count as pieces. Of every other unit, and every other key, "pieces"
    // are cut bits.
    const WHOLE = ["bread_slice", "chapati", "idli", "meatball", "medu_vada", "nugget", "piece", "puri", "roti", "samosa", "slice"];
    expect([...WHOLE_PIECES].sort()).toEqual(WHOLE);
    for (const [unit, rule] of COUNT_RULES) {
      const got = resolvePortion({ canonicalHint: "test food pieces", container: null, fillLevel: null, sizeClass: null, count: 4 }, [], { grams: 50, unit });
      expect(got.pieces, unit).toBe(rule === "piece" && WHOLE.includes(unit) ? 4 : null);
    }
    for (const key of Object.keys(COUNTABLE_PRIORS)) {
      const got = resolvePortion({ canonicalHint: `${key.replaceAll("_", " ")} pieces`, container: null, fillLevel: null, sizeClass: null, count: 4 }, [], { grams: 50, unit: "g" });
      expect(got.pieces, key).toBe(WHOLE.includes(key) ? 4 : null);
    }
    expect(WHOLE.filter((piece) => COUNT_RULES.get(piece) !== "piece" && !(piece in COUNTABLE_PRIORS))).toEqual([]);
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
    // …but never the two fields the evidence contract requires of every item.
    expect(MEAL_VISION_PROMPT).toContain("Every item always has both name and canonical_hint; a food you cannot name goes in unknown_items, not in items.");
    // Kd's reading instructions, word for word (RULINGS 2026-08-24: the prompt is not shortened).
    expect(MEAL_VISION_PROMPT).toContain(
      'For canonical_hint, prefer the common everyday or local name of the dish over a generic or fancy description — for example "roti" not "flatbread stack", "dal" not "lentil stew", "paneer" not "cottage cheese", "biryani" not "rice dish". Count only reliably countable items. Say unknown instead of guessing. Never output calories, kcal, grams, quantities by weight, protein, carbohydrates, fat, fibre, or any nutrition arithmetic.',
    );
  });

  it("resolver covers thali_section weight-prior and density-class branches (T3 R9 gap)", () => {
    // thali_section prior is GRAMS (100–150), not ml×density (Appendix B).
    expect(
      resolvePortion({ canonicalHint: "dal", container: "thali_section", fillLevel: 1, sizeClass: null, count: null }, [], { grams: 100, unit: "g" }),
    ).toEqual({ gramsPoint: 125, gramsRange: [100, 150], portionSource: "regional_prior", pieces: null });
    // Density classes over the same katori: thin rasam 0.95 vs thick sabzi 1.1.
    const thin = resolvePortion({ canonicalHint: "rasam", container: "standard_katori", fillLevel: 1, sizeClass: null, count: null }, [], { grams: 100, unit: "g" });
    const thick = resolvePortion({ canonicalHint: "dry_sabzi", container: "standard_katori", fillLevel: 1, sizeClass: null, count: null }, [], { grams: 100, unit: "g" });
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
    // The adapter serves each product by its label, so a scan's count of its bottles multiplies it.
    const { createOpenFoodFactsProvider } = await import("../src/modules/nutrition/openfoodfacts.adapter.js");
    const yakult = { hits: [{ code: "4901392000034", product_name: "Yakult Original", brands: "Yakult", serving_size: "1 bottle (65 ml)", nutriments: { "energy-kcal_100g": 65 } }] };
    const [product] = await createOpenFoodFactsProvider(() => Promise.resolve(new Response(JSON.stringify(yakult), { status: 200 }))).search("yakult", 1);
    expect(product).toMatchObject({ serving: 65, unit: "bottle" });
    if (product === undefined) throw new Error("no product");
    expect(resolvePortion({ canonicalHint: "bottles of yakult", container: null, fillLevel: null, sizeClass: null, count: 3 }, [], { grams: product.serving, unit: product.unit }))
      .toEqual({ gramsPoint: 195, gramsRange: [195, 195], portionSource: "default", pieces: 3 });
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
    // A meal name that says there is none is no name, as a container's is.
    for (const none of ["N/A", "none", "null", "None", "", "  "]) {
      const named = createGroqVisionProvider("dummy-key", "m", wrap({ meal_name: none, items: [{ name: "x", canonical_hint: "x" }], photo_quality: "good" })); // gitleaks:allow
      expect((await named.analyze("AA==", "image/jpeg")).evidence.meal_name, JSON.stringify(none)).toBeNull();
    }
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
    // What the model answered and cannot be used is "unreadable"; an envelope that is not Gemini's is no answer at all.
    const cases: [string, unknown, number, VisionProviderError["kind"]][] = [
      ["vision blocked", { candidates: [], promptFeedback: { blockReason: "SAFETY" }, usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 0 } }, 0, "unreadable"],
      ["vision empty completion", { candidates: [{ content: { parts: [] } }], usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 0 } }, 0, "unreadable"],
      ["vision malformed evidence JSON", { candidates: [{ content: { parts: [{ text: "{not json" }] } }], usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 5 } }, 5, "unreadable"],
      ["vision malformed evidence shape", { candidates: [{ content: { parts: [{ text: '{"meal_name":"x","items":[{"name":"x","canonical_hint":"x","kcal":100}],"unknown_items":[],"photo_quality":"good"}' }] } }], usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 50 } }, 50, "unreadable"],
      ["vision malformed completion", { candidates: "nope" }, 0, "unavailable"],
    ];
    for (const [message, reply, tokensOut, kind] of cases) {
      const err = await failure(createGeminiVisionProvider("k", "m", geminiFetch(reply).fetchImpl).analyze("AA==", "image/jpeg"));
      expect(err.message, message).toBe(message);
      expect(err.kind, message).toBe(kind);
      expect(err.usage, message).toEqual({ tokensIn: message === "vision malformed completion" ? 0 : 500, tokensOut });
    }
  });

  it("an HTTP error, a network failure and a reply that is not the provider's are the scanner's outage, on both providers; the first two carry no usage", async () => {
    const notJson: typeof fetch = () => Promise.resolve(new Response("<html>busy</html>", { status: 200 }));
    const down: typeof fetch = () => Promise.reject(new Error("ECONNRESET"));
    const makers: [string, (f: typeof fetch) => ReturnType<typeof createGroqVisionProvider>][] = [
      ["gemini", (f) => createGeminiVisionProvider("k", "m", f)],
      ["groq", (f) => createGroqVisionProvider("k", "m", f)],
    ];
    for (const [provider, make] of makers) {
      const http = await failure(make(geminiFetch({ error: { code: 429 } }, 429).fetchImpl).analyze("AA==", "image/jpeg"));
      expect([http.message, http.kind, http.usage], provider).toEqual(["vision HTTP 429", "unavailable", undefined]);
      const network = await failure(make(down).analyze("AA==", "image/jpeg"));
      expect([network.message, network.kind, network.usage], provider).toEqual(["vision network failure", "unavailable", undefined]);
      const html = await failure(make(notJson).analyze("AA==", "image/jpeg"));
      expect([html.message, html.kind], provider).toEqual(["vision non-JSON response", "unavailable"]);
      const envelope = await failure(make(geminiFetch({ choices: "nope", candidates: "nope" }).fetchImpl).analyze("AA==", "image/jpeg"));
      expect([envelope.message, envelope.kind], provider).toEqual(["vision malformed completion", "unavailable"]);
    }
    // A Groq reply that breaks the evidence contract is the model's answer, as on Gemini.
    const groqBroken = await failure(createGroqVisionProvider("k", "m", wrap({ meal_name: "x", items: [{ name: "x", canonical_hint: "x", kcal: 1 }], photo_quality: "good" })).analyze("AA==", "image/jpeg"));
    expect([groqBroken.message, groqBroken.kind]).toEqual(["vision malformed evidence shape", "unreadable"]);
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
