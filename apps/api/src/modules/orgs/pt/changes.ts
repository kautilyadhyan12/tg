// PERSONAL TRAINING SESSIONS WHEN A PERSON LEAVES (spec Part 3 §13.5; ROADMAP 17e-iv-a).
// A record taken off the gym's list, by whichever door, and a membership staff cancel end
// the coming sessions booked for them: each becomes cancelled, the trainer's time is free
// again, and a pack has its session back. A session that has started, took place or was
// cancelled late stays as it is.
//
// Every function that writes runs inside the caller's transaction, under the gym's row
// lock, which the caller has taken. A session already ended is not found again, so each
// pack session comes back once however often a change arrives.
import { createHash } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import { PT_SESSIONS_ENDING_MESSAGE, PT_SESSIONS_ENDING_SHOWN, PT_TRAINER_SESSIONS_ENDING_MESSAGE, type PtSessionsEnding } from "@app/shared";
import { givePackClassesBack } from "../memberships/heldRepo.js";
import * as repo from "./repo.js";

/** One value for exactly these sessions of this gym. */
export const sessionsMark = (gymId: string, ids: readonly string[]): string =>
  createHash("sha256")
    .update([gymId, "pt_sessions_ending", ...[...ids].sort()].join("\n"), "utf8")
    .digest("hex");

/** The box: null where nothing would end. */
export function endingView(gymId: string, rows: readonly repo.EndingSessionRow[]): PtSessionsEnding | null {
  if (rows.length === 0) return null;
  return {
    count: rows.length,
    packSessions: rows.filter((row) => row.packCharged).length,
    mark: sessionsMark(gymId, rows.map((row) => row.id)),
    sessions: rows.slice(0, PT_SESSIONS_ENDING_SHOWN).map((row) => ({
      id: row.id,
      personName: row.personName ?? "",
      trainerName: row.trainerName,
      localDate: row.localDate,
      localStartMinute: row.localStartMinute,
      minutes: row.minutes,
      packSession: row.packCharged,
    })),
  };
}

/** The sessions a change would end at `now`, as the box names them. */
export async function sessionsEndingFor(sql: Sql | TransactionSql, gymId: string, of: repo.EndingSessionsOf, now: Date): Promise<PtSessionsEnding | null> {
  return endingView(gymId, await repo.sessionsEnding(sql, gymId, of, now));
}

/** The refusal of a removal whose sessions the request has not confirmed: thrown before
 *  the first write, so nothing is done. */
export class PtSessionsEndAsk extends Error {
  readonly sessions: PtSessionsEnding;
  constructor(sessions: PtSessionsEnding, message: string = PT_SESSIONS_ENDING_MESSAGE) {
    super(message);
    this.name = "PtSessionsEndAsk";
    this.sessions = sessions;
  }
}

/** Ask first: throws unless nothing would end, or `confirmed` is the mark of exactly what
 *  would, worked out here under the gym's lock. Answers what the write that follows ends. */
export async function requireSessionsConfirmed(
  tx: TransactionSql,
  gymId: string,
  of: repo.EndingSessionsOf,
  now: Date,
  confirmed: string | null,
): Promise<PtSessionsEnding | null> {
  const ending = await sessionsEndingFor(tx, gymId, of, now);
  if (ending !== null && ending.mark !== confirmed) {
    throw new PtSessionsEndAsk(ending, "trainerId" in of ? PT_TRAINER_SESSIONS_ENDING_MESSAGE : PT_SESSIONS_ENDING_MESSAGE);
  }
  return ending;
}

/** What a removal's audit row says of the sessions it ended: counts, never a name. */
export const sessionsAuditMeta = (ending: Pick<PtSessionsEnding, "count" | "packSessions"> | null | undefined): Record<string, string> =>
  ending === null || ending === undefined ? {} : { ptSessionsEnded: String(ending.count), ptPackSessionsBack: String(ending.packSessions) };

export interface SessionsEnded {
  sessions: number;
  /** Sessions given back to packs. */
  packSessions: number;
}

/** The same counts for an audit row, of sessions already ended; nothing where none were. */
export const endedAuditMeta = (ended: SessionsEnded): Record<string, string> =>
  ended.sessions === 0 ? {} : { ptSessionsEnded: String(ended.sessions), ptPackSessionsBack: String(ended.packSessions) };

/** End them, and give each pack its sessions back. */
export async function endSessionsOf(tx: TransactionSql, gymId: string, of: repo.EndingSessionsOf, now: Date): Promise<SessionsEnded> {
  const ended = await repo.endSessions(tx, gymId, of, now);
  const back = new Map<string, number>();
  for (const { packMembershipId } of ended) {
    if (packMembershipId !== null) back.set(packMembershipId, (back.get(packMembershipId) ?? 0) + 1);
  }
  await givePackClassesBack(tx, gymId, back, now);
  return { sessions: ended.length, packSessions: [...back.values()].reduce((a, b) => a + b, 0) };
}

/** THESE RECORDS HAVE LEFT THE GYM'S LIST: called where a record becomes a past member,
 *  so no door can take somebody off and leave their sessions booked. */
export async function endLeaversSessions(tx: TransactionSql, gymId: string, entryIds: readonly string[], at: Date): Promise<SessionsEnded> {
  return await endSessionsOf(tx, gymId, { entryIds }, at);
}

/** THIS TRAINER HAS LEFT THE GYM'S STAFF (17e-iv-b): called where their staff row is
 *  deleted, so no door can take a trainer off the staff and leave people booked with
 *  nobody. Only the sessions booked WITH them; nobody else's trainer is read. */
export async function endTrainersSessions(tx: TransactionSql, gymId: string, trainerId: string, at: Date): Promise<SessionsEnded> {
  return await endSessionsOf(tx, gymId, { trainerId }, at);
}
