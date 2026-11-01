// Meal ideas (ROADMAP 34d-i): the rule that picks them. The first block is the
// job's worst thing: a food with meat, fish, egg or milk in it offered to somebody
// who does not eat it. It reads every suggested food's own TABLE words (the three
// fixtures `tools/check-food-sources.ts` holds to the downloads), never our names
// or our labels alone.
import { describe, expect, it } from "vitest";
import { DIET_LADDER, dietAllows, mealIdeaSchema, type Diet, type MealIdea } from "@app/shared";
import { CURATED_FOODS } from "../src/modules/nutrition/foods.js";
import { foodOf, lowestByWords, tableLowest } from "./foodDietByTable.js";
import {
  IDEA_TOLERANCE, LEAST_MEAL_KCAL, MOST_IDEA_GRAMS, MOST_MEALS, MOST_MEAL_KCAL, SUGGEST_POOLS, kindsFor, mealSizes, suggestAfterWorkout, suggestMeals,
  type AfterWorkoutInput, type DayNumbers, type SuggestInput,
} from "../src/modules/nutrition/suggest.js";

const DIETS: readonly Diet[] = ["vegan", "vegetarian", "vegetarian_eggs", "non_vegetarian"];
const day = (n: number): string => `2026-03-${String(n).padStart(2, "0")}`;
const input = (over: Partial<SuggestInput> = {}): SuggestInput => ({
  seed: "person-1", day: day(11), diet: "non_vegetarian", mealsPerDay: 3, kcalTarget: 2000, kcalEaten: 0, mealsLogged: 0, ...over,
});
const ideasOf = (over: Partial<SuggestInput>): MealIdea[] => suggestMeals(input(over)).meals.flatMap((m) => m.ideas);

/** Every case of the sweep: 28 days, 5 people, 6 day sizes, 4 meal counts, 4 points in the day. */
function* sweep(diet: Diet): Generator<SuggestInput> {
  for (let d = 1; d <= 28; d++) {
    for (const kcalTarget of [1200, 1500, 1800, 2200, 2800, 3500]) {
      for (const mealsPerDay of [2, 3, 4, 6]) {
        for (const eaten of [0, 0.3, 0.6, 0.9]) {
          yield input({ seed: `person-${String(d % 5)}`, day: day(d), diet, mealsPerDay, kcalTarget, kcalEaten: Math.round(kcalTarget * eaten), mealsLogged: Math.round(mealsPerDay * eaten) });
        }
      }
    }
  }
}

const dayOf = (over: Partial<DayNumbers> = {}): DayNumbers => ({ mealsPerDay: 3, kcalTarget: 2000, kcalEaten: 0, mealsLogged: 0, ...over });
const after = (over: Partial<AfterWorkoutInput> = {}): AfterWorkoutInput => ({ seed: "person-1|workout-1", diet: "non_vegetarian", kcalBurned: 300, day: dayOf(), ...over });

/** Every case of the workout sweep: 60 workouts, 6 burns, a day with no calorie
 *  number and 6 day sizes at 4 points in the day. */
function* workoutSweep(diet: Diet): Generator<AfterWorkoutInput> {
  for (let w = 0; w < 60; w++) {
    for (const kcalBurned of [null, 0, 150, 201, 401, 900]) {
      const seed = `person-${String(w % 7)}|workout-${String(w)}`;
      yield after({ seed, diet, kcalBurned, day: null });
      for (const kcalTarget of [1200, 1500, 1800, 2200, 2800, 3500]) {
        for (const eaten of [0, 0.3, 0.6, 0.9]) {
          const mealsPerDay = [2, 3, 4, 6][w % 4] ?? 3;
          yield after({ seed, diet, kcalBurned, day: dayOf({ mealsPerDay, kcalTarget, kcalEaten: Math.round(kcalTarget * eaten), mealsLogged: Math.round(mealsPerDay * eaten) }) });
        }
      }
    }
  }
}

