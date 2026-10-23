// A business's membership agreement and its signatures (ROADMAP 18u-i). Mirrors
// `0159_membership_agreement.sql`.
//
// Every wording a business saves is a row, numbered from 1, as a waiver's is; its agreement
// today is the highest version, unless `stoppedAt` is set. A signature is one membership's,
// made at the desk, and keeps the membership's details as the screen showed them.
import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity.js";
import { gymHeldMemberships } from "./memberships.js";
import { gyms } from "./tenancy.js";

export const gymAgreements = pgTable(
  "gym_agreements",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    body: text("body").notNull(),
    savedBy: uuid("saved_by").references(() => users.id, { onDelete: "set null" }),
    savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
  },
  (t) => [
    check("gym_agreements_version_check", sql`${t.version} >= 1`),
    check("gym_agreements_body_check", sql`char_length(${t.body}) BETWEEN 1 AND 30000`),
    unique("gym_agreements_gym_version_uq").on(t.gymId, t.version),
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
    recordDeletedAt: timestamp("record_deleted_at", { withTimezone: true }),
  },
  (t) => [
    check("gym_agreement_signatures_signer_check", sql`${t.signer} IN ('person', 'guardian')`),
    check("gym_agreement_signatures_name_check", sql`char_length(${t.signedName}) BETWEEN 2 AND 100`),
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
