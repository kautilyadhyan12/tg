// P2.6a — Nutrition & body contracts (Part 2B §3; Part 4 §3.6).
import { z } from "zod";
import { missingPlanInputSchema, noDeficitReasonSchema } from "./plan.js";

export const portionSourceSchema = z.enum(["user_dishware", "regional_prior", "default", "legacy"]);
/** Where an item's numbers per 100 g came from. `usda` is a food of the USDA
 *  FoodData Central table (ROADMAP 7a-iii-a) — public-domain data the app
 *  credits on screen; `openfoodfacts` is one brand's packaged product;
 *  `estimate` is the scanner's own figures for a food no table has (RULINGS
 *  2026-09-15), shown marked "estimate". */
export const nutritionSourceSchema = z.enum(["curated", "openfoodfacts", "usda", "estimate", "label"]);
export type NutritionSource = z.infer<typeof nutritionSourceSchema>;
/** Where a saved meal's item has its numbers from: its food's source, or `own` —
 *  the person typed that food's protein, carbs and fat and its calories were
 *  worked out from them (ROADMAP 7a-iv-g). No food the search or the scanner
 *  returns is ever `own`; only an item of a saved meal becomes one. */
export const mealItemSourceSchema = z.enum(["curated", "openfoodfacts", "usda", "estimate", "own", "label"]);
export type MealItemSource = z.infer<typeof mealItemSourceSchema>;
export const mealOriginSchema = z.enum(["photo", "manual"]);
/** Kd ruling 2026-07-17 (Card-5b smoke; supersedes the D1 time-bucket
 *  interim): the section is a USER-CHOSEN label stored on the meal —
 *  takenAt stays the exact real time and never encodes it. */
export const mealTypeSchema = z.enum(["breakfast", "lunch", "dinner", "snack"]);

/** The meal an hour of the day (0–23, the person's own clock) is, for a meal with none of its own:
 *  breakfast from 4 am, lunch from 11, a snack from 4 pm, dinner from 7 pm until midnight, and a
 *  late-night snack after it (Kd, 2026-10-30: dinner at 10 or 11 pm is usual in India). One rule for
 *  the phone and the browser.
 */
export function mealTypeAtHour(hour: number): z.infer<typeof mealTypeSchema> {
  if (hour < 4) return "snack";
  if (hour < 11) return "breakfast";
  if (hour < 16) return "lunch";
  if (hour < 19) return "snack";
  return "dinner";
}
export type MealType = z.infer<typeof mealTypeSchema>;

const gramRangeSchema = z.tuple([z.number().positive(), z.number().positive()]);

/** A food's energy and macros per 100 g. */
export const per100gSchema = z.object({
  kcal: z.number().nonnegative().max(900), proteinG: z.number().nonnegative().max(100),
  carbsG: z.number().nonnegative().max(100), fatG: z.number().nonnegative().max(100),
}).strict();
export type Per100g = z.infer<typeof per100gSchema>;

/** The ten figures a food carries beside its energy and macros (ROADMAP 34a;
 *  RULINGS 2026-09-16): fibre, total sugars, saturated fat and unsaturated fat
 *  (mono and poly together) in grams, sodium, potassium, calcium, iron and
 *  magnesium in milligrams, vitamin D in micrograms.
 *  They come from the food table or a product's label, never from the scanner.
 *  NULL is "not known", never a zero: a table that does not measure a figure, a
 *  label that does not print it, a scan's estimate, a person's own numbers. */
export const MORE_NUTRIENTS = ["fiberG", "sugarsG", "satFatG", "unsatFatG", "sodiumMg", "potassiumMg", "calciumMg", "ironMg", "magnesiumMg", "vitaminDUg"] as const;
export type MoreNutrient = (typeof MORE_NUTRIENTS)[number];
const figure = z.number().nonnegative().nullable();
export const moreNutrientsSchema = z.object({
  fiberG: figure, sugarsG: figure, satFatG: figure, unsatFatG: figure, sodiumMg: figure, potassiumMg: figure,
  calciumMg: figure, ironMg: figure, magnesiumMg: figure, vitaminDUg: figure,
}).strict();
export type MoreNutrients = z.infer<typeof moreNutrientsSchema>;
/** Every figure not known. */
export const MORE_NOT_KNOWN: MoreNutrients = {
  fiberG: null, sugarsG: null, satFatG: null, unsatFatG: null, sodiumMg: null, potassiumMg: null,
  calciumMg: null, ironMg: null, magnesiumMg: null, vitaminDUg: null,
};
/** The decimals each figure is kept to: whole milligrams for the four counted in
 *  hundreds, one decimal for the rest. */
const MORE_DECIMALS: Record<MoreNutrient, 0 | 1> = {
  fiberG: 1, sugarsG: 1, satFatG: 1, unsatFatG: 1, sodiumMg: 0, potassiumMg: 0, calciumMg: 0, ironMg: 1, magnesiumMg: 0, vitaminDUg: 1,
};
const roundMore = (key: MoreNutrient, v: number): number => {
  const by = 10 ** MORE_DECIMALS[key];
  return Math.round(v * by) / by;
};
/** A food's figures per 100 g as `grams` of it hold them. Not known stays not known. */
export function moreForGrams(per100g: MoreNutrients, grams: number): MoreNutrients {
  const out = { ...MORE_NOT_KNOWN };
  for (const key of MORE_NUTRIENTS) {
    const v = per100g[key];
    out[key] = v === null ? null : roundMore(key, (v * grams) / 100);
  }
  return out;
}
/** One figure summed over foods: what the foods that give it come to, and how many
 *  foods do not give it. A total with `notKnown` above zero is "about". */
export const moreTotalSchema = z.object({ amount: z.number().nonnegative(), notKnown: z.number().int().nonnegative() }).strict();
export type MoreTotal = z.infer<typeof moreTotalSchema>;
export type MoreTotals = Record<MoreNutrient, MoreTotal>;
/** A meal's or a day's ten figures from its foods (a day is all its meals' foods).
 *  A food saved before these were kept has none, and counts as not known. */
export function sumMoreNutrients(items: readonly { more?: MoreNutrients | undefined }[]): MoreTotals {
  const total = (key: MoreNutrient): MoreTotal => {
    let amount = 0;
    let notKnown = 0;
    for (const item of items) {
      const v = item.more?.[key] ?? null;
      if (v === null) notKnown += 1;
      else amount += v;
    }
    return { amount: roundMore(key, amount), notKnown };
  };
  return {
    fiberG: total("fiberG"), sugarsG: total("sugarsG"), satFatG: total("satFatG"), unsatFatG: total("unsatFatG"), sodiumMg: total("sodiumMg"),
    potassiumMg: total("potassiumMg"), calciumMg: total("calciumMg"), ironMg: total("ironMg"),
    magnesiumMg: total("magnesiumMg"), vitaminDUg: total("vitaminDUg"),
  };
}

/** The measure a meal item was logged by (ROADMAP 7a-iv-a): the measure's id and
 *  name as the food's list gave them when it was logged — or "dish" and the
 *  person's own name for a saved dish — and how many of it. The item's grams are
 *  `amount` of it, worked out by the server. An item logged by grams, or before
 *  measures existed, has none. */
export const loggedMeasureSchema = z.object({
  id: z.string().min(1).max(40), name: z.string().min(1).max(100), amount: z.number().positive(),
  /** A dish the whole meal was eaten from: this food's part of it (ROADMAP Stage 5 33b-i). */
  share: z.number().positive().max(1).optional(),
}).strict();
export type LoggedMeasure = z.infer<typeof loggedMeasureSchema>;

