// LEADS FROM A FILE (ROADMAP 20c-iii; spec Part 3 §16.3).
//
// The worst thing this could do to a real person: somebody in a gym's spreadsheet
// starts getting follow-up emails they never agreed to. So a lead from a file is
// inserted New with NO "Happy to hear from us" and no follow-up due, whatever the file
// says — the insert below has no column for either. Next worst: one gym's file read
// against, or written into, another gym's leads — every statement has the gym in its
// WHERE, and the gate is the leads' own (`members.confirm`, a live plan to write).
//
// Check reads the file and says who would be added; nothing is written. Add reads the
// same file again and, under the gym's lock, adds exactly the leads Check showed — the
// `expected` key — or nothing at all.
import {
  LEAD_FILE_CHANGED_ERROR,
  LEAD_FILE_WORDS,
  LEADS_MAX_PER_GYM,
  MEMBER_FILE_MAX_BYTES,
  leadFileRefusalWords,
  type LeadFileAddRequest,
  type LeadFileCheckRequest,
  type LeadFileMapping,
  type LeadFileNotAdded,
  type LeadFilePerson,
  type LeadFilePreview,
  type LeadFileResult,
  type LeadFileRow,
  type LeadFileUnderstanding,
  type MemberFileRefusal,
} from "@app/shared";
import type { Sql } from "postgres";
import type { RedisLike } from "../../../redis.js";
import { insertAudit } from "../repo.js";
import { OrgsError, requireWritablePrivilege } from "../service.js";
import { readLeadFile } from "../memberList/parseMemberFile.js";
import { lockGym } from "../memberList/repo.js";
import { withOneReaderPerGym } from "../memberList/service.js";
import { leadFilePlan, planKey, type LeadFilePlan } from "./filePlan.js";
import * as repo from "./repo.js";

export interface LeadFileDeps {
  sql: Sql;
  redis: RedisLike;
  log: { warn: (obj: object, msg: string) => void };
  /** The reader, so a route test can stand in for the worker. Production passes nothing. */
  read?: typeof readLeadFile;
  /** Runs after Add has read the file and before it takes the gym's lock; a test
   *  changes the leads here to reach the check made under the lock. */
  beforeAddLock?: () => Promise<void>;
}

type Limit = () => Promise<boolean>;

/** 400 for a file staff can fix; 429 for `busy`, which is the server asking to be
 *  asked again. */
function refuse(refusal: MemberFileRefusal): OrgsError {
  return new OrgsError(refusal.code === "busy" ? 429 : 400, refusal.code, leadFileRefusalWords(refusal));
}

/** The body's file, checked as base64 before it is decoded: `Buffer.from` drops what
 *  it cannot read, and a body of punctuation would arrive as another file. */
function bytesOf(contentBase64: string): Buffer {
  if (contentBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(contentBase64)) {
    throw new OrgsError(400, "invalid_upload", "That file didn't arrive in one piece. Try uploading it again.");
  }
  const bytes = Buffer.from(contentBase64, "base64");
  if (bytes.length === 0) throw refuse({ code: "empty_file" });
  if (bytes.length > MEMBER_FILE_MAX_BYTES) throw refuse({ code: "too_big" });
  return bytes;
}

async function understood(deps: LeadFileDeps, gymId: string, country: string | null, contentBase64: string, mapping: LeadFileMapping | null): Promise<LeadFileUnderstanding> {
  const bytes = bytesOf(contentBase64);
  const read = deps.read ?? readLeadFile;
  const result: LeadFileResult = await withOneReaderPerGym(deps, gymId, () => read(bytes, { country, mapping }));
  if (!result.ok) throw refuse(result.refusal);
  return result;
}

function contactsOf(rows: readonly LeadFileRow[]): { emails: string[]; phones: string[] } {
  const emails: string[] = [];
  const phones: string[] = [];
  for (const row of rows) {
    if (row.email !== null) emails.push(row.email);
    if (row.phone !== null) phones.push(row.phone);
  }
  return { emails, phones };
}

const personOf = (row: LeadFileRow): LeadFilePerson => ({
  row: row.row,
  fullName: row.fullName,
  email: row.email,
  phone: row.phone,
  source: row.source,
  sourceWord: row.sourceWord,
});

