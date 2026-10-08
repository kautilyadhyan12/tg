// STAFF NOTES AND TAGS on a person's page (ROADMAP Stage 2 item 5d; spec Part 3 §18.13).
//
// Staff only: nothing here is sent to the member's app, an email or the CSV download.
import { z } from "zod";

export const MEMBER_NOTE_MAX_CHARS = 2000;
/** Notes one person's page holds; the oldest is deleted by staff before another is added. */
export const MEMBER_NOTES_MAX_PER_PERSON = 200;
export const MEMBER_TAG_MAX_CHARS = 30;
export const MEMBER_TAGS_MAX_PER_GYM = 100;
export const MEMBER_TAGS_MAX_PER_PERSON = 20;

/** A tag as the gym typed it, with the spaces around and inside it tidied. */
export const tidyMemberTagName = (raw: string): string => raw.normalize("NFC").replace(/\s+/gu, " ").trim();

export const memberNoteAddRequestSchema = z
  .object({
    body: z
      .string()
      .max(MEMBER_NOTE_MAX_CHARS * 2)
      .transform((raw) => raw.normalize("NFC").replace(/\r\n?/gu, "\n").trim())
      .pipe(z.string().min(1).max(MEMBER_NOTE_MAX_CHARS)),
    /** The press that made it: the same press again adds nothing. */
    requestKey: z.string().uuid(),
  })
  .strict();
export type MemberNoteAddRequest = z.infer<typeof memberNoteAddRequestSchema>;

export const memberTagAddRequestSchema = z
  .object({
    name: z
      .string()
      .max(MEMBER_TAG_MAX_CHARS * 4)
      .transform(tidyMemberTagName)
      .pipe(z.string().min(1).max(MEMBER_TAG_MAX_CHARS)),
  })
  .strict();
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

/** One person's notes (newest first) and tags, and every tag the gym has made. */
export const memberNotesAndTagsSchema = z
  .object({
    notes: z.array(memberNoteSchema),
    tags: z.array(memberTagSchema),
    gymTags: z.array(memberTagSchema),
  })
  .strict();
export type MemberNotesAndTags = z.infer<typeof memberNotesAndTagsSchema>;

export const MEMBER_NOTES_WORDS = {
  note_not_found: "That note isn't there any more.",
  note_holds_card:
    "This note looks like it holds a payment card number. We never store card details. Take the number out, then save it again.",
  too_many_notes: `This person already has ${String(MEMBER_NOTES_MAX_PER_PERSON)} notes, which is as many as we keep. Delete one you no longer need, then add this one.`,
  too_many_tags_person: `This person already has ${String(MEMBER_TAGS_MAX_PER_PERSON)} tags, which is as many as one person can have. Take one off, then add this one.`,
  too_many_tags_gym: `Your gym already has ${String(MEMBER_TAGS_MAX_PER_GYM)} tags, which is as many as we keep. Pick one of them instead.`,
} as const;

/** The line under the Notes box. */
export const MEMBER_NOTES_STAFF_ONLY_WORDS = "Only your staff see notes. Keep health details to what staff need to know.";
/** The line under the Tags box. */
export const MEMBER_TAGS_STAFF_ONLY_WORDS = "Only your staff see tags.";
/** A note whose writer's account is gone. */
export const MEMBER_NOTE_NO_AUTHOR_WORDS = "Someone no longer here";
