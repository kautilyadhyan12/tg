// THE RULES OF BILLS AND PAYMENTS — Part 3 §14.2; ROADMAP Stage 2 item 18a-i.
//
// Pure: the day is the gym's own, passed in. `memberBills.ts` has how this sits with a
// membership's count of paid periods.
import { addDays, heldMembershipView, moveHeldMembership, periodIndex, periodStart, type HeldMembership } from "./heldMemberships.js";
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
    return { periodIndex: owed.periodIndex, leftMinor: owed.amountMinor - owed.paidMinor, dueOn: owed.dueOn, advances };
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
  const newest = [...payments].sort((a, b) => b.periodIndex - a.periodIndex || b.seq - a.seq)[0];
  if (newest === undefined) return null;
  const bill = bills.find((b) => b.periodIndex === newest.periodIndex);
  if (bill === undefined || (bill.status !== "open" && bill.status !== "paid")) return null;
  if (bill.status === "open") return { paymentId: newest.id, reopens: false, goesBack: false };
  // A settled bill the count never took in: it is owed again and nothing else moves.
  if (newest.periodIndex >= m.paidPeriods) return { paymentId: newest.id, reopens: true, goesBack: false };
  // A membership of one period: its count is whether its one bill is settled.
  if (m.kind !== "recurring") return { paymentId: newest.id, reopens: true, goesBack: true };
  const view = heldMembershipView(m, today);
  if (newest.periodIndex === m.paidPeriods - 1 && view.can.undoPaid !== null) {
    return { paymentId: newest.id, reopens: true, goesBack: true };
  }
  return null;
}
