// The curated food list: each food's numbers per 100 g, copied from a named food
// composition table, and the lowest diet that eats it.
//
// Where the numbers come from (`citation` on every food):
//   usda-sr:<FDC id>     USDA FoodData Central, SR Legacy (April 2018)
//   usda-fndds:<FDC id>  USDA FoodData Central, FNDDS 2021-2023 survey foods (October 2024)
//   uk-cofid:<food code> UK McCance and Widdowson's Composition of Foods Integrated Dataset (2021)
// USDA is used first. CoFID is used where USDA has no entry for the food: a roti
// made at home without fat (USDA's rotis are store-bought), muesli, chana masala
// and butter chicken. Paneer is CoFID's too: USDA's survey entry is worked out
// from whole milk and vinegar and keeps the milk's sugar, 22 g of carbohydrate
// per 100 g, where CoFID's nine analysed samples carry 0.9 g (Kd, 2026-09-14).
// kcal, protein, carbohydrate and fat are each table's own figures: USDA counts
// carbohydrate by difference, fibre included, and CoFID counts available
// carbohydrate. Fibre is null where the table has no measured figure (CoFID's
// fibre is AOAC, or NSP where AOAC is not given). To check every number against
// its table:
//   corepack pnpm --filter api exec tsx tools/check-food-sources.ts
//
// The diet is the lowest rung of `dietSchema`'s ladder that eats the food, by
// what it is made of: a dish by the ingredients its table lists, and a food
// whose usual versions differ by the version with the animal ingredient its name
// does not show (egg in naan and in bread rolls, cheese in pesto, lard in
// traditional refried beans, anchovy in Caesar dressing). Honey is not vegan.
// Processing aids such as rennet and fining agents are not followed, and no
// label can see a product's own recipe.
import type { Diet } from "@app/shared";
import type { FoodReference } from "./openfoodfacts.adapter.js";

/** The table entry a food's numbers were copied from. */
export type FoodCitation = `usda-sr:${number}` | `usda-fndds:${number}` | `uk-cofid:${string}`;

export interface CuratedFood extends FoodReference {
  source: "curated";
  /** The lowest diet that eats this food. */
  diet: Diet;
  citation: FoodCitation;
}

const slug = (v: string): string => v.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_").replaceAll(/^_+|_+$/g, "");

/** Foods renamed to say what their numbers are, or to carry an English name
 *  beside an Indian one so they are found by either (Kd, 2026-09-14). Each keeps
 *  the canonical of the name it had, because a saved meal finds its foods again
 *  by canonical. */
const KEPT_CANONICALS: ReadonlyMap<string, string> = new Map([
  ["Greek yogurt (plain, nonfat)", "greek_yogurt_plain"],
  ["Brussels sprouts (cooked)", "brussels_sprouts"],
  ["Caesar salad (with chicken, no dressing)", "caesar_salad_with_chicken"],
  ["Ramen (instant, cooked)", "ramen_cooked"],
  ["Egg roll (vegetable, fried)", "spring_roll"],
  ["Dumplings (pork, fried)", "dumplings_pork"],
  ["Butter chicken / tikka masala", "butter_chicken"],
  ["Chocolate (dark, 70–85%)", "chocolate_dark_70"],
  ["Roti / Chapati (homemade flatbread, no fat)", "roti_chapati"],
  ["Naan (Indian flatbread)", "naan"],
  ["Paneer (Indian cottage cheese)", "paneer"],
  ["Biryani (spiced rice with chicken)", "biryani_chicken"],
  ["Samosa (fried pastry, potato and peas)", "samosa"],
  ["Idli (steamed rice cake)", "idli"],
  ["Dosa (rice and lentil crepe, plain)", "dosa_plain"],
  ["Palak paneer (spinach and cheese curry)", "palak_paneer"],
  ["Chana masala (chickpea curry)", "chana_masala"],
  ["Biryani (spiced rice with vegetables)", "biryani_vegetable"],
  ["Paratha (layered flatbread)", "paratha"],
  ["Curd / Dahi (plain yogurt, whole milk)", "curd_dahi"],
]);

const row = (
  name: string,
  kcal: number,
  proteinG: number,
  carbsG: number,
  fatG: number,
  fiberG: number | null,
  serving: number,
  unit: string,
  diet: Diet,
  citation: FoodCitation,
): CuratedFood => ({
  canonical: KEPT_CANONICALS.get(name) ?? slug(name),
  name,
  kcal,
  proteinG,
  carbsG,
  fatG,
  fiberG,
  serving,
  unit,
  source: "curated",
  diet,
  citation,
});

