// A gym gone for good (ROADMAP Stage 4 item 14). Mirrors `0113_gym_gone_for_good.sql`.
//
// One row a gym, made the first time it comes due: the two emails of this round and the
// day its list was deleted. A sign-in or a plan since `countedFrom` starts a new round.
import { sql } from "drizzle-orm";
import { check, integer, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { gyms } from "./tenancy.js";

export const gymGoneForGood = pgTable(
  "gym_gone_for_good",
  {
    gymId: uuid("gym_id")
      .primaryKey()
      .references(() => gyms.id, { onDelete: "cascade" }),
    /** The later of the plan's end (or the gym's start, with no plan ever) and the last
     *  sign-in of its staff, when this round began. */
    countedFrom: timestamp("counted_from", { withTimezone: true }).notNull(),
    /** The day the emails name; never earlier than 30 days after the first one went. */
    deletesAt: timestamp("deletes_at", { withTimezone: true }),
    monthClaimedAt: timestamp("month_claimed_at", { withTimezone: true }),
    monthSentAt: timestamp("month_sent_at", { withTimezone: true }),
    monthRecipients: integer("month_recipients"),
    weekClaimedAt: timestamp("week_claimed_at", { withTimezone: true }),
    weekSentAt: timestamp("week_sent_at", { withTimezone: true }),
    weekRecipients: integer("week_recipients"),
    /** Kept through a new round, for the Members page. */
    listDeletedAt: timestamp("list_deleted_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "gym_gone_for_good_month_check",
      sql`${t.monthSentAt} IS NULL OR (${t.monthClaimedAt} IS NOT NULL AND ${t.deletesAt} IS NOT NULL AND ${t.monthRecipients} >= 0)`,
    ),
    check("gym_gone_for_good_week_check", sql`${t.weekClaimedAt} IS NULL OR ${t.monthSentAt} IS NOT NULL`),
    check(
      "gym_gone_for_good_week_sent_check",
      sql`${t.weekSentAt} IS NULL OR (${t.weekClaimedAt} IS NOT NULL AND ${t.weekRecipients} >= 0)`,
    ),
  ],
);
