// Live updates (ROADMAP Stage 4 item 18; Kd, 2026-10-24). Each console tab on screen keeps one
// open line to the server, which tells it what to read again; the page then reads that through
// its normal checked route. A message names a kind of thing and the record's id, never what is
// in it: a person's name, money or agreement never travels on the line.
import { z } from "zod";

/** Something changed that a page may be showing. */
export const liveNewsSchema = z.discriminatedUnion("what", [
  /** A person's memberships on the gym's list: given, changed, paid, or an agreement signed. */
  z.object({ what: z.literal("memberships"), entryId: z.string().uuid() }).strict(),
]);
export type LiveNews = z.infer<typeof liveNewsSchema>;

/** What the line itself sends: `ready` once it is open (a page reads again whatever it may
 *  have missed while it had no line), then each piece of news. */
export const liveMessageSchema = z.union([z.object({ what: z.literal("ready") }).strict(), liveNewsSchema]);
export type LiveMessage = z.infer<typeof liveMessageSchema>;

/** News on its way between servers: which gym's open lines it is for. */
export const liveNewsForGymSchema = z.object({ gymId: z.string().uuid(), news: liveNewsSchema }).strict();
export type LiveNewsForGym = z.infer<typeof liveNewsForGymSchema>;

/** Refusals of the line, in the console's words. */
export const LIVE_WORDS = {
  too_many_lines: "This account has too many console windows open. Close one and try again.",
  lines_full: "Live updates are busy right now. The page will try again shortly.",
  rate_limited: "Live updates are paused on this account for a while. The page still updates when you come back to it.",
} as const;
