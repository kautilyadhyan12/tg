// THE GYM'S TIMETABLE — Part 3 §13.3; ROADMAP Stage 2 item 17b-i.
//
// A gym says what it runs (a CLASS TYPE) and when it repeats (a REPEAT), and the
// server writes out every date it will run on for the next eight weeks (a
// SESSION). Three shapes, one contract, read by the console and — from 17d — by
// the phone app.
//
// **THE ONE RULE THIS FILE EXISTS TO PIN DOWN: a repeat is kept as the GYM'S
// CLOCK TIME plus the gym's own time zone, never as an instant.** `startMinute`
// is minutes past midnight ON THE GYM'S CLOCK, exactly as `gym_hours`'
// `opensMinute` already is, and the instant of each date is worked out from it
// by Postgres against `gyms.timezone`. Kept the other way round — one instant
// and a repeat of "every 168 hours" — a six o'clock class in London becomes a
// five o'clock class for half the year, which is the defect §13.3 names by name.
//
// **A SESSION CARRIES BOTH**, and both are contract: `startsAt` is the instant
// (what a clock compares against) and `localDate`/`startMinute` are what the gym
// wrote down (what a calendar draws). They are two views of one decision, not
// two decisions — the server derives the first from the second and never the
// other way.
import { z } from "zod";

/** EIGHT WEEKS, and it is a HORIZON rather than a deadline.
 *
 *  §13.3: "A daily worker fills the calendar 8 weeks ahead". A gym saving a
 *  repeat sees its dates immediately (the save fills too), and the worker keeps
 *  the far edge rolling forward one day at a time. Nothing breaks if a run is
 *  missed — the next one fills the gap, because the fill asks "which dates in
 *  the window have no row" and not "which dates are new since yesterday".
 *
 *  It is 56 and not "8 * 7" so that the number a test asserts and the number the
 *  SQL adds are the same token. */
export const CLASS_FILL_HORIZON_DAYS = 56;

/** How many of a repeat's coming dates the timetable screen shows beside it.
 *  Enough to see the pattern took (a twice-a-week repeat shows two weeks of it),
 *  small enough that a gym with sixty repeats is not sent a thousand rows. */
export const CLASS_SCHEDULE_PREVIEW_DATES = 4;

/** HOW MANY REMOVED CLASSES THE SCREEN CAN REACH.
 *
 *  **IT IS ITS OWN NUMBER BECAUSE THE ARCHIVED LIST IS THE ONE THING HERE THAT
 *  GROWS WITHOUT A CAP** — round one, C/H-2. `CLASS_TYPES_MAX` bounds the LIVE
 *  list, and archiving is exactly how a gym gets past it: two rounds of
 *  create-and-archive is 120 rows. The first version read both lists under one
 *  `LIMIT` of 120, live rows sorted first, so a gym with 130 removed classes was
 *  shown 117 and **could not bring back the other 13** — Kd's "nothing leaves
 *  for good" stopping at a number nobody had chosen.
 *
 *  200 is a recovery list, not an archive: what a gym actually comes here for is
 *  the class it removed by mistake, and `archived_at DESC` puts that first.
 *  **A gym past 200 is told so** (`archivedTotal` below is the real number, and
 *  the screen says it is showing the most recent), which is the part that makes
 *  the bound honest rather than silent. Paging it properly belongs with 17b-ii's
 *  calendar, where there is a second screen to page from. */
export const CLASS_ARCHIVED_PAGE = 200;

/** The most class types one gym may hold, archived ones excluded.
 *
 *  A ceiling rather than no ceiling because this list is read whole by the
 *  console — there is no paging on a gym's own timetable and there should not
 *  be. Sixty is well past what the products in this market show (a large gym's
 *  weekly grid is tens of slots over a handful of types); a gym that hits it has
 *  found a real need and the number moves with a migration, not a redesign. */
export const CLASS_TYPES_MAX = 60;

/** The most live repeats one class type may hold. Seven would cover "one a day";
 *  twelve leaves room for a class that runs twice on some days. */
export const CLASS_SCHEDULES_PER_TYPE_MAX = 12;

/** THE COLOURS, AS A FIXED LIST AND NOT AS A HEX STRING THE CONSOLE PICKS.
 *
 *  A colour crosses the wire, is stored, and is painted into a calendar cell
 *  next to text. Free hex would let one gym store `#ffffff` and read its own
 *  timetable as blank, and would put an attacker-chosen string into a `style`
 *  attribute — a small hole that does not need to exist. A NAME travels; the web
 *  owns what each name looks like, so light and dark themes can differ without a
 *  migration.
 *
 *  Eight, and they are distinguishable from one another for the common kinds of
 *  colour blindness — the palette the console already paints chips with. */
