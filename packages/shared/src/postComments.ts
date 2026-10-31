// COMMENTS ON A GYM'S UPDATES — ROADMAP Stage 5 17e; spec Part 3 §15.2.
//
// A comment on a post, or a reply one level under a comment; a reply to a reply goes in the same
// list and names who it answers. Words only. One reaction a person each, Report, Block and Remove
// work as on a post. A member writes up to 100 a day (Kd, 2026-10-30, `rulings/2026-10-30-17b.md`).
import { z } from "zod";
import { postLength } from "./postBasics.js";
import { gymMemberPostingSchema, gymPostReactionSchema, postsCursor, reactionCountsSchema, reportNote } from "./posts.js";

/** The words of one comment or reply, by `postLength`. */
export const GYM_POST_COMMENT_MAX_CHARS = 500;
/** The most a comment not yet sent may hold on the phone: over the limit is said, and the words are not cut. */
export const GYM_POST_COMMENT_DRAFT_MOST = GYM_POST_COMMENT_MAX_CHARS * 4;
/** Comments and replies one member may write at one gym in any 24 hours. */
export const GYM_MEMBER_COMMENTS_A_DAY = 100;
/** Comments, or replies under one comment, on a page. */
export const GYM_POST_COMMENTS_PAGE = 20;
/** This many people reporting a comment, with none of it answered, hide it until staff decide. */
export const GYM_POST_COMMENT_REPORTS_TO_HIDE = 5;

/** Why a comment is reported, in drawing order: as a post's, without the one about a photo. */
export const GYM_POST_COMMENT_REPORT_REASONS = ["unkind", "nudity", "spam", "other"] as const;
export const gymPostCommentReportReasonSchema = z.enum(GYM_POST_COMMENT_REPORT_REASONS);
export type GymPostCommentReportReason = z.infer<typeof gymPostCommentReportReasonSchema>;

const NUL = String.fromCharCode(0);

export const gymPostCommentSchema = z
  .object({
    id: z.string().uuid(),
    postId: z.string().uuid(),
    /** The comment this is a reply under; null on a comment. */
    parentId: z.string().uuid().nullable(),
    /** A reply to a reply: the name of who it answers, while the reader may see that reply. */
    replyingTo: z.string().nullable(),
    author: z.object({ name: z.string().nullable(), initials: z.string() }).strict(),
    body: z.string(),
    createdAt: z.string().datetime({ offset: true }),
    reactions: reactionCountsSchema,
    mine: gymPostReactionSchema.nullable(),
    fromMember: z.boolean(),
    authorId: z.string().uuid().nullable(),
    /** The reader wrote it as a member, and may remove it. */
    own: z.boolean(),
    wrote: z.boolean(),
    reported: z.boolean(),
    /** Hidden from members while staff decide; a member is sent one only when they wrote it. */
    hidden: z.boolean(),
    /** Replies under it that this reader is sent; 0 on a reply. */
    replyCount: z.number().int().nonnegative(),
  })
  .strict();
export type GymPostComment = z.infer<typeof gymPostCommentSchema>;

export const gymPostCommentsQuerySchema = z.object({ after: postsCursor.optional() }).strict();
export type GymPostCommentsCursor = NonNullable<z.infer<typeof gymPostCommentsQuerySchema>["after"]>;

/** A post's comments, or a comment's replies, oldest first. */
export const gymPostCommentsResponseSchema = z
  .object({
    comments: z.array(gymPostCommentSchema).max(GYM_POST_COMMENTS_PAGE),
    /** `after` for the next page, or null when this is the last. */
    next: z.string().nullable(),
    commenting: gymMemberPostingSchema,
  })
  .strict();
export type GymPostCommentsResponse = z.infer<typeof gymPostCommentsResponseSchema>;

/** Characters that draw nothing: space aside, these alone would show as a blank comment. Named one by one, since the
 *  phone's engine shares this file. */
