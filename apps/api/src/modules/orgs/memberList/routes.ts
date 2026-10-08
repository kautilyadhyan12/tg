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
  MEMBER_LIST_SELECTION_CHANGED_WORDS,
  memberInvitePeopleQuerySchema,
  memberInvitePreviewQuerySchema,
  memberInviteRequestSchema,
  memberInviteSelectedPeopleRequestSchema,
  memberInviteSelectedPreviewRequestSchema,
  memberListConfirmRequestSchema,
  memberListLeaversRequestSchema,
  memberListEntriesQuerySchema,
  memberListEntryInputSchema,
  memberListEntryPatchSchema,
  memberListExportRequestSchema,
  memberListMergeRequestSchema,
  memberListNotThemRequestSchema,
  memberListReviewCheckedRequestSchema,
  memberListReviewQuerySchema,
  memberListDuplicatesQuerySchema,
  memberListNotDuplicatesRequestSchema,
  memberListRemovePreviewRequestSchema,
  memberListRemoveSelectedRequestSchema,
  memberListRemoveUnlistedRequestSchema,
  memberListRowsQuerySchema,
  memberListSelectAllRequestSchema,
  memberListUnlistedQuerySchema,
  memberListUploadRequestSchema,
  memberNoteAddRequestSchema,
  memberTagAddRequestSchema,
  memberTagRenameRequestSchema,
  memberTagsSelectedRequestSchema,
  memberRosterRemovePreviewRequestSchema,
  memberRosterRemoveRequestSchema,
  MEMBER_REMOVE_CHANGED_WORDS,
  MEMBER_REMOVE_LARGE_WORDS,
  PT_SESSIONS_ENDING_ERROR,
  confirmPtSessionsQuerySchema,
} from "@app/shared";
import { PtSessionsEndAsk } from "../pt/changes.js";
import type { RedisLike } from "../../../redis.js";
import { createDualRateLimit } from "../../auth/rateLimit.js";
import {
  gymTagParamsSchema,
  memberListEntryParamsSchema,
  memberListParamsSchema,
  memberNoteParamsSchema,
  memberParamsSchema,
  memberTagParamsSchema,
  orgParamsSchema,
} from "../schemas.js";
import { invitePeople } from "../invites/people.js";
import * as invites from "../invites/service.js";
import type { InviteSettings } from "../invites/settings.js";
import * as byHand from "./byHandService.js";
import * as duplicates from "./duplicates.js";
import * as exporter from "./exportCsv.js";
import * as notes from "./notes.js";
import * as tags from "./tags.js";
import * as removal from "./removeSelected.js";
import { SelectionChanged, selectAll } from "./selection.js";
import * as service from "./service.js";

