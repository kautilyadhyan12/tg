// What Razorpay's API and webhooks send (razorpay.com/docs, Subscriptions, read 2026-09-29;
// shapes checked against Kd's test account that day). An Indian gym pays through Razorpay
// (Kd, RULINGS 2026-09-24; ROADMAP Stage 3 item 1d). Only the fields the app reads are
// named; Razorpay adds fields freely, so its objects are not strict.
import { z } from "zod";

const razorpayId = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9]{14}$`));

export const razorpayPlanIdSchema = razorpayId("plan");
export const razorpaySubscriptionIdSchema = razorpayId("sub");
export const razorpayPaymentIdSchema = razorpayId("pay");
export const razorpayCustomerIdSchema = razorpayId("cust");
export const razorpayInvoiceIdSchema = razorpayId("inv");

/** A public key id: `rzp_test_…` or `rzp_live_…`. The browser's checkout needs it. */
export const razorpayKeyIdSchema = z.string().regex(/^rzp_(test|live)_[A-Za-z0-9]{14}$/);

/** Razorpay sends `[]` for notes that are empty, and an object otherwise. */
const notesSchema = z
  .union([z.record(z.string(), z.unknown()), z.array(z.unknown()).max(0)])
  .transform((n): Record<string, unknown> => (Array.isArray(n) ? {} : n));

const unixSeconds = z.number().int().nonnegative();

export const razorpayPlanSchema = z.object({
  id: razorpayPlanIdSchema,
  entity: z.literal("plan"),
  period: z.string(),
  interval: z.number().int(),
  item: z.object({
    active: z.boolean(),
    amount: z.number().int().nonnegative(),
    currency: z.string().length(3),
    name: z.string(),
  }),
  notes: notesSchema,
});
export type RazorpayPlan = z.infer<typeof razorpayPlanSchema>;

export const razorpayPlanListSchema = z.object({
  entity: z.literal("collection"),
  count: z.number().int().nonnegative(),
  items: z.array(razorpayPlanSchema),
});

/** Razorpay's subscription states (docs, "Subscription States"). An unknown one does not
 *  parse, so it is never read as any of these. */
export const razorpaySubscriptionStatusSchema = z.enum([
  "created",
  "authenticated",
  "active",
  "pending",
  "halted",
  "cancelled",
  "completed",
  "expired",
  "paused",
]);
export type RazorpaySubscriptionStatus = z.infer<typeof razorpaySubscriptionStatusSchema>;

export const razorpaySubscriptionSchema = z.object({
  id: razorpaySubscriptionIdSchema,
  entity: z.literal("subscription"),
  plan_id: razorpayPlanIdSchema,
  customer_id: razorpayCustomerIdSchema.nullable().optional(),
  status: razorpaySubscriptionStatusSchema,
  current_start: unixSeconds.nullable(),
  current_end: unixSeconds.nullable(),
  ended_at: unixSeconds.nullable(),
  charge_at: unixSeconds.nullable(),
  start_at: unixSeconds.nullable(),
  quantity: z.number().int(),
  total_count: z.number().int(),
  paid_count: z.number().int().nonnegative(),
  notes: notesSchema,
  created_at: unixSeconds,
  /** Sent back when a subscription is created (not when fetched): what it will charge. */
  plan: razorpayPlanSchema.optional(),
});
export type RazorpaySubscription = z.infer<typeof razorpaySubscriptionSchema>;

export const razorpayInvoiceSchema = z.object({
  id: razorpayInvoiceIdSchema,
  entity: z.literal("invoice"),
  status: z.string(),
  subscription_id: razorpaySubscriptionIdSchema.nullable().optional(),
  payment_id: razorpayPaymentIdSchema.nullable().optional(),
  amount_paid: z.number().int().nonnegative().nullable().optional(),
  /** What is still owed on it: above 0 on an invoice Razorpay could not charge. */
  amount_due: z.number().int().nonnegative().nullable().optional(),
  /** When it was paid (Unix seconds); null while unpaid. */
  paid_at: z.number().int().nonnegative().nullable().optional(),
});
export type RazorpayInvoice = z.infer<typeof razorpayInvoiceSchema>;

export const razorpayInvoiceListSchema = z.object({
  entity: z.literal("collection"),
  count: z.number().int().nonnegative(),
  items: z.array(razorpayInvoiceSchema),
});

export const razorpayPaymentSchema = z.object({
  id: razorpayPaymentIdSchema,
  entity: z.literal("payment"),
  amount: z.number().int().nonnegative(),
  currency: z.string().length(3),
  status: z.string(),
  amount_refunded: z.number().int().nonnegative(),
});
export type RazorpayPayment = z.infer<typeof razorpayPaymentSchema>;

export const razorpayErrorSchema = z.object({
  error: z.object({ code: z.string(), description: z.string().optional() }),
});

/** A webhook's body: only which event and which subscription it names are read. The worker
 *  asks Razorpay for the subscription itself before anything changes. */
export const razorpayWebhookBodySchema = z.object({
  entity: z.literal("event"),
  event: z.string().min(1).max(100),
  payload: z.object({
    subscription: z.object({ entity: z.object({ id: z.string() }) }).optional(),
  }),
});
