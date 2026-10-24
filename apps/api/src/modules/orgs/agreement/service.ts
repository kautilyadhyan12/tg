// A BUSINESS'S MEMBERSHIP AGREEMENTS (ROADMAP 18u-i, 18u-ii-a, 18u-ii-b; rulings/2026-10-23-18u-i.md).
//
// The business's main agreement is signed for every line of its price list, unless the line is
// ticked on another agreement of its own; a membership is signed with the one its line uses.
//
// THE WORST THING: somebody held to a price or terms they never saw. So a membership's details
// are worked out here from the membership as stored (`agreementFacts`), the screen sends back
// the key of the details it showed with the wording's id, and a signature is written only where
// the details worked out again have that same key and the wording is still the business's.
// What is kept and emailed is what the screen showed. Saving changed words makes a new numbered
// wording: memberships already signed keep the words they signed.
//
// Signing from afar (18u-ii-b): staff email the record's address a link; the page it opens reads
// the same details and words and signs by the same one statement, which also asks that the link
// still works. A link names one membership and nothing else: the token is the whole request.
import { createHash, randomBytes } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import {
  AGREEMENT_LINK_DAYS,
  AGREEMENT_WORDS,
  MAIN_AGREEMENT_NAME,
  agreementLinkResponseSchema,
  agreementLinkSignResponseSchema,
  sendAgreementLinkResponseSchema,
  type AgreementLinkResponse,
  type AgreementLinkSignBody,
  type AgreementLinkSignResponse,
  type SendAgreementLinkResponse,
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
  type SaveOtherAgreementBody,
  type SignMembershipAgreementBody,
  type SignMembershipAgreementResponse,
  type WaiverToRead,
} from "@app/shared";
import type { Sql } from "postgres";
import { sha256Hex } from "../../auth/tokens.js";
import { dayInTz } from "../../gamification/streak.js";
import { emailHmac } from "../invites/address.js";
import { gymNameForEmail } from "../invites/gymText.js";
import { suppressionsFor } from "../invites/repo.js";
import { readOwnHeld } from "../memberships/heldService.js";
import { getOrgById, insertAudit, lockOrgRow, type OrgRow } from "../repo.js";
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
  /** Our website's origin, for the link to sign. */
  webOrigin: string;
}

type Limit = () => Promise<boolean>;

const TICK = "org.manage";
/** Whoever gives memberships opens the box under one and hands the screen over. */
const DESK_TICK = "members.confirm";
const membershipNotFound = (): OrgsError => new OrgsError(404, "membership_not_found", AGREEMENT_WORDS.membership_not_found);

const toRead = (row: repo.AgreementRow): WaiverToRead => ({ id: row.id, version: row.version, text: row.body });

/** The key of a membership's details: what the screen sends back to sign them. */
export const factsKeyOf = (facts: readonly AgreementFact[]): string => createHash("sha256").update(JSON.stringify(facts), "utf8").digest("hex");

const saved = (row: repo.AgreementRow) => ({ ...toRead(row), savedAt: row.savedAt.toISOString() });

async function gymAgreement(sql: repo.SqlOrTx, gymId: string): Promise<GymAgreementResponse> {
  const main = await repo.mainDocumentId(sql, gymId);
  const [latest, signed, others, prices] = await Promise.all([
    main === null ? null : repo.latestOf(sql, gymId, main),
    main === null ? 0 : repo.signedCount(sql, gymId, main),
    repo.otherDocuments(sql, gymId),
    repo.agreementPrices(sql, gymId),
  ]);
  return gymAgreementResponseSchema.parse({
    agreement: latest === null ? null : saved(latest),
    inUse: latest !== null && latest.stoppedAt === null,
    signed,
    others: others.map((other) => ({ id: other.id, name: other.name, agreement: saved(other.latest), inUse: other.latest.stoppedAt === null, signed: other.signed })),
    prices,
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
      const documentId = await repo.ensureMainDocument(tx, gymId, at);
      const wording = await repo.insertVersion(tx, { gymId, documentId, version: (latest?.version ?? 0) + 1, body: text, savedBy: userId, at });
      await insertAudit(tx, { actorUserId: userId, gymId, action: "org.agreement_saved", targetType: "gym_agreement", targetId: wording.id, meta: { version: String(wording.version) } });
    }
    return await gymAgreement(tx, gymId);
  });
}

