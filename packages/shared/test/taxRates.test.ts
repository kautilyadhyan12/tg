// TAX ON A MEMBERSHIP'S BILL, AND A GYM'S NAMED RATES (spec Part 3 §14.3; ROADMAP 18b-iii).
//
// Every amount below is worked by hand from the published rate, never from the function:
// India's GST of 18% and 12%, the UK's VAT of 20%, Texas's 8.25%, Canada's GST of 5%,
// Australia's GST of 10%, and the highest rate a gym may set, 30%.
import { describe, expect, it } from "vitest";
import {
  MEMBERSHIP_PRICE_MINOR_MAX,
  SALES_TAX_PCM_MAX,
  TAXED_PRICE_MINOR_MAX,
  billAmounts,
  saveGymMembershipTypeRequestSchema,
  saveTaxRateRequestSchema,
  salesTaxSchema,
  taxModeRequestSchema,
  taxRateInUseWords,
  type TaxApplied,
} from "../src/index.js";

const on = (name: string, pcm: number): TaxApplied => ({ rates: [{ name, pcm }], included: false });
const inside = (name: string, pcm: number): TaxApplied => ({ rates: [{ name, pcm }], included: true });

describe("what one membership bill comes to", () => {
  const table: [string, number, TaxApplied | null, { netMinor: number; taxMinor: number; totalMinor: number }][] = [
    // No rate: the price is the bill, whatever the gym's way of charging.
    ["no tax: $50.00 is $50.00", 5000, null, { netMinor: 5000, taxMinor: 0, totalMinor: 5000 }],
    // On top.
    ["India, ₹2,000 a month plus 18% GST is ₹2,360", 200000, on("GST", 18000), { netMinor: 200000, taxMinor: 36000, totalMinor: 236000 }],
    ["$50.00 plus 18% is $59.00", 5000, on("GST", 18000), { netMinor: 5000, taxMinor: 900, totalMinor: 5900 }],
    ["$50.00 plus 12% is $56.00", 5000, on("GST", 12000), { netMinor: 5000, taxMinor: 600, totalMinor: 5600 }],
    ["$40.00 after a discount, plus 18%, is $47.20", 4000, on("GST", 18000), { netMinor: 4000, taxMinor: 720, totalMinor: 4720 }],
    ["Texas, $49.99 plus 8.25%: 4.124175 rounds down to $4.12", 4999, on("Sales tax", 8250), { netMinor: 4999, taxMinor: 412, totalMinor: 5411 }],
    ["Texas, $29.99 plus 8.25%: 2.474175 rounds down to $2.47", 2999, on("Sales tax", 8250), { netMinor: 2999, taxMinor: 247, totalMinor: 3246 }],
    ["Canada, $2.50 plus 5%: half a cent goes up to 13 cents", 250, on("GST", 5000), { netMinor: 250, taxMinor: 13, totalMinor: 263 }],
    ["Canada, $2.70 plus 5%: 13.5 cents goes up to 14", 270, on("GST", 5000), { netMinor: 270, taxMinor: 14, totalMinor: 284 }],
    ["one cent plus 8.25% is still one cent", 1, on("Sales tax", 8250), { netMinor: 1, taxMinor: 0, totalMinor: 1 }],
    ["the highest rate, 30%, on $100.00", 10000, on("Tax", SALES_TAX_PCM_MAX), { netMinor: 10000, taxMinor: 3000, totalMinor: 13000 }],
    // Inside the price.
    ["the UK, £50.00 with 20% VAT inside: £8.33 is VAT", 5000, inside("VAT", 20000), { netMinor: 4167, taxMinor: 833, totalMinor: 5000 }],
    ["the UK, £60.00 with 20% VAT inside: £10.00 is VAT", 6000, inside("VAT", 20000), { netMinor: 5000, taxMinor: 1000, totalMinor: 6000 }],
    ["India, ₹2,360 with 18% GST inside: ₹360 is GST", 236000, inside("GST", 18000), { netMinor: 200000, taxMinor: 36000, totalMinor: 236000 }],
    ["Australia, $55.00 with 10% GST inside: $5.00 is GST", 5500, inside("GST", 10000), { netMinor: 5000, taxMinor: 500, totalMinor: 5500 }],
    ["Australia, $49.95 with 10% GST inside: 4.5409 rounds to $4.54", 4995, inside("GST", 10000), { netMinor: 4541, taxMinor: 454, totalMinor: 4995 }],
  ];
  it.each(table)("%s", (_name, listed, tax, want) => {
    expect(billAmounts(listed, tax)).toEqual({ ok: true, ...want, taxParts: tax === null ? [] : [want.taxMinor] });
  });

  it("the three numbers always add up; tax inside never changes what is paid, tax on top never changes the price", () => {
    for (const pcm of [1, 5000, 8250, 8875, 9975, 10000, 12000, 18000, 20000, 23000, SALES_TAX_PCM_MAX]) {
      for (const listed of [1, 2, 3, 99, 999, 1000, 2999, 4999, 5000, 12345, 999_999, TAXED_PRICE_MINOR_MAX]) {
        for (const included of [true, false]) {
          const got = billAmounts(listed, { rates: [{ name: "Tax", pcm }], included });
          if (!got.ok) throw new Error(`refused ${String(listed)} at ${String(pcm)}`);
          expect(got.netMinor + got.taxMinor).toBe(got.totalMinor);
          expect(got.taxMinor).toBeGreaterThanOrEqual(0);
          expect(got.taxMinor).toBeLessThan(got.totalMinor);
          if (included) expect(got.totalMinor).toBe(listed);
          else expect(got.netMinor).toBe(listed);
        }
      }
    }
  });

  it("a taxed price never makes a bill too big to keep, and one cent more would", () => {
    expect(billAmounts(TAXED_PRICE_MINOR_MAX, on("Tax", SALES_TAX_PCM_MAX))).toEqual({ ok: true, netMinor: TAXED_PRICE_MINOR_MAX, taxMinor: 23_076_923, taxParts: [23_076_923], totalMinor: MEMBERSHIP_PRICE_MINOR_MAX });
    expect(billAmounts(TAXED_PRICE_MINOR_MAX + 1, on("Tax", SALES_TAX_PCM_MAX))).toEqual({ ok: false, reason: "too_much" });
    const type = { name: "Gold", description: null, kind: "recurring", priceMinor: TAXED_PRICE_MINOR_MAX, termCount: 1, termUnit: "month", packClasses: null, packDays: null, access: "all_classes", bookingsLimit: null, bookingsPeriod: null, classTypeIds: null };
    const rate = "8e5f3c1a-2b4d-4c6e-8f0a-1b2c3d4e5f60";
    expect(saveGymMembershipTypeRequestSchema.safeParse({ ...type, taxRateIds: [rate] }).success).toBe(true);
    expect(saveGymMembershipTypeRequestSchema.safeParse({ ...type, priceMinor: TAXED_PRICE_MINOR_MAX + 1, taxRateIds: [rate] }).success).toBe(false);
    // Untaxed, the whole range stands as it did.
    expect(saveGymMembershipTypeRequestSchema.safeParse({ ...type, priceMinor: MEMBERSHIP_PRICE_MINOR_MAX }).success).toBe(true);
    // A type made without saying its tax charges none.
    expect(saveGymMembershipTypeRequestSchema.parse(type).taxRateIds).toEqual([]);
  });

  it("a bill of nothing is not a bill", () => {
    expect(billAmounts(0, on("GST", 18000))).toEqual({ ok: false, reason: "not_an_amount" });
    expect(billAmounts(-100, null)).toEqual({ ok: false, reason: "not_an_amount" });
    expect(billAmounts(10.5, null)).toEqual({ ok: false, reason: "not_an_amount" });
  });
});

