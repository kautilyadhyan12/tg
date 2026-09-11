// Onboarding v2 contracts (ROADMAP Stage 1 items 4a and 4a-iv): screen 1's
// weight choice and the goals beside it, the save-as-you-go body, and the
// promise the response makes about when a number exists.
import { describe, expect, it } from "vitest";
import {
  equipmentSchema,
  fitnessGoalSchema,
  onboardingAnswersSchema,
  onboardingResponseSchema,
  patchOnboardingRequestSchema,
  planGoalSchema,
  putFitnessProfileRequestSchema,
  updateProfileRequestSchema,
  weightGoalSchema,
} from "../src/index.js";

/** Every subset of `options`, the empty one and the whole set included. */
function subsets<T>(options: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let mask = 0; mask < 1 << options.length; mask++) out.push(options.filter((_, i) => (mask & (1 << i)) !== 0));
  return out;
}

describe("screen 1: one weight choice, and any number of goals beside it (RULINGS 2026-09-10)", () => {
  it("stores the weight choice as the direction the maths works in: one enum, nothing mapped between them", () => {
    expect(planGoalSchema).toBe(weightGoalSchema);
    expect([...weightGoalSchema.options].sort()).toEqual(["gain", "lose", "maintain"]);
  });

  it("offers the goals the rulings name: weight loss is a weight choice, not a goal, and three goals are new", () => {
    expect([...fitnessGoalSchema.options]).toEqual([
      "muscle_gain",
      "strength",
      "general_fitness",
      "endurance",
      "flexibility",
      "posture",
      "balance",
      "stress_relief",
      "stay_healthy",
    ]);
    expect(fitnessGoalSchema.safeParse("weight_loss").success).toBe(false);
  });

  it("takes any goals beside any weight choice, on both surfaces: building muscle while losing weight included", () => {
    for (const weightGoal of weightGoalSchema.options) {
      for (const fitnessGoals of subsets(fitnessGoalSchema.options)) {
        const body = { weightGoal, fitnessGoals };
        expect(patchOnboardingRequestSchema.safeParse(body).success, JSON.stringify(body)).toBe(true);
        expect(putFitnessProfileRequestSchema.safeParse(body).success, JSON.stringify(body)).toBe(true);
      }
    }
  });

  it("refuses the old one-goal field, weight loss as a goal, a goal twice, and a word that is not a choice, on both surfaces", () => {
    for (const body of [
      { mainGoal: "weight_loss" },
      { fitnessGoals: ["weight_loss"] },
      { fitnessGoals: ["posture", "posture"] },
      { weightGoal: "keep" }, // the screen's word; the stored value is "maintain"
      { weightGoal: "muscle_gain" }, // building muscle is not a weight choice
    ]) {
      expect(patchOnboardingRequestSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
      expect(putFitnessProfileRequestSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });
});

describe("one screen's save", () => {
  it("takes any one screen on its own, and an empty body", () => {
    for (const body of [
      {},
      { weightGoal: "lose", fitnessGoals: ["flexibility"] },
      { age: 30, gender: "female", heightCm: 165, weightKg: 70 },
      { targetWeightKg: 65, pace: "steady" },
      { dayActivity: "sitting" },
      { fitnessLevel: "beginner", pushUpsMax: 12, plankHoldSeconds: 45 },
      { trainingDays: 3, sessionMinutes: 45 },
      { availableEquipment: ["dumbbells", "gym"] },
      { onboardingCompleted: true },
    ]) {
      expect(patchOnboardingRequestSchema.safeParse(body).success, JSON.stringify(body)).toBe(true);
    }
  });

  it("lets a screen 5 answer be skipped, and told apart from never asked", () => {
    // An explicit null CLEARS; an absent key leaves the answer alone. Both are
    // accepted, and the two are different bodies — that is what "Not sure"
    // needs in order not to overwrite yesterday's answer.
    expect(patchOnboardingRequestSchema.parse({ pushUpsMax: null })).toEqual({ pushUpsMax: null });
    expect(patchOnboardingRequestSchema.parse({})).toEqual({});
  });

  it("never accepts the plan's own word for the direction, the day, or a plan number from a client", () => {
    for (const body of [
      { goal: "lose" },
      { planGoal: "lose" },
      { today: "2030-01-01" },
      { targetKcal: 1200 },
      { safeMode: false },
      { weightGoal: "get_ripped" },
      { availableEquipment: ["dumbbells", "dumbbells"] },
    ]) {
      expect(patchOnboardingRequestSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  /** THE POINT OF THIS TEST is that several of these answers are ONE column
   *  asked by two screens (migration 0026's note: `trainingDays` IS
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
    // so no surface can raise it alone and no set of unique kinds can reach
    // it. What a person could see is the two screens taking different
    // answers, and that is asked of EVERY combination there is below.
    for (const availableEquipment of subsets(equipmentSchema.options)) {
      const a = putFitnessProfileRequestSchema.safeParse({ availableEquipment }).success;
      const b = patchOnboardingRequestSchema.safeParse({ availableEquipment }).success;
      expect(b, `availableEquipment ${JSON.stringify(availableEquipment)} disagrees`).toBe(a);
      // Every set is taken but "no equipment" beside something else.
      expect(a, JSON.stringify(availableEquipment)).toBe(!availableEquipment.includes("none") || availableEquipment.length === 1);
    }
    for (const availableEquipment of [["dumbbells", "dumbbells"], ["barbell"]]) {
      expect(putFitnessProfileRequestSchema.safeParse({ availableEquipment }).success).toBe(false);
      expect(patchOnboardingRequestSchema.safeParse({ availableEquipment }).success).toBe(false);
    }
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

  it("refuses 'no equipment' beside anything else, a gym included, on both surfaces: one rail", () => {
    // "What do you have to train with?" takes one answer: "none and dumbbells"
    // would reach the plan builder (6a) as two contradictory ones. Both
    // screens make "No equipment" exclusive as you tap.
    for (const availableEquipment of [["none", "dumbbells"], ["none", "gym"]]) {
      expect(patchOnboardingRequestSchema.safeParse({ availableEquipment }).success).toBe(false);
      expect(putFitnessProfileRequestSchema.safeParse({ availableEquipment }).success).toBe(false);
    }
    for (const availableEquipment of [["none"], ["gym"], ["gym", "dumbbells"]]) {
      expect(patchOnboardingRequestSchema.safeParse({ availableEquipment }).success).toBe(true);
      expect(putFitnessProfileRequestSchema.safeParse({ availableEquipment }).success).toBe(true);
    }
  });
});

describe("what the server answers with", () => {
  const answers = onboardingAnswersSchema.parse({
    displayName: "Kd",
    weightGoal: null,
    fitnessGoals: [],
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
    expect(onboardingAnswersSchema.safeParse({ ...answers, mainGoal: null }).success).toBe(false);
  });

  it("always carries the name the app calls the person", () => {
    const nameless = Object.fromEntries(Object.entries(answers).filter(([key]) => key !== "displayName"));
    expect(Object.keys(nameless)).not.toContain("displayName");
    expect(onboardingAnswersSchema.safeParse(nameless).success).toBe(false);
  });
});
