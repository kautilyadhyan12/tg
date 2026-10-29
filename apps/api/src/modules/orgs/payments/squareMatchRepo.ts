// The database half of linking a Square customer at Match (ROADMAP 18d-iii-b-ii-c-i; `squareMatchLink.ts`,
// `paymentsToMatch.ts`). Every write is asked under the gym's lock, in the step that puts the payment on its bill.
import type { MatchLinkResult } from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import type { SquareEnvironment } from "./square.js";
import { linkedRecords } from "./squareAppPaymentsRepo.js";
import { linkCustomer } from "./squareMembersRepo.js";

type SqlOrTx = Sql | TransactionSql;

export interface LinkPersonRow {
  entryId: string;
  fullName: string;
  email: string | null;
  phoneE164: string | null;
  past: boolean;
}

/** The person staff picked as who paid, as the list keeps them; null for one that is not this gym's. */
export async function readLinkPerson(sql: SqlOrTx, gymId: string, entryId: string): Promise<LinkPersonRow | null> {
  const [row] = await sql<{ id: string; full_name: string; email: string | null; phone_e164: string | null; past: boolean }[]>`
    SELECT id, full_name, email::text AS email, phone_e164, former_at IS NOT NULL AS past
    FROM gym_member_list_entries WHERE gym_id = ${gymId} AND id = ${entryId}`;
  return row === undefined ? null : { entryId: row.id, fullName: row.full_name, email: row.email, phoneE164: row.phone_e164, past: row.past };
}

/** Every gym connected to this Square account: a customer is one person's across all of them. */
async function gymsOfAccount(sql: SqlOrTx, environment: SquareEnvironment, accountId: string, gymId: string): Promise<string[]> {
  const rows = await sql<{ gym_id: string }[]>`
    SELECT gym_id FROM gym_payment_connections
    WHERE provider = 'square' AND environment = ${environment} AND account_id = ${accountId} AND state = 'connected'`;
  return [...new Set([gymId, ...rows.map((r) => r.gym_id)])];
}

/** The records that are this Square customer, in this gym and in any other gym connected to the account: the one the app
 *  made for them, a card's, a customer staff matched to them, and the old customer a merge in Square made of it. */
export async function holdersOf(
  sql: SqlOrTx,
  a: { gymId: string; environment: SquareEnvironment; accountId: string; customerId: string },
): Promise<{ gymId: string; entryId: string }[]> {
  return await linkedRecords(sql, { environment: a.environment, accountId: a.accountId, customerId: a.customerId, gymIds: await gymsOfAccount(sql, a.environment, a.accountId, a.gymId) });
}

/** The person has a customer of their own in this Square account already (made, linked, or being made). */
export async function hasOwnCustomer(sql: SqlOrTx, a: { gymId: string; entryId: string; environment: SquareEnvironment; accountId: string }): Promise<boolean> {
  const [row] = await sql<{ any: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM gym_square_customers
      WHERE gym_id = ${a.gymId} AND entry_id = ${a.entryId} AND environment = ${a.environment} AND account_id = ${a.accountId}) AS any`;
  return row?.any === true;
}

export type LinkOutcome = "linked" | "also" | "already" | "taken" | "past";

/** Square's customer is the person's, under the gym's lock: their customer in this account if they have none (a card saved
 *  later is saved on it), else a second customer of theirs (a payment under it is theirs all the same). Never a customer
 *  another record holds, here or at another gym of the account, nor one whose reference id is another record of this gym's
 *  (`referenceOf`: the app made it for them, its answer lost), nor a past member's. */
export async function linkMatched(
  tx: TransactionSql,
  a: { gymId: string; entryId: string; environment: SquareEnvironment; accountId: string; customerId: string; referenceOf: string | null; now: Date },
): Promise<LinkOutcome> {
  const person = await readLinkPerson(tx, a.gymId, a.entryId);
  if (person === null || person.past) return "past";
  const holders = await holdersOf(tx, a);
  if (holders.some((h) => h.gymId !== a.gymId || h.entryId !== a.entryId)) return "taken";
  if (holders.length > 0) return "already";
  if (a.referenceOf !== null && a.referenceOf !== a.entryId) return "taken";
  const first = await linkCustomer(tx, { gymId: a.gymId, entryId: a.entryId, environment: a.environment, accountId: a.accountId, customerId: a.customerId, joined: true, now: a.now });
  if (first === "linked") return "linked";
  if (first === "taken") return "taken";
  await tx`
    INSERT INTO gym_square_old_customers (gym_id, entry_id, environment, account_id, customer_id, matched_at)
    VALUES (${a.gymId}, ${a.entryId}, ${a.environment}, ${a.accountId}, ${a.customerId}, ${a.now})
    ON CONFLICT DO NOTHING`;
  return "also";
}

/** The customer is the person's now: the payments of it still waiting, that nobody's customer could be told for, are the
 *  person's, so they show on the person's page and hold their card. A payment that waited for want of the customer being
 *  known waits for what was sold (kept with it), else for its bill, worked out again from today's bills when it is read.
 *  Square's details of the customer, kept only to tell who it was, go. Answers the payments changed. */
export async function resolveWaiting(
  tx: TransactionSql,
  a: { gymId: string; entryId: string; environment: SquareEnvironment; accountId: string; customerId: string; now: Date },
): Promise<number> {
  const rows = await tx<{ id: string }[]>`
    UPDATE gym_square_app_payments
    SET entry_id = ${a.entryId},
        reason = CASE WHEN reason = 'not_linked' THEN COALESCE(sale_reason, 'no_bill') ELSE reason END,
        customer_name = NULL, customer_email = NULL, customer_phone = NULL, updated_at = ${a.now}
    WHERE gym_id = ${a.gymId} AND environment = ${a.environment} AND account_id = ${a.accountId} AND customer_id = ${a.customerId}
      AND state = 'waiting' AND entry_id IS NULL AND reason <> 'several_people'
    RETURNING id`;
  return rows.length;
}

/** What Match did about Square's customer, kept with the payment so the same press sent again is answered the same. */
export async function setLinkResult(tx: TransactionSql, gymId: string, id: string, result: Exclude<MatchLinkResult["result"], "none">): Promise<void> {
  await tx`UPDATE gym_square_app_payments SET link_result = ${result} WHERE gym_id = ${gymId} AND id = ${id}`;
}

/** The people whose page reads the payments waiting again: the person, and everybody they pay for (18i). */
export async function peopleHeldWith(sql: SqlOrTx, gymId: string, entryId: string): Promise<string[]> {
  const rows = await sql<{ entry_id: string }[]>`SELECT entry_id FROM gym_member_payers WHERE gym_id = ${gymId} AND payer_entry_id = ${entryId}`;
  return [entryId, ...rows.map((r) => r.entry_id)];
}
