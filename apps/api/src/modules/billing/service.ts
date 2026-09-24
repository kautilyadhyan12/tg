// A gym pays us through Paddle (ROADMAP Stage 3 item 1a; Part 5 §0's doorbell rule).
//
// The console presses Subscribe: our server makes a Paddle transaction at OUR price
// and the browser opens Paddle's checkout for it. What the gym is on is only ever
// written from Paddle's own record of the subscription, fetched by our server, and
// the subscription is placed on the gym named in OUR checkout row, never on anything
// the payment says about itself.
import type { OrgCheckoutResponse, OrgCheckoutSyncResponse, PaddleSubscription } from "@app/shared";
import type { Sql } from "postgres";
import type { RedisLike } from "../../redis.js";
import { bustEntitlements } from "../entitlements/service.js";
import * as orgsRepo from "../orgs/repo.js";
import { OrgsError, requirePrivilege, toOrgSubscription } from "../orgs/service.js";
import type { Snapshot } from "./machine.js";
import { onlinePaymentFor } from "./online.js";
import type { PaddleApi, PaddleEnvironment } from "./paddle.js";
import * as repo from "./repo.js";

export interface PaddleSettings {
  api: PaddleApi;
  environment: PaddleEnvironment;
  clientToken: string;
}

export interface BillingDeps {
  sql: Sql;
  redis: RedisLike;
  /** Null when Paddle is not set up on this server. */
  paddle: PaddleSettings | null;
  log: {
    info: (obj: object, msg: string) => void;
    warn: (obj: object, msg: string) => void;
    error: (obj: object, msg: string) => void;
  };
  now: () => Date;
}

/** Paddle's transaction states in which the customer's money has been taken. */
const MONEY_TAKEN: ReadonlySet<string> = new Set(["paid", "completed", "billed"]);

const UNAVAILABLE = "Paying online isn't available right now. Please try again later.";

