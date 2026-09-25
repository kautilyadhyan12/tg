// Paddle's API as the billing tests need it (not a test file itself): transactions our
// server makes, a `pay` that turns one into an active subscription (or, for a trial
// checkout, a trialing one) the way a completed checkout does, the customer portal's
// sessions, and a subscription's price previewed and changed (1c-ii).
import { randomBytes } from "node:crypto";
import type { PaddlePortalSession, PaddlePrice, PaddleSubscription, PaddleSubscriptionPreview, PaddleTransaction } from "@app/shared";
import type { PaddleApi, PaddleResult, ProrationMode, TrialCheckout } from "../src/modules/billing/paddle.js";

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
  /** Every price change asked for, and every amount charged for one. */
  changeCalls: { subscriptionId: string; priceId: string; mode: ProrationMode }[] = [];
  charges: { subscriptionId: string; amount: number }[] = [];
  /** Refuse the next change as a declined card would (Paddle changes nothing). */
  declineNextChange = false;
  /** Refuse the next change to this subscription only. */
  declineChangeFor: string | null = null;
  /** Make the next change, but lose its answer (a timeout). */
  loseChangeAnswer = false;
  /** Hold each change this long before answering, so two presses overlap. */
  changeDelayMs = 0;
  /** Run once while the next change is being made, before it lands (something else at that instant). */
  duringNextChange: (() => Promise<unknown>) | null = null;
  /** The trial checkouts asked for. */
  trialCheckouts: TrialCheckout[] = [];
  /** Make the next trial checkout's price carry another plan's code, or another length. */
  wrongTrial: "code" | "days" | null = null;
  /** Trials moved (and to when), and trials ended at once. */
  trialMoves: { subscriptionId: string; at: string }[] = [];
  activations: string[] = [];
  /** Refuse the next trial's charge-now, as a declined card would. */
  refuseNextActivation = false;
  static readonly PRODUCT = "pro_" + "0".repeat(26);

  constructor(private readonly prices: Record<string, { amount: string; currency: string }>) {}

  private ok<T>(value: T): PaddleResult<T> {
    return this.down ? { kind: "unavailable", status: 503 } : { kind: "ok", value };
  }

  createTransaction(input: { priceId: string; customData: Record<string, string>; trial?: TrialCheckout }) {
    if (this.down) return Promise.resolve<PaddleResult<PaddleTransaction>>({ kind: "unavailable", status: 503 });
    this.created += 1;
    const trial = input.trial;
    const price = trial === undefined ? (this.prices[input.priceId] ?? { amount: "0", currency: "USD" }) : { amount: String(trial.amountMinor), currency: trial.currency };
    if (trial !== undefined) this.trialCheckouts.push(trial);
    const txn: PaddleTransaction = {
      id: paddleId("txn"),
      status: "draft",
      subscription_id: null,
      origin: "api",
      currency_code: price.currency,
      items: [
        {
          quantity: 1,
          price: {
            // A trial checkout's price is made for it, with an id of its own.
            id: trial === undefined ? input.priceId : paddleId("pri"),
            unit_price: { amount: this.wrongAmount ? "1" : price.amount, currency_code: price.currency },
            ...(trial === undefined
              ? {}
              : {
                  trial_period: { interval: "day" as const, frequency: this.wrongTrial === "days" ? trial.trialDays + 30 : trial.trialDays },
                  custom_data: { plan_code: this.wrongTrial === "code" ? "zz_someone_elses" : trial.planCode },
                }),
          },
        },
      ],
      details: { totals: { grand_total: trial === undefined ? price.amount : "0" } },
    };
    this.wrongAmount = false;
    this.wrongTrial = null;
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

  getPrice(id: string) {
    const price = this.prices[id];
    if (price === undefined) return Promise.resolve<PaddleResult<PaddlePrice>>({ kind: "not_found" });
    return Promise.resolve<PaddleResult<PaddlePrice>>(
      this.ok({
        id,
        product_id: FakePaddle.PRODUCT,
        name: "Monthly",
        status: "active",
        tax_mode: "external",
        unit_price: { amount: price.amount, currency_code: price.currency },
        billing_cycle: { interval: "month", frequency: 1 },
        quantity: { minimum: 1, maximum: 1 },
        custom_data: null,
      }),
    );
  }

  /** Half the month is left in these tests: the rest of the month costs half the difference. */
  private proration(sub: PaddleSubscription, priceId: string): number {
    const from = Number(sub.items[0]?.price.unit_price?.amount ?? this.prices[sub.items[0]?.price.id ?? ""]?.amount ?? "0");
    const to = Number(this.prices[priceId]?.amount ?? "0");
    return Math.floor((to - from) / 2);
  }

  previewPriceChange(subscriptionId: string, priceId: string, mode: ProrationMode) {
    const sub = this.subs.get(subscriptionId);
    if (sub === undefined) return Promise.resolve<PaddleResult<PaddleSubscriptionPreview>>({ kind: "not_found" });
    const due = this.proration(sub, priceId);
    const tax = Math.floor(due / 10);
    return Promise.resolve<PaddleResult<PaddleSubscriptionPreview>>(
      this.ok({
        next_billed_at: sub.next_billed_at ?? null,
        immediate_transaction:
          mode === "do_not_bill"
            ? null
            : { details: { totals: { subtotal: String(due), tax: String(tax), grand_total: String(due + tax), currency_code: sub.currency_code } } },
      }),
    );
  }

  async changePrice(subscriptionId: string, priceId: string, mode: ProrationMode): Promise<PaddleResult<PaddleSubscription>> {
    this.changeCalls.push({ subscriptionId, priceId, mode });
    if (this.changeDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.changeDelayMs));
    const during = this.duringNextChange;
    this.duringNextChange = null;
    if (during !== null) await during();
    if (this.down) return { kind: "unavailable", status: 503 };
    const sub = this.subs.get(subscriptionId);
    if (sub === undefined) return { kind: "not_found" };
    if (this.declineNextChange || this.declineChangeFor === subscriptionId) {
      this.declineNextChange = false;
      if (this.declineChangeFor === subscriptionId) this.declineChangeFor = null;
      return { kind: "refused", status: 400, code: "subscription_payment_declined" };
    }
    if (mode === "prorated_immediately") this.charges.push({ subscriptionId, amount: this.proration(sub, priceId) });
    const price = this.prices[priceId];
    this.update(subscriptionId, {
      items: [{ quantity: 1, price: { id: priceId, type: "standard", ...(price === undefined ? {} : { unit_price: { amount: price.amount, currency_code: price.currency } }) } }],
    });
    const changed = this.subs.get(subscriptionId);
    if (changed === undefined) return { kind: "not_found" };
    if (this.loseChangeAnswer) {
      this.loseChangeAnswer = false;
      return { kind: "unavailable", status: null };
    }
    return { kind: "ok", value: changed };
  }

  moveTrialEnd(subscriptionId: string, at: string) {
    const sub = this.subs.get(subscriptionId);
    if (sub === undefined) return Promise.resolve<PaddleResult<PaddleSubscription>>({ kind: "not_found" });
    if (this.down) return Promise.resolve<PaddleResult<PaddleSubscription>>({ kind: "unavailable", status: 503 });
    this.trialMoves.push({ subscriptionId, at });
    this.update(subscriptionId, {
      next_billed_at: at,
      current_billing_period: { starts_at: sub.current_billing_period?.starts_at ?? at, ends_at: at },
    });
    return Promise.resolve<PaddleResult<PaddleSubscription>>({ kind: "ok", value: this.subs.get(subscriptionId) ?? sub });
  }

  /** Ends the trial now: the first month is charged and starts today (the fake's clock). */
  activateTrial(subscriptionId: string) {
    const sub = this.subs.get(subscriptionId);
    if (sub === undefined) return Promise.resolve<PaddleResult<PaddleSubscription>>({ kind: "not_found" });
    if (this.down) return Promise.resolve<PaddleResult<PaddleSubscription>>({ kind: "unavailable", status: 503 });
    if (this.refuseNextActivation) {
      this.refuseNextActivation = false;
      return Promise.resolve<PaddleResult<PaddleSubscription>>({ kind: "refused", status: 400, code: "subscription_payment_declined" });
    }
    this.activations.push(subscriptionId);
    const amount = Number(sub.items[0]?.price.unit_price?.amount ?? "0");
    this.charges.push({ subscriptionId, amount });
    const start = new Date(this.clock).toISOString();
    const end = new Date(this.clock + 30 * 24 * 60 * 60 * 1000).toISOString();
    this.update(subscriptionId, { status: "active", current_billing_period: { starts_at: start, ends_at: end }, next_billed_at: end });
    return Promise.resolve<PaddleResult<PaddleSubscription>>({ kind: "ok", value: this.subs.get(subscriptionId) ?? sub });
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
    const trialDays = txn.items[0]?.price.trial_period?.frequency ?? null;
    // A trial starts when the card is saved and bills its first month when it ends.
    const trialEnd = trialDays === null ? null : new Date(this.clock + trialDays * 24 * 60 * 60 * 1000).toISOString();
    this.subs.set(subId, {
      id: subId,
      status: trialEnd === null ? "active" : "trialing",
      customer_id: paddleId("ctm"),
      currency_code: txn.currency_code,
      updated_at: this.tick(),
      canceled_at: null,
      paused_at: null,
      current_billing_period:
        trialEnd === null ? { starts_at: "2026-10-01T00:00:00Z", ends_at: "2026-11-01T00:00:00Z" } : { starts_at: new Date(this.clock).toISOString(), ends_at: trialEnd },
      next_billed_at: trialEnd ?? "2026-11-01T00:00:00Z",
      scheduled_change: null,
      items: txn.items.map((i) => ({
        quantity: i.quantity,
        price: {
          id: i.price.id,
          type: i.price.trial_period === undefined ? ("standard" as const) : ("custom" as const),
          unit_price: i.price.unit_price,
          billing_cycle: { interval: "month" as const, frequency: 1 },
          custom_data: i.price.custom_data ?? null,
        },
      })),
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
