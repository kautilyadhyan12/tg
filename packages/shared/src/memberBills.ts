// BILLS AND PAYMENTS — Part 3 §14.2; ROADMAP Stage 2 items 18a-i and 18a-ii.
//
// The gym's notebook: a bill for each period of a held membership that is owed, and
// the payments recorded against it. The app holds nobody's money; a payment here is
// what staff say they were handed. This file is the words and the wire; the rules are
// in `memberBillRules.ts`.
//
// How it sits with `heldMemberships.ts`: `paidPeriods` is still the count of periods
// paid, and the one thing every date is worked out from. A bill is opened for a
// period at or after that count; a payment that settles the bill of period
// `paidPeriods` moves the count on by one, through `moveHeldMembership`. A period
// counted paid with no bill is one the gym's own list said was paid, or one marked
// before bills were kept.
import { z } from "zod";

export const MEMBER_BILL_STATUSES = ["open", "paid", "void", "refunded"] as const;
export const memberBillStatusSchema = z.enum(MEMBER_BILL_STATUSES);
export type MemberBillStatus = z.infer<typeof memberBillStatusSchema>;

/** How a payment was made. `link` is the gym's own payment link (18c), `company` a
 *  connected payment company (18d) and `terminal` a card on the gym's Square Terminal
 *  (18d-vi-a); staff record the first three by hand. */
export const MEMBER_PAYMENT_METHODS = ["cash", "card_at_desk", "bank_transfer", "link", "company", "terminal"] as const;
export const memberPaymentMethodSchema = z.enum(MEMBER_PAYMENT_METHODS);
export type MemberPaymentMethod = z.infer<typeof memberPaymentMethodSchema>;

export const MEMBER_PAYMENT_BY_HAND = ["cash", "card_at_desk", "bank_transfer"] as const;
export const memberPaymentByHandSchema = z.enum(MEMBER_PAYMENT_BY_HAND);
export type MemberPaymentByHand = z.infer<typeof memberPaymentByHandSchema>;

/** How a sale at the desk was paid: by hand, or on the gym's Square Terminal (18d-vi-b-ii). */
export const SALE_PAYMENT_METHODS = [...MEMBER_PAYMENT_BY_HAND, "terminal"] as const;
export const salePaymentMethodSchema = z.enum(SALE_PAYMENT_METHODS);
export type SalePaymentMethod = z.infer<typeof salePaymentMethodSchema>;

export const MEMBER_PAYMENT_METHOD_WORDS: Readonly<Record<MemberPaymentMethod, string>> = {
  cash: "Cash",
  card_at_desk: "Card at the desk",
  bank_transfer: "Bank transfer",
  link: "Payment link",
  company: "Card on file",
  terminal: "Card on Terminal",
};

/** Why staff cancelled a bill: picked, never typed, so no sentence about a person is kept. */
export const BILL_CANCEL_REASONS = ["mistake", "not_charging", "other"] as const;
export const billCancelReasonSchema = z.enum(BILL_CANCEL_REASONS);
export type BillCancelReason = z.infer<typeof billCancelReasonSchema>;

export const BILL_CANCEL_REASON_WORDS: Readonly<Record<BillCancelReason, string>> = {
  mistake: "Billed by mistake",
  not_charging: "Not charging for this one",
  other: "Something else",
};

/** Why money was given back: picked, as above. */
export const REFUND_REASONS = ["paid_twice", "charged_too_much", "leaving", "other"] as const;
export const refundReasonSchema = z.enum(REFUND_REASONS);
export type RefundReason = z.infer<typeof refundReasonSchema>;

export const REFUND_REASON_WORDS: Readonly<Record<RefundReason, string>> = {
  paid_twice: "Paid twice",
  charged_too_much: "Charged too much",
  leaving: "Leaving or cancelled",
  other: "Something else",
};

/** Why staff voided a payment (18o): picked, never typed. */
export const PAYMENT_VOID_REASONS = ["mistake", "wrong_amount", "wrong_person", "other"] as const;
export const paymentVoidReasonSchema = z.enum(PAYMENT_VOID_REASONS);
export type PaymentVoidReason = z.infer<typeof paymentVoidReasonSchema>;

export const PAYMENT_VOID_REASON_WORDS: Readonly<Record<PaymentVoidReason, string>> = {
  mistake: "Recorded by mistake",
  wrong_amount: "Wrong amount",
  wrong_person: "Wrong person",
  other: "Something else",
};

