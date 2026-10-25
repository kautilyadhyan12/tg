// A payment taken in Square's own app (ROADMAP 18d-iii-b-i, 18d-iii-b-ii-a): the rule that says why it
// waits for staff, and when one bill is plain enough to be ticked for one press (`ready`), or that it is a
// shop sale. Nothing is put on a bill by itself (Kd, 2026-10-25: "one press"). The line kinds come from
// OUTSIDE this code: Square's OrderLineItemItemType
// (developer.squareup.com/reference/square/enums/OrderLineItemItemType, read 2026-10-24) is ITEM
// ("an itemized sale"), CUSTOM_AMOUNT ("a non-itemized sale") and GIFT_CARD ("a gift card sale"), and
// kinds Square has never sent (a new one, a missing one, Square's own words for other things) are
// never read as a typed amount. Every class of case of the rule is a row here.
import { describe, expect, it } from "vitest";
import {
  SQUARE_APP,
  chargedWithTaxes,
  squareAppDecision,
  squareAppEnteredMinor,
  squareAppLinesOf,
  squareAppPaidInParts,
  squareOrderAddedMinor,
  squareOrderAddsOnTop,
  squareTaxName,
  squareTaxNames,
  squareTaxesToOpen,
  taxesOnTypedAmounts,
  type SquareAppCandidate,
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
type Case = [name: string, p: Partial<Parameters<typeof squareAppDecision>[0]>, outcome: string];
const decide = (p: Case[1]): string => {
  const d = squareAppDecision({ lines: "typed", addedOnTop: false, enteredMinor: null, paidInParts: false, customer: "one", amountMinor: 4500, today: TODAY, candidates: [], ...p });
  return d.kind === "wait" ? d.reason : d.kind;
};

describe("squareAppDecision: why a payment from Square's own app waits, and when one bill is ticked", () => {
  it("never puts a payment on a bill by itself: the one bill that fits is `ready`, for one press", () => {
    for (const lines of ["typed", "items", "mixed", "unread"] as const) {
      for (const customer of ["none", "unknown", "one", "several"] as const) {
        const d = squareAppDecision({ lines, addedOnTop: false, enteredMinor: 4500, paidInParts: false, customer, amountMinor: 4500, today: TODAY, candidates: [period("amy", TODAY, 4500)] });
        expect(["wait", "shop_sale"]).toContain(d.kind);
      }
    }
  });

  // Items from the gym's list in Square (Square's ITEM and GIFT_CARD lines): a membership can be rung up as
  // an item, so a sale for the one person Square's customer is, of at least a bill due within the week,
  // waits and holds their card; anybody else's is a shop sale.
  it.each<Case>([
    ["items for a member owing exactly that this week", { lines: "items", candidates: [period("amy", "2026-10-28", 4500)] }, "shop_items"],
    ["items for a member owing less than the sale (tax on the item, or other items with it)", { lines: "items", amountMinor: 4871, candidates: [period("amy", TODAY, 4500)] }, "shop_items"],
    ["items paying an overdue bill", { lines: "items", candidates: [period("amy", "2026-10-01", 4500)] }, "shop_items"],
    ["items for a payer whose child owes this week", { lines: "items", candidates: [period("cal", "2026-10-30", 2500)] }, "shop_items"],
    ["items for a member owing a fee this week", { lines: "items", amountMinor: 1500, candidates: [fee("amy", TODAY, 1500)] }, "shop_items"],
    ["items for a member owing more than the sale", { lines: "items", amountMinor: 1200, candidates: [period("amy", TODAY, 4500)] }, "shop_sale"],
    ["items for a member whose bill is eight days off", { lines: "items", candidates: [period("amy", "2026-11-02", 4500)] }, "shop_sale"],
    ["items for a member owing nothing", { lines: "items", candidates: [] }, "shop_sale"],
    ["items for a member whose bill is paid (nothing left)", { lines: "items", candidates: [period("amy", TODAY, 0)] }, "shop_sale"],
    ["items with nobody picked in Square", { lines: "items", customer: "none", candidates: [period("amy", TODAY, 4500)] }, "shop_sale"],
    ["items for a customer no record holds", { lines: "items", customer: "unknown", candidates: [period("amy", TODAY, 4500)] }, "shop_sale"],
    ["items for a customer two records hold", { lines: "items", customer: "several", candidates: [period("amy", TODAY, 4500)] }, "shop_sale"],
  ])("%s: %s", (_name, p, outcome) => {
    expect(decide(p)).toBe(outcome);
  });

  it.each<Case>([
    // Who paid, then what was sold, come before any bill.
    ["no customer picked", { customer: "none", candidates: [period("amy", TODAY, 4500)] }, "no_customer"],
    ["a customer no record holds", { customer: "unknown", candidates: [period("amy", TODAY, 4500)] }, "not_linked"],
    ["a customer two records hold", { customer: "several", candidates: [period("amy", TODAY, 4500)] }, "several_people"],
    ["typed amounts and items together", { lines: "mixed", candidates: [period("amy", TODAY, 4500)] }, "mixed_sale"],
    ["what was sold could not be read", { lines: "unread", candidates: [period("amy", TODAY, 4500)] }, "sale_unread"],
    ["nobody picked, with Square's tax on top", { customer: "none", addedOnTop: true }, "no_customer"],
    // Square's tax added on top of what staff typed: the part typed is what a bill is matched to.
    ["tax on top, the part typed not shown", { addedOnTop: true, amountMinor: 4871, candidates: [period("amy", TODAY, 4500)] }, "square_tax"],
    // One payment of several for one sale (Square's split tender): staff say how much, even where it equals a bill.
    ["a sale paid in two payments, this one exactly a bill", { paidInParts: true, candidates: [period("amy", TODAY, 4500)] }, "paid_in_parts"],
    ["a sale paid in two payments, with tax on top", { paidInParts: true, addedOnTop: true, amountMinor: 4871, candidates: [period("amy", TODAY, 4871)] }, "paid_in_parts"],
    ["a sale paid in two payments, nobody picked", { paidInParts: true, customer: "none" }, "no_customer"],
    ["tax on top, the total happening to equal a bill, the part typed not shown", { addedOnTop: true, amountMinor: 4871, candidates: [period("amy", TODAY, 4871)] }, "square_tax"],
    ["tax on top, the part typed exactly the bill", { addedOnTop: true, enteredMinor: 4500, amountMinor: 4871, candidates: [period("amy", TODAY, 4500)] }, "ready"],
    ["tax on top, the total equal to a bill but the part typed not", { addedOnTop: true, enteredMinor: 4500, amountMinor: 4871, candidates: [period("amy", TODAY, 4871)] }, "no_bill"],
    // The bills.
    ["no bill at all", { candidates: [] }, "no_bill"],
    ["a bill of another amount", { candidates: [period("amy", TODAY, 4000)] }, "no_bill"],
    ["more than is left on the bill", { amountMinor: 4500, candidates: [period("amy", TODAY, 2500)] }, "no_bill"],
    ["less than is left on the bill", { amountMinor: 2500, candidates: [period("amy", TODAY, 4500)] }, "no_bill"],
    ["what is left of a bill part-paid, exactly", { amountMinor: 2500, candidates: [period("amy", TODAY, 2500)] }, "ready"],
    ["a bill due today", { candidates: [period("amy", TODAY, 4500)] }, "ready"],
    ["an overdue bill", { candidates: [period("amy", "2026-10-01", 4500)] }, "ready"],
    ["a bill due within the week", { candidates: [period("amy", "2026-11-01", 4500)] }, "ready"],
    ["a bill due in eight days", { candidates: [period("amy", "2026-11-02", 4500)] }, "too_early"],
    ["a fee of exactly that amount", { amountMinor: 1500, candidates: [period("amy", TODAY, 4500), fee("amy", "2026-10-24", 1500)] }, "ready"],
    ["bills of that amount owed by a payer and the person they pay for", { candidates: [period("ben", TODAY, 4500), period("cal", TODAY, 4500)] }, "several_bills"],
    ["the payer's older and the child's newer bill of that amount", { candidates: [period("ben", "2026-10-20", 4500), period("cal", TODAY, 4500)] }, "several_bills"],
    ["one person's bill of that amount, the other's of another", { candidates: [period("ben", TODAY, 4500), period("cal", TODAY, 3000)] }, "ready"],
    ["one person's older and newer bill of that amount", { candidates: [period("amy", TODAY, 4500), period("amy", "2026-10-18", 4500)] }, "ready"],
    ["two of one person's bills of that amount due the same day", { candidates: [period("amy", TODAY, 4500), fee("amy", TODAY, 4500)] }, "several_bills"],
    ["a bill too far ahead beside one due now", { candidates: [period("amy", "2026-12-01", 4500), period("amy", TODAY, 4500)] }, "ready"],
    ["somebody else's bill too far ahead beside one due now", { candidates: [period("cal", "2026-12-01", 4500), period("amy", TODAY, 4500)] }, "ready"],
    ["money for that membership out on the Terminal or the card on file", { candidates: [period("amy", TODAY, 4500, { busy: true })] }, "busy"],
    ["a bill not yet due, the one before it paid just now", { candidates: [period("amy", "2026-11-01", 4500, { paidJustBefore: true })] }, "maybe_twice"],
    ["a bill owed now, the one before it paid just now", { candidates: [period("amy", TODAY, 4500, { paidJustBefore: true })] }, "ready"],
  ])("%s: %s", (_name, p, outcome) => {
    expect(decide(p)).toBe(outcome);
  });

  it("a week is seven days", () => {
    expect(SQUARE_APP.aheadDays).toBe(7);
  });
});

// The tax check (18d-iii-b-i). The kinds and fields are Square's own ("OrderLineItemTax" type ADDITIVE,
// INCLUSIVE and UNKNOWN_TAX; "CatalogTax" inclusion_type, applies_to_custom_amounts, enabled and the
// catalog object's present_at_all_locations, present_at_location_ids, absent_at_location_ids; read
// 2026-10-25), and kinds Square has never sent are never taken as inside the price.
describe("squareAppPaidInParts: was the sale paid with more than this payment", () => {
  it.each([
    ["one tender, this payment", { tenders: [{ payment_id: "P1" }] }, false],
    ["two tenders", { tenders: [{ payment_id: "P1" }, { payment_id: "P2" }] }, true],
    ["one tender, another payment", { tenders: [{ payment_id: "P2" }] }, true],
    ["no tenders shown", {}, true],
    ["a tender with no payment named", { tenders: [{}] }, true],
  ] as const)("%s", (_name, order, parts) => {
    expect(squareAppPaidInParts(order, "P1")).toBe(parts);
  });
});

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

// What Match puts on a bill (18d-iii-b-ii-a): the part of the payment staff entered, without what Square
// added on top. The order's shape is Square's own, measured in its test area on 2026-10-25: a payment of
// 137 with a tip of 25 made one CUSTOM_AMOUNT line of 137 and ONE tender of 162 naming the payment, and
// the payment's own amount leaves the tip out. A sale paid with two payments (Square's split tender) has
// two tenders, and how much of each is a bill's can't be told from Square: the desk says.
describe("squareOrderAddedMinor: what Square added on top, in all", () => {
  it.each([
    ["nothing", {}, 0],
    ["a sales tax added", { taxes: [{ type: "ADDITIVE", applied_money: { amount: 371 } }] }, 371],
    ["two taxes added", { taxes: [{ type: "ADDITIVE", applied_money: { amount: 371 } }, { type: "ADDITIVE", applied_money: { amount: 405 } }] }, 776],
    ["a tax inside the price adds nothing", { taxes: [{ type: "INCLUSIVE", applied_money: { amount: 300 } }] }, 0],
    ["a tax of no kind is taken as added", { taxes: [{ applied_money: { amount: 50 } }] }, 50],
    ["a service charge", { total_service_charge_money: { amount: 200 } }, 200],
    ["a tax and a charge", { taxes: [{ type: "ADDITIVE", applied_money: { amount: 100 } }], total_service_charge_money: { amount: 200 } }, 300],
    ["a negative amount from Square counts as none", { taxes: [{ type: "ADDITIVE", applied_money: { amount: -100 } }] }, 0],
  ] as const)("%s", (_name, order, added) => {
    expect(squareOrderAddedMinor(order)).toBe(added);
  });
});

describe("squareAppEnteredMinor: the part staff entered, where Square shows it", () => {
  const one = (paymentId: string) => [{ payment_id: paymentId }];
  const typed = [{ item_type: "CUSTOM_AMOUNT" }];
  it.each([
    ["one typed amount, paid in one payment", { line_items: typed, tenders: one("P1") }, 2500, 2500],
    ["Square's sales tax on top: the amount before it", { line_items: typed, tenders: one("P1"), taxes: [{ type: "ADDITIVE", applied_money: { amount: 206 } }] }, 2706, 2500],
    ["a tax inside the price: all of it", { line_items: typed, tenders: one("P1"), taxes: [{ type: "INCLUSIVE", applied_money: { amount: 206 } }] }, 2500, 2500],
    ["two typed amounts: both", { line_items: [...typed, ...typed], tenders: one("P1") }, 5000, 5000],
    ["an item from Square's list too: not told", { line_items: [...typed, { item_type: "ITEM" }], tenders: one("P1") }, 7500, null],
    ["items alone: not told", { line_items: [{ item_type: "ITEM" }], tenders: one("P1") }, 3000, null],
    ["a line of a kind Square has not said: not told", { line_items: [{ item_type: "NEW_KIND" }], tenders: one("P1") }, 2500, null],
    ["no lines at all: not told", { line_items: [], tenders: one("P1") }, 2500, null],
    ["paid in two payments: not told", { line_items: typed, tenders: [{ payment_id: "P1" }, { payment_id: "P2" }] }, 1500, null],
    ["its one tender is another payment's: not told", { line_items: typed, tenders: one("P2") }, 2500, null],
    ["no tenders said: not told", { line_items: typed }, 2500, null],
    ["Square added as much as was taken: not told", { line_items: typed, tenders: one("P1"), taxes: [{ type: "ADDITIVE", applied_money: { amount: 2500 } }] }, 2500, null],
  ] as const)("%s", (_name, order, amountMinor, entered) => {
    expect(squareAppEnteredMinor(order, { id: "P1", amountMinor })).toBe(entered);
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
    ["custom amounts not said (never the all-clear)", tax({ appliesToCustomAmounts: null }), ["Sales tax"]],
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
