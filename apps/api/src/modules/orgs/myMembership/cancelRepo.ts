// CANCEL IN THE APP: ITS READS AND WRITES (ROADMAP 18l; spec Part 3 §14.8). Every read names the gym in its WHERE.
// The membership itself is changed by the front desk's own step (`moveHeldIn`); this file keeps what the gym is told
// (`gym_app_cancels`) and reads what the box says about money.
import type { Sql, TransactionSql } from "postgres";
import { z } from "zod";
import { dayInTz } from "../../gamification/streak.js";
import { heldRowsOf } from "../memberships/heldRepo.js";
import { APP_CANCELS_DAYS, APP_CANCELS_SHOWN, heldMembershipView, myCancelReasonSchema, myCancelWhenSchema, type AppCancel, type AppCancelRow, type MyCancelReason, type MyCancelWhen } from "@app/shared";

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
  /** What the box said: its sentences and the notes under it. */
  said: { lines: string[]; notes: string[] };
  /** When it was cancelled, for a confirmation sent again. */
  createdAt: Date;
  /** The bookings the cancel ended (18l-ii-a). */
  ended: { classes: number; sessions: number };
  /** Kept in the app (18l-ii-a): the gym's day, the account that pressed it, what the box said, whether its email went. */
  kept: { on: string; at: Date; userId: string | null; said: { lines: string[]; notes: string[] }; emailed: boolean } | null;
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
  said: unknown;
  created_at: Date;
  ended_classes: number;
  ended_sessions: number;
  kept_on: string | null;
  kept_at: Date | null;
  kept_by_user_id: string | null;
  keep_said: unknown;
  keep_emailed: boolean;
}

const saidSchema = z.object({ lines: z.array(z.string()), notes: z.array(z.string()) }).strict();

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
  said: saidSchema.parse(r.said),
  createdAt: r.created_at,
  ended: { classes: r.ended_classes, sessions: r.ended_sessions },
  kept: r.kept_on === null || r.kept_at === null ? null : { on: r.kept_on, at: r.kept_at, userId: r.kept_by_user_id, said: saidSchema.parse(r.keep_said), emailed: r.keep_emailed },
});

const COLUMNS = (sql: SqlOrTx) => sql`
  c.id, c.held_membership_id, c.user_id, c."when", c.ends_on::text AS ends_on, c.cancelled_on::text AS cancelled_on, c.reason,
  (c.emailed_at IS NOT NULL) AS emailed, c.said, c.created_at, c.ended_classes, c.ended_sessions, c.kept_on::text AS kept_on, c.kept_at, c.kept_by_user_id,
  c.keep_said, (c.keep_emailed_at IS NOT NULL) AS keep_emailed`;

/** The cancel this press already made, if it made one. */
export async function cancelOfRequest(sql: SqlOrTx, gymId: string, requestKey: string): Promise<CancelRow | null> {
  const [row] = await sql<RawCancel[]>`SELECT ${COLUMNS(sql)} FROM gym_app_cancels c WHERE c.gym_id = ${gymId} AND c.request_key = ${requestKey}`;
  return row === undefined ? null : shape(row);
}

/** The cancel this Keep press already kept, if it kept one (18l-ii-a). */
export async function cancelOfKeepRequest(sql: SqlOrTx, gymId: string, requestKey: string): Promise<CancelRow | null> {
  const [row] = await sql<RawCancel[]>`SELECT ${COLUMNS(sql)} FROM gym_app_cancels c WHERE c.gym_id = ${gymId} AND c.keep_request_key = ${requestKey}`;
  return row === undefined ? null : shape(row);
}

/** These memberships' cancels in the app that stand, not kept, by membership: one at most each. */
export async function cancelsOf(sql: SqlOrTx, gymId: string, membershipIds: readonly string[]): Promise<Map<string, CancelRow & { byName: string | null }>> {
  if (membershipIds.length === 0) return new Map();
  const rows = await sql<(RawCancel & { by_name: string | null })[]>`
    SELECT ${COLUMNS(sql)}, e.full_name AS by_name
    FROM gym_app_cancels c
    LEFT JOIN gym_member_list_entries e ON e.gym_id = c.gym_id AND e.id = c.by_entry_id
    WHERE c.gym_id = ${gymId} AND c.held_membership_id = ANY(${[...membershipIds]}::uuid[]) AND c.kept_at IS NULL`;
  return new Map(rows.map((r) => [r.held_membership_id, { ...shape(r), byName: r.by_name }]));
}

/** The membership that follows each of these on its record: one that replaces it (Change membership on the next payment
 *  date), or a repeating one still to start. Keeping one of these would leave two billing every month (18l-ii-a). */
