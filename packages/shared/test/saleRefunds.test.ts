import { describe, expect, it } from "vitest";
import { refundSale, refundSaleRequestSchema, type SaleRefundCheck } from "../src/saleRefunds.js";

// A sale of 3 at ₹50.00 each, ₹150.00 in all.
const sale = { totalMinor: 15000, quantity: 3, voided: false, refundedMinor: 0, restocked: 0 };

describe("refundSale: never more back than the sale took, nor more on the shelf than it sold", () => {
  const cases: [string, Partial<typeof sale>, { amountMinor: number; restock: number }, SaleRefundCheck][] = [
    ["all of it, nothing back on the shelf", {}, { amountMinor: 15000, restock: 0 }, { ok: true, refundedInFull: true }],
    ["all of it, all back on the shelf", {}, { amountMinor: 15000, restock: 3 }, { ok: true, refundedInFull: true }],
    ["one of three", {}, { amountMinor: 5000, restock: 1 }, { ok: true, refundedInFull: false }],
    ["one minor unit", {}, { amountMinor: 1, restock: 0 }, { ok: true, refundedInFull: false }],
    ["one minor unit more than the sale", {}, { amountMinor: 15001, restock: 0 }, { ok: false, reason: "too_much", leftMinor: 15000 }],
    ["the rest after a part refund", { refundedMinor: 5000 }, { amountMinor: 10000, restock: 0 }, { ok: true, refundedInFull: true }],
    ["one more than the rest after a part refund", { refundedMinor: 5000 }, { amountMinor: 10001, restock: 0 }, { ok: false, reason: "too_much", leftMinor: 10000 }],
    ["anything once all went back", { refundedMinor: 15000 }, { amountMinor: 1, restock: 0 }, { ok: false, reason: "too_much", leftMinor: 0 }],
    ["a voided sale", { voided: true }, { amountMinor: 100, restock: 0 }, { ok: false, reason: "voided" }],
    ["a voided sale is said before a bad amount", { voided: true }, { amountMinor: 0, restock: 0 }, { ok: false, reason: "voided" }],
    ["nothing", {}, { amountMinor: 0, restock: 0 }, { ok: false, reason: "not_an_amount" }],
    ["less than nothing", {}, { amountMinor: -500, restock: 0 }, { ok: false, reason: "not_an_amount" }],
    ["part of a minor unit", {}, { amountMinor: 0.5, restock: 0 }, { ok: false, reason: "not_an_amount" }],
    ["four back on the shelf of three sold", {}, { amountMinor: 100, restock: 4 }, { ok: false, reason: "too_many_back", leftCount: 3 }],
    ["two more back after two went back", { refundedMinor: 10000, restocked: 2 }, { amountMinor: 100, restock: 2 }, { ok: false, reason: "too_many_back", leftCount: 1 }],
    ["the last one back after two went back", { refundedMinor: 10000, restocked: 2 }, { amountMinor: 5000, restock: 1 }, { ok: true, refundedInFull: true }],
    ["less than none back on the shelf", {}, { amountMinor: 100, restock: -1 }, { ok: false, reason: "too_many_back", leftCount: 3 }],
    ["part of one back on the shelf", {}, { amountMinor: 100, restock: 1.5 }, { ok: false, reason: "too_many_back", leftCount: 3 }],
    ["money back with none on the shelf once all are back", { refundedMinor: 5000, restocked: 3 }, { amountMinor: 10000, restock: 0 }, { ok: true, refundedInFull: true }],
  ];
  it.each(cases)("%s", (_name, over, ask, want) => {
    expect(refundSale({ ...sale, ...over }, ask)).toEqual(want);
  });
});

describe("the refund box's request", () => {
  const formId = "6f1c3a52-7d1e-4a43-9c3e-1d2b3c4d5e6f";
  const good = { requestKey: formId, amountMinor: 5000, method: "cash", reason: "returned", restock: 1 };
  it("takes a refund as the box sends it", () => {
    expect(refundSaleRequestSchema.safeParse(good).success).toBe(true);
  });
  it.each([
    ["no amount", { amountMinor: 0 }],
    ["a typed reason", { reason: "changed their mind" }],
    ["a company's method", { method: "company" }],
    ["100 back on the shelf", { restock: 100 }],
    ["an extra field", { entryId: formId }],
  ])("refuses %s", (_name, over) => {
    expect(refundSaleRequestSchema.safeParse({ ...good, ...over }).success).toBe(false);
  });
});
