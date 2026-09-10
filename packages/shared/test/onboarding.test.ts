// Onboarding v2 contracts (ROADMAP Stage 1 item 4a): the one main goal and the
// direction derived from it, the save-as-you-go body, and the promise the
// response makes about when a number exists.
import { describe, expect, it } from "vitest";
import {
  equipmentSchema,
  fitnessGoalSchema,
  onboardingAnswersSchema,
  onboardingResponseSchema,
  patchOnboardingRequestSchema,
  planGoalSchema,
  putFitnessProfileRequestSchema,
  PLAN_GOAL_BY_MAIN_GOAL,
  updateProfileRequestSchema,
} from "../src/index.js";

describe("the one main goal", () => {
  it("offers exactly the seven goals the app already offered — nothing was taken away", () => {
    expect(Object.keys(PLAN_GOAL_BY_MAIN_GOAL).sort()).toEqual([...fitnessGoalSchema.options].sort());
  });

  it("maps every goal to a direction the maths knows", () => {
    for (const [goal, direction] of Object.entries(PLAN_GOAL_BY_MAIN_GOAL)) {
      expect(planGoalSchema.safeParse(direction).success, goal).toBe(true);
    }
  });

  it("moves the weight on purpose for exactly two of them (Kd, 2026-09-09)", () => {
    const moving = Object.entries(PLAN_GOAL_BY_MAIN_GOAL)
      .filter(([, direction]) => direction !== "maintain")
      .map(([goal]) => goal)
      .sort();
    expect(moving).toEqual(["muscle_gain", "weight_loss"]);
    expect(PLAN_GOAL_BY_MAIN_GOAL.weight_loss).toBe("lose");
    expect(PLAN_GOAL_BY_MAIN_GOAL.muscle_gain).toBe("gain");
  });
});

