// MY MEMBERSHIP: THE ROUTES (spec Part 3 §14.2; ROADMAP 18j). Authenticate, Zod-parse, then
// the service decides whose it is, then the limit. Registered from `registerOrgRoutes`.
//
//   GET /v1/orgs/:gymId/my-membership                    what the reader holds and paid
//   GET /v1/orgs/:gymId/my-membership/receipts/:number   one receipt of their own
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import type { z } from "zod";
import { receiptParamsSchema } from "@app/shared";
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

export function registerMyMembershipRoutes(app: FastifyInstance, deps: { sql: Sql; redis: RedisLike; now: () => Date }): void {
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
}
