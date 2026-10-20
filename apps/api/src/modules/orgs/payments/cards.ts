// A MEMBER'S CARD ON FILE (ROADMAP 18d-ii; spec Part 3 §14.5; rulings/2026-10-20-18d-ii.md).
//
// The card is typed into Square's own form, in the browser at the desk or in the member's app,
// and goes from there to Square: what reaches us is Square's one-time token for it. We make the
// person a customer in the gym's own Square account (once, under a lock), save the card on that
// customer, and keep Square's ids and what a screen shows.
//
// THE WORST THING here is a card saved on the wrong person, or without their agreement, so that
// somebody else's bills could later be charged to it. So the record is the path's, read in the
// path's gym, by its staff holding the payments tick (`billing.members`); on the member's own
// routes it is the record their live account alone holds, never one they name. The customer
// and the card are made in the gym's own connected account with its own token. The card is
// written, under the gym's lock, only while the record is still on the list, nobody pays for
// them and the gym is still connected to that account; otherwise Square is told to stop it.
// The person's own tick is required, word for word what was shown, and kept apart from the
// card with its time and screen.
//
// One card a person: a new one replaces the old, which Square is told to stop. Only staff
// remove a card (PushPress and Mindbody: only the business does); a member adds or updates.
import { randomUUID } from "node:crypto";
import {
  MEMBER_CARD_WORDS,
  MEMBER_LIST_BY_HAND_WORDS,
  cardAgreementWords,
  cardExpired,
  cardNameParts,
  cardPaidByLine,
  gymPaymentsAvailability,
  memberCardResponseSchema,
  myCardResponseSchema,
  type CardForm,
  type MemberCard,
  type MemberCardResponse,
  type MemberCardState,
  type MyCardResponse,
  type SaveCardRequest,
} from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";
import { lockGym } from "../memberList/repo.js";
import { readerOf } from "../myMembership/repo.js";
import { payerOf } from "../payers/repo.js";
import { gymHasLivePlan, insertAudit, type OrgRow } from "../repo.js";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import * as cards from "./cardsRepo.js";
import * as repo from "./repo.js";
import { REVOKE_MAX_TRIES, REVOKE_RETRY_MS, accessContext, type PaymentsDeps } from "./service.js";
import type { SquareSettings } from "./settings.js";
import type { SquareResult } from "./square.js";

const BILLING = "billing.members";

/** Square's messages about a saved card. Each is checked with Square before anything changes. */
export const SQUARE_CARD_EVENTS: readonly string[] = ["card.automatically_updated", "card.updated", "card.disabled", "card.forgotten"];

/** Square's message that the gym deleted a customer inside Square: the card saved on it is no
 *  longer the person's here (seen 2026-10-20: Square keeps the card itself, marked enabled). */
export const SQUARE_CUSTOMER_DELETED_EVENT = "customer.deleted";

const orgNotFound = (): OrgsError => new OrgsError(404, "org_not_found", "Organisation not found.");
const entryNotFound = (): OrgsError => new OrgsError(404, "entry_not_found", MEMBER_LIST_BY_HAND_WORDS.entry_not_found);
const unavailable = (): OrgsError => new OrgsError(503, "square_unavailable", MEMBER_CARD_WORDS.square_unavailable);
const notReady = (): OrgsError => new OrgsError(409, "card_not_ready", MEMBER_CARD_WORDS.not_ready);
const connectionRefused = (): OrgsError => new OrgsError(409, "card_connection_refused", MEMBER_CARD_WORDS.connection_refused);
const paidBy = (payer: string, person: string): OrgsError =>
  new OrgsError(409, "card_paid_by_payer", cardPaidByLine(payer === "" ? "Somebody else on your list" : payer, person === "" ? "this person" : person));

function stateOf(square: SquareSettings | null, gym: repo.GymForPayments, row: repo.ConnectionRow | null): MemberCardState {
  if (square === null || gymPaymentsAvailability(gym.country) !== "square") return "not_offered";
  if (row?.state !== "connected") return "connect";
  return row.locationId === null ? "choose_location" : "ready";
}

