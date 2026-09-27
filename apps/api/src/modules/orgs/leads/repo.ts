// A gym's leads in the database (ROADMAP 20c-i). Every statement has the gym in its
// WHERE; a lead id is never looked up on its own.
import type { Sql, TransactionSql } from "postgres";
import type { LeadCounts, LeadSource, LeadStatus } from "@app/shared";
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
  entryId: string | null;
  /** The linked record is on the list now (not taken off, not deleted). */
  onList: boolean;
  createdAt: Date;
  statusChangedAt: Date;
  followUpsSent: number;
  followUpLastAt: Date | null;
  /** YYYY-MM-DD, the gym's day. */
  followUpDueOn: string | null;
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
  entry_id: string | null;
  on_list: boolean;
  created_at: Date;
  status_changed_at: Date;
  follow_ups_sent: number;
  follow_up_last_at: Date | null;
  follow_up_due_on: string | null;
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
  entryId: row.entry_id,
  onList: row.on_list,
  createdAt: row.created_at,
  statusChangedAt: row.status_changed_at,
  followUpsSent: row.follow_ups_sent,
  followUpLastAt: row.follow_up_last_at,
  followUpDueOn: row.follow_up_due_on,
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

export async function insertLead(tx: TransactionSql, gymId: string, values: LeadValues, addedBy: string): Promise<LeadRow> {
  const rows = await tx<DbLead[]>`
    INSERT INTO gym_leads (gym_id, full_name, email, phone_e164, source, notes, email_ok_at, added_by,
                           follow_ups_sent, follow_up_last_at, follow_up_due_on)
    VALUES (${gymId}, ${values.fullName}, ${values.email}, ${values.phone}, ${values.source}, ${values.notes}, ${values.emailOkAt}, ${addedBy},
            ${values.followUpsSent}, ${values.followUpLastAt}, ${values.followUpDueOn}::date)
    RETURNING id, full_name, email, phone_e164, source, status, notes, email_ok_at, entry_id, false AS on_list,
              created_at, status_changed_at, follow_ups_sent, follow_up_last_at, follow_up_due_on::text AS follow_up_due_on`;
  const row = rows[0];
  if (row === undefined) throw new Error("inserting a lead returned no row");
  return toRow(row);
}

export async function leadFor(sql: SqlOrTx, gymId: string, leadId: string): Promise<LeadRow | null> {
  const rows = await sql<DbLead[]>`
    SELECT l.id, l.full_name, l.email, l.phone_e164, l.source, l.status, l.notes, l.email_ok_at, l.entry_id,
           (e.id IS NOT NULL AND e.former_at IS NULL) AS on_list, l.created_at, l.status_changed_at,
           l.follow_ups_sent, l.follow_up_last_at, l.follow_up_due_on::text AS follow_up_due_on
    FROM gym_leads l
    LEFT JOIN gym_member_list_entries e ON e.gym_id = l.gym_id AND e.id = l.entry_id
    WHERE l.gym_id = ${gymId} AND l.id = ${leadId}`;
  const row = rows[0];
  return row === undefined ? null : toRow(row);
}

