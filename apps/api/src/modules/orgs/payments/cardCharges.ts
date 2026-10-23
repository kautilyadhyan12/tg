// THE SAVED CARD CHARGED ON THE BILL'S DATE (ROADMAP 18d-iii-i; spec Part 3 §14.8;
// rulings/2026-10-21-money-plan.md, rulings/2026-10-22-18z.md).
//
// Every minute the worker looks for a renewing membership's bill that fell due today (or in the two
// days before, where Square or the worker was down) on its gym's clock, from 6 in the morning there,
// and for a freeze fee on its day, and charges the card on file of whoever pays for that person:
// Square's CreatePayment, completed at once. The first bill of a membership is taken at the desk when
// it is given, and late cancel and no-show fees are taken by hand, so neither is charged by itself.
// Staff holding the payments tick can charge the card themselves from Record payment (Card on file).
//
// THE WORST THING here is a person charged twice, charged for somebody else's bill, or charged for a
// bill already paid, cancelled or frozen. So a charge is started under the record's lock with the
// rules a payment by hand uses; while it is out nothing else pays, voids or cancels that membership;
// the app's own charge is asked of Square with the bill's own id, so Square takes that bill once
// however often it is asked; the app charges a bill by itself once (a unique index); nothing is
// recorded until Square says the payment is COMPLETED for exactly this amount, at the gym's location,
// on our customer and this charge; it is recorded once (the charge is the payment's request key, and
// Square's payment id is kept once); and money Square took that the bill can no longer take is kept
// and told to the gym's Staff activity.
//
// No answer from Square (no connection, a 5xx) is asked again with the same key: Square gives back
// the same payment, paid or failed. A charge is ended only on Square's own answer, the gym leaving
// that Square account, or a day without an answer.
//
// A DECLINE (18d-iii-ii-a, `cardRetries.ts` in @app/shared): the app tries the card again by itself
// only after a decline a later try may cure, on the days the rule names, at most 3 charges of a bill
// to a card in all; staff charge it again a whole day after a decline, never after the bank declined
// it for good. The bill's first decline queues the email telling the cardholder (`cardNotices.ts`).
import { randomUUID } from "node:crypto";
import {
  CARD_CHARGE_WORDS,
  cardChargeResponseSchema,
  cardDeclineReasonOf,
  cardExpired,
  cardName,
  formatMinor,
  MEMBER_FEE_WORDS,
  memberFeeKindSchema,
  type CardCharge,
  type CardChargeRequest,
  type CardChargeResponse,
  type CardFeeChargeRequest,
  type CardOnFile,
  type SquarePayment,
} from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";
import { OrgsError, requireWritablePrivilege } from "../service.js";
import { BILLING, connectionRefused, entryNotFound, orgNotFound, readyOrThrow } from "./cards.js";
import * as charges from "./cardChargesRepo.js";
import * as repo from "./repo.js";
import { accessContext, type PaymentsDeps } from "./service.js";
import type { SquareSettings } from "./settings.js";
import type { CardPaymentResult } from "./square.js";

export const CARD_CHARGE = {
  /** One request asks Square about a charge at a time, for at most this long. */
  leaseMs: 20_000,
  /** Square not answering: the worker asks again this long after. */
  idleMs: 60_000,
  /** Square giving no answer at all for a day: given up, and told to Staff activity. Until then
   *  money taken meanwhile is recorded when Square answers again. */
  giveUpMs: 24 * 60 * 60_000,
  /** Charges asked again, and bills charged (first tries and tries again each), in one minute of the
   *  worker. */
  perRun: 50,
  /** Bills looked at in one minute, charged or not. */
  lookPerRun: 500,
  /** From this hour on the gym's clock. */
  fromHour: 6,
  /** What the gym's Square Dashboard lists the payment as: no name of the person goes to Square. */
  note: "Membership payment",
} as const;

const NO_BILLING = "Recording payments isn't part of your role. Ask the owner to turn on \"Record members' payments\" for you.";
const chargeGone = (): OrgsError => new OrgsError(404, "card_charge_gone", CARD_CHARGE_WORDS.charge_gone);

/** How the charge ended, or null while Square has not answered. */
type Step = { done: "paid" | "declined" | "refused" | "not_recorded" | "gone" } | null;

