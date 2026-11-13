// CANCEL IN THE APP (ROADMAP 18l; spec Part 3 §14.8, "Cancelling"; Kd, rulings/2026-11-11-18l.md).
//
// A member, or whoever pays for them (18i), cancels a membership on My membership: a repeating one, or any inside its
// cooling-off period with a full refund. The ways are the front desk's own (`myCancelWays`), and the cancel is the
// desk's own step (`moveHeldIn`), so the app and the desk never give two answers.
//
// THE WORST THING here is a member told "no more payments", or these payments and no others, and charged anyway; or a
// membership cancelled that is not the reader's to cancel. So the box's every sentence and payment is worked out here
// from the bills as they will open (`renewalAmountMinor`, the amount every bill opened reads), the press sends back the
// key of exactly what it showed, and the cancel is refused unless the same box, worked out again under the gym's and
// the record's locks, has that key. Whose it is is asked again under those locks: the member's own record, which their
// account alone holds and nobody else pays for, or a record they pay for. Strangers, other gyms and other members get
// 404, as every member route answers.
import { createHash } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import {
  MY_CANCEL_WORDS,
  appCancelsResponseSchema,
  billsAtCancel,
  daysBetween,
  heldMembershipView,
  moveHeldMembership,
  myCancelAskSchema,
  myCancelButton,
  myCancelDoneLine,
  myCancelDoneSchema,
  myCancelFrontDeskSooner,
  myCancelFrozen,
  memberGiftOff,
  periodListedMinor,
  myCancelLines,
  myCancelOwedNote,
  myCancelPaidByLine,
  myCancelReasonResponseSchema,
  myCancelWays,
  periodStart,
  type AppCancelsResponse,
  type HeldMembership,
  type MyCancelAsk,
  type MyCancelChoice,
  type MyCancelDone,
  type MyCancelFacts,
  type MyCancelPayment,
  type MyCancelReason,
  type MyCancelReasonResponse,
  type MyCancelRequest,
  type MyCancelWhen,
} from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";
import type { LiveNewsSender } from "../../live/news.js";
import { endMembershipBookings, membershipBookingsAsk } from "../classes/bookingChanges.js";
import { emailHmac } from "../invites/address.js";
import { gymNameForEmail } from "../invites/gymText.js";
import { suppressionsFor } from "../invites/repo.js";
import { coolingOffRefundOf } from "../memberships/heldService.js";
import { heldRowsOf, lockedEntry, moveHeldIn, periodPriceMinor, type HeldRow, type HeldWriteOutcome } from "../memberships/heldRepo.js";
import { billOf, billsFor, paymentsFor, type BillRow } from "../memberships/billsSql.js";
import { feesFor } from "../memberships/feesRepo.js";
import { chargedCard, renewalAmountMinor } from "../memberships/renewalRemindersRepo.js";
import { lockEntries } from "../memberList/repo.js";
import { paidForBy, payerOf } from "../payers/repo.js";
import { OrgsError, requirePrivilege } from "../service.js";
import type { CancelEmailSender } from "./cancelEmail.js";
import * as cancels from "./cancelRepo.js";
import * as repo from "./repo.js";

export interface CancelDeps {
  sql: Sql;
  now: () => Date;
  news: LiveNewsSender;
  email: CancelEmailSender;
  /** The key the app's email addresses are kept by, for the bounced list; null: none is read as bounced. */
  addressKey: Buffer | null;
  log: { warn: (obj: object, msg: string) => void };
}

type Limit = () => Promise<boolean>;

const CANCEL_BOOKINGS = { ask: membershipBookingsAsk, end: endMembershipBookings };
const MEMBERS = "members.confirm";

export const notFound = (): OrgsError => new OrgsError(404, "membership_not_found", "Membership not found.");
const changed = (): OrgsError => new OrgsError(409, "cancel_changed", MY_CANCEL_WORDS.changed);