/** Everybody the file names who is not added, in the file's order. */
function notAddedOf(file: LeadFileUnderstanding, plan: LeadFilePlan): LeadFileNotAdded[] {
  const named = (row: LeadFileRow, reason: LeadFileNotAdded["reason"], sameAs: string | null = null): LeadFileNotAdded => ({
    row: row.row,
    fullName: row.fullName,
    reason,
    sameAs,
  });
  return [
    ...plan.alreadyLead.map((row) => named(row, "already_lead")),
    ...plan.alreadyMember.map((row) => named(row, "already_member")),
    ...plan.twiceInFile.map((entry) => named(entry.row, "repeated", entry.sameAs)),
    ...file.skipped.map((entry) => ({ row: entry.row, fullName: entry.fullName, reason: entry.reason, sameAs: null })),
  ].sort((a, b) => a.row - b.row);
}

function previewOf(file: LeadFileUnderstanding, plan: LeadFilePlan, leadsNow: number): LeadFilePreview {
  return {
    sheet: file.sheet,
    headerRow: file.headerRow,
    columns: file.columns,
    mapping: file.mapping,
    needsMapping: file.needsMapping,
    counts: {
      ...file.counts,
      twiceInFile: file.counts.twiceInFile + plan.twiceInFile.length,
      add: plan.add.length,
      alreadyLead: plan.alreadyLead.length,
      alreadyMember: plan.alreadyMember.length,
      notAdded:
        plan.alreadyLead.length +
        plan.alreadyMember.length +
        plan.twiceInFile.length +
        file.counts.noContact +
        file.counts.noName +
        file.counts.twiceInFile,
    },
    add: plan.add.map(personOf),
    notAdded: notAddedOf(file, plan),
    warnings: file.warnings,
    leadsNow,
    room: Math.max(0, LEADS_MAX_PER_GYM - leadsNow),
    expected: planKey(plan.add),
  };
}

/** Check: the file read and every person in it placed, with nothing written. */
export async function checkLeadFile(
  deps: LeadFileDeps,
  userId: string,
  gymId: string,
  body: LeadFileCheckRequest,
  limit: Limit,
): Promise<LeadFilePreview | null> {
  // A write gate, though nothing is written here: the only use of a check is an Add,
  // and a gym with no live plan is read-only for every member of staff.
  const { org } = await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  const file = await understood(deps, gymId, org.country, body.contentBase64, body.mapping ?? null);
  const known = await repo.contactsKnown(deps.sql, gymId, contactsOf(file.rows));
  return previewOf(file, leadFilePlan(file.rows, known.leads, known.members), known.leadsNow);
}

/** Add: the same file, under the gym's lock, adding exactly the leads Check showed. */
export async function addLeadFile(
  deps: LeadFileDeps,
  userId: string,
  gymId: string,
  body: LeadFileAddRequest,
  limit: Limit,
): Promise<{ added: number } | null> {
  const { org } = await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  const file = await understood(deps, gymId, org.country, body.contentBase64, body.mapping);
  await deps.beforeAddLock?.();
  return await deps.sql.begin(async (tx) => {
    // The same lock a lead added by hand takes, so no lead can arrive between the
    // check below and the insert.
    await lockGym(tx, gymId);
    const known = await repo.contactsKnown(tx, gymId, contactsOf(file.rows));
    const plan = leadFilePlan(file.rows, known.leads, known.members);
    if (planKey(plan.add) !== body.expected) {
      throw new OrgsError(409, LEAD_FILE_CHANGED_ERROR, LEAD_FILE_WORDS.changed);
    }
    if (known.leadsNow + plan.add.length > LEADS_MAX_PER_GYM) {
      throw new OrgsError(409, "leads_full", LEAD_FILE_WORDS.full(Math.max(0, LEADS_MAX_PER_GYM - known.leadsNow), plan.add.length));
    }
    if (plan.add.length === 0) return { added: 0 };
    const added = await repo.insertLeadsFromFile(tx, gymId, plan.add, userId);
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.leads_imported",
      targetType: "gym",
      targetId: gymId,
      // A count only: never a name, address or number.
      meta: { added: String(added) },
    });
    return { added };
  });
}
