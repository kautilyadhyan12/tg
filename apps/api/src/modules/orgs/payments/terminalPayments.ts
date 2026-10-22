// TAKE PAYMENT ON TERMINAL (ROADMAP 18d-vi-a; spec Part 3 §14.8; rulings/2026-10-21-money-plan.md).
//
// Staff holding the payments tick press Take payment on Terminal in a bill's Record payment box,
// or in a late cancel or no-show fee's (18d-vi-b-i), or at Sell for a whole basket (18d-vi-b-ii),
// recorded as that sale once Square takes the money.
// The amount goes to the gym's Square Terminal (Square's Terminal checkout, with no tip screen and
// no receipt screen of Square's: the gym's receipt is ours); the person taps, inserts or swipes
// their card there, and the payment Square took is recorded on the bill as Card on Terminal. The
// console asks every few seconds; a page closed meanwhile is finished by the worker, so money
// taken at the Terminal still lands on the bill, and a Terminal that never shows it is cancelled.
//
// THE WORST THING here is a person charged and their bill still owing, so they are charged again,
// or the money recorded on somebody else's bill. So nothing is recorded until Square says the
// checkout is COMPLETED and its one completed payment is this checkout's, for this amount, at the
// gym's location; it is recorded once (the press is the payment's request key, and Square's
// payment id is kept once); while it waits, nothing else is recorded, voided or cancelled on that
// membership; and a payment Square took that the bill can no longer take is never dropped: it is
// kept and told to the gym's Staff activity. A Terminal payment is refunded in Square, never
// voided here.
//
// Square answers with no clear answer (no connection, a 5xx) are asked again: a payment is ended
// only on Square's own answer, the gym leaving that Square account, or a day without an answer.
import { randomUUID } from "node:crypto";
import {
  GYM_PAYMENTS_WORDS,
  MEMBER_FEE_WORDS,
  TERMINAL_PAYMENT_WORDS,
  formatMinor,
  terminalPaymentResponseSchema,
  terminalPaymentsResponseSchema,
  terminalSalesResponseSchema,
  type CardTerminal,
  type SquarePayment,
  type SquareTerminalCheckout,
  type TerminalPayment,
  type TerminalFeePaymentRequest,
  type TerminalPaymentOutcome,
  type TerminalPaymentRequest,
  type TerminalPaymentResponse,
  type TerminalPaymentsResponse,
  type TerminalSaleRequest,
  type TerminalSalesResponse,
} from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import { saleRefused } from "../register/service.js";
import { BILLING, connectionRefused, entryNotFound, notReady, orgNotFound, readyOrThrow, stateOf, type Ready } from "./cards.js";
import * as cards from "./cardsRepo.js";
import * as repo from "./repo.js";
import { accessContext, missingScopes, terminalsOffered, type PaymentsDeps } from "./service.js";
import type { SquareSettings } from "./settings.js";
import type { SquareResult } from "./square.js";
import { SQUARE_PRACTICE_DEVICES } from "./terminals.js";
import * as pays from "./terminalPaymentsRepo.js";
import * as terminalsRepo from "./terminalsRepo.js";

export const TERMINAL_PAYMENT = {
  /** Square cancels a checkout after this: its own default, five minutes. */
  deadline: "PT5M",
  deadlineMs: 5 * 60_000,
  /** Still not done this long past Square's own time: Square is asked to cancel it. */
  graceMs: 60_000,
  /** Never on the Terminal's screen this long: it is off or offline, so it is cancelled (as a
   *  card save on it is, 18d-ii-b-ii's click-through). */
  notShownMs: 60_000,
  /** One request asks Square about a payment at a time, for at most this long. */
  leaseMs: 20_000,
  /** Cancel waits this long for a request already asking Square, then leaves its mark for it. */
  cancelWaitMs: 2_000,
  /** Nobody has asked for this long: the worker asks. */
  idleMs: 20_000,
  /** Square giving no answer at all (down, or out of reach) for a day: given up, and told. Until
   *  then money taken at the Terminal meanwhile is recorded when Square answers again. */
  giveUpMs: 24 * 60 * 60_000,
  /** A done one is kept this long, for the page that asks how it ended. */
  keepMs: 24 * 60 * 60_000,
  perRun: 50,
  /** What the gym's Square Dashboard lists the payment as: no name of the person goes to Square. */
  note: "Membership payment",
  saleNote: "Sale at the desk",
} as const;

/** Square's simulated Terminals take a checkout on other device ids than an action ("Sandbox
 *  testing", Terminal checkouts, read 2026-10-22): each practice Terminal sends its checkout to the
 *  one that plays its part. A checkout sent to an action's device stays pending (measured
 *  2026-10-22). Square has no simulated decline; "declines" plays the person cancelling. */
