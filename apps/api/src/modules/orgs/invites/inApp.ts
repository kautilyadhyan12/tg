// Is an address already in the app at this gym? (Part 3 §9.7, §9.12.)
import type { Sql, TransactionSql } from "postgres";
import { membersAgainstList } from "../memberList/repo.js";

/** True when a member of the gym is matched (§9.7's own rule: the record they joined
 *  with, else proved address, else stated phone) to one of the current entries holding
 *  this address. The one-person invite and the worker both ask it this way; the press
 *  asks it for the whole list at once. */
export async function addressInApp(
  sql: Sql | TransactionSql,
  gymId: string,
  email: string,
  holders: readonly { entryId: string; phone: string | null }[],
): Promise<boolean> {
  if (holders.length === 0) return false;
  const ids = new Set(holders.map((holder) => holder.entryId));
  for (const phone of new Set(holders.map((holder) => holder.phone))) {
    const reached = await membersAgainstList(sql, gymId, { email, phone, entryIds: [...ids] });
    if (reached.some((member) => member.entryId !== null && ids.has(member.entryId))) return true;
  }
  return false;
}
