// The Reports page's routes (ROADMAP 21a-i, 21a-ii): authenticate, the asker's own ceiling,
// Zod-parse, who may read, the limit, then the read. The service owns the authorisation.
//
//   GET /v1/orgs/:gymId/reports/members      the members figures (`reports.read`)
//   GET /v1/orgs/:gymId/reports/attendance   the attendance figures (`reports.read`)
import type { FastifyInstance } from "fastify";
import type { Sql } from "postgres";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import { orgParamsSchema } from "../schemas.js";
import * as service from "./service.js";

export function registerReportsRoutes(app: FastifyInstance, deps: { sql: Sql; redis: RedisLike; now: () => Date }): void {
  const reportsDeps: service.ReportsDeps = { sql: deps.sql, now: deps.now };

  /** Read each time the page opens, both reports from one allowance. Keyed on the person; a gym's staff share one address,
   *  so the address ceiling is ten times one person's and is counted a gym at a time. It
   *  is asked after the staff check, so somebody refused uses up nobody's allowance. */
  const limit = createDualRateLimit({
    name: "orgs_reports",
    max: 120,
    ipMax: 1200,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    ipScope: (req) => {
      const params = orgParamsSchema.safeParse(req.params);
      return params.success ? params.data.gymId : null;
    },
    redis: deps.redis,
  });

  /** Every ask, refused ones too, against the asker alone and never the address: somebody
   *  who is not this gym's staff cannot ask without end, and uses up nobody else's allowance.
   *  Above a reader's own 120, so staff meet that one first. */
  const askerLimit = createDualRateLimit({
    name: "orgs_reports_asks",
    max: 300,
    ipMax: null,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });

  const routes = [
    ["/v1/orgs/:gymId/reports/members", service.getMembersReport],
    ["/v1/orgs/:gymId/reports/attendance", service.getAttendanceReport],
  ] as const;
  for (const [path, read] of routes) {
    app.get(path, { preHandler: [app.authenticate, askerLimit] }, async (req, reply) => {
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
      const org = await service.requireReportsReader(reportsDeps, userId, params.data.gymId);
      await limit(req, reply);
      if (reply.sent) return reply;
      return reply.status(200).send(await read(reportsDeps, params.data.gymId, org));
    });
  }
}
