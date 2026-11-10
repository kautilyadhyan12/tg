// The run plan (ROADMAP Stage 5 item 37d-i): the running questions, asked on the Running page, and
// the week of runs made from them and from the runs the person really recorded. Pure: the server
// hands in the answers, the days and the runs, and the same input always gives the same plan.
//
// Sources (rulings/2026-11-10-37d-i.md):
// - Someone who cannot yet jog 30 minutes: the NHS Couch to 5K printable plan, word for word (nine
//   weeks, three runs a week with a rest day between, a 5-minute walk before and after each run;
//   "if you need to repeat any of the runs or weeks, that's totally okay").
// - No run more than 10 % longer than the longest of the last 30 days (Frandsen and colleagues,
//   BJSM 2025, 5,205 runners: a single run past that raised overuse injuries; the week-to-week change
//   showed no link). A week grows by 10 % at most, with an easier week every fourth (RULINGS
//   2026-09-10), and only from what was really run.
// - Paces only from a race time the person gave (Daniels' VDOT, as reproduced in Lan and colleagues,
//   JOEM 2020): easy 59-74 % of VDOT, steady (threshold) 85-88 %, fast (interval) at VDOT. Without
//   one, by feel. The long run at most 30 % of the week and 150 minutes; steady running at most 10 %
//   of the week in one run (Daniels' Running Formula).
import { z } from "zod";

// ── The answers ────────────────────────────────────────────────────────────────────────────────

export const RUN_DOES_RUN = ["yes", "start", "no"] as const;
export type RunDoesRun = (typeof RUN_DOES_RUN)[number];
/** "How long can you jog without stopping?" */
export const JOG_BANDS = ["none", "upto5", "5to10", "10to20", "20to30", "30plus"] as const;
export type JogBand = (typeof JOG_BANDS)[number];
export const RUN_GOALS = ["5k", "10k", "half"] as const;
export type RunGoal = (typeof RUN_GOALS)[number];
/** The race distances a time may be given for: Daniels' tables run from the mile to the marathon. */
export const RACE_DISTANCES_M = [1609, 5000, 10000, 21097, 42195] as const;
/** ISO weekdays: 1 is Monday, 7 Sunday. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export const RUN_WEEK_MOST_M = 250_000;
export const RUN_LONGEST_MOST_M = 60_000;
/** A race time is used for six weeks after it was given (the question says "from the last 6 weeks"). */
export const RACE_KEPT_DAYS = 42;

const raceSchema = z
  .object({
    distanceM: z.union([z.literal(1609), z.literal(5000), z.literal(10000), z.literal(21097), z.literal(42195)]),
    timeS: z.number().int().min(60).max(36_000),
  })
  .strict();
export type RaceTime = z.infer<typeof raceSchema>;

/** Daniels' VDOT from a race, or null when the time is outside his tables (30 to 85), widened to
 *  20 so a slow beginner's 5 km still counts: faster than the tables is no real race time. */
export function vdotOf(race: RaceTime): number | null {
  const minutes = race.timeS / 60;
  const v = race.distanceM / minutes;
  const vo2 = -4.6 + 0.182258 * v + 0.000104 * v * v;
  const share = 0.8 + 0.1894393 * Math.exp(-0.012778 * minutes) + 0.2989558 * Math.exp(-0.1932605 * minutes);
  const vdot = vo2 / share;
  return Number.isFinite(vdot) && vdot >= VDOT_LEAST && vdot <= VDOT_MOST ? vdot : null;
}
export const VDOT_LEAST = 20;
export const VDOT_MOST = 85;

