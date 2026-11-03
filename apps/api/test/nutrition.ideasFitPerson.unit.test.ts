// Meal ideas that fit the person (ROADMAP 31d-i; spec Part 6 §16.6). The first block is
// the job's worst thing: an idea that tells somebody to eat a food raw or dry that is
// eaten cooked. It reads every suggested food's own name AND its table's name, against
// words from real USDA descriptions the list has never held.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { dietAllows, type Diet, type MealIdea, type MealType } from "@app/shared";
import { foodOf, tableName, tableText } from "./foodDietByTable.js";
import { planDay } from "../src/modules/nutrition/dietPlan.js";
import {
  IDEA_TOLERANCE, MEAL_LAYOUT, MOST_MEAL_ADDED_SUGAR_G, SUGGEST_POOLS, addedSugarAtMost, mealsAhead, proteinAim, regionOf, suggestAfterWorkout, suggestMeals,
  type FoodRegion, type SuggestInput,
} from "../src/modules/nutrition/suggest.js";

const DIETS: readonly Diet[] = ["vegan", "vegetarian", "vegetarian_eggs", "non_vegetarian"];

/** Words a label or a food table uses for a food not yet cooked or not ready to eat. */
const NOT_AS_EATEN = /\b(raw|dry|dried|uncooked|flour|powder|unprepared|dehydrated|mix)\b/i;
/** A name that says the food is cooked beats any other word in it ("cooked, dry heat", "dehydrated, stewed"). */
const COOKED = /\b(cooked|boiled|baked|roasted|grilled|scrambled|hard-boiled|stewed|canned|prepared|fried|steamed)\b/i;
const notAsEaten = (text: string): boolean => !COOKED.test(text) && NOT_AS_EATEN.test(text);

/** Real USDA descriptions (read from the local copy of the table, 2026-11-03) of foods that
 *  are eaten cooked or made up, none of them on our list of suggested foods. */
const OUTSIDE_NOT_AS_EATEN = [
  "Chicken, broilers or fryers, breast, meat only, raw", "Beef, ground, 90% lean meat / 10% fat, raw",
  "Fish, salmon, Atlantic, farmed, raw", "Egg, whole, raw, fresh", "Lentils, raw", "Beans, black, mature seeds, raw",
  "Chickpeas (garbanzo beans, bengal gram), mature seeds, raw", "Rice, white, long-grain, regular, raw, unenriched",
  "Cereals, oats, regular and quick, not fortified, dry", "Quinoa, uncooked", "Pasta, dry, unenriched", "Couscous, dry",
  "Wheat flour, white, all-purpose, unenriched", "Beverages, Protein powder whey based", "Soup, chicken noodle, dry, mix",
  "Potatoes, hash brown, refrigerated, unprepared", "Canadian bacon, unprepared", "Prunes, dehydrated (low-moisture), uncooked",
];
/** Foods eaten as they are: fruit, the salad vegetables, nuts and seeds, and tofu (soy milk
 *  made into curd by cooking), whose table names say "raw" or "dried". */
const EATEN_AS_THEY_ARE = new Set(["Zucchini", "Bell pepper", "Tomato", "Mushrooms", "Tofu (firm)"]);