const priceNotFound = (): OrgsError => new OrgsError(409, "price_not_found", AGREEMENT_WORDS.price_not_found);

/** No other agreement takes the default agreement's own name. */
function refuseDefaultName(name: string): void {
  if (name.toLowerCase() === MAIN_AGREEMENT_NAME.toLowerCase()) throw new OrgsError(409, "name_taken", AGREEMENT_WORDS.name_taken(MAIN_AGREEMENT_NAME));
}

/** THE PRICE LIST AS THE SCREEN SHOWED IT IS THE PRICE LIST NOW, for every line this save touches:
 *  each line it saw uses the agreement it saw, and every line this agreement has or is given was
 *  on the screen. Otherwise another member of staff moved a line since, and saving the whole set
 *  this screen holds would silently undo it. */
async function requireSeen(tx: repo.SqlOrTx, gymId: string, documentId: string | null, body: SaveOtherAgreementBody): Promise<void> {
  const now = await repo.agreementPrices(tx, gymId);
  const seen = new Map(body.seen.map((line) => [line.id, line.agreementId]));
  const moved = now.some(
    (line) =>
      (seen.has(line.id) && seen.get(line.id) !== line.agreementId) ||
      (!seen.has(line.id) && ((documentId !== null && line.agreementId === documentId) || body.usedFor.includes(line.id))),
  );
  if (moved) throw new OrgsError(409, "prices_changed", AGREEMENT_WORDS.prices_changed);
}

const sameLines = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((id) => b.includes(id));

/** Adds another agreement, with its name, its words and the lines of the price list it is used
 *  for. The same name and words again (a second press) change nothing but the ticks. */
export async function addOtherAgreement(deps: AgreementDeps, userId: string, gymId: string, body: SaveOtherAgreementBody, limit: Limit): Promise<GymAgreementResponse | null> {
  await requireWritablePrivilege(deps, gymId, userId, TICK);
  if (!(await limit())) return null;
  const at = deps.now();
  refuseDefaultName(body.name);
  return await deps.sql.begin(async (tx) => {
    await lockOrgRow(tx, gymId);
    const named = await repo.documentNamed(tx, gymId, body.name);
    let documentId: string;
    if (named !== null) {
      const latest = await repo.latestOf(tx, gymId, named.id);
      if (latest === null || latest.body !== body.text) throw new OrgsError(409, "name_taken", AGREEMENT_WORDS.name_taken(named.name));
      // A second press of the same: what the first one saved is the answer.
      const has = (await repo.agreementPrices(tx, gymId)).filter((line) => line.agreementId === named.id).map((line) => line.id);
      if (sameLines(has, [...new Set(body.usedFor)])) return await gymAgreement(tx, gymId);
      await requireSeen(tx, gymId, named.id, body);
      documentId = named.id;
    } else {
      await requireSeen(tx, gymId, null, body);
      documentId = await repo.insertDocument(tx, gymId, body.name, at);
      const wording = await repo.insertVersion(tx, { gymId, documentId, version: 1, body: body.text, savedBy: userId, at });
      await insertAudit(tx, { actorUserId: userId, gymId, action: "org.agreement_added", targetType: "gym_agreement", targetId: wording.id, meta: { agreement: body.name } });
    }
    if (!(await repo.setUsedFor(tx, gymId, documentId, body.usedFor))) throw priceNotFound();
    return await gymAgreement(tx, gymId);
  });
}

/** Saves one of the business's other agreements: its name, its words (new words make a new
 *  numbered wording; the same words bring a stopped one back) and the lines it is used for. */
