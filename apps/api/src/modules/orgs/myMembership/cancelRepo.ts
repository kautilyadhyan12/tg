// CANCEL IN THE APP: ITS READS AND WRITES (ROADMAP 18l; spec Part 3 §14.8). Every read names the gym in its WHERE.
// The membership itself is changed by the front desk's own step (`moveHeldIn`); this file keeps what the gym is told
// (`gym_app_cancels`) and reads what the box says about money.
import type { Sql, TransactionSql } from "postgres";
import { APP_CANCELS_DAYS, APP_CANCELS_SHOWN, myCancelReasonSchema, myCancelWhenSchema, type AppCancel, type AppCancelRow, type MyCancelReason, type MyCancelWhen } from "@app/shared";

type SqlOrTx = Sql | TransactionSql;

export interface CancelRow {
  id: string;
  heldMembershipId: string;
  userId: string | null;
  when: MyCancelWhen;
  endsOn: string;
  cancelledOn: string;
  reason: MyCancelReason | null;
  emailed: boolean;
}

interface RawCancel {
  id: string;
  held_membership_id: string;
  user_id: string | null;
  when: string;
  ends_on: string;
  cancelled_on: string;
  reason: string | null;
  emailed: boolean;
}

// Text columns under a CHECK: parsed, so a value this build does not know fails here.
const shape = (r: RawCancel): CancelRow => ({
  id: r.id,
  heldMembershipId: r.held_membership_id,
  userId: r.user_id,
  when: myCancelWhenSchema.parse(r.when),
  endsOn: r.ends_on,
  cancelledOn: r.cancelled_on,
  reason: r.reason === null ? null : myCancelReasonSchema.parse(r.reason),
  emailed: r.emailed,
});

const COLUMNS = (sql: SqlOrTx) => sql`
  c.id, c.held_membership_id, c.user_id, c."when", c.ends_on::text AS ends_on, c.cancelled_on::text AS cancelled_on, c.reason,
  (c.emailed_at IS NOT NULL) AS emailed`;

/** The cancel this press already made, if it made one. */
export async function cancelOfRequest(sql: SqlOrTx, gymId: string, requestKey: string): Promise<CancelRow | null> {
  const [row] = await sql<RawCancel[]>`SELECT ${COLUMNS(sql)} FROM gym_app_cancels c WHERE c.gym_id = ${gymId} AND c.request_key = ${requestKey}`;
  return row === undefined ? null : shape(row);
}

/** These memberships' cancels in the app, by membership. */
export async function cancelsOf(sql: SqlOrTx, gymId: string, membershipIds: readonly string[]): Promise<Map<string, CancelRow & { byName: string | null }>> {
  if (membershipIds.length === 0) return new Map();
  const rows = await sql<(RawCancel & { by_name: string | null })[]>`
    SELECT ${COLUMNS(sql)}, e.full_name AS by_name
    FROM gym_app_cancels c
    LEFT JOIN gym_member_list_entries e ON e.gym_id = c.gym_id AND e.id = c.by_entry_id
    WHERE c.gym_id = ${gymId} AND c.held_membership_id = ANY(${[...membershipIds]}::uuid[])`;
  return new Map(rows.map((r) => [r.held_membership_id, { ...shape(r), byName: r.by_name }]));
}

/** For the person's page: each membership's cancel in the app, as staff read it. */
export async function appCancelsOf(sql: SqlOrTx, gymId: string, membershipIds: readonly string[]): Promise<Map<string, AppCancel>> {
  const found = await cancelsOf(sql, gymId, membershipIds);
  return new Map([...found].map(([id, c]) => [id, { on: c.cancelledOn, byName: c.byName, reason: c.reason }]));
}

export interface NewCancel {
  gymId: string;
  membershipId: string;
  byEntryId: string;
  userId: string;
  requestKey: string;
  when: MyCancelWhen;
  endsOn: string;
  cancelledOn: string;
  now: Date;
}

