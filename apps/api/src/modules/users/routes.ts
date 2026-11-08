// P2.2 — users routes (thin, R7.1). Route order per R3.3: authn (app.authenticate)
// → Zod parse → handler. Tenancy: every operation is keyed on req.authUser.id —
// there are no id params on this surface, so a user can only ever address
// their own row (R3.2). /restore is unauthenticated by nature (a deleted user
// cannot log in) and rate-limited like password reset (GAP-4 ruling: 5/hr,
// dual-key — no identifier in the body, so the IP bucket carries it).
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { z } from "zod";
import {
  DELETE_PAGE_WORDS,
  EMAIL_CHANGE_WORDS,
  SIGN_IN_ROBOT_WORDS,
  deleteByEmailRequestSchema,
  sendCodeRequestSchema,
  emailChangeLinkRequestSchema,
  type EmailChangeLinkResponse,
  type EmailChangeUndoResponse,
  changeEmailCodeRequestSchema,
  changeEmailRequestSchema,
  onboardingQuerySchema,
  type ChangeEmailResponse,
  type DeleteAccountResponse,
} from "@app/shared";
import { createDualRateLimit, giveBackRateLimit, type DualRateLimitOptions } from "../auth/rateLimit.js";
import { createCodeDoor } from "../auth/codeDoor.js";
import { RobotCheckNeeded } from "../auth/codes.js";
import { AuthError, WrongGuessError } from "../auth/errors.js";
import { readEmailChangeLink, sessionStillLive, undoEmailChangeLink } from "../auth/service.js";
import { maskedAddress } from "../../email/templates.js";
import type { AppConfig } from "../../config.js";
import type { RedisLike } from "../../redis.js";
import type { RobotCheck } from "../orgs/gymPage/robotCheck.js";
import { DPDP_RETENTION_DAYS } from "../../retention.js";
import { onHealthAnswered } from "../gamification/service.js";
import { safeTimeZone } from "../gamification/streak.js";
import { createLogOnlyUsersEmailSender, type UsersEmailSender } from "./email.js";
import { changeEmail, requestChangeEmailCode, type ChangeEmailDeps } from "./changeEmail.js";
import { createLogOnlyChangeEmailSender, type ChangeEmailSender } from "./changeEmailSender.js";
import {
  deleteAccountRequestSchema,
  patchOnboardingRequestSchema,
  putFitnessProfileRequestSchema,
  putHealthScreeningRequestSchema,
  recordConsentRequestSchema,
  restoreAccountRequestSchema,
  updateProfileRequestSchema,
} from "./schemas.js";
import * as service from "./service.js";
import { tellGyms, tellMembersGyms, tellMembersLeaderboards, type LiveNewsSender } from "../live/news.js";

