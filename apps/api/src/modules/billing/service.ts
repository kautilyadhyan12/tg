// A gym pays us through Paddle (ROADMAP Stage 3 item 1a; Part 5 §0's doorbell rule).
//
// The console presses Subscribe: our server makes a Paddle transaction at OUR price
// and the browser opens Paddle's checkout for it. What the gym is on is only ever
// written from Paddle's own record of the subscription, fetched by our server, and
// the subscription is placed on the gym named in OUR checkout row, never on anything
// the payment says about itself.
//
// During the gym's own free trial the checkout sells a Paddle trial of the days left, so
// the card is saved now and the first payment is taken when the trial ends (1c-ii; Kd,
// RULINGS 2026-09-25). A paying gym may move to a bigger size: Paddle charges the rest of
// the month at once, and changes nothing if that charge fails.
import {
  PAID_PLAN_GRACE_DAYS,
  SMALLER_SIZE_DECIDE_HOURS,
  type OrgBillingPortalResponse,
  type OrgCheckoutResponse,
  type OrgCheckoutSyncResponse,
  type OrgPlanChangePreview,
  type OrgPlanChangeResponse,
  type PaddleSubscription,
  type PaddleTransaction,
} from "@app/shared";
import type { Sql } from "postgres";
import type { EmailTransport } from "../../email/resend.js";
import type { RedisLike } from "../../redis.js";
import { bustEntitlements } from "../entitlements/service.js";
import * as orgsRepo from "../orgs/repo.js";
import { formatPriceMinor, holdsPrivilege, OrgsError, requirePrivilege, toOrgSubscription } from "../orgs/service.js";
import { dayLabel, momentLabel, sizeFittedEmail, sizeKeptEmail, sizeWarningEmail } from "./emails.js";
import type { Snapshot } from "./machine.js";
import { onlinePaymentFor } from "./online.js";
import type { PaddleApi, PaddleEnvironment, ProrationMode, TrialCheckout } from "./paddle.js";
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
  /** How the worker emails a gym's billing staff about a smaller size; absent or null: not
   *  sent (a laptop with no Resend key), and the Plan card still says it. */
  mail?: BillingMail | null;
}

export interface BillingMail {
  transport: EmailTransport;
  /** The console's origin, for the links in the emails. */
  webOrigin: string;
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

