// Refunds to review (ROADMAP 18d-iv-b-iii): the list, and the two decisions that take a row off it. A row is one Square payment:
// a basket's products share one, so its presses are read together, and a press on a fee no longer owed stands in for that fee's
// own row. Every statement names the gym. A press leaves the list when refunds written after it cover its amount, the rule a
// person's page reads (`openPressesOf`, `openPressesOfSales`).
import { CARD_REFUND_LIMITS, memberFeeKindSchema, paidThroughSquare, memberPaymentMethodSchema, type RefundToReview } from "@app/shared";
import type { Sql } from "postgres";
import { lockGym } from "../memberList/repo.js";
import { stillOwedSql } from "../memberships/feesRepo.js";
import { insertAudit } from "../repo.js";

interface RawRow {
  id: string;
  kind: RefundToReview["kind"];
  amount_minor: number;
  paid_minor: number;
  currency: string;
  full_name: string | null;
  past: boolean;
  person_deleted: boolean;
  on_day: string | null;
  entry_id: string | null;
  membership_id: string | null;
  payment_id: string | null;
  type_name: string | null;
  method: string | null;
  fee: string | null;
  fee_for: string | null;
  of_pt: boolean;
  covers_from: string | null;
  covers_to: string | null;
  sale_id: string | null;
  sold_on: string | null;
  item_name: string | null;
  more: number;
  total: number;
}

const memberOf = (r: RawRow): RefundToReview["member"] => {
  if (r.entry_id === null || r.membership_id === null || r.payment_id === null || r.method === null) return null;
  const kind = r.fee === null ? null : memberFeeKindSchema.parse(r.fee);
  return {
    entryId: r.entry_id,
    membershipId: r.membership_id,
    paymentId: r.payment_id,
    typeName: r.type_name ?? "",
    byHand: !paidThroughSquare(memberPaymentMethodSchema.parse(r.method)),
    fee:
      kind === null || r.covers_from === null
        ? null
        : { kind, of: kind === "freeze" ? "membership" : r.of_pt ? "pt" : "class", forName: r.fee_for !== null && r.fee_for !== "" ? r.fee_for : (r.type_name ?? ""), on: r.covers_from, to: kind === "freeze" ? r.covers_to : null },
  };
};

