// Paddle's API as the billing tests need it (not a test file itself): transactions our
// server makes, a `pay` that turns one into an active subscription the way a completed
// checkout does, and the customer portal's sessions.
import { randomBytes } from "node:crypto";
import type { PaddlePortalSession, PaddleSubscription, PaddleTransaction } from "@app/shared";
import type { PaddleApi, PaddleResult } from "../src/modules/billing/paddle.js";

export const paddleId = (prefix: string) => `${prefix}_${randomBytes(20).toString("hex").slice(0, 26)}`;

export class FakePaddle implements PaddleApi {
  txns = new Map<string, PaddleTransaction>();
  subs = new Map<string, PaddleSubscription>();
  customData = new Map<string, Record<string, string>>();
  cancelledTxns: string[] = [];
  cancelledSubs: string[] = [];
  refunds: string[] = [];
  adjustments = new Map<string, { action: string; status: "pending_approval" | "approved" | "rejected" | "reversed" }[]>();
  /** Every portal session asked for: the customer and the subscriptions named. */
  portalCalls: { customerId: string; subscriptionIds: string[] }[] = [];
  /** Answer the next portal session for a different customer than the one asked. */
  portalWrongCustomer = false;
  /** Answer this many refund requests with a 503, making nothing. */
  refundFailures = 0;
  /** Make the next refund, but lose its answer (a timeout). */
  loseRefundAnswer = false;
  created = 0;
  down = false;
  /** Make the next transaction carry a different amount than the one asked for. */
  wrongAmount = false;
  clock = Date.parse("2026-10-01T00:00:00Z");

  constructor(private readonly prices: Record<string, { amount: string; currency: string }>) {}

  private ok<T>(value: T): PaddleResult<T> {
    return this.down ? { kind: "unavailable", status: 503 } : { kind: "ok", value };
  }

  createTransaction(input: { priceId: string; customData: Record<string, string> }) {
    if (this.down) return Promise.resolve<PaddleResult<PaddleTransaction>>({ kind: "unavailable", status: 503 });
    this.created += 1;
    const price = this.prices[input.priceId] ?? { amount: "0", currency: "USD" };
    const txn: PaddleTransaction = {
      id: paddleId("txn"),
      status: "draft",
      subscription_id: null,
      origin: "api",
      currency_code: price.currency,
      items: [{ quantity: 1, price: { id: input.priceId, unit_price: { amount: this.wrongAmount ? "1" : price.amount, currency_code: price.currency } } }],
    };
    this.wrongAmount = false;
    this.txns.set(txn.id, txn);
    this.customData.set(txn.id, input.customData);
    return Promise.resolve(this.ok(txn));
  }
  getTransaction(id: string) {
    const txn = this.txns.get(id);
    return Promise.resolve<PaddleResult<PaddleTransaction>>(
      txn === undefined ? { kind: "not_found" } : this.ok({ ...txn, adjustments: this.adjustments.get(id) ?? [] }),
    );
  }
  cancelTransaction(id: string) {
    this.cancelledTxns.push(id);
    return Promise.resolve<PaddleResult<null>>(this.ok(null));
  }
  getSubscription(id: string) {
    const sub = this.subs.get(id);
    return Promise.resolve<PaddleResult<PaddleSubscription>>(sub === undefined ? { kind: "not_found" } : this.ok(sub));
  }
  /** Refuse to list transactions, as a key without that permission would. */
  listRefused = false;
  listSubscriptionTransactions(subscriptionId: string) {
    if (this.listRefused) return Promise.resolve<PaddleResult<PaddleTransaction[]>>({ kind: "refused", status: 403, code: "forbidden" });
    return Promise.resolve(this.ok([...this.txns.values()].filter((t) => t.subscription_id === subscriptionId)));
  }
  cancelSubscriptionNow(id: string) {
    this.cancelledSubs.push(id);
    this.update(id, { status: "canceled", canceled_at: this.tick() });
    return Promise.resolve<PaddleResult<null>>(this.ok(null));
  }
  refundTransaction(id: string) {
    if (this.refundFailures > 0) {
      this.refundFailures -= 1;
      return Promise.resolve<PaddleResult<null>>({ kind: "unavailable", status: 503 });
    }
    // Paddle refunds only a completed transaction.
    if (this.txns.get(id)?.status !== "completed") {
      return Promise.resolve<PaddleResult<null>>({ kind: "refused", status: 400, code: "transaction_status_not_completed" });
    }
    this.refunds.push(id);
    this.adjustments.set(id, [...(this.adjustments.get(id) ?? []), { action: "refund", status: "pending_approval" }]);
    if (this.loseRefundAnswer) {
      this.loseRefundAnswer = false;
      return Promise.resolve<PaddleResult<null>>({ kind: "unavailable", status: null });
    }
    return Promise.resolve<PaddleResult<null>>(this.ok(null));
  }
  createPortalSession(customerId: string, subscriptionIds: readonly string[]) {
    this.portalCalls.push({ customerId, subscriptionIds: [...subscriptionIds] });
    const token = randomBytes(8).toString("hex");
    const base = `https://sandbox-customer-portal.paddle.com/cpl_${paddleId("x").slice(2)}`;
    const session: PaddlePortalSession = {
      customer_id: this.portalWrongCustomer ? paddleId("ctm") : customerId,
      urls: {
        general: { overview: `${base}?action=overview&token=${token}` },
        subscriptions: subscriptionIds.map((id) => ({
          id,
          cancel_subscription: `${base}?action=cancel_subscription&subscription_id=${id}&token=${token}`,
          update_subscription_payment_method: `${base}?action=update_subscription_payment_method&subscription_id=${id}&token=${token}`,
        })),
      },
    };
    this.portalWrongCustomer = false;
    return Promise.resolve(this.ok(session));
  }

  tick(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  /** The customer pays a transaction: Paddle makes the subscription and, unless told
   *  otherwise, completes the transaction at once (in Paddle it stays "paid" for about a
   *  second first, measured on Kd's sandbox payment by the round-one review). */
  pay(txnId: string, origin = "api", complete = true): string {
    const txn = this.txns.get(txnId);
    if (txn === undefined) throw new Error("no such transaction");
    const subId = paddleId("sub");
    this.txns.set(txnId, { ...txn, status: complete ? "completed" : "paid", subscription_id: subId, origin });
    this.subs.set(subId, {
      id: subId,
      status: "active",
      customer_id: paddleId("ctm"),
      currency_code: txn.currency_code,
      updated_at: this.tick(),
      canceled_at: null,
      paused_at: null,
      current_billing_period: { starts_at: "2026-10-01T00:00:00Z", ends_at: "2026-11-01T00:00:00Z" },
      scheduled_change: null,
      items: txn.items.map((i) => ({ quantity: i.quantity, price: { id: i.price.id } })),
    });
    return subId;
  }

  complete(txnId: string): void {
    const txn = this.txns.get(txnId);
    if (txn === undefined) throw new Error("no such transaction");
    this.txns.set(txnId, { ...txn, status: "completed" });
  }

  update(subId: string, patch: Partial<PaddleSubscription>): void {
    const sub = this.subs.get(subId);
    if (sub === undefined) throw new Error("no such subscription");
    this.subs.set(subId, { ...sub, updated_at: this.tick(), ...patch });
  }
}
