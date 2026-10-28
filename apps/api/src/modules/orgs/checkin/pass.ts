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
//
// A PASS THE PHONE MAKES WITH NO SIGNAL (ROADMAP Stage 5 item 15c). The same layout, with
// the window's top bit set and the MAC made with the phone's own key: one derived from the
// server's key, the person, the phone's sign-in and the day (UTC), so the server keeps no new
// secret. It reads only while that sign-in is live: signed out, or replaced by a newer phone,
// the phone's passes are dead. The phone is given today's key and tomorrow's, so a pass made
// ahead with the phone's clock moved on is good until tomorrow ends at most. Its window may be
// the desk's, the one before or the one after (a phone's clock with no signal is not
// corrected); it shares its window's one use with the server's pass for the same window, and
// one read a window early takes the desk's window too, so two windows at most are open.
import { createHmac, timingSafeEqual } from "node:crypto";
import { CHECKIN_PASS_LENGTH, CHECKIN_PASS_PREFIX, CHECKIN_PASS_WINDOW_SECONDS } from "@app/shared";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const MAC_BYTES = 16;
const BODY_BYTES = 16 + 4 + MAC_BYTES;
const DOMAIN = Buffer.from("aihg-checkin-pass-v1", "utf8");
const PHONE_KEY_DOMAIN = Buffer.from("aihg-checkin-phone-key-v1", "utf8");
/** The window's top bit: the phone made this pass. Windows stay below it until the year 4000. */
const PHONE_MADE = 0x80000000;
/** Windows in a day: 2,880 of 30 seconds. */
export const WINDOWS_A_DAY = 86_400 / CHECKIN_PASS_WINDOW_SECONDS;

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

function uuidBytes(id: string): Buffer {
  const hex = id.replace(/-/g, "");
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

function sign(key: Buffer, userId: string, field: number): string {
  const user = uuidBytes(userId);
  const win = Buffer.alloc(4);
  win.writeUInt32BE(field);
  return CHECKIN_PASS_PREFIX + base32(Buffer.concat([user, win, mac(key, user, win)]));
}

export function makePass(key: Buffer, userId: string, window: number): string {
  return sign(key, userId, window);
}

/** The UTC day a window falls in, which names the phone's key for it. */
export function passDay(window: number): number {
  return Math.floor(window / WINDOWS_A_DAY);
}

/** The key a phone signs its own passes with, for one sign-in (`familyId`) and one day: 32 bytes. */
export function phonePassKey(key: Buffer, userId: string, familyId: string, day: number): Buffer {
  const dayBytes = Buffer.alloc(4);
  dayBytes.writeUInt32BE(day);
  return createHmac("sha256", key)
    .update(PHONE_KEY_DOMAIN)
    .update(uuidBytes(userId))
    .update(uuidBytes(familyId))
    .update(dayBytes)
    .digest();
}

/** The pass a phone makes with no signal; the phone's own copy is `apps/mobile`'s `phonePass.ts`. */
export function makePhonePass(phoneKey: Buffer, userId: string, window: number): string {
  return sign(phoneKey, userId, (window | PHONE_MADE) >>> 0);
}

function open(raw: string): { user: Buffer; win: Buffer; tag: Buffer; phoneMade: boolean } | null {
  const text = raw.toUpperCase();
  if (text.length !== CHECKIN_PASS_LENGTH || !text.startsWith(CHECKIN_PASS_PREFIX)) return null;
  const bytes = fromBase32(text.slice(CHECKIN_PASS_PREFIX.length), BODY_BYTES);
  if (bytes === null) return null;
  const win = bytes.subarray(16, 20);
  return { user: bytes.subarray(0, 16), win, tag: bytes.subarray(20), phoneMade: (win.readUInt32BE() & PHONE_MADE) !== 0 };
}

/** Whose phone a pass says made it, before anything is checked, so its live sign-ins can be
 *  read; null for a pass the server made, or one that is not a pass. */
export function phoneMadeBy(raw: string): string | null {
  const pass = open(raw);
  return pass?.phoneMade === true ? uuidOf(pass.user) : null;
}

/** What a read pass is: fresh, old, or garbled (not ours, altered, cut short by the scanner,
 *  or made by a phone whose sign-in is not in `phoneSignIns`, its person's live ones). The
 *  server's pass is fresh in its own window or the one after; a phone's in the window before,
 *  its own, or the one after. */
export function readPass(key: Buffer, raw: string, nowWindow: number, phoneSignIns: readonly string[] = []): PassRead {
  const pass = open(raw);
  if (pass === null) return { kind: "garbled" };
  const window = (pass.win.readUInt32BE() & ~PHONE_MADE) >>> 0;
  const userId = uuidOf(pass.user);
  // A phone's pass is signed with its sign-in's key for the day of the window it names.
  const keys = pass.phoneMade ? phoneSignIns.map((family) => phonePassKey(key, userId, family, passDay(window))) : [key];
  // Every key is tried, so the time taken does not say which sign-in it was.
  let signed = false;
  for (const each of keys) if (timingSafeEqual(pass.tag, mac(each, pass.user, pass.win))) signed = true;
  if (!signed) return { kind: "garbled" };
  const late = nowWindow - window;
  if (late !== 0 && late !== 1 && !(pass.phoneMade && late === -1)) return { kind: "old" };
  return { kind: "fresh", userId, window };
}