export const runPlanAnswersSchema = z
  .object({
    doesRun: z.enum(RUN_DOES_RUN),
    jog: z.enum(JOG_BANDS).nullable(),
    days: z.array(z.number().int().min(1).max(7)).max(7),
    goal: z.enum(RUN_GOALS).nullable(),
    weeklyM: z.number().int().min(0).max(RUN_WEEK_MOST_M).nullable(),
    longestM: z.number().int().min(0).max(RUN_LONGEST_MOST_M).nullable(),
    race: raceSchema.nullable(),
  })
  .strict()
  .superRefine((a, ctx) => {
    const wrong = (path: string, message: string) => {
      ctx.addIssue({ code: "custom", path: [path], message });
    };
    if (new Set(a.days).size !== a.days.length) wrong("days", "a day twice");
    if (a.doesRun === "no") {
      if (a.jog !== null || a.goal !== null || a.weeklyM !== null || a.longestM !== null || a.race !== null || a.days.length > 0) wrong("doesRun", "no plan takes no answers");
      return;
    }
    if (a.jog === null) wrong("jog", "required");
    if (a.goal === null) wrong("goal", "required");
    if (a.days.length < 2) wrong("days", "two days at least");
    const runner = a.jog === "30plus";
    if (runner) {
      if (a.weeklyM === null) wrong("weeklyM", "required");
      if (a.longestM === null) wrong("longestM", "required");
    } else if (a.weeklyM !== null || a.longestM !== null || a.race !== null) {
      wrong("jog", "only a runner gives a week, a longest run and a race");
    }
    if (a.race !== null && vdotOf(a.race) === null) wrong("race", "not a race time");
  });
export type RunPlanAnswers = z.infer<typeof runPlanAnswersSchema>;

// ── Days, as YYYY-MM-DD in the person's own time zone ──────────────────────────────────────────

const DAY_MS = 86_400_000;
const dayNumber = (day: string): number => {
  const [y, m, d] = day.split("-").map(Number);
  return Math.round(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / DAY_MS);
};
const dayOf = (n: number): string => new Date(n * DAY_MS).toISOString().slice(0, 10);
/** 1 for Monday to 7 for Sunday. */
export const planWeekdayOf = (day: string): number => ((((dayNumber(day) + 3) % 7) + 7) % 7) + 1;
export const planDayPlus = (day: string, n: number): string => dayOf(dayNumber(day) + n);
const daysBetween = (from: string, to: string): number => dayNumber(to) - dayNumber(from);
const mondayOf = (day: string): string => planDayPlus(day, 1 - planWeekdayOf(day));

// ── Couch to 5K: the NHS printable plan, run for run ───────────────────────────────────────────

export type PartKind = "walk" | "run";
export interface Part {
  kind: PartKind;
  s: number;
}
const r = (s: number): Part => ({ kind: "run", s });
const w = (s: number): Part => ({ kind: "walk", s });
const repeat = (times: number, ...parts: Part[]): Part[] => Array.from({ length: times }, () => parts).flat();

/** The run-and-walk part of each run, week by week (the 5-minute walks before and after are added). */
const C25K_WEEKS: readonly (readonly (readonly Part[])[])[] = [
  [[...repeat(7, r(60), w(90)), r(60)]],
  [[...repeat(5, r(90), w(120)), r(90)]],
  [[r(90), w(90), r(180), w(180), r(90), w(90), r(180)]],
  [[r(180), w(90), r(300), w(150), r(180), w(90), r(300)]],
  [
    [r(300), w(180), r(300), w(180), r(300)],
    [r(480), w(300), r(480)],
    [r(1200)],
  ],
  [
    [r(300), w(180), r(480), w(180), r(300)],
    [r(600), w(180), r(600)],
    [r(1500)],
  ],
  [[r(1500)]],
  [[r(1680)]],
  [[r(1800)]],
];
export const C25K_WEEK_COUNT = 9;
export const C25K_RUNS_A_WEEK = 3;
export const C25K_WARM_S = 300;
const C25K_SESSIONS = C25K_WEEK_COUNT * C25K_RUNS_A_WEEK;

/** The parts of the NHS plan's run `index` (0 is week 1 run 1), its walks before and after included. */
export function c25kParts(index: number): Part[] {
  const week = C25K_WEEKS[Math.floor(index / C25K_RUNS_A_WEEK)] ?? [];
  const run = week[index % C25K_RUNS_A_WEEK] ?? week[0] ?? [];
  return [w(C25K_WARM_S), ...run, w(C25K_WARM_S)];
}
const totalS = (parts: readonly Part[]): number => parts.reduce((t, p) => t + p.s, 0);
/** A recorded run counts as the plan's run when it lasted at least this share of the run and its
 *  walks between, the walks before and after left out (somebody may warm up before pressing Start). */
