// Paddle's webhook signature (developer.paddle.com, "Verify webhook signatures", read
// 2026-09-24): `Paddle-Signature: ts=<unix seconds>;h1=<hex>`, the HMAC-SHA256 of
// `<ts>:<raw body>` under the notification destination's secret. More than one `h1`
// may appear while a secret is rotated; any one matching is enough.
import { createHmac, timingSafeEqual } from "node:crypto";

/** Paddle's own SDKs refuse a signature more than five seconds from now. */
export const PADDLE_SIGNATURE_TOLERANCE_SECONDS = 5;

export function verifyPaddleSignature(
  secret: string,
  header: string | undefined,
  rawBody: Buffer,
  nowSeconds: number,
): boolean {
  if (header === undefined || header.length > 2000) return false;
  let ts: string | null = null;
  const signatures: Buffer[] = [];
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "ts") ts = value;
    else if (key === "h1" && /^[0-9a-f]{64}$/.test(value)) signatures.push(Buffer.from(value, "hex"));
  }
  if (ts === null || !/^\d{1,12}$/.test(ts) || signatures.length === 0) return false;
  if (Math.abs(nowSeconds - Number(ts)) > PADDLE_SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(`${ts}:`, "utf8"), rawBody]))
    .digest();
  return signatures.some((signature) => timingSafeEqual(signature, expected));
}
