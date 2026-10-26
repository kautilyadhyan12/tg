// The database half of following Square's merges (ROADMAP 18d-iii-b-ii-b-ii-a; `squareMerges.ts`). The old id
// and the customer it is now are a Square account's (`gym_square_customer_merges`); everything about a gym's
// records names the gym, under its lock, the lock every card and link write takes.
import type { Sql, TransactionSql } from "postgres";
import type { SquareEnvironment } from "./square.js";

type SqlOrTx = Sql | TransactionSql;

interface At {
  environment: SquareEnvironment;
  accountId: string;
}

/** The gyms that hold this customer anywhere: a record's link or card, a check's plan or what it read. */
export async function holdersOf(sql: SqlOrTx, a: At & { customerId: string }): Promise<string[]> {
  const rows = await sql<{ gym_id: string }[]>`
    SELECT gym_id FROM gym_square_customers
    WHERE environment = ${a.environment} AND account_id = ${a.accountId} AND customer_id = ${a.customerId}
    UNION
    SELECT gym_id FROM gym_member_cards
    WHERE environment = ${a.environment} AND account_id = ${a.accountId} AND customer_id = ${a.customerId}
    UNION
    SELECT p.gym_id FROM gym_square_member_plan p
    JOIN gym_square_member_runs r ON r.gym_id = p.gym_id AND r.environment = p.environment
    WHERE p.environment = ${a.environment} AND r.account_id = ${a.accountId} AND p.customer_id = ${a.customerId}
    UNION
    SELECT c.gym_id FROM gym_square_member_candidates c
    JOIN gym_square_member_runs r ON r.gym_id = c.gym_id AND r.environment = c.environment AND r.run_id = c.run_id
    WHERE c.environment = ${a.environment} AND r.account_id = ${a.accountId} AND c.customer_id = ${a.customerId}
    ORDER BY gym_id`;
  return rows.map((r) => r.gym_id);
}

/** The old id is now `toId`; an older id that was `fromId` is now `toId` too, so one step reaches the newest. */
export async function rememberMerge(sql: SqlOrTx, m: At & { fromId: string; toId: string; at: Date }): Promise<void> {
  await sql`
    INSERT INTO gym_square_customer_merges (environment, account_id, from_customer_id, to_customer_id, merged_at)
    VALUES (${m.environment}, ${m.accountId}, ${m.fromId}, ${m.toId}, ${m.at})
    ON CONFLICT (environment, account_id, from_customer_id) DO UPDATE SET to_customer_id = EXCLUDED.to_customer_id, merged_at = EXCLUDED.merged_at`;
  await sql`
    UPDATE gym_square_customer_merges SET to_customer_id = ${m.toId}
    WHERE environment = ${m.environment} AND account_id = ${m.accountId} AND to_customer_id = ${m.fromId} AND from_customer_id <> ${m.toId}`;
}

/** The records of this gym the old customer was (its link, or a card saved on it that says whose it is), kept
 *  with them before anything moves: a payment under the old id is theirs, whoever keeps the merged customer
 *  (round one, Critical 1). The first record kept stays. */
export async function rememberOldCustomer(tx: TransactionSql, m: At & { gymId: string; fromId: string; at: Date }): Promise<void> {
  await tx`
    INSERT INTO gym_square_old_customers (gym_id, entry_id, environment, account_id, customer_id, merged_at)
    SELECT gym_id, entry_id, ${m.environment}, ${m.accountId}, ${m.fromId}, ${m.at} FROM (
      SELECT gym_id, entry_id FROM gym_square_customers
      WHERE gym_id = ${m.gymId} AND environment = ${m.environment} AND account_id = ${m.accountId} AND customer_id = ${m.fromId}
      UNION
      SELECT gym_id, entry_id FROM gym_member_cards
      WHERE gym_id = ${m.gymId} AND environment = ${m.environment} AND account_id = ${m.accountId} AND customer_id = ${m.fromId}
        AND merged_away_at IS NULL
      ORDER BY entry_id
      LIMIT 1) held
    ON CONFLICT DO NOTHING`;
}

/** Square keeps a card on the customer it was merged into: the gym's cards saved on the old customer are
 *  charged as the new one's. How many moved. */
export async function moveCards(tx: TransactionSql, m: At & { gymId: string; fromId: string; toId: string }): Promise<number> {
  const rows = await tx<{ entry_id: string }[]>`
    UPDATE gym_member_cards SET customer_id = ${m.toId}
    WHERE gym_id = ${m.gymId} AND environment = ${m.environment} AND account_id = ${m.accountId} AND customer_id = ${m.fromId}
    RETURNING entry_id`;
  return rows.length;
}

export interface LinkedRecord {
  entryId: string;
  fullName: string;
  current: boolean;
}

/** The gym's records any of these customers is, current or past: the customer the app keeps for them, or the
 *  one their card on file is saved on, where that card still says whose it is. */
export async function linkedTo(tx: TransactionSql, m: At & { gymId: string; customerIds: readonly string[] }): Promise<LinkedRecord[]> {
  const rows = await tx<{ id: string; full_name: string; current: boolean }[]>`
    SELECT e.id, e.full_name, e.former_at IS NULL AS current
    FROM gym_member_list_entries e
    WHERE e.gym_id = ${m.gymId}
      AND e.id IN (
        SELECT entry_id FROM gym_square_customers
        WHERE gym_id = ${m.gymId} AND environment = ${m.environment} AND account_id = ${m.accountId} AND customer_id = ANY(${[...m.customerIds]}::text[])
        UNION
        SELECT entry_id FROM gym_member_cards
        WHERE gym_id = ${m.gymId} AND environment = ${m.environment} AND account_id = ${m.accountId} AND customer_id = ANY(${[...m.customerIds]}::text[])
          AND merged_away_at IS NULL)
    ORDER BY e.id`;
  return rows.map((r) => ({ entryId: r.id, fullName: r.full_name, current: r.current }));
}

/** The record keeps the merged customer: Square made it, not the app, so it counts as one Square had
 *  (`joined_at`), never one the app made and may take out of Square. */
export async function keepMerged(tx: TransactionSql, m: At & { gymId: string; entryId: string; fromId: string; toId: string; now: Date }): Promise<void> {
  await tx`
    UPDATE gym_square_customers SET customer_id = ${m.toId}, joined_at = coalesce(joined_at, ${m.now})
    WHERE gym_id = ${m.gymId} AND entry_id = ${m.entryId} AND environment = ${m.environment} AND account_id = ${m.accountId}
      AND customer_id IN (${m.fromId}, ${m.toId})`;
}

/** These records are linked to neither customer any more; a card of theirs saved on one of them stays there, to
 *  be charged, but no longer says the customer is theirs (`merged_away_at`). */
export async function unlink(tx: TransactionSql, m: At & { gymId: string; entryIds: readonly string[]; customerIds: readonly string[]; now: Date }): Promise<void> {
  if (m.entryIds.length === 0) return;
  await tx`
    DELETE FROM gym_square_customers
    WHERE gym_id = ${m.gymId} AND environment = ${m.environment} AND account_id = ${m.accountId}
      AND entry_id = ANY(${[...m.entryIds]}::uuid[]) AND customer_id = ANY(${[...m.customerIds]}::text[])`;
  await tx`
    UPDATE gym_member_cards SET merged_away_at = ${m.now}
    WHERE gym_id = ${m.gymId} AND environment = ${m.environment} AND account_id = ${m.accountId}
      AND entry_id = ANY(${[...m.entryIds]}::uuid[]) AND customer_id = ANY(${[...m.customerIds]}::text[]) AND merged_away_at IS NULL`;
}