/** Who the reader is and whose membership this is: the record it is on, and the reader's own record, which pressed it. */
export interface Whose {
  gymName: string;
  timezone: string;
  /** The record the membership is on. */
  entryId: string;
  /** The reader's own record. */
  ownId: string;
}

/** Whose it is, or 404; a member somebody else pays for is told who can cancel it (409). Asked again under the locks. */
export async function whoseOf(sql: Sql | TransactionSql, gymId: string, userId: string, membershipId: string): Promise<Whose> {
  const reader = await repo.readerOf(sql, gymId, userId);
  if (reader === null) throw new OrgsError(404, "org_not_found", "Organisation not found.");
  const own = reader.entryId !== null && reader.holders === 1 ? reader.entryId : null;
  const entryId = await cancels.recordOfMembership(sql, gymId, membershipId);
  if (own === null || entryId === null) throw notFound();
  if (entryId === own) {
    const payer = await payerOf(sql, gymId, own);
    if (payer !== null) throw new OrgsError(409, "paid_by_someone", myCancelPaidByLine(payer.name));
    return { gymName: reader.gymName, timezone: reader.timezone, entryId, ownId: own };
  }
  if (!(await paidForBy(sql, gymId, own)).some((p) => p.entryId === entryId)) throw notFound();
  return { gymName: reader.gymName, timezone: reader.timezone, entryId, ownId: own };
}

/** The payments still to come before `lastDay`, after the cancel, as their bills will open: none for one that no longer
 *  renews. A period already due with its bill open is owed, said apart. */
export type Coming = MyCancelPayment & { periodIndex: number; opens: boolean };

/** `first`: the next one alone (Keep my membership, 18l-ii-a). */
export function paymentsToCome(row: HeldRow, after: HeldMembership, lastDay: string, bills: readonly BillRow[], today: string, first = false): Coming[] {
  if (after.kind !== "recurring" || after.free || !after.renews || (after.status !== "active" && after.status !== "frozen")) return [];
  // A frozen one counts the days frozen so far, as its unfreeze will (`noticeOf`).
  const frozenSoFar = after.status === "frozen" && after.frozenOn !== null ? Math.max(0, daysBetween(after.frozenOn, today)) : 0;
  const at: HeldMembership = { ...after, frozenDays: after.frozenDays + frozenSoFar };
  const out: Coming[] = [];
  for (let i = after.paidPeriods; i < after.paidPeriods + 400; i++) {
    const due = periodStart(at, i);
    if (due > lastDay) break;
    const bill = bills.find((b) => b.periodIndex === i);
    if (bill !== undefined && (bill.status !== "open" || bill.dueOn <= today)) continue;
    const amountMinor = bill === undefined ? renewalAmountMinor(row, i) : bill.amountMinor - bill.paidMinor;
    if (amountMinor > 0) out.push({ dueOn: bill?.dueOn ?? due, amountMinor, periodIndex: i, opens: bill === undefined });
    if (first && out.length > 0) break;
  }
  return out;
}

/** The key of one choice of one membership: what it says, for exactly that membership. */
export const keyOf = (membershipId: string, c: object): string => createHash("sha256").update(JSON.stringify({ membershipId, ...c }), "utf8").digest("hex");

interface Worked {
  ask: MyCancelAsk;
  row: HeldRow;
  facts: Map<MyCancelWhen, MyCancelFacts>;
}

/** THE BOX, worked out from the membership, its bills and its bookings as they stand: the same read for the box and,
 *  under the locks, for the press. */
