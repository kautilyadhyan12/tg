import { describe, expect, it } from "vitest";
import { PROMO_CODE_WORDS, promoFits, promoRefusalWords, type PromoTerms } from "../src/discounts.js";
import { forSaleWorked, repeatingChargeWords, type ForSaleInput, type ForSalePromo, type ForSaleType } from "../src/forSale.js";

// A promo code typed in the app (18k-v; Kd, 2026-11-13). The cases are how gym software and shops treat a typed code,
// not this code's own list: a code the gym keeps for the desk, another gym's or a made-up one is "not valid"; one past
// its end date has expired; one at its usage limit is used up, counting a use kept for somebody paying right now; one
// before its start says when; one used once per member is refused the second time. Amounts are worked by hand: 20% off
// $49.99 is $10.00 (999.8, rounded); 20% off $90.00 is $18.00.

const TODAY = "2026-11-13";
const code = (over: Partial<PromoTerms> = {}): PromoTerms => ({
  startsOn: null,
  endsOn: null,
  maxUses: null,
  uses: 0,
  archived: false,
  inApp: true,
  referralGift: false,
  oncePerMember: true,
  ...over,
});

describe("whether a member may use a code they typed in the app", () => {
  it.each([
    ["no discount has that code (another gym's, or made up)", null, 0, false, "not_found"],
    ["kept for the front desk: not ticked for the app", code({ inApp: false }), 0, false, "not_found"],
    ["Refer a friend's own code", code({ referralGift: true }), 0, false, "not_found"],
    ["archived", code({ archived: true }), 0, false, "not_found"],
    ["ended yesterday", code({ endsOn: "2026-11-12" }), 0, false, "expired"],
    ["at its usage limit", code({ maxUses: 5, uses: 5 }), 0, false, "used_up"],
    ["its last use kept for somebody paying now", code({ maxUses: 5, uses: 4 }), 1, false, "used_up"],
    ["starts tomorrow", code({ startsOn: "2026-11-14" }), 0, false, "not_started"],
    ["once per member, and they used it", code(), 0, true, "used_by_member"],
  ] as const)("refused: %s", (_name, d, held, used, reason) => {
    expect(promoFits(d, TODAY, held, used)).toEqual({ ok: false, reason });
  });

  it.each([
    ["no limits", code(), 0, false],
    ["its last day is today", code({ endsOn: TODAY }), 0, false],
    ["it starts today", code({ startsOn: TODAY }), 0, false],
    ["one use left, nobody paying", code({ maxUses: 5, uses: 4 }), 0, false],
    ["used before, and not once per member", code({ oncePerMember: false }), 0, true],
  ] as const)("usable: %s", (_name, d, held, used) => {
    expect(promoFits(d, TODAY, held, used)).toEqual({ ok: true });
  });

  it("says each refusal in a member's words", () => {
    expect(promoRefusalWords("not_found", null)).toBe("That code isn't valid here. Check it and try again.");
    expect(promoRefusalWords("expired", null)).toBe("This code has expired.");
    expect(promoRefusalWords("used_up", null)).toBe("This code has reached its usage limit.");
    expect(promoRefusalWords("used_by_member", null)).toBe("You've already used this code.");
    expect(promoRefusalWords("not_started", "1 Dec 2026")).toBe("This code can be used from 1 Dec 2026.");
    expect(PROMO_CODE_WORDS.not_for("Day pass")).toBe("This code can't be used on Day pass.");
  });
});

const GYM = { name: "Iron House", postalAddress: null, contactPhone: null, contactEmail: null };
const type = (over: Partial<ForSaleType> = {}): ForSaleType => ({
  id: "0f1e2d3c-4b5a-4697-8a8b-9c0d1e2f3a4b",
  name: "Gold Monthly",
  description: null,
  kind: "recurring",
  priceMinor: 4999,
  currency: "USD",
  termCount: 1,
  termUnit: "month",
  packClasses: null,
  packDays: null,
  joiningFeeMinor: 0,
  contractPeriods: null,
  contractThen: null,
  noticeDays: null,
  leaveFeeMinor: null,
  coolingOffDays: null,
  ...over,
});
const promo = (over: Partial<ForSalePromo> = {}): ForSalePromo => ({
  id: "1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d",
  code: "SUMMER20",
  name: "Summer",
  kind: "percent",
  percentBp: 2000,
  amountMinor: null,
  membershipPayments: "every",
  ...over,
});
const gift = { id: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d", name: "Refer a friend: friend's gift, WELCOME10", kind: "amount" as const, percentBp: null, amountMinor: 1000, membershipPayments: "first" as const };
const worked = (t: ForSaleType, over: Partial<ForSaleInput> = {}) => {
  const w = forSaleWorked({ type: t, taxes: [], taxIncluded: false, billDay: null, today: TODAY, gym: GYM, personName: "Asha Walk", ...over });
  if (w === null) throw new Error("not sold");
  return w;
};

describe("a line worked out with the code typed", () => {
  it("every payment: $10.00 off today and every month, in the tick the member reads", () => {
    const { item, given } = worked(type(), { promo: promo() });
    expect(item.firstPayment.amountMinor).toBe(3999);
    expect(item.firstPayment.promo).toEqual({ code: "SUMMER20", name: "Summer", offMinor: 1000, instead: null });
    expect(item.renews?.amountMinor).toBe(3999);
    expect(given.discount).toEqual({ id: promo().id, offMinor: 1000 });
    expect(repeatingChargeWords("Iron House", { brand: "VISA", last4: "1111" }, item)).toBe(
      "I agree that Iron House may charge my Visa ending 1111 $39.99 today, then $39.99 every month from 13 Dec 2026, until my membership ends or I cancel it.",
    );
  });

  it("first payment only: $10.00 off today, the whole $49.99 after", () => {
    const { item } = worked(type(), { promo: promo({ membershipPayments: "first" }) });
    expect(item.firstPayment.amountMinor).toBe(3999);
    expect(item.renews?.amountMinor).toBe(4999);
  });

  it("one discount a membership: the code is used instead of the friend's gift, and says so", () => {
    const { item, given } = worked(type({ kind: "pack", priceMinor: 9000, termCount: null, termUnit: null, packClasses: 10, packDays: 60 }), { promo: promo(), friendGift: gift });
    expect(item.firstPayment.amountMinor).toBe(7200);
    expect(item.firstPayment.friendGift).toBeNull();
    expect(item.firstPayment.promo?.instead).toBe(gift.name);
    expect(given.discount?.id).toBe(promo().id);
  });

  it("a code that would take off the whole price takes nothing: the friend's gift stays, and the line says no code", () => {
    const pass = type({ kind: "pack", name: "Day pass", priceMinor: 1500, termCount: null, termUnit: null, packClasses: 1, packDays: 1 });
    const { item, given } = worked(pass, { promo: promo({ kind: "amount", percentBp: null, amountMinor: 2000 }), friendGift: gift });
    expect(item.firstPayment.promo).toBeNull();
    expect(item.firstPayment.friendGift).toEqual({ name: gift.name, offMinor: 1000 });
    expect(item.firstPayment.amountMinor).toBe(500);
    expect(given.discount?.id).toBe(gift.id);
  });

  it("no code typed: the line is as it was", () => {
    const plain = worked(type());
    expect(plain.item.firstPayment.promo).toBeNull();
    expect(plain.item.firstPayment.amountMinor).toBe(4999);
  });
});
