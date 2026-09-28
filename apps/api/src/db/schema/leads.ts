// A GYM'S LEADS (spec Part 3 §16.3; ROADMAP Stage 2 item 20c-i). Mirrors
// `0046_gym_leads.sql` and `0047_lead_follow_ups.sql`, which are the record.
//
// People who asked about the gym and have not joined. Held for the gym, like the
// member list: the only user link is which member of staff added the lead, so the
// table is on `USER_LINKED_NOT_PURGED_TABLES`, and a closed gym's leads are deleted
// with its list (`archiveSweep.ts`).
import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
    /** Follow-up emails staff have marked as sent from the gym's own mailbox (20c-ii,
     *  `0047_lead_follow_ups.sql`), and when the last one was. */
    followUpsSent: smallint("follow_ups_sent").notNull().default(0),
    followUpLastAt: timestamp("follow_up_last_at", { withTimezone: true }),
    /** The gym's day the next one is due (`followUpDueOn`); null when none is. */
    followUpDueOn: date("follow_up_due_on", { mode: "string" }),
    /** When the person last sent the gym page's form (20c-iv-a). */
    enquiredAt: timestamp("enquired_at", { withTimezone: true }),
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
    check("gym_leads_follow_ups_sent_check", sql`${t.followUpsSent} BETWEEN 0 AND 3`),
    check("gym_leads_follow_up_last_check", sql`(${t.followUpsSent} = 0) = (${t.followUpLastAt} IS NULL)`),
    check(
      "gym_leads_follow_up_due_check",
      sql`${t.followUpDueOn} IS NULL OR (${t.status} = 'new' AND ${t.emailOkAt} IS NOT NULL AND ${t.followUpsSent} < 3)`,
    ),
    index("gym_leads_follow_up_due_idx").on(t.gymId, t.followUpDueOn).where(sql`${t.followUpDueOn} IS NOT NULL`),
    uniqueIndex("gym_leads_gym_id_uq").on(t.gymId, t.id),
  ],
);

/** A gym's own page (20c-iv-a): off until the gym switches it on. */
export const gymPages = pgTable(
  "gym_pages",
  {
    gymId: uuid("gym_id")
      .primaryKey()
      .references(() => gyms.id, { onDelete: "cascade" }),
    shown: boolean("shown").notNull().default(false),
    about: text("about").notNull().default(""),
    facilities: text("facilities").array().notNull().default(sql`'{}'`),
    ownFacilities: text("own_facilities").array().notNull().default(sql`'{}'`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("gym_pages_about_len_check", sql`char_length(${t.about}) <= 1000`),
    check("gym_pages_facilities_check", sql`cardinality(${t.facilities}) <= 40`),
    check("gym_pages_own_facilities_check", sql`cardinality(${t.ownFacilities}) <= 10`),
  ],
);

/** Each message a person sent through the gym page's form, kept on their lead (the
 *  newest 20). Deleted with the lead. */
export const gymLeadEnquiries = pgTable(
  "gym_lead_enquiries",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id").notNull(),
    leadId: uuid("lead_id").notNull(),
    fullName: text("full_name").notNull(),
    email: citext("email"),
    phoneE164: text("phone_e164"),
    source: text("source"),
    message: text("message").notNull().default(""),
    mayEmail: boolean("may_email").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "gym_lead_enquiries_lead_fk", columns: [t.gymId, t.leadId], foreignColumns: [gymLeads.gymId, gymLeads.id] }).onDelete(
      "cascade",
    ),
    check("gym_lead_enquiries_name_len_check", sql`char_length(${t.fullName}) BETWEEN 1 AND 120`),
    check("gym_lead_enquiries_contact_check", sql`${t.email} IS NOT NULL OR ${t.phoneE164} IS NOT NULL`),
    check("gym_lead_enquiries_source_check", sql`${t.source} IS NULL OR ${t.source} IN ('walk_in','website','social','friend','other')`),
    check("gym_lead_enquiries_message_len_check", sql`char_length(${t.message}) <= 1000`),
    index("gym_lead_enquiries_lead_idx").on(t.gymId, t.leadId, t.createdAt.desc(), t.id),
  ],
);
