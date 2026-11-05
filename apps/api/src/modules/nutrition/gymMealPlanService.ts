// The meal plans a gym gives its members (spec Part 6 §16.6; ROADMAP Stage 2 24a-i). Staff with the
// Plans tick write a week of meals from the food list, or foods of their own, and the server prices
// every food as a person's own meal plan is priced (34e-ii-b), so a meal logged from it later logs at
// the numbers the plan shows. A plan is never resized for anybody; who gets it is
// `gymMealPlanGivingService.ts` (24a-ii).
import { createHash } from "node:crypto";
import {
  FOOD_ALLERGY_CAUTION, GYM_MEAL_PLANS_MOST, GYM_MEAL_PLAN_WORDS, gymMealPlanResponseSchema, isOwnFood,
  type ChosenItem, type CreateGymMealPlanRequest, type FoodMeasure, type GymMealPlanDay, type GymMealPlanResponse,
  type GymMealPlanSummary, type MealChoice, type MealItem, type PutGymMealPlanDayRequest,
  type RenameGymMealPlanRequest,
} from "@app/shared";
import { requirePrivilege, requireWritablePrivilege } from "../orgs/service.js";
import * as repo from "./gymMealPlanRepo.js";
import {
  LABEL_CANONICAL_PREFIX, NutritionError, itemsMeasures, ownFoodItem, pricedForGood, resolveChosenItems, totals, type NutritionDeps,
} from "./service.js";

const TICK = "plans.manage";
type Limit = () => Promise<boolean>;

const notFound = (): NutritionError => new NutritionError(404, "plan_not_found", GYM_MEAL_PLAN_WORDS.not_found);
const whole = (n: number): number => Math.round(n);

/** JSON with every object's keys in one order, so the same day always reads the same. */
const steady = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(steady).join(",")}]`
    : value !== null && typeof value === "object"
      ? `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${JSON.stringify(k)}:${steady(v)}`).join(",")}}`
      : JSON.stringify(value);

/** A day's version: every food, amount and number of its meals, in order. */
const dayVersion = (meals: readonly repo.StoredMeal[]): string => createHash("sha256").update(steady(meals)).digest("hex").slice(0, 16);

export function dayOf(day: number, meals: readonly repo.StoredMeal[]): GymMealPlanDay {
  const all = totals(meals.flatMap((m) => m.items));
  return {
    day,
    meals: meals.map((m) => ({ mealType: m.mealType, items: m.items, totals: totals(m.items) })),
    planned: { kcal: all.kcalPoint, proteinG: whole(all.proteinG), carbsG: whole(all.carbsG), fatG: whole(all.fatG) },
    version: dayVersion(meals),
  };
}

const summaryOf = (p: repo.StoredGymPlan): GymMealPlanSummary => ({
  id: p.id,
  name: p.name,
  writtenBy: p.writtenBy,
  changedBy: p.changedBy,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
  meals: p.days.reduce((n, meals) => n + meals.length, 0),
});

const planReply = (p: repo.StoredGymPlan): GymMealPlanResponse =>
  gymMealPlanResponseSchema.parse({ ...summaryOf(p), days: p.days.map((meals, at) => dayOf(at + 1, meals)), caution: FOOD_ALLERGY_CAUTION });

async function readPlan(deps: Pick<NutritionDeps, "sql">, gymId: string, planId: string): Promise<repo.StoredGymPlan> {
  const plan = await repo.getPlan(deps.sql, gymId, planId);
  if (plan === null) throw notFound();
  return plan;
}

/** The gym's plans; who each is given to is added by `gymMealPlanGivingService.listGymMealPlans`. */
export async function planSummaries(deps: Pick<NutritionDeps, "sql">, staffId: string, gymId: string, limit: Limit): Promise<GymMealPlanSummary[] | null> {
  await requirePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  return (await repo.listPlans(deps.sql, gymId)).map(summaryOf);
}

export async function getGymMealPlan(deps: Pick<NutritionDeps, "sql">, staffId: string, gymId: string, planId: string, limit: Limit): Promise<GymMealPlanResponse | null> {
  await requirePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  return planReply(await readPlan(deps, gymId, planId));
}

export async function createGymMealPlan(
  deps: Pick<NutritionDeps, "sql">, staffId: string, gymId: string, input: CreateGymMealPlanRequest, limit: Limit,
): Promise<GymMealPlanResponse | null> {
  await requireWritablePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  const made = await repo.createPlan(deps.sql, gymId, staffId, input.id, input.name, GYM_MEAL_PLANS_MOST);
  if (made === "elsewhere") throw notFound();
  if (made === "name_taken") throw new NutritionError(409, "name_taken", GYM_MEAL_PLAN_WORDS.name_taken);
  if (made === "too_many") throw new NutritionError(409, "too_many", GYM_MEAL_PLAN_WORDS.too_many);
  return planReply(await readPlan(deps, gymId, input.id));
}