describe("THE WORST THING: nobody is offered a food their diet does not eat", () => {
  it.each(DIETS.filter((d) => d !== "non_vegetarian"))("a %s person: no idea after any workout holds a food their diet rules out", (diet) => {
    const offered = new Set<string>();
    let ideas = 0;
    for (const one of workoutSweep(diet)) {
      for (const { idea } of suggestAfterWorkout(one)) {
        ideas++;
        for (const item of idea.items) offered.add(item.canonical);
      }
    }
    expect(ideas).toBeGreaterThan(5000);
    const wrong = [...offered].map(foodOf)
      .filter((f) => !dietAllows(diet, f.diet) || !dietAllows(diet, tableLowest(f)))
      .map((f) => `${f.name} (${f.diet}; its table: ${tableLowest(f)})`);
    expect(wrong).toEqual([]);
  });

  it("reads an animal food in a table's words, the ones no suggested food has among them", () => {
    expect(lowestByWords(["Soup, ham and bean"], ["Soups, Sauces, and Gravies"])).toBe("non_vegetarian");
    expect(lowestByWords(["Bread, naan", "Egg, whole, raw"], ["Baked Products", "Baked Products"])).toBe("vegetarian_eggs");
    expect(lowestByWords(["Rice with ghee"], [])).toBe("vegetarian");
    expect(lowestByWords(["Kimchi", "Sauce, fish, ready-to-serve"], ["Vegetables and Vegetable Products"])).toBe("non_vegetarian");
    expect(lowestByWords(["Jelly", "Gelatins, dry powder"], ["Sweets"])).toBe("non_vegetarian");
    expect(lowestByWords(["Soup, vegetable, made with chicken broth"], [])).toBe("non_vegetarian");
    expect(lowestByWords(["Peanut butter, smooth", "Squash, butternut"], ["Legumes and Legume Products"])).toBe("vegan");
    expect(lowestByWords(["Cheddar"], ["Dairy and Egg Products"])).toBe("vegetarian");
    expect(lowestByWords(["Pea and pancetta risotto, homemade"], [])).toBe("non_vegetarian");
    expect(lowestByWords(["Taramasalata", "cod roe"], [])).toBe("non_vegetarian");
  });

  it("every food that may be suggested is labelled no lower than its own table's words put it", () => {
    const wrong = Object.values(SUGGEST_POOLS).flat()
      .filter((f) => DIET_LADDER[f.diet] < DIET_LADDER[tableLowest(f)])
      .map((f) => `${f.name}: labelled ${f.diet}, its table says ${tableLowest(f)}`);
    expect(wrong).toEqual([]);
  });

  it.each(DIETS.filter((d) => d !== "non_vegetarian"))("a %s person: no idea, on any day, holds a food their diet rules out", (diet) => {
    const offered = new Set<string>();
    let ideas = 0;
    for (const one of sweep(diet)) {
      for (const idea of suggestMeals(one).meals.flatMap((m) => m.ideas)) {
        ideas++;
        for (const item of idea.items) offered.add(item.canonical);
      }
    }
    expect(ideas).toBeGreaterThan(5000);
    const wrong = [...offered].map(foodOf)
      .filter((f) => !dietAllows(diet, f.diet) || !dietAllows(diet, tableLowest(f)))
      .map((f) => `${f.name} (${f.diet}; its table: ${tableLowest(f)})`);
    expect(wrong).toEqual([]);
  });

  it("every diet has foods for every part of a meal", () => {
    for (const diet of DIETS) {
      for (const [role, pool] of Object.entries(SUGGEST_POOLS)) {
        expect(pool.filter((f) => dietAllows(diet, f.diet)).length, `${diet} ${role}`).toBeGreaterThanOrEqual(2);
      }
    }
  });
});

