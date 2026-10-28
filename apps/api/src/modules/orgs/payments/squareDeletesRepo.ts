// The database half of taking a deleted record's customer out of Square (ROADMAP 18d-iii-b-ii-b-ii-b-ii; `squareDeletes.ts`).
// Every statement names the gym. A customer is owed its deletion only when the app made it (`made_as`, never a customer Square
// already had and the app linked, never one Square merged into another), when no other record anywhere uses it, and when the gym
// is connected to the Square account it is in; the same conditions answer the Delete permanently box.
import type { Sql, TransactionSql } from "postgres";
import type { SquareEnvironment } from "./square.js";

type SqlOrTx = Sql | TransactionSql;

/** What happens to a record's customer in Square when the record is deleted for good: `deletes`; `stays` (Square had it before the
 *  app linked it, or Square merged it); `shared` (the app made it, but another record uses it); `not_reached` (the app made it, but
 *  the gym is not connected to that Square account now). */
export type Standing = "deletes" | "stays" | "shared" | "not_reached";

export interface StandingRow {
  entryId: string;
  /** Null: Square was still being asked to make the customer, and the app does not know its id. */
  customerId: string | null;
  kind: Standing;
}

/** Another record, in any gym, that uses this Square customer: its link, a card saved on it, or a check about to link it. */
const usedByAnother = (sql: SqlOrTx) => sql`
  EXISTS (SELECT 1 FROM gym_square_customers o
          WHERE o.environment = c.environment AND o.account_id = c.account_id AND o.customer_id = c.customer_id
            AND NOT (o.gym_id = c.gym_id AND o.entry_id = c.entry_id))
  OR EXISTS (SELECT 1 FROM gym_member_cards k
             WHERE k.environment = c.environment AND k.account_id = c.account_id AND k.customer_id = c.customer_id
               AND NOT (k.gym_id = c.gym_id AND k.entry_id = c.entry_id))
  OR EXISTS (SELECT 1 FROM gym_square_member_plan p
             JOIN gym_square_member_runs r ON r.gym_id = p.gym_id AND r.environment = p.environment
             WHERE p.environment = c.environment AND r.account_id = c.account_id AND p.customer_id = c.customer_id
               AND NOT (p.gym_id = c.gym_id AND p.entry_id = c.entry_id))`;

/** Each of these records' customers in Square and what deleting the record does about it. */
const kinds = (sql: SqlOrTx, gymId: string, entryIds: readonly string[]) => sql`
  SELECT c.gym_id, c.entry_id, c.environment, c.account_id, c.customer_id, c.made_as,
         CASE
           WHEN c.joined_at IS NOT NULL OR c.made_as IS NULL THEN 'stays'
           WHEN ${usedByAnother(sql)} THEN 'shared'
           WHEN NOT EXISTS (SELECT 1 FROM gym_payment_connections n
                            WHERE n.gym_id = c.gym_id AND n.provider = 'square' AND n.environment = c.environment
                              AND n.state = 'connected' AND n.account_id = c.account_id
                              AND 'SUBSCRIPTIONS_READ' = ANY(n.scopes)) THEN 'not_reached'
           ELSE 'deletes'
         END AS kind
  FROM gym_square_customers c
  WHERE c.gym_id = ${gymId} AND c.entry_id = ANY(${[...entryIds]}::uuid[])`;

export async function standingOf(sql: SqlOrTx, gymId: string, entryIds: readonly string[]): Promise<StandingRow[]> {
  if (entryIds.length === 0) return [];
  const rows = await sql<{ entry_id: string; customer_id: string | null; kind: Standing }[]>`
    SELECT k.entry_id, k.customer_id, k.kind FROM (${kinds(sql, gymId, entryIds)}) k ORDER BY k.entry_id, k.customer_id`;
  return rows.map((r) => ({ entryId: r.entry_id, customerId: r.customer_id, kind: r.kind }));
}

/** One person's standing: the customer deleted if any of theirs is, else one that cannot be reached, else one that stays, else one
 *  that is shared; null for none in Square. */
export function rollUp(rows: readonly StandingRow[]): Standing | null {
  if (rows.length === 0) return null;
  if (rows.some((r) => r.kind === "deletes")) return "deletes";
  if (rows.some((r) => r.kind === "not_reached")) return "not_reached";
  if (rows.some((r) => r.kind === "stays")) return "stays";
  return "shared";
}

