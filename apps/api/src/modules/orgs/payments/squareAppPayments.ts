// A PAYMENT TAKEN IN SQUARE'S OWN APP, KEPT FOR STAFF TO MATCH (ROADMAP 18d-iii-b-i, 18d-iii-b-ii-a; spec
// Part 3 §14.8; rulings/2026-10-25-18d-iii-b-i.md, rulings/2026-10-25-18d-iii-b-ii-a.md; the rule is
// `squareAppDecision` in @app/shared).
//
// Staff take a payment on a Square Reader in Square's own app, pick the person there and type the
// bill's total. Square's message about it (`payment.created`, `payment.updated`) is a doorbell: the
// worker asks Square for the payment itself, and for its order, which says what was sold. Every hour it
// also asks Square for the gym's payments since its last look, so a payment whose messages never came
// (our server down longer than Square sends them again) is still taken in.
//
// THE WORST THING here is a member charged twice, or money put on the wrong person's bill. So a payment is
// taken in once (unique on Square's own id, under the gym's lock), the app's own Terminal and card on file
// payments never; it goes to the gym whose Square customer it names, at that gym's own location; and none
// goes on a bill by itself (Kd, 2026-10-25, "one press"): each waits for staff, holding the card on file
// of the person Square's customer is, and Payments to match ticks the one bill it fits. A payment Square
// made before the gym was watched, or more than `SQUARE_APP.keepDays` ago, is never taken in. Pages open on
// the gym are told at once (live news), so the payment is on the person's page while they are at the desk.
import {
  GYM_PAYMENTS_WORDS,
  SQUARE_APP,
  SQUARE_APP_EXAMPLE_MINOR,
  chargedWithTaxes,
  squareAppCheckResponseSchema,
  squareAppDecision,
  squareAppEnteredMinor,
  squareAppLinesOf,
  squareAppPaidInParts,
  squareOrderAddsOnTop,
  taxesOnTypedAmounts,
  type SquareAppCheck,
  type SquareAppCheckResponse,
  type SquareAppCustomer,
  type SquareAppLines,
  type SquareCustomer,
  type SquarePayment,
  type SquareTaxFacts,
} from "@app/shared";
import type { TransactionSql } from "postgres";
import { dayInTz } from "../../gamification/streak.js";
import { lockEntries, lockGym } from "../memberList/repo.js";
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

/** A payment whose order Square has not shown for this long since the app first asked about it is kept
 *  as one whose sale could not be read, so one payment never holds up the gym's hourly look for good. */
export const ORDER_PATIENCE_MS = 60 * 60_000;

/** The token of a gym connected to the account, while it opens. */
function tokenOf(square: SquareSettings, row: repo.ConnectionRow): string | null {
  return row.state !== "connected" || row.accessToken === null ? null : square.tokens.open(row.accessToken, accessContext(row.gymId));
}

/** Square's message about a payment of this account: asked of Square with any gym's token here.
 *  `firstAskedAt`: when the message came, from which the patience with its order counts. */
export async function takeInSquarePayment(
  deps: PaymentsDeps,
  square: SquareSettings,
  accountId: string,
  paymentId: string,
  firstAskedAt: Date | null = null,
): Promise<TakeIn> {
  // A message about a payment is never the minute a card is charged: Square's order is waited for.
  const rows = await repo.connectionsOfAccount(deps.sql, square.environment, accountId);
  const token = rows.map((row) => tokenOf(square, row)).find((t) => t !== null) ?? null;
  if (token === null) return "done";
  const read = await square.api.getPayment(token, paymentId);
  if (read.kind === "unavailable") return "unknown";
  if (read.kind === "refused") {
    deps.log.warn({ event: "square.app_payment_unread", status: read.status, code: read.code }, "Square refused to show a payment it sent a message about");
    return "done";
  }
  return await takeIn(deps, square, accountId, rows, read.value, firstAskedAt);
}

/** What Square says was sold with the payment, whether it added tax or a charge on top of what staff
 *  typed, and the part staff entered (18d-iii-b-ii-a); null for no answer, so it is asked again. */
async function saleOf(square: SquareSettings, row: repo.ConnectionRow, payment: SquarePayment): Promise<Sale | null> {
  const token = tokenOf(square, row);
  if (payment.order_id == null || token === null || !readsOrders(row)) return UNREAD;
  const order = await square.api.retrieveOrder(token, payment.order_id);
  if (order.kind === "unavailable") return null;
  if (order.kind === "refused") return UNREAD;
  return {
    lines: squareAppLinesOf((order.value.line_items ?? []).map((line) => line.item_type)),
    addedOnTop: squareOrderAddsOnTop(order.value),
    enteredMinor: squareAppEnteredMinor(order.value, { id: payment.id, amountMinor: payment.amount_money.amount }),
    paidInParts: squareAppPaidInParts(order.value, payment.id),
  };
}

interface Sale {
  lines: SquareAppLines;
  addedOnTop: boolean;
  enteredMinor: number | null;
  paidInParts: boolean;
}

const UNREAD: Sale = { lines: "unread", addedOnTop: false, enteredMinor: null, paidInParts: false };

