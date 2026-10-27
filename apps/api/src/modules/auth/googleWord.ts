// The one-time word a phone asks Google with (ROADMAP Stage 5 item 12d). The server
// keeps nothing when it hands one out: the word carries its own end and a signature
// only this server can make, so asking for words, from any number of addresses, fills
// nothing (the security pass on item 12, H4). It is marked used in Redis only when an
// answer from Google brings it back, for the minutes it has left.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** A word is good for ten minutes: Google's box is open about that long at most. */
export const GOOGLE_WORD_LIFE_S = 10 * 60;

const mac = (secret: string, random: string, ends: string) =>
  createHmac("sha256", secret).update(`google-phone-word|${random}|${ends}`).digest("hex");

/** `<32 hex>.<end, seconds>.<64 hex>`: 108 characters. */
export function mintGoogleWord(secret: string, nowMs: number): string {
  const random = randomBytes(16).toString("hex");
  const ends = String(Math.floor(nowMs / 1000) + GOOGLE_WORD_LIFE_S);
  return `${random}.${ends}.${mac(secret, random, ends)}`;
}

/** The seconds a word this server made has left; null for any other word, or one past its end. */
export function googleWordSecondsLeft(secret: string, word: string, nowMs: number): number | null {
  const match = /^([0-9a-f]{32})\.(\d{10})\.([0-9a-f]{64})$/.exec(word);
  if (match === null) return null;
  const [, random = "", ends = "", signed = ""] = match;
  const expected = Buffer.from(mac(secret, random, ends), "hex");
  const presented = Buffer.from(signed, "hex");
  if (expected.length !== presented.length || !timingSafeEqual(expected, presented)) return null;
  const left = Number(ends) - Math.floor(nowMs / 1000);
  return left > 0 && left <= GOOGLE_WORD_LIFE_S ? left : null;
}
