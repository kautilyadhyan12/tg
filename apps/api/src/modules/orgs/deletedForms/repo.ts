// Signed forms of deleted members (ROADMAP 18u-iii): the desk waivers and membership agreements
// whose records were deleted for good, still kept until the purge. Every statement carries the gym
// in its WHERE, and reads only rows whose record is gone and whose six years have not run out; a
// signature left on the record not kept when two were joined is the kept person's while that
// record is on the list, never a deleted member's.
import { agreementFactsSchema, deskSignerSchema, type AgreementFact, type DeskSigner, type DeletedFormKind } from "@app/shared";
import type { Sql } from "postgres";

/** The gym as these pages need it: its name, its time zone and its own owner. */
export async function gymOf(sql: Sql, gymId: string): Promise<{ name: string; timezone: string; ownerUserId: string } | null> {
  const rows = await sql<{ name: string; timezone: string; owner_user_id: string }[]>`SELECT name, timezone, owner_user_id FROM gyms WHERE id = ${gymId}`;
  const row = rows[0];
  return row === undefined ? null : { name: row.name, timezone: row.timezone, ownerUserId: row.owner_user_id };
}

export interface FormRow {
  id: string;
  kind: DeletedFormKind;
  signedName: string;
  signer: DeskSigner;
  member: string | null;
  agreementName: string | null;
  signedAt: Date;
  deletedAt: Date;
}

