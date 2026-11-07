// A MEMBER SIGNS THEIR OWN MEMBERSHIP AGREEMENT IN THE APP (ROADMAP Stage 5 item 20c; spec Part 3 §14.8):
//   GET  /v1/orgs/:gymId/memberships/:membershipId/agreement/mine        the details, the words, or what was signed
//   POST /v1/orgs/:gymId/memberships/:membershipId/agreement/mine/sign   the member signs
// and what the Gym tab's card and My membership say about each membership's agreement.
//
// THE WORST THING: somebody held to a price or terms they never saw, or one member signing another person's
// membership. So only the reader's own record (one their account alone holds, with nobody paying for it) is read or
// signed, a membership of any other record is 404, and the signature is the desk's one statement (`signAtDesk`), which
// writes only the details whose key the screen sent back and only the newest words, and checks again, in the same
// statement, that the account still holds that record alone and nobody pays for it. Who has one to sign is Members'
// "Agreement not signed" rule (`unsignedAgreementHeld` and `agreementSignable`), the rule the booking stop reads.
import {
  AGREEMENT_WORDS,
  MY_AGREEMENTS_TO_SIGN_MAX,
  MY_AGREEMENT_WORDS,
  agreementSignable,
  heldMembershipView,
  isUnder18,
  myAgreementResponseSchema,
  signMyAgreementResponseSchema,
  type AtDeskWhy,
  type MyAgreementResponse,
  type MyAgreementToSign,
  type MyMembershipAgreement,
  type MySignedAgreement,
  type SignMyAgreementBody,
  type SignMyAgreementResponse,
} from "@app/shared";
import type { Sql } from "postgres";
import { dayInTz } from "../../gamification/streak.js";
import { unsignedAgreementHeld } from "../memberships/heldRepo.js";
import { readerOf } from "../myMembership/repo.js";
import { payerOf } from "../payers/repo.js";
import { getOrgById, insertAudit, type OrgRow } from "../repo.js";
import { OrgsError } from "../service.js";
import { factsKeyOf } from "./factsKey.js";
import * as repo from "./repo.js";
import { askedOf, current, sendCopy, type AgreementDeps, type Limit } from "./service.js";

const notFound = (): OrgsError => new OrgsError(404, "membership_not_found", AGREEMENT_WORDS.membership_not_found);

interface Own {
  org: OrgRow;
  entryId: string;
  today: string;
  /** Why it is signed at the front desk; null where the member signs in the app. */
  atDesk: AtDeskWhy | null;
}

/** The reader's own record at a business: the one their account alone holds. Null where they hold none, or share it. */
async function ownRecord(sql: Sql, gymId: string, userId: string, now: Date): Promise<Own | null> {
  const reader = await readerOf(sql, gymId, userId);
  if (reader === null || reader.entryId === null || reader.holders !== 1) return null;
  const [org, payer, dateOfBirth] = await Promise.all([getOrgById(sql, gymId), payerOf(sql, gymId, reader.entryId), repo.dateOfBirthOf(sql, gymId, reader.entryId)]);
  if (org === null || org.status !== "active" || dateOfBirth === undefined) return null;
  const today = dayInTz(now, org.timezone);
  const atDesk: AtDeskWhy | null = payer !== null ? "paid_by_other" : isUnder18(dateOfBirth, today) === true ? "minor" : null;
  return { org, entryId: reader.entryId, today, atDesk };
}

/** For each of these businesses the caller is a member of, their memberships whose agreement they may sign in the app
 *  now (the Gym tab's card). A business with nothing to sign is absent. */
export async function agreementsToSign(deps: Pick<AgreementDeps, "sql" | "now">, userId: string, gymIds: readonly string[]): Promise<Map<string, MyAgreementToSign[]>> {
  const found = new Map<string, MyAgreementToSign[]>();
  await Promise.all(
    gymIds.map(async (gymId) => {
      const own = await ownRecord(deps.sql, gymId, userId, deps.now());
      if (own === null || own.atDesk !== null) return;
      const rows = await unsignedAgreementHeld(deps.sql, gymId, [own.entryId]);
      const toSign = rows
        .filter((row) => agreementSignable(heldMembershipView(row.membership, own.today).status))
        .slice(0, MY_AGREEMENTS_TO_SIGN_MAX)
        .map((row) => ({ membershipId: row.id, name: row.typeName }));
      if (toSign.length > 0) found.set(gymId, toSign);
    }),
  );
  return found;
}

