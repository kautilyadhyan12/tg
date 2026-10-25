// A PAYMENT TAKEN IN SQUARE'S OWN APP, RECORDED ON THE MEMBER (ROADMAP 18d-iii-b-i; spec Part 3 §14.8;
// rulings/2026-10-25-18d-iii-b-i.md; the rule is `squareAppDecision` in @app/shared).
//
// Staff take a payment on a Square Reader in Square's own app, pick the person there and type the
// bill's total. Square's message about it (`payment.created`, `payment.updated`) is a doorbell: the
// worker asks Square for the payment itself, and for its order, which says what was sold. Every hour it
// also asks Square for the gym's payments since its last look, so a payment whose messages never came
// (our server down longer than Square sends them again) is still taken in.
//
// THE WORST THING here is money put on the wrong person's bill, or recorded twice. So a payment is taken
// in once (unique on Square's own id, under the gym's lock), the app's own Terminal and card on file
// payments never; it goes to the gym whose Square customer it names, at that gym's own location; only a
// customer the app keeps for one record of that gym, with every line a typed amount and exactly one bill
// of exactly one person fitting, is recorded, by the same step Record payment takes; everything else is
// kept, waiting for staff. A payment Square made before the gym was watched, or more than
// `SQUARE_APP.keepDays` ago, is never taken in: a refund's message about an old payment is never put
// on a bill of today's.
import { randomUUID } from "node:crypto";
import { SQUARE_APP, squareAppDecision, squareAppLinesOf, type SquareAppCustomer, type SquareAppLines, type SquarePayment } from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";
import { lockGym } from "../memberList/repo.js";
import { recordPaymentIn } from "../memberships/billsRepo.js";
import { recordFeePaymentIn } from "../memberships/feesRepo.js";
import * as repo from "./repo.js";
import { accessContext, readsOrders, type PaymentsDeps } from "./service.js";
import type { SquareSettings } from "./settings.js";
import * as taken from "./squareAppPaymentsRepo.js";

/** Square's messages about a payment. Each is checked with Square before anything is written. */
export const SQUARE_PAYMENT_EVENTS: readonly string[] = ["payment.created", "payment.updated"];

/** `done`: taken in, or nothing to take in; `unknown`: Square could not be asked, so try again. */
export type TakeIn = "done" | "unknown";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The token of a gym connected to the account, while it opens. */
function tokenOf(square: SquareSettings, row: repo.ConnectionRow): string | null {
  return row.state !== "connected" || row.accessToken === null ? null : square.tokens.open(row.accessToken, accessContext(row.gymId));
}

/** Square's message about a payment of this account: asked of Square with any gym's token here. */
export async function takeInSquarePayment(deps: PaymentsDeps, square: SquareSettings, accountId: string, paymentId: string): Promise<TakeIn> {
  const rows = await repo.connectionsOfAccount(deps.sql, square.environment, accountId);
  const token = rows.map((row) => tokenOf(square, row)).find((t) => t !== null) ?? null;
  if (token === null) return "done";
  const read = await square.api.getPayment(token, paymentId);
  if (read.kind === "unavailable") return "unknown";
  if (read.kind === "refused") {
    deps.log.warn({ event: "square.app_payment_unread", status: read.status, code: read.code }, "Square refused to show a payment it sent a message about");
    return "done";
  }
  return await takeIn(deps, square, accountId, rows, read.value);
}

/** What Square says was sold with the payment; null for no answer, so it is asked again. */
async function linesOf(square: SquareSettings, row: repo.ConnectionRow, payment: SquarePayment): Promise<SquareAppLines | null> {
  const token = tokenOf(square, row);
  if (payment.order_id == null || token === null || !readsOrders(row)) return "unread";
  const order = await square.api.retrieveOrder(token, payment.order_id);
  if (order.kind === "unavailable") return null;
  if (order.kind === "refused") return "unread";
  return squareAppLinesOf((order.value.line_items ?? []).map((line) => line.item_type));
}

