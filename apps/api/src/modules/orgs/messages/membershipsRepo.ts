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

/** The open bills of the gym that fell due in the `days` before `today`: the only ones a
 *  notice can be about. Read by the open bills' own index, and never further back, so a gym
 *  whose bills nobody settles is not read a year deep each morning. */
async function openBillsDue(sql: SqlOrTx, gymId: string, today: string, days: number): Promise<BillForMessages[]> {
  const rows = await sql<{ id: string; held_membership_id: string; due_on: string }[]>`
    SELECT b.id, b.held_membership_id, b.due_on::text AS due_on
    FROM gym_member_bills b
    WHERE b.gym_id = ${gymId} AND b.status = 'open'
      AND b.due_on < ${today}::date AND b.due_on >= ${today}::date - ${days}::int`;
  return rows.map((row) => ({ id: row.id, membershipId: row.held_membership_id, dueOn: row.due_on, open: true }));
}

/** Of these memberships, the ones a payment was ever recorded for in the app and not taken
 *  back. */
async function paidInApp(sql: SqlOrTx, gymId: string, membershipIds: readonly string[]): Promise<Set<string>> {
  if (membershipIds.length === 0) return new Set();
  const rows = await sql<{ id: string }[]>`
    SELECT DISTINCT b.held_membership_id AS id
    FROM gym_member_bills b
    JOIN gym_member_payments p ON p.gym_id = b.gym_id AND p.bill_id = b.id AND p.undone_at IS NULL
    WHERE b.gym_id = ${gymId} AND b.held_membership_id = ANY(${[...membershipIds]}::uuid[])`;
  return new Set(rows.map((row) => row.id));
}

/** For each live app member who holds a current record alone: their trial, the membership
 *  of theirs that is ending and their open bills, as the rule reads them on `today`.
 *  Somebody not in the answer has none (`NO_MEMBERSHIP_FACTS`). A past member's record is
 *  not read: its memberships are kept and not in use.
 *
 *  `billDays`: how far back a bill's due date can be for a notice to go; null where no
 *  notice can (the gym takes no payments here, or switched the notice off), and no bill is
 *  read. */
export async function membershipFactsByPerson(sql: SqlOrTx, gymId: string, today: string, billDays: number | null): Promise<Map<string, MembershipMessageFacts>> {
  const held = await inUseForList(sql, gymId, null);
  const facts = new Map<string, MembershipMessageFacts>();
  if (held.length === 0) return facts;
  const holders = await sql<{ entry_id: string; user_id: string }[]>`${soloHolders(sql, gymId)}`;
  const holderOf = new Map(holders.map((row) => [row.entry_id, row.user_id]));
  const bills = billDays === null ? [] : await openBillsDue(sql, gymId, today, billDays);
  // A membership taken from the gym's own list is billed here only once a payment for it
  // was recorded here; one staff gave by hand always is.
  const fromList = bills.length === 0 ? [] : held.filter((row) => row.held.fromList).map((row) => row.held.id);
  const paidHere = await paidInApp(sql, gymId, fromList);
  const byMembership = new Map<string, BillForMessages[]>();
  for (const bill of bills) byMembership.set(bill.membershipId, [...(byMembership.get(bill.membershipId) ?? []), bill]);

  const byPerson = new Map<string, HeldForMessages[]>();
  for (const row of held) {
    const userId = holderOf.get(row.entryId);
    if (userId === undefined) continue;
    const billedHere = !row.held.fromList || paidHere.has(row.held.id);
    byPerson.set(userId, [...(byPerson.get(userId) ?? []), { id: row.held.id, membership: row.held.membership, billedHere }]);
  }
  for (const [userId, memberships] of byPerson) {
    const theirs = memberships.flatMap((m) => byMembership.get(m.id) ?? []);
    facts.set(userId, membershipMessageFacts(memberships, theirs, today));
  }
  return facts;
}

/** What the Settings box says of a gym's use of memberships: whether a trial, and whether
 *  anything, is on its price list or still held by somebody. Archiving a type ends
 *  nobody's membership, so the people on it are still sent their messages. */
export async function priceListUse(sql: SqlOrTx, gymId: string): Promise<{ trialOnList: boolean; priceList: boolean }> {
  const rows = await sql<{ trial: boolean; any: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM gym_membership_types t WHERE t.gym_id = ${gymId} AND t.archived_at IS NULL AND t.kind = 'trial')
             OR EXISTS (SELECT 1 FROM gym_held_memberships h WHERE h.gym_id = ${gymId} AND h.status IN ('active','frozen') AND h.kind = 'trial') AS trial,
           EXISTS (SELECT 1 FROM gym_membership_types t WHERE t.gym_id = ${gymId} AND t.archived_at IS NULL)
             OR EXISTS (SELECT 1 FROM gym_held_memberships h WHERE h.gym_id = ${gymId} AND h.status IN ('active','frozen')) AS any`;
  return { trialOnList: rows[0]?.trial ?? false, priceList: rows[0]?.any ?? false };
}
