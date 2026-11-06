// RAISE THE PRICE FOR MEMBERS ALREADY ON A LINE (ROADMAP 18w; Kd, 2026-10-22 and 2026-11-06,
// `rulings/2026-11-06-18w.md`). Staff raise a repeating line's price; the box before Save lists everybody on the line,
// who goes up and who won't with the reason, each ticked or not; Save raises only those ticked that still may be.
// Each raise is emailed to whoever pays, so many days before its first payment at the new price, through the renewal
// reminders' queue; only once it has gone is anything charged at it (`periodPriceMinor` in `heldRepo.ts`).
//
// THE WORST THING here is charging somebody more than they agreed to. Three things stand in its way: the ONE rule
// (`priceRaiseNext`) never picks a payment inside the notice, a minimum term, or one billed or paid already; the
// write raises only memberships of this line, of this gym, ticked, that the rule still raises at that moment, under a
// lock; and nothing is charged until the email has gone, from the period it named (the sender, `renewalReminders.ts`).
import {
  authEmailSchema,
  periodListedMinor,
  priceRaiseDue,
  priceRaiseNext,
  priceRaisePreviewResponseSchema,
  raisedOwnPriceMinor,
  type PriceRaisePreviewResponse,
  type PriceRaiseState,
  type PriceRaiseStatus,
} from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import { emailHmac } from "../invites/address.js";
import { billOf } from "./billsSql.js";
import type { HeldRow } from "./heldRepo.js";
import * as raisesRepo from "./priceRaisesRepo.js";
import * as reminders from "./renewalRemindersRepo.js";

type SqlOrTx = Sql | TransactionSql;

/** What one payment of period `index` comes to at its own price `ownMinor`, tax in: what the email names. Screens name
 *  the price before tax, as the price list and a person's page do. */
function amountAt(row: HeldRow, index: number, ownMinor: number): number {
  return billOf(periodListedMinor(row.membership, index, ownMinor), row.taxApplied).amountMinor;
}

/** Where a membership's raise stands: none; written and waiting for its email; its email on its way; emailed and its
 *  first payment still to come; or charged (its first payment billed, paid, or its day come), and so its price. */
type Standing = "none" | "waiting" | "emailing" | "sent" | "charged";

/** The emails written for raises, by membership and occasion. */
type Written = ReadonlyMap<string, reminders.ReminderWritten>;
const writtenKey = (heldId: string, occasion: string): string => `${heldId}|${occasion}`;
/** The email written for this membership's raise, if one is. */
const emailOf = (written: Written, row: HeldRow): reminders.ReminderWritten | undefined =>
  row.raise === null ? undefined : written.get(writtenKey(row.id, raisesRepo.priceOccasion(row.raise.id)));

function standingOf(row: HeldRow, billedTo: number, today: string, written: Written): Standing {
  const raise = row.raise;
  if (raise === null) return "none";
  if (raise.fromPeriod === null || raise.fromOn === null) {
    const email = emailOf(written, row);
    return email?.state === "sending" ? "emailing" : "waiting";
  }
  const charged = billedTo >= raise.fromPeriod || row.membership.paidPeriods > raise.fromPeriod || today >= raise.fromOn;
  return charged ? "charged" : "sent";
}

/** The facts each membership's status is read from, all read at once for many. */
interface Facts {
  today: string;
  billed: ReadonlyMap<string, number>;
  written: Written;
  /** The payers' address keys that bounced or were refused. */
  blocked: ReadonlySet<string>;
  emailKey: Buffer | null;
}

const keyOf = (emailKey: Buffer | null, held: reminders.PayerHeld): string | null =>
  emailKey === null || held.payerEmail === null || !authEmailSchema.safeParse(held.payerEmail).success ? null : emailHmac(emailKey, held.payerEmail);

async function factsOf(sql: SqlOrTx, emailKey: Buffer | null, gymId: string, held: readonly reminders.PayerHeld[], today: string): Promise<Facts> {
  const ids = held.map((h) => h.row.id);
  const billed = await raisesRepo.billedTo(sql, gymId, ids);
  const written = new Map((await reminders.remindersOf(sql, gymId, ids)).map((w) => [writtenKey(w.heldId, w.occasion), w]));
  const blocked = await reminders.blockedOf(
    sql,
    held.flatMap((h) => {
      const key = keyOf(emailKey, h);
      return key === null ? [] : [key];
    }),
  );
  return { today, billed, written, blocked, emailKey };
}

