// PAY WHAT THEY OWE, IN THE APP (ROADMAP Stage 2 item 18k-ii-a; Kd, 2026-11-06; spec Part 3 §14.8).
//
// A member presses Pay on the phone for the one bill of a membership a payment can be taken for now, theirs or of somebody
// they pay for (18i). The server makes Square's own payment page (CreatePaymentLink) for all that is left on that bill, at
// the gym's location, with no tip, coupon or reward, and gives the phone its address. The member pays there by card,
// Apple Pay or Google Pay. The phone asks how it went when the member comes back; the worker asks each minute for a page
// nobody is asking about. Pages not paid are closed at Square (DeletePaymentLink: its order is then CANCELED and the page
// can no longer be paid, even one open on the member's screen, measured 2026-11-06) when the member leaves, staff press
// Close payment page, or `APP_PAYMENT_LIMITS.openMinutes` pass.
//
// THE WORST THING here is a member charged twice for one bill, or charged and still shown as owing, so they pay again or
// the card on file is charged as well. So: a page is made only for the bill a payment by hand could take now, for all that
// is left of it; while it is open nothing else pays, voids or changes that membership (`squareMoneyOut`), and the card on
// file is not charged for it; it is closed only once Square says its order is CANCELED, and a page Square says was paid
// meanwhile is recorded instead; money is recorded only once Square says the order's one payment is COMPLETED, at the
// gym's location, for exactly the amount asked with no tip, and it is recorded once (the page is the payment's key, and
// Square's payment id is kept once). Money Square took that the bill can no longer take is kept, never dropped.
import { randomUUID } from "node:crypto";
import {
  APP_PAYMENT_LIMITS,
  APP_PAYMENT_STAFF_WORDS,
  APP_PAYMENT_WORDS,
  appPaymentCloseResponseSchema,
  appPaymentResponseSchema,
  myAppPaymentsResponseSchema,
  type AppPayment,
  type AppPaymentCloseResponse,
  type AppPaymentRequest,
  type AppPaymentResponse,
  type MyAppPaymentsResponse,
  type SquareOrder,
  type SquarePayment,
} from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";
import { readerOf } from "../myMembership/repo.js";
import { paidForBy, payerOf } from "../payers/repo.js";
import { gymHasLivePlan } from "../repo.js";
import { OrgsError, requirePrivilege } from "../service.js";
import { BILLING, orgNotFound, stateOf } from "./cards.js";
import * as pays from "./appPaymentsRepo.js";
import * as repo from "./repo.js";
import { accessContext, appPaymentsAllowed, type PaymentsDeps } from "./service.js";
import type { SquareSettings } from "./settings.js";

export const APP_PAYMENT = {
  openMs: APP_PAYMENT_LIMITS.openMinutes * 60_000,
  /** One request asks Square about a page at a time, for at most this long: a look makes up to four calls of
   *  `SQUARE_TIMEOUT_MS` each, and more where an order names several payments. */
  leaseMs: 60_000,
  /** Close waits this long for a request already asking Square, then leaves its mark for it. */
  closeWaitMs: 2_000,
  /** Nobody has asked for this long: the worker asks. */
  idleMs: 20_000,
  /** Square giving no answer at all for a day: given up, and logged. */
  giveUpMs: 24 * 60 * 60_000,
  /** A closed one is kept this long, for the phone that asks how it ended. */
  keepMs: 24 * 60 * 60_000,
  perRun: 50,
  /** What the gym's Square Dashboard lists the payment as: no name of the person goes to Square. */
  note: "Membership payment",
} as const;

const notFound = (): OrgsError => new OrgsError(404, "app_payment_not_found", APP_PAYMENT_WORDS.not_found);
const notOffered = (): OrgsError => new OrgsError(409, "app_payment_not_offered", APP_PAYMENT_WORDS.not_offered);
const changed = (): OrgsError => new OrgsError(409, "app_payment_changed", APP_PAYMENT_WORDS.changed);
const notDue = (): OrgsError => new OrgsError(409, "app_payment_not_due", APP_PAYMENT_WORDS.not_due);
const atDesk = (): OrgsError => new OrgsError(409, "app_payment_at_desk", APP_PAYMENT_WORDS.at_desk);
const squareDown = (): OrgsError => new OrgsError(503, "square_unavailable", APP_PAYMENT_WORDS.square_down);
const squareRefused = (): OrgsError => new OrgsError(409, "app_payment_refused", APP_PAYMENT_WORDS.refused);

