// Download payments' lines (ROADMAP 18n): every kind of line, voided or standing, refunded
// in part or whole, for each kind of person, in the file's words and signed numbers.
import { describe, expect, it } from "vitest";
import {
  coversWords,
  dayWords,
  paymentLine,
  paymentsDownloadQuerySchema,
  paymentsFileName,
  taxShare,
  type PaymentLineRow,
} from "../src/index.js";

const base: PaymentLineRow = {
  kind: "payment",
  on: "2026-10-01",
  receipt: 41,
  name: "Maya Patel",
  personDeleted: false,
  walkIn: false,
  item: "Gold Monthly",
  quantity: null,
  coversFrom: "2026-10-01",
  coversTo: "2026-10-31",
  amountMinor: 236_000,
  wholeMinor: 236_000,
  wholeTaxMinor: 36_000,
  method: "cash",
  voided: false,
  voidReason: null,
  forReceipt: null,
  refundReason: null,
  refundedMinor: 0,
  by: "Priya",
};
const row = (over: Partial<PaymentLineRow>): PaymentLineRow => ({ ...base, ...over });

describe("a line of the file", () => {
  // [what, the row, type, person, details, amount, tax, counted, status]
  const cases: [string, PaymentLineRow, string, string, string, number, number, number, string][] = [
    ["a membership payment of a whole bill", row({}), "Membership payment", "Maya Patel", "Gold Monthly · 1 Oct – 31 Oct 2026", 236_000, 36_000, 236_000, ""],
    ["a part payment: its share of the tax", row({ amountMinor: 118_000 }), "Membership payment", "Maya Patel", "Gold Monthly · 1 Oct – 31 Oct 2026", 118_000, 18_000, 118_000, ""],
    ["a membership of one period", row({ coversFrom: null, coversTo: null }), "Membership payment", "Maya Patel", "Gold Monthly", 236_000, 36_000, 236_000, ""],
    ["a payment partly given back", row({ refundedMinor: 1000 }), "Membership payment", "Maya Patel", "Gold Monthly · 1 Oct – 31 Oct 2026", 236_000, 36_000, 236_000, "Part refunded"],
    ["a payment all given back", row({ refundedMinor: 236_000 }), "Membership payment", "Maya Patel", "Gold Monthly · 1 Oct – 31 Oct 2026", 236_000, 36_000, 236_000, "Refunded"],
    ["a payment voided, with its reason", row({ voided: true, voidReason: "wrong_person" }), "Membership payment", "Maya Patel", "Gold Monthly · 1 Oct – 31 Oct 2026", 236_000, 0, 0, "Voided · Wrong person"],
    ["a payment voided before reasons were kept", row({ voided: true }), "Membership payment", "Maya Patel", "Gold Monthly · 1 Oct – 31 Oct 2026", 236_000, 0, 0, "Voided"],
    ["a payment of somebody deleted for good", row({ name: null, personDeleted: true }), "Membership payment", "A deleted member", "Gold Monthly · 1 Oct – 31 Oct 2026", 236_000, 36_000, 236_000, ""],
    ["a record with no name typed", row({ name: "  " }), "Membership payment", "No name on their record", "Gold Monthly · 1 Oct – 31 Oct 2026", 236_000, 36_000, 236_000, ""],
    ["a record whose name is null", row({ name: null }), "Membership payment", "No name on their record", "Gold Monthly · 1 Oct – 31 Oct 2026", 236_000, 36_000, 236_000, ""],
    [
      "a membership refund: minus, with the tax's share",
      row({ kind: "refund", amountMinor: 1000, forReceipt: 41, refundReason: "paid_twice", receipt: 44 }),
      "Membership refund",
      "Maya Patel",
      "Gold Monthly · 1 Oct – 31 Oct 2026",
      -1000,
      -153,
      -1000,
      "",
    ],
    ["a refund voided", row({ kind: "refund", amountMinor: 1000, forReceipt: 41, refundReason: "other", voided: true, voidReason: "mistake" }), "Membership refund", "Maya Patel", "Gold Monthly · 1 Oct – 31 Oct 2026", -1000, 0, 0, "Voided · Noted by mistake"],
    ["a refund voided with its payment", row({ kind: "refund", amountMinor: 1000, forReceipt: 41, refundReason: "other", voided: true }), "Membership refund", "Maya Patel", "Gold Monthly · 1 Oct – 31 Oct 2026", -1000, 0, 0, "Voided"],
    [
      "a product sale to a walk-in",
      row({ kind: "sale", name: null, walkIn: true, item: "Protein bar", quantity: 2, coversFrom: null, coversTo: null, amountMinor: 24_000, wholeMinor: 24_000, wholeTaxMinor: 3_661, method: "card_at_desk" }),
      "Product sale",
      "Walk-in",
      "2 × Protein bar",
      24_000,
      3_661,
      24_000,
      "",
    ],
    [
      "a sale given away whole by a discount",
      row({ kind: "sale", item: "Water", quantity: 1, coversFrom: null, coversTo: null, amountMinor: 0, wholeMinor: 0, wholeTaxMinor: 0 }),
      "Product sale",
      "Maya Patel",
      "1 × Water",
      0,
      0,
      0,
      "",
    ],
    [
      "a sale to a member deleted for good since",
      row({ kind: "sale", name: null, personDeleted: true, item: "Water", quantity: 1, coversFrom: null, coversTo: null, amountMinor: 2000, wholeMinor: 2000, wholeTaxMinor: 0 }),
      "Product sale",
      "A deleted member",
      "1 × Water",
      2000,
      0,
      2000,
      "",
    ],
    [
      "a sale voided",
      row({ kind: "sale", item: "Water", quantity: 1, coversFrom: null, coversTo: null, amountMinor: 2000, wholeMinor: 2000, wholeTaxMinor: 0, voided: true, voidReason: "wrong_item" }),
      "Product sale",
      "Maya Patel",
      "1 × Water",
      2000,
      0,
      0,
      "Voided · Wrong product or quantity",
    ],
    [
      "a product refund of part of a sale",
      row({ kind: "sale_refund", name: null, walkIn: true, item: "Protein bar", quantity: null, coversFrom: null, coversTo: null, amountMinor: 12_000, wholeMinor: 24_000, wholeTaxMinor: 3_661, forReceipt: 42, refundReason: "faulty" }),
      "Product refund",
      "Walk-in",
      "Protein bar",
      -12_000,
      -1_831,
      -12_000,
      "",
    ],
  ];
  it.each(cases)("%s", (_what, input, type, person, details, amount, tax, counted, status) => {
    const line = paymentLine(input);
    expect([line.type, line.person, line.details, line.amountMinor, line.taxMinor, line.countedMinor, line.status]).toEqual([type, person, details, amount, tax, counted, status]);
  });

  it("a refund names the receipt it gave back on and why; a payment or sale names neither", () => {
    expect(paymentLine(row({ kind: "refund", amountMinor: 1000, forReceipt: 41, refundReason: "paid_twice" }))).toMatchObject({ forReceipt: 41, refundReason: "Paid twice" });
    expect(paymentLine(row({ kind: "sale_refund", amountMinor: 1000, forReceipt: 42, refundReason: "returned" }))).toMatchObject({ forReceipt: 42, refundReason: "Brought back" });
    expect(paymentLine(row({ forReceipt: 9, refundReason: "paid_twice" }))).toMatchObject({ forReceipt: null, refundReason: "" });
  });

  it("each way of paying in the app's own words, and who took it", () => {
    const words = (["cash", "card_at_desk", "bank_transfer", "link", "company"] as const).map((method) => paymentLine(row({ method })).method);
    expect(words).toEqual(["Cash", "Card at the desk", "Bank transfer", "Payment link", "Card on file"]);
    expect(paymentLine(row({ by: null })).by).toBe("");
  });

  it("a reason the app does not know is never printed as a code", () => {
    expect(paymentLine(row({ voided: true, voidReason: "toString" })).status).toBe("Voided");
    expect(paymentLine(row({ kind: "refund", amountMinor: 1, forReceipt: 1, refundReason: "constructor" })).refundReason).toBe("");
  });
});

