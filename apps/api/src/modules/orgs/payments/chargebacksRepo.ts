// What the app keeps of a chargeback (ROADMAP 18d-iv-e-i; `chargebacks.ts`). One row a dispute at a gym, unique by Square's id, holding
// what Square said last: an older answer arriving late never moves a newer one back.
import {
  chargebackReasonSchema,
  chargebackStateSchema,
  memberFeeKindSchema,
  memberRefundMethodSchema,
  paymentRefundableMinor,
  type ChargebackReason,
  type ChargebackSeen,
  type ChargebackStartPreview,
  type ChargebackState,
  type ChargebackToAnswer,
  type MemberFeeKind,
} from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import { writeRefund } from "../memberships/billsRepo.js";
import { refundTargetOf } from "../memberships/billsSql.js";
import { lockGym } from "../memberList/repo.js";
import { insertAudit } from "../repo.js";
import type { SquareEnvironment } from "./square.js";

type SqlOrTx = Sql | TransactionSql;

interface RawSeen {
  id: string;
  amount_minor: number;
  currency: string;
  state: string;
  reason: string | null;
  due_on: string | null;
  due_passed: boolean;
  brand: string | null;
  last4: string | null;
  stops: boolean;
  started_on: string | null;
}

const seenOf = (r: RawSeen, now: { reason: ChargebackReason | null; state: ChargebackState }): ChargebackSeen => ({
  id: r.id,
  amountMinor: r.amount_minor,
  currency: r.currency,
  state: now.state,
  reason: now.reason,
  dueOn: r.due_on,
  duePassed: r.due_passed,
  card: r.brand === null || r.last4 === null ? null : { brand: r.brand, last4: r.last4 },
  stops: r.stops,
  chargesStartedOn: r.started_on,
});
const seen = (r: RawSeen): ChargebackSeen => {
  const reason = chargebackReasonSchema.safeParse(r.reason);
  return seenOf(r, { state: chargebackStateSchema.parse(r.state), reason: reason.success ? reason.data : null });
};

/** It stops charges: not won or closed, and staff have not started them again after a lost one. */
const stands = (sql: SqlOrTx) => sql`(q.state NOT IN ('WON','INQUIRY_CLOSED') AND q.charges_restarted_at IS NULL)`;
/** It no longer stops them. */
const over = (sql: SqlOrTx) => sql`(q.state IN ('WON','INQUIRY_CLOSED') OR q.charges_restarted_at IS NOT NULL)`;

/** The gym is still connected to the Square account that holds it: only then can the app follow it. */
const stillReadable = (sql: SqlOrTx) => sql`EXISTS (SELECT 1 FROM gym_payment_connections pc WHERE pc.gym_id = q.gym_id AND pc.provider = 'square' AND pc.account_id = q.account_id AND pc.environment = q.environment)`;

const seenColumns = (sql: SqlOrTx, now: Date) => sql`
  q.id, q.amount_minor, q.currency, q.reason, q.brand, q.last4,
  -- In a Square account the gym has left, an open one can no longer be followed: only the gym can check.
  CASE WHEN q.state IN ('WON','LOST','ACCEPTED','INQUIRY_CLOSED') OR ${stillReadable(sql)} THEN q.state ELSE 'UNKNOWN' END AS state,
  ${stands(sql)} AND ${stillReadable(sql)} AS stops,
  (q.charges_restarted_at AT TIME ZONE g.timezone)::date::text AS started_on,
  (q.due_at AT TIME ZONE g.timezone)::date::text AS due_on, COALESCE(q.due_at <= ${now}, false) AS due_passed`;

const disputesOfPayer = (sql: SqlOrTx) => sql`
      FROM gym_square_disputes q
      JOIN gym_member_payments pay ON pay.gym_id = q.gym_id AND pay.provider = 'square' AND pay.provider_payment_id = q.square_payment_id
      JOIN gym_member_bills paid ON paid.gym_id = pay.gym_id AND paid.id = pay.bill_id
      JOIN gym_held_memberships held ON held.gym_id = paid.gym_id AND held.id = paid.held_membership_id
      WHERE q.gym_id = h.gym_id AND ${stillReadable(sql)}
        AND (held.id = h.id
             OR COALESCE((SELECT x.payer_entry_id FROM gym_member_payers x WHERE x.gym_id = held.gym_id AND x.entry_id = held.entry_id), held.entry_id)
              = COALESCE((SELECT x.payer_entry_id FROM gym_member_payers x WHERE x.gym_id = h.gym_id AND x.entry_id = h.entry_id), h.entry_id))`;