export const C25K_COUNTS_FROM = 0.75;
const countsFor = (index: number): number => C25K_COUNTS_FROM * (totalS(c25kParts(index)) - 2 * C25K_WARM_S);

/** Where somebody who can already jog for a while starts: the week whose runs they can already
 *  manage, or the next step the plan itself takes from there. */
export const C25K_START_WEEK: Record<Exclude<JogBand, "30plus">, number> = {
  none: 1,
  upto5: 1,
  "5to10": 4,
  "10to20": 5,
  "20to30": 6,
};

// ── A runner's plan ────────────────────────────────────────────────────────────────────────────

/** Where the plan stops growing for each distance: the week and the long run that are ready for it.
 *  The terminal's own (rulings/2026-11-10-37d-i.md), from common published plans; the safety limits
 *  above bind every week on the way. */
export const RUN_GOAL_PEAK: Record<RunGoal, { weekM: number; longM: number }> = {
  "5k": { weekM: 25_000, longM: 8_000 },
  "10k": { weekM: 35_000, longM: 12_000 },
  half: { weekM: 45_000, longM: 18_000 },
};
export const WEEK_GROWTH = 1.1;
export const RUN_GROWTH = 1.1;
export const EASIER_EVERY = 4;
export const EASIER_SHARE = 0.8;
/** A week in which fewer than this share of the planned distance was run grows from this share. */
const WEEK_FLOOR_SHARE = 0.8;
export const LONG_SHARE = 0.3;
export const LONG_MOST_S = 150 * 60;
export const STEADY_SHARE = 0.1;
export const FAST_SHARE = 0.08;
/** Somebody who can jog 30 minutes and runs less: three runs of 30 minutes, the NHS plan's last
 *  week, at a slow jog of 7:30 a kilometre. */
const THIRTY_MIN_M = 4_000;
const LEAST_RUN_M = 2_000;
/** A run with steady or fast running: 1.5 km easy before and after (about ten minutes, Daniels' warm-up). */
const WARM_M = 1_500;
const STEADY_LEAST_M = 1_000;
const FAST_REP_M = 800;
/** Distances are planned in whole 100 m, rounded down: never more than the week allows. */
const ROUND_M = 100;
/** Runs and hard runs in a week. */
const MOST_RUN_DAYS = 6;
const HARD_FROM_WEEK_M = 15_000;
const EXPERIENCED_FROM_M = 30_000;
/** Easy pace by feel, for the 150-minute limit: a slow jog. */
const SLOW_EASY_S_PER_KM = 450;

export type RunKind = "easy" | "long" | "steady" | "fast";
export interface Reps {
  count: number;
  m: number;
  restS: number;
}
export type PlanSession =
  | { kind: "walk_run"; week: number; run: number; parts: Part[] }
  | { kind: RunKind; m: number; reps: Reps | null };

export interface PlanDay {
  day: string;
  weekday: number;
  session: PlanSession | null;
  done: boolean;
}

export interface Paces {
  /** Seconds a kilometre: [faster end, slower end]. */
  easy: [number, number];
  steady: [number, number];
  fast: number;
}

export interface PlanAhead {
  week: number;
  /** A runner's planned distance for the week. */
  m: number | null;
  easier: boolean;
  /** Couch to 5K: the week's first run. */
  parts: Part[] | null;
}

export type RunPlan =
  | { kind: "none"; why: "safe_mode" | "not_for_me" }
  | {
      kind: "c25k";
      week: number;
      days: PlanDay[];
      ahead: PlanAhead[];
      goal: RunGoal;
      /** True when the newest run felt very hard: the next run is the same one again. */
      repeat: boolean;
    }
  | {
      kind: "runner";
      week: number;
      goal: RunGoal;
      weekM: number;
      easier: boolean;
      ready: boolean;
      days: PlanDay[];
      ahead: PlanAhead[];
      paces: Paces | null;
      /** True when the race time given is older than six weeks: paces by feel until a new one. */
      raceOld: boolean;
      /** True when no run was recorded last week, so the week did not grow. */
      held: boolean;
      /** True when last week's runs felt very hard, so the week did not grow. */
      hard: boolean;
    };

