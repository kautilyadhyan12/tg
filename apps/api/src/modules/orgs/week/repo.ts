// The reads behind Overview's "Last 7 days" box (ROADMAP 20d-ii). Every read names the gym
// in its WHERE and returns counts, never a person.
import type { Sql, TransactionSql } from "postgres";
import { z } from "zod";
import { HELD_PAYMENT_WORDS, type GymWeekWindow } from "@app/shared";
import { listPeople } from "../reports/repo.js";

const count = z.number().int().min(0);

const membersRowSchema = z.object({ joined: count, left_count: count, first_listed_on: z.string().nullable() });

/** Who started and who left in the days counted, by Reports' own rule (`listPeople`), and
 *  the day the list itself began; null for a gym with nobody on its list. */
export async function readWeekMembers(
  tx: TransactionSql,
  gymId: string,
  timezone: string,
  window: GymWeekWindow,
  gone: readonly { id: string; on: string }[],
): Promise<{ joined: number; left: number; firstListedOn: string } | null> {
  const rows = await tx<Record<string, unknown>[]>`
    WITH ${listPeople(tx, gymId, timezone, gone)}
    SELECT (count(*) FILTER (WHERE p.started >= ${window.from}::date AND p.started <= ${window.to}::date))::int AS joined,
           (count(*) FILTER (WHERE p.left_on >= ${window.from}::date AND p.left_on <= ${window.to}::date))::int AS left_count,
           to_char(min(p.listed_on), 'YYYY-MM-DD') AS first_listed_on
    FROM people p`;
  const row = membersRowSchema.parse(rows[0]);
  return row.first_listed_on === null ? null : { joined: row.joined, left: row.left_count, firstListedOn: row.first_listed_on };
}

const visitsRowSchema = z.object({ this_week: count, week_before: count, first_visit_on: z.string().nullable() });

/** The Attendance page's rows in the days counted and in the seven before, and the day of
 *  the gym's first check-in. */
export async function readWeekVisits(
  sql: Sql,
  gymId: string,
  window: GymWeekWindow,
): Promise<{ thisWeek: number; weekBefore: number; firstVisitOn: string | null }> {
  const rows = await sql<Record<string, unknown>[]>`
    SELECT (SELECT count(*)::int FROM gym_attendance a
            WHERE a.gym_id = ${gymId} AND a.day >= ${window.from}::date AND a.day <= ${window.to}::date) AS this_week,
           (SELECT count(*)::int FROM gym_attendance a
            WHERE a.gym_id = ${gymId} AND a.day >= ${window.beforeFrom}::date AND a.day <= ${window.beforeTo}::date) AS week_before,
           (SELECT to_char(min(a.day), 'YYYY-MM-DD') FROM gym_attendance a WHERE a.gym_id = ${gymId}) AS first_visit_on`;
  const row = visitsRowSchema.parse(rows[0]);
  return { thisWeek: row.this_week, weekBefore: row.week_before, firstVisitOn: row.first_visit_on };
}

const paymentRowSchema = z.object({ own_word: count, other_words: count, any_bill: z.boolean() });

/** What the Members list's "Payment due" chip adds to the people the app answers for: the
 *  current records whose own word from the gym's file is that one, folded as the chip
 *  folds it. With it, how many of those records carry any OTHER payment word of the gym's
 *  own ("Overdue", "Unpaid", "Paid": the app cannot tell which of them owe), and whether
 *  the gym has ever billed anybody here. */
export async function readPaymentDue(
  tx: TransactionSql,
  gymId: string,
  heldIds: readonly string[],
): Promise<{ ownWord: number; otherWords: number; anyBill: boolean }> {
  const rows = await tx<Record<string, unknown>[]>`
    SELECT (SELECT count(*)::int FROM gym_member_list_entries e
            WHERE e.gym_id = ${gymId} AND e.former_at IS NULL
              AND lower(coalesce(e.payment_status, '')) = ${HELD_PAYMENT_WORDS.due.toLowerCase()}
              AND e.id <> ALL(${[...heldIds]}::uuid[])) AS own_word,
           (SELECT count(*)::int FROM gym_member_list_entries e
            WHERE e.gym_id = ${gymId} AND e.former_at IS NULL
              AND coalesce(e.payment_status, '') <> ''
              AND lower(e.payment_status) <> ${HELD_PAYMENT_WORDS.due.toLowerCase()}
              AND e.id <> ALL(${[...heldIds]}::uuid[])) AS other_words,
           EXISTS (SELECT 1 FROM gym_member_bills b WHERE b.gym_id = ${gymId}) AS any_bill`;
  const row = paymentRowSchema.parse(rows[0]);
  return { ownWord: row.own_word, otherWords: row.other_words, anyBill: row.any_bill };
}
