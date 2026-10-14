// P2.3 — gamification routes (thin, R7.1). R3.3 order: authn → handler
// (no input beyond the cookie). Self-keyed on req.authUser.id (R3.2).
import type { FastifyInstance } from "fastify";
import type { Sql } from "postgres";
import { getUserSyncContext } from "../users/service.js";
import { weeklyChallengesQuerySchema } from "@app/shared";
import * as service from "./service.js";

export function registerGamificationRoutes(app: FastifyInstance, deps: { sql: Sql }): void {
  app.get("/v1/gamification/me", { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = req.authUser?.id;
    if (userId === undefined) throw new Error("authenticate preHandler did not run");
    const ctx = await getUserSyncContext(deps.sql, userId);
    const me = await service.getMe({ sql: deps.sql }, userId, ctx.timezone);
    return reply.status(200).send(me);
  });

  // This week's challenges (ROADMAP 35b). The person is the session's own; nothing to send.
  app.get("/v1/gamification/challenges", { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = req.authUser?.id;
    if (userId === undefined) throw new Error("authenticate preHandler did not run");
    const query = weeklyChallengesQuerySchema.safeParse(req.query);
    if (!query.success) {
      return reply.status(400).send({
        error: "validation_error",
        message: query.error.issues.map((i) => `${i.path.join(".")}: ${i.code}`).join("; "),
        requestId: req.id,
      });
    }
    return reply.status(200).send(await service.getWeeklyChallenges({ sql: deps.sql }, userId));
  });
}
