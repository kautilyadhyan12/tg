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
// 14 days ("Refund Payments", read 2026-10-30), and the worker reads each on the times below. Square's own messages about a
// refund are not needed for that, and come with 18d-iv-d.
import { randomUUID } from "node:crypto";
import {
  CARD_REFUND_LIMITS,
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
  type SaleCardRefundRequest,
  type SquareRefund,
} from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";
import { refundAskingOnBill } from "../memberships/billsSql.js";
import { saleRefundAsking } from "../register/repo.js";
import { OrgsError, requireWritablePrivilege } from "../service.js";
import { BILLING, connectionRefused, entryNotFound, orgNotFound, readyOrThrow, unavailable, type Ready } from "./cards.js";
import * as refunds from "./cardRefundsRepo.js";
import * as repo from "./repo.js";
import * as sales from "./saleCardRefundsRepo.js";
import { accessContext, type PaymentsDeps } from "./service.js";
import type { SquareSettings } from "./settings.js";
import type { SquareResult } from "./square.js";

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

const NO_BILLING = "Recording payments isn't part of your role. Ask the owner to turn on \"Record members' payments\" for you.";
const paymentGone = (): OrgsError => new OrgsError(404, "member_payment_not_found", "That payment was not found.");
const refused = (code: string, line: string): OrgsError => new OrgsError(409, code, line);

const leaseFrom = (at: Date): Date => new Date(at.getTime() + CARD_REFUND.leaseMs);
const lookFrom = (at: Date, looks: number): Date =>
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
): Promise<CardRefundCheck> {
  const stopped = (block: CardRefundBlock, card: CardRefundCheck["card"] = null): CardRefundCheck => ({ card, leftMinor: 0, refundedInSquareMinor: 0, block });
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
  if (square.card_details?.refund_requires_card_presence === true) return stopped("card_present", card);
  const takenAt = square.created_at == null ? null : new Date(square.created_at).getTime();
  if (takenAt !== null && deps.now().getTime() - takenAt > CARD_REFUND_LIMITS.daysToRefund * 24 * 60 * 60_000) return stopped("too_old", card);
  const inSquare = square.refunded_money?.amount ?? 0;
  const leftMinor = Math.max(0, Math.min(payment.refundableMinor, total.amount - inSquare));
  const refundedInSquareMinor = Math.max(0, inSquare - payment.refundedMinor);
  if (await waiting()) return { card, leftMinor, refundedInSquareMinor, block: "waiting" };
  return { card, leftMinor, refundedInSquareMinor, block: leftMinor === 0 ? "nothing_left" : null };
}

/** The box opens: what Square says of this payment now. */
export async function readCardRefund(deps: PaymentsDeps, userId: string, gymId: string, entryId: string, membershipId: string, paymentId: string): Promise<CardRefundCheck> {
  const { ready } = await allowed(deps, userId, gymId);
  const payment = await theirPayment(deps, gymId, entryId, membershipId, paymentId);
  return cardRefundCheckSchema.parse(await checkOfPayment(deps, ready, payment));
}

const checkOfPayment = (deps: PaymentsDeps, ready: Ready, payment: refunds.PaymentToRefund): Promise<CardRefundCheck> =>
  checkWithSquare(deps, ready, payment, payment.squarePaymentId ?? "", () => refundAskingOnBill(deps.sql, ready.row.gymId, payment.billId));

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
async function afterTaken(deps: PaymentsDeps, press: refunds.RefundPress, refund: SquareRefund, today: string, now: Date): Promise<Step> {
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
async function tokenFor(deps: PaymentsDeps, square: SquareSettings, press: refunds.RefundPress): Promise<string | null> {
  const row = await repo.readConnection(deps.sql, press.gymId, square.environment);
  if (row?.state !== "connected" || row.accountId !== press.accountId || row.accessToken === null) return null;
  return square.tokens.open(row.accessToken, accessContext(press.gymId));
}

/** Ask Square for the refund with its key, then let the press go. */
async function ask(deps: PaymentsDeps, token: string, square: SquareSettings, press: refunds.RefundPress): Promise<Step> {
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

/** What the press says, read from the row as it now stands. */
async function answer(deps: PaymentsDeps, gymId: string, id: string): Promise<CardRefundResponse> {
  const press = await refunds.readPress(deps.sql, gymId, id);
  if (press === null) throw paymentGone();
  if (press.outcome === "refused") {
    if (press.code === "UNAUTHORIZED") throw connectionRefused();
    throw refused("card_refund_refused", cardRefundRefusedLine(press.code));
  }
  if (press.outcome === "failed") throw refused("card_refund_failed", CARD_REFUND_WORDS.failed);
  const card = press.brand === null || press.last4 === null ? null : { brand: press.brand, last4: press.last4 };
  const step = press.outcome === "completed" ? "completed" : press.state === "pending" ? "pending" : "checking";
  return cardRefundResponseSchema.parse({ step, amountMinor: press.amountMinor, currency: press.currency, card, pressId: press.id });
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

/** One product of a sale, read through the gym, with what all of its one Square payment holds. */
async function theirSale(deps: PaymentsDeps, gymId: string, saleId: string): Promise<sales.SaleToRefund> {
  const sale = await sales.readSaleToRefund(deps.sql, gymId, saleId);
  if (sale === null) throw saleGone();
  if (sale.squarePaymentId === null) throw refused("card_refund_not_card", CARD_REFUND_WORDS.not_card);
  if (sale.undone) throw refused("sale_voided", SALE_REFUND_WORDS.voided);
  return sale;
}

const checkOfSale = (deps: PaymentsDeps, ready: Ready, sale: sales.SaleToRefund): Promise<CardRefundCheck> =>
  checkWithSquare(deps, ready, sale, sale.squarePaymentId ?? "", () => saleRefundAsking(deps.sql, ready.row.gymId, sale.saleId));

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
    if (!sales.samePress(before, saleId, body)) throw refused("card_refund_key_reused", CARD_REFUND_WORDS.key_reused);
    return await answer(deps, gymId, before.id);
  }
  const sale = await theirSale(deps, gymId, saleId);
  const check = await checkOfSale(deps, ready, sale);
  if (check.block !== null) throw refused(`card_refund_${check.block}`, CARD_REFUND_WORDS[check.block]);
  if (body.amountMinor > check.leftMinor) {
    throw refused("card_refund_too_much", `That is more than can be refunded. ${formatMinor(check.leftMinor, sale.currency)} is the most.`);
  }
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
