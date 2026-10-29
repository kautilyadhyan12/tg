// The database half of Members in Square (ROADMAP 18d-iii-b-ii-b-i; `squareMembers.ts`). Every statement
// about a gym's records names the gym; the worker's read across gyms names the environment and hands each
// row back with its gym. A run's own writes name its `run_id`, so a check started again meanwhile is never
// written over by the one it replaced.
import type { Sql, TransactionSql } from "postgres";
import type { SquareMembersGroup, SquareMembersNamed } from "@app/shared";
import { NO_NAME } from "../register/repo.js";
import type { MemberPlan } from "./squareMembersPlan.js";
import type { SquareEnvironment } from "./square.js";

type SqlOrTx = Sql | TransactionSql;

export type RunState = "checking" | "checked" | "adding" | "added" | "failed";
export type RunFailure = "square_refused" | "square_unauthorized";

export interface RunRow {
  gymId: string;
  environment: SquareEnvironment;
  accountId: string;
  runId: string;
  state: RunState;
  automatic: boolean;
  startedAt: Date;
  /** The list's last record when the check began (`listed_seq`): the check decides for those. */
  listedUpto: number | null;
  cursor: string | null;
  looked: number;
  listedAt: Date | null;
  checkedAt: Date | null;
  addedAt: Date | null;
  failure: RunFailure | null;
  unansweredAt: Date | null;
  listVersion: number | null;
  lookDueAt: Date | null;
}

interface RawRun {
  gym_id: string;
  environment: SquareEnvironment;
  account_id: string;
  run_id: string;
  state: RunState;
  automatic: boolean;
  started_at: Date;
  listed_upto: string | number | null;
  cursor: string | null;
  looked: number;
  listed_at: Date | null;
  checked_at: Date | null;
  added_at: Date | null;
  failure: RunFailure | null;
  unanswered_at: Date | null;
  list_version: string | number | null;
  look_due_at: Date | null;
}

const toRun = (r: RawRun): RunRow => ({
  gymId: r.gym_id,
  environment: r.environment,
  accountId: r.account_id,
  runId: r.run_id,
  state: r.state,
  automatic: r.automatic,
  startedAt: r.started_at,
  listedUpto: r.listed_upto === null ? null : Number(r.listed_upto),
  cursor: r.cursor,
  looked: r.looked,
  listedAt: r.listed_at,
  checkedAt: r.checked_at,
  addedAt: r.added_at,
  failure: r.failure,
  unansweredAt: r.unanswered_at,
  listVersion: r.list_version === null ? null : Number(r.list_version),
  lookDueAt: r.look_due_at,
});

const RUN_COLUMNS = (sql: SqlOrTx) =>
  sql`gym_id, environment, account_id, run_id, state, automatic, started_at, listed_upto, cursor, looked, listed_at, checked_at, added_at, failure, unanswered_at, list_version, look_due_at`;

/** A record's name, email and phone as one value: a check read them so, and adding asks again. */
export const DIGEST = (sql: SqlOrTx) => sql`md5(e.full_name || chr(10) || coalesce(e.email::text, '') || chr(10) || coalesce(e.phone_e164, ''))`;

/** Linked in this account: Square's customer made or chosen, or being made now (a card being saved). */
const LINKED = (sql: SqlOrTx, environment: SquareEnvironment, accountId: string) => sql`
  EXISTS (SELECT 1 FROM gym_square_customers c
          WHERE c.gym_id = e.gym_id AND c.entry_id = e.id AND c.environment = ${environment} AND c.account_id = ${accountId})`;

/** In Square in this account: the customer's id is known. */
const MADE = (sql: SqlOrTx, environment: SquareEnvironment, accountId: string) => sql`
  EXISTS (SELECT 1 FROM gym_square_customers c
          WHERE c.gym_id = e.gym_id AND c.entry_id = e.id AND c.environment = ${environment} AND c.account_id = ${accountId}
            AND c.customer_id IS NOT NULL)`;

export async function readRun(sql: SqlOrTx, gymId: string, environment: SquareEnvironment): Promise<RunRow | null> {
  const [row] = await sql<RawRun[]>`SELECT ${RUN_COLUMNS(sql)} FROM gym_square_member_runs WHERE gym_id = ${gymId} AND environment = ${environment}`;
  return row === undefined ? null : toRun(row);
}

/** A new check, leased to the press that started it. Refused (null) while members are being added. A check
 *  of another Square account than the last starts as if none were ever made. */
export async function startRun(
  tx: TransactionSql,
  r: { gymId: string; environment: SquareEnvironment; accountId: string; runId: string; userId: string; now: Date; leaseUntil: Date },
): Promise<RunRow | null> {
  const [row] = await tx<RawRun[]>`
    INSERT INTO gym_square_member_runs (gym_id, environment, account_id, run_id, state, started_by, started_at, listed_upto, lease_until)
    VALUES (${r.gymId}, ${r.environment}, ${r.accountId}, ${r.runId}, 'checking', ${r.userId}, ${r.now},
            (SELECT max(listed_seq) FROM gym_member_list_entries WHERE gym_id = ${r.gymId}), ${r.leaseUntil})
    ON CONFLICT (gym_id, environment) DO UPDATE SET
      account_id = EXCLUDED.account_id, run_id = EXCLUDED.run_id, state = 'checking', started_by = EXCLUDED.started_by,
      started_at = EXCLUDED.started_at, listed_upto = EXCLUDED.listed_upto, cursor = NULL, looked = 0, listed_at = NULL, checked_at = NULL, failure = NULL,
      unanswered_at = NULL, lease_until = EXCLUDED.lease_until,
      automatic = gym_square_member_runs.automatic AND gym_square_member_runs.account_id = EXCLUDED.account_id,
      added_at = CASE WHEN gym_square_member_runs.account_id = EXCLUDED.account_id THEN gym_square_member_runs.added_at END,
      list_version = CASE WHEN gym_square_member_runs.account_id = EXCLUDED.account_id THEN gym_square_member_runs.list_version END,
      look_due_at = CASE WHEN gym_square_member_runs.account_id = EXCLUDED.account_id THEN gym_square_member_runs.look_due_at END
    WHERE gym_square_member_runs.state <> 'adding' OR gym_square_member_runs.account_id <> EXCLUDED.account_id
    RETURNING ${RUN_COLUMNS(tx)}`;
  if (row === undefined) return null;
  await tx`DELETE FROM gym_square_member_candidates WHERE gym_id = ${r.gymId} AND environment = ${r.environment}`;
  return toRun(row);
}

