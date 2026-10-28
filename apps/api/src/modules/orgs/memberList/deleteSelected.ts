// DELETE PERMANENTLY, FOR THE PAST MEMBERS SELECTED (5e-ii; Kd's click-through, 2026-10-16:
// "when i select in bulk and remove … how do i delete them").
//
// The same deletion as one past member's (`byHandService.deleteFormer`), for everyone ticked
// on Past members or chosen by "Select all": only past members are deleted, a person on the
// list is never; their payments stay in the gym's takings as "A deleted member"; their
// member numbers are never given again (5e-i). The box names who is deleted and carries a
// digest of exactly them; the press is refused, deleting nobody, if it no longer matches.
import { MEMBER_LIST_DELETE_MAX, MEMBER_LIST_DELETE_NAMES_SHOWN, type MemberListDeleted, type MemberListDeletePreview, type MemberListDeletePreviewRequest, type MemberListDeleteSelectedRequest } from "@app/shared";
import { createHash } from "node:crypto";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import * as squareDeletes from "../payments/squareDeletesRepo.js";
import { keptWith } from "./memberNumbers.js";
import * as repo from "./repo.js";
import { SelectionChanged, selectedIds, selectionDigest } from "./selection.js";
import type { MemberListDeps } from "./service.js";

type Records = Awaited<ReturnType<typeof repo.recordsAmong>>;

/** What the press sends back: the people, and the customers in Square the box says are deleted with them, so it deletes exactly
 *  what the box showed. A gym with none in Square keeps the people-only digest. */
function digestOf(gymId: string, ids: readonly string[], standing: readonly squareDeletes.StandingRow[]): string {
  const lines = squareDeletes.deletedLines(standing);
  if (lines.length === 0) return selectionDigest(gymId, ids);
  return createHash("sha256")
    .update([selectionDigest(gymId, ids), "square", ...lines].join("\n"), "utf8")
    .digest("hex");
}

/** Each person counted once, by what Delete permanently does about their customer in Square. */
function squareCounts(standing: readonly squareDeletes.StandingRow[]): MemberListDeletePreview["square"] {
  const byPerson = new Map<string, squareDeletes.StandingRow[]>();
  for (const row of standing) byPerson.set(row.entryId, [...(byPerson.get(row.entryId) ?? []), row]);
  const counts = { deletes: 0, stays: 0, notReached: 0 };
  for (const rows of byPerson.values()) {
    const kind = squareDeletes.rollUp(rows);
    if (kind === "deletes") counts.deletes += 1;
    else if (kind === "stays") counts.stays += 1;
    else if (kind === "not_reached") counts.notReached += 1;
  }
  return counts;
}

function previewOf(gymId: string, records: Records, standing: readonly squareDeletes.StandingRow[]): MemberListDeletePreview {
  const past = records.filter((record) => record.past);
  return {
    count: past.length,
    names: past.slice(0, MEMBER_LIST_DELETE_NAMES_SHOWN).map((record) => record.fullName),
    onList: records.length - past.length,
    tooMany: past.length > MEMBER_LIST_DELETE_MAX,
    digest: digestOf(gymId, past.map((record) => record.id), standing),
    square: squareCounts(standing),
  };
}

const pastIds = (records: Records): string[] => records.filter((record) => record.past).map((record) => record.id);

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
  const records = await repo.recordsAmong(deps.sql, gymId, ids);
  // Only a box that deletes somebody asks about Square; more than the most one press deletes is refused whole.
  const past = pastIds(records);
  const standing = past.length > MEMBER_LIST_DELETE_MAX ? [] : await squareDeletes.standingOf(deps.sql, gymId, past);
  return previewOf(gymId, records, standing);
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
  // NOBODY CHOSEN IS A PAST MEMBER ANY MORE: the same press sent again after it was done (a
  // reply lost on the way), or a colleague deleted or put them back. Nothing is deleted, and
  // the answer says only that, which is true in every one of those cases.
  const nothingLeft = async (sql: Parameters<typeof repo.listState>[0]): Promise<DeleteSelectedAnswer> => ({
    kind: "deleted",
    done: { deleted: 0, nothingLeft: true, version: (await repo.listState(sql, gymId))?.version ?? 0, squareDeleting: 0 },
  });
  let ids: string[];
  try {
    ids = await selectedIds(deps, gymId, input.selection);
  } catch (err) {
    // A "Select all" that now chooses nobody at all.
    if (err instanceof SelectionChanged && err.now.count === 0) return await nothingLeft(deps.sql);
    throw err;
  }
  const at = deps.now();
  return await deps.sql.begin(async (tx): Promise<DeleteSelectedAnswer> => {
    await repo.lockGym(tx, gymId);
    const records = await repo.recordsAmong(tx, gymId, ids);
    const past = records.filter((record) => record.past);
    if (past.length === 0) return await nothingLeft(tx);
    const standing = past.length > MEMBER_LIST_DELETE_MAX ? [] : await squareDeletes.standingOf(tx, gymId, pastIds(records));
    const preview = previewOf(gymId, records, standing);
    if (preview.digest !== input.digest) return { kind: "changed", preview };
    if (preview.tooMany) throw new OrgsError(400, "too_many_to_delete", `Delete up to ${MEMBER_LIST_DELETE_MAX.toLocaleString("en")} past members at a time.`);

    // Their numbers are never given to somebody new (5e-i), kept in one write.
    const before = await repo.memberNumbersKept(tx, gymId);
    let kept: Readonly<Record<string, string>> = before;
    for (const record of past) if (record.memberNumber !== null) kept = keptWith(kept, record.memberNumber) ?? kept;
    if (kept !== before) await repo.writeMemberNumbersKept(tx, gymId, kept);

    // The customers the app added in Square are owed their deletion while their links still exist (the records take them with them).
    const squareDeleting = await squareDeletes.oweDeletes(tx, gymId, past.map((record) => record.id), at);
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
    return { kind: "deleted", done: { deleted: past.length, nothingLeft: false, version, squareDeleting } };
  });
}