/** The card, while it is in the Square account the gym is connected to now. */
function shownCard(card: cards.CardRow | null, square: SquareSettings | null, row: repo.ConnectionRow | null): cards.CardRow | null {
  if (card === null || square === null || row?.state !== "connected") return null;
  return card.environment === square.environment && card.accountId === row.accountId ? card : null;
}

/** A card kept for the person in a Square account the gym is no longer connected to (a
 *  hand-over, or another account since: Kd, 2026-10-20, `rulings/2026-10-20-4b-v.md`): never
 *  used from here, and named so the person is asked to add their card again. */
const earlierOf = (card: cards.CardRow | null, shown: cards.CardRow | null): { brand: string; last4: string } | null =>
  card === null || shown !== null ? null : { brand: card.brand, last4: card.last4 };

const cardOf = (c: cards.CardRow, today: string): MemberCard => ({
  brand: c.brand,
  last4: c.last4,
  expMonth: c.expMonth,
  expYear: c.expYear,
  expired: cardExpired(c, today),
  savedAt: c.savedAt.toISOString(),
  savedFrom: c.savedFrom,
});

function formOf(square: SquareSettings, row: repo.ConnectionRow, gym: repo.GymForPayments, person: cards.CardPerson): CardForm | null {
  if (row.locationId === null || gym.country === null) return null;
  const { givenName, familyName } = cardNameParts(person.fullName);
  return {
    environment: square.environment,
    applicationId: square.applicationId,
    locationId: row.locationId,
    contact: { givenName, familyName, email: person.email, countryCode: gym.country },
  };
}

interface Ready {
  square: SquareSettings;
  row: repo.ConnectionRow;
  /** The gym's own access token, opened. Never logged, never sent to a browser. */
  token: string;
}

/** Square set up here, and the gym connected with a location: or 409. */
async function readyOrThrow(deps: PaymentsDeps, gymId: string, gym: repo.GymForPayments): Promise<Ready> {
  const square = deps.square;
  const row = square === null ? null : await repo.readConnection(deps.sql, gymId, square.environment);
  if (square === null || stateOf(square, gym, row) !== "ready" || row === null || row.accessToken === null) throw notReady();
  const token = square.tokens.open(row.accessToken, accessContext(gymId));
  if (token === null) {
    deps.log.error({ event: "square.token_unreadable", gymId }, "a gym's Square token could not be opened");
    throw connectionRefused();
  }
  return { square, row, token };
}

/** Card on file, for staff holding the payments tick. */
async function staffView(deps: PaymentsDeps, org: OrgRow, userId: string, entryId: string): Promise<MemberCardResponse> {
  const [gym, person] = await Promise.all([repo.readGym(deps.sql, org.id), cards.readPerson(deps.sql, org.id, entryId)]);
  if (gym === null) throw orgNotFound();
  if (person === null) throw entryNotFound();
  const row = deps.square === null ? null : await repo.readConnection(deps.sql, org.id, deps.square.environment);
  const state = stateOf(deps.square, gym, row);
  const [card, payer, live] = await Promise.all([cards.readCard(deps.sql, org.id, entryId), payerOf(deps.sql, org.id, entryId), gymHasLivePlan(deps.sql, org.id)]);
  const canChange = state === "ready" && live && org.status === "active";
  const shown = shownCard(card, deps.square, row);
  return memberCardResponseSchema.parse({
    cardOnFile: {
      state,
      card: shown === null ? null : cardOf(shown, dayInTz(deps.now(), gym.timezone)),
      earlierCard: earlierOf(card, shown),
      paidBy: payer === null ? null : { entryId: payer.entryId, name: payer.name },
      inApp: person.inApp,
      canChange,
      isOwner: gym.ownerUserId === userId,
      gymName: gym.name,
      agreement: cardAgreementWords(gym.name),
      form: canChange && payer === null && deps.square !== null && row !== null ? formOf(deps.square, row, gym, person) : null,
    },
  });
}

