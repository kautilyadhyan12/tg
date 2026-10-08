// TAGS ON THE MEMBERS LIST (ROADMAP Stage 2 item 5d-ii; spec Part 3 §18.13).
//
// The gym's tags with their counts, a tag put on or taken off the people selected, and a
// tag renamed or deleted. Read and written by the staff who may open the list
// (`members.confirm`), as a person's own tags are (`notes.ts`). The audit log keeps a tag's
// id and a count, never its name.
//
// Gates in CLAUDE.md §4's order: privilege (and a live plan, for a write), then the rate
// limit, then the handler.
import {
  foldForCardCheck,
  MEMBER_NOTES_WORDS,
  MEMBER_TAG_BOX_NAMES_MAX,
  MEMBER_TAGS_MAX_PER_GYM,
  MEMBER_TAGS_MAX_PER_PERSON,
  MEMBER_TAGS_WORDS,
  type MemberGymTag,
  type MemberTagKeptReason,
  type MemberTagPerson,
  type MemberTagsDone,
  type MemberTagsPreview,
  type MemberTagsSelectedRequest,
} from "@app/shared";
import { insertAudit } from "../repo.js";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import { holdsCard } from "./byHand.js";
import * as notesRepo from "./notesRepo.js";
import * as repo from "./repo.js";
import { selectedIds } from "./selection.js";
import type { MemberListDeps } from "./service.js";

const tagNotFound = (): OrgsError => new OrgsError(404, "tag_not_found", MEMBER_TAGS_WORDS.tag_not_found);

export interface TagPlan {
  change: MemberTagPerson[];
  kept: { reason: MemberTagKeptReason; people: MemberTagPerson[]; count: number }[];
}

/** WHO A PRESS CHANGES. `rows` are the selected records that are still this gym's;
 *  `selected` is how many were selected. Only somebody in `rows` can change: adding skips
 *  whoever has the tag or already holds as many as one person can, taking off skips whoever
 *  does not have it. */
export function tagPlan(action: "add" | "remove", rows: readonly notesRepo.TagStateRow[], selected: number): TagPlan {
  const change: MemberTagPerson[] = [];
  const groups = new Map<MemberTagKeptReason, MemberTagPerson[]>();
  const keep = (reason: MemberTagKeptReason, person: MemberTagPerson): void => {
    groups.set(reason, [...(groups.get(reason) ?? []), person]);
  };
  for (const row of rows) {
    const person = { entryId: row.entryId, name: row.name };
    if (action === "remove") {
      if (row.has) change.push(person);
      else keep("not_on_them", person);
    } else if (row.has) keep("has_it", person);
    else if (row.held >= MEMBER_TAGS_MAX_PER_PERSON) keep("full", person);
    else change.push(person);
  }
  const kept = [...groups].map(([reason, people]) => ({ reason, people, count: people.length }));
  const gone = selected - rows.length;
  if (gone > 0) kept.push({ reason: "gone", people: [], count: gone });
  return { change, kept };
}

/** The gym's tags with their counts. Null when the rate limit has answered. */
export async function readGymTags(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  limit: () => Promise<boolean>,
): Promise<MemberGymTag[] | null> {
  await requirePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  return await notesRepo.gymTagsCounted(deps.sql, gymId);
}

/** The tag a press names: one of the gym's, or a name it does not have yet (`id` null).
 *  A new name the gym already has, whatever its capitals, is that tag. */
async function tagAsked(sql: notesRepo.SqlOrTx, gymId: string, request: MemberTagsSelectedRequest): Promise<{ id: string | null; name: string }> {
  const picked = request.action === "remove" ? { id: request.tagId } : request.tag;
  if ("id" in picked) {
    const tag = await notesRepo.tagById(sql, gymId, picked.id);
    if (tag === null) throw tagNotFound();
    return tag;
  }
  const { name } = picked;
  if (holdsCard(foldForCardCheck(name))) throw new OrgsError(400, "tag_holds_card", MEMBER_NOTES_WORDS.tag_holds_card);
  const mine = await notesRepo.tagByName(sql, gymId, name);
  if (mine !== null) return mine;
  if ((await notesRepo.gymTags(sql, gymId)).length >= MEMBER_TAGS_MAX_PER_GYM) {
    throw new OrgsError(409, "too_many_tags_gym", MEMBER_NOTES_WORDS.too_many_tags_gym);
  }
  return { id: null, name };
}

