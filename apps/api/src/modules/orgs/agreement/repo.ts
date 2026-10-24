// A business's membership agreements and their signatures (ROADMAP 18u-i, 18u-ii-a, 18u-ii-b;
// migrations 0159, 0161, 0162). Every statement carries the gym in its WHERE.
//
// A business has its main agreement (a document with no name) and may write others; a line of
// the price list uses the one it names, or the main one. Each document's agreement today is its
// highest version, unless that version was stopped.
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

/** The business's main agreement, or null where it never saved one. */
export async function mainDocumentId(sql: SqlOrTx, gymId: string): Promise<string | null> {
  const rows = await sql<{ id: string }[]>`SELECT id FROM gym_agreement_documents WHERE gym_id = ${gymId} AND name IS NULL`;
  return rows[0]?.id ?? null;
}

/** The main agreement, made where there is none. The caller holds the gym's row lock. */
export async function ensureMainDocument(tx: TransactionSql, gymId: string, at: Date): Promise<string> {
  await tx`INSERT INTO gym_agreement_documents (gym_id, created_at) VALUES (${gymId}, ${at}) ON CONFLICT (gym_id) WHERE name IS NULL DO NOTHING`;
  const id = await mainDocumentId(tx, gymId);
  if (id === null) throw new Error("the main agreement was not written");
  return id;
}

/** The newest wording of one of the business's agreements, in use or stopped; null where it has none. */
export async function latestOf(sql: SqlOrTx, gymId: string, documentId: string): Promise<AgreementRow | null> {
  const rows = await sql<RawAgreement[]>`
    SELECT id, version, body, saved_at, stopped_at FROM gym_agreements
    WHERE gym_id = ${gymId} AND document_id = ${documentId} ORDER BY version DESC LIMIT 1`;
  const raw = rows[0];
  return raw === undefined ? null : toRow(raw);
}

/** The main agreement's newest wording, in use or stopped; null where it never saved one. */
export async function latestAgreement(sql: SqlOrTx, gymId: string): Promise<AgreementRow | null> {
  const main = await mainDocumentId(sql, gymId);
  return main === null ? null : await latestOf(sql, gymId, main);
}

/** Any of the business's agreements is asked for today. */
export async function anyInUse(sql: SqlOrTx, gymId: string): Promise<boolean> {
  const rows = await sql<{ yes: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM gym_agreements a
      WHERE a.gym_id = ${gymId} AND a.stopped_at IS NULL
        AND a.version = (SELECT max(x.version) FROM gym_agreements x WHERE x.gym_id = a.gym_id AND x.document_id = a.document_id)
    ) AS yes`;
  return rows[0]?.yes ?? false;
}

/** A new wording, numbered after the newest of its agreement. The caller holds the gym's row lock. */
export async function insertVersion(
  tx: TransactionSql,
  input: { gymId: string; documentId: string; version: number; body: string; savedBy: string; at: Date },
): Promise<AgreementRow> {
  const rows = await tx<RawAgreement[]>`
    INSERT INTO gym_agreements (gym_id, document_id, version, body, saved_by, saved_at)
    VALUES (${input.gymId}, ${input.documentId}, ${input.version}, ${input.body}, ${input.savedBy}, ${input.at})
    RETURNING id, version, body, saved_at, stopped_at`;
  const raw = rows[0];
  if (raw === undefined) throw new Error("an agreement was not written");
  return toRow(raw);
}

/** Stop signing memberships with this wording (`at`), or start again (`null`). */
export async function setStopped(tx: TransactionSql, gymId: string, agreementId: string, at: Date | null): Promise<void> {
  await tx`UPDATE gym_agreements SET stopped_at = ${at} WHERE gym_id = ${gymId} AND id = ${agreementId}`;
}

/** How many of the business's memberships were signed with any wording of this agreement:
 *  changing the words keeps every one of them. */
export async function signedCount(sql: SqlOrTx, gymId: string, documentId: string): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM gym_agreement_signatures s
    JOIN gym_agreements a ON a.gym_id = s.gym_id AND a.id = s.agreement_id
    WHERE s.gym_id = ${gymId} AND a.document_id = ${documentId} AND s.held_membership_id IS NOT NULL`;
  return rows[0]?.n ?? 0;
}

export interface OtherRow {
  id: string;
  name: string;
  latest: AgreementRow;
  signed: number;
}

/** The business's other agreements, by name, each with its newest wording and how many
 *  memberships were signed with any of its wordings. */
