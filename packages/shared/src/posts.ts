// A GYM'S UPDATES — spec Part 3 §15.2, §15.3; ROADMAP 19b-i, 19b-ii-a, 19b-ii-c.
//
// Posts by the gym's staff and, where the gym has switched it on, by its members, with up
// to four photos, read by its live app members and by staff holding `posts.manage`. One
// reaction a person a post, and no comments (RULINGS 2026-08-25, kept 2026-09-22). A post
// stays until it is removed: by staff, or a member's own by the member (RULINGS 2026-10-04).
// Any member can report a post; staff see the reported ones in a list of their own.
import { z } from "zod";
import { gymPagePhotoSchema } from "./gymPage.js";

export const GYM_POST_MAX_CHARS = 2000;
export const GYM_POST_MAX_PHOTOS = 4;
/** Longest side the browser shrinks a post's photo to before it is sent (ROADMAP 19b-iv). */
export const GYM_POST_PHOTO_SEND_SIDE = 1600;
/** The most one photo of a post may weigh, as sent. */
export const GYM_POST_PHOTO_MAX_BYTES = 1024 * 1024;
/** Posts kept at the top of the page at once. */
export const GYM_POST_MAX_PINNED = 3;
/** Posts a page of the list carries; the pinned ones ride on the first page beside them. */
export const GYM_POSTS_PAGE = 20;
/** Posts one member may make at one gym in any 24 hours. */
export const GYM_MEMBER_POSTS_A_DAY = 10;
/** Of those, the posts that may carry photos (RULINGS 2026-10-05). */
export const GYM_MEMBER_PHOTO_POSTS_A_DAY = 3;
/** Reported posts the staff list carries, longest waiting first. */
export const GYM_POST_REPORTS_SHOWN = 50;
/** The words a person may type beside their reason for a report, by `postLength`. */
export const GYM_POST_REPORT_NOTE_MAX = 300;
/** What people typed that one reported post carries for staff, oldest first. */
export const GYM_POST_REPORT_NOTES_SHOWN = 20;
/** People stopped from posting the staff list carries. */
export const GYM_POST_STOPS_SHOWN = 200;

/** Why a post is reported, in the order the choices are drawn. */
export const GYM_POST_REPORT_REASONS = ["unkind", "photo_of_someone", "nudity", "spam", "other"] as const;
export const gymPostReportReasonSchema = z.enum(GYM_POST_REPORT_REASONS);
export type GymPostReportReason = z.infer<typeof gymPostReportReasonSchema>;

export const GYM_POST_REPORT_REASON_WORDS: Record<GymPostReportReason, string> = {
  unkind: "Bullying or unkind",
  photo_of_someone: "A photo of someone who didn't agree to it",
  nudity: "Nudity or sexual",
  spam: "Spam or selling",
  other: "Something else",
};

/** The reactions, in the order the buttons are drawn. */
export const GYM_POST_REACTIONS = ["like", "love", "strong", "fire"] as const;
export const gymPostReactionSchema = z.enum(GYM_POST_REACTIONS);
export type GymPostReaction = z.infer<typeof gymPostReactionSchema>;

export const GYM_POST_REACTION_WORDS: Record<GymPostReaction, string> = {
  like: "Like",
  strong: "Strong",
  fire: "Fire",
  love: "Love",
};

const NUL = String.fromCharCode(0);

/** A post's photo: the picture is at `/v1/orgs/{gymId}/posts/{postId}/photos/{id}`. */
export const gymPostPhotoSchema = gymPagePhotoSchema;
export type GymPostPhoto = z.infer<typeof gymPostPhotoSchema>;

const reactionCountsSchema = z
  .object({
    like: z.number().int().nonnegative(),
    strong: z.number().int().nonnegative(),
    fire: z.number().int().nonnegative(),
    love: z.number().int().nonnegative(),
  })
  .strict();
export type GymPostReactionCounts = z.infer<typeof reactionCountsSchema>;

