// Razorpay's API as the billing tests need it (not a test file itself): subscriptions our
// server creates, and the steps Razorpay takes after its window — the mandate given
// (`authenticate`), a payment taken (`charge`), one failed (`fail`) — shaped as Razorpay
// sends them (checked on Kd's test account, 2026-09-29). A failed charge leaves its invoice
// unpaid; a halted plan whose card is changed goes `active` WITHOUT charging it, and only a
// manual charge pays it (Razorpay, "Payment Retries", read 2026-09-30).
import { randomBytes } from "node:crypto";
import type { RazorpayInvoice, RazorpayPayment, RazorpayPlan, RazorpaySubscription } from "@app/shared";
import type { RazorpayApi, RazorpayResult } from "../src/modules/billing/razorpay.js";

const ALPHANUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
export const razorpayId = (prefix: string) =>
  `${prefix}_${Array.from(randomBytes(14), (b) => ALPHANUM[b % ALPHANUM.length] ?? "A").join("")}`;

const MONTH_S = 30 * 24 * 60 * 60;

type CreateInput = {
  planId: string;
  startAt: Date | null;
  notes: Record<string, string>;
  upfront?: { name: string; amountMinor: number; currency: string } | null;
  expireBy?: Date | null;
};

export class FakeRazorpay implements RazorpayApi {
  plans = new Map<string, RazorpayPlan>();
  subs = new Map<string, RazorpaySubscription>();
  invoices = new Map<string, RazorpayInvoice[]>();
  payments = new Map<string, RazorpayPayment>();
  cancelled: string[] = [];
  /** Subscriptions asked to end when their month ends (1d-ii). Razorpay's record does not
   *  show it (tried 2026-10-01): it stays `active` with its next charge set. */
  endAtCycleEnd = new Set<string>();
  refunds: string[] = [];
  /** Every subscription asked for, as asked. */
  created: CreateInput[] = [];
  /** Make the next subscription's add-on invoice carry a different amount than the one asked. */
  wrongUpfront = false;
  down = false;
  /** Make the next subscription's plan carry a different amount than the one on record. */
  wrongAmount = false;
  /** Answer this many refund requests with a 503, making nothing. */
  refundFailures = 0;
  /** Answer this many cancels-at-once with a 503, cancelling nothing. */
  cancelFailures = 0;
  /** Razorpay's clock, in seconds. */
  clock = Math.floor(Date.parse("2026-10-01T00:00:00Z") / 1000);

  addPlan(amount: number, currency = "INR"): string {
    const id = razorpayId("plan");
    this.plans.set(id, {
      id,
      entity: "plan",
      period: "monthly",
      interval: 1,
      item: { active: true, amount, currency, name: `Monthly, ${String(amount)}` },
      notes: {},
    });
    return id;
  }

  private ok<T>(value: T): RazorpayResult<T> {
    return this.down ? { kind: "unavailable", status: 503 } : { kind: "ok", value };
  }

  /** A bigger size's add-on (1d-iii-a) is an invoice Razorpay makes with the subscription, owed
   *  until the window is paid, which pays it (seen on the test account, 2026-10-01). */
  createSubscription(input: CreateInput): Promise<RazorpayResult<RazorpaySubscription>> {
    if (this.down) return Promise.resolve({ kind: "unavailable", status: 503 });
    const plan = this.plans.get(input.planId);
    if (plan === undefined) return Promise.resolve({ kind: "refused", status: 400, code: "BAD_REQUEST_ERROR" });
    this.created.push({ ...input });
    const id = razorpayId("sub");
    const startAt = input.startAt === null ? null : Math.ceil(input.startAt.getTime() / 1000);
    const sub: RazorpaySubscription = {
      id,
      entity: "subscription",
      plan_id: input.planId,
      customer_id: null,
      status: "created",
      current_start: null,
      current_end: null,
      ended_at: null,
      charge_at: startAt,
      start_at: startAt,
      quantity: 1,
      total_count: 120,
      paid_count: 0,
      notes: { ...input.notes },
      created_at: this.clock,
      expire_by: input.expireBy == null ? null : Math.floor(input.expireBy.getTime() / 1000),
    };
    this.subs.set(id, sub);
    if (input.upfront != null) {
      const amount = input.upfront.amountMinor + (this.wrongUpfront ? 100 : 0);
      this.invoices.set(id, [this.invoice({ status: "issued", subscription_id: id, payment_id: null, amount, amount_paid: 0, amount_due: amount, paid_at: null, billing_end: null })]);
    }
    this.wrongUpfront = false;
    const shown = this.wrongAmount ? { ...plan, item: { ...plan.item, amount: plan.item.amount + 100 } } : plan;
    this.wrongAmount = false;
    return Promise.resolve({ kind: "ok", value: { ...sub, plan: shown } });
  }

