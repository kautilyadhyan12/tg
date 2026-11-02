import { describe, expect, it } from "vitest";
import { manualMealRequestSchema, mealIdeaSchema } from "@app/shared";
import { ideaAmountWords, ideaAsMeal, ideaFoodWords, ideaMealType, ideaName } from "../src/screens/food/ideaRules";

const rice = { canonical: "rice_white", name: "Rice", grams: 200, servings: 1, unit: "cup", kcal: 260, proteinG: 5, carbsG: 56, fatG: 1 };
const chicken = { canonical: "chicken_breast", name: "Chicken breast", grams: 150, servings: 1.5, unit: "g", kcal: 248, proteinG: 46, carbsG: 0, fatG: 5 };
const idea = mealIdeaSchema.parse({ kind: "plate", items: [chicken, rice], totals: { kcal: 508, proteinG: 51, carbsG: 56, fatG: 6 } });

describe("the meal an idea is logged to", () => {
  it("is never Snack at any hour: the server would go on suggesting the meal just logged", () => {
    const hours = Array.from({ length: 24 }, (_, h) => ideaMealType(h));
    expect(hours).not.toContain("snack");
    expect(hours[8]).toBe("breakfast");
    expect(hours[13]).toBe("lunch");
    expect(hours[17]).toBe("dinner");
    expect(hours[21]).toBe("dinner");
    expect(hours[2]).toBe("dinner");
  });
});

describe("an idea's words", () => {
  it("gives the grams beside a count, as the saved meal will read", () => {
    expect(ideaFoodWords(rice)).toBe("Rice 1 cup · 200 g");
    expect(ideaFoodWords({ ...rice, servings: 1.5, grams: 300 })).toBe("Rice 1½ cups · 300 g");
  });
  it("gives a food served by weight its grams once", () => {
    expect(ideaFoodWords(chicken)).toBe("Chicken breast 150 g");
    expect(ideaAmountWords(chicken)).toBe("150 g");
    expect(ideaAmountWords(rice)).toBe("1 cup · 200 g");
  });
  it("names the meal by its foods, within what a name may hold", () => {
    expect(ideaName(idea)).toBe("Chicken breast + Rice");
    expect(ideaName({ items: [{ ...rice, name: "x".repeat(300) }] })).toHaveLength(200);
  });
});

describe("what is kept for an idea", () => {
  it("sends each food by canonical and grams in the server's own shape, with the idea's totals held while it waits", () => {
    const at = new Date();
    const id = "6f1c1a52-5a53-4a0e-9d9e-0a5d2b3c4d5e";
    const meal = ideaAsMeal(idea, id, "lunch", at);
    expect(meal.body).toEqual({
      id,
      mealName: "Chicken breast + Rice",
      takenAt: at.toISOString(),
      mealType: "lunch",
      items: [{ canonical: "chicken_breast", grams: 150 }, { canonical: "rice_white", grams: 200 }],
    });
    expect(meal.totals?.kcalPoint).toBe(508);
    expect(manualMealRequestSchema.safeParse(meal.body).success).toBe(true);
  });
});
