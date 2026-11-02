// PAUSE AUTOMATIC PAYMENTS (ROADMAP 18d-iv-f): the rows of `gym_autopay_pauses` and the rule the app's own charge reads. A pause is of
// whoever pays: it stops the app charging that record's card by itself for every membership it pays for, as Remove card would, and
// keeps the card.
import type { Sql, TransactionSql } from "postgres";
import { lockGym } from "../memberList/repo.js";
import { insertAudit } from "../repo.js";
import { chargebackStops } from "./chargebacksRepo.js";

type SqlOrTx = Sql | TransactionSql;

/** Whoever pays for membership `h`: the payer of its record, or the record itself. */
const payerOfH = (sql: SqlOrTx) => sql`COALESCE((SELECT x.payer_entry_id FROM gym_member_payers x WHERE x.gym_id = h.gym_id AND x.entry_id = h.entry_id), h.entry_id)`;

/** Staff paused automatic payments of whoever pays for membership `h`, for an EXISTS. */
export const autopayPaused = (sql: SqlOrTx) => sql`SELECT 1 FROM gym_autopay_pauses ap WHERE ap.gym_id = h.gym_id AND ap.entry_id = ${payerOfH(sql)} AND ap.resumed_at IS NULL`;

/** A pause of whoever pays that staff resumed. */
export const autopayPauseEnded = (sql: SqlOrTx) => sql`SELECT 1 FROM gym_autopay_pauses ap WHERE ap.gym_id = h.gym_id AND ap.entry_id = ${payerOfH(sql)} AND ap.resumed_at IS NOT NULL`;

/** The same, and it stood through all of the days the app could have charged bill `b` (its due day and the two after), on the gym's calendar `d`. */
export const autopayPauseStoodThrough = (sql: SqlOrTx) => sql`${autopayPauseEnded(sql)}
        AND (ap.paused_at AT TIME ZONE d.timezone)::date <= b.due_on + 2 AND (ap.resumed_at AT TIME ZONE d.timezone)::date > b.due_on + 2`;

/** Whoever pays for membership `h`, where that is somebody else and they paused: their record and name. */
export const autopayHolder = (sql: SqlOrTx) => sql`
      SELECT jsonb_build_object('entryId', e.id, 'name', e.full_name) FROM gym_member_list_entries e
      WHERE e.gym_id = h.gym_id AND e.id = ${payerOfH(sql)} AND e.id IS DISTINCT FROM h.entry_id AND EXISTS (${autopayPaused(sql)})`;

/** Which of these memberships the app does not charge by itself because staff paused their payer. */
export async function autopayPausedOf(sql: SqlOrTx, gymId: string, membershipIds: readonly string[]): Promise<Set<string>> {
  if (membershipIds.length === 0) return new Set();
  const rows = await sql<{ id: string }[]>`
    SELECT h.id FROM gym_held_memberships h
    WHERE h.gym_id = ${gymId} AND h.id = ANY(${[...membershipIds]}::uuid[]) AND EXISTS (${autopayPaused(sql)})`;
  return new Set(rows.map((r) => r.id));
}

/** The day this record's own pause began, on the gym's calendar; null where it has none open. */
export async function pausedOn(sql: SqlOrTx, gymId: string, entryId: string): Promise<string | null> {
  const [row] = await sql<{ on: string }[]>`
    SELECT (ap.paused_at AT TIME ZONE g.timezone)::date::text AS on
    FROM gym_autopay_pauses ap JOIN gyms g ON g.id = ap.gym_id
    WHERE ap.gym_id = ${gymId} AND ap.entry_id = ${entryId} AND ap.resumed_at IS NULL`;
  return row?.on ?? null;
}