/** The press of Add, on the check it was shown: once, while that check is the gym's and not past its time. */
export async function startAdding(
  sql: SqlOrTx,
  r: { gymId: string; environment: SquareEnvironment; runId: string; checkedSince: Date; leaseUntil: Date },
): Promise<RunRow | null> {
  const [row] = await sql<RawRun[]>`
    UPDATE gym_square_member_runs SET state = 'adding', lease_until = ${r.leaseUntil}
    WHERE gym_id = ${r.gymId} AND environment = ${r.environment} AND run_id = ${r.runId} AND state = 'checked' AND checked_at >= ${r.checkedSince}
    RETURNING ${RUN_COLUMNS(sql)}`;
  return row === undefined ? null : toRun(row);
}

/** Taken for this run, by whoever works on it now, while nobody else holds it. */
export async function claimRun(sql: SqlOrTx, r: { gymId: string; environment: SquareEnvironment; runId: string; now: Date; leaseUntil: Date }): Promise<boolean> {
  const rows = await sql<{ gym_id: string }[]>`
    UPDATE gym_square_member_runs SET lease_until = ${r.leaseUntil}
    WHERE gym_id = ${r.gymId} AND environment = ${r.environment} AND run_id = ${r.runId} AND (lease_until IS NULL OR lease_until <= ${r.now})
    RETURNING gym_id`;
  return rows.length === 1;
}

export async function releaseRun(sql: SqlOrTx, r: { gymId: string; environment: SquareEnvironment; runId: string }): Promise<void> {
  await sql`UPDATE gym_square_member_runs SET lease_until = NULL WHERE gym_id = ${r.gymId} AND environment = ${r.environment} AND run_id = ${r.runId}`;
}

/** The runs the worker has work on: a check or an adding nobody holds, or, once members were added, a list
 *  that moved on or a look that is due; each leased, at a gym connected to that same Square account.
 *  `gymIds`: only these gyms, for a test sharing its database; production passes null. */
export async function claimDueRuns(
  sql: Sql,
  q: { environment: SquareEnvironment; now: Date; leaseUntil: Date; gymIds: readonly string[] | null; limit: number },
): Promise<RunRow[]> {
  const rows = await sql<RawRun[]>`
    UPDATE gym_square_member_runs r SET lease_until = ${q.leaseUntil}
    WHERE (r.gym_id, r.environment) IN (
      SELECT x.gym_id, x.environment FROM gym_square_member_runs x
      JOIN gym_payment_connections c ON c.gym_id = x.gym_id AND c.provider = 'square' AND c.environment = x.environment
        AND c.state = 'connected' AND c.account_id = x.account_id
      LEFT JOIN gym_member_lists l ON l.gym_id = x.gym_id
      WHERE x.environment = ${q.environment} AND (x.state IN ('checking','adding') OR x.automatic)
        AND (x.lease_until IS NULL OR x.lease_until <= ${q.now})
        AND (${q.gymIds === null}::boolean OR x.gym_id = ANY(${[...(q.gymIds ?? [])]}::uuid[]))
        AND (x.state IN ('checking','adding')
             OR x.list_version IS DISTINCT FROM l.version
             OR x.look_due_at IS NULL OR x.look_due_at <= ${q.now})
      ORDER BY x.state IN ('checking','adding') DESC, x.started_at
      LIMIT ${q.limit}
      FOR UPDATE OF x SKIP LOCKED)
    RETURNING ${RUN_COLUMNS(sql)}`;
  return rows.map(toRun);
}

/** A page of Square's customers read: where the next starts (null at the end), and how many were looked at. */
export async function saveListing(
  sql: SqlOrTx,
  r: { gymId: string; environment: SquareEnvironment; runId: string; cursor: string | null; looked: number; listed: Date | null },
): Promise<boolean> {
  const rows = await sql<{ gym_id: string }[]>`
    UPDATE gym_square_member_runs SET cursor = ${r.cursor}, looked = looked + ${r.looked}, listed_at = ${r.listed}, unanswered_at = NULL
    WHERE gym_id = ${r.gymId} AND environment = ${r.environment} AND run_id = ${r.runId} AND state = 'checking'
    RETURNING gym_id`;
  return rows.length === 1;
}

/** The listing starts again from the first page (Square refused where it had stopped). */
export async function restartListing(sql: SqlOrTx, r: { gymId: string; environment: SquareEnvironment; runId: string }): Promise<void> {
  await sql`
    UPDATE gym_square_member_runs SET cursor = NULL, looked = 0, listed_at = NULL
    WHERE gym_id = ${r.gymId} AND environment = ${r.environment} AND run_id = ${r.runId} AND state = 'checking'`;
  await sql`DELETE FROM gym_square_member_candidates WHERE gym_id = ${r.gymId} AND environment = ${r.environment} AND run_id = ${r.runId}`;
}

