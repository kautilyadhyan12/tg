// THE STREAK REMINDER, BADGES AND THE SUNDAY SUMMARY (ROADMAP Stage 5 item 19e-ii): the three
// notifications the app decides by itself. Never bombarded (Kd, 2026-11-05 and 2026-11-06): at most one
// of the three a day, none from 9:30 pm to 8 am on the person's own clock, and they give way to every
// other notification: none within 2 hours of another reaching the phone, none on a day 3 already have.
import { z } from "zod";

/** 7 pm: the streak reminder, on a day with nothing done yet. */
export const STREAK_REMINDER_MINUTE = 19 * 60;
/** Opened the app after 5 pm: they know, and the streak reminder does not go. */
export const STREAK_SEEN_AFTER_MINUTE = 17 * 60;
/** A streak this long or longer gets the reminder. */
export const STREAK_REMINDER_LEAST = 3;
/** Sunday at 6 pm: the summary of the week. */
export const SUMMARY_MINUTE = 18 * 60;
/** A notice is sent within this many minutes of its time, never late. */
export const NUDGE_DUE_MINUTES = 30;
/** None of the three before 8 am or from 9:30 pm. */
export const NUDGE_FIRST_MINUTE = 8 * 60;
export const NUDGE_LAST_MINUTE = 21 * 60 + 30;
/** None within this long after any other notification reached the person's phone. */
export const NUDGE_AFTER_OTHER_MINUTES = 120;
/** None on a day this many notifications have already reached the person's phone. */
export const NUDGE_DAY_MOST = 3;
/** A badge not told within this many days is not told at all. */
export const BADGE_TELL_DAYS = 7;

export const NUDGE_KINDS = ["streak", "badges", "summary"] as const;
export type NudgeKind = (typeof NUDGE_KINDS)[number];

const inMinuteOfDay = (minute: unknown): minute is number => typeof minute === "number" && Number.isInteger(minute) && minute >= 0 && minute <= 1439;

/** Whether one of the three may go at this minute of the person's day: from 8 am up to 9:30 pm. Garbage
 *  sends nothing. */
export function nudgeHourOpen(minute: unknown): boolean {
  return inMinuteOfDay(minute) && minute >= NUDGE_FIRST_MINUTE && minute < NUDGE_LAST_MINUTE;
}

/** Whether a notice timed at `at` is due at `now` (minutes of the day): its time passed less than
 *  `NUDGE_DUE_MINUTES` ago. */
export function nudgeDue(at: number, now: unknown): boolean {
  return inMinuteOfDay(now) && now - at >= 0 && now - at < NUDGE_DUE_MINUTES;
}

/** Whether the other notifications leave room for one of the three now. `recent`: when the newest
 *  notifications reached the person's phone, each with the day it was on their clock; `today` is theirs.
 *  None within `NUDGE_AFTER_OTHER_MINUTES` of the newest, none once `NUDGE_DAY_MOST` reached it today. A
 *  time that cannot be read counts as just now. */
export function roomForNudge(recent: readonly { at: Date; day: string }[], today: string, now: Date): boolean {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return false;
  let todays = 0;
  for (const one of recent) {
    const at = one.at.getTime();
    if (!Number.isFinite(at) || nowMs - at < NUDGE_AFTER_OTHER_MINUTES * 60_000) return false;
    if (one.day === today) todays += 1;
  }
  return todays < NUDGE_DAY_MOST;
}

/** The badges' names, one name for one thing: the Dashboard's, Achievements' and the notification's. */
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

