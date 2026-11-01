// A gym's payment company (ROADMAP 18d-i): its connection, the presses of Connect Square
// waiting for Square, and the tokens Square is still to be told to stop. Every read and
// write of a gym's row names the gym in the WHERE; the worker's reads across gyms name the
// environment and hand each row back with its gym.
import { squareLocationChoiceSchema } from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import { z } from "zod";
import type { SquareEnvironment } from "./square.js";

type SqlOrTx = Sql | TransactionSql;

export interface GymForPayments {
  ownerUserId: string;
  slug: string;
  name: string;
  country: string | null;
  timezone: string;
}

export async function readGym(sql: SqlOrTx, gymId: string): Promise<GymForPayments | null> {
  const rows = await sql<{ owner_user_id: string; slug: string; name: string; country: string | null; timezone: string }[]>`
    SELECT owner_user_id, slug, name, country, timezone FROM gyms WHERE id = ${gymId}`;
  const row = rows[0];
  return row === undefined ? null : { ownerUserId: row.owner_user_id, slug: row.slug, name: row.name, country: row.country, timezone: row.timezone };
}

const locationChoicesSchema = z.array(squareLocationChoiceSchema).max(300);

export interface ConnectionRow {
  gymId: string;
  environment: SquareEnvironment;
  state: "connected" | "removed";
  accountId: string;
  businessName: string;
  country: string;
  currency: string;
  locationId: string | null;
  locationName: string | null;
  /** Null when none are kept or they no longer parse. */
  locationChoices: z.infer<typeof locationChoicesSchema> | null;
  accessToken: string | null;
  refreshToken: string | null;
  connectedAt: Date;
  removedAt: Date | null;
  /** What the gym allowed on Square's page; none known for a row made before 0147. */
  scopes: string[];
}

interface RawConnection {
  gym_id: string;
  environment: SquareEnvironment;
  state: "connected" | "removed";
  account_id: string;
  business_name: string;
  country: string;
  currency: string;
  location_id: string | null;
  location_name: string | null;
  location_choices: unknown;
  access_token: string | null;
  refresh_token: string | null;
  connected_at: Date;
  removed_at: Date | null;
  scopes: string[];
}

function toRow(raw: RawConnection): ConnectionRow {
  const choices = raw.location_choices === null ? null : locationChoicesSchema.safeParse(raw.location_choices);
  return {
    gymId: raw.gym_id,
    environment: raw.environment,
    state: raw.state,
    accountId: raw.account_id,
    businessName: raw.business_name,
    country: raw.country,
    currency: raw.currency,
    locationId: raw.location_id,
    locationName: raw.location_name,
    locationChoices: choices === null || !choices.success ? null : choices.data,
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    connectedAt: raw.connected_at,
    removedAt: raw.removed_at,
    scopes: raw.scopes,
  };
}

/** The gym's Square row in this environment, or null. `lock`: held for the transaction. */
export async function readConnection(sql: SqlOrTx, gymId: string, environment: SquareEnvironment, lock = false): Promise<ConnectionRow | null> {
  const rows = lock
    ? await sql<RawConnection[]>`
        SELECT * FROM gym_payment_connections
        WHERE gym_id = ${gymId} AND provider = 'square' AND environment = ${environment}
        FOR UPDATE`
    : await sql<RawConnection[]>`
        SELECT * FROM gym_payment_connections
        WHERE gym_id = ${gymId} AND provider = 'square' AND environment = ${environment}`;
  const row = rows[0];
  return row === undefined ? null : toRow(row);
}

export async function insertStart(
  sql: SqlOrTx,
  start: { stateHash: string; gymId: string; userId: string; environment: SquareEnvironment; expiresAt: Date },
): Promise<void> {
  await sql`
    INSERT INTO gym_payment_connect_starts (state_hash, gym_id, user_id, provider, environment, expires_at)
    VALUES (${start.stateHash}, ${start.gymId}, ${start.userId}, 'square', ${start.environment}, ${start.expiresAt})`;
}

/** Use a press once: the gym it was made at, when it is this person's, in this environment
 *  and not past its time. Taken in one statement, so two answers with it cannot both pass. */
