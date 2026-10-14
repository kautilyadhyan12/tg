// WHO HAS SIGNED THE GYM'S WAIVER, BY RECORD (ROADMAP 3e-ii; spec Part 3 §10.10). The one
// rule behind Members' "Waiver not signed", its count, and the desk's choice to send
// somebody who has not signed to staff.
//
// A current record has signed the waiver the gym asks for today where it holds a desk
// signature of that wording, or where the person the record certainly is (`whose.ts`)
// signed it in the app. A signature on an email a family shares is nobody's record's: the
// list cannot say whose it is, so it signs no record.
import type { Sql } from "postgres";
import type { MemberAgainstList } from "../memberList/repo.js";
import { currentRecordOf } from "../memberList/whose.js";
import * as repo from "./repo.js";

export interface SignedRecords {
  waiverId: string;
  /** The current records that have signed it. */
  records: Set<string>;
  /** The app accounts that signed it. */
  accounts: Set<string>;
}

/** Which current records signed the waiver in use; null where the gym asks for none.
 *  `members` are the gym's live members against its list (`membersAgainstList`). */
export async function signedRecords(sql: Sql, gymId: string, members: readonly MemberAgainstList[]): Promise<SignedRecords | null> {
  const waiver = await repo.waiverInUse(sql, gymId);
  if (waiver === null) return null;
  const [desk, accounts] = await Promise.all([repo.deskSignaturesOf(sql, gymId, waiver.id, null), repo.appSignersOf(sql, gymId, waiver.id)]);
  const records = new Set(desk.keys());
  for (const member of members) {
    if (!accounts.has(member.userId)) continue;
    const own = currentRecordOf(member);
    if (own !== null) records.add(own);
  }
  return { waiverId: waiver.id, records, accounts };
}
