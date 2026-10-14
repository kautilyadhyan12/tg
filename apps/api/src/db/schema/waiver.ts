// A gym's waiver and who signed it (ROADMAP 3e-i). Mirrors `0103_gym_waiver.sql`.
//
// Every wording a gym saves is a row, numbered from 1; its waiver today is the highest
// version, unless `stoppedAt` is set. A signature names the wording the person was shown.
import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity.js";
import { gyms } from "./tenancy.js";

export const gymWaivers = pgTable(
  "gym_waivers",
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
    check("gym_waivers_version_check", sql`${t.version} >= 1`),
    check("gym_waivers_body_check", sql`char_length(${t.body}) BETWEEN 1 AND 30000`),
    unique("gym_waivers_gym_version_uq").on(t.gymId, t.version),
    unique("gym_waivers_gym_id_uq").on(t.gymId, t.id),
  ],
);

export const gymWaiverSignatures = pgTable(
  "gym_waiver_signatures",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id").notNull(),
    waiverId: uuid("waiver_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    signedName: text("signed_name").notNull(),
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("gym_waiver_signatures_name_check", sql`char_length(${t.signedName}) BETWEEN 2 AND 100`),
    foreignKey({ name: "gym_waiver_signatures_waiver_fk", columns: [t.gymId, t.waiverId], foreignColumns: [gymWaivers.gymId, gymWaivers.id] }).onDelete(
      "cascade",
    ),
    unique("gym_waiver_signatures_one_uq").on(t.waiverId, t.userId),
    index("gym_waiver_signatures_user_idx").on(t.userId),
  ],
);

/** A waiver signed at the desk (3e-ii; `0106_waiver_at_the_desk.sql`): a record's, never an
 *  app account's. `signer` says whether the person or a parent or guardian signed;
 *  `witnessedBy` is the staff member who opened the screen. */
export const gymWaiverDeskSignatures = pgTable(
  "gym_waiver_desk_signatures",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id").notNull(),
    waiverId: uuid("waiver_id").notNull(),
    entryId: uuid("entry_id"),
    signer: text("signer").notNull(),
    signedName: text("signed_name").notNull(),
    witnessedBy: uuid("witnessed_by").references(() => users.id, { onDelete: "set null" }),
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
    /** The day its record was deleted for good (`0107`): the purge removes it six years later. */
    recordDeletedAt: timestamp("record_deleted_at", { withTimezone: true }),
  },
  (t) => [
    check("gym_waiver_desk_signatures_signer_check", sql`${t.signer} IN ('person', 'guardian')`),
    check("gym_waiver_desk_signatures_name_check", sql`char_length(${t.signedName}) BETWEEN 2 AND 100`),
    foreignKey({ name: "gym_waiver_desk_signatures_waiver_fk", columns: [t.gymId, t.waiverId], foreignColumns: [gymWaivers.gymId, gymWaivers.id] }).onDelete(
      "cascade",
    ),
    unique("gym_waiver_desk_signatures_one_uq").on(t.waiverId, t.entryId),
    index("gym_waiver_desk_signatures_entry_idx").on(t.gymId, t.entryId),
  ],
);
