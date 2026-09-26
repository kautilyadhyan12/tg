// WHO "REMOVE ALL" REMOVES (Part 3 §9.8, §9.9; ROADMAP 3a-iv). Pure.
//
// The group is the members §9.7's marks put in it, worked out by the same function
// the preview and the list reads use (`membersAgainstNewList`), so the names a
// screen shows and the people a removal takes out cannot differ. Only paid seats
// are marked: the owner, staff and free places are never in either group.
//
// The digest names the exact set. A removal is refused unless the set worked out
// again under the gym's lock has the same digest, so nobody is removed whom staff
// were not shown — a count alone would pass when one member leaves and another
// joins between the look and the press.
import { createHash } from "node:crypto";
import type { MemberListUnlistedGroup } from "@app/shared";
import { membersAgainstNewList, type MemberOnList } from "./reconcile.js";

const byNameThenId = (a: MemberOnList, b: MemberOnList): number =>
  a.fullName < b.fullName ? -1 : a.fullName > b.fullName ? 1 : a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;

/** The gym's members in `group`, by name. `members` is every live member of the
 *  gym with whether a current record of the list reaches them. */
export function unlistedGroup<M extends MemberOnList>(members: readonly M[], hasList: boolean, group: MemberListUnlistedGroup): M[] {
  const seats = members.filter((member) => member.seatCounted);
  // The list after a removal is the list as it stands, so a member is on it exactly
  // when a current record reaches them now.
  const { marks } = membersAgainstNewList(seats, (member) => member.onList, hasList);
  const inGroup = new Set(marks.filter((mark) => mark.mark === group).map((mark) => mark.userId));
  return seats.filter((member) => inGroup.has(member.userId)).sort(byNameThenId);
}

/** The set's fingerprint: the gym, the group and the user ids in id order, so a
 *  renamed member does not change it and another gym's set can never match it. */
export function unlistedDigest(gymId: string, group: MemberListUnlistedGroup, userIds: readonly string[]): string {
  const ids = [...userIds].sort();
  return createHash("sha256").update([gymId, group, ...ids].join("\n"), "utf8").digest("hex");
}

/** The page after `cursor` (the last name and id shown), in the group's own order. */
export function unlistedPage<M extends { fullName: string; userId: string }>(
  people: readonly M[],
  cursor: { name: string; id: string } | null,
  size: number,
): { shown: M[]; last: M | undefined } {
  const after =
    cursor === null
      ? people
      : people.filter((person) => person.fullName > cursor.name || (person.fullName === cursor.name && person.userId > cursor.id));
  const shown = after.slice(0, size);
  return { shown, last: after.length > size ? shown[shown.length - 1] : undefined };
}
