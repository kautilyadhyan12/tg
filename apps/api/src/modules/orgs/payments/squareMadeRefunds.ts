// A REFUND MADE INSIDE SQUARE (ROADMAP 18d-iv-d-i; spec Part 3 §14.8): a gym owns its Square account, so somebody can refund there a
// payment the app took. The money has gone, so the app writes it on that payment by itself.
//
// THE WORST THING here is a member shown money they never got, a refund counted twice, or another person's payment marked. So a
// message is only a doorbell: Square's own record is read with the gym's own token, and that record names the payment exactly;
// never a price or a name. A refund is one row, unique by Square's id, written under the gym's lock; only what Square gave back
// above what the app already holds on that payment is written; nothing is written while a press on that payment waits on Square.
//
// Square sends `refund.created` and `refund.updated` "regardless of which Square product or Square API application" made it
// ("Refunds API Webhooks", read 2026-11-01). It can switch messages off after failed deliveries and does not resend what it
// skipped, so each connection's refunds are also read once an hour. A press left "We don't know" is answered from Square's record.
import { type SquareRefund } from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";
import { afterTaken, lookFrom, tokenFor } from "./cardRefunds.js";
import * as refunds from "./cardRefundsRepo.js";
import * as repo from "./repo.js";
import { accessContext, type PaymentsDeps } from "./service.js";
import type { SquareSettings } from "./settings.js";

export const SQUARE_REFUND_EVENTS: readonly string[] = ["refund.created", "refund.updated"];

export const MADE_IN_SQUARE = {
  /** Each connection's refunds are read this often, with this much overlap, as Square's list may lag its messages. */
  readEveryMs: 60 * 60_000,
  overlapMs: 60 * 60_000,
  readsPerRun: 50,
  pagesPerRead: 5,
  /** A press left "We don't know" is read again this often while Square cannot be asked. */
  lostLookAgainMs: 60 * 60_000,
  lostLooksPerRun: 50,
} as const;

/** What Square's record of one refund means here. `wait`: ask again, as a press on that payment waits on Square or Square gave no answer. */
export async function takeInRefund(deps: PaymentsDeps, square: SquareSettings, conn: { gymId: string; accountId: string }, token: string, refund: SquareRefund): Promise<"done" | "wait"> {
  const now = deps.now();
  const gym = await repo.readGym(deps.sql, conn.gymId);
  const timezone = gym?.timezone ?? "UTC";
  const known = await refunds.pressOfSquareRefund(deps.sql, conn.gymId, square.environment, refund.id);
  if (known !== null) {
    // Ours, or one already taken in: Square's message finishes it sooner than the next look.
    if (known.state === "pending") await afterTaken(deps, known, refund, dayInTz(now, timezone), now);
    return "done";
  }
  if (refund.status !== "PENDING" && refund.status !== "COMPLETED") {
    if (refund.status !== "FAILED" && refund.status !== "REJECTED") deps.log.warn({ event: "square.refund_status_unknown", gymId: conn.gymId, status: refund.status }, "a refund in Square has a status not placed");
    return "done";
  }
  if (!(await refunds.paymentHeldHere(deps.sql, conn.gymId, refund.payment_id))) return "done";
  // A refund's answer names no card: the card comes from the payment.
  const paid = await square.api.getPayment(token, refund.payment_id);
  if (paid.kind !== "ok") return "wait";
  const brand = paid.value.card_details?.card?.card_brand ?? null;
  const last4 = paid.value.card_details?.card?.last_4 ?? null;
  const madeAt = refund.created_at == null ? now : new Date(refund.created_at);
  const written = await refunds.recordMadeInSquare(deps.sql, {
    gymId: conn.gymId,
    environment: square.environment,
    accountId: conn.accountId,
    squareRefundId: refund.id,
    squarePaymentId: refund.payment_id,
    amountMinor: refund.amount_money.amount,
    currency: refund.amount_money.currency,
    card: brand === null || last4 === null || !/^[A-Z_]{1,40}$/.test(brand) ? null : { brand, last4 },
    madeAt,
    today: dayInTz(madeAt, timezone),
    now,
    lookAt: lookFrom(now, 0),
  });
  if (written.kind === "waiting") return "wait";
  if (written.kind === "written") await afterTaken(deps, written.press, refund, dayInTz(now, timezone), now);
  return "done";
}