/** How long a post's words are, as the screen and the database count them: by character,
 *  so an emoji is one, not the two units a JavaScript string holds it in. */
export function postLength(text: string): number {
  return Array.from(text).length;
}

/** A post's words: at most 2,000 characters by `postLength`. The unit cap in front of it
 *  only stops a huge string being walked. */
const postWords = z
  .string()
  .max(GYM_POST_MAX_CHARS * 2)
  .refine((text) => postLength(text) <= GYM_POST_MAX_CHARS, { message: "too many characters" });

export const gymPostSchema = z
  .object({
    id: z.string().uuid(),
    /** Who posted: first name and last initial for members, the whole name for staff;
     *  null when the account is gone, and the screen says the gym's name. */
    author: z.object({ name: z.string().nullable(), initials: z.string() }).strict(),
    body: postWords,
    photos: z.array(gymPostPhotoSchema).max(GYM_POST_MAX_PHOTOS),
    pinned: z.boolean(),
    createdAt: z.string().datetime({ offset: true }),
    reactions: reactionCountsSchema,
    /** The reader's own reaction. */
    mine: gymPostReactionSchema.nullable(),
    /** A member's own post, as against one by the gym's staff. */
    fromMember: z.boolean(),
    /** The member who wrote it, whose posts a tap on the name opens; null for a staff post. */
    authorId: z.string().uuid().nullable(),
    /** The reader wrote it as a member, and may remove it. */
    own: z.boolean(),
    /** The reader wrote it, as a member or as staff: nothing of theirs offers Report. */
    wrote: z.boolean(),
    /** The reader has reported it. Always false for staff reading the console. */
    reported: z.boolean(),
  })
  .strict();
export type GymPost = z.infer<typeof gymPostSchema>;

/** A post as staff holding the tick read it: a member's post also says whether that
 *  person has been stopped from posting. */
export const staffGymPostSchema = gymPostSchema.extend({ authorStopped: z.boolean() }).strict();
export type StaffGymPost = z.infer<typeof staffGymPostSchema>;

/** Where the next page starts, as a list's `next` gave it: the last post's instant, "_",
 *  its id. Read into the two, each checked as what it is, so nothing the database cannot
 *  read as an instant or an id is ever handed to it. */
const postsCursor = z
  .string()
  .max(80)
  .transform((text, ctx) => {
    const cut = text.lastIndexOf("_");
    const at = z.string().datetime().safeParse(text.slice(0, Math.max(cut, 0)));
    const id = z.string().uuid().safeParse(text.slice(cut + 1));
    // Before 1970 no post exists, and the database cannot read year 0000 at all.
    if (cut < 0 || !at.success || !id.success || !(new Date(at.data).getTime() >= 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "not a place in the list" });
      return z.NEVER;
    }
    return { at: at.data, id: id.data };
  });
export const gymPostsQuerySchema = z.object({ before: postsCursor.optional() }).strict();
export type GymPostsQuery = z.infer<typeof gymPostsQuerySchema>;
export type GymPostsCursor = NonNullable<GymPostsQuery["before"]>;

const feedShape = <P extends z.ZodTypeAny>(post: P) => ({
  gymId: z.string().uuid(),
  gymName: z.string(),
  /** The pinned posts, newest pin first; on the first page only. */
  pinned: z.array(post).max(GYM_POST_MAX_PINNED),
  /** Newest first. */
  posts: z.array(post).max(GYM_POSTS_PAGE),
  /** `before` for the next page, or null when this is the last. */
  next: z.string().nullable(),
});

/** Whether the reader may post as a member: the gym's switch is `off`, or staff have
 *  `stopped` this person. */
export const gymMemberPostingSchema = z.enum(["on", "off", "stopped"]);
export type GymMemberPosting = z.infer<typeof gymMemberPostingSchema>;