export async function otherDocuments(sql: SqlOrTx, gymId: string): Promise<OtherRow[]> {
  const rows = await sql<(RawAgreement & { document_id: string; name: string; signed: number })[]>`
    SELECT d.id AS document_id, d.name, a.id, a.version, a.body, a.saved_at, a.stopped_at,
      (SELECT count(*)::int FROM gym_agreement_signatures s JOIN gym_agreements w ON w.gym_id = s.gym_id AND w.id = s.agreement_id
       WHERE s.gym_id = d.gym_id AND w.document_id = d.id AND s.held_membership_id IS NOT NULL) AS signed
    FROM gym_agreement_documents d
    JOIN LATERAL (
      SELECT x.id, x.version, x.body, x.saved_at, x.stopped_at FROM gym_agreements x
      WHERE x.gym_id = d.gym_id AND x.document_id = d.id ORDER BY x.version DESC LIMIT 1
    ) a ON true
    WHERE d.gym_id = ${gymId} AND d.name IS NOT NULL
    ORDER BY lower(d.name), d.id`;
  return rows.map((row) => ({ id: row.document_id, name: row.name, latest: toRow(row), signed: row.signed }));
}

/** One of the business's other agreements, or null where it is not this business's. */
export async function otherDocument(sql: SqlOrTx, gymId: string, documentId: string): Promise<{ id: string; name: string } | null> {
  const rows = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM gym_agreement_documents WHERE gym_id = ${gymId} AND id = ${documentId} AND name IS NOT NULL`;
  return rows[0] ?? null;
}

/** The business's other agreement of this name, whatever its capitals, or null. */
export async function documentNamed(sql: SqlOrTx, gymId: string, name: string): Promise<{ id: string; name: string } | null> {
  const rows = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM gym_agreement_documents WHERE gym_id = ${gymId} AND name IS NOT NULL AND lower(name) = lower(${name})`;
  return rows[0] ?? null;
}

/** Another agreement, with its name. The caller holds the gym's row lock. */
export async function insertDocument(tx: TransactionSql, gymId: string, name: string, at: Date): Promise<string> {
  const rows = await tx<{ id: string }[]>`INSERT INTO gym_agreement_documents (gym_id, name, created_at) VALUES (${gymId}, ${name}, ${at}) RETURNING id`;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("an agreement was not written");
  return id;
}

export async function renameDocument(tx: TransactionSql, gymId: string, documentId: string, name: string): Promise<void> {
  await tx`UPDATE gym_agreement_documents SET name = ${name} WHERE gym_id = ${gymId} AND id = ${documentId} AND name IS NOT NULL`;
}

/** The lines of the price list in use, with the other agreement each uses (null: the main one). */
export async function agreementPrices(sql: SqlOrTx, gymId: string): Promise<{ id: string; name: string; agreementId: string | null }[]> {
  const rows = await sql<{ id: string; name: string; agreement_document_id: string | null }[]>`
    SELECT id, name, agreement_document_id FROM gym_membership_types
    WHERE gym_id = ${gymId} AND archived_at IS NULL ORDER BY lower(name), id`;
  return rows.map((row) => ({ id: row.id, name: row.name, agreementId: row.agreement_document_id }));
}

/** The lines of the price list this agreement is used for become exactly `typeIds`: those
 *  ticked move to it, and those in use it had and are not ticked go back to the main one; an
 *  archived line, never shown to tick, keeps its agreement for the members still holding it.
 *  False, with nothing written, where a line ticked is not one of the business's lines in use.
 *  The caller holds the gym's row lock. */
export async function setUsedFor(tx: TransactionSql, gymId: string, documentId: string, typeIds: readonly string[]): Promise<boolean> {
  const ids = [...new Set(typeIds)];
  const found = await tx<{ n: number }[]>`
    SELECT count(*)::int AS n FROM gym_membership_types WHERE gym_id = ${gymId} AND archived_at IS NULL AND id = ANY(${ids}::uuid[])`;
  if ((found[0]?.n ?? 0) !== ids.length) return false;
  await tx`
    UPDATE gym_membership_types SET agreement_document_id = NULL
    WHERE gym_id = ${gymId} AND agreement_document_id = ${documentId} AND id <> ALL(${ids}::uuid[])
      AND archived_at IS NULL`;
  await tx`
    UPDATE gym_membership_types SET agreement_document_id = ${documentId}
    WHERE gym_id = ${gymId} AND archived_at IS NULL AND id = ANY(${ids}::uuid[])
      AND agreement_document_id IS DISTINCT FROM ${documentId}::uuid`;
  return true;
}

