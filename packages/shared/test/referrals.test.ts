// REFER A FRIEND (spec Part 3 §16.3; ROADMAP 20e-ii-a): what a member and a friend are
// promised, said from the discount as it is. Every sentence here was written by hand from
// what the discount does, not from the code's own words.
import { describe, expect, it } from "vitest";
import {
  invitedByWords,
  inviteLines,
  leadSchema,
  referralCodeSchema,
  referralGiftLive,
  referralGiftProblem,
  referralGiftWords,
  referralOfferLines,
  setReferralSettingsRequestSchema,
  type ReferralGiftTerms,
} from "../src/index.js";

const base: ReferralGiftTerms = {
  kind: "percent",
  percentBp: 1000,
  amountMinor: null,
  currency: null,
  forProducts: false,
  allProducts: true,
  forMemberships: true,
  allMembershipTypes: true,
  membershipPayments: "first",
  startsOn: null,
  endsOn: null,
  maxUses: null,
  uses: 0,
  archived: false,
  code: "THANKS10",
};

describe("a gift in words, for every shape a discount can have", () => {
  const cases: [string, Partial<ReferralGiftTerms>, string][] = [
    ["a percentage off a membership's first payment", {}, "10% off the first payment of a membership"],
    ["a percentage off every payment", { membershipPayments: "every" }, "10% off a membership"],
    ["12.5%", { percentBp: 1250 }, "12.5% off the first payment of a membership"],
    ["a fixed amount in rupees", { kind: "amount", percentBp: null, amountMinor: 50000, currency: "INR" }, "₹500.00 off the first payment of a membership"],
    ["a fixed amount in pounds", { kind: "amount", percentBp: null, amountMinor: 500, currency: "GBP" }, "£5.00 off the first payment of a membership"],
    ["some memberships only", { allMembershipTypes: false }, "10% off the first payment of some memberships"],
    ["products only", { forMemberships: false, membershipPayments: null, forProducts: true }, "10% off products"],
    ["some products only", { forMemberships: false, membershipPayments: null, forProducts: true, allProducts: false }, "10% off some products"],
    ["both", { forProducts: true }, "10% off memberships and products"],
    ["both, some of each", { forProducts: true, allProducts: false, allMembershipTypes: false }, "10% off some memberships and some products"],
    ["with an end day", { endsOn: "2026-12-31" }, "10% off the first payment of a membership, until 31 December 2026"],
  ];
  it.each(cases)("%s", (_name, over, words) => {
    expect(referralGiftWords({ ...base, ...over })).toBe(words);
  });
});

describe("a gift is promised only while its code can be used today", () => {
  const today = "2026-10-15";
  const cases: [string, Partial<ReferralGiftTerms>, boolean, string | null][] = [
    ["in use", {}, true, null],
    ["its last day is today", { endsOn: "2026-10-15" }, true, null],
    ["ended yesterday", { endsOn: "2026-10-14" }, false, "It ended on 14 October 2026."],
    ["starts tomorrow", { startsOn: "2026-10-16" }, false, "It starts on 16 October 2026."],
    ["starts today", { startsOn: "2026-10-15" }, true, null],
    ["used up", { maxUses: 3, uses: 3 }, false, "It has been used as many times as it allows."],
    ["one use left", { maxUses: 3, uses: 2 }, true, null],
    ["archived", { archived: true }, false, "It was archived."],
    ["no promo code", { code: null }, false, "It has no promo code."],
  ];
  it.each(cases)("%s", (_name, over, live, problem) => {
    expect(referralGiftLive({ ...base, ...over }, today)).toBe(live);
    expect(referralGiftProblem({ ...base, ...over }, today)).toBe(problem);
  });
});

