// REFER A FRIEND — spec Part 3 §16.3; ROADMAP Stage 2 item 20e-ii-a.
//
// A business switches it on and picks its own promo codes: one for the member who invites,
// one for the friend who is invited, or both. Each member has their own invite link; the
// friend who opens it reads the business's offer and can send it the enquiry form, and the
// lead that makes is marked with the member who sent it.
//
// Every sentence about a gift is made here, from the discount as it is now, so what a
// member or a friend is promised is what the code does. A gift whose code can no longer be
// used today is promised to nobody.
import { z } from "zod";
import { bpToPercentText, DISCOUNT_KINDS, DISCOUNT_PERCENT_BP_MAX, discountStatus, type DiscountKind, type MembershipPayments } from "./discounts.js";
import { MEMBER_LIST_MAX_EMAIL_CHARS, MEMBER_LIST_MAX_NAME_CHARS, MEMBER_LIST_MAX_TYPED_PHONE_CHARS } from "./memberList.js";
import { formatMinor, MEMBERSHIP_PRICE_MINOR_MAX } from "./memberships.js";
import { orgTypeSchema } from "./orgs.js";
import { GYM_ENQUIRY_MAX_MESSAGE_CHARS } from "./gymPage.js";
import { ROBOT_CHECK_TOKEN_MAX_CHARS } from "./robotCheck.js";

/** A member's invite code: 16 of `a-z2-7`, 80 random bits. */
export const REFERRAL_CODE_PATTERN = /^[a-z2-7]{16}$/;
export const referralCodeSchema = z.string().regex(REFERRAL_CODE_PATTERN);

/** The address an invite opens, on the app's own site. */
export const referralPath = (code: string): string => `/invite/${code}`;