export async function readMemberCard(deps: PaymentsDeps, userId: string, gymId: string, entryId: string): Promise<MemberCardResponse> {
  const { org } = await requirePrivilege(deps, gymId, userId, BILLING);
  return await staffView(deps, org, userId, entryId);
}

export async function saveMemberCard(deps: PaymentsDeps, userId: string, gymId: string, entryId: string, body: SaveCardRequest): Promise<MemberCardResponse> {
  const { org } = await requireWritablePrivilege(deps, gymId, userId, BILLING);
  await save(deps, { gymId, entryId, screen: "desk", userId, body });
  return await staffView(deps, org, userId, entryId);
}

/** Remove card: Square stops it, then the record lets go of it. Pressed twice, removed once. */
export async function removeMemberCard(deps: PaymentsDeps, userId: string, gymId: string, entryId: string): Promise<MemberCardResponse> {
  const { org } = await requireWritablePrivilege(deps, gymId, userId, BILLING);
  const gym = await repo.readGym(deps.sql, gymId);
  if (gym === null) throw orgNotFound();
  if ((await cards.readPerson(deps.sql, gymId, entryId)) === null) throw entryNotFound();
  const ready = await readyOrThrow(deps, gymId, gym);
  const card = shownCard(await cards.readCard(deps.sql, gymId, entryId), ready.square, ready.row);
  if (card !== null) {
    const result = await ready.square.api.disableCard(ready.token, card.cardId);
    if (result.kind === "unavailable") throw unavailable();
    if (result.kind === "refused" && result.status === 401) throw connectionRefused();
    // Square no longer having the card is as good as stopped; any other refusal is not.
    if (result.kind === "refused" && result.status !== 404) {
      deps.log.error({ event: "square.card_disable_refused", gymId, status: result.status, code: result.code }, "Square refused to stop a card");
      throw unavailable();
    }
    await deps.sql.begin(async (tx) => {
      await lockGym(tx, gymId);
      if (!(await cards.deleteCard(tx, gymId, entryId, card.cardId))) return;
      await insertAudit(tx, {
        actorUserId: userId,
        gymId,
        action: "org.member_card_removed",
        targetType: "member_list_entry",
        targetId: entryId,
        meta: { brand: card.brand, last4: card.last4 },
      });
    });
  }
  return await staffView(deps, org, userId, entryId);
}

type Limit = () => Promise<boolean>;

/** The member's own record (their live account alone holds it), or 404 for anybody who is not
 *  a live member of the gym. */
async function ownRecord(deps: PaymentsDeps, gymId: string, userId: string): Promise<{ own: string | null; record: "own" | "none" | "shared" }> {
  const reader = await readerOf(deps.sql, gymId, userId);
  if (reader === null) throw orgNotFound();
  if (reader.entryId === null) return { own: null, record: "none" };
  return reader.holders === 1 ? { own: reader.entryId, record: "own" } : { own: null, record: "shared" };
}

async function myView(deps: PaymentsDeps, gymId: string, mine: { own: string | null; record: "own" | "none" | "shared" }): Promise<MyCardResponse> {
  const gym = await repo.readGym(deps.sql, gymId);
  if (gym === null) throw orgNotFound();
  const row = deps.square === null ? null : await repo.readConnection(deps.sql, gymId, deps.square.environment);
  const state = stateOf(deps.square, gym, row);
  const base = { record: mine.record, state, card: null, earlierCard: null, paidBy: null, canSave: false, gymName: gym.name, agreement: cardAgreementWords(gym.name), form: null };
  if (mine.own === null) return myCardResponseSchema.parse({ myCard: base });
  const [person, card, payer, live] = await Promise.all([
    cards.readPerson(deps.sql, gymId, mine.own),
    cards.readCard(deps.sql, gymId, mine.own),
    payerOf(deps.sql, gymId, mine.own),
    gymHasLivePlan(deps.sql, gymId),
  ]);
  if (person === null) return myCardResponseSchema.parse({ myCard: { ...base, record: "none" } });
  const shown = shownCard(card, deps.square, row);
  const canSave = state === "ready" && live && payer === null;
  return myCardResponseSchema.parse({
    myCard: {
      ...base,
      card: shown === null ? null : cardOf(shown, dayInTz(deps.now(), gym.timezone)),
      earlierCard: earlierOf(card, shown),
      paidBy: payer === null ? null : payer.name,
      canSave,
      form: canSave && deps.square !== null && row !== null ? formOf(deps.square, row, gym, person) : null,
    },
  });
}

