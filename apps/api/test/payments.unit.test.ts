// A gym's own Square account (ROADMAP 18d-i), the parts that need no database: the lock on
// its tokens, Square's webhook signature, the calls to Square and the settings at boot.
//
// The signature cases are Square's own, copied from its Node SDK's test
// (github.com/square/square-nodejs-sdk, tests/integration/webhooks.test.ts, read 2026-10-19),
// not worked out here.
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createSquareApi, SQUARE_SCOPES, SQUARE_VERSION } from "../src/modules/orgs/payments/square.js";
import { verifySquareSignature } from "../src/modules/orgs/payments/squareSignature.js";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";
import { createTokenBox } from "../src/modules/orgs/payments/tokenBox.js";

const KEY = Buffer.alloc(32, 7).toString("base64"); // dummy test key, gitleaks:allow
const OTHER_KEY = Buffer.alloc(32, 9).toString("base64"); // dummy test key, gitleaks:allow
const GYM_A = "11111111-1111-4111-8111-111111111111";
const GYM_B = "22222222-2222-4222-8222-222222222222";

describe("the lock on a gym's Square tokens", () => {
  const box = createTokenBox(KEY);
  const token = "EAAAl-test-access-token-0123456789"; // dummy, gitleaks:allow

  it("opens with the same gym and kind, and the locked text never holds the token", () => {
    const sealed = box.lock(token, { gymId: GYM_A, provider: "square", kind: "access" });
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain(token);
    expect(box.open(sealed, { gymId: GYM_A, provider: "square", kind: "access" })).toBe(token);
  });

  it("locks the same token differently each time", () => {
    const ctx = { gymId: GYM_A, provider: "square", kind: "access" } as const;
    expect(box.lock(token, ctx)).not.toBe(box.lock(token, ctx));
  });

  it("does not open on another gym's row, as the other kind, under another key, or changed", () => {
    const sealed = box.lock(token, { gymId: GYM_A, provider: "square", kind: "access" });
    expect(box.open(sealed, { gymId: GYM_B, provider: "square", kind: "access" })).toBeNull();
    expect(box.open(sealed, { gymId: GYM_A, provider: "square", kind: "refresh" })).toBeNull();
    expect(createTokenBox(OTHER_KEY).open(sealed, { gymId: GYM_A, provider: "square", kind: "access" })).toBeNull();
    const [scheme, iv, body = "", tag] = sealed.split(".");
    // One byte changed, not one letter: a letter swap can land on the same letter.
    const bytes = Buffer.from(body, "base64url");
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    expect(box.open([scheme, iv, bytes.toString("base64url"), tag].join("."), { gymId: GYM_A, provider: "square", kind: "access" })).toBeNull();
    for (const junk of ["", "v1", "v2.a.b.c", "v1.a.b", "v1.!!.!!.!!", token]) {
      expect(box.open(junk, { gymId: GYM_A, provider: "square", kind: "access" })).toBeNull();
    }
  });

  it("refuses a key that is not 32 bytes", () => {
    expect(() => createTokenBox(Buffer.alloc(16).toString("base64"))).toThrow();
  });
});

describe("Square's webhook signature, on Square's own examples", () => {
  const body = Buffer.from(
    '{"merchant_id":"MLEFBHHSJGVHD","type":"webhooks.test_notification","event_id":"ac3ac95b-f97d-458c-a6e6-18981597e05f","created_at":"2022-07-13T20:30:59.037339943Z","data":{"type":"webhooks","id":"bc368e64-01aa-407e-b46e-3231809b1129"}}',
    "utf8",
  );
  const header = "GF4YkrJgGBDZ9NIYbNXBnMzqb2HoL4RW/S6vkZ9/2N4=";
  const key = "Ibxx_5AKakO-3qeNVR61Dw"; // Square's published test key, gitleaks:allow
  const url = "https://webhook.site/679a4f3a-dcfa-49ee-bac5-9d0edad886b9";

  it("passes Square's examples", () => {
    expect(verifySquareSignature(key, url, header, body)).toBe(true);
    expect(verifySquareSignature("signature-key", "https://webhook.site/webhooks", "W3FlCNk5IA3ZQ2LHTWoajvzfaDu/OwY2tNHIHC3IUOA=", Buffer.from('{"data":{"type":"webhooks","id":"fake_id"}}'))).toBe(true);
    expect(verifySquareSignature("signature-key", "https://webhook.site/webhooks", "Cxt7+aTi4rKgcA0bC4g9EHdVtLSDWdqccmL5MvihU4U=", Buffer.from('{"data":{"type":"webhooks","id":">id<"}}'))).toBe(true);
  });

  it("fails Square's own failing cases, and anything changed", () => {
    expect(verifySquareSignature(key, "https://webhook.site/79a4f3a-dcfa-49ee-bac5-9d0edad886b9", header, body)).toBe(false);
    expect(verifySquareSignature("MCmhFRxGX82xMwg5FsaoQA", url, header, body)).toBe(false);
    expect(verifySquareSignature(key, url, "1z2n3DEJJiUPKcPzQo1ftvbxGdw=", body)).toBe(false);
    expect(verifySquareSignature(key, url, header, Buffer.from(body.toString("utf8").replace("MLEFBHHSJGVHD", "MLEFBHHSJGVHE")))).toBe(false);
    expect(verifySquareSignature(key, url, undefined, body)).toBe(false);
    expect(verifySquareSignature(key, url, "", body)).toBe(false);
  });
});

