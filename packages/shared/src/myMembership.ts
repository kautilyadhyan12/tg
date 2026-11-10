// MY MEMBERSHIP — Part 3 §14.2; ROADMAP Stage 2 item 18j. The member's own view of what they
// hold at a gym and what they paid it, read by the phone app (Stage 5 item 16). Laid out as
// Kd asked (`rulings/2026-10-15-18m.md`): Membership (each membership, each payment with its
// receipt, a refund under the payment it gives back) and Purchases (what they bought at the
// desk, each with its receipt).
//
// Only the reader's own record: the one record of the gym that their app account alone holds
// (`soloHolders`, the rule the overdue messages follow). A record two accounts share is
// nobody's here, as it is nobody's there. Staff names, voided rows and what staff can do are
// the console's and are never sent.
import { z } from "zod";
import { memberFeeKindSchema, memberPaymentMethodSchema, receiptNumberSchema } from "./memberBills.js";
import { heldMembershipShownSchema } from "./heldMemberships.js";
import { membershipKindSchema } from "./memberships.js";
import { membershipTermSchema } from "./membershipAgreement.js";
import { myMembershipAgreementSchema } from "./myAgreementState.js";

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const minorSchema = z.number().int().min(0).max(99_999_999);
const currencySchema = z.string().regex(/^[A-Z]{3}$/);

/** A refund that stands, under the payment or sale it gives back for. */
export const myRefundSchema = z
  .object({ amountMinor: minorSchema, method: memberPaymentMethodSchema, refundedOn: daySchema, receiptNumber: receiptNumberSchema, pending: z.boolean().default(false) })
  .strict();
export type MyRefund = z.infer<typeof myRefundSchema>;

/** A payment that stands, newest first, and the days it paid for (null for a membership of
 *  one period). Its receipt names who paid it, where somebody else did (18i). */
export const myPaymentSchema = z
  .object({
    amountMinor: minorSchema,
    method: memberPaymentMethodSchema,
    paidOn: daySchema,
    covers: z.object({ from: daySchema, to: daySchema }).strict().nullable(),
    receiptNumber: receiptNumberSchema,
    refunds: z.array(myRefundSchema),
  })
  .strict();
export type MyPayment = z.infer<typeof myPaymentSchema>;

/** A late cancel or no-show fee (18h), a freeze fee (18z) or an early cancellation fee (18v-ii-b): owed, paid,
 *  refunded or waived. A fee taken off is not sent. */
export const myFeeSchema = z
  .object({
    /** The fee, for paying it in the app while it is due or overdue (18k-ii-b): all of `amountMinor`. */
    id: z.uuid(),
    fee: memberFeeKindSchema,
    forName: z.string().min(1),
    on: daySchema,
    amountMinor: minorSchema,
    dueOn: daySchema,
    state: z.enum(["due", "overdue", "paid", "refunded", "waived"]),
    /** What was given back of it (18d-iv-b-i). */
    refundedMinor: minorSchema.default(0),
    /** A refund of it is still with Square: it does not read Refunded until Square has finished. */
    refundPending: z.boolean().default(false),
    /** The receipt of the payment that paid it; null while it is owed or waived. */
    receiptNumber: receiptNumberSchema.nullable(),
    /** False once its class or session no longer counts it (marked Came, or the class not run). One still due then was being
     *  paid in the app as they were marked (18k-ii-b): it comes off once that payment page closes with nothing paid, or once
     *  the front desk has checked it with Square, and it is not paid in the app. */
    stillOwed: z.boolean().default(true),
  })
  .strict();
export type MyFee = z.infer<typeof myFeeSchema>;

export const myMembershipSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    kind: membershipKindSchema,
    /** Null where somebody else pays for it (`paidBy`): the price is theirs to read. */
    priceMinor: minorSchema.nullable(),
    currency: currencySchema,
    status: heldMembershipShownSchema,
    startsOn: daySchema,
    /** Its start day was worked back from the gym's own list (17a-iii): not the day they joined. */
    fromList: z.boolean(),
    endsOn: daySchema.nullable(),
    renewsOn: daySchema.nullable(),
    frozenOn: daySchema.nullable(),
    classesLeft: z.number().int().min(0).nullable(),
    packClasses: z.number().int().nullable(),
    /** What is owed now and since when; null where nothing is. `periodIndex` names that bill, for paying it in the app
     *  (18k-ii-a) once `dueOn` has come (a bill not due yet is paid ahead at the desk): all of `amountMinor` is what a payment
     *  there takes. */
    owed: z.object({ amountMinor: minorSchema, dueOn: daySchema, state: z.enum(["due", "overdue"]), periodIndex: z.number().int().min(0) }).strict().nullable(),
    payments: z.array(myPaymentSchema),
    /** Older periods' payments kept off this answer; the gym holds them. */
    olderPeriodsNotShown: z.number().int().min(0),
    fees: z.array(myFeeSchema),
    /** Its terms as its agreement says them (16d): the minimum term, early cancellation fee, notice to cancel and
     *  cooling-off period it has. Where somebody else pays for it, the fee and the cooling-off period are theirs to read. */
    terms: z.array(membershipTermSchema).max(4).default([]),
    /** Its agreement (20c): to sign in the app, signed, or to sign at the front desk; null where the business asks
     *  for none, on somebody the reader pays for, and from an api too old to send it. */
    agreement: myMembershipAgreementSchema.nullable().default(null),
  })
  .strict();
export type MyMembership = z.infer<typeof myMembershipSchema>;

/** One sale at the desk under its receipt number, every line of it. A sale staff voided is not sent. */
export const myPurchaseSchema = z
  .object({
    receiptNumber: receiptNumberSchema,
    soldOn: daySchema,
    method: memberPaymentMethodSchema,
    currency: currencySchema,
    totalMinor: z.number().int().min(0),
    lines: z.array(z.object({ name: z.string(), quantity: z.number().int().min(1), totalMinor: z.number().int().min(0) }).strict()).min(1),
    refunds: z.array(myRefundSchema),
  })
  .strict();
export type MyPurchase = z.infer<typeof myPurchaseSchema>;

/** Somebody the reader pays for (18i; Kd 2026-10-18): their memberships' money, and nothing
 *  else of theirs (never their visits, bookings or workouts). */
export const myPaysForSchema = z
  .object({ name: z.string(), memberships: z.array(myMembershipSchema), earlierNotShown: z.number().int().min(0) })
  .strict();
export type MyPaysFor = z.infer<typeof myPaysForSchema>;

/** `record`: "own" where the reader's account alone holds a record of the gym; "none" where
 *  staff have not linked them to one; "shared" where two accounts hold it. Only "own" carries
 *  money. */
export const myMembershipResponseSchema = z
  .object({
    gym: z.object({ name: z.string() }).strict(),
    today: daySchema,
    record: z.enum(["own", "none", "shared"]),
    /** Who pays for them (18i), by the gym's list now; null for nobody. While somebody does,
     *  their memberships' price, bills, payments and fees are the payer's to read: each
     *  membership here then carries its dates alone, with `priceMinor` and `owed` null and no
     *  payments or fees. */
    paidBy: z.string().nullable(),
    memberships: z.array(myMembershipSchema),
    /** The people the reader pays for, in the gym's list order; empty for nobody. */
    paysFor: z.array(myPaysForSchema),
    earlierNotShown: z.number().int().min(0),
    purchases: z.array(myPurchaseSchema),
    purchasesNotShown: z.number().int().min(0),
  })
  .strict();
export type MyMembershipResponse = z.infer<typeof myMembershipResponseSchema>;