/** What the plan reads of the person's recorded runs: one row a day, this app's runs only. */
export interface RunDay {
  day: string;
  distanceM: number;
  longestM: number;
  /** The longest moving time of one run that day. */
  movingS: number;
  /** How the hardest run of the day felt, 1 to 10, as the person rated it after the run; null unrated. */
  effort: number | null;
}

/** A rating of this or more is "very hard" (the run's own 1-to-10 scale, its top fifth). */
export const VERY_HARD_EFFORT = 8;

/** Runs felt very hard: at least two rated, and half or more of them very hard. */
const feltHard = (runs: readonly RunDay[]): boolean => {
  const rated = runs.flatMap((x) => (x.effort === null ? [] : [x.effort]));
  return rated.length >= 2 && rated.filter((e) => e >= VERY_HARD_EFFORT).length * 2 >= rated.length;
};

export interface RunPlanInput {
  answers: RunPlanAnswers;
  /** The day the answers were given, in the person's time zone. */
  answeredDay: string;
  today: string;
  safeMode: boolean;
  /** From 30 days before the answers to today, in day order. */
  runs: readonly RunDay[];
}

/** The days a plan reads runs from. */
export const runsFrom = (answeredDay: string, today: string): string => planDayPlus(answeredDay < today ? answeredDay : today, -30);

const roundM = (m: number): number => Math.max(0, Math.floor(m / ROUND_M) * ROUND_M);

// ── Paces ──────────────────────────────────────────────────────────────────────────────────────

/** The speed, in metres a minute, at which running costs `vo2` (Daniels' cost of running, solved). */
const speedFor = (vo2: number): number => {
  const a = 0.000104;
  const b = 0.182258;
  const c = -4.6 - vo2;
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
};
const secondsPerKm = (vdot: number, share: number): number => Math.round((1000 / speedFor(vdot * share)) * 60);

export function pacesOf(race: RaceTime): Paces | null {
  const vdot = vdotOf(race);
  if (vdot === null) return null;
  return {
    easy: [secondsPerKm(vdot, 0.74), secondsPerKm(vdot, 0.59)],
    steady: [secondsPerKm(vdot, 0.88), secondsPerKm(vdot, 0.85)],
    fast: secondsPerKm(vdot, 1),
  };
}

// ── The plan ───────────────────────────────────────────────────────────────────────────────────

export function runPlanOf(input: RunPlanInput): RunPlan {
  if (input.safeMode) return { kind: "none", why: "safe_mode" };
  const { answers } = input;
  if (answers.doesRun === "no" || answers.jog === null || answers.goal === null) return { kind: "none", why: "not_for_me" };
  if (answers.jog !== "30plus") return couchTo5k(input, answers.jog, answers.goal);
  return runner(input, answers.goal, {
    startM: Math.max(answers.weeklyM ?? 0, Math.min(3, answers.days.length) * THIRTY_MIN_M),
    longestM: Math.max(answers.longestM ?? 0, THIRTY_MIN_M),
    race: answers.race,
    from: input.answeredDay,
    experienced: (answers.weeklyM ?? 0) >= EXPERIENCED_FROM_M,
  });
}

/** Up to `most` of the picked days from `from` on, each at least two days after the last run. */
function spacedDays(picked: readonly number[], weekStart: string, from: string, lastRun: string | null, most: number): string[] {
  const out: string[] = [];
  let last = lastRun;
  for (let i = 0; i < 7 && out.length < most; i += 1) {
    const day = planDayPlus(weekStart, i);
    if (day < from || !picked.includes(planWeekdayOf(day))) continue;
    if (last !== null && daysBetween(last, day) < 2) continue;
    out.push(day);
    last = day;
  }
  return out;
}