/** The chargebacks that stop the app charging whoever pays for membership `h` by itself, for a NOT EXISTS: one on a payment of that
 *  membership, or of any membership the same person pays for, unless the gym won it, the bank closed its question, or staff started charges again after losing. */
export const chargebackStops = (sql: SqlOrTx) => sql`SELECT 1 ${disputesOfPayer(sql)} AND ${stands(sql)}`;

/** One that no longer stops them. */
export const chargebackEnded = (sql: SqlOrTx) => sql`SELECT 1 ${disputesOfPayer(sql)} AND ${over(sql)}`;

/** The same, and it stood through all of the days the app could have charged bill `b` (its due day and the two after), on the gym's calendar `d`. */
export const chargebackStoodThrough = (sql: SqlOrTx) => sql`${chargebackEnded(sql)}
        AND (q.created_at AT TIME ZONE d.timezone)::date <= b.due_on + 2 AND (COALESCE(q.charges_restarted_at, q.square_updated_at) AT TIME ZONE d.timezone)::date > b.due_on + 2`;

/** Somebody else whose chargeback stops membership `h`: their record and name. */
export const chargebackHolder = (sql: SqlOrTx) => sql`
      SELECT jsonb_build_object('entryId', held.entry_id, 'name', (SELECT e.full_name FROM gym_member_list_entries e WHERE e.gym_id = held.gym_id AND e.id = held.entry_id)) ${disputesOfPayer(sql)}
        AND ${stands(sql)} AND held.entry_id IS NOT NULL AND held.entry_id IS DISTINCT FROM h.entry_id
      LIMIT 1`;

/** Which of these memberships the app no longer charges by itself. */
export async function chargesStoppedOf(sql: SqlOrTx, gymId: string, membershipIds: readonly string[]): Promise<Set<string>> {
  if (membershipIds.length === 0) return new Set();
  const rows = await sql<{ id: string }[]>`
    SELECT h.id FROM gym_held_memberships h
    WHERE h.gym_id = ${gymId} AND h.id = ANY(${[...membershipIds]}::uuid[]) AND EXISTS (${chargebackStops(sql)})`;
  return new Set(rows.map((r) => r.id));
}

/** Its card is already kept: a refused read of the payment is asked again next time. */
export async function cardKnown(sql: SqlOrTx, gymId: string, environment: SquareEnvironment, squareDisputeId: string): Promise<boolean> {
  const [row] = await sql<{ brand: string | null }[]>`SELECT brand FROM gym_square_disputes WHERE gym_id = ${gymId} AND environment = ${environment} AND square_dispute_id = ${squareDisputeId}`;
  return row !== undefined && row.brand !== null;
}

