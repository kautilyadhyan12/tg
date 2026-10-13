// Overview's "Last 7 days" box (ROADMAP 20d-ii): authenticate, the asker's own ceiling
// (both before the handler), then Zod-parse, who may, the limit, and the read. The service owns the authorisation, and the
// limit that counts an address is asked AFTER it: a refused ask leaves the gym's address
// alone.
//
//   GET /v1/orgs/:gymId/week   the last seven days, in counts (the gym's staff)
import type { FastifyInstance } from "fastify";
import type { Sql } from "postgres";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import { orgParamsSchema } from "../schemas.js";
import * as service from "./service.js";

export function registerWeekRoutes(app: FastifyInstance, deps: { sql: Sql; redis: RedisLike; now: () => Date }): void {
  const weekDeps: service.WeekDeps = { sql: deps.sql, now: deps.now };

  /** Read each time Overview opens. Keyed on the person; a gym's staff share one address,
   *  so the address ceiling is ten times one person's and is counted a gym at a time. */
  const readLimit = createDualRateLimit({
    name: "orgs_week",
    max: 240,
    ipMax: 2400,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    ipScope: (req) => orgParamsSchema.safeParse(req.params).data?.gymId ?? null,
    redis: deps.redis,
  });

  /** Every ask, refused ones too, against the asker alone and never the address: somebody
   *  who is not this gym's staff cannot ask without end. */
  const askerLimit = createDualRateLimit({
    name: "orgs_week_asks",
    max: 600,
    ipMax: null,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });

  app.get("/v1/orgs/:gymId/week", { preHandler: [app.authenticate, askerLimit] }, async (req, reply) => {
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
    const reader = await service.requireWeekReader(weekDeps, userId, params.data.gymId);
    await readLimit(req, reply);
    if (reply.sent) return reply;
    return reply.status(200).send(await service.getWeek(weekDeps, params.data.gymId, reader));
  });
}