function couchTo5k(input: RunPlanInput, jog: Exclude<JogBand, "30plus">, goal: RunGoal): RunPlan {
  const start = (C25K_START_WEEK[jog] - 1) * C25K_RUNS_A_WEEK;
  // Each day's run counts as the next run of the plan once it is long enough: one a day.
  const done = new Map<string, number>();
  let next = start;
  // A run that felt very hard is ticked, and the next run is the same one again (the NHS: "if you need
  // to repeat any of the runs or weeks, that's totally okay").
  let repeat = false;
  for (const run of input.runs) {
    if (run.day < input.answeredDay || run.day > input.today || next >= C25K_SESSIONS) continue;
    if (run.movingS >= countsFor(next)) {
      done.set(run.day, next);
      repeat = run.effort !== null && run.effort >= VERY_HARD_EFFORT;
      if (!repeat) next += 1;
    }
  }
  if (next >= C25K_SESSIONS) {
    // Finished: the plan grows from the runs of the last week of it, towards the distance picked.
    const finishedOn = [...done.keys()].at(-1) ?? input.today;
    const last = input.runs.filter((x) => x.day > planDayPlus(finishedOn, -7) && x.day <= finishedOn);
    return runner(input, goal, {
      startM: Math.max(last.reduce((t, x) => t + x.distanceM, 0), THIRTY_MIN_M),
      longestM: Math.max(THIRTY_MIN_M, ...last.map((x) => x.longestM)),
      race: null,
      from: planDayPlus(finishedOn, 1),
      experienced: false,
    });
  }
  const weekStart = mondayOf(input.today);
  const doneThisWeek = [...done.entries()].filter(([day]) => day >= weekStart);
  const ranToday = done.has(input.today);
  const lastRun = [...done.keys()].filter((d) => d < input.today).at(-1) ?? null;
  const left = Math.max(0, C25K_RUNS_A_WEEK - doneThisWeek.length);
  const planned = spacedDays(input.answers.days, weekStart, ranToday ? planDayPlus(input.today, 1) : input.today, ranToday ? input.today : lastRun, left);
  const days: PlanDay[] = [];
  let upcoming = next;
  for (let i = 0; i < 7; i += 1) {
    const day = planDayPlus(weekStart, i);
    const index = done.get(day) ?? (planned.includes(day) && upcoming < C25K_SESSIONS ? upcoming++ : null);
    days.push({
      day,
      weekday: i + 1,
      done: done.has(day),
      session: index === null ? null : { kind: "walk_run", week: Math.floor(index / C25K_RUNS_A_WEEK) + 1, run: (index % C25K_RUNS_A_WEEK) + 1, parts: c25kParts(index) },
    });
  }
  const week = Math.floor(next / C25K_RUNS_A_WEEK) + 1;
  const ahead: PlanAhead[] = [];
  for (let wk = week + 1; wk <= Math.min(C25K_WEEK_COUNT, week + 3); wk += 1) {
    ahead.push({ week: wk, m: null, easier: false, parts: c25kParts((wk - 1) * C25K_RUNS_A_WEEK) });
  }
  return { kind: "c25k", week, days, ahead, goal, repeat };
}

interface RunnerStart {
  startM: number;
  longestM: number;
  race: RaceTime | null;
  /** The plan's first day: its week is week 1. */
  from: string;
  experienced: boolean;
}