/** THE AGREEMENT A LINE OF THE PRICE LIST USES, for a row `t` of `gym_membership_types`: the
 *  other agreement it names, or the business's main one. One rule, read by the desk's box, its
 *  signature, the person's page and the Members filter. */
export const typeDocumentSql = (sql: SqlOrTx) => sql`
  coalesce(t.agreement_document_id, (SELECT md.id FROM gym_agreement_documents md WHERE md.gym_id = t.gym_id AND md.name IS NULL))`;

/** The line of the price list, a row `t`, asks for its agreement today: that agreement's newest
 *  wording is not stopped. */
export const typeAskedSql = (sql: SqlOrTx) => sql`
  EXISTS (
    SELECT 1 FROM gym_agreements aa
    WHERE aa.gym_id = t.gym_id AND aa.document_id = ${typeDocumentSql(sql)} AND aa.stopped_at IS NULL
      AND aa.version = (SELECT max(ax.version) FROM gym_agreements ax WHERE ax.gym_id = aa.gym_id AND ax.document_id = aa.document_id))`;

/** The agreement one membership is signed with, by its line of the price list: which one, its
 *  name (null for the main one) and its newest wording. Null where the membership is not this
 *  business's, or the business never saved that agreement. */
export async function agreementForMembership(
  sql: SqlOrTx,
  gymId: string,
  membershipId: string,
): Promise<{ documentId: string; name: string | null; latest: AgreementRow | null } | null> {
  const rows = await sql<{ document_id: string | null; name: string | null }[]>`
    SELECT d.id AS document_id, d.name
    FROM gym_held_memberships h
    JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
    LEFT JOIN gym_agreement_documents d ON d.gym_id = t.gym_id AND d.id = ${typeDocumentSql(sql)}
    WHERE h.gym_id = ${gymId} AND h.id = ${membershipId}`;
  const row = rows[0];
  if (row === undefined || row.document_id === null) return null;
  return { documentId: row.document_id, name: row.name, latest: await latestOf(sql, gymId, row.document_id) };
}

/** Which of these memberships the business asks an agreement for today, by their lines of the
 *  price list. */
export async function askedFor(sql: SqlOrTx, gymId: string, membershipIds: readonly string[]): Promise<Set<string>> {
  if (membershipIds.length === 0) return new Set();
  const rows = await sql<{ id: string }[]>`
    SELECT h.id FROM gym_held_memberships h
    JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
    WHERE h.gym_id = ${gymId} AND h.id = ANY(${[...membershipIds]}::uuid[]) AND ${typeAskedSql(sql)}`;
  return new Set(rows.map((row) => row.id));
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
  /** The other agreement's name; null for the main one. */
  agreementName: string | null;
  via: "desk" | "link";
}