/** The customers the box says are deleted, each as a line the digest holds: Square's id, or the record's own where the app does not
 *  know it yet. */
export function deletedLines(rows: readonly StandingRow[]): string[] {
  return rows
    .filter((r) => r.kind === "deletes")
    .map((r) => r.customerId ?? `making:${r.entryId}`)
    .sort();
}

/** Record these records' customers as owed their deletion, under the gym's lock and before the records are deleted (their links
 *  go with them). How many people: one with a customer in two Square accounts counts once (round one, Low 4). Written once for a
 *  customer: the same press sent again writes nothing new. */
export async function oweDeletes(tx: TransactionSql, gymId: string, entryIds: readonly string[], at: Date): Promise<number> {
  if (entryIds.length === 0) return 0;
  const rows = await tx<{ reference_id: string }[]>`
    WITH k AS (${kinds(tx, gymId, entryIds)})
    INSERT INTO gym_square_customer_deletes (gym_id, environment, account_id, customer_id, reference_id, not_before)
    SELECT k.gym_id, k.environment, k.account_id, k.customer_id, k.made_as, ${at}
    FROM k WHERE k.kind = 'deletes'
    ON CONFLICT (gym_id, environment, account_id, reference_id) DO NOTHING
    RETURNING reference_id`;
  return new Set(rows.map((r) => r.reference_id)).size;
}

export interface OwedDelete {
  id: string;
  gymId: string;
  accountId: string;
  customerId: string | null;
  referenceId: string;
  tries: number;
}

/** Take the deletions that are due and hold each for `leaseMs`, so a second run at once leaves them alone. */
export async function claimDue(sql: Sql, environment: SquareEnvironment, now: Date, leaseMs: number, limit: number, gymIds: readonly string[] | null): Promise<OwedDelete[]> {
  const rows = await sql<{ id: string; gym_id: string; account_id: string; customer_id: string | null; reference_id: string; tries: number }[]>`
    WITH due AS (
      SELECT id FROM gym_square_customer_deletes
      WHERE environment = ${environment} AND not_before <= ${now}
        AND (${gymIds === null}::boolean OR gym_id = ANY(${[...(gymIds ?? [])]}::uuid[]))
      ORDER BY not_before, id
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE gym_square_customer_deletes d SET not_before = ${new Date(now.getTime() + leaseMs)}
    FROM due WHERE d.id = due.id
    RETURNING d.id, d.gym_id, d.account_id, d.customer_id, d.reference_id, d.tries`;
  return rows.map((r) => ({ id: r.id, gymId: r.gym_id, accountId: r.account_id, customerId: r.customer_id, referenceId: r.reference_id, tries: r.tries }));
}

export async function finish(sql: SqlOrTx, id: string): Promise<void> {
  await sql`DELETE FROM gym_square_customer_deletes WHERE id = ${id}`;
}

export async function defer(sql: SqlOrTx, id: string, notBefore: Date): Promise<void> {
  await sql`UPDATE gym_square_customer_deletes SET tries = tries + 1, not_before = ${notBefore} WHERE id = ${id}`;
}

/** Any record anywhere still uses this Square customer (a deleted record's own links are gone by now). */
export async function usedNow(sql: SqlOrTx, a: { environment: SquareEnvironment; accountId: string; customerId: string }): Promise<boolean> {
  const [row] = await sql<{ used: boolean }[]>`
    SELECT (
      EXISTS (SELECT 1 FROM gym_square_customers WHERE environment = ${a.environment} AND account_id = ${a.accountId} AND customer_id = ${a.customerId})
      OR EXISTS (SELECT 1 FROM gym_member_cards WHERE environment = ${a.environment} AND account_id = ${a.accountId} AND customer_id = ${a.customerId})
      OR EXISTS (SELECT 1 FROM gym_square_member_plan p
                 JOIN gym_square_member_runs r ON r.gym_id = p.gym_id AND r.environment = p.environment
                 WHERE p.environment = ${a.environment} AND r.account_id = ${a.accountId} AND p.customer_id = ${a.customerId})
    ) AS used`;
  return row?.used === true;
}
