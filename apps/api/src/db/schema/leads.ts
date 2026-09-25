// A GYM'S LEADS (spec Part 3 §16.3; ROADMAP Stage 2 item 20c-i). Mirrors
// `0046_gym_leads.sql`, which is the record.
//
// People who asked about the gym and have not joined. Held for the gym, like the
// member list: the only user link is which member of staff added the lead, so the
// table is on `USER_LINKED_NOT_PURGED_TABLES`, and a closed gym's leads are deleted
// with its list (`archiveSweep.ts`).
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { citext, createdAt } from "./common.js";
import { users } from "./identity.js";
import { gyms } from "./tenancy.js";

export const gymLeads = pgTable(
  "gym_leads",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(),
    email: citext("email"),
    phoneE164: text("phone_e164"),
    source: text("source").notNull(),
    status: text("status").notNull().default("new"),
    notes: text("notes").notNull().default(""),
    /** When staff ticked "Happy to hear from us"; only with an email. */
    emailOkAt: timestamp("email_ok_at", { withTimezone: true }),
    /** The member record a joined lead is on the list as. Set only with "joined";
     *  a record deleted later leaves the lead joined with no link. The foreign key is
     *  `(gym_id, entry_id)` → the record's `(gym_id, id)`, ON DELETE SET NULL
     *  (entry_id) — written in `0046_gym_leads.sql`, which Drizzle's builder cannot
     *  express. */
    entryId: uuid("entry_id"),
    addedBy: uuid("added_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("gym_leads_name_len_check", sql`char_length(${t.fullName}) BETWEEN 1 AND 120`),
    check("gym_leads_contact_check", sql`${t.email} IS NOT NULL OR ${t.phoneE164} IS NOT NULL`),
    check("gym_leads_source_check", sql`${t.source} IN ('walk_in','website','social','friend','other')`),
    check("gym_leads_status_check", sql`${t.status} IN ('new','contacted','on_trial','joined','lost')`),
    check("gym_leads_notes_len_check", sql`char_length(${t.notes}) <= 2000`),
    check("gym_leads_email_ok_check", sql`${t.emailOkAt} IS NULL OR ${t.email} IS NOT NULL`),
    check("gym_leads_entry_check", sql`${t.entryId} IS NULL OR ${t.status} = 'joined'`),
    uniqueIndex("gym_leads_gym_email_uq").on(t.gymId, t.email).where(sql`${t.email} IS NOT NULL`),
    uniqueIndex("gym_leads_gym_phone_uq").on(t.gymId, t.phoneE164).where(sql`${t.phoneE164} IS NOT NULL`),
    index("gym_leads_gym_created_idx").on(t.gymId, t.createdAt, t.id),
    index("gym_leads_gym_status_created_idx").on(t.gymId, t.status, t.createdAt, t.id),
    index("gym_leads_entry_idx").on(t.entryId).where(sql`${t.entryId} IS NOT NULL`),
  ],
);
