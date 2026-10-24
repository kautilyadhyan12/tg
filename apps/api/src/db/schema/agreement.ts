// A business's membership agreements and their signatures (ROADMAP 18u-i, 18u-ii-a, 18u-ii-b).
// Mirrors `0159_membership_agreement.sql`, `0161_agreement_per_price.sql` and
// `0162_agreement_sign_links.sql`.
//
// A business has its main agreement (`name` null) and may write others, each named; a line of
// the price list uses the one it names, or the main one. Every wording saved is a row, numbered
// from 1 within its agreement, as a waiver's is; an agreement today is its highest version,
// unless `stoppedAt` is set. A signature is one membership's, made at the desk or from the emailed
// link, and keeps the membership's details as the screen showed them.
import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity.js";
import { gymHeldMemberships } from "./memberships.js";
import { gyms } from "./tenancy.js";

export const gymAgreementDocuments = pgTable(
  "gym_agreement_documents",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    /** Null for the business's main agreement. */
    name: text("name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("gym_agreement_documents_name_check", sql`${t.name} IS NULL OR char_length(${t.name}) BETWEEN 1 AND 60`),
    unique("gym_agreement_documents_gym_id_uq").on(t.gymId, t.id),
    uniqueIndex("gym_agreement_documents_main_uq")
      .on(t.gymId)
      .where(sql`${t.name} IS NULL`),
    uniqueIndex("gym_agreement_documents_name_uq")
      .on(t.gymId, sql`lower(${t.name})`)
      .where(sql`${t.name} IS NOT NULL`),
  ],
);

export const gymAgreements = pgTable(
  "gym_agreements",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").notNull(),
    version: integer("version").notNull(),
    body: text("body").notNull(),
    savedBy: uuid("saved_by").references(() => users.id, { onDelete: "set null" }),
    savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
  },
  (t) => [
    check("gym_agreements_version_check", sql`${t.version} >= 1`),
    check("gym_agreements_body_check", sql`char_length(${t.body}) BETWEEN 1 AND 30000`),
    unique("gym_agreements_document_version_uq").on(t.documentId, t.version),
    foreignKey({ name: "gym_agreements_document_fk", columns: [t.gymId, t.documentId], foreignColumns: [gymAgreementDocuments.gymId, gymAgreementDocuments.id] }).onDelete(
      "cascade",
    ),
    unique("gym_agreements_gym_id_uq").on(t.gymId, t.id),
  ],
);

export const gymAgreementSignatures = pgTable(
  "gym_agreement_signatures",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id").notNull(),
    agreementId: uuid("agreement_id").notNull(),
    /** Null once its membership went with a record deleted for good; `recordDeletedAt` says when. */
    heldMembershipId: uuid("held_membership_id"),
    signer: text("signer").notNull(),
    signedName: text("signed_name").notNull(),
    /** The membership's details as the screen showed them: `{ label, value }[]`. */
    facts: jsonb("facts").notNull(),
    witnessedBy: uuid("witnessed_by").references(() => users.id, { onDelete: "set null" }),
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
    /** 'desk' or 'link' (18u-ii-b). */
    signedVia: text("signed_via").notNull().default("desk"),
    recordDeletedAt: timestamp("record_deleted_at", { withTimezone: true }),
  },
  (t) => [
    check("gym_agreement_signatures_signer_check", sql`${t.signer} IN ('person', 'guardian')`),
    check("gym_agreement_signatures_name_check", sql`char_length(${t.signedName}) BETWEEN 2 AND 100`),
    check("gym_agreement_signatures_via_check", sql`${t.signedVia} IN ('desk', 'link')`),
    check("gym_agreement_signatures_facts_check", sql`jsonb_typeof(${t.facts}) = 'array' AND jsonb_array_length(${t.facts}) BETWEEN 1 AND 30`),
    foreignKey({ name: "gym_agreement_signatures_agreement_fk", columns: [t.gymId, t.agreementId], foreignColumns: [gymAgreements.gymId, gymAgreements.id] }).onDelete(
      "cascade",
    ),
    // `0159` clears only `held_membership_id` when the membership goes; Drizzle cannot say which column.
    foreignKey({
      name: "gym_agreement_signatures_membership_fk",
      columns: [t.gymId, t.heldMembershipId],
      foreignColumns: [gymHeldMemberships.gymId, gymHeldMemberships.id],
    }),
    unique("gym_agreement_signatures_one_uq").on(t.heldMembershipId),
    index("gym_agreement_signatures_membership_idx").on(t.gymId, t.heldMembershipId),
    index("gym_agreement_signatures_deleted_idx")
      .on(t.recordDeletedAt)
      .where(sql`${t.recordDeletedAt} IS NOT NULL`),
  ],
);

/** The emailed link to sign one membership's agreement (18u-ii-b): the newest only, kept as the
 *  SHA-256 of its token, in hex. */
export const gymAgreementSignLinks = pgTable(
  "gym_agreement_sign_links",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id").notNull(),
    heldMembershipId: uuid("held_membership_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    /** The record's address it was sent to: the link works only while the record still has it. */
    sentTo: text("sent_to").notNull(),
    sentBy: uuid("sent_by").references(() => users.id, { onDelete: "set null" }),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "gym_agreement_sign_links_membership_fk",
      columns: [t.gymId, t.heldMembershipId],
      foreignColumns: [gymHeldMemberships.gymId, gymHeldMemberships.id],
    }).onDelete("cascade"),
    unique("gym_agreement_sign_links_one_uq").on(t.heldMembershipId),
    unique("gym_agreement_sign_links_token_uq").on(t.tokenHash),
    check("gym_agreement_sign_links_token_check", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check("gym_agreement_sign_links_sent_to_check", sql`char_length(${t.sentTo}) BETWEEN 3 AND 320`),
    check("gym_agreement_sign_links_expiry_check", sql`${t.expiresAt} > ${t.sentAt}`),
  ],
);
