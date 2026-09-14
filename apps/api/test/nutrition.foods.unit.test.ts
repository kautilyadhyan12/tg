// The curated food list (ROADMAP 7a-i): every food's numbers from a named table,
// its diet, and the name matching the photo scan and saved meals rely on.
// `tools/check-food-sources.ts` compares every number with its table; these
// tests hold what can be held without downloading the tables.
import { describe, expect, it } from "vitest";
import { DIET_LADDER, dietSchema } from "@app/shared";
import { CURATED_FOODS, FOOD_ALIASES, findCurated, searchCurated, type CuratedFood } from "../src/modules/nutrition/foods.js";

/** Every canonical the list held before it grew. Editing a saved meal finds its
 *  foods again by canonical, so none of these may go missing. */
const CANONICALS_BEFORE = [
  "chicken_breast_cooked", "chicken_thigh_cooked", "ground_beef_85_cooked",
  "ground_beef_90_cooked", "steak_sirloin_cooked", "pork_chop_cooked", "bacon_cooked",
  "turkey_breast_cooked", "lamb_cooked", "salmon_cooked", "tuna_canned_in_water", "tilapia_cooked",
  "cod_cooked", "shrimp_cooked", "sardines_canned_in_oil", "egg_whole_large", "egg_white",
  "greek_yogurt_plain", "cottage_cheese_low_fat", "milk_whole", "milk_skim", "cheddar_cheese",
  "mozzarella_cheese", "butter", "tofu_firm", "tempeh", "lentils_cooked", "chickpeas_cooked",
  "black_beans_cooked", "kidney_beans_cooked", "edamame_cooked", "rice_white_cooked",
  "rice_brown_cooked", "oats_dry", "quinoa_cooked", "pasta_cooked", "whole_wheat_bread",
  "white_bread", "tortilla_flour", "bagel_plain", "cereal_cornflakes", "granola", "potato_baked",
  "sweet_potato_baked", "french_fries", "corn_cooked", "broccoli_cooked", "spinach_raw",
  "kale_cooked", "carrots_raw", "bell_pepper", "cucumber", "tomato", "lettuce", "onion",
  "mushrooms", "asparagus_cooked", "zucchini", "cauliflower_cooked", "brussels_sprouts", "cabbage",
  "avocado", "apple", "banana", "orange", "strawberries", "blueberries", "grapes", "watermelon",
  "mango", "pineapple", "pear", "peach", "kiwi", "almonds", "peanuts", "walnuts", "cashews",
  "peanut_butter", "almond_butter", "chia_seeds", "flax_seeds", "sunflower_seeds", "olive_oil",
  "coconut_oil", "vegetable_oil", "mayonnaise", "coffee_black", "tea_unsweetened", "orange_juice",
  "apple_juice", "coke_cola", "beer_regular", "wine_red", "whey_protein_powder", "pizza_cheese",
  "pizza_pepperoni", "hamburger_fast_food", "hot_dog", "sushi_roll", "burrito_chicken",
  "sandwich_turkey", "caesar_salad_with_chicken", "fried_rice", "mac_and_cheese",
  "chocolate_dark_70", "chocolate_chip_cookie", "ice_cream_vanilla", "potato_chips", "pretzels",
  "popcorn_plain", "honey", "sugar_white", "donut_glazed", "croissant", "roti_chapati", "naan",
  "dal_lentil_curry", "paneer", "chicken_curry", "butter_chicken", "biryani_chicken", "samosa",
  "idli", "dosa_plain", "ramen_cooked", "pad_thai", "spring_roll", "dumplings_pork", "pho_beef",
  "curd_dahi",
];

const food = (canonical: string): CuratedFood => {
  const hit = CURATED_FOODS.find((f) => f.canonical === canonical);
  if (hit === undefined) throw new Error(`no food ${canonical}`);
  return hit;
};

/** A name's words, lower case, each without a plural "s". */
const nameWords = (name: string): string[] =>
  name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w !== "").map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));

