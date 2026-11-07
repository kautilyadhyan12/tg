// DELETE PERMANENTLY, FOR THE PAST MEMBERS SELECTED (5e-ii; Kd's click-through, 2026-10-16:
// "when i select in bulk and remove … how do i delete them").
//
// The same deletion as one past member's (`byHandService.deleteFormer`), for everyone ticked
// on Past members or chosen by "Select all": only past members are deleted, a person on the
// list is never; their payments stay in the gym's takings as "A deleted member"; their
// member numbers are never given again (5e-i). The box names who is deleted and carries a
// digest of exactly them; the press is refused, deleting nobody, if it no longer matches.
import { APP_PAYMENT_STAFF_WORDS, APP_PURCHASE_STAFF_WORDS, MEMBER_LIST_BY_HAND_WORDS, MEMBER_LIST_DELETE_MAX, MEMBER_LIST_DELETE_NAMES_SHOWN, type MemberListDeleted, type MemberListDeletePreview, type MemberListDeletePreviewRequest, type MemberListDeleteSelectedRequest } from "@app/shared";
import { createHash } from "node:crypto";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import * as squareDeletes from "../payments/squareDeletesRepo.js";
import { anyOpenOfEntries } from "../payments/appPaymentsRepo.js";
import { uncheckedOfEntries } from "../payments/appPurchasesRepo.js";
import { bustAfterRemoval } from "./byHandService.js";
import { keptWith } from "./memberNumbers.js";
import { appOnDelete, endAppOnDelete, type AppOnDelete } from "./oneRemove.js";
import * as repo from "./repo.js";
import { SelectionChanged, selectedIds, selectionDigest } from "./selection.js";
import type { MemberListDeps } from "./service.js";

type Records = Awaited<ReturnType<typeof repo.recordsAmong>>;
type AppOf = ReadonlyMap<string, AppOnDelete>;

/** Whose app ends with which record, one line each, sorted: what the box says about the app (5e-iii). */
const appLines = (app: AppOf): string[] =>
  [...app].flatMap(([entryId, people]) => people.ends.map((member) => `${entryId}:${member.userId}`)).sort();

/** What the press sends back: the people, the customers in Square the box says are deleted with them, and whose app ends, so it
 *  does exactly what the box showed. A gym with none in Square and nobody in the app keeps the people-only digest. */
function digestOf(gymId: string, ids: readonly string[], standing: readonly squareDeletes.StandingRow[], app: AppOf): string {
  const lines = squareDeletes.deletedLines(standing);
  const apps = appLines(app);
  if (lines.length === 0 && apps.length === 0) return selectionDigest(gymId, ids);
  return createHash("sha256")
    .update([selectionDigest(gymId, ids), "square", ...lines, ...(apps.length === 0 ? [] : ["app", ...apps])].join("\n"), "utf8")
    .digest("hex");
}

/** Each person counted once, by what Delete permanently does about their place in the gym's Square customer list, and named: in the
 *  order the box lists the people. */
function squareGroups(records: Records, standing: readonly squareDeletes.StandingRow[]): Pick<MemberListDeletePreview, "square" | "squareNames"> {
  const byPerson = new Map<string, squareDeletes.StandingRow[]>();
  for (const row of standing) byPerson.set(row.entryId, [...(byPerson.get(row.entryId) ?? []), row]);
  const names: MemberListDeletePreview["squareNames"] = { deletes: [], stays: [], shared: [], notReached: [] };
  for (const record of records) {
    const kind = squareDeletes.rollUp(byPerson.get(record.id) ?? []);
    if (kind === "deletes") names.deletes.push(record.fullName);
    else if (kind === "stays") names.stays.push(record.fullName);
    else if (kind === "shared") names.shared.push(record.fullName);
    else if (kind === "not_reached") names.notReached.push(record.fullName);
  }
  return {
    square: { deletes: names.deletes.length, stays: names.stays.length, shared: names.shared.length, notReached: names.notReached.length },
    squareNames: names,
  };
}

/** What one press does, and the box that says it. A role that can't remove app access (no `members.remove`) deletes the past
 *  members ticked who are not in the app, and leaves out, named, those whose access would end (5e-iii): `app.ends` then holds
 *  the people NOT deleted. People are named by their app account's name, in the order the box lists the records. */
