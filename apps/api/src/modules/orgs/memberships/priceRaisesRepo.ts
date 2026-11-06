// The price raises of memberships already on a line (18w). The rule is `priceRaiseNext` in `@app/shared`; this file
// reads and writes `gym_price_raises`. The emails go through the renewal reminders' queue (`renewalRemindersRepo.ts`),
// one a raise, under the occasion `price:<raise id>`.
import { RENEWAL_REMINDER_FROM_HOUR } from "@app/shared";
import type { Sql, TransactionSql } from "postgres";

type SqlOrTx = Sql | TransactionSql;

/** The queue's occasion for a raise's email. */
export const priceOccasion = (raiseId: string): string => `price:${raiseId}`;

/** The raise an occasion names, or null for a renewal reminder's. */
export function raiseOfOccasion(occasion: string): string | null {
  return occasion.startsWith("price:") ? occasion.slice("price:".length) : null;
}

/** The money of one of the gym's lines, live or archived; null where it is not the gym's. */
export async function typeCurrency(sql: SqlOrTx, gymId: string, typeId: string): Promise<string | null> {
  const [row] = await sql<{ currency: string }[]>`SELECT currency FROM gym_membership_types WHERE gym_id = ${gymId} AND id = ${typeId}`;
  return row?.currency ?? null;
}

/** The highest period of each membership with a bill of its own (a fee's is not), or none. */
export async function billedTo(sql: SqlOrTx, gymId: string, heldIds: readonly string[]): Promise<Map<string, number>> {
  if (heldIds.length === 0) return new Map();
  const rows = await sql<{ held_membership_id: string; top: number }[]>`
    SELECT held_membership_id, max(period_index)::int AS top FROM gym_member_bills
    WHERE gym_id = ${gymId} AND held_membership_id = ANY(${[...heldIds]}::uuid[]) AND fee IS NULL
    GROUP BY held_membership_id`;
  return new Map(rows.map((r) => [r.held_membership_id, r.top]));
}

/** The memberships of a line in use, locked while their raises are written: a payment, a cancel or the check before
 *  an email waits. Only the line's own, of the gym's own. */
export async function lockLineHeld(tx: TransactionSql, gymId: string, typeId: string, heldIds: readonly string[]): Promise<string[]> {
  if (heldIds.length === 0) return [];
  const rows = await tx<{ id: string }[]>`
    SELECT id FROM gym_held_memberships
    WHERE gym_id = ${gymId} AND membership_type_id = ${typeId} AND id = ANY(${[...heldIds]}::uuid[]) AND status IN ('active','frozen')
    ORDER BY id
    FOR UPDATE`;
  return rows.map((r) => r.id);
}

/** One membership locked, of the gym's own record; false where it is not. */
export async function lockHeldOf(tx: TransactionSql, gymId: string, entryId: string, heldId: string): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    SELECT id FROM gym_held_memberships WHERE gym_id = ${gymId} AND entry_id = ${entryId} AND id = ${heldId} FOR UPDATE`;
  return rows.length === 1;
}

export interface NewRaise {
  heldId: string;
  priceMinor: number;
  /** A raise already charged from its first payment: it becomes the membership's own price first. */
  fold: { priceMinor: number } | null;
}

/** Write these raises, each in place of any raise the membership had. Answers how many were written. */
export async function writeRaises(tx: TransactionSql, gymId: string, raises: readonly NewRaise[], noticeDays: number, raisedBy: string, now: Date): Promise<number> {
  if (raises.length === 0) return 0;
  const folds = raises.flatMap((r) => (r.fold === null ? [] : [{ heldId: r.heldId, priceMinor: r.fold.priceMinor }]));
  if (folds.length > 0) {
    await tx`
      UPDATE gym_held_memberships h SET price_minor = f.price_minor, updated_at = ${now}
      FROM unnest(${folds.map((f) => f.heldId)}::uuid[], ${folds.map((f) => f.priceMinor)}::int[]) AS f(held_id, price_minor)
      WHERE h.gym_id = ${gymId} AND h.id = f.held_id`;
  }
  const ids = raises.map((r) => r.heldId);
  await tx`DELETE FROM gym_price_raises WHERE gym_id = ${gymId} AND held_membership_id = ANY(${ids}::uuid[])`;
  const written = await tx<{ id: string }[]>`
    INSERT INTO gym_price_raises (gym_id, held_membership_id, price_minor, notice_days, raised_by, created_at)
    SELECT ${gymId}, r.held_id, r.price_minor, ${noticeDays}, ${raisedBy}, ${now}
    FROM unnest(${ids}::uuid[], ${raises.map((r) => r.priceMinor)}::int[]) AS r(held_id, price_minor)
    RETURNING id`;
  // The gym's raises are looked at again at once.
  await tx`UPDATE gyms SET price_raises_checked_at = NULL WHERE id = ${gymId}`;
  return written.length;
}

/** Its email has gone: from now on it is charged from the period the email named. False where it is not this raise
 *  still waiting. */
export async function markRaiseSent(tx: TransactionSql, q: { gymId: string; raiseId: string; fromPeriod: number; fromOn: string; sentOn: string }): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    UPDATE gym_price_raises SET from_period = ${q.fromPeriod}, from_on = ${q.fromOn}, sent_on = ${q.sentOn}
    WHERE gym_id = ${q.gymId} AND id = ${q.raiseId} AND from_period IS NULL
    RETURNING id`;
  return rows.length === 1;
}

/** Keep the old price: the raise is taken off. False where there was none. */
export async function deleteRaise(tx: TransactionSql, gymId: string, heldId: string, raiseId: string): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    DELETE FROM gym_price_raises WHERE gym_id = ${gymId} AND held_membership_id = ${heldId} AND id = ${raiseId} RETURNING id`;
  return rows.length === 1;
}

/** The gyms whose raises still to email are to be looked at now: open, past 8 in the morning on their own clock,
 *  not looked at in the last hour, with a raise not yet emailed. */
export async function gymsWithRaises(sql: SqlOrTx, q: { now: Date; gymIds: readonly string[] | null }): Promise<{ gymId: string; today: string }[]> {
  const rows = await sql<{ id: string; today: string }[]>`
    SELECT g.id, ((${q.now}::timestamptz AT TIME ZONE g.timezone)::date)::text AS today
    FROM gyms g
    WHERE g.status = 'active'
      AND extract(hour FROM ${q.now}::timestamptz AT TIME ZONE g.timezone) >= ${RENEWAL_REMINDER_FROM_HOUR}
      AND (g.price_raises_checked_at IS NULL OR g.price_raises_checked_at <= ${q.now}::timestamptz - interval '1 hour')
      AND EXISTS (SELECT 1 FROM gym_price_raises r WHERE r.gym_id = g.id AND r.from_period IS NULL)
      AND (${q.gymIds === null}::boolean OR g.id = ANY(${[...(q.gymIds ?? [])]}::uuid[]))
    ORDER BY g.id`;
  return rows.map((r) => ({ gymId: r.id, today: r.today }));
}

export async function markRaisesChecked(sql: SqlOrTx, gymId: string, at: Date): Promise<void> {
  await sql`UPDATE gyms SET price_raises_checked_at = ${at} WHERE id = ${gymId}`;
}

/** The memberships with a raise not yet emailed. */
export async function waitingRaises(sql: SqlOrTx, gymId: string): Promise<string[]> {
  const rows = await sql<{ held_membership_id: string }[]>`
    SELECT held_membership_id FROM gym_price_raises WHERE gym_id = ${gymId} AND from_period IS NULL`;
  return rows.map((r) => r.held_membership_id);
}
