// P2.1 — the `authenticate` preHandler (replaces the P1.10d SYNC_DEV_USER_ID
// seam). Order per R3.3: this is step 1 (authn); authz/tenancy live in each
// module's handler/repo. Token from Authorization: Bearer or the accessToken
// cookie (ported authGuard.js:8-13); every failure is the same dark 401.
import "@fastify/cookie"; // module augmentation: req.cookies
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import type { AppConfig } from "../../config.js";
import { findUserById } from "./repo.js";
import { ACCESS_COOKIE, verifyAccessTokenClaims } from "./tokens.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by `authenticate`; present on any route that lists it as preHandler.
     *  `familyId` is the sign-in session the access token was issued under. */
    authUser?: { id: string; familyId: string | null };
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/** The access token's claims, checked once per request: the app-wide rate limit reads
 *  them first (`app.ts`), and `authenticate` reuses the answer. null: no token, or one
 *  that does not check out. */
const checked = new WeakMap<FastifyRequest, { userId: string; familyId: string | null } | null>();
export function accessClaimsOf(req: FastifyRequest, config: AppConfig): { userId: string; familyId: string | null } | null {
  if (checked.has(req)) return checked.get(req) ?? null;
  const header = req.headers.authorization;
  const bearer =
    header !== undefined && header.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  const token = bearer ?? req.cookies[ACCESS_COOKIE] ?? null;
  let claims: { userId: string; familyId: string | null } | null = null;
  if (token !== null && token !== "") {
    try {
      claims = verifyAccessTokenClaims(token, config);
    } catch {
      claims = null; // invalid/expired/refresh-typed
    }
  }
  checked.set(req, claims);
  return claims;
}

export function registerAuthenticate(
  app: FastifyInstance,
  deps: { sql: Sql; config: AppConfig },
): void {
  app.decorateRequest("authUser", undefined);
  app.decorate("authenticate", async (req: FastifyRequest, reply: FastifyReply) => {
    const unauthorized = async () =>
      reply.status(401).send({
        error: "unauthorized",
        message: "authentication required",
        requestId: req.id,
      });

    const claims = accessClaimsOf(req, deps.config);
    if (claims === null) {
      await unauthorized(); // missing/invalid/expired/refresh-typed — uniformly dark
      return;
    }

    // Ported authGuard.js:24-38: the user must still exist and be active.
    const user = await findUserById(deps.sql, claims.userId);
    if (user === null || user.status !== "active") {
      await unauthorized();
      return;
    }
    req.authUser = { id: user.id, familyId: claims.familyId };
  });
}