function planOf(
  gymId: string,
  records: Records,
  standing: readonly squareDeletes.StandingRow[],
  app: AppOf,
  mayEndApp: boolean,
): { preview: MemberListDeletePreview; deleted: Records } {
  const past = records.filter((record) => record.past);
  const endsOf = (record: Records[number]) => app.get(record.id)?.ends ?? [];
  const deleted = mayEndApp ? past : past.filter((record) => endsOf(record).length === 0);
  const left = mayEndApp ? [] : past.filter((record) => endsOf(record).length > 0);
  const kept = new Set(deleted.map((record) => record.id));
  const theirs = standing.filter((row) => kept.has(row.entryId));
  const theirApp = new Map([...app].filter(([entryId]) => kept.has(entryId)));
  const all = (from: Records, pick: (people: AppOnDelete) => readonly { fullName: string }[]) =>
    from.flatMap((record) => pick(app.get(record.id) ?? { ends: [], keeps: [] }).map((member) => member.fullName));
  const ends = mayEndApp ? all(deleted, (people) => people.ends) : all(left, (people) => people.ends);
  const keeps = all(deleted, (people) => people.keeps);
  const preview: MemberListDeletePreview = {
    count: deleted.length,
    names: deleted.slice(0, MEMBER_LIST_DELETE_NAMES_SHOWN).map((record) => record.fullName),
    onList: records.length - past.length,
    tooMany: deleted.length > MEMBER_LIST_DELETE_MAX,
    digest: digestOf(gymId, deleted.map((record) => record.id), theirs, theirApp),
    ...squareGroups(deleted, theirs),
    app: {
      ends: ends.slice(0, MEMBER_LIST_DELETE_NAMES_SHOWN),
      keeps: keeps.slice(0, MEMBER_LIST_DELETE_NAMES_SHOWN),
      mayEndApp,
      endsCount: ends.length,
      keepsCount: keeps.length,
    },
  };
  return { preview, deleted };
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
  const { privileges } = await requirePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  const ids = await selectedIds(deps, gymId, request.selection);
  const records = await repo.recordsAmong(deps.sql, gymId, ids);
  // Only a box that deletes somebody asks about Square and the app; more than the most one press deletes is refused whole.
  const past = pastIds(records);
  const within = past.length <= MEMBER_LIST_DELETE_MAX;
  const standing = within ? await squareDeletes.standingOf(deps.sql, gymId, past) : [];
  const app = within ? await appOnDelete(deps.sql, gymId, past) : new Map<string, AppOnDelete>();
  return planOf(gymId, records, standing, app, privileges.includes("members.remove")).preview;
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
  const { privileges } = await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  const mayEndApp = privileges.includes("members.remove");
  if (!(await limit())) return { kind: "rate_limited" };
  // NOBODY CHOSEN IS A PAST MEMBER ANY MORE: the same press sent again after it was done (a
  // reply lost on the way), or a colleague deleted or put them back. Nothing is deleted, and
  // the answer says only that, which is true in every one of those cases.
  const nothingLeft = async (sql: Parameters<typeof repo.listState>[0]): Promise<DeleteSelectedAnswer> => ({
    kind: "deleted",
    done: { deleted: 0, nothingLeft: true, version: (await repo.listState(sql, gymId))?.version ?? 0, squareDeleting: 0, appEnded: 0 },
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
  const closed: string[] = [];
  const answer = await deps.sql.begin(async (tx): Promise<DeleteSelectedAnswer> => {
    await repo.lockGym(tx, gymId);
    const records = await repo.recordsAmong(tx, gymId, ids);
    const tickedPast = pastIds(records);
    if (tickedPast.length === 0) return await nothingLeft(tx);
    const within = tickedPast.length <= MEMBER_LIST_DELETE_MAX;
    const standing = within ? await squareDeletes.standingOf(tx, gymId, tickedPast) : [];
    const app = within ? await appOnDelete(tx, gymId, tickedPast) : new Map<string, AppOnDelete>();
    const { preview, deleted: past } = planOf(gymId, records, standing, app, mayEndApp);
    if (preview.digest !== input.digest) return { kind: "changed", preview };
    // Everybody ticked still uses the app, and this role can't end it: the box said so, and nobody is deleted.
    if (past.length === 0) {
      return { kind: "deleted", done: { deleted: 0, nothingLeft: false, version: (await repo.listState(tx, gymId))?.version ?? 0, squareDeleting: 0, appEnded: 0 } };
    }
    if (preview.tooMany) throw new OrgsError(400, "too_many_to_delete", `Delete up to ${MEMBER_LIST_DELETE_MAX.toLocaleString("en")} past members at a time.`);
    // Their app ends with their record (5e-iii), which only a role that removes app access may do.
    const ending = past.flatMap((record) => (app.get(record.id)?.ends ?? []).map((member) => member.userId));
    if (ending.length > 0 && !mayEndApp) throw new OrgsError(403, "forbidden", MEMBER_LIST_BY_HAND_WORDS.delete_needs_app);
    // What Square took on a page still open would have no bill to go on (18k-ii-a).
    if (await anyOpenOfEntries(tx, gymId, past.map((record) => record.id))) throw new OrgsError(409, "app_payment_open", APP_PAYMENT_STAFF_WORDS.delete_open);
    // A purchase that may have taken money and gave nothing would be on no page once they are gone (18k-iii-a).
    if (await uncheckedOfEntries(tx, gymId, past.map((record) => record.id))) throw new OrgsError(409, "app_purchase_check", APP_PURCHASE_STAFF_WORDS.delete_check);

    // Their numbers are never given to somebody new (5e-i), kept in one write.
    const before = await repo.memberNumbersKept(tx, gymId);
    let kept: Readonly<Record<string, string>> = before;
    for (const record of past) if (record.memberNumber !== null) kept = keptWith(kept, record.memberNumber) ?? kept;
    if (kept !== before) await repo.writeMemberNumbersKept(tx, gymId, kept);

    // The customers the app added in Square are owed their deletion while their links still exist (the records take them with them).
    const squareDeleting = await squareDeletes.oweDeletes(tx, gymId, past.map((record) => record.id), at);
    closed.push(...(await endAppOnDelete(tx, { gymId, actorUserId: userId, at, settings: deps.invites ?? null }, ending)));
    // The people whose access was closed, not those read: a person made staff meanwhile keeps their access and is not counted.
    const appEnded = closed.length;
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
    return { kind: "deleted", done: { deleted: past.length, nothingLeft: false, version, squareDeleting, appEnded } };
  });
  await bustAfterRemoval(deps, gymId, closed);
  return answer;
}
