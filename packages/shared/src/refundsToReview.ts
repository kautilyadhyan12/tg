// REFUNDS TO REVIEW (ROADMAP 18d-iv-b-iii; spec Part 3 §14.8): Overview's list of money a gym may have to give back: fees it knows
// are no longer owed, refunds to the card that failed, that Square never answered, or that Square has not finished after its 14
// days. One row a Square payment. Nothing here moves money: Refund opens the box that asks Square first.
import { z } from "zod";
import { memberFeeKindSchema } from "./memberBills.js";

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const minorSchema = z.number().int().min(0).max(99_999_999);

/** Rows a page, read a page at a time: refunds that went wrong first, then fees, the newest first in each. */
export const REFUNDS_TO_REVIEW_PAGE = 10;

export const REFUND_REVIEW_KINDS = ["fee", "failed", "lost", "late", "place"] as const;

export const refundToReviewSchema = z
  .object({
    /** The fee's bill for a fee; the refund press for the rest. */
    id: z.string().uuid(),
    kind: z.enum(REFUND_REVIEW_KINDS),
    /** What is left to give back: of a fee, or of a refund after any refund since. */
    amountMinor: minorSchema,
    /** What was paid, on a fee; what was asked for, on a refund. */
    paidMinor: minorSchema,
    /** Other refunds that went wrong on the same Square payment, which No refund needed also closes. */
    others: z.number().int().min(0),
    currency: z.string().regex(/^[A-Z]{3}$/),
    /** The person's name; null for a walk-in, or a buyer deleted for good. */
    name: z.string().nullable(),
    past: z.boolean(),
    personDeleted: z.boolean(),
    /** The gym's day the refund was pressed; null on a fee. */
    on: daySchema.nullable(),
    member: z
      .object({
        entryId: z.string().uuid(),
        membershipId: z.string().uuid(),
        paymentId: z.string().uuid(),
        typeName: z.string(),
        /** Paid by hand: Void payment, as such a fee takes no refund. */
        byHand: z.boolean(),
        fee: z
          .object({ kind: memberFeeKindSchema, of: z.enum(["class", "pt", "membership"]), forName: z.string().min(1), on: daySchema, to: daySchema.nullable() })
          .strict()
          .nullable(),
      })
      .strict()
      .nullable(),
    sale: z
      .object({
        saleId: z.string().uuid(),
        /** The day Sell lists it on. */
        day: daySchema,
        item: z.string(),
        /** Other products the same refund was for. */
        more: z.number().int().min(0),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type RefundToReview = z.infer<typeof refundToReviewSchema>;

export const refundsToReviewResponseSchema = z
  .object({
    count: z.number().int().min(0),
    rows: z.array(refundToReviewSchema),
    /** Where the next page starts; null on the last. */
    next: z.number().int().min(1).nullable(),
  })
  .strict();
export type RefundsToReviewResponse = z.infer<typeof refundsToReviewResponseSchema>;

export const refundsToReviewQuerySchema = z.object({ from: z.coerce.number().int().min(0).max(100_000).default(0) }).strict();

export const refundReviewFeeParamsSchema = z.object({ gymId: z.string().uuid(), billId: z.string().uuid() }).strict();
export const refundReviewPressParamsSchema = z.object({ gymId: z.string().uuid(), pressId: z.string().uuid() }).strict();

export const REFUND_REVIEW_WORDS = {
  changed: "This has changed since the list was read. The list now shows what is left to do.",
  waiting: "A refund here is waiting for Square's answer. Try again once it has finished.",
} as const;
