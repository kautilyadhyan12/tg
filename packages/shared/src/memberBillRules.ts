// THE RULES OF BILLS AND PAYMENTS — Part 3 §14.2; ROADMAP Stage 2 item 18a-i.
//
// Pure: the day is the gym's own, passed in. `memberBills.ts` has how this sits with a
// membership's count of paid periods.
import { addDays, heldMembershipView, moveHeldMembership, periodIndex, periodStart, type HeldMembership } from "./heldMemberships.js";
import type { MemberBillState, MemberBillStatus } from "./memberBills.js";

export interface BillToOpen {
  periodIndex: number;
  dueOn: string;
  /** The days it is for, kept on the bill: a later freeze moves the membership's dates
   *  and never a bill's. */
  covers: { from: string; to: string } | null;
}

/** THE BILL A MEMBERSHIP IS OWED TODAY AND DOES NOT HAVE: at most one. A repeating
 *  membership is billed for the period today falls in, as that period begins; any other
 *  kind is billed once, for the whole of it. Nothing for one that is cancelled, ended,
 *  frozen, free, set to stop at the end of what is paid, or paid for that period already.
 *
 *  Never for a period that began before today's: a period is asked for as it comes or
 *  not at all (`countAfterGap` says what becomes of one that was not).
 *
 *  `have` is the periods that already have a bill, of any status. */
export function billsToOpen(m: HeldMembership, today: string, have: ReadonlySet<number>): BillToOpen[] {
  if (m.free) return [];
  const { status } = heldMembershipView(m, today);
  if (status !== "active" && status !== "upcoming") return [];
  if (m.kind !== "recurring") {
    return m.paidPeriods >= 1 || have.has(0) ? [] : [{ periodIndex: 0, dueOn: m.startsOn, covers: null }];
  }
  if (!m.renews) return [];
  const current = periodIndex(m, today);
  if (m.paidPeriods > current || have.has(current)) return [];
  return [{ periodIndex: current, dueOn: periodStart(m, current), covers: billCovers(m, current) }];
}

/** The days a bill is for when it is opened: a repeating membership's period as its dates
 *  stand now; null for any other kind, whose one bill is for the whole of it. */
export function billCovers(m: HeldMembership, index: number): { from: string; to: string } | null {
  if (m.kind !== "recurring") return null;
  return { from: periodStart(m, index), to: addDays(periodStart(m, index + 1), -1) };
}

/** What a bill reads on `today`. Worked out, never stored: a bill is Overdue only while
 *  it is open and `overdueAfterDays` whole days have passed since its due date. */
export function memberBillState(
  bill: { status: MemberBillStatus; dueOn: string },
  today: string,
  overdueAfterDays: number,
): MemberBillState {
  if (bill.status !== "open") return bill.status;
  return today > addDays(bill.dueOn, overdueAfterDays) ? "overdue" : "due";
}

export type PayMemberBill =
  | { ok: true; paidMinor: number; status: "open" | "paid" }
  | { ok: false; reason: "not_open" | "not_an_amount" | "too_much" };

/** One payment taken against a bill. Less than what is left leaves it open for the
 *  rest; more than what is left is refused, so nobody is recorded as paying twice. */
export function payMemberBill(
  bill: { status: MemberBillStatus; amountMinor: number; paidMinor: number },
  amountMinor: number,
): PayMemberBill {
  if (bill.status !== "open") return { ok: false, reason: "not_open" };
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return { ok: false, reason: "not_an_amount" };
  const left = bill.amountMinor - bill.paidMinor;
  if (amountMinor > left) return { ok: false, reason: "too_much" };
  const paidMinor = bill.paidMinor + amountMinor;
  return { ok: true, paidMinor, status: paidMinor === bill.amountMinor ? "paid" : "open" };
}

/** A bill as the rules below need it. */
export interface BillFacts {
  periodIndex: number;
  status: MemberBillStatus;
  amountMinor: number;
  paidMinor: number;
  dueOn: string;
  /** The days it was opened for; a rule reads none of the rules above from it. */
  covers?: { from: string; to: string } | null;
}

