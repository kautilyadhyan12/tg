// UPLOAD A MEMBER FILE AND SEE WHAT IT WOULD DO — Part 3 §9.6–§9.9, ROADMAP
// Stage 2 item 3a-iii, first half.
//
// **THE WHOLE POINT OF THIS HALF IS THAT IT CHANGES NOTHING.** An upload is
// STAGED and answered with a preview: not one person is added to the list, taken
// off it, or emailed. That is §9.2's rule 10 — staff see what would happen before
// it happens — and it is what makes a wrong file a five-second mistake instead of
// a gym's whole membership. The confirm that does change things is the next card,
// and nothing here is reachable from outside without `members.confirm`.
//
// **READING A GYM'S LIST NEEDS `members.confirm`, NOT `members.read`** (§9.9).
// The list holds the name, email address and phone number of people who have
// never opened this app and never agreed to anything. `members.read` is the
// roster of people who joined — a much smaller promise — and the two are not the
// same secret, so a trainer who may see the roster may not see this.
//
// **THE ORDER OF THE GATES IS THE RULEBOOK'S, NOT THE MODULE'S HABIT** (CLAUDE.md
// §4: authenticate → privilege → entitlement → rate limit → handler). Every other
// route in this module hangs its limiter on the route as a preHandler, which puts
// it BEFORE the privilege check; here the limiter is called from inside the
// handler, after the gate. Two reasons, and the first is the rule: a stranger's
// 404 and a trainer's 403 must not spend the front desk's own allowance. The
// second is this route in particular — reading a file costs a worker, 5 MiB and up
// to fifteen seconds, so the cheap refusals belong in front of the limiter as well
// as in front of the work.
import { createHash } from "node:crypto";
import type { Sql } from "postgres";
import {
  MEMBER_FILE_MAX_BYTES,
  MEMBER_FILE_PARSE_TIMEOUT_MS,
  MEMBER_LIST_PARSES_PER_GYM,
  MEMBER_LIST_ROWS_PAGE,
  MEMBER_LIST_UPLOAD_GONE_WORDS,
  MEMBER_LIST_UPLOAD_TTL_MINUTES,
  memberFileRefusalWords,
  type MemberFileRefusal,
  type MemberListMapping,
  type MemberListMode,
  type MemberListPreview,
  type MemberListRowGroup,
  type MemberListRowsPage,
  type MemberListStagedFile,
  type MemberListUploadSummary,
} from "@app/shared";
import type { RedisLike } from "../../../redis.js";
import * as orgRepo from "../repo.js";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import { understandMemberFile } from "./parseMemberFile.js";
import { reconcile, type Reconciled } from "./reconcile.js";
import * as repo from "./repo.js";

export interface MemberListDeps {
  sql: Sql;
  redis: RedisLike;
  /** Narrowed to what this module actually says: the one warn it can emit when
   *  the reader gate fails open. Structural, so `app.log` satisfies it and an
   *  operator tool needs no cast to stand in for a whole Fastify logger. */
  log: { warn: (obj: object, msg: string) => void };
  /** THE CLOCK, INJECTED. A staged upload's hour, and whether one has run out,
   *  are the only times this module asks what time it is — and a test that cannot
   *  move the clock can only prove the expiry by waiting an hour. */
  now: () => Date;
  /** The reader, so a test can stand in for the worker where what it is proving
   *  is the route and not the parsing. Production passes nothing. */
  read?: typeof understandMemberFile;
}

/** A file refusal as this route answers it. 400 for everything the uploader can
 *  fix by uploading a different file, and 429 for `busy`, which is the server
 *  asking to be asked again — a 400 there would tell staff their file was wrong
 *  when it was not. */
function refuse(refusal: MemberFileRefusal): OrgsError {
  const status = refusal.code === "busy" ? 429 : 400;
  return new OrgsError(status, refusal.code, memberFileRefusalWords(refusal));
}

