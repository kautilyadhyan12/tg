-- A GYM CAN SAY WHEN IT IS OPEN (Kd ruling 2026-08-31, DECISIONS :26624 with
-- addenda :26684, :26736). Expand-only, forward-only. NO BACKFILL AT ALL, and
-- that is the ruling rather than laziness — see §1.
--
-- Reviewed as SQL by Kd before anything else was written (T5, R4.4).
--
-- **HAND-WRITTEN, for `0016`'s recorded reason and not by preference.** The
-- snapshots in `drizzle/meta/` stop at `0012_snapshot.json`, so `drizzle-kit
-- generate` diffs today's schema against one three migrations old and re-emits
-- the whole of `0014`–`0016`, dying on an already-existing column (42701).
-- `0014`, `0015` and `0016` were hand-written for exactly this and left no
-- snapshot either; this follows them rather than quietly changing how
-- migrations are made here. The stale-snapshot debt has its own `OWED.md` line
-- and this migration does NOT fix it and must not be read as fixing it.
--
-- 1 · HAS THIS GYM ANSWERED THE QUESTION AT ALL.
--
--    **"No hours set" and "closed" are DIFFERENT and would otherwise render
--    IDENTICALLY** — Kd's addendum 2 (:26736), caught before shipping. A gym
--    that never opened the section has no `gym_hours` rows, which is exactly
--    what a genuinely closed day looks like, so a member card printing "Closed"
--    for a gym that has not filled the form in shows a user something FALSE
--    (:5807 Critical/High) and would have hit EVERY existing gym on day one.
--
--    So the third state is PHYSICAL, not a convention a reader has to remember:
--
--      · `unset`     — nobody has said anything. Members are told NOTHING about
--                      opening times. This is where every gym starts and where
--                      every gym that exists today lands.
--      · `open_24h`  — Kd's *"or 24 hour open"*, a FLAG and not a fake
--                      00:00–23:59 row, so every reader asks one question
--                      instead of pattern-matching a time range (:26624 §4.5).
--      · `scheduled` — the `gym_hours` rows below are the answer, and a weekday
--                      with no rows means CLOSED — but only once the gym has
--                      reached this state.
--
--    **DEFAULT 'unset' AND NO BACKFILL OF ANY KIND.** :26736: *"no default
--    hours are ever invented, at creation or in a migration"*. A guessed 9-to-5
--    is the same false sentence with more confidence behind it.
--
--    `text` + CHECK, never a PG enum (R4.2), like every other status column in
--    this schema.
ALTER TABLE "gyms" ADD COLUMN "hours_mode" text DEFAULT 'unset' NOT NULL;--> statement-breakpoint
ALTER TABLE "gyms" ADD CONSTRAINT "gyms_hours_mode_check" CHECK ("gyms"."hours_mode" IN ('unset','open_24h','scheduled'));--> statement-breakpoint