export interface PayTarget {
  periodIndex: number;
  /** What is left to pay for that period. */
  leftMinor: number;
  dueOn: string;
  /** The days the period is for: the bill's own where it has one. */
  covers: { from: string; to: string } | null;
  /** Settling it moves the membership's count of paid periods on by one
   *  (`countAfterPayment` says to what). */
  advances: boolean;
}

/** THE ONE PERIOD A PAYMENT CAN BE TAKEN FOR NOW, or null where there is none.
 *
 *  A membership in use is paid in order: the first period not paid, and only where the
 *  membership's own rule would let it be marked paid (so nothing is taken for one that
 *  is free, already paid, or set to stop). One that is over, or a past member's, takes
 *  payment only for a bill it was left owing: no bill is opened for it. Its count of
 *  paid periods still moves where that bill is the first unpaid period's, so the bill
 *  and the count never disagree if the person is put back on the list or a pack runs
 *  again; a repeating one that is over keeps its count, which its last day stands on. */
export function memberPayTarget(
  m: HeldMembership,
  priceMinor: number,
  today: string,
  bills: readonly BillFacts[],
  /** The record is a past member's: their memberships are kept and not in use. */
  past = false,
): PayTarget | null {
  const view = heldMembershipView(m, today);
  if (past || view.status === "ended" || view.status === "cancelled") {
    const owed = bills.filter((b) => b.status === "open").sort((a, b) => a.periodIndex - b.periodIndex)[0];
    if (owed === undefined) return null;
    const over = view.status === "ended" || view.status === "cancelled";
    const first = owed.periodIndex === m.paidPeriods;
    const advances = m.kind === "recurring" ? first && !over && view.can.markPaid !== null : first && m.paidPeriods === 0;
    return { periodIndex: owed.periodIndex, leftMinor: owed.amountMinor - owed.paidMinor, dueOn: owed.dueOn, covers: owed.covers ?? null, advances };
  }
  // A bill from before the count's floor (opened before the person was away) is owed
  // first, and paying it moves no date.
  const older = bills.filter((b) => b.status === "open" && b.periodIndex < m.paidFloor).sort((a, b) => a.periodIndex - b.periodIndex)[0];
  if (older !== undefined) {
    return { periodIndex: older.periodIndex, leftMinor: older.amountMinor - older.paidMinor, dueOn: older.dueOn, covers: older.covers ?? null, advances: false };
  }
  if (view.can.markPaid === null) return null;
  const index = m.paidPeriods;
  const bill = bills.find((b) => b.periodIndex === index);
  if (bill === undefined) {
    const dueOn = m.kind === "recurring" ? periodStart(m, index) : m.startsOn;
    return { periodIndex: index, leftMinor: priceMinor, dueOn, covers: billCovers(m, index), advances: true };
  }
  if (bill.status !== "open") return null;
  return { periodIndex: index, leftMinor: bill.amountMinor - bill.paidMinor, dueOn: bill.dueOn, covers: bill.covers ?? null, advances: true };
}

/** THE COUNT OF PAID PERIODS, MOVED OVER THE PERIODS NOBODY WAS ASKED FOR (Kd, RULINGS
 *  2026-10-10). A period's bill is opened as the period begins, and only while its person
 *  is on the gym's list. So a period that began before the one today falls in and has NO
 *  bill is one this app never asked for: the person was a past member then, or the gym's
 *  own file was not linked yet. Such periods are never billed afterwards. This answers the
 *  count (and its floor) a repeating membership that is running should stand at: the
 *  period today falls in; or null where nothing moves.
 *
 *  It reads only the membership and its bills, never HOW the person came back, so every
 *  way back (put back, added again, a new file, two records joined, and any way added
 *  later) is the same case. A bill that exists stays owed: one from before the gap is
 *  below the new floor and is paid first (`memberPayTarget`).
 *
 *  `have` is the periods that have a bill, of any status. */
export function countAfterGap(m: HeldMembership, today: string, have: ReadonlySet<number>): number | null {
  if (m.free || m.kind !== "recurring" || !m.renews) return null;
  if (heldMembershipView(m, today).status !== "active") return null;
  const current = periodIndex(m, today);
  let first = m.paidPeriods;
  while (first < current && have.has(first)) first += 1;
  return first < current ? current : null;
}

