// P2.3 — gamification routes (thin, R7.1). R3.3 order: authn → handler
// (no input beyond the cookie). Self-keyed on req.authUser.id (R3.2).
import type { FastifyInstance } from "fastify";
import type { Sql } from "postgres";
import { getUserSyncContext } from "../users/service.js";
import * as service from "./service.js";

export function registerGamificationRoutes(app: FastifyInstance, deps: { sql: Sql }): void {
  app.get("/v1/gamification/me", { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = req.authUser?.id;
    if (userId === undefined) throw new Error("authenticate preHandler did not run");
    const ctx = await getUserSyncContext(deps.sql, userId);
    const me = await service.getMe({ sql: deps.sql }, userId, ctx.timezone);
    return reply.status(200).send(me);
  });
}