export async function setUnanswered(sql: SqlOrTx, r: { gymId: string; environment: SquareEnvironment; runId: string; now: Date }): Promise<void> {
  await sql`
    UPDATE gym_square_member_runs SET unanswered_at = coalesce(unanswered_at, ${r.now})
    WHERE gym_id = ${r.gymId} AND environment = ${r.environment} AND run_id = ${r.runId}`;
}

/** The check or adding stopped for good: the owner presses Try again. Members added stay added. */
export async function failRun(sql: SqlOrTx, r: { gymId: string; environment: SquareEnvironment; runId: string; failure: RunFailure }): Promise<void> {
  await sql`
    UPDATE gym_square_member_runs SET state = 'failed', failure = ${r.failure}, lease_until = NULL, cursor = NULL
    WHERE gym_id = ${r.gymId} AND environment = ${r.environment} AND run_id = ${r.runId} AND state IN ('checking','adding')`;
  await sql`DELETE FROM gym_square_member_candidates WHERE gym_id = ${r.gymId} AND environment = ${r.environment}`;
}

/** The gym no longer connected (Disconnect, or the app taken off its account in Square): the customers a
 *  check was holding are let go, and a check that was reading Square starts from the first page when it is
 *  connected again. What was decided and what was added stay. */
export async function forgetListing(tx: TransactionSql, gymId: string, environment: SquareEnvironment): Promise<void> {
  await tx`DELETE FROM gym_square_member_candidates WHERE gym_id = ${gymId} AND environment = ${environment}`;
  await tx`
    UPDATE gym_square_member_runs SET cursor = NULL, looked = 0, listed_at = NULL, lease_until = NULL
    WHERE gym_id = ${gymId} AND environment = ${environment} AND state = 'checking'`;
}

/** Of these Square customers, those already a record's of this gym in this account. */
export async function takenAmong(sql: SqlOrTx, gymId: string, environment: SquareEnvironment, accountId: string, customerIds: readonly string[]): Promise<Set<string>> {
  if (customerIds.length === 0) return new Set();
  const rows = await sql<{ customer_id: string }[]>`
    SELECT customer_id FROM gym_square_customers
    WHERE gym_id = ${gymId} AND environment = ${environment} AND account_id = ${accountId} AND customer_id = ANY(${[...customerIds]}::text[])
    UNION
    SELECT customer_id FROM gym_member_cards
    WHERE gym_id = ${gymId} AND environment = ${environment} AND account_id = ${accountId} AND customer_id = ANY(${[...customerIds]}::text[])
      AND merged_away_at IS NULL
    UNION
    SELECT customer_id FROM gym_square_old_customers
    WHERE gym_id = ${gymId} AND environment = ${environment} AND account_id = ${accountId} AND customer_id = ANY(${[...customerIds]}::text[])
      AND matched_at IS NOT NULL`;
  return new Set(rows.map((x) => x.customer_id));
}

/** Of these reference ids, those that are a record of this gym, current or past. */
export async function recordIdsAmong(sql: SqlOrTx, gymId: string, ids: readonly string[]): Promise<Set<string>> {
  const uuids = ids.filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
  if (uuids.length === 0) return new Set();
  const rows = await sql<{ id: string }[]>`SELECT id FROM gym_member_list_entries WHERE gym_id = ${gymId} AND id = ANY(${uuids}::uuid[])`;
  return new Set(rows.map((x) => x.id));
}

/** What tells the gym's records apart: their emails (folded), phones and every record id, current or past. */
export async function contactsOf(sql: SqlOrTx, gymId: string): Promise<{ emails: Set<string>; phones: Set<string>; recordIds: Set<string> }> {
  const rows = await sql<{ id: string; email: string | null; phone: string | null; current: boolean }[]>`
    SELECT id, lower(email::text) AS email, phone_e164 AS phone, former_at IS NULL AS current FROM gym_member_list_entries WHERE gym_id = ${gymId}`;
  const emails = new Set<string>();
  const phones = new Set<string>();
  for (const r of rows) {
    if (!r.current) continue;
    if (r.email !== null) emails.add(r.email.trim());
    if (r.phone !== null) phones.add(r.phone);
  }
  return { emails, phones, recordIds: new Set(rows.map((r) => r.id)) };
}

export interface CandidateRow {
  customerId: string;
  givenName: string | null;
  familyName: string | null;
  email: string | null;
  phone: string | null;
  referenceId: string | null;
}

/** The customers of a page that could be somebody here; one written twice is kept once. */
export async function insertCandidates(sql: SqlOrTx, r: { gymId: string; environment: SquareEnvironment; runId: string }, rows: readonly CandidateRow[]): Promise<void> {
  if (rows.length === 0) return;
  await sql`
    INSERT INTO gym_square_member_candidates (gym_id, environment, run_id, customer_id, given_name, family_name, email, phone_e164, reference_id)
    SELECT ${r.gymId}, ${r.environment}, ${r.runId}, x.customer_id, x.given_name, x.family_name, x.email, x.phone, x.reference_id
    FROM unnest(${rows.map((c) => c.customerId)}::text[], ${rows.map((c) => c.givenName)}::text[], ${rows.map((c) => c.familyName)}::text[],
                ${rows.map((c) => c.email)}::text[], ${rows.map((c) => c.phone)}::text[], ${rows.map((c) => c.referenceId)}::text[])
         AS x(customer_id, given_name, family_name, email, phone, reference_id)
    ON CONFLICT DO NOTHING`;
}

