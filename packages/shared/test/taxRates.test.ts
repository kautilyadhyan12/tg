// TAX ON A MEMBERSHIP'S BILL, AND A GYM'S NAMED RATES (spec Part 3 §14.3; ROADMAP 18b-iii).
//
// Every amount below is worked by hand from the published rate, never from the function:
// India's GST of 18% and 12%, the UK's VAT of 20%, Texas's 8.25%, Canada's GST of 5%,
// Australia's GST of 10%, and the highest rate a gym may set, 30%.
import { describe, expect, it } from "vitest";
import {
  MEMBERSHIP_PRICE_MINOR_MAX,
  SALES_TAX_BP_MAX,
  TAXED_PRICE_MINOR_MAX,
  billAmounts,
  saveGymMembershipTypeRequestSchema,
  saveTaxRateRequestSchema,
  salesTaxSchema,
  taxModeRequestSchema,
  taxRateInUseWords,
  type TaxApplied,
} from "../src/index.js";

const on = (name: string, bp: number): TaxApplied => ({ name, bp, included: false });
const inside = (name: string, bp: number): TaxApplied => ({ name, bp, included: true });

describe("what one membership bill comes to", () => {
  const table: [string, number, TaxApplied | null, { netMinor: number; taxMinor: number; totalMinor: number }][] = [
    // No rate: the price is the bill, whatever the gym's way of charging.
    ["no tax: $50.00 is $50.00", 5000, null, { netMinor: 5000, taxMinor: 0, totalMinor: 5000 }],
    // On top.
    ["India, ₹2,000 a month plus 18% GST is ₹2,360", 200000, on("GST", 1800), { netMinor: 200000, taxMinor: 36000, totalMinor: 236000 }],
    ["$50.00 plus 18% is $59.00", 5000, on("GST", 1800), { netMinor: 5000, taxMinor: 900, totalMinor: 5900 }],
    ["$50.00 plus 12% is $56.00", 5000, on("GST", 1200), { netMinor: 5000, taxMinor: 600, totalMinor: 5600 }],
    ["$40.00 after a discount, plus 18%, is $47.20", 4000, on("GST", 1800), { netMinor: 4000, taxMinor: 720, totalMinor: 4720 }],
    ["Texas, $49.99 plus 8.25%: 4.124175 rounds down to $4.12", 4999, on("Sales tax", 825), { netMinor: 4999, taxMinor: 412, totalMinor: 5411 }],
    ["Texas, $29.99 plus 8.25%: 2.474175 rounds down to $2.47", 2999, on("Sales tax", 825), { netMinor: 2999, taxMinor: 247, totalMinor: 3246 }],
    ["Canada, $2.50 plus 5%: half a cent goes up to 13 cents", 250, on("GST", 500), { netMinor: 250, taxMinor: 13, totalMinor: 263 }],
    ["Canada, $2.70 plus 5%: 13.5 cents goes up to 14", 270, on("GST", 500), { netMinor: 270, taxMinor: 14, totalMinor: 284 }],
    ["one cent plus 8.25% is still one cent", 1, on("Sales tax", 825), { netMinor: 1, taxMinor: 0, totalMinor: 1 }],
    ["the highest rate, 30%, on $100.00", 10000, on("Tax", SALES_TAX_BP_MAX), { netMinor: 10000, taxMinor: 3000, totalMinor: 13000 }],
    // Inside the price.
    ["the UK, £50.00 with 20% VAT inside: £8.33 is VAT", 5000, inside("VAT", 2000), { netMinor: 4167, taxMinor: 833, totalMinor: 5000 }],
    ["the UK, £60.00 with 20% VAT inside: £10.00 is VAT", 6000, inside("VAT", 2000), { netMinor: 5000, taxMinor: 1000, totalMinor: 6000 }],
    ["India, ₹2,360 with 18% GST inside: ₹360 is GST", 236000, inside("GST", 1800), { netMinor: 200000, taxMinor: 36000, totalMinor: 236000 }],
    ["Australia, $55.00 with 10% GST inside: $5.00 is GST", 5500, inside("GST", 1000), { netMinor: 5000, taxMinor: 500, totalMinor: 5500 }],
    ["Australia, $49.95 with 10% GST inside: 4.5409 rounds to $4.54", 4995, inside("GST", 1000), { netMinor: 4541, taxMinor: 454, totalMinor: 4995 }],
  ];
  it.each(table)("%s", (_name, listed, tax, want) => {
    expect(billAmounts(listed, tax)).toEqual({ ok: true, ...want });
  });

  it("the three numbers always add up; tax inside never changes what is paid, tax on top never changes the price", () => {
    for (const bp of [1, 500, 825, 1000, 1200, 1800, 2000, 2300, SALES_TAX_BP_MAX]) {
      for (const listed of [1, 2, 3, 99, 999, 1000, 2999, 4999, 5000, 12345, 999_999, TAXED_PRICE_MINOR_MAX]) {
        for (const included of [true, false]) {
          const got = billAmounts(listed, { name: "Tax", bp, included });
          if (!got.ok) throw new Error(`refused ${String(listed)} at ${String(bp)}`);
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
    expect(billAmounts(TAXED_PRICE_MINOR_MAX, on("Tax", SALES_TAX_BP_MAX))).toEqual({ ok: true, netMinor: TAXED_PRICE_MINOR_MAX, taxMinor: 23_076_923, totalMinor: MEMBERSHIP_PRICE_MINOR_MAX });
    expect(billAmounts(TAXED_PRICE_MINOR_MAX + 1, on("Tax", SALES_TAX_BP_MAX))).toEqual({ ok: false, reason: "too_much" });
    const type = { name: "Gold", description: null, kind: "recurring", priceMinor: TAXED_PRICE_MINOR_MAX, termCount: 1, termUnit: "month", packClasses: null, packDays: null, access: "all_classes", bookingsLimit: null, bookingsPeriod: null, classTypeIds: null };
    const rate = "8e5f3c1a-2b4d-4c6e-8f0a-1b2c3d4e5f60";
    expect(saveGymMembershipTypeRequestSchema.safeParse({ ...type, taxRateId: rate }).success).toBe(true);
    expect(saveGymMembershipTypeRequestSchema.safeParse({ ...type, priceMinor: TAXED_PRICE_MINOR_MAX + 1, taxRateId: rate }).success).toBe(false);
    // Untaxed, the whole range stands as it did.
    expect(saveGymMembershipTypeRequestSchema.safeParse({ ...type, priceMinor: MEMBERSHIP_PRICE_MINOR_MAX }).success).toBe(true);
    // A type made without saying its tax charges none.
    expect(saveGymMembershipTypeRequestSchema.parse(type).taxRateId).toBeNull();
  });

  it("a bill of nothing is not a bill", () => {
    expect(billAmounts(0, on("GST", 1800))).toEqual({ ok: false, reason: "not_an_amount" });
    expect(billAmounts(-100, null)).toEqual({ ok: false, reason: "not_an_amount" });
    expect(billAmounts(10.5, null)).toEqual({ ok: false, reason: "not_an_amount" });
  });
});

describe("a gym's named rates", () => {
  it("a rate has a name of one line and a percentage above nothing, up to 30, in hundredths", () => {
    expect(saveTaxRateRequestSchema.parse({ name: "  GST ", bp: 1800 })).toEqual({ name: "GST", bp: 1800 });
    for (const good of [{ name: "Sales tax", bp: 825 }, { name: "VAT", bp: 1 }, { name: "IVA", bp: SALES_TAX_BP_MAX }, { name: "x".repeat(30), bp: 500 }]) {
      expect(saveTaxRateRequestSchema.safeParse(good).success, good.name).toBe(true);
    }
    for (const bad of [
      { name: "", bp: 1800 },
      { name: "   ", bp: 1800 },
      { name: "GST\n=cmd", bp: 1800 },
      { name: "GST​", bp: 1800 },
      { name: "x".repeat(31), bp: 1800 },
      { name: "GST", bp: 0 },
      { name: "GST", bp: SALES_TAX_BP_MAX + 1 },
      { name: "GST", bp: 18.5 },
      { name: "GST" },
      { name: "GST", bp: 1800, included: true },
    ]) {
      expect(saveTaxRateRequestSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("how the gym charges it is one answer, and the old one-rate form is refused", () => {
    expect(taxModeRequestSchema.safeParse({ included: true }).success).toBe(true);
    for (const bad of [{}, { included: "yes" }, { bp: 825, included: false }]) expect(taxModeRequestSchema.safeParse(bad).success).toBe(false);
    expect(salesTaxSchema.safeParse({ bp: 825, included: false }).success).toBe(false);
  });

  it("says why a rate in use was not removed, with only what charges it", () => {
    expect(taxRateInUseWords("GST", { products: 2, membershipTypes: 0, memberships: 0 })).toBe("GST was not removed: it is charged on 2 products. Change them to another rate or No tax first.");
    expect(taxRateInUseWords("GST", { products: 1, membershipTypes: 1, memberships: 0 })).toBe("GST was not removed: it is charged on 1 product and 1 membership type. Change them to another rate or No tax first.");
    expect(taxRateInUseWords("VAT", { products: 0, membershipTypes: 0, memberships: 14 })).toBe(
      "VAT was not removed: it is charged on 14 members' memberships. A membership keeps the tax it was sold with, so VAT can be removed once nobody holds one. You can still change its name or rate.",
    );
    expect(taxRateInUseWords("GST", { products: 3, membershipTypes: 2, memberships: 1 })).toBe(
      "GST was not removed: it is charged on 3 products, 2 membership types and 1 member's membership. Change them to another rate or No tax first. A membership keeps the tax it was sold with, so GST can be removed once nobody holds one. You can still change its name or rate.",
    );
  });
});
