// P2.1 — token crypto. Ports jwtHelper.js semantics (R3.7):
//   · verify pins algorithms: ['HS256']
//   · a refresh-typed token is REJECTED on access paths
//   · one-time/refresh tokens are opaque randoms stored only as SHA-256
//     (authController.js:9-13 — "a database leak can no longer be turned
//     into account takeovers").
import { createHash, createHmac, randomBytes, randomInt, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import type { AppConfig } from "../../config.js";

// A presented JWT is external input (R2.3) — parse, don't cast.
const accessClaimsSchema = z.object({
  sub: z.string().uuid(),
  typ: z.literal("access"),
  // The sign-in session (refresh family) the token was issued under. Absent on a
  // token signed before the claim existed.
  fid: z.string().uuid().optional(),
});

// Cookie names live here so plugin.ts and routes.ts can't drift (T3 2026-07-11).
export const ACCESS_COOKIE = "accessToken";
export const REFRESH_COOKIE = "refreshToken";
// google-login: short-lived anti-CSRF `state` for the OAuth round-trip. Never a
// session credential — set on the redirect, matched-and-cleared on the callback.
export const OAUTH_STATE_COOKIE = "g_oauth_state";

export class InvalidAccessTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAccessTokenError";
  }
}

/** Access JWTs are explicitly type-tagged. The old code tagged only refresh
 *  tokens and rejected {type:'refresh'}; requiring typ==='access' is the same
 *  defense with the safer default (an untagged/foreign token also fails). */
export function signAccessToken(userId: string, config: AppConfig, familyId: string): string {
  return jwt.sign({ sub: userId, typ: "access", fid: familyId }, config.JWT_SECRET, {
    algorithm: "HS256",
    // v1 §6.1: "JWT access (15 min)" — minutes come from config (default 15).
    expiresIn: config.ACCESS_TTL_MIN * 60,
  });
}

/** Returns the userId or throws InvalidAccessTokenError. Never leaks jwt
 *  internals to callers (routes answer a uniform 401). */
export function verifyAccessToken(token: string, config: AppConfig): string {
  return verifyAccessTokenClaims(token, config).userId;
}

/** The userId and the sign-in session the token belongs to (null on an older token). */
export function verifyAccessTokenClaims(token: string, config: AppConfig): { userId: string; familyId: string | null } {
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, config.JWT_SECRET, { algorithms: ["HS256"] });
  } catch {
    throw new InvalidAccessTokenError("token invalid or expired");
  }
  const claims = accessClaimsSchema.safeParse(decoded);
  if (!claims.success) {
    // R3.7: refresh (or any non-access) token rejected on access paths.
    throw new InvalidAccessTokenError("not an access token");
  }
  return { userId: claims.data.sub, familyId: claims.data.fid ?? null };
}

/** 32 random bytes, hex — the shape the audited code mailed in links
 *  (authController.js:73). Used for refresh + one-time tokens. */
export function mintOpaqueToken(): string {
  return randomBytes(32).toString("hex");
}

export function sha256Hex(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function newFamilyId(): string {
  return randomUUID();
}

// ── sign-in codes (Kd 2026-09-07) ───────────────────────────────────────────

/** Six decimal digits, leading zeros kept, from a CSPRNG — `randomInt` is
 *  unbiased over the range, which `Math.random` and `% 1000000` are not. */
export function mintSixDigitCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** The stored form of a code: an HMAC under a key DERIVED from the server
 *  secret (domain-separated so the JWT key and this key are never the same
 *  bytes), over purpose + address + code. A six-digit code is a million
 *  possibilities, so an unkeyed hash would be brute-forced from a database leak
 *  in seconds; the keyed one needs the secret. The address is inside the MAC so
 *  a row can never be re-pointed at another address by editing one column. */
export function signInCodeHash(
  secret: string,
  input: { purpose: string; email: string; code: string },
): string {
  const key = createHmac("sha256", secret).update("aihg-sign-in-code-key").digest();
  return createHmac("sha256", key)
    .update(`${input.purpose}\n${input.email}\n${input.code}`)
    .digest("hex");
}
