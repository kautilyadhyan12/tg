// P2.4 — entitlements route (thin, R7.1; DECISIONS GAP-3). R3.3: authn →
// handler. Self-keyed (R3.2); values are server-resolved — the response is a
// display hint, enforcement stays server-side (R3.1).
import type { FastifyInstance } from "fastify";
import type { Sql } from "postgres";
import type { RedisLike } from "../../redis.js";
import { getEntitlements } from "./service.js";

export function registerEntitlementRoutes(
  app: FastifyInstance,
  deps: { sql: Sql; redis: RedisLike },
): void {
  app.get("/v1/entitlements/me", { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = req.authUser?.id;
    if (userId === undefined) throw new Error("authenticate preHandler did not run");
    const me = await getEntitlements({ sql: deps.sql, redis: deps.redis }, userId);
    return reply.status(200).send(me);
  });
}
