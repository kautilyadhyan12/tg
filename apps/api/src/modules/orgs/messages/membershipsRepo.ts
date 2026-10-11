// WHAT THE AUTOMATIC MESSAGES READ OF A GYM'S MEMBERSHIPS AND BILLS (spec Part 3 §16.2;
// ROADMAP 20b-ii). Every statement names the gym. A membership and its bills are their
// record's, so they are a person's only where that person holds the record alone
// (`soloHolders`): a record two accounts share is nobody's, and neither is told about it.
import {
  GYM_MESSAGE_PAYMENTS_DAYS,
  membershipMessageFacts,
  type BillForMessages,
  type HeldForMessages,
  type MembershipMessageFacts,
} from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import { soloHolders } from "../leaderboard/visits.js";
import { overdueDaysOf } from "../memberships/billsSql.js";
import { inUseForList } from "../memberships/heldRepo.js";

type SqlOrTx = Sql | TransactionSql;

export interface GymMoney {
  /** The gym's grace period for a bill. */
  billsOverdueAfterDays: number;
  /** A payment was recorded in the app in the last `GYM_MESSAGE_PAYMENTS_DAYS`. */
  takesPayments: boolean;
}
export const NO_GYM_MONEY: GymMoney = { billsOverdueAfterDays: 0, takesPayments: false };

/** Was a payment recorded at this gym, and not taken back, in the `days` up to `today`? */
export async function paymentsLately(sql: SqlOrTx, gymId: string, today: string, days: number): Promise<boolean> {
  const rows = await sql<{ one: number }[]>`
    SELECT 1 AS one FROM gym_member_payments p
    WHERE p.gym_id = ${gymId} AND p.undone_at IS NULL
      AND p.paid_on <= ${today}::date AND p.paid_on > ${today}::date - ${days}::int
    LIMIT 1`;
  return rows.length > 0;
}

export async function gymMoney(sql: SqlOrTx, gymId: string, today: string): Promise<GymMoney> {
  const billsOverdueAfterDays = await overdueDaysOf(sql, gymId);
  return { billsOverdueAfterDays, takesPayments: await paymentsLately(sql, gymId, today, GYM_MESSAGE_PAYMENTS_DAYS) };
}

/** The open bills of the gym that fell due before `today`: the only ones a notice can be
 *  about. Read by the open bills' own index. */
async function openBillsDue(sql: SqlOrTx, gymId: string, today: string): Promise<BillForMessages[]> {
  const rows = await sql<{ id: string; held_membership_id: string; due_on: string }[]>`
    SELECT b.id, b.held_membership_id, b.due_on::text AS due_on
    FROM gym_member_bills b
    WHERE b.gym_id = ${gymId} AND b.status = 'open' AND b.due_on < ${today}::date`;
  return rows.map((row) => ({ id: row.id, membershipId: row.held_membership_id, dueOn: row.due_on, open: true }));
}

/** For each live app member who holds a current record alone: their trial, the membership
 *  of theirs that is ending and their open bills, as the rule reads them on `today`.
 *  Somebody not in the answer has none (`NO_MEMBERSHIP_FACTS`). A past member's record is
 *  not read: its memberships are kept and not in use. */
export async function membershipFactsByPerson(sql: SqlOrTx, gymId: string, today: string): Promise<Map<string, MembershipMessageFacts>> {
  const held = await inUseForList(sql, gymId, null);
  const facts = new Map<string, MembershipMessageFacts>();
  if (held.length === 0) return facts;
  const holders = await sql<{ entry_id: string; user_id: string }[]>`${soloHolders(sql, gymId)}`;
  const holderOf = new Map(holders.map((row) => [row.entry_id, row.user_id]));
  const bills = await openBillsDue(sql, gymId, today);
  const byMembership = new Map<string, BillForMessages[]>();
  for (const bill of bills) byMembership.set(bill.membershipId, [...(byMembership.get(bill.membershipId) ?? []), bill]);

  const byPerson = new Map<string, HeldForMessages[]>();
  for (const row of held) {
    const userId = holderOf.get(row.entryId);
    if (userId === undefined) continue;
    byPerson.set(userId, [...(byPerson.get(userId) ?? []), { id: row.held.id, membership: row.held.membership }]);
  }
  for (const [userId, memberships] of byPerson) {
    const theirs = memberships.flatMap((m) => byMembership.get(m.id) ?? []);
    facts.set(userId, membershipMessageFacts(memberships, theirs, today));
  }
  return facts;
}

/** What the Settings box says of a gym's use of memberships: whether its price list has a
 *  trial on it, and whether it has anything on it. */
export async function priceListUse(sql: SqlOrTx, gymId: string): Promise<{ trialOnList: boolean; priceList: boolean }> {
  const rows = await sql<{ trial: boolean; any: boolean }[]>`
    SELECT coalesce(bool_or(t.kind = 'trial'), false) AS trial, count(*) > 0 AS any
    FROM gym_membership_types t
    WHERE t.gym_id = ${gymId} AND t.archived_at IS NULL`;
  return { trialOnList: rows[0]?.trial ?? false, priceList: rows[0]?.any ?? false };
}