// name · kcal · protein · carbohydrate · fat · fibre (per 100 g) · serving (g) · unit · diet · citation
export const CURATED_FOODS: readonly CuratedFood[] = [
  // ── Meat and poultry
  row("Chicken breast (cooked)", 165, 31.02, 0, 3.57, 0, 100, "g", "non_vegetarian", "usda-sr:171477"),
  row("Chicken thigh (cooked)", 179, 24.76, 0, 8.15, 0, 100, "g", "non_vegetarian", "usda-sr:172388"),
  row("Ground beef 85% (cooked)", 256, 27.73, 0, 15.3, 0, 100, "g", "non_vegetarian", "usda-sr:174034"),
  row("Ground beef 90% (cooked)", 230, 28.45, 0, 12.04, 0, 100, "g", "non_vegetarian", "usda-sr:171794"),
  row("Steak (sirloin, cooked)", 243, 26.96, 0, 14.23, 0, 100, "g", "non_vegetarian", "usda-sr:168727"),
  row("Pork chop (cooked)", 209, 25.61, 0, 11.06, 0, 100, "g", "non_vegetarian", "usda-sr:167827"),
  row("Bacon (cooked)", 548, 35.73, 1.35, 43.27, 0, 100, "g", "non_vegetarian", "usda-sr:167914"),
  row("Turkey breast (cooked)", 147, 30.13, 0, 2.08, 0, 100, "g", "non_vegetarian", "usda-sr:171496"),
  row("Lamb (cooked)", 294, 24.52, 0, 20.94, 0, 100, "g", "non_vegetarian", "usda-sr:172480"),
  row("Chicken breast (grilled)", 151, 30.54, 0, 3.17, 0, 100, "g", "non_vegetarian", "usda-sr:171534"),
  row("Chicken drumstick (cooked)", 155, 24.24, 0, 5.7, 0, 100, "g", "non_vegetarian", "usda-sr:172376"),
  row("Chicken wings (cooked)", 254, 23.79, 0, 16.87, 0, 100, "g", "non_vegetarian", "usda-sr:173630"),
  row("Rotisserie chicken", 164, 26.79, 0, 6.36, 0, 100, "g", "non_vegetarian", "usda-fndds:2705935"),
  row("Fried chicken", 251, 21.75, 7.14, 15.02, 0.2, 100, "g", "non_vegetarian", "usda-fndds:2705949"),
  row("Chicken nuggets", 307, 15.92, 14.93, 20.36, 0.9, 16, "nugget", "non_vegetarian", "usda-fndds:2706092"),
  row("Ground turkey (cooked)", 203, 27.37, 0, 10.4, 0, 100, "g", "non_vegetarian", "usda-sr:171506"),
  row("Turkey (deli slices)", 106, 14.81, 2.2, 3.77, 0, 16, "slice", "non_vegetarian", "usda-sr:172941"),
  row("Ribeye steak (cooked)", 271, 24.85, 0, 19.02, 0, 100, "g", "non_vegetarian", "usda-sr:172164"),
  row("Beef brisket (cooked)", 289, 28.82, 0, 18.42, 0, 100, "g", "non_vegetarian", "usda-sr:169488"),
  row("Beef jerky", 410, 33.2, 11, 25.6, 1.8, 28, "oz", "non_vegetarian", "usda-sr:167536"),
  row("Meatballs (in sauce)", 186, 18.02, 0.15, 12.02, 0, 43, "meatball", "non_vegetarian", "usda-fndds:2706467"),
  row("Ground beef 80% (cooked)", 272, 27, 0, 17.36, 0, 100, "g", "non_vegetarian", "usda-sr:171799"),
  row("Ham (sliced)", 164, 16.6, 3.63, 8.8, 1.3, 28, "slice", "non_vegetarian", "usda-sr:173864"),
  row("Pork tenderloin (cooked)", 143, 26.17, 0, 3.51, 0, 100, "g", "non_vegetarian", "usda-sr:168250"),
  row("Pulled pork (barbecue)", 226, 17.57, 12.23, 11.3, 0.3, 100, "g", "non_vegetarian", "usda-fndds:2706399"),
  row("Pork sausage (cooked)", 325, 18.53, 1.42, 27.25, 0, 23, "link", "non_vegetarian", "usda-sr:174578"),
  row("Salami", 407, 22.58, 1.6, 33.72, 0, 10, "slice", "non_vegetarian", "usda-sr:172938"),
  row("Pepperoni", 504, 19.25, 1.18, 46.28, 0, 28, "oz", "non_vegetarian", "usda-sr:174575"),
  row("Pork ribs (cooked)", 361, 20.89, 0, 30.86, 0, 100, "g", "non_vegetarian", "usda-sr:169178"),
  row("Bratwurst", 333, 13.72, 2.85, 29.18, 0, 85, "sausage", "non_vegetarian", "usda-sr:171620"),
  row("Lamb chop (cooked)", 316, 25.17, 0, 23.08, 0, 100, "g", "non_vegetarian", "usda-sr:172489"),
  row("Turkey bacon (cooked)", 368, 29.5, 4.24, 25.87, 0, 11, "slice", "non_vegetarian", "usda-fndds:2706135"),
  // ── Fish and seafood
  row("Salmon (cooked)", 206, 22.1, 0, 12.35, 0, 100, "g", "non_vegetarian", "usda-sr:175168"),
  row("Tuna (canned in water)", 86, 19.44, 0, 0.96, 0, 100, "g", "non_vegetarian", "usda-sr:173709"),
  row("Tilapia (cooked)", 128, 26.15, 0, 2.65, 0, 100, "g", "non_vegetarian", "usda-sr:175177"),
  row("Cod (cooked)", 105, 22.83, 0, 0.86, 0, 100, "g", "non_vegetarian", "usda-sr:171956"),
  row("Shrimp (cooked)", 99, 23.98, 0.2, 0.28, null, 100, "g", "non_vegetarian", "usda-sr:175180"),
  row("Sardines (canned in oil)", 208, 24.62, 0, 11.45, 0, 100, "g", "non_vegetarian", "usda-sr:175139"),
  row("Tuna steak (cooked)", 130, 29.15, 0, 0.59, 0, 100, "g", "non_vegetarian", "usda-sr:172006"),
  row("Salmon (canned)", 136, 24.62, 0, 4.21, 0, 100, "g", "non_vegetarian", "usda-sr:173724"),
  row("Smoked salmon", 117, 18.28, 0, 4.32, 0, 56, "g", "non_vegetarian", "usda-sr:173687"),
  row("Trout (cooked)", 168, 23.8, 0, 7.38, 0, 100, "g", "non_vegetarian", "usda-sr:173718"),
  row("Mackerel (cooked)", 262, 23.85, 0, 17.81, 0, 100, "g", "non_vegetarian", "usda-sr:175120"),
  row("Herring (pickled)", 262, 14.19, 9.64, 18, 0, 56, "g", "non_vegetarian", "usda-sr:175118"),
  row("Haddock (cooked)", 90, 19.99, 0, 0.55, 0, 100, "g", "non_vegetarian", "usda-sr:174198"),
  row("Sea bass (cooked)", 124, 23.63, 0, 2.56, 0, 100, "g", "non_vegetarian", "usda-sr:173694"),
  row("Crab (cooked)", 83, 17.88, 0, 0.74, 0, 100, "g", "non_vegetarian", "usda-sr:174205"),
  row("Lobster (cooked)", 89, 19, 0, 0.86, 0, 100, "g", "non_vegetarian", "usda-sr:174209"),
  row("Scallops (cooked)", 111, 20.54, 5.41, 0.84, 0, 100, "g", "non_vegetarian", "usda-sr:167742"),
  row("Mussels (cooked)", 172, 23.8, 7.39, 4.48, 0, 100, "g", "non_vegetarian", "usda-sr:174217"),
  row("Calamari (fried)", 175, 17.94, 7.79, 7.48, 0, 100, "g", "non_vegetarian", "usda-sr:171982"),
  row("Fish sticks", 277, 11.01, 21.66, 16.23, 1.5, 28, "stick", "non_vegetarian", "usda-sr:174195"),
  row("Fried fish (coated)", 269, 16.05, 11.72, 17.23, 0.5, 100, "g", "non_vegetarian", "usda-fndds:2706227"),
  row("Tuna salad", 187, 16.04, 9.41, 9.26, 0, 100, "g", "non_vegetarian", "usda-sr:175160"),
  // ── Eggs
  row("Egg (whole, large)", 143, 12.56, 0.72, 9.51, 0, 50, "egg", "vegetarian_eggs", "usda-sr:171287"),
  row("Egg white", 52, 10.9, 0.73, 0.17, 0, 33, "white", "vegetarian_eggs", "usda-sr:172183"),
  row("Egg (hard-boiled)", 155, 12.58, 1.12, 10.61, 0, 50, "egg", "vegetarian_eggs", "usda-sr:173424"),
  row("Eggs (scrambled)", 149, 9.99, 1.61, 10.98, 0, 100, "g", "vegetarian_eggs", "usda-sr:172187"),
  row("Egg (fried)", 196, 13.61, 0.83, 14.84, 0, 46, "egg", "vegetarian_eggs", "usda-sr:173423"),
  row("Egg (poached)", 143, 12.51, 0.71, 9.47, 0, 50, "egg", "vegetarian_eggs", "usda-sr:172186"),
  row("Omelette (plain)", 154, 10.57, 0.64, 11.66, 0, 100, "g", "vegetarian_eggs", "usda-sr:172185"),
  // ── Dairy
  row("Greek yogurt (plain, nonfat)", 59, 10.19, 3.6, 0.39, 0, 100, "g", "vegetarian", "usda-sr:170894"),
  row("Cottage cheese (low-fat)", 81, 10.45, 4.76, 2.27, 0, 100, "g", "vegetarian", "usda-sr:172182"),
  row("Milk (whole)", 61, 3.15, 4.8, 3.25, 0, 240, "cup", "vegetarian", "usda-sr:171265"),
  row("Milk (skim)", 34, 3.37, 4.96, 0.08, 0, 240, "cup", "vegetarian", "usda-sr:171269"),
  row("Cheddar cheese", 403, 22.87, 3.37, 33.31, 0, 30, "slice", "vegetarian", "usda-sr:173414"),
  row("Mozzarella cheese", 299, 22.17, 2.4, 22.14, 0, 30, "slice", "vegetarian", "usda-sr:170845"),
  row("Butter", 717, 0.85, 0.06, 81.11, 0, 14, "tbsp", "vegetarian", "usda-sr:173410"),
  row("Curd / Dahi (plain yogurt, whole milk)", 61, 3.47, 4.66, 3.25, 0, 100, "g", "vegetarian", "usda-sr:171284"),
  row("Milk (2%)", 50, 3.3, 4.8, 1.98, 0, 240, "cup", "vegetarian", "usda-sr:171267"),
  row("Milk (1%)", 42, 3.37, 4.99, 0.97, 0, 240, "cup", "vegetarian", "usda-sr:170872"),
  row("Chocolate milk", 76, 2.99, 12.13, 1.9, 0.7, 240, "cup", "vegetarian", "usda-sr:170880"),
  row("Yogurt (plain, low-fat)", 63, 5.25, 7.04, 1.55, 0, 170, "container", "vegetarian", "usda-sr:170886"),
  row("Yogurt (fruit, low-fat)", 102, 4.37, 19.05, 1.08, 0, 170, "container", "vegetarian", "usda-sr:171285"),
  row("Cream cheese", 350, 6.15, 5.52, 34.44, 0, 28, "g", "vegetarian", "usda-sr:173418"),
  row("Parmesan cheese", 392, 35.75, 3.22, 25, 0, 10, "g", "vegetarian", "usda-sr:170848"),
  row("Feta cheese", 265, 14.21, 3.88, 21.49, 0, 28, "g", "vegetarian", "usda-sr:173420"),
  row("Swiss cheese", 393, 26.96, 1.44, 30.99, 0, 28, "slice", "vegetarian", "usda-sr:171251"),
  row("Brie", 334, 20.75, 0.45, 27.68, 0, 28, "g", "vegetarian", "usda-sr:172177"),
  row("Goat cheese", 264, 18.52, 0, 21.08, 0, 28, "g", "vegetarian", "usda-sr:173435"),
  row("Sour cream", 198, 2.44, 4.63, 19.35, 0, 30, "g", "vegetarian", "usda-sr:171257"),
  row("Heavy cream", 340, 2.84, 2.84, 36.08, 0, 15, "tbsp", "vegetarian", "usda-sr:170859"),
  row("Kefir", 52, 3.59, 7.48, 0.96, 0, 244, "cup", "vegetarian", "usda-fndds:2705394"),
  row("Cottage cheese (full-fat)", 98, 11.12, 3.38, 4.3, 0, 100, "g", "vegetarian", "usda-sr:172179"),
  row("Ghee", 876, 0.28, 0, 99.48, 0, 13, "tbsp", "vegetarian", "usda-sr:173412"),
  // ── Tofu, beans and lentils
  row("Tofu (firm)", 144, 17.27, 2.78, 8.72, 2.3, 100, "g", "vegan", "usda-sr:172475"),
  row("Tempeh", 192, 20.29, 7.64, 10.8, null, 100, "g", "vegan", "usda-sr:174272"),
  row("Lentils (cooked)", 116, 9.02, 20.13, 0.38, 7.9, 100, "g", "vegan", "usda-sr:172421"),
  row("Chickpeas (cooked)", 164, 8.86, 27.42, 2.59, 7.6, 100, "g", "vegan", "usda-sr:173757"),
  row("Black beans (cooked)", 132, 8.86, 23.71, 0.54, 8.7, 100, "g", "vegan", "usda-sr:173735"),
  row("Kidney beans (cooked)", 127, 8.67, 22.8, 0.5, 6.4, 100, "g", "vegan", "usda-sr:173740"),
  row("Edamame (cooked)", 121, 11.91, 8.91, 5.2, 5.2, 100, "g", "vegan", "usda-sr:168411"),
  row("Pinto beans (cooked)", 143, 9.01, 26.22, 0.65, 9, 100, "g", "vegan", "usda-sr:175200"),
  row("White beans (cooked)", 139, 9.73, 25.09, 0.35, 6.3, 100, "g", "vegan", "usda-sr:175203"),
  row("Hummus", 237, 7.78, 15, 17.82, 5.5, 30, "2 tbsp", "vegan", "usda-sr:174289"),
  row("Refried beans", 90, 4.98, 13.55, 2.01, 3.7, 100, "g", "non_vegetarian", "usda-sr:172438"),
  row("Baked beans (canned)", 94, 4.75, 21.14, 0.37, 4.1, 127, "half cup", "vegan", "usda-sr:175182"),
  row("Falafel", 333, 13.31, 31.84, 17.8, null, 17, "patty", "vegan", "usda-sr:172455"),
  // ── Grains, bread and cereal
  row("Rice (white, cooked)", 130, 2.69, 28.17, 0.28, 0.4, 100, "g", "vegan", "usda-sr:168878"),
  row("Rice (brown, cooked)", 123, 2.74, 25.58, 0.97, 1.6, 100, "g", "vegan", "usda-sr:169704"),
  row("Oats (dry)", 379, 13.15, 67.7, 6.52, 10.1, 40, "g", "vegan", "usda-sr:173904"),
  row("Quinoa (cooked)", 120, 4.4, 21.3, 1.92, 2.8, 100, "g", "vegan", "usda-sr:168917"),
  row("Pasta (cooked)", 158, 5.8, 30.86, 0.93, 1.8, 100, "g", "vegan", "usda-sr:169737"),
  row("Whole wheat bread", 252, 12.45, 42.71, 3.5, 6, 30, "slice", "vegetarian", "usda-sr:172688"),
  row("White bread", 266, 8.85, 49.42, 3.33, 2.7, 30, "slice", "vegetarian", "usda-sr:174924"),
  row("Tortilla (flour)", 306, 8.2, 49.38, 7.99, 3.5, 48, "tortilla", "vegan", "usda-sr:175037"),
  row("Bagel (plain)", 264, 10.56, 52.38, 1.32, 1.6, 99, "bagel", "vegan", "usda-sr:174899"),
  row("Cereal (cornflakes)", 365, 6.4, 79.52, 1.6, 3.5, 30, "cup", "vegan", "usda-fndds:2708453"),
  row("Granola", 489, 13.67, 53.88, 24.31, 8.9, 50, "g", "vegetarian", "usda-sr:171646"),
  row("Oatmeal (cooked)", 71, 2.54, 12, 1.52, 1.7, 234, "cup", "vegan", "usda-sr:173905"),
  row("Pasta (whole wheat, cooked)", 149, 5.99, 30.07, 1.71, 3.9, 100, "g", "vegan", "usda-sr:168910"),
  row("Couscous (cooked)", 112, 3.79, 23.22, 0.16, 1.4, 100, "g", "vegan", "usda-sr:169700"),
  row("Egg noodles (cooked)", 138, 4.54, 25.16, 2.07, 1.2, 100, "g", "vegetarian_eggs", "usda-sr:168919"),
  row("Rice noodles (cooked)", 108, 1.79, 24.01, 0.2, 1, 100, "g", "vegan", "usda-sr:168914"),
  row("Rye bread", 259, 8.5, 48.3, 3.3, 5.8, 32, "slice", "vegan", "usda-sr:172684"),
  row("French bread / sourdough", 272, 10.75, 51.88, 2.42, 2.2, 50, "slice", "vegan", "usda-sr:172675"),
  row("Multigrain bread", 265, 13.36, 43.34, 4.23, 7.4, 26, "slice", "vegetarian", "usda-sr:168013"),
  row("Pita bread", 275, 9.1, 55.7, 1.2, 2.2, 60, "pita", "vegan", "usda-sr:174915"),
  row("English muffin", 235, 7.7, 46, 1.8, 2.7, 57, "muffin", "vegetarian", "usda-sr:175063"),
  row("Bread roll", 279, 9.77, 50.12, 3.91, 1.8, 44, "roll", "vegetarian_eggs", "usda-sr:172796"),
  row("Tortilla (corn)", 218, 5.7, 44.64, 2.85, 6.3, 24, "tortilla", "vegan", "usda-sr:175036"),
  row("Crackers", 510, 6.64, 61.3, 26.43, 2.3, 16, "g", "vegan", "usda-sr:174982"),
  row("Rice cakes", 387, 8.2, 81.5, 2.8, 4.2, 9, "cake", "vegan", "usda-sr:170250"),
  row("Crispbread (rye)", 334, 9.6, 80.4, 0.9, 22.9, 11, "slice", "vegan", "usda-sr:172744"),
  row("Muesli", 366, 9.2, 72.6, 6.3, 8.8, 45, "g", "vegetarian", "uk-cofid:11-780"),
  row("Pancakes", 282, 7.41, 35.32, 12.07, 2.1, 50, "pancake", "vegetarian_eggs", "usda-fndds:2708304"),
  row("Waffles", 309, 7.42, 48.39, 9.49, 2.6, 75, "waffle", "vegetarian_eggs", "usda-fndds:2708312"),
  row("French toast", 273, 10.36, 32.34, 11.38, 1.2, 65, "slice", "vegetarian_eggs", "usda-fndds:2708331"),
  // ── Potatoes and starchy vegetables
  row("Potato (baked)", 93, 2.5, 21.15, 0.13, 2.2, 150, "potato", "vegan", "usda-sr:170093"),
  row("Sweet potato (baked)", 90, 2.01, 20.71, 0.15, 3.3, 150, "potato", "vegan", "usda-sr:168483"),
  row("French fries", 312, 3.43, 41.44, 14.73, 3.8, 100, "g", "vegan", "usda-sr:170698"),
  row("Corn (cooked)", 96, 3.41, 20.98, 1.5, 2.4, 100, "g", "vegan", "usda-sr:169999"),
  row("Potato (boiled)", 86, 1.71, 20.01, 0.1, 1.8, 150, "potato", "vegan", "usda-sr:170440"),
  row("Mashed potatoes", 113, 1.86, 16.81, 4.22, 1.5, 210, "cup", "vegetarian", "usda-sr:168555"),
  row("Hash browns", 219, 2.65, 28.51, 11.59, 3.2, 100, "g", "vegan", "usda-sr:170044"),
  row("Roast potatoes", 126, 1.87, 20.45, 4.25, 1.4, 100, "g", "vegetarian", "usda-fndds:2709402"),
  row("Butternut squash (cooked)", 40, 0.9, 10.49, 0.09, 3.2, 100, "g", "vegan", "usda-sr:169296"),
  // ── Vegetables
  row("Broccoli (cooked)", 35, 2.38, 7.18, 0.41, 3.3, 100, "g", "vegan", "usda-sr:169967"),
  row("Spinach (raw)", 23, 2.86, 3.63, 0.39, 2.2, 100, "g", "vegan", "usda-sr:168462"),
  row("Kale (cooked)", 36, 2.94, 5.3, 1.21, 4, 100, "g", "vegan", "usda-sr:169238"),
  row("Carrots (raw)", 41, 0.93, 9.58, 0.24, 2.8, 100, "g", "vegan", "usda-sr:170393"),
  row("Bell pepper", 26, 0.99, 6.03, 0.3, 2.1, 100, "g", "vegan", "usda-sr:170108"),
  row("Cucumber", 15, 0.65, 3.63, 0.11, 0.5, 100, "g", "vegan", "usda-sr:168409"),
  row("Tomato", 18, 0.88, 3.89, 0.2, 1.2, 100, "g", "vegan", "usda-sr:170457"),
  row("Lettuce", 15, 1.36, 2.87, 0.15, 1.3, 100, "g", "vegan", "usda-sr:169249"),
  row("Onion", 40, 1.1, 9.34, 0.1, 1.7, 100, "g", "vegan", "usda-sr:170000"),
  row("Mushrooms", 22, 3.09, 3.26, 0.34, 1, 100, "g", "vegan", "usda-sr:169251"),
  row("Asparagus (cooked)", 22, 2.4, 4.11, 0.22, 2, 100, "g", "vegan", "usda-sr:168390"),
  row("Zucchini", 17, 1.21, 3.11, 0.32, 1, 100, "g", "vegan", "usda-sr:169291"),
  row("Cauliflower (cooked)", 23, 1.84, 4.11, 0.45, 2.3, 100, "g", "vegan", "usda-sr:170397"),
  row("Brussels sprouts (cooked)", 36, 2.55, 7.1, 0.5, 2.6, 100, "g", "vegan", "usda-sr:169971"),
  row("Cabbage", 25, 1.28, 5.8, 0.1, 2.5, 100, "g", "vegan", "usda-sr:169975"),
  row("Avocado", 160, 2, 8.53, 14.66, 6.7, 100, "g", "vegan", "usda-sr:171705"),
  row("Green beans (cooked)", 35, 1.89, 7.88, 0.28, 3.2, 100, "g", "vegan", "usda-sr:169141"),
  row("Celery", 14, 0.69, 2.97, 0.17, 1.6, 100, "g", "vegan", "usda-sr:169988"),
  row("Eggplant (cooked)", 35, 0.83, 8.73, 0.23, 2.5, 100, "g", "vegan", "usda-sr:169229"),
  row("Beets (cooked)", 44, 1.68, 9.96, 0.18, 2, 100, "g", "vegan", "usda-sr:169146"),
  row("Spinach (cooked)", 23, 2.97, 3.75, 0.26, 2.4, 100, "g", "vegan", "usda-sr:168463"),
  row("Carrots (cooked)", 35, 0.76, 8.22, 0.18, 3, 100, "g", "vegan", "usda-sr:170394"),
  row("Peas (green, cooked)", 78, 5.15, 14.26, 0.27, 4.5, 100, "g", "vegan", "usda-sr:170017"),
  row("Arugula", 25, 2.58, 3.65, 0.66, 1.6, 20, "g", "vegan", "usda-sr:169387"),
  row("Okra (cooked)", 22, 1.87, 4.51, 0.21, 2.5, 100, "g", "vegan", "usda-sr:169261"),
  row("Sauerkraut", 19, 0.91, 4.28, 0.14, 2.9, 50, "g", "vegan", "usda-sr:169279"),
  row("Pickles", 12, 0.5, 2.41, 0.3, 1, 35, "spear", "vegan", "usda-sr:168558"),
  row("Olives", 116, 0.84, 6.04, 10.9, 1.6, 15, "g", "vegan", "usda-sr:169094"),
  row("Mixed vegetables (cooked)", 65, 2.86, 13.09, 0.15, 4.4, 100, "g", "vegan", "usda-sr:170472"),
  row("Salad (green, no dressing)", 24, 1.07, 4.58, 0.2, 1.5, 100, "g", "vegan", "usda-fndds:2709822"),
  row("Coleslaw", 117, 0.94, 10.45, 7.98, 1.9, 110, "g", "vegetarian_eggs", "usda-fndds:2709815"),
  // ── Fruit
  row("Apple", 52, 0.26, 13.81, 0.17, 2.4, 180, "apple", "vegan", "usda-sr:171688"),
  row("Banana", 89, 1.09, 22.84, 0.33, 2.6, 120, "banana", "vegan", "usda-sr:173944"),
  row("Orange", 47, 0.94, 11.75, 0.12, 2.4, 150, "orange", "vegan", "usda-sr:169097"),
  row("Strawberries", 32, 0.67, 7.68, 0.3, 2, 100, "g", "vegan", "usda-sr:167762"),
  row("Blueberries", 57, 0.74, 14.49, 0.33, 2.4, 100, "g", "vegan", "usda-sr:171711"),
  row("Grapes", 69, 0.72, 18.1, 0.16, 0.9, 100, "g", "vegan", "usda-sr:174683"),
  row("Watermelon", 30, 0.61, 7.55, 0.15, 0.4, 100, "g", "vegan", "usda-sr:167765"),
  row("Mango", 60, 0.82, 14.98, 0.38, 1.6, 100, "g", "vegan", "usda-sr:169910"),
  row("Pineapple", 50, 0.54, 13.12, 0.12, 1.4, 100, "g", "vegan", "usda-sr:169124"),
  row("Pear", 57, 0.36, 15.23, 0.14, 3.1, 180, "pear", "vegan", "usda-sr:169118"),
  row("Peach", 39, 0.91, 9.54, 0.25, 1.5, 150, "peach", "vegan", "usda-sr:169928"),
  row("Kiwi", 61, 1.14, 14.66, 0.52, 3, 75, "kiwi", "vegan", "usda-sr:168153"),
  row("Raspberries", 52, 1.2, 11.94, 0.65, 6.5, 100, "g", "vegan", "usda-sr:167755"),
  row("Blackberries", 43, 1.39, 9.61, 0.49, 5.3, 100, "g", "vegan", "usda-sr:173946"),
  row("Cherries", 63, 1.06, 16.01, 0.2, 2.1, 100, "g", "vegan", "usda-sr:171719"),
  row("Plum", 46, 0.7, 11.42, 0.28, 1.4, 66, "plum", "vegan", "usda-sr:169949"),
  row("Grapefruit", 42, 0.77, 10.66, 0.14, 1.6, 123, "half", "vegan", "usda-sr:174673"),
  row("Cantaloupe", 34, 0.84, 8.16, 0.19, 0.9, 100, "g", "vegan", "usda-sr:169092"),
  row("Clementine", 47, 0.85, 12.02, 0.15, 1.7, 74, "clementine", "vegan", "usda-sr:168195"),
  row("Dates (Medjool)", 277, 1.81, 74.97, 0.15, 6.7, 24, "date", "vegan", "usda-sr:168191"),
  row("Raisins", 299, 3.3, 79.32, 0.25, 4.5, 30, "g", "vegan", "usda-sr:168165"),
  row("Pomegranate", 83, 1.67, 18.7, 1.17, 4, 100, "g", "vegan", "usda-sr:169134"),
  row("Applesauce (unsweetened)", 42, 0.17, 11.27, 0.1, 1.1, 122, "half cup", "vegan", "usda-sr:171695"),
  // ── Nuts and seeds
  row("Almonds", 579, 21.15, 21.55, 49.93, 12.5, 28, "oz", "vegan", "usda-sr:170567"),
  row("Peanuts", 567, 25.8, 16.13, 49.24, 8.5, 28, "oz", "vegan", "usda-sr:172430"),
  row("Walnuts", 654, 15.23, 13.71, 65.21, 6.7, 28, "oz", "vegan", "usda-sr:170187"),
  row("Cashews", 553, 18.22, 30.19, 43.85, 3.3, 28, "oz", "vegan", "usda-sr:170162"),
  row("Peanut butter", 598, 22.21, 22.31, 51.36, 5, 32, "2 tbsp", "vegan", "usda-sr:174266"),
  row("Almond butter", 614, 20.96, 18.82, 55.5, 10.3, 32, "2 tbsp", "vegan", "usda-sr:168588"),
  row("Chia seeds", 486, 16.54, 42.12, 30.74, 34.4, 28, "oz", "vegan", "usda-sr:170554"),
  row("Flax seeds", 534, 18.29, 28.88, 42.16, 27.3, 28, "oz", "vegan", "usda-sr:169414"),
  row("Sunflower seeds", 584, 20.78, 20, 51.46, 8.6, 28, "oz", "vegan", "usda-sr:170562"),
  row("Pistachios", 560, 20.16, 27.17, 45.32, 10.6, 28, "oz", "vegan", "usda-sr:170184"),
  row("Pecans", 691, 9.17, 13.86, 71.97, 9.6, 28, "oz", "vegan", "usda-sr:170182"),
  row("Hazelnuts", 628, 14.95, 16.7, 60.75, 9.7, 28, "oz", "vegan", "usda-sr:170581"),
  row("Pumpkin seeds", 559, 30.23, 10.71, 49.05, 6, 28, "oz", "vegan", "usda-sr:170556"),
  row("Mixed nuts", 607, 19.5, 22.42, 53.5, 6.4, 28, "oz", "vegan", "usda-sr:170585"),
  row("Trail mix", 462, 13.8, 44.9, 29.4, null, 42, "g", "vegan", "usda-sr:167561"),
  // ── Oils, sauces and spreads
  row("Olive oil", 884, 0, 0, 100, 0, 14, "tbsp", "vegan", "usda-sr:171413"),
  row("Coconut oil", 892, 0, 0, 99.06, 0, 14, "tbsp", "vegan", "usda-sr:171412"),
  row("Vegetable oil", 884, 0, 0, 100, 0, 14, "tbsp", "vegan", "usda-sr:171411"),
  row("Mayonnaise", 680, 0.96, 0.57, 74.85, 0, 15, "tbsp", "vegetarian_eggs", "usda-sr:171009"),
  row("Ketchup", 101, 1.04, 27.4, 0.1, 0.3, 17, "tbsp", "vegan", "usda-sr:168556"),
  row("Mustard", 60, 3.74, 5.83, 3.34, 4, 5, "tsp", "vegan", "usda-sr:172234"),
  row("BBQ sauce", 172, 0.82, 40.77, 0.63, 0.9, 17, "tbsp", "vegan", "usda-sr:174523"),
  row("Ranch dressing", 430, 1.32, 5.9, 44.54, 0, 30, "2 tbsp", "vegetarian_eggs", "usda-sr:173592"),
  row("Italian dressing", 240, 0.41, 12.12, 21.12, 0, 30, "2 tbsp", "vegetarian", "usda-sr:171019"),
  row("Caesar dressing", 542, 2.17, 3.3, 57.85, 0.5, 29, "2 tbsp", "non_vegetarian", "usda-fndds:2710199"),
  row("Soy sauce", 53, 8.14, 4.93, 0.57, 0.8, 16, "tbsp", "vegan", "usda-sr:174277"),
  row("Pesto", 418, 9.83, 10.09, 37.6, 1.8, 16, "tbsp", "vegetarian", "usda-sr:171579"),
  row("Jam", 278, 0.37, 68.86, 0.07, 1.1, 20, "tbsp", "vegan", "usda-sr:169641"),
  row("Maple syrup", 260, 0.04, 67.04, 0.06, 0, 20, "tbsp", "vegan", "usda-sr:169661"),
  row("Tomato sauce (marinara)", 50, 1.39, 7.43, 1.61, 1.8, 132, "half cup", "vegan", "usda-sr:171192"),
  row("Salsa", 29, 1.52, 6.64, 0.17, 1.9, 36, "2 tbsp", "vegan", "usda-sr:174524"),
  row("Guacamole", 155, 1.95, 8.45, 14.18, 6.5, 30, "2 tbsp", "vegan", "usda-fndds:2709307"),
  // ── Drinks
  row("Coffee (black)", 1, 0.12, 0, 0.02, 0, 240, "cup", "vegan", "usda-sr:171890"),
  row("Tea (unsweetened)", 1, 0, 0.3, 0, 0, 240, "cup", "vegan", "usda-sr:173227"),
  row("Orange juice", 45, 0.7, 10.4, 0.2, 0.2, 240, "cup", "vegan", "usda-sr:169098"),
  row("Apple juice", 46, 0.1, 11.3, 0.13, 0.2, 240, "cup", "vegan", "usda-sr:173933"),
  row("Coke / cola", 42, 0, 10.36, 0.25, 0, 240, "cup", "vegan", "usda-sr:174852"),
  row("Beer (regular)", 43, 0.46, 3.55, 0, 0, 350, "can", "vegan", "usda-sr:168746"),
  row("Wine (red)", 85, 0.07, 2.61, 0, 0, 150, "glass", "vegan", "usda-sr:173190"),
  row("Whey protein (powder)", 352, 78.13, 6.25, 1.56, 3.1, 30, "scoop", "vegetarian", "usda-fndds:2710742"),
  row("Latte", 43, 2.81, 4.35, 1.61, 0, 360, "small", "vegetarian", "usda-fndds:2710386"),
  row("Cappuccino", 27, 1.71, 2.75, 0.99, 0, 240, "cup", "vegetarian", "usda-fndds:2710472"),
  row("Hot chocolate", 91, 2.73, 16.53, 1.54, 0, 240, "cup", "vegetarian", "usda-fndds:2705473"),
  row("Sports drink", 26, 0, 6.43, 0, 0, 372, "bottle", "vegan", "usda-fndds:2710771"),
  row("Energy drink", 43, 0.46, 10.23, 0, 0, 260, "can", "vegan", "usda-fndds:2710756"),
  row("Smoothie (fruit)", 66, 2.32, 11.98, 1.1, 1.1, 324, "glass", "vegetarian", "usda-fndds:2705513"),
  row("Protein shake (ready to drink)", 61, 6.59, 0.85, 3.38, 0.4, 341, "bottle", "vegetarian", "usda-fndds:2710726"),
  row("Diet cola", 2, 0.11, 0.29, 0.03, 0, 370, "can", "vegan", "usda-fndds:2710542"),
  row("Wine (white)", 82, 0.07, 2.6, 0, 0, 150, "glass", "vegan", "usda-sr:174837"),
  row("Beer (light)", 29, 0.24, 1.64, 0, 0, 354, "can", "vegan", "usda-sr:168749"),
  row("Spirits (vodka, gin, rum, whiskey)", 231, 0, 0, 0, 0, 42, "shot", "vegan", "usda-sr:174815"),
  row("Soy milk", 33, 2.86, 1.74, 1.61, 0.5, 240, "cup", "vegan", "usda-sr:175215"),
  row("Almond milk", 15, 0.4, 1.31, 0.96, 0.2, 240, "cup", "vegan", "usda-sr:174832"),
  row("Oat milk", 45, 0.66, 5.37, 2.33, 0.5, 240, "cup", "vegan", "usda-fndds:2705412"),
  row("Water", 0, 0, 0, 0, 0, 240, "cup", "vegan", "usda-sr:173647"),
  // ── Everyday dishes
  row("Pizza (cheese)", 266, 11.39, 33.33, 9.69, 2.3, 107, "slice", "vegetarian", "usda-fndds:2708614"),
  row("Pizza (pepperoni)", 282, 11.74, 31.98, 11.91, 2.3, 107, "slice", "non_vegetarian", "usda-fndds:2708638"),
  row("Hamburger (fast food)", 285, 15.51, 28.27, 11.68, 1, 90, "burger", "non_vegetarian", "usda-fndds:2706921"),
  row("Hot dog", 296, 10.85, 23.73, 17.37, 0.8, 102, "hot dog", "non_vegetarian", "usda-fndds:2707056"),
  row("Sushi roll", 94, 2.92, 18.39, 0.67, 1, 100, "g", "non_vegetarian", "usda-fndds:2708959"),
  row("Burrito (chicken)", 209, 11.1, 26.05, 6.45, 2, 100, "g", "non_vegetarian", "usda-fndds:2708546"),
  row("Sandwich (turkey)", 189, 12.03, 26.51, 3.68, 1.2, 115, "sandwich", "non_vegetarian", "usda-fndds:2706981"),
  row("Caesar salad (with chicken, no dressing)", 63, 8.52, 2.99, 1.94, 1, 100, "g", "non_vegetarian", "usda-fndds:2706818"),
  row("Fried rice", 174, 3.84, 32.5, 3.19, 1.1, 100, "g", "vegetarian_eggs", "usda-fndds:2708952"),
  row("Mac and cheese", 223, 8.68, 23.08, 10.5, 1.2, 100, "g", "vegetarian", "usda-fndds:2708811"),
  row("Spaghetti bolognese", 125, 5.86, 19.15, 2.58, 1.6, 250, "cup", "non_vegetarian", "usda-fndds:2708838"),
  row("Lasagna (meat)", 139, 7.45, 16.17, 4.97, 1.6, 250, "g", "non_vegetarian", "usda-fndds:2708750"),
  row("Chili con carne", 118, 9.8, 10.25, 4.33, 3, 255, "cup", "non_vegetarian", "usda-fndds:2706375"),
  row("Beef stew", 107, 8.76, 6.29, 5.07, 1.3, 255, "cup", "non_vegetarian", "usda-fndds:2706592"),
  row("Chicken noodle soup", 53, 3.84, 6.21, 1.4, 0.7, 245, "cup", "non_vegetarian", "usda-fndds:2709149"),
  row("Tomato soup", 34, 0.63, 7.65, 0.33, 0.6, 245, "cup", "vegan", "usda-fndds:2709759"),
  row("Lentil soup", 60, 3.82, 10.2, 0.69, 3.7, 255, "cup", "vegan", "usda-fndds:2707462"),
  row("Grilled cheese sandwich", 343, 11.03, 28.09, 20.78, 1.2, 116, "sandwich", "vegetarian", "usda-fndds:2705801"),
  row("Peanut butter and jelly sandwich", 361, 11.42, 45.22, 16.6, 2.8, 112, "sandwich", "vegetarian", "usda-fndds:2707554"),
  row("Tacos (beef)", 249, 15.47, 15.3, 13.94, 2.1, 105, "taco", "non_vegetarian", "usda-fndds:2708515"),
  row("Quesadilla (cheese)", 316, 13.36, 28.62, 16.21, 2, 120, "quesadilla", "vegetarian", "usda-fndds:2708591"),
  row("Nachos (cheese)", 266, 4.46, 27.83, 15.74, 2, 125, "g", "vegetarian", "usda-fndds:2708577"),
  row("Cheeseburger", 296, 17.87, 18.71, 16.15, 0.6, 165, "burger", "non_vegetarian", "usda-fndds:2706888"),
  row("Veggie burger", 177, 15.7, 14.27, 6.3, 4.9, 100, "patty", "vegetarian_eggs", "usda-fndds:2707473"),
  row("Chicken sandwich (fried)", 281, 12.17, 27.48, 13.46, 1.7, 140, "sandwich", "non_vegetarian", "usda-fndds:2707003"),
  row("Shepherd's pie", 123, 7.64, 8.72, 6.3, 1.5, 210, "portion", "non_vegetarian", "usda-fndds:2706594"),
  row("Chicken stir-fry (with vegetables)", 95, 8.18, 5.38, 4.56, 0.9, 217, "cup", "non_vegetarian", "usda-fndds:2706790"),
  row("Greek salad (no dressing)", 48, 2.75, 4.35, 2.26, 1.5, 105, "cup", "non_vegetarian", "usda-fndds:2709830"),
  row("Potato salad", 143, 2.68, 11.17, 8.2, 1.3, 125, "half cup", "vegetarian_eggs", "usda-sr:169269"),
  row("Gyro", 184, 11.24, 18.78, 6.76, 1, 200, "gyro", "non_vegetarian", "usda-fndds:2706962"),
  // ── Snacks and sweets
  row("Chocolate (dark, 70–85%)", 598, 7.79, 45.9, 42.63, 10.9, 30, "oz", "vegetarian", "usda-sr:170273"),
  row("Chocolate chip cookie", 492, 5.1, 65.36, 24.72, 2, 30, "cookie", "vegetarian_eggs", "usda-sr:172716"),
  row("Ice cream (vanilla)", 207, 3.5, 23.6, 11, 0.7, 100, "g", "vegetarian_eggs", "usda-sr:167575"),
  row("Potato chips", 532, 6.39, 53.83, 33.98, 3.1, 28, "oz", "vegan", "usda-sr:169677"),
  row("Pretzels", 384, 10.04, 80.39, 2.93, 3.4, 30, "oz", "vegan", "usda-sr:167555"),
  row("Popcorn (plain)", 387, 12.94, 77.78, 4.54, 14.5, 30, "g", "vegan", "usda-sr:167959"),
  row("Honey", 304, 0.3, 82.4, 0, 0.2, 21, "tbsp", "vegetarian", "usda-sr:169640"),
  row("Sugar (white)", 387, 0, 99.98, 0, 0, 4, "tsp", "vegan", "usda-sr:169655"),
  row("Donut (glazed)", 421, 6.14, 47.93, 22.7, 2.1, 60, "donut", "vegetarian_eggs", "usda-sr:172758"),
  row("Croissant", 406, 8.2, 45.8, 21, 2.6, 60, "croissant", "vegetarian_eggs", "usda-sr:174987"),
  row("Protein bar", 386, 22.36, 55.22, 9.94, 4.7, 60, "bar", "vegetarian", "usda-fndds:2708127"),
  row("Granola bar", 471, 10.1, 64.4, 19.8, 5.3, 25, "bar", "vegetarian", "usda-sr:167542"),
  row("Milk chocolate", 535, 7.65, 59.4, 29.66, 3.4, 28, "oz", "vegetarian", "usda-sr:167587"),
  row("Brownie", 405, 4.8, 63.9, 16.3, 2.1, 56, "brownie", "vegetarian_eggs", "usda-sr:172713"),
  row("Cheesecake", 321, 5.5, 25.5, 22.5, 0.4, 80, "slice", "vegetarian_eggs", "usda-sr:172711"),
  row("Apple pie", 237, 1.9, 34, 11, 1.6, 125, "slice", "vegetarian", "usda-sr:175011"),
  row("Blueberry muffin", 375, 4.49, 53, 16.07, 1.1, 113, "muffin", "vegetarian_eggs", "usda-sr:172765"),
  row("Chocolate cake", 389, 3.48, 52.84, 20.05, 2.2, 80, "slice", "vegetarian_eggs", "usda-sr:174934"),
  row("Tortilla chips", 472, 7.1, 67.78, 20.68, 5.4, 28, "oz", "vegan", "usda-sr:167558"),
  row("Banana bread", 326, 4.3, 54.6, 10.5, 1.1, 60, "slice", "vegetarian_eggs", "usda-sr:174906"),
  // ── Indian dishes
  row("Roti / Chapati (homemade flatbread, no fat)", 202, 7.3, 43.7, 1, null, 40, "roti", "vegan", "uk-cofid:11-459"),
  row("Roti / Chapati (store-bought flatbread)", 297, 11.25, 46.36, 7.45, 4.9, 68, "roti", "vegan", "usda-sr:171844"),
  row("Naan (Indian flatbread)", 291, 9.62, 50.43, 5.65, 2.2, 90, "naan", "vegetarian_eggs", "usda-sr:171845"),
  row("Dal (lentil curry)", 145, 8.6, 19.17, 4.31, 7.5, 100, "g", "vegetarian", "usda-fndds:2707427"),
  row("Paneer (Indian cottage cheese)", 328, 26, 0.9, 24.5, 0, 100, "g", "vegetarian", "uk-cofid:12-495"),
  row("Chicken curry", 107, 6.48, 6.54, 6.48, 1.4, 100, "g", "non_vegetarian", "usda-fndds:2706437"),
  row("Butter chicken / tikka masala", 156, 12.4, 4.9, 9.8, 1.4, 100, "g", "non_vegetarian", "uk-cofid:19-296"),
  row("Biryani (spiced rice with chicken)", 104, 7.15, 13.55, 2.38, 1.1, 100, "g", "non_vegetarian", "usda-fndds:2706538"),
  row("Samosa (fried pastry, potato and peas)", 310, 5.14, 33.16, 17.47, 1.8, 75, "samosa", "vegetarian", "usda-fndds:2708730"),
  row("Idli (steamed rice cake)", 128, 6.36, 24.98, 0.35, 5.8, 38, "idli", "vegan", "usda-fndds:2708346"),
  row("Dosa (rice and lentil crepe, plain)", 210, 5.7, 37.04, 4.05, 1.8, 80, "dosa", "vegan", "usda-fndds:2708347"),
  row("Palak paneer (spinach and cheese curry)", 101, 5.42, 4.28, 7.02, 0.9, 200, "cup", "vegetarian", "usda-fndds:2709631"),
  row("Chana masala (chickpea curry)", 237, 7.7, 20.1, 14.4, 4.2, 200, "g", "vegetarian", "uk-cofid:15-746"),
  row("Vegetable curry", 86, 1.6, 8.81, 5.27, 1.8, 240, "cup", "vegetarian", "usda-fndds:2710067"),
  row("Biryani (spiced rice with vegetables)", 109, 1.93, 17.91, 3.2, 1.2, 172, "cup", "vegetarian", "usda-fndds:2708985"),
  row("Paratha (layered flatbread)", 326, 6.36, 45.35, 13.2, 9.6, 79, "paratha", "vegetarian", "usda-sr:174076"),
  // ── Asian dishes
  row("Ramen (instant, cooked)", 66, 1.53, 9.04, 2.64, 0.4, 100, "g", "non_vegetarian", "usda-fndds:2709152"),
  row("Pad Thai", 154, 8.13, 14.36, 7.5, 1.2, 100, "g", "non_vegetarian", "usda-fndds:2708804"),
  row("Egg roll (vegetable, fried)", 270, 5.62, 30.02, 14.14, 2.3, 64, "roll", "vegetarian_eggs", "usda-fndds:2708700"),
  row("Dumplings (pork, fried)", 192, 8.76, 14.05, 11.13, 1.5, 100, "g", "non_vegetarian", "usda-fndds:2708705"),
  row("Pho (beef)", 77, 5.81, 5.6, 3.33, 0.4, 400, "bowl", "non_vegetarian", "usda-fndds:2707124"),
  row("Ramen bowl", 127, 7.13, 13.95, 4.57, 0.9, 490, "bowl", "non_vegetarian", "usda-fndds:2709153"),
];

