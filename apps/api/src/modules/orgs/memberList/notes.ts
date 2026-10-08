// STAFF NOTES AND TAGS on a person's page (ROADMAP Stage 2 item 5d; spec Part 3 §18.13).
//
// Read and written only by the gym's staff who may open the person's page
// (`members.confirm`). Nothing here is sent to a member, an email or the CSV download,
// and a note's words are never written to the audit log.
//
// Gates in CLAUDE.md §4's order: privilege (and a live plan, for a write), then the rate
// limit, then the handler.
import {
  cardCheckReadings,
  MEMBER_LIST_BY_HAND_WORDS,
  MEMBER_NOTES_MAX_PER_PERSON,
  MEMBER_NOTES_WORDS,
  MEMBER_TAGS_MAX_PER_GYM,
  MEMBER_TAGS_MAX_PER_PERSON,
  MEMBER_TAGS_WORDS,
  type MemberNoteAddRequest,
  type MemberNotesAndTags,
  type MemberNotesOlder,
  type MemberTagAddRequest,
} from "@app/shared";
import { insertAudit } from "../repo.js";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import { holdsCard } from "./byHand.js";
import * as notesRepo from "./notesRepo.js";
import * as repo from "./repo.js";
import type { MemberListDeps } from "./service.js";

const entryNotFound = (): OrgsError => new OrgsError(404, "entry_not_found", MEMBER_LIST_BY_HAND_WORDS.entry_not_found);

/** A card number written in a note or a tag, however its digits are typed or pasted. */
export const wordsHoldCard = (text: string): boolean => cardCheckReadings(text).some(holdsCard);

async function stateOf(deps: MemberListDeps, gymId: string, entryId: string): Promise<MemberNotesAndTags> {
  const [notes, notesTotal, tags, gymTags] = await Promise.all([
    notesRepo.notesOf(deps.sql, gymId, entryId),
    notesRepo.countNotes(deps.sql, gymId, entryId),
    notesRepo.tagsOf(deps.sql, gymId, entryId),
    notesRepo.gymTags(deps.sql, gymId),
  ]);
  // Counted beside the page, not with it: a note saved between the two is still counted.
  return { notes, notesTotal: Math.max(notesTotal, notes.length), tags, gymTags };
}

export async function readNotesAndTags(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  entryId: string,
  limit: () => Promise<boolean>,
): Promise<MemberNotesAndTags | null> {
  await requirePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  if ((await repo.entryFor(deps.sql, gymId, entryId)) === null) throw entryNotFound();
  return await stateOf(deps, gymId, entryId);
}

/** The page of a person's notes older than the oldest one their page shows. */
export async function readOlderNotes(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  entryId: string,
  beforeNoteId: string,
  limit: () => Promise<boolean>,
): Promise<MemberNotesOlder | null> {
  await requirePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  if ((await repo.entryFor(deps.sql, gymId, entryId)) === null) throw entryNotFound();
  const older = await notesRepo.notesOlderThan(deps.sql, gymId, entryId, beforeNoteId);
  if (older === null) throw new OrgsError(404, "note_not_found", MEMBER_NOTES_WORDS.note_not_found);
  return older;
}

export async function addNote(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  entryId: string,
  input: MemberNoteAddRequest,
  limit: () => Promise<boolean>,
): Promise<MemberNotesAndTags | null> {
  await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  if (wordsHoldCard(input.body)) throw new OrgsError(400, "note_holds_card", MEMBER_NOTES_WORDS.note_holds_card);
  const at = deps.now();
  await deps.sql.begin(async (tx) => {
    // Holds the record: a second note for it waits here, so the count below is true.
    await repo.lockEntries(tx, gymId, [entryId]);
    if ((await repo.entryFor(tx, gymId, entryId)) === null) throw entryNotFound();
    if ((await notesRepo.noteByRequest(tx, gymId, entryId, input.requestKey)) !== null) return;
    if ((await notesRepo.countNotes(tx, gymId, entryId)) >= MEMBER_NOTES_MAX_PER_PERSON) {
      throw new OrgsError(409, "too_many_notes", MEMBER_NOTES_WORDS.too_many_notes);
    }
    const noteId = await notesRepo.insertNote(tx, { gymId, entryId, body: input.body, authorUserId: userId, requestKey: input.requestKey, at });
    // The key is already used on another person of this gym: nothing was saved.
    if (noteId === null) throw new OrgsError(409, "note_not_saved", MEMBER_NOTES_WORDS.note_not_saved);
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.member_note_added",
      targetType: "member_list_entry",
      targetId: entryId,
      meta: { noteId },
    });
  });
  return await stateOf(deps, gymId, entryId);
}

