// A gym's leads in the database (ROADMAP 20c-i). Every statement has the gym in its
// WHERE; a lead id is never looked up on its own.
import type { Sql, TransactionSql } from "postgres";
import type { LeadCounts, LeadSource, LeadStatus } from "@app/shared";
import { emailHmac } from "../invites/address.js";
import { staffDueCondition } from "./emailsRepo.js";
import type { ListRecord } from "./joinRule.js";

type SqlOrTx = Sql | TransactionSql;

export interface LeadRow {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  source: string;
  status: string;
  notes: string;
  emailOkAt: Date | null;
  /** "Happy to hear from us" was ticked by the person on the gym's page form, not by staff. */
  emailOkByPage: boolean;
  entryId: string | null;
  /** The linked record is on the list now (not taken off, not deleted). */
  onList: boolean;
  createdAt: Date;
  statusChangedAt: Date;
  followUpsSent: number;
  followUpLastAt: Date | null;
  /** YYYY-MM-DD, the gym's day. */
  followUpDueOn: string | null;
  /** When the person last sent the gym page's form. */
  enquiredAt: Date | null;
}

interface DbLead {
  id: string;
  full_name: string;
  email: string | null;
  phone_e164: string | null;
  source: string;
  status: string;
  notes: string;
  email_ok_at: Date | null;
  email_ok_by_page: boolean;
  entry_id: string | null;
  on_list: boolean;
  created_at: Date;
  status_changed_at: Date;
  follow_ups_sent: number;
  follow_up_last_at: Date | null;
  follow_up_due_on: string | null;
  enquired_at: Date | null;
}

const toRow = (row: DbLead): LeadRow => ({
  id: row.id,
  fullName: row.full_name,
  email: row.email,
  phone: row.phone_e164,
  source: row.source,
  status: row.status,
  notes: row.notes,
  emailOkAt: row.email_ok_at,
  emailOkByPage: row.email_ok_by_page,
  entryId: row.entry_id,
  onList: row.on_list,
  createdAt: row.created_at,
  statusChangedAt: row.status_changed_at,
  followUpsSent: row.follow_ups_sent,
  followUpLastAt: row.follow_up_last_at,
  followUpDueOn: row.follow_up_due_on,
  enquiredAt: row.enquired_at,
});

export interface LeadValues {
  fullName: string;
  email: string | null;
  phone: string | null;
  source: LeadSource;
  notes: string;
  emailOkAt: Date | null;
  followUpsSent: number;
  followUpLastAt: Date | null;
  followUpDueOn: string | null;
}

/** A clash on one of the two UNIQUEs: another lead of this gym holds the email or phone. */
export function isLeadClash(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    err.code === "23505" &&
    "constraint_name" in err &&
    (err.constraint_name === "gym_leads_gym_email_uq" || err.constraint_name === "gym_leads_gym_phone_uq")
  );
}

export async function countLeads(tx: TransactionSql, gymId: string): Promise<number> {
  const rows = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_leads WHERE gym_id = ${gymId}`;
  return rows[0]?.n ?? 0;
}

/** The leads the gym's page made that staff have not moved on from New
 *  (`gym_leads_page_new_idx`): the form's own ceiling counts these. */
export async function countPageNewLeads(tx: TransactionSql, gymId: string): Promise<number> {
  const rows = await tx<{ n: number }[]>`
    SELECT count(*)::int AS n FROM gym_leads WHERE gym_id = ${gymId} AND from_page AND status = 'new'`;
  return rows[0]?.n ?? 0;
}

/** Another lead of this gym with this email or phone. */
export async function leadHolding(
  sql: SqlOrTx,
  gymId: string,
  contact: { email: string | null; phone: string | null },
  exceptId: string | null,
): Promise<string | null> {
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM gym_leads
    WHERE gym_id = ${gymId}
      AND ((${contact.email}::citext IS NOT NULL AND email = ${contact.email}::citext)
        OR (${contact.phone}::text IS NOT NULL AND phone_e164 = ${contact.phone}::text))
      AND (${exceptId}::uuid IS NULL OR id <> ${exceptId}::uuid)
    LIMIT 1`;
  return rows[0]?.id ?? null;
}

