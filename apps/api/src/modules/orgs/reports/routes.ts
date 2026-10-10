// The Reports page's route (ROADMAP 21a-i): authenticate, rate-limit, Zod-parse, hand to
// the service, which owns the authorisation.
//
//   GET /v1/orgs/:gymId/reports/members   the members figures (`reports.read`)
import type { FastifyInstance } from "fastify";
import type { Sql } from "postgres";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import { orgParamsSchema } from "../schemas.js";
import * as service from "./service.js";

export function registerReportsRoutes(app: FastifyInstance, deps: { sql: Sql; redis: RedisLike; now: () => Date }): void {
  const reportsDeps: service.ReportsDeps = { sql: deps.sql, now: deps.now };

  /** Read each time the page opens. Keyed on the person; a gym's staff share one address,
   *  so the address ceiling is ten times one person's. */
  const limit = createDualRateLimit({
    name: "orgs_reports",
    max: 120,
    ipMax: 1200,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });

  app.get("/v1/orgs/:gymId/reports/members", { preHandler: [app.authenticate, limit] }, async (req, reply) => {
    const params = orgParamsSchema.safeParse(req.params);
    if (!params.success) {
      // Issue paths and codes only, never the offending value.
      return reply.status(400).send({
        error: "validation_error",
        message: params.error.issues.map((i) => `${i.path.join(".")}: ${i.code}`).join("; "),
        requestId: req.id,
      });
    }
    const userId = req.authUser?.id;
    if (userId === undefined) throw new Error("authenticate preHandler did not run");
    return reply.status(200).send(await service.getMembersReport(reportsDeps, userId, params.data.gymId));
  });
}
