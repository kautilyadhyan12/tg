// ONE REMOVE (RULINGS 2026-09-27). Removing a member makes their record a past member AND
// ends their app, in one step, whichever door staff use: the member's page, or the people
// in the app. Every gym product read that day works this way (Wodify and Trainerize
// "Deactivate", Gymdesk "Cancel": the person moves to the inactive list and can no longer
// sign in).
//
// Nobody else is touched. The app is ended only for the people whose record this certainly
// is (`whose.ts`) — never for a household member matched to their own record at the same
// address, never for someone on an email several records share when the list can't say
// which is theirs — and never for staff or a complimentary place (`closeMemberships`),
// whose app is staff's to manage. Each closed membership keeps the record it was removed
// with, which is what Put back gives back (RULINGS 2026-09-27: "Put back undoes both").
// Runs inside the caller's transaction, under the gym's lock.
//
// A past member still in the app (a whole-list import moved their record, which never ends
// anybody's app) is removed from their page the same way: the record stays a past member
// and the app ends for whoever joined with it (Kd, 2026-09-27: one card in both places).
import type { TransactionSql } from "postgres";
import { withdrawForAccounts, withdrawForAddress } from "../invites/join.js";
import type { InviteSettings } from "../invites/settings.js";
import { insertAudit } from "../repo.js";
import * as repo from "./repo.js";
import { currentRecordOf, pastRecordOf } from "./whose.js";

export interface RemoveFacts {
  gymId: string;
  actorUserId: string;
  at: Date;
  settings: InviteSettings | null;
}

export type RemoveRecordOutcome =
  | { kind: "removed"; version: number; closed: string[] }
  /** A past member's record: their app ended, the record was already off the list. */
  | { kind: "removed_from_app"; version: number; closed: string[] }
  | { kind: "already_removed"; version: number }
  /** The record reaches someone in the app and the caller may not remove people from it. */
  | { kind: "needs_app_privilege" };

/** Of the people `membersAgainstList` found for this record, those whose app its removal
 *  ends, holding a paid place: those whose record it certainly is (`whose.ts`). */
export function appPeopleIn(reached: readonly repo.MemberAgainstList[], entry: { id: string; formerAt: Date | null }): repo.MemberAgainstList[] {
  const recordOf = entry.formerAt === null ? currentRecordOf : pastRecordOf;
  return reached.filter((member) => recordOf(member) === entry.id && member.inMarks);
}

/** `appPeopleIn`, read. BEFORE the record comes off: afterwards the match moves to another
 *  record or to none. */
export async function appPeopleOf(sql: repo.SqlOrTx, gymId: string, entry: repo.StoredEntry): Promise<string[]> {
  const reached = await repo.membersAgainstList(sql, gymId, { email: entry.values.email, phone: entry.values.phone, entryIds: [entry.id] });
  return appPeopleIn(reached, entry).map((member) => member.userId);
}

/** The records that are certainly this person's: a current one, or failing that the past
 *  one they joined with. Null for each the list can't say. */
export async function recordsOfMember(tx: TransactionSql, gymId: string, userId: string): Promise<{ current: string | null; past: string | null }> {
  const reached = await repo.membersAgainstList(tx, gymId, { email: null, phone: null, userIds: [userId] });
  const member = reached.find((found) => found.userId === userId);
  return member === undefined ? { current: null, past: null } : { current: currentRecordOf(member), past: pastRecordOf(member) };
}

/** Take one record off the list; with `endApp`, also end the app of the people it
 *  reaches (`appPeopleOf`). `mayEndApp` is whether the caller holds `members.remove`. */
export async function removeRecordIn(
  tx: TransactionSql,
  facts: RemoveFacts,
  entry: repo.StoredEntry,
  options: { endApp: boolean; mayEndApp: boolean },
): Promise<RemoveRecordOutcome> {
  const { gymId, at } = facts;
  const people = options.endApp ? await appPeopleOf(tx, gymId, entry) : [];
  if (people.length > 0 && !options.mayEndApp) return { kind: "needs_app_privilege" };
  if (entry.formerAt !== null) {
    const version = (await repo.listState(tx, gymId))?.version ?? 0;
    if (people.length === 0) return { kind: "already_removed", version };
    return { kind: "removed_from_app", version, closed: await endApp(tx, facts, people, entry.id) };
  }
  const moved = await repo.setEntryFormer(tx, gymId, entry.id, at);
  if (!moved) return { kind: "already_removed", version: (await repo.listState(tx, gymId))?.version ?? 0 };
  // The members this record reached were on the list, so they have been listed.
  await repo.stampListedByContact(tx, gymId, [{ email: entry.values.email, phone: entry.values.phone }], [entry.id], at);
  // Signing in with the address must not let anybody back in until staff invite again.
  await withdrawForAddress(tx, facts.settings, { gymId, email: entry.values.email, at });
  const closed = await endApp(tx, facts, people, entry.id);
  const version = await repo.bumpListVersion(tx, gymId);
  await insertAudit(tx, {
    actorUserId: facts.actorUserId,
    gymId,
    action: "org.member_list_entry_taken_off",
    targetType: "member_list_entry",
    targetId: entry.id,
    meta: { removedFromApp: String(closed.length) },
  });
  return { kind: "removed", version, closed };
}

/** End these people's app with the gym, removed with this record, each audited, and stop
 *  their invitations. */
async function endApp(tx: TransactionSql, facts: RemoveFacts, people: readonly string[], entryId: string): Promise<string[]> {
  const { gymId, at } = facts;
  const closed = await repo.closeMemberships(
    tx,
    gymId,
    people.map((userId) => ({ userId, removedWith: entryId })),
    at,
  );
  for (const row of closed) {
    await insertAudit(tx, {
      actorUserId: facts.actorUserId,
      gymId,
      action: "org.member_removed",
      targetType: "gym_member",
      targetId: row.membershipId,
      meta: { removedUserId: row.userId, via: "list" },
    });
  }
  await withdrawForAccounts(tx, facts.settings, { gymId, userIds: closed.map((row) => row.userId), at });
  return closed.map((row) => row.userId);
}
