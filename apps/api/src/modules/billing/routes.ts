// A gym paying us (ROADMAP Stage 3 items 1a, 1c-i, 1c-ii and 1c-iii). Order per CLAUDE.md §4: authenticate →
// rate limit → parse → service (which checks `billing.manage` on the gym) → repo.
// Paddle's webhook: signature on the raw body, kept once by Paddle's event id, 200;
// the worker asks Paddle for the subscription before anything changes.
import { orgCheckoutRequestSchema, orgPlanChangeRequestSchema, paddleSubscriptionIdSchema, paddleWebhookBodySchema } from "@app/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { RedisLike } from "../../redis.js";
import { createDualRateLimit } from "../auth/rateLimit.js";
import * as webhooks from "../webhooks/repo.js";
import { verifyPaddleSignature } from "./paddleSignature.js";
import * as service from "./service.js";

export const PADDLE_WEBHOOK_PATH = "/v1/webhooks/paddle";

/** Paddle's subscription bodies are a few kilobytes; this leaves room and no more. */
const WEBHOOK_BODY_LIMIT = 256 * 1024;

const gymParams = z.object({ gymId: z.string().uuid() }).strict();
const checkoutParams = z.object({ gymId: z.string().uuid(), checkoutId: z.string().uuid() }).strict();
const idempotencyKey = z.string().min(1).max(100).regex(/^[\x21-\x7e]+$/);