describe("one screen's save", () => {
  it("takes any one screen on its own, and an empty body", () => {
    for (const body of [
      {},
      { mainGoal: "weight_loss" },
      { age: 30, gender: "female", heightCm: 165, weightKg: 70 },
      { targetWeightKg: 65, pace: "steady" },
      { dayActivity: "sitting" },
      { fitnessLevel: "beginner", pushUpsMax: 12, plankHoldSeconds: 45 },
      { trainingDays: 3, sessionMinutes: 45 },
      { availableEquipment: ["dumbbells"] },
      { onboardingCompleted: true },
    ]) {
      expect(patchOnboardingRequestSchema.safeParse(body).success, JSON.stringify(body)).toBe(true);
    }
  });

  it("lets a screen 5 answer be skipped, and told apart from never asked", () => {
    // An explicit null CLEARS; an absent key leaves the answer alone. Both are
    // accepted, and the two are different bodies — that is what "skip, I'll
    // rate myself" needs in order not to overwrite yesterday's answer.
    expect(patchOnboardingRequestSchema.parse({ pushUpsMax: null })).toEqual({ pushUpsMax: null });
    expect(patchOnboardingRequestSchema.parse({})).toEqual({});
  });

  it("never accepts the derived direction, the day, or a plan number from a client", () => {
    for (const body of [
      { goal: "lose" },
      { planGoal: "lose" },
      { today: "2030-01-01" },
      { targetKcal: 1200 },
      { safeMode: false },
      { mainGoal: "get_ripped" },
      { availableEquipment: ["dumbbells", "dumbbells"] },
    ]) {
      expect(patchOnboardingRequestSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  /** THE POINT OF THIS TEST is that three of these answers are ONE column asked
   *  by two screens (migration 0026's note: `trainingDays` IS
   *  `exercise_frequency`, `sessionMinutes` IS `session_duration_min`). If the
   *  two contracts' rails ever drift, the same person's answer becomes
   *  acceptable on one screen and refused on the other — so the rails are
   *  asserted against each other, at the boundary, rather than restated. */
  it("keeps the shared columns' rails identical to the v1 profile's", () => {
    const bothAgree = (value: number, v1: string, v2: string) => {
      const a = putFitnessProfileRequestSchema.safeParse({ [v1]: value }).success;
      const b = patchOnboardingRequestSchema.safeParse({ [v2]: value }).success;
      expect(b, `${v2}=${String(value)} disagrees with ${v1}`).toBe(a);
      return a;
    };
    expect(bothAgree(0, "exerciseFrequency", "trainingDays")).toBe(false);
    expect(bothAgree(1, "exerciseFrequency", "trainingDays")).toBe(true);
    expect(bothAgree(7, "exerciseFrequency", "trainingDays")).toBe(true);
    expect(bothAgree(8, "exerciseFrequency", "trainingDays")).toBe(false);
    expect(bothAgree(4, "sessionDurationMin", "sessionMinutes")).toBe(false);
    expect(bothAgree(5, "sessionDurationMin", "sessionMinutes")).toBe(true);
    expect(bothAgree(240, "sessionDurationMin", "sessionMinutes")).toBe(true);
    expect(bothAgree(241, "sessionDurationMin", "sessionMinutes")).toBe(false);
    // The age rail is the ruled one on both (RULINGS 2026-09-07: 16 and over).
    expect(bothAgree(15, "age", "age")).toBe(false);
    expect(bothAgree(16, "age", "age")).toBe(true);

    // Equipment is one column asked by two screens as well. Its CAP is not
    // pinned here and cannot be: the two surfaces share one rail object
    // (`equipmentArraySchema`), whose cap is the number of kinds the enum has,
    // so no surface can raise it alone and no array of unique kinds can reach
    // it. What a person could see is the two screens taking different answers,
    // and that is asked of EVERY combination there is below.
    const bothTakeEquipment = (value: string[]) => {
      const a = putFitnessProfileRequestSchema.safeParse({ availableEquipment: value }).success;
      const b = patchOnboardingRequestSchema.safeParse({ availableEquipment: value }).success;
      const differsOnlyByTheNoneRule = a && !b && value.includes("none") && value.length > 1;
      expect(differsOnlyByTheNoneRule || b === a, `availableEquipment ${JSON.stringify(value)} disagrees`).toBe(
        true,
      );
      return a;
    };
    // All 32 subsets of the five kinds, in every size, including the whole set.
    const kinds = [...equipmentSchema.options];
    for (let mask = 0; mask < 1 << kinds.length; mask++) {
      const subset = kinds.filter((_, i) => (mask & (1 << i)) !== 0);
      expect(bothTakeEquipment(subset), `the v1 profile refused ${JSON.stringify(subset)}`).toBe(true);
    }
    expect(bothTakeEquipment(["dumbbells", "dumbbells"])).toBe(false);
    expect(bothTakeEquipment(["barbell"])).toBe(false);
  });

  it("takes screen 2's name on the profile form's own rail: trimmed, 1 to 100 characters, never cleared", () => {
    expect(patchOnboardingRequestSchema.parse({ displayName: "  Kd  " })).toEqual({ displayName: "Kd" });
    expect(patchOnboardingRequestSchema.safeParse({ displayName: "x".repeat(100) }).success).toBe(true);
    // The two surfaces write one column, so they refuse the same names.
    for (const displayName of ["", "   ", "x".repeat(101), null]) {
      expect(patchOnboardingRequestSchema.safeParse({ displayName }).success, JSON.stringify(displayName)).toBe(false);
      expect(updateProfileRequestSchema.safeParse({ displayName }).success, JSON.stringify(displayName)).toBe(false);
    }
  });

  it("refuses 'no equipment' beside real equipment — the one rail v2 holds tighter", () => {
    // Screen 7 asks one question and takes one answer: "none and dumbbells"
    // would reach the plan builder (6a) as two contradictory ones.
    expect(patchOnboardingRequestSchema.safeParse({ availableEquipment: ["none"] }).success).toBe(true);
    expect(patchOnboardingRequestSchema.safeParse({ availableEquipment: ["none", "dumbbells"] }).success).toBe(false);
    // The v1 profile is deliberately left as it was: its live web form is a
    // free multi-select that can still send that pair, and refusing it there
    // would be a save the person cannot complete. That is the ONE place the two
    // rails differ, and it is pinned so it cannot spread by accident.
    expect(putFitnessProfileRequestSchema.safeParse({ availableEquipment: ["none", "dumbbells"] }).success).toBe(true);
  });
});

describe("what the server answers with", () => {
  const answers = onboardingAnswersSchema.parse({
    displayName: "Kd",
    mainGoal: null,
    age: null,
    gender: null,
    heightCm: null,
    weightKg: null,
    targetWeightKg: null,
    pace: null,
    dayActivity: null,
    fitnessLevel: null,
    pushUpsMax: null,
    plankHoldSeconds: null,
    trainingDays: null,
    sessionMinutes: null,
    availableEquipment: [],
    onboardingCompleted: false,
    updatedAt: null,
  });

  it("refuses a number beside a list of what is missing, and a silence beside neither", () => {
    // The screens' whole promise: a number exists, or an honest account of what
    // it still needs — never both, and never neither.
    expect(onboardingResponseSchema.safeParse({ answers, plan: null, missing: ["age"] }).success).toBe(true);
    expect(onboardingResponseSchema.safeParse({ answers, plan: null, missing: [] }).success).toBe(false);
  });

  it("refuses an answer the contract does not name", () => {
    expect(onboardingAnswersSchema.safeParse({ ...answers, medicalConditions: "none" }).success).toBe(false);
  });

  it("always carries the name the app calls the person", () => {
    const { displayName: _name, ...nameless } = answers;
    expect(onboardingAnswersSchema.safeParse(nameless).success).toBe(false);
  });
});
