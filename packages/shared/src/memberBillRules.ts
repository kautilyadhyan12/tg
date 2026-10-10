// THE RULES OF BILLS AND PAYMENTS — Part 3 §14.2; ROADMAP Stage 2 item 18a-i.
//
// Pure: the day is the gym's own, passed in. `memberBills.ts` has how this sits with a
// membership's count of paid periods.
import { addDays, heldMembershipView, periodIndex, periodStart, type HeldMembership } from "./heldMemberships.js";
import { BILLS_OPEN_A_RUN, type MemberBillState, type MemberBillStatus } from "./memberBills.js";

export interface BillToOpen {
  periodIndex: number;
  dueOn: string;
}

/** THE BILLS A MEMBERSHIP IS OWED TODAY AND DOES NOT HAVE. Nothing for one that is
 *  cancelled, ended, frozen, free, or set to stop at the end of what is paid: none of
 *  those is asked for money again. A repeating one is owed every period from the first
 *  not paid up to the one today falls in; any other kind is owed once.
 *
 *  `have` is the periods that already have a bill, of any status. */
export function billsToOpen(m: HeldMembership, today: string, have: ReadonlySet<number>): BillToOpen[] {
  if (m.free) return [];
  const { status } = heldMembershipView(m, today);
  if (status !== "active" && status !== "upcoming") return [];
  if (m.kind !== "recurring") {
    return m.paidPeriods >= 1 || have.has(0) ? [] : [{ periodIndex: 0, dueOn: m.startsOn }];
  }
  if (!m.renews) return [];
  const last = periodIndex(m, today);
  const out: BillToOpen[] = [];
  for (let i = m.paidPeriods; i <= last && out.length < BILLS_OPEN_A_RUN; i += 1) {
    if (!have.has(i)) out.push({ periodIndex: i, dueOn: periodStart(m, i) });
  }
  return out;
}

/** The days a bill is for: a repeating membership's period; null for any other kind,
 *  whose one bill is for the whole of it. */
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
}

export interface PayTarget {
  periodIndex: number;
  /** What is left to pay for that period. */
  leftMinor: number;
  dueOn: string;
  /** Settling it moves the membership's count of paid periods on by one. */
  advances: boolean;
}

/** THE ONE PERIOD A PAYMENT CAN BE TAKEN FOR NOW, or null where there is none.
 *
 *  A membership in use is paid in order: the first period not paid, and only where the
 *  membership's own rule would let it be marked paid (so nothing is taken for one that
 *  is free, already paid, or set to stop). One that is over, or a past member's, takes
 *  payment only for a bill it was left owing, and its dates do not move. */
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
    return { periodIndex: owed.periodIndex, leftMinor: owed.amountMinor - owed.paidMinor, dueOn: owed.dueOn, advances: false };
  }
  if (view.can.markPaid === null) return null;
  const index = m.paidPeriods;
  const bill = bills.find((b) => b.periodIndex === index);
  if (bill === undefined) {
    const dueOn = m.kind === "recurring" ? periodStart(m, index) : m.startsOn;
    return { periodIndex: index, leftMinor: priceMinor, dueOn, advances: true };
  }
  if (bill.status !== "open") return null;
  return { periodIndex: index, leftMinor: bill.amountMinor - bill.paidMinor, dueOn: bill.dueOn, advances: true };
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
  const newest = [...payments].sort((a, b) => b.periodIndex - a.periodIndex || b.seq - a.seq)[0];
  if (newest === undefined) return null;
  const bill = bills.find((b) => b.periodIndex === newest.periodIndex);
  if (bill === undefined || (bill.status !== "open" && bill.status !== "paid")) return null;
  if (bill.status === "open") return { paymentId: newest.id, reopens: false, goesBack: false };
  // A settled bill: the period after the count was paid outside the membership's dates.
  if (newest.periodIndex >= m.paidPeriods) return { paymentId: newest.id, reopens: true, goesBack: false };
  const view = heldMembershipView(m, today);
  if (newest.periodIndex === m.paidPeriods - 1 && view.can.undoPaid !== null) {
    return { paymentId: newest.id, reopens: true, goesBack: true };
  }
  return null;
}
