// Weekly challenges (ROADMAP 35b): which three a person gets for a week, and how far
// along each is. Pure: facts in, answers out, no I/O and no clock.
//
// Rebuilt from the old backend's list (challenges.py), with its targets, its XP and its
// mix by fitness level. What differs, by Kd's yes on 2026-10-14: the week is the
// person's own; no coach challenge (the coach is not in the phone app); the form
// challenges only for somebody who has used the camera lately; the calorie ones only for
// somebody whose weight is known (no weight, no calories); Safe mode gets only the gentle
// ones; two challenges in a week never count the same thing; a workout count is a count
// of days, and meals are days with food logged, so seven workouts in one evening are not
// "every day this week".
import { createHash } from "node:crypto";
import type {
  WeeklyChallenge,
  WeeklyChallengeCode,
  WeeklyChallengeDifficulty,
  WeeklyChallengeMeasure,
} from "@app/shared";

export interface ChallengeTemplate {
  code: WeeklyChallengeCode;
  measure: WeeklyChallengeMeasure;
  target: number;
  difficulty: WeeklyChallengeDifficulty;
  xp: number;
}

/** The targets and XP are challenges.py's. */
export const CHALLENGES: readonly ChallengeTemplate[] = [
  { code: "train_days_3", measure: "training_days", target: 3, difficulty: "easy", xp: 200 },
  { code: "train_days_5", measure: "training_days", target: 5, difficulty: "medium", xp: 400 },
  { code: "train_days_7", measure: "training_days", target: 7, difficulty: "hard", xp: 700 },
  { code: "burn_kcal_1500", measure: "kcal_burned", target: 1500, difficulty: "easy", xp: 250 },
  { code: "burn_kcal_3000", measure: "kcal_burned", target: 3000, difficulty: "medium", xp: 500 },
  { code: "train_minutes_120", measure: "training_minutes", target: 120, difficulty: "easy", xp: 200 },
  { code: "train_minutes_300", measure: "training_minutes", target: 300, difficulty: "hard", xp: 500 },
  { code: "form_80_workouts_3", measure: "form_80_workouts", target: 3, difficulty: "medium", xp: 300 },
  { code: "form_90_workouts_3", measure: "form_90_workouts", target: 3, difficulty: "hard", xp: 500 },
  { code: "families_3", measure: "families", target: 3, difficulty: "easy", xp: 250 },
  { code: "families_5", measure: "families", target: 5, difficulty: "medium", xp: 450 },
  { code: "food_days_5", measure: "food_days", target: 5, difficulty: "easy", xp: 200 },
  { code: "food_days_7", measure: "food_days", target: 7, difficulty: "medium", xp: 400 },
];

/** Safe mode's two: training days, a consistency goal that goals keep on in Safe mode,
 *  and logging food. Nothing that asks for more effort. */
export const SAFE_MODE_CHALLENGES: readonly WeeklyChallengeCode[] = ["train_days_3", "food_days_5"];

const BY_CODE = new Map(CHALLENGES.map((c) => [c.code, c]));

export function challengeOf(code: WeeklyChallengeCode): ChallengeTemplate {
  const found = BY_CODE.get(code);
  if (found === undefined) throw new Error(`no weekly challenge ${code}`);
  return found;
}

export type FitnessLevel = "beginner" | "intermediate" | "advanced";

export interface PickInput {
  userId: string;
  /** Monday, 'YYYY-MM-DD', in the person's own time zone. */
  weekStart: string;
  /** Unanswered is picked as a beginner, as the old app did. */
  fitnessLevel: FitnessLevel | null;
  safeMode: boolean;
  weightKnown: boolean;
  /** A workout the camera scored in the last 28 days. */
  usedCamera: boolean;
}

/** challenges.py's mix, hardest first so the hard ones are never crowded out by a
 *  medium that counts the same thing. */
const MIX: Record<FitnessLevel, readonly WeeklyChallengeDifficulty[]> = {
  beginner: ["medium", "easy", "easy"],
  intermediate: ["hard", "medium", "easy"],
  advanced: ["hard", "hard", "medium"],
};

const order = (seed: string, code: string): string =>
  createHash("sha256").update(`${seed}:${code}`).digest("hex");

