// REMOVE THE PEOPLE SELECTED (spec Part 3 §18.5, §18.6; ROADMAP 5b-v-b-ii). ONE REMOVE
// (RULINGS 2026-09-27, `oneRemove.ts`) for everyone ticked: each member's record becomes a
// past member and their app ends, in one step and one transaction. Two doors:
//
// - "Your list" and "Past members": the people are records. A record's person in the app
//   is the one whose record it certainly is (`whose.ts`), as removing one record decides.
// - "In the app": the people are accounts. Each one's own current record moves with them,
//   as the Remove on their panel does (`removeOrgMember`).
//
// Nothing happens to anyone who was not selected (CLAUDE.md §4). The box is worked out by
// the same pure function the press runs under the gym's lock, and the press carries the
// box's digest: if the answer has moved, nobody is removed and the new box is sent back.
import { createHash } from "node:crypto";
import {
  isLargeMemberListChange,
  MEMBER_LIST_BY_HAND_WORDS,
  type MemberListRemovePreviewRequest,
  type MemberListRemoveSelectedRequest,
  type MemberListGuard,
  type MemberRemoveKeptReason,
  type MemberRemoveLarge,
  type MemberRemovePerson,
  type MemberRemovePreview,
  type MemberRemovedSelected,
  type MemberRosterRemovePreviewRequest,
  type MemberRosterRemoveRequest,
} from "@app/shared";
import type { TransactionSql } from "postgres";
import { withdrawForAccounts, withdrawForAddresses } from "../invites/join.js";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import { bustAfterRemoval } from "./byHandService.js";
import * as repo from "./repo.js";
import { selectedIds } from "./selection.js";
import type { MemberListDeps } from "./service.js";
import { currentRecordOf, pastRecordOf } from "./whose.js";

/** A selected record, as much as the rule needs. */
export interface RecordBrief {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  former: boolean;
}

/** What the press does: the records moved to past members, and the people whose app
 *  ends with the record each is removed with (what Put back gives back). */
export interface RemovalPlan {
  preview: MemberRemovePreview;
  moveIds: string[];
  endApp: { userId: string; removedWith: string | null }[];
}

const byNameThenId = (a: MemberRemovePerson, b: MemberRemovePerson): number => {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  const ai = a.entryId ?? a.userId ?? "";
  const bi = b.entryId ?? b.userId ?? "";
  return ai < bi ? -1 : ai > bi ? 1 : 0;
};

/** `membersAgainstList` reads at most 20 records sharing one email (or phone); a family with
 *  that many may have more, so "every one of them selected" is never taken from it. */
const SHARED_CONTACT_READ_MAX = 20;

const KEPT_ORDER: readonly MemberRemoveKeptReason[] = ["staff", "own_record", "shared_email", "in_file", "same_record", "not_in_app", "gone"];

/** The box's digest: what the press would do, and nothing else — the records moved, and
 *  each person losing the app with the record they are removed with. */
export function removalDigest(gymId: string, moveIds: readonly string[], endApp: RemovalPlan["endApp"]): string {
  const moves = [...moveIds].sort().map((id) => `move:${id}`);
  const ends = endApp.map((person) => `end:${person.userId}:${person.removedWith ?? ""}`).sort();
  return createHash("sha256")
    .update([gymId, "remove_selected", ...moves, ...ends].join("\n"), "utf8")
    .digest("hex");
}

/** Whether removing `moving` of `of` needs its own tick, the app's line before the list's. */
export function largeRemoval(moving: number, endingApp: number, scale: { listCurrent: number; seats: number }): MemberRemoveLarge | null {
  if (isLargeMemberListChange(endingApp, scale.seats)) return { kind: "app", removing: endingApp, of: scale.seats };
  if (isLargeMemberListChange(moving, scale.listCurrent)) return { kind: "list", removing: moving, of: scale.listCurrent };
  return null;
}

