// A GYM'S LEADS (spec Part 3 §16.3; ROADMAP Stage 2 item 20c-i). Mirrors
// `0046_gym_leads.sql` and `0047_lead_follow_ups.sql`, which are the record.
//
// People who asked about the gym and have not joined. Held for the gym, like the
// member list: the only user link is which member of staff added the lead, so the
// table is on `USER_LINKED_NOT_PURGED_TABLES`, and a closed gym's leads are deleted
// with its list (`archiveSweep.ts`).
import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, integer, pgTable, smallint, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
    index("gym_leads_follow_up_due_order_idx").on(t.gymId, t.followUpDueOn, t.createdAt, t.id).where(sql`${t.followUpDueOn} IS NOT NULL`),
    uniqueIndex("gym_leads_gym_id_uq").on(t.gymId, t.id),
  ],
);

/** "Send them for me" (20c-v; `0051_lead_emails_sent_for_you.sql`): the gym's switch, and
 *  where replies go, since the app's sending address has no inbox. */
export const gymLeadEmailSettings = pgTable(
  "gym_lead_email_settings",
  {
    gymId: uuid("gym_id")
      .primaryKey()
      .references(() => gyms.id, { onDelete: "cascade" }),
    sendForMe: boolean("send_for_me").notNull().default(false),
    replyTo: citext("reply_to"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("gym_lead_email_settings_reply_to_check", sql`${t.replyTo} IS NULL OR length(${t.replyTo}) BETWEEN 3 AND 254`),
    check("gym_lead_email_settings_on_check", sql`NOT ${t.sendForMe} OR ${t.replyTo} IS NOT NULL`),
  ],
);

/** Each follow-up the app takes (20c-v): one row per lead, tick and step, whatever
 *  became of it. The foreign key `(gym_id, lead_id)` → the lead, ON DELETE SET NULL
 *  (lead_id), is written in `0051_lead_emails_sent_for_you.sql`. The address is kept
 *  only while the email is being sent (a CHECK); its HMAC stays for the unsubscribe
 *  link. */
export const gymLeadSends = pgTable(
  "gym_lead_sends",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id"),
    okAt: timestamp("ok_at", { withTimezone: true }).notNull(),
    step: smallint("step").notNull(),
    month: text("month").notNull(),
    counted: boolean("counted").notNull(),
    email: citext("email"),
    emailHmac: text("email_hmac").notNull(),
    state: text("state").notNull().default("sending"),
    reason: text("reason"),
    attempts: integer("attempts").notNull().default(1),
    notBefore: timestamp("not_before", { withTimezone: true }).notNull(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    maybeSentAt: timestamp("maybe_sent_at", { withTimezone: true }),
    providerId: text("provider_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("gym_lead_sends_step_uq").on(t.leadId, t.okAt, t.step),
    index("gym_lead_sends_lead_idx").on(t.gymId, t.leadId, t.okAt),
    index("gym_lead_sends_due_idx").on(t.notBefore, t.id).where(sql`${t.state} IN ('queued','sending')`),
    index("gym_lead_sends_month_idx").on(t.gymId, t.month).where(sql`${t.counted}`),
    index("gym_lead_sends_sent_idx").on(t.finishedAt).where(sql`${t.state} = 'sent'`),
    check("gym_lead_sends_step_check", sql`${t.step} BETWEEN 1 AND 3`),
    check("gym_lead_sends_month_check", sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check("gym_lead_sends_email_hmac_check", sql`${t.emailHmac} ~ '^[0-9a-f]{64}$'`),
    check("gym_lead_sends_state_check", sql`${t.state} IN ('queued','sending','sent','skipped','failed')`),
    check("gym_lead_sends_email_check", sql`${t.state} IN ('queued','sending') OR ${t.email} IS NULL`),
    check("gym_lead_sends_email_length_check", sql`${t.email} IS NULL OR length(${t.email}) <= 254`),
    check("gym_lead_sends_lease_check", sql`(${t.state} = 'sending') = (${t.leaseUntil} IS NOT NULL)`),
    check("gym_lead_sends_finished_check", sql`(${t.state} IN ('sent','skipped','failed')) = (${t.finishedAt} IS NOT NULL)`),
    check("gym_lead_sends_reason_check", sql`(${t.state} IN ('skipped','failed')) = (${t.reason} IS NOT NULL)`),
    check("gym_lead_sends_reason_shape_check", sql`${t.reason} IS NULL OR ${t.reason} ~ '^[a-z_]{1,40}$'`),
    check("gym_lead_sends_provider_check", sql`${t.providerId} IS NULL OR (${t.state} = 'sent' AND length(${t.providerId}) <= 100)`),
    check("gym_lead_sends_attempts_check", sql`${t.attempts} >= 0`),
    check(
      "gym_lead_sends_counted_check",
      sql`NOT ${t.counted} OR ${t.state} IN ('queued','sending','sent') OR ${t.reason} = 'send_unknown'`,
    ),
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

/** The photos on a gym's page (20c-iv-b; `0050_gym_page_photos.sql`, which is the
 *  record — its position constraint is DEFERRABLE there, which Drizzle cannot say). The
 *  file is in the photo store under `storage_key`. */
export const gymPagePhotos = pgTable(
  "gym_page_photos",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    position: smallint("position").notNull(),
    uploadKey: uuid("upload_key").notNull(),
    addedBy: uuid("added_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("gym_page_photos_storage_key_uq").on(t.storageKey),
    unique("gym_page_photos_position_uq").on(t.gymId, t.position),
    unique("gym_page_photos_upload_key_uq").on(t.gymId, t.uploadKey),
    check("gym_page_photos_type_check", sql`${t.contentType} IN ('image/jpeg','image/png','image/webp')`),
    check("gym_page_photos_size_check", sql`${t.byteSize} BETWEEN 1 AND 2097152`),
    check("gym_page_photos_width_check", sql`${t.width} BETWEEN 1 AND 8000`),
    check("gym_page_photos_height_check", sql`${t.height} BETWEEN 1 AND 8000`),
    check("gym_page_photos_position_check", sql`${t.position} BETWEEN 0 AND 9`),
  ],
);
