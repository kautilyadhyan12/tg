import { describe, expect, it } from "vitest";
import { mealTypeAtHour } from "../src/nutrition.js";

// The meal an hour of the day is, for a meal with none of its own (Kd, 2026-10-30): every hour.
describe("the meal an hour of the day is", () => {
  it("is breakfast from 4 am, lunch from 11, a snack from 4 pm, dinner from 7 pm to midnight, and a snack after it", () => {
    const want: Record<number, string> = {};
    for (let h = 0; h < 24; h++) want[h] = h < 4 ? "snack" : h < 11 ? "breakfast" : h < 16 ? "lunch" : h < 19 ? "snack" : "dinner";
    expect(Object.fromEntries(Array.from({ length: 24 }, (_, h) => [h, mealTypeAtHour(h)]))).toEqual(want);
    // The edges, named.
    expect([3, 4, 10, 11, 15, 16, 18, 19, 22, 23].map(mealTypeAtHour)).toEqual([
      "snack", "breakfast", "breakfast", "lunch", "lunch", "snack", "snack", "dinner", "dinner", "dinner",
    ]);
  });
});
