// WHERE THE LAST PAGE OF A GYM'S LIST ENDED (Part 3 §9.9).
//
// **IT LIVES HERE AND NOT IN `@app/shared` FOR ONE REASON: `Buffer`.** That package
// is read by the web app in a browser as well as by this server, and nothing in it
// touches a Node global. A cursor is opaque to a screen — it is handed back exactly
// as it arrived and never built or read there — so how it is made is the server's
// own business, and `@app/shared` carries only the fact that it is a string.
//
// **IT IS A PERSON AND NOT A PLACE.** An offset into a list a colleague is editing
// while somebody reads it skips people and shows others twice; the last name and id
// of the page before cannot. The id is in it so that two people called the same
// thing are two pages apart rather than one of them blocking the other for ever.
//
// **NOTHING IN IT IS A SECRET AND NOTHING IN IT IS TRUSTED.** It holds a name the
// reader has just been shown and an id of a row in their own gym; a tampered one can
// only move the page within that gym's list, because the gym is in the `WHERE`
// either way. It is parsed on the way back in like every other outside input.
import { z } from "zod";
import { MEMBER_LIST_MAX_NAME_CHARS } from "@app/shared";

export const entryCursorSchema = z
  .object({ name: z.string().max(MEMBER_LIST_MAX_NAME_CHARS), id: z.string().uuid() })
  .strict();
export type EntryCursor = z.infer<typeof entryCursorSchema>;

export function encodeEntryCursor(cursor: EntryCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/** Null for anything that is not one of ours — a truncated cursor, somebody else's
 *  base64, a document of the wrong shape, a name longer than a name can be. The
 *  caller answers 400: falling back to "the first page" would silently restart a
 *  walk through ten thousand names and nothing would say why. */
export function decodeEntryCursor(raw: string): EntryCursor | null {
  let parsed: unknown;
  try {
    // `Buffer.from` never throws on bad base64 — it drops what it cannot read — so
    // the JSON parse below is what actually rejects a mangled cursor, and the
    // schema is what rejects a well-formed document of the wrong shape.
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const cursor = entryCursorSchema.safeParse(parsed);
  return cursor.success ? cursor.data : null;
}
