// Fastify app factory (P0.4). Route order doctrine (R3.3) applies per-module
// from P2.1 on; here only platform concerns: logging, CORS, rate limit,
// error mapping, /health.
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import * as Sentry from "@sentry/node";
import postgres from "postgres";
import { createAnalytics, type Analytics } from "./analytics.js";
import type { AppConfig } from "./config.js";

declare module "fastify" {
  interface FastifyInstance {
    analytics: Analytics;
  }
}

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  if (config.SENTRY_DSN !== undefined) {
    Sentry.init({ dsn: config.SENTRY_DSN, environment: config.NODE_ENV });
  }

  const app = Fastify({
    trustProxy: true, // behind Caddy (R3.7); secure cookies depend on this
    logger: {
      level: config.LOG_LEVEL,
      // R3.10: never log tokens/cookies.
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "res.headers['set-cookie']",
        ],
        censor: "[redacted]",
      },
    },
    disableRequestLogging: config.NODE_ENV === "test",
  });

  await app.register(sensible);
  await app.register(cors, {
    // Array form: the header is emitted only on an exact match — a foreign
    // Origin gets nothing. '*' would silently break credentialed cookies (Part IV #6).
    origin: [config.WEB_ORIGIN],
    credentials: true,
  });
  await app.register(rateLimit, {
    global: true,
    max: 300, // generous global floor; strict per-route limits land with auth (P2.1, R3.7)
    timeWindow: "1 minute",
  });

  // Unmatched routes: same typed shape as errors, and rate-limited too —
  // otherwise 404 scanning traffic bypasses the limiter entirely.
  app.setNotFoundHandler({ preHandler: app.rateLimit() }, (req, reply) => {
    void reply.status(404).send({
      error: "not_found",
      message: `Route ${req.method}:${req.url} not found`,
      requestId: req.id,
    });
  });

  // Central error mapper (R8.1): typed errors → HTTP; internals never leak.
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      req.log.error({ err, requestId: req.id }, "unhandled error");
      if (config.SENTRY_DSN !== undefined) {
        Sentry.captureException(err, { extra: { requestId: req.id } });
      }
      void reply.status(500).send({
        error: "internal_error",
        message: "Something went wrong",
        requestId: req.id,
      });
      return;
    }
    void reply.status(status).send({
      error: err.code, // FastifyError always carries a code (e.g. FST_ERR_VALIDATION)
      message: err.message,
      requestId: req.id,
    });
  });

  const analytics = createAnalytics(config);
  app.decorate("analytics", analytics);

  const sql = postgres(config.DATABASE_URL, { prepare: false, max: 1 });
  app.addHook("onClose", async () => {
    await analytics.shutdown();
    await sql.end({ timeout: 5 });
  });

  app.get("/health", async () => {
    await sql`SELECT 1`;
    return { status: "ok" };
  });

  return app;
}
