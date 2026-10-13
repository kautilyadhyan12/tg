// The curated food list: each food's numbers per 100 g, copied from a named food
// composition table, and the lowest diet that eats it.
//
// Where the numbers come from (`citation` on every food):
//   usda-sr:<FDC id>     USDA FoodData Central, SR Legacy (April 2018)
//   usda-fndds:<FDC id>  USDA FoodData Central, FNDDS 2021-2023 survey foods (October 2024)
//   uk-cofid:<food code> UK McCance and Widdowson's Composition of Foods Integrated Dataset (2021)
// USDA is used first. CoFID is used where USDA has no entry for the food: a roti
// made at home without fat (USDA's rotis are store-bought), muesli, chana masala,
// butter chicken, and the British dishes with a few European ones (a Cornish
// pasty, haggis, a Yorkshire pudding, moussaka, goulash, risotto), and the
// takeaway and home dishes of Asia USDA lacks (a korma, a rogan josh, chicken
// satay, Thai green curry, raita, lassi, kulfi); CoFID gives no
// household measure, so those are served by the gram. Paneer is CoFID's too: USDA's survey entry is worked out
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
// traditional refried beans, anchovy in Caesar dressing; meat stock in French
// onion soup, borscht, minestrone, pumpkin soup, risotto and matzo ball soup,
// beef dripping under a Yorkshire pudding and bubble and squeak, suet in a
// mince pie, gelatine in a trifle's jelly, anchovy in the Worcestershire sauce
// of a Welsh rarebit, egg in fresh pasta, gnocchi and strudel dough; fish sauce
// or salted shrimp in kimchi, fish stock in miso soup, egg in tempura batter, oyster sauce and chicken base
// in a restaurant's vegetable lo mein and chow mein). Honey is not vegan.
// A dish made with meat or without is listed both ways where the tables hold
// both, each under a name that says which ("Vegetable chow mein", "Rice and
// beans with meat", "Congee with vegetables"), and a dish the tables hold one
// way says which way in front ("Pork dumplings", "Chicken korma", "Shrimp summer
// roll"), so the plain word names none and the person picks (Kd, 2026-10-13).
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

/** A name's words joined by "_", in lower case with accents folded, so "Müller"
 *  is "muller" and "crème fraîche" "creme_fraiche". */
