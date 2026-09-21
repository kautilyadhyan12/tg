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
import type { Sql, TransactionSql } from "postgres";
import {
  isLargeMemberListChange,
  MEMBER_FILE_MAX_BYTES,
  MEMBER_FILE_PARSE_TIMEOUT_MS,
  MEMBER_LIST_ENTRIES_PAGE,
  MEMBER_LIST_PARSES_PER_GYM,
  MEMBER_LIST_ROWS_PAGE,
  MEMBER_LIST_UPLOAD_GONE_WORDS,
  MEMBER_LIST_UPLOAD_TTL_MINUTES,
  memberFileRefusalWords,
  memberListStagedShellSchema,
  type MemberFileRefusal,
  type MemberListConfirmed,
  type MemberListCounts,
  type MemberListEntriesPage,
  type MemberListEntriesQuery,
  type MemberListGuard,
  type MemberListMapping,
  type MemberListMode,
  type MemberListPreview,
  type MemberListRowGroup,
  type MemberListRowsPage,
  type MemberListGroups,
  type MemberListPreviewPerson,
  type MemberListSeat,
  type MemberListStagedFile,
  type MemberListStagedShell,
  type MemberListStoredPerson,
  type MemberListUnderstanding,
  type MemberListUploadSummary,
  type MemberListView,
} from "@app/shared";
import type { RedisLike } from "../../../redis.js";
import { insertAudit } from "../repo.js";
import * as orgRepo from "../repo.js";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import { decodeEntryCursor, encodeEntryCursor } from "./cursor.js";
import { understandMemberFile } from "./parseMemberFile.js";
import { inviteCounts, membersAgainstNewList, reconcile, type Reconciled, type ReconciledPerson } from "./reconcile.js";
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

/** WHAT AN UPLOAD WOULD DO, and where the answer came from.
 *
 *  **THERE ARE TWO PATHS AND THE FAST ONE IS ALMOST ALWAYS THE RIGHT ONE.** A
 *  preview is worked out once, when the file is staged, against the list at that
 *  moment — the version it was measured against is stored on the upload. While the
 *  list has not moved, that answer is not a cache that might be wrong: it IS the
 *  answer, and reading it back costs one small query. Only when the list HAS moved
 *  — a confirm, or somebody typed a person in — is it stale, and then the whole
 *  comparison is run again from the stored rows, which is the expensive path and
 *  the rare one. */
interface Measured {
  counts: MemberListUploadSummary;
  seat: MemberListSeat;
  lastFileSha256: string | null;
}

/** THE THREE SETS, FETCHED ONCE, AND THE RULE RUN OVER THEM (§9.7). It answers the
 *  counts AND the whole reconciled answer — the grouping, the rows the rule kept and
 *  the groups themselves — because a grouping stored beside rows it does not match
 *  would name the wrong people, and the confirm writes from the same answer the
 *  preview shows.
 *
 *  **IT TAKES AN EXECUTOR AND NOT `deps`, SO THE CONFIRM CAN RUN IT INSIDE ITS OWN
 *  TRANSACTION.** The API's Postgres pool is one connection: a query sent on
 *  `deps.sql` while a transaction holds that connection waits for the transaction,
 *  which is waiting for the query. Passing `tx` in is what makes the rule's three
 *  sets the ones the lock is holding still, rather than a second, later read. */
async function measure(
  sql: Sql | TransactionSql,
  gymId: string,
  understanding: MemberListUnderstanding,
  mode: MemberListMode,
  state: repo.ListState | null,
): Promise<{ measured: Measured; reconciled: Reconciled }> {
  const [entries, members, seatCap] = await Promise.all([
    repo.listEntries(sql, gymId),
    repo.listMembers(sql, gymId),
    orgRepo.gymSeatCap(sql, gymId),
  ]);
  const reconciled = reconcile({
    rows: understanding.rows,
    entries,
    members,
    mode,
    hasList: state !== null,
  });
  const counts: MemberListUploadSummary = {
    file: understanding.counts,
    list: reconciled.counts,
    statuses: reconciled.statuses,
    members: reconciled.members,
    guard: reconciled.guard,
    needsMapping: understanding.needsMapping,
    seat: {
      cap: seatCap,
      // The members the rule was handed ARE the gym's live, paid-for members — the
      // seat rule's own three conditions (`repo.listMembers`). Counting them again
      // in SQL would be a second answer to one question.
      liveMembers: members.filter((member) => member.seatCounted).length,
      // What the list would BE, not what it is: the number staff are deciding about.
      // An add keeps everybody already on it; a whole list is the file.
      listSize:
        mode === "add"
          ? reconciled.guard.listSize + reconciled.counts.new
          : reconciled.counts.new + reconciled.counts.changed + reconciled.counts.unchanged,
    },
  };
  return {
    measured: { counts, seat: counts.seat, lastFileSha256: state?.lastFileSha256 ?? null },
    reconciled,
  };
}

