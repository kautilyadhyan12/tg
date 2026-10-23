// THE SAVED CARD CHARGED (ROADMAP 18d-iii-i; spec Part 3 §14.8; rulings/2026-10-21-money-plan.md).
//
// On the day a renewing membership's bill falls due, and on a freeze fee's day, the app charges the
// card on file of whoever pays for that person; staff can charge it themselves from Record payment
// (Card on file). A payment Square took is recorded on the bill as Card on file, with its receipt; a
// decline leaves the bill open and says so on it.
import { z } from "zod";

/** How a charge ended. `paid`: Square took it and it is on the bill; `declined`: the card's bank
 *  said no; `refused`: Square would not charge the card (it is gone from Square, or the gym's
 *  connection was refused); `not_recorded`: Square took the money but the bill could no longer take
 *  it (staff check it in Square); `gone`: Square never answered, or the gym left that Square account,
 *  so whether money was taken is to be checked in Square. */
export const cardChargeOutcomeSchema = z.enum(["paid", "declined", "refused", "not_recorded", "gone"]);
export type CardChargeOutcome = z.infer<typeof cardChargeOutcomeSchema>;

/** Why a card was declined, from Square's own code, as staff read it. */
export const CARD_DECLINE_REASONS = ["insufficient_funds", "expired", "call_bank", "closed", "declined"] as const;
export const cardDeclineReasonSchema = z.enum(CARD_DECLINE_REASONS);
export type CardDeclineReason = z.infer<typeof cardDeclineReasonSchema>;

/** Square's decline codes (its ErrorCode list, read 2026-10-23) by what staff are told. Anything
 *  else, GENERIC_DECLINE among them, is a decline with no reason given. */
const DECLINE_CODES: Readonly<Record<Exclude<CardDeclineReason, "declined">, readonly string[]>> = {
  insufficient_funds: ["INSUFFICIENT_FUNDS"],
  expired: ["CARD_EXPIRED", "EXPIRATION_FAILURE", "INVALID_EXPIRATION", "BAD_EXPIRATION"],
  call_bank: ["CARD_DECLINED_CALL_ISSUER", "CARD_DECLINED_VERIFICATION_REQUIRED", "VOICE_FAILURE", "CARDHOLDER_INSUFFICIENT_PERMISSIONS", "TRANSACTION_LIMIT"],
  closed: ["INVALID_ACCOUNT", "ACCOUNT_UNUSABLE"],
};

export function cardDeclineReasonOf(code: string): CardDeclineReason {
  for (const reason of ["insufficient_funds", "expired", "call_bank", "closed"] as const) {
    if (DECLINE_CODES[reason].includes(code)) return reason;
  }
  return "declined";
}

/** The sentence after "Visa ending 1111 was declined on 23 Oct." */
export const CARD_DECLINE_WORDS: Readonly<Record<CardDeclineReason, string>> = {
  insufficient_funds: "There wasn't enough money on the card.",
  expired: "The card has expired.",
  call_bank: "The bank asks the cardholder to contact them.",
  closed: "The card's account is closed.",
  declined: "The bank gave no reason.",
};

/** A receipt number, as `memberBills.ts` has it (which reads this file, so it is not read from there). */
const receiptNumberSchema = z.number().int().min(1).max(2_147_483_647);

/** The card a charge was made to, as a screen shows it. */
export const cardSeenSchema = z.object({ brand: z.string().regex(/^[A-Z_]{1,40}$/), last4: z.string().regex(/^[0-9]{4}$/) }).strict();

/** A bill's newest charge to a card on file, where it was declined and the bill is still owed. */
export const cardDeclinedSchema = cardSeenSchema
  .extend({
    /** The gym's own day it was declined on. */
    on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: cardDeclineReasonSchema,
  })
  .strict();
export type CardDeclined = z.infer<typeof cardDeclinedSchema>;

/** The card on file Record payment can charge for this person: theirs, or the payer's (18i). */
export const cardOnFileSchema = cardSeenSchema
  .extend({
    /** Past its expiry month, on the gym's day: Square may still have a newer date. */
    expired: z.boolean(),
    /** The record that pays for them, by name; null for their own card. */
    payerName: z.string().nullable(),
    /** Sent back with Charge card on file: a card replaced, or a payer changed, since is refused. */
    ref: z.string().min(1).max(200),
  })
  .strict();
export type CardOnFile = z.infer<typeof cardOnFileSchema>;

export const cardChargeSchema = z
  .object({
    id: z.string().uuid(),
    membershipId: z.string().uuid(),
    /** The fee it charged; null for a period of the membership. */
    feeBillId: z.string().uuid().nullable(),
    amountMinor: z.number().int().min(1).max(99_999_999),
    currency: z.string().regex(/^[A-Z]{3}$/),
    card: cardSeenSchema,
    /** `charging`: Square has not answered yet; `done`: see `outcome`. */
    step: z.enum(["charging", "done"]),
    outcome: cardChargeOutcomeSchema.nullable(),
    /** Why it was declined, for `declined`. */
    reason: cardDeclineReasonSchema.nullable(),
    /** The payment's receipt, once it is on the bill. */
    receiptNumber: receiptNumberSchema.nullable(),
  })
  .strict();
export type CardCharge = z.infer<typeof cardChargeSchema>;

/** Charge card on file for a period: the period the screen showed and the amount. `requestKey`: the
 *  same press sent twice is one charge. */
export const cardChargeRequestSchema = z
  .object({
    requestKey: z.string().uuid(),
    periodIndex: z.number().int().min(0).max(100_000),
    amountMinor: z.number().int().min(1).max(99_999_999),
    /** The card the screen showed (`cardOnFile.ref`). */
    cardRef: z.string().min(1).max(200),
  })
  .strict();
export type CardChargeRequest = z.infer<typeof cardChargeRequestSchema>;

/** Charge card on file for a fee: all of it, the amount the screen showed. */
export const cardFeeChargeRequestSchema = z
  .object({
    requestKey: z.string().uuid(),
    amountMinor: z.number().int().min(1).max(99_999_999),
    cardRef: z.string().min(1).max(200),
  })
  .strict();
export type CardFeeChargeRequest = z.infer<typeof cardFeeChargeRequestSchema>;

export const cardChargeResponseSchema = z.object({ charge: cardChargeSchema }).strict();
export type CardChargeResponse = z.infer<typeof cardChargeResponseSchema>;

/** The server's refusals, as staff read them. */
export const CARD_CHARGE_WORDS = {
  charging: "The card on file is being charged for this membership. Wait a minute for Square's answer, then try again.",
  no_card: "There's no card on file to charge. Save a card first, or record the payment another way.",
  card_changed: "The card on file has changed since you opened this. Nothing was charged: check it and try again.",
  currency: "This membership is priced in another currency from your Square account, so the card on file can't be charged for it.",
  charge_gone: "This charge is no longer here.",
  disconnect_charging: "A card on file is being charged. Wait a minute for Square's answer, then disconnect.",
  void_card: "This was charged to the card on file. To give the money back, refund it in your Square Dashboard, then note the refund here.",
} as const;
