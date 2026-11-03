// Signed forms of deleted members (ROADMAP 18u-iii): the desk waivers and membership agreements
// whose records were deleted for good, still kept until the purge. Every statement carries the gym
// in its WHERE, and reads only rows whose record is gone and whose six years have not run out.
import { agreementFactsSchema, deskSignerSchema, type AgreementFact, type DeskSigner, type DeletedFormKind } from "@app/shared";
import type { Sql } from "postgres";

export async function ownerOf(sql: Sql, gymId: string): Promise<string | null> {
  const rows = await sql<{ owner_user_id: string }[]>`SELECT owner_user_id FROM gyms WHERE id = ${gymId}`;
  return rows[0]?.owner_user_id ?? null;
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

/** One page of the gym's forms, the newest deletion first, and how many match. `cutoff` is the
 *  purge's: a form whose record went on or before it is gone tonight and not shown. */
export async function listForms(
  sql: Sql,
  input: { gymId: string; cutoff: Date; pattern: string | null; limit: number; offset: number },
): Promise<{ rows: FormRow[]; total: number }> {
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
      total: string;
    }[]
  >`
    WITH forms AS (
      SELECT 'waiver'::text AS kind, s.id, s.signed_name, s.signer, NULL::text AS member, NULL::text AS agreement_name,
             s.signed_at, s.record_deleted_at AS deleted_at
      FROM gym_waiver_desk_signatures s
      WHERE s.gym_id = ${input.gymId} AND s.entry_id IS NULL
        AND s.record_deleted_at IS NOT NULL AND s.record_deleted_at > ${input.cutoff}
      UNION ALL
      SELECT 'agreement'::text, s.id, s.signed_name, s.signer,
             (SELECT f->>'value' FROM jsonb_array_elements(s.facts) f WHERE f->>'label' = 'Member' LIMIT 1),
             d.name, s.signed_at, s.record_deleted_at
      FROM gym_agreement_signatures s
      JOIN gym_agreements a ON a.gym_id = s.gym_id AND a.id = s.agreement_id
      JOIN gym_agreement_documents d ON d.gym_id = a.gym_id AND d.id = a.document_id
      WHERE s.gym_id = ${input.gymId}
        AND s.record_deleted_at IS NOT NULL AND s.record_deleted_at > ${input.cutoff}
    ), found AS (
      SELECT * FROM forms
      WHERE ${input.pattern}::text IS NULL
         OR signed_name ILIKE ${input.pattern}::text ESCAPE '\\'
         OR member ILIKE ${input.pattern}::text ESCAPE '\\'
    )
    SELECT f.*, (SELECT count(*) FROM found) AS total
    FROM (SELECT 1) one
    LEFT JOIN LATERAL (
      SELECT * FROM found ORDER BY deleted_at DESC, signed_at DESC, id LIMIT ${input.limit} OFFSET ${input.offset}
    ) f ON true`;
  const total = Number(rows[0]?.total ?? 0);
  return {
    total,
    rows: rows.flatMap((row): FormRow[] =>
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
      AND s.record_deleted_at IS NOT NULL AND s.record_deleted_at > ${cutoff}`;
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
      AND s.record_deleted_at IS NOT NULL AND s.record_deleted_at > ${cutoff}`;
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
