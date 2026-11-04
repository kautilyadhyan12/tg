import { count } from "../dashboard/words";
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