export async function followersOf(sql: SqlOrTx, gymId: string, membershipIds: readonly string[], today: string): Promise<Map<string, { name: string; startsOn: string }>> {
  if (membershipIds.length === 0) return new Map();
  const rows = await sql<{ id: string; name: string; starts_on: string }[]>`
    SELECT DISTINCT ON (h.id) h.id, t.name, o.starts_on::text AS starts_on
    FROM gym_held_memberships h
    JOIN gym_held_memberships o ON o.gym_id = h.gym_id AND o.entry_id = h.entry_id AND o.id <> h.id AND o.status IN ('active','frozen')
      AND (o.replaces_id = h.id OR (o.kind = 'recurring' AND o.starts_on > ${today}::date))
    JOIN gym_membership_types t ON t.gym_id = o.gym_id AND t.id = o.membership_type_id
    WHERE h.gym_id = ${gymId} AND h.id = ANY(${[...membershipIds]}::uuid[])
    ORDER BY h.id, o.starts_on, o.id`;
  return new Map(rows.map((r) => [r.id, { name: r.name, startsOn: r.starts_on }]));
}

/** For the person's page: each membership's newest cancel in the app, kept or not, as staff read it. */
export async function appCancelsOf(sql: SqlOrTx, gymId: string, membershipIds: readonly string[]): Promise<Map<string, AppCancel>> {
  if (membershipIds.length === 0) return new Map();
  const rows = await sql<{ held_membership_id: string; cancelled_on: string; by_name: string | null; reason: string | null; kept_on: string | null; kept_by_name: string | null }[]>`
    SELECT DISTINCT ON (c.held_membership_id) c.held_membership_id, c.cancelled_on::text AS cancelled_on, e.full_name AS by_name, c.reason,
           c.kept_on::text AS kept_on, k.full_name AS kept_by_name
    FROM gym_app_cancels c
    LEFT JOIN gym_member_list_entries e ON e.gym_id = c.gym_id AND e.id = c.by_entry_id
    LEFT JOIN gym_member_list_entries k ON k.gym_id = c.gym_id AND k.id = c.kept_by_entry_id
    WHERE c.gym_id = ${gymId} AND c.held_membership_id = ANY(${[...membershipIds]}::uuid[])
    ORDER BY c.held_membership_id, c.created_at DESC, c.id DESC`;
  return new Map(
    rows.map((r) => [
      r.held_membership_id,
      {
        on: r.cancelled_on,
        byName: r.by_name,
        reason: r.reason === null ? null : myCancelReasonSchema.parse(r.reason),
        keptOn: r.kept_on,
        keptByName: r.kept_on === null ? null : r.kept_by_name,
      },
    ]),
  );
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
  said: { lines: string[]; notes: string[] };
  ended: { classes: number; sessions: number };
  now: Date;
}

/** The row the gym is told by, written in the cancel's own transaction. */
export async function insertCancel(tx: TransactionSql, c: NewCancel): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    INSERT INTO gym_app_cancels (gym_id, held_membership_id, by_entry_id, user_id, request_key, "when", ends_on, cancelled_on, said, ended_classes, ended_sessions, created_at)
    VALUES (${c.gymId}, ${c.membershipId}, ${c.byEntryId}, ${c.userId}, ${c.requestKey}, ${c.when}, ${c.endsOn}::date, ${c.cancelledOn}::date, ${tx.json(c.said)},
            ${c.ended.classes}, ${c.ended.sessions}, ${c.now})
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

/** KEPT (18l-ii-a), in the keep's own transaction: whoever pressed it, the press, and what the box said. False where it
 *  was kept already. */
export async function markKept(
  tx: TransactionSql,
  k: { gymId: string; cancelId: string; byEntryId: string; userId: string; requestKey: string; keptOn: string; said: { lines: string[]; notes: string[] }; now: Date },
): Promise<boolean> {
  const rows = await tx`
    UPDATE gym_app_cancels
    SET kept_at = ${k.now}, kept_on = ${k.keptOn}::date, kept_by_entry_id = ${k.byEntryId}, kept_by_user_id = ${k.userId},
        keep_request_key = ${k.requestKey}, keep_said = ${tx.json(k.said)}
    WHERE gym_id = ${k.gymId} AND id = ${k.cancelId} AND kept_at IS NULL
    RETURNING id`;
  return rows.length > 0;
}

/** Claims the keep's confirmation email: only the press that claims it sends it. */
export async function claimKeepEmail(sql: SqlOrTx, gymId: string, cancelId: string, now: Date): Promise<boolean> {
  const rows = await sql`UPDATE gym_app_cancels SET keep_emailed_at = ${now} WHERE gym_id = ${gymId} AND id = ${cancelId} AND kept_at IS NOT NULL AND keep_emailed_at IS NULL RETURNING id`;
  return rows.length > 0;
}

