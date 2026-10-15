// REFER A FRIEND: THE FRIEND'S GIFT (spec Part 3 §16.3; ROADMAP 20e-ii-b-i): which state a
// friend's gift is in, over every class of case, and the line staff read on the lead. Every
// sentence here was written by hand from what happened to the person, not from the code.
import { describe, expect, it } from "vitest";
import { friendGiftLine, friendGiftState, leadMatchLine, type FriendGiftFacts } from "../src/index.js";

const MEMBERSHIPS = { forMemberships: true, forProducts: false };
const PRODUCTS = { forMemberships: false, forProducts: true };
const BOTH = { forMemberships: true, forProducts: true };
const facts = (over: Partial<FriendGiftFacts> = {}): FriendGiftFacts => ({ memberBefore: false, given: null, skipped: null, gift: MEMBERSHIPS, ...over });

describe("friendGiftState: every class of case", () => {
  const cases: [string, FriendGiftFacts, ReturnType<typeof friendGiftState>][] = [
    ["new friend, gift for memberships", facts(), { state: "to_give", forMemberships: true, forProducts: false, skipped: null }],
    ["new friend, gift for products", facts({ gift: PRODUCTS }), { state: "to_give", forMemberships: false, forProducts: true, skipped: null }],
    ["new friend, a membership added without it", facts({ skipped: "Gold Monthly" }), { state: "to_give", forMemberships: true, forProducts: false, skipped: "Gold Monthly" }],
    ["given once", facts({ given: { on: "Gold Monthly", day: "2026-10-15" } }), { state: "given", on: "Gold Monthly", day: "2026-10-15" }],
    // Given is said even where the offer has since lost its gift, or they were a member before.
    ["given, the gift gone since", facts({ given: { on: "Protein bar", day: "2026-10-16" }, gift: null }), { state: "given", on: "Protein bar", day: "2026-10-16" }],
    ["given, and a member before", facts({ given: { on: "Gold Monthly", day: "2026-10-15" }, memberBefore: true }), { state: "given", on: "Gold Monthly", day: "2026-10-15" }],
    ["a member before the invite", facts({ memberBefore: true }), { state: "member_before" }],
    ["a member before, and no gift", facts({ memberBefore: true, gift: null }), { state: "member_before" }],
    ["no gift that can be used today", facts({ gift: null }), { state: "no_gift" }],
  ];
  it.each(cases)("%s", (_name, input, want) => {
    expect(friendGiftState(input)).toEqual(want);
  });
});

describe("friendGiftLine: what staff read on the lead", () => {
  it.each([
    [{ state: "given", on: "Gold Monthly", day: "2026-10-05" } as const, "Friend's gift given on Gold Monthly, 5 October 2026."],
    [{ state: "member_before" } as const, "No friend's gift: Tara had a membership here before they were invited."],
    [{ state: "no_gift" } as const, "No friend's gift: Refer a friend has no friend's gift that can be used today."],
    [{ state: "to_give", ...MEMBERSHIPS, skipped: null } as const, "Friend's gift: filled in when Tara's membership is added."],
    [{ state: "to_give", ...MEMBERSHIPS, skipped: "Day pass" } as const, "Day pass was added without it. Friend's gift: filled in when Tara's membership is added."],
    [{ state: "to_give", ...PRODUCTS, skipped: "Day pass" } as const, "Friend's gift: filled in when Tara buys something at Sell."],
    [{ state: "to_give", ...BOTH, skipped: null } as const, "Friend's gift: filled in when Tara's membership is added or they buy at Sell."],
  ])("%j", (gift, line) => {
    expect(friendGiftLine(gift, "Tara")).toBe(line);
  });
});

describe("leadMatchLine: Add member's line about the lead", () => {
  const lead = { id: "11111111-1111-4111-8111-111111111111", fullName: "Tara Shah", sameName: true, invitedBy: null, friendGift: null };
  it.each([
    [lead, "Tara Shah is in Leads. Adding them marks them Joined."],
    [{ ...lead, invitedBy: { name: "Maya Patel", member: true } }, "Tara Shah is in Leads, invited by Maya Patel. Adding them marks them Joined."],
    [{ ...lead, invitedBy: { name: "Maya Patel", member: false } }, "Tara Shah is in Leads, invited by Maya Patel, who is no longer a member. Adding them marks them Joined."],
    [{ ...lead, invitedBy: { name: null, member: false } }, "Tara Shah is in Leads, invited by a member who has since deleted their account. Adding them marks them Joined."],
    [{ ...lead, fullName: "Tara", sameName: false }, "Tara in Leads has this email or phone."],
  ])("%#", (match, line) => {
    expect(leadMatchLine(match)).toBe(line);
  });
});
