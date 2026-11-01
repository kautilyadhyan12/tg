// REFUND TO CARD (ROADMAP 18d-iv-a; spec Part 3 §14.8; rulings/2026-10-15-18o.md): money given back to the card that paid,
// through Square, from a payment taken on the Square Terminal or charged to the card on file.
//
// THE WORST THING here is a member refunded twice, refunded more than they paid, or the wrong person's or another gym's
// payment refunded. So the payment is read through the gym, the record and the membership the press names; Square is read
// first, and never more is asked for than both the app and Square say is left; a press is one row, under the record's lock,
// and its id is the key Square is asked with, so Square takes it up once however often it is asked (measured 2026-10-30); at
// most one press waits on a bill; and the money is written as given back only on Square's own answer, for exactly this
// amount and this payment. Square keeps no money it was not asked for, and an unanswered press is never sent as a new one.
//
// No answer from Square is asked again with the same key for an hour. How long Square keeps a key is written nowhere (read
// 2026-10-24), so after that the press is ended as one to check in Square, and the box's own read of Square shows anything
// it did. A refund Square takes up reads pending until Square finishes it: most finish "within a few hours", the longest is
// 14 days ("Refund Payments", read 2026-10-30), and the worker reads each on the times below. Square's own messages finish it
// sooner (18d-iv-d-i, `squareMadeRefunds.ts`).
//
// A REFUND ON THE TERMINAL (18d-iv-c). Square marks an Interac debit card's payment as needing the card present: "Interac card
// payments in Canada can only be refunded when the payment card is present" ("Refund Interac Payments", read 2026-10-31). Such a
// press goes to the gym's Terminal and stays `asking` while it waits for the person, so all of the above holds: nothing else is
// refunded on it, and the Terminal takes nothing else. It is asked about every few seconds by the open box and each minute by the
// worker. Nothing is written until Square says COMPLETED and names the refund; a request ends with no money only on Square's CANCELED.
import { randomUUID } from "node:crypto";
import {
  CARD_REFUND_LIMITS,
  CARD_REFUND_TERMINAL_WORDS,
  CARD_REFUND_WORDS,
  cardRefundCheckSchema,
  cardRefundRefusedLine,
  cardRefundResponseSchema,
  cardSeenSchema,
  CARD_REFUND_REASON_WORDS,
  formatMinor,
  REGISTER_WORDS,
  SALE_REFUND_WORDS,
  saleRestockTooManyWords,
  type CardRefundBlock,
  type CardRefundCheck,
  type CardRefundRequest,
  type CardRefundResponse,
  type CardRefundTerminalEnd,
  PLACE_SQUARE_REFUND_WORDS,
  placeSquareRefundResponseSchema,
  type PlaceSquareRefundRequest,
  type SaleCardRefundRequest,
  type SaleWholeCardRefundRequest,
  type SquareRefund,
  type SquareTerminalRefund,
} from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";
import { refundAskingOnBill } from "../memberships/billsSql.js";
import { saleLinesToRefund, saleRefundAsking, type SaleToRefund } from "../register/repo.js";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import { BILLING, connectionRefused, entryNotFound, orgNotFound, readyOrThrow, unavailable, type Ready } from "./cards.js";
import * as refunds from "./cardRefundsRepo.js";
import * as repo from "./repo.js";
import * as sales from "./saleCardRefundsRepo.js";
import { accessContext, terminalsOffered, type PaymentsDeps } from "./service.js";
import type { SquareSettings } from "./settings.js";
import type { SquareResult } from "./square.js";
import { pairedTerminals } from "./terminalPayments.js";
import { SQUARE_PRACTICE_DEVICES } from "./terminals.js";
import * as terminalsRepo from "./terminalsRepo.js";

export const CARD_REFUND = {
  /** One request asks Square about a press at a time, for at most this long. */
  leaseMs: 20_000,
  /** Square not answering: the worker asks again this long after. */
  idleMs: 60_000,
  /** Sent again with its key only this long after it was first sent. */
  resendForMs: 60 * 60_000,
  /** How long after each look a refund still pending is read again; the last for as long as it is pending. */
  lookAfterMs: [60_000, 2 * 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 60 * 60_000],
  perRun: 50,
} as const;

/** A refund on the Terminal (18d-iv-c; "Refund Interac Payments", read 2026-10-31). */
export const TERMINAL_REFUND = {
  /** Square cancels it after this: its own limit, five minutes. */
  deadline: "PT5M",
  deadlineMs: 5 * 60_000,
  /** Still not done this long past Square's own time: Square is asked to cancel it. */
  graceMs: 60_000,
  /** Never on the Terminal's screen this long: it is off or offline, so it is cancelled. */
  notShownMs: 60_000,
  /** Cancel waits this long for a request already asking Square, then leaves its mark for it. */
  cancelWaitMs: 2_000,
  /** Square giving no answer about a request it made: read for a day, as a Terminal payment is. */
  giveUpMs: 24 * 60 * 60_000,
} as const;

/** Square's simulated Terminals take a refund on other device ids ("Sandbox testing", Terminal Interac refunds, read
 *  2026-10-31): each practice Terminal sends its refund to the one that plays its part. */
const PRACTICE_REFUND_DEVICES: Readonly<Record<string, string>> = {
  [SQUARE_PRACTICE_DEVICES.saves]: "f72dfb8e-4d65-4e56-aade-ec3fb8d33291",
  [SQUARE_PRACTICE_DEVICES.interac]: "f72dfb8e-4d65-4e56-aade-ec3fb8d33291",
  [SQUARE_PRACTICE_DEVICES.declines]: SQUARE_PRACTICE_DEVICES.cancels,
};

