// RAISE THE PRICE FOR MEMBERS ALREADY ON A LINE (ROADMAP 18w; Kd, 2026-10-22 and 2026-11-06,
// `rulings/2026-11-06-18w.md`). Staff raise a repeating line's price and tick who already on it pays the new price
// too. Each ticked membership goes up from its first payment at least so many days away, after any minimum term,
// and whoever pays for it is emailed that many days before that payment.
//
// THE WORST THING here is charging somebody more than they agreed to: before their email has gone, inside their
// minimum term, or on a membership nobody ticked. So a raise is charged ONLY from the period its email named, and
// that period is written only once the email has gone (`fromPeriod`). `priceRaiseNext` says which period that
// will be and when the email goes, from the membership as its page reads it; `raisedListedMinor` is the one place
// a period's price is read with a raise. Both are pure.
import { z } from "zod";
import { addDays, heldMembershipView, periodIndex, periodStart, type HeldMembership, type HeldMembershipView } from "./heldMemberships.js";
import type { MembershipPayments } from "./discounts.js";
import { formatMinor, MEMBERSHIP_PRICE_MINOR_MAX, priceRaiseNoticeDaysSchema, priceRaiseStatusSchema } from "./memberships.js";
import { dayWords } from "./paymentsDownload.js";

/** Why a membership is not raised now: it will not renew past where a raise could start, or it is frozen and its
 *  dates move until it is back. */
export type PriceRaiseNone = "not_renewing" | "frozen";

export interface PriceRaiseNextOne {
  /** The first period at the new price. */
  fromPeriod: number;
  /** That period's first day: the payment the email names. */
  fromOn: string;
  /** The first gym day the email may go. On or after it, it is due. */
  sendOn: string;
}

export type PriceRaisePlan = { kind: "next"; next: PriceRaiseNextOne } | { kind: "none"; reason: PriceRaiseNone };

/** The most periods looked through for the first one far enough away: a daily line with 30 days' notice. */
const PERIODS_LOOKED = 400;

/** THE RULE: the first payment at the new price for this membership on `today` (the gym's day), with `noticeDays`
 *  of notice, and the day its email goes; or why there is none. Never the period running today, never one paid for
 *  or billed already (`billedTo`, the highest period with a bill, -1 for none), never inside a minimum term, never
 *  the first payment, and never past its last day. While the email waits, the answer is the same each day until
 *  `sendOn`; an email sent later moves it to a later period, so the notice is always whole. */
export function priceRaiseNext(m: HeldMembership, noticeDays: number, today: string, billedTo: number, viewed?: HeldMembershipView): PriceRaisePlan {
  const view = viewed ?? heldMembershipView(m, today);
  if (m.kind !== "recurring" || m.free || !m.renews || view.status === "ended" || view.status === "cancelled") return { kind: "none", reason: "not_renewing" };
  if (view.status === "frozen") return { kind: "none", reason: "frozen" };

  const earliest = addDays(today, noticeDays);
  let index = Math.max(m.paidPeriods, billedTo + 1, periodIndex(m, today) + 1, 1);
  // A minimum term keeps the price it was sold at: the first period after it.
  if (view.contract !== null) index = Math.max(index, periodIndex(m, addDays(view.contract.until, 1)));
  for (let looked = 0; looked < PERIODS_LOOKED && periodStart(m, index) < earliest; looked++) index++;
  const fromOn = periodStart(m, index);
  if (fromOn < earliest) return { kind: "none", reason: "not_renewing" };
  // A last day before it (notice given, a term that ends it) means there is no payment to raise.
  if (view.endsOn !== null && fromOn > view.endsOn) return { kind: "none", reason: "not_renewing" };
  return { kind: "next", next: { fromPeriod: index, fromOn, sendOn: addDays(fromOn, -noticeDays) } };
}

/** Is the email due on `today`? */
export function priceRaiseDue(plan: PriceRaisePlan, today: string): plan is { kind: "next"; next: PriceRaiseNextOne } {
  return plan.kind === "next" && today >= plan.next.sendOn;
}

/** A raise whose email has gone: its price, from the period the email named. */
export interface PriceRaiseCharged {
  priceMinor: number;
  /** Null until the email has gone: then nothing is charged at it. */
  fromPeriod: number | null;
}

