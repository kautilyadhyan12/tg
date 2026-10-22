// Move to another membership (spec Part 3 §14.8; ROADMAP 18x).
//
// The first block is the worst thing this job could do to a real person: charge a member
// again for days they have already paid for, or show them owing money they do not. Every
// amount below was worked out by hand from the calendar (October 2026 has 31 days; 1 Sep
// to 30 Nov is 91), never read back from the code: credit = what stands on the bill for
// those days, before tax, times the days left over the days in the period, rounded down.
import { describe, expect, it } from "vitest";
import {
  billDaysMinor,
  changeFrom,
  changeTo,
  giveHeldMembership,
  moveHeldMembership,
  movedMoneyMinor,
  paymentRefundableMinor,
  refundMemberPayment,
  withinLimit,
  type ChangeBillFacts,
  type ChangeFrom,
  type HeldMembership,
  type HeldMembershipTerms,
} from "../src/index.js";

const monthly: HeldMembershipTerms = { kind: "recurring", termCount: 1, termUnit: "month", packClasses: null, packDays: null, priceMinor: 5000 };
const weekly: HeldMembershipTerms = { ...monthly, termUnit: "week", priceMinor: 2000 };
const threeMonths: HeldMembershipTerms = { ...monthly, kind: "one_time", termCount: 3, priceMinor: 12000 };
const freeMonthly: HeldMembershipTerms = { ...monthly, priceMinor: 0 };
const tenPack: HeldMembershipTerms = { kind: "pack", termCount: null, termUnit: null, packClasses: 10, packDays: 60, priceMinor: 9000 };

const gold = { id: "gold", kind: "recurring" as const, priceMinor: 8000, termCount: 1, termUnit: "month" as const };
const silver = { id: "silver", kind: "recurring" as const, priceMinor: 5000, termCount: 1, termUnit: "month" as const };
const silverOnce = { id: "silver-once", kind: "one_time" as const, priceMinor: 5000, termCount: 3, termUnit: "month" as const };
const basic = { id: "basic", kind: "recurring" as const, priceMinor: 3000, termCount: 1, termUnit: "month" as const };
const free = { id: "free", kind: "recurring" as const, priceMinor: 0, termCount: 1, termUnit: "month" as const };
const pack = { id: "pack", kind: "pack" as const, priceMinor: 9000, termCount: null, termUnit: null };

function given(type: HeldMembershipTerms, startsOn: string, paid: boolean, today: string): HeldMembership {
  const made = giveHeldMembership(type, startsOn, paid, today);
  if (!made.ok) throw new Error(`not given: ${made.reason}`);
  return made.membership;
}

function paidBill(periodIndex: number, amountMinor: number, more: Partial<ChangeBillFacts> = {}): ChangeBillFacts {
  return { periodIndex, status: "paid", amountMinor, tax: null, joiningFeeMinor: 0, changeCreditMinor: 0, paidMinor: amountMinor, refundedMinor: 0, ...more };
}

function ok(from: ChangeFrom): Extract<ChangeFrom, { ok: true }> {
  if (!from.ok) throw new Error(`refused: ${from.reason}`);
  return from;
}

describe("the worst thing: a member is never charged twice for the same days", () => {
  // Gold Monthly at $50.00, started and paid on 1 Oct; changed on 16 Oct. 16 to 31 Oct is 16 days.
  const m = given(monthly, "2026-10-01", true, "2026-10-01");
  const from = ok(changeFrom(m, 5000, [paidBill(0, 5000)], "2026-10-16"));

  it("takes the 16 unpaid-for days off the new first bill", () => {
    expect(from.daysLeft).toBe(16);
    expect(from.creditMinor).toBe(2580); // 5000 × 16 / 31 = 2580.6
    expect(changeTo(from, "basic-monthly", gold, "today", "2026-10-16")).toEqual({
      ok: true,
      startsOn: "2026-10-16",
      fullFrom: null,
      creditMinor: 2580,
      firstListedMinor: 5420,
      paidByChange: false,
    });
  });

  it("charges nothing new before the paid month is over, on the next payment date", () => {
    expect(from.nextOn).toBe("2026-11-01");
    expect(changeTo(from, "basic-monthly", gold, "next_payment", "2026-10-16")).toEqual({
      ok: true,
      startsOn: "2026-11-01",
      fullFrom: null,
      creditMinor: 0,
      firstListedMinor: 8000,
      paidByChange: false,
    });
  });

  it("never credits days nobody paid for: an unpaid month cannot be changed", () => {
    const unpaid = given(monthly, "2026-10-01", false, "2026-10-01");
    expect(changeFrom(unpaid, 5000, [{ ...paidBill(0, 5000), status: "open", paidMinor: 0 }], "2026-10-16")).toEqual({ ok: false, reason: "unpaid" });
  });

  it("never leaves money over: a cheaper membership today is refused, and waits for the next payment", () => {
    const dear = ok(changeFrom(m, 8000, [paidBill(0, 8000)], "2026-10-16"));
    expect(dear.creditMinor).toBe(4129); // 8000 × 16 / 31 = 4129.03
    expect(changeTo(dear, "gold-monthly", basic, "today", "2026-10-16")).toEqual({ ok: false, reason: "left_over" });
    expect(changeTo(dear, "gold-monthly", basic, "next_payment", "2026-10-16")).toMatchObject({ ok: true, startsOn: "2026-11-01", firstListedMinor: 3000 });
  });
});

