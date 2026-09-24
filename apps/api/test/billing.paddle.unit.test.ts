// The real Paddle adapter's customer portal call (billing/paddle.ts), with fetch replaced:
// the request Paddle's API reference asks for (POST /customers/{customer_id}/portal-sessions
// with `subscription_ids`, developer.paddle.com, read 2026-09-24), its documented reply read
// back, and an id not in Paddle's shape never sent.
import { describe, expect, it } from "vitest";
import { createPaddleApi } from "../src/modules/billing/paddle.js";

const CUSTOMER = "ctm_01grnn4zta5a1mf02jjze7y2ys";
const SUB = "sub_01h04vsc0qhwtsbsxh3422wjs4";
const PORTAL = "https://sandbox-customer-portal.paddle.com/cpl_01j7zbyqs3vah3aafp4jf62qaw";
const fakeKey = ["pdl", "sdbx", "apikey", "01" + "a".repeat(24), "AbCdEfGhIjKlMnOpQrStUv", "Xyz"].join("_");

function recording(status: number, body: unknown) {
  const calls: { url: string; method: string; body: unknown; auth: string | null }[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      auth: headers.get("authorization"),
    });
    return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  };
  return { calls, api: createPaddleApi({ apiKey: fakeKey, environment: "sandbox", fetchImpl }) };
}

const documentedReply = {
  data: {
    id: "cpls_01h4ge9r64c22exjsx0fy8b48b",
    customer_id: CUSTOMER,
    urls: {
      general: { overview: `${PORTAL}?action=overview&token=t` },
      subscriptions: [
        {
          id: SUB,
          cancel_subscription: `${PORTAL}?action=cancel_subscription&subscription_id=${SUB}&token=t`,
          update_subscription_payment_method: `${PORTAL}?action=update_subscription_payment_method&subscription_id=${SUB}&token=t`,
        },
      ],
    },
    created_at: "2024-10-25T06:53:58.370Z",
  },
  meta: { request_id: "9b1c7a4e-1f0c-4c47-9f6c-8f8b3f0e6b1a" },
};

describe("Paddle's customer portal session, the real adapter", () => {
  it("posts to the customer's portal-sessions with the subscription ids, and reads the documented reply", async () => {
    const { calls, api } = recording(201, documentedReply);
    const result = await api.createPortalSession(CUSTOMER, [SUB]);
    expect(calls).toEqual([
      {
        url: `https://sandbox-api.paddle.com/customers/${CUSTOMER}/portal-sessions`,
        method: "POST",
        body: { subscription_ids: [SUB] },
        auth: `Bearer ${fakeKey}`,
      },
    ]);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.value.urls.subscriptions[0]?.id).toBe(SUB);
  });

  it.each([
    ["a customer id not in Paddle's shape", "ctm_../../transactions", [SUB]],
    ["a customer id of another kind", "sub_01h04vsc0qhwtsbsxh3422wjs4", [SUB]],
    ["a subscription id not in Paddle's shape", CUSTOMER, ["sub_1?x=y"]],
  ])("never sends %s", async (_name, customerId, subscriptionIds) => {
    const { calls, api } = recording(201, documentedReply);
    expect((await api.createPortalSession(customerId, subscriptionIds)).kind).toBe("not_found");
    expect(calls).toHaveLength(0);
  });

  it("a key without the permission is a refusal, and a reply with a link off Paddle is no answer", async () => {
    const refused = recording(403, { error: { type: "request_error", code: "forbidden", detail: "no permission" } });
    expect(await refused.api.createPortalSession(CUSTOMER, [SUB])).toEqual({ kind: "refused", status: 403, code: "forbidden" });

    const tampered = structuredClone(documentedReply);
    tampered.data.urls.general.overview = "https://evil.example/cpl_x";
    const off = recording(201, tampered);
    expect((await off.api.createPortalSession(CUSTOMER, [SUB])).kind).toBe("unavailable");
  });
});
