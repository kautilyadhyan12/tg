// A member's card on file (ROADMAP 18d-ii): the card, the agreement the person ticked, their
// customer in the gym's Square account, and cards Square is still to be told to stop. Every
// statement about a record names the gym; the worker's reads across gyms name the environment
// and hand each row back with its gym.
import type { Sql, TransactionSql } from "postgres";
import type { SquareEnvironment } from "./square.js";

type SqlOrTx = Sql | TransactionSql;

export interface CardPerson {
  entryId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  /** One live app account of their own holds the record. */
  inApp: boolean;
}

/** The record on the gym's list, current or past, or null. */
export async function readPerson(sql: SqlOrTx, gymId: string, entryId: string): Promise<CardPerson | null> {
  const [row] = await sql<{ id: string; full_name: string; email: string | null; phone_e164: string | null; in_app: boolean }[]>`
    SELECT e.id, e.full_name, e.email, e.phone_e164,
           (SELECT count(*) FROM gym_members m JOIN users u ON u.id = m.user_id AND u.status = 'active'
            WHERE m.gym_id = e.gym_id AND m.entry_id = e.id AND m.removed_at IS NULL) = 1 AS in_app
    FROM gym_member_list_entries e
    WHERE e.gym_id = ${gymId} AND e.id = ${entryId}`;
  return row === undefined ? null : { entryId: row.id, fullName: row.full_name, email: row.email, phone: row.phone_e164, inApp: row.in_app };
}

export interface CardRow {
  gymId: string;
  entryId: string;
  environment: SquareEnvironment;
  accountId: string;
  customerId: string;
  cardId: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  savedFrom: "desk" | "app" | "terminal";
  savedAt: Date;
}

interface RawCard {
  gym_id: string;
  entry_id: string;
  environment: SquareEnvironment;
  account_id: string;
  customer_id: string;
  card_id: string;
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
  saved_from: "desk" | "app" | "terminal";
  saved_at: Date;
}

const toCard = (r: RawCard): CardRow => ({
  gymId: r.gym_id,
  entryId: r.entry_id,
  environment: r.environment,
  accountId: r.account_id,
  customerId: r.customer_id,
  cardId: r.card_id,
  brand: r.brand,
  last4: r.last4,
  expMonth: r.exp_month,
  expYear: r.exp_year,
  savedFrom: r.saved_from,
  savedAt: r.saved_at,
});

const CARD_COLUMNS = (sql: SqlOrTx) =>
  sql`gym_id, entry_id, environment, account_id, customer_id, card_id, brand, last4, exp_month, exp_year, saved_from, saved_at`;

/** The record's card, whichever Square account it is in. `lock`: held for the transaction. */
export async function readCard(sql: SqlOrTx, gymId: string, entryId: string, lock = false): Promise<CardRow | null> {
  const rows = lock
    ? await sql<RawCard[]>`SELECT ${CARD_COLUMNS(sql)} FROM gym_member_cards WHERE gym_id = ${gymId} AND entry_id = ${entryId} FOR UPDATE`
    : await sql<RawCard[]>`SELECT ${CARD_COLUMNS(sql)} FROM gym_member_cards WHERE gym_id = ${gymId} AND entry_id = ${entryId}`;
  const row = rows[0];
  return row === undefined ? null : toCard(row);
}

interface CustomerKey {
  gymId: string;
  entryId: string;
  environment: SquareEnvironment;
  accountId: string;
}

/** The record's customer in that Square account: Square's id once made, or the key Square is
 *  being asked to make it with. Null for neither. A row is claimed for `key` when there is
 *  none, in one statement, so saves at the same instant all read the one key. */
export async function claimCustomer(sql: SqlOrTx, c: CustomerKey, key: string): Promise<{ customerId: string } | { makingKey: string }> {
  await sql`
    INSERT INTO gym_square_customers (gym_id, entry_id, environment, account_id, making_key)
    VALUES (${c.gymId}, ${c.entryId}, ${c.environment}, ${c.accountId}, ${key})
    ON CONFLICT (gym_id, entry_id, environment, account_id) DO NOTHING`;
  const [row] = await sql<{ customer_id: string | null; making_key: string | null }[]>`
    SELECT customer_id, making_key FROM gym_square_customers
    WHERE gym_id = ${c.gymId} AND entry_id = ${c.entryId} AND environment = ${c.environment} AND account_id = ${c.accountId}`;
  if (row?.customer_id != null) return { customerId: row.customer_id };
  if (row?.making_key != null) return { makingKey: row.making_key };
  throw new Error("a Square customer row was neither made nor being made");
}

