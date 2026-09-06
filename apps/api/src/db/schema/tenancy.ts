// Part 4 §3.2 — Organizations & membership. Mirrors the DDL 1:1.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt } from "./common.js";
import { users } from "./identity.js";

export const gyms = pgTable(
  "gyms", // the org table; name kept for continuity (v1 §8)
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    slug: text("slug").unique().notNull(),
    name: text("name").notNull(),
    city: text("city"),
    /** ISO 3166-1 alpha-2, and the one field the create wizard collected and
     *  the server then DISCARDED (migration `0014` adds it).
     *
     *  It is stored because `currency_display` is derived FROM it (:10010) and a
     *  derived value cannot answer "where is this gym" — EUR is twenty
     *  countries. Without the column a console can show what a gym is billed in
     *  and never what it asked for, so an owner correcting their country would
     *  be typing into a box that reads back empty for ever.
     *
     *  NULLABLE because nothing honest can be back-filled: `INR` is this
     *  column's neighbour's DEFAULT, so inverting the currency map would write
     *  'IN' onto rows where nobody said anything. NULL means "we never asked".
     *
     *  The CHECK is SHAPE ONLY. Whether we are OPEN in a country is
     *  `supportedCountrySchema`'s answer, in code, and it grows as Kd opens
     *  markets — a copy of that list in DDL would be a second answer that goes
     *  stale silently. */
    country: text("country"),
    orgType: text("org_type").notNull().default("gym"),
    timezone: text("timezone").notNull().default("Asia/Kolkata"),
    locale: text("locale").notNull().default("en"),
    currencyDisplay: text("currency_display").notNull().default("INR"),
    logoKey: text("logo_key"), // R2 gym-assets/
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id),
    ownerIncludedAsMember: boolean("owner_included_as_member").notNull().default(true),
    activation: jsonb("activation").notNull().default(sql`'{}'`), // Part 3 §5.1 checklist state
    status: text("status").notNull().default("active"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /** HAS THIS GYM SAID WHEN IT IS OPEN — Kd ruling 2026-08-31 (:26624), with
     *  the third state ruled by his addendum 2 (:26736).
     *
     *  **`unset` IS NOT A NULL WEARING A NAME. It is the whole point of the
     *  column.** A gym that never opened the section has no `gym_hours` rows,
     *  which is byte-for-byte what a genuinely closed week looks like — so
     *  without this a member card would print "Closed" for every gym that has
     *  simply not answered yet, which is a user shown something FALSE (:5807)
     *  and would have hit EVERY existing gym on the day this shipped.
     *
     *  `open_24h` is a FLAG rather than a fake 00:00–23:59 row (:26624 §4.5), so
     *  every reader asks one question instead of pattern-matching a time range.
     *  `scheduled` means the rows below are the answer, and only THEN does a
     *  weekday with no rows mean closed.
     *
     *  **DEFAULT `unset` AND NEVER BACKFILLED** — :26736 in as many words: no
     *  default hours are invented, at creation or in a migration. */
    hoursMode: text("hours_mode").notNull().default("unset"),
    /** WHICH CLOCK THIS GYM'S HOURS ARE SHOWN ON — Kd at the screen, 2026-09-01:
     *  *"for time both format shpuld be ther gym can choose format like it will
     *  be 4 or 16"*.
     *
     *  **A GYM COLUMN AND NOT A BROWSER SETTING, which is the whole point.** The
     *  console and the MEMBERS' screens draw the same hours from one reader, and
     *  a per-device preference would put an owner on one clock and their member
     *  on another while both look at the same Monday.
     *
     *  **NOT DERIVED FROM `locale`**: that is a language tag, and a gym in
     *  Bengaluru and a gym in Austin are both `en` while wanting different
     *  answers here. `24h` is the default because it is what every existing
     *  gym's screens already draw, so it changes nothing anybody is looking at. */
    clockFormat: text("clock_format").notNull().default("24h"),
    /** MAY A MEMBER MARK THEMSELVES PRESENT — Kd :26469 §1.4, *"the owner can
     *  switch the manual option off in Settings"*.
     *
     *  **DEFAULT `true` IS THE RULING, NOT A CONVENIENCE.** :26586 struck the
     *  whole scan path from the web (*"drop the scan part completely from web
     *  men"*), so the manual tap is the ONLY way in that exists until the phone
     *  app ships. A default of `false` would leave every gym unable to record
     *  anybody at all, on the day this landed, having chosen nothing.
     *
     *  **It is what makes the number trustworthy, which is why it exists before
     *  the thing it switches off.** A manual tap can be sent from home (:26469
     *  §4); a gym that cares turns this off the day its QR poster goes up, and
     *  `gym_attendance.method` is what lets it tell the two apart meanwhile. */
    manualAttendanceEnabled: boolean("manual_attendance_enabled").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    check("gyms_org_type_check", sql`${t.orgType} IN ('gym','studio','clinic')`),
    check("gyms_status_check", sql`${t.status} IN ('active','archived')`),
    check("gyms_country_check", sql`${t.country} IS NULL OR ${t.country} ~ '^[A-Z]{2}$'`),
    check("gyms_hours_mode_check", sql`${t.hoursMode} IN ('unset','open_24h','scheduled')`),
    check("gyms_clock_format_check", sql`${t.clockFormat} IN ('12h','24h')`),
  ],
);