export const slug = (v: string): string =>
  v.normalize("NFKD").replaceAll(/\p{M}/gu, "").toLowerCase().replaceAll(/[^a-z0-9]+/g, "_").replaceAll(/^_+|_+$/g, "");

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
  ["Pork dumplings (fried)", "dumplings_pork"],
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
  row("Duck (roasted)", 201, 23.48, 0, 11.2, 0, 100, "g", "non_vegetarian", "usda-sr:172411"),
  row("Venison (cooked)", 158, 30.21, 0, 3.19, 0, 100, "g", "non_vegetarian", "usda-sr:175085"),
  row("Bison (ground, cooked)", 238, 23.77, 0, 15.13, 0, 87, "patty", "non_vegetarian", "usda-sr:174422"),
  row("Beef liver (cooked)", 175, 26.52, 5.16, 4.68, 0, 100, "g", "non_vegetarian", "usda-sr:168627"),
  row("Chicken liver (cooked)", 167, 24.46, 0.87, 6.51, 0, 100, "g", "non_vegetarian", "usda-sr:171061"),
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
  row("Halibut (cooked)", 111, 22.54, 0, 1.61, 0, 100, "g", "non_vegetarian", "usda-sr:174201"),
  row("Pollock (cooked)", 111, 23.48, 0, 1.18, 0, 100, "g", "non_vegetarian", "usda-sr:173681"),
  row("Catfish (cooked)", 144, 18.44, 0, 7.19, 0, 100, "g", "non_vegetarian", "usda-sr:175166"),
  row("Snapper (cooked)", 128, 26.3, 0, 1.72, 0, 100, "g", "non_vegetarian", "usda-sr:173699"),
  row("Swordfish (cooked)", 172, 23.45, 0, 7.93, 0, 100, "g", "non_vegetarian", "usda-sr:173704"),
  row("Mahi-mahi (cooked)", 109, 23.72, 0, 0.9, 0, 100, "g", "non_vegetarian", "usda-sr:171992"),
  row("Anchovies (canned in oil)", 210, 28.89, 0, 9.71, 0, 4, "anchovy", "non_vegetarian", "usda-sr:174183"),
  row("Oysters (raw)", 51, 5.71, 2.72, 1.71, 0, 14, "oyster", "non_vegetarian", "usda-sr:171978"),
  row("Clams (cooked)", 148, 25.55, 5.13, 1.95, 0, 9.5, "clam", "non_vegetarian", "usda-sr:171975"),
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
  row("Greek yogurt (plain, whole milk)", 97, 9, 3.98, 5, 0, 100, "g", "vegetarian", "usda-sr:171304"),
  row("Ricotta cheese", 150, 7.54, 7.27, 10.18, 0, 124, "half cup", "vegetarian", "usda-sr:170851"),
  row("Blue cheese", 353, 21.4, 2.34, 28.74, 0, 28, "oz", "vegetarian", "usda-sr:172175"),
  row("Gouda cheese", 356, 24.94, 2.22, 27.44, 0, 28, "oz", "vegetarian", "usda-sr:171241"),
  row("Buttermilk", 40, 3.31, 4.79, 1.07, 0, 245, "cup", "vegetarian", "usda-sr:170874"),
  row("Goat milk", 69, 3.56, 4.45, 4.14, 0, 244, "cup", "vegetarian", "usda-sr:171278"),
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
  row("Tofu (soft)", 61, 7.17, 1.18, 3.69, 0.2, 120, "piece", "vegan", "usda-sr:172449"),
  row("Miso", 198, 12.79, 25.37, 6.01, 5.4, 17, "tbsp", "vegan", "usda-sr:172442"),
  row("Red lentils (dry)", 358, 23.91, 63.1, 2.17, 10.8, 100, "g", "vegan", "usda-sr:174284"),
  row("Split peas (cooked)", 118, 8.34, 21.1, 0.39, 8.3, 100, "g", "vegan", "usda-sr:172429"),
  row("Navy beans (cooked)", 140, 8.23, 26.05, 0.62, 10.5, 100, "g", "vegan", "usda-sr:173746"),
  row("Lima beans (cooked)", 115, 7.8, 20.88, 0.38, 7, 100, "g", "vegan", "usda-sr:174253"),
  row("Mung beans (cooked)", 105, 7.02, 19.15, 0.38, 7.6, 100, "g", "vegan", "usda-sr:174257"),
  row("Soybeans (cooked)", 172, 18.21, 8.36, 8.97, 6, 100, "g", "vegan", "usda-sr:174271"),
  row("Black-eyed peas (cooked)", 116, 7.73, 20.76, 0.53, 6.5, 100, "g", "vegan", "usda-sr:173759"),
  row("Fava / broad beans (cooked)", 110, 7.6, 19.65, 0.4, 5.4, 100, "g", "vegan", "usda-sr:173753"),
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
  row("Barley (cooked)", 123, 2.26, 28.22, 0.44, 3.8, 100, "g", "vegan", "usda-sr:170285"),
  row("Bulgur (cooked)", 83, 3.08, 18.58, 0.24, 4.5, 100, "g", "vegan", "usda-sr:170287"),
  row("Buckwheat (cooked)", 92, 3.38, 19.94, 0.62, 2.7, 100, "g", "vegan", "usda-sr:170686"),
  row("Millet (cooked)", 119, 3.51, 23.67, 1, 1.3, 100, "g", "vegan", "usda-sr:168871"),
  row("Wild rice (cooked)", 101, 3.99, 21.34, 0.34, 1.8, 100, "g", "vegan", "usda-sr:168897"),
  row("Wheat germ", 360, 23.15, 51.8, 9.72, 13.2, 15, "g", "vegan", "usda-sr:168892"),
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
  row("Pumpkin (boiled)", 20, 0.72, 4.9, 0.07, 1.1, 100, "g", "vegan", "usda-sr:168449"),
  row("Acorn squash (cooked)", 56, 1.12, 14.58, 0.14, 4.4, 100, "g", "vegan", "usda-sr:169293"),
  row("Spaghetti squash (cooked)", 27, 0.66, 6.46, 0.26, 1.4, 100, "g", "vegan", "usda-sr:169299"),
  row("Parsnips (cooked)", 71, 1.32, 17.01, 0.3, 3.6, 100, "g", "vegan", "usda-sr:170009"),
  row("Turnip (cooked)", 22, 0.71, 5.06, 0.08, 2, 100, "g", "vegan", "usda-sr:170058"),
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
  row("Broccoli (raw)", 34, 2.82, 6.64, 0.37, 2.6, 100, "g", "vegan", "usda-sr:170379"),
  row("Cauliflower (raw)", 25, 1.92, 4.97, 0.28, 2, 100, "g", "vegan", "usda-sr:169986"),
  row("Kale (raw)", 35, 2.92, 4.42, 1.49, 4.1, 100, "g", "vegan", "usda-sr:168421"),
  row("Leeks (cooked)", 31, 0.81, 7.62, 0.2, 1, 124, "leek", "vegan", "usda-sr:168426"),
  row("Radishes", 16, 0.68, 3.4, 0.1, 1.6, 100, "g", "vegan", "usda-sr:169276"),
  row("Artichoke (cooked)", 53, 2.89, 11.95, 0.34, 5.7, 120, "artichoke", "vegan", "usda-sr:168386"),
  row("Bok choy (cooked)", 12, 1.56, 1.78, 0.16, 1, 100, "g", "vegan", "usda-sr:170391"),
  row("Swiss chard (cooked)", 20, 1.88, 4.13, 0.08, 2.1, 100, "g", "vegan", "usda-sr:170401"),
  row("Collard greens (cooked)", 33, 2.71, 5.65, 0.72, 4, 100, "g", "vegan", "usda-sr:170407"),
  row("Fennel", 31, 1.24, 7.3, 0.2, 3.1, 100, "g", "vegan", "usda-sr:169385"),
  row("Red cabbage", 31, 1.43, 7.37, 0.16, 2.1, 100, "g", "vegan", "usda-sr:169977"),
  row("Watercress", 11, 2.3, 1.29, 0.1, 0.5, 100, "g", "vegan", "usda-sr:170068"),
  row("Snow peas / sugar snap peas", 42, 2.8, 7.55, 0.2, 2.6, 100, "g", "vegan", "usda-sr:170010"),
  row("Bean sprouts", 30, 3.04, 5.94, 0.18, 1.8, 100, "g", "vegan", "usda-sr:169957"),
  row("Green onions / scallions", 32, 1.83, 7.34, 0.19, 2.6, 15, "green onion", "vegan", "usda-sr:170005"),
  row("Jalapeño pepper", 29, 0.91, 6.5, 0.37, 2.8, 14, "pepper", "vegan", "usda-sr:168576"),
  row("Garlic", 149, 6.36, 33.06, 0.5, 2.1, 3, "clove", "vegan", "usda-sr:169230"),
  row("Ginger (fresh)", 80, 1.82, 17.77, 0.75, 2, 2, "tsp", "vegan", "usda-sr:169231"),
  row("Sun-dried tomatoes", 258, 14.11, 55.76, 2.97, 12.3, 30, "g", "vegan", "usda-sr:168567"),
  row("Portobello mushroom (grilled)", 29, 3.28, 4.44, 0.58, 2.2, 100, "g", "vegan", "usda-sr:169243"),
  row("Shiitake mushrooms (cooked)", 56, 1.56, 14.39, 0.22, 2.1, 100, "g", "vegan", "usda-sr:168437"),
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
  row("Papaya", 43, 0.47, 10.82, 0.26, 1.7, 100, "g", "vegan", "usda-sr:169926"),
  row("Apricot", 48, 1.4, 11.12, 0.39, 2, 35, "apricot", "vegan", "usda-sr:171697"),
  row("Apricots (dried)", 241, 3.39, 62.64, 0.51, 7.3, 30, "g", "vegan", "usda-sr:173941"),
  row("Figs (fresh)", 74, 0.75, 19.18, 0.3, 2.9, 50, "fig", "vegan", "usda-sr:173021"),
  row("Figs (dried)", 249, 3.3, 63.87, 0.93, 9.8, 8.4, "fig", "vegan", "usda-sr:174665"),
  row("Lemon", 29, 1.1, 9.32, 0.3, 2.8, 58, "lemon", "vegan", "usda-sr:167746"),
  row("Lime", 30, 0.7, 10.54, 0.2, 2.8, 67, "lime", "vegan", "usda-sr:168155"),
  row("Nectarine", 44, 1.06, 10.55, 0.32, 1.7, 142, "nectarine", "vegan", "usda-sr:169914"),
  row("Tangerine / mandarin", 53, 0.81, 13.34, 0.31, 1.8, 88, "tangerine", "vegan", "usda-sr:169105"),
  row("Persimmon", 70, 0.58, 18.59, 0.19, 3.6, 168, "persimmon", "vegan", "usda-sr:169941"),
  row("Guava", 68, 2.55, 14.32, 0.95, 5.4, 55, "guava", "vegan", "usda-sr:173044"),
  row("Lychee", 66, 0.83, 16.53, 0.44, 1.3, 9.6, "lychee", "vegan", "usda-sr:169086"),
  row("Passion fruit", 97, 2.2, 23.38, 0.7, 10.4, 18, "passion fruit", "vegan", "usda-sr:169108"),
  row("Honeydew melon", 36, 0.54, 9.09, 0.14, 0.8, 100, "g", "vegan", "usda-sr:169911"),
  row("Prunes", 240, 2.18, 63.88, 0.38, 7.1, 9.5, "prune", "vegan", "usda-sr:168162"),
  row("Cranberries (dried, sweetened)", 308, 0.17, 82.8, 1.09, 5.3, 40, "g", "vegan", "usda-sr:171723"),
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
  row("Brazil nuts", 659, 14.32, 11.74, 67.1, 7.5, 5, "nut", "vegan", "usda-sr:170569"),
  row("Macadamia nuts", 718, 7.91, 13.82, 75.77, 8.6, 28, "oz", "vegan", "usda-sr:170178"),
  row("Pine nuts", 673, 13.69, 13.08, 68.37, 3.7, 28, "oz", "vegan", "usda-sr:170591"),
  row("Chestnuts (roasted)", 245, 3.17, 52.96, 2.2, 5.1, 8.4, "chestnut", "vegan", "usda-sr:170190"),
  row("Sesame seeds", 573, 17.73, 23.45, 49.67, 11.8, 9, "tbsp", "vegan", "usda-sr:170150"),
  row("Hemp seeds", 553, 31.56, 8.67, 48.75, 4, 10, "tbsp", "vegan", "usda-sr:170148"),
  row("Tahini (sesame paste)", 595, 17, 21.19, 53.76, 9.3, 15, "tbsp", "vegan", "usda-sr:170189"),
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
  row("Avocado oil", 884, 0, 0, 100, 0, 14, "tbsp", "vegan", "usda-sr:173573"),
  row("Canola oil", 884, 0, 0, 100, 0, 14, "tbsp", "vegan", "usda-sr:172336"),
  row("Sesame oil", 884, 0, 0, 100, 0, 13.6, "tablespoon", "vegan", "usda-sr:171016"),
  row("Balsamic vinegar", 88, 0.49, 17.03, 0, null, 16, "tbsp", "vegan", "usda-sr:172241"),
  row("Apple cider vinegar", 21, 0, 0.93, 0, 0, 14.9, "tbsp", "vegan", "usda-sr:173469"),
  row("Coconut milk (canned)", 197, 2.02, 2.81, 21.33, null, 100, "g", "vegan", "usda-sr:170173"),
  // ── Drinks
  row("Coffee (black)", 1, 0.12, 0, 0.02, 0, 240, "cup", "vegan", "usda-sr:171890"),
  row("Tea (unsweetened)", 1, 0, 0.3, 0, 0, 240, "cup", "vegan", "usda-sr:173227"),
  row("Orange juice", 45, 0.7, 10.4, 0.2, 0.2, 240, "cup", "vegan", "usda-sr:169098"),
  row("Apple juice", 46, 0.1, 11.3, 0.13, 0.2, 240, "cup", "vegan", "usda-sr:173933"),
  row("Coke / cola", 42, 0, 10.36, 0.25, 0, 370, "can", "vegan", "usda-sr:174852"),
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
  row("Pork dumplings (fried)", 192, 8.76, 14.05, 11.13, 1.5, 100, "g", "non_vegetarian", "usda-fndds:2708705"),
  row("Pho (beef)", 77, 5.81, 5.6, 3.33, 0.4, 400, "bowl", "non_vegetarian", "usda-fndds:2707124"),
  row("Ramen bowl", 127, 7.13, 13.95, 4.57, 0.9, 490, "bowl", "non_vegetarian", "usda-fndds:2709153"),
  // ── American dishes
  row("Clam chowder (New England)", 93, 3.12, 9.25, 4.8, 1, 255, "cup", "non_vegetarian", "usda-fndds:2707139"),
  row("Cornbread", 287, 6.55, 42.87, 9.8, 1.5, 65, "piece", "vegetarian_eggs", "usda-fndds:2707811"),
  row("American biscuit (baked)", 350, 7.03, 44.89, 15.97, 1.4, 45, "biscuit", "vegetarian", "usda-fndds:2707804"),
  row("Biscuits and gravy", 224, 6.2, 16.98, 14.68, 0.8, 220, "portion", "non_vegetarian", "usda-fndds:2708744"),
  row("Gumbo (with rice)", 89, 8.16, 6.55, 3.43, 0.9, 244, "cup", "non_vegetarian", "usda-fndds:2706726"),
  row("Jambalaya", 161, 13.76, 8.65, 7.97, 0.7, 244, "cup", "non_vegetarian", "usda-fndds:2706727"),
  row("Meatloaf", 199, 17.48, 7.2, 10.72, 0.4, 108, "slice", "non_vegetarian", "usda-fndds:2706499"),
  row("Pot roast (beef)", 251, 28.39, 0, 15.35, 0, 90, "slice", "non_vegetarian", "usda-fndds:2705848"),
  row("Chicken pot pie", 255, 9.24, 23.95, 13.54, 2, 250, "pie", "non_vegetarian", "usda-fndds:2706703"),
  row("Corn dog", 250, 8.57, 26.96, 12.02, 1, 88, "corn dog", "non_vegetarian", "usda-fndds:2707044"),
  row("Sloppy joe", 185, 11.32, 19.95, 6.42, 1.1, 185, "sandwich", "non_vegetarian", "usda-fndds:2706883"),
  row("Reuben sandwich", 282, 10.01, 16.42, 19.43, 2.2, 215, "sandwich", "non_vegetarian", "usda-fndds:2706952"),
  row("Club sandwich", 222, 15.08, 23.09, 7.48, 1, 130, "sandwich", "non_vegetarian", "usda-fndds:2706993"),
  row("BLT sandwich", 231, 10.89, 29.71, 7.54, 1.7, 105, "sandwich", "non_vegetarian", "usda-fndds:2706979"),
  row("Grits (cooked in water)", 58, 1.2, 12.41, 0.28, 0.7, 240, "cup", "vegan", "usda-fndds:2708365"),
  row("Cobb salad (no dressing)", 93, 11.32, 2.65, 4.33, 1.2, 105, "cup", "non_vegetarian", "usda-fndds:2709832"),
  row("Enchilada (chicken)", 178, 10.03, 14.64, 9.02, 2.3, 150, "enchilada", "non_vegetarian", "usda-fndds:2708568"),
  row("Enchilada (cheese)", 165, 6.37, 17.34, 8.2, 3.1, 150, "enchilada", "non_vegetarian", "usda-fndds:2708569"),
  row("Tamale (pork)", 174, 7.38, 15.8, 9.04, 2.4, 140, "tamale", "non_vegetarian", "usda-fndds:2708572"),
  row("Fajita (chicken)", 206, 11.33, 17.99, 9.8, 1.5, 95, "fajita", "non_vegetarian", "usda-fndds:2708604"),
  row("Empanada (beef)", 333, 12.09, 27.45, 19.2, 1.6, 130, "empanada", "non_vegetarian", "usda-fndds:2708711"),
  row("Eggs Benedict", 288, 13.81, 8.48, 22.1, 0.6, 155, "portion", "non_vegetarian", "usda-fndds:2707180"),
  row("Egg salad", 257, 10.26, 1.01, 23.14, 0, 222, "cup", "vegetarian_eggs", "usda-fndds:2707182"),
  row("Chicken salad", 200, 11.64, 7.41, 13.52, 0, 208, "cup", "non_vegetarian", "usda-fndds:2706221"),
  row("Macaroni salad", 221, 4.46, 24.65, 11.52, 1.4, 204, "cup", "vegetarian_eggs", "usda-fndds:2708932"),
  row("Chicken and dumplings", 144, 15.69, 8.04, 5.55, 0.3, 244, "cup", "non_vegetarian", "usda-fndds:2706543"),
  row("Chicken parmesan", 204, 16.17, 10.92, 10.64, 0.9, 301, "serving", "non_vegetarian", "usda-sr:168062"),
  row("Eggplant parmesan", 155, 7.02, 8.96, 10.5, 1.9, 198, "cup", "vegetarian_eggs", "usda-fndds:2710050"),
  row("Crab cake", 155, 20.21, 0.48, 7.52, 0, 60, "cake", "non_vegetarian", "usda-sr:171967"),
  row("Hush puppies", 296, 6.16, 40.21, 13.25, 2.9, 22, "hush puppy", "vegetarian_eggs", "usda-fndds:2707819"),
  row("Pumpkin pie", 249, 4.76, 36.34, 9.78, 1.7, 150, "slice", "vegetarian_eggs", "usda-fndds:2708011"),
  row("Pecan pie", 449, 6.02, 49.46, 25.25, 1.9, 150, "slice", "vegetarian_eggs", "usda-fndds:2708015"),
  row("Key lime pie", 322, 5.78, 42.16, 14.92, 0.3, 150, "slice", "vegetarian_eggs", "usda-fndds:2708001"),
  // ── European dishes
  row("Paella (seafood)", 143, 8.03, 16.44, 4.76, 0.7, 240, "cup", "non_vegetarian", "usda-fndds:2706711"),
  row("Gazpacho", 26, 0.81, 4.49, 0.63, 1, 245, "cup", "vegan", "usda-fndds:2710106"),
  row("Ratatouille", 67, 1.09, 5.77, 4.73, 1.9, 215, "cup", "vegan", "usda-fndds:2710028"),
  row("Quiche (cheese)", 365, 11.91, 13.74, 29.23, 0.8, 192, "slice", "vegetarian_eggs", "usda-fndds:2708733"),
  row("Quiche Lorraine", 358, 15.3, 16.8, 26, 1.3, 100, "g", "non_vegetarian", "uk-cofid:12-952"),
  row("Crepe (plain)", 224, 8.85, 22.02, 11.29, 0.6, 65, "crepe", "vegetarian_eggs", "usda-fndds:2708342"),
  row("Bouillabaisse", 67, 8.25, 1.59, 3.05, 0.3, 255, "cup", "non_vegetarian", "usda-fndds:2706717"),
  row("French onion soup", 108, 5.45, 11.84, 4.47, 1.1, 245, "cup", "non_vegetarian", "usda-fndds:2710108"),
  row("Minestrone", 40, 1.71, 7.3, 0.5, 1.5, 245, "cup", "non_vegetarian", "usda-fndds:2710114"),
  row("Pumpkin soup", 72, 1.1, 6.86, 4.7, 1.5, 245, "cup", "non_vegetarian", "usda-fndds:2709718"),
  row("Gnocchi (potato)", 135, 2.44, 17.2, 6.33, 1, 188, "cup", "vegetarian_eggs", "usda-fndds:2708722"),
  row("Ravioli (cheese, with tomato sauce)", 98, 3.98, 15.22, 2.3, 1.2, 250, "cup", "vegetarian_eggs", "usda-fndds:2708768"),
  row("Tortellini (cheese, with tomato sauce)", 149, 6.18, 23, 3.65, 1.6, 250, "cup", "vegetarian_eggs", "usda-fndds:2708787"),
  row("Risotto (plain)", 184, 3.3, 35.6, 4.7, 0.9, 100, "g", "non_vegetarian", "uk-cofid:11-999"),
  row("Polenta (cooked in water)", 58, 1.12, 12.47, 0.28, 0.6, 240, "cup", "vegan", "usda-fndds:2708374"),
  row("Bruschetta", 171, 4.29, 21.32, 7.61, 1.5, 43, "slice", "vegetarian", "usda-fndds:2707652"),
  row("Tiramisu", 353, 5.65, 29.44, 23.86, 0.6, 175, "piece", "vegetarian_eggs", "usda-fndds:2705702"),
  row("Moussaka", 128, 8.5, 4.5, 8, 1, 100, "g", "non_vegetarian", "uk-cofid:19-609"),
  row("Spanakopita (spinach pie)", 212, 8.27, 10.35, 15.15, 1, 120, "piece", "vegetarian_eggs", "usda-fndds:2708729"),
  row("Stuffed grape leaves (dolma, beef and rice)", 228, 8.15, 11.3, 17.03, 3.1, 21, "roll", "non_vegetarian", "usda-fndds:2706621"),
  row("Tzatziki", 91, 5.22, 4.1, 6, 0.2, 15, "tbsp", "vegetarian", "usda-fndds:2705448"),
  row("Taramasalata", 517, 3.2, 7.4, 52.9, 0.3, 100, "g", "non_vegetarian", "uk-cofid:16-449"),
  row("Baklava", 440, 6.58, 37.55, 29.34, 2.5, 80, "piece", "vegetarian", "usda-fndds:2708044"),
  row("Tabbouleh", 127, 1.64, 9.65, 9.66, 1.8, 160, "cup", "vegan", "usda-fndds:2709131"),
  row("Baba ganoush (eggplant dip)", 183, 4.8, 8.15, 14.98, 3.9, 15, "tbsp", "vegan", "usda-fndds:2710049"),
  row("Shish kebab (lamb)", 162, 12.02, 5.06, 10.28, 0.8, 202, "skewer", "non_vegetarian", "usda-fndds:2706780"),
  row("Spanish omelette", 112, 5.6, 5.9, 7.6, 1.3, 100, "g", "vegetarian_eggs", "uk-cofid:12-957"),
  row("Coq au vin", 188, 11, 3.3, 11, 0.2, 100, "g", "non_vegetarian", "uk-cofid:19-486"),
  row("Goulash", 79, 6.9, 6.5, 3, 0.8, 100, "g", "non_vegetarian", "uk-cofid:19-583"),
  row("Beef stroganoff", 150, 10.06, 6.21, 9.33, 0.7, 256, "cup", "non_vegetarian", "usda-fndds:2706382"),
  row("Pierogi (potato and cheese)", 195, 5.26, 29.64, 6.14, 0.9, 40, "pierogi", "vegetarian_eggs", "usda-fndds:2708720"),
  row("Borscht", 20, 0.52, 3.9, 0.37, 0.8, 245, "cup", "non_vegetarian", "usda-fndds:2710105"),
  row("Stuffed cabbage rolls (beef and rice)", 114, 8.3, 8.83, 5.06, 1.3, 103, "roll", "non_vegetarian", "usda-fndds:2706620"),
  row("Stuffed pepper (rice and meat)", 178, 7.83, 9.93, 11.66, 0.7, 149, "half pepper", "non_vegetarian", "usda-fndds:2709073"),
  row("Swedish meatballs", 170, 12.48, 6.29, 10.3, 0.2, 45, "meatball", "non_vegetarian", "usda-fndds:2706384"),
  row("Potato pancake / latke", 196, 4.47, 20.64, 10.8, 2.2, 70, "pancake", "vegetarian_eggs", "usda-fndds:2709552"),
  row("Kielbasa", 337, 12.45, 5.03, 29.68, 0, 100, "g", "non_vegetarian", "usda-sr:173877"),
  row("Cheese fondue", 276, 19.32, 1.95, 21.2, 0, 13, "tbsp", "vegetarian", "usda-fndds:2705791"),
  row("Apple strudel", 274, 3.3, 41.1, 11.2, 2.2, 71, "piece", "vegetarian_eggs", "usda-sr:175032"),
  row("Challah", 287, 9.5, 47.8, 6, 2.3, 31, "slice", "vegetarian_eggs", "usda-fndds:2707624"),
  row("Matzo ball soup", 73, 3.09, 10.68, 1.96, 0.9, 245, "cup", "non_vegetarian", "usda-fndds:2709151"),
  // ── British, Irish, Australian and New Zealand dishes
  row("Cornish pasty", 278, 7, 24, 17.8, 2.9, 100, "g", "non_vegetarian", "uk-cofid:19-466"),
  row("Steak and kidney pie", 305, 14.6, 22.2, 18.1, 1.8, 100, "g", "non_vegetarian", "uk-cofid:19-629"),
  row("Pork pie", 370, 9.9, 25.7, 26, 2.9, 100, "g", "non_vegetarian", "uk-cofid:19-467"),
  row("Sausage roll", 352, 8.4, 27, 24.1, 3.4, 100, "g", "non_vegetarian", "uk-cofid:19-468"),
  row("Scotch egg", 241, 12, 13.1, 16, 1.7, 100, "g", "non_vegetarian", "uk-cofid:19-518"),
  row("Toad in the hole", 285, 12, 20.2, 17.9, 2.4, 100, "g", "non_vegetarian", "uk-cofid:19-635"),
  row("Yorkshire pudding", 211, 6.7, 25.8, 9.8, 1.1, 100, "g", "non_vegetarian", "uk-cofid:11-1146"),
  row("Lancashire hotpot", 119, 7.3, 7.4, 6.9, 1.1, 100, "g", "non_vegetarian", "uk-cofid:19-601"),
  row("Haggis", 310, 10.7, 19.2, 21.7, 0.2, 100, "g", "non_vegetarian", "uk-cofid:19-132"),
  row("Black pudding (fried)", 297, 10.3, 16.6, 21.5, 0.2, 100, "g", "non_vegetarian", "uk-cofid:19-114"),
  row("Kippers (grilled)", 245, 21.7, 0, 17.6, 0, 100, "g", "non_vegetarian", "uk-cofid:16-397"),
  row("Kedgeree", 167, 15.9, 9.1, 7.7, 0.2, 100, "g", "non_vegetarian", "uk-cofid:16-447"),
  row("Breaded scampi (British)", 232, 11.6, 24.3, 10.5, 1.5, 100, "g", "non_vegetarian", "uk-cofid:16-409"),
  row("Bubble and squeak", 126, 1.7, 10.1, 9, 1.9, 100, "g", "non_vegetarian", "uk-cofid:15-704"),
  row("Cauliflower cheese", 102, 5.3, 6.1, 6.4, 1.3, 100, "g", "vegetarian", "uk-cofid:15-711"),
  row("Welsh rarebit", 398, 13.9, 23.1, 28.4, 1.2, 100, "g", "non_vegetarian", "uk-cofid:12-602"),
  row("Crumpet (toasted)", 207, 6.9, 45.4, 1, 3.1, 100, "g", "vegetarian", "uk-cofid:11-989"),
  row("Scone", 382, 6.67, 48.07, 18.35, 1.2, 70, "scone", "vegetarian_eggs", "usda-fndds:2707808"),
  row("Irish soda bread", 301, 6.48, 51.07, 8.96, 2.3, 74, "slice", "vegetarian_eggs", "usda-fndds:2707852"),
  row("Hot cross bun", 312, 7.3, 58.3, 5.8, 1.9, 100, "g", "vegetarian_eggs", "uk-cofid:11-1084"),
  row("Shortbread", 515, 5.3, 62.2, 29, 2.2, 100, "g", "vegetarian", "uk-cofid:11-802"),
  row("Oat flapjack (British oat bar)", 434, 5.1, 55.7, 22.8, 5.2, 100, "g", "vegetarian", "uk-cofid:11-814"),
  row("Mince pie", 377, 3.8, 60.7, 14.9, 2.6, 100, "g", "non_vegetarian", "uk-cofid:11-848"),
  row("Trifle", 169, 3.52, 23.24, 7.15, 0.4, 145, "cup", "non_vegetarian", "usda-fndds:2705701"),
  row("Pavlova (with fruit and cream)", 244, 2.7, 42.2, 8.3, 1.9, 100, "g", "vegetarian_eggs", "uk-cofid:12-552"),
  row("Roast lamb (leg)", 242, 26.2, 0, 14.42, 0, 100, "g", "non_vegetarian", "usda-sr:174373"),
  row("Yeast extract spread", 185, 23.88, 20.42, 0.9, 6.5, 6, "tsp", "vegan", "usda-sr:167717"),
  // ── Brazilian and Latin American foods
  row("Rice and beans, meatless (black beans and white rice)", 160, 6.01, 24.42, 4.32, 5, 170, "cup", "vegan", "usda-fndds:2708994"),
  row("Rice and beans with meat", 162, 7.49, 23.54, 4.24, 4.4, 170, "cup", "non_vegetarian", "usda-fndds:2708992"),
  row("Cassava / yuca (cooked)", 191, 1.42, 39.62, 3.03, 1.9, 160, "cup", "vegetarian", "usda-fndds:2709564"),
  row("Cassava fries (yuca fries)", 269, 1.24, 34.72, 13.94, 1.6, 140, "cup", "vegan", "usda-fndds:2709565"),
  row("Plantain (green, boiled)", 121, 1.09, 29.15, 0.08, 2.6, 137, "cup", "vegan", "usda-sr:168216"),
  row("Plantain (ripe, fried)", 236, 1.42, 40.77, 7.51, 3.2, 169, "cup", "vegan", "usda-sr:168200"),
  row("Plantain chips", 531, 2.28, 63.84, 29.59, 3.5, 28.35, "oz", "vegan", "usda-fndds:2709563"),
  row("Hearts of palm (canned)", 28, 2.52, 4.62, 0.62, 2.4, 33, "piece", "vegan", "usda-sr:168569"),
  row("Picanha (top sirloin cap, grilled)", 242, 26, 0.8, 15, 0, 85, "3 oz", "non_vegetarian", "usda-sr:173061"),
  row("Flan (caramel custard)", 178, 5.23, 28.24, 4.94, 0, 100, "g", "vegetarian_eggs", "usda-fndds:2705683"),
  row("Dulce de leche", 315, 6.84, 55.35, 7.35, 0, 100, "g", "vegetarian", "usda-fndds:2705699"),
  row("Churros", 419, 6.05, 48.87, 22.21, 2.6, 45, "churro", "vegetarian_eggs", "usda-fndds:2708070"),
  row("Guava paste", 292, 0.1, 72.56, 0.27, 1.1, 20, "tbsp", "vegan", "usda-fndds:2710307"),
  row("Coconut water", 18, 0.22, 4.24, 0, 0, 245, "cup", "vegan", "usda-sr:174831"),
  row("Tapioca pearls (dry)", 358, 0.19, 88.69, 0.02, 0.9, 100, "g", "vegan", "usda-sr:169717"),
  row("Ceviche", 63, 10.53, 3.58, 0.76, 0.5, 250, "cup", "non_vegetarian", "usda-fndds:2706463"),
  row("Jackfruit", 95, 1.72, 23.25, 0.64, 1.5, 165, "cup", "vegan", "usda-sr:174687"),
  row("Starfruit / carambola", 31, 1.04, 6.73, 0.33, 2.8, 91, "fruit", "vegan", "usda-sr:171715"),
  row("Durian", 147, 1.47, 27.09, 5.33, 3.8, 243, "cup", "vegan", "usda-sr:168192"),
  // ── Chinese, Japanese, Korean and South-East Asian dishes
  row("Kung pao chicken", 129, 9.76, 6.87, 6.98, 1.5, 162, "cup", "non_vegetarian", "usda-fndds:2706796"),
  row("General Tso chicken", 295, 12.9, 23.99, 16.36, 0.9, 146, "cup", "non_vegetarian", "usda-fndds:2706794"),
  row("Orange chicken", 262, 14.46, 22.46, 12.68, 0.8, 252, "cup", "non_vegetarian", "usda-fndds:2706443"),
  row("Sesame chicken", 293, 14.33, 26.88, 14.25, 0.7, 252, "cup", "non_vegetarian", "usda-fndds:2706444"),
  row("Sweet and sour chicken", 250, 10.1, 23.86, 12.65, 1, 252, "cup", "non_vegetarian", "usda-fndds:2706435"),
  row("Sweet and sour pork", 260, 8.88, 25.5, 13.6, 1, 226, "cup", "non_vegetarian", "usda-fndds:2706401"),
  row("Beef and broccoli", 160, 10.43, 5.09, 10.63, 1.3, 217, "cup", "non_vegetarian", "usda-fndds:2706738"),
  row("Chicken lo mein", 130, 9.15, 16.15, 3.15, 1, 200, "cup", "non_vegetarian", "usda-fndds:2708803"),
  row("Vegetable lo mein", 121, 4.77, 20.16, 2.35, 1.3, 200, "cup", "non_vegetarian", "usda-fndds:2708799"),
  row("Chicken chow mein (with noodles)", 131, 9.91, 11.15, 5.43, 1.5, 220, "cup", "non_vegetarian", "usda-fndds:2706687"),
  row("Vegetable chow mein (with noodles)", 117, 2.98, 15.72, 5.05, 2.1, 220, "cup", "non_vegetarian", "usda-fndds:2710069"),
  row("Egg drop soup", 27, 1.16, 4.29, 0.61, 0.4, 245, "cup", "non_vegetarian", "usda-fndds:2707282"),
  row("Hot and sour soup", 39, 2.58, 4.35, 1.21, 0.5, 245, "cup", "non_vegetarian", "usda-fndds:2707136"),
  row("Wonton soup", 33, 2.39, 2.95, 1.31, 0.3, 245, "cup", "non_vegetarian", "usda-fndds:2709160"),
  row("Potstickers / gyoza (steamed pork dumplings)", 113, 6.9, 11.07, 4.6, 1.2, 25, "dumpling", "non_vegetarian", "usda-fndds:2708708"),
  row("Egg foo yung (with shrimp)", 125, 11.69, 5.2, 6.16, 0.3, 86, "patty", "non_vegetarian", "usda-fndds:2707193"),
  row("Crispy duck / Peking duck (meat and skin)", 331, 27.9, 0.3, 24.2, 0, 100, "g", "non_vegetarian", "uk-cofid:18-490"),
  row("Moo shu pork", 153, 10.41, 4.01, 10.7, 0.9, 151, "cup", "non_vegetarian", "usda-fndds:2706764"),
  row("Pork bao bun", 273, 11.17, 39.78, 7.58, 1.2, 100, "bun", "non_vegetarian", "usda-fndds:2708724"),
  row("Plain congee (rice porridge)", 39, 0.8, 8.4, 0.08, 0.1, 255, "cup", "vegan", "usda-fndds:2708418"),
  row("Congee with vegetables", 38, 1.12, 7.88, 0.12, 0.4, 255, "cup", "vegan", "usda-fndds:2708983"),
  row("Congee with meat or seafood", 58, 4.34, 7, 1.28, 0.1, 255, "cup", "non_vegetarian", "usda-fndds:2708981"),
  row("Sticky rice (glutinous, cooked)", 97, 2.02, 21.09, 0.19, 1, 174, "cup", "vegan", "usda-sr:169711"),
  row("Miso soup", 24, 2.21, 2.3, 0.85, 0.6, 245, "cup", "non_vegetarian", "usda-fndds:2707455"),
  row("Teriyaki chicken", 163, 25.73, 1.62, 5.96, 0, 244, "cup", "non_vegetarian", "usda-fndds:2706433"),
  row("Vegetable tempura", 239, 3.81, 20.45, 15.81, 1.6, 63, "cup", "vegetarian_eggs", "usda-fndds:2710065"),
  row("Sushi roll (salmon)", 103, 6.88, 15.3, 1.28, 0.7, 30, "piece", "non_vegetarian", "usda-fndds:2708963"),
  row("Sushi roll (tuna)", 97, 7.4, 15.3, 0.26, 0.7, 30, "piece", "non_vegetarian", "usda-fndds:2708965"),
  row("Sushi roll (vegetable)", 93, 1.8, 17.65, 1.47, 1.4, 22, "piece", "vegan", "usda-fndds:2708966"),
  row("Salmon nigiri (sushi)", 107, 8.92, 13.39, 1.74, 0.6, 35, "piece", "non_vegetarian", "usda-fndds:2708969"),
  row("Salmon sashimi", 208, 20.42, 0, 13.42, 0, 85, "3 oz", "non_vegetarian", "usda-sr:175167"),
  row("Tuna sashimi", 109, 24.4, 0, 0.49, 0, 85, "3 oz", "non_vegetarian", "usda-sr:175159"),
  row("Soba noodles (cooked)", 99, 5.06, 21.44, 0.1, null, 114, "cup", "vegan", "usda-sr:168907"),
  row("Natto", 211, 19.4, 12.68, 11, 5.4, 100, "g", "vegan", "usda-sr:172443"),
  row("Tofu (fried)", 270, 18.82, 8.86, 20.18, 3.9, 13, "piece", "vegan", "usda-sr:172451"),
  row("Bibimbap", 76, 5.5, 8.11, 2.44, 1.1, 162, "cup", "non_vegetarian", "usda-fndds:2708950"),
  row("Kimchi", 15, 1.1, 2.4, 0.5, 1.6, 150, "cup", "non_vegetarian", "usda-sr:170392"),
  row("Tteokbokki (Korean rice cakes)", 131, 4.11, 19.61, 4.05, 0.8, 250, "cup", "non_vegetarian", "usda-fndds:2708957"),
  row("Adobo (chicken and pork, with rice)", 181, 17.69, 8.86, 7.94, 0.2, 244, "cup", "non_vegetarian", "usda-fndds:2708958"),
  row("Coconut rice", 267, 3.57, 26.55, 17.23, 1.9, 200, "cup", "vegan", "usda-fndds:2709032"),
  row("Shrimp summer roll (rice paper)", 112, 5.65, 17.23, 2.65, 1.9, 71, "roll", "non_vegetarian", "usda-fndds:2708704"),
  row("Chicken satay", 191, 21.7, 3, 10.3, 2, 100, "g", "non_vegetarian", "uk-cofid:19-323"),
  row("Thai green curry with chicken", 119, 8.8, 1.5, 8.7, 2.6, 100, "g", "non_vegetarian", "uk-cofid:19-465"),
  row("Peanut sauce (peanut butter and soy sauce)", 257, 6.31, 22.02, 16.02, 1.8, 16, "tbsp", "vegan", "usda-fndds:2707546"),
  row("Fish sauce", 35, 5.06, 3.64, 0.01, 0, 16, "tbsp", "non_vegetarian", "usda-fndds:2706457"),
  row("Hoisin sauce", 220, 3.31, 44.08, 3.39, 2.8, 16, "tbsp", "vegan", "usda-fndds:2707441"),
  row("Oyster sauce", 51, 1.35, 10.92, 0.25, 0.3, 16, "tbsp", "non_vegetarian", "usda-fndds:2707150"),
  row("Teriyaki sauce", 89, 5.93, 15.56, 0.02, 0.1, 16, "tbsp", "vegan", "usda-fndds:2707445"),
  row("Sriracha", 93, 1.93, 19.16, 0.93, 2.2, 6.5, "tsp", "vegan", "usda-sr:171186"),
  row("Glass noodles (mung bean, cooked)", 84, 0.04, 20.66, 0.01, 0.1, 190, "cup", "vegan", "usda-fndds:2708355"),
  row("Prawn crackers", 570, 0.3, 58.2, 39, 0.9, 100, "g", "non_vegetarian", "uk-cofid:11-1023"),
  row("Beef in black bean sauce", 103, 10.5, 2.7, 5.6, null, 100, "g", "non_vegetarian", "uk-cofid:19-460"),
  row("Sesame prawn toast", 382, 12.9, 16.7, 29.8, 3.6, 100, "g", "non_vegetarian", "uk-cofid:16-367"),
  // ── More Indian and South Asian dishes
  row("Pakora (vegetable fritter)", 125, 4.92, 16.24, 4.77, 3.2, 12, "pakora", "vegan", "usda-fndds:2710066"),
  row("Sambar (lentil and vegetable stew)", 86, 4.33, 11.77, 2.71, 4, 248, "cup", "vegan", "usda-fndds:2707430"),
  row("Papad / poppadom (grilled)", 371, 25.56, 59.87, 3.25, 18.6, 9, "papad", "vegan", "usda-fndds:2707429"),
  row("Puri (fried bread)", 409, 6.84, 39.23, 24.94, 3.5, 36, "puri", "vegan", "usda-fndds:2707714"),
  row("Beef curry", 113, 7.57, 6.53, 6.57, 1.4, 240, "cup", "non_vegetarian", "usda-fndds:2706388"),
  row("Fish curry (fish and shrimp)", 93, 4.94, 6.65, 5.42, 1.4, 240, "cup", "non_vegetarian", "usda-fndds:2706460"),
  row("Chicken korma", 127, 14.6, 4.6, 5.1, 0.7, 100, "g", "non_vegetarian", "uk-cofid:19-565"),
  row("Lamb rogan josh", 149, 14.4, 3.9, 9.1, 1.8, 100, "g", "non_vegetarian", "uk-cofid:19-595"),
  row("Chicken vindaloo", 192, 18.5, 2.6, 12.5, 0.7, 100, "g", "non_vegetarian", "uk-cofid:19-567"),
  row("Tandoori chicken", 214, 27.4, 2, 10.8, 0.8, 100, "g", "non_vegetarian", "uk-cofid:19-540"),
  row("Prawn curry", 118, 8.2, 2.3, 8.5, 2.5, 100, "g", "non_vegetarian", "uk-cofid:16-333"),
  row("Biryani (spiced rice with lamb)", 195, 7.1, 20.9, 9.2, 0.6, 100, "g", "non_vegetarian", "uk-cofid:19-591"),
  row("Samosa (meat)", 272, 11.4, 18.9, 17.3, 2.4, 100, "g", "non_vegetarian", "uk-cofid:19-326"),
  row("Khichdi (rice and mung beans, with ghee)", 169, 4.8, 27.3, 5.2, 1.4, 100, "g", "vegetarian", "uk-cofid:15-528"),
  row("Raita (yogurt with spices)", 57, 4.4, 5.8, 2.4, 0.4, 100, "g", "vegetarian", "uk-cofid:17-832"),
  row("Lassi (sweet yogurt drink)", 65, 2.6, 12.3, 0.9, 0, 100, "g", "vegetarian", "uk-cofid:12-373"),
  row("Kulfi (Indian ice cream)", 457, 5.7, 13.8, 42.4, 0.5, 100, "g", "vegetarian", "uk-cofid:12-606"),
];