/** The member's own card, for the phone. Membership first and the limit after it: a stranger's
 *  404 is never a 429. */
export async function readMyCard(deps: PaymentsDeps, userId: string, gymId: string, limit: Limit): Promise<MyCardResponse | null> {
  const mine = await ownRecord(deps, gymId, userId);
  if (!(await limit())) return null;
  return await myView(deps, gymId, mine);
}

/** The member adds or updates their own card in the app. There is no remove: the desk does it. */
export async function saveMyCard(deps: PaymentsDeps, userId: string, gymId: string, body: SaveCardRequest, limit: Limit): Promise<MyCardResponse | null> {
  const mine = await ownRecord(deps, gymId, userId);
  if (!(await limit())) return null;
  if (mine.own === null) throw new OrgsError(409, "card_not_your_record", MEMBER_CARD_WORDS.not_your_card);
  if (!(await gymHasLivePlan(deps.sql, gymId))) throw new OrgsError(409, "card_not_taken", MEMBER_CARD_WORDS.not_taken);
  await save(deps, { gymId, entryId: mine.own, screen: "app", userId, body });
  return await myView(deps, gymId, mine);
}

/** Square's answer to a customer or a card, in the words the screen shows. A rule over Square's
 *  own codes (its `ErrorCode` list, read 2026-10-20; a card's own check answers VERIFY_CVV_FAILURE
 *  and VERIFY_AVS_FAILURE): a code it does not name is "not saved". */
export function cardRefusalOf(status: number, code: string): { code: string; status: number; words: string } {
  const refusal = (key: keyof typeof MEMBER_CARD_WORDS): { code: string; status: number; words: string } => ({ code: `card_${key}`, status: 409, words: MEMBER_CARD_WORDS[key] });
  if (code === "CARD_PROCESSING_NOT_ENABLED") return refusal("processing_off");
  if (status === 401 || code === "INSUFFICIENT_SCOPES" || code === "ACCESS_TOKEN_EXPIRED" || code === "ACCESS_TOKEN_REVOKED") return refusal("connection_refused");
  if (code === "CARD_DECLINED_VERIFICATION_REQUIRED") return refusal("verification");
  if (["SOURCE_EXPIRED", "SOURCE_USED", "CARD_TOKEN_EXPIRED", "CARD_TOKEN_USED", "IDEMPOTENCY_KEY_REUSED"].includes(code)) return refusal("form_expired");
  if (code === "CUSTOMER_NOT_FOUND") return refusal("customer_gone");
  if (["INVALID_EMAIL_ADDRESS", "INVALID_PHONE_NUMBER", "CUSTOMER_MISSING_NAME", "CUSTOMER_MISSING_EMAIL"].includes(code)) return refusal("contact_refused");
  if (code === "CARD_EXPIRED") return refusal("expired");
  if (["UNSUPPORTED_CARD_BRAND", "CARD_NOT_SUPPORTED", "MANUALLY_ENTERED_PAYMENT_NOT_SUPPORTED", "UNSUPPORTED_INSTRUMENT_TYPE"].includes(code)) return refusal("not_supported");
  if (
    [
      "INVALID_CARD_DATA",
      "INVALID_CARD",
      "INVALID_ENCRYPTED_CARD",
      "INVALID_EXPIRATION",
      "INVALID_EXPIRATION_YEAR",
      "INVALID_EXPIRATION_DATE",
      "BAD_EXPIRATION",
      "EXPIRATION_FAILURE",
      "CVV_FAILURE",
      "VERIFY_CVV_FAILURE",
      "ADDRESS_VERIFICATION_FAILURE",
      "VERIFY_AVS_FAILURE",
      "INVALID_POSTAL_CODE",
      "PAN_FAILURE",
    ].includes(code)
  ) {
    return refusal("invalid");
  }
  if (["GENERIC_DECLINE", "CARD_DECLINED", "CARD_DECLINED_CALL_ISSUER", "INSUFFICIENT_FUNDS", "INVALID_ACCOUNT", "ACCOUNT_UNUSABLE", "TRANSACTION_LIMIT", "PAYMENT_LIMIT_EXCEEDED"].includes(code)) {
    return refusal("declined");
  }
  return refusal("not_saved");
}