describe("THE WORST THING: no idea tells anybody to eat a food raw or dry that is eaten cooked", () => {
  it("the check finds every real description of a raw or dry food, and none of our cooked ones", () => {
    for (const text of OUTSIDE_NOT_AS_EATEN) expect(notAsEaten(text), text).toBe(true);
    for (const text of ["Fish, cod, Atlantic, cooked, dry heat", "Oatmeal (cooked)", "Prunes, dehydrated (low-moisture), stewed"]) {
      expect(notAsEaten(text), text).toBe(false);
    }
  });

  it("every food that may be suggested is cooked or ready to eat, by its own name and its table's", () => {
    for (const [role, foods] of Object.entries(SUGGEST_POOLS)) {
      if (role === "fruit" || role === "nuts") continue;
      for (const food of foods) {
        if (EATEN_AS_THEY_ARE.has(food.name)) continue;
        expect(notAsEaten(food.name), `${role}: ${food.name}`).toBe(false);
        expect(notAsEaten(tableName(food)), `${role}: ${food.name} (${tableName(food)})`).toBe(false);
      }
    }
  });

  it("the foods on the list that are not eaten as they are can never be suggested", () => {
    const suggestable = new Set(Object.values(SUGGEST_POOLS).flat().map((f) => f.name));
    for (const name of ["Oats (dry)", "Red lentils (dry)", "Whey protein (powder)", "Tapioca pearls (dry)", "Oysters (raw)"]) {
      expect(suggestable.has(name), name).toBe(false);
    }
  });

  it("oats are always offered with milk, soy milk for a vegan", () => {
    for (const diet of DIETS) {
      for (const idea of sweepIdeas(diet)) {
        const names = idea.items.map((i) => i.name);
        if (!names.includes("Oatmeal (cooked)")) continue;
        const milk = names.filter((n) => n === "Milk (2%)" || n === "Soy milk");
        expect(milk.length, JSON.stringify(names)).toBeGreaterThan(0);
        for (const n of milk) expect(dietAllows(diet, foodOf(idea.items.find((i) => i.name === n)?.canonical ?? "").diet)).toBe(true);
      }
    }
  });
});

const day = (n: number): string => `2026-03-${String(n).padStart(2, "0")}`;
/** A person by weight and the day's protein, as the plan calculator gives it (1.6 g/kg; 2.0 losing weight). */
const PEOPLE = [
  { weightKg: 50, kcal: 1700, proteinG: 80 }, { weightKg: 60, kcal: 2000, proteinG: 96 }, { weightKg: 80, kcal: 2600, proteinG: 128 },
  { weightKg: 100, kcal: 2000, proteinG: 200 }, { weightKg: 100, kcal: 3200, proteinG: 160 }, { weightKg: 120, kcal: 2400, proteinG: 240 },
] as const;
const cent = (v: number): number => Math.round(v * 100) / 100;
const HOURS = [7, 9, 12, 15, 17, 20, 22] as const;

/** Every class of case: 6 people, 4 meal counts, 7 hours, 3 days, with and without a workout. */
function* sweepInputs(diet: Diet): Generator<{ input: SuggestInput; weightKg: number }> {
  for (const p of PEOPLE) {
    for (const mealsPerDay of [2, 3, 4, 6]) {
      for (const hour of HOURS) {
        for (let d = 1; d <= 3; d++) {
          const share = hour < 11 ? 0 : hour < 16 ? 0.35 : 0.7;
          const mealsLogged = Math.round(mealsPerDay * share);
          yield {
            weightKg: p.weightKg,
            input: {
              seed: `person-${String(d)}`, day: day(d), diet, mealsPerDay, kcalTarget: p.kcal, kcalEaten: Math.round(p.kcal * share), mealsLogged,
              hour, afterWorkout: d === 3, protein: { weightKg: p.weightKg, dayTargetG: p.proteinG, eatenG: Math.round(p.proteinG * share) },
            },
          };
        }
      }
    }
  }
}
function* sweepIdeas(diet: Diet): Generator<MealIdea> {
  for (const { input } of sweepInputs(diet)) for (const meal of suggestMeals(input).meals) yield* meal.ideas;
}