export async function readCandidates(sql: SqlOrTx, r: { gymId: string; environment: SquareEnvironment; runId: string }): Promise<CandidateRow[]> {
  const rows = await sql<{ customer_id: string; given_name: string | null; family_name: string | null; email: string | null; phone_e164: string | null; reference_id: string | null }[]>`
    SELECT customer_id, given_name, family_name, email, phone_e164, reference_id FROM gym_square_member_candidates
    WHERE gym_id = ${r.gymId} AND environment = ${r.environment} AND run_id = ${r.runId}`;
  return rows.map((c) => ({ customerId: c.customer_id, givenName: c.given_name, familyName: c.family_name, email: c.email, phone: c.phone_e164, referenceId: c.reference_id }));
}

export interface PlaceRow {
  entryId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  digest: string;
}

/** The gym's current records not yet in this Square account. `upTo`: only those on the list when the check
 *  began (its `listed_seq`), as Square's pages it read were kept by the contacts the list had then (round one,
 *  Low 4); anybody added since is looked up by themselves once members are added. */
export async function recordsToPlace(sql: SqlOrTx, gymId: string, environment: SquareEnvironment, accountId: string, upTo: number | null = null): Promise<PlaceRow[]> {
  const rows = await sql<{ id: string; full_name: string; email: string | null; phone_e164: string | null; digest: string }[]>`
    SELECT e.id, e.full_name, e.email::text AS email, e.phone_e164, ${DIGEST(sql)} AS digest
    FROM gym_member_list_entries e
    WHERE e.gym_id = ${gymId} AND e.former_at IS NULL AND NOT ${LINKED(sql, environment, accountId)}
      AND (${upTo}::bigint IS NULL OR e.listed_seq <= ${upTo}::bigint)
    ORDER BY e.listed_seq`;
  return rows.map((r) => ({ entryId: r.id, fullName: r.full_name, email: r.email, phone: r.phone_e164, digest: r.digest }));
}

/** Square customers already a record's of this gym, in this account: made or chosen, or a card's, or one staff matched to a
 *  record from a payment (18d-iii-b-ii-c). */
export async function takenCustomers(sql: SqlOrTx, gymId: string, environment: SquareEnvironment, accountId: string): Promise<Set<string>> {
  const rows = await sql<{ customer_id: string }[]>`
    SELECT customer_id FROM gym_square_customers
    WHERE gym_id = ${gymId} AND environment = ${environment} AND account_id = ${accountId} AND customer_id IS NOT NULL
    UNION
    SELECT customer_id FROM gym_member_cards
    WHERE gym_id = ${gymId} AND environment = ${environment} AND account_id = ${accountId} AND merged_away_at IS NULL
    UNION
    SELECT customer_id FROM gym_square_old_customers
    WHERE gym_id = ${gymId} AND environment = ${environment} AND account_id = ${accountId} AND matched_at IS NOT NULL`;
  return new Set(rows.map((r) => r.customer_id));
}

export interface PlanRowIn {
  entryId: string;
  plan: MemberPlan;
  digest: string;
  billed: boolean;
}

const decisionOf = (plan: MemberPlan): string => plan.kind;
const customerOf = (plan: MemberPlan): string | null => (plan.kind === "ours" || plan.kind === "link" ? plan.customerId : null);

/** The check decided: its plan replaces any before it, the customers it read are let go, and it waits for
 *  the owner's press. False where this check is no longer the gym's. */
export async function finishCheck(tx: TransactionSql, r: { gymId: string; environment: SquareEnvironment; runId: string; now: Date }, rows: readonly PlanRowIn[]): Promise<boolean> {
  const done = await tx<{ gym_id: string }[]>`
    UPDATE gym_square_member_runs SET state = 'checked', checked_at = ${r.now}, cursor = NULL, lease_until = NULL, unanswered_at = NULL
    WHERE gym_id = ${r.gymId} AND environment = ${r.environment} AND run_id = ${r.runId} AND state = 'checking'
    RETURNING gym_id`;
  if (done.length === 0) return false;
  await tx`DELETE FROM gym_square_member_plan WHERE gym_id = ${r.gymId} AND environment = ${r.environment}`;
  if (rows.length > 0) {
    await tx`
      INSERT INTO gym_square_member_plan (gym_id, environment, entry_id, run_id, decision, customer_id, digest, billed, looked_at)
      SELECT ${r.gymId}, ${r.environment}, x.entry_id, ${r.runId}, x.decision, x.customer_id, x.digest, x.billed = 't', ${r.now}
      FROM unnest(${rows.map((p) => p.entryId)}::uuid[], ${rows.map((p) => decisionOf(p.plan))}::text[], ${rows.map((p) => customerOf(p.plan))}::text[],
                  ${rows.map((p) => p.digest)}::text[], ${rows.map((p) => (p.billed ? "t" : "f"))}::text[])
           AS x(entry_id, decision, customer_id, digest, billed)
      JOIN gym_member_list_entries e ON e.gym_id = ${r.gymId} AND e.id = x.entry_id`;
  }
  await tx`DELETE FROM gym_square_member_candidates WHERE gym_id = ${r.gymId} AND environment = ${r.environment}`;
  return true;
}

export interface ApplyRow {
  entryId: string;
  decision: "ours" | "link" | "add";
  customerId: string | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  /** The record is still current, with the name, email and phone the check read. */
  unchanged: boolean;
}

