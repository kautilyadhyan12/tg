// Bills and payments (spec Part 3 §14.2; ROADMAP 18a-i).
//
// The first two blocks are the worst this job could do to a real person: ask somebody
// for money after they cancelled, and show "Overdue" about somebody who has paid. The
// days are read off a 2026–2028 calendar (2028 is the leap year), not worked out with
// the code under test.
import { describe, expect, it } from "vitest";
import {
  BILLS_OPEN_A_RUN,
  billCovers,
  billsAtCancel,
  billsToOpen,
  countAfterPayment,
  countAfterUndo,
  giveHeldMembership,
  memberBillState,
  memberPayTarget,
  memberUndoTarget,
  moveHeldMembership,
  payMemberBill,
  type BillFacts,
  type HeldMembership,
  type HeldMembershipEvent,
  type HeldMembershipTerms,
} from "../src/index.js";

const monthly: HeldMembershipTerms = { kind: "recurring", termCount: 1, termUnit: "month", packClasses: null, packDays: null, priceMinor: 4999 };
const weekly: HeldMembershipTerms = { ...monthly, termUnit: "week" };
const threeMonths: HeldMembershipTerms = { ...monthly, kind: "one_time", termCount: 3 };
const freeMonthly: HeldMembershipTerms = { ...monthly, priceMinor: 0 };
const tenPack: HeldMembershipTerms = { kind: "pack", termCount: null, termUnit: null, packClasses: 10, packDays: 60, priceMinor: 9000 };

function given(type: HeldMembershipTerms, startsOn: string, paid: boolean, today: string): HeldMembership {
  const made = giveHeldMembership(type, startsOn, paid, today);
  if (!made.ok) throw new Error(made.reason);
  return made.membership;
}

function moved(m: HeldMembership, event: HeldMembershipEvent, today: string): HeldMembership {
  const move = moveHeldMembership(m, event, today);
  if (!move.ok) throw new Error(move.reason);
  return move.membership;
}

const none = new Set<number>();
const indexes = (m: HeldMembership, today: string, have: ReadonlySet<number> = none) => billsToOpen(m, today, have).map((b) => b.periodIndex);
/** Which periods are owed and when each is due; the days each is for have their own test. */
const owed = (m: HeldMembership, today: string) => billsToOpen(m, today, none).map((b) => ({ periodIndex: b.periodIndex, dueOn: b.dueOn }));

