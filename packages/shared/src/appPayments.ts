// PAY WHAT THEY OWE, IN THE APP — ROADMAP Stage 2 item 18k-ii-a (Kd, 2026-11-06; spec Part 3 §14.8). A member pays a
// membership's bill, their own or of somebody they pay for (18i), on Square's own payment page: card, Apple Pay or
// Google Pay, no tip and no coupon. The server makes the page for all that is left on the one bill a payment can be
// taken for now (`memberBillingSchema.pay`), once it is due (paying ahead stays at the desk), and records the payment on that bill only once Square says it is paid,
// for exactly that amount. While a page is open, nothing else is paid, voided or changed on the membership; it closes
// by itself after `APP_PAYMENT_LIMITS.openMinutes`, or sooner when the member leaves it or staff close it, and Square
// is told, so the page can no longer be paid. The phone draws it (Stage 5 item 20).
//
// A FEE (18k-ii-b; Kd, 2026-11-06): a late cancel, no-show, freeze or early cancellation fee owed now is paid the same way,
// all of it, on a page of its own. While its page is open the fee is not taken off: staff marking them came, or the class or
// session not running, closes the page, and the fee comes off once Square says nothing was paid.
import { z } from "zod";
import type { MemberFeeKind } from "./memberBills.js";

export const APP_PAYMENT_LIMITS = {
  /** A page not paid by then is closed. */
  openMinutes: 15,
} as const;

const minorSchema = z.number().int().min(1).max(99_999_999);
/** As `memberBills.ts`'s, which reads this file. */
const receiptNumberSchema = z.number().int().min(1).max(2_147_483_647);

const pressSchema = { requestKey: z.string().uuid(), membershipId: z.string().uuid(), amountMinor: minorSchema };

/** Pay: the membership and the bill the screen showed, and all that was left on it; or one of its fees (18k-ii-b), and its
 *  amount. Never both. The same key sent again is the same press. */
export const appPaymentRequestSchema = z.union([
  z.object({ ...pressSchema, periodIndex: z.number().int().min(0).max(100_000) }).strict(),
  z.object({ ...pressSchema, feeId: z.string().uuid() }).strict(),
]);
export type AppPaymentRequest = z.infer<typeof appPaymentRequestSchema>;

/** `open`: Square's page can be paid; `paid`: on the bill, with its receipt; `closed`: nothing was paid; `check`: Square
 *  took money the bill could not take, or never said how the page ended, so the front desk checks it in Square. */
export const APP_PAYMENT_STATES = ["open", "paid", "closed", "check"] as const;
export const appPaymentStateSchema = z.enum(APP_PAYMENT_STATES);
export type AppPaymentState = z.infer<typeof appPaymentStateSchema>;

