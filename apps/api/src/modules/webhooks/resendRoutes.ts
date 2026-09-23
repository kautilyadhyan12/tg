// Resend's webhook (Part 3 §9.12; ROADMAP 3b-i-b; CLAUDE.md §4's webhook rule): verify
// the Svix signature on the RAW body, keep the event once by its svix-id, answer 200,
// and leave the rest to the worker, which asks Resend itself before acting on it.
//
// Only what the worker needs is kept — the event's type, Resend's id for the email and
// a bounce's type. The body also holds the recipient's address and the subject; they
// are never stored or logged.
import { resendEmailEventTypeSchema, resendWebhookBodySchema, svixHeadersSchema } from "@app/shared";
import type { FastifyInstance } from "fastify";
import type { Sql } from "postgres";
import { svixKey, verifySvix } from "./svix.js";
import * as repo from "./repo.js";

export const RESEND_WEBHOOK_PATH = "/v1/webhooks/resend";

/** Resend's bodies are a few hundred bytes; this leaves room and no more. */
const BODY_LIMIT = 64 * 1024;

export function registerResendWebhookRoutes(
  app: FastifyInstance,
  deps: { sql: Sql; secret: string | undefined; nowSeconds: () => number },
): void {
  const key = deps.secret === undefined ? null : svixKey(deps.secret);

  void app.register((scope, _options, done) => {
    // The signature is over the bytes as sent, so nothing may parse them first — not
    // even Fastify's own JSON parser, which this scope drops.
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: BODY_LIMIT }, (_req, body, next) => {
      next(null, body);
    });

    scope.post(
      RESEND_WEBHOOK_PATH,
      // Resend delivers from a few addresses in bursts; an unsigned request costs one HMAC.
      { config: { rateLimit: { max: 1200, timeWindow: "1 minute" } } },
      async (req, reply) => {
        // Not set up: 503, so Resend keeps the events and tries again later.
        if (key === null) return reply.status(503).send();
        const headers = svixHeadersSchema.safeParse(req.headers);
        const body = req.body;
        if (!headers.success || !Buffer.isBuffer(body)) return reply.status(401).send();
        const signed = {
          id: headers.data["svix-id"],
          timestamp: headers.data["svix-timestamp"],
          signature: headers.data["svix-signature"],
          body,
        };
        if (!verifySvix(key, signed, deps.nowSeconds())) return reply.status(401).send();

        let json: unknown;
        try {
          json = JSON.parse(body.toString("utf8"));
        } catch {
          json = null;
        }
        const event = resendWebhookBodySchema.safeParse(json);
        const type = event.success ? resendEmailEventTypeSchema.safeParse(event.data.type) : null;
        const emailId = event.success ? event.data.data?.email_id : undefined;
        if (!event.success || type === null || !type.success || emailId === undefined) {
          // Signed by Resend but not an email event the app acts on: acknowledged, so
          // Resend does not send it again, and dropped.
          if (!event.success) req.log.warn({ event: "webhook.resend_unreadable" }, "a signed Resend webhook body did not parse");
          return reply.status(200).send();
        }
        await repo.keepEvent(deps.sql, {
          provider: "resend",
          eventId: signed.id,
          payload: {
            type: type.data,
            emailId,
            bounceType: event.data.data?.bounce?.type ?? null,
          },
        });
        return reply.status(200).send();
      },
    );

    done();
  });
}
