// Square's webhook signature (developer.squareup.com, "Validate notifications", read
// 2026-10-19): `x-square-hmacsha256-signature` is the base64 HMAC-SHA256, under the
// subscription's signature key, of the subscription's own notification URL followed by the
// raw body. Square signs no time, so a replay is the same event id and is kept once.
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifySquareSignature(signatureKey: string, notificationUrl: string, header: string | undefined, rawBody: Buffer): boolean {
  if (header === undefined || !/^[A-Za-z0-9+/]{43}=$/.test(header)) return false;
  const expected = createHmac("sha256", signatureKey)
    .update(Buffer.concat([Buffer.from(notificationUrl, "utf8"), rawBody]))
    .digest();
  return timingSafeEqual(Buffer.from(header, "base64"), expected);
}