describe("the tax inside part of a whole", () => {
  it.each([
    [236_000, 236_000, 36_000, 36_000],
    [118_000, 236_000, 36_000, 18_000],
    [1, 236_000, 36_000, 0],
    [7, 100, 15, 1],
    [300_000, 236_000, 36_000, 36_000],
    [500, 0, 0, 0],
    [500, 1000, 0, 0],
  ])("%i of %i holding %i is %i", (part, whole, tax, want) => {
    expect(taxShare(part, whole, tax)).toBe(want);
  });
});

describe("the days asked", () => {
  it("takes both days or neither, a real day, and never a From after its To", () => {
    expect(paymentsDownloadQuerySchema.safeParse({}).success).toBe(true);
    expect(paymentsDownloadQuerySchema.safeParse({ from: "2026-10-01", to: "2026-10-31" }).success).toBe(true);
    expect(paymentsDownloadQuerySchema.safeParse({ from: "2026-10-31", to: "2026-10-31" }).success).toBe(true);
    for (const bad of [{ from: "2026-10-01" }, { to: "2026-10-01" }, { from: "2026-10-31", to: "2026-10-01" }, { from: "2026-02-30", to: "2026-03-01" }, { from: "1 Oct", to: "2026-10-01" }, { from: "2026-10-01", to: "2026-10-02", gymId: "x" }]) {
      expect(paymentsDownloadQuerySchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("the words for days and the file's name", () => {
  it("says days the way a receipt does", () => {
    expect(dayWords("2026-10-01")).toBe("1 Oct 2026");
    expect(coversWords("2026-10-01", "2026-10-31")).toBe("1 Oct – 31 Oct 2026");
    expect(coversWords("2026-12-15", "2027-01-14")).toBe("15 Dec 2026 – 14 Jan 2027");
    expect(paymentsFileName("2026-10-01", "2026-10-31", false)).toBe("Payments 1 Oct 2026 – 31 Oct 2026.xlsx");
    expect(paymentsFileName("2026-10-15", "2026-10-15", false)).toBe("Payments 15 Oct 2026.xlsx");
    expect(paymentsFileName("2025-03-02", "2026-10-16", true)).toBe("All payments to 16 Oct 2026.xlsx");
  });
});
