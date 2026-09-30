// The calls our server makes to Razorpay's API (razorpay.com/docs/api, Subscriptions,
// Invoices, Payments and Refunds, read 2026-09-29; checked on Kd's test account that day).
// Every reply is parsed through `@app/shared` before anything reads it, and no body, key or
// customer detail is ever logged or returned. Razorpay's SDK is not used: these are a few
// plain requests, and Razorpay's types stay inside this file and `@app/shared`.
import {
  razorpayErrorSchema,
  razorpayInvoiceListSchema,
  razorpayPaymentIdSchema,
  razorpayPaymentSchema,
  razorpayPlanIdSchema,
  razorpayPlanListSchema,
  razorpayPlanSchema,
  razorpaySubscriptionIdSchema,
  razorpaySubscriptionSchema,
  type RazorpayInvoice,
  type RazorpayPayment,
  type RazorpayPlan,
  type RazorpaySubscription,
} from "@app/shared";
import { z } from "zod";

export type RazorpayResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "not_found" }
  /** Razorpay understood and said no (a 4xx other than 429). */
  | { kind: "refused"; status: number; code: string }
  /** No clear answer: a timeout, a network failure, a 429 or a 5xx. Try again later. */
  | { kind: "unavailable"; status: number | null };

export interface RazorpayApi {
  /** A subscription to one plan, created before the browser opens Razorpay's window. With
   *  `startAt` the mandate is taken now and the first payment on that day (the gym's own
   *  free trial); without it the first payment is taken as the window is paid. */
  createSubscription(input: {
    planId: string;
    startAt: Date | null;
    notes: Record<string, string>;
  }): Promise<RazorpayResult<RazorpaySubscription>>;
  getSubscription(id: string): Promise<RazorpayResult<RazorpaySubscription>>;
  /** Cancel at once: nothing more is charged. */
  cancelSubscriptionNow(id: string): Promise<RazorpayResult<RazorpaySubscription>>;
  /** A subscription's invoices, the first page (Razorpay's default count, 10, raised to 100). */
  listSubscriptionInvoices(subscriptionId: string): Promise<RazorpayResult<RazorpayInvoice[]>>;
  getPayment(id: string): Promise<RazorpayResult<RazorpayPayment>>;
  /** Refund a captured payment in full. */
  refundPayment(id: string, reason: string): Promise<RazorpayResult<null>>;
  getPlan(id: string): Promise<RazorpayResult<RazorpayPlan>>;
}

/** The catalogue calls `tools/razorpay-plans.ts` makes. */
export interface RazorpayCatalogueApi {
  listPlans(skip: number): Promise<RazorpayResult<RazorpayPlan[]>>;
  createPlan(input: { name: string; description: string; amountMinor: number; currency: string; notes: Record<string, string> }): Promise<RazorpayResult<RazorpayPlan>>;
}

export const RAZORPAY_TIMEOUT_MS = 10_000;
const BASE = "https://api.razorpay.com/v1";

/** How many months a subscription runs before Razorpay would end it: ten years. Razorpay
 *  needs a count; a gym cancels long before, and `completed` ends it like a cancel. */
export const RAZORPAY_TOTAL_COUNT = 120;

/** Razorpay answers an id that is not its own with a 400, not a 404 (seen on the test
 *  account, 2026-09-29: "The ID provided is invalid or could not be found." for a
 *  subscription, "The id provided does not exist" for a payment). Only the ids our own
 *  server stored are ever asked, so this is a lost or foreign id, never a bad request. */
const NOT_FOUND_WORDS = /could not be found|does not exist/i;

const refundSchema = z.object({ id: z.string().regex(/^rfnd_[A-Za-z0-9]{14}$/), entity: z.literal("refund") });

