// DELETE THE LEADS SELECTED (ROADMAP 20c-vii; spec Part 3 §16.3). Staff tick leads, or tick
// the page and press "Select all", then Delete: a flood of form messages cleared in one step.
//
// The worst thing this could do to a real person: delete a lead nobody ticked, or another
// gym's. So ticked ids are only ids, read with the gym in every WHERE; a "Select all" is a
// filter whose count and digest must still name exactly the same leads; and the box names
// every lead the press deletes, whose digest the press must send back. Under the gym's lock
// the leads are read again, and unless they are exactly the box's, nothing is deleted.
import { createHash } from "node:crypto";
import type {
  LeadsFilter,
  LeadSelection,
  LeadsDeleted,
  LeadsDeletePreview,
  LeadsDeleteRequest,
  LeadsSelectAllRequest,
  LeadsSelectedAll,
} from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import { dayInTz } from "../../gamification/streak.js";
import { lockGym } from "../memberList/repo.js";
import { insertAudit } from "../repo.js";
import { requirePrivilege, requireWritablePrivilege } from "../service.js";
import * as emailsRepo from "./emailsRepo.js";
import * as repo from "./repo.js";
import { appSending, filterInput, type LeadsDeps } from "./service.js";

type Limit = () => Promise<boolean>;

/** A "Select all" whose filter now matches other leads. */
export class LeadSelectionChanged extends Error {
  constructor(readonly now: LeadsSelectedAll) {
    super("selection_changed");
  }
}

/** The set's fingerprint: the gym and the lead ids in id order, so another gym's set can
 *  never match it and a renamed lead does not change it. */
export function leadsDigest(gymId: string, ids: readonly string[]): string {
  return createHash("sha256")
    .update([gymId, "leads", ...[...ids].sort()].join("\n"), "utf8")
    .digest("hex");
}

/** Every lead the filter chooses now, as the list would show them. */
async function idsMatching(deps: LeadsDeps, gymId: string, timezone: string, filter: LeadsFilter): Promise<string[]> {
  const now = deps.now();
  const app = appSending(await emailsRepo.gymSendingFacts(deps.sql, gymId, now), deps.sending);
  return await repo.leadIdsMatching(deps.sql, filterInput(gymId, filter, dayInTz(now, timezone), app));
}

/** The leads selected: the ones ticked, or everyone "Select all" chose if they are still
 *  exactly the same leads. */
async function selectedIds(deps: LeadsDeps, gymId: string, timezone: string, selection: LeadSelection): Promise<string[]> {
  if (selection.kind === "ticked") return [...new Set(selection.leadIds)];
  const ids = await idsMatching(deps, gymId, timezone, selection.filter);
  const digest = leadsDigest(gymId, ids);
  if (ids.length !== selection.count || digest !== selection.digest) throw new LeadSelectionChanged({ count: ids.length, digest });
  return ids;
}

/** The box for these ids, read on `sql` (the lock's transaction, for the press). */
async function boxFor(sql: Sql | TransactionSql, gymId: string, ids: readonly string[]): Promise<LeadsDeletePreview> {
  const leads = await repo.leadNames(sql, gymId, ids);
  return {
    selected: ids.length,
    leads,
    gone: ids.length - leads.length,
    digest: leadsDigest(gymId, leads.map((lead) => lead.id)),
  };
}

/** "Select all": who the filter matches now. Null when the rate limit has answered. */
export async function selectAllLeads(
  deps: LeadsDeps,
  userId: string,
  gymId: string,
  request: LeadsSelectAllRequest,
  limit: Limit,
): Promise<LeadsSelectedAll | null> {
  const { org } = await requirePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  const ids = await idsMatching(deps, gymId, org.timezone, request.filter);
  return { count: ids.length, digest: leadsDigest(gymId, ids) };
}

/** The box: every lead Delete would remove. Null when the rate limit has answered. */
export async function previewDeleteLeads(
  deps: LeadsDeps,
  userId: string,
  gymId: string,
  selection: LeadSelection,
  limit: Limit,
): Promise<LeadsDeletePreview | null> {
  const { org } = await requirePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  return await boxFor(deps.sql, gymId, await selectedIds(deps, gymId, org.timezone, selection));
}

export type DeleteLeadsAnswer =
  | { kind: "deleted"; deleted: LeadsDeleted }
  | { kind: "changed"; preview: LeadsDeletePreview }
  | { kind: "rate_limited" };

/** How long the same press, sent again, is recognised as one already applied. */
const REPLAY_MS = 24 * 60 * 60 * 1000;

/** THE PRESS. Under the gym's lock the box is worked out again; unless it is exactly the box
 *  staff saw (its digest), nothing is deleted and the new box is answered. */
export async function deleteSelectedLeads(
  deps: LeadsDeps,
  userId: string,
  gymId: string,
  input: LeadsDeleteRequest,
  limit: Limit,
): Promise<DeleteLeadsAnswer> {
  const { org } = await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return { kind: "rate_limited" };
  const ids = await selectedIds(deps, gymId, org.timezone, input.selection);
  const at = deps.now();
  return await deps.sql.begin(async (tx): Promise<DeleteLeadsAnswer> => {
    await lockGym(tx, gymId);
    // Only ids under the lock: the names were the box's, and its digest names these ids.
    const held = await repo.leadIdsIn(tx, gymId, ids);
    if (leadsDigest(gymId, held) !== input.digest) {
      // The same press again (a retry, or a colleague's): the leads are gone because that
      // press deleted them, so say so rather than showing an empty box.
      const earlier = held.length === 0 ? await repo.deletedLeadsByDigest(tx, gymId, input.digest, new Date(at.getTime() - REPLAY_MS)) : null;
      if (earlier !== null) return { kind: "deleted", deleted: { deleted: earlier, alreadyDeleted: true } };
      return { kind: "changed", preview: await boxFor(tx, gymId, ids) };
    }
    const deleted = await repo.deleteLeads(tx, userId, gymId, held);
    // Under the lock the set cannot move between the read and the delete.
    if (deleted !== held.length) {
      throw new Error(`delete-selected deleted ${String(deleted)} leads where the box named ${String(held.length)}`);
    }
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.leads_selected_deleted",
      targetType: "gym",
      targetId: gymId,
      // The digest names the box, which is how the same press sent again is recognised.
      meta: { deleted: String(deleted), digest: input.digest },
    });
    return { kind: "deleted", deleted: { deleted, alreadyDeleted: false } };
  });
}
