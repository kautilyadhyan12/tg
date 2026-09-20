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
  isLargeMemberListChange,
  MEMBER_FILE_MAX_BYTES,
  MEMBER_FILE_PARSE_TIMEOUT_MS,
  MEMBER_LIST_PARSES_PER_GYM,
  MEMBER_LIST_ROWS_PAGE,
  MEMBER_LIST_UPLOAD_GONE_WORDS,
  MEMBER_LIST_UPLOAD_TTL_MINUTES,
  memberFileRefusalWords,
  memberListStagedShellSchema,
  type MemberFileRefusal,
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
} from "@app/shared";
import type { RedisLike } from "../../../redis.js";
import * as orgRepo from "../repo.js";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
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
 *  counts, the grouping, AND the rows the rule kept — the three together, because a
 *  grouping stored beside rows it does not match would name the wrong people. */
async function measure(
  deps: MemberListDeps,
  gymId: string,
  understanding: MemberListUnderstanding,
  mode: MemberListMode,
  state: repo.ListState | null,
): Promise<{ measured: Measured; groups: MemberListGroups; rows: MemberListUnderstanding["rows"] }> {
  const [entries, members, seatCap] = await Promise.all([
    repo.listEntries(deps.sql, gymId),
    repo.listMembers(deps.sql, gymId),
    orgRepo.gymSeatCap(deps.sql, gymId),
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
      liveMembers: members.length,
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
    groups: groupsOf(reconciled),
    rows: reconciled.rows,
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
    members,
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
    seat: { ...stored.seat, cap: seatCap, liveMembers: members.length },
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
  const { measured, groups, rows } = await measure(deps, gymId, understood, input.mode, state);
  const file: MemberListStagedFile = { understanding: { ...understood, rows }, groups };
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
  const { measured, groups } = await measure(deps, gymId, file.understanding, upload.mode, state);
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