/** The grouping, as it is stored beside the rows (`memberListGroupsSchema`): a place
 *  and two derived values for everybody in the file, and the people the file does not
 *  hold written out as they will be shown. */
function groupsOf(reconciled: Reconciled): MemberListGroups {
  const inFile = (people: readonly ReconciledPerson[]) =>
    people.map((person) => ({
      // Everybody in these three groups came out of a row, so the index is there.
      // `?? 0` would quietly put the first person of the file in somebody else's
      // place, so a missing one is a fault of this module and says so.
      at: person.at ?? raise(`a person of the file has no place in it (upload's ${String(person.row)})`),
      wasStatus: person.wasStatus,
    }));
  // Somebody coming off the list is the GYM's own record of them, and is stored. Not
  // `inApp`: that is a fact about one of the gym's members and is filled in on every
  // read, like every other member fact (review of PR #87, High-1).
  return {
    new: inFile(reconciled.new),
    changed: inFile(reconciled.changed),
    unchanged: inFile(reconciled.unchanged),
    gone: reconciled.gone.map((person) => ({
      row: person.row,
      fullName: person.fullName,
      email: person.email,
      phone: person.phone,
      memberNumber: person.memberNumber,
      status: person.status,
      wasStatus: person.wasStatus,
    })),
  };
}

/** WHETHER SOMEBODY IS ALREADY IN THE APP, worked out from the gym's own members as
 *  they are right now. Two sets and a lookup: the one question every count about the
 *  app's side of a preview turns on. */
function reachedBy(members: readonly repo.MemberAgainstList[]): (person: { email: string | null; phone: string | null }) => boolean {
  const emails = new Set<string>();
  const phones = new Set<string>();
  for (const member of members) {
    const email = (member.email ?? "").trim().toLowerCase();
    if (email !== "") emails.add(email);
    const phone = (member.statedPhone ?? "").trim();
    if (phone !== "") phones.add(phone);
  }
  return (person) => {
    const email = (person.email ?? "").trim().toLowerCase();
    if (email !== "" && emails.has(email)) return true;
    const phone = (person.phone ?? "").trim();
    return phone !== "" && phones.has(phone);
  };
}

/** EVERYTHING A PREVIEW SAYS ABOUT THE GYM'S OWN MEMBERS, worked out fresh.
 *
 *  Called on every read of a staged preview, and never read out of the store. It takes
 *  the file's contacts by place (`repo.stagedContacts`) and the gym's members with
 *  what its list says about each of them (`repo.membersAgainstList`), and answers the
 *  member half of the counts, the guard and the leaving group — through the same pure
 *  rule the stage used (`membersAgainstNewList`). */
async function freshMemberSide(
  deps: MemberListDeps,
  gymId: string,
  upload: repo.UploadRow,
  groups: MemberListGroups,
  stored: MemberListUploadSummary,
  state: repo.ListState | null,
): Promise<{
  counts: MemberListUploadSummary;
  membersLeaving: MemberListPreviewPerson[];
  inApp: (person: { email: string | null; phone: string | null }) => boolean;
} | null> {
  const [contacts, members, seatCap] = await Promise.all([
    repo.stagedContacts(deps.sql, gymId, upload.id),
    repo.membersAgainstList(deps.sql, gymId),
    orgRepo.gymSeatCap(deps.sql, gymId),
  ]);
  if (contacts === null) return null;
  const inApp = reachedBy(members);
  const personAt = (at: number) => ({ email: contacts.emails[at] ?? null, phone: contacts.phones[at] ?? null });
  // A member is on the list AFTER this upload when the file reaches them — or, for an
  // add, when the list already did, because an add takes nobody off. Exactly what
  // `reconcile` derives from the rows it holds; here the rows are two arrays of strings.
  const fileEmails = new Set(contacts.emails.flatMap((e) => (e === null ? [] : [e.trim().toLowerCase()])));
  const filePhones = new Set(contacts.phones.flatMap((p) => (p === null ? [] : [p.trim()])));
  const side = membersAgainstNewList(
    // The seat rule's own set: §9.7 keeps the owner and the staff out of "no longer
    // listed". "Already in the app" is asked of every live member, just above.
    members.filter((member) => member.seatCounted),
    (member) => {
      const email = (member.email ?? "").trim().toLowerCase();
      if (email !== "" && fileEmails.has(email)) return true;
      const phone = (member.statedPhone ?? "").trim();
      if (phone !== "" && filePhones.has(phone)) return true;
      return upload.mode === "add" && member.onList;
    },
    state !== null,
  );
  // THE SAME RULE THE STAGING USED, not a second way of counting the same people
  // (review of PR #87, High-A). `inviteCounts` is where both answers come from, so the
  // upload and a second look at it cannot say different things about one person.
  const counts: MemberListUploadSummary = {
    ...stored,
    list: {
      ...stored.list,
      ...inviteCounts(
        groups.new.map((row) => {
          const person = personAt(row.at);
          return { email: person.email, inApp: inApp(person) };
        }),
      ),
    },
    members: { leaving: side.membersLeaving.length, listedNow: side.listedNow },
    guard: {
      ...stored.guard,
      membersLeaving: side.membersLeaving.length,
      membersListedNow: side.listedNow,
      needsTick:
        isLargeMemberListChange(stored.guard.entriesGoing, stored.guard.listSize) ||
        isLargeMemberListChange(side.membersLeaving.length, side.listedNow),
    },
    seat: { ...stored.seat, cap: seatCap, liveMembers: members.filter((member) => member.seatCounted).length },
  };
  return {
    counts,
    membersLeaving: side.membersLeaving.map((person) => ({
      row: person.row,
      fullName: person.fullName,
      email: person.email,
      phone: person.phone,
      memberNumber: person.memberNumber,
      status: person.status,
      wasStatus: person.wasStatus,
      inApp: true,
    })),
    inApp,
  };
}

