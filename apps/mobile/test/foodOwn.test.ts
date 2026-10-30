import { describe, expect, it } from "vitest";
import { ownFoodOf } from "../src/screens/food/ownFoodRule";

// A food no list has, as the person types it (33b-i; Kd, 2026-10-30).
describe("the person's own food, as typed", () => {
  const typed = { name: "Chicken taco", grams: "150", proteinG: "18", carbsG: "20", fatG: "9" };
  it("is sent as its name, grams and numbers, a box left empty being 0 where another is typed", () => {
    expect(ownFoodOf(typed)).toEqual({ food: { name: "Chicken taco", grams: 150, own: { proteinG: 18, carbsG: 20, fatG: 9 } } });
    expect(ownFoodOf({ ...typed, carbsG: "", fatG: "" })).toEqual({ food: { name: "Chicken taco", grams: 150, own: { proteinG: 18, carbsG: 0, fatG: 0 } } });
    expect(ownFoodOf({ ...typed, grams: "150,5", name: "  Chicken taco " })).toEqual({ food: { name: "Chicken taco", grams: 150.5, own: { proteinG: 18, carbsG: 20, fatG: 9 } } });
  });
  it.each([
    ["no name", { ...typed, name: " " }, "Enter the food’s name."],
    ["no grams", { ...typed, grams: "" }, "Enter how many grams you ate."],
    ["no numbers at all: never a food of 0 kcal", { ...typed, proteinG: "", carbsG: "", fatG: "" }, "Enter its protein, carbs and fat (0 where it has none)."],
    ["numbers heavier than the food", { ...typed, grams: "40" }, "Protein, carbs and fat together can’t weigh more than the food itself."],
    ["a number that is no number", { ...typed, fatG: "-3" }, "Check the numbers: each is grams, 0 or more."],
  ])("says what is missing: %s", (_, given, words) => {
    expect(ownFoodOf(given)).toEqual({ missing: words });
  });
});