async function workOut(tx: TransactionSql, gymId: string, whose: Whose, membershipId: string, today: string, now: Date): Promise<Worked> {
  const row = (await heldRowsOf(tx, gymId, [membershipId])).get(membershipId);
  if (row === undefined) throw notFound();
  const [bills, payments, fees] = await Promise.all([billsFor(tx, gymId, [row.id]), paymentsFor(tx, gymId, [row.id]), feesFor(tx, gymId, [row.id])]);
  const m = row.membership;
  const view = heldMembershipView(m, today);
  const renewsAgain = view.status === "upcoming" ? await cancels.replacedStopped(tx, gymId, row.id) : null;
  // Whoever pays for them pressed it: the box says whose it is (round one, L1).
  const forName = whose.ownId === whose.entryId ? null : await cancels.nameOfRecord(tx, gymId, whose.entryId);
  // A money-off Refer a friend gift waiting for the record's next bill comes off it as the bill opens (round one, H3).
  const gift = await cancels.waitingMoneyGift(tx, gymId, whose.entryId);
  const others = gift === null ? [] : await cancels.otherNextBills(tx, gymId, whose.entryId, row.id, today);
  // Money owed before the cancel stays owed: the bills already due, and the fees still owed.
  const owedBills = bills.filter((b) => b.status === "open" && b.dueOn <= today).reduce((n, b) => n + Math.max(0, b.amountMinor - b.paidMinor), 0);
  const owedFees = fees.fees
    .filter((f) => f.status === "open" && f.stillOwed)
    .reduce((n, f) => n + Math.max(0, f.amountMinor - fees.payments.filter((p) => p.billId === f.id && p.voided === null).reduce((s, p) => s + p.amountMinor, 0)), 0);
  const owedMinor = owedBills + owedFees;
  const choices: MyCancelChoice[] = [];
  const facts = new Map<MyCancelWhen, MyCancelFacts>();
  let blocked: string | null = null;
  for (const way of myCancelWays(m, today)) {
    const move = moveHeldMembership(m, { type: "cancel", when: way.when }, today);
    if (!move.ok) continue;
    const after = move.membership;
    const lastDay = after.status === "cancelled" ? today : (heldMembershipView(after, today).endsOn ?? way.endsOn);
    // What the desk's step refuses, said here before the press: a payment for days after its last day, or part of a
    // bill paid inside a cooling-off period.
    if (way.when === "cooling_off" ? bills.some((b) => b.status === "open" && b.paidMinor > 0) : billsAtCancel(bills, lastDay).blocked) {
      blocked = way.when === "cooling_off" ? MY_CANCEL_WORDS.partPaid : MY_CANCEL_WORDS.paidAhead;
      continue;
    }
    const coming = way.when === "cooling_off" ? [] : paymentsToCome(row, after, lastDay, bills, today);
    const first = coming[0];
    // Named only where the app charges it by itself, as the renewal reminder names it (18v-iv).
    // With nothing to come, the card the app charges today, so the box says it won't be charged again; never where money
    // is owed, which staff can still charge to it.
    const card = first !== undefined ? await chargedCard(tx, gymId, row.id, first.periodIndex) : owedMinor > 0 ? null : await chargedCard(tx, gymId, row.id, m.paidPeriods);
    const toCome: MyCancelPayment[] = coming.map((c, at) => {
      // The gift goes on the earliest bill to open: this one's first, unless another membership of theirs bills sooner.
      if (at !== 0 || gift === null || !c.opens || others.some((day) => day <= c.dueOn)) return { dueOn: c.dueOn, amountMinor: c.amountMinor };
      const listed = periodListedMinor(m, c.periodIndex, periodPriceMinor(row, c.periodIndex));
      const off = memberGiftOff(gift, listed, row.currency);
      return { dueOn: c.dueOn, amountMinor: off === 0 ? c.amountMinor : billOf(listed - off, row.taxApplied).amountMinor };
    });
    const asked = await membershipBookingsAsk(tx, gymId, { membership: row.id, now, afterDay: after.status === "cancelled" ? null : lastDay }, { bookings: null, ptSessions: null });
    const ending = {
      classes: asked === null ? 0 : asked.ending.booked + asked.ending.waiting,
      classesMark: asked === null ? null : asked.ending.mark,
      sessions: asked?.ending.ptSessions?.count ?? 0,
      sessionsMark: asked?.ending.ptSessions?.mark ?? null,
    };
    const feeMinor = way.when === "leave_early" ? (m.leaveFeeMinor ?? null) : null;
    const refundMinor = way.when === "cooling_off" ? (coolingOffRefundOf(m, view, bills, payments)?.leftMinor ?? 0) : null;
    const said: MyCancelFacts = {
      gymName: whose.gymName,
      membershipName: row.typeName,
      forName,
      currency: row.currency,
      today,
      way,
      upcoming: view.status === "upcoming",
      noticeDays: m.noticeDays ?? null,
      coolingOffUntil: view.can.coolingOff?.until ?? null,
      termUntil: view.contract?.until ?? null,
      payments: toCome,
      card,
      feeMinor,
      refundMinor,
      ending: { classes: ending.classes, sessions: ending.sessions },
      paidAhead: view.payment?.state === "paid",
      renewsAgain,
    };
    facts.set(way.when, said);
    const choice = { when: way.when, endsOn: way.endsOn, lines: myCancelLines(said), payments: toCome, ending, feeMinor, refundMinor };
    choices.push({ ...choice, button: myCancelButton(way.when, feeMinor, row.currency), key: keyOf(row.id, choice) });
  }
  const notes: string[] = [];
  if (owedMinor > 0 && choices.some((c) => c.when !== "cooling_off")) {
    const payer = (await payerOf(tx, gymId, whose.entryId))?.entryId ?? whose.entryId;
    notes.push(myCancelOwedNote(owedMinor, row.currency, whose.gymName, await cancels.chargeableCard(tx, gymId, payer)));
  }
  if (choices.length > 0 && myCancelFrontDeskSooner(m, today)) notes.push(MY_CANCEL_WORDS.frontDeskSooner);
  if (choices.length === 0 && blocked !== null) notes.push(blocked);
  if (choices.length === 0 && myCancelFrozen(m, today)) notes.push(MY_CANCEL_WORDS.frozen);
  return { ask: myCancelAskSchema.parse({ membership: { id: row.id, name: row.typeName }, currency: row.currency, choices, notes }), row, facts };
}

