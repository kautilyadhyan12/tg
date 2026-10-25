// A business's membership agreement (ROADMAP 18u-i):
//   GET    /v1/orgs/:gymId/agreement        its words and how many memberships signed them (`org.manage`)
//   PUT    /v1/orgs/:gymId/agreement        save the words
//   DELETE /v1/orgs/:gymId/agreement        stop asking for it
//   POST   /v1/orgs/:gymId/agreements                  add another agreement (18u-ii-a)
//   PUT    /v1/orgs/:gymId/agreements/:agreementId     save it: its name, words and lines of the price list
//   DELETE /v1/orgs/:gymId/agreements/:agreementId     stop asking for it
//   GET    /v1/orgs/:gymId/member-list/entries/:entryId/memberships/:membershipId/agreement         the desk's box (`members.confirm`)
//   POST   /v1/orgs/:gymId/member-list/entries/:entryId/memberships/:membershipId/agreement/sign    the person signs
//   POST   /v1/orgs/:gymId/member-list/entries/:entryId/memberships/:membershipId/agreement/email   the copy, emailed again
//   POST   /v1/orgs/:gymId/member-list/entries/:entryId/memberships/:membershipId/agreement/link    email a link to sign (18u-ii-b)
//   POST   /v1/agreement-link/read   the link's page: what to sign (public: the token is the whole request)
//   POST   /v1/agreement-link/sign   the person signs from the link
// Authenticate, then who the caller is at this gym, then the limit, then the handler: the
// service asks the tick first and the limit after it. The link's two routes have no sign-in:
// the token rides in the body, which no log writes, never in an address.
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  agreementLinkReadBodySchema,
  agreementLinkSignBodySchema,
  saveGymAgreementBodySchema,
  saveOtherAgreementBodySchema,
  signMembershipAgreementBodySchema,
} from "@app/shared";
import type { Sql } from "postgres";
import type { z } from "zod";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import { heldMembershipParamsSchema, orgParamsSchema, otherAgreementParamsSchema } from "../schemas.js";
import type { LiveNewsSender } from "../../live/news.js";
import type { AgreementEmailSender } from "./email.js";
import * as service from "./service.js";

const HOUR_MS = 60 * 60 * 1000;

function parseOr400<S extends z.ZodTypeAny>(schema: S, value: unknown, req: FastifyRequest, reply: FastifyReply): z.output<S> | null {
  const parsed: z.SafeParseReturnType<unknown, z.output<S>> = schema.safeParse(value);
  if (!parsed.success) {
    // Issue paths and codes only, never the value. The first ten: a body can be long.
    void reply.status(400).send({
      error: "validation_error",
      message: parsed.error.issues
        .slice(0, 10)
        .map((issue) => `${issue.path.join(".")}: ${issue.code}`)
        .join("; "),
      requestId: req.id,
    });
    return null;
  }
  return parsed.data;
}

function requireUserId(req: FastifyRequest): string {
  const userId = req.authUser?.id;
  if (userId === undefined) throw new Error("authenticate preHandler did not run");
  return userId;
}

