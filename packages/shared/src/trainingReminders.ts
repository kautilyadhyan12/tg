// THE WORKOUT AND MEAL REMINDERS (ROADMAP Stage 5 item 19e-i). The person sets each: on or off, a time
// and, for the workout, the days. Never bombarded (Kd, 2026-11-05): all start off; each goes at most once
// a day; none on a day the person already trained or logged that meal; two due within the hour arrive as
// one; and one whose person has not opened the app for a week pauses itself until they turn it on again.
import { z } from "zod";

export const REMINDER_KINDS = ["workout", "breakfast", "lunch", "dinner"] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];
export type MealReminderKind = Exclude<ReminderKind, "workout">;

/** Where each starts before the person picks a time: minutes after midnight on their own clock. */
export const REMINDER_DEFAULT_MINUTE: Record<ReminderKind, number> = {
  workout: 18 * 60,
  breakfast: 8 * 60,
  lunch: 13 * 60,
  dinner: 19 * 60 + 30,
};

/** A reminder goes within this many minutes of its time; one the server could not send by then (it was
 *  down) is not sent late. */
export const REMINDER_DUE_MINUTES = 30;
/** Another reminder due within this many minutes after one that goes now joins it in one notification. */
export const REMINDER_BUNDLE_MINUTES = 60;
/** Not opened the app for this many days: a reminder that comes due pauses itself instead of going. */
export const REMINDER_PAUSE_DAYS = 7;

/** "18:30", the person's own clock, in 5-minute steps as the time box offers. */
export const reminderTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "a time is HH:MM")
  .refine((time) => Number(time.slice(3)) % 5 === 0, "a time is in steps of 5 minutes");

/** Days of the week, ISO: 1 is Monday, 7 is Sunday. */
export const reminderDaySchema = z.number().int().min(1).max(7);

export const reminderSchema = z
  .object({
    kind: z.enum(REMINDER_KINDS),
    on: z.boolean(),
    time: reminderTimeSchema,
    /** The workout's chosen days, in order; a meal's are every day. */
    days: z.array(reminderDaySchema).min(1).max(7),
    /** Turned off by itself: the person had not opened the app for a week when it came due. */
    paused: z.boolean(),
  })
  .strict();
export type Reminder = z.infer<typeof reminderSchema>;

export const remindersResponseSchema = z.object({ reminders: z.array(reminderSchema).length(REMINDER_KINDS.length) }).strict();
export type RemindersResponse = z.infer<typeof remindersResponseSchema>;

/** Saving one reminder: all of it, so two presses never mix. Turning it on again ends a pause. */
export const reminderSaveSchema = z
  .object({
    on: z.boolean(),
    time: reminderTimeSchema,
    days: z
      .array(reminderDaySchema)
      .min(1)
      .max(7)
      .refine((days) => new Set(days).size === days.length, "a day is given once"),
  })
  .strict();
export type ReminderSave = z.infer<typeof reminderSaveSchema>;

export const reminderKindParamsSchema = z.object({ kind: z.enum(REMINDER_KINDS) }).strict();

/** The days as stored: Monday is 1, Sunday is 64. A meal's are every day. */
export function daysToBits(kind: ReminderKind, days: readonly number[]): number {
  if (kind !== "workout") return 127;
  let bits = 0;
  for (const day of days) if (Number.isInteger(day) && day >= 1 && day <= 7) bits |= 1 << (day - 1);
  return bits === 0 ? 127 : bits;
}

export function bitsToDays(bits: number): number[] {
  const days: number[] = [];
  for (let day = 1; day <= 7; day += 1) if ((bits & (1 << (day - 1))) !== 0) days.push(day);
  return days.length === 0 ? [1, 2, 3, 4, 5, 6, 7] : days;
}

export const minuteToTime = (minute: number): string =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
export const timeToMinute = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** Which of one person's reminders go now, from those still owed today (on, not paused, today one of
 *  their days, not yet sent or skipped today), at `now`, minutes after midnight on their clock. None
 *  unless one is due (its time passed less than `REMINDER_DUE_MINUTES` ago); with it, any due within the
 *  next `REMINDER_BUNDLE_MINUTES`. Workout first, then the meals in the day's order. Garbage sends none. */
export function remindersToSend(owed: readonly { kind: ReminderKind; minute: number }[], now: number): ReminderKind[] {
  if (!Number.isInteger(now) || now < 0 || now > 1439) return [];
  const ok = owed.filter((row) => Number.isInteger(row.minute) && row.minute >= 0 && row.minute <= 1439);
  const due = ok.some((row) => now - row.minute >= 0 && now - row.minute < REMINDER_DUE_MINUTES);
  if (!due) return [];
  const going = ok.filter((row) => (now - row.minute >= 0 && now - row.minute < REMINDER_DUE_MINUTES) || (row.minute > now && row.minute - now <= REMINDER_BUNDLE_MINUTES));
  return REMINDER_KINDS.filter((kind) => going.some((row) => row.kind === kind));
}

const MEAL_NAME: Record<MealReminderKind, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };

function andList(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1) ?? ""}`;
}

/** What the phone shows for the reminders going together. None is no notification. */
export function reminderNotification(kinds: readonly ReminderKind[]): { title: string; body: string } | null {
  const meals = REMINDER_KINDS.filter((kind): kind is MealReminderKind => kind !== "workout" && kinds.includes(kind));
  const lower = meals.map((meal) => MEAL_NAME[meal].toLowerCase());
  if (kinds.includes("workout")) {
    return { title: "Time to train", body: meals.length === 0 ? "Your workout for today is waiting." : `And log your ${andList(lower)}.` };
  }
  const [only] = meals;
  if (only === undefined) return null;
  if (meals.length === 1) return { title: MEAL_NAME[only], body: "Log what you ate." };
  return { title: "Log your meals", body: `${andList(meals.map((meal) => MEAL_NAME[meal]))}.` };
}

/** The Android channel the reminders arrive on; its name is what the phone's settings show. */
export const TRAINING_REMINDERS_CHANNEL = { id: "training-reminders", name: "Reminders" } as const;

/** What a reminder carries for the app: the tab a tap opens. */
export const trainingReminderPushDataSchema = z.object({ kind: z.literal("training_reminder"), open: z.enum(["workout", "food"]) }).strip();
export type TrainingReminderPushData = z.infer<typeof trainingReminderPushDataSchema>;