/** THE SESSIONS A GYM IS OPEN FOR — Kd 2026-08-31 (:26624): *"a gym can set time
 *  like we are open from 6 to 7 am … 2 to 3 pm … 4 to 9 pm … a day can have many
 *  session"*. One row per session.
 *
 *  **`weekday` IS ISO 8601 — 1 = Monday … 7 = Sunday**, which is Postgres
 *  `EXTRACT(ISODOW FROM …)` exactly. The attendance card must bucket a stamp
 *  into the session it fell in, and matching the database's own function means
 *  that query needs no mapping table. **JS `getDay()` is 0 = Sunday and is
 *  deliberately not the convention: the CLIENT converts, in one place.**
 *
 *  **MINUTES FROM MIDNIGHT IN THE GYM'S OWN ZONE, never instants.** "We open at
 *  six" is a wall-clock fact about a place and is true in June and December; a
 *  timestamp would move it twice a year (trap #8, :26469 §5). `closes_minute`
 *  may be 1440 — midnight at the END of the day — so a gym open till midnight
 *  loses no minute; `opens_minute` may not, since 1440 as an opening is a
 *  zero-length session on the wrong day.
 *
 *  **A SESSION CANNOT WRAP PAST MIDNIGHT, deliberately.** 22:00–02:00 is Monday
 *  1320–1440 plus Tuesday 0–120. Every query stays one comparison and "which day
 *  was this on" never has two answers. Making that pleasant is the screen's job
 *  — one control writing two rows — never a schema change.
 *
 *  **NO NAME COLUMN and NO CAPACITY COLUMN.** Kd struck session names outright
 *  (:26684 §1, *"not neeeded"*) — not deferred, no `OWED.md` line (:8771's
 *  precedent) — and it must not return as a carrier for what a closure note or a
 *  join-code label should say. Capacity belongs to the booking card's schema
 *  (:26624 §4.2); half of that table here is worse than none of it. */
export const gymHours = pgTable(
  "gym_hours",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    weekday: integer("weekday").notNull(),
    opensMinute: integer("opens_minute").notNull(),
    closesMinute: integer("closes_minute").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("gym_hours_weekday_check", sql`${t.weekday} BETWEEN 1 AND 7`),
    check("gym_hours_opens_check", sql`${t.opensMinute} BETWEEN 0 AND 1439`),
    check("gym_hours_closes_check", sql`${t.closesMinute} BETWEEN 1 AND 1440`),
    check("gym_hours_order_check", sql`${t.closesMinute} > ${t.opensMinute}`),
    index("gym_hours_gym_weekday_idx").on(t.gymId, t.weekday, t.opensMinute),
  ],
);