-- 2 · THE SESSIONS A GYM IS OPEN FOR. One row per session; a day can hold many
--    (Kd: *"a day can have many session"*).
--
--    **`weekday` IS ISO 8601: 1 = Monday … 7 = Sunday**, which is Postgres
--    `EXTRACT(ISODOW FROM …)` exactly. The attendance card that follows must
--    bucket a timestamp into the session it fell in, and matching the database's
--    own function means that query needs no mapping table and no CASE. JS
--    `getDay()` is 0 = Sunday and is deliberately NOT the convention here: the
--    CLIENT is the one place that converts, once.
--
--    **TIMES ARE MINUTES FROM MIDNIGHT IN THE GYM'S OWN ZONE (`gyms.timezone`),
--    never instants.** A session is a wall-clock fact about a place — "we open
--    at six" is true in June and in December — and storing it as a timestamp
--    would move it twice a year wherever daylight saving applies. Trap #8 and
--    :26469 §5: the gym's zone is automatic with a manual override, which is
--    what lets one nightly run close a US gym's day and an Assam gym's day each
--    in its own zone.
--
--    **`closes_minute` MAY BE 1440 AND `opens_minute` MAY NOT.** 1440 is
--    midnight at the END of the day, so a gym open until midnight loses no
--    minute; 1440 as an OPENING would be a zero-length session on the wrong day.
--
--    **A SESSION CANNOT WRAP PAST MIDNIGHT, DELIBERATELY** (`closes > opens`).
--    22:00–02:00 is Monday 1320–1440 plus Tuesday 0–120. Every query stays ONE
--    comparison and "which day did this attendance fall on" never has two
--    answers. Making that pleasant is the SCREEN's job — one control writing two
--    rows — and never a schema change.
--
--    **NO NAME COLUMN.** Kd struck session names outright (:26684 §1, *"not
--    neeeded"*): a session is a time range and nothing else. It is not deferred
--    and has no `OWED.md` line (:8771's precedent), and it must not return later
--    as a way to carry what a closure note or a join-code label should say.
--
--    **NO CAPACITY COLUMN.** Capacity is the booking card's schema (:26624
--    §4.2), and half of that table in the wrong place is worse than none of it.
--
--    ON DELETE CASCADE: a session is meaningless without its gym and nothing
--    points at it, so there is no history to preserve (contrast `gym_codes`,
--    which members point at and which is therefore soft-removed).
CREATE TABLE "gym_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"opens_minute" integer NOT NULL,
	"closes_minute" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_hours_weekday_check" CHECK ("gym_hours"."weekday" BETWEEN 1 AND 7),
	CONSTRAINT "gym_hours_opens_check" CHECK ("gym_hours"."opens_minute" BETWEEN 0 AND 1439),
	CONSTRAINT "gym_hours_closes_check" CHECK ("gym_hours"."closes_minute" BETWEEN 1 AND 1440),
	CONSTRAINT "gym_hours_order_check" CHECK ("gym_hours"."closes_minute" > "gym_hours"."opens_minute")
);--> statement-breakpoint
ALTER TABLE "gym_hours" ADD CONSTRAINT "gym_hours_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gym_hours_gym_weekday_idx" ON "gym_hours" ("gym_id","weekday","opens_minute");--> statement-breakpoint

-- 3 · "WE ARE CLOSED TODAY" — the DATED override (Kd :26684 §3, *"gym can
--    update like we are close today etc … have option"*).
--
--    **THE TRAP THIS SCHEMA EXISTS TO AVOID IS CONFLATING TWO MECHANISMS.**
--    "Closed every Sunday" is the WEEKLY PATTERN — that weekday simply holds no
--    `gym_hours` rows — while "closed today" is a DATED override that WINS over
--    the pattern. A recurring closed day needs no feature at all, and a second
--    way to say it would let a gym's two answers disagree. **Hence NO `weekday`
--    COLUMN HERE, EVER.** (:26736: no weekday is special. Sunday is an example
--    of nothing.)
--
--    **`day` IS A `date`, IN THE GYM'S OWN ZONE**, for the same reason the
--    session minutes are wall-clock: "we are closed on the 25th" is a statement
--    about the gym's calendar, not about an instant. Every reader computes the
--    gym's today as `(now() AT TIME ZONE g.timezone)::date`.
--
--    **UNIQUE (gym_id, day) IS THE IDEMPOTENCY (R3.5).** A day is closed or it
--    is not. Re-closing the same day UPDATES the note rather than stacking a
--    second row, so an owner double-tapping the button cannot produce two
--    answers for one date — the guarantee lives in the database and not in the
--    service remembering to check, which is the same reason
--    `gym_join_applications_pending_uq` exists.
--
--    **`note` IS NOT THE STRUCK SESSION NAME RETURNING.** Kd struck names ON A
--    SESSION; this is an optional short line on an EXCEPTION ("Closed today —
--    Holi"), where the explanation is the entire point and a member reading
--    "closed" with no reason is the worse product. Capped at 120 characters so a
--    member's card cannot be turned into a notice board — announcements are
--    their own owed feature.
--
--    **NO `removed_at`, A DECLARED EXCEPTION TO R4.3.** A closure is a statement
--    about ONE day that expires by itself when the date passes — which is the
--    failure mode of a "we are closed" toggle somebody forgets to switch back —
--    and un-closing is a CORRECTION rather than an event with a history. The
--    audit log records both ends, so nothing is lost.
--
--    `created_by_user_id` is nullable and `ON DELETE no action` like every other
--    actor column here: who typed it is a fact about the past, and the DPDP
--    cascade owns what happens to it.
CREATE TABLE "gym_closures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"day" date NOT NULL,
	"note" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_closures_note_len_check" CHECK ("gym_closures"."note" IS NULL OR char_length("gym_closures"."note") <= 120)
);--> statement-breakpoint
ALTER TABLE "gym_closures" ADD CONSTRAINT "gym_closures_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_closures" ADD CONSTRAINT "gym_closures_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gym_closures_gym_day_uq" ON "gym_closures" ("gym_id","day");