/** Square's record, written once and kept current, and told to Staff activity when it first comes and each time its state moves. */
export async function writeDispute(
  sql: Sql,
  d: {
    gymId: string;
    environment: SquareEnvironment;
    accountId: string;
    squareDisputeId: string;
    squarePaymentId: string;
    amountMinor: number;
    currency: string;
    state: ChargebackState;
    reason: ChargebackReason | null;
    dueAt: Date | null;
    card: { brand: string; last4: string } | null;
    squareUpdatedAt: Date | null;
    now: Date;
  },
): Promise<void> {
  await sql.begin(async (tx) => {
    const [was] = await tx<{ id: string; state: string }[]>`
      SELECT id, state FROM gym_square_disputes WHERE gym_id = ${d.gymId} AND environment = ${d.environment} AND square_dispute_id = ${d.squareDisputeId} FOR UPDATE`;
    const [row] = await tx<{ id: string; state: string; inserted: boolean }[]>`
      INSERT INTO gym_square_disputes (gym_id, environment, account_id, square_dispute_id, square_payment_id, amount_minor, currency, state, reason, due_at, brand, last4, square_updated_at, changed_at)
      VALUES (${d.gymId}, ${d.environment}, ${d.accountId}, ${d.squareDisputeId}, ${d.squarePaymentId}, ${d.amountMinor}, ${d.currency}, ${d.state}, ${d.reason}, ${d.dueAt},
              ${d.card?.brand ?? null}, ${d.card?.last4 ?? null}, ${d.squareUpdatedAt}, ${d.now})
      ON CONFLICT (gym_id, environment, square_dispute_id) DO UPDATE
      SET state = EXCLUDED.state, reason = EXCLUDED.reason, due_at = EXCLUDED.due_at, amount_minor = EXCLUDED.amount_minor, currency = EXCLUDED.currency,
          brand = COALESCE(EXCLUDED.brand, gym_square_disputes.brand), last4 = COALESCE(EXCLUDED.last4, gym_square_disputes.last4),
          square_updated_at = EXCLUDED.square_updated_at, changed_at = EXCLUDED.changed_at
      WHERE gym_square_disputes.square_updated_at IS NULL OR EXCLUDED.square_updated_at IS NULL OR EXCLUDED.square_updated_at >= gym_square_disputes.square_updated_at
      RETURNING id, state, (xmax = 0) AS inserted`;
    // An older answer changed nothing. Two workers at one instant: the second read no row, waited on the unique index and updated, so it says nothing.
    if (row === undefined || was?.state === row.state || (was === undefined && !row.inserted)) return;
    const [person] = await tx<{ entry_id: string | null }[]>`
      SELECT h.entry_id FROM gym_member_payments p
      JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
      JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
      WHERE p.gym_id = ${d.gymId} AND p.provider = 'square' AND p.provider_payment_id = ${d.squarePaymentId}
      UNION ALL
      SELECT s.entry_id FROM gym_sales s WHERE s.gym_id = ${d.gymId} AND s.square_payment_id = ${d.squarePaymentId}
      LIMIT 1`;
    const entryId = person?.entry_id ?? null;
    await insertAudit(tx, {
      actorUserId: null,
      gymId: d.gymId,
      action: "org.chargeback",
      targetType: entryId === null ? "gym_square_dispute" : "gym_member_list_entry",
      targetId: entryId ?? row.id,
      meta: { ...(entryId === null ? {} : { entryId }), amountMinor: String(d.amountMinor), currency: d.currency, state: d.state },
    });
  });
}

/** A lost or accepted chargeback on a member's payment: the money is written as gone back, once, on the day Square says, and never more
 *  than is left of the payment, as staff may have refunded some of it. Under the gym's lock, keyed by the chargeback's own id. Not yet
 *  where the app cannot write it (a refund waiting on Square, a bill still part paid): the next hourly read asks again. A sale's waits
 *  for 18d-iv-e-ii-b. */
export async function settleLostChargeback(sql: Sql, d: { gymId: string; environment: SquareEnvironment; squareDisputeId: string; now: Date }): Promise<void> {
  await sql.begin(async (tx) => {
    await lockGym(tx, d.gymId);
    const [row] = await tx<{ id: string; state: string; amount_minor: number; currency: string; square_payment_id: string; lost_written_at: Date | null; brand: string | null; last4: string | null; on_day: string }[]>`
      SELECT q.id, q.state, q.amount_minor, q.currency, q.square_payment_id, q.lost_written_at, q.brand, q.last4,
             (COALESCE(q.square_updated_at, ${d.now}) AT TIME ZONE g.timezone)::date::text AS on_day
      FROM gym_square_disputes q JOIN gyms g ON g.id = q.gym_id
      WHERE q.gym_id = ${d.gymId} AND q.environment = ${d.environment} AND q.square_dispute_id = ${d.squareDisputeId}
      FOR UPDATE OF q`;
    if (row === undefined || row.lost_written_at !== null || (row.state !== "LOST" && row.state !== "ACCEPTED")) return;
    const [where] = await tx<{ id: string; membership_id: string; bill_id: string; entry_id: string | null; currency: string }[]>`
      SELECT p.id, b.held_membership_id AS membership_id, b.id AS bill_id, h.entry_id, p.currency
      FROM gym_member_payments p
      JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
      JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
      WHERE p.gym_id = ${d.gymId} AND p.provider = 'square' AND p.provider_payment_id = ${row.square_payment_id} AND p.undone_at IS NULL`;
    if (where === undefined || where.currency !== row.currency) return;
    const [asking] = await tx<{ id: string }[]>`SELECT id FROM gym_square_refunds WHERE gym_id = ${d.gymId} AND square_payment_id = ${row.square_payment_id} AND state = 'asking' LIMIT 1`;
    if (asking !== undefined) return;
    const target = await refundTargetOf(tx, d.gymId, where.membership_id, where.id);
    if (target === null || target.bill.status === "open") return;
    const method = memberRefundMethodSchema.safeParse(target.payment.method);
    if (!method.success) return;
    const amountMinor = Math.min(row.amount_minor, paymentRefundableMinor(target.bill, target.payment));
    if (amountMinor > 0) {
      await writeRefund(tx, {
        gymId: d.gymId,
        entryId: where.entry_id,
        membershipId: where.membership_id,
        bill: target.bill,
        standing: target.payment,
        paymentId: where.id,
        requestKey: row.id,
        amountMinor,
        currency: row.currency,
        method: method.data,
        reason: "chargeback",
        today: row.on_day,
        actorUserId: null,
        now: d.now,
        action: "org.member_refund_chargeback",
        card: row.brand === null || row.last4 === null ? null : { brand: row.brand, last4: row.last4 },
      });
    }
    await tx`UPDATE gym_square_disputes SET lost_written_at = ${d.now} WHERE gym_id = ${d.gymId} AND id = ${row.id}`;
  });
}

