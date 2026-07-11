// P2.1 — auth routes (thin, R7.1). Route order per R3.3:
// rate limit (per-IP AND per-identifier, R3.7) → Zod parse → handler.
// Tokens travel ONLY as httpOnly cookies (DECISIONS 2026-07-11); bodies never
// carry them. All limits/lifetimes are ported values, cited inline.
import "@fastify/cookie"; // module augmentation: reply.setCookie / req.cookies
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import type { z } from "zod";
import type { AppConfig } from "../../config.js";
import type { RedisLike } from "../../redis.js";
import type { EmailSender } from "./email.js";
import { createDualRateLimit } from "./rateLimit.js";
import {
  changePasswordRequestSchema,
  forgotPasswordRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
  verifyEmailRequestSchema,
} from "./schemas.js";
import * as service from "./service.js";
import { bcryptHasher } from "./service.js";
import { createLogOnlyEmailSender } from "./email.js";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "./tokens.js";

/** GAP-2 (DECISIONS 2026-07-11, closes Part IV #6): cross-site prod (Vercel ↔
 *  Hetzner) needs sameSite 'none' + secure; dev/test localhost is same-site. */
function cookieOptions(config: AppConfig, maxAgeSeconds: number, path: string) {
  const prod = config.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: prod,
    sameSite: prod ? ("none" as const) : ("lax" as const),
    path,
    maxAge: maxAgeSeconds,
  };
}

// The long-lived refresh token travels ONLY to the auth endpoints, not on
// every API request (T3 2026-07-11; DECISIONS).
const REFRESH_PATH = "/v1/auth";

function setSessionCookies(
  reply: FastifyReply,
  config: AppConfig,
  tokens: service.SessionTokens,
): void {
  reply.setCookie(ACCESS_COOKIE, tokens.accessToken, cookieOptions(config, config.ACCESS_TTL_MIN * 60, "/"));
  reply.setCookie(
    REFRESH_COOKIE,
    tokens.refreshToken,
    cookieOptions(config, config.REFRESH_TTL_DAYS * 24 * 60 * 60, REFRESH_PATH),
  );
}

function clearSessionCookies(reply: FastifyReply, config: AppConfig): void {
  reply.setCookie(ACCESS_COOKIE, "", cookieOptions(config, 0, "/"));
  reply.setCookie(REFRESH_COOKIE, "", cookieOptions(config, 0, REFRESH_PATH));
}

function requestMeta(req: FastifyRequest): service.RequestMeta {
  return { ip: req.ip || null, userAgent: req.headers["user-agent"] ?? null };
}

