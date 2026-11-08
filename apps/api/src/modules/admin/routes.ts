// The admin page's addresses (ROADMAP Stage 2 item 14a-i; Kd, 2026-11-07: only his own account).
//
// Order (CLAUDE.md §4): who is asking and whether they are the admin, in one step, then the rate
// limit, then the handler. To everybody but the one account `ADMIN_USER_ID` names, signed in or
// not, every address here answers exactly as an address that does not exist: the not-found reply
// itself, so nothing tells a stranger the page is here.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import {
  adminDayQuerySchema,
  adminPasswordRequestSchema,
  adminPeopleQuerySchema,
  adminPersonDaysQuerySchema,
  adminSetLimitsRequestSchema,
  calendarDaySchema,
} from "@app/shared";
import { knownZones } from "../appMinutes/repo.js";
import type { AppConfig } from "../../config.js";
import type { RedisLike } from "../../redis.js";
import { accessClaimsOf } from "../auth/plugin.js";
import { activeUserInSession } from "../auth/repo.js";
import { createDualRateLimit, giveBackRateLimit } from "../auth/rateLimit.js";
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
  // A password is tried by hand: 5 wrong ones in 15 minutes is plenty for Kd and nothing for a
  // guesser. Only a wrong password uses a try: one that opens the door, a form refused before it was
  // checked, or a sign-in too old to try it, is given back (Kd's click-through: the right password
  // after a Lock was refused as "too many").
  const doorLimitOptions = {
    name: "admin_door",
    max: 5,
    ipMax: 20,
    windowMs: 15 * 60 * 1000,
    identifier: (req: FastifyRequest) => req.authUser?.id ?? null,
    redis: deps.redis,
  };
  const doorLimit = createDualRateLimit(doorLimitOptions);
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
  /** A password try: the try is kept only when the password was wrong. */
  const tryPassword = async (req: FastifyRequest, reply: FastifyReply, run: (password: string) => Promise<unknown>) => {
    const body = parseOr400(adminPasswordRequestSchema, req.body, req, reply);
    if (body === null) {
      await giveBackRateLimit(doorLimitOptions, req);
      return reply;
    }
    const tried = { wrong: false };
    const sent = await doorReply(reply, async () => {
      try {
        return await run(body.password);
      } catch (err) {
        tried.wrong = err instanceof DoorError && err.code === "wrong_password";
        throw err;
      }
    });
    if (!tried.wrong) await giveBackRateLimit(doorLimitOptions, req);
    return sent;
  };
  // Nothing here is kept by a browser or anything between it and us.
  const noStore = (reply: FastifyReply): FastifyReply => reply.header("cache-control", "no-store");

  /** The door: whether a password is made, whether it is open and until when, and whether this
   *  sign-in is fresh enough to open it. */
  app.get("/v1/admin/door", { preHandler: [admin, readLimit] }, async (req, reply) => doorReply(reply, () => doorState(door, req, adminWho(req))));

  /** The first password, from a fresh sign-in; it opens the door. */
  app.post("/v1/admin/door/password", { preHandler: [admin, doorLimit] }, async (req, reply) =>
    tryPassword(req, reply, (password) => makePassword(door, reply, adminWho(req), password)),
  );

  /** A fresh sign-in and the password open the door for 12 hours. */
  app.post("/v1/admin/door/open", { preHandler: [admin, doorLimit] }, async (req, reply) =>
    tryPassword(req, reply, (password) => unlock(door, reply, adminWho(req), password)),
  );

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

  /** A zone the page sent that the database cannot read days in is a bad request. */
  const zoneOr400 = async (zone: string, req: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
    if ((await knownZones(deps.sql)).has(zone)) return true;
    await reply.status(400).send({ error: "validation_error", message: "zone: unknown time zone", requestId: req.id });
    return false;
  };
  const notFound = async (req: FastifyRequest, reply: FastifyReply) =>
    await reply.status(404).send({ error: "not_found", message: "Person not found", requestId: req.id });
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  /** One person's days (14a-ii): time in the app, meal scans, route plans and their cost. */
  app.get<{ Params: { id: string } }>("/v1/admin/people/:id/days", { preHandler: [admin, open, readLimit] }, async (req, reply) => {
    if (!UUID.test(req.params.id)) return notFound(req, reply);
    const query = parseOr400(adminPersonDaysQuerySchema, req.query, req, reply);
    if (query === null || !(await zoneOr400(query.zone, req, reply))) return;
    const days = await service.personDays(deps, {
      userId: req.params.id,
      zone: query.zone,
      before: query.before ?? null,
      now: (deps.now ?? (() => new Date()))(),
    });
    return days === null ? notFound(req, reply) : noStore(reply).status(200).send(days);
  });

  /** Everyone who used the app on one day, each on their own day (14a-ii). */
  app.get<{ Params: { day: string } }>("/v1/admin/days/:day", { preHandler: [admin, open, readLimit] }, async (req, reply) => {
    const day = parseOr400(calendarDaySchema, req.params.day, req, reply);
    if (day === null) return;
    const query = parseOr400(adminDayQuerySchema, req.query, req, reply);
    if (query === null || !(await zoneOr400(query.zone, req, reply))) return;
    return noStore(reply).status(200).send(await service.dayPeople(deps, { day, zone: query.zone, from: Number(query.from ?? "0") }));
  });

  app.put("/v1/admin/limits", { preHandler: [admin, open, writeLimit] }, async (req, reply) => {
    const body = parseOr400(adminSetLimitsRequestSchema, req.body, req, reply);
    if (body === null) return;
    return noStore(reply).status(200).send(await service.setLimits(deps, adminUserId(req), body));
  });
}
