// DISCOUNTS AND PROMO CODES — Part 3 §14.3; ROADMAP Stage 2 items 18b-ii-a and 18b-ii-b.
//
// A gym's own discounts: a percentage or a fixed amount off, optionally between two days,
// optionally a limited number of times, on every product or the ones it picks, on every
// membership type or the ones it picks, or on both. A discount
// with a promo code is the one a customer asks for by that code. The server works out
// what comes off (`discountOff`) and whether a discount can be used (`discountFits`); the
// screen uses the same two, and a sale that no longer comes to the total it showed is
// refused.
import { z } from "zod";
import { MEMBERSHIP_PRICE_MINOR_MAX } from "./memberships.js";
import { VISIBLE_TEXT } from "./visibleText.js";

export const DISCOUNT_NAME_MAX = 60;
/** How many discounts a gym can have in use at once. */
export const DISCOUNTS_MAX = 100;
export const DISCOUNT_ARCHIVED_PAGE = 50;
/** How many products one discount can be limited to. */
export const DISCOUNT_PRODUCTS_MAX = 200;
/** How many membership types one discount can be limited to: a gym has at most 60. */
export const DISCOUNT_MEMBERSHIP_TYPES_MAX = 60;
export const DISCOUNT_USES_MAX = 100_000;
/** A percentage in hundredths of a percent: 1250 is 12.5%. Under 100%: a sale has to
 *  leave something to pay. */
export const DISCOUNT_PERCENT_BP_MAX = 9_999;
export const PROMO_CODE_MIN = 3;
export const PROMO_CODE_MAX = 20;

const PROMO_CODE = /^[A-Z0-9]{3,20}$/;

/** A typed code as it is kept: capitals and digits, no spaces. Null where it is not one. */
export function promoCodeFrom(text: string): string | null {
  const code = text.trim().toUpperCase();
  return PROMO_CODE.test(code) ? code : null;
}

/** A typed percentage as hundredths of a percent, or null where it is not plainly one
 *  above 0 and under 100, with at most two decimals. */
export function percentToBp(text: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (match === null) return null;
  const bp = Number(match[1] ?? "0") * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
  return bp >= 1 && bp <= DISCOUNT_PERCENT_BP_MAX ? bp : null;
}

/** 1250 → "12.5", 2000 → "20": the inverse of `percentToBp`. */
export function bpToPercentText(bp: number): string {
  const whole = Math.trunc(bp / 100);
  const rest = bp % 100;
  if (rest === 0) return String(whole);
  return `${String(whole)}.${String(rest).padStart(2, "0").replace(/0$/, "")}`;
}

export const DISCOUNT_KINDS = ["percent", "amount"] as const;
export type DiscountKind = (typeof DISCOUNT_KINDS)[number];

/** How often a discount comes off a repeating membership: its first payment only, or every
 *  payment. Any other kind of membership is paid once, so it comes off that payment. */
export const MEMBERSHIP_PAYMENTS = ["first", "every"] as const;
export type MembershipPayments = (typeof MEMBERSHIP_PAYMENTS)[number];

/** WHAT COMES OFF. `listedMinor` is the price before the discount: the product's price
 *  times how many. A percentage is rounded to the nearest minor unit (a half goes up); a
 *  fixed amount comes off once a sale, and never more than the price. */
export function discountOff(discount: { kind: DiscountKind; percentBp: number | null; amountMinor: number | null }, listedMinor: number): number {
  if (!Number.isSafeInteger(listedMinor) || listedMinor < 1) return 0;
  if (discount.kind === "percent") {
    const bp = discount.percentBp;
    if (bp === null || !Number.isSafeInteger(bp) || bp < 1 || bp > DISCOUNT_PERCENT_BP_MAX) return 0;
    return Math.min(listedMinor, Math.floor((listedMinor * bp + 5_000) / 10_000));
  }
  const amount = discount.amountMinor;
  if (amount === null || !Number.isSafeInteger(amount) || amount < 1) return 0;
  return Math.min(listedMinor, amount);
}

/** What the rules below read of a discount. */
export interface DiscountTerms {
  /** First and last day it can be used, in the gym's own days; null for no limit. */
  startsOn: string | null;
  endsOn: string | null;
  maxUses: number | null;
  uses: number;
  archived: boolean;
}

export type DiscountStatus = "active" | "scheduled" | "expired" | "used_up" | "archived";

/** What a discount is on a given day of the gym's. Days are `YYYY-MM-DD`, so they compare
 *  as text. */