/** `addedBy` null: the person sent the gym page's form themselves (`enquiredAt`). */
export async function insertLead(
  tx: TransactionSql,
  gymId: string,
  values: LeadValues,
  addedBy: string | null,
  addressKey: Buffer | null,
  enquiredAt: Date | null = null,
  /** Made by the gym's page form: its tick, if any, is the person's own on the form. */
  fromPage = false,
): Promise<LeadRow> {
  const rows = await tx<DbLead[]>`
    INSERT INTO gym_leads (gym_id, full_name, email, email_hmac, phone_e164, source, notes, email_ok_at, added_by,
                           follow_ups_sent, follow_up_last_at, follow_up_due_on, enquired_at, from_page, email_ok_by_page)
    VALUES (${gymId}, ${values.fullName}, ${values.email}, ${leadEmailHmac(addressKey, values.email)}, ${values.phone}, ${values.source},
            ${values.notes}, ${values.emailOkAt}, ${addedBy},
            ${values.followUpsSent}, ${values.followUpLastAt}, ${values.followUpDueOn}::date, ${enquiredAt},
            ${fromPage}, ${fromPage && values.emailOkAt !== null})
    RETURNING id, full_name, email, phone_e164, source, status, notes, email_ok_at, email_ok_by_page, entry_id, false AS on_list,
              created_at, status_changed_at, follow_ups_sent, follow_up_last_at, follow_up_due_on::text AS follow_up_due_on,
              enquired_at`;
  const row = rows[0];
  if (row === undefined) throw new Error("inserting a lead returned no row");
  return toRow(row);
}

export async function leadFor(sql: SqlOrTx, gymId: string, leadId: string): Promise<LeadRow | null> {
  const rows = await sql<DbLead[]>`
    SELECT l.id, l.full_name, l.email, l.phone_e164, l.source, l.status, l.notes, l.email_ok_at, l.email_ok_by_page, l.entry_id,
           (e.id IS NOT NULL AND e.former_at IS NULL) AS on_list, l.created_at, l.status_changed_at,
           l.follow_ups_sent, l.follow_up_last_at, l.follow_up_due_on::text AS follow_up_due_on, l.enquired_at
    FROM gym_leads l
    LEFT JOIN gym_member_list_entries e ON e.gym_id = l.gym_id AND e.id = l.entry_id
    WHERE l.gym_id = ${gymId} AND l.id = ${leadId}`;
  const row = rows[0];
  return row === undefined ? null : toRow(row);
}

/** The lead, locked for the rest of the caller's transaction. */
export async function lockLead(tx: TransactionSql, gymId: string, leadId: string): Promise<LeadRow | null> {
  const rows = await tx<DbLead[]>`
    SELECT l.id, l.full_name, l.email, l.phone_e164, l.source, l.status, l.notes, l.email_ok_at, l.email_ok_by_page, l.entry_id,
           (e.id IS NOT NULL AND e.former_at IS NULL) AS on_list, l.created_at, l.status_changed_at,
           l.follow_ups_sent, l.follow_up_last_at, l.follow_up_due_on::text AS follow_up_due_on, l.enquired_at
    FROM gym_leads l
    LEFT JOIN gym_member_list_entries e ON e.gym_id = l.gym_id AND e.id = l.entry_id
    WHERE l.gym_id = ${gymId} AND l.id = ${leadId}
    FOR UPDATE OF l`;
  const row = rows[0];
  return row === undefined ? null : toRow(row);
}

