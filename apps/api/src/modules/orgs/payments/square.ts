// The calls our server makes to Square (developer.squareup.com, read 2026-10-19: "OAuth
// API", "Refresh, Revoke, and Limit the Scope of OAuth Tokens", "Merchants API", "Locations
// API"; Square-Version 2026-09-16). Every reply is parsed through `@app/shared` before
// anything reads it, and no token, secret or body is ever logged or returned. Square's SDK is
// not used: these are a few plain requests, and Square's types stay inside this file.
//
// A gym approves, once, everything the four Square jobs need (ROADMAP 18d-i to 18d-iv): its
// business and locations, its customers and saved cards, and taking and refunding payments.
// Nothing asks for a fee of its own: we take none (RULINGS 2026-09-22). A saved card (18d-ii)
// uses CUSTOMERS_WRITE for the person and PAYMENTS_WRITE for the card ("Cards API", read
// 2026-10-20); PAYMENTS_READ reads it back and lets Square's card messages reach us. A Square
// Terminal (18d-ii-b) is paired with DEVICE_CREDENTIAL_MANAGEMENT ("Connect a Square Terminal
// to a POS Application", read 2026-10-21), and saves a card with PAYMENTS_WRITE_IN_PERSON: its
// test area left a save "in progress" for 512 seconds without it, and saved one in 2 with it
// (measured 2026-10-21). Save card on Terminal (18d-ii-b-ii) sends two Terminal actions with
// those: CONFIRMATION, the gym's agreement, then SAVE_CARD. Take payment on Terminal (18d-vi-a)
// sends a Terminal checkout with PAYMENTS_WRITE_IN_PERSON and reads its payment with
// PAYMENTS_READ ("Terminal API", "Payments API", read 2026-10-22). Whether Square's own subscriptions
// charge a customer is read with SUBSCRIPTIONS_READ ("Search subscriptions", read 2026-10-26), never
// changed: Delete permanently keeps such a customer. Payments taken in Square's own app (18d-iii-b-i to
// 18d-iii-b-ii-c) were taken out with Square Point of Sale (18d-iii-b-v, Kd, 2026-10-30), and with them
// ORDERS_READ and ITEMS_READ. Refund to card (18d-iv-a) uses PAYMENTS_WRITE and reads with PAYMENTS_READ
// ("Refund Payments", Square's API definition, read 2026-10-30): no new permission.
import {
  squareCardAnswerSchema,
  squareCustomerAnswerSchema,
  squareCustomerSchema,
  squareCustomersPageSchema,
  squareDeviceCodeAnswerSchema,
  squareErrorSchema,
  squareLocationsSchema,
  squareMerchantSchema,
  squarePaymentAnswerSchema,
  squarePaymentSchema,
  squarePaymentsPageSchema,
  squarePaymentRefusalSchema,
  squareDisputeAnswerSchema,
  squareDisputeSchema,
  squareDisputesPageSchema,
  squareRefundAnswerSchema,
  squareTerminalRefundAnswerSchema,
  squareEmptyAnswerSchema,
  squareRevokeSchema,
  squareRefundSchema,
  squareRefundsPageSchema,
  squareSubscriptionSchema,
  squareSubscriptionsPageSchema,
  squareTerminalActionAnswerSchema,
  squareTerminalCheckoutAnswerSchema,
  squareTokenSchema,
  squareTokenStatusSchema,
  type SquareCard,
  type SquareCustomer,
  type SquareCustomerFound,
  type SquareDeviceCode,
  type SquareLocation,
  type SquareMerchant,
  type SquarePayment,
  type SquareDispute,
  type SquareRefund,
  type SquareTerminalAction,
  type SquareTerminalCheckout,
  type SquareTerminalRefund,
  type SquareToken,
  type SquareTokenStatus,
} from "@app/shared";
import type { z } from "zod";

export type SquareEnvironment = "sandbox" | "production";

export type SquareResult<T> =
  | { kind: "ok"; value: T }
  /** Square understood and said no: a 4xx other than 429. 401 is a token that no longer works. */
  | { kind: "refused"; status: number; code: string }
  /** No clear answer: a timeout, a network failure, a 429 or a 5xx. Try again later. */
  | { kind: "unavailable"; status: number | null };