export function discountStatus(d: DiscountTerms, today: string): DiscountStatus {
  if (d.archived) return "archived";
  if (d.endsOn !== null && today > d.endsOn) return "expired";
  if (d.maxUses !== null && d.uses >= d.maxUses) return "used_up";
  if (d.startsOn !== null && today < d.startsOn) return "scheduled";
  return "active";
}

export type DiscountRefusal = "archived" | "not_started" | "expired" | "used_up" | "not_for_product" | "not_for_membership" | "other_currency";

/** What a discount is for, as the rule below reads it. */
export interface DiscountReach {
  forProducts: boolean;
  allProducts: boolean;
  productIds: readonly string[];
  forMemberships: boolean;
  allMembershipTypes: boolean;
  membershipTypeIds: readonly string[];
}

/** WHETHER A DISCOUNT CAN BE USED on this product, or this membership type, today. Only an
 *  active discount is used; one for products is used on products alone and one for
 *  memberships on memberships alone, each on the ones it is limited to; a fixed amount is
 *  in one money and comes off a price in that money alone. */
export function discountFits(
  d: DiscountTerms & DiscountReach & { kind: DiscountKind; currency: string | null },
  sale: { today: string; currency: string } & ({ productId: string } | { membershipTypeId: string }),
): { ok: true } | { ok: false; reason: DiscountRefusal } {
  const status = discountStatus(d, sale.today);
  if (status === "archived") return { ok: false, reason: "archived" };
  if (status === "expired") return { ok: false, reason: "expired" };
  if (status === "used_up") return { ok: false, reason: "used_up" };
  if (status === "scheduled") return { ok: false, reason: "not_started" };
  if ("productId" in sale) {
    if (!d.forProducts || (!d.allProducts && !d.productIds.includes(sale.productId))) return { ok: false, reason: "not_for_product" };
  } else if (!d.forMemberships || (!d.allMembershipTypes && !d.membershipTypeIds.includes(sale.membershipTypeId))) {
    return { ok: false, reason: "not_for_membership" };
  }
  if (d.kind === "amount" && d.currency !== sale.currency) return { ok: false, reason: "other_currency" };
  return { ok: true };
}

/** WHAT A MEMBERSHIP GIVEN WITH A DISCOUNT COSTS. `offMinor` comes off each discounted
 *  payment, and `payments` says which those are: the first only, or every one (a
 *  membership that does not repeat is paid once, so it is every). `heldPriceMinor` is the
 *  price kept on the membership, which every later bill is opened at; `firstBillMinor` is
 *  the bill opened when it is given. Refused where it takes nothing off, or the whole price. */
export function membershipDiscount(
  d: { kind: DiscountKind; percentBp: number | null; amountMinor: number | null; membershipPayments: MembershipPayments | null },
  type: { kind: "recurring" | "one_time" | "pack" | "trial"; priceMinor: number },
):
  | { ok: true; offMinor: number; payments: MembershipPayments; heldPriceMinor: number; firstBillMinor: number }
  | { ok: false; reason: "nothing_off" | "nothing_to_pay" } {
  const offMinor = discountOff(d, type.priceMinor);
  if (offMinor === 0) return { ok: false, reason: "nothing_off" };
  if (offMinor >= type.priceMinor) return { ok: false, reason: "nothing_to_pay" };
  const payments: MembershipPayments = type.kind === "recurring" && d.membershipPayments === "first" ? "first" : "every";
  const firstBillMinor = type.priceMinor - offMinor;
  return { ok: true, offMinor, payments, heldPriceMinor: payments === "every" ? firstBillMinor : type.priceMinor, firstBillMinor };
}

/** What was being done when a discount was refused: a product sold, or a membership given. */
export type DiscountUse = "sale" | "membership";

const nothingDone = (use: DiscountUse): string =>
  use === "sale" ? "Nothing was sold: pick another discount, or sell without one." : "Nothing was saved: pick another discount, or add the membership without one.";

/** Said where a discount rounds to nothing on a price: nothing is made with it, so no use
 *  is spent on nothing. */
export function discountNothingOffWords(name: string, use: DiscountUse = "sale"): string {
  return `${name} takes nothing off this price. ${nothingDone(use)}`;
}