/** What a member reads. `paused`: the gym's plan has lapsed, and nothing is sent. */
export const gymPostsResponseSchema = z
  .object({
    ...feedShape(gymPostSchema),
    status: z.enum(["shown", "paused"]),
    posting: gymMemberPostingSchema,
    /** People the reader has blocked at this gym. */
    blockedCount: z.number().int().nonnegative(),
    /** Where to write for help with the app; null until one is set. */
    supportEmail: z.string().email().nullable(),
  })
  .strict();
export type GymPostsResponse = z.infer<typeof gymPostsResponseSchema>;

/** What staff read. */
export const staffGymPostsResponseSchema = z
  .object({
    ...feedShape(staffGymPostSchema),
    /** The gym's switch: whether its members may post. */
    membersCanPost: z.boolean(),
    /** Posts with a report nobody has answered yet. */
    reportedCount: z.number().int().nonnegative(),
  })
  .strict();
export type StaffGymPostsResponse = z.infer<typeof staffGymPostsResponseSchema>;

const photoBase64 = z
  .string()
  .min(4)
  .max(Math.ceil(GYM_POST_PHOTO_MAX_BYTES / 3) * 4)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/);

export const addGymPostRequestSchema = z
  .object({
    /** The browser's key for this one post: the same key again is the same post. */
    postKey: z.string().uuid(),
    body: postWords.refine((text) => !text.includes(NUL), { message: "a character that cannot be kept" }),
    /** Each photo as base64, already shrunk by the browser, in the order shown. */
    photos: z.array(photoBase64).max(GYM_POST_MAX_PHOTOS),
  })
  .strict()
  .refine((post) => post.body.trim() !== "" || post.photos.length > 0, { message: "nothing to post", path: ["body"] });
export type AddGymPostRequest = z.infer<typeof addGymPostRequestSchema>;

export const gymPostResponseSchema = z.object({ post: gymPostSchema }).strict();
export type GymPostResponse = z.infer<typeof gymPostResponseSchema>;
export const staffGymPostResponseSchema = z.object({ post: staffGymPostSchema }).strict();

export const pinGymPostRequestSchema = z.object({ pinned: z.boolean() }).strict();
export const removedGymPostResponseSchema = z.object({ removed: z.literal(true) }).strict();

export const reactToGymPostRequestSchema = z.object({ reaction: gymPostReactionSchema.nullable() }).strict();
export const gymPostReactionResponseSchema = z
  .object({ reactions: reactionCountsSchema, mine: gymPostReactionSchema.nullable() })
  .strict();
export type GymPostReactionResponse = z.infer<typeof gymPostReactionResponseSchema>;

// ── WHO REACTED, for staff holding `posts.manage` (Kd's click-through of 19b-i) ──

/** The most names one reaction's list carries, newest first; `total` says how many there are. */
export const GYM_POST_REACTORS_SHOWN = 100;
export const gymPostReactorsQuerySchema = z.object({ reaction: gymPostReactionSchema }).strict();
export const gymPostReactorsResponseSchema = z
  .object({
    reaction: gymPostReactionSchema,
    total: z.number().int().nonnegative(),
    /** Whole names, as on Members; null for a person with no name to show. */
    people: z.array(z.object({ name: z.string().nullable(), initials: z.string() }).strict()).max(GYM_POST_REACTORS_SHOWN),
  })
  .strict();
export type GymPostReactorsResponse = z.infer<typeof gymPostReactorsResponseSchema>;

export const gymPostParamsSchema = z.object({ gymId: z.string().uuid(), postId: z.string().uuid() }).strict();
export const gymPostPhotoParamsSchema = gymPostParamsSchema.extend({ photoId: z.string().uuid() }).strict();

// ── MEMBERS POST, REPORT, AND THE STAFF LIST (19b-ii-a; spec §15.3) ──

/** What a person typed beside their reason: trimmed, and nothing at all is no note. */
const reportNote = z
  .string()
  .max(GYM_POST_REPORT_NOTE_MAX * 2)
  .refine((text) => !text.includes(NUL), { message: "a character that cannot be kept" })
  .transform((text) => text.trim())
  .refine((text) => postLength(text) <= GYM_POST_REPORT_NOTE_MAX, { message: "too many characters" });

