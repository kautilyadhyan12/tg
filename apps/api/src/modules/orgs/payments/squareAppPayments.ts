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
import {
  GYM_PAYMENTS_WORDS,
  SQUARE_APP,
  SQUARE_APP_EXAMPLE_MINOR,
  chargedWithTaxes,
  squareAppCheckResponseSchema,
  squareAppDecision,
  squareAppLinesOf,
  squareOrderAddsOnTop,
  taxesOnTypedAmounts,
  type SquareAppCheck,
  type SquareAppCheckResponse,
  type SquareAppCustomer,
  type SquareAppLines,
  type SquarePayment,
  type SquareTaxFacts,
} from "@app/shared";
import type { TransactionSql } from "postgres";
import { dayInTz } from "../../gamification/streak.js";
import { lockGym } from "../memberList/repo.js";
import { recordPaymentIn } from "../memberships/billsRepo.js";
import { recordFeePaymentIn } from "../memberships/feesRepo.js";
import * as repo from "./repo.js";
import { OrgsError, requireStaff } from "../service.js";
import { accessContext, readsItems, readsOrders, type PaymentsDeps } from "./service.js";
import type { SquareSettings } from "./settings.js";
import * as taken from "./squareAppPaymentsRepo.js";

/** Square's messages about a payment. Each is checked with Square before anything is written. */
export const SQUARE_PAYMENT_EVENTS: readonly string[] = ["payment.created", "payment.updated"];

/** `done`: taken in, or nothing to take in; `unknown`: Square could not be asked, so try again. */
export type TakeIn = "done" | "unknown";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A payment whose order Square has not shown for this long after it was made is kept as one whose
 *  sale could not be read, so one payment never holds up the gym's hourly look for good. */
export const ORDER_PATIENCE_MS = 60 * 60_000;

/** The payment was taken in at the same moment under another gym's lock: this one's write is undone. */
class TakenTwice extends Error {}

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

/** What Square says was sold with the payment, and whether it added tax or a charge on top of what staff
 *  typed; null for no answer, so it is asked again. */
async function saleOf(square: SquareSettings, row: repo.ConnectionRow, payment: SquarePayment): Promise<{ lines: SquareAppLines; addedOnTop: boolean } | null> {
  const unread = { lines: "unread" as const, addedOnTop: false };
  const token = tokenOf(square, row);
  if (payment.order_id == null || token === null || !readsOrders(row)) return unread;
  const order = await square.api.retrieveOrder(token, payment.order_id);
  if (order.kind === "unavailable") return null;
  if (order.kind === "refused") return unread;
  return { lines: squareAppLinesOf((order.value.line_items ?? []).map((line) => line.item_type)), addedOnTop: squareOrderAddsOnTop(order.value) };
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
  const asked = atHome ? await saleOf(square, owner, payment) : { lines: "unread" as const, addedOnTop: false };
  if (asked === null && madeAt.getTime() > now.getTime() - ORDER_PATIENCE_MS) return "unknown";
  const sale = asked ?? { lines: "unread" as const, addedOnTop: false };
  const gym = await repo.readGym(deps.sql, owner.gymId);
  if (gym === null) return "done";
  const today = dayInTz(now, gym.timezone);
  const mine = linked.filter((l) => l.gymId === owner.gymId);
  const who: SquareAppCustomer = customer === null ? "none" : mine.length === 0 ? "unknown" : mine.length === 1 ? "one" : "several";
  const entryId = who === "one" ? (mine[0]?.entryId ?? null) : null;

  try {
    await deps.sql.begin(async (tx) => {
      await decideAndKeep(deps, tx, { payment, owner, facts, entryId, atHome, sale, who, today, now });
    });
  } catch (e) {
    // Another look took it in at the same moment for another gym: theirs stands, this one is undone.
    if (e instanceof TakenTwice) return "done";
    throw e;
  }
  return "done";
}

