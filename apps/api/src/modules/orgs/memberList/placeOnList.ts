// PUTTING A PERSON ON THE LIST, shared by Add member, Add to your list and a purchase in the app by somebody not on the
// list (ROADMAP 18k-iii-b). Every write runs in the caller's transaction, under the gym's lock.
//
// An app account is linked to a record only where the record is certainly theirs: the one made from their own name and
// proved email, or the one holding those very details. A phone they typed never links them (anybody can type one).
import type { TransactionSql } from "postgres";
import { MEMBER_LIST_MAX_NAME_CHARS, type MemberListEntryOutcome } from "@app/shared";
import { insertAudit } from "../repo.js";
import { changedFields, EMPTY_VALUES, type EntryValues } from "./byHand.js";
import { tidyCell } from "./cells.js";
import { cut, identityKey } from "./fields.js";
import { withoutCardNumbers } from "./neverKeep.js";
import * as repo from "./repo.js";
import { reviewAfterEdit } from "./review.js";

export interface Placed {
  outcome: MemberListEntryOutcome;
  entryId: string;
  version: number;
}

/** The contacts of every record that is current, before or after a change. */
export const currentContacts = (...records: { values: EntryValues; current: boolean }[]) =>
  records.filter((record) => record.current).map((record) => ({ email: record.values.email, phone: record.values.phone }));

export const listVersion = async (tx: TransactionSql, gymId: string): Promise<number> => (await repo.listState(tx, gymId))?.version ?? 0;

/** These values with the gym's next member number where they have none (5e-i), under the
 *  gym's lock. A next number too long to store leaves them without one. */
export async function numbered(tx: TransactionSql, gymId: string, values: EntryValues): Promise<EntryValues> {
  if (values.memberNumber !== null) return values;
  const given = await repo.giveMemberNumber(tx, gymId);
  return given === null ? values : { ...values, memberNumber: given };
}

/** The record that is this person: the one holding these very details, or, with no number
 *  typed, the one holding them with the number the app gave it (5e-i), so somebody typed
 *  again is found as they were before records had numbers. */
export async function holderOf(tx: TransactionSql, gymId: string, values: EntryValues): Promise<{ id: string; former: boolean } | null> {
  const exact = await repo.entryHolding(tx, gymId, identityKey(values));
  if (exact !== null || values.memberNumber !== null) return exact;
  return await repo.entryWithDetails(tx, gymId, values, null);
}

/** Put a person on the list whose key nobody holds, or bring back the FORMER record
 *  that holds it. Shared by "Add member" and "put an app member on the list". */
export async function placeOnList(
  tx: TransactionSql,
  input: { gymId: string; userId: string | null; at: Date; values: EntryValues; source: "typed" | "member"; revive: (stored: repo.StoredEntry) => EntryValues; via?: string },
): Promise<Placed> {
  const { gymId, values, at } = input;
  const holder = await holderOf(tx, gymId, values);
  if (holder !== null && !holder.former) return { outcome: "already_on_list", entryId: holder.id, version: await listVersion(tx, gymId) };

  let entryId: string;
  let written: EntryValues;
  if (holder === null) {
    // Somebody new with no number typed is given the gym's next one (5e-i). The record is
    // found by the details staff typed, above; its key holds the number it is given.
    written = await numbered(tx, gymId, values);
    entryId = await repo.insertEntry(tx, gymId, written, identityKey(written), input.source);
  } else {
    const stored = await repo.entryFor(tx, gymId, holder.id);
    if (stored === null) throw new Error(`member-list entry ${holder.id} vanished under the gym's lock`);
    // A past member coming back keeps their number, and is given one if they had none.
    written = await numbered(tx, gymId, input.revive(stored));
    entryId = holder.id;
    // Whatever the new values change, what an import found wrong there goes with it.
    const review = reviewAfterEdit(stored.review, changedFields(stored.values, written));
    await repo.writeEntry(tx, gymId, entryId, { values: written, identityKey: identityKey(written), handEdited: stored.handEdited, review, formerAt: null });
  }
  await repo.stampListedByContact(tx, gymId, currentContacts({ values: written, current: true }), [entryId], at);
  const version = await repo.bumpListVersion(tx, gymId);
  await insertAudit(tx, {
    actorUserId: input.userId,
    gymId,
    action: "org.member_list_entry_added",
    targetType: "member_list_entry",
    targetId: entryId,
    meta: { source: input.source, ...(holder === null ? {} : { revived: "true" }), ...(input.via === undefined ? {} : { via: input.via }) },
  });
  return { outcome: holder === null ? "added" : "revived", entryId, version };
}

/** An app member's own details as a record holds them: their name, proved email and the phone they gave (§9.9). */
export function appMemberValues(contact: { displayName: string; email: string | null; phone: string | null }): EntryValues {
  return {
    ...EMPTY_VALUES,
    fullName: cut(withoutCardNumbers(tidyCell(contact.displayName)).text, MEMBER_LIST_MAX_NAME_CHARS),
    email: contact.email,
    phone: contact.phone,
  };
}

/** Link this live app member to a record made or found from their own details, where their app holds no record yet and
 *  no other live account holds this one: a record two accounts hold is nobody's in the app. True where linked. */
export async function linkAppMember(tx: TransactionSql, gymId: string, memberUserId: string, entryId: string): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    UPDATE gym_members m SET entry_id = ${entryId}
    WHERE m.gym_id = ${gymId} AND m.user_id = ${memberUserId} AND m.removed_at IS NULL AND m.entry_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM gym_members o WHERE o.gym_id = m.gym_id AND o.entry_id = ${entryId} AND o.removed_at IS NULL AND o.user_id <> m.user_id)
    RETURNING m.id`;
  return rows.length === 1;
}
