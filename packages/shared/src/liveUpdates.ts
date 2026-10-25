// Live updates (ROADMAP Stage 4 item 18; Kd, 2026-10-24). Each console tab on screen keeps one
// open line to the server, which tells it what to read again; the page then reads that through
// its normal checked route. A message names a kind of thing and the record's id, never what is
// in it: a person's name, money or agreement never travels on the line.
import { z } from "zod";

/** Something changed that a page may be showing. */
export const liveNewsSchema = z.discriminatedUnion("what", [
  /** A person's memberships on the gym's list: given, changed, paid, or an agreement signed. */
  z.object({ what: z.literal("memberships"), entryId: z.string().uuid() }).strict(),
  /** A visit at the gym: added (the desk, staff, an earlier day) or removed. Removed means the
   *  check-in log reads the whole of today again; added, only what is newer than it holds. */
  z.object({ what: z.literal("visits"), change: z.enum(["added", "removed"]) }).strict(),
  /** Something a leaderboard counts or shows, other than a visit. switched: staff switched a board
   *  or took a person off, read at once; counted: a member's workout saved or Hide me, gathered
   *  with the visits into one read a minute. */
  z.object({ what: z.literal("leaderboard"), change: z.enum(["switched", "counted"]) }).strict(),
  /** Somebody on the gym's list or among its members changed: added, renamed, merged, removed from
   *  the list or the app, joined, left, their age, or their account deleted. Pages that show people's
   *  names and words (the check-in log, Who came, the Leaderboard) read again. */
  z.object({ what: z.literal("people") }).strict(),
  /** A payment from Square Point of Sale was matched, marked or put back on Payments to match, or taken
   *  off a bill with Not this bill (18d-iii-b-ii-a): that list, and Overview's line, read again. */
  z.object({ what: z.literal("paymentsToMatch") }).strict(),
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
  /** The line could not be opened for any other reason: the server or the network is down. */
  unreachable: "Live updates can't connect right now. The page keeps checking for changes until they're back.",
} as const;