/** Under the gym's lock: kept waiting, a shop sale, or recorded on the one bill it fits. */
async function decideAndKeep(
  deps: PaymentsDeps,
  tx: TransactionSql,
  d: {
    payment: SquarePayment;
    owner: repo.ConnectionRow;
    facts: taken.TakenPayment;
    entryId: string | null;
    atHome: boolean;
    sale: { lines: SquareAppLines; addedOnTop: boolean };
    who: SquareAppCustomer;
    today: string;
    now: Date;
  },
): Promise<void> {
  const { payment, owner, facts, entryId, atHome, sale, who, today, now } = d;
  const { environment, accountId } = facts;
  // The gym's lock first, as every payment by hand takes it: two messages about one payment, or a
  // message and the hourly look, decide one after the other, and the second finds the first's row.
  await lockGym(tx, owner.gymId);
  if (await taken.known(tx, environment, accountId, payment.id)) return;
  const kept = { ...facts, entryId };
  // Money Square has given back on it, in part or in whole: never on a bill (refunds are 18d-iv's).
  if ((payment.refunded_money?.amount ?? 0) > 0) {
    await taken.insertTaken(tx, kept, { state: "waiting", reason: "refunded" }, now);
    return;
  }
  if (!atHome) {
    await taken.insertTaken(tx, kept, { state: "waiting", reason: "other_location" }, now);
    return;
  }
  // Another money than the gym's own: no bill of the gym's is that amount.
  const sameMoney = payment.amount_money.currency === owner.currency;
  const candidates = entryId === null || !sameMoney ? [] : await taken.candidatesFor(tx, owner.gymId, entryId, today, now);
  const decision = squareAppDecision({ ...sale, customer: who, amountMinor: payment.amount_money.amount, today, candidates });
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
    // Unique on Square's own id: kept already by a look that chose another gym, under that gym's lock.
    if (!(await taken.insertTaken(tx, { ...kept, entryId: candidate.entryId }, { state: "recorded", memberPaymentId: done.paymentId, recordKey }, now))) {
      throw new TakenTwice();
    }
    return;
  }
  // The rule read these bills under this same lock, so a refusal here is a fault of ours: kept for
  // staff, and said in the log.
  deps.log.error({ event: "square.app_payment_refused", gymId: owner.gymId, why: done.kind }, "a payment taken in Square's app could not be recorded on the bill it fitted");
  await taken.insertTaken(tx, kept, { state: "waiting", reason: "no_bill" }, now);
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
    let refused = false;
    for (let page = 0; page < taken.SWEEP.pagesPerLook && !stopped; page++) {
      const listed = await square.api.listPayments(token, { locationId: sweep.locationId, beginTime: from, endTime: until, cursor });
      if (listed.kind !== "ok") {
        stopped = true;
        run.unanswered += listed.kind === "unavailable" ? 1 : 0;
        refused = listed.kind === "refused";
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
    // next look starts there, a little before, and finds nothing twice. Soon where Square gave no
    // answer; in an hour where it refused (a permission taken away is not given back in a minute).
    const next = finished || refused ? taken.SWEEP.everyMs : taken.SWEEP.againMs;
    await taken.finishSweep(deps.sql, sweep, finished ? until : reached, new Date(now.getTime() + next));
  }
  return run;
}

// ── The tax check ────────────────────────────────────────────────────────────

/** Pages of the item library's taxes read for the check: 100 taxes a page is Square's own. */
const TAX_PAGES = 5;

/** Settings → Payments: whether Square adds tax on top of an amount staff type in at the gym's location,
 *  read from the gym's own item library (never changed), for anybody on the gym's staff. */
export async function squareAppCheck(deps: PaymentsDeps, userId: string, gymId: string): Promise<SquareAppCheckResponse> {
  const { privileges } = await requireStaff(deps, gymId, userId);
  const square = deps.square;
  const row = square === null ? null : await repo.readConnection(deps.sql, gymId, square.environment);
  if (square === null || row?.state !== "connected" || row.locationId === null) throw new OrgsError(409, "square_not_connected", GYM_PAYMENTS_WORDS.not_connected);
  const [taxed] = await deps.sql<{ any: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM gym_membership_types WHERE gym_id = ${gymId} AND archived_at IS NULL AND tax_rate_id IS NOT NULL) AS any`;
  const answer = (taxes: SquareAppCheck["taxes"]): SquareAppCheckResponse =>
    squareAppCheckResponseSchema.parse({
      check: { taxes, currency: row.currency, membershipTax: taxed?.any === true, canSetTax: privileges.includes("memberships.manage") },
    });
  const token = tokenOf(square, row);
  if (token === null || !readsItems(row)) return answer({ state: "needs_allow" });
  const facts: SquareTaxFacts[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < TAX_PAGES; page++) {
    const listed = await square.api.listTaxes(token, cursor);
    if (listed.kind !== "ok") return answer({ state: "unknown" });
    // A tax that could not be read may be one that adds itself: no answer, never "none".
    if (listed.value.unread > 0) return answer({ state: "unknown" });
    for (const t of listed.value.taxes) {
      facts.push({
        name: t.tax_data?.name ?? null,
        percentage: t.tax_data?.percentage ?? null,
        inclusionType: t.tax_data?.inclusion_type ?? null,
        appliesToCustomAmounts: t.tax_data?.applies_to_custom_amounts ?? null,
        enabled: t.tax_data?.enabled ?? null,
        deleted: t.is_deleted ?? null,
        atAllLocations: t.present_at_all_locations ?? null,
        presentAt: t.present_at_location_ids ?? [],
        absentAt: t.absent_at_location_ids ?? [],
      });
    }
    cursor = listed.value.cursor;
    if (cursor === null) break;
  }
  if (cursor !== null) return answer({ state: "unknown" });
  const adds = taxesOnTypedAmounts(facts, row.locationId);
  if (adds.length === 0) return answer({ state: "none" });
  return answer({
    state: "adds",
    taxes: adds.slice(0, 50),
    exampleMinor: SQUARE_APP_EXAMPLE_MINOR,
    chargedMinor: chargedWithTaxes(SQUARE_APP_EXAMPLE_MINOR, adds.map((t) => t.percentage)),
  });
}
