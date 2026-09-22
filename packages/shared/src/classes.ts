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
 *  **It owns `minutes`, `places` and the coach, and a REPEAT owns only WHEN.**
 *  That split is the card's one design decision and it is made to avoid two
 *  answers to one question: with a length on the type AND an override on the
 *  repeat, a screen showing "45 min" beside a calendar showing 60 is one edit
 *  away, and no test that reads its own code can see it. §13.3 allows a repeat
 *  to differ in places and coach; a gym that needs Wednesday's yoga under a
 *  different coach makes a second type, or changes that day once 17b-ii lands.
 *  Recorded rather than slipped in: this NARROWS §13.3, on purpose, and the
 *  column that would widen it is deliberately absent rather than unused. */
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

/** WHEN IT REPEATS — the gym's clock time, its weekdays, and the window.
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

/** Every mutation answers with the WHOLE timetable, deliberately.
 *
 *  Saving a repeat writes up to eight weeks of dates, archiving a type removes
 *  them, and an edit re-stamps them — so "what changed" is never one row, and a
 *  screen patching its own state from a narrower reply would draw a calendar the
 *  server does not hold. One shape for six routes also means one parse. */
export const gymClassMutationResponseSchema = gymClassesResponseSchema;
export type GymClassMutationResponse = z.infer<typeof gymClassMutationResponseSchema>;