/** Writes every field. A status that moves stamps `status_changed_at`. */
export async function writeLead(
  tx: TransactionSql,
  gymId: string,
  leadId: string,
  values: LeadValues & { status: LeadStatus; entryId: string | null },
  at: Date,
  addressKey: Buffer | null,
): Promise<LeadRow> {
  const rows = await tx<DbLead[]>`
    WITH written AS (
      UPDATE gym_leads
      SET full_name = ${values.fullName},
          email = ${values.email},
          email_hmac = ${leadEmailHmac(addressKey, values.email)},
          phone_e164 = ${values.phone},
          source = ${values.source},
          notes = ${values.notes},
          email_ok_at = ${values.emailOkAt},
          -- Staff ticking or unticking makes the tick theirs; a tick left alone keeps whose it was.
          email_ok_by_page = CASE WHEN email_ok_at IS NOT DISTINCT FROM ${values.emailOkAt}::timestamptz THEN email_ok_by_page ELSE false END,
          status_changed_at = CASE WHEN status = ${values.status} THEN status_changed_at ELSE ${at} END,
          status = ${values.status},
          entry_id = ${values.entryId},
          follow_ups_sent = ${values.followUpsSent},
          follow_up_last_at = ${values.followUpLastAt},
          follow_up_due_on = ${values.followUpDueOn}::date,
          updated_at = ${at}
      WHERE gym_id = ${gymId} AND id = ${leadId}
      RETURNING *
    )
    SELECT w.id, w.full_name, w.email, w.phone_e164, w.source, w.status, w.notes, w.email_ok_at, w.email_ok_by_page, w.entry_id,
           (e.id IS NOT NULL AND e.former_at IS NULL) AS on_list, w.created_at, w.status_changed_at,
           w.follow_ups_sent, w.follow_up_last_at, w.follow_up_due_on::text AS follow_up_due_on, w.enquired_at
    FROM written w
    LEFT JOIN gym_member_list_entries e ON e.gym_id = w.gym_id AND e.id = w.entry_id`;
  const row = rows[0];
  if (row === undefined) throw new Error(`lead ${leadId} vanished under its lock`);
  return toRow(row);
}

export async function deleteLead(tx: TransactionSql, gymId: string, leadId: string): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`DELETE FROM gym_leads WHERE gym_id = ${gymId} AND id = ${leadId} RETURNING id`;
  return rows.length > 0;
}

