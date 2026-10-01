// Two pure rules for a gym's plan paid through Razorpay (ROADMAP Stage 3 item 1d-ii). No clock,
// no database, no Razorpay: the caller fetched the subscription and its invoices.
//
// Razorpay cannot take a cancel back, and a cancel at the end of the month leaves its record
// exactly as it was: `active`, the next charge still set, nothing scheduled (tried on the test
// account, 2026-10-01). So a cancel is our own record (`cancel_at_period_end`), sent to Razorpay
// in the hours before the paid month ends, and these rules read Razorpay's record against it.
import type { RazorpayInvoice, RazorpaySubscription } from "@app/shared";
import type { LocalStatus } from "./machine.js";

/** Razorpay may charge a little after the moment a month ends; a period end this close to the
 *  one we hold is the same month. */
export const SAME_PERIOD_SLACK_MS = 60_000;

/** Invoices still owed: issued and not (fully) paid. */
export const RAZORPAY_OWED: ReadonlySet<string> = new Set(["issued", "partially_paid"]);

/** Our row of the plan, as the cancel rule needs it. */
export interface CancelRow {
  status: LocalStatus;
  cancelAtPeriodEnd: boolean;
  /** The end of the month the gym has paid for: the plan ends then when it is set to end. */
  currentPeriodEnd: Date | null;
  /** When the plan stopped being the gym's; null while live. */
  endedAt: Date | null;
  /** When the cancel went to Razorpay; for a plan whose payment was overdue, when Cancel was
   *  pressed, as it ends at once. Null until then. */
  cancelSentAt: Date | null;
}

export type CancelOutcome =
  /** No cancel of ours: Razorpay's record is read as it is. */
  | { kind: "none" }
  /** Set to end and the paid month still running: Razorpay's record, still set to end. */
  | { kind: "scheduled" }
  /** Razorpay has ended it for our cancel (a plan not yet charged can only be ended at once),
   *  but the gym paid to `currentPeriodEnd`: it stays the gym's, set to end, until then. */
  | { kind: "keep_live" }
  /** The paid month is over: the plan ends, whatever Razorpay says yet. */
  | { kind: "ended" }
  /** Razorpay took a payment for a month after the plan was to end: it is ended now and every
   *  payment from `after` on is refunded. */
  | { kind: "refund_after"; after: Date };

const LIVE: ReadonlySet<LocalStatus> = new Set(["trialing", "active", "past_due"]);
export const ENDED_AT_RAZORPAY: ReadonlySet<string> = new Set(["cancelled", "completed", "expired"]);

/** What Razorpay's record means for a plan our row holds. */
export function razorpayCancelOutcome(row: CancelRow | null, sub: RazorpaySubscription, askedAt: Date): CancelOutcome {
  if (row === null || !row.cancelAtPeriodEnd) return { kind: "none" };
  if (!LIVE.has(row.status)) {
    // Ended for our cancel: no later payment is the gym's to make, whatever Razorpay says of
    // the plan now (a bill can be paid from its own page after a cancel). The cut is the
    // earliest of the paid month's end, the cancel and the write that ended it: a payment
    // landing between them is still after the plan was to end.
    const after = earliest(row.currentPeriodEnd, row.cancelSentAt, row.endedAt);
    return after === null ? { kind: "none" } : { kind: "refund_after", after };
  }
  // A plan ended at once (its payment overdue) has no paid month left to run.
  if (row.status === "past_due") return { kind: "scheduled" };
  const end = row.currentPeriodEnd;
  if (end === null) return { kind: "scheduled" };
  if (sub.current_end !== null && sub.current_end * 1000 > end.getTime() + SAME_PERIOD_SLACK_MS) {
    return { kind: "refund_after", after: end };
  }
  if (askedAt.getTime() >= end.getTime()) return { kind: "ended" };
  if (ENDED_AT_RAZORPAY.has(sub.status)) return { kind: "keep_live" };
  return { kind: "scheduled" };
}

function earliest(...moments: (Date | null)[]): Date | null {
  let first: Date | null = null;
  for (const m of moments) if (m !== null && (first === null || m.getTime() < first.getTime())) first = m;
  return first;
}

/** Is a bill of this plan still unpaid? A payment that failed leaves its invoice owed, and a
 *  plan whose card was changed after it gave up (`halted`) goes `active` with those invoices
 *  still owed (Razorpay, "Payment Retries"). Paid only on Razorpay's own word: while Razorpay
 *  says a payment failed (`pending`, `halted`), the plan is paid only through the month its
 *  newest invoice, paid, covers (`razorpayPaidThrough`) — a halted plan is not charged again,
 *  so its next month is owed the moment that one ends — and an invoice in a state this code
 *  does not know never reads as paid. */
export function razorpayOwes(sub: RazorpaySubscription, invoices: readonly RazorpayInvoice[], askedAt: Date): boolean {
  const mine = invoices.filter((i) => i.subscription_id === sub.id);
  if (mine.some((i) => RAZORPAY_OWED.has(i.status))) return true;
  if (sub.status !== "pending" && sub.status !== "halted") return false;
  const through = razorpayPaidThrough(sub, mine);
  return through === null || askedAt.getTime() >= through.getTime();
}

/** The end of the month the newest invoice of this plan pays for, when that invoice is paid:
 *  its own billing period, else the plan's current month. Null when the newest is not paid. */
export function razorpayPaidThrough(sub: RazorpaySubscription, invoices: readonly RazorpayInvoice[]): Date | null {
  let newest: RazorpayInvoice | null = null;
  for (const invoice of invoices) {
    if (invoice.subscription_id !== sub.id) continue;
    if (newest === null || invoiceTime(invoice) > invoiceTime(newest)) newest = invoice;
  }
  if (newest?.status !== "paid") return null;
  const end = newest.billing_end ?? sub.current_end;
  return end === null ? null : new Date(end * 1000);
}

/** The oldest bill still owed, which Pay now opens: Razorpay keeps each month's bill, and a
 *  gym pays them in order. Null when nothing is owed. */
export function oldestOwedInvoice(subscriptionId: string, invoices: readonly RazorpayInvoice[]): RazorpayInvoice | null {
  let oldest: RazorpayInvoice | null = null;
  for (const invoice of invoices) {
    if (invoice.subscription_id !== subscriptionId || !RAZORPAY_OWED.has(invoice.status)) continue;
    if (oldest === null || invoiceTime(invoice) < invoiceTime(oldest)) oldest = invoice;
  }
  return oldest;
}

function invoiceTime(invoice: RazorpayInvoice): number {
  return invoice.created_at ?? invoice.paid_at ?? 0;
}
