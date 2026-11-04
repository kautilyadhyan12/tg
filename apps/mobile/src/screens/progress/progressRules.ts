import type { PersonalRecords, ProgressPeriod, ProgressTrend } from "@app/shared";
import { count, hoursWords } from "../dashboard/words";

// What the Progress page counts and says (ROADMAP Stage 5 35c-i). The server keys each day in the
// person's own zone; a period here is whole calendar days ending on the phone's today, as the
// Dashboard's week is: the server's 7-day read begins 7×24 hours ago, part-way through an eighth day,
// and that day is not counted. Pure, so tested alone.

export const PERIODS: readonly { key: ProgressPeriod; label: string; days: number | null }[] = [
  { key: "7d", label: "7 Days", days: 7 },
  { key: "30d", label: "30 Days", days: 30 },
  { key: "90d", label: "90 Days", days: 90 },
  { key: "1y", label: "1 Year", days: 365 },
  { key: "all", label: "All Time", days: null },
];

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
const keyOfUtc = (t: number) => {
  const d = new Date(t);
  return `${String(d.getUTCFullYear())}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const utcOf = (key: string) => {
  const [y = 0, m = 1, d = 1] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

/** The calendar day where the phone is, "YYYY-MM-DD". */
export function dayKeyOf(now: Date): string {
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDays(key: string, n: number): string {
  return keyOfUtc(utcOf(key) + n * DAY);
}

const daysFrom = (from: string, to: string) => Math.round((utcOf(to) - utcOf(from)) / DAY) + 1;

export interface Window {
  /** The first and last day counted, "YYYY-MM-DD", both inside. */
  from: string;
  to: string;
  days: number;
  /** The plan's history limit, where it made the period shorter; null where it did not. */
  cut: number | null;
}

/** The days a period covers: 7 Days is today and the 6 days before. A plan's history limit makes it
 *  its own last N days. All Time starts at the first workout, and has no days before one. */
export function periodWindow(period: ProgressPeriod, today: string, read: Pick<ProgressTrend, "points" | "limitedToDays">): Window | null {
  const limit = read.limitedToDays !== null && read.limitedToDays > 0 ? read.limitedToDays : null;
  const asked = PERIODS.find((p) => p.key === period)?.days ?? null;
  if (asked !== null) {
    const cut = limit !== null && limit < asked ? limit : null;
    const days = cut ?? asked;
    return { from: addDays(today, -(days - 1)), to: today, days, cut };
  }
  const first = read.points.map((p) => p.date).filter((d) => d <= today).sort()[0];
  if (first === undefined) return null;
  const floor = limit === null ? first : addDays(today, -(limit - 1));
  const from = first > floor ? first : floor;
  return { from, to: today, days: daysFrom(from, today), cut: limit };
}

const inside = (date: string, w: Window) => date >= w.from && date <= w.to;

export interface Totals {
  workouts: number;
  kcal: number;
  /** Training time on the same days, as the server keeps it for each day. */
  durationMs: number;
  daysTrained: number;
}

export function totals(points: ProgressTrend["points"], w: Window): Totals {
  const days = new Set<string>();
  let workouts = 0;
  let kcal = 0;
  let durationMs = 0;
  for (const p of points) {
    if (!inside(p.date, w) || p.workouts <= 0) continue;
    days.add(p.date);
    workouts += p.workouts;
    kcal += Math.max(0, p.kcal);
    durationMs += Math.max(0, p.durationMs);
  }
  return { workouts, kcal, durationMs, daysTrained: days.size };
}

/** Consistency as a whole percent of the period's days: never over 100, never a made-up 0 of 0. */
export function consistencyPct(t: Totals, w: Window): number {
  return w.days <= 0 ? 0 : Math.min(100, Math.round((t.daysTrained / w.days) * 100));
}

/** The streak's box: "3 days" and the longest ever beside it. */
export function streakWords(days: number): string {
  return `${count(days)} ${days === 1 ? "day" : "days"}`;
}

export type Step = "day" | "week" | "month" | "year";

/** A bar a day up to 14 days, a week up to 90, a month up to 400, else a year: never more than 14 bars. */
export function stepFor(days: number): Step {
  if (days <= 14) return "day";
  if (days <= 90) return "week";
  if (days <= 400) return "month";
  return "year";
}

const STEP_NAMES: Record<Step, string> = { day: "Day", week: "Week", month: "Month", year: "Year" };
export const stepTitle = (step: Step) => `Workouts Per ${STEP_NAMES[step]}`;

export interface Bucket {
  from: string;
  to: string;
  /** Under the bar; "" where a crowded row leaves it unnamed. */
  label: string;
  /** What a screen reader says for the bar: its exact days and its numbers. */
  said: string;
  workouts: number;
  kcal: number;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const parts = (key: string) => {
  const d = new Date(utcOf(key));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), date: d.getUTCDate(), weekday: d.getUTCDay() };
};
const monthName = (key: string) => MONTHS[parts(key).month] ?? "";
const dateWords = (key: string, year = false) => {
  const p = parts(key);
  return `${String(p.date)} ${monthName(key)}${year ? ` ${String(p.year)}` : ""}`;
};
const dayWords = (key: string) => `${WEEKDAYS[parts(key).weekday] ?? ""} ${dateWords(key)}`;

/** The next bar's first day after `key`, for a step. */
function nextStart(key: string, step: Step): string {
  const p = parts(key);
  if (step === "day") return addDays(key, 1);
  if (step === "week") return addDays(key, 7 - ((p.weekday + 6) % 7));
  if (step === "month") return keyOfUtc(Date.UTC(p.year, p.month + 1, 1));
  return keyOfUtc(Date.UTC(p.year + 1, 0, 1));
}

const numbersWords = (workouts: number, kcal: number) =>
  workouts === 0 ? "no workouts" : `${count(workouts)} ${workouts === 1 ? "workout" : "workouts"}, ${count(kcal)} kcal`;

/** The window's days in bars: days, weeks from Monday, months or years. The first bar starts on the
 *  window's first day and the last ends today, so a bar never counts a day outside the period. */
export function buckets(points: ProgressTrend["points"], w: Window): Bucket[] {
  const step = stepFor(w.days);
  const spans: { from: string; to: string }[] = [];
  for (let from = w.from; from <= w.to; ) {
    const next = nextStart(from, step);
    const to = addDays(next, -1) < w.to ? addDays(next, -1) : w.to;
    spans.push({ from, to });
    from = next;
  }
  const byDay = new Map<string, { workouts: number; kcal: number }>();
  for (const p of points) {
    if (!inside(p.date, w) || p.workouts <= 0) continue;
    const had = byDay.get(p.date) ?? { workouts: 0, kcal: 0 };
    byDay.set(p.date, { workouts: had.workouts + p.workouts, kcal: had.kcal + Math.max(0, p.kcal) });
  }
  const crowded = spans.length > 6;
  return spans.map((span, i) => {
    let workouts = 0;
    let kcal = 0;
    for (let d = span.from; d <= span.to; d = addDays(d, 1)) {
      const had = byDay.get(d);
      if (had === undefined) continue;
      workouts += had.workouts;
      kcal += had.kcal;
    }
    const before = spans[i - 1];
    let label: string;
    if (step === "day") label = w.days <= 7 ? (WEEKDAYS[parts(span.from).weekday] ?? "").slice(0, 3) : String(parts(span.from).date);
    else if (step === "week") label = !crowded ? dateWords(span.from) : before === undefined || monthName(before.from) !== monthName(span.from) ? monthName(span.from) : "";
    else if (step === "month") label = crowded ? monthName(span.from).slice(0, 1) : monthName(span.from);
    else label = String(parts(span.from).year);
    const days =
      step === "day"
        ? dayWords(span.from)
        : `${dateWords(span.from, step !== "week")} to ${dateWords(span.to, step !== "week")}`;
    return { ...span, label, said: `${days}: ${numbersWords(workouts, kcal)}`, workouts, kcal };
  });
}

/** What a screen reader says for the calories chart: the total, then each bar's days and number. */
export function caloriesSaid(bars: readonly Bucket[], total: number): string {
  const each = bars.map((b) => `${b.said.split(":")[0] ?? ""}, ${count(b.kcal)}`);
  return `Calories burned, ${count(total)} kcal: ${each.join("; ")}`;
}

export function consistencyWords(t: Totals, w: Window): string {
  return `${count(t.daysTrained)} of ${count(w.days)} ${w.days === 1 ? "day" : "days"}`;
}

/** In place of the two charts, for a period with no workout in it. */
export function noneWords(w: Window): string {
  return `No workouts in the last ${w.days === 365 ? "year" : w.days === 1 ? "day" : `${count(w.days)} days`}`;
}

/** Said only where the plan made the period shorter. "Any": the server cannot say whether there are older ones. */
export function cutWords(w: Window): string | null {
  return w.cut === null ? null : `Your plan shows your last ${count(w.cut)} days. Any older workouts are still saved.`;
}

export interface RecordRow {
  icon: "clock" | "flame" | "star" | "dumbbell";
  label: string;
  value: string;
  /** False where there is no record yet: the value is drawn quiet. */
  held: boolean;
}

/** The web's records, but the longest streak, which the Streak box shows beside today's. */
export function recordRows(r: PersonalRecords): RecordRow[] {
  return [
    { icon: "clock", label: "Longest workout", value: r.longestWorkout === null ? "None yet" : hoursWords(r.longestWorkout.value), held: r.longestWorkout !== null },
    { icon: "flame", label: "Most calories", value: r.maxKcalWorkout === null ? "None yet" : `${count(Math.round(r.maxKcalWorkout.value))} kcal`, held: r.maxKcalWorkout !== null },
    { icon: "star", label: "Best form", value: r.bestAvgForm === null ? "No score yet" : count(Math.round(r.bestAvgForm.value)), held: r.bestAvgForm !== null },
    { icon: "dumbbell", label: "Total workouts", value: count(r.totalWorkouts), held: r.totalWorkouts > 0 },
  ];
}

/** Records take no period: the box says what they come from, whatever chip is lit. */
export function recordsFrom(r: PersonalRecords): string {
  return r.limitedToDays === null ? "From all your workouts" : `From your last ${count(r.limitedToDays)} days`;
}
