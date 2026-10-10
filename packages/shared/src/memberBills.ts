// BILLS AND PAYMENTS — Part 3 §14.2; ROADMAP Stage 2 item 18a-i.
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

/** How a payment was made. `link` is the gym's own payment link (18c) and `company` a
 *  connected payment company (18d); staff record the first three by hand. */
export const MEMBER_PAYMENT_METHODS = ["cash", "card_at_desk", "bank_transfer", "link", "company"] as const;
export const memberPaymentMethodSchema = z.enum(MEMBER_PAYMENT_METHODS);
export type MemberPaymentMethod = z.infer<typeof memberPaymentMethodSchema>;

export const MEMBER_PAYMENT_BY_HAND = ["cash", "card_at_desk", "bank_transfer"] as const;
export const memberPaymentByHandSchema = z.enum(MEMBER_PAYMENT_BY_HAND);
export type MemberPaymentByHand = z.infer<typeof memberPaymentByHandSchema>;

export const MEMBER_PAYMENT_METHOD_WORDS: Readonly<Record<MemberPaymentMethod, string>> = {
  cash: "Cash",
  card_at_desk: "Card at the desk",
  bank_transfer: "Bank transfer",
  link: "Payment link",
  company: "Card on file",
};

/** How many days after its due date an unpaid bill reads Overdue: the gym's own number. */
export const BILL_OVERDUE_DAYS_DEFAULT = 0;
export const BILL_OVERDUE_DAYS_MAX = 60;
/** How many of a membership's bills a person's page shows, newest first. */
export const BILLS_SHOWN = 12;

export const MEMBER_BILL_STATES = ["paid", "due", "overdue", "void", "refunded"] as const;
export const memberBillStateSchema = z.enum(MEMBER_BILL_STATES);
export type MemberBillState = z.infer<typeof memberBillStateSchema>;

// ── The wire ────────────────────────────────────────────────────────────────

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const minorSchema = z.number().int().min(0).max(99_999_999);

export const memberPaymentSchema = z
  .object({
    id: z.string().uuid(),
    amountMinor: minorSchema,
    method: memberPaymentMethodSchema,
    /** The gym's own day it was recorded on. */
    paidOn: daySchema,
    /** The member of staff who recorded it; null where they have since left the app. */
    by: z.string().nullable(),
  })
  .strict();
export type MemberPayment = z.infer<typeof memberPaymentSchema>;

export const memberBillSchema = z
  .object({
    id: z.string().uuid(),
    periodIndex: z.number().int().min(0),
    covers: z.object({ from: daySchema, to: daySchema }).strict().nullable(),
    amountMinor: minorSchema,
    paidMinor: minorSchema,
    dueOn: daySchema,
    state: memberBillStateSchema,
    payments: z.array(memberPaymentSchema),
  })
  .strict();
export type MemberBill = z.infer<typeof memberBillSchema>;

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
    undo: z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("payment"), paymentId: z.string().uuid() }).strict(),
        z.object({ kind: z.literal("mark"), paidPeriods: z.number().int().min(0) }).strict(),
      ])
      .nullable(),
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

export const undoMemberPaymentRequestSchema = z.object({ paymentId: z.string().uuid() }).strict();
export type UndoMemberPaymentRequest = z.infer<typeof undoMemberPaymentRequestSchema>;

export const billSettingsSchema = z
  .object({ overdueAfterDays: z.number().int().min(0).max(BILL_OVERDUE_DAYS_MAX) })
  .strict();
export type BillSettings = z.infer<typeof billSettingsSchema>;

/** The settings, and whether this reader may change them. */
export const billSettingsResponseSchema = billSettingsSchema.extend({ canChange: z.boolean() }).strict();
export type BillSettingsResponse = z.infer<typeof billSettingsResponseSchema>;
