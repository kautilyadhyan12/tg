// P2.6a — Nutrition & body contracts (Part 2B §3; Part 4 §3.6).
import { z } from "zod";
import { missingPlanInputSchema, noDeficitReasonSchema } from "./plan.js";

export const portionSourceSchema = z.enum(["user_dishware", "regional_prior", "default", "legacy"]);
/** Where an item's numbers per 100 g came from. `usda` is a food of the USDA
 *  FoodData Central table (ROADMAP 7a-iii-a) — public-domain data the app
 *  credits on screen; `openfoodfacts` is one brand's packaged product;
 *  `estimate` is the scanner's own figures for a food no table has (RULINGS
 *  2026-09-15), shown marked "estimate". */
export const nutritionSourceSchema = z.enum(["curated", "openfoodfacts", "usda", "estimate"]);
export type NutritionSource = z.infer<typeof nutritionSourceSchema>;
export const mealOriginSchema = z.enum(["photo", "manual"]);
/** Kd ruling 2026-07-17 (Card-5b smoke; supersedes the D1 time-bucket
 *  interim): the section is a USER-CHOSEN label stored on the meal —
 *  takenAt stays the exact real time and never encodes it. */
export const mealTypeSchema = z.enum(["breakfast", "lunch", "dinner", "snack"]);
export type MealType = z.infer<typeof mealTypeSchema>;

const gramRangeSchema = z.tuple([z.number().positive(), z.number().positive()]);

/** A food's energy and macros per 100 g. */
export const per100gSchema = z.object({
  kcal: z.number().nonnegative().max(900), proteinG: z.number().nonnegative().max(100),
  carbsG: z.number().nonnegative().max(100), fatG: z.number().nonnegative().max(100),
}).strict();
export type Per100g = z.infer<typeof per100gSchema>;

/** The measure a meal item was logged by (ROADMAP 7a-iv-a): the measure's id and
 *  name as the food's list gave them when it was logged — or "dish" and the
 *  person's own name for a saved dish — and how many of it. The item's grams are
 *  `amount` of it, worked out by the server. An item logged by grams, or before
 *  measures existed, has none. */
export const loggedMeasureSchema = z.object({
  id: z.string().min(1).max(40), name: z.string().min(1).max(100), amount: z.number().positive(),
}).strict();
export type LoggedMeasure = z.infer<typeof loggedMeasureSchema>;

