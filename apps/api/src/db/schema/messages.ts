// A GYM'S MESSAGES TO A MEMBER (spec Part 3 §16.1; ROADMAP 20a). Mirrors
// `0088_gym_member_messages.sql`, which is the record.
//
// About the person: deleted with their account (`DIRECT_DELETE_TABLES`) and exported.
import { sql } from "drizzle-orm";
import { check, date, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
      sql`${t.kind} IN ('payment_overdue','membership_ending','trial_ending','trial_check_in','welcome','birthday','milestone','miss_you')`,
    ),
    check("gym_member_messages_occasion_check", sql`length(${t.occasion}) BETWEEN 1 AND 80`),
    check("gym_member_messages_body_check", sql`length(${t.body}) BETWEEN 1 AND 500`),
    check("gym_member_messages_expires_check", sql`${t.expiresAt} > ${t.sentAt}`),
  ],
);
