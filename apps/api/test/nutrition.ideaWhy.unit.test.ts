// Why, in one line, under each meal idea (ROADMAP 31d-ii; spec Part 6 §16.6, 8). The first block
// is the job's worst thing: a line telling somebody an idea holds their share of protein when it
// does not, or "after your workout" when there was none. Its limits are the papers' own numbers
// (ISSN 2017: 0.25 g/kg a meal; Schoenfeld and Aragon 2018: 0.55 g/kg at most), written here,
// not read from the code.
import { describe, expect, it } from "vitest";
import { FOOD_ALLERGY_CAUTION, IDEA_WHY_WORDS, ideaWhySchema, mealIdeasResponseSchema, type Diet, type IdeaWhy } from "@app/shared";
import { ideaWhy, mealSizes, proteinAim, suggestMeals, type SuggestInput } from "../src/modules/nutrition/suggest.js";

const DIETS: readonly Diet[] = ["vegan", "vegetarian", "vegetarian_eggs", "non_vegetarian"];
const LEAST_PER_KG = 0.25;
const MOST_PER_KG = 0.55;
/** A line that says the idea's protein is right for the meal. */
const MET: ReadonlySet<IdeaWhy> = new Set(["share", "least", "most", "weight", "after_workout"]);

const PEOPLE = [
  { weightKg: 50, kcal: 1700, proteinG: 80 }, { weightKg: 60, kcal: 2000, proteinG: 96 }, { weightKg: 80, kcal: 2600, proteinG: 128 },
  { weightKg: 100, kcal: 2000, proteinG: 200 }, { weightKg: 120, kcal: 2400, proteinG: 240 },
] as const;

/** People, meal counts, hours, a workout or none, the day's protein eaten from none to all of it and past it. */
function* sweep(diet: Diet): Generator<{ input: SuggestInput; weightKg: number; dayTargetG: number | null }> {
  for (const p of PEOPLE) {
    for (const mealsPerDay of [2, 3, 4, 6]) {
      for (const hour of [8, 13, 19]) {
        for (const eatenShare of [0, 0.9, 1.2]) {
          for (const afterWorkout of [false, true]) {
            for (const dayTargetG of [p.proteinG, null]) {
              yield {
                weightKg: p.weightKg, dayTargetG,
                input: {
                  seed: `why-${String(hour)}`, day: "2026-03-04", diet, mealsPerDay, kcalTarget: p.kcal,
                  kcalEaten: Math.round(p.kcal * Math.min(eatenShare, 0.6)), mealsLogged: hour < 11 ? 0 : 1, hour, afterWorkout,
                  protein: { weightKg: p.weightKg, dayTargetG, eatenG: Math.round(p.proteinG * eatenShare) },
                },
              };
            }
          }
        }
      }
    }
  }
}

