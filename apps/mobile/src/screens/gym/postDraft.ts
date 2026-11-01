import { GYM_POST_MAX_PHOTOS, GYM_POST_PHONE_PHOTO_MAX_BYTES, cleanPhoto, gymPostDraftFileSchema, type GymPostDraftFile } from "@app/shared";
import { fromBase64, toBase64 } from "../food/photo";

// A member's post on the phone (ROADMAP Stage 5 17b): its photos made small and rebuilt here, and the post kept
// until the server has it. Pure: the screen draws the photos and holds the files.

/** The qualities a photo is tried at until it fits. */
export const POST_PHOTO_QUALITIES = [0.75, 0.6, 0.45] as const;

export type PostPhotoReading = { ok: true; base64: string } | { ok: false; problem: "too_big" | "unreadable" };

/** The photo as it goes up: the picture the phone drew, rebuilt by the shared cleaner from the parts that draw the
 *  picture, so no tag of the camera's (where and when it was taken) can go with it, whatever the drawing kept. */
export function postPhotoToSend(base64: string): PostPhotoReading {
  const bytes = fromBase64(base64);
  if (bytes === null) return { ok: false, problem: "unreadable" };
  const cleaned = cleanPhoto(bytes, { maxBytes: GYM_POST_PHONE_PHOTO_MAX_BYTES });
  if (!cleaned.ok) return { ok: false, problem: cleaned.problem === "too_big" ? "too_big" : "unreadable" };
  return { ok: true, base64: toBase64(cleaned.bytes) };
}

export type DraftPost = Omit<GymPostDraftFile, "version">;

/** Whether there is anything in it to keep. */
export const hasWork = (draft: Pick<DraftPost, "body" | "photos">): boolean => draft.body !== "" || draft.photos.length > 0;

export const draftFileText = (draft: DraftPost): string => JSON.stringify({ version: 1, ...draft });

/** The kept post, where it can be read; anything else is nothing. */
export function readDraftFile(text: string | null): DraftPost | null {
  if (text === null || text === "") return null;
  let raw: unknown = null;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = gymPostDraftFileSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { postKey, body, photos, sent, changed } = parsed.data;
  return { postKey, body, photos, ...(sent === undefined ? {} : { sent }), ...(changed === undefined ? {} : { changed }) };
}

/** Under the box: who sees it. A full day is said by the server's own sentence when it happens. */
export const postHint = (gymName: string): string => `Everyone at ${gymName} in the app sees it straight away. Where a photo was taken is never kept.`;

/** What the member reads about photos that could not be added. */
export function photoTrouble({ unreadable, tooBig, left }: { unreadable: number; tooBig: number; left: number }): string | null {
  const photos = (n: number) => (n === 1 ? "1 photo" : `${String(n)} photos`);
  const lines: string[] = [];
  if (unreadable > 0) lines.push(`${photos(unreadable)} couldn't be opened. Choose another one.`);
  if (tooBig > 0) lines.push(`${photos(tooBig)} ${tooBig === 1 ? "is" : "are"} too large even made smaller. Choose a smaller one.`);
  if (left > 0) lines.push(`A post holds up to ${String(GYM_POST_MAX_PHOTOS)} photos, so ${left === 1 ? "1 photo was" : `${String(left)} photos were`} not added.`);
  return lines.length === 0 ? null : lines.join(" ");
}

/** What a kept post says when the post it went up as has since been removed: its key is spent, so it goes under a new one. */
export const removedAndKept = (serverWords: string): string => `${serverWords} Press Post to post it again.`;

/** Said where the button is once a post is up. Only the server knows whether a send whose answer was lost reached it:
 *  it says whether this send made the post. If not, changes made since may not have gone: any of several sends may have made it. */
export const POST_UP = "Your post is up.";
/** An earlier send made the post, as it first was, and they have changed it since: those words are still theirs. */
export const FIRST_POST_UP = "Your first version is up. Press Post to post this one as well, or Discard it.";
/** Refused for now, after a send whose answer never came: that send may have made it. */
export const POST_MAY_BE_UP = "This post may already be up. Check Updates. You can discard this copy.";
