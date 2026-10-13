// A GYM'S WAIVER (ROADMAP 3e-i; RULINGS 2026-10-08).
//
// THE RULE: a signature is written only for the wording the person was shown. The screen
// sends that wording's id back with the typed name; if the gym has saved new words or
// stopped using its waiver since, nothing is written and the person is told. Saving
// changed words makes a new numbered wording, so everybody is asked again and the earlier
// signatures stay with the words they were given for.
import {
  WAIVER_WORDS,
  gymWaiverResponseSchema,
  myWaiverResponseSchema,
  signWaiverResponseSchema,
  type GymWaiverResponse,
  type MyWaiverResponse,
  type SignWaiverBody,
  type SignWaiverResponse,
  type WaiverToRead,
} from "@app/shared";
import type { Sql } from "postgres";
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
  const { people, signed } = await repo.counts(sql, gymId, latest?.id ?? null);
  return gymWaiverResponseSchema.parse({
    waiver: latest === null ? null : { ...toRead(latest), savedAt: latest.savedAt.toISOString() },
    inUse,
    people,
    signed,
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