/** The press's people still to do, a few at a time, in the list's own order. */
export async function toApply(sql: SqlOrTx, r: { gymId: string; environment: SquareEnvironment; runId: string; limit: number; after: string | null }): Promise<ApplyRow[]> {
  const rows = await sql<{ entry_id: string; decision: ApplyRow["decision"]; customer_id: string | null; full_name: string; email: string | null; phone_e164: string | null; unchanged: boolean }[]>`
    SELECT p.entry_id, p.decision, p.customer_id, e.full_name, e.email::text AS email, e.phone_e164,
           (e.former_at IS NULL AND ${DIGEST(sql)} = p.digest) AS unchanged
    FROM gym_square_member_plan p
    JOIN gym_member_list_entries e ON e.gym_id = p.gym_id AND e.id = p.entry_id
    WHERE p.gym_id = ${r.gymId} AND p.environment = ${r.environment} AND p.run_id = ${r.runId}
      AND p.outcome IS NULL AND p.decision IN ('ours','link','add')
      AND (${r.after}::uuid IS NULL OR p.entry_id > ${r.after}::uuid)
    ORDER BY p.entry_id
    LIMIT ${r.limit}`;
  return rows.map((x) => ({ entryId: x.entry_id, decision: x.decision, customerId: x.customer_id, fullName: x.full_name, email: x.email, phone: x.phone_e164, unchanged: x.unchanged }));
}

export type Outcome = "done" | "changed" | "refused";

/** What adding did for one person of this run's plan. */
export async function setOutcome(sql: SqlOrTx, r: { gymId: string; environment: SquareEnvironment; entryId: string; runId: string; outcome: Outcome; now: Date }): Promise<void> {
  await sql`
    UPDATE gym_square_member_plan SET outcome = ${r.outcome}, done_at = ${r.now}
    WHERE gym_id = ${r.gymId} AND environment = ${r.environment} AND entry_id = ${r.entryId} AND run_id = ${r.runId} AND outcome IS NULL`;
}

/** The record linked to a customer Square already has, under the gym's lock: only while the record is
 *  current, not linked in this account already, and the customer is no other record's here. `joined`: a
 *  customer Square had, rather than one the app made. "taken": somebody else's now. */
export async function linkCustomer(
  tx: TransactionSql,
  r: { gymId: string; entryId: string; environment: SquareEnvironment; accountId: string; customerId: string; joined: boolean; now: Date },
): Promise<"linked" | "already" | "taken"> {
  const [linked] = await tx<{ customer_id: string | null }[]>`
    SELECT customer_id FROM gym_square_customers
    WHERE gym_id = ${r.gymId} AND entry_id = ${r.entryId} AND environment = ${r.environment} AND account_id = ${r.accountId}`;
  if (linked !== undefined) return "already";
  const [other] = await tx<{ entry_id: string }[]>`
    SELECT entry_id FROM gym_square_customers
    WHERE gym_id = ${r.gymId} AND environment = ${r.environment} AND account_id = ${r.accountId} AND customer_id = ${r.customerId} AND entry_id <> ${r.entryId}
    UNION ALL
    SELECT entry_id FROM gym_member_cards
    WHERE gym_id = ${r.gymId} AND environment = ${r.environment} AND account_id = ${r.accountId} AND customer_id = ${r.customerId} AND entry_id <> ${r.entryId}
      AND merged_away_at IS NULL
    UNION ALL
    SELECT entry_id FROM gym_square_old_customers
    WHERE gym_id = ${r.gymId} AND environment = ${r.environment} AND account_id = ${r.accountId} AND customer_id = ${r.customerId} AND entry_id <> ${r.entryId}
      AND matched_at IS NOT NULL
    LIMIT 1`;
  if (other !== undefined) return "taken";
  const rows = await tx<{ entry_id: string }[]>`
    INSERT INTO gym_square_customers (gym_id, entry_id, environment, account_id, customer_id, joined_at, made_as, copied_name, copied_email, copied_phone, copied_at)
    SELECT ${r.gymId}, e.id, ${r.environment}, ${r.accountId}, ${r.customerId}, ${r.joined ? r.now : null},
           -- A customer the app made (its answer lost) carries this record's id as its reference: what Delete permanently looks for.
           ${r.joined ? tx`NULL::uuid` : tx`e.id`},
           md5(e.full_name), md5(NULLIF(lower(btrim(e.email::text)), '')), md5(NULLIF(e.phone_e164, '')), ${r.now}
    FROM gym_member_list_entries e WHERE e.gym_id = ${r.gymId} AND e.id = ${r.entryId} AND e.former_at IS NULL
    ON CONFLICT DO NOTHING
    RETURNING entry_id`;
  // Separated from this customer by a merge and linked to it again (two records of one person): its card on it says
  // whose it is again (round one, Low 5).
  if (rows.length === 1) {
    await tx`
      UPDATE gym_member_cards SET merged_away_at = NULL
      WHERE gym_id = ${r.gymId} AND entry_id = ${r.entryId} AND environment = ${r.environment} AND account_id = ${r.accountId}
        AND customer_id = ${r.customerId} AND merged_away_at IS NOT NULL`;
  }
  return rows.length === 1 ? "linked" : "already";
}

/** Adding is done: new members are added by themselves from now on, the list looked at again at once. */
export async function finishAdding(sql: SqlOrTx, r: { gymId: string; environment: SquareEnvironment; runId: string; now: Date }): Promise<boolean> {
  const rows = await sql<{ gym_id: string }[]>`
    UPDATE gym_square_member_runs SET state = 'added', automatic = true, added_at = ${r.now}, lease_until = NULL, unanswered_at = NULL,
           list_version = NULL, look_due_at = ${r.now}
    WHERE gym_id = ${r.gymId} AND environment = ${r.environment} AND run_id = ${r.runId} AND state = 'adding'
    RETURNING gym_id`;
  return rows.length === 1;
}

// ── New members, added by themselves ──────────────────────────────────────────

export async function listVersionOf(sql: SqlOrTx, gymId: string): Promise<number | null> {
  const [row] = await sql<{ version: string | number }[]>`SELECT version FROM gym_member_lists WHERE gym_id = ${gymId}`;
  return row === undefined ? null : Number(row.version);
}

