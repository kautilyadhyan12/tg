// The request the app's own Square adapter builds to charge a card on file (18d-iii-i; 18k-iv), read off a recording `fetch`:
// every route test runs against the fake, so a token the bank asked for that never reached Square would stay green there
// (18k-iv round one). Square's field is `verification_token` ("Create payment", read 2026-11-12); a charge the bank wants
// confirmed comes back as a PAYMENT_METHOD_ERROR with CARD_DECLINED_VERIFICATION_REQUIRED.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSquareApi } from "../src/modules/orgs/payments/square.js";

const recorded: { url: string; init: RequestInit }[] = [];
const answer = (status: number, json: unknown) => {
  const fetchImpl: typeof fetch = (input, init) => {
    recorded.push({ url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url, init: init ?? {} });
    return Promise.resolve(new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } }));
  };
  return createSquareApi({ applicationId: "sandbox-sq0idb-APPID0000000", applicationSecret: "sandbox-sq0csb-SECRET00000000", environment: "sandbox", fetchImpl }); // dummy, gitleaks:allow
};
const bodyOf = (): Record<string, unknown> => {
  const body = recorded[recorded.length - 1]?.init.body;
  return JSON.parse(typeof body === "string" ? body : "{}") as Record<string, unknown>;
};
const TOKEN = "EAAAtest-access-0123456789"; // dummy, gitleaks:allow
const PRESS_ID = randomUUID();
const CHARGE = { idempotencyKey: PRESS_ID, cardId: "ccof:abc", customerId: "CUST1", amountMinor: 4999, currency: "USD", locationId: "L1", referenceId: PRESS_ID, note: "Bought in the app" };
const PAID = { payment: { id: "PAY1", status: "COMPLETED", amount_money: { amount: 4999, currency: "USD" } } };

describe("createCardPayment", () => {
  it("sends the bank's check as Square's verification_token, and none where there is none", async () => {
    await answer(200, PAID).createCardPayment(TOKEN, { ...CHARGE, verificationToken: "verf:CBASE-abc_123" });
    expect(recorded[recorded.length - 1]?.url).toBe("https://connect.squareupsandbox.com/v2/payments");
    expect(bodyOf()).toMatchObject({ idempotency_key: CHARGE.idempotencyKey, source_id: "ccof:abc", customer_id: "CUST1", verification_token: "verf:CBASE-abc_123", autocomplete: true });
    await answer(200, PAID).createCardPayment(TOKEN, { ...CHARGE, verificationToken: null });
    expect(bodyOf()).not.toHaveProperty("verification_token");
    await answer(200, PAID).createCardPayment(TOKEN, CHARGE);
    expect(bodyOf()).not.toHaveProperty("verification_token");
  });

  it("reads the bank asking to confirm as a decline with its own code, which Buy words apart", async () => {
    const asked = await answer(402, { errors: [{ category: "PAYMENT_METHOD_ERROR", code: "CARD_DECLINED_VERIFICATION_REQUIRED", detail: "x" }] }).createCardPayment(TOKEN, CHARGE);
    expect(asked).toMatchObject({ kind: "declined", code: "CARD_DECLINED_VERIFICATION_REQUIRED" });
  });
});
