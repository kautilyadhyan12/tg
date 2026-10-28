// The database half of copying a member's changes to Square (ROADMAP 18d-iii-b-ii-b-ii-b-i; `squareCopies.ts`). Every
// statement names the gym. What Square last agreed with is kept as hashes, never as a second copy of anybody's details:
// the record's name, email (folded) and phone, each as the md5 of its value, null for none.
import type { Sql, TransactionSql } from "postgres";
import type { SquareEnvironment } from "./square.js";
import { DIGEST } from "./squareMembersRepo.js";

type SqlOrTx = Sql | TransactionSql;

interface At {
  gymId: string;
  environment: SquareEnvironment;
  accountId: string;
}

/** The record's three parts, hashed as `copied_*` keeps them: the same expressions wherever they are compared. */
export const NAME_HASH = (sql: SqlOrTx) => sql`md5(e.full_name)`;
export const EMAIL_HASH = (sql: SqlOrTx) => sql`md5(NULLIF(lower(btrim(e.email::text)), ''))`;
export const PHONE_HASH = (sql: SqlOrTx) => sql`md5(NULLIF(e.phone_e164, ''))`;

/** Customers with no `copied_at` yet (a card made them, or they were linked before copying existed): the record's
 *  details as they are now are what Square is taken to hold. Nothing is sent. How many. */
export async function adoptUnknown(sql: SqlOrTx, a: At & { now: Date }): Promise<number> {
  const rows = await sql<{ entry_id: string }[]>`
    UPDATE gym_square_customers c
    SET copied_name = ${NAME_HASH(sql)}, copied_email = ${EMAIL_HASH(sql)}, copied_phone = ${PHONE_HASH(sql)}, copied_at = ${a.now}
    FROM gym_member_list_entries e
    WHERE c.gym_id = ${a.gymId} AND c.environment = ${a.environment} AND c.account_id = ${a.accountId}
      AND c.customer_id IS NOT NULL AND c.copied_at IS NULL
      AND e.gym_id = c.gym_id AND e.id = c.entry_id
    RETURNING c.entry_id`;
  return rows.length;
}

export interface DueCopy {
  entryId: string;
  customerId: string;
  /** A customer Square had before the app linked it, not one the app made. */
  joined: boolean;
  fullName: string;
  email: string | null;
  phone: string | null;
  nameDue: boolean;
  emailDue: boolean;
  phoneDue: boolean;
}

/** Current members in Square whose name, email or phone is not what Square last agreed with, in the list's own order of
 *  ids, a few at a time after `after`. Not those Square refused with these very details, until a day has passed. */
export async function dueCopies(sql: SqlOrTx, q: At & { refusedBefore: Date; after: string | null; limit: number }): Promise<DueCopy[]> {
  const rows = await sql<
    { entry_id: string; customer_id: string; joined: boolean; full_name: string; email: string | null; phone_e164: string | null; name_due: boolean; email_due: boolean; phone_due: boolean }[]
  >`
    SELECT * FROM (
      SELECT c.entry_id, c.customer_id, c.joined_at IS NOT NULL AS joined, e.full_name, e.email::text AS email, e.phone_e164,
             ${NAME_HASH(sql)} IS DISTINCT FROM c.copied_name AS name_due,
             ${EMAIL_HASH(sql)} IS DISTINCT FROM c.copied_email AS email_due,
             ${PHONE_HASH(sql)} IS DISTINCT FROM c.copied_phone AS phone_due,
             c.copy_refused_digest, c.copy_refused_at, ${DIGEST(sql)} AS digest
      FROM gym_square_customers c
      JOIN gym_member_list_entries e ON e.gym_id = c.gym_id AND e.id = c.entry_id
      WHERE c.gym_id = ${q.gymId} AND c.environment = ${q.environment} AND c.account_id = ${q.accountId}
        AND c.customer_id IS NOT NULL AND c.copied_at IS NOT NULL AND e.former_at IS NULL
        AND (${q.after}::uuid IS NULL OR c.entry_id > ${q.after}::uuid)) x
    WHERE (x.name_due OR x.email_due OR x.phone_due)
      AND (x.copy_refused_digest IS NULL OR x.copy_refused_digest <> x.digest OR x.copy_refused_at <= ${q.refusedBefore})
    ORDER BY x.entry_id
    LIMIT ${q.limit}`;
  return rows.map((r) => ({
    entryId: r.entry_id,
    customerId: r.customer_id,
    joined: r.joined,
    fullName: r.full_name,
    email: r.email,
    phone: r.phone_e164,
    nameDue: r.name_due,
    emailDue: r.email_due,
    phoneDue: r.phone_due,
  }));
}

/** Their customer in the Square account the gym is connected to would not take their details as they are now: the member's
 *  own page says so. */
export async function copyRefusedFor(sql: SqlOrTx, gymId: string, entryId: string): Promise<boolean> {
  const [row] = await sql<{ refused: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM gym_square_customers c
      JOIN gym_member_list_entries e ON e.gym_id = c.gym_id AND e.id = c.entry_id
      JOIN gym_payment_connections pc ON pc.gym_id = c.gym_id AND pc.provider = 'square' AND pc.environment = c.environment
                                     AND pc.account_id = c.account_id AND pc.state = 'connected'
      WHERE c.gym_id = ${gymId} AND c.entry_id = ${entryId} AND c.customer_id IS NOT NULL AND e.former_at IS NULL
        AND c.copy_refused_digest IS NOT NULL AND c.copy_refused_digest = ${DIGEST(sql)}) AS refused`;
  return row?.refused === true;
}

interface Copying extends At {
  entryId: string;
  /** Only while the record is still linked to this customer. */
  customerId: string;
}

/** Square agrees with these parts of the record, as they were when they were read: sent, or already the same. A part
 *  that changed again since stays a change. */
export async function advance(
  sql: SqlOrTx,
  c: Copying & { read: { fullName: string; email: string | null; phone: string | null }; due: { name: boolean; email: boolean; phone: boolean }; now: Date },
): Promise<void> {
  await sql`
    UPDATE gym_square_customers SET
      copied_name = CASE WHEN ${c.due.name}::boolean THEN md5(${c.read.fullName}::text) ELSE copied_name END,
      copied_email = CASE WHEN ${c.due.email}::boolean THEN md5(NULLIF(lower(btrim(${c.read.email}::text)), '')) ELSE copied_email END,
      copied_phone = CASE WHEN ${c.due.phone}::boolean THEN md5(NULLIF(${c.read.phone}::text, '')) ELSE copied_phone END,
      copied_at = ${c.now}, copy_refused_digest = NULL, copy_refused_at = NULL
    WHERE gym_id = ${c.gymId} AND entry_id = ${c.entryId} AND environment = ${c.environment} AND account_id = ${c.accountId}
      AND customer_id = ${c.customerId}`;
}

/** Square would not take the details as they were read: left until they change, or a day has passed. */
export async function markRefused(
  sql: SqlOrTx,
  c: Copying & { read: { fullName: string; email: string | null; phone: string | null }; now: Date },
): Promise<void> {
  await sql`
    UPDATE gym_square_customers SET
      copy_refused_digest = md5(${c.read.fullName}::text || chr(10) || coalesce(${c.read.email}::text, '') || chr(10) || coalesce(${c.read.phone}::text, '')),
      copy_refused_at = ${c.now}
    WHERE gym_id = ${c.gymId} AND entry_id = ${c.entryId} AND environment = ${c.environment} AND account_id = ${c.accountId}
      AND customer_id = ${c.customerId}`;
}