/** Why an email to this payer cannot go, or null. */
function cannotEmail(held: reminders.PayerHeld, facts: Facts): PriceRaiseState | null {
  if (held.skipped !== null) return held.skipped;
  if (held.payerEmail === null || !authEmailSchema.safeParse(held.payerEmail).success) return "no_email";
  const key = keyOf(facts.emailKey, held);
  return key !== null && facts.blocked.has(key) ? "address_blocked" : null;
}

/** WHAT THE LINE'S NEW PRICE WOULD DO to one membership on it, with this notice, and whether Save may raise it. */
export function proposedStatus(held: reminders.PayerHeld, lineMinor: number, noticeDays: number, facts: Facts): { status: PriceRaiseStatus; writable: boolean } {
  const row = held.row;
  const m = row.membership;
  const billedTo = facts.billed.get(row.id) ?? -1;
  const standing = standingOf(row, billedTo, facts.today, facts.written);
  const raise = row.raise;
  const plan = priceRaiseNext(m, noticeDays, facts.today, billedTo);
  const said = (state: PriceRaiseState, fromOwn: number, toOwn: number, startsOn: string | null = null, on: string | null = null) => ({
    status: { state, fromMinor: fromOwn, toMinor: toOwn, startsOn, on },
    writable: state === "will_send" || state === "after_freeze",
  });

  // Its price now: a raise already charged is it.
  const own = standing === "charged" && raise !== null ? raise.priceMinor : row.priceMinor;
  const to = raisedOwnPriceMinor(lineMinor, row.discount);
  if (plan.kind === "none" && plan.reason === "not_renewing") return said("not_renewing", own, own);
  // A raise emailed and not yet charged stands as the member was told it.
  if ((standing === "sent" || standing === "emailing") && raise !== null) return said("raise_waiting", own, raise.priceMinor, raise.fromOn);
  if (to <= own) return said("not_higher", own, own);
  const why = cannotEmail(held, facts);
  if (why !== null) return said(why, own, own);
  if (plan.kind === "none") return said("after_freeze", own, to);
  return said("will_send", own, to, plan.next.fromOn, plan.next.sendOn > facts.today ? plan.next.sendOn : facts.today);
}

/** WHERE A RAISE WRITTEN STANDS on one membership, for its page and the box; null where there is none, or it is
 *  charged already (its price says it). `canKeep`: Keep the old price may take it off. */
export function standingStatus(held: reminders.PayerHeld, facts: Facts): { status: PriceRaiseStatus; canKeep: boolean } | null {
  const row = held.row;
  const raise = row.raise;
  if (raise === null) return null;
  const billedTo = facts.billed.get(row.id) ?? -1;
  const standing = standingOf(row, billedTo, facts.today, facts.written);
  if (standing === "none" || standing === "charged") return null;
  const said = (state: PriceRaiseState, startsOn: string | null, on: string | null) => ({
    status: { state, fromMinor: row.priceMinor, toMinor: raise.priceMinor, startsOn, on },
    canKeep: standing !== "emailing",
  });
  if (standing === "sent" && raise.fromPeriod !== null) return said("sent", raise.fromOn, raise.sentOn);
  const email = emailOf(facts.written, row);
  const plan = priceRaiseNext(row.membership, raise.noticeDays, facts.today, billedTo);
  if (standing === "emailing") return said("sending", email?.aboutOn ?? null, null);
  if (email !== undefined && (email.state === "failed" || email.state === "skipped")) return said(email.reason === "address_blocked" ? "address_blocked" : "not_sent", null, null);
  if (plan.kind === "none") return said(plan.reason === "frozen" ? "after_freeze" : "not_renewing", null, null);
  const why = cannotEmail(held, facts);
  if (why !== null) return said(why, null, null);
  if (email !== undefined) return said("sending", plan.next.fromOn, null);
  return said("will_send", plan.next.fromOn, plan.next.sendOn > facts.today ? plan.next.sendOn : facts.today);
}

