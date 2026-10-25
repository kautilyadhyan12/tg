// The bills a payment from Square Point of Sale can go on (ROADMAP 18d-iii-b-ii-a): Match's box lists one
// person's, and Payments to match and the person's page tick the one each payment fits, for one press of
// Match (Kd, 2026-10-25, "one press"). Read once for a whole page of payments, by the rules Record payment
// takes bills by, so the box, the list and the person's page tick the same bill. Bills change after a
// payment is taken in (one paid by hand, a payer added), so why a payment waits is worked out again from
// today's bills by the take-in's own rule (`squareAppDecision`), and a bill is ticked only where that rule
// still leaves no doubt which (round one, Highs 1 and 2).
import {
  SQUARE_APP,
  addDays,
  countAfterGap,
  memberPayTarget,
  squareAppDecision,
  type MatchBill,
  type SquareAppCandidate,
  type SquareAppWaiting,
  type SquareAppWaitReason,
} from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import { billsFor, paymentsFor } from "../memberships/billsSql.js";
import { heldRowsOf } from "../memberships/heldRepo.js";
import * as toMatch from "./paymentsToMatchRepo.js";

type SqlOrTx = Sql | TransactionSql;
type OpenBill = Omit<MatchBill, "cannot"> & { busy: boolean };

export interface LoadedBills {
  /** Each person asked for, then the people they pay for (18i); a person not on the gym's list is missing. */
  people: Map<string, toMatch.PersonRow[]>;
  memberships: { id: string; entryId: string }[];
  bills: Awaited<ReturnType<typeof billsFor>>;
  payments: Awaited<ReturnType<typeof paymentsFor>>;
  open: OpenBill[];
}

/** Every bill still owed by these people and by whoever they pay for: each membership's next one, as the
 *  person's page reads it, and its fees. */
export async function loadBills(sql: SqlOrTx, gymId: string, entryIds: readonly string[], today: string): Promise<LoadedBills> {
  const people = await toMatch.peopleOfMany(sql, gymId, entryIds);
  const everyone = new Map([...people.values()].flat().map((p) => [p.entryId, p] as const));
  const memberships = await toMatch.membershipsOf(sql, gymId, [...everyone.keys()]);
  const ids = memberships.map((m) => m.id);
  const [held, bills, payments, fees, busy] = await Promise.all([
    heldRowsOf(sql, gymId, ids),
    billsFor(sql, gymId, ids),
    paymentsFor(sql, gymId, ids),
    toMatch.openFeesOf(sql, gymId, ids),
    toMatch.busyOf(sql, gymId, ids),
  ]);
  const open: OpenBill[] = [];
  for (const m of memberships) {
    const row = held.get(m.id);
    const who = everyone.get(m.entryId);
    if (row === undefined || who === undefined) continue;
    const mine = bills.filter((b) => b.membershipId === m.id);
    // As the person's page reads it: the count moved over periods nobody was asked for.
    const count = who.past ? null : countAfterGap(row.membership, today, new Set(mine.map((b) => b.periodIndex)));
    const membership = count === null ? row.membership : { ...row.membership, paidPeriods: count, paidFloor: count };
    const target = memberPayTarget(membership, row.nextBillMinor, today, mine, who.past);
    const base = { entryId: m.entryId, name: who.name, membershipId: m.id, typeName: row.typeName, busy: busy.has(m.id) };
    if (target !== null && target.leftMinor > 0) {
      open.push({
        ...base,
        target: { kind: "period", periodIndex: target.periodIndex },
        fee: null,
        covers: target.covers,
        dueOn: target.dueOn,
        leftMinor: target.leftMinor,
        currency: row.currency,
      });
    }
    for (const fee of fees.filter((f) => f.membershipId === m.id)) {
      open.push({
        ...base,
        target: { kind: "fee", billId: fee.id },
        fee: { kind: fee.kind, forName: fee.forName },
        covers: null,
        dueOn: fee.dueOn,
        leftMinor: fee.amountMinor - fee.paidMinor,
        currency: fee.currency,
      });
    }
  }
  return { people, memberships, bills, payments, open };
}