type Limit = () => Promise<boolean>;

/** An answer, and the record whose memberships it changed (a page opened, paid or closed), for the console's live lines;
 *  null where nothing changed. */
export interface Told<T> {
  answer: T;
  tell: string | null;
}

const leaseFrom = (at: Date): Date => new Date(at.getTime() + APP_PAYMENT.leaseMs);

/** The gym's Square, able to make payment pages now: connected with a location, allowing what the page needs, in a
 *  country Square serves, and the gym on a live plan with us. Null otherwise. */
async function readyForApp(deps: PaymentsDeps, gymId: string): Promise<{ square: SquareSettings; row: repo.ConnectionRow & { locationId: string }; timezone: string } | null> {
  const square = deps.square;
  if (square === null) return null;
  const gym = await repo.readGym(deps.sql, gymId);
  if (gym === null) return null;
  const row = await repo.readConnection(deps.sql, gymId, square.environment);
  if (row === null || stateOf(square, gym, row) !== "ready" || row.locationId === null || row.accessToken === null || !appPaymentsAllowed(row)) return null;
  if (!(await gymHasLivePlan(deps.sql, gymId))) return null;
  return { square, row: { ...row, locationId: row.locationId }, timezone: gym.timezone };
}

/** The records whose bills this account pays: its own record, while it alone holds it and nobody pays for it, and each
 *  record it pays for (18i). 404 for anybody who is not a live member of the gym. */
async function payingFor(deps: PaymentsDeps, gymId: string, userId: string): Promise<readonly string[]> {
  const reader = await readerOf(deps.sql, gymId, userId);
  if (reader === null) throw orgNotFound();
  const own = reader.entryId !== null && reader.holders === 1 ? reader.entryId : null;
  if (own === null) return [];
  const [payer, paidFor] = await Promise.all([payerOf(deps.sql, gymId, own), paidForBy(deps.sql, gymId, own)]);
  return [...(payer === null ? [own] : []), ...paidFor.map((p) => p.entryId)];
}

function viewOf(row: pays.AppPayRow): AppPayment {
  const state = pays.stateOf(row);
  return {
    id: row.id,
    membershipId: row.membershipId,
    periodIndex: row.periodIndex,
    amountMinor: row.amountMinor,
    currency: row.currency,
    state,
    url: state === "open" ? row.url : null,
    closesAt: state === "open" ? row.closesAt.toISOString() : null,
    receiptNumber: row.receiptNumber,
  };
}

const answerOf = (row: pays.AppPayRow): AppPaymentResponse => appPaymentResponseSchema.parse({ payment: viewOf(row) });

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayOf = (day: string): string => {
  const [y, m, d] = day.split("-").map(Number);
  return `${String(d)} ${MONTHS[(m ?? 1) - 1] ?? ""} ${String(y)}`;
};

/** The line Square's page shows: the membership, and the days the bill covers ("Gold Monthly, 1 Nov 2026 to 30 Nov 2026"). */
export const lineName = (name: string, covers: { from: string; to: string } | null): string =>
  (covers === null ? name : `${name}, ${dayOf(covers.from)} to ${dayOf(covers.to)}`).slice(0, 500);

// ── Asking Square about a page ──

interface Asking {
  deps: PaymentsDeps;
  square: SquareSettings;
  token: string;
  row: pays.AppPayRow;
  now: Date;
}

async function tokenFor(deps: PaymentsDeps, square: SquareSettings, row: pays.AppPayRow): Promise<string | null> {
  const conn = await repo.readConnection(deps.sql, row.gymId, square.environment);
  if (conn?.state !== "connected" || conn.accountId !== row.accountId || conn.accessToken === null) return null;
  return square.tokens.open(conn.accessToken, accessContext(row.gymId));
}

/** The order's one payment, when Square has taken exactly what was asked: this order's, at the gym's location, in its
 *  money, with no tip, its amount the bill's (a card fee the business adds on top, which Square names, aside). */