// SEVERAL TAXES ON ONE MEMBERSHIP (18b-v-b). Each amount is worked by hand from the published rates,
// never from the function: Revenu Québec works GST 5% and QST 9.975% each on the price before tax
// ("Calculating the Taxes", since 2013); British Columbia's GST 5% and PST 7%; India's GST of 18%
// charged as CGST 9% and SGST 9%, inside the price where a gym's prices hold it.
describe("what one membership bill comes to with several taxes", () => {
  const rates = (...pairs: [string, number][]) => pairs.map(([name, pcm]) => ({ name, pcm }));
  const table: [string, number, TaxApplied, { netMinor: number; taxParts: number[]; totalMinor: number }][] = [
    // Quebec: $100.00 a month. GST $5.00; QST 9.975% of $100.00 is $9.975, $9.98. $114.98, never $115.48 (QST on the GST).
    ["Quebec, $100.00 a month plus GST and QST is $114.98", 10000, { rates: rates(["GST", 5000], ["QST", 9975]), included: false }, { netMinor: 10000, taxParts: [500, 998], totalMinor: 11498 }],
    // Quebec: $49.99. GST 2.4995 rounds to $2.50; QST 4.9865 rounds to $4.99. $57.48.
    ["Quebec, $49.99 plus GST and QST is $57.48", 4999, { rates: rates(["GST", 5000], ["QST", 9975]), included: false }, { netMinor: 4999, taxParts: [250, 499], totalMinor: 5748 }],
    // BC: $45.00. GST $2.25; PST 7% $3.15. $50.40.
    ["British Columbia, $45.00 plus GST and PST is $50.40", 4500, { rates: rates(["GST", 5000], ["PST", 7000]), included: false }, { netMinor: 4500, taxParts: [225, 315], totalMinor: 5040 }],
    // India, inside: ₹1,000.00 holds 18% of ₹847.46, ₹152.54; CGST and SGST are half each, ₹76.27.
    ["India, ₹1,000 with CGST and SGST inside: ₹76.27 each", 100000, { rates: rates(["CGST", 9000], ["SGST", 9000]), included: true }, { netMinor: 84746, taxParts: [7627, 7627], totalMinor: 100000 }],
    // India, inside, an odd paisa: ₹999.99 holds 152.5408 → ₹152.54 again, 7627 + 7627.
    ["India, ₹999.99 with CGST and SGST inside", 99999, { rates: rates(["CGST", 9000], ["SGST", 9000]), included: true }, { netMinor: 84745, taxParts: [7627, 7627], totalMinor: 99999 }],
    // India, inside, ₹500.01: 18/118 of 50001 is 7627.27 → 7627; halves 3813.5 each, the odd paisa to the first.
    ["India, ₹500.01 inside: the odd paisa goes to the first rate", 50001, { rates: rates(["CGST", 9000], ["SGST", 9000]), included: true }, { netMinor: 42374, taxParts: [3814, 3813], totalMinor: 50001 }],
    // Three taxes on top, 5% + 7% + 2.5% of $80.00: $4.00, $5.60, $2.00. $91.60.
    ["three taxes on $80.00 is $91.60", 8000, { rates: rates(["GST", 5000], ["PST", 7000], ["Levy", 2500]), included: false }, { netMinor: 8000, taxParts: [400, 560, 200], totalMinor: 9160 }],
    // Two rates of 15% each is the most together, 30%: $100.00 is $130.00.
    ["two rates at 30% together on $100.00 is $130.00", 10000, { rates: rates(["A", 15000], ["B", 15000]), included: false }, { netMinor: 10000, taxParts: [1500, 1500], totalMinor: 13000 }],
  ];
  it.each(table)("%s", (_name, listed, tax, want) => {
    const taxMinor = want.taxParts.reduce((n, m) => n + m, 0);
    expect(billAmounts(listed, tax)).toEqual({ ok: true, netMinor: want.netMinor, taxMinor, taxParts: want.taxParts, totalMinor: want.totalMinor });
  });

  it("over 30% together is refused, never a bill", () => {
    expect(billAmounts(10000, { rates: rates(["A", 15000], ["B", 15001]), included: false })).toEqual({ ok: false, reason: "not_an_amount" });
  });

  it("the parts always add up to the tax, and the tax and the price to what is paid", () => {
    const sets = [[5000, 9975], [9000, 9000], [5000, 7000, 2500], [1, 1], [8875, 1, 21124], [15000, 15000], [9975, 5000], [3333, 3333, 3334]];
    for (const pcms of sets) {
      for (const listed of [1, 2, 3, 7, 99, 999, 1001, 4999, 5000, 12345, 99_999, 999_999, TAXED_PRICE_MINOR_MAX]) {
        for (const included of [true, false]) {
          const got = billAmounts(listed, { rates: pcms.map((pcm, i) => ({ name: `T${String(i)}`, pcm })), included });
          if (!got.ok) throw new Error(`refused ${String(listed)} at ${pcms.join("+")}`);
          expect(got.taxParts).toHaveLength(pcms.length);
          expect(got.taxParts.reduce((n, m) => n + m, 0)).toBe(got.taxMinor);
          expect(got.netMinor + got.taxMinor).toBe(got.totalMinor);
          if (included) expect(got.totalMinor).toBe(listed);
          else {
            expect(got.netMinor).toBe(listed);
            // Each on the price before tax, never on another tax.
            pcms.forEach((pcm, i) => expect(got.taxParts[i]).toBe(Math.floor((listed * pcm + 50_000) / 100_000)));
          }
        }
      }
    }
  });
});

