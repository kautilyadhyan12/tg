// The request the app's own Square adapter builds to charge a card on file (18d-iii-i; 18k-iv; 20i-ii), read off a recording
// `fetch`: every route test runs against the fake, so a pass that never reached Square would stay green there (18k-iv round
// one). Measured in Square's test area 2026-11-14: the pass from `Card.tokenize(verificationDetails, cardId)` is charged as
// `source_id` with `customer_details.customer_initiated: true`; a charge by the gym is `customer_initiated: false`, which a
// card asking for its bank's check takes, where sending neither was refused CARD_DECLINED_VERIFICATION_REQUIRED.
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
const CHARGE = { idempotencyKey: PRESS_ID, cardId: "ccof:abc", customerId: "CUST1", amountMinor: 4999, currency: "USD", locationId: "L1", referenceId: PRESS_ID, note: "Bought in the app", initiated: "gym" } as const;
const PAID = { payment: { id: "PAY1", status: "COMPLETED", amount_money: { amount: 4999, currency: "USD" } } };

describe("createCardPayment", () => {
  it("charges the member's pass in place of the card, as theirs; the gym's charge is the card, as the gym's", async () => {
    const pass = "ccof:abc#verf:CA4SEabc_123";
    await answer(200, PAID).createCardPayment(TOKEN, { ...CHARGE, pass, initiated: "member" });
    expect(recorded[recorded.length - 1]?.url).toBe("https://connect.squareupsandbox.com/v2/payments");
    expect(bodyOf()).toMatchObject({
      idempotency_key: CHARGE.idempotencyKey,
      source_id: pass,
      customer_id: "CUST1",
      autocomplete: true,
      customer_details: { customer_initiated: true, seller_keyed_in: false },
    });
    expect(bodyOf()).not.toHaveProperty("verification_token");
    for (const gym of [CHARGE, { ...CHARGE, pass: null }]) {
      await answer(200, PAID).createCardPayment(TOKEN, gym);
      expect(bodyOf()).toMatchObject({ source_id: "ccof:abc", customer_details: { customer_initiated: false, seller_keyed_in: false } });
    }
  });

  it("reads the bank asking to confirm as a decline with its own code, which Buy words apart", async () => {
    const asked = await answer(402, { errors: [{ category: "PAYMENT_METHOD_ERROR", code: "CARD_DECLINED_VERIFICATION_REQUIRED", detail: "x" }] }).createCardPayment(TOKEN, CHARGE);
    expect(asked).toMatchObject({ kind: "declined", code: "CARD_DECLINED_VERIFICATION_REQUIRED" });
  });
});