export const CLASS_COLOURS = [
  "orange",
  "blue",
  "green",
  "purple",
  "red",
  "teal",
  "amber",
  "slate",
] as const;
export const classColourSchema = z.enum(CLASS_COLOURS);
export type ClassColour = z.infer<typeof classColourSchema>;

/** ISO weekday: Monday is 1 and Sunday is 7.
 *
 *  **The same numbering `gym_hours.weekday` already uses**, and that is not a
 *  style choice: the two are read side by side the day a screen asks "is the gym
 *  even open then", and two weekday numberings in one product is a bug nobody
 *  sees until a Sunday. Postgres's `EXTRACT(ISODOW …)` answers in exactly these
 *  numbers, which is what lets the fill compare without a lookup table. */
export const classWeekdaySchema = z.number().int().min(1).max(7);

/** Minutes past midnight ON THE GYM'S CLOCK — `gym_hours.opensMinute`'s unit.
 *
 *  0 is midnight and 1439 is 23:59. **1440 is refused**, unlike `closesMinute`,
 *  which accepts it as "closes at midnight": a class cannot START at the end of
 *  a day it has not begun. */
export const classStartMinuteSchema = z.number().int().min(0).max(1439);

/** A calendar date, shape only. The SERVICE calendar-checks it — `2026-02-31`
 *  matches this pattern and is not a day, and Postgres refusing the cast is a
 *  500 nobody can act on. `attendanceDayQuerySchema` records the same split. */
export const classDaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** How long a class runs, in minutes. Five is the shortest thing anybody
 *  timetables; 600 is ten hours, which an all-day open-gym block reaches and
 *  nothing honest exceeds. */
export const classMinutesSchema = z.number().int().min(5).max(600);

/** HOW MANY PEOPLE FIT, and `null` MEANS NO LIMIT rather than "not set".
 *
 *  Open gym is the case that makes the distinction real: a gym floor has no
 *  booking cap, and forcing a number there would make every reader invent one.
 *  17c counts places inside the booking transaction and must be able to ask
 *  "is there a limit at all" — a sentinel like 0 or 9999 would be a number that
 *  looks like an answer. */
export const classPlacesSchema = z.number().int().min(1).max(500);

/** WHAT A GYM RUNS — the thing itself, named and coloured.
 *
 *  **`minutes`, `places` AND THE COACH ARE THE VALUES A NEW REPEAT STARTS FROM,
 *  AND NOTHING ELSE READS THEM** (Kd, RULINGS 2026-09-22; 17b-ii-a).
 *
 *  17b-i put them here and left the repeat owning only WHEN, arguing that two
 *  places to store one capacity is one edit away from a screen showing "45 min"
 *  beside a calendar showing 60. Round one called it what it was: §13.3's
 *  *"places and coach where they differ"*, dropped without a ruling. Asked for
 *  the recommendation and the industry standard, Kd ruled **follow the
 *  standard** — and the standard is unambiguous. Read 2026-09-22, TeamUp's own
 *  help centre splits the two levels by name: a Class Type edits *"the class
 *  name, description, and visibility"*, while a time slot edits *"the Venue,
 *  Instructor, Times, and Class Size Limits"*. Mindbody changes a teacher for
 *  one day, a period or permanently.
 *
 *  **So the two-answers worry is settled by direction, not by deletion:** the
 *  REPEAT is the live answer, the class type is the default it was filled in
 *  from, and the arrow only ever points one way. Changing a class here changes
 *  NO repeat and NO date already on the calendar — the server does not even
 *  read these three when it writes one (`fill.ts` takes the repeat's). */
export const gymClassTypeSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(80),
    description: z.string().max(500).nullable(),
    minutes: classMinutesSchema,
    places: classPlacesSchema.nullable(),
    /** The usual coach: a member of THIS gym's staff, by user id. `null` is "no
     *  coach named", which is the honest state for open gym and for a gym that
     *  simply does not track it. */
    coachUserId: z.string().uuid().nullable(),
    /** Their name as the console draws it. Absent when no coach is named, and
     *  absent when the named coach is no longer staff here — the screen then
     *  says so rather than printing a stranger's name it cannot vouch for. */
    coachName: z.string().max(200).nullable(),
    colour: classColourSchema,
    /** Open gym is a class type marked so (§13.3), not a fourth table. It is
     *  what 17c reads to know the floor is not a class with places. */
    openGym: z.boolean(),
    archivedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
export type GymClassType = z.infer<typeof gymClassTypeSchema>;

