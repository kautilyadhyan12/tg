// RECEIPTS — Part 3 §14.3; ROADMAP Stage 2 item 18g-i.
//
// Every payment for a membership, every refund noted and every product sale is a receipt
// with the gym's own number: 1, 2, 3, one count across the three, never given twice. A
// receipt is read from the row it is for: what the person paid, what for, the tax, how,
// on which of the gym's days and who took it. A row taken back keeps its number, and its
// receipt says Cancelled. This file is the wire and the sums a receipt prints; the server
// writes nothing here.
import { z } from "zod";
import { memberPaymentByHandSchema, memberPaymentMethodSchema, receiptNumberSchema } from "./memberBills.js";
import { MEMBERSHIP_PRICE_MINOR_MAX } from "./memberships.js";
import { SALE_LINES_MAX, SALE_QUANTITY_MAX } from "./register.js";

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const minorSchema = z.number().int().min(0).max(99_999_999);
const currencySchema = z.string().regex(/^[A-Z]{3}$/);
/** A price before its discount: up to 99 of the dearest thing a gym can sell. */
const listedSchema = z.number().int().min(0).max(SALE_QUANTITY_MAX * MEMBERSHIP_PRICE_MINOR_MAX);

/** The tax a receipt names: the rate's name and percentage as they were, whether the price
 *  held it, and how much it is. `name` is null for a sale made before rates had names. */
const receiptTaxSchema = z
  .object({ name: z.string().nullable(), bp: z.number().int().min(1).max(3000), included: z.boolean(), minor: minorSchema })
  .strict();

/** What was paid for, and what it came to. `listedMinor` is the price before any discount,
 *  and before the tax where the tax is added on top; `totalMinor` is what it came to. */
const receiptAmountsSchema = z
  .object({
    listedMinor: listedSchema,
    discount: z.object({ name: z.string(), minor: listedSchema }).strict().nullable(),
    tax: receiptTaxSchema.nullable(),
    totalMinor: minorSchema,
  })
  .strict();

const receiptCommon = {
  number: receiptNumberSchema,
  gym: z
    .object({
      name: z.string(),
      /** Null where the gym has not typed one: the receipt asks for it. */
      address: z.string().nullable(),
    })
    .strict(),
  /** The gym's own day it was taken, or given back. */
  on: daySchema,
  /** Who it is for, by the name on their record; null for a walk-in, or for somebody whose
   *  record was deleted for good since (`personDeleted`). */
  person: z.string().nullable(),
  personDeleted: z.boolean(),
  /** Who paid for them, where somebody else on the gym's list pays for this person (18i),
   *  by the name that record had when it was paid; '' for a record with no name. On a
   *  refund, who the money went back to. Null where they paid for themselves, and on a
   *  sale, which whoever stood at the desk paid. */
  paidBy: z.string().nullable().default(null),
  /** Somebody else paid, whose record was deleted for good since: "A deleted member". */
  paidByDeleted: z.boolean().default(false),
  /** The member of staff who took it; null where they have since left the app. */
  by: z.string().nullable(),
  currency: currencySchema,
  /** Staff took it back: the number stands, and the receipt says so. */
  cancelled: z.boolean(),
};

/** One product of a sale (18q), with its own discount and tax. */
const saleReceiptLineSchema = z
  .object({ name: z.string(), quantity: z.number().int().min(1).max(SALE_QUANTITY_MAX), unitPriceMinor: minorSchema, amounts: receiptAmountsSchema })
  .strict();

export const saleReceiptSchema = z
  .object({
    ...receiptCommon,
    kind: z.literal("sale"),
    /** Its products, in the order they were rung up (18q). */
    lines: z.array(saleReceiptLineSchema).min(1).max(SALE_LINES_MAX),
    /** What the whole sale came to: its lines' totals added up. */
    totalMinor: minorSchema,
    method: memberPaymentByHandSchema,
    /** The refunds that stand against it, oldest first (18p); `item` names the product given
     *  back for, on a sale of more than one (18q), and is null on a sale of one. */
    refunds: z.array(z.object({ number: receiptNumberSchema, on: daySchema, amountMinor: minorSchema, item: z.string().nullable().default(null) }).strict()).default([]),
  })
  .strict();

