// A business's membership agreement and its signatures (ROADMAP 18u-i; migration 0159).
// Every statement carries the gym in its WHERE.
import { agreementFactsSchema, deskSignerSchema, type AgreementFact, type DeskSigner } from "@app/shared";
import type { Sql, TransactionSql } from "postgres";

export type SqlOrTx = Sql | TransactionSql;

export interface AgreementRow {
  id: string;
  version: number;
  body: string;
  savedAt: Date;
  stoppedAt: Date | null;
}

interface RawAgreement {
  id: string;
  version: number;
  body: string;
  saved_at: Date;
  stopped_at: Date | null;
}

const toRow = (raw: RawAgreement): AgreementRow => ({ id: raw.id, version: raw.version, body: raw.body, savedAt: raw.saved_at, stoppedAt: raw.stopped_at });

/** The newest wording the business saved, in use or stopped; null where it never saved one. */
export async function latestAgreement(sql: SqlOrTx, gymId: string): Promise<AgreementRow | null> {
  const rows = await sql<RawAgreement[]>`
    SELECT id, version, body, saved_at, stopped_at FROM gym_agreements
    WHERE gym_id = ${gymId} ORDER BY version DESC LIMIT 1`;
  const raw = rows[0];
  return raw === undefined ? null : toRow(raw);
}

/** The agreement memberships are signed with today, or null. */
export async function agreementInUse(sql: SqlOrTx, gymId: string): Promise<AgreementRow | null> {
  const latest = await latestAgreement(sql, gymId);
  return latest === null || latest.stoppedAt !== null ? null : latest;
}

/** A new wording, numbered after the newest. The caller holds the gym's row lock. */
export async function insertVersion(tx: TransactionSql, input: { gymId: string; version: number; body: string; savedBy: string; at: Date }): Promise<AgreementRow> {
  const rows = await tx<RawAgreement[]>`
    INSERT INTO gym_agreements (gym_id, version, body, saved_by, saved_at)
    VALUES (${input.gymId}, ${input.version}, ${input.body}, ${input.savedBy}, ${input.at})
    RETURNING id, version, body, saved_at, stopped_at`;
  const raw = rows[0];
  if (raw === undefined) throw new Error("an agreement was not written");
  return toRow(raw);
}

/** Stop signing memberships with this wording (`at`), or start again (`null`). */
export async function setStopped(tx: TransactionSql, gymId: string, agreementId: string, at: Date | null): Promise<void> {
  await tx`UPDATE gym_agreements SET stopped_at = ${at} WHERE gym_id = ${gymId} AND id = ${agreementId}`;
}

/** How many of the business's memberships were signed, with any wording: changing the words
 *  keeps every one of them. */