describe("the curated food list", () => {
  it("gives every food a table entry, a diet, whole kcal per 100 g and a serving", () => {
    expect(CURATED_FOODS).toHaveLength(317);
    for (const f of CURATED_FOODS) {
      expect(f.citation, f.name).toMatch(/^(?:usda-sr:\d{6}|usda-fndds:\d{7}|uk-cofid:\d{2}-\d{3,4})$/);
      expect(dietSchema.options, f.name).toContain(f.diet);
      expect(Number.isInteger(f.kcal), f.name).toBe(true);
      expect(f.kcal, f.name).toBeGreaterThanOrEqual(0);
      expect(f.kcal, f.name).toBeLessThanOrEqual(900);
      for (const grams of [f.proteinG, f.carbsG, f.fatG]) expect(grams, f.name).toBeGreaterThanOrEqual(0);
      expect(f.proteinG + f.carbsG + f.fatG, f.name).toBeLessThanOrEqual(100);
      if (f.fiberG !== null) {
        expect(f.fiberG, f.name).toBeGreaterThanOrEqual(0);
        expect(f.fiberG, f.name).toBeLessThanOrEqual(100);
      }
      expect(f.serving, f.name).toBeGreaterThan(0);
      expect(f.unit.trim(), f.name).not.toBe("");
    }
  });

  it("never lists two foods under one name, one canonical or one table entry", () => {
    expect(new Set(CURATED_FOODS.map((f) => f.name.toLowerCase())).size).toBe(CURATED_FOODS.length);
    expect(new Set(CURATED_FOODS.map((f) => f.canonical)).size).toBe(CURATED_FOODS.length);
    expect(new Set(CURATED_FOODS.map((f) => f.citation)).size).toBe(CURATED_FOODS.length);
  });

  it("has energy that agrees with its protein, carbohydrate and fat (drinks with alcohol aside)", () => {
    // A figure copied into the wrong place (1650 for 165, fat for protein) breaks
    // this; the tables' own energy factors stay well inside it.
    const alcohol = new Set(["beer_regular", "beer_light", "wine_red", "wine_white", "spirits_vodka_gin_rum_whiskey"]);
    for (const f of CURATED_FOODS) {
      if (alcohol.has(f.canonical)) continue;
      const fromMacros = 4 * f.proteinG + 4 * f.carbsG + 9 * f.fatG;
      expect(Math.abs(f.kcal - fromMacros), f.name).toBeLessThanOrEqual(Math.max(25, 0.2 * f.kcal));
    }
  });

  it("still finds every food it held before, so a saved meal can be edited", () => {
    expect(CANONICALS_BEFORE).toHaveLength(131);
    for (const canonical of CANONICALS_BEFORE) expect(findCurated(canonical)?.canonical, canonical).toBe(canonical);
  });

  it("counts a food per 100 g, not per piece", () => {
    // The table's figures for an egg, an egg white and an idli, where a list
    // holding one piece's figure as 100 g's would count each at a third to a half.
    expect(food("egg_whole_large")).toMatchObject({ kcal: 143, proteinG: 12.56, serving: 50, citation: "usda-sr:171287" });
    expect(food("egg_white")).toMatchObject({ kcal: 52, proteinG: 10.9, serving: 33, citation: "usda-sr:172183" });
    expect(food("idli")).toMatchObject({ kcal: 128, serving: 38, citation: "usda-fndds:2708346" });
    // A bowl of pho is 400 g of soup at the table's 77 kcal per 100 g.
    expect(food("pho_beef")).toMatchObject({ kcal: 77, serving: 400, citation: "usda-fndds:2707124" });
    expect(Math.round((food("pho_beef").kcal * food("pho_beef").serving) / 100)).toBe(308);
  });
});

describe("a food's diet", () => {
  it("is non-vegetarian for meat and fish, with eggs or above for egg, and vegetarian or above for dairy", () => {
    const MEAT_AND_FISH = ["chicken", "beef", "pork", "bacon", "ham", "turkey", "lamb", "steak", "ribeye", "brisket", "jerky", "meatball", "sausage", "salami", "pepperoni", "rib", "bratwurst", "meat", "carne", "salmon", "tuna", "tilapia", "cod", "shrimp", "sardine", "trout", "mackerel", "herring", "haddock", "bass", "crab", "lobster", "scallop", "mussel", "calamari", "fish", "hamburger", "cheeseburger", "dog", "gyro"];
    const EGG = ["egg", "omelette", "mayonnaise"];
    const DAIRY = ["milk", "cheese", "yogurt", "butter", "cream", "paneer", "curd", "dahi", "kefir", "ghee", "latte", "cappuccino"];
    const PLANT_DAIRY = ["soy", "almond", "oat", "peanut", "coconut"];
    for (const f of CURATED_FOODS) {
      const words = nameWords(f.name);
      if (words.some((w) => MEAT_AND_FISH.includes(w))) expect(f.diet, f.name).toBe("non_vegetarian");
      if (words.some((w) => EGG.includes(w))) expect(DIET_LADDER[f.diet], f.name).toBeGreaterThanOrEqual(DIET_LADDER.vegetarian_eggs);
      if (words.some((w) => DAIRY.includes(w)) && !words.some((w) => PLANT_DAIRY.includes(w))) {
        expect(DIET_LADDER[f.diet], f.name).toBeGreaterThanOrEqual(DIET_LADDER.vegetarian);
      }
    }
  });

  it("follows the animal ingredient a food's name does not show", () => {
    expect(food("honey").diet).toBe("vegetarian");
    expect(food("naan").diet).toBe("vegetarian_eggs");
    expect(food("bread_roll").diet).toBe("vegetarian_eggs");
    expect(food("pesto").diet).toBe("vegetarian");
    expect(food("refried_beans").diet).toBe("non_vegetarian");
    expect(food("caesar_dressing").diet).toBe("non_vegetarian");
    // The survey recipes: dal with ghee, a samosa with butter and yogurt, a Greek
    // salad with anchovy.
    expect(food("dal_lentil_curry").diet).toBe("vegetarian");
    expect(food("samosa").diet).toBe("vegetarian");
    expect(food("greek_salad_no_dressing").diet).toBe("non_vegetarian");
    expect(food("tofu_firm").diet).toBe("vegan");
  });
});