/** Square's code, as a row keeps it. */
const codeOf = (code: string): string => (/^[A-Z0-9_]{1,60}$/.test(code) ? code : "UNKNOWN");

/** The payment Square answered with is this charge's: our amount, our location, our customer and
 *  our charge named in it (Square's test area names all of them, measured 2026-10-23). */
function isOurs(charge: charges.ChargeRow, payment: SquarePayment): boolean {
  return mismatch(charge, payment) === null;
}

/** How Square's payment differs from this charge: `amount_differs` for another amount, `not_ours`
 *  for another location, customer or charge; null where it is this charge's. */
function mismatch(charge: charges.ChargeRow, payment: SquarePayment): "amount_differs" | "not_ours" | null {
  if (payment.amount_money.amount !== charge.amountMinor || payment.amount_money.currency !== charge.currency) return "amount_differs";
  if (payment.total_money != null && payment.total_money.amount !== charge.amountMinor) return "amount_differs";
  if (payment.tip_money != null && payment.tip_money.amount !== 0) return "amount_differs";
  if (payment.location_id != null && payment.location_id !== charge.locationId) return "not_ours";
  if (payment.customer_id != null && payment.customer_id !== charge.customerId) return "not_ours";
  return payment.reference_id == null || payment.reference_id === charge.id ? null : "not_ours";
}

/** Square's answer to the charge, and what follows from it. */
async function answered(deps: PaymentsDeps, charge: charges.ChargeRow, result: CardPaymentResult, now: Date): Promise<Step> {
  const end = async (outcome: "declined" | "refused" | "gone", code: string | null, squarePaymentId: string | null): Promise<Step> => {
    await charges.finish(deps.sql, charge.id, { outcome, code, squarePaymentId }, now);
    return { done: outcome };
  };
  if (result.kind === "unavailable") {
    if (now.getTime() <= charge.startedAt.getTime() + CARD_CHARGE.giveUpMs) return null;
    deps.log.error({ event: "square.card_charge_unchecked", gymId: charge.gymId }, "a card charge could not be read from Square for a day");
    return await end("gone", null, null);
  }
  if (result.kind === "declined") {
    const failed = result.payment !== null && result.payment.status === "FAILED" && isOurs(charge, result.payment) ? result.payment.id : null;
    return await end("declined", codeOf(result.code), failed);
  }
  if (result.kind === "refused") {
    deps.log.warn({ event: "square.card_charge_refused", gymId: charge.gymId, status: result.status, code: result.code }, "Square refused a card charge");
    // Asked before with no answer: Square may have taken the money then, and a refusal now (a token
    // taken away, an account closed) says nothing of it. Checked in Square, never "nothing taken"
    // (review round one).
    if (charge.checkedAt.getTime() > charge.startedAt.getTime()) return await end("gone", null, null);
    // Square refusing the request itself on the first ask: the card gone from Square, the connection
    // refused, or a fault of ours. Nothing was taken.
    return await end("refused", codeOf(result.code), null);
  }
  const payment = result.value;
  const gym = await repo.readGym(deps.sql, charge.gymId);
  const today = dayInTz(now, gym?.timezone ?? "UTC");
  const differs = mismatch(charge, payment);
  if (differs !== null) {
    deps.log.error({ event: "square.card_charge_unexpected", gymId: charge.gymId, status: payment.status, why: differs }, "Square answered a card charge with another payment");
    if (payment.status !== "COMPLETED") return null;
    // Money Square took that is not what was asked: kept, never recorded.
    const kept = await charges.recordCharged(deps.sql, { charge, squarePaymentId: payment.id, today, now, refuse: differs });
    return kept === null ? null : { done: kept.outcome };
  }
  if (payment.status === "COMPLETED") {
    const kept = await charges.recordCharged(deps.sql, { charge, squarePaymentId: payment.id, today, now });
    if (kept?.outcome === "not_recorded") deps.log.error({ event: "square.card_charge_not_recorded", gymId: charge.gymId }, "money taken from a card on file could not be recorded on its bill");
    return kept === null ? null : { done: kept.outcome };
  }
  if (payment.status === "FAILED") return await end("declined", "GENERIC_DECLINE", payment.id);
  if (payment.status === "CANCELED") return await end("refused", "CANCELED", null);
  // APPROVED or PENDING: asked again.
  return null;
}