interface ToStart {
  state: string;
  stops: boolean;
  membershipId: string;
  payerId: string | null;
  environment: string;
  accountId: string;
}

/** A chargeback on a member's payment at this gym, with whoever pays for that membership. */
async function chargebackToStart(sql: SqlOrTx, gymId: string, id: string): Promise<ToStart | null> {
  const [row] = await sql<{ state: string; stops: boolean; membership_id: string; payer_id: string | null; environment: string; account_id: string }[]>`
    SELECT q.state, ${stands(sql)} AND ${stillReadable(sql)} AS stops, held.id AS membership_id, q.environment, q.account_id,
           COALESCE((SELECT x.payer_entry_id FROM gym_member_payers x WHERE x.gym_id = held.gym_id AND x.entry_id = held.entry_id), held.entry_id) AS payer_id
    FROM gym_square_disputes q
    JOIN gym_member_payments pay ON pay.gym_id = q.gym_id AND pay.provider = 'square' AND pay.provider_payment_id = q.square_payment_id
    JOIN gym_member_bills paid ON paid.gym_id = pay.gym_id AND paid.id = pay.bill_id
    JOIN gym_held_memberships held ON held.gym_id = paid.gym_id AND held.id = paid.held_membership_id
    WHERE q.gym_id = ${gymId} AND q.id = ${id}`;
  return row === undefined ? null : { state: row.state, stops: row.stops, membershipId: row.membership_id, payerId: row.payer_id, environment: row.environment, accountId: row.account_id };
}

const lostOrAccepted = (state: string): boolean => state === "LOST" || state === "ACCEPTED";

/** Who Start automatic charges again changes: the renewing memberships of whoever pays. Null where there is no such chargeback here. */
export async function chargebackStartPreview(sql: SqlOrTx, gymId: string, id: string): Promise<ChargebackStartPreview | null> {
  const row = await chargebackToStart(sql, gymId, id);
  if (row === null) return null;
  const people =
    row.payerId === null
      ? []
      : await sql<{ name: string; what: string | null }[]>`
          SELECT e.full_name AS name, t.name AS what
          FROM gym_held_memberships h
          JOIN gym_member_list_entries e ON e.gym_id = h.gym_id AND e.id = h.entry_id AND e.former_at IS NULL
          LEFT JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
          WHERE h.gym_id = ${gymId} AND h.kind = 'recurring' AND h.renews AND h.status IN ('active','frozen')
            AND COALESCE((SELECT x.payer_entry_id FROM gym_member_payers x WHERE x.gym_id = h.gym_id AND x.entry_id = h.entry_id), h.entry_id) = ${row.payerId}
          ORDER BY e.full_name, h.id LIMIT 50`;
  const [card] =
    row.payerId === null
      ? []
      : await sql<{ brand: string; last4: string }[]>`
          SELECT brand, last4 FROM gym_member_cards WHERE gym_id = ${gymId} AND environment = ${row.environment} AND account_id = ${row.accountId} AND entry_id = ${row.payerId}`;
  const [other] = await sql<{ id: string }[]>`
    SELECT h.id FROM gym_held_memberships h
    WHERE h.gym_id = ${gymId} AND h.id = ${row.membershipId} AND EXISTS (${chargebackStops(sql)} AND q.id <> ${id})`;
  return { people: people.map((p) => ({ name: p.name, what: p.what ?? "" })), card: card ?? null, otherStops: other !== undefined };
}

export type StartChargesOutcome = "done" | "not_found" | "not_lost";