describe("what stands on a paid bill for its days", () => {
  const m = given(monthly, "2026-10-01", true, "2026-10-01");
  const credit = (bill: ChangeBillFacts, held = 5000): number => ok(changeFrom(m, held, [bill], "2026-10-16")).creditMinor;

  it.each([
    ["tax added on top is not the days' price", paidBill(0, 5500, { tax: { minor: 500, included: false } }), 2580],
    ["a price that holds its tax is the amount itself", paidBill(0, 5500, { tax: { minor: 500, included: true } }), 2838], // 5500 × 16 / 31 = 2838.7
    ["a joining fee is never part of the days", paidBill(0, 7500, { joiningFeeMinor: 2500 }), 2580],
    ["a fee and tax on top together", paidBill(0, 8250, { joiningFeeMinor: 2500, tax: { minor: 750, included: false } }), 2580],
    ["a refund comes off what stands", paidBill(0, 5000, { refundedMinor: 2000 }), 1548], // 3000 × 16 / 31 = 1548.4
    ["refunded in full leaves nothing", paidBill(0, 5000, { status: "refunded", refundedMinor: 5000 }), 0],
    ["a bill staff cancelled was never charged", paidBill(0, 5000, { status: "void", paidMinor: 0 }), 0],
    ["a first-payment discount: only what was paid", paidBill(0, 4000), 2064], // 4000 × 16 / 31 = 2064.5
    ["an earlier change's credit was paid too", paidBill(0, 2420, { changeCreditMinor: 2580 }), 2580],
  ])("%s", (_name, bill, expected) => {
    expect(credit(bill)).toBe(expected);
  });

  it("a period counted as paid with no bill (before it was given here) is worth its price", () => {
    expect(ok(changeFrom(m, 5000, [], "2026-10-16")).creditMinor).toBe(2580);
  });

  it("billDaysMinor reads a bill alone", () => {
    expect(billDaysMinor(paidBill(0, 5500, { tax: { minor: 500, included: false }, changeCreditMinor: 100 }))).toBe(5100);
  });
});

