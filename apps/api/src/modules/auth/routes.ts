// P2.1 — auth routes (thin, R7.1). Route order per R3.3:
// rate limit (per-IP AND per-identifier, R3.7) → Zod parse → handler.
// Tokens travel ONLY as httpOnly cookies (DECISIONS 2026-07-11); bodies never
// carry them. All limits/lifetimes are ported values, cited inline.
import "@fastify/cookie"; // module augmentation: reply.setCookie / req.cookies
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import type { RedisLike } from "../../redis.js";
import type { EmailSender } from "./email.js";
import { errorSummary, type GoogleVerifier } from "./google.js";
import { createDualRateLimit } from "./rateLimit.js";
import {
  changePasswordRequestSchema,
  forgotPasswordRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
  sendCodeRequestSchema,
  verifyCodeRequestSchema,
  verifyEmailRequestSchema,
} from "./schemas.js";
import * as service from "./service.js";
import { argon2idHasher } from "./service.js";
import { createLogOnlyEmailSender } from "./email.js";
import { ACCESS_COOKIE, OAUTH_STATE_COOKIE, REFRESH_COOKIE, mintOpaqueToken } from "./tokens.js";

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

// The OAuth `state` cookie. sameSite 'lax' (NOT the session cookies' 'none'):
// the Google→callback hop is a top-level GET navigation to our own API origin,
// where 'lax' IS sent — and 'lax' is the safer default for a CSRF nonce.
const OAUTH_STATE_PATH = "/v1/auth";
const OAUTH_STATE_TTL_S = 600;
function stateCookieOptions(config: AppConfig, maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: OAUTH_STATE_PATH,
    maxAge: maxAgeSeconds,
  };
}

const googleCallbackQuerySchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
});

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
  deps: {
    sql: Sql;
    config: AppConfig;
    redis: RedisLike;
    emailSender?: EmailSender;
    // null = Google not configured; the routes redirect cleanly (google.ts).
    googleVerifier?: GoogleVerifier | null;
    /** Tests only: a hasher that can hold a password check open; unset is argon2id. */
    hasher?: service.PasswordHasher;
  },
): void {
  const googleVerifier = deps.googleVerifier ?? null;
  const authDeps: service.AuthDeps = {
    sql: deps.sql,
    config: deps.config,
    emailSender: deps.emailSender ?? createLogOnlyEmailSender(app.log),
    hasher: deps.hasher ?? argon2idHasher,
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
  // Each call runs argon2 twice and ends every session: by account, as login's limit
  // counts by address, with a front desk's shared address well above it.
  const changePasswordLimit = createDualRateLimit({
    name: "change_password",
    max: 10,
    ipMax: 100,
    windowMs: HOUR_MS,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  // OAuth routes drive an external Google token exchange + a user INSERT, so
  // they carry a per-route limit like the other auth entry points (R3.7). No
  // email in the request → IP-only. 20/hr matches the auth limiter's number.
  const googleLimit = createDualRateLimit({
    name: "google",
    max: 20,
    windowMs: HOUR_MS,
    identifier: () => null,
    redis: deps.redis,
  });

  // ── sign-in by email code (Kd 2026-09-07) ─────────────────────────────────
  // The per-ADDRESS limits are in the database (two unused codes a day, five
  // guesses a code). These Redis buckets are the wall against a client that VARIES
  // the address, which the per-address rule cannot see: every send is an
  // email Kd pays for, and on the free plan a burst of a hundred takes sign-in
  // down for real users. So the per-IP ceiling is the same order as the
  // per-address one (a gym induction day is thirty people on one wi-fi, which
  // twenty an hour still admits over the day), and on top of it sits ONE
  // ceiling on sends a day across everyone — the outage-and-bill stop.
  const codeSendLimit = createDualRateLimit({
    name: "code_send",
    max: 10,
    ipMax: 20,
    windowMs: HOUR_MS,
    identifier: identifierFrom,
    redis: deps.redis,
  });
  const codeVerifyLimit = createDualRateLimit({
    name: "code_verify",
    max: 20,
    ipMax: 40,
    windowMs: HOUR_MS,
    identifier: identifierFrom,
    redis: deps.redis,
  });
  const DAY_S = 24 * 60 * 60;
  // The ceiling counts EMAILS, not requests: read here, stepped only after a
  // send has resolved (below), so a refusal never spends one of the day's sends.
  // Read-then-count can overshoot by the requests in flight together, nothing
  // against a stop in the thousands. A missing key and a Redis outage both
  // read as "none yet" and open; codeSendLimit runs first and has already
  // logged the outage, so it is never a silent open.
  const DAY_CEILING_KEY = "rl:code_send:all:day";
  const dailySendCeiling = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const sentToday = Number((await deps.redis.get(DAY_CEILING_KEY)) ?? "0");
    if (sentToday >= deps.config.CODE_EMAILS_PER_DAY) {
      await reply.status(429).send({
        error: "code_ceiling",
        message: "Sign-in codes are paused for today. Please try again tomorrow, or sign in with Google.",
        requestId: req.id,
      });
    }
  };

  app.post("/v1/auth/code/send", { preHandler: [codeSendLimit, dailySendCeiling] }, async (req, reply) => {
    const input = parseBody(sendCodeRequestSchema, req, reply);
    if (input === null) return;
    const rules = await service.requestSignInCode(authDeps, input.email);
    // Only a send that resolved is counted against the day's ceiling.
    await deps.redis.incrWithTtl(DAY_CEILING_KEY, DAY_S);
    // One fixed body for known AND unknown addresses — asking never reveals
    // whether an account exists.
    return reply.status(200).send({ message: "We emailed you a 6-digit code.", ...rules });
  });

  app.post("/v1/auth/code/verify", { preHandler: [codeVerifyLimit] }, async (req, reply) => {
    const input = parseBody(verifyCodeRequestSchema, req, reply);
    if (input === null) return;
    const { user, tokens, isNewAccount } = await service.signInWithCode(authDeps, input, requestMeta(req));
    setSessionCookies(reply, deps.config, tokens);
    return reply.status(200).send({ user, isNewAccount });
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
    { preHandler: [app.authenticate, changePasswordLimit] },
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

  // ── Google OAuth (google-login card; v1 §6.1) ─────────────────────────────
  // Tokens NEVER travel in the URL and NEVER touch localStorage — the callback
  // sets the same httpOnly cookies as password login (R3.7/R3.10; the old
  // #token= fragment flow is deliberately not ported).
  const loginRedirect = (reply: FastifyReply, errorCode: string) =>
    reply.redirect(`${deps.config.WEB_ORIGIN}/login?error=${errorCode}`);

  // Step 1: send the browser to Google (with a CSRF `state` cookie).
  app.get("/v1/auth/google", { preHandler: [googleLimit] }, async (_req, reply) => {
    if (googleVerifier === null) return loginRedirect(reply, "google_not_configured");
    const state = mintOpaqueToken();
    reply.setCookie(OAUTH_STATE_COOKIE, state, stateCookieOptions(deps.config, OAUTH_STATE_TTL_S));
    return reply.redirect(googleVerifier.authUrl(state));
  });

  // Step 2: Google redirects back with `code` + `state`.
  app.get("/v1/auth/google/callback", { preHandler: [googleLimit] }, async (req, reply) => {
    if (googleVerifier === null) return loginRedirect(reply, "google_not_configured");
    const parsed = googleCallbackQuerySchema.safeParse(req.query);
    const cookieState = req.cookies[OAUTH_STATE_COOKIE];
    // Single-use state: clear it regardless of outcome.
    reply.clearCookie(OAUTH_STATE_COOKIE, { path: OAUTH_STATE_PATH });
    if (!parsed.success) return loginRedirect(reply, "google_failed");
    const { code, state } = parsed.data;
    if (
      code === undefined ||
      state === undefined ||
      cookieState === undefined ||
      cookieState === "" ||
      state !== cookieState
    ) {
      return loginRedirect(reply, "google_failed");
    }
    let tokens: service.SessionTokens;
    try {
      const identity = await googleVerifier.exchange(code);
      ({ tokens } = await service.googleSignIn(authDeps, identity, requestMeta(req)));
    } catch (err) {
      // Exchange failure / unavailable account → clean login redirect, never a
      // 500 or a leaked reason (R8.1). R3.10: log a SAFE summary, never the raw
      // error — a gaxios failure carries client_secret + the auth code on
      // .config, which pino's redact paths do not cover (T3 finding).
      app.log.warn({ event: "auth.google.callback_failed", err: errorSummary(err) }, "google sign-in failed");
      return loginRedirect(reply, "google_failed");
    }
    setSessionCookies(reply, deps.config, tokens);
    return reply.redirect(`${deps.config.WEB_ORIGIN}/auth/google/success`);
  });
}
