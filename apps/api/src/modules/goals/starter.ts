// The app's own goals for a person who has finished setup (ROADMAP Stage 5 item 30b).
// PURE. Every number is the person's own answer; a goal the health rule would hold for
// them today is not given at all.
import { putGoalRequestSchema, type PutGoalRequest } from "@app/shared";
import { goalHeld, type GoalRules } from "./measure.js";

export interface StarterAnswers {
  trainingDays: number | null;
  sessionMinutes: number | null;
}

export function starterGoals(answers: StarterAnswers, rules: GoalRules): PutGoalRequest[] {
  const { trainingDays, sessionMinutes } = answers;
  const wanted = [
    ...(trainingDays === null ? [] : [{ kind: "training_days", period: "week", target: trainingDays, exerciseId: null }]),
    ...(trainingDays === null || sessionMinutes === null
      ? []
      : [{ kind: "active_minutes", period: "week", target: trainingDays * sessionMinutes, exerciseId: null }]),
    { kind: "calories_within", period: "day", target: null, exerciseId: null },
    { kind: "protein", period: "day", target: null, exerciseId: null },
    ...(rules.weightGoal === null ? [] : [{ kind: "weight", period: null, target: null, exerciseId: null }]),
  ];
  return wanted.flatMap((goal) => {
    // The shape a person's own goal must have; an answer that cannot make one gives none.
    const parsed = putGoalRequestSchema.safeParse(goal);
    return parsed.success && goalHeld(parsed.data.kind, rules) === null ? [parsed.data] : [];
  });
}
