// A BASKET AT SELL (ROADMAP 18q): the request a sale is sent as, and a list of lines made into
// sales. Every case of the request's own rules, each beside its good neighbour.
import { describe, expect, it } from "vitest";
import { SALE_LINES_MAX, gymSaleSchema, oneLineOnlyWords, saleBaskets, sellProductRequestSchema, type GymSale } from "../src/index.js";

const KEY = "00000000-0000-4000-8000-000000000001";
const WATER = "00000000-0000-4000-8000-000000000002";
const BAR = "00000000-0000-4000-8000-000000000003";
const MAYA = "00000000-0000-4000-8000-000000000004";
const OFF = "00000000-0000-4000-8000-000000000005";
const GIFT = { id: "00000000-0000-4000-8000-000000000006", offMinor: 50 };
const product = (n: number) => `00000000-0000-4000-8000-${String(100 + n).padStart(12, "0")}`;

const line = (productId: string, totalMinor: number, over: Record<string, unknown> = {}) => ({ productId, quantity: 1, totalMinor, ...over });
const sale = (lines: Record<string, unknown>[], over: Record<string, unknown> = {}) => ({
  requestKey: KEY,
  entryId: MAYA,
  method: "cash",
  totalMinor: lines.reduce((n, l) => n + Number(l["totalMinor"]), 0),
  lines,
  ...over,
});
const why = (body: unknown): string[] => {
  const parsed = sellProductRequestSchema.safeParse(body);
  return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
};

describe("the request a sale is sent as", () => {
  it("takes a basket of several products, each with its own discount, and the old one-product form as a basket of one", () => {
    const basket = sellProductRequestSchema.parse(sale([line(WATER, 199, { discountId: OFF }), line(BAR, 250)]));
    expect(basket.lines.map((l) => [l.productId, l.discountId, l.memberGift])).toEqual([
      [WATER, OFF, null],
      [BAR, null, null],
    ]);
    const one = sellProductRequestSchema.parse({ requestKey: KEY, productId: WATER, quantity: 2, entryId: null, method: "card_at_desk", totalMinor: 398 });
    expect(one).toEqual({ requestKey: KEY, entryId: null, method: "card_at_desk", totalMinor: 398, lines: [{ productId: WATER, quantity: 2, discountId: null, memberGift: null, totalMinor: 398 }] });
  });

  it.each([
    ["a sale's total that is not its lines added up", sale([line(WATER, 199), line(BAR, 250)], { totalMinor: 450 }), "total_not_lines"],
    ["one product twice: more of it is a bigger quantity", sale([line(WATER, 199), line(WATER, 199)]), "product_twice"],
    ["the buyer's gift on two products", sale([line(WATER, 149, { memberGift: GIFT }), line(BAR, 200, { memberGift: GIFT })]), "member_gift_once"],
    ["the buyer's gift beside a discount on its product", sale([line(WATER, 149, { memberGift: GIFT, discountId: OFF })]), "member_gift_alone"],
    ["the buyer's gift for a walk-in", sale([line(WATER, 149, { memberGift: GIFT })], { entryId: null }), "member_gift_alone"],
  ])("refuses %s", (_case, body, reason) => {
    expect(why(body)).toContain(reason);
  });

  it("refuses an empty sale, and more than SALE_LINES_MAX products; holds exactly that many", () => {
    expect(sellProductRequestSchema.safeParse(sale([])).success).toBe(false);
    const most = Array.from({ length: SALE_LINES_MAX }, (_, i) => line(product(i), 100));
    expect(sellProductRequestSchema.safeParse(sale(most)).success).toBe(true);
    expect(sellProductRequestSchema.safeParse(sale([...most, line(product(SALE_LINES_MAX), 100)])).success).toBe(false);
  });

  it("refuses a field it does not know, on the sale and on a line, and a basket carrying a product's own fields", () => {
    expect(sellProductRequestSchema.safeParse(sale([line(WATER, 199)], { note: "x" })).success).toBe(false);
    expect(sellProductRequestSchema.safeParse(sale([line(WATER, 199, { priceMinor: 1 })])).success).toBe(false);
    expect(sellProductRequestSchema.safeParse(sale([line(WATER, 199)], { productId: BAR, quantity: 1 })).success).toBe(false);
  });

  it("the gift on one product of several, with discounts on the others, is a sale", () => {
    expect(why(sale([line(WATER, 149, { memberGift: GIFT }), line(BAR, 225, { discountId: OFF })]))).toEqual([]);
  });

  it("says why a set amount off is refused on a second product", () => {
    expect(oneLineOnlyWords("Dollar off")).toBe("Dollar off can go on one product of a sale. Nothing was sold: leave it on one product only.");
  });
});

describe("lines made into sales", () => {
  const at = "2026-10-17T17:00:00.000Z";
  const of = (receiptNumber: number, lineNo: number, itemName: string, totalMinor: number, over: Partial<GymSale> = {}): GymSale =>
    gymSaleSchema.parse({
      id: `00000000-0000-4000-8000-${String(receiptNumber * 100 + lineNo).padStart(12, "0")}`,
      itemName,
      quantity: 1,
      unitPriceMinor: totalMinor,
      netMinor: totalMinor,
      taxMinor: 0,
      totalMinor,
      taxBp: 0,
      taxName: null,
      taxIncluded: false,
      discountName: null,
      discountMinor: 0,
      currency: "USD",
      method: "cash",
      soldOn: "2026-10-17",
      soldAt: at,
      by: null,
      person: null,
      personDeleted: false,
      undone: false,
      voided: null,
      canUndo: true,
      receiptNumber,
      lineNo,
      ...over,
    });

  it("keeps the list's newest-first order of sales, puts each sale's lines in the order rung up, and adds each sale up", () => {
    const lines = [of(7, 2, "Water", 398, { taxMinor: 0 }), of(7, 1, "Protein bar", 271, { taxMinor: 21, discountMinor: 0 }), of(5, 1, "Towel", 500, { refundedMinor: 200 })];
    expect(saleBaskets(lines).map((b) => [b.receiptNumber, b.first.itemName, b.lines.map((l) => l.itemName), b.totalMinor, b.taxMinor, b.refundedMinor])).toEqual([
      [7, "Protein bar", ["Protein bar", "Water"], 669, 21, 0],
      [5, "Towel", ["Towel"], 500, 0, 200],
    ]);
  });

  it("never puts two sales' lines together, however they are listed", () => {
    const lines = [of(3, 1, "Water", 100), of(4, 1, "Water", 100), of(3, 2, "Bar", 200)];
    expect(saleBaskets(lines).map((b) => [b.receiptNumber, b.totalMinor])).toEqual([
      [3, 300],
      [4, 100],
    ]);
    expect(saleBaskets([])).toEqual([]);
  });

  it("reads a sale sent before 18q, with no line number, as a sale of one line", () => {
    const old: Partial<GymSale> = { ...of(9, 1, "Water", 100) };
    delete old.lineNo;
    const parsed = gymSaleSchema.parse(old);
    expect([parsed.lineNo, saleBaskets([parsed]).length]).toEqual([1, 1]);
  });
});