describe("the calls to Square", () => {
  const recorded: { url: string; init: RequestInit }[] = [];
  const answer = (status: number, json: unknown) => {
    const fetchImpl: typeof fetch = (input, init) => {
      recorded.push({ url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url, init: init ?? {} });
      return Promise.resolve(new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } }));
    };
    return createSquareApi({ applicationId: "sandbox-sq0idb-APPID0000000", applicationSecret: "sandbox-sq0csb-SECRET00000000", environment: "sandbox", fetchImpl }); // dummy, gitleaks:allow
  };
  const lastBody = () => {
    const body = recorded[recorded.length - 1]?.init.body;
    return JSON.parse(typeof body === "string" ? body : "null") as Record<string, unknown>;
  };
  const lastHeaders = () => new Headers(recorded[recorded.length - 1]?.init.headers);
  const tokenReply = {
    access_token: "EAAAtest-access-0123456789", // dummy, gitleaks:allow
    token_type: "bearer",
    expires_at: "2026-11-18T10:00:00Z",
    merchant_id: "MLTEST123",
    refresh_token: "EQAAtest-refresh-0123456789",
    short_lived: false,
  };

  it("sends the gym to Square's own page with the press, the scopes and no saved sign-in", () => {
    const url = new URL(answer(200, {}).authorizeUrl("state-value"));
    expect(url.origin + url.pathname).toBe("https://connect.squareupsandbox.com/oauth2/authorize");
    expect(url.searchParams.get("client_id")).toBe("sandbox-sq0idb-APPID0000000");
    expect(url.searchParams.get("state")).toBe("state-value");
    expect(url.searchParams.get("session")).toBe("false");
    expect(url.searchParams.get("scope")).toBe(SQUARE_SCOPES.join(" "));
  });

  it("trades a code for tokens with the secret in the body, and reads Square's answer", async () => {
    const api = answer(200, tokenReply);
    const result = await api.exchangeCode("sq0cgb-code");
    expect(result).toMatchObject({ kind: "ok", value: { merchant_id: "MLTEST123", refresh_token: "EQAAtest-refresh-0123456789" } });
    expect(recorded[recorded.length - 1]?.url).toBe("https://connect.squareupsandbox.com/oauth2/token");
    expect(lastBody()).toEqual({ client_id: "sandbox-sq0idb-APPID0000000", client_secret: "sandbox-sq0csb-SECRET00000000", grant_type: "authorization_code", code: "sq0cgb-code" });
    expect(lastHeaders().get("square-version")).toBe(SQUARE_VERSION);
    expect(lastHeaders().get("authorization")).toBeNull();
  });

  it("stops one token or the whole account, signed with the secret", async () => {
    const api = answer(200, { success: true });
    expect(await api.revoke("EAAAtoken-0123456789", false)).toEqual({ kind: "ok", value: null });
    expect(lastBody()).toEqual({ client_id: "sandbox-sq0idb-APPID0000000", access_token: "EAAAtoken-0123456789", revoke_only_access_token: true });
    expect(lastHeaders().get("authorization")).toBe("Client sandbox-sq0csb-SECRET00000000");
    await api.revoke("EAAAtoken-0123456789", true);
    expect(lastBody()["revoke_only_access_token"]).toBe(false);
  });

  it("asks about a token with the token itself", async () => {
    const api = answer(200, { merchant_id: "MLTEST123", client_id: "x", scopes: [] });
    expect((await api.tokenStatus("EAAAtoken-0123456789")).kind).toBe("ok");
    expect(lastHeaders().get("authorization")).toBe("Bearer EAAAtoken-0123456789");
    expect(recorded[recorded.length - 1]?.url).toBe("https://connect.squareupsandbox.com/oauth2/token/status");
  });

  it("calls a refusal a refusal, a 429 or 5xx no answer, and an answer it cannot read no answer", async () => {
    expect(await answer(401, { errors: [{ code: "UNAUTHORIZED", category: "AUTHENTICATION_ERROR" }] }).tokenStatus("EAAAtoken-0123456789")).toEqual({ kind: "refused", status: 401, code: "UNAUTHORIZED" });
    expect(await answer(400, { type: "bad_request", message: "x" }).exchangeCode("c")).toEqual({ kind: "refused", status: 400, code: "bad_request" });
    expect(await answer(429, {}).exchangeCode("c")).toEqual({ kind: "unavailable", status: 429 });
    expect(await answer(503, {}).exchangeCode("c")).toEqual({ kind: "unavailable", status: 503 });
    // A 200 missing the refresh token is never a connection.
    expect(await answer(200, { ...tokenReply, refresh_token: undefined }).exchangeCode("c")).toEqual({ kind: "unavailable", status: 200 });
    expect(await answer(200, { success: false }).revoke("EAAAtoken-0123456789", true)).toEqual({ kind: "unavailable", status: 200 });
    const failing = createSquareApi({ applicationId: "a", applicationSecret: "b", environment: "production", fetchImpl: () => Promise.reject(new Error("offline")) });
    expect(await failing.merchant("t")).toEqual({ kind: "unavailable", status: null });
  });

  it("reads the business and its locations", async () => {
    const merchant = await answer(200, { merchant: { id: "MLTEST123", business_name: "Iron House", country: "GB", currency: "GBP", status: "ACTIVE" } }).merchant("t");
    expect(merchant).toEqual({ kind: "ok", value: { id: "MLTEST123", business_name: "Iron House", country: "GB", currency: "GBP", status: "ACTIVE" } });
    const locations = await answer(200, {}).locations("t");
    expect(locations).toEqual({ kind: "ok", value: [] });
    expect(recorded[recorded.length - 1]?.url).toBe("https://connect.squareupsandbox.com/v2/locations");
  });

  it("asks for a Terminal's code at the gym's location, and reads which Terminal signed in with it", async () => {
    // Square's own example ("Connect a Square Terminal to a POS Application", read 2026-10-21).
    const paired = { id: "TQYQBS0P8B7AJ", name: "Counter 1", code: "TRXKEB", device_id: "R5WNWB5BKNG9R", product_type: "TERMINAL_API", location_id: "S8GW3HF3", pair_by: "2020-03-20T19:49:19.000Z", created_at: "2020-03-20T19:44:19.000Z", status: "PAIRED", status_changed_at: "2020-03-20T19:44:19.000Z" };
    const made = await answer(200, { device_code: { ...paired, status: "UNPAIRED", device_id: undefined } }).createDeviceCode("EAAAtoken-0123456789", { idempotencyKey: "key-1", name: "Iron House", locationId: "S8GW3HF3" });
    expect(made).toEqual({ kind: "ok", value: { id: "TQYQBS0P8B7AJ", code: "TRXKEB", location_id: "S8GW3HF3", status: "UNPAIRED", pair_by: "2020-03-20T19:49:19.000Z" } });
    expect(recorded[recorded.length - 1]?.url).toBe("https://connect.squareupsandbox.com/v2/devices/codes");
    expect(lastBody()).toEqual({ idempotency_key: "key-1", device_code: { name: "Iron House", product_type: "TERMINAL_API", location_id: "S8GW3HF3" } });
    expect(lastHeaders().get("authorization")).toBe("Bearer EAAAtoken-0123456789");
    const read = await answer(200, { device_code: paired }).retrieveDeviceCode("EAAAtoken-0123456789", "TQYQBS0P8B7AJ");
    expect(read).toMatchObject({ kind: "ok", value: { status: "PAIRED", device_id: "R5WNWB5BKNG9R" } });
    expect(recorded[recorded.length - 1]?.url).toBe("https://connect.squareupsandbox.com/v2/devices/codes/TQYQBS0P8B7AJ");
    // Square's page says a code that ran out is no longer returned (its sandbox answers EXPIRED,
    // measured 2026-10-21); a code with no code text is not a code; a path is never built from
    // anything but an id.
    expect(await answer(404, { errors: [{ code: "NOT_FOUND", category: "INVALID_REQUEST_ERROR" }] }).retrieveDeviceCode("t", "TQYQBS0P8B7AJ")).toEqual({ kind: "refused", status: 404, code: "NOT_FOUND" });
    expect(await answer(200, { device_code: { ...paired, code: "not a code" } }).retrieveDeviceCode("t", "TQYQBS0P8B7AJ")).toEqual({ kind: "unavailable", status: 200 });
    // The same code asked for again comes back with its text empty (Square's test area).
    expect(await answer(200, { device_code: { ...paired, code: "" } }).createDeviceCode("t", { idempotencyKey: "key-1", name: "x", locationId: "S8GW3HF3" })).toMatchObject({ kind: "ok", value: { code: "" } });
    await expect(answer(200, {}).retrieveDeviceCode("t", "../v2/payments")).rejects.toThrow("not a Square device code id");
    // The Terminal's permissions are asked for with the rest.
    expect(SQUARE_SCOPES).toEqual(expect.arrayContaining(["DEVICE_CREDENTIAL_MANAGEMENT", "PAYMENTS_WRITE_IN_PERSON"]));
  });

  it("talks to Square's live address in production", () => {
    const api = createSquareApi({ applicationId: "sq0idp-APPID0000000", applicationSecret: "sq0csp-SECRET00000000", environment: "production" }); // dummy, gitleaks:allow
    expect(api.authorizeUrl("s").startsWith("https://connect.squareup.com/oauth2/authorize?")).toBe(true);
  });
});