/** Names the words of the list's own names do not reach, each pointing at a
 *  canonical: other spellings and local names, the English name of an Indian
 *  dish (its name holds it in brackets, but a name is found by the words outside
 *  them), a cooking word where the table's cooking is the same one, and a food's
 *  own name ("cheddar"). Each names one food; the words several foods answer to
 *  are `COMMON_FOOD_PICKS`, below. A Map, not an object literal, so a key such
 *  as "constructor" is never found on the prototype. */
const FOOD_NAMES: ReadonlyMap<string, string> = new Map(Object.entries({
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
  doughnut: "donut_glazed",
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
  butter_beans: "lima_beans_cooked", pak_choi: "bok_choy_cooked", pak_choy: "bok_choy_cooked",
  spring_onions: "green_onions_scallions", beansprouts: "bean_sprouts", mangetout: "snow_peas_sugar_snap_peas",
  litchi: "lychee", chard: "swiss_chard_cooked", collards: "collard_greens_cooked",
  portobello: "portobello_mushroom_grilled", portabella: "portobello_mushroom_grilled",
  shiitake: "shiitake_mushrooms_cooked", jalapeno: "jalapeno_pepper", mahimahi: "mahi_mahi_cooked",
  // the food its cited entry is, by another name: sweet corn ("Corn, sweet, yellow,
  // cooked"), a potato baked in its jacket ("Potatoes, baked, flesh and skin"), two
  // long-grain white rices ("Rice, white, long-grain"), and the latte's Italian name
  sweet_corn: "corn_cooked", jacket_potato: "potato_baked", basmati_rice: "rice_white_cooked",
  jasmine_rice: "rice_white_cooked", caffe_latte: "latte", iced_latte: "latte",
  // a cooking word where the table's cooking is the same one
  grilled_chicken: "chicken_breast_grilled", grilled_salmon: "salmon_cooked", baked_salmon: "salmon_cooked",
  roast_chicken: "rotisserie_chicken", roasted_chicken: "rotisserie_chicken", roasted_potatoes: "roast_potatoes",
  // one food's own name
  ground_beef: "ground_beef_85_cooked", cheddar: "cheddar_cheese", mozzarella: "mozzarella_cheese",
  parmesan: "parmesan_cheese", feta: "feta_cheese", chilli_con_carne: "chili_con_carne", bolognese: "spaghetti_bolognese",
  // other names of the dishes of the US, Europe, Britain, Australia and New Zealand
  meat_loaf: "meatloaf", corn_bread: "cornbread", corndog: "corn_dog", pot_pie: "chicken_pot_pie",
  blt: "blt_sandwich", reuben: "reuben_sandwich", pasta_salad: "macaroni_salad",
  chicken_parm: "chicken_parmesan", chicken_parmigiana: "chicken_parmesan",
  eggplant_parm: "eggplant_parmesan", eggplant_parmigiana: "eggplant_parmesan", aubergine_parmigiana: "eggplant_parmesan",
  onion_soup: "french_onion_soup", minestrone_soup: "minestrone", cornmeal_mush: "polenta_cooked_in_water",
  dolma: "stuffed_grape_leaves_dolma_beef_and_rice", dolmades: "stuffed_grape_leaves_dolma_beef_and_rice",
  eggplant_dip: "baba_ganoush_eggplant_dip", baba_ghanoush: "baba_ganoush_eggplant_dip", baba_ganouj: "baba_ganoush_eggplant_dip",
  shish_kabob: "shish_kebab_lamb", lamb_kebab: "shish_kebab_lamb", lamb_kabob: "shish_kebab_lamb",
  tabouli: "tabbouleh", tabouleh: "tabbouleh", tabbouli: "tabbouleh", taramosalata: "taramasalata",
  spanish_omelet: "spanish_omelette", spanish_tortilla: "spanish_omelette", tortilla_espanola: "spanish_omelette",
  stroganoff: "beef_stroganoff", pierogies: "pierogi_potato_and_cheese", perogies: "pierogi_potato_and_cheese", borsch: "borscht", borsht: "borscht",
  cabbage_rolls: "stuffed_cabbage_rolls_beef_and_rice", polish_sausage: "kielbasa", fondue: "cheese_fondue", strudel: "apple_strudel",
  lancashire_hot_pot: "lancashire_hotpot", blood_sausage: "black_pudding_fried", rarebit: "welsh_rarebit",
  welsh_rabbit: "welsh_rarebit", soda_bread: "irish_soda_bread", lamb_roast: "roast_lamb_leg", leg_of_lamb: "roast_lamb_leg",
  marmite: "yeast_extract_spread", vegemite: "yeast_extract_spread", yeast_extract: "yeast_extract_spread",
  // other names of the dishes of Brazil, Latin America and Asia
  yuca: "cassava_yuca_cooked", manioc: "cassava_yuca_cooked", mandioca: "cassava_yuca_cooked", aipim: "cassava_yuca_cooked",
  yuca_fries: "cassava_fries_yuca_fries",
  black_beans_and_rice: "rice_and_beans_meatless_black_beans_and_white_rice", fried_plantain: "plantain_ripe_fried", platanos_maduros: "plantain_ripe_fried", maduros: "plantain_ripe_fried",
  palmito: "hearts_of_palm_canned", palm_hearts: "hearts_of_palm_canned", top_sirloin_cap: "picanha_top_sirloin_cap_grilled", coulotte: "picanha_top_sirloin_cap_grilled",
  pudim: "flan_caramel_custard", creme_caramel: "flan_caramel_custard", doce_de_leite: "dulce_de_leche", goiabada: "guava_paste",
  agua_de_coco: "coconut_water", churro: "churros", carambola: "starfruit_carambola", star_fruit: "starfruit_carambola", jaca: "jackfruit",
  kung_po_chicken: "kung_pao_chicken", general_tso_s_chicken: "general_tso_chicken", general_tsos_chicken: "general_tso_chicken",
  beef_with_broccoli: "beef_and_broccoli", broccoli_beef: "beef_and_broccoli",
  egg_flower_soup: "egg_drop_soup", potstickers: "potstickers_gyoza_steamed_pork_dumplings", pot_stickers: "potstickers_gyoza_steamed_pork_dumplings", gyoza: "potstickers_gyoza_steamed_pork_dumplings",
  steamed_pork_dumplings: "potstickers_gyoza_steamed_pork_dumplings", egg_foo_young: "egg_foo_yung_with_shrimp", egg_fu_yung: "egg_foo_yung_with_shrimp", mu_shu_pork: "moo_shu_pork",
  pork_bun: "pork_bao_bun", pork_bao: "pork_bao_bun", char_siu_bao: "pork_bao_bun",
  glutinous_rice: "sticky_rice_glutinous_cooked", congee_with_meat: "congee_with_meat_or_seafood", chicken_congee: "congee_with_meat_or_seafood",
  pork_congee: "congee_with_meat_or_seafood", fish_congee: "congee_with_meat_or_seafood", vegetable_congee: "congee_with_vegetables",
  chicken_teriyaki: "teriyaki_chicken", salmon_roll: "sushi_roll_salmon", tuna_roll: "sushi_roll_tuna",
  cucumber_roll: "sushi_roll_vegetable", avocado_roll: "sushi_roll_vegetable",
  soba: "soba_noodles_cooked", buckwheat_noodles: "soba_noodles_cooked", fried_tofu: "tofu_fried", kimchee: "kimchi", topokki: "tteokbokki_korean_rice_cakes",
  tteokbokki: "tteokbokki_korean_rice_cakes", dukboki: "tteokbokki_korean_rice_cakes",
  satay_chicken: "chicken_satay", nam_pla: "fish_sauce",
  cellophane_noodles: "glass_noodles_mung_bean_cooked", bean_thread_noodles: "glass_noodles_mung_bean_cooked", prawn_toast: "sesame_prawn_toast",
  shrimp_chips: "prawn_crackers", shrimp_crackers: "prawn_crackers", krupuk: "prawn_crackers",
  pakoda: "pakora_vegetable_fritter", pakoras: "pakora_vegetable_fritter", sambhar: "sambar_lentil_and_vegetable_stew", papadum: "papad_poppadom_grilled",
  poppadoms: "papad_poppadom_grilled", papadam: "papad_poppadom_grilled", poori: "puri_fried_bread", clarified_butter: "ghee",
  chicken_tandoori: "tandoori_chicken", shrimp_curry: "prawn_curry",
  lamb_biryani: "biryani_spiced_rice_with_lamb", mutton_biryani: "biryani_spiced_rice_with_lamb", keema_samosa: "samosa_meat", meat_samosa: "samosa_meat", khichri: "khichdi_rice_and_mung_beans_with_ghee",
  kitchari: "khichdi_rice_and_mung_beans_with_ghee", khichadi: "khichdi_rice_and_mung_beans_with_ghee", sweet_lassi: "lassi_sweet_yogurt_drink",
  // Left out on purpose: a word the markets use for different foods. "Jelly" is
  // jam in the US and a gelatine dessert in the UK, "chips" are crisps in the US
  // and fries in the UK, and "beans" on a British plate are baked beans. A
  // "biscuit" is a soft bread in the US and a cookie in the UK, a "flapjack" a
  // pancake in the US and an oat bar in the UK, and "scampi" shrimp in garlic
  // butter in the US and breaded langoustine in the UK: each is listed under the
  // longer name that says which, and the word alone names none.
}));