  /** Run once inside the next fetch, after its answer is read and before it is returned: a
   *  slow answer, overtaken by whatever this does. */
  duringNextGet: (() => Promise<unknown>) | null = null;

  async getSubscription(id: string): Promise<RazorpayResult<RazorpaySubscription>> {
    const sub = this.subs.get(id);
    if (sub === undefined) return { kind: "not_found" };
    const answer = this.ok({ ...sub });
    const during = this.duringNextGet;
    this.duringNextGet = null;
    if (during !== null) await during();
    return answer;
  }

  cancelSubscriptionNow(id: string): Promise<RazorpayResult<RazorpaySubscription>> {
    if (this.down) return Promise.resolve({ kind: "unavailable", status: 503 });
    if (this.cancelFailures > 0) {
      this.cancelFailures -= 1;
      return Promise.resolve({ kind: "unavailable", status: 503 });
    }
    const sub = this.subs.get(id);
    if (sub === undefined) return Promise.resolve({ kind: "not_found" });
    // Razorpay refuses to cancel a plan it has ended ("Subscription is not cancellable in
    // cancelled status.", tried 2026-10-01).
    if (sub.status === "cancelled" || sub.status === "completed" || sub.status === "expired") {
      return Promise.resolve({ kind: "refused", status: 400, code: "BAD_REQUEST_ERROR" });
    }
    this.cancelled.push(id);
    const ended = { ...sub, status: "cancelled" as const, ended_at: this.clock, charge_at: null };
    this.subs.set(id, ended);
    return Promise.resolve({ kind: "ok", value: ended });
  }

  cancelSubscriptionAtCycleEnd(id: string): Promise<RazorpayResult<RazorpaySubscription>> {
    if (this.down) return Promise.resolve({ kind: "unavailable", status: 503 });
    const sub = this.subs.get(id);
    if (sub === undefined) return Promise.resolve({ kind: "not_found" });
    // Razorpay refuses it for a plan with no month started yet.
    if (sub.status !== "active" && sub.status !== "pending" && sub.status !== "halted") {
      return Promise.resolve({ kind: "refused", status: 400, code: "BAD_REQUEST_ERROR" });
    }
    this.endAtCycleEnd.add(id);
    return Promise.resolve({ kind: "ok", value: { ...sub } });
  }

  /** The month ends at Razorpay: a plan asked to end then is cancelled, any other is charged. */
  endCycle(id: string): void {
    const sub = this.sub(id);
    if (this.endAtCycleEnd.has(id)) {
      this.subs.set(id, { ...sub, status: "cancelled", ended_at: sub.current_end ?? this.clock, charge_at: null });
      return;
    }
    this.charge(id);
  }

  listSubscriptionInvoices(subscriptionId: string): Promise<RazorpayResult<RazorpayInvoice[]>> {
    return Promise.resolve(this.ok([...(this.invoices.get(subscriptionId) ?? [])]));
  }

  getPayment(id: string): Promise<RazorpayResult<RazorpayPayment>> {
    const payment = this.payments.get(id);
    if (payment === undefined) return Promise.resolve({ kind: "not_found" });
    return Promise.resolve(this.ok({ ...payment }));
  }

