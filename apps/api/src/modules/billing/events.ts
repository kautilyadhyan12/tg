// The worker's half of Paddle's and Razorpay's webhooks: each kept event names a
// subscription, and the subscription is fetched from its provider and written through the
// one rule (`applyPaddleSubscription`, `applyRazorpaySubscription`). Safe to run twice: the
// rule ignores a record it already holds, and every event is leased and finished by its lease.
import * as webhooks from "../webhooks/repo.js";
import * as repo from "./repo.js";
import {
  applyPaddleSubscription,
  applyPendingSizes,
  applyRazorpaySubscription,
  closeStaleTrialCheckouts,
  decideRazorpaySizes,
  endExpiredGraces,
  sendDueRazorpayCancels,
  settleOwedRefunds,
  type BillingDeps,
  type PendingSizesRun,
  type RazorpayCancelsRun,
  type RazorpaySizesRun,
  type RefundsRun,
} from "./service.js";

export const PADDLE_EVENTS = {
  perRun: 200,
  leaseMs: 5 * 60 * 1000,
  /** Paddle could not be asked: try again this long after. */
  retryAfterMs: [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 60 * 60_000],
  maxTries: 12,
  keepDays: 90,
} as const;

export interface PaddleEventsRun {
  applied: number;
  unchanged: number;
  deferred: number;
  givenUp: number;
  forgotten: number;
  /** The refunds owed, made or retried this run. */
  refunds: RefundsRun;
  /** Paid plans whose grace ended this run. */
  gracesEnded: number;
  /** Trial checkouts closed at Paddle because the gym's own trial ended. */
  trialCheckoutsClosed: number;
  /** Smaller sizes decided this run: made at Paddle, still waiting, or not made; warnings sent. */
  pendingSizes: PendingSizesRun;
}

export async function processPaddleEvents(deps: BillingDeps): Promise<PaddleEventsRun> {
  const run: PaddleEventsRun = {
    applied: 0,
    unchanged: 0,
    deferred: 0,
    givenUp: 0,
    forgotten: 0,
    refunds: { requested: 0, notNeeded: 0, deferred: 0, failed: 0 },
    gracesEnded: 0,
    trialCheckoutsClosed: 0,
    pendingSizes: { applied: 0, waiting: 0, kept: 0, warned: 0 },
  };
  for (let taken = 0; taken < PADDLE_EVENTS.perRun; taken++) {
    const event = await webhooks.claimDuePaddleEvent(deps.sql, deps.now(), PADDLE_EVENTS.leaseMs);
    if (event === null) break;
    if (event.payload === null) {
      await webhooks.finishEvent(deps.sql, event, "failed", deps.now());
      deps.log.warn({ event: "billing.event_unreadable", webhookEventId: event.id }, "a kept Paddle event no longer parses");
      run.givenUp += 1;
      continue;
    }
    const result = await applyPaddleSubscription(deps, event.payload.subscriptionId);
    if (result === "retry") {
      if (event.tries + 1 >= PADDLE_EVENTS.maxTries) {
        await webhooks.finishEvent(deps.sql, event, "failed", deps.now());
        deps.log.error({ event: "billing.event_given_up", webhookEventId: event.id }, "Paddle could not be asked about an event; given up");
        run.givenUp += 1;
      } else {
        const wait = PADDLE_EVENTS.retryAfterMs[Math.min(event.tries, PADDLE_EVENTS.retryAfterMs.length - 1)] ?? 60_000;
        await webhooks.deferEvent(deps.sql, event, new Date(deps.now().getTime() + wait), true);
        run.deferred += 1;
      }
      continue;
    }
    await webhooks.finishEvent(deps.sql, event, "done", deps.now());
    if (result === "applied" || result === "set_aside") run.applied += 1;
    else run.unchanged += 1;
  }
  run.refunds = await settleOwedRefunds(deps);
  // After the events, so a payment Paddle took in time is written before the grace ends.
  run.gracesEnded = await endExpiredGraces(deps);
  run.trialCheckoutsClosed = await closeStaleTrialCheckouts(deps);
  // After the events, so Paddle's latest record of each plan is written first.
  run.pendingSizes = await applyPendingSizes(deps);
  const keepSince = new Date(deps.now().getTime() - PADDLE_EVENTS.keepDays * 24 * 60 * 60 * 1000);
  run.forgotten = await webhooks.forgetOldPaddleEvents(deps.sql, keepSince, 1000);
  return run;
}

export interface RazorpayEventsRun {
  applied: number;
  unchanged: number;
  deferred: number;
  givenUp: number;
  forgotten: number;
  refunds: RefundsRun;
  gracesEnded: number;
  /** Plans set to end, sent to Razorpay or ended this run (1d-ii). */
  cancels: RazorpayCancelsRun;
  /** Smaller sizes decided, and ones no longer waiting ended at Razorpay, this run (1d-iii-b). */
  sizes: RazorpaySizesRun;
  /** Live plans past their month's end, queued to be read from Razorpay again. */
  reread: number;
}

