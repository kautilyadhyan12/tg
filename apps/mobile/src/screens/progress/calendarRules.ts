import type { WorkoutListItem } from "@app/shared";
import { count, hoursWords } from "../dashboard/words";
import { addDays } from "./progressRules";

// Progress's Calendar (ROADMAP Stage 5 35c-i): a month of days with a flame on each day trained, and
// the year as squares. The days are the server's, keyed in the person's own zone ("YYYY-MM-DD"); the
// phone's today ends them. Pure, so tested alone.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const pad = (n: number) => String(n).padStart(2, "0");
const keyOf = (y: number, m: number, d: number) => `${String(y)}-${pad(m)}-${pad(d)}`;
const parts = (key: string) => {
  const [y = 0, m = 1, d = 1] = key.split("-").map(Number);
  return { y, m, d };
};
/** Monday 0 … Sunday 6. */
const weekday = (key: string) => {
  const { y, m, d } = parts(key);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
};

/** A month: "2026-10". */
export interface Month {
  y: number;
  /** 1 to 12. */
  m: number;
}

export const monthOf = (key: string): Month => {
  const { y, m } = parts(key);
  return { y, m };
};
export const monthWords = (mo: Month) => `${MONTHS[mo.m - 1] ?? ""} ${String(mo.y)}`;
export const sameMonth = (a: Month, b: Month) => a.y === b.y && a.m === b.m;
export const nextMonth = (mo: Month, by: number): Month => {
  const z = mo.y * 12 + (mo.m - 1) + by;
  return { y: Math.floor(z / 12), m: (z % 12) + 1 };
};

export interface DayCell {
  key: string;
  date: number;
  /** Workouts that day. */
  workouts: number;
  today: boolean;
  /** After today: drawn faint, never lit. */
  later: boolean;
}

/** A month, Monday first: blanks before its first day, then each day with its workouts. */
export function monthCells(mo: Month, workouts: ReadonlyMap<string, number>, today: string): (DayCell | null)[] {
  const first = keyOf(mo.y, mo.m, 1);
  const days = new Date(Date.UTC(mo.y, mo.m, 0)).getUTCDate();
  const cells: (DayCell | null)[] = Array.from({ length: weekday(first) }, () => null);
  for (let d = 1; d <= days; d += 1) {
    const key = keyOf(mo.y, mo.m, d);
    const later = key > today;
    cells.push({ key, date: d, workouts: later ? 0 : Math.max(0, workouts.get(key) ?? 0), today: key === today, later });
  }
  return cells;
}

export function activeDaysWords(cells: readonly (DayCell | null)[]): string {
  const n = cells.filter((c) => c !== null && c.workouts > 0).length;
  return `${count(n)} active ${n === 1 ? "day" : "days"}`;
}

/** What a screen reader says for a day: "Wednesday 14 October, 1 workout". */
export function daySaid(c: DayCell): string {
  const names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const { m } = parts(c.key);
  const what = c.workouts === 0 ? (c.later ? "" : ", no workout") : `, ${count(c.workouts)} ${c.workouts === 1 ? "workout" : "workouts"}`;
  return `${names[weekday(c.key)] ?? ""} ${String(c.date)} ${MONTHS[m - 1] ?? ""}${c.today ? ", today" : ""}${what}`;
}

/** What a screen reader says for a lit square of the year: "Monday 26 October, 2 workouts". */
export function squareSaid(s: YearSquare, today: string): string {
  return daySaid({ key: s.key, date: parts(s.key).d, workouts: s.workouts, today: s.key === today, later: false });
}

/** The months the calendar can show: from the first month of the server's year of days to this one. */
export function monthRange(today: string, days: number): { first: Month; last: Month } {
  return { first: monthOf(addDays(today, -(days - 1))), last: monthOf(today) };
}

export interface YearSquare {
  key: string;
  workouts: number;
  /** Before the year's first day or after today: drawn empty. */
  outside: boolean;
}

/** The year as weeks, Monday at the top: the first column starts on the Monday before its first day,
 *  the last ends on the Sunday of this week. Each column names its month where a new one begins. */
export function yearColumns(today: string, days: number, workouts: ReadonlyMap<string, number>): { label: string; squares: YearSquare[] }[] {
  const from = addDays(today, -(days - 1));
  const start = addDays(from, -weekday(from));
  const end = addDays(today, 6 - weekday(today));
  const out: { label: string; squares: YearSquare[] }[] = [];
  let shown = -1;
  for (let monday = start; monday <= end; monday = addDays(monday, 7)) {
    const squares: YearSquare[] = [];
    for (let i = 0; i < 7; i += 1) {
      const key = addDays(monday, i);
      const outside = key < from || key > today;
      squares.push({ key, workouts: outside ? 0 : Math.max(0, workouts.get(key) ?? 0), outside });
    }
    const firstIn = squares.find((s) => !s.outside)?.key ?? monday;
    const { m } = parts(firstIn);
    const label = m !== shown ? (SHORT[m - 1] ?? "") : "";
    shown = m;
    out.push({ label, squares });
  }
  return out;
}

