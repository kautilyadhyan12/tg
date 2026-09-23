// A Svix webhook signature (Resend signs its webhooks with Svix; docs.svix.com,
// "Verifying payloads manually", read 2026-09-23). The signed content is
// `${svix-id}.${svix-timestamp}.${raw body}`, HMAC-SHA256 under the base64 secret after
// `whsec_`; the header holds one or more space-separated `v1,<base64>`, any of which may
// match; the timestamp must be within five minutes of now, which with the dedupe by
// svix-id stops a replay.
import { createHmac, timingSafeEqual } from "node:crypto";

export const SVIX_TOLERANCE_SECONDS = 5 * 60;

export interface SvixSigned {
  id: string;
  timestamp: string;
  signature: string;
  body: Buffer;
}

/** The HMAC key a `whsec_…` secret stands for, or null if it is not one. */
export function svixKey(secret: string): Buffer | null {
  if (!secret.startsWith("whsec_")) return null;
  const encoded = secret.slice("whsec_".length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
  const key = Buffer.from(encoded, "base64");
  return key.length === 0 ? null : key;
}

/** Did Resend sign this request, and recently? `nowSeconds` is the caller's clock. */
export function verifySvix(key: Buffer, signed: SvixSigned, nowSeconds: number): boolean {
  if (!/^\d{1,12}$/.test(signed.timestamp)) return false;
  const sentAt = Number(signed.timestamp);
  if (Math.abs(nowSeconds - sentAt) > SVIX_TOLERANCE_SECONDS) return false;
  const expected = createHmac("sha256", key)
    .update(`${signed.id}.${signed.timestamp}.`)
    .update(signed.body)
    .digest();
  let matched = false;
  for (const part of signed.signature.split(" ")) {
    const comma = part.indexOf(",");
    if (comma < 0 || part.slice(0, comma) !== "v1") continue;
    const given = Buffer.from(part.slice(comma + 1), "base64");
    // Every candidate is compared, so the time taken does not say which one matched.
    if (given.length === expected.length && timingSafeEqual(given, expected)) matched = true;
  }
  return matched;
}