export async function startOrgCheckout(
  deps: BillingDeps,
  input: { userId: string; gymId: string; planCode: string; idempotencyKey: string },
): Promise<OrgCheckoutResponse> {
  const { org } = await requirePrivilege(deps, input.gymId, input.userId, "billing.manage");
  const online = onlinePaymentFor(org.currencyDisplay, deps.paddle !== null);
  if (online === "coming_soon") {
    throw new OrgsError(409, "pay_online_soon", "Paying online in rupees is coming soon.");
  }
  const paddle = deps.paddle;
  if (paddle === null) throw new OrgsError(503, "payments_unavailable", UNAVAILABLE);

  // A window this gym opened before may have been paid and not yet reached the gym
  // (the tab closed before it was confirmed): put that payment on the gym first, so the
  // press below meets "already on a plan" rather than opening a second payment.
  for (const open of await repo.openCheckoutsFor(deps.sql, input.gymId)) {
    if (open.providerRef === null) continue;
    const txn = await paddle.api.getTransaction(open.providerRef);
    if (txn.kind === "unavailable") throw new OrgsError(503, "payments_unavailable", UNAVAILABLE);
    if (txn.kind !== "ok" || !MONEY_TAKEN.has(txn.value.status)) continue;
    const subscriptionId = txn.value.subscription_id;
    if (subscriptionId === null || (await applyPaddleSubscription(deps, subscriptionId)) === "retry") {
      throw new OrgsError(409, "payment_in_progress", "Your last payment is still going through. Try again in a minute.");
    }
  }

  const outcome = await repo.beginCheckout(deps.sql, { ...input, currency: org.currencyDisplay });
  switch (outcome.kind) {
    case "replay": {
      const { checkout } = outcome;
      if (checkout.state === "open" && checkout.providerRef !== null) {
        return checkoutResponse(paddle, checkout.id, checkout.providerRef);
      }
      if (checkout.state === "paid") throw new OrgsError(409, "already_subscribed", "This plan is already paid for.");
      if (checkout.state === "creating") throw new OrgsError(409, "checkout_in_progress", "Still opening. Try again in a moment.");
      throw new OrgsError(409, "checkout_replaced", "That payment window has closed. Press Subscribe again.");
    }
    case "key_reused":
      throw new OrgsError(422, "idempotency_key_reused", "This Idempotency-Key was already used for a different plan.");
    case "trial_running":
      throw new OrgsError(409, "trial_running", "You can choose a plan when your free trial ends.");
    case "already_subscribed":
      throw new OrgsError(409, "already_subscribed", "You're already on a paid plan.");
    case "no_such_plan":
      throw new OrgsError(404, "plan_not_found", "That plan isn't on your price list.");
    case "plan_too_small":
      throw new OrgsError(
        409,
        "plan_too_small",
        `You have ${String(outcome.seatsUsed)} members, more than this plan's ${String(outcome.seatCap)}. Choose a bigger plan.`,
      );
    case "not_set_up":
      deps.log.error({ event: "billing.price_not_set_up", plan: input.planCode }, "a plan has no Paddle price");
      throw new OrgsError(503, "payments_unavailable", UNAVAILABLE);
    case "org_archived":
      throw new OrgsError(409, "org_archived", "This organisation is archived.");
    case "not_found":
      throw new OrgsError(404, "org_not_found", "Organisation not found.");
    case "created":
      break;
  }

  // Only one checkout per gym can be paid: the ones this press replaced are cancelled.
  for (const transactionId of outcome.superseded) {
    const cancelled = await paddle.api.cancelTransaction(transactionId);
    if (cancelled.kind !== "ok") {
      deps.log.warn({ event: "billing.cancel_superseded_failed", result: cancelled.kind }, "a replaced checkout could not be cancelled at Paddle");
    }
  }

  const checkoutId = outcome.checkout.id;
  const created = await paddle.api.createTransaction({
    priceId: outcome.priceId,
    customData: { gym_id: input.gymId, checkout_id: checkoutId },
  });
  if (created.kind !== "ok") {
    await repo.failCheckout(deps.sql, { checkoutId, gymId: input.gymId });
    deps.log.warn({ event: "billing.transaction_not_created", result: created.kind }, "Paddle did not create a transaction");
    throw new OrgsError(503, "payments_unavailable", UNAVAILABLE);
  }
  const txn = created.value;
  const item = txn.items[0];
  // What Paddle will charge must be exactly our price, or nothing is opened.
  const agrees =
    txn.items.length === 1 &&
    item !== undefined &&
    item.quantity === 1 &&
    item.price.id === outcome.priceId &&
    item.price.unit_price.amount === String(outcome.priceMinor) &&
    item.price.unit_price.currency_code === outcome.currency &&
    txn.subscription_id === null &&
    (txn.status === "draft" || txn.status === "ready");
  if (!agrees) {
    await paddle.api.cancelTransaction(txn.id);
    await repo.failCheckout(deps.sql, { checkoutId, gymId: input.gymId });
    deps.log.error({ event: "billing.price_mismatch", plan: input.planCode }, "Paddle's transaction does not match our price");
    throw new OrgsError(503, "payments_unavailable", UNAVAILABLE);
  }
  if (!(await repo.openCheckout(deps.sql, { checkoutId, gymId: input.gymId, transactionId: txn.id }))) {
    await paddle.api.cancelTransaction(txn.id);
    throw new OrgsError(409, "checkout_replaced", "That payment window has closed. Press Subscribe again.");
  }
  return checkoutResponse(paddle, checkoutId, txn.id);
}

function checkoutResponse(paddle: PaddleSettings, checkoutId: string, transactionId: string): OrgCheckoutResponse {
  return {
    checkoutId,
    provider: "paddle",
    environment: paddle.environment,
    clientToken: paddle.clientToken,
    transactionId,
  };
}

/** After Paddle's window says the payment went: fetch it from Paddle and put it on the
 *  gym now, rather than waiting for the webhook. Safe to call any number of times. */
export async function syncOrgCheckout(
  deps: BillingDeps,
  input: { userId: string; gymId: string; checkoutId: string },
): Promise<OrgCheckoutSyncResponse> {
  await requirePrivilege(deps, input.gymId, input.userId, "billing.manage");
  const checkout = await repo.getCheckout(deps.sql, { checkoutId: input.checkoutId, gymId: input.gymId });
  if (checkout === null) throw new OrgsError(404, "checkout_not_found", "That payment wasn't found.");
  const paddle = deps.paddle;
  if (paddle === null) throw new OrgsError(503, "payments_unavailable", UNAVAILABLE);

  if (checkout.providerRef !== null && checkout.state !== "failed") {
    const txn = await paddle.api.getTransaction(checkout.providerRef);
    if (txn.kind === "ok" && txn.value.subscription_id !== null && (txn.value.status === "paid" || txn.value.status === "completed")) {
      await applyPaddleSubscription(deps, txn.value.subscription_id);
      await bustEntitlements(deps.redis, input.userId);
    }
  }
  const live = await orgsRepo.gymLiveSubscription(deps.sql, input.gymId);
  if (live !== null && (live.status === "active" || live.status === "past_due")) {
    return { state: "paid", subscription: toOrgSubscription(live) };
  }
  return { state: "waiting" };
}