/** The planned distance of each week up to `upTo`, from what was run in the weeks before it. */
function weekTargets(input: RunPlanInput, start: RunnerStart, peakM: number, upTo: number): { nominal: number[]; held: boolean; hard: boolean } {
  const firstMonday = mondayOf(start.from);
  // Week 1 begun after its Monday is part of a week: it holds, and growth starts from week 2's runs.
  const ceiling = Math.max(peakM, start.startM);
  const nominal: number[] = [start.startM];
  let held = false;
  let hard = false;
  for (let wk = 2; wk <= upTo; wk += 1) {
    const before = nominal[wk - 2] ?? start.startM;
    const monday = planDayPlus(firstMonday, (wk - 2) * 7);
    const ran = input.runs.filter((x) => x.day >= monday && x.day < planDayPlus(monday, 7) && x.day >= start.from);
    const ranM = ran.reduce((t, x) => t + x.distanceM, 0);
    const partWeek = wk === 2 && start.from > firstMonday;
    // An easier week does not grow: the week after it is at most 10 % over the last ordinary week.
    if (ran.length === 0 || partWeek || wk % EASIER_EVERY === 0) {
      nominal.push(before);
      if (wk === upTo) held = ran.length === 0 && wk % EASIER_EVERY !== 0;
      continue;
    }
    // Runs that felt very hard last week: this week stays the same.
    if (feltHard(ran)) {
      nominal.push(before);
      if (wk === upTo) hard = true;
      continue;
    }
    // An easier week is judged against its own smaller distance.
    const plannedM = (wk - 1) % EASIER_EVERY === 0 ? before * EASIER_SHARE : before;
    const share = plannedM > 0 ? ranM / plannedM : 1;
    const from = before * Math.min(1, Math.max(share, WEEK_FLOOR_SHARE));
    nominal.push(Math.min(ceiling, from * WEEK_GROWTH));
  }
  return { nominal, held, hard };
}

/** The longest run allowed today: 10 % over the longest of the last 30 days, or the newest longest
 *  known when nothing was run in them (no growth). */
function runCapM(input: RunPlanInput, start: RunnerStart): number {
  const since = planDayPlus(input.today, -30);
  const recent = input.runs.filter((x) => x.day >= since && x.day <= input.today).map((x) => x.longestM);
  const answerKnown = daysBetween(start.from, input.today) <= 30;
  const longest30 = Math.max(0, ...recent, answerKnown ? start.longestM : 0);
  if (longest30 > 0) return Math.floor(longest30 * RUN_GROWTH);
  const older = input.runs.filter((x) => x.day < since).map((x) => x.longestM);
  return Math.max(start.longestM, ...older);
}

function runner(input: RunPlanInput, goal: RunGoal, start: RunnerStart): RunPlan {
  const peak = RUN_GOAL_PEAK[goal];
  const weekStart = mondayOf(input.today);
  const week = Math.max(1, Math.floor(daysBetween(mondayOf(start.from), weekStart) / 7) + 1);
  const { nominal, held, hard } = weekTargets(input, start, peak.weekM, week);
  const thisNominal = nominal[week - 1] ?? start.startM;
  const easier = week % EASIER_EVERY === 0;
  const targetM = easier ? thisNominal * EASIER_SHARE : thisNominal;
  const raceOld = start.race !== null && daysBetween(start.from, input.today) > RACE_KEPT_DAYS;
  const paces = start.race !== null && !raceOld ? pacesOf(start.race) : null;
  const capM = runCapM(input, start);
  const plan = weekOf(input, start, targetM, capM, peak.longM, paces, easier, weekStart);
  const ahead: PlanAhead[] = [];
  let projected = thisNominal;
  for (let wk = week + 1; wk <= week + 3; wk += 1) {
    const e = wk % EASIER_EVERY === 0;
    if (!e) projected = Math.min(Math.max(peak.weekM, start.startM), projected * WEEK_GROWTH);
    ahead.push({ week: wk, m: roundM(e ? projected * EASIER_SHARE : projected), easier: e, parts: null });
  }
  const longPlanned = Math.max(0, ...plan.map((d) => (d.session !== null && d.session.kind !== "walk_run" ? d.session.m : 0)));
  return {
    kind: "runner",
    week,
    goal,
    weekM: plan.reduce((t, d) => t + (d.session !== null && d.session.kind !== "walk_run" ? d.session.m : 0), 0),
    easier,
    ready: thisNominal >= peak.weekM && longPlanned >= peak.longM,
    days: plan,
    ahead,
    paces,
    raceOld,
    held,
    hard,
  };
}

/** Circular distance in days between two weekdays. */
const apart = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 7;
  return Math.min(d, 7 - d);
};