export interface SquareApi {
  /** Square's own page, where the gym signs in and presses Allow. */
  authorizeUrl(state: string): string;
  exchangeCode(code: string): Promise<SquareResult<SquareToken>>;
  refresh(refreshToken: string): Promise<SquareResult<SquareToken>>;
  /** `wholeAccount` false stops this one token and leaves the account's other tokens working. */
  revoke(accessToken: string, wholeAccount: boolean): Promise<SquareResult<null>>;
  tokenStatus(accessToken: string): Promise<SquareResult<SquareTokenStatus>>;
  merchant(accessToken: string): Promise<SquareResult<SquareMerchant>>;
  locations(accessToken: string): Promise<SquareResult<SquareLocation[]>>;
  /** The gym's customer for a person on its list (18d-ii): at least one of the names, the
   *  email or the phone. `referenceId` is the record's id, so the gym's Square customer can be
   *  matched to it. */
  createCustomer(accessToken: string, customer: NewSquareCustomer): Promise<SquareResult<{ id: string }>>;
  /** Save the card Square's form tokenised (`sourceId`) on that customer. `idempotencyKey`:
   *  the same press sent twice gives back the same card. */
  createCard(accessToken: string, card: { idempotencyKey: string; sourceId: string; customerId: string; cardholderName: string | null }): Promise<SquareResult<SquareCard>>;
  retrieveCard(accessToken: string, cardId: string): Promise<SquareResult<SquareCard>>;
  /** 404 is a customer the gym deleted inside Square. An old id of a merged customer answers the merged one. */
  retrieveCustomer(accessToken: string, customerId: string): Promise<SquareResult<SquareCustomer>>;
  /** Delete a customer for good (18d-iii-b-ii-b-ii-b-ii). Square refuses (409 CONFLICT) a `version` that is not the customer's
   *  current one, answers 404 for one already deleted, and answers 200 for the old id of a merged customer and leaves the
   *  merged customer alone (measured in its test area, 2026-10-28). A card saved on the customer stays on, and can still be
   *  stopped. */
  deleteCustomer(accessToken: string, customerId: string, version: number | null): Promise<SquareResult<null>>;
  /** No charge or update can reach the card after this; disabling one already disabled is
   *  allowed and changes nothing. */
  disableCard(accessToken: string, cardId: string): Promise<SquareResult<SquareCard>>;
  /** Stop the app's every token for this Square account, with our own secret: for the stop
   *  tool (`tools/square-stop.ts`), which works without the gym's token. */
  revokeAccount(accountId: string): Promise<SquareResult<null>>;
  /** A code a Square Terminal signs in with, at this location, for five minutes. `name` is
   *  what the gym's Square Dashboard lists the code as. */
  createDeviceCode(accessToken: string, code: { idempotencyKey: string; name: string; locationId: string }): Promise<SquareResult<SquareDeviceCode>>;
  /** A code past its `pair_by` reads EXPIRED (Square's sandbox, 30 and 90 s after, measured
   *  2026-10-21). Square's page says a code that ran out is no longer returned; a 404 is taken
   *  as run out too, which only asks the owner for a new code. */
  retrieveDeviceCode(accessToken: string, deviceCodeId: string): Promise<SquareResult<SquareDeviceCode>>;
  /** An action on a paired Terminal. `idempotencyKey`: asked again, Square gives back the same
   *  action. */
  createTerminalAction(accessToken: string, action: NewTerminalAction): Promise<SquareResult<SquareTerminalAction>>;
  getTerminalAction(accessToken: string, actionId: string): Promise<SquareResult<SquareTerminalAction>>;
  /** Square stops an action still pending or in progress; a SAVE_CARD only until the person
   *  confirms their email on the Terminal. */
  cancelTerminalAction(accessToken: string, actionId: string): Promise<SquareResult<SquareTerminalAction>>;
  /** The amount on a paired Terminal, for the person to pay by card. `idempotencyKey`: asked
   *  again, Square gives back the same checkout. */
  createTerminalCheckout(accessToken: string, checkout: NewTerminalCheckout): Promise<SquareResult<SquareTerminalCheckout>>;
  getTerminalCheckout(accessToken: string, checkoutId: string): Promise<SquareResult<SquareTerminalCheckout>>;
  /** Square stops a checkout still pending or in progress; one paid already is refused (400). */
  cancelTerminalCheckout(accessToken: string, checkoutId: string): Promise<SquareResult<SquareTerminalCheckout>>;
  getPayment(accessToken: string, paymentId: string): Promise<SquareResult<SquarePayment>>;
  /** One page of the location's payments Square made from `beginTime` to `endTime`, oldest first
   *  (18d-iii-b-i). `unread`: how many on the page could not be read; each is skipped. */
  listPayments(accessToken: string, q: PaymentsQuery): Promise<SquareResult<{ payments: SquarePayment[]; unread: number; cursor: string | null }>>;
  /** The business's customers with exactly this email, this phone (E.164), or this reference id (the
   *  record's, on a customer the app made), up to 100: Square folds both sides of a phone to its digits
   *  ("Search customers", read 2026-10-26). */
  searchCustomers(accessToken: string, by: { email: string } | { phone: string } | { referenceId: string }): Promise<SquareResult<{ customers: SquareCustomerFound[]; unread: number }>>;
  /** One page of Square's own subscriptions of these customers (at most 100 ids). */
  searchSubscriptions(
    accessToken: string,
    q: { customerIds: readonly string[]; cursor: string | null },
  ): Promise<SquareResult<{ subscriptions: { customerId: string | null; status: string | null }[]; cursor: string | null; unread: number }>>;
  /** Charge a card on file (18d-iii-i). `idempotencyKey`: asked again, Square gives back the same
   *  payment, paid or failed, and never takes the money twice (measured 2026-10-23). */
  createCardPayment(accessToken: string, payment: NewCardPayment): Promise<CardPaymentResult>;
  /** Give money back to the card that paid (18d-iv-a). `idempotencyKey`: asked again, Square gives back the same refund;
   *  the same key with another amount is refused (CONFLICTING_PARAMETERS) (measured 2026-10-30). */
  refundPayment(accessToken: string, refund: NewCardRefund): Promise<SquareResult<SquareRefund>>;
  getRefund(accessToken: string, refundId: string): Promise<SquareResult<SquareRefund>>;
  /** A chargeback (18d-iv-e-i): both need DISPUTES_READ. */
  getDispute(accessToken: string, disputeId: string): Promise<SquareResult<SquareDispute>>;
  listDisputes(accessToken: string, q: { cursor: string | null }): Promise<SquareResult<{ disputes: SquareDispute[]; unread: number; cursor: string | null }>>;
  /** One page of the business's refunds from `beginTime`, oldest first, at every location (18d-iv-d-i). `unread`: how many could not be read. */
  listRefunds(accessToken: string, q: { beginTime: Date; cursor: string | null }): Promise<SquareResult<{ refunds: SquareRefund[]; unread: number; cursor: string | null }>>;
  /** Give money back on the Terminal, for a payment Square marks as needing the card present (18d-iv-c). `idempotencyKey`:
   *  asked again, Square gives back the same request. */
  createTerminalRefund(accessToken: string, refund: NewTerminalRefund): Promise<SquareResult<SquareTerminalRefund>>;
  getTerminalRefund(accessToken: string, terminalRefundId: string): Promise<SquareResult<SquareTerminalRefund>>;
  /** Square cancels only while the Terminal has not started it ("as long as the status of the request is `PENDING`"). */
  cancelTerminalRefund(accessToken: string, terminalRefundId: string): Promise<SquareResult<SquareTerminalRefund>>;
}