/** Why staff voided a refund (18o): picked, as above. */
export const REFUND_VOID_REASONS = ["mistake", "wrong_amount", "other"] as const;
export const refundVoidReasonSchema = z.enum(REFUND_VOID_REASONS);
export type RefundVoidReason = z.infer<typeof refundVoidReasonSchema>;

export const REFUND_VOID_REASON_WORDS: Readonly<Record<RefundVoidReason, string>> = {
  mistake: "Noted by mistake",
  wrong_amount: "Wrong amount",
  other: "Something else",
};

/** A fee for a late cancel or a no-show (18h-i): a bill of the membership the booking
 *  used, of no period. It is the amount the gym set, its tax in, and it moves no date. */
export const MEMBER_FEES = ["late_cancel", "no_show"] as const;
export const memberFeeKindSchema = z.enum(MEMBER_FEES);
export type MemberFeeKind = z.infer<typeof memberFeeKindSchema>;

export const MEMBER_FEE_WORDS: Readonly<Record<MemberFeeKind, string>> = {
  late_cancel: "Late cancel fee",
  no_show: "No-show fee",
};

/** What a fee is called on a receipt, in a download and in the day's takings. */
export function feeItemName(fee: MemberFeeKind, forName: string): string {
  return `${MEMBER_FEE_WORDS[fee]} · ${forName}`;
}

/** How many days after its due date an unpaid bill reads Overdue: the gym's own number. */
export const BILL_OVERDUE_DAYS_DEFAULT = 0;
export const BILL_OVERDUE_DAYS_MAX = 60;
/** How many of a membership's bills a person's page shows, newest first. */
export const BILLS_SHOWN = 12;

export const MEMBER_BILL_STATES = ["paid", "due", "overdue", "void", "refunded"] as const;
export const memberBillStateSchema = z.enum(MEMBER_BILL_STATES);
export type MemberBillState = z.infer<typeof memberBillStateSchema>;

// ── The wire ────────────────────────────────────────────────────────────────

/** A receipt's number: the gym's own count of its payments, refunds and sales (18g-i). */
export const receiptNumberSchema = z.number().int().min(1).max(2_147_483_647);

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const minorSchema = z.number().int().min(0).max(99_999_999);

/** A refund staff noted against a payment: the gym gave the money back itself, and this
 *  is its note of that. The app moves no money. */
export const memberRefundSchema = z
  .object({
    id: z.string().uuid(),
    amountMinor: minorSchema,
    /** How the gym gave it back. */
    method: memberPaymentByHandSchema,
    /** The gym's own day it was noted on. */
    refundedOn: daySchema,
    reason: refundReasonSchema,
    by: z.string().nullable(),
    /** Its receipt's number, the gym's own (18g-i). */
    receiptNumber: receiptNumberSchema,
  })
  .strict();
export type MemberRefund = z.infer<typeof memberRefundSchema>;

/** Who voided a row, on the gym's own day, and why; the reason is null for one voided
 *  before reasons were kept, `by` where that member of staff has since left the app. */
const voidedBy = <T extends z.ZodTypeAny>(reason: T) => z.object({ reason: reason.nullable(), on: daySchema, by: z.string().nullable() }).strict();

/** A refund staff voided (18o): kept on the page, struck through, and counted in nothing. */
export const voidedMemberRefundSchema = memberRefundSchema.extend({ voided: voidedBy(refundVoidReasonSchema) }).strict();
export type VoidedMemberRefund = z.infer<typeof voidedMemberRefundSchema>;

export const memberPaymentSchema = z
  .object({
    id: z.string().uuid(),
    amountMinor: minorSchema,
    method: memberPaymentMethodSchema,
    /** The gym's own day it was recorded on. */
    paidOn: daySchema,
    /** The member of staff who recorded it; null where they have since left the app. */
    by: z.string().nullable(),
    /** The refunds that stand against it, oldest first. */
    refunds: z.array(memberRefundSchema),
    /** The refunds against it that staff voided, oldest first: counted in nothing. */
    voidedRefunds: z.array(voidedMemberRefundSchema),
    /** What a refund can still be noted for; 0 where none can (`refundMemberPayment`). */
    refundableMinor: minorSchema,
    /** Its receipt's number, the gym's own (18g-i). */
    receiptNumber: receiptNumberSchema,
  })
  .strict();
export type MemberPayment = z.infer<typeof memberPaymentSchema>;

/** A payment staff voided (18o): kept on the page, struck through, and counted in nothing.
 *  A payment is voided only once no refund stands on it, so it carries voided ones alone. */
