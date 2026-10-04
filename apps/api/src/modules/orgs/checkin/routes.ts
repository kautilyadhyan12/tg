// Check-in's routes (spec Part 3 §12; ROADMAP 16a).
//
//   GET  /v1/users/me/checkin-pass                       a member's pass (signed in)
//   GET  /v1/orgs/:gymId/checkin-devices                 the gym's devices (`org.manage`)
//   POST /v1/orgs/:gymId/checkin-devices                 add one, with its one-time link
//   POST /v1/orgs/:gymId/checkin-devices/:deviceId/link  a new link; the old key stops
//   POST /v1/orgs/:gymId/checkin-devices/:deviceId/off   switch it off
//   POST /v1/checkin/device/claim                        the tablet opens its link
//   POST /v1/checkin/scan                                the device's key, and nothing else
//   GET  /v1/orgs/:gymId/attendance/people?query=        staff find a person (`attendance.mark`)
//   POST /v1/orgs/:gymId/attendance/check-in             staff check them in (`attendance.mark`)
//   POST /v1/orgs/:gymId/attendance/visits               staff add a visit for an earlier day (`attendance.mark`)
//   DELETE /v1/orgs/:gymId/attendance/visits/:visitId    staff remove a wrong visit (`attendance.mark`)
//   GET  /v1/orgs/:gymId/attendance/log?since=           the live log (`attendance.read`)
//
// The device's key lives in an httpOnly cookie sent only to `/v1/checkin`, and the scan is
// the one route that reads it: every other route asks for a signed-in person.
import { createHmac } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { z } from "zod";
import {
  addCheckinDeviceRequestSchema,
  addVisitRequestSchema,
  CHECKIN_WORDS,
  checkinDeviceIdParamsSchema,
  checkinLogQuerySchema,
  checkinPeopleQuerySchema,
  checkinScanRequestSchema,
  claimCheckinDeviceRequestSchema,
  staffCheckinRequestSchema,
  visitIdParamsSchema,
} from "@app/shared";
import type { AppConfig } from "../../../config.js";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import { orgParamsSchema } from "../schemas.js";
import { OrgsError } from "../service.js";
import { deviceCookieValue, deviceLimitId, readDeviceCookie } from "./deviceKey.js";
import * as service from "./service.js";

export const CHECKIN_DEVICE_COOKIE = "checkinDevice";
const CHECKIN_PATH = "/v1/checkin";
/** A browser keeps a cookie at most 400 days; the desk's key is renewed on each claim. */
const DEVICE_COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;

/** The key passes are signed with: `CHECKIN_PASS_SECRET`, or outside production one
 *  derived from JWT_SECRET; null in production without it, which switches passes off. */
export function checkinPassKey(config: Pick<AppConfig, "NODE_ENV" | "JWT_SECRET" | "CHECKIN_PASS_SECRET">): Buffer | null {
  if (config.CHECKIN_PASS_SECRET !== undefined) return Buffer.from(config.CHECKIN_PASS_SECRET, "utf8");
  if (config.NODE_ENV === "production") return null;
  return createHmac("sha256", config.JWT_SECRET).update("checkin-pass").digest();
}

/** The key a desk device's cookie is marked with (`deviceKey.ts`). */
export function checkinDeviceSecret(config: Pick<AppConfig, "JWT_SECRET">): Buffer {
  return createHmac("sha256", config.JWT_SECRET).update("checkin-device").digest();
}

const SCAN_PATH = `${CHECKIN_PATH}/scan`;

/** The app-wide limit's name for a scan from a desk the server set up, or null: such a
 *  desk is counted on its own, so nobody at its address can use up its allowance. */
export function checkinDeskLimitKey(req: FastifyRequest, config: Pick<AppConfig, "JWT_SECRET">): string | null {
  if (req.routeOptions.url !== SCAN_PATH) return null;
  const cookie = readDeviceCookie(checkinDeviceSecret(config), req.cookies[CHECKIN_DEVICE_COOKIE]);
  return cookie?.marked === true ? `desk:${deviceLimitId(cookie.key)}` : null;
}

