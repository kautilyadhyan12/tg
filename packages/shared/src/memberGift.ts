// REFER A FRIEND'S MEMBER'S GIFT (ROADMAP 20e-ii-b-ii-a; spec Part 3 §16.3).
//
// The member who invited a friend is given the offer's member's gift, once a friend, when
// that friend makes their first payment that stands: off the member's next bill by itself,
// else filled in at their next Add membership or Sell. The worst thing this could do to a
// real person: take money off somebody else's bill, or give the gift twice. The rule that
// decides who is given it is the server's, inside the payment's own transaction; this file
// holds what the gift takes off one price and every sentence said about it.
//
// The owner picks what it is (20e-ii-b-ii-b): money off a membership (their next bill, else
// filled in at Add membership), money off products at the desk (filled in at Sell), or free
// days added to the membership they have, with money off a membership for a member who has
// none then.
import { z } from "zod";
import { bpToPercentText, discountOff, DISCOUNT_KINDS, DISCOUNT_PERCENT_BP_MAX, type DiscountKind } from "./discounts.js";
import { formatMinor, MEMBERSHIP_PRICE_MINOR_MAX } from "./memberships.js";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The most free days one gift gives. */
export const GIFT_DAYS_MAX = 90;

/** What money off comes off: a membership's payment, or products sold at the desk. */
export const MEMBER_GIFT_ON = ["membership", "products"] as const;
export const memberGiftOnSchema = z.enum(MEMBER_GIFT_ON);
export type MemberGiftOn = z.infer<typeof memberGiftOnSchema>;

/** The gift as it was promised when it was given: the offer can change later. */
export interface MemberGiftTerms {
  kind: DiscountKind;
  percentBp: number | null;
  amountMinor: number | null;
  currency: string | null;
}

/** "14 free days", "1 free day". */
export function giftDaysWords(days: number): string {
  return days === 1 ? "1 free day" : `${String(days)} free days`;
}

/** What the next payment is, in a member's words. */
const nextPayment = (on: MemberGiftOn): string => (on === "products" ? "your next purchase at the desk" : "your next membership payment");

/** What the gift takes off one price before tax, in `currency`: 0 where it does not fit it,
 *  because an amount is in another money, it rounds to nothing, or it would leave nothing to
 *  pay (nothing in the app is ever sold or billed at nothing to pay). A gift that does not fit
 *  waits for the next payment it does. */
export function memberGiftOff(gift: MemberGiftTerms, listedMinor: number, currency: string): number {
  if (gift.kind === "amount" && gift.currency !== currency) return 0;
  const off = discountOff(gift, listedMinor);
  return off >= listedMinor ? 0 : off;
}

/** "10% off" or "£10.00 off". */
export function memberGiftWords(gift: MemberGiftTerms): string {
  return gift.kind === "percent" ? `${bpToPercentText(gift.percentBp ?? 0)}% off` : `${formatMinor(gift.amountMinor ?? 0, gift.currency ?? "USD")} off`;
}

/** The message in the member's inbox when their gift is given. The friend is not named:
 *  the member may have sent their link to many people, and joining is the friend's own. It
 *  promises "by itself" only where a record of theirs on the gym's list can take it (`listed`);
 *  otherwise the gym takes it off when they next pay (round one, H3). */
export function memberGiftMessage(gift: MemberGiftTerms, gymName: string, listed = true, on: MemberGiftOn = "membership"): string {
  const gym = gymName.trim();
  const off = `You get ${memberGiftWords(gift)} ${nextPayment(on)}`;
  return `A friend you invited has joined ${gym} and made their first payment. ${listed ? `${off}: it comes off by itself.` : `${off} at ${gym}.`}`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const fullDay = (day: string): string => `${String(Number(day.slice(8, 10)))} ${MONTHS[Number(day.slice(5, 7)) - 1] ?? ""} ${day.slice(0, 4)}`;

/** The message in the member's inbox when free days are added: the membership, and its new
 *  renewal or last day (`next`; null while it is frozen, whose dates move when it is
 *  unfrozen). The friend is not named. */
export function memberGiftDaysMessage(days: number, gymName: string, typeName: string, next: { renews: boolean; day: string } | null): string {
  const gym = gymName.trim();
  const added = `You get ${giftDaysWords(days)}, added to your ${typeName.trim()}`;
  const then = next === null ? "." : next.renews ? `: it now renews on ${fullDay(next.day)}.` : `: it now ends on ${fullDay(next.day)}.`;
  return `A friend you invited has joined ${gym} and made their first payment. ${added}${then}`;
}

const termsShape = {
  kind: z.enum(DISCOUNT_KINDS),
  percentBp: z.number().int().min(1).max(DISCOUNT_PERCENT_BP_MAX).nullable(),
  amountMinor: z.number().int().min(1).max(MEMBERSHIP_PRICE_MINOR_MAX).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
};

/** What became of the member's gift for one friend, as the lead's page reads it. Where it
 *  was taken off: a membership's bill (its type and the day it was due) or a sale at the
 *  desk (what was sold and the day). Taken back: the friend's payment was voided or refunded
 *  in full before the gift was used. */
export const leadMemberGiftSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("used"),
      words: z.string().min(1),
      on: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("bill"), what: z.string().min(1), dueOn: z.string().regex(DAY) }).strict(),
        z.object({ kind: z.literal("sale"), what: z.string().min(1), day: z.string().regex(DAY) }).strict(),
      ]),
    })
    .strict(),
  /** Free days added to a membership of the member's (`what`, its type) on `day`. */
  z.object({ state: z.literal("days_added"), words: z.string().min(1), what: z.string().min(1), day: z.string().regex(DAY) }).strict(),
  z.object({ state: z.literal("waiting"), words: z.string().min(1) }).strict(),
  /** The member is in the app but has no record on the gym's list: nothing can take it off yet. */
  z.object({ state: z.literal("waiting_no_record"), words: z.string().min(1) }).strict(),
  /** The member's record is a past member's: nothing takes it until they are back. */
  z.object({ state: z.literal("waiting_past"), words: z.string().min(1) }).strict(),
  /** The member left the app here, or their account is gone: nothing takes it unless they return. */
  z.object({ state: z.literal("waiting_left"), words: z.string().min(1) }).strict(),
  /** The member deleted their account: nothing will take it. */
  z.object({ state: z.literal("account_gone"), words: z.string().min(1) }).strict(),
  z
    .object({
      state: z.literal("taken_back"),
      words: z.string().min(1),
      why: z.enum(["voided", "refunded"]),
      day: z.string().regex(DAY),
    })
    .strict(),
]);
export type LeadMemberGift = z.infer<typeof leadMemberGiftSchema>;

