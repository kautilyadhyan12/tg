// WHO PAYS FOR WHOM ON A GYM'S LIST (spec Part 3 §14.2; ROADMAP 18i). Every statement
// names the gym, and both records of a link are the gym's own (the table's two keys).
import type { Sql, TransactionSql } from "postgres";
import type { MemberPayerPerson } from "@app/shared";

type SqlOrTx = Sql | TransactionSql;

interface PersonRow {
  entry_id: string;
  full_name: string;
  past: boolean;
}
const personOf = (row: PersonRow): MemberPayerPerson => ({ entryId: row.entry_id, name: row.full_name, past: row.past });

/** Is this record on the gym's list, current or past? */
export async function entryExists(sql: SqlOrTx, gymId: string, entryId: string): Promise<boolean> {
  const rows = await sql<{ one: number }[]>`SELECT 1 AS one FROM gym_member_list_entries WHERE gym_id = ${gymId} AND id = ${entryId}`;
  return rows.length === 1;
}

/** Who pays for this record, if anybody. */
export async function payerOf(sql: SqlOrTx, gymId: string, entryId: string): Promise<MemberPayerPerson | null> {
  const [row] = await sql<PersonRow[]>`
    SELECT e.id AS entry_id, e.full_name, (e.former_at IS NOT NULL) AS past
    FROM gym_member_payers l
    JOIN gym_member_list_entries e ON e.gym_id = l.gym_id AND e.id = l.payer_entry_id
    WHERE l.gym_id = ${gymId} AND l.entry_id = ${entryId}`;
  return row === undefined ? null : personOf(row);
}

/** Whom this record pays for, in the order the gym's list holds them. */
export async function paidForBy(sql: SqlOrTx, gymId: string, payerEntryId: string): Promise<MemberPayerPerson[]> {
  const rows = await sql<PersonRow[]>`
    SELECT e.id AS entry_id, e.full_name, (e.former_at IS NOT NULL) AS past
    FROM gym_member_payers l
    JOIN gym_member_list_entries e ON e.gym_id = l.gym_id AND e.id = l.entry_id
    WHERE l.gym_id = ${gymId} AND l.payer_entry_id = ${payerEntryId}
    ORDER BY e.listed_seq`;
  return rows.map(personOf);
}

/** Names `payerEntryId` as the one who pays for `entryId`, replacing any payer before. */
export async function setPayer(tx: TransactionSql, gymId: string, entryId: string, payerEntryId: string, by: string): Promise<void> {
  await tx`
    INSERT INTO gym_member_payers (gym_id, entry_id, payer_entry_id, set_by)
    VALUES (${gymId}, ${entryId}, ${payerEntryId}, ${by})
    ON CONFLICT (gym_id, entry_id) DO UPDATE SET payer_entry_id = EXCLUDED.payer_entry_id, set_by = EXCLUDED.set_by, created_at = now()`;
}

/** Nobody pays for `entryId` any more. False where nobody did. */
export async function removePayer(tx: TransactionSql, gymId: string, entryId: string): Promise<boolean> {
  const rows = await tx<{ entry_id: string }[]>`
    DELETE FROM gym_member_payers WHERE gym_id = ${gymId} AND entry_id = ${entryId} RETURNING entry_id`;
  return rows.length === 1;
}

/** Two records of one person joined (`mergeEntries`): what pointed at the one not kept moves
 *  onto the kept one. A link between the two goes, since nobody pays for themselves. Null
 *  where that is done; else what stops the join, before anything is written. Under the
 *  gym's lock, as every write of a link is. */
export async function movePayerLinks(
  tx: TransactionSql,
  gymId: string,
  goneId: string,
  keepId: string,
): Promise<"merge_two_payers" | "merge_payer_and_paid_for" | null> {
  await tx`
    DELETE FROM gym_member_payers
    WHERE gym_id = ${gymId}
      AND ((entry_id = ${goneId} AND payer_entry_id = ${keepId}) OR (entry_id = ${keepId} AND payer_entry_id = ${goneId}))`;
  const [state] = await tx<{ gone_payer: string | null; keep_payer: string | null; gone_pays: boolean; keep_pays: boolean }[]>`
    SELECT (SELECT payer_entry_id FROM gym_member_payers WHERE gym_id = ${gymId} AND entry_id = ${goneId}) AS gone_payer,
           (SELECT payer_entry_id FROM gym_member_payers WHERE gym_id = ${gymId} AND entry_id = ${keepId}) AS keep_payer,
           EXISTS (SELECT 1 FROM gym_member_payers WHERE gym_id = ${gymId} AND payer_entry_id = ${goneId}) AS gone_pays,
           EXISTS (SELECT 1 FROM gym_member_payers WHERE gym_id = ${gymId} AND payer_entry_id = ${keepId}) AS keep_pays`;
  if (state === undefined) throw new Error("reading a merge's payers returned no row");
  // Both paid for by the same person: one link is enough.
  if (state.gone_payer !== null && state.gone_payer === state.keep_payer) {
    await tx`DELETE FROM gym_member_payers WHERE gym_id = ${gymId} AND entry_id = ${goneId}`;
  } else if (state.gone_payer !== null && state.keep_payer !== null) return "merge_two_payers";
  if ((state.gone_payer !== null || state.keep_payer !== null) && (state.gone_pays || state.keep_pays)) return "merge_payer_and_paid_for";
  await tx`UPDATE gym_member_payers SET entry_id = ${keepId} WHERE gym_id = ${gymId} AND entry_id = ${goneId}`;
  await tx`UPDATE gym_member_payers SET payer_entry_id = ${keepId} WHERE gym_id = ${gymId} AND payer_entry_id = ${goneId}`;
  return null;
}

/** How many people this record pays for. */
export async function paysForCount(sql: SqlOrTx, gymId: string, payerEntryId: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM gym_member_payers WHERE gym_id = ${gymId} AND payer_entry_id = ${payerEntryId}`;
  return row?.n ?? 0;
}

/** Each record of the gym that somebody pays for, with the record that pays and its name. */
export async function gymPayers(sql: SqlOrTx, gymId: string): Promise<{ entryId: string; payerEntryId: string; name: string }[]> {
  const rows = await sql<{ entry_id: string; payer_entry_id: string; full_name: string }[]>`
    SELECT l.entry_id, l.payer_entry_id, e.full_name
    FROM gym_member_payers l
    JOIN gym_member_list_entries e ON e.gym_id = l.gym_id AND e.id = l.entry_id
    WHERE l.gym_id = ${gymId}`;
  return rows.map((row) => ({ entryId: row.entry_id, payerEntryId: row.payer_entry_id, name: row.full_name }));
}
