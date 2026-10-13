// The curated food list (ROADMAP 7a-i): every food's numbers from a named table,
// its diet, and the name matching the photo scan and saved meals rely on.
// `tools/check-food-sources.ts` compares every number with its table; these
// tests hold what can be held without downloading the tables.
import { describe, expect, it } from "vitest";
import { DIET_LADDER, dietSchema, type Diet } from "@app/shared";
import { COMMON_FOOD_PICKS, CURATED_FOODS, FOOD_ALIASES, PIECE_ENTRIES, curatedPieceFdcId, curatedUsdaFdcId, findCurated, findCuratedVersions, holdsEveryWord, searchCurated, type CuratedFood } from "../src/modules/nutrition/foods.js";

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
    expect(CURATED_FOODS).toHaveLength(510);
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
    // 34c-i
    "tofu_soft", "miso", "red_lentils_dry", "split_peas_cooked", "navy_beans_cooked", "lima_beans_cooked",
    "mung_beans_cooked", "soybeans_cooked", "black_eyed_peas_cooked", "fava_broad_beans_cooked", "barley_cooked",
    "bulgur_cooked", "buckwheat_cooked", "millet_cooked", "wild_rice_cooked", "wheat_germ", "pumpkin_boiled",
    "acorn_squash_cooked", "spaghetti_squash_cooked", "parsnips_cooked", "turnip_cooked", "broccoli_raw",
    "cauliflower_raw", "kale_raw", "leeks_cooked", "radishes", "artichoke_cooked", "bok_choy_cooked",
    "swiss_chard_cooked", "collard_greens_cooked", "fennel", "red_cabbage", "watercress",
    "snow_peas_sugar_snap_peas", "bean_sprouts", "green_onions_scallions", "jalapeno_pepper", "garlic",
    "ginger_fresh", "sun_dried_tomatoes", "portobello_mushroom_grilled", "shiitake_mushrooms_cooked",
    "papaya", "apricot", "apricots_dried", "figs_fresh", "figs_dried", "lemon", "lime",
    "nectarine", "tangerine_mandarin", "persimmon", "guava", "lychee", "passion_fruit", "honeydew_melon",
    "prunes", "cranberries_dried_sweetened", "brazil_nuts", "macadamia_nuts", "pine_nuts",
    "chestnuts_roasted", "sesame_seeds", "hemp_seeds", "tahini_sesame_paste", "avocado_oil", "canola_oil",
    "sesame_oil", "balsamic_vinegar", "apple_cider_vinegar", "coconut_milk_canned",
    // 34c-ii
    "grits_cooked_in_water", "gazpacho", "ratatouille", "polenta_cooked_in_water", "tabbouleh", "baba_ganoush_eggplant_dip",
    "yeast_extract_spread",
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
    // 34c-i
    "greek_yogurt_plain_whole_milk", "ricotta_cheese", "blue_cheese", "gouda_cheese", "buttermilk", "goat_milk",
    // 34c-ii
    "american_biscuit_baked", "bruschetta", "tzatziki", "baklava", "cheese_fondue",
    "cauliflower_cheese", "crumpet_toasted", "shortbread",
    "oat_flapjack_british_oat_bar",
  ],
  vegetarian_eggs: [
    "egg_whole_large", "egg_white", "egg_hard_boiled", "eggs_scrambled", "egg_fried", "egg_poached",
    "omelette_plain", "egg_noodles_cooked", "bread_roll", "pancakes", "waffles", "french_toast", "coleslaw",
    "mayonnaise", "ranch_dressing", "fried_rice", "veggie_burger", "potato_salad", "chocolate_chip_cookie",
    "ice_cream_vanilla", "donut_glazed", "croissant", "brownie", "cheesecake", "blueberry_muffin",
    "chocolate_cake", "banana_bread", "naan", "spring_roll",
    // 34c-ii
    "cornbread", "egg_salad", "macaroni_salad", "eggplant_parmesan", "hush_puppies", "pumpkin_pie", "pecan_pie",
    "key_lime_pie", "quiche_cheese", "crepe_plain", "gnocchi_potato", "ravioli_cheese_with_tomato_sauce",
    "tortellini_cheese_with_tomato_sauce", "tiramisu", "spanakopita_spinach_pie", "spanish_omelette", "pierogi_potato_and_cheese",
    "potato_pancake_latke", "challah", "scone", "irish_soda_bread", "hot_cross_bun",
    "pavlova_with_fruit_and_cream", "apple_strudel",
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
    // 34c-i
    "duck_roasted", "venison_cooked", "bison_ground_cooked", "beef_liver_cooked", "chicken_liver_cooked",
    "halibut_cooked", "pollock_cooked", "catfish_cooked", "snapper_cooked", "swordfish_cooked", "mahi_mahi_cooked",
    "anchovies_canned_in_oil", "oysters_raw", "clams_cooked",
    // 34c-ii
    "clam_chowder_new_england", "biscuits_and_gravy", "gumbo_with_rice", "jambalaya", "meatloaf", "pot_roast_beef",
    "chicken_pot_pie", "corn_dog", "sloppy_joe", "reuben_sandwich", "club_sandwich", "blt_sandwich",
    "cobb_salad_no_dressing", "enchilada_chicken", "enchilada_cheese", "tamale_pork", "fajita_chicken",
    "empanada_beef", "eggs_benedict", "chicken_salad", "chicken_and_dumplings", "chicken_parmesan", "crab_cake",
    "paella_seafood", "quiche_lorraine", "bouillabaisse", "french_onion_soup", "risotto_plain", "moussaka",
    "stuffed_grape_leaves_dolma_beef_and_rice", "taramasalata", "shish_kebab_lamb", "coq_au_vin", "goulash", "beef_stroganoff",
    "borscht", "stuffed_cabbage_rolls_beef_and_rice", "stuffed_pepper_rice_and_meat", "swedish_meatballs", "kielbasa",
    "matzo_ball_soup", "cornish_pasty", "steak_and_kidney_pie", "pork_pie", "sausage_roll", "scotch_egg",
    "toad_in_the_hole", "yorkshire_pudding", "lancashire_hotpot", "haggis", "black_pudding_fried", "kippers_grilled",
    "kedgeree", "breaded_scampi_british", "welsh_rarebit", "trifle", "roast_lamb_leg", "mince_pie", "minestrone", "pumpkin_soup", "bubble_and_squeak",
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
    const MEAT_AND_FISH = ["duck", "venison", "bison", "liver", "halibut", "pollock", "catfish", "snapper", "swordfish", "mahi", "anchovy", "oyster", "clam", "chicken", "beef", "pork", "bacon", "ham", "turkey", "lamb", "steak", "ribeye", "brisket", "jerky", "meatball", "sausage", "salami", "pepperoni", "rib", "bratwurst", "meat", "carne", "salmon", "tuna", "tilapia", "cod", "shrimp", "sardine", "trout", "mackerel", "herring", "haddock", "bass", "crab", "lobster", "scallop", "mussel", "calamari", "fish", "hamburger", "cheeseburger", "dog", "gyro"];
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

describe("the list as it grew (ROADMAP 34c-i)", () => {
  it("still answers a name with the food it answered before", () => {
    // A new food listed under an older one's name is a version of it, never the food the plain name means.
    const cases: [string, string][] = [
      ["broccoli", "broccoli_cooked"], ["kale", "kale_cooked"], ["cauliflower", "cauliflower_cooked"], ["lentils", "lentils_cooked"],
      ["tofu", "tofu_firm"], ["greek yogurt", "greek_yogurt_plain"], ["peas", "peas_green_cooked"], ["mushrooms", "mushrooms"],
      ["milk", "milk_whole"], ["cabbage", "cabbage"], ["clementine", "clementine"], ["coconut oil", "coconut_oil"],
      ["pumpkin seeds", "pumpkin_seeds"], ["goat cheese", "goat_cheese"], ["onion", "onion"], ["butter", "butter"],
      ["nuts", "mixed_nuts"], ["cheese", "cheddar_cheese"],
    ];
    for (const [name, canonical] of cases) expect(findCurated(name)?.canonical ?? null, name).toBe(canonical);
    for (const name of ["beans", "coconut", "pepper", "squash", "liver", "vinegar", "seeds"]) expect(findCurated(name), name).toBeNull();
  });

  it("answers the new foods by the names people use, and a tangerine is no longer a clementine", () => {
    const cases: [string, string][] = [
      ["tangerine", "tangerine_mandarin"], ["mandarins", "tangerine_mandarin"], ["pak choi", "bok_choy_cooked"],
      ["butter beans", "lima_beans_cooked"], ["spring onions", "green_onions_scallions"], ["scallions", "green_onions_scallions"],
      ["litchi", "lychee"], ["lychees", "lychee"], ["red lentils", "red_lentils_dry"],
      ["fig", "figs_fresh"], ["dried figs", "figs_dried"], ["apricots", "apricot"], ["dried apricots", "apricots_dried"],
      ["jalapeño", "jalapeno_pepper"], ["mahi mahi", "mahi_mahi_cooked"], ["fava beans", "fava_broad_beans_cooked"],
      ["broad beans", "fava_broad_beans_cooked"], ["raw broccoli", "broccoli_raw"], ["soft tofu", "tofu_soft"],
      ["snow peas", "snow_peas_sugar_snap_peas"], ["sugar snap peas", "snow_peas_sugar_snap_peas"], ["red cabbage", "red_cabbage"],
      ["coconut milk", "coconut_milk_canned"], ["pumpkin", "pumpkin_boiled"], ["goat milk", "goat_milk"],
    ];
    for (const [name, canonical] of cases) expect(findCurated(name)?.canonical ?? null, name).toBe(canonical);
  });

  it("borrows only the pieces of shrimp and scallops from USDA's survey entry: the entry they cite is unchanged", () => {
    // SR Legacy weighs both by 3 oz alone; the survey release has "1 large/jumbo shrimp" and "1 scallop".
    expect([...PIECE_ENTRIES]).toEqual([["shrimp_cooked", 2706363], ["scallops_cooked", 2706358]]);
    expect(curatedPieceFdcId("shrimp_cooked")).toBe(2706363);
    expect(curatedPieceFdcId("apple")).toBeNull();
    expect(curatedPieceFdcId("constructor")).toBeNull();
    // The entry their numbers, their further figures and their own measures are read from.
    expect(curatedUsdaFdcId("shrimp_cooked")).toBe(175180);
    expect(curatedUsdaFdcId("scallops_cooked")).toBe(167742);
    expect(food("shrimp_cooked")).toMatchObject({ kcal: 99, proteinG: 23.98, serving: 100, unit: "g", citation: "usda-sr:175180" });
    expect(food("scallops_cooked")).toMatchObject({ kcal: 111, proteinG: 20.54, serving: 100, unit: "g", citation: "usda-sr:167742" });
    // A food that borrows pieces is on the list and cites another entry than the one it borrows from.
    for (const [canonical, fdcId] of PIECE_ENTRIES) {
      expect(findCurated(canonical)?.canonical, canonical).toBe(canonical);
      expect(curatedUsdaFdcId(canonical), canonical).not.toBe(fdcId);
    }
  });
});

describe("the list as it grew (ROADMAP 34c-ii): the dishes of the US, Europe, Britain, Australia and New Zealand", () => {
  it("still answers a name with the food it answered before", () => {
    const cases: [string, string][] = [
      ["cottage pie", "shepherd_s_pie"], ["porridge", "oatmeal_cooked"], ["doner kebab", "gyro"], ["pumpkin", "pumpkin_boiled"],
      ["omelette", "omelette_plain"], ["pancakes", "pancakes"], ["cauliflower", "cauliflower_cooked"], ["sausage", "pork_sausage_cooked"],
      ["lamb", "lamb_cooked"], ["meatballs", "meatballs_in_sauce"], ["parmesan", "parmesan_cheese"], ["mince", "ground_beef_85_cooked"],
      ["tortilla", "tortilla_flour"], ["apple pie", "apple_pie"], ["potato salad", "potato_salad"], ["egg", "egg_whole_large"],
      ["kidney beans", "kidney_beans_cooked"], ["hot dog", "hot_dog"],
    ];
    for (const [name, canonical] of cases) expect(findCurated(name)?.canonical ?? null, name).toBe(canonical);
  });

  it("answers the new dishes by the names people use", () => {
    const cases: [string, string][] = [
      ["clam chowder", "clam_chowder_new_england"], ["meat loaf", "meatloaf"], ["corn bread", "cornbread"], ["BLT", "blt_sandwich"],
      ["reuben", "reuben_sandwich"], ["sloppy joes", "sloppy_joe"], ["grits", "grits_cooked_in_water"], ["tamales", "tamale_pork"],
      ["enchiladas", "enchilada_chicken"], ["cheese enchilada", "enchilada_cheese"], ["pasta salad", "macaroni_salad"],
      ["chicken parm", "chicken_parmesan"], ["aubergine parmigiana", "eggplant_parmesan"], ["crab cakes", "crab_cake"],
      ["paella", "paella_seafood"], ["quiche", "quiche_cheese"], ["quiche lorraine", "quiche_lorraine"], ["crêpes", "crepe_plain"],
      ["onion soup", "french_onion_soup"], ["polenta", "polenta_cooked_in_water"], ["dolmades", "stuffed_grape_leaves_dolma_beef_and_rice"],
      ["baba ghanoush", "baba_ganoush_eggplant_dip"], ["tabouli", "tabbouleh"], ["shish kabob", "shish_kebab_lamb"],
      ["spanish omelet", "spanish_omelette"], ["stroganoff", "beef_stroganoff"], ["pierogies", "pierogi_potato_and_cheese"], ["pierogi", "pierogi_potato_and_cheese"], ["dolma", "stuffed_grape_leaves_dolma_beef_and_rice"], ["latkes", "potato_pancake_latke"],
      ["cabbage rolls", "stuffed_cabbage_rolls_beef_and_rice"], ["stuffed peppers", "stuffed_pepper_rice_and_meat"], ["strudel", "apple_strudel"],
      ["cornish pasty", "cornish_pasty"], ["steak and kidney pie", "steak_and_kidney_pie"], ["yorkshire puddings", "yorkshire_pudding"],
      ["toad in the hole", "toad_in_the_hole"], ["kippers", "kippers_grilled"], ["welsh rabbit", "welsh_rarebit"], ["crumpets", "crumpet_toasted"],
      ["soda bread", "irish_soda_bread"], ["hot cross buns", "hot_cross_bun"], ["mince pies", "mince_pie"], ["pavlova", "pavlova_with_fruit_and_cream"],
      ["leg of lamb", "roast_lamb_leg"], ["Vegemite", "yeast_extract_spread"], ["marmite", "yeast_extract_spread"],
      ["oat flapjack", "oat_flapjack_british_oat_bar"], ["american biscuit", "american_biscuit_baked"],
    ];
    for (const [name, canonical] of cases) expect(findCurated(name)?.canonical ?? null, name).toBe(canonical);
  });

  it("names no food for a word the markets use for different foods", () => {
    // A biscuit is a soft bread in the US and a cookie in the UK; a flapjack a pancake in the US and an oat bar in the UK;
    // scampi shrimp in garlic butter in the US and breaded langoustine in the UK; a kebab is a skewer or a doner; a pasty,
    // a pudding and a hot pot are many dishes.
    for (const name of ["biscuit", "biscuits", "flapjack", "flapjacks", "scampi", "kebab", "pasty", "pudding", "hot pot", "pie", "soup", "roast"]) expect(findCurated(name), name).toBeNull();
  });

  it("labels a dish by the animal ingredient its table does not show", () => {
    // Every soup, and every dish fried or baked in a fat its table does not name, with the answer the rule gave it.
    const N = "non_vegetarian", E = "vegetarian_eggs", V = "vegetarian", VEGAN = "vegan";
    const answers: [string, Diet, string][] = [
      // soups: USDA makes each with water; the usual dish is made with meat stock, or holds meat or fish
      ["french_onion_soup", N, "beef stock"], ["borscht", N, "beef stock"], ["minestrone", N, "pancetta or meat stock"],
      ["pumpkin_soup", N, "chicken stock"], ["matzo_ball_soup", N, "chicken soup"], ["clam_chowder_new_england", N, "clams"],
      ["bouillabaisse", N, "fish"], ["gumbo_with_rice", N, "chicken, pork, shrimp"], ["gazpacho", VEGAN, "a cold soup of raw vegetables and oil: no stock"],
      // the UK table lists no ingredients
      ["risotto_plain", N, "stock"], ["yorkshire_pudding", N, "beef dripping"], ["bubble_and_squeak", N, "beef dripping or lard"],
      ["mince_pie", N, "beef suet in the mincemeat"], ["welsh_rarebit", N, "anchovy in Worcestershire sauce"],
      ["shortbread", V, "butter"], ["oat_flapjack_british_oat_bar", V, "butter"], ["crumpet_toasted", V, "milk in some"],
      ["cauliflower_cheese", V, "milk and cheese"], ["hot_cross_bun", E, "egg, milk and butter"], ["pavlova_with_fruit_and_cream", E, "egg white and cream"],
      ["spanish_omelette", E, "egg"],
      // USDA's recipe or bought food does not show it
      ["trifle", N, "gelatine in the jelly"], ["enchilada_cheese", N, "lard in the refried beans"],
      ["gnocchi_potato", E, "egg"], ["ravioli_cheese_with_tomato_sauce", E, "egg in fresh pasta"],
      ["tortellini_cheese_with_tomato_sauce", E, "egg in fresh pasta"], ["pierogi_potato_and_cheese", E, "egg in the dough"],
      ["key_lime_pie", E, "egg yolk in the filling"], ["hush_puppies", E, "egg and milk in the batter"],
      ["apple_strudel", E, "egg in the dough"], ["bruschetta", V, "milk in the bread"],
      // made with water alone, and named so
      ["grits_cooked_in_water", VEGAN, "none"], ["polenta_cooked_in_water", VEGAN, "none"],
    ];
    for (const [canonical, diet, why] of answers) expect(food(canonical).diet, `${canonical}: ${why}`).toBe(diet);
    // No soup added in this job is missing from the table.
    const soups = CURATED_FOODS.slice(409).filter((f) => /soup|chowder|borscht|minestrone|gazpacho|bouillabaisse|gumbo/i.test(f.name)).map((f) => f.canonical);
    expect(answers.map(([canonical]) => canonical)).toEqual(expect.arrayContaining(soups));
    expect(food("grits_cooked_in_water").name).toBe("Grits (cooked in water)");
    expect(food("polenta_cooked_in_water").name).toBe("Polenta (cooked in water)");
  });

  it("serves a CoFID dish by the gram, and a USDA dish by a measure its own entry gives", () => {
    for (const f of CURATED_FOODS.slice(409)) {
      if (f.citation.startsWith("uk-cofid:")) expect([f.serving, f.unit], f.name).toEqual([100, "g"]);
    }
    expect(food("clam_chowder_new_england")).toMatchObject({ kcal: 93, serving: 255, unit: "cup", citation: "usda-fndds:2707139" });
    expect(food("meatloaf")).toMatchObject({ kcal: 199, serving: 108, unit: "slice", citation: "usda-fndds:2706499" });
    // USDA's measure is "1 egg" with its muffin, ham and sauce: a portion, never read as one egg.
    expect(food("eggs_benedict")).toMatchObject({ serving: 155, unit: "portion" });
    expect(food("cornish_pasty")).toMatchObject({ kcal: 278, proteinG: 7, citation: "uk-cofid:19-466" });
    // USDA first: a scone and a trifle are USDA's, though CoFID has both.
    expect(food("scone").citation).toBe("usda-fndds:2707808");
    expect(food("trifle").citation).toBe("usda-fndds:2705701");
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

  it("is the one the list picks for a word several foods answer to, and bread alone is white bread (RULINGS 2026-09-17)", () => {
    expect(findCurated("bread")?.canonical).toBe("white_bread");
    expect(findCurated("Bread Slices")?.canonical).toBe("white_bread");
    for (const [word, canonical] of COMMON_FOOD_PICKS) {
      expect(FOOD_ALIASES.get(word), word).toBe(canonical);
      expect(findCurated(word)?.canonical, word).toBe(canonical);
    }
  });

  it("is the food a cited entry names another way: sweet corn, a jacket potato, basmati and jasmine rice, a caffè latte", () => {
    const cases: [string, string][] = [
      ["sweet corn", "corn_cooked"], ["Sweet Corn", "corn_cooked"], ["jacket potato", "potato_baked"], ["jacket potatoes", "potato_baked"],
      ["basmati rice", "rice_white_cooked"], ["jasmine rice", "rice_white_cooked"], ["caffè latte", "latte"], ["caffe latte", "latte"],
      // "Iced" is frosted on a British bake, so it is no word a name is shortened past
      // (scanMatch.ts); an iced latte is a name of our latte (the re-check of PR #81).
      ["iced latte", "latte"], ["Iced Latte", "latte"],
    ];
    for (const [name, canonical] of cases) expect(findCurated(name)?.canonical, name).toBe(canonical);
    // Each is the food its cited USDA entry describes by that other name.
    expect([curatedUsdaFdcId("corn_cooked"), curatedUsdaFdcId("potato_baked"), curatedUsdaFdcId("rice_white_cooked"), curatedUsdaFdcId("latte")])
      .toEqual([169999, 170093, 168878, 2710386]);
    // A version the other name does not say is not it.
    expect(findCurated("brown basmati rice")).toBeNull();
  });

  it("with its other versions, in the list's order, where the scanner reads a name it shortened", () => {
    const canonicals = (name: string): string[] => findCuratedVersions(name).map((f) => f.canonical);
    // The food the name means first, as findCurated finds it, then the foods of its name outside the brackets.
    expect(canonicals("carrots")).toEqual(["carrots_raw", "carrots_cooked"]);
    expect(canonicals("spinach")).toEqual(["spinach_raw", "spinach_cooked"]);
    expect(canonicals("potato")).toEqual(["potato_baked", "potato_boiled"]);
    expect(canonicals("boiled potatoes")).toEqual(["potato_boiled", "potato_baked"]);
    expect(canonicals("roti")).toEqual(["roti_chapati", "roti_chapati_store_bought_flatbread"]);
    expect(canonicals("broccoli")).toEqual(["broccoli_cooked", "broccoli_raw"]);
    // Never the list's pick for a word several foods answer to: the model named more
    // than that word, and what it added may pick another of them ("roast pork" is no
    // pork chop, "toasted bread" no white bread).
    for (const [word, canonical] of COMMON_FOOD_PICKS) {
      expect(findCurated(word)?.canonical, word).toBe(canonical);
      expect(canonicals(word)[0], word).not.toBe(canonical);
      expect(canonicals(`${word}s`)[0], `${word}s`).not.toBe(canonical);
    }
    // Nothing at all where no food of ours is named by the word itself…
    expect(canonicals("bread")).toEqual([]);
    expect(canonicals("cheese")).toEqual([]);
    expect(canonicals("beef")).toEqual([]);
    expect(canonicals("pork")).toEqual([]);
    // …and the food the word IS the name of where one is, never the pick beside it.
    expect(canonicals("turkey")).toEqual(["turkey_deli_slices"]);
    expect(findCurated("turkey")?.canonical).toBe("turkey_breast_cooked");
    // Every other name of a food is still one, and so is the food's own name.
    for (const [alias, canonical] of FOOD_ALIASES) {
      if (!COMMON_FOOD_PICKS.has(alias)) expect(canonicals(alias)[0], alias).toBe(canonical);
    }
    for (const f of CURATED_FOODS) expect(findCuratedVersions(f.name)[0], f.name).toBe(f);
    // A name and its plural are one name: "Egg (fried)" and "Eggs (scrambled)" are versions of one food.
    expect(canonicals("eggs")).toEqual(["egg_whole_large", "egg_hard_boiled", "eggs_scrambled", "egg_fried", "egg_poached"]);
    expect(canonicals("zqxnothing")).toEqual([]);
    // For every food of the list: itself first, each version once, and the same versions whichever of them a name meant.
    for (const f of CURATED_FOODS) {
      const found = findCuratedVersions(f.canonical);
      expect(found[0], f.canonical).toBe(f);
      expect(new Set(found).size, f.canonical).toBe(found.length);
      for (const version of found) expect(new Set(findCuratedVersions(version.canonical)), `${f.canonical} → ${version.canonical}`).toEqual(new Set(found));
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