describe("every kind of membership in use", () => {
  it("a month paid ahead is credited whole", () => {
    const m = given(monthly, "2026-10-01", true, "2026-10-01");
    const ahead = moveHeldMembership(m, { type: "paid", paidPeriods: 2 }, "2026-10-01");
    if (!ahead.ok) throw new Error("not paid ahead");
    const from = ok(changeFrom(ahead.membership, 5000, [paidBill(0, 5000), paidBill(1, 5000)], "2026-10-16"));
    expect(from.creditMinor).toBe(7580);
    expect(from.nextOn).toBe("2026-12-01");
    expect(changeTo(from, "basic-monthly", gold, "today", "2026-10-16")).toMatchObject({ ok: true, firstListedMinor: 420 });
  });

  it("weekly: Monday 12 Oct to Sunday 18 Oct, changed on Friday 16 Oct, has 3 days left", () => {
    const m = given(weekly, "2026-10-12", true, "2026-10-12");
    const from = ok(changeFrom(m, 2000, [paidBill(0, 2000)], "2026-10-16"));
    expect(from.daysLeft).toBe(3);
    expect(from.creditMinor).toBe(857); // 2000 × 3 / 7 = 857.1
    expect(from.nextOn).toBe("2026-10-19");
  });

  it("paid once for three months (1 Sep to 30 Nov, 91 days) moves to a repeating one", () => {
    const m = given(threeMonths, "2026-09-01", true, "2026-09-01");
    const from = ok(changeFrom(m, 12000, [paidBill(0, 12000)], "2026-10-16"));
    expect(from.daysLeft).toBe(46); // 16 days of October and 30 of November
    expect(from.creditMinor).toBe(6065); // 12000 × 46 / 91 = 6065.9
    expect(from.nextOn).toBe("2026-12-01");
    expect(changeTo(from, "three-months", gold, "today", "2026-10-16")).toMatchObject({ ok: true, firstListedMinor: 1935 });
  });

  it("paid once and not yet paid cannot be changed", () => {
    const m = given(threeMonths, "2026-09-01", false, "2026-09-01");
    expect(changeFrom(m, 12000, [], "2026-10-16")).toEqual({ ok: false, reason: "unpaid" });
  });

  it("set to stop at the end of what is paid: the next payment date is the day after it stops", () => {
    const m = given(monthly, "2026-10-01", true, "2026-10-01");
    const stops = moveHeldMembership(m, { type: "cancel", when: "period_end" }, "2026-10-10");
    if (!stops.ok) throw new Error("not stopped");
    expect(ok(changeFrom(stops.membership, 5000, [paidBill(0, 5000)], "2026-10-16")).nextOn).toBe("2026-11-01");
  });

  it("a free one has nothing to credit and no payment date to wait for", () => {
    const m = given(freeMonthly, "2026-10-01", false, "2026-10-01");
    const from = ok(changeFrom(m, 0, [], "2026-10-16"));
    expect(from.creditMinor).toBe(0);
    expect(from.nextOn).toBeNull();
    expect(changeTo(from, "free", gold, "today", "2026-10-16")).toMatchObject({ ok: true, firstListedMinor: 8000 });
    expect(changeTo(from, "free", gold, "next_payment", "2026-10-16")).toEqual({ ok: false, reason: "no_next_payment" });
  });

  it("frozen, not started, a class pack and one that is over cannot be changed", () => {
    const m = given(monthly, "2026-10-01", true, "2026-10-01");
    const frozen = moveHeldMembership(m, { type: "freeze" }, "2026-10-10");
    if (!frozen.ok) throw new Error("not frozen");
    expect(changeFrom(frozen.membership, 5000, [], "2026-10-16")).toEqual({ ok: false, reason: "frozen" });
    expect(changeFrom(given(monthly, "2026-11-01", true, "2026-10-16"), 5000, [], "2026-10-16")).toEqual({ ok: false, reason: "not_started" });
    expect(changeFrom(given(tenPack, "2026-10-01", true, "2026-10-01"), 9000, [], "2026-10-16")).toEqual({ ok: false, reason: "not_changeable" });
    const cancelled = moveHeldMembership(m, { type: "cancel", when: "today" }, "2026-10-10");
    if (!cancelled.ok) throw new Error("not cancelled");
    expect(changeFrom(cancelled.membership, 5000, [], "2026-10-16")).toEqual({ ok: false, reason: "not_changeable" });
  });
});

describe("Refer a friend's free days are never credited (round one, High-1)", () => {
  // Basic at $50.00 paid for October, with 10 free days: the period runs 1 Oct to 10 Nov, and only
  // its first 31 days were paid for.
  const m = { ...given(monthly, "2026-10-01", true, "2026-10-01"), giftDays: 10, giftFrom: 1 };

  it("on 16 Oct, the 16 paid days left are credited, never the free ones", () => {
    expect(ok(changeFrom(m, 5000, [paidBill(0, 5000)], "2026-10-16"))).toMatchObject({ creditMinor: 2580, daysLeft: 16, nextOn: "2026-11-11" });
  });

  it("on 5 Nov, inside the free days, nothing paid is left", () => {
    const from = ok(changeFrom(m, 5000, [paidBill(0, 5000)], "2026-11-05"));
    expect([from.creditMinor, from.daysLeft]).toEqual([0, 0]);
    expect(changeTo(from, "basic-monthly", gold, "today", "2026-11-05")).toMatchObject({ ok: true, firstListedMinor: 8000 });
  });
});