describe("what is suggested", () => {
  it("only the foods of the pools, and never fried food, sweets, fast food, alcohol or a sugary drink", () => {
    const pool = new Set(Object.values(SUGGEST_POOLS).flat().map((f) => f.canonical));
    const never = [
      "Bacon (cooked)", "Fried chicken", "Chicken nuggets", "Hot dog", "Hamburger (fast food)", "Cheeseburger", "Pizza (pepperoni)",
      "French fries", "Potato chips", "Donut (glazed)", "Ice cream (vanilla)", "Milk chocolate", "Chocolate cake", "Cheesecake",
      "Coke / cola", "Energy drink", "Beer (regular)", "Wine (red)", "Spirits (vodka, gin, rum, whiskey)", "Sugar (white)",
      "Salami", "Pepperoni", "Corn dog", "Churros",
    ];
    for (const name of never) {
      const food = CURATED_FOODS.find((f) => f.name === name);
      expect(food, name).toBeDefined();
      expect(pool.has(food?.canonical ?? ""), name).toBe(false);
    }
    for (const diet of DIETS) {
      for (const one of sweep(diet)) {
        for (const idea of suggestMeals(one).meals.flatMap((m) => m.ideas)) {
          for (const item of idea.items) expect(pool.has(item.canonical), item.name).toBe(true);
        }
      }
    }
  });

  it("a non-vegetarian is offered meat and meatless ideas over a month", () => {
    const kinds = new Set<boolean>();
    for (let d = 1; d <= 28; d++) {
      for (const idea of ideasOf({ day: day(d) })) kinds.add(idea.items.some((i) => foodOf(i.canonical).diet === "non_vegetarian"));
    }
    expect([...kinds].sort()).toEqual([false, true]);
  });

  it("the same person on the same day gets the same ideas, and other ones the next day and beside another person", () => {
    const today = suggestMeals(input());
    expect(suggestMeals(input())).toEqual(today);
    expect(suggestMeals(input({ day: day(12) }))).not.toEqual(today);
    expect(suggestMeals(input({ seed: "person-2" }))).not.toEqual(today);
  });

  it.each(DIETS)("a %s person: no idea twice in one reply, and no food twice in one idea", (diet) => {
    for (const one of sweep(diet)) {
      const ideas = suggestMeals(one).meals.flatMap((m) => m.ideas);
      const keys = ideas.map((i) => i.items.map((x) => `${x.canonical}:${String(x.grams)}`).sort().join("|"));
      expect(new Set(keys).size, JSON.stringify(one)).toBe(keys.length);
      for (const idea of ideas) expect(new Set(idea.items.map((x) => x.canonical)).size).toBe(idea.items.length);
    }
  });

  it("no first food twice in a day's nine ideas while the pools hold another", () => {
    const mains = suggestMeals(input()).meals.flatMap((m) => m.ideas).map((i) => i.items[0]?.canonical);
    expect(new Set(mains).size).toBe(mains.length);
  });

  it("bread is beside a soup or a salad or under a spread, never on a plate or beside a curry", () => {
    const sliced = new Set(SUGGEST_POOLS.bread.map((f) => f.canonical));
    const breadDishes = new Set(["Lentil soup", "Chicken noodle soup", "Tomato soup", "Minestrone", "Cobb salad (no dressing)", "Caesar salad (with chicken, no dressing)"]);
    const curries = new Set(["Dal (lentil curry)", "Chana masala (chickpea curry)", "Chicken curry", "Vegetable curry", "Palak paneer (spinach and cheese curry)", "Sambar (lentil and vegetable stew)", "Tandoori chicken"]);
    const curryBeside = new Set(SUGGEST_POOLS.curry_side.map((f) => f.name));
    let withBread = 0;
    let curriesSeen = 0;
    for (const diet of DIETS) {
      for (const one of sweep(diet)) {
        for (const idea of suggestMeals(one).meals.flatMap((m) => m.ideas)) {
          const [first, second] = idea.items;
          if (first === undefined) throw new Error("an idea with no food");
          const hasBread = idea.items.some((i) => sliced.has(i.canonical));
          if (idea.kind === "plate") expect(hasBread, idea.items.map((i) => i.name).join(" + ")).toBe(false);
          if (idea.kind === "dish") {
            expect(idea.items.length).toBe(2);
            expect(hasBread, first.name).toBe(breadDishes.has(first.name));
            if (hasBread) withBread++;
            if (curries.has(first.name)) {
              curriesSeen++;
              expect(curryBeside.has(second?.name ?? ""), `${first.name} + ${second?.name ?? ""}`).toBe(true);
            }
          }
        }
      }
    }
    expect(withBread).toBeGreaterThan(100);
    expect(curriesSeen).toBeGreaterThan(100);
  });
});

