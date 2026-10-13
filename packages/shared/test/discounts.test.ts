// DISCOUNTS AND PROMO CODES (spec Part 3 §14.3; ROADMAP 18b-ii-a): what comes off, when a
// discount can be used, and what a sale made with one comes to. Every expected number
// here was worked out by hand.
import { describe, expect, it } from "vitest";
import {
  bpToPercentText,
  discountFits,
  discountOff,
  discountRefusalWords,
  discountStatus,
  percentToBp,
  promoCodeFrom,
  saleAmounts,
  saveGymDiscountRequestSchema,
  sellProductRequestSchema,
  updateGymDiscountRequestSchema,
} from "../src/index.js";

const percent = (bp: number) => ({ kind: "percent" as const, percentBp: bp, amountMinor: null });
const amount = (minor: number) => ({ kind: "amount" as const, percentBp: null, amountMinor: minor });

describe("what a discount takes off", () => {
  it.each([
    // [what, discount, the price times how many, what comes off]
    ["20% of 19.99 is 3.998, so 4.00", percent(2000), 1999, 400],
    ["12.5% of 1.99 is 0.24875, so 0.25", percent(1250), 199, 25],
    ["15% of two at 12.00", percent(1500), 2400, 360],
    ["10% of 3.98 is 0.398, so 0.40", percent(1000), 398, 40],
    ["a half goes up: 50% of 0.05", percent(5000), 5, 3],
    ["1% of 0.30 rounds to nothing", percent(100), 30, 0],
    ["33.33% of 9.00 is 2.9997, so 3.00", percent(3333), 900, 300],
    ["100% is the whole price", percent(10_000), 500, 500],
    ["a fixed amount comes off once, however many are bought", amount(100), 597, 100],
    ["a fixed amount bigger than the price takes the price and no more", amount(500), 300, 300],
    ["a fixed amount equal to the price", amount(300), 300, 300],
    ["in a money with no cents: 10% of 1,500 yen", percent(1000), 1500, 150],
  ])("%s", (_what, discount, listed, off) => {
    expect(discountOff(discount, listed)).toBe(off);
  });

  it("takes nothing off where the discount or the price is not a real one", () => {
    expect(discountOff({ kind: "percent", percentBp: null, amountMinor: 500 }, 1000)).toBe(0);
    expect(discountOff({ kind: "amount", percentBp: 1000, amountMinor: null }, 1000)).toBe(0);
    expect(discountOff(percent(10_001), 1000)).toBe(0);
    expect(discountOff(percent(0), 1000)).toBe(0);
    expect(discountOff(percent(-500), 1000)).toBe(0);
    expect(discountOff(amount(-1), 1000)).toBe(0);
    expect(discountOff(amount(1.5), 1000)).toBe(0);
    expect(discountOff(percent(1000), 0)).toBe(0);
    expect(discountOff(percent(1000), Number.NaN)).toBe(0);
  });

  it("never takes off more than the price, whatever it is given", () => {
    for (const listed of [1, 2, 3, 99, 199, 1000, 99_999_999]) {
      for (const d of [percent(1), percent(4999), percent(5000), percent(9999), percent(10_000), amount(1), amount(98), amount(99_999_999)]) {
        const off = discountOff(d, listed);
        expect(off).toBeGreaterThanOrEqual(0);
        expect(off).toBeLessThanOrEqual(listed);
        expect(Number.isInteger(off)).toBe(true);
      }
    }
  });
});

