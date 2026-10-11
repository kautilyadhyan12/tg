// WHOSE MEMBERSHIP IS OVER (ROADMAP 21c-ii, 21c-iii; spec Part 3 §16.9.4, §16.9.6).
//
// ONE answer for Reports' "left", the sign atop Members, the list that sign opens and the
// Remove pressed from it, so the pages cannot disagree: a current record the Members list
// reads as "Ended" or "Cancelled", with the day they stopped being a member.
//
// Somebody whose membership ended and whom the gym's own list now gives a later date is
// still a member: the gym renewed them in its own software, and the Memberships page is
// waiting for the press that renews them here (21c-i). Once the day the list covered has
// passed with nothing pressed, that day is the day they left.
import type { Sql, TransactionSql } from "postgres";
import { dayInTz } from "../../gamification/streak.js";
import { gymTimeZone, setMembershipEndedOn } from "../memberList/repo.js";
import { heldWithLeftOf, type HeldShown, type LeftWith } from "./onList.js";
import { renewedByTheList } from "./wordsRepo.js";

/** The list's rows for the records asked (every current one for null), and who of them is
 *  over. Inside the caller's snapshot or transaction. */
export async function heldAndOverIn(
  tx: TransactionSql,
  gymId: string,
  today: string,
  entryIds: readonly string[] | null,
): Promise<{ held: Map<string, HeldShown>; over: Map<string, LeftWith> }> {
  const { held, left } = await heldWithLeftOf(tx, gymId, today, entryIds);
  for (const kept of left.size > 0 ? await renewedByTheList(tx, gymId, today) : []) {
    const mine = left.get(kept.entryId);
    if (mine === undefined) continue;
    if (kept.waiting) left.delete(kept.entryId);
    else if (kept.covered < today && kept.covered > mine.on) left.set(kept.entryId, { ...mine, on: kept.covered });
  }
  return { held, over: left };
}

/** Who is over, of the records asked (every current one for null). On the pool its reads
 *  share one read-only snapshot; in a caller's transaction they run as they stand. */
export async function overNow(
  sql: Sql | TransactionSql,
  gymId: string,
  today: string,
  entryIds: readonly string[] | null,
): Promise<Map<string, LeftWith>> {
  if (entryIds !== null && entryIds.length === 0) return new Map();
  if ("savepoint" in sql) return (await heldAndOverIn(sql, gymId, today, entryIds)).over;
  return await sql.begin("isolation level repeatable read read only", async (tx) => (await heldAndOverIn(tx, gymId, today, entryIds)).over);
}

/** BEFORE RECORDS ARE MOVED TO PAST MEMBERS, in the same transaction: those whose
 *  membership was already over keep that day, which Reports counts them as left on. A
 *  month that has closed must not change because staff tidied up afterwards. Before, since
 *  the reads above answer for current records only. */
export async function keepLeftDays(tx: TransactionSql, gymId: string, entryIds: readonly string[], at: Date): Promise<void> {
  if (entryIds.length === 0) return;
  const today = dayInTz(at, await gymTimeZone(tx, gymId));
  const over = await overNow(tx, gymId, today, entryIds);
  await setMembershipEndedOn(
    tx,
    gymId,
    [...over].map(([id, left]) => ({ id, on: left.on })),
  );
}
