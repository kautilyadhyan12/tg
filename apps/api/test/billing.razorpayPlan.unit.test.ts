// The two rules for a plan paid through Razorpay (ROADMAP Stage 3 item 1d-ii): what Razorpay's
// record means for a plan set to end, and whether a bill is still owed. Every class of case,
// and Razorpay's own replies from the test account (2026-10-01): a plan cancelled at the end
// of its month reads exactly as one never cancelled. No database.
import { readFileSync } from "node:fs";
import {
  razorpayInvoiceListSchema,
  razorpayPayLinkSchema,
  razorpaySubscriptionSchema,
  type RazorpayInvoice,
  type RazorpaySubscription,
} from "@app/shared";
import { describe, expect, it } from "vitest";
import {
  oldestOwedInvoice,
  razorpayCancelOutcome,
  razorpayOwes,
  type CancelOutcome,
  type CancelRow,
} from "../src/modules/billing/razorpayPlan.js";

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

const END = new Date("2026-11-01T00:00:00Z");
const END_S = END.getTime() / 1000;
const MONTH_S = 30 * 24 * 60 * 60;
const BEFORE = new Date("2026-10-20T00:00:00Z");
const AFTER = new Date("2026-11-01T00:05:00Z");

const sub = (over: Partial<RazorpaySubscription>): RazorpaySubscription => ({
  id: "sub_ThrbKTOqIAPlzK",
  entity: "subscription",
  plan_id: "plan_ThrbJtE8RBqR7l",
  customer_id: "cust_ThvM0iDsFAQ3Wu",
  status: "active",
  current_start: END_S - MONTH_S,
  current_end: END_S,
  ended_at: null,
  charge_at: END_S,
  start_at: END_S - MONTH_S,
  quantity: 1,
  total_count: 120,
  paid_count: 1,
  notes: { app: "aihg" },
  created_at: END_S - MONTH_S,
  ...over,
});

const row = (over: Partial<CancelRow>): CancelRow => ({
  status: "active",
  cancelAtPeriodEnd: true,
  currentPeriodEnd: END,
  endedAt: null,
  ...over,
});

