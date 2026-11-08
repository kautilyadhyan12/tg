// P2.1 — auth routes (thin, R7.1). Route order per R3.3:
// rate limit (per-IP AND per-identifier, R3.7) → Zod parse → handler.
// A browser's tokens travel ONLY as httpOnly cookies (DECISIONS 2026-07-11). The phone
// app has no cookie: a sign-in that names itself `phone` is sent its tokens in the
// reply and sets no cookie (spec Part 3 §10.5). All limits/lifetimes are ported values,
// cited inline.
import "@fastify/cookie"; // module augmentation: reply.setCookie / req.cookies
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { z } from "zod";
import type { AppConfig } from "../../config.js";
import type { RedisLike } from "../../redis.js";
import type { EmailSender } from "./email.js";
import { refusalReason, type GooglePhoneVerifier, type GoogleVerifier } from "./google.js";
import { googleWordSecondsLeft, mintGoogleWord } from "./googleWord.js";
import { WrongGuessError } from "./errors.js";
import { createDualRateLimit } from "./rateLimit.js";
import { createCodeDoor } from "./codeDoor.js";
import type { RobotCheck } from "../orgs/gymPage/robotCheck.js";
import {
  googlePhoneSignInRequestSchema,
  phoneRefreshRequestSchema,
} from "@app/shared";
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
import { RobotCheckNeeded } from "./codes.js";
// `cookieOptions` (GAP-2: sameSite 'none' + secure in production) lives in tokens.ts, so the
// session cookies and the trial mark are set by one rule (round one of 2c, L4).
import { ACCESS_COOKIE, OAUTH_STATE_COOKIE, REFRESH_COOKIE, cookieOptions, mintOpaqueToken, sha256Hex } from "./tokens.js";

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

/** A BROWSER NEVER HOLDS A TOKEN A SCRIPT CAN READ (CLAUDE.md §4). A browser puts an
 *  `Origin` on every one of these POSTs and the phone app sends none, so the phone's
 *  way is refused to anything that carries one. true: refused, and answered. */
function refusedFromABrowser(req: FastifyRequest, reply: FastifyReply): boolean {
  if (req.headers.origin === undefined) return false;
  void reply.status(400).send({ error: "validation_error", message: "client: not_in_a_browser", requestId: req.id });
  return true;
}

/** The phone app's refresh token, from a body that names one. null: the body names
 *  none (a browser sends nothing or an empty one), so the cookie is read. undefined:
 *  the body names one and was refused, and the reply is already sent. */
