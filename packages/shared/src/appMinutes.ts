// The minutes the app is open on screen each day (ROADMAP Stage 2 item 14a-ii; Kd, 2026-11-08: "the
// total time they are active in the app"). The phone counts them on the person's own days and sends
// them (Stage 5 item 21f), keeping each day until the server has it. A day's number is its total so
// far, never an addition, so sending a day twice changes nothing.
import { z } from "zod";
import { calendarDaySchema } from "./plan.js";

/** An IANA time zone this platform knows (`Intl` throws on any other). The server also keeps only
 *  zones its database knows. */
export const timeZoneNameSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((zone) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: zone });
      return true;
    } catch {
      return false;
    }
  }, { message: "unknown time zone" });

export const APP_MINUTES_DAYS_MAX = 60;
/** How far back a day is still kept; older ones are answered as ignored, and the phone drops them. */
export const APP_MINUTES_KEEP_DAYS = 40;

export const appMinutesDaySchema = z
  .object({
    day: calendarDaySchema,
    minutes: z.number().int().min(0).max(1440),
    /** The phone's time zone on that day. */
    zone: timeZoneNameSchema,
  })
  .strict();
export type AppMinutesDay = z.infer<typeof appMinutesDaySchema>;

export const appMinutesRequestSchema = z
  .object({
    days: z
      .array(appMinutesDaySchema)
      .min(1)
      .max(APP_MINUTES_DAYS_MAX)
      .refine((days) => new Set(days.map((d) => d.day)).size === days.length, { message: "each day once" }),
  })
  .strict();
export type AppMinutesRequest = z.infer<typeof appMinutesRequestSchema>;

/** One day as the phone keeps it in the person's own file until the server has it (Stage 5 21f):
 *  seconds, so a part minute is not lost between two stretches. */
export const keptMinutesDaySchema = z
  .object({
    day: calendarDaySchema,
    zone: timeZoneNameSchema,
    seconds: z.number().finite().min(0).max(86_400),
  })
  .strict();
export type KeptMinutesDay = z.infer<typeof keptMinutesDaySchema>;

/** Every day sent is settled: kept (or already as high), or ignored (too old, in the future, or a
 *  time zone the server does not know). The phone drops all of them, and keeps counting today. */
export const appMinutesResponseSchema = z
  .object({ kept: z.number().int().nonnegative(), ignored: z.number().int().nonnegative() })
  .strict();
export type AppMinutesResponse = z.infer<typeof appMinutesResponseSchema>;
