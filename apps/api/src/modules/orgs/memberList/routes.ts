// THE MEMBER LIST'S ROUTES (Part 3 §9.9), thin as every other route file in this
// module: authenticate, Zod-parse, hand to the service, which owns the
// authorisation and the rate limit in that order (CLAUDE.md §4; the service's own
// header says why the limiter is called there and not hung on the route).
//
// Registered from `registerOrgRoutes` rather than from `app.ts`, because these
// are the same console behind the same gates and share its deps.
import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import type { z } from "zod";
import {
  MEMBER_FILE_MAX_BASE64_CHARS,
  MEMBER_LIST_BY_HAND_WORDS,
  MEMBER_LIST_CONFIRM_REFUSAL_WORDS,
  MEMBER_INVITE_WORDS,
  memberInvitePreviewQuerySchema,
  memberInviteRequestSchema,
  memberListConfirmRequestSchema,
  memberListEntriesQuerySchema,
  memberListEntryInputSchema,
  memberListEntryPatchSchema,
  memberListMergeRequestSchema,
  memberListRemoveUnlistedRequestSchema,
  memberListRemoveByWordsRequestSchema,
  memberListByWordsQuerySchema,
  memberListExportQuerySchema,
  memberListRowsQuerySchema,
  memberListUnlistedQuerySchema,
  memberListUploadRequestSchema,
} from "@app/shared";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import { memberListEntryParamsSchema, memberListParamsSchema, memberParamsSchema, orgParamsSchema } from "../schemas.js";
import * as invites from "../invites/service.js";
import type { InviteSettings } from "../invites/settings.js";
import * as byHand from "./byHandService.js";
import * as exporter from "./exportCsv.js";
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
  /** Invitations (3b-i-a), or null while they are switched off. */
  invites: InviteSettings | null;
}