/** "WE ARE CLOSED TODAY" — the DATED override (Kd :26684 §3, *"gym can update
 *  like we are close today etc … have option"*).
 *
 *  **THE TWO MECHANISMS MUST NOT MERGE, and this table's shape is what enforces
 *  it.** "Closed every Sunday" is the WEEKLY PATTERN — that weekday holds no
 *  `gym_hours` rows — while "closed today" is a DATED override that WINS over
 *  the pattern. A recurring closed day needs no feature, and a second way to say
 *  it would let a gym's two answers disagree. **Hence there is no `weekday`
 *  column here and there must never be one.** (:26736: no weekday is special.)
 *
 *  **UNIQUE (gym_id, day) IS THE IDEMPOTENCY (R3.5)** — a day is closed or it is
 *  not, so re-closing UPDATES the note rather than stacking a row, and an owner
 *  double-tapping cannot produce two answers for one date. The guarantee is in
 *  the database, not in the service remembering to check.
 *
 *  **`note` IS NOT THE STRUCK SESSION NAME RETURNING.** Names were struck on a
 *  SESSION; this is a short line on an EXCEPTION ("Closed today — Holi") where
 *  the explanation is the entire point, and a member reading "closed" with no
 *  reason is the worse product. 120 characters so a member's card cannot become
 *  a notice board — announcements are their own owed feature.
 *
 *  **NO `removed_at`, a DECLARED exception to R4.3.** A closure is a statement
 *  about one day that expires by itself when the date passes — which is the
 *  failure mode of a toggle somebody forgets to switch back — and un-closing is
 *  a correction, not an event with a history. `audit_log` records both ends. */
export const gymClosures = pgTable(
  "gym_closures",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    /** The GYM's date in the GYM's zone, for the same reason the session minutes
     *  are wall-clock: "closed on the 25th" is about a calendar, not an instant.
     *  Every reader computes today as `(now() AT TIME ZONE g.timezone)::date`. */
    day: date("day").notNull(),
    note: text("note"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "gym_closures_note_len_check",
      sql`${t.note} IS NULL OR char_length(${t.note}) <= 120`,
    ),
    uniqueIndex("gym_closures_gym_day_uq").on(t.gymId, t.day),
  ],
);

/** WHO CAME TO THE GYM — Kd 2026-08-31 (:26469): *"a user when arrives at the
 *  gym gives a attandance"*, built BEFORE the gym's numbers because a number
 *  about attendance cannot exist before attendance does.
 *
 *  **`day` IS THE GYM'S CALENDAR DAY, STORED AND NEVER RE-DERIVED.** Computed
 *  once at the tap as `(now() AT TIME ZONE g.timezone)::date`, like
 *  `gym_closures.day` (:26469 §5, trap #8). **Stored** because a gym may edit
 *  its zone in Settings afterwards (:19366, :20075) and re-deriving would move
 *  every past visit to a different day — the day a visit happened is the day the
 *  gym and the member both saw on screen.
 *
 *  **`markedByUserId` IS SEPARATE FROM `userId` AND TODAY THEY ARE ALWAYS
 *  EQUAL.** Kd answered *"only the member, for now"* at the plan gate (:27900),
 *  so a front-desk button later ADDS a value rather than rewriting history —
 *  :26469 §4's own argument about `method`, applied to the question he answered.
 *  Not a deferral and no `OWED.md` line: staff marking was ANSWERED.
 *
 *  **`method` CARRIES `qr` BEFORE ANYTHING CAN WRITE IT, deliberately.** Only
 *  `manual` is reachable until the phone app ships (:26586). :26469 §4 is
 *  explicit that the two ways in are stored as DIFFERENT THINGS from day one —
 *  a single "attended" boolean throws away the only thing that makes the number
 *  trustworthy, and no later card recovers it.
 *
 *  **`hoursStatus` HAS FIVE VALUES BECAUSE FIVE DIFFERENT TRUE THINGS CAN BE
 *  SAID.** `outside_hours` and `closed_day` are RECORDED AND MARKED, never
 *  refused (:26624 §4.4, :26684) — a gym that forgot to update its hours must
 *  not lock its own members out. **`hours_unset` is :26736's third state one
 *  level in**: "nobody has answered" is not "outside hours", and folding them
 *  together is the false sentence that ruling exists to prevent.
 *
 *  **THE SESSION WINDOW IS COPIED, NOT REFERENCED — no FK to `gymHours`, on
 *  purpose.** `PUT /hours` replaces the whole week, deleting and re-inserting
 *  those rows every time an owner edits the timetable, so an FK would dangle or
 *  cascade a gym's history into nothing. The window is what was TRUE when the
 *  person walked in and must survive the timetable changing an hour later.
 *
 *  **`slotKey` IS KD'S RULING MADE PHYSICAL** (:27992): *"if a member again
 *  comes in different slot … that also count and owner can see that the member
 *  attended two times"*. The window (`360-420`) when there is one, the
 *  `hoursStatus` name otherwise. In the UNIQUE below it gives all three
 *  behaviours at once: two sessions ⇒ two rows (the ruling) · the same session
 *  twice ⇒ one row (R3.5 idempotency KEPT, not traded for the ruling) · a gym
 *  with no sessions ⇒ a constant key ⇒ **one attendance per day, which Kd ruled
 *  in as many words** (:28055, *"only one time attandance"*).
 *
 *  **`gym_attendance_slot_key_agrees_check` GUARDS THE DIRECTION THAT FAILS
 *  QUIETLY.** A writer that sets `slotKey` to a constant reverts every gym to
 *  one visit a day with NO error anywhere — the UNIQUE still holds and every
 *  refusal test still passes. The CHECK ties the key to the columns it must be
 *  derived from, so that writer gets a 23514 instead of a wrong number
 *  (:7104's PG1: a rule has two failure directions).
 *
 *  **The member's own history needs no index of its own** — the unique index
 *  leads with `(gym_id, user_id, day)`, which is that read's predicate and its
 *  ordering. The gym-side "who came today" has `gym_attendance_gym_day_idx`. */
