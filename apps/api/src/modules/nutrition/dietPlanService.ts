// A person's own diet plan (ROADMAP 34e-i; RULINGS 2026-09-12): a week, Monday to
// Sunday, that repeats until they change it. The app makes it from the meal ideas'
// own rule, sized to the rings' calories, so the rules that hold a calorie cut hold
// here; the person swaps a meal, puts in their own foods, changes an amount, adds or
// removes a meal. Every food is priced as a logged meal's is, so a planned meal logs
// at the numbers the plan shows. Each change carries the phone's own id: sent twice,
// it is made once.
import { createHash } from "node:crypto";
import {
  DIET_LABEL_CAUTION, FOOD_ALLERGY_CAUTION, GYM_MEAL_PLAN_GIVING_WORDS, dietAllows, dietPlanResponseSchema, isOwnFood,
  type LowestKcal, type MyGymMealPlansResponse, type ChosenItem, type FoodMeasure, type PutFoodChoiceRequest, type MealChoice, type DietPlanDayReply, type DietPlanMake, type DietPlanResponse, type MakeDietPlanRequest,
  type Diet, type MealIdea, type MealItem, type PutDietPlanDayRequest, type SwapDietPlanMealRequest,
} from "@app/shared";
import { getUserFoodAnswers, getUserPlanAndCutRules, getUserSyncContext } from "../users/service.js";
import { planDay, slotProtein, swapMeal } from "./dietPlan.js";
import { regionOf, type FoodRegion } from "./suggest.js";
import { CURATED_FOODS } from "./foods.js";
import { changeDietPlan, getDietPlan as readDietPlan, hasAMeal, setFoodChoice, type Picked, type StoredDays, type StoredMeal } from "./dietPlanRepo.js";
import { liveGymsOf } from "./gymMealPlanAudienceRepo.js";
import { gymPlansOf, myGymMealPlans } from "./gymMealPlanGivingService.js";
import { dayUnder, lowestKcalOf } from "./targets.js";
import { NutritionError, getTargets, targetsForPlan, itemsMeasures, ownFoodItem, pricedForGood, resolveChosenItems, totals, type NutritionDeps } from "./service.js";

type Targets = NonNullable<Awaited<ReturnType<typeof getTargets>>["targets"]>;
interface Person { make: DietPlanMake; diet: Awaited<ReturnType<typeof getUserFoodAnswers>>["diet"]; mealsPerDay: number | null; targets: Targets | null; weightKg: number | null; region: FoodRegion; lowest: LowestKcal }

async function person(deps: Pick<NutritionDeps, "sql">, userId: string): Promise<Person> {
  const [{ diet, mealsPerDay }, read, ctx] = await Promise.all([
    getUserFoodAnswers(deps.sql, userId), getUserPlanAndCutRules(deps.sql, userId, null), getUserSyncContext(deps.sql, userId),
  ]);
  const { targets, targetWrongSide } = await targetsForPlan(deps, userId, read);
  const missing = [...(diet === null ? ["diet" as const] : []), ...(mealsPerDay === null ? ["mealsPerDay" as const] : [])];
  const make: DietPlanMake = missing.length > 0
    ? { status: "needs_answers", missing }
    : targets === null ? { status: "needs_plan", reason: targetWrongSide ? "new_goal" : "setup" } : { status: "ok" };
  return {
    make, diet, mealsPerDay, targets, weightKg: read.answers.weightKg ?? null, region: regionOf(ctx.timezone),
    lowest: lowestKcalOf(read.plan.plan, read.noCutReasons),
  };
}

const whole = (n: number): number => Math.round(n);

const DIET_OF: ReadonlyMap<string, Diet> = new Map(CURATED_FOODS.map((f) => [f.canonical, f.diet]));
/** The foods of the list the diet does not eat. */
const outsideDiet = (items: readonly MealItem[], diet: Diet | null): string[] =>
  diet === null ? [] : items.flatMap((i) => {
    const its = i.nutritionSource === "curated" ? DIET_OF.get(i.canonical) : undefined;
    return its === undefined || dietAllows(diet, its) ? [] : [i.name];
  });