  refundPayment(id: string): Promise<RazorpayResult<null>> {
    if (this.down) return Promise.resolve({ kind: "unavailable", status: 503 });
    if (this.refundFailures > 0) {
      this.refundFailures -= 1;
      return Promise.resolve({ kind: "unavailable", status: 503 });
    }
    const payment = this.payments.get(id);
    if (payment === undefined) return Promise.resolve({ kind: "not_found" });
    this.refunds.push(id);
    this.payments.set(id, { ...payment, status: "refunded", amount_refunded: payment.amount });
    return Promise.resolve({ kind: "ok", value: null });
  }

  getPlan(id: string): Promise<RazorpayResult<RazorpayPlan>> {
    const plan = this.plans.get(id);
    if (plan === undefined) return Promise.resolve({ kind: "not_found" });
    return Promise.resolve(this.ok(plan));
  }

  private sub(id: string): RazorpaySubscription {
    const sub = this.subs.get(id);
    if (sub === undefined) throw new Error(`fake Razorpay has no ${id}`);
    return sub;
  }

  /** An invoice as Razorpay lists it: made now (each one a second after the last, so the newest
   *  is always last), with its own page. */
  private invoiceSeq = 0;
  private invoice(fields: Omit<RazorpayInvoice, "id" | "entity" | "created_at" | "short_url">): RazorpayInvoice {
    this.invoiceSeq += 1;
    const id = razorpayId("inv");
    return { id, entity: "invoice", created_at: this.clock + this.invoiceSeq, short_url: `https://rzp.io/rzp/${id.slice(4, 12)}`, ...fields };
  }

  /** A month's bill Razorpay made for a halted plan and did not charge (its "Payment Retries"
   *  page): owed until it is paid from its own page. */
  billUncharged(id: string): void {
    const sub = this.sub(id);
    const plan = this.plans.get(sub.plan_id);
    if (plan === undefined) throw new Error("fake Razorpay lost a plan");
    const list = this.invoices.get(id) ?? [];
    // The month after the last one billed.
    const from = list.reduce((end, i) => Math.max(end, i.billing_end ?? 0), sub.current_end ?? this.clock);
    list.push(this.invoice({ status: "issued", subscription_id: id, payment_id: null, amount_paid: 0, amount_due: plan.item.amount, paid_at: null, billing_end: from + MONTH_S }));
    this.invoices.set(id, list);
  }

  /** One owed bill paid from its own page: the plan's state is left as Razorpay left it. */
  payInvoice(invoiceId: string): void {
    for (const [subId, list] of this.invoices) {
      const index = list.findIndex((i) => i.id === invoiceId);
      const inv = list[index];
      if (inv === undefined) continue;
      const paymentId = razorpayId("pay");
      const amount = inv.amount_due ?? 0;
      this.payments.set(paymentId, { id: paymentId, entity: "payment", amount, currency: "INR", status: "captured", amount_refunded: 0 });
      list[index] = { ...inv, status: "paid", payment_id: paymentId, amount_paid: amount, amount_due: 0, paid_at: this.clock };
      this.invoices.set(subId, list);
      return;
    }
    throw new Error(`fake Razorpay has no invoice ${invoiceId}`);
  }

  /** The window is paid: with a start date the mandate is given and nothing charged yet;
   *  without one the first payment is taken at once. */
  authenticate(id: string): void {
    const sub = this.sub(id);
    if (sub.expire_by != null && this.clock > sub.expire_by) throw new Error("fake Razorpay: this window has expired");
    if (sub.status !== "created") throw new Error(`fake Razorpay: a ${sub.status} subscription has no window to pay`);
    // The add-on is taken as the window is paid.
    const owed = (this.invoices.get(id) ?? []).find((i) => i.status === "issued" && i.billing_end === null);
    if (owed !== undefined) this.payInvoice(owed.id);
    const customer = razorpayId("cust");
    if (sub.start_at !== null && sub.start_at > this.clock) {
      this.subs.set(id, { ...sub, status: "authenticated", customer_id: customer });
      return;
    }
    this.subs.set(id, { ...sub, customer_id: customer });
    this.charge(id);
  }

