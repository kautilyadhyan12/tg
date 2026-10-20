// A member's card on file (ROADMAP 18d-ii): the calls made to Square for a person and a card,
// and the rule that turns Square's refusals into the screen's words, swept over every code in
// Square's own `ErrorCode` list (developer.squareup.com/reference/square/enums/ErrorCode, read
// 2026-10-20), not over the rule's own lists.
import { describe, expect, it } from "vitest";
import { MEMBER_CARD_WORDS } from "@app/shared";
import { cardRefusalOf } from "../src/modules/orgs/payments/cards.js";
import { createSquareApi } from "../src/modules/orgs/payments/square.js";

/** Square's whole list, in its own order, as its page printed it on 2026-10-20. */
const SQUARE_ERROR_CODES = `INTERNAL_SERVER_ERROR, UNAUTHORIZED, ACCESS_TOKEN_EXPIRED, ACCESS_TOKEN_REVOKED, CLIENT_DISABLED, FORBIDDEN, INSUFFICIENT_SCOPES, APPLICATION_DISABLED, V1_APPLICATION, V1_ACCESS_TOKEN, CARD_PROCESSING_NOT_ENABLED, MERCHANT_SUBSCRIPTION_NOT_FOUND, BAD_REQUEST, MISSING_REQUIRED_PARAMETER, INCORRECT_TYPE, INVALID_TIME, INVALID_TIME_RANGE, INVALID_VALUE, INVALID_CURSOR, UNKNOWN_QUERY_PARAMETER, CONFLICTING_PARAMETERS, EXPECTED_JSON_BODY, INVALID_SORT_ORDER, VALUE_REGEX_MISMATCH, VALUE_TOO_SHORT, VALUE_TOO_LONG, VALUE_TOO_LOW, VALUE_TOO_HIGH, VALUE_EMPTY, ARRAY_LENGTH_TOO_LONG, ARRAY_LENGTH_TOO_SHORT, ARRAY_EMPTY, EXPECTED_BOOLEAN, EXPECTED_INTEGER, EXPECTED_FLOAT, EXPECTED_STRING, EXPECTED_OBJECT, EXPECTED_ARRAY, EXPECTED_MAP, EXPECTED_BASE64_ENCODED_BYTE_ARRAY, INVALID_ARRAY_VALUE, INVALID_ENUM_VALUE, INVALID_CONTENT_TYPE, INVALID_FORM_VALUE, CUSTOMER_NOT_FOUND, ONE_INSTRUMENT_EXPECTED, NO_FIELDS_SET, TOO_MANY_MAP_ENTRIES, MAP_KEY_LENGTH_TOO_SHORT, MAP_KEY_LENGTH_TOO_LONG, CUSTOMER_MISSING_NAME, CUSTOMER_MISSING_EMAIL, INVALID_PAUSE_LENGTH, INVALID_DATE, UNSUPPORTED_COUNTRY, UNSUPPORTED_CURRENCY, APPLE_TTP_PIN_TOKEN, CARD_EXPIRED, INVALID_EXPIRATION, INVALID_EXPIRATION_YEAR, INVALID_EXPIRATION_DATE, UNSUPPORTED_CARD_BRAND, UNSUPPORTED_ENTRY_METHOD, INVALID_ENCRYPTED_CARD, INVALID_CARD, PAYMENT_AMOUNT_MISMATCH, GENERIC_DECLINE, CVV_FAILURE, ADDRESS_VERIFICATION_FAILURE, INVALID_ACCOUNT, CURRENCY_MISMATCH, INSUFFICIENT_FUNDS, INSUFFICIENT_PERMISSIONS, CARDHOLDER_INSUFFICIENT_PERMISSIONS, INVALID_LOCATION, TRANSACTION_LIMIT, VOICE_FAILURE, PAN_FAILURE, EXPIRATION_FAILURE, CARD_NOT_SUPPORTED, READER_DECLINED, INVALID_PIN, MISSING_PIN, MISSING_ACCOUNT_TYPE, INVALID_POSTAL_CODE, INVALID_FEES, MANUALLY_ENTERED_PAYMENT_NOT_SUPPORTED, PAYMENT_LIMIT_EXCEEDED, GIFT_CARD_AVAILABLE_AMOUNT, ACCOUNT_UNUSABLE, BUYER_REFUSED_PAYMENT, DELAYED_TRANSACTION_EXPIRED, DELAYED_TRANSACTION_CANCELED, DELAYED_TRANSACTION_CAPTURED, DELAYED_TRANSACTION_FAILED, CARD_TOKEN_EXPIRED, CARD_TOKEN_USED, AMOUNT_TOO_HIGH, AMOUNT_TOO_LOW, UNSUPPORTED_INSTRUMENT_TYPE, REFUND_AMOUNT_INVALID, REFUND_ALREADY_PENDING, PAYMENT_NOT_REFUNDABLE, PAYMENT_NOT_REFUNDABLE_DUE_TO_DISPUTE, REFUND_ERROR_PAYMENT_NEEDS_COMPLETION, REFUND_DECLINED, INSUFFICIENT_PERMISSIONS_FOR_REFUND, INVALID_CARD_DATA, SOURCE_USED, SOURCE_EXPIRED, UNSUPPORTED_LOYALTY_REWARD_TIER, LOCATION_MISMATCH, ORDER_UNPAID_NOT_RETURNABLE, PARTIAL_PAYMENT_DELAY_CAPTURE_NOT_SUPPORTED, IDEMPOTENCY_KEY_REUSED, UNEXPECTED_VALUE, SANDBOX_NOT_SUPPORTED, INVALID_EMAIL_ADDRESS, INVALID_PHONE_NUMBER, CHECKOUT_EXPIRED, BAD_CERTIFICATE, INVALID_SQUARE_VERSION_FORMAT, API_VERSION_INCOMPATIBLE, CARD_PRESENCE_REQUIRED, UNSUPPORTED_SOURCE_TYPE, CARD_MISMATCH, PLAID_ERROR, PLAID_ERROR_ITEM_LOGIN_REQUIRED, PLAID_ERROR_RATE_LIMIT, PLAID_ERROR_INVALID_ACCESS_TOKEN, PLAID_ERROR_INVALID_ACCOUNT_ID, PLAID_ERROR_NO_ACCOUNTS, PLAID_ERROR_ITEM_NOT_FOUND, PLAID_ERROR_INSUFFICIENT_CREDENTIALS, PLAID_ERROR_ITEM_NOT_SUPPORTED, PLAID_ERROR_PRODUCT_NOT_READY, PAYMENT_SOURCE_NOT_ENABLED_FOR_TARGET, CARD_DECLINED, VERIFY_CVV_FAILURE, VERIFY_AVS_FAILURE, CARD_DECLINED_CALL_ISSUER, CARD_DECLINED_VERIFICATION_REQUIRED, BAD_EXPIRATION, CHIP_INSERTION_REQUIRED, ALLOWABLE_PIN_TRIES_EXCEEDED, RESERVATION_DECLINED, UNKNOWN_BODY_PARAMETER, CART_INELIGIBLE_FOR_EBT, NOT_FOUND, APPLE_PAYMENT_PROCESSING_CERTIFICATE_HASH_NOT_FOUND, METHOD_NOT_ALLOWED, NOT_ACCEPTABLE, REQUEST_TIMEOUT, CONFLICT, GONE, REQUEST_ENTITY_TOO_LARGE, UNSUPPORTED_MEDIA_TYPE, UNPROCESSABLE_ENTITY, RATE_LIMITED, NOT_IMPLEMENTED, BAD_GATEWAY, SERVICE_UNAVAILABLE, TEMPORARY_ERROR, GATEWAY_TIMEOUT`
  .split(",")
  .map((c) => c.trim());