/** Current records not in Square that are due a look: never looked at, changed since (their name, email or
 *  phone), or left out, refused or not added at a look older than `lookedBefore`; and anybody whose customer is
 *  being made with no answer yet (`making`), asked about again with its key (round one, High 2). Those of a
 *  check that waits for the owner's press are theirs to add, until it is a day old. Separated from a customer
 *  by a merge in Square: at once; left out as `merged_away`: only once their details change (18d-iii-b-ii-b-ii-a). */
export async function recordsDue(
  sql: SqlOrTx,
  r: { gymId: string; environment: SquareEnvironment; accountId: string; lookedBefore: Date; limit: number },
): Promise<(PlaceRow & { making: boolean })[]> {
  const rows = await sql<{ id: string; full_name: string; email: string | null; phone_e164: string | null; digest: string; making: boolean }[]>`
    SELECT e.id, e.full_name, e.email::text AS email, e.phone_e164, ${DIGEST(sql)} AS digest, ${LINKED(sql, r.environment, r.accountId)} AS making
    FROM gym_member_list_entries e
    LEFT JOIN gym_square_member_plan p ON p.gym_id = e.gym_id AND p.environment = ${r.environment} AND p.entry_id = e.id
    WHERE e.gym_id = ${r.gymId} AND e.former_at IS NULL AND NOT ${MADE(sql, r.environment, r.accountId)}
      AND (${LINKED(sql, r.environment, r.accountId)} OR p.entry_id IS NULL OR p.digest <> ${DIGEST(sql)}
           OR (p.decision <> 'merged_away' AND p.looked_at < ${r.lookedBefore})
           -- Separated by a merge in Square: added again at once (18d-iii-b-ii-b-ii-a).
           OR (p.separated_at IS NOT NULL AND p.decision = 'add' AND p.outcome IS NULL))
    ORDER BY e.listed_seq
    LIMIT ${r.limit}`;
  return rows.map((x) => ({ entryId: x.id, fullName: x.full_name, email: x.email, phone: x.phone_e164, digest: x.digest, making: x.making }));
}

/** The current records not in Square that share an email or a phone with these, for the rule to tell whether a
 *  customer could be more than one of them. */
export async function recordsSharing(
  sql: SqlOrTx,
  r: { gymId: string; environment: SquareEnvironment; accountId: string; emails: readonly string[]; phones: readonly string[] },
): Promise<PlaceRow[]> {
  if (r.emails.length === 0 && r.phones.length === 0) return [];
  const rows = await sql<{ id: string; full_name: string; email: string | null; phone_e164: string | null; digest: string }[]>`
    SELECT e.id, e.full_name, e.email::text AS email, e.phone_e164, ${DIGEST(sql)} AS digest
    FROM gym_member_list_entries e
    WHERE e.gym_id = ${r.gymId} AND e.former_at IS NULL AND NOT ${LINKED(sql, r.environment, r.accountId)}
      AND (lower(e.email::text) = ANY(${[...r.emails]}::text[]) OR e.phone_e164 = ANY(${[...r.phones]}::text[]))
    LIMIT 50`;
  return rows.map((x) => ({ entryId: x.id, fullName: x.full_name, email: x.email, phone: x.phone_e164, digest: x.digest }));
}

/** One record's look, as its own plan row: what was decided and, where it was done, what happened. */
export async function writeLook(
  sql: SqlOrTx,
  r: { gymId: string; environment: SquareEnvironment; runId: string; entryId: string; plan: MemberPlan; digest: string; billed: boolean; outcome: Outcome | null; now: Date },
): Promise<void> {
  await sql`
    INSERT INTO gym_square_member_plan (gym_id, environment, entry_id, run_id, decision, customer_id, digest, billed, looked_at, outcome, done_at)
    SELECT ${r.gymId}, ${r.environment}, e.id, ${r.runId}, ${decisionOf(r.plan)}, ${customerOf(r.plan)}, ${r.digest}, ${r.billed}, ${r.now}, ${r.outcome}, ${r.outcome === null ? null : r.now}
    FROM gym_member_list_entries e WHERE e.gym_id = ${r.gymId} AND e.id = ${r.entryId}
    ON CONFLICT (gym_id, environment, entry_id) DO UPDATE SET
      run_id = EXCLUDED.run_id, decision = EXCLUDED.decision, customer_id = EXCLUDED.customer_id, digest = EXCLUDED.digest,
      billed = EXCLUDED.billed, looked_at = EXCLUDED.looked_at, outcome = EXCLUDED.outcome, done_at = EXCLUDED.done_at`;
}

/** The run is taken again at once: changes still to copy, or Square gave no answer (18d-iii-b-ii-b-ii-b-i). */
export async function wake(sql: SqlOrTx, r: { gymId: string; environment: SquareEnvironment; runId: string; at: Date }): Promise<void> {
  await sql`
    UPDATE gym_square_member_runs SET look_due_at = ${r.at}
    WHERE gym_id = ${r.gymId} AND environment = ${r.environment} AND run_id = ${r.runId}`;
}

/** The list looked at up to `version`; the next look a day on where somebody is still not in Square. */
export async function caughtUp(sql: SqlOrTx, r: { gymId: string; environment: SquareEnvironment; runId: string; version: number | null; lookDueAt: Date }): Promise<void> {
  await sql`
    UPDATE gym_square_member_runs SET list_version = ${r.version}, look_due_at = ${r.lookDueAt}, unanswered_at = NULL
    WHERE gym_id = ${r.gymId} AND environment = ${r.environment} AND run_id = ${r.runId}`;
}

// ── Square's merges (18d-iii-b-ii-b-ii-a) ─────────────────────────────────────

/** Square merged `fromId` into `to`: a plan not yet done that names the old customer is dropped (the record is
 *  looked at again, never linked to a customer Square no longer has), a plan done names the new one, and a check
 *  that read the old customer reads the new one in its place. */