export const refundDevice = (press: Pick<refunds.RefundPress, "environment">, deviceId: string): string =>
  press.environment === "sandbox" ? (PRACTICE_REFUND_DEVICES[deviceId] ?? deviceId) : deviceId;

const NO_BILLING = "Recording payments isn't part of your role. Ask the owner to turn on \"Record members' payments\" for you.";
const paymentGone = (): OrgsError => new OrgsError(404, "member_payment_not_found", "That payment was not found.");
const refused = (code: string, line: string): OrgsError => new OrgsError(409, code, line);

const leaseFrom = (at: Date): Date => new Date(at.getTime() + CARD_REFUND.leaseMs);
export const lookFrom = (at: Date, looks: number): Date =>
  new Date(at.getTime() + (CARD_REFUND.lookAfterMs[Math.min(looks, CARD_REFUND.lookAfterMs.length - 1)] ?? 3 * 60 * 60_000));

/** Square's code, as a row keeps it. */
const codeOf = (code: string): string => (/^[A-Z0-9_]{1,60}$/.test(code) ? code : "UNKNOWN");

async function allowed(deps: PaymentsDeps, userId: string, gymId: string): Promise<{ timezone: string; ready: Ready }> {
  const { privileges } = await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  if (!privileges.includes(BILLING)) throw new OrgsError(403, "forbidden", NO_BILLING);
  const gym = await repo.readGym(deps.sql, gymId);
  if (gym === null) throw orgNotFound();
  return { timezone: gym.timezone, ready: await readyOrThrow(deps, gymId, gym) };
}

/** The payment, read through the gym, the record and the membership the press names. */
async function theirPayment(deps: PaymentsDeps, gymId: string, entryId: string, membershipId: string, paymentId: string): Promise<refunds.PaymentToRefund> {
  const payment = await refunds.readPaymentToRefund(deps.sql, gymId, entryId, membershipId, paymentId);
  if (payment === null) throw paymentGone();
  if (payment.provider !== "square" || payment.squarePaymentId === null) throw refused("card_refund_not_card", CARD_REFUND_WORDS.not_card);
  return payment;
}

/** What Square says of the payment, on the app's own figures: the card, what is left, and what stops a refund. `payment`:
 *  what Square was paid, what the app says can still go back, and what stands refunded on all of that payment. `waiting`:
 *  whether a press has no answer yet on what shares this payment. */
async function checkWithSquare(
  deps: PaymentsDeps,
  ready: Ready,
  payment: { amountMinor: number; currency: string; refundableMinor: number; refundedMinor: number },
  squarePaymentId: string,
  waiting: () => Promise<boolean>,
  waitingPress: () => Promise<refunds.RefundPress | null>,
): Promise<CardRefundCheck> {
  const stopped = (block: CardRefundBlock, card: CardRefundCheck["card"] = null): CardRefundCheck => ({ card, leftMinor: 0, refundedInSquareMinor: 0, block, onTerminal: false, terminals: [], waitingPress: null });
  const read = await ready.square.api.getPayment(ready.token, squarePaymentId);
  if (read.kind === "unavailable") throw unavailable();
  if (read.kind === "refused") {
    if (read.status === 401) throw connectionRefused();
    // A token reaches only its own account: a payment it cannot find was taken in another.
    return stopped(read.status === 404 ? "other_account" : "differs");
  }
  const square = read.value;
  const seen = cardSeenSchema.safeParse({ brand: square.card_details?.card?.card_brand, last4: square.card_details?.card?.last_4 });
  const card = seen.success ? seen.data : null;
  const total = square.total_money ?? square.amount_money;
  if (square.status !== "COMPLETED") return stopped("not_finished", card);
  if (total.amount !== payment.amountMinor || total.currency !== payment.currency) return stopped("differs", card);
  const takenAt = square.created_at == null ? null : new Date(square.created_at).getTime();
  if (takenAt !== null && deps.now().getTime() - takenAt > CARD_REFUND_LIMITS.daysToRefund * 24 * 60 * 60_000) return stopped("too_old", card);
  const inSquare = square.refunded_money?.amount ?? 0;
  const leftMinor = Math.max(0, Math.min(payment.refundableMinor, total.amount - inSquare));
  const refundedInSquareMinor = Math.max(0, inSquare - payment.refundedMinor);
  // Square's own mark on the payment decides, never the card's name or the gym's country.
  const onTerminal = square.card_details?.refund_requires_card_presence === true;
  const terminals = onTerminal && terminalsOffered(ready.row) ? (await pairedTerminals(deps, ready.row.gymId, ready.square.environment, ready.row.accountId)).map((t) => ({ id: t.id, serial: t.serial, practice: t.practice })) : [];
  const base = { card, leftMinor, refundedInSquareMinor, onTerminal, terminals };
  if (await waiting()) {
    const press = await waitingPress();
    return { ...base, block: "waiting", waitingPress: press === null ? null : await viewOfPress(deps, press) };
  }
  return { ...base, block: leftMinor === 0 ? "nothing_left" : null, waitingPress: null };
}

/** The Terminal the press names: one of the gym's, paired in the account it is connected to now. Null where Square does not
 *  need the card present. */