function andList(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1) ?? ""}`;
}

const count = (n: number, one: string, many: string): string => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** The names of these badges that the app knows, in the order given; a code it does not know is left out. */
const badgeNames = (codes: readonly string[]): string[] => codes.flatMap((code) => (BADGE_NAMES[code] === undefined ? [] : [BADGE_NAMES[code]]));

/** The streak reminder. `freeze`: a freeze is saved, and covers today if nothing is done. */
export function streakNotification(input: { days: number; freeze: boolean }): { title: string; body: string } | null {
  const { days, freeze } = input;
  if (!Number.isInteger(days) || days < STREAK_REMINDER_LEAST) return null;
  const streak = `${days.toLocaleString("en-US")}-day streak`;
  return freeze
    ? { title: "Keep your streak going", body: `No workout yet today. A freeze will keep your ${streak} safe, but a short workout keeps it going.` }
    : { title: "Keep your streak going", body: `Your ${streak} ends at midnight. Even a short workout counts.` };
}

/** New badges, told together. None the app knows is no notification. */
export function badgeNotification(codes: readonly string[]): { title: string; body: string } | null {
  const names = badgeNames(codes);
  if (names.length === 0) return null;
  return { title: names.length === 1 ? "New badge" : `${String(names.length)} new badges`, body: `You earned ${andList(names)}.` };
}

export interface WeekSummary {
  workouts: number;
  /** Runs that count toward a streak. */
  runs: number;
  visits: number;
  lastWeekWorkouts: number;
  lastWeekRuns: number;
  lastWeekVisits: number;
  streak: number;
  /** Badges earned and not yet told, which the summary tells. */
  badges: readonly string[];
}

/** Whether the summary goes at all: not after two weeks in a row with nothing done. */
export function summaryWorthSending(week: WeekSummary): boolean {
  return week.workouts + week.runs + week.visits + week.lastWeekWorkouts + week.lastWeekRuns + week.lastWeekVisits > 0 || badgeNames(week.badges).length > 0;
}

/** The Sunday summary: the week's workouts and visits, beside last week's only when it is more, the
 *  streak and any new badge. Only good news: never a fall, never a push to train. */
export function summaryNotification(week: WeekSummary): { title: string; body: string } | null {
  if (!summaryWorthSending(week)) return null;
  const parts: string[] = [];
  const done = [
    ...(week.workouts > 0 ? [count(week.workouts, "workout", "workouts")] : []),
    ...(week.runs > 0 ? [count(week.runs, "run", "runs")] : []),
    ...(week.visits > 0 ? [count(week.visits, "visit", "visits")] : []),
  ];
  if (done.length === 0) {
    const before = [
      ...(week.lastWeekWorkouts > 0 ? [count(week.lastWeekWorkouts, "workout", "workouts")] : []),
      ...(week.lastWeekRuns > 0 ? [count(week.lastWeekRuns, "run", "runs")] : []),
      ...(week.lastWeekVisits > 0 ? [count(week.lastWeekVisits, "visit", "visits")] : []),
    ];
    parts.push(before.length === 0 ? "A quiet week." : `A quiet week. Last week: ${andList(before)}.`);
  } else {
    parts.push(`This week: ${andList(done)}.`);
    const more = week.workouts - week.lastWeekWorkouts;
    if (week.workouts > 0 && more > 0 && week.lastWeekWorkouts > 0) parts.push(`That’s ${count(more, "workout", "workouts")} more than last week.`);
  }
  if (week.streak >= 2) parts.push(`Your streak: ${count(week.streak, "day", "days")}.`);
  const names = badgeNames(week.badges);
  if (names.length > 0) parts.push(`${names.length === 1 ? "New badge" : "New badges"}: ${andList(names)}.`);
  return { title: "Your week", body: parts.join(" ") };
}

/** The Android channel the three arrive on; its name is what the phone's settings show. */
export const TRAINING_PROGRESS_CHANNEL = { id: "training-progress", name: "Streaks, badges and your week" } as const;

/** What each carries for the app: the place a tap opens. */
export const trainingNudgePushDataSchema = z
  .object({ kind: z.literal("training_nudge"), open: z.enum(["workout", "achievements", "dashboard"]) })
  .strip();
export type TrainingNudgePushData = z.infer<typeof trainingNudgePushDataSchema>;
