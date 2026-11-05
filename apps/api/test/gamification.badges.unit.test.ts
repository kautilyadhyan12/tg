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
    const one = badgeList({ avg_form_last5: 89.6, total_workouts: 12, scored_workouts: 9 }, NONE).find((b) => b.code === "form_master");
    expect(one).toMatchObject({ current: 89, target: 90, workoutsFirst: { current: 5, target: 5 }, earnedAt: null });
  });

  it("Form Master with 3 scored workouts of 9 says 3 of 5 first: the average is of scored workouts", () => {
    const one = badgeList({ avg_form_last5: 95, total_workouts: 9, scored_workouts: 3 }, NONE).find((b) => b.code === "form_master");
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
  // Days as Your week in food bands them: the run reads that screen's own bands, so the two agree.
  type Band = "under" | "on" | "over";
  const TODAY = "2026-11-05";
  const back = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
  const day = (n: number, protein: Band | null): ProteinDay => ({
    day: back(n),
    today: n === 0,
    bands: protein === null ? null : { kcal: "on", proteinG: protein, carbsG: "on", fatG: "on" },
  });

  it.each([
    { name: "nothing logged", days: [day(1, null), day(0, null)], run: 0 },
    { name: "today alone, on", days: [day(0, "on")], run: 1 },
    { name: "today under so far: the run up to yesterday stands", days: [day(1, "over"), day(0, "under")], run: 1 },
    { name: "today with no meal yet: the run up to yesterday stands", days: [day(2, "on"), day(1, "on"), day(0, null)], run: 2 },
    { name: "yesterday missed: today starts again", days: [day(2, "on"), day(1, null), day(0, "on")], run: 1 },
    { name: "yesterday under: the run ends there", days: [day(2, "on"), day(1, "under"), day(0, "on")], run: 1 },
    { name: "seven in a row up to today", days: [6, 5, 4, 3, 2, 1, 0].map((n) => day(n, "on")), run: 7 },
    { name: "seven in a row up to yesterday, today not yet", days: [...[7, 6, 5, 4, 3, 2, 1].map((n) => day(n, "on")), day(0, "under")], run: 7 },
    { name: "over counts as on", days: [day(1, "over"), day(0, "over")], run: 2 },
    { name: "the order the days come in does not matter", days: [day(0, "on"), day(2, "on"), day(1, "on")], run: 3 },
  ])("$name → $run", ({ days, run }) => {
    expect(proteinRun(days)).toBe(run);
  });

  it("seven days earn Macro Master, six do not", () => {
    expect(earnedCodes({ protein_target_streak: 7 })).toContain("macro_master");
    expect(earnedCodes({ protein_target_streak: 6 })).not.toContain("macro_master");
  });
});
