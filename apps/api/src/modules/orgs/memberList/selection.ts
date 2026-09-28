// THE PEOPLE SELECTED (spec Part 3 §18.5; ROADMAP 5b-v-b-i). Staff tick people on the
// list, or tick the page and press "Select all 312 members"; Invite and Download CSV then
// act on exactly those people (CLAUDE.md §4: nothing happens to anyone who was not ticked).
//
// "Select all" is a filter, and a filter can match other people a moment later (an
// import, a colleague's change, someone joining the app). So the press carries the count
// and a digest of exactly who was selected; the set is worked out again, and if it is not
// the same set, nothing happens and the answer carries the new count and digest.
import { createHash } from "node:crypto";
import type { MemberListFilter, MemberListSelectAllRequest, MemberListSelectedAll, MemberListSelection } from "@app/shared";
import { requirePrivilege } from "../service.js";
import * as repo from "./repo.js";
import { entriesFilter, type MemberListDeps } from "./service.js";

/** A "Select all" whose filter now matches other people. */
export class SelectionChanged extends Error {
  constructor(readonly now: MemberListSelectedAll) {
    super("selection_changed");
  }
}

/** The set's fingerprint: the gym and the record ids in id order, so another gym's set
 *  can never match it and a renamed person does not change it. */
export function selectionDigest(gymId: string, ids: readonly string[]): string {
  return createHash("sha256")
    .update([gymId, ...[...ids].sort()].join("\n"), "utf8")
    .digest("hex");
}

/** Every record this filter and search choose now, in the list's order. */
export async function idsMatching(deps: MemberListDeps, gymId: string, filter: MemberListFilter): Promise<string[]> {
  const { input } = await entriesFilter(deps, gymId, filter);
  return await repo.entryIdsMatching(deps.sql, input);
}

/** The records selected: the ones ticked, or everyone "Select all" chose if they are
 *  still exactly the same people. Ticked ids are only ids: every reader after this one
 *  reads them with the gym in its WHERE, so another gym's id is nobody. */
export async function selectedIds(deps: MemberListDeps, gymId: string, selection: MemberListSelection): Promise<string[]> {
  if (selection.kind === "ticked") return [...new Set(selection.entryIds)];
  const ids = await idsMatching(deps, gymId, selection.filter);
  const digest = selectionDigest(gymId, ids);
  if (ids.length !== selection.count || digest !== selection.digest) {
    throw new SelectionChanged({ count: ids.length, digest });
  }
  return ids;
}

/** "Select all": who the filter matches now. Null when the rate limit has answered. */
export async function selectAll(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  request: MemberListSelectAllRequest,
  limit: () => Promise<boolean>,
): Promise<MemberListSelectedAll | null> {
  await requirePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  const ids = await idsMatching(deps, gymId, request.filter);
  return { count: ids.length, digest: selectionDigest(gymId, ids) };
}
