// PAYMENTS TO MATCH (ROADMAP 18d-iii-b-ii-a; spec Part 3 §14.8; rulings/2026-10-25-18d-iii-b-ii-a.md).
//
// The gym's payments from Square Point of Sale, every one waiting for staff who take payments (Kd,
// 2026-10-25, "one press"): the list, with the bill each fits ticked where its reason leaves no doubt
// (`paymentsToMatchBills.ts`), Match's box for one person, Match, Not for a bill and its Undo.
//
// THE WORST THING here is a member charged twice, or one payment counted twice. So Match first asks
// Square for the payment (never one Square has refunded or no longer shows as taken), then puts it on the
// bill under the gym's lock with the row as it stands then, by the same step Record payment takes
// (`recordPaymentIn`, `recordFeePaymentIn`): one Square payment stands on one bill, the same press sent
// twice is one, and a membership with money out on the Square Terminal or the card on file waits. While a
// payment waits, the card on file of its person is not charged by anybody (`squareAppWaitsFor` in
// `startCharge`), and what the list says of that is read by the same rule.
import {
  PAYMENTS_TO_MATCH_PAGE,
  PAYMENTS_TO_MATCH_WORDS,
  matchBillsResponseSchema,
  matchPaymentResponseSchema,
  paymentToMatchStateResponseSchema,
  paymentsToMatchResponseSchema,
  paymentsToMatchSummarySchema,
  squareMadeByMerge,
  type MatchBillsResponse,
  type MatchLinkOffer,
  type MatchLinkResult,
  type MatchPaid,
  type MatchPaymentRequest,
  type MatchPaymentResponse,
  type NotABillRequest,
  type PaymentToMatch,
  type PaymentToMatchStateResponse,
  type PaymentsToMatchResponse,
  type PaymentsToMatchSummary,
  type SalePerson,
} from "@app/shared";
import type { TransactionSql } from "postgres";
import { dayInTz } from "../../gamification/streak.js";
import { lockGym } from "../memberList/repo.js";
import { readCountry } from "../memberList/phone.js";
import { recordPaymentIn, type BillWriteOutcome } from "../memberships/billsRepo.js";
import { squareMoneyOut } from "../memberships/billsSql.js";
import { recordFeePaymentIn, type FeeWriteOutcome } from "../memberships/feesRepo.js";
import { insertAudit } from "../repo.js";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import { BILLING, orgNotFound, readyOrThrow, stateOf, type Ready } from "./cards.js";
import { billsOfPerson, boxTick, loadBills, ticksFor } from "./paymentsToMatchBills.js";
import * as toMatch from "./paymentsToMatchRepo.js";
import * as repo from "./repo.js";
import { readsOrders, type PaymentsDeps } from "./service.js";
import { customerSeen } from "./squareAppPayments.js";
import { matchLinkOffer } from "./squareMatchLink.js";
import * as linking from "./squareMatchRepo.js";
import { recordIdsAmong } from "./squareMembersRepo.js";
import { unlinkedAt } from "./squareUnlinkRepo.js";

const NO_BILLING = "Recording payments isn't part of your role. Ask the owner to turn on \"Record members' payments\" for you.";
const W = PAYMENTS_TO_MATCH_WORDS;
const gone = (): OrgsError => new OrgsError(404, "payment_to_match_gone", W.gone);

/** The privileges Match and the person's page need, as Failed payments asks them, so nobody is shown a
 *  press they are refused. A write is refused while the console is read-only. */
export async function allowed(deps: PaymentsDeps, gymId: string, userId: string, write: boolean): Promise<repo.GymForPayments> {
  const { privileges } = write ? await requireWritablePrivilege(deps, gymId, userId, "members.confirm") : await requirePrivilege(deps, gymId, userId, "members.confirm");
  if (!privileges.includes(BILLING)) throw new OrgsError(403, "forbidden", NO_BILLING);
  const gym = await repo.readGym(deps.sql, gymId);
  if (gym === null) throw orgNotFound();
  return gym;
}

