// A SALE'S REFUNDS — Part 3 §14.3; ROADMAP Stage 2 item 18p.
//
// Money given back for a product sale at the desk, on its own day or any later one, as Square
// and Mindbody do: all of it or part, how it went back, why, and how many of what was sold went
// back on the shelf. The sale stays; each refund is a row of its own with its own receipt
// number. The app moves no money: the gym gives it back itself and this is its note. A refund
// noted by mistake is voided, as a membership's is (18o).
import { z } from "zod";
import { memberPaymentByHandSchema, receiptNumberSchema, refundVoidReasonSchema } from "./memberBills.js";

/** Why money was given back for a sale: picked, never typed. */
export const SALE_REFUND_REASONS = ["returned", "charged_too_much", "faulty", "other"] as const;
export const saleRefundReasonSchema = z.enum(SALE_REFUND_REASONS);
export type SaleRefundReason = z.infer<typeof saleRefundReasonSchema>;

export const SALE_REFUND_REASON_WORDS: Readonly<Record<SaleRefundReason, string>> = {
  returned: "Brought back",
  charged_too_much: "Charged too much",
  faulty: "Faulty or damaged",
  other: "Something else",
};

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const minorSchema = z.number().int().min(0).max(99_999_999);

/** One refund of a sale, as a screen reads it. */
export const saleRefundSchema = z
  .object({
    id: z.string().uuid(),
    amountMinor: minorSchema,
    /** How the gym gave it back. */
    method: memberPaymentByHandSchema,
    reason: saleRefundReasonSchema,
    /** How many of what was sold went back on the shelf with it. */
    restocked: z.number().int().min(0).max(99),
    /** The gym's own day it was noted on. */
    refundedOn: daySchema,
    /** The member of staff who noted it; null where they have since left the app. */
    by: z.string().nullable(),
    receiptNumber: receiptNumberSchema,
    /** Who voided it, on the gym's own day, and why; null while it stands. */
    voided: z.object({ reason: refundVoidReasonSchema, on: daySchema, by: z.string().nullable() }).strict().nullable(),
  })
  .strict();
export type SaleRefund = z.infer<typeof saleRefundSchema>;

/** Refund sale. `requestKey` is made by the screen once a box: the same key twice is one
 *  refund. `restock` is how many go back on the shelf: 0 for none. */
export const refundSaleRequestSchema = z
  .object({
    requestKey: z.string().uuid(),
    amountMinor: z.number().int().min(1).max(99_999_999),
    method: memberPaymentByHandSchema,
    reason: saleRefundReasonSchema,
    restock: z.number().int().min(0).max(99),
  })
  .strict();
export type RefundSaleRequest = z.infer<typeof refundSaleRequestSchema>;

export const refundSaleResponseSchema = z.object({ receiptNumber: receiptNumberSchema }).strict();
export type RefundSaleResponse = z.infer<typeof refundSaleResponseSchema>;

export const voidSaleRefundRequestSchema = z.object({ reason: refundVoidReasonSchema }).strict();
export type VoidSaleRefundRequest = z.infer<typeof voidSaleRefundRequestSchema>;

export const voidSaleRefundResponseSchema = z.object({ voided: z.literal(true) }).strict();
export type VoidSaleRefundResponse = z.infer<typeof voidSaleRefundResponseSchema>;

export type SaleRefundCheck =
  | { ok: true; refundedInFull: boolean }
  /** The sale was voided: it counts in nothing, so nothing can be given back for it. */
  | { ok: false; reason: "voided" }
  | { ok: false; reason: "not_an_amount" }
  /** More than is left of what was paid. */
  | { ok: false; reason: "too_much"; leftMinor: number }
  /** More back on the shelf than were sold and not yet put back. */
  | { ok: false; reason: "too_many_back"; leftCount: number }
  /** Some back on the shelf of a sale whose product's stock was not counted. */
  | { ok: false; reason: "not_counted" };

/** ONE REFUND OF A SALE. Together the refunds that stand never give back more than the sale
 *  took, and never put more back on the shelf than it sold, so a gym's takings never read
 *  less than nothing for a sale and its stock count never grows from one. `refundedMinor` and
 *  `restocked` are what the refunds that stand already hold. */
export function refundSale(
  sale: { totalMinor: number; quantity: number; voided: boolean; refundedMinor: number; restocked: number; stockCounted: boolean },
  ask: { amountMinor: number; restock: number },
): SaleRefundCheck {
  if (sale.voided) return { ok: false, reason: "voided" };
  if (!Number.isSafeInteger(ask.amountMinor) || ask.amountMinor <= 0) return { ok: false, reason: "not_an_amount" };
  const leftMinor = Math.max(0, sale.totalMinor - sale.refundedMinor);
  if (ask.amountMinor > leftMinor) return { ok: false, reason: "too_much", leftMinor };
  if (!sale.stockCounted && ask.restock !== 0) return { ok: false, reason: "not_counted" };
  const leftCount = Math.max(0, sale.quantity - sale.restocked);
  if (!Number.isSafeInteger(ask.restock) || ask.restock < 0 || ask.restock > leftCount) return { ok: false, reason: "too_many_back", leftCount };
  return { ok: true, refundedInFull: sale.refundedMinor + ask.amountMinor >= sale.totalMinor };
}

/** What the server says when a refund is refused, one place for the routes and the screen. */
export const SALE_REFUND_WORDS = {
  voided: "That sale was voided, so nothing can be given back for it.",
  refund_not_found: "That refund was not found.",
  request_reused: "That form was already used for another refund. Nothing was noted: start again.",
  has_refund: "Money was given back for this sale. Void that refund first, then void the sale.",
  day_ahead: "That day hasn't come yet. Pick today or an earlier day.",
  not_counted: "This product's stock isn't counted, so nothing goes back on the shelf. Nothing was noted.",
} as const;

/** More than is left of the sale: what is left, in its own money's words, made by the caller. */
export function saleRefundTooMuchWords(left: string, nothingLeft: boolean): string {
  return nothingLeft ? "All of that sale has already been refunded." : `Only ${left} of that sale is left to refund. Nothing was noted.`;
}

/** More back on the shelf than were sold and not put back already. */
export function saleRestockTooManyWords(leftCount: number): string {
  return leftCount === 0
    ? "Everything sold has already gone back on the shelf. Choose none, then note the refund."
    : `Only ${String(leftCount)} can go back on the shelf for this sale. Nothing was noted.`;
}
