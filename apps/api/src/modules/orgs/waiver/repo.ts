// A gym's waiver and its signatures (ROADMAP 3e-i; migration 0103). Every statement
// carries the gym in its WHERE.
import { deskSignerSchema, type DeskSigner } from "@app/shared";
import type { Sql, TransactionSql } from "postgres";

export type SqlOrTx = Sql | TransactionSql;

export interface WaiverRow {
  id: string;
  version: number;
  body: string;
  savedAt: Date;
  stoppedAt: Date | null;
}

interface RawWaiver {
  id: string;
  version: number;
  body: string;
  saved_at: Date;
  stopped_at: Date | null;
}

const toRow = (raw: RawWaiver): WaiverRow => ({ id: raw.id, version: raw.version, body: raw.body, savedAt: raw.saved_at, stoppedAt: raw.stopped_at });

/** The newest wording the gym saved, in use or stopped; null where it never saved one. */
export async function latestWaiver(sql: SqlOrTx, gymId: string): Promise<WaiverRow | null> {
  const rows = await sql<RawWaiver[]>`
    SELECT id, version, body, saved_at, stopped_at FROM gym_waivers
    WHERE gym_id = ${gymId} ORDER BY version DESC LIMIT 1`;
  const raw = rows[0];
  return raw === undefined ? null : toRow(raw);
}

/** The waiver the gym asks people to sign today, or null. */
export async function waiverInUse(sql: SqlOrTx, gymId: string): Promise<WaiverRow | null> {
  const latest = await latestWaiver(sql, gymId);
  return latest === null || latest.stoppedAt !== null ? null : latest;
}

/** `waiverInUse` for several gyms at once. */
export async function waiversInUse(sql: SqlOrTx, gymIds: readonly string[]): Promise<Map<string, WaiverRow>> {
  if (gymIds.length === 0) return new Map();
  const rows = await sql<(RawWaiver & { gym_id: string })[]>`
    SELECT DISTINCT ON (gym_id) gym_id, id, version, body, saved_at, stopped_at FROM gym_waivers
    WHERE gym_id = ANY(${[...gymIds]}::uuid[]) ORDER BY gym_id, version DESC`;
  return new Map(rows.filter((raw) => raw.stopped_at === null).map((raw) => [raw.gym_id, toRow(raw)]));
}

/** A new wording, numbered after the newest. The caller holds the gym's row lock. */
export async function insertVersion(tx: TransactionSql, input: { gymId: string; version: number; body: string; savedBy: string; at: Date }): Promise<WaiverRow> {
  const rows = await tx<RawWaiver[]>`
    INSERT INTO gym_waivers (gym_id, version, body, saved_by, saved_at)
    VALUES (${input.gymId}, ${input.version}, ${input.body}, ${input.savedBy}, ${input.at})
    RETURNING id, version, body, saved_at, stopped_at`;
  const raw = rows[0];
  if (raw === undefined) throw new Error("a waiver was not written");
  return toRow(raw);
}

/** Stop asking for this wording (`at`), or ask for it again (`null`). */
export async function setStopped(tx: TransactionSql, gymId: string, waiverId: string, at: Date | null): Promise<void> {
  await tx`UPDATE gym_waivers SET stopped_at = ${at} WHERE gym_id = ${gymId} AND id = ${waiverId}`;
}

/** How many people use the app through the gym, how many of them signed this wording, and
 *  how many people on the gym's list signed it at the desk (3e-ii). */
export async function counts(sql: SqlOrTx, gymId: string, waiverId: string | null): Promise<{ people: number; signed: number; atDesk: number }> {
  const rows = await sql<{ people: number; signed: number; at_desk: number }[]>`
    SELECT count(*)::int AS people, count(s.id)::int AS signed,
      (SELECT count(*)::int FROM gym_waiver_desk_signatures d
       JOIN gym_member_list_entries e ON e.gym_id = d.gym_id AND e.id = d.entry_id AND e.former_at IS NULL
       WHERE d.gym_id = ${gymId} AND d.waiver_id = ${waiverId}::uuid) AS at_desk
    FROM gym_members m
    JOIN users u ON u.id = m.user_id AND u.status = 'active'
    LEFT JOIN gym_waiver_signatures s ON s.gym_id = m.gym_id AND s.waiver_id = ${waiverId}::uuid AND s.user_id = m.user_id
    WHERE m.gym_id = ${gymId} AND m.removed_at IS NULL`;
  const row = rows[0];
  return row === undefined ? { people: 0, signed: 0, atDesk: 0 } : { people: row.people, signed: row.signed, atDesk: row.at_desk };
}