/** Names the words of the list's own names do not reach, each pointing at a
 *  canonical: other spellings and local names, the English name of an Indian
 *  dish (its name holds it in brackets, but a name is found by the words outside
 *  them), a cooking word where the table's cooking is the same one, and the
 *  single words that stand for one common food ("chicken" for cooked chicken
 *  breast). A Map, not an object literal, so a key such as "constructor" is
 *  never found on the prototype. Exported for the test that holds each one to a
 *  food on the list. */
export const FOOD_ALIASES: ReadonlyMap<string, string> = new Map(Object.entries({
  // Indian names
  roti: "roti_chapati", chapati: "roti_chapati", flatbread: "roti_chapati",
  phulka: "roti_chapati", rotli: "roti_chapati", fulka: "roti_chapati",
  daal: "dal_lentil_curry", dhal: "dal_lentil_curry", dahl: "dal_lentil_curry",
  aloo: "potato_baked", alu: "potato_baked",
  chawal: "rice_white_cooked", bhaat: "rice_white_cooked",
  anda: "egg_whole_large",
  chana: "chickpeas_cooked", chhole: "chana_masala", chole: "chana_masala",
  rajma: "kidney_beans_cooked", bhindi: "okra_cooked", garlic_naan: "naan", paneer_tikka: "paneer",
  // English names for Indian dishes
  lentil_curry: "dal_lentil_curry", chickpea_curry: "chana_masala", indian_cottage_cheese: "paneer",
  naan_bread: "naan",
  // the closest entry USDA has: its survey foods hold egg rolls and no spring roll
  spring_roll: "spring_roll",
  // other spellings and names
  capsicum: "bell_pepper", maize: "corn_cooked", groundnut: "peanuts",
  prawns: "shrimp_cooked", prawn: "shrimp_cooked",
  yoghurt: "yogurt_plain_low_fat", courgette: "zucchini", aubergine: "eggplant_cooked",
  beetroot: "beets_cooked", rocket: "arugula", crisps: "potato_chips", porridge: "oatmeal_cooked",
  mince: "ground_beef_85_cooked", minced_beef: "ground_beef_85_cooked", lasagne: "lasagna_meat",
  fish_fingers: "fish_sticks", cottage_pie: "shepherd_s_pie", shepherds_pie: "shepherd_s_pie", omelet: "omelette_plain",
  doughnut: "donut_glazed", mandarin: "clementine", tangerine: "clementine",
  apple_sauce: "applesauce_unsweetened", mayo: "mayonnaise", lox: "smoked_salmon",
  cornflakes: "cereal_cornflakes", corn_flakes: "cereal_cornflakes", pita: "pita_bread",
  bun: "bread_roll", baguette: "french_bread_sourdough", ribeye: "ribeye_steak_cooked",
  rib_eye_steak: "ribeye_steak_cooked", brisket: "beef_brisket_cooked", jerky: "beef_jerky",
  nuggets: "chicken_nuggets", wings: "chicken_wings_cooked", ribs: "pork_ribs_cooked",
  ranch: "ranch_dressing", barbecue_sauce: "bbq_sauce", marinara: "tomato_sauce_marinara",
  pasta_sauce: "tomato_sauce_marinara", garden_salad: "salad_green_no_dressing",
  side_salad: "salad_green_no_dressing", protein_powder: "whey_protein_powder",
  gatorade: "sports_drink", red_bull: "energy_drink", diet_coke: "diet_cola", coke_zero: "diet_cola",
  coca_cola: "coke_cola", vodka: "spirits_vodka_gin_rum_whiskey", gin: "spirits_vodka_gin_rum_whiskey",
  rum: "spirits_vodka_gin_rum_whiskey", whiskey: "spirits_vodka_gin_rum_whiskey",
  whisky: "spirits_vodka_gin_rum_whiskey", hotdog: "hot_dog", cheese_burger: "cheeseburger",
  grilled_cheese: "grilled_cheese_sandwich", pb_j: "peanut_butter_and_jelly_sandwich",
  macaroni_and_cheese: "mac_and_cheese", chicken_soup: "chicken_noodle_soup", doner: "gyro",
  doner_kebab: "gyro", california_roll: "sushi_roll", egg_fried_rice: "fried_rice",
  battered_fish: "fried_fish_coated",
  // a cooking word where the table's cooking is the same one
  grilled_chicken: "chicken_breast_grilled", grilled_salmon: "salmon_cooked", baked_salmon: "salmon_cooked",
  roast_chicken: "rotisserie_chicken", roasted_chicken: "rotisserie_chicken", roasted_potatoes: "roast_potatoes",
  // one word for one common food
  chicken: "chicken_breast_cooked", beef: "ground_beef_85_cooked", ground_beef: "ground_beef_85_cooked",
  pork: "pork_chop_cooked", turkey: "turkey_breast_cooked", sausage: "pork_sausage_cooked",
  bread: "whole_wheat_bread", cheese: "cheddar_cheese", cheddar: "cheddar_cheese",
  mozzarella: "mozzarella_cheese", parmesan: "parmesan_cheese", feta: "feta_cheese",
  nuts: "mixed_nuts", juice: "orange_juice",
  fries: "french_fries", burger: "hamburger_fast_food", cookie: "chocolate_chip_cookie",
  sushi: "sushi_roll", spaghetti: "pasta_cooked", chili: "chili_con_carne", chilli: "chili_con_carne",
  chilli_con_carne: "chili_con_carne", bolognese: "spaghetti_bolognese",
  // Left out on purpose: a word the markets use for different foods. "Jelly" is
  // jam in the US and a gelatine dessert in the UK, "chips" are crisps in the US
  // and fries in the UK, and "beans" on a British plate are baked beans.
}));