/** Gives the keep's claim back where the email did not go. */
export async function unclaimKeepEmail(sql: SqlOrTx, gymId: string, cancelId: string, at: Date): Promise<void> {
  await sql`UPDATE gym_app_cancels SET keep_emailed_at = NULL WHERE gym_id = ${gymId} AND id = ${cancelId} AND keep_emailed_at = ${at}`;
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
    ORDER BY c.connected_at DESC, k.updated_at DESC, k.card_id
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

/** A money-off Refer a friend gift waiting for this record's next membership bill, as the bill opener takes it
 *  (`giftsOntoOpenBills`): the oldest given; null for none. */
export async function waitingMoneyGift(sql: SqlOrTx, gymId: string, entryId: string): Promise<{ kind: "percent" | "amount"; percentBp: number | null; amountMinor: number | null; currency: string | null } | null> {
  const [row] = await sql<{ kind: string; percent_bp: number | null; amount_minor: number | null; currency: string | null }[]>`
    SELECT g.kind, g.percent_bp, g.amount_minor, g.currency
    FROM gym_referral_member_gifts g
    JOIN gym_members m ON m.gym_id = g.gym_id AND m.user_id = g.member_user_id AND m.removed_at IS NULL AND m.entry_id = ${entryId}
    JOIN users u ON u.id = m.user_id AND u.status = 'active'
    JOIN gym_member_list_entries e ON e.gym_id = m.gym_id AND e.id = m.entry_id AND e.former_at IS NULL
    WHERE g.gym_id = ${gymId} AND g.used_at IS NULL AND g.taken_back_at IS NULL AND g.gift_on = 'membership' AND g.days IS NULL
    ORDER BY g.given_at, g.id
    LIMIT 1`;
  if (row === undefined || (row.kind !== "percent" && row.kind !== "amount")) return null;
  return { kind: row.kind, percentBp: row.percent_bp, amountMinor: row.amount_minor, currency: row.currency };
}

/** The next day each other repeating membership of this record in use is billed: the gift goes on the earliest bill. */
export async function otherNextBills(sql: SqlOrTx, gymId: string, entryId: string, exceptId: string, today: string): Promise<string[]> {
  const ids = (await sql<{ id: string }[]>`
    SELECT id FROM gym_held_memberships
    WHERE gym_id = ${gymId} AND entry_id = ${entryId} AND id <> ${exceptId} AND kind = 'recurring' AND renews AND status IN ('active','frozen')`).map((r) => r.id);
  const rows = await heldRowsOf(sql, gymId, ids);
  return [...rows.values()].flatMap((r) => {
    const view = heldMembershipView(r.membership, today);
    return view.renewsOn === null ? [] : [view.renewsOn];
  });
}

/** The record's name on the gym's list. */
export async function nameOfRecord(sql: SqlOrTx, gymId: string, entryId: string): Promise<string | null> {
  const [row] = await sql<{ full_name: string }[]>`SELECT full_name FROM gym_member_list_entries WHERE gym_id = ${gymId} AND id = ${entryId}`;
  return row === undefined ? null : row.full_name.trim();
}

/** Overview's Cancelled in the app: a gym's newest from the last `APP_CANCELS_DAYS` days, and how many there are. Each
 *  one's last day is read from the membership as it stands, so a cancel staff made after it is said (round one, H2). */
export async function recentCancels(sql: SqlOrTx, gymId: string, now: Date): Promise<{ count: number; rows: AppCancelRow[]; letsEveryoneIn: boolean; today: string }> {
  const since = new Date(now.getTime() - APP_CANCELS_DAYS * 86_400_000);
  const [counted] = await sql<{ n: number; everyone: boolean; timezone: string }[]>`
    SELECT (SELECT count(*) FROM gym_app_cancels WHERE gym_id = ${gymId} AND created_at >= ${since})::int AS n,
           g.checkin_who = 'everyone' AS everyone, g.timezone
    FROM gyms g WHERE g.id = ${gymId}`;
  const rows = await sql<
    { id: string; held_id: string; entry_id: string | null; name: string | null; past: boolean | null; type_name: string; cancelled_on: string; when: string; reason: string | null; kept_on: string | null }[]
  >`
    SELECT c.id, c.held_membership_id AS held_id, h.entry_id, e.full_name AS name, (e.former_at IS NOT NULL) AS past, t.name AS type_name,
           c.cancelled_on::text AS cancelled_on, c."when", c.reason, c.kept_on::text AS kept_on
    FROM gym_app_cancels c
    JOIN gym_held_memberships h ON h.gym_id = c.gym_id AND h.id = c.held_membership_id
    JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
    LEFT JOIN gym_member_list_entries e ON e.gym_id = h.gym_id AND e.id = h.entry_id
    WHERE c.gym_id = ${gymId} AND c.created_at >= ${since}
    ORDER BY c.created_at DESC, c.id
    LIMIT ${APP_CANCELS_SHOWN}`;
  const today = dayInTz(now, counted?.timezone ?? "UTC");
  const held = await heldRowsOf(sql, gymId, rows.map((r) => r.held_id));
  const endOf = (id: string): string | null => {
    const row = held.get(id);
    return row === undefined ? null : heldMembershipView(row.membership, today).endsOn;
  };
  return {
    count: counted?.n ?? 0,
    letsEveryoneIn: counted?.everyone === true,
    today,
    rows: rows.map((r) => ({
      id: r.id,
      entryId: r.name === null ? null : r.entry_id,
      name: r.name,
      past: r.past === true,
      membershipName: r.type_name,
      on: r.cancelled_on,
      endsOn: endOf(r.held_id),
      when: myCancelWhenSchema.parse(r.when),
      reason: r.reason === null ? null : myCancelReasonSchema.parse(r.reason),
      keptOn: r.kept_on,
    })),
  };
}