function phoneTokenIn(req: FastifyRequest, reply: FastifyReply): string | null | undefined {
  const body: unknown = req.body;
  if (typeof body !== "object" || body === null || !("refreshToken" in body)) return null;
  if (refusedFromABrowser(req, reply)) return undefined;
  return parseBody(phoneRefreshRequestSchema, req, reply)?.refreshToken;
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
  deps: {
    sql: Sql;
    config: AppConfig;
    redis: RedisLike;
    emailSender?: EmailSender;
    // null = Google not configured; the routes redirect cleanly (google.ts).
    googleVerifier?: GoogleVerifier | null;
    /** The phone's Google sign-in; null = Google not configured, and the phone is told so. */
    googlePhoneVerifier?: GooglePhoneVerifier | null;
    robotCheck: RobotCheck;
    /** Tests only: a hasher that can hold a password check open; unset is argon2id. */
    hasher?: service.PasswordHasher;
  },
): void {
  const googleVerifier = deps.googleVerifier ?? null;
  const googlePhoneVerifier = deps.googlePhoneVerifier ?? null;
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
  // GOOGLE IN THE BROWSER (R3.7). A callback drives a token exchange with Google and maybe a user
  // INSERT. A whole gym signs in on one wi-fi (ROADMAP Stage 4 item 10), so the address
  // is charged only for what one person there could not do for free: an answer Google
  // refused. 60 of those in a minute and the address waits out that minute before
  // Google is asked again. A callback whose state is not ours is refused before any
  // work and costs nothing; starting a sign-in only redirects. Both stay under the
  // app-wide floor. A troublemaker at the address can hold Google back only while they
  // keep failing, and never for longer than a minute after.
  const GOOGLE_REFUSED_MAX = 60;
  const GOOGLE_REFUSED_WINDOW_S = 60;
  const googleRefusedKey = (req: FastifyRequest) => `rl:google_refused:ip:${req.ip}`;

  // ── sign-in by email code (Kd 2026-09-07) ─────────────────────────────────
  // The walls around the door (robot check, the address’s hour, the day’s ceiling, wrong guesses)
  // are shared with the website’s Delete your account page: codeDoor.ts.
  const door = createCodeDoor({ config: deps.config, redis: deps.redis, robotCheck: deps.robotCheck });

  app.post("/v1/auth/code/send", { preHandler: door.beforeSend }, async (req, reply) => {
    const input = parseBody(sendCodeRequestSchema, req, reply);
    if (input === null) return;
    let rules: Awaited<ReturnType<typeof service.requestSignInCode>>;
    try {
      rules = await service.requestSignInCode(authDeps, input.email, door.passedRobot(req) ? "passed" : "not_passed");
    } catch (err) {
      if (err instanceof RobotCheckNeeded) return door.askForRobot(req, reply);
      throw err;
    }
    await door.countSent();
    // One fixed body for known AND unknown addresses — asking never reveals
    // whether an account exists.
    return reply.status(200).send({ message: "We emailed you a 6-digit code.", ...rules });
  });

  app.post("/v1/auth/code/verify", { preHandler: [door.guessRoom] }, async (req, reply) => {
    const input = parseBody(verifyCodeRequestSchema, req, reply);
    if (input === null) return;
    if (input.client === "phone" && refusedFromABrowser(req, reply)) return;
    let signedIn: Awaited<ReturnType<typeof service.signInWithCode>>;
    try {
      signedIn = await service.signInWithCode(authDeps, input, requestMeta(req));
    } catch (err) {
      if (err instanceof WrongGuessError) await door.countWrongGuess(req);
      throw err;
    }
    const { user, tokens, isNewAccount } = signedIn;
    if (input.client === "phone") {
      return reply.header("cache-control", "no-store").status(200).send({ user, isNewAccount, tokens });
    }
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
    const phone = phoneTokenIn(req, reply);
    if (phone === undefined) return;
    if (phone !== null) {
      const tokens = await service.refresh(authDeps, phone, requestMeta(req), "phone");
      return reply.header("cache-control", "no-store").status(200).send({ tokens });
    }
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
    const phone = phoneTokenIn(req, reply);
    if (phone === undefined) return;
    if (phone !== null) {
      await service.logout(authDeps, phone, "phone");
      return reply.status(200).send({ message: "Logged out successfully" });
    }
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
  app.get("/v1/auth/google", async (_req, reply) => {
    if (googleVerifier === null) return loginRedirect(reply, "google_not_configured");
    const state = mintOpaqueToken();
    reply.setCookie(OAUTH_STATE_COOKIE, state, stateCookieOptions(deps.config, OAUTH_STATE_TTL_S));
    return reply.redirect(googleVerifier.authUrl(state));
  });

  // Step 2: Google redirects back with `code` + `state`.
  app.get("/v1/auth/google/callback", async (req, reply) => {
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
    if (Number((await deps.redis.get(googleRefusedKey(req))) ?? "0") >= GOOGLE_REFUSED_MAX) {
      return loginRedirect(reply, "google_busy");
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
      app.log.warn({ event: "auth.google.callback_failed", reason: refusalReason(err) }, "google sign-in failed");
      await deps.redis.incrWithTtl(googleRefusedKey(req), GOOGLE_REFUSED_WINDOW_S);
      return loginRedirect(reply, "google_failed");
    }
    setSessionCookies(reply, deps.config, tokens);
    return reply.redirect(`${deps.config.WEB_ORIGIN}/auth/google/success`);
  });

  // ── Google on the phone (ROADMAP Stage 5 item 12d) ────────────────────────
  // The phone asks here for a one-time word, asks Google with it (Credential Manager), and
  // sends back Google's signed answer, which carries the word. The server keeps nothing
  // when it hands a word out (googleWord.ts); a word is marked used in Redis when an
  // answer brings it back, so a copied answer signs nobody in again. NO PER-ADDRESS GATE
  // HERE, unlike the browser's callback, which asks Google: every check on this road is
  // local (Google's keys are cached by the SDK), so a refusal costs nothing, and a gate
  // would only let one person on a gym's wi-fi keep Google off for everybody there (the
  // security pass on item 12, H5). The app-wide floor still bounds an address.
  const googleWordUsedKey = (word: string) => `google_word_used:${sha256Hex(word)}`;
  const GOOGLE_PHONE_WORDS = {
    google_not_configured: "Google sign-in isn’t available. Sign in with your email.",
    google_down: "Google sign-in isn’t working right now. Try again, or sign in with your email.",
    google_failed: "Google sign-in didn’t work. Try again, or sign in with your email.",
  } as const;
  const googlePhoneRefusal = (req: FastifyRequest, reply: FastifyReply, status: number, error: keyof typeof GOOGLE_PHONE_WORDS) =>
    reply.status(status).send({ error, message: GOOGLE_PHONE_WORDS[error], requestId: req.id });

  app.post("/v1/auth/google/phone/start", async (req, reply) => {
    if (refusedFromABrowser(req, reply)) return;
    if (googlePhoneVerifier === null) return googlePhoneRefusal(req, reply, 503, "google_not_configured");
    const nonce = mintGoogleWord(deps.config.JWT_SECRET, Date.now());
    return reply.header("cache-control", "no-store").status(200).send({ nonce, clientId: googlePhoneVerifier.clientId });
  });

  app.post("/v1/auth/google/phone", async (req, reply) => {
    if (refusedFromABrowser(req, reply)) return;
    const input = parseBody(googlePhoneSignInRequestSchema, req, reply);
    if (input === null) return;
    if (googlePhoneVerifier === null) return googlePhoneRefusal(req, reply, 503, "google_not_configured");
    const refused = (reason: string) => {
      app.log.warn({ event: "auth.google.phone_refused", reason }, "google phone sign-in refused");
      return googlePhoneRefusal(req, reply, 401, "google_failed");
    };
    let identity: Awaited<ReturnType<GooglePhoneVerifier["verify"]>>;
    try {
      identity = await googlePhoneVerifier.verify(input.idToken);
    } catch (err) {
      return refused(refusalReason(err));
    }
    // Only once the answer is Google's: a junk body marks nobody's word.
    const left = googleWordSecondsLeft(deps.config.JWT_SECRET, identity.nonce, Date.now());
    if (left === null) return refused("word_not_ours");
    // The first answer to bring the word back marks it, for the minutes it has left.
    const uses = await deps.redis.incrWithTtl(googleWordUsedKey(identity.nonce), left);
    if (uses === null) return googlePhoneRefusal(req, reply, 503, "google_down");
    if (uses !== 1) return refused("word_used");
    const { user, tokens, isNewAccount } = await service.googleSignIn(authDeps, identity, requestMeta(req), "phone");
    return reply.header("cache-control", "no-store").status(200).send({ user, isNewAccount, tokens });
  });
}