/** Start automatic charges again, on a lost or accepted chargeback alone. The same press twice is one. */
export async function startChargesAgain(sql: Sql, gymId: string, id: string, userId: string, now: Date): Promise<StartChargesOutcome> {
  return await sql.begin(async (tx): Promise<StartChargesOutcome> => {
    const [locked] = await tx<{ id: string; started: boolean; amount_minor: number; currency: string }[]>`
      SELECT id, charges_restarted_at IS NOT NULL AS started, amount_minor, currency FROM gym_square_disputes WHERE gym_id = ${gymId} AND id = ${id} FOR UPDATE`;
    if (locked === undefined) return "not_found";
    const row = await chargebackToStart(tx, gymId, id);
    if (row === null) return "not_found";
    if (locked.started) return "done";
    if (!lostOrAccepted(row.state) || !row.stops) return "not_lost";
    await tx`UPDATE gym_square_disputes SET charges_restarted_at = ${now}, charges_restarted_by = ${userId} WHERE gym_id = ${gymId} AND id = ${id}`;
    const [held] = await tx<{ entry_id: string | null }[]>`SELECT entry_id FROM gym_held_memberships WHERE gym_id = ${gymId} AND id = ${row.membershipId}`;
    const entryId = held?.entry_id ?? null;
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.chargeback_charges_started",
      targetType: entryId === null ? "gym_square_dispute" : "gym_member_list_entry",
      targetId: entryId ?? id,
      meta: { ...(entryId === null ? {} : { entryId }), amountMinor: String(locked.amount_minor), currency: locked.currency },
    });
    return "done";
  });
}

/** Each payment's chargebacks, oldest first. */
export async function chargebacksOfPayments(sql: SqlOrTx, gymId: string, paymentIds: readonly string[], now: Date): Promise<Map<string, ChargebackSeen[]>> {
  const out = new Map<string, ChargebackSeen[]>();
  if (paymentIds.length === 0) return out;
  const rows = await sql<(RawSeen & { payment_id: string })[]>`
    SELECT p.id AS payment_id, ${seenColumns(sql, now)}
    FROM gym_square_disputes q
    JOIN gyms g ON g.id = q.gym_id
    JOIN gym_member_payments p ON p.gym_id = q.gym_id AND p.provider = 'square' AND p.provider_payment_id = q.square_payment_id
    WHERE q.gym_id = ${gymId} AND p.id = ANY(${[...paymentIds]}::uuid[])
    ORDER BY q.created_at, q.id`;
  for (const r of rows) out.set(r.payment_id, [...(out.get(r.payment_id) ?? []), seen(r)]);
  return out;
}

/** The same for sales, by the sale's first line. */
export async function chargebacksOfSales(sql: SqlOrTx, gymId: string, saleIds: readonly string[], now: Date): Promise<Map<string, ChargebackSeen[]>> {
  const out = new Map<string, ChargebackSeen[]>();
  if (saleIds.length === 0) return out;
  const rows = await sql<(RawSeen & { sale_id: string })[]>`
    SELECT s.id AS sale_id, ${seenColumns(sql, now)}
    FROM gym_square_disputes q
    JOIN gyms g ON g.id = q.gym_id
    JOIN gym_sales s ON s.gym_id = q.gym_id AND s.square_payment_id = q.square_payment_id
    WHERE q.gym_id = ${gymId} AND s.id = ANY(${[...saleIds]}::uuid[])
    ORDER BY q.created_at, q.id`;
  // A sale holds no membership, so its chargeback stops no charge.
  for (const r of rows) out.set(r.sale_id, [...(out.get(r.sale_id) ?? []), { ...seen(r), stops: false }]);
  return out;
}

export type ChargebackRow = Omit<ChargebackToAnswer, "member"> & { member: { entryId: string | null; typeName: string; fee: MemberFeeKind | null } | null };

/** Those still to answer, the soonest date first: Square still waits on the gym, and its date has not passed. After them, those lost
 *  whose automatic charges staff have not started again, while whoever pays still has a renewing membership: nothing else says so. */