export async function renameGymMealPlan(
  deps: Pick<NutritionDeps, "sql">, staffId: string, gymId: string, planId: string, input: RenameGymMealPlanRequest, limit: Limit,
): Promise<GymMealPlanResponse | null> {
  await requireWritablePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  const done = await repo.renamePlan(deps.sql, gymId, planId, staffId, input.name);
  if (done === "name_taken") throw new NutritionError(409, "name_taken", GYM_MEAL_PLAN_WORDS.name_taken);
  if (!done) throw notFound();
  return planReply(await readPlan(deps, gymId, planId));
}

export async function deleteGymMealPlan(deps: Pick<NutritionDeps, "sql">, staffId: string, gymId: string, planId: string, limit: Limit): Promise<boolean> {
  await requireWritablePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return false;
  // Deleted already, it is gone either way: a second press is not a fault.
  await repo.deletePlan(deps.sql, gymId, planId);
  return true;
}

/** The foods of the lists, priced as a person's own plan prices them: only a food a search already
 *  returned, never one searched for by its name. A food on somebody's own scanned label is theirs
 *  alone, and a packaged one that cannot be priced on a day to come cannot go in a plan. */
async function pricedFoods(deps: NutritionDeps, staffId: string, lists: readonly (readonly ChosenItem[])[]): Promise<MealItem[][]> {
  for (const c of lists.flat()) {
    if (c.canonical.toLowerCase().startsWith(LABEL_CANONICAL_PREFIX)) throw new NutritionError(400, "label_food", GYM_MEAL_PLAN_WORDS.label_food);
    const held = await pricedForGood(deps, staffId, c.canonical);
    if (!held.ok) throw new NutritionError(400, "not_for_plan", `${held.name ?? "This food"} ${GYM_MEAL_PLAN_WORDS.not_for_plan}`);
  }
  const items = lists.every((l) => l.length === 0) ? [] : await resolveChosenItems(deps, staffId, lists.flat(), false);
  let at = 0;
  return lists.map((l) => {
    const mine = items.slice(at, at + l.length);
    at += l.length;
    return mine;
  });
}

/** A day as the writer sent it, whole. A food already in the day at the same grams keeps the price
 *  it was saved at, as a person's own plan's does. */
export async function putGymMealPlanDay(
  deps: NutritionDeps, staffId: string, gymId: string, planId: string, day: number, input: PutGymMealPlanDayRequest, limit: Limit,
): Promise<GymMealPlanResponse | null> {
  await requireWritablePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  const plan = await readPlan(deps, gymId, planId);
  if (plan.recentChanges.includes(input.changeId)) return planReply(plan);
  const kept = new Map((plan.days[day - 1] ?? []).flatMap((m) => m.items).map((i) => [`${i.canonical}|${String(i.gramsPoint)}`, i]));
  const keptOf = (c: MealChoice): MealItem | undefined => (!isOwnFood(c) && "grams" in c ? kept.get(`${c.canonical}|${String(c.grams)}`) : undefined);
  const toPrice = input.meals.map((m) => m.items.filter((c): c is ChosenItem => !isOwnFood(c) && keptOf(c) === undefined));
  const fresh = await pricedFoods(deps, staffId, toPrice);
  const meals = input.meals.map((m, i) => {
    const priced = fresh[i] ?? [];
    let at = 0;
    const taken = new Set(m.items.flatMap((c) => (isOwnFood(c) ? [] : [c.canonical])));
    return {
      mealType: m.mealType,
      items: m.items.flatMap((c) => {
        const item = isOwnFood(c) ? ownFoodItem(c, taken) : keptOf(c) ?? priced[at++];
        return item === undefined ? [] : [item];
      }),
    };
  });
  const found = await repo.changePlanDays(deps.sql, gymId, planId, staffId, input.changeId, (current) => {
    if (input.version !== undefined && dayVersion(current[day - 1] ?? []) !== input.version) {
      throw new NutritionError(409, "plan_changed", GYM_MEAL_PLAN_WORDS.plan_changed);
    }
    return current.map((old, at) => (at === day - 1 ? meals : old));
  });
  if (!found) throw notFound();
  return planReply(await readPlan(deps, gymId, planId));
}

/** Each food of one meal with its own measures, for its amount to be changed. */
export async function gymMealPlanMeasures(
  deps: NutritionDeps, staffId: string, gymId: string, planId: string, day: number, meal: number, limit: Limit,
): Promise<FoodMeasure[][] | null> {
  await requirePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  const plan = await readPlan(deps, gymId, planId);
  const items = plan.days[day - 1]?.[meal]?.items;
  if (items === undefined) throw new NutritionError(404, "meal_not_found", GYM_MEAL_PLAN_WORDS.plan_changed);
  return await itemsMeasures(deps, staffId, items, false);
}