/** ONE FILE PER GYM AT A TIME (§9.9), beside the two a server process.
 *
 *  Redis rather than the process's own counter, because two files of one gym can
 *  land on two servers; the counter is the same primitive the rate limiters use,
 *  so there is no new mechanism to reason about. Its window is the parse timeout
 *  plus a second: a reader that dies without releasing its place must not lock a
 *  gym out for longer than a file could ever have taken.
 *
 *  **REDIS DOWN FAILS OPEN, LOUDLY**, exactly as the rate limiters do: the
 *  per-process ceiling of two still stands, and refusing every gym's upload
 *  because a cache blinked would be a worse answer than reading two files. */
async function withOneReaderPerGym<T>(deps: MemberListDeps, gymId: string, work: () => Promise<T>): Promise<T> {
  const key = `mlist:reading:${gymId}`;
  const seconds = Math.ceil(MEMBER_FILE_PARSE_TIMEOUT_MS / 1000) + 1;
  const count = await deps.redis.incrWithTtl(key, seconds);
  if (count === null) {
    deps.log.warn({ event: "memberlist.reader_gate_open_redis_down", gymId }, "member-list reader gate failing open");
    return await work();
  }
  try {
    if (count > MEMBER_LIST_PARSES_PER_GYM) throw refuse({ code: "busy" });
    return await work();
  } finally {
    await deps.redis.decrIfPositive(key);
  }
}

interface Against {
  reconciled: Reconciled;
  seatCap: number | null;
  liveMembers: number;
  /** The sha256 of the file the gym last CONFIRMED, so "you have applied this
   *  file already" is answered from the list's own state and not from a guess. */
  lastFileSha256: string | null;
}

/** THE THREE SETS, FETCHED ONCE, AND THE RULE RUN OVER THEM. Everything a preview
 *  says about the list comes through here, so the POST that stages an upload and
 *  the GET that reads it back cannot answer differently. */
async function against(
  deps: MemberListDeps,
  gymId: string,
  file: MemberListStagedFile,
  mode: MemberListMode,
): Promise<Against> {
  const [state, entries, members, seatCap] = await Promise.all([
    repo.listState(deps.sql, gymId),
    repo.listEntries(deps.sql, gymId),
    repo.listMembers(deps.sql, gymId),
    orgRepo.gymSeatCap(deps.sql, gymId),
  ]);
  return {
    reconciled: reconcile({ rows: file.rows, entries, members, mode, hasList: state !== null }),
    seatCap,
    // The members the rule was handed ARE the gym's live, paid-for members — the
    // seat rule's own three conditions (`repo.listMembers`). Counting them again
    // in SQL would be a second answer to one question.
    liveMembers: members.length,
    lastFileSha256: state?.lastFileSha256 ?? null,
  };
}

/** THE PREVIEW, ASSEMBLED — everything the file said, everything the list said,
 *  and nothing worked out twice. Written once and called by both routes, which is
 *  what stops the answer drifting between the upload and a second look at it. */
function assemble(input: {
  mode: MemberListMode;
  expiresAt: Date;
  fileSha256: string;
  file: MemberListStagedFile;
  against: Against;
}): Omit<MemberListPreview, "uploadId"> {
  const { reconciled } = input.against;
  const { file } = input;
  return {
    mode: input.mode,
    expiresAt: input.expiresAt.toISOString(),
    sameAsLastUpload: input.against.lastFileSha256 === input.fileSha256,
    kind: file.kind,
    facts: file.facts,
    sheet: file.sheet,
    headerRow: file.headerRow,
    columns: file.columns,
    mapping: file.mapping,
    needsMapping: file.needsMapping,
    file: file.counts,
    list: reconciled.counts,
    statuses: reconciled.statuses,
    members: reconciled.members,
    skipped: file.skipped,
    warnings: file.warnings,
    seat: {
      cap: input.against.seatCap,
      liveMembers: input.against.liveMembers,
      // What the list would BE, not what it is: the number staff are deciding
      // about. An add keeps everybody already on it; a whole list is the file.
      listSize:
        input.mode === "add"
          ? reconciled.guard.listSize + reconciled.counts.new
          : reconciled.counts.new + reconciled.counts.changed + reconciled.counts.unchanged,
    },
    guard: reconciled.guard,
  };
}

