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
// 2026-10-20); PAYMENTS_READ reads it back and lets Square's card messages reach us.
import {
  squareCardAnswerSchema,
  squareCustomerAnswerSchema,
  squareErrorSchema,
  squareLocationsSchema,
  squareMerchantSchema,
  squareRevokeSchema,
  squareTokenSchema,
  squareTokenStatusSchema,
  type SquareCard,
  type SquareLocation,
  type SquareMerchant,
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
  /** No charge or update can reach the card after this; disabling one already disabled is
   *  allowed and changes nothing. */
  disableCard(accessToken: string, cardId: string): Promise<SquareResult<SquareCard>>;
  /** Stop the app's every token for this Square account, with our own secret: for the stop
   *  tool (`tools/square-stop.ts`), which works without the gym's token. */
  revokeAccount(accountId: string): Promise<SquareResult<null>>;
}

export interface NewSquareCustomer {
  idempotencyKey: string;
  givenName: string | null;
  familyName: string | null;
  email: string | null;
  phone: string | null;
  referenceId: string;
}

/** The path's own characters are the card id's (`squareCardIdSchema`), as Square writes them. */
const cardPath = (cardId: string): string => {
  if (!/^[A-Za-z0-9:_-]{1,192}$/.test(cardId)) throw new Error("not a Square card id");
  return `/v2/cards/${cardId}`;
};

export const SQUARE_SCOPES = ["MERCHANT_PROFILE_READ", "CUSTOMERS_READ", "CUSTOMERS_WRITE", "PAYMENTS_READ", "PAYMENTS_WRITE"] as const;
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

  async function call<T extends z.ZodTypeAny>(
    method: "GET" | "POST",
    path: string,
    schema: T,
    authorization: string | null,
    body?: unknown,
  ): Promise<SquareResult<z.infer<T>>> {
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Square-Version": SQUARE_VERSION,
          ...(authorization === null ? {} : { Authorization: authorization }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(SQUARE_TIMEOUT_MS),
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
    if (response.status === 429 || response.status >= 500) return { kind: "unavailable", status: response.status };
    if (!response.ok) {
      const error = squareErrorSchema.safeParse(json);
      const code = error.success ? (error.data.errors?.[0]?.code ?? error.data.type ?? "unknown") : "unknown";
      return { kind: "refused", status: response.status, code };
    }
    const parsed = schema.safeParse(json);
    // A 2xx we cannot read is treated as no answer, never as a success.
    if (!parsed.success) return { kind: "unavailable", status: response.status };
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
      return result.kind === "ok" ? { kind: "ok", value: result.value.customer } : result;
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
    async disableCard(accessToken, cardId) {
      const result = await call("POST", `${cardPath(cardId)}/disable`, squareCardAnswerSchema, bearer(accessToken), {});
      return result.kind === "ok" ? { kind: "ok", value: result.value.card } : result;
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