/** WHAT A CANCEL DOES TO THE BILLS STILL OPEN. `lastDay` is the last day the membership
 *  runs: the day it is cancelled, or the last paid day where it is set to stop. A bill
 *  that falls due after that day is for days the person will never have: one with
 *  nothing paid on it is cancelled with the membership (`voids`, by period), and one with
 *  a payment standing stops the cancel (`blocked`) until that payment is taken back, so
 *  no bill is left reading Overdue for a month nobody had. A bill due on or before the
 *  last day stays owed. */
export function billsAtCancel(bills: readonly BillFacts[], lastDay: string): { voids: number[]; blocked: boolean } {
  const after = bills.filter((b) => b.status === "open" && b.dueOn > lastDay);
  return { voids: after.filter((b) => b.paidMinor === 0).map((b) => b.periodIndex), blocked: after.some((b) => b.paidMinor > 0) };
}

/** The count of paid periods once a payment has settled `target`'s bill: the number to
 *  write, null to leave it, or refused. It moves through the membership's own rule; a
 *  membership of one period that is over has no date standing on the count, so its one
 *  payment is counted as it is. */
export function countAfterPayment(m: HeldMembership, target: PayTarget, today: string): { ok: true; paidPeriods: number | null } | { ok: false } {
  if (!target.advances) return { ok: true, paidPeriods: null };
  const move = moveHeldMembership(m, { type: "paid", paidPeriods: m.paidPeriods + 1 }, today);
  if (move.ok && move.membership.paidPeriods === m.paidPeriods + 1) return { ok: true, paidPeriods: move.membership.paidPeriods };
  if (m.kind !== "recurring" && m.paidPeriods === 0) return { ok: true, paidPeriods: 1 };
  return { ok: false };
}

/** The same for a payment taken back, where `goesBack`. */
export function countAfterUndo(m: HeldMembership, goesBack: boolean, today: string): { ok: true; paidPeriods: number | null } | { ok: false } {
  if (!goesBack) return { ok: true, paidPeriods: null };
  const move = moveHeldMembership(m, { type: "paid", paidPeriods: m.paidPeriods - 1 }, today);
  if (move.ok && move.membership.paidPeriods === m.paidPeriods - 1) return { ok: true, paidPeriods: move.membership.paidPeriods };
  if (m.kind !== "recurring" && m.paidPeriods === 1) return { ok: true, paidPeriods: 0 };
  return { ok: false };
}

/** A payment as the rule below needs it; `seq` orders them, newest highest. */
export interface PaymentFacts {
  id: string;
  periodIndex: number;
  seq: number;
}

/** THE ONE PAYMENT THAT CAN BE TAKEN BACK NOW: the newest on the membership, and only
 *  where taking it back leaves the count of paid periods true. Null where there is none. */
export function memberUndoTarget(
  m: HeldMembership,
  today: string,
  bills: readonly BillFacts[],
  payments: readonly PaymentFacts[],
): { paymentId: string; reopens: boolean; goesBack: boolean } | null {
  // The last one recorded. Counted periods are paid in order, so among them that is also
  // the newest period; a payment for a bill outside the count moves nothing.
  const newest = [...payments].sort((a, b) => b.seq - a.seq)[0];
  if (newest === undefined) return null;
  const bill = bills.find((b) => b.periodIndex === newest.periodIndex);
  if (bill === undefined || (bill.status !== "open" && bill.status !== "paid")) return null;
  if (bill.status === "open") return { paymentId: newest.id, reopens: false, goesBack: false };
  // A settled bill the count never took in (after it, or from before its floor): it is
  // owed again and nothing else moves.
  if (newest.periodIndex >= m.paidPeriods || (m.kind === "recurring" && newest.periodIndex < m.paidFloor)) {
    return { paymentId: newest.id, reopens: true, goesBack: false };
  }
  // A membership of one period: its count is whether its one bill is settled.
  if (m.kind !== "recurring") return { paymentId: newest.id, reopens: true, goesBack: true };
  const view = heldMembershipView(m, today);
  if (newest.periodIndex === m.paidPeriods - 1 && view.can.undoPaid !== null) {
    return { paymentId: newest.id, reopens: true, goesBack: true };
  }
  return null;
}