/** Square made the customer asked for with `key`. False when another save wrote it first. */
export async function finishCustomer(sql: SqlOrTx, c: CustomerKey, key: string, customerId: string): Promise<boolean> {
  const rows = await sql<{ entry_id: string }[]>`
    UPDATE gym_square_customers SET customer_id = ${customerId}, making_key = NULL
    WHERE gym_id = ${c.gymId} AND entry_id = ${c.entryId} AND environment = ${c.environment}
      AND account_id = ${c.accountId} AND making_key = ${key}
    RETURNING entry_id`;
  return rows.length === 1;
}

/** Square refused to make the customer with `key`: the next save starts again with a new one. */
export async function abandonCustomer(sql: SqlOrTx, c: CustomerKey, key: string): Promise<void> {
  await sql`
    DELETE FROM gym_square_customers
    WHERE gym_id = ${c.gymId} AND entry_id = ${c.entryId} AND environment = ${c.environment}
      AND account_id = ${c.accountId} AND making_key = ${key}`;
}

/** Square no longer has this customer (the gym deleted it there): the next save makes one. */
export async function dropCustomer(sql: SqlOrTx, gymId: string, entryId: string, environment: SquareEnvironment, accountId: string, customerId: string): Promise<void> {
  await sql`
    DELETE FROM gym_square_customers
    WHERE gym_id = ${gymId} AND entry_id = ${entryId} AND environment = ${environment}
      AND account_id = ${accountId} AND customer_id = ${customerId}`;
}