/** One word for one common food: a word several foods answer to, and the one the
 *  list picks for it when nothing else is said — the most eaten in the markets
 *  (RULINGS 2026-09-12), so "bread" alone is white bread (RULINGS 2026-09-17). A
 *  pick answers the word alone, never a longer name the scanner has shortened to it
 *  (`findCuratedVersions`): "brie cheese" is no cheddar, "roast pork" no pork chop
 *  and "stewed beef" no mince. Exported for the test that holds each one to a food. */
export const COMMON_FOOD_PICKS: ReadonlyMap<string, string> = new Map(Object.entries({
  chicken: "chicken_breast_cooked", beef: "ground_beef_85_cooked", pork: "pork_chop_cooked",
  turkey: "turkey_breast_cooked", sausage: "pork_sausage_cooked", bread: "white_bread", cheese: "cheddar_cheese",
  nuts: "mixed_nuts", juice: "orange_juice", fries: "french_fries", burger: "hamburger_fast_food",
  cookie: "chocolate_chip_cookie", sushi: "sushi_roll", spaghetti: "pasta_cooked", chili: "chili_con_carne",
  chilli: "chili_con_carne",
}));

/** Every other name and every pick. Exported for the test that holds each one to
 *  a food on the list. */
export const FOOD_ALIASES: ReadonlyMap<string, string> = new Map([...FOOD_NAMES, ...COMMON_FOOD_PICKS]);

