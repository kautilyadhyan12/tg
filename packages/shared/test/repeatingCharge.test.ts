import { describe, expect, it } from "vitest";
import { forSaleWorked, repeatingChargeWords, type ForSaleInput, type ForSaleType } from "../src/forSale.js";

// Buying a repeating membership in the app (18k-iv): the tick the member reads names what is charged today, what after,
// how often, from which day, and the card. Every case is worked by hand from the price list, not from this code: $49.99
// a month bought on 12 November 2026 next charges on 12 December; 8.25% Texas sales tax on $49.99 is $54.11; a $25.00
// joining fee is today's alone; a $10.00 Refer a friend gift comes off the first payment only; billing everyone on the
// 1st (18y) charges a part month today and the whole price from 1 December; a minimum term of one payment that then ends
// has no second payment.

const TODAY = "2026-11-12";
const GYM = { name: "Iron House", postalAddress: null, contactPhone: null, contactEmail: null };
const VISA = { brand: "VISA", last4: "1111" };
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
const worked = (t: ForSaleType, over: Partial<ForSaleInput> = {}) => {
  const w = forSaleWorked({ type: t, taxes: [], taxIncluded: false, billDay: null, today: TODAY, gym: GYM, personName: "Asha Walk", ...over });
  if (w === null) throw new Error("not sold");
  return w.item;
};
const tail = (rest: string) => `I agree that Iron House may charge my Visa ending 1111 ${rest}`;

describe("the tick for a repeating charge", () => {
  it.each([
    ["every month", type(), {}, tail("$49.99 today, then $49.99 every month from 12 Dec 2026, until my membership ends or I cancel it.")],
    ["every 2 weeks", type({ termCount: 2, termUnit: "week", priceMinor: 2500 }), {}, tail("$25.00 today, then $25.00 every 2 weeks from 26 Nov 2026, until my membership ends or I cancel it.")],
    ["every year", type({ termUnit: "year", priceMinor: 49900 }), {}, tail("$499.00 today, then $499.00 every year from 12 Nov 2027, until my membership ends or I cancel it.")],
    ["tax on top", type(), { taxes: [{ name: "Sales tax", pcm: 8250 }] }, tail("$54.11 today, then $54.11 every month from 12 Dec 2026, until my membership ends or I cancel it.")],
    ["a joining fee today only", type({ joiningFeeMinor: 2500 }), {}, tail("$74.99 today, then $49.99 every month from 12 Dec 2026, until my membership ends or I cancel it.")],
    [
      "a Refer a friend gift off the first payment only",
      type(),
      { friendGift: { id: "e5f6a7b8-c9d0-4e1f-8a3b-4c5d6e7f8091", name: "Refer a friend", kind: "amount" as const, percentBp: null, amountMinor: 1000, membershipPayments: "first" as const } },
      tail("$39.99 today, then $49.99 every month from 12 Dec 2026, until my membership ends or I cancel it."),
    ],
    ["a minimum term of 12 that then renews", type({ contractPeriods: 12, contractThen: "renews" }), {}, tail("$49.99 today, then $49.99 every month from 12 Dec 2026, until my membership ends or I cancel it.")],
    ["one payment, then it ends", type({ contractPeriods: 1, contractThen: "ends" }), {}, tail("$49.99 today.")],
  ])("%s", (_name, t, over, words) => {
    expect(repeatingChargeWords("Iron House", VISA, worked(t, over))).toBe(words);
  });

  it("billing everyone on the 1st: a part month today, the whole price from 1 December", () => {
    const item = worked(type(), { billDay: 1 });
    expect(item.firstPayment.part).toBe(true);
    expect(item.firstPayment.amountMinor).toBeLessThan(4999);
    expect(item.renews).toEqual({ amountMinor: 4999, from: "2026-12-01", every: { count: 1, unit: "month" } });
  });

  it("a line paid once has no second payment, and another card's digits are its own", () => {
    expect(worked(type({ kind: "pack", termCount: null, termUnit: null, packClasses: 10, packDays: 60, priceMinor: 9000 })).renews).toBeNull();
    expect(repeatingChargeWords("Iron House", { brand: "MASTERCARD", last4: "5100" }, worked(type()))).toContain("my Mastercard ending 5100 $49.99 today");
  });
});