/** Square is connected at a location and reads what was sold: payments can be taken in Square Point of Sale. */
async function takesPointOfSale(deps: PaymentsDeps, gymId: string): Promise<boolean> {
  const square = deps.square;
  const row = square === null ? null : await repo.readConnection(deps.sql, gymId, square.environment);
  return row?.state === "connected" && row.locationId !== null && readsOrders(row);
}

/** How many wait, and what they come to: Overview's line, and the menu's count. */
export async function readToMatchSummary(deps: PaymentsDeps, userId: string, gymId: string): Promise<PaymentsToMatchSummary> {
  await allowed(deps, gymId, userId, false);
  const [totals, used, pointOfSale] = await Promise.all([toMatch.waitingTotals(deps.sql, gymId), toMatch.usesSquareApp(deps.sql, gymId), takesPointOfSale(deps, gymId)]);
  return paymentsToMatchSummarySchema.parse({ ...totals, used, pointOfSale });
}

/** A page of the list, from the `from`th payment. */
export async function readPaymentsToMatch(deps: PaymentsDeps, userId: string, gymId: string, from: number): Promise<PaymentsToMatchResponse> {
  const gym = await allowed(deps, gymId, userId, false);
  const [totals, page, used] = await Promise.all([
    toMatch.waitingTotals(deps.sql, gymId),
    toMatch.waitingPage(deps.sql, gymId, from, PAYMENTS_TO_MATCH_PAGE),
    toMatch.usesSquareApp(deps.sql, gymId),
  ]);
  const square = deps.square;
  const connection = square === null ? null : await repo.readConnection(deps.sql, gymId, square.environment);
  const people = [...new Set(page.flatMap((p) => (p.entryId === null ? [] : [p.entryId])))];
  const today = dayInTz(deps.now(), gym.timezone);
  const [held, ticks] = await Promise.all([toMatch.cardHeldFor(deps.sql, gymId, people), ticksFor(deps.sql, gymId, today, page)]);
  // A customer linked to more than one record: whose, by name. Every row of one gym is of its account.
  const several = page.filter((p) => p.reason === "several_people" && p.customerId !== null);
  const names = new Map<string, string[]>();
  for (const p of several) {
    if (p.customerId === null || names.has(`${p.environment}:${p.accountId}:${p.customerId}`)) continue;
    const found = await toMatch.linkedNames(deps.sql, { gymId, environment: p.environment, accountId: p.accountId, customerIds: [p.customerId] });
    names.set(`${p.environment}:${p.accountId}:${p.customerId}`, found.get(p.customerId) ?? []);
  }
  // Who Match fills in for a customer linked to nobody: the one record with Square's email or phone.
  const suggested = new Map<string, SalePerson | null>();
  for (const p of page) {
    if (p.person !== null || p.customer === null) continue;
    const key = `${p.customer.email ?? ""}|${p.customer.phone ?? ""}`;
    if (!suggested.has(key)) suggested.set(key, await toMatch.onlyRecordWith(deps.sql, gymId, p.customer));
  }
  const payments: PaymentToMatch[] = page.map((p) => ({
    id: p.id,
    takenAt: p.takenAt.toISOString(),
    amountMinor: p.amountMinor,
    tipMinor: p.tipMinor,
    currency: p.currency,
    enteredMinor: p.enteredMinor,
    refundedMinor: p.refundedMinor,
    card: p.brand !== null && p.last4 !== null ? { brand: p.brand, last4: p.last4 } : null,
    source: p.brand !== null && p.last4 !== null ? null : p.source,
    customer: p.person === null ? p.customer : null,
    person: p.person,
    linkedNames: p.customerId === null ? [] : (names.get(`${p.environment}:${p.accountId}:${p.customerId}`) ?? []),
    suggested: p.person ?? (p.customer === null ? null : (suggested.get(`${p.customer.email ?? ""}|${p.customer.phone ?? ""}`) ?? null)),
    reason: ticks.get(p.id)?.reason ?? p.reason,
    holdsCard: p.entryId !== null && held.has(p.entryId),
    deviceName: p.deviceName,
    bill: ticks.get(p.id)?.bill ?? null,
  }));
  const next = from + PAYMENTS_TO_MATCH_PAGE < totals.count ? from + PAYMENTS_TO_MATCH_PAGE : null;
  const ready = square !== null && connection !== null && stateOf(square, gym, connection) === "ready";
  // Another gym here at the same Square location: what nobody picked there is neither's, said with its count.
  const sharedLocation =
    square !== null && connection?.state === "connected" && connection.locationId !== null
      ? await toMatch.sharedLocationCount(deps.sql, { gymId, environment: square.environment, accountId: connection.accountId, locationId: connection.locationId })
      : 0;
  const pointOfSale = connection?.state === "connected" && connection.locationId !== null && readsOrders(connection);
  return paymentsToMatchResponseSchema.parse({ ...totals, used, pointOfSale, payments, today, next, square: ready, sharedLocation });
}

