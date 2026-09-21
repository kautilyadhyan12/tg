// THE MEMBER LIST'S ROUTES (Part 3 §9.9), thin as every other route file in this
// module: authenticate, Zod-parse, hand to the service, which owns the
// authorisation and the rate limit in that order (CLAUDE.md §4; the service's own
// header says why the limiter is called there and not hung on the route).
//
// Registered from `registerOrgRoutes` rather than from `app.ts`, because these
// are the same console behind the same gates and share its deps.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import type { z } from "zod";
import {
  MEMBER_FILE_MAX_BASE64_CHARS,
  MEMBER_LIST_CONFIRM_REFUSAL_WORDS,
  memberListConfirmRequestSchema,
  memberListEntriesQuerySchema,
  memberListRowsQuerySchema,
  memberListUploadRequestSchema,
} from "@app/shared";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import { memberListParamsSchema, orgParamsSchema } from "../schemas.js";
import * as service from "./service.js";

/** The body limit for an upload: the base64 ceiling plus room for the two other
 *  fields and JSON's own punctuation. Per-route, on the photo route's precedent —
 *  the app's default limit is small on purpose, and one door that takes a
 *  spreadsheet must not raise it for every other door. */
const UPLOAD_BODY_LIMIT = MEMBER_FILE_MAX_BASE64_CHARS + 8 * 1024;