function finish(
  gymId: string,
  selected: number,
  move: MemberRemovePerson[],
  ends: { person: MemberRemovePerson; removedWith: string | null }[],
  kept: Map<MemberRemoveKeptReason, MemberRemovePerson[]>,
  scale: { listCurrent: number; seats: number },
  movingNotInApp: number,
): RemovalPlan {
  move.sort(byNameThenId);
  ends.sort((a, b) => byNameThenId(a.person, b.person));
  const moveIds = move.flatMap((person) => (person.entryId === null ? [] : [person.entryId]));
  const endApp = ends.flatMap(({ person, removedWith }) => (person.userId === null ? [] : [{ userId: person.userId, removedWith }]));
  return {
    moveIds,
    endApp,
    preview: {
      selected,
      move,
      endApp: ends.map(({ person }) => person),
      kept: KEPT_ORDER.flatMap((reason) => {
        const people = kept.get(reason);
        return people === undefined || people.length === 0 ? [] : [{ reason, people: [...people].sort(byNameThenId) }];
      }),
      movingNotInApp,
      large: largeRemoval(moveIds.length, endApp.length, scale),
      digest: removalDigest(gymId, moveIds, endApp),
    },
  };
}

const keep = (kept: Map<MemberRemoveKeptReason, MemberRemovePerson[]>, reason: MemberRemoveKeptReason, person: MemberRemovePerson): void => {
  const list = kept.get(reason);
  if (list === undefined) kept.set(reason, [person]);
  else list.push(person);
};

/** THE RULE FOR RECORDS SELECTED ("Your list", "Past members"). Pure.
 *
 *  Every current record selected moves to past members. Someone in the app loses it when
 *  the record that is certainly theirs is selected — their current one, or, with none,
 *  the past one they joined with — or when they share an email with several records the
 *  list can't tell apart and EVERY one of them is selected (whichever is theirs, it was
 *  ticked; removing them one by one ends the app on the last). The owner, staff and a
 *  complimentary place never lose it here. Anyone else a moved record's email or phone
 *  reaches is named as keeping the app, with why. `members` must hold everyone the
 *  selected records reach. */