/** One payment of the account, as Square showed it: taken in once, or passed over. */
export async function takeIn(deps: PaymentsDeps, square: SquareSettings, accountId: string, rows: readonly repo.ConnectionRow[], payment: SquarePayment): Promise<TakeIn> {
  const environment = square.environment;
  const now = deps.now();
  // APPROVED or PENDING: Square's next message says when it is taken; FAILED and CANCELED never will be.
  if (payment.status !== "COMPLETED") return "done";
  const location = payment.location_id ?? null;
  const madeAt = payment.created_at == null ? now : new Date(payment.created_at);
  if (location === null || madeAt.getTime() < now.getTime() - SQUARE_APP.keepDays * DAY_MS) return "done";
  if (await taken.known(deps.sql, environment, accountId, payment.id)) return "done";
  if (await taken.isOurs(deps.sql, environment, accountId, payment)) return "done";

  const connected = rows.filter((row) => row.state === "connected" && row.locationId !== null);
  const here = connected.filter((row) => row.locationId === location);
  const customer = payment.customer_id ?? null;
  const linked =
    customer === null ? [] : await taken.linkedRecords(deps.sql, { environment, accountId, customerId: customer, gymIds: connected.map((row) => row.gymId) });
  const linkedGyms = [...new Set(linked.map((l) => l.gymId))];
  // Whose payment: the gym whose record the customer is; else the one gym at that location.
  const linkedHere = linkedGyms.filter((g) => here.some((row) => row.gymId === g));
  const owner =
    linkedHere.length === 1
      ? here.find((row) => row.gymId === linkedHere[0])
      : linkedGyms.length === 1 && linkedHere.length === 0
        ? connected.find((row) => row.gymId === linkedGyms[0])
        : linkedGyms.length === 0 && here.length === 1
          ? here[0]
          : undefined;
  // At no location of a gym here (the business's café elsewhere, say): not this app's to keep.
  if (owner === undefined && here.length === 0 && linkedGyms.length === 0) return "done";

  const facts: taken.TakenPayment = {
    environment,
    accountId,
    squarePaymentId: payment.id,
    gymId: owner?.gymId ?? null,
    locationId: location,
    customerId: customer,
    amountMinor: payment.amount_money.amount,
    tipMinor: payment.tip_money?.amount ?? 0,
    currency: payment.amount_money.currency,
    source: payment.source_type ?? null,
    brand: payment.card_details?.card?.card_brand ?? null,
    last4: payment.card_details?.card?.last_4 ?? null,
    takenAt: madeAt,
    entryId: null,
  };

  if (owner === undefined || owner.locationId === null) {
    // Two gyms here at that location, and no customer to say whose: kept for neither to record.
    const watched = await Promise.all(
      here.map((row) => taken.watchingSince(deps.sql, { gymId: row.gymId, environment, accountId, locationId: location, now })),
    );
    if (watched.some((since) => madeAt < since)) return "done";
    await deps.sql.begin(async (tx) => {
      await taken.insertTaken(tx, facts, { state: "waiting", reason: "several_gyms" }, now);
    });
    return "done";
  }
  const since = await taken.watchingSince(deps.sql, { gymId: owner.gymId, environment, accountId, locationId: owner.locationId, now });
  if (madeAt < since) return "done";

  // Taken at another location of the account than the gym's own: kept for staff, as it is.
  const atHome = owner.locationId === location;
  const lines = atHome ? await linesOf(square, owner, payment) : "unread";
  if (lines === null) return "unknown";
  const gym = await repo.readGym(deps.sql, owner.gymId);
  if (gym === null) return "done";
  const today = dayInTz(now, gym.timezone);
  const mine = linked.filter((l) => l.gymId === owner.gymId);
  const who: SquareAppCustomer = customer === null ? "none" : mine.length === 0 ? "unknown" : mine.length === 1 ? "one" : "several";
  const entryId = who === "one" ? (mine[0]?.entryId ?? null) : null;

  await deps.sql.begin(async (tx) => {
    // The gym's lock first, as every payment by hand takes it: two messages about one payment, or a
    // message and the hourly look, decide one after the other, and the second finds the first's row.
    await lockGym(tx, owner.gymId);
    if (await taken.known(tx, environment, accountId, payment.id)) return;
    const kept = { ...facts, entryId };
    if (!atHome) {
      await taken.insertTaken(tx, kept, { state: "waiting", reason: "other_location" }, now);
      return;
    }
    const candidates = entryId === null ? [] : await taken.candidatesFor(tx, owner.gymId, entryId, today, now);
    const decision = squareAppDecision({ lines, customer: who, amountMinor: payment.amount_money.amount, today, candidates });
    if (decision.kind === "shop_sale") {
      await taken.insertTaken(tx, kept, { state: "shop_sale" }, now);
      return;
    }
    if (decision.kind === "wait") {
      await taken.insertTaken(tx, kept, { state: "waiting", reason: decision.reason }, now);
      return;
    }
    const { candidate } = decision;
    const recordKey = randomUUID();
    const paying = {
      gymId: owner.gymId,
      entryId: candidate.entryId,
      membershipId: candidate.target.membershipId,
      requestKey: recordKey,
      amountMinor: payment.amount_money.amount,
      method: "square_app" as const,
      provider: { name: "square", paymentId: payment.id },
      today,
      actorUserId: null,
      now,
    };
    const done =
      candidate.target.kind === "fee"
        ? await recordFeePaymentIn(tx, { ...paying, billId: candidate.target.billId })
        : await recordPaymentIn(tx, { ...paying, periodIndex: candidate.target.periodIndex });
    if (done.kind === "recorded") {
      await taken.insertTaken(tx, { ...kept, entryId: candidate.entryId }, { state: "recorded", memberPaymentId: done.paymentId, recordKey }, now);
      return;
    }
    // The rule read these bills under this same lock, so a refusal here is a fault of ours: kept for
    // staff, and said in the log.
    deps.log.error({ event: "square.app_payment_refused", gymId: owner.gymId, why: done.kind }, "a payment taken in Square's app could not be recorded on the bill it fitted");
    await taken.insertTaken(tx, kept, { state: "waiting", reason: "no_bill" }, now);
  });
  return "done";
}

