// Progress's predictions (ROADMAP 35a; spec Part 2B §5). Pure: the service reads the
// person's own workouts with their day and hour in the person's time zone, and today;
// this file decides. Same workouts and the same today give the same answer.
import {
  PREDICTIONS_CALC_VERSION,
  PREDICTION_GATES,
  progressPredictionsSchema,
  type BestTime,
  type CalorieForecast,
  type ProgressPredictions,
  type SteadyPace,
  type TimeSlot,
  type WeekGoalBand,
  type WeekGoalPrediction,
} from "@app/shared";

/** One workout, on its day and hour of the person's own time zone. */
export interface PredictionWorkout {
  day: string;
  hour: number;
  kcal: number | null;
  durationMs: number | null;
  formScore: number | null;
}

export interface PredictionsInput {
  today: string;
  /** The last 90 days' workouts at most; later days than today are left out here. */
  workouts: readonly PredictionWorkout[];
  /** The day of the person's first workout ever; null when there is none. */
  firstWorkoutDay: string | null;
  /** The person's training-days goal for a week; null when they have none. */
  weeklyTarget: number | null;
  limitedToDays: number | null;
}

export const BEST_TIME_DAYS = 90;
const FORECAST_WEEKS = 4;
const GOAL_WEEKS = 6;
const STEADY_RECENT_DAYS = 14;
const STEADY_BEFORE_DAYS = 28;
/** A forecast's band is never narrower than this many percent of its own point, either way. */
const BAND_FLOOR_PCT = 15;
/** A figure that moved less than this, in percent, either way, is steady. */
const STEADY_PCT = 5;

const utc = (day: string): number => Date.parse(`${day}T00:00:00Z`);

export function addDays(day: string, n: number): string {
  return new Date(utc(day) + n * 86_400_000).toISOString().slice(0, 10);
}

/** 0 for Monday to 6 for Sunday. */
const sinceMonday = (day: string): number => (new Date(utc(day)).getUTCDay() + 6) % 7;

const round10 = (v: number): number => Math.round(v / 10) * 10;
const round1 = (v: number): number => Math.round(v * 10) / 10;

/** The next 7 days, each from the same weekday of the 4 weeks before today, newest
 *  weighted 4, then 3, 2, 1; a weekday with no workout counts as 0. The band is the
 *  weighted mean distance from that average, never under 15 % of it. */
export function calorieForecast(today: string, workouts: readonly PredictionWorkout[]): CalorieForecast {
  const first = addDays(today, -FORECAST_WEEKS * 7);
  const inWindow = workouts.filter((w) => w.day >= first && w.day < today);
  if (inWindow.length < PREDICTION_GATES.forecastWorkouts) {
    return { available: false, workouts: inWindow.length, needed: PREDICTION_GATES.forecastWorkouts };
  }
  const kcalByDay = new Map<string, number>();
  for (const w of inWindow) kcalByDay.set(w.day, (kcalByDay.get(w.day) ?? 0) + (w.kcal ?? 0));

  const days = [1, 2, 3, 4, 5, 6, 7].map((ahead) => {
    const date = addDays(today, ahead);
    // The same weekday's last 4 days before today, newest first: a week back for
    // tomorrow to 6 days ahead, two weeks back for the day a week from today.
    const back = (Math.floor(ahead / 7) + 1) * 7;
    const samples = [0, 1, 2, 3].map((k) => kcalByDay.get(addDays(date, -back - k * 7)) ?? 0);
    const weights = [4, 3, 2, 1];
    const weightSum = 10;
    const mean = samples.reduce((n, x, i) => n + x * (weights[i] ?? 0), 0) / weightSum;
    const spread = samples.reduce((n, x, i) => n + Math.abs(x - mean) * (weights[i] ?? 0), 0) / weightSum;
    const half = Math.max(spread, (mean * BAND_FLOOR_PCT) / 100);
    return {
      date,
      kcalPoint: round10(mean),
      kcalLow: round10(Math.max(0, mean - half)),
      kcalHigh: round10(mean + half),
    };
  });
  return {
    available: true,
    days,
    totalPoint: days.reduce((n, d) => n + d.kcalPoint, 0),
    totalLow: days.reduce((n, d) => n + d.kcalLow, 0),
    totalHigh: days.reduce((n, d) => n + d.kcalHigh, 0),
  };
}

/** This week's training-days goal as a band. The finished weeks since the first workout,
 *  6 at most, newest weighted 6 down to 1, give how often the goal is met; a week whose
 *  remaining days cannot hold what is still needed is tough. */
export function weekGoal(
  today: string,
  workouts: readonly PredictionWorkout[],
  firstWorkoutDay: string | null,
  target: number | null,
): WeekGoalPrediction {
  if (target === null) return { available: false, reason: "no_goal" };
  const monday = addDays(today, -sinceMonday(today));
  const firstMonday = firstWorkoutDay === null ? null : addDays(firstWorkoutDay, -sinceMonday(firstWorkoutDay));
  const trainedDays = new Set(workouts.map((w) => w.day));
  const daysIn = (from: string, to: string): number => [...trainedDays].filter((d) => d >= from && d <= to).length;

  // Finished weeks, newest first, from the week of the first workout on.
  const weeks: number[] = [];
  for (let k = 1; k <= GOAL_WEEKS; k++) {
    const start = addDays(monday, -7 * k);
    if (firstMonday === null || start < firstMonday) break;
    weeks.push(daysIn(start, addDays(start, 6)));
  }
  if (weeks.length < PREDICTION_GATES.weekGoalWeeks) {
    return { available: false, reason: "few_weeks", weeks: weeks.length, needed: PREDICTION_GATES.weekGoalWeeks };
  }

  const done = daysIn(monday, today);
  const trainedToday = trainedDays.has(today);
  const daysLeft = 7 - sinceMonday(today) - (trainedToday ? 1 : 0);
  const moreNeeded = Math.max(0, target - done);
  const base = { available: true as const, target, done, daysLeft, moreNeeded };
  if (moreNeeded === 0) return { ...base, band: "reached" };
  if (moreNeeded > daysLeft) return { ...base, band: "tough" };

  // Whole numbers only, so a band's edge is exact: met weight × 100 against 75 and 40
  // times all the weight.
  let metWeight = 0;
  let allWeight = 0;
  weeks.forEach((count, i) => {
    const weight = GOAL_WEEKS - i;
    allWeight += weight;
    if (count >= target) metWeight += weight;
  });
  const band: WeekGoalBand =
    metWeight * 100 >= 75 * allWeight ? "on_track" : metWeight * 100 >= 40 * allWeight ? "doable" : "tough";
  return { ...base, band };
}

