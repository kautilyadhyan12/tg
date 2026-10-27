import type { WeeklyChallenge, WorkoutListItem } from "@app/shared";

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

/** 64,800,000 ms → "18h"; under an hour, "45 min". Whole hours, rounded down, as the browser shows. */
export function hoursWords(durationMs: number): { value: string; minutes: string } {
  const minutes = Math.floor(durationMs / 60_000);
  const value = minutes < 60 ? `${count(minutes)} min` : `${count(Math.floor(minutes / 60))}h`;
  return { value, minutes: plural(minutes, "minute", "minutes") };
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

/** The days of this week with a workout, and how many workouts, from the server's days. Two workouts
 *  on one day are one day trained and two workouts. */
export function weekTrained(points: readonly { date: string; workouts: number }[], week: readonly WeekDay[]) {
  const byDay = new Map<string, number>();
  for (const p of points) byDay.set(p.date, (byDay.get(p.date) ?? 0) + Math.max(0, p.workouts));
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

/** One recent workout's line: "Mon 12 Oct · 38 min", and on its right the kcal and the camera's form
 *  score, each only when the server has it. */
export function workoutLine(w: WorkoutListItem): { when: string; kcal: string | null; form: string | null } {
  const day = dayWords(w.startedAt);
  const minutes = w.durationMs === null ? null : Math.max(1, Math.round(w.durationMs / 60_000));
  const when = [day, minutes === null ? null : `${count(minutes)} min`].filter((p) => p !== null).join(" · ");
  return {
    when,
    kcal: w.kcalPoint === null ? null : `${count(w.kcalPoint)} kcal`,
    form: w.avgFormScore === null ? null : `${count(w.avgFormScore)} form`,
  };
}

/** No recent workouts: a new person, somebody whose workouts are all older than the plan's window,
 *  and a server that did not say which. Each is told what is true for them. */
export function noWorkoutsWords(hasAnyWorkouts: boolean | undefined, limitedToDays: number | null): string {
  if (hasAnyWorkouts === false) return "No workouts yet.";
  if (hasAnyWorkouts === true && limitedToDays !== null) return `No workouts in the ${windowWords(limitedToDays)}.`;
  return "No workouts to show.";
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

/** "1 of 3"; kcal and minutes read as numbers of their own. */
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
