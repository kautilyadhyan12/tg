// A gym paying us (ROADMAP Stage 3 items 1a, 1c-i, 1c-ii, 1c-iii, 1d-i, 1d-ii and 1d-iii-a). Order per CLAUDE.md §4:
// authenticate → `billing.manage` on the gym → rate limit → parse → service → repo. Only the gym's
// own billing staff spend its address's allowance, so nobody else at that address can use it up.
// Paddle's and Razorpay's webhooks: signature on the raw body, kept once by the provider's
// event id, 200; the worker asks the provider for the subscription before anything changes.
import { createHash } from "node:crypto";
import {
  orgCheckoutRequestSchema,
  orgPlanChangeRequestSchema,
  paddleSubscriptionIdSchema,
  paddleWebhookBodySchema,
  razorpaySubscriptionIdSchema,
  razorpayWebhookBodySchema,
} from "@app/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { RedisLike } from "../../redis.js";
import { createDualRateLimit } from "../auth/rateLimit.js";
import { requirePrivilege } from "../orgs/service.js";
import * as webhooks from "../webhooks/repo.js";
import { PADDLE_SIGNATURE_TOLERANCE_SECONDS, verifyPaddleSignature } from "./paddleSignature.js";
import { verifyRazorpaySignature } from "./razorpaySignature.js";
import * as service from "./service.js";

export const PADDLE_WEBHOOK_PATH = "/v1/webhooks/paddle";
export const RAZORPAY_WEBHOOK_PATH = "/v1/webhooks/razorpay";

/** Paddle's and Razorpay's subscription bodies are a few kilobytes; this leaves room and no more. */
const WEBHOOK_BODY_LIMIT = 64 * 1024;