function raise(message: string): never {
  throw new Error(message);
}

/** THE PREVIEW, ASSEMBLED — the file's small parts and the answer about the list,
 *  from wherever that answer came. Written once and used by both routes, which is
 *  what stops them drifting apart. */
function assemble(input: {
  mode: MemberListMode;
  expiresAt: Date;
  fileSha256: string;
  shell: MemberListStagedShell;
  measured: Measured;
}): Omit<MemberListPreview, "uploadId"> {
  const { shell, measured } = input;
  return {
    mode: input.mode,
    expiresAt: input.expiresAt.toISOString(),
    sameAsLastUpload: measured.lastFileSha256 === input.fileSha256,
    kind: shell.kind,
    facts: shell.facts,
    sheet: shell.sheet,
    headerRow: shell.headerRow,
    columns: shell.columns,
    mapping: shell.mapping,
    needsMapping: shell.needsMapping,
    file: measured.counts.file,
    list: measured.counts.list,
    statuses: measured.counts.statuses,
    members: measured.counts.members,
    skipped: shell.skipped,
    warnings: shell.warnings,
    seat: measured.seat,
    guard: measured.counts.guard,
  };
}

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
  // The rule drops any row whose person is on an earlier one, and the grouping
  // points into what it KEPT — so the rows stored are the rule's own, never the
  // reader's, or a stored place would name somebody who was never on the list.
  const { measured, reconciled } = await measure(deps.sql, gymId, understood, input.mode, state);
  const file: MemberListStagedFile = {
    understanding: { ...understood, rows: reconciled.rows },
    groups: groupsOf(reconciled),
  };
  const body = assemble({ mode: input.mode, expiresAt, fileSha256, shell: shellOf(file), measured });

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
    summary: measured.counts,
    file,
    expiresAt,
  });
  return { uploadId, ...body };
}

/** The file's small parts — everything the server understood of it EXCEPT the rows,
 *  which is what a preview is built from. The same shape `repo.stagedShell` reads back
 *  out of the database, written here for the path that has the whole thing in hand. */
const shellOf = (file: MemberListStagedFile): MemberListStagedShell =>
  memberListStagedShellSchema.parse(file.understanding);

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
): Promise<repo.UploadRow | null> {
  await requirePrivilege(deps, gymId, userId, "members.confirm");
  // After the gate, never before it (the file header says why): a stranger's 404
  // and a trainer's 403 must not spend the front desk's own allowance.
  if (!(await limit())) return null;
  const upload = await repo.uploadFor(deps.sql, gymId, uploadId, deps.now());
  // NOT FOUND AND NOT THIS GYM'S ARE ONE ANSWER, deliberately: the id is a uuid
  // somebody may simply hold, and telling them it exists somewhere else is the
  // whole leak this module is built to prevent.
  if (upload === null) throw new OrgsError(404, "upload_not_found", "That upload could not be found.");
  if (upload.status !== "staged" || !upload.hasCells) {
    const gone =
      upload.status === "confirmed"
        ? "upload_already_confirmed"
        : upload.status === "superseded"
          ? "upload_superseded"
          : "upload_expired";
    throw new OrgsError(409, gone, MEMBER_LIST_UPLOAD_GONE_WORDS[gone]);
  }
  return upload;
}

