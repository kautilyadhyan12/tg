// The details a membership agreement fills in (ROADMAP 18u-i), over every kind of membership a
// price list holds and every fact that changes what a person pays or how long it runs.
import { describe, expect, it } from "vitest";
import { agreementFacts, agreementSignable, firstBillOf, type AgreementFactsInput } from "../src/membershipAgreement.js";

type Membership = AgreementFactsInput["membership"];
type FirstBill = AgreementFactsInput["firstBill"];

const view = (over: Partial<Membership["view"]> = {}): Membership["view"] => ({
  status: "active",
  endsOn: null,
  renewsOn: "2026-11-15",
  payment: null,
  can: { freeze: true, unfreeze: false, cancel: true, cancelAtPeriodEnd: null, markPaid: null, undoPaid: null },
  ...over,
});

const bill = (over: Partial<NonNullable<FirstBill>> = {}): FirstBill => ({ amountMinor: 5000, joiningFeeMinor: 0, part: false, covers: null, dueOn: "2026-10-15", ...over });

const monthly = (over: Partial<Membership> = {}): Membership => ({
  typeName: "Gold Monthly",
  kind: "recurring",
  priceMinor: 5000,
  currency: "USD",
  termCount: 1,
  termUnit: "month",
  packClasses: null,
  startsOn: "2026-10-15",
  discount: null,
  tax: null,
  view: view(),
  ...over,
});

const gym = { name: "Iron House", postalAddress: null, contactPhone: null, contactEmail: null };
/** The details, with a first bill of the price unless one is given (a free one has none). */
const facts = (membership: Membership, more: Partial<AgreementFactsInput> = {}) =>
  agreementFacts({ gym, personName: "Maya Patel", membership, firstBill: membership.priceMinor === 0 ? null : bill({ amountMinor: membership.priceMinor }), taxIncluded: false, ...more });
const valueOf = (list: { label: string; value: string }[], label: string) => list.find((f) => f.label === label)?.value;

const pack = (classes: number, endsOn: string) => monthly({ kind: "pack", termCount: null, termUnit: null, packClasses: classes, view: view({ endsOn }) });

