// When the streak reminder, badges and the summary may go, and what the phone shows (ROADMAP Stage 5 item
// 19e-ii): every class of case.
import { describe, expect, it } from "vitest";
import {
  badgeNotification,
  nudgeDue,
  nudgeHourOpen,
  roomForNudge,
  streakNotification,
  summaryNotification,
  summaryWorthSending,
  trainingNudgePushDataSchema,
  type WeekSummary,
} from "../src/index.js";

const NOW = new Date("2026-11-03T13:30:00Z"); // 7 pm in India
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

describe("the day's hours", () => {
  it.each([
    [479, false],
    [480, true],
    [1289, true],
    [1290, false],
    [1439, false],
    [0, false],
    [-1, false],
    [1440, false],
    [600.5, false],
    [Number.NaN, false],
    ["600", false],
    [null, false],
  ])("minute %s open: %s", (minute, open) => {
    expect(nudgeHourOpen(minute)).toBe(open);
  });

  it.each([
    [1140, 1139, false],
    [1140, 1140, true],
    [1140, 1169, true],
    [1140, 1170, false],
    [1140, Number.NaN, false],
  ])("timed %s, due at %s: %s", (at, now, due) => {
    expect(nudgeDue(at, now)).toBe(due);
  });
});

describe("giving way to the other notifications", () => {
  const today = "2026-11-03";
  it.each([
    ["none yet", [], true],
    ["one 2 hours ago", [{ at: ago(120), day: today }], true],
    ["one 119 minutes ago", [{ at: ago(119), day: today }], false],
    ["two today, long ago", [{ at: ago(300), day: today }, { at: ago(600), day: today }], true],
    ["three today", [{ at: ago(300), day: today }, { at: ago(400), day: today }, { at: ago(600), day: today }], false],
    ["three, one of them yesterday", [{ at: ago(300), day: today }, { at: ago(400), day: today }, { at: ago(1500), day: "2026-11-02" }], true],
    ["a time that cannot be read", [{ at: new Date(Number.NaN), day: today }], false],
    ["one from the future", [{ at: new Date(NOW.getTime() + 60_000), day: today }], false],
  ])("%s: room %s", (_name, recent, room) => {
    expect(roomForNudge(recent, today, NOW)).toBe(room);
  });

  it("a clock that cannot be read sends nothing", () => {
    expect(roomForNudge([], "2026-11-03", new Date(Number.NaN))).toBe(false);
  });
});

describe("what the phone shows", () => {
  it("the streak reminder: with and without a freeze, never under 3 days", () => {
    expect(streakNotification({ days: 3, freeze: false })).toEqual({ title: "Keep your streak going", body: "Your 3-day streak ends at midnight. Even a short run counts." });
    expect(streakNotification({ days: 1200, freeze: true })?.body).toBe("Nothing done yet today. A freeze will keep your 1,200-day streak safe, but a short run keeps it going.");
    expect(streakNotification({ days: 2, freeze: false })).toBeNull();
    expect(streakNotification({ days: 3.5, freeze: false })).toBeNull();
  });

  it("badges: one, several, and a code the app does not know is never shown raw", () => {
    expect(badgeNotification(["streak_7"])).toEqual({ title: "New badge", body: "You earned 7-Day Streak." });
    expect(badgeNotification(["first_workout", "first_meal", "photo_meal"])).toEqual({
      title: "3 new badges",
      body: "You earned First Workout, First Meal Logged and First Meal Photo.",
    });
    expect(badgeNotification(["first_workout", "badge_from_tomorrow"])).toEqual({ title: "New badge", body: "You earned First Workout." });
    expect(badgeNotification(["badge_from_tomorrow"])).toBeNull();
    expect(badgeNotification([])).toBeNull();
  });

  const week = (over: Partial<WeekSummary>): WeekSummary => ({
    workouts: 0,
    runs: 0,
    visits: 0,
    lastWeekWorkouts: 0,
    lastWeekRuns: 0,
    lastWeekVisits: 0,
    streak: 0,
    badges: [],
    ...over,
  });

  it.each([
    ["more than last week", week({ workouts: 4, visits: 2, lastWeekWorkouts: 3, streak: 9 }), "This week: 4 workouts and 2 visits. That’s 1 workout more than last week. Your streak: 9 days."],
    ["fewer than last week: no fall said", week({ workouts: 2, lastWeekWorkouts: 5, streak: 1 }), "This week: 2 workouts."],
    ["the same as last week", week({ workouts: 3, lastWeekWorkouts: 3 }), "This week: 3 workouts."],
    ["after a week with none: no sum against nothing", week({ workouts: 3, streak: 3 }), "This week: 3 workouts. Your streak: 3 days."],
    ["one of each", week({ workouts: 1, runs: 1, visits: 1 }), "This week: 1 workout, 1 run and 1 visit."],
    ["visits only", week({ visits: 3, streak: 4 }), "This week: 3 visits. Your streak: 4 days."],
    ["nothing done this week, a new badge: the badge alone", week({ lastWeekWorkouts: 2, badges: ["streak_3"] }), "New badge: 3-Day Streak."],
    ["new badges", week({ workouts: 1, badges: ["first_workout", "first_meal"] }), "This week: 1 workout. New badges: First Workout and First Meal Logged."],
  ])("%s", (_name, given, body) => {
    expect(summaryNotification(given)).toEqual({ title: "Your week", body });
  });

  it("a week with nothing done and no new badge: no summary, whatever last week was", () => {
    expect(summaryWorthSending(week({}))).toBe(false);
    expect(summaryNotification(week({ streak: 0 }))).toBeNull();
    expect(summaryNotification(week({ badges: ["not_a_badge"] }))).toBeNull();
    expect(summaryNotification(week({ lastWeekWorkouts: 4, lastWeekRuns: 1, lastWeekVisits: 2, streak: 3 }))).toBeNull();
  });

  it("no summary or reminder line ever tells somebody to train harder, or names a fall", () => {
    const words = [
      summaryNotification(week({ workouts: 1, lastWeekWorkouts: 9 }))?.body,
      summaryNotification(week({ lastWeekWorkouts: 9 }))?.body,
    ].join(" ");
    expect(words).not.toMatch(/fewer|less|down|only|should|must|miss/i);
  });

  it("a tap opens only one of three places", () => {
    expect(trainingNudgePushDataSchema.safeParse({ kind: "training_nudge", open: "achievements" }).success).toBe(true);
    expect(trainingNudgePushDataSchema.safeParse({ kind: "training_nudge", open: "running" }).success).toBe(true);
    expect(trainingNudgePushDataSchema.safeParse({ kind: "training_nudge", open: "settings" }).success).toBe(false);
    expect(trainingNudgePushDataSchema.safeParse({ kind: "training_reminder", open: "workout" }).success).toBe(false);
  });
});
