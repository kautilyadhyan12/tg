// What waits (ROADMAP V1-d): authenticate, the asker's own ceiling (both before the handler),
// then Zod-parse, who may, the limit, and the read. The service owns the authorisation, and
// the limit that counts an address is asked AFTER it: a refused ask leaves the address alone.
//
//   GET /v1/orgs/:gymId/attention   the menu's counts and the bell's list (the business's staff)
import type { FastifyInstance } from "fastify";
import type { Sql } from "postgres";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import { orgParamsSchema } from "../schemas.js";
import type { SquareEnvironment } from "../payments/square.js";
import * as service from "./service.js";

export function registerAttentionRoutes(app: FastifyInstance, deps: { sql: Sql; redis: RedisLike; now: () => Date; squareEnvironment: SquareEnvironment | null }): void {
  const attentionDeps: service.AttentionDeps = { sql: deps.sql, now: deps.now, squareEnvironment: deps.squareEnvironment };

  /** Read as staff move between pages and come back to the window. Keyed on the person; a
   *  business's staff share one address, so the address ceiling is ten times one person's
   *  and is counted a business at a time. */
  const readLimit = createDualRateLimit({
    name: "orgs_attention",
    max: 900,
    ipMax: 9000,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    ipScope: (req) => orgParamsSchema.safeParse(req.params).data?.gymId ?? null,
    redis: deps.redis,
  });

  /** Every ask, refused ones too, against the asker alone and never the address. */
  const askerLimit = createDualRateLimit({
    name: "orgs_attention_asks",
    max: 1800,
    ipMax: null,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });

  app.get("/v1/orgs/:gymId/attention", { preHandler: [app.authenticate, askerLimit] }, async (req, reply) => {
    const params = orgParamsSchema.safeParse(req.params);
    if (!params.success) {
      return reply.status(400).send({
        error: "validation_error",
        // Issue paths and codes only, never the offending value.
        message: params.error.issues.map((i) => `${i.path.map(String).join(".")}: ${i.code}`).join("; "),
        requestId: req.id,
      });
    }
    const userId = req.authUser?.id;
    if (userId === undefined) throw new Error("authenticate preHandler did not run");
    const reader = await service.requireAttentionReader(attentionDeps, userId, params.data.gymId);
    await readLimit(req, reply);
    if (reply.sent) return reply;
    return reply.status(200).header("cache-control", "no-store").send(await service.getAttention(attentionDeps, params.data.gymId, userId, reader));
  });
}