/** One of the gym's payments that waits, or why it is not on the list now. */
async function waiting(deps: PaymentsDeps, gymId: string, paymentId: string): Promise<toMatch.TakenRow> {
  const row = await toMatch.readTaken(deps.sql, gymId, paymentId);
  if (row === null || row.state === "shop_sale") throw gone();
  if (row.state === "recorded") throw new OrgsError(409, "payment_to_match_matched", W.matched);
  if (row.state === "not_bill") throw new OrgsError(409, "payment_to_match_marked", W.marked);
  return row;
}

/** What Match puts on the bill: the part staff entered, where Square showed it; else what the screen
 *  says, up to the whole payment. */
const forTheBill = (row: toMatch.TakenRow): number | null => row.enteredMinor ?? null;

/** What the box offers to do about Square's customer on the payment for the person picked as who paid (18d-iii-b-ii-c):
 *  nothing where the payment has no customer, the customer was somebody's when it was taken in, or already is this
 *  person's, or they are a past member; the customer is somebody else's here (`taken`); or link them, the tick on where
 *  the app can tell they are the same person (`link`) and off where it cannot (`ask`). */
async function linkOfferFor(deps: PaymentsDeps, gym: repo.GymForPayments, gymId: string, row: toMatch.TakenRow, entryId: string): Promise<MatchLinkOffer | null> {
  if (row.customerId === null || row.entryId !== null) return null;
  const person = await linking.readLinkPerson(deps.sql, gymId, entryId);
  if (person === null || person.past) return null;
  const holders = await linking.holdersOf(deps.sql, { gymId, environment: row.environment, accountId: row.accountId, customerId: row.customerId });
  const customerName = row.customer?.name ?? null;
  if (holders.some((h) => h.gymId === gymId && h.entryId === entryId)) return null;
  if (holders.length > 0) {
    // Somebody here, named; or only somebody at another business on the same Square account, never named here and never
    // called "here" (round one, High 1).
    if (!holders.some((h) => h.gymId === gymId)) return { offer: "taken", customerName, also: false, byName: null, elsewhere: true };
    const names = (await toMatch.linkedNames(deps.sql, { gymId, environment: row.environment, accountId: row.accountId, customerIds: [row.customerId] })).get(row.customerId) ?? [];
    return { offer: "taken", customerName, also: false, byName: names.length === 0 ? null : names.join(", "), elsewhere: false };
  }
  const offer = matchLinkOffer(row.customer, { entryId, fullName: person.fullName, email: person.email, phoneE164: person.phoneE164 }, readCountry(gym.country));
  const also = await linking.hasOwnCustomer(deps.sql, { gymId, entryId, environment: row.environment, accountId: row.accountId });
  // Staff unlinked this customer from them on their page (18d-iii-b-ii-c-ii): off, whatever the rule says, until staff tick it.
  const unlinked = await unlinkedAt(deps.sql, { gymId, entryId, environment: row.environment, accountId: row.accountId, customerId: row.customerId });
  if (unlinked !== null) return { offer: "ask", customerName, also, byName: null, elsewhere: false, unlinkedAt: unlinked.toISOString() };
  return { offer, customerName, also, byName: null, elsewhere: false };
}