export const gymAttendance = pgTable(
  "gym_attendance",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    markedByUserId: uuid("marked_by_user_id")
      .notNull()
      .references(() => users.id),
    day: date("day").notNull(),
    markedAt: timestamp("marked_at", { withTimezone: true }).notNull().defaultNow(),
    method: text("method").notNull(),
    hoursStatus: text("hours_status").notNull(),
    sessionOpensMinute: integer("session_opens_minute"),
    sessionClosesMinute: integer("session_closes_minute"),
    slotKey: text("slot_key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("gym_attendance_method_check", sql`${t.method} IN ('manual','qr')`),
    check(
      "gym_attendance_hours_status_check",
      sql`${t.hoursStatus} IN ('in_session','open_24h','outside_hours','closed_day','hours_unset')`,
    ),
    check(
      "gym_attendance_session_pairing_check",
      sql`(${t.hoursStatus} = 'in_session' AND ${t.sessionOpensMinute} IS NOT NULL AND ${t.sessionClosesMinute} IS NOT NULL AND ${t.sessionClosesMinute} > ${t.sessionOpensMinute}) OR (${t.hoursStatus} <> 'in_session' AND ${t.sessionOpensMinute} IS NULL AND ${t.sessionClosesMinute} IS NULL)`,
    ),
    check(
      "gym_attendance_session_range_check",
      sql`(${t.sessionOpensMinute} IS NULL OR ${t.sessionOpensMinute} BETWEEN 0 AND 1439) AND (${t.sessionClosesMinute} IS NULL OR ${t.sessionClosesMinute} BETWEEN 1 AND 1440)`,
    ),
    check(
      "gym_attendance_slot_key_agrees_check",
      sql`CASE WHEN ${t.hoursStatus} = 'in_session' THEN ${t.slotKey} = ${t.sessionOpensMinute}::text || '-' || ${t.sessionClosesMinute}::text ELSE ${t.slotKey} = ${t.hoursStatus} END`,
    ),
    uniqueIndex("gym_attendance_gym_user_day_slot_uq").on(t.gymId, t.userId, t.day, t.slotKey),
    index("gym_attendance_gym_day_idx").on(t.gymId, t.day, t.markedAt),
  ],
);