export function recordRemovalPlan(input: {
  gymId: string;
  selectedIds: readonly string[];
  records: readonly RecordBrief[];
  members: readonly repo.MemberAgainstList[];
  scale: { listCurrent: number; seats: number };
}): RemovalPlan {
  const found = new Map(input.records.map((record) => [record.id, record]));
  const current = new Set(input.records.filter((record) => !record.former).map((record) => record.id));
  const past = new Set(input.records.filter((record) => record.former).map((record) => record.id));
  const kept = new Map<MemberRemoveKeptReason, MemberRemovePerson[]>();
  const asked = [...new Set(input.selectedIds)];
  for (const id of asked) {
    if (!found.has(id)) keep(kept, "gone", { name: "", entryId: id, userId: null });
  }
  const move = input.records.filter((record) => !record.former).map((record) => ({ name: record.fullName, entryId: record.id, userId: null }));
  const emails = new Set(input.records.filter((record) => !record.former && record.email !== null).map((record) => (record.email ?? "").toLowerCase()));
  const phones = new Set(input.records.filter((record) => !record.former && record.phone !== null).map((record) => record.phone ?? ""));

  const ends: { person: MemberRemovePerson; removedWith: string | null }[] = [];
  const pastReached = new Set<string>();
  // The moving records somebody in the app uses: theirs for certain, or on a family's
  // shared email in the app. The rest are "not in the app" in the box's own words.
  const used = new Set<string>();
  for (const member of input.members) {
    const own = currentRecordOf(member);
    if (own !== null) used.add(own);
    for (const record of member.unsure?.records ?? []) used.add(record.id);
  }
  for (const member of input.members) {
    const own = currentRecordOf(member);
    const pastOwn = pastRecordOf(member);
    const unsure = member.unsure?.records ?? [];
    let removedWith: string | null = null;
    if (own !== null && current.has(own)) removedWith = own;
    else if (own === null && unsure.length > 0 && unsure.length < SHARED_CONTACT_READ_MAX && unsure.every((record) => current.has(record.id))) {
      removedWith = unsure[0]?.id ?? null;
    }
    else if (own === null && unsure.length === 0 && pastOwn !== null && past.has(pastOwn)) removedWith = pastOwn;

    const person: MemberRemovePerson = { name: member.fullName, entryId: removedWith, userId: member.userId };
    if (removedWith !== null) {
      if (past.has(removedWith)) pastReached.add(removedWith);
      if (member.seatCounted) ends.push({ person, removedWith });
      else keep(kept, "staff", person);
      continue;
    }
    // Joined with a past record ticked, and on the list again through another: in the app,
    // and it stays theirs.
    if (member.joinedEntryId !== null && past.has(member.joinedEntryId)) {
      pastReached.add(member.joinedEntryId);
      if (own !== null) keep(kept, "own_record", { ...person, entryId: own });
      else if (unsure.length > 0) keep(kept, "shared_email", { ...person, entryId: null });
      continue;
    }
    // Not theirs for certain. Named only when a record being moved reaches them.
    const reached =
      unsure.some((record) => current.has(record.id)) ||
      (member.email !== null && emails.has(member.email.toLowerCase())) ||
      (member.statedPhone !== null && phones.has(member.statedPhone));
    if (!reached) continue;
    if (unsure.some((record) => current.has(record.id))) keep(kept, "shared_email", { ...person, entryId: null });
    else if (own !== null) keep(kept, "own_record", { ...person, entryId: own });
  }
  for (const id of past) {
    if (!pastReached.has(id)) keep(kept, "not_in_app", { name: found.get(id)?.fullName ?? "", entryId: id, userId: null });
  }
  const movingNotInApp = move.filter((person) => !used.has(person.entryId)).length;
  return finish(input.gymId, asked.length, move, ends, kept, input.scale, movingNotInApp);
}

/** THE RULE FOR PEOPLE TICKED ON "IN THE APP". Pure.
 *
 *  Each ticked person with a paid place loses the app; the current record that is
 *  certainly theirs moves to past members with them (none for a family's shared email
 *  the list can't place), and they are removed with it, or with the past record they
 *  joined with. The owner, staff and a complimentary place are managed under Staff.
 *  Only those ticked are looked up in `members`, whoever else it holds. Someone NOT ticked
 *  whose record is the same as a ticked person's (two accounts on one record) keeps the
 *  app and is named: their record moves with the ticked person. `reached` is everyone in
 *  the app the moving records reach. */
export function rosterRemovalPlan(input: {
  gymId: string;
  userIds: readonly string[];
  members: readonly repo.MemberAgainstList[];
  reached?: readonly repo.MemberAgainstList[];
  scale: { listCurrent: number; seats: number };
}): RemovalPlan {
  const live = new Map(input.members.map((member) => [member.userId, member]));
  const kept = new Map<MemberRemoveKeptReason, MemberRemovePerson[]>();
  const move: MemberRemovePerson[] = [];
  const ends: { person: MemberRemovePerson; removedWith: string | null }[] = [];
  const asked = [...new Set(input.userIds)];
  for (const userId of asked) {
    const member = live.get(userId);
    if (member === undefined) {
      keep(kept, "gone", { name: "", entryId: null, userId });
      continue;
    }
    const own = currentRecordOf(member);
    if (!member.seatCounted) {
      keep(kept, "staff", { name: member.fullName, entryId: null, userId });
      continue;
    }
    // Two accounts can be one record's (joined with it, and signed up under its name).
    if (own !== null && !move.some((person) => person.entryId === own)) {
      move.push({ name: member.entryFullName ?? member.fullName, entryId: own, userId: null });
    }
    const removedWith = own ?? pastRecordOf(member);
    ends.push({ person: { name: member.fullName, entryId: removedWith, userId }, removedWith });
  }
  const ticked = new Set(asked);
  const moving = new Set(move.map((person) => person.entryId));
  for (const other of input.reached ?? []) {
    const own = currentRecordOf(other);
    if (!ticked.has(other.userId) && own !== null && moving.has(own)) {
      keep(kept, "same_record", { name: other.fullName, entryId: own, userId: other.userId });
    }
  }
  return finish(input.gymId, asked.length, move, ends, kept, input.scale, 0);
}

