import { describe, expect, it } from "vitest";
import type { Meal, RunSummary, WorkoutListItem } from "@app/shared";
import {
  BADGE_NAMES,
  QUOTES,
  activeDaysWords,
  barShare,
  challengeProgress,
  challengeWords,
  count,
  dayWords,
  distanceWords,
  hoursWords,
  latestBadges,
  mealRow,
  noActivityWords,
  quoteOf,
  recentActivity,
  runRow,
  weekOf,
  weekTrained,
  windowWords,
  workoutRow,
  xpToNext,
} from "../src/screens/dashboard/words";

describe("numbers in words", () => {
  it.each([
    [0, "0"],
    [7, "7"],
    [999, "999"],
    [1000, "1,000"],
    [6420, "6,420"],
    [1234567, "1,234,567"],
    [-1500, "-1,500"],
  ])("%i reads %s", (n, words) => {
    expect(count(n)).toBe(words);
  });

  it("the totals' window: everything, or the plan's own days", () => {
    expect(windowWords(null)).toBe("all time");
    expect(windowWords(90)).toBe("last 90 days");
    expect(windowWords(1)).toBe("last 1 day");
  });

  it.each([
    [0, "0 min"],
    [60_000, "1 min"],
    [59 * 60_000 + 59_999, "59 min"],
    [60 * 60_000, "1h"],
    [380 * 60_000, "6h 20m"],
    [1080 * 60_000, "18h"],
    [119 * 60_000 + 59_999, "1h 59m"],
    [60_005 * 60_000, "1,000h 5m"],
  ])("%i ms trained reads %s", (ms, words) => {
    expect(hoursWords(ms)).toBe(words);
  });

  it("XP to the next level, and the bar never past its ends", () => {
    expect(xpToNext({ level: 7, xpInLevel: 1240, xpForNext: 1500 })).toBe("1,240/1,500 XP → Level 8");
    expect([barShare(-5), barShare(0), barShare(83.3), barShare(100), barShare(140), barShare(Number.NaN)]).toEqual([
      0, 0, 83.3, 100, 100, 0,
    ]);
  });
});