export async function saveOtherAgreement(
  deps: AgreementDeps,
  userId: string,
  gymId: string,
  documentId: string,
  body: SaveOtherAgreementBody,
  limit: Limit,
): Promise<GymAgreementResponse | null> {
  await requireWritablePrivilege(deps, gymId, userId, TICK);
  if (!(await limit())) return null;
  refuseDefaultName(body.name);
  const at = deps.now();
  return await deps.sql.begin(async (tx) => {
    await lockOrgRow(tx, gymId);
    const document = await repo.otherDocument(tx, gymId, documentId);
    if (document === null) throw new OrgsError(404, "not_found", AGREEMENT_WORDS.not_found);
    await requireSeen(tx, gymId, documentId, body);
    if (document.name !== body.name) {
      const named = await repo.documentNamed(tx, gymId, body.name);
      if (named !== null && named.id !== documentId) throw new OrgsError(409, "name_taken", AGREEMENT_WORDS.name_taken(named.name));
      await repo.renameDocument(tx, gymId, documentId, body.name);
    }
    const latest = await repo.latestOf(tx, gymId, documentId);
    if (latest !== null && latest.body === body.text) {
      if (latest.stoppedAt !== null) {
        await repo.setStopped(tx, gymId, latest.id, null);
        await insertAudit(tx, { actorUserId: userId, gymId, action: "org.agreement_in_use_again", targetType: "gym_agreement", targetId: latest.id, meta: { version: String(latest.version), agreement: body.name } });
      }
    } else {
      const wording = await repo.insertVersion(tx, { gymId, documentId, version: (latest?.version ?? 0) + 1, body: body.text, savedBy: userId, at });
      await insertAudit(tx, { actorUserId: userId, gymId, action: "org.agreement_saved", targetType: "gym_agreement", targetId: wording.id, meta: { version: String(wording.version), agreement: body.name } });
    }
    if (!(await repo.setUsedFor(tx, gymId, documentId, body.usedFor))) throw priceNotFound();
    return await gymAgreement(tx, gymId);
  });
}

/** Stops asking for one of the business's other agreements: the lines it is used for ask for
 *  none. Its words, its ticks and every signature are kept. Twice is once. */
