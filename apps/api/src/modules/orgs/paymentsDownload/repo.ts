// DOWNLOAD PAYMENTS (spec Part 3 §14.3; ROADMAP 18n): the gym's payments, refunds and
// sales on the days asked, a page at a time, and their totals as Reports counts them.
// Every read carries the gym in its WHERE, in each of the four tables.
import type { Sql } from "postgres";
import { z } from "zod";
import { memberPaymentMethodSchema, type PaymentLineRow, type PaymentsTotals } from "@app/shared";

/** How many lines one read takes. */
export const DOWNLOAD_PAGE = 500;

const lineSchema = z.object({
  kind: z.enum(["payment", "refund", "sale", "sale_refund"]),
  day: z.string(),
  receipt: z.number().int(),
  name: z.string().nullable(),
  person_deleted: z.boolean(),
  walk_in: z.boolean(),
  item: z.string(),
  quantity: z.number().int().nullable(),
  covers_from: z.string().nullable(),
  covers_to: z.string().nullable(),
  amount_minor: z.number().int(),
  whole_minor: z.number().int(),
  whole_tax_minor: z.number().int(),
  method: memberPaymentMethodSchema,
  currency: z.string(),
  voided: z.boolean(),
  void_reason: z.string().nullable(),
  for_receipt: z.number().int().nullable(),
  refund_reason: z.string().nullable(),
  refunded_minor: z.coerce.number().int(),
  by: z.string().nullable(),
});

export type LineRow = PaymentLineRow & { currency: string };

/** The four tables as one list of lines, each read for this gym and these days. */
function lines(sql: Sql, gymId: string, from: string, to: string) {
  return sql`
    SELECT 'payment' AS kind, p.paid_on::text AS day, p.receipt_number AS receipt, e.full_name AS name,
           (h.entry_id IS NULL) AS person_deleted, false AS walk_in, t.name AS item, NULL::int AS quantity,
           b.covers_from::text AS covers_from, b.covers_to::text AS covers_to,
           p.amount_minor, b.amount_minor AS whole_minor, b.tax_minor AS whole_tax_minor, p.method, p.currency,
           (p.undone_at IS NOT NULL) AS voided, p.void_reason, NULL::int AS for_receipt, NULL::text AS refund_reason,
           COALESCE((SELECT sum(r.amount_minor) FROM gym_member_refunds r
                     WHERE r.gym_id = p.gym_id AND r.payment_id = p.id AND r.undone_at IS NULL), 0) AS refunded_minor,
           u.display_name AS by
    FROM gym_member_payments p
    JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
    JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
    JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
    LEFT JOIN gym_member_list_entries e ON e.gym_id = h.gym_id AND e.id = h.entry_id
    LEFT JOIN users u ON u.id = p.recorded_by
    WHERE p.gym_id = ${gymId} AND p.paid_on BETWEEN ${from}::date AND ${to}::date
    UNION ALL
    SELECT 'refund', r.refunded_on::text, r.receipt_number, e.full_name,
           (h.entry_id IS NULL), false, t.name, NULL::int,
           b.covers_from::text, b.covers_to::text,
           r.amount_minor, b.amount_minor, b.tax_minor, r.method, r.currency,
           (r.undone_at IS NOT NULL OR p.undone_at IS NOT NULL), r.void_reason, p.receipt_number, r.reason,
           0, u.display_name
    FROM gym_member_refunds r
    JOIN gym_member_payments p ON p.gym_id = r.gym_id AND p.id = r.payment_id
    JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
    JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
    JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
    LEFT JOIN gym_member_list_entries e ON e.gym_id = h.gym_id AND e.id = h.entry_id
    LEFT JOIN users u ON u.id = r.recorded_by
    WHERE r.gym_id = ${gymId} AND r.refunded_on BETWEEN ${from}::date AND ${to}::date
    UNION ALL
    SELECT 'sale', s.sold_on::text, s.receipt_number, e.full_name,
           (s.entry_id IS NULL AND s.for_member), (s.entry_id IS NULL AND NOT s.for_member), s.item_name, s.quantity,
           NULL::text, NULL::text,
           s.total_minor, s.total_minor, s.tax_minor, s.method, s.currency,
           (s.undone_at IS NOT NULL), s.void_reason, NULL::int, NULL::text,
           COALESCE((SELECT sum(f.amount_minor) FROM gym_sale_refunds f
                     WHERE f.gym_id = s.gym_id AND f.sale_id = s.id AND f.undone_at IS NULL), 0),
           u.display_name
    FROM gym_sales s
    LEFT JOIN gym_member_list_entries e ON e.gym_id = s.gym_id AND e.id = s.entry_id
    LEFT JOIN users u ON u.id = s.recorded_by
    WHERE s.gym_id = ${gymId} AND s.sold_on BETWEEN ${from}::date AND ${to}::date
    UNION ALL
    SELECT 'sale_refund', f.refunded_on::text, f.receipt_number, e.full_name,
           (s.entry_id IS NULL AND s.for_member), (s.entry_id IS NULL AND NOT s.for_member), s.item_name, NULL::int,
           NULL::text, NULL::text,
           f.amount_minor, s.total_minor, s.tax_minor, f.method, f.currency,
           (f.undone_at IS NOT NULL OR s.undone_at IS NOT NULL), f.void_reason, s.receipt_number, f.reason,
           0, u.display_name
    FROM gym_sale_refunds f
    JOIN gym_sales s ON s.gym_id = f.gym_id AND s.id = f.sale_id
    LEFT JOIN gym_member_list_entries e ON e.gym_id = s.gym_id AND e.id = s.entry_id
    LEFT JOIN users u ON u.id = f.recorded_by
    WHERE f.gym_id = ${gymId} AND f.refunded_on BETWEEN ${from}::date AND ${to}::date`;
}

