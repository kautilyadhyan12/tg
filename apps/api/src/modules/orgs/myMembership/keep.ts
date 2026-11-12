// KEEP MY MEMBERSHIP (ROADMAP 18l-ii-a; Kd, rulings/2026-11-11-18l.md; spec Part 3 §14.8, "Cancelling").
//
// A member who cancelled in the app, or whoever pays for them now, undoes it there until its last day: the member
// stopped the charges, so only the member starts them again. The keep is the one transition (`moveHeldMembership`'s
// `keep`), run by the front desk's own step (`moveHeldIn`), so the membership is put back exactly as the cancel found it.
//
// THE WORST THING here is payments started again on a membership that is not the reader's, or a payment other than the
// one the box showed. So whose it is is asked as Cancel asks it, again under the locks; the box's next payment is worked
// out as its bill will open (`paymentsToCome`, the cancel box's own read); and the keep is refused unless the same box,
// worked out again under the locks, has the key the press sent back.
import type { TransactionSql } from "postgres";
import {
  MY_CANCEL_WORDS,
  MY_KEEP_BUTTON,
  MY_KEEP_WORDS,
  heldMembershipView,
  isKeepWhen,
  memberGiftOff,
  moveHeldMembership,
  myKeepAskSchema,
  myKeepDoneLine,
  myKeepDoneSchema,
  myKeepLines,
  myKeepReplacedNote,
  periodListedMinor,
  type HeldMembershipEvent,
  type MyCancelPayment,
  type MyKeepAsk,
  type MyKeepChoice,
  type MyKeepDone,
  type MyKeepFacts,
  type MyKeepRequest,
} from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";
import { endMembershipBookings, membershipBookingsAsk } from "../classes/bookingChanges.js";
import { emailHmac } from "../invites/address.js";
import { gymNameForEmail } from "../invites/gymText.js";
import { suppressionsFor } from "../invites/repo.js";
import { billOf, billsFor } from "../memberships/billsSql.js";
import { billsKeepReopens, heldRowsOf, leaveFeesOf, lockedEntry, moveHeldIn, periodPriceMinor, type HeldRow, type HeldWriteOutcome } from "../memberships/heldRepo.js";
import { chargedCard } from "../memberships/renewalRemindersRepo.js";
import { lockEntries } from "../memberList/repo.js";
import { OrgsError } from "../service.js";
import { atWords, keyOf, notFound, paymentsToCome, whoseOf, type CancelDeps, type Whose } from "./cancel.js";
import * as cancels from "./cancelRepo.js";

type Limit = () => Promise<boolean>;

/** The keep ends no bookings; the desk's step is handed the cancel's own, as it asks for them. */
const BOOKINGS = { ask: membershipBookingsAsk, end: endMembershipBookings };
/** Far enough that the next payment is always found, if there is one. */
const NO_END = "9999-12-31";

const changed = (): OrgsError => new OrgsError(409, "keep_changed", MY_KEEP_WORDS.changed);

interface Worked {
  ask: MyKeepAsk;
  facts: MyKeepFacts | null;
}

/** What putting a cancel back would do, or why it can't be: the member's Keep and staff's Undo cancellation (18l-ii-b)
 *  read it alike. */
export type KeepMoney =
  | { kind: "over" }
  | { kind: "frozen" }
  | { kind: "followed"; follower: { name: string; startsOn: string; replaces: boolean } }
  | { kind: "fee_paid" }
  | { kind: "ok"; next: MyCancelPayment | null; card: { brand: string; last4: string } | null; feeOffMinor: number | null };

/** THE MONEY OF A KEEP, worked out from the membership and its bills as they stand: `event` is the keep, `endsOn` the
 *  last day its cancel left it (the bills after it are owed again), `entryId` the record it is on. */
