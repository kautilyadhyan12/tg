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
import { bpToPercentText, discountStatus, type DiscountKind, type MembershipPayments } from "./discounts.js";
import { MEMBER_LIST_MAX_EMAIL_CHARS, MEMBER_LIST_MAX_NAME_CHARS, MEMBER_LIST_MAX_TYPED_PHONE_CHARS } from "./memberList.js";
import { formatMinor } from "./memberships.js";
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
  return d.membershipPayments === "first" ? `the first payment of ${memberships}` : memberships;
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

/** The offer in the member's words. The member's own code is not in it: it is sent to
 *  their inbox once it is earned. */
export function referralOfferLines(gymName: string, memberGift: string | null, friendGift: string | null): string[] {
  const gym = gymName.trim();
  const lines: string[] = [];
  if (memberGift !== null) {
    lines.push(`When a friend you invite joins ${gym} and makes their first payment, you get ${memberGift}. We'll send your code to your inbox.`);
  }
  if (friendGift !== null) lines.push(`Your friend gets ${friendGift} when they join.`);
  if (memberGift === null && friendGift === null) lines.push(`Send your link to a friend who'd like to join ${gym}.`);
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

/** What anybody with the link sees. Nothing on it names the member who sent it. */
export const publicInviteSchema = z
  .object({
    gymName: z.string(),
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
    email: z.string().max(MEMBER_LIST_MAX_EMAIL_CHARS).optional(),
    phone: z.string().max(MEMBER_LIST_MAX_TYPED_PHONE_CHARS).optional(),
    message: z.string().max(GYM_ENQUIRY_MAX_MESSAGE_CHARS).optional(),
    mayEmail: z.boolean().optional(),
    trap: z.string().max(200).optional(),
    robotToken: z.string().min(1).max(ROBOT_CHECK_TOKEN_MAX_CHARS),
  })
  .strict();
export type InviteEnquiryRequest = z.infer<typeof inviteEnquiryRequestSchema>;

/** The friend's words on the invite page. */
export function inviteLines(gymName: string, friendGift: ReferralGift | null): string[] {
  const gym = gymName.trim();
  const lines = [`A member of ${gym} has invited you.`];
  if (friendGift !== null) lines.push(`Your welcome offer: ${friendGift.words}. Use code ${friendGift.code} when you join.`);
  lines.push(`Leave your details and ${gym} will be in touch.`);
  if (friendGift !== null) lines.push(`This offer is set by ${gym} and may change.`);
  return lines;
}

// ── WHAT THE BUSINESS SETS (Settings → Refer a friend) ──

/** One of the business's discounts as the picker shows it. */
export const referralDiscountOptionSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    code: z.string().nullable(),
    words: z.string(),
    /** Why it is not promised today; null when it can be. */
    problem: z.string().nullable(),
  })
  .strict();
export type ReferralDiscountOption = z.infer<typeof referralDiscountOptionSchema>;

export const referralSettingsSchema = z
  .object({
    on: z.boolean(),
    memberDiscountId: z.string().uuid().nullable(),
    friendDiscountId: z.string().uuid().nullable(),
    /** The business's discounts with a promo code that are not archived, plus a picked one
     *  that since was. */
    discounts: z.array(referralDiscountOptionSchema),
    /** The offer exactly as a member reads it, today. */
    memberLines: z.array(z.string()),
  })
  .strict();
export type ReferralSettings = z.infer<typeof referralSettingsSchema>;
export const referralSettingsResponseSchema = z.object({ settings: referralSettingsSchema }).strict();

export const setReferralSettingsRequestSchema = z
  .object({
    on: z.boolean(),
    memberDiscountId: z.string().uuid().nullable(),
    friendDiscountId: z.string().uuid().nullable(),
  })
  .strict()
  .refine((v) => !v.on || v.memberDiscountId !== null || v.friendDiscountId !== null, { message: "no_gift", path: ["on"] });
export type SetReferralSettingsRequest = z.infer<typeof setReferralSettingsRequestSchema>;

export const REFERRAL_WORDS = {
  not_found: "This invite link isn't working. Ask the person who sent it for a new one.",
  no_gift: "Pick at least one promo code before switching Refer a friend on.",
  discount_not_found: "That discount was not found. Nothing was saved: pick another.",
  no_code: "That discount has no promo code. Nothing was saved: give it a code under Discounts, or pick another.",
  not_live: "That promo code has ended, been used up or been archived. Nothing was saved: pick another.",
} as const;