describe("protein for this meal, from this person (ISSN 2017; Schoenfeld and Aragon 2018)", () => {
  it("the aim is the meal's share of what is left, never under 0.25 g/kg nor over 0.55 g/kg", () => {
    const cases: [weightKg: number, shareG: number | null, least: number, aim: number, most: number][] = [
      [80, 30, 20, 30, 44], [80, 10, 20, 20, 44], [80, 70, 20, 44, 44], [80, null, 20, 32, 44], [50, 0, 12.5, 12.5, 27.5], [120, 45, 30, 45, 66],
    ];
    for (const [weightKg, share, least, aim, most] of cases) {
      const got = proteinAim(weightKg, share);
      expect([got.leastG, got.aimG, got.mostG].map(cent), `${String(weightKg)} kg, share ${String(share)}`).toEqual([least, aim, most]);
    }
    // After a workout: at least about 0.3 g/kg, with carbohydrate; a snack in the week has no least.
    const after = proteinAim(80, 10, { afterWorkout: true });
    expect([after.leastG, after.aimG, after.mostG].map(cent)).toEqual([20, 24, 44]);
    expect(after.withCarbs).toBe(true);
    expect(proteinAim(80, 5, { snack: true }).leastG).toBe(0);
  });

  it("no more than 1 idea in 100 passes 0.55 g/kg, none by a tenth; calories stay within a fifth of the meal's", () => {
    let n = 0;
    let over = 0;
    for (const diet of DIETS) {
      for (const { input, weightKg } of sweepInputs(diet)) {
        for (const meal of suggestMeals(input).meals) {
          for (const idea of meal.ideas) {
            n++;
            if (idea.totals.proteinG > 0.55 * weightKg + 0.05) over++;
            expect(idea.totals.proteinG, JSON.stringify(input)).toBeLessThanOrEqual(0.55 * weightKg * 1.1);
            expect(Math.abs(idea.totals.kcal - meal.kcalTarget), JSON.stringify(input)).toBeLessThanOrEqual(meal.kcalTarget * IDEA_TOLERANCE);
          }
        }
      }
    }
    expect(over / n).toBeLessThanOrEqual(0.01);
  });

  it("an idea reaches 0.25 g/kg wherever the diet's foods can: every eater of meat, eggs or milk, nearly always", () => {
    // Measured 2026-11-03 over this sweep: 99.4 %, 98.8 %, 99.0 %, 89.9 %. A small vegan meal (fruit and nuts, toast) is where the foods cannot reach it.
    const floor: Readonly<Record<Diet, number>> = { non_vegetarian: 0.99, vegetarian_eggs: 0.98, vegetarian: 0.98, vegan: 0.88 };
    for (const diet of DIETS) {
      let n = 0;
      let met = 0;
      for (const { input, weightKg } of sweepInputs(diet)) {
        for (const idea of suggestMeals(input).meals.flatMap((m) => m.ideas)) {
          n++;
          if (idea.totals.proteinG >= 0.25 * weightKg - 0.05) met++;
        }
      }
      expect(met / n, diet).toBeGreaterThanOrEqual(floor[diet]);
    }
  });

  it("protein already eaten today counts: the more eaten, the less the meals still to come are drawn for", () => {
    const base = { seed: "p", day: day(5), diet: "non_vegetarian" as const, mealsPerDay: 3, kcalTarget: 2400, kcalEaten: 800, mealsLogged: 1, hour: 13 };
    const mean = (eatenG: number): number => {
      const ideas = suggestMeals({ ...base, protein: { weightKg: 80, dayTargetG: 160, eatenG } }).meals.flatMap((m) => m.ideas);
      return ideas.reduce((n, i) => n + i.totals.proteinG, 0) / ideas.length;
    };
    expect(mean(20)).toBeGreaterThan(mean(100));
  });

  it("the person's protein changes the ideas: a 100 kg person losing weight is offered more protein than calories alone give", () => {
    const base = { seed: "p", day: day(5), diet: "vegetarian" as const, mealsPerDay: 3, kcalTarget: 2000, kcalEaten: 0, mealsLogged: 0, hour: 12 };
    const mean = (ideas: readonly MealIdea[]): number => ideas.reduce((n, i) => n + i.totals.proteinG, 0) / ideas.length;
    const without = suggestMeals(base).meals.flatMap((m) => m.ideas);
    const withProtein = suggestMeals({ ...base, protein: { weightKg: 100, dayTargetG: 200, eatenG: 0 } }).meals.flatMap((m) => m.ideas);
    expect(mean(withProtein)).toBeGreaterThan(mean(without) + 5);
  });
});

