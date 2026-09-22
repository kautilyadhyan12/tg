// THE GYM'S TIMETABLE (Part 3 §13.3; ROADMAP Stage 2 item 17b-i). Mirrors
// `0035_gym_classes.sql` 1:1 — the DDL is the record, this is what Drizzle
// reads, and the migration's own header carries the reasoning for every
// decision below. THREE TABLES:
//
//   gym_class_types      what the gym runs (name, length, places, colour,
//                        usual coach, open gym or not);
//   gym_class_schedules  when it repeats — the gym's own CLOCK TIME and its
//                        weekdays, never an instant — and, since `0036`, its
//                        own length, places and coach;
//   gym_class_sessions   one row per DATE a repeat runs on: the calendar.
//
// **THE ONE RULE:** a repeat is the gym's clock time plus `gyms.timezone`, and
// each session's instant is derived from the pair by Postgres. That is what
// keeps a six o'clock class at six o'clock across a summer-time change, and it
// is why `local_start_minute` is here at all rather than a `timestamptz` alone.
//
// **THE COACH IS THE ONLY LINK TO `users` IN THESE THREE TABLES**, and ALL
// THREE carry it since `0036` put one on the repeat — so all three are on
// `USER_LINKED_NOT_PURGED_TABLES` in `modules/privacy/tables.ts`. The FK walk
// in `privacy.purge.test.ts` is what refuses a table that is not.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt } from "./common.js";
import { gyms } from "./tenancy.js";
import { users } from "./identity.js";

/** WHAT A GYM RUNS. Its length, places and coach are the STARTING VALUES a new
 *  repeat is filled in from; the repeat itself holds the live answer
 *  (RULINGS 2026-09-22, migration `0036`). Changing them here changes nothing
 *  already on the timetable.
 *
 *  `places` NULL is NO LIMIT, not "not set": open gym is the case that makes
 *  the distinction real, and 17c has to be able to ask whether there is a limit
 *  at all. `colour` is a name from a fixed list, never hex. `archived_at`,
 *  never a delete — 17c's bookings will point at sessions of a type. */
export const gymClassTypes = pgTable(
  "gym_class_types",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    minutes: integer("minutes").notNull(),
    places: integer("places"),
    /** `ON DELETE set null` and not `no action`: losing a coach must not block
     *  anything, and a class with nobody named is a state the column already
     *  allows. A composite FK to `gym_staff` would be the stronger structural
     *  rule and cannot be used — its key is (gym_id, user_id) and a composite
     *  FK cannot SET NULL on half of itself. So "the coach is THIS gym's staff"
     *  is enforced at the write, and the read says nothing rather than printing
     *  a name it cannot vouch for. */
    coachUserId: uuid("coach_user_id").references(() => users.id, { onDelete: "set null" }),
    colour: text("colour").notNull(),
    openGym: boolean("open_gym").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("gym_class_types_name_len_check", sql`char_length(${t.name}) BETWEEN 1 AND 80`),
    check(
      "gym_class_types_description_len_check",
      sql`${t.description} IS NULL OR char_length(${t.description}) BETWEEN 1 AND 500`,
    ),
    check("gym_class_types_minutes_check", sql`${t.minutes} BETWEEN 5 AND 600`),
    check(
      "gym_class_types_places_check",
      sql`${t.places} IS NULL OR ${t.places} BETWEEN 1 AND 500`,
    ),
    check(
      "gym_class_types_colour_check",
      sql`${t.colour} IN ('orange','blue','green','purple','red','teal','amber','slate')`,
    ),
    index("gym_class_types_gym_idx").on(t.gymId, t.archivedAt, t.name),
  ],
);

/** WHEN IT REPEATS — the gym's clock time, its weekdays, its window, AND SINCE
 *  `0036` ITS OWN LENGTH, PLACES AND COACH.
 *
 *  **THE REPEAT IS THE LIVE ANSWER AND THE CLASS TYPE IS THE DEFAULT IT STARTED
 *  FROM** (Kd, RULINGS 2026-09-22, on the industry standard; 17b-i had shipped
 *  these on the type alone). The three columns mean exactly what their twins on
 *  `gym_class_types` mean — `places` NULL is NO LIMIT, `coach_user_id` NULL is
 *  nobody named — so there is one reading of each, never a coalesce.
 *
 *  They are NOT NULL-means-inherit for that reason: a nullable "ask the type"
 *  would be two answers to one question, which is the defect the ruling settles.
 *
 *  `weekdays` is ISO: Monday 1, Sunday 7 — `gym_hours.weekday`'s numbering and
 *  `EXTRACT(ISODOW …)`'s answer, so the fill compares without a lookup table.
 *  The CHECK refuses an empty array, a value outside 1–7 and a NULL element;
 *  `<@` alone would let a NULL through, and an empty array would be a repeat
 *  that silently runs on no day.
 *
 *  `ends_on` NULL is "until we say otherwise". `ended_at` is the staff action
 *  that STOPPED it, kept separately so the console can say so and so the fill
 *  has one condition to test rather than a comparison against the clock. */
