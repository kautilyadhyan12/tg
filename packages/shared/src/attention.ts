// What waits for the business's staff (ROADMAP V1-d; spec Part 3 §17.11): the counts beside
// the menu's pages and the bell's "Needs attention". Counts only, and money totals where the
// page itself shows one; no person's name leaves the server here.
//
// Each part is its own page's or box's figure, read by that page's own rule, and is null
// for somebody who may not open that page: a part left out is never a nought.
import { z } from "zod";

const countSchema = z.number().int().min(0);
const currencySchema = z.string().regex(/^[A-Z]{3}$/);

export const attentionSchema = z
  .object({
    /** Overview's Chargebacks box: those to answer, and the lost ones whose charges are stopped.
     *  `needsReconnect`: Square was connected before the app asked to read chargebacks, so none can
     *  be seen until the owner reconnects (`canReconnect`: the asker is the owner). */
    chargebacks: z.object({ count: countSchema, lostCount: countSchema, needsReconnect: z.boolean(), canReconnect: z.boolean() }).strict().nullable(),
    /** The Failed payments page: declined card payments still outstanding, by currency. */
    failedPayments: z
      .object({ count: countSchema, totals: z.array(z.object({ currency: currencySchema, minor: countSchema }).strict()) })
      .strict()
      .nullable(),
    /** As Overview's "Last 7 days" counts it: members with a payment due, and past members. */
    paymentDue: z.object({ count: countSchema, past: countSchema }).strict().nullable(),
    /** Overview's Refunds to review box. */
    refunds: z.object({ count: countSchema }).strict().nullable(),
    /** Overview's App payments to review box: the rows it shows, and whether there are more. */
    appPayments: z.object({ count: countSchema, more: z.boolean() }).strict().nullable(),
    /** Overview's Cancelled in the app box, over its own days. */
    appCancels: z.object({ count: countSchema }).strict().nullable(),
    /** Leads whose status is New. */
    newLeads: z.object({ count: countSchema }).strict().nullable(),
    /** The At risk page's count; null also where check-in is not in use yet. */
    atRisk: z.object({ count: countSchema }).strict().nullable(),
    /** Updates: posts and comments with a report nobody has answered. */
    reported: z.object({ posts: countSchema, comments: countSchema }).strict().nullable(),
  })
  .strict();
export type Attention = z.infer<typeof attentionSchema>;

export const attentionResponseSchema = z.object({ attention: attentionSchema }).strict();
export type AttentionResponse = z.infer<typeof attentionResponseSchema>;