/** Why a discount was not used, said to staff. */
export function discountRefusalWords(name: string, reason: DiscountRefusal, use: DiscountUse = "sale"): string {
  switch (reason) {
    case "archived":
      return `${name} is no longer offered. ${nothingDone(use)}`;
    case "not_started":
      return `${name} has not started yet. ${nothingDone(use)}`;
    case "expired":
      return `${name} has expired. ${nothingDone(use)}`;
    case "used_up":
      return `${name} has reached its usage limit. ${nothingDone(use)}`;
    case "not_for_product":
      return `${name} does not apply to this product. ${nothingDone(use)}`;
    case "not_for_membership":
      return `${name} does not apply to this membership. ${nothingDone(use)}`;
    case "other_currency":
      return `${name} is a fixed amount in another currency. ${use === "sale" ? "Nothing was sold" : "Nothing was saved"}: open ${name} under Discounts and save its amount again.`;
    default: {
      const never: never = reason;
      throw new Error(`unhandled discount refusal: ${String(never)}`);
    }
  }
}

// ── The wire ────────────────────────────────────────────────────────────────

/** A day that exists: "2026-02-31" has the shape of one and is not. */
export function isRealDay(text: string): boolean {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (parts === null) return false;
  const made = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])));
  return !Number.isNaN(made.getTime()) && made.toISOString().slice(0, 10) === text;
}
const daySchema = z.string().refine(isRealDay, "not_a_day");
const currencySchema = z.string().regex(/^[A-Z]{3}$/);
const percentBpSchema = z.number().int().min(1).max(DISCOUNT_PERCENT_BP_MAX);
const amountSchema = z.number().int().min(1).max(MEMBERSHIP_PRICE_MINOR_MAX);
const usesSchema = z.number().int().min(1).max(DISCOUNT_USES_MAX);
/** Trimmed, one line, nothing hidden: a discount's name is printed on a receipt (18g). */
const discountNameSchema = z.string().trim().min(1).max(DISCOUNT_NAME_MAX).regex(VISIBLE_TEXT);
const promoCodeSchema = z.string().regex(PROMO_CODE);

