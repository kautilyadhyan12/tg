import {
  amountWords,
  mealTypeAtHour,
  type MealIdea,
  type MealType,
  type SuggestedFood,
  type WaitingMeal,
} from "@app/shared";

// The server's meal ideas (ROADMAP Stage 5 34d-i), as the phone shows and logs them.

/** A food of an idea as a line: "Rice 1 cup · 200 g". An idea is saved by weight, so the saved meal
 *  reads the same grams. A food served by weight has only its grams. */
export function ideaFoodWords(food: SuggestedFood): string {
  const amount = amountWords(food);
  const grams = `${String(Math.round(food.grams))} g`;
  return amount === grams ? `${food.name} ${grams}` : `${food.name} ${amount} · ${grams}`;
}

/** The meal an idea is logged to, by the hour. Never Snack: the server does not count a snack as a
 *  meal eaten, so it would go on suggesting the meal just logged. */
export function ideaMealType(hour: number): MealType {
  const type = mealTypeAtHour(hour);
  return type === "snack" ? "dinner" : type;
}

/** An idea's name on the day's list: its foods, within what a meal's name may hold. */
export function ideaName(idea: Pick<MealIdea, "items">): string {
  return idea.items.map((f) => f.name).join(" + ").slice(0, 200);
}

/** What the outbox keeps for an idea logged: by canonical and grams, the way the server priced it, and
 *  with the idea's own totals, so the rings count it while it waits to be sent. */
export function ideaAsMeal(idea: MealIdea, id: string, type: MealType, now: Date): WaitingMeal {
  const { kcal, proteinG, carbsG, fatG } = idea.totals;
  return {
    id,
    body: {
      id,
      mealName: ideaName(idea),
      takenAt: now.toISOString(),
      mealType: type,
      items: idea.items.map((f) => ({ canonical: f.canonical, grams: f.grams })),
    },
    items: null,
    totals: { kcalPoint: kcal, kcalLow: kcal, kcalHigh: kcal, proteinG, carbsG, fatG },
    tried: false,
  };
}
