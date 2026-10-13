import { describe, expect, it } from "vitest";
import { gymWeekCanCompare, gymWeekResponseSchema, gymWeekWindow } from "../src/index.js";

describe("Overview's Last 7 days box: the days it counts", () => {
  it("counts the seven whole days that ended yesterday, and the seven before them", () => {
    expect(gymWeekWindow("2026-10-12")).toEqual({ from: "2026-10-05", to: "2026-10-11", beforeFrom: "2026-09-28", beforeTo: "2026-10-04" });
  });

  it("crosses a month and a year", () => {
    expect(gymWeekWindow("2026-03-03")).toEqual({ from: "2026-02-24", to: "2026-03-02", beforeFrom: "2026-02-17", beforeTo: "2026-02-23" });
    expect(gymWeekWindow("2027-01-02")).toEqual({ from: "2026-12-26", to: "2027-01-01", beforeFrom: "2026-12-19", beforeTo: "2026-12-25" });
  });

  it("compares with the week before only when check-in had begun by its first day", () => {
    const window = gymWeekWindow("2026-10-12");
    expect(gymWeekCanCompare("2026-09-28", window)).toBe(true);
    expect(gymWeekCanCompare("2026-01-01", window)).toBe(true);
    expect(gymWeekCanCompare("2026-09-29", window)).toBe(false);
    expect(gymWeekCanCompare("2026-10-08", window)).toBe(false);
    expect(gymWeekCanCompare(null, window)).toBe(false);
    expect(gymWeekCanCompare("soon", window)).toBe(false);
  });

  it("refuses a body with a part it does not know, or a count below nought", () => {
    const week = { from: "2026-10-05", to: "2026-10-11", members: null, atRisk: null, visits: null, paymentDue: null };
    expect(gymWeekResponseSchema.safeParse({ week }).success).toBe(true);
    expect(gymWeekResponseSchema.safeParse({ week: { ...week, names: ["Maya"] } }).success).toBe(false);
    expect(gymWeekResponseSchema.safeParse({ week: { ...week, atRisk: { count: -1 } } }).success).toBe(false);
    expect(gymWeekResponseSchema.safeParse({ week: { ...week, atRisk: { count: 2, people: [] } } }).success).toBe(false);
    expect(gymWeekResponseSchema.safeParse({ week: { ...week, paymentDue: { count: 1, past: 2 } } }).success).toBe(true);
    expect(gymWeekResponseSchema.safeParse({ week: { ...week, paymentDue: { count: 1 } } }).success).toBe(false);
  });
});