/** Square's message: its record is read with each connected gym's token. `unknown`: to be asked again. */
export async function checkSquareRefund(deps: PaymentsDeps, square: SquareSettings, accountId: string, refundId: string): Promise<"done" | "unknown"> {
  let again = false;
  for (const row of await repo.connectionsOfAccount(deps.sql, square.environment, accountId)) {
    const token = row.accessToken === null ? null : square.tokens.open(row.accessToken, accessContext(row.gymId));
    if (token === null) continue;
    const read = await square.api.getRefund(token, refundId);
    if (read.kind === "unavailable") again = true;
    if (read.kind === "ok" && (await takeInRefund(deps, square, { gymId: row.gymId, accountId }, token, read.value)) === "wait") again = true;
  }
  return again ? "unknown" : "done";
}

export interface MadeInSquareRun {
  /** Connections whose refunds were read, and presses left "We don't know" that Square's record was read for. */
  reads: number;
  lostLooks: number;
}

/** The hourly read of one connection. False where the same stretch should be read again. */
async function readConnection(deps: PaymentsDeps, square: SquareSettings, row: repo.ConnectionRow, from: Date): Promise<boolean> {
  const token = row.accessToken === null ? null : square.tokens.open(row.accessToken, accessContext(row.gymId));
  if (token === null) return true;
  let cursor: string | null = null;
  for (let page = 0; page < MADE_IN_SQUARE.pagesPerRead; page++) {
    const listed = await square.api.listRefunds(token, { beginTime: from, cursor });
    if (listed.kind === "unavailable") return false;
    if (listed.kind === "refused") {
      deps.log.warn({ event: "square.refund_list_refused", gymId: row.gymId, status: listed.status, code: listed.code }, "Square refused to list refunds");
      return true;
    }
    if (listed.value.unread > 0) deps.log.warn({ event: "square.refund_unreadable", gymId: row.gymId, unread: listed.value.unread }, "a refund Square listed could not be read");
    let waits = false;
    for (const refund of listed.value.refunds) {
      if ((await takeInRefund(deps, square, row, token, refund)) === "wait") waits = true;
    }
    if (waits) return false;
    cursor = listed.value.cursor;
    if (cursor === null) return true;
  }
  deps.log.warn({ event: "square.refund_list_long", gymId: row.gymId }, "a gym's refunds ran past the pages of one read");
  return false;
}

/** One press left "We don't know": Square's record of its payment answers it. */
async function lookAtLost(deps: PaymentsDeps, square: SquareSettings, press: refunds.RefundPress, now: Date): Promise<void> {
  const token = await tokenFor(deps, square, press);
  // The gym left that Square account: only the gym can check, so the line stays.
  if (token === null) return;
  const later = new Date(now.getTime() + MADE_IN_SQUARE.lostLookAgainMs);
  const paid = await square.api.getPayment(token, press.squarePaymentId);
  if (paid.kind === "unavailable") {
    await refunds.setLostLook(deps.sql, press, later);
    return;
  }
  if (paid.kind === "refused") return;
  for (const id of paid.value.refund_ids ?? []) {
    const read = await square.api.getRefund(token, id);
    if (read.kind !== "ok" || (await takeInRefund(deps, square, { gymId: press.gymId, accountId: press.accountId }, token, read.value)) === "wait") {
      await refunds.setLostLook(deps.sql, press, later);
      return;
    }
  }
  await refunds.markNotInSquare(deps.sql, press);
}

/** The worker's minute. `gymIds`: only these gyms, for a test sharing its database; production passes null. */
export async function processMadeInSquare(deps: PaymentsDeps, square: SquareSettings, gymIds: readonly string[] | null = null): Promise<MadeInSquareRun> {
  const run: MadeInSquareRun = { reads: 0, lostLooks: 0 };
  const now = deps.now();
  const dueBefore = new Date(now.getTime() - MADE_IN_SQUARE.readEveryMs);
  for (const { row, readBefore } of await repo.claimRefundReads(deps.sql, square.environment, now, dueBefore, MADE_IN_SQUARE.readsPerRun, gymIds)) {
    run.reads += 1;
    const from = readBefore === null ? row.connectedAt : new Date(readBefore.getTime() - MADE_IN_SQUARE.overlapMs);
    if (!(await readConnection(deps, square, row, from))) await repo.setRefundsRead(deps.sql, row.gymId, square.environment, readBefore);
  }
  for (const press of await refunds.claimLostLooks(deps.sql, square.environment, now, MADE_IN_SQUARE.lostLooksPerRun, gymIds)) {
    run.lostLooks += 1;
    await lookAtLost(deps, square, press, now);
  }
  return run;
}
