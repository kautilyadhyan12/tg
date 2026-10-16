// The console's Staff activity (ROADMAP Stage 2 item 4d; Kd, RULINGS 2026-09-25): which
// worker did what and when, for the gym's owner, read from the notes the server already
// keeps. The server writes each line; the screen groups them by day.
import { z } from "zod";
import { addDays } from "./heldMemberships.js";

/** Lines in one page; Show more asks for the next. */
export const STAFF_ACTIVITY_PAGE = 50;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const daySchema = z.string().regex(DAY).refine((day) => addDays(day, 0) === day);

/** The next page starts after this line: the moment to the microsecond and the note's own
 *  number, as the server wrote it. A moment that is no moment, or a number past the
 *  database's, is refused here rather than by the database. */
const cursorSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z_\d{1,18}$/)
  .refine((cursor) => {
    const at = cursor.slice(0, 19);
    const ms = Date.parse(`${at}Z`);
    // Year 0000 is a date to JavaScript and not to Postgres.
    return Number.isFinite(ms) && at.slice(0, 4) !== "0000" && new Date(ms).toISOString().slice(0, 19) === at;
  });

export const staffActivityQuerySchema = z
  .object({
    /** One worker, or everybody. */
    worker: z.string().uuid().optional(),
    /** The first and last day shown, on the gym's own calendar; both or neither. */
    from: daySchema.optional(),
    to: daySchema.optional(),
    after: cursorSchema.optional(),
  })
  .strict()
  .refine((q) => (q.from === undefined) === (q.to === undefined), { message: "from and to come together" })
  .refine((q) => q.from === undefined || q.to === undefined || q.from <= q.to, { message: "from is after to" });
export type StaffActivityQuery = z.infer<typeof staffActivityQuerySchema>;

export const staffActivityLineSchema = z.object({
  id: z.string(),
  /** The gym's own day and minute of the day it happened. */
  day: z.string().regex(DAY),
  minute: z.number().int().min(0).max(1439),
  workerId: z.string().uuid(),
  worker: z.string(),
  /** What they did, as one sentence: "Removed Priya Shah from the app." */
  line: z.string(),
});
export type StaffActivityLine = z.infer<typeof staffActivityLineSchema>;

export const staffActivityWorkerSchema = z.object({
  userId: z.string().uuid(),
  name: z.string(),
  /** Still on the gym's staff; a former worker's lines stay. */
  current: z.boolean(),
});

export const staffActivityResponseSchema = z.object({
  lines: z.array(staffActivityLineSchema),
  /** Pass as `after` for the next page; null when there is none. */
  next: z.string().nullable(),
  /** Everybody the worker filter offers: the staff today, then former staff. */
  workers: z.array(staffActivityWorkerSchema),
  /** The gym's own today, for "Today" and "Yesterday". */
  today: z.string().regex(DAY),
});
export type StaffActivityResponse = z.infer<typeof staffActivityResponseSchema>;
