// A gym pays us through Paddle (ROADMAP Stage 3 item 1a; Part 5 §0's doorbell rule).
//
// The console presses Subscribe: our server makes a Paddle transaction at OUR price
// and the browser opens Paddle's checkout for it. What the gym is on is only ever
// written from Paddle's own record of the subscription, fetched by our server, and
// the subscription is placed on the gym named in OUR checkout row, never on anything
// the payment says about itself.
//
// An Indian gym pays in rupees through Razorpay the same way (1d-i; Kd, RULINGS 2026-09-24):
// our server creates a Razorpay subscription at OUR plan, the browser opens Razorpay's
// window for it, and only Razorpay's own record of it, fetched by our server, is written.
//
// Every checkout charges now. A gym in its own free trial that pays ends the trial when the
// payment lands and gets the plan's full size at once; keeping the trial is not paying yet
// (Kd, RULINGS 2026-09-30). Paid trials made before then (1c-ii, 1d-i: the card saved and the
// first payment taken when the trial ends) are still followed to their end.
//
// A paying gym may move to a bigger size: Paddle charges the rest of the month at once, and
// changes nothing if that charge fails. Razorpay cannot change what an Indian card, UPI or bank
// account mandate charges (1d-iii-a; refused on the test account, 2026-10-01), so a gym paying
// through Razorpay approves a new plan in Razorpay's window: the rest of this month's difference
// taken now, the new price from the day the paid month ends. Once paid it takes the old plan's
// place, and the old one is cancelled at Razorpay; anything it takes after that is refunded.
//
// A gym paying through Razorpay pays an overdue bill, changes how it pays and cancels from the
// console (1d-ii): Razorpay's own page for the bill, Razorpay's window for the card or bank
// account, and a cancel kept by us and sent to Razorpay in the hours before the paid month
// ends, since Razorpay cannot take one back.
import {
  PAID_PLAN_GRACE_DAYS,
  payerEmailSchema,
  PLAN_CANCEL_DECIDE_HOURS,
  razorpayPayLinkSchema,
  SMALLER_SIZE_DECIDE_HOURS,
  type OrgBillingPortalResponse,
  type OrgCheckoutResponse,
  type OrgCheckoutSyncResponse,
  type OrgPlanChangePreview,
  type OrgPlanCancelResponse,
  type OrgPlanChangeResponse,
  type OrgRazorpayMethodResponse,
  type OrgRazorpayPayResponse,
  type PaddleSubscription,
  type RazorpaySubscription,
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
import { paddleWindowCountry, type PaddleApi, type PaddleEnvironment, type ProrationMode } from "./paddle.js";
import type { RazorpayApi } from "./razorpay.js";
import {
  ENDED_AT_RAZORPAY,
  oldestOwedInvoice,
  razorpayCancelOutcome,
  razorpayOwes,
  razorpayPaidThrough,
  upgradeCharge,
} from "./razorpayPlan.js";
import * as repo from "./repo.js";

export interface PaddleSettings {
  api: PaddleApi;
  environment: PaddleEnvironment;
  clientToken: string;
}

export interface RazorpaySettings {
  api: RazorpayApi;
  /** Public: the browser's checkout needs it. */
  keyId: string;
}

export interface BillingDeps {
  sql: Sql;
  redis: RedisLike;
  /** Null when Paddle is not set up on this server. */
  paddle: PaddleSettings | null;
  /** Null or absent when Razorpay is not set up on this server: an Indian gym cannot pay. */
  razorpay?: RazorpaySettings | null;
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
  const razorpay = deps.razorpay ?? null;
  if (onlinePaymentFor(org.currencyDisplay, { paddle: deps.paddle !== null, razorpay: razorpay !== null }) !== "available") {
    throw new OrgsError(503, "payments_unavailable", UNAVAILABLE);
  }
  if (org.currencyDisplay === "INR") {
    if (razorpay === null) throw new OrgsError(503, "payments_unavailable", UNAVAILABLE);
    return await startRazorpayCheckout(deps, razorpay, { ...input, currency: org.currencyDisplay });
  }
  const paddle = deps.paddle;
  if (paddle === null) throw new OrgsError(503, "payments_unavailable", UNAVAILABLE);
  // A plan paid as anybody but the owner is refunded (`paidByOwner`): one whose email Paddle's
  // window cannot be filled in with could only be paid that way.
  if (windowEmail((await repo.gymPayer(deps.sql, input.gymId)).email) === null) {
    throw new OrgsError(409, "payer_email_unusable", "Paddle can't use the email address on the owner's account, so payments can't be taken here yet.");
  }

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

  const outcome = await repo.beginCheckout(deps.sql, { ...input, currency: org.currencyDisplay, provider: "paddle" });
  if (outcome.kind === "replay") {
    const { checkout } = outcome;
    if (checkout.state === "open" && checkout.providerRef !== null && checkout.provider === "paddle") {
      return checkoutResponse(paddle, checkout.id, checkout.providerRef, await repo.gymPayer(deps.sql, input.gymId));
    }
    throw replayRefusal(checkout);
  }
  if (outcome.kind !== "created") throw beginRefusal(deps, outcome, input.planCode, "paddle");

  // Only one checkout per gym can be paid: the ones this press replaced are cancelled.
  await closeSuperseded(deps, outcome.superseded);

  const checkoutId = outcome.checkout.id;
  const created = await paddle.api.createTransaction({
    priceId: outcome.providerPriceId,
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
    item.price.id === outcome.providerPriceId &&
    (item.price.trial_period ?? null) === null &&
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
  return checkoutResponse(paddle, checkoutId, txn.id, await repo.gymPayer(deps.sql, input.gymId));
}

/** A press that repeats an earlier one's key, when that checkout can no longer be opened. */
function replayRefusal(checkout: repo.CheckoutRow): OrgsError {
  if (checkout.state === "paid") return new OrgsError(409, "already_subscribed", "This plan is already paid for.");
  if (checkout.state === "creating") return new OrgsError(409, "checkout_in_progress", "Still opening. Try again in a moment.");
  return new OrgsError(409, "checkout_replaced", "That payment window has closed. Press Subscribe again.");
}

/** Why a checkout was not started, as the console is told. */
function beginRefusal(
  deps: BillingDeps,
  outcome: Exclude<repo.BeginCheckoutOutcome, { kind: "created" } | { kind: "replay" }>,
  planCode: string,
  provider: repo.PayProvider,
): OrgsError {
  switch (outcome.kind) {
    case "key_reused":
      return new OrgsError(422, "idempotency_key_reused", "This Idempotency-Key was already used for a different plan.");
    case "already_subscribed":
      return new OrgsError(409, "already_subscribed", "You're already on a paid plan.");
    case "payment_overdue":
      return new OrgsError(
        409,
        "payment_overdue",
        provider === "razorpay"
          ? "A payment is overdue. Press Pay now on your plan to pay it and carry on."
          : "A payment is overdue. Update your payment method to pay it and carry on.",
      );
    case "no_such_plan":
      return new OrgsError(404, "plan_not_found", "That plan isn't on your price list.");
    case "plan_too_small":
      return new OrgsError(
        409,
        "plan_too_small",
        `You have ${String(outcome.seatsUsed)} members, more than this plan's ${String(outcome.seatCap)}. Choose a bigger plan.`,
      );
    case "not_set_up":
      deps.log.error({ event: "billing.price_not_set_up", plan: planCode }, "a plan has no price at its payment company");
      return new OrgsError(503, "payments_unavailable", UNAVAILABLE);
    case "org_archived":
      return new OrgsError(409, "org_archived", "This organisation is archived.");
    case "not_found":
      return new OrgsError(404, "org_not_found", "Organisation not found.");
  }
}

/** Cancel, at their payment company, the checkouts a newer press replaced: only one checkout
 *  per gym can be paid. One that will not cancel is logged; if it is paid anyway, the second
 *  plan is set aside and refunded when it arrives. */
async function closeSuperseded(deps: BillingDeps, superseded: readonly { provider: repo.PayProvider; ref: string }[]): Promise<void> {
  for (const old of superseded) {
    const razorpay = deps.razorpay ?? null;
    if (old.provider === "razorpay" && razorpay !== null) {
      // Paid in the moments before this press: never the gym's plan now (`applySnapshot`), so it
      // is set aside, cancelled and refunded at once rather than when its webhook comes.
      const askedAt = deps.now();
      const fetched = await razorpay.api.getSubscription(old.ref);
      // Anything else (a mandate given, its payment not landed yet) is cancelled below as before.
      if (fetched.kind === "ok" && fetched.value.status !== "created" && (await applyRazorpay(deps, razorpay, fetched.value, askedAt)) === "set_aside") continue;
    }
    const cancelled =
      old.provider === "paddle"
        ? deps.paddle === null
          ? null
          : await deps.paddle.api.cancelTransaction(old.ref)
        : razorpay === null
          ? null
          : await razorpay.api.cancelSubscriptionNow(old.ref);
    if (cancelled === null || cancelled.kind !== "ok") {
      deps.log.warn(
        { event: "billing.cancel_superseded_failed", provider: old.provider, result: cancelled?.kind ?? "not_set_up" },
        "a replaced checkout could not be cancelled at its payment company",
      );
    }
  }
}

/** Every mark our server puts on a Razorpay subscription it creates: a subscription without
 *  it was made by something else on the same Razorpay account and is never touched. */
export const RAZORPAY_APP_NOTE = "aihg";

/** Razorpay states in which the gym may already hold the plan: its mandate was given. */
const RAZORPAY_TAKEN: ReadonlySet<string> = new Set(["authenticated", "active", "pending", "halted"]);

/** An Indian gym subscribes through Razorpay (1d-i). Our server creates the subscription at
 *  OUR plan, charged when the window is paid. */
async function startRazorpayCheckout(
  deps: BillingDeps,
  razorpay: RazorpaySettings,
  input: { userId: string; gymId: string; planCode: string; idempotencyKey: string; currency: string },
): Promise<OrgCheckoutResponse> {
  // A window this gym opened before may have been paid and not yet reached the gym (the tab
  // closed before it was confirmed): put it on the gym first, so the press below meets
  // "already on a plan" rather than opening a second payment.
  for (const open of await repo.openCheckoutsFor(deps.sql, input.gymId)) {
    if (open.providerRef === null || open.provider !== "razorpay") continue;
    const askedAt = deps.now();
    const fetched = await razorpay.api.getSubscription(open.providerRef);
    if (fetched.kind === "unavailable") throw new OrgsError(503, "payments_unavailable", UNAVAILABLE);
    if (fetched.kind !== "ok" || !RAZORPAY_TAKEN.has(fetched.value.status)) continue;
    if ((await applyRazorpay(deps, razorpay, fetched.value, askedAt)) === "retry") {
      throw new OrgsError(409, "payment_in_progress", "Your last payment is still going through. Try again in a minute.");
    }
  }

  const outcome = await repo.beginCheckout(deps.sql, { ...input, provider: "razorpay" });
  if (outcome.kind === "replay") {
    const { checkout } = outcome;
    if (checkout.state === "open" && checkout.providerRef !== null && checkout.provider === "razorpay") {
      const fetched = await razorpay.api.getSubscription(checkout.providerRef);
      if (fetched.kind === "unavailable") throw new OrgsError(503, "payments_unavailable", UNAVAILABLE);
      if (fetched.kind === "ok" && fetched.value.status === "created") {
        const plan = await razorpay.api.getPlan(fetched.value.plan_id);
        const payer = await repo.gymPayer(deps.sql, input.gymId);
        if (plan.kind === "ok") return razorpayResponse(razorpay, checkout.id, fetched.value.id, plan.value.item.name, payer);
      }
    }
    throw replayRefusal(checkout);
  }
  if (outcome.kind !== "created") throw beginRefusal(deps, outcome, input.planCode, "razorpay");

  // Only one checkout per gym can be paid: the ones this press replaced are cancelled.
  await closeSuperseded(deps, outcome.superseded);

  const checkoutId = outcome.checkout.id;
  const created = await razorpay.api.createSubscription({
    planId: outcome.providerPriceId,
    startAt: null,
    notes: { app: RAZORPAY_APP_NOTE, gym_id: input.gymId, checkout_id: checkoutId },
  });
  if (created.kind !== "ok") {
    await repo.failCheckout(deps.sql, { checkoutId, gymId: input.gymId });
    const refusal = created.kind === "refused" ? { status: created.status, code: created.code } : {};
    deps.log.warn({ event: "billing.subscription_not_created", provider: "razorpay", result: created.kind, ...refusal }, "Razorpay did not create a subscription");
    throw new OrgsError(503, "payments_unavailable", UNAVAILABLE);
  }
  const sub = created.value;
  // What Razorpay will charge must be exactly our price, from the moment it is paid, or
  // nothing is opened.
  const plan = sub.plan;
  const agrees =
    sub.plan_id === outcome.providerPriceId &&
    sub.status === "created" &&
    sub.quantity === 1 &&
    sub.paid_count === 0 &&
    sub.start_at === null &&
    sub.notes["checkout_id"] === checkoutId &&
    plan !== undefined &&
    plan.id === outcome.providerPriceId &&
    plan.item.amount === outcome.priceMinor &&
    plan.item.currency === outcome.currency &&
    plan.period === "monthly" &&
    plan.interval === 1;
  if (!agrees) {
    await razorpay.api.cancelSubscriptionNow(sub.id);
    await repo.failCheckout(deps.sql, { checkoutId, gymId: input.gymId });
    deps.log.error({ event: "billing.price_mismatch", provider: "razorpay", plan: input.planCode }, "Razorpay's subscription does not match our price");
    throw new OrgsError(503, "payments_unavailable", UNAVAILABLE);
  }
  if (!(await repo.openCheckout(deps.sql, { checkoutId, gymId: input.gymId, transactionId: sub.id }))) {
    await razorpay.api.cancelSubscriptionNow(sub.id);
    throw new OrgsError(409, "checkout_replaced", "That payment window has closed. Press Subscribe again.");
  }
  return razorpayResponse(razorpay, checkoutId, sub.id, plan.item.name, await repo.gymPayer(deps.sql, input.gymId));
}

/** The window's details. `payer` is the owner's email and the mobile for payments, for
 *  Razorpay's window to fill in (Kd, RULINGS 2026-09-29), whoever of the billing staff opens it;
 *  only billing staff, who alone may open a checkout, get them. */
function razorpayResponse(
  razorpay: RazorpaySettings,
  checkoutId: string,
  subscriptionId: string,
  description: string,
  payer: { email: string | null; mobile: string | null },
): OrgCheckoutResponse {
  return {
    checkoutId,
    provider: "razorpay",
    keyId: razorpay.keyId,
    subscriptionId,
    description: description.slice(0, 200) || "Monthly plan",
    contact: payer.mobile,
    email: windowEmail(payer.email),
  };
}

/** The owner's email for a payment window, or null when the console could not read it back. */
function windowEmail(email: string | null): string | null {
  return email !== null && payerEmailSchema.safeParse(email).success ? email : null;
}

/** Paddle's window, filled in with the owner's email and the gym's country (Kd, RULINGS
 *  2026-09-30), whoever of the billing staff opens it; only billing staff, who alone may open a
 *  checkout, get them. */
function checkoutResponse(
  paddle: PaddleSettings,
  checkoutId: string,
  transactionId: string,
  payer: { email: string | null; country: string | null },
): OrgCheckoutResponse {
  return {
    checkoutId,
    provider: "paddle",
    environment: paddle.environment,
    clientToken: paddle.clientToken,
    transactionId,
    email: windowEmail(payer.email),
    country: paddleWindowCountry(payer.country),
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
  if (checkout.provider === "razorpay") return await syncRazorpayCheckout(deps, input, checkout);
  const paddle = deps.paddle;
  if (paddle === null) throw new OrgsError(503, "payments_unavailable", UNAVAILABLE);

  let subscriptionId: string | null = null;
  if (checkout.providerRef !== null && checkout.state !== "failed") {
    const txn = await paddle.api.getTransaction(checkout.providerRef);
    if (txn.kind === "ok" && txn.value.subscription_id !== null && (txn.value.status === "paid" || txn.value.status === "completed")) {
      subscriptionId = txn.value.subscription_id;
      const applied = await applyPaddleSubscription(deps, subscriptionId);
      await bustEntitlements(deps.redis, input.userId);
      // Paid but not put on the gym (a newer press closed its window, the gym already had a
      // plan, or it was paid as somebody other than the owner): refunded.
      if (applied === "set_aside") return { state: "refunded" };
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

/** After Razorpay's window says the mandate was given: fetch the subscription our server
 *  created for THIS checkout — never the one the browser names — and put it on the gym now,
 *  rather than waiting for the webhook. Safe to call any number of times. */
async function syncRazorpayCheckout(
  deps: BillingDeps,
  input: { userId: string; gymId: string },
  checkout: repo.CheckoutRow,
): Promise<OrgCheckoutSyncResponse> {
  const razorpay = deps.razorpay ?? null;
  if (razorpay === null) throw new OrgsError(503, "payments_unavailable", UNAVAILABLE);
  let status: string | null = null;
  let applied: ApplyResult | null = null;
  if (checkout.providerRef !== null && checkout.state !== "failed") {
    const askedAt = deps.now();
    const fetched = await razorpay.api.getSubscription(checkout.providerRef);
    if (fetched.kind === "ok") {
      status = fetched.value.status;
      applied = await applyRazorpay(deps, razorpay, fetched.value, askedAt);
      await bustEntitlements(deps.redis, input.userId);
    }
  }
  const live = await orgsRepo.gymLiveSubscription(deps.sql, input.gymId);
  if (checkout.replacesRowId !== null && checkout.direction === "smaller") {
    // A smaller size (1d-iii-b): done once it waits on the gym's plan, or has taken its place.
    if (applied === "set_aside") return { state: "refunded" };
    const waiting = await repo.razorpayWaitingSize(deps.sql, input.gymId);
    const placed = checkout.providerRef === null ? null : await repo.findProviderSubscription(deps.sql, "razorpay", checkout.providerRef);
    if (waiting?.subscriptionRef === checkout.providerRef || (placed !== null && placed.gymId === input.gymId && LIVE_STATUSES.has(placed.status))) {
      return { state: "paid", subscription: (await currentPlan(deps, input.gymId)).subscription };
    }
    return { state: "waiting" };
  }
  if (checkout.replacesRowId !== null) {
    // A bigger size (1d-iii-a): the gym already had a plan through Razorpay, so it is paid only
    // when the plan on the gym is the one this window made.
    const placed = checkout.providerRef === null ? null : await repo.findProviderSubscription(deps.sql, "razorpay", checkout.providerRef);
    // Paid but not put on the gym (the plan changed meanwhile, or a newer press closed it): refunded.
    if (applied === "set_aside" || (placed !== null && placed.gymId === input.gymId && placed.cancelReason === "duplicate")) return { state: "refunded" };
    if (placed === null || placed.gymId !== input.gymId) return { state: "waiting" };
    if (live !== null && LIVE_STATUSES.has(placed.status)) return { state: "paid", subscription: toOrgSubscription(live) };
    return { state: "waiting" };
  }
  // Paid but not put on the gym (a newer press closed its window, or the gym already had a plan): refunded.
  const setAsideRow = checkout.providerRef === null ? null : await repo.findProviderSubscription(deps.sql, "razorpay", checkout.providerRef);
  if (applied === "set_aside" || (setAsideRow !== null && setAsideRow.gymId === input.gymId && setAsideRow.cancelReason === "duplicate")) {
    return { state: "refunded" };
  }
  if (live !== null && live.provider === "razorpay") {
    return { state: "paid", subscription: toOrgSubscription(live) };
  }
  // A trial window not paid before the gym's own trial ended: Razorpay expired it, nothing charged.
  if (status === "expired") return { state: "trial_ended" };
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
  const live = await orgsRepo.gymLiveSubscription(deps.sql, input.gymId);
  if (live?.provider === "razorpay") {
    throw new OrgsError(409, "paid_through_razorpay", "Your plan is paid through Razorpay: pay, change how you pay or cancel from your plan on the Overview.");
  }
  const paddle = deps.paddle;
  if (paddle === null) throw new OrgsError(503, "payments_unavailable", UNAVAILABLE);
  const plan = await repo.managedPlanFor(deps.sql, input.gymId);
  if (plan === null) throw new OrgsError(404, "no_paid_plan", "This plan isn't paid through us, so there's nothing to manage here.");
  // Paddle's page shows everything its customer pays for: it opens only for somebody
  // who manages the billing of every gym that customer pays for. Paddle keeps one customer
  // per email and the window is filled in with the owner's (1e), so an owner's gyms share one.
  const otherGyms = await repo.otherGymsOfCustomer(deps.sql, { customerRef: plan.customerRef, gymId: input.gymId });
  for (const otherGymId of otherGyms) {
    if (!(await holdsPrivilege(deps, otherGymId, input.userId, "billing.manage"))) {
      throw new OrgsError(409, "shared_payer", await sharedPayerMessage(deps, input.gymId, otherGyms));
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

/** Why Paddle's page can't be opened here, naming the owner when they can open it. */
async function sharedPayerMessage(deps: BillingDeps, gymId: string, otherGyms: readonly string[]): Promise<string> {
  // "organisation": the other one may be a studio or a trainer, whatever this one is.
  const refusal = "This payment account also pays for another organisation whose billing you don't manage, so it can't be opened here.";
  const owner = await repo.gymOwner(deps.sql, gymId);
  if (owner === null || owner.displayName.trim() === "") return `${refusal} The person who pays can open it.`;
  for (const otherGymId of otherGyms) {
    if (!(await holdsPrivilege(deps, otherGymId, owner.userId, "billing.manage"))) return `${refusal} The person who pays can open it.`;
  }
  return `${refusal} Ask ${owner.displayName.trim()}, the owner, to open it.`;
}

// ── A size change: bigger (1c-ii) or smaller (1c-iii) ─────────────────────────

/** Why a size change was refused, as the console is told. Kept on a failed change's row,
 *  so the same Idempotency-Key answers the same. */
const SIZE_REFUSALS: Record<string, { status: number; message: string }> = {
  no_paid_plan_trial: {
    status: 409,
    message: "Your free trial isn't paid for yet. Choose a plan to pay today and get its full size at once.",
  },
  no_paid_plan: { status: 409, message: "This plan isn't paid through us, so its size can't be changed here." },
  paid_through_razorpay: { status: 409, message: "This plan is paid through Razorpay, so its new size is paid in Razorpay's window." },
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
    case "paid_through_razorpay":
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

/** A plan paid through Razorpay cannot change size here yet (ROADMAP 1d-iii): said before
 *  anything asks Paddle, whether or not Paddle is set up on this server. */
async function refuseRazorpayPlan(deps: BillingDeps, gymId: string): Promise<void> {
  const live = await orgsRepo.gymLiveSubscription(deps.sql, gymId);
  if (live?.provider === "razorpay") throw sizeRefusal("paid_through_razorpay");
}

/** What a size change would cost now and from when. A bigger one as Paddle works it out; a
 *  smaller one charges and credits nothing, and its price starts when the month paid ends.
 *  Changes nothing. */
export async function previewSizeChange(
  deps: BillingDeps,
  input: { userId: string; gymId: string; planCode: string },
): Promise<OrgPlanChangePreview> {
  await requirePrivilege(deps, input.gymId, input.userId, "billing.manage");
  const live = await orgsRepo.gymLiveSubscription(deps.sql, input.gymId);
  if (live?.provider === "razorpay") return await previewRazorpaySize(deps, input);
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
  await refuseRazorpayPlan(deps, input.gymId);
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
 *  which still bills the size the gym is on. Through Razorpay, the smaller size's approved
 *  subscription is ended there. Safe to press twice. */
export async function keepSize(deps: BillingDeps, input: { userId: string; gymId: string }): Promise<OrgPlanChangeResponse> {
  await requirePrivilege(deps, input.gymId, input.userId, "billing.manage");
  const kept = await repo.keepSize(deps.sql, input);
  switch (kept.kind) {
    case "kept":
      deps.log.info({ event: "billing.size_kept", gymId: input.gymId }, "a gym kept its size");
      // A smaller size approved at Razorpay is ended there now (1d-iii-b).
      await endGymStrandedSizes(deps, input.gymId);
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
      await emailSizeKept(deps, row.gymId, row.id, outcome.members, outcome.trialing);
      continue;
    }
    if (await applyPendingSize(deps, paddle, { gymId: row.gymId, subscriptionRowId: row.id }, outcome.claim)) run.applied += 1;
    else run.waiting += 1;
  }
  run.warned = await sendSizeWarnings(deps, "paddle");
  return run;
}

function consoleLinks(mail: BillingMail, slug: string): { plan: string; members: string } {
  const plan = `${mail.webOrigin}/console/${encodeURIComponent(slug)}`;
  return { plan, members: `${plan}/members` };
}

/** Email the billing staff of each gym with a smaller size due within three days that still
 *  has more members than it holds. Once per choice: marked before it is sent, so a second run
 *  never sends it again (and one lost in sending is not retried; the Plan card says it too). */
async function sendSizeWarnings(deps: BillingDeps, provider: repo.PayProvider): Promise<number> {
  const mail = deps.mail ?? null;
  if (mail === null) return 0;
  const now = deps.now();
  let sent = 0;
  for (const due of await repo.dueSizeWarnings(deps.sql, { provider, now, within: SIZE_WARNING_WITHIN_MS, lead: PENDING_SIZE_LEAD_MS, limit: 500 })) {
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
          // Razorpay charges only a size the gym approved: there it stays unless it moves itself.
          fallback: fallback === null || facts.provider === "razorpay" ? null : { seatCap: fallback.seatCap, priceLabel: formatPriceMinor(fallback.priceMinor, facts.currency) },
          offer: fallback === null || facts.provider !== "razorpay" ? null : { seatCap: fallback.seatCap, priceLabel: formatPriceMinor(fallback.priceMinor, facts.currency) },
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
async function emailSizeKept(deps: BillingDeps, gymId: string, subscriptionRowId: string, members: number, trialing: boolean): Promise<void> {
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
        trialing,
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
  let discounted = sub.discount !== null && sub.discount !== undefined;
  if (gymId === null) {
    // Without the list the gym cannot be known, and "none of ours" would cancel a real payment.
    const listed = await paddle.api.listSubscriptionTransactions(sub.id);
    if (listed.kind !== "ok") return "retry";
    // A code for the first payment alone leaves the subscription's own discount empty.
    discounted ||= listed.value.some((t) => (t.details?.totals?.discount ?? "0") !== "0");
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
  if (placed === null) {
    // Paid as somebody other than the gym's owner: Paddle files it under that person's account,
    // whose page would then show this gym's plan, and lock its own gym out of it.
    const payer = await paidByOwner(deps, paddle, sub, gymId);
    if (payer === "retry") return "retry";
    if (payer === "someone_else") {
      deps.log.error({ event: "billing.wrong_payer", gymId }, "a Paddle subscription was paid as somebody other than the gym's owner: cancelling and refunding it");
      return await setAside(deps, paddle, sub, gymId, "duplicate");
    }
    // Our server gives no discount, so one was typed into Paddle's window: never the gym's plan.
    if (discounted) {
      deps.log.error({ event: "billing.discounted_subscription", gymId }, "a Paddle subscription carries a discount we never gave: cancelling and refunding it");
      return await setAside(deps, paddle, sub, gymId, "duplicate");
    }
  }

  const snapshot = toSnapshot(sub, plan.id);
  const outcome = await repo.applySnapshot(deps.sql, {
    gymId,
    provider: "paddle",
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

/** Was this subscription paid as the gym's owner? Paddle's window is filled in with the owner's
 *  email (1e) and keeps one customer per email, but the browser can open it with any email. */
async function paidByOwner(deps: BillingDeps, paddle: PaddleSettings, sub: PaddleSubscription, gymId: string): Promise<"owner" | "someone_else" | "retry"> {
  if (sub.customer_id === null) return "someone_else";
  const customer = await paddle.api.getCustomer(sub.customer_id);
  if (customer.kind !== "ok") {
    // A 403 is an API key without `customer.read`: the payment waits rather than being refunded.
    if (customer.kind !== "unavailable") deps.log.error({ event: "billing.customer_not_read", gymId, result: customer.kind }, "Paddle did not answer who paid; asking again");
    return "retry";
  }
  const owner = (await repo.gymPayer(deps.sql, gymId)).email;
  return owner !== null && owner.trim().toLowerCase() === customer.value.email.trim().toLowerCase() ? "owner" : "someone_else";
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
  let ended = sub.status === "canceled";
  if (!ended) {
    const cancelled = await paddle.api.cancelSubscriptionNow(sub.id);
    // Refused or unanswered: read back, and one Paddle has ended counts as cancelled.
    ended = cancelled.kind === "ok" || (await paddleEnded(paddle, sub.id));
    if (!ended) deps.log.error({ event: "billing.cancel_failed", result: cancelled.kind }, "could not cancel a subscription at Paddle; asking again");
  }
  const listed = await paddle.api.listSubscriptionTransactions(sub.id);
  if (listed.kind !== "ok") return "retry";
  await repo.oweRefunds(deps.sql, {
    gymId,
    provider: "paddle",
    subscriptionRef: sub.id,
    reason,
    // A trial's checkout charged nothing, so there is nothing to give back.
    transactionRefs: listed.value.filter((t) => MONEY_TAKEN.has(t.status) && t.details?.totals?.grand_total !== "0").map((t) => t.id),
  });
  // Not ended at Paddle: it would charge the next month, so its event is asked again.
  return ended ? "set_aside" : "retry";
}

async function paddleEnded(paddle: PaddleSettings, subscriptionId: string): Promise<boolean> {
  const fetched = await paddle.api.getSubscription(subscriptionId);
  return fetched.kind === "ok" && fetched.value.status === "canceled";
}

// ── Razorpay (1d-i) ─────────────────────────────────────────────────────────────

/** Fetch one subscription from Razorpay and write it onto its gym through the one rule. */
export async function applyRazorpaySubscription(deps: BillingDeps, subscriptionId: string): Promise<ApplyResult> {
  const razorpay = deps.razorpay ?? null;
  if (razorpay === null) return "retry";
  const askedAt = deps.now();
  const fetched = await razorpay.api.getSubscription(subscriptionId);
  if (fetched.kind === "not_found") return "unknown";
  if (fetched.kind !== "ok") return "retry";
  return await applyRazorpay(deps, razorpay, fetched.value, askedAt);
}

/** Razorpay's statuses in which a subscription never took a mandate or a payment. */
const RAZORPAY_NEVER_TAKEN: ReadonlySet<string> = new Set(["created", "cancelled", "expired", "completed"]);

/** Write a subscription just fetched from Razorpay onto its gym through the one rule. The
 *  gym is the one on OUR checkout row for this subscription, never the subscription's notes.
 *  `askedAt` is when Razorpay was asked: its record carries no time of its own, and an answer
 *  asked for earlier never overwrites one asked for later, however slowly it arrived.
 *  `endedAgain`: read again after the cancel this call sent for a plan past its end. */
async function applyRazorpay(
  deps: BillingDeps,
  razorpay: RazorpaySettings,
  sub: RazorpaySubscription,
  askedAt: Date,
  endedAgain = false,
): Promise<ApplyResult> {
  const placed = await repo.findProviderSubscription(deps.sql, "razorpay", sub.id);
  const checkout = await repo.checkoutForRazorpaySubscription(deps.sql, sub.id);
  let gymId = placed?.gymId ?? null;
  let checkoutId: string | null = null;
  if (gymId === null && checkout !== null && checkout.providerRef === sub.id) {
    gymId = checkout.gymId;
    checkoutId = checkout.id;
  }
  if (gymId === null) {
    // Something else on the same Razorpay account made it: not ours to cancel or refund.
    if (sub.notes["app"] !== RAZORPAY_APP_NOTE) return "unknown";
    // Ours, but no checkout of ours holds it: nobody gets a plan for it, so the money goes back.
    deps.log.error({ event: "billing.unplaced_subscription", provider: "razorpay", razorpayStatus: sub.status }, "a Razorpay subscription matches no checkout of ours");
    return await setAsideRazorpay(deps, razorpay, sub, null, "unmatched");
  }
  // A bigger (1d-iii-a) or smaller (1d-iii-b) size's checkout: see below.
  const sizeCheckout =
    checkout !== null && checkout.gymId === gymId && checkout.providerRef === sub.id && checkout.replacesRowId !== null && checkout.startsAt !== null
      ? { replacesRowId: checkout.replacesRowId, startsAt: checkout.startsAt, upfrontMinor: checkout.upfrontMinor }
      : null;
  // A smaller size not yet the gym's plan: it waits on the plan it replaces until it is decided.
  if (placed === null && sizeCheckout !== null && checkout !== null && checkout.direction === "smaller") {
    const waiting = await repo.razorpayWaitingSize(deps.sql, gymId);
    if (waiting?.subscriptionRef === sub.id) {
      if (ENDED_AT_RAZORPAY.has(sub.status)) {
        // Ended at Razorpay before its day (the gym's bank withdrew the mandate): the gym stays.
        await repo.dropRazorpayWaitingSize(deps.sql, { gymId, subscriptionRef: sub.id });
        deps.log.warn({ event: "billing.size_waiting_ended", provider: "razorpay", gymId }, "a smaller size ended at Razorpay before its day");
        return "applied";
      }
      // Waiting for its day; once decided it takes the plan's place below.
      if (!waiting.decided) return "unchanged";
    } else if ((checkout.state === "open" || checkout.state === "approved") && sub.status === "authenticated") {
      const approved = await repo.approveSmallerSize(deps.sql, { gymId, checkoutId: checkout.id, subscriptionRef: sub.id });
      if (approved === "approved") {
        deps.log.info({ event: "billing.size_scheduled", provider: "razorpay", gymId }, "a gym chose a smaller size from its next payment");
        // One chosen before it no longer waits: ended at Razorpay now.
        await endStrandedSizes(deps, razorpay, gymId);
        return "applied";
      }
      // The browser's answer and Razorpay's event about one approval, together: the other made it.
      if (approved === "already") return "unchanged";
      // Its plan changed while the window was open (set to end, renewed, replaced): not the gym's.
      await repo.closeCheckout(deps.sql, { checkoutId: checkout.id, gymId });
      return await setAsideRazorpay(deps, razorpay, sub, gymId, "duplicate");
    } else if (RAZORPAY_NEVER_TAKEN.has(sub.status) && sub.paid_count === 0) {
      return "unchanged";
    } else {
      // Approved and no longer waiting, or a window closed by a newer press: ended, refunded.
      return await setAsideRazorpay(deps, razorpay, sub, gymId, "duplicate");
    }
  }
  // A window never paid, or closed unpaid, puts nothing on the gym.
  if (placed === null && RAZORPAY_NEVER_TAKEN.has(sub.status) && sub.paid_count === 0) {
    // A bigger size's window takes only its add-on, which Razorpay does not count as a payment:
    // one paid and then ended before it was written (a newer press closed it) gives the gym
    // nothing, so what it took goes back.
    if (sizeCheckout !== null && sub.status !== "created") {
      const invoices = await razorpay.api.listSubscriptionInvoices(sub.id);
      if (invoices.kind !== "ok") return "retry";
      if (invoices.value.some((i) => i.subscription_id === sub.id && i.status === "paid")) {
        return await setAsideRazorpay(deps, razorpay, sub, gymId, "duplicate");
      }
    }
    return "unchanged";
  }

  // Our plan: the one recorded for Razorpay's plan now, else the one our checkout sold — a
  // price's Razorpay plan replaced later leaves the gyms already paying on the old one.
  const recorded = sub.quantity === 1 ? await repo.planForRazorpayPlan(deps.sql, sub.plan_id) : null;
  const planId = recorded?.id ?? (sub.quantity === 1 && checkout !== null && checkout.gymId === gymId ? checkout.planId : null);
  if (planId === null) {
    deps.log.error({ event: "billing.unknown_price", provider: "razorpay" }, "a Razorpay subscription is not at one of our plans");
    return "unknown";
  }
  let snapshot = toRazorpaySnapshot(sub, planId, askedAt);
  // A bigger size (1d-iii-a): Razorpay holds it `authenticated` until the replaced plan's month
  // ends and its first monthly charge is taken, but the gym has paid for the rest of this month
  // at the bigger size, so it is the gym's paying plan from now, paid to that day. Only once
  // Razorpay's own invoice says the rest of this month was paid.
  if (sizeCheckout !== null && sub.status === "authenticated" && snapshot !== null) {
    if (placed === null && sizeCheckout.upfrontMinor !== null) {
      const invoices = await razorpay.api.listSubscriptionInvoices(sub.id);
      if (invoices.kind !== "ok") return "retry";
      const upfront = sizeCheckout.upfrontMinor;
      if (!invoices.value.some((i) => i.subscription_id === sub.id && i.status === "paid" && i.amount_paid === upfront)) return "unchanged";
    }
    snapshot = { ...snapshot, status: "active", currentPeriodEnd: sub.start_at === null ? sizeCheckout.startsAt : new Date(sub.start_at * 1000) };
  }
  // A plan the gym set to end (1d-ii): Razorpay's record never shows it, so it is read against
  // our row — the paid month runs to its end whatever Razorpay says, and a month Razorpay
  // charges after it is refunded.
  const cancel = razorpayCancelOutcome(placed, sub, askedAt);
  if (cancel.kind === "ended" && !ENDED_AT_RAZORPAY.has(sub.status) && !endedAgain) {
    // The paid month is over and Razorpay still holds the plan: its cancel never reached Razorpay
    // (a run that claimed it stopped before sending it). Ended there now, before it charges the
    // next month, then read again, so a month charged in the meantime is seen and refunded.
    if (!(await cancelTaken(razorpay, sub.id, await razorpay.api.cancelSubscriptionNow(sub.id)))) {
      deps.log.error({ event: "billing.cancel_failed", provider: "razorpay", gymId }, "a plan past its end is still live at Razorpay; asking again");
      return "retry";
    }
    deps.log.warn({ event: "billing.cancel_sent_late", provider: "razorpay", gymId }, "a plan's cancel was sent at its end: its earlier send never reached Razorpay");
    const readAt = deps.now();
    const again = await razorpay.api.getSubscription(sub.id);
    if (again.kind !== "ok") return "retry";
    return await applyRazorpay(deps, razorpay, again.value, readAt, true);
  }
  if (cancel.kind === "refund_after" && placed !== null) {
    return await endChargedAfterCancel(deps, razorpay, sub, { gymId, planId, placed, after: cancel.after, askedAt });
  }
  if (cancel.kind === "keep_live" || cancel.kind === "ended") {
    snapshot = {
      status: cancel.kind === "ended" ? "canceled" : placed?.status === "trialing" ? "trialing" : "active",
      updatedAt: askedAt,
      planId,
      currentPeriodEnd: placed?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: true,
    };
  }
  if (snapshot === null) return "unchanged";
  // A failed payment leaves its bill owed. A halted plan whose card is changed goes `active`
  // with its missed bills still unpaid — Razorpay does not charge them (its "Payment Retries"
  // page) — and one whose bill is paid from its own page may stay `halted`. So while a payment
  // has failed, and over a plan past due or whose grace ran out, the plan is paid only once
  // Razorpay's own invoices say so (`razorpayOwes`).
  if (
    cancel.kind !== "ended" &&
    (snapshot.status === "past_due" || (snapshot.status === "active" && placed !== null && (placed.status === "past_due" || placed.cancelReason === repo.GRACE_EXPIRED)))
  ) {
    const invoices = await razorpay.api.listSubscriptionInvoices(sub.id);
    if (invoices.kind !== "ok") return "retry";
    if (razorpayOwes(sub, invoices.value, askedAt)) {
      snapshot = { ...snapshot, status: "past_due" };
    } else if (sub.status === "pending" || sub.status === "halted") {
      // Paid from the bill's own page while Razorpay still says a payment failed: paid through
      // the month that bill covers, when the plan is read again (`rereadDueRazorpayPlans`).
      snapshot = { ...snapshot, status: "active", currentPeriodEnd: razorpayPaidThrough(sub, invoices.value) };
    } else {
      snapshot = { ...snapshot, status: "active" };
    }
  }
  const outcome = await repo.applySnapshot(deps.sql, {
    gymId,
    provider: "razorpay",
    subscriptionId: sub.id,
    customerId: sub.customer_id ?? null,
    snapshot,
    checkoutId,
    now: deps.now(),
    replaces:
      sizeCheckout === null
        ? null
        : { rowId: sizeCheckout.replacesRowId, periodEnd: sizeCheckout.startsAt, afterRenewal: checkout?.direction === "smaller" },
  });
  if (outcome.replaced !== null) {
    deps.log.info({ event: "billing.size_changed", provider: "razorpay", gymId }, "a gym moved to its new size");
    await endReplacedPlan(deps, razorpay, { gymId, ...outcome.replaced });
  }
  if (outcome.duplicate) {
    if (outcome.decision.kind === "duplicate") {
      deps.log.error({ event: "billing.duplicate_subscription", provider: "razorpay", gymId }, "a second paid plan for one gym: cancelling and refunding it");
    }
    return await setAsideRazorpay(deps, razorpay, sub, gymId, "duplicate");
  }
  if (outcome.decision.kind === "ignore") {
    if (outcome.decision.reason === "conflict" || outcome.decision.reason === "not_ours") {
      deps.log.error({ event: "billing.illegal_transition", provider: "razorpay", reason: outcome.decision.reason, gymId }, "a Razorpay subscription change was not applied");
    }
    // An ended plan Razorpay still charges while the gym pays for another: cancelled, and every
    // payment taken after it ended refunded. The months it was the gym's plan stay paid.
    // A row still live is never set aside: its conflict is an out-of-date answer (Razorpay
    // handing a later ask an older state), which changes nothing.
    if (outcome.decision.reason === "conflict" && placed !== null && placed.endedAt !== null && RAZORPAY_TAKEN.has(sub.status)) {
      return await setAsideRazorpay(deps, razorpay, sub, gymId, "duplicate", placed.endedAt);
    }
    return "unchanged";
  }
  deps.log.info({ event: "billing.applied", provider: "razorpay", gymId, decision: outcome.decision.kind }, "a gym's paid plan changed");
  return "applied";
}

/** Razorpay took a payment for a month after the gym's plan was to end: the plan ends at the
 *  end of the month it paid for, Razorpay's subscription is cancelled now, and every payment
 *  taken from that end on is refunded in full (`settleOwedRefunds` makes them). */
async function endChargedAfterCancel(
  deps: BillingDeps,
  razorpay: RazorpaySettings,
  sub: RazorpaySubscription,
  input: { gymId: string; planId: string; placed: repo.PaddleRow; after: Date; askedAt: Date },
): Promise<ApplyResult> {
  if (input.placed.status === "trialing" || input.placed.status === "active" || input.placed.status === "past_due") {
    await repo.applySnapshot(deps.sql, {
      gymId: input.gymId,
      provider: "razorpay",
      subscriptionId: sub.id,
      customerId: sub.customer_id ?? null,
      snapshot: { status: "canceled", updatedAt: input.askedAt, planId: input.planId, currentPeriodEnd: input.placed.currentPeriodEnd, cancelAtPeriodEnd: true },
      checkoutId: null,
      now: deps.now(),
    });
  }
  return await setAsideRazorpay(deps, razorpay, sub, input.gymId, "cancelled", input.after, (owed) => {
    // Every later event about a plan ended for its cancel comes here (Razorpay's own
    // `subscription.cancelled` among them); only a payment written down now is news.
    if (owed > 0) {
      deps.log.error({ event: "billing.charged_after_cancel", provider: "razorpay", gymId: input.gymId, owed }, "Razorpay charged a plan after it was set to end: refunding it");
    }
  });
}

/** Razorpay's record in the one rule's terms (Razorpay docs, "Subscription States"). Null
 *  for `created`: nothing has been agreed yet.
 *  - authenticated: the mandate is given and the first payment waits for the gym's own trial
 *    to end, like a Paddle trial; its date is `charge_at`.
 *  - pending and halted: a payment failed. Razorpay retries for three days, then halts and
 *    keeps its invoices due; either way the plan is unpaid (Part 5 §4.1: halted is not dead).
 *  - cancelled, completed and expired: nothing more is charged. */
export function toRazorpaySnapshot(sub: RazorpaySubscription, planId: string, fetchedAt: Date): Snapshot | null {
  const at = (seconds: number | null): Date | null => (seconds === null ? null : new Date(seconds * 1000));
  const base = { updatedAt: fetchedAt, planId, cancelAtPeriodEnd: false };
  switch (sub.status) {
    case "created":
      return null;
    case "authenticated":
      return { ...base, status: "trialing", currentPeriodEnd: at(sub.charge_at ?? sub.start_at) };
    case "active":
      return { ...base, status: "active", currentPeriodEnd: at(sub.current_end) };
    case "pending":
    case "halted":
      return { ...base, status: "past_due", currentPeriodEnd: at(sub.current_end) };
    case "paused":
      return { ...base, status: "paused", currentPeriodEnd: at(sub.current_end) };
    case "cancelled":
    case "completed":
    case "expired":
      return { ...base, status: "canceled", currentPeriodEnd: at(sub.current_end) };
  }
}

/** Cancel a set-aside subscription at Razorpay and write down a refund for every payment it
 *  took — or, with `paidAfter`, every payment taken after that moment. Runs on every event
 *  about that subscription, so a cancel that failed is tried again and a later payment is
 *  added; `settleOwedRefunds` makes the refunds. The mandate's ₹5 check is refunded by
 *  Razorpay itself and is no invoice. */
async function setAsideRazorpay(
  deps: BillingDeps,
  razorpay: RazorpaySettings,
  sub: RazorpaySubscription,
  gymId: string | null,
  reason: repo.RefundReason,
  paidAfter: Date | null = null,
  onOwed: (owed: number) => void = () => undefined,
): Promise<ApplyResult> {
  let ended = ENDED_AT_RAZORPAY.has(sub.status);
  if (!ended) {
    const answer = await razorpay.api.cancelSubscriptionNow(sub.id);
    ended = await cancelTaken(razorpay, sub.id, answer);
    if (!ended) deps.log.error({ event: "billing.cancel_failed", provider: "razorpay", result: answer.kind }, "could not cancel a subscription at Razorpay; asking again");
  }
  const invoices = await razorpay.api.listSubscriptionInvoices(sub.id);
  if (invoices.kind !== "ok") return "retry";
  const owed = await repo.oweRefunds(deps.sql, {
    gymId,
    provider: "razorpay",
    subscriptionRef: sub.id,
    reason,
    transactionRefs: invoices.value.flatMap((i) =>
      i.status === "paid" &&
      i.payment_id !== null &&
      i.payment_id !== undefined &&
      i.subscription_id === sub.id &&
      // Razorpay stamps a payment to the second: one in the same second as the cut is after it.
      (paidAfter === null || (i.paid_at ?? 0) >= Math.floor(paidAfter.getTime() / 1000))
        ? [i.payment_id]
        : [],
    ),
  });
  onOwed(owed);
  // Not ended at Razorpay: it would charge the next month, so its event is asked again.
  return ended ? "set_aside" : "retry";
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
  const razorpay = deps.razorpay ?? null;
  const providers: repo.PayProvider[] = [];
  if (deps.paddle !== null) providers.push("paddle");
  if (razorpay !== null) providers.push("razorpay");
  if (providers.length === 0) return run;
  for (let taken = 0; taken < REFUNDS.perRun; taken++) {
    const owed = await repo.claimDueRefund(deps.sql, deps.now(), REFUNDS.leaseMs, providers);
    if (owed === null) break;
    const later = (ms: number) => new Date(deps.now().getTime() + ms);
    const giveUp = async (why: string) => {
      await repo.settleRefund(deps.sql, owed.id, "failed");
      deps.log.error({ event: "billing.refund_given_up", provider: owed.provider, refundId: owed.id, why }, "a refund we owe could not be made: refund it by hand at the payment company");
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

    if (owed.provider === "razorpay") {
      if (razorpay === null) {
        await repo.deferRefund(deps.sql, owed.id, later(REFUNDS.waitMs), false);
        run.deferred += 1;
        continue;
      }
      const payment = await razorpay.api.getPayment(owed.transactionRef);
      if (payment.kind === "unavailable") {
        await repo.deferRefund(deps.sql, owed.id, later(REFUNDS.waitMs), false);
        run.deferred += 1;
        continue;
      }
      if (payment.kind === "not_found") {
        await giveUp("not_found");
        continue;
      }
      if (payment.kind === "refused") {
        await refused();
        continue;
      }
      const pay = payment.value;
      // Already refunded, by us before or by hand: never asked again.
      if (pay.amount_refunded >= pay.amount || pay.status === "refunded") {
        await repo.settleRefund(deps.sql, owed.id, "requested");
        run.requested += 1;
        continue;
      }
      if (pay.status === "captured") {
        const made = await razorpay.api.refundPayment(owed.transactionRef, "Duplicate or unmatched subscription, refunded automatically");
        if (made.kind === "ok") {
          await repo.settleRefund(deps.sql, owed.id, "requested");
          run.requested += 1;
        } else if (made.kind === "refused") await refused();
        else {
          // No clear answer: the next run first asks whether Razorpay holds the refund.
          await repo.deferRefund(deps.sql, owed.id, later(REFUNDS.waitMs), false);
          run.deferred += 1;
        }
        continue;
      }
      if (pay.status === "authorized") {
        // Taken but not yet captured: a refund can only be made once it is.
        if (deps.now().getTime() - owed.createdAt.getTime() >= REFUNDS.maxAgeMs) await giveUp("never_captured");
        else {
          await repo.deferRefund(deps.sql, owed.id, later(REFUNDS.waitMs), false);
          run.deferred += 1;
        }
        continue;
      }
      // Failed or never finished: no money was taken.
      await repo.settleRefund(deps.sql, owed.id, "not_needed");
      run.notNeeded += 1;
      continue;
    }

    const paddle = deps.paddle;
    if (paddle === null) {
      await repo.deferRefund(deps.sql, owed.id, later(REFUNDS.waitMs), false);
      run.deferred += 1;
      continue;
    }
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

// ── A plan paid through Razorpay, managed from the console (1d-ii) ─────────────

/** A cancel is sent to Razorpay this long before the paid month ends; until then Keep my plan
 *  undoes it. */
export const CANCEL_LEAD_MS = PLAN_CANCEL_DECIDE_HOURS * 60 * 60 * 1000;

const NOT_RAZORPAY = "This plan isn't paid through Razorpay, so there's nothing to manage here.";

/** The gym's plan paid through Razorpay, for staff who manage its billing — read-only or not,
 *  since paying an overdue bill is how a read-only console opens again. */
async function razorpayPlan(
  deps: BillingDeps,
  input: { userId: string; gymId: string },
): Promise<{ razorpay: RazorpaySettings; plan: repo.RazorpayPlanRow; timezone: string }> {
  const { org } = await requirePrivilege(deps, input.gymId, input.userId, "billing.manage");
  const plan = await repo.razorpayPlanFor(deps.sql, input.gymId);
  if (plan === null) throw new OrgsError(404, "no_paid_plan", NOT_RAZORPAY);
  const razorpay = deps.razorpay ?? null;
  if (razorpay === null) throw new OrgsError(503, "payments_unavailable", UNAVAILABLE);
  return { razorpay, plan, timezone: org.timezone };
}

/** "Pay now": Razorpay's own page for the oldest bill this gym's plan still owes. The bill is
 *  found from the subscription on THIS gym's row, never one the browser names. */
export async function payRazorpayBill(deps: BillingDeps, input: { userId: string; gymId: string }): Promise<OrgRazorpayPayResponse> {
  const { razorpay, plan, timezone } = await razorpayPlan(deps, input);
  const invoices = await razorpay.api.listSubscriptionInvoices(plan.subscriptionRef);
  if (invoices.kind !== "ok") throw new OrgsError(503, "payments_unavailable", UNAVAILABLE);
  const owed = oldestOwedInvoice(plan.subscriptionRef, invoices.value);
  if (owed === null) {
    // Unpaid with no bill to pay: Razorpay has stopped charging the plan (`halted`) and the
    // month the last bill paid for is over. Only a new card or bank account starts it again.
    if (plan.status === "past_due" || plan.overdue) {
      const fetched = await razorpay.api.getSubscription(plan.subscriptionRef);
      if (fetched.kind === "ok" && (fetched.value.status === "halted" || fetched.value.status === "pending")) {
        const through = razorpayPaidThrough(fetched.value, invoices.value);
        // A bill just paid still covers days ahead: that is a payment on its way, not a stop.
        if (through !== null && through.getTime() > deps.now().getTime()) {
          throw new OrgsError(409, "nothing_owed", "Nothing is owed right now. A payment just made can take a minute to show here.");
        }
        const covered = through === null ? "" : `, your last payment covered up to ${dayLabel(through, timezone)}`;
        throw new OrgsError(
          409,
          "update_payment_method",
          `There's no bill to pay here${covered}, and Razorpay has stopped taking payments for this plan. Press Update payment method so it can take the next one.`,
        );
      }
    }
    throw new OrgsError(409, "nothing_owed", "Nothing is owed right now. A payment just made can take a minute to show here.");
  }
  const link = razorpayPayLinkSchema.safeParse(owed.short_url);
  if (!link.success) {
    deps.log.error({ event: "billing.pay_link_missing", provider: "razorpay", gymId: input.gymId }, "an owed Razorpay bill has no page of its own");
    throw new OrgsError(503, "payments_unavailable", UNAVAILABLE);
  }
  return { url: link.data };
}

/** Razorpay's states in which its window can change how a plan is paid: a plan that has taken
 *  its mandate and is not ended. */
const METHOD_CHANGEABLE: ReadonlySet<string> = new Set(["authenticated", "active", "pending", "halted"]);

/** "Update payment method": what the browser needs to open Razorpay's window for THIS gym's
 *  plan, to change the card or bank account it is paid from (Razorpay checkout's
 *  `subscription_card_change`; tried on the test account, 2026-10-01: a ₹5 check, refunded by
 *  Razorpay, and the plan otherwise unchanged). */
export async function openRazorpayMethod(deps: BillingDeps, input: { userId: string; gymId: string }): Promise<OrgRazorpayMethodResponse> {
  const { razorpay, plan } = await razorpayPlan(deps, input);
  const fetched = await razorpay.api.getSubscription(plan.subscriptionRef);
  if (fetched.kind !== "ok") throw new OrgsError(503, "payments_unavailable", UNAVAILABLE);
  if (!METHOD_CHANGEABLE.has(fetched.value.status)) {
    throw new OrgsError(409, "plan_ended", "This plan has ended at Razorpay, so how it's paid can't be changed.");
  }
  const payer = await repo.gymPayer(deps.sql, input.gymId);
  return { keyId: razorpay.keyId, subscriptionId: plan.subscriptionRef, contact: payer.mobile, email: windowEmail(payer.email) };
}

/** After the gym paid a bill or changed how it pays: Razorpay's record of THIS gym's plan is
 *  fetched and written now, rather than waiting for the webhook. Safe to call any number of times. */
export async function refreshRazorpayPlan(deps: BillingDeps, input: { userId: string; gymId: string }): Promise<void> {
  const { razorpay, plan } = await razorpayPlan(deps, input);
  const askedAt = deps.now();
  const fetched = await razorpay.api.getSubscription(plan.subscriptionRef);
  if (fetched.kind !== "ok") throw new OrgsError(503, "payments_unavailable", UNAVAILABLE);
  await applyRazorpay(deps, razorpay, fetched.value, askedAt);
  await bustEntitlements(deps.redis, input.userId);
}

/** "Cancel plan" on a plan paid through Razorpay. A paying plan is set to end when the month
 *  paid for ends — the gym keeps everything until then — and is sent to Razorpay in the hours
 *  before (at once, if the end is that close). A plan whose payment is overdue ends now: it is
 *  cancelled at Razorpay first, and nothing more is charged. */
export async function cancelRazorpayPlan(deps: BillingDeps, input: { userId: string; gymId: string }): Promise<OrgPlanCancelResponse> {
  await requirePrivilege(deps, input.gymId, input.userId, "billing.manage");
  const razorpay = deps.razorpay ?? null;
  const outcome = await repo.requestCancel(deps.sql, { ...input, now: deps.now(), leadMs: CANCEL_LEAD_MS });
  switch (outcome.kind) {
    case "not_found":
      throw new OrgsError(404, "org_not_found", "Organisation not found.");
    case "org_archived":
      throw new OrgsError(409, "org_archived", "This organisation is archived.");
    case "no_paid_plan":
      throw new OrgsError(404, "no_paid_plan", NOT_RAZORPAY);
    case "not_razorpay":
      throw new OrgsError(409, "paid_through_paddle", "Your plan is paid through Paddle: cancel it from Manage payment.");
    case "already":
      break;
    case "scheduled":
      if (outcome.sendNow && razorpay !== null) await sendDueRazorpayCancels(deps, input.gymId);
      // A smaller size that was waiting went with the plan's next month (1d-iii-b).
      await endGymStrandedSizes(deps, input.gymId);
      break;
    case "overdue": {
      if (razorpay === null) throw new OrgsError(503, "payments_unavailable", UNAVAILABLE);
      // The plan ends now, and nothing is collected from the moment Cancel was pressed: a
      // retry Razorpay takes before its cancel lands is refunded with any later payment.
      const pressedAt = deps.now();
      const cancelled = await cancelTaken(razorpay, outcome.subscriptionRef, await razorpay.api.cancelSubscriptionNow(outcome.subscriptionRef));
      if (!cancelled) {
        deps.log.warn({ event: "billing.cancel_failed", provider: "razorpay" }, "Razorpay did not cancel an overdue plan");
        throw new OrgsError(503, "payments_unavailable", "Razorpay couldn't be reached to cancel your plan. Please try again in a moment.");
      }
      await repo.markCancelSent(deps.sql, { gymId: input.gymId, userId: input.userId, rowId: outcome.rowId, now: pressedAt });
      const askedAt = deps.now();
      const fetched = await razorpay.api.getSubscription(outcome.subscriptionRef);
      if (fetched.kind === "ok") {
        await applyRazorpay(deps, razorpay, fetched.value, askedAt);
        await setAsideRazorpay(deps, razorpay, fetched.value, input.gymId, "cancelled", pressedAt);
      }
      await bustEntitlements(deps.redis, input.userId);
      break;
    }
  }
  return await planNow(deps, input.gymId);
}

/** "Keep my plan": a plan set to end goes on, while the cancel has not gone to Razorpay. */
export async function keepRazorpayPlan(deps: BillingDeps, input: { userId: string; gymId: string }): Promise<OrgPlanCancelResponse> {
  const { org } = await requirePrivilege(deps, input.gymId, input.userId, "billing.manage");
  const outcome = await repo.keepPlan(deps.sql, { ...input, now: deps.now(), leadMs: CANCEL_LEAD_MS });
  switch (outcome.kind) {
    case "not_found":
      throw new OrgsError(404, "org_not_found", "Organisation not found.");
    case "org_archived":
      throw new OrgsError(409, "org_archived", "This organisation is archived.");
    case "no_paid_plan":
      throw new OrgsError(404, "no_paid_plan", NOT_RAZORPAY);
    case "too_late":
      throw new OrgsError(
        409,
        "cancel_sent",
        `Your plan ends on ${outcome.endsAt === null ? "its last day" : dayLabel(outcome.endsAt, org.timezone)}, and it's too close to then to keep it. You can choose a plan again once it ends.`,
      );
    case "not_ending":
    case "kept":
      break;
  }
  return await planNow(deps, input.gymId);
}

/** The gym's plan as it now stands, or null when none is live. */
async function planNow(deps: BillingDeps, gymId: string): Promise<OrgPlanCancelResponse> {
  const live = await orgsRepo.gymLiveSubscription(deps.sql, gymId);
  return { subscription: live === null ? null : toOrgSubscription(live) };
}

export interface RazorpayCancelsRun {
  /** Cancels Razorpay took. */
  sent: number;
  /** Cancels Razorpay did not take this run: claimed again on the next. */
  failed: number;
  /** Plans set to end whose paid month is over, read from Razorpay again. */
  ended: number;
  /** Plans a bigger size replaced, cancelled at Razorpay this run (1d-iii-a). */
  replaced: number;
}

/** Send to Razorpay each cancel whose plan's paid month ends within `CANCEL_LEAD_MS`: at the end
 *  of the month for a plan that has charged one, at once for a paid trial not yet charged
 *  (Razorpay refuses a month-end cancel before the first charge; the gym keeps its plan to the
 *  trial's end all the same). Each plan is claimed in one statement, so two runs never send one
 *  twice, and Razorpay answers a second cancel the same as the first. `gymId` sends one gym's
 *  only (Cancel pressed close to the end). */
export async function sendDueRazorpayCancels(deps: BillingDeps, gymId?: string): Promise<RazorpayCancelsRun> {
  const run: RazorpayCancelsRun = { sent: 0, failed: 0, ended: 0, replaced: 0 };
  const razorpay = deps.razorpay ?? null;
  if (razorpay === null) return run;
  const now = deps.now();
  const claimed = await repo.claimCancelsToSend(deps.sql, { now, leadMs: CANCEL_LEAD_MS, limit: 50, ...(gymId === undefined ? {} : { gymId }) });
  for (const row of claimed) {
    let answer =
      row.status === "trialing"
        ? await razorpay.api.cancelSubscriptionNow(row.subscriptionRef)
        : await razorpay.api.cancelSubscriptionAtCycleEnd(row.subscriptionRef);
    if (row.status !== "trialing" && answer.kind === "refused") {
      // A bigger size whose first monthly charge is still to come (1d-iii-a) can only be ended
      // at once; the gym keeps it to the end of the month it paid for all the same.
      const fetched = await razorpay.api.getSubscription(row.subscriptionRef);
      if (fetched.kind === "ok" && fetched.value.status === "authenticated") answer = await razorpay.api.cancelSubscriptionNow(row.subscriptionRef);
    }
    if (await cancelTaken(razorpay, row.subscriptionRef, answer)) {
      run.sent += 1;
      deps.log.info({ event: "billing.cancel_sent", provider: "razorpay", gymId: row.gymId }, "a plan set to end was cancelled at Razorpay");
      continue;
    }
    run.failed += 1;
    deps.log.error({ event: "billing.cancel_failed", provider: "razorpay", gymId: row.gymId, result: answer.kind }, "Razorpay did not take a plan's cancel; asking again next run");
    await repo.unclaimCancel(deps.sql, { id: row.id, gymId: row.gymId, claimedAt: now });
  }
  if (gymId !== undefined) return run;
  // A plan a bigger size replaced, not yet seen ended at Razorpay: cancelled now.
  for (const old of await repo.replacedToCancel(deps.sql, { limit: 50 })) {
    if (await endReplacedPlan(deps, razorpay, old)) run.replaced += 1;
  }
  // A paid month over: the plan ends now, even if Razorpay's own webhook never comes.
  for (const subscriptionRef of await repo.dueCancelEnds(deps.sql, { now, limit: 50 })) {
    const result = await applyRazorpaySubscription(deps, subscriptionRef);
    if (result === "applied" || result === "set_aside") run.ended += 1;
  }
  return run;
}

/** Did a cancel take? Razorpay refuses to cancel a plan it has already ended ("Subscription is
 *  not cancellable in cancelled status.", tried 2026-10-01): a second press, or a cancel whose
 *  answer was lost and is asked again, finds it so. Refused or unanswered, the plan is read
 *  back, and one Razorpay has ended counts as cancelled. */
async function cancelTaken(razorpay: RazorpaySettings, subscriptionId: string, answer: { kind: string }): Promise<boolean> {
  if (answer.kind === "ok") return true;
  const fetched = await razorpay.api.getSubscription(subscriptionId);
  return fetched.kind === "ok" && ENDED_AT_RAZORPAY.has(fetched.value.status);
}


// ── A bigger (1d-iii-a) or smaller (1d-iii-b) size on a plan paid through Razorpay ─

/** A new size is refused this close to the end of the month paid: its window must be paid
 *  (`SIZE_WINDOW_MS`) before Razorpay charges the old plan's next month. */
export const SIZE_RENEW_GUARD_MS = 60 * 60 * 1000;
/** How long a new size's window can be paid for (Razorpay's `expire_by`). */
export const SIZE_WINDOW_MS = 30 * 60 * 1000;
/** What Razorpay's window and receipt call the rest of this month's difference. */
const UPFRONT_NAME = "The rest of this month at the bigger size";

const LIVE_STATUSES: ReadonlySet<string> = new Set(["trialing", "active", "past_due"]);

const RAZORPAY_SIZE_REFUSALS: Record<Exclude<repo.RazorpaySizeOutcome["kind"], "ok">, { status: number; code: string; message: string }> = {
  no_paid_plan: { status: 409, code: "no_paid_plan", message: "This plan isn't paid through us, so its size can't be changed here." },
  not_razorpay: { status: 409, code: "not_razorpay", message: "This plan isn't paid through Razorpay. Reload the page and try again." },
  payment_overdue: { status: 409, code: "payment_overdue", message: "A payment is overdue. Press Pay now on your plan to pay it, then change your size." },
  in_trial: {
    status: 409,
    code: "in_trial",
    message: "Your plan's first payment hasn't been taken yet. You can change its size once it has.",
  },
  plan_ending: { status: 409, code: "plan_ending", message: "Your plan is set to end, so its size can't be changed." },
  renewing: { status: 409, code: "renewing", message: "Your plan renews within the hour. Change its size after it renews." },
  no_such_plan: { status: 404, code: "plan_not_found", message: "That plan isn't on your price list." },
  same_size: { status: 409, code: "same_size", message: "That's the size you're on." },
  already_waiting: { status: 409, code: "already_waiting", message: "You're already moving to that size when your paid month ends." },
  not_set_up: { status: 503, code: "payments_unavailable", message: UNAVAILABLE },
};

function razorpaySizeRefusal(outcome: Exclude<repo.RazorpaySizeOutcome, { kind: "ok" }>): OrgsError {
  const refusal = RAZORPAY_SIZE_REFUSALS[outcome.kind];
  return new OrgsError(refusal.status, refusal.code, refusal.message);
}

const CHANGED_MEANWHILE = () => new OrgsError(409, "plan_changed_meanwhile", "Your plan changed meanwhile. Reload the page and try again.");

/** The month Razorpay last charged the gym's plan: its own record, fetched now. Refused unless
 *  Razorpay says it is paying and its month is the one our row holds; a renewal Razorpay has
 *  made and we have not written yet is written first. */
async function razorpayMonth(
  deps: BillingDeps,
  razorpay: RazorpaySettings,
  gymId: string,
  target: repo.RazorpaySizeTarget,
): Promise<{ start: Date; end: Date }> {
  const askedAt = deps.now();
  const fetched = await razorpay.api.getSubscription(target.subscriptionRef);
  if (fetched.kind !== "ok") throw new OrgsError(503, "payments_unavailable", UNAVAILABLE);
  const sub = fetched.value;
  if (sub.status === "pending" || sub.status === "halted") throw razorpaySizeRefusal({ kind: "payment_overdue" });
  if (sub.status === "authenticated") {
    // A bigger size already paid this month (1d-iii-a): its first monthly charge is still to
    // come, so the month it was priced in — its checkout's — is the one an even bigger size
    // is priced in.
    const sized = await repo.checkoutForRazorpaySubscription(deps.sql, sub.id);
    if (
      sized !== null &&
      sized.gymId === gymId &&
      sized.replacesRowId !== null &&
      sized.periodStart !== null &&
      sized.startsAt !== null &&
      sized.startsAt.getTime() === target.periodEnd.getTime() &&
      sub.start_at !== null &&
      sub.start_at * 1000 === target.periodEnd.getTime()
    ) {
      return { start: sized.periodStart, end: sized.startsAt };
    }
  }
  if (sub.status !== "active" || sub.current_start === null || sub.current_end === null) {
    await applyRazorpay(deps, razorpay, sub, askedAt);
    throw CHANGED_MEANWHILE();
  }
  if (sub.current_end * 1000 !== target.periodEnd.getTime()) {
    await applyRazorpay(deps, razorpay, sub, askedAt);
    throw CHANGED_MEANWHILE();
  }
  return { start: new Date(sub.current_start * 1000), end: new Date(sub.current_end * 1000) };
}

/** What a new size costs on a plan paid through Razorpay: a bigger one, the rest of this month's
 *  difference now, worked out by our server from our own price list (`upgradeCharge`); a smaller
 *  one, nothing now. Either way the new price from the day the paid month ends. Changes nothing. */
async function previewRazorpaySize(deps: BillingDeps, input: { gymId: string; planCode: string }): Promise<OrgPlanChangePreview> {
  const razorpay = deps.razorpay ?? null;
  if (razorpay === null) throw new OrgsError(503, "payments_unavailable", UNAVAILABLE);
  const found = await repo.razorpaySizeTarget(deps.sql, { ...input, now: deps.now(), renewGuardMs: SIZE_RENEW_GUARD_MS });
  if (found.kind !== "ok") throw razorpaySizeRefusal(found);
  const target = found.target;
  const month = await razorpayMonth(deps, razorpay, input.gymId, target);
  const charge = upgradeCharge({ fromMinor: target.fromPriceMinor, toMinor: target.priceMinor, periodStart: month.start, periodEnd: month.end, now: deps.now() });
  if (charge.kind === "month_over") throw razorpaySizeRefusal({ kind: "renewing" });
  const due = charge.kind === "charge" && target.direction === "bigger" ? formatPriceMinor(charge.minor, target.currency) : null;
  return {
    planCode: target.planCode,
    seatCap: target.seatCap,
    priceLabel: formatPriceMinor(target.priceMinor, target.currency),
    dueNow: due === null ? null : { totalLabel: due, subtotalLabel: due, taxLabel: null },
    nextPaymentAt: target.periodEnd.toISOString(),
  };
}

/** Why an earlier press of the same key cannot open its window again. */
function sizeReplayRefusal(checkout: repo.CheckoutRow): OrgsError {
  if (checkout.state === "paid") return new OrgsError(409, "size_changed", "Your new size is already paid for.");
  if (checkout.state === "creating") return new OrgsError(409, "checkout_in_progress", "Still opening. Try again in a moment.");
  return new OrgsError(409, "checkout_replaced", "That payment window has closed. Choose the size again.");
}

/** "Change size" on a plan paid through Razorpay: our server creates a new Razorpay subscription
 *  at the new size's plan, starting when the month paid ends, and the browser opens Razorpay's
 *  window for it. A bigger one takes the rest of this month's difference as its window is paid,
 *  and nothing changes on the gym until Razorpay's own record says it was paid. A smaller one
 *  takes nothing (Razorpay's ₹5 check, given back): once approved it waits on the plan, and is
 *  decided shortly before the paid month ends (`decideRazorpaySizes`). */
export async function startRazorpaySizeChange(
  deps: BillingDeps,
  input: { userId: string; gymId: string; planCode: string; idempotencyKey: string },
): Promise<OrgCheckoutResponse> {
  await requirePrivilege(deps, input.gymId, input.userId, "billing.manage");
  const razorpay = deps.razorpay ?? null;
  if (razorpay === null) throw new OrgsError(503, "payments_unavailable", UNAVAILABLE);

  // The same press again: answered from its own checkout, whatever the plan is now.
  const earlier = await repo.checkoutForKey(deps.sql, { gymId: input.gymId, idempotencyKey: input.idempotencyKey });
  if (earlier !== null) return await replaySizeCheckout(deps, razorpay, input, earlier);

  const found = await repo.razorpaySizeTarget(deps.sql, { ...input, now: deps.now(), renewGuardMs: SIZE_RENEW_GUARD_MS });
  if (found.kind !== "ok") throw razorpaySizeRefusal(found);
  const month = await razorpayMonth(deps, razorpay, input.gymId, found.target);

  const begun = await repo.beginSizeCheckout(deps.sql, {
    ...input,
    now: deps.now(),
    renewGuardMs: SIZE_RENEW_GUARD_MS,
    periodStart: month.start,
    periodEnd: month.end,
  });
  switch (begun.kind) {
    case "replay":
      return await replaySizeCheckout(deps, razorpay, input, begun.checkout);
    case "key_reused":
      throw new OrgsError(422, "idempotency_key_reused", "This Idempotency-Key was already used for a different plan.");
    case "refused":
      throw razorpaySizeRefusal(begun.outcome);
    case "plan_changed_meanwhile":
      throw CHANGED_MEANWHILE();
    case "org_archived":
      throw new OrgsError(409, "org_archived", "This organisation is archived.");
    case "not_found":
      throw new OrgsError(404, "org_not_found", "Organisation not found.");
    case "created":
      break;
  }
  const { checkout, target } = begun;
  await closeSuperseded(deps, begun.superseded);
  const startsAt = checkout.startsAt;
  if (startsAt === null) throw new Error("a size checkout without its start");

  const expireBy = new Date(deps.now().getTime() + SIZE_WINDOW_MS);
  const upfront = checkout.upfrontMinor;
  const created = await razorpay.api.createSubscription({
    planId: target.providerPlanId,
    startAt: startsAt,
    notes: { app: RAZORPAY_APP_NOTE, gym_id: input.gymId, checkout_id: checkout.id },
    upfront: upfront === null ? null : { name: UPFRONT_NAME, amountMinor: upfront, currency: target.currency },
    expireBy,
  });
  if (created.kind !== "ok") {
    await repo.failCheckout(deps.sql, { checkoutId: checkout.id, gymId: input.gymId });
    const refusal = created.kind === "refused" ? { status: created.status, code: created.code } : {};
    deps.log.warn({ event: "billing.subscription_not_created", provider: "razorpay", result: created.kind, ...refusal }, "Razorpay did not create a new size's subscription");
    throw new OrgsError(503, "payments_unavailable", UNAVAILABLE);
  }
  const sub = created.value;
  const plan = sub.plan;
  // What Razorpay will charge must be exactly ours — the new size's monthly price from the day
  // the paid month ends, and a bigger one's rest of this month's difference now — or nothing is
  // opened.
  let agrees =
    sub.plan_id === target.providerPlanId &&
    sub.status === "created" &&
    sub.quantity === 1 &&
    sub.paid_count === 0 &&
    sub.start_at === Math.ceil(startsAt.getTime() / 1000) &&
    (sub.expire_by ?? null) === Math.floor(expireBy.getTime() / 1000) &&
    sub.notes["checkout_id"] === checkout.id &&
    plan !== undefined &&
    plan.id === target.providerPlanId &&
    plan.item.amount === target.priceMinor &&
    plan.item.currency === target.currency &&
    plan.period === "monthly" &&
    plan.interval === 1;
  if (agrees) {
    // Razorpay makes the add-on's invoice with the subscription (seen 2026-10-01): it is the only
    // thing charged before the first month, and it is exactly the difference, or there is none
    // (a smaller size's never has one: its window took ₹5 and gave it back, tried 2026-10-01).
    const invoices = await razorpay.api.listSubscriptionInvoices(sub.id);
    const mine = invoices.kind === "ok" ? invoices.value.filter((i) => i.subscription_id === sub.id) : null;
    const first = mine?.[0];
    agrees =
      mine !== null &&
      (upfront === null
        ? mine.length === 0
        : mine.length === 1 && first !== undefined && first.status === "issued" && first.amount === upfront && (first.amount_due ?? upfront) === upfront);
  }
  if (!agrees || plan === undefined) {
    await razorpay.api.cancelSubscriptionNow(sub.id);
    await repo.failCheckout(deps.sql, { checkoutId: checkout.id, gymId: input.gymId });
    deps.log.error({ event: "billing.price_mismatch", provider: "razorpay", plan: input.planCode }, "Razorpay's new size does not match our price");
    throw new OrgsError(503, "payments_unavailable", UNAVAILABLE);
  }
  if (!(await repo.openCheckout(deps.sql, { checkoutId: checkout.id, gymId: input.gymId, transactionId: sub.id }))) {
    await razorpay.api.cancelSubscriptionNow(sub.id);
    throw new OrgsError(409, "checkout_replaced", "That payment window has closed. Choose the size again.");
  }
  return razorpayResponse(razorpay, checkout.id, sub.id, plan.item.name, await repo.gymPayer(deps.sql, input.gymId));
}

/** An earlier press's window, opened again while Razorpay still waits for it to be paid. */
async function replaySizeCheckout(
  deps: BillingDeps,
  razorpay: RazorpaySettings,
  input: { gymId: string; planCode: string },
  checkout: repo.CheckoutRow,
): Promise<OrgCheckoutResponse> {
  if (checkout.replacesRowId === null || checkout.planCode !== input.planCode) {
    throw new OrgsError(422, "idempotency_key_reused", "This Idempotency-Key was already used for a different plan.");
  }
  if (checkout.state === "open" && checkout.providerRef !== null && checkout.provider === "razorpay") {
    const fetched = await razorpay.api.getSubscription(checkout.providerRef);
    if (fetched.kind === "unavailable") throw new OrgsError(503, "payments_unavailable", UNAVAILABLE);
    if (fetched.kind === "ok" && fetched.value.status === "created") {
      const plan = await razorpay.api.getPlan(fetched.value.plan_id);
      if (plan.kind === "ok") return razorpayResponse(razorpay, checkout.id, fetched.value.id, plan.value.item.name, await repo.gymPayer(deps.sql, input.gymId));
    }
  }
  throw sizeReplayRefusal(checkout);
}

/** End at Razorpay the plan a bigger size replaced, and refund anything it took after that.
 *  False when Razorpay did not take the cancel: the worker asks again (`replacedToCancel`). */
async function endReplacedPlan(
  deps: BillingDeps,
  razorpay: RazorpaySettings,
  input: { gymId: string; rowId: string; subscriptionRef: string },
): Promise<boolean> {
  const answer = await razorpay.api.cancelSubscriptionNow(input.subscriptionRef);
  if (!(await cancelTaken(razorpay, input.subscriptionRef, answer))) {
    deps.log.error({ event: "billing.cancel_failed", provider: "razorpay", gymId: input.gymId, result: answer.kind }, "Razorpay did not cancel a replaced plan; asking again next run");
    return false;
  }
  await repo.markReplacedCancelSent(deps.sql, { gymId: input.gymId, rowId: input.rowId, now: deps.now() });
  // A month it charged after it was replaced goes back (its row is set to end: `razorpayCancelOutcome`).
  await applyRazorpaySubscription(deps, input.subscriptionRef);
  return true;
}

// ── A smaller size on a plan paid through Razorpay (1d-iii-b) ───────────────────

export interface RazorpaySizesRun {
  /** Warning emails sent: a smaller size due soon, and too many members for it. */
  warned: number;
  /** Decided and fitting: the smaller size took the plan's place. */
  made: number;
  /** Decided and fitting, but not yet in the plan's place (Razorpay unreachable): next run. */
  waiting: number;
  /** Not made: too many members, so the gym stays on its size (Kd, RULINGS 2026-10-01). */
  kept: number;
  /** Approved smaller sizes no longer waiting, ended at Razorpay this run. */
  ended: number;
}

/** Decide each smaller size through Razorpay that is due, `PENDING_SIZE_LEAD_MS` before the
 *  paid month ends: the members are counted under the gym's lock. If they fit, the approved
 *  subscription takes the plan's place now, paid to that day, and the old plan is cancelled at
 *  Razorpay, so only the smaller price is charged from then (`endReplacedPlan`; a month the old
 *  plan takes anyway is refunded). If not, the gym stays on its size, its billing staff are told,
 *  and the approved subscription is ended at Razorpay. Razorpay charges only a plan the gym
 *  approved, so it is never moved to a size it did not choose. Safe to run twice. */
export async function decideRazorpaySizes(deps: BillingDeps): Promise<RazorpaySizesRun> {
  const run: RazorpaySizesRun = { warned: 0, made: 0, waiting: 0, kept: 0, ended: 0 };
  const razorpay = deps.razorpay ?? null;
  if (razorpay === null) return run;
  const now = deps.now();
  const due = await repo.dueRazorpaySmallerSizes(deps.sql, { until: new Date(now.getTime() + PENDING_SIZE_LEAD_MS), limit: 50 });
  for (const row of due) {
    const claim = await repo.claimRazorpaySmallerSize(deps.sql, { gymId: row.gymId, rowId: row.id, now });
    if (claim === null) continue;
    if (claim.kind === "kept") {
      run.kept += 1;
      deps.log.info({ event: "billing.size_kept_too_many", provider: "razorpay", gymId: row.gymId }, "a smaller size was not made: too many members");
      await emailSizeKept(deps, row.gymId, row.id, claim.members, false);
      continue;
    }
    await applyRazorpaySubscription(deps, claim.subscriptionRef);
    const placed = await repo.findProviderSubscription(deps.sql, "razorpay", claim.subscriptionRef);
    if (placed !== null && placed.gymId === row.gymId && LIVE_STATUSES.has(placed.status)) {
      run.made += 1;
    } else if (placed !== null) {
      // Written but not as the gym's plan (set aside and refunded): the gym keeps its size.
      deps.log.error({ event: "billing.size_not_placed", provider: "razorpay", gymId: row.gymId }, "a decided smaller size was set aside; the gym keeps its size");
      await repo.dropRazorpayWaitingSize(deps.sql, { gymId: row.gymId, subscriptionRef: claim.subscriptionRef });
    } else if ((await repo.razorpayWaitingSize(deps.sql, row.gymId))?.subscriptionRef === claim.subscriptionRef) {
      run.waiting += 1;
    }
  }
  run.ended = await endStrandedSizes(deps, razorpay);
  run.warned = await sendSizeWarnings(deps, "razorpay");
  return run;
}

/** End at Razorpay each approved smaller size that no longer waits on the gym's plan, and refund
 *  anything it took (it never takes the ₹5 check, which Razorpay gives back itself). Marked once
 *  Razorpay has ended it, so one that would not cancel is asked again on the next run. */
async function endStrandedSizes(deps: BillingDeps, razorpay: RazorpaySettings, gymId?: string): Promise<number> {
  let ended = 0;
  for (const stranded of await repo.strandedSmallerSizes(deps.sql, { limit: 50, ...(gymId === undefined ? {} : { gymId }) })) {
    const fetched = await razorpay.api.getSubscription(stranded.subscriptionRef);
    if (fetched.kind === "not_found") {
      await repo.markSmallerDropped(deps.sql, stranded);
      continue;
    }
    if (fetched.kind !== "ok") continue;
    let sub = fetched.value;
    if (!ENDED_AT_RAZORPAY.has(sub.status)) {
      const answer = await razorpay.api.cancelSubscriptionNow(sub.id);
      if (!(await cancelTaken(razorpay, sub.id, answer))) {
        deps.log.error({ event: "billing.cancel_failed", provider: "razorpay", gymId: stranded.gymId, result: answer.kind }, "Razorpay did not cancel a smaller size no longer wanted; asking again next run");
        continue;
      }
      sub = { ...sub, status: "cancelled" };
    }
    if ((await setAsideRazorpay(deps, razorpay, sub, stranded.gymId, "duplicate")) !== "set_aside") continue;
    await repo.markSmallerDropped(deps.sql, stranded);
    ended += 1;
  }
  return ended;
}

/** After Cancel this change, or Cancel plan: the smaller size no longer waiting is ended at
 *  Razorpay at once rather than on the worker's next run. */
async function endGymStrandedSizes(deps: BillingDeps, gymId: string): Promise<void> {
  const razorpay = deps.razorpay ?? null;
  if (razorpay !== null) await endStrandedSizes(deps, razorpay, gymId);
}