export async function forgetMergedCustomer(tx: TransactionSql, r: { gymId: string; environment: SquareEnvironment; fromId: string; to: CandidateRow }): Promise<void> {
  await tx`
    DELETE FROM gym_square_member_plan
    WHERE gym_id = ${r.gymId} AND environment = ${r.environment} AND customer_id = ${r.fromId} AND outcome IS NULL`;
  await tx`
    UPDATE gym_square_member_plan SET customer_id = ${r.to.customerId}
    WHERE gym_id = ${r.gymId} AND environment = ${r.environment} AND customer_id = ${r.fromId}`;
  const read = await tx<{ run_id: string }[]>`
    DELETE FROM gym_square_member_candidates
    WHERE gym_id = ${r.gymId} AND environment = ${r.environment} AND customer_id = ${r.fromId}
    RETURNING run_id`;
  for (const runId of new Set(read.map((x) => x.run_id))) await insertCandidates(tx, { gymId: r.gymId, environment: r.environment, runId }, [r.to]);
}

/** Current records a merge in Square separated from the customer they were linked to: looked at again at once,
 *  and so added again by themselves; separated a second time since `againSince`, left out (`merged_away`) until
 *  their name, email or phone changes, so the app and Square never take turns. Only at a gym that uses Members
 *  in Square (it has a check's row). Answers those left out. */
export async function separateFromMerged(
  tx: TransactionSql,
  r: { gymId: string; environment: SquareEnvironment; entryIds: readonly string[]; now: Date; againSince: Date },
): Promise<string[]> {
  if (r.entryIds.length === 0) return [];
  const rows = await tx<{ entry_id: string; away: boolean }[]>`
    INSERT INTO gym_square_member_plan (gym_id, environment, entry_id, run_id, decision, customer_id, digest, billed, looked_at, outcome, done_at, separated_at)
    SELECT e.gym_id, x.environment, e.id, x.run_id, 'add', NULL, ${DIGEST(tx)}, false, ${r.now}, NULL, NULL, ${r.now}
    FROM gym_member_list_entries e
    JOIN gym_square_member_runs x ON x.gym_id = e.gym_id AND x.environment = ${r.environment}
    WHERE e.gym_id = ${r.gymId} AND e.id = ANY(${[...r.entryIds]}::uuid[]) AND e.former_at IS NULL
    ON CONFLICT (gym_id, environment, entry_id) DO UPDATE SET
      decision = CASE WHEN gym_square_member_plan.separated_at >= ${r.againSince} THEN 'merged_away' ELSE 'add' END,
      run_id = EXCLUDED.run_id, customer_id = NULL, digest = EXCLUDED.digest, billed = false, looked_at = EXCLUDED.looked_at,
      outcome = NULL, done_at = NULL, separated_at = EXCLUDED.separated_at
    RETURNING entry_id, decision = 'merged_away' AS away`;
  // Members added by themselves: the next minute's look takes them.
  await tx`
    UPDATE gym_square_member_runs SET look_due_at = ${r.now}
    WHERE gym_id = ${r.gymId} AND environment = ${r.environment} AND automatic`;
  return rows.filter((x) => x.away).map((x) => x.entry_id);
}

// ── What the box shows ────────────────────────────────────────────────────────

export async function countMembers(sql: SqlOrTx, gymId: string, environment: SquareEnvironment, accountId: string): Promise<{ members: number; inSquare: number }> {
  const [row] = await sql<{ members: number; in_square: number }[]>`
    SELECT count(*)::int AS members,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM gym_square_customers c
                                           WHERE c.gym_id = e.gym_id AND c.entry_id = e.id AND c.environment = ${environment}
                                             AND c.account_id = ${accountId} AND c.customer_id IS NOT NULL))::int AS in_square
    FROM gym_member_list_entries e WHERE e.gym_id = ${gymId} AND e.former_at IS NULL`;
  return { members: row?.members ?? 0, inSquare: row?.in_square ?? 0 };
}

export type Groups = Record<SquareMembersGroup, SquareMembersNamed>;

const none = (): SquareMembersNamed => ({ count: 0, names: [] });
const emptyGroups = (): Groups => ({
  add: none(),
  link: none(),
  several_customers: none(),
  several_people: none(),
  billed: none(),
  refused: none(),
  waiting: none(),
  merged_away: none(),
  not_copied: none(),
});

/** In Square, and Square would not take the change to their details as they are now (18d-iii-b-ii-b-ii-b-i). */
const NOT_COPIED = (sql: SqlOrTx, gymId: string, environment: SquareEnvironment, accountId: string) => sql`
  SELECT 'not_copied', e.id, e.full_name, e.listed_seq
  FROM gym_square_customers c JOIN gym_member_list_entries e ON e.gym_id = c.gym_id AND e.id = c.entry_id
  WHERE c.gym_id = ${gymId} AND c.environment = ${environment} AND c.account_id = ${accountId} AND c.customer_id IS NOT NULL
    AND e.former_at IS NULL AND c.copy_refused_digest IS NOT NULL AND c.copy_refused_digest = ${DIGEST(sql)}`;

/** The groups of a check waiting for the press: what the press would still do, by the plan; nobody the
 *  worker has added or linked meanwhile, as new members are once members were added (round one, High 3). */