/** The week's challenges, the same for the same person, week and answers. */
export function pickChallenges(input: PickInput): WeeklyChallengeCode[] {
  if (input.safeMode) return [...SAFE_MODE_CHALLENGES];
  const offered = CHALLENGES.filter(
    (c) =>
      (input.weightKnown || c.measure !== "kcal_burned") &&
      (input.usedCamera || (c.measure !== "form_80_workouts" && c.measure !== "form_90_workouts")),
  );
  const seed = `${input.userId}:${input.weekStart}`;
  const shuffled = [...offered].sort((a, b) => (order(seed, a.code) < order(seed, b.code) ? -1 : 1));
  const picked: ChallengeTemplate[] = [];
  const free = (c: ChallengeTemplate) => !picked.some((p) => p.measure === c.measure || sameKind(p, c));
  for (const difficulty of MIX[input.fitnessLevel ?? "beginner"]) {
    const next = shuffled.find((c) => c.difficulty === difficulty && free(c));
    if (next !== undefined) picked.push(next);
  }
  // A level whose pool ran short is topped up from whatever counts something new.
  for (const c of shuffled) {
    if (picked.length >= 3) break;
    if (free(c)) picked.push(c);
  }
  return picked.map((c) => c.code);
}

/** Both form challenges count camera-scored workouts: one week never asks for both. */
function sameKind(a: ChallengeTemplate, b: ChallengeTemplate): boolean {
  const form = (m: WeeklyChallengeMeasure) => m === "form_80_workouts" || m === "form_90_workouts";
  return form(a.measure) && form(b.measure);
}

/** One week's facts, from the person's own saved workouts and meals. */
export interface WeekFacts {
  trainingDays: number;
  kcalBurned: number;
  trainingMinutes: number;
  form80Workouts: number;
  form90Workouts: number;
  families: number;
  foodDays: number;
}

export const NO_FACTS: WeekFacts = {
  trainingDays: 0,
  kcalBurned: 0,
  trainingMinutes: 0,
  form80Workouts: 0,
  form90Workouts: 0,
  families: 0,
  foodDays: 0,
};

const FACT: Record<WeeklyChallengeMeasure, keyof WeekFacts> = {
  training_days: "trainingDays",
  kcal_burned: "kcalBurned",
  training_minutes: "trainingMinutes",
  form_80_workouts: "form80Workouts",
  form_90_workouts: "form90Workouts",
  families: "families",
  food_days: "foodDays",
};

export function measureChallenge(
  code: WeeklyChallengeCode,
  facts: WeekFacts,
  safeModeNow: boolean,
): WeeklyChallenge {
  const c = challengeOf(code);
  const current = Math.max(0, Math.floor(facts[FACT[c.measure]]));
  return {
    code: c.code,
    measure: c.measure,
    difficulty: c.difficulty,
    target: c.target,
    current,
    done: current >= c.target,
    xp: c.xp,
    held: safeModeNow && !SAFE_MODE_CHALLENGES.includes(code) ? { code: "safe_mode" } : null,
  };
}

/** XP from done challenges over every week the person was given some. A done challenge
 *  pays once, because the total is worked out again from the weeks, never added to. */
export function challengeXp(
  weeks: readonly { weekStart: string; codes: readonly WeeklyChallengeCode[] }[],
  factsByWeek: ReadonlyMap<string, WeekFacts>,
): number {
  let total = 0;
  for (const week of weeks) {
    const facts = factsByWeek.get(week.weekStart) ?? NO_FACTS;
    for (const code of week.codes) {
      const m = measureChallenge(code, facts, false);
      if (m.done) total += m.xp;
    }
  }
  return total;
}

const utc = (day: string): number => Date.parse(`${day}T00:00:00Z`);
const plusDays = (day: string, n: number): string => new Date(utc(day) + n * 86_400_000).toISOString().slice(0, 10);

/** The Monday and the Sunday of the week `day` is in. */
export function weekOf(day: string): { weekStart: string; weekEnd: string } {
  const sinceMonday = (new Date(utc(day)).getUTCDay() + 6) % 7;
  const weekStart = plusDays(day, -sinceMonday);
  return { weekStart, weekEnd: plusDays(weekStart, 6) };
}