/** Match's box, for one person: the bills a payment can go on, theirs and those of anybody they pay for,
 *  by the rules Record payment takes them by, and their newest payments, so one already recorded by hand
 *  is seen. */
export async function readMatchBills(deps: PaymentsDeps, userId: string, gymId: string, paymentId: string, entryId: string): Promise<MatchBillsResponse> {
  const gym = await allowed(deps, gymId, userId, false);
  const row = await waiting(deps, gymId, paymentId);
  const today = dayInTz(deps.now(), gym.timezone);
  const loaded = await loadBills(deps.sql, gymId, [entryId], today);
  const people = loaded.people.get(entryId);
  const person = people?.[0];
  if (people === undefined || person === undefined) throw new OrgsError(404, "entry_not_found", "That person was not found on your list.");
  const { memberships, bills, payments } = loaded;
  const amount = forTheBill(row) ?? row.amountMinor;
  const nameOf = new Map(people.map((p) => [p.entryId, p] as const));
  const out = billsOfPerson(loaded, entryId, amount, row.currency);
  // Ticked only where the rule leaves no doubt which, as the list ticks it: never where staff choose.
  const suggested = row.reason === null ? -1 : boxTick(loaded, row.reason, entryId, out, amount, today);
  const paid: MatchPaid[] = [...payments]
    .sort((a, b) => (a.paidOn < b.paidOn ? 1 : a.paidOn > b.paidOn ? -1 : b.seq - a.seq))
    .slice(0, 5)
    .map((p) => {
      const owner = memberships.find((m) => m.id === p.membershipId);
      const bill = bills.find((b) => b.id === p.billId);
      return {
        amountMinor: p.amountMinor,
        currency: bill?.currency ?? row.currency,
        paidOn: p.paidOn,
        method: p.method,
        forName: owner === undefined || owner.entryId === person.entryId ? null : (nameOf.get(owner.entryId)?.name ?? null),
      };
    });
  return matchBillsResponseSchema.parse({
    person: { entryId: person.entryId, name: person.name, memberNumber: person.memberNumber, email: person.email, past: person.past },
    today,
    amountMinor: forTheBill(row),
    bills: out.slice(0, 200),
    suggested: suggested < 0 ? null : suggested,
    paid,
    link: await linkOfferFor(deps, gym, gymId, row, entryId),
  });
}

/** A press of Match again, after its payment went on the bill: the same answer, where it asks for that same
 *  bill and amount; the key with anything else in it is refused, never answered as matched. */