describe("Square's settings at boot", () => {
  const base = { NODE_ENV: "test", DATABASE_URL: "postgres://x@localhost/x", WEB_ORIGIN: "http://localhost:5173", JWT_SECRET: "payments-unit-secret-0123456789abc" }; // dummy, gitleaks:allow
  const sandbox = { SQUARE_APPLICATION_ID: "sandbox-sq0idb-APPID0000000", SQUARE_APPLICATION_SECRET: "sandbox-sq0csb-SECRET00000000", PAYMENT_TOKENS_KEY: KEY }; // dummy, gitleaks:allow

  it("is off with no keys, and on with the pair and the lock's key", () => {
    expect(squareSettings(loadConfig(base))).toBeNull();
    const on = squareSettings(loadConfig({ ...base, ...sandbox }));
    expect(on?.environment).toBe("sandbox");
    expect(on?.webhook).toBeNull();
  });

  it("refuses half a pair, no lock key, the other environment's keys, or half a webhook", () => {
    expect(() => loadConfig({ ...base, SQUARE_APPLICATION_ID: sandbox.SQUARE_APPLICATION_ID, PAYMENT_TOKENS_KEY: KEY })).toThrow(/set together/);
    expect(() => loadConfig({ ...base, SQUARE_APPLICATION_ID: sandbox.SQUARE_APPLICATION_ID, SQUARE_APPLICATION_SECRET: sandbox.SQUARE_APPLICATION_SECRET })).toThrow(/PAYMENT_TOKENS_KEY/);
    expect(() => loadConfig({ ...base, ...sandbox, SQUARE_ENV: "production" })).toThrow(/other Square environment/);
    expect(() => loadConfig({ ...base, ...sandbox, SQUARE_WEBHOOK_SIGNATURE_KEY: "signature-key-123" })).toThrow(/set together/); // dummy, gitleaks:allow
    expect(() => loadConfig({ ...base, ...sandbox, PAYMENT_TOKENS_KEY: "short" })).toThrow(/32 bytes/);
    expect(() => loadConfig({ ...base, ...sandbox, NODE_ENV: "production" })).toThrow(/SQUARE_WEBHOOK_SIGNATURE_KEY is required in production/);
  });
});
