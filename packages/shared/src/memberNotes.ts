// STAFF NOTES AND TAGS on a person's page (ROADMAP Stage 2 item 5d; spec Part 3 §18.13).
//
// Staff only: nothing here is sent to the member's app, an email or the CSV download.
import { z } from "zod";
import { memberListSelectionSchema } from "./memberList.js";

export const MEMBER_NOTE_MAX_CHARS = 2000;
/** Notes staff can add to one person; staff delete one before another is added. A join of
 *  two records can leave a person with more. */
export const MEMBER_NOTES_MAX_PER_PERSON = 200;
/** The most notes one reply carries: the newest, and then each older page. */
export const MEMBER_NOTES_PAGE = 200;
export const MEMBER_TAG_MAX_CHARS = 30;
export const MEMBER_TAGS_MAX_PER_GYM = 100;
export const MEMBER_TAGS_MAX_PER_PERSON = 20;

/** Characters Postgres refuses or a screen cannot show: controls other than a new line and a tab. */
const CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;
/** Characters nobody can see, which would make two tags that look the same: the format
 *  characters (joiners, direction marks, the soft hyphen, tag characters), the variation
 *  selectors, the combining grapheme joiner, and the letters and the braille cell that are
 *  drawn as a blank (the Hangul fillers, two Khmer vowels). */
const UNSEEN = /[\p{Cf}\u034F\u115F\u1160\u17B4\u17B5\u180B-\u180F\u2800\u3164\uFE00-\uFE0F\uFFA0\u{E0100}-\u{E01EF}]/gu;

/** A tag as the gym typed it: look-alike forms made plain (full-width letters), what
 *  nobody can see dropped, the spaces around and inside it tidied. */
export const tidyMemberTagName = (raw: string): string => raw.normalize("NFKC").replace(CONTROLS, "").replace(UNSEEN, "").replace(/\s+/gu, " ").trim();

/** Whether a tag's name has anything in it a person can read: a letter, a number or a
 *  mark of its own, and not only an accent that sits on another letter. */
export const memberTagIsSeen = (name: string): boolean => /[\p{L}\p{N}\p{S}\p{P}]/u.test(name);

/** A note as staff typed it: its line breaks kept, its ends trimmed. Joiners inside words
 *  are kept (Hindi and Persian words are written with them). */
export const tidyMemberNoteBody = (raw: string): string => raw.normalize("NFC").replace(/\r\n?/gu, "\n").replace(CONTROLS, "").trim();

/** Whether a note has anything in it a person can see. */
export const memberNoteIsSeen = (body: string): boolean => body.replace(UNSEEN, "").trim() !== "";

const DECIMAL_DIGIT = /\p{Nd}/u;
/** A digit of any script as 0 to 9: Unicode keeps each script's ten digits together, in order. */
function plainDigit(digit: string): string {
  const code = digit.codePointAt(0) ?? 0;
  let zero = code;
  while (DECIMAL_DIGIT.test(String.fromCodePoint(zero - 1))) zero -= 1;
  return String((code - zero) % 10);
}

/** What the card rule reads: a note or tag with every script's digits made plain, every
 *  run of spaces and marks between two digits made one space ("4111 - 1111", "4111:1111",
 *  a new line; a "+" too, except the one that starts a phone number: a space or nothing
 *  before it and a digit straight after), and digits typed one at a time
 *  put together. Read twice, because a character nobody can see may sit inside a group of
 *  digits or stand between two groups: once with those dropped, once with each a space.
 *  Never kept; the words are kept as typed. */
export function cardCheckReadings(text: string): string[] {
  const plain = text.normalize("NFKC").replace(/\p{Nd}/gu, plainDigit);
  const read = (unseenAs: string): string =>
    plain
      .replace(UNSEEN, unseenAs)
      .replace(/(?<=\d)\+|\+(?!\d)/gu, " ")
      .replace(/(?<=\d)[^\p{L}\p{N}+]+(?=\d)/gu, " ")
      .replace(/(?<!\d)\d(?: \d(?!\d))+/gu, (digits) => digits.replace(/ /gu, ""))
      .replace(/\s+/gu, " ")
      .trim();
  const dropped = read("");
  const spaced = read(" ");
  return dropped === spaced ? [dropped] : [dropped, spaced];
}