async function matchedAnswer(
  deps: PaymentsDeps,
  gymId: string,
  row: toMatch.TakenRow,
  body: MatchPaymentRequest | null = null,
  link: MatchLinkResult | null = null,
  linkTo: string | null = body?.linkTo ?? null,
): Promise<MatchPaymentResponse> {
  const [paid] = await deps.sql<
    { amount_minor: number; currency: string; receipt_number: number; entry_id: string; full_name: string; held_membership_id: string; bill_id: string; period_index: number | null; fee: string | null }[]
  >`
    SELECT p.amount_minor, p.currency, p.receipt_number, h.entry_id, e.full_name, b.held_membership_id, b.id AS bill_id, b.period_index, b.fee
    FROM gym_member_payments p
    JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
    JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
    JOIN gym_member_list_entries e ON e.gym_id = h.gym_id AND e.id = h.entry_id
    WHERE p.gym_id = ${gymId} AND p.id = ${row.memberPaymentId}`;
  if (paid === undefined) throw gone();
  const sameBill = body === null || (body.target.kind === "fee" ? paid.bill_id === body.target.billId : paid.fee === null && paid.period_index === body.target.periodIndex);
  if (body !== null && (paid.entry_id !== body.entryId || paid.held_membership_id !== body.membershipId || paid.amount_minor !== body.amountMinor || !sameBill)) {
    throw new OrgsError(409, "payment_to_match_key_reused", W.key_reused);
  }
  // The same press again is told what the first did about Square's customer, kept with the payment, and the name of the
  // person it named, as the record is now (round one, Low 3); Square's details of the customer went with the match.
  const result = linkResultOf(row.linkResult);
  const named = link === null && result !== "none" && linkTo !== null ? await linking.readLinkPerson(deps.sql, gymId, linkTo) : null;
  const told = link ?? { result, customerName: null, personName: named?.fullName ?? null };
  return matchPaymentResponseSchema.parse({
    matched: { entryId: paid.entry_id, name: paid.full_name, amountMinor: paid.amount_minor, currency: paid.currency, receiptNumber: paid.receipt_number, link: told },
  });
}

const linkResultOf = (kept: string | null): MatchLinkResult["result"] =>
  kept === "linked" || kept === "also" || kept === "taken" || kept === "gone" || kept === "merged" || kept === "unchecked" || kept === "past" ? kept : "none";

/** Square's customer on the payment, asked for before the payment goes on its bill, and what is to be done about linking
 *  it: asked with Square's own answer, outside every lock. */
type LinkAsk = { kind: "none" } | { kind: "result"; result: "gone" | "merged" | "unchecked" | "past"; customerName: string | null; personName: string } | { kind: "link"; customerName: string | null; personName: string; referenceOf: string | null };

/** What a write answers, and the people whose page reads again: the bill's, and the payment's person. */
export interface Told<T> {
  answer: T;
  entryIds: string[];
}

const peopleTold = (...ids: (string | null)[]): string[] => [...new Set(ids.filter((id): id is string => id !== null))];