/** The lead's line about the member's gift, for staff. `member` is the inviting member's
 *  name, `friend` the lead's first name; `on`, what a waiting gift of money comes off. */
export function memberGiftLine(g: LeadMemberGift, member: string, friend: string, on: MemberGiftOn = "membership"): string {
  const gift = `${member}'s gift for inviting ${friend} (${g.words})`;
  const products = on === "products";
  switch (g.state) {
    case "used":
      return g.on.kind === "bill"
        ? `${gift} came off their ${g.on.what} bill due ${fullDay(g.on.dueOn)}.`
        : `${gift} came off their ${g.on.what} at Sell on ${fullDay(g.on.day)}.`;
    case "days_added":
      return `${gift} was added to their ${g.what} on ${fullDay(g.day)}.`;
    case "waiting":
      return products
        ? `${gift} is filled in when they next buy at Sell.`
        : `${gift} comes off their next bill, or is filled in when they next add a membership.`;
    case "waiting_no_record":
      return products
        ? `${gift} is waiting: ${member} is in the app but not on your Members list, so Sell cannot find them. Add them to your list and it is filled in when they next buy at Sell.`
        : `${gift} is waiting: ${member} is in the app but not on your Members list, so there is no bill to take it off. Add them to your list and it comes off their next bill.`;
    case "waiting_past":
      return products
        ? `${gift} is waiting: ${member} is a past member. It is filled in at Sell if they come back.`
        : `${gift} is waiting: ${member} is a past member, so there is no bill to take it off. It comes off their next bill if they come back.`;
    case "waiting_left":
      return products
        ? `${gift} is waiting: ${member} is no longer a member here. It is filled in at Sell if they come back.`
        : `${gift} is waiting: ${member} is no longer a member here. It comes off their next bill if they come back.`;
    case "account_gone":
      return `${gift} will not be used: they have deleted their account.`;
    case "taken_back":
      return g.why === "voided"
        ? `${gift} was taken back: ${friend}'s payment of ${fullDay(g.day)} was voided.`
        : `${gift} was taken back: ${friend}'s payment of ${fullDay(g.day)} was refunded in full.`;
  }
}

/** A gift waiting for a person on the list, as Add membership and Sell fill it in. */
export const memberGiftSchema = z
  .object({
    id: z.string().uuid(),
    ...termsShape,
    /** What it comes off: Add membership fills in a membership's, Sell a products'. */
    on: memberGiftOnSchema,
    /** "£10.00 off". */
    words: z.string().min(1),
    /** The friend they invited, by the gym's own list; null where that record is gone. */
    friendName: z.string().min(1).nullable(),
  })
  .strict();
export type MemberGift = z.infer<typeof memberGiftSchema>;

/** The line under a filled-in gift, beside its Remove. */
export function memberGiftNote(gift: MemberGift): string {
  return gift.friendName === null ? "Refer a friend: for inviting a friend who joined." : `Refer a friend: for inviting ${gift.friendName}, who joined.`;
}

/** The line on the person's own page while a gift waits. */
export function memberGiftWaitingLine(gift: MemberGift): string {
  const why = gift.friendName === null ? "for inviting a friend who joined" : `for inviting ${gift.friendName}`;
  return gift.on === "products"
    ? `Refer a friend gift, ${gift.words} products, ${why}. It is filled in when you sell to them at Sell.`
    : `Refer a friend gift, ${gift.words} a membership, ${why}. It comes off their next bill by itself, or is filled in when you add a membership.`;
}

/** Free days on a membership, under it on the person's page: who they were for inviting,
 *  so anybody can see why its dates moved. */
export function memberGiftDaysLine(days: number, friendName: string | null): string {
  const why = friendName === null ? "" : ` for inviting ${friendName}`;
  return `Refer a friend gift${why}: ${days === 1 ? "1 day" : `${String(days)} days`} added`;
}

/** What a gift took off one bill or sale, as staff read it: who it was for inviting, so
 *  anybody can see why at a glance (Kd at the click-through), and what came off. */
export function memberGiftBillLine(offMinor: number, currency: string, friendName: string | null = null): string {
  const why = friendName === null ? "" : ` for inviting ${friendName}`;
  return `Refer a friend gift${why}: ${formatMinor(offMinor, currency)} off`;
}

/** A sale's discount line where the gift was taken off it, on its receipt and in reports. */
export const MEMBER_GIFT_SALE_NAME = "Refer a friend gift";

export const MEMBER_GIFT_WORDS = {
  not_theirs: "That Refer a friend gift is not this person's, or has been used. Nothing was saved: refresh the page to see it as it is now.",
  changed: "What the Refer a friend gift takes off has changed. Nothing was saved: check the total and try again.",
  with_discount: "A Refer a friend gift and a discount can't both be used on one sale. Nothing was sold: remove one of them.",
} as const;