export async function takeStart(sql: SqlOrTx, stateHash: string, userId: string, environment: SquareEnvironment, now: Date): Promise<string | null> {
  const rows = await sql<{ gym_id: string }[]>`
    DELETE FROM gym_payment_connect_starts
    WHERE state_hash = ${stateHash} AND user_id = ${userId} AND provider = 'square'
      AND environment = ${environment} AND expires_at > ${now}
    RETURNING gym_id`;
  return rows[0]?.gym_id ?? null;
}

/** Presses that ran out, of this server's Square environment: the other's are its own.
 *  `gymIds`, here and in the claims below: only these gyms, for a test sharing its database
 *  with a real connection; production passes null. */
export async function forgetExpiredStarts(sql: SqlOrTx, environment: SquareEnvironment, now: Date, gymIds: readonly string[] | null = null): Promise<number> {
  const rows = await sql<{ state_hash: string }[]>`
    DELETE FROM gym_payment_connect_starts WHERE environment = ${environment} AND expires_at <= ${now}
      AND (${gymIds === null}::boolean OR gym_id = ANY(${[...(gymIds ?? [])]}::uuid[]))
    RETURNING state_hash`;
  return rows.length;
}

/** Held to the end of the transaction: whoever checks who else holds a Square account, and
 *  then lets its tokens go, does both before the next one looks. */