describe("THE WORST THING: no line says an idea's protein is right when it is not", () => {
  it("every line is true of the idea under it, by the papers' own numbers", () => {
    const seen = new Set<IdeaWhy>();
    let ideas = 0;
    for (const diet of DIETS) {
      for (const { input, weightKg, dayTargetG } of sweep(diet)) {
        const { count } = mealSizes(input);
        const shareG = dayTargetG === null ? null : Math.max(0, dayTargetG - (input.protein?.eatenG ?? 0)) / Math.max(1, count);
        suggestMeals(input).meals.forEach((meal, m) => {
          for (const idea of meal.ideas) {
            ideas++;
            seen.add(idea.why);
            const g = idea.totals.proteinG;
            const what = `${diet} ${String(weightKg)} kg, ${String(input.hour)}h, meal ${String(m)}, ${String(g)} g: ${idea.why}`;
            if (MET.has(idea.why)) {
              expect(g, what).toBeGreaterThanOrEqual(LEAST_PER_KG * weightKg - 0.05);
              expect(g, what).toBeLessThanOrEqual(MOST_PER_KG * weightKg + 0.05);
            }
            // "After your workout" only on the next meal, and only after a workout.
            const afterIt = input.afterWorkout === true && m === 0;
            if (idea.why === "after_workout") expect(afterIt, what).toBe(true);
            if (afterIt && MET.has(idea.why)) expect(idea.why, what).toBe("after_workout");
            if (idea.why === "share") {
              expect(shareG, what).not.toBeNull();
              expect(g, what).toBeGreaterThanOrEqual(0.9 * (shareG ?? 0) - 0.05);
              expect(shareG ?? 0, what).toBeGreaterThanOrEqual(LEAST_PER_KG * weightKg);
              expect(shareG ?? 0, what).toBeLessThanOrEqual(MOST_PER_KG * weightKg);
            }
            if (idea.why === "weight") expect(dayTargetG, what).toBeNull();
            if (idea.why === "least") expect(shareG ?? Infinity, what).toBeLessThan(LEAST_PER_KG * weightKg);
            if (idea.why === "most") expect(shareG ?? 0, what).toBeGreaterThan(MOST_PER_KG * weightKg);
            if (idea.why === "over") expect(g, what).toBeGreaterThan(MOST_PER_KG * weightKg);
          }
        });
      }
    }
    expect(ideas).toBeGreaterThan(1000);
    // The sweep reaches every line a person with a weight can be shown.
    for (const why of ["share", "least", "most", "weight", "after_workout", "under"] as const) expect(seen.has(why), why).toBe(true);
  });

  it("without the person's weight every idea says it was sized to the day, and none speaks of protein", () => {
    for (const diet of DIETS) {
      const meals = suggestMeals({ seed: "w", day: "2026-03-04", diet, mealsPerDay: 3, kcalTarget: 2000, kcalEaten: 0, mealsLogged: 0, hour: 8, afterWorkout: true }).meals;
      expect(meals.length).toBeGreaterThan(0);
      for (const idea of meals.flatMap((m) => m.ideas)) expect(idea.why).toBe("calories");
    }
    expect(IDEA_WHY_WORDS.calories).not.toMatch(/protein/i);
  });
});

describe("the line for each class of case", () => {
  // 80 kg: the least a meal holds is 20 g, the most 44 g, the aim with no day's number 32 g.
  const cases: [what: string, proteinG: number, shareG: number | null, afterWorkout: boolean, why: IdeaWhy][] = [
    ["its share", 30, 30, false, "share"],
    ["just inside a tenth under its share", 27.1, 30, false, "share"],
    ["a tenth under its share and more", 26.5, 30, false, "under"],
    ["today's share under the least, the least met", 21, 10, false, "least"],
    ["today's share under the least, the least missed", 18, 10, false, "under"],
    ["nothing left of today's protein", 20, 0, false, "least"],
    ["today's share over the most, the most met", 43, 70, false, "most"],
    ["over the most", 46, 70, false, "over"],
    ["no protein number for the day", 32, null, false, "weight"],
    ["no protein number, under the aim", 20, null, false, "under"],
    ["after a workout", 25, 30, true, "after_workout"],
    ["after a workout, under the least", 15, 30, true, "under"],
    ["after a workout, over the most", 50, 30, true, "over"],
  ];
  for (const [what, proteinG, shareG, afterWorkout, why] of cases) {
    it(what, () => {
      expect(ideaWhy(proteinG, proteinAim(80, shareG, { afterWorkout }), shareG)).toBe(why);
    });
  }
  it("no aim: calories", () => {
    expect(ideaWhy(40, undefined, null)).toBe("calories");
  });
  it("every reason has its words, and the reply refuses a reason it does not know", () => {
    for (const why of ideaWhySchema.options) expect(IDEA_WHY_WORDS[why].length).toBeGreaterThan(0);
    const idea = { kind: "light", items: [{ canonical: "x", name: "X", grams: 100, servings: 1, unit: "g", kcal: 200, proteinG: 10, carbsG: 20, fatG: 5 }], totals: { kcal: 200, proteinG: 10, carbsG: 20, fatG: 5 } };
    const reply = (why: string) => ({ status: "ok", day: "2026-03-04", kcalLeft: 500, meals: [{ kcalTarget: 500, ideas: [{ ...idea, why }] }], caution: FOOD_ALLERGY_CAUTION, labelCaution: null });
    expect(mealIdeasResponseSchema.safeParse(reply("share")).success).toBe(true);
    expect(mealIdeasResponseSchema.safeParse(reply("because")).success).toBe(false);
    expect(mealIdeasResponseSchema.safeParse({ ...reply("share"), meals: [{ kcalTarget: 500, ideas: [idea] }] }).success).toBe(false);
  });
});
