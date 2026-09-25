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
  createdAt: Date;
  statusChangedAt: Date;
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
  created_at: Date;
  status_changed_at: Date;
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
  createdAt: row.created_at,
  statusChangedAt: row.status_changed_at,
});

export interface LeadValues {
  fullName: string;
  email: string | null;
  phone: string | null;
  source: LeadSource;
  notes: string;
  emailOkAt: Date | null;
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
    INSERT INTO gym_leads (gym_id, full_name, email, phone_e164, source, notes, email_ok_at, added_by)
    VALUES (${gymId}, ${values.fullName}, ${values.email}, ${values.phone}, ${values.source}, ${values.notes}, ${values.emailOkAt}, ${addedBy})
    RETURNING id, full_name, email, phone_e164, source, status, notes, email_ok_at, entry_id, created_at, status_changed_at`;
  const row = rows[0];
  if (row === undefined) throw new Error("inserting a lead returned no row");
  return toRow(row);
}

export async function leadFor(sql: SqlOrTx, gymId: string, leadId: string): Promise<LeadRow | null> {
  const rows = await sql<DbLead[]>`
    SELECT id, full_name, email, phone_e164, source, status, notes, email_ok_at, entry_id, created_at, status_changed_at
    FROM gym_leads WHERE gym_id = ${gymId} AND id = ${leadId}`;
  const row = rows[0];
  return row === undefined ? null : toRow(row);
}

/** The lead, locked for the rest of the caller's transaction. */
export async function lockLead(tx: TransactionSql, gymId: string, leadId: string): Promise<LeadRow | null> {
  const rows = await tx<DbLead[]>`
    SELECT id, full_name, email, phone_e164, source, status, notes, email_ok_at, entry_id, created_at, status_changed_at
    FROM gym_leads WHERE gym_id = ${gymId} AND id = ${leadId} FOR UPDATE`;
  const row = rows[0];
  return row === undefined ? null : toRow(row);
}

/** Writes every field. A status that moves stamps `status_changed_at`; a lead that
 *  stops being joined loses its record link. */
export async function writeLead(
  tx: TransactionSql,
  gymId: string,
  leadId: string,
  values: LeadValues & { status: LeadStatus; entryId: string | null },
  at: Date,
): Promise<LeadRow> {
  const rows = await tx<DbLead[]>`
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
        updated_at = ${at}
    WHERE gym_id = ${gymId} AND id = ${leadId}
    RETURNING id, full_name, email, phone_e164, source, status, notes, email_ok_at, entry_id, created_at, status_changed_at`;
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

export interface LeadCursor {
  at: string;
  id: string;
}

/** Newest first. `like` is an escaped ILIKE pattern or null. */
export async function leadsPage(
  sql: SqlOrTx,
  input: { gymId: string; status: LeadStatus | null; like: string | null; cursor: LeadCursor | null; limit: number },
): Promise<{ rows: LeadRow[]; total: number }> {
  const { gymId, status, like, cursor } = input;
  const rows = await sql<DbLead[]>`
    SELECT id, full_name, email, phone_e164, source, status, notes, email_ok_at, entry_id, created_at, status_changed_at
    FROM gym_leads
    WHERE gym_id = ${gymId}
      AND (${status}::text IS NULL OR status = ${status}::text)
      AND (${like}::text IS NULL
           OR full_name ILIKE ${like}::text
           OR email::text ILIKE ${like}::text
           OR coalesce(phone_e164, '') ILIKE ${like}::text)
      AND (${cursor?.at ?? null}::timestamptz IS NULL
           OR (created_at, id) < (${cursor?.at ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
    ORDER BY created_at DESC, id DESC
    LIMIT ${input.limit}`;
  const totals = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM gym_leads
    WHERE gym_id = ${gymId}
      AND (${status}::text IS NULL OR status = ${status}::text)
      AND (${like}::text IS NULL
           OR full_name ILIKE ${like}::text
           OR email::text ILIKE ${like}::text
           OR coalesce(phone_e164, '') ILIKE ${like}::text)`;
  return { rows: rows.map(toRow), total: totals[0]?.n ?? 0 };
}

export async function leadCounts(sql: SqlOrTx, gymId: string): Promise<LeadCounts> {
  const rows = await sql<{ status: string; n: number }[]>`
    SELECT status, count(*)::int AS n FROM gym_leads WHERE gym_id = ${gymId} GROUP BY status`;
  const counts: LeadCounts = { all: 0, new: 0, contacted: 0, on_trial: 0, joined: 0, lost: 0 };
  for (const row of rows) {
    counts.all += row.n;
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
