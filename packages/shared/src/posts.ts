// A GYM'S UPDATES — spec Part 3 §15.2; ROADMAP 19b-i.
//
// Posts by the gym's staff, with up to four photos, read by its live app members and by
// staff holding `posts.manage`. One reaction a person a post, and no comments (RULINGS
// 2026-08-25, kept 2026-09-22). A post stays until staff remove it (RULINGS 2026-10-04).
import { z } from "zod";
import { GYM_PAGE_PHOTO_MAX_BYTES, gymPagePhotoSchema } from "./gymPage.js";

export const GYM_POST_MAX_CHARS = 2000;
export const GYM_POST_MAX_PHOTOS = 4;
/** Posts kept at the top of the page at once. */
export const GYM_POST_MAX_PINNED = 3;
/** Posts a page of the list carries; the pinned ones ride on the first page beside them. */
export const GYM_POSTS_PAGE = 20;

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
  })
  .strict();
export type GymPost = z.infer<typeof gymPostSchema>;

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
    if (cut < 0 || !at.success || !id.success || Number.isNaN(new Date(at.data).getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "not a place in the list" });
      return z.NEVER;
    }
    return { at: at.data, id: id.data };
  });
export const gymPostsQuerySchema = z.object({ before: postsCursor.optional() }).strict();
export type GymPostsQuery = z.infer<typeof gymPostsQuerySchema>;
export type GymPostsCursor = NonNullable<GymPostsQuery["before"]>;

const feedShape = {
  gymId: z.string().uuid(),
  gymName: z.string(),
  /** The pinned posts, newest pin first; on the first page only. */
  pinned: z.array(gymPostSchema).max(GYM_POST_MAX_PINNED),
  /** Newest first. */
  posts: z.array(gymPostSchema).max(GYM_POSTS_PAGE),
  /** `before` for the next page, or null when this is the last. */
  next: z.string().nullable(),
};

/** What a member reads. `paused`: the gym's plan has lapsed, and nothing is sent. */
export const gymPostsResponseSchema = z.object({ ...feedShape, status: z.enum(["shown", "paused"]) }).strict();
export type GymPostsResponse = z.infer<typeof gymPostsResponseSchema>;

/** What staff read. */
export const staffGymPostsResponseSchema = z.object(feedShape).strict();
export type StaffGymPostsResponse = z.infer<typeof staffGymPostsResponseSchema>;

const photoBase64 = z
  .string()
  .min(4)
  .max(Math.ceil(GYM_PAGE_PHOTO_MAX_BYTES / 3) * 4)
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

export const gymPostParamsSchema =z.object({ gymId: z.string().uuid(), postId: z.string().uuid() }).strict();
export const gymPostPhotoParamsSchema = gymPostParamsSchema.extend({ photoId: z.string().uuid() }).strict();

/** What a person reads when a post cannot be made, changed or found. */
export const GYM_POST_WORDS = {
  not_found: "This post has been removed.",
  pins_full: `You can pin up to ${String(GYM_POST_MAX_PINNED)} posts. Unpin one to pin this.`,
  photo_not_found: "This photo has been removed.",
  /** Which of a post's photos was refused, counted from 1. */
  photo: (position: number, why: string): string => `Photo ${String(position)}: ${why}`,
} as const;