const PRACTICE_CHECKOUT_DEVICES: Readonly<Record<string, string>> = {
  [SQUARE_PRACTICE_DEVICES.saves]: "9fa747a2-25ff-48ee-b078-04381f7c828f",
  [SQUARE_PRACTICE_DEVICES.declines]: "841100b9-ee60-4537-9bcf-e30b2ba5e215",
  [SQUARE_PRACTICE_DEVICES.cancels]: "841100b9-ee60-4537-9bcf-e30b2ba5e215",
  [SQUARE_PRACTICE_DEVICES.times_out]: "0a956d49-619a-4530-8e5e-8eac603ffc5e",
  [SQUARE_PRACTICE_DEVICES.offline]: "da40d603-c2ea-4a65-8cfd-f42e36dab0c7",
};

/** The device a checkout is sent to: the Terminal itself, or in Square's sandbox the simulated
 *  Terminal that plays its part. */
export function checkoutDevice(pay: Pick<pays.PayRow, "environment" | "deviceId">): string {
  return pay.environment === "sandbox" ? (PRACTICE_CHECKOUT_DEVICES[pay.deviceId] ?? pay.deviceId) : pay.deviceId;
}

const NO_BILLING = "Recording payments isn't part of your role. Ask the owner to turn on \"Record members' payments\" for you.";
const paymentGone = (): OrgsError => new OrgsError(404, "terminal_payment_gone", TERMINAL_PAYMENT_WORDS.payment_gone);
const terminalGone = (): OrgsError => new OrgsError(404, "terminal_gone", TERMINAL_PAYMENT_WORDS.terminal_gone);
const terminalBusy = (): OrgsError => new OrgsError(409, "terminal_busy", TERMINAL_PAYMENT_WORDS.terminal_busy);

/** Why Square's answer ended a payment, from its cancel reason. */
function cancelledAs(checkout: SquareTerminalCheckout, pickedUp: boolean): NotTaken {
  if (checkout.cancel_reason === "BUYER_CANCELED") return "cancelled_on_terminal";
  if (checkout.cancel_reason === "TIMED_OUT") return pickedUp ? "timed_out" : "no_answer";
  return "cancelled";
}

/** An end with no money taken. */
type NotTaken = Exclude<TerminalPaymentOutcome, "paid" | "not_recorded">;

/** How the payment ended, or null while it waits; said once for the request that pressed. */
type Step = { done: TerminalPaymentOutcome; refusal?: SquareResult<unknown> } | null;

interface Asking {
  deps: PaymentsDeps;
  square: SquareSettings;
  token: string;
  pay: pays.PayRow;
  now: Date;
}

const ended = async (a: Asking, outcome: NotTaken, refusal?: SquareResult<unknown>): Promise<Step> => {
  await pays.finish(a.deps.sql, a.pay.id, outcome, a.now);
  return refusal === undefined ? { done: outcome } : { done: outcome, refusal };
};

/** The checkout: read from Square, or made with the press's own key (asked again, Square gives
 *  back the same checkout). */
async function checkoutOf(a: Asking): Promise<SquareResult<SquareTerminalCheckout>> {
  const { pay, square, token } = a;
  if (pay.checkoutId !== null) return await square.api.getTerminalCheckout(token, pay.checkoutId);
  const made = await square.api.createTerminalCheckout(token, {
    idempotencyKey: pay.checkoutKey,
    deviceId: checkoutDevice(pay),
    amountMinor: pay.amountMinor,
    currency: pay.currency,
    // Square's own field for the app's record of it: the press, never the person.
    referenceId: pay.id,
    // A fee is named as one ("No-show fee"), so staff refunding it in Square find it (18d-vi-b-i).
    note: pay.sale !== null ? TERMINAL_PAYMENT.saleNote : pay.feeKind === null ? TERMINAL_PAYMENT.note : MEMBER_FEE_WORDS[pay.feeKind],
    deadline: TERMINAL_PAYMENT.deadline,
  });
  if (made.kind !== "ok") return made;
  if (!(await pays.setCheckout(a.deps.sql, pay.id, made.value.id))) {
    // Ended meanwhile: what was just made is stopped.
    await square.api.cancelTerminalCheckout(token, made.value.id);
    return { kind: "refused", status: 409, code: "PAYMENT_MOVED_ON" };
  }
  pay.checkoutId = made.value.id;
  return made;
}

/** The checkout is the one this press asked for: its id, our Terminal, our amount and our press
 *  named in Square's answer (its test area names all of them, measured 2026-10-22). */
