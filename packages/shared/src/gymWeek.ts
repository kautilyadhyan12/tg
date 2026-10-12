// Overview's "Last 7 days" box (spec Part 3 §16.4; ROADMAP 20d-ii): new members, members
// who left, who is at risk, visits against the week before, and payments due. Counts
// only; no person's name leaves the server here.
//
// It stands where the owner's weekly summary email was planned (Kd, RULINGS 2026-10-12).
import { z } from "zod";
import { addDays } from "./heldMemberships.js";

/** The days the box counts: the seven whole days that ended yesterday. */
export const GYM_WEEK_DAYS = 7;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const daySchema = z.string().regex(DAY);
const countSchema = z.number().int().min(0);

export interface GymWeekWindow {
  /** The first and last of the seven days counted, on the gym's own calendar. */
  from: string;
  to: string;
  /** The seven days before them. */
  beforeFrom: string;
  beforeTo: string;
}

/** The days counted and the days they are compared with, from the gym's own day today.
 *  Today is left out of both: a day half gone would always read as a quiet one. */
export function gymWeekWindow(today: string): GymWeekWindow {
  return {
    from: addDays(today, -GYM_WEEK_DAYS),
    to: addDays(today, -1),
    beforeFrom: addDays(today, -2 * GYM_WEEK_DAYS),
    beforeTo: addDays(today, -GYM_WEEK_DAYS - 1),
  };
}

/** Whether the visits of the seven days before can be set beside this week's: only when
 *  the gym was already checking people in when those days began. */
export function gymWeekCanCompare(firstVisitOn: string | null, window: GymWeekWindow): boolean {
  return firstVisitOn !== null && DAY.test(firstVisitOn) && firstVisitOn <= window.beforeFrom;
}

/** Each part is null where the asker may not see it or the gym does not use it: a part
 *  left out is never a nought. */
export const gymWeekSchema = z
  .object({
    from: daySchema,
    to: daySchema,
    /** As Reports counts them. `joined` is null while the list itself began in these days:
     *  its first people are not new members. */
    members: z.object({ joined: countSchema.nullable(), left: countSchema }).strict().nullable(),
    /** The At risk page's own count, today. */
    atRisk: z.object({ count: countSchema }).strict().nullable(),
    /** Rows of the Attendance page. `weekBefore` is null where check-in began too lately
     *  for a fair comparison. */
    visits: z.object({ thisWeek: countSchema, weekBefore: countSchema.nullable() }).strict().nullable(),
    /** The people the Members list reads as "Payment due", today. */
    paymentDue: z.object({ count: countSchema }).strict().nullable(),
  })
  .strict();
export type GymWeek = z.infer<typeof gymWeekSchema>;

export const gymWeekResponseSchema = z.object({ week: gymWeekSchema }).strict();
export type GymWeekResponse = z.infer<typeof gymWeekResponseSchema>;