describe("the meal's time: breakfast foods in the morning, a plate or a dish at lunch and dinner", () => {
  it("the meals still to come follow the hour, the meals logged and the person's own day", () => {
    const cases: [mealsPerDay: number, hour: number, count: number, logged: number, want: MealType[]][] = [
      [3, 8, 3, 0, ["breakfast", "lunch", "dinner"]], [3, 9, 2, 1, ["lunch", "dinner"]], [3, 13, 2, 1, ["lunch", "dinner"]],
      [3, 17, 1, 2, ["dinner"]], [3, 21, 2, 1, ["dinner", "dinner"]], [5, 8, 5, 0, ["breakfast", "snack", "lunch", "snack", "dinner"]],
      [4, 12, 3, 1, ["lunch", "snack", "dinner"]], [2, 8, 2, 0, ["lunch", "dinner"]], [6, 2, 2, 0, ["dinner", "snack"]], [3, 1, 1, 0, ["dinner"]],
    ];
    for (const [mealsPerDay, hour, count, logged, want] of cases) {
      expect(mealsAhead(mealsPerDay, hour, count, logged), `${String(mealsPerDay)} meals at ${String(hour)}:00, ${String(logged)} logged`).toEqual(want);
    }
  });

  it("every hour of every day's layout gives as many meals as asked, and only the layout's meals", () => {
    for (const mealsPerDay of [2, 3, 4, 5, 6]) {
      for (let hour = 0; hour < 24; hour++) {
        for (let count = 1; count <= 6; count++) {
          const got = mealsAhead(mealsPerDay, hour, count, 0);
          expect(got).toHaveLength(count);
          for (const t of got) expect([...(MEAL_LAYOUT[mealsPerDay] ?? []), "dinner"]).toContain(t);
        }
      }
    }
  });

  it("the next meal's ideas: before 11 am with nothing logged, a bowl, toast or eggs whatever its calories; from noon, a plate or a dish", () => {
    // The next meal by the clock alone, from this test's own table: a day of two meals has no breakfast.
    let breakfasts = 0;
    for (const diet of DIETS) {
      for (const { input } of sweepInputs(diet)) {
        const first = suggestMeals(input).meals[0];
        if (first === undefined) continue;
        const hour = input.hour ?? 0;
        for (const idea of first.ideas) {
          if (hour < 11 && input.mealsLogged === 0 && input.mealsPerDay >= 3) {
            breakfasts++;
            expect(idea.kind, JSON.stringify(input)).toBe("light");
          } else if (hour >= 12 && first.kcalTarget >= 300) expect(idea.kind, JSON.stringify(input)).not.toBe("light");
        }
      }
    }
    expect(breakfasts).toBeGreaterThan(0);
  });
});

describe("the meal after a workout (Thomas, Erdman and Burke 2016)", () => {
  it("within two hours, the next meal's ideas hold about 0.3 g/kg of protein with carbohydrate wherever the foods reach it", () => {
    let n = 0;
    let met = 0;
    for (const diet of DIETS) {
      for (const { input, weightKg } of sweepInputs(diet)) {
        if (input.afterWorkout !== true) continue;
        for (const idea of suggestMeals(input).meals[0]?.ideas ?? []) {
          n++;
          if (idea.totals.proteinG >= 0.25 * weightKg - 0.05 && idea.totals.carbsG >= idea.totals.proteinG) met++;
        }
      }
    }
    expect(met / n).toBeGreaterThanOrEqual(0.85);
  });

  it("the meal 34d-ii offers after a workout is drawn by the same rule", () => {
    for (const diet of DIETS) {
      const ideas = suggestAfterWorkout({ seed: "w", diet, kcalBurned: 450, day: null, weightKg: 80 });
      const meal = ideas.find((i) => i.when === "meal");
      expect(meal, diet).toBeDefined();
      expect(meal?.idea.totals.proteinG ?? 0, diet).toBeGreaterThanOrEqual(20);
      expect(meal?.idea.totals.carbsG ?? 0, diet).toBeGreaterThanOrEqual(meal?.idea.totals.proteinG ?? Infinity);
    }
  });
});

