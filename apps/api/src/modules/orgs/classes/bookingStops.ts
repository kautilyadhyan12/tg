// NO NEW BOOKINGS WHILE A PAYMENT IS OVERDUE (ROADMAP Stage 2 item 17i; spec Part 3 §13.4).
//
// The worst thing this could do to a real person: stop somebody who has paid, or whose
// payment is not late yet by the gym's own days of grace, from booking their class. So a
// gym that lets everybody book reads nothing more, and a person's payment is judged by the
// one rule the bill on their page reads (`bookingStopped`), from the bills of their own
// record and nobody else's.
import { bookingStopped, paymentOverdue } from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import { dayInTz } from "../../gamification/streak.js";
import { currentNames, staffAmong } from "../checkin/repo.js";
import { listBillFacts } from "../memberships/billsSql.js";
import { overdueRule, type OverdueRule } from "./bookingsRepo.js";

/** An app account and the record of the gym's list it books on; null where the list does
 *  not say which is theirs, which has no bills and stops nobody. */
export interface Booker {
  userId: string;
  entryId: string | null;
}

/** The accounts among these that the gym's choice stops making a new booking now. */
export async function stoppedBookers(sql: Sql | TransactionSql, gymId: string, rule: OverdueRule, bookers: readonly Booker[], now: Date): Promise<Set<string>> {
  const stopped = new Set<string>();
  if (rule.rule === "let_book") return stopped;
  const owing = bookers.flatMap((b) => (b.entryId === null ? [] : [{ userId: b.userId, entryId: b.entryId }]));
  if (owing.length === 0) return stopped;
  const today = dayInTz(now, rule.timezone);
  const bills = await listBillFacts(sql, gymId, today, owing.map((b) => b.entryId));
  const late = owing.filter((b) => bills.owedSince.has(b.entryId));
  if (late.length === 0) return stopped;
  const staff = await staffAmong(sql, gymId, { userIds: late.map((b) => b.userId), entryIds: [] });
  for (const b of late) {
    const owedSince = bills.owedSince.get(b.entryId) ?? null;
    if (bookingStopped({ rule: rule.rule, staff: staff.userIds.has(b.userId), owedSince, today, overdueAfterDays: rule.afterDays })) stopped.add(b.userId);
  }
  return stopped;
}

/** The people on the gym's list whose payment is overdue today, its own staff left out: the
 *  ones its choice stops, or would, named in Booking settings. The first \`names\` by name. */
export async function overduePeople(
  sql: Sql,
  gymId: string,
  rule: OverdueRule,
  now: Date,
  names: number,
): Promise<{ count: number; people: { entryId: string; name: string }[] }> {
  const today = dayInTz(now, rule.timezone);
  const bills = await listBillFacts(sql, gymId, today, null);
  const late = [...bills.owedSince].flatMap(([entryId, owedSince]) => (paymentOverdue(owedSince, today, rule.afterDays) ? [entryId] : []));
  if (late.length === 0) return { count: 0, people: [] };
  const [current, staff] = await Promise.all([currentNames(sql, gymId), staffAmong(sql, gymId, { userIds: [], entryIds: late })]);
  const owing = new Set(late);
  const listed = current.filter((record) => owing.has(record.id) && !staff.entryIds.has(record.id));
  return { count: listed.length, people: listed.slice(0, names).map((record) => ({ entryId: record.id, name: record.name })) };
}

/** Whether the gym's choice stops this record's new bookings now, for the line beside its
 *  overdue bill on the person's page: by the same rule, its own staff never. */
export async function recordStopped(sql: Sql, gymId: string, entryId: string, now: Date): Promise<boolean> {
  const rule = await overdueRule(sql, gymId);
  if (rule === null || rule.rule === "let_book") return false;
  const today = dayInTz(now, rule.timezone);
  const owedSince = (await listBillFacts(sql, gymId, today, [entryId])).owedSince.get(entryId) ?? null;
  if (!paymentOverdue(owedSince, today, rule.afterDays)) return false;
  const staff = await staffAmong(sql, gymId, { userIds: [], entryIds: [entryId] });
  return bookingStopped({ rule: rule.rule, staff: staff.entryIds.has(entryId), owedSince, today, overdueAfterDays: rule.afterDays });
}