/** A GYM CHEERING ONE OF ITS MEMBERS ON — Kd's ruling of 2026-09-02 (:29961
 *  ruling 4), his own addition at the overview-numbers gate.
 *
 *  **`preset` IS A KEY, NEVER A SENTENCE.** The four names are the whole
 *  vocabulary and the CHECK is what makes that survive this file's author
 *  (:27992 §1's shape) — a later writer accepting typed text gets 23514 rather
 *  than a comment it did not read. The words live in the web bundle, so copy
 *  changes are a deploy and not a data migration, and no preset may carry a
 *  NUMBER: "4 weeks!" is true when sent and false the week after, which is
 *  :7298's class of sentence outliving its condition.
 *
 *  **NOTHING HERE ENFORCES THE CAP, AND SINCE :35762 THAT IS A CHOICE RATHER
 *  THAN A NECESSITY — do not quote the old reason.** ~~Kd's cap and Part 3
 *  §4.1's `rate-limit 1/member/7d` are both a ROLLING seven days, which no
 *  UNIQUE can express.~~ **Kd reversed his own cap to ONE PER MEMBER PER
 *  GYM-DAY** (:35762; §4.1's figure is the AT-RISK NUDGE and is untouched), and
 *  **a calendar day IS expressible** — a stored gym-day column plus
 *  `UNIQUE (gym_id, user_id, day)`, which is precisely what `gym_attendance`
 *  carries one table down (:27992 §1). **It was not built: that is a migration,
 *  a backfill and a second writer of the gym's day, against a lock that already
 *  exists and is proven (R1.1 — a rule change is not a schema change).**
 *  `sendGymCheer` checks it inside the transaction under `lockOrgRow`, and
 *  mutants are what hold it. **The trap the old note named still stands and is
 *  now closer, not further away: a UNIQUE on a day computed in the WRONG ZONE
 *  would look like this rule and enforce a different one.**
 *
 *  **`ON DELETE RESTRICT` throughout** (R4.3's default). It joins
 *  `USER_LINKED_NOT_PURGED_TABLES` in the same commit, and the automated FK walk
 *  in `privacy/tables.ts` is what makes that a requirement rather than a
 *  courtesy — two earlier tables had to be noticed by a person instead. */
export const gymCheers = pgTable(
  "gym_cheers",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    /** Stored separately from `user_id` from day one, exactly as
     *  `gym_attendance.marked_by_user_id` is (:27900 §5): the member never sees
     *  it (§2.4), and it is what makes "who has been cheering" answerable later
     *  without rewriting history. */
    sentByUserId: uuid("sent_by_user_id")
      .notNull()
      .references(() => users.id),
    preset: text("preset").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "gym_cheers_preset_check",
      sql`${t.preset} IN ('keep_going','on_a_roll','consistency','strong_streak')`,
    ),
    index("gym_cheers_gym_user_created_idx").on(t.gymId, t.userId, t.createdAt.desc()),
    index("gym_cheers_user_created_idx").on(t.userId, t.createdAt.desc()),
  ],
);