/** Each renewing membership whoever pays `payerId` pays for, current members only, the first `limit` by name, and how many in all. */
export async function renewingPaidBy(sql: SqlOrTx, gymId: string, payerId: string, limit: number): Promise<{ people: { name: string; what: string }[]; total: number }> {
  const rows = await sql<{ name: string; what: string | null; total: number }[]>`
    SELECT e.full_name AS name, t.name AS what, count(*) OVER ()::int AS total
    FROM gym_held_memberships h
    JOIN gym_member_list_entries e ON e.gym_id = h.gym_id AND e.id = h.entry_id AND e.former_at IS NULL
    LEFT JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
    WHERE h.gym_id = ${gymId} AND h.kind = 'recurring' AND h.renews AND h.status IN ('active','frozen')
      AND ${payerOfH(sql)} = ${payerId}
    ORDER BY e.full_name, h.id LIMIT ${limit}`;
  return { people: rows.map((r) => ({ name: r.name, what: r.what ?? "" })), total: rows[0]?.total ?? 0 };
}

/** A chargeback still stops automatic payments of whoever pays `payerId`, on any membership they pay for. */
export async function chargebackStopsPayer(sql: SqlOrTx, gymId: string, payerId: string): Promise<boolean> {
  const [row] = await sql<{ id: string }[]>`
    SELECT h.id FROM gym_held_memberships h
    WHERE h.gym_id = ${gymId} AND ${payerOfH(sql)} = ${payerId} AND EXISTS (${chargebackStops(sql)})
    LIMIT 1`;
  return row !== undefined;
}

export type AutopayOutcome = "done" | "already";

/** Pause: one open pause a record, so the same press twice is one. Under the gym's lock, as a payer link is written. */
export async function pause(sql: Sql, gymId: string, entryId: string, userId: string, now: Date): Promise<AutopayOutcome> {
  return await sql.begin(async (tx): Promise<AutopayOutcome> => {
    await lockGym(tx, gymId);
    const made = await tx<{ id: string }[]>`
      INSERT INTO gym_autopay_pauses (gym_id, entry_id, paused_at, paused_by)
      SELECT ${gymId}, ${entryId}, ${now}, ${userId}
      WHERE NOT EXISTS (SELECT 1 FROM gym_autopay_pauses WHERE gym_id = ${gymId} AND entry_id = ${entryId} AND resumed_at IS NULL)
      RETURNING id`;
    if (made.length === 0) return "already";
    await insertAudit(tx, { actorUserId: userId, gymId, action: "org.autopay_paused", targetType: "gym_member_list_entry", targetId: entryId, meta: { entryId } });
    return "done";
  });
}

/** Resume: closes the open pause, once. */
export async function resume(sql: Sql, gymId: string, entryId: string, userId: string, now: Date): Promise<AutopayOutcome> {
  return await sql.begin(async (tx): Promise<AutopayOutcome> => {
    await lockGym(tx, gymId);
    const closed = await tx<{ id: string }[]>`
      UPDATE gym_autopay_pauses SET resumed_at = GREATEST(${now}::timestamptz, paused_at), resumed_by = ${userId}
      WHERE gym_id = ${gymId} AND entry_id = ${entryId} AND resumed_at IS NULL
      RETURNING id`;
    if (closed.length === 0) return "already";
    await insertAudit(tx, { actorUserId: userId, gymId, action: "org.autopay_resumed", targetType: "gym_member_list_entry", targetId: entryId, meta: { entryId } });
    return "done";
  });
}

/** Two records of one person joined (`mergeEntries`): the pauses of the one not kept move onto the kept one, so a pause on either still
 *  stands; where both had one open, the kept one's stays and the other is closed. Under the gym's lock. */
export async function movePauses(tx: TransactionSql, gymId: string, goneId: string, keepId: string, at: Date): Promise<void> {
  await tx`
    UPDATE gym_autopay_pauses SET resumed_at = GREATEST(${at}::timestamptz, paused_at)
    WHERE gym_id = ${gymId} AND entry_id = ${goneId} AND resumed_at IS NULL
      AND EXISTS (SELECT 1 FROM gym_autopay_pauses k WHERE k.gym_id = ${gymId} AND k.entry_id = ${keepId} AND k.resumed_at IS NULL)`;
  await tx`UPDATE gym_autopay_pauses SET entry_id = ${keepId} WHERE gym_id = ${gymId} AND entry_id = ${goneId}`;
}