export async function keepMoney(
  tx: TransactionSql,
  gymId: string,
  entryId: string,
  row: HeldRow,
  event: Extract<HeldMembershipEvent, { type: "keep" | "undo_cancel" }>,
  endsOn: string | null,
  today: string,
): Promise<KeepMoney> {
  const m = row.membership;
  const move = moveHeldMembership(m, event, today);
  if (!move.ok || !move.changed) return { kind: "over" };
  const after = move.membership;
  // Frozen, its dates stand still and no bill opens: it is kept once unfrozen, when every day is known.
  if (heldMembershipView(m, today).status === "frozen") return { kind: "frozen" };
  // Another membership follows it, or takes its place: keeping it would bill both.
  const follower = (await cancels.followersOf(tx, gymId, [row.id], today)).get(row.id);
  if (follower !== undefined) return { kind: "followed", follower };
  let feeOffMinor: number | null = null;
  if (event.type === "keep" ? event.when === "leave_early" : event.ways.includes("leave_early")) {
    const fees = await leaveFeesOf(tx, gymId, row.id);
    if (fees.some((f) => f.keptMinor > 0)) return { kind: "fee_paid" };
    const off = fees.filter((f) => f.status === "open").reduce((n, f) => n + f.amountMinor, 0);
    feeOffMinor = off > 0 ? off : null;
  }
  // The bills this cancel took off are owed again (`reopenBills`): a plain one as a bill opened now reads, so it is read
  // as not there; one holding a joining fee, a change's credit or money moved as it was, so it is read as open. No gift
  // goes on one of those, as the bill opener puts it only on a bill it opens.
  const stored = await billsFor(tx, gymId, [row.id]);
  const lastDay = endsOn ?? heldMembershipView(m, today).endsOn;
  const reopened = lastDay === null ? [] : billsKeepReopens(stored, lastDay);
  const reopens = new Set(reopened.map((b) => b.periodIndex));
  const plain = new Set(reopened.filter((b) => b.joiningFeeMinor === 0 && b.changeCreditMinor === 0 && b.movedMinor === 0).map((b) => b.periodIndex));
  const bills = stored.filter((b) => !plain.has(b.periodIndex)).map((b) => (reopens.has(b.periodIndex) ? { ...b, status: "open" as const } : b));
  const [first] = paymentsToCome(row, after, NO_END, bills, today, true);
  let next: MyCancelPayment | null = null;
  if (first !== undefined) {
    // A money-off Refer a friend gift waiting for the record's next bill comes off it as the bill opens, as the cancel
    // box reads it.
    const gift = first.opens && !reopens.has(first.periodIndex) ? await cancels.waitingMoneyGift(tx, gymId, entryId) : null;
    const others = gift === null ? [] : await cancels.otherNextBills(tx, gymId, entryId, row.id, today);
    let amountMinor = first.amountMinor;
    if (gift !== null && !others.some((day) => day <= first.dueOn)) {
      const listed = periodListedMinor(after, first.periodIndex, periodPriceMinor(row, first.periodIndex));
      const off = memberGiftOff(gift, listed, row.currency);
      if (off !== 0) amountMinor = billOf(listed - off, row.taxApplied).amountMinor;
    }
    next = { dueOn: first.dueOn, amountMinor };
  }
  const card = first === undefined ? null : await chargedCard(tx, gymId, row.id, first.periodIndex, true);
  return { kind: "ok", next, card, feeOffMinor };
}

/** THE KEEP BOX, worked out from the cancel, the membership and its bills as they stand: the same read for the box and,
 *  under the locks, for the press. */
