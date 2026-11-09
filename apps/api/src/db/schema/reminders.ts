// The workout and meal reminders a person sets (ROADMAP Stage 5 item 19e-i). One row a kind, made when
// the person first saves it; no row is a reminder that is off.
import { sql } from "drizzle-orm";
import { boolean, check, date, index, pgTable, primaryKey, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./common.js";
import { users } from "./identity.js";

export const trainingReminders = pgTable(
  "training_reminders",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    isOn: boolean("is_on").notNull().default(false),
    /** Minutes after midnight on the person's own clock. */
    minute: smallint("minute").notNull(),
    /** Monday 1 … Sunday 64; a meal's are all seven (127). */
    days: smallint("days").notNull().default(127),
    /** The person's own day it last went or was skipped by the worker: at most once a day. */
    sentDay: date("sent_day"),
    /** The person's own day a save at a time already past held: that day's does not go, so a save never
     *  sends at once. A later save at a time still to come clears it (19e-iii). */
    heldDay: date("held_day"),
    /** Paused by itself: the person had not opened the app for a week when it came due. */
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.kind] }),
    check("training_reminders_kind_check", sql`${t.kind} IN ('workout','breakfast','lunch','dinner')`),
    check("training_reminders_minute_check", sql`${t.minute} BETWEEN 0 AND 1439`),
    check("training_reminders_days_check", sql`${t.days} BETWEEN 1 AND 127`),
    index("training_reminders_on_idx").on(t.minute).where(sql`${t.isOn} AND ${t.pausedAt} IS NULL`),
  ],
);