function parseOr400<S extends z.ZodTypeAny>(
  schema: S,
  value: unknown,
  req: FastifyRequest,
  reply: FastifyReply,
): z.output<S> | null {
  const parsed: z.SafeParseReturnType<unknown, z.output<S>> = schema.safeParse(value);
  if (!parsed.success) {
    // Issue paths and codes only, never the offending value (R3.10): the value
    // here is a member list.
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

export interface MemberListRouteDeps {
  sql: Sql;
  redis: RedisLike;
}

export function registerMemberListRoutes(app: FastifyInstance, deps: MemberListRouteDeps): void {
  const listDeps: service.MemberListDeps = {
    sql: deps.sql,
    redis: deps.redis,
    log: app.log,
    now: () => new Date(),
  };

  /** **`ipMax` IS EXPLICIT AND IT IS THE WHOLE POINT OF THIS LIMITER'S SHAPE.**
   *  A gym's front desk is one address with several staff signed in on it, and a
   *  per-address ceiling equal to the per-person one would throttle the second
   *  person to touch the screen (the shared-address class this repo has been bitten
   *  by more than once). 12 uploads an hour each, 40 from one address (§9.9).
   *
   *  Keyed on the USER, not the gym: the allowance belongs to whoever is uploading,
   *  so one busy gym cannot spend another's, and one member of staff cannot spend
   *  their colleague's. */
  const uploadLimit = createDualRateLimit({
    name: "memberlist_upload",
    max: 12,
    ipMax: 40,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });

  /** Reading a preview back is cheap and staff page through it, so it is far
   *  looser than the upload — but it is not free: every page holds real people's
   *  addresses, so there is a ceiling on how fast one account can walk the list. */
  const readLimit = createDualRateLimit({
    name: "memberlist_read",
    max: 600,
    ipMax: 2000,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });

  /** The limiter as the service calls it: false means it has answered 429 itself
   *  and the handler is finished. `reply.sent` is what says so — the limiter sends
   *  its own reply, exactly as it does as a preHandler. */
  const gate =
    (limit: (req: FastifyRequest, reply: FastifyReply) => Promise<void>) =>
    (req: FastifyRequest, reply: FastifyReply) =>
    async (): Promise<boolean> => {
      await limit(req, reply);
      return !reply.sent;
    };
  const uploadGate = gate(uploadLimit);
  const readGate = gate(readLimit);

  app.post(
    "/v1/orgs/:gymId/member-list/uploads",
    { bodyLimit: UPLOAD_BODY_LIMIT, preHandler: [app.authenticate] },
    async (req, reply) => {
      const params = parseOr400(orgParamsSchema, req.params, req, reply);
      if (params === null) return;
      const body = parseOr400(memberListUploadRequestSchema, req.body, req, reply);
      if (body === null) return;
      const preview = await service.previewUpload(
        listDeps,
        requireUserId(req),
        params.gymId,
        { contentBase64: body.contentBase64, mode: body.mode, mapping: body.mapping },
        uploadGate(req, reply),
      );
      // Null means the limiter has already answered.
      if (preview === null) return;
      return reply.status(201).send({ preview });
    },
  );

  app.get("/v1/orgs/:gymId/member-list/uploads/:uploadId", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(memberListParamsSchema, req.params, req, reply);
    if (params === null) return;
    const preview = await service.readPreview(
      listDeps,
      requireUserId(req),
      params.gymId,
      params.uploadId,
      readGate(req, reply),
    );
    // Null means the limiter has already answered.
    if (preview === null) return;
    return reply.status(200).send({ preview });
  });

  app.get(
    "/v1/orgs/:gymId/member-list/uploads/:uploadId/rows",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const params = parseOr400(memberListParamsSchema, req.params, req, reply);
      if (params === null) return;
      const query = parseOr400(memberListRowsQuerySchema, req.query, req, reply);
      if (query === null) return;
      const page = await service.readPreviewRows(
        listDeps,
        requireUserId(req),
        params.gymId,
        params.uploadId,
        query.group,
        query.cursor ?? 0,
        readGate(req, reply),
      );
      if (page === null) return;
      return reply.status(200).send({ page });
    },
  );


  /** CONFIRMING IS ITS OWN ALLOWANCE, and a much looser one than uploading: it
   *  reads no file and spawns no worker, and staff correcting a mapping and
   *  pressing again must not be throttled into thinking the button is broken.
   *  30 an hour each, 120 from one address (§9.9) — `ipMax` explicit, for the
   *  front desk that is one address with several staff signed in on it. */
  const confirmLimit = createDualRateLimit({
    name: "memberlist_confirm",
    max: 30,
    ipMax: 120,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  const confirmGate = gate(confirmLimit);

  app.post(
    "/v1/orgs/:gymId/member-list/uploads/:uploadId/confirm",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const params = parseOr400(memberListParamsSchema, req.params, req, reply);
      if (params === null) return;
      // A body is optional on the wire and `{}` here, so a screen that sends
      // nothing is asking for a confirm without the tick rather than a 400.
      const body = parseOr400(memberListConfirmRequestSchema, req.body ?? {}, req, reply);
      if (body === null) return;
      const answer = await service.confirmUpload(
        listDeps,
        requireUserId(req),
        params.gymId,
        params.uploadId,
        { acknowledgeLargeChange: body.acknowledgeLargeChange ?? false },
        confirmGate(req, reply),
      );
      switch (answer.kind) {
        case "rate_limited":
          // The limiter has already answered 429.
          return;
        case "confirmed":
          return reply.status(200).send({ confirmed: answer.confirmed });
        case "list_changed":
          // 409 WITH THE NUMBERS, not a bare sentence: a screen has to be able to
          // say which version it measured and which the list is on, or "somebody
          // changed it" is a dead end for the person standing at the desk.
          return reply.status(409).send({
            error: "list_changed",
            message: MEMBER_LIST_CONFIRM_REFUSAL_WORDS.list_changed,
            baseVersion: answer.baseVersion,
            version: answer.version,
            requestId: req.id,
          });
        case "large_change":
          return reply.status(409).send({
            error: "large_change",
            message: MEMBER_LIST_CONFIRM_REFUSAL_WORDS.large_change,
            guard: answer.guard,
            requestId: req.id,
          });
      }
    },
  );

  app.get("/v1/orgs/:gymId/member-list", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const list = await service.readList(listDeps, requireUserId(req), params.gymId, readGate(req, reply));
    // Null means the limiter has already answered.
    if (list === null) return;
    return reply.status(200).send({ list });
  });

  app.get("/v1/orgs/:gymId/member-list/entries", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const query = parseOr400(memberListEntriesQuerySchema, req.query, req, reply);
    if (query === null) return;
    const page = await service.readEntries(listDeps, requireUserId(req), params.gymId, query, readGate(req, reply));
    if (page === null) return;
    return reply.status(200).send({ page });
  });
}