function isOurs(a: Asking, checkout: SquareTerminalCheckout): boolean {
  const { pay } = a;
  if (checkout.id !== pay.checkoutId) return false;
  if (checkout.amount_money.amount !== pay.amountMinor || checkout.amount_money.currency !== pay.currency) return false;
  const device = checkout.device_options?.device_id;
  if (device != null && device !== checkoutDevice(pay)) return false;
  return checkout.reference_id == null || checkout.reference_id === pay.id;
}

/** The checkout's payment, when Square has taken exactly what was asked: this checkout's, its
 *  amount with no tip on top, at the gym's location. `wait`: one still on its way. */
function takenOf(a: Asking, checkout: SquareTerminalCheckout, payments: readonly SquarePayment[]): { kind: "taken"; id: string } | { kind: "wait" } | { kind: "none" } | { kind: "other"; id: string } {
  const { pay } = a;
  const completed = payments.filter((p) => p.status === "COMPLETED");
  if (completed.length === 0) return payments.some((p) => p.status === "APPROVED" || p.status === "PENDING") ? { kind: "wait" } : { kind: "none" };
  const [one] = completed;
  if (one === undefined) return { kind: "none" };
  const exact =
    completed.length === 1 &&
    one.amount_money.amount === pay.amountMinor &&
    one.amount_money.currency === pay.currency &&
    (one.tip_money == null || one.tip_money.amount === 0) &&
    (one.total_money == null || one.total_money.amount === pay.amountMinor) &&
    (one.terminal_checkout_id == null || one.terminal_checkout_id === checkout.id) &&
    (one.location_id == null || one.location_id === pay.locationId);
  return exact ? { kind: "taken", id: one.id } : { kind: "other", id: one.id };
}

/** Square says the checkout is paid: its payment is read and, when it is exactly what was asked,
 *  recorded on the bill; anything else Square took is kept as not recorded and told to the gym. */
async function paid(a: Asking, checkout: SquareTerminalCheckout): Promise<Step> {
  const { deps, square, token, pay } = a;
  const ids = checkout.payment_ids ?? [];
  const read: SquarePayment[] = [];
  for (const id of ids) {
    const got = await square.api.getPayment(token, id);
    if (got.kind === "unavailable") return null;
    if (got.kind === "refused") {
      deps.log.error({ event: "square.terminal_payment_unreadable", gymId: pay.gymId, status: got.status, code: got.code }, "Square refused a payment its checkout named");
      return null;
    }
    if (got.value.id !== id) return null;
    read.push(got.value);
  }
  const taken = takenOf(a, checkout, read);
  if (taken.kind === "wait") return null;
  if (taken.kind === "none") {
    deps.log.error({ event: "square.terminal_paid_without_payment", gymId: pay.gymId }, "a Terminal checkout finished with no payment taken");
    return await ended(a, "refused");
  }
  const gym = await repo.readGym(deps.sql, pay.gymId);
  const now = deps.now();
  const today = dayInTz(now, gym?.timezone ?? "UTC");
  if (taken.kind === "other") {
    deps.log.error({ event: "square.terminal_payment_unexpected", gymId: pay.gymId }, "a Terminal checkout took another amount than asked");
    const kept = await pays.recordPaid(deps.sql, { pay, squarePaymentId: taken.id, today, now, refuse: "amount_differs" });
    return kept === null ? null : { done: kept.outcome };
  }
  const kept = await pays.recordPaid(deps.sql, { pay, squarePaymentId: taken.id, today, now });
  if (kept?.outcome === "not_recorded") deps.log.error({ event: "square.terminal_payment_not_recorded", gymId: pay.gymId }, "money taken on a Terminal could not be recorded on its bill");
  return kept === null ? null : { done: kept.outcome };
}

/** Past Square's own time with no end from it: Square is asked to cancel. */
async function overdue(a: Asking, checkout: SquareTerminalCheckout): Promise<Step> {
  if (a.now.getTime() <= a.pay.startedAt.getTime() + TERMINAL_PAYMENT.deadlineMs + TERMINAL_PAYMENT.graceMs) return null;
  const cancel = await a.square.api.cancelTerminalCheckout(a.token, checkout.id);
  if (cancel.kind === "ok" && isOurs(a, cancel.value) && cancel.value.status === "CANCELED") return await ended(a, a.pay.pickedUp ? "timed_out" : "no_answer");
  // Paid at the last moment, or no answer: its next look decides.
  return null;
}

/** Waiting for the person. */
async function waiting(a: Asking, checkout: SquareTerminalCheckout): Promise<Step> {
  const { pay } = a;
  if (checkout.status === "CANCELED") return await ended(a, cancelledAs(checkout, pay.pickedUp));
  if (checkout.status === "COMPLETED") return await paid(a, checkout);
  // Never shown on the Terminal: it is off or offline.
  if (checkout.status === "PENDING" && !pay.pickedUp && a.now.getTime() > pay.startedAt.getTime() + TERMINAL_PAYMENT.notShownMs) {
    const cancel = await a.square.api.cancelTerminalCheckout(a.token, checkout.id);
    if (cancel.kind === "ok" && isOurs(a, cancel.value) && cancel.value.status === "CANCELED") return await ended(a, "no_answer");
    return null;
  }
  return await overdue(a, checkout);
}

