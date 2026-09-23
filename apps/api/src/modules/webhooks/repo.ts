// `webhook_events`: every provider event kept once by its own id (Part 4 §3.3), so a
// webhook answers at once and the worker acts on each event, however often it arrives.
import { resendEmailEventTypeSchema } from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import { z } from "zod";

type SqlOrTx = Sql | TransactionSql;

/** What is kept of a Resend event: never the address or the subject. */
export const storedResendEventSchema = z
  .object({
    type: resendEmailEventTypeSchema,
    emailId: z.string().min(1).max(100),
    bounceType: z.string().max(40).nullable(),
  })
  .strict();
export type StoredResendEvent = z.infer<typeof storedResendEventSchema>;

/** Keep an event. The same event id again is ignored (the unique key). */
export async function keepEvent(
  sql: SqlOrTx,
  event: { provider: "resend"; eventId: string; payload: StoredResendEvent },
): Promise<void> {
  await sql`
    INSERT INTO webhook_events (provider, event_id, payload)
    VALUES (${event.provider}, ${event.eventId}, ${sql.json(event.payload)})
    ON CONFLICT (provider, event_id) DO NOTHING`;
}

export interface ClaimedEvent {
  id: string;
  /** The claim's own number: every write that finishes it names it. */
  attempts: number;
  /** Null when the kept payload no longer parses. */
  payload: StoredResendEvent | null;
}

/** Take the next Resend event that is due and hold it for `leaseMs`: a second worker
 *  skips it until then, and a worker that dies leaves it to be taken again. */
export async function claimDueEvent(sql: Sql, now: Date, leaseMs: number): Promise<ClaimedEvent | null> {
  const rows = await sql<{ id: string; attempts: number; payload: unknown }[]>`
    WITH next AS (
      SELECT id FROM webhook_events
      WHERE provider = 'resend' AND status = 'pending' AND not_before <= ${now}
      ORDER BY not_before, received_at, id
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE webhook_events e
    SET attempts = e.attempts + 1, not_before = ${new Date(now.getTime() + leaseMs)}
    FROM next WHERE e.id = next.id
    RETURNING e.id, e.attempts, e.payload`;
  const row = rows[0];
  if (row === undefined) return null;
  const payload = storedResendEventSchema.safeParse(row.payload);
  return { id: row.id, attempts: row.attempts, payload: payload.success ? payload.data : null };
}

/** Finish an event, done or given up. False when the claim was no longer this run's. */
export async function finishEvent(sql: SqlOrTx, event: ClaimedEvent, status: "done" | "failed", at: Date): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE webhook_events SET status = ${status}, processed_at = ${at}
    WHERE id = ${event.id} AND status = 'pending' AND attempts = ${event.attempts}
    RETURNING id`;
  return rows.length === 1;
}

/** Try an event again at `notBefore`. */
export async function deferEvent(sql: SqlOrTx, event: ClaimedEvent, notBefore: Date): Promise<void> {
  await sql`
    UPDATE webhook_events SET not_before = ${notBefore}
    WHERE id = ${event.id} AND status = 'pending' AND attempts = ${event.attempts}`;
}

/** Forget finished events after 90 days (Part 4 §5.1). */
export async function forgetOldEvents(sql: SqlOrTx, before: Date, limit: number): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    DELETE FROM webhook_events
    WHERE id IN (
      SELECT id FROM webhook_events
      WHERE status <> 'pending' AND processed_at < ${before}
      LIMIT ${limit})
    RETURNING id`;
  return rows.length;
}