export async function insertAgreement(
  tx: TransactionSql,
  a: {
    gymId: string;
    entryId: string;
    words: string;
    screen: "desk" | "app" | "terminal";
    screenUserId: string | null;
    /** The Square Terminal the person agreed on: `terminal` only. */
    deviceId: string | null;
    brand: string;
    last4: string;
    agreedAt: Date;
  },
): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    INSERT INTO gym_card_agreements (gym_id, entry_id, words, screen, screen_user_id, device_id, brand, last4, agreed_at)
    VALUES (${a.gymId}, ${a.entryId}, ${a.words}, ${a.screen}, ${a.screenUserId}, ${a.deviceId}, ${a.brand}, ${a.last4}, ${a.agreedAt})
    RETURNING id`;
  if (row === undefined) throw new Error("card agreement not written");
  return row.id;
}

export interface NewCard {
  gymId: string;
  entryId: string;
  environment: SquareEnvironment;
  accountId: string;
  customerId: string;
  cardId: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  savedFrom: "desk" | "app" | "terminal";
  savedBy: string | null;
  agreementId: string;
  at: Date;
}

/** The record's card, in place of any before it. The caller holds the gym's lock and owes the
 *  old card's stop. */
export async function writeCard(tx: TransactionSql, c: NewCard): Promise<void> {
  await tx`
    INSERT INTO gym_member_cards (gym_id, entry_id, environment, account_id, customer_id, card_id, brand, last4,
                                  exp_month, exp_year, saved_from, saved_by, agreement_id, saved_at, updated_at)
    VALUES (${c.gymId}, ${c.entryId}, ${c.environment}, ${c.accountId}, ${c.customerId}, ${c.cardId}, ${c.brand}, ${c.last4},
            ${c.expMonth}, ${c.expYear}, ${c.savedFrom}, ${c.savedBy}, ${c.agreementId}, ${c.at}, ${c.at})
    ON CONFLICT (gym_id, entry_id) DO UPDATE SET
      environment = EXCLUDED.environment, account_id = EXCLUDED.account_id, customer_id = EXCLUDED.customer_id,
      card_id = EXCLUDED.card_id, brand = EXCLUDED.brand, last4 = EXCLUDED.last4, exp_month = EXCLUDED.exp_month,
      exp_year = EXCLUDED.exp_year, saved_from = EXCLUDED.saved_from, saved_by = EXCLUDED.saved_by,
      agreement_id = EXCLUDED.agreement_id, saved_at = EXCLUDED.saved_at, updated_at = EXCLUDED.updated_at, merged_away_at = NULL`;
}

/** The record's card goes, only if it is still this Square card. */
export async function deleteCard(tx: TransactionSql, gymId: string, entryId: string, cardId: string): Promise<boolean> {
  const rows = await tx<{ entry_id: string }[]>`
    DELETE FROM gym_member_cards WHERE gym_id = ${gymId} AND entry_id = ${entryId} AND card_id = ${cardId}
    RETURNING entry_id`;
  return rows.length === 1;
}

/** The record holding this Square card, for Square's message about it. */
export async function cardsOfSquareCard(sql: SqlOrTx, environment: SquareEnvironment, accountId: string, cardId: string): Promise<CardRow[]> {
  const rows = await sql<RawCard[]>`
    SELECT ${CARD_COLUMNS(sql)} FROM gym_member_cards
    WHERE environment = ${environment} AND account_id = ${accountId} AND card_id = ${cardId}`;
  return rows.map(toCard);
}

/** The records that are this Square customer, for Square's message that the gym deleted it: by
 *  the customer kept for them, and by a card saved on it (a join of two records moves the card
 *  and may leave the customer with the record not kept). */
export async function recordsOfSquareCustomer(sql: SqlOrTx, environment: SquareEnvironment, accountId: string, customerId: string): Promise<{ gymId: string; entryId: string }[]> {
  const rows = await sql<{ gym_id: string; entry_id: string }[]>`
    SELECT gym_id, entry_id FROM gym_square_customers
    WHERE environment = ${environment} AND account_id = ${accountId} AND customer_id = ${customerId}
    UNION
    SELECT gym_id, entry_id FROM gym_member_cards
    WHERE environment = ${environment} AND account_id = ${accountId} AND customer_id = ${customerId}`;
  return rows.map((r) => ({ gymId: r.gym_id, entryId: r.entry_id }));
}

/** The gym deleted this customer inside Square: the record lets go of it, and of a card saved on
 *  it, which Square keeps on and is owed its stop. Answers the card that went and its owed stop,
 *  if one did. The caller holds the gym's lock. */
export async function letGoOfSquareCustomer(
  tx: TransactionSql,
  c: { gymId: string; entryId: string; environment: SquareEnvironment; accountId: string; customerId: string; at: Date },
): Promise<{ brand: string; last4: string; disableId: string } | null> {
  await tx`
    DELETE FROM gym_square_customers
    WHERE gym_id = ${c.gymId} AND entry_id = ${c.entryId} AND environment = ${c.environment}
      AND account_id = ${c.accountId} AND customer_id = ${c.customerId}`;
  const [card] = await tx<{ brand: string; last4: string; card_id: string }[]>`
    DELETE FROM gym_member_cards
    WHERE gym_id = ${c.gymId} AND entry_id = ${c.entryId} AND environment = ${c.environment}
      AND account_id = ${c.accountId} AND customer_id = ${c.customerId}
    RETURNING brand, last4, card_id`;
  if (card === undefined) return null;
  const disableId = await oweDisable(tx, { gymId: c.gymId, environment: c.environment, accountId: c.accountId, cardId: card.card_id, notBefore: c.at });
  return { brand: card.brand, last4: card.last4, disableId };
}

/** What Square now says of a card the bank updated (a new expiry, a new number's last four). */
export async function updateCardDetails(
  sql: SqlOrTx,
  c: { gymId: string; entryId: string; cardId: string; brand: string; last4: string; expMonth: number; expYear: number; at: Date },
): Promise<boolean> {
  const rows = await sql<{ entry_id: string }[]>`
    UPDATE gym_member_cards
    SET brand = ${c.brand}, last4 = ${c.last4}, exp_month = ${c.expMonth}, exp_year = ${c.expYear}, updated_at = ${c.at}
    WHERE gym_id = ${c.gymId} AND entry_id = ${c.entryId} AND card_id = ${c.cardId}
      AND (brand, last4, exp_month, exp_year) IS DISTINCT FROM (${c.brand}, ${c.last4}, ${c.expMonth}::int, ${c.expYear}::int)
    RETURNING entry_id`;
  return rows.length === 1;
}

export async function oweDisable(tx: TransactionSql, d: { gymId: string; environment: SquareEnvironment; accountId: string; cardId: string; notBefore: Date }): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    INSERT INTO gym_card_disables (gym_id, environment, account_id, card_id, not_before)
    VALUES (${d.gymId}, ${d.environment}, ${d.accountId}, ${d.cardId}, ${d.notBefore})
    RETURNING id`;
  if (row === undefined) throw new Error("card disable not written");
  return row.id;
}

export interface OwedDisable {
  id: string;
  gymId: string;
  accountId: string;
  cardId: string;
  tries: number;
}