function parseOr400<S extends z.ZodTypeAny>(
  schema: S,
  value: unknown,
  req: FastifyRequest,
  reply: FastifyReply,
): z.output<S> | null {
  const parsed: z.SafeParseReturnType<unknown, z.output<S>> = schema.safeParse(value);
  if (!parsed.success) {
    // Issue paths and codes only, never the value: it may be somebody's member number.
    void reply.status(400).send({
      error: "validation_error",
      message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.code}`).join("; "),
      requestId: req.id,
    });
    return null;
  }
  return parsed.data;
}

function requireUserId(req: FastifyRequest): string {
  const userId = req.authUser?.id;
  if (userId === undefined) throw new Error("authenticate preHandler did not run");
  return userId;
}

export interface CheckinRouteDeps {
  sql: Sql;
  redis: RedisLike;
  config: Pick<AppConfig, "NODE_ENV" | "JWT_SECRET" | "CHECKIN_PASS_SECRET" | "WEB_ORIGIN">;
}

export function registerCheckinRoutes(app: FastifyInstance, deps: CheckinRouteDeps): void {
  const checkinDeps: service.CheckinDeps = {
    sql: deps.sql,
    redis: deps.redis,
    now: () => new Date(),
    passKey: checkinPassKey(deps.config),
    webOrigin: deps.config.WEB_ORIGIN,
    log: app.log,
  };
  const prod = deps.config.NODE_ENV === "production";
  const deviceSecret = checkinDeviceSecret(deps.config);

  const gate =
    (limit: (req: FastifyRequest, reply: FastifyReply) => Promise<void>) =>
    (req: FastifyRequest, reply: FastifyReply) =>
    async (): Promise<boolean> => {
      await limit(req, reply);
      return !reply.sent;
    };

  /** The app asks every 30 seconds while the pass is on screen: 10 a minute a person,
   *  and a gym's members on its one wi-fi address share the address's 3,000. */
  const passLimit = createDualRateLimit({
    name: "checkin_pass",
    max: 10,
    ipMax: 3000,
    windowMs: 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  const deviceReadLimit = createDualRateLimit({
    name: "checkin_devices_read",
    max: 600,
    ipMax: 2000,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  const deviceWriteLimit = createDualRateLimit({
    name: "checkin_devices_write",
    max: 60,
    ipMax: 200,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  /** Opening a link: only links that open nothing are counted, by address, and past 30 an
   *  hour they are refused. A real link (256 random bits) always opens, however many
   *  made-up ones its address sent; the app-wide limit bounds how many are tried. */
  const CLAIM_MISSES_PER_HOUR = 30;
  const claimMissKey = (req: FastifyRequest): string => `rl:checkin_claim_missed:ip:${req.ip}`;
  /** Scans whose cookie the server did not mark, by address, before any key is looked
   *  up. A desk the server set up is not counted here: it has its own 120 a minute. */
  const scanAddressLimit = createDualRateLimit({
    name: "checkin_scan",
    max: 600,
    ipMax: 600,
    windowMs: 60 * 1000,
    identifier: () => null,
    redis: deps.redis,
  });

  /** Staff at the desk: a search a few letters at a time, and a check-in a person. A gym's
   *  staff share the desk's one address. */
  const staffSearchLimit = createDualRateLimit({
    name: "checkin_staff_search",
    max: 600,
    ipMax: 3000,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  /** Adding or removing a visit is rare; a gym's staff share its one address. */
  const visitFixLimit = createDualRateLimit({
    name: "checkin_visit_fix",
    max: 300,
    ipMax: 1500,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  const staffCheckinLimit = createDualRateLimit({
    name: "checkin_staff",
    max: 600,
    ipMax: 3000,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  /** The log is asked again every 5 seconds while Attendance is open, and once more after
   *  each check-in: 720 an hour a screen, so 3,000 an account (three screens and a busy
   *  desk), 12,000 for a gym's staff on one address. */
  const logLimit = createDualRateLimit({
    name: "checkin_log",
    max: 3000,
    ipMax: 12000,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });

  app.get("/v1/users/me/checkin-pass", { preHandler: [app.authenticate] }, async (req, reply) => {
    const pass = await service.getPass(checkinDeps, gate(passLimit)(req, reply), requireUserId(req));
    if (pass === null) return;
    return reply.status(200).header("cache-control", "no-store").send(pass);
  });

  app.get("/v1/orgs/:gymId/checkin-devices", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const devices = await service.listDevices(checkinDeps, requireUserId(req), params.gymId, gate(deviceReadLimit)(req, reply));
    if (devices === null) return;
    return reply.status(200).send(devices);
  });

  app.post("/v1/orgs/:gymId/checkin-devices", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(addCheckinDeviceRequestSchema, req.body, req, reply);
    if (body === null) return;
    const added = await service.addDevice(checkinDeps, requireUserId(req), params.gymId, body.name, gate(deviceWriteLimit)(req, reply));
    if (added === null) return;
    return reply.status(201).header("cache-control", "no-store").send(added);
  });

  app.post("/v1/orgs/:gymId/checkin-devices/:deviceId/link", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(checkinDeviceIdParamsSchema, req.params, req, reply);
    if (params === null) return;
    const renewed = await service.renewDeviceLink(
      checkinDeps,
      requireUserId(req),
      params.gymId,
      params.deviceId,
      gate(deviceWriteLimit)(req, reply),
    );
    if (renewed === null) return;
    return reply.status(200).header("cache-control", "no-store").send(renewed);
  });

  app.post("/v1/orgs/:gymId/checkin-devices/:deviceId/off", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(checkinDeviceIdParamsSchema, req.params, req, reply);
    if (params === null) return;
    const off = await service.switchOffDevice(
      checkinDeps,
      requireUserId(req),
      params.gymId,
      params.deviceId,
      gate(deviceWriteLimit)(req, reply),
    );
    if (off === null) return;
    return reply.status(200).send(off);
  });

  app.get("/v1/orgs/:gymId/attendance/people", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const query = parseOr400(checkinPeopleQuerySchema, req.query, req, reply);
    if (query === null) return;
    const found = await service.findPeople(checkinDeps, requireUserId(req), params.gymId, query.query, gate(staffSearchLimit)(req, reply));
    if (found === null) return;
    return reply.status(200).header("cache-control", "no-store").send(found);
  });

  app.post("/v1/orgs/:gymId/attendance/check-in", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(staffCheckinRequestSchema, req.body, req, reply);
    if (body === null) return;
    const answer = await service.staffCheckIn(checkinDeps, requireUserId(req), params.gymId, body, gate(staffCheckinLimit)(req, reply));
    if (answer === null) return;
    return reply.status(200).header("cache-control", "no-store").send(answer);
  });

  // Fixing a visit (19a-iv): the service asks the `attendance.mark` tick first and the
  // limit after it, as every staff route here does.
  app.post("/v1/orgs/:gymId/attendance/visits", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(addVisitRequestSchema, req.body, req, reply);
    if (body === null) return;
    const answer = await service.addVisit(checkinDeps, requireUserId(req), params.gymId, body, gate(visitFixLimit)(req, reply));
    if (answer === null) return;
    return reply.status(200).header("cache-control", "no-store").send(answer);
  });

  app.delete("/v1/orgs/:gymId/attendance/visits/:visitId", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(visitIdParamsSchema, req.params, req, reply);
    if (params === null) return;
    const answer = await service.removeVisit(checkinDeps, requireUserId(req), params.gymId, params.visitId, gate(visitFixLimit)(req, reply));
    if (answer === null) return;
    return reply.status(200).header("cache-control", "no-store").send(answer);
  });

  app.get("/v1/orgs/:gymId/attendance/log", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const query = parseOr400(checkinLogQuerySchema, req.query, req, reply);
    if (query === null) return;
    const log = await service.readLog(checkinDeps, requireUserId(req), params.gymId, query.since, gate(logLimit)(req, reply));
    if (log === null) return;
    return reply.status(200).header("cache-control", "no-store").send(log);
  });

  app.post(`${CHECKIN_PATH}/device/claim`, async (req, reply) => {
    const body = parseOr400(claimCheckinDeviceRequestSchema, req.body, req, reply);
    if (body === null) return;
    const missed = Number((await deps.redis.get(claimMissKey(req))) ?? "0");
    let claimed: Awaited<ReturnType<typeof service.claimDevice>>;
    try {
      claimed = await service.claimDevice(checkinDeps, body.token);
    } catch (err) {
      if (!(err instanceof OrgsError) || err.code !== "link_not_valid") throw err;
      await deps.redis.incrWithTtl(claimMissKey(req), 60 * 60);
      if (missed < CLAIM_MISSES_PER_HOUR) throw err;
      return reply.status(429).send({ error: "rate_limited", message: "Too many attempts. Please try again later.", requestId: req.id });
    }
    return reply
      .status(200)
      .header("cache-control", "no-store")
      .setCookie(CHECKIN_DEVICE_COOKIE, deviceCookieValue(deviceSecret, claimed.key), {
        httpOnly: true,
        secure: prod,
        // The desk page and the api are different sites in production, as the session
        // cookies are (auth/routes.ts); the scan takes JSON only, which no other site's
        // page can send without the browser asking this api first.
        sameSite: prod ? "none" : "lax",
        path: CHECKIN_PATH,
        maxAge: DEVICE_COOKIE_MAX_AGE_S,
      })
      .send(claimed.answer);
  });

  app.post(SCAN_PATH, async (req, reply) => {
    const cookie = readDeviceCookie(deviceSecret, req.cookies[CHECKIN_DEVICE_COOKIE]);
    if (cookie?.marked !== true) {
      await scanAddressLimit(req, reply);
      if (reply.sent) return;
    }
    const device = cookie === null ? null : await service.deviceFor(checkinDeps, cookie.key);
    if (device === null && cookie?.marked === true) {
      // A marked key that is no longer a desk (switched off, or given a new link) has no
      // allowance of its own.
      await scanAddressLimit(req, reply);
      if (reply.sent) return;
    }
    if (device === null) {
      return reply.status(401).send({ error: "device_not_recognised", message: CHECKIN_WORDS.device_not_recognised, requestId: req.id });
    }
    if (!(await service.deviceRoom(checkinDeps, device)())) {
      return reply.status(429).send({ error: "rate_limited", message: "Too many scans. Please try again in a minute.", requestId: req.id });
    }
    const body = parseOr400(checkinScanRequestSchema, req.body, req, reply);
    if (body === null) return;
    const answer = await service.scan(checkinDeps, device, body.code);
    return reply.status(200).header("cache-control", "no-store").send(answer);
  });
}