async function deviceFor(deps: PaymentsDeps, ready: Ready, check: CardRefundCheck, terminalId: string | undefined): Promise<string | null> {
  if (!check.onTerminal) return null;
  if (!terminalsOffered(ready.row)) throw refused("terminals_not_offered", CARD_REFUND_TERMINAL_WORDS.not_offered);
  if (terminalId === undefined) throw refused("card_refund_pick_terminal", CARD_REFUND_TERMINAL_WORDS.pick);
  const terminal = await terminalsRepo.readTerminal(deps.sql, ready.row.gymId, ready.square.environment, terminalId);
  if (terminal?.state !== "paired" || terminal.deviceId === null || terminal.accountId !== ready.row.accountId) {
    throw new OrgsError(404, "terminal_gone", CARD_REFUND_TERMINAL_WORDS.terminal_gone);
  }
  return terminal.deviceId;
}

/** The box opens: what Square says of this payment now. */
export async function readCardRefund(deps: PaymentsDeps, userId: string, gymId: string, entryId: string, membershipId: string, paymentId: string): Promise<CardRefundCheck> {
  const { ready } = await allowed(deps, userId, gymId);
  const payment = await theirPayment(deps, gymId, entryId, membershipId, paymentId);
  return cardRefundCheckSchema.parse(await checkOfPayment(deps, ready, payment));
}

const checkOfPayment = (deps: PaymentsDeps, ready: Ready, payment: refunds.PaymentToRefund): Promise<CardRefundCheck> =>
  checkWithSquare(deps, ready, payment, payment.squarePaymentId ?? "", () => refundAskingOnBill(deps.sql, ready.row.gymId, payment.billId), () => refunds.waitingOnTerminalOfBill(deps.sql, ready.row.gymId, payment.billId));

type Step = "taken" | "completed" | "refused" | "failed" | "lost" | null;

/** Square's answer to the press, and what follows from it. Null while Square has not answered. */
async function answered(deps: PaymentsDeps, press: refunds.RefundPress, result: SquareResult<SquareRefund>, now: Date): Promise<Step> {
  if (result.kind === "unavailable") return null;
  if (result.kind === "refused") {
    deps.log.warn({ event: "square.card_refund_refused", gymId: press.gymId, status: result.status, code: result.code }, "Square refused a refund");
    // Asked before with no answer: Square may have taken it up then, and a refusal now says nothing of that.
    if (press.checkedAt.getTime() > press.startedAt.getTime()) {
      await refunds.endAsking(deps.sql, press, { outcome: "lost", code: codeOf(result.code) }, now);
      return "lost";
    }
    await refunds.endAsking(deps.sql, press, { outcome: "refused", code: codeOf(result.code) }, now);
    return "refused";
  }
  const refund = result.value;
  if (refund.payment_id !== press.squarePaymentId || refund.amount_money.amount !== press.amountMinor || refund.amount_money.currency !== press.currency) {
    deps.log.error({ event: "square.card_refund_unexpected", gymId: press.gymId }, "Square answered a refund with another refund");
    await refunds.endAsking(deps.sql, press, { outcome: "lost", code: "NOT_OURS" }, now);
    return "lost";
  }
  const gym = await repo.readGym(deps.sql, press.gymId);
  const today = dayInTz(now, gym?.timezone ?? "UTC");
  const taken = { squareRefundId: refund.id, today, now, lookAt: lookFrom(now, 0) };
  await (press.saleId === null ? refunds.recordTaken(deps.sql, press, taken) : sales.recordSaleTaken(deps.sql, press, taken));
  return await afterTaken(deps, press, refund, today, now);
}

/** A refund Square has taken up, by what it says now. */
export async function afterTaken(deps: PaymentsDeps, press: refunds.RefundPress, refund: SquareRefund, today: string, now: Date): Promise<Step> {
  if (refund.status === "COMPLETED") {
    await refunds.endCompleted(deps.sql, press, now);
    return "completed";
  }
  if (refund.status === "FAILED" || refund.status === "REJECTED") {
    deps.log.warn({ event: "square.card_refund_failed", gymId: press.gymId, status: refund.status }, "Square could not refund a card");
    const failed = { code: codeOf(refund.status), today, now };
    await (press.saleId === null ? refunds.recordFailed(deps.sql, press, failed) : sales.recordSaleFailed(deps.sql, press, failed));
    return "failed";
  }
  return "taken";
}

/** The gym's token for the Square account the press was made in, while it is connected to it. */
export async function tokenFor(deps: PaymentsDeps, square: SquareSettings, press: refunds.RefundPress): Promise<string | null> {
  const row = await repo.readConnection(deps.sql, press.gymId, square.environment);
  if (row?.state !== "connected" || row.accountId !== press.accountId || row.accessToken === null) return null;
  return square.tokens.open(row.accessToken, accessContext(press.gymId));
}

/** Square's request is the one this press made. The press's own key ties them; how Square writes a Terminal's id is not read. */
const isOurRefund = (press: refunds.RefundPress, refund: SquareTerminalRefund): boolean =>
  refund.payment_id === press.squarePaymentId && refund.amount_money.amount === press.amountMinor && refund.amount_money.currency === press.currency;

/** No clear answer from Square. A press it never answered is asked again with its key for an hour; a request it made is read
 *  for a day, as the money may go meanwhile, or until Square's own time is past where Square refuses to show it. Then it is
 *  left to check in Square. */
async function terminalNotYet(deps: PaymentsDeps, press: refunds.RefundPress, now: Date, why: "refused" | "unavailable" | "completed"): Promise<void> {
  // Square said it finished: the money has gone, so its refund is read for a day.
  const limit = why === "completed" ? TERMINAL_REFUND.giveUpMs : why === "refused" ? TERMINAL_REFUND.deadlineMs + TERMINAL_REFUND.graceMs : press.terminalRefundId === null ? CARD_REFUND.resendForMs : TERMINAL_REFUND.giveUpMs;
  if (now.getTime() <= press.startedAt.getTime() + limit) return;
  deps.log.error({ event: "square.terminal_refund_unchecked", gymId: press.gymId, why }, "a refund on the Terminal could not be read from Square past its time");
  await refunds.endAsking(deps.sql, press, { outcome: "lost", code: null }, now);
}