/** Why a bill can't take this payment, or null where it can. */
function cannotFor(b: OpenBill, amountMinor: number, currency: string): MatchBill["cannot"] {
  if (b.currency !== currency) return "currency";
  if (b.busy) return "busy";
  if (b.fee !== null && b.leftMinor !== amountMinor) return "fee_whole";
  return b.leftMinor < amountMinor ? "too_little" : null;
}

/** One person's bills and those of anybody they pay for, soonest due first, the person's own before
 *  another's on the same day, each saying why it can't take a payment of this much, where it can't. */
export function billsOfPerson(loaded: LoadedBills, entryId: string, amountMinor: number, currency: string): MatchBill[] {
  const theirs = new Set((loaded.people.get(entryId) ?? []).map((p) => p.entryId));
  return loaded.open
    .filter((b) => theirs.has(b.entryId))
    .map((b) => ({
      entryId: b.entryId,
      name: b.name,
      membershipId: b.membershipId,
      typeName: b.typeName,
      target: b.target,
      fee: b.fee,
      covers: b.covers,
      dueOn: b.dueOn,
      leftMinor: b.leftMinor,
      currency: b.currency,
      cannot: cannotFor(b, amountMinor, currency),
    }))
    .sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : Number(b.entryId === entryId) - Number(a.entryId === entryId)));
}

/** The bill ticked: the first that can take exactly this much; -1 for none. */
export const tickOf = (bills: readonly MatchBill[], amountMinor: number): number => bills.findIndex((b) => b.cannot === null && b.leftMinor === amountMinor);

/** Why a payment waits that leaves no doubt which bill, so one is ticked for one press: one bill fits
 *  (due within the week, or later), or it fits and the bill before it was paid just now (said beside it).
 *  Never where staff choose: who paid, which of several bills, how much, or a bill they took it off. */
export const TICKED: ReadonlySet<SquareAppWaitReason> = new Set<SquareAppWaitReason>(["ready", "too_early", "maybe_twice"]);

/** Why a payment waits where only the person's bills were in doubt: worked out again from today's bills. */
const BILLS_ONLY: ReadonlySet<SquareAppWaitReason> = new Set<SquareAppWaitReason>(["ready", "too_early", "maybe_twice", "no_bill", "several_bills", "busy"]);

/** Why a payment waits where Match's box may tick a bill of the person staff pick: the bills alone were in
 *  doubt, or who paid. Never how much (items, a sale paid in parts, Square's tax), a bill staff took it
 *  off, a refund, or a location two gyms use. */
const BOX_TICKS: ReadonlySet<SquareAppWaitReason> = new Set<SquareAppWaitReason>([...BILLS_ONLY, "no_customer", "not_linked", "several_people", "other_location"]);

/** The bills of this person and of anybody they pay for, as the take-in's rule reads them. */
function candidatesOf(loaded: LoadedBills, entryId: string, today: string): SquareAppCandidate[] {
  const theirs = new Set((loaded.people.get(entryId) ?? []).map((p) => p.entryId));
  const since = addDays(today, -SQUARE_APP.twiceDays);
  return loaded.open
    .filter((b) => theirs.has(b.entryId))
    .map((b): SquareAppCandidate => {
      const base = { entryId: b.entryId, leftMinor: b.leftMinor, dueOn: b.dueOn, busy: b.busy };
      if (b.target.kind === "fee") return { ...base, target: { kind: "fee", membershipId: b.membershipId, billId: b.target.billId }, paidJustBefore: false };
      const periodIndex = b.target.periodIndex;
      return {
        ...base,
        target: { kind: "period", membershipId: b.membershipId, periodIndex },
        paidJustBefore: loaded.payments.some((p) => p.membershipId === b.membershipId && p.periodIndex === periodIndex - 1 && p.paidOn >= since),
      };
    });
}

