// BUY IN THE APP (ROADMAP Stage 2 item 18k-iii-a; Kd, 2026-11-07; spec Part 3 §14.8).
//
// A member presses Buy on a line the gym sells in the app, a pack or a membership paid once, for their own record. They have
// read its details and, where the gym asks for one, its agreement, and signed it (the phone draws it, Stage 5 item 20). The
// server makes Square's own payment page for the line's first payment, as for a bill (18k-ii-a), and keeps what buying it
// gives. Nothing is given until Square says the page's one payment is exactly that amount; then the membership is given as
// Add membership gives it, its first bill paid in the app, and the agreement signed with what they read, at once
// (`recordBought`). A page not paid gives nothing and is closed at Square.
//
// THE WORST THING here is a member who pays and is given nothing with nobody told, or given it without paying, on someone
// else's record, or twice for one press. So a page is made only for the reader's own record (one they alone hold, with
// nobody paying for them), for what the list shows them now; one press is one page (the request key), one page is open for
// a record at a time, and the page is the key of the membership and payment it gives; the price list holds the line while
// it is open, and Delete permanently waits; and what Square took that cannot be given is kept and shown to staff.
import { randomUUID } from "node:crypto";
import {
  APP_PAYMENT_WORDS,
  APP_PURCHASE_STAFF_WORDS,
  APP_PURCHASE_WORDS,
  appPaymentCloseResponseSchema,
  appPurchaseResponseSchema,
  type AppPaymentCloseResponse,
  type AppPurchase,
  type AppPurchaseRequest,
  type AppPurchaseResponse,
} from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";
import { readerOf } from "../myMembership/repo.js";
import { payerOf } from "../payers/repo.js";
import { OrgsError, requirePrivilege } from "../service.js";
import { BILLING, orgNotFound } from "./cards.js";
import { APP_PAYMENT, lookNow, readyForApp, type Told } from "./appPayments.js";
import * as pays from "./appPaymentsRepo.js";
import * as buys from "./appPurchasesRepo.js";
import { accessContext, type PaymentsDeps } from "./service.js";

/** What the gym's Square Dashboard lists the payment as: no name of the person goes to Square. */
const NOTE = "Bought in the app";

const notFound = (): OrgsError => new OrgsError(404, "app_payment_not_found", APP_PAYMENT_WORDS.not_found);
const notOffered = (): OrgsError => new OrgsError(409, "app_payment_not_offered", APP_PAYMENT_WORDS.not_offered);
const changed = (): OrgsError => new OrgsError(409, "app_payment_changed", APP_PURCHASE_WORDS.changed);
const squareDown = (): OrgsError => new OrgsError(503, "square_unavailable", APP_PAYMENT_WORDS.square_down);
const squareRefused = (): OrgsError => new OrgsError(409, "app_payment_refused", APP_PAYMENT_WORDS.refused);

type Limit = () => Promise<boolean>;

/** The reader's own record: one their account alone holds, that nobody else pays for. 404 for anybody who is not a live
 *  member of the gym. */
async function ownRecord(deps: PaymentsDeps, gymId: string, userId: string): Promise<{ entryId: string; gymName: string; timezone: string }> {
  const reader = await readerOf(deps.sql, gymId, userId);
  if (reader === null) throw orgNotFound();
  if (reader.entryId === null || reader.holders !== 1) throw new OrgsError(409, "app_purchase_not_own", APP_PURCHASE_WORDS.not_own);
  if ((await payerOf(deps.sql, gymId, reader.entryId)) !== null) throw new OrgsError(409, "app_purchase_paid_by_other", APP_PURCHASE_WORDS.paid_by_other);
  return { entryId: reader.entryId, gymName: reader.gymName, timezone: reader.timezone };
}

function viewOf(row: pays.AppPayRow): AppPurchase {
  const state = pays.stateOf(row);
  const bought = buys.boughtOf(row);
  if (row.typeId === null) throw new Error("a bill's page was read as a purchase");
  return {
    id: row.id,
    typeId: row.typeId,
    name: bought?.typeName ?? "Membership",
    amountMinor: row.amountMinor,
    currency: row.currency,
    state,
    url: state === "open" ? row.url : null,
    closesAt: state === "open" ? row.closesAt.toISOString() : null,
    membershipId: state === "paid" ? row.membershipId : null,
    receiptNumber: row.receiptNumber,
  };
}