/** Why the press should be stopped now, if it should: Cancel was pressed, it never reached the Terminal, or Square's time is past. */
function stopFor(press: refunds.RefundPress, refund: SquareTerminalRefund, now: Date): string | null {
  if (press.cancelWantedAt !== null) return "SELLER_CANCELED";
  if (refund.status === "PENDING" && !press.pickedUp && now.getTime() > press.startedAt.getTime() + TERMINAL_REFUND.notShownMs) return "NOT_SHOWN";
  if (now.getTime() > press.startedAt.getTime() + TERMINAL_REFUND.deadlineMs + TERMINAL_REFUND.graceMs) return "TIMED_OUT";
  return null;
}

/** One look at Square for a press on the Terminal. The money stands as given back only on Square's own COMPLETED, for this
 *  payment and amount, with the refund it names read and agreeing; it ends with none only on Square's own CANCELED. */
async function terminalStep(deps: PaymentsDeps, token: string, square: SquareSettings, press: refunds.RefundPress, deviceId: string, now: Date): Promise<void> {
  const got =
    press.terminalRefundId === null
      ? await square.api.createTerminalRefund(token, {
          idempotencyKey: press.id,
          deviceId: refundDevice(press, deviceId),
          paymentId: press.squarePaymentId,
          amountMinor: press.amountMinor,
          currency: press.currency,
          reason: CARD_REFUND_REASON_WORDS[press.reason],
          deadline: TERMINAL_REFUND.deadline,
        })
      : await square.api.getTerminalRefund(token, press.terminalRefundId);
  if (got.kind === "unavailable") {
    await terminalNotYet(deps, press, now, "unavailable");
    return;
  }
  if (got.kind === "refused") {
    if (press.terminalRefundId === null) await answered(deps, press, got, now);
    else await terminalNotYet(deps, press, now, "refused");
    return;
  }
  const refund = got.value;
  if (!isOurRefund(press, refund) || (press.terminalRefundId !== null && refund.id !== press.terminalRefundId)) {
    deps.log.error({ event: "square.terminal_refund_unexpected", gymId: press.gymId }, "Square answered a refund on the Terminal with another");
    // Never left live on the Terminal: ending the press frees the payment for a second refund.
    if (refund.status !== "COMPLETED" && refund.status !== "CANCELED") {
      const stopped = await square.api.cancelTerminalRefund(token, press.terminalRefundId ?? refund.id);
      if (!(stopped.kind === "ok" && stopped.value.status === "CANCELED") && now.getTime() <= press.startedAt.getTime() + TERMINAL_REFUND.giveUpMs) return;
    }
    await refunds.endAsking(deps.sql, press, { outcome: "lost", code: "NOT_OURS" }, now);
    return;
  }
  if (press.terminalRefundId === null) {
    await refunds.setTerminalRefund(deps.sql, press, refund.id);
    press.terminalRefundId = refund.id;
  }
  if (!press.pickedUp && (refund.status === "IN_PROGRESS" || refund.status === "COMPLETED")) {
    await refunds.setPickedUp(deps.sql, press);
    press.pickedUp = true;
  }
  await terminalFollow(deps, token, square, press, refund, now);
}

/** What Square's answer about the request means for the press. */
async function terminalFollow(deps: PaymentsDeps, token: string, square: SquareSettings, press: refunds.RefundPress, refund: SquareTerminalRefund, now: Date): Promise<void> {
  if (refund.status === "COMPLETED") {
    if (refund.refund_id == null) {
      await terminalNotYet(deps, press, now, "completed");
      return;
    }
    const read = await square.api.getRefund(token, refund.refund_id);
    if (read.kind === "ok") await answered(deps, press, read, now);
    else await terminalNotYet(deps, press, now, "completed");
    return;
  }
  if (refund.status === "CANCELED") {
    await refunds.endAsking(deps.sql, press, { outcome: "cancelled", code: codeOf(refund.cancel_reason ?? "CANCELED") }, now);
    return;
  }
  // Square promises an end only for a request still PENDING. Any other that never ends, a status it adds later among them, is
  // left to check in Square, so it holds neither the Terminal nor the bill for good.
  if (now.getTime() > press.startedAt.getTime() + TERMINAL_REFUND.giveUpMs) {
    deps.log.error({ event: "square.terminal_refund_no_end", gymId: press.gymId, status: refund.status }, "a refund on the Terminal had no end from Square past its time");
    await square.api.cancelTerminalRefund(token, refund.id);
    await refunds.endAsking(deps.sql, press, { outcome: "lost", code: "NO_END" }, now);
    return;
  }
  const why = stopFor(press, refund, now);
  if (why === null || refund.status === "CANCEL_REQUESTED") return;
  const cancel = await square.api.cancelTerminalRefund(token, refund.id);
  if (cancel.kind === "ok" && cancel.value.status === "CANCELED") {
    await refunds.endAsking(deps.sql, press, { outcome: "cancelled", code: why }, now);
    return;
  }
  // Too late: Square refused it and the person has started, so it finishes there. Square names no code for this. Anything else: the next look decides.
  if (cancel.kind === "refused" && cancel.status !== 401 && refund.status === "IN_PROGRESS" && press.cancelWantedAt !== null) await refunds.cancelRefusedTooLate(deps.sql, press);
}