export const voidedMemberPaymentSchema = memberPaymentSchema
  .omit({ refunds: true, refundableMinor: true })
  .extend({ voided: voidedBy(paymentVoidReasonSchema) })
  .strict();
export type VoidedMemberPayment = z.infer<typeof voidedMemberPaymentSchema>;

export const memberBillSchema = z
  .object({
    id: z.string().uuid(),
    periodIndex: z.number().int().min(0),
    covers: z.object({ from: daySchema, to: daySchema }).strict().nullable(),
    /** What the person pays for it, its tax in. */
    amountMinor: minorSchema,
    /** The tax in `amountMinor` (18b-iii), as the bill was opened: the rate's name and
     *  percentage then, whether the price held it, and how much it is. Null for none. */
    tax: z
      .object({ name: z.string(), bp: z.number().int().min(1).max(3000), included: z.boolean(), minor: minorSchema })
      .strict()
      .nullable(),
    /** The joining fee in `amountMinor`, before any tax added on top (18t): on the bill the
     *  membership was given with; 0 on every other. */
    joiningFeeMinor: minorSchema.default(0),
    /** A change's credit taken off it, before tax (18x): what the membership it replaced had
     *  paid for the days not yet used. Not inside `amountMinor`; 0 on every other bill. */
    changeCreditMinor: minorSchema.default(0),
    /** The money on it whose days a change moved to the membership that replaced this one (18x):
     *  never refunded from this bill. 0 on every other bill. */
    movedMinor: minorSchema.default(0),
    paidMinor: minorSchema,
    dueOn: daySchema,
    state: memberBillStateSchema,
    /** The refunds that stand against its payments, added up. */
    refundedMinor: minorSchema,
    /** Who cancelled it and why, where staff did; null for one cancelled with its
     *  membership, and for every bill that is not cancelled. */
    cancelled: z.object({ reason: billCancelReasonSchema, on: daySchema, by: z.string().nullable() }).strict().nullable(),
    /** What a member's Refer a friend gift took off it, before tax (20e-ii-b-ii-a); null for none. */
    gift: z
      .object({ offMinor: minorSchema, currency: z.string().regex(/^[A-Z]{3}$/), friendName: z.string().min(1).nullable().default(null) })
      .strict()
      .nullable()
      .default(null),
    payments: z.array(memberPaymentSchema),
    /** The payments on it that staff voided, in the order they were recorded. */
    voidedPayments: z.array(voidedMemberPaymentSchema),
  })
  .strict();
export type MemberBill = z.infer<typeof memberBillSchema>;

/** Where a fee stands: owed (due or overdue), paid, waived by staff, or taken off once its
 *  payment was voided after the booking stopped counting (marked came, or the class did not
 *  run). An unpaid fee taken off by itself, with no payment ever, is not sent. */
export const MEMBER_FEE_STATES = ["due", "overdue", "paid", "waived", "removed"] as const;
export type MemberFeeState = (typeof MEMBER_FEE_STATES)[number];

/** One fee of a membership, and what staff can do about it now. */
export const memberFeeSchema = z
  .object({
    id: z.string().uuid(),
    fee: memberFeeKindSchema,
    /** A class's fee, or a personal training session's (18h-ii). */
    of: z.enum(["class", "pt"]).default("class"),
    /** The class it was for, as it was named then, or "Personal training with Ravi", and its day. */
    forName: z.string().min(1),
    on: daySchema,
    amountMinor: minorSchema,
    tax: z
      .object({ name: z.string(), bp: z.number().int().min(1).max(3000), included: z.boolean(), minor: minorSchema })
      .strict()
      .nullable(),
    dueOn: daySchema,
    state: z.enum(MEMBER_FEE_STATES),
    /** Who waived it, on the gym's own day; null where it was not waived. */
    waived: z.object({ on: daySchema, by: z.string().nullable() }).strict().nullable(),
    /** Its booking still counts as the late cancel or no-show it was opened for. False once
     *  staff marked them came, the class was cancelled, or the session is gone: a fee paid before that stays paid,
     *  and voiding its payment takes the fee off instead of making it owed again. */
    stillOwed: z.boolean().default(true),
    payments: z.array(memberPaymentSchema),
    voidedPayments: z.array(voidedMemberPaymentSchema),
    can: z
      .object({
        pay: z.boolean(),
        waive: z.boolean(),
        /** The payment that can be voided: the one that paid it. */
        voidPaymentId: z.string().uuid().nullable(),
      })
      .strict(),
  })
  .strict();
export type MemberFee = z.infer<typeof memberFeeSchema>;

