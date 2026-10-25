// PAYMENTS TO MATCH (ROADMAP 18d-iii-b-ii-a; spec Part 3 §14.8; rulings/2026-10-25-18d-iii-b-ii-a.md).
//
// The gym's payments from Square Point of Sale that did not go on a bill by themselves (18d-iii-b-i), for
// staff who take payments: the list, Match's box for one person, Match, Not a bill payment and its Undo.
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
  countAfterGap,
  matchBillsResponseSchema,
  matchPaymentResponseSchema,
  memberPayTarget,
  paymentToMatchStateResponseSchema,
  paymentsToMatchResponseSchema,
  paymentsToMatchSummarySchema,
  type MatchBill,
  type MatchBillsResponse,
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
import { recordPaymentIn, type BillWriteOutcome } from "../memberships/billsRepo.js";
import { billsFor, paymentsFor, squareMoneyOut } from "../memberships/billsSql.js";
import { recordFeePaymentIn, type FeeWriteOutcome } from "../memberships/feesRepo.js";
import { heldRowsOf } from "../memberships/heldRepo.js";
import { insertAudit } from "../repo.js";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import { BILLING, orgNotFound, readyOrThrow, stateOf } from "./cards.js";
import * as toMatch from "./paymentsToMatchRepo.js";
import * as repo from "./repo.js";
import type { PaymentsDeps } from "./service.js";

const NO_BILLING = "Recording payments isn't part of your role. Ask the owner to turn on \"Record members' payments\" for you.";
const W = PAYMENTS_TO_MATCH_WORDS;
const gone = (): OrgsError => new OrgsError(404, "payment_to_match_gone", W.gone);

/** The privileges Match and the person's page need, as Failed payments asks them, so nobody is shown a
 *  press they are refused. A write is refused while the console is read-only. */
async function allowed(deps: PaymentsDeps, gymId: string, userId: string, write: boolean): Promise<repo.GymForPayments> {
  const { privileges } = write ? await requireWritablePrivilege(deps, gymId, userId, "members.confirm") : await requirePrivilege(deps, gymId, userId, "members.confirm");
  if (!privileges.includes(BILLING)) throw new OrgsError(403, "forbidden", NO_BILLING);
  const gym = await repo.readGym(deps.sql, gymId);
  if (gym === null) throw orgNotFound();
  return gym;
}

/** How many wait, and what they come to: Overview's line. */
export async function readToMatchSummary(deps: PaymentsDeps, userId: string, gymId: string): Promise<PaymentsToMatchSummary> {
  await allowed(deps, gymId, userId, false);
  return paymentsToMatchSummarySchema.parse(await toMatch.waitingTotals(deps.sql, gymId));
}

/** A page of the list, from the `from`th payment. */
export async function readPaymentsToMatch(deps: PaymentsDeps, userId: string, gymId: string, from: number): Promise<PaymentsToMatchResponse> {
  const gym = await allowed(deps, gymId, userId, false);
  const [totals, page] = await Promise.all([toMatch.waitingTotals(deps.sql, gymId), toMatch.waitingPage(deps.sql, gymId, from, PAYMENTS_TO_MATCH_PAGE)]);
  const square = deps.square;
  const connection = square === null ? null : await repo.readConnection(deps.sql, gymId, square.environment);
  const people = [...new Set(page.flatMap((p) => (p.entryId === null ? [] : [p.entryId])))];
  const held = await toMatch.cardHeldFor(deps.sql, gymId, people);
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
    reason: p.reason,
    holdsCard: p.entryId !== null && held.has(p.entryId),
  }));
  const next = from + PAYMENTS_TO_MATCH_PAGE < totals.count ? from + PAYMENTS_TO_MATCH_PAGE : null;
  const ready = square !== null && connection !== null && stateOf(square, gym, connection) === "ready";
  return paymentsToMatchResponseSchema.parse({ ...totals, payments, next, square: ready });
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

/** Match's box, for one person: the bills a payment can go on, theirs and those of anybody they pay for,
 *  by the rules Record payment takes them by, and their newest payments, so one already recorded by hand
 *  is seen. */
