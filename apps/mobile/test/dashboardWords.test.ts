import { describe, expect, it } from "vitest";
import type { WorkoutListItem } from "@app/shared";
import {
  BADGE_NAMES,
  QUOTES,
  activeDaysWords,
  barShare,
  challengeProgress,
  challengeWords,
  count,
  dayWords,
  hoursWords,
  latestBadges,
  noWorkoutsWords,
  quoteOf,
  weekOf,
  weekTrained,
  windowWords,
  workoutLine,
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
    [0, "0 min", "0 minutes"],
    [60_000, "1 min", "1 minute"],
    [59 * 60_000, "59 min", "59 minutes"],
    [60 * 60_000, "1h", "60 minutes"],
    [1080 * 60_000, "18h", "1,080 minutes"],
    [119 * 60_000 + 59_999, "1h", "119 minutes"],
  ])("%i ms trained reads %s, %s", (ms, value, minutes) => {
    expect(hoursWords(ms)).toEqual({ value, minutes });
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

describe("a recent workout's line", () => {
  it("everything known", () => {
    expect(workoutLine(workout({}))).toEqual({ when: "Mon 26 Oct · 38 min", kcal: "312 kcal", form: "86 form" });
  });

  it("what the server does not have is left out, never shown as 0", () => {
    expect(workoutLine(workout({ durationMs: null, kcalPoint: null, avgFormScore: null }))).toEqual({
      when: "Mon 26 Oct",
      kcal: null,
      form: null,
    });
    // Under half a minute is still a workout that happened: never "0 min".
    expect(workoutLine(workout({ durationMs: 10_000 })).when).toBe("Mon 26 Oct · 1 min");
    expect(dayWords("not a date")).toBeNull();
  });

  it("no workouts: each person is told what is true for them", () => {
    expect(noWorkoutsWords(false, 90)).toBe("No workouts yet.");
    expect(noWorkoutsWords(false, null)).toBe("No workouts yet.");
    expect(noWorkoutsWords(true, 90)).toBe("No workouts in the last 90 days.");
    expect(noWorkoutsWords(true, null)).toBe("No workouts to show.");
    expect(noWorkoutsWords(undefined, 90)).toBe("No workouts to show.");
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