/** Words that only say how a food is arranged, cut or served, never what it
 *  is, so dropping them can only reveal the food's own name ("flatbread stack",
 *  "sliced banana", "glass of milk"). Words that change what a food is stay out:
 *  hot, warm, iced, fresh, plain and homemade ("hot chocolate" is not chocolate,
 *  "iced coffee" is not black coffee), and so do cooking words. Only the food is
 *  found by them: how much of it a photo shows is read from the grams the photo
 *  saw, never from these words (ROADMAP 7a-iv-b). */
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

/** The FDC id of the USDA entry a food of the list copies its numbers from, or
 *  null for a CoFID food and for any canonical not on the list. Its household
 *  measures are that entry's (ROADMAP 7a-iv-a). */
export function curatedUsdaFdcId(canonical: string): number | null {
  const citation = BY_CANONICAL.get(canonical)?.citation;
  const cited = citation === undefined ? null : /^usda-(?:sr|fndds):(\d+)$/.exec(citation);
  return cited?.[1] === undefined ? null : Number(cited[1]);
}

/** A food of the list whose cited entry names no piece, and the USDA entry of the
 *  same food whose measures it is given as well: SR Legacy weighs cooked shrimp
 *  and scallops by 3 oz alone, and the survey release has "1 large/jumbo shrimp"
 *  and "1 scallop". Only the measures are borrowed; every number stays the cited
 *  entry's. `tools/check-food-sources.ts` checks each is in the survey release. */