const summaryOf = (preview: Omit<MemberListPreview, "uploadId">): MemberListUploadSummary => ({
  file: preview.file,
  list: preview.list,
  statuses: preview.statuses,
  members: preview.members,
  guard: preview.guard,
  needsMapping: preview.needsMapping,
});

export interface PreviewInput {
  contentBase64: string;
  mode: MemberListMode;
  /** Staff's own mapping. Sent, nothing is guessed (§9.5). */
  mapping?: MemberListMapping | undefined;
}

/** STAGE AN UPLOAD AND ANSWER WHAT IT WOULD DO. Writes one row — the staged
 *  upload — and touches nothing about anybody's membership.
 *
 *  `limit` is the rate limiter, handed in by the route and called HERE rather
 *  than hung on the route, so it sits after the privilege gate (the file header
 *  says why). It answers false when it has already sent its own 429, and the
 *  handler then has nothing left to do. */
export async function previewUpload(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  input: PreviewInput,
  limit: () => Promise<boolean>,
): Promise<MemberListPreview | null> {
  // Privilege and the live plan first: an upload stages a row, so it is a write,
  // and a gym with no plan is read-only for every member of staff (Kd, 2026-08-29).
  const { org } = await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;

  // The base64 is checked AS base64 before it is decoded, on the photo route's own
  // precedent: `Buffer.from` never throws, it drops what it cannot read, so
  // without this a body of punctuation would arrive as a shorter, different file
  // and be refused for the wrong reason.
  if (input.contentBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.contentBase64)) {
    throw new OrgsError(400, "invalid_upload", "That file didn't arrive in one piece. Try uploading it again.");
  }
  const bytes = Buffer.from(input.contentBase64, "base64");
  if (bytes.length === 0) throw refuse({ code: "empty_file" });
  if (bytes.length > MEMBER_FILE_MAX_BYTES) throw refuse({ code: "too_big" });

  const state = await repo.listState(deps.sql, gymId);
  // The mapping this gym's last confirmed upload used, offered to the reader for
  // the headings it was made for. A gym whose headings we cannot read is exactly
  // the gym that mapped them by hand, and it must not do that every month (§9.5).
  const remembered =
    state !== null && state.lastMapping !== null && state.lastHeaderFingerprint !== null
      ? { fingerprint: state.lastHeaderFingerprint, mapping: state.lastMapping }
      : null;

  const read = deps.read ?? understandMemberFile;
  const understood = await withOneReaderPerGym(deps, gymId, () =>
    read(bytes, { country: org.country, mapping: input.mapping ?? null, remembered }),
  );
  if (!understood.ok) throw refuse(understood.refusal);

  const fileSha256 = createHash("sha256").update(bytes).digest("hex");
  const expiresAt = new Date(deps.now().getTime() + MEMBER_LIST_UPLOAD_TTL_MINUTES * 60_000);
  const measured = await against(deps, gymId, understood, input.mode);
  const body = assemble({ mode: input.mode, expiresAt, fileSha256, file: understood, against: measured });

  const uploadId = await repo.stageUpload(deps.sql, {
    gymId,
    uploadedByUserId: userId,
    mode: input.mode,
    fileKind: understood.kind,
    fileSha256,
    fileBytes: bytes.length,
    headerFingerprint: understood.headerFingerprint,
    mapping: understood.mapping,
    baseVersion: state?.version ?? 0,
    // The record is the answer staff read, assembled once: a summary worked out
    // separately would be a second opinion about one file.
    summary: summaryOf(body),
    file: understood,
    expiresAt,
  });
  return { uploadId, ...body };
}