/** The gym's token for the Square account the charge was made in, while it is connected to it. */
async function tokenFor(deps: PaymentsDeps, square: SquareSettings, charge: charges.ChargeRow): Promise<string | null> {
  const row = await repo.readConnection(deps.sql, charge.gymId, square.environment);
  if (row?.state !== "connected" || row.accountId !== charge.accountId || row.accessToken === null) return null;
  return square.tokens.open(row.accessToken, accessContext(charge.gymId));
}

/** Ask Square for the charge (made, or given back, by its key) while this request holds it until
 *  `until`, then let it go. */
async function advance(deps: PaymentsDeps, square: SquareSettings, charge: charges.ChargeRow, until: Date): Promise<Step> {
  try {
    const token = await tokenFor(deps, square, charge);
    if (token === null) {
      // The gym left that Square account: what Square did with the charge cannot be read here.
      deps.log.warn({ event: "square.card_charge_unfollowed", gymId: charge.gymId }, "a card charge's Square connection went before Square answered");
      await charges.finish(deps.sql, charge.id, { outcome: "gone", code: null, squarePaymentId: null }, deps.now());
      return { done: "gone" };
    }
    const result = await square.api.createCardPayment(token, {
      idempotencyKey: charge.paymentKey,
      cardId: charge.cardId,
      customerId: charge.customerId,
      amountMinor: charge.amountMinor,
      currency: charge.currency,
      locationId: charge.locationId,
      // Square's own field for the app's record of it: the charge, never the person.
      referenceId: charge.id,
      // A fee is named as one ("Freeze fee"), so staff refunding it in Square find it.
      note: noteOf(charge),
    });
    return await answered(deps, charge, result, deps.now());
  } finally {
    await charges.release(deps.sql, charge.id, until);
  }
}

function noteOf(charge: charges.ChargeRow): string {
  if (charge.periodIndex !== null) return CARD_CHARGE.note;
  const kind = memberFeeKindSchema.safeParse(charge.feeKind);
  return kind.success ? MEMBER_FEE_WORDS[kind.data] : CARD_CHARGE.note;
}

const leaseFrom = (at: Date): Date => new Date(at.getTime() + CARD_CHARGE.leaseMs);

function viewOf(charge: charges.ChargeRow): CardCharge {
  return {
    id: charge.id,
    membershipId: charge.membershipId,
    feeBillId: charge.periodIndex === null ? charge.billId : null,
    amountMinor: charge.amountMinor,
    currency: charge.currency,
    card: { brand: charge.brand, last4: charge.last4 },
    step: charge.state,
    outcome: charge.outcome,
    reason: charge.outcome === "declined" && charge.declineCode !== null ? cardDeclineReasonOf(charge.declineCode) : null,
    receiptNumber: charge.receiptNumber,
  };
}

/** The card on file Record payment can charge for this person, where the gym's Square is ready. */
export async function cardOnFileFor(
  deps: PaymentsDeps,
  gymId: string,
  entryId: string,
  connection: repo.ConnectionRow | null,
  timezone: string,
): Promise<CardOnFile | null> {
  const square = deps.square;
  if (square === null || connection?.state !== "connected" || connection.locationId === null) return null;
  const card = await charges.readChargeCard(deps.sql, gymId, entryId, square.environment, connection.accountId);
  if (card === null) return null;
  return {
    brand: card.brand,
    last4: card.last4,
    expired: cardExpired({ expMonth: card.exp_month, expYear: card.exp_year }, dayInTz(deps.now(), timezone)),
    stopped: await charges.cardStopped(deps.sql, gymId, card.card_id),
    payerName: card.payerName,
    ref: charges.cardRefOf(card),
  };
}

/** Charge card on file for a period of a membership. */
export async function chargeCardOnFile(
  deps: PaymentsDeps,
  userId: string,
  gymId: string,
  entryId: string,
  membershipId: string,
  body: CardChargeRequest,
): Promise<CardChargeResponse> {
  return await chargeByStaff(deps, userId, gymId, entryId, membershipId, body, { kind: "period", periodIndex: body.periodIndex });
}