describe("sugar: one meal holds no more than 10 g of added sugars (Dietary Guidelines 2025–2030, p. 4)", () => {
  it("the count reads a sauced dish's sugars, and fruit and plain milk as none", () => {
    const soup = SUGGEST_POOLS.dish.find((f) => f.name === "Tomato soup");
    const apple = SUGGEST_POOLS.fruit.find((f) => f.name === "Apple");
    expect(addedSugarAtMost([{ canonical: soup?.canonical ?? "", grams: 400 }])).toBeGreaterThan(MOST_MEAL_ADDED_SUGAR_G);
    expect(addedSugarAtMost([{ canonical: apple?.canonical ?? "", grams: 150 }])).toBe(0);
  });

  it("every suggested bread, spread, dish and soy milk is counted at its own USDA sugars; foods with only their own sugars are not", () => {
    const usda = z.object({ foods: z.record(z.string(), z.number().nullable()) }).parse(
      JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "usda-sugars.json"), "utf8")),
    ).foods;
    /** Home dishes cited from the UK's table, with no USDA figure. */
    const COFID = new Set(["Chana masala (chickpea curry)", "Khichdi (rice and mung beans, with ghee)", "Tandoori chicken", "Roti / Chapati (homemade flatbread, no fat)"]);
    const mayHoldAdded = new Set(["bread", "toast", "spread", "dish", "curry_side"]);
    for (const [role, foods] of Object.entries(SUGGEST_POOLS)) {
      for (const food of foods) {
        const counted = addedSugarAtMost([{ canonical: food.canonical, grams: 100 }]);
        const id = /^usda-(?:sr|fndds):(\d+)$/.exec(food.citation)?.[1];
        if (mayHoldAdded.has(role) || food.name === "Soy milk") {
          if (COFID.has(food.name) || id === undefined) {
            expect(COFID.has(food.name), food.name).toBe(true);
            continue;
          }
          if (role === "curry_side" && counted === 0) continue; // rice beside a curry holds its own sugars only
          expect(counted, `${food.name} (${id})`).toBeCloseTo(usda[id] ?? Number.NaN, 2);
        }
      }
    }
  });

  it("no idea of any diet, day or meal holds more", () => {
    for (const diet of DIETS) {
      for (const idea of sweepIdeas(diet)) {
        expect(addedSugarAtMost(idea.items.map((i) => ({ canonical: i.canonical, grams: i.grams })))).toBeLessThanOrEqual(MOST_MEAL_ADDED_SUGAR_G);
      }
    }
  });
});

describe("the app's week is drawn the same way", () => {
  it("a week's breakfasts, lunches and dinners reach 0.25 g/kg as often as the day's ideas; none passes 0.55 g/kg by a tenth", () => {
    for (const diet of ["non_vegetarian", "vegetarian"] as const) {
      let n = 0;
      let met = 0;
      for (const p of PEOPLE) {
        for (let d = 1; d <= 7; d++) {
          for (const meal of planDay({ seed: "w", day: d, diet, mealsPerDay: 4, kcalTarget: p.kcal, protein: { weightKg: p.weightKg, dayTargetG: p.proteinG } })) {
            expect(meal.idea.totals.proteinG).toBeLessThanOrEqual(0.55 * p.weightKg * 1.1);
            if (meal.mealType === "snack") continue;
            n++;
            if (meal.idea.totals.proteinG >= 0.25 * p.weightKg - 0.05) met++;
          }
        }
      }
      expect(met / n, diet).toBeGreaterThanOrEqual(0.95);
    }
  });
});

