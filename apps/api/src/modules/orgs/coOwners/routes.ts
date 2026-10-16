// Co-owners (ROADMAP Stage 2 item 4b-i).
//   POST   /v1/orgs/:gymId/staff/:userId/co-owner-request      the owner asks them
//   DELETE /v1/orgs/:gymId/staff/:userId/co-owner-request      the owner cancels it
//   GET    /v1/orgs/:gymId/co-owner-request                    the caller's own, waiting here
//   POST   /v1/orgs/:gymId/co-owner-request/:requestId/accept  the person asked
//   POST   /v1/orgs/:gymId/co-owner-request/:requestId/decline
// Who may is the service's: the owner by the gym's own owner id, the person asked by theirs.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import { coOwnerRequestParamsSchema, coOwnerStaffParamsSchema } from "@app/shared";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import { orgParamsSchema } from "../schemas.js";
import * as service from "./service.js";

const HOUR_MS = 60 * 60 * 1000;

function parseOr400<S extends z.ZodTypeAny>(schema: S, value: unknown, req: FastifyRequest, reply: FastifyReply): z.output<S> | null {
  const parsed: z.SafeParseReturnType<unknown, z.output<S>> = schema.safeParse(value);
  if (!parsed.success) {
    void reply.status(400).send({
      error: "validation_error",
      message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.code}`).join("; "),
      requestId: req.id,
    });
    return null;
  }
  return parsed.data;
}

function callerId(req: FastifyRequest): string {
  const user = req.authUser;
  if (user === undefined) throw new Error("authenticate preHandler did not run");
  return user.id;
}

export function registerCoOwnerRoutes(app: FastifyInstance, deps: Omit<service.CoOwnerDeps, "log"> & { redis: RedisLike }): void {
  const coOwnerDeps: service.CoOwnerDeps = { sql: deps.sql, email: deps.email, webOrigin: deps.webOrigin, now: deps.now, log: app.log };
  const byPerson = (req: FastifyRequest): string | null => req.authUser?.id ?? null;
  // Each request is an email: a few an hour is an owner's whole need. A gym's staff can
  // share one wi-fi address, so the address allowance is wide.
  const sendLimit = createDualRateLimit({ name: "co_owner_request", max: 20, ipMax: 300, windowMs: HOUR_MS, identifier: byPerson, redis: deps.redis });
  // Overview asks once each time it opens.
  const readLimit = createDualRateLimit({ name: "co_owner_request_read", max: 300, ipMax: 3000, windowMs: HOUR_MS, identifier: byPerson, redis: deps.redis });
  const answerLimit = createDualRateLimit({ name: "co_owner_request_answer", max: 10, ipMax: 600, windowMs: HOUR_MS, identifier: byPerson, redis: deps.redis });

  app.post("/v1/orgs/:gymId/staff/:userId/co-owner-request", { preHandler: [app.authenticate, sendLimit] }, async (req, reply) => {
    const params = parseOr400(coOwnerStaffParamsSchema, req.params, req, reply);
    if (params === null) return;
    return reply.status(201).send(await service.sendCoOwnerRequest(coOwnerDeps, callerId(req), params.gymId, params.userId));
  });

  app.delete("/v1/orgs/:gymId/staff/:userId/co-owner-request", { preHandler: [app.authenticate, sendLimit] }, async (req, reply) => {
    const params = parseOr400(coOwnerStaffParamsSchema, req.params, req, reply);
    if (params === null) return;
    return reply.status(200).send(await service.cancelCoOwnerRequest(coOwnerDeps, callerId(req), params.gymId, params.userId));
  });

  app.get("/v1/orgs/:gymId/co-owner-request", { preHandler: [app.authenticate, readLimit] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    return reply.status(200).send(await service.myCoOwnerRequest(coOwnerDeps, callerId(req), params.gymId));
  });

  for (const answer of ["accept", "decline"] as const) {
    app.post(`/v1/orgs/:gymId/co-owner-request/:requestId/${answer}`, { preHandler: [app.authenticate, answerLimit] }, async (req, reply) => {
      const params = parseOr400(coOwnerRequestParamsSchema, req.params, req, reply);
      if (params === null) return;
      return reply.status(200).send(await service.answerCoOwnerRequest(coOwnerDeps, callerId(req), params.gymId, params.requestId, answer === "accept"));
    });
  }
}