/** Every lead a filter chooses now, in the list's order (20c-vii's "Select all"). */
export async function leadIdsMatching(sql: SqlOrTx, input: LeadsFilterInput): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    SELECT l.id FROM gym_leads l
    WHERE ${filterCondition(sql, input)}
    ORDER BY l.created_at DESC, l.id DESC`;
  return rows.map((row) => row.id);
}

/** Of `ids`, the gym's leads that are still there, with their names, newest first. Another
 *  gym's id is nobody. */
export async function leadNames(sql: SqlOrTx, gymId: string, ids: readonly string[]): Promise<{ id: string; name: string }[]> {
  if (ids.length === 0) return [];
  const rows = await sql<{ id: string; full_name: string }[]>`
    SELECT l.id, l.full_name FROM gym_leads l
    WHERE l.gym_id = ${gymId} AND l.id = ANY(${[...ids]}::uuid[])
    ORDER BY l.created_at DESC, l.id DESC`;
  return rows.map((row) => ({ id: row.id, name: row.full_name }));
}

/** Of `ids`, the gym's leads that are still there. Another gym's id is nobody. */
export async function leadIdsIn(sql: SqlOrTx, gymId: string, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await sql<{ id: string }[]>`
    SELECT l.id FROM gym_leads l WHERE l.gym_id = ${gymId} AND l.id = ANY(${[...ids]}::uuid[])`;
  return rows.map((row) => row.id);
}

/** Delete these leads of this gym, with one activity-log line for each, in one statement:
 *  a flood of 10,000 builds no rows in the server's own memory. How many were deleted. */
export async function deleteLeads(tx: TransactionSql, actorUserId: string, gymId: string, ids: readonly string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await tx<{ n: number }[]>`
    WITH gone AS (
      DELETE FROM gym_leads WHERE gym_id = ${gymId} AND id = ANY(${[...ids]}::uuid[]) RETURNING id
    ), logged AS (
      INSERT INTO audit_log (actor_user_id, gym_id, action, target_type, target_id, meta)
      SELECT ${actorUserId}, ${gymId}, 'org.lead_deleted', 'lead', gone.id::text, '{"via":"selected"}'::jsonb FROM gone
      RETURNING 1
    )
    SELECT count(*)::int AS n FROM logged`;
  return rows[0]?.n ?? 0;
}

/** The same press seen before: its audit row by the box's digest, since `since`. */
export async function deletedLeadsByDigest(tx: TransactionSql, gymId: string, digest: string, since: Date): Promise<number | null> {
  const rows = await tx<{ deleted: string | null }[]>`
    SELECT meta->>'deleted' AS deleted
    FROM audit_log
    WHERE gym_id = ${gymId} AND at >= ${since}
      AND action = 'org.leads_selected_deleted'
      AND meta->>'digest' = ${digest}
    ORDER BY at DESC
    LIMIT 1`;
  const row = rows[0];
  return row === undefined ? null : Number(row.deleted ?? "0");
}

/** Every lead of a closed gym, inside the transaction that archives it. */
export async function deleteLeadsForGym(tx: TransactionSql, gymId: string): Promise<void> {
  await tx`DELETE FROM gym_leads WHERE gym_id = ${gymId}`;
}

/** Where a page ended: the last row's `created_at` to the microsecond, as Postgres
 *  wrote it (a JavaScript Date holds only milliseconds), and its id. */
export interface LeadCursor {
  at: string;
  id: string;
}

export interface LeadsPageRow extends LeadRow {
  cursorAt: string;
}

/** Newest first. `like` is an escaped ILIKE pattern for the name and email; `digits`
 *  the digits of a phone search (at least four), or null; `dueBy` the gym's today when
 *  only leads due a follow-up from staff are wanted — not those the app sends (`app`,
 *  20c-v). */
export interface LeadsFilterInput {
  gymId: string;
  status: LeadStatus | null;
  like: string | null;
  digits: string | null;
  dueBy: string | null;
  /** Only New leads with an email problem (`emailProblemCondition`). */
  problemOnly: boolean;
  app: { on: boolean; roomLeft: boolean; pageStopped: boolean };
}

/** The leads a status, chip and search choose, as the WHERE of `gym_leads l`: one
 *  statement for the page, its total and "Select all" (20c-vii), so they never differ. */
function filterCondition(sql: SqlOrTx, input: LeadsFilterInput) {
  const { gymId, status, like, digits, dueBy } = input;
  const due = dueBy === null ? sql`true` : staffDueCondition(sql, dueBy, input.app);
  const problem = input.problemOnly ? emailProblemCondition(sql, gymId) : sql`true`;
  return sql`
    l.gym_id = ${gymId}
      AND (${status}::text IS NULL OR l.status = ${status}::text)
      AND ${due}
      AND ${problem}
      AND ((${like}::text IS NULL AND ${digits}::text IS NULL)
           OR l.full_name ILIKE ${like}::text
           OR l.email::text ILIKE ${like}::text
           OR replace(coalesce(l.phone_e164, ''), '+', '') LIKE '%' || ${digits}::text || '%')`;
}

export async function leadsPage(
  sql: SqlOrTx,
  input: LeadsFilterInput & { cursor: LeadCursor | null; limit: number },
): Promise<{ rows: LeadsPageRow[]; total: number }> {
  const { cursor } = input;
  const where = filterCondition(sql, input);
  const rows = await sql<(DbLead & { cursor_at: string })[]>`
    SELECT l.id, l.full_name, l.email, l.phone_e164, l.source, l.status, l.notes, l.email_ok_at, l.email_ok_by_page, l.entry_id,
           (e.id IS NOT NULL AND e.former_at IS NULL) AS on_list, l.created_at, l.status_changed_at,
           l.follow_ups_sent, l.follow_up_last_at, l.follow_up_due_on::text AS follow_up_due_on, l.enquired_at,
           to_char(l.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
    FROM gym_leads l
    LEFT JOIN gym_member_list_entries e ON e.gym_id = l.gym_id AND e.id = l.entry_id
    WHERE ${where}
      -- Sent as text and cast here: a parameter typed timestamptz goes through a JavaScript
      -- Date on its way in and loses the microseconds, and with them every lead of the
      -- same millisecond after the page's last.
      AND (${cursor?.at ?? null}::text IS NULL
           OR (l.created_at, l.id) < (${cursor?.at ?? null}::text::timestamptz, ${cursor?.id ?? null}::uuid))
    ORDER BY l.created_at DESC, l.id DESC
    LIMIT ${input.limit}`;
  const totals = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM gym_leads l
    WHERE ${where}`;
  return { rows: rows.map((row) => ({ ...toRow(row), cursorAt: row.cursor_at })), total: totals[0]?.n ?? 0 };
}

