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
import { createResendTransport } from "./email/resend.js";
import { createDevEmailSender, createResendEmailSender, type EmailSender } from "./modules/auth/email.js";
import { registerAuthenticate } from "./modules/auth/plugin.js";
import { AuthError, type PasswordHasher } from "./modules/auth/service.js";
import { registerAuthRoutes } from "./modules/auth/routes.js";
import { createGoogleVerifier, type GoogleVerifier } from "./modules/auth/google.js";
import { registerWorkoutRoutes } from "./modules/workouts/routes.js";
import {
  createDevUsersEmailSender,
  createResendUsersEmailSender,
  type UsersEmailSender,
} from "./modules/users/email.js";
import { OnboardingIncompleteError, UsersError } from "./modules/users/service.js";
import { registerUserRoutes } from "./modules/users/routes.js";
import { registerPrivacyRoutes } from "./modules/privacy/routes.js";
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
import { registerOrgRoutes, type OrgRouteOverrides } from "./modules/orgs/routes.js";
import { inviteSettings } from "./modules/orgs/invites/settings.js";
import { registerUnsubscribeRoutes } from "./modules/orgs/invites/unsubscribe.js";
import { registerResendWebhookRoutes } from "./modules/webhooks/resendRoutes.js";
import { OrgsError } from "./modules/orgs/service.js";
import { ExportError } from "./modules/privacy/export.js";
import { safeErrorSerializer, safeRequestSerializer, scrubbedForSentry } from "./logSafety.js";
import { sentryOptions } from "./sentry.js";

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
  /** google-login: tests inject a fake GoogleVerifier to drive the OAuth flow
   *  without calling Google; unset in prod builds the real one from config. */
  googleVerifier?: GoogleVerifier;
  /** orgs: tests inject a deterministic byte source to drive the join-code and
   *  slug collision retries; unset uses node:crypto. */
  orgs?: OrgRouteOverrides;
  /** Tests read what Sentry would be sent through a transport that records it;
   *  unset, the SDK sends to SENTRY_DSN. */
  sentryTransport?: Sentry.NodeOptions["transport"];
  /** Tests hold a password check open to race it against an address's first proof;
   *  unset is argon2id. */
  passwordHasher?: PasswordHasher;
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
    Sentry.init(sentryOptions(config.SENTRY_DSN, config.NODE_ENV, overrides.sentryTransport));
  }
  /** A fault nobody expected goes to Sentry with its request id, and with
   *  nothing else from the request: sentryOptions takes the request off. */
  const reportError = (err: unknown, requestId: string): void => {
    // Scrubbed first: a database error carries the WHOLE failing row in `detail`
    // (spec Part 3 §9.9, measured 2026-09-20), and an event carrying it would put a
    // member's name, address and phone number in Sentry. See `logSafety.ts`.
    if (config.SENTRY_DSN !== undefined) Sentry.captureException(scrubbedForSentry(err), { extra: { requestId } });
  };

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
      // AN ERROR SAYS WHAT WENT WRONG, NEVER WHO IT WENT WRONG ABOUT. pino's own
      // serializer copies every property of an error onto the line, and a database
      // error carries the whole failing row in `detail` — a member's name, address
      // and phone number (spec Part 3 §9.9). This is an allowlist; `logSafety.ts`
      // says why that rather than a list of fields to strip.
      // …AND A REQUEST LINE SAYS WHICH ROUTE, NEVER WHAT WAS ASKED OF IT. pino's own
      // `req` serializer writes the url as it arrived, query string and all, so a
      // member's address typed into a search box and a gym's own words for what a
      // person bought were written on every request that carried them (found by the
      // member list's own log capture, 2026-09-22). `logSafety.ts` says why it is
      // global rather than route by route.
      serializers: { err: safeErrorSerializer, req: safeRequestSerializer },
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
    // Response headers browser JS may READ. @fastify/cors emits
    // Access-Control-Expose-Headers only when this is set (index.js:232-237),
    // and the default is null — so without this line a custom header is sent
    // by the server and silently invisible to the client, exactly the shape of
    // the Card 4 preflight bug (inject() tests cannot see either).
    exposedHeaders: ["Idempotent-Replay"],
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
      err instanceof OrgsError ||
      err instanceof ExportError ||
      (typeof err.code === "string" && err.code.startsWith("FST_"));
    if (clientSafe) {
      if (status >= 500) {
        req.log.warn({ code: err.code, requestId: req.id }, "typed operational failure");
      }
      void reply.status(status).send({
        error: err.code,
        message: err.message,
        requestId: req.id,
        // A 429 from the code door carries the server's own countdown so the
        // screen never invents one (AuthError.retryAfterSeconds).
        ...(err instanceof AuthError && err.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: err.retryAfterSeconds }
          : {}),
        // A refused finish names the questions still open.
        ...(err instanceof OnboardingIncompleteError ? { missing: err.missing } : {}),
      });
      return;
    }
    if (status >= 500) {
      req.log.error({ err, requestId: req.id }, "unhandled error");
      reportError(err, req.id);
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

  // Email (Kd 2026-09-07): Resend when a key is configured — which production
  // REQUIRES (config refinement) — otherwise the dev sender that prints the
  // code in the log, which refuses to exist in production. Tests override.
  const transport =
    config.RESEND_API_KEY !== undefined && config.EMAIL_FROM !== undefined
      ? createResendTransport({ apiKey: config.RESEND_API_KEY, from: config.EMAIL_FROM })
      : null;
  const emailSender =
    overrides.emailSender ??
    (transport !== null ? createResendEmailSender(transport, app.log) : createDevEmailSender(app.log, config));
  const usersEmailSender =
    overrides.usersEmailSender ??
    (transport !== null
      ? createResendUsersEmailSender(transport, app.log, config.WEB_ORIGIN)
      : createDevUsersEmailSender(app.log, config));

  registerAuthenticate(app, { sql, config });
  registerAuthRoutes(app, {
    sql,
    config,
    redis,
    googleVerifier: overrides.googleVerifier ?? createGoogleVerifier(config),
    emailSender,
    ...(overrides.passwordHasher === undefined ? {} : { hasher: overrides.passwordHasher }),
  });
  registerWorkoutRoutes(app, { sql, redis });
  registerUserRoutes(app, { sql, config, redis, emailSender: usersEmailSender });
  // Part 4 §5.2's export right. Serves /v1/users/me/export but lives in the
  // privacy module, next to the Day-14 delete list it must stay in step with.
  registerPrivacyRoutes(app, { sql, redis });
  registerExerciseRoutes(app, { sql });
  registerGamificationRoutes(app, { sql });
  registerCoachRoutes(app, { sql, redis, config }, overrides.coach ?? {});
  registerEntitlementRoutes(app, { sql, redis });
  registerNutritionRoutes(app, { sql, redis, config, reportError }, overrides.nutrition ?? {});
  registerGeoRoutes(app, { sql, redis, config }, overrides.geo ?? {});
  const invites = inviteSettings(config);
  registerOrgRoutes(app, { sql, redis, invites }, overrides.orgs ?? {});
  // The unsubscribe link in every invitation: public, and not under /v1/orgs.
  registerUnsubscribeRoutes(app, { sql, redis, settings: invites });
  // What Resend reports about each email: signed, kept once, acted on by the worker.
  registerResendWebhookRoutes(app, {
    sql,
    secret: config.RESEND_WEBHOOK_SECRET,
    nowSeconds: () => Math.floor(Date.now() / 1000),
  });

  return app;
}