export const mealItemSchema = z.object({
  name: z.string(), canonical: z.string(), gramsPoint: z.number().positive(), gramsRange: gramRangeSchema,
  portionSource: portionSourceSchema, nutritionSource: nutritionSourceSchema,
  kcalPoint: z.number().int().nonnegative(), kcalLow: z.number().int().nonnegative(), kcalHigh: z.number().int().nonnegative(),
  proteinG: z.number().nonnegative(), carbsG: z.number().nonnegative(), fatG: z.number().nonnegative(),
  /** An estimate row's own figures (ROADMAP 7a-iii-b). No table holds that food,
   *  so the meal carries them, and its grams can be changed after saving without
   *  a lookup; every other row is priced again from its table by canonical. */
  per100g: per100gSchema.optional(),
  measure: loggedMeasureSchema.optional(),
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
const dishwareItemSchema = z
  .object({ canonical: z.string().min(1).max(120), dishwareId: z.string().uuid(), fillLevel: z.number().positive().max(1) })
  .strict();

// ROADMAP 7a-iv-a — a food logged by one of its own measures (RULINGS 2026-09-16,
// the portion redesign): the measure's id in the food's list and how many of it.
// The SERVER looks the measure up in its own list for that food and works out the
// grams, so a client never says what a measure weighs.
/** Grams, ounces, the food's own serving, and a USDA household measure by its
 *  `seq_num` in the USDA entry the food is, or cites. */
export const measureIdSchema = z.string().regex(/^(?:g|oz|serving|usda-\d{1,4})$/);
/** One measure of a food, as the food search sends it: its id, its name, and the
 *  grams ONE of it weighs. */
export const foodMeasureSchema = z.object({
  id: measureIdSchema, name: z.string().min(1).max(60), grams: z.number().positive().max(MAX_ITEM_GRAMS),
}).strict();
export type FoodMeasure = z.infer<typeof foodMeasureSchema>;
/** The measure and amount a food starts at where the person has not picked one. */
export const measureStartSchema = z.object({ measure: measureIdSchema, amount: z.number().positive() }).strict();
const measureItemSchema = z
  .object({ canonical: z.string().min(1).max(120), measure: measureIdSchema, amount: z.number().positive().max(MAX_ITEM_GRAMS) })
  .strict();
export const chosenItemSchema = z.union([gramsItemSchema, dishwareItemSchema, measureItemSchema]);
export type ChosenItem = z.infer<typeof chosenItemSchema>;
const chosenItemsSchema = z.array(chosenItemSchema).min(1).max(30);

export const confirmMealRequestSchema = z.object({
  scanToken: z.string().min(32).max(256), takenAt: takenAtSchema,
  mealType: mealTypeSchema.optional(),
  items: chosenItemsSchema,
}).strict();
export type ConfirmMealRequest = z.infer<typeof confirmMealRequestSchema>;

/** GAP-2 ruling: manual logging (Stage 4 "missing item → add" / no-photo
 *  entry). Items resolve through food search; origin = 'manual'. */
export const manualMealRequestSchema = z.object({
  mealName: z.string().trim().min(1).max(200), takenAt: takenAtSchema,
  mealType: mealTypeSchema.optional(),
  items: chosenItemsSchema,
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
  items: chosenItemsSchema,
  scanToken: z.string().min(32).max(256).optional(),
}).strict();
export type PreviewMealRequest = z.infer<typeof previewMealRequestSchema>;
export const mealPreviewSchema = z.object({ items: z.array(mealItemSchema), totals: mealTotalsSchema });
export type MealPreview = z.infer<typeof mealPreviewSchema>;

export const patchMealRequestSchema = z.object({
  mealName: z.string().trim().min(1).max(200).optional(), takenAt: takenAtSchema.optional(),
  mealType: mealTypeSchema.nullable().optional(), // null clears the label
  items: chosenItemsSchema.optional(),
}).strict().refine((v) => Object.keys(v).length > 0, { message: "at least one field required" });
export type PatchMealRequest = z.infer<typeof patchMealRequestSchema>;

export const mealSchema = z.object({
  id: z.string().uuid(), takenAt: z.string(), mealType: mealTypeSchema.nullable(),
  mealName: z.string().nullable(), items: z.array(mealItemSchema),
  totals: mealTotalsSchema, confirmed: z.boolean(), origin: mealOriginSchema,
  portionSource: z.enum(["user_dishware", "regional_prior", "default", "legacy"]),
  nutritionSources: z.array(z.string()), calcVersion: z.number().int(),
});
export type Meal = z.infer<typeof mealSchema>;

export const dishwareInputSchema = z.object({
  label: z.string().trim().min(1).max(100), containerClass: z.string().trim().min(1).max(80),
  volumeMl: z.number().int().positive().max(10_000), foodHint: z.string().trim().min(1).max(120).nullable().optional(),
}).strict();
export const patchDishwareSchema = dishwareInputSchema.partial().refine((v) => Object.keys(v).length > 0, { message: "at least one field required" });
export type DishwareInput = z.infer<typeof dishwareInputSchema>;
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
export const foodSearchItemSchema = z.object({
  canonical: z.string().min(1), name: z.string().min(1),
  kcal: z.number().nonnegative(), proteinG: z.number().nonnegative(), carbsG: z.number().nonnegative(), fatG: z.number().nonnegative(),
  fiberG: z.number().nonnegative().nullable(), serving: z.number().positive(), unit: z.string(),
  source: nutritionSourceSchema,
  measures: z.array(foodMeasureSchema).min(1),
  startsAt: measureStartSchema,
}).strict().refine((food) => food.measures.some((m) => m.id === food.startsAt.measure), {
  message: "a food starts at one of its own measures",
});
export type FoodSearchItem = z.infer<typeof foodSearchItemSchema>;
export const foodSearchResponseSchema = z.object({ items: z.array(foodSearchItemSchema) }).strict();

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

/** The line a photo scan's sheet carries (RULINGS 2026-09-07, kept 2026-09-09):
 *  photo scans say they estimate calories and cannot detect allergens. One
 *  wording, for the web's sheet and the phone app's. */
export const PHOTO_SCAN_CAUTION = "Calories from a photo are an estimate. A photo cannot detect allergens.";