export const PIECE_ENTRIES: ReadonlyMap<string, number> = new Map([
  ["shrimp_cooked", 2706363],
  ["scallops_cooked", 2706358],
]);

/** The USDA entry a food of the list borrows its pieces from, or null. */
export const curatedPieceFdcId = (canonical: string): number | null => PIECE_ENTRIES.get(canonical) ?? null;

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

/** A slugged name's words in their one spelling, so "nugget" finds "nuggets" and
 *  "cookies" finds "cookie". */
const stemKey = (slugged: string): string => toTokens(slugged).map(stem).join("_");

/** Aliases keyed by `stemKey`: every one, and the names of one food alone — no
 *  pick for a word several foods answer to (`COMMON_FOOD_PICKS`). */
type AliasesByStem = ReadonlyMap<string, string>;
const byStem = (aliases: ReadonlyMap<string, string>): AliasesByStem => new Map([...aliases].map(([alias, canonical]) => [stemKey(alias), canonical]));
const ALIASES_BY_STEM = byStem(FOOD_ALIASES);
const NAMES_BY_STEM = byStem(FOOD_NAMES);

const aliasFor = (slugged: string): string | undefined => ALIASES_BY_STEM.get(stemKey(slugged));

function byAliasOrWords(slugged: string, aliases: AliasesByStem): CuratedFood | null {
  const target = aliases.get(stemKey(slugged));
  if (target !== undefined) return BY_CANONICAL.get(target) ?? null;
  return byWords(slugged);
}

