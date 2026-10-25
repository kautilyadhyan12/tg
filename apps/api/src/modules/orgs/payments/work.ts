// The worker's half of a gym's Square connection (ROADMAP 18d-i), every minute: Square's
// message that a gym took the app off its account, and its messages about a saved card
// (18d-ii), each checked with Square before anything changes (a webhook is a doorbell, never
// a messenger: CLAUDE.md §4); tokens owed a revoke and cards owed a stop; renewals that are
// due; presses of Connect Square that ran out; cards being saved on a Square Terminal whose page
// was closed (18d-ii-b-ii). Safe to run twice: events, revokes, stops, renewals and Terminal
// saves are each leased, and every write names the connection or card it was read for. Bills that
// have fallen due are charged to the card on file (18d-iii-i, `cardCharges.ts`). Square's messages about
// a payment, and the hourly look at each gym's Square payments, take in payments made in Square's own
// app (18d-iii-b-i, `squareAppPayments.ts`).
import * as webhooks from "../../webhooks/repo.js";
import { insertAudit } from "../repo.js";
import { SQUARE_CARD_EVENTS, SQUARE_CUSTOMER_DELETED_EVENT, checkSquareCard, checkSquareCustomer, sendOwedCardDisables } from "./cards.js";
import * as repo from "./repo.js";
import { SQUARE_REFRESH_EVERY_MS, accessContext, refreshContext, sendOwedRevokes, type PaymentsDeps } from "./service.js";
import type { SquareSettings } from "./settings.js";
import { processTerminalSaves } from "./terminalCards.js";
import { processTerminalPayments } from "./terminalPayments.js";
import { processCardCharges, type CardChargeRun } from "./cardCharges.js";
import { SQUARE_PAYMENT_EVENTS, sweepSquarePayments, takeInSquarePayment, type SweepRun } from "./squareAppPayments.js";

export const SQUARE_REVOKED_EVENT = "oauth.authorization.revoked";

export const SQUARE_WORK = {
  eventsPerRun: 100,
  refreshesPerRun: 50,
  leaseMs: 10 * 60_000,
  /** Square could not be asked about an event: try again this long after. */
  retryAfterMs: [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 60 * 60_000],
  maxTries: 12,
  /** A token Square still passes after its "removed" message is asked about this many more
   *  times, a minute, five and fifteen apart, before the message is taken as about no gym here. */
  recheckTries: 3,
  /** Square could not be asked for a renewal; or it refused one while the token still works. */
  renewAgainMs: 15 * 60_000,
  renewRefusedAgainMs: 60 * 60_000,
  keepDays: 90,
} as const;

export interface SquareWorkRun {
  /** Connections found taken off inside Square, by an event or a renewal. */
  removed: number;
  /** Events whose every connection still works. */
  unchanged: number;
  deferred: number;
  givenUp: number;
  forgotten: number;
  revokes: { sent: number; deferred: number; givenUp: number };
  /** Cards Square was owed a stop of (18d-ii). */
  cardStops: { sent: number; deferred: number; givenUp: number };
  renewed: number;
  renewalsWaiting: number;
  startsForgotten: number;
  /** Saves on a Square Terminal nobody was asking about, and done ones forgotten (18d-ii-b-ii). */
  terminalSaves: { asked: number; forgotten: number };
  terminalPayments: { asked: number; forgotten: number };
  /** Bills charged to the card on file, and charges Square had not answered (18d-iii-i). */
  cardCharges: CardChargeRun;
  /** Payments taken in Square's own app found by the hourly look (18d-iii-b-i). */
  sweeps: SweepRun;
}

type Check = "works" | "removed" | "unknown";

/** Does this connection's token still work at Square? A token that no longer opens, or that
 *  Square refuses, is a connection the gym no longer has: it is marked so. */
