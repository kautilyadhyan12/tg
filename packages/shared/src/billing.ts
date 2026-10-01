// A gym paying us through Paddle (ROADMAP Stage 3 item 1a): the console's checkout
// contract, and what Paddle's API and webhooks send (developer.paddle.com, API
// version 1, read 2026-09-24). Only the fields the app reads are named; Paddle adds
// fields freely, so its objects are not strict.
import { z } from "zod";
import { orgSubscriptionSchema } from "./orgs.js";
import { razorpayKeyIdSchema, razorpayPayLinkSchema, razorpaySubscriptionIdSchema } from "./razorpay.js";

const paddleId = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[a-z\\d]{26}$`));

export const paddleSubscriptionIdSchema = paddleId("sub");
export const paddleTransactionIdSchema = paddleId("txn");
export const paddlePriceIdSchema = paddleId("pri");
export const paddleProductIdSchema = paddleId("pro");
export const paddleCustomerIdSchema = paddleId("ctm");

// ── The console ──────────────────────────────────────────────────────────────

/** How long a paying gym keeps everything after a payment fails, before its members
 *  drop to the free app and its console goes read-only (Kd, RULINGS 2026-09-24; Part 5
 *  §8 said 5). The worker ends the grace and the console's banner says the number. */
export const PAID_PLAN_GRACE_DAYS = 2;

/** Subscribe to one plan of the gym's own price list. The server prices it, and charges it
 *  now: in the gym's own free trial too, which then ends (Kd, RULINGS 2026-09-30). */
export const orgCheckoutRequestSchema = z.object({ planCode: z.string().min(1).max(64) }).strict();
export type OrgCheckoutRequest = z.infer<typeof orgCheckoutRequestSchema>;

/** An email a payment window can be filled in with. The server sends an owner's email only
 *  when it passes this, and none otherwise (the window then asks), since a stored email may
 *  be in a shape this refuses (a Google or migrated account) and the console reads the reply
 *  through this schema. */
export const payerEmailSchema = z.string().email().max(254);

/** What the browser needs to open the payment window for the checkout our server made:
 *  Paddle's for the transaction, or Razorpay's for the subscription (an Indian gym, 1d-i). */
export const orgCheckoutResponseSchema = z.discriminatedUnion("provider", [
  z.object({
    checkoutId: z.string().uuid(),
    provider: z.literal("paddle"),
    environment: z.enum(["sandbox", "production"]),
    clientToken: z.string().min(1).max(200),
    transactionId: paddleTransactionIdSchema,
    /** The gym owner's email, for Paddle's window to fill in, whoever opens it (1e). */
    email: payerEmailSchema.nullable(),
    /** The gym's country for Paddle's window to fill in; null when the gym has none, or when
     *  Paddle takes that country only with a postcode, which the payer types. */
    country: z.string().regex(/^[A-Z]{2}$/).nullable(),
  }),
  z.object({
    checkoutId: z.string().uuid(),
    provider: z.literal("razorpay"),
    keyId: razorpayKeyIdSchema,
    subscriptionId: razorpaySubscriptionIdSchema,
    /** What the window says is being paid for ("Up to 200 members, monthly"). */
    description: z.string().min(1).max(200),
    /** The owner's mobile for payments (`+91…`), for Razorpay's window to fill in; null when
     *  the gym has none, and Razorpay asks for it. */
    contact: z.string().regex(/^\+91[6-9]\d{9}$/).nullable(),
    /** The gym owner's email, for Razorpay's window to fill in, whoever opens it. */
    email: payerEmailSchema.nullable(),
  }),
]);
export type OrgCheckoutResponse = z.infer<typeof orgCheckoutResponseSchema>;

/** After Paddle's window says the payment went: has it reached the gym yet? `waiting`
 *  means ask again in a moment; `paid` carries the gym's plan as it now stands;
 *  `trial_ended` means a trial window was saved after the gym's own trial had ended, so the
 *  subscription was cancelled with nothing charged. */
export const orgCheckoutSyncResponseSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("waiting") }),
  z.object({ state: z.literal("trial_ended") }),
  /** A bigger size paid after the plan changed meanwhile (1d-iii-a): nothing changed, and what
   *  was paid is refunded. */
  z.object({ state: z.literal("refunded") }),
  z.object({ state: z.literal("paid"), subscription: orgSubscriptionSchema }),
]);
export type OrgCheckoutSyncResponse = z.infer<typeof orgCheckoutSyncResponseSchema>;

/** A bigger size for a gym's paid plan (ROADMAP Stage 3 item 1c-ii). The server prices it. */
export const orgPlanChangeRequestSchema = z.object({ planCode: z.string().min(1).max(64) }).strict();
export type OrgPlanChangeRequest = z.infer<typeof orgPlanChangeRequestSchema>;

/** What a bigger size costs, as Paddle works it out, before the gym confirms. Money is
 *  formatted by the server. `dueNow` is null when nothing is charged now (a free trial:
 *  the new price is taken when the trial ends). */
export const orgPlanChangePreviewSchema = z
  .object({
    planCode: z.string().min(1).max(64),
    seatCap: z.number().int().positive().nullable(),
    /** The new monthly price, before tax ("$129"). */
    priceLabel: z.string().min(1).max(40),
    dueNow: z
      .object({
        /** What is charged now, tax included ("$53.52"). */
        totalLabel: z.string().min(1).max(40),
        /** Before tax ("$49.15"), and the tax ("$4.37"); tax null when there is none. */
        subtotalLabel: z.string().min(1).max(40),
        taxLabel: z.string().min(1).max(40).nullable(),
      })
      .strict()
      .nullable(),
    /** When the new monthly price is next charged. */
    nextPaymentAt: z.string().datetime().nullable(),
  })
  .strict();
export type OrgPlanChangePreview = z.infer<typeof orgPlanChangePreviewSchema>;

/** The size changed: the gym's plan as it now stands. */
export const orgPlanChangeResponseSchema = z.object({ subscription: orgSubscriptionSchema }).strict();
export type OrgPlanChangeResponse = z.infer<typeof orgPlanChangeResponseSchema>;

// ── A plan paid through Razorpay, managed from the console (1d-ii) ───────────

/** Razorpay's own page for the oldest bill still owed: the gym pays it there. */
export const orgRazorpayPayResponseSchema = z.object({ url: razorpayPayLinkSchema }).strict();
export type OrgRazorpayPayResponse = z.infer<typeof orgRazorpayPayResponseSchema>;

/** What the browser needs to open Razorpay's window for the gym's plan, to change the card
 *  or bank account it is paid from. Filled in as the Subscribe window is (1d-i). */
export const orgRazorpayMethodResponseSchema = z
  .object({
    keyId: razorpayKeyIdSchema,
    subscriptionId: razorpaySubscriptionIdSchema,
    contact: z.string().regex(/^\+91[6-9]\d{9}$/).nullable(),
    email: payerEmailSchema.nullable(),
  })
  .strict();
export type OrgRazorpayMethodResponse = z.infer<typeof orgRazorpayMethodResponseSchema>;

/** Cancel plan or Keep my plan: the gym's plan as it now stands, or null when it has ended
 *  (an overdue plan cancelled ends at once). */
export const orgPlanCancelResponseSchema = z.object({ subscription: orgSubscriptionSchema.nullable() }).strict();
export type OrgPlanCancelResponse = z.infer<typeof orgPlanCancelResponseSchema>;

// ── Paddle ───────────────────────────────────────────────────────────────────

const instant = z.string().datetime({ offset: true });

/** A link to Paddle's customer portal: https, on Paddle's own domain, nowhere else. */
export const paddlePortalUrlSchema = z
  .string()
  .max(2000)
  .url()
  .refine((value) => {
    let link: URL;
    try {
      link = new URL(value);
    } catch {
      return false;
    }
    return link.protocol === "https:" && link.username === "" && link.password === "" && (link.hostname === "paddle.com" || link.hostname.endsWith(".paddle.com"));
  }, "not a Paddle link");

/** Paddle's own page for the gym's plan (card, cancel, invoices), for this press only:
 *  its link carries a short-lived sign-in, so it is opened at once and never kept. */
export const orgBillingPortalResponseSchema = z.object({ url: paddlePortalUrlSchema }).strict();
export type OrgBillingPortalResponse = z.infer<typeof orgBillingPortalResponseSchema>;

/** A customer portal session (`POST /customers/{id}/portal-sessions`, developer.paddle.com,
 *  read 2026-09-24). */
export const paddlePortalSessionSchema = z.object({
  customer_id: paddleCustomerIdSchema,
  urls: z.object({
    general: z.object({ overview: paddlePortalUrlSchema }),
    subscriptions: z
      .array(
        z.object({
          id: paddleSubscriptionIdSchema,
          cancel_subscription: paddlePortalUrlSchema,
          update_subscription_payment_method: paddlePortalUrlSchema,
        }),
      )
      .max(25),
  }),
});
export type PaddlePortalSession = z.infer<typeof paddlePortalSessionSchema>;

/** A customer (`GET /customers/{id}`): who paid. Paddle keeps one per email. */
export const paddleCustomerSchema = z.object({
  id: paddleCustomerIdSchema,
  email: z.string().max(320),
});
export type PaddleCustomer = z.infer<typeof paddleCustomerSchema>;

/** A subscription (`GET /subscriptions/{id}`). */
export const paddleSubscriptionSchema = z.object({
  id: paddleSubscriptionIdSchema,
  status: z.enum(["active", "canceled", "past_due", "paused", "trialing"]),
  customer_id: paddleCustomerIdSchema.nullable(),
  /** A discount on it. Our server never gives one. */
  discount: z.object({ id: z.string().max(60) }).passthrough().nullable().optional(),
  currency_code: z.string().length(3),
  updated_at: instant,
  canceled_at: instant.nullable(),
  paused_at: instant.nullable(),
  current_billing_period: z.object({ starts_at: instant, ends_at: instant }).nullable(),
  /** When Paddle next charges: during a trial, the day the trial ends. */
  next_billed_at: instant.nullable().optional(),
  scheduled_change: z
    .object({ action: z.enum(["cancel", "pause", "resume"]), effective_at: instant })
    .nullable(),
  items: z
    .array(
      z.object({
        quantity: z.number().int(),
        price: z.object({
          id: paddlePriceIdSchema,
          /** `custom`: a price made for one checkout (a trial of the days left). */
          type: z.enum(["standard", "custom"]).optional(),
          unit_price: z.object({ amount: z.string().regex(/^\d{1,12}$/), currency_code: z.string().length(3) }).optional(),
          billing_cycle: z.object({ interval: z.enum(["day", "week", "month", "year"]), frequency: z.number().int() }).nullable().optional(),
          custom_data: z.record(z.unknown()).nullable().optional(),
        }),
      }),
    )
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
          trial_period: z.object({ interval: z.enum(["day", "week", "month", "year"]), frequency: z.number().int() }).nullable().optional(),
          custom_data: z.record(z.unknown()).nullable().optional(),
        }),
      }),
    )
    .max(100),
  /** What it charges; a free trial's checkout charges 0. */
  details: z
    .object({ totals: z.object({ grand_total: z.string().regex(/^-?\d{1,12}$/) }).nullable().optional() })
    .nullable()
    .optional(),
  /** With `include=adjustments`: its refunds and credits, and each one's state. */
  adjustments: z
    .array(z.object({ action: z.string().max(40), status: z.enum(["pending_approval", "approved", "rejected", "reversed"]) }))
    .max(100)
    .optional(),
});
export type PaddleTransaction = z.infer<typeof paddleTransactionSchema>;

/** A price (`POST /prices`, `GET /prices/{id}`), as `tools/paddle-prices.ts` checks it. */
export const paddlePriceSchema = z.object({
  id: paddlePriceIdSchema,
  product_id: paddleProductIdSchema,
  name: z.string().max(150).nullable(),
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

const paddleTotals = z.object({
  subtotal: z.string().regex(/^-?\d{1,12}$/),
  tax: z.string().regex(/^-?\d{1,12}$/),
  grand_total: z.string().regex(/^-?\d{1,12}$/),
  currency_code: z.string().length(3),
});

/** A subscription change previewed (`PATCH /subscriptions/{id}/preview`, read 2026-09-25 and
 *  run on Kd's sandbox): what is charged now and when the next payment falls. */
export const paddleSubscriptionPreviewSchema = z.object({
  next_billed_at: instant.nullable(),
  immediate_transaction: z.object({ details: z.object({ totals: paddleTotals }) }).nullable(),
});
export type PaddleSubscriptionPreview = z.infer<typeof paddleSubscriptionPreviewSchema>;

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