/** Match: the payment goes on the bill picked, as Square Point of Sale, once. */
export async function matchPayment(deps: PaymentsDeps, userId: string, gymId: string, paymentId: string, body: MatchPaymentRequest): Promise<Told<MatchPaymentResponse>> {
  const gym = await allowed(deps, gymId, userId, true);
  const first = await toMatch.readTaken(deps.sql, gymId, paymentId);
  if (first === null || first.state === "shop_sale") throw gone();
  // The same press again, after it went on the bill: the same answer.
  if (first.state === "recorded" && first.recordKey === body.requestKey && first.memberPaymentId !== null) {
    return { answer: await matchedAnswer(deps, gymId, first, body), entryIds: [] };
  }
  const row = await waiting(deps, gymId, paymentId);
  const entered = forTheBill(row);
  // What the screen showed going on the bill: the part entered, where Square showed it; else up to all of it.
  if (entered !== null ? body.amountMinor !== entered : body.amountMinor > row.amountMinor) throw new OrgsError(409, "payment_to_match_changed", W.changed);

  // Square is asked first, outside every lock: never a payment it has given money back on, or no longer
  // shows as taken. The token is the gym's own, in the account the payment was taken in.
  const ready = await readyOrThrow(deps, gymId, gym);
  if (ready.row.accountId !== row.accountId || ready.square.environment !== row.environment) throw new OrgsError(409, "payment_to_match_other_account", W.other_account);
  const read = await ready.square.api.getPayment(ready.token, row.squarePaymentId);
  if (read.kind === "unavailable") throw new OrgsError(503, "square_unavailable", W.square_unavailable);
  if (read.kind === "refused") throw new OrgsError(409, "payment_to_match_not_completed", W.not_completed);
  const payment = read.value;
  if (payment.status !== "COMPLETED") throw new OrgsError(409, "payment_to_match_not_completed", W.not_completed);
  if (payment.amount_money.amount !== row.amountMinor || payment.amount_money.currency !== row.currency) throw new OrgsError(409, "payment_to_match_changed", W.changed);
  const refunded = Math.max(0, payment.refunded_money?.amount ?? 0);
  if (refunded > 0) {
    await deps.sql.begin(async (tx) => {
      await lockGym(tx, gymId);
      await toMatch.markRefunded(tx, gymId, paymentId, refunded, deps.now());
    });
    throw new OrgsError(409, "payment_to_match_refunded", W.refunded);
  }

  // Staff asked for Square's customer on it to be linked to the person who paid: Square is asked about that customer too,
  // outside every lock, so a customer it has merged or deleted since is never linked by an old number.
  const asked = body.linkTo === null || row.customerId === null || row.entryId !== null ? ({ kind: "none" } as const) : await askAboutLink(deps, ready, gymId, row, { ...body, linkTo: body.linkTo }, row.customerId);

  const now = deps.now();
  const today = dayInTz(now, gym.timezone);
  const done = await deps.sql.begin(async (tx) => {
    // The gym's lock first, as every payment by hand takes it, then the row as it stands under it.
    await lockGym(tx, gymId);
    const locked = await toMatch.readTaken(tx, gymId, paymentId, true);
    if (locked === null || locked.state === "shop_sale") throw gone();
    if (locked.state === "recorded") {
      if (locked.recordKey === body.requestKey) return { row: locked, link: null, told: [] };
      throw new OrgsError(409, "payment_to_match_matched", W.matched);
    }
    if (locked.state === "not_bill") throw new OrgsError(409, "payment_to_match_marked", W.marked);
    if (locked.amountMinor !== row.amountMinor || locked.enteredMinor !== row.enteredMinor) throw new OrgsError(409, "payment_to_match_changed", W.changed);
    // Recorded as Square's own answer, the step does not ask this itself: money out on the Terminal or the
    // card on file for the membership would be taken twice.
    if ((await squareMoneyOut(tx, gymId, body.membershipId)) !== null) throw new OrgsError(409, "payment_to_match_busy", W.busy);
    const paying = {
      gymId,
      entryId: body.entryId,
      membershipId: body.membershipId,
      requestKey: body.requestKey,
      amountMinor: body.amountMinor,
      method: "square_app" as const,
      provider: { name: "square", paymentId: locked.squarePaymentId },
      today,
      actorUserId: userId,
      now,
    };
    const recorded =
      body.target.kind === "fee" ? await recordFeePaymentIn(tx, { ...paying, billId: body.target.billId }) : await recordPaymentIn(tx, { ...paying, periodIndex: body.target.periodIndex });
    if (recorded.kind !== "recorded") throw refusal(recorded);
    if (!(await toMatch.markMatched(tx, gymId, paymentId, { memberPaymentId: recorded.paymentId, entryId: body.entryId, recordKey: body.requestKey }, now))) {
      throw new Error("a payment to match was not marked under the gym's lock");
    }
    // The customer is linked in the same step: the payment is on its bill and the customer is the person's, or neither.
    const linked = await linkInStep(tx, { asked, gymId, userId, paymentId, row: locked, linkTo: body.linkTo, now });
    return { row: { ...locked, state: "recorded", memberPaymentId: recorded.paymentId, recordKey: body.requestKey }, link: linked.link, told: linked.told };
  });
  return { answer: await matchedAnswer(deps, gymId, done.row, null, done.link, body.linkTo), entryIds: peopleTold(body.entryId, row.entryId, ...done.told) };
}

/** Square's customer on the payment, asked for: what is to be done about linking it to the person who paid. The person must
 *  be this gym's, and the bill must be theirs or of somebody they pay for. */