export const reportGymPostRequestSchema = z.object({ reason: gymPostReportReasonSchema, note: reportNote.optional() }).strict();
export const reportedGymPostResponseSchema = z.object({ reported: z.literal(true) }).strict();

const reasonCountsSchema = z
  .object({
    unkind: z.number().int().nonnegative(),
    photo_of_someone: z.number().int().nonnegative(),
    nudity: z.number().int().nonnegative(),
    spam: z.number().int().nonnegative(),
    other: z.number().int().nonnegative(),
  })
  .strict();
export type GymPostReasonCounts = z.infer<typeof reasonCountsSchema>;

/** The reported posts staff have not answered, longest waiting first. Who reported is
 *  never sent: only how many, and why. */
export const reportedGymPostsResponseSchema = z
  .object({
    gymId: z.string().uuid(),
    gymName: z.string(),
    items: z
      .array(
        z
          .object({
            post: staffGymPostSchema,
            reports: z.number().int().positive(),
            reasons: reasonCountsSchema,
            /** What reporters typed, oldest first; never who typed it. */
            notes: z.array(z.string()).max(GYM_POST_REPORT_NOTES_SHOWN),
            firstReportedAt: z.string().datetime({ offset: true }),
            /** The newest report counted here: Keep answers the reports up to it and no later one. */
            lastReportedAt: z.string().datetime({ offset: true }),
          })
          .strict(),
      )
      .max(GYM_POST_REPORTS_SHOWN),
    /** Every reported post waiting, listed or not. */
    total: z.number().int().nonnegative(),
  })
  .strict();
export type ReportedGymPostsResponse = z.infer<typeof reportedGymPostsResponseSchema>;

/** Keep answers the reports staff were shown: those made up to `upTo`, the list item's
 *  `lastReportedAt`. One that arrived after it stays open, and the post stays on the list. */
export const keepGymPostRequestSchema = z.object({ upTo: z.string().datetime({ offset: true }) }).strict();
export const keptGymPostResponseSchema = z
  .object({
    kept: z.literal(true),
    /** Reports that arrived after the ones staff were shown, still waiting. */
    waiting: z.number().int().nonnegative(),
  })
  .strict();

export const gymPostSettingsSchema = z.object({ membersCanPost: z.boolean() }).strict();
export type GymPostSettings = z.infer<typeof gymPostSettingsSchema>;

export const gymPosterParamsSchema = z.object({ gymId: z.string().uuid(), userId: z.string().uuid() }).strict();
export const gymPosterStoppedResponseSchema = z.object({ stopped: z.boolean() }).strict();
export const stoppedGymPostersResponseSchema = z
  .object({
    people: z
      .array(
        z
          .object({ userId: z.string().uuid(), name: z.string().nullable(), initials: z.string(), stoppedAt: z.string().datetime({ offset: true }) })
          .strict(),
      )
      .max(GYM_POST_STOPS_SHOWN),
  })
  .strict();
export type StoppedGymPostersResponse = z.infer<typeof stoppedGymPostersResponseSchema>;

// ── BLOCK, AND THE BAD-WORDS CHECK (19b-ii-b; spec §15.3) ──

/** People one member's blocked list carries, newest first. */
export const GYM_POST_BLOCKS_SHOWN = 200;

export const blockedGymPosterResponseSchema = z.object({ blocked: z.boolean() }).strict();
export const gymPostBlockParamsSchema = z.object({ gymId: z.string().uuid(), blockId: z.string().uuid() }).strict();

/** The people the reader has blocked at this gym, named as members see each other. */
export const blockedGymPostersResponseSchema = z
  .object({
    people: z
      .array(
        z
          .object({ id: z.string().uuid(), name: z.string().nullable(), initials: z.string(), blockedAt: z.string().datetime({ offset: true }) })
          .strict(),
      )
      .max(GYM_POST_BLOCKS_SHOWN),
  })
  .strict();
