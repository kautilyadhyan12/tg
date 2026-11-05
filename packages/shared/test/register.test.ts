import { describe, expect, it } from "vitest";
import {
  SALES_TAX_PCM_MAX,
  SALE_QUANTITY_MAX,
  pcmToTaxRateText,
  outOfStockWords,
  saleAmounts,
  saveGymProductRequestSchema,
  sellProductRequestSchema,
  SUPPORTED_COUNTRIES,
  taxIncludedForCountry,
  taxNameForCountry,
  taxRateToPcm,
} from "../src/index.js";

const sale = (unitPriceMinor: number, quantity: number, taxPcm: number, taxIncluded: boolean) =>
  saleAmounts({ unitPriceMinor, quantity, taxPcms: taxPcm === 0 ? [] : [taxPcm], taxIncluded });
const several = (unitPriceMinor: number, taxPcms: number[], taxIncluded: boolean, quantity = 1, discountMinor = 0) =>
  saleAmounts({ unitPriceMinor, quantity, taxPcms, taxIncluded, discountMinor });

describe("several taxes on one thing: what the person pays is what the taxes say (18b-v-a)", () => {
  // The worst thing: a member charged the wrong amount, or handed a receipt whose taxes do not
  // add up to what they paid. Worked by hand from the tax offices' own rates, not from the
  // function: Quebec's GST 5% and QST 9.975% (Revenu Québec: $100.00 is $5.00 GST and $9.98
  // QST, $114.98), India's CGST 9% and SGST 9%, New York City's 8.875%, British Columbia's GST 5%
  // and PST 7%, and a Texas city's 6.25% state and 2% city tax.
  const table: [string, number, number[], boolean, { netMinor: number; taxParts: number[]; totalMinor: number }][] = [
    ["Quebec, $100.00, GST and QST each on the price", 10000, [5000, 9975], false, { netMinor: 10000, taxParts: [500, 998], totalMinor: 11498 }],
    ["Quebec, $1.99, each tax rounded on its own", 199, [5000, 9975], false, { netMinor: 199, taxParts: [10, 20], totalMinor: 229 }],
    ["Quebec, $114.98 with both inside: $100.00 and the same two taxes", 11498, [5000, 9975], true, { netMinor: 10000, taxParts: [500, 998], totalMinor: 11498 }],
    ["India, ₹1,000 with CGST and SGST on top", 100000, [9000, 9000], false, { netMinor: 100000, taxParts: [9000, 9000], totalMinor: 118000 }],
    ["India, ₹1,180 with both inside", 118000, [9000, 9000], true, { netMinor: 100000, taxParts: [9000, 9000], totalMinor: 118000 }],
    // ₹50.00 / 1.18 is ₹42.37 before tax; 9% of it is ₹3.81 for each, as an Indian GST invoice shows them (18b-v-b).
    ["India, ₹50 with both inside: equal rates, equal amounts", 5000, [9000, 9000], true, { netMinor: 4238, taxParts: [381, 381], totalMinor: 5000 }],
    ["British Columbia, $10.00, GST 5% and PST 7%", 1000, [5000, 7000], false, { netMinor: 1000, taxParts: [50, 70], totalMinor: 1120 }],
    ["Texas, $10.00, state 6.25% and city 2%", 1000, [6250, 2000], false, { netMinor: 1000, taxParts: [63, 20], totalMinor: 1083 }],
    ["New York City, $10.00 at 8.875%, to the nearest cent", 1000, [8875], false, { netMinor: 1000, taxParts: [89], totalMinor: 1089 }],
    ["three taxes on $9.99", 999, [6250, 1000, 1000], false, { netMinor: 999, taxParts: [62, 10, 10], totalMinor: 1081 }],
    ["two taxes of 15%, the most together, on $100.00", 10000, [15000, 15000], false, { netMinor: 10000, taxParts: [1500, 1500], totalMinor: 13000 }],
  ];
  it.each(table)("%s", (_name, unit, pcms, included, want) => {
    const got = several(unit, pcms, included);
    expect(got).toEqual({ ok: true, ...want, taxMinor: want.taxParts.reduce((n, m) => n + m, 0) });
  });

  it("QST is worked out on the price, never on the price and the GST", () => {
    // On $100.00 + $5.00 GST, 9.975% would be $10.47: the price alone gives $9.98.
    const got = several(10000, [5000, 9975], false);
    expect(got.ok && got.taxParts[1]).toBe(998);
  });

  it("a discount comes off first, and both taxes are on what is left", () => {
    expect(several(10000, [5000, 9975], false, 1, 2000)).toEqual({ ok: true, netMinor: 8000, taxMinor: 1198, taxParts: [400, 798], totalMinor: 9198 });
  });

  it("the parts always add up to the tax, the tax and the price to the total, and none is below nothing", () => {
    const rateSets = [[5000, 9975], [9000, 9000], [6250, 1000, 1000], [1, 29_999], [7000, 7000, 7000, 7000, 2000], [1, 1, 1], [8875, 4500]];
    for (const pcms of rateSets) {
      for (const unit of [1, 2, 3, 7, 99, 199, 250, 999, 1000, 11498, 99_999]) {
        for (const quantity of [1, 3, SALE_QUANTITY_MAX]) {
          for (const included of [true, false]) {
            const got = several(unit, pcms, included, quantity);
            if (!got.ok) throw new Error(`refused ${String(unit)} x ${String(quantity)} at ${pcms.join("+")}`);
            expect(got.taxParts).toHaveLength(pcms.length);
            expect(got.taxParts.reduce((n, m) => n + m, 0)).toBe(got.taxMinor);
            expect(got.netMinor + got.taxMinor).toBe(got.totalMinor);
            for (const [i, part] of got.taxParts.entries()) {
              expect(part).toBeGreaterThanOrEqual(0);
              // Each part within a cent of its exact share of the tax.
              const together = pcms.reduce((n, p) => n + p, 0);
              expect(Math.abs(part - (got.taxMinor * (pcms[i] ?? 0)) / together)).toBeLessThan(1);
            }
            if (included) expect(got.totalMinor).toBe(unit * quantity);
            else expect(got.netMinor).toBe(unit * quantity);
          }
        }
      }
    }
  });

  it("one rate charged alone comes to what it did before several were possible", () => {
    // The old rule, in hundredths of a percent: (price x rate + 5,000) / 10,000 on top, and the
    // tax inside rounded the same way. Every old rate x 10 is the same rate here.
    for (const bp of [1, 500, 725, 825, 1800, 2000, 2300, 3000]) {
      for (const listed of [1, 99, 199, 1000, 5000, 11800, 99_999]) {
        const onTop = Math.floor((listed * bp + 5_000) / 10_000);
        const inside = Math.floor((2 * listed * bp + (10_000 + bp)) / (2 * (10_000 + bp)));
        expect(several(listed, [bp * 10], false)).toMatchObject({ ok: true, taxMinor: onTop });
        expect(several(listed, [bp * 10], true)).toMatchObject({ ok: true, taxMinor: inside });
      }
    }
  });

  it("refuses rates that come to more than 30% together, and any rate that is not a rate", () => {
    expect(several(1000, [20_000, 10_001], false)).toEqual({ ok: false, reason: "not_an_amount" });
    expect(several(1000, [15_000, 15_000, 1], true)).toEqual({ ok: false, reason: "not_an_amount" });
    expect(several(1000, [5000, 0], false)).toEqual({ ok: false, reason: "not_an_amount" });
    expect(several(1000, [5000, -1], false)).toEqual({ ok: false, reason: "not_an_amount" });
    expect(several(1000, [5000, 1.5], false)).toEqual({ ok: false, reason: "not_an_amount" });
    expect(several(1000, Array.from({ length: 11 }, () => 1), false)).toEqual({ ok: false, reason: "not_an_amount" });
  });
});