async function askAboutLink(
  deps: PaymentsDeps,
  ready: Ready,
  gymId: string,
  row: toMatch.TakenRow,
  body: MatchPaymentRequest & { linkTo: string },
  customerId: string,
): Promise<LinkAsk> {
  const person = await linking.readLinkPerson(deps.sql, gymId, body.linkTo);
  if (person === null) throw new OrgsError(404, "entry_not_found", "That person was not found on your list.");
  const theirs = (await toMatch.peopleOfMany(deps.sql, gymId, [body.linkTo])).get(body.linkTo) ?? [];
  if (!theirs.some((p) => p.entryId === body.entryId)) throw new OrgsError(409, "payment_to_match_changed", W.changed);
  const seen = row.customer?.name ?? null;
  if (person.past) return { kind: "result", result: "past", customerName: seen, personName: person.fullName };
  const read = await ready.square.api.retrieveCustomer(ready.token, customerId);
  if (read.kind === "unavailable") throw new OrgsError(503, "square_unavailable", W.square_unavailable);
  if (read.kind === "refused") return { kind: "result", result: read.status === 404 ? "gone" : "unchecked", customerName: seen, personName: person.fullName };
  const customerName = customerSeen(read.value)?.name ?? seen;
  if (read.value.id !== customerId) return { kind: "result", result: "merged", customerName, personName: person.fullName };
  // A customer carrying a record of this gym's id as its reference is that record's (the app made it, its answer lost).
  const reference = squareMadeByMerge(read.value) ? null : (read.value.reference_id ?? null);
  const referenceOf = reference !== null && (await recordIdsAmong(deps.sql, gymId, [reference])).has(reference) ? reference : null;
  return { kind: "link", customerName, personName: person.fullName, referenceOf };
}

/** Under the gym's lock, in the step that puts the payment on its bill: the customer linked as asked, the person's other
 *  waiting payments from it theirs, and what was done kept with the payment. The people whose page reads again. */
async function linkInStep(
  tx: TransactionSql,
  a: { asked: LinkAsk; gymId: string; userId: string; paymentId: string; row: toMatch.TakenRow; linkTo: string | null; now: Date },
): Promise<{ link: MatchLinkResult | null; told: string[] }> {
  const { asked } = a;
  if (asked.kind === "none" || a.linkTo === null || a.row.customerId === null) return { link: null, told: [] };
  if (asked.kind === "result") {
    await linking.setLinkResult(tx, a.gymId, a.paymentId, asked.result);
    return { link: { result: asked.result, customerName: asked.customerName, personName: asked.personName }, told: [] };
  }
  const at = { gymId: a.gymId, environment: a.row.environment, accountId: a.row.accountId, customerId: a.row.customerId };
  const outcome = await linking.linkMatched(tx, { ...at, entryId: a.linkTo, referenceOf: asked.referenceOf, now: a.now });
  const result: Exclude<MatchLinkResult["result"], "none"> = outcome === "already" ? "linked" : outcome;
  await linking.setLinkResult(tx, a.gymId, a.paymentId, result);
  if (outcome === "taken" || outcome === "past") return { link: { result, customerName: asked.customerName, personName: asked.personName }, told: [] };
  await linking.resolveWaiting(tx, { ...at, entryId: a.linkTo, now: a.now });
  if (outcome !== "already") {
    await insertAudit(tx, {
      actorUserId: a.userId,
      gymId: a.gymId,
      action: "org.square_customer_matched",
      targetType: "member_list_entry",
      targetId: a.linkTo,
      meta: { also: outcome === "also" ? "yes" : "no" },
    });
  }
  return { link: { result, customerName: asked.customerName, personName: asked.personName }, told: await linking.peopleHeldWith(tx, a.gymId, a.linkTo) };
}

