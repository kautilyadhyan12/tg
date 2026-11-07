// REFER A FRIEND (spec Part 3 §16.3; ROADMAP 20e-ii-a): what a member and a friend are
// promised, said from the discount as it is. Every sentence here was written by hand from
// what the discount does, not from the code's own words.
import { describe, expect, it } from "vitest";
import {
  invitedByWords,
  inviteEnquiryRequestSchema,
  inviteLines,
  leadSchema,
  referralCodeSchema,
  referralGiftLive,
  referralGiftProblem,
  referralGiftInputWords,
  referralGiftWords,
  referralMemberGiftWords,
  referralLineWords,
  referralOfferLines,
  referralShareMessage,
  referralTickets,
  memberReferralResponseSchema,
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
    ["a percentage off every payment", { membershipPayments: "every" }, "10% off every payment of a membership"],
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
  const next = (g: { kind: "percent" | "amount"; percentBp: number | null; amountMinor: number | null; currency: string | null }): string => referralMemberGiftWords(g).gift;
  it.each([
    [{ kind: "percent" as const, percentBp: 1000, amountMinor: null, currency: null }, "10% off your next membership payment"],
    [{ kind: "percent" as const, percentBp: 1250, amountMinor: null, currency: null }, "12.5% off your next membership payment"],
    [{ kind: "amount" as const, percentBp: null, amountMinor: 50000, currency: "INR" }, "₹500.00 off your next membership payment"],
    [{ kind: "amount" as const, percentBp: null, amountMinor: 500, currency: "GBP" }, "£5.00 off your next membership payment"],
  ])("the member's gift %j reads %s", (gift, words) => {
    expect(next(gift)).toBe(words);
  });
  it("off products, and free days with the money a member with no membership gets instead", () => {
    const gbp = { kind: "amount" as const, percentBp: null, amountMinor: 500, currency: "GBP" };
    expect(referralMemberGiftWords({ ...gbp, on: "products" })).toEqual({ gift: "£5.00 off your next purchase at the desk", instead: null });
    const days = referralMemberGiftWords({ ...gbp, on: "membership", days: 14 });
    expect(days).toEqual({ gift: "14 free days on your membership", instead: "£5.00 off your next membership payment" });
    expect(referralOfferLines("Iron Gym", days, null)).toEqual([
      "When a friend you invite joins Iron Gym and makes their first payment, you get 14 free days on your membership. They are added by themselves, and we'll tell you in your inbox.",
      "If you have no membership then, you get £5.00 off your next membership payment instead.",
      "Your link shows your first name to whoever opens it.",
      "This offer is set by Iron Gym and may change.",
    ]);
  });
  it("both gifts, that it comes off by itself, the name their link shows, and who set the offer", () => {
    const pct = referralMemberGiftWords({ kind: "percent", percentBp: 1000, amountMinor: null, currency: null });
    expect(referralOfferLines("Northside Gym", pct, "₹500.00 off the first payment of a membership", "Maya")).toEqual([
      "When a friend you invite joins Northside Gym and makes their first payment, you get 10% off your next membership payment. It comes off by itself, and we'll tell you in your inbox.",
      "Your friend gets ₹500.00 off the first payment of a membership when they join.",
      "Your link shows your first name, Maya, to whoever opens it.",
      "This offer is set by Northside Gym and may change.",
    ]);
  });
  it("the member's gift alone, in the owner's preview where no member is named", () => {
    expect(referralOfferLines("Ann's Yoga ", { gift: "£5.00 off your next payment", instead: null }, null)).toEqual([
      "When a friend you invite joins Ann's Yoga and makes their first payment, you get £5.00 off your next payment. It comes off by itself, and we'll tell you in your inbox.",
      "Your link shows your first name to whoever opens it.",
      "This offer is set by Ann's Yoga and may change.",
    ]);
  });
  it("the friend's gift alone", () => {
    expect(referralOfferLines("Northside Gym", null, "20% off a membership", "Maya")).toEqual([
      "Your friend gets 20% off a membership when they join.",
      "Your link shows your first name, Maya, to whoever opens it.",
      "This offer is set by Northside Gym and may change.",
    ]);
  });
  it("no gift that can be used today promises nothing", () => {
    expect(referralOfferLines("Northside Gym", null, null, "Maya")).toEqual([
      "Send your link to a friend who'd like to join Northside Gym.",
      "Your link shows your first name, Maya, to whoever opens it.",
      "This offer is set by Northside Gym and may change.",
    ]);
  });
});

