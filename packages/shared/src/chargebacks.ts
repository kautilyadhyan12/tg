// CHARGEBACKS (ROADMAP 18d-iv-e-i; spec Part 3 §14.8): a member asked their bank for a payment back. Square's own record, shown on its
// payment and on Overview. The gym answers in Square; the app only reads.
import { z } from "zod";
import { cardSeenSchema } from "./cardCharges.js";

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const minorSchema = z.number().int().min(0).max(2_147_483_647);

export const CHARGEBACK_STATES = ["INQUIRY_EVIDENCE_REQUIRED", "INQUIRY_PROCESSING", "INQUIRY_CLOSED", "EVIDENCE_REQUIRED", "PROCESSING", "WON", "LOST", "ACCEPTED", "UNKNOWN"] as const;
export const chargebackStateSchema = z.enum(CHARGEBACK_STATES);
export type ChargebackState = z.infer<typeof chargebackStateSchema>;

export const CHARGEBACK_REASONS = ["AMOUNT_DIFFERS", "CANCELLED", "DUPLICATE", "NO_KNOWLEDGE", "NOT_AS_DESCRIBED", "NOT_RECEIVED", "PAID_BY_OTHER_MEANS", "CUSTOMER_REQUESTS_CREDIT", "EMV_LIABILITY_SHIFT"] as const;
export const chargebackReasonSchema = z.enum(CHARGEBACK_REASONS);
export type ChargebackReason = z.infer<typeof chargebackReasonSchema>;

/** One chargeback as a screen reads it. `dueOn`: Square's date on the gym's own calendar. `duePassed`: that moment has gone. */
export const chargebackSeenSchema = z
  .object({
    id: z.string().uuid(),
    amountMinor: minorSchema,
    currency: z.string().regex(/^[A-Z]{3}$/),
    state: chargebackStateSchema,
    reason: chargebackReasonSchema.nullable(),
    dueOn: daySchema.nullable(),
    duePassed: z.boolean(),
    card: cardSeenSchema.nullable(),
  })
  .strict();
export type ChargebackSeen = z.infer<typeof chargebackSeenSchema>;

/** Rows a page on Overview, the soonest date first. */
export const CHARGEBACKS_PAGE = 10;

export const chargebackToAnswerSchema = chargebackSeenSchema
  .extend({
    name: z.string().nullable(),
    past: z.boolean(),
    personDeleted: z.boolean(),
    /** The person's page, or the sale on Sell, that holds the payment. */
    member: z.object({ entryId: z.string().uuid(), what: z.string() }).strict().nullable(),
    sale: z.object({ saleId: z.string().uuid(), day: daySchema, item: z.string(), more: z.number().int().min(0) }).strict().nullable(),
  })
  .strict();
export type ChargebackToAnswer = z.infer<typeof chargebackToAnswerSchema>;

export const chargebacksResponseSchema = z
  .object({
    count: z.number().int().min(0),
    rows: z.array(chargebackToAnswerSchema),
    next: z.number().int().min(0).nullable(),
    /** Connected before the app asked to read chargebacks: none can be seen until the owner reconnects. */
    needsReconnect: z.boolean(),
    canReconnect: z.boolean(),
  })
  .strict();
export type ChargebacksResponse = z.infer<typeof chargebacksResponseSchema>;

export const chargebacksQuerySchema = z.object({ from: z.coerce.number().int().min(0).max(100_000).default(0) }).strict();