const gymParams = z.object({ gymId: z.string().uuid() }).strict();
/** The gym in any billing route's path, before the route's own parse. */
const gymInParams = z.object({ gymId: z.string().uuid() }).passthrough();
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
  deps: service.BillingDeps & {
    redis: RedisLike;
    webhookSecret: string | undefined;
    razorpayWebhookSecret?: string | undefined;
    nowSeconds: () => number;
  },
): void {
  // Before the limiters: a refusal here spends nothing (404 for a stranger, 403 for staff who may not pay).
  const billingStaff = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const params = gymInParams.safeParse(req.params);
    if (!params.success) {
      await reply.status(400).send({ error: "validation_error", message: "gymId: invalid_string", requestId: req.id });
      return;
    }
    await requirePrivilege(deps, params.data.gymId, requireUserId(req), "billing.manage");
  };

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
    { preHandler: [app.authenticate, billingStaff, checkoutLimit] },
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
    { preHandler: [app.authenticate, billingStaff, portalLimit] },
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
    { preHandler: [app.authenticate, billingStaff, sizePreviewLimit] },
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
    { preHandler: [app.authenticate, billingStaff, sizeChangeLimit] },
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

  // A bigger size on a plan paid through Razorpay (1d-iii-a): Razorpay cannot change what a
  // mandate charges, so this opens its window for a new plan; nothing changes until it is paid.
  app.post(
    "/v1/orgs/:gymId/billing/size/razorpay",
    { preHandler: [app.authenticate, billingStaff, sizeChangeLimit] },
    async (req, reply) => {
      const params = parseOr400(gymParams, req.params, req, reply);
      if (params === null) return;
      const key = parseOr400(idempotencyKey, req.headers["idempotency-key"], req, reply);
      if (key === null) return;
      const body = parseOr400(orgPlanChangeRequestSchema, req.body, req, reply);
      if (body === null) return;
      const window = await service.startRazorpaySizeChange(deps, {
        userId: requireUserId(req),
        gymId: params.gymId,
        planCode: body.planCode,
        idempotencyKey: key,
      });
      return reply.status(200).send(window);
    },
  );

  // "Cancel this change": drops a smaller size waiting. Undoing it again is idempotent, so
  // it takes no key.
  app.delete(
    "/v1/orgs/:gymId/billing/size/pending",
    { preHandler: [app.authenticate, billingStaff, sizeChangeLimit] },
    async (req, reply) => {
      const params = parseOr400(gymParams, req.params, req, reply);
      if (params === null) return;
      const kept = await service.keepSize(deps, { userId: requireUserId(req), gymId: params.gymId });
      return reply.status(200).send(kept);
    },
  );

  // A plan paid through Razorpay, from the console (1d-ii). Pay now and Update payment method
  // each ask Razorpay once and change nothing; a few a minute is more than anybody needs.
  const razorpayLimit = createDualRateLimit({
    name: "billing_razorpay",
    max: 30,
    ipMax: 120,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });

  app.post(
    "/v1/orgs/:gymId/billing/razorpay/pay",
    { preHandler: [app.authenticate, billingStaff, razorpayLimit] },
    async (req, reply) => {
      const params = parseOr400(gymParams, req.params, req, reply);
      if (params === null) return;
      const link = await service.payRazorpayBill(deps, { userId: requireUserId(req), gymId: params.gymId });
      return reply.status(200).header("cache-control", "no-store").send(link);
    },
  );

  app.post(
    "/v1/orgs/:gymId/billing/razorpay/method",
    { preHandler: [app.authenticate, billingStaff, razorpayLimit] },
    async (req, reply) => {
      const params = parseOr400(gymParams, req.params, req, reply);
      if (params === null) return;
      const window = await service.openRazorpayMethod(deps, { userId: requireUserId(req), gymId: params.gymId });
      return reply.status(200).header("cache-control", "no-store").send(window);
    },
  );

  // The console asks after Razorpay's page or window closes, every few seconds for a minute.
  app.post(
    "/v1/orgs/:gymId/billing/razorpay/refresh",
    { preHandler: [app.authenticate, billingStaff, syncLimit] },
    async (req, reply) => {
      const params = parseOr400(gymParams, req.params, req, reply);
      if (params === null) return;
      await service.refreshRazorpayPlan(deps, { userId: requireUserId(req), gymId: params.gymId });
      return reply.status(204).send();
    },
  );

  // Cancel plan (PUT: the plan is set to end, and a second press finds it so) and Keep my plan
  // (DELETE). Each is the same state however often it is sent, so neither takes a key.
  app.put(
    "/v1/orgs/:gymId/billing/cancel",
    { preHandler: [app.authenticate, billingStaff, sizeChangeLimit] },
    async (req, reply) => {
      const params = parseOr400(gymParams, req.params, req, reply);
      if (params === null) return;
      const plan = await service.cancelRazorpayPlan(deps, { userId: requireUserId(req), gymId: params.gymId });
      return reply.status(200).send(plan);
    },
  );

  app.delete(
    "/v1/orgs/:gymId/billing/cancel",
    { preHandler: [app.authenticate, billingStaff, sizeChangeLimit] },
    async (req, reply) => {
      const params = parseOr400(gymParams, req.params, req, reply);
      if (params === null) return;
      const plan = await service.keepRazorpayPlan(deps, { userId: requireUserId(req), gymId: params.gymId });
      return reply.status(200).send(plan);
    },
  );

  app.post(
    "/v1/orgs/:gymId/billing/checkouts/:checkoutId/sync",
    { preHandler: [app.authenticate, billingStaff, syncLimit] },
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
    // A request with no signature of the right shape, or Paddle's older than its tolerance, is
    // refused before its body is read.
    scope.addHook("onRequest", async (req, reply) => {
      if (req.routeOptions.url === PADDLE_WEBHOOK_PATH) {
        const header = req.headers["paddle-signature"];
        const ts = typeof header === "string" && header.length <= 2000 ? /(?:^|;)\s*ts=(\d{1,12})\s*(?:;|$)/.exec(header)?.[1] : undefined;
        if (ts === undefined || !header?.includes("h1=") || Math.abs(deps.nowSeconds() - Number(ts)) > PADDLE_SIGNATURE_TOLERANCE_SECONDS) {
          await reply.status(401).send();
        }
      } else if (req.routeOptions.url === RAZORPAY_WEBHOOK_PATH) {
        const header = req.headers["x-razorpay-signature"];
        if (typeof header !== "string" || !/^[0-9a-f]{64}$/.test(header)) await reply.status(401).send();
      }
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

    scope.post(
      RAZORPAY_WEBHOOK_PATH,
      // Razorpay delivers from a few addresses; an unsigned request costs one HMAC.
      { config: { rateLimit: { max: 1200, timeWindow: "1 minute" } } },
      async (req, reply) => {
        // Not set up: 503, so Razorpay keeps the events and tries again later.
        const secret = deps.razorpayWebhookSecret;
        if (secret === undefined) return reply.status(503).send();
        const header = req.headers["x-razorpay-signature"];
        const body = req.body;
        if (typeof header !== "string" || !Buffer.isBuffer(body)) return reply.status(401).send();
        if (!verifyRazorpaySignature(secret, header, body)) return reply.status(401).send();

        let json: unknown;
        try {
          json = JSON.parse(body.toString("utf8"));
        } catch {
          json = null;
        }
        const event = razorpayWebhookBodySchema.safeParse(json);
        if (!event.success) {
          req.log.warn({ event: "webhook.razorpay_unreadable" }, "a signed Razorpay webhook body did not parse");
          return reply.status(200).send();
        }
        // Subscription events, and invoice events about a subscription (a bill paid from its own
        // page, 1d-ii), are acted on; the rest are acknowledged and dropped.
        const kind = event.data.event;
        const named = kind.startsWith("subscription.")
          ? event.data.payload.subscription?.entity.id
          : kind.startsWith("invoice.")
            ? event.data.payload.invoice?.entity.subscription_id
            : undefined;
        const subscriptionId = razorpaySubscriptionIdSchema.safeParse(named);
        if (!subscriptionId.success) return reply.status(200).send();
        // Razorpay's id for the event, sent the same on every delivery of it; without one,
        // the body's own hash: a second delivery of the same bytes is the same event. The header
        // is not signed, so it is kept apart from the worker's own ids (`due:…`, events.ts).
        const idHeader = req.headers["x-razorpay-event-id"];
        const eventId =
          typeof idHeader === "string" && /^[\x21-\x7e]{1,100}$/.test(idHeader)
            ? `evt:${idHeader}`
            : `body:${createHash("sha256").update(body).digest("hex")}`;
        await webhooks.keepRazorpayEvent(deps.sql, {
          eventId,
          payload: { type: event.data.event, subscriptionId: subscriptionId.data },
        });
        return reply.status(200).send();
      },
    );
    done();
  });
}
