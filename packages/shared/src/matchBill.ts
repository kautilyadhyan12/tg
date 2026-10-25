// A bill a payment from Square Point of Sale can go on (ROADMAP 18d-iii-b-ii-a): Match's box lists them,
// and Payments to match and the person's page tick the one it fits, for one press (Kd, 2026-10-25). In a
// file of its own because the person's page (`heldMemberships.ts`) shows it too.
import { z } from "zod";
import { memberFeeKindSchema } from "./memberBills.js";

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const minorSchema = z.number().int().min(0).max(999_999_999);

/** A bill a payment can go on: the next one of a membership (the one Record payment takes), or a fee
 *  that is owed. */
export const matchTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("period"), periodIndex: z.number().int().min(0).max(100_000) }).strict(),
  z.object({ kind: z.literal("fee"), billId: z.string().uuid() }).strict(),
]);
export type MatchTarget = z.infer<typeof matchTargetSchema>;

/** Why a bill can't take the payment now. `too_little`: less is left on it than the payment;
 *  `fee_whole`: a fee is paid all at once, and this payment is another amount; `busy`: a payment for it
 *  is out on the Square Terminal or the card on file; `currency`: it is in another currency. */
export const MATCH_BILL_CANNOT = ["too_little", "fee_whole", "busy", "currency"] as const;

export const matchBillSchema = z
  .object({
    /** Whose bill: the person picked, or somebody they pay for. */
    entryId: z.string().uuid(),
    name: z.string(),
    membershipId: z.string().uuid(),
    typeName: z.string(),
    target: matchTargetSchema,
    /** A fee's kind and what it was for; null for a membership's bill. */
    fee: z.object({ kind: memberFeeKindSchema, forName: z.string().min(1) }).strict().nullable(),
    /** The days a membership's bill covers; null for a membership of one period, and for a fee. */
    covers: z.object({ from: daySchema, to: daySchema }).strict().nullable(),
    dueOn: daySchema,
    leftMinor: minorSchema,
    currency: z.string().regex(/^[A-Z]{3}$/),
    cannot: z.enum(MATCH_BILL_CANNOT).nullable(),
  })
  .strict();
export type MatchBill = z.infer<typeof matchBillSchema>;