export async function deleteNote(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  entryId: string,
  noteId: string,
  limit: () => Promise<boolean>,
): Promise<MemberNotesAndTags | null> {
  await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  await deps.sql.begin(async (tx) => {
    // Holds the record, as a join of two does: the answer is about where the note is now.
    await repo.lockEntries(tx, gymId, [entryId]);
    if (!(await notesRepo.deleteNote(tx, gymId, entryId, noteId))) {
      throw new OrgsError(404, "note_not_found", MEMBER_NOTES_WORDS.note_not_found);
    }
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.member_note_deleted",
      targetType: "member_list_entry",
      targetId: entryId,
      meta: { noteId },
    });
  });
  return await stateOf(deps, gymId, entryId);
}

/** Put a tag on a person: one of the gym's, picked, or a name typed, which is made one of
 *  the gym's tags if it is new. */
export async function addTag(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  entryId: string,
  asked: MemberTagAddRequest,
  limit: () => Promise<boolean>,
): Promise<MemberNotesAndTags | null> {
  await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  if ("name" in asked && wordsHoldCard(asked.name)) throw new OrgsError(400, "tag_holds_card", MEMBER_NOTES_WORDS.tag_holds_card);
  await deps.sql.begin(async (tx) => {
    // The gym's row: two staff typing the same new tag make one, and both counts hold.
    await repo.lockGym(tx, gymId);
    if ((await repo.entryFor(tx, gymId, entryId)) === null) throw entryNotFound();
    const held = await notesRepo.tagsOf(tx, gymId, entryId);
    // A picked tag a colleague has deleted since is gone: it is never made again from its old name.
    const mine = "id" in asked ? await notesRepo.tagById(tx, gymId, asked.id) : await notesRepo.tagByName(tx, gymId, asked.name);
    if (mine === null && "id" in asked) throw new OrgsError(404, "tag_not_found", MEMBER_TAGS_WORDS.tag_not_found);
    if (mine !== null && held.some((one) => one.id === mine.id)) return;
    if (held.length >= MEMBER_TAGS_MAX_PER_PERSON) {
      throw new OrgsError(409, "too_many_tags_person", MEMBER_NOTES_WORDS.too_many_tags_person);
    }
    let tag = mine;
    if (tag === null && "name" in asked) {
      if ((await notesRepo.gymTags(tx, gymId)).length >= MEMBER_TAGS_MAX_PER_GYM) {
        throw new OrgsError(409, "too_many_tags_gym", MEMBER_NOTES_WORDS.too_many_tags_gym);
      }
      tag = await notesRepo.insertTag(tx, gymId, asked.name, userId);
    }
    if (tag === null) throw new OrgsError(404, "tag_not_found", MEMBER_TAGS_WORDS.tag_not_found);
    const tagId = tag.id;
    await notesRepo.putTagOn(tx, gymId, entryId, tagId, userId);
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.member_tag_added",
      targetType: "member_list_entry",
      targetId: entryId,
      meta: { tagId },
    });
  });
  return await stateOf(deps, gymId, entryId);
}

/** Take a tag off a person. The tag stays one of the gym's. */
export async function removeTag(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  entryId: string,
  tagId: string,
  limit: () => Promise<boolean>,
): Promise<MemberNotesAndTags | null> {
  await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  await deps.sql.begin(async (tx) => {
    // Holds the record: a join that is moving its tags finishes first, and it is then gone.
    await repo.lockEntries(tx, gymId, [entryId]);
    if ((await repo.entryFor(tx, gymId, entryId)) === null) throw entryNotFound();
    // Already off: the same press twice ends the same way.
    if (!(await notesRepo.takeTagOff(tx, gymId, entryId, tagId))) return;
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.member_tag_removed",
      targetType: "member_list_entry",
      targetId: entryId,
      meta: { tagId },
    });
  });
  return await stateOf(deps, gymId, entryId);
}
