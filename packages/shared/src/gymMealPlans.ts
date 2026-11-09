// A meal plan a gym gives its members (spec Part 6 §16.6; ROADMAP Stage 2 24a-i). Staff with
// the Plans tick write it once: a week, Monday first, of meals from the food list or foods of
// their own, priced by the server as a person's own meal plan is (34e-ii-b), and stored in the
// same shape, so the phone shows it and logs a meal of it at the same numbers. Who gets it:
// `gymMealPlanGiving.ts` (24a-ii).
import { z } from "zod";
import {
  FOOD_ALLERGY_CAUTION, MEAL_MOST_FOODS, MOST_PLAN_MEALS, dayVersionSchema, dietPlanDaySchema, mealChoiceSchema,
  mealItemSchema, mealTotalsSchema, mealTypeSchema, type MealChoice,
} from "./nutrition.js";

/** The longest name a plan takes. */
export const GYM_MEAL_PLAN_NAME_MAX = 60;
/** The most meal plans one gym keeps. */
export const GYM_MEAL_PLANS_MOST = 100;

const planIdSchema = z.uuid().toLowerCase();
const changeIdSchema = z.uuid().toLowerCase();
export const gymMealPlanNameSchema = z.string().trim().min(1).max(GYM_MEAL_PLAN_NAME_MAX);

/** One food of a plan's meal: a food of the lists by grams or by one of its measures, or the
 *  writer's own food with its own numbers. Never a food measured in somebody's own dish: a
 *  member's bowl is not the writer's. */
export const gymPlanFoodSchema = mealChoiceSchema.refine((c: MealChoice) => !("dishwareId" in c), {
  message: "a gym's plan weighs a food in grams or by its own measures",
});

export const gymMealPlanParamsSchema = z.object({ gymId: z.uuid(), planId: planIdSchema }).strict();
export const gymMealPlanDayParamsSchema = z.object({
  gymId: z.uuid(), planId: planIdSchema, day: z.coerce.number().pipe(dietPlanDaySchema),
}).strict();
export const gymMealPlanMealParamsSchema = z.object({
  gymId: z.uuid(), planId: planIdSchema, day: z.coerce.number().pipe(dietPlanDaySchema),
  meal: z.coerce.number().int().min(0).max(MOST_PLAN_MEALS - 1),
}).strict();

/** A new plan, empty, under its name. `id` is the browser's own: sent twice, it is one plan. */
export const createGymMealPlanRequestSchema = z.object({ id: planIdSchema, name: gymMealPlanNameSchema }).strict();
export type CreateGymMealPlanRequest = z.infer<typeof createGymMealPlanRequestSchema>;

export const renameGymMealPlanRequestSchema = z.object({ name: gymMealPlanNameSchema }).strict();
export type RenameGymMealPlanRequest = z.infer<typeof renameGymMealPlanRequestSchema>;

/** A day as the writer wants it, whole, as a person's own plan's day is sent. */
export const putGymMealPlanDayRequestSchema = z.object({
  changeId: changeIdSchema,
  /** The day's `version` as the screen showed it: a day changed since is refused (`plan_changed`). */
  version: dayVersionSchema.optional(),
  meals: z.array(z.object({ mealType: mealTypeSchema, items: z.array(gymPlanFoodSchema).min(1).max(MEAL_MOST_FOODS) }).strict()).max(MOST_PLAN_MEALS),
}).strict();
export type PutGymMealPlanDayRequest = z.infer<typeof putGymMealPlanDayRequestSchema>;

const planNumbersSchema = z.object({
  kcal: z.number().int(), proteinG: z.number().int(), carbsG: z.number().int(), fatG: z.number().int(),
}).strict();

export const gymMealPlanMealSchema = z.object({
  mealType: mealTypeSchema,
  items: z.array(mealItemSchema).min(1).max(MEAL_MOST_FOODS),
  totals: mealTotalsSchema,
}).strict();
export type GymMealPlanMeal = z.infer<typeof gymMealPlanMealSchema>;

export const gymMealPlanDaySchema = z.object({
  day: dietPlanDaySchema,
  meals: z.array(gymMealPlanMealSchema).max(MOST_PLAN_MEALS),
  /** What the day's meals hold. */
  planned: planNumbersSchema,
  version: dayVersionSchema,
}).strict();
export type GymMealPlanDay = z.infer<typeof gymMealPlanDaySchema>;

/** Who wrote a plan or changed it last: their name, or null for an account no longer there. */
const byNameSchema = z.string().min(1).nullable();

export const gymMealPlanSummarySchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  writtenBy: byNameSchema,
  changedBy: byNameSchema,
  createdAt: z.iso.datetime({ offset: true }),
  /** The same as `createdAt` until the plan is first changed. */
  updatedAt: z.iso.datetime({ offset: true }),
  /** How many meals the week holds. */
  meals: z.number().int().nonnegative(),
}).strict();
export type GymMealPlanSummary = z.infer<typeof gymMealPlanSummarySchema>;

/** The Plans list: each plan with who it is given to. */
export const gymMealPlanListItemSchema = gymMealPlanSummarySchema.extend({
  givenTo: z.object({
    everyone: z.boolean(),
    /** The membership types' and tags' names, in the order given. */
    groups: z.array(z.string()),
    members: z.number().int().nonnegative(),
  }).strict(),
  /** How many people on the list get it now. */
  gets: z.number().int().nonnegative(),
}).strict();
export type GymMealPlanListItem = z.infer<typeof gymMealPlanListItemSchema>;

export const gymMealPlansResponseSchema = z.object({ plans: z.array(gymMealPlanListItemSchema).max(GYM_MEAL_PLANS_MOST) }).strict();
export type GymMealPlansResponse = z.infer<typeof gymMealPlansResponseSchema>;

export const gymMealPlanResponseSchema = gymMealPlanSummarySchema.extend({
  days: z.array(gymMealPlanDaySchema).length(7),
  /** Shown with every food the plan suggests, whoever wrote it (§16.6). */
  caution: z.literal(FOOD_ALLERGY_CAUTION),
}).strict();
export type GymMealPlanResponse = z.infer<typeof gymMealPlanResponseSchema>;

/** The server's sentences for this page, said where the press was made. */
export const GYM_MEAL_PLAN_WORDS = {
  not_found: "This meal plan was deleted.",
  plan_changed: "This day was changed by someone else. Open it again to make this change.",
  too_many: `You have ${String(GYM_MEAL_PLANS_MOST)} meal plans, the most you can keep. Delete one to add another.`,
  name_taken: "Another meal plan has this name. Give this one another name.",
  not_for_plan: "can’t go in a meal plan. Take it off, then save.",
  label_food: "A food from your own scanned label can’t go in this meal plan. Add it as your own food instead.",
} as const;