/** `deadline`: at most five minutes, Square's own limit. `reason` as a card refund's. */
export interface NewTerminalRefund {
  idempotencyKey: string;
  deviceId: string;
  paymentId: string;
  amountMinor: number;
  currency: string;
  reason: string;
  deadline: string;
}

/** `reason`: what Square's Dashboard lists the refund as: a word from the gym's list, never a person. */
export interface NewCardRefund {
  idempotencyKey: string;
  paymentId: string;
  amountMinor: number;
  currency: string;
  reason: string;
}

/** ListPayments' question: one location, by when Square made the payment, oldest first. */
export interface PaymentsQuery {
  locationId: string;
  beginTime: Date;
  endTime: Date;
  cursor: string | null;
}

/** `referenceId`: our charge, never the person. `note`: what the gym's Square Dashboard lists the
 *  payment as. Completed at once: no hold to capture later. */
export interface NewCardPayment {
  idempotencyKey: string;
  cardId: string;
  customerId: string;
  amountMinor: number;
  currency: string;
  locationId: string;
  referenceId: string;
  note: string;
}

/** CreatePayment's answer: `declined` is the card's bank saying no, with Square's code and the
 *  FAILED payment Square kept; `refused` is Square refusing the request itself. */
export type CardPaymentResult =
  | { kind: "ok"; value: SquarePayment }
  | { kind: "declined"; status: number; code: string; payment: SquarePayment | null }
  | { kind: "refused"; status: number; code: string }
  | { kind: "unavailable"; status: number | null };