export const mealItemSchema = z.object({
  name: z.string(), canonical: z.string(), gramsPoint: z.number().positive(), gramsRange: gramRangeSchema,
  portionSource: portionSourceSchema, nutritionSource: mealItemSourceSchema,
  kcalPoint: z.number().int().nonnegative(), kcalLow: z.number().int().nonnegative(), kcalHigh: z.number().int().nonnegative(),
  proteinG: z.number().nonnegative(), carbsG: z.number().nonnegative(), fatG: z.number().nonnegative(),
  /** The figures an item carries because no table prices it again: an estimate
   *  row's (ROADMAP 7a-iii-b), or the person's own numbers (7a-iv-g). The meal
   *  carries them, so the item's amount can be changed after saving and its
   *  numbers follow; every other row is priced again from its table by canonical. */
  per100g: per100gSchema.optional(),
  /** The scan's estimate an `own` row held before the person typed over it, kept
   *  so going back to it needs no scan (7a-iv-g). */
  scanEstimate: per100gSchema.optional(),
  measure: loggedMeasureSchema.optional(),
  /** The ten further figures for this item's grams (ROADMAP 34a). An item saved
   *  before they were kept has none: all not known. */
  more: moreNutrientsSchema.optional(),
  /** What the photo's scanner saw, where it is not the name of the food the numbers are from: the
   *  phone shows it as the title and `name` under it (ROADMAP Stage 5 33b-ii). `name` is always the
   *  food the numbers are from. */
  seenAs: z.string().min(1).max(200).optional(),
});
export type MealItem = z.infer<typeof mealItemSchema>;

export const mealTotalsSchema = z.object({
  kcalPoint: z.number().int().nonnegative(), kcalLow: z.number().int().nonnegative(), kcalHigh: z.number().int().nonnegative(),
  proteinG: z.number().nonnegative(), carbsG: z.number().nonnegative(), fatG: z.number().nonnegative(),
});

export const analyzeMealPhotoRequestSchema = z.object({
  imageBase64: z.string().min(1), mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  retakeToken: z.string().min(32).max(256).optional(),
}).strict();
export type AnalyzeMealPhotoRequest = z.infer<typeof analyzeMealPhotoRequestSchema>;

/** How long a photo scan's sheet can still be saved, and its free retake used:
 *  the server keeps the scan's draft this long, and the web brings an unsaved
 *  sheet back when Photo Log is opened again within it (RULINGS 2026-09-16). */
export const MEAL_SCAN_TTL_SECONDS = 10 * 60;
/** How long a scan the person has not saved can still BE saved: a meal logged from a photo on a
 *  phone with no signal is kept there and sent when it is back (ROADMAP Stage 5 33b-i). A saved scan
 *  is gone at once, so only a scan left unsaved stays this long. */
export const MEAL_SCAN_SAVE_SECONDS = 24 * 60 * 60;
/** The largest meal photo a scan takes, in bytes. */
export const MEAL_PHOTO_MAX_BYTES = 10 * 1024 * 1024;

/** GAP-3 ruling: client-supplied, bounded to ≤24 h in the future (offline
 *  backfill of past meals is legitimate; future meals are not). */
const takenAtSchema = z
  .string()
  .datetime()
  .refine((v) => Date.parse(v) <= Date.now() + 24 * 60 * 60 * 1000, {
    message: "must not be more than 24h in the future",
  });

/** The most one item of a meal may weigh, in grams. */
export const MAX_ITEM_GRAMS = 10_000;

// Card 5c2 — dishware portions. An item's amount is given EITHER as grams
// directly, OR "measured with my dishware": a saved dish id + how full it was
// (fillLevel in (0,1]; the UI offers ¼/½/¾/full). The SERVER turns the dishware
// arm into grams (volume × fill × density) using the SAME math the scan-time
// portion resolver uses (rung 'user_dishware'), so the client still never does
// nutrition arithmetic (2B). Both arms are .strict(), so a hybrid item
// ({canonical, grams, dishwareId}) is rejected by the union — no ambiguity.
const gramsItemSchema = z
  .object({ canonical: z.string().min(1).max(120), grams: z.number().positive().max(MAX_ITEM_GRAMS) })
  .strict();
/** `share`: the meal was eaten from one dish, and this food is that part of it (Kd, 2026-10-30): the
 *  server weighs the dish as `fillLevel` full and gives the food its share. */
const dishwareItemSchema = z
  .object({ canonical: z.string().min(1).max(120), dishwareId: z.string().uuid(), fillLevel: z.number().positive().max(1), share: z.number().positive().max(1).optional() })
  .strict();

// ROADMAP 7a-iv-a — a food logged by one of its own measures (RULINGS 2026-09-16,
// the portion redesign): the measure's id in the food's list and how many of it.
// The SERVER looks the measure up in its own list for that food and works out the
// grams, so a client never says what a measure weighs.
/** Grams, ounces, the food's own serving, a USDA household measure by its
 *  `seq_num` in the USDA entry the food is, or cites, and one by its `seq_num` in
 *  the entry a food of our list borrows its pieces from ("piece-3"). */
export const measureIdSchema = z.string().regex(/^(?:g|oz|serving|pack|(?:usda|piece)-\d{1,4})$/);
/** One measure of a food, as the food search sends it: its id, its name, and the
 *  grams ONE of it weighs. */
export const foodMeasureSchema = z.object({
  id: measureIdSchema, name: z.string().min(1).max(60), grams: z.number().positive().max(MAX_ITEM_GRAMS),
}).strict();
export type FoodMeasure = z.infer<typeof foodMeasureSchema>;
/** Whether a measure is a count of the food — an apple, a slice, a large one, a serving — and not
 *  a weight or a volume (an ounce, a cup, a tablespoon), read off its name (ROADMAP 32b-ii-b). The
 *  server starts a food at a count, and the phone's amount box offers its counts first. */
export function isCountMeasure(name: string): boolean {
  return !VOLUME_OR_WEIGHT.test(name.trim());
}
/** Whether a measure is a weight ("3 oz", "lb"), which says nothing grams do not. */
export function isWeightMeasure(name: string): boolean {
  return WEIGHT.test(name.trim());
}
/** What can come before a unit: "2 ", "0.75 ", "1/2 ", "½ ", "half ", or a number glued to it ("250ml"). */
const AMOUNT_BEFORE = String.raw`(?:\d*\.?\d+\s*|\d+\s*\/\s*\d+\s*|[½⅓⅔¼¾⅛]\s*|half\s+|quarter\s+)?`;
/** A unit ends where no letter or hyphen follows it: "l" is a litre; "large" and "T-bone" are not. */
const UNIT_END = String.raw`(?![a-z-])`;
const WEIGHT = new RegExp(String.raw`^${AMOUNT_BEFORE}(?:oz|ounces?|lbs?|pounds?|g|grams?|kg)${UNIT_END}`, "i");
/** A volume or a weight as recipes and labels write it (32b-ii-b's review, L5: "½ cup", "2 tbs",
 *  "T", "c", "dl", "250ml", "fl. oz", "cupful" too). */
const VOLUME_OR_WEIGHT = new RegExp(
  String.raw`^${AMOUNT_BEFORE}(?:cups?|cupfuls?|c|tbsp|tbs|tablespoons?|t|tsp|teaspoons?|fl\.?\s*oz|oz|ounces?|lbs?|pounds?|g|grams?|kg|ml|cl|dl|l|liters?|litres?|quarts?|pints?|gallons?|glass(?:es)?)${UNIT_END}`,
  "i",
);
/** The measure and amount a food starts at where the person has not picked one. */
export const measureStartSchema = z.object({ measure: measureIdSchema, amount: z.number().positive() }).strict();
const measureItemSchema = z
  .object({ canonical: z.string().min(1).max(120), measure: measureIdSchema, amount: z.number().positive().max(MAX_ITEM_GRAMS) })
  .strict();