/** Ask Square about a press on the Terminal that this request holds, then let it go. */
async function advanceTerminal(deps: PaymentsDeps, square: SquareSettings, press: refunds.RefundPress, deviceId: string, token: string | null): Promise<void> {
  try {
    const now = deps.now();
    if (token === null) {
      deps.log.warn({ event: "square.terminal_refund_unfollowed", gymId: press.gymId }, "a refund on the Terminal lost its Square connection while it waited");
      await refunds.endAsking(deps.sql, press, { outcome: "lost", code: null }, now);
      return;
    }
    await terminalStep(deps, token, square, press, deviceId, now);
  } finally {
    await refunds.release(deps.sql, press);
  }
}

/** Ask Square for the refund with its key, then let the press go. */
async function ask(deps: PaymentsDeps, token: string, square: SquareSettings, press: refunds.RefundPress): Promise<Step> {
  if (press.deviceId !== null) {
    await advanceTerminal(deps, square, press, press.deviceId, token);
    return null;
  }
  try {
    const result = await square.api.refundPayment(token, {
      idempotencyKey: press.id,
      paymentId: press.squarePaymentId,
      amountMinor: press.amountMinor,
      currency: press.currency,
      // What the gym's Square Dashboard lists it as: the word picked, never the person.
      reason: CARD_REFUND_REASON_WORDS[press.reason],
    });
    return await answered(deps, press, result, deps.now());
  } finally {
    await refunds.release(deps.sql, press);
  }
}

/** How a press on the Terminal ended with no money, from the code it ended on. */
function endOf(press: refunds.RefundPress): CardRefundTerminalEnd | null {
  if (press.outcome !== "cancelled") return null;
  if (press.code === "BUYER_CANCELED") return "cancelled_on_terminal";
  if (press.code === "NOT_SHOWN") return "no_answer";
  if (press.code === "TIMED_OUT") return press.pickedUp ? "timed_out" : "no_answer";
  return "cancelled";
}

/** What a press says as it stands: never an error, for a box reopened on it. */
async function viewOfPress(deps: PaymentsDeps, press: refunds.RefundPress): Promise<CardRefundResponse> {
  const card = press.brand === null || press.last4 === null ? null : { brand: press.brand, last4: press.last4 };
  const asking = press.state === "asking" && press.deviceId !== null;
  const step = press.outcome === "completed" ? "completed" : press.outcome === "cancelled" ? "ended" : press.outcome === "lost" ? "lost" : press.state === "pending" ? "pending" : asking ? "terminal" : "checking";
  const paired = press.deviceId === null ? [] : await pairedTerminals(deps, press.gymId, press.environment, press.accountId);
  const terminal = paired.find((t) => t.deviceId === press.deviceId);
  const onTerminal =
    press.deviceId === null
      ? null
      : {
          terminal: terminal === undefined ? null : { id: terminal.id, serial: terminal.serial, practice: terminal.practice },
          pickedUp: press.pickedUp,
          stopping: asking && press.cancelWantedAt !== null,
          tooLate: asking && press.cancelTooLate,
          ended: endOf(press),
        };
  return cardRefundResponseSchema.parse({ step, amountMinor: press.amountMinor, currency: press.currency, card, pressId: press.id, onTerminal });
}

/** What the press says, read from the row as it now stands. */
async function answer(deps: PaymentsDeps, gymId: string, id: string): Promise<CardRefundResponse> {
  const press = await refunds.readPress(deps.sql, gymId, id);
  if (press === null) throw paymentGone();
  if (press.outcome === "refused") {
    if (press.code === "UNAUTHORIZED") throw connectionRefused();
    throw refused("card_refund_refused", cardRefundRefusedLine(press.code));
  }
  if (press.outcome === "failed") throw refused("card_refund_failed", CARD_REFUND_WORDS.failed);
  return await viewOfPress(deps, press);
}

/** The press, for whoever may refund what it refunds. */
async function pressOf(deps: PaymentsDeps, userId: string, gymId: string, id: string, write: boolean): Promise<refunds.RefundPress> {
  const { privileges } = write ? await requireWritablePrivilege(deps, gymId, userId, BILLING) : await requirePrivilege(deps, gymId, userId, BILLING);
  const press = await refunds.readPress(deps.sql, gymId, id);
  if (press === null) throw paymentGone();
  if (press.saleId === null && !privileges.includes("members.confirm")) throw new OrgsError(403, "forbidden", NO_BILLING);
  return press;
}

/** Where a press on the Terminal stands: Square is asked, unless another request is asking right now. */
export async function checkCardRefund(deps: PaymentsDeps, userId: string, gymId: string, pressId: string): Promise<CardRefundResponse> {
  const press = await pressOf(deps, userId, gymId, pressId, false);
  const square = deps.square;
  if (square !== null) await lookOnce(deps, square, gymId, press.id);
  return await answer(deps, gymId, press.id);
}

/** One look at a press this request gets to hold; false while another holds it, or once it has ended. */
async function lookOnce(deps: PaymentsDeps, square: SquareSettings, gymId: string, id: string): Promise<boolean> {
  const now = deps.now();
  const held = await refunds.claimPress(deps.sql, gymId, id, now, leaseFrom(now));
  if (held?.deviceId == null) return false;
  await advanceTerminal(deps, square, held, held.deviceId, await tokenFor(deps, square, held));
  return true;
}

/** Cancel: kept on the press, then Square is asked to stop it, by this request or, while another is asking Square, by that one.
 *  Square stops it only until the person starts. */