// The phone's Invite a friend (Stage 5 item 20a): the same offer as the lines above, each gift
// on a ticket of its own. Written by hand from what each gift does, as the lines were.
describe("what the member reads on the phone", () => {
  const gbp = { kind: "amount" as const, percentBp: null, amountMinor: 1000, currency: "GBP" };
  const money = referralMemberGiftWords({ ...gbp, on: "membership" });
  const days = referralMemberGiftWords({ ...gbp, on: "membership", days: 14 });
  const desk = referralMemberGiftWords({ ...gbp, on: "products" });
  const small = ["Your link shows your first name, Maya, to whoever opens it.", "This offer is set by Iron House Gym and may change."];
  it.each([
    [
      "both gifts, money off for the member",
      money,
      "10% off the first payment of a membership",
      {
        you: { gift: "£10.00 off your next membership payment", notes: ["When a friend you invite joins Iron House Gym and makes their first payment, it comes off by itself, and we'll tell you in your inbox."] },
        friend: { gift: "10% off the first payment of a membership", note: "Iron House Gym adds it for them when they join." },
        plain: null,
      },
    ],
    [
      "free days for the member, and the money a member with no membership gets instead",
      days,
      null,
      {
        you: {
          gift: "14 free days on your membership",
          notes: [
            "When a friend you invite joins Iron House Gym and makes their first payment, they are added by themselves, and we'll tell you in your inbox.",
            "If you have no membership then, you get £10.00 off your next membership payment instead.",
          ],
        },
        friend: null,
        plain: null,
      },
    ],
    [
      "money off at the desk for the member",
      desk,
      null,
      {
        you: { gift: "£10.00 off your next purchase at the desk", notes: ["When a friend you invite joins Iron House Gym and makes their first payment, it comes off by itself, and we'll tell you in your inbox."] },
        friend: null,
        plain: null,
      },
    ],
    ["the friend's gift alone", null, "₹500.00 off products", { you: null, friend: { gift: "₹500.00 off products", note: "Iron House Gym adds it for them when they join." }, plain: null }],
    ["no gift that can be used today promises nothing", null, null, { you: null, friend: null, plain: "Send your link to a friend who'd like to join Iron House Gym." }],
  ])("%s", (_name, member, friend, tickets) => {
    expect(referralTickets("Iron House Gym ", member, friend, "Maya")).toEqual({ ...tickets, small });
  });
  it("each ticket says what the lines say: the same gift and the same sentences, the gift lifted out", () => {
    for (const member of [money, days, desk, null]) {
      for (const friend of ["10% off the first payment of a membership", null]) {
        const lines = referralOfferLines("Iron House Gym", member, friend, "Maya").join(" ");
        const t = referralTickets("Iron House Gym", member, friend, "Maya");
        if (member !== null) expect(lines).toContain(`you get ${member.gift}.`);
        for (const note of t.you?.notes.slice(1) ?? []) expect(lines).toContain(note);
        // The note's second half is the lines' own sentence, its first letter made small.
        if (t.you !== null && member !== null) {
          const second = lines.split("you get ")[1]?.split(". ")[1] ?? "none";
          expect(t.you.notes[0]?.toLowerCase()).toContain(second.toLowerCase());
        }
        for (const words of [...t.small, t.plain ?? ""]) expect(lines).toContain(words);
        if (friend !== null) expect(lines).toContain(`Your friend gets ${friend} when they join.`);
      }
    }
  });
  it("a first letter is made a capital, and nothing else changes", () => {
    expect(referralTickets("Gym", { gift: "free month", instead: null }, "a free class", null)).toMatchObject({ you: { gift: "Free month" }, friend: { gift: "A free class" } });
    expect(referralTickets("Gym", null, null, null).small[0]).toBe("Your link shows your first name to whoever opens it.");
  });
  it("the Gym tab's line names the member's own gift, and nothing where there is none", () => {
    expect(referralLineWords("£10.00 off your next membership payment")).toBe("You get £10.00 off your next membership payment when a friend you invite joins and pays");
    expect(referralLineWords(null)).toBeNull();
  });
  it("what goes with a shared link: the business and the link, and no gift that may change", () => {
    expect(referralShareMessage(" Iron House Gym ", "https://kwazo.app/invite/abcdefghijklmnop")).toBe("Join me at Iron House Gym: https://kwazo.app/invite/abcdefghijklmnop");
  });
  it("the phone takes only a link of an invite code, under the business it asked", () => {
    const on = {
      status: "on",
      gymId: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
      gymName: "Iron House Gym",
      path: "/invite/abcdefghijklmnop",
      memberGift: null,
      friendGift: null,
      lines: ["x"],
      tickets: referralTickets("Iron House Gym", null, null, null),
    };
    expect(memberReferralResponseSchema.safeParse(on).success).toBe(true);
    for (const path of ["/invite/abc", "https://evil.example/invite/abcdefghijklmnop", "/invite/abcdefghijklmnop/x", "/gyms/abcdefghijklmnop", "/invite/ABCDEFGHIJKLMNOP"]) {
      expect(memberReferralResponseSchema.safeParse({ ...on, path }).success).toBe(false);
    }
    expect(memberReferralResponseSchema.safeParse({ ...on, gymId: undefined }).success).toBe(false);
    expect(memberReferralResponseSchema.safeParse({ status: "off", gymName: "Iron House Gym" }).success).toBe(false);
  });
});