/** Cancel was pressed: the Terminal is stopped before anything else. Money Square took already is
 *  recorded, as Square took it; otherwise it ends only on Square's own answer. */
async function stopping(a: Asking, checkout: SquareTerminalCheckout): Promise<Step> {
  const { pay } = a;
  if (checkout.status === "CANCELED") return await ended(a, cancelledAs(checkout, pay.pickedUp));
  if (checkout.status === "COMPLETED") return await paid(a, checkout);
  const cancel = await a.square.api.cancelTerminalCheckout(a.token, checkout.id);
  if (cancel.kind === "ok" && isOurs(a, cancel.value) && (cancel.value.status === "CANCELED" || cancel.value.status === "COMPLETED")) return await stopping(a, cancel.value);
  // Square has no such checkout: nothing is on the Terminal.
  if (cancel.kind === "refused" && cancel.status === 404) return await ended(a, "cancelled");
  // Too late: the person is paying, and the payment goes through.
  if (cancel.kind === "refused" && cancel.status === 400) {
    await pays.cancelRefusedTooLate(a.deps.sql, pay.id);
    pay.cancelWantedAt = null;
    pay.cancelTooLate = true;
    return null;
  }
  // Asked (CANCEL_REQUESTED), or no answer: Square's next answer ends it.
  return null;
}

/** Nothing to go on yet, so asked again. Square refusing to show a checkout of ours (`refused`), or
 *  showing another, is held only until Square's own time and a minute more are past: by then Square
 *  has cancelled it or taken the money, so it ends as one to check in Square, told to Staff activity,
 *  and the bill and the Terminal are not held longer (review round one, Low 1). No answer at all
 *  (`unavailable`) is waited out for a day: Square may have taken the money meanwhile, and it is
 *  recorded when Square answers again (re-check). */
async function notYet(a: Asking, why: "refused" | "unavailable"): Promise<Step> {
  const limit = why === "refused" ? TERMINAL_PAYMENT.deadlineMs + TERMINAL_PAYMENT.graceMs : TERMINAL_PAYMENT.giveUpMs;
  if (a.now.getTime() <= a.pay.startedAt.getTime() + limit) return null;
  a.deps.log.error({ event: "square.terminal_payment_unchecked", gymId: a.pay.gymId, why }, "a Terminal payment could not be read from Square past its time");
  return await ended(a, "gone");
}

/** One look at Square for the payment, and whatever follows from Square's answer. */
async function step(a: Asking): Promise<Step> {
  const { deps, pay } = a;
  pay.cancelWantedAt ??= await pays.readCancelWanted(deps.sql, pay.id);
  // Even with Cancel pressed and no checkout id kept, Square may have made the checkout and its
  // answer been lost: asking with the press's own key gives it back (or makes it), and `stopping`
  // cancels it. "Cancelled" is said only on Square's own word (review round one, Critical 1).
  const got = await checkoutOf(a);
  if (got.kind === "unavailable") return await notYet(a, "unavailable");
  if (got.kind === "refused") {
    if (got.code === "PAYMENT_MOVED_ON") return null;
    if (pay.cancelWantedAt !== null && got.status === 404) return await ended(a, "cancelled");
    deps.log.warn({ event: "square.terminal_checkout_refused", gymId: pay.gymId, status: got.status, code: got.code }, "Square refused a Terminal checkout");
    // Refused before it reached the Terminal: nothing was taken. One Square made and then
    // refuses to show is asked about again until it answers.
    if (pay.checkoutId !== null) return await notYet(a, "refused");
    return await ended(a, "refused", got);
  }
  const checkout = got.value;
  if (!isOurs(a, checkout)) {
    deps.log.error({ event: "square.terminal_checkout_unexpected", gymId: pay.gymId }, "Square answered about another Terminal checkout");
    // Never recorded, never ended on it: a checkout of ours may still take money.
    return await notYet(a, "refused");
  }
  // On the Terminal's screen: Square reads it in progress, or it was answered there.
  if (!pay.pickedUp && (checkout.status === "IN_PROGRESS" || checkout.status === "COMPLETED")) {
    await pays.setPickedUp(deps.sql, pay.id);
    pay.pickedUp = true;
  }
  if (pay.cancelWantedAt !== null) return await stopping(a, checkout);
  return await waiting(a, checkout);
}