/** A "Select all" whose filter now matches other people: nothing was done (§18.5). */
function sendSelectionChanged(err: SelectionChanged, req: FastifyRequest, reply: FastifyReply): FastifyReply {
  return reply.status(409).send({
    error: "selection_changed",
    message: MEMBER_LIST_SELECTION_CHANGED_WORDS,
    count: err.now.count,
    digest: err.now.digest,
    requestId: req.id,
  });
}

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
    // here is a member list. A check of our own says its own sentence, which holds none.
    void reply.status(400).send({
      error: "validation_error",
      message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.code === "custom" ? i.message : i.code}`).join("; "),
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

/** Notes and tags one member of staff may write in an hour: 200 people, a few presses each. */
export const MEMBER_NOTES_WRITES_PER_HOUR = 1200;

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


  /** Everyone a whole-list file leaves out, for staff to mark one by one (§18.8). */
  app.get("/v1/orgs/:gymId/member-list/uploads/:uploadId/missing", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(memberListParamsSchema, req.params, req, reply);
    if (params === null) return;
    const missing = await service.readMissing(listDeps, requireUserId(req), params.gymId, params.uploadId, readGate(req, reply));
    if (missing === null) return;
    return reply.status(200).send({ missing });
  });

  /** The box compares the whole file with the list, as a confirm does, so it has an
   *  allowance of its own rather than the page reads': 60 an hour each, 240 from one
   *  address (the front desk is one address with several staff). */
  const leaversLimit = createDualRateLimit({
    name: "memberlist_leavers",
    max: 60,
    ipMax: 240,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });
  const leaversGate = gate(leaversLimit);

  /** The box before an import with leavers: who moves, who loses the app, who keeps it. */
  app.post("/v1/orgs/:gymId/member-list/uploads/:uploadId/leavers", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(memberListParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(memberListLeaversRequestSchema, req.body ?? {}, req, reply);
    if (body === null) return;
    const leavers = await service.previewLeavers(listDeps, requireUserId(req), params.gymId, params.uploadId, body.marks, leaversGate(req, reply));
    if (leavers === null) return;
    return reply.status(200).send({ leavers });
  });

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
          marks: body.marks ?? null,
          leaversDigest: body.leaversDigest ?? null,
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
        case "marks_needed":
          return reply.status(409).send({
            error: "marks_needed",
            message: MEMBER_LIST_CONFIRM_REFUSAL_WORDS.marks_needed,
            requestId: req.id,
          });
        case "leavers_changed":
          // The new box, so the screen shows who would move and lose the app now.
          return reply.status(409).send({
            error: "leavers_changed",
            message: MEMBER_LIST_CONFIRM_REFUSAL_WORDS.leavers_changed,
            leavers: answer.leavers,
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

  /** It's correct (5b-v-d-iv): one press a problem, and an import can mark hundreds, so
   *  its own allowance rather than the edits'; several staff at one desk share an address. */
  const reviewGate = gate(
    createDualRateLimit({
      name: "memberlist_review",
      max: 600,
      ipMax: 2400,
      windowMs: 60 * 60 * 1000,
      identifier: (req) => req.authUser?.id ?? null,
      redis: deps.redis,
    }),
  );

  /** Notes and tags (5d-i): one press a tag a person, so a gym tagging its 200 people must
   *  not spend the allowance for adding and changing members; several staff at one desk
   *  share an address. */
  const notesGate = gate(
    createDualRateLimit({
      name: "memberlist_notes",
      max: MEMBER_NOTES_WRITES_PER_HOUR,
      ipMax: MEMBER_NOTES_WRITES_PER_HOUR * 4,
      windowMs: 60 * 60 * 1000,
      identifier: (req) => req.authUser?.id ?? null,
      redis: deps.redis,
    }),
  );

  /** Different people (5b-iv-a): one press a pair, and a gym's first look can hold hundreds,
   *  so its own allowance like It's correct; several staff at one desk share an address. */
  const differentGate = gate(
    createDualRateLimit({
      name: "memberlist_duplicates",
      max: 600,
      ipMax: 2400,
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
      case "may_be_on_list":
        return reply.status(409).send({
          error: "may_be_on_list",
          message: MEMBER_LIST_BY_HAND_WORDS.may_be_on_list,
          people: answer.people,
          requestId: req.id,
        });
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
    const query = parseOr400(confirmPtSessionsQuerySchema, req.query ?? {}, req, reply);
    if (query === null) return;
    try {
      const answer = await byHand.takeOff(listDeps, requireUserId(req), params.gymId, params.entryId, editGate(req, reply), query.confirmPtSessions ?? null);
      sendWrite(req, reply, answer);
      return;
    } catch (err) {
      // Their personal training sessions are named first (17e-iv-a); nothing was done.
      if (!(err instanceof PtSessionsEndAsk)) throw err;
      return reply.status(409).send({ error: PT_SESSIONS_ENDING_ERROR, message: err.message, sessions: err.sessions, requestId: req.id });
    }
  });

  app.post("/v1/orgs/:gymId/member-list/entries/:entryId/restore", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(memberListEntryParamsSchema, req.params, req, reply);
    if (params === null) return;
    return sendWrite(req, reply, await byHand.restore(listDeps, requireUserId(req), params.gymId, params.entryId, editGate(req, reply)));
  });

  // The review page (5b-v-d-iv): who an import found a problem with, a page at a time.
  app.get("/v1/orgs/:gymId/member-list/review", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const query = parseOr400(memberListReviewQuerySchema, req.query, req, reply);
    if (query === null) return;
    const page = await byHand.readReviewPage(listDeps, requireUserId(req), params.gymId, query, readGate(req, reply));
    if (page === null) return;
    return reply.status(200).send({ page });
  });

  // It's correct (5b-v-d-iv): one problem an import found, checked by staff and kept as it is.
  app.post("/v1/orgs/:gymId/member-list/entries/:entryId/review/checked", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(memberListEntryParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(memberListReviewCheckedRequestSchema, req.body, req, reply);
    if (body === null) return;
    const answer = await byHand.checkReview(listDeps, requireUserId(req), params.gymId, params.entryId, body, reviewGate(req, reply));
    if (answer.kind === "rate_limited") return;
    return reply.status(200).send({ entry: answer.entry });
  });

  // Possible duplicates (5b-iv-a): pairs alike by name, phone or member number, a page at a time.
  app.get("/v1/orgs/:gymId/member-list/duplicates", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const query = parseOr400(memberListDuplicatesQuerySchema, req.query, req, reply);
    if (query === null) return;
    const page = await duplicates.readDuplicatesPage(listDeps, requireUserId(req), params.gymId, query, readGate(req, reply));
    if (page === null) return;
    return reply.status(200).send({ page });
  });

  // Different people (5b-iv-a): a pair staff checked is two people, never listed again.
  app.post("/v1/orgs/:gymId/member-list/duplicates/different", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(memberListNotDuplicatesRequestSchema, req.body, req, reply);
    if (body === null) return;
    const answer = await duplicates.markDifferentPeople(listDeps, requireUserId(req), params.gymId, body.entryIds, differentGate(req, reply));
    if (answer.kind === "rate_limited") return;
    return reply.status(200).send({ duplicates: answer.duplicates });
  });

  // "Not this person" (§18.4): that one account out of the app, the record kept.
  app.post("/v1/orgs/:gymId/member-list/entries/:entryId/not-them", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(memberListEntryParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(memberListNotThemRequestSchema, req.body, req, reply);
    if (body === null) return;
    return sendWrite(req, reply, await byHand.notThisPerson(listDeps, requireUserId(req), params.gymId, params.entryId, body, editGate(req, reply)));
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

  // Staff notes and tags on a person's page (5d). Every answer is that person's notes and
  // tags as they now stand.
  app.get("/v1/orgs/:gymId/member-list/entries/:entryId/notes", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(memberListEntryParamsSchema, req.params, req, reply);
    if (params === null) return;
    const state = await notes.readNotesAndTags(listDeps, requireUserId(req), params.gymId, params.entryId, readGate(req, reply));
    if (state === null) return;
    return reply.status(200).send(state);
  });

  app.post("/v1/orgs/:gymId/member-list/entries/:entryId/notes", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(memberListEntryParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(memberNoteAddRequestSchema, req.body, req, reply);
    if (body === null) return;
    const state = await notes.addNote(listDeps, requireUserId(req), params.gymId, params.entryId, body, notesGate(req, reply));
    if (state === null) return;
    return reply.status(200).send(state);
  });

  app.delete("/v1/orgs/:gymId/member-list/entries/:entryId/notes/:noteId", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(memberNoteParamsSchema, req.params, req, reply);
    if (params === null) return;
    const state = await notes.deleteNote(listDeps, requireUserId(req), params.gymId, params.entryId, params.noteId, notesGate(req, reply));
    if (state === null) return;
    return reply.status(200).send(state);
  });

  app.post("/v1/orgs/:gymId/member-list/entries/:entryId/tags", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(memberListEntryParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(memberTagAddRequestSchema, req.body, req, reply);
    if (body === null) return;
    const state = await notes.addTag(listDeps, requireUserId(req), params.gymId, params.entryId, body.name, notesGate(req, reply));
    if (state === null) return;
    return reply.status(200).send(state);
  });

  app.delete("/v1/orgs/:gymId/member-list/entries/:entryId/tags/:tagId", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(memberTagParamsSchema, req.params, req, reply);
    if (params === null) return;
    const state = await notes.removeTag(listDeps, requireUserId(req), params.gymId, params.entryId, params.tagId, notesGate(req, reply));
    if (state === null) return;
    return reply.status(200).send(state);
  });

  // Tags on the Members list (5d-ii): the gym's tags with their counts, a tag for the
  // people selected, and a tag renamed or deleted.
  app.get("/v1/orgs/:gymId/member-list/tags", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const list = await tags.readGymTags(listDeps, requireUserId(req), params.gymId, readGate(req, reply));
    if (list === null) return;
    return reply.status(200).send({ tags: list });
  });

  app.post("/v1/orgs/:gymId/member-list/selected/tags-preview", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(memberTagsSelectedRequestSchema, req.body, req, reply);
    if (body === null) return;
    try {
      const preview = await tags.previewTagSelected(listDeps, requireUserId(req), params.gymId, body, readGate(req, reply));
      if (preview === null) return;
      return await reply.status(200).send({ preview });
    } catch (err) {
      if (err instanceof SelectionChanged) return await sendSelectionChanged(err, req, reply);
      throw err;
    }
  });

  app.post("/v1/orgs/:gymId/member-list/selected/tags", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(memberTagsSelectedRequestSchema, req.body, req, reply);
    if (body === null) return;
    try {
      const answer = await tags.tagSelected(listDeps, requireUserId(req), params.gymId, body, notesGate(req, reply));
      if (answer === null) return;
      return await reply.status(200).send(answer);
    } catch (err) {
      if (err instanceof SelectionChanged) return await sendSelectionChanged(err, req, reply);
      throw err;
    }
  });

  app.patch("/v1/orgs/:gymId/member-list/tags/:tagId", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(gymTagParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(memberTagRenameRequestSchema, req.body, req, reply);
    if (body === null) return;
    const list = await tags.renameTag(listDeps, requireUserId(req), params.gymId, params.tagId, body.name, notesGate(req, reply));
    if (list === null) return;
    return reply.status(200).send({ tags: list });
  });

  app.delete("/v1/orgs/:gymId/member-list/tags/:tagId", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(gymTagParamsSchema, req.params, req, reply);
    if (params === null) return;
    const list = await tags.deleteTag(listDeps, requireUserId(req), params.gymId, params.tagId, notesGate(req, reply));
    if (list === null) return;
    return reply.status(200).send({ tags: list });
  });

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

  /** Invite's page: who these filters would email, or leave out and why (§18.6). */
  app.get("/v1/orgs/:gymId/member-list/invites/people", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const query = parseOr400(memberInvitePeopleQuerySchema, req.query, req, reply);
    if (query === null) return;
    const page = await invitePeople(listDeps, requireUserId(req), params.gymId, query, readGate(req, reply));
    if (page === null) return;
    return reply.status(200).send({ page });
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
      if (err instanceof SelectionChanged) return await sendSelectionChanged(err, req, reply);
      if (!(err instanceof invites.InviteChanged)) throw err;
      return await reply.status(409).send({
        error: "invite_changed",
        message: MEMBER_INVITE_WORDS.invite_changed,
        preview: err.preview,
        requestId: req.id,
      });
    }
  });

  // ── The people selected (5b-v-b-i; §18.5) ──

  /** "Select all": who the filter matches now, as a count and a digest. */
  app.post("/v1/orgs/:gymId/member-list/selection", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(memberListSelectAllRequestSchema, req.body, req, reply);
    if (body === null) return;
    const selection = await selectAll(listDeps, requireUserId(req), params.gymId, body, readGate(req, reply));
    if (selection === null) return;
    return reply.status(200).send({ selection });
  });

  /** Invite's numbers for the people selected. */
  app.post("/v1/orgs/:gymId/member-list/selected/invite-preview", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(memberInviteSelectedPreviewRequestSchema, req.body, req, reply);
    if (body === null) return;
    try {
      const preview = await invites.previewInvite(listDeps, requireUserId(req), params.gymId, body, readGate(req, reply));
      if (preview === null) return;
      return await reply.status(200).send({ preview });
    } catch (err) {
      if (err instanceof SelectionChanged) return await sendSelectionChanged(err, req, reply);
      throw err;
    }
  });

  /** Invite's page for the people selected. */
  app.post("/v1/orgs/:gymId/member-list/selected/invite-people", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(memberInviteSelectedPeopleRequestSchema, req.body, req, reply);
    if (body === null) return;
    try {
      const page = await invitePeople(listDeps, requireUserId(req), params.gymId, body, readGate(req, reply));
      if (page === null) return;
      return await reply.status(200).send({ page });
    } catch (err) {
      if (err instanceof SelectionChanged) return await sendSelectionChanged(err, req, reply);
      throw err;
    }
  });

  /** A download holds people's details: 20 an hour each, 60 from one address (the front
   *  desk, several staff). */
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

  /** Download CSV of the people selected. */
  app.post("/v1/orgs/:gymId/member-list/export.csv", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(memberListExportRequestSchema, req.body, req, reply);
    if (body === null) return;
    try {
      const file = await exporter.exportSelected(listDeps, requireUserId(req), params.gymId, body, exportGate(req, reply));
      if (file === null) return;
      return await reply
        .status(200)
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", exporter.contentDisposition(file.filename))
        .header("cache-control", "no-store")
        .send(Readable.from(file.chunks));
    } catch (err) {
      if (err instanceof SelectionChanged) return await sendSelectionChanged(err, req, reply);
      throw err;
    }
  });

  // ── Remove the people selected (5b-v-b-ii; §18.5, §18.6) ──

  /** Remove on the people selected: 30 presses an hour each, 120 from one address (the front
   *  desk, several staff); its own allowance, so a desk clearing leavers a page at a time
   *  never spends that of "Remove all". */
  const removeSelectedGate = gate(
    createDualRateLimit({
      name: "memberlist_remove_selected",
      max: 30,
      ipMax: 120,
      windowMs: 60 * 60 * 1000,
      identifier: (req) => req.authUser?.id ?? null,
      redis: deps.redis,
    }),
  );

  /** The press's answer: done, or nothing done and the box as it is now. */
  const sendRemoval = (req: FastifyRequest, reply: FastifyReply, answer: removal.RemoveSelectedAnswer): FastifyReply | undefined => {
    switch (answer.kind) {
      case "rate_limited":
        return undefined;
      case "removed":
        return reply.status(200).send({ removed: answer.removed });
      case "changed":
        return reply.status(409).send({ error: "remove_changed", message: MEMBER_REMOVE_CHANGED_WORDS, preview: answer.preview, requestId: req.id });
      case "large_change":
        return reply.status(409).send({ error: "large_change", message: MEMBER_REMOVE_LARGE_WORDS, preview: answer.preview, requestId: req.id });
    }
  };

  /** The box for the records selected on "Your list" or "Past members". */
  app.post("/v1/orgs/:gymId/member-list/selected/remove-preview", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(memberListRemovePreviewRequestSchema, req.body, req, reply);
    if (body === null) return;
    try {
      const preview = await removal.previewRemoveSelected(listDeps, requireUserId(req), params.gymId, body, readGate(req, reply));
      if (preview === null) return;
      return await reply.status(200).send({ preview });
    } catch (err) {
      if (err instanceof SelectionChanged) return await sendSelectionChanged(err, req, reply);
      throw err;
    }
  });

  /** Remove the records selected: each to past members, and their app ended. */
  app.post("/v1/orgs/:gymId/member-list/selected/remove", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(memberListRemoveSelectedRequestSchema, req.body, req, reply);
    if (body === null) return;
    let answer: removal.RemoveSelectedAnswer;
    try {
      answer = await removal.removeSelected(listDeps, requireUserId(req), params.gymId, body, removeSelectedGate(req, reply));
    } catch (err) {
      if (err instanceof SelectionChanged) return await sendSelectionChanged(err, req, reply);
      throw err;
    }
    return sendRemoval(req, reply, answer);
  });

  /** The box for the people ticked on "In the app". */
  app.post("/v1/orgs/:gymId/members/selected/remove-preview", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(memberRosterRemovePreviewRequestSchema, req.body, req, reply);
    if (body === null) return;
    const preview = await removal.previewRemoveRoster(listDeps, requireUserId(req), params.gymId, body, readGate(req, reply));
    if (preview === null) return;
    return reply.status(200).send({ preview });
  });

  /** Remove the people ticked on "In the app": their app ended, their own record moved. */
  app.post("/v1/orgs/:gymId/members/selected/remove", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(memberRosterRemoveRequestSchema, req.body, req, reply);
    if (body === null) return;
    return sendRemoval(req, reply, await removal.removeRoster(listDeps, requireUserId(req), params.gymId, body, removeSelectedGate(req, reply)));
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
}