/** The row the gym is told by, written in the cancel's own transaction. */
export async function insertCancel(tx: TransactionSql, c: NewCancel): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    INSERT INTO gym_app_cancels (gym_id, held_membership_id, by_entry_id, user_id, request_key, "when", ends_on, cancelled_on, created_at)
    VALUES (${c.gymId}, ${c.membershipId}, ${c.byEntryId}, ${c.userId}, ${c.requestKey}, ${c.when}, ${c.endsOn}::date, ${c.cancelledOn}::date, ${c.now})
    RETURNING id`;
  if (row === undefined) throw new Error("gym_app_cancels insert returned no row");
  return row.id;
}

/** The reason, once, by whoever pressed Cancel. Answers the reason that stands, or null where the cancel is not theirs. */
export async function setReason(sql: SqlOrTx, gymId: string, cancelId: string, userId: string, reason: MyCancelReason, now: Date): Promise<MyCancelReason | null> {
  const [set] = await sql<{ reason: string }[]>`
    UPDATE gym_app_cancels SET reason = ${reason}, reason_at = ${now}
    WHERE gym_id = ${gymId} AND id = ${cancelId} AND user_id = ${userId} AND reason IS NULL
    RETURNING reason`;
  if (set !== undefined) return myCancelReasonSchema.parse(set.reason);
  const [had] = await sql<{ reason: string | null }[]>`SELECT reason FROM gym_app_cancels WHERE gym_id = ${gymId} AND id = ${cancelId} AND user_id = ${userId}`;
  return had?.reason == null ? null : myCancelReasonSchema.parse(had.reason);
}

/** Claims the confirmation email: only the press that claims it sends it. False where it went already. */
export async function claimEmail(sql: SqlOrTx, gymId: string, cancelId: string, now: Date): Promise<boolean> {
  const rows = await sql`UPDATE gym_app_cancels SET emailed_at = ${now} WHERE gym_id = ${gymId} AND id = ${cancelId} AND emailed_at IS NULL RETURNING id`;
  return rows.length > 0;
}

/** Gives the claim back where the email did not go. */
export async function unclaimEmail(sql: SqlOrTx, gymId: string, cancelId: string, at: Date): Promise<void> {
  await sql`UPDATE gym_app_cancels SET emailed_at = NULL WHERE gym_id = ${gymId} AND id = ${cancelId} AND emailed_at = ${at}`;
}

/** The record a membership is on, or null where the gym has no such membership. */
export async function recordOfMembership(sql: SqlOrTx, gymId: string, membershipId: string): Promise<string | null> {
  const [row] = await sql<{ entry_id: string | null }[]>`SELECT entry_id FROM gym_held_memberships WHERE gym_id = ${gymId} AND id = ${membershipId}`;
  return row?.entry_id ?? null;
}

/** Cancelled before it starts: the membership it replaced on the next payment date (18x), which renews again. */
export async function replacedStopped(sql: SqlOrTx, gymId: string, membershipId: string): Promise<string | null> {
  const [row] = await sql<{ name: string }[]>`
    SELECT t.name
    FROM gym_held_memberships n
    JOIN gym_held_memberships o ON o.gym_id = n.gym_id AND o.id = n.replaces_id
    JOIN gym_membership_types t ON t.gym_id = o.gym_id AND t.id = o.membership_type_id
    WHERE n.gym_id = ${gymId} AND n.id = ${membershipId} AND n.replaced_stopped
      AND o.status = 'active' AND o.kind = 'recurring' AND NOT o.renews`;
  return row?.name ?? null;
}

/** The card saved for whoever pays, in the Square account the gym is connected to now: what staff could charge for money
 *  owed. Null where none is saved there, or a charge to it was declined and nothing has paid since. */
export async function chargeableCard(sql: SqlOrTx, gymId: string, payerEntryId: string): Promise<{ brand: string; last4: string } | null> {
  const [row] = await sql<{ brand: string; last4: string; declined: boolean }[]>`
    SELECT k.brand, k.last4,
           EXISTS (
             SELECT 1 FROM gym_card_charges x
             WHERE x.gym_id = k.gym_id AND x.card_id = k.card_id AND x.outcome = 'declined'
               AND NOT EXISTS (
                 SELECT 1 FROM gym_card_charges y
                 WHERE y.gym_id = x.gym_id AND y.card_id = x.card_id AND y.outcome = 'paid' AND y.started_at > x.started_at)
           ) AS declined
    FROM gym_payment_connections c
    JOIN gym_member_cards k ON k.gym_id = c.gym_id AND k.environment = c.environment AND k.account_id = c.account_id AND k.entry_id = ${payerEntryId}
    WHERE c.gym_id = ${gymId} AND c.state = 'connected' AND c.location_id IS NOT NULL
    LIMIT 1`;
  return row === undefined || row.declined ? null : { brand: row.brand, last4: row.last4 };
}

/** The gym's country, for how its clock is written: "2:05 PM" or "14:05". */
export async function countryOf(sql: SqlOrTx, gymId: string): Promise<string | null> {
  const [row] = await sql<{ country: string | null }[]>`SELECT country FROM gyms WHERE id = ${gymId}`;
  return row?.country ?? null;
}

/** The address of the account that pressed Cancel, for its confirmation. */
export async function emailOfUser(sql: SqlOrTx, userId: string): Promise<string | null> {
  const [row] = await sql<{ email: string | null }[]>`SELECT email::text AS email FROM users WHERE id = ${userId} AND status = 'active'`;
  return row?.email ?? null;
}

/** Overview's Cancelled in the app: a gym's newest from the last `APP_CANCELS_DAYS` days, and how many there are. */
export async function recentCancels(sql: SqlOrTx, gymId: string, now: Date): Promise<{ count: number; rows: AppCancelRow[]; letsEveryoneIn: boolean }> {
  const since = new Date(now.getTime() - APP_CANCELS_DAYS * 86_400_000);
  const [counted] = await sql<{ n: number; everyone: boolean }[]>`
    SELECT (SELECT count(*) FROM gym_app_cancels WHERE gym_id = ${gymId} AND created_at >= ${since})::int AS n,
           (SELECT checkin_who = 'everyone' FROM gyms WHERE id = ${gymId}) AS everyone`;
  const rows = await sql<
    { id: string; entry_id: string | null; name: string | null; past: boolean | null; type_name: string; cancelled_on: string; ends_on: string; when: string; reason: string | null }[]
  >`
    SELECT c.id, h.entry_id, e.full_name AS name, (e.former_at IS NOT NULL) AS past, t.name AS type_name,
           c.cancelled_on::text AS cancelled_on, c.ends_on::text AS ends_on, c."when", c.reason
    FROM gym_app_cancels c
    JOIN gym_held_memberships h ON h.gym_id = c.gym_id AND h.id = c.held_membership_id
    JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
    LEFT JOIN gym_member_list_entries e ON e.gym_id = h.gym_id AND e.id = h.entry_id
    WHERE c.gym_id = ${gymId} AND c.created_at >= ${since}
    ORDER BY c.created_at DESC, c.id
    LIMIT ${APP_CANCELS_SHOWN}`;
  return {
    count: counted?.n ?? 0,
    letsEveryoneIn: counted?.everyone === true,
    rows: rows.map((r) => ({
      id: r.id,
      entryId: r.name === null ? null : r.entry_id,
      name: r.name,
      past: r.past === true,
      membershipName: r.type_name,
      on: r.cancelled_on,
      endsOn: r.ends_on,
      when: myCancelWhenSchema.parse(r.when),
      reason: r.reason === null ? null : myCancelReasonSchema.parse(r.reason),
    })),
  };
}