/** What an import's file writes (`Reconciled.written`): folded emails and phones, old and
 *  new, and the records it changes. */
export interface FileWrites {
  emails: ReadonlySet<string>;
  phones: ReadonlySet<string>;
  entryIds: ReadonlySet<string>;
}

/** Whether a file's writes reach this person in the app: once it is applied, the record
 *  that is theirs may be another one. */
export function reachedByFile(member: repo.MemberAgainstList, written: FileWrites): boolean {
  const email = (member.email ?? "").trim().toLowerCase();
  const phone = (member.statedPhone ?? "").trim();
  return (
    (email !== "" && written.emails.has(email)) ||
    (phone !== "" && written.phones.has(phone)) ||
    (member.joinedEntryId !== null && written.entryIds.has(member.joinedEntryId)) ||
    (member.entryId !== null && written.entryIds.has(member.entryId)) ||
    (member.unsure?.records ?? []).some((record) => written.entryIds.has(record.id))
  );
}

/** THE RULE FOR AN IMPORT'S LEAVERS (RULINGS 2026-09-28; ROADMAP 5b-v-d). Pure.
 *
 *  "They've left" is Remove on the records marked Left: `recordRemovalPlan`, worked out on
 *  the list before the file is applied, and nobody else touched. One exception, in the
 *  direction that ends nobody's app by mistake: someone the file's own writes reach (a
 *  record added or brought back at their email or phone, or one whose name, email or phone
 *  changes there) keeps the app and is
 *  named ("in_file"), because once the file is in, a different record may be theirs — a
 *  mother brought back on the family email her son leaves from. Staff can remove them
 *  from the app afterwards. */
export function importLeaversPlan(input: {
  gymId: string;
  leftIds: readonly string[];
  records: readonly RecordBrief[];
  members: readonly repo.MemberAgainstList[];
  written: FileWrites;
  scale: { listCurrent: number; seats: number };
}): RemovalPlan {
  const plan = recordRemovalPlan({ gymId: input.gymId, selectedIds: input.leftIds, records: input.records, members: input.members, scale: input.scale });
  const reached = new Set(input.members.filter((member) => reachedByFile(member, input.written)).map((member) => member.userId));
  const spared = plan.preview.endApp.filter((person) => person.userId !== null && reached.has(person.userId));
  if (spared.length === 0) return plan;
  const endApp = plan.endApp.filter((person) => !reached.has(person.userId));
  const kept = new Map<MemberRemoveKeptReason, MemberRemovePerson[]>(plan.preview.kept.map((group) => [group.reason, [...group.people]]));
  for (const person of spared) keep(kept, "in_file", person);
  return {
    moveIds: plan.moveIds,
    endApp,
    preview: {
      ...plan.preview,
      endApp: plan.preview.endApp.filter((person) => person.userId === null || !reached.has(person.userId)),
      kept: KEPT_ORDER.flatMap((reason) => {
        const people = kept.get(reason);
        return people === undefined || people.length === 0 ? [] : [{ reason, people: [...people].sort(byNameThenId) }];
      }),
      large: largeRemoval(plan.moveIds.length, endApp.length, input.scale),
      digest: removalDigest(input.gymId, plan.moveIds, endApp),
    },
  };
}

