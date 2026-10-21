// Save card on Terminal (ROADMAP 18d-ii-b-ii): one row a press, while it waits at the gym's Square
// Terminal and for a day after. Every read for a screen names the gym and the record; the
// worker's reads across gyms name the environment and hand each row back with its gym. A row is
// asked about by one request at a time (`checking_until`), and every change names the state it
// was read in, so two requests never both act on one answer.
import { terminalSaveOutcomeSchema, type TerminalSaveOutcome } from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import type { SquareEnvironment } from "./square.js";

type SqlOrTx = Sql | TransactionSql;

export type SaveState = "agreeing" | "saving" | "saved" | "not_saved";

export interface SaveRow {
  id: string;
  gymId: string;
  /** Null once the record was deleted for good or joined to another. */
  entryId: string | null;
  environment: SquareEnvironment;
  accountId: string;
  deviceId: string;
  customerId: string;
  state: SaveState;
  outcome: TerminalSaveOutcome | null;
  words: string;
  confirmKey: string;
  confirmActionId: string | null;
  pickedUp: boolean;
  agreedAt: Date | null;
  saveKey: string;
  saveActionId: string | null;
  cardId: string | null;
  startedBy: string | null;
  startedAt: Date;
  /** Staff pressed Cancel: the next look at Square stops the Terminal first. */
  cancelWantedAt: Date | null;
  /** Square refused Cancel as too late: the person confirmed on the Terminal. */
  cancelTooLate: boolean;
}

interface RawSave {
  id: string;
  gym_id: string;
  entry_id: string | null;
  environment: SquareEnvironment;
  account_id: string;
  device_id: string;
  customer_id: string;
  state: SaveState;
  outcome: string | null;
  words: string;
  confirm_key: string;
  confirm_action_id: string | null;
  picked_up: boolean;
  agreed_at: Date | null;
  save_key: string;
  save_action_id: string | null;
  card_id: string | null;
  started_by: string | null;
  started_at: Date;
  cancel_wanted_at: Date | null;
  cancel_too_late: boolean;
}

const toRow = (r: RawSave): SaveRow => {
  const outcome = terminalSaveOutcomeSchema.safeParse(r.outcome);
  return {
    id: r.id,
    gymId: r.gym_id,
    entryId: r.entry_id,
    environment: r.environment,
    accountId: r.account_id,
    deviceId: r.device_id,
    customerId: r.customer_id,
    state: r.state,
    outcome: outcome.success ? outcome.data : null,
    words: r.words,
    confirmKey: r.confirm_key,
    confirmActionId: r.confirm_action_id,
    pickedUp: r.picked_up,
    agreedAt: r.agreed_at,
    saveKey: r.save_key,
    saveActionId: r.save_action_id,
    cardId: r.card_id,
    startedBy: r.started_by,
    startedAt: r.started_at,
    cancelWantedAt: r.cancel_wanted_at,
    cancelTooLate: r.cancel_too_late,
  };
};

const COLUMNS = (sql: SqlOrTx) =>
  sql`id, gym_id, entry_id, environment, account_id, device_id, customer_id, state, outcome, words, confirm_key,
      confirm_action_id, picked_up, agreed_at, save_key, save_action_id, card_id, started_by, started_at, cancel_wanted_at, cancel_too_late`;

export interface NewSave {
  gymId: string;
  entryId: string;
  environment: SquareEnvironment;
  accountId: string;
  deviceId: string;
  customerId: string;
  requestKey: string;
  words: string;
  confirmKey: string;
  saveKey: string;
  startedBy: string;
  now: Date;
  /** Held by the request that writes it, which asks Square straight after. */
  checkingUntil: Date;
}

/** A new press, or why not: the same press already written, a save already waiting for this
 *  person, or the Terminal busy with another. */
export async function insertSave(sql: SqlOrTx, s: NewSave): Promise<{ kind: "new" | "same_press" | "person_waiting"; save: SaveRow } | { kind: "terminal_busy" } | { kind: "key_reused" }> {
  const rows = await sql<RawSave[]>`
    INSERT INTO gym_terminal_card_saves (gym_id, entry_id, environment, account_id, device_id, customer_id,
                                         request_key, state, words, confirm_key, save_key, started_by, started_at,
                                         checking_until, checked_at)
    VALUES (${s.gymId}, ${s.entryId}, ${s.environment}, ${s.accountId}, ${s.deviceId}, ${s.customerId},
            ${s.requestKey}, 'agreeing', ${s.words}, ${s.confirmKey}, ${s.saveKey}, ${s.startedBy}, ${s.now},
            ${s.checkingUntil}, ${s.now})
    ON CONFLICT DO NOTHING
    RETURNING ${COLUMNS(sql)}`;
  const made = rows[0];
  if (made !== undefined) return { kind: "new", save: toRow(made) };
  const [same] = await sql<RawSave[]>`
    SELECT ${COLUMNS(sql)} FROM gym_terminal_card_saves WHERE gym_id = ${s.gymId} AND request_key = ${s.requestKey}`;
  if (same !== undefined) return same.entry_id === s.entryId ? { kind: "same_press", save: toRow(same) } : { kind: "key_reused" };
  const waiting = await readOpenSaveOf(sql, s.gymId, s.entryId, s.environment);
  if (waiting !== null) return { kind: "person_waiting", save: waiting };
  return { kind: "terminal_busy" };
}

