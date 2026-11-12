// MY MEMBERSHIP: THE ROUTES (spec Part 3 §14.2; ROADMAP 18j). Authenticate, Zod-parse, then
// the service decides whose it is, then the limit. Registered from `registerOrgRoutes`.
//
//   GET /v1/orgs/:gymId/my-membership                    what the reader holds and paid
//   GET /v1/orgs/:gymId/my-membership/receipts/:number   one receipt of their own
//   GET  /v1/orgs/:gymId/my-membership/memberships/:membershipId/cancel   the box under Cancel membership (18l)
//   POST /v1/orgs/:gymId/my-membership/memberships/:membershipId/cancel   cancel it, as the box said
//   POST /v1/orgs/:gymId/my-membership/cancels/:cancelId/reason           why they are leaving, afterwards
//   GET  /v1/orgs/:gymId/app-cancels                                       Overview's Cancelled in the app, for staff
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import type { z } from "zod";
import { myCancelReasonRequestSchema, myCancelRequestSchema, receiptParamsSchema } from "@app/shared";
import type { LiveNewsSender } from "../../live/news.js";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import { myCancelParamsSchema, myCancelReasonParamsSchema, orgParamsSchema } from "../schemas.js";
import * as cancel from "./cancel.js";
import type { CancelEmailSender } from "./cancelEmail.js";
import * as service from "./service.js";

function parseOr400<S extends z.ZodType>(schema: S, value: unknown, req: FastifyRequest, reply: FastifyReply): z.output<S> | null {
  const parsed: z.ZodSafeParseResult<z.output<S>> = schema.safeParse(value);
  if (!parsed.success) {
    // Issue paths and codes only, never the offending value.
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

export function registerMyMembershipRoutes(
  app: FastifyInstance,
  deps: { sql: Sql; redis: RedisLike; now: () => Date; news: LiveNewsSender; cancelEmail: CancelEmailSender; addressKey: Buffer | null },
): void {
  // A whole gym opens the app on one wi-fi address, so the address ceiling is many people's.
  const readLimit = createDualRateLimit({
    name: "orgs_my_membership_read",
    max: 600,
    ipMax: 30_000,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  // Membership first and the limit after it: a stranger's 404 is never a 429.
  const gate = (req: FastifyRequest, reply: FastifyReply) => async (): Promise<boolean> => {
    await readLimit(req, reply);
    return !reply.sent;
  };

  app.get("/v1/orgs/:gymId/my-membership", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const mine = await service.getMyMembership(deps, requireUserId(req), params.gymId, gate(req, reply));
    if (mine === null) return;
    return reply.status(200).header("cache-control", "no-store").send(mine);
  });

  app.get("/v1/orgs/:gymId/my-membership/receipts/:number", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(receiptParamsSchema, req.params, req, reply);
    if (params === null) return;
    const receipt = await service.getMyReceipt(deps, requireUserId(req), params.gymId, params.number, gate(req, reply));
    if (receipt === null) return;
    return reply.status(200).header("cache-control", "no-store").send(receipt);
  });

  // Cancel in the app (18l). A member cancels a membership or two in a lifetime, and reads the box a few times first.
  // A whole gym is on one wi-fi address, so the address ceiling is many people's.
  const cancelDeps: cancel.CancelDeps = { sql: deps.sql, now: deps.now, news: deps.news, email: deps.cancelEmail, addressKey: deps.addressKey, log: app.log };
  const cancelLimit = createDualRateLimit({ name: "orgs_my_cancel", max: 60, ipMax: 3000, windowMs: 60 * 60 * 1000, identifier: (req) => req.authUser?.id ?? null, redis: deps.redis });
  const cancelGate = (req: FastifyRequest, reply: FastifyReply) => async (): Promise<boolean> => {
    await cancelLimit(req, reply);
    return !reply.sent;
  };
  const cancelUrl = "/v1/orgs/:gymId/my-membership/memberships/:membershipId/cancel";

  app.get(cancelUrl, { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(myCancelParamsSchema, req.params, req, reply);
    if (params === null) return;
    const ask = await cancel.readCancelAsk(cancelDeps, requireUserId(req), params.gymId, params.membershipId, gate(req, reply));
    if (ask === null) return;
    return reply.status(200).header("cache-control", "no-store").send(ask);
  });

  app.post(cancelUrl, { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(myCancelParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(myCancelRequestSchema, req.body, req, reply);
    if (body === null) return;
    const done = await cancel.cancelInApp(cancelDeps, requireUserId(req), params.gymId, params.membershipId, body, cancelGate(req, reply));
    if (done === null) return;
    return reply.status(200).header("cache-control", "no-store").send(done);
  });

  app.post("/v1/orgs/:gymId/my-membership/cancels/:cancelId/reason", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(myCancelReasonParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(myCancelReasonRequestSchema, req.body, req, reply);
    if (body === null) return;
    const set = await cancel.setCancelReason(cancelDeps, requireUserId(req), params.gymId, params.cancelId, body.reason, cancelGate(req, reply));
    if (set === null) return;
    return reply.status(200).header("cache-control", "no-store").send(set);
  });

  // Staff: authenticate, the member-list tick, then the limit.
  app.get("/v1/orgs/:gymId/app-cancels", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const list = await cancel.readAppCancels(cancelDeps, requireUserId(req), params.gymId, gate(req, reply));
    if (list === null) return;
    return reply.status(200).header("cache-control", "no-store").send(list);
  });
}
