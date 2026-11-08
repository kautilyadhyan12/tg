// The admin page's addresses (ROADMAP Stage 2 item 14a-i; Kd, 2026-11-07: only his own account).
//
// Order (CLAUDE.md §4): who is asking and whether they are the admin, in one step, then the rate
// limit, then the handler. To everybody but the one account `ADMIN_USER_ID` names, signed in or
// not, every address here answers exactly as an address that does not exist: the not-found reply
// itself, so nothing tells a stranger the page is here.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { adminPeopleQuerySchema, adminSetLimitsRequestSchema } from "@app/shared";
import type { AppConfig } from "../../config.js";
import type { RedisLike } from "../../redis.js";
import { accessClaimsOf } from "../auth/plugin.js";
import { activeUserInSession } from "../auth/repo.js";
import { createDualRateLimit } from "../auth/rateLimit.js";
import { parseOr400 } from "../orgs/posts/routes.js";
import * as service from "./service.js";

export interface AdminRouteDeps {
  sql: Sql;
  redis: RedisLike;
  config: AppConfig;
}

/** The one account that may, from its live sign-in session; anybody else meets the not-found reply. */
export function adminOnly(deps: AdminRouteDeps) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> => {
    const adminId = deps.config.ADMIN_USER_ID;
    const claims = accessClaimsOf(req, deps.config);
    const userId =
      adminId === undefined || claims === null || claims.familyId === null || claims.userId !== adminId
        ? null
        : await activeUserInSession(deps.sql, claims.userId, claims.familyId);
    if (userId === null || userId !== adminId) {
      // Returning the reply ends the request here: the not-found reply is sent without the handler.
      reply.callNotFound();
      return reply;
    }
    req.authUser = { id: userId, familyId: claims?.familyId ?? null };
    return undefined;
  };
}

function adminUserId(req: FastifyRequest): string {
  const id = req.authUser?.id;
  if (id === undefined) throw new Error("adminOnly did not run");
  return id;
}

export function registerAdminRoutes(app: FastifyInstance, deps: AdminRouteDeps): void {
  const admin = adminOnly(deps);
  // One person uses this page. Far past what he does by hand, and a stolen session can still not
  // read the whole list in a burst.
  const readLimit = createDualRateLimit({
    name: "admin_read",
    max: 120,
    ipMax: null,
    windowMs: 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  const writeLimit = createDualRateLimit({
    name: "admin_write",
    max: 60,
    ipMax: null,
    windowMs: 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  // Nothing here is kept by a browser or anything between it and us.
  const noStore = (reply: FastifyReply): FastifyReply => reply.header("cache-control", "no-store");

  /** Whether the signed-in account is the admin: the console shows its Admin line on a yes. */
  app.get("/v1/admin/me", { preHandler: [admin, readLimit] }, async (_req, reply) => noStore(reply).status(200).send({ admin: true }));

  app.get("/v1/admin/people", { preHandler: [admin, readLimit] }, async (req, reply) => {
    const query = parseOr400(adminPeopleQuerySchema, req.query, req, reply);
    if (query === null) return;
    return noStore(reply).status(200).send(await service.listPeople(deps, query));
  });

  app.put("/v1/admin/limits", { preHandler: [admin, writeLimit] }, async (req, reply) => {
    const body = parseOr400(adminSetLimitsRequestSchema, req.body, req, reply);
    if (body === null) return;
    return noStore(reply).status(200).send(await service.setLimits(deps, adminUserId(req), body));
  });
}
