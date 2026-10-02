// THE MEMBER'S CHECK-IN PASS (spec Part 3 §12.2; RULINGS 2026-09-21, 2026-09-23). Pure:
// the clock and the key come in as arguments.
//
// One pass per person, for every gym they belong to: it names the person and a 30-second
// window, signed with HMAC-SHA256, and never a gym — the desk that reads it is the gym.
// The scan takes a pass in its own window and the next one, and only once (a Redis key,
// `service.ts`), so a screenshot sent to a friend is dead within a minute.
//
// Layout: "AHGP" + base32(user id 16 bytes · window 4 bytes · MAC 16 bytes) = 62 letters
// and digits, which a QR code packs in its compact alphanumeric mode.
import { createHmac, timingSafeEqual } from "node:crypto";
import { CHECKIN_PASS_LENGTH, CHECKIN_PASS_PREFIX, CHECKIN_PASS_WINDOW_SECONDS } from "@app/shared";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const MAC_BYTES = 16;
const BODY_BYTES = 16 + 4 + MAC_BYTES;
const DOMAIN = Buffer.from("aihg-checkin-pass-v1", "utf8");

export type PassRead =
  | { kind: "fresh"; userId: string; window: number }
  | { kind: "old" }
  | { kind: "garbled" };

/** The window an instant falls in. */
export function passWindow(now: Date): number {
  return Math.floor(now.getTime() / 1000 / CHECKIN_PASS_WINDOW_SECONDS);
}

/** When a window ends: the moment the app asks for the next pass. */
export function windowEndsAt(window: number): Date {
  return new Date((window + 1) * CHECKIN_PASS_WINDOW_SECONDS * 1000);
}

/** Whether what the desk read is meant to be a pass (anything else is a key tag). Case
 *  is ignored: a scanner typing with Caps Lock on swaps it. */
export function looksLikePass(raw: string): boolean {
  return raw.toUpperCase().startsWith(CHECKIN_PASS_PREFIX);
}

function mac(key: Buffer, user: Buffer, window: Buffer): Buffer {
  return createHmac("sha256", key).update(DOMAIN).update(user).update(window).digest().subarray(0, MAC_BYTES);
}

function uuidBytes(userId: string): Buffer {
  const hex = userId.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error("not a uuid");
  return Buffer.from(hex, "hex");
}

function uuidOf(bytes: Buffer): string {
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function base32(bytes: Buffer): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET.charAt((value << (5 - bits)) & 31);
  return out;
}

/** The bytes, or null for a letter outside the alphabet or spare bits that are not zero
 *  (so one pass has exactly one spelling). */
function fromBase32(text: string, length: number): Buffer | null {
  const out = Buffer.alloc(length);
  let bits = 0;
  let value = 0;
  let at = 0;
  for (const char of text) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) return null;
    value = ((value << 5) | digit) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      if (at >= length) return null;
      out[at++] = (value >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }
  if (at !== length || (value & ((1 << bits) - 1)) !== 0) return null;
  return out;
}

export function makePass(key: Buffer, userId: string, window: number): string {
  const user = uuidBytes(userId);
  const win = Buffer.alloc(4);
  win.writeUInt32BE(window);
  return CHECKIN_PASS_PREFIX + base32(Buffer.concat([user, win, mac(key, user, win)]));
}

/** What a read pass is: fresh in its own window or the one after, old, or garbled (not
 *  ours, altered, or cut short by the scanner). */
export function readPass(key: Buffer, raw: string, nowWindow: number): PassRead {
  const text = raw.toUpperCase();
  if (text.length !== CHECKIN_PASS_LENGTH || !text.startsWith(CHECKIN_PASS_PREFIX)) return { kind: "garbled" };
  const bytes = fromBase32(text.slice(CHECKIN_PASS_PREFIX.length), BODY_BYTES);
  if (bytes === null) return { kind: "garbled" };
  const user = bytes.subarray(0, 16);
  const win = bytes.subarray(16, 20);
  if (!timingSafeEqual(bytes.subarray(20), mac(key, user, win))) return { kind: "garbled" };
  const window = win.readUInt32BE();
  if (window !== nowWindow && window !== nowWindow - 1) return { kind: "old" };
  return { kind: "fresh", userId: uuidOf(user), window };
}