/** THE ONE PLACE a period's price is read with a raise: the raise's price from the period its email named, the
 *  membership's own before it, and its own everywhere while no email has gone. */
export function raisedListedMinor(ownMinor: number, raise: PriceRaiseCharged | null, index: number): number {
  return raise !== null && raise.fromPeriod !== null && index >= raise.fromPeriod ? raise.priceMinor : ownMinor;
}

/** Has the raise started: is the period running `today` (the day a frozen one stands still at) at or past the one its
 *  email named? Read by period, as the bills are: a freeze or free days after the email move that payment later, and
 *  the price it is paying moves with it (round one, H1). */
export function raiseStarted(m: HeldMembership, raise: PriceRaiseCharged | null, today: string): boolean {
  if (raise === null || raise.fromPeriod === null || m.kind !== "recurring") return false;
  const asOf = m.status === "frozen" && m.frozenOn !== null ? m.frozenOn : today;
  return periodIndex(m, asOf) >= raise.fromPeriod;
}

/** What a membership's own price becomes at the line's new price: a discount taken off every payment still comes
 *  off it (its own price is already the price after it); one off the first payment alone has been used. */
export function raisedOwnPriceMinor(lineMinor: number, discount: { offMinor: number; payments: MembershipPayments } | null): number {
  return discount !== null && discount.payments === "every" ? Math.max(lineMinor - discount.offMinor, 0) : lineMinor;
}

// ── THE EMAIL'S WORDS ──

export interface PriceRaiseWordsInput {
  gymName: string;
  /** The membership's line, "Gold Monthly". */
  typeName: string;
  /** Whose membership, where whoever is emailed pays for somebody else: their name. Null for their own. */
  forName: string | null;
  /** One payment now and at the new price, tax in. */
  fromMinor: number;
  toMinor: number;
  currency: string;
  /** "month", "3 months": how often it is paid. */
  every: string;
  /** The first payment at the new price. */
  startsOn: string;
  /** Its notice to cancel in days, and the last day if they gave notice today; null for none. */
  notice: { days: number; lastDay: string } | null;
}

export interface PriceRaiseWords {
  subject: string;
  lines: string[];
}

/** The email, as the person reads it. */
export function priceRaiseWords(input: PriceRaiseWordsInput): PriceRaiseWords {
  const day = dayWords(input.startsOn);
  const whose = input.forName === null ? "your" : `${input.forName}'s`;
  const from = formatMinor(input.fromMinor, input.currency);
  const to = formatMinor(input.toMinor, input.currency);
  const cancel =
    input.notice === null
      ? `If you'd rather not carry on at the new price, please let us know before ${day}.`
      : `If you'd rather not carry on at the new price, cancelling needs ${input.notice.days === 1 ? "1 day's" : `${String(input.notice.days)} days'`} notice: if you cancel today, the last day is ${dayWords(input.notice.lastDay)}.`;
  return {
    subject: `The price of ${whose} membership at ${input.gymName} is going up on ${day}`,
    lines: [
      `The price of ${whose} ${input.typeName} membership at ${input.gymName} is going up from ${from} to ${to} every ${input.every}.`,
      `The new price starts with the payment on ${day}. Payments before then stay at ${from}.`,
      cancel,
    ],
  };
}

// ── WHAT A SCREEN READS ──

/** One membership on the line, as the box before Save lists it: who holds it, whose it is where somebody else pays,
 *  and what the raise would do to it. */
export const priceRaisePersonSchema = z
  .object({ membershipId: z.string().uuid(), entryId: z.string().uuid(), name: z.string(), paidBy: z.string().nullable(), status: priceRaiseStatusSchema })
  .strict();
export type PriceRaisePerson = z.infer<typeof priceRaisePersonSchema>;
export const priceRaisePreviewResponseSchema = z.object({ currency: z.string(), people: z.array(priceRaisePersonSchema) }).strict();
export type PriceRaisePreviewResponse = z.infer<typeof priceRaisePreviewResponseSchema>;

/** What the box asks: who on the line would pay this price, from when, with this notice. */
export const priceRaisePreviewRequestSchema = z
  .object({ priceMinor: z.number().int().min(1).max(MEMBERSHIP_PRICE_MINOR_MAX), noticeDays: priceRaiseNoticeDaysSchema })
  .strict();
export type PriceRaisePreviewRequest = z.infer<typeof priceRaisePreviewRequestSchema>;