const expired = (): OrgsError =>
  new OrgsError(409, "upload_expired", MEMBER_LIST_UPLOAD_GONE_WORDS.upload_expired);

/** WHAT A READ WORKS FROM.
 *
 *  **The FILE-versus-LIST half comes from the store while the list has not moved**, and
 *  the list's own version says when it has — a confirm or a typed-in person, nothing
 *  else. That half is the expensive one (every row against every entry), and its
 *  freshness question has exactly one answer.
 *
 *  **The MEMBERS' half is always worked out again**, because nothing a gym does to its
 *  list moves when a member joins, proves an address, gives the gym a number or leaves
 *  (review of PR #87, High-1). */
interface Read {
  shell: MemberListStagedShell;
  groups: MemberListGroups;
  /** The whole file, and only where the list has MOVED. A page must be cut out of the
   *  same grouping the counts came from: on the slow path that grouping was just worked
   *  out in this process and the stored one is about a list that no longer exists, so
   *  asking the database for a page would answer a different question from the one the
   *  preview answered (caught by the test that pins the two together). */
  file: MemberListStagedFile | null;
  counts: MemberListUploadSummary;
  membersLeaving: MemberListPreviewPerson[];
  inApp: (person: { email: string | null; phone: string | null }) => boolean;
  lastFileSha256: string | null;
}

async function readStaged(deps: MemberListDeps, gymId: string, upload: repo.UploadRow): Promise<Read> {
  const state = await repo.listState(deps.sql, gymId);
  const moved = (state?.version ?? 0) !== upload.baseVersion;
  if (!moved) {
    // THE FAST PATH, and the one every screen takes: everything but the rows, which the
    // database drops before the answer crosses to this process, plus the members' half
    // worked out fresh from two small statements.
    const [shell, groups] = await Promise.all([
      repo.stagedShell(deps.sql, gymId, upload.id),
      repo.stagedGroups(deps.sql, gymId, upload.id),
    ]);
    if (shell === null || groups === null) throw expired();
    const side = await freshMemberSide(deps, gymId, upload, groups, upload.summary, state);
    if (side === null) throw expired();
    return {
      shell,
      groups,
      file: null,
      counts: side.counts,
      membersLeaving: side.membersLeaving,
      inApp: side.inApp,
      lastFileSha256: state?.lastFileSha256 ?? null,
    };
  }
  // THE LIST HAS MOVED, so the stored file-versus-list answer is about a list that no
  // longer exists and the whole comparison runs again over the stored rows.
  const file = await repo.stagedFile(deps.sql, gymId, upload.id);
  if (file === null) throw expired();
  const { measured, reconciled } = await measure(deps.sql, gymId, file.understanding, upload.mode, state);
  const groups = groupsOf(reconciled);
  const side = await freshMemberSide(deps, gymId, upload, groups, measured.counts, state);
  if (side === null) throw expired();
  return {
    shell: shellOf(file),
    groups,
    file,
    counts: side.counts,
    membersLeaving: side.membersLeaving,
    inApp: side.inApp,
    lastFileSha256: measured.lastFileSha256,
  };
}

/** READ A STAGED PREVIEW BACK. */
export async function readPreview(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  uploadId: string,
  limit: () => Promise<boolean>,
): Promise<MemberListPreview | null> {
  const upload = await stagedOr409(deps, userId, gymId, uploadId, limit);
  if (upload === null) return null;
  const read = await readStaged(deps, gymId, upload);
  return {
    uploadId: upload.id,
    ...assemble({
      mode: upload.mode,
      expiresAt: upload.expiresAt,
      fileSha256: upload.fileSha256,
      shell: read.shell,
      measured: { counts: read.counts, seat: read.counts.seat, lastFileSha256: read.lastFileSha256 },
    }),
  };
}

/** One page of a group, cut in this process out of a grouping just worked out — the same
 *  merge `repo.stagedPage` asks the database for, for the path where the answer is
 *  already in hand. */
function cutHere(read: Read, group: MemberListRowGroup, cursor: number): { total: number; people: MemberListStoredPerson[] } {
  const file = read.file;
  if (file === null) raise("cutHere was called without the file it cuts from");
  if (group === "gone") {
    return { total: read.groups.gone.length, people: read.groups.gone.slice(cursor, cursor + MEMBER_LIST_ROWS_PAGE) };
  }
  const places = group === "new" ? read.groups.new : group === "changed" ? read.groups.changed : read.groups.unchanged;
  const people = places.slice(cursor, cursor + MEMBER_LIST_ROWS_PAGE).map((place) => {
    const row = file.understanding.rows[place.at];
    if (row === undefined) raise(`a group names row ${String(place.at)}, which the file does not hold`);
    return {
      row: row.row,
      fullName: row.fullName,
      email: row.email,
      phone: row.phone,
      memberNumber: row.memberNumber,
      status: row.status,
      wasStatus: place.wasStatus,
    };
  });
  return { total: places.length, people };
}

