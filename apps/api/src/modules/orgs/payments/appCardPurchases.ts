// BUY A REPEATING MEMBERSHIP IN THE APP (ROADMAP Stage 2 item 18k-iv; spec Part 3 §14.8).
//
// A repeating line is not paid on Square's payment page, which keeps no card for the charges after it. The member pays
// with the card they saved in the app (Add card, Stage 5 item 20d), on a tick of its own that names the card, what is
// charged today and after, how often and until when (`repeatingChargeWords`). The purchase is a row of `gym_app_payments`
// with the card in place of a page; Square is asked to charge it with the row's own id as its key, so however often it is
// asked (the press, the phone coming back, the worker) Square takes the money once and gives back the same payment. Once
// Square says it took exactly the first payment, the membership is given as Add membership gives it, its first bill paid
// in the app, its agreement signed and the tick kept with it (`recordBought`); from then the worker charges each renewal
// to the card on file, as for a membership given at the desk.
//
// THE WORST THING here is a card that is not theirs charged, a press charged twice, or money taken with nothing given and
// nobody told. So the card is the buyer's own record's, read under the gym's lock as Buy is written; one row a press and
// one open a record; the key is the row; and a charge Square did not answer is asked again with the same key for an hour,
// then looked for among the location's payments, and after a day left for staff to check in Square on the person's page.
import { dayInTz } from "../../gamification/streak.js";
import * as pays from "./appPaymentsRepo.js";
import { boughtOf, recordBought } from "./appPurchasesRepo.js";
import { CARD_CHARGE, lookUp } from "./cardCharges.js";
import * as repo from "./repo.js";
import type { PaymentsDeps } from "./service.js";
import type { SquareSettings } from "./settings.js";
import type { CardPaymentResult } from "./square.js";
import type { SquarePayment } from "@app/shared";

/** What the gym's Square Dashboard lists the payment as: no name of the person goes to Square. */
const NOTE = "Bought in the app";

/** How one ask ended: given (or kept for staff where it could not be), the card's bank said no, Square refused the
 *  request itself with nothing taken, or no answer yet. */
export type ChargeStep = { kind: "done" } | { kind: "declined"; code: string } | { kind: "refused"; code: string } | { kind: "wait" };

/** The payment is this purchase's: the amount and money asked, no tip, at the gym's location, on the card's customer and
 *  card, naming the row. */
function ours(row: pays.AppPayRow, payment: SquarePayment): boolean {
  const card = row.card;
  if (card === null) return false;
  return (
    payment.amount_money.amount === row.amountMinor &&
    payment.amount_money.currency === row.currency &&
    (payment.total_money == null || payment.total_money.amount === row.amountMinor) &&
    (payment.tip_money == null || payment.tip_money.amount === 0) &&
    (payment.location_id == null || payment.location_id === row.locationId) &&
    (payment.customer_id == null || payment.customer_id === card.customerId) &&
    (payment.reference_id == null || payment.reference_id === row.id) &&
    // The card Square charged is the one the tick names (20i-ii): a pass is charged in place of the card id.
    (payment.card_details?.card?.card_brand == null || payment.card_details.card.card_brand === card.brand) &&
    (payment.card_details?.card?.last_4 == null || payment.card_details.card.last_4 === card.last4)
  );
}

/** Square's answer to the charge, and what follows from it. `first`: the press's own ask, so a refusal means nothing was
 *  taken; on a later ask Square may have taken it before, so it is left for staff to check. */
