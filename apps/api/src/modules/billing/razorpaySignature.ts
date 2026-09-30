// Razorpay's webhook signature (razorpay.com/docs/webhooks/validate-test, read 2026-09-29):
// `X-Razorpay-Signature` is the hex HMAC-SHA256 of the raw body under the webhook's secret.
// It carries no time, so a replayed event verifies: it is kept once by its event id, and
// the worker acts only on Razorpay's own record fetched afterwards, never on the body.
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyRazorpaySignature(secret: string, header: string | undefined, rawBody: Buffer): boolean {
  if (header === undefined || !/^[0-9a-f]{64}$/.test(header)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  return timingSafeEqual(Buffer.from(header, "hex"), expected);
}
