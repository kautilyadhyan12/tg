// A person's own diet plan (ROADMAP 34e-i): the rule that makes the week and swaps a
// meal. The first block is the job's worst thing: a vegan's or vegetarian's plan holding
// meat, fish, egg or milk, made or swapped; and a day made under the person's calories
// (under 18 the app may not cut them at all). It reads every planned food's own TABLE
// words (`foodDietByTable.ts`), never our names or our labels alone.
import { describe, expect, it } from "vitest";
import { MOST_PLAN_MEALS, dietAllows, mealIdeaSchema, type Diet, type MealType } from "@app/shared";
import { planDay, planSlots, swapMeal, type PlanDayInput } from "../src/modules/nutrition/dietPlan.js";
import { LEAST_MEAL_KCAL, MOST_LIGHT_KCAL, MOST_MEALS, MOST_MEAL_KCAL } from "../src/modules/nutrition/suggest.js";
import { foodOf, tableLowest } from "./foodDietByTable.js";

const DIETS: readonly Diet[] = ["vegan", "vegetarian", "vegetarian_eggs", "non_vegetarian"];
const TARGETS = [1200, 1400, 1600, 1800, 2000, 2200, 2400, 2600, 2800, 3000, 3200, 3400] as const;
const MEAL_COUNTS = [2, 3, 4, 5, 6] as const;
const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

const input = (over: Partial<PlanDayInput> = {}): PlanDayInput => ({
  seed: "person-1|make|change-1", day: 1, diet: "non_vegetarian", mealsPerDay: 3, kcalTarget: 2000, ...over,
});

/** Every day of the sweep: 3 makings, 7 days, 12 day sizes, 5 meal counts. */
function* sweep(diet: Diet): Generator<PlanDayInput> {
  for (let making = 0; making < 3; making++) {
    for (const day of DAYS) {
      for (const kcalTarget of TARGETS) {
        for (const mealsPerDay of MEAL_COUNTS) {
          yield input({ seed: `person-${String(making)}|make|change-${String(making)}`, day, diet, mealsPerDay, kcalTarget });
        }
      }
    }
  }
}

const wrongFor = (diet: Diet, canonicals: Iterable<string>): string[] =>
  [...new Set(canonicals)].map(foodOf)
    .filter((f) => !dietAllows(diet, f.diet) || !dietAllows(diet, tableLowest(f)))
    .map((f) => `${f.name} (${f.diet}; its table: ${tableLowest(f)})`);

describe("THE WORST THING: no plan holds a food the person's diet does not eat, or less than they may eat", () => {
  it.each(DIETS.filter((d) => d !== "non_vegetarian"))("a %s person's week, as the app makes it", (diet) => {
    const planned: string[] = [];
    let meals = 0;
    for (const one of sweep(diet)) {
      for (const meal of planDay(one)) {
        meals++;
        planned.push(...meal.idea.items.map((i) => i.canonical));
      }
    }
    expect(meals).toBeGreaterThan(4000);
    expect(wrongFor(diet, planned)).toEqual([]);
  });

  it.each(DIETS.filter((d) => d !== "non_vegetarian"))("a %s person's meal, swapped again and again", (diet) => {
    const planned: string[] = [];
    let swaps = 0;
    for (const one of sweep(diet)) {
      for (const [at, meal] of planDay(one).entries()) {
        let foods = meal.idea.items.map((i) => i.canonical);
        for (let s = 0; s < 3; s++) {
          const idea = swapMeal({ seed: `${one.seed}|${String(one.day)}|${String(at)}|${String(s)}`, diet, mealType: meal.mealType, kcal: meal.idea.totals.kcal, foods });
          if (idea === null) continue;
          swaps++;
          foods = idea.items.map((i) => i.canonical);
          planned.push(...foods);
        }
      }
    }
    expect(swaps).toBeGreaterThan(10000);
    expect(wrongFor(diet, planned)).toEqual([]);
  });

  // The rule draws each day over its calories where it can; a day it leaves under them
  // is made up by the server, which makes the amounts bigger (the route tests).
  it.each(DIETS)("a %s person: from 1,200 to 3,400 kcal, few days are under the calories, and none by more than 10 %", (diet) => {
    let days = 0;
    let under = 0;
    const far: string[] = [];
    for (let kcalTarget = 1200; kcalTarget <= 3400; kcalTarget += 50) {
      for (const mealsPerDay of MEAL_COUNTS) {
        for (const day of DAYS) {
          const meals = planDay(input({ seed: `p|make|${String(kcalTarget)}`, day, diet, mealsPerDay, kcalTarget }));
          const kcal = meals.reduce((n, m) => n + m.idea.totals.kcal, 0);
          days++;
          if (kcal < kcalTarget) under++;
          if (kcal < kcalTarget * 0.9 || meals.length > MOST_PLAN_MEALS) far.push(`${String(mealsPerDay)} meals, ${String(kcalTarget)} kcal, day ${String(day)}: ${String(kcal)} in ${String(meals.length)} meals`);
        }
      }
    }
    expect(far).toEqual([]);
    // Measured 2026-10-14: a vegan's 19.7 % (a vegan plate is smaller), the others under 10 %.
    expect(under / days).toBeLessThan(diet === "vegan" ? 0.25 : 0.1);
  });
});