/** Charge card on file for one of a membership's fees. */
export async function chargeFeeToCardOnFile(
  deps: PaymentsDeps,
  userId: string,
  gymId: string,
  entryId: string,
  membershipId: string,
  billId: string,
  body: CardFeeChargeRequest,
): Promise<CardChargeResponse> {
  return await chargeByStaff(deps, userId, gymId, entryId, membershipId, body, { kind: "fee", billId });
}

/** A press: the card is charged now, and the answer says how it ended (or that Square has not
 *  answered yet). The same press sent twice is one charge, answered as it stands. */
async function chargeByStaff(
  deps: PaymentsDeps,
  userId: string,
  gymId: string,
  entryId: string,
  membershipId: string,
  body: CardFeeChargeRequest,
  target: charges.ChargeTarget,
): Promise<CardChargeResponse> {
  const { privileges } = await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  if (!privileges.includes(BILLING)) throw new OrgsError(403, "forbidden", NO_BILLING);
  const gym = await repo.readGym(deps.sql, gymId);
  if (gym === null) throw orgNotFound();
  const ready = await readyOrThrow(deps, gymId, gym);
  const locationId = ready.row.locationId;
  if (locationId === null) throw orgNotFound();
  const now = deps.now();
  const written = await charges.startCharge(deps.sql, {
    gymId,
    entryId,
    membershipId,
    target,
    amountMinor: body.amountMinor,
    cardRef: body.cardRef,
    environment: ready.square.environment,
    accountId: ready.row.accountId,
    locationId,
    accountCurrency: ready.row.currency,
    bySchedule: false,
    requestKey: body.requestKey,
    id: randomUUID(),
    startedBy: userId,
    today: dayInTz(now, gym.timezone),
    now,
    checkingUntil: leaseFrom(now),
  });
  switch (written.kind) {
    case "new": {
      const step = await advance(deps, ready.square, written.charge, leaseFrom(now));
      if (step?.done === "refused") {
        const ended = await charges.readCharge(deps.sql, gymId, entryId, written.charge.id);
        if (ended?.declineCode === "UNAUTHORIZED") throw connectionRefused();
      }
      return await answer(deps, gymId, entryId, written.charge.id);
    }
    case "same_press":
      return await answer(deps, gymId, entryId, written.charge.id);
    case "key_reused":
      throw chargeGone();
    case "entry_not_found":
      throw entryNotFound();
    case "membership_not_found":
      throw new OrgsError(404, "held_membership_not_found", "That membership was not found.");
    case "not_allowed":
      throw new OrgsError(409, "held_membership_changed", "This membership has changed since you opened it. Nothing was charged: check it and try again.");
    case "too_much":
      throw new OrgsError(409, "payment_too_much", `That is more than is left to pay. ${formatMinor(written.leftMinor, written.currency)} is left.`);
    case "currency":
      throw new OrgsError(409, "card_charge_currency", CARD_CHARGE_WORDS.currency);
    case "no_card":
      throw new OrgsError(409, "card_charge_no_card", CARD_CHARGE_WORDS.no_card);
    case "card_changed":
      throw new OrgsError(409, "card_charge_card_changed", CARD_CHARGE_WORDS.card_changed);
    case "terminal_waiting":
      throw new OrgsError(409, "terminal_payment_waiting", "A payment for this membership is waiting on the Terminal. Wait for it to finish, or cancel it first.");
    case "card_charging":
      throw new OrgsError(409, "card_charge_waiting", CARD_CHARGE_WORDS.charging);
    case "fee_not_found":
      throw new OrgsError(404, "member_fee_not_found", "That fee was not found.");
    case "fee_changed":
      throw new OrgsError(409, "member_fee_changed", "This fee has changed since you opened it. Nothing was charged: check it and try again.");
    case "card_wait":
      throw new OrgsError(409, "card_charge_wait", cardWaitWords(written, gym.timezone, gym.country));
    case "card_stopped":
      throw new OrgsError(409, "card_charge_stopped", CARD_CHARGE_WORDS.stopped);
    case "card_tried_out":
      throw new OrgsError(409, "card_charge_tried_out", CARD_CHARGE_WORDS.tried_out);
    default: {
      const never: never = written;
      throw new Error(`unhandled card charge start: ${JSON.stringify(never)}`);
    }
  }
}

/** "Visa ending 1111 was declined less than a day ago…", with the gym's own time it may be charged
 *  again from. Square: "Wait at least 24 hours before retrying." */
