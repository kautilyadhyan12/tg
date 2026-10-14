// Your week in food (ROADMAP 34f-i): the band rule over every class of case, the days
// of a span, and the week built from the day sums, kept targets and today's.
import { describe, expect, it } from "vitest";
import type { FoodDayTargets } from "@app/shared";
import { bandOf, foodWeek, spanDays, type DayTotals } from "../src/modules/nutrition/foodWeek.js";

describe("bandOf: within 10 % either way is on", () => {
  // [eaten, target, band]: each edge, a hair either side of it, nothing eaten, a zero target.
  const table: [number, number, "under" | "on" | "over"][] = [
    [0, 2000, "under"],
    [1799, 2000, "under"],
    [1800, 2000, "on"], // exactly 90 %
    [2000, 2000, "on"],
    [2200, 2000, "on"], // exactly 110 %
    [2201, 2000, "over"],
    [107.9, 120, "under"], // 89.9 %
    [108, 120, "on"],
    [108.04, 120, "on"], // a figure kept to one decimal reads as its tenth
    [132, 120, "on"],
    [132.1, 120, "over"],
    [29.7, 33, "on"], // 29.7 is 90 % of 33; 29.7 * 10 is not a whole number in floating point
    [36.3, 33, "on"], // 110 % of 33
    [36.4, 33, "over"],
    [0, 0, "on"],
    [0.1, 0, "over"],
    [5000, 1200, "over"],
  ];
  it.each(table)("%s eaten of %s is %s", (eaten, target, band) => {
    expect(bandOf(eaten, target)).toBe(band);
  });
});

describe("spanDays", () => {
  it("is the span ending on today, oldest first", () => {
    expect(spanDays("2026-10-14", 7)).toEqual([
      "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14",
    ]);
  });
  it("crosses a month, a year and a leap day", () => {
    expect(spanDays("2026-03-02", 3)).toEqual(["2026-02-28", "2026-03-01", "2026-03-02"]);
    expect(spanDays("2028-03-01", 2)).toEqual(["2028-02-29", "2028-03-01"]);
    expect(spanDays("2027-01-01", 2)).toEqual(["2026-12-31", "2027-01-01"]);
    const thirty = spanDays("2026-10-14", 30);
    expect(thirty).toHaveLength(30);
    expect(thirty[0]).toBe("2026-09-15");
  });
});

const logged = (day: string, kcal: number, proteinG: number, over: Partial<DayTotals> = {}): DayTotals => ({
  day, meals: 1, kcal, proteinG, carbsG: 200, fatG: 60, about: false,
  fiberG: { amount: 0, notKnown: 1 }, sodiumMg: { amount: 0, notKnown: 1 }, ...over,
});
const TARGETS: FoodDayTargets = { kcal: 2000, proteinG: 120, carbsG: 200, fatG: 60 };
const OLD: FoodDayTargets = { kcal: 2500, proteinG: 150, carbsG: 300, fatG: 80 };

describe("foodWeek", () => {
  it("reads each day against its own kept targets, and the rest against today's", () => {
    const week = foodWeek({
      span: 7, today: "2026-10-14", current: TARGETS,
      kept: new Map([["2026-10-10", OLD], ["2026-10-14", OLD]]),
      logged: [logged("2026-10-10", 2000, 120), logged("2026-10-11", 2000, 120), logged("2026-10-14", 2000, 120)],
    });
    const d10 = week.days.find((d) => d.day === "2026-10-10");
    const d11 = week.days.find((d) => d.day === "2026-10-11");
    const d14 = week.days.find((d) => d.day === "2026-10-14");
    expect(d10?.targets).toEqual(OLD);
    expect(d10?.targetsOfTheDay).toBe(true);
    expect(d10?.bands?.kcal).toBe("under"); // 2,000 of 2,500
    expect(d11?.targets).toEqual(TARGETS);
    expect(d11?.targetsOfTheDay).toBe(false);
    expect(d11?.bands?.kcal).toBe("on");
    // Today is read against today's targets, whatever was kept earlier in it.
    expect(d14?.targets).toEqual(TARGETS);
    expect(d14?.targetsOfTheDay).toBe(true);
    expect(d14?.today).toBe(true);
  });

  it("counts finished days with meals only: a day with none and today are not judged", () => {
    const week = foodWeek({
      span: 7, today: "2026-10-14", current: TARGETS, kept: new Map(),
      logged: [
        logged("2026-10-08", 2000, 80), logged("2026-10-09", 2000, 80), logged("2026-10-10", 2000, 120),
        logged("2026-10-12", 2000, 200), logged("2026-10-14", 300, 10),
      ],
    });
    expect(week.days).toHaveLength(7);
    expect(week.days.find((d) => d.day === "2026-10-11")).toMatchObject({ meals: 0, bands: null, kcal: 0, about: false });
    // Protein was under target on 2 of 4 days.
    expect(week.facts.proteinG).toEqual({ under: 2, on: 1, over: 1, judged: 4 });
    expect(week.facts.kcal).toEqual({ under: 0, on: 4, over: 0, judged: 4 });
  });

  it("rounds a day's sums as each food's figures are kept", () => {
    const week = foodWeek({
      span: 7, today: "2026-10-14", current: TARGETS, kept: new Map(),
      logged: [logged("2026-10-13", 1200, 50.30000000000001, { about: true, fiberG: { amount: 2.06, notKnown: 1 }, sodiumMg: { amount: 300.4, notKnown: 0 } })],
    });
    expect(week.days.find((d) => d.day === "2026-10-13")).toMatchObject({
      proteinG: 50.3, about: true, fiberG: { amount: 2.1, notKnown: 1 }, sodiumMg: { amount: 300, notKnown: 0 },
    });
  });

  it("with no targets, shows what was eaten and judges nothing", () => {
    const week = foodWeek({ span: 7, today: "2026-10-14", current: null, kept: new Map(), logged: [logged("2026-10-12", 2000, 120)] });
    expect(week.days.find((d) => d.day === "2026-10-12")).toMatchObject({ kcal: 2000, targets: null, targetsOfTheDay: false, bands: null });
    expect(week.facts.kcal.judged).toBe(0);
  });

  it("leaves out a day outside the span", () => {
    const week = foodWeek({ span: 7, today: "2026-10-14", current: TARGETS, kept: new Map(), logged: [logged("2026-10-07", 2000, 120)] });
    expect(week.days.every((d) => d.meals === 0)).toBe(true);
  });
});