/** The lead, locked for the rest of the caller's transaction. */
export async function lockLead(tx: TransactionSql, gymId: string, leadId: string): Promise<LeadRow | null> {
  const rows = await tx<DbLead[]>`
    SELECT l.id, l.full_name, l.email, l.phone_e164, l.source, l.status, l.notes, l.email_ok_at, l.entry_id,
           (e.id IS NOT NULL AND e.former_at IS NULL) AS on_list, l.created_at, l.status_changed_at,
           l.follow_ups_sent, l.follow_up_last_at, l.follow_up_due_on::text AS follow_up_due_on
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
): Promise<LeadRow> {
  const rows = await tx<DbLead[]>`
    WITH written AS (
      UPDATE gym_leads
      SET full_name = ${values.fullName},
          email = ${values.email},
          phone_e164 = ${values.phone},
          source = ${values.source},
          notes = ${values.notes},
          email_ok_at = ${values.emailOkAt},
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
    SELECT w.id, w.full_name, w.email, w.phone_e164, w.source, w.status, w.notes, w.email_ok_at, w.entry_id,
           (e.id IS NOT NULL AND e.former_at IS NULL) AS on_list, w.created_at, w.status_changed_at,
           w.follow_ups_sent, w.follow_up_last_at, w.follow_up_due_on::text AS follow_up_due_on
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
 *  only leads due a follow-up are wanted. */
export async function leadsPage(
  sql: SqlOrTx,
  input: {
    gymId: string;
    status: LeadStatus | null;
    like: string | null;
    digits: string | null;
    dueBy: string | null;
    cursor: LeadCursor | null;
    limit: number;
  },
): Promise<{ rows: LeadsPageRow[]; total: number }> {
  const { gymId, status, like, digits, dueBy, cursor } = input;
  const rows = await sql<(DbLead & { cursor_at: string })[]>`
    SELECT l.id, l.full_name, l.email, l.phone_e164, l.source, l.status, l.notes, l.email_ok_at, l.entry_id,
           (e.id IS NOT NULL AND e.former_at IS NULL) AS on_list, l.created_at, l.status_changed_at,
           l.follow_ups_sent, l.follow_up_last_at, l.follow_up_due_on::text AS follow_up_due_on,
           to_char(l.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
    FROM gym_leads l
    LEFT JOIN gym_member_list_entries e ON e.gym_id = l.gym_id AND e.id = l.entry_id
    WHERE l.gym_id = ${gymId}
      AND (${status}::text IS NULL OR l.status = ${status}::text)
      AND (${dueBy}::date IS NULL OR l.follow_up_due_on <= ${dueBy}::date)
      AND ((${like}::text IS NULL AND ${digits}::text IS NULL)
           OR l.full_name ILIKE ${like}::text
           OR l.email::text ILIKE ${like}::text
           OR replace(coalesce(l.phone_e164, ''), '+', '') LIKE '%' || ${digits}::text || '%')
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
    WHERE l.gym_id = ${gymId}
      AND (${status}::text IS NULL OR l.status = ${status}::text)
      AND (${dueBy}::date IS NULL OR l.follow_up_due_on <= ${dueBy}::date)
      AND ((${like}::text IS NULL AND ${digits}::text IS NULL)
           OR l.full_name ILIKE ${like}::text
           OR l.email::text ILIKE ${like}::text
           OR replace(coalesce(l.phone_e164, ''), '+', '') LIKE '%' || ${digits}::text || '%')`;
  return { rows: rows.map((row) => ({ ...toRow(row), cursorAt: row.cursor_at })), total: totals[0]?.n ?? 0 };
}

/** The gym's leads by status, and how many are due a follow-up by `today`. */
export async function leadCounts(sql: SqlOrTx, gymId: string, today: string): Promise<LeadCounts> {
  const rows = await sql<{ status: string; n: number; due: number }[]>`
    SELECT status, count(*)::int AS n, (count(*) FILTER (WHERE follow_up_due_on <= ${today}::date))::int AS due
    FROM gym_leads WHERE gym_id = ${gymId} GROUP BY status`;
  const counts: LeadCounts = { all: 0, new: 0, contacted: 0, on_trial: 0, joined: 0, lost: 0, followUpsDue: 0 };
  for (const row of rows) {
    counts.all += row.n;
    counts.followUpsDue += row.due;
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
): Promise<number> {
  let added = 0;
  for (let at = 0; at < leads.length; at += 1000) {
    const batch = leads.slice(at, at + 1000).map((lead) => ({
      gym_id: gymId,
      full_name: lead.fullName,
      email: lead.email,
      phone_e164: lead.phone,
      source: lead.source,
      notes: lead.notes,
      added_by: addedBy,
    }));
    // One statement: every row is written or none is.
    await tx`INSERT INTO gym_leads ${tx(batch, "gym_id", "full_name", "email", "phone_e164", "source", "notes", "added_by")}`;
    added += batch.length;
  }
  return added;
}