describe("this week, Monday to Sunday on the phone's own calendar", () => {
  it.each([
    // [today, the Monday, which index is today]
    [new Date(2026, 9, 26, 9), "2026-10-26", 0], // a Monday
    [new Date(2026, 9, 27, 23, 59), "2026-10-26", 1], // Tuesday, a minute before midnight
    [new Date(2026, 10, 1, 0, 1), "2026-10-26", 6], // Sunday, a minute after midnight
    [new Date(2026, 10, 2, 12), "2026-11-02", 0], // the next Monday
    [new Date(2027, 0, 1, 12), "2026-12-28", 4], // across a new year
    [new Date(2028, 1, 29, 12), "2028-02-28", 1], // a leap day
  ])("on %s the week starts %s", (now, monday, todayAt) => {
    const week = weekOf(now);
    expect(week.map((d) => d.name)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(week[0]?.key).toBe(monday);
    expect(week.findIndex((d) => d.today)).toBe(todayAt);
    expect(week.filter((d) => d.future)).toHaveLength(6 - todayAt);
  });

  it("days trained and workouts: two on a day are one day; days outside the week count nothing", () => {
    const week = weekOf(new Date(2026, 9, 28, 12)); // Wednesday
    const points = [
      { date: "2026-10-25", workouts: 4 }, // last Sunday
      { date: "2026-10-26", workouts: 2 },
      { date: "2026-10-27", workouts: 0 },
      { date: "2026-10-28", workouts: 1 },
      { date: "2026-10-28", workouts: 1 }, // the same day sent twice still adds up
    ];
    expect(weekTrained(points, week)).toEqual({
      trained: [true, false, true, false, false, false, false],
      days: 2,
      workouts: 4,
    });
    expect(weekTrained([], week)).toEqual({ trained: Array(7).fill(false), days: 0, workouts: 0 });
    expect(activeDaysWords(2)).toBe("2 of 7 days active");
  });
});

const workout = (more: Partial<WorkoutListItem>): WorkoutListItem => ({
  id: "4f1d2c3b-0a9e-4d8c-b7a6-5e4f3d2c1b0a",
  startedAt: new Date(2026, 9, 26, 18, 30).toISOString(),
  platform: "android",
  setsCount: 4,
  totalReps: 40,
  avgFormScore: 86,
  durationMs: 38 * 60_000,
  kcalPoint: 312,
  kcalCalcVersion: 1,
  qualityFlags: [],
  ...more,
});

const run = (more: Partial<RunSummary>): RunSummary => ({
  id: "7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d",
  startedAt: new Date(2026, 9, 27, 7, 0).toISOString(),
  durationS: 31 * 60,
  distanceM: 5230,
  routeName: "Evening run",
  kcalPoint: 310,
  source: "mobile",
  ...more,
});

const totals = { kcalPoint: 540, kcalLow: 480, kcalHigh: 600, proteinG: 30, carbsG: 60, fatG: 18 };
const meal = (more: Partial<Meal>): Meal => ({
  id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
  takenAt: new Date(2026, 9, 27, 13, 0).toISOString(),
  mealType: "lunch",
  mealName: null,
  items: [],
  totals,
  confirmed: true,
  origin: "photo",
  portionSource: "default",
  nutritionSources: [],
  calcVersion: 1,
  itemsVersion: "v1",
  ...more,
});

describe("Recent Activity: everything done lately, whatever kind", () => {
  it("each kind's row, named by its day", () => {
    expect(workoutRow(workout({}))).toMatchObject({ day: "Mon 26 Oct", detail: "Workout · 38 min · 86 form", value: "312 kcal" });
    expect(runRow(run({}))).toMatchObject({ day: "Tue 27 Oct", detail: "Evening run · 31 min", value: "5.2 km" });
    expect(mealRow(meal({}))).toMatchObject({ day: "Tue 27 Oct", detail: "Lunch · Meal scan", value: "540 kcal" });
    expect(mealRow(meal({ mealName: "Dal and rice", origin: "manual" })).detail).toBe("Dal and rice · Logged");
    expect(mealRow(meal({ mealType: null })).detail).toBe("Meal · Meal scan");
    expect(runRow(run({ routeName: null })).detail).toBe("Run · 31 min");
  });

  it("what the server does not have is left out, never shown as 0", () => {
    expect(workoutRow(workout({ durationMs: null, kcalPoint: null, avgFormScore: null }))).toMatchObject({ detail: "Workout", value: null });
    // Under half a minute is still a workout that happened: never "0 min".
    expect(workoutRow(workout({ durationMs: 10_000, avgFormScore: null })).detail).toBe("Workout · 1 min");
    // A date the phone cannot read still names the row.
    expect(workoutRow(workout({ startedAt: "not a date" })).day).toBe("Workout");
    expect(dayWords("not a date")).toBeNull();
  });

  it.each([
    [850, "850 m"],
    [999, "999 m"],
    [1000, "1.0 km"],
    [5230, "5.2 km"],
    [5299, "5.2 km"],
    [42195, "42.1 km"],
  ])("%i m reads %s", (metres, words) => {
    expect(distanceWords(metres)).toBe(words);
  });

  it("the newest three of all kinds together, newest first; a time the phone cannot read goes last", () => {
    const rows = recentActivity({
      workouts: [workout({ id: "00000000-0000-4000-8000-000000000001", startedAt: "2026-10-27T05:00:00.000Z" }), workout({ id: "00000000-0000-4000-8000-000000000002", startedAt: "2026-10-20T05:00:00.000Z" })],
      runs: [run({ startedAt: "2026-10-27T09:00:00.000Z" })],
      meals: [meal({ takenAt: "2026-10-27T07:00:00.000Z" }), meal({ id: "00000000-0000-4000-8000-000000000003", takenAt: "garbled" })],
    });
    expect(rows.map((row) => row.kind)).toEqual(["run", "meal", "workout"]);
    expect(rows.map((row) => row.key)).toEqual([
      "run-7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d",
      "meal-1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
      "workout-00000000-0000-4000-8000-000000000001",
    ]);
    expect(recentActivity({ workouts: [], runs: [], meals: [meal({ takenAt: "garbled" })] }).map((row) => row.kind)).toEqual(["meal"]);
    expect(recentActivity({ workouts: [], runs: [], meals: [] })).toEqual([]);
  });

  it("nothing recent: each person is told what is true for them", () => {
    expect(noActivityWords(false, 90)).toBe("No activity yet.");
    expect(noActivityWords(false, null)).toBe("No activity yet.");
    expect(noActivityWords(true, 90)).toBe("No activity in the last 90 days.");
    expect(noActivityWords(true, null)).toBe("No activity to show.");
    expect(noActivityWords(undefined, 90)).toBe("No activity to show.");
  });
});

describe("weekly challenges in words", () => {
  it.each([
    ["train_days_3", 3, "Train on 3 days"],
    ["train_days_7", 7, "Train on 7 days"],
    ["burn_kcal_1500", 1500, "Burn 1,500 kcal"],
    ["train_minutes_120", 120, "Train for 120 minutes"],
    ["form_80_workouts_3", 3, "3 workouts with form 80 or higher"],
    ["form_90_workouts_3", 3, "3 workouts with form 90 or higher"],
    ["families_3", 3, "Try 3 kinds of exercise"],
    ["food_days_5", 5, "Log your food on 5 days"],
  ] as const)("%s reads %s", (code, target, words) => {
    expect(challengeWords({ code, target })).toBe(words);
  });

  it("progress never reads past its target", () => {
    expect(challengeProgress({ current: 1, target: 3 })).toBe("1 of 3");
    expect(challengeProgress({ current: 4200, target: 3000 })).toBe("3,000 of 3,000");
  });
});

describe("the latest badges", () => {
  it("newest first, two at most, by name; a code this phone does not know is never shown raw", () => {
    const earned = [
      { code: "first_workout", earnedAt: "2026-10-01T10:00:00.000Z" },
      { code: "a_badge_from_a_newer_server", earnedAt: "2026-10-26T10:00:00.000Z" },
      { code: "streak_3", earnedAt: "2026-10-20T10:00:00.000Z" },
      { code: "ten_workouts", earnedAt: "2026-10-10T10:00:00.000Z" },
    ];
    expect(latestBadges(earned)).toEqual(["3-Day Streak", "10 Workouts"]);
    expect(latestBadges([])).toEqual([]);
  });

  it("every badge the server gives has a name", () => {
    // apps/api/src/modules/gamification/badges.ts, the 19 codes on 2026-10-27.
    const server = [
      "first_workout", "ten_workouts", "fifty_workouts", "hundred_workouts", "streak_3", "streak_7", "streak_30",
      "streak_100", "form_perfect", "form_master", "calorie_1k", "calorie_10k", "early_bird", "night_owl",
      "variety_5", "variety_all", "first_meal", "macro_master", "photo_meal",
    ];
    expect(Object.keys(BADGE_NAMES).sort()).toEqual([...server].sort());
  });
});

it("one quote a day of the week, the browser's seven", () => {
  expect(QUOTES).toHaveLength(7);
  expect(quoteOf(new Date(2026, 9, 25)).author).toBe("Unknown"); // a Sunday
  expect(quoteOf(new Date(2026, 9, 27)).author).toBe("Jim Rohn"); // a Tuesday
});
