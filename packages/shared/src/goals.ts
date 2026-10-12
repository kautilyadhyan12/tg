// A person's goals (ROADMAP Stage 5 item 30a; RULINGS 2026-09-07, "Goals and plans").
// A goal is a kind, a target and a period, set by the app or by the person. The server
// measures every one from what it already keeps; nothing here is typed as progress.
import { z } from "zod";
import { noDeficitReasonSchema } from "./plan.js";

/** The kinds the server can measure today. Running goals, "master an exercise", a harder
 *  version, a hold time and mobility sessions join when something records them. */
export const goalKindSchema = z.enum([
  "training_days",
  "streak",
  "gym_visits",
  "calories_burned",
  "active_minutes",
  "reps_in_set",
  "weight",
  "calories_within",
  "protein",
  "food_logged_days",
]);
export type GoalKind = z.infer<typeof goalKindSchema>;

export const goalPeriodSchema = z.enum(["day", "week", "month", "year"]);
export type GoalPeriod = z.infer<typeof goalPeriodSchema>;

export const goalUnitSchema = z.enum(["days", "kcal", "minutes", "reps", "kg", "g"]);
export type GoalUnit = z.infer<typeof goalUnitSchema>;

export const goalFamilySchema = z.enum(["consistency", "energy", "strength", "body", "food"]);
export type GoalFamily = z.infer<typeof goalFamilySchema>;

/** The most days a period can hold: what a per-day ceiling is multiplied by. */
export const GOAL_PERIOD_DAYS: Readonly<Record<GoalPeriod, number>> = { day: 1, week: 7, month: 31, year: 366 };

export interface GoalKindRule {
  family: GoalFamily;
  unit: GoalUnit;
  /** The periods it may take. Empty: a mark to reach, with no period. */
  periods: readonly GoalPeriod[];
  /** The ceiling of a typed target: for one day where the kind has periods, in all where
   *  it has none. Null: the target is read from the person's plan and never typed. */
  targetMax: number | null;
  /** Whether it names one exercise. */
  exercise: boolean;
}

export const GOAL_KIND_RULES: Readonly<Record<GoalKind, GoalKindRule>> = {
  training_days: { family: "consistency", unit: "days", periods: ["week", "month", "year"], targetMax: 1, exercise: false },
  streak: { family: "consistency", unit: "days", periods: [], targetMax: 1000, exercise: false },
  gym_visits: { family: "consistency", unit: "days", periods: ["week", "month", "year"], targetMax: 1, exercise: false },
  calories_burned: { family: "energy", unit: "kcal", periods: ["day", "week", "month", "year"], targetMax: 5000, exercise: false },
  active_minutes: { family: "energy", unit: "minutes", periods: ["day", "week", "month", "year"], targetMax: 600, exercise: false },
  reps_in_set: { family: "strength", unit: "reps", periods: [], targetMax: 1000, exercise: true },
  // The weight choice and the target weight are setup's; a second copy is never typed here.
  weight: { family: "body", unit: "kg", periods: [], targetMax: null, exercise: false },
  // The rings' own numbers (`/v1/nutrition/targets`), which carry the health rules.
  calories_within: { family: "food", unit: "kcal", periods: ["day"], targetMax: null, exercise: false },
  protein: { family: "food", unit: "g", periods: ["day"], targetMax: null, exercise: false },
  food_logged_days: { family: "food", unit: "days", periods: ["week", "month", "year"], targetMax: 1, exercise: false },
};

/** The highest target a kind takes over a period, or null where none is typed. */
export function goalTargetMax(kind: GoalKind, period: GoalPeriod | null): number | null {
  const rule = GOAL_KIND_RULES[kind];
  if (rule.targetMax === null) return null;
  return period === null ? rule.targetMax : rule.targetMax * GOAL_PERIOD_DAYS[period];
}

/** How many goals one person may keep. */
export const MAX_GOALS = 30;

/** A goal as the person sends it. The id is the phone's own, so the same request sent
 *  twice is one goal. */
export const putGoalRequestSchema = z
  .object({
    kind: goalKindSchema,
    period: goalPeriodSchema.nullable(),
    target: z.number().int().positive().nullable(),
    exerciseId: z.string().uuid().nullable(),
  })
  .strict()
  .superRefine((g, ctx) => {
    const rule = GOAL_KIND_RULES[g.kind];
    const periodFits = g.period === null ? rule.periods.length === 0 : rule.periods.includes(g.period);
    if (!periodFits) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["period"], message: "period does not fit this kind" });
      return;
    }
    const max = goalTargetMax(g.kind, g.period);
    if ((max === null) !== (g.target === null) || (max !== null && g.target !== null && g.target > max)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["target"], message: "target does not fit this kind" });
    }
    if (rule.exercise !== (g.exerciseId !== null)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["exerciseId"], message: "exercise does not fit this kind" });
    }
  });
export type PutGoalRequest = z.infer<typeof putGoalRequestSchema>;

/** DELETE answers 204 when the goal is removed and 404 when the caller has no goal with
 *  this id, so a removal sent again after a lost reply reads 404: already gone, done. */
export const goalIdParamsSchema = z.object({ id: z.string().uuid() }).strict();

/** Why a goal is not measured for this person today. The goal is kept, never removed. */
export const goalHeldSchema = z.discriminatedUnion("code", [
  // Safe mode holds no intensity goal (RULINGS 2026-09-07): consistency and food goals go on.
  z.object({ code: z.literal("safe_mode") }).strict(),
  // Nobody whose plan may hold no calorie cut is given a weight to lose.
  z.object({ code: z.literal("no_weight_loss"), reasons: z.array(noDeficitReasonSchema).min(1) }).strict(),
]);
export type GoalHeld = z.infer<typeof goalHeldSchema>;

/** What has to be answered before the goal has a target: setup's questions, or a target weight. */
export const goalNeedsSchema = z.enum(["plan", "target_weight"]);
export type GoalNeeds = z.infer<typeof goalNeedsSchema>;

export const goalDirectionSchema = z.enum(["at_least", "at_most", "steady"]);
export type GoalDirection = z.infer<typeof goalDirectionSchema>;

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const goalSchema = z
  .object({
    id: z.string().uuid(),
    kind: goalKindSchema,
    period: goalPeriodSchema.nullable(),
    exerciseId: z.string().uuid().nullable(),
    exerciseSlug: z.string().nullable(),
    setBy: z.enum(["app", "user"]),
    unit: goalUnitSchema,
    direction: goalDirectionSchema,
    target: z.number().nullable(),
    current: z.number().nullable(),
    /** Null where nothing is judged: a held goal, one with no target, "keep steady". */
    reached: z.boolean().nullable(),
    held: goalHeldSchema.nullable(),
    needs: goalNeedsSchema.nullable(),
    /** The days counted, in the person's own time zone; null for a mark to reach. */
    window: z.object({ start: daySchema, end: daySchema }).strict().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict()
  // A held goal shows no number to chase.
  .refine((g) => g.held === null || (g.target === null && g.current === null && g.reached === null), {
    message: "a held goal carries no numbers",
  });
export type Goal = z.infer<typeof goalSchema>;

export const goalsResponseSchema = z.object({ goals: z.array(goalSchema), max: z.number().int() }).strict();
export type GoalsResponse = z.infer<typeof goalsResponseSchema>;

export const goalResponseSchema = z.object({ goal: goalSchema }).strict();
export type GoalResponse = z.infer<typeof goalResponseSchema>;
