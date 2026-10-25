// A payment taken in Square's own app (ROADMAP 18d-iii-b-i): the rule that says which bill, if any, it
// is recorded on. The line kinds come from OUTSIDE this code: Square's OrderLineItemItemType
// (developer.squareup.com/reference/square/enums/OrderLineItemItemType, read 2026-10-24) is ITEM
// ("an itemized sale"), CUSTOM_AMOUNT ("a non-itemized sale") and GIFT_CARD ("a gift card sale"), and
// kinds Square has never sent (a new one, a missing one, Square's own words for other things) are
// never read as a typed amount. Every class of case of the rule is a row here.
import { describe, expect, it } from "vitest";
import { SQUARE_APP, squareAppDecision, squareAppLinesOf, type SquareAppCandidate, type SquareAppDecision } from "../src/index.js";

describe("squareAppLinesOf: what Square says was sold", () => {
  it.each([
    [["CUSTOM_AMOUNT"], "typed"],
    [["CUSTOM_AMOUNT", "CUSTOM_AMOUNT"], "typed"],
    [["ITEM"], "items"],
    [["GIFT_CARD"], "items"],
    [["ITEM", "GIFT_CARD"], "items"],
    [["CUSTOM_AMOUNT", "ITEM"], "mixed"],
    [["GIFT_CARD", "CUSTOM_AMOUNT"], "mixed"],
    // Nothing that can be read: no lines, a line with no kind, a kind Square adds later, Square's word
    // for another thing, a kind in other letters.
    [[], "unread"],
    [[null], "unread"],
    [[undefined], "unread"],
    [["SERVICE"], "unread"],
    [["CUSTOM_AMOUNT", "DISCOUNT"], "unread"],
    [["custom_amount"], "unread"],
    [["ITEM", "FEE"], "unread"],
  ] as const)("%j is %s", (kinds, lines) => {
    expect(squareAppLinesOf(kinds)).toBe(lines);
  });
});

const TODAY = "2026-10-25";
const period = (entryId: string, dueOn: string, leftMinor: number, more: Partial<SquareAppCandidate> = {}): SquareAppCandidate => ({
  entryId,
  target: { kind: "period", membershipId: `m-${entryId}-${dueOn}`, periodIndex: 3 },
  leftMinor,
  dueOn,
  paidJustBefore: false,
  busy: false,
  ...more,
});
const fee = (entryId: string, dueOn: string, leftMinor: number): SquareAppCandidate => ({
  entryId,
  target: { kind: "fee", membershipId: `m-${entryId}`, billId: `fee-${entryId}-${dueOn}` },
  leftMinor,
  dueOn,
  paidJustBefore: false,
  busy: false,
});
const decide = (p: Partial<Parameters<typeof squareAppDecision>[0]>): SquareAppDecision =>
  squareAppDecision({ lines: "typed", customer: "one", amountMinor: 4500, today: TODAY, candidates: [], ...p });
const recorded = (d: SquareAppDecision) => (d.kind === "record" ? d.candidate : null);