export async function lockAccount(tx: TransactionSql, environment: SquareEnvironment, accountId: string): Promise<void> {
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`square:${environment}:${accountId}`}, 0))`;
}

/** How many gyms hold this Square account, connected. A caller letting a token go has
 *  already taken it off its own row, or never put it on one. */
export async function holders(tx: TransactionSql, environment: SquareEnvironment, accountId: string): Promise<number> {
  const rows = await tx<{ n: number }[]>`
    SELECT count(*)::int AS n FROM gym_payment_connections
    WHERE provider = 'square' AND environment = ${environment} AND account_id = ${accountId}
      AND state = 'connected'`;
  return rows[0]?.n ?? 0;
}

export interface NewConnection {
  gymId: string;
  environment: SquareEnvironment;
  accountId: string;
  businessName: string;
  country: string;
  currency: string;
  location: { id: string; name: string } | null;
  locationChoices: z.infer<typeof locationChoicesSchema> | null;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshDueAt: Date;
  connectedBy: string;
  connectedAt: Date;
  scopes: readonly string[];
}

/** Connect, over a row the gym took off inside Square. The caller holds the gym's lock and
 *  has read that it is not connected. */
export async function writeConnection(tx: TransactionSql, c: NewConnection): Promise<void> {
  const choices = c.locationChoices === null ? null : tx.json(c.locationChoices);
  await tx`
    INSERT INTO gym_payment_connections (
      gym_id, provider, environment, state, account_id, business_name, country, currency,
      location_id, location_name, location_choices, access_token, refresh_token,
      access_expires_at, refresh_due_at, connected_by, connected_at, removed_at, scopes)
    VALUES (
      ${c.gymId}, 'square', ${c.environment}, 'connected', ${c.accountId}, ${c.businessName}, ${c.country}, ${c.currency},
      ${c.location?.id ?? null}, ${c.location?.name ?? null}, ${choices}, ${c.accessToken}, ${c.refreshToken},
      ${c.accessExpiresAt}, ${c.refreshDueAt}, ${c.connectedBy}, ${c.connectedAt}, NULL, ${[...c.scopes]}::text[])
    ON CONFLICT (gym_id, provider) DO UPDATE SET
      environment = EXCLUDED.environment, state = 'connected', account_id = EXCLUDED.account_id,
      business_name = EXCLUDED.business_name, country = EXCLUDED.country, currency = EXCLUDED.currency,
      location_id = EXCLUDED.location_id, location_name = EXCLUDED.location_name,
      location_choices = EXCLUDED.location_choices, access_token = EXCLUDED.access_token,
      refresh_token = EXCLUDED.refresh_token, access_expires_at = EXCLUDED.access_expires_at,
      refresh_due_at = EXCLUDED.refresh_due_at, connected_by = EXCLUDED.connected_by,
      connected_at = EXCLUDED.connected_at, removed_at = NULL, scopes = EXCLUDED.scopes, refunds_read_at = NULL`;
  // Back on an account it left: what happened there meanwhile is read again, and any press left "We don't know" there.
  await tx`
    UPDATE gym_square_refunds SET look_at = ${c.connectedAt}
    WHERE gym_id = ${c.gymId} AND environment = ${c.environment} AND account_id = ${c.accountId} AND outcome = 'lost' AND no_refund_at IS NULL`;
}

/** Connect Square again on the account already connected, to allow what it did not: the new
 *  tokens and permissions onto that connection, its location kept. `connected_at` moves on, so
 *  a renewal or a token check the worker began with the old tokens no longer matches it. Only
 *  the connection this was checked on; false when it changed meanwhile. */
export async function allowAgain(
  tx: TransactionSql,
  r: {
    gymId: string;
    environment: SquareEnvironment;
    accountId: string;
    wasConnectedAt: Date;
    accessToken: string;
    refreshToken: string;
    accessExpiresAt: Date;
    refreshDueAt: Date;
    connectedBy: string;
    connectedAt: Date;
    scopes: readonly string[];
  },
): Promise<boolean> {
  const rows = await tx<{ gym_id: string }[]>`
    UPDATE gym_payment_connections
    SET access_token = ${r.accessToken}, refresh_token = ${r.refreshToken}, access_expires_at = ${r.accessExpiresAt},
        refresh_due_at = ${r.refreshDueAt}, connected_by = ${r.connectedBy}, connected_at = ${r.connectedAt},
        scopes = ${[...r.scopes]}::text[]
    WHERE gym_id = ${r.gymId} AND provider = 'square' AND environment = ${r.environment}
      AND state = 'connected' AND account_id = ${r.accountId} AND connected_at = ${r.wasConnectedAt}
    RETURNING gym_id`;
  return rows.length === 1;
}

/** The owner's pick of location, once, while the row is waiting for one. */
export async function setLocation(tx: TransactionSql, gymId: string, environment: SquareEnvironment, location: { id: string; name: string }): Promise<boolean> {
  const rows = await tx<{ gym_id: string }[]>`
    UPDATE gym_payment_connections
    SET location_id = ${location.id}, location_name = ${location.name}, location_choices = NULL
    WHERE gym_id = ${gymId} AND provider = 'square' AND environment = ${environment}
      AND state = 'connected' AND location_id IS NULL
    RETURNING gym_id`;
  return rows.length === 1;
}

export async function deleteConnection(tx: TransactionSql, gymId: string, environment: SquareEnvironment): Promise<void> {
  await tx`DELETE FROM gym_payment_connections WHERE gym_id = ${gymId} AND provider = 'square' AND environment = ${environment}`;
}

/** The gym took the app off its Square account: the tokens go, the name stays to say so. Only
 *  the connection this was checked on: one made again since is left alone. */
export async function markRemoved(sql: SqlOrTx, gymId: string, environment: SquareEnvironment, connectedAt: Date, now: Date): Promise<boolean> {
  const rows = await sql<{ gym_id: string }[]>`
    UPDATE gym_payment_connections
    SET state = 'removed', removed_at = ${now}, access_token = NULL, refresh_token = NULL,
        access_expires_at = NULL, refresh_due_at = NULL, location_choices = NULL
    WHERE gym_id = ${gymId} AND provider = 'square' AND environment = ${environment}
      AND state = 'connected' AND connected_at = ${connectedAt}
    RETURNING gym_id`;
  return rows.length === 1;
}

/** Every gym holding this Square account, connected, for Square's message about it. */
export async function connectionsOfAccount(sql: SqlOrTx, environment: SquareEnvironment, accountId: string): Promise<ConnectionRow[]> {
  const rows = await sql<RawConnection[]>`
    SELECT * FROM gym_payment_connections
    WHERE provider = 'square' AND environment = ${environment} AND account_id = ${accountId} AND state = 'connected'
    ORDER BY gym_id`;
  return rows.map(toRow);
}

/** Connections whose refunds are due their hourly read (18d-iv-d-i), each marked read now, so a second worker skips them; `readBefore`
 *  is when it was last read, null the first time. */
export async function claimRefundReads(
  sql: Sql,
  environment: SquareEnvironment,
  now: Date,
  dueBefore: Date,
  limit: number,
  gymIds: readonly string[] | null,
): Promise<{ row: ConnectionRow; readBefore: Date | null }[]> {
  const rows = await sql<(RawConnection & { read_before: Date | null })[]>`
    WITH due AS (
      SELECT gym_id, provider, refunds_read_at AS read_before FROM gym_payment_connections
      WHERE provider = 'square' AND environment = ${environment} AND state = 'connected' AND (refunds_read_at IS NULL OR refunds_read_at <= ${dueBefore})
        AND (${gymIds === null}::boolean OR gym_id = ANY(${[...(gymIds ?? [])]}::uuid[]))
      ORDER BY refunds_read_at NULLS FIRST
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE gym_payment_connections c
    SET refunds_read_at = ${now}
    FROM due
    WHERE c.gym_id = due.gym_id AND c.provider = due.provider AND c.environment = ${environment}
    RETURNING c.*, due.read_before`;
  return rows.map((r) => ({ row: toRow(r), readBefore: r.read_before }));
}

/** Square could not be read: the same stretch is read again by the next run. */
export async function setRefundsRead(sql: SqlOrTx, gymId: string, environment: SquareEnvironment, at: Date | null): Promise<void> {
  await sql`UPDATE gym_payment_connections SET refunds_read_at = ${at} WHERE gym_id = ${gymId} AND provider = 'square' AND environment = ${environment}`;
}

/** Take the connections whose renewal is due and hold each for `leaseMs`: a second worker
 *  skips them, and a worker that dies leaves them to be taken again. */
export async function claimDueRefreshes(
  sql: Sql,
  environment: SquareEnvironment,
  now: Date,
  leaseMs: number,
  limit: number,
  gymIds: readonly string[] | null = null,
): Promise<ConnectionRow[]> {
  const rows = await sql<RawConnection[]>`
    WITH due AS (
      SELECT gym_id, provider FROM gym_payment_connections
      WHERE provider = 'square' AND environment = ${environment} AND state = 'connected' AND refresh_due_at <= ${now}
        AND (${gymIds === null}::boolean OR gym_id = ANY(${[...(gymIds ?? [])]}::uuid[]))
      ORDER BY refresh_due_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE gym_payment_connections c
    SET refresh_due_at = ${new Date(now.getTime() + leaseMs)}
    FROM due WHERE c.gym_id = due.gym_id AND c.provider = due.provider
    RETURNING c.*`;
  return rows.map(toRow);
}

/** Square's renewed tokens, onto the connection they were renewed for. */
export async function writeRefreshed(
  sql: SqlOrTx,
  r: { gymId: string; environment: SquareEnvironment; connectedAt: Date; accessToken: string; refreshToken: string; accessExpiresAt: Date; refreshDueAt: Date },
): Promise<boolean> {
  const rows = await sql<{ gym_id: string }[]>`
    UPDATE gym_payment_connections
    SET access_token = ${r.accessToken}, refresh_token = ${r.refreshToken},
        access_expires_at = ${r.accessExpiresAt}, refresh_due_at = ${r.refreshDueAt}
    WHERE gym_id = ${r.gymId} AND provider = 'square' AND environment = ${r.environment}
      AND state = 'connected' AND connected_at = ${r.connectedAt}
    RETURNING gym_id`;
  return rows.length === 1;
}

/** When the worker tries a connection's renewal next. */
export async function setRefreshDue(sql: SqlOrTx, gymId: string, environment: SquareEnvironment, connectedAt: Date, at: Date): Promise<void> {
  await sql`
    UPDATE gym_payment_connections SET refresh_due_at = ${at}
    WHERE gym_id = ${gymId} AND provider = 'square' AND environment = ${environment}
      AND state = 'connected' AND connected_at = ${connectedAt}`;
}

export interface OwedRevoke {
  id: string;
  gymId: string;
  environment: SquareEnvironment;
  accountId: string;
  accessToken: string;
  wholeAccount: boolean;
  tries: number;
}

export async function insertRevoke(
  tx: TransactionSql,
  r: { gymId: string; environment: SquareEnvironment; accountId: string; accessToken: string; wholeAccount: boolean; notBefore: Date },
): Promise<string> {
  const rows = await tx<{ id: string }[]>`
    INSERT INTO gym_payment_revokes (gym_id, provider, environment, account_id, access_token, whole_account, not_before)
    VALUES (${r.gymId}, 'square', ${r.environment}, ${r.accountId}, ${r.accessToken}, ${r.wholeAccount}, ${r.notBefore})
    RETURNING id`;
  const row = rows[0];
  if (row === undefined) throw new Error("revoke not written");
  return row.id;
}

/** A gym handed to a new owner (ROADMAP 4b): every Square connection it has, in every
 *  environment, is let go as Disconnect lets it go, its token owed to Square for the worker to
 *  send. The caller holds the gym's lock, so a Connect or Disconnect waits. How many went. */
export async function endConnectionsForHandOver(tx: TransactionSql, gymId: string, now: Date): Promise<number> {
  const rows = await tx<RawConnection[]>`
    SELECT * FROM gym_payment_connections WHERE gym_id = ${gymId} AND provider = 'square'
    FOR UPDATE`;
  for (const raw of rows) {
    const row = toRow(raw);
    await deleteConnection(tx, gymId, row.environment);
    if (row.state !== "connected" || row.accessToken === null) continue;
    await lockAccount(tx, row.environment, row.accountId);
    const left = await holders(tx, row.environment, row.accountId);
    await insertRevoke(tx, { gymId, environment: row.environment, accountId: row.accountId, accessToken: row.accessToken, wholeAccount: left === 0, notBefore: now });
  }
  return rows.length;
}

/** Take owed revokes that are due (`ids`: only these, as the request that wrote them sends
 *  them at once) and hold each for `leaseMs`. */
export async function claimDueRevokes(
  sql: Sql,
  environment: SquareEnvironment,
  now: Date,
  leaseMs: number,
  limit: number,
  ids: readonly string[] | null = null,
  gymIds: readonly string[] | null = null,
): Promise<OwedRevoke[]> {
  const rows = await sql<{ id: string; gym_id: string; environment: SquareEnvironment; account_id: string; access_token: string; whole_account: boolean; tries: number }[]>`
    WITH due AS (
      SELECT id FROM gym_payment_revokes
      WHERE provider = 'square' AND environment = ${environment} AND not_before <= ${now}
        AND (${ids === null}::boolean OR id = ANY(${[...(ids ?? [])]}::uuid[]))
        AND (${gymIds === null}::boolean OR gym_id = ANY(${[...(gymIds ?? [])]}::uuid[]))
      ORDER BY not_before
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE gym_payment_revokes r SET not_before = ${new Date(now.getTime() + leaseMs)}
    FROM due WHERE r.id = due.id
    RETURNING r.id, r.gym_id, r.environment, r.account_id, r.access_token, r.whole_account, r.tries`;
  return rows.map((r) => ({
    id: r.id,
    gymId: r.gym_id,
    environment: r.environment,
    accountId: r.account_id,
    accessToken: r.access_token,
    wholeAccount: r.whole_account,
    tries: r.tries,
  }));
}

/** Owed stops of this whole account become stops of their own token alone: a gym holds the
 *  account again. The caller holds the account's lock. */
export async function keepAccountWhole(tx: TransactionSql, environment: SquareEnvironment, accountId: string): Promise<void> {
  await tx`
    UPDATE gym_payment_revokes SET whole_account = false
    WHERE provider = 'square' AND environment = ${environment} AND account_id = ${accountId} AND whole_account`;
}

export async function finishRevoke(sql: SqlOrTx, id: string): Promise<void> {
  await sql`DELETE FROM gym_payment_revokes WHERE id = ${id}`;
}

export async function deferRevoke(sql: SqlOrTx, id: string, notBefore: Date): Promise<void> {
  await sql`UPDATE gym_payment_revokes SET tries = tries + 1, not_before = ${notBefore} WHERE id = ${id}`;
}