/** A GYM ASKING A MEMBER WHO HAS STOPPED COMING TO COME BACK — the "slipping
 *  away" list's one-tap nudge (Part 3 §4.1; Kd chose the panel at :36503 and
 *  ruled its numbers at :36694 and :36816).
 *
 *  **IT IS A SECOND TABLE AND NOT A FIFTH `gym_cheers` PRESET, AND THE REASON IS
 *  MEASURED RATHER THAN STYLISTIC.** :36503 §2 bought this card on *"same store,
 *  same cap"* — the cap half was already struck by :35762, and the store half was
 *  inherited from the same dead premise. **All three readers of `gym_cheers`
 *  filter on `gym_id` and `user_id` and nothing else**, so a nudge row in that
 *  table would block that day's cheer, draw the cheer button dead, and reach the
 *  member's My Gyms card AS the latest cheer through a preset code the bundle may
 *  not know — which `orgsApi.js` treats as a HARD failure, blanking the whole gym
 *  list (`OWED.md`'s open fifth-preset line). Teaching three readers a `kind`
 *  filter is a change where forgetting one is silent. `0022_gym_nudges.sql` §1
 *  carries the measurement; Kd approved it as a call with its cost.
 *
 *  **`preset` IS A KEY, NEVER A SENTENCE** — `gym_cheers`' argument one table up,
 *  unchanged: the CHECK is what makes Kd's *"no free text ever"* (:18128,
 *  :29961 ruling 4) survive this file's author, the words live in the web bundle
 *  so copy is a deploy rather than a data migration, and **no preset may carry a
 *  NUMBER or a DATE** (:7298 — *"3 weeks away!"* is true when sent and false the
 *  week after).
 *
 *  **NOTHING HERE ENFORCES THE CAP, AND HERE THAT IS FORCED RATHER THAN CHOSEN —
 *  WHICH IS THE OPPOSITE OF `gym_cheers` ABOVE, AND THE EASIEST MISTAKE ON THIS
 *  FEATURE.** The nudge's cap is Part 3 §4.1's `rate-limit 1/member/7d`, a
 *  ROLLING seven days, and no UNIQUE or CHECK can express a rolling window. The
 *  cheer's cap USED to be rolling and stopped being (:35762 made it a calendar
 *  gym-day, which a stored day column plus a UNIQUE *could* express) — so the
 *  paragraph that is dead one table up is alive here. Read this one, not that one.
 *
 *  **THERE ARE THREE SEVENS IN THIS FEATURE AND ONLY ONE NUMBER MOVED**
 *  (:36816 §2, :35762's coincidence trap arriving a second time on one card):
 *  the quiet WINDOW is Kd's three days, this CAP is the spec's rolling seven, and
 *  the message EXPIRY is seven because it is derived from THIS cap. Folding them
 *  into one constant reverses a Kd ruling and breaks a spec limit in one edit.
 *
 *  **`ON DELETE RESTRICT` throughout** (R4.3's default). It joins
 *  `USER_LINKED_NOT_PURGED_TABLES` in the same commit, and the automated FK walk
 *  in `privacy/tables.ts` is what makes that a requirement rather than a
 *  courtesy — two earlier tables had to be noticed by a person instead. */
export const gymNudges = pgTable(
  "gym_nudges",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    /** Stored separately from `user_id` from day one, exactly as `gym_cheers`
     *  and `gym_attendance.marked_by_user_id` are (:27900 §5): the member never
     *  sees it (§2.4), and it is what makes "who has been nudging" answerable
     *  later without rewriting history. */
    sentByUserId: uuid("sent_by_user_id")
      .notNull()
      .references(() => users.id),
    preset: text("preset").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "gym_nudges_preset_check",
      sql`${t.preset} IN ('miss_you','door_open','start_again','checking_in')`,
    ),
    index("gym_nudges_gym_user_created_idx").on(t.gymId, t.userId, t.createdAt.desc()),
    index("gym_nudges_user_created_idx").on(t.userId, t.createdAt.desc()),
  ],
);

