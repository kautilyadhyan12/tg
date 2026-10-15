// Refer a friend (ROADMAP 20e-ii-a): the owner's settings and a member's own link, behind
// sign-in. The invite page's two public routes are with the gym page's, whose limits its
// form shares (`gymPage/routes.ts`). Registered from `registerOrgRoutes`.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import type { z } from "zod";
import { setReferralSettingsRequestSchema } from "@app/shared";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import { orgParamsSchema } from "../schemas.js";
import * as service from "./service.js";

function parseOr400<S extends z.ZodTypeAny>(schema: S, value: unknown, req: FastifyRequest, reply: FastifyReply): z.output<S> | null {
  const parsed: z.SafeParseReturnType<unknown, z.output<S>> = schema.safeParse(value);
  if (!parsed.success) {
    void reply.status(400).send({
      error: "validation_error",
      message: parsed.error.issues.slice(0, 10).map((i) => `${i.path.join(".")}: ${i.code}`).join("; "),
      requestId: req.id,
    });
    return null;
  }
  return parsed.data;
}

function requireUserId(req: FastifyRequest): string {
  const userId = req.authUser?.id;
  if (userId === undefined) throw new Error("authenticate preHandler did not run");
  return userId;
}

export function registerReferralRoutes(app: FastifyInstance, deps: { sql: Sql; redis: RedisLike; now: () => Date }): void {
  const referralDeps: service.ReferralDeps = { sql: deps.sql, now: deps.now };
  // Who is asking first and the limit after it, so a stranger's 404 is never a 429.
  const gate =
    (limit: (req: FastifyRequest, reply: FastifyReply) => Promise<void>) =>
    (req: FastifyRequest, reply: FastifyReply) =>
    async (): Promise<boolean> => {
      await limit(req, reply);
      return !reply.sent;
    };
  // Set now and then; counted a gym at a time at a shared address, so one gym's staff
  // cannot use up another's there.
  const settingsLimit = createDualRateLimit({
    name: "orgs_referral_settings",
    max: 120,
    ipMax: 600,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    ipScope: (req) => orgParamsSchema.safeParse(req.params).data?.gymId ?? null,
    redis: deps.redis,
  });
  // A whole gym's members share one address on its wi-fi, hence the explicit `ipMax`.
  const memberLimit = createDualRateLimit({
    name: "orgs_referral_member",
    max: 300,
    ipMax: 6000,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });

  app.get("/v1/orgs/:gymId/referral-settings", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const settings = await service.getReferralSettings(referralDeps, requireUserId(req), params.gymId, gate(settingsLimit)(req, reply));
    if (settings === null) return;
    return reply.status(200).send({ settings });
  });

  // PUT: the switch and both codes, every time. Saved twice it is saved once.
  app.put("/v1/orgs/:gymId/referral-settings", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(setReferralSettingsRequestSchema, req.body, req, reply);
    if (body === null) return;
    const settings = await service.setReferralSettings(referralDeps, requireUserId(req), params.gymId, body, gate(settingsLimit)(req, reply));
    if (settings === null) return;
    return reply.status(200).send({ settings });
  });

  // The member's own link and the business's offer. Asked twice, the same link.
  app.get("/v1/orgs/:gymId/referral", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const referral = await service.getMemberReferral(referralDeps, requireUserId(req), params.gymId, gate(memberLimit)(req, reply));
    if (referral === null) return;
    return reply.status(200).header("cache-control", "no-store").send(referral);
  });
}
