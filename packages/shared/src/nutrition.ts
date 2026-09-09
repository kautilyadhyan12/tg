// P2.6a — Nutrition & body contracts (Part 2B §3; Part 4 §3.6).
import { z } from "zod";

export const portionSourceSchema = z.enum(["user_dishware", "regional_prior", "default", "legacy"]);
export const nutritionSourceSchema = z.enum(["curated", "openfoodfacts"]);
export const mealOriginSchema = z.enum(["photo", "manual"]);
/** Kd ruling 2026-07-17 (Card-5b smoke; supersedes the D1 time-bucket
 *  interim): the section is a USER-CHOSEN label stored on the meal —
 *  takenAt stays the exact real time and never encodes it. */
export const mealTypeSchema = z.enum(["breakfast", "lunch", "dinner", "snack"]);
export type MealType = z.infer<typeof mealTypeSchema>;

const gramRangeSchema = z.tuple([z.number().positive(), z.number().positive()]);

export const mealItemSchema = z.object({
  name: z.string(), canonical: z.string(), gramsPoint: z.number().positive(), gramsRange: gramRangeSchema,
  portionSource: portionSourceSchema, nutritionSource: nutritionSourceSchema,
  kcalPoint: z.number().int().nonnegative(), kcalLow: z.number().int().nonnegative(), kcalHigh: z.number().int().nonnegative(),
  proteinG: z.number().nonnegative(), carbsG: z.number().nonnegative(), fatG: z.number().nonnegative(),
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

export const mealPhotoAnalysisSchema = z.object({
  scanToken: z.string(), mealName: z.string(), cuisineGuess: z.string().nullable(), items: z.array(mealItemSchema),
  unknownItems: z.array(z.string()), photoQuality: z.enum(["good", "poor"]), totals: mealTotalsSchema,
  confirmed: z.literal(false), retakeToken: z.string().optional(),
});
export type MealPhotoAnalysis = z.infer<typeof mealPhotoAnalysisSchema>;

/** GAP-3 ruling: client-supplied, bounded to ≤24 h in the future (offline
 *  backfill of past meals is legitimate; future meals are not). */
const takenAtSchema = z
  .string()
  .datetime()
  .refine((v) => Date.parse(v) <= Date.now() + 24 * 60 * 60 * 1000, {
    message: "must not be more than 24h in the future",
  });

// Card 5c2 — dishware portions. An item's amount is given EITHER as grams
// directly, OR "measured with my dishware": a saved dish id + how full it was
// (fillLevel in (0,1]; the UI offers ¼/½/¾/full). The SERVER turns the dishware
// arm into grams (volume × fill × density) using the SAME math the scan-time
// portion resolver uses (rung 'user_dishware'), so the client still never does
// nutrition arithmetic (2B). Both arms are .strict(), so a hybrid item
// ({canonical, grams, dishwareId}) is rejected by the union — no ambiguity.
const gramsItemSchema = z
  .object({ canonical: z.string().min(1).max(120), grams: z.number().positive().max(10_000) })
  .strict();
const dishwareItemSchema = z
  .object({ canonical: z.string().min(1).max(120), dishwareId: z.string().uuid(), fillLevel: z.number().positive().max(1) })
  .strict();
export const chosenItemSchema = z.union([gramsItemSchema, dishwareItemSchema]);
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
  // would pin users.weight_kg as the "latest" forever).
  measuredAt: z
    .string()
    .datetime()
    .refine((v) => Date.parse(v) <= Date.now() + 24 * 60 * 60 * 1000, {
      message: "must not be more than 24h in the future",
    }),
  weightKg: z.number().positive().lt(1000).multipleOf(0.01).nullable().optional(),
  metrics: z.record(z.number().finite().nonnegative()).default({}), source: z.literal("manual").default("manual"),
}).strict();
export const patchBodyMeasurementSchema = bodyMeasurementInputSchema.partial().refine((v) => Object.keys(v).length > 0, { message: "at least one field required" });
export type BodyMeasurementInput = z.infer<typeof bodyMeasurementInputSchema>;
export type PatchBodyMeasurement = z.infer<typeof patchBodyMeasurementSchema>;

export const nutritionListQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20), cursor: z.string().optional() }).strict();
export const foodSearchQuerySchema = z.object({ q: z.string().trim().min(1).max(100), limit: z.coerce.number().int().min(1).max(50).default(10) }).strict();

// ── Daily calorie + macro targets (the nutrition.py Mifflin-St Jeor port) ────
// `targets` is null EXACTLY when `missing` is non-empty: the server refuses to
// invent a number from defaults (Kd ruling; the Card-7 F2 precedent), so the
// client renders an honest "add your details" prompt naming what is missing
// rather than a generic goal indistinguishable from a real one.
export const missingTargetInputSchema = z.enum(["age", "gender", "heightCm", "weightKg", "exerciseFrequency"]);
export const nutritionTargetsSchema = z.object({
  bmr: z.number().int(),
  tdee: z.number().int(),
  kcal: z.number().int(),
  proteinG: z.number().int(),
  carbsG: z.number().int(),
  fatG: z.number().int(),
  /** True when a yes on the health question, or an age under 18, held the
   *  weight-loss cut back (RULINGS 2026-09-07/09): `kcal` is then the daily
   *  burn, not burn − 400. */
  noCalorieCut: z.boolean(),
}).strict();
// The EXACTLY is enforced, not merely asserted (T3 round 2): both impossible
// states — targets with an unmet input, and no targets with nothing missing —
// were accepted by the bare shape. The second is the dangerous one: a client
// would render an "add your details" prompt naming no details.
export const nutritionTargetsResponseSchema = z.object({
  targets: nutritionTargetsSchema.nullable(),
  missing: z.array(missingTargetInputSchema),
}).strict().refine((r) => (r.targets === null) === (r.missing.length > 0), {
  message: "targets must be null exactly when missing is non-empty",
});
export type MissingTargetInput = z.infer<typeof missingTargetInputSchema>;
export type NutritionTargets = z.infer<typeof nutritionTargetsSchema>;
export type NutritionTargetsResponse = z.infer<typeof nutritionTargetsResponseSchema>;