function weekOf(input: RunPlanInput, start: RunnerStart, targetM: number, capM: number, peakLongM: number, paces: Paces | null, easier: boolean, weekStart: string): PlanDay[] {
  const picked = [...input.answers.days].sort((a, b) => a - b);
  const longDay = picked.includes(7) ? 7 : picked.includes(6) ? 6 : (picked.at(-1) ?? 7);
  // Six runs at most: the day after the long run rests.
  const runDays = picked.length > MOST_RUN_DAYS ? picked.filter((d) => d !== (longDay % 7) + 1) : picked;
  const easySlow = paces?.easy[1] ?? SLOW_EASY_S_PER_KM;
  const longM = roundM(Math.min(targetM * LONG_SHARE, capM, peakLongM, (LONG_MOST_S / easySlow) * 1000));
  const hardWanted = runDays.length >= 3 && targetM >= HARD_FROM_WEEK_M ? (easier ? 1 : start.experienced ? 2 : 1) : 0;
  const hardDays: number[] = [];
  for (const d of runDays) {
    if (hardDays.length >= hardWanted) break;
    if (d === longDay || apart(d, longDay) < 2 || hardDays.some((h) => apart(h, d) < 2)) continue;
    hardDays.push(d);
  }
  // The rest of the week shared over the other runs, none longer than the long run or the cap. A hard
  // run takes what its warm-up, its steady or fast part and its cool-down need, or stays easy; then an
  // easy run's share under 2 km drops an easy run.
  const others = runDays.filter((d) => d !== longDay);
  const runCap = Math.min(longM > 0 ? longM : capM, capM);
  let leftM = targetM - longM;
  const share = others.length > 0 ? leftM / others.length : 0;
  const hardM = new Map<number, number>();
  hardDays.forEach((d, i) => {
    const need = 2 * WARM_M + (i === 0 ? STEADY_LEAST_M : 2 * FAST_REP_M);
    const m = roundM(Math.min(Math.max(share, need), runCap));
    if (m >= need && m <= leftM) {
      hardM.set(d, m);
      leftM -= m;
    }
  });
  let easy = others.filter((d) => !hardM.has(d));
  const easyShare = (): number => (easy.length > 0 ? leftM / easy.length : 0);
  while (easy.length > 0 && easyShare() < LEAST_RUN_M) easy = easy.slice(0, -1);
  const easyM = roundM(Math.min(easyShare(), runCap));
  const hardOrder = [...hardM.keys()];
  const sessionFor = (weekday: number): PlanSession | null => {
    if (weekday === longDay && longM > 0) return { kind: "long", m: longM, reps: null };
    const hard = hardM.get(weekday);
    if (hard !== undefined) return hardOrder.indexOf(weekday) === 0 ? steadyRun(hard, targetM, paces) : fastRun(hard, targetM, paces);
    return easy.includes(weekday) && easyM >= LEAST_RUN_M ? { kind: "easy", m: easyM, reps: null } : null;
  };
  const days: PlanDay[] = [];
  for (let i = 0; i < 7; i += 1) {
    const day = planDayPlus(weekStart, i);
    const session = day < start.from ? null : sessionFor(i + 1);
    const ran = input.runs.find((x) => x.day === day);
    const m = session !== null && session.kind !== "walk_run" ? session.m : 0;
    days.push({ day, weekday: i + 1, session, done: session !== null && ran !== undefined && ran.longestM >= m / 2 });
  }
  return tickMovedRuns(days, input.runs, start.from);
}

/** A run recorded on a day with no planned run, or past its own day's, ticks the nearest planned run of
 *  the week not yet ticked that it covers (half its distance or more), the earlier of two as near: a
 *  person who runs on Tuesday instead of Monday has done Monday's run, as Runna counts it. */
