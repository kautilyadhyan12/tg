// A gym paying us through Paddle (ROADMAP Stage 3 item 1a): the console's checkout
// contract, and what Paddle's API and webhooks send (developer.paddle.com, API
// version 1, read 2026-09-24). Only the fields the app reads are named; Paddle adds
// fields freely, so its objects are not strict.
import { z } from "zod";
import { orgSubscriptionSchema } from "./orgs.js";

const paddleId = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[a-z\\d]{26}$`));

export const paddleSubscriptionIdSchema = paddleId("sub");
export const paddleTransactionIdSchema = paddleId("txn");
export const paddlePriceIdSchema = paddleId("pri");
export const paddleProductIdSchema = paddleId("pro");
export const paddleCustomerIdSchema = paddleId("ctm");

// ── The console ──────────────────────────────────────────────────────────────

/** Subscribe to one plan of the gym's own price list. The server prices it. */
export const orgCheckoutRequestSchema = z.object({ planCode: z.string().min(1).max(64) }).strict();
export type OrgCheckoutRequest = z.infer<typeof orgCheckoutRequestSchema>;

/** What the browser needs to open Paddle's checkout for the transaction our server made. */
export const orgCheckoutResponseSchema = z.object({
  checkoutId: z.string().uuid(),
  provider: z.literal("paddle"),
  environment: z.enum(["sandbox", "production"]),
  clientToken: z.string().min(1).max(200),
  transactionId: paddleTransactionIdSchema,
});
export type OrgCheckoutResponse = z.infer<typeof orgCheckoutResponseSchema>;

/** After Paddle's window says the payment went: has it reached the gym yet? `waiting`
 *  means ask again in a moment; `paid` carries the gym's plan as it now stands. */
export const orgCheckoutSyncResponseSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("waiting") }),
  z.object({ state: z.literal("paid"), subscription: orgSubscriptionSchema }),
]);
export type OrgCheckoutSyncResponse = z.infer<typeof orgCheckoutSyncResponseSchema>;

// ── Paddle ───────────────────────────────────────────────────────────────────

const instant = z.string().datetime({ offset: true });

/** A subscription (`GET /subscriptions/{id}`). */
export const paddleSubscriptionSchema = z.object({
  id: paddleSubscriptionIdSchema,
  status: z.enum(["active", "canceled", "past_due", "paused", "trialing"]),
  customer_id: paddleCustomerIdSchema.nullable(),
  currency_code: z.string().length(3),
  updated_at: instant,
  canceled_at: instant.nullable(),
  paused_at: instant.nullable(),
  current_billing_period: z.object({ starts_at: instant, ends_at: instant }).nullable(),
  scheduled_change: z
    .object({ action: z.enum(["cancel", "pause", "resume"]), effective_at: instant })
    .nullable(),
  items: z
    .array(z.object({ quantity: z.number().int(), price: z.object({ id: paddlePriceIdSchema }) }))
    .max(100),
});
export type PaddleSubscription = z.infer<typeof paddleSubscriptionSchema>;

/** A transaction (`POST /transactions`, `GET /transactions/{id}`). */
export const paddleTransactionSchema = z.object({
  id: paddleTransactionIdSchema,
  status: z.enum(["draft", "ready", "billed", "paid", "completed", "canceled", "past_due"]),
  subscription_id: paddleSubscriptionIdSchema.nullable(),
  origin: z.string().max(60),
  currency_code: z.string().length(3),
  items: z
    .array(
      z.object({
        quantity: z.number().int(),
        price: z.object({
          id: paddlePriceIdSchema,
          unit_price: z.object({ amount: z.string().regex(/^\d{1,12}$/), currency_code: z.string().length(3) }),
        }),
      }),
    )
    .max(100),
});
export type PaddleTransaction = z.infer<typeof paddleTransactionSchema>;

/** A price (`POST /prices`, `GET /prices/{id}`), as `tools/paddle-prices.ts` checks it. */
export const paddlePriceSchema = z.object({
  id: paddlePriceIdSchema,
  product_id: paddleProductIdSchema,
  status: z.enum(["active", "archived"]),
  tax_mode: z.enum(["account_setting", "external", "internal"]),
  unit_price: z.object({ amount: z.string().regex(/^\d{1,12}$/), currency_code: z.string().length(3) }),
  billing_cycle: z.object({ interval: z.enum(["day", "week", "month", "year"]), frequency: z.number().int() }).nullable(),
  quantity: z.object({ minimum: z.number().int(), maximum: z.number().int() }),
  custom_data: z.record(z.unknown()).nullable(),
});
export type PaddlePrice = z.infer<typeof paddlePriceSchema>;

export const paddleProductSchema = z.object({ id: paddleProductIdSchema });

/** Every Paddle response wraps its entity in `data`. */
export const paddleEnvelope = <T extends z.ZodTypeAny>(entity: T) => z.object({ data: entity });

/** A list response: `data` and, when there is more, `meta.pagination.next`. */
export const paddleListEnvelope = <T extends z.ZodTypeAny>(entity: T) =>
  z.object({
    data: z.array(entity).max(200),
    meta: z
      .object({ pagination: z.object({ has_more: z.boolean(), next: z.string().url().nullable().optional() }).optional() })
      .optional(),
  });

/** Paddle's error body. */
export const paddleErrorSchema = z.object({
  error: z.object({ type: z.string().max(40), code: z.string().max(100), detail: z.string().max(2000).optional() }),
});

/** A webhook body (developer.paddle.com, "subscription.created", read 2026-09-24). Only
 *  the event's id and type and the entity's id are read: the worker asks Paddle for
 *  the entity itself before acting. */
export const paddleWebhookBodySchema = z.object({
  event_id: z.string().regex(/^evt_[a-z\d]{26}$/),
  event_type: z.string().min(1).max(100),
  occurred_at: instant,
  data: z.object({ id: z.string().min(1).max(100) }).passthrough(),
});
export type PaddleWebhookBody = z.infer<typeof paddleWebhookBodySchema>;

/** A refund (`POST /adjustments`): only its id is read back. */
export const paddleAdjustmentSchema = z.object({ id: z.string().regex(/^adj_[a-z\d]{26}$/) });