describe("the least an idea holds", () => {
  it("no idea is under what counts as a meal, and every meal has an idea, down to the last calories of a day", () => {
    let days = 0;
    for (const diet of ["vegan", "vegetarian", "vegetarian_eggs", "non_vegetarian"] as const) {
      for (let left = LEAST_MEAL_KCAL; left <= 400; left += 5) {
        for (let person = 0; person < 40; person++) {
          const reply = suggestMeals(input({ seed: `person-${String(person)}`, diet, kcalEaten: 2000 - left, mealsLogged: 2 }));
          days++;
          expect(reply.meals.length, `${diet} ${String(left)} ${String(person)}`).toBeGreaterThan(0);
          for (const meal of reply.meals) {
            expect(meal.ideas.length).toBeGreaterThan(0);
            for (const idea of meal.ideas) expect(idea.totals.kcal).toBeGreaterThanOrEqual(LEAST_MEAL_KCAL);
          }
        }
      }
    }
    expect(days).toBeGreaterThan(0);
  });
});

describe("how many meals, and how big: every class of day", () => {
  const cases: readonly (readonly [name: string, over: Partial<SuggestInput>, meals: number, kcalTarget: number | null])[] = [
    ["nothing eaten, three meals a day", {}, 3, 667],
    ["one meal logged", { kcalEaten: 600, mealsLogged: 1 }, 2, 700],
    ["two meals logged", { kcalEaten: 1300, mealsLogged: 2 }, 1, 700],
    ["every meal logged and calories still left: one more", { kcalEaten: 1500, mealsLogged: 3 }, 1, 500],
    ["more meals logged than the answer", { kcalEaten: 1500, mealsLogged: 5 }, 1, 500],
    ["nothing left", { kcalEaten: 2000, mealsLogged: 3 }, 0, null],
    ["over the day's calories", { kcalEaten: 2600, mealsLogged: 3 }, 0, null],
    ["one calorie under the least a meal holds", { kcalEaten: 2000 - LEAST_MEAL_KCAL + 1, mealsLogged: 2 }, 0, null],
    ["exactly the least a meal holds", { kcalEaten: 2000 - LEAST_MEAL_KCAL, mealsLogged: 2 }, 1, LEAST_MEAL_KCAL],
    ["little left for many meals: fewer, none under the least", { mealsPerDay: 6, kcalEaten: 1600, mealsLogged: 1 }, 2, 200],
    ["nothing logged by evening: no meal past one and a half usual ones", { mealsPerDay: 6, kcalTarget: 1800, mealsLogged: 5 }, 3, 450],
    ["a big day in two meals: more meals, none past the most", { mealsPerDay: 2, kcalTarget: 3500 }, 5, 700],
    ["the biggest day: never more than six meals", { mealsPerDay: 2, kcalTarget: 6000 }, MOST_MEALS, MOST_MEAL_KCAL],
  ];
  it.each(cases)("%s", (_name, over, meals, kcalTarget) => {
    const reply = suggestMeals(input(over));
    expect(reply.meals.length).toBe(meals);
    for (const meal of reply.meals) expect(meal.kcalTarget).toBe(kcalTarget);
    expect(reply.kcalLeft).toBe(Math.round(input(over).kcalTarget - input(over).kcalEaten));
  });

  it("a small meal is a light one, and a big one is never a bowl or toast", () => {
    expect(ideasOf({ kcalEaten: 1800, mealsLogged: 2 }).map((i) => i.kind)).toEqual(["light", "light", "light"]);
    expect(ideasOf({ kcalTarget: 2400 }).map((i) => i.kind)).not.toContain("light");
    expect(ideasOf({ kcalTarget: 1200 }).slice(0, 3).map((i) => i.kind)).toEqual(["plate", "dish", "light"]);
    expect(kindsFor(299)).toEqual(["light", "light", "light"]);
    expect(kindsFor(300)).toEqual(["plate", "dish", "light"]);
    expect(kindsFor(450)).toEqual(["plate", "dish", "light"]);
    expect(kindsFor(451)).toEqual(["plate", "dish", "plate"]);
  });

  it.each(DIETS)("a %s person: every meal has its three ideas, each near the meal's calories, at amounts of the food's own serving", (diet) => {
    for (const one of sweep(diet)) {
      const reply = suggestMeals(one);
      expect(reply.meals.length).toBeLessThanOrEqual(MOST_MEALS);
      for (const meal of reply.meals) {
        expect(meal.kcalTarget).toBeGreaterThanOrEqual(LEAST_MEAL_KCAL);
        expect(meal.kcalTarget).toBeLessThanOrEqual(MOST_MEAL_KCAL);
        expect(meal.ideas.length, JSON.stringify(one)).toBe(3);
        const wanted = kindsFor(meal.kcalTarget);
        meal.ideas.forEach((idea, at) => {
          // A plate stands in where no dish or bowl of the diet can be sized to the meal.
          expect([wanted[at], ...(meal.kcalTarget >= 300 ? ["plate"] : [])]).toContain(idea.kind);
        });
        for (const idea of meal.ideas) {
          expect(idea.items.reduce((n, i) => n + i.grams, 0), idea.items.map((i) => i.name).join(" + ")).toBeLessThanOrEqual(MOST_IDEA_GRAMS);
          expect(mealIdeaSchema.safeParse(idea).success).toBe(true);
          expect(Math.abs(idea.totals.kcal - meal.kcalTarget)).toBeLessThanOrEqual(meal.kcalTarget * IDEA_TOLERANCE);
          expect(idea.totals.kcal).toBe(idea.items.reduce((n, i) => n + i.kcal, 0));
          for (const item of idea.items) {
            const food = foodOf(item.canonical);
            // The number a meal logged at these grams would carry.
            expect(item.kcal).toBe(Math.round((food.kcal * item.grams) / 100));
            expect(item.unit).toBe(food.unit);
            expect(item.servings).toBeCloseTo(item.grams / food.serving, 2);
            const step = food.unit === "g" ? 25 : food.unit === "cup" ? food.serving / 2 : food.serving;
            expect((item.grams / step) % 1, `${item.name} ${String(item.grams)} g`).toBeCloseTo(0, 6);
            // One and a half cups, three eggs, two slices or two potatoes at most.
            expect(item.servings, item.name).toBeLessThanOrEqual(food.unit === "g" ? 400 / food.serving : 3);
            if (food.unit === "cup") expect(item.servings).toBeLessThanOrEqual(1.5);
          }
        }
      }
    }
  });
});