function tickMovedRuns(days: PlanDay[], runs: readonly RunDay[], from: string): PlanDay[] {
  const out = days.map((d) => ({ ...d }));
  const weekRuns = runs.filter((x) => x.day >= from && out.some((d) => d.day === x.day));
  for (const run of weekRuns) {
    const own = out.find((d) => d.day === run.day);
    if (own?.done === true) continue;
    const at = out.findIndex((d) => d.day === run.day);
    let best: PlanDay | null = null;
    let bestGap = Infinity;
    for (const [i, d] of out.entries()) {
      if (d.session === null || d.done || d.session.kind === "walk_run" || run.longestM < d.session.m / 2) continue;
      const gap = Math.abs(i - at);
      if (gap < bestGap) {
        best = d;
        bestGap = gap;
      }
    }
    if (best !== null) best.done = true;
  }
  return out;
}

/** Steady running at threshold, as repeats of 1 km (1.6 km past 3 km), a minute's easy jog between. */
function steadyRun(m: number, weekM: number, paces: Paces | null): PlanSession {
  const steadyM = Math.min(weekM * STEADY_SHARE, m - 2 * WARM_M, paces === null ? Infinity : (30 * 60 * 1000) / paces.steady[0]);
  const repM = steadyM > 3000 ? 1600 : STEADY_LEAST_M;
  const count = Math.floor(steadyM / repM);
  if (count < 1) return { kind: "easy", m, reps: null };
  return { kind: "steady", m, reps: { count, m: repM, restS: 60 } };
}

/** Fast repeats of 800 m, an easy jog as long as each between. */
function fastRun(m: number, weekM: number, paces: Paces | null): PlanSession {
  const fastM = Math.min(weekM * FAST_SHARE, 10_000, m - 2 * WARM_M);
  const count = Math.floor(fastM / FAST_REP_M);
  if (count < 2) return { kind: "easy", m, reps: null };
  return { kind: "fast", m, reps: { count, m: FAST_REP_M, restS: paces === null ? 180 : Math.round((paces.fast * FAST_REP_M) / 1000) } };
}

// ── The reply ──────────────────────────────────────────────────────────────────────────────────

const partSchema = z.object({ kind: z.enum(["walk", "run"]), s: z.number().int().positive() });
const repsSchema = z.object({ count: z.number().int().positive(), m: z.number().int().positive(), restS: z.number().int().positive() });
const sessionSchema = z.union([
  z.object({ kind: z.literal("walk_run"), week: z.number().int(), run: z.number().int(), parts: z.array(partSchema) }),
  z.object({ kind: z.enum(["easy", "long", "steady", "fast"]), m: z.number().int().nonnegative(), reps: repsSchema.nullable() }),
]);
const planDaySchema = z.object({ day: z.string(), weekday: z.number().int().min(1).max(7), session: sessionSchema.nullable(), done: z.boolean() });
const aheadSchema = z.object({ week: z.number().int(), m: z.number().int().nullable(), easier: z.boolean(), parts: z.array(partSchema).nullable() });
const pacesSchema = z.object({ easy: z.tuple([z.number(), z.number()]), steady: z.tuple([z.number(), z.number()]), fast: z.number() });

export const runPlanSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none"), why: z.enum(["safe_mode", "not_for_me"]) }),
  z.object({ kind: z.literal("c25k"), week: z.number().int(), days: z.array(planDaySchema), ahead: z.array(aheadSchema), goal: z.enum(RUN_GOALS), repeat: z.boolean() }),
  z.object({
    kind: z.literal("runner"),
    week: z.number().int(),
    goal: z.enum(RUN_GOALS),
    weekM: z.number().int(),
    easier: z.boolean(),
    ready: z.boolean(),
    days: z.array(planDaySchema),
    ahead: z.array(aheadSchema),
    paces: pacesSchema.nullable(),
    raceOld: z.boolean(),
    held: z.boolean(),
    hard: z.boolean(),
  }),
]);

/** GET and PUT /v1/geo/run-plan: the answers (null before any) and the plan from them (null with
 *  no answers, except in Safe mode, which says why). */
export const runPlanResponseSchema = z.object({
  answers: runPlanAnswersSchema.nullable(),
  plan: runPlanSchema.nullable(),
});
export type RunPlanResponse = z.infer<typeof runPlanResponseSchema>;
