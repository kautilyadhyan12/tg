// POSSIBLE DUPLICATES (ROADMAP 5b-iv-a; RULINGS 2026-09-25, 2026-09-30): the gym's records
// alike by name, phone or member number, as pairs staff open side by side and either Merge
// (the person page's own merge) or mark Different people, remembered for good. The app
// never merges on its own: a name alone cannot tell two people apart.
import {
  MEMBER_LIST_BY_HAND_WORDS,
  MEMBER_LIST_DUPLICATES_PAGE,
  type MemberListDuplicatesPage,
  type MemberListDuplicatesQuery,
  type MemberListDuplicatesSign,
} from "@app/shared";
import { insertAudit } from "../repo.js";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import { decodePairCursor, encodePairCursor } from "./cursor.js";
import * as repo from "./repo.js";
import type { MemberListDeps } from "./service.js";

const notFound = (): OrgsError => new OrgsError(404, "entry_not_found", MEMBER_LIST_BY_HAND_WORDS.entry_not_found);

/** One page of the gym's possible duplicates. */
export async function readDuplicatesPage(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  query: MemberListDuplicatesQuery,
  limit: () => Promise<boolean>,
): Promise<MemberListDuplicatesPage | null> {
  await requirePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  const cursor = query.cursor === undefined ? null : decodePairCursor(query.cursor);
  if (query.cursor !== undefined && cursor === null) {
    throw new OrgsError(400, "bad_cursor", "That page of the list could not be read. Open the list again.");
  }
  const page = await repo.duplicatesPage(deps.sql, { gymId, cursor, limit: MEMBER_LIST_DUPLICATES_PAGE + 1 });
  const shown = page.pairs.slice(0, MEMBER_LIST_DUPLICATES_PAGE);
  const last = page.pairs.length > MEMBER_LIST_DUPLICATES_PAGE ? shown[shown.length - 1] : undefined;
  return {
    total: page.total,
    kept: page.kept,
    pairs: shown,
    cursor: last === undefined ? null : encodePairCursor({ name: last.first.fullName, id: last.first.entryId, second: last.second.entryId }),
  };
}

/** Different people: the two records are remembered as a pair that is not one person, and
 *  never listed again. Both must be this gym's; pressing it twice changes nothing. */
export async function markDifferentPeople(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  entryIds: readonly [string, string],
  limit: () => Promise<boolean>,
): Promise<{ kind: "marked"; duplicates: MemberListDuplicatesSign } | { kind: "rate_limited" }> {
  await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return { kind: "rate_limited" };
  await deps.sql.begin(async (tx) => {
    // Under the lock a merge or Delete for good takes, so neither record goes mid-write.
    await repo.lockGym(tx, gymId);
    const [a, b] = await Promise.all([repo.entryFor(tx, gymId, entryIds[0]), repo.entryFor(tx, gymId, entryIds[1])]);
    if (a === null || b === null) throw notFound();
    const before = await repo.pairsStamp(tx, gymId);
    // The ids as stored, so the pair's order is the database's own.
    if (!(await repo.markNotDuplicates(tx, gymId, a.id, b.id))) return;
    await repo.dropMarkedPair(tx, gymId, a.id, b.id, before);
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.member_list_not_duplicates",
      targetType: "member_list_entry",
      targetId: a.id,
      meta: { otherEntryId: b.id },
    });
  });
  return { kind: "marked", duplicates: await repo.duplicatesSign(deps.sql, gymId) };
}