/** Words that only say how a food is arranged, cut or served, never what it
 *  is, so dropping them can only reveal the food's own name ("flatbread stack",
 *  "sliced banana", "glass of milk"). Words that change what a food is stay out:
 *  hot, warm, iced, fresh, plain and homemade ("hot chocolate" is not chocolate,
 *  "iced coffee" is not black coffee), and so do cooking words. Exported for the
 *  test that holds each cut and vessel among them to the photo count's own
 *  lists, because a food found by dropping "slices" must not be counted whole. */
export const NOISE_WORDS: ReadonlySet<string> = new Set([
  "stack", "stacks", "pile", "piles", "plate", "plates", "plateful", "bowl", "bowls",
  "serving", "servings", "portion", "portions", "piece", "pieces", "slice", "slices",
  "helping", "helpings", "of", "with", "a", "an", "the", "some", "handful", "handfuls",
  "cup", "cups", "glass", "glasses", "mug", "mugs", "can", "cans", "bottle", "bottles",
  "sliced", "chopped", "diced", "cubed", "halved", "quartered", "peeled", "shredded", "grated",
  "chunk", "chunks", "cube", "cubes", "segment", "segments", "fillet", "fillets",
  "floret", "florets", "leaf", "leaves", "small", "medium", "large",
]);