export interface SignatureRow {
  userId: string;
  name: string;
  at: Date;
}

/** These people's signatures of this wording. */
export async function signaturesOf(sql: SqlOrTx, gymId: string, waiverId: string, userIds: readonly string[]): Promise<Map<string, SignatureRow>> {
  if (userIds.length === 0) return new Map();
  const rows = await sql<{ user_id: string; signed_name: string; signed_at: Date }[]>`
    SELECT user_id, signed_name, signed_at FROM gym_waiver_signatures
    WHERE gym_id = ${gymId} AND waiver_id = ${waiverId} AND user_id = ANY(${[...userIds]}::uuid[])`;
  return new Map(rows.map((row) => [row.user_id, { userId: row.user_id, name: row.signed_name, at: row.signed_at }]));
}

/** A live member signs the wording they were shown, in one statement: written only while
 *  that wording is the one the gym asks for and the person is in the gym. False where
 *  nothing was written, a second press of the same signature included. */
export async function signAsMember(sql: SqlOrTx, input: { gymId: string; waiverId: string; userId: string; name: string; at: Date }): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    INSERT INTO gym_waiver_signatures (gym_id, waiver_id, user_id, signed_name, signed_at)
    SELECT w.gym_id, w.id, ${input.userId}, ${input.name}, ${input.at}
    FROM gym_waivers w
    WHERE w.gym_id = ${input.gymId} AND w.id = ${input.waiverId} AND w.stopped_at IS NULL
      AND w.version = (SELECT max(version) FROM gym_waivers WHERE gym_id = ${input.gymId})
      AND EXISTS (
        SELECT 1 FROM gym_members m JOIN users u ON u.id = m.user_id
        WHERE m.gym_id = w.gym_id AND m.user_id = ${input.userId} AND m.removed_at IS NULL AND u.status = 'active'
      )
    ON CONFLICT (waiver_id, user_id) DO NOTHING
    RETURNING id`;
  return rows.length > 0;
}

/** The signature Join writes with the membership. The caller holds the gym's row lock and
 *  has read `waiverId` as the wording in use under it. A person who signed it before
 *  keeps that signature: false, and nothing is written. */
export async function signAtJoin(tx: TransactionSql, input: { gymId: string; waiverId: string; userId: string; name: string; at: Date }): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    INSERT INTO gym_waiver_signatures (gym_id, waiver_id, user_id, signed_name, signed_at)
    VALUES (${input.gymId}, ${input.waiverId}, ${input.userId}, ${input.name}, ${input.at})
    ON CONFLICT (waiver_id, user_id) DO NOTHING
    RETURNING id`;
  return rows.length > 0;
}

// ── AT THE DESK (3e-ii; migration 0106) ──
// A desk signature is a record's: the person on the gym's list, never an app account.

export interface DeskSignatureRow {
  entryId: string;
  name: string;
  signer: DeskSigner;
  at: Date;
  /** The member of staff who opened the screen, as the app names them; null where their
   *  account is gone. */
  by: string | null;
}