/** One membership's signature, with the words and details it was signed for. */
export async function signatureOf(sql: SqlOrTx, gymId: string, membershipId: string): Promise<SignatureRow | null> {
  const rows = await sql<
    {
      id: string;
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
    }[]
  >`
    SELECT s.id, s.signed_name, s.signer, s.signed_at, u.display_name AS by, a.version, a.body, s.facts, s.emailed_at, d.name AS agreement_name, s.signed_via
    FROM gym_agreement_signatures s
    JOIN gym_agreements a ON a.gym_id = s.gym_id AND a.id = s.agreement_id
    JOIN gym_agreement_documents d ON d.gym_id = a.gym_id AND d.id = a.document_id
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
    agreementName: row.agreement_name,
    via: row.signed_via === "link" ? "link" : "desk",
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

/** A link `l` of `gym_agreement_sign_links`, on the record `e` of its membership, works at `at`:
 *  its email went, it is not used, not expired, and the record's address is still the one it was
 *  sent to (18u-ii-b). */
const linkWorks = (sql: SqlOrTx, at: Date) => sql`
  l.emailed_at IS NOT NULL AND l.used_at IS NULL AND l.expires_at > ${at} AND e.email IS NOT NULL AND lower(e.email::text) = lower(l.sent_to)`;

/** A membership's agreement signed, at the desk or from the emailed link, in one statement:
 *  written only while the wording shown is the newest, and not stopped, of the agreement the
 *  membership's line of the price list uses, the membership is this record's and in use, the
 *  record is on the list today, and its date of birth is still the one the under-18 check read;
 *  from a link, also while that link works (`linkWorks`). The id of the signature written; null
 *  where nothing was, a second press of the same signature included. */
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
    /** The member of staff whose screen it was signed on; null from the emailed link. */
    witnessedBy: string | null;
    at: Date;
    /** Signed from the emailed link: the SHA-256 of its token. */
    linkTokenHash?: string;
  },
): Promise<string | null> {
  const hash = input.linkTokenHash ?? null;
  const rows = await sql<{ id: string }[]>`
    INSERT INTO gym_agreement_signatures (gym_id, agreement_id, held_membership_id, signer, signed_name, facts, witnessed_by, signed_at, signed_via)
    SELECT a.gym_id, a.id, h.id, ${input.signer}, ${input.name}, ${sql.json(input.facts.map((fact) => ({ label: fact.label, value: fact.value })))}, ${input.witnessedBy}, ${input.at},
      ${hash === null ? "desk" : "link"}
    FROM gym_agreements a
    JOIN gym_member_list_entries e ON e.gym_id = a.gym_id AND e.id = ${input.entryId} AND e.former_at IS NULL
    JOIN gym_held_memberships h ON h.gym_id = a.gym_id AND h.id = ${input.membershipId} AND h.entry_id = e.id AND h.status = 'active'
    JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
    WHERE a.gym_id = ${input.gymId} AND a.id = ${input.agreementId} AND a.stopped_at IS NULL
      AND a.document_id = ${typeDocumentSql(sql)}
      AND a.version = (SELECT max(x.version) FROM gym_agreements x WHERE x.gym_id = a.gym_id AND x.document_id = a.document_id)
      AND e.date_of_birth IS NOT DISTINCT FROM ${input.dateOfBirth}::date
      AND (${hash}::text IS NULL OR EXISTS (
        SELECT 1 FROM gym_agreement_sign_links l
        WHERE l.gym_id = h.gym_id AND l.held_membership_id = h.id AND l.token_hash = ${hash}::text AND ${linkWorks(sql, input.at)}))
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
 *  the day, and the purge removes them six years later; their links to sign go at once, with the
 *  address they were sent to (18u-ii-b), though a paid membership outlives its record. One record,
 *  or every record of the gym when `entryId` is null. Runs before the record goes, while its
 *  memberships name it. */
export async function letGoOfAgreementSignatures(tx: TransactionSql, gymId: string, entryId: string | null, at: Date): Promise<void> {
  await tx`
    DELETE FROM gym_agreement_sign_links l
    USING gym_held_memberships h
    WHERE l.gym_id = ${gymId} AND h.gym_id = l.gym_id AND h.id = l.held_membership_id
      AND h.entry_id IS NOT NULL AND (${entryId}::uuid IS NULL OR h.entry_id = ${entryId}::uuid)`;
  await tx`
    UPDATE gym_agreement_signatures s SET record_deleted_at = ${at}
    FROM gym_held_memberships h
    WHERE s.gym_id = ${gymId} AND h.gym_id = s.gym_id AND h.id = s.held_membership_id
      AND s.record_deleted_at IS NULL AND h.entry_id IS NOT NULL
      AND (${entryId}::uuid IS NULL OR h.entry_id = ${entryId}::uuid)`;
}

// ── The emailed link to sign (18u-ii-b; migration 0162) ──

/** Writes a membership's link, over the one it had, and claims its email, in one statement:
 *  never for a membership already signed; otherwise only where it has none, its last was sent
 *  more than a minute ago, or the record's address has changed since; so two presses at once send
 *  one. It works until the start of `endsBefore` in the business's time zone, the day after its
 *  last. Not counted as sent until `linkEmailed`. When it ends where written; null where not. */
export async function claimLink(
  sql: SqlOrTx,
  input: { gymId: string; membershipId: string; tokenHash: string; sentTo: string; sentBy: string; at: Date; endsBefore: string; timezone: string },
): Promise<Date | null> {
  const rows = await sql<{ expires_at: Date }[]>`
    INSERT INTO gym_agreement_sign_links AS l (gym_id, held_membership_id, token_hash, sent_to, sent_by, sent_at, expires_at)
    SELECT ${input.gymId}, ${input.membershipId}, ${input.tokenHash}, ${input.sentTo}, ${input.sentBy}, ${input.at},
      (${input.endsBefore}::date)::timestamp AT TIME ZONE ${input.timezone}
    WHERE NOT EXISTS (SELECT 1 FROM gym_agreement_signatures s WHERE s.gym_id = ${input.gymId} AND s.held_membership_id = ${input.membershipId})
    ON CONFLICT (held_membership_id) DO UPDATE SET
      token_hash = excluded.token_hash, sent_to = excluded.sent_to, sent_by = excluded.sent_by,
      sent_at = excluded.sent_at, expires_at = excluded.expires_at, emailed_at = NULL, used_at = NULL
    WHERE l.gym_id = excluded.gym_id
      AND (l.sent_at < ${input.at}::timestamptz - interval '1 minute' OR lower(l.sent_to) <> lower(excluded.sent_to))
    RETURNING l.expires_at`;
  return rows[0]?.expires_at ?? null;
}

/** The link's email went: from now on it opens its page and the person's page names it. */
export async function linkEmailed(sql: SqlOrTx, gymId: string, tokenHash: string, at: Date): Promise<void> {
  await sql`UPDATE gym_agreement_sign_links SET emailed_at = ${at} WHERE gym_id = ${gymId} AND token_hash = ${tokenHash} AND emailed_at IS NULL`;
}

/** A membership's link as it stands: none, its email still going, or emailed. */
export async function linkState(sql: SqlOrTx, gymId: string, membershipId: string): Promise<"none" | "sending" | "emailed"> {
  const rows = await sql<{ emailed: boolean }[]>`
    SELECT emailed_at IS NOT NULL AS emailed FROM gym_agreement_sign_links WHERE gym_id = ${gymId} AND held_membership_id = ${membershipId}`;
  const row = rows[0];
  return row === undefined ? "none" : row.emailed ? "emailed" : "sending";
}

/** The link whose email did not go: it is removed, so nothing says it was sent. */
export async function dropLink(sql: SqlOrTx, gymId: string, tokenHash: string): Promise<void> {
  await sql`DELETE FROM gym_agreement_sign_links WHERE gym_id = ${gymId} AND token_hash = ${tokenHash}`;
}

export interface LinkRow {
  gymId: string;
  entryId: string;
  membershipId: string;
  expiresAt: Date;
  /** It was used, or it ran out. */
  spent: boolean;
}

/** The link a token's hash names, on a record on the business's list today whose address is
 *  still the one it was sent to; null otherwise. Used or run out, it is still found: the page
 *  says so. */
export async function linkByToken(sql: SqlOrTx, tokenHash: string, at: Date): Promise<LinkRow | null> {
  const rows = await sql<{ gym_id: string; entry_id: string; held_membership_id: string; expires_at: Date; works: boolean }[]>`
    SELECT l.gym_id, e.id AS entry_id, l.held_membership_id, l.expires_at, (${linkWorks(sql, at)}) AS works
    FROM gym_agreement_sign_links l
    JOIN gym_held_memberships h ON h.gym_id = l.gym_id AND h.id = l.held_membership_id
    JOIN gym_member_list_entries e ON e.gym_id = h.gym_id AND e.id = h.entry_id AND e.former_at IS NULL
    WHERE l.token_hash = ${tokenHash} AND e.email IS NOT NULL AND lower(e.email::text) = lower(l.sent_to)`;
  const row = rows[0];
  return row === undefined
    ? null
    : { gymId: row.gym_id, entryId: row.entry_id, membershipId: row.held_membership_id, expiresAt: row.expires_at, spent: !row.works };
}

/** Holds the link's row until the transaction ends, so a link sent again waits for this signing. */
export async function lockLink(tx: TransactionSql, gymId: string, tokenHash: string): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`SELECT id FROM gym_agreement_sign_links WHERE gym_id = ${gymId} AND token_hash = ${tokenHash} FOR UPDATE`;
  return rows.length > 0;
}