export const paymentReceiptSchema = z
  .object({
    ...receiptCommon,
    kind: z.literal("payment"),
    /** The membership, by its type's name, and the days the bill is for (null for a
     *  membership of one period). */
    item: z.object({ name: z.string(), covers: z.object({ from: daySchema, to: daySchema }).strict().nullable() }).strict(),
    /** The bill this payment was for. */
    amounts: receiptAmountsSchema,
    /** The joining fee inside `amounts.listedMinor` (18t): printed as a line of its own. */
    joiningFeeMinor: minorSchema.default(0),
    /** What this payment was. */
    paidMinor: minorSchema,
    method: memberPaymentMethodSchema,
    /** Where the bill was paid in parts: what earlier payments that stand paid, and what
     *  was left after this one. Null where this one payment paid the whole bill. */
    balance: z.object({ paidBeforeMinor: minorSchema, leftMinor: minorSchema }).strict().nullable(),
    /** The refunds that stand against it, oldest first. */
    refunds: z.array(z.object({ number: receiptNumberSchema, on: daySchema, amountMinor: minorSchema }).strict()),
  })
  .strict();

export const refundReceiptSchema = z
  .object({
    ...receiptCommon,
    kind: z.literal("refund"),
    /** The payment, or the sale (18p), the money was given back for. */
    forReceipt: receiptNumberSchema,
    item: z.object({ name: z.string(), covers: z.object({ from: daySchema, to: daySchema }).strict().nullable() }).strict(),
    refundedMinor: minorSchema,
    method: memberPaymentByHandSchema,
  })
  .strict();

export const receiptSchema = z.discriminatedUnion("kind", [saleReceiptSchema, paymentReceiptSchema, refundReceiptSchema]);
export type Receipt = z.infer<typeof receiptSchema>;
export type SaleReceipt = z.infer<typeof saleReceiptSchema>;
export type PaymentReceipt = z.infer<typeof paymentReceiptSchema>;
export type RefundReceipt = z.infer<typeof refundReceiptSchema>;

/** A receipt's number as a path segment: digits only, no leading 0. */
export const receiptParamsSchema = z
  .object({ gymId: z.string().uuid(), number: z.string().regex(/^[1-9][0-9]{0,9}$/) })
  .strict()
  .transform((p) => ({ gymId: p.gymId, number: Number(p.number) }))
  .pipe(z.object({ gymId: z.string().uuid(), number: receiptNumberSchema }).strict());

/** A bill's or a sale's amounts as a receipt prints them. Where the tax is added on top,
 *  the price listed is the total less the tax; where the price holds it, the total. */
export function receiptAmounts(input: {
  totalMinor: number;
  listedMinor?: number;
  tax: { name: string | null; bp: number; included: boolean; minor: number } | null;
  discount: { name: string; minor: number } | null;
}): z.infer<typeof receiptAmountsSchema> {
  const tax = input.tax !== null && input.tax.bp > 0 ? input.tax : null;
  const listedMinor = input.listedMinor ?? (tax !== null && !tax.included ? input.totalMinor - tax.minor : input.totalMinor);
  return { listedMinor, discount: input.discount, tax, totalMinor: input.totalMinor };
}

/** What a payment paid toward its bill, where the bill was paid in parts: null where this
 *  one payment paid all of it. */
export function receiptBalance(billMinor: number, paidBeforeMinor: number, paidMinor: number): { paidBeforeMinor: number; leftMinor: number } | null {
  if (paidBeforeMinor === 0 && paidMinor >= billMinor) return null;
  return { paidBeforeMinor, leftMinor: Math.max(0, billMinor - paidBeforeMinor - paidMinor) };
}

export const RECEIPT_WORDS = {
  receipt_not_found: "That receipt was not found.",
  no_receipts: "Your role doesn't allow you to see payments.",
} as const;