const DRAWS_NOTHING = /[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/g;

/** Whether anything would show. */
export const hasCommentWords = (text: string): boolean => text.replace(DRAWS_NOTHING, "").trim() !== "";

const commentWords = z
  .string()
  .max(GYM_POST_COMMENT_DRAFT_MOST)
  .refine((text) => !text.includes(NUL), { message: "a character that cannot be kept" })
  .refine(hasCommentWords, { message: "nothing to post" })
  .refine((text) => postLength(text.trim()) <= GYM_POST_COMMENT_MAX_CHARS, { message: "too many characters" });

export const addGymPostCommentRequestSchema = z
  .object({
    /** The phone's key for this one comment: the same key again is the same comment. */
    commentKey: z.string().uuid(),
    body: commentWords,
    /** The comment or reply this answers; left out for a new comment on the post. */
    replyTo: z.string().uuid().optional(),
  })
  .strict();
export type AddGymPostCommentRequest = z.infer<typeof addGymPostCommentRequestSchema>;

/** `firstKept` is false when the answer is a comment kept earlier under the same key. */
export const addedGymPostCommentResponseSchema = z.object({ comment: gymPostCommentSchema, firstKept: z.boolean() }).strict();

export const gymPostCommentParamsSchema = z.object({ gymId: z.string().uuid(), commentId: z.string().uuid() }).strict();
export const reactToGymPostCommentResponseSchema = z.object({ reactions: reactionCountsSchema, mine: gymPostReactionSchema.nullable() }).strict();
export const reportGymPostCommentRequestSchema = z.object({ reason: gymPostCommentReportReasonSchema, note: reportNote.optional() }).strict();
export const reportedGymPostCommentResponseSchema = z.object({ reported: z.literal(true) }).strict();
export const blockedGymPostCommenterResponseSchema = z.object({ blocked: z.literal(true) }).strict();
export const removedGymPostCommentResponseSchema = z.object({ removed: z.literal(true) }).strict();

/** The most comments the phone keeps unsent for one person at one place, one a post. */
export const GYM_POST_COMMENT_DRAFTS_MOST = 50;

/** Comments not yet on the server, as the phone keeps them, by post (ROADMAP Stage 5 17e). */
export const gymPostCommentDraftsFileSchema = z
  .object({
    version: z.literal(1),
    drafts: z.record(
      z.string().uuid(),
      z
        .object({
          commentKey: z.string().uuid(),
          body: z.string().max(GYM_POST_COMMENT_DRAFT_MOST),
          replyTo: z.object({ id: z.string().uuid(), name: z.string().max(200) }).strict().nullable(),
          /** It has been sent under this key, and the answer is not known. */
          sent: z.boolean().optional(),
          /** And it has been changed since. */
          changed: z.boolean().optional(),
        })
        .strict(),
    ),
  })
  .strict();
export type GymPostCommentDraftsFile = z.infer<typeof gymPostCommentDraftsFileSchema>;

/** What a person reads when a comment cannot be made, changed or found. */
export const GYM_POST_COMMENT_WORDS = {
  not_found: "This comment has been removed.",
  commenting_off: "Comments are turned off here.",
  commenting_stopped: (gymName: string): string => `The staff at ${gymName} have stopped you commenting here. Speak to them at the front desk.`,
  /** `hours`: whole hours until the oldest of the counted comments is 24 hours old. */
  day_full: (hours: number): string => {
    const when = hours <= 0 ? "in under an hour" : hours === 1 ? "in about 1 hour" : `in about ${String(hours)} hours`;
    return `You've written ${String(GYM_MEMBER_COMMENTS_A_DAY)} comments in the last 24 hours, which is the most allowed. You can comment again ${when}.`;
  },
  own_report: "This is your own comment. You can remove it instead.",
  own_block: "This is your own comment.",
  gym_block: "This comment is from staff, so it can't be blocked. You can report it instead.",
  bad_words: (words: readonly string[]): string =>
    words.length === 1
      ? `Your comment wasn't posted because it has a word that isn't allowed here: ${words[0] ?? ""}. Take it out and send it again.`
      : `Your comment wasn't posted because it has words that aren't allowed here: ${words.join(", ")}. Take them out and send it again.`,
} as const;
