// A gym's leads (spec Part 3 §16.3; ROADMAP 20c-i). Thin: authenticate, parse, hand
// to the service, which checks the privilege before it spends the rate limit.
//
// Both limits are keyed on the user with an explicit `ipMax`: a front desk is one
// address with several staff signed in on it.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import type { z } from "zod";
import {
  MEMBER_FILE_MAX_BASE64_CHARS,
  createLeadRequestSchema,
  joinLeadRequestSchema,
  leadFileAddRequestSchema,
  leadFileCheckRequestSchema,
  leadFollowUpSentRequestSchema,
  leadsQuerySchema,
  updateLeadEmailSettingsRequestSchema,
  updateLeadRequestSchema,
} from "@app/shared";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import type { InviteSettings } from "../invites/settings.js";
import { leadParamsSchema, orgParamsSchema } from "../schemas.js";
import * as emailSettings from "./emailSettings.js";
import * as fileService from "./fileService.js";
import * as service from "./service.js";

/** A file of leads arrives as base64, as a member list does, with room for the rest of
 *  the body (the mapping, the key). */
const FILE_BODY_LIMIT = MEMBER_FILE_MAX_BASE64_CHARS + 16 * 1024;

function parseOr400<S extends z.ZodTypeAny>(
  schema: S,
  value: unknown,
  req: FastifyRequest,
  reply: FastifyReply,
): z.output<S> | null {
  const parsed: z.SafeParseReturnType<unknown, z.output<S>> = schema.safeParse(value);
  if (!parsed.success) {
    // Issue paths and codes only, never the value: it is somebody's name or number.
    void reply.status(400).send({
      error: "validation_error",
      message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.code}`).join("; "),
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

export interface LeadRouteDeps {
  sql: Sql;
  redis: RedisLike;
  invites: InviteSettings | null;
}

export function registerLeadRoutes(app: FastifyInstance, deps: LeadRouteDeps): void {
  const leadDeps: service.LeadsDeps = { sql: deps.sql, now: () => new Date(), addressKey: deps.invites?.hmacKey ?? null };

  /** Reads follow a search box (one read after each pause in typing): the member
   *  list's read allowance. */
  const readLimit = createDualRateLimit({
    name: "leads_read",
    max: 600,
    ipMax: 2000,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  /** A desk adds a lead a visit; 300 an hour each is far above that. */
  const writeLimit = createDualRateLimit({
    name: "leads_write",
    max: 300,
    ipMax: 900,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  /** False when the limiter has answered 429 itself. */
  const gate =
    (limit: (req: FastifyRequest, reply: FastifyReply) => Promise<void>) =>
    (req: FastifyRequest, reply: FastifyReply) =>
    async (): Promise<boolean> => {
      await limit(req, reply);
      return !reply.sent;
    };
  /** A file is read in a worker thread each time staff check it (a column changed is
   *  another check): 30 an hour each, 100 from one address — `ipMax` explicit, for the
   *  front desk that is one address with several staff signed in on it. */
  const fileCheckLimit = createDualRateLimit({
    name: "leads_file_check",
    max: 30,
    ipMax: 100,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  /** Add reads the file once more and writes; fewer than checks. */
  const fileAddLimit = createDualRateLimit({
    name: "leads_file_add",
    max: 20,
    ipMax: 60,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  const readGate = gate(readLimit);
  const writeGate = gate(writeLimit);
  const fileDeps: fileService.LeadFileDeps = { sql: deps.sql, redis: deps.redis, log: app.log };
  const signedIn = { preHandler: [app.authenticate] };

  app.get("/v1/orgs/:gymId/leads", signedIn, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const query = parseOr400(leadsQuerySchema, req.query, req, reply);
    if (query === null) return;
    const page = await service.listLeads(leadDeps, requireUserId(req), params.gymId, query, readGate(req, reply));
    if (page === null) return;
    return reply.status(200).send(page);
  });

  /** Leads from a file (20c-iii): who would be added, and nothing written. */
  app.post(
    "/v1/orgs/:gymId/leads/from-file/check",
    { bodyLimit: FILE_BODY_LIMIT, preHandler: [app.authenticate] },
    async (req, reply) => {
      const params = parseOr400(orgParamsSchema, req.params, req, reply);
      if (params === null) return;
      const body = parseOr400(leadFileCheckRequestSchema, req.body, req, reply);
      if (body === null) return;
      const preview = await fileService.checkLeadFile(fileDeps, requireUserId(req), params.gymId, body, gate(fileCheckLimit)(req, reply));
      if (preview === null) return;
      return reply.status(200).send({ preview });
    },
  );

  /** Add exactly the leads the check showed, or nothing (409 `lead_file_changed`). */
  app.post(
    "/v1/orgs/:gymId/leads/from-file",
    { bodyLimit: FILE_BODY_LIMIT, preHandler: [app.authenticate] },
    async (req, reply) => {
      const params = parseOr400(orgParamsSchema, req.params, req, reply);
      if (params === null) return;
      const body = parseOr400(leadFileAddRequestSchema, req.body, req, reply);
      if (body === null) return;
      const done = await fileService.addLeadFile(fileDeps, requireUserId(req), params.gymId, body, gate(fileAddLimit)(req, reply));
      if (done === null) return;
      return reply.status(200).send(done);
    },
  );

  app.get("/v1/orgs/:gymId/leads/:leadId", signedIn, async (req, reply) => {
    const params = parseOr400(leadParamsSchema, req.params, req, reply);
    if (params === null) return;
    const lead = await service.getLead(leadDeps, requireUserId(req), params.gymId, params.leadId, readGate(req, reply));
    if (lead === null) return;
    return reply.status(200).send({ lead });
  });

  /** The messages a lead sent through the gym page's form (20c-iv-a). */
  app.get("/v1/orgs/:gymId/leads/:leadId/enquiries", signedIn, async (req, reply) => {
    const params = parseOr400(leadParamsSchema, req.params, req, reply);
    if (params === null) return;
    const enquiries = await service.listEnquiries(leadDeps, requireUserId(req), params.gymId, params.leadId, readGate(req, reply));
    if (enquiries === null) return;
    return reply.status(200).send({ enquiries });
  });

  app.post("/v1/orgs/:gymId/leads", signedIn, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(createLeadRequestSchema, req.body, req, reply);
    if (body === null) return;
    const lead = await service.createLead(leadDeps, requireUserId(req), params.gymId, body, writeGate(req, reply));
    if (lead === null) return;
    return reply.status(201).send({ lead });
  });

  /** PATCH: a field left out is left alone (`updateLeadRequestSchema`). */
  app.patch("/v1/orgs/:gymId/leads/:leadId", signedIn, async (req, reply) => {
    const params = parseOr400(leadParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(updateLeadRequestSchema, req.body, req, reply);
    if (body === null) return;
    const lead = await service.updateLead(leadDeps, requireUserId(req), params.gymId, params.leadId, body, writeGate(req, reply));
    if (lead === null) return;
    return reply.status(200).send({ lead });
  });

  app.delete("/v1/orgs/:gymId/leads/:leadId", signedIn, async (req, reply) => {
    const params = parseOr400(leadParamsSchema, req.params, req, reply);
    if (params === null) return;
    const done = await service.deleteLead(leadDeps, requireUserId(req), params.gymId, params.leadId, writeGate(req, reply));
    if (done === null) return;
    return reply.status(204).send();
  });

  /** Settings → Follow-up emails to leads (20c-v): the owner's "Send them for me". A
   *  static path, so it is never read as a lead's id. */
  app.get("/v1/orgs/:gymId/leads/email-settings", signedIn, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const settings = await emailSettings.readEmailSettings(leadDeps, requireUserId(req), params.gymId, readGate(req, reply));
    if (settings === null) return;
    return reply.status(200).send({ settings });
  });

  app.put("/v1/orgs/:gymId/leads/email-settings", signedIn, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(updateLeadEmailSettingsRequestSchema, req.body, req, reply);
    if (body === null) return;
    const settings = await emailSettings.writeEmailSettings(leadDeps, requireUserId(req), params.gymId, body, writeGate(req, reply));
    if (settings === null) return;
    return reply.status(200).send({ settings });
  });

  /** A follow-up email sent from the gym's own mailbox (20c-ii). The same request
   *  twice answers the lead unchanged. */
  app.post("/v1/orgs/:gymId/leads/:leadId/follow-up", signedIn, async (req, reply) => {
    const params = parseOr400(leadParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(leadFollowUpSentRequestSchema, req.body, req, reply);
    if (body === null) return;
    const lead = await service.markFollowUpSent(leadDeps, requireUserId(req), params.gymId, params.leadId, body, writeGate(req, reply));
    if (lead === null) return;
    return reply.status(200).send({ lead });
  });

  /** Joined. The same request twice answers `already_joined` the second time. */
  app.post("/v1/orgs/:gymId/leads/:leadId/join", signedIn, async (req, reply) => {
    const params = parseOr400(leadParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(joinLeadRequestSchema, req.body ?? {}, req, reply);
    if (body === null) return;
    const answer = await service.joinLead(leadDeps, requireUserId(req), params.gymId, params.leadId, body, writeGate(req, reply));
    if (answer.kind === "rate_limited") return;
    if (answer.kind === "joined") return reply.status(200).send(answer.body);
    return reply.status(409).send({
      error: answer.error,
      message: answer.message,
      candidates: answer.candidates,
      requestId: req.id,
    });
  });
}
