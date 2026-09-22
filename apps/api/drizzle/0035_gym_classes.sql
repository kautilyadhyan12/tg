-- THE GYM'S TIMETABLE — Part 3 §13.3; ROADMAP Stage 2 item 17b-i.
--
-- A gym says what it runs and when it repeats, and the server writes out every
-- date it will run on for the next eight weeks. THREE TABLES:
--
--   gym_class_types      what the gym runs: a name, a length, how many fit, a
--                        colour, a usual coach, and whether it is open gym;
--   gym_class_schedules  when it repeats: the gym's own clock time, the
--                        weekdays, and the window it runs between;
--   gym_class_sessions   one row per DATE a repeat runs on — the calendar.
--
-- ── THE ONE RULE THIS MIGRATION EXISTS TO MAKE PHYSICAL ────────────────────
--
-- **A REPEAT IS KEPT AS THE GYM'S CLOCK TIME, AND THE INSTANT IS DERIVED.**
-- `gym_class_schedules.local_start_minute` is minutes past midnight on the
-- gym's own clock — `gym_hours.opens_minute`'s unit, deliberately, so the two
-- are one quantity and not two. Each session's `starts_at` is worked out as
-- `(local_date + local_start_minute) AT TIME ZONE gyms.timezone`, which is
-- Postgres's own zone database answering, per date.
--
-- Kept the other way round — one instant plus "every 168 hours" — a six
-- o'clock class in London becomes a five o'clock class for half the year.
-- Measured on this Postgres (16.14) while this migration was written:
--   ('2026-03-29' + 18:00) AT TIME ZONE 'Europe/London' = 2026-03-29 17:00+00
--   ('2026-10-25' + 18:00) AT TIME ZONE 'Europe/London' = 2026-10-25 18:00+00
-- One hour apart in UTC, six o'clock in both — which is the whole point.
--
-- **BOTH ARE STORED ON A SESSION AND NEITHER IS REDUNDANT.** `starts_at` is
-- what a clock compares against (17c's booking window, 17f's desk scan);
-- `local_date` and `local_start_minute` are what a calendar draws and what the
-- gym actually decided. Deriving the local pair back out of the instant at read
-- time would put `AT TIME ZONE` in every reader and make a gym that MOVES zone
-- redraw its own history.
--
-- ── WHAT MAKES THE FILL SAFE TO RUN TWICE ──────────────────────────────────
--
-- `gym_class_sessions_schedule_date_uq` — one session per repeat per local
-- date. The fill is a single `INSERT … SELECT … ON CONFLICT DO NOTHING`, so
-- running it twice, or running it while it is already running, writes the same
-- calendar. That is the guarantee stated in the DDL rather than in a comment in
-- TypeScript (R3.5): a second worker, a retry, or a save landing at the same
-- instant as the nightly job cannot double a Tuesday.
--
-- ── WHAT IS NOT HERE, ON PURPOSE ───────────────────────────────────────────
--
-- **No booking table.** 17c owns `gym_class_bookings` and the rule that decides
-- who gets the last place. Nothing here counts anybody in, and `places` is a
-- number carried to that card rather than enforced by this one.
--
-- **No per-repeat length, places or coach.** §13.3 allows a repeat to differ in
-- places and coach; this card narrows that DELIBERATELY (see `classes.ts` in
-- `@app/shared` for the argument): two places to store one length is one edit
-- away from a screen and a calendar disagreeing, and the column that would
-- widen it is absent rather than present and unwritten. 17b-ii's "this day and
-- later" — end the repeat, begin another — is how a gym changes a coach from a
-- date, and a second class type is how it runs Wednesday under somebody else.
--
-- **No `created_by_user_id` on any of the three.** `audit_log` records who did
-- what, and every user link in this schema is a row somebody has to account for
-- in `privacy/tables.ts` — see statement 1's note on the coach.