describe("what Razorpay's record means for a plan set to end", () => {
  const table: [string, CancelRow | null, Partial<RazorpaySubscription>, Date, CancelOutcome][] = [
    ["no row of ours", null, {}, BEFORE, { kind: "none" }],
    ["not set to end, active", row({ cancelAtPeriodEnd: false }), {}, BEFORE, { kind: "none" }],
    ["not set to end, Razorpay cancelled it", row({ cancelAtPeriodEnd: false }), { status: "cancelled" }, BEFORE, { kind: "none" }],
    ["not set to end, renewed", row({ cancelAtPeriodEnd: false }), { current_end: END_S + MONTH_S }, AFTER, { kind: "none" }],
    // THE WORST THING: the gym keeps what it paid for until the month ends.
    ["set to end, month running, Razorpay still active", row({}), {}, BEFORE, { kind: "scheduled" }],
    ["set to end, month running, Razorpay already ended it", row({}), { status: "cancelled", ended_at: END_S - 100 }, BEFORE, { kind: "keep_live" }],
    ["set to end, month running, Razorpay completed it", row({}), { status: "completed" }, BEFORE, { kind: "keep_live" }],
    ["set to end, month running, Razorpay expired it", row({}), { status: "expired" }, BEFORE, { kind: "keep_live" }],
    ["set to end, one second before the end", row({}), {}, new Date(END.getTime() - 1000), { kind: "scheduled" }],
    ["set to end, at the end exactly", row({}), {}, END, { kind: "ended" }],
    ["set to end, month over, Razorpay not yet flipped", row({}), {}, AFTER, { kind: "ended" }],
    ["set to end, month over, Razorpay cancelled", row({}), { status: "cancelled" }, AFTER, { kind: "ended" }],
    ["set to end, Razorpay charged the next month anyway", row({}), { current_end: END_S + MONTH_S }, AFTER, { kind: "refund_after", after: END }],
    ["set to end, next month charged before the end was asked", row({}), { current_end: END_S + MONTH_S }, BEFORE, { kind: "refund_after", after: END }],
    ["set to end, Razorpay's period end 30 s later is the same month", row({}), { current_end: END_S + 30 }, BEFORE, { kind: "scheduled" }],
    ["set to end, Razorpay's period end 2 min later is a new month", row({}), { current_end: END_S + 120 }, BEFORE, { kind: "refund_after", after: END }],
    ["paid trial set to end, not yet charged", row({ status: "trialing" }), { status: "authenticated", current_end: null, current_start: null }, BEFORE, { kind: "scheduled" }],
    ["paid trial set to end, Razorpay ended it at once", row({ status: "trialing" }), { status: "cancelled", current_end: null }, BEFORE, { kind: "keep_live" }],
    ["paid trial set to end, trial over", row({ status: "trialing" }), { status: "cancelled", current_end: null }, AFTER, { kind: "ended" }],
    ["paid trial set to end, first month charged anyway", row({ status: "trialing" }), { status: "active", current_end: END_S + MONTH_S }, AFTER, { kind: "refund_after", after: END }],
    ["overdue plan ended at once", row({ status: "past_due" }), { status: "cancelled" }, BEFORE, { kind: "scheduled" }],
    ["set to end, no period end held", row({ currentPeriodEnd: null }), {}, AFTER, { kind: "scheduled" }],
    ["ended for our cancel, Razorpay charged after", row({ status: "expired", endedAt: AFTER }), { current_end: END_S + MONTH_S }, AFTER, { kind: "refund_after", after: AFTER }],
    ["ended for our cancel, Razorpay retrying a charge", row({ status: "expired", endedAt: AFTER }), { status: "pending" }, AFTER, { kind: "refund_after", after: AFTER }],
    ["ended for our cancel, Razorpay halted", row({ status: "expired", endedAt: AFTER }), { status: "halted" }, AFTER, { kind: "refund_after", after: AFTER }],
    ["ended for our cancel, no end time held: the paid month's end", row({ status: "expired", endedAt: null }), {}, AFTER, { kind: "refund_after", after: END }],
    ["ended for our cancel, Razorpay cancelled too", row({ status: "expired", endedAt: AFTER }), { status: "cancelled" }, AFTER, { kind: "none" }],
    ["ended unpaid (grace), not set to end", row({ status: "expired", cancelAtPeriodEnd: false, endedAt: AFTER }), { status: "halted" }, AFTER, { kind: "none" }],
  ];
  it.each(table)("%s", (_name, ourRow, over, askedAt, expected) => {
    expect(razorpayCancelOutcome(ourRow, sub(over), askedAt)).toEqual(expected);
  });

  it("Razorpay's own reply after a cancel at the end of the month reads as still set to end, never as kept or ended", () => {
    // Fetched from the test account after `cancel_at_cycle_end: 1` was accepted: `active`, the
    // next charge still set, nothing scheduled. Its id and links are replaced (a public repo).
    const real = razorpaySubscriptionSchema.parse(fixture("razorpay-subscription-cancel-at-cycle-end.json"));
    expect(real.status).toBe("active");
    expect(real.charge_at).toBe(real.current_end);
    const end = new Date((real.current_end ?? 0) * 1000);
    const ours = row({ currentPeriodEnd: end });
    expect(razorpayCancelOutcome(ours, real, new Date(end.getTime() - 24 * 60 * 60 * 1000))).toEqual({ kind: "scheduled" });
    expect(razorpayCancelOutcome(ours, real, end)).toEqual({ kind: "ended" });
    // The same record with no cancel of ours is a plan that renews.
    expect(razorpayCancelOutcome({ ...ours, cancelAtPeriodEnd: false }, real, end)).toEqual({ kind: "none" });
  });
});