/** Whether an import needs its large-change answer (the typed number, or the tick): the
 *  wrong-file check asks, or the leavers' own line does, as Remove's box asks
 *  (`largeRemoval`). Pure. */
export function importNeedsLargeTick(guard: MemberListGuard, leavers: RemovalPlan | null): boolean {
  return guard.needsTick || (leavers?.preview.large ?? null) !== null;
}

/** Nothing written by a file: the leavers' rule as Remove alone decides it. */
const NO_WRITES: FileWrites = { emails: new Set(), phones: new Set(), entryIds: new Set() };

/** THE ROLE CHECK BEFORE THE WORK (CLAUDE.md §4 route order; round one, Low-3). Someone
 *  without `members.remove` who marks a person in the app as having left is refused before
 *  the file is compared or the allowance spent. Remove's rule on the records marked Left,
 *  with nothing written: a file's writes only ever spare people, so this never lets through
 *  what the full rule would refuse (it can refuse a leaver the file itself would spare; the
 *  owner can import that). */
export async function requireRemoveForLeft(sql: repo.SqlOrTx, gymId: string, privileges: readonly string[], leftIds: readonly string[]): Promise<void> {
  if (leftIds.length === 0 || privileges.includes("members.remove")) return;
  requireForPlan(await importLeaversPlanOn(sql, gymId, leftIds, NO_WRITES), privileges);
}

/** What the rule for these records reads, on `sql` (the pool, or a transaction). */
async function recordInputsOn(
  sql: repo.SqlOrTx,
  gymId: string,
  ids: readonly string[],
): Promise<{ records: RecordBrief[]; members: repo.MemberAgainstList[]; scale: { listCurrent: number; seats: number } }> {
  const records = await repo.entriesBrief(sql, gymId, ids);
  const current = records.filter((record) => !record.former);
  const [members, scale] = await Promise.all([
    records.length === 0
      ? Promise.resolve([])
      : repo.membersAgainstList(sql, gymId, {
          email: null,
          phone: null,
          emails: current.flatMap((record) => (record.email === null ? [] : [record.email])),
          phones: current.flatMap((record) => (record.phone === null ? [] : [record.phone])),
          entryIds: records.map((record) => record.id),
        }),
    repo.removalScale(sql, gymId),
  ]);
  return { records, members, scale };
}

/** The plan for these records, read on `sql` (the pool, or the press's transaction). */
async function recordPlanOn(sql: repo.SqlOrTx, gymId: string, ids: readonly string[]): Promise<RemovalPlan> {
  const { records, members, scale } = await recordInputsOn(sql, gymId, ids);
  return recordRemovalPlan({ gymId, selectedIds: ids, records, members, scale });
}

/** An import's leavers box, read on `sql` before the file is applied. */
export async function importLeaversPlanOn(sql: repo.SqlOrTx, gymId: string, leftIds: readonly string[], written: FileWrites): Promise<RemovalPlan> {
  const { records, members, scale } = await recordInputsOn(sql, gymId, leftIds);
  return importLeaversPlan({ gymId, leftIds, records, members, written, scale });
}

async function rosterPlanOn(sql: repo.SqlOrTx, gymId: string, userIds: readonly string[]): Promise<RemovalPlan> {
  const [members, scale] = await Promise.all([
    repo.membersAgainstList(sql, gymId, { email: null, phone: null, userIds }),
    repo.removalScale(sql, gymId),
  ]);
  // Everyone else the records that would move reach, to name anyone sharing one of them.
  const owns = [...new Set(members.flatMap((member) => currentRecordOf(member) ?? []))];
  const records = await repo.entriesBrief(sql, gymId, owns);
  const reached =
    records.length === 0
      ? []
      : await repo.membersAgainstList(sql, gymId, {
          email: null,
          phone: null,
          emails: records.flatMap((record) => (record.email === null ? [] : [record.email])),
          phones: records.flatMap((record) => (record.phone === null ? [] : [record.phone])),
          entryIds: owns,
        });
  return rosterRemovalPlan({ gymId, userIds, members, reached, scale });
}