const answerOf = (row: pays.AppPayRow): AppPurchaseResponse => appPurchaseResponseSchema.parse({ purchase: viewOf(row) });

/** The same press, or the page already open for this record: given back where it is this reader's, for this line at this
 *  amount; otherwise the reader is told what stands in the way. */
function sameOr(row: pays.AppPayRow, userId: string, body: AppPurchaseRequest): AppPurchaseResponse {
  if (row.openedBy === userId && row.typeId === body.typeId && row.amountMinor === body.amountMinor) return answerOf(row);
  if (row.state === "open" && row.requestKey !== body.requestKey) throw new OrgsError(409, "app_payment_other_open", APP_PURCHASE_WORDS.other_open);
  throw changed();
}

/** Why a page cannot be made, or the page already open for this record. */
function refusalOf(outcome: Exclude<buys.PurchasableOutcome, { kind: "ok" }>, gymName: string, userId: string, body: AppPurchaseRequest): AppPurchaseResponse {
  switch (outcome.kind) {
    case "open":
      return sameOr(outcome.row, userId, body);
    case "entry_not_found":
      throw new OrgsError(409, "app_purchase_not_own", APP_PURCHASE_WORDS.not_own);
    case "changed":
      throw changed();
    case "agreement_changed":
      throw new OrgsError(409, "agreement_changed", APP_PURCHASE_WORDS.agreement_changed(gymName));
    case "guardian_needed":
      throw new OrgsError(409, "guardian_needed", APP_PURCHASE_WORDS.guardian_needed);
    case "person_signs":
      throw new OrgsError(409, "person_signs", APP_PURCHASE_WORDS.person_signs);
    case "already_held":
      throw new OrgsError(409, "already_held", APP_PURCHASE_WORDS.already_held(outcome.name));
    case "too_many":
      throw new OrgsError(409, "too_many", APP_PURCHASE_WORDS.too_many);
    case "currency":
      throw notOffered();
    case "check":
      throw new OrgsError(409, "app_payment_check", APP_PURCHASE_WORDS.check_first);
    default: {
      const never: never = outcome;
      throw new Error(`unhandled purchase check: ${JSON.stringify(never)}`);
    }
  }
}

/** Buy: Square's page for the line's first payment, as the list showed it to this reader. The same press sent twice is
 *  one page; a page already open for the same line is given back instead of a second. */