/** `referenceId`: our own press, never the person. `note`: what Square's Dashboard lists the
 *  payment as. No tip screen and no Square receipt screen: the gym's receipt is ours. */
export interface NewTerminalCheckout {
  idempotencyKey: string;
  deviceId: string;
  amountMinor: number;
  currency: string;
  referenceId: string;
  note: string;
  deadline: string;
}

/** CONFIRMATION shows `title`, `body` and two buttons, and keeps the Terminal waiting
 *  `awaitNext` for the next action instead of going back to its idle screen; SAVE_CARD saves the
 *  card inserted or swiped on `customerId`. `deadline`: Square cancels it after this (at most
 *  five minutes). Durations are RFC 3339 ("PT5M"). */
export type NewTerminalAction =
  | { idempotencyKey: string; deviceId: string; deadline: string; type: "CONFIRMATION"; title: string; body: string; agree: string; disagree: string; awaitNext: string }
  | { idempotencyKey: string; deviceId: string; deadline: string; type: "SAVE_CARD"; customerId: string; referenceId: string };

export interface NewSquareCustomer {
  idempotencyKey: string;
  givenName: string | null;
  familyName: string | null;
  email: string | null;
  phone: string | null;
  referenceId: string;
}


/** Each customer on a page read on its own, so one that cannot be read never hides the rest. */
function readCustomers(raw: readonly unknown[] | null | undefined): { customers: SquareCustomerFound[]; unread: number } {
  const customers: SquareCustomerFound[] = [];
  let unread = 0;
  for (const one of raw ?? []) {
    const parsed = squareCustomerSchema.safeParse(one);
    if (parsed.success) customers.push(parsed.data);
    else unread += 1;
  }
  return { customers, unread };
}

/** The path's own characters are the card id's (`squareCardIdSchema`), as Square writes them. */
const cardPath = (cardId: string): string => {
  if (!/^[A-Za-z0-9:_-]{1,192}$/.test(cardId)) throw new Error("not a Square card id");
  return `/v2/cards/${cardId}`;
};

/** The same for a Terminal action's id (`squareTerminalActionIdSchema`). */
const actionPath = (actionId: string): string => {
  if (!/^[A-Za-z0-9:_-]{1,255}$/.test(actionId)) throw new Error("not a Square Terminal action id");
  return `/v2/terminals/actions/${actionId}`;
};

/** The same for a Terminal checkout's id and a payment's id. */
const checkoutPath = (checkoutId: string): string => {
  if (!/^[A-Za-z0-9:_-]{1,255}$/.test(checkoutId)) throw new Error("not a Square Terminal checkout id");
  return `/v2/terminals/checkouts/${checkoutId}`;
};
const terminalRefundPath = (terminalRefundId: string): string => {
  if (!/^[A-Za-z0-9:_-]{1,255}$/.test(terminalRefundId)) throw new Error("not a Square Terminal refund id");
  return `/v2/terminals/refunds/${terminalRefundId}`;
};
const paymentPath = (paymentId: string): string => {
  if (!/^[A-Za-z0-9_-]{1,192}$/.test(paymentId)) throw new Error("not a Square payment id");
  return `/v2/payments/${paymentId}`;
};

/** The same for a refund's id (`squareRefundIdSchema`). */
const refundPath = (refundId: string): string => {
  if (!/^[A-Za-z0-9_-]{1,255}$/.test(refundId)) throw new Error("not a Square refund id");
  return `/v2/refunds/${refundId}`;
};

export const SQUARE_SCOPES = [
  "MERCHANT_PROFILE_READ",
  "CUSTOMERS_READ",
  "CUSTOMERS_WRITE",
  "PAYMENTS_READ",
  "PAYMENTS_WRITE",
  "PAYMENTS_WRITE_IN_PERSON",
  "DEVICE_CREDENTIAL_MANAGEMENT",
  "SUBSCRIPTIONS_READ",
  "DISPUTES_READ",
] as const;
export const SQUARE_VERSION = "2026-09-16";
export const SQUARE_TIMEOUT_MS = 10_000;

