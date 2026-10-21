// A gym's own payment company (ROADMAP 18d-i): authenticate, rate-limit, Zod-parse, hand to
// the service, which owns the authorisation.
//
//   GET    /v1/orgs/:gymId/payments                    the Payments box (any staff)
//   POST   /v1/orgs/:gymId/payments/square/connect     Connect Square: Square's page (the owner)
//   PUT    /v1/orgs/:gymId/payments/square/location    which Square location this gym is (the owner)
//   DELETE /v1/orgs/:gymId/payments/square             Disconnect Square (the owner)
//   POST   /v1/payments/square/finish                  Square's answer, from the return page
//   POST   /v1/webhooks/square                         Square's messages: signed, kept once
//
// A gym's Square Terminals (ROADMAP 18d-ii-b-i), the owner's:
//   POST   /v1/orgs/:gymId/payments/square/terminals/pair                 Pair a Terminal: Square's code
//   GET    /v1/orgs/:gymId/payments/square/terminals/:terminalId/pairing  has a Terminal signed in with it
//   POST   /v1/orgs/:gymId/payments/square/terminals/practice             one of Square's pretend Terminals
//   DELETE /v1/orgs/:gymId/payments/square/terminals/:terminalId          Remove
//
// A member's card on file (ROADMAP 18d-ii):
//   GET    /v1/orgs/:gymId/member-list/entries/:entryId/card   Card on file (`billing.members`)
//   POST   /v1/orgs/:gymId/member-list/entries/:entryId/card   save the card typed into Square's form
//   DELETE /v1/orgs/:gymId/member-list/entries/:entryId/card   Remove card
//   GET    /v1/orgs/:gymId/my-card                             the member's own, for the phone
//   POST   /v1/orgs/:gymId/my-card                             the member adds or updates their own
import {
  saveCardRequestSchema,
  squareCardIdSchema,
  squareFinishRequestSchema,
  squareLocationRequestSchema,
  squareObjectIdSchema,
  squarePracticeRequestSchema,
  squareWebhookBodySchema,
} from "@app/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import * as webhooks from "../../webhooks/repo.js";
import { memberListEntryParamsSchema, orgParamsSchema, squareTerminalParamsSchema } from "../schemas.js";
import { staffOnly } from "../staffLimit.js";
import * as cards from "./cards.js";
import * as service from "./service.js";
import { verifySquareSignature } from "./squareSignature.js";
import * as terminals from "./terminals.js";
import { SQUARE_REVOKED_EVENT } from "./work.js";

export const SQUARE_WEBHOOK_PATH = "/v1/webhooks/square";
/** Square's own messages are a few kilobytes. */
const WEBHOOK_BODY_LIMIT = 64 * 1024;
const HOUR_MS = 60 * 60 * 1000;

