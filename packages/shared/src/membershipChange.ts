// MOVE TO ANOTHER MEMBERSHIP (spec Part 3 §14.8; ROADMAP Stage 2 item 18x). Staff change a
// membership in use for another type on the price list, today or on its next payment date.
//
// Today: the days already paid for and not yet used come off the new membership's first
// bill, before tax, as Glofox, TeamUp and Podplay work it out. Nothing is ever left over
// (Kd, 2026-10-22, "go B"): a change whose credit would be more than the new price waits
// for the next payment date, as Podplay and MyTime do a cheaper move. No joining fee is
// charged on a change. The credit is worked out from the money that stands on each paid
// period's bill, never from the price list, so nobody is paid back what they never paid.
import { addDays, daysBetween, heldMembershipView, periodIndex, periodStart, type HeldMembership } from "./heldMemberships.js";
import { bookingPeriod } from "./classBookings.js";
import type { MembershipKind } from "./memberships.js";

/** What the rule reads of one bill of the membership being changed. */
export interface ChangeBillFacts {
  periodIndex: number;
  status: "open" | "paid" | "void" | "refunded";
  /** What the person was asked to pay, its tax in. */
  amountMinor: number;
  /** The tax in it, and whether the price held it; null for none. */
  tax: { minor: number; included: boolean } | null;
  /** Its joining fee, before any tax added on top (18t): never part of the days. */
  joiningFeeMinor: number;
  /** A change's credit taken off it (18x): days already paid for under the membership before. */
  changeCreditMinor: number;
  /** The payments that stand, and the refunds that stand against them. */
  paidMinor: number;
  refundedMinor: number;
}

/** Why a membership cannot be changed at all. */
export type ChangeFromRefusal = "not_changeable" | "frozen" | "not_started" | "unpaid";

export type ChangeFrom =
  | { ok: false; reason: ChangeFromRefusal }
  | {
      ok: true;
      /** The days paid for and not yet used, as money before tax: what a change today takes off. */
      creditMinor: number;
      /** Paid-for days left of the period today falls in, today among them. */
      daysLeft: number;
      /** The first day of a change on the next payment date; null where there is none. */
      nextOn: string | null;
      /** The credit by period, for the periods that have a bill: what each one's money moves. */
      byPeriod: { periodIndex: number; creditMinor: number }[];
    };

/** What a paid period's bill holds for its days, before tax: the money that stands on it,
 *  without its joining fee, and the credit an earlier change took off it. */
export function billDaysMinor(b: ChangeBillFacts): number {
  // A bill staff cancelled was never charged: nothing stands for its days.
  if (b.status === "void") return 0;
  const beforeTax = b.tax !== null && !b.tax.included ? b.amountMinor - b.tax.minor : b.amountMinor;
  const listed = Math.max(0, beforeTax - b.joiningFeeMinor);
  const stands = Math.min(b.amountMinor, Math.max(0, b.paidMinor - b.refundedMinor));
  return Math.floor((listed * stands) / b.amountMinor) + b.changeCreditMinor;
}

/** THE MEMBERSHIP BEING CHANGED, as it is on `today`: whether it can be changed, and what a
 *  change today would take off. `heldPriceMinor` is what each period costs before tax, for a
 *  period counted as paid that has no bill (one before it was given here). */
export function changeFrom(m: HeldMembership, heldPriceMinor: number, bills: readonly ChangeBillFacts[], today: string): ChangeFrom {
  if (m.kind === "pack" || m.kind === "trial") return { ok: false, reason: "not_changeable" };
  const view = heldMembershipView(m, today);
  if (view.status === "ended" || view.status === "cancelled") return { ok: false, reason: "not_changeable" };
  if (view.status === "frozen") return { ok: false, reason: "frozen" };
  if (view.status === "upcoming") return { ok: false, reason: "not_started" };

  const recurring = m.kind === "recurring";
  const current = recurring ? periodIndex(m, today) : 0;
  const lastPaid = recurring ? m.paidPeriods - 1 : m.paidPeriods >= 1 ? 0 : -1;
  if (!m.free && lastPaid < current) return { ok: false, reason: "unpaid" };

  const from = periodStart(m, current);
  const to = periodStart(m, current + 1);
  // Refer a friend's free days (20e-ii-b-ii-b) lengthen the period before `giftFrom` at its end:
  // nobody paid for them, so they are neither counted in the period nor credited (round one, High-1).
  const free = m.giftDays > 0 && m.giftFrom >= 1 && current === m.giftFrom - 1 ? m.giftDays : 0;
  const daysLeft = Math.max(0, daysBetween(today, to) - free);
  const periodDays = daysBetween(from, to) - free;
  let creditMinor = 0;
  const byPeriod: { periodIndex: number; creditMinor: number }[] = [];
  if (!m.free) {
    for (let index = current; index <= lastPaid; index += 1) {
      const bill = bills.find((b) => b.periodIndex === index);
      const paid = bill === undefined ? heldPriceMinor : billDaysMinor(bill);
      const credit = index === current ? (periodDays <= 0 ? 0 : Math.floor((paid * daysLeft) / periodDays)) : paid;
      creditMinor += credit;
      if (bill !== undefined) byPeriod.push({ periodIndex: index, creditMinor: credit });
    }
  }

  // A repeating one that renews stops at the end of what is paid; one that ends has its last day.
  let nextOn: string | null = null;
  if (view.can.cancelAtPeriodEnd !== null) nextOn = addDays(view.can.cancelAtPeriodEnd, 1);
  else if (view.endsOn !== null && view.endsOn >= today) nextOn = addDays(view.endsOn, 1);
  return { ok: true, creditMinor, daysLeft, nextOn, byPeriod };
}