describe("the meals of a day and their calories", () => {
  const LAYOUT: Readonly<Record<number, readonly MealType[]>> = {
    2: ["lunch", "dinner"],
    3: ["breakfast", "lunch", "dinner"],
    4: ["breakfast", "lunch", "snack", "dinner"],
    5: ["breakfast", "snack", "lunch", "snack", "dinner"],
    6: ["breakfast", "snack", "lunch", "snack", "dinner", "snack"],
  };
  const most = (t: MealType): number => (t === "breakfast" || t === "snack" ? MOST_LIGHT_KCAL : MOST_MEAL_KCAL);
  /** What six meals can hold at most: three light ones and three plates, or two plates. */
  const roomOf = (mealsPerDay: number): number => {
    const types = [...(LAYOUT[mealsPerDay] ?? []), ...Array.from({ length: MOST_MEALS - mealsPerDay }, (): MealType => "snack")];
    return types.reduce((n, t) => n + most(t), 0);
  };

  it.each(MEAL_COUNTS.flatMap((m) => TARGETS.map((t) => [m, t] as const)))("%i meals, %i kcal: the person's meals in order, then snacks; every meal within its bounds; the day whole", (mealsPerDay, kcalTarget) => {
    const slots = planSlots(mealsPerDay, kcalTarget);
    expect(slots.slice(0, mealsPerDay).map((s) => s.mealType)).toEqual(LAYOUT[mealsPerDay]);
    expect(slots.slice(mealsPerDay).every((s) => s.mealType === "snack")).toBe(true);
    expect(slots.length).toBeLessThanOrEqual(MOST_MEALS);
    for (const slot of slots) {
      expect(slot.kcal).toBeGreaterThanOrEqual(LEAST_MEAL_KCAL);
      expect(slot.kcal).toBeLessThanOrEqual(most(slot.mealType));
    }
    const sum = slots.reduce((n, s) => n + s.kcal, 0);
    // Rounding each meal moves the day by under a calorie a meal.
    if (kcalTarget <= roomOf(mealsPerDay)) expect(Math.abs(sum - kcalTarget)).toBeLessThanOrEqual(slots.length);
    else expect(sum).toBe(roomOf(mealsPerDay));
  });

  it("adds a snack only where the person's own meals cannot hold the day", () => {
    expect(planSlots(3, 1800).length).toBe(3);
    expect(planSlots(2, 1400).length).toBe(2); // two plates of 700
    expect(planSlots(2, 1600).map((s) => s.mealType)).toEqual(["lunch", "dinner", "snack"]);
    expect(planSlots(3, 2700).length).toBe(5);
  });

  it("for every calorie number from 1,000 to 4,000, a snack is added only when the meals so far cannot hold the day", () => {
    const wrong: string[] = [];
    for (const mealsPerDay of MEAL_COUNTS) {
      for (let kcalTarget = 1000; kcalTarget <= 4000; kcalTarget++) {
        const own = LAYOUT[mealsPerDay] ?? [];
        let count = own.length;
        let room = own.reduce((n, t) => n + most(t), 0);
        // A day within half a calorie a meal of its room is held, as the rule rounds each meal.
        while (room < kcalTarget - count / 2 && count < MOST_MEALS) {
          count++;
          room += MOST_LIGHT_KCAL;
        }
        const got = planSlots(mealsPerDay, kcalTarget).length;
        if (got !== count) wrong.push(`${String(mealsPerDay)} meals, ${String(kcalTarget)} kcal: ${String(got)} meals, not ${String(count)}`);
      }
    }
    expect(wrong.slice(0, 10)).toEqual([]);
  });

  it("a day past what six meals can hold is left short, never past a meal's bounds", () => {
    const slots = planSlots(3, 4500);
    expect(slots.length).toBe(MOST_MEALS);
    expect(slots.reduce((n, s) => n + s.kcal, 0)).toBe(roomOf(3));
  });

  it("breakfast is lighter than lunch and dinner; a snack lighter than breakfast", () => {
    const [breakfast, snack1, lunch, , dinner] = planSlots(5, 2000);
    expect(breakfast?.kcal).toBeLessThan(lunch?.kcal ?? 0);
    expect(snack1?.kcal).toBeLessThan(breakfast?.kcal ?? 0);
    expect(lunch?.kcal).toBe(dinner?.kcal);
  });
});

