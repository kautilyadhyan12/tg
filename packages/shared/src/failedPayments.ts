// FAILED PAYMENTS (ROADMAP 18d-iii-ii-b; spec Part 3 §14.8): every bill and fee still owed whose
// newest charge to a card on file was declined, gathered in one list for staff who take payments,
// with Try again where the card can be charged now. Each row's decline says what the person's page
// says of that bill (`cardDeclinedSchema`, read by the same function), and Try again sends the same
// charge as Record payment's Card on file.
import { z } from "zod";
import { cardDeclinedSchema, cardSeenSchema } from "./cardCharges.js";
import { memberFeeKindSchema } from "./memberBills.js";

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const minorSchema = z.number().int().min(0).max(99_999_999);
const currencySchema = z.string().regex(/^[A-Z]{3}$/);

/** Rows a page; the list is read a page at a time, newest decline first. */
export const FAILED_PAYMENTS_PAGE = 25;

/** What Try again would do now. `charge`: the card on file, for this amount, sent back as Record
 *  payment's Card on file sends it; `wait`: declined less than a day ago (Square: "Wait at least 24
 *  hours before retrying"); `no`: why it can't be charged from here. */
export const failedPaymentRetrySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("charge"),
      card: cardSeenSchema,
      /** The record that pays for them, by name; null for their own card. */
      payerName: z.string().nullable(),
      /** Past its expiry month on the gym's day: Square may still have a newer date. */
      expired: z.boolean(),
      cardRef: z.string().min(1).max(200),
      amountMinor: z.number().int().min(1).max(99_999_999),
    })
    .strict(),
  z.object({ kind: z.literal("wait"), from: z.string().datetime() }).strict(),
  z
    .object({
      kind: z.literal("no"),
      /** `new_card`: the bank declined the card for good; `tried_out`: 3 tries; `no_card`: no card on
       *  file now; `square`: Square is not connected; `currency`: priced in another currency;
       *  `elsewhere`: an earlier payment of the membership is owed first, or it has changed, so it is
       *  taken from the person's page; `square_app`: a payment of theirs from Square Point of Sale waits in
       *  Payments to match (18d-iii-b-ii-a), and the card waits for it. */
      why: z.enum(["new_card", "tried_out", "no_card", "square", "currency", "elsewhere", "square_app"]),
    })
    .strict(),
]);
export type FailedPaymentRetry = z.infer<typeof failedPaymentRetrySchema>;

export const failedPaymentSchema = z
  .object({
    /** The bill or the fee. */
    billId: z.string().uuid(),
    entryId: z.string().uuid(),
    name: z.string(),
    /** A past member's: still owed, as their page says. */
    past: z.boolean(),
    membershipId: z.string().uuid(),
    typeName: z.string(),
    /** The period it is for; null for a fee. */
    periodIndex: z.number().int().min(0).nullable(),
    /** The days a period's bill covers; null for a membership of one period, and for a fee. */
    covers: z.object({ from: daySchema, to: daySchema }).strict().nullable(),
    /** A fee's kind and what it was for, as the person's page names it; null for a period. */
    fee: z.object({ kind: memberFeeKindSchema, forName: z.string().min(1), on: daySchema, to: daySchema.nullable() }).strict().nullable(),
    /** What is left to pay on it. */
    leftMinor: minorSchema,
    currency: currencySchema,
    declined: cardDeclinedSchema,
    retry: failedPaymentRetrySchema,
  })
  .strict();
export type FailedPayment = z.infer<typeof failedPaymentSchema>;

/** How many, and what they come to in each currency: Overview's line, and the list's heading. */
export const failedPaymentsSummarySchema = z
  .object({
    count: z.number().int().min(0),
    totals: z.array(z.object({ currency: currencySchema, minor: z.number().int().min(0) }).strict()),
    /** Square connected and ready: the cards on file can be charged. */
    square: z.boolean(),
  })
  .strict();
export type FailedPaymentsSummary = z.infer<typeof failedPaymentsSummarySchema>;

export const failedPaymentsResponseSchema = failedPaymentsSummarySchema
  .extend({
    payments: z.array(failedPaymentSchema),
    /** Where the next page starts; null on the last. */
    next: z.number().int().min(1).nullable(),
  })
  .strict();
export type FailedPaymentsResponse = z.infer<typeof failedPaymentsResponseSchema>;

export const failedPaymentsQuerySchema = z
  .object({
    from: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict();
export type FailedPaymentsQuery = z.infer<typeof failedPaymentsQuerySchema>;
