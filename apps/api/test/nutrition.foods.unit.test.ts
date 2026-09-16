// The curated food list (ROADMAP 7a-i): every food's numbers from a named table,
// its diet, and the name matching the photo scan and saved meals rely on.
// `tools/check-food-sources.ts` compares every number with its table; these
// tests hold what can be held without downloading the tables.
import { describe, expect, it } from "vitest";
import { DIET_LADDER, dietSchema, type Diet } from "@app/shared";
import { CURATED_FOODS, FOOD_ALIASES, findCurated, holdsEveryWord, searchCurated, type CuratedFood } from "../src/modules/nutrition/foods.js";

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
    expect(CURATED_FOODS).toHaveLength(318);
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

  it("serves a cola by USDA's own portion, the can, as Diet cola is", () => {
    // "1 can or bottle (12 fl oz)": the measure a photo's count of cans starts its row at.
    expect(food("coke_cola")).toMatchObject({ serving: 370, unit: "can", citation: "usda-sr:174852" });
    expect(food("diet_cola")).toMatchObject({ serving: 370, unit: "can" });
  });

  it("says a name holds a query only where it holds every word the query means", () => {
    expect(holdsEveryWord("Coca-Cola Classic · Coca-Cola", "bottles of coca cola")).toBe(true);
    expect(holdsEveryWord("Chocolate Chip Cookie · Brand", "chocolate_chip_cookies")).toBe(true);
    expect(holdsEveryWord("Mystery", "mystery sauce")).toBe(false);
    expect(holdsEveryWord("Barbecue Lentil Chips", "chips")).toBe(true);
    expect(holdsEveryWord("Hamburger buns", "ham")).toBe(false);
    expect(holdsEveryWord("Anything", "")).toBe(false);
    expect(holdsEveryWord("Anything", "!!!")).toBe(false);
    // A noise word is not needed only where it measures the food, before an "of",
    // or only joins the query's words.
    expect(holdsEveryWord("Coca-Cola Classic · Coca-Cola", "a small glass of coca cola")).toBe(true);
    expect(holdsEveryWord("Glass Noodles · Brand", "a plate of glass noodles")).toBe(true);
    expect(holdsEveryWord("Chicken & Rice · Brand", "chicken with rice")).toBe(true);
    // Anywhere else it is the food's own word, which the name must hold.
    expect(holdsEveryWord("Cup Noodles Chicken · Nissin", "glass noodles")).toBe(false);
    expect(holdsEveryWord("Glass Noodles · Brand", "glass noodles")).toBe(true);
    expect(holdsEveryWord("Coconut milk · Thai Kitchen", "grated coconut")).toBe(false);
    expect(holdsEveryWord("Whole Wheat Bread · Hovis", "shredded wheat")).toBe(false);
    expect(holdsEveryWord("Yakult Original · Yakult", "yakult bottles")).toBe(false);
    // "Of" after a word that is no noise word measures nothing: cream of wheat is no wheat bread.
    expect(holdsEveryWord("Whole Wheat Bread · Hovis", "cream of wheat")).toBe(false);
    // A query of noise words alone is held by no name, even one holding them.
    for (const query of ["cup", "glass", "a cup of", "small cup"]) expect(holdsEveryWord("Cup of glass · a small brand", query), query).toBe(false);
    // Accents are folded on both sides.
    expect(holdsEveryWord("Müller Corner Strawberry · Müller", "muller corner")).toBe(true);
    expect(holdsEveryWord("Crème fraîche · Président", "creme fraiche")).toBe(true);
    expect(holdsEveryWord("Creme fraiche", "crème fraîche")).toBe(true);
  });

  it("keeps both rotis, each from its own table, and roti means the homemade one", () => {
    // USDA's roti is store-bought; the UK table's is made at home without fat (Kd, 2026-09-14).
    expect(food("roti_chapati")).toMatchObject({ name: "Roti / Chapati (homemade flatbread, no fat)", kcal: 202, serving: 40, citation: "uk-cofid:11-459" });
    expect(food("roti_chapati_store_bought_flatbread")).toMatchObject({ kcal: 297, serving: 68, citation: "usda-sr:171844" });
    expect(findCurated("roti")?.canonical).toBe("roti_chapati");
    expect(findCurated("chapatis")?.canonical).toBe("roti_chapati");
    expect(findCurated("store-bought roti")?.canonical).toBe("roti_chapati_store_bought_flatbread");
    // Naan and paratha are USDA's, as the rule says; paneer stays the UK table's.
    expect(food("naan").citation).toBe("usda-sr:171845");
    expect(food("paratha").citation).toBe("usda-sr:174076");
    expect(food("paneer")).toMatchObject({ carbsG: 0.9, citation: "uk-cofid:12-495" });
  });
});