export type ApplyResult =
  | "applied"
  | "unchanged"
  /** Paddle could not be asked; try again later. */
  | "retry"
  /** Not a subscription our server sold (unknown id or price): nothing written. */
  | "unknown"
  /** A second plan for a gym already on one, or one no checkout of ours made: cancelled at
   *  Paddle, and a refund written down for each of its paid transactions. */
  | "set_aside";


/** Fetch one subscription from Paddle and write it onto its gym through the one rule. */
export async function applyPaddleSubscription(deps: BillingDeps, subscriptionId: string): Promise<ApplyResult> {
  const paddle = deps.paddle;
  if (paddle === null) return "retry";
  const fetched = await paddle.api.getSubscription(subscriptionId);
  if (fetched.kind === "not_found") return "unknown";
  if (fetched.kind !== "ok") return "retry";
  const sub = fetched.value;

  const item = sub.items[0];
  const plan = sub.items.length === 1 && item !== undefined && item.quantity === 1
    ? await repo.planForPaddlePrice(deps.sql, item.price.id)
    : null;

  // Which gym: the row already placed, else the checkout our server made for it.
  const placed = await repo.findPaddleSubscription(deps.sql, sub.id);
  let gymId = placed?.gymId ?? null;
  let checkoutId: string | null = null;
  if (gymId === null) {
    const listed = await paddle.api.listSubscriptionTransactions(sub.id);
    if (listed.kind === "unavailable") return "retry";
    const all = listed.kind === "ok" ? listed.value : [];
    const ours = await repo.checkoutsForTransactions(deps.sql, all.filter((t) => t.origin === "api").map((t) => t.id));
    const first = ours[0];
    if (first !== undefined) {
      gymId = first.gymId;
      checkoutId = first.id;
    }
  }
  if (gymId === null) {
    // Paid, but not through any checkout our server made: nobody gets a plan for it,
    // so the money goes back, whatever state Paddle now holds it in.
    deps.log.error({ event: "billing.unplaced_subscription", paddleStatus: sub.status }, "a Paddle subscription matches no checkout of ours");
    return await setAside(deps, paddle, sub, null, "unmatched");
  }
  if (plan === null) {
    deps.log.error({ event: "billing.unknown_price" }, "a Paddle subscription is not at one of our plans' prices");
    return "unknown";
  }

  const snapshot = toSnapshot(sub, plan.id);
  const outcome = await repo.applySnapshot(deps.sql, {
    gymId,
    subscriptionId: sub.id,
    customerId: sub.customer_id,
    snapshot,
    checkoutId,
    now: deps.now(),
  });
  if (outcome.duplicate) {
    if (outcome.decision.kind === "duplicate") {
      deps.log.error({ event: "billing.duplicate_subscription", gymId }, "a second paid plan for one gym: cancelling and refunding it");
    }
    return await setAside(deps, paddle, sub, gymId, "duplicate");
  }
  if (outcome.decision.kind === "ignore") {
    if (outcome.decision.reason === "conflict" || outcome.decision.reason === "not_ours" || outcome.decision.reason === "trial_not_sold") {
      deps.log.error({ event: "billing.illegal_transition", reason: outcome.decision.reason, gymId }, "a Paddle subscription change was not applied");
    }
    return "unchanged";
  }
  deps.log.info({ event: "billing.applied", gymId, decision: outcome.decision.kind }, "a gym's paid plan changed");
  return "applied";
}

export function toSnapshot(sub: PaddleSubscription, planId: string): Snapshot {
  return {
    status: sub.status,
    updatedAt: new Date(sub.updated_at),
    planId,
    currentPeriodEnd: sub.current_billing_period === null ? null : new Date(sub.current_billing_period.ends_at),
    cancelAtPeriodEnd: sub.scheduled_change?.action === "cancel",
  };
}

/** Cancel a set-aside subscription at Paddle and write down a refund for every
 *  transaction of it that took money. Runs on every event about that subscription, so
 *  a cancel that failed is tried again and a later paid transaction is added; the
 *  refunds themselves are made by `settleOwedRefunds`, which retries until Paddle
 *  holds one for each. */