function exactly(row: pays.AppPayRow, payment: SquarePayment): boolean {
  const surcharge = payment.card_details?.applied_card_surcharge_details?.card_surcharge_money ?? null;
  if (surcharge !== null && surcharge.currency !== row.currency) return false;
  const tip = payment.tip_money?.amount ?? 0;
  return (
    payment.status === "COMPLETED" &&
    payment.order_id === row.orderId &&
    (payment.location_id == null || payment.location_id === row.locationId) &&
    payment.amount_money.currency === row.currency &&
    tip === 0 &&
    payment.amount_money.amount - (surcharge?.amount ?? 0) === row.amountMinor &&
    (payment.total_money == null || payment.total_money.amount === payment.amount_money.amount)
  );
}

/** What Square's order says was paid, read from its payments: `none` where no payment took money (none named, or each
 *  FAILED or CANCELED, so the page can still close); `wait` while one is on its way or cannot be read; `done` once a
 *  payment Square took is recorded on the bill, or, where it is not exactly what was asked, kept as not recorded. */
async function settle(a: Asking, order: SquareOrder): Promise<"none" | "wait" | "done"> {
  const { deps, square, token, row } = a;
  const ids = (order.tenders ?? []).flatMap((t) => (t.payment_id == null ? [] : [t.payment_id]));
  if (ids.length === 0) return "none";
  const read: SquarePayment[] = [];
  for (const id of ids) {
    const got = await square.api.getPayment(token, id);
    if (got.kind !== "ok" || got.value.id !== id) return "wait";
    read.push(got.value);
  }
  // On its way: asked again on the next look.
  if (read.some((p) => p.status === "APPROVED" || p.status === "PENDING")) return "wait";
  const taken = read.filter((p) => p.status === "COMPLETED");
  if (taken.length === 0) {
    if (read.some((p) => p.status !== "FAILED" && p.status !== "CANCELED")) {
      deps.log.error({ event: "square.app_payment_unknown_status", gymId: row.gymId }, "a payment page's order names a payment in a state nobody has placed");
      return "wait";
    }
    return "none";
  }
  const [payment] = taken;
  if (payment === undefined) return "none";
  const card = payment.card_details?.card;
  const cardSeen = card?.card_brand != null && card.last_4 != null ? { brand: card.card_brand, last4: card.last_4 } : null;
  const gym = await repo.readGym(deps.sql, row.gymId);
  const now = deps.now();
  const today = dayInTz(now, gym?.timezone ?? "UTC");
  // One payment, exactly what was asked: anything else Square took is kept, never put on the bill.
  const refuse = taken.length !== 1 || !exactly(row, payment) ? "amount_differs" : undefined;
  if (refuse !== undefined) deps.log.error({ event: "square.app_payment_unexpected", gymId: row.gymId }, "Square took another amount than a payment page asked");
  // What Square took, every payment the order names, in the page's money, so a line about it names what really went: the
  // bill's amount, or another; null where Square named another money.
  const totals = taken.map((p) => p.total_money ?? p.amount_money);
  const tookMinor = totals.every((t) => t.currency === row.currency) ? totals.reduce((sum, t) => sum + t.amount, 0) : null;
  const kept = await pays.recordPaid(deps.sql, { row, squarePaymentId: payment.id, card: cardSeen, taken: tookMinor, today, now, ...(refuse === undefined ? {} : { refuse }) });
  if (kept?.outcome === "not_recorded") deps.log.error({ event: "square.app_payment_not_recorded", gymId: row.gymId }, "money taken in the app could not be recorded on its bill");
  return "done";
}

/** One look at Square for a page this request holds: paid, closed, or still open. A page past its time, or one somebody
 *  asked to close, is deleted at Square first, and read again: Square may have taken the money just before. */
