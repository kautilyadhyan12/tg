// Signed forms of deleted members (ROADMAP 18u-iii), for the gym's own owner:
//   GET /v1/orgs/:gymId/deleted-forms                     a page of them, searched by name
//   GET /v1/orgs/:gymId/deleted-forms/:kind/:formId       one, as it was signed
// Authenticate, then the gym's own owner, then the limit, then the handler.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { deletedFormKindSchema, deletedFormsQuerySchema } from "@app/shared";
import type { Sql } from "postgres";
import { z } from "zod";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import { orgParamsSchema } from "../schemas.js";
import * as service from "./service.js";

const HOUR_MS = 60 * 60 * 1000;

const formParamsSchema = z.object({ gymId: z.uuid(), kind: deletedFormKindSchema, formId: z.uuid() }).strict();

function parseOr400<S extends z.ZodType>(schema: S, value: unknown, req: FastifyRequest, reply: FastifyReply): z.output<S> | null {
  const parsed: z.ZodSafeParseResult<z.output<S>> = schema.safeParse(value);
  if (!parsed.success) {
    // Issue paths and codes only, never the value: a search is a person's name.
    void reply.status(400).send({
      error: "validation_error",
      message: parsed.error.issues
        .slice(0, 10)
        .map((issue) => `${issue.path.join(".")}: ${issue.code}`)
        .join("; "),
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

export function registerDeletedFormsRoutes(app: FastifyInstance, deps: { sql: Sql; redis: RedisLike; now: () => Date }): void {
  const formsDeps: service.DeletedFormsDeps = { sql: deps.sql, now: deps.now };
  const byPerson = (req: FastifyRequest): string | null => req.authUser?.id ?? null;
  const gate =
    (limit: (req: FastifyRequest, reply: FastifyReply) => Promise<void>) =>
    (req: FastifyRequest, reply: FastifyReply) =>
    async (): Promise<boolean> => {
      await limit(req, reply);
      return !reply.sent;
    };

  // One owner looking for a person when a claim comes: a search typed a letter at a time, and a
  // few forms opened. Owners of several gyms may share an office's address.
  const readLimit = createDualRateLimit({ name: "deleted_forms_read", max: 300, ipMax: 900, windowMs: HOUR_MS, identifier: byPerson, redis: deps.redis });

  app.get("/v1/orgs/:gymId/deleted-forms", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const query = parseOr400(deletedFormsQuerySchema, req.query, req, reply);
    if (query === null) return;
    const forms = await service.listDeletedForms(formsDeps, requireUserId(req), params.gymId, query, gate(readLimit)(req, reply));
    if (forms === null) return;
    return reply.status(200).header("cache-control", "no-store").send(forms);
  });

  app.get("/v1/orgs/:gymId/deleted-forms/:kind/:formId", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(formParamsSchema, req.params, req, reply);
    if (params === null) return;
    const form = await service.readDeletedForm(formsDeps, requireUserId(req), params.gymId, params.kind, params.formId, gate(readLimit)(req, reply));
    if (form === null) return;
    return reply.status(200).header("cache-control", "no-store").send(form);
  });
}
