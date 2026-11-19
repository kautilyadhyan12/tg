import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import { consoleSearchQuerySchema } from "@app/shared";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import { orgParamsSchema } from "../schemas.js";
import * as service from "./service.js";

// PEOPLE IN THE CONSOLE'S SEARCH (V1-e-ii): `GET /v1/orgs/:gymId/search/people?query=`.
// What is typed is never logged: the request line drops the query (`safeRequestSerializer`).

function parseOr400<S extends z.ZodType>(schema: S, value: unknown, req: FastifyRequest, reply: FastifyReply): z.output<S> | null {
  const parsed: z.ZodSafeParseResult<z.output<S>> = schema.safeParse(value);
  if (!parsed.success) {
    // Issue paths and codes only, never the value: it is somebody's name or number.
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

export function registerSearchRoutes(app: FastifyInstance, deps: service.SearchDeps): void {
  /** A read after each pause in typing, a few to one search: 1,200 an hour each, 4,000 from
   *  one address — `ipMax` explicit, for a front desk where several staff share one. */
  const searchLimit = createDualRateLimit({
    name: "console_search_people",
    max: 1200,
    ipMax: 4000,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });

  app.get("/v1/orgs/:gymId/search/people", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const query = parseOr400(consoleSearchQuerySchema, req.query, req, reply);
    if (query === null) return;
    const found = await service.searchPeople(deps, requireUserId(req), params.gymId, query, async () => {
      await searchLimit(req, reply);
      return !reply.sent;
    });
    if (found === null) return;
    return reply.status(200).send(found);
  });
}