/** A page of the gym's list, and how many there are. `members`: the viewer may open people's pages; without it, sales alone. */
export async function refundsToReview(sql: Sql, gymId: string, members: boolean, now: Date, from: number, limit: number): Promise<{ count: number; rows: RefundToReview[] }> {
  const lateBefore = new Date(now.getTime() - CARD_REFUND_LIMITS.pendingDays * 24 * 60 * 60_000);
  const rows = await sql<RawRow[]>`
    WITH open_press AS (
      SELECT DISTINCT ON (q.square_payment_id)
             q.id, q.payment_id, q.sale_id, q.parts, q.state, q.outcome, q.amount_minor, q.currency, q.started_at,
             (q.started_at AT TIME ZONE g.timezone)::date::text AS on_day
      FROM gym_square_refunds q
      JOIN gyms g ON g.id = q.gym_id
      WHERE q.gym_id = ${gymId} AND q.no_refund_at IS NULL
        AND (q.outcome IN ('failed','lost') OR (q.state = 'pending' AND q.started_at <= ${lateBefore}))
        AND (${members}::boolean OR q.sale_id IS NOT NULL)
        AND (q.state = 'pending' OR q.payment_id IS NULL
             OR (SELECT COALESCE(sum(r.amount_minor), 0) FROM gym_member_refunds r
                 WHERE r.gym_id = q.gym_id AND r.payment_id = q.payment_id AND r.created_at > q.started_at AND r.undone_at IS NULL) < q.amount_minor)
        AND (q.state = 'pending' OR q.sale_id IS NULL
             OR (SELECT COALESCE(sum(r.amount_minor), 0) FROM gym_sale_refunds r
                 JOIN gym_sales l ON l.gym_id = r.gym_id AND l.id = r.sale_id
                 JOIN gym_sales o ON o.gym_id = q.gym_id AND o.id = q.sale_id
                 WHERE r.gym_id = q.gym_id AND r.created_at > q.started_at AND r.undone_at IS NULL
                   AND (l.id = o.id OR (q.parts IS NOT NULL AND l.receipt_number = o.receipt_number))) < q.amount_minor)
      ORDER BY q.square_payment_id, q.started_at DESC
    ),
    listed AS (
      SELECT q.id, CASE WHEN q.state = 'pending' THEN 'late' ELSE q.outcome END AS kind, 0 AS rank, q.started_at AS at, q.amount_minor,
             0 AS paid_minor, q.currency, e.full_name, e.former_at IS NOT NULL AS past, false AS person_deleted, q.on_day,
             e.id AS entry_id, h.id AS membership_id, p.id AS payment_id, t.name AS type_name, p.method, b.fee, b.fee_for,
             b.pt_appointment_id IS NOT NULL AS of_pt, b.covers_from::text AS covers_from, b.covers_to::text AS covers_to,
             NULL::uuid AS sale_id, NULL::text AS sold_on, NULL::text AS item_name, 0 AS more
      FROM open_press q
      JOIN gym_member_payments p ON p.gym_id = ${gymId} AND p.id = q.payment_id AND p.undone_at IS NULL
      JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
      JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
      JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
      JOIN gym_member_list_entries e ON e.gym_id = h.gym_id AND e.id = h.entry_id
      UNION ALL
      SELECT q.id, CASE WHEN q.state = 'pending' THEN 'late' ELSE q.outcome END, 0, q.started_at, q.amount_minor,
             0, q.currency, e.full_name, COALESCE(e.former_at IS NOT NULL, false), s.entry_id IS NULL AND s.for_member, q.on_day,
             NULL, NULL, NULL, NULL, NULL, NULL, NULL,
             false, NULL, NULL,
             s.id, s.sold_on::text, s.item_name, GREATEST(COALESCE(jsonb_array_length(q.parts), 1) - 1, 0)
      FROM open_press q
      JOIN gym_sales s ON s.gym_id = ${gymId} AND s.id = q.sale_id AND s.undone_at IS NULL
      LEFT JOIN gym_member_list_entries e ON e.gym_id = s.gym_id AND e.id = s.entry_id
      UNION ALL
      SELECT b.id, 'fee', 1, p.created_at, GREATEST(p.amount_minor - x.back, 0),
             p.amount_minor, b.currency, e.full_name, e.former_at IS NOT NULL, false, NULL,
             e.id, h.id, p.id, t.name, p.method, b.fee, b.fee_for,
             b.pt_appointment_id IS NOT NULL, b.covers_from::text, b.covers_to::text,
             NULL, NULL, NULL, 0
      FROM gym_member_bills b
      JOIN gym_member_payments p ON p.gym_id = b.gym_id AND p.bill_id = b.id AND p.undone_at IS NULL
      JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
      JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
      JOIN gym_member_list_entries e ON e.gym_id = h.gym_id AND e.id = h.entry_id
      CROSS JOIN LATERAL (SELECT COALESCE(sum(r.amount_minor), 0)::int AS back FROM gym_member_refunds r
                          WHERE r.gym_id = p.gym_id AND r.payment_id = p.id AND r.undone_at IS NULL) x
      WHERE ${members}::boolean AND b.gym_id = ${gymId} AND b.fee IS NOT NULL AND b.status = 'paid' AND b.fee_kept_at IS NULL
        AND p.amount_minor > x.back
        AND NOT ${stillOwedSql(sql)}
        AND NOT EXISTS (SELECT 1 FROM gym_square_refunds w WHERE w.gym_id = p.gym_id AND w.payment_id = p.id AND w.state = 'asking')
        AND NOT EXISTS (SELECT 1 FROM open_press o WHERE o.payment_id = p.id)
    )
    SELECT l.*, count(*) OVER ()::int AS total
    FROM listed l
    ORDER BY l.rank, l.at DESC, l.id
    LIMIT ${limit} OFFSET ${from}`;
  // Past the last row the page is empty, and says nothing of the count.
  const count = rows[0]?.total ?? (from === 0 ? 0 : from);
  return {
    count,
    rows: rows.map((r) => {
      const fee = r.kind === "fee";
      return {
        id: r.id,
        kind: r.kind,
        amountMinor: r.amount_minor,
        paidMinor: fee ? r.paid_minor : r.amount_minor,
        currency: r.currency,
        name: r.full_name,
        past: r.past,
        personDeleted: r.person_deleted,
        on: r.on_day,
        member: memberOf(r),
        sale: r.sale_id === null || r.sold_on === null ? null : { saleId: r.sale_id, day: r.sold_on, item: r.item_name ?? "", more: r.more },
      };
    }),
  };
}

export type ReviewOutcome = "done" | "not_found" | "changed" | "waiting";