export async function chargebacksToAnswer(sql: Sql, gymId: string, members: boolean, now: Date, from: number, limit: number): Promise<{ count: number; lostCount: number; rows: ChargebackRow[] }> {
  const rows = await sql<
    (RawSeen & { at: Date | null; total: number; lost_total: number; name: string | null; past: boolean; person_deleted: boolean; entry_id: string | null; type_name: string | null; fee: string | null; sale_id: string | null; sold_on: string | null; item_name: string | null; more: number })[]
  >`
    WITH open AS (
      SELECT ${seenColumns(sql, now)}, q.due_at AS at, q.square_payment_id, q.gym_id
      FROM gym_square_disputes q
      JOIN gyms g ON g.id = q.gym_id
      WHERE q.gym_id = ${gymId} AND ${stillReadable(sql)}
        AND ((q.state IN ('EVIDENCE_REQUIRED','INQUIRY_EVIDENCE_REQUIRED','UNKNOWN') AND (q.due_at IS NULL OR q.due_at > ${now}))
             OR (q.state IN ('LOST','ACCEPTED') AND q.charges_restarted_at IS NULL))
    ),
    listed AS (
      SELECT o.*, e.full_name AS name, COALESCE(e.former_at IS NOT NULL, false) AS past, h.entry_id IS NULL AS person_deleted, e.id AS entry_id, t.name AS type_name, b.fee,
             NULL::uuid AS sale_id, NULL::text AS sold_on, NULL::text AS item_name, 0 AS more
      FROM open o
      JOIN gym_member_payments p ON p.gym_id = o.gym_id AND p.provider = 'square' AND p.provider_payment_id = o.square_payment_id AND p.undone_at IS NULL
      JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
      JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
      LEFT JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
      -- Delete permanently keeps a paid membership with no record: the date still runs, so the row stays, as "A deleted member".
      LEFT JOIN gym_member_list_entries e ON e.gym_id = h.gym_id AND e.id = h.entry_id
      WHERE ${members}::boolean
        AND (o.state NOT IN ('LOST','ACCEPTED') OR EXISTS (
          SELECT 1 FROM gym_held_memberships r
          LEFT JOIN gym_member_list_entries re ON re.gym_id = r.gym_id AND re.id = r.entry_id
          WHERE r.gym_id = h.gym_id AND r.kind = 'recurring' AND r.renews AND r.status IN ('active','frozen') AND r.entry_id IS NOT NULL AND re.former_at IS NULL
            AND COALESCE((SELECT x.payer_entry_id FROM gym_member_payers x WHERE x.gym_id = r.gym_id AND x.entry_id = r.entry_id), r.entry_id)
              = COALESCE((SELECT x.payer_entry_id FROM gym_member_payers x WHERE x.gym_id = h.gym_id AND x.entry_id = h.entry_id), h.entry_id)))
      UNION ALL
      SELECT o.*, e.full_name, COALESCE(e.former_at IS NOT NULL, false), s.entry_id IS NULL AND s.for_member, NULL, NULL, NULL,
             s.id, s.sold_on::text, s.item_name, (SELECT count(*)::int - 1 FROM gym_sales l WHERE l.gym_id = s.gym_id AND l.receipt_number = s.receipt_number)
      FROM open o
      JOIN gym_sales s ON s.gym_id = o.gym_id AND s.square_payment_id = o.square_payment_id AND s.line_no = 1 AND s.undone_at IS NULL
      LEFT JOIN gym_member_list_entries e ON e.gym_id = s.gym_id AND e.id = s.entry_id
      WHERE o.state NOT IN ('LOST','ACCEPTED')
    )
    SELECT l.*, count(*) OVER ()::int AS total, count(*) FILTER (WHERE l.state IN ('LOST','ACCEPTED')) OVER ()::int AS lost_total
    FROM listed l
    ORDER BY l.state IN ('LOST','ACCEPTED'), l.at NULLS FIRST, l.id
    LIMIT ${limit} OFFSET ${from}`;
  const count = rows[0]?.total ?? (from === 0 ? 0 : from);
  return {
    count,
    lostCount: rows[0]?.lost_total ?? 0,
    rows: rows.map((r) => {
      const fee = memberFeeKindSchema.safeParse(r.fee);
      return {
        ...seen(r),
        // A sale holds no membership, so its chargeback stops no charge.
        stops: r.sale_id === null && r.stops,
        name: r.name,
        past: r.past,
        personDeleted: r.person_deleted,
        member: r.sale_id !== null ? null : { entryId: r.entry_id, typeName: r.type_name ?? "", fee: fee.success ? fee.data : null },
        sale: r.sale_id === null || r.sold_on === null ? null : { saleId: r.sale_id, day: r.sold_on, item: r.item_name ?? "", more: r.more },
      };
    }),
  };
}