/** The gym's token for the Square account the press began with, while it is connected to it. */
async function tokenFor(deps: PaymentsDeps, square: SquareSettings, pay: pays.PayRow): Promise<string | null> {
  const row = await repo.readConnection(deps.sql, pay.gymId, square.environment);
  if (row?.state !== "connected" || row.accountId !== pay.accountId || row.accessToken === null) return null;
  return square.tokens.open(row.accessToken, accessContext(pay.gymId));
}

/** Ask Square about a payment this request holds until `until`, then let it go. */
async function advance(deps: PaymentsDeps, square: SquareSettings, pay: pays.PayRow, until: Date): Promise<Step> {
  try {
    const now = deps.now();
    const token = await tokenFor(deps, square, pay);
    if (token === null) {
      // The gym left that Square account: whatever the Terminal does now cannot be read here.
      deps.log.warn({ event: "square.terminal_payment_unfollowed", gymId: pay.gymId }, "a Terminal payment's Square connection went while it waited");
      return await ended({ deps, square, token: "", pay, now }, "gone");
    }
    return await step({ deps, square, token, pay, now });
  } finally {
    await pays.release(deps.sql, pay.id, until);
  }
}

const leaseFrom = (at: Date): Date => new Date(at.getTime() + TERMINAL_PAYMENT.leaseMs);

/** The gym's paired Terminals in an account, as Card on file names them, with their device ids. */
async function pairedTerminals(deps: PaymentsDeps, gymId: string, environment: pays.PayRow["environment"], accountId: string): Promise<(CardTerminal & { deviceId: string })[]> {
  return (await terminalsRepo.readTerminals(deps.sql, gymId, environment, accountId)).flatMap((t) =>
    t.state === "paired" && t.deviceId !== null ? [{ id: t.id, serial: t.practice === null ? t.deviceId : null, practice: t.practice, deviceId: t.deviceId }] : [],
  );
}

function viewOf(pay: pays.PayRow, paired: readonly (CardTerminal & { deviceId: string })[]): TerminalPayment {
  const terminal = paired.find((t) => t.deviceId === pay.deviceId);
  return {
    id: pay.id,
    membershipId: pay.membershipId,
    forSale: pay.sale !== null,
    feeBillId: pay.feeBillId,
    amountMinor: pay.amountMinor,
    currency: pay.currency,
    step: pay.state,
    outcome: pay.outcome,
    pickedUp: pay.pickedUp,
    stopping: pay.state === "waiting" && pay.cancelWantedAt !== null,
    tooLate: pay.state === "waiting" && pay.cancelTooLate,
    terminal: terminal === undefined ? null : { id: terminal.id, serial: terminal.serial, practice: terminal.practice },
    startedAt: pay.startedAt.toISOString(),
    receiptNumber: pay.receiptNumber,
    startedByName: pay.startedByName ?? null,
  };
}

/** The answer for the page: where the payment stands. */
async function answer(deps: PaymentsDeps, userId: string, gymId: string, of: pays.Scope, payId: string): Promise<TerminalPaymentResponse> {
  await requirePrivilege(deps, gymId, userId, BILLING);
  const pay = await pays.readPayment(deps.sql, gymId, of, payId);
  if (pay === null) throw paymentGone();
  return terminalPaymentResponseSchema.parse({ payment: viewOf(pay, await pairedTerminals(deps, gymId, pay.environment, pay.accountId)) });
}

/** The Terminals this person's bills can be paid on now, and what waits on one for them. */
export async function readTerminalPayments(deps: PaymentsDeps, userId: string, gymId: string, entryId: string): Promise<TerminalPaymentsResponse> {
  await requirePrivilege(deps, gymId, userId, BILLING);
  if ((await cards.readPerson(deps.sql, gymId, entryId)) === null) throw entryNotFound();
  const square = deps.square;
  const gym = await repo.readGym(deps.sql, gymId);
  if (gym === null) throw orgNotFound();
  // Whether the gym has set up Square, for the payment forms' Connect Square (18x, Kd 2026-10-22).
  const isOwner = gym.ownerUserId === userId;
  if (square === null) return terminalPaymentsResponseSchema.parse({ terminals: [], waiting: [], square: "not_offered", isOwner });
  const row = await repo.readConnection(deps.sql, gymId, square.environment);
  const waitingRows = await pays.readWaitingOf(deps.sql, gymId, entryId, square.environment);
  const accountId = row?.state === "connected" ? row.accountId : null;
  const usable = row !== null && accountId !== null && row.locationId !== null && terminalsOffered(row) && !missingScopes(row);
  const paired = accountId === null ? [] : await pairedTerminals(deps, gymId, square.environment, accountId);
  const waiting = await Promise.all(
    waitingRows.map(async (p) => viewOf(p, p.accountId === accountId ? paired : await pairedTerminals(deps, gymId, p.environment, p.accountId))),
  );
  return terminalPaymentsResponseSchema.parse({
    terminals: usable ? paired.map((t) => ({ id: t.id, serial: t.serial, practice: t.practice })) : [],
    waiting,
    square: stateOf(square, gym, row),
    isOwner,
  });
}

