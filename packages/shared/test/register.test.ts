import { describe, expect, it } from "vitest";
import {
  SALES_TAX_BP_MAX,
  SALE_QUANTITY_MAX,
  bpToTaxRateText,
  outOfStockWords,
  saleAmounts,
  saveGymProductRequestSchema,
  sellProductRequestSchema,
  taxIncludedForCountry,
  taxRateToBp,
} from "../src/index.js";

const sale = (unitPriceMinor: number, quantity: number, taxBp: number, taxIncluded: boolean, taxed = true) =>
  saleAmounts({ unitPriceMinor, quantity, taxed, taxBp, taxIncluded });

describe("what one sale comes to", () => {
  // Worked by hand from the published rates, not from the function: Texas's 8.25%,
  // California's 7.25%, Canada's 5% GST, the UK's 20% VAT, India's 18% GST, Germany's 19%
  // and 7%, Ireland's 23%.
  const table: [string, number, number, number, boolean, { netMinor: number; taxMinor: number; totalMinor: number }][] = [
    ["Texas, a $1.99 water, tax on top", 199, 1, 825, false, { netMinor: 199, taxMinor: 16, totalMinor: 215 }],
    ["California, a $10.00 towel, a half cent goes up", 1000, 1, 725, false, { netMinor: 1000, taxMinor: 73, totalMinor: 1073 }],
    ["Canada, a $2.50 bar, a half cent goes up", 250, 1, 500, false, { netMinor: 250, taxMinor: 13, totalMinor: 263 }],
    ["Canada, three of them, taxed on the three together", 250, 3, 500, false, { netMinor: 750, taxMinor: 38, totalMinor: 788 }],
    ["the UK, a £1.20 drink with VAT inside", 120, 1, 2000, true, { netMinor: 100, taxMinor: 20, totalMinor: 120 }],
    ["the UK, a £1.99 drink with VAT inside", 199, 1, 2000, true, { netMinor: 166, taxMinor: 33, totalMinor: 199 }],
    ["India, ₹118 with GST inside", 11800, 1, 1800, true, { netMinor: 10000, taxMinor: 1800, totalMinor: 11800 }],
    ["India, ₹50 with GST inside", 5000, 1, 1800, true, { netMinor: 4237, taxMinor: 763, totalMinor: 5000 }],
    ["Germany, €2.00 at 19% inside", 200, 1, 1900, true, { netMinor: 168, taxMinor: 32, totalMinor: 200 }],
    ["Germany, €1.07 at 7% inside", 107, 1, 700, true, { netMinor: 100, taxMinor: 7, totalMinor: 107 }],
    ["Ireland, two €3.00 shakes at 23% inside", 300, 2, 2300, true, { netMinor: 488, taxMinor: 112, totalMinor: 600 }],
    ["one cent at 8.25% on top rounds to no tax", 1, 1, 825, false, { netMinor: 1, taxMinor: 0, totalMinor: 1 }],
    ["no rate set: no tax, on top", 450, 2, 0, false, { netMinor: 900, taxMinor: 0, totalMinor: 900 }],
    ["no rate set: no tax, inside", 450, 2, 0, true, { netMinor: 900, taxMinor: 0, totalMinor: 900 }],
  ];
  it.each(table)("%s", (_name, unit, quantity, bp, included, want) => {
    expect(sale(unit, quantity, bp, included)).toEqual({ ok: true, ...want });
  });

  it("a product the gym does not tax is sold at its price, whatever the rate", () => {
    expect(sale(199, 2, 825, false, false)).toEqual({ ok: true, netMinor: 398, taxMinor: 0, totalMinor: 398 });
    expect(sale(199, 2, 2000, true, false)).toEqual({ ok: true, netMinor: 398, taxMinor: 0, totalMinor: 398 });
  });

  it("the three numbers always add up, and tax inside never changes what is paid", () => {
    for (const bp of [0, 1, 500, 725, 825, 1800, 2000, 2300, SALES_TAX_BP_MAX]) {
      for (const unit of [1, 2, 3, 99, 199, 250, 999, 1000, 12345, 99_999]) {
        for (const quantity of [1, 2, 3, 7, SALE_QUANTITY_MAX]) {
          for (const included of [true, false]) {
            const got = sale(unit, quantity, bp, included);
            if (!got.ok) throw new Error(`refused ${String(unit)} x ${String(quantity)} at ${String(bp)}`);
            expect(got.netMinor + got.taxMinor).toBe(got.totalMinor);
            expect(got.taxMinor).toBeGreaterThanOrEqual(0);
            if (included) expect(got.totalMinor).toBe(unit * quantity);
            else expect(got.netMinor).toBe(unit * quantity);
          }
        }
      }
    }
  });

  it("refuses what is not an amount, and a total past the largest a bill can hold", () => {
    expect(sale(0, 1, 0, false)).toEqual({ ok: false, reason: "not_an_amount" });
    expect(sale(-5, 1, 0, false)).toEqual({ ok: false, reason: "not_an_amount" });
    expect(sale(1.5, 1, 0, false)).toEqual({ ok: false, reason: "not_an_amount" });
    expect(sale(100, 0, 0, false)).toEqual({ ok: false, reason: "not_an_amount" });
    expect(sale(100, SALE_QUANTITY_MAX + 1, 0, false)).toEqual({ ok: false, reason: "not_an_amount" });
    expect(sale(100, 1, -1, false)).toEqual({ ok: false, reason: "not_an_amount" });
    expect(sale(100, 1, SALES_TAX_BP_MAX + 1, false)).toEqual({ ok: false, reason: "not_an_amount" });
    expect(sale(99_999_999, 2, 0, false)).toEqual({ ok: false, reason: "too_much" });
    expect(sale(99_999_999, 1, 1, false)).toEqual({ ok: false, reason: "too_much" });
    expect(sale(99_999_999, 1, 1, true)).toMatchObject({ ok: true, totalMinor: 99_999_999 });
  });
});

