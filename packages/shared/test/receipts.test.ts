// WHAT A RECEIPT PRINTS (spec Part 3 §14.3; ROADMAP 18g-i).
//
// Every amount below is worked by hand from the published rate, never from the function:
// Texas's 8.25% added on top, India's GST of 18% inside the price, the UK's VAT of 20%
// inside the price.
import { describe, expect, it } from "vitest";
import { receiptAmounts, receiptBalance, receiptParamsSchema, receiptSchema } from "../src/index.js";

describe("receiptAmounts", () => {
  it.each([
    // [what it is, input, listed, total]
    ["no tax, no discount: the price is the total", { totalMinor: 5000, taxes: [], discount: null }, 5000, 5000],
    ["8.25% on top of $50.00: $4.13 tax, listed $50.00", { totalMinor: 5413, taxes: [{ name: "Sales tax", pcm: 8250, included: false, minor: 413 }], discount: null }, 5000, 5413],
    ["GST 18% inside ₹2,000.00: ₹305.08 of it is tax, listed ₹2,000.00", { totalMinor: 200000, taxes: [{ name: "GST", pcm: 18000, included: true, minor: 30508 }], discount: null }, 200000, 200000],
    ["VAT 20% inside £50.00: £8.33 of it", { totalMinor: 5000, taxes: [{ name: "VAT", pcm: 20000, included: true, minor: 833 }], discount: null }, 5000, 5000],
    [
      "two $2.50 bottles, 20% off, 8.25% on top: listed $5.00, $1.00 off, $0.33 tax, $4.33",
      { totalMinor: 433, listedMinor: 500, taxes: [{ name: "Sales tax", pcm: 8250, included: false, minor: 33 }], discount: { name: "Staff 20", minor: 100 } },
      500,
      433,
    ],
    ["a sale whose rate was 0 names no tax", { totalMinor: 250, listedMinor: 250, taxes: [{ name: null, pcm: 0, included: false, minor: 0 }], discount: null }, 250, 250],
    [
      "Quebec, $100.00 with GST 5% and QST 9.975% on top: listed $100.00, $114.98",
      { totalMinor: 11498, taxes: [{ name: "GST", pcm: 5000, included: false, minor: 500 }, { name: "QST", pcm: 9975, included: false, minor: 998 }], discount: null },
      10000,
      11498,
    ],
    [
      "India, ₹1,180 with CGST 9% and SGST 9% inside: listed ₹1,180",
      { totalMinor: 118000, taxes: [{ name: "CGST", pcm: 9000, included: true, minor: 9000 }, { name: "SGST", pcm: 9000, included: true, minor: 9000 }], discount: null },
      118000,
      118000,
    ],
  ] as const)("%s", (_what, input, listed, total) => {
    const got = receiptAmounts(input);
    expect(got.listedMinor).toBe(listed);
    expect(got.totalMinor).toBe(total);
    expect(got.taxes).toEqual(input.taxes.filter((x) => x.pcm > 0));
  });
});

describe("receiptBalance", () => {
  it.each([
    ["one payment of the whole bill", 6000, 0, 6000, null],
    ["the first of two parts", 6000, 0, 2000, { paidBeforeMinor: 0, leftMinor: 4000 }],
    ["the part that settles it", 6000, 2000, 4000, { paidBeforeMinor: 2000, leftMinor: 0 }],
    ["a middle part", 6000, 1000, 2000, { paidBeforeMinor: 1000, leftMinor: 3000 }],
  ] as const)("%s", (_what, bill, before, paid, want) => {
    expect(receiptBalance(bill, before, paid)).toEqual(want);
  });
});

describe("receiptParamsSchema", () => {
  const gymId = "00000000-0000-4000-8000-000000000001";
  it("takes a receipt number as plain digits", () => {
    expect(receiptParamsSchema.parse({ gymId, number: "1" })).toEqual({ gymId, number: 1 });
    expect(receiptParamsSchema.parse({ gymId, number: "2147483647" })).toEqual({ gymId, number: 2147483647 });
  });
  it.each(["0", "01", "-1", "1.5", "1e3", " 1", "abc", "", "2147483648", "99999999999"])("refuses %j", (number) => {
    expect(receiptParamsSchema.safeParse({ gymId, number }).success).toBe(false);
  });
});

describe("receiptSchema", () => {
  const common = { number: 1, gym: { name: "Iron Works", address: null }, on: "2026-10-15", person: null, personDeleted: false, by: null, currency: "USD", cancelled: false };
  it("a sale is paid by hand: a payment link is refused on one", () => {
    const sale = {
      ...common,
      kind: "sale",
      lines: [{ name: "Water", quantity: 1, unitPriceMinor: 250, amounts: { listedMinor: 250, discount: null, taxes: [], totalMinor: 250 } }],
      totalMinor: 250,
      method: "cash",
    };
    expect(receiptSchema.safeParse(sale).success).toBe(true);
    expect(receiptSchema.safeParse({ ...sale, method: "link" }).success).toBe(false);
    // A sale has at least one product (18q).
    expect(receiptSchema.safeParse({ ...sale, lines: [] }).success).toBe(false);
  });
  it("a sale listed above the cap reads back: two at the top price, half off, so its total fits", () => {
    const listed = 2 * 99_999_999;
    const big = {
      ...common,
      kind: "sale",
      lines: [{ name: "Lifetime", quantity: 2, unitPriceMinor: 99_999_999, amounts: { listedMinor: listed, discount: { name: "Half", minor: 99_999_999 }, taxes: [], totalMinor: 99_999_999 } }],
      totalMinor: 99_999_999,
      method: "cash",
    };
    expect(receiptSchema.safeParse(big).success).toBe(true);
  });
  it("a field the receipt does not have is refused", () => {
    const refund = { ...common, kind: "refund", forReceipt: 1, item: { name: "Gold", covers: null }, refundedMinor: 100, method: "cash" };
    expect(receiptSchema.safeParse(refund).success).toBe(true);
    expect(receiptSchema.safeParse({ ...refund, email: "maya@example.com" }).success).toBe(false);
  });
});