export function createRazorpayApi(opts: {
  keyId: string;
  keySecret: string;
  fetchImpl?: typeof fetch;
}): RazorpayApi & RazorpayCatalogueApi {
  const doFetch = opts.fetchImpl ?? fetch;
  const authorization = `Basic ${Buffer.from(`${opts.keyId}:${opts.keySecret}`).toString("base64")}`;

  async function call<T extends z.ZodTypeAny>(
    method: "GET" | "POST",
    path: string,
    schema: T,
    body?: unknown,
  ): Promise<RazorpayResult<z.infer<T>>> {
    let response: Response;
    try {
      response = await doFetch(`${BASE}${path}`, {
        method,
        headers: { Authorization: authorization, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(RAZORPAY_TIMEOUT_MS),
      });
    } catch {
      return { kind: "unavailable", status: null };
    }
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    if (response.status === 404) return { kind: "not_found" };
    if (response.status === 429 || response.status >= 500) return { kind: "unavailable", status: response.status };
    if (!response.ok) {
      const error = razorpayErrorSchema.safeParse(json);
      if (response.status === 400 && error.success && NOT_FOUND_WORDS.test(error.data.error.description ?? "")) {
        return { kind: "not_found" };
      }
      return { kind: "refused", status: response.status, code: error.success ? error.data.error.code : "unknown" };
    }
    const parsed = schema.safeParse(json);
    // A 2xx we cannot read is treated as no answer, never as a success.
    if (!parsed.success) return { kind: "unavailable", status: response.status };
    return { kind: "ok", value: parsed.data as z.infer<T> };
  }

  // Ids go into a path only in Razorpay's own shape.
  const subPath = (id: string) => (razorpaySubscriptionIdSchema.safeParse(id).success ? `/subscriptions/${id}` : null);
  const payPath = (id: string) => (razorpayPaymentIdSchema.safeParse(id).success ? `/payments/${id}` : null);

  return {
    async createSubscription(input) {
      if (!razorpayPlanIdSchema.safeParse(input.planId).success) return { kind: "not_found" };
      return await call("POST", "/subscriptions", razorpaySubscriptionSchema, {
        plan_id: input.planId,
        total_count: RAZORPAY_TOTAL_COUNT,
        quantity: 1,
        // Razorpay emails the payer about each charge and a failed one, with its own link.
        customer_notify: true,
        ...(input.startAt === null ? {} : { start_at: Math.ceil(input.startAt.getTime() / 1000) }),
        notes: input.notes,
      });
    },
    async getSubscription(id) {
      const path = subPath(id);
      if (path === null) return { kind: "not_found" };
      return await call("GET", path, razorpaySubscriptionSchema);
    },
    async cancelSubscriptionNow(id) {
      const path = subPath(id);
      if (path === null) return { kind: "not_found" };
      return await call("POST", `${path}/cancel`, razorpaySubscriptionSchema, { cancel_at_cycle_end: 0 });
    },
    async listSubscriptionInvoices(subscriptionId) {
      if (!razorpaySubscriptionIdSchema.safeParse(subscriptionId).success) return { kind: "not_found" };
      const query = new URLSearchParams({ subscription_id: subscriptionId, count: "100" });
      const listed = await call("GET", `/invoices?${query.toString()}`, razorpayInvoiceListSchema);
      return listed.kind === "ok" ? { kind: "ok", value: listed.value.items } : listed;
    },
    async getPayment(id) {
      const path = payPath(id);
      if (path === null) return { kind: "not_found" };
      return await call("GET", path, razorpayPaymentSchema);
    },
    async refundPayment(id, reason) {
      const path = payPath(id);
      if (path === null) return { kind: "not_found" };
      const made = await call("POST", `${path}/refund`, refundSchema, { notes: { reason } });
      return made.kind === "ok" ? { kind: "ok", value: null } : made;
    },
    async listPlans(skip) {
      const query = new URLSearchParams({ count: "100", skip: String(skip) });
      const listed = await call("GET", `/plans?${query.toString()}`, razorpayPlanListSchema);
      return listed.kind === "ok" ? { kind: "ok", value: listed.value.items } : listed;
    },
    async getPlan(id) {
      if (!razorpayPlanIdSchema.safeParse(id).success) return { kind: "not_found" };
      return await call("GET", `/plans/${id}`, razorpayPlanSchema);
    },
    async createPlan(input) {
      return await call("POST", "/plans", razorpayPlanSchema, {
        period: "monthly",
        interval: 1,
        item: { name: input.name, description: input.description, amount: input.amountMinor, currency: input.currency },
        notes: input.notes,
      });
    },
  };
}