const toTokens = (slugged: string): string[] => slugged.split("_").filter((w) => w !== "");

/** Slug with the noise words removed; null when nothing, or everything, went. */
function denoise(slugged: string): string | null {
  const kept = toTokens(slugged).filter((w) => !NOISE_WORDS.has(w));
  if (kept.length === 0) return null;
  const rebuilt = kept.join("_");
  return rebuilt === slugged ? null : rebuilt;
}

/** One spelling for a word and its plural, used on both sides of every
 *  comparison: eggs and egg, berries and berry, cookies and cookie, tomatoes and
 *  tomato, sandwiches and sandwich. */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith("ie")) return `${word.slice(0, -2)}y`;
  if (word.length > 4 && /(?:ches|shes|sses|xes|oes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

const stemmedWords = (text: string): string[] => toTokens(slug(text)).map(stem);

interface FoodWords {
  food: CuratedFood;
  /** The name outside its brackets, one list per "/" alternative ("Roti / Chapati"). */
  heads: readonly (readonly string[])[];
  /** The heads as one string, equal for two versions of one food ("Milk (whole)", "Milk (skim)"). */
  headKey: string;
  /** Every word of the name, brackets included. */
  all: ReadonlySet<string>;
}

const FOOD_WORDS: readonly FoodWords[] = CURATED_FOODS.map((food) => {
  const heads = food.name.replaceAll(/\([^)]*\)/g, " ").split("/").map(stemmedWords).filter((head) => head.length > 0);
  return { food, heads, headKey: heads.map((head) => head.join(" ")).join(" / "), all: new Set(stemmedWords(food.name)) };
});

const BY_CANONICAL: ReadonlyMap<string, CuratedFood> = new Map(CURATED_FOODS.map((food) => [food.canonical, food]));

/** The food a slugged name names word for word. First a food whose name outside
 *  its brackets is those words, in order ("tuna" is "Tuna (canned in water)"; the
 *  earlier of two such foods, so a plain food is listed before its variants).
 *  Then a food whose name holds every one of the words and the whole of its own
 *  name outside the brackets ("white rice" is "Rice (white, cooked)"), the one
 *  with the fewest words if two do. Two versions of one food (the same name
 *  outside the brackets) are never told apart by how many words their brackets
 *  hold: the one listed first is the one a plain name means, so "roti flatbread"
 *  is the homemade roti whichever version's brackets are shorter (Kd,
 *  2026-09-14). A word the food's name lacks rules it out: "banana bread" is
 *  never a banana and "hot tea" never a tea, because a wrong food is worse than
 *  an honest miss. */
function byWords(slugged: string): CuratedFood | null {
  const words = toTokens(slugged).map(stem);
  if (words.length === 0) return null;
  const named = FOOD_WORDS.find((f) => f.heads.some((head) => head.length === words.length && head.every((w, i) => w === words[i])));
  if (named !== undefined) return named.food;
  const matches = FOOD_WORDS.filter(
    (f) => words.every((w) => f.all.has(w)) && f.heads.some((head) => head.every((w) => words.includes(w))),
  );
  let best: FoodWords | null = null;
  for (const [at, f] of matches.entries()) {
    if (matches.slice(0, at).some((earlier) => earlier.headKey === f.headKey)) continue;
    if (best === null || f.all.size < best.all.size) best = f;
  }
  return best === null ? null : best.food;
}

/** The aliases keyed by their words' one spelling, so "nugget" finds "nuggets"
 *  and "cookies" finds "cookie". */
const ALIASES_BY_STEM: ReadonlyMap<string, string> = new Map(
  [...FOOD_ALIASES].map(([alias, canonical]) => [toTokens(alias).map(stem).join("_"), canonical]),
);

const aliasFor = (slugged: string): string | undefined => ALIASES_BY_STEM.get(toTokens(slugged).map(stem).join("_"));

function byAliasOrWords(slugged: string): CuratedFood | null {
  const target = aliasFor(slugged);
  if (target !== undefined) return BY_CANONICAL.get(target) ?? null;
  return byWords(slugged);
}

/** The one food a name means, or null: the food whose canonical it is, then an
 *  alias, then the name's own words, and then the same again with the noise
 *  words dropped ("Pizza Slice" is pizza). The canonical comes first, so a saved
 *  or searched food is found again as itself even where another food's name
 *  holds its words, or its own name no longer does ("roti_chapati" is the
 *  homemade roti, not the store-bought one with fewer words; "spring_roll" is
 *  the egg roll it was renamed to). */
export function findCurated(query: string): CuratedFood | null {
  const q = slug(query);
  if (q === "") return null;
  const exact = BY_CANONICAL.get(q);
  if (exact !== undefined) return exact;
  const stripped = denoise(q);
  return byAliasOrWords(q) ?? (stripped === null ? null : byAliasOrWords(stripped));
}

function aliasTargetFor(slugged: string): string | undefined {
  const stripped = denoise(slugged);
  return aliasFor(slugged) ?? (stripped === null ? undefined : aliasFor(stripped));
}

const isWordChar = (ch: string): boolean => /[a-z0-9]/.test(ch);

const endsWord = (name: string, at: number): boolean =>
  !isWordChar(name.charAt(at)) || (name.charAt(at) === "s" && !isWordChar(name.charAt(at + 1)));

function holdsAtWordStart(name: string, q: string): boolean {
  for (let at = name.indexOf(q); at !== -1; at = name.indexOf(q, at + 1)) {
    if (at === 0 || !isWordChar(name.charAt(at - 1))) return true;
  }
  return false;
}

/** How well a food's name answers what was typed in the search box. */
function searchScore(food: CuratedFood, q: string, aliasTarget: string | undefined): number {
  const name = food.name.toLowerCase();
  if (name === q) return 100;
  if (food.canonical === aliasTarget) return 90;
  // A whole word, or its plural, first: typing "ham" lists Ham before Hamburger,
  // and "pea" lists Peas before Peach.
  if (name.startsWith(q)) return endsWord(name, q.length) ? 85 : 80;
  if (holdsAtWordStart(name, q)) return 60;
  if (name.includes(q)) return 50;
  return q.split(/\s+/).every((word) => name.includes(word)) ? 30 : 0;
}

/** Foods for the search box, best match first; the box shows several and the
 *  person picks, so part of a word still counts here. */
export function searchCurated(query: string, limit: number): CuratedFood[] {
  const q = query.toLowerCase().trim();
  if (q === "") return [];
  const aliasTarget = aliasTargetFor(slug(q));
  return CURATED_FOODS.map((food) => ({ food, score: searchScore(food, q, aliasTarget) }))
    .filter((v) => v.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((v) => v.food);
}