export async function readMatchBills(deps: PaymentsDeps, userId: string, gymId: string, paymentId: string, entryId: string): Promise<MatchBillsResponse> {
  const gym = await allowed(deps, gymId, userId, false);
  const row = await waiting(deps, gymId, paymentId);
  const people = await toMatch.peopleOf(deps.sql, gymId, entryId);
  const person = people?.[0];
  if (people === null || person === undefined) throw new OrgsError(404, "entry_not_found", "That person was not found on your list.");
  const today = dayInTz(deps.now(), gym.timezone);
  const memberships = await toMatch.membershipsOf(deps.sql, gymId, people.map((p) => p.entryId));
  const ids = memberships.map((m) => m.id);
  const [held, bills, payments, fees, busy] = await Promise.all([
    heldRowsOf(deps.sql, gymId, ids),
    billsFor(deps.sql, gymId, ids),
    paymentsFor(deps.sql, gymId, ids),
    toMatch.openFeesOf(deps.sql, gymId, ids),
    toMatch.busyOf(deps.sql, gymId, ids),
  ]);
  const amount = forTheBill(row) ?? row.amountMinor;
  const nameOf = new Map(people.map((p) => [p.entryId, p] as const));
  const out: MatchBill[] = [];
  for (const m of memberships) {
    const held1 = held.get(m.id);
    const who = nameOf.get(m.entryId);
    if (held1 === undefined || who === undefined) continue;
    const mine = bills.filter((b) => b.membershipId === m.id);
    // As the person's page reads it: the count moved over periods nobody was asked for.
    const count = who.past ? null : countAfterGap(held1.membership, today, new Set(mine.map((b) => b.periodIndex)));
    const membership = count === null ? held1.membership : { ...held1.membership, paidPeriods: count, paidFloor: count };
    const target = memberPayTarget(membership, held1.nextBillMinor, today, mine, who.past);
    const cannotFor = (left: number, currency: string, fee: boolean): MatchBill["cannot"] =>
      currency !== row.currency ? "currency" : busy.has(m.id) ? "busy" : fee && left !== amount ? "fee_whole" : left < amount ? "too_little" : null;
    if (target !== null && target.leftMinor > 0) {
      out.push({
        entryId: m.entryId,
        name: who.name,
        membershipId: m.id,
        typeName: held1.typeName,
        target: { kind: "period", periodIndex: target.periodIndex },
        fee: null,
        covers: target.covers,
        dueOn: target.dueOn,
        leftMinor: target.leftMinor,
        currency: held1.currency,
        cannot: cannotFor(target.leftMinor, held1.currency, false),
      });
    }
    for (const fee of fees.filter((f) => f.membershipId === m.id)) {
      const left = fee.amountMinor - fee.paidMinor;
      out.push({
        entryId: m.entryId,
        name: who.name,
        membershipId: m.id,
        typeName: held1.typeName,
        target: { kind: "fee", billId: fee.id },
        fee: { kind: fee.kind, forName: fee.forName },
        covers: null,
        dueOn: fee.dueOn,
        leftMinor: left,
        currency: fee.currency,
        cannot: cannotFor(left, fee.currency, true),
      });
    }
  }
  out.sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : a.entryId === person.entryId ? -1 : 1));
  const suggested = out.findIndex((b) => b.cannot === null && b.leftMinor === amount);
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
    amountMinor: forTheBill(row),
    bills: out.slice(0, 200),
    suggested: suggested < 0 ? null : suggested,
    paid,
  });
}

/** A press of Match again, after its payment went on the bill: the same answer. */
async function matchedAnswer(deps: PaymentsDeps, gymId: string, row: toMatch.TakenRow): Promise<MatchPaymentResponse> {
  const [paid] = await deps.sql<{ amount_minor: number; currency: string; receipt_number: number; entry_id: string; full_name: string }[]>`
    SELECT p.amount_minor, p.currency, p.receipt_number, h.entry_id, e.full_name
    FROM gym_member_payments p
    JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
    JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
    JOIN gym_member_list_entries e ON e.gym_id = h.gym_id AND e.id = h.entry_id
    WHERE p.gym_id = ${gymId} AND p.id = ${row.memberPaymentId}`;
  if (paid === undefined) throw gone();
  return matchPaymentResponseSchema.parse({
    matched: { entryId: paid.entry_id, name: paid.full_name, amountMinor: paid.amount_minor, currency: paid.currency, receiptNumber: paid.receipt_number },
  });
}

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
    return { answer: await matchedAnswer(deps, gymId, first), entryIds: [] };
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

  const now = deps.now();
  const today = dayInTz(now, gym.timezone);
  const done = await deps.sql.begin(async (tx) => {
    // The gym's lock first, as every payment by hand takes it, then the row as it stands under it.
    await lockGym(tx, gymId);
    const locked = await toMatch.readTaken(tx, gymId, paymentId, true);
    if (locked === null || locked.state === "shop_sale") throw gone();
    if (locked.state === "recorded") {
      if (locked.recordKey === body.requestKey) return locked;
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
    return { ...locked, state: "recorded", memberPaymentId: recorded.paymentId, recordKey: body.requestKey };
  });
  return { answer: await matchedAnswer(deps, gymId, done), entryIds: peopleTold(body.entryId, row.entryId) };
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