/** The box before the press. Null when the rate limit has answered. */
export async function previewTagSelected(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  request: MemberTagsSelectedRequest,
  limit: () => Promise<boolean>,
): Promise<MemberTagsPreview | null> {
  await requirePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  const ids = await selectedIds(deps, gymId, request.selection);
  const tag = await tagAsked(deps.sql, gymId, request);
  const plan = tagPlan(request.action, await notesRepo.tagStateOf(deps.sql, gymId, ids, tag.id), ids.length);
  // The box names the first people of each group and counts the rest.
  return {
    action: request.action,
    tag,
    selected: ids.length,
    changeCount: plan.change.length,
    change: plan.change.slice(0, MEMBER_TAG_BOX_NAMES_MAX),
    kept: plan.kept.map((group) => ({ ...group, people: group.people.slice(0, MEMBER_TAG_BOX_NAMES_MAX) })),
  };
}

/** Put a tag on the people selected, or take it off them. A "Select all" is resolved
 *  first, against its own digest (`selection_changed`); who changes is then worked out
 *  again under the gym's lock, so the answer is what was done. */
export async function tagSelected(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  request: MemberTagsSelectedRequest,
  limit: () => Promise<boolean>,
): Promise<{ done: MemberTagsDone; tags: MemberGymTag[] } | null> {
  await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  const ids = await selectedIds(deps, gymId, request.selection);
  const done = await deps.sql.begin(async (tx): Promise<MemberTagsDone> => {
    // The gym's row, as one person's tag takes it: a join or a removal of a record waits,
    // and two staff making the same new tag make one.
    await repo.lockGym(tx, gymId);
    const asked = await tagAsked(tx, gymId, request);
    const plan = tagPlan(request.action, await notesRepo.tagStateOf(tx, gymId, ids, asked.id), ids.length);
    const changeIds = plan.change.map((person) => person.entryId);
    // A new tag is made only for somebody: nobody to give it to, and the gym keeps no tag
    // it did not choose to make.
    if (asked.id === null && changeIds.length === 0) throw new OrgsError(409, "tag_for_nobody", MEMBER_TAGS_WORDS.tag_for_nobody);
    const tag = asked.id === null ? await notesRepo.insertTag(tx, gymId, asked.name, userId) : { id: asked.id, name: asked.name };
    let changed = 0;
    if (changeIds.length > 0 && request.action === "add") {
      if (changeIds.length >= notesRepo.TAG_MANY_RECOUNT_FROM) await notesRepo.recountList(tx);
      changed = await notesRepo.putTagOnMany(tx, gymId, changeIds, tag.id, userId);
    } else if (changeIds.length > 0) {
      changed = await notesRepo.takeTagOffMany(tx, gymId, changeIds, tag.id);
    }
    if (changed > 0) {
      await insertAudit(tx, {
        actorUserId: userId,
        gymId,
        action: request.action === "add" ? "org.member_tag_added_to_selected" : "org.member_tag_removed_from_selected",
        targetType: "member_tag",
        targetId: tag.id,
        meta: { people: String(changed) },
      });
    }
    return { action: request.action, tag, changed, kept: plan.kept.map(({ reason, count }) => ({ reason, count })) };
  });
  return { done, tags: await notesRepo.gymTagsCounted(deps.sql, gymId) };
}

/** Rename one of the gym's tags: everybody who holds it holds the new name. */
export async function renameTag(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  tagId: string,
  name: string,
  limit: () => Promise<boolean>,
): Promise<MemberGymTag[] | null> {
  await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  if (holdsCard(foldForCardCheck(name))) throw new OrgsError(400, "tag_holds_card", MEMBER_NOTES_WORDS.tag_holds_card);
  await deps.sql.begin(async (tx) => {
    await repo.lockGym(tx, gymId);
    const tag = await notesRepo.tagById(tx, gymId, tagId);
    if (tag === null) throw tagNotFound();
    // Already that name: the same press twice ends the same way.
    if (tag.name === name) return;
    const other = await notesRepo.tagByName(tx, gymId, name);
    if (other !== null && other.id !== tagId) throw new OrgsError(409, "tag_name_taken", MEMBER_TAGS_WORDS.tag_name_taken);
    await notesRepo.renameTag(tx, gymId, tagId, name);
    await insertAudit(tx, { actorUserId: userId, gymId, action: "org.member_tag_renamed", targetType: "member_tag", targetId: tagId, meta: {} });
  });
  return await notesRepo.gymTagsCounted(deps.sql, gymId);
}

/** Delete one of the gym's tags: it comes off everybody who held it. */
export async function deleteTag(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  tagId: string,
  limit: () => Promise<boolean>,
): Promise<MemberGymTag[] | null> {
  await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  await deps.sql.begin(async (tx) => {
    await repo.lockGym(tx, gymId);
    const people = await notesRepo.deleteTag(tx, gymId, tagId);
    if (people === null) throw tagNotFound();
    await insertAudit(tx, { actorUserId: userId, gymId, action: "org.member_tag_deleted", targetType: "member_tag", targetId: tagId, meta: { people: String(people) } });
  });
  return await notesRepo.gymTagsCounted(deps.sql, gymId);
}
