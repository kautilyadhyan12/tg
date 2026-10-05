// PERSONAL TRAINING (Part 3 §13.5; ROADMAP Stage 2 item 17e-i). Mirrors
// `0077_personal_training.sql`, which carries the reasoning and holds what Drizzle's
// builder cannot express: the three EXCLUDE constraints (a trainer's hours on one weekday,
// a trainer's sessions and a person's sessions never overlap) and the `(gym_id, entry_id)`
// foreign key with ON DELETE SET NULL (entry_id).
import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, integer, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./common.js";
import { users } from "./identity.js";
import { gymHeldMemberships } from "./memberships.js";
import { gyms } from "./tenancy.js";

export const gymTrainers = pgTable(
  "gym_trainers",
  {
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    offers: boolean("offers").notNull().default(true),
    sessionMinutes: integer("session_minutes").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "gym_trainers_pk", columns: [t.gymId, t.userId] }),
    check("gym_trainers_minutes_check", sql`${t.sessionMinutes} BETWEEN 10 AND 240 AND ${t.sessionMinutes} % 5 = 0`),
  ],
);

export const gymTrainerHours = pgTable(
  "gym_trainer_hours",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id").notNull(),
    userId: uuid("user_id").notNull(),
    weekday: integer("weekday").notNull(),
    fromMinute: integer("from_minute").notNull(),
    toMinute: integer("to_minute").notNull(),
  },
  (t) => [
    foreignKey({
      name: "gym_trainer_hours_trainer_fk",
      columns: [t.gymId, t.userId],
      foreignColumns: [gymTrainers.gymId, gymTrainers.userId],
    }).onDelete("cascade"),
    check("gym_trainer_hours_weekday_check", sql`${t.weekday} BETWEEN 1 AND 7`),
    check("gym_trainer_hours_range_check", sql`${t.fromMinute} >= 0 AND ${t.fromMinute} < ${t.toMinute} AND ${t.toMinute} <= 1440`),
  ],
);

export const gymPtAppointments = pgTable(
  "gym_pt_appointments",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    trainerUserId: uuid("trainer_user_id").references(() => users.id, { onDelete: "set null" }),
    entryId: uuid("entry_id"),
    heldMembershipId: uuid("held_membership_id").references(() => gymHeldMemberships.id, { onDelete: "set null" }),
    localDate: date("local_date").notNull(),
    localStartMinute: integer("local_start_minute").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    minutes: integer("minutes").notNull(),
    status: text("status").notNull(),
    packCharged: boolean("pack_charged").notNull().default(false),
    requestKey: uuid("request_key").notNull(),
    bookedBy: uuid("booked_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (t) => [
    unique("gym_pt_appointments_request_uq").on(t.gymId, t.requestKey),
    check("gym_pt_appointments_status_check", sql`${t.status} IN ('booked','cancelled','late_cancelled','attended','no_show')`),
    check("gym_pt_appointments_cancelled_check", sql`(${t.status} IN ('cancelled','late_cancelled')) = (${t.cancelledAt} IS NOT NULL)`),
    check(
      "gym_pt_appointments_time_check",
      sql`${t.minutes} BETWEEN 10 AND 240 AND ${t.minutes} % 5 = 0 AND ${t.endsAt} > ${t.startsAt} AND ${t.localStartMinute} BETWEEN 0 AND 1439`,
    ),
    index("gym_pt_appointments_trainer_idx").on(t.gymId, t.trainerUserId, t.startsAt),
    index("gym_pt_appointments_entry_idx").on(t.gymId, t.entryId, t.startsAt).where(sql`${t.entryId} IS NOT NULL`),
    index("gym_pt_appointments_held_idx").on(t.heldMembershipId).where(sql`${t.heldMembershipId} IS NOT NULL`),
  ],
);
