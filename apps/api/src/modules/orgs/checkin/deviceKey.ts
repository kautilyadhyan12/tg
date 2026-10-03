// THE DESK DEVICE'S COOKIE (spec Part 3 §12.3). Pure: the secret comes in as an argument.
//
// The cookie is the device's key and the server's own mark on it, so the rate limits can
// tell a desk the server set up from anybody at the same address without reading the
// database: a marked key is counted on its own, everything else by its address. The mark
// opens nothing; the key is still looked up, by its hash, for every scan.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const KEY = /^[A-Za-z0-9_-]{43}$/;
const MARK_LENGTH = 22;
const DOMAIN = "aihg-checkin-device-v1";

const markOf = (secret: Buffer, key: string): string =>
  createHmac("sha256", secret).update(DOMAIN).update(key).digest("base64url").slice(0, MARK_LENGTH);

/** What goes in the cookie when a device opens its link. */
export function deviceCookieValue(secret: Buffer, key: string): string {
  return `${key}.${markOf(secret, key)}`;
}

/** The key in a cookie and whether the server's mark is on it; null for anything that is
 *  not shaped like a key. A key with no mark is a desk set up before the mark existed. */
export function readDeviceCookie(secret: Buffer, raw: string | undefined): { key: string; marked: boolean } | null {
  if (raw === undefined) return null;
  const dot = raw.indexOf(".");
  const key = dot === -1 ? raw : raw.slice(0, dot);
  if (!KEY.test(key)) return null;
  if (dot === -1) return { key, marked: false };
  const given = Buffer.from(raw.slice(dot + 1), "utf8");
  const expected = Buffer.from(markOf(secret, key), "utf8");
  return { key, marked: given.length === expected.length && timingSafeEqual(given, expected) };
}

/** A marked device's name for a rate limit: its key's hash, never the key. */
export function deviceLimitId(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}