/** Square's details of a customer linked to nobody here, shown beside the payment so staff can tell who it
 *  is (18d-iii-b-ii-a). Nothing where Square can't be asked now: the payment is kept all the same. */
async function customerOf(square: SquareSettings, row: repo.ConnectionRow, customerId: string): Promise<taken.CustomerSeen | null> {
  const token = tokenOf(square, row);
  if (token === null) return null;
  const read = await square.api.retrieveCustomer(token, customerId);
  return read.kind === "ok" ? customerSeen(read.value) : null;
}

const clip = (text: string | null | undefined, max: number): string | null => {
  const trimmed = (text ?? "").replace(/\s+/g, " ").trim();
  return trimmed === "" ? null : trimmed.slice(0, max);
};

/** A person's name as Square has it: their own, else the company's, else a nickname. */
export function customerSeen(c: SquareCustomer): taken.CustomerSeen | null {
  const name = clip([c.given_name, c.family_name].filter((part) => clip(part, 200) !== null).join(" "), 200) ?? clip(c.company_name, 200) ?? clip(c.nickname, 200);
  const seen = { name, email: clip(c.email_address, 320), phone: clip(c.phone_number, 40) };
  return seen.name === null && seen.email === null && seen.phone === null ? null : seen;
}

/** One payment of the account, as Square showed it: taken in once, or passed over. `firstAskedAt`: when
 *  the app first asked about it, where it has before (null: now). `urgent`: the look right before the gym's
 *  cards are charged, which keeps a payment of somebody on the list waiting at once even where Square does
 *  not show its order now, so their card waits with it (round one, High 4). */
export async function takeIn(
  deps: PaymentsDeps,
  square: SquareSettings,
  accountId: string,
  rows: readonly repo.ConnectionRow[],
  payment: SquarePayment,
  firstAskedAt: Date | null = null,
  urgent = false,
): Promise<TakeIn> {
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
    enteredMinor: null,
    refundedMinor: Math.max(0, payment.refunded_money?.amount ?? 0),
    customer: null,
    deviceName: clip(payment.device_details?.device_name, 100),
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

  const mine = linked.filter((l) => l.gymId === owner.gymId);
  const who: SquareAppCustomer = customer === null ? "none" : mine.length === 0 ? "unknown" : mine.length === 1 ? "one" : "several";
  const entryId = who === "one" ? (mine[0]?.entryId ?? null) : null;
  // Taken at another location of the account than the gym's own: kept for staff, as it is.
  const atHome = owner.locationId === location;
  const asked = atHome ? await saleOf(square, owner, payment) : UNREAD;
  // Square gave no answer about what was sold: asked again soon, for up to an hour; but right before the
  // gym's cards are charged, a payment of somebody on the list waits now, as a sale that could not be read.
  if (asked === null && !(urgent && entryId !== null) && (firstAskedAt ?? now).getTime() > now.getTime() - ORDER_PATIENCE_MS) return "unknown";
  const sale = asked ?? UNREAD;
  const gym = await repo.readGym(deps.sql, owner.gymId);
  if (gym === null) return "done";
  const today = dayInTz(now, gym.timezone);
  // A customer linked to nobody here: what Square has of them, for staff to tell who it is (never kept on a
  // shop sale, which no screen shows: `decideAndKeep`).
  const customerSeenNow = customer !== null && who === "unknown" && sale.lines !== "items" ? await customerOf(square, owner, customer) : null;
  const kept = { ...facts, enteredMinor: sale.enteredMinor, customer: customerSeenNow };

  const waits = await deps.sql.begin(async (tx) => await decideAndKeep(tx, { payment, owner, facts: kept, entryId, atHome, sale, who, today, now }));
  if (waits) await tellTaken(deps, owner.gymId, entryId);
  return "done";
}

/** A payment now waits: Payments to match, Overview and the menu read again, and the page of the person it
 *  holds the card of, and of everybody they pay for (whose page shows it too). */
async function tellTaken(deps: PaymentsDeps, gymId: string, entryId: string | null): Promise<void> {
  const news = deps.news;
  if (news === undefined) return;
  news.tell(gymId, { what: "paymentsToMatch" });
  if (entryId === null) return;
  const paidFor = await deps.sql<{ entry_id: string }[]>`SELECT entry_id FROM gym_member_payers WHERE gym_id = ${gymId} AND payer_entry_id = ${entryId}`;
  for (const id of [entryId, ...paidFor.map((r) => r.entry_id)]) news.tell(gymId, { what: "memberships", entryId: id });
}

/** Under the gym's lock, and the record's of the person Square's customer is and of everybody they pay for
 *  (the lock a card charge takes): kept waiting for staff, or a shop sale. True where it was kept waiting now. */