export const gymClassSchedules = pgTable(
  "gym_class_schedules",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    classTypeId: uuid("class_type_id")
      .notNull()
      .references(() => gymClassTypes.id, { onDelete: "cascade" }),
    weekdays: integer("weekdays").array().notNull(),
    localStartMinute: integer("local_start_minute").notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on"),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    minutes: integer("minutes").notNull(),
    places: integer("places"),
    /** `ON DELETE set null`, the type's column's reasoning verbatim — and the
     *  reason `gym_class_schedules` joins `USER_LINKED_NOT_PURGED_TABLES` in
     *  this same commit, where its old entry said a repeat "carries no user
     *  link at all". The FK walk in `privacy.purge.test.ts` refuses a table
     *  that does not. */
    coachUserId: uuid("coach_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "gym_class_schedules_weekdays_check",
      sql`array_length(${t.weekdays}, 1) BETWEEN 1 AND 7
        AND ${t.weekdays} <@ ARRAY[1,2,3,4,5,6,7]
        AND array_position(${t.weekdays}, NULL::integer) IS NULL`,
    ),
    check(
      "gym_class_schedules_start_minute_check",
      sql`${t.localStartMinute} BETWEEN 0 AND 1439`,
    ),
    check(
      "gym_class_schedules_window_check",
      sql`${t.endsOn} IS NULL OR ${t.endsOn} >= ${t.startsOn}`,
    ),
    // The same bounds as the type's, and named so on purpose: one quantity with
    // two homes must not have two sets of limits.
    check("gym_class_schedules_minutes_check", sql`${t.minutes} BETWEEN 5 AND 600`),
    check(
      "gym_class_schedules_places_check",
      sql`${t.places} IS NULL OR ${t.places} BETWEEN 1 AND 500`,
    ),
    index("gym_class_schedules_type_idx").on(t.classTypeId, t.endedAt, t.localStartMinute),
    index("gym_class_schedules_live_idx").on(t.gymId).where(sql`${t.endedAt} IS NULL`),
  ],
);

/** THE CALENDAR — one row per date a repeat runs on.
 *
 *  **`gym_class_sessions_schedule_date_uq` IS WHAT MAKES THE FILL SAFE TO RUN
 *  TWICE.** The fill is one `INSERT … SELECT … ON CONFLICT DO NOTHING`, so a
 *  retry, a second worker, or a save landing at the same instant as the nightly
 *  job all write the same calendar. The guarantee is in the database, not in a
 *  check inside the job (R3.5).
 *
 *  `schedule_id` is nullable for 17b-ii's one-off, which has no repeat; NULLs
 *  do not conflict in a unique index, which is correct — two one-offs may share
 *  a date.
 *
 *  `changed_alone` is §13.3's "this day only". **Nothing sets it in this card
 *  and it is here anyway**: the FILL and the re-stamp are what must respect it,
 *  and both are this card's, so a flag added later would mean they shipped
 *  without the condition they exist to satisfy.
 *
 *  `minutes`, `places` and `coach_user_id` are COPIED **from the REPEAT** at
 *  fill time (from the type until `0036`), the shape `gym_attendance` already
 *  uses for its opening-hours window: once one day can be changed, a session's
 *  numbers are its own. An edit to the repeat re-stamps its future rows in the
 *  same transaction, so the screen and the calendar cannot disagree; an edit to
 *  the TYPE touches no calendar at all — it is only the value a new repeat
 *  starts from. */
export const gymClassSessions = pgTable(
  "gym_class_sessions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    classTypeId: uuid("class_type_id")
      .notNull()
      .references(() => gymClassTypes.id, { onDelete: "cascade" }),
    scheduleId: uuid("schedule_id").references(() => gymClassSchedules.id, {
      onDelete: "cascade",
    }),
    localDate: date("local_date").notNull(),
    localStartMinute: integer("local_start_minute").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    minutes: integer("minutes").notNull(),
    places: integer("places"),
    coachUserId: uuid("coach_user_id").references(() => users.id, { onDelete: "set null" }),
    status: text("status").notNull().default("scheduled"),
    changedAlone: boolean("changed_alone").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "gym_class_sessions_start_minute_check",
      sql`${t.localStartMinute} BETWEEN 0 AND 1439`,
    ),
    check("gym_class_sessions_minutes_check", sql`${t.minutes} BETWEEN 5 AND 600`),
    check(
      "gym_class_sessions_places_check",
      sql`${t.places} IS NULL OR ${t.places} BETWEEN 1 AND 500`,
    ),
    check("gym_class_sessions_status_check", sql`${t.status} IN ('scheduled','cancelled')`),
    uniqueIndex("gym_class_sessions_schedule_date_uq").on(t.scheduleId, t.localDate),
    index("gym_class_sessions_gym_starts_idx").on(t.gymId, t.startsAt),
    index("gym_class_sessions_type_starts_idx").on(t.classTypeId, t.startsAt),
  ],
);