-- 1 · WHAT THE GYM RUNS.
--
--    `coach_user_id` is the ONLY link to `users` in these three tables, and it
--    is `ON DELETE SET NULL` rather than `no action`: losing a coach must not
--    block anything, and a class with nobody named is an honest state the
--    column already allows. It is a FK to `users` and NOT a composite FK to
--    `gym_staff` — that would be the stronger structural rule, and it cannot be
--    used here, because `gym_staff`'s key is (gym_id, user_id) and a composite
--    FK cannot SET NULL on half of itself when somebody stops being staff.
--    **So the rule that the coach is THIS gym's staff is enforced at the write
--    (`service.ts`), and the READ says nothing rather than printing a name it
--    cannot vouch for.**
--    `gym_class_types` and `gym_class_sessions` join
--    `USER_LINKED_NOT_PURGED_TABLES` in this same commit; the FK walk in
--    `privacy.purge.test.ts` is what refuses a table that does not.
--
--    `places` NULL means NO LIMIT and not "not set" — open gym is the case that
--    makes the distinction real, and 17c has to be able to ask "is there a
--    limit at all". A sentinel like 0 would be a number that looks like an
--    answer.
--
--    `colour` is a NAME from a fixed list, never hex: a colour crosses the
--    wire, is stored, and is painted next to text, and free hex would let a gym
--    store white on white and would put a stored string into a `style`
--    attribute. The CHECK is the same list as `CLASS_COLOURS` in `@app/shared`.
--
--    `archived_at`, never a delete: §13.1's rule for membership types, and the
--    same reason here — 17c's bookings will point at sessions of a type, and a
--    type nobody can name again is not a type that never existed.
CREATE TABLE "gym_class_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"minutes" integer NOT NULL,
	"places" integer,
	"coach_user_id" uuid,
	"colour" text NOT NULL,
	"open_gym" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_class_types_name_len_check" CHECK (char_length("gym_class_types"."name") BETWEEN 1 AND 80),
	CONSTRAINT "gym_class_types_description_len_check" CHECK ("gym_class_types"."description" IS NULL OR char_length("gym_class_types"."description") BETWEEN 1 AND 500),
	CONSTRAINT "gym_class_types_minutes_check" CHECK ("gym_class_types"."minutes" BETWEEN 5 AND 600),
	CONSTRAINT "gym_class_types_places_check" CHECK ("gym_class_types"."places" IS NULL OR "gym_class_types"."places" BETWEEN 1 AND 500),
	CONSTRAINT "gym_class_types_colour_check" CHECK ("gym_class_types"."colour" IN ('orange','blue','green','purple','red','teal','amber','slate'))
);--> statement-breakpoint
ALTER TABLE "gym_class_types" ADD CONSTRAINT "gym_class_types_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_class_types" ADD CONSTRAINT "gym_class_types_coach_user_id_users_id_fk" FOREIGN KEY ("coach_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- The console reads a gym's live types as one list with no paging, so the
-- index carries `archived_at` and the name it is ordered by.
CREATE INDEX "gym_class_types_gym_idx" ON "gym_class_types" ("gym_id","archived_at","name");--> statement-breakpoint

-- 2 · WHEN IT REPEATS.
--
--    `weekdays` is `integer[]` and ISO — Monday 1, Sunday 7 — which is
--    `gym_hours.weekday`'s numbering and `EXTRACT(ISODOW …)`'s answer, so the
--    fill compares without a lookup table. Two weekday numberings in one
--    product is a bug nobody sees until a Sunday.
--
--    **`text[]` would have been wrong and `integer[]` needs its own CHECK**: an
--    array column can hold an empty array or a NULL element, and either would
--    make a repeat that silently runs on no day at all. `array_length` is NULL
--    for an empty array, so the first clause refuses it; `<@` refuses anything
--    outside 1–7 and `array_position(…, NULL)` refuses a NULL element, which
--    `<@` on its own does not.
--
--    `ends_on` NULL is "until we say otherwise" — a gym's ordinary timetable.
--    `ended_at` is the staff action that STOPPED a repeat, kept separately so
--    the console can say a repeat was stopped rather than silently dropping it,
--    and so the fill has one condition to test rather than a date comparison
--    against the clock.
CREATE TABLE "gym_class_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"class_type_id" uuid NOT NULL,
	"weekdays" integer[] NOT NULL,
	"local_start_minute" integer NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_class_schedules_weekdays_check" CHECK (
		array_length("gym_class_schedules"."weekdays", 1) BETWEEN 1 AND 7
		AND "gym_class_schedules"."weekdays" <@ ARRAY[1,2,3,4,5,6,7]
		AND array_position("gym_class_schedules"."weekdays", NULL::integer) IS NULL
	),
	CONSTRAINT "gym_class_schedules_start_minute_check" CHECK ("gym_class_schedules"."local_start_minute" BETWEEN 0 AND 1439),
	CONSTRAINT "gym_class_schedules_window_check" CHECK ("gym_class_schedules"."ends_on" IS NULL OR "gym_class_schedules"."ends_on" >= "gym_class_schedules"."starts_on")
);--> statement-breakpoint
ALTER TABLE "gym_class_schedules" ADD CONSTRAINT "gym_class_schedules_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_class_schedules" ADD CONSTRAINT "gym_class_schedules_class_type_id_gym_class_types_id_fk" FOREIGN KEY ("class_type_id") REFERENCES "public"."gym_class_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gym_class_schedules_type_idx" ON "gym_class_schedules" ("class_type_id","ended_at","local_start_minute");--> statement-breakpoint
-- The fill's own driving index: it walks every LIVE repeat of every gym.
CREATE INDEX "gym_class_schedules_live_idx" ON "gym_class_schedules" ("gym_id") WHERE "ended_at" IS NULL;--> statement-breakpoint