export type BlockedGymPostersResponse = z.infer<typeof blockedGymPostersResponseSchema>;

// ── ONE PERSON'S POSTS, ON THEIR PROFILE (19b-ii-c; RULINGS 2026-10-02, 2026-10-03) ──

/** The posts one person made as a member, newest first, as the reader is sent them on
 *  Updates: none from somebody the reader blocked, none from somebody who has left. An id
 *  that is nobody's reads the same as a member who has not posted. */
export const personGymPostsResponseSchema = z
  .object({
    posts: z.array(gymPostSchema).max(GYM_POSTS_PAGE),
    next: z.string().nullable(),
    /** Every post of theirs the reader is sent, on this page or a later one. */
    total: z.number().int().nonnegative(),
    /** The reader has blocked this person here, which is why no post of theirs is sent. */
    blocked: z.boolean(),
  })
  .strict();
export type PersonGymPostsResponse = z.infer<typeof personGymPostsResponseSchema>;

export const staffPersonGymPostsResponseSchema = z
  .object({ posts: z.array(staffGymPostSchema).max(GYM_POSTS_PAGE), next: z.string().nullable(), total: z.number().int().nonnegative() })
  .strict();
export type StaffPersonGymPostsResponse = z.infer<typeof staffPersonGymPostsResponseSchema>;

/** "in about 5 hours", for a limit counted over any 24 hours: when its oldest post leaves the count. */
function againIn(hours: number): string {
  if (hours <= 0) return "in under an hour";
  return hours === 1 ? "in about 1 hour" : `in about ${String(hours)} hours`;
}

/** What a person reads when a post cannot be made, changed or found. */
export const GYM_POST_WORDS = {
  not_found: "This post has been removed.",
  pins_full: `You can pin up to ${String(GYM_POST_MAX_PINNED)} posts. Unpin one to pin this.`,
  photo_not_found: "This photo has been removed.",
  posting_off: "Members can't post here at the moment.",
  posting_stopped: (gymName: string): string => `The staff at ${gymName} have stopped you posting here. Speak to them at the front desk.`,
  /** `hours`: whole hours until the oldest of the counted posts is 24 hours old. */
  day_full: (hours: number): string =>
    `You've posted ${String(GYM_MEMBER_POSTS_A_DAY)} times in the last 24 hours, which is the most allowed. You can post again ${againIn(hours)}.`,
  /** `hasWords`: the post has words that could go without its photos. */
  photo_day_full: (hours: number, hasWords: boolean): string =>
    hasWords
      ? `You've posted photos ${String(GYM_MEMBER_PHOTO_POSTS_A_DAY)} times in the last 24 hours, which is the most allowed. Take the photos off to post the words now, or post photos again ${againIn(hours)}.`
      : `You've posted photos ${String(GYM_MEMBER_PHOTO_POSTS_A_DAY)} times in the last 24 hours, which is the most allowed. You can post photos again ${againIn(hours)}.`,
  own_report: "This is your own post. You can remove it instead.",
  person_not_found: "This person isn't one of your members.",
  own_block: "This is your own post.",
  gym_block: "This post is from the gym's staff, so it can't be blocked. You can report it instead.",
  block_not_found: "This person isn't blocked any more.",
  /** A member's post the app will not take, naming each word it found. */
  bad_words: (words: readonly string[]): string =>
    words.length === 1
      ? `Your post wasn't posted because it has a word that isn't allowed here: ${words[0] ?? ""}. Take it out and post again.`
      : `Your post wasn't posted because it has words that aren't allowed here: ${words.join(", ")}. Take them out and post again.`,
  /** Which of a post's photos was refused, counted from 1. */
  photo: (position: number, why: string): string => `Photo ${String(position)}: ${why}`,
  photo_too_big: "This photo is bigger than 1 MB. Choose a smaller one.",
} as const;