/** The box under Cancel membership. */
export async function readCancelAsk(deps: CancelDeps, userId: string, gymId: string, membershipId: string, limit: Limit): Promise<MyCancelAsk | null> {
  const whose = await whoseOf(deps.sql, gymId, userId, membershipId);
  if (!(await limit())) return null;
  const now = deps.now();
  const today = dayInTz(now, whose.timezone);
  // Cancelled in the app already: nothing more to press; My membership says when.
  if ((await cancels.cancelsOf(deps.sql, gymId, [membershipId])).size > 0) {
    const row = (await heldRowsOf(deps.sql, gymId, [membershipId])).get(membershipId);
    if (row === undefined) throw notFound();
    return myCancelAskSchema.parse({ membership: { id: row.id, name: row.typeName }, currency: row.currency, choices: [], notes: [] });
  }
  return await deps.sql.begin("isolation level repeatable read read only", async (tx) => (await workOut(tx, gymId, whose, membershipId, today, now)).ask);
}

/** What the desk's step refused, in the member's words. */
function refusal(outcome: Exclude<HeldWriteOutcome, { kind: "ok" }>): OrgsError {
  switch (outcome.kind) {
    case "card_charging":
      return new OrgsError(409, "card_charge_waiting", MY_CANCEL_WORDS.cardCharging);
    case "terminal_waiting":
      return new OrgsError(409, "terminal_waiting", MY_CANCEL_WORDS.terminalWaiting);
    case "app_paying":
      return new OrgsError(409, "app_payment_open", MY_CANCEL_WORDS.appPaying);
    case "early_payment":
      return new OrgsError(409, "early_payment", MY_CANCEL_WORDS.paidAhead);
    case "cooling_off_part_paid":
      return new OrgsError(409, "cooling_off_part_paid", MY_CANCEL_WORDS.partPaid);
    case "entry_not_found":
    case "membership_not_found":
      return notFound();
    default:
      return changed();
  }
}

