// A GYM'S WAIVER (ROADMAP 3e-i; RULINGS 2026-10-08).
//
// THE RULE: a signature is written only for the wording the person was shown. The screen
// sends that wording's id back with the typed name; if the gym has saved new words or
// stopped using its waiver since, nothing is written and the person is told. Saving
// changed words makes a new numbered wording, so everybody is asked again and the earlier
// signatures stay with the words they were given for.
import {
  WAIVER_DESK_WORDS,
  WAIVER_WORDS,
  deskWaiverResponseSchema,
  gymWaiverResponseSchema,
  isUnder18,
  signAtDeskResponseSchema,
  myWaiverResponseSchema,
  signWaiverResponseSchema,
  type GymWaiverResponse,
  type MyWaiverResponse,
  type SignWaiverBody,
  type SignWaiverResponse,
  type WaiverToRead,
  type DeskSigned,
  type DeskWaiverResponse,
  type SignAtDeskBody,
  type SignAtDeskResponse,
} from "@app/shared";
import type { Sql } from "postgres";
import { dayInTz } from "../../gamification/streak.js";
import { getOrgById, insertAudit, isLiveMember, lockOrgRow } from "../repo.js";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import * as repo from "./repo.js";

export interface WaiverDeps {
  sql: Sql;
  now: () => Date;
}

type Limit = () => Promise<boolean>;

const TICK = "org.manage";
const notFound = (): OrgsError => new OrgsError(404, "not_found", WAIVER_WORDS.not_found);

export const toRead = (row: repo.WaiverRow): WaiverToRead => ({ id: row.id, version: row.version, text: row.body });

async function gymWaiver(sql: repo.SqlOrTx, gymId: string): Promise<GymWaiverResponse> {
  const latest = await repo.latestWaiver(sql, gymId);
  const inUse = latest !== null && latest.stoppedAt === null;
  const { people, signed, atDesk } = await repo.counts(sql, gymId, latest?.id ?? null);
  return gymWaiverResponseSchema.parse({
    waiver: latest === null ? null : { ...toRead(latest), savedAt: latest.savedAt.toISOString() },
    inUse,
    people,
    signed,
    atDesk,
  });
}

export async function getGymWaiver(deps: WaiverDeps, userId: string, gymId: string, limit: Limit): Promise<GymWaiverResponse | null> {
  await requirePrivilege(deps, gymId, userId, TICK);
  if (!(await limit())) return null;
  return await gymWaiver(deps.sql, gymId);
}

/** Saves the gym's words. The same words as the newest wording make no new one: they
 *  change nothing, or bring a stopped waiver back with its signatures. */
export async function saveGymWaiver(deps: WaiverDeps, userId: string, gymId: string, text: string, limit: Limit): Promise<GymWaiverResponse | null> {
  await requireWritablePrivilege(deps, gymId, userId, TICK);
  if (!(await limit())) return null;
  const at = deps.now();
  return await deps.sql.begin(async (tx) => {
    await lockOrgRow(tx, gymId);
    const latest = await repo.latestWaiver(tx, gymId);
    if (latest !== null && latest.body === text) {
      if (latest.stoppedAt !== null) {
        await repo.setStopped(tx, gymId, latest.id, null);
        await insertAudit(tx, { actorUserId: userId, gymId, action: "org.waiver_in_use_again", targetType: "gym_waiver", targetId: latest.id, meta: { version: String(latest.version) } });
      }
    } else {
      const saved = await repo.insertVersion(tx, { gymId, version: (latest?.version ?? 0) + 1, body: text, savedBy: userId, at });
      await insertAudit(tx, { actorUserId: userId, gymId, action: "org.waiver_saved", targetType: "gym_waiver", targetId: saved.id, meta: { version: String(saved.version) } });
    }
    return await gymWaiver(tx, gymId);
  });
}

/** Stops asking for the waiver. Its words and every signature are kept. Twice is once. */
export async function stopGymWaiver(deps: WaiverDeps, userId: string, gymId: string, limit: Limit): Promise<GymWaiverResponse | null> {
  await requireWritablePrivilege(deps, gymId, userId, TICK);
  if (!(await limit())) return null;
  const at = deps.now();
  return await deps.sql.begin(async (tx) => {
    await lockOrgRow(tx, gymId);
    const latest = await repo.latestWaiver(tx, gymId);
    if (latest !== null && latest.stoppedAt === null) {
      await repo.setStopped(tx, gymId, latest.id, at);
      await insertAudit(tx, { actorUserId: userId, gymId, action: "org.waiver_stopped", targetType: "gym_waiver", targetId: latest.id, meta: { version: String(latest.version) } });
    }
    return await gymWaiver(tx, gymId);
  });
}

/** The waiver a live app member of the gym is asked for, and their own signature of it;
 *  404 for everybody else. */
export async function getMyWaiver(deps: WaiverDeps, userId: string, gymId: string, limit: Limit): Promise<MyWaiverResponse | null> {
  const org = await getOrgById(deps.sql, gymId);
  if (org === null || !(await isLiveMember(deps.sql, gymId, userId))) throw notFound();
  if (!(await limit())) return null;
  const waiver = await repo.waiverInUse(deps.sql, gymId);
  const signed = waiver === null ? undefined : (await repo.signaturesOf(deps.sql, gymId, waiver.id, [userId])).get(userId);
  return myWaiverResponseSchema.parse({
    gymName: org.name,
    timezone: org.timezone,
    waiver: waiver === null ? null : toRead(waiver),
    signed: signed === undefined ? null : { name: signed.name, at: signed.at.toISOString() },
  });
}