/** A New lead whose address this gym's emails cannot reach — a hard bounce or an address
 *  the email service refuses, for every gym — or who marked one of this gym's emails as
 *  spam and has not been ticked again since (20c-v-b). Found by the lead's stored
 *  `email_hmac` in the few stopped addresses, each list read once for the statement (not
 *  once a lead), so a gym of 10,000 leads is counted in a fraction of a millisecond more;
 *  `emailProblemOf` in the service is the same rule for one row. */
export const emailProblemCondition = (sql: SqlOrTx, gymId: string) => sql`
  (l.status = 'new' AND (
    l.email_hmac IN (SELECT x.email_hmac FROM email_suppressions x WHERE x.gym_id IS NULL AND x.reason IN ('bounced','refused'))
    OR (l.email_ok_at IS NULL
        AND l.email_hmac IN (SELECT x.email_hmac FROM email_suppressions x WHERE x.gym_id = ${gymId} AND x.reason = 'complained'))))`;

/** The address as `email_suppressions` keeps it, or null with no address or no key. */
/** One batch of `tools/lead-email-hmacs.ts`: up to 1,000 leads with an address and no key
 *  are given their address's key — only while the address is still the one read, so an
 *  address changed in between (by an api from before 0052, say) keeps no key for the old
 *  one, and is found again by the next batch (the integrity pass over 20c, 2026-09-30).
 *  `afterRead` runs between the read and the write, for a test. Returns how many were read
 *  and how many given their key. */
export async function fillLeadEmailHmacs(
  sql: Sql,
  key: Buffer,
  afterRead: (() => Promise<void>) | null = null,
): Promise<{ read: number; filled: number }> {
  const rows = await sql<{ id: string; email: string }[]>`
    SELECT id, email::text AS email FROM gym_leads
    WHERE email IS NOT NULL AND email_hmac IS NULL
    ORDER BY id
    LIMIT 1000`;
  if (rows.length === 0) return { read: 0, filled: 0 };
  if (afterRead !== null) await afterRead();
  const filled = await sql<{ id: string }[]>`
    UPDATE gym_leads l SET email_hmac = v.hmac
    FROM unnest(${rows.map((r) => r.id)}::uuid[], ${rows.map((r) => r.email)}::text[], ${rows.map((r) => emailHmac(key, r.email))}::text[])
      AS v(id, email, hmac)
    WHERE l.id = v.id AND l.email_hmac IS NULL AND l.email = v.email::citext
    RETURNING l.id`;
  return { read: rows.length, filled: filled.length };
}

export const leadEmailHmac = (key: Buffer | null, email: string | null): string | null =>
  key === null || email === null ? null : emailHmac(key, email);

/** The gym's leads by status, how many are due a follow-up from staff by `today`, and
 *  how many New leads have an email problem. */
export async function leadCounts(
  sql: SqlOrTx,
  gymId: string,
  today: string,
  app: { on: boolean; roomLeft: boolean; pageStopped: boolean },
): Promise<LeadCounts> {
  const rows = await sql<{ status: string; n: number; due: number; problems: number }[]>`
    SELECT l.status, count(*)::int AS n, (count(*) FILTER (WHERE ${staffDueCondition(sql, today, app)}))::int AS due,
           (count(*) FILTER (WHERE ${emailProblemCondition(sql, gymId)}))::int AS problems
    FROM gym_leads l WHERE l.gym_id = ${gymId} GROUP BY l.status`;
  const counts: LeadCounts = { all: 0, new: 0, contacted: 0, on_trial: 0, joined: 0, lost: 0, followUpsDue: 0, emailProblems: 0 };
  for (const row of rows) {
    counts.all += row.n;
    counts.followUpsDue += row.due;
    counts.emailProblems += row.problems;
    if (row.status === "new") counts.new = row.n;
    else if (row.status === "contacted") counts.contacted = row.n;
    else if (row.status === "on_trial") counts.on_trial = row.n;
    else if (row.status === "joined") counts.joined = row.n;
    else if (row.status === "lost") counts.lost = row.n;
  }
  return counts;
}

