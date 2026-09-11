// Onboarding v2 — the stored answers, as the pure calculator's input
// (ROADMAP Stage 1 item 4a, server half).
//
// PURE, like maths.ts beside it: `today` is passed in, never read from a clock
// here, so the same answers always produce the same plan. The route is the only
// place a clock is read.
//
// Two shapes, one direction. What the screens save is `OnboardingAnswers`, where
// an unanswered question is `null` and screen 1's goals are a list. What the
// calculator takes is `PlanAnswers`, where an unanswered question is absent and
// the one goal it reads is a yes or a no. This file is the only crossing.
import { planAnswersSchema, type OnboardingAnswers, type PlanAnswers, type PlanHealth } from "@app/shared";

export interface PlanAnswerInput {
  answers: OnboardingAnswers;
  /** The stored health screening, or null while it is unanswered — which the
   *  calculator reads as "no condition rule yet", never as a no. */
  health: PlanHealth | null;
  /** YYYY-MM-DD in the person's own time zone. */
  today: string;
}

/** The stored answers as the calculator's input.
 *
 *  Parsed through the shared contract rather than handed over raw: a stored
 *  value outside the plan's rails (a height the column allows and the maths
 *  does not) fails loud here instead of producing a number nobody can explain
 *  (R1.3). Two writers reach these columns: `patchOnboardingRequestSchema`
 *  and the old profile form's `putFitnessProfileRequestSchema`; both carry
 *  the plan's rails today (the age rail was raised to 16 on both, and
 *  migration 0027 cleared the ages stored under the old 13), so this is a
 *  guard and not a routine branch. */
export function planAnswersFor(input: PlanAnswerInput): PlanAnswers {
  const a = input.answers;
  return planAnswersSchema.parse({
    // The weight choice IS the direction the maths works in (RULINGS
    // 2026-09-10): stored as it was asked, never derived from another goal.
    goal: a.weightGoal ?? undefined,
    age: a.age ?? undefined,
    gender: a.gender ?? undefined,
    heightCm: a.heightCm ?? undefined,
    weightKg: a.weightKg ?? undefined,
    targetWeightKg: a.targetWeightKg ?? undefined,
    pace: a.pace ?? undefined,
    dayActivity: a.dayActivity ?? undefined,
    trainingDays: a.trainingDays ?? undefined,
    sessionMinutes: a.sessionMinutes ?? undefined,
    // The one "also work on" goal the maths reads, and only for protein:
    // building muscle is not gaining weight (RULINGS 2026-09-11).
    buildMuscle: a.fitnessGoals.includes("muscle_gain"),
    health: input.health ?? undefined,
    today: input.today,
  });
}