/** Why a payment of this much from this person waits, read against today's bills: the take-in's rule, for a
 *  sale whose who and what were already plain. */
export function decideNow(loaded: LoadedBills, entryId: string, amountMinor: number, today: string): SquareAppWaitReason {
  const d = squareAppDecision({
    lines: "typed",
    addedOnTop: false,
    enteredMinor: amountMinor,
    paidInParts: false,
    customer: "one",
    amountMinor,
    today,
    candidates: candidatesOf(loaded, entryId, today),
  });
  return d.kind === "wait" ? d.reason : "no_bill";
}

/** The bill Match's box ticks for the person staff picked: the one the rule leaves no doubt about, where
 *  why the payment waits allows a tick at all; else none (-1). */
export function boxTick(loaded: LoadedBills, reason: SquareAppWaitReason, entryId: string, bills: readonly MatchBill[], amountMinor: number, today: string): number {
  if (!BOX_TICKS.has(reason) || !TICKED.has(decideNow(loaded, entryId, amountMinor, today))) return -1;
  return tickOf(bills, amountMinor);
}

export interface TickAsked {
  id: string;
  entryId: string | null;
  reason: SquareAppWaitReason;
  amountMinor: number;
  enteredMinor: number | null;
  currency: string;
}

/** Why each of these waiting payments waits now, and the bill it is ticked for, by the payment's id: for a
 *  payment whose bills alone were in doubt, worked out again from today's bills, so a bill paid by hand
 *  meanwhile, or a payer added, is said and never ticked past ("they may have paid twice" said beside it).
 *  Any other payment keeps why it waited, with no bill ticked. */
export async function ticksFor(sql: SqlOrTx, gymId: string, today: string, rows: readonly TickAsked[]): Promise<Map<string, { reason: SquareAppWaitReason; bill: MatchBill | null }>> {
  const asked = rows.filter((r): r is TickAsked & { entryId: string } => r.entryId !== null && BILLS_ONLY.has(r.reason));
  const out = new Map<string, { reason: SquareAppWaitReason; bill: MatchBill | null }>();
  if (asked.length === 0) return out;
  const loaded = await loadBills(sql, gymId, [...new Set(asked.map((r) => r.entryId))], today);
  for (const r of asked) {
    const amount = r.enteredMinor ?? r.amountMinor;
    const reason = decideNow(loaded, r.entryId, amount, today);
    const bills = billsOfPerson(loaded, r.entryId, amount, r.currency);
    out.set(r.id, { reason, bill: TICKED.has(reason) ? (bills[tickOf(bills, amount)] ?? null) : null });
  }
  return out;
}

/** The person's page (heldService): the payments from Square Point of Sale waiting that hold their card on
 *  file, theirs or their payer's, each with the bill it fits ticked for one press of Match there, and
 *  whether a card of theirs is held by them. */
export async function squareAppWaitingFor(sql: SqlOrTx, gymId: string, entryId: string, today: string): Promise<SquareAppWaiting[]> {
  const [rows, held] = await Promise.all([toMatch.waitingFor(sql, gymId, entryId), toMatch.cardHeldFor(sql, gymId, [entryId])]);
  const ticks = await ticksFor(sql, gymId, today, rows);
  return rows.map((r) => ({
    id: r.id,
    amountMinor: r.amountMinor,
    currency: r.currency,
    takenOn: r.takenOn,
    byName: r.byName,
    holdsCard: held.has(entryId),
    takenAt: r.takenAt.toISOString(),
    deviceName: r.deviceName,
    // Said only where Square added something on top of it.
    enteredMinor: r.enteredMinor !== null && r.enteredMinor < r.amountMinor ? r.enteredMinor : null,
    maybeTwice: (ticks.get(r.id)?.reason ?? r.reason) === "maybe_twice",
    bill: ticks.get(r.id)?.bill ?? null,
  }));
}
