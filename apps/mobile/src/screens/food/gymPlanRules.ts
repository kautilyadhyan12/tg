import type { DietPlanMeal, LowestKcal, MyGymMealPlan, MyGymMealPlansResponse } from "@app/shared";
import { count } from "../dashboard/words";

// The plan a gym gave the person, as the phone draws it (ROADMAP Stage 5 31g; spec Part 6 §16.6): as
// the gym wrote it, with who wrote it, never changed on the phone.

export type GymOfMine = MyGymMealPlansResponse["gyms"][number];

/** Who wrote it: "By Sam". The plan's own name stands alone for a writer whose account is gone. */
export const writtenByLine = (plan: Pick<MyGymMealPlan, "name" | "writtenBy">): string =>
  plan.writtenBy === null ? plan.name : `${plan.name} · By ${plan.writtenBy}`;

export const noGymPlanLine = (gymName: string): string => `${gymName} hasn’t given you a meal plan.`;

/** The one line beside a day under the least this person may eat (RULINGS 2026-09-07). */
export function underLine(under: LowestKcal | null): string | null {
  if (under === null) return null;
  return under.why === "floor"
    ? `This day is under ${count(under.kcal)} kcal, the least we plan for anyone.`
    : `This day is under ${count(under.kcal)} kcal, what keeps your weight. With your health answers, eat at least that.`;
}

/** A gym's meal as the plan's screens draw a meal: it is never checked against the person's diet. */
export const gymMeal = (meal: MyGymMealPlan["days"][number]["meals"][number]): DietPlanMeal => ({ ...meal, outsideDiet: [] });

/** The email to the gym, already about the meal plan. */
export const mealPlanEmail = (href: string): string => (href.startsWith("mailto:") ? `${href}?subject=${encodeURIComponent("Meal plan")}` : href);