export async function cancelCardRefund(deps: PaymentsDeps, userId: string, gymId: string, pressId: string): Promise<CardRefundResponse> {
  const press = await pressOf(deps, userId, gymId, pressId, true);
  const square = deps.square;
  if (square === null || !(await refunds.wantCancel(deps.sql, gymId, press.id, deps.now()))) return await answer(deps, gymId, press.id);
  const waitUntil = Date.now() + TERMINAL_REFUND.cancelWaitMs;
  while (!(await lookOnce(deps, square, gymId, press.id)) && Date.now() < waitUntil) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return await answer(deps, gymId, press.id);
}

/** A press: the money goes back now, and the answer says where it stands. The same press sent twice is one refund. */
export async function refundToCard(
  deps: PaymentsDeps,
  userId: string,
  gymId: string,
  entryId: string,
  membershipId: string,
  paymentId: string,
  body: CardRefundRequest,
): Promise<CardRefundResponse> {
  const { ready } = await allowed(deps, userId, gymId);
  const before = await refunds.pressOfKey(deps.sql, gymId, body.requestKey);
  if (before !== null) {
    if (before.paymentId !== paymentId || before.amountMinor !== body.amountMinor || before.reason !== body.reason) throw refused("card_refund_key_reused", CARD_REFUND_WORDS.key_reused);
    return await answer(deps, gymId, before.id);
  }
  const payment = await theirPayment(deps, gymId, entryId, membershipId, paymentId);
  const check = await checkOfPayment(deps, ready, payment);
  if (check.block !== null) throw refused(`card_refund_${check.block}`, CARD_REFUND_WORDS[check.block]);
  if (body.amountMinor > check.leftMinor) {
    throw refused("card_refund_too_much", `That is more than can be refunded. ${formatMinor(check.leftMinor, payment.currency)} is the most.`);
  }
  const deviceId = await deviceFor(deps, ready, check, body.terminalId);
  const now = deps.now();
  const written = await refunds.startRefund(deps.sql, {
    id: randomUUID(),
    gymId,
    entryId,
    membershipId,
    paymentId,
    requestKey: body.requestKey,
    amountMinor: body.amountMinor,
    reason: body.reason,
    squareLeftMinor: check.leftMinor,
    card: check.card,
    environment: ready.square.environment,
    accountId: ready.row.accountId,
    deviceId,
    startedBy: userId,
    now,
    checkingUntil: leaseFrom(now),
  });
  switch (written.kind) {
    case "new":
      await ask(deps, ready.token, ready.square, written.press);
      return await answer(deps, gymId, written.press.id);
    case "same_press":
      return await answer(deps, gymId, written.press.id);
    case "key_reused":
      throw refused("card_refund_key_reused", CARD_REFUND_WORDS.key_reused);
    case "terminal_busy":
      throw refused("terminal_busy", CARD_REFUND_TERMINAL_WORDS.terminal_busy);
    case "entry_not_found":
      throw entryNotFound();
    case "membership_not_found":
      throw new OrgsError(404, "held_membership_not_found", "That membership was not found.");
    case "payment_not_found":
      throw paymentGone();
    case "not_card":
      throw refused("card_refund_not_card", CARD_REFUND_WORDS.not_card);
    case "waiting":
      throw refused("card_refund_waiting", CARD_REFUND_WORDS.waiting);
    case "not_settled":
      throw refused("refund_not_settled", "This bill isn't fully paid, so there is nothing to refund yet.");
    case "too_much":
      throw refused("card_refund_too_much", `That is more than can be refunded. ${formatMinor(written.leftMinor, written.currency)} is the most.`);
  }
}

/** Who may send a sale's money back: whoever may take it at Sell (Kd, 2026-10-31), at a gym that can be changed. */
async function allowedAtSell(deps: PaymentsDeps, userId: string, gymId: string): Promise<Ready> {
  await requireWritablePrivilege(deps, gymId, userId, BILLING);
  const gym = await repo.readGym(deps.sql, gymId);
  if (gym === null) throw orgNotFound();
  return await readyOrThrow(deps, gymId, gym);
}

const saleGone = (): OrgsError => new OrgsError(404, "sale_not_found", REGISTER_WORDS.sale_not_found);

/** Every product of a sale paid on the Terminal, read through the gym, with what all of its one Square payment holds. */
async function theirSaleLines(deps: PaymentsDeps, gymId: string, saleId: string): Promise<[SaleToRefund, ...SaleToRefund[]]> {
  const lines = await saleLinesToRefund(deps.sql, gymId, saleId);
  const [first, ...rest] = lines;
  if (first === undefined) throw saleGone();
  if (first.squarePaymentId === null) throw refused("card_refund_not_card", CARD_REFUND_WORDS.not_card);
  if (first.undone) throw refused("sale_voided", SALE_REFUND_WORDS.voided);
  return [first, ...rest];
}

const theirSale = async (deps: PaymentsDeps, gymId: string, saleId: string): Promise<SaleToRefund> => {
  const line = (await theirSaleLines(deps, gymId, saleId)).find((l) => l.saleId === saleId);
  if (line === undefined) throw saleGone();
  return line;
};

/** A refund made in Square waiting on its product stops this box: staff say which first, so nothing is sent or noted against the wrong one. */
const checkOfSale = async (deps: PaymentsDeps, ready: Ready, sale: SaleToRefund): Promise<CardRefundCheck> => {
  const paymentId = sale.squarePaymentId ?? "";
  const check = await checkWithSquare(deps, ready, sale, paymentId, () => saleRefundAsking(deps.sql, ready.row.gymId, sale.saleId), () => refunds.waitingOnTerminal(deps.sql, ready.row.gymId, paymentId));
  const toPlace = await sales.toPlaceOn(deps.sql, ready.row.gymId, paymentId);
  if (toPlace === 0) return check;
  return { ...check, refundedInSquareMinor: Math.max(0, check.refundedInSquareMinor - toPlace), block: check.block === "waiting" ? "waiting" : "to_place" };
};