/** Take owed stops that are due (`ids`: only these, as the request that wrote them sends them
 *  at once) and hold each for `leaseMs`. */
export async function claimDueDisables(
  sql: Sql,
  environment: SquareEnvironment,
  now: Date,
  leaseMs: number,
  limit: number,
  ids: readonly string[] | null = null,
  gymIds: readonly string[] | null = null,
): Promise<OwedDisable[]> {
  const rows = await sql<{ id: string; gym_id: string; account_id: string; card_id: string; tries: number }[]>`
    WITH due AS (
      SELECT id FROM gym_card_disables
      WHERE environment = ${environment} AND not_before <= ${now}
        AND (${ids === null}::boolean OR id = ANY(${[...(ids ?? [])]}::uuid[]))
        AND (${gymIds === null}::boolean OR gym_id = ANY(${[...(gymIds ?? [])]}::uuid[]))
      ORDER BY not_before
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE gym_card_disables d SET not_before = ${new Date(now.getTime() + leaseMs)}
    FROM due WHERE d.id = due.id
    RETURNING d.id, d.gym_id, d.account_id, d.card_id, d.tries`;
  return rows.map((r) => ({ id: r.id, gymId: r.gym_id, accountId: r.account_id, cardId: r.card_id, tries: r.tries }));
}

export async function finishDisable(sql: SqlOrTx, id: string): Promise<void> {
  await sql`DELETE FROM gym_card_disables WHERE id = ${id}`;
}

export async function deferDisable(sql: SqlOrTx, id: string, notBefore: Date): Promise<void> {
  await sql`UPDATE gym_card_disables SET tries = tries + 1, not_before = ${notBefore} WHERE id = ${id}`;
}

/** A record deleted for good, or a gym's whole list (`entryId` null): its cards are owed their
 *  stop at Square, and its agreements stay as the gym's proof with the day (the purge removes
 *  them later, `deleteExpiredCardAgreements`). The cards and customers then go with the
 *  records by their keys. */
export async function letGoOfCards(tx: TransactionSql, gymId: string, entryId: string | null, at: Date): Promise<void> {
  await tx`
    INSERT INTO gym_card_disables (gym_id, environment, account_id, card_id, not_before)
    SELECT gym_id, environment, account_id, card_id, ${at} FROM gym_member_cards
    WHERE gym_id = ${gymId} AND (${entryId}::uuid IS NULL OR entry_id = ${entryId}::uuid)`;
  await tx`
    UPDATE gym_card_agreements SET entry_id = NULL, record_deleted_at = ${at}
    WHERE gym_id = ${gymId} AND entry_id IS NOT NULL
      AND (${entryId}::uuid IS NULL OR entry_id = ${entryId}::uuid)`;
}

/** Two records of one person joined (`mergeEntries`): the agreements of the one not kept move
 *  onto the kept one; of two cards the newer saved stays and the other is owed its stop; a
 *  customer moves where the kept record has none in that Square account. Under the gym's
 *  lock, as every card write is. */
export async function moveCards(tx: TransactionSql, gymId: string, goneId: string, keepId: string, at: Date): Promise<void> {
  await tx`UPDATE gym_card_agreements SET entry_id = ${keepId} WHERE gym_id = ${gymId} AND entry_id = ${goneId}`;
  await tx`
    UPDATE gym_square_customers g SET entry_id = ${keepId}
    WHERE g.gym_id = ${gymId} AND g.entry_id = ${goneId}
      AND NOT EXISTS (
        SELECT 1 FROM gym_square_customers k
        WHERE k.gym_id = g.gym_id AND k.entry_id = ${keepId} AND k.environment = g.environment AND k.account_id = g.account_id)`;
  const gone = await readCard(tx, gymId, goneId, true);
  if (gone === null) return;
  const keep = await readCard(tx, gymId, keepId, true);
  const older = keep === null ? null : keep.savedAt.getTime() >= gone.savedAt.getTime() ? gone : keep;
  if (older !== null) {
    await tx`
      INSERT INTO gym_card_disables (gym_id, environment, account_id, card_id, not_before)
      VALUES (${gymId}, ${older.environment}, ${older.accountId}, ${older.cardId}, ${at})`;
    await tx`DELETE FROM gym_member_cards WHERE gym_id = ${gymId} AND entry_id = ${older.entryId}`;
  }
  if (older?.entryId !== goneId) await tx`UPDATE gym_member_cards SET entry_id = ${keepId} WHERE gym_id = ${gymId} AND entry_id = ${goneId}`;
}