export const memberNoteAddRequestSchema = z
  .object({
    body: z
      .string()
      .max(MEMBER_NOTE_MAX_CHARS * 2)
      .transform(tidyMemberNoteBody)
      .pipe(z.string().min(1).max(MEMBER_NOTE_MAX_CHARS).refine(memberNoteIsSeen, { message: "a note needs words" })),
    /** The press that made it: the same press again adds nothing. */
    requestKey: z.string().uuid(),
  })
  .strict();
export type MemberNoteAddRequest = z.infer<typeof memberNoteAddRequestSchema>;

const tagNameSchema = z
  .string()
  .max(MEMBER_TAG_MAX_CHARS * 4)
  .transform(tidyMemberTagName)
  .pipe(z.string().min(1).max(MEMBER_TAG_MAX_CHARS).refine(memberTagIsSeen, { message: "a tag needs a name" }));

/** One of the gym's tags, picked; or a name typed, which is that tag if the gym has it and
 *  a new one if not. */
export const memberTagAddRequestSchema = z.union([z.object({ id: z.string().uuid() }).strict(), z.object({ name: tagNameSchema }).strict()]);
export type MemberTagAddRequest = z.infer<typeof memberTagAddRequestSchema>;

export const memberNoteSchema = z
  .object({
    id: z.string().uuid(),
    body: z.string(),
    /** Who wrote it; null once that account is gone. */
    authorName: z.string().nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type MemberNote = z.infer<typeof memberNoteSchema>;

export const memberTagSchema = z.object({ id: z.string().uuid(), name: z.string() }).strict();
export type MemberTag = z.infer<typeof memberTagSchema>;

/** One person's newest notes (newest first) and tags, and every tag the gym has made. */
export const memberNotesAndTagsSchema = z
  .object({
    notes: z.array(memberNoteSchema).max(MEMBER_NOTES_PAGE),
    /** Every note the person has; more than `notes` holds after two full records are joined. */
    notesTotal: z.number().int().min(0),
    tags: z.array(memberTagSchema),
    gymTags: z.array(memberTagSchema),
  })
  .strict();
export type MemberNotesAndTags = z.infer<typeof memberNotesAndTagsSchema>;

/** The notes older than one the page already shows: `before` is the oldest note shown. */
export const memberNotesOlderQuerySchema = z.object({ before: z.string().uuid() }).strict();
export const memberNotesOlderResponseSchema = z
  .object({
    notes: z.array(memberNoteSchema).max(MEMBER_NOTES_PAGE),
    /** There are notes older than these. */
    more: z.boolean(),
  })
  .strict();
export type MemberNotesOlder = z.infer<typeof memberNotesOlderResponseSchema>;

export const MEMBER_NOTES_WORDS = {
  note_not_found: "That note isn't there any more.",
  note_holds_card:
    "This note looks like it holds a payment card number. We never store card details. Take the number out, then save it again.",
  tag_holds_card:
    "This tag looks like it holds a payment card number. We never store card details. Take the number out, then add it again.",
  note_not_saved: "We couldn't save that note. Please press Save note again.",
  too_many_notes: `This person already has ${String(MEMBER_NOTES_MAX_PER_PERSON)} notes or more, which is as many as we keep. Delete one you no longer need, then add this one.`,
  too_many_tags_person: `This person already has ${String(MEMBER_TAGS_MAX_PER_PERSON)} tags or more, which is as many as one person can have. Take one off, then add this one.`,
  too_many_tags_gym: `Your gym already has ${String(MEMBER_TAGS_MAX_PER_GYM)} tags, which is as many as we keep. Pick one of them instead.`,
} as const;

/** The line under the Notes box. */
export const MEMBER_NOTES_STAFF_ONLY_WORDS = "Only your staff see notes. Keep health details to what staff need to know.";
/** The line under the Tags box. */
export const MEMBER_TAGS_STAFF_ONLY_WORDS = "Only your staff see tags.";
/** A note whose writer's account is gone. */
export const MEMBER_NOTE_NO_AUTHOR_WORDS = "Someone no longer here";

// ── Tags on the Members list (5d-ii; spec §18.13) ──────────────────────────
//
// A tag is a filter on the list; the people selected are tagged or untagged together; a
// gym renames or deletes its own tags. Staff only, as above.

/** One of the gym's tags with how many records hold it: members, and past members. */
export const memberGymTagSchema = z
  .object({ id: z.string().uuid(), name: z.string(), people: z.number().int().min(0), pastPeople: z.number().int().min(0) })
  .strict();
export type MemberGymTag = z.infer<typeof memberGymTagSchema>;

export const memberGymTagsResponseSchema = z.object({ tags: z.array(memberGymTagSchema) }).strict();

export const memberTagRenameRequestSchema = z.object({ name: tagNameSchema }).strict();
export type MemberTagRenameRequest = z.infer<typeof memberTagRenameRequestSchema>;

/** Deleting a tag says how many people its box named: members and past members together. */
export const memberTagDeleteQuerySchema = z
  .object({
    people: z
      .string()
      .regex(/^[0-9]{1,6}$/u)
      .transform((digits) => Number(digits)),
  })
  .strict();

/** Add a tag to the people selected (one of the gym's, or a new one), or take one off them. */
export const memberTagsSelectedRequestSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("add"),
      selection: memberListSelectionSchema,
      tag: z.union([z.object({ id: z.string().uuid() }).strict(), z.object({ name: tagNameSchema }).strict()]),
    })
    .strict(),
  z.object({ action: z.literal("remove"), selection: memberListSelectionSchema, tagId: z.string().uuid() }).strict(),
]);
export type MemberTagsSelectedRequest = z.infer<typeof memberTagsSelectedRequestSchema>;