describe("what the member reads", () => {
  it("both gifts, the code sent later, and who set the offer", () => {
    expect(referralOfferLines("Northside Gym", "10% off a membership", "₹500.00 off the first payment of a membership")).toEqual([
      "When a friend you invite joins Northside Gym and makes their first payment, you get 10% off a membership. We'll send your code to your inbox.",
      "Your friend gets ₹500.00 off the first payment of a membership when they join.",
      "This offer is set by Northside Gym and may change.",
    ]);
  });
  it("the member's gift alone", () => {
    expect(referralOfferLines("Ann's Yoga ", "10% off products", null)).toEqual([
      "When a friend you invite joins Ann's Yoga and makes their first payment, you get 10% off products. We'll send your code to your inbox.",
      "This offer is set by Ann's Yoga and may change.",
    ]);
  });
  it("the friend's gift alone", () => {
    expect(referralOfferLines("Northside Gym", null, "20% off a membership")).toEqual([
      "Your friend gets 20% off a membership when they join.",
      "This offer is set by Northside Gym and may change.",
    ]);
  });
  it("no gift that can be used today promises nothing", () => {
    expect(referralOfferLines("Northside Gym", null, null)).toEqual([
      "Send your link to a friend who'd like to join Northside Gym.",
      "This offer is set by Northside Gym and may change.",
    ]);
  });
});

describe("what the friend reads, and no member's name in it", () => {
  it("with a gift", () => {
    expect(inviteLines("Northside Gym", { code: "WELCOME20", words: "20% off a membership" })).toEqual([
      "A member of Northside Gym has invited you.",
      "Your welcome offer: 20% off a membership. Use code WELCOME20 when you join.",
      "Leave your details and Northside Gym will be in touch.",
      "This offer is set by Northside Gym and may change.",
    ]);
  });
  it("without one", () => {
    expect(inviteLines("Northside Gym", null)).toEqual(["A member of Northside Gym has invited you.", "Leave your details and Northside Gym will be in touch."]);
  });
});

describe("who invited a lead", () => {
  it.each([
    [{ name: "Maya Patel", member: true }, "Invited by Maya Patel"],
    [{ name: "Maya Patel", member: false }, "Invited by Maya Patel, who is no longer a member"],
    [{ name: null, member: false }, "Invited by a member who has since deleted their account"],
  ])("%j", (by, words) => {
    expect(invitedByWords(by)).toBe(words);
  });
  it("a lead from before this job reads as invited by nobody", () => {
    const lead = leadSchema.parse({
      id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
      fullName: "Asha",
      email: null,
      phone: "+447700900000",
      source: "friend",
      status: "new",
      notes: "",
      mayEmail: false,
      entryId: null,
      onList: false,
      createdAt: "2026-10-15T09:00:00.000Z",
      statusChangedAt: "2026-10-15T09:00:00.000Z",
      followUp: { sent: 0, dueOn: null, dueNow: false, overdue: false, lastSentAt: null, by: "you", appWhen: null, notSent: null, optedOutAt: null, optedOutHow: null },
    });
    expect(lead.invitedBy).toBeNull();
  });
});

describe("the parsers", () => {
  it.each([
    ["abcdefghijklmnop", true],
    ["abcdefghijkl2345", true],
    ["ABCDEFGHIJKLMNOP", false],
    ["abcdefghijklmno", false],
    ["abcdefghijklmnopq", false],
    ["abcdefghijklmno1", false],
    ["abcdefghijklmno8", false],
    ["abcdefghijklmn-p", false],
  ])("an invite code %s is %s", (code, ok) => {
    expect(referralCodeSchema.safeParse(code).success).toBe(ok);
  });
  it("switched on needs a gift; off needs none; nothing more is taken", () => {
    const id = "6f9619ff-8b86-4d11-b42d-00c04fc964ff";
    expect(setReferralSettingsRequestSchema.safeParse({ on: true, memberDiscountId: null, friendDiscountId: null }).success).toBe(false);
    expect(setReferralSettingsRequestSchema.safeParse({ on: true, memberDiscountId: id, friendDiscountId: null }).success).toBe(true);
    expect(setReferralSettingsRequestSchema.safeParse({ on: true, memberDiscountId: null, friendDiscountId: id }).success).toBe(true);
    expect(setReferralSettingsRequestSchema.safeParse({ on: false, memberDiscountId: null, friendDiscountId: null }).success).toBe(true);
    expect(setReferralSettingsRequestSchema.safeParse({ on: false, memberDiscountId: null, friendDiscountId: null, by: "x" }).success).toBe(false);
  });
});