function refusalError(result: Exclude<SquareResult<unknown>, { kind: "ok" }>): OrgsError {
  if (result.kind === "unavailable") return unavailable();
  const r = cardRefusalOf(result.status, result.code);
  return new OrgsError(r.status, r.code, r.words);
}

/** The person's customer in the gym's Square account, made once. The first save claims a row
 *  with the key Square is asked with, and every save for that person meanwhile asks with that
 *  same key, so Square makes one customer; nothing holds the database while Square answers. A
 *  key Square refused is let go, so the next save asks afresh; one Square did not answer is kept,
 *  so the next save gets back what Square may have made. */
async function customerFor(deps: PaymentsDeps, ready: Ready, gymId: string, person: cards.CardPerson): Promise<string> {
  const key = { gymId, entryId: person.entryId, environment: ready.square.environment, accountId: ready.row.accountId };
  const claimed = await cards.claimCustomer(deps.sql, key, randomUUID());
  if ("customerId" in claimed) return claimed.customerId;
  const { givenName, familyName } = cardNameParts(person.fullName);
  const result = await ready.square.api.createCustomer(ready.token, {
    idempotencyKey: claimed.makingKey,
    givenName: givenName === "" ? null : givenName,
    familyName: familyName === "" ? null : familyName,
    email: person.email,
    // Square needs a name, an email or a phone: every record has an email or a phone.
    phone: givenName === "" && person.email === null ? person.phone : null,
    referenceId: person.entryId,
  });
  if (result.kind !== "ok") {
    if (result.kind === "refused") {
      deps.log.warn({ event: "square.customer_refused", gymId, status: result.status, code: result.code }, "Square refused a customer");
      await cards.abandonCustomer(deps.sql, key, claimed.makingKey);
    }
    throw refusalError(result);
  }
  if (await cards.finishCustomer(deps.sql, key, claimed.makingKey, result.value.id)) return result.value.id;
  // Another save wrote it first, asked with the same key: Square's answer is the same customer.
  const now = await cards.claimCustomer(deps.sql, key, randomUUID());
  return "customerId" in now ? now.customerId : result.value.id;
}

interface SaveFor {
  gymId: string;
  entryId: string;
  screen: "desk" | "app";
  /** Whose screen it was: the member of staff at the desk, or the member in the app. */
  userId: string;
  body: SaveCardRequest;
}

