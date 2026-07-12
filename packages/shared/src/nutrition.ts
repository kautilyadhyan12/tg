// P2.6a — Nutrition & body contracts (Part 2B §3; Part 4 §3.6).
import { z } from "zod";

export const portionSourceSchema = z.enum(["user_dishware", "regional_prior", "default", "legacy"]);
export const nutritionSourceSchema = z.enum(["curated", "openfoodfacts"]);
export const mealOriginSchema = z.enum(["photo", "manual"]);

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

const chosenItemsSchema = z
  .array(z.object({ canonical: z.string().min(1).max(120), grams: z.number().positive().max(10_000) }).strict())
  .min(1)
  .max(30);

export const confirmMealRequestSchema = z.object({
  scanToken: z.string().min(32).max(256), takenAt: takenAtSchema,
  items: chosenItemsSchema,
}).strict();
export type ConfirmMealRequest = z.infer<typeof confirmMealRequestSchema>;

/** GAP-2 ruling: manual logging (Stage 4 "missing item → add" / no-photo
 *  entry). Items resolve through food search; origin = 'manual'. */
export const manualMealRequestSchema = z.object({
  mealName: z.string().trim().min(1).max(200), takenAt: takenAtSchema,
  items: chosenItemsSchema,
}).strict();
export type ManualMealRequest = z.infer<typeof manualMealRequestSchema>;

export const createMealRequestSchema = z.union([confirmMealRequestSchema, manualMealRequestSchema]);
export type CreateMealRequest = z.infer<typeof createMealRequestSchema>;

export const patchMealRequestSchema = z.object({
  mealName: z.string().trim().min(1).max(200).optional(), takenAt: takenAtSchema.optional(),
  items: chosenItemsSchema.optional(),
}).strict().refine((v) => Object.keys(v).length > 0, { message: "at least one field required" });
export type PatchMealRequest = z.infer<typeof patchMealRequestSchema>;

export const mealSchema = z.object({
  id: z.string().uuid(), takenAt: z.string(), mealName: z.string().nullable(), items: z.array(mealItemSchema),
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