describe("what a sale with a discount comes to", () => {
  const base = { unitPriceMinor: 199, quantity: 2, taxed: true, taxBp: 825, taxIncluded: false };

  it("tax added on top is worked out on the price after the discount (Texas, 8.25%)", () => {
    // 3.98 less 0.40 is 3.58; 8.25% of 3.58 is 0.29535, so 0.30; 3.88 to pay.
    expect(saleAmounts({ ...base, discountMinor: 40 })).toEqual({ ok: true, netMinor: 358, taxMinor: 30, totalMinor: 388 });
  });

  it("tax inside the price is the tax part of what is left (the UK, 20%)", () => {
    // 10.00 less 2.00 is 8.00 paid; a sixth of it, 1.3333, is tax, so 1.33.
    expect(saleAmounts({ unitPriceMinor: 1000, quantity: 1, taxed: true, taxBp: 2000, taxIncluded: true, discountMinor: 200 })).toEqual({ ok: true, netMinor: 667, taxMinor: 133, totalMinor: 800 });
  });

  it("no tax: the price less the discount", () => {
    expect(saleAmounts({ ...base, taxed: false, discountMinor: 98 })).toEqual({ ok: true, netMinor: 300, taxMinor: 0, totalMinor: 300 });
  });

  it("no discount, and a discount of nothing, are the sale as it was", () => {
    const plain = saleAmounts(base);
    expect(plain).toEqual({ ok: true, netMinor: 398, taxMinor: 33, totalMinor: 431 });
    expect(saleAmounts({ ...base, discountMinor: 0 })).toEqual(plain);
  });

  it("a discount that takes the whole price leaves nothing to pay, and that is not a sale", () => {
    expect(saleAmounts({ ...base, discountMinor: 398 })).toEqual({ ok: false, reason: "nothing_to_pay" });
    expect(saleAmounts({ ...base, discountMinor: 397 })).toMatchObject({ ok: true, netMinor: 1 });
  });

  it("refuses a discount that is not an amount, or is more than the price", () => {
    for (const discountMinor of [399, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(saleAmounts({ ...base, discountMinor }), String(discountMinor)).toEqual({ ok: false, reason: "not_an_amount" });
    }
  });

  it("the three numbers always add up, and the total is never above the price before the discount plus its tax", () => {
    for (const taxIncluded of [true, false]) {
      for (const taxBp of [0, 500, 825, 2000, 3000]) {
        for (const unitPriceMinor of [1, 2, 99, 199, 1250, 99_999]) {
          const full = saleAmounts({ unitPriceMinor, quantity: 3, taxed: true, taxBp, taxIncluded });
          if (!full.ok) throw new Error("the sale without a discount did not add up");
          for (const d of [percent(1), percent(1000), percent(3333), percent(9999), amount(1), amount(50)]) {
            const off = discountOff(d, unitPriceMinor * 3);
            const got = saleAmounts({ unitPriceMinor, quantity: 3, taxed: true, taxBp, taxIncluded, discountMinor: off });
            if (!got.ok) {
              expect(got.reason).toBe("nothing_to_pay");
              expect(off).toBe(unitPriceMinor * 3);
              continue;
            }
            expect(got.netMinor + got.taxMinor).toBe(got.totalMinor);
            expect(got.totalMinor).toBeGreaterThanOrEqual(1);
            expect(got.totalMinor).toBeLessThanOrEqual(full.totalMinor);
          }
        }
      }
    }
  });
});

describe("what a discount is on a given day", () => {
  const open = { startsOn: null, endsOn: null, maxUses: null, uses: 0, archived: false };
  it.each([
    ["no dates and no limit", open, "active"],
    ["starts today", { ...open, startsOn: "2026-10-13" }, "active"],
    ["starts tomorrow", { ...open, startsOn: "2026-10-14" }, "scheduled"],
    ["started last year", { ...open, startsOn: "2025-10-14" }, "active"],
    ["ends today: the last day counts", { ...open, endsOn: "2026-10-13" }, "active"],
    ["ended yesterday", { ...open, endsOn: "2026-10-12" }, "expired"],
    ["ends at the turn of the month", { ...open, startsOn: "2026-09-30", endsOn: "2026-10-01" }, "expired"],
    ["one day only, today", { ...open, startsOn: "2026-10-13", endsOn: "2026-10-13" }, "active"],
    ["9 of 10 used", { ...open, maxUses: 10, uses: 9 }, "active"],
    ["10 of 10 used", { ...open, maxUses: 10, uses: 10 }, "used_up"],
    ["more used than the limit, after the limit was lowered", { ...open, maxUses: 3, uses: 7 }, "used_up"],
    ["used many times with no limit", { ...open, uses: 5000 }, "active"],
    ["used up and not yet started reads used up", { ...open, startsOn: "2026-11-01", maxUses: 1, uses: 1 }, "used_up"],
    ["expired and used up reads expired", { ...open, endsOn: "2026-10-01", maxUses: 1, uses: 1 }, "expired"],
    ["archived, whatever else is true", { ...open, archived: true }, "archived"],
    ["archived and expired reads archived", { ...open, archived: true, endsOn: "2026-01-01" }, "archived"],
  ] as const)("%s", (_what, terms, status) => {
    expect(discountStatus(terms, "2026-10-13")).toBe(status);
  });
});

describe("whether a discount can be used on a sale", () => {
  const WATER = "11111111-1111-4111-8111-111111111111";
  const TOWEL = "22222222-2222-4222-8222-222222222222";
  const d = { ...percent(1000), currency: null, startsOn: null, endsOn: null, maxUses: null, uses: 0, archived: false, allProducts: true, productIds: [] as string[] };
  const sale = { today: "2026-10-13", productId: WATER, currency: "USD" };

  it.each([
    ["on every product, no dates, no limit", d, { ok: true }],
    ["limited to this product", { ...d, allProducts: false, productIds: [WATER] }, { ok: true }],
    ["limited to this product and another", { ...d, allProducts: false, productIds: [TOWEL, WATER] }, { ok: true }],
    ["limited to another product", { ...d, allProducts: false, productIds: [TOWEL] }, { ok: false, reason: "not_for_product" }],
    ["limited to no product at all", { ...d, allProducts: false, productIds: [] }, { ok: false, reason: "not_for_product" }],
    ["archived", { ...d, archived: true }, { ok: false, reason: "archived" }],
    ["starts tomorrow", { ...d, startsOn: "2026-10-14" }, { ok: false, reason: "not_started" }],
    ["ended yesterday", { ...d, endsOn: "2026-10-12" }, { ok: false, reason: "expired" }],
    ["ends today", { ...d, endsOn: "2026-10-13" }, { ok: true }],
    ["at its limit", { ...d, maxUses: 2, uses: 2 }, { ok: false, reason: "used_up" }],
    ["one use left", { ...d, maxUses: 2, uses: 1 }, { ok: true }],
    ["a fixed amount in the sale's money", { ...d, ...amount(100), currency: "USD" }, { ok: true }],
    ["a fixed amount in another money", { ...d, ...amount(100), currency: "GBP" }, { ok: false, reason: "other_currency" }],
    ["a percentage has no money, so any sale's will do", { ...d, currency: null }, { ok: true }],
    ["expired is said before the wrong product", { ...d, endsOn: "2026-10-01", allProducts: false, productIds: [TOWEL] }, { ok: false, reason: "expired" }],
  ] as const)("%s", (_what, discount, answer) => {
    expect(discountFits(discount, sale)).toEqual(answer);
  });

  it("every refusal has a sentence that names the discount and says nothing was sold", () => {
    for (const reason of ["archived", "not_started", "expired", "used_up", "not_for_product", "other_currency"] as const) {
      const words = discountRefusalWords("Summer sale", reason);
      expect(words).toContain("Summer sale");
      expect(words).toContain("Nothing was sold");
    }
  });
});

describe("what staff type", () => {
  it.each([
    ["10", 1000],
    ["12.5", 1250],
    ["12.50", 1250],
    [" 7 ", 700],
    ["0.5", 50],
    ["100", 10_000],
    ["100.00", 10_000],
    ["0", null],
    ["0.00", null],
    ["100.01", null],
    ["101", null],
    ["12.555", null],
    ["-5", null],
    ["10%", null],
    ["ten", null],
    ["", null],
    ["1,5", null],
  ])("the percentage %j is %j", (text, bp) => {
    expect(percentToBp(text)).toBe(bp);
  });

  it("a percentage reads back as it was typed", () => {
    for (const [bp, text] of [[1000, "10"], [1250, "12.5"], [50, "0.5"], [3333, "33.33"], [10_000, "100"], [5, "0.05"]] as const) {
      expect(bpToPercentText(bp)).toBe(text);
      expect(percentToBp(text)).toBe(bp);
    }
  });

  it.each([
    ["summer20", "SUMMER20"],
    ["  Welcome10 ", "WELCOME10"],
    ["ABC", "ABC"],
    ["A1B2C3D4E5F6G7H8I9J0", "A1B2C3D4E5F6G7H8I9J0"],
    ["AB", null],
    ["A1B2C3D4E5F6G7H8I9J0K", null],
    ["SUMMER 20", null],
    ["SUMMER-20", null],
    ["SÜMMER", null],
    ["", null],
    ["SUMMER​20", null],
  ])("the promo code %j is kept as %j", (text, code) => {
    expect(promoCodeFrom(text)).toBe(code);
  });
});

describe("the discount form as the server takes it", () => {
  const good = {
    name: "Summer sale",
    code: "SUMMER20",
    kind: "percent",
    percentBp: 2000,
    amountMinor: null,
    startsOn: "2026-06-01",
    endsOn: "2026-08-31",
    maxUses: 100,
    allProducts: true,
    productIds: [],
  };
  const WATER = "11111111-1111-4111-8111-111111111111";

  it("takes a percentage, a fixed amount, no code, no dates, no limit and picked products", () => {
    expect(saveGymDiscountRequestSchema.safeParse(good).success).toBe(true);
    expect(saveGymDiscountRequestSchema.safeParse({ ...good, kind: "amount", percentBp: null, amountMinor: 500 }).success).toBe(true);
    expect(saveGymDiscountRequestSchema.safeParse({ ...good, code: null, startsOn: null, endsOn: null, maxUses: null }).success).toBe(true);
    expect(saveGymDiscountRequestSchema.safeParse({ ...good, allProducts: false, productIds: [WATER] }).success).toBe(true);
    expect(saveGymDiscountRequestSchema.safeParse({ ...good, startsOn: "2026-06-01", endsOn: "2026-06-01" }).success).toBe(true);
    expect(saveGymDiscountRequestSchema.parse({ ...good, name: "  Summer sale  " }).name).toBe("Summer sale");
  });

  it.each([
    ["a percentage with an amount as well", { amountMinor: 500 }],
    ["a percentage with no percentage", { percentBp: null }],
    ["a fixed amount with no amount", { kind: "amount", percentBp: null }],
    ["a fixed amount with a percentage as well", { kind: "amount", amountMinor: 500 }],
    ["a percentage of nothing", { percentBp: 0 }],
    ["more than 100%", { percentBp: 10_001 }],
    ["a kind nobody knows", { kind: "bogo" }],
    ["it ends before it starts", { startsOn: "2026-08-31", endsOn: "2026-06-01" }],
    ["a day that is not a day", { startsOn: "June 1" }],
    ["a limit of no uses", { maxUses: 0 }],
    ["a limit past the cap", { maxUses: 100_001 }],
    ["a code in small letters", { code: "summer20" }],
    ["a code of two letters", { code: "AB" }],
    ["a code with a space", { code: "SUMMER 20" }],
    ["no name", { name: "   " }],
    ["a name of 61 letters", { name: "x".repeat(61) }],
    ["a name with a line break", { name: "Summer\nsale" }],
    ["a name with a hidden character", { name: "Summer​sale" }],
    ["picked products with none named", { allProducts: false, productIds: [] }],
    ["every product, and some named as well", { allProducts: true, productIds: [WATER] }],
    ["the same product twice", { allProducts: false, productIds: [WATER, WATER] }],
    ["a product that is not an id", { allProducts: false, productIds: ["water"] }],
    ["a field nobody asked for", { uses: 0 }],
  ])("refuses %s", (_what, patch) => {
    expect(saveGymDiscountRequestSchema.safeParse({ ...good, ...patch }).success).toBe(false);
  });

  it("a change carries the moment the form read the discount, and is checked the same way", () => {
    expect(updateGymDiscountRequestSchema.safeParse({ ...good, updatedAt: "2026-10-13T10:00:00.000Z" }).success).toBe(true);
    expect(updateGymDiscountRequestSchema.safeParse(good).success).toBe(false);
    expect(updateGymDiscountRequestSchema.safeParse({ ...good, percentBp: null, updatedAt: "2026-10-13T10:00:00.000Z" }).success).toBe(false);
  });

  it("a sale names one discount or none, and an older screen that names none still sells", () => {
    const sale = { requestKey: "00000000-0000-4000-8000-000000000001", productId: WATER, quantity: 1, entryId: null, method: "cash", totalMinor: 199 };
    expect(sellProductRequestSchema.parse(sale).discountId).toBeNull();
    expect(sellProductRequestSchema.parse({ ...sale, discountId: WATER }).discountId).toBe(WATER);
    expect(sellProductRequestSchema.safeParse({ ...sale, discountId: "SUMMER20" }).success).toBe(false);
    expect(sellProductRequestSchema.safeParse({ ...sale, discountIds: [WATER] }).success).toBe(false);
  });
});