/** Square's refusal of the first step, in the words the press is answered with. */
function startRefused(refusal: SquareResult<unknown> | undefined): OrgsError {
  if (refusal?.kind === "refused" && refusal.status === 401) return connectionRefused();
  if (refusal?.kind === "refused" && refusal.status === 403) return new OrgsError(409, "terminals_need_allow", GYM_PAYMENTS_WORDS.terminals_need_allow);
  return new OrgsError(409, "terminal_refused", TERMINAL_PAYMENT_WORDS.terminal_refused);
}

/** Take payment on Terminal for a period of a membership. */
export async function startTerminalPayment(
  deps: PaymentsDeps,
  userId: string,
  gymId: string,
  entryId: string,
  membershipId: string,
  body: TerminalPaymentRequest,
): Promise<TerminalPaymentResponse> {
  return await start(deps, userId, gymId, entryId, membershipId, body, { kind: "period", periodIndex: body.periodIndex });
}

/** Take payment on Terminal for a late cancel or no-show fee of a membership (18d-vi-b-i). */
export async function startTerminalFeePayment(
  deps: PaymentsDeps,
  userId: string,
  gymId: string,
  entryId: string,
  membershipId: string,
  billId: string,
  body: TerminalFeePaymentRequest,
): Promise<TerminalPaymentResponse> {
  return await start(deps, userId, gymId, entryId, membershipId, body, { kind: "fee", billId });
}

/** The gym's Square, ready to take a payment on the chosen Terminal, or why not. */
async function terminalFor(deps: PaymentsDeps, gymId: string, terminalId: string) {
  const gym = await repo.readGym(deps.sql, gymId);
  if (gym === null) throw orgNotFound();
  const ready = await readyOrThrow(deps, gymId, gym);
  if (ready.row.locationId === null) throw notReady();
  if (!terminalsOffered(ready.row)) throw new OrgsError(409, "terminals_not_offered", GYM_PAYMENTS_WORDS.terminals_not_offered);
  if (missingScopes(ready.row)) throw new OrgsError(409, "terminals_need_allow", GYM_PAYMENTS_WORDS.terminals_need_allow);
  const terminal = await terminalsRepo.readTerminal(deps.sql, gymId, ready.square.environment, terminalId);
  if (terminal?.state !== "paired" || terminal.deviceId === null || terminal.accountId !== ready.row.accountId) throw terminalGone();
  return { gym, ready, deviceId: terminal.deviceId, locationId: ready.row.locationId };
}

/** A press, and once more when the Terminal was busy with a payment that may be over (its page
 *  closed before the worker's minute): Square is asked about that one once, with its own gym's
 *  token. A card save keeping it busy is that save's to finish. */
async function pressFreeing<T extends { kind: string }>(deps: PaymentsDeps, ready: Ready, deviceId: string, press: (now: Date) => Promise<T>): Promise<T> {
  const now = deps.now();
  const written = await press(now);
  if (written.kind !== "terminal_busy") return written;
  const blocking = await pays.claimBlocking(deps.sql, ready.square.environment, ready.row.accountId, deviceId, now, leaseFrom(now));
  if (blocking === null) return written;
  await advance(deps, ready.square, blocking, leaseFrom(now));
  return await press(deps.now());
}

/** Take payment on Terminal at Sell (18d-vi-b-ii): the basket, priced as a sale by hand is, goes to
 *  the chosen Terminal for its total, and is recorded as that sale once Square takes the money. The
 *  same press sent twice is one payment. Whoever may sell may press it: Sell's own tick. */