/** What the words below read of a discount. */
export interface ReferralGiftTerms {
  kind: DiscountKind;
  percentBp: number | null;
  amountMinor: number | null;
  currency: string | null;
  forProducts: boolean;
  allProducts: boolean;
  forMemberships: boolean;
  allMembershipTypes: boolean;
  membershipPayments: MembershipPayments | null;
  startsOn: string | null;
  endsOn: string | null;
  maxUses: number | null;
  uses: number;
  archived: boolean;
  code: string | null;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "2026-10-14" as "14 October 2026". */
function fullDay(day: string): string {
  const month = MONTHS[Number(day.slice(5, 7)) - 1] ?? "";
  return `${String(Number(day.slice(8, 10)))} ${month} ${day.slice(0, 4)}`;
}

/** "10% off" or "₹500.00 off". */
function amountOff(d: ReferralGiftTerms): string {
  if (d.kind === "percent") return `${bpToPercentText(d.percentBp ?? 0)}% off`;
  return `${formatMinor(d.amountMinor ?? 0, d.currency ?? "USD")} off`;
}

/** What it comes off, as the discount is set: "the first payment of a membership",
 *  "some products", "memberships and products". */
function offWhat(d: ReferralGiftTerms): string {
  const products = d.allProducts ? "products" : "some products";
  const memberships = d.allMembershipTypes ? "a membership" : "some memberships";
  if (d.forMemberships && d.forProducts) return `${d.allMembershipTypes ? "memberships" : "some memberships"} and ${products}`;
  if (d.forProducts) return products;
  return d.membershipPayments === "first" ? `the first payment of ${memberships}` : `every payment of ${memberships}`;
}

/** A gift in one phrase: "10% off the first payment of a membership, until 31 December 2026". */
export function referralGiftWords(d: ReferralGiftTerms): string {
  const until = d.endsOn === null ? "" : `, until ${fullDay(d.endsOn)}`;
  return `${amountOff(d)} ${offWhat(d)}${until}`;
}

/** Whether a gift can be promised today: its code is there and can be used today. A code
 *  that starts later, has ended, is used up or archived promises nothing. */
export function referralGiftLive(d: ReferralGiftTerms, today: string): boolean {
  return d.code !== null && discountStatus(d, today) === "active";
}

/** Why a picked gift is not promised, in the owner's words; null when it is. */
export function referralGiftProblem(d: ReferralGiftTerms, today: string): string | null {
  if (d.code === null) return "It has no promo code.";
  const status = discountStatus(d, today);
  if (status === "archived") return "It was archived.";
  if (status === "expired") return `It ended on ${fullDay(d.endsOn ?? today)}.`;
  if (status === "used_up") return "It has been used as many times as it allows.";
  if (status === "scheduled") return `It starts on ${fullDay(d.startsOn ?? today)}.`;
  return null;
}

export const referralGiftSchema = z
  .object({
    /** The promo code the person uses. */
    code: z.string(),
    /** "10% off the first payment of a membership". */
    words: z.string(),
  })
  .strict();
export type ReferralGift = z.infer<typeof referralGiftSchema>;

// ── WHAT A MEMBER READS (the phone app's Invite a friend, Stage 5 item 20) ──

/** The member's gift, off their next payment (20e-ii-b gives it): "10% off your next
 *  payment", "₹500.00 off your next payment". */
export function referralMemberGiftWords(g: { kind: DiscountKind; percentBp: number | null; amountMinor: number | null; currency: string | null }): string {
  const off = g.kind === "percent" ? `${bpToPercentText(g.percentBp ?? 0)}% off` : `${formatMinor(g.amountMinor ?? 0, g.currency ?? "USD")} off`;
  return `${off} your next payment`;
}

/** The offer in the member's words. No code: the member's gift comes off their next payment
 *  by itself. `firstName`: the name their link shows; null in the owner's preview. */
export function referralOfferLines(gymName: string, memberGift: string | null, friendGift: string | null, firstName: string | null = null): string[] {
  const gym = gymName.trim();
  const lines: string[] = [];
  if (memberGift !== null) {
    lines.push(`When a friend you invite joins ${gym} and makes their first payment, you get ${memberGift}. It comes off by itself, and we'll tell you in your inbox.`);
  }
  if (friendGift !== null) lines.push(`Your friend gets ${friendGift} when they join.`);
  if (memberGift === null && friendGift === null) lines.push(`Send your link to a friend who'd like to join ${gym}.`);
  lines.push(firstName === null ? "Your link shows your first name to whoever opens it." : `Your link shows your first name, ${firstName}, to whoever opens it.`);
  lines.push(`This offer is set by ${gym} and may change.`);
  return lines;
}

export const memberReferralResponseSchema = z.discriminatedUnion("status", [
  /** The business has not switched it on. */
  z.object({ status: z.literal("off"), gymName: z.string() }).strict(),
  z
    .object({
      status: z.literal("on"),
      gymName: z.string(),
      /** The member's own link, on the app's site: `/invite/<code>`. */
      path: z.string(),
      /** Null where the business gives none, or its code cannot be used today. */
      memberGift: z.string().nullable(),
      friendGift: z.string().nullable(),
      /** The offer as the member reads it, last line saying who set it. */
      lines: z.array(z.string()).min(1),
    })
    .strict(),
]);
export type MemberReferralResponse = z.infer<typeof memberReferralResponseSchema>;

// ── WHAT THE FRIEND READS: the invite page, which every business has ──

/** What anybody with the link sees: the business, its gift, and the first name of the
 *  member who sent it (Kd, 2026-10-15), nothing more of them. */
export const publicInviteSchema = z
  .object({
    gymName: z.string(),
    /** "Maya": the member's first name only; null where none can be said. */
    inviterFirstName: z.string().nullable(),
    city: z.string().nullable(),
    orgType: orgTypeSchema,
    /** Null where the business gives none, or its code cannot be used today. */
    friendGift: referralGiftSchema.nullable(),
    /** The business's own page, where it has one switched on; null otherwise. */
    pageSlug: z.string().nullable(),
    robotCheckKey: z.string().min(1),
  })
  .strict();
export type PublicInvite = z.infer<typeof publicInviteSchema>;
export const publicInviteResponseSchema = z.object({ invite: publicInviteSchema }).strict();

/** The invite page's form: the business page's form without "where did you hear of us",
 *  which a friend's link already answers. */
export const inviteEnquiryRequestSchema = z
  .object({
    fullName: z.string().max(MEMBER_LIST_MAX_NAME_CHARS),
    /** Required here (Kd, 2026-10-15): the friend's welcome offer and the business's
     *  follow-ups reach them by email. */
    email: z.string().trim().min(1).max(MEMBER_LIST_MAX_EMAIL_CHARS),
    phone: z.string().max(MEMBER_LIST_MAX_TYPED_PHONE_CHARS).optional(),
    message: z.string().max(GYM_ENQUIRY_MAX_MESSAGE_CHARS).optional(),
    mayEmail: z.boolean().optional(),
    trap: z.string().max(200).optional(),
    robotToken: z.string().min(1).max(ROBOT_CHECK_TOKEN_MAX_CHARS),
  })
  .strict();
export type InviteEnquiryRequest = z.infer<typeof inviteEnquiryRequestSchema>;

/** The friend's words on the invite page. */
export function inviteLines(gymName: string, friendGift: ReferralGift | null, inviterFirstName: string | null = null): string[] {
  const gym = gymName.trim();
  const lines = [inviterFirstName === null ? `A member of ${gym} has invited you.` : `${inviterFirstName} invited you to join ${gym}.`];
  if (friendGift !== null) lines.push(`Your welcome offer: ${friendGift.words}. Use code ${friendGift.code} when you join.`);
  lines.push(`Leave your details and ${gym} will be in touch.`);
  if (friendGift !== null) lines.push(`This offer is set by ${gym} and may change.`);
  return lines;
}

// ── WHAT THE BUSINESS SETS (Settings → Refer a friend) ──
//
// The owner sets each gift in the box itself: a percentage or an amount, and what it comes
// off. The app makes the promo code for it, kept under Discounts like any other, so the
// front desk takes it as it takes any code.

/** What the friend's gift comes off: the first payment of a new membership, every payment
 *  of one, or products sold at the desk. */
export const REFERRAL_GIFT_ON = ["first", "every", "products"] as const;
export type ReferralGiftOn = (typeof REFERRAL_GIFT_ON)[number];

const giftAmountFields = {
  kind: z.enum(DISCOUNT_KINDS),
  /** Hundredths of a percent: 1000 is 10%. */
  percentBp: z.number().int().min(1).max(DISCOUNT_PERCENT_BP_MAX).nullable(),
  /** In the business's own money, in minor units. */
  amountMinor: z.number().int().min(1).max(MEMBERSHIP_PRICE_MINOR_MAX).nullable(),
};
const oneAmount = (g: { kind: DiscountKind; percentBp: number | null; amountMinor: number | null }): boolean =>
  g.kind === "percent" ? g.percentBp !== null && g.amountMinor === null : g.amountMinor !== null && g.percentBp === null;

/** The member's gift: a percentage or an amount off their next payment. */
export const referralMemberGiftInputSchema = z.object(giftAmountFields).strict().refine(oneAmount, { message: "invalid_gift" });
export type ReferralMemberGiftInput = z.infer<typeof referralMemberGiftInputSchema>;

/** The friend's gift: a percentage or an amount, and what it comes off. */
export const referralGiftInputSchema = z
  .object({ ...giftAmountFields, on: z.enum(REFERRAL_GIFT_ON) })
  .strict()
  .refine(oneAmount, { message: "invalid_gift" });
export type ReferralGiftInput = z.infer<typeof referralGiftInputSchema>;

/** The member's gift as it is kept. */
export const referralMemberGiftViewSchema = z
  .object({
    kind: z.enum(DISCOUNT_KINDS),
    percentBp: z.number().int().nullable(),
    amountMinor: z.number().int().nullable(),
    currency: z.string().nullable(),
    words: z.string(),
  })
  .strict();
export type ReferralMemberGiftView = z.infer<typeof referralMemberGiftViewSchema>;

/** The friend's gift as it is kept: its own discount and promo code. */
export const referralGiftViewSchema = z
  .object({
    kind: z.enum(DISCOUNT_KINDS),
    percentBp: z.number().int().nullable(),
    amountMinor: z.number().int().nullable(),
    currency: z.string().nullable(),
    on: z.enum(REFERRAL_GIFT_ON),
    /** The promo code the app made for it. */
    code: z.string().nullable(),
    words: z.string(),
    /** Why it is not promised today (its code was archived or used up under Discounts, or
     *  has ended); null when it is. */
    problem: z.string().nullable(),
    /** Archived under Discounts: saving the box again makes it a new code. */
    archived: z.boolean(),
  })
  .strict();
export type ReferralGiftView = z.infer<typeof referralGiftViewSchema>;

export const referralSettingsSchema = z
  .object({
    on: z.boolean(),
    member: referralMemberGiftViewSchema.nullable(),
    friend: referralGiftViewSchema.nullable(),
    /** The business's money for an amount off; null until its country is set, when only a
     *  percentage can be given. */
    currency: z.string().nullable(),
    /** The offer exactly as a member reads it, today. */
    memberLines: z.array(z.string()),
  })
  .strict();
export type ReferralSettings = z.infer<typeof referralSettingsSchema>;
export const referralSettingsResponseSchema = z.object({ settings: referralSettingsSchema }).strict();

export const setReferralSettingsRequestSchema = z
  .object({
    on: z.boolean(),
    member: referralMemberGiftInputSchema.nullable(),
    friend: referralGiftInputSchema.nullable(),
  })
  .strict()
  .refine((v) => !v.on || v.member !== null || v.friend !== null, { message: "no_gift", path: ["on"] });
export type SetReferralSettingsRequest = z.infer<typeof setReferralSettingsRequestSchema>;

/** A gift as typed, in the words a member or friend will read, before it is saved. */
export function referralGiftInputWords(g: ReferralGiftInput, currency: string | null): string {
  return referralGiftWords({
    kind: g.kind,
    percentBp: g.percentBp,
    amountMinor: g.amountMinor,
    currency,
    forProducts: g.on === "products",
    allProducts: true,
    forMemberships: g.on !== "products",
    allMembershipTypes: true,
    membershipPayments: g.on === "products" ? null : g.on,
    startsOn: null,
    endsOn: null,
    maxUses: null,
    uses: 0,
    archived: false,
    code: null,
  });
}

export const REFERRAL_WORDS = {
  not_found: "This invite link isn't working. Ask the person who sent it for a new one.",
  no_gift: "Choose at least one gift before switching Refer a friend on.",
  no_currency: "Set your country in Settings before giving an amount off. A percentage works now.",
  too_many: "You have 100 discounts in use, the most there can be. Archive one under Discounts, then save again.",
} as const;