export const chosenItemSchema = z.union([gramsItemSchema, dishwareItemSchema, measureItemSchema]);
export type ChosenItem = z.infer<typeof chosenItemSchema>;
/** The most foods one meal holds. */
export const MEAL_MOST_FOODS = 30;
const chosenItemsSchema = z.array(chosenItemSchema).min(1).max(MEAL_MOST_FOODS);

// ROADMAP 7a-iv-g — changing a food already logged (RULINGS 2026-09-17).
/** The person's own protein, carbs and fat for one food, in grams, as eaten at the
 *  amount sent beside them. The server works out its calories from them — 4, 4 and
 *  9 kcal a gram — so the four always agree, and refuses them where together they
 *  weigh more than the food. */
export const ownNumbersSchema = z.object({
  proteinG: z.number().nonnegative().max(MAX_ITEM_GRAMS),
  carbsG: z.number().nonnegative().max(MAX_ITEM_GRAMS),
  fatG: z.number().nonnegative().max(MAX_ITEM_GRAMS),
}).strict();
export type OwnNumbers = z.infer<typeof ownNumbersSchema>;

/** A food no list has, added by the person (ROADMAP Stage 5 33b-i; Kd, 2026-10-30): its name, the
 *  grams eaten, and its protein, carbs and fat for those grams, which price it as `ownNumbersSchema`
 *  says. The server gives it a name of its own no list can answer to. */
export const ownFoodItemSchema = z.object({
  name: z.string().trim().min(1).max(80),
  grams: z.number().positive().max(MAX_ITEM_GRAMS),
  own: ownNumbersSchema,
}).strict();
export type OwnFoodItem = z.infer<typeof ownFoodItemSchema>;
/** One food of a new meal: a food of the server's lists, or the person's own. */
export const mealChoiceSchema = z.union([chosenItemSchema, ownFoodItemSchema]);
export type MealChoice = z.infer<typeof mealChoiceSchema>;
export const isOwnFood = (choice: MealChoice): choice is OwnFoodItem => "own" in choice;
const mealChoicesSchema = z.array(mealChoiceSchema).min(1).max(MEAL_MOST_FOODS);

/** The meal's id, made by the phone (ROADMAP 32a): the same id sent twice is one
 *  meal, and the second reply is the meal as it is now. Kept and answered in small
 *  letters. Without it every send is a new meal, as the web's is. */
const ownMealIdSchema = z.string().uuid().toLowerCase().optional();

export const confirmMealRequestSchema = z.object({
  id: ownMealIdSchema,
  scanToken: z.string().min(32).max(256), takenAt: takenAtSchema,
  mealType: mealTypeSchema.optional(),
  items: mealChoicesSchema,
}).strict();
export type ConfirmMealRequest = z.infer<typeof confirmMealRequestSchema>;

/** GAP-2 ruling: manual logging (Stage 4 "missing item → add" / no-photo
 *  entry). Items resolve through food search; origin = 'manual'. */
export const manualMealRequestSchema = z.object({
  id: ownMealIdSchema,
  mealName: z.string().trim().min(1).max(200), takenAt: takenAtSchema,
  mealType: mealTypeSchema.optional(),
  items: mealChoicesSchema,
}).strict();
export type ManualMealRequest = z.infer<typeof manualMealRequestSchema>;

export const createMealRequestSchema = z.union([confirmMealRequestSchema, manualMealRequestSchema]);
export type CreateMealRequest = z.infer<typeof createMealRequestSchema>;

/** Kd-approved 2026-07-16 (Card-5a smoke): live nutrition preview — the
 *  SERVER computes "what would these grams be?" without persisting, so the
 *  client can show live numbers while never doing nutrition arithmetic (2B).
 *  scanToken (photo flow) resolves foods from the SAME draft snapshot the
 *  confirm will use — preview must equal saved values (T3 finding); without
 *  it (manual flow) foods resolve via search like createManualMeal. */
export const previewMealRequestSchema = z.object({
  items: mealChoicesSchema,
  scanToken: z.string().min(32).max(256).optional(),
}).strict();
export type PreviewMealRequest = z.infer<typeof previewMealRequestSchema>;
export const mealPreviewSchema = z.object({ items: z.array(mealItemSchema), totals: mealTotalsSchema });
export type MealPreview = z.infer<typeof mealPreviewSchema>;

// ROADMAP 7a-iv-g — changing a food already logged (RULINGS 2026-09-17).
/** An item's place in a saved meal, as the meal was read (a meal holds at most 30). */
const savedPlaceSchema = z.number().int().min(0).max(29);
/** What an edit may say beside a food's amount. `from` is which of the saved meal's
 *  items it is; without it, the item in its own place where that is the same food,
 *  else the first of that food no other edit is, else a food new to the meal.
 *  `own` sets the person's own numbers; null takes them away, back to the food's
 *  table (or the scan's estimate); left out, an item keeps what it had, its own
 *  numbers grown or shrunk with its amount. */
const editFields = { from: savedPlaceSchema.optional(), own: ownNumbersSchema.nullable().optional() };
/** One of the saved meal's items, kept exactly as it was saved. */
const keptItemSchema = z.object({ from: savedPlaceSchema }).strict();
export const mealEditItemSchema = z.union([
  gramsItemSchema.extend(editFields), dishwareItemSchema.extend(editFields), measureItemSchema.extend(editFields), keptItemSchema,
]);
export type MealEditItem = z.infer<typeof mealEditItemSchema>;
/** A saved meal's whole list of items after an edit, in order: an item left out is
 *  removed from the meal, and no saved item may be named twice. */
const mealEditItemsSchema = z.array(mealEditItemSchema).min(1).max(30).refine((items) => {
  const places = items.flatMap((item) => (item.from === undefined ? [] : [item.from]));
  return new Set(places).size === places.length;
}, { message: "a saved item is named once" });

/** Which state of a meal's items an edit was made from: the `itemsVersion` the
 *  meal carried when the screen read it. An edit of the items names places in
 *  that list, so the server refuses one made from any other state (409
 *  `meal_changed`) rather than dropping a food added since, or writing over a
 *  change saved at the same moment. */
const itemsVersionSchema = z.string().min(1).max(100);

export const patchMealRequestSchema = z.object({
  mealName: z.string().trim().min(1).max(200).optional(), takenAt: takenAtSchema.optional(),
  mealType: mealTypeSchema.nullable().optional(), // null clears the label
  items: mealEditItemsSchema.optional(),
  itemsVersion: itemsVersionSchema.optional(),
  /** The phone's own id for this change (ROADMAP 32b-ii-a): the same change sent twice is made
   *  once, and the second answer is the meal as it is now. Kept in small letters. */
  changeId: z.string().uuid().toLowerCase().optional(),
}).strict()
  .refine((v) => Object.keys(v).some((k) => k !== "changeId"), { message: "at least one field required" })
  .refine((v) => (v.items === undefined) === (v.itemsVersion === undefined), {
    message: "items are sent with the itemsVersion they were read at, and only with items",
    path: ["itemsVersion"],
  });
export type PatchMealRequest = z.infer<typeof patchMealRequestSchema>;
/** What a saved meal's items would come to after an edit, nothing saved: the same
 *  items the PATCH takes, priced as the PATCH would price them. */
export const mealEditPreviewRequestSchema = z.object({ items: mealEditItemsSchema, itemsVersion: itemsVersionSchema }).strict();
export type MealEditPreviewRequest = z.infer<typeof mealEditPreviewRequestSchema>;
/** Each of a saved meal's items' measures, `measures[i]` for `items[i]`: what its
 *  food can be logged by now, so a logged food opens in the measure picker. */
export const mealMeasuresResponseSchema = z.object({ measures: z.array(z.array(foodMeasureSchema).min(1)) }).strict();
export type MealMeasuresResponse = z.infer<typeof mealMeasuresResponseSchema>;

