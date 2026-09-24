// The two public links in every invitation: "Not me" (§10.2), below the unsubscribe
// handlers, and the unsubscribe link.
//
// The unsubscribe link (Part 3 §9.12; RFC 8058). Public: no
// cookie, no sign-in, no redirect. The token names the invitation and carries a MAC,
// so only a link we made can unsubscribe anybody, and it keeps that address from THIS
// gym's invitations only.
//
// GET shows a page with one button, because mail scanners open links on their own and
// a GET must change nothing. POST unsubscribes at once: a mail program's one-click POST
// (body `List-Unsubscribe=One-Click`, form-encoded or multipart) is answered with an
// empty 200, the page's own button with a page saying it is done.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Sql } from "postgres";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import { cleanGymText, GYM_TEXT_IN_EMAIL_CHARS, gymNameForEmail } from "./gymText.js";
import * as repo from "./repo.js";
import { notMeByLink } from "./join.js";
import type { InviteSettings } from "./settings.js";
import { readInviteLinkToken, readUnsubscribeToken } from "./token.js";

const APP_NAME = "AI Home Gym";

/** The token rides in the query string, which the api's request log never writes
 *  (`logSafety.ts`); its shape and MAC are checked after. */
// Not strict: an extra parameter a mail program adds must never stop an unsubscribe.
const querySchema = z.object({ t: z.string().max(64) });

const tokenOf = (req: FastifyRequest): string | null => {
  const parsed = querySchema.safeParse(req.query);
  return parsed.success ? parsed.data.t : null;
};

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function page(reply: FastifyReply, status: number, title: string, body: string): FastifyReply {
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${escapeHtml(title)}</title>` +
    `<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.5;color:#111}` +
    `button{font:inherit;padding:.75rem 1.25rem;border-radius:.5rem;border:1px solid #111;background:#111;color:#fff;cursor:pointer}</style>` +
    `</head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`;
  return reply
    .status(status)
    .header("content-type", "text/html; charset=utf-8")
    .header("cache-control", "no-store")
    .header("referrer-policy", "no-referrer")
    .header("x-frame-options", "DENY")
    .header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'")
    .send(html);
}

const notValid = (reply: FastifyReply) =>
  page(reply, 404, "This link isn't valid", "<p>If you copied it from an email, check that you copied all of it.</p>");

/** A mail program's one-click POST, as opposed to the page's own button. */
function isOneClick(contentType: string | undefined, body: unknown): boolean {
  if (contentType?.toLowerCase().startsWith("multipart/form-data") === true) return true;
  return typeof body === "string" && body.includes("List-Unsubscribe=One-Click");
}