// ── WHAT A SCREEN READS ──

/** The box before Save: everybody on the line now, and what the new price would do to each. */
export async function previewRaise(sql: Sql, emailKey: Buffer | null, gymId: string, typeId: string, lineMinor: number, noticeDays: number, today: string, currency: string): Promise<PriceRaisePreviewResponse> {
  const held = await reminders.payersHeld(sql, { gymId, typeId });
  const facts = await factsOf(sql, emailKey, gymId, held, today);
  return priceRaisePreviewResponseSchema.parse({
    currency,
    people: held.map((h) => ({
      membershipId: h.row.id,
      entryId: h.entryId,
      name: h.holderName,
      paidBy: h.payerEntryId === h.entryId ? null : h.payerName,
      status: proposedStatus(h, lineMinor, noticeDays, facts).status,
    })),
  });
}

/** A person's page: each of their memberships with a raise still to come, and where it stands. */
export async function raisesOfRecord(sql: Sql, emailKey: Buffer | null, gymId: string, entryId: string, today: string): Promise<{ membershipId: string; status: PriceRaiseStatus; canKeep: boolean }[]> {
  const held = (await reminders.payersHeld(sql, { gymId, entryId })).filter((h) => h.row.raise !== null);
  if (held.length === 0) return [];
  const facts = await factsOf(sql, emailKey, gymId, held, today);
  return held.flatMap((h) => {
    const standing = standingStatus(h, facts);
    return standing === null ? [] : [{ membershipId: h.row.id, ...standing }];
  });
}

// ── THE WRITES ──

/** Save's raise, inside the line's own change: of the memberships ticked, those of this line, in use, that the rule
 *  still raises now, each locked first. Answers how many were raised. */
export async function applyRaise(
  tx: TransactionSql,
  q: { gymId: string; typeId: string; lineMinor: number; noticeDays: number; membershipIds: readonly string[]; emailKey: Buffer | null; userId: string; now: Date },
): Promise<number> {
  const today = await reminders.gymToday(tx, q.gymId, q.now);
  if (today === null) return 0;
  const locked = await raisesRepo.lockLineHeld(tx, q.gymId, q.typeId, [...new Set(q.membershipIds)]);
  if (locked.length === 0) return 0;
  const held = (await reminders.payersHeld(tx, { gymId: q.gymId, typeId: q.typeId, heldIds: locked })).filter((h) => h.row.typeId === q.typeId);
  const facts = await factsOf(tx, q.emailKey, q.gymId, held, today);
  const raises = held.flatMap((h): raisesRepo.NewRaise[] => {
    if (!proposedStatus(h, q.lineMinor, q.noticeDays, facts).writable) return [];
    const raise = h.row.raise;
    const charged = raise !== null && standingOf(h.row, facts.billed.get(h.row.id) ?? -1, facts.today, facts.written) === "charged";
    return [{ heldId: h.row.id, priceMinor: raisedOwnPriceMinor(q.lineMinor, h.row.discount), fold: charged ? { priceMinor: raise.priceMinor } : null }];
  });
  return await raisesRepo.writeRaises(tx, q.gymId, raises, q.noticeDays, q.userId, q.now);
}

export type KeepOutcome = { kind: "ok" } | { kind: "not_found" } | { kind: "emailing" };

/** Keep the old price: the raise of this membership is taken off while nothing has been charged at it and its email
 *  is not on its way. */
export async function keepOldPrice(sql: Sql, q: { gymId: string; entryId: string; heldId: string; now: Date }): Promise<KeepOutcome> {
  return await sql.begin(async (tx): Promise<KeepOutcome> => {
    if (!(await raisesRepo.lockHeldOf(tx, q.gymId, q.entryId, q.heldId))) return { kind: "not_found" };
    const today = await reminders.gymToday(tx, q.gymId, q.now);
    const held = (await reminders.payersHeld(tx, { gymId: q.gymId, heldIds: [q.heldId] }))[0];
    const raise = held?.row.raise ?? null;
    if (today === null || held === undefined || raise === null) return { kind: "not_found" };
    const facts = await factsOf(tx, null, q.gymId, [held], today);
    const standing = standingStatus(held, facts);
    if (standing === null) return { kind: "not_found" };
    if (!standing.canKeep) return { kind: "emailing" };
    await raisesRepo.deleteRaise(tx, q.gymId, q.heldId, raise.id);
    return { kind: "ok" };
  });
}

