// Refer a friend's member's gift: what it takes off one price, and every sentence about it
// (ROADMAP 20e-ii-b-ii-a). A table over every class of case: a percentage and an amount, in
// the price's money and another, rounding to nothing, as large as the price and larger.
import { describe, expect, it } from "vitest";
import {
  friendGiftResponseSchema,
  leadMemberGiftSchema,
  memberGiftBillLine,
  memberGiftLine,
  memberGiftMessage,
  memberGiftNote,
  memberGiftOff,
  memberGiftWaitingLine,
  memberGiftWords,
  sellProductRequestSchema,
  type MemberGift,
  type MemberGiftTerms,
} from "../src/index.js";

const pct = (bp: number): MemberGiftTerms => ({ kind: "percent", percentBp: bp, amountMinor: null, currency: null });
const gbp = (minor: number): MemberGiftTerms => ({ kind: "amount", percentBp: null, amountMinor: minor, currency: "GBP" });

describe("memberGiftOff: what the gift takes off one price before tax", () => {
  const cases: [string, MemberGiftTerms, number, string, number][] = [
    ["10% of £50", pct(1000), 5000, "GBP", 500],
    ["10% of £49.99 rounds half up", pct(1000), 4999, "GBP", 500],
    ["12.5% of £39.99", pct(1250), 3999, "GBP", 500],
    ["a percentage in any money", pct(1000), 5000, "INR", 500],
    ["1% of 1p rounds to nothing: waits", pct(100), 1, "GBP", 0],
    ["99.99% of £1 leaves 0p: nothing to pay, waits", pct(9999), 100, "GBP", 0],
    ["£10 off £50", gbp(1000), 5000, "GBP", 1000],
    ["£10 off £10.01 leaves 1p", gbp(1000), 1001, "GBP", 1000],
    ["£10 off £10 is the whole price: waits", gbp(1000), 1000, "GBP", 0],
    ["£10 off £8 is more than the price: waits", gbp(1000), 800, "GBP", 0],
    ["£10 off a price in rupees: another money, waits", gbp(1000), 500000, "INR", 0],
    ["a price of nothing", gbp(1000), 0, "GBP", 0],
    ["a price that is not a whole number of pence", gbp(100), 10.5, "GBP", 0],
  ];
  it.each(cases)("%s", (_label, gift, listed, currency, off) => {
    expect(memberGiftOff(gift, listed, currency)).toBe(off);
  });
  it("never leaves nothing to pay, and never takes off more than the price, at any price", () => {
    for (const gift of [pct(1), pct(5000), pct(9999), gbp(1), gbp(999), gbp(5000)]) {
      for (let listed = 1; listed <= 6000; listed += 7) {
        const off = memberGiftOff(gift, listed, "GBP");
        expect(off).toBeGreaterThanOrEqual(0);
        expect(off).toBeLessThan(listed);
      }
    }
  });
});