describe("is a bill of this plan still owed", () => {
  const SUB = "sub_ThrbKTOqIAPlzK";
  const inv = (status: string, created: number, over: Partial<RazorpayInvoice> = {}): RazorpayInvoice => ({
    id: `inv_${String(created).padStart(14, "0").slice(-14)}`,
    entity: "invoice",
    status,
    subscription_id: SUB,
    payment_id: null,
    amount_paid: status === "paid" ? 750000 : 0,
    amount_due: status === "paid" ? 0 : 750000,
    paid_at: status === "paid" ? created + 60 : null,
    created_at: created,
    short_url: `https://rzp.io/rzp/x${String(created)}`,
    ...over,
  });
  const table: [string, RazorpaySubscription["status"], RazorpayInvoice[], boolean][] = [
    ["active, every bill paid", "active", [inv("paid", 1), inv("paid", 2)], false],
    ["active, no bills listed", "active", [], false],
    ["active, an old bill issued (card changed after it halted)", "active", [inv("issued", 1), inv("paid", 2)], true],
    ["active, a bill partly paid", "active", [inv("partially_paid", 1)], true],
    ["pending, the failed bill issued", "pending", [inv("paid", 1), inv("issued", 2)], true],
    ["pending, the failed bill paid from its page", "pending", [inv("paid", 1), inv("paid", 2)], false],
    ["halted, the bill paid from its page", "halted", [inv("paid", 1), inv("paid", 2)], false],
    ["halted, two months unpaid", "halted", [inv("paid", 1), inv("issued", 2), inv("issued", 3)], true],
    // A state this code does not know never reads as paid while Razorpay says a payment failed.
    ["halted, newest bill expired", "halted", [inv("paid", 1), inv("expired", 2)], true],
    ["halted, newest bill cancelled", "halted", [inv("paid", 1), inv("cancelled", 2)], true],
    ["halted, newest bill in a new state", "halted", [inv("paid", 1), inv("on_hold", 2)], true],
    ["halted, no bills listed", "halted", [], true],
    ["pending, an older cancelled bill and the newest paid", "pending", [inv("cancelled", 1), inv("paid", 2)], false],
    ["active, another plan's bill issued", "active", [inv("issued", 1, { subscription_id: "sub_OtherOtherOthe" })], false],
    ["halted, the only paid bill is another plan's", "halted", [inv("paid", 3, { subscription_id: "sub_OtherOtherOthe" }), inv("issued", 2, { status: "expired" })], true],
    ["halted, newest by payment time when Razorpay sent no creation time", "halted", [inv("expired", 1), inv("paid", 0, { created_at: undefined, paid_at: 5 })], false],
  ];
  it.each(table)("%s", (_name, status, invoices, owed) => {
    expect(razorpayOwes(sub({ id: SUB, status }), invoices)).toBe(owed);
  });

  it("Pay now opens the oldest bill owed, of this plan only", () => {
    const list = [inv("paid", 1), inv("issued", 3), inv("issued", 2), inv("issued", 0, { subscription_id: "sub_OtherOtherOthe" })];
    expect(oldestOwedInvoice(SUB, list)?.created_at).toBe(2);
    expect(oldestOwedInvoice(SUB, [inv("paid", 1)])).toBeNull();
    expect(oldestOwedInvoice(SUB, [inv("partially_paid", 4)])?.created_at).toBe(4);
  });

  it("Razorpay's own paid bill reads as paid, and its page is a link the console may open", () => {
    const real = razorpayInvoiceListSchema.parse(fixture("razorpay-invoices-paid.json")).items;
    const first = real[0];
    expect(first?.status).toBe("paid");
    expect(typeof first?.created_at).toBe("number");
    expect(razorpayOwes(sub({ id: "sub_FixtureCancel0", status: "active" }), real)).toBe(false);
    expect(razorpayOwes(sub({ id: "sub_FixtureCancel0", status: "halted" }), real)).toBe(false);
    expect(razorpayPayLinkSchema.safeParse(first?.short_url).success).toBe(true);
  });
});

describe("a Razorpay page link", () => {
  const table: [string, boolean][] = [
    ["https://rzp.io/rzp/MUp0Qi83", true],
    ["https://rzp.io/i/abc", true],
    ["https://razorpay.com/invoices/x", true],
    ["https://api.razorpay.com/v1/t/invoices/inv_x", true],
    ["http://rzp.io/rzp/MUp0Qi83", false],
    ["https://rzp.io.evil.example/rzp/x", false],
    ["https://evilrazorpay.com/x", false],
    ["https://user:pw@rzp.io/x", false],
    ["https://rzp.io:8443/x", false],
    ["javascript:alert(1)", false],
    ["//rzp.io/x", false],
    ["", false],
  ];
  it.each(table)("%s → %s", (link, ok) => {
    expect(razorpayPayLinkSchema.safeParse(link).success).toBe(ok);
  });
});