export const gymDiscountSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    /** The promo code a customer asks for it by; null where staff pick it by name. */
    code: z.string().nullable(),
    kind: z.enum(DISCOUNT_KINDS),
    percentBp: percentBpSchema.nullable(),
    amountMinor: amountSchema.nullable(),
    /** The money a fixed amount is in; null for a percentage. */
    currency: currencySchema.nullable(),
    startsOn: daySchema.nullable(),
    endsOn: daySchema.nullable(),
    maxUses: usesSchema.nullable(),
    /** Sales that used it and still stand. */
    uses: z.number().int().min(0),
    /** For products: every one, or the ones in `productIds`. */
    forProducts: z.boolean(),
    allProducts: z.boolean(),
    /** The products it is limited to, where not `allProducts`. */
    productIds: z.array(z.string().uuid()),
    /** For memberships: every type, or the ones in `membershipTypeIds`. */
    forMemberships: z.boolean(),
    allMembershipTypes: z.boolean(),
    membershipTypeIds: z.array(z.string().uuid()),
    /** How often it comes off a repeating membership; null where it is not for memberships. */
    membershipPayments: z.enum(MEMBERSHIP_PAYMENTS).nullable(),
    /** Refer a friend's own friend's gift (20e-ii-b-i): offered only to the friend it is for. */
    referralGift: z.boolean().default(false),
    archivedAt: z.string().datetime().nullable(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type GymDiscount = z.infer<typeof gymDiscountSchema>;

/** A percentage carries `percentBp` alone and a fixed amount `amountMinor` alone; a
 *  discount ends on or after the day it starts; it is for products, memberships or both;
 *  one limited to some products, or some types, names them; one for memberships says how
 *  often it comes off a repeating one. */
function checkDiscountShape(
  v: {
    kind: DiscountKind;
    percentBp: number | null;
    amountMinor: number | null;
    startsOn: string | null;
    endsOn: string | null;
    forProducts: boolean;
    allProducts: boolean;
    productIds: string[];
    forMemberships: boolean;
    allMembershipTypes: boolean;
    membershipTypeIds: string[];
    membershipPayments: MembershipPayments | null;
  },
  ctx: z.RefinementCtx,
): void {
  if (!v.forProducts && !v.forMemberships) ctx.addIssue({ code: "custom", path: ["forProducts"], message: "applies_to_nothing" });
  if (!v.forProducts && !v.allProducts) ctx.addIssue({ code: "custom", path: ["allProducts"], message: "invalid_products" });
  if (!v.forMemberships && !v.allMembershipTypes) ctx.addIssue({ code: "custom", path: ["allMembershipTypes"], message: "invalid_membership_types" });
  if (v.allMembershipTypes ? v.membershipTypeIds.length > 0 : v.membershipTypeIds.length === 0) {
    ctx.addIssue({ code: "custom", path: ["membershipTypeIds"], message: "invalid_membership_types" });
  }
  if (new Set(v.membershipTypeIds).size !== v.membershipTypeIds.length) ctx.addIssue({ code: "custom", path: ["membershipTypeIds"], message: "repeated_membership_type" });
  if (v.forMemberships !== (v.membershipPayments !== null)) ctx.addIssue({ code: "custom", path: ["membershipPayments"], message: "invalid_membership_payments" });
  if (v.kind === "percent" && (v.percentBp === null || v.amountMinor !== null)) ctx.addIssue({ code: "custom", path: ["percentBp"], message: "invalid_percent" });
  if (v.kind === "amount" && (v.amountMinor === null || v.percentBp !== null)) ctx.addIssue({ code: "custom", path: ["amountMinor"], message: "invalid_amount" });
  if (v.startsOn !== null && v.endsOn !== null && v.endsOn < v.startsOn) ctx.addIssue({ code: "custom", path: ["endsOn"], message: "ends_before_start" });
  if (v.allProducts ? v.productIds.length > 0 : v.productIds.length === 0) ctx.addIssue({ code: "custom", path: ["productIds"], message: "invalid_products" });
  if (new Set(v.productIds).size !== v.productIds.length) ctx.addIssue({ code: "custom", path: ["productIds"], message: "repeated_product" });
}

const saveGymDiscountFields = z
  .object({
    name: discountNameSchema,
    code: promoCodeSchema.nullable(),
    kind: z.enum(DISCOUNT_KINDS),
    percentBp: percentBpSchema.nullable(),
    amountMinor: amountSchema.nullable(),
    startsOn: daySchema.nullable(),
    endsOn: daySchema.nullable(),
    maxUses: usesSchema.nullable(),
    forProducts: z.boolean(),
    allProducts: z.boolean(),
    productIds: z.array(z.string().uuid()).max(DISCOUNT_PRODUCTS_MAX),
    forMemberships: z.boolean(),
    allMembershipTypes: z.boolean(),
    membershipTypeIds: z.array(z.string().uuid()).max(DISCOUNT_MEMBERSHIP_TYPES_MAX),
    membershipPayments: z.enum(MEMBERSHIP_PAYMENTS).nullable(),
  })
  .strict();

export const saveGymDiscountRequestSchema = saveGymDiscountFields.superRefine(checkDiscountShape);
export type SaveGymDiscountRequest = z.infer<typeof saveGymDiscountRequestSchema>;

/** `updatedAt` is the discount as the form read it: a change since then refuses the save.
 *  A sale that used it in between does not. */
export const updateGymDiscountRequestSchema = saveGymDiscountFields.extend({ updatedAt: z.string().datetime() }).strict().superRefine(checkDiscountShape);
export type UpdateGymDiscountRequest = z.infer<typeof updateGymDiscountRequestSchema>;

/** The server's sentences, one place for the routes and the screen's tests. */
export const DISCOUNT_WORDS = {
  not_found: "That discount was not found.",
  not_available: "That discount is no longer offered. Nothing was sold: pick another discount, or sell without one.",
  nothing_to_pay: "This discount takes off the whole price, so there is nothing to pay. Nothing was sold: sell it without this discount.",
  name_taken: "You already have a discount with this name. Pick another name.",
  code_taken: "Another discount already uses this promo code. Pick another code.",
  changed: "This discount was changed while you had it open. Nothing was saved: check it and try again.",
  product_not_found: "One of the products you picked is no longer for sale. Nothing was saved: check the products and try again.",
  membership_type_not_found: "One of the memberships you picked is no longer on your price list. Nothing was saved: check the memberships and try again.",
  membership_not_available: "That discount is no longer offered. Nothing was saved: pick another discount, or add the membership without one.",
  membership_nothing_to_pay: "This discount takes off the whole price, so there is nothing to pay. Nothing was saved: add the membership without this discount.",
  membership_discount_changed: "The discount on this membership has changed since you opened it. Nothing was saved: check the total and try again.",
  no_currency: "Set your country in Settings before adding a fixed-amount discount.",
  referral_gift: "This is the Refer a friend gift. Nothing was saved: it is changed in Refer a friend, where the offer is set.",
} as const;