/** Each of the reader's own memberships' agreement on My membership. `memberships`: their ids and status today. */
export async function myMembershipAgreements(
  sql: Sql,
  gymId: string,
  timezone: string,
  memberships: readonly { id: string; signable: boolean }[],
  atDesk: AtDeskWhy | null,
): Promise<Map<string, MyMembershipAgreement>> {
  const ids = memberships.map((m) => m.id);
  const [asked, signed] = await Promise.all([repo.askedFor(sql, gymId, ids), repo.signedNamesOf(sql, gymId, ids)]);
  const states = new Map<string, MyMembershipAgreement>();
  for (const m of memberships) {
    const s = signed.get(m.id);
    if (s !== undefined) {
      states.set(m.id, { state: "signed", signedOn: dayInTz(s.at, timezone), signedName: s.name, view: atDesk !== "paid_by_other" });
    } else if (asked.has(m.id) && m.signable) {
      states.set(m.id, { state: atDesk === null ? "to_sign" : "at_desk", signedOn: null, signedName: null, view: false });
    }
  }
  return states;
}

/** Why the reader's own record signs at the front desk (My membership), worked out as `ownRecord` does. */
export async function atDeskOf(sql: Sql, gymId: string, entryId: string, today: string, paidByOther: boolean): Promise<AtDeskWhy | null> {
  if (paidByOther) return "paid_by_other";
  const dateOfBirth = await repo.dateOfBirthOf(sql, gymId, entryId);
  return dateOfBirth !== undefined && isUnder18(dateOfBirth, today) === true ? "minor" : null;
}

const signedOf = (row: repo.SignatureRow): MySignedAgreement => ({ name: row.name, at: row.at.toISOString(), text: row.text, facts: row.facts, agreementName: row.agreementName });

/** The reader's own record and this membership of it, or 404: another record's membership, a shared record, nobody's. */
async function ownMembership(deps: AgreementDeps, userId: string, gymId: string, membershipId: string): Promise<Own & { email: string | null }> {
  const own = await ownRecord(deps.sql, gymId, userId, deps.now());
  if (own === null) throw notFound();
  const record = await repo.membershipRecord(deps.sql, gymId, own.entryId, membershipId);
  if (record === null) throw notFound();
  return { ...own, email: record.email };
}

/** A second press: what became of the first one's copy, and nothing sent. */
const again = (signed: repo.SignatureRow, email: string | null): SignMyAgreementResponse =>
  signMyAgreementResponseSchema.parse({ signed: signedOf(signed), emailed: signed.emailedAt !== null ? "sent" : email === null ? "no_email" : "failed" });

export async function getMyAgreement(deps: AgreementDeps, userId: string, gymId: string, membershipId: string, limit: Limit): Promise<MyAgreementResponse | null> {
  const own = await ownMembership(deps, userId, gymId, membershipId);
  if (!(await limit())) return null;
  const base = { gymId, membershipId, gymName: own.org.name, timezone: own.org.timezone, why: null, agreement: null, facts: null, factsKey: null, signed: null };
  const [now, signed] = await Promise.all([current(deps, own.org, own.entryId, membershipId, own.today), repo.signatureOf(deps.sql, gymId, membershipId)]);
  const membershipName = now.typeName ?? (await membershipNameOf(deps.sql, gymId, membershipId));
  if (signed !== null) {
    // What was signed holds its price: somebody else's to read where they pay (16d).
    if (own.atDesk === "paid_by_other") return myAgreementResponseSchema.parse({ ...base, membershipName, state: "at_desk", why: own.atDesk });
    return myAgreementResponseSchema.parse({ ...base, membershipName, state: "signed", signed: signedOf(signed) });
  }
  const agreement = await askedOf(deps.sql, gymId, membershipId);
  if (agreement === null || now.facts === null) return myAgreementResponseSchema.parse({ ...base, membershipName, state: "none" });
  if (own.atDesk !== null) return myAgreementResponseSchema.parse({ ...base, membershipName, state: "at_desk", why: own.atDesk });
  return myAgreementResponseSchema.parse({
    ...base,
    membershipName,
    state: "to_sign",
    agreement: { id: agreement.row.id, version: agreement.row.version, text: agreement.row.body, name: agreement.name },
    facts: now.facts,
    factsKey: factsKeyOf(now.facts),
  });
}