describe("the day the app makes", () => {
  it("is near the day's calories for every diet, size and meal count: within 10 %, the rings' own number", () => {
    const far: string[] = [];
    for (const diet of DIETS) {
      for (const one of sweep(diet)) {
        const got = planDay(one).reduce((n, m) => n + m.idea.totals.kcal, 0);
        if (Math.abs(got - one.kcalTarget) > one.kcalTarget * 0.1) far.push(`${diet} ${String(one.mealsPerDay)} meals ${String(one.kcalTarget)} kcal day ${String(one.day)}: ${String(got)}`);
      }
    }
    expect(far).toEqual([]);
  });

  it("every meal is an idea of the meal ideas' own shape, and a meal of each of the day's meals", () => {
    for (const mealsPerDay of MEAL_COUNTS) {
      const day = planDay(input({ mealsPerDay }));
      expect(day.map((m) => m.mealType)).toEqual(planSlots(mealsPerDay, 2000).map((s) => s.mealType));
      for (const meal of day) expect(mealIdeaSchema.safeParse(meal.idea).success).toBe(true);
    }
  });

  it("breakfast and snacks are a bowl, toast or fruit; lunch and dinner a plate or a dish", () => {
    for (const day of DAYS) {
      for (const meal of planDay(input({ day, mealsPerDay: 5, kcalTarget: 2000 }))) {
        if (meal.mealType === "breakfast" || meal.mealType === "snack") expect(meal.idea.kind).toBe("light");
        else expect(["plate", "dish"]).toContain(meal.idea.kind);
      }
    }
  });

  it("the same making gives the same week; another making, or another person, another one", () => {
    const week = (seed: string) => DAYS.map((day) => planDay(input({ seed, day })));
    expect(week("person-1|make|a")).toEqual(week("person-1|make|a"));
    expect(week("person-1|make|b")).not.toEqual(week("person-1|make|a"));
    expect(week("person-2|make|a")).not.toEqual(week("person-1|make|a"));
  });

  it("the days of one week are not all the same", () => {
    const days = DAYS.map((day) => JSON.stringify(planDay(input({ day }))));
    expect(new Set(days).size).toBe(7);
  });
});

describe("swapping a meal", () => {
  it("gives other foods, of the same kind, near the meal's calories", () => {
    for (const diet of DIETS) {
      for (const day of DAYS) {
        for (const [at, meal] of planDay(input({ diet, day, mealsPerDay: 4 })).entries()) {
          const foods = meal.idea.items.map((i) => i.canonical);
          const idea = swapMeal({ seed: `s|${String(day)}|${String(at)}`, diet, mealType: meal.mealType, kcal: meal.idea.totals.kcal, foods });
          expect(idea, `${diet} day ${String(day)} meal ${String(at)}`).not.toBeNull();
          if (idea === null) continue;
          expect([...idea.items.map((i) => i.canonical)].sort()).not.toEqual([...foods].sort());
          expect(Math.abs(idea.totals.kcal - meal.idea.totals.kcal)).toBeLessThanOrEqual(meal.idea.totals.kcal * 0.2 + 1);
          if (meal.mealType === "breakfast" || meal.mealType === "snack") expect(idea.kind).toBe("light");
          else expect(["plate", "dish"]).toContain(idea.kind);
        }
      }
    }
  });

  it("a meal the person made huge or tiny is swapped for one within a meal's bounds", () => {
    const big = swapMeal({ seed: "s", diet: "vegan", mealType: "dinner", kcal: 2500, foods: [] });
    expect(big?.totals.kcal).toBeLessThanOrEqual(MOST_MEAL_KCAL * 1.04 * 1.2); // sized 4 % over, as every planned meal
    const small = swapMeal({ seed: "s", diet: "vegan", mealType: "snack", kcal: 20, foods: [] });
    expect(small?.totals.kcal).toBeGreaterThanOrEqual(LEAST_MEAL_KCAL * 0.8);
  });

  it("the same swap gives the same meal", () => {
    const one = { seed: "s|1", diet: "vegetarian" as const, mealType: "lunch" as const, kcal: 600, foods: [] };
    expect(swapMeal(one)).toEqual(swapMeal(one));
  });
});
