// A payment taken in Square's own app (ROADMAP 18d-iii-b-i): the rule that says which bill, if any, it
// is recorded on. The line kinds come from OUTSIDE this code: Square's OrderLineItemItemType
// (developer.squareup.com/reference/square/enums/OrderLineItemItemType, read 2026-10-24) is ITEM
// ("an itemized sale"), CUSTOM_AMOUNT ("a non-itemized sale") and GIFT_CARD ("a gift card sale"), and
// kinds Square has never sent (a new one, a missing one, Square's own words for other things) are
// never read as a typed amount. Every class of case of the rule is a row here.
import { describe, expect, it } from "vitest";
import {
  SQUARE_APP,
  chargedWithTaxes,
  squareAppDecision,
  squareAppLinesOf,
  squareOrderAddsOnTop,
  squareTaxName,
  squareTaxNames,
  squareTaxesToOpen,
  taxesOnTypedAmounts,
  type SquareAppCandidate,
  type SquareAppDecision,
  type SquareTaxFacts,
} from "../src/index.js";

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
  squareAppDecision({ lines: "typed", addedOnTop: false, customer: "one", amountMinor: 4500, today: TODAY, candidates: [], ...p });
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

  it("waits where Square added tax or a charge on top of what staff typed, even where the total happens to equal a bill", () => {
    expect(decide({ addedOnTop: true, amountMinor: 4871, candidates: [period("amy", TODAY, 4871)] })).toEqual({ kind: "wait", reason: "square_tax" });
    // Who and what still come first: nobody picked, or items, say so before the tax does.
    expect(decide({ addedOnTop: true, customer: "none" })).toEqual({ kind: "wait", reason: "no_customer" });
    expect(decide({ addedOnTop: true, lines: "items" })).toEqual({ kind: "shop_sale" });
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

// The tax check (18d-iii-b-i). The kinds and fields are Square's own ("OrderLineItemTax" type ADDITIVE,
// INCLUSIVE and UNKNOWN_TAX; "CatalogTax" inclusion_type, applies_to_custom_amounts, enabled and the
// catalog object's present_at_all_locations, present_at_location_ids, absent_at_location_ids; read
// 2026-10-25), and kinds Square has never sent are never taken as inside the price.
describe("squareOrderAddsOnTop: did Square charge more than staff typed", () => {
  it.each([
    ["no taxes and no charge", {}, false],
    ["US sales tax added to the price", { taxes: [{ type: "ADDITIVE", applied_money: { amount: 371 } }] }, true],
    ["a tax inside the price", { taxes: [{ type: "INCLUSIVE", applied_money: { amount: 371 } }] }, false],
    ["a tax added that came to nothing", { taxes: [{ type: "ADDITIVE", applied_money: { amount: 0 } }] }, false],
    ["a tax of a kind Square has not said", { taxes: [{ type: "UNKNOWN_TAX", applied_money: { amount: 50 } }] }, true],
    ["a tax with no kind at all", { taxes: [{ applied_money: { amount: 50 } }] }, true],
    ["an automatic service charge", { total_service_charge_money: { amount: 200 } }, true],
    ["one tax inside, one added", { taxes: [{ type: "INCLUSIVE", applied_money: { amount: 300 } }, { type: "ADDITIVE", applied_money: { amount: 45 } }] }, true],
  ] as const)("%s", (_name, order, onTop) => {
    expect(squareOrderAddsOnTop(order)).toBe(onTop);
  });
});

const tax = (more: Partial<SquareTaxFacts> = {}): SquareTaxFacts => ({
  name: "Sales tax",
  percentage: "8.25",
  inclusionType: "ADDITIVE",
  appliesToCustomAmounts: true,
  enabled: true,
  deleted: false,
  atAllLocations: true,
  presentAt: [],
  absentAt: [],
  ...more,
});
const HERE = "LHERE";

describe("taxesOnTypedAmounts: the taxes Square adds on top of an amount staff type in, here", () => {
  it.each([
    ["switched on, added to the price, on custom amounts, every location", tax(), ["Sales tax"]],
    ["not on custom amounts", tax({ appliesToCustomAmounts: false }), []],
    ["custom amounts not said", tax({ appliesToCustomAmounts: null }), []],
    ["switched off", tax({ enabled: false }), []],
    ["switched on not said", tax({ enabled: null }), ["Sales tax"]],
    ["deleted", tax({ deleted: true }), []],
    ["inside the price", tax({ inclusionType: "INCLUSIVE" }), []],
    ["its kind not said (Square's default is added)", tax({ inclusionType: null }), ["Sales tax"]],
    ["a kind Square adds later", tax({ inclusionType: "SOMETHING_NEW" }), ["Sales tax"]],
    ["every location but this one", tax({ absentAt: [HERE] }), []],
    ["every location but another", tax({ absentAt: ["LOTHER"] }), ["Sales tax"]],
    ["only at another location", tax({ atAllLocations: false, presentAt: ["LOTHER"] }), []],
    ["only at this location", tax({ atAllLocations: false, presentAt: [HERE] }), ["Sales tax"]],
    ["all locations not said", tax({ atAllLocations: null }), ["Sales tax"]],
    ["no name", tax({ name: "  " }), ["A tax with no name"]],
  ] as const)("%s", (_name, t, names) => {
    expect(taxesOnTypedAmounts([t], HERE).map((x) => x.name)).toEqual(names);
  });

  it("keeps every tax that applies, in Square's own order", () => {
    expect(taxesOnTypedAmounts([tax(), tax({ name: "City tax", percentage: "1" }), tax({ name: "Off", enabled: false })], HERE)).toEqual([
      { name: "Sales tax", percentage: "8.25" },
      { name: "City tax", percentage: "1" },
    ]);
  });
});

describe("the check's example and names", () => {
  it("charges what Square would: each tax on the typed amount, rounded", () => {
    expect(chargedWithTaxes(4500, ["8.25"])).toBe(4871);
    expect(chargedWithTaxes(4500, ["8.25", "1"])).toBe(4916);
    expect(chargedWithTaxes(4500, ["13"])).toBe(5085);
    expect(chargedWithTaxes(4500, [null, "x", "0", "-5"])).toBe(4500);
  });

  it("names one tax, two, and three", () => {
    expect(squareTaxNames([{ name: "Sales tax", percentage: "8.25" }])).toBe("Sales tax (8.25%)");
    expect(squareTaxNames([{ name: "Sales tax", percentage: "8.25" }, { name: "City tax", percentage: null }])).toBe("Sales tax (8.25%) and City tax");
    expect(squareTaxNames([{ name: "GST", percentage: "5" }, { name: "PST", percentage: "7" }, { name: "City", percentage: "1" }])).toBe("GST (5%), PST (7%) and City (1%)");
  });

  it("names one tax with its rate, or by its name alone where Square gives none", () => {
    expect(squareTaxName({ name: "SALES TAX 2", percentage: "9.0" })).toBe("SALES TAX 2 (9.0%)");
    expect(squareTaxName({ name: "City tax", percentage: null })).toBe("City tax");
    expect(squareTaxName({ name: "City tax", percentage: "" })).toBe("City tax");
  });

  it("says which tax to open in Square's steps: its name, or each of them", () => {
    expect(squareTaxesToOpen([{ name: "Sales Tax" }])).toBe("[Sales Tax]");
    expect(squareTaxesToOpen([{ name: "GST" }, { name: "PST" }])).toBe("each tax, [GST] and [PST]");
    expect(squareTaxesToOpen([{ name: "GST" }, { name: "PST" }, { name: "City" }])).toBe("each tax, [GST], [PST] and [City]");
    expect(squareTaxesToOpen([])).toBe("the tax");
    // A bracket in Square's own name for a tax never closes the label early.
    expect(squareTaxesToOpen([{ name: "City [Austin] tax" }])).toBe("[City Austin tax]");
  });
});
