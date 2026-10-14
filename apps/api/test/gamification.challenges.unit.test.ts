// Weekly challenges (ROADMAP 35b), the pure rule: which challenges a person gets, how far
// along each is, the XP they pay and the week's edges. A table over every class of case.
import { describe, expect, it } from "vitest";
import type { WeeklyChallengeCode } from "@app/shared";
import {
  CHALLENGES,
  NO_FACTS,
  SAFE_MODE_CHALLENGES,
  challengeOf,
  challengeXp,
  codesToHold,
  measureChallenge,
  pausedBySafeMode,
  pickChallenges,
  weekOf,
  type FitnessLevel,
  type PickInput,
  type WeekFacts,
} from "../src/modules/gamification/challenges.js";

const LEVELS: (FitnessLevel | null)[] = [null, "beginner", "intermediate", "advanced"];
const EFFORT = new Set(["kcal_burned", "training_minutes", "form_80_workouts", "form_90_workouts", "families"]);

/** 40 people over 12 weeks, so the hash's every ordering class turns up. */
const PEOPLE = Array.from({ length: 40 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
const WEEKS = Array.from({ length: 12 }, (_, i) => weekOf(`2026-0${String(1 + Math.floor(i / 4))}-${String(5 + (i % 4) * 7).padStart(2, "0")}`).weekStart);

function* everyInput(): Generator<PickInput> {
  for (const userId of PEOPLE)
    for (const weekStart of WEEKS)
      for (const fitnessLevel of LEVELS)
        for (const safeMode of [false, true])
          for (const weightKnown of [false, true])
            for (const usedCamera of [false, true]) yield { userId, weekStart, fitnessLevel, safeMode, weightKnown, usedCamera };
}

describe("THE WORST THING: somebody in Safe mode is told to push harder", () => {
  it("Safe mode gets only training on 3 days and logging food, at every level, weight and camera", () => {
    let cases = 0;
    for (const input of everyInput()) {
      if (!input.safeMode) continue;
      cases++;
      const picked = pickChallenges(input);
      expect(picked).toEqual(["train_days_3", "food_days_5"]);
      for (const code of picked) {
        expect(EFFORT.has(challengeOf(code).measure)).toBe(false);
        expect(challengeOf(code).target).toBeLessThanOrEqual(5);
      }
    }
    expect(cases).toBe(40 * 12 * 4 * 4);
  });

  it("Safe mode turned on after the week was picked pauses every challenge but the two gentle ones", () => {
    for (const c of CHALLENGES) {
      expect(pausedBySafeMode(c.code), c.code).toBe(!SAFE_MODE_CHALLENGES.includes(c.code));
      expect(measureChallenge(c.code, NO_FACTS, true).held).toEqual({ code: "safe_mode" });
      expect(measureChallenge(c.code, NO_FACTS, false).held).toBeNull();
    }
  });

  it("Safe mode pauses what is not yet done, keeps what is, and never lets a paused one go", () => {
    const allDone: WeekFacts = { trainingDays: 7, kcalBurned: 9000, trainingMinutes: 900, form80Workouts: 9, form90Workouts: 9, families: 12, foodDays: 7 };
    const partWeek: WeekFacts = { ...NO_FACTS, trainingDays: 2, kcalBurned: 1600, trainingMinutes: 100 };
    const picked: WeeklyChallengeCode[] = ["train_days_3", "burn_kcal_1500", "train_minutes_120"];
    expect(codesToHold(picked, [], partWeek)).toEqual(["train_minutes_120"]);
    // Done later in the week, still paused.
    expect(codesToHold(picked, ["train_minutes_120"], { ...partWeek, trainingMinutes: 150 })).toEqual(["train_minutes_120"]);
    for (const c of CHALLENGES) {
      const expectedWhenNotDone = pausedBySafeMode(c.code) ? [c.code] : [];
      expect(codesToHold([c.code], [], NO_FACTS), c.code).toEqual(expectedWhenNotDone);
      expect(codesToHold([c.code], [], allDone), c.code).toEqual([]);
    }
  });

  it("a paused challenge pays nothing for its week, however done it is, and only for that week", () => {
    const all = (n: number): WeekFacts => ({ trainingDays: n, kcalBurned: 9000, trainingMinutes: 900, form80Workouts: 9, form90Workouts: 9, families: 12, foodDays: n });
    for (const c of CHALLENGES) {
      const paused = [
        { weekStart: "2026-10-05", codes: [c.code], heldCodes: [c.code] },
        { weekStart: "2026-10-12", codes: [c.code], heldCodes: [] },
      ];
      const facts = new Map([["2026-10-05", all(7)], ["2026-10-12", all(7)]]);
      expect(challengeXp(paused, facts), c.code).toBe(c.xp);
    }
  });
});

describe("picking the week's three", () => {
  const MIX: Record<FitnessLevel, string[]> = {
    beginner: ["easy", "easy", "medium"],
    intermediate: ["easy", "hard", "medium"],
    advanced: ["hard", "hard", "medium"],
  };

  it("every person, week, level, weight and camera: three, each counting something different, in the level's mix", () => {
    let cases = 0;
    for (const input of everyInput()) {
      if (input.safeMode) continue;
      cases++;
      const picked = pickChallenges(input);
      const templates = picked.map(challengeOf);
      expect(picked).toHaveLength(3);
      expect(new Set(templates.map((t) => t.measure)).size).toBe(3);
      expect(templates.filter((t) => t.measure.startsWith("form_")).length).toBeLessThanOrEqual(1);
      expect(templates.map((t) => t.difficulty).sort()).toEqual(MIX[input.fitnessLevel ?? "beginner"]);
      if (!input.weightKnown) expect(templates.some((t) => t.measure === "kcal_burned")).toBe(false);
      if (!input.usedCamera) expect(templates.some((t) => t.measure.startsWith("form_"))).toBe(false);
    }
    expect(cases).toBe(40 * 12 * 4 * 4);
  });

  it("the same person, week and answers always get the same three", () => {
    for (const input of everyInput()) expect(pickChallenges(input)).toEqual(pickChallenges({ ...input }));
  });

  it("different people and weeks get different challenges: no one set for everybody", () => {
    const seen = new Set<string>();
    for (const userId of PEOPLE)
      for (const weekStart of WEEKS)
        seen.add(pickChallenges({ userId, weekStart, fitnessLevel: "intermediate", safeMode: false, weightKnown: true, usedCamera: true }).join(","));
    expect(seen.size).toBeGreaterThan(10);
  });

  it("every challenge on the list can be picked for somebody", () => {
    const seen = new Set<WeeklyChallengeCode>();
    for (const input of everyInput()) for (const code of pickChallenges(input)) seen.add(code);
    expect([...seen].sort()).toEqual(CHALLENGES.map((c) => c.code).sort());
  });

  it("an unanswered level is picked as a beginner", () => {
    for (const userId of PEOPLE.slice(0, 5)) {
      const base = { userId, weekStart: "2026-10-12", safeMode: false, weightKnown: true, usedCamera: true };
      expect(pickChallenges({ ...base, fitnessLevel: null })).toEqual(pickChallenges({ ...base, fitnessLevel: "beginner" }));
    }
  });
});

describe("how far along a challenge is", () => {
  const facts = (over: Partial<WeekFacts>): WeekFacts => ({ ...NO_FACTS, ...over });
  const table: [WeeklyChallengeCode, Partial<WeekFacts>, number, boolean][] = [
    ["train_days_3", { trainingDays: 2 }, 2, false],
    ["train_days_3", { trainingDays: 3 }, 3, true],
    ["train_days_7", { trainingDays: 6 }, 6, false],
    ["burn_kcal_1500", { kcalBurned: 1499 }, 1499, false],
    ["burn_kcal_1500", { kcalBurned: 1500 }, 1500, true],
    ["burn_kcal_3000", { kcalBurned: 3200 }, 3200, true],
    ["train_minutes_120", { trainingMinutes: 119 }, 119, false],
    ["train_minutes_300", { trainingMinutes: 300 }, 300, true],
    ["form_80_workouts_3", { form80Workouts: 3, form90Workouts: 0 }, 3, true],
    ["form_90_workouts_3", { form80Workouts: 5, form90Workouts: 2 }, 2, false],
    ["families_3", { families: 3 }, 3, true],
    ["families_5", { families: 4 }, 4, false],
    ["food_days_5", { foodDays: 5 }, 5, true],
    ["food_days_7", { foodDays: 6 }, 6, false],
    // Only its own fact counts: a week full of everything else moves nothing.
    ["food_days_5", { trainingDays: 7, kcalBurned: 9000, trainingMinutes: 900, families: 12 }, 0, false],
    ["train_days_3", { foodDays: 7, kcalBurned: 9000 }, 0, false],
  ];
  it.each(table)("%s with %o reads %i, done %s", (code, over, current, done) => {
    const m = measureChallenge(code, facts(over), false);
    expect(m).toMatchObject({ code, current, done, target: challengeOf(code).target, xp: challengeOf(code).xp });
  });

  it("every challenge reads 0 and not done in an empty week", () => {
    for (const c of CHALLENGES) expect(measureChallenge(c.code, NO_FACTS, false)).toMatchObject({ current: 0, done: false });
  });
});

describe("XP from challenges", () => {
  const done = (over: Partial<WeekFacts>): WeekFacts => ({ ...NO_FACTS, ...over });

  it("a done challenge pays its XP once; one not done pays nothing", () => {
    const weeks = [{ weekStart: "2026-10-05", codes: ["train_days_3", "food_days_5", "families_3"] as WeeklyChallengeCode[], heldCodes: [] }];
    const facts = new Map([["2026-10-05", done({ trainingDays: 4, foodDays: 2, families: 3 })]]);
    expect(challengeXp(weeks, facts)).toBe(200 + 250);
    expect(challengeXp(weeks, facts)).toBe(200 + 250);
  });

  it("weeks add up, and a week with no workouts or meals pays nothing", () => {
    const weeks = [
      { weekStart: "2026-09-28", codes: ["train_days_7"] as WeeklyChallengeCode[], heldCodes: [] },
      { weekStart: "2026-10-05", codes: ["train_days_7"] as WeeklyChallengeCode[], heldCodes: [] },
      { weekStart: "2026-10-12", codes: ["train_days_7"] as WeeklyChallengeCode[], heldCodes: [] },
    ];
    const facts = new Map([
      ["2026-09-28", done({ trainingDays: 7 })],
      ["2026-10-05", done({ trainingDays: 7 })],
    ]);
    expect(challengeXp(weeks, facts)).toBe(1400);
  });

  it("one week's facts never count for another week", () => {
    const weeks = [{ weekStart: "2026-10-12", codes: ["food_days_5"] as WeeklyChallengeCode[], heldCodes: [] }];
    expect(challengeXp(weeks, new Map([["2026-10-05", done({ foodDays: 7 })]]))).toBe(0);
  });

  it("no weeks, no XP", () => {
    expect(challengeXp([], new Map())).toBe(0);
  });
});

describe("the week", () => {
  const table: [string, string, string][] = [
    ["2026-10-12", "2026-10-12", "2026-10-18"], // a Monday is its own start
    ["2026-10-18", "2026-10-12", "2026-10-18"], // a Sunday ends its week
    ["2026-10-14", "2026-10-12", "2026-10-18"],
    ["2026-01-01", "2025-12-29", "2026-01-04"], // across the new year
    ["2028-02-29", "2028-02-28", "2028-03-05"], // a leap day
    ["2026-03-29", "2026-03-23", "2026-03-29"], // the clocks change in Europe that Sunday
  ];
  it.each(table)("%s is in the week %s to %s", (day, weekStart, weekEnd) => {
    expect(weekOf(day)).toEqual({ weekStart, weekEnd });
  });
});