const mean = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((n, v) => n + v, 0) / values.length;

function figure(before: number | null, recent: number | null): { before: number; recent: number; changePct: number } | null {
  if (before === null || recent === null || before === 0) return null;
  return { before: Math.round(before), recent: Math.round(recent), changePct: round1(((recent - before) / before) * 100) };
}

/** The last 2 weeks against the 4 weeks before them: calories, minutes and form, each
 *  an average of the workouts that have it. Steady when every figure that can be
 *  compared moved less than 5 %, as shown to one decimal. */
export function steadyPace(today: string, workouts: readonly PredictionWorkout[]): SteadyPace {
  const recentFrom = addDays(today, -(STEADY_RECENT_DAYS - 1));
  const beforeFrom = addDays(recentFrom, -STEADY_BEFORE_DAYS);
  const recent = workouts.filter((w) => w.day >= recentFrom && w.day <= today);
  const before = workouts.filter((w) => w.day >= beforeFrom && w.day < recentFrom);
  const gate = {
    available: false as const,
    recent: recent.length,
    before: before.length,
    needed: PREDICTION_GATES.steadyWorkouts,
    neededEachSide: PREDICTION_GATES.steadyEachSide,
  };
  if (
    recent.length + before.length < PREDICTION_GATES.steadyWorkouts ||
    recent.length < PREDICTION_GATES.steadyEachSide ||
    before.length < PREDICTION_GATES.steadyEachSide
  ) {
    return gate;
  }
  const avg = (ws: readonly PredictionWorkout[], pick: (w: PredictionWorkout) => number | null) =>
    mean(ws.flatMap((w) => {
      const v = pick(w);
      return v === null ? [] : [v];
    }));
  const minutes = (w: PredictionWorkout) => (w.durationMs === null ? null : w.durationMs / 60_000);
  const kcal = figure(avg(before, (w) => w.kcal), avg(recent, (w) => w.kcal));
  const mins = figure(avg(before, minutes), avg(recent, minutes));
  const form = figure(avg(before, (w) => w.formScore), avg(recent, (w) => w.formScore));
  const compared = [kcal, mins, form].filter((f) => f !== null);
  if (compared.length === 0) return gate;
  return {
    available: true,
    steady: compared.every((f) => Math.abs(f.changePct) < STEADY_PCT),
    recentDays: STEADY_RECENT_DAYS,
    kcal,
    minutes: mins,
    form,
  };
}

const SLOTS: readonly TimeSlot[] = ["morning", "afternoon", "evening", "night"];

export function slotOf(hour: number): TimeSlot {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

/** The time of day with the highest average form, over the last 90 days' workouts that
 *  have a form score; a time of day needs 2 of them to be named. A tie goes to the time
 *  with more workouts, then to the earlier time of day. */
export function bestTime(today: string, workouts: readonly PredictionWorkout[]): BestTime {
  const first = addDays(today, -(BEST_TIME_DAYS - 1));
  const scored = workouts.filter((w) => w.day >= first && w.day <= today && w.formScore !== null);
  if (scored.length < PREDICTION_GATES.bestTimeWorkouts) {
    return { available: false, workouts: scored.length, needed: PREDICTION_GATES.bestTimeWorkouts };
  }
  const sums = SLOTS.map((slot) => {
    const inSlot = scored.filter((w) => slotOf(w.hour) === slot);
    return { slot, workouts: inSlot.length, formSum: inSlot.reduce((n, w) => n + (w.formScore ?? 0), 0) };
  }).filter((s) => s.workouts > 0);

  let best: (typeof sums)[number] | null = null;
  for (const s of sums) {
    if (s.workouts < 2) continue;
    // a.sum / a.n against b.sum / b.n, in whole numbers.
    const better =
      best === null ||
      s.formSum * best.workouts > best.formSum * s.workouts ||
      (s.formSum * best.workouts === best.formSum * s.workouts && s.workouts > best.workouts);
    if (better) best = s;
  }
  return {
    available: true,
    best: best === null ? null : best.slot,
    slots: sums.map((s) => ({ slot: s.slot, workouts: s.workouts, avgForm: Math.round(s.formSum / s.workouts) })),
  };
}

export function predictions(input: PredictionsInput): ProgressPredictions {
  const first = addDays(input.today, -(BEST_TIME_DAYS - 1));
  const workouts = input.workouts.filter((w) => w.day <= input.today);
  return progressPredictionsSchema.parse({
    calcVersion: PREDICTIONS_CALC_VERSION,
    workouts: workouts.filter((w) => w.day >= first).length,
    forecast: calorieForecast(input.today, workouts),
    weekGoal: weekGoal(input.today, workouts, input.firstWorkoutDay, input.weeklyTarget),
    steady: steadyPace(input.today, workouts),
    bestTime: bestTime(input.today, workouts),
    limitedToDays: input.limitedToDays,
  });
}