describe("the food a name means", () => {
  it("is found by every food's own name and canonical", () => {
    for (const f of CURATED_FOODS) {
      expect(findCurated(f.name), f.name).toBe(f);
      expect(findCurated(f.canonical), f.canonical).toBe(f);
    }
  });

  it("is on the list for every other name", () => {
    for (const [alias, canonical] of FOOD_ALIASES) {
      expect(CURATED_FOODS.some((f) => f.canonical === canonical), `${alias} → ${canonical}`).toBe(true);
      expect(findCurated(alias)?.canonical, alias).toBe(canonical);
    }
  });

  it("is the food the words name, never a food that only shares part of a word", () => {
    const cases: [string, string][] = [
      ["tea", "tea_unsweetened"], // not the "tea" inside steak
      ["water", "water"], // not tuna canned in water
      ["ham", "ham_sliced"], // not the "ham" inside hamburger
      ["peas", "peas_green_cooked"], // not chickpeas
      ["corn", "corn_cooked"], // not cornflakes
      ["banana bread", "banana_bread"],
      ["apple pie", "apple_pie"],
      ["eggs", "egg_whole_large"],
      ["scrambled eggs", "eggs_scrambled"],
      ["boiled egg", "egg_hard_boiled"],
      ["white rice", "rice_white_cooked"],
      ["brown rice", "rice_brown_cooked"],
      ["cooked chicken breast", "chicken_breast_cooked"],
      ["grilled chicken breast", "chicken_breast_grilled"],
      ["chicken biryani", "biryani_chicken"],
      ["vegetable biryani", "biryani_vegetable"],
      ["chicken tikka masala", "butter_chicken"],
      ["dark chocolate", "chocolate_dark_70"],
      ["Hot Chocolate", "hot_chocolate"],
      ["Beef Stew", "beef_stew"],
      ["curd", "curd_dahi"],
      ["nachos", "nachos_cheese"],
      ["cherries", "cherries"],
      ["tomatoes", "tomato"],
      ["cookies", "chocolate_chip_cookie"],
      ["nugget", "chicken_nuggets"],
      ["paneer tikka", "paneer"],
    ];
    for (const [hint, canonical] of cases) expect(findCurated(hint)?.canonical, hint).toBe(canonical);
  });

  it("drops the words that only say how a food is served, and nothing else", () => {
    expect(findCurated("Flatbread Stack")?.canonical).toBe("roti_chapati");
    expect(findCurated("Pizza Slice")?.canonical).toBe("pizza_cheese");
    expect(findCurated("Ham Slice")?.canonical).toBe("ham_sliced");
    expect(findCurated("sliced banana")?.canonical).toBe("banana");
    expect(findCurated("banana slices")?.canonical).toBe("banana");
    expect(findCurated("glass of milk")?.canonical).toBe("milk_whole");
    expect(findCurated("salmon fillet")?.canonical).toBe("salmon_cooked");
    // Temperature and freshness change what a food is, so they stay.
    expect(findCurated("Hot Tea")).toBeNull();
    expect(findCurated("Iced Coffee")).toBeNull();
  });

  it("is no food at all when a word of the name matches nothing it is", () => {
    // A wrong food is worse than an honest miss: the scan names what it could
    // not identify and leaves it out of the totals.
    for (const hint of ["mango lassi", "strawberry yogurt", "Aloo Paratha", "banana chips", "orange chicken", "fish", "fish curry", "constructor", "__proto__", ""]) {
      expect(findCurated(hint), hint).toBeNull();
    }
  });

  it("lists a whole word before part of a word in the search box", () => {
    // Each of these first results is the ranking's, not the list's order.
    expect(searchCurated("mac", 3)[0]?.canonical).toBe("mac_and_cheese"); // mackerel is listed first
    expect(searchCurated("cola", 3)[0]?.canonical).toBe("coke_cola"); // not the "cola" inside chocolate milk
    expect(searchCurated("pea", 3)[0]?.canonical).toBe("peas_green_cooked");
    expect(searchCurated("ham", 5).map((f) => f.canonical).slice(0, 2)).toEqual(["ham_sliced", "hamburger_fast_food"]);
    expect(searchCurated("corn", 5)[0]?.canonical).toBe("corn_cooked");
    expect(searchCurated("egg", 5)[0]?.canonical).toBe("egg_whole_large");
    expect(searchCurated("flatbread", 5).some((f) => f.canonical === "roti_chapati")).toBe(true);
    expect(searchCurated("aloo", 5).some((f) => f.canonical === "potato_baked")).toBe(true);
    for (const f of CURATED_FOODS) expect(searchCurated(f.name, 1)[0], f.name).toBe(f);
  });
});