describe("agreementFacts", () => {
  it("a repeating membership: the business, the person, the price and that it renews until cancelled, in reading order", () => {
    expect(facts(monthly())).toEqual([
      { label: "Business", value: "Iron House" },
      { label: "Member", value: "Maya Patel" },
      { label: "Membership", value: "Gold Monthly" },
      { label: "Price", value: "$50.00 every month" },
      { label: "First payment", value: "$50.00, due 15 Oct 2026" },
      { label: "Starts", value: "15 Oct 2026" },
      { label: "Renews", value: "Every month until you cancel" },
    ]);
  });

  it.each([
    ["every 3 months", monthly({ termCount: 3 }), "Price", "$50.00 every 3 months"],
    ["a year", monthly({ termUnit: "year" }), "Price", "$50.00 every year"],
    ["set to stop", monthly({ view: view({ endsOn: "2027-01-14", renewsOn: null }) }), "Ends", "14 Jan 2027"],
    ["paid once", monthly({ kind: "one_time", termCount: 6, view: view({ endsOn: "2027-04-14" }) }), "Price", "$50.00, paid once"],
    ["paid once, its end", monthly({ kind: "one_time", termCount: 6, view: view({ endsOn: "2027-04-14" }) }), "Ends", "14 Apr 2027"],
    ["a pack of ten", pack(10, "2027-01-12"), "Price", "$50.00 for 10 classes"],
    ["a day pass", pack(1, "2026-10-15"), "Price", "$50.00 for 1 class"],
    ["a pack's last day", pack(10, "2027-01-12"), "Use by", "12 Jan 2027"],
    ["a free trial", monthly({ kind: "trial", priceMinor: 0, termCount: 7, termUnit: "day", view: view({ endsOn: "2026-10-21" }) }), "Price", "Free"],
    ["a trial's end", monthly({ kind: "trial", priceMinor: 0, termCount: 7, termUnit: "day", view: view({ endsOn: "2026-10-21" }) }), "Ends", "21 Oct 2026"],
    ["a paid trial", monthly({ kind: "trial", priceMinor: 1000, termCount: 7, termUnit: "day", view: view({ endsOn: "2026-10-21" }) }), "Price", "$10.00"],
    ["rupees", monthly({ currency: "INR", priceMinor: 150000 }), "Price", "₹1,500.00 every month"],
    ["tax added", monthly({ tax: { name: "Sales tax", bp: 825 } }), "Price", "$50.00 every month, plus Sales tax 8.25%"],
    ["a discount on the first payment", monthly({ discount: { name: "Spring offer", offMinor: 1000, payments: "first" } }), "Discount", "Spring offer: $10.00 off the first payment"],
    ["a discount on every payment", monthly({ discount: { name: "Staff", offMinor: 500, payments: "every" } }), "Discount", "Staff: $5.00 off every payment, already taken off the price"],
  ] as const)("%s", (_case, membership, label, expected) => {
    expect(valueOf(facts(membership), label)).toBe(expected);
  });

  it.each([
    ["the joining fee", bill({ amountMinor: 7500, joiningFeeMinor: 2500 }), "$75.00, including the joining fee of $25.00, due 15 Oct 2026"],
    ["a part month", bill({ amountMinor: 2742, part: true, covers: { from: "2026-10-15", to: "2026-10-31" } }), "$27.42 for 15 Oct – 31 Oct 2026, due 15 Oct 2026"],
    ["nothing to pay on it", bill({ amountMinor: 0 }), undefined],
    ["no first bill listed", null, undefined],
  ] as const)("the first payment: %s", (_case, firstBill, expected) => {
    expect(valueOf(facts(monthly(), { firstBill }), "First payment")).toBe(expected);
  });

  it("tax already in the price says so; a free membership says nothing of tax or a first payment", () => {
    expect(valueOf(facts(monthly({ tax: { name: "GST", bp: 1800 } }), { taxIncluded: true }), "Price")).toBe("$50.00 every month, GST 18% included");
    const free = facts(monthly({ kind: "trial", priceMinor: 0, tax: { name: "GST", bp: 1800 }, termCount: 7, termUnit: "day", view: view({ endsOn: "2026-10-21" }) }));
    expect(valueOf(free, "Price")).toBe("Free");
    expect(valueOf(free, "First payment")).toBeUndefined();
  });

  it("the business's address, phone and email when it has them, the address on one line; a name with nothing in it left out", () => {
    const withContact = agreementFacts({
      gym: { name: "Iron House", postalAddress: "12 Main St\n  Austin, TX 78701 ", contactPhone: " +1 512 555 0100 ", contactEmail: "desk@ironhouse.com" },
      personName: "  ",
      membership: monthly(),
      firstBill: bill(),
      taxIncluded: false,
    });
    expect(withContact.slice(0, 4)).toEqual([
      { label: "Business", value: "Iron House" },
      { label: "Address", value: "12 Main St, Austin, TX 78701" },
      { label: "Phone", value: "+1 512 555 0100" },
      { label: "Email", value: "desk@ironhouse.com" },
    ]);
    expect(valueOf(withContact, "Member")).toBeUndefined();
  });

  it("the same membership gives the same details, word for word", () => {
    expect(JSON.stringify(facts(monthly()))).toBe(JSON.stringify(facts(monthly())));
  });
});

describe("firstBillOf", () => {
  it("the bill of the first period, whichever bills are listed; none with no billing", () => {
    const listed = { bills: [{ periodIndex: 2 }, { periodIndex: 0 }, { periodIndex: 1 }] };
    expect(firstBillOf(null)).toBeNull();
    // Only the field the rule reads matters here.
    expect(firstBillOf({ ...emptyBilling, bills: listed.bills.map((b) => ({ ...sampleBill, periodIndex: b.periodIndex })) })?.periodIndex).toBe(0);
    expect(firstBillOf({ ...emptyBilling, bills: [{ ...sampleBill, periodIndex: 1 }] })).toBeNull();
  });
});

const sampleBill = {
  id: "00000000-0000-4000-8000-000000000001",
  periodIndex: 0,
  covers: null,
  part: false,
  amountMinor: 5000,
  tax: null,
  joiningFeeMinor: 0,
  changeCreditMinor: 0,
  movedMinor: 0,
  paidMinor: 5000,
  dueOn: "2026-10-15",
  state: "paid" as const,
  refundedMinor: 0,
  cancelled: null,
  gift: null,
  payments: [],
  voidedPayments: [],
  chargeStop: null,
  cardDeclined: null,
  cardUnchecked: null,
  charging: false,
};
const emptyBilling = { bills: [], billsNotShown: 0, pay: null, cancel: null, undo: null, fees: [], change: null };

describe("agreementSignable", () => {
  it.each([
    ["active", true],
    ["upcoming", true],
    ["frozen", false],
    ["ended", false],
    ["cancelled", false],
  ] as const)("%s → %s", (status, expected) => {
    expect(agreementSignable(status)).toBe(expected);
  });
});