/** THE NAMES BEHIND ONE NUMBER, one page at a time — the thing that makes a preview
 *  worth having (§9.9: "the names behind every number, before anyone confirms"). A
 *  screen shows counts first and a person's address only when staff ask for it, which is
 *  why this is a route of its own and not part of the preview. */
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
  const read = await readStaged(deps, gymId, upload);

  // THE GYM'S OWN MEMBERS ABOUT TO BE MARKED AS DROPPED OFF are not in the file and are
  // not stored: they were worked out a moment ago, so this group is cut here.
  if (group === "members_leaving") {
    const page = read.membersLeaving.slice(cursor, cursor + MEMBER_LIST_ROWS_PAGE);
    return {
      group,
      total: read.membersLeaving.length,
      people: page,
      cursor: cursor + page.length < read.membersLeaving.length ? cursor + page.length : null,
    };
  }

  // ON THE SLOW PATH the grouping was worked out a moment ago in this process, so the
  // page is cut from THAT, never from the stored one — which is about a list that no
  // longer exists and would answer a different question from the counts just shown.
  const picked =
    read.file === null
      ? await repo.stagedPage(deps.sql, gymId, upload.id, group, cursor, MEMBER_LIST_ROWS_PAGE)
      : cutHere(read, group, cursor);
  if (picked === null) throw expired();
  // A hundred rows out of the stored file, with "already in the app" answered from the
  // gym's members AS THEY ARE NOW. Every person on a page carries their own address and
  // number, whichever group they came from, so one answer serves all four groups and
  // nothing has to be looked up by place.
  const people = picked.people.map((person) => ({ ...person, inApp: read.inApp(person) }));
  return {
    group,
    total: picked.total,
    people,
    cursor: cursor + people.length < picked.total ? cursor + people.length : null,
  };
}

// ── PRESSING CONFIRM, AND THE LIST YOU KEEP (3a-iii-b; §9.7–§9.9) ───────────
//
// **THIS IS THE HALF THAT CHANGES A GYM'S RECORDS**, and everything above it exists
// so that by the time anybody presses this button they have already seen what it
// will do. Three things make it safe, and none of them is the preview:
//
//   1. The gym's row is LOCKED for the whole of it, so two staff pressing at the
//      same moment apply once and a member joining cannot slip into the middle.
//   2. The rule is worked out AGAIN, under that lock, on the list as it is at that
//      instant — the preview is what staff READ, never what is applied.
//   3. The list's version has to be the one the preview was measured against, or
//      nothing is written and staff are told (§9.8's `list_changed`).
//
// **AND NOBODY IS EMAILED.** Not one message, whatever the file holds: the gym's
// invite is its own decision and its own button (§9.2 rule 10, RULINGS 2026-09-19).

/** What pressing Confirm came to. Four answers rather than three exceptions,
 *  because two of them carry NUMBERS a screen has to show — how much would go, or
 *  which version we measured against — and an error message is a bad place to put
 *  a number somebody has to act on. */
export type ConfirmAnswer =
  | { kind: "confirmed"; confirmed: MemberListConfirmed }
  | { kind: "list_changed"; baseVersion: number; version: number }
  | { kind: "large_change"; guard: MemberListGuard }
  /** The limiter has answered 429 itself and the handler is finished. */
  | { kind: "rate_limited" };

/** The answer a confirm gives when its upload was ALREADY applied — read back out of
 *  the upload's own record rather than worked out again.
 *
 *  **IT IS A 200 AND IT IS THE SAME SENTENCE AS THE FIRST PRESS.** A screen whose
 *  reply was lost, or two staff pressing one button, must not read "that file has
 *  already been applied" as a failure — nothing is wrong, and the numbers they need
 *  are the ones the confirm actually applied, which is exactly what it wrote into
 *  `summary` on its way out.
 *
 *  `version` is the list's version NOW and not this upload's, because that is what a
 *  later removal has to name; `confirmedAt` is this upload's own instant, which
 *  `gym_member_lists.last_confirmed_at` would not be once the gym has confirmed
 *  anything since. */
function storedAnswer(upload: repo.UploadRow, version: number): MemberListConfirmed {
  if (upload.confirmedAt === null) {
    // `(status = 'confirmed') = (confirmed_at IS NOT NULL)` is a CHECK on the table,
    // so this is a state the database forbids. Loud rather than a made-up instant.
    throw new Error(`member-list upload ${upload.id} is confirmed with no instant`);
  }
  return {
    uploadId: upload.id,
    alreadyConfirmed: true,
    version,
    confirmedAt: upload.confirmedAt.toISOString(),
    applied: upload.summary.list,
    statuses: upload.summary.statuses,
    members: upload.summary.members,
  };
}