/** WHEN IT REPEATS — the gym's clock time, its weekdays, the window, AND ITS
 *  OWN LENGTH, PLACES AND COACH.
 *
 *  **THIS IS THE LIVE ANSWER.** The three numbers below are what the calendar is
 *  written from and what 17c will count places against; the class type's twins
 *  are only what they were filled in from. They carry the same meanings as
 *  there, deliberately — `places` null is NO LIMIT, `coachUserId` null is nobody
 *  named — so a reader never has to know which of the two rows it is holding.
 *
 *  `endsOn` null is "until we say otherwise", which is what a gym's normal
 *  timetable is.
 *
 *  **A STOPPED REPEAT IS NOT IN THIS SHAPE BECAUSE IT IS NOT IN THE ANSWER.**
 *  The database keeps `ended_at` as the record of when staff stopped it, and
 *  the read returns live repeats only — "stop this repeat" means it leaves the
 *  timetable, which is what the words mean to the gym typing them. A field here
 *  that was null on every row the server can produce would be a shape promising
 *  a state nothing serves. */
export const gymClassScheduleSchema = z
  .object({
    id: z.string().uuid(),
    classTypeId: z.string().uuid(),
    weekdays: z.array(classWeekdaySchema).min(1).max(7),
    startMinute: classStartMinuteSchema,
    startsOn: classDaySchema,
    endsOn: classDaySchema.nullable(),
    /** How long THIS repeat runs for. */
    minutes: classMinutesSchema,
    /** How many fit in THIS repeat; null is no limit. */
    places: classPlacesSchema.nullable(),
    /** Who teaches THIS repeat: a member of this gym's staff, by user id. */
    coachUserId: z.string().uuid().nullable(),
    /** Their name as the console draws it — answered only while they are still
     *  this gym's active staff, the class type's rule verbatim and for the same
     *  reason: a timetable must never print a name the gym cannot vouch for. */
    coachName: z.string().max(200).nullable(),
    /** The next few dates this repeat will actually run on, from the sessions
     *  that were written — **read back from the table, never recomputed for the
     *  screen.** A second derivation is a second answer, and the one the gym
     *  would be shown is the one nothing books against. */
    nextDates: z.array(classDaySchema).max(CLASS_SCHEDULE_PREVIEW_DATES),
    /** How many dates this repeat holds inside the eight-week window. Says the
     *  fill ran, and says a repeat that has finished holds none.
     *
     *  **IT IS NOT "how many times this class runs" AND A SCREEN MUST NOT PRINT
     *  IT AS ONE** — round one, C/H-3, which is Kd's own catch arriving a second
     *  time. Read `datesComplete` first. */
    sessionsAhead: z.number().int().min(0),
    /** **IS `sessionsAhead` THE WHOLE TRUTH?** True only when the repeat ends
     *  INSIDE the eight-week window, so every date it will ever run on is
     *  already written. False for an open-ended repeat and — the case that got
     *  through round one — for one that ends beyond the horizon: a gym putting
     *  its timetable in until next September holds 52 Mondays and the window
     *  holds 8, and the screen said "8 dates on the calendar".
     *
     *  **THE SERVER ANSWERS IT BECAUSE THE SERVER OWNS BOTH NUMBERS** — the
     *  horizon and the gym's own today. A screen working it out from
     *  `horizonDays` would be a second derivation of the one thing that has
     *  already been wrong twice. */
    datesComplete: z.boolean(),
    /** Has this repeat's own end date already passed? A repeat that has run its
     *  course stays on the timetable (nothing ends it), and without this the
     *  screen said "nothing on the calendar **yet**" about something that had
     *  finished months ago — round one, Low-1. Again the SERVER's answer,
     *  because "today" is the gym's, not the reader's. */
    finished: z.boolean(),
  })
  .strict();
export type GymClassSchedule = z.infer<typeof gymClassScheduleSchema>;

export const gymClassTimetableEntrySchema = z
  .object({ type: gymClassTypeSchema, schedules: z.array(gymClassScheduleSchema) })
  .strict();
export type GymClassTimetableEntry = z.infer<typeof gymClassTimetableEntrySchema>;

/** THE WHOLE TIMETABLE, as the console's Classes screen reads it.
 *
 *  `timezone` and `clockFormat` ride along because every time on this screen is
 *  the GYM's, and a screen that formatted them in the browser's zone would show
 *  an owner in Dubai their London gym's six o'clock class at ten. It is the same
 *  pair `gymHoursResponseSchema` carries, for the same reason. */