export async function useLink(tx: TransactionSql, gymId: string, tokenHash: string, at: Date): Promise<void> {
  await tx`UPDATE gym_agreement_sign_links SET used_at = ${at} WHERE gym_id = ${gymId} AND token_hash = ${tokenHash} AND used_at IS NULL`;
}

/** These memberships' links that work at `at`: when each was sent and until when it works. */
export async function workingLinksOf(sql: SqlOrTx, gymId: string, membershipIds: readonly string[], at: Date): Promise<Map<string, { sentAt: Date; expiresAt: Date }>> {
  if (membershipIds.length === 0) return new Map();
  const rows = await sql<{ held_membership_id: string; sent_at: Date; expires_at: Date }[]>`
    SELECT l.held_membership_id, l.sent_at, l.expires_at
    FROM gym_agreement_sign_links l
    JOIN gym_held_memberships h ON h.gym_id = l.gym_id AND h.id = l.held_membership_id
    JOIN gym_member_list_entries e ON e.gym_id = h.gym_id AND e.id = h.entry_id
    WHERE l.gym_id = ${gymId} AND l.held_membership_id = ANY(${[...membershipIds]}::uuid[]) AND ${linkWorks(sql, at)}`;
  return new Map(rows.map((row) => [row.held_membership_id, { sentAt: row.sent_at, expiresAt: row.expires_at }]));
}
