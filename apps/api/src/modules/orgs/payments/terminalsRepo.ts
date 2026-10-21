// A gym's Square Terminals (ROADMAP 18d-ii-b-i). Every read and write names the gym and the
// environment; what is shown or paired also names the Square account the gym is connected to.
import { squarePracticeTerminalSchema, type SquarePracticeTerminal } from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import { SQUARE_TERMINALS_MAX } from "@app/shared";
import { lockAccount } from "./repo.js";
import type { SquareEnvironment } from "./square.js";

type SqlOrTx = Sql | TransactionSql;

export interface TerminalRow {
  id: string;
  accountId: string;
  state: "pairing" | "paired";
  deviceCodeId: string | null;
  deviceId: string | null;
  practice: SquarePracticeTerminal | null;
  pairBy: Date | null;
  pairedAt: Date | null;
}

interface RawTerminal {
  id: string;
  account_id: string;
  state: "pairing" | "paired";
  device_code_id: string | null;
  device_id: string | null;
  practice: string | null;
  pair_by: Date | null;
  paired_at: Date | null;
}

function toRow(raw: RawTerminal): TerminalRow {
  const practice = squarePracticeTerminalSchema.safeParse(raw.practice);
  return {
    id: raw.id,
    accountId: raw.account_id,
    state: raw.state,
    deviceCodeId: raw.device_code_id,
    deviceId: raw.device_id,
    practice: practice.success ? practice.data : null,
    pairBy: raw.pair_by,
    pairedAt: raw.paired_at,
  };
}

/** The gym's Terminals in this Square account, paired ones first in the order they were paired. */
export async function readTerminals(sql: SqlOrTx, gymId: string, environment: SquareEnvironment, accountId: string): Promise<TerminalRow[]> {
  const rows = await sql<RawTerminal[]>`
    SELECT id, account_id, state, device_code_id, device_id, practice, pair_by, paired_at
    FROM gym_square_terminals
    WHERE gym_id = ${gymId} AND environment = ${environment} AND account_id = ${accountId}
    ORDER BY paired_at NULLS LAST, created_at, id`;
  return rows.map(toRow);
}

/** One of the gym's rows, in any account. `lock`: held for the transaction. */
export async function readTerminal(sql: SqlOrTx, gymId: string, environment: SquareEnvironment, id: string, lock = false): Promise<TerminalRow | null> {
  const rows = lock
    ? await sql<RawTerminal[]>`
        SELECT id, account_id, state, device_code_id, device_id, practice, pair_by, paired_at
        FROM gym_square_terminals WHERE id = ${id} AND gym_id = ${gymId} AND environment = ${environment}
        FOR UPDATE`
    : await sql<RawTerminal[]>`
        SELECT id, account_id, state, device_code_id, device_id, practice, pair_by, paired_at
        FROM gym_square_terminals WHERE id = ${id} AND gym_id = ${gymId} AND environment = ${environment}`;
  const row = rows[0];
  return row === undefined ? null : toRow(row);
}