/** What Square says of all that is left of a sale: nothing goes back at once where Square shows less left than the app does. */
async function checkOfWholeSale(deps: PaymentsDeps, ready: Ready, lines: readonly [SaleToRefund, ...SaleToRefund[]]): Promise<CardRefundCheck> {
  const [first] = lines;
  const refundableMinor = lines.reduce((n, l) => n + l.refundableMinor, 0);
  const check = await checkOfSale(deps, ready, { ...first, refundableMinor });
  return check.block === null && check.leftMinor < refundableMinor ? { ...check, block: "less_in_square" } : check;
}

/** The box opens on one product of a sale paid on the Terminal (18d-iv-b-ii): what Square says of its payment now. */
export async function readSaleCardRefund(deps: PaymentsDeps, userId: string, gymId: string, saleId: string): Promise<CardRefundCheck> {
  const ready = await allowedAtSell(deps, userId, gymId);
  return cardRefundCheckSchema.parse(await checkOfSale(deps, ready, await theirSale(deps, gymId, saleId)));
}

/** A press on one product of a sale: the money goes back now. The same press sent twice is one refund. */
export async function refundSaleToCard(deps: PaymentsDeps, userId: string, gymId: string, saleId: string, body: SaleCardRefundRequest): Promise<CardRefundResponse> {
  const ready = await allowedAtSell(deps, userId, gymId);
  const before = await refunds.pressOfKey(deps.sql, gymId, body.requestKey);
  if (before !== null) {
    if (!sales.samePress(before, saleId, body)) throw refused("card_refund_key_reused", SALE_REFUND_WORDS.key_reused);
    return await answer(deps, gymId, before.id);
  }
  const sale = await theirSale(deps, gymId, saleId);
  const check = await checkOfSale(deps, ready, sale);
  if (check.block !== null) throw refused(`card_refund_${check.block}`, CARD_REFUND_WORDS[check.block]);
  if (body.amountMinor > check.leftMinor) {
    throw refused("card_refund_too_much", `That is more than can be refunded. ${formatMinor(check.leftMinor, sale.currency)} is the most.`);
  }
  const deviceId = await deviceFor(deps, ready, check, body.terminalId);
  const now = deps.now();
  const written = await sales.startSaleRefund(deps.sql, {
    id: randomUUID(),
    gymId,
    saleId,
    requestKey: body.requestKey,
    amountMinor: body.amountMinor,
    reason: body.reason,
    restock: body.restock,
    squareLeftMinor: check.leftMinor,
    card: check.card,
    environment: ready.square.environment,
    accountId: ready.row.accountId,
    deviceId,
    startedBy: userId,
    now,
    checkingUntil: leaseFrom(now),
  });
  switch (written.kind) {
    case "new":
      await ask(deps, ready.token, ready.square, written.press);
      return await answer(deps, gymId, written.press.id);
    case "same_press":
      return await answer(deps, gymId, written.press.id);
    case "key_reused":
      throw refused("card_refund_key_reused", SALE_REFUND_WORDS.key_reused);
    case "terminal_busy":
      throw refused("terminal_busy", CARD_REFUND_TERMINAL_WORDS.terminal_busy);
    case "sale_not_found":
      throw saleGone();
    case "not_card":
      throw refused("card_refund_not_card", CARD_REFUND_WORDS.not_card);
    case "voided":
      throw refused("sale_voided", SALE_REFUND_WORDS.voided);
    case "waiting":
      throw refused("card_refund_waiting", SALE_REFUND_WORDS.waiting);
    case "too_much":
      throw refused("card_refund_too_much", `That is more than can be refunded. ${formatMinor(written.leftMinor, written.currency)} is the most.`);
    case "too_many_back":
      throw refused("restock_too_many", saleRestockTooManyWords(written.leftCount));
    case "not_counted":
      throw refused("restock_not_counted", SALE_REFUND_WORDS.not_counted);
  }
}

/** The box opens on all of a sale paid on the Terminal. */
export async function readWholeSaleCardRefund(deps: PaymentsDeps, userId: string, gymId: string, saleId: string): Promise<CardRefundCheck> {
  const ready = await allowedAtSell(deps, userId, gymId);
  return cardRefundCheckSchema.parse(await checkOfWholeSale(deps, ready, await theirSaleLines(deps, gymId, saleId)));
}

