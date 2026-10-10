// A MEMBER'S INBOX FROM THEIR GYM: THE ROUTES (spec Part 3 §16.1; ROADMAP 20a).
// Authenticate, Zod-parse, and the service decides who may read. Registered from
// `registerOrgRoutes`.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import { gymGroupMessagesSwitchRequestSchema, markGymInboxReadRequestSchema } from "@app/shared";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import { orgParamsSchema } from "../schemas.js";
import * as service from "./service.js";

function parseOr400<S extends z.ZodTypeAny>(schema: S, value: unknown, req: FastifyRequest, reply: FastifyReply): z.output<S> | null {
  const parsed: z.SafeParseReturnType<unknown, z.output<S>> = schema.safeParse(value);
  if (!parsed.success) {
    // Issue paths and codes only, never the offending value.
    void reply.status(400).send({
      error: "validation_error",
      message: parsed.error.issues.slice(0, 10).map((i) => `${i.path.join(".")}: ${i.code}`).join("; "),
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

export function registerMessageRoutes(app: FastifyInstance, deps: service.MessagesDeps & { redis: RedisLike }): void {
  const messagesDeps: service.MessagesDeps = { sql: deps.sql, now: deps.now };
  const limiter = (name: string, max: number, ipMax: number) =>
    createDualRateLimit({
      name,
      max,
      ipMax,
      windowMs: 60 * 60 * 1000,
      identifier: (req) => req.authUser?.id ?? null,
      redis: deps.redis,
    });
  // A whole gym's members share one address on its wi-fi, hence each explicit `ipMax`.
  const readLimit = limiter("orgs_inbox_read", 600, 6000);
  const markLimit = limiter("orgs_inbox_mark", 300, 6000);
  const switchLimit = limiter("orgs_inbox_switch", 60, 6000);

  // Who is asking first and the limit after it, so a stranger's 404 is never a 429 and
  // never counts against the gym's shared address.
  const gate =
    (limit: (req: FastifyRequest, reply: FastifyReply) => Promise<void>) =>
    (req: FastifyRequest, reply: FastifyReply) =>
    async (): Promise<boolean> => {
      await limit(req, reply);
      return !reply.sent;
    };

  app.get("/v1/orgs/:gymId/inbox", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const inbox = await service.getInbox(messagesDeps, requireUserId(req), params.gymId, gate(readLimit)(req, reply));
    if (inbox === null) return;
    return reply.status(200).send(inbox);
  });

  // Marked twice it is marked once, so it needs no key.
  app.post("/v1/orgs/:gymId/inbox/read", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(markGymInboxReadRequestSchema, req.body ?? {}, req, reply);
    if (body === null) return;
    const left = await service.markRead(messagesDeps, requireUserId(req), params.gymId, body, gate(markLimit)(req, reply));
    if (left === null) return;
    return reply.status(200).send(left);
  });

  // The member's own switch for this gym's messages to groups. Set twice it is set once.
  app.put("/v1/orgs/:gymId/inbox/group-messages", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(gymGroupMessagesSwitchRequestSchema, req.body, req, reply);
    if (body === null) return;
    const now = await service.setGroupMessages(messagesDeps, requireUserId(req), params.gymId, body, gate(switchLimit)(req, reply));
    if (now === null) return;
    return reply.status(200).send(now);
  });
}
