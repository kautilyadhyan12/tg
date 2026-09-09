// Onboarding v2 contracts (ROADMAP Stage 1 item 4a): the one main goal and the
// direction derived from it, the save-as-you-go body, and the promise the
// response makes about when a number exists.
import { describe, expect, it } from "vitest";
import {
  fitnessGoalSchema,
  onboardingAnswersSchema,
  onboardingResponseSchema,
  patchOnboardingRequestSchema,
  planGoalSchema,
  putFitnessProfileRequestSchema,
  PLAN_GOAL_BY_MAIN_GOAL,
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
  });
});

describe("what the server answers with", () => {
  const answers = onboardingAnswersSchema.parse({
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
});