function parseOr400<S extends z.ZodTypeAny>(schema: S, value: unknown, req: FastifyRequest, reply: FastifyReply): z.output<S> | null {
  const parsed: z.SafeParseReturnType<unknown, z.output<S>> = schema.safeParse(value);
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

function requireUserId(req: FastifyRequest): string {
  const userId = req.authUser?.id;
  if (userId === undefined) throw new Error("authenticate preHandler did not run");
  return userId;
}

export function registerBillingRoutes(
  app: FastifyInstance,
  deps: service.BillingDeps & { redis: RedisLike; webhookSecret: string | undefined; nowSeconds: () => number },
): void {
  // An owner subscribes once; these leave room for a slow network and a changed mind.
  const checkoutLimit = createDualRateLimit({
    name: "billing_checkout",
    max: 20,
    ipMax: 120,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  // The console asks every two seconds for up to a minute after paying.
  const syncLimit = createDualRateLimit({
    name: "billing_sync",
    max: 120,
    ipMax: 600,
    windowMs: 10 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });

  app.post(
    "/v1/orgs/:gymId/billing/checkout",
    { preHandler: [app.authenticate, checkoutLimit] },
    async (req, reply) => {
      const params = parseOr400(gymParams, req.params, req, reply);
      if (params === null) return;
      const key = parseOr400(idempotencyKey, req.headers["idempotency-key"], req, reply);
      if (key === null) return;
      const body = parseOr400(orgCheckoutRequestSchema, req.body, req, reply);
      if (body === null) return;
      const checkout = await service.startOrgCheckout(deps, {
        userId: requireUserId(req),
        gymId: params.gymId,
        planCode: body.planCode,
        idempotencyKey: key,
      });
      return reply.status(200).send(checkout);
    },
  );

  // Each press opens a fresh Paddle session; a few a minute is more than any owner needs.
  const portalLimit = createDualRateLimit({
    name: "billing_portal",
    max: 30,
    ipMax: 120,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });

  app.post(
    "/v1/orgs/:gymId/billing/portal",
    { preHandler: [app.authenticate, portalLimit] },
    async (req, reply) => {
      const params = parseOr400(gymParams, req.params, req, reply);
      if (params === null) return;
      const portal = await service.openBillingPortal(deps, { userId: requireUserId(req), gymId: params.gymId });
      // The link signs its holder in to the gym's Paddle account: no cache may keep it.
      return reply.status(200).header("cache-control", "no-store").send(portal);
    },
  );

  // Another size: a bigger one's preview asks Paddle, so it is limited like the portal; a
  // change is pressed once or twice.
  const sizePreviewLimit = createDualRateLimit({
    name: "billing_size_preview",
    max: 60,
    ipMax: 240,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  const sizeChangeLimit = createDualRateLimit({
    name: "billing_size_change",
    max: 20,
    ipMax: 120,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });

  app.post(
    "/v1/orgs/:gymId/billing/size/preview",
    { preHandler: [app.authenticate, sizePreviewLimit] },
    async (req, reply) => {
      const params = parseOr400(gymParams, req.params, req, reply);
      if (params === null) return;
      const body = parseOr400(orgPlanChangeRequestSchema, req.body, req, reply);
      if (body === null) return;
      const preview = await service.previewSizeChange(deps, { userId: requireUserId(req), gymId: params.gymId, planCode: body.planCode });
      return reply.status(200).send(preview);
    },
  );

  app.post(
    "/v1/orgs/:gymId/billing/size",
    { preHandler: [app.authenticate, sizeChangeLimit] },
    async (req, reply) => {
      const params = parseOr400(gymParams, req.params, req, reply);
      if (params === null) return;
      const key = parseOr400(idempotencyKey, req.headers["idempotency-key"], req, reply);
      if (key === null) return;
      const body = parseOr400(orgPlanChangeRequestSchema, req.body, req, reply);
      if (body === null) return;
      const changed = await service.changeSize(deps, {
        userId: requireUserId(req),
        gymId: params.gymId,
        planCode: body.planCode,
        idempotencyKey: key,
      });
      return reply.status(200).send(changed);
    },
  );

  // "Keep my current size": drops a smaller size waiting. Undoing it again is idempotent, so
  // it takes no key.
  app.delete(
    "/v1/orgs/:gymId/billing/size/pending",
    { preHandler: [app.authenticate, sizeChangeLimit] },
    async (req, reply) => {
      const params = parseOr400(gymParams, req.params, req, reply);
      if (params === null) return;
      const kept = await service.keepSize(deps, { userId: requireUserId(req), gymId: params.gymId });
      return reply.status(200).send(kept);
    },
  );

  app.post(
    "/v1/orgs/:gymId/billing/checkouts/:checkoutId/sync",
    { preHandler: [app.authenticate, syncLimit] },
    async (req, reply) => {
      const params = parseOr400(checkoutParams, req.params, req, reply);
      if (params === null) return;
      const synced = await service.syncOrgCheckout(deps, {
        userId: requireUserId(req),
        gymId: params.gymId,
        checkoutId: params.checkoutId,
      });
      return reply.status(200).send(synced);
    },
  );

  void app.register((scope, _options, done) => {
    // The signature is over the bytes as sent, so nothing may parse them first.
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: WEBHOOK_BODY_LIMIT }, (_req, body, next) => {
      next(null, body);
    });

    scope.post(
      PADDLE_WEBHOOK_PATH,
      // Paddle delivers from a few addresses; an unsigned request costs one HMAC.
      { config: { rateLimit: { max: 1200, timeWindow: "1 minute" } } },
      async (req, reply) => {
        // Not set up: 503, so Paddle keeps the events and tries again later.
        if (deps.webhookSecret === undefined) return reply.status(503).send();
        const header = req.headers["paddle-signature"];
        const body = req.body;
        if (typeof header !== "string" || !Buffer.isBuffer(body)) return reply.status(401).send();
        if (!verifyPaddleSignature(deps.webhookSecret, header, body, deps.nowSeconds())) return reply.status(401).send();

        let json: unknown;
        try {
          json = JSON.parse(body.toString("utf8"));
        } catch {
          json = null;
        }
        const event = paddleWebhookBodySchema.safeParse(json);
        if (!event.success) {
          req.log.warn({ event: "webhook.paddle_unreadable" }, "a signed Paddle webhook body did not parse");
          return reply.status(200).send();
        }
        // Only subscription events are acted on; the rest are acknowledged and dropped.
        const subscriptionId = paddleSubscriptionIdSchema.safeParse(event.data.data.id);
        if (!event.data.event_type.startsWith("subscription.") || !subscriptionId.success) {
          return reply.status(200).send();
        }
        await webhooks.keepPaddleEvent(deps.sql, {
          eventId: event.data.event_id,
          payload: { type: event.data.event_type, subscriptionId: subscriptionId.data },
        });
        return reply.status(200).send();
      },
    );
    done();
  });
}
