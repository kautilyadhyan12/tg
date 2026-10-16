// Download payments' routes (spec Part 3 §14.3; ROADMAP 18n): authenticate, the asker's own
// ceiling, Zod-parse, who may, the limit, then the read.
//
//   GET  /v1/orgs/:gymId/payments-download        what the file will hold (`billing.members`)
//   POST /v1/orgs/:gymId/payments-download.xlsx   the file itself (`billing.members`)
import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { z } from "zod";
import { paymentsDownloadQuerySchema } from "@app/shared";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import { contentDisposition } from "../memberList/exportCsv.js";
import * as service from "./service.js";

const paramsSchema = z.object({ gymId: z.string().uuid() }).strict();

/** The parsed value, or null once a 400 has been sent: issue paths and codes only, never
 *  the offending value. */
function parsed<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown, req: FastifyRequest, reply: FastifyReply): T | null {
  const out = schema.safeParse(value);
  if (out.success) return out.data;
  const message = out.error.issues
    .slice(0, 10)
    .map((i) => `${i.path.map(String).join(".")}: ${i.message}`)
    .join("; ");
  void reply.status(400).send({ error: "validation_error", message, requestId: req.id });
  return null;
}

export function registerPaymentsDownloadRoutes(app: FastifyInstance, deps: { sql: Sql; redis: RedisLike; now: () => Date }): void {
  const gymOf = (params: unknown): string | null => paramsSchema.safeParse(params).data?.gymId ?? null;
  const hour = 60 * 60 * 1000;
  /** Every ask, refused ones too, against the asker alone. */
  const askerLimit = createDualRateLimit({ name: "orgs_payments_download_asks", max: 600, ipMax: null, windowMs: hour, identifier: (req) => req.authUser?.id ?? null, redis: deps.redis });
  /** The box reads its line again as the days are picked. */
  const summaryLimit = createDualRateLimit({
    name: "orgs_payments_download_summary",
    max: 300,
    ipMax: 1500,
    windowMs: hour,
    identifier: (req) => req.authUser?.id ?? null,
    ipScope: (req: FastifyRequest) => gymOf(req.params),
    redis: deps.redis,
  });
  /** A file is a whole period's reading: 20 an hour each, a gym's staff sharing one address. */
  const fileLimit = createDualRateLimit({
    name: "orgs_payments_download_file",
    max: 20,
    ipMax: 60,
    windowMs: hour,
    identifier: (req) => req.authUser?.id ?? null,
    ipScope: (req: FastifyRequest) => gymOf(req.params),
    redis: deps.redis,
  });
  const userOf = (req: FastifyRequest): string => {
    const userId = req.authUser?.id;
    if (userId === undefined) throw new Error("authenticate preHandler did not run");
    return userId;
  };

  app.get("/v1/orgs/:gymId/payments-download", { preHandler: [app.authenticate, askerLimit] }, async (req, reply) => {
    const params = parsed(paramsSchema, req.params, req, reply);
    if (params === null) return reply;
    const query = parsed(paymentsDownloadQuerySchema, req.query, req, reply);
    if (query === null) return reply;
    const days = await service.requireReader(deps, userOf(req), params.gymId, query);
    await summaryLimit(req, reply);
    if (reply.sent) return reply;
    return reply.status(200).header("cache-control", "no-store").send(await service.summary(deps, params.gymId, days));
  });

  app.post("/v1/orgs/:gymId/payments-download.xlsx", { preHandler: [app.authenticate, askerLimit] }, async (req, reply) => {
    const params = parsed(paramsSchema, req.params, req, reply);
    if (params === null) return reply;
    const body = parsed(paymentsDownloadQuerySchema, req.body ?? {}, req, reply);
    if (body === null) return reply;
    const days = await service.requireReader(deps, userOf(req), params.gymId, body);
    await fileLimit(req, reply);
    if (reply.sent) return reply;
    const file = await service.file(deps, userOf(req), params.gymId, days);
    return await reply
      .status(200)
      .header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("content-disposition", contentDisposition(file.filename))
      .header("cache-control", "no-store")
      .send(Readable.from(file.chunks));
  });
}