const CHECKED_GROUPS = (sql: SqlOrTx, gymId: string, environment: SquareEnvironment, runId: string, accountId: string) => sql`
  SELECT CASE p.decision WHEN 'ours' THEN 'link' ELSE p.decision END AS grp, e.id, e.full_name, e.listed_seq
  FROM gym_square_member_plan p JOIN gym_member_list_entries e ON e.gym_id = p.gym_id AND e.id = p.entry_id
  WHERE p.gym_id = ${gymId} AND p.environment = ${environment} AND p.run_id = ${runId} AND e.former_at IS NULL
    AND p.outcome IS NULL AND NOT ${MADE(sql, environment, accountId)}
  UNION ALL
  SELECT 'billed', e.id, e.full_name, e.listed_seq
  FROM gym_square_member_plan p JOIN gym_member_list_entries e ON e.gym_id = p.gym_id AND e.id = p.entry_id
  WHERE p.gym_id = ${gymId} AND p.environment = ${environment} AND p.run_id = ${runId} AND p.billed AND e.former_at IS NULL
    AND p.outcome IS NULL AND NOT ${MADE(sql, environment, accountId)}
  UNION ALL ${NOT_COPIED(sql, gymId, environment, accountId)}`;

/** The groups once members were added: the current members not in Square, and why. */
const NOT_IN_GROUPS = (sql: SqlOrTx, gymId: string, environment: SquareEnvironment, accountId: string) => sql`
  SELECT CASE WHEN p.entry_id IS NULL OR p.digest <> ${DIGEST(sql)} THEN 'waiting'
              WHEN p.outcome = 'refused' THEN 'refused'
              WHEN p.outcome IS NULL AND p.decision IN ('several_customers','several_people','merged_away') THEN p.decision
              ELSE 'waiting' END AS grp,
         e.id, e.full_name, e.listed_seq
  FROM gym_member_list_entries e
  LEFT JOIN gym_square_member_plan p ON p.gym_id = e.gym_id AND p.environment = ${environment} AND p.entry_id = e.id
  WHERE e.gym_id = ${gymId} AND e.former_at IS NULL AND NOT ${MADE(sql, environment, accountId)}
  UNION ALL
  -- In Square, and charged by Square's own subscriptions, as the last look read them (round one, Low 5).
  SELECT 'billed', e.id, e.full_name, e.listed_seq
  FROM gym_square_member_plan p JOIN gym_member_list_entries e ON e.gym_id = p.gym_id AND e.id = p.entry_id
  WHERE p.gym_id = ${gymId} AND p.environment = ${environment} AND p.billed AND e.former_at IS NULL AND ${MADE(sql, environment, accountId)}
  UNION ALL ${NOT_COPIED(sql, gymId, environment, accountId)}`;

const nameOf = (fullName: string): string => (fullName.trim() === "" ? NO_NAME : fullName.trim().slice(0, 200));

async function groupsFrom(sql: SqlOrTx, source: ReturnType<typeof CHECKED_GROUPS>, withNames: boolean): Promise<Groups> {
  const rows = await sql<{ grp: SquareMembersGroup; n: number; full_name: string | null }[]>`
    SELECT grp, n, CASE WHEN rn <= ${withNames ? 3 : 0} THEN full_name END AS full_name FROM (
      SELECT grp, full_name, count(*) OVER (PARTITION BY grp)::int AS n,
             row_number() OVER (PARTITION BY grp ORDER BY lower(full_name), listed_seq) AS rn
      FROM (${source}) g) x
    WHERE rn <= greatest(${withNames ? 3 : 0}, 1)
    ORDER BY grp, rn`;
  const groups = emptyGroups();
  for (const r of rows) {
    const group = groups[r.grp];
    group.count = r.n;
    if (r.full_name !== null) group.names.push(nameOf(r.full_name));
  }
  return groups;
}

export async function checkedGroups(sql: SqlOrTx, gymId: string, environment: SquareEnvironment, runId: string, accountId: string, withNames: boolean): Promise<Groups> {
  return await groupsFrom(sql, CHECKED_GROUPS(sql, gymId, environment, runId, accountId), withNames);
}

export async function notInGroups(sql: SqlOrTx, gymId: string, environment: SquareEnvironment, accountId: string, withNames: boolean): Promise<Groups> {
  return await groupsFrom(sql, NOT_IN_GROUPS(sql, gymId, environment, accountId), withNames);
}

/** `adding`: how many of the press's people are done. */
export async function progressOf(sql: SqlOrTx, gymId: string, environment: SquareEnvironment, runId: string): Promise<{ done: number; of: number }> {
  const [row] = await sql<{ done: number; of: number }[]>`
    SELECT count(*) FILTER (WHERE outcome IS NOT NULL)::int AS done, count(*)::int AS of
    FROM gym_square_member_plan
    WHERE gym_id = ${gymId} AND environment = ${environment} AND run_id = ${runId} AND decision IN ('ours','link','add')`;
  return { done: row?.done ?? 0, of: row?.of ?? 0 };
}

/** See all: a page of one group's names. */
export async function groupNames(
  sql: SqlOrTx,
  r: { gymId: string; environment: SquareEnvironment; accountId: string; runId: string | null; checked: boolean; group: SquareMembersGroup; from: number; limit: number },
): Promise<string[]> {
  const source = r.checked && r.runId !== null ? CHECKED_GROUPS(sql, r.gymId, r.environment, r.runId, r.accountId) : NOT_IN_GROUPS(sql, r.gymId, r.environment, r.accountId);
  const rows = await sql<{ full_name: string }[]>`
    SELECT full_name FROM (${source}) g WHERE grp = ${r.group}
    ORDER BY lower(full_name), listed_seq OFFSET ${r.from} LIMIT ${r.limit}`;
  return rows.map((x) => nameOf(x.full_name));
}

/** The customers of Square's own subscriptions that still charge: ACTIVE, PENDING (starts later), PAUSED. */
export const SQUARE_SUBSCRIPTION_CHARGES: readonly string[] = ["ACTIVE", "PENDING", "PAUSED"];
