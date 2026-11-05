import { describe, expect, it } from "vitest";
import type { Badge } from "@app/shared";
import {
  badgeCountWords,
  badgeGroups,
  challengeToGo,
  coinOf,
  earnedDay,
  laneShare,
  leaves,
  medalOf,
  ofWords,
  progressWords,
  share,
  shownBadge,
  toGoWords,
  type ShownBadge,
} from "../src/screens/achievements/achievementsRules";

// Achievements' rules (35c-iii). The worst thing on the phone is a badge drawn as earned that the server says is not:
// every word and share below reads `earnedAt`, and a badge not earned is never full however near it is.

const badge = (code: string, over: Partial<Badge> = {}): Badge => ({ code, tier: "silver", xp: 150, earnedAt: null, current: 0, target: 10, workoutsFirst: null, ...over });
const shown = (b: Badge): ShownBadge => {
  const s = shownBadge(b);
  if (s === null) throw new Error(`no words for ${b.code}`);
  return s;
};

describe("a badge's words", () => {
  it.each([
    { b: badge("ten_workouts", { current: 8 }), progress: "8 of 10 workouts", of: "of 10 workouts", toGo: "2 more workouts to go." },
    { b: badge("ten_workouts", { current: 9 }), progress: "9 of 10 workouts", of: "of 10 workouts", toGo: "1 more workout to go." },
    { b: badge("streak_7", { current: 2, target: 7 }), progress: "2 of 7 days", of: "of 7 days", toGo: "5 more days to go." },
    { b: badge("calorie_10k", { current: 1040, target: 10000 }), progress: "1,040 of 10,000 kcal", of: "of 10,000 kcal", toGo: "8,960 more kcal to go." },
    { b: badge("form_master", { current: 89, target: 90, workoutsFirst: { current: 5, target: 5 } }), progress: "Form 89 of 90", of: "of 90 average form", toGo: "Your average is 89. It needs 90." },
    { b: badge("form_master", { current: 95, target: 90, workoutsFirst: { current: 3, target: 5 } }), progress: "3 of 5 scored workouts first", of: "of 5 scored workouts first", toGo: "2 more scored workouts first, then your average counts." },
    { b: badge("first_meal", { current: 0, target: 1 }), progress: "0 of 1 meal", of: "of 1 meal", toGo: "1 more meal to go." },
    { b: badge("macro_master", { current: 3, target: 7 }), progress: "3 of 7 days", of: "of 7 days", toGo: "4 more days to go." },
  ])("$b.code at $b.current", ({ b, progress, of, toGo }) => {
    expect(progressWords(shown(b))).toBe(progress);
    expect(ofWords(shown(b))).toBe(of);
    expect(toGoWords(shown(b))).toBe(toGo);
  });

  it("a code this phone does not know is left out, never shown raw", () => {
    expect(shownBadge(badge("moon_landing"))).toBeNull();
    const list = [badge("first_workout", { earnedAt: "2026-10-14T18:00:00.000Z" }), badge("moon_landing", { earnedAt: "2026-10-14T18:00:00.000Z" })];
    expect(badgeCountWords(list)).toBe("1 of 1 badge");
    expect(badgeGroups(list).flatMap((g) => g.badges.map((b) => b.badge.code))).toEqual(["first_workout"]);
  });
});

describe("earned or not", () => {
  it("a badge one short of its target is not full", () => {
    expect(share(badge("ten_workouts", { current: 9 }))).toBe(0.9);
    expect(share(badge("ten_workouts", { current: 10 }))).toBe(1); // reached; the server awards it on the read
    expect(share(badge("ten_workouts", { current: 3, earnedAt: "2026-10-14T18:00:00.000Z" }))).toBe(1);
  });

  it("counts only badges the server says are earned", () => {
    const list = [
      badge("first_workout", { earnedAt: "2026-10-14T18:00:00.000Z" }),
      badge("ten_workouts", { current: 10 }),
      badge("streak_3", { current: 2, target: 3 }),
    ];
    expect(badgeCountWords(list)).toBe("1 of 3 badges");
    expect(badgeGroups(list)).toEqual([
      expect.objectContaining({ key: "milestones", earned: 1 }),
      expect.objectContaining({ key: "streaks", earned: 0 }),
    ]);
  });

  it("groups keep the shelves' order: milestones, streaks, form, calories, habits, variety, food", () => {
    const codes = ["photo_meal", "variety_5", "early_bird", "calorie_1k", "form_perfect", "streak_3", "first_workout"];
    expect(badgeGroups(codes.map((c) => badge(c))).map((g) => g.key)).toEqual(["milestones", "streaks", "form", "calories", "habits", "variety", "food"]);
  });

  it("a locked badge's medal is its grey twin", () => {
    expect(medalOf({ code: "ten_workouts" }, true)).toBe("medal_ten_workouts_locked");
    expect(medalOf({ code: "ten_workouts" }, false)).toBe("medal_ten_workouts");
  });

  it("the day earned is the phone's own day, with the year only from another year", () => {
    const now = new Date(2026, 10, 5, 12);
    expect(earnedDay(new Date(2026, 9, 14, 23, 30).toISOString(), now)).toBe("14 Oct");
    expect(earnedDay(new Date(2025, 11, 31, 9).toISOString(), now)).toBe("31 Dec 2025");
  });
});

describe("a challenge's laurel", () => {
  it.each([
    { c: { current: 0, target: 3, done: false, measure: "training_days" as const }, lit: 0, all: 3 },
    { c: { current: 2, target: 5, done: false, measure: "food_days" as const }, lit: 2, all: 5 },
    { c: { current: 3, target: 3, done: true, measure: "training_days" as const }, lit: 3, all: 3 },
    { c: { current: 94, target: 300, done: false, measure: "training_minutes" as const }, lit: 3, all: 10 },
    // 299 of 300 is not done: one leaf stays outlined.
    { c: { current: 299, target: 300, done: false, measure: "training_minutes" as const }, lit: 9, all: 10 },
    { c: { current: 3100, target: 3000, done: true, measure: "kcal_burned" as const }, lit: 10, all: 10 },
  ])("$c.current of $c.target", ({ c, lit, all }) => {
    expect(leaves(c)).toEqual({ lit, all });
  });

  it("says what is left, with its unit", () => {
    expect(challengeToGo({ current: 94, target: 300, measure: "training_minutes" })).toBe("206 min to go");
    expect(challengeToGo({ current: 2, target: 5, measure: "food_days" })).toBe("3 to go");
    expect(challengeToGo({ current: 1040, target: 1500, measure: "kcal_burned" })).toBe("460 kcal to go");
  });

  it("a coin is its kind in its difficulty's metal", () => {
    expect(coinOf({ measure: "training_days", difficulty: "easy" })).toBe("coin_training_days_bronze");
    expect(coinOf({ measure: "food_days", difficulty: "medium" }, true)).toBe("coin_food_days_silver_grey");
    expect(coinOf({ measure: "form_90_workouts", difficulty: "hard" })).toBe("coin_form_90_workouts_gold");
  });
});

describe("a lane", () => {
  it.each([
    { value: 14, leader: 14, share: 1 },
    { value: 7, leader: 14, share: 0.5 },
    { value: 0, leader: 14, share: 0 },
    { value: 1, leader: 100, share: 0.04 },
    { value: 5, leader: 0, share: 0 },
  ])("$value of $leader", ({ value, leader, share: expected }) => {
    expect(laneShare(value, leader)).toBe(expected);
  });
});