/** Zod-parse a body; 400 with issue paths/codes only — never echo values (R3.10). */
function parseBody<T>(schema: z.ZodType<T>, req: FastifyRequest, reply: FastifyReply): T | null {
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

/** The device's zone (`onboardingQuerySchema`, @app/shared), refused outright
 *  when the runtime does not know it: the
 *  alternative is `safeTimeZone`'s silent fall back to UTC, which would hand a
 *  person in Auckland a finish date a day out with nothing on screen to say so.
 *  Returns undefined when the reply has been sent. */
function parseTimeZone(req: FastifyRequest, reply: FastifyReply): string | null | undefined {
  const parsed = onboardingQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    void reply.status(400).send({
      error: "validation_error",
      message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.code}`).join("; "),
      requestId: req.id,
    });
    return undefined;
  }
  const requested = parsed.data.timeZone;
  if (requested === undefined) return null;
  if (safeTimeZone(requested) !== requested) {
    void reply.status(400).send({
      error: "unknown_time_zone",
      message: "That is not a time zone this server knows.",
      requestId: req.id,
    });
    return undefined;
  }
  return requested;
}

export function registerUserRoutes(
  app: FastifyInstance,
  deps: {
    sql: Sql;
    config: AppConfig;
    redis: RedisLike;
    emailSender?: UsersEmailSender;
    changeEmailSender?: ChangeEmailSender;
    robotCheck: RobotCheck;
    news: LiveNewsSender;
    now?: () => Date;
  },
): void {
  const usersDeps: service.UsersDeps = {
    sql: deps.sql,
    config: deps.config,
    redis: deps.redis,
    emailSender: deps.emailSender ?? createLogOnlyUsersEmailSender(app.log),
    log: app.log,
    ...(deps.now === undefined ? {} : { now: deps.now }),
  };
  const changeEmailDeps: ChangeEmailDeps = {
    sql: deps.sql,
    config: deps.config,
    log: app.log,
    sender: deps.changeEmailSender ?? createLogOnlyChangeEmailSender(app.log),
  };

  const authedUserId = (req: FastifyRequest): string => {
    const userId = req.authUser?.id;
    if (userId === undefined) throw new Error("authenticate preHandler did not run");
    return userId;
  };

  app.get("/v1/users/me", { preHandler: [app.authenticate] }, async (req, reply) => {
    const user = await service.getProfile(usersDeps, authedUserId(req));
    return reply.status(200).send({ user });
  });

  // A change a gym shows (a name, Hide me, an age) makes every staff window of the person's gyms
  // read again, so a person may make 30 of them an hour. A save that changes none of them, or is
  // refused, is given back. The address is not counted: a gym's members share its wi-fi.
  const shownChangesOpts: DualRateLimitOptions = {
    name: "users_shown_changes",
    max: 30,
    ipMax: null,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
    message: "You've changed your name or profile many times in the last hour. Please try again later.",
  };
  const shownChangesLimit = createDualRateLimit(shownChangesOpts);
  /** The requests that took one of the 30: only those are given it back. */
  const tookShown = new WeakSet<FastifyRequest>();
  const takeShown = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    tookShown.add(req);
    await shownChangesLimit(req, reply);
  };
  const sendsShown = (body: unknown): boolean =>
    typeof body === "object" && body !== null && ("displayName" in body || "leaderboardOptOut" in body);
  const profileLimit = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (sendsShown(req.body)) await takeShown(req, reply);
  };
  // The fitness profile is counted only when its age differs from the one saved (left out, it
  // becomes none): a member past the limit still saves their weight, height and goals.
  const ageLimit = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const body = req.body;
    const sent = typeof body === "object" && body !== null && "age" in body ? (body.age ?? null) : null;
    const saved = (await service.getFitnessProfile(usersDeps, authedUserId(req))).age;
    if (sent !== saved) await takeShown(req, reply);
  };

  app.patch("/v1/users/me", { preHandler: [app.authenticate, profileLimit] }, async (req, reply) => {
    const counted = { changed: false };
    try {
      const patch = parseBody(updateProfileRequestSchema, req, reply);
      if (patch === null) return;
      // What a gym shows, as it was, read under the save's own lock: only a change is news to the
      // person's gyms.
      const seen: { was: { displayName: string; leaderboardOptOut: boolean } | null } = { was: null };
      const user = await service.updateProfile(usersDeps, authedUserId(req), patch, (before) => {
        seen.was = before;
      });
      const was = seen.was;
      const nameChanged = was !== null && user.displayName !== was.displayName;
      const optOutChanged = was !== null && user.leaderboardOptOut !== was.leaderboardOptOut;
      counted.changed = nameChanged || optOutChanged;
      // A name changed: the gyms that show it (the check-in log, Who came, the Leaderboard) read again.
      if (nameChanged) tellMembersGyms(deps.sql, deps.news, app.log, authedUserId(req), { what: "people" });
      // Hide me changed here: the leaderboards read again, as `PUT /v1/users/me/leaderboard` tells them.
      if (optOutChanged) tellMembersLeaderboards(deps.sql, deps.news, app.log, authedUserId(req));
      return await reply.status(200).send({ user });
    } finally {
      if (!counted.changed && tookShown.has(req)) await giveBackRateLimit(shownChangesOpts, req);
    }
  });

  // onboarding/fitness profile (onboarding-storage card). Tenancy as above: no
  // id param exists, so a caller can only ever address their own row (R3.2).
  app.get("/v1/users/me/fitness-profile", { preHandler: [app.authenticate] }, async (req, reply) => {
    const fitnessProfile = await service.getFitnessProfile(usersDeps, authedUserId(req));
    return reply.status(200).send({ fitnessProfile });
  });

  // PUT, not POST: full-document replace, idempotent by construction — the same
  // body twice yields the same row, so no Idempotency-Key is needed (R3.5).
  // A body that FINISHES setup while an answer is still open is refused with
  // the onboarding PATCH's own 409 and its list (service `putFitnessProfile`).
  app.put("/v1/users/me/fitness-profile", { preHandler: [app.authenticate, ageLimit] }, async (req, reply) => {
    const counted = { changed: false };
    try {
      const body = parseBody(putFitnessProfileRequestSchema, req, reply);
      if (body === null) return;
      // The whole profile is replaced, so an age left out becomes none: the age is compared every
      // time, with the age read under the save's own lock.
      const seen: { ageBefore: number | null } = { ageBefore: null };
      const fitnessProfile = await service.putFitnessProfile(usersDeps, authedUserId(req), body, (age) => {
        seen.ageBefore = age;
      });
      // An age changed: whether the leaderboards may show them can change with it. Nothing else here
      // is shown to a gym.
      counted.changed = fitnessProfile.age !== seen.ageBefore;
      if (counted.changed) tellMembersGyms(deps.sql, deps.news, app.log, authedUserId(req), { what: "people" });
      return await reply.status(200).send({ fitnessProfile });
    } finally {
      if (!counted.changed && tookShown.has(req)) await giveBackRateLimit(shownChangesOpts, req);
    }
  });

  // Onboarding v2 (ROADMAP 4a): the answers so far and the plan they make.
  // Same tenancy argument as everything else on this surface — no id param
  // exists, so a caller can only ever address their own answers (R3.2).
  app.get("/v1/users/me/onboarding", { preHandler: [app.authenticate] }, async (req, reply) => {
    const timeZone = parseTimeZone(req, reply);
    if (timeZone === undefined) return;
    const result = await service.getOnboarding(usersDeps, authedUserId(req), timeZone);
    return reply.status(200).send(result);
  });

  // PATCH, not PUT: one screen at a time, and a screen must never write NULL
  // over the answers it did not ask about (RULINGS 2026-09-07 — saved as you
  // go). Idempotent all the same, so no Idempotency-Key: the same body twice
  // leaves the same row (R3.5).
  app.patch("/v1/users/me/onboarding", { preHandler: [app.authenticate] }, async (req, reply) => {
    const timeZone = parseTimeZone(req, reply);
    if (timeZone === undefined) return;
    const body = parseBody(patchOnboardingRequestSchema, req, reply);
    if (body === null) return;
    const result = await service.patchOnboarding(usersDeps, authedUserId(req), body, timeZone);
    return reply.status(200).send(result);
  });

  // Settings' "Reset onboarding" (RULINGS 2026-07-20: it wipes every answer),
  // the answers only the screens ask included, which the old PUT {} could not
  // reach. DELETE is idempotent — a second reset finds nothing and answers the
  // same — so no Idempotency-Key. Same tenancy argument: no id param exists.
  app.delete("/v1/users/me/onboarding", { preHandler: [app.authenticate] }, async (req, reply) => {
    const timeZone = parseTimeZone(req, reply);
    if (timeZone === undefined) return;
    const result = await service.resetOnboarding(usersDeps, authedUserId(req), timeZone);
    return reply.status(200).send(result);
  });

  // Health screening and Safe mode (ROADMAP 3b). Same tenancy argument as the
  // fitness profile: no id param, so only the signed-in person's own row.
  //
  // NO PER-ROUTE LIMIT, deliberately, and the difference from the consent log
  // below is the point: this PUT upserts ONE row per person, so hammering it
  // grows nothing and costs nothing but the write — the app-wide 300/minute
  // (app.ts) is the bound it needs. The consent log is append-only, so a run of
  // taps there leaves rows behind for ever, which is what earns it a limiter of
  // its own. Revisit only if this row ever gains a history.
  app.get("/v1/users/me/health-screening", { preHandler: [app.authenticate] }, async (req, reply) => {
    const healthScreening = await service.getHealthScreening(usersDeps, authedUserId(req));
    return reply.status(200).send({ healthScreening });
  });

  // PUT: the whole screening replaced; the same body twice yields the same row.
  app.put("/v1/users/me/health-screening", { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = parseBody(putHealthScreeningRequestSchema, req, reply);
    if (body === null) return;
    const userId = authedUserId(req);
    const healthScreening = await service.putHealthScreening(usersDeps, userId, body);
    // Safe mode pauses this week's challenges and the XP they would pay (35b). A failure here
    // never fails the save: the next workout, meal or read of the challenges does it again.
    await onHealthAnswered({ sql: deps.sql }, userId).catch((err: unknown) => {
      app.log.warn(
        { event: "gamification.health_recompute_failed", userId, errName: err instanceof Error ? err.name : typeof err },
        "weekly challenges not paused after the health answer",
      );
    });
    return reply.status(200).send({ healthScreening });
  });

  // The consent log: one row per disclaimer tap; the person can read their own
  // (the newest page, with the total so a short list never passes for all).
  app.get("/v1/users/me/consents", { preHandler: [app.authenticate] }, async (req, reply) => {
    const list = await service.listConsents(usersDeps, authedUserId(req));
    return reply.status(200).send(list);
  });

  // Appends to a table the purge never empties, so it gets its own ceiling on
  // top of the global one: three screens carry a disclaimer, so thirty taps an
  // hour is far beyond honest use. Keyed on the signed-in person AND the IP
  // (authenticate runs first, R3.3, so the person is known here).
  //
  // THE TWO DIMENSIONS ARE DELIBERATELY ASYMMETRIC, and the IP number is the
  // GYM-FLOOR figure this repo already uses for the routes a whole building
  // shares (orgs/routes.ts: attendanceMarkLimit, cheerLimit, memberNudgeLimit).
  // A gym's whole floor onboards from one address, so the person's own 30
  // counted against the address would have thrown the ELEVENTH person off the
  // wi-fi mid-onboarding — a tap they cannot finish signing up without.
  // 600 was the first answer to that and was still too tight: three taps a
  // person is only 200 people an hour, under the 300 members a trial
  // organisation admits (RULINGS 2026-08-25), so a bulk induction would 429 its
  // tail with the identical consequence. 3000 clears any one gym's whole roster
  // and still bounds a script; the abuse guard is the PER-PERSON 30, untouched.
  const consentLimit = createDualRateLimit({
    name: "consent",
    max: 30,
    ipMax: 3000,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });

  app.post("/v1/users/me/consents", { preHandler: [app.authenticate, consentLimit] }, async (req, reply) => {
    const body = parseBody(recordConsentRequestSchema, req, reply);
    if (body === null) return;
    const consent = await service.recordConsent(usersDeps, authedUserId(req), body);
    return reply.status(201).send({ consent });
  });

  // Changing the address and deleting the account need a sign-in that is still live: an Undo this
  // change ends every one of the account's, and an access token already out would otherwise go on for
  // its 15 minutes (item 19's security pass, H1). The phone and the browser sign in again.
  const liveSession = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (await sessionStillLive(deps.sql, authedUserId(req), req.authUser?.familyId ?? null)) return;
    await reply.status(401).send({ error: "unauthorized", message: "authentication required", requestId: req.id });
  };

  // Step 1 of deleting: a code goes to the account's own address. The day cap
  // and resend gap are the sign-in code's (counted separately, by purpose).
  app.post("/v1/users/me/delete-code", { preHandler: [app.authenticate, liveSession] }, async (req, reply) => {
    const rules = await service.requestDeleteCode(usersDeps, authedUserId(req));
    return reply.status(200).send({ message: "We emailed you a 6-digit code.", ...rules });
  });

  // Step 2: the code in the body proves it is the account holder deleting.
  app.delete("/v1/users/me", { preHandler: [app.authenticate, liveSession] }, async (req, reply) => {
    const input = parseBody(deleteAccountRequestSchema, req, reply);
    if (input === null) return;
    // The gyms the deletion itself took the person out of, a gym joined in that same instant too.
    const { emailSent, deletedByAnother, leftGymIds } = await service.deleteAccount(usersDeps, authedUserId(req), input.code);
    tellGyms(deps.news, leftGymIds, { what: "people" });
    // T3 2026-07-11 finding 6: don't promise an email that wasn't sent
    // (OAuth-only accounts have no address; sender may also have failed).
    // The number is interpolated from src/retention.ts, never restated: if
    // the window ever widens (Kd's open privacy-scope ruling), copy that
    // still said "14 days" would be the API lying about its own behaviour.
    return reply.status(200).send({
      message: emailSent
        ? `Account scheduled for deletion. You have ${String(DPDP_RETENTION_DAYS)} days to undo via the link we emailed you.`
        : `Account scheduled for deletion. It will be permanently removed after ${String(DPDP_RETENTION_DAYS)} days.`,
      emailSent,
      deletedByAnother,
    } satisfies DeleteAccountResponse);
  });

  // THE WEBSITE'S DELETE YOUR ACCOUNT PAGE (21b-ii), for somebody without the app: no sign-in, the code
  // emailed to the address typed is the proof. Behind the sign-in page's own walls (codeDoor.ts): the
  // robot check, the address's hour, the day's ceiling and the wrong guesses, and the database's own day
  // cap and resend gap for the address. Asking answers the same for every address; only somebody who
  // proved the code learns whether it has an account.
  const door = createCodeDoor({ config: deps.config, redis: deps.redis, robotCheck: deps.robotCheck, pausedWords: DELETE_PAGE_WORDS.paused });
  app.post("/v1/account-deletion/code", { preHandler: door.beforeSend }, async (req, reply) => {
    const input = parseBody(sendCodeRequestSchema, req, reply);
    if (input === null) return;
    let rules: Awaited<ReturnType<typeof service.requestDeleteCodeByEmail>>;
    try {
      rules = await service.requestDeleteCodeByEmail(usersDeps, input.email, door.passedRobot(req) ? "passed" : "not_passed");
    } catch (err) {
      if (err instanceof RobotCheckNeeded) return door.askForRobot(req, reply);
      // The address's codes for today are used up, perhaps by somebody else: the app still works.
      if (err instanceof AuthError && err.code === "code_limit") throw new AuthError(429, "code_limit", DELETE_PAGE_WORDS.paused, err.retryAfterSeconds);
      throw err;
    }
    await door.countSent();
    return reply.status(200).header("cache-control", "no-store").send({ message: DELETE_PAGE_WORDS.sent(input.email), ...rules });
  });

  app.post("/v1/account-deletion", { preHandler: [door.guessRoom] }, async (req, reply) => {
    const input = parseBody(deleteByEmailRequestSchema, req, reply);
    if (input === null) return;
    let deleted: Awaited<ReturnType<typeof service.deleteAccountByEmail>>;
    try {
      deleted = await service.deleteAccountByEmail(usersDeps, input.email, input.code);
    } catch (err) {
      if (err instanceof WrongGuessError) await door.countWrongGuess(req);
      throw err;
    }
    tellGyms(deps.news, deleted.leftGymIds, { what: "people" });
    return reply
      .status(200)
      .header("cache-control", "no-store")
      .send({
        message: deleted.deletedByAnother ? DELETE_PAGE_WORDS.doneMaybe : deleted.emailSent ? DELETE_PAGE_WORDS.doneUndo : DELETE_PAGE_WORDS.doneNoEmail,
        emailSent: deleted.emailSent,
        deletedByAnother: deleted.deletedByAnother,
      } satisfies DeleteAccountResponse);
  });

  // Change email (Stage 5 19c). Each new address keeps the code's own day cap and resend gap; a
  // person may also try ten addresses a day, and the code back thirty times an hour. Keyed on the
  // person alone: a gym's members share its wi-fi.
  const changeEmailCodeLimit = createDualRateLimit({
    name: "change_email_code",
    max: 10,
    ipMax: null,
    windowMs: 24 * 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
    message: "You’ve asked for many codes today. Please try again tomorrow.",
  });
  const changeEmailLimit = createDualRateLimit({
    name: "change_email",
    max: 30,
    ipMax: null,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
    message: "You’ve tried many codes in the last hour. Please try again later.",
  });

  // THE ROBOT CHECK past an account's third change-email code of the day (item 19's security pass,
  // L2): without it, accounts made at the sign-in door could each send the app's email to ten
  // strangers a day with no check. Keyed on the person, never the internet address (a gym's members
  // share its wi-fi). Every answer is put to Cloudflare, once; Redis down: every ask needs the check.
  const CHANGE_EMAIL_FREE_CODES_PER_DAY = 3;
  const changeEmailPassedRobot = new WeakSet<FastifyRequest>();
  const askForRobot = (req: FastifyRequest, reply: FastifyReply, error: "robot_check" | "robot_failed") =>
    reply.status(403).send({ error, message: SIGN_IN_ROBOT_WORDS[error], robotCheckKey: deps.robotCheck.siteKey, requestId: req.id });
  const changeEmailRobotGate = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const body = parseBody(changeEmailCodeRequestSchema, req, reply);
    if (body === null) return;
    if (body.robotToken !== undefined) {
      const answer = await deps.robotCheck.verify(body.robotToken, "sign_in");
      if (answer === "unavailable") {
        await reply.status(503).send({ error: "robot_unavailable", message: SIGN_IN_ROBOT_WORDS.robot_unavailable, requestId: req.id });
        return;
      }
      if (answer !== "passed") {
        await askForRobot(req, reply, "robot_failed");
        return;
      }
      changeEmailPassedRobot.add(req);
    }
    const asked = await deps.redis.incrWithTtl(`rl:change_email_free:user:${authedUserId(req)}`, 24 * 60 * 60);
    const free = asked !== null && asked <= CHANGE_EMAIL_FREE_CODES_PER_DAY;
    if (!free && !changeEmailPassedRobot.has(req)) await askForRobot(req, reply, "robot_check");
  };

  // Step 1: a code to the new address.
  app.post("/v1/users/me/email-code", { preHandler: [app.authenticate, liveSession, changeEmailRobotGate, changeEmailCodeLimit] }, async (req, reply) => {
    const input = parseBody(changeEmailCodeRequestSchema, req, reply);
    if (input === null) return;
    const rules = await requestChangeEmailCode(changeEmailDeps, authedUserId(req), input.email);
    return reply.status(200).send({ message: `We emailed a 6-digit code to ${input.email}.`, ...rules });
  });

  // UNDO THIS CHANGE (item 19's security pass, H1; Kd 2026-11-06): the page the note to the old address
  // opens. No sign-in: the token is the whole request, in the body; it names one change and nothing else.
  // Limited by the link and by the internet address, as an emailed link to sign is. Opening the page
  // changes nothing: only the page's own button undoes, so a mail program that opens links cannot.
  const byLink = (req: FastifyRequest): string | null => {
    const token = (req.body as { token?: unknown } | null | undefined)?.token;
    return typeof token === "string" ? createHash("sha256").update(token, "utf8").digest("hex") : null;
  };
  const HOUR = 60 * 60 * 1000;
  const undoReadLimit = createDualRateLimit({ name: "email_change_read", max: 60, ipMax: 600, windowMs: HOUR, identifier: byLink, redis: deps.redis });
  const undoLimit = createDualRateLimit({ name: "email_change_undo", max: 20, ipMax: 200, windowMs: HOUR, identifier: byLink, redis: deps.redis });
  const supportEmail = deps.config.SUPPORT_EMAIL ?? null;
  const notValid = (req: FastifyRequest, reply: FastifyReply) =>
    reply.status(404).header("cache-control", "no-store").send({ error: "link_not_valid", message: EMAIL_CHANGE_WORDS.notValid, requestId: req.id });

  app.post("/v1/email-change/read", { preHandler: [undoReadLimit] }, async (req, reply) => {
    const input = parseBody(emailChangeLinkRequestSchema, req, reply);
    if (input === null) return;
    const link = await readEmailChangeLink(deps.sql, input.token);
    if (link.kind === "unknown") return notValid(req, reply);
    const page: EmailChangeLinkResponse =
      link.kind === "open"
        ? { state: "open", oldEmail: link.oldEmail, newEmail: maskedAddress(link.newEmail), supportEmail }
        : link.kind === "done"
          ? { state: "done", oldEmail: link.oldEmail }
          : { state: "closed", supportEmail };
    return reply.status(200).header("cache-control", "no-store").send(page);
  });

  app.post("/v1/email-change/undo", { preHandler: [undoLimit] }, async (req, reply) => {
    const input = parseBody(emailChangeLinkRequestSchema, req, reply);
    if (input === null) return;
    const undone = await undoEmailChangeLink(deps.sql, input.token);
    if (undone.kind === "unknown") return notValid(req, reply);
    if (undone.kind === "closed") {
      return reply.status(409).header("cache-control", "no-store").send({ error: "link_closed", message: `${EMAIL_CHANGE_WORDS.closedTitle}. ${EMAIL_CHANGE_WORDS.closed}`, requestId: req.id });
    }
    if (undone.kind === "taken") {
      const help = supportEmail === null ? "" : ` ${EMAIL_CHANGE_WORDS.writeToUs(supportEmail)}`;
      return reply.status(409).header("cache-control", "no-store").send({ error: "email_in_use", message: `${EMAIL_CHANGE_WORDS.taken}${help}`, requestId: req.id });
    }
    // The person's gyms show the address on their page.
    if (!undone.already) tellMembersGyms(deps.sql, deps.news, app.log, undone.userId, { what: "people" });
    return reply.status(200).header("cache-control", "no-store").send({ state: "done", oldEmail: undone.oldEmail } satisfies EmailChangeUndoResponse);
  });

  // Step 2: the code proves the new address; the account moves to it.
  app.post("/v1/users/me/email", { preHandler: [app.authenticate, liveSession, changeEmailLimit] }, async (req, reply) => {
    const input = parseBody(changeEmailRequestSchema, req, reply);
    if (input === null) return;
    const userId = authedUserId(req);
    const changed = await changeEmail(changeEmailDeps, userId, input);
    // The person's gyms show the address on their page, and the name where it changed with it.
    tellMembersGyms(deps.sql, deps.news, app.log, userId, { what: "people" });
    return reply.status(200).send({
      message: `Your email is now ${changed.email}.`,
      email: changed.email,
      displayName: changed.displayName,
    } satisfies ChangeEmailResponse);
  });

  // 5/hr — the reset-class limit (rateLimiter.js:17-18 ported at P2.1; GAP-4).
  const restoreLimit = createDualRateLimit({
    name: "restore",
    max: 5,
    windowMs: 60 * 60 * 1000,
    identifier: () => null, // body carries only the token — never key a bucket on a secret
    redis: deps.redis,
  });

  app.post("/v1/users/me/restore", { preHandler: [restoreLimit] }, async (req, reply) => {
    const input = parseBody(restoreAccountRequestSchema, req, reply);
    if (input === null) return;
    await service.restoreAccount(usersDeps, input.token);
    return reply.status(200).send({ message: "Account restored. You can now log in." });
  });
}
