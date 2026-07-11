// Fastify app factory (P0.4). Route order doctrine (R3.3) applies per-module
// from P2.1 on; here only platform concerns: logging, CORS, rate limit,
// error mapping, /health.
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import * as Sentry from "@sentry/node";
import postgres from "postgres";
import { createAnalytics, type Analytics } from "./analytics.js";
import type { EmailSender } from "./modules/auth/email.js";
import { registerAuthenticate } from "./modules/auth/plugin.js";
import { AuthError } from "./modules/auth/service.js";
import { registerAuthRoutes } from "./modules/auth/routes.js";
import { registerWorkoutRoutes } from "./modules/workouts/routes.js";
import type { UsersEmailSender } from "./modules/users/email.js";
import { UsersError } from "./modules/users/service.js";
import { registerUserRoutes } from "./modules/users/routes.js";
import { registerExerciseRoutes } from "./modules/exercises/routes.js";
import { registerGamificationRoutes } from "./modules/gamification/routes.js";
import type { AppConfig } from "./config.js";

/** Test-only seams (GAP-5 DECISIONS 2026-07-11): production callers pass
 *  nothing; tests inject a capturing EmailSender to reach raw one-time tokens
 *  (they are stored only as SHA-256 — unreachable via the DB by design). */
export interface BuildAppOverrides {
  emailSender?: EmailSender;
  usersEmailSender?: UsersEmailSender;
}

declare module "fastify" {
  interface FastifyInstance {
    analytics: Analytics;
  }
}

export async function buildApp(
  config: AppConfig,
  overrides: BuildAppOverrides = {},
): Promise<FastifyInstance> {
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
  // Cookie parse/serialize only — session cookies are set explicitly by the
  // auth routes with the GAP-2 flags; no cookie signing (values are a JWT and
  // an opaque random, both self-authenticating).
  await app.register(cookie);
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
    // 4xx messages pass through only from an allowlist of client-safe sources:
    // our typed AuthError and Fastify/plugin-authored FST_* errors. Anything
    // else with a sub-500 statusCode gets a generic body (T3 2026-07-11 —
    // arbitrary err.message was never authored for clients).
    const clientSafe =
      err instanceof AuthError ||
      err instanceof UsersError ||
      (typeof err.code === "string" && err.code.startsWith("FST_"));
    void reply.status(status).send({
      error: clientSafe ? err.code : "request_error",
      message: clientSafe ? err.message : "Request could not be processed",
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

  registerAuthenticate(app, { sql, config });
  registerAuthRoutes(app, {
    sql,
    config,
    ...(overrides.emailSender !== undefined ? { emailSender: overrides.emailSender } : {}),
  });
  registerWorkoutRoutes(app, { sql });
  registerUserRoutes(app, {
    sql,
    ...(overrides.usersEmailSender !== undefined ? { emailSender: overrides.usersEmailSender } : {}),
  });
  registerExerciseRoutes(app, { sql });
  registerGamificationRoutes(app, { sql });

  return app;
}