  /** Razorpay takes a month's payment: the first, or the next. */
  charge(id: string): string {
    const sub = this.sub(id);
    const plan = this.plans.get(sub.plan_id);
    if (plan === undefined) throw new Error("fake Razorpay lost a plan");
    const start = sub.current_end ?? Math.max(sub.start_at ?? this.clock, this.clock);
    const paymentId = razorpayId("pay");
    this.payments.set(paymentId, { id: paymentId, entity: "payment", amount: plan.item.amount, currency: plan.item.currency, status: "captured", amount_refunded: 0 });
    const list = this.invoices.get(id) ?? [];
    list.push(this.invoice({ status: "paid", subscription_id: id, payment_id: paymentId, amount_paid: plan.item.amount, amount_due: 0, paid_at: this.clock, billing_end: start + MONTH_S }));
    this.invoices.set(id, list);
    this.subs.set(id, {
      ...sub,
      status: "active",
      current_start: start,
      current_end: start + MONTH_S,
      charge_at: start + MONTH_S,
      paid_count: sub.paid_count + 1,
    });
    return paymentId;
  }

  /** A payment fails: Razorpay retries (`pending`), then gives up (`halted`). The month's
   *  invoice stays unpaid (made once, on the first failure). */
  fail(id: string, status: "pending" | "halted" = "pending"): void {
    const sub = this.sub(id);
    const plan = this.plans.get(sub.plan_id);
    const list = this.invoices.get(id) ?? [];
    if (sub.status !== "pending" && sub.status !== "halted" && plan !== undefined) {
      // The bill is for the month starting where the paid one ends.
      const from = sub.current_end ?? this.clock;
      list.push(this.invoice({ status: "issued", subscription_id: id, payment_id: null, amount_paid: 0, amount_due: plan.item.amount, paid_at: null, billing_end: from + MONTH_S }));
      this.invoices.set(id, list);
    }
    this.subs.set(id, { ...sub, status });
  }

  /** Razorpay's own retry of a failed month succeeds: the SAME invoice is paid (its "Payment
   *  Retries" page: the charge is reattempted), and the month runs on. */
  retrySucceeds(id: string): void {
    this.chargeUnpaid(id);
  }

  /** The payer changes the card on a halted plan: `active` again, and nothing charged. */
  changeCard(id: string): void {
    this.subs.set(id, { ...this.sub(id), status: "active" });
  }

  /** The unpaid invoices charged by hand: each is paid, with a payment of its own. */
  chargeUnpaid(id: string): void {
    const list = this.invoices.get(id) ?? [];
    this.invoices.set(
      id,
      list.map((inv) => {
        if (inv.status !== "issued") return inv;
        const paymentId = razorpayId("pay");
        const amount = inv.amount_due ?? 0;
        this.payments.set(paymentId, { id: paymentId, entity: "payment", amount, currency: "INR", status: "captured", amount_refunded: 0 });
        return { ...inv, status: "paid", payment_id: paymentId, amount_paid: amount, amount_due: 0, paid_at: this.clock };
      }),
    );
    this.subs.set(id, { ...this.sub(id), status: "active" });
  }

  /** A window not paid by its `expire_by`: Razorpay expires the subscription. */
  expire(id: string): void {
    this.subs.set(id, { ...this.sub(id), status: "expired", ended_at: this.clock, charge_at: null });
  }

  /** A subscription made by something other than our server on the same Razorpay account. */
  foreign(planId: string): string {
    const id = razorpayId("sub");
    this.subs.set(id, {
      id,
      entity: "subscription",
      plan_id: planId,
      customer_id: razorpayId("cust"),
      status: "created",
      current_start: null,
      current_end: null,
      ended_at: null,
      charge_at: null,
      start_at: null,
      quantity: 1,
      total_count: 12,
      paid_count: 0,
      notes: { app: "travel" },
      created_at: this.clock,
    });
    this.charge(id);
    return id;
  }
}