async function workOut(tx: TransactionSql, gymId: string, whose: Whose, membershipId: string, cancel: cancels.CancelRow, today: string): Promise<Worked> {
  const row = (await heldRowsOf(tx, gymId, [membershipId])).get(membershipId);
  if (row === undefined) throw notFound();
  const base = { membership: { id: row.id, name: row.typeName }, currency: row.currency };
  const nothing = (note: string): Worked => ({ ask: myKeepAskSchema.parse({ ...base, choice: null, notes: [note] }), facts: null });
  if (!isKeepWhen(cancel.when)) return nothing(MY_KEEP_WORDS.over);
  const money = await keepMoney(tx, gymId, whose.entryId, row, { type: "keep", when: cancel.when }, cancel.endsOn, today);
  const forName = whose.ownId === whose.entryId ? null : await cancels.nameOfRecord(tx, gymId, whose.entryId);
  if (money.kind === "over") return nothing(MY_KEEP_WORDS.over);
  if (money.kind === "frozen") return nothing(MY_KEEP_WORDS.frozen);
  if (money.kind === "followed") return nothing(myKeepReplacedNote(money.follower.name, money.follower.startsOn, forName, money.follower.replaces));
  if (money.kind === "fee_paid") return nothing(MY_KEEP_WORDS.feePaid);
  const { next, card, feeOffMinor } = money;
  const facts: MyKeepFacts = {
    membershipName: row.typeName,
    forName,
    currency: row.currency,
    next,
    card,
    feeOffMinor,
    ended: cancel.ended,
  };
  const choice = { lines: myKeepLines(facts), next, feeOffMinor };
  const full: MyKeepChoice = { ...choice, button: MY_KEEP_BUTTON, key: keyOf(row.id, { keep: cancel.id, ...choice }) };
  return { ask: myKeepAskSchema.parse({ ...base, choice: full, notes: [] }), facts };
}

/** The box under Keep my membership. */
export async function readKeepAsk(deps: CancelDeps, userId: string, gymId: string, membershipId: string, limit: Limit): Promise<MyKeepAsk | null> {
  const whose = await whoseOf(deps.sql, gymId, userId, membershipId);
  if (!(await limit())) return null;
  const today = dayInTz(deps.now(), whose.timezone);
  return await deps.sql.begin("isolation level repeatable read read only", async (tx) => {
    const open = (await cancels.cancelsOf(tx, gymId, [membershipId])).get(membershipId);
    if (open === undefined) {
      // Nothing cancelled in the app to keep: nothing to press.
      const row = (await heldRowsOf(tx, gymId, [membershipId])).get(membershipId);
      if (row === undefined) throw notFound();
      return myKeepAskSchema.parse({ membership: { id: row.id, name: row.typeName }, currency: row.currency, choice: null, notes: [] });
    }
    return (await workOut(tx, gymId, whose, membershipId, open, today)).ask;
  });
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
    case "leave_fee_paid":
      return new OrgsError(409, "leave_fee_paid", MY_KEEP_WORDS.feePaid);
    case "entry_not_found":
    case "membership_not_found":
      return notFound();
    default:
      return changed();
  }
}

/** The confirmation, once: to the account that pressed Keep, unless that address bounced. Never throws. */
async function confirm(deps: CancelDeps, gymId: string, cancelId: string, letter: { userId: string; gymName: string; membershipName: string; at: Date; timezone: string; done: string; lines: readonly string[] }): Promise<boolean> {
  try {
    const email = await cancels.emailOfUser(deps.sql, letter.userId);
    if (email === null) return false;
    if (deps.addressKey !== null && (await suppressionsFor(deps.sql, gymId, [emailHmac(deps.addressKey, email)])).size > 0) return false;
    const at = deps.now();
    if (!(await cancels.claimKeepEmail(deps.sql, gymId, cancelId, at))) return true;
    try {
      await deps.email.sendKeepConfirmation({
        to: email,
        gymName: gymNameForEmail(letter.gymName),
        membershipName: letter.membershipName,
        keptAt: atWords(letter.at, letter.timezone, await cancels.countryOf(deps.sql, gymId)),
        done: letter.done,
        lines: letter.lines,
      });
      return true;
    } catch (err) {
      await cancels.unclaimKeepEmail(deps.sql, gymId, cancelId, at);
      throw err;
    }
  } catch (err) {
    deps.log.warn({ event: "keep.confirmation_failed", gymId, errName: err instanceof Error ? err.name : typeof err }, "a keep confirmation was not emailed");
    return false;
  }
}