/** A search typed by a person, as a pattern for ILIKE: its own %, _ and \ match themselves. */
export const searchPattern = (q: string | undefined): string | null => {
  const text = q?.trim() ?? "";
  return text === "" ? null : `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
};

/** Where a page starts: after this form, in the list's order (`deletedFormsCursorSchema`). */
export interface FormCursor {
  deletedAt: string;
  signedAt: string;
  id: string;
}

export const cursorOf = (row: { deletedKey: string; signedKey: string; id: string }): string => `${row.deletedKey}|${row.signedKey}|${row.id}`;

export function readCursor(after: string | undefined): FormCursor | null {
  const [deletedAt, signedAt, id] = after?.split("|") ?? [];
  return deletedAt === undefined || signedAt === undefined || id === undefined ? null : { deletedAt, signedAt, id };
}

/** One page of the gym's forms, the newest deletion first, starting after `after`, and how many
 *  match. `cutoff` is the purge's: a form whose record went on or before it is gone tonight and
 *  not shown. A page starts after the last form shown, so a deletion meanwhile neither repeats
 *  nor skips one. */
export async function listForms(
  sql: Sql,
  input: { gymId: string; cutoff: Date; pattern: string | null; limit: number; after: FormCursor | null },
): Promise<{ rows: (FormRow & { deletedKey: string; signedKey: string })[]; total: number }> {
  const after = input.after;
  const rows = await sql<
    {
      kind: string;
      /** Null on the one row a page past the end still returns, for the total. */
      id: string | null;
      signed_name: string;
      signer: string;
      member: string | null;
      agreement_name: string | null;
      signed_at: Date;
      deleted_at: Date;
      deleted_key: string;
      signed_key: string;
      total: string;
    }[]
  >`
    WITH forms AS (
      SELECT 'waiver'::text AS kind, s.id, s.signed_name, s.signer, s.member_name AS member, NULL::text AS agreement_name,
             s.signed_at, s.record_deleted_at AS deleted_at
      FROM gym_waiver_desk_signatures s
      WHERE s.gym_id = ${input.gymId} AND s.entry_id IS NULL
        AND s.record_deleted_at IS NOT NULL AND s.record_deleted_at > ${input.cutoff}
        AND NOT EXISTS (SELECT 1 FROM gym_member_list_entries m WHERE m.gym_id = s.gym_id AND m.id = s.merged_into_entry_id)
      UNION ALL
      SELECT 'agreement'::text, s.id, s.signed_name, s.signer,
             (SELECT f->>'value' FROM jsonb_array_elements(s.facts) f WHERE f->>'label' = 'Member' LIMIT 1),
             d.name, s.signed_at, s.record_deleted_at
      FROM gym_agreement_signatures s
      JOIN gym_agreements a ON a.gym_id = s.gym_id AND a.id = s.agreement_id
      JOIN gym_agreement_documents d ON d.gym_id = a.gym_id AND d.id = a.document_id
      WHERE s.gym_id = ${input.gymId}
        AND s.record_deleted_at IS NOT NULL AND s.record_deleted_at > ${input.cutoff}
        AND NOT EXISTS (SELECT 1 FROM gym_member_list_entries m WHERE m.gym_id = s.gym_id AND m.id = s.merged_into_entry_id)
    ), found AS (
      SELECT * FROM forms
      WHERE ${input.pattern}::text IS NULL
         OR signed_name ILIKE ${input.pattern}::text ESCAPE '\\'
         OR member ILIKE ${input.pattern}::text ESCAPE '\\'
    )
    SELECT f.*, f.deleted_at::text AS deleted_key, f.signed_at::text AS signed_key, (SELECT count(*) FROM found) AS total
    FROM (SELECT 1) one
    LEFT JOIN LATERAL (
      SELECT * FROM found
      WHERE ${after === null}::boolean
         OR (deleted_at, signed_at, id) < (${after?.deletedAt ?? null}::timestamptz, ${after?.signedAt ?? null}::timestamptz, ${after?.id ?? null}::uuid)
      ORDER BY deleted_at DESC, signed_at DESC, id DESC LIMIT ${input.limit}
    ) f ON true`;
  const total = Number(rows[0]?.total ?? 0);
  return {
    total,
    rows: rows.flatMap((row): (FormRow & { deletedKey: string; signedKey: string })[] =>
      row.id === null
        ? []
        : [
            {
              id: row.id,
              kind: row.kind === "agreement" ? "agreement" : "waiver",
              signedName: row.signed_name,
              // Text under a CHECK: parsed, so a signer this build does not know fails here.
              signer: deskSignerSchema.parse(row.signer),
              member: row.member,
              agreementName: row.agreement_name,
              signedAt: row.signed_at,
              deletedAt: row.deleted_at,
              deletedKey: row.deleted_key,
              signedKey: row.signed_key,
            },
          ],
    ),
  };
}

export interface WaiverFormRow {
  name: string;
  signer: DeskSigner;
  at: Date;
  by: string | null;
  version: number;
  text: string;
  deletedAt: Date;
}

export async function waiverForm(sql: Sql, gymId: string, formId: string, cutoff: Date): Promise<WaiverFormRow | null> {
  const rows = await sql<{ signed_name: string; signer: string; signed_at: Date; by: string | null; version: number; body: string; deleted_at: Date }[]>`
    SELECT s.signed_name, s.signer, s.signed_at, u.display_name AS by, w.version, w.body, s.record_deleted_at AS deleted_at
    FROM gym_waiver_desk_signatures s
    JOIN gym_waivers w ON w.gym_id = s.gym_id AND w.id = s.waiver_id
    LEFT JOIN users u ON u.id = s.witnessed_by AND u.status = 'active'
    WHERE s.gym_id = ${gymId} AND s.id = ${formId} AND s.entry_id IS NULL
      AND s.record_deleted_at IS NOT NULL AND s.record_deleted_at > ${cutoff}
      AND NOT EXISTS (SELECT 1 FROM gym_member_list_entries m WHERE m.gym_id = s.gym_id AND m.id = s.merged_into_entry_id)`;
  const row = rows[0];
  if (row === undefined) return null;
  return {
    name: row.signed_name,
    signer: deskSignerSchema.parse(row.signer),
    at: row.signed_at,
    by: row.by,
    version: row.version,
    text: row.body,
    deletedAt: row.deleted_at,
  };
}

export interface AgreementFormRow {
  name: string;
  signer: DeskSigner;
  at: Date;
  by: string | null;
  version: number;
  text: string;
  facts: AgreementFact[];
  emailedAt: Date | null;
  agreementName: string | null;
  via: "desk" | "link";
  deletedAt: Date;
}

export async function agreementForm(sql: Sql, gymId: string, formId: string, cutoff: Date): Promise<AgreementFormRow | null> {
  const rows = await sql<
    {
      signed_name: string;
      signer: string;
      signed_at: Date;
      by: string | null;
      version: number;
      body: string;
      facts: unknown;
      emailed_at: Date | null;
      agreement_name: string | null;
      signed_via: string;
      deleted_at: Date;
    }[]
  >`
    SELECT s.signed_name, s.signer, s.signed_at, u.display_name AS by, a.version, a.body, s.facts, s.emailed_at,
           d.name AS agreement_name, s.signed_via, s.record_deleted_at AS deleted_at
    FROM gym_agreement_signatures s
    JOIN gym_agreements a ON a.gym_id = s.gym_id AND a.id = s.agreement_id
    JOIN gym_agreement_documents d ON d.gym_id = a.gym_id AND d.id = a.document_id
    LEFT JOIN users u ON u.id = s.witnessed_by AND u.status = 'active'
    WHERE s.gym_id = ${gymId} AND s.id = ${formId}
      AND s.record_deleted_at IS NOT NULL AND s.record_deleted_at > ${cutoff}
      AND NOT EXISTS (SELECT 1 FROM gym_member_list_entries m WHERE m.gym_id = s.gym_id AND m.id = s.merged_into_entry_id)`;
  const row = rows[0];
  if (row === undefined) return null;
  return {
    name: row.signed_name,
    signer: deskSignerSchema.parse(row.signer),
    at: row.signed_at,
    by: row.by,
    version: row.version,
    text: row.body,
    facts: agreementFactsSchema.parse(row.facts),
    emailedAt: row.emailed_at,
    agreementName: row.agreement_name,
    via: row.signed_via === "link" ? "link" : "desk",
    deletedAt: row.deleted_at,
  };
}