describe("what the friend reads: the member's first name, and no more of them", () => {
  it("with a gift and a name", () => {
    expect(inviteLines("Northside Gym", { words: "20% off a membership" }, "Maya")).toEqual([
      "Maya invited you to join Northside Gym.",
      "Your welcome offer: 20% off a membership. Northside Gym adds it for you when you join.",
      "Leave your details and Northside Gym will be in touch.",
      "This offer is set by Northside Gym and may change.",
    ]);
  });
  it("without a name that can be said, and without a gift", () => {
    expect(inviteLines("Northside Gym", null, null)).toEqual(["A member of Northside Gym has invited you.", "Leave your details and Northside Gym will be in touch."]);
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
  const member = { kind: "percent", percentBp: 1000, amountMinor: null, on: "membership", days: null };
  const gift = { kind: "percent", percentBp: 1000, amountMinor: null, on: "first" };
  it.each([
    ["on with a gift for the member", { on: true, member, friend: null }, true],
    ["on with a gift for the friend", { on: true, member: null, friend: gift }, true],
    ["on with no gift", { on: true, member: null, friend: null }, false],
    ["off with no gift", { on: false, member: null, friend: null }, true],
    ["a percentage that carries an amount", { on: true, member: { ...member, amountMinor: 500 }, friend: null }, false],
    ["an amount with no amount", { on: true, member: { ...member, kind: "amount", percentBp: null }, friend: null }, false],
    ["100% off", { on: true, member: { ...member, percentBp: 10000 }, friend: null }, false],
    ["the member's gift off products", { on: true, member: { ...member, on: "products" }, friend: null }, true],
    ["the member's gift off something the box does not offer", { on: true, member: gift, friend: null }, false],
    ["the member's gift with no word of what it comes off", { on: true, member: { kind: "percent", percentBp: 1000, amountMinor: null, days: null }, friend: null }, false],
    ["free days, with the money for a member with none", { on: true, member: { ...member, days: 14 }, friend: null }, true],
    ["free days: 90 at most", { on: true, member: { ...member, days: 90 }, friend: null }, true],
    ["free days: 91", { on: true, member: { ...member, days: 91 }, friend: null }, false],
    ["free days: none", { on: true, member: { ...member, days: 0 }, friend: null }, false],
    ["free days: part of one", { on: true, member: { ...member, days: 1.5 }, friend: null }, false],
    ["free days with no money for a member with none", { on: true, member: { ...member, kind: "amount", percentBp: null, days: 14 }, friend: null }, false],
    ["the friend's gift off something the box does not offer", { on: true, member: null, friend: { ...gift, on: "everything" } }, false],
    ["a key it does not know", { on: false, member: null, friend: null, by: "x" }, false],
  ])("%s", (_name, body, ok) => {
    // Every save names the version of the offer it read (item 20's passes, H3).
    expect(setReferralSettingsRequestSchema.safeParse({ ...body, version: "" }).success).toBe(ok);
  });
  it("a save that names no version of the offer it read is refused", () => {
    expect(setReferralSettingsRequestSchema.safeParse({ on: false, member: null, friend: null }).success).toBe(false);
  });
  it.each([
    ["an email", { fullName: "Tara", email: "tara@example.com", robotToken: "t" }, true],
    ["no email", { fullName: "Tara", phone: "+447700900123", robotToken: "t" }, false],
    ["a blank email", { fullName: "Tara", email: "   ", robotToken: "t" }, false],
    ["where they heard of the business, which the link already says", { fullName: "Tara", email: "tara@example.com", source: "friend", robotToken: "t" }, false],
  ])("the invite form with %s", (_name, body, ok) => {
    expect(inviteEnquiryRequestSchema.safeParse(body).success).toBe(ok);
  });
  it("a gift as typed reads as the saved one will", () => {
    expect(referralGiftInputWords({ kind: "amount", percentBp: null, amountMinor: 50000, on: "first" }, "INR")).toBe("₹500.00 off the first payment of a membership");
    expect(referralGiftInputWords({ kind: "percent", percentBp: 1500, amountMinor: null, on: "products" }, null)).toBe("15% off products");
  });
});
