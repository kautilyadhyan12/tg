// P2.2 — users routes (thin, R7.1). Route order per R3.3: authn (app.authenticate)
// → Zod parse → handler. Tenancy: every operation is keyed on req.authUser.id —
// there are no id params on this surface, so a user can only ever address
// their own row (R3.2). /restore is unauthenticated by nature (a deleted user
// cannot log in) and rate-limited like password reset (GAP-4 ruling: 5/hr,
// dual-key — no identifier in the body, so the IP bucket carries it).
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import type { z } from "zod";
import { createDualRateLimit } from "../auth/rateLimit.js";
import type { RedisLike } from "../../redis.js";
import { DPDP_RETENTION_DAYS } from "../../retention.js";
import { createLogOnlyUsersEmailSender, type UsersEmailSender } from "./email.js";
import {
  putFitnessProfileRequestSchema,
  restoreAccountRequestSchema,
  updateProfileRequestSchema,
} from "./schemas.js";
import * as service from "./service.js";

/** Zod-parse a body; 400 with issue paths/codes only — never echo values (R3.10). */
function parseBody<T>(schema: z.ZodType<T>, req: FastifyRequest, reply: FastifyReply): T | null {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    void reply.status(400).send({
      error: "validation_error",
      message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.code}`).join("; "),
      requestId: req.id,
    });
    return null;
  }
  return parsed.data;
}

export function registerUserRoutes(
  app: FastifyInstance,
  deps: { sql: Sql; redis: RedisLike; emailSender?: UsersEmailSender },
): void {
  const usersDeps: service.UsersDeps = {
    sql: deps.sql,
    redis: deps.redis,
    emailSender: deps.emailSender ?? createLogOnlyUsersEmailSender(app.log),
    log: app.log,
  };

  const authedUserId = (req: FastifyRequest): string => {
    const userId = req.authUser?.id;
    if (userId === undefined) throw new Error("authenticate preHandler did not run");
    return userId;
  };

  app.get("/v1/users/me", { preHandler: [app.authenticate] }, async (req, reply) => {
    const user = await service.getProfile(usersDeps, authedUserId(req));
    return reply.status(200).send({ user });
  });

  app.patch("/v1/users/me", { preHandler: [app.authenticate] }, async (req, reply) => {
    const patch = parseBody(updateProfileRequestSchema, req, reply);
    if (patch === null) return;
    const user = await service.updateProfile(usersDeps, authedUserId(req), patch);
    return reply.status(200).send({ user });
  });

  // onboarding/fitness profile (onboarding-storage card). Tenancy as above: no
  // id param exists, so a caller can only ever address their own row (R3.2).
  app.get("/v1/users/me/fitness-profile", { preHandler: [app.authenticate] }, async (req, reply) => {
    const fitnessProfile = await service.getFitnessProfile(usersDeps, authedUserId(req));
    return reply.status(200).send({ fitnessProfile });
  });

  // PUT, not POST: full-document replace, idempotent by construction — the same
  // body twice yields the same row, so no Idempotency-Key is needed (R3.5).
  app.put("/v1/users/me/fitness-profile", { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = parseBody(putFitnessProfileRequestSchema, req, reply);
    if (body === null) return;
    const fitnessProfile = await service.putFitnessProfile(usersDeps, authedUserId(req), body);
    return reply.status(200).send({ fitnessProfile });
  });

  app.delete("/v1/users/me", { preHandler: [app.authenticate] }, async (req, reply) => {
    const { emailSent } = await service.deleteAccount(usersDeps, authedUserId(req));
    // T3 2026-07-11 finding 6: don't promise an email that wasn't sent
    // (OAuth-only accounts have no address; sender may also have failed).
    // The number is interpolated from src/retention.ts, never restated: if
    // the window ever widens (Kd's open privacy-scope ruling), copy that
    // still said "14 days" would be the API lying about its own behaviour.
    return reply.status(200).send({
      message: emailSent
        ? `Account scheduled for deletion. You have ${String(DPDP_RETENTION_DAYS)} days to undo via the link we emailed you.`
        : `Account scheduled for deletion. It will be permanently removed after ${String(DPDP_RETENTION_DAYS)} days.`,
    });
  });

  // 5/hr — the reset-class limit (rateLimiter.js:17-18 ported at P2.1; GAP-4).
  const restoreLimit = createDualRateLimit({
    name: "restore",
    max: 5,
    windowMs: 60 * 60 * 1000,
    identifier: () => null, // body carries only the token — never key a bucket on a secret
    redis: deps.redis,
  });

  app.post("/v1/users/me/restore", { preHandler: [restoreLimit] }, async (req, reply) => {
    const input = parseBody(restoreAccountRequestSchema, req, reply);
    if (input === null) return;
    await service.restoreAccount(usersDeps, input.token);
    return reply.status(200).send({ message: "Account restored. You can now log in." });
  });
}