async function membershipNameOf(sql: Sql, gymId: string, membershipId: string): Promise<string> {
  const rows = await sql<{ name: string }[]>`
    SELECT t.name FROM gym_held_memberships h JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
    WHERE h.gym_id = ${gymId} AND h.id = ${membershipId}`;
  return rows[0]?.name ?? "Membership";
}

/** The member signs. A second press answers with the first signature; new words or changed details are refused and
 *  nothing is written. */
export async function signMyAgreement(
  deps: AgreementDeps,
  userId: string,
  gymId: string,
  membershipId: string,
  body: SignMyAgreementBody,
  limit: Limit,
): Promise<SignMyAgreementResponse | null> {
  const own = await ownMembership(deps, userId, gymId, membershipId);
  if (!(await limit())) return null;
  const { org } = own;
  const existing = await repo.signatureOf(deps.sql, gymId, membershipId);
  if (existing !== null) {
    if (own.atDesk === "paid_by_other") throw new OrgsError(409, "agreement_at_desk", MY_AGREEMENT_WORDS.paid_by_other);
    return again(existing, own.email);
  }
  if (own.atDesk !== null) throw new OrgsError(409, "agreement_at_desk", MY_AGREEMENT_WORDS[own.atDesk]);
  const at = deps.now();
  const now = await current(deps, org, own.entryId, membershipId, own.today);
  if (now.facts === null) throw new OrgsError(409, "membership_not_signable", AGREEMENT_WORDS.membership_not_signable);
  // THE RULE: only the details the screen showed are signed and kept.
  if (factsKeyOf(now.facts) !== body.factsKey) throw new OrgsError(409, "facts_changed", AGREEMENT_WORDS.facts_changed);
  const facts = now.facts;
  const written = await deps.sql.begin(async (tx) => {
    const id = await repo.signAtDesk(tx, {
      gymId,
      agreementId: body.agreementId,
      entryId: own.entryId,
      membershipId,
      dateOfBirth: now.record.dateOfBirth,
      signer: "person",
      name: body.name,
      facts,
      witnessedBy: null,
      at,
      appUserId: userId,
    });
    if (id !== null) {
      await insertAudit(tx, { actorUserId: userId, gymId, action: "member.agreement_signed", targetType: "gym_held_membership", targetId: membershipId, meta: { entryId: own.entryId } });
    }
    return id;
  });
  if (written === null) {
    const signed = await repo.signatureOf(deps.sql, gymId, membershipId);
    // Another press of theirs signed first.
    if (signed !== null) return again(signed, own.email);
    const agreement = await askedOf(deps.sql, gymId, membershipId);
    if (agreement === null) throw new OrgsError(409, "agreement_not_in_use", AGREEMENT_WORDS.agreement_not_in_use(org.name));
    if (agreement.row.id !== body.agreementId) throw new OrgsError(409, "agreement_changed", AGREEMENT_WORDS.agreement_changed(org.name));
    // Taken off the list, given a payer, shared, or its date of birth changed, between the read and the write.
    throw notFound();
  }
  // Signed: staff with this person's page open see it at once.
  deps.news.tell(gymId, { what: "memberships", entryId: own.entryId });
  const signed = await repo.signatureOf(deps.sql, gymId, membershipId);
  if (signed === null) throw notFound();
  const emailed = await sendCopy(deps, org, now.record.email, signed);
  return signMyAgreementResponseSchema.parse({ signed: signedOf(signed), emailed });
}