function parseOr400<S extends z.ZodTypeAny>(schema: S, value: unknown, req: FastifyRequest, reply: FastifyReply): z.output<S> | null {
  const parsed: z.SafeParseReturnType<unknown, z.output<S>> = schema.safeParse(value);
  if (!parsed.success) {
    // Issue paths and codes only, never the offending value: a code from Square is a secret.
    void reply.status(400).send({
      error: "validation_error",
      message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.code}`).join("; "),
      requestId: req.id,
    });
    return null;
  }
  return parsed.data;
}

function callerId(req: FastifyRequest): string {
  const user = req.authUser;
  if (user === undefined) throw new Error("authenticate preHandler did not run");
  return user.id;
}

export function registerPaymentRoutes(app: FastifyInstance, deps: Omit<service.PaymentsDeps, "log"> & { redis: RedisLike }): void {
  const paymentsDeps: service.PaymentsDeps = { sql: deps.sql, square: deps.square, now: deps.now, log: app.log };
  const byPerson = (req: FastifyRequest): string | null => req.authUser?.id ?? null;
  // Settings asks once each time it opens; a gym's staff can share one address.
  const readLimit = createDualRateLimit({ name: "payments_read", max: 300, ipMax: 3000, windowMs: HOUR_MS, identifier: byPerson, redis: deps.redis });
  // An owner connects a handful of times; each press is a row and a trip to Square.
  const connectLimit = createDualRateLimit({ name: "payments_connect", max: 20, ipMax: 300, windowMs: HOUR_MS, identifier: byPerson, redis: deps.redis });
  const finishLimit = createDualRateLimit({ name: "payments_finish", max: 30, ipMax: 300, windowMs: HOUR_MS, identifier: byPerson, redis: deps.redis });
  const changeLimit = createDualRateLimit({ name: "payments_change", max: 30, ipMax: 300, windowMs: HOUR_MS, identifier: byPerson, redis: deps.redis });

  app.get("/v1/orgs/:gymId/payments", { preHandler: [app.authenticate, readLimit] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    return reply.status(200).send(await service.readPayments(paymentsDeps, callerId(req), params.gymId));
  });

  app.post("/v1/orgs/:gymId/payments/square/connect", { preHandler: [app.authenticate, connectLimit] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    return reply.status(200).send(await service.startSquareConnect(paymentsDeps, callerId(req), params.gymId));
  });

  app.put("/v1/orgs/:gymId/payments/square/location", { preHandler: [app.authenticate, changeLimit] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(squareLocationRequestSchema, req.body, req, reply);
    if (body === null) return;
    return reply.status(200).send(await service.chooseSquareLocation(paymentsDeps, callerId(req), params.gymId, body.locationId));
  });

  app.delete("/v1/orgs/:gymId/payments/square", { preHandler: [app.authenticate, changeLimit] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    return reply.status(200).send(await service.disconnectSquare(paymentsDeps, callerId(req), params.gymId));
  });

  app.post("/v1/payments/square/finish", { preHandler: [app.authenticate, finishLimit] }, async (req, reply) => {
    const body = parseOr400(squareFinishRequestSchema, req.body, req, reply);
    if (body === null) return;
    return reply.status(200).send(await service.finishSquareConnect(paymentsDeps, callerId(req), body));
  });

  // An owner pairs a Terminal a few times; each press is a code made at Square. The console asks
  // every few seconds while a code waits, five minutes at most: about a hundred asks a code.
  const pairLimit = createDualRateLimit({ name: "terminal_pair", max: 30, ipMax: 300, windowMs: HOUR_MS, identifier: byPerson, redis: deps.redis });
  const pairingLimit = createDualRateLimit({ name: "terminal_pairing", max: 1200, ipMax: 6000, windowMs: HOUR_MS, identifier: byPerson, redis: deps.redis });
  const terminalsUrl = "/v1/orgs/:gymId/payments/square/terminals";

  app.post(`${terminalsUrl}/pair`, { preHandler: [app.authenticate, pairLimit] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    // The code is for this screen alone.
    return reply.status(200).header("cache-control", "no-store").send(await terminals.pairTerminal(paymentsDeps, callerId(req), params.gymId));
  });

  app.get(`${terminalsUrl}/:terminalId/pairing`, { preHandler: [app.authenticate, pairingLimit] }, async (req, reply) => {
    const params = parseOr400(squareTerminalParamsSchema, req.params, req, reply);
    if (params === null) return;
    const answer = await terminals.checkPairing(paymentsDeps, callerId(req), params.gymId, params.terminalId);
    return reply.status(200).header("cache-control", "no-store").send(answer);
  });

  app.post(`${terminalsUrl}/practice`, { preHandler: [app.authenticate, changeLimit] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(squarePracticeRequestSchema, req.body, req, reply);
    if (body === null) return;
    return reply.status(200).send(await terminals.addPracticeTerminal(paymentsDeps, callerId(req), params.gymId, body.practice));
  });

  app.delete(`${terminalsUrl}/:terminalId`, { preHandler: [app.authenticate, changeLimit] }, async (req, reply) => {
    const params = parseOr400(squareTerminalParamsSchema, req.params, req, reply);
    if (params === null) return;
    return reply.status(200).send(await terminals.removeTerminal(paymentsDeps, callerId(req), params.gymId, params.terminalId));
  });

  // Card on file is read with every person's page a payments member of staff opens; a gym's
  // staff share one address. Each save or removal is a trip to Square, and a save asks the
  // card's bank: a ceiling also keeps a stolen card from being tried here over and over.
  const cardReadLimit = createDualRateLimit({ name: "member_card_read", max: 1200, ipMax: 6000, windowMs: HOUR_MS, identifier: byPerson, redis: deps.redis });
  const cardWriteLimit = createDualRateLimit({ name: "member_card_write", max: 60, ipMax: 300, windowMs: HOUR_MS, identifier: byPerson, redis: deps.redis });
  const cardUrl = "/v1/orgs/:gymId/member-list/entries/:entryId/card";

  app.get(cardUrl, { preHandler: [app.authenticate, staffOnly(deps.sql, cardReadLimit)] }, async (req, reply) => {
    const params = parseOr400(memberListEntryParamsSchema, req.params, req, reply);
    if (params === null) return;
    const answer = await cards.readMemberCard(paymentsDeps, callerId(req), params.gymId, params.entryId);
    return reply.status(200).header("cache-control", "no-store").send(answer);
  });

  app.post(cardUrl, { preHandler: [app.authenticate, staffOnly(deps.sql, cardWriteLimit)] }, async (req, reply) => {
    const params = parseOr400(memberListEntryParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(saveCardRequestSchema, req.body, req, reply);
    if (body === null) return;
    return reply.status(200).send(await cards.saveMemberCard(paymentsDeps, callerId(req), params.gymId, params.entryId, body));
  });

  app.delete(cardUrl, { preHandler: [app.authenticate, staffOnly(deps.sql, cardWriteLimit)] }, async (req, reply) => {
    const params = parseOr400(memberListEntryParamsSchema, req.params, req, reply);
    if (params === null) return;
    return reply.status(200).send(await cards.removeMemberCard(paymentsDeps, callerId(req), params.gymId, params.entryId));
  });

  // A whole gym opens the app on one wi-fi address; a member saves a card a handful of times.
  const myCardReadLimit = createDualRateLimit({ name: "my_card_read", max: 600, ipMax: 30_000, windowMs: HOUR_MS, identifier: byPerson, redis: deps.redis });
  const myCardWriteLimit = createDualRateLimit({ name: "my_card_write", max: 10, ipMax: 300, windowMs: HOUR_MS, identifier: byPerson, redis: deps.redis });
  // Membership first and the limit after it: a stranger's 404 is never a 429.
  const gate = (limit: typeof myCardReadLimit, req: FastifyRequest, reply: FastifyReply) => async (): Promise<boolean> => {
    await limit(req, reply);
    return !reply.sent;
  };

  app.get("/v1/orgs/:gymId/my-card", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const mine = await cards.readMyCard(paymentsDeps, callerId(req), params.gymId, gate(myCardReadLimit, req, reply));
    if (mine === null) return;
    return reply.status(200).header("cache-control", "no-store").send(mine);
  });

  app.post("/v1/orgs/:gymId/my-card", { preHandler: app.authenticate }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(saveCardRequestSchema, req.body, req, reply);
    if (body === null) return;
    const mine = await cards.saveMyCard(paymentsDeps, callerId(req), params.gymId, body, gate(myCardWriteLimit, req, reply));
    if (mine === null) return;
    return reply.status(200).send(mine);
  });

  void app.register((scope, _options, done) => {
    // The signature is over the bytes as sent, so nothing may parse them first.
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: WEBHOOK_BODY_LIMIT }, (_req, body, next) => {
      next(null, body);
    });
    // A request with no signature of the right shape is refused before its body is read.
    scope.addHook("onRequest", async (req, reply) => {
      const header = req.headers["x-square-hmacsha256-signature"];
      if (typeof header !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(header)) await reply.status(401).send();
    });

    scope.post(
      SQUARE_WEBHOOK_PATH,
      // Square delivers from a few addresses; an unsigned request costs one HMAC.
      { config: { rateLimit: { max: 1200, timeWindow: "1 minute" } } },
      async (req, reply) => {
        // Not set up: 503, so Square keeps the message and tries again later.
        const webhook = deps.square?.webhook ?? null;
        if (webhook === null) return reply.status(503).send();
        const header = req.headers["x-square-hmacsha256-signature"];
        const body = req.body;
        if (typeof header !== "string" || !Buffer.isBuffer(body)) return reply.status(401).send();
        if (!verifySquareSignature(webhook.signatureKey, webhook.url, header, body)) return reply.status(401).send();

        let json: unknown;
        try {
          json = JSON.parse(body.toString("utf8"));
        } catch {
          json = null;
        }
        const event = squareWebhookBodySchema.safeParse(json);
        if (!event.success) {
          req.log.warn({ event: "webhook.square_unreadable" }, "a signed Square webhook body did not parse");
          return reply.status(200).send();
        }
        // A gym taking the app off its account, and a saved card changed or stopped inside
        // Square (18d-ii), are kept for the worker; the rest are acknowledged.
        if (event.data.type === SQUARE_REVOKED_EVENT) {
          await webhooks.keepSquareEvent(deps.sql, {
            eventId: event.data.event_id,
            payload: { type: event.data.type, accountId: event.data.merchant_id },
          });
          return reply.status(200).send();
        }
        if (event.data.type === cards.SQUARE_CUSTOMER_DELETED_EVENT) {
          const customerId = squareObjectIdSchema.safeParse(event.data.data?.id);
          if (!customerId.success) {
            req.log.warn({ event: "webhook.square_customer_unreadable" }, "a signed Square customer message names no customer");
            return reply.status(200).send();
          }
          await webhooks.keepSquareEvent(deps.sql, {
            eventId: event.data.event_id,
            payload: { type: event.data.type, accountId: event.data.merchant_id, customerId: customerId.data },
          });
          return reply.status(200).send();
        }
        if (cards.SQUARE_CARD_EVENTS.includes(event.data.type)) {
          const cardId = squareCardIdSchema.safeParse(event.data.data?.id);
          if (!cardId.success) {
            req.log.warn({ event: "webhook.square_card_unreadable" }, "a signed Square card message names no card");
            return reply.status(200).send();
          }
          await webhooks.keepSquareEvent(deps.sql, {
            eventId: event.data.event_id,
            payload: { type: event.data.type, accountId: event.data.merchant_id, cardId: cardId.data },
          });
        }
        return reply.status(200).send();
      },
    );
    done();
  });
}
