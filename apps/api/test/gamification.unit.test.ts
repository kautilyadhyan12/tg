// P2.3 — PURE unit tests: streak machine (Part 7 §3), badge evaluator
// (badges.py port), kcal formula (2B §2.2). No DB, no clock dependence —
// dates are explicit inputs.
import { describe, expect, it } from "vitest";
import {
  EMPTY_STREAK,
  dayDiff,
  dayInTz,
  reconcile,
  recordActivity,
  safeTimeZone,
  type StreakState,
} from "../src/modules/gamification/streak.js";
import { earnedCodes, evaluate } from "../src/modules/gamification/badges.js";
import { DEFAULT_WEIGHT_KG, kcalPointForSets } from "../src/modules/workouts/calories.js";

const state = (s: Partial<StreakState>): StreakState => ({ ...EMPTY_STREAK, ...s });

describe("streak machine (Part 7 §3)", () => {
  it("first ever activity starts at 1", () => {
    expect(recordActivity(EMPTY_STREAK, "2026-07-10")).toEqual({
      current: 1,
      longest: 1,
      lastActivityDate: "2026-07-10",
      freezesAvailable: 0,
    });
  });

  it("same-day repeat is a no-op (day-idempotent, R3.5)", () => {
    const s1 = recordActivity(EMPTY_STREAK, "2026-07-10");
    expect(recordActivity(s1, "2026-07-10")).toEqual(s1);
  });

  it("next-day activity increments; longest follows", () => {
    const s = recordActivity(recordActivity(EMPTY_STREAK, "2026-07-10"), "2026-07-11");
    expect(s.current).toBe(2);
    expect(s.longest).toBe(2);
  });

  it("older-than-last activity (offline backfill) is a no-op", () => {
    const s1 = recordActivity(EMPTY_STREAK, "2026-07-10");
    expect(recordActivity(s1, "2026-07-08")).toEqual(s1);
  });

  it("one missed day with a freeze banked: §3.2 auto-spend keeps the streak", () => {
    const s = recordActivity(
      state({ current: 5, longest: 5, lastActivityDate: "2026-07-10", freezesAvailable: 1 }),
      "2026-07-12", // 07-11 missed
    );
    expect(s).toEqual({ current: 6, longest: 6, lastActivityDate: "2026-07-12", freezesAvailable: 0 });
  });

  it("two missed days, one freeze: §3.3 reset — but longest survives and the bank is not confiscated", () => {
    const s = recordActivity(
      state({ current: 14, longest: 14, lastActivityDate: "2026-07-10", freezesAvailable: 1 }),
      "2026-07-13", // 07-11 and 07-12 missed; 1 freeze can't cover 2
    );
    expect(s.current).toBe(1);
    expect(s.longest).toBe(14);
    expect(s.freezesAvailable).toBe(1);
  });

  it("earns a freeze at every 7th consecutive day, capped at 3 (§3.2)", () => {
    let s = EMPTY_STREAK;
    for (let i = 0; i < 28; i++) {
      s = recordActivity(s, `2026-06-${String(i + 1).padStart(2, "0")}`);
      if (i === 6) expect(s.freezesAvailable).toBe(1); // day 7
      if (i === 13) expect(s.freezesAvailable).toBe(2); // day 14
      if (i === 20) expect(s.freezesAvailable).toBe(3); // day 21
    }
    expect(s.current).toBe(28);
    expect(s.freezesAvailable).toBe(3); // day 28 earn hits the cap
  });

  it("reconcile (lazy day-close sweep, GAP-5): covers missed days with freezes, today stays open", () => {
    const covered = reconcile(
      state({ current: 12, longest: 12, lastActivityDate: "2026-07-08", freezesAvailable: 2 }),
      "2026-07-11", // 07-09 + 07-10 missed, today 07-11 still open
    );
    expect(covered).toEqual({
      current: 12,
      longest: 12,
      lastActivityDate: "2026-07-10",
      freezesAvailable: 0,
    });
    // Yesterday-activity: nothing missed yet.
    const fresh = state({ current: 3, longest: 3, lastActivityDate: "2026-07-10", freezesAvailable: 1 });
    expect(reconcile(fresh, "2026-07-11")).toEqual(fresh);
  });

  it("timezone day boundary (Part IV #8): 18:30 UTC is the NEXT day in Asia/Kolkata", () => {
    const instant = new Date("2026-07-10T18:30:00Z"); // 00:00 IST 07-11
    expect(dayInTz(instant, "UTC")).toBe("2026-07-10");
    expect(dayInTz(instant, "Asia/Kolkata")).toBe("2026-07-11");
  });

  it("safeTimeZone: junk falls back to UTC; dayDiff is exact", () => {
    expect(safeTimeZone("not/a-zone")).toBe("UTC");
    expect(safeTimeZone(null)).toBe("UTC");
    expect(safeTimeZone("Asia/Kolkata")).toBe("Asia/Kolkata");
    expect(dayDiff("2026-07-10", "2026-07-12")).toBe(2);
    expect(dayDiff("2026-07-12", "2026-07-10")).toBe(-2);
  });
});

describe("badge evaluator (badges.py port)", () => {
  it("form_master needs the minWorkouts guard (badges.py:284)", () => {
    const criteria = { stat: "avg_form_last5", gte: 90, minWorkouts: 5 };
    expect(evaluate(criteria, { avg_form_last5: 95, total_workouts: 4 })).toBe(false);
    expect(evaluate(criteria, { avg_form_last5: 95, total_workouts: 5 })).toBe(true);
  });

  it("missing stats read 0 — meal/coach/photo badges stay unearned until their modules land", () => {
    const codes = earnedCodes({ total_workouts: 1, current_streak: 1 });
    expect(codes).toContain("first_workout");
    expect(codes).not.toContain("first_meal");
    expect(codes).not.toContain("first_chat");
  });

  it("thresholds match badges.py:270-298", () => {
    const codes = earnedCodes({
      total_workouts: 50,
      current_streak: 7,
      total_kcal: 1000,
      families_tried: 5,
    });
    expect(codes).toEqual(
      expect.arrayContaining(["fifty_workouts", "streak_7", "calorie_1k", "variety_5"]),
    );
    expect(codes).not.toContain("hundred_workouts");
    expect(codes).not.toContain("streak_30");
    expect(codes).not.toContain("variety_all");
  });
});

describe("kcal formula (2B §2.2: MET × weight × active hours)", () => {
  it("computes and rounds the point estimate", () => {
    // 6.0 MET × 70 kg × 0.5 h = 210
    expect(kcalPointForSets([{ met: 6, durationMs: 1_800_000 }], 70)).toBe(210);
    // two sets sum before rounding: 2 × (6 × 70 × 21000/3.6e6) = 4.9 → 5
    expect(
      kcalPointForSets(
        [
          { met: 6, durationMs: 21_000 },
          { met: 6, durationMs: 21_000 },
        ],
        null,
      ),
    ).toBe(5);
  });

  it("falls back to 70 kg (calories.py:96) on null/invalid weight", () => {
    const sets = [{ met: 6, durationMs: 3_600_000 }];
    expect(kcalPointForSets(sets, null)).toBe(6 * DEFAULT_WEIGHT_KG);
    expect(kcalPointForSets(sets, 0)).toBe(6 * DEFAULT_WEIGHT_KG);
    expect(kcalPointForSets(sets, 100)).toBe(600);
  });
});