/** A person of the file as the list stores them. The identity key is the rule's, not
 *  built again here: two ways of deciding who one person is would be two lists. */
const toEntry = (person: ReconciledPerson): repo.EntryToWrite => ({
  fullName: person.fullName,
  email: person.email,
  phone: person.phone,
  memberNumber: person.memberNumber,
  status: person.status,
  identityKey: person.identityKey,
});

/** APPLY A STAGED UPLOAD TO THE GYM'S LIST — the one transaction that writes it.
 *
 *  **EVERY STATEMENT INSIDE USES `tx` AND NOT `deps.sql`, AND THAT IS NOT A STYLE
 *  POINT.** The API's Postgres pool is ONE connection: a query sent on `deps.sql`
 *  while this transaction holds it would wait for the transaction, which is waiting
 *  for the query — the whole API stopped, not just this request.
 *
 *  **THE PRIVILEGE GATE AND THE LIMITER COME BEFORE THE TRANSACTION**, which is
 *  CLAUDE.md §4's order and also keeps the gym's row lock held for the shortest time
 *  it can be: nothing that can refuse this request cheaply happens inside the lock. */
export async function confirmUpload(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  uploadId: string,
  input: { acknowledgeLargeChange: boolean },
  limit: () => Promise<boolean>,
): Promise<ConfirmAnswer> {
  await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return { kind: "rate_limited" };
  const at = deps.now();

  const answer = await deps.sql.begin(async (tx): Promise<ConfirmAnswer> => {
    // THE MODULE'S LOCK ORDER: the gym's row, then the child rows (§9.7). The join
    // door takes this same row, which is what makes a join and a confirm unable to
    // interleave — a member cannot appear half-way through the rule being worked out.
    await repo.lockGym(tx, gymId);
    const upload = await repo.lockUploadFor(tx, gymId, uploadId, at);
    // NOT FOUND AND NOT THIS GYM'S ARE ONE ANSWER, as everywhere else in this module.
    if (upload === null) throw new OrgsError(404, "upload_not_found", "That upload could not be found.");

    const before = await repo.listState(tx, gymId);
    if (upload.status === "confirmed") return { kind: "confirmed", confirmed: storedAnswer(upload, before?.version ?? 0) };
    if (upload.status !== "staged" || !upload.hasCells) {
      const gone = upload.status === "superseded" ? "upload_superseded" : "upload_expired";
      throw new OrgsError(409, gone, MEMBER_LIST_UPLOAD_GONE_WORDS[gone]);
    }

    // THE PREVIEW HAS TO BE ABOUT THE LIST THAT IS STILL THERE. Anything that moves
    // the list — an earlier confirm, somebody typed in — moves the version, and what
    // staff read is then an answer about a list that no longer exists. Refused with
    // both numbers, and NOTHING is written.
    const version = before?.version ?? 0;
    if (version !== upload.baseVersion) {
      return { kind: "list_changed", baseVersion: upload.baseVersion, version };
    }

    const file = await repo.stagedFile(tx, gymId, uploadId);
    if (file === null) throw expired();

    // THE RULE, RUN AGAIN, ON WHAT IS TRUE NOW. Not the stored grouping: that one is
    // about the list at `base_version`, and although the version says it has not
    // moved, the gym's own MEMBERS have no version at all — somebody joined, proved
    // an address or left while the preview was on the screen, and who is "already in
    // the app" moved with them (review of PR #87, High-1).
    const { measured, reconciled } = await measure(tx, gymId, file.understanding, upload.mode, before);

    // THE WRONG-FILE GUARD (§9.8), measured on THIS answer and ticked on THIS
    // request. A gym that acknowledged a large change an hour ago has acknowledged
    // nothing about this press, which is why the tick is a field of the request and
    // never a flag on the upload.
    if (reconciled.guard.needsTick && !input.acknowledgeLargeChange) {
      return { kind: "large_change", guard: reconciled.guard };
    }

    // THREE STATEMENTS, EACH THE SAME SIZE WHATEVER THE FILE HOLDS, each safe to run
    // twice. What each one did is checked against what the rule said it would: under
    // this lock they cannot differ, so a difference is a fault of ours, and a confirm
    // that cannot say truthfully what it applied writes nothing at all.
    const added = await repo.insertEntries(tx, gymId, reconciled.new.map(toEntry), "upload");
    expectApplied(added, reconciled.new.length, "added", uploadId);
    const updated = await repo.updateEntryStatuses(
      tx,
      gymId,
      reconciled.changed.map((person) => ({ identityKey: person.identityKey, status: person.status })),
    );
    expectApplied(updated, reconciled.changed.length, "changed", uploadId);
    const removed = await repo.deleteEntries(tx, gymId, reconciled.gone.map((person) => person.identityKey));
    expectApplied(removed, reconciled.gone.length, "removed", uploadId);

    // "THIS GYM HAS YOU ON ITS LIST, AS OF NOW" — on everybody the old list held or
    // the new one does, so what the preview called "no longer listed" still reads
    // that way after the confirm instead of falling back to "never listed".
    await repo.stampListed(tx, gymId, reconciled.onEitherList, at);

    // The version moves only when something actually changed (§9.7): bumping it for a
    // confirm that wrote nothing would throw away every other preview open in the gym
    // for no reason, and the same file uploaded twice is exactly that case.
    const bump = added + updated + removed > 0;
    const after = await repo.moveListOn(tx, { gymId, uploadId, at, bump });
    // The cells go in the same statement that marks it confirmed, and `summary`
    // becomes what was APPLIED rather than what the preview guessed.
    await repo.markUploadConfirmed(tx, { gymId, uploadId, at, summary: measured.counts });

    // COUNTS ONLY (§9.7). An audit row of this is read by a human weeks later asking
    // what happened to a gym's list; a name or an address on it would be a person's
    // own data in a table nothing purges.
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.member_list_confirmed",
      targetType: "member_list_upload",
      targetId: uploadId,
      meta: {
        mode: upload.mode,
        added: String(added),
        updated: String(updated),
        removed: String(removed),
        unchanged: String(reconciled.counts.unchanged),
        membersLeaving: String(reconciled.members.leaving),
        version: String(after),
        ...(input.acknowledgeLargeChange ? { acknowledgedLargeChange: "true" } : {}),
      },
    });

    // NOTHING ABOVE SENDS AN EMAIL, and a test drives it: the capturing sender stays
    // empty through a confirm that adds two hundred people.
    return {
      kind: "confirmed",
      confirmed: {
        uploadId,
        alreadyConfirmed: false,
        version: after,
        confirmedAt: at.toISOString(),
        applied: reconciled.counts,
        statuses: reconciled.statuses,
        members: reconciled.members,
      },
    };
  });

  // A confirm bulk-loads a gym's people into a table whose statistics may still say
  // it holds almost nothing, and the planner then costs the per-member lookup behind
  // every read of that list against a table it believes is empty. **What that is
  // worth, measured, is in `repo.analyseEntries`'s own note and is not repeated
  // here** — one number in one place (CLAUDE.md §4). It is a modest win bought
  // cheaply, not a rescue.
  //
  // AFTER THE COMMIT, so the gym's row lock is already released; and HOUSEKEEPING, so
  // it is warned about and never fails a confirm that has already been applied.
  if (answer.kind === "confirmed" && !answer.confirmed.alreadyConfirmed && changedAnything(answer.confirmed)) {
    try {
      await repo.analyseEntries(deps.sql);
    } catch (err) {
      deps.log.warn(
        { event: "memberlist.analyse_failed", gymId, error: err instanceof Error ? err.name : "unknown" },
        "member list entries could not be analysed after a confirm",
      );
    }
  }
  return answer;
}