// ── THE EMAILS ──

/** Once an hour a gym's day, from 8 in the morning there: write each raise's email due today, for a payer with an
 *  address that can be sent to. Safe to run twice at once. */
export async function queueDuePriceRaises(deps: { sql: Sql; now: () => Date; gymIds?: readonly string[] }): Promise<number> {
  const now = deps.now();
  let queued = 0;
  for (const gym of await raisesRepo.gymsWithRaises(deps.sql, { now, gymIds: deps.gymIds ?? null })) {
    const waiting = await raisesRepo.waitingRaises(deps.sql, gym.gymId);
    const held = await reminders.payersHeld(deps.sql, { gymId: gym.gymId, heldIds: waiting });
    const facts = await factsOf(deps.sql, null, gym.gymId, held, gym.today);
    const due: reminders.QueuedReminder[] = [];
    for (const h of held) {
      const raise = h.row.raise;
      if (raise === null || raise.fromPeriod !== null || h.skipped !== null || h.payerEmail === null || !authEmailSchema.safeParse(h.payerEmail).success) continue;
      if (emailOf(facts.written, h.row) !== undefined) continue;
      const plan = priceRaiseNext(h.row.membership, raise.noticeDays, gym.today, facts.billed.get(h.row.id) ?? -1);
      if (!priceRaiseDue(plan, gym.today)) continue;
      due.push({ gymId: gym.gymId, heldId: h.row.id, entryId: h.payerEntryId, occasion: raisesRepo.priceOccasion(raise.id), what: "price", aboutOn: plan.next.fromOn, email: h.payerEmail });
    }
    queued += await reminders.queueReminders(deps.sql, due, now);
    await raisesRepo.markRaisesChecked(deps.sql, gym.gymId, now);
  }
  return queued;
}

/** The check before a raise's email, under the hold: the raise is still this one and waiting, the same payer at the
 *  same address, and the rule still names the same payment, due today. The plan, where it is. */
export async function priceRaiseStillDue(
  tx: TransactionSql,
  claim: { gymId: string; heldId: string; entryId: string | null; occasion: string; aboutOn: string },
  email: string,
  today: string,
): Promise<{ held: reminders.PayerHeld; fromPeriod: number; fromOn: string } | null> {
  const raiseId = raisesRepo.raiseOfOccasion(claim.occasion);
  const held = (await reminders.payersHeld(tx, { gymId: claim.gymId, heldIds: [claim.heldId] }))[0];
  const raise = held?.row.raise ?? null;
  if (held === undefined || raise === null || raise.id !== raiseId || raise.fromPeriod !== null) return null;
  if (held.skipped !== null || held.payerEntryId !== claim.entryId) return null;
  if (held.payerEmail === null || held.payerEmail.toLowerCase() !== email.toLowerCase()) return null;
  const billed = (await raisesRepo.billedTo(tx, claim.gymId, [claim.heldId])).get(claim.heldId) ?? -1;
  const plan = priceRaiseNext(held.row.membership, raise.noticeDays, today, billed);
  if (!priceRaiseDue(plan, today) || plan.next.fromOn !== claim.aboutOn) return null;
  return { held, fromPeriod: plan.next.fromPeriod, fromOn: plan.next.fromOn };
}

/** What one payment comes to before and after, tax in, for the email. */
export function raiseAmounts(row: HeldRow, fromPeriod: number): { fromMinor: number; toMinor: number } {
  const raise = row.raise;
  if (raise === null) throw new Error("a raise's amounts asked of a membership with none");
  return { fromMinor: amountAt(row, fromPeriod, row.priceMinor), toMinor: amountAt(row, fromPeriod, raise.priceMinor) };
}
