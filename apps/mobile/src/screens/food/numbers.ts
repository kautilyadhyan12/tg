import type { OwnNutritionTargets, OwnTargetsHeld } from "@app/shared";
import { count } from "../dashboard/words";

// The words and sums of the rings' own numbers (ROADMAP 32b-ii-b), apart from the box (OwnNumbers.tsx)
// so they can be tested on their own. The server decides every number; these only say it.

type Four = OwnNutritionTargets;

/** A typed number as a whole number of zero or more, or null. */
export function wholeNumber(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,6}$/.test(t)) return null;
  return Number(t);
}

/** What protein, carbs and fat come to in calories: said, never made to match. */
export const macroKcal = (v: Pick<Four, "proteinG" | "carbsG" | "fatG">): number => v.proteinG * 4 + v.carbsG * 4 + v.fatG * 9;

/** The four numbers in one line. */
export const fourWords = (v: Four): string =>
  `${count(v.kcal)} kcal · Protein ${count(v.proteinG)} g · Carbs ${count(v.carbsG)} g · Fat ${count(v.fatG)} g`;

/** Why the person's own numbers cannot be used today, in their words, naming the number that holds
 *  them; null when nothing holds them. Every line is true whether or not they were picked. */
export function holdWords(held: OwnTargetsHeld | null): string | null {
  if (held === null) return null;
  switch (held.code) {
    case "below_floor":
      return `Your own calories can’t be used below the app’s lowest of ${count(held.floorKcal)} kcal a day.`;
    case "no_cut_below_maintenance":
      return `Your plan holds no calorie cut now, so your own calories can’t be used below ${count(held.maintenanceKcal)} kcal a day, what keeps your weight.`;
    case "plan_incomplete":
      return "Your own numbers are kept. Answer the setup questions to use them.";
  }
}

