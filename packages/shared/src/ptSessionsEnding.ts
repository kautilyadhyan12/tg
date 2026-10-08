// PERSONAL TRAINING SESSIONS THAT END WHEN A PERSON LEAVES (Part 3 §13.5; ROADMAP 17e-iv-a).
// A person taken off the gym's list, or a membership staff cancel, ends the coming sessions
// booked for them; a pack has each session back. Whatever would do it names them first.
// In a file of its own: the Remove box, the membership's cancel and personal training all
// read it.
import { z } from "zod";

/** How many sessions a box names; `count` is whole. */
export const PT_SESSIONS_ENDING_SHOWN = 100;

const markSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const ptSessionEndingSchema = z
  .object({
    id: z.string().uuid(),
    /** The person on the gym's list the session is for. */
    personName: z.string(),
    /** Null where the trainer's account has gone. */
    trainerName: z.string().nullable(),
    localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    localStartMinute: z.number().int().min(0).max(1439),
    minutes: z.number().int(),
    /** A pack was charged for it, and has the session back. */
    packSession: z.boolean(),
  })
  .strict();
export type PtSessionEnding = z.infer<typeof ptSessionEndingSchema>;

/** The sessions a change would end. Nothing is written until the request sends `mark` back
 *  (one value for exactly these sessions, all of them), worked out again under the gym's
 *  lock: a session booked or cancelled while the box is open shows the box again. */
export const ptSessionsEndingSchema = z
  .object({
    count: z.number().int().min(1),
    /** Of them, how many go back to a pack. */
    packSessions: z.number().int().min(0),
    mark: markSchema,
    /** The earliest first. */
    sessions: z.array(ptSessionEndingSchema).max(PT_SESSIONS_ENDING_SHOWN),
  })
  .strict();
export type PtSessionsEnding = z.infer<typeof ptSessionsEndingSchema>;

/** The `mark` the screen was shown, on a request that removes one person. */
export const confirmPtSessionsField = markSchema;

/** A DELETE carries it in its query: a body on a DELETE is dropped by some browsers. */
export const confirmPtSessionsQuerySchema = z.object({ confirmPtSessions: confirmPtSessionsField.optional() }).strict();

/** The 409 that removing one person answers while their sessions are not confirmed. */
export const PT_SESSIONS_ENDING_ERROR = "pt_sessions_ending";
export const PT_SESSIONS_ENDING_MESSAGE = "This person has personal training sessions booked. Check them, then confirm.";

export const ptSessionsEndingRefusalSchema = z.object({
  error: z.literal(PT_SESSIONS_ENDING_ERROR),
  message: z.string(),
  sessions: ptSessionsEndingSchema,
  requestId: z.string().optional(),
});

/** "2 personal training sessions will be cancelled" and what happens to packs, for every
 *  box that names them. */
export function ptSessionsEndingWords(ending: Pick<PtSessionsEnding, "count" | "packSessions">): { title: string; packs: string | null } {
  const n = ending.count;
  const p = ending.packSessions;
  return {
    title: n === 1 ? "1 personal training session will be cancelled" : `${String(n)} personal training sessions will be cancelled`,
    packs: p === 0 ? null : p === 1 ? "1 session goes back to its pack." : `${String(p)} sessions go back to their packs.`,
  };
}