export function registerAgreementRoutes(
  app: FastifyInstance,
  deps: { sql: Sql; redis: RedisLike; now: () => Date; email: AgreementEmailSender; addressKey: Buffer | null; webOrigin: string; news: LiveNewsSender },
): void {
  const agreementDeps: service.AgreementDeps = { sql: deps.sql, now: deps.now, email: deps.email, addressKey: deps.addressKey, log: app.log, webOrigin: deps.webOrigin, news: deps.news };
  const tellMemberships = (gymId: string, entryId: string): void => {
    deps.news.tell(gymId, { what: "memberships", entryId });
  };
  const byPerson = (req: FastifyRequest): string | null => req.authUser?.id ?? null;
  const gate =
    (limit: (req: FastifyRequest, reply: FastifyReply) => Promise<void>) =>
    (req: FastifyRequest, reply: FastifyReply) =>
    async (): Promise<boolean> => {
      await limit(req, reply);
      return !reply.sent;
    };

  // Settings reads once a visit and after each save; a gym's few staff share an address.
  const staffReadLimit = createDualRateLimit({ name: "agreement_staff_read", max: 300, ipMax: 900, windowMs: HOUR_MS, identifier: byPerson, redis: deps.redis });
  const staffWriteLimit = createDualRateLimit({ name: "agreement_staff_write", max: 30, ipMax: 90, windowMs: HOUR_MS, identifier: byPerson, redis: deps.redis });
  // The desk: one member of staff giving a queue of new people their memberships on a busy
  // evening, a few staff on one address, and a gym moving in signing its members up in a day.
  const deskReadLimit = createDualRateLimit({ name: "agreement_desk_read", max: 600, ipMax: 1800, windowMs: HOUR_MS, identifier: byPerson, redis: deps.redis });
  const deskSignLimit = createDualRateLimit({ name: "agreement_desk_sign", max: 200, ipMax: 600, windowMs: HOUR_MS, identifier: byPerson, redis: deps.redis });
  // Each is an email to a member: a few an hour is the desk's whole need.
  const copyLimit = createDualRateLimit({ name: "agreement_copy_email", max: 30, ipMax: 90, windowMs: HOUR_MS, identifier: byPerson, redis: deps.redis });
  // Each is an email to a member: a desk sending links to a gym moving in, on one address.
  const linkSendLimit = createDualRateLimit({ name: "agreement_link_send", max: 200, ipMax: 600, windowMs: HOUR_MS, identifier: byPerson, redis: deps.redis });
  // The link's page, counted by its token (as its hash): one person opening it again and again;
  // a family or an office on one address is many links.
  const byLink = (req: FastifyRequest): string | null => {
    const token = (req.body as { token?: unknown } | null | undefined)?.token;
    return typeof token === "string" ? createHash("sha256").update(token, "utf8").digest("hex") : null;
  };
  const linkReadLimit = createDualRateLimit({ name: "agreement_link_read", max: 60, ipMax: 600, windowMs: HOUR_MS, identifier: byLink, redis: deps.redis });
  const linkSignLimit = createDualRateLimit({ name: "agreement_link_sign", max: 20, ipMax: 200, windowMs: HOUR_MS, identifier: byLink, redis: deps.redis });

  const url = "/v1/orgs/:gymId/agreement";

  app.get(url, { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const agreement = await service.getGymAgreement(agreementDeps, requireUserId(req), params.gymId, gate(staffReadLimit)(req, reply));
    if (agreement === null) return;
    return reply.status(200).header("cache-control", "no-store").send(agreement);
  });

  app.put(url, { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(saveGymAgreementBodySchema, req.body, req, reply);
    if (body === null) return;
    const agreement = await service.saveGymAgreement(agreementDeps, requireUserId(req), params.gymId, body.text, gate(staffWriteLimit)(req, reply));
    if (agreement === null) return;
    return reply.status(200).header("cache-control", "no-store").send(agreement);
  });

  app.delete(url, { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const agreement = await service.stopGymAgreement(agreementDeps, requireUserId(req), params.gymId, gate(staffWriteLimit)(req, reply));
    if (agreement === null) return;
    return reply.status(200).header("cache-control", "no-store").send(agreement);
  });

  const othersUrl = "/v1/orgs/:gymId/agreements";

  app.post(othersUrl, { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(saveOtherAgreementBodySchema, req.body, req, reply);
    if (body === null) return;
    const agreement = await service.addOtherAgreement(agreementDeps, requireUserId(req), params.gymId, body, gate(staffWriteLimit)(req, reply));
    if (agreement === null) return;
    return reply.status(200).header("cache-control", "no-store").send(agreement);
  });

  app.put(`${othersUrl}/:agreementId`, { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(otherAgreementParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(saveOtherAgreementBodySchema, req.body, req, reply);
    if (body === null) return;
    const agreement = await service.saveOtherAgreement(agreementDeps, requireUserId(req), params.gymId, params.agreementId, body, gate(staffWriteLimit)(req, reply));
    if (agreement === null) return;
    return reply.status(200).header("cache-control", "no-store").send(agreement);
  });

  app.delete(`${othersUrl}/:agreementId`, { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(otherAgreementParamsSchema, req.params, req, reply);
    if (params === null) return;
    const agreement = await service.stopOtherAgreement(agreementDeps, requireUserId(req), params.gymId, params.agreementId, gate(staffWriteLimit)(req, reply));
    if (agreement === null) return;
    return reply.status(200).header("cache-control", "no-store").send(agreement);
  });

  const deskUrl = "/v1/orgs/:gymId/member-list/entries/:entryId/memberships/:membershipId/agreement";

  app.get(deskUrl, { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(heldMembershipParamsSchema, req.params, req, reply);
    if (params === null) return;
    const box = await service.getMembershipAgreement(agreementDeps, requireUserId(req), params.gymId, params.entryId, params.membershipId, gate(deskReadLimit)(req, reply));
    if (box === null) return;
    return reply.status(200).header("cache-control", "no-store").send(box);
  });

  app.post(`${deskUrl}/sign`, { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(heldMembershipParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(signMembershipAgreementBodySchema, req.body, req, reply);
    if (body === null) return;
    const signed = await service.signMembershipAgreement(
      agreementDeps,
      requireUserId(req),
      params.gymId,
      params.entryId,
      params.membershipId,
      body,
      gate(deskSignLimit)(req, reply),
    );
    if (signed === null) return;
    tellMemberships(params.gymId, params.entryId);
    return reply.status(200).header("cache-control", "no-store").send(signed);
  });

  app.post(`${deskUrl}/email`, { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(heldMembershipParamsSchema, req.params, req, reply);
    if (params === null) return;
    const sent = await service.emailAgreementCopy(agreementDeps, requireUserId(req), params.gymId, params.entryId, params.membershipId, gate(copyLimit)(req, reply));
    if (sent === null) return;
    return reply.status(200).header("cache-control", "no-store").send(sent);
  });

  app.post(`${deskUrl}/link`, { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(heldMembershipParamsSchema, req.params, req, reply);
    if (params === null) return;
    const sent = await service.sendAgreementLink(agreementDeps, requireUserId(req), params.gymId, params.entryId, params.membershipId, gate(linkSendLimit)(req, reply));
    if (sent === null) return;
    tellMemberships(params.gymId, params.entryId);
    return reply.status(200).header("cache-control", "no-store").send(sent);
  });

  // The page the emailed link opens. No sign-in: the token names one membership and nothing else.
  app.post("/v1/agreement-link/read", async (req, reply) => {
    const body = parseOr400(agreementLinkReadBodySchema, req.body, req, reply);
    if (body === null) return;
    if (!(await gate(linkReadLimit)(req, reply)())) return;
    const page = await service.readAgreementLink(agreementDeps, body.token);
    return reply.status(200).header("cache-control", "no-store").send(page);
  });

  app.post("/v1/agreement-link/sign", async (req, reply) => {
    const body = parseOr400(agreementLinkSignBodySchema, req.body, req, reply);
    if (body === null) return;
    if (!(await gate(linkSignLimit)(req, reply)())) return;
    const signed = await service.signByAgreementLink(agreementDeps, body);
    return reply.status(200).header("cache-control", "no-store").send(signed);
  });
}