describe("what one sale comes to", () => {
  // Worked by hand from the published rates, not from the function: Texas's 8.25%,
  // California's 7.25%, Canada's 5% GST, the UK's 20% VAT, India's 18% GST, Germany's 19%
  // and 7%, Ireland's 23%.
  const table: [string, number, number, number, boolean, { netMinor: number; taxMinor: number; totalMinor: number }][] = [
    ["Texas, a $1.99 water, tax on top", 199, 1, 8250, false, { netMinor: 199, taxMinor: 16, totalMinor: 215 }],
    ["California, a $10.00 towel, a half cent goes up", 1000, 1, 7250, false, { netMinor: 1000, taxMinor: 73, totalMinor: 1073 }],
    ["Canada, a $2.50 bar, a half cent goes up", 250, 1, 5000, false, { netMinor: 250, taxMinor: 13, totalMinor: 263 }],
    ["Canada, three of them, taxed on the three together", 250, 3, 5000, false, { netMinor: 750, taxMinor: 38, totalMinor: 788 }],
    ["the UK, a £1.20 drink with VAT inside", 120, 1, 20000, true, { netMinor: 100, taxMinor: 20, totalMinor: 120 }],
    ["the UK, a £1.99 drink with VAT inside", 199, 1, 20000, true, { netMinor: 166, taxMinor: 33, totalMinor: 199 }],
    ["India, ₹118 with GST inside", 11800, 1, 18000, true, { netMinor: 10000, taxMinor: 1800, totalMinor: 11800 }],
    ["India, ₹50 with GST inside", 5000, 1, 18000, true, { netMinor: 4237, taxMinor: 763, totalMinor: 5000 }],
    ["Germany, €2.00 at 19% inside", 200, 1, 19000, true, { netMinor: 168, taxMinor: 32, totalMinor: 200 }],
    ["Germany, €1.07 at 7% inside", 107, 1, 7000, true, { netMinor: 100, taxMinor: 7, totalMinor: 107 }],
    ["Ireland, two €3.00 shakes at 23% inside", 300, 2, 23000, true, { netMinor: 488, taxMinor: 112, totalMinor: 600 }],
    ["one cent at 8.25% on top rounds to no tax", 1, 1, 8250, false, { netMinor: 1, taxMinor: 0, totalMinor: 1 }],
    ["no rate set: no tax, on top", 450, 2, 0, false, { netMinor: 900, taxMinor: 0, totalMinor: 900 }],
    ["no rate set: no tax, inside", 450, 2, 0, true, { netMinor: 900, taxMinor: 0, totalMinor: 900 }],
  ];
  it.each(table)("%s", (_name, unit, quantity, pcm, included, want) => {
    expect(sale(unit, quantity, pcm, included)).toEqual({ ok: true, ...want, taxParts: pcm === 0 ? [] : [want.taxMinor] });
  });

  it("the three numbers always add up, and tax inside never changes what is paid", () => {
    for (const pcm of [0, 1, 5000, 7250, 8250, 8875, 9975, 18000, 20000, 23000, SALES_TAX_PCM_MAX]) {
      for (const unit of [1, 2, 3, 99, 199, 250, 999, 1000, 12345, 99_999]) {
        for (const quantity of [1, 2, 3, 7, SALE_QUANTITY_MAX]) {
          for (const included of [true, false]) {
            const got = sale(unit, quantity, pcm, included);
            if (!got.ok) throw new Error(`refused ${String(unit)} x ${String(quantity)} at ${String(pcm)}`);
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
    expect(sale(100, 1, SALES_TAX_PCM_MAX + 1, false)).toEqual({ ok: false, reason: "not_an_amount" });
    expect(sale(99_999_999, 2, 0, false)).toEqual({ ok: false, reason: "too_much" });
    expect(sale(99_999_999, 1, 10, false)).toEqual({ ok: false, reason: "too_much" });
    expect(sale(99_999_999, 1, 10, true)).toMatchObject({ ok: true, totalMinor: 99_999_999 });
  });
});

describe("the tax rate as staff type it", () => {
  it.each([
    ["0", 0],
    ["8.25", 8250],
    ["8.5", 8500],
    ["8.875", 8875],
    ["9.975", 9975],
    ["20", 20000],
    [" 7.25 ", 7250],
    ["0.05", 50],
    ["0.001", 1],
    ["30", 30000],
    ["30.000", 30000],
  ])("%s", (text, pcm) => {
    expect(taxRateToPcm(text)).toBe(pcm);
  });
  it.each(["", "8,25", "8.2555", "-1", "30.001", "30.01", "31", "100", "abc", "8%", "1e1", "."])("refuses %s", (text) => {
    expect(taxRateToPcm(text)).toBeNull();
  });
  it("prints back what was typed", () => {
    expect([0, 1, 50, 7250, 8250, 8500, 8875, 9975, 20000, 30000].map(pcmToTaxRateText)).toEqual(["0", "0.001", "0.05", "7.25", "8.25", "8.5", "8.875", "9.975", "20", "30"]);
    for (let pcm = 0; pcm <= SALES_TAX_PCM_MAX; pcm += 1) expect(taxRateToPcm(pcmToTaxRateText(pcm))).toBe(pcm);
  });
});

describe("the tax name a gym is offered (18b-iv)", () => {
  // The worst thing: a gym offered another country's tax, which then prints on its receipts.
  // The names each tax office uses: the IRS and the states (sales tax), HMRC, Revenue,
  // the DGFiP and the AEAT (VAT, in English), the CBIC, the ATO and the CRA (GST), and
  // Japan's National Tax Agency (consumption tax). Every served country is listed here,
  // so one added later fails this test until it has its own name.
  const table: [string, string][] = [
    ["US", "Sales tax"],
    ["GB", "VAT"],
    ["IE", "VAT"],
    ["FR", "VAT"],
    ["ES", "VAT"],
    ["IN", "GST"],
    ["AU", "GST"],
    ["CA", "GST"],
    ["JP", "Consumption tax"],
  ];
  it.each(table)("%s is offered %s, and nothing with a rate in it", (country, name) => {
    expect(taxNameForCountry(country)).toBe(name);
    expect(taxNameForCountry(` ${country.toLowerCase()} `)).toBe(name);
    expect(name).not.toMatch(/\d|%/);
  });
  it("every served country is in the table", () => {
    expect(table.map(([c]) => c).sort()).toEqual([...SUPPORTED_COUNTRIES].sort());
  });
  it("no country, or one not served, is offered nothing", () => {
    for (const country of [null, "", "DE", "NZ", "XX", "constructor", "toString", "USA"]) expect(taxNameForCountry(country)).toBeNull();
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
    const good = { name: "  Water 500 ml ", priceMinor: 199, taxRateIds: [], stock: null };
    const gst = "00000000-0000-4000-8000-000000000001";
    const qst = "00000000-0000-4000-8000-000000000002";
    expect(saveGymProductRequestSchema.parse(good).name).toBe("Water 500 ml");
    expect(saveGymProductRequestSchema.parse({ ...good, taxRateIds: [gst, qst] }).taxRateIds).toEqual([gst, qst]);
    for (const bad of [
      { ...good, taxRateIds: [gst, gst] },
      { ...good, taxRateIds: Array.from({ length: 11 }, (_, i) => `00000000-0000-4000-8000-0000000000${String(10 + i)}`) },
      { ...good, taxRateIds: null },
      { ...good, taxRateId: null },
      { ...good, name: "   " },
      { ...good, name: "Water\n=cmd" },
      { ...good, name: "x".repeat(81) },
      { ...good, priceMinor: 0 },
      { ...good, priceMinor: 1.5 },
      { ...good, stock: -1 },
      { ...good, stock: 2.5 },
      { ...good, currency: "USD" },
      { ...good, taxRateIds: ["GST"] },
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