export async function startTerminalSale(deps: PaymentsDeps, userId: string, gymId: string, body: TerminalSaleRequest): Promise<TerminalPaymentResponse> {
  await requireWritablePrivilege(deps, gymId, userId, BILLING);
  const { gym, ready, deviceId, locationId } = await terminalFor(deps, gymId, body.terminalId);
  const press = (now: Date): Promise<pays.StartSaleOutcome> =>
    pays.startSalePayment(deps.sql, {
      gymId,
      entryId: body.entryId,
      totalMinor: body.totalMinor,
      lines: body.lines,
      environment: ready.square.environment,
      accountId: ready.row.accountId,
      locationId,
      accountCurrency: ready.row.currency,
      deviceId,
      requestKey: body.requestKey,
      checkoutKey: randomUUID(),
      startedBy: userId,
      today: dayInTz(now, gym.timezone),
      now,
      checkingUntil: leaseFrom(now),
    });
  const written = await pressFreeing(deps, ready, deviceId, press);
  switch (written.kind) {
    case "new": {
      const first = await advance(deps, ready.square, written.payment, leaseFrom(deps.now()));
      if (first?.refusal !== undefined && first.done === "refused") throw startRefused(first.refusal);
      return await answer(deps, userId, gymId, { sale: true }, written.payment.id);
    }
    case "same_press":
      return await answer(deps, userId, gymId, { sale: true }, written.payment.id);
    case "terminal_busy":
      throw terminalBusy();
    case "key_reused":
      throw paymentGone();
    case "currency":
      throw new OrgsError(409, "terminal_payment_currency", TERMINAL_PAYMENT_WORDS.sale_currency);
    case "refused":
      throw saleRefused(written.refusal);
    default: {
      const never: never = written;
      throw new Error(`unhandled Terminal sale start: ${JSON.stringify(never)}`);
    }
  }
}

/** Sell's Terminal box (18d-vi-b-ii): whether the gym's Square is ready (or the owner's button to
 *  connect it, and anybody else's line saying who can), its paired Terminals, and the sales waiting
 *  on one, so a page opened again shows them. A gym outside Square's countries is told nothing. */
export async function readTerminalSales(deps: PaymentsDeps, userId: string, gymId: string): Promise<TerminalSalesResponse> {
  await requirePrivilege(deps, gymId, userId, BILLING);
  const gym = await repo.readGym(deps.sql, gymId);
  if (gym === null) throw orgNotFound();
  const square = deps.square;
  const row = square === null ? null : await repo.readConnection(deps.sql, gymId, square.environment);
  const state = stateOf(square, gym, row);
  const isOwner = gym.ownerUserId === userId;
  const usable = square !== null && row !== null && state === "ready" && terminalsOffered(row) && !missingScopes(row);
  const reconnect = row !== null && state === "ready" && terminalsOffered(row) && missingScopes(row);
  const paired = usable ? await pairedTerminals(deps, gymId, square.environment, row.accountId) : [];
  const waitingRows = square === null ? [] : await pays.readWaitingSales(deps.sql, gymId, square.environment);
  const waiting = await Promise.all(waitingRows.map(async (p) => viewOf(p, await pairedTerminals(deps, gymId, p.environment, p.accountId))));
  return terminalSalesResponseSchema.parse({
    square: state,
    isOwner,
    terminals: paired.map((t) => ({ id: t.id, serial: t.serial, practice: t.practice })),
    pairTerminal: usable && isOwner && paired.length === 0,
    reconnect,
    waiting,
  });
}

/** Take payment on Terminal: the amount goes to the chosen Terminal. The same press sent twice is
 *  one payment; one already waiting for the same bill is answered instead of a second. */
async function start(
  deps: PaymentsDeps,
  userId: string,
  gymId: string,
  entryId: string,
  membershipId: string,
  body: TerminalFeePaymentRequest,
  target: pays.PayTarget,
): Promise<TerminalPaymentResponse> {
  const { privileges } = await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  if (!privileges.includes(BILLING)) throw new OrgsError(403, "forbidden", NO_BILLING);
  const { gym, ready, deviceId, locationId } = await terminalFor(deps, gymId, body.terminalId);

  const press = (now: Date): Promise<pays.StartOutcome> =>
    pays.startPayment(deps.sql, {
      gymId,
      entryId,
      membershipId,
      target,
      amountMinor: body.amountMinor,
      environment: ready.square.environment,
      accountId: ready.row.accountId,
      locationId,
      accountCurrency: ready.row.currency,
      deviceId,
      requestKey: body.requestKey,
      checkoutKey: randomUUID(),
      startedBy: userId,
      today: dayInTz(now, gym.timezone),
      now,
      checkingUntil: leaseFrom(now),
    });
  const written = await pressFreeing(deps, ready, deviceId, press);
  switch (written.kind) {
    case "new": {
      const first = await advance(deps, ready.square, written.payment, leaseFrom(deps.now()));
      if (first?.refusal !== undefined && first.done === "refused") throw startRefused(first.refusal);
      return await answer(deps, userId, gymId, { entryId }, written.payment.id);
    }
    case "same_press":
    case "membership_waiting":
      return await answer(deps, userId, gymId, { entryId }, written.payment.id);
    case "terminal_busy":
      throw terminalBusy();
    case "key_reused":
      throw paymentGone();
    case "entry_not_found":
      throw entryNotFound();
    case "membership_not_found":
      throw new OrgsError(404, "held_membership_not_found", "That membership was not found.");
    case "not_allowed":
      throw new OrgsError(409, "held_membership_changed", "This membership has changed since you opened it. Nothing was sent: check it and try again.");
    case "too_much":
      throw new OrgsError(409, "payment_too_much", `That is more than is left to pay. ${formatMinor(written.leftMinor, written.currency)} is left.`);
    case "currency":
      throw new OrgsError(409, "terminal_payment_currency", TERMINAL_PAYMENT_WORDS.currency);
    case "other_waiting":
      throw new OrgsError(409, "terminal_payment_waiting", TERMINAL_PAYMENT_WORDS.waiting);
    case "fee_not_found":
      throw new OrgsError(404, "member_fee_not_found", "That fee was not found.");
    case "fee_changed":
      throw new OrgsError(409, "member_fee_changed", "This fee has changed since you opened it. Nothing was sent: check it and try again.");
    default: {
      const never: never = written;
      throw new Error(`unhandled Terminal payment start: ${JSON.stringify(never)}`);
    }
  }
}