export const gymCodes = pgTable("gym_codes", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  gymId: uuid("gym_id")
    .notNull()
    .references(() => gyms.id, { onDelete: "cascade" }),
  code: text("code").unique().notNull(), // 6-char, ambiguity-free alphabet
  label: text("label").notNull().default("Front Desk"), // the group mechanism (Part 3 §2.1)
  maxUses: integer("max_uses"),
  /** LIFETIME TALLY OF SEAT CLAIMS — kept, written, and DISPLAYED NOWHERE.
   *
   *  Kd's smoke of 2026-08-21 read "2 people have joined with it" off this
   *  column for a code ONE person had used: they joined, were removed, and
   *  joined again, and each claim bumped it. A count of EVENTS was being printed
   *  under a sentence about PEOPLE, and it gated `max_uses` too — so a member who
   *  left took their place in the limit with them.
   *
   *  What a screen shows and what the door enforces now come from the
   *  memberships themselves (`repo.ts`'s `joined` subquery: live, complimentary
   *  excluded), which has ONE source of truth and cannot drift. This column
   *  stays because it answers a different and still-honest question — how many
   *  times has this code ever admitted somebody — which no other row records.
   *  Do NOT wire it back to a screen or a limit. */
  uses: integer("uses").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  paused: boolean("paused").notNull().default(false),
  /** TIDIED AWAY, NOT DELETED (Kd 2026-08-21: "codes will pile up should have a
   *  option to delete").
   *
   *  A finished code leaves the console's list and the ROW stays, because
   *  `gym_members.code_id` and `gym_join_applications.code_id` point at it: a
   *  real `DELETE` would either be refused by those foreign keys or erase how
   *  today's members got in. Only a code that can no longer admit anybody is
   *  removable, and removal pauses it in the same statement, so "not in the
   *  list" and "cannot let anyone in" can never disagree. */
  removedAt: timestamp("removed_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const gymMembers = pgTable(
  "gym_members",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    codeId: uuid("code_id").references(() => gymCodes.id), // group attribution at join
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true }), // membership = [joined_at, removed_at)
    // Clinic join consent (Part 3 §2.4). Enforced in the ORGS REPO, inside the
    // join transaction (`joinByCode`) — this comment said "in service" from
    // 0001_init and that was always where it was expected to live rather than
    // where it landed (T3 round 2 L-2). NULL is a real value and means nobody
    // was asked: the owner's silent seat (§4.0 step 6) carries it.
    consentAt: timestamp("consent_at", { withTimezone: true }),
    hiddenFromBoards: boolean("hidden_from_boards").notNull().default(false),
    complimentary: boolean("complimentary").notNull().default(false), // owner seat (Part 3 §4.0); excluded from seat counts
    createdAt: createdAt(),
  },
  (t) => [
    // The leave/rejoin design: one LIVE membership per (gym,user); history rows stack.
    uniqueIndex("gym_members_live_uq")
      .on(t.gymId, t.userId)
      .where(sql`${t.removedAt} IS NULL`),
    index("gym_members_gym_removed_idx").on(t.gymId, t.removedAt), // roster & seat count
    // "how many people are in through THIS code" — the number the console prints
    // and the number `max_uses` is measured against, read once per code on every
    // console load and once per join at the door.
    index("gym_members_code_live_idx").on(t.codeId).where(sql`${t.removedAt} IS NULL`),
    index("gym_members_user_removed_idx").on(t.userId, t.removedAt), // entitlement resolver
    index("gym_members_gym_joined_idx").on(t.gymId, t.joinedAt), // interval joins (rollups)
  ],
);

/** THE WAITING ROOM (Kd ruling 2026-08-19, DECISIONS :11072): typing a join
 *  code creates an APPLICATION, not a membership. An unknown person is PENDING
 *  — no seat, no gym-paid features — until the gym's front desk confirms them.
 *
 *  **WHY THIS IS A TABLE OF ITS OWN AND NOT A `status` COLUMN ON
 *  `gym_members`.** Eleven places across six server files already read
 *  `removed_at IS NULL` as "this person is a live member" (measured
 *  2026-08-19): the entitlement resolver's §4.1 canonical SQL, the three
 *  per-module `getLiveGymId` spend-attribution lookups, the roster, `/mine`,
 *  the §4.2 seat count and the DPDP Day-0 close. A status column makes every
 *  one of them OPT-OUT, and the one that gets missed hands a stranger the
 *  gym's paid entitlements with nothing on any screen to show for it (:5807's
 *  class, and :1239's "fix the class, not the case" from the side where the
 *  class is created rather than discovered). A separate table leaves Part 4
 *  §4.1's and §4.2's canonical SQL VERBATIM (R4.5) and correct by
 *  construction — no edit, therefore no missed edit.
 *
 *  An ADDITION with no governing §: Part 4 §3.2 models membership only, and
 *  Part 3 §4.3 says the opposite in as many words ("code used by a stranger →
 *  they're a member like any other"). Kd's ruling supersedes that line; it is
 *  named here rather than slipped past (R0.2/R0.3). */
