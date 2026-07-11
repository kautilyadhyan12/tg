// P2.1 — token crypto. Ports jwtHelper.js semantics (R3.7):
//   · verify pins algorithms: ['HS256']
//   · a refresh-typed token is REJECTED on access paths
//   · one-time/refresh tokens are opaque randoms stored only as SHA-256
//     (authController.js:9-13 — "a database leak can no longer be turned
//     into account takeovers").
import { createHash, randomBytes, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import type { AppConfig } from "../../config.js";

// A presented JWT is external input (R2.3) — parse, don't cast.
const accessClaimsSchema = z.object({ sub: z.string().uuid(), typ: z.literal("access") });

// Cookie names live here so plugin.ts and routes.ts can't drift (T3 2026-07-11).
export const ACCESS_COOKIE = "accessToken";
export const REFRESH_COOKIE = "refreshToken";

export class InvalidAccessTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAccessTokenError";
  }
}

/** Access JWTs are explicitly type-tagged. The old code tagged only refresh
 *  tokens and rejected {type:'refresh'}; requiring typ==='access' is the same
 *  defense with the safer default (an untagged/foreign token also fails). */
export function signAccessToken(userId: string, config: AppConfig): string {
  return jwt.sign({ sub: userId, typ: "access" }, config.JWT_SECRET, {
    algorithm: "HS256",
    // v1 §6.1: "JWT access (15 min)" — minutes come from config (default 15).
    expiresIn: config.ACCESS_TTL_MIN * 60,
  });
}

/** Returns the userId or throws InvalidAccessTokenError. Never leaks jwt
 *  internals to callers (routes answer a uniform 401). */
export function verifyAccessToken(token: string, config: AppConfig): string {
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
  return claims.data.sub;
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