-- 3 · THE CALENDAR — one row per date a repeat runs on.
--
--    `schedule_id` is NULLABLE, and not because anything writes NULL today: a
--    one-off class put on the calendar by hand belongs to 17b-ii, and it has no
--    repeat. The UNIQUE below is (schedule_id, local_date), and NULLs do not
--    conflict in a unique index — so one-offs are unconstrained by it, which is
--    correct: two different one-offs may legitimately share a date.
--
--    `changed_alone` is §13.3's "this day only" flag. **Nothing sets it in this
--    card and it is here anyway**, because the FILL is what has to respect it
--    and the fill is this card's: an edit that re-stamps future sessions must
--    leave a deliberately-changed day alone, and a flag added later would mean
--    the fill shipped without the condition it exists to satisfy.
--
--    `minutes`, `places` and `coach_user_id` are COPIED from the type at fill
--    time rather than joined at read time — the shape `gym_attendance` already
--    uses for its opening-hours window, and for the same reason: once 17b-ii
--    can change one day, a session's numbers are its own and not its type's.
--    An edit to the type re-stamps the future rows it still owns, in the same
--    transaction (`repo.ts`), so the screen and the calendar cannot disagree.
CREATE TABLE "gym_class_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"class_type_id" uuid NOT NULL,
	"schedule_id" uuid,
	"local_date" date NOT NULL,
	"local_start_minute" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"minutes" integer NOT NULL,
	"places" integer,
	"coach_user_id" uuid,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"changed_alone" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_class_sessions_start_minute_check" CHECK ("gym_class_sessions"."local_start_minute" BETWEEN 0 AND 1439),
	CONSTRAINT "gym_class_sessions_minutes_check" CHECK ("gym_class_sessions"."minutes" BETWEEN 5 AND 600),
	CONSTRAINT "gym_class_sessions_places_check" CHECK ("gym_class_sessions"."places" IS NULL OR "gym_class_sessions"."places" BETWEEN 1 AND 500),
	CONSTRAINT "gym_class_sessions_status_check" CHECK ("gym_class_sessions"."status" IN ('scheduled','cancelled'))
);--> statement-breakpoint
ALTER TABLE "gym_class_sessions" ADD CONSTRAINT "gym_class_sessions_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_class_sessions" ADD CONSTRAINT "gym_class_sessions_class_type_id_gym_class_types_id_fk" FOREIGN KEY ("class_type_id") REFERENCES "public"."gym_class_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_class_sessions" ADD CONSTRAINT "gym_class_sessions_schedule_id_gym_class_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."gym_class_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_class_sessions" ADD CONSTRAINT "gym_class_sessions_coach_user_id_users_id_fk" FOREIGN KEY ("coach_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- **THIS IS WHAT MAKES THE FILL SAFE TO RUN TWICE.** One row per repeat per
-- local date, enforced by the database and not by a check in the job.
CREATE UNIQUE INDEX "gym_class_sessions_schedule_date_uq" ON "gym_class_sessions" ("schedule_id","local_date");--> statement-breakpoint
-- The week view's own index (17b-ii), and the fill's "does this gym already
-- reach the horizon" read.
CREATE INDEX "gym_class_sessions_gym_starts_idx" ON "gym_class_sessions" ("gym_id","starts_at");--> statement-breakpoint
-- Archiving a type deletes its future rows; editing one re-stamps them.
CREATE INDEX "gym_class_sessions_type_starts_idx" ON "gym_class_sessions" ("class_type_id","starts_at");--> statement-breakpoint