export async function countPaired(sql: SqlOrTx, gymId: string, environment: SquareEnvironment, accountId: string): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM gym_square_terminals
    WHERE gym_id = ${gymId} AND environment = ${environment} AND account_id = ${accountId} AND state = 'paired'`;
  return rows[0]?.n ?? 0;
}

/** Square's code, waiting for a Terminal: it replaces the one waiting before. The caller holds
 *  the gym's lock. */
export async function startPairing(
  tx: TransactionSql,
  p: { gymId: string; environment: SquareEnvironment; accountId: string; deviceCodeId: string; pairBy: Date; createdBy: string },
): Promise<string> {
  await tx`DELETE FROM gym_square_terminals WHERE gym_id = ${p.gymId} AND environment = ${p.environment} AND state = 'pairing'`;
  const rows = await tx<{ id: string }[]>`
    INSERT INTO gym_square_terminals (gym_id, environment, account_id, state, device_code_id, pair_by, created_by)
    VALUES (${p.gymId}, ${p.environment}, ${p.accountId}, 'pairing', ${p.deviceCodeId}, ${p.pairBy}, ${p.createdBy})
    RETURNING id`;
  const row = rows[0];
  if (row === undefined) throw new Error("pairing not written");
  return row.id;
}

/** A gym that listed a Terminal until it signed in for another gym on the same Square account. */
export interface MovedFrom {
  gymId: string;
  practice: SquarePracticeTerminal | null;
}

/** A Terminal stands at one desk: once it signs in for this gym, any other gym holding the same
 *  Square account stops listing it. The caller holds the account's lock. */
async function takeFromOtherGyms(tx: TransactionSql, gymId: string, environment: SquareEnvironment, accountId: string, deviceId: string): Promise<MovedFrom[]> {
  const rows = await tx<{ gym_id: string; practice: string | null }[]>`
    DELETE FROM gym_square_terminals
    WHERE environment = ${environment} AND account_id = ${accountId} AND device_id = ${deviceId} AND gym_id <> ${gymId}
    RETURNING gym_id, practice`;
  return rows.map((r) => {
    const practice = squarePracticeTerminalSchema.safeParse(r.practice);
    return { gymId: r.gym_id, practice: practice.success ? practice.data : null };
  });
}

export type FinishedPairing = { outcome: "paired"; movedFrom: MovedFrom[] } | { outcome: "known" } | { outcome: "full" };

/** The Terminal that signed in with the code. One the gym has already stays as it is; one that
 *  would take the gym past SQUARE_TERMINALS_MAX is not paired; either way the waiting row goes.
 *  Counted here, under the locks, as two codes can finish at once. The caller holds the gym's
 *  lock and the row's. */
export async function finishPairing(tx: TransactionSql, gymId: string, environment: SquareEnvironment, waiting: TerminalRow, deviceId: string, now: Date): Promise<FinishedPairing> {
  await lockAccount(tx, environment, waiting.accountId);
  const known = await tx<{ id: string }[]>`
    SELECT id FROM gym_square_terminals
    WHERE gym_id = ${gymId} AND environment = ${environment} AND account_id = ${waiting.accountId} AND device_id = ${deviceId}`;
  if (known.length > 0) {
    await dropPairing(tx, gymId, environment, waiting.id);
    return { outcome: "known" };
  }
  if ((await countPaired(tx, gymId, environment, waiting.accountId)) >= SQUARE_TERMINALS_MAX) {
    await dropPairing(tx, gymId, environment, waiting.id);
    return { outcome: "full" };
  }
  const movedFrom = await takeFromOtherGyms(tx, gymId, environment, waiting.accountId, deviceId);
  await tx`
    UPDATE gym_square_terminals
    SET state = 'paired', device_id = ${deviceId}, paired_at = ${now}, pair_by = NULL
    WHERE id = ${waiting.id} AND gym_id = ${gymId} AND environment = ${environment} AND state = 'pairing'`;
  return { outcome: "paired", movedFrom };
}

export async function dropPairing(sql: SqlOrTx, gymId: string, environment: SquareEnvironment, id: string): Promise<void> {
  await sql`DELETE FROM gym_square_terminals WHERE id = ${id} AND gym_id = ${gymId} AND environment = ${environment} AND state = 'pairing'`;
}

/** One of Square's simulated Terminals, in its sandbox, as a real one signing in would be: once a
 *  gym, taken from any other gym on the account, never past SQUARE_TERMINALS_MAX. The caller
 *  holds the gym's lock. */
export async function addPractice(
  tx: TransactionSql,
  p: { gymId: string; accountId: string; practice: SquarePracticeTerminal; deviceId: string; createdBy: string; now: Date },
): Promise<FinishedPairing> {
  await lockAccount(tx, "sandbox", p.accountId);
  const known = await tx<{ id: string }[]>`
    SELECT id FROM gym_square_terminals
    WHERE gym_id = ${p.gymId} AND environment = 'sandbox' AND account_id = ${p.accountId} AND device_id = ${p.deviceId}`;
  if (known.length > 0) return { outcome: "known" };
  if ((await countPaired(tx, p.gymId, "sandbox", p.accountId)) >= SQUARE_TERMINALS_MAX) return { outcome: "full" };
  const movedFrom = await takeFromOtherGyms(tx, p.gymId, "sandbox", p.accountId, p.deviceId);
  await tx`
    INSERT INTO gym_square_terminals (gym_id, environment, account_id, state, device_id, practice, created_by, paired_at)
    VALUES (${p.gymId}, 'sandbox', ${p.accountId}, 'paired', ${p.deviceId}, ${p.practice}, ${p.createdBy}, ${p.now})`;
  return { outcome: "paired", movedFrom };
}

/** This person is the gym's owner or on its staff. */
export async function isStaffOf(sql: SqlOrTx, gymId: string, userId: string): Promise<boolean> {
  const rows = await sql<{ one: number }[]>`
    SELECT 1 AS one FROM gyms WHERE id = ${gymId} AND owner_user_id = ${userId}
    UNION ALL
    SELECT 1 AS one FROM gym_staff WHERE gym_id = ${gymId} AND user_id = ${userId}
    LIMIT 1`;
  return rows.length > 0;
}

/** Remove: the gym stops using the Terminal, paired or still waiting. */
export async function deleteTerminal(tx: TransactionSql, gymId: string, environment: SquareEnvironment, id: string): Promise<TerminalRow | null> {
  const rows = await tx<RawTerminal[]>`
    DELETE FROM gym_square_terminals WHERE id = ${id} AND gym_id = ${gymId} AND environment = ${environment}
    RETURNING id, account_id, state, device_code_id, device_id, practice, pair_by, paired_at`;
  const row = rows[0];
  return row === undefined ? null : toRow(row);
}