export const gymClassesResponseSchema = z
  .object({
    timezone: z.string().min(1).max(64),
    clockFormat: z.enum(["12h", "24h"]),
    horizonDays: z.number().int().min(1),
    entries: z.array(gymClassTimetableEntrySchema),
    /** The most recently removed classes, newest first, at most
     *  `CLASS_ARCHIVED_PAGE` of them. */
    archived: z.array(gymClassTypeSchema),
    /** **HOW MANY THERE REALLY ARE**, which is not `archived.length` once a gym
     *  passes the page (round one, C/H-2: the screen said "117 kept" of 130).
     *  The count is the gym's, the list is a page of it, and the screen says so
     *  when the two differ. */
    archivedTotal: z.number().int().min(0),
  })
  .strict();
export type GymClassesResponse = z.infer<typeof gymClassesResponseSchema>;

/** The fields a gym types. `description` accepts an empty string and stores
 *  null — a box the owner cleared means "no description", and a screen that then
 *  rendered "" under a dangling heading is `closeGymDayRequestSchema`'s lesson. */
export const createGymClassTypeRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500).optional(),
    minutes: classMinutesSchema,
    places: classPlacesSchema.nullable().optional(),
    coachUserId: z.string().uuid().nullable().optional(),
    colour: classColourSchema,
    openGym: z.boolean().optional(),
  })
  .strict();
export type CreateGymClassTypeRequest = z.infer<typeof createGymClassTypeRequestSchema>;

/** EVERY FIELD, EVERY TIME — this is a replace, not a merge.
 *
 *  `setGymHours`' reasoning, one table down: a PATCH that merges lets a stale
 *  screen keep a value the gym has already changed elsewhere, and the fields
 *  here are few enough that the form always holds all of them. `places: null`
 *  therefore means "no limit" and never "leave it alone", which is the
 *  distinction a merge would destroy. */
export const updateGymClassTypeRequestSchema = createGymClassTypeRequestSchema;
export type UpdateGymClassTypeRequest = z.infer<typeof updateGymClassTypeRequestSchema>;

/** WHAT A REPEAT'S OWN THREE FIELDS LOOK LIKE ON THE WIRE — one shape, so
 *  adding one and changing one cannot drift apart.
 *
 *  **EVERY KEY IS REQUIRED, and the DEFAULTING HAPPENS IN THE FORM.** The screen
 *  opens the repeat form already filled in from the class type; the request then
 *  states all three outright. A server that filled a missing key in from the
 *  type would be a second place the default is decided, and the two would drift
 *  apart the day the form changed. Nullable where null is an ANSWER — no limit, nobody
 *  named — and never where it would mean "not said". */
const classScheduleFieldsShape = {
  minutes: classMinutesSchema,
  places: classPlacesSchema.nullable(),
  coachUserId: z.string().uuid().nullable(),
};

/** A repeat, as a gym types it.
 *
 *  **`weekdays` is de-duplicated and sorted HERE**, so the column, the fill's
 *  `= ANY` and the screen all see one canonical set. Sending Monday twice is a
 *  clumsy spelling of a valid request, not an error — and a duplicate left in
 *  would not double a date (the unique index refuses it) but would make the
 *  stored row and the screen disagree about what the gym asked for. */
export const createGymClassScheduleRequestSchema = z
  .object({
    weekdays: z
      .array(classWeekdaySchema)
      .min(1)
      .max(7)
      .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
    startMinute: classStartMinuteSchema,
    startsOn: classDaySchema,
    endsOn: classDaySchema.nullable().optional(),
    ...classScheduleFieldsShape,
  })
  .strict()
  // AN INVERTED WINDOW IS A 400, NOT A REPEAT THAT SILENTLY RUNS ON NO DAY.
  // Compared as strings on `attendanceHistoryQuerySchema`'s stated terms: a
  // fixed-width zero-padded `YYYY-MM-DD` sorts in calendar order, and these two
  // fields can never gain an offset without this line moving with them. Equal is
  // ALLOWED here and is not a mistake — a one-day repeat is how a gym puts a
  // single workshop on the calendar before 17b-ii's one-off exists.
  .refine((r) => r.endsOn === undefined || r.endsOn === null || r.startsOn <= r.endsOn, {
    message: "`endsOn` cannot be before `startsOn`",
    path: ["endsOn"],
  });
export type CreateGymClassScheduleRequest = z.infer<typeof createGymClassScheduleRequestSchema>;

/** CHANGING A REPEAT — its length, its places and its coach, and nothing else.
 *
 *  **WHEN IT RUNS IS DELIBERATELY NOT HERE.** Moving a repeat's day or time is
 *  §13.3's *"this day and later"* — the old repeat ends and a new one begins, so
 *  that the dates already on the calendar keep the time they were booked at —
 *  and that is 17b-ii-b's, with the week view it needs. A PUT that quietly
 *  re-timed every coming date would be the same change with none of the care.
 *
 *  A replace and not a merge, `updateGymClassTypeRequestSchema`'s reasoning:
 *  `places: null` has to mean "no limit" and can never be allowed to also mean
 *  "leave it alone". */
