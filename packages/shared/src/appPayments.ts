// PAY WHAT THEY OWE, IN THE APP — ROADMAP Stage 2 item 18k-ii-a (Kd, 2026-11-06; spec Part 3 §14.8). A member pays a
// membership's bill, their own or of somebody they pay for (18i), on Square's own payment page: card, Apple Pay or
// Google Pay, no tip and no coupon. The server makes the page for all that is left on the one bill a payment can be
// taken for now (`memberBillingSchema.pay`), and records the payment on that bill only once Square says it is paid,
// for exactly that amount. While a page is open, nothing else is paid, voided or changed on the membership; it closes
// by itself after `APP_PAYMENT_LIMITS.openMinutes`, or sooner when the member leaves it or staff close it, and Square
// is told, so the page can no longer be paid. The phone draws it (Stage 5 item 20).
import { z } from "zod";

export const APP_PAYMENT_LIMITS = {
  /** A page not paid by then is closed. */
  openMinutes: 15,
} as const;

const minorSchema = z.number().int().min(1).max(99_999_999);
/** As `memberBills.ts`'s, which reads this file. */
const receiptNumberSchema = z.number().int().min(1).max(2_147_483_647);

/** Pay: the membership and the bill the screen showed, and all that was left on it. The same key sent again is the same
 *  press. */
export const appPaymentRequestSchema = z
  .object({
    requestKey: z.string().uuid(),
    membershipId: z.string().uuid(),
    periodIndex: z.number().int().min(0).max(100_000),
    amountMinor: minorSchema,
  })
  .strict();
export type AppPaymentRequest = z.infer<typeof appPaymentRequestSchema>;

/** `open`: Square's page can be paid; `paid`: on the bill, with its receipt; `closed`: nothing was paid; `not_recorded`:
 *  Square took money the bill could not take, which the gym has to check in Square. */
export const APP_PAYMENT_STATES = ["open", "paid", "closed", "not_recorded"] as const;
export const appPaymentStateSchema = z.enum(APP_PAYMENT_STATES);
export type AppPaymentState = z.infer<typeof appPaymentStateSchema>;

export const appPaymentSchema = z
  .object({
    id: z.string().uuid(),
    membershipId: z.string().uuid(),
    periodIndex: z.number().int().min(0),
    amountMinor: minorSchema,
    currency: z.string().regex(/^[A-Z]{3}$/),
    state: appPaymentStateSchema,
    /** Square's own page, while it is open. */
    url: z.string().url().nullable(),
    /** When the app closes it if it is not paid; null once it is not open. */
    closesAt: z.string().datetime().nullable(),
    /** The payment's receipt, once it is on the bill. */
    receiptNumber: receiptNumberSchema.nullable(),
  })
  .strict();
export type AppPayment = z.infer<typeof appPaymentSchema>;

export const appPaymentResponseSchema = z.object({ payment: appPaymentSchema }).strict();
export type AppPaymentResponse = z.infer<typeof appPaymentResponseSchema>;

/** For the phone's My membership: whether this gym takes payments in the app now, and the reader's pages still open. */
export const myAppPaymentsResponseSchema = z.object({ inApp: z.boolean(), open: z.array(appPaymentSchema) }).strict();
export type MyAppPaymentsResponse = z.infer<typeof myAppPaymentsResponseSchema>;

/** A page open on a membership, for staff on the person's page: who is paying (the payer's name where somebody else
 *  pays), and when it closes. */
export const appPaymentOpenSchema = z
  .object({ id: z.string().uuid(), payerName: z.string().nullable(), closesAt: z.string().datetime() })
  .strict();
export type AppPaymentOpen = z.infer<typeof appPaymentOpenSchema>;

/** Close payment page, for staff: closed with nothing paid, paid in the app just before, or Square not answering yet. */
export const appPaymentCloseResponseSchema = z.object({ outcome: z.enum(["closed", "paid", "waiting"]) }).strict();
export type AppPaymentCloseResponse = z.infer<typeof appPaymentCloseResponseSchema>;

/** The server's answers, as the member reads them on the phone. */
export const APP_PAYMENT_WORDS = {
  not_offered: "You can't pay in the app here yet. Pay at the front desk.",
  changed: "What you owe has changed. Go back and look again.",
  at_desk: "The front desk is taking this payment right now. Try again in a few minutes.",
  square_down: "Square isn't answering. Try again in a minute.",
  refused: "Square couldn't open the payment page. Pay at the front desk.",
  not_found: "That payment wasn't found.",
} as const;

/** What staff read while a member has a page open (`appPaymentOpenSchema`), and after Close payment page. */
export const APP_PAYMENT_STAFF_WORDS = {
  /** The server's refusal of anything else on the membership while a page is open. */
  paying: "This membership is being paid in the app right now. Close the payment page under its bill first, or wait until it closes.",
  closed: "Payment page closed. Nothing was paid in the app.",
  paid: "It was paid in the app before the page closed.",
  waiting: "Square isn't answering, so the payment page is still open. Try again in a minute.",
  none: "No payment page is open on this membership now.",
  /** Disconnect Square while a member's page is open: it could still be paid, with nothing here to record it. */
  disconnect_open: "A member is paying in the app right now. Disconnect Square once their payment page closes, within 15 minutes.",
  /** Void payment on a payment made in the app: Square holds the money. */
  void_app: "This was paid in the app. To give the money back, press Refund on the payment.",
} as const;

/** The bill's line while a page is open: "Priya Sharma is paying this in the app. The payment page closes at 10:42 if it
 *  isn't paid." `at`: the time, in the gym's words. */
export const appPayingLine = (payerName: string | null, at: string): string =>
  `${payerName ?? "The member"} is paying this in the app. The payment page closes at ${at} if it isn't paid.`;
