// The worker's half of Paddle's webhook: each kept event names a subscription, and the
// subscription is fetched from Paddle and written through the one rule
// (`applyPaddleSubscription`). Safe to run twice: the rule ignores a record it already
// holds, and every event is leased and finished by its lease.
import * as webhooks from "../webhooks/repo.js";
import {
  applyPaddleSubscription,
  applyPendingSizes,
  closeStaleTrialCheckouts,
  endExpiredGraces,
  settleOwedRefunds,
  type BillingDeps,
  type PendingSizesRun,
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