export const updateGymClassScheduleRequestSchema = z
  .object({ ...classScheduleFieldsShape })
  .strict();
export type UpdateGymClassScheduleRequest = z.infer<typeof updateGymClassScheduleRequestSchema>;

/** A date on the calendar is `scheduled` or `cancelled` — the column's CHECK,
 *  word for word. A cancelled date keeps its row so the week can show it struck
 *  through and staff can put it back (17b-ii-b-i). */
export const CLASS_SESSION_STATUSES = ["scheduled", "cancelled"] as const;
export const classSessionStatusSchema = z.enum(CLASS_SESSION_STATUSES);
export type ClassSessionStatus = z.infer<typeof classSessionStatusSchema>;

/** ONE DATE A CLASS RUNS ON, as the week view draws it (§13.3, §13.6).
 *
 *  Its numbers are its own: a date is stamped from its repeat when it is
 *  written, and a date changed on its own keeps what staff gave it. */
export const gymClassSessionSchema = z
  .object({
    id: z.string().uuid(),
    classTypeId: z.string().uuid(),
    /** Null only for a date with no repeat behind it, which nothing writes yet. */
    scheduleId: z.string().uuid().nullable(),
    name: z.string().min(1).max(80),
    colour: classColourSchema,
    openGym: z.boolean(),
    localDate: classDaySchema,
    startMinute: classStartMinuteSchema,
    startsAt: z.string().datetime({ offset: true }),
    minutes: classMinutesSchema,
    places: classPlacesSchema.nullable(),
    coachUserId: z.string().uuid().nullable(),
    /** Answered only while the coach is still this gym's active staff. */
    coachName: z.string().max(200).nullable(),
    status: classSessionStatusSchema,
    /** Staff changed this date's time, length, places or coach on its own, so a
     *  later change to its repeat leaves it as it is. */
    changedAlone: z.boolean(),
    /** Has it already started, by the server's clock? A started date cannot be
     *  changed, cancelled or put back. */
    started: z.boolean(),
    /** Its repeat has been stopped, or its class removed. Only a cancelled date
     *  can be in this state (Stop and Remove delete the running ones), and it
     *  cannot be put back: nothing runs there any more. */
    repeatStopped: z.boolean(),
  })
  .strict();
export type GymClassSession = z.infer<typeof gymClassSessionSchema>;

/** ONE WEEK OF THE CALENDAR, Monday to Sunday in the gym's own calendar.
 *
 *  `lastWeekStart` is the last Monday whose whole week is already written, so
 *  the screen never shows an unwritten week as "no classes". */
export const gymClassWeekResponseSchema = z
  .object({
    timezone: z.string().min(1).max(64),
    clockFormat: z.enum(["12h", "24h"]),
    /** The gym's own today. */
    today: classDaySchema,
    weekStart: classDaySchema,
    lastWeekStart: classDaySchema,
    sessions: z.array(gymClassSessionSchema),
  })
  .strict();
export type GymClassWeekResponse = z.infer<typeof gymClassWeekResponseSchema>;

/** Any date inside the week wanted; the server moves it back to its Monday.
 *  Absent is the week holding the gym's today. */
export const gymClassWeekQuerySchema = z.object({ week: classDaySchema.optional() }).strict();
export type GymClassWeekQuery = z.infer<typeof gymClassWeekQuerySchema>;

/** CHANGE THIS DAY ONLY — its start time, length, places and coach. Every field
 *  every time, a replace like the repeat's own edit. The DATE is not here:
 *  moving a class to another day is "this day and later" (17b-ii-b-ii). */
export const changeGymClassSessionRequestSchema = z
  .object({ startMinute: classStartMinuteSchema, ...classScheduleFieldsShape })
  .strict();
export type ChangeGymClassSessionRequest = z.infer<typeof changeGymClassSessionRequestSchema>;

/** Every mutation answers with the WHOLE timetable, deliberately.
 *
 *  Saving a repeat writes up to eight weeks of dates, archiving a type removes
 *  them, and an edit re-stamps them — so "what changed" is never one row, and a
 *  screen patching its own state from a narrower reply would draw a calendar the
 *  server does not hold. One shape for six routes also means one parse. */
export const gymClassMutationResponseSchema = gymClassesResponseSchema;
export type GymClassMutationResponse = z.infer<typeof gymClassMutationResponseSchema>;