/** Zod-parse a body; 400 with issue paths/codes only — never echo values (R3.10). */
function parseBody<T>(
  schema: z.ZodType<T>,
  req: FastifyRequest,
  reply: FastifyReply,
): T | null {
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

/** Best-effort identifier for the per-identifier limiter: the body's email
 *  (pre-validation, so extraction is defensive). null = no identifier — the
 *  per-IP bucket still applies regardless. */
function identifierFrom(req: FastifyRequest): string | null {
  const body: unknown = req.body;
  if (typeof body === "object" && body !== null && "email" in body && typeof body.email === "string") {
    return body.email.trim().toLowerCase().slice(0, 254);
  }
  return null;
}

export function registerAuthRoutes(
  app: FastifyInstance,
  deps: { sql: Sql; config: AppConfig; redis: RedisLike; emailSender?: EmailSender },
): void {
  const authDeps: service.AuthDeps = {
    sql: deps.sql,
    config: deps.config,
    emailSender: deps.emailSender ?? createLogOnlyEmailSender(app.log),
    hasher: bcryptHasher,
    log: app.log,
  };

  // R3.7: strict per-route limits on register/login/forgot, per-IP AND
  // per-identifier. Numbers ported from rateLimiter.js:5-6 (20/hr auth) and
  // :17-18 (5/hr reset). Custom dual-bucket limiter — @fastify/rate-limit
  // cannot run after the global limiter (rateLimit.ts explains; PROVE-run fix).
  const HOUR_MS = 60 * 60 * 1000;
  const authLimit = createDualRateLimit({
    name: "auth",
    max: 20,
    windowMs: HOUR_MS,
    identifier: identifierFrom,
    redis: deps.redis,
  });
  const resetLimit = createDualRateLimit({
    name: "reset",
    max: 5,
    windowMs: HOUR_MS,
    identifier: identifierFrom,
    redis: deps.redis,
  });

  app.post("/v1/auth/register", { preHandler: [authLimit] }, async (req, reply) => {
    const input = parseBody(registerRequestSchema, req, reply);
    if (input === null) return;
    const { userId } = await service.register(authDeps, input);
    return reply.status(201).send({
      userId,
      message: "Registration successful! Please check your email to verify your account.",
    });
  });

  app.post("/v1/auth/login", { preHandler: [authLimit] }, async (req, reply) => {
    const input = parseBody(loginRequestSchema, req, reply);
    if (input === null) return;
    const { user, tokens } = await service.login(authDeps, input, requestMeta(req));
    setSessionCookies(reply, deps.config, tokens);
    return reply.status(200).send({ user });
  });

  app.post("/v1/auth/refresh", async (req, reply) => {
    const raw = req.cookies[REFRESH_COOKIE];
    if (raw === undefined || raw === "") {
      return reply.status(401).send({
        error: "invalid_refresh",
        message: "Invalid refresh token",
        requestId: req.id,
      });
    }
    const tokens = await service.refresh(authDeps, raw, requestMeta(req));
    setSessionCookies(reply, deps.config, tokens);
    return reply.status(204).send();
  });

  app.post("/v1/auth/logout", async (req, reply) => {
    await service.logout(authDeps, req.cookies[REFRESH_COOKIE] ?? null);
    clearSessionCookies(reply, deps.config);
    return reply.status(200).send({ message: "Logged out successfully" });
  });

  app.post("/v1/auth/verify-email", { preHandler: [authLimit] }, async (req, reply) => {
    const input = parseBody(verifyEmailRequestSchema, req, reply);
    if (input === null) return;
    const { user, tokens } = await service.verifyEmail(authDeps, input.token, requestMeta(req));
    setSessionCookies(reply, deps.config, tokens);
    return reply.status(200).send({ user });
  });

  app.post("/v1/auth/forgot-password", { preHandler: [resetLimit] }, async (req, reply) => {
    const input = parseBody(forgotPasswordRequestSchema, req, reply);
    if (input === null) return;
    await service.forgotPassword(authDeps, input.email);
    // One fixed body for known AND unknown emails (authController.js:200-223).
    return reply.status(200).send({
      message: "If an account exists with this email, a reset link has been sent.",
    });
  });

  app.post("/v1/auth/reset-password", { preHandler: [resetLimit] }, async (req, reply) => {
    const input = parseBody(resetPasswordRequestSchema, req, reply);
    if (input === null) return;
    await service.resetPassword(authDeps, input);
    return reply.status(200).send({
      message: "Password reset successful. You can now log in.",
    });
  });

  app.post(
    "/v1/auth/change-password",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const input = parseBody(changePasswordRequestSchema, req, reply);
      if (input === null) return;
      const userId = req.authUser?.id;
      if (userId === undefined) throw new Error("authenticate preHandler did not run");
      const tokens = await service.changePassword(authDeps, userId, input, requestMeta(req));
      setSessionCookies(reply, deps.config, tokens);
      return reply.status(200).send({ message: "Password changed successfully" });
    },
  );

  app.get("/v1/auth/me", { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = req.authUser?.id;
    if (userId === undefined) throw new Error("authenticate preHandler did not run");
    const user = await service.getMe(authDeps, userId);
    return reply.status(200).send({ user });
  });
}