export async function stopOtherAgreement(deps: AgreementDeps, userId: string, gymId: string, documentId: string, limit: Limit): Promise<GymAgreementResponse | null> {
  await requireWritablePrivilege(deps, gymId, userId, TICK);
  if (!(await limit())) return null;
  const at = deps.now();
  return await deps.sql.begin(async (tx) => {
    await lockOrgRow(tx, gymId);
    const document = await repo.otherDocument(tx, gymId, documentId);
    if (document === null) throw new OrgsError(404, "not_found", AGREEMENT_WORDS.not_found);
    const latest = await repo.latestOf(tx, gymId, documentId);
    if (latest !== null && latest.stoppedAt === null) {
      await repo.setStopped(tx, gymId, latest.id, at);
      await insertAudit(tx, { actorUserId: userId, gymId, action: "org.agreement_stopped", targetType: "gym_agreement", targetId: latest.id, meta: { version: String(latest.version), agreement: document.name } });
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
  record: { fullName: string; dateOfBirth: string | null; email: string | null; former: boolean };
  /** Its details now, or null where it is over, cancelled or frozen. */
  facts: AgreementFact[] | null;
  /** Its line of the price list's name; null with no details. */
  typeName: string | null;
}

/** A membership of this record, with its details worked out now from what is stored. */
async function current(deps: AgreementDeps, org: OrgRow, entryId: string, membershipId: string, today: string, opts: { former: boolean } = { former: false }): Promise<Current> {
  const record = await repo.membershipRecord(deps.sql, org.id, entryId, membershipId, opts);
  if (record === null) throw membershipNotFound();
  // A past member: their signed copy is read, and nothing is signed for them.
  if (record.former) return { record, facts: null, typeName: null };
  const [held, contact] = await Promise.all([readOwnHeld({ sql: deps.sql, now: deps.now }, org.id, entryId, today), repo.gymContact(deps.sql, org.id)]);
  const membership = held.memberships.find((m) => m.id === membershipId);
  if (membership === undefined) throw membershipNotFound();
  if (!agreementSignable(membership.view.status)) return { record, facts: null, typeName: null };
  const facts = agreementFacts({ gym: { name: org.name, ...contact }, personName: record.fullName, membership, firstBill: firstBillOf(membership.billing), taxIncluded: held.taxIncluded });
  return { record, facts, typeName: membership.typeName };
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
  agreementName: row.agreementName,
  via: row.via,
});

/** The agreement a membership's line of the price list asks for today, or null for none. */
async function askedOf(sql: repo.SqlOrTx, gymId: string, membershipId: string): Promise<{ row: repo.AgreementRow; name: string | null } | null> {
  const found = await repo.agreementForMembership(sql, gymId, membershipId);
  if (found === null || found.latest === null || found.latest.stoppedAt !== null) return null;
  return { row: found.latest, name: found.name };
}

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
  // A past member's page shows what they signed, and sends its copy again.
  const now = await current(deps, org, entryId, membershipId, today, { former: true });
  const [agreement, signed] = await Promise.all([askedOf(deps.sql, gymId, membershipId), repo.signatureOf(deps.sql, gymId, membershipId)]);
  return membershipAgreementResponseSchema.parse({
    gymName: org.name,
    personName: now.record.fullName,
    timezone: org.timezone,
    minor: isUnder18(now.record.dateOfBirth, today),
    agreement: agreement === null ? null : { ...toRead(agreement.row), name: agreement.name },
    facts: now.facts,
    factsKey: now.facts === null ? null : factsKeyOf(now.facts),
    signed: signed === null ? null : toSigned(signed),
    hasEmail: now.record.email !== null,
    past: now.record.former,
  });
}

/** Emails the copy of a signature, where the record has an address that takes our email. One
 *  copy a minute: a press while another sends it answers "sent" and sends nothing. */
async function sendCopy(deps: AgreementDeps, org: OrgRow, email: string | null, signed: repo.SignatureRow): Promise<AgreementEmailed> {
  if (email === null) return "no_email";
  const suppressed = deps.addressKey !== null && (await suppressionsFor(deps.sql, org.id, [emailHmac(deps.addressKey, email)])).size > 0;
  if (suppressed) return "blocked";
  const at = deps.now();
  const claim = await repo.claimCopy(deps.sql, org.id, signed.id, at);
  if (!claim.claimed) return "sent";
  try {
    await deps.email.sendAgreementCopy({
      to: email,
      gymName: gymNameForEmail(org.name),
      signedName: signed.name,
      byGuardian: signed.signer === "guardian",
      signedOn: dayWords(dayInTz(signed.at, org.timezone)),
      facts: signed.facts,
      text: signed.text,
      agreementName: signed.agreementName,
    });
  } catch (err) {
    deps.log.warn({ event: "agreement.copy_failed", gymId: org.id, errName: err instanceof Error ? err.name : typeof err }, "an agreement copy was not emailed");
    await repo.unclaimCopy(deps.sql, org.id, signed.id, at, claim.was);
    return "failed";
  }
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
  // Only the press that wrote the signature sends its copy: presses at once send one.
  let wrote = false;
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
    wrote = written !== null;
    if (written === null) {
      const agreement = await askedOf(deps.sql, gymId, membershipId);
      if (agreement === null) throw new OrgsError(409, "agreement_not_in_use", AGREEMENT_WORDS.agreement_not_in_use(org.name));
      if (agreement.row.id !== body.agreementId) throw new OrgsError(409, "agreement_changed", AGREEMENT_WORDS.agreement_changed(org.name));
    }
  }
  const signed = await repo.signatureOf(deps.sql, gymId, membershipId);
  // Taken off the list, its membership ended, or its date of birth changed, between the read and the write.
  if (signed === null) throw membershipNotFound();
  // A second press tells what became of the first one's copy, and sends nothing.
  const emailed: AgreementEmailed = wrote
    ? await sendCopy(deps, org, now.record.email, signed)
    : signed.emailedAt !== null
      ? "sent"
      : now.record.email === null
        ? "no_email"
        : "failed";
  const after = wrote && emailed === "sent" ? await repo.signatureOf(deps.sql, gymId, membershipId) : signed;
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
  // A past member's too: the signature is kept as the business's proof, and they may ask for it.
  const record = await repo.membershipRecord(deps.sql, gymId, entryId, membershipId, { former: true });
  if (record === null) throw membershipNotFound();
  const signed = await repo.signatureOf(deps.sql, gymId, membershipId);
  if (signed === null) throw new OrgsError(409, "not_signed", AGREEMENT_WORDS.not_signed);
  const emailed = await sendCopy(deps, org, record.email, signed);
  const after = await repo.signatureOf(deps.sql, gymId, membershipId);
  return emailAgreementCopyResponseSchema.parse({ emailed, emailedAt: after?.emailedAt?.toISOString() ?? null });
}

// ── Signing from afar: the emailed link (18u-ii-b) ──

const DAY_MS = 24 * 60 * 60 * 1000;
const linkNotValid = (): OrgsError => new OrgsError(404, "link_not_valid", AGREEMENT_WORDS.link_not_valid);
/** 32 random bytes, base64url: 43 characters (`agreementLinkTokenSchema`). */
const newToken = (): string => randomBytes(32).toString("base64url");

/** Emails the record's address a link to sign this membership's agreement. Sending again makes
 *  a new link and the old one stops working; a press while another sends answers "sent". */
