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
import { registerCoachRoutes, type CoachRouteOverrides } from "./modules/coach/routes.js";
import { CoachError } from "./modules/coach/service.js";
import { registerEntitlementRoutes } from "./modules/entitlements/routes.js";
import { createIoRedis, createMemoryRedis, type RedisLike } from "./redis.js";
import type { AppConfig } from "./config.js";
import { registerNutritionRoutes, type NutritionRouteOverrides } from "./modules/nutrition/routes.js";
import { NutritionError } from "./modules/nutrition/service.js";
import { registerGeoRoutes, type GeoRouteOverrides } from "./modules/geo/routes.js";
import { GeoError } from "./modules/geo/errors.js";

/** Test-only seams (GAP-5 DECISIONS 2026-07-11): production callers pass
 *  nothing; tests inject a capturing EmailSender to reach raw one-time tokens
 *  (they are stored only as SHA-256 — unreachable via the DB by design). */
export interface BuildAppOverrides {
  emailSender?: EmailSender;
  usersEmailSender?: UsersEmailSender;
  /** Tests inject the in-memory adapter (with its `down` switch) to drive
   *  fail-open/fail-closed paths deterministically (P2.4). */
  redis?: RedisLike;
  /** P2.5b: fake ChatProvider/Embedder — tests never call Groq or load ONNX. */
  coach?: CoachRouteOverrides;
  /** P2.6a: tests inject fake vision and OpenFoodFacts providers. */
  nutrition?: NutritionRouteOverrides;
  /** P2.6b: tests inject a fake ORS route provider (and the reserved-for-P5
   *  geocode resolver) — no test calls the real OpenRouteService. */
  geo?: GeoRouteOverrides;
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
    // VERIFIED (P2.6a T3): no request-data integration is registered and
    // sendDefaultPii stays default-false — captureException below attaches
    // only {requestId}, never request bodies. This is load-bearing for the
    // 2B §3.4 never-persisted photo guarantee (a body-attaching integration
    // would leak imageBase64 on any 5xx from /v1/nutrition/analyze-photo).
    Sentry.init({ dsn: config.SENTRY_DSN, environment: config.NODE_ENV, sendDefaultPii: false });
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
    // @fastify/cors v11 defaults to 'GET,HEAD,POST' — which silently refused
    // every browser DELETE/PATCH/PUT at preflight (coach thread delete, user
    // PATCH, DPDP account DELETE, measurements CRUD). Found by the Card 4
    // browser smoke; inject() tests bypass CORS so no route test saw it.
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
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
    // Client-safe allowlist: our typed module errors (messages authored for
    // clients) and Fastify/plugin-authored FST_* errors. These pass through
    // with THEIR OWN status — including a typed 503 like CoachError's
    // "coach_unavailable" (P2.5b: an expected-operational outage, warn-logged,
    // no Sentry — collapsing it to a generic 500 would misreport an upstream
    // provider blip as an app crash).
    const clientSafe =
      err instanceof AuthError ||
      err instanceof UsersError ||
      err instanceof CoachError ||
      err instanceof NutritionError ||
      err instanceof GeoError ||
      (typeof err.code === "string" && err.code.startsWith("FST_"));
    if (clientSafe) {
      if (status >= 500) {
        req.log.warn({ code: err.code, requestId: req.id }, "typed operational failure");
      }
      void reply.status(status).send({
        error: err.code,
        message: err.message,
        requestId: req.id,
      });
      return;
    }
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
    // Non-allowlisted sub-500: generic body (T3 2026-07-11 — arbitrary
    // err.message was never authored for clients).
    void reply.status(status).send({
      error: "request_error",
      message: "Request could not be processed",
      requestId: req.id,
    });
  });

  const analytics = createAnalytics(config);
  app.decorate("analytics", analytics);

  const sql = postgres(config.DATABASE_URL, { prepare: false, max: 1 });
  // P2.4: REDIS_URL → real Redis; otherwise the in-memory adapter (config
  // fail-fast makes REDIS_URL mandatory in production).
  const redis =
    overrides.redis ??
    (config.REDIS_URL !== undefined ? createIoRedis(config.REDIS_URL) : createMemoryRedis());
  app.addHook("onClose", async () => {
    await analytics.shutdown();
    await redis.close();
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
    redis,
    ...(overrides.emailSender !== undefined ? { emailSender: overrides.emailSender } : {}),
  });
  registerWorkoutRoutes(app, { sql, redis });
  registerUserRoutes(app, {
    sql,
    redis,
    ...(overrides.usersEmailSender !== undefined ? { emailSender: overrides.usersEmailSender } : {}),
  });
  registerExerciseRoutes(app, { sql });
  registerGamificationRoutes(app, { sql });
  registerCoachRoutes(app, { sql, redis, config }, overrides.coach ?? {});
  registerEntitlementRoutes(app, { sql, redis });
  registerNutritionRoutes(app, { sql, redis, config }, overrides.nutrition ?? {});
  registerGeoRoutes(app, { sql, redis, config }, overrides.geo ?? {});

  return app;
}
