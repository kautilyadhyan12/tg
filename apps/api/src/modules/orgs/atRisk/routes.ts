// The At risk page's routes (ROADMAP 20d-i): authenticate, the asker's own ceiling,
// Zod-parse, who may, the limit, then the work. The service owns the authorisation, and
// every limit that counts an address is asked AFTER it: a refused ask leaves the gym's
// address alone.
//
//   GET /v1/orgs/:gymId/at-risk            who has stopped coming (`members.read`)
//   PUT /v1/orgs/:gymId/at-risk/settings   the gym's two numbers (`org.manage`)
//   POST /v1/orgs/:gymId/at-risk/messages  the gym's own words to one person (`members.confirm`)
//
// A ready-made line is the come-back line the server already sends:
// POST /v1/orgs/:gymId/members/:userId/nudge.
import type { FastifyInstance } from "fastify";
import type { Sql } from "postgres";
import { atRiskMessageRequestSchema, atRiskSettingsSchema } from "@app/shared";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import { orgParamsSchema } from "../schemas.js";
import * as service from "./service.js";

export function registerAtRiskRoutes(app: FastifyInstance, deps: { sql: Sql; redis: RedisLike; now: () => Date }): void {
  const atRiskDeps: service.AtRiskDeps = { sql: deps.sql, now: deps.now };
  const gymOf = (params: unknown): string | null => orgParamsSchema.safeParse(params).data?.gymId ?? null;

  /** Read when the page or Overview opens. Keyed on the person; a gym's staff share one
   *  address, so the address ceiling is ten times one person's and is counted a gym at a
   *  time. Asked after the staff check, so somebody refused uses up nobody's allowance. */
  const readLimit = createDualRateLimit({
    name: "orgs_at_risk",
    max: 240,
    ipMax: 2400,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    ipScope: (req) => gymOf(req.params),
    redis: deps.redis,
  });

  const saveLimit = createDualRateLimit({
    name: "orgs_at_risk_settings",
    max: 60,
    ipMax: 600,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    ipScope: (req) => gymOf(req.params),
    redis: deps.redis,
  });

  /** Every ask, refused ones too, against the asker alone and never the address: somebody
   *  who is not this gym's staff cannot ask without end. Above a reader's own allowance. */
  const askerLimit = createDualRateLimit({
    name: "orgs_at_risk_asks",
    max: 600,
    ipMax: null,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });

  /** The ready-made line's own numbers: far above a list worked down in one sitting. */
  const messageLimit = createDualRateLimit({
    name: "orgs_at_risk_message",
    max: 60,
    ipMax: 600,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    ipScope: (req) => gymOf(req.params),
    redis: deps.redis,
  });

  const refused = (issues: readonly { path: PropertyKey[]; code: string }[], requestId: string) => ({
    error: "validation_error",
    // Issue paths and codes only, never the offending value.
    message: issues.map((i) => `${i.path.map(String).join(".")}: ${i.code}`).join("; "),
    requestId,
  });

  app.get("/v1/orgs/:gymId/at-risk", { preHandler: [app.authenticate, askerLimit] }, async (req, reply) => {
    const params = orgParamsSchema.safeParse(req.params);
    if (!params.success) return reply.status(400).send(refused(params.error.issues, req.id));
    const userId = req.authUser?.id;
    if (userId === undefined) throw new Error("authenticate preHandler did not run");
    await service.requireReader(atRiskDeps, userId, params.data.gymId);
    await readLimit(req, reply);
    if (reply.sent) return reply;
    return reply.status(200).send(await service.getAtRisk(atRiskDeps, params.data.gymId));
  });

  app.put("/v1/orgs/:gymId/at-risk/settings", { preHandler: [app.authenticate, askerLimit] }, async (req, reply) => {
    const params = orgParamsSchema.safeParse(req.params);
    if (!params.success) return reply.status(400).send(refused(params.error.issues, req.id));
    const body = atRiskSettingsSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send(refused(body.error.issues, req.id));
    const userId = req.authUser?.id;
    if (userId === undefined) throw new Error("authenticate preHandler did not run");
    await service.requireSettingsWriter(atRiskDeps, userId, params.data.gymId);
    await saveLimit(req, reply);
    if (reply.sent) return reply;
    return reply.status(200).send(await service.setSettings(atRiskDeps, userId, params.data.gymId, body.data));
  });

  // Sent twice from one box it is sent once: the body carries the box's own key.
  app.post("/v1/orgs/:gymId/at-risk/messages", { preHandler: [app.authenticate, askerLimit] }, async (req, reply) => {
    const params = orgParamsSchema.safeParse(req.params);
    if (!params.success) return reply.status(400).send(refused(params.error.issues, req.id));
    const body = atRiskMessageRequestSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send(refused(body.error.issues, req.id));
    const userId = req.authUser?.id;
    if (userId === undefined) throw new Error("authenticate preHandler did not run");
    const org = await service.requireMessageWriter(atRiskDeps, userId, params.data.gymId);
    await messageLimit(req, reply);
    if (reply.sent) return reply;
    return reply.status(201).send(await service.sendOwnMessage(atRiskDeps, userId, params.data.gymId, org, body.data));
  });
}