function dayReply(day: number, meals: readonly StoredMeal[], who: Person): DietPlanDayReply {
  const { targets } = who;
  const withTotals = meals.map((m) => ({ mealType: m.mealType, items: m.items, totals: totals(m.items), outsideDiet: outsideDiet(m.items, who.diet) }));
  const all = totals(meals.flatMap((m) => m.items));
  const planned = { kcal: all.kcalPoint, proteinG: whole(all.proteinG), carbsG: whole(all.carbsG), fatG: whole(all.fatG) };
  const target = targets === null ? null : { kcal: targets.kcal, proteinG: targets.proteinG, carbsG: targets.carbsG, fatG: targets.fatG };
  const off = target === null ? null : {
    kcal: planned.kcal - target.kcal, proteinG: planned.proteinG - target.proteinG,
    carbsG: planned.carbsG - target.carbsG, fatG: planned.fatG - target.fatG,
  };
  return { day, meals: withTotals, planned, target, off, under: dayUnder(planned.kcal, meals.length, who.lowest), version: dayVersion(meals) };
}

/** JSON with every object's keys in one order, so the same day always reads the same. */
const steady = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(steady).join(",")}]`
    : value !== null && typeof value === "object"
      ? `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${JSON.stringify(k)}:${steady(v)}`).join(",")}}`
      : JSON.stringify(value);

/** A day's version: every food, amount and number of its meals, in order. */
export const dayVersion = (meals: readonly StoredMeal[]): string => createHash("sha256").update(steady(meals)).digest("hex").slice(0, 16);

const changedSince = (current: readonly StoredMeal[] | undefined, version: string | undefined): boolean =>
  version !== undefined && dayVersion(current ?? []) !== version;

/** The gyms a person is a member of, as the choice needs them: their ids, and the gym whose plan was
 *  given them last (null where none gave one). */
export interface GymsForChoice { live: readonly string[]; newestGiven: string | null }

/** What Recommended For You shows for food (spec Part 6 §16.6): the person's pick, unless it names a
 *  gym they are no longer a member of; else the plan a gym gave them, the newest given; else their
 *  own plan where their week has a meal; else the app's ideas. */
export function foodChoiceOf(picked: Picked | null, days: StoredDays, gyms: GymsForChoice): Picked {
  if (picked !== null && (picked.choice !== "gym" || (picked.gymId !== null && gyms.live.includes(picked.gymId)))) return picked;
  if (gyms.newestGiven !== null) return { choice: "gym", gymId: gyms.newestGiven };
  return { choice: hasAMeal(days) ? "mine" : "suggested", gymId: null };
}

/** Which gyms count for the choice. The gyms' plans are read only where the pick does not settle it. */
async function gymsForChoice(deps: Pick<NutritionDeps, "sql">, userId: string, picked: Picked | null): Promise<GymsForChoice> {
  const live = (await liveGymsOf(deps.sql, userId)).map((g) => g.gymId);
  const settled = picked !== null && (picked.choice !== "gym" || (picked.gymId !== null && live.includes(picked.gymId)));
  if (settled || live.length === 0) return { live, newestGiven: null };
  const given = (await gymPlansOf(deps, userId)).flatMap(({ gym, plan }) => (plan === null ? [] : [{ gymId: gym.gymId, at: plan.givenAt }]));
  given.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return { live, newestGiven: given[0]?.gymId ?? null };
}

async function reply(deps: Pick<NutritionDeps, "sql">, userId: string, days: StoredDays, picked: Picked | null, who: Person): Promise<DietPlanResponse> {
  const shown = foodChoiceOf(picked, days, await gymsForChoice(deps, userId, picked));
  return dietPlanResponseSchema.parse({
    days: days.map((meals, at) => dayReply(at + 1, meals, who)),
    make: who.make,
    choice: shown.choice,
    choiceGymId: shown.choice === "gym" ? shown.gymId : null,
    caution: FOOD_ALLERGY_CAUTION,
    labelCaution: who.diet === "non_vegetarian" ? null : DIET_LABEL_CAUTION,
  });
}

