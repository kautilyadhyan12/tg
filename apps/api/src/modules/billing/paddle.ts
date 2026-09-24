// The calls our server makes to Paddle's API (developer.paddle.com, API version 1, read
// 2026-09-24). Every reply is parsed through `@app/shared` before anything reads it, and
// no body, key or customer detail is ever logged or returned. Paddle's SDK is not used:
// these are a few plain requests, and Paddle's types stay inside this file.
import {
  paddleAdjustmentSchema,
  paddleEnvelope,
  paddleErrorSchema,
  paddleListEnvelope,
  paddlePriceSchema,
  paddleProductSchema,
  paddleSubscriptionIdSchema,
  paddleSubscriptionSchema,
  paddleTransactionIdSchema,
  paddleTransactionSchema,
  type PaddlePrice,
  type PaddleSubscription,
  type PaddleTransaction,
} from "@app/shared";
import type { z } from "zod";

export type PaddleEnvironment = "sandbox" | "production";

export type PaddleResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "not_found" }
  /** Paddle understood and said no (a 4xx other than 404 and 429). */
  | { kind: "refused"; status: number; code: string }
  /** No clear answer: a timeout, a network failure, a 429 or a 5xx. Try again later. */
  | { kind: "unavailable"; status: number | null };

export interface PaddleApi {
  createTransaction(input: { priceId: string; customData: Record<string, string> }): Promise<PaddleResult<PaddleTransaction>>;
  getTransaction(id: string): Promise<PaddleResult<PaddleTransaction>>;
  cancelTransaction(id: string): Promise<PaddleResult<null>>;
  getSubscription(id: string): Promise<PaddleResult<PaddleSubscription>>;
  /** A subscription's transactions, oldest first (the first page: 30). */
  listSubscriptionTransactions(subscriptionId: string): Promise<PaddleResult<PaddleTransaction[]>>;
  cancelSubscriptionNow(id: string): Promise<PaddleResult<null>>;
  refundTransaction(id: string, reason: string): Promise<PaddleResult<null>>;
}

/** The catalogue calls `tools/paddle-prices.ts` makes. */
export interface PaddleCatalogueApi {
  getPrice(id: string): Promise<PaddleResult<PaddlePrice>>;
  createProduct(input: { name: string; description: string }): Promise<PaddleResult<{ id: string }>>;
  createPrice(input: {
    productId: string;
    description: string;
    name: string;
    amountMinor: number;
    currency: string;
    interval: "month" | "year";
    customData: Record<string, string>;
  }): Promise<PaddleResult<PaddlePrice>>;
}

export const PADDLE_TIMEOUT_MS = 10_000;

export function paddleBaseUrl(environment: PaddleEnvironment): string {
  return environment === "sandbox" ? "https://sandbox-api.paddle.com" : "https://api.paddle.com";
}

export function createPaddleApi(opts: {
  apiKey: string;
  environment: PaddleEnvironment;
  fetchImpl?: typeof fetch;
}): PaddleApi & PaddleCatalogueApi {
  const doFetch = opts.fetchImpl ?? fetch;
  const base = paddleBaseUrl(opts.environment);

  async function call<T extends z.ZodTypeAny>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    schema: T,
    body?: unknown,
  ): Promise<PaddleResult<z.infer<T>>> {
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          "Content-Type": "application/json",
          "Paddle-Version": "1",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(PADDLE_TIMEOUT_MS),
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
      const error = paddleErrorSchema.safeParse(json);
      return { kind: "refused", status: response.status, code: error.success ? error.data.error.code : "unknown" };
    }
    const parsed = schema.safeParse(json);
    // A 2xx we cannot read is treated as no answer, never as a success.
    if (!parsed.success) return { kind: "unavailable", status: response.status };
    return { kind: "ok", value: parsed.data as z.infer<T> };
  }

  const unwrap = <T>(result: PaddleResult<{ data: T }>): PaddleResult<T> =>
    result.kind === "ok" ? { kind: "ok", value: result.value.data } : result;
  const ignore = <T>(result: PaddleResult<T>): PaddleResult<null> => (result.kind === "ok" ? { kind: "ok", value: null } : result);

  // Ids go into a path only in Paddle's own shape.
  const txnPath = (id: string) => (paddleTransactionIdSchema.safeParse(id).success ? `/transactions/${id}` : null);
  const subPath = (id: string) => (paddleSubscriptionIdSchema.safeParse(id).success ? `/subscriptions/${id}` : null);

  return {
    async createTransaction(input) {
      return unwrap(
        await call("POST", "/transactions", paddleEnvelope(paddleTransactionSchema), {
          items: [{ price_id: input.priceId, quantity: 1 }],
          collection_mode: "automatic",
          custom_data: input.customData,
        }),
      );
    },
    async getTransaction(id) {
      const path = txnPath(id);
      if (path === null) return { kind: "not_found" };
      return unwrap(await call("GET", path, paddleEnvelope(paddleTransactionSchema)));
    },
    async cancelTransaction(id) {
      const path = txnPath(id);
      if (path === null) return { kind: "not_found" };
      return ignore(await call("PATCH", path, paddleEnvelope(paddleTransactionSchema), { status: "canceled" }));
    },
    async getSubscription(id) {
      const path = subPath(id);
      if (path === null) return { kind: "not_found" };
      return unwrap(await call("GET", path, paddleEnvelope(paddleSubscriptionSchema)));
    },
    async listSubscriptionTransactions(subscriptionId) {
      if (!paddleSubscriptionIdSchema.safeParse(subscriptionId).success) return { kind: "not_found" };
      const query = new URLSearchParams({ subscription_id: subscriptionId, order_by: "id[ASC]", per_page: "30" });
      return unwrap(await call("GET", `/transactions?${query.toString()}`, paddleListEnvelope(paddleTransactionSchema)));
    },
    async cancelSubscriptionNow(id) {
      const path = subPath(id);
      if (path === null) return { kind: "not_found" };
      return ignore(await call("POST", `${path}/cancel`, paddleEnvelope(paddleSubscriptionSchema), { effective_from: "immediately" }));
    },
    async refundTransaction(id, reason) {
      if (!paddleTransactionIdSchema.safeParse(id).success) return { kind: "not_found" };
      return ignore(
        await call("POST", "/adjustments", paddleEnvelope(paddleAdjustmentSchema), {
          action: "refund",
          type: "full",
          transaction_id: id,
          reason,
        }),
      );
    },
    async getPrice(id) {
      if (!/^pri_[a-z\d]{26}$/.test(id)) return { kind: "not_found" };
      return unwrap(await call("GET", `/prices/${id}`, paddleEnvelope(paddlePriceSchema)));
    },
    async createProduct(input) {
      return unwrap(
        await call("POST", "/products", paddleEnvelope(paddleProductSchema), {
          name: input.name,
          description: input.description,
          tax_category: "standard",
        }),
      );
    },
    async createPrice(input) {
      return unwrap(
        await call("POST", "/prices", paddleEnvelope(paddlePriceSchema), {
          product_id: input.productId,
          description: input.description,
          name: input.name,
          unit_price: { amount: String(input.amountMinor), currency_code: input.currency },
          billing_cycle: { interval: input.interval, frequency: 1 },
          // Tax is added on top where the law asks (Kd, RULINGS 2026-09-24).
          tax_mode: "external",
          quantity: { minimum: 1, maximum: 1 },
          custom_data: input.customData,
        }),
      );
    },
  };
}
