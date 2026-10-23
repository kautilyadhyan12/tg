// A BUSINESS'S MEMBERSHIP AGREEMENT (ROADMAP 18u-i; rulings/2026-10-23-18u-i.md).
//
// THE WORST THING: somebody held to a price or terms they never saw. So a membership's details
// are worked out here from the membership as stored (`agreementFacts`), the screen sends back
// the key of the details it showed with the wording's id, and a signature is written only where
// the details worked out again have that same key and the wording is still the business's.
// What is kept and emailed is what the screen showed. Saving changed words makes a new numbered
// wording: memberships already signed keep the words they signed.
import { createHash } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import {
  AGREEMENT_WORDS,
  WAIVER_DESK_WORDS,
  agreementFacts,
  agreementSignable,
  dayWords,
  emailAgreementCopyResponseSchema,
  firstBillOf,
  gymAgreementResponseSchema,
  isUnder18,
  membershipAgreementResponseSchema,
  signMembershipAgreementResponseSchema,
  type AgreementEmailed,
  type AgreementFact,
  type AgreementSigned,
  type EmailAgreementCopyResponse,
  type GymAgreementResponse,
  type MembershipAgreementResponse,
  type SignMembershipAgreementBody,
  type SignMembershipAgreementResponse,
  type WaiverToRead,
} from "@app/shared";
import type { Sql } from "postgres";
import { dayInTz } from "../../gamification/streak.js";
import { emailHmac } from "../invites/address.js";
import { gymNameForEmail } from "../invites/gymText.js";
import { suppressionsFor } from "../invites/repo.js";
import { readOwnHeld } from "../memberships/heldService.js";
import { insertAudit, lockOrgRow, type OrgRow } from "../repo.js";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import type { AgreementEmailSender } from "./email.js";
import * as repo from "./repo.js";

export interface AgreementDeps {
  sql: Sql;
  now: () => Date;
  email: AgreementEmailSender;
  /** The key the suppression list's addresses are kept under; null where invitations are off. */
  addressKey: Buffer | null;
  log: FastifyBaseLogger;
}

type Limit = () => Promise<boolean>;

const TICK = "org.manage";
/** Whoever gives memberships opens the box under one and hands the screen over. */
const DESK_TICK = "members.confirm";
const membershipNotFound = (): OrgsError => new OrgsError(404, "membership_not_found", AGREEMENT_WORDS.membership_not_found);

const toRead = (row: repo.AgreementRow): WaiverToRead => ({ id: row.id, version: row.version, text: row.body });

/** The key of a membership's details: what the screen sends back to sign them. */
export const factsKeyOf = (facts: readonly AgreementFact[]): string => createHash("sha256").update(JSON.stringify(facts), "utf8").digest("hex");

async function gymAgreement(sql: repo.SqlOrTx, gymId: string): Promise<GymAgreementResponse> {
  const latest = await repo.latestAgreement(sql, gymId);
  return gymAgreementResponseSchema.parse({
    agreement: latest === null ? null : { ...toRead(latest), savedAt: latest.savedAt.toISOString() },
    inUse: latest !== null && latest.stoppedAt === null,
    signed: await repo.signedCount(sql, gymId, latest?.id ?? null),
  });
}

export async function getGymAgreement(deps: AgreementDeps, userId: string, gymId: string, limit: Limit): Promise<GymAgreementResponse | null> {
  await requirePrivilege(deps, gymId, userId, TICK);
  if (!(await limit())) return null;
  return await gymAgreement(deps.sql, gymId);
}

/** Saves the business's words. The same words as the newest wording make no new one: they
 *  change nothing, or bring a stopped agreement back. */
export async function saveGymAgreement(deps: AgreementDeps, userId: string, gymId: string, text: string, limit: Limit): Promise<GymAgreementResponse | null> {
  await requireWritablePrivilege(deps, gymId, userId, TICK);
  if (!(await limit())) return null;
  const at = deps.now();
  return await deps.sql.begin(async (tx) => {
    await lockOrgRow(tx, gymId);
    const latest = await repo.latestAgreement(tx, gymId);
    if (latest !== null && latest.body === text) {
      if (latest.stoppedAt !== null) {
        await repo.setStopped(tx, gymId, latest.id, null);
        await insertAudit(tx, { actorUserId: userId, gymId, action: "org.agreement_in_use_again", targetType: "gym_agreement", targetId: latest.id, meta: { version: String(latest.version) } });
      }
    } else {
      const saved = await repo.insertVersion(tx, { gymId, version: (latest?.version ?? 0) + 1, body: text, savedBy: userId, at });
      await insertAudit(tx, { actorUserId: userId, gymId, action: "org.agreement_saved", targetType: "gym_agreement", targetId: saved.id, meta: { version: String(saved.version) } });
    }
    return await gymAgreement(tx, gymId);
  });
}