export async function getDietPlan(deps: Pick<NutritionDeps, "sql">, userId: string): Promise<DietPlanResponse> {
  const [plan, who] = await Promise.all([readDietPlan(deps.sql, userId), person(deps, userId)]);
  return await reply(deps, userId, plan.days, plan.choice, who);
}

/** The person picks what Recommended For You shows for food (31f; the gym's plan since 31g): the plan
 *  as it stands, with the pick. A gym is only one the person is a live member of, whether or not it
 *  gave them a plan: "hasn't given you a meal plan" is the phone's to say. */
export async function putFoodChoice(deps: Pick<NutritionDeps, "sql">, userId: string, input: PutFoodChoiceRequest): Promise<DietPlanResponse> {
  if (input.choice === "gym") {
    const live = await liveGymsOf(deps.sql, userId);
    if (!live.some((g) => g.gymId === input.gymId)) throw new NutritionError(404, "not_member", GYM_MEAL_PLAN_GIVING_WORDS.not_member);
    await setFoodChoice(deps.sql, userId, { choice: "gym", gymId: input.gymId });
  } else {
    await setFoodChoice(deps.sql, userId, { choice: input.choice, gymId: null });
  }
  return await getDietPlan(deps, userId);
}

/** The phone's gyms and their plans, each day against the least this person may eat (31g). */
export async function getMyGymMealPlans(deps: Pick<NutritionDeps, "sql">, userId: string): Promise<MyGymMealPlansResponse> {
  const read = await getUserPlanAndCutRules(deps.sql, userId, null);
  return await myGymMealPlans(deps, userId, lowestKcalOf(read.plan.plan, read.noCutReasons));
}

/** Each list of chosen foods priced, in one pass, as a logged meal's are. */
async function priced(deps: NutritionDeps, userId: string, lists: readonly (readonly ChosenItem[])[]): Promise<MealItem[][]> {
  const items = lists.every((list) => list.length === 0) ? [] : await resolveChosenItems(deps, userId, lists.flat(), false);
  let at = 0;
  return lists.map((list) => {
    const mine = items.slice(at, at + list.length);
    at += list.length;
    return mine;
  });
}

const chosenOf = (idea: MealIdea): ChosenItem[] => idea.items.map((i) => ({ canonical: i.canonical, grams: i.grams }));

/** Meals that, priced, are still under the calories they must hold (a day past what
 *  MOST_PLAN_MEALS meals hold, or a swapped meal): every amount made bigger by the gap,
 *  and priced again, until they are not. A plan never offers less than the day's calories. */
async function heldToTarget(
  deps: NutritionDeps,
  userId: string,
  meals: readonly { idea: MealIdea }[],
  items: MealItem[][],
  kcalTarget: number,
): Promise<MealItem[][]> {
  let lists = meals.map((m) => chosenOf(m.idea));
  for (let round = 0; round < 3; round++) {
    const kcal = totals(items.flat()).kcalPoint;
    if (kcal >= kcalTarget || kcal === 0) return items;
    const grow = kcalTarget / kcal;
    lists = lists.map((list) => list.map((i) => ("grams" in i ? { canonical: i.canonical, grams: Math.ceil(i.grams * grow) } : i)));
    items = await priced(deps, userId, lists);
  }
  return items;
}

const refusal = (make: Exclude<DietPlanMake, { status: "ok" }>): NutritionError =>
  make.status === "needs_answers"
    ? new NutritionError(409, "needs_answers", "Answer the food questions in setup to get a meal plan.")
    : new NutritionError(409, "needs_plan", make.reason === "new_goal" ? "Set a new goal to get a meal plan." : "Finish setup to get a meal plan.");