export async function sendAgreementLink(
  deps: AgreementDeps,
  userId: string,
  gymId: string,
  entryId: string,
  membershipId: string,
  limit: Limit,
): Promise<SendAgreementLinkResponse | null> {
  const { org } = await requireWritablePrivilege(deps, gymId, userId, DESK_TICK);
  if (!(await limit())) return null;
  const at = deps.now();
  const now = await current(deps, org, entryId, membershipId, dayInTz(at, org.timezone));
  if (now.facts === null || now.typeName === null) throw new OrgsError(409, "membership_not_signable", AGREEMENT_WORDS.membership_not_signable);
  if ((await askedOf(deps.sql, gymId, membershipId)) === null) throw new OrgsError(409, "agreement_not_in_use", AGREEMENT_WORDS.agreement_not_in_use(org.name));
  if ((await repo.signatureOf(deps.sql, gymId, membershipId)) !== null) throw new OrgsError(409, "already_signed", AGREEMENT_WORDS.already_signed);
  const email = now.record.email;
  const answer = async (emailed: SendAgreementLinkResponse["emailed"]): Promise<SendAgreementLinkResponse> => {
    const link = (await repo.workingLinksOf(deps.sql, gymId, [membershipId], deps.now())).get(membershipId);
    return sendAgreementLinkResponseSchema.parse({ emailed, link: link === undefined ? null : { sentAt: link.sentAt.toISOString(), expiresAt: link.expiresAt.toISOString() } });
  };
  if (email === null) return await answer("no_email");
  const suppressed = deps.addressKey !== null && (await suppressionsFor(deps.sql, org.id, [emailHmac(deps.addressKey, email)])).size > 0;
  if (suppressed) return await answer("blocked");
  const token = newToken();
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(at.getTime() + AGREEMENT_LINK_DAYS * DAY_MS);
  if (!(await repo.claimLink(deps.sql, { gymId, membershipId, tokenHash, sentTo: email, sentBy: userId, at, expiresAt }))) return await answer("sent");
  try {
    await deps.email.sendAgreementLink({
      to: email,
      gymName: gymNameForEmail(org.name),
      membershipName: gymNameForEmail(now.typeName),
      worksUntil: dayWords(dayInTz(new Date(expiresAt.getTime() - 1), org.timezone)),
      signLink: `${deps.webOrigin}/sign-agreement#${token}`,
    });
  } catch (err) {
    deps.log.warn({ event: "agreement.link_failed", gymId, errName: err instanceof Error ? err.name : typeof err }, "an agreement link was not emailed");
    await repo.dropLink(deps.sql, gymId, tokenHash);
    return await answer("failed");
  }
  await deps.sql.begin(async (tx) => {
    await insertAudit(tx, { actorUserId: userId, gymId, action: "org.agreement_link_sent", targetType: "gym_held_membership", targetId: membershipId, meta: { entryId } });
  });
  return await answer("sent");
}

interface OpenLink {
  link: repo.LinkRow;
  org: OrgRow;
}

/** The link a token names, at a business still open. A token we did not make, one sent again
 *  since, one whose record left the list or changed its address: not valid, and nothing named. */
async function openLink(deps: AgreementDeps, tokenHash: string): Promise<OpenLink> {
  const link = await repo.linkByToken(deps.sql, tokenHash, deps.now());
  if (link === null) throw linkNotValid();
  const org = await getOrgById(deps.sql, link.gymId);
  if (org === null || org.status !== "active") throw linkNotValid();
  return { link, org };
}

/** What the link's page shows: the agreement to sign, that it is signed, or why it is closed. */
export async function readAgreementLink(deps: AgreementDeps, token: string): Promise<AgreementLinkResponse> {
  const { link, org } = await openLink(deps, sha256Hex(token));
  const gymName = org.name;
  if ((await repo.signatureOf(deps.sql, org.id, link.membershipId)) !== null) return agreementLinkResponseSchema.parse({ state: "signed", gymName });
  if (link.spent) return agreementLinkResponseSchema.parse({ state: "closed", gymName, reason: "expired" });
  const today = dayInTz(deps.now(), org.timezone);
  const now = await current(deps, org, link.entryId, link.membershipId, today);
  if (now.facts === null) return agreementLinkResponseSchema.parse({ state: "closed", gymName, reason: "not_signable" });
  const agreement = await askedOf(deps.sql, org.id, link.membershipId);
  if (agreement === null) return agreementLinkResponseSchema.parse({ state: "closed", gymName, reason: "not_in_use" });
  return agreementLinkResponseSchema.parse({
    state: "open",
    gymName,
    personName: now.record.fullName,
    minor: isUnder18(now.record.dateOfBirth, today),
    agreement: { ...toRead(agreement.row), name: agreement.name },
    facts: now.facts,
    factsKey: factsKeyOf(now.facts),
    expiresAt: link.expiresAt.toISOString(),
  });
}

