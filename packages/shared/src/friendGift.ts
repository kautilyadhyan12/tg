// REFER A FRIEND: THE FRIEND'S GIFT — spec Part 3 §16.3; ROADMAP Stage 2 item 20e-ii-b-i.
//
// Somebody a member invited is offered the business's friend's gift, filled in for staff on
// what they add or sell them, until they have had it once. Somebody already on Members
// before they were invited is not a new member, and is not offered it. The friend never
// holds the code, so they never have to ask for it (Kd, 2026-10-15).
import { z } from "zod";
import { gymDiscountSchema } from "./discounts.js";
import { memberGiftSchema } from "./memberGift.js";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** What is known about one invited friend's gift, read under the record's lock. */
export interface FriendGiftFacts {
  /** They were on Members, or held a membership here, before they were invited. */
  memberBefore: boolean;
  /** What the gift was given on and the gym's day it was; null while it has not been. */
  given: { on: string; day: string } | null;
  /** The first membership added since the invite without the gift, the gym's day it was, and
   *  the staff who added it (null where unknown); null for none. */
  skipped: { on: string; day: string; by: string | null } | null;
  /** The business's friend's gift as it is today, where it can be used today, with its words
   *  ("20% off the first payment of a membership"). */
  gift: { forMemberships: boolean; forProducts: boolean; words: string } | null;
}

export const leadFriendGiftSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("given"), on: z.string().min(1), day: z.string().regex(DAY) }).strict(),
  z
    .object({
      state: z.literal("to_give"),
      words: z.string().min(1),
      forMemberships: z.boolean(),
      forProducts: z.boolean(),
      skipped: z.object({ on: z.string().min(1), day: z.string().regex(DAY), by: z.string().min(1).nullable() }).strict().nullable(),
    })
    .strict(),
  z.object({ state: z.literal("member_before") }).strict(),
  z.object({ state: z.literal("no_gift") }).strict(),
]);
export type LeadFriendGift = z.infer<typeof leadFriendGiftSchema>;

/** Given once is given: that is said first. A member before is never offered it; with no
 *  usable gift, nothing is to give. */
export function friendGiftState(f: FriendGiftFacts): LeadFriendGift {
  if (f.given !== null) return { state: "given", on: f.given.on, day: f.given.day };
  if (f.memberBefore) return { state: "member_before" };
  if (f.gift === null) return { state: "no_gift" };
  return { state: "to_give", words: f.gift.words, forMemberships: f.gift.forMemberships, forProducts: f.gift.forProducts, skipped: f.skipped };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const fullDay = (day: string): string => `${String(Number(day.slice(8, 10)))} ${MONTHS[Number(day.slice(5, 7)) - 1] ?? ""} ${day.slice(0, 4)}`;

/** The lead's line about the friend's gift, for staff: what was given, or why not, or where
 *  it will be filled in. `name` is the lead's first name. */
export function friendGiftLine(g: LeadFriendGift, name: string): string {
  switch (g.state) {
    case "given":
      return `Friend's gift given on ${g.on}, ${fullDay(g.day)}.`;
    case "member_before":
      return `No friend's gift: ${name} was already on your Members list before they were invited.`;
    case "no_gift":
      return "No friend's gift: Refer a friend has no friend's gift that can be used today.";
    case "to_give": {
      if (g.skipped !== null && g.forMemberships) {
        const when = g.skipped.by === null ? `${name}'s ${g.skipped.on} was added` : `${g.skipped.by} added ${name}'s ${g.skipped.on}`;
        const next = g.forProducts ? `${name}'s next membership is added or they buy at Sell` : `${name}'s next membership is added`;
        return `${name} has not had the friend's gift yet (${g.words}). It was not used when ${when} on ${fullDay(g.skipped.day)}. It will be filled in again when ${next}.`;
      }
      const where =
        g.forMemberships && g.forProducts
          ? `when ${name}'s membership is added or they buy at Sell`
          : g.forMemberships
            ? `when ${name}'s membership is added`
            : `when ${name} buys something at Sell`;
      return `Friend's gift (${g.words}): filled in ${where}.`;
    }
  }
}

/** The friend's gift a person on the list may be given now: the discount itself, its words,
 *  and who invited them (null where that member's account is gone). */
export const friendGiftSchema = z
  .object({
    discount: gymDiscountSchema,
    words: z.string().min(1),
    invitedBy: z.string().min(1).nullable(),
  })
  .strict();
export type FriendGift = z.infer<typeof friendGiftSchema>;
/** With the person's own Refer a friend gift where one waits for them (20e-ii-b-ii-a). */
export const friendGiftResponseSchema = z.object({ friendGift: friendGiftSchema.nullable(), memberGift: memberGiftSchema.nullable().default(null) }).strict();
export type FriendGiftResponse = z.infer<typeof friendGiftResponseSchema>;

/** The line under a filled-in gift, beside its Remove. */
export function friendGiftNote(gift: FriendGift): string {
  return gift.invitedBy === null ? "Refer a friend: a member invited them." : `Refer a friend: ${gift.invitedBy} invited them.`;
}

export const FRIEND_GIFT_WORDS = {
  not_theirs: "Refer a friend's gift is only for a friend a member invited, and only once.",
} as const;
