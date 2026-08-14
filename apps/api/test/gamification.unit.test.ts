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
  replayActivityDays,
  safeTimeZone,
  type StreakState,
} from "../src/modules/gamification/streak.js";
import { badgeXpForCodes, earnedCodes, evaluate } from "../src/modules/gamification/badges.js";
import {
  computeTotalXp,
  countStreakContinuationDays,
  levelForXp,
  xpForLevel,
  xpProgress,
} from "../src/modules/gamification/xp.js";
import {
  DEFAULT_WEIGHT_KG,
  kcalPointForSets,
  kcalPointForSetsV2,
  kcalPointForSetsV3,
} from "../src/modules/workouts/calories.js";

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

  it("older-than-last day is a no-op at the FOLD level (replay handles backfills)", () => {
    const s1 = recordActivity(EMPTY_STREAK, "2026-07-10");
    expect(recordActivity(s1, "2026-07-08")).toEqual(s1);
  });

  it("replay (§3.5): a late offline day retroactively RESTORES a lost streak", () => {
    // Without 07-11 the gap resets at 07-12…
    expect(replayActivityDays(["2026-07-10", "2026-07-09", "2026-07-12"]).current).toBe(1);
    // …the backfilled day bridges it (input order must not matter).
    const restored = replayActivityDays(["2026-07-12", "2026-07-09", "2026-07-11", "2026-07-10"]);
    expect(restored.current).toBe(4);
    expect(restored.longest).toBe(4);
  });

  it("replay spends replay-time freezes across gaps, exactly as live would have", () => {
    // 7 consecutive days bank one freeze; the single missed day after is covered.
    const days = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05",
      "2026-06-06", "2026-06-07", "2026-06-09"]; // 06-08 missed
    const s = replayActivityDays(days);
    expect(s.current).toBe(8);
    expect(s.freezesAvailable).toBe(0); // earned on day 7, spent on the miss
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

describe("kcal v2 (three-tier, Kd-ruled 2026-08-07: reps at MET · idle at REST_MET 1.8 · pause at nothing)", () => {
  // The scenario Kd caught, hand-computed: camera on for 2.5 min, idle for 2
  // of them, 10 reps × 3 s. v1 bills the whole span at the exercise MET; v2
  // bills 30 s at MET 6 + 120 s at 1.8.
  // v2 = 6×70×(30000/3.6e6) + 1.8×70×(120000/3.6e6) = 3.5 + 4.2 = 7.7 → 8.
  const kdSet = { met: 6, durationMs: 150_000, reps: 10, tempoMsAvg: 3_000, logOnly: false };

  it("bills only rep time at the exercise MET (the Kd scenario)", () => {
    expect(kcalPointForSetsV2([kdSet], 70, { restSeconds: 0, durationSeconds: undefined })).toBe(8);
    // The v1 comparator on the same set: 6 × 70 × (150000/3.6e6) = 17.5 → 18.
    expect(kcalPointForSets([kdSet], 70)).toBe(18);
  });

  it("a ZERO-rep engine set (camera running, nobody exercising) is all REST_MET", () => {
    // 1.8 × 70 × (150000/3.6e6) = 5.25 → 5. tempoMsAvg null: no rep was timed.
    const idle = { met: 6, durationMs: 150_000, reps: 0, tempoMsAvg: null, logOnly: false };
    expect(kcalPointForSetsV2([idle], 70, { restSeconds: 0, durationSeconds: undefined })).toBe(5);
  });

  it("a log-only set keeps the v1 treatment exactly (no rep timings exist)", () => {
    const logOnly = { met: 6, durationMs: 1_800_000, reps: 10, tempoMsAvg: null, logOnly: true };
    expect(kcalPointForSetsV2([logOnly], 70, { restSeconds: 0, durationSeconds: undefined })).toBe(
      kcalPointForSets([logOnly], 70), // = 210
    );
  });

  it("rest breaks are billed at REST_MET via restSeconds", () => {
    // 210 (log-only above) + 1.8 × 70 × (600/3600) = 210 + 21 = 231.
    const logOnly = { met: 6, durationMs: 1_800_000, reps: 10, tempoMsAvg: null, logOnly: true };
    expect(kcalPointForSetsV2([logOnly], 70, { restSeconds: 600, durationSeconds: undefined })).toBe(231);
  });

  it("rep time is CAPPED at the set span (reps × tempo can exceed it after rounding)", () => {
    // 100 × 3000 = 300000 > span 150000 → the whole span at MET, idle 0 —
    // identical to v1's 17.5 → 18, and never a negative idle term.
    const over = { met: 6, durationMs: 150_000, reps: 100, tempoMsAvg: 3_000, logOnly: false };
    expect(kcalPointForSetsV2([over], 70, { restSeconds: 0, durationSeconds: undefined })).toBe(18);
  });

  it("the timer cap keeps PAUSED time out of the idle bill", () => {
    // Same set as the Kd scenario, but the span's 120 s of 'idle' contains a
    // 90 s pause: the timer (which stops on pause) read only 60 s total, so
    // chargeable idle = 60 − 30 = 30 s, not 120.
    // 6×70×(30000/3.6e6) + 1.8×70×(30000/3.6e6) = 3.5 + 1.05 = 4.55 → 5.
    expect(kcalPointForSetsV2([kdSet], 70, { restSeconds: 0, durationSeconds: 60 })).toBe(5);
    // And the cap never LIFTS the bill: a timer longer than the span-idle
    // (real between-set standing time) leaves the span-derived idle as-is.
    expect(kcalPointForSetsV2([kdSet], 70, { restSeconds: 0, durationSeconds: 600 })).toBe(8);
  });

  it("falls back to 70 kg on null weight, exactly as v1 does", () => {
    const set = { met: 6, durationMs: 150_000, reps: 10, tempoMsAvg: 3_000, logOnly: false };
    expect(kcalPointForSetsV2([set], null, { restSeconds: 0, durationSeconds: undefined })).toBe(8);
  });
});

describe("kcal v3 (Kd-ruled 2026-08-14: bill the time the camera WATCHED, guess nothing)", () => {
  const noSession = { restSeconds: 0, durationSeconds: undefined };

  it("charges NOTHING for the stretch the camera could not watch", () => {
    // Kd's own scenario, now with the missing fact: the camera was on for
    // 150 s but could only WATCH 30 s of it, and the 10 reps happened inside
    // that 30 s. v2 had no way to know, so it billed the other 120 s as
    // resting; v3 bills it as what it was — time nobody measured.
    // v3 = 6×70×(30000/3.6e6) = 3.5 → 4.
    const set = { met: 6, durationMs: 150_000, reps: 10, tempoMsAvg: 3_000, logOnly: false };
    expect(kcalPointForSetsV3([{ ...set, watchedMs: 30_000 }], 70, noSession)).toBe(4);
    // The v2 comparator on the identical set: 3.5 + 1.8×70×(120000/3.6e6) = 7.7 → 8.
    expect(kcalPointForSetsV2([set], 70, noSession)).toBe(8);
  });

  it("bills a set with NO measurable rate at its watched time, not at a guess", () => {
    // THE ~20% UNDER-BILL, closed. 5 reps, the camera watched 60 s of the set
    // and never saw one rep end to end, so the engine reports no rate at all.
    // v3 charges the watched 60 s: 6×70×(60000/3.6e6) = 7.0 → 7.
    const rateless = {
      met: 6,
      durationMs: 150_000,
      reps: 5,
      tempoMsAvg: null,
      logOnly: false,
      watchedMs: 60_000,
    };
    expect(kcalPointForSetsV3([rateless], 70, noSession)).toBe(7);
    // AND THE COMPARISON THAT JUSTIFIES REMOVING THE ENGINE'S FALLBACK. Had
    // the engine kept guessing a rate from the half-seen reps — each watched
    // for ~80% of its real length, so 9,600 ms where the truth is 12,000 — the
    // same set prices at 5.6 + 1.8×70×(12000/3.6e6) = 6.02 → 6. Lower than the
    // watched time can possibly justify, which is the inversion of Kd's part 2
    // that :7487 recorded and this closes.
    expect(kcalPointForSetsV3([{ ...rateless, tempoMsAvg: 9_600 }], 70, noSession)).toBe(6);
  });

  it("a ZERO-rep set still charges nothing at the exercise MET, watched or not", () => {
    // Kd's 2026-08-10 defect stays fixed: `reps > 0` is what separates "we
    // could not time the reps" from "there were no reps". A camera watching an
    // empty room the whole time bills the REST rate and nothing more.
    // 1.8×70×(150000/3.6e6) = 5.25 → 5.
    const idle = { met: 6, durationMs: 150_000, reps: 0, tempoMsAvg: null, logOnly: false };
    expect(kcalPointForSetsV3([{ ...idle, watchedMs: 150_000 }], 70, noSession)).toBe(5);
    // And an empty room the camera could not even watch costs nothing at all.
    expect(kcalPointForSetsV3([{ ...idle, watchedMs: 0 }], 70, noSession)).toBe(0);
  });

  it("the timer is a BUDGET: a pause inside the watched time cannot be billed as exercise", () => {
    // A pause stops the frames but not their timestamps, and no frames arriving
    // is indistinguishable to the engine from a slow camera — so a 90 s pause
    // lands inside `watchedMs`. The on-screen timer is the one measurement that
    // stops: it read 60 s, so at most 60 s of exercise can be charged.
    // 6×70×(60000/3.6e6) = 7.0 → 7, and idle is budget-exhausted at 0.
    const paused = {
      met: 6,
      durationMs: 150_000,
      reps: 5,
      tempoMsAvg: null,
      logOnly: false,
      watchedMs: 150_000,
    };
    expect(kcalPointForSetsV3([paused], 70, { restSeconds: 0, durationSeconds: 60 })).toBe(7);
    // Without the timer (a client older than 2026-08-07) there is no pause
    // information at all, so the budget is infinite rather than invented:
    // 6×70×(150000/3.6e6) = 17.5 → 18.
    expect(kcalPointForSetsV3([paused], 70, noSession)).toBe(18);
  });

  it("the MEASURED pause case: 15 kcal of squatting becomes the 1 kcal that really happened", () => {
    // NOT A HYPOTHETICAL — these are the engine's own outputs, swept over this
    // package's squat clip with a 120 s pause spliced at every frame boundary
    // (2026-08-14): 70 of 84 positions produce span 128,400 ms, `watchedMs`
    // 128,400 (the pause is inside it — the engine cannot see a gap where no
    // frames arrive) and `tempoMsAvg` 63,500 against 8,400 ms really watched.
    //
    // So watched time ALONE does not fix a pause, and the timer is what does:
    // it ran 8.4 s, and 8 s at MET 6 is 0.93 → 1 kcal, which is the truth
    // (8,400 ms → 0.98). Unbudgeted the same set bills 127,000 ms → 14.82 → 15.
    const paused = {
      met: 6,
      durationMs: 128_400,
      reps: 2,
      tempoMsAvg: 63_500,
      logOnly: false,
      watchedMs: 128_400,
    };
    expect(kcalPointForSetsV3([paused], 70, { restSeconds: 0, durationSeconds: 8 })).toBe(1);
    expect(kcalPointForSetsV3([paused], 70, noSession)).toBe(15);
    // v2 on the identical set bills the same 15 — the defect is PRE-EXISTING
    // and this card neither introduces nor (without the timer) removes it.
    expect(kcalPointForSetsV2([paused], 70, noSession)).toBe(15);
  });

  it("budget-trimmed exercise time does NOT leak back in as idle", () => {
    // The trap in a running budget, answered with a test rather than by
    // reasoning: once the budget is spent, each later set's `watched - repMs`
    // grows by exactly what was refused — and if that landed in the idle term
    // it would come straight back at REST_MET, turning a cap into a discount.
    // Two 100 s sets, both fully watched, neither with a measurable rate, and a
    // timer that saw only 60 s: 6×70×(60000/3.6e6) = 7.0 → 7, and idle is 0
    // because the timer has nothing left to give it.
    const s = {
      met: 6,
      durationMs: 100_000,
      reps: 5,
      tempoMsAvg: null,
      logOnly: false,
      watchedMs: 100_000,
    };
    expect(kcalPointForSetsV3([s, s], 70, { restSeconds: 0, durationSeconds: 60 })).toBe(7);
    // And the cap must not bite an honest workout: the same two sets under a
    // 300 s timer bill both in full — 6×70×(200000/3.6e6) = 23.33 → 23.
    expect(kcalPointForSetsV3([s, s], 70, { restSeconds: 0, durationSeconds: 300 })).toBe(23);
  });

  it("clamps a watched time longer than the set itself", () => {
    // The write path clamps too, but the function must be honest about its own
    // input rather than about its caller — a set cannot be watched for longer
    // than it lasted, whoever says otherwise.
    const set = { met: 6, durationMs: 150_000, reps: 5, tempoMsAvg: null, logOnly: false };
    expect(kcalPointForSetsV3([{ ...set, watchedMs: 999_999_999 }], 70, noSession)).toBe(
      kcalPointForSetsV3([{ ...set, watchedMs: 150_000 }], 70, noSession),
    );
  });

  it("a set that never reported watched time prices exactly as v2 did", () => {
    // A payload can be mixed: one client version's sets alongside a hand-counted
    // one. `null` means NOBODY TOLD US, and the honest fallback for that set is
    // the whole span — which is v2's behaviour, byte for byte.
    const set = { met: 6, durationMs: 150_000, reps: 10, tempoMsAvg: 3_000, logOnly: false };
    expect(kcalPointForSetsV3([{ ...set, watchedMs: null }], 70, noSession)).toBe(
      kcalPointForSetsV2([set], 70, noSession),
    );
  });

  it("a log-only set keeps the v1 treatment, and rest breaks still bill at REST_MET", () => {
    const logOnly = {
      met: 6,
      durationMs: 1_800_000,
      reps: 10,
      tempoMsAvg: null,
      logOnly: true,
      watchedMs: null,
    };
    expect(kcalPointForSetsV3([logOnly], 70, noSession)).toBe(kcalPointForSets([logOnly], 70));
    // 210 + 1.8×70×(600/3600) = 231, unchanged from v2.
    expect(kcalPointForSetsV3([logOnly], 70, { restSeconds: 600, durationSeconds: undefined })).toBe(
      231,
    );
  });

  it("bills a hand-counted set against the workout's own timer, and makes sets share it", () => {
    // THE ONE v3 RULE NOTHING REACHED. v2 billed a log-only span in full and
    // never trimmed it, so the budget cap on this branch is new behaviour —
    // and every mutant on this file (A1–A5) sits on the ENGINE-SET branch, so
    // removing the cap left the whole suite GREEN (measured ALIVE, 2026-08-15,
    // before this test existed). It matters because the log-only branch is
    // what prices the 55 exercises with no engine definition: a hand-counted
    // set claiming half an hour inside a ten-minute workout is billed for ten.
    const logOnly = {
      met: 6,
      durationMs: 1_800_000,
      reps: 10,
      tempoMsAvg: null,
      logOnly: true,
      watchedMs: null,
    };
    // 30 minutes claimed, 10 minutes of workout: 6×70×(600/3600) = 70, not 210.
    expect(kcalPointForSetsV3([logOnly], 70, { restSeconds: 0, durationSeconds: 600 })).toBe(70);
    // AND THE SETS SHARE ONE BUDGET rather than each getting the whole timer —
    // two sets of 400 s inside a 600 s workout are billed 400 + 200, so the
    // pair costs the same 70 as the single set above, not 93.
    const half = { ...logOnly, durationMs: 400_000 };
    expect(kcalPointForSetsV3([half, half], 70, { restSeconds: 0, durationSeconds: 600 })).toBe(70);
  });

  it("falls back to 70 kg on null weight, exactly as v1 and v2 do", () => {
    const set = {
      met: 6,
      durationMs: 150_000,
      reps: 10,
      tempoMsAvg: 3_000,
      logOnly: false,
      watchedMs: 30_000,
    };
    expect(kcalPointForSetsV3([set], null, noSession)).toBe(4);
    expect(kcalPointForSetsV3([set], DEFAULT_WEIGHT_KG, noSession)).toBe(4);
  });
});

describe("XP curve + accrual (badges.py port; DECISIONS 2026-07-24)", () => {
  it("xpForLevel matches badges.py:215-227 (int(100*(l-1)^1.8))", () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(100); //  1^1.8 = 1
    expect(xpForLevel(3)).toBe(348); //  2^1.8 = 3.4822
    expect(xpForLevel(4)).toBe(722); //  3^1.8 = 7.2247
  });

  it("levelForXp steps at each threshold and caps the loop at 200 (badges.py:230-237)", () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(99)).toBe(1);
    expect(levelForXp(100)).toBe(2);
    expect(levelForXp(347)).toBe(2);
    expect(levelForXp(348)).toBe(3);
    expect(levelForXp(721)).toBe(3);
    expect(levelForXp(722)).toBe(4);
    // The ported `if level > 200: break` bounds the loop — a huge total can
    // never spin it away or exceed the cap.
    expect(levelForXp(1e15)).toBe(201);
  });

  it("xpProgress reports level, in-level XP and pct (badges.py:240-253)", () => {
    expect(xpProgress(0)).toEqual({
      level: 1,
      xp: 0,
      xpInLevel: 0,
      xpForNext: 100,
      progressPct: 0,
      nextLevelAt: 100,
    });
    // 400 XP → level 3 (base 348, next 722): 52 into a 374 span = 13.9%.
    expect(xpProgress(400)).toEqual({
      level: 3,
      xp: 400,
      xpInLevel: 52,
      xpForNext: 374,
      progressPct: 13.9,
      nextLevelAt: 722,
    });
  });

  it("computeTotalXp sums the ported components (workouts.py:216-300)", () => {
    // 4 workouts, all excellent form, 2 streak-continuation days, 2 bronze badges
    expect(
      computeTotalXp({
        workoutCount: 4,
        perfectFormWorkouts: 0,
        excellentFormWorkouts: 4,
        streakContinuationDays: 2,
        badgeXp: 100,
      }),
    ).toBe(400); // 200 + 0 + 80 + 20 + 100
    // one perfect-form workout, no streak, no badges: 50 base + 50 perfect
    expect(
      computeTotalXp({
        workoutCount: 1,
        perfectFormWorkouts: 1,
        excellentFormWorkouts: 0,
        streakContinuationDays: 0,
        badgeXp: 0,
      }),
    ).toBe(100);
  });

  it("countStreakContinuationDays counts consecutive-calendar-day pairs only (D5)", () => {
    expect(countStreakContinuationDays(["2026-07-10", "2026-07-11", "2026-07-12"])).toBe(2);
    expect(countStreakContinuationDays(["2026-07-10", "2026-07-12"])).toBe(0); // 1-day gap = reset
    // input order must not matter (getActivityDays is sorted, but pin it)
    expect(countStreakContinuationDays(["2026-07-12", "2026-07-10", "2026-07-11"])).toBe(2);
    expect(countStreakContinuationDays([])).toBe(0);
    expect(countStreakContinuationDays(["2026-07-10"])).toBe(0);
  });

  it("badgeXpForCodes sums by tier (badges.py:11-16); unknown code = 0", () => {
    expect(badgeXpForCodes(["first_workout"])).toBe(50); // bronze
    expect(badgeXpForCodes(["first_workout", "streak_3"])).toBe(100); // bronze + bronze
    expect(badgeXpForCodes(["fifty_workouts"])).toBe(400); // gold
    expect(badgeXpForCodes(["hundred_workouts"])).toBe(1000); // platinum
    expect(badgeXpForCodes(["not_a_badge"])).toBe(0);
    expect(badgeXpForCodes([])).toBe(0);
  });
});
