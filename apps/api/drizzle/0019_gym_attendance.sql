-- A MEMBER CAN SAY "I'M HERE", AND THE GYM CAN SEE WHO CAME (Kd rulings
-- 2026-08-31 :26469 with addenda :26558/:26586, and 2026-09-01 :27900 with
-- addenda :27992, :28055, :28107). Expand-only, forward-only.
--
-- Reviewed as SQL by Kd before anything else was written (T5, R4.4).
--
-- **HAND-WRITTEN, for `0016`–`0018`'s recorded reason and not by preference.**
-- `drizzle/meta/` stops at `0012_snapshot.json`, so `drizzle-kit generate`
-- diffs today's schema against one seven migrations old and re-emits everything
-- since, dying on an already-existing column (42701). This is the seventh
-- hand-written migration in a row; the snapshot debt has its own `OWED.md` line
-- and this does NOT fix it and must not be read as fixing it.
--
-- Four statements, three subjects: the switch that turns manual marking off,
-- the attendance table itself, and the NINTH PRIVILEGE with its backfill.

-- 1 · CAN A MEMBER MARK THEMSELVES PRESENT AT ALL.
--
--    Kd :26469 §1.4: *"the owner can switch the manual option off in
--    Settings"* — one of the four calls he made in that ruling.
--
--    **DEFAULT true IS THE RULING, NOT A CONVENIENCE.** :26586 struck the entire
--    scan path from the web (*"drop the scan part completely from web men"*), so
--    the manual tap is the ONLY way in that exists until the phone app ships.
--    A default of false would leave every gym with no way to record anybody at
--    all, on the day this lands, having chosen nothing.
--
--    **The switch is what makes the number trustworthy, which is why it exists
--    before the thing it switches off.** A manual tap can be sent from home
--    (:26469 §4); a gym that cares will turn this off the day its QR poster
--    goes up, and `method` below is what lets it tell the two apart in the
--    meantime.
ALTER TABLE "gyms" ADD COLUMN "manual_attendance_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint

-- 2 · WHO CAME, WHEN, AND WHICH SESSION THEY CAME IN.
--
--    **`day` IS THE GYM'S CALENDAR DAY, STORED AND NEVER RE-DERIVED.** Computed
--    once at the tap as `(now() AT TIME ZONE g.timezone)::date`, exactly like
--    `gym_closures.day` (:26469 §5, trap #8). It is STORED because a gym may
--    edit its time zone in Settings afterwards (:19366, :20075) — re-deriving
--    would silently move every past visit to a different day, and the day a
--    visit happened is the day the gym and the member both saw on screen.
--
--    **`marked_by_user_id` IS SEPARATE FROM `user_id` FROM DAY ONE, AND TODAY
--    THEY ARE ALWAYS EQUAL.** Kd answered *"only the member, for now"* at the
--    plan gate (:27900 §1); a front-desk button later then ADDS a value rather
--    than rewriting history. This is :26469 §4's own argument about `method`,
--    applied to the question he answered — and it is NOT a deferral with an
--    `OWED.md` line, because staff marking was answered, not postponed.
--
--    **`method` CARRIES `qr` BEFORE ANYTHING CAN WRITE IT, DELIBERATELY.** Only
--    `manual` is reachable until the phone app ships (:26586). The value is here
--    because :26469 §4 is explicit that the two ways in are stored as DIFFERENT
--    THINGS from day one — *"a single 'attended' boolean throws away the only
--    thing that makes the number trustworthy, and no later card can recover
--    it"* — and because widening a CHECK on a live table full of attendance is
--    a migration nobody should have to write for a value we already know.
--
--    **`hours_status` HAS FIVE VALUES BECAUSE FIVE DIFFERENT TRUE THINGS CAN BE
--    SAID, AND COLLAPSING ANY PAIR LOSES ONE OF THEM:**
--
--      · `in_session`    — fell inside one of the gym's sessions; the window is
--                          copied alongside.
--      · `open_24h`      — the gym is open 24 hours, so there is nothing to fall
--                          outside of (:26624 §4.5's flag, read here).
--      · `outside_hours` — the gym HAS said when it is open, and this was not
--                          then. **RECORDED AND MARKED, NEVER REFUSED**
--                          (:26624 §4.4) — a gym that forgot to update its hours
--                          must not lock its own members out.
--      · `closed_day`    — a dated closure covered this day. Also recorded and
--                          marked, never refused (:26684).
--      · `hours_unset`   — the gym has never said when it is open, so NOTHING
--                          can be judged. **This is :26736's third state one
--                          level in**: "nobody has answered" is not "outside
--                          hours", and folding it into that would be the same
--                          false sentence that ruling exists to prevent.
--
--    **THE SESSION WINDOW IS COPIED, NOT REFERENCED — there is deliberately no
--    FK to `gym_hours`.** `PUT /hours` REPLACES the whole week, so those rows
--    are deleted and re-inserted every time an owner edits the timetable: an FK
--    would either dangle or cascade a gym's attendance history into nothing.
--    **The window is a historical fact about a visit, not a live pointer** — it
--    is what was true when the person walked in, and it must survive the
--    timetable changing an hour later.
--
--    Its range CHECKs mirror `gym_hours`' own (0–1439 opening, 1–1440 closing)
--    because the value is copied from there and a copy that cannot hold what it
--    copied is not a copy.
--
--    **`slot_key` IS KD'S RULING OF 2026-09-01 MADE PHYSICAL** (:27992 §1):
--    *"if a member again comes in different slot and gives attandance taht also
--    count and owner can see that the member attended two times"*. It is the
--    session window (`360-420`) when there is one, and the `hours_status` name
--    otherwise. With it in the UNIQUE below:
--
--      · morning session + evening session ⇒ two different keys ⇒ TWO rows, and
--        the owner sees the member attended twice. **The ruling.**
--      · the same session tapped twice ⇒ the same key ⇒ ONE row, and the second
--        tap returns the first. **Idempotency (R3.5) is KEPT rather than traded
--        away for the ruling**, so a double-tap can never inflate a gym's count.
--      · a gym with no sessions (`open_24h`, `hours_unset`, and the two
--        exception states) has a CONSTANT key ⇒ ONE attendance per day. **Kd
--        ruled exactly this** (:28055, *"only one time attandance"*), so a later
--        "count it again after an hour" is re-opening a settled question, and
--        the number such a rule needs is the R0.2 invention this avoids.
--
--    **`gym_attendance_slot_key_agrees_check` IS THE PART THAT MAKES THE RULING
--    ENFORCEABLE RATHER THAN REMEMBERED, and it is worth reading twice.** The
--    card named the failure mode before this constraint existed: a future writer
--    that sets `slot_key` to a constant silently reverts every gym to one visit
--    per day, **with no error anywhere** — the UNIQUE still holds, the tests
--    that check refusal still pass, and only a gym counting its own members
--    would ever notice. The CHECK ties the key to the two columns it must be
--    derived from, so that writer gets a 23514 instead of a wrong number.
--    :7104's PG1 applies: a rule has TWO failure directions, and this one guards
--    the direction that fails QUIETLY.
--
--    **UNIQUE (gym_id, user_id, day, slot_key)** — the ruling and the
--    idempotency in one constraint, in the database rather than in the service
--    remembering to check (`gym_closures_gym_day_uq`'s precedent).
--
--    **NO INDEX FOR THE MEMBER'S OWN HISTORY IS NEEDED**: that unique index
--    leads with `(gym_id, user_id, day)`, which is exactly the member read's
--    predicate and its ordering. The gym-side "who came on this day" needs its
--    own, below.
--
--    `user_id` and `marked_by_user_id` are `ON DELETE no action` like every
--    other actor column in this schema: who came is a fact about the past, and
--    the DPDP cascade owns what happens to it. `gym_id` CASCADEs because an
--    attendance is meaningless without its gym and nothing points at it.
CREATE TABLE "gym_attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"marked_by_user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"method" text NOT NULL,
	"hours_status" text NOT NULL,
	"session_opens_minute" integer,
	"session_closes_minute" integer,
	"slot_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_attendance_method_check" CHECK ("gym_attendance"."method" IN ('manual','qr')),
	CONSTRAINT "gym_attendance_hours_status_check" CHECK ("gym_attendance"."hours_status" IN ('in_session','open_24h','outside_hours','closed_day','hours_unset')),
	CONSTRAINT "gym_attendance_session_pairing_check" CHECK (
		("gym_attendance"."hours_status" = 'in_session'
			AND "gym_attendance"."session_opens_minute" IS NOT NULL
			AND "gym_attendance"."session_closes_minute" IS NOT NULL
			AND "gym_attendance"."session_closes_minute" > "gym_attendance"."session_opens_minute")
		OR ("gym_attendance"."hours_status" <> 'in_session'
			AND "gym_attendance"."session_opens_minute" IS NULL
			AND "gym_attendance"."session_closes_minute" IS NULL)
	),
	CONSTRAINT "gym_attendance_session_range_check" CHECK (
		("gym_attendance"."session_opens_minute" IS NULL OR "gym_attendance"."session_opens_minute" BETWEEN 0 AND 1439)
		AND ("gym_attendance"."session_closes_minute" IS NULL OR "gym_attendance"."session_closes_minute" BETWEEN 1 AND 1440)
	),
	CONSTRAINT "gym_attendance_slot_key_agrees_check" CHECK (
		CASE WHEN "gym_attendance"."hours_status" = 'in_session'
			THEN "gym_attendance"."slot_key" = "gym_attendance"."session_opens_minute"::text || '-' || "gym_attendance"."session_closes_minute"::text
			ELSE "gym_attendance"."slot_key" = "gym_attendance"."hours_status"
		END
	)
);--> statement-breakpoint
ALTER TABLE "gym_attendance" ADD CONSTRAINT "gym_attendance_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_attendance" ADD CONSTRAINT "gym_attendance_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_attendance" ADD CONSTRAINT "gym_attendance_marked_by_user_id_users_id_fk" FOREIGN KEY ("marked_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gym_attendance_gym_user_day_slot_uq" ON "gym_attendance" ("gym_id","user_id","day","slot_key");--> statement-breakpoint
CREATE INDEX "gym_attendance_gym_day_idx" ON "gym_attendance" ("gym_id","day","marked_at");--> statement-breakpoint

-- 3 · A NINTH PRIVILEGE: `attendance.read` — "see who came in".
--
--    Kd, 2026-09-01 (:28107): *"also stafs can see it too default permission
--    owner can change it"*.
--
--    **WHY NOT REUSE `members.read`, WHICH NEEDS NO MIGRATION AT ALL.** It would
--    satisfy the first half of his sentence and BREAK the second: unticking it
--    to hide attendance from somebody also takes away the member list. :13803's
--    precedent is directly on point and was restated at :21157 — *"two rows that
--    mean different things get different privileges, or one tick silently widens
--    the other's power"*. Here it would silently NARROW it, which is the same
--    defect pointed the other way.
--
--    **WHY NOT GATE THE ROUTE ON `role` INSTEAD**: :11429 built a permission
--    SEAM whose whole point is that no route checks a role NAME, and says so in
--    as many words — *"a new route checking a role NAME re-opens it"*.
--    :15534's C/H-1 is what that costs.
--
--    **ON BY DEFAULT FOR ALL THREE ROLES**, which is what *"stafs can see it
--    too"* says — including `trainer`, whose template holds only `members.read`
--    and `codes.invite` today. That is the row that proves the ruling: a
--    privilege granted to owner and manager only would look correct in every
--    test written by somebody thinking about owners.
--
--    **NOT in `OWNER_ONLY_PRIVILEGES`** — a manager's and a trainer's row must
--    be able to carry it, which is the whole point.
--    **NOT in `LAST_OWNER_REQUIRED_PRIVILEGES`** — that list guards the two
--    ticks that can STRAND a gym (`staff.manage`, `billing.manage`: a gym whose
--    last owner cannot reach billing cannot pay). Losing a READ strands nobody
--    and is one tick away from being restored.
--
--    DROP-then-ADD rather than an ALTER: Postgres has no "widen a CHECK" verb.
--    The window between the two statements is inside one migration transaction.
--    `0015`'s precedent, same shape.
ALTER TABLE "gym_staff" DROP CONSTRAINT "gym_staff_privileges_check";--> statement-breakpoint
ALTER TABLE "gym_staff" ADD CONSTRAINT "gym_staff_privileges_check" CHECK ("gym_staff"."privileges" IS NULL OR "gym_staff"."privileges" <@ ARRAY['members.read','codes.invite','codes.manage','members.confirm','members.remove','staff.manage','org.manage','billing.manage','attendance.read']::text[]);--> statement-breakpoint

-- 4 · EVERY EXISTING STAFF ROW GETS THE NEW PRIVILEGE — EVERY ROLE, NOT JUST
--     OWNERS.
--
--     **THE `WHERE` HAS NO ROLE FILTER AND THAT IS THE DIFFERENCE FROM
--     `0013`/`0014`/`0015`**, all three of which backfilled owners alone. Kd
--     ruled staff see this BY DEFAULT, so a manager or trainer row skipped here
--     would be a colleague who cannot see attendance until an owner notices and
--     ticks a box — the default he set, silently not applied.
--
--     **NOT the thing Kd ruled against at :15381.** That ruling makes the stored
--     set a SNAPSHOT so editing a ROLE never reaches back and changes what a
--     named person may do — it protects a decision somebody MADE. **Nobody has
--     ever made a decision about this privilege**: it does not exist until
--     statement 3 above runs, so no owner has ticked anybody down from it.
--
--     Without this line the card ships DEAD for existing gyms. `privilegesFor`
--     prefers the stored set over the role template, so every staff member of
--     every gym that exists today would be 403'd on the new Attendance section.
--
--     The backfill sits inside the migration for `0013`'s named reason and the
--     same declared R4.4 departure: `gym_staff` is small (2 rows on the dev
--     database when `0014` measured it), so there is no lock to spread out,
--     while a separate job somebody has to remember to run is how staff rows end
--     up wrong.
--
--     Idempotent by its own WHERE. Rows with a NULL set are deliberately
--     untouched — they are the deploy window (R4.4), they already read the
--     role's defaults, and those defaults now include `attendance.read`.
UPDATE "gym_staff"
SET "privileges" = array_append("privileges", 'attendance.read')
WHERE "privileges" IS NOT NULL
  AND NOT ("privileges" @> ARRAY['attendance.read']::text[]);