/** The app's plan, for the whole week or the days named; it replaces what they held. */
export async function makeDietPlan(deps: NutritionDeps, userId: string, input: MakeDietPlanRequest): Promise<DietPlanResponse> {
  const [plan, who] = await Promise.all([readDietPlan(deps.sql, userId), person(deps, userId)]);
  // Sent again (its reply was lost): the plan as it stands, whatever the answers are now.
  if (plan.recentChanges.includes(input.changeId)) return await reply(deps, userId, plan.days, plan.choice, who);
  if (who.make.status !== "ok") throw refusal(who.make);
  const { diet, mealsPerDay, targets } = who;
  if (diet === null || mealsPerDay === null || targets === null) throw refusal({ status: "needs_plan", reason: "setup" });
  const days = input.days ?? [1, 2, 3, 4, 5, 6, 7];
  const made = days.map((day) => planDay({
    seed: `${userId}|make|${input.changeId}`, day, diet, mealsPerDay, kcalTarget: targets.kcal, region: who.region,
    ...(who.weightKg === null ? {} : { protein: { weightKg: who.weightKg, dayTargetG: targets.proteinG } }),
  }));
  const items = await priced(deps, userId, made.flatMap((meals) => meals.map((m) => chosenOf(m.idea))));
  let at = 0;
  const byDay = await Promise.all(made.map((meals) => {
    const own = items.slice(at, (at += meals.length));
    return heldToTarget(deps, userId, meals, own, targets.kcal);
  }));
  const week = await changeDietPlan(deps.sql, userId, input.changeId, (current) => {
    const next = current.map((meals) => [...meals]);
    days.forEach((day, i) => {
      const own = byDay[i] ?? [];
      next[day - 1] = (made[i] ?? []).map((m, j) => ({ mealType: m.mealType, items: own[j] ?? [] }));
    });
    return next;
  });
  return await reply(deps, userId, week.days, week.choice, who);
}

/** A day as the person sent it, whole. Their own foods need no setup answer. A food
 *  already in the day at the same amount keeps the price it was saved at: a packaged
 *  product is remembered for a day only, and a change to another meal must not lose it. */
export async function putDietPlanDay(
  deps: NutritionDeps,
  userId: string,
  day: number,
  input: PutDietPlanDayRequest,
): Promise<DietPlanResponse> {
  const plan = await readDietPlan(deps.sql, userId);
  if (plan.recentChanges.includes(input.changeId)) return await reply(deps, userId, plan.days, plan.choice, await person(deps, userId));
  const kept = new Map((plan.days[day - 1] ?? []).flatMap((m) => m.items).map((i) => [`${i.canonical}|${String(i.gramsPoint)}`, i]));
  const keptOf = (c: MealChoice): MealItem | undefined => (!isOwnFood(c) && "grams" in c ? kept.get(`${c.canonical}|${String(c.grams)}`) : undefined);
  const toPrice = input.meals.map((m) => m.items.filter((c): c is ChosenItem => !isOwnFood(c) && keptOf(c) === undefined));
  // A plan is for days to come: a food it could not price again on one of them is not put in it.
  for (const c of toPrice.flat()) {
    const held = await pricedForGood(deps, userId, c.canonical);
    if (!held.ok) {
      const what = held.name === null ? "This food" : held.name;
      throw new NutritionError(400, "not_for_plan", `${what} can’t go in a meal plan. Take it off, then save. You can still log it to a meal.`);
    }
  }
  const fresh = await priced(deps, userId, toPrice);
  const meals = input.meals.map((m, i) => {
    const priced = fresh[i] ?? [];
    let at = 0;
    // A person's own food is priced by its own numbers, under a name of its own in the meal, as a logged meal's is.
    const taken = new Set(m.items.flatMap((c) => (isOwnFood(c) ? [] : [c.canonical])));
    return {
      mealType: m.mealType,
      items: m.items.flatMap((c) => {
        const item = isOwnFood(c) ? ownFoodItem(c, taken) : keptOf(c) ?? priced[at++];
        return item === undefined ? [] : [item];
      }),
    };
  });
  const week = await changeDietPlan(deps.sql, userId, input.changeId, (current) => {
    if (changedSince(current[day - 1], input.version)) {
      throw new NutritionError(409, "plan_changed", "Your plan has changed. Open it again to make this change.");
    }
    return current.map((old, at) => (at === day - 1 ? meals : old));
  });
  return await reply(deps, userId, week.days, week.choice, await person(deps, userId));
}