describe("the words", () => {
  it("says the gift as it was given", () => {
    expect(memberGiftWords(pct(1000))).toBe("10% off");
    expect(memberGiftWords(pct(1250))).toBe("12.5% off");
    expect(memberGiftWords(gbp(1000))).toBe("£10.00 off");
    expect(memberGiftBillLine(1000, "GBP")).toBe("Refer a friend gift: £10.00 off");
    expect(memberGiftBillLine(1000, "GBP", "Tara Shah")).toBe("Refer a friend gift for inviting Tara Shah: £10.00 off");
  });

  it("tells the member without naming the friend", () => {
    expect(memberGiftMessage(gbp(1000), " Iron Gym ")).toBe(
      "A friend you invited has joined Iron Gym and made their first payment. You get £10.00 off your next payment: it comes off by itself.",
    );
  });

  it("tells a member with no record on the list it comes off at the gym, not by itself (round one, H3)", () => {
    expect(memberGiftMessage(gbp(1000), "Iron Gym", false)).toBe(
      "A friend you invited has joined Iron Gym and made their first payment. You get £10.00 off your next payment at Iron Gym.",
    );
  });

  it("the lead's line, in every state", () => {
    const words = "£10.00 off";
    expect(memberGiftLine({ state: "used", words, on: { kind: "bill", what: "Gold Monthly", dueOn: "2026-11-01" } }, "Maya Rao", "Tara")).toBe(
      "Maya Rao's gift for inviting Tara (£10.00 off) came off their Gold Monthly bill due 1 November 2026.",
    );
    expect(memberGiftLine({ state: "used", words, on: { kind: "sale", what: "Protein tub", day: "2026-10-20" } }, "Maya Rao", "Tara")).toBe(
      "Maya Rao's gift for inviting Tara (£10.00 off) came off their Protein tub at Sell on 20 October 2026.",
    );
    expect(memberGiftLine({ state: "waiting", words }, "Maya Rao", "Tara")).toBe(
      "Maya Rao's gift for inviting Tara (£10.00 off) comes off their next bill, or is filled in when they next add a membership or buy at Sell.",
    );
    expect(memberGiftLine({ state: "waiting_no_record", words }, "Maya Rao", "Tara")).toBe(
      "Maya Rao's gift for inviting Tara (£10.00 off) is waiting: Maya Rao is in the app but not on your Members list, so there is no bill to take it off. Add them to your list and it comes off their next bill.",
    );
    expect(memberGiftLine({ state: "waiting_past", words }, "Maya Rao", "Tara")).toBe(
      "Maya Rao's gift for inviting Tara (£10.00 off) is waiting: Maya Rao is a past member, so there is no bill to take it off. It comes off their next bill if they come back.",
    );
    expect(memberGiftLine({ state: "waiting_left", words }, "Maya Rao", "Tara")).toBe(
      "Maya Rao's gift for inviting Tara (£10.00 off) is waiting: Maya Rao is no longer a member here. It comes off their next bill if they come back.",
    );
    expect(memberGiftLine({ state: "taken_back", words, why: "voided", day: "2026-10-15" }, "Maya Rao", "Tara")).toBe(
      "Maya Rao's gift for inviting Tara (£10.00 off) was taken back: Tara's payment of 15 October 2026 was voided.",
    );
    expect(memberGiftLine({ state: "taken_back", words, why: "refunded", day: "2026-10-15" }, "Maya Rao", "Tara")).toBe(
      "Maya Rao's gift for inviting Tara (£10.00 off) was taken back: Tara's payment of 15 October 2026 was refunded in full.",
    );
  });

  it("the person's page and the desk", () => {
    const gift: MemberGift = { id: "00000000-0000-4000-8000-000000000001", ...gbp(1000), words: "£10.00 off", friendName: "Tara Shah" };
    expect(memberGiftNote(gift)).toBe("Refer a friend: for inviting Tara Shah, who joined.");
    expect(memberGiftNote({ ...gift, friendName: null })).toBe("Refer a friend: for inviting a friend who joined.");
    expect(memberGiftWaitingLine(gift)).toBe(
      "Refer a friend gift, £10.00 off, for inviting Tara Shah. It comes off their next bill by itself, or is filled in when you add a membership or sell to them.",
    );
  });
});

describe("the wire", () => {
  const sale = {
    requestKey: "00000000-0000-4000-8000-000000000002",
    productId: "00000000-0000-4000-8000-000000000003",
    quantity: 1,
    entryId: "00000000-0000-4000-8000-000000000004",
    method: "cash",
    totalMinor: 1500,
  };
  const memberGift = { id: "00000000-0000-4000-8000-000000000005", offMinor: 1000 };
  it("a sale carries the gift alone, for somebody on the list, never with a discount or for a walk-in", () => {
    expect(sellProductRequestSchema.parse(sale).memberGift).toBeNull();
    expect(sellProductRequestSchema.parse({ ...sale, memberGift }).memberGift).toEqual(memberGift);
    expect(sellProductRequestSchema.safeParse({ ...sale, memberGift, discountId: "00000000-0000-4000-8000-000000000006" }).success).toBe(false);
    expect(sellProductRequestSchema.safeParse({ ...sale, memberGift, entryId: null }).success).toBe(false);
    expect(sellProductRequestSchema.safeParse({ ...sale, memberGift: { ...memberGift, offMinor: 0 } }).success).toBe(false);
  });
  it("an older reply without the gift still reads", () => {
    expect(friendGiftResponseSchema.parse({ friendGift: null }).memberGift).toBeNull();
    expect(leadMemberGiftSchema.safeParse({ state: "waiting", words: "" }).success).toBe(false);
  });
});
