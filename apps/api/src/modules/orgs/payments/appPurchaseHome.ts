// WHERE A PURCHASE IN THE APP LANDS (ROADMAP 18k-iii-b; Kd, 2026-11-07: "yes go"). A member not on the gym's list yet is
// put on it by what they bought, and only once Square may have taken their money: paid, or ended in a way that needs a
// check, so staff read it on their page. Until then the gym's list is not touched. Under the gym's lock, which the caller
// holds.
//
// THE ONE RULE: the record is one that is certainly theirs. Their own record, the one their app is linked to (a past one
// comes back on the list, nobody else's app with it); else the record holding the very name, proved email and phone they
// bought with, where no other account holds it (Buy checked it as their own); else a new one made from them. Their app is
// linked to it only where it holds no record yet and no other account holds this one. A record another account holds is
// never changed by their purchase.
import { appPurchaseBoughtSchema, type AppPurchaseBuyer } from "@app/shared";
import type { TransactionSql } from "postgres";
import { lockedEntry } from "../memberships/heldRepo.js";
import { appMemberValues, currentContacts, holderOf, linkAppMember, placeOnList } from "../memberList/placeOnList.js";
import * as listRepo from "../memberList/repo.js";
import { insertAudit } from "../repo.js";
import type { AppPayRow } from "./appPaymentsRepo.js";

export interface Home {
  entryId: string;
  /** The buyer's own: no other live account holds it, so it is theirs to be given to. */
  theirs: boolean;
}

/** The live app accounts that hold this record, at most two. */
async function holdersOf(tx: TransactionSql, gymId: string, entryId: string): Promise<string[]> {
  const rows = await tx<{ user_id: string }[]>`
    SELECT o.user_id FROM gym_members o JOIN users u ON u.id = o.user_id AND u.status = 'active'
    WHERE o.gym_id = ${gymId} AND o.entry_id = ${entryId} AND o.removed_at IS NULL
    LIMIT 2`;
  return rows.map((r) => r.user_id);
}

const valuesOf = (buyer: AppPurchaseBuyer) => appMemberValues({ displayName: buyer.name, email: buyer.email, phone: buyer.phone });

/** The record holding the very name, proved email and phone a member not on the list buys with, and who holds it in the
 *  app; null where none does. Read only. */
export async function detailsRecordOf(tx: TransactionSql, gymId: string, buyer: AppPurchaseBuyer): Promise<{ id: string; former: boolean; holders: string[] } | null> {
  const found = await holderOf(tx, gymId, valuesOf(buyer));
  return found === null ? null : { ...found, holders: await holdersOf(tx, gymId, found.id) };
}

/** A past record back on the list by a purchase: on the list alone, as Put back on your list is, but nobody's app is given
 *  back with it. */
async function putBack(tx: TransactionSql, gymId: string, entryId: string, buyer: string | null, at: Date): Promise<void> {
  const stored = await listRepo.entryFor(tx, gymId, entryId);
  if (stored === null || !(await listRepo.setEntryFormer(tx, gymId, entryId, null))) return;
  await listRepo.stampListedByContact(tx, gymId, currentContacts({ values: stored.values, current: true }), [entryId], at);
  await listRepo.bumpListVersion(tx, gymId);
  await insertAudit(tx, { actorUserId: buyer, gymId, action: "org.member_list_entry_restored", targetType: "member_list_entry", targetId: entryId, meta: { via: "app_purchase" } });
}

/** The record this page's purchase lands on, put on the list if it is not; null where there is none to put it on. */
export async function homeOf(tx: TransactionSql, row: AppPayRow, at: Date): Promise<Home | null> {
  let entryId = row.entryId;
  if (entryId === null && row.openedBy !== null) {
    // Linked to a record since they pressed Buy (staff's Add to your list, say): that one.
    const [linked] = await tx<{ entry_id: string | null }[]>`
      SELECT entry_id FROM gym_members WHERE gym_id = ${row.gymId} AND user_id = ${row.openedBy} AND removed_at IS NULL`;
    entryId = linked?.entry_id ?? null;
  }
  if (entryId === null) {
    const parsed = appPurchaseBoughtSchema.safeParse(row.bought);
    const buyer = parsed.success ? parsed.data.buyer : null;
    if (buyer === null) return null;
    // A record holding their details that another account holds is that person's: neither revived nor given on (round one H4).
    const found = await detailsRecordOf(tx, row.gymId, buyer);
    if (found !== null && found.holders.some((holder) => holder !== row.openedBy)) return { entryId: found.id, theirs: false };
    const placed = await placeOnList(tx, { gymId: row.gymId, userId: row.openedBy, at, values: valuesOf(buyer), source: "member", revive: (stored) => stored.values, via: "app_purchase" });
    entryId = placed.entryId;
  }
  const entry = await lockedEntry(tx, row.gymId, entryId);
  if (entry === null) return null;
  // Found by their details, the record is theirs in the app too, where nobody holds it.
  if (row.openedBy !== null) await linkAppMember(tx, row.gymId, row.openedBy, entryId);
  const holders = await holdersOf(tx, row.gymId, entryId);
  // A record another account holds, or two do, is not the buyer's: it is not put back, and nothing is given on it.
  if (holders.length > 1 || (holders.length === 1 && holders[0] !== row.openedBy)) return { entryId, theirs: false };
  if (entry.past) await putBack(tx, row.gymId, entryId, row.openedBy, at);
  return { entryId, theirs: true };
}
