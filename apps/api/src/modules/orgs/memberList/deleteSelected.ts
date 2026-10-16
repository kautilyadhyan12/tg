// DELETE PERMANENTLY, FOR THE PAST MEMBERS SELECTED (5e-ii; Kd's click-through, 2026-10-16:
// "when i select in bulk and remove … how do i delete them").
//
// The same deletion as one past member's (`byHandService.deleteFormer`), for everyone ticked
// on Past members or chosen by "Select all": only past members are deleted, a person on the
// list is never; their payments stay in the gym's takings as "A deleted member"; their
// member numbers are never given again (5e-i). The box names who is deleted and carries a
// digest of exactly them; the press is refused, deleting nobody, if it no longer matches.
import { MEMBER_LIST_DELETE_MAX, MEMBER_LIST_DELETE_NAMES_SHOWN, type MemberListDeleted, type MemberListDeletePreview, type MemberListDeletePreviewRequest, type MemberListDeleteSelectedRequest } from "@app/shared";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import { keptWith } from "./memberNumbers.js";
import * as repo from "./repo.js";
import { selectedIds, selectionDigest } from "./selection.js";
import type { MemberListDeps } from "./service.js";

type Records = Awaited<ReturnType<typeof repo.recordsAmong>>;

function previewOf(gymId: string, records: Records): MemberListDeletePreview {
  const past = records.filter((record) => record.past);
  return {
    count: past.length,
    names: past.slice(0, MEMBER_LIST_DELETE_NAMES_SHOWN).map((record) => record.fullName),
    onList: records.length - past.length,
    tooMany: past.length > MEMBER_LIST_DELETE_MAX,
    digest: selectionDigest(gymId, past.map((record) => record.id)),
  };
}

/** The box: who would be deleted. Null when the rate limit has answered. */
export async function previewDeleteSelected(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  request: MemberListDeletePreviewRequest,
  limit: () => Promise<boolean>,
): Promise<MemberListDeletePreview | null> {
  await requirePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  const ids = await selectedIds(deps, gymId, request.selection);
  return previewOf(gymId, await repo.recordsAmong(deps.sql, gymId, ids));
}

export type DeleteSelectedAnswer = { kind: "rate_limited" } | { kind: "changed"; preview: MemberListDeletePreview } | { kind: "deleted"; done: MemberListDeleted };

/** Delete permanently the past members the box showed, all or none. */
export async function deleteSelected(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  input: MemberListDeleteSelectedRequest,
  limit: () => Promise<boolean>,
): Promise<DeleteSelectedAnswer> {
  await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return { kind: "rate_limited" };
  const ids = await selectedIds(deps, gymId, input.selection);
  const at = deps.now();
  return await deps.sql.begin(async (tx): Promise<DeleteSelectedAnswer> => {
    await repo.lockGym(tx, gymId);
    const records = await repo.recordsAmong(tx, gymId, ids);
    const preview = previewOf(gymId, records);
    // Nobody chosen can be deleted now and some of them are no longer there: the same press,
    // sent again after it was done (a reply lost on the way). Somebody put back since is still
    // there, so that reads as changed instead.
    if (records.every((record) => !record.past) && records.length < ids.length) {
      return { kind: "deleted", done: { deleted: 0, alreadyDeleted: true, version: (await repo.listState(tx, gymId))?.version ?? 0 } };
    }
    if (preview.digest !== input.digest) return { kind: "changed", preview };
    if (preview.tooMany) throw new OrgsError(400, "too_many_to_delete", `Delete up to ${MEMBER_LIST_DELETE_MAX.toLocaleString("en")} past members at a time.`);
    const past = records.filter((record) => record.past);
    if (past.length === 0) return { kind: "deleted", done: { deleted: 0, alreadyDeleted: false, version: (await repo.listState(tx, gymId))?.version ?? 0 } };

    // Their numbers are never given to somebody new (5e-i), kept in one write.
    const before = await repo.memberNumbersKept(tx, gymId);
    let kept: Readonly<Record<string, string>> = before;
    for (const record of past) if (record.memberNumber !== null) kept = keptWith(kept, record.memberNumber) ?? kept;
    if (kept !== before) await repo.writeMemberNumbersKept(tx, gymId, kept);

    for (const record of past) {
      if (!(await repo.deleteEntry(tx, gymId, record.id, at, { onlyPast: true }))) {
        throw new Error(`a past member the box named was not deleted (${record.id})`);
      }
    }
    const version = await repo.bumpListVersion(tx, gymId);
    // One row a record, as one person's Delete permanently writes: ids, never a name.
    await repo.insertAuditRows(tx, {
      actorUserId: userId,
      gymId,
      rows: past.map((record) => ({ action: "org.member_list_entry_deleted", targetType: "member_list_entry", targetId: record.id, meta: { via: "selected" } })),
    });
    return { kind: "deleted", done: { deleted: past.length, alreadyDeleted: false, version } };
  });
}