function find(query: string, aliases: AliasesByStem): CuratedFood | null {
  const q = slug(query);
  if (q === "") return null;
  const exact = BY_CANONICAL.get(q);
  if (exact !== undefined) return exact;
  const stripped = denoise(q);
  return byAliasOrWords(q, aliases) ?? (stripped === null ? null : byAliasOrWords(stripped, aliases));
}

/** The one food a name means, or null: the food whose canonical it is, then an
 *  alias, then the name's own words, and then the same again with the noise
 *  words dropped ("Pizza Slice" is pizza). The canonical comes first, so a saved
 *  or searched food is found again as itself even where another food's name
 *  holds its words, or its own name no longer does ("roti_chapati" is the
 *  homemade roti, not the store-bought one with fewer words; "spring_roll" is
 *  the egg roll it was renamed to). */
export function findCurated(query: string): CuratedFood | null {
  return find(query, ALIASES_BY_STEM);
}

/** Each food's name outside its brackets, which its other versions share. */
const HEAD_KEYS: ReadonlyMap<CuratedFood, string> = new Map(FOOD_WORDS.map((f) => [f.food, f.headKey]));

/** The food a name the scanner has SHORTENED means (`scanMatch.ts`), then the other
 *  versions of that food on the list — the foods of the same name outside their
 *  brackets, "Carrots (raw)" and "Carrots (cooked)" — in the list's order; none
 *  where the name means no food. Two rules the whole name's lookup does not need.
 *  The versions: "steamed carrots" are no carrots the list names raw. And never
 *  the list's pick for a word several foods answer to (`COMMON_FOOD_PICKS`): the
 *  model named more than that word, and the word it added may be what picks
 *  another of them — "roast pork" is no pork chop, "stewed beef" no mince, "whole
 *  chicken" no chicken breast (the re-check of PR #80). */