describe("a gym's named rates", () => {
  it("a rate has a name of one line and a percentage above nothing, up to 30, in thousandths", () => {
    expect(saveTaxRateRequestSchema.parse({ name: "  GST ", pcm: 18000 })).toEqual({ name: "GST", pcm: 18000 });
    for (const good of [{ name: "Sales tax", pcm: 8250 }, { name: "VAT", pcm: 1 }, { name: "QST", pcm: 9975 }, { name: "IVA", pcm: SALES_TAX_PCM_MAX }, { name: "x".repeat(30), pcm: 5000 }]) {
      expect(saveTaxRateRequestSchema.safeParse(good).success, good.name).toBe(true);
    }
    for (const bad of [
      { name: "", pcm: 18000 },
      { name: "   ", pcm: 18000 },
      { name: "GST\n=cmd", pcm: 18000 },
      { name: "GST​", pcm: 18000 },
      { name: "x".repeat(31), pcm: 18000 },
      { name: "GST", pcm: 0 },
      { name: "GST", pcm: SALES_TAX_PCM_MAX + 1 },
      { name: "GST", pcm: 180.5 },
      { name: "GST" },
      { name: "GST", pcm: 18000, included: true },
    ]) {
      expect(saveTaxRateRequestSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("how the gym charges it is one answer, and the old one-rate form is refused", () => {
    expect(taxModeRequestSchema.safeParse({ included: true }).success).toBe(true);
    for (const bad of [{}, { included: "yes" }, { pcm: 8250, included: false }]) expect(taxModeRequestSchema.safeParse(bad).success).toBe(false);
    expect(salesTaxSchema.safeParse({ pcm: 8250, included: false }).success).toBe(false);
  });

  it("says why a rate in use was not removed, with only what charges it", () => {
    expect(taxRateInUseWords("GST", { products: 2, membershipTypes: 0, memberships: 0 })).toBe("GST was not removed: it is charged on 2 products. Untick it on them first.");
    expect(taxRateInUseWords("GST", { products: 1, membershipTypes: 1, memberships: 0 })).toBe("GST was not removed: it is charged on 1 product and 1 membership type. Untick it on them first.");
    expect(taxRateInUseWords("VAT", { products: 0, membershipTypes: 0, memberships: 14 })).toBe(
      "VAT was not removed: it is charged on 14 members' memberships. A membership keeps the tax it was sold with, so VAT can be removed once nobody holds one. You can still change its name or rate.",
    );
    expect(taxRateInUseWords("GST", { products: 3, membershipTypes: 2, memberships: 1 })).toBe(
      "GST was not removed: it is charged on 3 products, 2 membership types and 1 member's membership. Untick it on them first. A membership keeps the tax it was sold with, so GST can be removed once nobody holds one. You can still change its name or rate.",
    );
  });
});