/** "11 Nov 2026 at 2:05 PM", on the business's own clock. */
export function atWords(at: Date, timezone: string, country: string | null): string {
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, day: "numeric", month: "short", year: "numeric" }).format(at);
  const time = new Intl.DateTimeFormat(`en-${country ?? "US"}`, { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(at);
  return `${day} at ${time}`;
}

/** The confirmation, once: to the account that pressed Cancel, unless that address bounced. Never throws. */
async function confirm(deps: CancelDeps, gymId: string, cancelId: string, letter: { userId: string; gymName: string; membershipName: string; at: Date; timezone: string; done: string; lines: readonly string[]; notes: readonly string[] }): Promise<boolean> {
  try {
    const email = await cancels.emailOfUser(deps.sql, letter.userId);
    if (email === null) return false;
    if (deps.addressKey !== null && (await suppressionsFor(deps.sql, gymId, [emailHmac(deps.addressKey, email)])).size > 0) return false;
    const at = deps.now();
    if (!(await cancels.claimEmail(deps.sql, gymId, cancelId, at))) return true;
    try {
      await deps.email.sendCancelConfirmation({
        to: email,
        gymName: gymNameForEmail(letter.gymName),
        membershipName: letter.membershipName,
        cancelledAt: atWords(letter.at, letter.timezone, await cancels.countryOf(deps.sql, gymId)),
        done: letter.done,
        lines: letter.lines,
        notes: letter.notes,
      });
      return true;
    } catch (err) {
      await cancels.unclaimEmail(deps.sql, gymId, cancelId, at);
      throw err;
    }
  } catch (err) {
    deps.log.warn({ event: "cancel.confirmation_failed", gymId, errName: err instanceof Error ? err.name : typeof err }, "a cancel confirmation was not emailed");
    return false;
  }
}

/** CANCEL: the way the box showed, with exactly what it said, or nothing. The same press sent twice is one cancel. */
export async function cancelInApp(deps: CancelDeps, userId: string, gymId: string, membershipId: string, body: MyCancelRequest, limit: Limit): Promise<MyCancelDone | null> {
  const first = await whoseOf(deps.sql, gymId, userId, membershipId);
  if (!(await limit())) return null;
  const now = deps.now();
  const today = dayInTz(now, first.timezone);
  const done = await deps.sql.begin(async (tx) => {
    // The gym's lock first: the same press sent twice at once waits here, then finds the first one's cancel.
    const entry = await lockedEntry(tx, gymId, first.entryId);
    if (entry === null) throw notFound();
    const again = await cancels.cancelOfRequest(tx, gymId, body.requestKey);
    if (again !== null) {
      if (again.heldMembershipId !== membershipId || again.userId !== userId) throw new OrgsError(409, "request_reused", MY_CANCEL_WORDS.requestReused);
      return { kind: "again" as const, row: again };
    }
    if (first.ownId !== first.entryId) await lockEntries(tx, gymId, [first.ownId]);
    // Whose it is, asked again under the locks: a payer named or taken off meanwhile changes the answer.
    const whose = await whoseOf(tx, gymId, userId, membershipId);
    if (whose.entryId !== first.entryId) throw changed();
    if ((await cancels.cancelsOf(tx, gymId, [membershipId])).size > 0) throw changed();
    const worked = await workOut(tx, gymId, whose, membershipId, today, now);
    const choice = worked.ask.choices.find((c) => c.when === body.when);
    const said = worked.facts.get(body.when);
    if (choice === undefined || said === undefined || choice.key !== body.key) throw changed();
    const outcome = await moveHeldIn(tx, CANCEL_BOOKINGS, {
      gymId,
      entryId: whose.entryId,
      membershipId,
      event: { type: "cancel", when: body.when },
      today,
      confirmBookings: choice.ending.classesMark,
      confirmPtSessions: choice.ending.sessionsMark,
      ...(body.when === "leave_early" && worked.row.membership.leaveFeeMinor != null ? { leaveFeeMinor: worked.row.membership.leaveFeeMinor } : {}),
      actorUserId: userId,
      now,
      via: "app",
    });
    if (outcome.kind === "has_bookings") throw changed();
    if (outcome.kind !== "ok") throw refusal(outcome);
    const id = await cancels.insertCancel(tx, { gymId, membershipId, byEntryId: whose.ownId, userId, requestKey: body.requestKey, when: body.when, endsOn: choice.endsOn, cancelledOn: today, said: { lines: choice.lines, notes: worked.ask.notes }, ended: { classes: choice.ending.classes, sessions: choice.ending.sessions }, now });
    return { kind: "new" as const, id, choice, said, notes: worked.ask.notes, entryId: whose.entryId, gymName: whose.gymName, timezone: whose.timezone };
  });
  if (done.kind === "again") {
    const r = done.row;
    const held = (await heldRowsOf(deps.sql, gymId, [membershipId])).get(membershipId);
    if (held === undefined) throw notFound();
    // The same sentence as the first answer: a cooling-off refund worked out again, and whose it is (round one, L2).
    const refundMinor =
      r.when === "cooling_off"
        ? (coolingOffRefundOf(held.membership, heldMembershipView(held.membership, r.cancelledOn), await billsFor(deps.sql, gymId, [held.id]), await paymentsFor(deps.sql, gymId, [held.id]))?.leftMinor ?? 0)
        : null;
    const forName = first.ownId === first.entryId ? null : await cancels.nameOfRecord(deps.sql, gymId, first.entryId);
    const line = myCancelDoneLine({ gymName: first.gymName, membershipName: held.typeName, forName, currency: held.currency, today: r.cancelledOn, way: { when: r.when, endsOn: r.endsOn }, refundMinor });
    // A confirmation that did not go is tried again by the same press (round one, L3).
    const named = forName === null ? held.typeName : `${forName}'s ${held.typeName}`;
    const emailed = r.emailed || (await confirm(deps, gymId, r.id, { userId, gymName: first.gymName, membershipName: named, at: r.createdAt, timezone: first.timezone, done: line, lines: r.said.lines, notes: r.said.notes }));
    return myCancelDoneSchema.parse({ cancelId: r.id, line, endsOn: r.endsOn, emailed, reason: r.reason });
  }
  deps.news.tell(gymId, { what: "memberships", entryId: done.entryId });
  const line = myCancelDoneLine(done.said);
  const named = done.said.forName === null ? done.said.membershipName : `${done.said.forName}'s ${done.said.membershipName}`;
  const emailed = await confirm(deps, gymId, done.id, { userId, gymName: done.gymName, membershipName: named, at: now, timezone: done.timezone, done: line, lines: done.choice.lines, notes: done.notes });
  return myCancelDoneSchema.parse({ cancelId: done.id, line, endsOn: done.choice.endsOn, emailed, reason: null });
}

/** Why they are leaving, once the cancel is done: theirs alone to answer, once. */
export async function setCancelReason(deps: CancelDeps, userId: string, gymId: string, cancelId: string, reason: MyCancelReason, limit: Limit): Promise<MyCancelReasonResponse | null> {
  const reader = await repo.readerOf(deps.sql, gymId, userId);
  if (reader === null) throw new OrgsError(404, "org_not_found", "Organisation not found.");
  if (!(await limit())) return null;
  const stands = await cancels.setReason(deps.sql, gymId, cancelId, userId, reason, deps.now());
  if (stands === null) throw new OrgsError(404, "cancel_not_found", "Cancel not found.");
  return myCancelReasonResponseSchema.parse({ reason: stands });
}

/** Overview's Cancelled in the app, for staff who keep the member list. */
export async function readAppCancels(deps: Pick<CancelDeps, "sql" | "now">, userId: string, gymId: string, limit: Limit): Promise<AppCancelsResponse | null> {
  await requirePrivilege(deps, gymId, userId, MEMBERS);
  if (!(await limit())) return null;
  return appCancelsResponseSchema.parse(await cancels.recentCancels(deps.sql, gymId, deps.now()));
}