export const gymJoinApplications = pgTable(
  "gym_join_applications",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    // NOT NULL, unlike `gym_members.code_id`: an application exists only
    // because somebody typed a code. The roster IMPORT creates memberships
    // with no code, which is why the membership column is nullable and this
    // one is not.
    codeId: uuid("code_id")
      .notNull()
      .references(() => gymCodes.id),
    status: text("status").notNull().default("pending"),
    // Part 3 §2.4's clinic consent, captured when the person APPLIES and
    // copied onto the membership at confirm — so the record is dated to the
    // moment they agreed, not to the moment the front desk got round to it.
    consentAt: timestamp("consent_at", { withTimezone: true }),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
    // Ruled at :11385 (14 days, ratified at this card): a leaked code's pile of
    // applications clears itself, and re-applying costs a real member seconds.
    // Written here from day one so the sweep that acts on it is a worker and
    // not a backfill.
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id),
    /** The membership a confirm created — the audit trail from "who let this
     *  person in" to the row it produced. */
    memberId: uuid("member_id").references(() => gymMembers.id),
    /** :11385's ordering rule is load-bearing and these two columns are what
     *  make it checkable: nothing may EXPIRE before the gym has been told at
     *  least once. Written by the reminder sweep (its own card); NULL here
     *  means "nobody has been told", never "told at the epoch". */
    gymNotifiedAt: timestamp("gym_notified_at", { withTimezone: true }),
    memberNudgedAt: timestamp("member_nudged_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "gym_join_applications_status_check",
      sql`${t.status} IN ('pending','confirmed','rejected','cancelled','expired')`,
    ),
    // Deliberately the same partial-index shape as `gym_members_live_uq`: one
    // LIVE application per (gym,user), history rows stack. A second tap on
    // Apply is then idempotent at the DATABASE, not by the service
    // remembering to check — the same reason §4.2 leans on its own index.
    uniqueIndex("gym_join_applications_pending_uq")
      .on(t.gymId, t.userId)
      .where(sql`${t.status} = 'pending'`),
    index("gym_join_applications_gym_status_idx").on(t.gymId, t.status, t.appliedAt), // the queue
    index("gym_join_applications_user_status_idx").on(t.userId, t.status), // the member's own card + Day-0 cancel
    index("gym_join_applications_expiry_idx")
      .on(t.expiresAt)
      .where(sql`${t.status} = 'pending'`), // the expiry sweep (its own card)
  ],
);

export const gymStaff = pgTable(
  "gym_staff",
  {
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull(),
    /** WHAT THIS PERSON MAY ACTUALLY DO — the EFFECTIVE set, stored as a
     *  snapshot on the row (Kd ruling :11429's K4 call, ratified at this card;
     *  amended :14745 and again 2026-08-22 when he chose "nobody changes on
     *  their own — I tap a button").
     *
     *  **The ROLE picks the starting ticks; the TICKS are what the server
     *  enforces** (`requirePrivilege`). Storing the effective set rather than a
     *  diff against the role's template is what makes "what can this person do"
     *  answerable without knowing which version of the template they were
     *  appointed under — and it is what stops a template edit silently widening
     *  ten people's access, which is exactly what Kd ruled against.
     *
     *  **`text[]` and not JSONB, decided against R4.2 at the card as :11429
     *  asked.** JSONB is for values the app treats as a document; this is a set
     *  of enumerated strings, and the moment anything filters on one privilege
     *  (:11429 names the notifications case — "email every staff member who can
     *  manage members") an array answers it in SQL with `= ANY` and a GIN index,
     *  where a JSONB field would have to become a column.
     *
     *  **NULLABLE ONLY FOR THE DEPLOY WINDOW (R4.4 expand-then-contract), not
     *  as a model.** Every writer fills it in, and `0013`'s own backfill filled
     *  the rows that predate it, so after that migration no row is NULL —
     *  measured. The window that needs the nullability is the one where the
     *  MIGRATION has landed and the new code has not: old `createOrgAttempt` and
     *  old `addStaff` insert without this column, and a NOT NULL would break
     *  creating a gym. The reader falls back to the role's defaults for exactly
     *  those rows. Contracting to NOT NULL is owed (`OWED.md`).
     *
     *  The CHECK constrains the vocabulary the way every status column in this
     *  schema does — `text` + CHECK, never a PG enum (R4.2) — so a privilege
     *  nobody defined cannot be stored even if a caller invents one. It does NOT
     *  forbid duplicates; the write path stores a sorted, de-duplicated set. */
    privileges: text("privileges").array(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.gymId, t.userId] }),
    check("gym_staff_role_check", sql`${t.role} IN ('owner','manager','trainer')`),
    check(
      "gym_staff_privileges_check",
      sql`${t.privileges} IS NULL OR ${t.privileges} <@ ARRAY['members.read','codes.invite','codes.manage','members.confirm','members.remove','staff.manage','org.manage','billing.manage']::text[]`,
    ),
  ],
);