/** THE MONEY ON A BILL WHOSE DAYS A CHANGE MOVED to the membership that replaced it (round one,
 *  High-2): never refunded from this bill, as the new one's first bill already took it off.
 *  `creditMinor` is what the change credited for this bill's period (`byPeriod`). The part of
 *  the money standing that paid for days, in the share the credit is of those days' value;
 *  rounded up, so a refund never gives back a cent that moved. */
export function movedMoneyMinor(b: ChangeBillFacts, creditMinor: number): number {
  const value = billDaysMinor(b);
  const stands = b.status === "void" ? 0 : Math.min(b.amountMinor, Math.max(0, b.paidMinor - b.refundedMinor));
  if (creditMinor <= 0 || value <= 0 || stands === 0) return 0;
  const beforeTax = b.tax !== null && !b.tax.included ? b.amountMinor - b.tax.minor : b.amountMinor;
  if (beforeTax <= 0) return 0;
  // credit × stands × (days part of the price) / (price × value), in whole numbers that cannot overflow.
  const top = BigInt(Math.min(creditMinor, value)) * BigInt(stands) * BigInt(Math.max(0, beforeTax - b.joiningFeeMinor));
  const bottom = BigInt(beforeTax) * BigInt(value);
  const moved = Number((top + bottom - 1n) / bottom);
  return Math.min(stands, moved);
}

/** The classes or sessions booked on the old membership that move to the new one (round one,
 *  Low-3): those it covers, earliest first, while the new type's limit for each of its weeks or
 *  months has room. The rest end, once the screen has named them. */
export function withinLimit<T extends { id: string; day: string }>(
  booked: readonly T[],
  limit: number | null,
  period: "week" | "month" | null,
): string[] {
  if (limit === null || period === null) return booked.map((b) => b.id);
  const used = new Map<string, number>();
  const moved: string[] = [];
  for (const b of [...booked].sort((x, y) => (x.day < y.day ? -1 : x.day > y.day ? 1 : 0))) {
    const key = bookingPeriod(b.day, period).from;
    const n = used.get(key) ?? 0;
    if (n >= limit) continue;
    used.set(key, n + 1);
    moved.push(b.id);
  }
  return moved;
}

/** The type it would change to, as the rule reads it. */
export interface ChangeTarget {
  id: string;
  kind: MembershipKind;
  priceMinor: number;
}

/** `nothing_to_pay`: the credit is exactly the price of a membership paid once, which would
 *  then be paid with no bill behind it. */
export type ChangeToRefusal = "same_type" | "kind_not_allowed" | "left_over" | "nothing_to_pay" | "no_next_payment";

export type ChangeTo =
  | { ok: false; reason: ChangeToRefusal }
  | {
      ok: true;
      startsOn: string;
      /** Off the new membership's first bill, before tax; 0 for a change on the next payment date. */
      creditMinor: number;
      /** The new first bill before tax: its price less the credit. 0 opens no bill. */
      firstListedMinor: number;
      /** The credit pays the whole of a repeating membership's first period: it starts paid. */
      paidByChange: boolean;
    };

/** THE CHANGE: from `from`, held as type `fromTypeId`, to `target`, `today` or on the next
 *  payment date. A change today leaves nothing over: the credit is at most the new price. */
export function changeTo(from: Extract<ChangeFrom, { ok: true }>, fromTypeId: string, target: ChangeTarget, when: "today" | "next_payment", today: string): ChangeTo {
  if (target.id === fromTypeId) return { ok: false, reason: "same_type" };
  if (target.kind !== "recurring" && target.kind !== "one_time") return { ok: false, reason: "kind_not_allowed" };
  if (when === "next_payment") {
    if (from.nextOn === null) return { ok: false, reason: "no_next_payment" };
    return { ok: true, startsOn: from.nextOn, creditMinor: 0, firstListedMinor: target.priceMinor, paidByChange: false };
  }
  const first = target.priceMinor - from.creditMinor;
  if (first < 0) return { ok: false, reason: "left_over" };
  const paidByChange = first === 0 && target.priceMinor > 0;
  if (paidByChange && target.kind !== "recurring") return { ok: false, reason: "nothing_to_pay" };
  return { ok: true, startsOn: today, creditMinor: from.creditMinor, firstListedMinor: first, paidByChange };
}

/** What staff read where a change cannot be made: the same words on the screen and from the server. */
export const MEMBERSHIP_CHANGE_WORDS: Readonly<Record<ChangeFromRefusal | ChangeToRefusal | "changed_already" | "credit_changed", string>> = {
  not_changeable: "Only a membership in use that renews or is paid once can be changed. For a class pack or a trial, add a new membership instead.",
  frozen: "This membership is frozen. Unfreeze it first, then change it.",
  not_started: "This membership hasn't started yet. Cancel it and add the one they want instead.",
  unpaid: "This membership has a payment due. Record the payment first, then change it.",
  changed_already: "This membership has already been changed to another one.",
  same_type: "They already have this membership. Pick another one.",
  kind_not_allowed: "A class pack or a trial can't be changed to. Add it as a new membership instead.",
  left_over: "What they have paid for the rest of this period is more than the new price. Change it on the next payment date instead.",
  nothing_to_pay: "What they have paid for the rest of this period covers the whole new price. Change it on the next payment date instead.",
  no_next_payment: "This membership has no next payment date. Change it today instead.",
  credit_changed: "What they have paid changed while this was open. Nothing was saved: check the total and press again.",
};