/** One page of lines in date order, then receipt order, after the line `after`. */
export async function linesPage(
  sql: Sql,
  gymId: string,
  from: string,
  to: string,
  after: { on: string; receipt: number } | null,
): Promise<LineRow[]> {
  const rows = await sql`
    SELECT * FROM (${lines(sql, gymId, from, to)}) x
    WHERE ${after === null ? sql`true` : sql`(x.day, x.receipt) > (${after.on}::text, ${after.receipt}::int)`}
    ORDER BY x.day, x.receipt
    LIMIT ${DOWNLOAD_PAGE}`;
  return rows.map((raw) => {
    const r = lineSchema.parse(raw);
    return {
      kind: r.kind,
      on: r.day,
      receipt: r.receipt,
      name: r.name,
      personDeleted: r.person_deleted,
      walkIn: r.walk_in,
      item: r.item,
      quantity: r.quantity,
      coversFrom: r.covers_from,
      coversTo: r.covers_to,
      amountMinor: r.amount_minor,
      wholeMinor: r.whole_minor,
      wholeTaxMinor: r.whole_tax_minor,
      method: r.method,
      voided: r.voided,
      voidReason: r.void_reason,
      forReceipt: r.for_receipt,
      refundReason: r.refund_reason,
      refundedMinor: r.refunded_minor,
      by: r.by,
      currency: r.currency,
    };
  });
}

const totalsSchema = z.object({
  currency: z.string(),
  lines: z.coerce.number().int(),
  paid: z.coerce.number().int(),
  sold: z.coerce.number().int(),
  refunded: z.coerce.number().int(),
});

/** Every line on the days, and each currency's totals as Reports' Collected counts them:
 *  what stands, less the refunds that stand on a payment or sale that stands. */
export async function totals(sql: Sql, gymId: string, from: string, to: string): Promise<{ lines: number; totals: PaymentsTotals[] }> {
  const rows = await sql`
    SELECT x.currency, count(*) AS lines,
           COALESCE(sum(x.amount_minor) FILTER (WHERE x.kind = 'payment' AND NOT x.voided), 0) AS paid,
           COALESCE(sum(x.amount_minor) FILTER (WHERE x.kind = 'sale' AND NOT x.voided), 0) AS sold,
           COALESCE(sum(x.amount_minor) FILTER (WHERE x.kind IN ('refund', 'sale_refund') AND NOT x.voided), 0) AS refunded
    FROM (${lines(sql, gymId, from, to)}) x
    GROUP BY x.currency
    ORDER BY x.currency`;
  const parsed = rows.map((raw) => totalsSchema.parse(raw));
  return {
    lines: parsed.reduce((n, r) => n + r.lines, 0),
    totals: parsed.map((r) => ({ currency: r.currency, paidMinor: r.paid, soldMinor: r.sold, refundedMinor: r.refunded, netMinor: r.paid + r.sold - r.refunded })),
  };
}

/** The gym's first day with a payment, refund or sale on it, voided ones too; null for none. */
export async function firstDay(sql: Sql, gymId: string): Promise<string | null> {
  const [row] = await sql<{ first: string | null }[]>`
    SELECT least(
      (SELECT min(paid_on) FROM gym_member_payments WHERE gym_id = ${gymId}),
      (SELECT min(refunded_on) FROM gym_member_refunds WHERE gym_id = ${gymId}),
      (SELECT min(sold_on) FROM gym_sales WHERE gym_id = ${gymId}),
      (SELECT min(refunded_on) FROM gym_sale_refunds WHERE gym_id = ${gymId})
    )::text AS first`;
  return row?.first ?? null;
}