/** A record door that would end somebody's app needs `members.remove` as well; the
 *  roster door that would move somebody's record needs `members.confirm` as well. */
export function requireForPlan(plan: RemovalPlan, privileges: readonly string[]): void {
  if (plan.endApp.length > 0 && !privileges.includes("members.remove")) {
    throw new OrgsError(403, "forbidden", MEMBER_LIST_BY_HAND_WORDS.remove_needs_app);
  }
  if (plan.moveIds.length > 0 && !privileges.includes("members.confirm")) {
    throw new OrgsError(403, "forbidden", MEMBER_LIST_BY_HAND_WORDS.remove_needs_list);
  }
}

export type RemoveSelectedAnswer =
  | { kind: "removed"; removed: MemberRemovedSelected }
  | { kind: "changed"; preview: MemberRemovePreview }
  | { kind: "large_change"; preview: MemberRemovePreview }
  | { kind: "rate_limited" };

/** How long the same press, sent again, is recognised as one already applied. */
const REMOVAL_REPLAY_MS = 24 * 60 * 60 * 1000;

/** THE PRESS, for either door. Under the gym's lock the plan is worked out again; unless
 *  it is exactly the box staff saw (its digest), nothing is done. Then, set by set, what
 *  `removeRecordIn` does for one record and `removeOrgMember` for one person: the records
 *  off the list, their members stamped as listed, an address no record holds any more
 *  loses its invitation, the memberships closed with the record each was removed with,
 *  their invitations stopped, an audit row for each, and the list's version moved once. */
async function press(
  deps: MemberListDeps,
  actorUserId: string,
  gymId: string,
  input: { digest: string; acknowledgeLargeChange?: boolean | undefined },
  planOn: (tx: TransactionSql) => Promise<RemovalPlan>,
  privileges: readonly string[],
): Promise<RemoveSelectedAnswer> {
  const at = deps.now();
  const settings = deps.invites ?? null;
  const closedUsers: string[] = [];
  const answer = await deps.sql.begin(async (tx): Promise<RemoveSelectedAnswer> => {
    await repo.lockGym(tx, gymId);
    const plan = await planOn(tx);
    if (plan.preview.digest !== input.digest) {
      // The same press again (a retry, or a colleague's): the box is gone because that
      // press did it, so say so rather than showing an empty box.
      // Only while that press's work still stands: if anyone has been put back since, the
      // box is shown again with them in it.
      const nothingLeft = plan.moveIds.length === 0 && plan.endApp.length === 0;
      const earlier = nothingLeft ? await repo.selectedRemovalByDigest(tx, gymId, input.digest, new Date(at.getTime() - REMOVAL_REPLAY_MS)) : null;
      if (earlier !== null) return { kind: "removed", removed: { ...earlier, alreadyRemoved: true } };
      return { kind: "changed", preview: plan.preview };
    }
    requireForPlan(plan, privileges);
    if (plan.preview.large !== null && input.acknowledgeLargeChange !== true) return { kind: "large_change", preview: plan.preview };

    const moved = await repo.setEntriesFormer(tx, gymId, plan.moveIds, at);
    // Under the lock the set cannot move between the rule and the write, so a difference
    // is a fault of ours and nothing is committed.
    if (moved.length !== plan.moveIds.length) {
      throw new Error(`remove-selected moved ${String(moved.length)} records where the rule chose ${String(plan.moveIds.length)}`);
    }
    const records = await repo.entriesBrief(tx, gymId, moved);
    if (moved.length > 0) {
      await repo.stampListedByContact(tx, gymId, records.map((record) => ({ email: record.email, phone: record.phone })), moved, at);
      await withdrawForAddresses(tx, settings, { gymId, emails: records.flatMap((record) => (record.email === null ? [] : [record.email])), at });
    }
    const closed = await repo.closeMemberships(tx, gymId, plan.endApp, at);
    if (closed.length !== plan.endApp.length) {
      throw new Error(`remove-selected closed ${String(closed.length)} memberships where the rule chose ${String(plan.endApp.length)}`);
    }
    await withdrawForAccounts(tx, settings, { gymId, userIds: closed.map((row) => row.userId), at });
    const endedWith = new Map<string, number>();
    for (const person of plan.endApp) {
      if (person.removedWith !== null) endedWith.set(person.removedWith, (endedWith.get(person.removedWith) ?? 0) + 1);
    }
    await repo.insertAuditRows(tx, {
      actorUserId,
      gymId,
      rows: [
        ...moved.map((id) => ({
          action: "org.member_list_entry_taken_off",
          targetType: "member_list_entry",
          targetId: id,
          meta: { removedFromApp: String(endedWith.get(id) ?? 0), via: "selected" },
        })),
        ...closed.map((row) => ({
          action: "org.member_removed",
          targetType: "gym_member",
          targetId: row.membershipId,
          meta: { removedUserId: row.userId, via: "selected" },
        })),
        {
          action: "org.member_list_selected_removed",
          targetType: "member_list",
          targetId: gymId,
          // The digest names the box, which is how the same press sent again is recognised.
          meta: { moved: String(moved.length), endedApp: String(closed.length), digest: input.digest },
        },
      ],
    });
    if (moved.length > 0) await repo.bumpListVersion(tx, gymId);
    closedUsers.push(...closed.map((row) => row.userId));
    return { kind: "removed", removed: { moved: moved.length, endedApp: closed.length, alreadyRemoved: false } };
  });
  await bustAfterRemoval(deps, gymId, closedUsers);
  return answer;
}