export async function signedCount(sql: SqlOrTx, gymId: string): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM gym_agreement_signatures
    WHERE gym_id = ${gymId} AND held_membership_id IS NOT NULL`;
  return rows[0]?.n ?? 0;
}

/** These memberships' signatures: when each was signed. */
export async function signedAtOf(sql: SqlOrTx, gymId: string, membershipIds: readonly string[]): Promise<Map<string, Date>> {
  if (membershipIds.length === 0) return new Map();
  const rows = await sql<{ held_membership_id: string; signed_at: Date }[]>`
    SELECT held_membership_id, signed_at FROM gym_agreement_signatures
    WHERE gym_id = ${gymId} AND held_membership_id = ANY(${[...membershipIds]}::uuid[])`;
  return new Map(rows.map((row) => [row.held_membership_id, row.signed_at]));
}

export interface SignatureRow {
  id: string;
  name: string;
  signer: DeskSigner;
  at: Date;
  by: string | null;
  version: number;
  text: string;
  facts: AgreementFact[];
  emailedAt: Date | null;
}

/** One membership's signature, with the words and details it was signed for. */
export async function signatureOf(sql: SqlOrTx, gymId: string, membershipId: string): Promise<SignatureRow | null> {
  const rows = await sql<
    { id: string; signed_name: string; signer: string; signed_at: Date; by: string | null; version: number; body: string; facts: unknown; emailed_at: Date | null }[]
  >`
    SELECT s.id, s.signed_name, s.signer, s.signed_at, u.display_name AS by, a.version, a.body, s.facts, s.emailed_at
    FROM gym_agreement_signatures s
    JOIN gym_agreements a ON a.gym_id = s.gym_id AND a.id = s.agreement_id
    LEFT JOIN users u ON u.id = s.witnessed_by AND u.status = 'active'
    WHERE s.gym_id = ${gymId} AND s.held_membership_id = ${membershipId}`;
  const row = rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    name: row.signed_name,
    // Text under a CHECK and a column the app wrote: parsed, so a shape this build does not know fails here.
    signer: deskSignerSchema.parse(row.signer),
    at: row.signed_at,
    by: row.by,
    version: row.version,
    text: row.body,
    facts: agreementFactsSchema.parse(row.facts),
    emailedAt: row.emailed_at,
  };
}

/** The membership's record, with what the agreement and its copy read: its name, date of
 *  birth and email address. Null where the membership is not this record's at this gym, or
 *  the record is not on the list today. */
export async function membershipRecord(
  sql: SqlOrTx,
  gymId: string,
  entryId: string,
  membershipId: string,
  /** A past member's too: their signed copy can still be sent to them. */
  opts: { former: boolean } = { former: false },
): Promise<{ fullName: string; dateOfBirth: string | null; email: string | null; former: boolean } | null> {
  const rows = await sql<{ full_name: string; date_of_birth: string | null; email: string | null; former: boolean }[]>`
    SELECT e.full_name, e.date_of_birth::text AS date_of_birth, e.email::text AS email, e.former_at IS NOT NULL AS former
    FROM gym_member_list_entries e
    JOIN gym_held_memberships h ON h.gym_id = e.gym_id AND h.entry_id = e.id AND h.id = ${membershipId}
    WHERE e.gym_id = ${gymId} AND e.id = ${entryId} AND (${opts.former} OR e.former_at IS NULL)`;
  const row = rows[0];
  return row === undefined ? null : { fullName: row.full_name.trim(), dateOfBirth: row.date_of_birth, email: row.email, former: row.former };
}

/** The business's details the agreement names. */
export async function gymContact(sql: SqlOrTx, gymId: string): Promise<{ postalAddress: string | null; contactPhone: string | null; contactEmail: string | null }> {
  const rows = await sql<{ postal_address: string | null; contact_phone: string | null; contact_email: string | null }[]>`
    SELECT postal_address, contact_phone, contact_email FROM gyms WHERE id = ${gymId}`;
  const row = rows[0];
  return { postalAddress: row?.postal_address ?? null, contactPhone: row?.contact_phone ?? null, contactEmail: row?.contact_email ?? null };
}

/** A membership's agreement signed at the desk, in one statement: written only while the
 *  wording shown is the one the business asks for, the membership is this record's and in
 *  use, the record is on the list today, and its date of birth is still the one the under-18
 *  check read. The id of the signature written; null where nothing was, a second press of
 *  the same signature included. */
export async function signAtDesk(
  sql: SqlOrTx,
  input: {
    gymId: string;
    agreementId: string;
    entryId: string;
    membershipId: string;
    dateOfBirth: string | null;
    signer: DeskSigner;
    name: string;
    facts: readonly AgreementFact[];
    witnessedBy: string;
    at: Date;
  },
): Promise<string | null> {
  const rows = await sql<{ id: string }[]>`
    INSERT INTO gym_agreement_signatures (gym_id, agreement_id, held_membership_id, signer, signed_name, facts, witnessed_by, signed_at)
    SELECT a.gym_id, a.id, h.id, ${input.signer}, ${input.name}, ${sql.json(input.facts.map((fact) => ({ label: fact.label, value: fact.value })))}, ${input.witnessedBy}, ${input.at}
    FROM gym_agreements a
    JOIN gym_member_list_entries e ON e.gym_id = a.gym_id AND e.id = ${input.entryId} AND e.former_at IS NULL
    JOIN gym_held_memberships h ON h.gym_id = a.gym_id AND h.id = ${input.membershipId} AND h.entry_id = e.id AND h.status = 'active'
    WHERE a.gym_id = ${input.gymId} AND a.id = ${input.agreementId} AND a.stopped_at IS NULL
      AND a.version = (SELECT max(version) FROM gym_agreements WHERE gym_id = ${input.gymId})
      AND e.date_of_birth IS NOT DISTINCT FROM ${input.dateOfBirth}::date
    ON CONFLICT (held_membership_id) DO NOTHING
    RETURNING id`;
  return rows[0]?.id ?? null;
}

/** Claims the sending of a copy, in one statement: written only where no copy went in the last
 *  minute, so two presses at once send one. What `emailed_at` was before, to put back if the
 *  email then fails; `claimed: false` where another press has just sent it. */
export async function claimCopy(sql: SqlOrTx, gymId: string, signatureId: string, at: Date): Promise<{ claimed: boolean; was: Date | null }> {
  const rows = await sql<{ was: Date | null }[]>`
    UPDATE gym_agreement_signatures s SET emailed_at = ${at}
    FROM (SELECT id, emailed_at AS was FROM gym_agreement_signatures WHERE gym_id = ${gymId} AND id = ${signatureId} FOR UPDATE) o
    WHERE s.id = o.id AND (o.was IS NULL OR o.was < ${at}::timestamptz - interval '1 minute')
    RETURNING o.was`;
  const row = rows[0];
  return row === undefined ? { claimed: false, was: null } : { claimed: true, was: row.was };
}

/** The claimed copy did not go: `emailed_at` goes back to what it was. */
export async function unclaimCopy(sql: SqlOrTx, gymId: string, signatureId: string, at: Date, was: Date | null): Promise<void> {
  await sql`UPDATE gym_agreement_signatures SET emailed_at = ${was} WHERE gym_id = ${gymId} AND id = ${signatureId} AND emailed_at = ${at}`;
}

/** A record deleted for good: its memberships' signatures stay as the business's proof, with
 *  the day, and the purge removes them six years later. One record, or every record of the
 *  gym when `entryId` is null. Runs before the record goes, while its memberships name it. */
export async function letGoOfAgreementSignatures(tx: TransactionSql, gymId: string, entryId: string | null, at: Date): Promise<void> {
  await tx`
    UPDATE gym_agreement_signatures s SET record_deleted_at = ${at}
    FROM gym_held_memberships h
    WHERE s.gym_id = ${gymId} AND h.gym_id = s.gym_id AND h.id = s.held_membership_id
      AND s.record_deleted_at IS NULL AND h.entry_id IS NOT NULL
      AND (${entryId}::uuid IS NULL OR h.entry_id = ${entryId}::uuid)`;
}
