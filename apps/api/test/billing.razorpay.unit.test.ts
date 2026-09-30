// Razorpay's record read into the one rule, its webhook signature, and its API's answers
// (ROADMAP Stage 3 item 1d-i). No database.
import { createHmac } from "node:crypto";
import type { RazorpaySubscription } from "@app/shared";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { decide } from "../src/modules/billing/machine.js";
import { onlinePaymentFor } from "../src/modules/billing/online.js";
import { createRazorpayApi } from "../src/modules/billing/razorpay.js";
import { verifyRazorpaySignature } from "../src/modules/billing/razorpaySignature.js";
import { toRazorpaySnapshot } from "../src/modules/billing/service.js";

const FETCHED = new Date("2026-10-05T10:00:00Z");
const PLAN = "11111111-1111-4111-8111-111111111111";
const base: RazorpaySubscription = {
  id: "sub_ThrbKTOqIAPlzK",
  entity: "subscription",
  plan_id: "plan_ThrbJtE8RBqR7l",
  customer_id: null,
  status: "created",
  current_start: null,
  current_end: null,
  ended_at: null,
  charge_at: 1_791_000_000,
  start_at: 1_791_000_000,
  quantity: 1,
  total_count: 120,
  paid_count: 0,
  notes: {},
  created_at: 1_790_000_000,
};

describe("a Razorpay subscription in the one rule's terms", () => {
  // Every status Razorpay documents, and what a gym holding nothing yet would get from it.
  const table: [RazorpaySubscription["status"], Partial<RazorpaySubscription>, string | null, string | null][] = [
    ["created", {}, null, null],
    ["authenticated", {}, "trialing", "2026-10-03T04:00:00.000Z"],
    ["active", { current_end: 1_793_000_000 }, "active", "2026-10-26T07:33:20.000Z"],
    ["pending", { current_end: 1_793_000_000 }, "past_due", "2026-10-26T07:33:20.000Z"],
    ["halted", { current_end: 1_793_000_000 }, "past_due", "2026-10-26T07:33:20.000Z"],
    ["paused", { current_end: 1_793_000_000 }, "paused", "2026-10-26T07:33:20.000Z"],
    ["cancelled", { ended_at: 1_792_000_000 }, "canceled", null],
    ["completed", {}, "canceled", null],
    ["expired", {}, "canceled", null],
  ];
  for (const [status, extra, want, periodEnd] of table) {
    it(`${status} → ${want ?? "nothing written"}`, () => {
      const snap = toRazorpaySnapshot({ ...base, ...extra, status }, PLAN, FETCHED);
      if (want === null) {
        expect(snap).toBeNull();
        return;
      }
      expect(snap).toMatchObject({ status: want, planId: PLAN, updatedAt: FETCHED, cancelAtPeriodEnd: false });
      expect(snap?.currentPeriodEnd?.toISOString() ?? null).toBe(periodEnd);
    });
  }

  it("a mandate given for a trial opens a trial, never a paid plan, and nothing unpaid ever reads as paid", () => {
    for (const [status, extra] of table.map(([s, e]) => [s, e] as const)) {
      const snap = toRazorpaySnapshot({ ...base, ...extra, status }, PLAN, FETCHED);
      if (snap === null) continue;
      const decision = decide({ row: null, otherLive: false, snapshot: snap });
      const paid = decision.kind === "insert" && decision.status === "active";
      expect([status, paid]).toEqual([status, status === "active"]);
    }
  });

  it("an answer had earlier never overwrites one had later", () => {
    const later = toRazorpaySnapshot({ ...base, status: "pending", current_end: 1_793_000_000 }, PLAN, new Date("2026-10-05T10:00:05Z"));
    const earlier = toRazorpaySnapshot({ ...base, status: "active", current_end: 1_793_000_000 }, PLAN, FETCHED);
    if (later === null || earlier === null) throw new Error("no snapshot");
    const row = { status: "past_due" as const, providerUpdatedAt: later.updatedAt, planId: PLAN, currentPeriodEnd: later.currentPeriodEnd, cancelAtPeriodEnd: false, graceEnded: false };
    expect(decide({ row, otherLive: false, snapshot: earlier })).toEqual({ kind: "ignore", reason: "stale" });
  });
});