async function save(deps: PaymentsDeps, s: SaveFor): Promise<void> {
  const gym = await repo.readGym(deps.sql, s.gymId);
  if (gym === null) throw orgNotFound();
  const person = await cards.readPerson(deps.sql, s.gymId, s.entryId);
  if (person === null) throw entryNotFound();
  // Kept word for word: what the person read is what they agreed to.
  const words = cardAgreementWords(gym.name);
  if (s.body.agreement !== words) throw new OrgsError(409, "card_agreement_changed", MEMBER_CARD_WORDS.agreement_changed);
  const ready = await readyOrThrow(deps, s.gymId, gym);
  const payer = await payerOf(deps.sql, s.gymId, s.entryId);
  if (payer !== null) throw paidBy(payer.name, person.fullName);

  const customerId = await customerFor(deps, ready, s.gymId, person);
  const created = await ready.square.api.createCard(ready.token, { idempotencyKey: s.body.requestKey, sourceId: s.body.sourceId, customerId, cardholderName: null });
  if (created.kind !== "ok") {
    if (created.kind === "refused") {
      deps.log.warn({ event: "square.card_refused", gymId: s.gymId, status: created.status, code: created.code }, "Square refused a card");
      // The gym deleted the customer inside Square: the next save makes a new one.
      if (created.code === "CUSTOMER_NOT_FOUND") await cards.dropCustomer(deps.sql, s.gymId, s.entryId, ready.square.environment, ready.row.accountId, customerId);
    }
    throw refusalError(created);
  }
  const card = created.value;
  const environment = ready.square.environment;
  const accountId = ready.row.accountId;
  const letGo = async (): Promise<void> => {
    const id = await deps.sql.begin((tx) => cards.oweDisable(tx, { gymId: s.gymId, environment, accountId, cardId: card.id, notBefore: deps.now() }));
    await sendOwedCardDisables(deps, ready.square, [id]);
  };
  // What Square made is what was asked for: on this customer, in this account, usable, with
  // what a screen shows. Anything else is let go and never shown.
  const { last_4: last4, exp_month: expMonth, exp_year: expYear } = card;
  if (
    card.customer_id !== customerId ||
    (card.merchant_id !== undefined && card.merchant_id !== accountId) ||
    card.enabled === false ||
    last4 === undefined ||
    expMonth === undefined ||
    expYear === undefined
  ) {
    deps.log.error({ event: "square.card_unexpected", gymId: s.gymId }, "Square saved a card that is not the one asked for");
    await letGo();
    throw unavailable();
  }
  const brand = card.card_brand ?? "OTHER_BRAND";
  const now = deps.now();
  const outcome = await deps.sql.begin(async (tx) => {
    await lockGym(tx, s.gymId);
    // Still the gym's record, paid for by nobody, and the gym still connected to this account.
    const still = await cards.readPerson(tx, s.gymId, s.entryId);
    const payerNow = await payerOf(tx, s.gymId, s.entryId);
    const row = await repo.readConnection(tx, s.gymId, environment);
    if (still === null) return { kind: "gone" as const, owed: [await cards.oweDisable(tx, { gymId: s.gymId, environment, accountId, cardId: card.id, notBefore: now })] };
    if (payerNow !== null) return { kind: "paid_by" as const, payer: payerNow.name, owed: [await cards.oweDisable(tx, { gymId: s.gymId, environment, accountId, cardId: card.id, notBefore: now })] };
    if (row?.state !== "connected" || row.accountId !== accountId || row.connectedAt.getTime() !== ready.row.connectedAt.getTime()) {
      return { kind: "not_ready" as const, owed: [await cards.oweDisable(tx, { gymId: s.gymId, environment, accountId, cardId: card.id, notBefore: now })] };
    }
    const before = await cards.readCard(tx, s.gymId, s.entryId, true);
    // The same press sent twice: Square gave back the same card, already kept.
    if (before !== null && before.environment === environment && before.accountId === accountId && before.cardId === card.id) return { kind: "saved" as const, owed: [] };
    const agreementId = await cards.insertAgreement(tx, { gymId: s.gymId, entryId: s.entryId, words, screen: s.screen, screenUserId: s.userId, brand, last4, agreedAt: now });
    await cards.writeCard(tx, {
      gymId: s.gymId,
      entryId: s.entryId,
      environment,
      accountId,
      customerId,
      cardId: card.id,
      brand,
      last4,
      expMonth,
      expYear,
      savedFrom: s.screen,
      savedBy: s.userId,
      agreementId,
      at: now,
    });
    const owed = before === null ? [] : [await cards.oweDisable(tx, { gymId: s.gymId, environment: before.environment, accountId: before.accountId, cardId: before.cardId, notBefore: now })];
    await insertAudit(tx, {
      actorUserId: s.userId,
      gymId: s.gymId,
      // A member's own press is not something staff did (Staff activity, 4d).
      action: s.screen === "desk" ? "org.member_card_saved" : "member.card_saved",
      targetType: "member_list_entry",
      targetId: s.entryId,
      meta: { brand, last4, replacedBrand: before?.brand ?? null, replacedLast4: before?.last4 ?? null },
    });
    return { kind: "saved" as const, owed };
  });
  if (outcome.owed.length > 0) await sendOwedCardDisables(deps, ready.square, outcome.owed);
  if (outcome.kind === "gone") throw entryNotFound();
  if (outcome.kind === "paid_by") throw paidBy(outcome.payer, person.fullName);
  if (outcome.kind === "not_ready") throw notReady();
}