/** One of the record's saves. */
export async function readSave(sql: SqlOrTx, gymId: string, entryId: string, id: string): Promise<SaveRow | null> {
  const [row] = await sql<RawSave[]>`
    SELECT ${COLUMNS(sql)} FROM gym_terminal_card_saves WHERE id = ${id} AND gym_id = ${gymId} AND entry_id = ${entryId}`;
  return row === undefined ? null : toRow(row);
}

/** The save waiting for this record, if one is. */
export async function readOpenSaveOf(sql: SqlOrTx, gymId: string, entryId: string, environment: SquareEnvironment): Promise<SaveRow | null> {
  const [row] = await sql<RawSave[]>`
    SELECT ${COLUMNS(sql)} FROM gym_terminal_card_saves
    WHERE gym_id = ${gymId} AND entry_id = ${entryId} AND environment = ${environment} AND state IN ('agreeing','saving')`;
  return row === undefined ? null : toRow(row);
}

/** This request asks Square about the save, and nobody else does until `until` or `release`.
 *  Null while another request holds it, or once it is done. */
export async function claimCheck(sql: SqlOrTx, gymId: string, entryId: string, id: string, now: Date, until: Date): Promise<SaveRow | null> {
  const [row] = await sql<RawSave[]>`
    UPDATE gym_terminal_card_saves SET checking_until = ${until}, checked_at = ${now}
    WHERE id = ${id} AND gym_id = ${gymId} AND entry_id = ${entryId} AND state IN ('agreeing','saving')
      AND (checking_until IS NULL OR checking_until <= ${now})
    RETURNING ${COLUMNS(sql)}`;
  return row === undefined ? null : toRow(row);
}

/** The save keeping a Terminal busy, whichever gym on its Square account pressed it, held for
 *  `until` so it can be asked about: null when none, or while another request asks. Never shown
 *  to the press that found it: it is asked about with its own gym's token. */
export async function claimBlocking(sql: SqlOrTx, environment: SquareEnvironment, accountId: string, deviceId: string, now: Date, until: Date): Promise<SaveRow | null> {
  const [row] = await sql<RawSave[]>`
    UPDATE gym_terminal_card_saves SET checking_until = ${until}, checked_at = ${now}
    WHERE environment = ${environment} AND account_id = ${accountId} AND device_id = ${deviceId}
      AND state IN ('agreeing','saving') AND (checking_until IS NULL OR checking_until <= ${now})
    RETURNING ${COLUMNS(sql)}`;
  return row === undefined ? null : toRow(row);
}

/** Let go of the save, while this request still holds it (`until` is its own hold): a hold that
 *  ran out and was taken by another request is that one's. */
export async function release(sql: SqlOrTx, id: string, until: Date): Promise<void> {
  await sql`UPDATE gym_terminal_card_saves SET checking_until = NULL WHERE id = ${id} AND checking_until = ${until}`;
}

/** Staff pressed Cancel: kept on the save, so whichever request asks Square next stops the Terminal
 *  before anything else. False when there is no such save waiting. */