/** A live plan's month must have ended this long ago before it is read again: Razorpay charges
 *  at the month's end, and its own event is the usual way the next month arrives. */
export const RENEWAL_GRACE_MS = 5 * 60 * 1000;
/** A plan still past its month's end is read again at most this often. */
export const REREAD_EVERY_MS = 15 * 60 * 1000;

/** Queue a read from Razorpay of each live plan whose month ended `RENEWAL_GRACE_MS` ago or more
 *  (1d-ii): Razorpay sends no event when a plan it has stopped charging (`halted`) falls due
 *  again, and a webhook can be lost. Kept as an event once per plan per quarter hour, so a plan
 *  Razorpay is slow to charge is asked four times an hour, not every minute. */
export async function rereadDueRazorpayPlans(deps: BillingDeps): Promise<number> {
  if ((deps.razorpay ?? null) === null) return 0;
  const now = deps.now();
  const due = await repo.dueRazorpayRenewals(deps.sql, { before: new Date(now.getTime() - RENEWAL_GRACE_MS), limit: 200 });
  const bucket = Math.floor(now.getTime() / REREAD_EVERY_MS);
  for (const subscriptionId of due) {
    await webhooks.keepRazorpayEvent(deps.sql, { eventId: `due:${subscriptionId}:${String(bucket)}`, payload: { type: "renewal.due", subscriptionId } });
  }
  return due.length;
}

/** Razorpay's kept events (1d-i), then the refunds owed, the graces due and the cancels due:
 *  the same rule, lease and retries as Paddle's. */
export async function processRazorpayEvents(deps: BillingDeps): Promise<RazorpayEventsRun> {
  const run: RazorpayEventsRun = {
    applied: 0,
    unchanged: 0,
    deferred: 0,
    givenUp: 0,
    forgotten: 0,
    refunds: { requested: 0, notNeeded: 0, deferred: 0, failed: 0 },
    gracesEnded: 0,
    cancels: { sent: 0, failed: 0, ended: 0, replaced: 0 },
    sizes: { warned: 0, made: 0, waiting: 0, kept: 0, ended: 0 },
    reread: 0,
  };
  run.reread = await rereadDueRazorpayPlans(deps);
  for (let taken = 0; taken < PADDLE_EVENTS.perRun; taken++) {
    const event = await webhooks.claimDueRazorpayEvent(deps.sql, deps.now(), PADDLE_EVENTS.leaseMs);
    if (event === null) break;
    if (event.payload === null) {
      await webhooks.finishEvent(deps.sql, event, "failed", deps.now());
      deps.log.warn({ event: "billing.event_unreadable", provider: "razorpay", webhookEventId: event.id }, "a kept Razorpay event no longer parses");
      run.givenUp += 1;
      continue;
    }
    const result = await applyRazorpaySubscription(deps, event.payload.subscriptionId);
    if (result === "retry") {
      if (event.tries + 1 >= PADDLE_EVENTS.maxTries) {
        await webhooks.finishEvent(deps.sql, event, "failed", deps.now());
        deps.log.error({ event: "billing.event_given_up", provider: "razorpay", webhookEventId: event.id }, "Razorpay could not be asked about an event; given up");
        run.givenUp += 1;
      } else {
        const wait = PADDLE_EVENTS.retryAfterMs[Math.min(event.tries, PADDLE_EVENTS.retryAfterMs.length - 1)] ?? 60_000;
        await webhooks.deferEvent(deps.sql, event, new Date(deps.now().getTime() + wait), true);
        run.deferred += 1;
      }
      continue;
    }
    await webhooks.finishEvent(deps.sql, event, "done", deps.now());
    if (result === "applied" || result === "set_aside") run.applied += 1;
    else run.unchanged += 1;
  }
  run.refunds = await settleOwedRefunds(deps);
  // After the events, so a payment Razorpay took in time is written before the grace ends.
  run.gracesEnded = await endExpiredGraces(deps);
  // After the events, so Razorpay's latest record of each plan is written first.
  run.sizes = await decideRazorpaySizes(deps);
  run.cancels = await sendDueRazorpayCancels(deps);
  // A refund owed for a month charged after a cancel, or by a size no longer wanted, found just
  // now, is made this run.
  if (run.cancels.ended > 0 || run.sizes.made > 0 || run.sizes.ended > 0) {
    const more = await settleOwedRefunds(deps);
    run.refunds = {
      requested: run.refunds.requested + more.requested,
      notNeeded: run.refunds.notNeeded + more.notNeeded,
      deferred: run.refunds.deferred + more.deferred,
      failed: run.refunds.failed + more.failed,
    };
  }
  const keepSince = new Date(deps.now().getTime() - PADDLE_EVENTS.keepDays * 24 * 60 * 60 * 1000);
  run.forgotten = await webhooks.forgetOldRazorpayEvents(deps.sql, keepSince, 1000);
  return run;
}