/** Tell Square to stop the cards it is owed a stop of (`ids`: only these); whatever Square does
 *  not answer, the worker sends later. A card in an account the gym is no longer connected to
 *  cannot be reached and is given up: the app no longer holds that account. */
export async function sendOwedCardDisables(
  deps: PaymentsDeps,
  square: SquareSettings,
  ids: readonly string[] | null,
  limit = 50,
  gymIds: readonly string[] | null = null,
): Promise<{ sent: number; deferred: number; givenUp: number }> {
  const run = { sent: 0, deferred: 0, givenUp: 0 };
  const now = deps.now();
  for (const owed of await cards.claimDueDisables(deps.sql, square.environment, now, 5 * 60_000, limit, ids, gymIds)) {
    const row = await repo.readConnection(deps.sql, owed.gymId, square.environment);
    const token = row?.state === "connected" && row.accountId === owed.accountId && row.accessToken !== null ? square.tokens.open(row.accessToken, accessContext(owed.gymId)) : null;
    if (token === null) {
      await cards.finishDisable(deps.sql, owed.id);
      deps.log.warn({ event: "square.card_disable_unreachable", disableId: owed.id }, "a card owed a stop is in a Square account this gym is no longer connected to");
      run.givenUp += 1;
      continue;
    }
    const result = await square.api.disableCard(token, owed.cardId);
    // Done when Square stopped it or no longer has it. A 401 is a token that has lapsed while the
    // connection still reads connected: tried again, and given up only once the connection's own
    // check takes it off (the branch above) or the tries run out.
    if (result.kind === "ok" || (result.kind === "refused" && result.status === 404)) {
      await cards.finishDisable(deps.sql, owed.id);
      run.sent += 1;
      continue;
    }
    if (result.kind === "refused") {
      deps.log.error({ event: "square.card_disable_refused", disableId: owed.id, status: result.status, code: result.code }, "Square refused to stop a card");
    }
    if (owed.tries + 1 >= REVOKE_MAX_TRIES) {
      await cards.finishDisable(deps.sql, owed.id);
      deps.log.error({ event: "square.card_disable_given_up", disableId: owed.id }, "Square did not stop a card; given up");
      run.givenUp += 1;
      continue;
    }
    await cards.deferDisable(deps.sql, owed.id, new Date(now.getTime() + REVOKE_RETRY_MS * 2 ** Math.min(owed.tries, 6)));
    run.deferred += 1;
  }
  return run;
}

/** Square's message that the gym deleted a customer inside Square: Square is asked for the
 *  customer, with the gym's own token, before anything changes; only Square's own "not found"
 *  lets the record go of the customer and its card. */