function cardWaitWords(w: { from: Date; brand: string; last4: string }, timezone: string, country: string | null): string {
  const locale = `en-${country ?? "US"}`;
  const time = new Intl.DateTimeFormat(locale, { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(w.from);
  // "24 Oct", as every console page writes a day.
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, day: "numeric", month: "short" }).format(w.from);
  return `${cardName(w)} was declined less than a day ago, and Square advises waiting a day before charging it again. It can be charged from ${time} on ${day}. Nothing was charged.`;
}

async function answer(deps: PaymentsDeps, gymId: string, entryId: string, chargeId: string): Promise<CardChargeResponse> {
  const charge = await charges.readCharge(deps.sql, gymId, entryId, chargeId);
  if (charge === null) throw chargeGone();
  return cardChargeResponseSchema.parse({ charge: viewOf(charge) });
}

export interface CardChargeRun {
  /** Charges Square had not answered, asked again. */
  asked: number;
  /** Bills the app charged by itself, and how those ended. */
  charged: number;
  paid: number;
  declined: number;
}

/** The worker's minute: charges Square has not answered are asked again, then the bills that have
 *  fallen due are charged. `gymIds`: only these gyms, for a test sharing its database; production
 *  passes null. */
export async function processCardCharges(deps: PaymentsDeps, square: SquareSettings, gymIds: readonly string[] | null = null): Promise<CardChargeRun> {
  const run: CardChargeRun = { asked: 0, charged: 0, paid: 0, declined: 0 };
  while (run.asked < CARD_CHARGE.perRun) {
    const at = deps.now();
    const [charge] = await charges.claimUnanswered(deps.sql, square.environment, at, CARD_CHARGE.idleMs, leaseFrom(at), 1, gymIds);
    if (charge === undefined) break;
    await advance(deps, square, charge, leaseFrom(at));
    run.asked += 1;
  }

  // Tries again first: they are fewer, and each has waited days already.
  let looked = 0;
  for (const find of [charges.retryBills, charges.dueBills]) {
    let after: { gymId: string; billId: string } | null = null;
    while (run.charged < CARD_CHARGE.perRun && looked < CARD_CHARGE.lookPerRun) {
      const due = await find(deps.sql, { environment: square.environment, now: deps.now(), limit: 50, after, gymIds });
      if (due.length === 0) break;
      for (const bill of due) {
        looked += 1;
        after = { gymId: bill.gymId, billId: bill.billId };
        if (run.charged >= CARD_CHARGE.perRun) break;
        const step = await chargeDueBill(deps, square, bill);
        if (step === undefined) continue;
        run.charged += 1;
        if (step?.done === "paid") run.paid += 1;
        if (step?.done === "declined") run.declined += 1;
      }
    }
  }
  return run;
}

/** One bill the app charges by itself, or undefined where the write's own check found it should not
 *  be charged after all (it is looked at again next minute only if it still qualifies then). */
async function chargeDueBill(deps: PaymentsDeps, square: SquareSettings, bill: charges.DueBill): Promise<Step | undefined> {
  const row = await repo.readConnection(deps.sql, bill.gymId, square.environment);
  if (row?.state !== "connected" || row.locationId === null) return undefined;
  const now = deps.now();
  const written = await charges.startCharge(deps.sql, {
    gymId: bill.gymId,
    entryId: bill.entryId,
    membershipId: bill.membershipId,
    target: bill.periodIndex === null ? { kind: "fee", billId: bill.billId } : { kind: "period", periodIndex: bill.periodIndex },
    amountMinor: null,
    cardRef: null,
    environment: square.environment,
    accountId: row.accountId,
    locationId: row.locationId,
    accountCurrency: row.currency,
    bySchedule: true,
    // The app's own charge of a bill is one row (the unique index on the bill), whatever its key.
    requestKey: randomUUID(),
    id: randomUUID(),
    startedBy: null,
    today: dayInTz(now, bill.timezone),
    now,
    checkingUntil: leaseFrom(now),
  });
  if (written.kind !== "new") {
    if (written.kind !== "not_allowed" && written.kind !== "no_card") deps.log.warn({ event: "square.card_charge_skipped", gymId: bill.gymId, why: written.kind }, "a bill due was not charged");
    return undefined;
  }
  return await advance(deps, square, written.charge, leaseFrom(now));
}