async function step(a: Asking): Promise<void> {
  const { deps, square, token, row, now } = a;
  const closing = row.closeWantedAt !== null || now.getTime() >= row.closesAt.getTime();
  if (closing && row.closeWantedAt === null) await pays.wantClose(deps.sql, row.gymId, row.id, "expired", null, now);
  const read = await square.api.getOrder(token, row.orderId);
  if (read.kind === "ok") {
    const order = read.value;
    if (order.id !== row.orderId) return;
    if ((await settle(a, order)) !== "none") return;
    if (order.state === "CANCELED") {
      await pays.finish(deps.sql, row.gymId, row.id, "closed", now);
      return;
    }
  } else if (read.kind === "refused") {
    deps.log.warn({ event: "square.app_payment_order_refused", gymId: row.gymId, status: read.status, code: read.code }, "Square refused a payment page's order");
  }
  if (!closing) return;
  const deleted = await square.api.deletePaymentLink(token, row.linkId);
  if (deleted.kind === "unavailable") return;
  // Square's answer to the delete is a doorbell: the order says how it ended.
  const after = await square.api.getOrder(token, row.orderId);
  if (after.kind !== "ok" || after.value.id !== row.orderId) return;
  if ((await settle(a, after.value)) !== "none") return;
  if (after.value.state === "CANCELED") await pays.finish(deps.sql, row.gymId, row.id, "closed", now);
}

/** Ask Square about a page this request holds until `until`, then let it go. A page Square has not said the end of within a
 *  day of opening, whatever it answered meanwhile, is given up on (`no_answer`): it holds the membership no longer, and its
 *  bill says to check Square before taking the payment again. */
async function advance(deps: PaymentsDeps, square: SquareSettings, row: pays.AppPayRow, until: Date): Promise<void> {
  try {
    const now = deps.now();
    const token = await tokenFor(deps, square, row);
    if (token === null) {
      // The gym left that Square account: the page can no longer be read or closed from here.
      deps.log.warn({ event: "square.app_payment_unfollowed", gymId: row.gymId }, "a payment page's Square connection went while it was open");
      await pays.finish(deps.sql, row.gymId, row.id, "gone", now);
      return;
    }
    await step({ deps, square, token, row, now });
    if (now.getTime() - row.openedAt.getTime() >= APP_PAYMENT.giveUpMs && (await pays.finish(deps.sql, row.gymId, row.id, "no_answer", now))) {
      deps.log.error({ event: "square.app_payment_given_up", gymId: row.gymId }, "Square never said how a payment page ended");
    }
  } finally {
    await pays.release(deps.sql, row.gymId, row.id, until);
  }
}