async function checkConnection(deps: PaymentsDeps, square: SquareSettings, row: repo.ConnectionRow): Promise<Check> {
  const token = row.accessToken === null ? null : square.tokens.open(row.accessToken, accessContext(row.gymId));
  if (token !== null) {
    const status = await square.api.tokenStatus(token);
    if (status.kind === "unavailable") return "unknown";
    if (status.kind === "ok" && status.value.merchant_id === row.accountId) return "works";
    // Only Square's 401 says the token is dead. Any other refusal (a retired Square-Version,
    // a fault of ours) says nothing about the gym: ask again, and say so in the log.
    if (status.kind === "refused" && status.status !== 401) {
      deps.log.error({ event: "square.token_check_refused", gymId: row.gymId, status: status.status, code: status.code }, "Square refused a token check");
      return "unknown";
    }
  } else {
    deps.log.error({ event: "square.token_unreadable", gymId: row.gymId }, "a gym's Square token could not be opened");
  }
  await deps.sql.begin(async (tx) => {
    if (!(await repo.markRemoved(tx, row.gymId, square.environment, row.connectedAt, deps.now()))) return;
    await insertAudit(tx, {
      actorUserId: null,
      gymId: row.gymId,
      action: "org.payments_square_removed_in_square",
      targetType: "gym",
      targetId: row.gymId,
      // `key`: the token was locked under a key this server no longer has (PAYMENT_TOKENS_KEY
      // changed), not taken off in Square.
      meta: { business: row.businessName, reason: token === null ? "key" : "square" },
    });
  });
  return "removed";
}

async function renew(deps: PaymentsDeps, square: SquareSettings, row: repo.ConnectionRow): Promise<"renewed" | "removed" | "waiting"> {
  const again = (ms: number) => repo.setRefreshDue(deps.sql, row.gymId, square.environment, row.connectedAt, new Date(deps.now().getTime() + ms));
  const refreshToken = row.refreshToken === null ? null : square.tokens.open(row.refreshToken, refreshContext(row.gymId));
  if (refreshToken === null) {
    if ((await checkConnection(deps, square, row)) === "removed") return "removed";
    await again(SQUARE_WORK.renewAgainMs);
    return "waiting";
  }
  const result = await square.api.refresh(refreshToken);
  if (result.kind === "unavailable") {
    await again(SQUARE_WORK.renewAgainMs);
    return "waiting";
  }
  if (result.kind === "refused" || result.value.merchant_id !== row.accountId) {
    // Square said no: the gym may have taken the app off, or the fault is ours. Its token
    // decides which.
    const check = await checkConnection(deps, square, row);
    if (check === "removed") return "removed";
    deps.log.error({ event: "square.renewal_refused", gymId: row.gymId, ...(result.kind === "refused" ? { status: result.status, code: result.code } : {}) }, "Square refused a renewal");
    await again(check === "works" ? SQUARE_WORK.renewRefusedAgainMs : SQUARE_WORK.renewAgainMs);
    return "waiting";
  }
  const written = await repo.writeRefreshed(deps.sql, {
    gymId: row.gymId,
    environment: square.environment,
    connectedAt: row.connectedAt,
    accessToken: square.tokens.lock(result.value.access_token, accessContext(row.gymId)),
    refreshToken: square.tokens.lock(result.value.refresh_token, refreshContext(row.gymId)),
    accessExpiresAt: new Date(result.value.expires_at),
    refreshDueAt: new Date(deps.now().getTime() + SQUARE_REFRESH_EVERY_MS),
  });
  return written ? "renewed" : "waiting";
}

/** `eventIds`: only these events, and `gymIds`: only these gyms' renewals, revokes, card stops and
 *  presses, for a test sharing its database with a real connection (one run days ahead once
 *  marked Kd's own test connection taken off, 2026-10-20); production passes null for both. */
