import { ownFoodItemSchema, type OwnFoodItem } from "@app/shared";

// The person's own food as typed (ROADMAP Stage 5 33b-i): what is sent, or what is still missing.

const TOO_HEAVY = "Protein, carbs and fat together can’t weigh more than the food itself.";

/** What the form holds, as typed. */
export interface Typed {
  name: string;
  grams: string;
  proteinG: string;
  carbsG: string;
  fatG: string;
}

const number = (text: string): number | null => {
  const t = text.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** The food as it is sent, or why it cannot be yet. A box left empty is none of that. */
export function ownFoodOf(typed: Typed): { food: OwnFoodItem } | { missing: string } {
  const grams = number(typed.grams);
  const figures = { proteinG: number(typed.proteinG) ?? 0, carbsG: number(typed.carbsG) ?? 0, fatG: number(typed.fatG) ?? 0 };
  if (typed.name.trim() === "") return { missing: "Enter the food’s name." };
  if (grams === null || grams <= 0) return { missing: "Enter how many grams you ate." };
  // A food with no numbers typed is not a food of 0 kcal: 0 is typed where a food has none.
  if ([typed.proteinG, typed.carbsG, typed.fatG].every((t) => t.trim() === "")) return { missing: "Enter its protein, carbs and fat (0 where it has none)." };
  if (figures.proteinG + figures.carbsG + figures.fatG > grams) return { missing: TOO_HEAVY };
  const parsed = ownFoodItemSchema.safeParse({ name: typed.name.trim(), grams, own: figures });
  return parsed.success ? { food: parsed.data } : { missing: "Check the numbers: each is grams, 0 or more." };
}