export async function checkSquareCustomer(deps: PaymentsDeps, square: SquareSettings, accountId: string, customerId: string): Promise<"done" | "unknown"> {
  let unknown = false;
  for (const record of await cards.recordsOfSquareCustomer(deps.sql, square.environment, accountId, customerId)) {
    const row = await repo.readConnection(deps.sql, record.gymId, square.environment);
    if (row?.state !== "connected" || row.accountId !== accountId || row.accessToken === null) continue;
    const token = square.tokens.open(row.accessToken, accessContext(record.gymId));
    if (token === null) continue;
    const result = await square.api.retrieveCustomer(token, customerId);
    if (result.kind === "ok" || (result.kind === "refused" && result.status === 401)) continue;
    if (result.kind === "unavailable" || result.status !== 404) {
      if (result.kind === "refused") deps.log.error({ event: "square.customer_check_refused", gymId: record.gymId, status: result.status, code: result.code }, "Square refused a customer check");
      unknown = true;
      continue;
    }
    const owed = await deps.sql.begin(async (tx) => {
      await lockGym(tx, record.gymId);
      const card = await cards.letGoOfSquareCustomer(tx, { ...record, environment: square.environment, accountId, customerId, at: deps.now() });
      if (card === null) return null;
      await insertAudit(tx, {
        actorUserId: null,
        gymId: record.gymId,
        action: "org.member_card_removed_in_square",
        targetType: "member_list_entry",
        targetId: record.entryId,
        meta: { brand: card.brand, last4: card.last4 },
      });
      return card.disableId;
    });
    // Square keeps the card of a customer it deleted, still on: it is told to stop it.
    if (owed !== null) await sendOwedCardDisables(deps, square, [owed]);
  }
  return unknown ? "unknown" : "done";
}

/** Square's message about a card (a bank updated it, or it was stopped or forgotten): Square is
 *  asked for the card itself, with the gym's own token, before anything changes. "unknown":
 *  Square could not be asked, so the message is tried again later. */
export async function checkSquareCard(deps: PaymentsDeps, square: SquareSettings, accountId: string, cardId: string): Promise<"done" | "unknown"> {
  let unknown = false;
  for (const card of await cards.cardsOfSquareCard(deps.sql, square.environment, accountId, cardId)) {
    const row = await repo.readConnection(deps.sql, card.gymId, square.environment);
    // Not connected to that account: the card is not shown, and there is nothing to ask with.
    if (row?.state !== "connected" || row.accountId !== accountId || row.accessToken === null) continue;
    const token = square.tokens.open(row.accessToken, accessContext(card.gymId));
    if (token === null) continue;
    const result = await square.api.retrieveCard(token, cardId);
    if (result.kind === "unavailable") {
      unknown = true;
      continue;
    }
    if (result.kind === "refused" && result.status === 401) continue;
    if (result.kind === "refused" && result.status !== 404) {
      deps.log.error({ event: "square.card_check_refused", gymId: card.gymId, status: result.status, code: result.code }, "Square refused a card check");
      unknown = true;
      continue;
    }
    const now = result.kind === "ok" ? result.value : null;
    if (now !== null && now.enabled !== false && now.last_4 !== undefined && now.exp_month !== undefined && now.exp_year !== undefined) {
      await cards.updateCardDetails(deps.sql, {
        gymId: card.gymId,
        entryId: card.entryId,
        cardId,
        brand: now.card_brand ?? card.brand,
        last4: now.last_4,
        expMonth: now.exp_month,
        expYear: now.exp_year,
        at: deps.now(),
      });
      continue;
    }
    // Stopped or forgotten inside Square: the record no longer has a card.
    await deps.sql.begin(async (tx) => {
      await lockGym(tx, card.gymId);
      if (!(await cards.deleteCard(tx, card.gymId, card.entryId, cardId))) return;
      await insertAudit(tx, {
        actorUserId: null,
        gymId: card.gymId,
        action: "org.member_card_removed_in_square",
        targetType: "member_list_entry",
        targetId: card.entryId,
        meta: { brand: card.brand, last4: card.last4 },
      });
    });
  }
  return unknown ? "unknown" : "done";
}
