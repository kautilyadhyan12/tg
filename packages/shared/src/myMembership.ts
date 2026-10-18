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

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const minorSchema = z.number().int().min(0).max(99_999_999);
const currencySchema = z.string().regex(/^[A-Z]{3}$/);

/** A refund that stands, under the payment or sale it gives back for. */
export const myRefundSchema = z
  .object({ amountMinor: minorSchema, method: memberPaymentMethodSchema, refundedOn: daySchema, receiptNumber: receiptNumberSchema })
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

/** A late cancel or no-show fee (18h): owed, paid or waived. A fee taken off is not sent. */
export const myFeeSchema = z
  .object({
    fee: memberFeeKindSchema,
    forName: z.string().min(1),
    on: daySchema,
    amountMinor: minorSchema,
    dueOn: daySchema,
    state: z.enum(["due", "overdue", "paid", "waived"]),
    /** The receipt of the payment that paid it; null while it is owed or waived. */
    receiptNumber: receiptNumberSchema.nullable(),
  })
  .strict();
export type MyFee = z.infer<typeof myFeeSchema>;

export const myMembershipSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    kind: membershipKindSchema,
    priceMinor: minorSchema,
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
    /** What is owed now and since when; null where nothing is. */
    owed: z.object({ amountMinor: minorSchema, dueOn: daySchema, state: z.enum(["due", "overdue"]) }).strict().nullable(),
    payments: z.array(myPaymentSchema),
    /** Older periods' payments kept off this answer; the gym holds them. */
    olderPeriodsNotShown: z.number().int().min(0),
    fees: z.array(myFeeSchema),
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
     *  their memberships' bills, payments and fees are the payer's to read: each membership
     *  here then carries its dates alone, with `owed` null and no payments or fees. */
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