export function registerUnsubscribeRoutes(
  app: FastifyInstance,
  deps: { sql: Sql; redis: RedisLike; settings: InviteSettings | null; now?: () => Date },
): void {
  const settings = deps.settings;
  // Mail providers send one-click POSTs from their own servers, so many people's
  // unsubscribes can share one address: the per-address ceiling is high on purpose and
  // the real limit is per link.
  const limit = createDualRateLimit({
    name: "invite_unsubscribe",
    max: 20,
    ipMax: 5000,
    windowMs: 60 * 60 * 1000,
    identifier: tokenOf,
    redis: deps.redis,
  });
  // Pressed by a person in a browser, never by a mail program: the same ceilings.
  const notMeLimit = createDualRateLimit({
    name: "invite_not_me",
    max: 20,
    ipMax: 5000,
    windowMs: 60 * 60 * 1000,
    identifier: tokenOf,
    redis: deps.redis,
  });

  void app.register((scope, _options, done) => {
    // The two bodies RFC 8058 allows, read as text and never parsed further: the token
    // in the address is the whole request.
    scope.addContentTypeParser("*", { parseAs: "string", bodyLimit: 4096 }, (_req, body, done) => {
      done(null, body);
    });

    scope.get("/v1/email/unsubscribe", { preHandler: [limit] }, async (req, reply) => {
      const token = tokenOf(req);
      const inviteId = settings === null || token === null ? null : readUnsubscribeToken(settings.hmacKey, token);
      if (inviteId === null) return notValid(reply);
      const invite = await repo.inviteForUnsubscribe(deps.sql, inviteId);
      if (invite === null) {
        return page(reply, 200, "Nothing to unsubscribe from", "<p>This invitation no longer exists, so nothing more will be sent about it.</p>");
      }
      const gym = escapeHtml(cleanGymText(invite.gymName, GYM_TEXT_IN_EMAIL_CHARS));
      return page(
        reply,
        200,
        `Stop emails from ${cleanGymText(invite.gymName, GYM_TEXT_IN_EMAIL_CHARS)}?`,
        `<p>${gym} won't be able to email you through ${APP_NAME} again.</p>` +
          `<form method="post"><button type="submit">Unsubscribe</button></form>`,
      );
    });

    // "Not me" (§10.2; RULINGS 2026-09-23, gap A): the same shape as the unsubscribe
    // link — a GET that shows one button and changes nothing, a POST that acts — with a
    // token of its own purpose. Its pages name the gym and nothing else: never whom the
    // gym thought it was inviting.
    scope.get("/v1/email/not-me", { preHandler: [notMeLimit] }, async (req, reply) => {
      const token = tokenOf(req);
      const inviteId = settings === null || token === null ? null : readInviteLinkToken(settings.hmacKey, "not_me", token);
      if (inviteId === null) return notValid(reply);
      const invite = await repo.inviteForUnsubscribe(deps.sql, inviteId);
      if (invite === null) {
        return page(reply, 200, "Nothing to do", "<p>This invitation no longer exists.</p>");
      }
      // The name as the email printed it, so a gym named only by a web address is named.
      const gym = gymNameForEmail(invite.gymName);
      return page(
        reply,
        200,
        `Not a member of ${gym}?`,
        `<p>If ${escapeHtml(gym)} invited you by mistake, tell them. They'll check the email address they have, and won't send you this invitation again.</p>` +
          `<form method="post"><button type="submit">It's not me</button></form>`,
      );
    });

    scope.post("/v1/email/not-me", { preHandler: [notMeLimit] }, async (req, reply) => {
      const token = tokenOf(req);
      const inviteId = settings === null || token === null ? null : readInviteLinkToken(settings.hmacKey, "not_me", token);
      if (inviteId === null) return notValid(reply);
      const done = await notMeByLink(deps.sql, inviteId, (deps.now ?? (() => new Date()))());
      if (done.kind === "gone") return page(reply, 200, "Nothing to do", "<p>This invitation no longer exists.</p>");
      const gym = escapeHtml(gymNameForEmail(done.gymName));
      switch (done.kind) {
        case "told":
        case "already_told":
          return page(reply, 200, "Thank you", `<p>We've told ${gym} this invitation isn't for you. You don't need to do anything else.</p>`);
        case "joined":
          return page(
            reply,
            200,
            "This invitation has been used",
            `<p>Somebody has already joined ${gym} by signing in with this email address. If that wasn't you, contact ${gym}.</p>`,
          );
        case "withdrawn":
          return page(reply, 200, "Nothing to do", `<p>${gym} has already taken this invitation back.</p>`);
      }
    });

    scope.post("/v1/email/unsubscribe", { preHandler: [limit] }, async (req, reply) => {
      const token = tokenOf(req);
      const inviteId = settings === null || token === null ? null : readUnsubscribeToken(settings.hmacKey, token);
      const oneClick = isOneClick(req.headers["content-type"], req.body);
      if (inviteId === null) return oneClick ? reply.status(404).send() : notValid(reply);
      const invite = await repo.inviteForUnsubscribe(deps.sql, inviteId);
      if (invite !== null) await repo.suppressForGym(deps.sql, invite.gymId, invite.hmac, "unsubscribed");
      if (oneClick) return reply.status(200).send();
      const gym = invite === null ? "The gym" : cleanGymText(invite.gymName, GYM_TEXT_IN_EMAIL_CHARS);
      return page(reply, 200, "You're unsubscribed", `<p>${escapeHtml(gym)} won't email you through ${APP_NAME} again.</p>`);
    });

    done();
  });
}