/** These current records' desk signatures of this wording; every current record's for null. */
export async function deskSignaturesOf(
  sql: SqlOrTx,
  gymId: string,
  waiverId: string,
  entryIds: readonly string[] | null,
): Promise<Map<string, DeskSignatureRow>> {
  if (entryIds !== null && entryIds.length === 0) return new Map();
  const ids = entryIds === null ? null : [...entryIds];
  const rows = await sql<{ entry_id: string; signed_name: string; signer: string; signed_at: Date; by: string | null }[]>`
    SELECT s.entry_id, s.signed_name, s.signer, s.signed_at, u.display_name AS by
    FROM gym_waiver_desk_signatures s
    JOIN gym_member_list_entries e ON e.gym_id = s.gym_id AND e.id = s.entry_id AND e.former_at IS NULL
    LEFT JOIN users u ON u.id = s.witnessed_by AND u.status = 'active'
    WHERE s.gym_id = ${gymId} AND s.waiver_id = ${waiverId}
      AND (${ids}::uuid[] IS NULL OR s.entry_id = ANY(${ids}::uuid[]))`;
  return new Map(
    rows.map((row) => [
      row.entry_id,
      // Text under a CHECK: parsed, so a signer this build does not know fails here.
      { entryId: row.entry_id, name: row.signed_name, signer: deskSignerSchema.parse(row.signer), at: row.signed_at, by: row.by },
    ]),
  );
}

/** Every app account that signed this wording at this gym. */
export async function appSignersOf(sql: SqlOrTx, gymId: string, waiverId: string): Promise<Set<string>> {
  const rows = await sql<{ user_id: string }[]>`
    SELECT user_id FROM gym_waiver_signatures WHERE gym_id = ${gymId} AND waiver_id = ${waiverId}`;
  return new Set(rows.map((row) => row.user_id));
}

/** A person signs at the desk, in one statement: written only while the wording shown is
 *  the one the gym asks for, the record is on the gym's list today, and its date of birth
 *  is still the one the under-18 check read. False where nothing was written, a second
 *  press of the same signature included. */
export async function signAtDesk(
  sql: SqlOrTx,
  input: { gymId: string; waiverId: string; entryId: string; dateOfBirth: string | null; signer: DeskSigner; name: string; witnessedBy: string; at: Date },
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    INSERT INTO gym_waiver_desk_signatures (gym_id, waiver_id, entry_id, signer, signed_name, witnessed_by, signed_at)
    SELECT w.gym_id, w.id, e.id, ${input.signer}, ${input.name}, ${input.witnessedBy}, ${input.at}
    FROM gym_waivers w
    JOIN gym_member_list_entries e ON e.gym_id = w.gym_id AND e.id = ${input.entryId} AND e.former_at IS NULL
    WHERE w.gym_id = ${input.gymId} AND w.id = ${input.waiverId} AND w.stopped_at IS NULL
      AND w.version = (SELECT max(version) FROM gym_waivers WHERE gym_id = ${input.gymId})
      AND e.date_of_birth IS NOT DISTINCT FROM ${input.dateOfBirth}::date
    ON CONFLICT (waiver_id, entry_id) DO NOTHING
    RETURNING id`;
  return rows.length > 0;
}

/** Two records joined: the kept one takes the other's desk signatures, of every wording it
 *  has none of its own for. The rest let go of their record when it is deleted and stay. */
export async function moveDeskSignatures(tx: TransactionSql, gymId: string, fromEntryId: string, toEntryId: string): Promise<void> {
  await tx`
    UPDATE gym_waiver_desk_signatures s SET entry_id = ${toEntryId}
    WHERE s.gym_id = ${gymId} AND s.entry_id = ${fromEntryId}
      AND NOT EXISTS (
        SELECT 1 FROM gym_waiver_desk_signatures k
        WHERE k.gym_id = ${gymId} AND k.waiver_id = s.waiver_id AND k.entry_id = ${toEntryId}
      )`;
}

/** A current record of the gym as the desk's box reads it: its name and date of birth. */
export async function deskRecord(sql: SqlOrTx, gymId: string, entryId: string): Promise<{ fullName: string; dateOfBirth: string | null } | null> {
  const rows = await sql<{ full_name: string; date_of_birth: string | null }[]>`
    SELECT full_name, date_of_birth::text AS date_of_birth FROM gym_member_list_entries
    WHERE gym_id = ${gymId} AND id = ${entryId} AND former_at IS NULL`;
  const row = rows[0];
  return row === undefined ? null : { fullName: row.full_name.trim(), dateOfBirth: row.date_of_birth };
}
