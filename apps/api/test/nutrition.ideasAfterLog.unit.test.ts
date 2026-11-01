import { describe, expect, it } from "vitest";
import { suggestMeals } from "../src/modules/nutrition/suggest.js";

const seedOf = (person: number, meals: number) => `person-${String(person)}:${String(meals)}`;
const foods = (idea: { items: { canonical: string }[] }) => idea.items.map((f) => f.canonical).sort().join("+");

describe("what to eat next, once an idea is logged", () => {
  it("rarely offers again what was just logged, for every diet", () => {
    let tried = 0;
    let again = 0;
    for (const diet of ["vegan", "vegetarian", "vegetarian_eggs", "non_vegetarian"] as const) {
      for (let person = 0; person < 500; person += 1) {
        const day = "2026-11-02";
        const base = { day, diet, mealsPerDay: 4, kcalTarget: 2000 };
        const first = suggestMeals({ ...base, seed: seedOf(person, 0), kcalEaten: 0, mealsLogged: 0 });
        const logged = first.meals[0]?.ideas[person % 3];
        if (logged === undefined) continue;
        const next = suggestMeals({ ...base, seed: seedOf(person, 1), kcalEaten: logged.totals.kcal, mealsLogged: 1 });
        tried += 1;
        if (next.meals[0]?.ideas.some((idea) => foods(idea) === foods(logged)) === true) again += 1;
      }
    }
    expect(tried).toBeGreaterThan(0);
    expect(again / tried).toBeLessThan(0.05);
  });
});