/** A membership's bills and what staff can do about them, for a reader who holds the
 *  `billing.members` tick. `pay` is the one period a payment can be taken for; `undo`
 *  the one payment, or the one older mark with no payment behind it, that can be taken
 *  back. */
export const memberBillingSchema = z
  .object({
    bills: z.array(memberBillSchema),
    billsNotShown: z.number().int().min(0),
    pay: z
      .object({
        periodIndex: z.number().int().min(0),
        /** The days that period covers; null for a membership of one period. */
        covers: z.object({ from: daySchema, to: daySchema }).strict().nullable(),
        leftMinor: minorSchema,
        dueOn: daySchema,
        state: z.enum(["due", "overdue"]),
      })
      .strict()
      .nullable(),
    /** The one bill staff can cancel now: the bill `pay` is for, where it is open with
     *  nothing paid on it. */
    cancel: z.object({ billId: z.string().uuid() }).strict().nullable(),
    undo: z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("payment"), paymentId: z.string().uuid() }).strict(),
        z.object({ kind: z.literal("mark"), paidPeriods: z.number().int().min(0) }).strict(),
      ])
      .nullable(),
    /** Its late cancel and no-show fees, newest first (18h-i). */
    fees: z.array(memberFeeSchema).default([]),
    /** Change membership (18x, `changeFrom`): what a change today takes off its first bill and
     *  the first day of a change on the next payment date, or why it cannot be changed. Null
     *  for one that is over. */
    change: z
      .discriminatedUnion("ok", [
        z.object({ ok: z.literal(true), creditMinor: minorSchema, daysLeft: z.number().int().min(0), nextOn: daySchema.nullable() }).strict(),
        z.object({ ok: z.literal(false), reason: z.enum(["not_changeable", "frozen", "not_started", "unpaid", "changed_already"]) }).strict(),
      ])
      .nullable()
      .default(null),
  })
  .strict();
export type MemberBilling = z.infer<typeof memberBillingSchema>;

/** `requestKey` is made by the screen once a form: the same key twice is one payment.
 *  `periodIndex` is the period the screen was shown; a payment for any other is refused. */
export const recordMemberPaymentRequestSchema = z
  .object({
    requestKey: z.string().uuid(),
    periodIndex: z.number().int().min(0).max(100_000),
    amountMinor: z.number().int().min(1).max(99_999_999),
    method: memberPaymentByHandSchema,
  })
  .strict();
export type RecordMemberPaymentRequest = z.infer<typeof recordMemberPaymentRequestSchema>;

/** A fee is paid all at once: `amountMinor` is what the screen showed, refused where the
 *  fee is no longer that. */
export const recordMemberFeePaymentRequestSchema = z
  .object({
    requestKey: z.string().uuid(),
    amountMinor: z.number().int().min(1).max(99_999_999),
    method: memberPaymentByHandSchema,
  })
  .strict();
export type RecordMemberFeePaymentRequest = z.infer<typeof recordMemberFeePaymentRequestSchema>;

export const waiveMemberFeeRequestSchema = z.object({}).strict();

export const voidMemberPaymentRequestSchema = z.object({ reason: paymentVoidReasonSchema }).strict();
export type VoidMemberPaymentRequest = z.infer<typeof voidMemberPaymentRequestSchema>;

export const voidMemberRefundRequestSchema = z.object({ reason: refundVoidReasonSchema }).strict();
export type VoidMemberRefundRequest = z.infer<typeof voidMemberRefundRequestSchema>;

export const cancelMemberBillRequestSchema = z.object({ reason: billCancelReasonSchema }).strict();
export type CancelMemberBillRequest = z.infer<typeof cancelMemberBillRequestSchema>;

/** `requestKey` is made by the screen once a form: the same key twice is one refund. */
export const noteMemberRefundRequestSchema = z
  .object({
    requestKey: z.string().uuid(),
    amountMinor: z.number().int().min(1).max(99_999_999),
    method: memberPaymentByHandSchema,
    reason: refundReasonSchema,
  })
  .strict();
export type NoteMemberRefundRequest = z.infer<typeof noteMemberRefundRequestSchema>;

export const billSettingsSchema = z
  .object({ overdueAfterDays: z.number().int().min(0).max(BILL_OVERDUE_DAYS_MAX) })
  .strict();
export type BillSettings = z.infer<typeof billSettingsSchema>;

/** The settings, and whether this reader may change them. */
export const billSettingsResponseSchema = billSettingsSchema.extend({ canChange: z.boolean() }).strict();
export type BillSettingsResponse = z.infer<typeof billSettingsResponseSchema>;