describe("squareAppDecision: which bill a payment from Square's own app is recorded on", () => {
  it("items from the gym's list in Square are a shop sale, whoever bought them and whatever they owe", () => {
    for (const customer of ["none", "unknown", "one", "several"] as const) {
      expect(decide({ lines: "items", customer, candidates: [period("amy", TODAY, 4500)] })).toEqual({ kind: "shop_sale" });
    }
  });

  it.each([
    ["no customer picked", { customer: "none" }, "no_customer"],
    ["a customer no record holds", { customer: "unknown" }, "not_linked"],
    ["a customer two records hold", { customer: "several" }, "several_people"],
    ["typed amounts and items together", { lines: "mixed" }, "mixed_sale"],
    ["what was sold could not be read", { lines: "unread" }, "sale_unread"],
  ] as const)("waits for staff: %s", (_name, p, reason) => {
    expect(decide({ ...p, candidates: [period("amy", TODAY, 4500)] })).toEqual({ kind: "wait", reason });
  });

  it("waits where no bill is exactly what was paid: none at all, another amount, more than is left", () => {
    expect(decide({ candidates: [] })).toEqual({ kind: "wait", reason: "no_bill" });
    expect(decide({ candidates: [period("amy", TODAY, 4000)] })).toEqual({ kind: "wait", reason: "no_bill" });
    expect(decide({ amountMinor: 4500, candidates: [period("amy", TODAY, 2500)] })).toEqual({ kind: "wait", reason: "no_bill" });
    expect(decide({ amountMinor: 2500, candidates: [period("amy", TODAY, 4500)] })).toEqual({ kind: "wait", reason: "no_bill" });
  });

  it("records what is left of a bill part-paid, exactly", () => {
    const left = period("amy", TODAY, 2500);
    expect(recorded(decide({ amountMinor: 2500, candidates: [left] }))).toEqual(left);
  });

  it("pays a bill early by itself only within a week of its day", () => {
    const week = period("amy", "2026-11-01", 4500);
    const eight = period("amy", "2026-11-02", 4500);
    expect(SQUARE_APP.aheadDays).toBe(7);
    expect(recorded(decide({ candidates: [week] }))).toEqual(week);
    expect(decide({ candidates: [eight] })).toEqual({ kind: "wait", reason: "too_early" });
  });

  it("records a bill due today or overdue", () => {
    const overdue = period("amy", "2026-10-01", 4500);
    expect(recorded(decide({ candidates: [overdue] }))).toEqual(overdue);
    const today = period("amy", TODAY, 4500);
    expect(recorded(decide({ candidates: [today] }))).toEqual(today);
  });

  it("waits where bills of that amount are owed by two people, a payer's and the person they pay for", () => {
    expect(decide({ candidates: [period("ben", TODAY, 4500), period("cal", TODAY, 4500)] })).toEqual({ kind: "wait", reason: "several_bills" });
    expect(decide({ candidates: [period("ben", "2026-10-20", 4500), period("cal", TODAY, 4500)] })).toEqual({ kind: "wait", reason: "several_bills" });
  });

  it("records the one person's bill of that amount where the other person's differs", () => {
    const ben = period("ben", TODAY, 4500);
    expect(recorded(decide({ candidates: [ben, period("cal", TODAY, 3000)] }))).toEqual(ben);
    const cal = period("cal", TODAY, 4500);
    expect(recorded(decide({ candidates: [period("ben", TODAY, 3000), cal] }))).toEqual(cal);
  });

  it("records one person's older bill of that amount, and waits where two of theirs fall due the same day", () => {
    const older = period("amy", "2026-10-18", 4500);
    const newer = period("amy", TODAY, 4500);
    expect(recorded(decide({ candidates: [newer, older] }))).toEqual(older);
    expect(decide({ candidates: [period("amy", TODAY, 4500), fee("amy", TODAY, 4500)] })).toEqual({ kind: "wait", reason: "several_bills" });
  });

  it("records a fee of exactly that amount", () => {
    const late = fee("amy", "2026-10-24", 1500);
    expect(recorded(decide({ amountMinor: 1500, candidates: [period("amy", TODAY, 4500), late] }))).toEqual(late);
  });

  it("a bill too far ahead never stands in the way of one due now", () => {
    const now = period("amy", TODAY, 4500);
    expect(recorded(decide({ candidates: [period("amy", "2026-12-01", 4500), now] }))).toEqual(now);
    // Somebody else's bill too far ahead is not "two people" either.
    expect(recorded(decide({ candidates: [period("cal", "2026-12-01", 4500), now] }))).toEqual(now);
  });

  it("waits while a payment for that membership is on the Terminal or its card is being charged", () => {
    expect(decide({ candidates: [period("amy", TODAY, 4500, { busy: true })] })).toEqual({ kind: "wait", reason: "busy" });
  });

  it("waits where a bill not yet due would be paid straight after the one before it: the person may have paid twice", () => {
    expect(decide({ candidates: [period("amy", "2026-11-01", 4500, { paidJustBefore: true })] })).toEqual({ kind: "wait", reason: "maybe_twice" });
    // Due today or before, it is owed now: recorded, whatever was paid before it.
    const owed = period("amy", TODAY, 4500, { paidJustBefore: true });
    expect(recorded(decide({ candidates: [owed] }))).toEqual(owed);
  });
});