// ── "Your list" and "Past members" ──

/** The box for the records selected. Null when the rate limit has answered. */
export async function previewRemoveSelected(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  request: MemberListRemovePreviewRequest,
  limit: () => Promise<boolean>,
): Promise<MemberRemovePreview | null> {
  const { privileges } = await requirePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  const ids = await selectedIds(deps, gymId, request.selection);
  const plan = await recordPlanOn(deps.sql, gymId, ids);
  requireForPlan(plan, privileges);
  return plan.preview;
}

/** Remove the records selected. A "Select all" is resolved first, against its own digest
 *  (`selection_changed`); the box's digest is then checked under the lock. */
export async function removeSelected(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  input: MemberListRemoveSelectedRequest,
  limit: () => Promise<boolean>,
): Promise<RemoveSelectedAnswer> {
  await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  const { privileges } = await requirePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return { kind: "rate_limited" };
  const ids = await selectedIds(deps, gymId, input.selection);
  return await press(deps, userId, gymId, input, (tx) => recordPlanOn(tx, gymId, ids), privileges);
}

// ── "In the app" ──

/** The box for the people ticked on "In the app". */
export async function previewRemoveRoster(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  request: MemberRosterRemovePreviewRequest,
  limit: () => Promise<boolean>,
): Promise<MemberRemovePreview | null> {
  const { privileges } = await requirePrivilege(deps, gymId, userId, "members.remove");
  if (!(await limit())) return null;
  const plan = await rosterPlanOn(deps.sql, gymId, request.userIds);
  requireForPlan(plan, privileges);
  return plan.preview;
}

/** Remove the people ticked on "In the app". */
export async function removeRoster(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  input: MemberRosterRemoveRequest,
  limit: () => Promise<boolean>,
): Promise<RemoveSelectedAnswer> {
  await requireWritablePrivilege(deps, gymId, userId, "members.remove");
  const { privileges } = await requirePrivilege(deps, gymId, userId, "members.remove");
  if (!(await limit())) return { kind: "rate_limited" };
  return await press(deps, userId, gymId, input, (tx) => rosterPlanOn(tx, gymId, input.userIds), privileges);
}