/** Stops asking for the agreement. Its words and every signature are kept. Twice is once. */
export async function stopGymAgreement(deps: AgreementDeps, userId: string, gymId: string, limit: Limit): Promise<GymAgreementResponse | null> {
  await requireWritablePrivilege(deps, gymId, userId, TICK);
  if (!(await limit())) return null;
  const at = deps.now();
  return await deps.sql.begin(async (tx) => {
    await lockOrgRow(tx, gymId);
    const latest = await repo.latestAgreement(tx, gymId);
    if (latest !== null && latest.stoppedAt === null) {
      await repo.setStopped(tx, gymId, latest.id, at);
      await insertAudit(tx, { actorUserId: userId, gymId, action: "org.agreement_stopped", targetType: "gym_agreement", targetId: latest.id, meta: { version: String(latest.version) } });
    }
    return await gymAgreement(tx, gymId);
  });
}

// ── One membership, at the desk ──

interface Current {
  record: { fullName: string; dateOfBirth: string | null; email: string | null };
  /** Its details now, or null where it is over, cancelled or frozen. */
  facts: AgreementFact[] | null;
}

/** A membership of this record, with its details worked out now from what is stored. */
async function current(deps: AgreementDeps, org: OrgRow, entryId: string, membershipId: string, today: string): Promise<Current> {
  const record = await repo.membershipRecord(deps.sql, org.id, entryId, membershipId);
  if (record === null) throw membershipNotFound();
  const [held, contact] = await Promise.all([readOwnHeld({ sql: deps.sql, now: deps.now }, org.id, entryId, today), repo.gymContact(deps.sql, org.id)]);
  const membership = held.memberships.find((m) => m.id === membershipId);
  if (membership === undefined) throw membershipNotFound();
  if (!agreementSignable(membership.view.status)) return { record, facts: null };
  const facts = agreementFacts({ gym: { name: org.name, ...contact }, personName: record.fullName, membership, firstBill: firstBillOf(membership.billing), taxIncluded: held.taxIncluded });
  return { record, facts };
}

const toSigned = (row: repo.SignatureRow): AgreementSigned => ({
  name: row.name,
  signer: row.signer,
  at: row.at.toISOString(),
  by: row.by,
  version: row.version,
  text: row.text,
  facts: row.facts,
  emailedAt: row.emailedAt === null ? null : row.emailedAt.toISOString(),
});

export async function getMembershipAgreement(
  deps: AgreementDeps,
  userId: string,
  gymId: string,
  entryId: string,
  membershipId: string,
  limit: Limit,
): Promise<MembershipAgreementResponse | null> {
  const { org } = await requirePrivilege(deps, gymId, userId, DESK_TICK);
  if (!(await limit())) return null;
  const today = dayInTz(deps.now(), org.timezone);
  const now = await current(deps, org, entryId, membershipId, today);
  const [agreement, signed] = await Promise.all([repo.agreementInUse(deps.sql, gymId), repo.signatureOf(deps.sql, gymId, membershipId)]);
  return membershipAgreementResponseSchema.parse({
    gymName: org.name,
    personName: now.record.fullName,
    timezone: org.timezone,
    minor: isUnder18(now.record.dateOfBirth, today),
    agreement: agreement === null ? null : toRead(agreement),
    facts: now.facts,
    factsKey: now.facts === null ? null : factsKeyOf(now.facts),
    signed: signed === null ? null : toSigned(signed),
    hasEmail: now.record.email !== null,
  });
}

/** Emails the copy of a signature, where the record has an address that takes our email. */
async function sendCopy(deps: AgreementDeps, org: OrgRow, email: string | null, signed: repo.SignatureRow): Promise<AgreementEmailed> {
  if (email === null) return "no_email";
  const suppressed = deps.addressKey !== null && (await suppressionsFor(deps.sql, org.id, [emailHmac(deps.addressKey, email)])).size > 0;
  if (suppressed) return "failed";
  try {
    await deps.email.sendAgreementCopy({
      to: email,
      gymName: gymNameForEmail(org.name),
      signedName: signed.name,
      byGuardian: signed.signer === "guardian",
      signedOn: dayWords(dayInTz(signed.at, org.timezone)),
      facts: signed.facts,
      text: signed.text,
    });
  } catch (err) {
    deps.log.warn({ event: "agreement.copy_failed", gymId: org.id, errName: err instanceof Error ? err.name : typeof err }, "an agreement copy was not emailed");
    return "failed";
  }
  await repo.markEmailed(deps.sql, org.id, signed.id, deps.now());
  return "sent";
}

