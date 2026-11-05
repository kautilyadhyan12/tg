// Every badge, earned or not (ROADMAP 35c-iii): the rules behind the list, case by case.
// The worst thing is a badge shown as earned, or as reached, when it was not: every
// target is tried just under, at and over, and an unearned badge never reads as full.
import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS, badgeList, earnedCodes, proteinRun, type ProteinDay } from "../src/modules/gamification/badges.js";

const NONE = new Map<string, Date>();

describe("badgeList: an unearned badge never reads as reached", () => {
  // Every badge, its figure one under, at and one over its target, nothing awarded yet.
  const cases = ACHIEVEMENTS.flatMap((a) =>
    [a.criteria.gte - 1, a.criteria.gte, a.criteria.gte + 1].map((value) => ({ code: a.code, stat: a.criteria.stat, gte: a.criteria.gte, value })),
  );
  it.each(cases)("$code at $value of $gte", ({ code, stat, gte, value }) => {
    const stats = { [stat]: value, total_workouts: Math.max(value, 0) };
    const one = badgeList(stats, NONE).find((b) => b.code === code);
    expect(one).toBeDefined();
    expect(one?.earnedAt).toBeNull();
    expect(one?.target).toBe(gte);
    expect(one?.current).toBe(Math.min(Math.max(Math.floor(value), 0), gte));
    expect(one?.current).toBeLessThanOrEqual(gte);
  });

  it("an average of 89.6 reads 89 of 90, never 90", () => {
    const one = badgeList({ avg_form_last5: 89.6, total_workouts: 9 }, NONE).find((b) => b.code === "form_master");
    expect(one).toMatchObject({ current: 89, target: 90, workoutsFirst: { current: 5, target: 5 }, earnedAt: null });
  });

  it("Form Master with 3 workouts says 3 of 5 workouts first", () => {
    const one = badgeList({ avg_form_last5: 95, total_workouts: 3 }, NONE).find((b) => b.code === "form_master");
    expect(one?.workoutsFirst).toEqual({ current: 3, target: 5 });
  });

  it("a figure the app does not have yet reads 0, never a guess", () => {
    const list = badgeList({}, NONE);
    expect(list.every((b) => b.current === 0 && b.earnedAt === null)).toBe(true);
  });

  it("a negative figure reads 0", () => {
    expect(badgeList({ total_kcal: -40 }, NONE).find((b) => b.code === "calorie_1k")?.current).toBe(0);
  });
});

describe("badgeList: an earned badge", () => {
  it("keeps its day and reads full, even when its figure has fallen since (a streak broken)", () => {
    const day = new Date("2026-10-14T18:30:00.000Z");
    const one = badgeList({ current_streak: 0 }, new Map([["streak_3", day]])).find((b) => b.code === "streak_3");
    expect(one).toMatchObject({ earnedAt: "2026-10-14T18:30:00.000Z", current: 3, target: 3 });
  });

  it("gives each badge its metal's XP", () => {
    const xp = Object.fromEntries(badgeList({}, NONE).map((b) => [b.code, [b.tier, b.xp]]));
    expect(xp["first_workout"]).toEqual(["bronze", 50]);
    expect(xp["ten_workouts"]).toEqual(["silver", 150]);
    expect(xp["fifty_workouts"]).toEqual(["gold", 400]);
    expect(xp["hundred_workouts"]).toEqual(["platinum", 1000]);
  });

  it("lists all 19, once each", () => {
    const codes = badgeList({}, NONE).map((b) => b.code);
    expect(codes).toHaveLength(19);
    expect(new Set(codes).size).toBe(19);
  });
});

describe("proteinRun: the days in a row the protein target was hit (Macro Master)", () => {
  const day = (d: string, eatenG: number, targetG = 100): ProteinDay => ({ day: d, eatenG, targetG });
  const TODAY = "2026-11-05";

  it.each([
    { name: "nothing logged", days: [], run: 0 },
    { name: "today alone, hit", days: [day("2026-11-05", 100)], run: 1 },
    { name: "today not hit yet: the run up to yesterday stands", days: [day("2026-11-04", 120), day("2026-11-05", 30)], run: 1 },
    { name: "yesterday missed: today starts again", days: [day("2026-11-03", 120), day("2026-11-05", 100)], run: 1 },
    { name: "a gap two days back ends the run", days: [day("2026-11-02", 120), day("2026-11-04", 120), day("2026-11-05", 120)], run: 2 },
    {
      name: "seven in a row up to today",
      days: ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"].map((d) => day(d, 110)),
      run: 7,
    },
    // Within 10 % is on target, as "Your week in food" bands it: 90 g of 100 counts, 89.9 g does not.
    { name: "90 g of 100 counts", days: [day("2026-11-05", 90)], run: 1 },
    { name: "89.9 g of 100 does not", days: [day("2026-11-05", 89.9)], run: 0 },
    { name: "over the target counts", days: [day("2026-11-05", 250)], run: 1 },
    { name: "a target of 0 never counts", days: [day("2026-11-05", 50, 0)], run: 0 },
    { name: "the month's edge", days: [day("2026-10-31", 100), day("2026-11-01", 100)], today: "2026-11-01", run: 2 },
    { name: "the year's edge", days: [day("2025-12-31", 100), day("2026-01-01", 100)], today: "2026-01-01", run: 2 },
  ])("$name → $run", ({ days, run, today }) => {
    expect(proteinRun(days, today ?? TODAY)).toBe(run);
  });

  it("seven days earn Macro Master, six do not", () => {
    expect(earnedCodes({ protein_target_streak: 7 })).toContain("macro_master");
    expect(earnedCodes({ protein_target_streak: 6 })).not.toContain("macro_master");
  });
});