/** A live member signs the wording they were shown. A second press answers with the first
 *  signature; a wording that is no longer the gym's is refused and nothing is written. */
export async function signMyWaiver(deps: WaiverDeps, userId: string, gymId: string, body: SignWaiverBody, limit: Limit): Promise<SignWaiverResponse | null> {
  const org = await getOrgById(deps.sql, gymId);
  if (org === null || !(await isLiveMember(deps.sql, gymId, userId))) throw notFound();
  if (!(await limit())) return null;
  const at = deps.now();
  await deps.sql.begin(async (tx) => {
    if (!(await repo.signAsMember(tx, { gymId, waiverId: body.waiverId, userId, name: body.name, at }))) return;
    await insertAudit(tx, { actorUserId: userId, gymId, action: "org.waiver_signed", targetType: "gym_waiver", targetId: body.waiverId, meta: { via: "app" } });
  });
  const waiver = await repo.waiverInUse(deps.sql, gymId);
  if (waiver === null) throw new OrgsError(409, "waiver_not_in_use", WAIVER_WORDS.waiver_not_in_use(org.name));
  if (waiver.id !== body.waiverId) throw new OrgsError(409, "waiver_changed", WAIVER_WORDS.waiver_changed(org.name));
  const signed = (await repo.signaturesOf(deps.sql, gymId, waiver.id, [userId])).get(userId);
  // The membership ended between the check above and the write.
  if (signed === undefined) throw notFound();
  return signWaiverResponseSchema.parse({ signed: { name: signed.name, at: signed.at.toISOString() } });
}

// ── AT THE DESK (3e-ii; spec Part 3 §10.10) ──
// THE WORST THING: a person shown as having signed when they did not — a signature on
// the wrong record, on words they were not shown, or a child's own. So the record is read
// with its gym and must be on the list today; the wording must still be the gym's; and a
// record whose date of birth says under 18 is signed only by a parent or guardian.

const DESK_TICK = "members.confirm";
const personNotFound = (): OrgsError => new OrgsError(404, "person_not_found", WAIVER_DESK_WORDS.person_not_found);

const toDeskSigned = (row: repo.DeskSignatureRow): DeskSigned => ({ name: row.name, signer: row.signer, at: row.at.toISOString(), by: row.by });

/** What the desk's box shows for one person on the gym's list. */
export async function getDeskWaiver(deps: WaiverDeps, userId: string, gymId: string, entryId: string, limit: Limit): Promise<DeskWaiverResponse | null> {
  const { org } = await requirePrivilege(deps, gymId, userId, DESK_TICK);
  if (!(await limit())) return null;
  const record = await repo.deskRecord(deps.sql, gymId, entryId);
  if (record === null) throw personNotFound();
  const waiver = await repo.waiverInUse(deps.sql, gymId);
  const signed = waiver === null ? undefined : (await repo.deskSignaturesOf(deps.sql, gymId, waiver.id, [entryId])).get(entryId);
  return deskWaiverResponseSchema.parse({
    gymName: org.name,
    personName: record.fullName,
    timezone: org.timezone,
    waiver: waiver === null ? null : toRead(waiver),
    minor: isUnder18(record.dateOfBirth, dayInTz(deps.now(), org.timezone)),
    signed: signed === undefined ? null : toDeskSigned(signed),
  });
}

/** The person, or their parent or guardian, signs on staff's screen. A second press
 *  answers with the first signature; a wording that is no longer the gym's is refused and
 *  nothing is written. */
export async function signAtDesk(
  deps: WaiverDeps,
  userId: string,
  gymId: string,
  entryId: string,
  body: SignAtDeskBody,
  limit: Limit,
): Promise<SignAtDeskResponse | null> {
  const { org } = await requireWritablePrivilege(deps, gymId, userId, DESK_TICK);
  if (!(await limit())) return null;
  const record = await repo.deskRecord(deps.sql, gymId, entryId);
  if (record === null) throw personNotFound();
  const at = deps.now();
  const minor = isUnder18(record.dateOfBirth, dayInTz(at, org.timezone));
  if (body.signer === "person" && minor === true) {
    throw new OrgsError(409, "guardian_needed", WAIVER_DESK_WORDS.guardian_needed(record.fullName));
  }
  // The record says they are an adult: they sign themselves, never a parent for them.
  if (body.signer === "guardian" && minor === false) {
    throw new OrgsError(409, "person_signs", WAIVER_DESK_WORDS.person_signs(record.fullName));
  }
  await deps.sql.begin(async (tx) => {
    const input = { gymId, waiverId: body.waiverId, entryId, dateOfBirth: record.dateOfBirth, signer: body.signer, name: body.name, witnessedBy: userId, at };
    if (!(await repo.signAtDesk(tx, input))) return;
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.waiver_signed",
      targetType: "gym_waiver",
      targetId: body.waiverId,
      meta: { via: "desk", signer: body.signer, entryId },
    });
  });
  const waiver = await repo.waiverInUse(deps.sql, gymId);
  if (waiver === null) throw new OrgsError(409, "waiver_not_in_use", WAIVER_WORDS.waiver_not_in_use(org.name));
  if (waiver.id !== body.waiverId) throw new OrgsError(409, "waiver_changed", WAIVER_WORDS.waiver_changed(org.name));
  const signed = (await repo.deskSignaturesOf(deps.sql, gymId, waiver.id, [entryId])).get(entryId);
  // Taken off the list, or its date of birth changed, between the read above and the write.
  if (signed === undefined) throw personNotFound();
  return signAtDeskResponseSchema.parse({ signed: toDeskSigned(signed) });
}
