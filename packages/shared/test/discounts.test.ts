// DISCOUNTS AND PROMO CODES (spec Part 3 §14.3; ROADMAP 18b-ii-a and 18b-ii-b): what comes
// off, when a discount can be used, and what a sale or a membership made with one comes to. Every expected number
// here was worked out by hand.
import { describe, expect, it } from "vitest";
import {
  bpToPercentText,
  discountFits,
  discountOff,
  discountRefusalWords,
  discountStatus,
  giveHeldMembershipRequestSchema,
  membershipDiscount,
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
    ["99.99% of 5.00 is 4.9995, so the whole 5.00", percent(9999), 500, 500],
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
    expect(discountOff(percent(10_000), 1000)).toBe(0);
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
  const MONTHLY = "33333333-3333-4333-8333-333333333333";
  const DAY_PASS = "44444444-4444-4444-8444-444444444444";
  const d = {
    ...percent(1000),
    currency: null,
    startsOn: null,
    endsOn: null,
    maxUses: null,
    uses: 0,
    archived: false,
    forProducts: true,
    allProducts: true,
    productIds: [] as string[],
    forMemberships: false,
    allMembershipTypes: true,
    membershipTypeIds: [] as string[],
  };
  const sale = { today: "2026-10-13", productId: WATER, currency: "USD" };
  const give = { today: "2026-10-13", membershipTypeId: MONTHLY, currency: "USD" };
  const both = { ...d, forMemberships: true };

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
    ["for memberships alone is not for a product", { ...d, forProducts: false, forMemberships: true }, { ok: false, reason: "not_for_product" }],
    ["for products and memberships", both, { ok: true }],
  ] as const)("%s", (_what, discount, answer) => {
    expect(discountFits(discount, sale)).toEqual(answer);
  });

  it.each([
    // A discount made before 18b-ii-b is for products alone, as the migration leaves it.
    ["for products alone is not for a membership", d, { ok: false, reason: "not_for_membership" }],
    ["for every membership type", { ...d, forProducts: false, forMemberships: true }, { ok: true }],
    ["for products and memberships", both, { ok: true }],
    ["limited to this membership", { ...both, allMembershipTypes: false, membershipTypeIds: [MONTHLY] }, { ok: true }],
    ["limited to this one and another", { ...both, allMembershipTypes: false, membershipTypeIds: [DAY_PASS, MONTHLY] }, { ok: true }],
    ["limited to another membership", { ...both, allMembershipTypes: false, membershipTypeIds: [DAY_PASS] }, { ok: false, reason: "not_for_membership" }],
    ["limited to no membership at all", { ...both, allMembershipTypes: false, membershipTypeIds: [] }, { ok: false, reason: "not_for_membership" }],
    ["a product's id is not a membership's", { ...both, allMembershipTypes: false, membershipTypeIds: [WATER] }, { ok: false, reason: "not_for_membership" }],
    ["limited to some products says nothing of memberships", { ...both, allProducts: false, productIds: [TOWEL] }, { ok: true }],
    ["archived", { ...both, archived: true }, { ok: false, reason: "archived" }],
    ["starts tomorrow", { ...both, startsOn: "2026-10-14" }, { ok: false, reason: "not_started" }],
    ["ended yesterday", { ...both, endsOn: "2026-10-12" }, { ok: false, reason: "expired" }],
    ["at its limit", { ...both, maxUses: 1, uses: 1 }, { ok: false, reason: "used_up" }],
    ["a fixed amount in the membership's money", { ...both, ...amount(1000), currency: "USD" }, { ok: true }],
    ["a fixed amount in another money", { ...both, ...amount(1000), currency: "GBP" }, { ok: false, reason: "other_currency" }],
  ] as const)("on a membership: %s", (_what, discount, answer) => {
    expect(discountFits(discount, give)).toEqual(answer);
  });

  it("every refusal has a sentence that names the discount and says nothing was sold, or saved", () => {
    for (const reason of ["archived", "not_started", "expired", "used_up", "not_for_product", "not_for_membership", "other_currency"] as const) {
      const words = discountRefusalWords("Summer sale", reason);
      expect(words).toContain("Summer sale");
      expect(words).toContain("Nothing was sold");
      const membership = discountRefusalWords("Summer sale", reason, "membership");
      expect(membership).toContain("Summer sale");
      expect(membership).toContain("Nothing was saved");
      expect(membership).not.toContain("sold");
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
    ["99.99", 9999],
    ["100", null],
    ["100.00", null],
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
    for (const [bp, text] of [[1000, "10"], [1250, "12.5"], [50, "0.5"], [3333, "33.33"], [9999, "99.99"], [5, "0.05"]] as const) {
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

describe("what a membership given with a discount costs", () => {
  const first = { membershipPayments: "first" as const };
  const every = { membershipPayments: "every" as const };
  it.each([
    // [what, discount, type, what comes off, which payments, the price kept on it, its first bill]
    ["$50.00 a month, 20% off the first payment", { ...percent(2000), ...first }, { kind: "recurring", priceMinor: 5000 }, 1000, "first", 5000, 4000],
    ["$50.00 a month, 20% off every payment", { ...percent(2000), ...every }, { kind: "recurring", priceMinor: 5000 }, 1000, "every", 4000, 4000],
    ["$50.00 a month, $10.00 off the first", { ...amount(1000), ...first }, { kind: "recurring", priceMinor: 5000 }, 1000, "first", 5000, 4000],
    ["$50.00 a month, $10.00 off every one", { ...amount(1000), ...every }, { kind: "recurring", priceMinor: 5000 }, 1000, "every", 4000, 4000],
    ["$19.99 a week, 12.5% is 2.49875, so 2.50, every one", { ...percent(1250), ...every }, { kind: "recurring", priceMinor: 1999 }, 250, "every", 1749, 1749],
    ["a $30.00 one-time membership is paid once: first is every", { ...percent(2000), ...first }, { kind: "one_time", priceMinor: 3000 }, 600, "every", 2400, 2400],
    ["a $120.00 pack, $25.00 off", { ...amount(2500), ...first }, { kind: "pack", priceMinor: 12_000 }, 2500, "every", 9500, 9500],
    ["a $15.00 trial, 10% off", { ...percent(1000), ...every }, { kind: "trial", priceMinor: 1500 }, 150, "every", 1350, 1350],
    ["99.99% of $100.00 leaves a cent", { ...percent(9999), ...first }, { kind: "recurring", priceMinor: 10_000 }, 9999, "first", 10_000, 1],
    ["a repeating one with no setting comes off every payment", { ...percent(2000), membershipPayments: null }, { kind: "recurring", priceMinor: 5000 }, 1000, "every", 4000, 4000],
  ] as const)("%s", (_what, discount, type, offMinor, payments, heldPriceMinor, firstBillMinor) => {
    expect(membershipDiscount(discount, type)).toEqual({ ok: true, offMinor, payments, heldPriceMinor, firstBillMinor });
  });

  it.each([
    ["99.99% of $50.00 is all of it", { ...percent(9999), ...every }, { kind: "recurring", priceMinor: 5000 }, "nothing_to_pay"],
    ["$50.00 off $50.00", { ...amount(5000), ...first }, { kind: "recurring", priceMinor: 5000 }, "nothing_to_pay"],
    ["$60.00 off $50.00", { ...amount(6000), ...first }, { kind: "one_time", priceMinor: 5000 }, "nothing_to_pay"],
    ["1% of $0.30 rounds to nothing", { ...percent(100), ...every }, { kind: "recurring", priceMinor: 30 }, "nothing_off"],
    ["a free membership", { ...percent(2000), ...every }, { kind: "trial", priceMinor: 0 }, "nothing_off"],
  ] as const)("refuses %s", (_what, discount, type, reason) => {
    expect(membershipDiscount(discount, type)).toEqual({ ok: false, reason });
  });
});

describe("a membership given with a discount, as the server takes it", () => {
  const give = { requestKey: "00000000-0000-4000-8000-000000000001", typeId: "33333333-3333-4333-8333-333333333333", startsOn: "2026-10-13", paid: false };
  const DISCOUNT = "55555555-5555-4555-8555-555555555555";
  it("takes none, or one with the price and what comes off", () => {
    expect(giveHeldMembershipRequestSchema.safeParse(give).success).toBe(true);
    expect(giveHeldMembershipRequestSchema.safeParse({ ...give, priceMinor: 5000, discountId: DISCOUNT, discountMinor: 1000 }).success).toBe(true);
  });
  it.each([
    ["a discount with nothing said to come off", { priceMinor: 5000, discountId: DISCOUNT }],
    ["something off with no discount", { priceMinor: 5000, discountMinor: 1000 }],
    ["a discount and no price", { discountId: DISCOUNT, discountMinor: 1000 }],
    ["nothing off", { priceMinor: 5000, discountId: DISCOUNT, discountMinor: 0 }],
    ["a discount that is not an id", { priceMinor: 5000, discountId: "SUMMER20", discountMinor: 1000 }],
  ])("refuses %s", (_what, patch) => {
    expect(giveHeldMembershipRequestSchema.safeParse({ ...give, ...patch }).success).toBe(false);
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
    forProducts: true,
    allProducts: true,
    productIds: [],
    forMemberships: false,
    allMembershipTypes: true,
    membershipTypeIds: [],
    membershipPayments: null,
  };
  const WATER = "11111111-1111-4111-8111-111111111111";
  const MONTHLY = "33333333-3333-4333-8333-333333333333";

  it("takes a percentage, a fixed amount, no code, no dates, no limit and picked products", () => {
    expect(saveGymDiscountRequestSchema.safeParse(good).success).toBe(true);
    expect(saveGymDiscountRequestSchema.safeParse({ ...good, kind: "amount", percentBp: null, amountMinor: 500 }).success).toBe(true);
    expect(saveGymDiscountRequestSchema.safeParse({ ...good, code: null, startsOn: null, endsOn: null, maxUses: null }).success).toBe(true);
    expect(saveGymDiscountRequestSchema.safeParse({ ...good, allProducts: false, productIds: [WATER] }).success).toBe(true);
    expect(saveGymDiscountRequestSchema.safeParse({ ...good, startsOn: "2026-06-01", endsOn: "2026-06-01" }).success).toBe(true);
    expect(saveGymDiscountRequestSchema.safeParse({ ...good, startsOn: "2028-02-29", endsOn: "2028-02-29" }).success).toBe(true);
    expect(saveGymDiscountRequestSchema.safeParse({ ...good, percentBp: 9999 }).success).toBe(true);
    expect(saveGymDiscountRequestSchema.parse({ ...good, name: "  Summer sale  " }).name).toBe("Summer sale");
  });

  it("takes memberships alone, both, picked types, and how often it comes off", () => {
    const memberships = { forProducts: false, forMemberships: true, membershipPayments: "first" };
    expect(saveGymDiscountRequestSchema.safeParse({ ...good, ...memberships }).success).toBe(true);
    expect(saveGymDiscountRequestSchema.safeParse({ ...good, forMemberships: true, membershipPayments: "every" }).success).toBe(true);
    expect(saveGymDiscountRequestSchema.safeParse({ ...good, ...memberships, allMembershipTypes: false, membershipTypeIds: [MONTHLY] }).success).toBe(true);
  });

  it.each([
    ["a percentage with an amount as well", { amountMinor: 500 }],
    ["a percentage with no percentage", { percentBp: null }],
    ["a fixed amount with no amount", { kind: "amount", percentBp: null }],
    ["a fixed amount with a percentage as well", { kind: "amount", amountMinor: 500 }],
    ["a percentage of nothing", { percentBp: 0 }],
    ["more than 100%", { percentBp: 10_001 }],
    ["100%, which would leave nothing to pay", { percentBp: 10_000 }],
    ["the 31st of February", { startsOn: "2026-02-31", endsOn: null }],
    ["the 30th of February as the last day", { endsOn: "2026-02-30" }],
    ["a thirteenth month", { startsOn: "2026-13-01", endsOn: null }],
    ["the year nothing", { startsOn: "0000-00-00" }],
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
    ["for nothing at all", { forProducts: false }],
    ["not for products, with products picked", { forProducts: false, forMemberships: true, membershipPayments: "first", allProducts: false, productIds: [WATER] }],
    ["not for memberships, with types picked", { allMembershipTypes: false, membershipTypeIds: [MONTHLY] }],
    ["for memberships, with no word on how often", { forMemberships: true }],
    ["how often, on one not for memberships", { membershipPayments: "every" }],
    ["how often in a word nobody knows", { forMemberships: true, membershipPayments: "twice" }],
    ["picked types with none named", { forMemberships: true, membershipPayments: "first", allMembershipTypes: false, membershipTypeIds: [] }],
    ["every type, and some named as well", { forMemberships: true, membershipPayments: "first", membershipTypeIds: [MONTHLY] }],
    ["the same type twice", { forMemberships: true, membershipPayments: "first", allMembershipTypes: false, membershipTypeIds: [MONTHLY, MONTHLY] }],
    ["an older screen that does not say what it is for", { forProducts: undefined, forMemberships: undefined }],
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
    expect(sellProductRequestSchema.parse(sale).lines[0]?.discountId).toBeNull();
    expect(sellProductRequestSchema.parse({ ...sale, discountId: WATER }).lines[0]?.discountId).toBe(WATER);
    expect(sellProductRequestSchema.safeParse({ ...sale, discountId: "SUMMER20" }).success).toBe(false);
    expect(sellProductRequestSchema.safeParse({ ...sale, discountIds: [WATER] }).success).toBe(false);
  });
});