/** The staged upload of this gym, or the sentence saying why there is none.
 *  Reading a preview is a READ, so it is not held back by the gym's plan (§4.2's
 *  read-only console): what a gym that stopped paying cannot do is change things,
 *  and nothing is hidden from it. */
async function stagedOr409(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  uploadId: string,
  limit: () => Promise<boolean>,
): Promise<(repo.UploadRow & { file: MemberListStagedFile }) | null> {
  await requirePrivilege(deps, gymId, userId, "members.confirm");
  // After the gate, never before it (the file header says why): a stranger's 404
  // and a trainer's 403 must not spend the front desk's own allowance.
  if (!(await limit())) return null;
  const upload = await repo.uploadFor(deps.sql, gymId, uploadId, deps.now());
  // NOT FOUND AND NOT THIS GYM'S ARE ONE ANSWER, deliberately: the id is a uuid
  // somebody may simply hold, and telling them it exists somewhere else is the
  // whole leak this module is built to prevent.
  if (upload === null) throw new OrgsError(404, "upload_not_found", "That upload could not be found.");
  if (upload.status !== "staged" || upload.file === null) {
    const gone =
      upload.status === "confirmed"
        ? "upload_already_confirmed"
        : upload.status === "superseded"
          ? "upload_superseded"
          : "upload_expired";
    throw new OrgsError(409, gone, MEMBER_LIST_UPLOAD_GONE_WORDS[gone]);
  }
  return { ...upload, file: upload.file };
}

/** READ A STAGED PREVIEW BACK. It is worked out AGAIN over the list as it stands,
 *  never read out of the stored summary: the summary is the record of what was
 *  first shown, and what staff need on a second look is what the file would do
 *  NOW. Nothing in this half can move the list between the two, and the confirm
 *  that can is refused by its own version check (§9.7). */
export async function readPreview(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  uploadId: string,
  limit: () => Promise<boolean>,
): Promise<MemberListPreview | null> {
  const upload = await stagedOr409(deps, userId, gymId, uploadId, limit);
  if (upload === null) return null;
  const measured = await against(deps, gymId, upload.file, upload.mode);
  return {
    uploadId: upload.id,
    ...assemble({
      mode: upload.mode,
      expiresAt: upload.expiresAt,
      fileSha256: upload.fileSha256,
      file: upload.file,
      against: measured,
    }),
  };
}

/** THE NAMES BEHIND ONE NUMBER, one page at a time — the thing that makes a
 *  preview worth having (§9.9: "the names behind every number, before anyone
 *  confirms"). A screen shows counts first and a person's address only when staff
 *  ask for it, which is why this is a route of its own and not part of the
 *  preview. */
export async function readPreviewRows(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  uploadId: string,
  group: MemberListRowGroup,
  cursor: number,
  limit: () => Promise<boolean>,
): Promise<MemberListRowsPage | null> {
  const upload = await stagedOr409(deps, userId, gymId, uploadId, limit);
  if (upload === null) return null;
  const { reconciled } = await against(deps, gymId, upload.file, upload.mode);
  const people =
    group === "new"
      ? reconciled.new
      : group === "changed"
        ? reconciled.changed
        : group === "unchanged"
          ? reconciled.unchanged
          : group === "gone"
            ? reconciled.gone
            : reconciled.membersLeaving;
  const page = people.slice(cursor, cursor + MEMBER_LIST_ROWS_PAGE);
  return {
    group,
    total: people.length,
    // The identity key is deliberately NOT sent. It is the list's own handle on a
    // person and a screen has no use for it; what staff read is who this is.
    people: page.map((person) => ({
      row: person.row,
      fullName: person.fullName,
      email: person.email,
      phone: person.phone,
      memberNumber: person.memberNumber,
      status: person.status,
      wasStatus: person.wasStatus,
      inApp: person.inApp,
    })),
    cursor: cursor + page.length < people.length ? cursor + page.length : null,
  };
}