  const outcome = await repo.beginCheckout(deps.sql, { ...input, currency: org.currencyDisplay, now: deps.now() });
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
    case "already_subscribed":
      throw new OrgsError(409, "already_subscribed", "You're already on a paid plan.");
    case "payment_overdue":
      throw new OrgsError(409, "payment_overdue", "A payment is overdue. Update your payment method to pay it and carry on.");
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
  const trialDays = outcome.trialDays;
  let trial: TrialCheckout | undefined;
  if (trialDays !== null) {
    // The trial's own price copies the catalogue price's product and name.
    const catalogue = await paddle.api.getPrice(outcome.priceId);
    if (catalogue.kind !== "ok") {
      await repo.failCheckout(deps.sql, { checkoutId, gymId: input.gymId });
      deps.log.warn({ event: "billing.price_not_read", result: catalogue.kind }, "Paddle did not return a plan's price");
      throw new OrgsError(503, "payments_unavailable", UNAVAILABLE);
    }
    trial = {
      trialDays,
      planCode: input.planCode,
      productId: catalogue.value.product_id,
      name: catalogue.value.name ?? input.planCode,
      amountMinor: outcome.priceMinor,
      currency: outcome.currency,
    };
  }
  const created = await paddle.api.createTransaction({
    priceId: outcome.priceId,
    customData: { gym_id: input.gymId, checkout_id: checkoutId },
    ...(trial === undefined ? {} : { trial }),
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
    (trialDays === null ? item.price.id === outcome.priceId : isTrialPrice(item, input.planCode, trialDays)) &&
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

/** A trial checkout's own price: exactly the days asked for, marked with the plan's code. */
function isTrialPrice(item: PaddleTransaction["items"][number], planCode: string, trialDays: number): boolean {
  const trial = item.price.trial_period;
  return (
    item.price.custom_data?.["plan_code"] === planCode &&
    trial !== null &&
    trial !== undefined &&
    trial.interval === "day" &&
    trial.frequency === trialDays
  );
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

  let subscriptionId: string | null = null;
  if (checkout.providerRef !== null && checkout.state !== "failed") {
    const txn = await paddle.api.getTransaction(checkout.providerRef);
    if (txn.kind === "ok" && txn.value.subscription_id !== null && (txn.value.status === "paid" || txn.value.status === "completed")) {
      subscriptionId = txn.value.subscription_id;
      await applyPaddleSubscription(deps, subscriptionId);
      await bustEntitlements(deps.redis, input.userId);
    }
  }
  // Paid means a plan paid through Paddle is on the gym, a paid trial included; the gym's
  // own free trial is not one.
  const live = await orgsRepo.gymLiveSubscription(deps.sql, input.gymId);
  if (live !== null && live.provider === "paddle") {
    return { state: "paid", subscription: toOrgSubscription(live) };
  }
  // A trial saved after the gym's own trial ended was cancelled, nothing charged.
  const placed = subscriptionId === null ? null : await repo.findPaddleSubscription(deps.sql, subscriptionId);
  if (placed !== null && placed.gymId === input.gymId && placed.status === "expired" && placed.cancelReason === null) {
    return { state: "trial_ended" };
  }
  return { state: "waiting" };
}

/** Paddle's own page for the gym's paid plan (ROADMAP Stage 3 item 1c-i): change the
 *  card, cancel, invoices. The customer is the one on THIS gym's own row, never one the
 *  browser names, and only staff who manage billing may open it — read-only or not,
 *  since paying an overdue plan is how a read-only console opens again. */
export async function openBillingPortal(
  deps: BillingDeps,
  input: { userId: string; gymId: string },
): Promise<OrgBillingPortalResponse> {
  await requirePrivilege(deps, input.gymId, input.userId, "billing.manage");
  const paddle = deps.paddle;
  if (paddle === null) throw new OrgsError(503, "payments_unavailable", UNAVAILABLE);
  const plan = await repo.managedPlanFor(deps.sql, input.gymId);
  if (plan === null) throw new OrgsError(404, "no_paid_plan", "This plan isn't paid through us, so there's nothing to manage here.");
  // Paddle's page shows everything its customer pays for: it opens only for somebody
  // who manages the billing of every gym that customer pays for.
  for (const otherGymId of await repo.otherGymsOfCustomer(deps.sql, { customerRef: plan.customerRef, gymId: input.gymId })) {
    if (!(await holdsPrivilege(deps, otherGymId, input.userId, "billing.manage"))) {
      throw new OrgsError(
        409,
        "shared_payer",
        // "organisation": the other one may be a studio or a trainer, whatever this one is.
        "This payment account also pays for another organisation whose billing you don't manage, so it can't be opened here. The person who pays can open it.",
      );
    }
  }

  const session = await paddle.api.createPortalSession(plan.customerRef, [plan.subscriptionRef]);
  if (session.kind !== "ok") {
    // A 403 here is an API key without the "customer portal session: write" permission.
    const refusal = session.kind === "refused" ? { status: session.status, code: session.code } : {};
    deps.log.warn({ event: "billing.portal_not_opened", result: session.kind, ...refusal }, "Paddle did not open its customer portal");
    throw new OrgsError(503, "payments_unavailable", UNAVAILABLE);
  }
  const deepLinks = session.value.urls.subscriptions.find((s) => s.id === plan.subscriptionRef);
  if (session.value.customer_id !== plan.customerRef || deepLinks === undefined) {
    deps.log.error({ event: "billing.portal_mismatch" }, "Paddle's portal session is not for this gym's customer");
    throw new OrgsError(503, "payments_unavailable", UNAVAILABLE);
  }
  // Money owed: straight to the card, where Paddle shows the overdue amount and takes it.
  return { url: plan.overdue ? deepLinks.update_subscription_payment_method : session.value.urls.general.overview };
}

// ── A size change: bigger (1c-ii) or smaller (1c-iii) ─────────────────────────

/** Why a size change was refused, as the console is told. Kept on a failed change's row,
 *  so the same Idempotency-Key answers the same. */
const SIZE_REFUSALS: Record<string, { status: number; message: string }> = {
  no_paid_plan_trial: {
    status: 409,
    message: "Your free trial isn't paid for yet. Choose a plan with Subscribe; you're charged when the trial ends.",
  },
  no_paid_plan: { status: 409, message: "This plan isn't paid through us, so its size can't be changed here." },
  payment_overdue: { status: 409, message: "A payment is overdue. Update your payment method to pay it, then change your size." },
  plan_ending: { status: 409, message: "Your plan is set to end, so its size can't be changed." },
  plan_not_found: { status: 404, message: "That plan isn't on your price list." },
  same_size: { status: 409, message: "That's the size you're on." },
  too_many_members: { status: 409, message: "You have more members than that size allows. Remove some first, or keep your size." },
  renewing: { status: 409, message: "Your plan is renewing right now. Try again in a few minutes." },
  payments_unavailable: { status: 503, message: UNAVAILABLE },
  change_declined: {
    status: 409,
    message:
      "Paddle couldn't take the payment for the bigger size, so nothing was charged and your size is the same. If your card was declined, update it in Manage payment and try again.",
  },
  change_unconfirmed: {
    status: 503,
    message: "We couldn't confirm the change with Paddle. Reload the page in a minute to see your size before trying again.",
  },
  plan_changed_meanwhile: { status: 409, message: "Your plan changed meanwhile. Reload the page and try again." },
  interrupted: { status: 503, message: "That change was cut off. Reload the page to see your size before trying again." },
};

function sizeRefusal(code: string): OrgsError {
  const refusal = SIZE_REFUSALS[code] ?? { status: 503, message: UNAVAILABLE };
  return new OrgsError(refusal.status, code === "no_paid_plan_trial" ? "no_paid_plan" : code, refusal.message);
}

function refusalCode(outcome: Exclude<repo.SizeTargetOutcome, { kind: "ok" }>): string {
  switch (outcome.kind) {
    case "no_paid_plan":
      return outcome.trialing ? "no_paid_plan_trial" : "no_paid_plan";
    case "payment_overdue":
    case "plan_ending":
    case "same_size":
    case "renewing":
      return outcome.kind;
    case "no_such_plan":
      return "plan_not_found";
    case "not_set_up":
      return "payments_unavailable";
    case "too_many_members":
      return "too_many_members";
  }
}

function refusalFor(outcome: Exclude<repo.SizeTargetOutcome, { kind: "ok" }>): OrgsError {
  if (outcome.kind !== "too_many_members") return sizeRefusal(refusalCode(outcome));
  return new OrgsError(
    409,
    "too_many_members",
    `You have ${String(outcome.seatsUsed)} members, and that size is for up to ${String(outcome.seatCap)}. Remove ${String(outcome.seatsUsed - outcome.seatCap)} first, or keep your size.`,
  );
}

/** Paddle's amounts are strings of minor units; ours are integers. */
function minor(amount: string): number {
  const n = Number.parseInt(amount, 10);
  if (!Number.isSafeInteger(n)) throw new Error("Paddle amount out of range");
  return n;
}

function prorationFor(trialing: boolean): ProrationMode {
  // Nothing is charged in a trial: the new price is the one taken when the trial ends.
  return trialing ? "do_not_bill" : "prorated_immediately";
}

/** What a size change would cost now and from when. A bigger one as Paddle works it out; a
 *  smaller one charges and credits nothing, and its price starts when the month paid ends.
 *  Changes nothing. */
export async function previewSizeChange(
  deps: BillingDeps,
  input: { userId: string; gymId: string; planCode: string },
): Promise<OrgPlanChangePreview> {
  await requirePrivilege(deps, input.gymId, input.userId, "billing.manage");
  const paddle = deps.paddle;
  if (paddle === null) throw new OrgsError(503, "payments_unavailable", UNAVAILABLE);
  const found = await repo.sizeTarget(deps.sql, { ...input, now: deps.now() });
  if (found.kind !== "ok") {
    if (found.kind === "not_set_up") deps.log.error({ event: "billing.price_not_set_up", plan: input.planCode }, "a plan has no Paddle price");
    throw refusalFor(found);
  }
  const target = found.target;
  const summary = {
    planCode: target.planCode,
    seatCap: target.seatCap,
    priceLabel: formatPriceMinor(target.priceMinor, target.currency),
  };
  if (target.direction === "smaller") {
    return { ...summary, dueNow: null, nextPaymentAt: target.periodEnd?.toISOString() ?? null };
  }
  const preview = await paddle.api.previewPriceChange(target.subscriptionRef, target.priceId, prorationFor(target.trialing));
  if (preview.kind !== "ok") {
    const refusal = preview.kind === "refused" ? { status: preview.status, code: preview.code } : {};
    deps.log.warn({ event: "billing.size_preview_failed", result: preview.kind, ...refusal }, "Paddle did not preview a size change");
    throw new OrgsError(503, "payments_unavailable", UNAVAILABLE);
  }
  const totals = preview.value.immediate_transaction?.details.totals ?? null;
  const dueNow =
    totals === null || minor(totals.grand_total) <= 0
      ? null
      : {
          totalLabel: formatPriceMinor(minor(totals.grand_total), totals.currency_code),
          subtotalLabel: formatPriceMinor(minor(totals.subtotal), totals.currency_code),
          taxLabel: minor(totals.tax) > 0 ? formatPriceMinor(minor(totals.tax), totals.currency_code) : null,
        };
  return {
    ...summary,
    dueNow,
    nextPaymentAt: preview.value.next_billed_at === null ? null : new Date(preview.value.next_billed_at).toISOString(),
  };
}

/** Move a paying gym to another size. Recorded first under the gym's lock, so two presses
 *  cannot both ask Paddle; Paddle's subscription is read first, so a change that already
 *  landed is never asked for (or charged) twice; the gym's plan is written from Paddle's own
 *  record of it afterwards, through the one rule. A smaller size on a plan already paying is
 *  only written down here: the gym keeps its whole size, and the worker decides it shortly
 *  before the month paid ends (`applyPendingSizes`). */
export async function changeSize(
  deps: BillingDeps,
  input: { userId: string; gymId: string; planCode: string; idempotencyKey: string },
): Promise<OrgPlanChangeResponse> {
  await requirePrivilege(deps, input.gymId, input.userId, "billing.manage");
  const paddle = deps.paddle;
  if (paddle === null) throw new OrgsError(503, "payments_unavailable", UNAVAILABLE);

  const begun = await repo.beginPlanChange(deps.sql, { ...input, now: deps.now() });
  switch (begun.kind) {
    case "replay":
      if (begun.change.state === "done") return await currentPlan(deps, input.gymId);
      if (begun.change.state === "pending") throw new OrgsError(409, "change_in_progress", "Your size is being changed. Try again in a moment.");
      throw sizeRefusal(begun.change.failure ?? "payments_unavailable");
    case "key_reused":
      throw new OrgsError(422, "idempotency_key_reused", "This Idempotency-Key was already used for a different plan.");
    case "in_progress":
      throw new OrgsError(409, "change_in_progress", "Your size is being changed. Try again in a moment.");
    case "org_archived":
      throw new OrgsError(409, "org_archived", "This organisation is archived.");
    case "not_found":
      throw new OrgsError(404, "org_not_found", "Organisation not found.");
    case "refused":
      if (begun.outcome.kind === "not_set_up") deps.log.error({ event: "billing.price_not_set_up", plan: input.planCode }, "a plan has no Paddle price");
      throw refusalFor(begun.outcome);
    case "scheduled":
      deps.log.info({ event: "billing.size_scheduled", gymId: input.gymId, plan: input.planCode }, "a gym chose a smaller size from its next bill");
      return await currentPlan(deps, input.gymId);
    case "created":
      break;
  }
  const { changeId, target } = begun;
  const fail = async (code: string): Promise<never> => {
    // A smaller size not made at Paddle stops holding the limit. A lost answer keeps it: Paddle
    // may have made it, and the worker reads Paddle and finishes the job.
    if (target.direction === "smaller" && code !== "change_unconfirmed") {
      await repo.dropPendingPlan(deps.sql, { gymId: input.gymId, subscriptionRowId: target.subscriptionRowId, planId: target.toPlanId });
    }
    await repo.finishPlanChange(deps.sql, { changeId, gymId: input.gymId, state: "failed", failure: code });
    throw sizeRefusal(code);
  };

  const fetched = await paddle.api.getSubscription(target.subscriptionRef);
  if (fetched.kind !== "ok") {
    deps.log.warn({ event: "billing.size_read_failed", result: fetched.kind }, "Paddle did not return a subscription before a size change");
    return await fail("payments_unavailable");
  }
  const sub = fetched.value;
  const item = sub.items[0];
  const onPaddle = sub.items.length === 1 && item !== undefined ? await repo.planForPaddleItem(deps.sql, item) : null;
  if (onPaddle?.id === target.toPlanId) {
    // Already on that size (a change cut off before it was written): write it, charge nothing.
    await applyPaddleSubscription(deps, sub.id);
    await repo.finishPlanChange(deps.sql, { changeId, gymId: input.gymId, state: "done", failure: null });
    return await currentPlan(deps, input.gymId);
  }
  const expected = target.trialing ? "trialing" : "active";
  if (onPaddle?.id !== target.fromPlanId || sub.status !== expected || sub.scheduled_change !== null) {
    await applyPaddleSubscription(deps, sub.id);
    return await fail("plan_changed_meanwhile");
  }

  const changed = await paddle.api.changePrice(sub.id, target.priceId, prorationFor(target.trialing));
  if (changed.kind === "refused") {
    deps.log.warn({ event: "billing.size_change_refused", status: changed.status, code: changed.code }, "Paddle refused a size change");
    return await fail("change_declined");
  }
  if (changed.kind !== "ok") {
    // No clear answer: Paddle may have made it. Its webhook will say; a press again first reads Paddle.
    deps.log.warn({ event: "billing.size_change_unconfirmed", result: changed.kind }, "a size change's answer was lost");
    return await fail("change_unconfirmed");
  }
  await applyPaddleSubscription(deps, sub.id);
  await repo.finishPlanChange(deps.sql, { changeId, gymId: input.gymId, state: "done", failure: null });
  deps.log.info({ event: "billing.size_changed", gymId: input.gymId, plan: target.planCode, direction: target.direction }, "a gym changed size");
  return await currentPlan(deps, input.gymId);
}

/** "Cancel this change": the smaller size waiting is dropped; nothing is asked of Paddle,
 *  which still bills the size the gym is on. Safe to press twice. */
export async function keepSize(deps: BillingDeps, input: { userId: string; gymId: string }): Promise<OrgPlanChangeResponse> {
  await requirePrivilege(deps, input.gymId, input.userId, "billing.manage");
  const kept = await repo.keepSize(deps.sql, input);
  switch (kept.kind) {
    case "kept":
      deps.log.info({ event: "billing.size_kept", gymId: input.gymId }, "a gym kept its size");
      return await currentPlan(deps, input.gymId);
    case "nothing_waiting":
      return await currentPlan(deps, input.gymId);
    case "in_progress":
      throw new OrgsError(409, "change_in_progress", "Your size is being changed. Try again in a moment.");
    case "org_archived":
      throw new OrgsError(409, "org_archived", "This organisation is archived.");
    case "not_found":
      throw new OrgsError(404, "org_not_found", "Organisation not found.");
  }
}

async function currentPlan(deps: BillingDeps, gymId: string): Promise<OrgPlanChangeResponse> {
  const live = await orgsRepo.gymLiveSubscription(deps.sql, gymId);
  if (live === null) throw new OrgsError(409, "plan_changed_meanwhile", "Your plan changed meanwhile. Reload the page and try again.");
  let fallback: repo.FittingPlan | null = null;
  if (live.pending !== null) {
    const members = await repo.seatsUsed(deps.sql, gymId);
    if (members > live.pending.seatCap) fallback = await repo.smallestFittingPlan(deps.sql, { gymId, members });
  }
  return { subscription: toOrgSubscription(live, fallback) };
}

/** A smaller size is decided this long before the month paid ends: the members counted and,
 *  if they fit, Paddle's price changed. */
export const PENDING_SIZE_LEAD_MS = SMALLER_SIZE_DECIDE_HOURS * 60 * 60 * 1000;
/** Billing staff are emailed this long before a smaller size is due, if the gym still has
 *  more members than it holds. */
export const SIZE_WARNING_WITHIN_MS = 3 * 24 * 60 * 60 * 1000;
/** Paddle refuses a change within 30 minutes of a charge (developer.paddle.com, "Upgrade or
 *  downgrade subscriptions", read 2026-09-25); this leaves a margin. */
const PADDLE_CHANGE_CUTOFF_MS = 35 * 60 * 1000;
/** A plan whose smaller size Paddle refused is asked again after this long. */
export const PENDING_SIZE_RETRY_MS = 10 * 60 * 1000;

export interface PendingSizesRun {
  applied: number;
  /** Not made this run: Paddle refused, could not be asked, or the charge is too close. */
  waiting: number;
  /** Not made at all: more members than the smaller size holds, so the gym stays on its size. */
  kept: number;
  /** Warning emails sent: a smaller size due soon, and too many members for it. */
  warned: number;
}

/** Decide each smaller size that is due: a paid trial's at once, a paying plan's in the hours
 *  before its month ends. The members are counted; if more than it holds, the gym stays on its
 *  size and its billing staff are told (Kd, RULINGS 2026-09-25). If they fit, Paddle's price is
 *  changed with nothing billed or credited, so the next bill is the smaller price; if the month
 *  renewed at the old price first (the worker was down, or Paddle refused until then), the
 *  rest of the new month is credited back by Paddle's proration. Safe to run twice: each plan
 *  is claimed under its gym's lock as that gym's one pending change, and Paddle is read before
 *  it is asked. */
export async function applyPendingSizes(deps: BillingDeps): Promise<PendingSizesRun> {
  const run: PendingSizesRun = { applied: 0, waiting: 0, kept: 0, warned: 0 };
  const paddle = deps.paddle;
  if (paddle === null) return run;
  const now = deps.now();
  const due = await repo.duePendingPlans(deps.sql, { until: new Date(now.getTime() + PENDING_SIZE_LEAD_MS), limit: 50 });
  for (const row of due) {
    const outcome = await repo.claimPendingPlan(deps.sql, {
      gymId: row.gymId,
      subscriptionRowId: row.id,
      now,
      bucket: Math.floor(now.getTime() / PENDING_SIZE_RETRY_MS),
    });
    if (outcome === null) continue;
    if (outcome.kind === "kept") {
      run.kept += 1;
      deps.log.info({ event: "billing.size_kept_too_many", gymId: row.gymId }, "a smaller size was not made: too many members");
      await emailSizeKept(deps, row.gymId, row.id, outcome.members);
      continue;
    }
    if (await applyPendingSize(deps, paddle, { gymId: row.gymId, subscriptionRowId: row.id }, outcome.claim)) run.applied += 1;
    else run.waiting += 1;
  }
  run.warned = await sendSizeWarnings(deps);
  return run;
}

function consoleLinks(mail: BillingMail, slug: string): { plan: string; members: string } {
  const plan = `${mail.webOrigin}/console/${encodeURIComponent(slug)}`;
  return { plan, members: `${plan}/members` };
}

/** Email the billing staff of each gym with a smaller size due within three days that still
 *  has more members than it holds. Once per choice: marked before it is sent, so a second run
 *  never sends it again (and one lost in sending is not retried; the Plan card says it too). */
async function sendSizeWarnings(deps: BillingDeps): Promise<number> {
  const mail = deps.mail ?? null;
  if (mail === null) return 0;
  const now = deps.now();
  let sent = 0;
  for (const due of await repo.dueSizeWarnings(deps.sql, { now, within: SIZE_WARNING_WITHIN_MS, lead: PENDING_SIZE_LEAD_MS, limit: 500 })) {
    const facts = await repo.sizeNoticeFacts(deps.sql, { ...due, targetPlan: "pending" });
    if (facts === null || facts.pendingFrom === null || facts.members <= facts.targetSeatCap) continue;
    if (!(await repo.claimSizeWarning(deps.sql, { ...due, now }))) continue;
    const fallback = await repo.smallestFittingPlan(deps.sql, { gymId: due.gymId, members: facts.members });
    const links = consoleLinks(mail, facts.gymSlug);
    const decideAt = new Date(facts.pendingFrom.getTime() - PENDING_SIZE_LEAD_MS);
    for (const to of await billingRecipients(deps, due.gymId)) {
      await sendBillingEmail(
        deps,
        mail,
        sizeWarningEmail({
          to,
          gymName: facts.gymName,
          orgType: facts.orgType,
          members: facts.members,
          currentSeatCap: facts.currentSeatCap,
          currentPriceLabel: formatPriceMinor(facts.currentPriceMinor, facts.currency),
          targetSeatCap: facts.targetSeatCap,
          targetPriceLabel: formatPriceMinor(facts.targetPriceMinor, facts.currency),
          fallback: fallback === null ? null : { seatCap: fallback.seatCap, priceLabel: formatPriceMinor(fallback.priceMinor, facts.currency) },
          due: dayLabel(facts.pendingFrom, facts.timezone),
          decideBy: momentLabel(decideAt, facts.timezone),
          membersLink: links.members,
          planLink: links.plan,
        }),
        due.gymId,
        "size_warning",
      );
    }
    sent += 1;
  }
  return sent;
}

/** Tell a gym's billing staff its smaller size was not made. Sent once: the decision is
 *  written once (its Idempotency-Key), and this runs only on that write. */
async function emailSizeKept(deps: BillingDeps, gymId: string, subscriptionRowId: string, members: number): Promise<void> {
  const mail = deps.mail ?? null;
  if (mail === null) return;
  const facts = await repo.sizeNoticeFacts(deps.sql, { gymId, subscriptionRowId, targetPlan: "last_kept" });
  if (facts === null) return;
  const links = consoleLinks(mail, facts.gymSlug);
  for (const to of await billingRecipients(deps, gymId)) {
    await sendBillingEmail(
      deps,
      mail,
      sizeKeptEmail({
        to,
        gymName: facts.gymName,
        orgType: facts.orgType,
        // The count the decision was made on, not one taken since.
        members,
        currentSeatCap: facts.currentSeatCap,
        currentPriceLabel: formatPriceMinor(facts.currentPriceMinor, facts.currency),
        targetSeatCap: facts.targetSeatCap,
        planLink: links.plan,
      }),
      gymId,
      "size_kept",
    );
  }
}

/** Who a gym's billing emails go to: its staff who may manage billing now, by the same check
 *  as every billing route, so nobody the gym no longer counts as staff is told its figures. */
async function billingRecipients(deps: BillingDeps, gymId: string): Promise<string[]> {
  const out: string[] = [];
  for (const staff of await repo.staffWithEmail(deps.sql, gymId)) {
    if (await holdsPrivilege(deps, gymId, staff.userId, "billing.manage")) out.push(staff.email);
  }
  return out;
}

/** One email; a failure is logged (never the address) and never stops the worker. */
async function sendBillingEmail(deps: BillingDeps, mail: BillingMail, message: Parameters<EmailTransport["send"]>[0], gymId: string, kind: string): Promise<void> {
  try {
    await mail.transport.send(message);
    deps.log.info({ event: "billing.email_sent", kind, gymId }, "a billing email was sent");
  } catch (err) {
    deps.log.error({ event: "billing.email_failed", kind, gymId, errName: err instanceof Error ? err.name : typeof err }, "a billing email could not be sent");
  }
}

async function applyPendingSize(
  deps: BillingDeps,
  paddle: PaddleSettings,
  gym: { gymId: string; subscriptionRowId: string },
  claim: repo.PendingClaim,
): Promise<boolean> {
  const gymId = gym.gymId;
  const finish = async (failure: string | null): Promise<boolean> => {
    await repo.finishPlanChange(deps.sql, { changeId: claim.changeId, gymId, state: failure === null ? "done" : "failed", failure });
    // Not made: the gym keeps its whole size until the next attempt. A lost answer keeps the
    // hold, as Paddle may have made it; its webhook, or the next attempt's read, settles it.
    if (failure !== null && failure !== "change_unconfirmed") await repo.releaseHold(deps.sql, gym);
    return failure === null;
  };
  const fetched = await paddle.api.getSubscription(claim.subscriptionRef);
  if (fetched.kind !== "ok") {
    deps.log.warn({ event: "billing.pending_size_read_failed", gymId, result: fetched.kind }, "Paddle did not return a subscription for a smaller size");
    return await finish("payments_unavailable");
  }
  const sub = fetched.value;
  const item = sub.items[0];
  const onPaddle = sub.items.length === 1 && item !== undefined ? await repo.planForPaddleItem(deps.sql, item) : null;
  if (onPaddle?.id === claim.toPlanId) {
    await applyPaddleSubscription(deps, sub.id);
    return await finish(null);
  }
  if (onPaddle?.id !== claim.fromPlanId || (sub.status !== "active" && sub.status !== "trialing") || sub.scheduled_change !== null) {
    // Something else changed at Paddle: written through the one rule, which settles the size
    // waiting if the plan moved; otherwise it is tried again once the plan is in good standing.
    await applyPaddleSubscription(deps, sub.id);
    return await finish("plan_changed_meanwhile");
  }

  let mode: ProrationMode = "do_not_bill";
  if (sub.status === "active") {
    const started = sub.current_billing_period === null ? null : Date.parse(sub.current_billing_period.starts_at);
    const renewed = started !== null && started >= claim.pendingFrom.getTime() - 60_000;
    const nextCharge = sub.next_billed_at === null || sub.next_billed_at === undefined ? null : Date.parse(sub.next_billed_at);
    if (renewed) mode = "prorated_immediately";
    else if (nextCharge !== null && nextCharge - deps.now().getTime() < PADDLE_CHANGE_CUTOFF_MS) return await finish("too_close");
  }
  const changed = await paddle.api.changePrice(sub.id, claim.priceId, mode);
  if (changed.kind === "refused") {
    deps.log.error({ event: "billing.pending_size_refused", gymId, status: changed.status, code: changed.code }, "Paddle refused a smaller size; retrying");
    return await finish("change_declined");
  }
  if (changed.kind !== "ok") {
    deps.log.warn({ event: "billing.pending_size_unconfirmed", gymId, result: changed.kind }, "a smaller size's answer was lost; Paddle is read first next time");
    return await finish("change_unconfirmed");
  }
  await applyPaddleSubscription(deps, sub.id);
  deps.log.info({ event: "billing.pending_size_applied", gymId, plan: claim.planCode, mode, fitted: claim.fitted !== null }, "a gym's smaller size was made at Paddle");
  const done = await finish(null);
  if (claim.fitted !== null) await emailSizeFitted(deps, gymId, claim.fitted);
  return done;
}

/** Tell a gym's billing staff a bigger size than the one they asked for was made: the members
 *  did not fit it. Sent once, after the one change that made it. */
async function emailSizeFitted(deps: BillingDeps, gymId: string, fitted: { askedSeatCap: number; members: number }): Promise<void> {
  const mail = deps.mail ?? null;
  if (mail === null) return;
  const live = await orgsRepo.gymLiveSubscription(deps.sql, gymId);
  const facts = await repo.gymEmailFacts(deps.sql, gymId);
  if (live === null || facts === null) return;
  const links = consoleLinks(mail, facts.gymSlug);
  for (const to of await billingRecipients(deps, gymId)) {
    await sendBillingEmail(
      deps,
      mail,
      sizeFittedEmail({
        to,
        gymName: facts.gymName,
        orgType: facts.orgType,
        members: fitted.members,
        askedSeatCap: fitted.askedSeatCap,
        seatCap: live.planSeatCap,
        priceLabel: formatPriceMinor(live.priceMinor, live.currency),
        planLink: links.plan,
      }),
      gymId,
      "size_fitted",
    );
  }
}

/** A paying gym keeps everything this long after a payment fails. */
export const GRACE_MS = PAID_PLAN_GRACE_DAYS * 24 * 60 * 60 * 1000;

/** End the grace of plans past_due for that long. Safe to run twice. */
export async function endExpiredGraces(deps: BillingDeps): Promise<number> {
  const now = deps.now();
  const ended = await repo.endGraces(deps.sql, { cutoff: new Date(now.getTime() - GRACE_MS), now, limit: 200 });
  for (const gymId of ended) deps.log.info({ event: "billing.grace_ended", gymId }, "a gym's payment grace ended");
  return ended.length;
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


/** A Paddle trial may end up to this much after the gym's own, never more. */
const TRIAL_END_SLACK_MS = 60_000;
/** Paddle refuses changes this close to a charge; a trial ending sooner is charged now, the
 *  same day its window named. */
const TRIAL_MOVE_MIN_MS = 60 * 60 * 1000;

/** Fetch one subscription from Paddle and write it onto its gym through the one rule. */
export async function applyPaddleSubscription(deps: BillingDeps, subscriptionId: string, align = true): Promise<ApplyResult> {
  const paddle = deps.paddle;
  if (paddle === null) return "retry";
  const fetched = await paddle.api.getSubscription(subscriptionId);
  if (fetched.kind === "not_found") return "unknown";
  if (fetched.kind !== "ok") return "retry";
  const sub = fetched.value;

  const item = sub.items[0];
  const plan = sub.items.length === 1 && item !== undefined && item.quantity === 1
    ? await repo.planForPaddleItem(deps.sql, item)
    : null;

  // Which gym: the row already placed, else the checkout our server made for it.
  const placed = await repo.findPaddleSubscription(deps.sql, sub.id);
  let gymId = placed?.gymId ?? null;
  let checkoutId: string | null = null;
  if (gymId === null) {
    // Without the list the gym cannot be known, and "none of ours" would cancel a real payment.
    const listed = await paddle.api.listSubscriptionTransactions(sub.id);
    if (listed.kind !== "ok") return "retry";
    const ours = await repo.checkoutsForTransactions(deps.sql, listed.value.filter((t) => t.origin === "api").map((t) => t.id));
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
    if (outcome.decision.reason === "conflict" || outcome.decision.reason === "not_ours") {
      deps.log.error({ event: "billing.illegal_transition", reason: outcome.decision.reason, gymId }, "a Paddle subscription change was not applied");
    }
    return "unchanged";
  }
  deps.log.info({ event: "billing.applied", gymId, decision: outcome.decision.kind }, "a gym's paid plan changed");
  if (align && sub.status === "trialing") return await alignTrial(deps, paddle, sub, gymId);
  return "applied";
}

/** A Paddle trial never runs past the gym's own free trial (1c-ii round one, H2). Paddle
 *  counts whole days from when the card is saved, so a checkout paid late, or rounded up,
 *  would give free days the gym never had: its first charge is moved back to the gym's own
 *  trial end. A trial saved after the gym's own had ended is cancelled with nothing charged,
 *  since its window said nothing was due (re-check N1); one ending within the hour is
 *  charged now, the day its window named, or cancelled if that charge is refused. Safe to
 *  run on every event: once Paddle's date is the gym's, nothing is asked. */
async function alignTrial(deps: BillingDeps, paddle: PaddleSettings, sub: PaddleSubscription, gymId: string): Promise<ApplyResult> {
  const ownEnd = (await repo.ownTrialEnd(deps.sql, gymId))?.getTime() ?? null;
  const paddleEnd = sub.next_billed_at === null || sub.next_billed_at === undefined ? null : Date.parse(sub.next_billed_at);
  const now = deps.now().getTime();
  // Lined up with the gym's own trial: left alone, even after that end has passed and before
  // Paddle has taken the first charge (re-check N2). A window paid late always ends later.
  if (ownEnd !== null && paddleEnd !== null && paddleEnd <= ownEnd + TRIAL_END_SLACK_MS) return "applied";

  const cancel = async (why: string): Promise<ApplyResult> => {
    const cancelled = await paddle.api.cancelSubscriptionNow(sub.id);
    if (cancelled.kind !== "ok") {
      deps.log.error({ event: "billing.trial_not_cancelled", gymId, result: cancelled.kind }, "a Paddle trial past the gym's own could not be cancelled; retrying");
      return "retry";
    }
    deps.log.info({ event: "billing.trial_cancelled", gymId, why }, "a Paddle trial past the gym's own was cancelled, nothing charged");
    return await applyPaddleSubscription(deps, sub.id, false);
  };
  if (ownEnd === null || ownEnd <= now) return await cancel("own_trial_ended");

  if (ownEnd - now >= TRIAL_MOVE_MIN_MS) {
    const moved = await paddle.api.moveTrialEnd(sub.id, new Date(ownEnd).toISOString());
    if (moved.kind !== "ok") {
      const refusal = moved.kind === "refused" ? { status: moved.status, code: moved.code } : {};
      deps.log.error({ event: "billing.trial_not_aligned", gymId, result: moved.kind, ...refusal }, "a Paddle trial runs past the gym's own; retrying");
      return "retry";
    }
    deps.log.info({ event: "billing.trial_aligned", gymId }, "a Paddle trial now ends with the gym's own");
    return await applyPaddleSubscription(deps, sub.id, false);
  }
  const activated = await paddle.api.activateTrial(sub.id);
  if (activated.kind === "refused") return await cancel("first_charge_refused");
  if (activated.kind !== "ok") {
    deps.log.error({ event: "billing.trial_not_aligned", gymId, result: activated.kind }, "a Paddle trial ending now was not charged; retrying");
    return "retry";
  }
  deps.log.info({ event: "billing.trial_activated", gymId }, "a Paddle trial ending within the hour was charged now");
  return await applyPaddleSubscription(deps, sub.id, false);
}

/** Cancel at Paddle the trial checkouts whose gym's own trial has ended, so their window can
 *  no longer be paid (re-check N1). A transaction Paddle will not cancel was paid or closed
 *  already; either way it is not asked again. Safe to run twice. */
export async function closeStaleTrialCheckouts(deps: BillingDeps): Promise<number> {
  const paddle = deps.paddle;
  if (paddle === null) return 0;
  let closed = 0;
  for (const checkout of await repo.staleTrialCheckouts(deps.sql, deps.now(), 50)) {
    const cancelled = await paddle.api.cancelTransaction(checkout.providerRef);
    if (cancelled.kind === "unavailable") continue;
    await repo.closeCheckout(deps.sql, { checkoutId: checkout.id, gymId: checkout.gymId });
    closed += 1;
  }
  return closed;
}

export function toSnapshot(sub: PaddleSubscription, planId: string): Snapshot {
  // In a trial the date that matters is the first payment.
  const periodEnd = sub.status === "trialing" ? (sub.next_billed_at ?? sub.current_billing_period?.ends_at ?? null) : (sub.current_billing_period?.ends_at ?? null);
  return {
    status: sub.status,
    updatedAt: new Date(sub.updated_at),
    planId,
    currentPeriodEnd: periodEnd === null ? null : new Date(periodEnd),
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
    // A trial's checkout charged nothing, so there is nothing to give back.
    transactionRefs: listed.value.filter((t) => MONEY_TAKEN.has(t.status) && t.details?.totals?.grand_total !== "0").map((t) => t.id),
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