async function answered(deps: PaymentsDeps, row: pays.AppPayRow, result: CardPaymentResult, first: boolean, tell: boolean): Promise<ChargeStep> {
  const now = deps.now();
  if (result.kind === "unavailable") return { kind: "wait" };
  if (result.kind === "declined") {
    // The bank said no to this very charge, or asked to confirm it was them: nothing was taken.
    await pays.finish(deps.sql, row.gymId, row.id, "closed", now);
    await pays.noteChargeCode(deps.sql, row.gymId, row.id, result.code);
    return { kind: "declined", code: result.code };
  }
  if (result.kind === "refused") {
    deps.log.warn({ event: "square.app_card_purchase_refused", gymId: row.gymId, status: result.status, code: result.code }, "Square refused a card purchase");
    await pays.finish(deps.sql, row.gymId, row.id, first ? "closed" : "gone", now);
    // Kept as Square's refusal, never as a decline, unless the bank asked to confirm.
    if (first) await pays.noteChargeCode(deps.sql, row.gymId, row.id, result.code === "CARD_DECLINED_VERIFICATION_REQUIRED" ? result.code : "CARD_REFUSED");
    return { kind: "refused", code: result.code };
  }
  const payment = result.value;
  if (payment.status === "APPROVED" || payment.status === "PENDING") return { kind: "wait" };
  if (payment.status === "FAILED") {
    await pays.finish(deps.sql, row.gymId, row.id, "closed", now);
    await pays.noteChargeCode(deps.sql, row.gymId, row.id, "UNKNOWN");
    return { kind: "declined", code: "UNKNOWN" };
  }
  if (payment.status !== "COMPLETED") {
    await pays.finish(deps.sql, row.gymId, row.id, first ? "closed" : "gone", now);
    if (first) await pays.noteChargeCode(deps.sql, row.gymId, row.id, payment.status);
    return { kind: "refused", code: payment.status };
  }
  const gym = await repo.readGym(deps.sql, row.gymId);
  const tz = gym?.timezone ?? "UTC";
  // Given as of the day Square took the money on the gym's clock, believed only from the press to now (18k-iii-a, H1b).
  const takenAt = payment.created_at == null ? null : new Date(payment.created_at);
  const believed = takenAt !== null && !Number.isNaN(takenAt.getTime()) && takenAt.getTime() >= row.openedAt.getTime() && takenAt.getTime() <= now.getTime();
  const card = payment.card_details?.card;
  const seen = card?.card_brand != null && card.last_4 != null ? { brand: card.card_brand, last4: card.last_4 } : row.card === null ? null : { brand: row.card.brand, last4: row.card.last4 };
  const taken = payment.total_money ?? payment.amount_money;
  const mine = ours(row, payment);
  if (!mine) deps.log.error({ event: "square.app_card_purchase_unexpected", gymId: row.gymId }, "Square answered a card purchase with another payment");
  const bought = await recordBought(deps.sql, {
    row,
    squarePaymentId: payment.id,
    card: seen,
    taken: taken.currency === row.currency ? taken.amount : null,
    today: believed ? dayInTz(takenAt, tz) : dayInTz(now, tz),
    now,
    // Given while nobody waited on the answer (the worker, or the phone's look after the press got none): Payment received (20h).
    tell,
    ...(mine ? {} : { refuse: "amount_differs" }),
  });
  if (bought?.outcome === "not_recorded") deps.log.error({ event: "square.app_purchase_not_recorded", gymId: row.gymId }, "money taken for a line bought in the app gave nothing");
  if (bought?.outcome === "paid" && bought.signed && deps.agreementCopy !== undefined) await deps.agreementCopy(row.gymId, bought.membershipId);
  return { kind: "done" };
}

function passOf(row: pays.AppPayRow): { pass: string; initiated: "member" } | { initiated: "gym" } {
  const pass = boughtOf(row)?.charge?.verificationToken ?? null;
  return pass === null ? { initiated: "gym" } : { pass, initiated: "member" };
}

/** Ask Square to charge a purchase this request holds: sent with its key for an hour from the press, then only looked
 *  for among the location's payments, never sent again. */
export async function chargeStep(deps: PaymentsDeps, square: SquareSettings, token: string, row: pays.AppPayRow, first: boolean, tell = false): Promise<ChargeStep> {
  const card = row.card;
  if (card === null) throw new Error("a purchase with no card reached the card's charge");
  if (deps.now().getTime() - row.openedAt.getTime() > CARD_CHARGE.resendForMs) {
    const found = await lookUp(deps, square, token, { id: row.id, startedAt: row.openedAt, locationId: row.locationId });
    if (found.kind !== "absent") return await answered(deps, row, found, false, tell);
    // Not among the payments Square made while it could have been sent: still ended as one to check, never as nothing taken.
    deps.log.warn({ event: "square.app_card_purchase_absent", gymId: row.gymId }, "an unanswered card purchase was not among the location's payments");
    await pays.finish(deps.sql, row.gymId, row.id, "gone", deps.now());
    return { kind: "done" };
  }
  const result = await square.api.createCardPayment(token, {
    // The row is the key: asked again, Square gives back the same payment and never takes the money twice.
    idempotencyKey: row.id,
    cardId: card.cardId,
    customerId: card.customerId,
    amountMinor: row.amountMinor,
    currency: row.currency,
    locationId: row.locationId,
    referenceId: row.id,
    note: NOTE,
    // The member pressed Pay with Square's pass for the card, made once its bank was happy (20i-ii): charged in place of the
    // card, as theirs. A purchase kept from before it has no pass and is sent as it was then.
    ...passOf(row),
  });
  return await answered(deps, row, result, first, tell);
}