async function decideAndKeep(
  tx: TransactionSql,
  d: {
    payment: SquarePayment;
    owner: repo.ConnectionRow;
    facts: taken.TakenPayment;
    entryId: string | null;
    atHome: boolean;
    sale: Sale;
    who: SquareAppCustomer;
    today: string;
    now: Date;
  },
): Promise<boolean> {
  const { payment, owner, facts, entryId, atHome, sale, who, today, now } = d;
  const { environment, accountId } = facts;
  // The gym's lock first, as every payment by hand takes it: two messages about one payment, or a
  // message and the hourly look, decide one after the other, and the second finds the first's row.
  await lockGym(tx, owner.gymId);
  if (entryId !== null) {
    const paidFor = await tx<{ entry_id: string }[]>`SELECT entry_id FROM gym_member_payers WHERE gym_id = ${owner.gymId} AND payer_entry_id = ${entryId}`;
    await lockEntries(tx, owner.gymId, [entryId, ...paidFor.map((r) => r.entry_id)]);
  }
  if (await taken.known(tx, environment, accountId, payment.id)) return false;
  const kept = { ...facts, entryId };
  // Money Square has given back on it, in part or in whole: never on a bill (refunds are 18d-iv's).
  if ((payment.refunded_money?.amount ?? 0) > 0) return await taken.insertTaken(tx, kept, { state: "waiting", reason: "refunded" }, now);
  if (!atHome) return await taken.insertTaken(tx, kept, { state: "waiting", reason: "other_location" }, now);
  // Another money than the gym's own: no bill of the gym's is that amount.
  const sameMoney = payment.amount_money.currency === owner.currency;
  const candidates = entryId === null || !sameMoney ? [] : await taken.candidatesFor(tx, owner.gymId, entryId, today, now);
  const decision = squareAppDecision({
    lines: sale.lines,
    addedOnTop: sale.addedOnTop,
    enteredMinor: sale.enteredMinor,
    paidInParts: sale.paidInParts,
    customer: who,
    amountMinor: payment.amount_money.amount,
    today,
    candidates,
  });
  if (decision.kind === "shop_sale") {
    // Nobody's details are kept on a shop sale: no screen shows it, and it is no bill's.
    await taken.insertTaken(tx, { ...kept, customer: null }, { state: "shop_sale" }, now);
    return false;
  }
  // Unique on Square's own id: false where a look that chose another gym kept it first, and theirs stands.
  return await taken.insertTaken(tx, kept, { state: "waiting", reason: decision.reason }, now);
}

// ── The hourly look ──────────────────────────────────────────────────────────

export interface SweepRun {
  looked: number;
  payments: number;
  /** Square could not be asked: looked at again soon. */
  unanswered: number;
}

/** Each gym's look that is due: its Square payments since the last, at its location, oldest first.
 *  `urgent`: the look right before the gym's cards are charged (`takeIn`). */
export async function sweepSquarePayments(deps: PaymentsDeps, square: SquareSettings, gymIds: readonly string[] | null, urgent = false): Promise<SweepRun> {
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
    // The payment this look stopped at, and since when it has been asked about; kept while the list
    // itself gives no answer, so the hour goes on counting.
    let stuck: taken.SweepStuck | null = null;
    for (let page = 0; page < taken.SWEEP.pagesPerLook && !stopped; page++) {
      const listed = await square.api.listPayments(token, { locationId: sweep.locationId, beginTime: from, endTime: until, cursor });
      if (listed.kind !== "ok") {
        stopped = true;
        run.unanswered += listed.kind === "unavailable" ? 1 : 0;
        refused = listed.kind === "refused";
        stuck = sweep.stuck;
        if (listed.kind === "refused") deps.log.warn({ event: "square.app_payments_unlisted", gymId: sweep.gymId, status: listed.status, code: listed.code }, "Square refused to list a gym's payments");
        break;
      }
      if (listed.value.unread > 0) deps.log.warn({ event: "square.app_payments_unread", gymId: sweep.gymId, count: listed.value.unread }, "payments Square listed could not be read");
      for (const payment of listed.value.payments) {
        run.payments += 1;
        const askedSince = sweep.stuck?.paymentId === payment.id ? sweep.stuck.since : null;
        if ((await takeIn(deps, square, sweep.accountId, rows, payment, askedSince, urgent)) === "unknown") {
          stopped = true;
          run.unanswered += 1;
          stuck = { paymentId: payment.id, since: askedSince ?? now };
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
    await taken.finishSweep(deps.sql, sweep, finished ? until : reached, new Date(now.getTime() + next), stuck);
  }
  return run;
}

/** A gym's Square payments, looked at right before its cards on file are charged, are looked at again
 *  only once the last look is this old (`lookNowIfOlder`). */
export const LOOK_BEFORE_CHARGING_MS = 5 * 60_000;

/** Right before a gym's cards on file are charged: its Square payments since the last look, now, so a
 *  payment taken at the desk whose message from Square is late (or lost) is kept waiting first and holds
 *  that member's card. Fewer charged twice, not none: Square's list can be a minute behind, and a payment
 *  with nobody picked holds no card. Null where the gym was looked at less than five minutes ago. */
export async function lookBeforeCharging(deps: PaymentsDeps, square: SquareSettings, gymId: string): Promise<SweepRun | null> {
  if (!(await taken.lookNowIfOlder(deps.sql, square.environment, gymId, deps.now(), LOOK_BEFORE_CHARGING_MS))) return null;
  return await sweepSquarePayments(deps, square, [gymId], true);
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