export async function startPurchase(deps: PaymentsDeps, userId: string, gymId: string, body: AppPurchaseRequest, limit: Limit): Promise<Told<AppPurchaseResponse> | null> {
  const own = await ownRecord(deps, gymId, userId);
  if (!(await limit())) return null;
  const same = await pays.readByKey(deps.sql, gymId, body.requestKey);
  if (same !== null) return { answer: sameOr(same, userId, body), tell: null };
  const ready = await readyForApp(deps, gymId);
  if (ready === null) throw notOffered();
  const now = deps.now();
  const buying: buys.Buying = {
    gymId,
    entryId: own.entryId,
    typeId: body.typeId,
    amountMinor: body.amountMinor,
    factsKey: body.factsKey,
    agreement: body.agreement,
    accountCurrency: ready.row.currency,
    gymName: own.gymName,
    today: dayInTz(now, ready.timezone),
    now,
  };
  const before = await buys.purchasable(deps.sql, buying);
  if (before.kind !== "ok") return { answer: refusalOf(before, own.gymName, userId, body), tell: null };

  const token = ready.square.tokens.open(ready.row.accessToken ?? "", accessContext(gymId));
  if (token === null) throw notOffered();
  const id = randomUUID();
  const linkKey = randomUUID();
  const made = await ready.square.api.createPaymentLink(token, {
    idempotencyKey: linkKey,
    locationId: ready.row.locationId,
    referenceId: id,
    name: before.bought.typeName.slice(0, 500),
    amountMinor: body.amountMinor,
    currency: before.currency,
    note: NOTE,
  });
  if (made.kind === "unavailable") throw squareDown();
  if (made.kind === "refused") {
    deps.log.warn({ event: "square.app_purchase_link_refused", gymId, status: made.status, code: made.code }, "Square refused to make a purchase's payment page");
    throw made.status === 401 || made.status === 403 ? notOffered() : squareRefused();
  }
  const link = made.value;
  // Square's order is what the page charges: anything but the list's amount is never given to the member.
  const total = link.order?.total_money ?? null;
  if (total !== null && (total.amount !== body.amountMinor || total.currency !== before.currency)) {
    deps.log.error({ event: "square.app_purchase_link_total", gymId }, "Square made a purchase's payment page for another amount than asked");
    await ready.square.api.deletePaymentLink(token, link.linkId);
    throw squareRefused();
  }
  const at = deps.now();
  const written = await buys.writeOpenPurchase(deps.sql, {
    ...buying,
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
  if (written.kind === "new") return { answer: answerOf(written.row), tell: own.entryId };
  // Something changed while Square made the page: nobody was given its address, and Square is told to delete it.
  const gone = await ready.square.api.deletePaymentLink(token, link.linkId);
  if (gone.kind !== "ok") deps.log.warn({ event: "square.app_purchase_link_left", gymId }, "a purchase's payment page nobody was given could not be deleted");
  if (written.kind === "key_reused") return { answer: sameOr(written.row, userId, body), tell: null };
  return { answer: refusalOf(written, own.gymName, userId, body), tell: null };
}

/** Where a purchase stands: Square is asked, unless another request is asking right now. */
export async function checkPurchase(deps: PaymentsDeps, userId: string, gymId: string, id: string, limit: Limit): Promise<Told<AppPurchaseResponse> | null> {
  if ((await readerOf(deps.sql, gymId, userId)) === null) throw orgNotFound();
  if (!(await limit())) return null;
  const row = await buys.readOwnPurchase(deps.sql, gymId, userId, id);
  if (row === null) throw notFound();
  if (row.state === "open" && deps.square !== null) await lookNow(deps, deps.square, gymId, id, 0);
  return await toldOf(deps, userId, gymId, id, row);
}

/** The member left the page: it is closed at Square, unless Square says it was paid. */
export async function closePurchase(deps: PaymentsDeps, userId: string, gymId: string, id: string, limit: Limit): Promise<Told<AppPurchaseResponse> | null> {
  if ((await readerOf(deps.sql, gymId, userId)) === null) throw orgNotFound();
  if (!(await limit())) return null;
  const row = await buys.readOwnPurchase(deps.sql, gymId, userId, id);
  if (row === null) throw notFound();
  if (row.state === "open" && deps.square !== null) {
    await pays.wantClose(deps.sql, gymId, id, "member", null, deps.now());
    await lookNow(deps, deps.square, gymId, id, APP_PAYMENT.closeWaitMs);
  }
  return await toldOf(deps, userId, gymId, id, row);
}

async function toldOf(deps: PaymentsDeps, userId: string, gymId: string, id: string, before: pays.AppPayRow): Promise<Told<AppPurchaseResponse>> {
  const now = await buys.readOwnPurchase(deps.sql, gymId, userId, id);
  if (now === null) throw notFound();
  return { answer: answerOf(now), tell: before.state === "open" && now.state !== "open" ? now.entryId : null };
}

// ── Staff ──

/** Close payment page under a purchase, on the person's page: closed at Square, unless Square says it was paid. Whoever
 *  records payments may press it. */
export async function closePurchaseByStaff(deps: PaymentsDeps, userId: string, gymId: string, entryId: string, id: string): Promise<AppPaymentCloseResponse> {
  await requirePrivilege(deps, gymId, userId, BILLING);
  const closing = await buys.staffClosePurchase(deps.sql, { gymId, entryId, id, staffUserId: userId, now: deps.now() });
  if (closing === null) throw new OrgsError(404, "app_payment_not_found", APP_PURCHASE_STAFF_WORDS.none);
  if (deps.square !== null) await lookNow(deps, deps.square, gymId, id, APP_PAYMENT.closeWaitMs);
  const ended = await pays.outcomeOf(deps.sql, gymId, id);
  const outcome = ended === null ? "waiting" : ended === "paid" ? "paid" : pays.CHECK_OUTCOMES.includes(ended) ? "check" : "closed";
  return appPaymentCloseResponseSchema.parse({ outcome });
}

/** Mark as checked, under a purchase that gave nothing: staff have checked it in Square. */
export async function markPurchaseChecked(deps: PaymentsDeps, userId: string, gymId: string, entryId: string, id: string): Promise<{ ok: true }> {
  await requirePrivilege(deps, gymId, userId, BILLING);
  const done = await buys.markPurchaseChecked(deps.sql, { gymId, entryId, id, staffUserId: userId, now: deps.now() });
  if (!done) throw new OrgsError(404, "app_purchase_not_checking", APP_PURCHASE_STAFF_WORDS.not_checking);
  return { ok: true };
}