/** Asked by this request now, or left to the one already asking for at most `waitMs`. */
async function lookNow(deps: PaymentsDeps, square: SquareSettings, gymId: string, id: string, waitMs: number): Promise<void> {
  const waitUntil = Date.now() + waitMs;
  for (;;) {
    const now = deps.now();
    const held = await pays.claim(deps.sql, gymId, id, now, leaseFrom(now));
    if (held !== null) {
      await advance(deps, square, held, leaseFrom(now));
      return;
    }
    if (Date.now() >= waitUntil) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

// ── The member's routes ──

/** For My membership: whether this gym takes payments in the app now, and the reader's pages still open. */
export async function readMyAppPayments(deps: PaymentsDeps, userId: string, gymId: string, limit: Limit): Promise<MyAppPaymentsResponse | null> {
  const entries = await payingFor(deps, gymId, userId);
  if (!(await limit())) return null;
  const ready = entries.length === 0 ? null : await readyForApp(deps, gymId);
  const open = await pays.readOpenOf(deps.sql, gymId, userId);
  return myAppPaymentsResponseSchema.parse({ inApp: ready !== null, open: open.map(viewOf) });
}

/** Pay: Square's page for the bill the screen showed, all that is left of it. The same press sent twice is one page; a
 *  page already open for the same bill is given back instead of a second. */
export async function startAppPayment(deps: PaymentsDeps, userId: string, gymId: string, body: AppPaymentRequest, limit: Limit): Promise<Told<AppPaymentResponse> | null> {
  const entries = await payingFor(deps, gymId, userId);
  if (!(await limit())) return null;
  const same = await pays.readByKey(deps.sql, gymId, body.requestKey);
  if (same !== null) {
    const repeat = same.openedBy === userId && same.membershipId === body.membershipId && same.periodIndex === body.periodIndex && same.amountMinor === body.amountMinor;
    if (!repeat) throw changed();
    return { answer: answerOf(same), tell: null };
  }
  const entryId = await pays.holderOf(deps.sql, gymId, body.membershipId);
  // Somebody else's membership reads as one the gym does not have.
  if (entryId === null || !entries.includes(entryId)) throw notFound();
  const ready = await readyForApp(deps, gymId);
  if (ready === null) throw notOffered();
  const now = deps.now();
  const pressing: pays.Pressing = {
    gymId,
    entryId,
    membershipId: body.membershipId,
    periodIndex: body.periodIndex,
    amountMinor: body.amountMinor,
    accountCurrency: ready.row.currency,
    today: dayInTz(now, ready.timezone),
    now,
  };
  const before = await pays.payable(deps.sql, pressing);
  if (before.kind !== "ok") return { answer: openOr(before, userId, body), tell: null };

  const token = ready.square.tokens.open(ready.row.accessToken ?? "", accessContext(gymId));
  if (token === null) throw notOffered();
  const id = randomUUID();
  const linkKey = randomUUID();
  const made = await ready.square.api.createPaymentLink(token, {
    idempotencyKey: linkKey,
    locationId: ready.row.locationId,
    referenceId: id,
    name: lineName(before.name, before.covers),
    amountMinor: body.amountMinor,
    currency: before.currency,
    note: APP_PAYMENT.note,
  });
  if (made.kind === "unavailable") throw squareDown();
  if (made.kind === "refused") {
    deps.log.warn({ event: "square.app_payment_link_refused", gymId, status: made.status, code: made.code }, "Square refused to make a payment page");
    throw made.status === 401 || made.status === 403 ? notOffered() : squareRefused();
  }
  const link = made.value;
  // Square's order is what the page charges: anything but the bill's amount is never given to the member.
  const total = link.order?.total_money ?? null;
  if (total !== null && (total.amount !== body.amountMinor || total.currency !== before.currency)) {
    deps.log.error({ event: "square.app_payment_link_total", gymId }, "Square made a payment page for another amount than asked");
    await ready.square.api.deletePaymentLink(token, link.linkId);
    throw squareRefused();
  }
  const at = deps.now();
  const written = await pays.writeOpen(deps.sql, {
    ...pressing,
    now: at,
    today: dayInTz(at, ready.timezone),
    id,
    environment: ready.square.environment,
    accountId: ready.row.accountId,
    locationId: ready.row.locationId,
    requestKey: body.requestKey,
    openedBy: userId,
    closesAt: new Date(at.getTime() + APP_PAYMENT.openMs),
    linkKey,
    linkId: link.linkId,
    orderId: link.orderId,
    url: link.url,
  });
  if (written.kind === "new") return { answer: answerOf(written.row), tell: entryId };
  // Something changed while Square made the page: nobody was given its address, and Square is told to delete it.
  const gone = await ready.square.api.deletePaymentLink(token, link.linkId);
  if (gone.kind !== "ok") deps.log.warn({ event: "square.app_payment_link_left", gymId }, "a payment page nobody was given could not be deleted");
  if (written.kind === "key_reused") {
    const repeat = written.row.openedBy === userId && written.row.membershipId === body.membershipId && written.row.periodIndex === body.periodIndex;
    if (!repeat) throw changed();
    return { answer: answerOf(written.row), tell: null };
  }
  return { answer: openOr(written, userId, body), tell: null };
}

/** Why a page cannot be made, or the page already open for this very bill. */
function openOr(outcome: Exclude<pays.PayableOutcome, { kind: "ok" }>, userId: string, body: AppPaymentRequest): AppPaymentResponse {
  switch (outcome.kind) {
    case "open": {
      const row = outcome.row;
      if (row.openedBy === userId && row.periodIndex === body.periodIndex && row.amountMinor === body.amountMinor) return answerOf(row);
      throw changed();
    }
    case "at_desk":
      throw atDesk();
    case "currency":
      throw notOffered();
    case "entry_not_found":
    case "membership_not_found":
      throw notFound();
    case "changed":
      throw changed();
    case "not_due":
      throw notDue();
    default: {
      const never: never = outcome;
      throw new Error(`unhandled payment page check: ${JSON.stringify(never)}`);
    }
  }
}

/** Where a page stands: Square is asked, unless another request is asking right now. */
export async function checkAppPayment(deps: PaymentsDeps, userId: string, gymId: string, id: string, limit: Limit): Promise<Told<AppPaymentResponse> | null> {
  await payingFor(deps, gymId, userId);
  if (!(await limit())) return null;
  const row = await pays.readOwn(deps.sql, gymId, userId, id);
  if (row === null) throw notFound();
  if (row.state === "open" && deps.square !== null) await lookNow(deps, deps.square, gymId, id, 0);
  return await toldOf(deps, userId, gymId, id, row);
}

/** The member left the page: it is closed at Square, unless Square says it was paid. */
export async function closeAppPayment(deps: PaymentsDeps, userId: string, gymId: string, id: string, limit: Limit): Promise<Told<AppPaymentResponse> | null> {
  await payingFor(deps, gymId, userId);
  if (!(await limit())) return null;
  const row = await pays.readOwn(deps.sql, gymId, userId, id);
  if (row === null) throw notFound();
  if (row.state === "open" && deps.square !== null) {
    await pays.wantClose(deps.sql, gymId, id, "member", null, deps.now());
    await lookNow(deps, deps.square, gymId, id, APP_PAYMENT.closeWaitMs);
  }
  return await toldOf(deps, userId, gymId, id, row);
}

/** The page as it reads now, telling the console where Square's answer ended it. */
async function toldOf(deps: PaymentsDeps, userId: string, gymId: string, id: string, before: pays.AppPayRow): Promise<Told<AppPaymentResponse>> {
  const now = await pays.readOwn(deps.sql, gymId, userId, id);
  if (now === null) throw notFound();
  return { answer: answerOf(now), tell: before.state === "open" && now.state !== "open" ? now.entryId : null };
}

// ── Staff ──

/** Close payment page, on the person's page: the page open on this membership is closed at Square, unless Square says
 *  it was paid. Whoever records payments may press it. */
export async function closeAppPaymentByStaff(deps: PaymentsDeps, userId: string, gymId: string, entryId: string, membershipId: string): Promise<AppPaymentCloseResponse> {
  await requirePrivilege(deps, gymId, userId, BILLING);
  const open = await pays.openOnMemberships(deps.sql, gymId, [membershipId]);
  const found = open.get(membershipId);
  const holder = await pays.holderOf(deps.sql, gymId, membershipId);
  if (found === undefined || holder !== entryId) throw new OrgsError(404, "app_payment_not_found", APP_PAYMENT_STAFF_WORDS.none);
  if (deps.square !== null) {
    await pays.staffClose(deps.sql, { gymId, id: found.id, entryId, membershipId, staffUserId: userId, now: deps.now() });
    await lookNow(deps, deps.square, gymId, found.id, APP_PAYMENT.closeWaitMs);
  }
  const ended = await pays.outcomeOf(deps.sql, gymId, found.id);
  const outcome = ended === null ? "waiting" : ended === "paid" ? "paid" : pays.CHECK_OUTCOMES.includes(ended) ? "check" : "closed";
  return appPaymentCloseResponseSchema.parse({ outcome });
}

// ── The worker ──

/** The worker's minute: pages nobody has asked about since the phone last did, and closed ones to forget. `gymIds`:
 *  only these gyms, for a test sharing its database; production passes null. */
export async function processAppPayments(deps: PaymentsDeps, square: SquareSettings, gymIds: readonly string[] | null = null): Promise<{ asked: number; forgotten: number }> {
  let asked = 0;
  while (asked < APP_PAYMENT.perRun) {
    const at = deps.now();
    const [row] = await pays.claimIdle(deps.sql, square.environment, at, APP_PAYMENT.idleMs, leaseFrom(at), 1, gymIds);
    if (row === undefined) break;
    asked += 1;
    await advance(deps, square, row, leaseFrom(at));
  }
  const forgotten = await pays.forgetDone(deps.sql, new Date(deps.now().getTime() - APP_PAYMENT.keepMs), gymIds);
  return { asked, forgotten };
}
