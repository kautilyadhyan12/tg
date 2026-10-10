// A GYM'S MESSAGES TO A MEMBER (spec Part 3 §16.1; ROADMAP 20a). Mirrors
// `0088_gym_member_messages.sql`, which is the record.
//
// About the person: deleted with their account (`DIRECT_DELETE_TABLES`) and exported.
// `gym_group_messages` and `gym_member_messages_off` mirror `0092_group_messages.sql`;
// `gym_message_settings` mirrors `0095_gym_message_settings.sql`.
import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity.js";
import { gyms } from "./tenancy.js";

export const gymMemberMessages = pgTable(
  "gym_member_messages",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    /** One message is ever sent for (gym, person, kind, occasion). */
    occasion: text("occasion").notNull(),
    /** The words as sent. */
    body: text("body").notNull(),
    /** The gym's own date it was sent on. */
    gymDay: date("gym_day").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
    /** Out of the inbox from here on; the row stays, so the occasion is not sent again. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("gym_member_messages_occasion_uq").on(t.gymId, t.userId, t.kind, t.occasion),
    index("gym_member_messages_inbox_idx").on(t.userId, t.gymId, t.sentAt.desc()),
    check(
      "gym_member_messages_kind_check",
      sql`${t.kind} IN ('payment_overdue','membership_ending','trial_ending','trial_check_in','welcome','birthday','milestone','miss_you','group')`,
    ),
    check("gym_member_messages_occasion_check", sql`length(${t.occasion}) BETWEEN 1 AND 80`),
    check("gym_member_messages_body_check", sql`length(${t.body}) BETWEEN 1 AND 500`),
    check("gym_member_messages_expires_check", sql`${t.expiresAt} > ${t.sentAt}`),
  ],
);

/** A message staff typed for the people they chose (ROADMAP 20f-i). Each person's copy is a
 *  `gym_member_messages` row of kind `group` whose occasion is this row's id. */
export const gymGroupMessages = pgTable(
  "gym_group_messages",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    /** The gym's record of who sent it, kept when their account goes. */
    sentBy: uuid("sent_by").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    gymDay: date("gym_day").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    people: integer("people").notNull(),
    /** Made once for the box it was sent from: the same press again sends nothing more. */
    sendKey: uuid("send_key").notNull(),
  },
  (t) => [
    uniqueIndex("gym_group_messages_key_uq").on(t.gymId, t.sendKey),
    index("gym_group_messages_day_idx").on(t.gymId, t.gymDay),
    check("gym_group_messages_body_check", sql`length(${t.body}) BETWEEN 1 AND 500`),
    check("gym_group_messages_people_check", sql`${t.people} >= 1`),
  ],
);

/** A kind of message a person has switched off at one gym. About the person: deleted with
 *  their account and exported. */
export const gymMemberMessagesOff = pgTable(
  "gym_member_messages_off",
  {
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "gym_member_messages_off_pk", columns: [t.gymId, t.userId, t.kind] }),
    check(
      "gym_member_messages_off_kind_check",
      sql`${t.kind} IN ('membership_ending','trial_ending','trial_check_in','welcome','birthday','milestone','miss_you','group')`,
    ),
  ],
);

/** The last day, on the gym's own calendar, on which the sender read everybody in the gym
 *  (ROADMAP 20b-i). Removed when the gym changes its settings. */
export const gymMessageDays = pgTable("gym_message_days", {
  gymId: uuid("gym_id")
    .primaryKey()
    .references(() => gyms.id, { onDelete: "cascade" }),
  day: date("day").notNull(),
});

/** A gym's own settings for one kind of automatic message (ROADMAP 20b-i). The gym's, not
 *  about a person. A kind with no row has its starting values. */
export const gymMessageSettings = pgTable(
  "gym_message_settings",
  {
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    isOn: boolean("is_on").notNull().default(true),
    /** The gym's one line of its own under this kind's fixed words. */
    ownLine: text("own_line"),
    days: integer("days"),
    milestones: integer("milestones").array(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "gym_message_settings_pk", columns: [t.gymId, t.kind] }),
    check(
      "gym_message_settings_kind_check",
      sql`${t.kind} IN ('payment_overdue','membership_ending','trial_ending','trial_check_in','welcome','birthday','milestone','miss_you')`,
    ),
    check("gym_message_settings_own_line_check", sql`${t.ownLine} IS NULL OR length(${t.ownLine}) BETWEEN 1 AND 140`),
    check("gym_message_settings_days_check", sql`${t.days} IS NULL OR ${t.days} BETWEEN 1 AND 90`),
    check(
      "gym_message_settings_milestones_check",
      sql`${t.milestones} IS NULL OR (cardinality(${t.milestones}) BETWEEN 1 AND 10 AND 1 <= ALL (${t.milestones}))`,
    ),
  ],
);