describe("the tax rate as staff type it", () => {
  it.each([
    ["0", 0],
    ["8.25", 825],
    ["8.5", 850],
    ["20", 2000],
    [" 7.25 ", 725],
    ["0.05", 5],
    ["30", 3000],
  ])("%s", (text, bp) => {
    expect(taxRateToBp(text)).toBe(bp);
  });
  it.each(["", "8,25", "8.255", "-1", "30.01", "31", "100", "abc", "8%", "1e1", "."])("refuses %s", (text) => {
    expect(taxRateToBp(text)).toBeNull();
  });
  it("prints back what was typed", () => {
    expect([0, 5, 725, 825, 850, 2000, 3000].map(bpToTaxRateText)).toEqual(["0", "0.05", "7.25", "8.25", "8.5", "20", "30"]);
    for (let bp = 0; bp <= SALES_TAX_BP_MAX; bp += 1) expect(taxRateToBp(bpToTaxRateText(bp))).toBe(bp);
  });
});

describe("where a gym's prices start", () => {
  it("tax is added at the till in the United States and Canada, and is inside the price elsewhere", () => {
    expect(taxIncludedForCountry("US")).toBe(false);
    expect(taxIncludedForCountry("ca")).toBe(false);
    for (const country of ["GB", "IN", "DE", "FR", "IE", "ES", "AU", "NZ", "JP"]) expect(taxIncludedForCountry(country)).toBe(true);
    expect(taxIncludedForCountry(null)).toBe(true);
  });
});

describe("the wire", () => {
  const formId = "00000000-0000-4000-8000-000000000001";
  const product = "0b0f4a52-5a43-4c7e-8f0e-3a1d9a2c7e55";
  it("a sale names one product, a whole number of them, and how it was paid", () => {
    const good = { requestKey: formId, productId: product, quantity: 2, entryId: null, method: "cash", totalMinor: 430 };
    expect(sellProductRequestSchema.safeParse(good).success).toBe(true);
    for (const bad of [
      { ...good, quantity: 0 },
      { ...good, quantity: 1.5 },
      { ...good, quantity: SALE_QUANTITY_MAX + 1 },
      { ...good, method: "link" },
      { ...good, method: "company" },
      { ...good, totalMinor: 0 },
      { ...good, totalMinor: -430 },
      { ...good, entryId: "walk-in" },
      { ...good, priceMinor: 1 },
      { ...good, requestKey: "again" },
    ]) {
      expect(sellProductRequestSchema.safeParse(bad).success).toBe(false);
    }
  });
  it("a product has a name of one line, a price above nothing and a stock count or none", () => {
    const good = { name: "  Water 500 ml ", priceMinor: 199, taxRateId: null, stock: null };
    expect(saveGymProductRequestSchema.parse(good).name).toBe("Water 500 ml");
    for (const bad of [
      { ...good, name: "   " },
      { ...good, name: "Water\n=cmd" },
      { ...good, name: "x".repeat(81) },
      { ...good, priceMinor: 0 },
      { ...good, priceMinor: 1.5 },
      { ...good, stock: -1 },
      { ...good, stock: 2.5 },
      { ...good, currency: "USD" },
      { ...good, taxRateId: "GST" },
      { ...good, taxed: true },
    ]) {
      expect(saveGymProductRequestSchema.safeParse(bad).success).toBe(false);
    }
  });
  it("says how many are left", () => {
    expect(outOfStockWords("Water", 0)).toBe("Water is out of stock. Nothing was sold. If you have more, change the stock count under Products.");
    expect(outOfStockWords("Water", 2)).toBe("Only 2 of Water left in stock. Nothing was sold. Sell 2 or fewer, or change the stock count under Products.");
  });
});