export function registerMemberListRoutes(app: FastifyInstance, deps: MemberListRouteDeps): void {
  const listDeps: service.MemberListDeps = {
    sql: deps.sql,
    redis: deps.redis,
    log: app.log,
    now: () => new Date(),
    invites: deps.invites,
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
        {
          acknowledgeLargeChange: body.acknowledgeLargeChange ?? false,
          acknowledgeHandEdits: body.acknowledgeHandEdits ?? false,
          permissionConfirmed: body.permissionConfirmed ?? false,
        },
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
        case "permission_needed":
          return reply.status(409).send({
            error: "permission_needed",
            message: MEMBER_LIST_CONFIRM_REFUSAL_WORDS.permission_needed,
            requestId: req.id,
          });
        case "hand_edits":
          // 409 WITH THE FIELD NAMES (§11.4): "your edits would be replaced" tells
          // nobody whether it matters, and a screen cannot ask staff to tick without
          // saying what would go. Names and a count — never a value, never a person.
          return reply.status(409).send({
            error: "hand_edits",
            message: MEMBER_LIST_CONFIRM_REFUSAL_WORDS.hand_edits,
            handEdits: answer.handEdits,
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

  // ── Keeping the list by hand (3a-iv; §9.9, §11.6) ──

  /** Typing one person in or taking one off: 120 an hour each, 600 from one address
   *  (§9.9), `ipMax` explicit for the front desk. One allowance for every write by
   *  hand, so a screen cannot spend around it by switching between them. */
  const editGate = gate(
    createDualRateLimit({
      name: "memberlist_edit",
      max: 120,
      ipMax: 600,
      windowMs: 60 * 60 * 1000,
      identifier: (req) => req.authUser?.id ?? null,
      redis: deps.redis,
    }),
  );

  /** "Remove all": 10 an hour each, 40 from one address (§9.9). */
  const removeGate = gate(
    createDualRateLimit({
      name: "memberlist_remove_unlisted",
      max: 10,
      ipMax: 40,
      windowMs: 60 * 60 * 1000,
      identifier: (req) => req.authUser?.id ?? null,
      redis: deps.redis,
    }),
  );

  const sendWrite = (req: FastifyRequest, reply: FastifyReply, answer: byHand.WriteAnswer) => {
    switch (answer.kind) {
      case "rate_limited":
        return;
      case "written":
        return reply.status(answer.status).send(answer.written);
      case "already_on_list": {
        const code = answer.former ? "former_record" : "already_on_list";
        return reply.status(409).send({
          error: code,
          message: MEMBER_LIST_BY_HAND_WORDS[code],
          entryId: answer.entryId,
          requestId: req.id,
        });
      }
      case "leaves_list":
        return reply.status(409).send({
          error: "leaves_list",
          message: MEMBER_LIST_BY_HAND_WORDS[answer.by === "merge" ? "leaves_list_merge" : "leaves_list_change"],
          members: answer.members,
          requestId: req.id,
        });
    }
  };

  app.get("/v1/orgs/:gymId/member-list/entries/:entryId", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(memberListEntryParamsSchema, req.params, req, reply);
    if (params === null) return;
    const entry = await byHand.readEntry(listDeps, requireUserId(req), params.gymId, params.entryId, readGate(req, reply));
    if (entry === null) return;
    return reply.status(200).send({ entry });
  });

  app.post("/v1/orgs/:gymId/member-list/entries", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(memberListEntryInputSchema, req.body, req, reply);
    if (body === null) return;
    return sendWrite(req, reply, await byHand.addEntry(listDeps, requireUserId(req), params.gymId, body, editGate(req, reply)));
  });

  app.patch("/v1/orgs/:gymId/member-list/entries/:entryId", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(memberListEntryParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(memberListEntryPatchSchema, req.body, req, reply);
    if (body === null) return;
    const answer = await byHand.changeEntry(listDeps, requireUserId(req), params.gymId, params.entryId, body, editGate(req, reply));
    return sendWrite(req, reply, answer);
  });

  app.delete("/v1/orgs/:gymId/member-list/entries/:entryId", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(memberListEntryParamsSchema, req.params, req, reply);
    if (params === null) return;
    return sendWrite(req, reply, await byHand.takeOff(listDeps, requireUserId(req), params.gymId, params.entryId, editGate(req, reply)));
  });

  app.post("/v1/orgs/:gymId/member-list/entries/:entryId/restore", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(memberListEntryParamsSchema, req.params, req, reply);
    if (params === null) return;
    return sendWrite(req, reply, await byHand.restore(listDeps, requireUserId(req), params.gymId, params.entryId, editGate(req, reply)));
  });

  app.post("/v1/orgs/:gymId/member-list/entries/:entryId/merge", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(memberListEntryParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(memberListMergeRequestSchema, req.body, req, reply);
    if (body === null) return;
    const answer = await byHand.mergeEntries(
      listDeps,
      requireUserId(req),
      params.gymId,
      params.entryId,
      body.keepEntryId,
      body.acknowledgeLeavesList ?? false,
      editGate(req, reply),
    );
    return sendWrite(req, reply, answer);
  });

  app.post(
    "/v1/orgs/:gymId/member-list/entries/from-member/:userId",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const params = parseOr400(memberParamsSchema, req.params, req, reply);
      if (params === null) return;
      const answer = await byHand.putMemberOnList(listDeps, requireUserId(req), params.gymId, params.userId, editGate(req, reply));
      return sendWrite(req, reply, answer);
    },
  );

  app.delete("/v1/orgs/:gymId/member-list/former/:entryId", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(memberListEntryParamsSchema, req.params, req, reply);
    if (params === null) return;
    const deleted = await byHand.deleteFormer(listDeps, requireUserId(req), params.gymId, params.entryId, editGate(req, reply));
    if (deleted === null) return;
    return reply.status(200).send(deleted);
  });

  app.get("/v1/orgs/:gymId/member-list/unlisted", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const query = parseOr400(memberListUnlistedQuerySchema, req.query, req, reply);
    if (query === null) return;
    const page = await byHand.readUnlisted(listDeps, requireUserId(req), params.gymId, query, readGate(req, reply));
    if (page === null) return;
    return reply.status(200).send({ page });
  });

  // ── Invite (3b-i-a; §9.12) ──

  /** Pressing Invite: 30 an hour each, 120 from one address (the front desk). */
  const inviteGate = gate(
    createDualRateLimit({
      name: "memberlist_invite",
      max: 30,
      ipMax: 120,
      windowMs: 60 * 60 * 1000,
      identifier: (req) => req.authUser?.id ?? null,
      redis: deps.redis,
    }),
  );

  app.get("/v1/orgs/:gymId/member-list/invites/preview", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const query = parseOr400(memberInvitePreviewQuerySchema, req.query, req, reply);
    if (query === null) return;
    const preview = await invites.previewInvite(listDeps, requireUserId(req), params.gymId, query, readGate(req, reply));
    if (preview === null) return;
    return reply.status(200).send({ preview });
  });

  app.post("/v1/orgs/:gymId/member-list/invites", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(memberInviteRequestSchema, req.body, req, reply);
    if (body === null) return;
    try {
      const invited = await invites.pressInvite(listDeps, requireUserId(req), params.gymId, body, inviteGate(req, reply));
      if (invited === null) return;
      return await reply.status(200).send({ invited });
    } catch (err) {
      if (!(err instanceof invites.InviteChanged)) throw err;
      return await reply.status(409).send({
        error: "invite_changed",
        message: MEMBER_INVITE_WORDS.invite_changed,
        preview: err.preview,
        requestId: req.id,
      });
    }
  });

  // Invitations that came back "Not me" (3b-ii-b; §10.2): the addresses to check.
  app.get("/v1/orgs/:gymId/member-list/not-me", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const items = await invites.notMeList(listDeps, requireUserId(req), params.gymId, readGate(req, reply));
    if (items === null) return;
    return reply.status(200).send({ items });
  });

  app.post("/v1/orgs/:gymId/member-list/entries/:entryId/invite", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(memberListEntryParamsSchema, req.params, req, reply);
    if (params === null) return;
    const invite = await invites.inviteOne(listDeps, requireUserId(req), params.gymId, params.entryId, editGate(req, reply));
    if (invite === null) return;
    return reply.status(200).send({ invite });
  });

  app.post(
    "/v1/orgs/:gymId/member-list/entries/:entryId/invite/resend",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const params = parseOr400(memberListEntryParamsSchema, req.params, req, reply);
      if (params === null) return;
      const invite = await invites.inviteAgain(listDeps, requireUserId(req), params.gymId, params.entryId, editGate(req, reply));
      if (invite === null) return;
      return reply.status(200).send({ invite });
    },
  );

  app.post("/v1/orgs/:gymId/member-list/remove-unlisted", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(memberListRemoveUnlistedRequestSchema, req.body, req, reply);
    if (body === null) return;
    const answer = await byHand.removeUnlisted(listDeps, requireUserId(req), params.gymId, body, removeGate(req, reply));
    switch (answer.kind) {
      case "rate_limited":
        return;
      case "removed":
        return reply
          .status(200)
          .send({ removed: { group: answer.group, removed: answer.removed, alreadyRemoved: answer.alreadyRemoved } });
      case "list_changed":
        return reply.status(409).send({
          error: "list_changed",
          message: MEMBER_LIST_BY_HAND_WORDS.list_changed,
          version: answer.version,
          total: answer.total,
          digest: answer.digest,
          requestId: req.id,
        });
      case "large_change":
        return reply.status(409).send({
          error: "large_change",
          message: MEMBER_LIST_BY_HAND_WORDS.large_change,
          removing: answer.removing,
          of: answer.of,
          requestId: req.id,
        });
    }
  });

  // ── Remove by status (5b-iii; RULINGS 2026-09-23) ──

  app.get("/v1/orgs/:gymId/member-list/remove-by-words", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const query = parseOr400(memberListByWordsQuerySchema, req.query, req, reply);
    if (query === null) return;
    const page = await byHand.readByWords(listDeps, requireUserId(req), params.gymId, query, readGate(req, reply));
    if (page === null) return;
    return reply.status(200).send({ page });
  });

  // One allowance with "Remove all": both take people out of the gym in one press.
  app.post("/v1/orgs/:gymId/member-list/remove-by-words", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(memberListRemoveByWordsRequestSchema, req.body, req, reply);
    if (body === null) return;
    const answer = await byHand.removeByWords(listDeps, requireUserId(req), params.gymId, body, removeGate(req, reply));
    switch (answer.kind) {
      case "rate_limited":
        return;
      case "removed":
        return reply.status(200).send({ removed: { removed: answer.removed, alreadyRemoved: answer.alreadyRemoved } });
      case "list_changed":
        return reply.status(409).send({
          error: "list_changed",
          message: MEMBER_LIST_BY_HAND_WORDS.list_changed,
          version: answer.version,
          total: answer.total,
          digest: answer.digest,
          requestId: req.id,
        });
      case "large_change":
        return reply.status(409).send({
          error: "large_change",
          message: MEMBER_LIST_BY_HAND_WORDS.large_change,
          removing: answer.removing,
          of: answer.of,
          requestId: req.id,
        });
    }
  });

  // ── The CSV export (5b-iii; §9.9) ──

  /** A download holds every person the filters show: 20 an hour each, 60 from one
   *  address (the front desk). */
  const exportGate = gate(
    createDualRateLimit({
      name: "memberlist_export",
      max: 20,
      ipMax: 60,
      windowMs: 60 * 60 * 1000,
      identifier: (req) => req.authUser?.id ?? null,
      redis: deps.redis,
    }),
  );

  app.get("/v1/orgs/:gymId/member-list/export.csv", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const query = parseOr400(memberListExportQuerySchema, req.query, req, reply);
    if (query === null) return;
    const file = await exporter.exportList(listDeps, requireUserId(req), params.gymId, query, exportGate(req, reply));
    if (file === null) return;
    return reply
      .status(200)
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="${file.filename}"`)
      .header("cache-control", "no-store")
      .send(Readable.from(file.chunks));
  });
}
