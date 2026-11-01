import { describe, expect, it } from "vitest";
import { dailyAmountsFor, dailyAmountsResponseSchema, type DailyAmount, type Gender } from "../src/index.js";

// Copied from the published tables, not from the code: Health Canada's "Dietary reference intakes
// tables" (elements, vitamins, macronutrients) and the US FDA's Daily Values.
// age, fibre g, calcium, iron, magnesium, potassium mg, vitamin D ug
const TABLE: readonly (readonly [Gender, number, number, number, number, number, number, number, string])[] = [
  ["male", 18, 38, 1300, 11, 410, 3000, 15, "men aged 18"],
  ["male", 19, 38, 1000, 8, 400, 3400, 15, "men aged 19 to 30"],
  ["male", 30, 38, 1000, 8, 400, 3400, 15, "men aged 19 to 30"],
  ["male", 31, 38, 1000, 8, 420, 3400, 15, "men aged 31 to 50"],
  ["male", 50, 38, 1000, 8, 420, 3400, 15, "men aged 31 to 50"],
  ["male", 51, 30, 1000, 8, 420, 3400, 15, "men aged 51 to 70"],
  ["male", 70, 30, 1000, 8, 420, 3400, 15, "men aged 51 to 70"],
  ["male", 71, 30, 1200, 8, 420, 3400, 20, "men aged 71 and over"],
  ["female", 18, 26, 1300, 15, 360, 2300, 15, "women aged 18"],
  ["female", 19, 25, 1000, 18, 310, 2600, 15, "women aged 19 to 30"],
  ["female", 30, 25, 1000, 18, 310, 2600, 15, "women aged 19 to 30"],
  ["female", 31, 25, 1000, 18, 320, 2600, 15, "women aged 31 to 50"],
  ["female", 50, 25, 1000, 18, 320, 2600, 15, "women aged 31 to 50"],
  ["female", 51, 21, 1200, 8, 320, 2600, 15, "women aged 51 to 70"],
  ["female", 70, 21, 1200, 8, 320, 2600, 15, "women aged 51 to 70"],
  ["female", 71, 21, 1200, 8, 320, 2600, 20, "women aged 71 and over"],
];
const about = (amount: number): DailyAmount => ({ kind: "about", amount });
const most = (amount: number): DailyAmount => ({ kind: "most", amount });

describe("the daily amount a person is shown", () => {
  it("a woman of 30 reads 18 mg of iron, never a man's 8 mg", () => {
    expect(dailyAmountsFor(30, "female").amounts.ironMg).toEqual(about(18));
    expect(dailyAmountsFor(30, "male").amounts.ironMg).toEqual(about(8));
  });

  it.each(TABLE)("%s %i", (gender, age, fibre, calcium, iron, magnesium, potassium, vitaminD, forWhom) => {
    const got = dailyAmountsFor(age, gender);
    expect(dailyAmountsResponseSchema.parse(got)).toEqual({
      forWhom,
      amounts: {
        fiberG: about(fibre), sugarsG: null, satFatG: most(20), unsatFatG: null, sodiumMg: most(2300),
        potassiumMg: about(potassium), calciumMg: about(calcium), ironMg: about(iron), magnesiumMg: about(magnesium), vitaminDUg: about(vitaminD),
      },
    });
  });

  it.each<[number | null, Gender | null]>([
    [30, "other"], [30, "prefer_not_to_say"], [30, null], [null, "female"], [null, "male"], [null, null], [Number.NaN, "female"],
  ])("age %s, gender %s reads the labels' Daily Values, never a guessed row", (age, gender) => {
    expect(dailyAmountsFor(age, gender)).toEqual({
      forWhom: null,
      amounts: {
        fiberG: about(28), sugarsG: null, satFatG: most(20), unsatFatG: null, sodiumMg: most(2300),
        potassiumMg: about(4700), calciumMg: about(1300), ironMg: about(18), magnesiumMg: about(420), vitaminDUg: about(20),
      },
    });
  });

  it("an age kept from before the app was 18 and over reads the 14 to 18 row", () => {
    expect(dailyAmountsFor(16, "female").amounts.ironMg).toEqual(about(15));
  });

  it("the two with no published amount have none, for anybody", () => {
    for (const [gender, age] of TABLE.map((r) => [r[0], r[1]] as const)) {
      const { amounts } = dailyAmountsFor(age, gender);
      expect([amounts.sugarsG, amounts.unsatFatG]).toEqual([null, null]);
    }
  });
});