describe("Square's refusals, in the screen's words", () => {
  const wordsOf = (status: number, code: string) => cardRefusalOf(status, code).words;

  it("Square's list is the one its page printed: 164 codes, none twice", () => {
    expect(SQUARE_ERROR_CODES).toHaveLength(164);
    expect(new Set(SQUARE_ERROR_CODES).size).toBe(164);
  });

  it("every code of Square's own list says something the box has words for, and is never a success", () => {
    const allowed = new Set<string>(Object.values(MEMBER_CARD_WORDS));
    for (const code of SQUARE_ERROR_CODES) {
      const r = cardRefusalOf(400, code);
      expect(allowed.has(r.words), code).toBe(true);
      expect(r.status, code).toBe(409);
      expect(r.code, code).toMatch(/^card_[a-z_]+$/);
    }
  });

  it("each kind of answer Square gives a saved card, by Square's own codes", () => {
    const table: [number, string, string][] = [
      // The card's own check at the bank: a wrong security code or address is the card's details.
      [400, "VERIFY_CVV_FAILURE", MEMBER_CARD_WORDS.invalid],
      [400, "VERIFY_AVS_FAILURE", MEMBER_CARD_WORDS.invalid],
      [400, "CVV_FAILURE", MEMBER_CARD_WORDS.invalid],
      [400, "INVALID_EXPIRATION", MEMBER_CARD_WORDS.invalid],
      [400, "INVALID_EXPIRATION_YEAR", MEMBER_CARD_WORDS.invalid],
      [400, "INVALID_EXPIRATION_DATE", MEMBER_CARD_WORDS.invalid],
      [400, "INVALID_CARD_DATA", MEMBER_CARD_WORDS.invalid],
      [400, "INVALID_ENCRYPTED_CARD", MEMBER_CARD_WORDS.invalid],
      [400, "INVALID_POSTAL_CODE", MEMBER_CARD_WORDS.invalid],
      [402, "GENERIC_DECLINE", MEMBER_CARD_WORDS.declined],
      [402, "CARD_DECLINED", MEMBER_CARD_WORDS.declined],
      [402, "INSUFFICIENT_FUNDS", MEMBER_CARD_WORDS.declined],
      [402, "CARD_DECLINED_CALL_ISSUER", MEMBER_CARD_WORDS.declined],
      [402, "ACCOUNT_UNUSABLE", MEMBER_CARD_WORDS.declined],
      [400, "CARD_EXPIRED", MEMBER_CARD_WORDS.expired],
      [402, "CARD_DECLINED_VERIFICATION_REQUIRED", MEMBER_CARD_WORDS.verification],
      [400, "SOURCE_USED", MEMBER_CARD_WORDS.form_expired],
      [400, "SOURCE_EXPIRED", MEMBER_CARD_WORDS.form_expired],
      [400, "CARD_TOKEN_USED", MEMBER_CARD_WORDS.form_expired],
      [400, "CARD_TOKEN_EXPIRED", MEMBER_CARD_WORDS.form_expired],
      [400, "IDEMPOTENCY_KEY_REUSED", MEMBER_CARD_WORDS.form_expired],
      [400, "UNSUPPORTED_CARD_BRAND", MEMBER_CARD_WORDS.not_supported],
      [400, "CARD_NOT_SUPPORTED", MEMBER_CARD_WORDS.not_supported],
      [400, "CUSTOMER_NOT_FOUND", MEMBER_CARD_WORDS.customer_gone],
      [400, "INVALID_EMAIL_ADDRESS", MEMBER_CARD_WORDS.contact_refused],
      [400, "INVALID_PHONE_NUMBER", MEMBER_CARD_WORDS.contact_refused],
      [403, "CARD_PROCESSING_NOT_ENABLED", MEMBER_CARD_WORDS.processing_off],
      [403, "INSUFFICIENT_SCOPES", MEMBER_CARD_WORDS.connection_refused],
      [401, "UNAUTHORIZED", MEMBER_CARD_WORDS.connection_refused],
      [401, "ACCESS_TOKEN_REVOKED", MEMBER_CARD_WORDS.connection_refused],
      // Square's older OAuth shape, and a code Square adds one day: never taken as a card saved.
      [401, "service.not_authorized", MEMBER_CARD_WORDS.connection_refused],
      [400, "SOMETHING_SQUARE_ADDS_LATER", MEMBER_CARD_WORDS.not_saved],
      [400, "unknown", MEMBER_CARD_WORDS.not_saved],
      [400, "BAD_REQUEST", MEMBER_CARD_WORDS.not_saved],
      [404, "NOT_FOUND", MEMBER_CARD_WORDS.not_saved],
    ];
    for (const [status, code, words] of table) expect(wordsOf(status, code), code).toBe(words);
  });
});