export async function wantCancel(sql: SqlOrTx, gymId: string, entryId: string, id: string, now: Date): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE gym_terminal_card_saves SET cancel_wanted_at = COALESCE(cancel_wanted_at, ${now})
    WHERE id = ${id} AND gym_id = ${gymId} AND entry_id = ${entryId} AND state IN ('agreeing','saving')
    RETURNING id`;
  return rows.length === 1;
}

/** Square refused Cancel as too late (the person confirmed on the Terminal): the card goes in,
 *  and the box says so instead of waiting for a stop that will not come. */
export async function cancelRefusedTooLate(sql: SqlOrTx, id: string): Promise<void> {
  await sql`UPDATE gym_terminal_card_saves SET cancel_too_late = true, cancel_wanted_at = NULL WHERE id = ${id} AND state = 'saving'`;
}

/** Whether Cancel has been pressed, read afresh: another request may have marked it meanwhile. */
export async function readCancelWanted(sql: SqlOrTx, id: string): Promise<Date | null> {
  const [row] = await sql<{ cancel_wanted_at: Date | null }[]>`SELECT cancel_wanted_at FROM gym_terminal_card_saves WHERE id = ${id}`;
  return row?.cancel_wanted_at ?? null;
}

/** Saves nobody has asked about for `idleMs`, for the worker: a page closed while it waited. */
export async function claimIdle(
  sql: Sql,
  environment: SquareEnvironment,
  now: Date,
  idleMs: number,
  until: Date,
  limit: number,
  gymIds: readonly string[] | null,
): Promise<SaveRow[]> {
  const rows = await sql<RawSave[]>`
    WITH due AS (
      SELECT id FROM gym_terminal_card_saves
      WHERE environment = ${environment} AND state IN ('agreeing','saving')
        AND checked_at <= ${new Date(now.getTime() - idleMs)}
        AND (checking_until IS NULL OR checking_until <= ${now})
        AND (${gymIds === null}::boolean OR gym_id = ANY(${[...(gymIds ?? [])]}::uuid[]))
      ORDER BY checked_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE gym_terminal_card_saves SET checking_until = ${until}, checked_at = ${now}
    WHERE id IN (SELECT id FROM due)
    RETURNING ${COLUMNS(sql)}`;
  return rows.map(toRow);
}

export async function setConfirmAction(sql: SqlOrTx, id: string, actionId: string): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE gym_terminal_card_saves SET confirm_action_id = ${actionId}
    WHERE id = ${id} AND state = 'agreeing' AND (confirm_action_id IS NULL OR confirm_action_id = ${actionId})
    RETURNING id`;
  return rows.length === 1;
}

export async function setPickedUp(sql: SqlOrTx, id: string): Promise<void> {
  await sql`UPDATE gym_terminal_card_saves SET picked_up = true WHERE id = ${id} AND NOT picked_up`;
}

/** The person tapped I agree: the card is asked for next, unless Cancel was pressed meanwhile. */
export async function toSaving(sql: SqlOrTx, id: string, agreedAt: Date): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE gym_terminal_card_saves SET state = 'saving', agreed_at = ${agreedAt}, picked_up = true
    WHERE id = ${id} AND state = 'agreeing' AND cancel_wanted_at IS NULL
    RETURNING id`;
  return rows.length === 1;
}

export async function setSaveAction(sql: SqlOrTx, id: string, actionId: string): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE gym_terminal_card_saves SET save_action_id = ${actionId}
    WHERE id = ${id} AND state = 'saving' AND (save_action_id IS NULL OR save_action_id = ${actionId})
    RETURNING id`;
  return rows.length === 1;
}

/** Done, from the state it was read in. False when it was not in that state any more. */
export async function finish(sql: SqlOrTx, id: string, from: "agreeing" | "saving", outcome: TerminalSaveOutcome, at: Date, cardId: string | null = null): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE gym_terminal_card_saves
    SET state = ${outcome === "saved" ? "saved" : "not_saved"}, outcome = ${outcome}, card_id = ${cardId},
        finished_at = ${at}, checking_until = NULL
    WHERE id = ${id} AND state = ${from}
    RETURNING id`;
  return rows.length === 1;
}

/** Under the gym's lock, before a card is kept: still waiting for the card. */
export async function lockSaving(tx: TransactionSql, id: string): Promise<SaveRow | null> {
  const [row] = await tx<RawSave[]>`
    SELECT ${COLUMNS(tx)} FROM gym_terminal_card_saves WHERE id = ${id} AND state = 'saving' FOR UPDATE`;
  return row === undefined ? null : toRow(row);
}

export async function readById(sql: SqlOrTx, id: string): Promise<SaveRow | null> {
  const [row] = await sql<RawSave[]>`SELECT ${COLUMNS(sql)} FROM gym_terminal_card_saves WHERE id = ${id}`;
  return row === undefined ? null : toRow(row);
}

/** Done saves are kept a day, for the page that asks how one ended. */
export async function forgetDone(sql: Sql, before: Date, gymIds: readonly string[] | null): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    DELETE FROM gym_terminal_card_saves
    WHERE finished_at IS NOT NULL AND finished_at < ${before}
      AND (${gymIds === null}::boolean OR gym_id = ANY(${[...(gymIds ?? [])]}::uuid[]))
    RETURNING id`;
  return rows.length;
}
