// WHO HAS A MEMBERSHIP AGREEMENT STILL TO SIGN, BY RECORD (ROADMAP 18u-ii-a). The one rule
// behind Members' "Agreement not signed" and its count.
//
// A current record has one to sign where it holds a membership running or still to start whose
// line of the price list asks for an agreement today, and nobody has signed it: the person's page
// says "Agreement not signed" under that membership by the same rule (`agreementSignable`).
import { agreementSignable, heldMembershipView } from "@app/shared";
import type { Sql } from "postgres";
import { unsignedAgreementHeld } from "../memberships/heldRepo.js";
import * as repo from "./repo.js";

/** The current records with an agreement to sign; null where the business asks for none. */
export async function agreementNotSignedRecords(sql: Sql, gymId: string, today: string): Promise<Set<string> | null> {
  if (!(await repo.anyInUse(sql, gymId))) return null;
  const records = new Set<string>();
  for (const row of await unsignedAgreementHeld(sql, gymId)) {
    if (agreementSignable(heldMembershipView(row.membership, today).status)) records.add(row.entryId);
  }
  return records;
}
