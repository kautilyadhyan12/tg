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
import type { AppConfig } from "../../config.js";
import type { RedisLike } from "../../redis.js";
import { DPDP_RETENTION_DAYS } from "../../retention.js";
import { createLogOnlyUsersEmailSender, type UsersEmailSender } from "./email.js";
import {
  deleteAccountRequestSchema,
  putFitnessProfileRequestSchema,
  putHealthScreeningRequestSchema,
  recordConsentRequestSchema,
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
  deps: { sql: Sql; config: AppConfig; redis: RedisLike; emailSender?: UsersEmailSender },
): void {
  const usersDeps: service.UsersDeps = {
    sql: deps.sql,
    config: deps.config,
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

  // Health screening and Safe mode (ROADMAP 3b). Same tenancy argument as the
  // fitness profile: no id param, so only the signed-in person's own row.
  app.get("/v1/users/me/health-screening", { preHandler: [app.authenticate] }, async (req, reply) => {
    const healthScreening = await service.getHealthScreening(usersDeps, authedUserId(req));
    return reply.status(200).send({ healthScreening });
  });

  // PUT: the whole screening replaced; the same body twice yields the same row.
  app.put("/v1/users/me/health-screening", { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = parseBody(putHealthScreeningRequestSchema, req, reply);
    if (body === null) return;
    const healthScreening = await service.putHealthScreening(usersDeps, authedUserId(req), body);
    return reply.status(200).send({ healthScreening });
  });

  // The consent log: one row per disclaimer tap; the person can read their own
  // (the newest page, with the total so a short list never passes for all).
  app.get("/v1/users/me/consents", { preHandler: [app.authenticate] }, async (req, reply) => {
    const list = await service.listConsents(usersDeps, authedUserId(req));
    return reply.status(200).send(list);
  });

  // Appends to a table the purge never empties, so it gets its own ceiling on
  // top of the global one: three screens carry a disclaimer, so thirty taps an
  // hour is far beyond honest use. Keyed on the signed-in person AND the IP
  // (authenticate runs first, R3.3, so the person is known here).
  //
  // THE TWO DIMENSIONS ARE DELIBERATELY ASYMMETRIC, and the IP number is the
  // GYM-FLOOR figure this repo already uses for the routes a whole building
  // shares (orgs/routes.ts: attendanceMarkLimit, cheerLimit, memberNudgeLimit).
  // A gym's whole floor onboards from one address, so the person's own 30
  // counted against the address would have thrown the ELEVENTH person off the
  // wi-fi mid-onboarding — a tap they cannot finish signing up without.
  // 600 was the first answer to that and was still too tight: three taps a
  // person is only 200 people an hour, under the 300 members a trial
  // organisation admits (RULINGS 2026-08-25), so a bulk induction would 429 its
  // tail with the identical consequence. 3000 clears any one gym's whole roster
  // and still bounds a script; the abuse guard is the PER-PERSON 30, untouched.
  const consentLimit = createDualRateLimit({
    name: "consent",
    max: 30,
    ipMax: 3000,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });

  app.post("/v1/users/me/consents", { preHandler: [app.authenticate, consentLimit] }, async (req, reply) => {
    const body = parseBody(recordConsentRequestSchema, req, reply);
    if (body === null) return;
    const consent = await service.recordConsent(usersDeps, authedUserId(req), body);
    return reply.status(201).send({ consent });
  });

  // Step 1 of deleting: a code goes to the account's own address. The day cap
  // and resend gap are the sign-in code's (counted separately, by purpose).
  app.post("/v1/users/me/delete-code", { preHandler: [app.authenticate] }, async (req, reply) => {
    const rules = await service.requestDeleteCode(usersDeps, authedUserId(req));
    return reply.status(200).send({ message: "We emailed you a 6-digit code.", ...rules });
  });

  // Step 2: the code in the body proves it is the account holder deleting.
  app.delete("/v1/users/me", { preHandler: [app.authenticate] }, async (req, reply) => {
    const input = parseBody(deleteAccountRequestSchema, req, reply);
    if (input === null) return;
    const { emailSent } = await service.deleteAccount(usersDeps, authedUserId(req), input.code);
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
