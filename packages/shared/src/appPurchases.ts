// BUY IN THE APP — ROADMAP Stage 2 item 18k-iii-a (Kd, 2026-11-07; spec Part 3 §14.8). A member buys a line the gym sells
// in the app, a pack or a membership paid once, for their own record, on Square's own payment page, as a bill is paid
// (18k-ii-a). They read its details and, where the gym asks for one, its agreement, and sign it as they press Buy.
// NOTHING IS GIVEN UNTIL SQUARE SAYS IT IS PAID, for exactly what the list showed: then, in one step, the membership is
// given as Add membership gives it, its first bill paid in the app, and the agreement signed with what they read. While
// the page is open, staff cannot change that line of the price list. The phone draws it (Stage 5 item 20).
import { z } from "zod";
import { appPaymentStateSchema } from "./appPayments.js";
import { appPurchaseGivenSchema } from "./forSale.js";
import { agreementFactsSchema, factsKeySchema } from "./membershipAgreement.js";
import { deskSignerSchema, signedNameSchema } from "./waiver.js";
import type { AppPurchaseCheck } from "./appPurchaseStaff.js";

const minorSchema = z.number().int().min(1).max(99_999_999);

/** Buy: the line, what the list showed for it (its first payment and the key of its details), and, where the gym asks
 *  for its agreement, the wording read and who signed it. The same key sent again is the same press. */
export const appPurchaseRequestSchema = z
  .object({
    requestKey: z.uuid(),
    typeId: z.uuid(),
    amountMinor: minorSchema,
    factsKey: factsKeySchema,
    agreement: z.object({ agreementId: z.uuid(), signer: deskSignerSchema, name: signedNameSchema }).strict().nullable(),
  })
  .strict();
export type AppPurchaseRequest = z.infer<typeof appPurchaseRequestSchema>;

/** A purchase as the phone follows it: `open` while Square's page can be paid; `paid` once the membership is theirs
 *  (`membershipId`), with its receipt; `closed` with nothing paid; `check` where Square may have taken money and nothing
 *  was given, so the front desk checks it. */
export const appPurchaseSchema = z
  .object({
    id: z.uuid(),
    typeId: z.uuid(),
    name: z.string().min(1),
    amountMinor: minorSchema,
    currency: z.string().regex(/^[A-Z]{3}$/),
    state: appPaymentStateSchema,
    url: z.url().nullable(),
    closesAt: z.iso.datetime().nullable(),
    membershipId: z.uuid().nullable(),
    receiptNumber: z.number().int().min(1).max(2_147_483_647).nullable(),
  })
  .strict();
export type AppPurchase = z.infer<typeof appPurchaseSchema>;

export const appPurchaseResponseSchema = z.object({ purchase: appPurchaseSchema }).strict();
export type AppPurchaseResponse = z.infer<typeof appPurchaseResponseSchema>;

/** The signature as the member gave it on Buy, kept with the page until the membership is given: the wording read, who
 *  signed, the name typed, the details they read and when. */
export const appPurchaseSignSchema = z
  .object({ agreementId: z.uuid(), signer: deskSignerSchema, name: signedNameSchema, facts: agreementFactsSchema, at: z.iso.datetime() })
  .strict();
export type AppPurchaseSign = z.infer<typeof appPurchaseSignSchema>;

/** Who bought it, for a member not on the gym's list yet (18k-iii-b): their name, proved email and the phone they gave,
 *  kept with the page until it ends, so they are put on the list as they were when they pressed Buy. */
export const appPurchaseBuyerSchema = z
  .object({ name: z.string().min(1).max(200), email: z.email().max(320), phone: z.string().max(40).nullable() })
  .strict();
export type AppPurchaseBuyer = z.infer<typeof appPurchaseBuyerSchema>;

/** What a purchase page keeps of the line bought: what buying it gives (`appPurchaseGivenSchema`), the signature, and who
 *  bought it where they were not on the list. */
export const appPurchaseBoughtSchema = appPurchaseGivenSchema
  .extend({ sign: appPurchaseSignSchema.nullable(), buyer: appPurchaseBuyerSchema.nullable().default(null) })
  .strict();
export type AppPurchaseBought = z.infer<typeof appPurchaseBoughtSchema>;

export const appPurchaseCheckedResponseSchema = z.object({ ok: z.literal(true) }).strict();

/** The server's answers to Buy, as the member reads them on the phone. */
export const APP_PURCHASE_WORDS = {
  not_own: "To buy in the app, ask the front desk to add you to their member list first.",
  /** A record two app accounts hold is nobody's in the app (17e-ii): neither buys on it. */
  shared: "Two app accounts share your record here, so buy this at the front desk.",
  paid_by_other: "Someone else pays for your memberships here, so buy this at the front desk.",
  changed: "What you're buying has changed. Go back and look again.",
  agreement_changed: (gym: string): string => `${gym} has changed its agreement. Go back and read it again.`,
  guardian_needed: "As you're under 18, a parent or guardian signs this for you.",
  person_signs: "You sign this yourself.",
  already_held: (name: string): string => `You already have ${name}.`,
  too_many: "You have as many memberships here as the app allows. Ask the front desk.",
  other_open: "A payment page is already open. Finish that payment or close it first.",
  check_first: "We couldn't confirm your last payment for this. Ask the front desk to check it with Square before you buy it again.",
  /** A line whose last day ends within minutes on the gym's clock: a page now could be paid once it is over. */
  too_late: "It's too late today to buy this. Try again tomorrow.",
  /** `check`, said on the phone where a purchase ended that way. */
  check: "We couldn't confirm your payment, so nothing was added yet. The front desk will check it with Square.",
} as const;

/** What staff read about purchases. */
export const APP_PURCHASE_STAFF_WORDS = {
  /** Saving or archiving a line of the price list while a member is buying it. */
  type_buying: "A member is buying this in the app right now. Save again once their payment page closes.",
  /** Delete permanently while a purchase that may have taken money waits for a check. */
  delete_check: "A payment this person made in the app needs checking. Check it in Square and mark it as checked on their page first.",
  /** Joining two records while both have a purchase page open. */
  merge_buying: "Both records are buying in the app right now. Merge them once their payment pages close.",
  none: "No payment page is open for this person now.",
  /** Mark as checked on a purchase already marked, or not one that needs it. */
  not_checking: "There's nothing to check for this payment now.",
  checked: "Marked as checked.",
} as const;

/** The line on the person's page while they buy: "Tara Test is buying 10-class pack in the app. The payment page closes
 *  at 10:42 if it isn't paid." `at`: the time, in the gym's words. */
export const appBuyingLine = (payerName: string | null, typeName: string, at: string): string =>
  `${payerName ?? "The member"} is buying ${typeName} in the app. The payment page closes at ${at} if it isn't paid.`;

/** The line on the person's page for a purchase that gave nothing though Square may have taken money. `money`: what
 *  Square took, or null where not known; `day`: when; both in the gym's words. */
export const appBuyCheckLine = (check: Pick<AppPurchaseCheck, "why" | "payerName" | "typeName">, money: string | null, day: string): string =>
  check.why === "taken"
    ? `Square took ${money ?? "a payment"} from ${check.payerName ?? "the member"} in the app on ${day} for ${check.typeName}, but it couldn't be given to them. Check it in Square, then refund it there or give it with Add membership.`
    : `${check.payerName ?? "The member"}'s payment page for ${check.typeName} in the app ended on ${day} without an answer from Square, so it may have been paid. Check it in Square, then refund it there or give it with Add membership.`;