export function squareBaseUrl(environment: SquareEnvironment): string {
  return environment === "sandbox" ? "https://connect.squareupsandbox.com" : "https://connect.squareup.com";
}

export function createSquareApi(opts: {
  applicationId: string;
  applicationSecret: string;
  environment: SquareEnvironment;
  fetchImpl?: typeof fetch;
}): SquareApi {
  const doFetch = opts.fetchImpl ?? fetch;
  const base = squareBaseUrl(opts.environment);

  /** Square's status and body, or null for no answer at all. */
  async function send(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    authorization: string | null,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; ok: boolean; json: unknown } | null> {
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Square-Version": SQUARE_VERSION,
          ...(authorization === null ? {} : { Authorization: authorization }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(SQUARE_TIMEOUT_MS),
      });
    } catch {
      return null;
    }
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    return { status: response.status, ok: response.ok, json };
  }

  async function call<T extends z.ZodTypeAny>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    schema: T,
    authorization: string | null,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<SquareResult<z.infer<T>>> {
    const sent = await send(method, path, authorization, body, headers);
    if (sent === null) return { kind: "unavailable", status: null };
    if (sent.status === 429 || sent.status >= 500) return { kind: "unavailable", status: sent.status };
    if (!sent.ok) {
      const error = squareErrorSchema.safeParse(sent.json);
      const code = error.success ? (error.data.errors?.[0]?.code ?? error.data.type ?? "unknown") : "unknown";
      return { kind: "refused", status: sent.status, code };
    }
    const parsed = schema.safeParse(sent.json);
    // A 2xx we cannot read is treated as no answer, never as a success.
    if (!parsed.success) return { kind: "unavailable", status: sent.status };
    return { kind: "ok", value: parsed.data as z.infer<T> };
  }

  const bearer = (token: string) => `Bearer ${token}`;

  return {
    authorizeUrl(state) {
      const query = new URLSearchParams({
        client_id: opts.applicationId,
        scope: SQUARE_SCOPES.join(" "),
        // Square asks for `false` in production: the person signs in at Square every time.
        session: "false",
        state,
      });
      return `${base}/oauth2/authorize?${query.toString()}`;
    },
    async exchangeCode(code) {
      return call("POST", "/oauth2/token", squareTokenSchema, null, {
        client_id: opts.applicationId,
        client_secret: opts.applicationSecret,
        grant_type: "authorization_code",
        code,
      });
    },
    async refresh(refreshToken) {
      return call("POST", "/oauth2/token", squareTokenSchema, null, {
        client_id: opts.applicationId,
        client_secret: opts.applicationSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      });
    },
    async revoke(accessToken, wholeAccount) {
      const result = await call("POST", "/oauth2/revoke", squareRevokeSchema, `Client ${opts.applicationSecret}`, {
        client_id: opts.applicationId,
        access_token: accessToken,
        revoke_only_access_token: !wholeAccount,
      });
      if (result.kind !== "ok") return result;
      return result.value.success ? { kind: "ok", value: null } : { kind: "unavailable", status: 200 };
    },
    async tokenStatus(accessToken) {
      return call("POST", "/oauth2/token/status", squareTokenStatusSchema, bearer(accessToken));
    },
    async merchant(accessToken) {
      const result = await call("GET", "/v2/merchants/me", squareMerchantSchema, bearer(accessToken));
      return result.kind === "ok" ? { kind: "ok", value: result.value.merchant } : result;
    },
    async locations(accessToken) {
      const result = await call("GET", "/v2/locations", squareLocationsSchema, bearer(accessToken));
      return result.kind === "ok" ? { kind: "ok", value: result.value.locations ?? [] } : result;
    },
    async createCustomer(accessToken, c) {
      const result = await call("POST", "/v2/customers", squareCustomerAnswerSchema, bearer(accessToken), {
        idempotency_key: c.idempotencyKey,
        ...(c.givenName === null ? {} : { given_name: c.givenName }),
        ...(c.familyName === null ? {} : { family_name: c.familyName }),
        ...(c.email === null ? {} : { email_address: c.email }),
        ...(c.phone === null ? {} : { phone_number: c.phone }),
        reference_id: c.referenceId,
      });
      // Only the new customer's id is read back: what the gym sent is already the record's.
      return result.kind === "ok" ? { kind: "ok", value: { id: result.value.customer.id } } : result;
    },
    async searchCustomers(accessToken, by) {
      const filter =
        "email" in by ? { email_address: { exact: by.email } } : "phone" in by ? { phone_number: { exact: by.phone } } : { reference_id: { exact: by.referenceId } };
      const result = await call("POST", "/v2/customers/search", squareCustomersPageSchema, bearer(accessToken), { limit: 100, query: { filter } });
      if (result.kind !== "ok") return result;
      return { kind: "ok", value: readCustomers(result.value.customers) };
    },
    async searchSubscriptions(accessToken, q) {
      if (q.customerIds.length === 0 || q.customerIds.length > 100) throw new Error("between 1 and 100 customers a search");
      const result = await call("POST", "/v2/subscriptions/search", squareSubscriptionsPageSchema, bearer(accessToken), {
        limit: 100,
        query: { filter: { customer_ids: [...q.customerIds] } },
        ...(q.cursor === null ? {} : { cursor: q.cursor }),
      });
      if (result.kind !== "ok") return result;
      const subscriptions: { customerId: string | null; status: string | null }[] = [];
      let unread = 0;
      for (const raw of result.value.subscriptions ?? []) {
        const one = squareSubscriptionSchema.safeParse(raw);
        // One that cannot be read says nothing about anybody: `unread` says how many, for a reader that must not guess
        // (Delete permanently).
        if (one.success) subscriptions.push({ customerId: one.data.customer_id ?? null, status: one.data.status ?? null });
        else unread += 1;
      }
      return { kind: "ok", value: { subscriptions, cursor: result.value.cursor ?? null, unread } };
    },
    async createCard(accessToken, c) {
      const result = await call("POST", "/v2/cards", squareCardAnswerSchema, bearer(accessToken), {
        idempotency_key: c.idempotencyKey,
        source_id: c.sourceId,
        card: { customer_id: c.customerId, ...(c.cardholderName === null ? {} : { cardholder_name: c.cardholderName }) },
      });
      return result.kind === "ok" ? { kind: "ok", value: result.value.card } : result;
    },
    async retrieveCard(accessToken, cardId) {
      const result = await call("GET", cardPath(cardId), squareCardAnswerSchema, bearer(accessToken));
      return result.kind === "ok" ? { kind: "ok", value: result.value.card } : result;
    },
    async retrieveCustomer(accessToken, customerId) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(customerId)) throw new Error("not a Square customer id");
      const result = await call("GET", `/v2/customers/${customerId}`, squareCustomerAnswerSchema, bearer(accessToken));
      return result.kind === "ok" ? { kind: "ok", value: result.value.customer } : result;
    },
    async deleteCustomer(accessToken, customerId, version) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(customerId)) throw new Error("not a Square customer id");
      const query = version === null ? "" : `?version=${String(version)}`;
      const result = await call("DELETE", `/v2/customers/${customerId}${query}`, squareEmptyAnswerSchema, bearer(accessToken));
      return result.kind === "ok" ? { kind: "ok", value: null } : result;
    },
    async disableCard(accessToken, cardId) {
      const result = await call("POST", `${cardPath(cardId)}/disable`, squareCardAnswerSchema, bearer(accessToken), {});
      return result.kind === "ok" ? { kind: "ok", value: result.value.card } : result;
    },
    async createDeviceCode(accessToken, c) {
      const result = await call("POST", "/v2/devices/codes", squareDeviceCodeAnswerSchema, bearer(accessToken), {
        idempotency_key: c.idempotencyKey,
        device_code: { name: c.name, product_type: "TERMINAL_API", location_id: c.locationId },
      });
      return result.kind === "ok" ? { kind: "ok", value: result.value.device_code } : result;
    },
    async retrieveDeviceCode(accessToken, deviceCodeId) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(deviceCodeId)) throw new Error("not a Square device code id");
      const result = await call("GET", `/v2/devices/codes/${deviceCodeId}`, squareDeviceCodeAnswerSchema, bearer(accessToken));
      return result.kind === "ok" ? { kind: "ok", value: result.value.device_code } : result;
    },
    async createTerminalAction(accessToken, a) {
      const options =
        a.type === "CONFIRMATION"
          ? {
              await_next_action: true,
              await_next_action_duration: a.awaitNext,
              confirmation_options: { title: a.title, body: a.body, agree_button_text: a.agree, disagree_button_text: a.disagree },
            }
          : { save_card_options: { customer_id: a.customerId, reference_id: a.referenceId } };
      const result = await call("POST", "/v2/terminals/actions", squareTerminalActionAnswerSchema, bearer(accessToken), {
        idempotency_key: a.idempotencyKey,
        action: { device_id: a.deviceId, type: a.type, deadline_duration: a.deadline, ...options },
      });
      return result.kind === "ok" ? { kind: "ok", value: result.value.action } : result;
    },
    async getTerminalAction(accessToken, actionId) {
      const result = await call("GET", actionPath(actionId), squareTerminalActionAnswerSchema, bearer(accessToken));
      return result.kind === "ok" ? { kind: "ok", value: result.value.action } : result;
    },
    async cancelTerminalAction(accessToken, actionId) {
      const result = await call("POST", `${actionPath(actionId)}/cancel`, squareTerminalActionAnswerSchema, bearer(accessToken), {});
      return result.kind === "ok" ? { kind: "ok", value: result.value.action } : result;
    },
    async createTerminalCheckout(accessToken, c) {
      const result = await call("POST", "/v2/terminals/checkouts", squareTerminalCheckoutAnswerSchema, bearer(accessToken), {
        idempotency_key: c.idempotencyKey,
        checkout: {
          amount_money: { amount: c.amountMinor, currency: c.currency },
          reference_id: c.referenceId,
          note: c.note,
          deadline_duration: c.deadline,
          device_options: { device_id: c.deviceId, skip_receipt_screen: true, tip_settings: { allow_tipping: false } },
        },
      });
      return result.kind === "ok" ? { kind: "ok", value: result.value.checkout } : result;
    },
    async getTerminalCheckout(accessToken, checkoutId) {
      const result = await call("GET", checkoutPath(checkoutId), squareTerminalCheckoutAnswerSchema, bearer(accessToken));
      return result.kind === "ok" ? { kind: "ok", value: result.value.checkout } : result;
    },
    async cancelTerminalCheckout(accessToken, checkoutId) {
      const result = await call("POST", `${checkoutPath(checkoutId)}/cancel`, squareTerminalCheckoutAnswerSchema, bearer(accessToken), {});
      return result.kind === "ok" ? { kind: "ok", value: result.value.checkout } : result;
    },
    async getPayment(accessToken, paymentId) {
      const result = await call("GET", paymentPath(paymentId), squarePaymentAnswerSchema, bearer(accessToken));
      return result.kind === "ok" ? { kind: "ok", value: result.value.payment } : result;
    },
    async listPayments(accessToken, q) {
      const query = new URLSearchParams({
        location_id: q.locationId,
        begin_time: q.beginTime.toISOString(),
        end_time: q.endTime.toISOString(),
        sort_order: "ASC",
        limit: "100",
        ...(q.cursor === null ? {} : { cursor: q.cursor }),
      });
      const result = await call("GET", `/v2/payments?${query.toString()}`, squarePaymentsPageSchema, bearer(accessToken));
      if (result.kind !== "ok") return result;
      const payments: SquarePayment[] = [];
      let unread = 0;
      for (const raw of result.value.payments ?? []) {
        const one = squarePaymentSchema.safeParse(raw);
        if (one.success) payments.push(one.data);
        else unread += 1;
      }
      return { kind: "ok", value: { payments, unread, cursor: result.value.cursor ?? null } };
    },
    async createCardPayment(accessToken, p) {
      const sent = await send("POST", "/v2/payments", bearer(accessToken), {
        idempotency_key: p.idempotencyKey,
        source_id: p.cardId,
        customer_id: p.customerId,
        amount_money: { amount: p.amountMinor, currency: p.currency },
        autocomplete: true,
        location_id: p.locationId,
        reference_id: p.referenceId,
        note: p.note,
      });
      if (sent === null) return { kind: "unavailable", status: null };
      if (sent.status === 429 || sent.status >= 500) return { kind: "unavailable", status: sent.status };
      if (sent.ok) {
        const parsed = squarePaymentAnswerSchema.safeParse(sent.json);
        // A 2xx we cannot read is no answer, never a success.
        return parsed.success ? { kind: "ok", value: parsed.data.payment } : { kind: "unavailable", status: sent.status };
      }
      const refusal = squarePaymentRefusalSchema.safeParse(sent.json);
      const first = refusal.success ? refusal.data.errors?.[0] : undefined;
      const code = first?.code ?? "unknown";
      const payment = refusal.success ? (refusal.data.payment ?? null) : null;
      // The card's bank said no: Square names it a payment method error and keeps the FAILED payment.
      if (first?.category === "PAYMENT_METHOD_ERROR" || payment?.status === "FAILED") return { kind: "declined", status: sent.status, code, payment };
      return { kind: "refused", status: sent.status, code };
    },
    async refundPayment(accessToken, r) {
      const result = await call("POST", "/v2/refunds", squareRefundAnswerSchema, bearer(accessToken), {
        idempotency_key: r.idempotencyKey,
        payment_id: r.paymentId,
        amount_money: { amount: r.amountMinor, currency: r.currency },
        reason: r.reason,
      });
      return result.kind === "ok" ? { kind: "ok", value: result.value.refund } : result;
    },
    async getRefund(accessToken, refundId) {
      const result = await call("GET", refundPath(refundId), squareRefundAnswerSchema, bearer(accessToken));
      return result.kind === "ok" ? { kind: "ok", value: result.value.refund } : result;
    },
    async getDispute(accessToken, disputeId) {
      if (!/^[A-Za-z0-9_-]{1,255}$/.test(disputeId)) throw new Error("not a Square dispute id");
      const result = await call("GET", `/v2/disputes/${disputeId}`, squareDisputeAnswerSchema, bearer(accessToken));
      return result.kind === "ok" ? { kind: "ok", value: result.value.dispute } : result;
    },
    async listDisputes(accessToken, q) {
      const query = q.cursor === null ? "" : `?${new URLSearchParams({ cursor: q.cursor }).toString()}`;
      const result = await call("GET", `/v2/disputes${query}`, squareDisputesPageSchema, bearer(accessToken));
      if (result.kind !== "ok") return result;
      const disputes: SquareDispute[] = [];
      let unread = 0;
      for (const raw of result.value.disputes ?? []) {
        const one = squareDisputeSchema.safeParse(raw);
        if (one.success) disputes.push(one.data);
        else unread += 1;
      }
      return { kind: "ok", value: { disputes, unread, cursor: result.value.cursor ?? null } };
    },
    async listRefunds(accessToken, q) {
      const query = new URLSearchParams({ begin_time: q.beginTime.toISOString(), sort_order: "ASC", limit: "100", ...(q.cursor === null ? {} : { cursor: q.cursor }) });
      const result = await call("GET", `/v2/refunds?${query.toString()}`, squareRefundsPageSchema, bearer(accessToken));
      if (result.kind !== "ok") return result;
      const refunds: SquareRefund[] = [];
      let unread = 0;
      for (const raw of result.value.refunds ?? []) {
        const one = squareRefundSchema.safeParse(raw);
        if (one.success) refunds.push(one.data);
        else unread += 1;
      }
      return { kind: "ok", value: { refunds, unread, cursor: result.value.cursor ?? null } };
    },
    async createTerminalRefund(accessToken, r) {
      const result = await call("POST", "/v2/terminals/refunds", squareTerminalRefundAnswerSchema, bearer(accessToken), {
        idempotency_key: r.idempotencyKey,
        refund: {
          payment_id: r.paymentId,
          amount_money: { amount: r.amountMinor, currency: r.currency },
          device_id: r.deviceId,
          reason: r.reason,
          deadline_duration: r.deadline,
        },
      });
      return result.kind === "ok" ? { kind: "ok", value: result.value.refund } : result;
    },
    async getTerminalRefund(accessToken, terminalRefundId) {
      const result = await call("GET", terminalRefundPath(terminalRefundId), squareTerminalRefundAnswerSchema, bearer(accessToken));
      return result.kind === "ok" ? { kind: "ok", value: result.value.refund } : result;
    },
    async cancelTerminalRefund(accessToken, terminalRefundId) {
      const result = await call("POST", `${terminalRefundPath(terminalRefundId)}/cancel`, squareTerminalRefundAnswerSchema, bearer(accessToken), {});
      return result.kind === "ok" ? { kind: "ok", value: result.value.refund } : result;
    },
    async revokeAccount(accountId) {
      const result = await call("POST", "/oauth2/revoke", squareRevokeSchema, `Client ${opts.applicationSecret}`, {
        client_id: opts.applicationId,
        merchant_id: accountId,
      });
      if (result.kind !== "ok") return result;
      return result.value.success ? { kind: "ok", value: null } : { kind: "unavailable", status: 200 };
    },
  };
}