/** The person, or their parent or guardian, signs on staff's screen. A second press answers
 *  with the first signature; new words or changed details are refused and nothing is written. */
export async function signMembershipAgreement(
  deps: AgreementDeps,
  userId: string,
  gymId: string,
  entryId: string,
  membershipId: string,
  body: SignMembershipAgreementBody,
  limit: Limit,
): Promise<SignMembershipAgreementResponse | null> {
  const { org } = await requireWritablePrivilege(deps, gymId, userId, DESK_TICK);
  if (!(await limit())) return null;
  const at = deps.now();
  const today = dayInTz(at, org.timezone);
  const now = await current(deps, org, entryId, membershipId, today);
  const minor = isUnder18(now.record.dateOfBirth, today);
  if (body.signer === "person" && minor === true) throw new OrgsError(409, "guardian_needed", WAIVER_DESK_WORDS.guardian_needed(now.record.fullName));
  // The record says they are an adult: they sign themselves, never a parent for them.
  if (body.signer === "guardian" && minor === false) throw new OrgsError(409, "person_signs", WAIVER_DESK_WORDS.person_signs(now.record.fullName));
  const existing = await repo.signatureOf(deps.sql, gymId, membershipId);
  if (existing === null) {
    if (now.facts === null) throw new OrgsError(409, "membership_not_signable", AGREEMENT_WORDS.membership_not_signable);
    // THE RULE: only the details the screen showed are signed and kept.
    if (factsKeyOf(now.facts) !== body.factsKey) throw new OrgsError(409, "facts_changed", AGREEMENT_WORDS.facts_changed);
    const facts = now.facts;
    const written = await deps.sql.begin(async (tx) => {
      const input = { gymId, agreementId: body.agreementId, entryId, membershipId, dateOfBirth: now.record.dateOfBirth, signer: body.signer, name: body.name, facts, witnessedBy: userId, at };
      const id = await repo.signAtDesk(tx, input);
      if (id !== null) {
        await insertAudit(tx, { actorUserId: userId, gymId, action: "org.agreement_signed", targetType: "gym_held_membership", targetId: membershipId, meta: { signer: body.signer, entryId } });
      }
      return id;
    });
    if (written === null) {
      const agreement = await repo.agreementInUse(deps.sql, gymId);
      if (agreement === null) throw new OrgsError(409, "agreement_not_in_use", AGREEMENT_WORDS.agreement_not_in_use(org.name));
      if (agreement.id !== body.agreementId) throw new OrgsError(409, "agreement_changed", AGREEMENT_WORDS.agreement_changed(org.name));
    }
  }
  const signed = await repo.signatureOf(deps.sql, gymId, membershipId);
  // Taken off the list, its membership ended, or its date of birth changed, between the read and the write.
  if (signed === null) throw membershipNotFound();
  // A second press tells what became of the first one's copy, and sends nothing.
  const emailed: AgreementEmailed =
    existing !== null ? (signed.emailedAt !== null ? "sent" : now.record.email === null ? "no_email" : "failed") : await sendCopy(deps, org, now.record.email, signed);
  const after = emailed === "sent" && existing === null ? await repo.signatureOf(deps.sql, gymId, membershipId) : signed;
  return signMembershipAgreementResponseSchema.parse({ signed: toSigned(after ?? signed), emailed });
}

/** Emails the signed copy again, to the record's address today. */
export async function emailAgreementCopy(
  deps: AgreementDeps,
  userId: string,
  gymId: string,
  entryId: string,
  membershipId: string,
  limit: Limit,
): Promise<EmailAgreementCopyResponse | null> {
  const { org } = await requireWritablePrivilege(deps, gymId, userId, DESK_TICK);
  if (!(await limit())) return null;
  const record = await repo.membershipRecord(deps.sql, gymId, entryId, membershipId);
  if (record === null) throw membershipNotFound();
  const signed = await repo.signatureOf(deps.sql, gymId, membershipId);
  if (signed === null) throw new OrgsError(409, "not_signed", AGREEMENT_WORDS.not_signed);
  const emailed = await sendCopy(deps, org, record.email, signed);
  const after = await repo.signatureOf(deps.sql, gymId, membershipId);
  return emailAgreementCopyResponseSchema.parse({ emailed, emailedAt: after?.emailedAt?.toISOString() ?? null });
}