describe("where the person is (Kd, 2026-11-03): no beef or pork in India, no Indian dishes in the US, Canada, Europe, Australia and New Zealand", () => {
  it("the region is read from the person's real time zone, old names included", () => {
    const cases: [zone: string | null, region: FoodRegion][] = [
      ["Asia/Kolkata", "india"], ["Asia/Calcutta", "india"],
      ["America/New_York", "west"], ["America/Los_Angeles", "west"], ["America/Chicago", "west"], ["America/Toronto", "west"],
      ["America/Vancouver", "west"], ["America/Indiana/Indianapolis", "west"], ["Europe/London", "west"], ["Europe/Berlin", "west"],
      ["Australia/Sydney", "west"], ["Pacific/Auckland", "west"], ["Pacific/Honolulu", "west"],
      ["America/Sao_Paulo", "other"], ["America/Mexico_City", "other"], ["Asia/Dubai", "other"], ["Asia/Singapore", "other"],
      ["Asia/Tokyo", "other"], ["Asia/Karachi", "other"], ["Africa/Lagos", "other"], ["Etc/GMT-14", "other"], ["UTC", "other"], [null, "other"],
    ];
    for (const [zone, region] of cases) expect(regionOf(zone), String(zone)).toBe(region);
  });

  /** Words a food table uses for beef or pork, read from each food's own USDA entry and a dish's ingredients. */
  const BEEF_PORK = /\b(beef|pork|bacon|ham|sausage|chorizo|veal|salami|pepperoni|lard|gelatin)\b/i;
  const INDIAN = /\b(curry|dal|masala|tandoori|sambar|khichdi|roti|chapati)\b/i;

  it("in India, no idea holds a food whose own table says beef or pork; in the West, no Indian dish; elsewhere, nothing taken away", () => {
    for (const diet of DIETS) {
      const seen: Record<FoodRegion, Set<string>> = { india: new Set(), west: new Set(), other: new Set() };
      for (const { input } of sweepInputs(diet)) {
        for (const region of ["india", "west", "other"] as const) {
          const meals = suggestMeals({ ...input, region }).meals;
          for (const meal of meals) {
            expect(meal.ideas.length, `${diet} ${region}`).toBeGreaterThan(0);
            for (const item of meal.ideas.flatMap((i) => i.items)) {
              seen[region].add(item.name);
              const food = foodOf(item.canonical);
              if (region === "india") expect(BEEF_PORK.test(tableText(food)), `${diet} in India: ${item.name}`).toBe(false);
              if (region === "west") expect(INDIAN.test(item.name), `${diet} in the West: ${item.name}`).toBe(false);
            }
          }
          if (region === "other") expect(meals).toEqual(suggestMeals(input).meals);
        }
      }
      // The rule takes only those foods away: a meat eater in the West is still offered meat, and in India Indian dishes.
      if (diet === "non_vegetarian") {
        expect([...seen.west].some((n) => BEEF_PORK.test(n) || n.startsWith("Steak"))).toBe(true);
        expect([...seen.india].some((n) => INDIAN.test(n))).toBe(true);
      }
    }
  });

  it("the week and the meal after a workout keep to the same rule", () => {
    for (let d = 1; d <= 7; d++) {
      for (const meal of planDay({ seed: "r", day: d, diet: "non_vegetarian", mealsPerDay: 4, kcalTarget: 2600, region: "india", protein: { weightKg: 80, dayTargetG: 128 } })) {
        for (const item of meal.idea.items) expect(BEEF_PORK.test(tableText(foodOf(item.canonical))), item.name).toBe(false);
      }
      for (const meal of planDay({ seed: "r", day: d, diet: "vegetarian", mealsPerDay: 4, kcalTarget: 2600, region: "west" })) {
        for (const item of meal.idea.items) expect(INDIAN.test(item.name), item.name).toBe(false);
      }
    }
    for (let w = 0; w < 30; w++) {
      for (const { idea } of suggestAfterWorkout({ seed: `w${String(w)}`, diet: "non_vegetarian", kcalBurned: 450, day: null, weightKg: 80, region: "india" })) {
        for (const item of idea.items) expect(BEEF_PORK.test(tableText(foodOf(item.canonical))), item.name).toBe(false);
      }
    }
  });
});