describe("the money a change moved is never refunded from the old bill (round one, High-2)", () => {
  it.each([
    ["no tax: the $25.80 credited", paidBill(0, 5000), 2580, 2580],
    ["tax on top: the credit and its tax", paidBill(0, 5500, { tax: { minor: 500, included: false } }), 2580, 2838],
    ["a joining fee stays refundable", paidBill(0, 7500, { joiningFeeMinor: 2500 }), 2580, 2580],
    ["a partial refund before the change: only what stands", paidBill(0, 5000, { refundedMinor: 2000 }), 1548, 1548],
    ["a month paid ahead moves whole", paidBill(1, 5000), 5000, 5000],
    ["an earlier change's credit was never money on this bill", paidBill(0, 2420, { changeCreditMinor: 2580 }), 2580, 1249], // 2580 × 2420 / 5000 = 1248.7
    ["a bill staff cancelled moved nothing", paidBill(0, 5000, { status: "void", paidMinor: 0 }), 2580, 0],
  ])("%s", (_name, bill, credit, moved) => {
    expect(movedMoneyMinor(bill, credit)).toBe(moved);
  });

  it("$50.00 paid, $25.80 moved: $24.20 can be refunded and not a cent more", () => {
    const bill = { status: "paid" as const, paidMinor: 5000, refundedMinor: 0, movedMinor: 2580 };
    const payment = { amountMinor: 5000, refundedMinor: 0 };
    expect(paymentRefundableMinor(bill, payment)).toBe(2420);
    expect(refundMemberPayment(bill, payment, 2421)).toEqual({ ok: false, reason: "too_much", leftMinor: 2420 });
    expect(refundMemberPayment(bill, payment, 2420)).toEqual({ ok: true, billStatus: "paid" });
    expect(paymentRefundableMinor({ ...bill, refundedMinor: 2420 }, { amountMinor: 5000, refundedMinor: 2420 })).toBe(0);
  });
});

describe("bookings moved within the new type's own limit (round one, Low-3)", () => {
  // Monday 19 Oct to Sunday 25 Oct is one week; Monday 26 Oct starts the next.
  const booked = [
    { id: "wed", day: "2026-10-21" },
    { id: "mon", day: "2026-10-19" },
    { id: "fri", day: "2026-10-23" },
    { id: "next-mon", day: "2026-10-26" },
  ];
  it.each([
    ["no limit: all of them", null, null, ["wed", "mon", "fri", "next-mon"]],
    ["two a week: the first two of each week", 2, "week", ["mon", "wed", "next-mon"]],
    ["one a month: the first in October only", 1, "month", ["mon"]],
  ] as const)("%s", (_name, limit, period, moved) => {
    expect(withinLimit(booked, limit, period)).toEqual(moved);
  });
});

describe("what it can change to", () => {
  const m = given(monthly, "2026-10-16", true, "2026-10-16");
  // Started today: every day of the month is left, so the credit is the whole $50.00.
  const from = ok(changeFrom(m, 5000, [paidBill(0, 5000)], "2026-10-16"));

  it("the credit is the whole price on the first day", () => {
    expect(from.creditMinor).toBe(5000);
  });

  it("the same price, repeating: it starts paid by the change, with no bill", () => {
    expect(changeTo(from, "basic-monthly", silver, "today", "2026-10-16")).toEqual({ ok: true, startsOn: "2026-10-16", fullFrom: null, creditMinor: 5000, firstListedMinor: 0, paidByChange: true });
  });

  it("the same price, paid once: refused, as it would be paid with no bill behind it", () => {
    expect(changeTo(from, "basic-monthly", silverOnce, "today", "2026-10-16")).toEqual({ ok: false, reason: "nothing_to_pay" });
  });

  it("a free one with money paid would leave it over", () => {
    expect(changeTo(from, "basic-monthly", free, "today", "2026-10-16")).toEqual({ ok: false, reason: "left_over" });
  });

  it("not the type it already is, and not a class pack", () => {
    expect(changeTo(from, "gold", gold, "today", "2026-10-16")).toEqual({ ok: false, reason: "same_type" });
    expect(changeTo(from, "basic-monthly", pack, "today", "2026-10-16")).toEqual({ ok: false, reason: "kind_not_allowed" });
  });
});