export const appPaymentSchema = z
  .object({
    id: z.string().uuid(),
    membershipId: z.string().uuid(),
    /** The bill it pays, or the fee (18k-ii-b): one of the two. */
    periodIndex: z.number().int().min(0).nullable(),
    feeId: z.string().uuid().nullable(),
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

/** A page that ended with money Square may have taken and that is not on the bill, while that bill is still owed: Square
 *  took another amount than asked or the bill could not take it (`taken`, with what Square took where it named it in the
 *  page's money), or Square never said how it ended (`unknown`). `payerName`: the record of whoever opened the page. The
 *  card on file is not charged for that bill by itself while it stands. */
export const appPaymentCheckSchema = z
  .object({ why: z.enum(["taken", "unknown"]), amountMinor: z.number().int().min(0).max(99_999_999).nullable(), on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), payerName: z.string().nullable() })
  .strict();
export type AppPaymentCheck = z.infer<typeof appPaymentCheckSchema>;

/** Close payment page, for staff: closed with nothing paid, paid in the app just before, Square may have taken money that
 *  is not on the bill (`check`), or Square not answering yet. */
export const appPaymentCloseResponseSchema = z.object({ outcome: z.enum(["closed", "paid", "check", "waiting"]) }).strict();
export type AppPaymentCloseResponse = z.infer<typeof appPaymentCloseResponseSchema>;

/** The server's answers, as the member reads them on the phone. */
export const APP_PAYMENT_WORDS = {
  not_offered: "You can't pay in the app here yet. Pay at the front desk.",
  changed: "What you owe has changed. Go back and look again.",
  /** Pay on one bill or fee of a membership while a page for another of its bills or fees is open (18k-ii-b). */
  other_open: "A payment page is already open for this membership. Finish that payment or close it first.",
  not_due: "This bill isn't due yet.",
  at_desk: "The front desk is taking this payment right now. Try again in a few minutes.",
  square_down: "Square isn't answering. Try again in a minute.",
  refused: "Square couldn't open the payment page. Pay at the front desk.",
  not_found: "That payment wasn't found.",
  /** `check`: said on the phone where the page ended that way. */
  check: "We couldn't confirm this payment. The front desk will check it with Square.",
  /** Pay again on a bill or fee whose last page ended `check`: paid at the desk once they have checked. */
  check_first: "We couldn't confirm your last payment for this. Pay at the front desk once they have checked it with Square.",
} as const;

/** What staff read while a member has a page open (`appPaymentOpenSchema`), and after Close payment page. */
export const APP_PAYMENT_STAFF_WORDS = {
  /** The server's refusal of anything else on the membership while a page is open. */
  paying: "This membership is being paid in the app right now. Close the payment page first, or wait until it closes.",
  closed: "Payment page closed. Nothing was paid in the app.",
  paid: "It was paid in the app before the page closed.",
  waiting: "Square isn't answering, so the payment page is still open. Try again in a minute.",
  check: "Square may have taken a payment on this page that isn't on the bill. Check it in Square before taking this payment again.",
  none: "No payment page is open on this membership now.",
  /** Disconnect Square while a member's page is open: it could still be paid, with nothing here to record it. */
  disconnect_open: "A member is paying in the app right now. Disconnect Square once their payment page closes.",
  /** Delete permanently while one of the person's pages is open: what Square took would have no bill to go on. */
  delete_open: "This person is paying in the app right now. Delete them once their payment page closes.",
  /** Void payment on a payment made in the app: Square holds the money. */
  void_app: "This was paid in the app. To give the money back, press Refund on the payment.",
} as const;

/** Close payment page pressed under a fee (18k-ii-b): as `APP_PAYMENT_STAFF_WORDS`, naming the fee. */
export const APP_PAYMENT_FEE_STAFF_WORDS = {
  check: "Square may have taken a payment on this page that isn't on the fee. Check it in Square before taking this payment again.",
} as const;

/** The bill's line while a page is open: "Priya Sharma is paying this in the app. The payment page closes at 10:42 if it
 *  isn't paid.", or the fee's, "…is paying this fee in the app…" (18k-ii-b). `at`: the time, in the gym's words. */
export const appPayingLine = (payerName: string | null, at: string, fee = false): string =>
  `${payerName ?? "The member"} is paying ${fee ? "this fee" : "this"} in the app. The payment page closes at ${at} if it isn't paid.`;

/** The line under the bill, or under the fee (18k-ii-b), for a page that ended needing a check (`appPaymentCheckSchema`).
 *  `money`: what Square took, or null where that is not known; `day`: when; both in the gym's words. Only a bill and a freeze
 *  fee are ever charged to the card on file by the app, so only they say it won't be. */
export const appCheckLine = (check: Pick<AppPaymentCheck, "why" | "payerName">, money: string | null, day: string, fee: MemberFeeKind | null = null): string => {
  const card = fee === null || fee === "freeze" ? " It won't be charged to the card on file automatically." : "";
  return check.why === "taken"
    ? `Square took ${money ?? "a payment"} from ${check.payerName ?? "the member"} in the app on ${day}, but it couldn't go on this ${fee === null ? "bill" : "fee"}. Check it in Square before taking this payment again.${card}`
    : `${check.payerName ?? "The member"}'s payment page in the app ended on ${day} without an answer from Square, so it may have been paid. Check it in Square before taking this payment again.${card}`;
};