/** Every food's diet, written out, so a label changed on the list must be changed
 *  here too, where a review sees it. Checked against each dish's ingredients as
 *  its table lists them. */
const DIETS: Readonly<Record<Diet, readonly string[]>> = {
  vegan: [
    "tofu_firm", "tempeh", "lentils_cooked", "chickpeas_cooked", "black_beans_cooked", "kidney_beans_cooked",
    "edamame_cooked", "pinto_beans_cooked", "white_beans_cooked", "hummus", "baked_beans_canned", "falafel",
    "rice_white_cooked", "rice_brown_cooked", "oats_dry", "quinoa_cooked", "pasta_cooked", "tortilla_flour",
    "bagel_plain", "cereal_cornflakes", "oatmeal_cooked", "pasta_whole_wheat_cooked", "couscous_cooked",
    "rice_noodles_cooked", "rye_bread", "french_bread_sourdough", "pita_bread", "tortilla_corn", "crackers",
    "rice_cakes", "crispbread_rye", "potato_baked", "sweet_potato_baked", "french_fries", "corn_cooked",
    "potato_boiled", "hash_browns", "butternut_squash_cooked", "broccoli_cooked", "spinach_raw", "kale_cooked",
    "carrots_raw", "bell_pepper", "cucumber", "tomato", "lettuce", "onion", "mushrooms", "asparagus_cooked",
    "zucchini", "cauliflower_cooked", "brussels_sprouts", "cabbage", "avocado", "green_beans_cooked", "celery",
    "eggplant_cooked", "beets_cooked", "spinach_cooked", "carrots_cooked", "peas_green_cooked", "arugula",
    "okra_cooked", "sauerkraut", "pickles", "olives", "mixed_vegetables_cooked", "salad_green_no_dressing",
    "apple", "banana", "orange", "strawberries", "blueberries", "grapes", "watermelon", "mango", "pineapple",
    "pear", "peach", "kiwi", "raspberries", "blackberries", "cherries", "plum", "grapefruit", "cantaloupe",
    "clementine", "dates_medjool", "raisins", "pomegranate", "applesauce_unsweetened", "almonds", "peanuts",
    "walnuts", "cashews", "peanut_butter", "almond_butter", "chia_seeds", "flax_seeds", "sunflower_seeds",
    "pistachios", "pecans", "hazelnuts", "pumpkin_seeds", "mixed_nuts", "trail_mix", "olive_oil", "coconut_oil",
    "vegetable_oil", "ketchup", "mustard", "bbq_sauce", "soy_sauce", "jam", "maple_syrup",
    "tomato_sauce_marinara", "salsa", "guacamole", "coffee_black", "tea_unsweetened", "orange_juice",
    "apple_juice", "coke_cola", "beer_regular", "wine_red", "sports_drink", "energy_drink", "diet_cola",
    "wine_white", "beer_light", "spirits_vodka_gin_rum_whiskey", "soy_milk", "almond_milk", "oat_milk", "water",
    "tomato_soup", "lentil_soup", "potato_chips", "pretzels", "popcorn_plain", "sugar_white", "tortilla_chips",
    "roti_chapati", "roti_chapati_store_bought_flatbread", "idli", "dosa_plain",
  ],
  vegetarian: [
    "greek_yogurt_plain", "cottage_cheese_low_fat", "milk_whole", "milk_skim", "cheddar_cheese",
    "mozzarella_cheese", "butter", "curd_dahi", "milk_2", "milk_1", "chocolate_milk", "yogurt_plain_low_fat",
    "yogurt_fruit_low_fat", "cream_cheese", "parmesan_cheese", "feta_cheese", "swiss_cheese", "brie",
    "goat_cheese", "sour_cream", "heavy_cream", "kefir", "cottage_cheese_full_fat", "ghee", "whole_wheat_bread",
    "white_bread", "granola", "multigrain_bread", "english_muffin", "muesli", "mashed_potatoes",
    "roast_potatoes", "italian_dressing", "pesto", "whey_protein_powder", "latte", "cappuccino",
    "hot_chocolate", "smoothie_fruit", "protein_shake_ready_to_drink", "pizza_cheese", "mac_and_cheese",
    "grilled_cheese_sandwich", "peanut_butter_and_jelly_sandwich", "quesadilla_cheese", "nachos_cheese",
    "chocolate_dark_70", "honey", "protein_bar", "granola_bar", "milk_chocolate", "apple_pie",
    "dal_lentil_curry", "paneer", "samosa", "palak_paneer", "chana_masala", "vegetable_curry",
    "biryani_vegetable", "paratha",
  ],
  vegetarian_eggs: [
    "egg_whole_large", "egg_white", "egg_hard_boiled", "eggs_scrambled", "egg_fried", "egg_poached",
    "omelette_plain", "egg_noodles_cooked", "bread_roll", "pancakes", "waffles", "french_toast", "coleslaw",
    "mayonnaise", "ranch_dressing", "fried_rice", "veggie_burger", "potato_salad", "chocolate_chip_cookie",
    "ice_cream_vanilla", "donut_glazed", "croissant", "brownie", "cheesecake", "blueberry_muffin",
    "chocolate_cake", "banana_bread", "naan", "spring_roll",
  ],
  non_vegetarian: [
    "chicken_breast_cooked", "chicken_thigh_cooked", "ground_beef_85_cooked", "ground_beef_90_cooked",
    "steak_sirloin_cooked", "pork_chop_cooked", "bacon_cooked", "turkey_breast_cooked", "lamb_cooked",
    "chicken_breast_grilled", "chicken_drumstick_cooked", "chicken_wings_cooked", "rotisserie_chicken",
    "fried_chicken", "chicken_nuggets", "ground_turkey_cooked", "turkey_deli_slices", "ribeye_steak_cooked",
    "beef_brisket_cooked", "beef_jerky", "meatballs_in_sauce", "ground_beef_80_cooked", "ham_sliced",
    "pork_tenderloin_cooked", "pulled_pork_barbecue", "pork_sausage_cooked", "salami", "pepperoni",
    "pork_ribs_cooked", "bratwurst", "lamb_chop_cooked", "turkey_bacon_cooked", "salmon_cooked",
    "tuna_canned_in_water", "tilapia_cooked", "cod_cooked", "shrimp_cooked", "sardines_canned_in_oil",
    "tuna_steak_cooked", "salmon_canned", "smoked_salmon", "trout_cooked", "mackerel_cooked", "herring_pickled",
    "haddock_cooked", "sea_bass_cooked", "crab_cooked", "lobster_cooked", "scallops_cooked", "mussels_cooked",
    "calamari_fried", "fish_sticks", "fried_fish_coated", "tuna_salad", "refried_beans", "caesar_dressing",
    "pizza_pepperoni", "hamburger_fast_food", "hot_dog", "sushi_roll", "burrito_chicken", "sandwich_turkey",
    "caesar_salad_with_chicken", "spaghetti_bolognese", "lasagna_meat", "chili_con_carne", "beef_stew",
    "chicken_noodle_soup", "tacos_beef", "cheeseburger", "chicken_sandwich_fried", "shepherd_s_pie",
    "chicken_stir_fry_with_vegetables", "greek_salad_no_dressing", "gyro", "chicken_curry", "butter_chicken",
    "biryani_chicken", "ramen_cooked", "pad_thai", "dumplings_pork", "pho_beef", "ramen_bowl",
  ],
};