async function setAside(
  deps: BillingDeps,
  paddle: PaddleSettings,
  sub: PaddleSubscription,
  gymId: string | null,
  reason: repo.RefundReason,
): Promise<ApplyResult> {
  if (sub.status !== "canceled") {
    const cancelled = await paddle.api.cancelSubscriptionNow(sub.id);
    if (cancelled.kind !== "ok") deps.log.error({ event: "billing.cancel_failed", result: cancelled.kind }, "could not cancel a subscription at Paddle");
  }
  const listed = await paddle.api.listSubscriptionTransactions(sub.id);
  if (listed.kind !== "ok") return "retry";
  await repo.oweRefunds(deps.sql, {
    gymId,
    subscriptionRef: sub.id,
    reason,
    transactionRefs: listed.value.filter((t) => MONEY_TAKEN.has(t.status)).map((t) => t.id),
  });
  return "set_aside";
}

export const REFUNDS = {
  perRun: 50,
  leaseMs: 5 * 60 * 1000,
  /** Paddle unreachable, or the payment not finished yet: ask again this often. */
  waitMs: 60_000,
  /** Paddle refused the refund: try again after these, then give up to the operator. */
  retryAfterMs: [5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 12 * 60 * 60_000],
  maxTries: 5,
  /** A payment still not finished after a week is given up to the operator. */
  maxAgeMs: 7 * 24 * 60 * 60 * 1000,
} as const;

export interface RefundsRun {
  requested: number;
  notNeeded: number;
  deferred: number;
  failed: number;
}

/** Make the refunds owed, until Paddle holds a refund for each transaction. Safe to run
 *  twice: a transaction Paddle already holds a refund for is never asked again, which
 *  also covers a refund whose answer was lost. */
export async function settleOwedRefunds(deps: BillingDeps): Promise<RefundsRun> {
  const run: RefundsRun = { requested: 0, notNeeded: 0, deferred: 0, failed: 0 };
  const paddle = deps.paddle;
  if (paddle === null) return run;
  for (let taken = 0; taken < REFUNDS.perRun; taken++) {
    const owed = await repo.claimDueRefund(deps.sql, deps.now(), REFUNDS.leaseMs);
    if (owed === null) break;
    const later = (ms: number) => new Date(deps.now().getTime() + ms);
    const giveUp = async (why: string) => {
      await repo.settleRefund(deps.sql, owed.id, "failed");
      deps.log.error({ event: "billing.refund_given_up", refundId: owed.id, why }, "a refund we owe could not be made: refund it by hand in Paddle");
      run.failed += 1;
    };
    const refused = async () => {
      if (owed.tries + 1 >= REFUNDS.maxTries) {
        await giveUp("refused");
        return;
      }
      await repo.deferRefund(deps.sql, owed.id, later(REFUNDS.retryAfterMs[Math.min(owed.tries, REFUNDS.retryAfterMs.length - 1)] ?? REFUNDS.waitMs), true);
      run.deferred += 1;
    };

    const txn = await paddle.api.getTransaction(owed.transactionRef);
    if (txn.kind === "unavailable") {
      await repo.deferRefund(deps.sql, owed.id, later(REFUNDS.waitMs), false);
      run.deferred += 1;
      continue;
    }
    if (txn.kind === "not_found") {
      await giveUp("not_found");
      continue;
    }
    if (txn.kind === "refused") {
      await refused();
      continue;
    }
    const refunds = (txn.value.adjustments ?? []).filter((a) => a.action === "refund");
    if (refunds.some((a) => a.status === "pending_approval" || a.status === "approved")) {
      await repo.settleRefund(deps.sql, owed.id, "requested");
      run.requested += 1;
      continue;
    }
    if (refunds.some((a) => a.status === "rejected")) {
      await giveUp("rejected_by_paddle");
      continue;
    }
    if (txn.value.status === "completed") {
      const made = await paddle.api.refundTransaction(owed.transactionRef, "Duplicate or unmatched subscription, refunded automatically");
      if (made.kind === "ok") {
        await repo.settleRefund(deps.sql, owed.id, "requested");
        run.requested += 1;
      } else if (made.kind === "refused") await refused();
      else {
        // No clear answer: the next run first asks whether Paddle holds the refund.
        await repo.deferRefund(deps.sql, owed.id, later(REFUNDS.waitMs), false);
        run.deferred += 1;
      }
      continue;
    }
    if (MONEY_TAKEN.has(txn.value.status)) {
      // Paid, and Paddle will complete it shortly: a refund can only be made once it has.
      if (deps.now().getTime() - owed.createdAt.getTime() >= REFUNDS.maxAgeMs) await giveUp("never_completed");
      else {
        await repo.deferRefund(deps.sql, owed.id, later(REFUNDS.waitMs), false);
        run.deferred += 1;
      }
      continue;
    }
    // Cancelled, draft or unpaid: no money was taken.
    await repo.settleRefund(deps.sql, owed.id, "not_needed");
    run.notNeeded += 1;
  }
  return run;
}