/** Keep the fee: it stays paid and comes off the list, with who and when. The same press twice is one decision. */
export async function keepFee(sql: Sql, gymId: string, billId: string, userId: string, now: Date): Promise<ReviewOutcome> {
  return await sql.begin(async (tx): Promise<ReviewOutcome> => {
    await lockGym(tx, gymId);
    const [fee] = await tx<{ fee: string; status: string; kept: boolean; still_owed: boolean; entry_id: string | null; membership_id: string; amount_minor: number; currency: string }[]>`
      SELECT b.fee, b.status, b.fee_kept_at IS NOT NULL AS kept, ${stillOwedSql(tx)} AS still_owed, h.entry_id, b.held_membership_id AS membership_id, b.amount_minor, b.currency
      FROM gym_member_bills b
      JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
      WHERE b.gym_id = ${gymId} AND b.id = ${billId} AND b.fee IS NOT NULL
      FOR UPDATE OF b`;
    if (fee === undefined) return "not_found";
    if (fee.kept) return "done";
    if (fee.status !== "paid" || fee.still_owed) return "changed";
    const [asking] = await tx<{ id: string }[]>`
      SELECT q.id FROM gym_square_refunds q
      JOIN gym_member_payments p ON p.gym_id = q.gym_id AND p.id = q.payment_id
      WHERE q.gym_id = ${gymId} AND p.bill_id = ${billId} AND q.state = 'asking' LIMIT 1`;
    if (asking !== undefined) return "waiting";
    await tx`UPDATE gym_member_bills SET fee_kept_at = ${now}, fee_kept_by = ${userId}, updated_at = ${now} WHERE gym_id = ${gymId} AND id = ${billId}`;
    // What went wrong on its payment needs no answer now: the gym keeps the money.
    await tx`
      UPDATE gym_square_refunds q SET no_refund_at = ${now}, no_refund_by = ${userId}
      FROM gym_member_payments p
      WHERE q.gym_id = ${gymId} AND p.gym_id = q.gym_id AND p.id = q.payment_id AND p.bill_id = ${billId}
        AND q.outcome IN ('failed','lost') AND q.no_refund_at IS NULL`;
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.member_fee_kept",
      targetType: "gym_member_bill",
      targetId: billId,
      meta: { ...(fee.entry_id === null ? {} : { entryId: fee.entry_id }), membershipId: fee.membership_id, fee: fee.fee, amountMinor: String(fee.amount_minor), currency: fee.currency },
    });
    return "done";
  });
}

export interface ReviewPress {
  paymentId: string | null;
}

/** Whether the press is a member's payment's: their page is needed to act on it. Null where the gym has no such press. */
export async function pressForReview(sql: Sql, gymId: string, pressId: string): Promise<ReviewPress | null> {
  const [row] = await sql<{ payment_id: string | null }[]>`SELECT payment_id FROM gym_square_refunds WHERE gym_id = ${gymId} AND id = ${pressId}`;
  return row === undefined ? null : { paymentId: row.payment_id };
}

/** No refund needed: the row comes off the list and the person's page or Sell says who decided and when. It closes every press
 *  that went wrong on that Square payment, so an older one does not take its place, and a fee no longer owed is kept with it. */
export async function noRefundNeeded(sql: Sql, gymId: string, pressId: string, userId: string, now: Date): Promise<ReviewOutcome> {
  return await sql.begin(async (tx): Promise<ReviewOutcome> => {
    await lockGym(tx, gymId);
    const [press] = await tx<{ square_payment_id: string; payment_id: string | null; sale_id: string | null; outcome: string | null; decided: boolean; amount_minor: number; currency: string }[]>`
      SELECT square_payment_id, payment_id, sale_id, outcome, no_refund_at IS NOT NULL AS decided, amount_minor, currency
      FROM gym_square_refunds WHERE gym_id = ${gymId} AND id = ${pressId} FOR UPDATE`;
    if (press === undefined) return "not_found";
    if (press.decided) return "done";
    if (press.outcome !== "failed" && press.outcome !== "lost") return "changed";
    await tx`
      UPDATE gym_square_refunds SET no_refund_at = ${now}, no_refund_by = ${userId}
      WHERE gym_id = ${gymId} AND square_payment_id = ${press.square_payment_id} AND outcome IN ('failed','lost') AND no_refund_at IS NULL`;
    let about: Record<string, string> = {};
    if (press.payment_id !== null) {
      const [where] = await tx<{ bill_id: string; entry_id: string | null }[]>`
        SELECT p.bill_id, h.entry_id FROM gym_member_payments p
        JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
        JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
        WHERE p.gym_id = ${gymId} AND p.id = ${press.payment_id}`;
      if (where !== undefined) {
        about = where.entry_id === null ? {} : { entryId: where.entry_id };
        await tx`
          UPDATE gym_member_bills b SET fee_kept_at = ${now}, fee_kept_by = ${userId}, updated_at = ${now}
          WHERE b.gym_id = ${gymId} AND b.id = ${where.bill_id} AND b.fee IS NOT NULL AND b.status = 'paid' AND b.fee_kept_at IS NULL
            AND NOT ${stillOwedSql(tx)}`;
      }
    } else if (press.sale_id !== null) {
      const [sale] = await tx<{ item_name: string; entry_id: string | null }[]>`SELECT item_name, entry_id FROM gym_sales WHERE gym_id = ${gymId} AND id = ${press.sale_id}`;
      if (sale !== undefined) about = { product: sale.item_name, ...(sale.entry_id === null ? {} : { entryId: sale.entry_id }) };
    }
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.refund_not_needed",
      targetType: "gym_square_refund",
      targetId: pressId,
      meta: { ...about, amountMinor: String(press.amount_minor), currency: press.currency },
    });
    return "done";
  });
}