describe("a food's diet", () => {
  it("is the one written out for every food, and no food is left out or listed twice", () => {
    const listed = Object.values(DIETS).flat();
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(CURATED_FOODS.map((f) => f.canonical).sort());
    for (const diet of dietSchema.options) {
      for (const canonical of DIETS[diet]) expect(food(canonical).diet, canonical).toBe(diet);
    }
  });

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
      // An Indian dish by its English name too (Kd, 2026-09-14), and never the
      // English food of the same words: cottage cheese is still cottage cheese.
      ["indian cottage cheese", "paneer"],
      ["cottage cheese", "cottage_cheese_low_fat"],
      ["lentil curry", "dal_lentil_curry"],
      ["chickpea curry", "chana_masala"],
      ["naan bread", "naan"],
      // Other spellings.
      ["shepherds pie", "shepherd_s_pie"],
      ["chilli", "chili_con_carne"],
      ["chilli con carne", "chili_con_carne"],
      // A renamed food's old canonical is still that food, and so is its old name.
      ["spring_roll", "spring_roll"],
      ["spring roll", "spring_roll"],
      ["spring rolls", "spring_roll"],
      ["greek_yogurt_plain", "greek_yogurt_plain"],
    ];
    for (const [hint, canonical] of cases) expect(findCurated(hint)?.canonical, hint).toBe(canonical);
  });

  it("is the homemade roti for its names in any order or plural, and the store-bought one only when named so", () => {
    // Two versions of one food are told apart by their words, never by whose
    // brackets are shorter: the store-bought roti's name has fewer words.
    const arrangements = (words: readonly string[]): string[][] =>
      words.flatMap((word, at) => [[word], ...arrangements([...words.slice(0, at), ...words.slice(at + 1)]).map((rest) => [word, ...rest])]);
    const orders = arrangements(["roti", "chapati", "flatbread"]);
    expect(orders).toHaveLength(15);
    for (const order of orders) {
      for (const hint of [order.join(" "), `${order.join(" ")}s`, `${order.join("_")}_pieces`]) {
        expect(findCurated(hint)?.canonical, hint).toBe("roti_chapati");
      }
    }
    for (const hint of ["store-bought roti", "store bought chapati", "roti flatbread store bought"]) {
      expect(findCurated(hint)?.canonical, hint).toBe("roti_chapati_store_bought_flatbread");
    }
  });

  it("is found by its canonical before by its words, so a saved food is never another", () => {
    // The store-bought roti's name holds both of roti_chapati's words in fewer
    // words than the homemade one's; a saved homemade roti must stay homemade.
    expect(findCurated("roti_chapati")?.name).toBe("Roti / Chapati (homemade flatbread, no fat)");
    for (const f of CURATED_FOODS) expect(findCurated(f.canonical), f.canonical).toBe(f);
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
    // Words the markets use for different foods: jelly (jam in the US, a gelatine
    // dessert in the UK), chips (crisps or fries), beans (baked beans on a British plate).
    for (const hint of ["jelly", "chips", "beans"]) expect(findCurated(hint), hint).toBeNull();
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

  it("lists an Indian dish when its English name is typed, and both rotis for roti", () => {
    const names = (q: string, limit = 15): string[] => searchCurated(q, limit).map((f) => f.canonical);
    expect(names("cottage cheese")).toEqual(expect.arrayContaining(["cottage_cheese_low_fat", "cottage_cheese_full_fat", "paneer"]));
    expect(names("lentil curry")).toContain("dal_lentil_curry");
    expect(names("chickpea curry")).toContain("chana_masala");
    expect(names("flatbread")).toEqual(expect.arrayContaining(["roti_chapati", "roti_chapati_store_bought_flatbread", "naan", "paratha"]));
    expect(names("rice cake")[0]).toBe("rice_cakes");
    expect(names("rice cake")).toContain("idli");
    expect(names("roti", 2)).toEqual(["roti_chapati", "roti_chapati_store_bought_flatbread"]);
    expect(names("shepherds pie")).toContain("shepherd_s_pie");
    expect(names("chilli")).toContain("chili_con_carne");
    expect(names("spring roll")[0]).toBe("spring_roll");
  });
});
