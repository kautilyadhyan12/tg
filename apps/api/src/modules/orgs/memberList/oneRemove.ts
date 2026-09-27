// ONE REMOVE (RULINGS 2026-09-27). Removing a member makes their record a past member AND
// ends their app, in one step, whichever door staff use: the member's page, or the people
// in the app. Every gym product read that day works this way (Wodify and Trainerize
// "Deactivate", Gymdesk "Cancel": the person moves to the inactive list and can no longer
// sign in).
//
// Nobody else is touched. The app is ended only for the people §9.7 matches to THIS record
// — never for a household member matched to their own record at the same address — and
// never for staff or a complimentary place (`closeMemberships`), whose app is staff's to
// manage. Runs inside the caller's transaction, under the gym's lock.
//
// A past member still in the app (a whole-list import moved their record, which never ends
// anybody's app) is removed from their page the same way: the record stays a past member
// and the app ends for whoever joined with it (Kd, 2026-09-27: one card in both places).
import type { TransactionSql } from "postgres";
import { withdrawForAccounts, withdrawForAddress } from "../invites/join.js";
import type { InviteSettings } from "../invites/settings.js";
import { insertAudit } from "../repo.js";
import * as repo from "./repo.js";

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
 *  ends, holding a paid place. A current record: those §9.7 matches to it. A past member's
 *  record: those who joined with it and are on the list through no other — a past record
 *  found only by a shared email can be a relative's, and is never enough. */
export function appPeopleIn(reached: readonly repo.MemberAgainstList[], entry: { id: string; formerAt: Date | null }): string[] {
  const theirs =
    entry.formerAt === null
      ? (member: repo.MemberAgainstList) => member.entryId === entry.id
      : (member: repo.MemberAgainstList) => member.joinedFormer && member.joinedEntryId === entry.id && !member.onList;
  return reached.filter((member) => theirs(member) && member.seatCounted).map((member) => member.userId);
}

/** `appPeopleIn`, read. BEFORE the record comes off: afterwards the match moves to another
 *  record or to none. */
export async function appPeopleOf(sql: repo.SqlOrTx, gymId: string, entry: repo.StoredEntry): Promise<string[]> {
  const reached = await repo.membersAgainstList(sql, gymId, { email: entry.values.email, phone: entry.values.phone, entryIds: [entry.id] });
  return appPeopleIn(reached, entry);
}

/** The current record §9.7 matches this person in the app to, or null. */
export async function recordOfMember(tx: TransactionSql, gymId: string, userId: string): Promise<string | null> {
  const reached = await repo.membersAgainstList(tx, gymId, { email: null, phone: null, userIds: [userId] });
  return reached.find((member) => member.userId === userId)?.entryId ?? null;
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
    return { kind: "removed_from_app", version, closed: await endApp(tx, facts, people) };
  }
  const moved = await repo.setEntryFormer(tx, gymId, entry.id, at);
  if (!moved) return { kind: "already_removed", version: (await repo.listState(tx, gymId))?.version ?? 0 };
  // The members this record reached were on the list, so they have been listed.
  await repo.stampListedByContact(tx, gymId, [{ email: entry.values.email, phone: entry.values.phone }], [entry.id], at);
  // Signing in with the address must not let anybody back in until staff invite again.
  await withdrawForAddress(tx, facts.settings, { gymId, email: entry.values.email, at });
  const closed = await endApp(tx, facts, people);
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

/** End these people's app with the gym, each audited, and stop their invitations. */
async function endApp(tx: TransactionSql, facts: RemoveFacts, people: readonly string[]): Promise<string[]> {
  const { gymId, at } = facts;
  const closed = await repo.closeMemberships(tx, gymId, [...people], at);
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
