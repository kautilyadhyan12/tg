// A pass the phone makes itself, for when it has no signal (ROADMAP Stage 5 item 15c; spec Part 3
// §12.2). The server's own layout, with the window's top bit set and the code signed with this
// phone's key, which the server gave to this sign-in alone (`apps/api`'s `pass.ts`, its
// `makePhonePass`). The desk takes it only while this sign-in is live, and each window once.
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha2";
import { CHECKIN_PASS_PREFIX, CHECKIN_PASS_WINDOW_SECONDS } from "@app/shared";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const DOMAIN = "aihg-checkin-pass-v1";
const MAC_BYTES = 16;
const PHONE_MADE = 0x80000000;

/** The 30-second window an instant falls in, as the server counts them. */
export function phoneWindow(nowMs: number): number {
  return Math.floor(nowMs / 1000 / CHECKIN_PASS_WINDOW_SECONDS);
}

/** How long until the next window begins, when the phone's pass changes. */
export function untilNextWindowMs(nowMs: number): number {
  const length = CHECKIN_PASS_WINDOW_SECONDS * 1000;
  return length - (((nowMs % length) + length) % length);
}

function fromBase64url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(text)) return null;
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of text) {
    value = ((value << 6) | BASE64URL.indexOf(char)) & 0xfff;
    bits += 6;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

function uuidBytes(id: string): Uint8Array | null {
  const hex = id.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) return null;
  return Uint8Array.from({ length: 16 }, (_, at) => parseInt(hex.slice(at * 2, at * 2 + 2), 16));
}

function base32(bytes: Uint8Array): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xfff;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET.charAt((value << (5 - bits)) & 31);
  return out;
}

/** This window's pass, signed with the phone's key, or null when the key, the person or the time
 *  cannot be read: then nothing is drawn, never a pass the desk would refuse. */
export function makePhonePass(key: string, userId: string, nowMs: number): string | null {
  const secret = fromBase64url(key);
  const user = uuidBytes(userId);
  if (secret === null || user === null || !Number.isFinite(nowMs) || nowMs < 0) return null;
  const field = (phoneWindow(nowMs) | PHONE_MADE) >>> 0;
  const win = Uint8Array.of(field >>> 24, (field >>> 16) & 0xff, (field >>> 8) & 0xff, field & 0xff);
  const signed = new Uint8Array(DOMAIN.length + 16 + 4);
  for (let at = 0; at < DOMAIN.length; at++) signed[at] = DOMAIN.charCodeAt(at);
  signed.set(user, DOMAIN.length);
  signed.set(win, DOMAIN.length + 16);
  const mac = hmac(sha256, secret, signed).subarray(0, MAC_BYTES);
  const body = new Uint8Array(16 + 4 + MAC_BYTES);
  body.set(user, 0);
  body.set(win, 16);
  body.set(mac, 20);
  return CHECKIN_PASS_PREFIX + base32(body);
}