export function findCuratedVersions(query: string): CuratedFood[] {
  const food = find(query, NAMES_BY_STEM);
  if (food === null) return [];
  const head = HEAD_KEYS.get(food);
  return [food, ...FOOD_WORDS.filter((f) => f.food !== food && f.headKey === head).map((f) => f.food)];
}

/** The noise words that only join a query's words or point at them. */
const JOINING_WORDS: ReadonlySet<string> = new Set(["of", "with", "a", "an", "the", "some"]);

/** Whether a name holds every word of a query, by the list's own rules: a word
 *  and its plural are one, and a noise word is not needed only where it measures
 *  the food, in the run of noise words before an "of" ("bottles of coca cola" is
 *  held by "Coca-Cola Classic", and so is "a small glass of coca cola"), or only
 *  joins the query's words ("chicken with rice"). Anywhere else a noise word is
 *  the food's own ("glass noodles", "grated coconut", "shredded wheat"), and a
 *  query of noise words alone is held by no name. */
export function holdsEveryWord(name: string, query: string): boolean {
  const words = toTokens(slug(query));
  const measuring = new Set<number>();
  for (const [at, word] of words.entries()) {
    if (word !== "of") continue;
    for (let before = at - 1; before >= 0 && NOISE_WORDS.has(words[before] ?? ""); before--) measuring.add(before);
  }
  const meant = words.filter((w, at) => !JOINING_WORDS.has(w) && !measuring.has(at));
  if (meant.every((w) => NOISE_WORDS.has(w))) return false;
  const held = new Set(stemmedWords(name));
  return meant.every((w) => held.has(stem(w)));
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
  // "rice & beans" is typed for "rice and beans".
  const q = query.toLowerCase().replaceAll("&", " and ").replaceAll(/\s+/g, " ").trim();
  if (q === "") return [];
  const aliasTarget = aliasTargetFor(slug(q));
  return CURATED_FOODS.map((food) => ({ food, score: searchScore(food, q, aliasTarget) }))
    .filter((v) => v.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((v) => v.food);
}