export const mealSchema = z.object({
  id: z.string().uuid(), takenAt: z.string(), mealType: mealTypeSchema.nullable(),
  mealName: z.string().nullable(), items: z.array(mealItemSchema),
  totals: mealTotalsSchema, confirmed: z.boolean(), origin: mealOriginSchema,
  portionSource: z.enum(["user_dishware", "regional_prior", "default", "legacy"]),
  nutritionSources: z.array(z.string()), calcVersion: z.number().int(),
  /** Which state of the items this is (a fingerprint of them): an edit of the
   *  items sends it back (ROADMAP 7a-iv-g). */
  itemsVersion: z.string().min(1),
});
export type Meal = z.infer<typeof mealSchema>;

/** GET /v1/nutrition/meals: a page of the person's meals, newest first. */
export const mealPageSchema = z.object({ items: z.array(mealSchema), nextCursor: z.string().nullable() });
export type MealPage = z.infer<typeof mealPageSchema>;
/** POST, GET and PATCH of one meal answer with it. */
export const mealResponseSchema = z.object({ meal: mealSchema });

export const dishwareInputSchema = z.object({
  label: z.string().trim().min(1).max(100), containerClass: z.string().trim().min(1).max(80),
  volumeMl: z.number().int().positive().max(10_000), foodHint: z.string().trim().min(1).max(120).nullable().optional(),
}).strict();
export const patchDishwareSchema = dishwareInputSchema.partial().refine((v) => Object.keys(v).length > 0, { message: "at least one field required" });
export type DishwareInput = z.infer<typeof dishwareInputSchema>;
/** The dishes everybody has, ready to pick without saving one (Kd, 32b-ii-b: "keep the things
 *  already built, just give an option to create one on own"): the sizes the browser's Save a dish
 *  offers. Fixed ids nobody's own dish can take. A person may change their name and size for
 *  themselves (Kd, 2026-10-30), and put them back; nobody removes them. */
export const STANDARD_DISHES = [
  { id: "00000000-0000-4000-8000-00000000d151", label: "Cup", containerClass: "cup", volumeMl: 240 },
  { id: "00000000-0000-4000-8000-00000000d152", label: "Mug", containerClass: "mug", volumeMl: 325 },
  { id: "00000000-0000-4000-8000-00000000d153", label: "Bowl", containerClass: "cereal_bowl", volumeMl: 375 },
] as const;
export const standardDish = (id: string) => STANDARD_DISHES.find((d) => d.id === id.toLowerCase()) ?? null;

/** POST /v1/nutrition/dishware. With the phone's own `id` (ROADMAP 32b-ii-b) the same dish sent
 *  twice is saved once, and the second answer is the dish as it is now. Kept in small letters. */
export const createDishwareRequestSchema = dishwareInputSchema
  .extend({ id: z.string().uuid().toLowerCase().refine((id) => standardDish(id) === null, { message: "a dish everybody has" }).optional() })
  .strict();
export type CreateDishwareRequest = z.infer<typeof createDishwareRequestSchema>;
/** The person's saved dishes, newest first (GET /v1/nutrition/dishware). */
export const dishwareSchema = z.object({
  id: z.string().uuid(), label: z.string(), containerClass: z.string(), volumeMl: z.number().int().positive(),
  foodHint: z.string().nullable(), createdAt: z.string(),
}).strict();
export type Dishware = z.infer<typeof dishwareSchema>;
export const dishwarePageSchema = z.object({ items: z.array(dishwareSchema), nextCursor: z.string().nullable() }).strict();
export const dishwareResponseSchema = z.object({ dishware: dishwareSchema }).strict();
export type PatchDishware = z.infer<typeof patchDishwareSchema>;

export const bodyMeasurementInputSchema = z.object({
  // Same ≤24h-future bound as takenAt (T3 P2.6a: a measurement dated 2099
  // would stay the person's weight, as the newest weigh-in, forever).
  measuredAt: z
    .string()
    .datetime()
    .refine((v) => Date.parse(v) <= Date.now() + 24 * 60 * 60 * 1000, {
      message: "must not be more than 24h in the future",
    }),
  weightKg: z.number().positive().lt(1000).multipleOf(0.01).nullable().optional(),
  metrics: z.record(z.number().finite().nonnegative()).default({}), source: z.literal("manual").default("manual"),
}).strict();
// `source` is not patchable: a row the person typed ("self_reported") must
// not be relabelled a weigh-in, and nothing else is ever sent for it.
export const patchBodyMeasurementSchema = bodyMeasurementInputSchema.omit({ source: true }).partial().refine((v) => Object.keys(v).length > 0, { message: "at least one field required" });
export type BodyMeasurementInput = z.infer<typeof bodyMeasurementInputSchema>;
export type PatchBodyMeasurement = z.infer<typeof patchBodyMeasurementSchema>;

// One row of the body history as the API sends it. `createdAt` is when the
// row was written: a typed weight ("self_reported") is DATED after everything
// the person has, so its measuredAt can sit ahead of the clock, and the web
// shows it under the day it was written instead.
export const bodyMeasurementSchema = z.object({
  id: z.string().uuid(),
  measuredAt: z.string().datetime(),
  weightKg: z.number().nullable(),
  metrics: z.record(z.number().finite().nonnegative()),
  source: z.enum(["manual", "self_reported"]),
  createdAt: z.string().datetime(),
}).strict();
export const bodyMeasurementListResponseSchema = z.object({
  items: z.array(bodyMeasurementSchema),
  nextCursor: z.string().nullable(),
}).strict();
export type BodyMeasurement = z.infer<typeof bodyMeasurementSchema>;

export const nutritionListQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20), cursor: z.string().optional() }).strict();
export const foodSearchQuerySchema = z.object({ q: z.string().trim().min(1).max(100), limit: z.coerce.number().int().min(1).max(50).default(10) }).strict();

/** One food the search box offers: its figures per 100 g, its serving, where it
 *  comes from, the measures it can be logged by (ROADMAP 7a-iv-a) and the one and
 *  amount it starts at. */
/** What a person is told about a packaged product's numbers: the same on a barcode and in a search. */
export const packagedCheckSchema = z.enum(["fine", "doesnt_add_up", "part_missing", "lists_differ"]);
export type PackagedCheck = z.infer<typeof packagedCheckSchema>;

export const packagedFactsSchema = z.object({
  check: packagedCheckSchema,
  allergens: z.array(z.string()),
  mayContain: z.array(z.string()),
  listedAsTyped: z.array(z.string()),
  allergensFrom: z.literal("openfoodfacts").nullable(),
}).strict();
export type PackagedFacts = z.infer<typeof packagedFactsSchema>;

export const foodSearchItemSchema = z.object({
  canonical: z.string().min(1), name: z.string().min(1),
  kcal: z.number().nonnegative(), proteinG: z.number().nonnegative(), carbsG: z.number().nonnegative(), fatG: z.number().nonnegative(),
  fiberG: z.number().nonnegative().nullable(), serving: z.number().positive(), unit: z.string(),
  source: nutritionSourceSchema,
  measures: z.array(foodMeasureSchema).min(1),
  startsAt: measureStartSchema,
  /** Its calories at the amount it starts at, as the server prices that amount: the search lists a
   *  food by them ("94 kcal · 1 apple"), never per 100 g (ROADMAP 32b-ii-b). */
  startsKcal: z.number().int().nonnegative(),
  /** A packaged product found by search: what its barcode would say about it. */
  packaged: packagedFactsSchema.optional(),
}).strict().refine((food) => food.measures.some((m) => m.id === food.startsAt.measure), {
  message: "a food starts at one of its own measures",
});
export type FoodSearchItem = z.infer<typeof foodSearchItemSchema>;
export const foodSearchResponseSchema = z.object({ items: z.array(foodSearchItemSchema) }).strict();