/** Member records of this gym, current or former, with this email or phone. */
export async function recordsSharingContact(
  sql: SqlOrTx,
  gymId: string,
  contact: { email: string | null; phone: string | null },
  limit: number,
): Promise<ListRecord[]> {
  const rows = await sql<{ id: string; full_name: string; email: string | null; phone_e164: string | null; former: boolean }[]>`
    SELECT id, full_name, email::text AS email, phone_e164, (former_at IS NOT NULL) AS former
    FROM gym_member_list_entries
    WHERE gym_id = ${gymId}
      AND ((${contact.email}::citext IS NOT NULL AND email = ${contact.email}::citext)
        OR (${contact.phone}::text IS NOT NULL AND phone_e164 = ${contact.phone}::text))
    ORDER BY (former_at IS NOT NULL), full_name, id
    LIMIT ${limit}`;
  return rows.map((row) => ({
    entryId: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone_e164,
    former: row.former,
  }));
}

/** The gym's leads and current member records that share any of these emails or
 *  phones (a leads file, 20c-iii), and how many leads the gym has. Emails compare as
 *  citext does: case does not tell two apart. */
export async function contactsKnown(
  sql: SqlOrTx,
  gymId: string,
  contacts: { emails: readonly string[]; phones: readonly string[] },
): Promise<{
  leads: { email: string | null; phone: string | null }[];
  members: { fullName: string; email: string | null; phone: string | null }[];
  leadsNow: number;
}> {
  const emails = [...contacts.emails];
  const phones = [...contacts.phones];
  const leads = await sql<{ email: string | null; phone_e164: string | null }[]>`
    SELECT email::text AS email, phone_e164 FROM gym_leads
    WHERE gym_id = ${gymId}
      AND (email = ANY(${emails}::citext[]) OR phone_e164 = ANY(${phones}::text[]))`;
  const members = await sql<{ full_name: string; email: string | null; phone_e164: string | null }[]>`
    SELECT full_name, email::text AS email, phone_e164 FROM gym_member_list_entries
    WHERE gym_id = ${gymId} AND former_at IS NULL
      AND (email = ANY(${emails}::citext[]) OR phone_e164 = ANY(${phones}::text[]))`;
  const counted = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_leads WHERE gym_id = ${gymId}`;
  return {
    leads: leads.map((row) => ({ email: row.email, phone: row.phone_e164 })),
    members: members.map((row) => ({ fullName: row.full_name, email: row.email, phone: row.phone_e164 })),
    leadsNow: counted[0]?.n ?? 0,
  };
}

/** Leads from a file, New and unticked, in one statement per thousand. */
export async function insertLeadsFromFile(
  tx: TransactionSql,
  gymId: string,
  leads: readonly { fullName: string; email: string | null; phone: string | null; source: LeadSource; notes: string }[],
  addedBy: string,
  addressKey: Buffer | null,
): Promise<number> {
  let added = 0;
  for (let at = 0; at < leads.length; at += 1000) {
    const batch = leads.slice(at, at + 1000).map((lead) => ({
      gym_id: gymId,
      full_name: lead.fullName,
      email: lead.email,
      email_hmac: leadEmailHmac(addressKey, lead.email),
      phone_e164: lead.phone,
      source: lead.source,
      notes: lead.notes,
      added_by: addedBy,
    }));
    // One statement: every row is written or none is.
    await tx`INSERT INTO gym_leads ${tx(batch, "gym_id", "full_name", "email", "email_hmac", "phone_e164", "source", "notes", "added_by")}`;
    added += batch.length;
  }
  return added;
}

/** The lead a message from the gym page's form belongs to: the one with its email,
 *  else the one with its phone. Locked for the rest of the caller's transaction. */
export async function lockLeadForContact(
  tx: TransactionSql,
  gymId: string,
  contact: { email: string | null; phone: string | null },
): Promise<LeadRow | null> {
  const rows = await tx<DbLead[]>`
    SELECT l.id, l.full_name, l.email, l.phone_e164, l.source, l.status, l.notes, l.email_ok_at, l.email_ok_by_page, l.entry_id,
           (e.id IS NOT NULL AND e.former_at IS NULL) AS on_list, l.created_at, l.status_changed_at,
           l.follow_ups_sent, l.follow_up_last_at, l.follow_up_due_on::text AS follow_up_due_on, l.enquired_at
    FROM gym_leads l
    LEFT JOIN gym_member_list_entries e ON e.gym_id = l.gym_id AND e.id = l.entry_id
    WHERE l.gym_id = ${gymId}
      AND ((${contact.email}::citext IS NOT NULL AND l.email = ${contact.email}::citext)
        OR (${contact.phone}::text IS NOT NULL AND l.phone_e164 = ${contact.phone}::text))
    ORDER BY (${contact.email}::citext IS NOT NULL AND l.email = ${contact.email}::citext) DESC, l.id
    LIMIT 1
    FOR UPDATE OF l`;
  const row = rows[0];
  return row === undefined ? null : toRow(row);
}

export interface EnquiryValues {
  fullName: string;
  email: string | null;
  phone: string | null;
  source: LeadSource | null;
  message: string;
  mayEmail: boolean;
}

/** Keeps a message on its lead, stamps the lead, and lets go of all but the newest
 *  `kept` messages of that lead. */
/** A message the same as one kept this recently is the same message sent twice. */
const ENQUIRY_REPEAT_MS = 10 * 60 * 1000;

export async function addEnquiry(
  tx: TransactionSql,
  gymId: string,
  leadId: string,
  values: EnquiryValues,
  at: Date,
  kept: number,
): Promise<void> {
  // The same message again within ten minutes (a double tap, a phone's retry) is kept once.
  const again = await tx<{ id: string }[]>`
    SELECT id FROM gym_lead_enquiries
    WHERE gym_id = ${gymId} AND lead_id = ${leadId}
      AND created_at > ${new Date(at.getTime() - ENQUIRY_REPEAT_MS)}
      AND message = ${values.message} AND full_name = ${values.fullName}
      AND email IS NOT DISTINCT FROM ${values.email}::citext AND phone_e164 IS NOT DISTINCT FROM ${values.phone}
      AND may_email = ${values.mayEmail}
    LIMIT 1`;
  if (again.length > 0) return;
  await tx`
    INSERT INTO gym_lead_enquiries (gym_id, lead_id, full_name, email, phone_e164, source, message, may_email, created_at)
    VALUES (${gymId}, ${leadId}, ${values.fullName}, ${values.email}, ${values.phone}, ${values.source}, ${values.message},
            ${values.mayEmail}, ${at})`;
  await tx`UPDATE gym_leads SET enquired_at = ${at} WHERE gym_id = ${gymId} AND id = ${leadId}`;
  await tx`
    DELETE FROM gym_lead_enquiries
    WHERE gym_id = ${gymId} AND lead_id = ${leadId}
      AND id NOT IN (
        SELECT id FROM gym_lead_enquiries
        WHERE gym_id = ${gymId} AND lead_id = ${leadId}
        ORDER BY created_at DESC, id DESC
        LIMIT ${kept})`;
}

export interface EnquiryRow {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  source: string | null;
  message: string;
  mayEmail: boolean;
  createdAt: Date;
}

/** A lead's messages from the form, newest first. */
export async function enquiriesFor(sql: SqlOrTx, gymId: string, leadId: string, limit: number): Promise<EnquiryRow[]> {
  const rows = await sql<
    {
      id: string;
      full_name: string;
      email: string | null;
      phone_e164: string | null;
      source: string | null;
      message: string;
      may_email: boolean;
      created_at: Date;
    }[]
  >`
    SELECT id, full_name, email::text AS email, phone_e164, source, message, may_email, created_at
    FROM gym_lead_enquiries
    WHERE gym_id = ${gymId} AND lead_id = ${leadId}
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit}`;
  return rows.map((row) => ({
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone_e164,
    source: row.source,
    message: row.message,
    mayEmail: row.may_email,
    createdAt: row.created_at,
  }));
}