/** How bright a day's square is: none, one workout, two, three or more. */
export const level = (workouts: number): 0 | 1 | 2 | 3 => (workouts <= 0 ? 0 : workouts === 1 ? 1 : workouts === 2 ? 2 : 3);

export interface MonthPick {
  month: Month;
  /** "Oct". */
  label: string;
  /** Days with a workout in it. */
  active: number;
  /** Inside the server's year of days, so it can be opened. */
  open: boolean;
}

/** Every month the calendar can open, for the box that picks one: the newest year first, each year's
 *  months in order; the first year from its first month, this year to December, its later months shut. */
export function monthsToPick(first: Month, last: Month, workouts: ReadonlyMap<string, number>): { year: number; months: MonthPick[] }[] {
  const active = new Map<string, number>();
  for (const [key, n] of workouts) if (n > 0) active.set(key.slice(0, 7), (active.get(key.slice(0, 7)) ?? 0) + 1);
  const at = (mo: Month) => mo.y * 12 + mo.m;
  const years: { year: number; months: MonthPick[] }[] = [];
  for (let y = last.y; y >= first.y; y -= 1) {
    const months: MonthPick[] = [];
    for (let m = y === first.y ? first.m : 1; m <= 12; m += 1) {
      const month = { y, m };
      months.push({ month, label: SHORT[m - 1] ?? "", active: active.get(`${String(y)}-${pad(m)}`) ?? 0, open: at(month) >= at(first) && at(month) <= at(last) });
    }
    years.push({ year: y, months });
  }
  return years;
}

/** What a screen reader says for a month to pick: "October 2026, 7 active days". */
export const monthPickSaid = (p: MonthPick) => `${monthWords(p.month)}, ${p.active === 1 ? "1 active day" : `${count(p.active)} active days`}`;

/** A day as the phone's clock has it, from its midnight to the next, as instants: the window the
 *  server's list of workouts is read over (`from` in, `to` out). */
export function dayWindow(key: string): { from: string; to: string } {
  const { y, m, d } = parts(key);
  return { from: new Date(y, m - 1, d).toISOString(), to: new Date(y, m - 1, d + 1).toISOString() };
}

/** The day box's title: "Monday 26 October", with its year when it is not this year's. */
export function dayTitle(key: string, today: string): string {
  const names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const { y, m, d } = parts(key);
  const year = key.slice(0, 4) === today.slice(0, 4) ? "" : ` ${String(y)}`;
  return `${names[weekday(key)] ?? ""} ${String(d)} ${MONTHS[m - 1] ?? ""}${year}`;
}

/** "6:30 pm", on the phone's clock. */
export function clockWords(at: Date): string {
  const h = at.getHours();
  return `${String(h % 12 === 0 ? 12 : h % 12)}:${pad(at.getMinutes())} ${h < 12 ? "am" : "pm"}`;
}

export interface DayWorkout {
  id: string;
  /** "6:30 pm · 40 min". */
  when: string;
  /** "3 sets · 30 reps · form 84". */
  what: string;
  /** "21", or null where the workout has no calories. */
  kcal: string | null;
  said: string;
}

const many = (n: number, one: string, more: string) => `${count(n)} ${n === 1 ? one : more}`;

/** A day's workouts, earliest first, in the words of the day box. */
export function dayWorkouts(items: readonly WorkoutListItem[]): DayWorkout[] {
  return [...items]
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
    .map((w) => {
      const when = [clockWords(new Date(w.startedAt)), w.durationMs === null ? null : hoursWords(w.durationMs)].filter((x) => x !== null).join(" · ");
      const what = [many(w.setsCount, "set", "sets"), many(w.totalReps, "rep", "reps"), w.avgFormScore === null ? null : `form ${String(w.avgFormScore)}`].filter((x) => x !== null).join(" · ");
      const kcal = w.kcalPoint === null ? null : count(w.kcalPoint);
      return { id: w.id, when, what, kcal, said: [when, what, kcal === null ? null : `${kcal} kcal`].filter((x) => x !== null).join(", ") };
    });
}

/** The day's three numbers above its workouts: how many, the time trained, the calories. */
export function daySum(items: readonly WorkoutListItem[]): { workouts: string; trained: string | null; kcal: string | null } {
  const ms = items.reduce((n, w) => n + (w.durationMs ?? 0), 0);
  const withKcal = items.filter((w) => w.kcalPoint !== null);
  return {
    workouts: count(items.length),
    trained: items.some((w) => w.durationMs !== null) ? hoursWords(ms) : null,
    kcal: withKcal.length === 0 ? null : count(withKcal.reduce((n, w) => n + (w.kcalPoint ?? 0), 0)),
  };
}
