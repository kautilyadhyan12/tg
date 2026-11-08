// The admin page's addresses (ROADMAP Stage 2 item 14a-i; Kd, 2026-11-07: only his own account).
//
// Order (CLAUDE.md §4): who is asking and whether they are the admin, in one step, then the rate
// limit, then the handler. To everybody but the one account `ADMIN_USER_ID` names, signed in or
// not, every address here answers exactly as an address that does not exist: the not-found reply
// itself, so nothing tells a stranger the page is here.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { adminPasswordRequestSchema, adminPeopleQuerySchema, adminSetLimitsRequestSchema } from "@app/shared";
import type { AppConfig } from "../../config.js";
import type { RedisLike } from "../../redis.js";
import { accessClaimsOf } from "../auth/plugin.js";
import { activeUserInSession } from "../auth/repo.js";
import { createDualRateLimit } from "../auth/rateLimit.js";
import { argon2idHasher, type PasswordHasher } from "../auth/service.js";
import { DoorError, doorState, lock, makePassword, requireOpenDoor, unlock } from "./door.js";
import { parseOr400 } from "../orgs/posts/routes.js";
import * as service from "./service.js";

export interface AdminRouteDeps {
  sql: Sql;
  redis: RedisLike;
  config: AppConfig;
  /** Tests pass a quick one; argon2id otherwise. */
  hasher?: PasswordHasher;
  now?: () => Date;
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
      // The same words as an address that does not exist (app.ts's not-found handler), sent here so
      // the request ends here: nothing behind this check runs for anybody else.
      await reply.status(404).send({ error: "not_found", message: `Route ${req.method}:${req.url} not found`, requestId: req.id });
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

function adminWho(req: FastifyRequest): { userId: string; familyId: string } {
  const familyId = req.authUser?.familyId ?? null;
  if (familyId === null) throw new Error("adminOnly lets in only a live session");
  return { userId: adminUserId(req), familyId };
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
  // A password is tried by hand: 5 tries in 15 minutes is plenty for Kd and nothing for a guesser.
  const doorLimit = createDualRateLimit({
    name: "admin_door",
    max: 5,
    ipMax: 20,
    windowMs: 15 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  const door = { sql: deps.sql, redis: deps.redis, config: deps.config, hasher: deps.hasher ?? argon2idHasher, now: deps.now ?? (() => new Date()) };
  const open = requireOpenDoor(door);
  const doorReply = async (reply: FastifyReply, run: () => Promise<unknown>) => {
    try {
      return await noStore(reply).status(200).send(await run());
    } catch (err) {
      if (err instanceof DoorError) return await reply.status(err.statusCode).send({ error: err.code, message: err.message, requestId: reply.request.id });
      throw err;
    }
  };
  // Nothing here is kept by a browser or anything between it and us.
  const noStore = (reply: FastifyReply): FastifyReply => reply.header("cache-control", "no-store");

  /** The door: whether a password is made, whether it is open and until when, and whether this
   *  sign-in is fresh enough to open it. */
  app.get("/v1/admin/door", { preHandler: [admin, readLimit] }, async (req, reply) => doorReply(reply, () => doorState(door, req, adminWho(req))));

  /** The first password, from a fresh sign-in; it opens the door. */
  app.post("/v1/admin/door/password", { preHandler: [admin, doorLimit] }, async (req, reply) => {
    const body = parseOr400(adminPasswordRequestSchema, req.body, req, reply);
    if (body === null) return;
    return doorReply(reply, () => makePassword(door, reply, adminWho(req), body.password));
  });

  /** A fresh sign-in and the password open the door for 12 hours. */
  app.post("/v1/admin/door/open", { preHandler: [admin, doorLimit] }, async (req, reply) => {
    const body = parseOr400(adminPasswordRequestSchema, req.body, req, reply);
    if (body === null) return;
    return doorReply(reply, () => unlock(door, reply, adminWho(req), body.password));
  });

  /** Lock the page now. */
  app.post("/v1/admin/door/lock", { preHandler: [admin, writeLimit] }, async (req, reply) => {
    await lock(door, req, reply);
    return noStore(reply).status(200).send({ locked: true });
  });

  app.get("/v1/admin/people", { preHandler: [admin, open, readLimit] }, async (req, reply) => {
    const query = parseOr400(adminPeopleQuerySchema, req.query, req, reply);
    if (query === null) return;
    return noStore(reply).status(200).send(await service.listPeople(deps, query));
  });

  app.put("/v1/admin/limits", { preHandler: [admin, open, writeLimit] }, async (req, reply) => {
    const body = parseOr400(adminSetLimitsRequestSchema, req.body, req, reply);
    if (body === null) return;
    return noStore(reply).status(200).send(await service.setLimits(deps, adminUserId(req), body));
  });
}