/** A press on all of a sale: one refund at Square, for all that is left, written against each product. */
export async function refundWholeSaleToCard(deps: PaymentsDeps, userId: string, gymId: string, saleId: string, body: SaleWholeCardRefundRequest): Promise<CardRefundResponse> {
  const ready = await allowedAtSell(deps, userId, gymId);
  const before = await refunds.pressOfKey(deps.sql, gymId, body.requestKey);
  if (before !== null) {
    if (!sales.sameWholePress(before, await saleLinesToRefund(deps.sql, gymId, saleId), body)) throw refused("card_refund_key_reused", SALE_REFUND_WORDS.key_reused);
    return await answer(deps, gymId, before.id);
  }
  const lines = await theirSaleLines(deps, gymId, saleId);
  const check = await checkOfWholeSale(deps, ready, lines);
  if (check.block !== null) throw refused(`card_refund_${check.block}`, CARD_REFUND_WORDS[check.block]);
  const deviceId = await deviceFor(deps, ready, check, body.terminalId);
  const now = deps.now();
  const written = await sales.startWholeSaleRefund(deps.sql, {
    id: randomUUID(),
    gymId,
    saleId,
    requestKey: body.requestKey,
    amountMinor: body.amountMinor,
    reason: body.reason,
    shelf: body.shelf,
    squareLeftMinor: check.leftMinor,
    card: check.card,
    environment: ready.square.environment,
    accountId: ready.row.accountId,
    deviceId,
    startedBy: userId,
    now,
    checkingUntil: leaseFrom(now),
  });
  switch (written.kind) {
    case "new":
      await ask(deps, ready.token, ready.square, written.press);
      return await answer(deps, gymId, written.press.id);
    case "same_press":
      return await answer(deps, gymId, written.press.id);
    case "key_reused":
      throw refused("card_refund_key_reused", SALE_REFUND_WORDS.key_reused);
    case "terminal_busy":
      throw refused("terminal_busy", CARD_REFUND_TERMINAL_WORDS.terminal_busy);
    case "sale_not_found":
      throw saleGone();
    case "not_card":
      throw refused("card_refund_not_card", CARD_REFUND_WORDS.not_card);
    case "voided":
      throw refused("sale_voided", SALE_REFUND_WORDS.voided);
    case "waiting":
      throw refused("card_refund_waiting", SALE_REFUND_WORDS.waiting);
    case "changed":
      throw refused("sale_refund_changed", SALE_REFUND_WORDS.changed);
    case "too_many_back":
      throw refused("restock_too_many", saleRestockTooManyWords(written.leftCount));
    case "not_counted":
      throw refused("restock_not_counted", SALE_REFUND_WORDS.not_counted);
  }
}

export interface CardRefundRun {
  /** Presses Square was asked about again, and refunds read for where they stand. */
  asked: number;
  looked: number;
}

/** The worker's minute: presses Square has not answered, then refunds still pending. `gymIds`: only these gyms, for a test
 *  sharing its database; production passes null. */
export async function processCardRefunds(deps: PaymentsDeps, square: SquareSettings, gymIds: readonly string[] | null = null): Promise<CardRefundRun> {
  const run: CardRefundRun = { asked: 0, looked: 0 };
  while (run.asked < CARD_REFUND.perRun) {
    const at = deps.now();
    const [press] = await refunds.claimAsking(deps.sql, square.environment, at, CARD_REFUND.idleMs, leaseFrom(at), 1, gymIds);
    if (press === undefined) break;
    run.asked += 1;
    const token = await tokenFor(deps, square, press);
    if (press.deviceId !== null) {
      await advanceTerminal(deps, square, press, press.deviceId, token);
      continue;
    }
    if (token === null || at.getTime() - press.startedAt.getTime() > CARD_REFUND.resendForMs) {
      deps.log.warn({ event: "square.card_refund_lost", gymId: press.gymId }, "a refund Square never answered is left to check in Square");
      await refunds.endAsking(deps.sql, press, { outcome: "lost", code: null }, at);
      continue;
    }
    await ask(deps, token, square, press);
  }
  while (run.looked < CARD_REFUND.perRun) {
    const at = deps.now();
    const [press] = await refunds.claimLooks(deps.sql, square.environment, at, leaseFrom(at), 1, gymIds);
    if (press === undefined || press.squareRefundId === null) break;
    run.looked += 1;
    const token = await tokenFor(deps, square, press);
    const read = token === null ? null : await square.api.getRefund(token, press.squareRefundId);
    if (read?.kind === "ok") {
      const gym = await repo.readGym(deps.sql, press.gymId);
      const step = await afterTaken(deps, press, read.value, dayInTz(at, gym?.timezone ?? "UTC"), at);
      if (step !== "taken") continue;
    } else {
      deps.log.warn({ event: "square.card_refund_unread", gymId: press.gymId, answer: read?.kind ?? "no_connection", status: read === null ? null : read.status }, "a refund could not be read from Square");
    }
    await refunds.lookAgain(deps.sql, press, lookFrom(at, press.looks + 1));
  }
  return run;
}

/** Staff say which product a refund made in Square was for (18d-iv-d-ii). Whoever may sell, with Square connected or not: the money has gone. */
export async function placeSquareRefund(deps: PaymentsDeps, userId: string, gymId: string, saleId: string, pressId: string, body: PlaceSquareRefundRequest): Promise<{ receiptNumbers: number[] }> {
  await requireWritablePrivilege(deps, gymId, userId, BILLING);
  const placed = await sales.placeSaleRefund(deps.sql, { gymId, saleId, pressId, parts: body.parts, actorUserId: userId, now: deps.now() });
  switch (placed.kind) {
    case "ok":
      return placeSquareRefundResponseSchema.parse({ receiptNumbers: placed.receiptNumbers });
    case "not_found":
    case "not_on_sale":
      throw saleGone();
    case "waiting":
      throw refused("card_refund_waiting", SALE_REFUND_WORDS.waiting);
    case "changed":
      throw refused("place_refund_changed", PLACE_SQUARE_REFUND_WORDS.changed);
    case "wrong_total":
      throw refused("place_refund_wrong_total", PLACE_SQUARE_REFUND_WORDS.wrong_total);
    case "too_much":
      throw refused("place_refund_too_much", PLACE_SQUARE_REFUND_WORDS.too_much);
    case "too_many_back":
      throw refused("restock_too_many", PLACE_SQUARE_REFUND_WORDS.too_many_back);
  }
}
