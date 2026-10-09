// What events and challenges share with posts, in a file of its own: `posts.ts` reads a
// challenge's shape for a result post, so neither of them can read `posts.ts`.

/** The most one photo of a post may weigh, as sent. */
export const GYM_POST_PHOTO_MAX_BYTES = 1024 * 1024;

/** How long a post's words are, as the screen and the database count them: by character,
 *  so an emoji is one, not the two units a JavaScript string holds it in. */
export function postLength(text: string): number {
  return Array.from(text).length;
}
