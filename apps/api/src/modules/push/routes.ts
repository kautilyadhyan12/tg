// THE PHONE'S NOTIFICATION ADDRESS (ROADMAP Stage 5 item 18b-i; spec Part 6 §6). Signed in on the
// phone, the app gives the server the address Firebase gave it; it is kept with that sign-in only.
// Order: authenticate → rate limit → handler. No id in the path: a caller can only ever save an
// address for themselves.
import { pushTokenRequestSchema } from "@app/shared";
import type { FastifyInstance } from "fastify";
import type { Sql } from "postgres";
import type { RedisLike } from "../../redis.js";
import { createDualRateLimit } from "../auth/rateLimit.js";
import * as repo from "./repo.js";

export function registerPushRoutes(app: FastifyInstance, deps: { sql: Sql; redis: RedisLike; now?: () => Date }): void {
  const now = deps.now ?? (() => new Date());
  // The app gives it on each opening and when Firebase changes it: 30 an hour is far above that.
  const limit = createDualRateLimit({
    name: "push_token",
    max: 30,
    ipMax: null,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });

  app.put("/v1/push-tokens", { preHandler: [app.authenticate, limit] }, async (req, reply) => {
    const user = req.authUser;
    if (user === undefined) throw new Error("authenticate preHandler did not run");
    const parsed = pushTokenRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "validation_error",
        message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.code}`).join("; "),
        requestId: req.id,
      });
    }
    // Only a sign-in made on the phone, and still open, may have an address.
    const saved =
      user.familyId !== null &&
      (await repo.saveToken(deps.sql, { userId: user.id, familyId: user.familyId, ...parsed.data, now: now() }));
    if (!saved) {
      return reply.status(403).send({ error: "not_a_phone_sign_in", message: "Sign in on the app to get notifications.", requestId: req.id });
    }
    return reply.status(200).send({ saved: true });
  });
}
