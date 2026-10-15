// Staff activity's route (ROADMAP 4d): authenticate, the asker's own ceiling, Zod-parse,
// the owner check, the limit, then the read. A refused ask uses up nobody's allowance.
//
//   GET /v1/orgs/:gymId/staff-activity?worker&from&to&after   (`staff.manage`, the owner)
import type { FastifyInstance } from "fastify";
import type { Sql } from "postgres";
import { staffActivityQuerySchema } from "@app/shared";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import { orgParamsSchema } from "../schemas.js";
import * as service from "./service.js";

export function registerStaffActivityRoutes(app: FastifyInstance, deps: { sql: Sql; redis: RedisLike; now: () => Date }): void {
  const activityDeps: service.StaffActivityDeps = { sql: deps.sql, now: deps.now };
  const gymOf = (params: unknown): string | null => orgParamsSchema.safeParse(params).data?.gymId ?? null;

  /** A page, a filter and Show more are each one read; far above an owner reading back
   *  through a busy month. Counted a gym at a time at one address. */
  const readLimit = createDualRateLimit({
    name: "orgs_staff_activity",
    max: 600,
    ipMax: 2400,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    ipScope: (req) => gymOf(req.params),
    redis: deps.redis,
  });

  /** Every ask, refused ones too, against the asker alone. */
  const askerLimit = createDualRateLimit({
    name: "orgs_staff_activity_asks",
    max: 1200,
    ipMax: null,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });

  const refused = (issues: readonly { path: PropertyKey[]; code: string }[], requestId: string) => ({
    error: "validation_error",
    // Issue paths and codes only, never the offending value.
    message: issues.map((i) => `${i.path.map(String).join(".")}: ${i.code}`).join("; "),
    requestId,
  });

  app.get("/v1/orgs/:gymId/staff-activity", { preHandler: [app.authenticate, askerLimit] }, async (req, reply) => {
    const params = orgParamsSchema.safeParse(req.params);
    if (!params.success) return reply.status(400).send(refused(params.error.issues, req.id));
    const query = staffActivityQuerySchema.safeParse(req.query);
    if (!query.success) return reply.status(400).send(refused(query.error.issues, req.id));
    const userId = req.authUser?.id;
    if (userId === undefined) throw new Error("authenticate preHandler did not run");
    const org = await service.requireReader(activityDeps, userId, params.data.gymId);
    await readLimit(req, reply);
    if (reply.sent) return reply;
    return reply.status(200).send(await service.getStaffActivity(activityDeps, org, query.data));
  });
}
