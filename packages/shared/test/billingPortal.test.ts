// Paddle's customer portal session (ROADMAP Stage 3 item 1c-i), checked against the
// example response on Paddle's own page (developer.paddle.com, "Create a customer portal
// session", read 2026-09-24), and links that must never pass as Paddle's.
import { describe, expect, it } from "vitest";
import { orgBillingPortalResponseSchema, paddlePortalSessionSchema, paddlePortalUrlSchema } from "../src/index.js";

// Paddle's documented sample token, rebuilt at run time so no token-shaped text is in the repository.
const TOKEN = ["pga_eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", "eyJzdWIiOiJjdG1fMDFncm5uNHp0YTVhMW1mMDJqanplN3kyeXMiLCJuYW1lIjoiSm9obiBEb2UiLCJpYXQiOjE3Mjc2NzkyMzh9", "_oO12IejzdKmyKTwb7BLjmiILkx4_cSyGjXraOBUI_g"].join(".");
const PORTAL = "https://customer-portal.paddle.com/cpl_01j7zbyqs3vah3aafp4jf62qaw";
const SUB = "sub_01h04vsc0qhwtsbsxh3422wjs4";

const documented = {
  id: "cpls_01h4ge9r64c22exjsx0fy8b48b",
  customer_id: "ctm_01grnn4zta5a1mf02jjze7y2ys",
  urls: {
    general: { overview: `${PORTAL}?action=overview&token=${TOKEN}` },
    subscriptions: [
      {
        id: SUB,
        cancel_subscription: `${PORTAL}?action=cancel_subscription&subscription_id=${SUB}&token=${TOKEN}`,
        update_subscription_payment_method: `${PORTAL}?action=update_subscription_payment_method&subscription_id=${SUB}&token=${TOKEN}`,
      },
    ],
  },
  created_at: "2024-10-25T06:53:58.370Z",
};

describe("Paddle's customer portal session", () => {
  it("reads Paddle's documented example", () => {
    const parsed = paddlePortalSessionSchema.parse(documented);
    expect(parsed.customer_id).toBe("ctm_01grnn4zta5a1mf02jjze7y2ys");
    expect(parsed.urls.subscriptions[0]?.id).toBe(SUB);
  });

  it.each([
    ["Paddle's live portal", `${PORTAL}?action=overview&token=${TOKEN}`],
    ["the sandbox portal", "https://sandbox-customer-portal.paddle.com/cpl_01j7zbyqs3vah3aafp4jf62qaw?action=overview"],
  ])("takes %s", (_name, url) => {
    expect(paddlePortalUrlSchema.safeParse(url).success).toBe(true);
    expect(orgBillingPortalResponseSchema.safeParse({ url }).success).toBe(true);
  });

  it.each([
    ["plain http", "http://customer-portal.paddle.com/cpl_x"],
    ["another site", "https://evil.example/cpl_x"],
    ["a look-alike domain", "https://customer-portal.paddle.com.evil.example/cpl_x"],
    ["a domain ending in paddle.com", "https://notpaddle.com/cpl_x"],
    ["a sign-in in the link", "https://someone@customer-portal.paddle.com/cpl_x"],
    ["a script link", "javascript:alert(1)//customer-portal.paddle.com"],
    ["not a link", "customer-portal.paddle.com/cpl_x"],
  ])("refuses %s", (_name, url) => {
    expect(paddlePortalUrlSchema.safeParse(url).success).toBe(false);
  });

  it("refuses a session whose card link is not Paddle's", () => {
    const tampered = structuredClone(documented);
    const first = tampered.urls.subscriptions[0];
    if (first === undefined) throw new Error("fixture has no subscription");
    first.update_subscription_payment_method = "https://evil.example/pay";
    expect(paddlePortalSessionSchema.safeParse(tampered).success).toBe(false);
  });

  it("sends the browser nothing but the link", () => {
    expect(orgBillingPortalResponseSchema.safeParse({ url: `${PORTAL}?action=overview`, customerId: "ctm_x" }).success).toBe(false);
  });
});