describe("the calls to Square for a person and their card", () => {
  const recorded: { url: string; init: RequestInit }[] = [];
  const answer = (status: number, json: unknown) => {
    const fetchImpl: typeof fetch = (input, init) => {
      recorded.push({ url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url, init: init ?? {} });
      return Promise.resolve(new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } }));
    };
    return createSquareApi({ applicationId: "sandbox-sq0idb-APPID0000000", applicationSecret: "sandbox-sq0csb-SECRET00000000", environment: "sandbox", fetchImpl }); // dummy, gitleaks:allow
  };
  const last = () => recorded[recorded.length - 1];
  const lastBody = () => {
    const body = last()?.init.body;
    return JSON.parse(typeof body === "string" ? body : "null") as Record<string, unknown>;
  };
  const lastHeaders = () => new Headers(last()?.init.headers);
  const pressId = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const card = { id: "ccof:uIbfJXhXETSP197M3GB", card_brand: "VISA", last_4: "1111", exp_month: 11, exp_year: 2028, customer_id: "VDKXEEKPJN48QDG3BGGFAK05P8", merchant_id: "6SSW7HV8K2ST5", enabled: true };

  it("makes the customer in the gym's account with the gym's own token, naming the record", async () => {
    const api = answer(200, { customer: { id: "VDKXEEKPJN48QDG3BGGFAK05P8", given_name: "Tara" } });
    const result = await api.createCustomer("EAAAgym-token-0123456789", { idempotencyKey: "k-1", givenName: "Tara", familyName: "Singh", email: "tara@example.com", phone: null, referenceId: "0f8fad5b-d9cb-469f-a165-70867728950e" });
    expect(result).toEqual({ kind: "ok", value: { id: "VDKXEEKPJN48QDG3BGGFAK05P8" } });
    expect(last()?.url).toBe("https://connect.squareupsandbox.com/v2/customers");
    expect(lastHeaders().get("authorization")).toBe("Bearer EAAAgym-token-0123456789");
    expect(lastBody()).toEqual({ idempotency_key: "k-1", given_name: "Tara", family_name: "Singh", email_address: "tara@example.com", reference_id: "0f8fad5b-d9cb-469f-a165-70867728950e" });
  });

  it("saves the form's token on that customer under the press's key, and reads the card back", async () => {
    const api = answer(200, { card });
    const result = await api.createCard("EAAAgym-token-0123456789", { idempotencyKey: pressId, sourceId: "cnon:card-nonce-ok", customerId: "VDKXEEKPJN48QDG3BGGFAK05P8", cardholderName: null });
    expect(result).toMatchObject({ kind: "ok", value: { id: card.id, last_4: "1111", exp_year: 2028 } });
    expect(last()?.url).toBe("https://connect.squareupsandbox.com/v2/cards");
    expect(lastBody()).toEqual({ idempotency_key: pressId, source_id: "cnon:card-nonce-ok", card: { customer_id: "VDKXEEKPJN48QDG3BGGFAK05P8" } });
  });

  it("reads and stops a card by its own id, and never builds a path from anything else", async () => {
    const api = answer(200, { card: { ...card, enabled: false } });
    expect((await api.retrieveCard("EAAAgym-token-0123456789", card.id)).kind).toBe("ok");
    expect(last()?.url).toBe(`https://connect.squareupsandbox.com/v2/cards/${card.id}`);
    expect(last()?.init.method).toBe("GET");
    expect(await api.disableCard("EAAAgym-token-0123456789", card.id)).toMatchObject({ kind: "ok", value: { enabled: false } });
    expect(last()?.url).toBe(`https://connect.squareupsandbox.com/v2/cards/${card.id}/disable`);
    expect(last()?.init.method).toBe("POST");
    await expect(api.disableCard("EAAAgym-token-0123456789", "../v2/payments")).rejects.toThrow("not a Square card id");
  });

  it("stops a whole account by its id with our own secret, for the stop tool", async () => {
    const api = answer(200, { success: true });
    expect(await api.revokeAccount("MLTEST123")).toEqual({ kind: "ok", value: null });
    expect(last()?.url).toBe("https://connect.squareupsandbox.com/oauth2/revoke");
    expect(lastBody()).toEqual({ client_id: "sandbox-sq0idb-APPID0000000", merchant_id: "MLTEST123" });
    expect(lastHeaders().get("authorization")).toBe("Client sandbox-sq0csb-SECRET00000000");
  });

  it("a refused card keeps Square's own code, and a card it cannot read is no answer", async () => {
    expect(await answer(402, { errors: [{ category: "PAYMENT_METHOD_ERROR", code: "GENERIC_DECLINE" }] }).createCard("t", { idempotencyKey: "k", sourceId: "cnon:x", customerId: "C1", cardholderName: null })).toEqual({
      kind: "refused",
      status: 402,
      code: "GENERIC_DECLINE",
    });
    expect((await answer(200, { card: { id: "ccof:x", last_4: "12" } }).createCard("t", { idempotencyKey: "k", sourceId: "cnon:x", customerId: "C1", cardholderName: null })).kind).toBe("unavailable");
  });
});
