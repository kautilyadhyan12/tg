// WHO SIGNS THEIR MEMBERSHIP AGREEMENT IN THE APP (ROADMAP Stage 5 item 20c): the reader's own record, and what the Gym
// tab's card and My membership say about each of its memberships' agreements. Kept apart from `mine.ts`, which signs:
// the places read and My membership import this, and only repos, so that no import loop forms through the services.
import {
  MY_AGREEMENTS_TO_SIGN_MAX,
  agreementSignable,
  heldMembershipView,
  isUnder18,
  type AtDeskWhy,
  type MyAgreementToSign,
  type MyMembershipAgreement,
} from "@app/shared";
import type { Sql } from "postgres";
import { dayInTz } from "../../gamification/streak.js";
import { unsignedAgreementHeld } from "../memberships/heldRepo.js";
import { readerOf } from "../myMembership/repo.js";
import { payerOf } from "../payers/repo.js";
import { getOrgById, type OrgRow } from "../repo.js";
import * as repo from "./repo.js";

export interface Own {
  org: OrgRow;
  entryId: string;
  today: string;
  /** Why it is signed at the front desk; null where the member signs in the app. */
  atDesk: AtDeskWhy | null;
  /** The date of birth that decision read: the signature is written only while the record still has it. */
  dateOfBirth: string | null;
}

/** The reader's own record at a business: the one their account alone holds. Null where they hold none, or share it. */
export async function ownRecord(sql: Sql, gymId: string, userId: string, now: Date): Promise<Own | null> {
  const reader = await readerOf(sql, gymId, userId);
  if (reader === null || reader.entryId === null || reader.holders !== 1) return null;
  const [org, payer, dateOfBirth] = await Promise.all([getOrgById(sql, gymId), payerOf(sql, gymId, reader.entryId), repo.dateOfBirthOf(sql, gymId, reader.entryId)]);
  if (org === null || org.status !== "active" || dateOfBirth === undefined) return null;
  const today = dayInTz(now, org.timezone);
  const atDesk: AtDeskWhy | null = payer !== null ? "paid_by_other" : isUnder18(dateOfBirth, today) === true ? "minor" : null;
  return { org, entryId: reader.entryId, today, atDesk, dateOfBirth };
}

/** For each of these businesses the caller is a member of, their memberships whose agreement they may sign in the app
 *  now (the Gym tab's card). A business with nothing to sign is absent. */
export async function agreementsToSign(deps: { sql: Sql; now: () => Date }, userId: string, gymIds: readonly string[]): Promise<Map<string, MyAgreementToSign[]>> {
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
      states.set(m.id, { state: "signed", signedOn: dayInTz(s.at, timezone), signedName: s.name, view: atDesk !== "paid_by_other", why: null });
    } else if (asked.has(m.id) && m.signable) {
      states.set(m.id, { state: atDesk === null ? "to_sign" : "at_desk", signedOn: null, signedName: null, view: false, why: atDesk });
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