describe("after a workout (34d-ii)", () => {
  /** Each idea's calories; a meal sized to what the small idea's own food left is "rest". */
  const sizes = (over: Partial<AfterWorkoutInput>): (readonly [string, number | "rest"])[] => {
    const ideas = suggestAfterWorkout(after(over));
    const day = after(over).day;
    const rest = day === null ? null : mealSizes(day).kcalLeft - (ideas[0]?.idea.totals.kcal ?? 0);
    return ideas.map((i) => [i.when, i.when === "meal" && i.kcalTarget === rest ? "rest" : i.kcalTarget] as const);
  };

  const cases: readonly (readonly [name: string, over: Partial<AfterWorkoutInput>, wanted: readonly (readonly [string, number | "rest"])[]])[] = [
    ["a light workout, nothing eaten: something small, then a usual meal", { kcalBurned: 150 }, [["soon", 150], ["meal", 667]]],
    ["no calories on the workout reads as a light one", { kcalBurned: null }, [["soon", 150], ["meal", 667]]],
    ["exactly 200 burned is still a light one", { kcalBurned: 200 }, [["soon", 150], ["meal", 667]]],
    ["over 200 burned: a bigger small one", { kcalBurned: 201 }, [["soon", 200], ["meal", 667]]],
    ["exactly 400 burned is still the middle", { kcalBurned: 400 }, [["soon", 200], ["meal", 667]]],
    ["over 400 burned: the biggest small one", { kcalBurned: 401 }, [["soon", 250], ["meal", 667]]],
    ["two meals logged, 900 left: the meal is what the day's ideas would size it to", { kcalBurned: 401, day: dayOf({ kcalEaten: 1100, mealsLogged: 2 }) }, [["soon", 250], ["meal", 450]]],
    ["little left: the meal is what is left after the small one", { kcalBurned: 401, day: dayOf({ kcalEaten: 1500, mealsLogged: 3 }) }, [["soon", 250], ["meal", "rest"]]],
    ["less left than a small one and a meal: the small one only", { kcalBurned: 401, day: dayOf({ kcalEaten: 1700, mealsLogged: 3 }) }, [["soon", 250]]],
    ["less left than the small one: it is sized to what is left", { kcalBurned: 401, day: dayOf({ kcalEaten: 1820, mealsLogged: 3 }) }, [["soon", 180]]],
    ["exactly the least a meal holds is left", { day: dayOf({ kcalEaten: 2000 - LEAST_MEAL_KCAL }) }, [["soon", LEAST_MEAL_KCAL]]],
    ["one calorie under the least: nothing", { day: dayOf({ kcalEaten: 2000 - LEAST_MEAL_KCAL + 1 }) }, []],
    ["the day's calories eaten: nothing", { day: dayOf({ kcalEaten: 2000, mealsLogged: 3 }) }, []],
    ["over the day's calories: nothing", { day: dayOf({ kcalEaten: 2600, mealsLogged: 3 }) }, []],
    ["a big day: the meal is never past the most a meal holds", { day: dayOf({ kcalTarget: 3500, mealsPerDay: 2 }) }, [["soon", 200], ["meal", MOST_MEAL_KCAL]]],
    ["no calorie number yet, a light workout", { kcalBurned: 100, day: null }, [["soon", 150], ["meal", 300]]],
    ["no calorie number yet, a middle workout", { kcalBurned: 300, day: null }, [["soon", 200], ["meal", 450]]],
    ["no calorie number yet, a hard workout", { kcalBurned: 600, day: null }, [["soon", 250], ["meal", 600]]],
  ];
  it.each(cases)("%s", (_name, over, wanted) => {
    expect(sizes(over)).toEqual(wanted);
  });

  it("the same workout gets the same ideas, and another workout other ones", () => {
    const first = suggestAfterWorkout(after());
    expect(suggestAfterWorkout(after())).toEqual(first);
    expect(suggestAfterWorkout(after({ seed: "person-1|workout-2" }))).not.toEqual(first);
    const meals = new Set<string>();
    for (let w = 0; w < 30; w++) meals.add(suggestAfterWorkout(after({ seed: `person-1|workout-${String(w)}` })).map((i) => i.idea.items.map((x) => x.name).join("+")).join(" / "));
    expect(meals.size).toBeGreaterThan(25);
  });

  it.each(DIETS)("a %s person: the meal is a plate after some workouts and a dish after others", (diet) => {
    const kinds = new Set<string>();
    for (let w = 0; w < 30; w++) kinds.add(suggestAfterWorkout(after({ diet, seed: `person-1|workout-${String(w)}` }))[1]?.idea.kind ?? "none");
    expect([...kinds].sort()).toEqual(["dish", "plate"]);
  });

  it.each(DIETS)("a %s person: every workout with a meal's calories left has its ideas, each near its calories, never sized past what is left", (diet) => {
    const pool = new Set(Object.values(SUGGEST_POOLS).flat().map((f) => f.canonical));
    for (const one of workoutSweep(diet)) {
      const ideas = suggestAfterWorkout(one);
      const left = one.day === null ? null : mealSizes(one.day).kcalLeft;
      if (left !== null && left < LEAST_MEAL_KCAL) {
        expect(ideas, JSON.stringify(one)).toEqual([]);
        continue;
      }
      expect(ideas[0]?.when, JSON.stringify(one)).toBe("soon");
      expect(ideas[0]?.idea.kind).toBe("light");
      // The meal is there whenever a meal's calories are left after the small one's food.
      expect(ideas.length, JSON.stringify(one)).toBe(left === null || left - (ideas[0]?.idea.totals.kcal ?? 0) >= LEAST_MEAL_KCAL ? 2 : 1);
      // The food itself, not only the sizes, holds no more than the day has left.
      if (left !== null) expect(ideas.reduce((n, i) => n + i.idea.totals.kcal, 0), JSON.stringify(one)).toBeLessThanOrEqual(left);
      const keys = ideas.map((i) => i.idea.items.map((x) => `${x.canonical}:${String(x.grams)}`).sort().join("|"));
      expect(new Set(keys).size).toBe(keys.length);
      for (const { kcalTarget, idea } of ideas) {
        expect(kcalTarget).toBeLessThanOrEqual(MOST_MEAL_KCAL);
        expect(mealIdeaSchema.safeParse(idea).success).toBe(true);
        expect(Math.abs(idea.totals.kcal - kcalTarget)).toBeLessThanOrEqual(kcalTarget * IDEA_TOLERANCE);
        expect(idea.items.reduce((n, i) => n + i.grams, 0)).toBeLessThanOrEqual(MOST_IDEA_GRAMS);
        for (const item of idea.items) {
          expect(pool.has(item.canonical), item.name).toBe(true);
          expect(item.kcal).toBe(Math.round((foodOf(item.canonical).kcal * item.grams) / 100));
        }
      }
    }
  });
});