-- 4 · A TENTH PRIVILEGE: `schedule.manage` — "set the gym's timetable".
--
--    Spec Part 3 §13.3 names it: *"`schedule.manage` (owner and manager); a
--    trainer sees the lists of their own classes"*. Two powers in one sentence
--    and only the first is a tick: what a trainer gets is a SCOPED READ, which
--    is the axis `gym_staff` has no column for, and handing them this tick to
--    approximate it would give them the whole timetable AND the power to
--    rewrite it (:13803, pointed the widening way).
--
--    **WHY NOT REUSE `org.manage`, which needs no migration.** It is the gym's
--    own details — name, country, time zone, opening hours — and an owner who
--    wants a head coach to run the timetable would have to hand over the gym's
--    identity and its billing-adjacent settings to do it. Two rows that mean
--    different things get different privileges.
--
--    **OWNER AND MANAGER, NOT TRAINER** — §13.3's own words, and the difference
--    from `0019`'s `attendance.read` backfill, which had no role filter because
--    Kd's ruling that day said all three. Quoting that migration's shape here
--    without its ruling would hand every trainer in every gym the power to
--    delete their gym's timetable.
--
--    DROP-then-ADD rather than an ALTER: Postgres has no "widen a CHECK" verb.
--    The window between the two statements is inside one migration transaction.
--    `0015` and `0019`'s precedent, same shape. The list below is
--    `ORG_PRIVILEGES` in `@app/shared` exactly, and `db.migration.test.ts`
--    reads the DEPLOYED predicate to prove the two have not drifted.
ALTER TABLE "gym_staff" DROP CONSTRAINT "gym_staff_privileges_check";--> statement-breakpoint
ALTER TABLE "gym_staff" ADD CONSTRAINT "gym_staff_privileges_check" CHECK ("gym_staff"."privileges" IS NULL OR "gym_staff"."privileges" <@ ARRAY['members.read','codes.invite','codes.manage','members.confirm','members.remove','staff.manage','org.manage','billing.manage','attendance.read','schedule.manage']::text[]);--> statement-breakpoint

-- 5 · EVERY EXISTING OWNER AND MANAGER ROW GETS IT.
--
--    Without this the card ships DEAD for every gym that exists today:
--    `privilegesFor` prefers the stored set over the role template, so every
--    owner of every gym would be 403'd on their own new Classes screen.
--
--    **NOT the thing Kd ruled against at :15381.** That ruling makes the stored
--    set a SNAPSHOT so editing a ROLE never reaches back and changes what a
--    named person may do — it protects a decision somebody MADE. Nobody has
--    ever made a decision about this privilege: it does not exist until
--    statement 4 above runs.
--
--    **The `role` filter is the whole difference from `0019`** — see statement
--    4. A trainer's row is deliberately untouched.
--
--    Idempotent by its own WHERE. Rows with a NULL set are deliberately
--    untouched: they are the deploy window (R4.4), they already read the role's
--    defaults, and those defaults now include `schedule.manage` for exactly
--    these two roles.
UPDATE "gym_staff"
SET "privileges" = array_append("privileges", 'schedule.manage')
WHERE "privileges" IS NOT NULL
  AND "role" IN ('owner','manager')
  AND NOT ("privileges" @> ARRAY['schedule.manage']::text[]);