/** The person, or their parent or guardian, signs from the link. The same rule as the desk's:
 *  only the details and the words the page showed; and the link must still work when it is
 *  written. A second press answers with the first signature's copy. */
export async function signByAgreementLink(deps: AgreementDeps, body: AgreementLinkSignBody): Promise<AgreementLinkSignResponse> {
  const tokenHash = sha256Hex(body.token);
  const { link, org } = await openLink(deps, tokenHash);
  const gymId = org.id;
  const existing = await repo.signatureOf(deps.sql, gymId, link.membershipId);
  const email = (await repo.membershipRecord(deps.sql, gymId, link.entryId, link.membershipId))?.email ?? null;
  if (existing !== null) {
    return agreementLinkSignResponseSchema.parse({ emailed: existing.emailedAt !== null ? "sent" : email === null ? "no_email" : "failed" });
  }
  if (link.spent) throw new OrgsError(410, "link_expired", AGREEMENT_WORDS.link_expired(org.name));
  const at = deps.now();
  const today = dayInTz(at, org.timezone);
  const now = await current(deps, org, link.entryId, link.membershipId, today);
  const minor = isUnder18(now.record.dateOfBirth, today);
  if (body.signer === "person" && minor === true) throw new OrgsError(409, "guardian_needed", WAIVER_DESK_WORDS.guardian_needed(now.record.fullName));
  if (body.signer === "guardian" && minor === false) throw new OrgsError(409, "person_signs", WAIVER_DESK_WORDS.person_signs(now.record.fullName));
  if (now.facts === null) throw new OrgsError(409, "membership_not_signable", AGREEMENT_WORDS.membership_not_signable);
  // THE RULE: only the details the page showed are signed and kept.
  if (factsKeyOf(now.facts) !== body.factsKey) throw new OrgsError(409, "facts_changed", AGREEMENT_WORDS.facts_changed);
  const facts = now.facts;
  const written = await deps.sql.begin(async (tx) => {
    // A link sent again waits here; once it has, this token names nothing and nothing is written.
    if (!(await repo.lockLink(tx, gymId, tokenHash))) return null;
    const input = {
      gymId,
      agreementId: body.agreementId,
      entryId: link.entryId,
      membershipId: link.membershipId,
      dateOfBirth: now.record.dateOfBirth,
      signer: body.signer,
      name: body.name,
      facts,
      witnessedBy: null,
      at,
      linkTokenHash: tokenHash,
    };
    const id = await repo.signAtDesk(tx, input);
    if (id !== null) {
      await repo.useLink(tx, gymId, tokenHash, at);
      await insertAudit(tx, { actorUserId: null, gymId, action: "org.agreement_signed_by_link", targetType: "gym_held_membership", targetId: link.membershipId, meta: { signer: body.signer, entryId: link.entryId } });
    }
    return id;
  });
  if (written === null) {
    const signed = await repo.signatureOf(deps.sql, gymId, link.membershipId);
    // Another press of this same link signed first.
    if (signed !== null) return agreementLinkSignResponseSchema.parse({ emailed: signed.emailedAt !== null ? "sent" : "failed" });
    const agreement = await askedOf(deps.sql, gymId, link.membershipId);
    if (agreement === null) throw new OrgsError(409, "agreement_not_in_use", AGREEMENT_WORDS.agreement_not_in_use(org.name));
    if (agreement.row.id !== body.agreementId) throw new OrgsError(409, "agreement_changed", AGREEMENT_WORDS.agreement_changed(org.name));
    // Sent again, used, run out or its address changed between the read and the write.
    throw linkNotValid();
  }
  const signed = await repo.signatureOf(deps.sql, gymId, link.membershipId);
  if (signed === null) throw linkNotValid();
  return agreementLinkSignResponseSchema.parse({ emailed: await sendCopy(deps, org, now.record.email, signed) });
}