/** KEEP: exactly what the box said, or nothing. The same press sent twice is one keep. */
export async function keepInApp(deps: CancelDeps, userId: string, gymId: string, membershipId: string, body: MyKeepRequest, limit: Limit): Promise<MyKeepDone | null> {
  const first = await whoseOf(deps.sql, gymId, userId, membershipId);
  if (!(await limit())) return null;
  const now = deps.now();
  const today = dayInTz(now, first.timezone);
  const done = await deps.sql.begin(async (tx) => {
    // The gym's lock first: the same press sent twice at once waits here, then finds the first one's keep.
    const entry = await lockedEntry(tx, gymId, first.entryId);
    if (entry === null) throw notFound();
    const again = await cancels.cancelOfKeepRequest(tx, gymId, body.requestKey);
    if (again !== null) {
      if (again.heldMembershipId !== membershipId || again.kept?.userId !== userId) throw new OrgsError(409, "request_reused", MY_CANCEL_WORDS.requestReused);
      return { kind: "again" as const, row: again };
    }
    if (first.ownId !== first.entryId) await lockEntries(tx, gymId, [first.ownId]);
    // Whose it is, asked again under the locks: a payer named or taken off meanwhile changes the answer.
    const whose = await whoseOf(tx, gymId, userId, membershipId);
    if (whose.entryId !== first.entryId) throw changed();
    const open = (await cancels.cancelsOf(tx, gymId, [membershipId])).get(membershipId);
    if (open === undefined || !isKeepWhen(open.when)) throw changed();
    const worked = await workOut(tx, gymId, whose, membershipId, open, today);
    const choice = worked.ask.choice;
    if (choice === null || worked.facts === null || choice.key !== body.key) throw changed();
    const outcome = await moveHeldIn(tx, BOOKINGS, {
      gymId,
      entryId: whose.entryId,
      membershipId,
      event: { type: "keep", when: open.when },
      keepFrom: open.endsOn,
      today,
      confirmBookings: null,
      actorUserId: userId,
      now,
      via: "app",
    });
    if (outcome.kind === "has_bookings") throw changed();
    if (outcome.kind !== "ok") throw refusal(outcome);
    const said = { lines: choice.lines, notes: [] };
    if (!(await cancels.markKept(tx, { gymId, cancelId: open.id, byEntryId: whose.ownId, userId, requestKey: body.requestKey, keptOn: today, said, now }))) throw changed();
    return { kind: "new" as const, id: open.id, lines: choice.lines, facts: worked.facts, entryId: whose.entryId, gymName: whose.gymName, timezone: whose.timezone };
  });
  const forName = first.ownId === first.entryId ? null : await cancels.nameOfRecord(deps.sql, gymId, first.entryId);
  if (done.kind === "again") {
    const held = (await heldRowsOf(deps.sql, gymId, [membershipId])).get(membershipId);
    if (held === undefined || done.row.kept === null) throw notFound();
    const line = myKeepDoneLine({ membershipName: held.typeName, forName });
    // A confirmation that did not go is tried again by the same press.
    const named = forName === null ? held.typeName : `${forName}'s ${held.typeName}`;
    const emailed = done.row.kept.emailed || (await confirm(deps, gymId, done.row.id, { userId, gymName: first.gymName, membershipName: named, at: done.row.kept.at, timezone: first.timezone, done: line, lines: done.row.kept.said.lines }));
    return myKeepDoneSchema.parse({ line, emailed });
  }
  deps.news.tell(gymId, { what: "memberships", entryId: done.entryId });
  const line = myKeepDoneLine(done.facts);
  const named = done.facts.forName === null ? done.facts.membershipName : `${done.facts.forName}'s ${done.facts.membershipName}`;
  const emailed = await confirm(deps, gymId, done.id, { userId, gymName: done.gymName, membershipName: named, at: now, timezone: done.timezone, done: line, lines: done.lines });
  return myKeepDoneSchema.parse({ line, emailed });
}

/** Whether My membership shows Keep my membership on a membership cancelled in the app this way: it still runs to a
 *  last day, as the cancel left it, and no other membership follows it (`followed`). */
export function keepable(cancel: Pick<cancels.CancelRow, "when">, row: { membership: Parameters<typeof moveHeldMembership>[0] } | undefined, today: string, followed: boolean): boolean {
  if (row === undefined || followed || !isKeepWhen(cancel.when)) return false;
  const move = moveHeldMembership(row.membership, { type: "keep", when: cancel.when }, today);
  return move.ok && move.changed;
}

