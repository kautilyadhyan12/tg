// The receipts' route (spec Part 3 §14.3; ROADMAP 18g-i): authenticate, the asker's own
// ceiling, Zod-parse, who may, the limit, then the read.
//
//   GET /v1/orgs/:gymId/receipts/:number   one receipt (`billing.members`)
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { z } from "zod";
import { receiptParamsSchema } from "@app/shared";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import * as service from "./service.js";

export function registerReceiptRoutes(app: FastifyInstance, deps: { sql: Sql; redis: RedisLike }): void {
  const gymOf = (params: unknown): string | null => z.object({ gymId: z.string().uuid() }).safeParse(params).data?.gymId ?? null;
  const hour = 60 * 60 * 1000;
  /** Every ask, refused ones too, against the asker alone and never the address. */
  const askerLimit = createDualRateLimit({ name: "orgs_receipts_asks", max: 3000, ipMax: null, windowMs: hour, identifier: (req) => req.authUser?.id ?? null, redis: deps.redis });
  /** A desk opens a receipt after a sale and prints it; a gym's staff share one address,
   *  so the address ceiling is several people's, and one gym's never another's. */
  const readLimit = createDualRateLimit({
    name: "orgs_receipts_read",
    max: 1200,
    ipMax: 6000,
    windowMs: hour,
    identifier: (req) => req.authUser?.id ?? null,
    ipScope: (req: FastifyRequest) => gymOf(req.params),
    redis: deps.redis,
  });

  app.get("/v1/orgs/:gymId/receipts/:number", { preHandler: [app.authenticate, askerLimit] }, async (req, reply) => {
    const params = receiptParamsSchema.safeParse(req.params);
    if (!params.success) {
      // Issue paths and codes only, never the offending value.
      const message = params.error.issues
        .slice(0, 10)
        .map((i) => `${i.path.map(String).join(".")}: ${i.code}`)
        .join("; ");
      return reply.status(400).send({ error: "validation_error", message, requestId: req.id });
    }
    const userId = req.authUser?.id;
    if (userId === undefined) throw new Error("authenticate preHandler did not run");
    await service.requireReceiptReader(deps, userId, params.data.gymId);
    await readLimit(req, reply);
    if (reply.sent) return reply;
    return reply.status(200).header("cache-control", "no-store").send(await service.getReceipt(deps, params.data.gymId, params.data.number));
  });
}
