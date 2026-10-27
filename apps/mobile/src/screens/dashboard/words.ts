import type { Meal, MealType, RunSummary, WeeklyChallenge, WorkoutListItem } from "@app/shared";

// What the Dashboard says about the numbers the server sends (ROADMAP Stage 5 item 31a). The server
// computes every number; these only put it into words. Nothing here guesses a number it was not sent.

/** Shown in a number's place while it is loading, or when its read failed. */
export const NOT_KNOWN = "–";

/** 1240 → "1,240". Written here: the phone's own number formatting differs between Android versions. */
export function count(n: number): string {
  const sign = n < 0 ? "-" : "";
  const digits = String(Math.abs(Math.trunc(n)));
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

const plural = (n: number, one: string, many: string) => `${count(n)} ${n === 1 ? one : many}`;

/** What window the server's totals cover: everything, or the plan's last N days. */
export function windowWords(limitedToDays: number | null): string {
  return limitedToDays === null ? "all time" : `last ${plural(limitedToDays, "day", "days")}`;
}

/** 64,800,000 ms → "18h"; 380 minutes → "6h 20m"; under an hour, "45 min". Minutes rounded down. */
export function hoursWords(durationMs: number): string {
  const minutes = Math.floor(durationMs / 60_000);
  if (minutes < 60) return `${count(minutes)} min`;
  const rest = minutes % 60;
  return rest === 0 ? `${count(Math.floor(minutes / 60))}h` : `${count(Math.floor(minutes / 60))}h ${String(rest)}m`;
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export interface WeekDay {
  /** "YYYY-MM-DD", the phone's own calendar day: the server keys its days in the person's time zone. */
  key: string;
  name: (typeof DAY_NAMES)[number];
  date: number;
  today: boolean;
  future: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (d: Date) => `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** This week, Monday to Sunday, on the phone's own calendar. */
export function weekOf(now: Date): WeekDay[] {
  const fromMonday = (now.getDay() + 6) % 7;
  return DAY_NAMES.map((name, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - fromMonday + i);
    return { key: dayKey(d), name, date: d.getDate(), today: i === fromMonday, future: i > fromMonday };
  });
}

/** The days of this week with a workout or a run, and how many sessions, from the server's days. Two
 *  on one day are one day trained and two sessions. */
export function weekTrained(
  points: readonly { date: string; workouts: number }[],
  week: readonly WeekDay[],
  runDays: readonly { date: string; runs: number }[] = [],
) {
  const byDay = new Map<string, number>();
  for (const p of points) byDay.set(p.date, (byDay.get(p.date) ?? 0) + Math.max(0, p.workouts));
  for (const r of runDays) byDay.set(r.date, (byDay.get(r.date) ?? 0) + Math.max(0, r.runs));
  const trained = week.map((day) => (byDay.get(day.key) ?? 0) > 0);
  const workouts = week.reduce((n, day) => n + (byDay.get(day.key) ?? 0), 0);
  return { trained, days: trained.filter(Boolean).length, workouts };
}

export function activeDaysWords(days: number): string {
  return `${count(days)} of 7 days active`;
}

/** "1,240/1,500 XP → Level 8": what is earned in this level, of what the next one needs. */
export function xpToNext(xp: { level: number; xpInLevel: number; xpForNext: number }): string {
  return `${count(xp.xpInLevel)}/${count(xp.xpForNext)} XP → Level ${count(xp.level + 1)}`;
}

/** The bar's filled share, 0 to 100, from the server's own percentage. */
export function barShare(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  return Math.min(100, Math.max(0, pct));
}

/** "Mon 12 Oct", on the phone's own calendar. */
export function dayWords(iso: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return `${DAY_NAMES[(at.getDay() + 6) % 7] ?? ""} ${String(at.getDate())} ${MONTHS[at.getMonth()] ?? ""}`;
}

export type ActivityKind = "workout" | "run" | "meal";

/** One row of Recent Activity: named by its day, with what it was under it ("Workout · 38 min · 86 form",
 *  "Evening run · 31 min", "Lunch · Meal scan") and its number on the right; each part only when known. */
export interface ActivityRow {
  key: string;
  kind: ActivityKind;
  at: string;
  day: string;
  detail: string;
  value: string | null;
}

const MEAL_TYPES: Record<MealType, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack" };

const minutesWords = (minutes: number | null) => (minutes === null ? null : `${count(Math.max(1, Math.round(minutes)))} min`);
const joined = (parts: (string | null)[]) => parts.filter((p) => p !== null).join(" · ");

/** 5,230 m → "5.2 km"; under a kilometre, "850 m". */
export function distanceWords(metres: number): string {
  return metres < 1000 ? `${count(metres)} m` : `${(Math.floor(metres / 100) / 10).toFixed(1)} km`;
}

export function workoutRow(w: WorkoutListItem): ActivityRow {
  return {
    key: `workout-${w.id}`,
    kind: "workout",
    at: w.startedAt,
    day: dayWords(w.startedAt) ?? "Workout",
    detail: joined(["Workout", minutesWords(w.durationMs === null ? null : w.durationMs / 60_000), w.avgFormScore === null ? null : `${count(w.avgFormScore)} form`]),
    value: w.kcalPoint === null ? null : `${count(w.kcalPoint)} kcal`,
  };
}

export function runRow(r: RunSummary): ActivityRow {
  return {
    key: `run-${r.id}`,
    kind: "run",
    at: r.startedAt,
    day: dayWords(r.startedAt) ?? "Run",
    detail: joined([r.routeName ?? "Run", minutesWords(r.durationS / 60)]),
    value: distanceWords(r.distanceM),
  };
}

export function mealRow(m: Meal): ActivityRow {
  return {
    key: `meal-${m.id}`,
    kind: "meal",
    at: m.takenAt,
    day: dayWords(m.takenAt) ?? "Meal",
    detail: joined([m.mealName ?? (m.mealType === null ? "Meal" : MEAL_TYPES[m.mealType]), m.origin === "photo" ? "Meal scan" : "Logged"]),
    value: `${count(m.totals.kcalPoint)} kcal`,
  };
}

/** The newest few of everything done, whatever kind; a time the phone cannot read goes last. */
export function recentActivity(
  lists: { workouts: readonly WorkoutListItem[]; runs: readonly RunSummary[]; meals: readonly Meal[] },
  most = 3,
): ActivityRow[] {
  const rows = [...lists.workouts.map(workoutRow), ...lists.runs.map(runRow), ...lists.meals.map(mealRow)];
  const when = (row: ActivityRow) => {
    const t = Date.parse(row.at);
    return Number.isNaN(t) ? -Infinity : t;
  };
  return rows.sort((a, b) => when(b) - when(a)).slice(0, most);
}

/** Nothing recent: a new person, somebody whose workouts are all older than the plan's window, and a
 *  server that did not say which. Each is told what is true for them. */
export function noActivityWords(hasAnyWorkouts: boolean | undefined, limitedToDays: number | null): string {
  if (hasAnyWorkouts === false) return "No activity yet.";
  if (hasAnyWorkouts === true && limitedToDays !== null) return `No activity in the ${windowWords(limitedToDays)}.`;
  return "No activity to show.";
}

/** A weekly challenge in words, from its code and its target. */
export function challengeWords(c: Pick<WeeklyChallenge, "code" | "target">): string {
  const n = c.target;
  switch (c.code) {
    case "train_days_3":
    case "train_days_5":
    case "train_days_7":
      return `Train on ${plural(n, "day", "days")}`;
    case "burn_kcal_1500":
    case "burn_kcal_3000":
      return `Burn ${count(n)} kcal`;
    case "train_minutes_120":
    case "train_minutes_300":
      return `Train for ${plural(n, "minute", "minutes")}`;
    case "form_80_workouts_3":
      return `${plural(n, "workout", "workouts")} with form 80 or higher`;
    case "form_90_workouts_3":
      return `${plural(n, "workout", "workouts")} with form 90 or higher`;
    case "families_3":
    case "families_5":
      return `Try ${plural(n, "kind of exercise", "kinds of exercise")}`;
    case "food_days_5":
    case "food_days_7":
      return `Log your food on ${plural(n, "day", "days")}`;
  }
}

/** "1 of 3", "800 of 1,500": done of the target, never past it. */
export function challengeProgress(c: Pick<WeeklyChallenge, "current" | "target">): string {
  return `${count(Math.min(c.current, c.target))} of ${count(c.target)}`;
}

/** The badges' names, by the server's codes (`apps/api/src/modules/gamification/badges.ts`). */
export const BADGE_NAMES: Readonly<Record<string, string>> = {
  first_workout: "First Workout",
  ten_workouts: "10 Workouts",
  fifty_workouts: "50 Workouts",
  hundred_workouts: "100 Workouts",
  streak_3: "3-Day Streak",
  streak_7: "7-Day Streak",
  streak_30: "30-Day Streak",
  streak_100: "100-Day Streak",
  form_perfect: "Perfect Form",
  form_master: "Form Master",
  calorie_1k: "1,000 kcal Burned",
  calorie_10k: "10,000 kcal Burned",
  early_bird: "Early Bird",
  night_owl: "Night Owl",
  variety_5: "5 Kinds of Exercise",
  variety_all: "Every Kind of Exercise",
  first_meal: "First Meal Logged",
  macro_master: "Protein Target, 7 Days",
  photo_meal: "First Meal Photo",
};

/** The newest badges first, by name; a code this phone does not know yet is left out, never shown raw. */
export function latestBadges(earned: readonly { code: string; earnedAt: string }[], most = 2): string[] {
  return [...earned]
    .sort((a, b) => Date.parse(b.earnedAt) - Date.parse(a.earnedAt))
    .map((one) => BADGE_NAMES[one.code])
    .filter((name): name is string => name !== undefined)
    .slice(0, most);
}

/** The browser's seven, one a day of the week. */
export const QUOTES = [
  { text: "The only bad workout is the one that didn’t happen.", author: "Unknown" },
  { text: "Strength does not come from the body. It comes from the will.", author: "Gandhi" },
  { text: "Take care of your body. It’s the only place you have to live.", author: "Jim Rohn" },
  { text: "The pain you feel today will be the strength you feel tomorrow.", author: "Arnold Schwarzenegger" },
  { text: "Your body can stand almost anything. It’s your mind you have to convince.", author: "Unknown" },
  {
    text: "Fitness is not about being better than someone else. It’s about being better than you used to be.",
    author: "Khloe Kardashian",
  },
  { text: "The difference between the impossible and the possible lies in determination.", author: "Tommy Lasorda" },
] as const;

export function quoteOf(now: Date): (typeof QUOTES)[number] {
  return QUOTES[now.getDay() % QUOTES.length] ?? QUOTES[0];
}
