// What events and challenges share with posts, in a file of its own: `posts.ts` reads a
// challenge's shape for a result post, so neither of them can read `posts.ts`.

/** The most one photo of a post may weigh, as sent. */
export const GYM_POST_PHOTO_MAX_BYTES = 1024 * 1024;

/** How long a post's words are, as the screen and the database count them: by character,
 *  so an emoji is one, not the two units a JavaScript string holds it in. */
export function postLength(text: string): number {
  return Array.from(text).length;
}

/** Characters that draw nothing: space aside, these alone would show as a blank comment. Named one by one, since the
 *  phone's engine shares this file. */
const DRAWS_NOTHING = /[\u0085\u034F\u115F\u1160\u17B4\u17B5\u180B-\u180F\uFFF0-\uFFFB\u{1BCA0}-\u{1BCA3}\u{1D173}-\u{1D17A}\u{E0080}-\u{E0FFF}\u00AD\u0600-\u0605\u061C\u06DD\u070F\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\u2800\u3164\uFE00-\uFE0F\uFEFF\uFFA0\u{E0000}-\u{E007F}]/gu;

/** Whether anything would show. */
export const hasCommentWords = (text: string): boolean => text.replace(DRAWS_NOTHING, "").trim() !== "";

export const DISGUISED_WORDS = "We can't post this because it holds hidden characters. Type it again instead of copying it.";