export const memberTagPersonSchema = z.object({ entryId: z.string().uuid(), name: z.string() }).strict();
export type MemberTagPerson = z.infer<typeof memberTagPersonSchema>;

/** Why someone selected does not change:
 *  - `has_it`: already has the tag being added;
 *  - `not_on_them`: does not have the tag being taken off;
 *  - `full`: already holds as many tags as one person can;
 *  - `gone`: no longer on the list since the page was read (counted, never named). */
export const memberTagKeptReasonSchema = z.enum(["has_it", "not_on_them", "full", "gone"]);
export type MemberTagKeptReason = z.infer<typeof memberTagKeptReasonSchema>;

/** The most names the box carries for one group; the rest are counted. */
export const MEMBER_TAG_BOX_NAMES_MAX = 100;

/** The box before the press: who gets the tag (or loses it), and who doesn't change and why. */
export const memberTagsPreviewSchema = z
  .object({
    action: z.enum(["add", "remove"]),
    /** `id` is null for a tag the gym does not have yet. */
    tag: z.object({ id: z.string().uuid().nullable(), name: z.string() }).strict(),
    selected: z.number().int().min(0),
    /** How many change; `change` names the first of them. */
    changeCount: z.number().int().min(0),
    change: z.array(memberTagPersonSchema).max(MEMBER_TAG_BOX_NAMES_MAX),
    kept: z.array(
      z
        .object({ reason: memberTagKeptReasonSchema, count: z.number().int().min(1), people: z.array(memberTagPersonSchema).max(MEMBER_TAG_BOX_NAMES_MAX) })
        .strict(),
    ),
  })
  .strict();
export type MemberTagsPreview = z.infer<typeof memberTagsPreviewSchema>;

export const memberTagsPreviewResponseSchema = z.object({ preview: memberTagsPreviewSchema }).strict();

/** What a press did, and the gym's tags as they now stand. */
export const memberTagsDoneSchema = z
  .object({
    action: z.enum(["add", "remove"]),
    tag: memberTagSchema,
    changed: z.number().int().min(0),
    kept: z.array(z.object({ reason: memberTagKeptReasonSchema, count: z.number().int().min(1) }).strict()),
  })
  .strict();
export type MemberTagsDone = z.infer<typeof memberTagsDoneSchema>;

export const memberTagsDoneResponseSchema = z.object({ done: memberTagsDoneSchema, tags: z.array(memberGymTagSchema) }).strict();

export const MEMBER_TAGS_WORDS = {
  tag_not_found: "That tag isn't there any more.",
  tag_name_taken: "Your gym already has a tag with that name. Pick another name.",
  tag_for_nobody: "Nobody you selected can get that tag any more, so it wasn't made. Check who is selected and try again.",
  tag_people_changed: "The people who have this tag changed while this box was open, so nothing was deleted. Check who it comes off, then press Delete tag again.",
} as const;