/** Whether a confirm actually wrote a row. Nothing written means the statistics are
 *  as true as they were a moment ago. */
const changedAnything = (done: MemberListConfirmed): boolean =>
  done.applied.new > 0 || done.applied.changed > 0 || done.applied.gone > 0;

/** What a statement did, against what the rule said it would. Loud, with no cell in
 *  the message — the numbers are counts and the id is an upload's. */
/** WHAT A STATEMENT DID, CHECKED AGAINST WHAT THE RULE SAID IT WOULD.
 *
 *  **NO ROUTE CAN DRIVE THIS AND THAT IS THE POINT OF IT** (review of PR #88): the
 *  rule and the three statements run inside ONE transaction holding the gym's row, so
 *  under that lock they cannot differ, and the file's own duplicates are folded by the
 *  rule before the INSERT ever sees them. It is here for the case that is left — a
 *  fault of OURS — where the alternative is reporting a number that is not what
 *  happened. So it is exported and pinned directly, rather than claimed by a route
 *  test that would stay green with the calls deleted. */
export function expectApplied(did: number, said: number, what: string, uploadId: string): void {
  if (did === said) return;
  throw new Error(
    `member-list upload ${uploadId} ${what} ${String(did)} entries where the rule said ${String(said)}`,
  );
}

/** WHICH OF THE GYM'S OWN ENTRIES ARE ALREADY MEMBERS HERE — the entry ids, deduped.
 *
 *  One member matches at most one entry (§9.7's order, `membersAgainstList`), and two
 *  members can land on the same entry — a household on one address — so the ids are
 *  put through a Set before anything counts them. Counting `members.length` instead
 *  would say a gym of two has two people on a list that holds one. */