export async function processSquareWork(deps: PaymentsDeps, eventIds: readonly string[] | null = null, gymIds: readonly string[] | null = null): Promise<SquareWorkRun> {
  const run: SquareWorkRun = {
    removed: 0,
    unchanged: 0,
    deferred: 0,
    givenUp: 0,
    forgotten: 0,
    revokes: { sent: 0, deferred: 0, givenUp: 0 },
    cardStops: { sent: 0, deferred: 0, givenUp: 0 },
    renewed: 0,
    renewalsWaiting: 0,
    startsForgotten: 0,
    terminalSaves: { asked: 0, forgotten: 0 },
    terminalPayments: { asked: 0, forgotten: 0 },
    cardCharges: { asked: 0, charged: 0, paid: 0, declined: 0 },
    sweeps: { looked: 0, payments: 0, unanswered: 0 },
  };
  const square = deps.square;
  if (square === null) return run;

  for (let taken = 0; taken < SQUARE_WORK.eventsPerRun; taken++) {
    const event = await webhooks.claimDueSquareEvent(deps.sql, deps.now(), SQUARE_WORK.leaseMs, eventIds);
    if (event === null) break;
    const payload = event.payload;
    const isCard = payload !== null && SQUARE_CARD_EVENTS.includes(payload.type) && payload.cardId !== undefined;
    const isCustomer = payload !== null && payload.type === SQUARE_CUSTOMER_DELETED_EVENT && payload.customerId !== undefined;
    const isPayment = payload !== null && SQUARE_PAYMENT_EVENTS.includes(payload.type) && payload.paymentId !== undefined;
    if (payload === null || (payload.type !== SQUARE_REVOKED_EVENT && !isCard && !isCustomer && !isPayment)) {
      await webhooks.finishEvent(deps.sql, event, "failed", deps.now());
      deps.log.warn({ event: "square.event_unreadable", webhookEventId: event.id }, "a kept Square event no longer parses");
      run.givenUp += 1;
      continue;
    }
    let unknown = false;
    if (isCard && payload.cardId !== undefined) {
      unknown = (await checkSquareCard(deps, square, payload.accountId, payload.cardId)) === "unknown";
    } else if (isCustomer && payload.customerId !== undefined) {
      unknown = (await checkSquareCustomer(deps, square, payload.accountId, payload.customerId)) === "unknown";
    } else if (isPayment && payload.paymentId !== undefined) {
      unknown = (await takeInSquarePayment(deps, square, payload.accountId, payload.paymentId, event.receivedAt)) === "unknown";
    } else {
      let stillWorks = false;
      for (const row of await repo.connectionsOfAccount(deps.sql, square.environment, payload.accountId)) {
        const check = await checkConnection(deps, square, row);
        if (check === "removed") run.removed += 1;
        if (check === "unknown") unknown = true;
        if (check === "works") stillWorks = true;
      }
      // Square's own check can still pass a token for some seconds after its message (seen in
      // its test area, 2026-10-20): a token that works is asked about again before it is believed.
      if (stillWorks && event.tries < SQUARE_WORK.recheckTries) unknown = true;
    }
    if (!unknown) {
      await webhooks.finishEvent(deps.sql, event, "done", deps.now());
      run.unchanged += 1;
      continue;
    }
    if (event.tries + 1 >= SQUARE_WORK.maxTries) {
      await webhooks.finishEvent(deps.sql, event, "failed", deps.now());
      deps.log.error({ event: "square.event_given_up", webhookEventId: event.id }, "Square could not be asked about an event; given up");
      run.givenUp += 1;
    } else {
      const wait = SQUARE_WORK.retryAfterMs[Math.min(event.tries, SQUARE_WORK.retryAfterMs.length - 1)] ?? 60_000;
      await webhooks.deferEvent(deps.sql, event, new Date(deps.now().getTime() + wait), true);
      run.deferred += 1;
    }
  }

  run.revokes = await sendOwedRevokes(deps, square, null, 50, gymIds);
  run.cardStops = await sendOwedCardDisables(deps, square, null, 50, gymIds);
  run.terminalSaves = await processTerminalSaves(deps, square, gymIds);
  run.terminalPayments = await processTerminalPayments(deps, square, gymIds);
  run.cardCharges = await processCardCharges(deps, square, gymIds);
  run.sweeps = await sweepSquarePayments(deps, square, gymIds);

  for (const row of await repo.claimDueRefreshes(deps.sql, square.environment, deps.now(), SQUARE_WORK.leaseMs, SQUARE_WORK.refreshesPerRun, gymIds)) {
    const outcome = await renew(deps, square, row);
    if (outcome === "renewed") run.renewed += 1;
    else if (outcome === "removed") run.removed += 1;
    else run.renewalsWaiting += 1;
  }

  run.startsForgotten = await repo.forgetExpiredStarts(deps.sql, square.environment, deps.now(), gymIds);
  run.forgotten = await webhooks.forgetOldSquareEvents(deps.sql, new Date(deps.now().getTime() - SQUARE_WORK.keepDays * 24 * 60 * 60 * 1000), 1000);
  return run;
}