// ── Recent foods (ROADMAP Stage 5 32b-ii-a; Kd, 2026-10-28) ──
/** The most recent foods Add to a meal opens on. */
export const RECENT_FOODS_MOST = 10;
/** One of the person's last different foods, at the amount they last had: what Add sends for it
 *  (`canonical` with `add`), the food as it was last logged, the server's own numbers for that
 *  amount, shown until the server has priced it again, and the food's measures now, so it opens in
 *  the measure picker as a searched food does (Kd, 2026-10-29). */
export const recentFoodSchema = z.object({
  canonical: z.string().min(1).max(120),
  source: z.enum(["curated", "usda", "openfoodfacts", "label"]),
  add: measureStartSchema,
  item: mealItemSchema,
  measures: z.array(foodMeasureSchema).min(1),
}).strict();
export type RecentFood = z.infer<typeof recentFoodSchema>;
export const recentFoodsResponseSchema = z.object({ items: z.array(recentFoodSchema).max(RECENT_FOODS_MOST) }).strict();
export type RecentFoodsResponse = z.infer<typeof recentFoodsResponseSchema>;

/** The most close foods a scanned food offers (ROADMAP Stage 5 33b-ii). */
export const MEAL_CLOSE_FOODS_MOST = 5;

/** A scanned item as the photo sheet receives it (ROADMAP 7a-iv-b; RULINGS
 *  2026-09-16, the portion redesign): its food's own measures and the one and
 *  amount the row starts at, as a food the search returns carries them, so the
 *  sheet corrects it with the same picker. `portionEstimated` is true where the
 *  row starts at no measure the photo's count agreed with — at the grams the photo
 *  saw, or at the food's serving where the photo gave no weight — and the sheet
 *  marks that an estimate. `gramsPoint` is what the start weighs. */
export const mealPhotoItemSchema = mealItemSchema.extend({
  measures: z.array(foodMeasureSchema).min(1),
  startsAt: measureStartSchema,
  portionEstimated: z.boolean(),
  /** The foods closest to what the photo saw, other than this one, offered first by "Not this?"
   *  (ROADMAP Stage 5 33b-ii). A scan kept on a phone from before has none. */
  closeFoods: z.array(foodSearchItemSchema).max(MEAL_CLOSE_FOODS_MOST).default([]),
}).refine((item) => item.measures.some((m) => m.id === item.startsAt.measure), {
  message: "a scanned item starts at one of its own measures",
});
export type MealPhotoItem = z.infer<typeof mealPhotoItemSchema>;

export const mealPhotoAnalysisSchema = z.object({
  scanToken: z.string(), mealName: z.string(), items: z.array(mealPhotoItemSchema),
  unknownItems: z.array(z.string()), photoQuality: z.enum(["good", "poor"]), totals: mealTotalsSchema,
  confirmed: z.literal(false), retakeToken: z.string().optional(),
});
export type MealPhotoAnalysis = z.infer<typeof mealPhotoAnalysisSchema>;

// ── Daily calorie + macro targets: the macro rings' numbers ─────────────────
// These ARE the plan's numbers (plan.ts; ROADMAP 4a-iii): the same stored
// answers, read by the same calculator as the onboarding screens, so the rings
// and "your daily number" can never disagree. `targets` is null EXACTLY when
// `missing` is non-empty or `targetWrongSide` is true: the server refuses to
// invent a number from defaults (RULINGS 2026-07-15), `missing` names the
// plan's own unanswered questions, so the rings can send the person to them,
// and `targetWrongSide` says the one answer that is there no longer fits.
export const nutritionTargetsSchema = z.object({
  /** The plan's resting burn (Mifflin-St Jeor), kcal a day. */
  bmr: z.number().int(),
  /** The plan's daily burn: the day plus the week's training. */
  tdee: z.number().int(),
  /** The calories to eat a day: the plan's, or the person's own when the
   *  response's `source` is "own". */
  kcal: z.number().int(),
  proteinG: z.number().int(),
  carbsG: z.number().int(),
  fatG: z.number().int(),
  /** The PLAN's fact, whichever set is on the rings: true when a rule held a
   *  weight-loss cut back — a yes on the health question or an age under 18
   *  (RULINGS 2026-09-07/09), the plan's `no_deficit` flag. It describes the
   *  app's plan only (`appTargets.kcal` is then the daily burn); under the
   *  person's own numbers `kcal` is what they typed, which may sit above it. */
  noCalorieCut: z.boolean(),
}).strict();
// ── The rings' numbers can be the person's own (ROADMAP 7a-iv-e) ────────────
// RULINGS 2026-09-17: a switch over the rings — App's plan · My own — and the
// numbers picked feed the rings, "Remaining today" and its "over" rows. "Gym's
// plan" joins this enum at Stage 2 item 10, when a gym can write one; an option
// with nothing behind it is not shown, so it is not here yet.
export const ringTargetsSourceSchema = z.enum(["app", "own"]);
export type RingTargetsSource = z.infer<typeof ringTargetsSourceSchema>;

/** The rails on a typed number, and NOT the health rule: the calorie floor and
 *  "no cut below what keeps your weight" are the server's, computed against
 *  this person's own plan (`ownTargetsHeld`), because both depend on answers a
 *  contract cannot see. These two only keep a typed number in the range a day
 *  of eating can occupy at all. */
export const OWN_TARGETS_MAX_KCAL = 20_000;
export const OWN_TARGETS_MAX_MACRO_G = 2_000;

/** The four numbers a person types for themselves. Whole numbers, as the rings
 *  and "Remaining today" print them. Macros are NOT made to add up to the
 *  calories: the screen says what they come to and leaves both as typed, since
 *  a box that silently rewrites one of the four numbers is a box that fights
 *  the person editing it. */
export const ownNutritionTargetsSchema = z.object({
  kcal: z.number().int().min(0).max(OWN_TARGETS_MAX_KCAL),
  proteinG: z.number().int().min(0).max(OWN_TARGETS_MAX_MACRO_G),
  carbsG: z.number().int().min(0).max(OWN_TARGETS_MAX_MACRO_G),
  fatG: z.number().int().min(0).max(OWN_TARGETS_MAX_MACRO_G),
}).strict();
export type OwnNutritionTargets = z.infer<typeof ownNutritionTargetsSchema>;

/** Why the person's stored numbers cannot feed the rings today — whether they
 *  picked them (the rings are then on the app's plan) or left them behind
 *  "App's plan" (so the screen never offers, as one tap, a set it would
 *  refuse). The stored numbers are never rewritten or dropped — the answers
 *  under them change (the health question, a birthday, a heavier body), so the
 *  same rule that let a number in is run again on every read, and the screen
 *  says which one is holding rather than swapping numbers silently. */
export const ownTargetsHeldSchema = z.discriminatedUnion("code", [
  /** The plan cannot be worked out yet, so there is nothing to check the typed
   *  calories against — and no resting burn for the rings either. */
  z.object({ code: z.literal("plan_incomplete") }).strict(),
  z.object({ code: z.literal("below_floor"), floorKcal: z.number().int().positive() }).strict(),
  z.object({
    code: z.literal("no_cut_below_maintenance"),
    maintenanceKcal: z.number().int().positive(),
    reasons: z.array(noDeficitReasonSchema).min(1),
  }).strict(),
]);
export type OwnTargetsHeld = z.infer<typeof ownTargetsHeldSchema>;

/** The rings' switch, saved: "App's plan", or "My own" with the four numbers.
 *  One route for both, so picking a set and editing it cannot disagree about
 *  what is stored. Switching back keeps the typed numbers (RULINGS 2026-09-17),
 *  which is why "app" carries none. */
export const putNutritionTargetsRequestSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("app") }).strict(),
  ownNutritionTargetsSchema.extend({ source: z.literal("own") }).strict(),
]);
export type PutNutritionTargetsRequest = z.infer<typeof putNutritionTargetsRequestSchema>;

// The EXACTLY is enforced, not merely asserted: every impossible state (a
// number beside an unmet input or a wrong-side target, no number with no
// reason given, both reasons at once) passes the bare shape. No number with no
// reason is the dangerous one: a client would render an "add your details"
// prompt naming no details. Since 7a-iv-e the same holds for the two sets: a
// `source` the numbers on `targets` do not come from is an impossible state,
// and it is the one that would show a person somebody else's arithmetic under
// their own heading.
export const nutritionTargetsResponseSchema = z.object({
  /** The numbers the rings, "Remaining today" and its "over" rows show: the
   *  picked set, resolved on the server (7c's day targets read it too). */
  targets: nutritionTargetsSchema.nullable(),
  missing: z.array(missingPlanInputSchema),
  /** The stored target is on the wrong side of the weight for the weight
   *  choice: a loss target kept when it switched to Gain weight, or a
   *  weight that has reached its target. The plan then holds the weight, and
   *  the rings do not pass that off as the goal's number; they say the target
   *  no longer fits, never that it is unanswered (RULINGS 2026-09-11). */
  targetWrongSide: z.boolean(),
  /** Which set `targets` holds. */
  source: ringTargetsSourceSchema,
  /** The app's plan as the rings would show it — the switch's other side, and
   *  what "My own" starts from. Null exactly when the plan cannot produce it,
   *  which `missing` and `targetWrongSide` are the reasons for. */
  appTargets: nutritionTargetsSchema.nullable(),
  /** The person's own numbers as they were typed, whether or not they are the
   *  ones in use — switching to the app's plan keeps them. */
  own: ownNutritionTargetsSchema.nullable(),
  /** Why `own` cannot feed the rings today, picked or not. Null when nothing
   *  is stored or nothing holds it. */
  ownHeld: ownTargetsHeldSchema.nullable(),
}).strict()
  .refine((r) => (r.appTargets === null) === (r.missing.length > 0 || r.targetWrongSide), {
    message: "the app's targets must be null exactly when an answer is missing or the target is on the wrong side",
  })
  // A plan still missing an answer has no flags to raise.
  .refine((r) => !(r.targetWrongSide && r.missing.length > 0), {
    message: "a wrong-side target is never reported beside a missing answer",
  })
  // "My own" on the switch means the rings are showing the four typed numbers,
  // nothing else, and that nothing is holding them back.
  .refine(
    (r) =>
      r.source !== "own" ||
      (r.own !== null &&
        r.ownHeld === null &&
        r.targets !== null &&
        r.targets.kcal === r.own.kcal &&
        r.targets.proteinG === r.own.proteinG &&
        r.targets.carbsG === r.own.carbsG &&
        r.targets.fatG === r.own.fatG),
    { message: "the own source must carry the person's own four numbers, unheld" },
  )
  // "App's plan" means the rings are showing the plan's numbers, unchanged.
  .refine(
    (r) =>
      r.source !== "app" ||
      (r.targets === null
        ? r.appTargets === null
        : r.appTargets !== null &&
          (Object.keys(r.appTargets) as (keyof NutritionTargets)[]).every((k) => r.targets?.[k] === r.appTargets?.[k])),
    { message: "the app source must carry the plan's own numbers" },
  )
  // Nothing is held back that was never typed, and a held set is never the one
  // on the rings.
  .refine((r) => r.ownHeld === null || (r.own !== null && r.source === "app"), {
    message: "a hold belongs to stored own numbers that the rings are not using",
  });
export type NutritionTargets = z.infer<typeof nutritionTargetsSchema>;
export type NutritionTargetsResponse = z.infer<typeof nutritionTargetsResponseSchema>;

/** The line every food suggestion carries (RULINGS 2026-09-09): there are no
 *  allergen tags on foods and no allergy question anywhere, so the person is
 *  told to take care if they have any food allergy, and to check labels. One
 *  wording, read by every screen that suggests food — the meal ideas after a
 *  workout today, the meal suggestions (ROADMAP 7a) when they are built. */
export const FOOD_ALLERGY_CAUTION = "If you have any food allergy, take care and check the labels.";

/** The line a vegetarian or vegan reads under the meal ideas, beside the allergy
 *  line (Kd, 2026-10-14): a food's diet follows its usual recipe, and no label
 *  of ours can see a product's own. Never shown to somebody who eats meat. */
export const DIET_LABEL_CAUTION = "Check labels too: some breads and cheeses contain animal ingredients.";

// ROADMAP 34d-i — meal ideas for what is left of the day.
/** One food of an idea, at the amount suggested: `servings` of the food's own
 *  `unit` ("g" means by weight, and `grams` is the amount), with the numbers
 *  the food list gives for those grams. Logged as it stands by canonical and grams. */
export const suggestedFoodSchema = z.object({
  canonical: z.string().min(1).max(120), name: z.string().min(1),
  grams: z.number().positive().max(MAX_ITEM_GRAMS), servings: z.number().positive(), unit: z.string().min(1),
  kcal: z.number().int().nonnegative(), proteinG: z.number().nonnegative(), carbsG: z.number().nonnegative(), fatG: z.number().nonnegative(),
}).strict();
export type SuggestedFood = z.infer<typeof suggestedFoodSchema>;
/** A plate is a protein food, a starch and a vegetable; a dish is one cooked
 *  dish with something beside it; light is a bowl, toast, or fruit with nuts. */
export const mealIdeaKindSchema = z.enum(["plate", "dish", "light"]);
export type MealIdeaKind = z.infer<typeof mealIdeaKindSchema>;
export const mealIdeaSchema = z.object({
  kind: mealIdeaKindSchema,
  items: z.array(suggestedFoodSchema).min(1).max(4),
  totals: z.object({ kcal: z.number().int().nonnegative(), proteinG: z.number().nonnegative(), carbsG: z.number().nonnegative(), fatG: z.number().nonnegative() }).strict(),
}).strict();
export type MealIdea = z.infer<typeof mealIdeaSchema>;
/** One meal still to come today: the calories it is sized to, and the ideas for it. */
export const suggestedMealSchema = z.object({ kcalTarget: z.number().int().positive(), ideas: z.array(mealIdeaSchema).max(3) }).strict();
export type SuggestedMeal = z.infer<typeof suggestedMealSchema>;
export const foodAnswerSchema = z.enum(["diet", "mealsPerDay"]);
/** The day's meal ideas. Nobody is given ideas on a guessed answer (RULINGS
 *  2026-07-15): `needs_answers` names the food answers still to give, and
 *  `needs_plan` says the day has no calorie number yet. `meals` is empty once
 *  the day's calories are eaten. Every `ok` reply carries the allergy line. */
export const mealIdeasResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("needs_answers"), missing: z.array(foodAnswerSchema).min(1) }).strict(),
  z.object({ status: z.literal("needs_plan") }).strict(),
  z.object({
    status: z.literal("ok"),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    kcalLeft: z.number().int(),
    meals: z.array(suggestedMealSchema).max(6),
    caution: z.literal(FOOD_ALLERGY_CAUTION),
    /** For a vegetarian or vegan; null for somebody who eats meat. */
    labelCaution: z.literal(DIET_LABEL_CAUTION).nullable(),
  }).strict(),
]);
export type MealIdeasResponse = z.infer<typeof mealIdeasResponseSchema>;

/** The line a photo scan's sheet carries (RULINGS 2026-09-07, kept 2026-09-09):
 *  photo scans say they estimate calories and cannot detect allergens. One
 *  wording, for the web's sheet and the phone app's. */