/** Each food of one meal of the plan with its own measures, for its amount to be changed. */
export async function planMealMeasures(deps: NutritionDeps, userId: string, day: number, meal: number): Promise<FoodMeasure[][] | null> {
  const plan = await readDietPlan(deps.sql, userId);
  const items = plan.days[day - 1]?.[meal]?.items;
  return items === undefined ? null : await itemsMeasures(deps, userId, items, false);
}

const sameMeal = (a: StoredMeal | undefined, b: StoredMeal): boolean => a !== undefined && JSON.stringify(a) === JSON.stringify(b);

/** Another idea for one meal of a day, near its calories and of the person's diet. */
export async function swapDietPlanMeal(
  deps: NutritionDeps,
  userId: string,
  day: number,
  input: SwapDietPlanMealRequest,
): Promise<DietPlanResponse> {
  const [plan, who] = await Promise.all([readDietPlan(deps.sql, userId), person(deps, userId)]);
  if (plan.recentChanges.includes(input.changeId)) return await reply(deps, userId, plan.days, plan.choice, who);
  const meal = plan.days[day - 1]?.[input.meal];
  if (meal === undefined) throw new NutritionError(404, "not_found", "Meal not found.");
  if (changedSince(plan.days[day - 1], input.version)) {
    throw new NutritionError(409, "plan_changed", "Your plan has changed. Open it again to swap this meal.");
  }
  if (who.diet === null) throw refusal({ status: "needs_answers", missing: ["diet"] });
  const idea = swapMeal({
    seed: `${userId}|swap|${input.changeId}`, diet: who.diet, mealType: meal.mealType,
    kcal: totals(meal.items).kcalPoint, foods: meal.items.map((i) => i.canonical), region: who.region,
    ...(who.weightKg === null || who.targets === null ? {} : {
      protein: slotProtein({ weightKg: who.weightKg, dayTargetG: who.targets.proteinG }, meal.mealType, totals(meal.items).kcalPoint, who.targets.kcal),
    }),
  });
  if (idea === null) throw new NutritionError(409, "no_other_meal", "No other meal of this size fits your diet.");
  const swapped = await priced(deps, userId, [chosenOf(idea)]);
  // The swap never takes the day under its calories, nor further under them than it was.
  const dayKcal = totals((plan.days[day - 1] ?? []).flatMap((m) => m.items)).kcalPoint;
  const mealKcal = totals(meal.items).kcalPoint;
  const least = who.targets === null ? 0 : Math.min(dayKcal, who.targets.kcal) - (dayKcal - mealKcal);
  const [items = []] = least > 0 ? await heldToTarget(deps, userId, [{ idea }], swapped, least) : swapped;
  const week = await changeDietPlan(deps.sql, userId, input.changeId, (current) => {
    const meals = current[day - 1] ?? [];
    // Changed since it was read (another change came first): the idea was made for a meal that is gone.
    if (!sameMeal(meals[input.meal], meal) || changedSince(meals, input.version)) throw new NutritionError(409, "plan_changed", "Your plan has changed. Open it again to swap this meal.");
    return current.map((old, at) => (at === day - 1 ? old.map((m, i) => (i === input.meal ? { mealType: m.mealType, items } : m)) : old));
  });
  return await reply(deps, userId, week.days, week.choice, who);
}