function inAppEntryIds(members: readonly repo.MemberAgainstList[]): string[] {
  const ids = new Set<string>();
  for (const member of members) if (member.entryId !== null) ids.add(member.entryId);
  return [...ids];
}

/** THE LIST AS IT STANDS (§9.9's `GET /`).
 *
 *  Reading it is a READ, so a gym with no live plan still gets it: what a gym that
 *  stopped paying cannot do is CHANGE things, and nothing is hidden from it (§4.2's
 *  read-only console). It still needs `members.confirm` and not `members.read` — it
 *  holds the addresses of people who never opened this app. */
export async function readList(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  limit: () => Promise<boolean>,
): Promise<MemberListView | null> {
  await requirePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  const [state, members] = await Promise.all([
    repo.listState(deps.sql, gymId),
    repo.membersAgainstList(deps.sql, gymId),
  ]);
  const { totals, statuses } = await repo.listStatusCounts(deps.sql, gymId, inAppEntryIds(members));
  // THE WHOLE-LIST NUMBERS AND THE CHIPS COME FROM ONE STATEMENT, never two: two
  // statements counting one gym's people two ways is two answers to one question, and
  // the screen would show both at once.
  //
  // **They are no longer the chips ADDED UP, and that is the fix, not a tidy-up.** The
  // chips have a ceiling and these numbers must not — adding up the capped rows made a
  // gym past the ceiling read "200 people" above a list of 205, with `canBeInvited`
  // short by the truncated groups (review of PR #88, High-3). The sum now happens
  // inside the statement, before the cut.
  const counts: MemberListCounts = totals;
  return {
    hasList: state !== null,
    version: state?.version ?? 0,
    lastConfirmedAt: state?.lastConfirmedAt?.toISOString() ?? null,
    counts,
    statuses: statuses.map((row) => ({
      label: row.label,
      count: row.count,
      inApp: row.inApp,
      canBeInvited: row.canBeInvited,
    })),
  };
}

/** A search as LIKE reads it. The three characters LIKE gives its own meaning to are
 *  escaped, so a member number of `10%` finds that member and not every member. */
const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (char) => `\\${char}`);

/** ONE PAGE OF THE LIST THE GYM KEEPS (§9.9's `GET /entries`).
 *
 *  **A PAGE IS FETCHED ONE LONGER THAN IT IS SHOWN**, which is how "is there a next
 *  page" is answered without a second count and without ever offering staff a cursor
 *  that leads to an empty page. */
export async function readEntries(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  query: MemberListEntriesQuery,
  limit: () => Promise<boolean>,
): Promise<MemberListEntriesPage | null> {
  await requirePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;

  // Parsed, not trusted, and not quietly ignored either: a cursor that does not
  // decode is a 400, never "start again from the top", which would silently restart
  // somebody's walk through ten thousand names.
  const cursor = query.cursor === undefined ? null : decodeEntryCursor(query.cursor);
  if (query.cursor !== undefined && cursor === null) {
    throw new OrgsError(400, "bad_cursor", "That page of the list could not be read. Open the list again.");
  }

  // A status is matched with its case and spaces folded, exactly as the rule folds
  // one, and "" is the people with no status at all (§9.9).
  const asked = query.status === undefined ? null : Array.isArray(query.status) ? query.status : [query.status];
  const statuses = asked === null ? null : [...new Set(asked.map((word) => word.trim().toLowerCase()))];
  const typed = (query.query ?? "").trim();

  const members = await repo.membersAgainstList(deps.sql, gymId);
  const page = await repo.entriesPage(deps.sql, {
    gymId,
    inAppEntryIds: inAppEntryIds(members),
    statuses,
    filter: query.filter ?? "all",
    like: typed === "" ? null : `%${escapeLike(typed)}%`,
    cursor,
    limit: MEMBER_LIST_ENTRIES_PAGE + 1,
  });
  const shown = page.entries.slice(0, MEMBER_LIST_ENTRIES_PAGE);
  const last = page.entries.length > MEMBER_LIST_ENTRIES_PAGE ? shown[shown.length - 1] : undefined;
  return {
    total: page.total,
    entries: shown.map((entry) => ({
      entryId: entry.entryId,
      fullName: entry.fullName,
      email: entry.email,
      phone: entry.phone,
      memberNumber: entry.memberNumber,
      status: entry.status,
      source: entry.source,
      inApp: entry.inApp,
    })),
    cursor: last === undefined ? null : encodeEntryCursor({ name: last.fullName, id: last.entryId }),
  };
}