describe("a cancelled membership is never billed again", () => {
  // Given unpaid on 15 Jan 2026: period 0 is 15 Jan – 14 Feb, period 1 from 15 Feb.
  const unpaid = given(monthly, "2026-01-15", false, "2026-01-15");

  it("is owed its period while it runs", () => {
    expect(owed(unpaid, "2026-01-15")).toEqual([{ periodIndex: 0, dueOn: "2026-01-15" }]);
    expect(owed(unpaid, "2026-02-15")).toEqual([
      { periodIndex: 0, dueOn: "2026-01-15" },
      { periodIndex: 1, dueOn: "2026-02-15" },
    ]);
  });

  it("is owed nothing new from the day it is cancelled, however long after", () => {
    const cancelled = moved(unpaid, { type: "cancel", when: "today" }, "2026-02-20");
    for (const day of ["2026-02-20", "2026-02-21", "2026-03-15", "2026-12-31", "2028-02-29"]) {
      expect(indexes(cancelled, day), day).toEqual([]);
    }
  });

  it("is owed nothing new once it is set to stop at the end of what is paid, nor after that end", () => {
    const paid = given(monthly, "2026-01-15", true, "2026-01-15");
    const stopping = moved(paid, { type: "cancel", when: "period_end" }, "2026-01-20");
    // Its last day is 14 Feb 2026.
    for (const day of ["2026-01-20", "2026-02-14", "2026-02-15", "2026-03-15", "2027-01-15"]) {
      expect(indexes(stopping, day), day).toEqual([]);
    }
  });

  it("is owed nothing while it is frozen, and its next period after it is unfrozen", () => {
    const paid = given(monthly, "2026-01-15", true, "2026-01-15");
    const frozen = moved(paid, { type: "freeze" }, "2026-02-01");
    expect(indexes(frozen, "2026-02-15")).toEqual([]);
    expect(indexes(frozen, "2026-06-01")).toEqual([]);
    // Frozen 1 Feb, unfrozen 11 Feb: ten days, so period 1 starts 25 Feb, not 15 Feb.
    const back = moved(frozen, { type: "unfreeze" }, "2026-02-11");
    expect(indexes(back, "2026-02-24")).toEqual([]);
    expect(owed(back, "2026-02-25")).toEqual([{ periodIndex: 1, dueOn: "2026-02-25" }]);
  });

  it("is owed nothing once a fixed term or a pack is over, paid or not", () => {
    const term = given(threeMonths, "2026-01-15", false, "2026-01-15");
    expect(indexes(term, "2026-04-14")).toEqual([0]);
    expect(indexes(term, "2026-04-15")).toEqual([]);
    const pack = given(tenPack, "2026-01-01", false, "2026-01-01");
    expect(indexes(pack, "2026-03-01")).toEqual([0]);
    expect(indexes(pack, "2026-03-02")).toEqual([]);
    expect(indexes({ ...pack, classesLeft: 0 }, "2026-01-05")).toEqual([]);
  });

  it("opens no second bill for a period that has one, whatever became of the first", () => {
    expect(indexes(unpaid, "2026-02-15", new Set([0]))).toEqual([1]);
    expect(indexes(unpaid, "2026-02-15", new Set([0, 1]))).toEqual([]);
  });

  it("asks nothing for a free membership, a paid period, or a period paid ahead", () => {
    expect(indexes(given(freeMonthly, "2026-01-15", false, "2026-01-15"), "2026-06-15")).toEqual([]);
    const paid = given(monthly, "2026-01-15", true, "2026-01-15");
    expect(indexes(paid, "2026-02-14")).toEqual([]);
    expect(indexes(paid, "2026-02-15")).toEqual([1]);
    const ahead = moved(paid, { type: "paid", paidPeriods: 2 }, "2026-01-15");
    expect(indexes(ahead, "2026-02-15")).toEqual([]);
    expect(indexes(given(threeMonths, "2026-01-15", true, "2026-01-15"), "2026-02-01")).toEqual([]);
  });

  it("asks for the periods before it was given of nobody", () => {
    // Started 15 Oct 2025, given on 20 Jan 2026: today's period is 15 Jan – 14 Feb, the fourth.
    const late = given(monthly, "2025-10-15", false, "2026-01-20");
    expect(owed(late, "2026-01-20")).toEqual([{ periodIndex: 3, dueOn: "2026-01-15" }]);
  });

  it("opens one before its start day, due on the start day", () => {
    const upcoming = given(monthly, "2026-03-01", false, "2026-02-10");
    expect(owed(upcoming, "2026-02-10")).toEqual([{ periodIndex: 0, dueOn: "2026-03-01" }]);
  });

  it("opens at most so many in one run, oldest first", () => {
    const old = given(weekly, "2026-01-05", false, "2026-01-05");
    const first = indexes(old, "2027-01-04");
    expect(first).toHaveLength(BILLS_OPEN_A_RUN);
    expect(first[0]).toBe(0);
    expect(indexes(old, "2027-01-04", new Set(first))[0]).toBe(BILLS_OPEN_A_RUN);
  });

  it("follows a month's end as the membership does: 31 Jan, 28 Feb, 31 Mar", () => {
    const m = given(monthly, "2026-01-31", false, "2026-01-31");
    expect(billsToOpen(m, "2026-03-31", none).map((b) => b.dueOn)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    expect(billCovers(m, 1)).toEqual({ from: "2026-02-28", to: "2026-03-30" });
    expect(billsToOpen(m, "2026-03-31", none).map((b) => b.covers)).toEqual([
      { from: "2026-01-31", to: "2026-02-27" },
      { from: "2026-02-28", to: "2026-03-30" },
      { from: "2026-03-31", to: "2026-04-29" },
    ]);
    expect(billCovers(given(threeMonths, "2026-01-15", false, "2026-01-15"), 0)).toBeNull();
  });
});

describe("Overdue is never said about somebody who has paid", () => {
  const bill = { dueOn: "2026-02-15" };

  it("reads Paid on every day once it is paid, long after its due date too", () => {
    for (const day of ["2026-02-01", "2026-02-15", "2026-02-16", "2026-12-31", "2028-02-29"]) {
      for (const days of [0, 3, 60]) expect(memberBillState({ ...bill, status: "paid" }, day, days)).toBe("paid");
    }
  });

  it("reads Due up to and on the due date, and Overdue from the day after", () => {
    const open = { ...bill, status: "open" as const };
    expect(memberBillState(open, "2026-01-20", 0)).toBe("due");
    expect(memberBillState(open, "2026-02-15", 0)).toBe("due");
    expect(memberBillState(open, "2026-02-16", 0)).toBe("overdue");
  });

  it("waits the gym's own number of days, across a month's end and a leap day", () => {
    const open = { ...bill, status: "open" as const };
    expect(memberBillState(open, "2026-02-22", 7)).toBe("due");
    expect(memberBillState(open, "2026-02-23", 7)).toBe("overdue");
    // 15 Feb 2026 + 14 days is 1 Mar 2026; 15 Feb 2028 + 14 days is 29 Feb 2028.
    expect(memberBillState(open, "2026-03-01", 14)).toBe("due");
    expect(memberBillState(open, "2026-03-02", 14)).toBe("overdue");
    const leap = { dueOn: "2028-02-15", status: "open" as const };
    expect(memberBillState(leap, "2028-02-29", 14)).toBe("due");
    expect(memberBillState(leap, "2028-03-01", 14)).toBe("overdue");
  });

  it("says a void or refunded bill is that, never Due or Overdue", () => {
    expect(memberBillState({ ...bill, status: "void" }, "2027-01-01", 0)).toBe("void");
    expect(memberBillState({ ...bill, status: "refunded" }, "2027-01-01", 0)).toBe("refunded");
  });
});

describe("a payment against a bill", () => {
  const open = { status: "open" as const, amountMinor: 4999, paidMinor: 0 };

  it("settles it when it is the whole amount", () => {
    expect(payMemberBill(open, 4999)).toEqual({ ok: true, paidMinor: 4999, status: "paid" });
  });

  it("leaves it open for the rest when it is part, and settles on the last part", () => {
    expect(payMemberBill(open, 2000)).toEqual({ ok: true, paidMinor: 2000, status: "open" });
    expect(payMemberBill({ ...open, paidMinor: 2000 }, 2999)).toEqual({ ok: true, paidMinor: 4999, status: "paid" });
  });

  it("refuses more than is left, so nobody is recorded as paying twice", () => {
    expect(payMemberBill(open, 5000)).toEqual({ ok: false, reason: "too_much" });
    expect(payMemberBill({ ...open, paidMinor: 4998 }, 2)).toEqual({ ok: false, reason: "too_much" });
  });

  it("refuses a bill that is not open, and an amount that is not one", () => {
    for (const status of ["paid", "void", "refunded"] as const) {
      expect(payMemberBill({ ...open, status, paidMinor: status === "paid" ? 4999 : 0 }, 1)).toEqual({ ok: false, reason: "not_open" });
    }
    for (const amount of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(payMemberBill(open, amount)).toEqual({ ok: false, reason: "not_an_amount" });
    }
  });
});

const billOf = (periodIndex: number, over: Partial<BillFacts> = {}): BillFacts => ({
  periodIndex,
  status: "open",
  amountMinor: 4999,
  paidMinor: 0,
  dueOn: "2026-01-15",
  ...over,
});

describe("which period a payment can be taken for", () => {
  const unpaid = given(monthly, "2026-01-15", false, "2026-01-15");

  it("is the first period not paid, with what is left of its bill", () => {
    expect(memberPayTarget(unpaid, 4999, "2026-01-15", [billOf(0)])).toEqual({ periodIndex: 0, leftMinor: 4999, dueOn: "2026-01-15", covers: null, advances: true });
    // The days are the bill's own, as they were when it was opened: a freeze since has not moved them.
    const kept = { from: "2026-01-15", to: "2026-02-14" };
    const thawed = moved(moved(unpaid, { type: "freeze" }, "2026-01-20"), { type: "unfreeze" }, "2026-01-30");
    expect(billCovers(thawed, 0)).toEqual({ from: "2026-01-25", to: "2026-02-24" });
    expect(memberPayTarget(thawed, 4999, "2026-01-30", [billOf(0, { covers: kept })])?.covers).toEqual(kept);
    expect(memberPayTarget(unpaid, 4999, "2026-01-15", [billOf(0, { paidMinor: 1999 })])?.leftMinor).toBe(3000);
  });

  it("is the next period at the membership's own price where no bill is open yet", () => {
    const paid = given(monthly, "2026-01-15", true, "2026-01-15");
    expect(memberPayTarget(paid, 4999, "2026-01-20", [billOf(0, { status: "paid", paidMinor: 4999 })])).toEqual({
      periodIndex: 1,
      leftMinor: 4999,
      dueOn: "2026-02-15",
      covers: { from: "2026-02-15", to: "2026-03-14" },
      advances: true,
    });
  });

  it("is nothing for a free one, a paid fixed term, or one set to stop", () => {
    expect(memberPayTarget(given(freeMonthly, "2026-01-15", false, "2026-01-15"), 0, "2026-01-15", [])).toBeNull();
    expect(memberPayTarget(given(threeMonths, "2026-01-15", true, "2026-01-15"), 4999, "2026-01-15", [])).toBeNull();
    const stopping = moved(given(monthly, "2026-01-15", true, "2026-01-15"), { type: "cancel", when: "period_end" }, "2026-01-20");
    expect(memberPayTarget(stopping, 4999, "2026-01-20", [])).toBeNull();
  });

  it("is only a bill left owing once the membership is over, and moves no dates", () => {
    const cancelled = moved(unpaid, { type: "cancel", when: "today" }, "2026-02-20");
    expect(memberPayTarget(cancelled, 4999, "2026-03-01", [])).toBeNull();
    expect(memberPayTarget(cancelled, 4999, "2026-03-01", [billOf(1, { dueOn: "2026-02-15" }), billOf(0)])).toEqual({
      periodIndex: 0,
      leftMinor: 4999,
      dueOn: "2026-01-15",
      covers: null,
      advances: false,
    });
    expect(memberPayTarget(cancelled, 4999, "2026-03-01", [billOf(0, { status: "paid", paidMinor: 4999 })])).toBeNull();
  });

  it("is nothing where the bill of the first unpaid period is void", () => {
    expect(memberPayTarget(unpaid, 4999, "2026-01-15", [billOf(0, { status: "void" })])).toBeNull();
  });

  it("is only a bill already open for a past member, and no bill is opened for them", () => {
    expect(memberPayTarget(unpaid, 4999, "2026-01-20", [], true)).toBeNull();
    // The month they left owing is the first unpaid one: paying it counts, so the bill and
    // the count agree if they are put back on the list.
    expect(memberPayTarget(unpaid, 4999, "2026-01-20", [billOf(0)], true)).toEqual({ periodIndex: 0, leftMinor: 4999, dueOn: "2026-01-15", covers: null, advances: true });
  });
});

describe("a cancel takes with it the bills for days the person will never have", () => {
  it("cancels the bill of a membership that never started, and leaves nothing owed", () => {
    // Given on 5 January to start on the 15th; cancelled on the 6th.
    expect(billsAtCancel([billOf(0, { dueOn: "2026-01-15" })], "2026-01-06")).toEqual({ voids: [0], blocked: false });
  });

  it("keeps a bill that fell due on or before the last day: that month was had", () => {
    expect(billsAtCancel([billOf(0, { dueOn: "2026-01-15" })], "2026-01-15")).toEqual({ voids: [], blocked: false });
    expect(billsAtCancel([billOf(0, { dueOn: "2026-01-15" }), billOf(1, { dueOn: "2026-02-15" })], "2026-02-20")).toEqual({ voids: [], blocked: false });
  });

  it("set to stop on 14 February: next month's unpaid bill goes, and one with a payment on it stops the cancel", () => {
    const next = billOf(1, { dueOn: "2026-02-15" });
    expect(billsAtCancel([billOf(0, { status: "paid", paidMinor: 4999 }), next], "2026-02-14")).toEqual({ voids: [1], blocked: false });
    expect(billsAtCancel([billOf(0, { status: "paid", paidMinor: 4999 }), { ...next, paidMinor: 1000 }], "2026-02-14")).toEqual({ voids: [], blocked: true });
  });

  it("touches no bill that is already paid, cancelled or refunded", () => {
    const later = (status: BillFacts["status"]) => billOf(1, { dueOn: "2026-02-15", status, paidMinor: status === "paid" ? 4999 : 0 });
    expect(billsAtCancel([later("paid"), later("void"), later("refunded")], "2026-01-20")).toEqual({ voids: [], blocked: false });
  });
});

describe("the count of paid periods never disagrees with a settled bill", () => {
  const target = (m: HeldMembership, today: string, past = false) => {
    const found = memberPayTarget(m, 4999, today, [billOf(m.paidPeriods)], past);
    if (found === null) throw new Error("nothing to pay");
    return found;
  };

  it("moves on by one for a membership in use, and for a past member's that would be in use", () => {
    const unpaid = given(monthly, "2026-01-15", false, "2026-01-15");
    expect(countAfterPayment(unpaid, target(unpaid, "2026-01-16"), "2026-01-16")).toEqual({ ok: true, paidPeriods: 1 });
    expect(countAfterPayment(unpaid, target(unpaid, "2026-01-16", true), "2026-01-16")).toEqual({ ok: true, paidPeriods: 1 });
  });

  it("counts the one payment of a fixed term or a pack that is over: a pack given a class back then reads Paid, not Payment due", () => {
    const term = given(threeMonths, "2026-01-15", false, "2026-01-15");
    // Over since 15 April, and paid in May.
    const late = target(term, "2026-05-01");
    expect(late.advances).toBe(true);
    expect(countAfterPayment(term, late, "2026-05-01")).toEqual({ ok: true, paidPeriods: 1 });
    const used = { ...given(tenPack, "2026-01-01", false, "2026-01-01"), classesLeft: 0 };
    expect(countAfterPayment(used, target(used, "2026-01-10"), "2026-01-10")).toEqual({ ok: true, paidPeriods: 1 });
  });

  it("leaves a repeating membership that is over as it was: its last day stands on the count", () => {
    const cancelled = moved(given(monthly, "2026-01-15", false, "2026-01-15"), { type: "cancel", when: "today" }, "2026-02-20");
    const owed = target(cancelled, "2026-03-01");
    expect(owed.advances).toBe(false);
    expect(countAfterPayment(cancelled, owed, "2026-03-01")).toEqual({ ok: true, paidPeriods: null });
  });

  it("goes back with the payment taken back, for a fixed term that is over too", () => {
    const paid = given(monthly, "2026-01-15", true, "2026-01-15");
    expect(countAfterUndo(paid, true, "2026-01-16")).toEqual({ ok: true, paidPeriods: 0 });
    expect(countAfterUndo(paid, false, "2026-01-16")).toEqual({ ok: true, paidPeriods: null });
    const term = given(threeMonths, "2026-01-15", true, "2026-01-15");
    const settled = billOf(0, { status: "paid", paidMinor: 4999 });
    expect(memberUndoTarget(term, "2026-05-01", [settled], [{ id: "a", periodIndex: 0, seq: 1 }])).toEqual({ paymentId: "a", reopens: true, goesBack: true });
    expect(countAfterUndo(term, true, "2026-05-01")).toEqual({ ok: true, paidPeriods: 0 });
    // One set to stop keeps its count: nothing is taken back from under its last day.
    const stopping = moved(paid, { type: "cancel", when: "period_end" }, "2026-01-20");
    expect(countAfterUndo(stopping, true, "2026-01-21")).toEqual({ ok: false });
  });
});

describe("which payment can be taken back", () => {
  const paid = given(monthly, "2026-01-15", true, "2026-01-15");
  const settled = billOf(0, { status: "paid", paidMinor: 4999 });

  it("is the newest one, and the count of paid periods goes back with it", () => {
    expect(memberUndoTarget(paid, "2026-01-16", [settled], [{ id: "a", periodIndex: 0, seq: 1 }])).toEqual({ paymentId: "a", reopens: true, goesBack: true });
  });

  it("is the last part of a part-paid bill, which moves nothing", () => {
    const unpaid = given(monthly, "2026-01-15", false, "2026-01-15");
    const parts = [
      { id: "a", periodIndex: 0, seq: 1 },
      { id: "b", periodIndex: 0, seq: 2 },
    ];
    expect(memberUndoTarget(unpaid, "2026-01-16", [billOf(0, { paidMinor: 3000 })], parts)).toEqual({ paymentId: "b", reopens: false, goesBack: false });
  });

  it("is never an older payment while a newer one stands", () => {
    const two = moved(paid, { type: "paid", paidPeriods: 2 }, "2026-01-15");
    const bills = [settled, billOf(1, { status: "paid", paidMinor: 4999, dueOn: "2026-02-15" })];
    const payments = [
      { id: "a", periodIndex: 0, seq: 1 },
      { id: "b", periodIndex: 1, seq: 2 },
    ];
    expect(memberUndoTarget(two, "2026-01-16", bills, payments)?.paymentId).toBe("b");
  });

  it("is nothing on one set to stop: its last day stands on what is paid", () => {
    const stopping = moved(paid, { type: "cancel", when: "period_end" }, "2026-01-20");
    expect(memberUndoTarget(stopping, "2026-01-21", [settled], [{ id: "a", periodIndex: 0, seq: 1 }])).toBeNull();
  });

  it("is nothing where there is no payment", () => {
    expect(memberUndoTarget(paid, "2026-01-16", [settled], [])).toBeNull();
  });
});