describe("Razorpay's webhook signature", () => {
  const secret = "a-webhook-secret-chosen-by-kd";
  const body = Buffer.from('{"entity":"event","event":"subscription.charged"}');
  const sign = (b: Buffer, s = secret) => createHmac("sha256", s).update(b).digest("hex");
  it("accepts the HMAC of the raw body under the secret, and nothing else", () => {
    expect(verifyRazorpaySignature(secret, sign(body), body)).toBe(true);
    expect(verifyRazorpaySignature(secret, sign(body, "another-secret-entirely"), body)).toBe(false);
    expect(verifyRazorpaySignature(secret, sign(Buffer.from(body.toString() + " ")), body)).toBe(false);
    expect(verifyRazorpaySignature(secret, sign(body).toUpperCase(), body)).toBe(false);
    expect(verifyRazorpaySignature(secret, sign(body).slice(0, 63), body)).toBe(false);
    expect(verifyRazorpaySignature(secret, undefined, body)).toBe(false);
  });
});

describe("Razorpay's API answers", () => {
  const answering = (status: number, json: unknown) =>
    createRazorpayApi({ keyId: "rzp_test_AAAAAAAAAAAAAA", keySecret: "B".repeat(24), fetchImpl: () => Promise.resolve(new Response(JSON.stringify(json), { status })) });

  it("an id Razorpay does not have is not found, though Razorpay says 400", async () => {
    const api = answering(400, { error: { code: "BAD_REQUEST_ERROR", description: "The ID provided is invalid or could not be found." } });
    expect(await api.getSubscription("sub_ThrbKTOqIAPlzK")).toEqual({ kind: "not_found" });
  });
  it("any other 400 is a refusal, a 429 or 5xx no answer, and a 2xx it cannot read never a success", async () => {
    expect(await answering(400, { error: { code: "BAD_REQUEST_ERROR", description: "start_at cannot be in the past" } }).getSubscription("sub_ThrbKTOqIAPlzK")).toEqual({
      kind: "refused",
      status: 400,
      code: "BAD_REQUEST_ERROR",
    });
    expect(await answering(429, {}).getSubscription("sub_ThrbKTOqIAPlzK")).toEqual({ kind: "unavailable", status: 429 });
    expect(await answering(502, {}).getSubscription("sub_ThrbKTOqIAPlzK")).toEqual({ kind: "unavailable", status: 502 });
    expect(await answering(200, { ...base, status: "somewhere_new" }).getSubscription("sub_ThrbKTOqIAPlzK")).toEqual({ kind: "unavailable", status: 200 });
  });
  it("an id not in Razorpay's shape is never put in a path", async () => {
    let asked = 0;
    const api = createRazorpayApi({
      keyId: "rzp_test_AAAAAAAAAAAAAA",
      keySecret: "B".repeat(24),
      fetchImpl: () => {
        asked += 1;
        return Promise.resolve(new Response("{}", { status: 200 }));
      },
    });
    expect(await api.getSubscription("sub_../../payments")).toEqual({ kind: "not_found" });
    expect(await api.refundPayment("pay_x/refund", "r")).toEqual({ kind: "not_found" });
    expect(asked).toBe(0);
  });
});

describe("which gyms can pay online", () => {
  it("an Indian gym through Razorpay, every other through Paddle", () => {
    expect(onlinePaymentFor("INR", { paddle: true, razorpay: false })).toBe("unavailable");
    expect(onlinePaymentFor("INR", { paddle: false, razorpay: true })).toBe("available");
    expect(onlinePaymentFor("USD", { paddle: false, razorpay: true })).toBe("unavailable");
    expect(onlinePaymentFor("USD", { paddle: true, razorpay: false })).toBe("available");
  });
  it("Razorpay's key and secret are set together, and its webhook secret is needed in production", () => {
    const env = { NODE_ENV: "test", DATABASE_URL: "postgres://x@localhost/x", WEB_ORIGIN: "http://localhost:5173", JWT_SECRET: "x".repeat(32) };
    expect(() => loadConfig({ ...env, RAZORPAY_KEY_ID: "rzp_test_AAAAAAAAAAAAAA" })).toThrow(/set together/);
    expect(() => loadConfig({ ...env, RAZORPAY_KEY_ID: "rzp_test_short", RAZORPAY_KEY_SECRET: "B".repeat(24) })).toThrow(/RAZORPAY_KEY_ID/);
    expect(loadConfig({ ...env, RAZORPAY_KEY_ID: "rzp_test_AAAAAAAAAAAAAA", RAZORPAY_KEY_SECRET: "B".repeat(24) }).RAZORPAY_KEY_ID).toBe("rzp_test_AAAAAAAAAAAAAA");
  });
});