// ── The hourly look ──────────────────────────────────────────────────────────

export interface SweepRun {
  looked: number;
  payments: number;
  /** Square could not be asked: looked at again soon. */
  unanswered: number;
}

/** Each gym's look that is due: its Square payments since the last, at its location, oldest first. */
export async function sweepSquarePayments(deps: PaymentsDeps, square: SquareSettings, gymIds: readonly string[] | null): Promise<SweepRun> {
  const run: SweepRun = { looked: 0, payments: 0, unanswered: 0 };
  const environment = square.environment;
  await taken.watchConnected(deps.sql, environment, deps.now(), gymIds);
  for (const sweep of await taken.claimDueSweeps(deps.sql, environment, deps.now(), gymIds)) {
    run.looked += 1;
    const now = deps.now();
    const row = await repo.readConnection(deps.sql, sweep.gymId, environment);
    const token = row === null ? null : tokenOf(square, row);
    if (row === null || token === null || row.accountId !== sweep.accountId || row.locationId !== sweep.locationId) {
      // Gone, or moved to another account or location: a new look starts with the connection's.
      await taken.finishSweep(deps.sql, sweep, sweep.sweptUntil, new Date(now.getTime() + taken.SWEEP.everyMs));
      continue;
    }
    const rows = await repo.connectionsOfAccount(deps.sql, environment, sweep.accountId);
    const from = new Date(Math.max(sweep.watchingSince.getTime(), sweep.sweptUntil.getTime() - taken.SWEEP.overlapMs));
    const until = new Date(now.getTime() - taken.SWEEP.settleMs);
    let cursor: string | null = null;
    let reached = from;
    let finished = false;
    let stopped = false;
    for (let page = 0; page < taken.SWEEP.pagesPerLook && !stopped; page++) {
      const listed = await square.api.listPayments(token, { locationId: sweep.locationId, beginTime: from, endTime: until, cursor });
      if (listed.kind !== "ok") {
        stopped = true;
        run.unanswered += listed.kind === "unavailable" ? 1 : 0;
        if (listed.kind === "refused") deps.log.warn({ event: "square.app_payments_unlisted", gymId: sweep.gymId, status: listed.status, code: listed.code }, "Square refused to list a gym's payments");
        break;
      }
      if (listed.value.unread > 0) deps.log.warn({ event: "square.app_payments_unread", gymId: sweep.gymId, count: listed.value.unread }, "payments Square listed could not be read");
      for (const payment of listed.value.payments) {
        run.payments += 1;
        if ((await takeIn(deps, square, sweep.accountId, rows, payment)) === "unknown") {
          stopped = true;
          run.unanswered += 1;
          break;
        }
        if (payment.created_at != null) reached = new Date(Math.max(reached.getTime(), new Date(payment.created_at).getTime()));
      }
      cursor = listed.value.cursor;
      if (cursor === null && !stopped) finished = true;
      if (cursor === null) break;
    }
    // Done up to the end of the look, or, stopped part-way, up to the last payment taken in: the
    // next look starts there, a little before, and finds nothing twice.
    await taken.finishSweep(deps.sql, sweep, finished ? until : reached, new Date(now.getTime() + (finished ? taken.SWEEP.everyMs : taken.SWEEP.againMs)));
  }
  return run;
}