/** Why the step Record payment takes would not put it on that bill, as staff read it. */
function refusal(outcome: BillWriteOutcome | FeeWriteOutcome): OrgsError {
  switch (outcome.kind) {
    case "entry_not_found":
      return new OrgsError(404, "entry_not_found", "That person was not found on your list.");
    case "membership_not_found":
    case "fee_not_found":
    case "bill_not_found":
    case "not_allowed":
    case "fee_changed":
      return new OrgsError(409, "payment_to_match_bill_changed", W.bill_changed);
    case "too_much":
      return new OrgsError(409, "payment_to_match_too_much", W.too_much);
    case "terminal_waiting":
    case "card_charging":
      return new OrgsError(409, "payment_to_match_busy", W.busy);
    case "request_reused":
      return new OrgsError(409, "payment_to_match_key_reused", W.key_reused);
    case "past_member":
      return new OrgsError(409, "payment_to_match_bill_changed", W.past_member);
    default:
      // A void's or a refund's answer, or `ok`: never what the step a payment is put on a bill by answers.
      return new OrgsError(409, "payment_to_match_bill_changed", W.bill_changed);
  }
}

/** Not a bill payment: off the list, for Staff activity with why. */
export async function markNotABill(deps: PaymentsDeps, userId: string, gymId: string, paymentId: string, body: NotABillRequest): Promise<Told<PaymentToMatchStateResponse>> {
  await allowed(deps, gymId, userId, true);
  const now = deps.now();
  return await deps.sql.begin(async (tx) => {
    await lockGym(tx, gymId);
    const row = await toMatch.readTaken(tx, gymId, paymentId, true);
    if (row === null || row.state === "shop_sale") throw gone();
    // Marked already: the same press again stands.
    if (row.state === "not_bill") return { answer: paymentToMatchStateResponseSchema.parse({ state: "not_bill", why: row.notBill }), entryIds: [] };
    if (row.state === "recorded") throw new OrgsError(409, "payment_to_match_matched", W.matched);
    if (!(await toMatch.markNotBill(tx, gymId, paymentId, body.why, now))) throw new Error("a payment to match was not marked under the gym's lock");
    await audit(tx, { userId, gymId, row, action: "org.square_app_payment_not_bill", why: body.why });
    return { answer: paymentToMatchStateResponseSchema.parse({ state: "not_bill", why: body.why }), entryIds: peopleTold(row.entryId) };
  });
}

/** Undo of Not a bill payment: back on the list, waiting as it was. */
export async function putBackToMatch(deps: PaymentsDeps, userId: string, gymId: string, paymentId: string): Promise<Told<PaymentToMatchStateResponse>> {
  await allowed(deps, gymId, userId, true);
  const now = deps.now();
  return await deps.sql.begin(async (tx) => {
    await lockGym(tx, gymId);
    const row = await toMatch.readTaken(tx, gymId, paymentId, true);
    if (row === null || row.state === "shop_sale") throw gone();
    if (row.state === "waiting") return { answer: paymentToMatchStateResponseSchema.parse({ state: "waiting", why: null }), entryIds: [] };
    if (row.state === "recorded") throw new OrgsError(409, "payment_to_match_matched", W.matched);
    if (!(await toMatch.putBack(tx, gymId, paymentId, now))) throw new Error("a payment to match was not put back under the gym's lock");
    await audit(tx, { userId, gymId, row, action: "org.square_app_payment_put_back", why: null });
    return { answer: paymentToMatchStateResponseSchema.parse({ state: "waiting", why: null }), entryIds: peopleTold(row.entryId) };
  });
}

async function audit(
  tx: TransactionSql,
  a: { userId: string; gymId: string; row: toMatch.TakenRow; action: string; why: "other" | "by_hand" | null },
): Promise<void> {
  await insertAudit(tx, {
    actorUserId: a.userId,
    gymId: a.gymId,
    action: a.action,
    targetType: "gym_square_app_payment",
    targetId: a.row.id,
    meta: {
      amountMinor: String(a.row.amountMinor),
      currency: a.row.currency,
      ...(a.why === null ? {} : { why: a.why }),
      ...(a.row.entryId === null ? {} : { entryId: a.row.entryId }),
    },
  });
}