export const PHOTO_SCAN_CAUTION = "Calories from a photo are an estimate. A photo cannot detect allergens.";

// ROADMAP 34e-i — a person's own diet plan: a week, Monday to Sunday, that repeats
// until they change it (RULINGS 2026-09-12, "make their own diet plan").
/** A day of the plan's week: 1 is Monday, 7 Sunday. */
export const dietPlanDaySchema = z.number().int().min(1).max(7);
export const dietPlanDayParamsSchema = z.object({ day: z.coerce.number().pipe(dietPlanDaySchema) }).strict();
/** The most meals one day of the plan holds. */
export const MOST_PLAN_MEALS = 8;
/** One change's id, made by the phone: the same change sent twice is made once. */
const planChangeIdSchema = z.string().uuid().toLowerCase();

export const dietPlanMealSchema = z.object({
  mealType: mealTypeSchema,
  items: z.array(mealItemSchema).min(1).max(30),
  totals: mealTotalsSchema,
  /** The names of its foods of the app's own list that the person's diet answer, as it
   *  is now, does not eat: a plan made before the answer changed, or a food the person
   *  put in. Empty for a food the list has no diet for, and for no diet answer. */
  outsideDiet: z.array(z.string()),
}).strict();
export type DietPlanMeal = z.infer<typeof dietPlanMealSchema>;

const planNumbersSchema = z.object({
  kcal: z.number().int(), proteinG: z.number().int(), carbsG: z.number().int(), fatG: z.number().int(),
}).strict();
export const dietPlanDayReplySchema = z.object({
  day: dietPlanDaySchema,
  meals: z.array(dietPlanMealSchema).max(MOST_PLAN_MEALS),
  /** What the day's meals hold. */
  planned: planNumbersSchema,
  /** The day's targets, the rings' own; null while the person has no calorie number. */
  target: planNumbersSchema.nullable(),
  /** planned less target, each figure; null with the target. Below 0 is under it. */
  off: planNumbersSchema.nullable(),
}).strict();
export type DietPlanDayReply = z.infer<typeof dietPlanDayReplySchema>;

/** Whether the app can make the plan: it never makes one on a guessed answer
 *  (RULINGS 2026-07-15), the same reasons as the meal ideas'. */
export const dietPlanMakeSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok") }).strict(),
  z.object({ status: z.literal("needs_answers"), missing: z.array(foodAnswerSchema).min(1) }).strict(),
  /** `setup`: the day has no calorie number yet. `new_goal`: the target weight is
   *  behind the person (reached, or on the other side of their weight goal). */
  z.object({ status: z.literal("needs_plan"), reason: z.enum(["setup", "new_goal"]) }).strict(),
]);
export type DietPlanMake = z.infer<typeof dietPlanMakeSchema>;

export const dietPlanResponseSchema = z.object({
  days: z.array(dietPlanDayReplySchema).length(7),
  make: dietPlanMakeSchema,
  caution: z.literal(FOOD_ALLERGY_CAUTION),
  /** For a vegetarian or vegan, or somebody with no diet answer; null for somebody who eats meat. */
  labelCaution: z.literal(DIET_LABEL_CAUTION).nullable(),
}).strict();
export type DietPlanResponse = z.infer<typeof dietPlanResponseSchema>;

/** Make the plan: every day of the week, or the days named. It replaces what they held. */
export const makeDietPlanRequestSchema = z.object({
  changeId: planChangeIdSchema,
  days: z.array(dietPlanDaySchema).min(1).max(7).refine((days) => new Set(days).size === days.length, { message: "a day is named once" }).optional(),
}).strict();
export type MakeDietPlanRequest = z.infer<typeof makeDietPlanRequestSchema>;

/** A day as the person wants it, whole: its meals in order, each with its foods and
 *  amounts. A meal left out is removed; no meals clears the day. */
export const putDietPlanDayRequestSchema = z.object({
  changeId: planChangeIdSchema,
  meals: z.array(z.object({ mealType: mealTypeSchema, items: chosenItemsSchema }).strict()).max(MOST_PLAN_MEALS),
}).strict();
export type PutDietPlanDayRequest = z.infer<typeof putDietPlanDayRequestSchema>;

/** Swap one meal of a day, by its place in the day, for another idea of the same size. */
export const swapDietPlanMealRequestSchema = z.object({
  changeId: planChangeIdSchema,
  meal: z.number().int().min(0).max(MOST_PLAN_MEALS - 1),
}).strict();
export type SwapDietPlanMealRequest = z.infer<typeof swapDietPlanMealRequestSchema>;

// ── Your week in food (ROADMAP 34f-i) ──────────────────────────────────────────

/** The two spans the screen offers: the last 7 days or the last 30, today the last. */
const foodWeekSpanSchema = z.union([z.literal(7), z.literal(30)]);
export const foodWeekQuerySchema = z.object({
  days: z.enum(["7", "30"]).default("7").transform(Number).pipe(foodWeekSpanSchema),
}).strict();
export type FoodWeekQuery = z.infer<typeof foodWeekQuerySchema>;

/** Where a day's figure sits against its target: within 10 % either way is "on". */
export const foodBandSchema = z.enum(["under", "on", "over"]);
export type FoodBand = z.infer<typeof foodBandSchema>;
/** The four figures with a target. */
export const FOOD_WEEK_FIGURES = ["kcal", "proteinG", "carbsG", "fatG"] as const;
export type FoodWeekFigure = (typeof FOOD_WEEK_FIGURES)[number];

const dayTargetsSchema = z.object({
  kcal: z.number().int().nonnegative(), proteinG: z.number().int().nonnegative(),
  carbsG: z.number().int().nonnegative(), fatG: z.number().int().nonnegative(),
}).strict();
export type FoodDayTargets = z.infer<typeof dayTargetsSchema>;

const bandsSchema = z.object({
  kcal: foodBandSchema, proteinG: foodBandSchema, carbsG: foodBandSchema, fatG: foodBandSchema,
}).strict();

export const foodWeekDaySchema = z.object({
  /** A day of the person's own time zone, YYYY-MM-DD. */
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Today: still going, so it is shown and not counted in the facts. */
  today: z.boolean(),
  /** How many meals were logged that day; a day with none has no bands. */
  meals: z.number().int().nonnegative(),
  /** A food in the day is the scanner's own estimate: the day reads "about". */
  about: z.boolean(),
  kcal: z.number().int().nonnegative(),
  proteinG: z.number().nonnegative(),
  carbsG: z.number().nonnegative(),
  fatG: z.number().nonnegative(),
  /** No target exists for these two; `notKnown` counts the foods without the figure. */
  fiberG: moreTotalSchema,
  sodiumMg: moreTotalSchema,
  /** The day's targets: kept that day, or today's for a day before they were kept.
   *  Null while the person's plan has no numbers. */
  targets: dayTargetsSchema.nullable(),
  /** True when `targets` were kept on the day itself; false when they are today's. */
  targetsOfTheDay: z.boolean(),
  /** Null for a day with no meals, or with no targets. */
  bands: bandsSchema.nullable(),
}).strict();
export type FoodWeekDay = z.infer<typeof foodWeekDaySchema>;

/** For each figure, how many finished days with meals and targets were under, on and
 *  over: "Protein was under target on 5 of 6 days" is `under` of `judged`. Today is
 *  never judged, so a span of 7 judges 6 days at most, and of 30, 29. */
const factSchema = z.object({
  under: z.number().int().nonnegative(), on: z.number().int().nonnegative(),
  over: z.number().int().nonnegative(), judged: z.number().int().nonnegative(),
}).strict().refine((f) => f.under + f.on + f.over === f.judged, { message: "the three add up to judged" });
export type FoodWeekFact = z.infer<typeof factSchema>;

