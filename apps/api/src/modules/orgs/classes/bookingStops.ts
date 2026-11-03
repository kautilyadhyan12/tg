// NO NEW BOOKINGS WHILE A PAYMENT IS OVERDUE (ROADMAP Stage 2 item 17i; spec Part 3 §13.4), AND
// NONE UNTIL THE MEMBERSHIP AGREEMENT IS SIGNED (18u-iv; spec Part 3 §14.8).
//
// The worst thing this could do to a real person: stop somebody who has paid, or whose
// payment is not late yet by the gym's own days of grace, or who has signed, or whose
// membership asks for no agreement, from booking their class. So a gym that lets everybody
// book reads nothing more, a payment is judged by the one rule the bill on their page reads
// (`bookingStopped`), an agreement by the one rule Members' "Agreement not signed" reads
// (`agreementNotSignedRecords`), each from their own record and nobody else's.
import { bookingStopped, paymentOverdue, unsignedStopped, type BookingStop } from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import { dayInTz } from "../../gamification/streak.js";
import { agreementNotSignedRecords } from "../agreement/notSigned.js";
import { currentNames, staffAmong } from "../checkin/repo.js";
import { listBillFacts } from "../memberships/billsSql.js";
import { stopRule, type StopRule } from "./bookingsRepo.js";

/** An app account and the record of the gym's list it books on; null where the list does
 *  not say which is theirs, which has no bills or memberships and stops nobody. */
export interface Booker {
  userId: string;
  entryId: string | null;
}

/** The accounts among these that the gym's choices stop making a new booking now, with why: a
 *  payment overdue is said before an agreement. A record a member of staff is on is never
 *  stopped, whichever of its accounts books, as Booking rules and the person's page read it. */
export async function stoppedBookers(
  sql: Sql | TransactionSql,
  gymId: string,
  rule: StopRule,
  bookers: readonly Booker[],
  now: Date,
): Promise<Map<string, BookingStop>> {
  const stopped = new Map<string, BookingStop>();
  if (rule.rule === "let_book" && rule.unsigned === "let_book") return stopped;
  const owing = bookers.flatMap((b) => (b.entryId === null ? [] : [{ userId: b.userId, entryId: b.entryId }]));
  if (owing.length === 0) return stopped;
  const today = dayInTz(now, rule.timezone);
  const records = [...new Set(owing.map((b) => b.entryId))];
  const [bills, toSign] = await Promise.all([
    rule.rule === "stop" ? listBillFacts(sql, gymId, today, records) : null,
    rule.unsigned === "stop" ? agreementNotSignedRecords(sql, gymId, today, records) : null,
  ]);
  const late = owing.filter((b) => (bills?.owedSince.has(b.entryId) ?? false) || (toSign?.has(b.entryId) ?? false));
  if (late.length === 0) return stopped;
  const staff = await staffAmong(sql, gymId, { userIds: late.map((b) => b.userId), entryIds: late.map((b) => b.entryId) });
  for (const b of late) {
    const isStaff = staff.userIds.has(b.userId) || staff.entryIds.has(b.entryId);
    const owedSince = bills?.owedSince.get(b.entryId) ?? null;
    if (bookingStopped({ rule: rule.rule, staff: isStaff, owedSince, today, overdueAfterDays: rule.afterDays })) {
      stopped.set(b.userId, "payment_overdue");
    } else if (unsignedStopped({ rule: rule.unsigned, staff: isStaff, unsigned: toSign?.has(b.entryId) ?? false })) {
      stopped.set(b.userId, "agreement_not_signed");
    }
  }
  return stopped;
}

/** Why the gym stops this one account's new bookings now, or null. */
export async function stopOf(sql: Sql | TransactionSql, gymId: string, rule: StopRule, booker: Booker, now: Date): Promise<BookingStop | null> {
  return (await stoppedBookers(sql, gymId, rule, [booker], now)).get(booker.userId) ?? null;
}

/** The people on the gym's list whose payment is overdue today, its own staff left out: the
 *  ones its choice stops, or would, named in Booking settings. The first \`names\` by name. */
export async function overduePeople(
  sql: Sql,
  gymId: string,
  rule: StopRule,
  now: Date,
  names: number,
): Promise<{ count: number; people: { entryId: string; name: string }[] }> {
  const today = dayInTz(now, rule.timezone);
  const bills = await listBillFacts(sql, gymId, today, null);
  const late = [...bills.owedSince].flatMap(([entryId, owedSince]) => (paymentOverdue(owedSince, today, rule.afterDays) ? [entryId] : []));
  return await named(sql, gymId, late, names);
}

/** The people on the gym's list with a membership agreement to sign today, its own staff left
 *  out: the ones its choice stops, or would, named in Membership agreements, by the rule Members'
 *  "Agreement not signed" reads. The first \`names\` by name. */
export async function unsignedPeople(
  sql: Sql,
  gymId: string,
  timezone: string,
  now: Date,
  names: number,
): Promise<{ count: number; people: { entryId: string; name: string }[] }> {
  const toSign = await agreementNotSignedRecords(sql, gymId, dayInTz(now, timezone));
  return await named(sql, gymId, toSign === null ? [] : [...toSign], names);
}

/** These records as the list names them, its own staff left out, by name. */
async function named(sql: Sql, gymId: string, entryIds: readonly string[], names: number): Promise<{ count: number; people: { entryId: string; name: string }[] }> {
  if (entryIds.length === 0) return { count: 0, people: [] };
  const [current, staff] = await Promise.all([currentNames(sql, gymId), staffAmong(sql, gymId, { userIds: [], entryIds: [...entryIds] })]);
  const among = new Set(entryIds);
  const listed = current.filter((record) => among.has(record.id) && !staff.entryIds.has(record.id));
  return { count: listed.length, people: listed.slice(0, names).map((record) => ({ entryId: record.id, name: record.name })) };
}

/** Whether the gym's choice stops this record's new bookings now, for the line beside its
 *  overdue bill on the person's page: by the same rule, its own staff never. */
export async function recordStopped(sql: Sql, gymId: string, entryId: string, now: Date): Promise<boolean> {
  const rule = await stopRule(sql, gymId);
  if (rule === null || rule.rule === "let_book") return false;
  const today = dayInTz(now, rule.timezone);
  const owedSince = (await listBillFacts(sql, gymId, today, [entryId])).owedSince.get(entryId) ?? null;
  if (!paymentOverdue(owedSince, today, rule.afterDays)) return false;
  const staff = await staffAmong(sql, gymId, { userIds: [], entryIds: [entryId] });
  return bookingStopped({ rule: rule.rule, staff: staff.entryIds.has(entryId), owedSince, today, overdueAfterDays: rule.afterDays });
}

/** Whether a membership agreement of this record left to sign stops its new bookings, for the
 *  line under "Agreement not signed" on the person's page: the gym's choice is Stop, and the
 *  record is not one of its staff. */
export async function unsignedStopsRecord(sql: Sql, gymId: string, entryId: string): Promise<boolean> {
  const rule = await stopRule(sql, gymId);
  if (rule === null || rule.unsigned === "let_book") return false;
  const staff = await staffAmong(sql, gymId, { userIds: [], entryIds: [entryId] });
  return unsignedStopped({ rule: rule.unsigned, staff: staff.entryIds.has(entryId), unsigned: true });
}
