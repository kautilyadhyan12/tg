-- A REPEAT CARRIES ITS OWN LENGTH, PLACES AND COACH — Part 3 §13.3;
-- RULINGS 2026-09-22; ROADMAP Stage 2 item 17b-ii-a.
--
-- 17b-i put all three on the CLASS TYPE and left a repeat carrying only WHEN,
-- on the argument that two places to store one capacity is one edit away from a
-- screen and a calendar disagreeing. Round one called that what it was: §13.3's
-- "places and coach where they differ", dropped without a ruling. Asked for the
-- recommendation and the industry standard, Kd ruled FOLLOW THE STANDARD.
--
-- ── WHAT THE STANDARD ACTUALLY IS (read 2026-09-22) ─────────────────────────
--
-- TeamUp's help centre splits the two levels by name. A Class Type edits "the
-- class name, description, and visibility"; a time slot edits "the Venue,
-- Instructor, Times, and Class Size Limits" — so in TeamUp these three do not
-- live on the type at ALL. Its bulk editor "lets you update instructors, venues,
-- and class size limits across multiple time slots within a single Class Type",
-- applied "from a chosen start date". Mindbody changes a class's instructor
-- "for a single day, a set time period, or permanently".
--
-- Kd's ruling is the middle of those two and is what this migration builds:
-- **THE REPEAT IS THE LIVE ANSWER; THE CLASS TYPE IS THE DEFAULT A NEW REPEAT
-- IS FILLED IN FROM.** The arrow points one way and only at the moment a repeat
-- is created. Nothing reads `gym_class_types.minutes/places/coach_user_id`
-- afterwards — not the fill, not the calendar, not 17c.
--
-- ── WHY NOT NULL-MEANS-INHERIT ─────────────────────────────────────────────
--
-- The obvious alternative is a nullable column meaning "ask the class". It was
-- refused: it is two answers to one question, which is precisely the defect
-- 17b-i was trying to avoid when it dropped the field. Every reader would carry
-- a coalesce, and the day somebody forgot one the calendar would say 45 while
-- the screen said 60. Here the three columns mean EXACTLY what their twins on
-- `gym_class_types` mean — `places` NULL is NO LIMIT, `coach_user_id` NULL is
-- nobody named — so no reader has to know which of the two rows it is holding.
--
-- ── WHAT THIS MIGRATION MUST NOT GET WRONG ─────────────────────────────────
--
-- `minutes` is NOT NULL and the table may already hold rows, so it lands in
-- three statements — add nullable, back-fill from the class, then SET NOT NULL.
-- `ADD COLUMN … NOT NULL` with no default fails outright on a non-empty table,
-- and a DEFAULT would be a number nobody chose sitting on a gym's timetable for
-- ever. The back-fill is what makes every repeat that exists today keep running
-- exactly as it ran yesterday: it copies the class's current values, which are
-- the values its sessions were already stamped with.

-- 1 · THE THREE COLUMNS, nullable for now.
ALTER TABLE "gym_class_schedules" ADD COLUMN "minutes" integer;--> statement-breakpoint
ALTER TABLE "gym_class_schedules" ADD COLUMN "places" integer;--> statement-breakpoint
--    `ON DELETE set null`, the type's column's reasoning verbatim: losing a
--    coach must not block anything, and a repeat with nobody named is a state
--    the column already allows. A composite FK to `gym_staff` would be the
--    stronger structural rule and cannot be used — its key is (gym_id, user_id)
--    and a composite FK cannot SET NULL on half of itself — so "the coach is
--    THIS gym's staff" is enforced at the write (`classes/repo.ts`), and the
--    read says nothing rather than printing a name it cannot vouch for.
--
--    **`gym_class_schedules` JOINS `USER_LINKED_NOT_PURGED_TABLES` IN THIS SAME
--    COMMIT.** Its entry there said, in `0035`'s own words, that a repeat
--    "carries no user link at all". It does now, and the FK walk in
--    `privacy.purge.test.ts` is what refuses a table that is not on the list.
ALTER TABLE "gym_class_schedules" ADD COLUMN "coach_user_id" uuid;--> statement-breakpoint
ALTER TABLE "gym_class_schedules" ADD CONSTRAINT "gym_class_schedules_coach_user_id_users_id_fk" FOREIGN KEY ("coach_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- 2 · EVERY REPEAT THAT ALREADY EXISTS KEEPS RUNNING AS IT RAN.
--
--    The class's values are copied onto its repeats — which are the same values
--    those repeats' sessions were already stamped with at fill time, so the
--    calendar does not move by one minute. `gym_id` is carried in the join
--    although `class_type_id` is a primary key on the other side: the pair is
--    the key everywhere in this module, and a statement that does not need it
--    today is one refactor from a statement that did.
UPDATE "gym_class_schedules" s
SET "minutes" = t."minutes",
    "places" = t."places",
    "coach_user_id" = t."coach_user_id"
FROM "gym_class_types" t
WHERE t."id" = s."class_type_id" AND t."gym_id" = s."gym_id";--> statement-breakpoint

-- 3 · AND NOW IT IS REQUIRED.
--
--    If statement 2 missed a row this fails and the whole migration rolls back,
--    which is the correct outcome: a repeat with no length is a repeat nothing
--    can put on a calendar, and finding that out here beats finding it out from
--    a gym.
ALTER TABLE "gym_class_schedules" ALTER COLUMN "minutes" SET NOT NULL;--> statement-breakpoint

-- 4 · THE SAME BOUNDS AS THE CLASS TYPE'S, named to match.
--
--    One quantity with two homes must not have two sets of limits. These are
--    `gym_class_types_minutes_check` and `gym_class_types_places_check` word for
--    word, and `gym_class_sessions`' pair likewise — so a length that a repeat
--    accepts is a length a session can hold.
ALTER TABLE "gym_class_schedules" ADD CONSTRAINT "gym_class_schedules_minutes_check" CHECK ("gym_class_schedules"."minutes" BETWEEN 5 AND 600);--> statement-breakpoint
ALTER TABLE "gym_class_schedules" ADD CONSTRAINT "gym_class_schedules_places_check" CHECK ("gym_class_schedules"."places" IS NULL OR "gym_class_schedules"."places" BETWEEN 1 AND 500);