export const foodWeekResponseSchema = z.object({
  span: foodWeekSpanSchema,
  /** Oldest first; today is the last. */
  days: z.array(foodWeekDaySchema).min(7).max(30),
  facts: z.object({ kcal: factSchema, proteinG: factSchema, carbsG: factSchema, fatG: factSchema }).strict(),
}).strict();
export type FoodWeekResponse = z.infer<typeof foodWeekResponseSchema>;

// ── Meals kept on the phone until the server has them (ROADMAP Stage 5 32b-i) ──
// The phone writes each meal it logs, and each removal of one, to a file of its
// own before anything is sent, and reads that file back through this shape on
// every start: a file the app wrote is still an input (CLAUDE.md §4). The phone reads it
// entry by entry, so one entry it cannot read never costs the others.

/** The most entries the file holds: a phone that has been offline for weeks still keeps them all. */
export const MEAL_OUTBOX_MOST = 500;

/** What is sent for a waiting meal: the typed meal's request, its time read without the server's
 *  "not more than a day ahead" rule, which is the server's to apply when it is sent; a phone whose
 *  clock was ahead and is put right must not lose the meal. */
export const waitingMealBodySchema = manualMealRequestSchema.extend({ takenAt: z.string().datetime() });

/** A meal waiting to be sent: what is sent, and what the day's list shows of it. */
export const waitingMealSchema = z.object({
  /** The meal's own id, the one `body` carries: the server keeps one meal for it (32a). */
  id: z.string().uuid().toLowerCase(),
  body: waitingMealBodySchema,
  /** The server's preview of it, where one came back before it was logged. */
  items: z.array(mealItemSchema).nullable(),
  totals: mealTotalsSchema.nullable(),
  /** Sent at least once: its save may have reached the server, so a removal is sent after it. */
  tried: z.boolean(),
  /** A meal logged from a photo (33b-i): sent as the scan's save, `body` without its name, which
   *  the server keeps from the scan. */
  scanToken: z.string().min(32).max(256).optional(),
}).strict().refine((m) => m.body.id === m.id, { message: "the body carries the meal's own id" });
export type WaitingMeal = z.infer<typeof waitingMealSchema>;

/** A change to a saved meal waiting to be sent (ROADMAP 32b-ii-a): what the PATCH carries, its time
 *  read without the server's "not more than a day ahead" rule, as a waiting meal's is. */
export const waitingChangeBodySchema = z.object({
  mealName: z.string().trim().min(1).max(200).optional(), takenAt: z.string().datetime().optional(),
  mealType: mealTypeSchema.nullable().optional(),
  items: mealEditItemsSchema.optional(), itemsVersion: itemsVersionSchema.optional(),
  changeId: z.string().uuid().toLowerCase(),
}).strict();
export type WaitingChangeBody = z.infer<typeof waitingChangeBodySchema>;

/** A change waiting to be sent: what is sent, and what the day's list shows of it while it waits. */
export const waitingChangeSchema = z.object({
  /** The meal's id. */
  id: z.string().uuid().toLowerCase(),
  /** The meal's name when the change was made, said if the server will not take it. */
  name: z.string().max(200),
  body: waitingChangeBodySchema,
  /** With a change to the foods: the server's preview of them, where one came back. */
  items: z.array(mealItemSchema).nullable(),
  totals: mealTotalsSchema.nullable(),
  /** With a change to the foods: each food as it reads, `[i]` for `body.items[i]`. */
  foods: z.array(z.object({
    name: z.string().max(200), amount: z.string().max(200),
    // A food titled by what the photo saw: the food its numbers are from, shown while it waits too.
    numbersFrom: z.object({ name: z.string().max(200), source: mealItemSourceSchema }).strict().optional(),
  }).strict()).max(30).nullable(),
  tried: z.boolean(),
}).strict();
export type WaitingChange = z.infer<typeof waitingChangeSchema>;

export const mealOutboxEntrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("save"), meal: waitingMealSchema }).strict(),
  z.object({ kind: z.literal("remove"), id: z.string().uuid().toLowerCase() }).strict(),
  z.object({ kind: z.literal("change"), change: waitingChangeSchema }).strict(),
]);
export type MealOutboxEntry = z.infer<typeof mealOutboxEntrySchema>;

/** A meal the server would not take, kept until the person has read why. */
export const mealOutboxRefusedSchema = z.object({
  id: z.string().uuid().toLowerCase(),
  name: z.string().max(200),
  message: z.string().max(500),
}).strict();
export type MealOutboxRefused = z.infer<typeof mealOutboxRefusedSchema>;

/** The file, its entries in the order they are sent. */
export const mealOutboxFileSchema = z.object({
  version: z.literal(1),
  entries: z.array(mealOutboxEntrySchema).max(MEAL_OUTBOX_MOST),
  refused: z.array(mealOutboxRefusedSchema).max(MEAL_OUTBOX_MOST).optional(),
}).strict();
export type MealOutboxFile = z.infer<typeof mealOutboxFileSchema>;

// ── A meal photo not yet saved, kept on the phone (ROADMAP Stage 5 33b-i) ──
// The scan has already used one of the person's scans, so leaving the review keeps it: the phone
// writes it to a file of the person's own and opens it again while the server can still save it.

/** The most of a kept photo, in base64 letters: a photo drawn no larger than 768 px is about 100 KB. */
export const MEAL_PHOTO_KEPT_MOST = 2_000_000;
/** An amount as the phone's picker holds it: a measure of the food (or a saved dish) and how many. */
export const photoSheetAmountSchema = z.object({
  measure: z.string().max(80), amount: z.string().max(20),
  /** A dish the whole meal was eaten from: this food's part of it, as sent (`dishwareItemSchema`). */
  share: z.number().positive().max(1).optional(),
}).strict();
export type PhotoSheetAmount = z.infer<typeof photoSheetAmountSchema>;
/** A food added to the photo's meal by search, as the search sent it. */
export const photoSheetFoodSchema = z.object({
  canonical: z.string().min(1).max(120), name: z.string().min(1).max(200), source: nutritionSourceSchema,
  measures: z.array(foodMeasureSchema).min(1), startsAt: measureStartSchema,
}).strict();
export type PhotoSheetFood = z.infer<typeof photoSheetFoodSchema>;
/** A food put on the photo's meal by the person: one the search found, at an amount of it, or their
 *  own food (`ownFoodItemSchema`, Kd 2026-10-30). */
export const photoSheetPickSchema = z.union([
  z.object({ food: photoSheetFoodSchema, amount: photoSheetAmountSchema }).strict(),
  z.object({ own: ownFoodItemSchema }).strict(),
]);
export type PhotoSheetPick = z.infer<typeof photoSheetPickSchema>;
export const photoSheetFileSchema = z.object({
  version: z.literal(1),
  /** When the scan came back: it can be saved until `MEAL_SCAN_SAVE_SECONDS` after. */
  scannedAt: z.string().datetime(),
  analysis: mealPhotoAnalysisSchema,
  /** Each scanned food's amount, in the scan's order; null where the person took it off the meal. */
  amounts: z.array(photoSheetAmountSchema.nullable()).max(30),
  /** What the person put in place of each scanned food the photo got wrong ("Change food"), in the
   *  scan's order; null where the scan's own food stands. */
  replaced: z.array(photoSheetPickSchema.nullable()).max(30),
  /** Foods the photo missed. */
  extras: z.array(photoSheetPickSchema).max(30),
  mealType: mealTypeSchema,
  /** The photo as it was sent (made small and cleaned), shown over the meal again when it is reopened. */
  photo: z.string().max(MEAL_PHOTO_KEPT_MOST).regex(/^[A-Za-z0-9+/]*={0,2}$/).optional(),
}).strict();
export type PhotoSheetFile = z.infer<typeof photoSheetFileSchema>;