/** Where the payment stands: Square is asked, unless another request is asking right now. */
export async function checkTerminalPayment(deps: PaymentsDeps, userId: string, gymId: string, entryId: string, payId: string): Promise<TerminalPaymentResponse> {
  return await check(deps, userId, gymId, { entryId }, payId);
}

/** Where a sale on the Terminal stands (18d-vi-b-ii). */
export async function checkTerminalSale(deps: PaymentsDeps, userId: string, gymId: string, payId: string): Promise<TerminalPaymentResponse> {
  return await check(deps, userId, gymId, { sale: true }, payId);
}

async function check(deps: PaymentsDeps, userId: string, gymId: string, of: pays.Scope, payId: string): Promise<TerminalPaymentResponse> {
  await requirePrivilege(deps, gymId, userId, BILLING);
  const square = deps.square;
  if (square === null) throw paymentGone();
  const now = deps.now();
  const held = await pays.claimCheck(deps.sql, gymId, of, payId, now, leaseFrom(now));
  if (held !== null) await advance(deps, square, held, leaseFrom(now));
  return await answer(deps, userId, gymId, of, payId);
}

/** Cancel: kept on the payment, then Square is asked to stop the checkout, by this request or, while
 *  another is asking Square, by that one. Square stops it only until the person pays. */
export async function cancelTerminalPayment(deps: PaymentsDeps, userId: string, gymId: string, entryId: string, payId: string): Promise<TerminalPaymentResponse> {
  return await cancel(deps, userId, gymId, { entryId }, payId);
}

/** Cancel a sale on the Terminal (18d-vi-b-ii). */
export async function cancelTerminalSale(deps: PaymentsDeps, userId: string, gymId: string, payId: string): Promise<TerminalPaymentResponse> {
  return await cancel(deps, userId, gymId, { sale: true }, payId);
}

async function cancel(deps: PaymentsDeps, userId: string, gymId: string, of: pays.Scope, payId: string): Promise<TerminalPaymentResponse> {
  await requirePrivilege(deps, gymId, userId, BILLING);
  const square = deps.square;
  if (square === null) throw paymentGone();
  if (!(await pays.wantCancel(deps.sql, gymId, of, payId, deps.now()))) {
    if ((await pays.readPayment(deps.sql, gymId, of, payId)) === null) throw paymentGone();
    return await answer(deps, userId, gymId, of, payId);
  }
  const waitUntil = Date.now() + TERMINAL_PAYMENT.cancelWaitMs;
  for (;;) {
    const now = deps.now();
    const held = await pays.claimCheck(deps.sql, gymId, of, payId, now, leaseFrom(now));
    if (held !== null) {
      await advance(deps, square, held, leaseFrom(now));
      break;
    }
    if (Date.now() >= waitUntil) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return await answer(deps, userId, gymId, of, payId);
}

/** The worker's minute: payments nobody has asked about since a page closed, and done ones to
 *  forget. `gymIds`: only these gyms, for a test sharing its database; production passes null. */
export async function processTerminalPayments(deps: PaymentsDeps, square: SquareSettings, gymIds: readonly string[] | null = null): Promise<{ asked: number; forgotten: number }> {
  let asked = 0;
  while (asked < TERMINAL_PAYMENT.perRun) {
    const at = deps.now();
    const [pay] = await pays.claimIdle(deps.sql, square.environment, at, TERMINAL_PAYMENT.idleMs, leaseFrom(at), 1, gymIds);
    if (pay === undefined) break;
    await advance(deps, square, pay, leaseFrom(at));
    asked += 1;
  }
  const forgotten = await pays.forgetDone(deps.sql, new Date(deps.now().getTime() - TERMINAL_PAYMENT.keepMs), gymIds);
  return { asked, forgotten };
}

