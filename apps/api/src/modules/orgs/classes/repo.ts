// THE TIMETABLE'S ONLY DATABASE FILE (R7.1: repos are the only files that touch
// the database). Part 3 §13.3; ROADMAP 17b-i.
//
// **EVERY STATEMENT HERE CARRIES `gym_id` IN ITS `WHERE`, INCLUDING THE ONES
// THAT ALREADY HOLD A UUID** (CLAUDE.md §4, Tenancy). A class type id is a
// uuid somebody could hold from another gym, and the id alone is never the key:
// the pair is. That is the rule the worst-thing test drives — one gym's staff
// must not be able to rename, archive or re-time another gym's classes with an
// id they came by, and a `WHERE id = $1` that happened to be right today would
// be one refactor away from not being.
//
// **EVERY WRITE TAKES THE GYM'S ROW LOCK FIRST** (`lockOrgRow`, shared with the
// orgs repo). Three things need it and the third is the reason it is not
// optional: the per-gym CAPS are check-then-act and two staff can pass them
// together; the CALENDAR FILL runs in the same transaction as the repeat that
// produced it, so a gym never sees a repeat with no dates behind it; and an
// edit RE-STAMPS the future sessions the REPEAT still owns (`0036` moved that
// from the class type, RULINGS 2026-09-22), which must not interleave with a
// fill writing new ones.
//
// **AND THE COACH CHECK IS ASKED INSIDE EVERY WRITE THAT CAN NAME ONE**, since a
// repeat and a single date carry their own. `coach_user_id` is a FK to
// `users`, so nothing structural stops one gym naming another gym's trainer on
// its timetable; `coachIsStaff` under the lock is what does.
import type { Sql, TransactionSql } from "postgres";
import {
  CLASS_ARCHIVED_PAGE,
  CLASS_FILL_HORIZON_DAYS,
  CLASS_SCHEDULES_LISTED_PER_TYPE_MAX,
  CLASS_SCHEDULES_PER_TYPE_MAX,
  CLASS_SCHEDULE_PREVIEW_DATES,
  CLASS_TYPES_MAX,
} from "@app/shared";
import { insertAudit, lockOrgRow } from "../repo.js";
import { dayVerdict } from "./dayRule.js";
import { fillClassSessions } from "./fill.js";
import {
  fromVerdict,
  slotChangeKind,
  peakRunning,
  slotDateFate,
  slotLimitVerdict,
  type FromVerdict,
} from "./slotRule.js";

export interface ClassTypeRow {
  id: string;
  name: string;
  description: string | null;
  minutes: number;
  places: number | null;
  coachUserId: string | null;
  coachName: string | null;
  colour: string;
  openGym: boolean;
  archivedAt: Date | null;
}

export interface ClassScheduleRow {
  id: string;
  classTypeId: string;
  weekdays: number[];
  startMinute: number;
  startsOn: string;
  endsOn: string | null;
  /** THE REPEAT'S OWN THREE, and the live answer for every reader (RULINGS
   *  2026-09-22). The class type's twins are only what these were filled in
   *  from at the moment the repeat was created. */
  minutes: number;
  places: number | null;
  coachUserId: string | null;
  coachName: string | null;
  nextDates: string[];
  sessionsAhead: number;
  datesComplete: boolean;
  finished: boolean;
  startedToday: boolean;
}

export interface TimetableRow {
  timezone: string;
  clockFormat: string;
  types: ClassTypeRow[];
  archived: ClassTypeRow[];
  archivedTotal: number;
  schedules: ClassScheduleRow[];
}

/** The read the console's Classes screen is made of.
 *
 *  **THREE STATEMENTS AND NOT ONE, deliberately.** A single query joining types
 *  to repeats to sessions fans a type out once per repeat per preview date, and
 *  the shaping code would then have to un-fan it — which is where a count comes
 *  out multiplied. They are independent reads over small per-gym sets.
 *
 *  **THE LIVE LIST AND THE ARCHIVED LIST ARE READ SEPARATELY, AND ROUND ONE IS
 *  WHY (C/H-2).** They shared one statement and one `LIMIT` of 120, with live
 *  rows sorted first — so a gym with 130 removed classes was shown 117 of them,
 *  told "117 kept", and **could not bring back the other 13**, because Bring
 *  back is only addressable from that list. The comment here claimed the archive
 *  was bounded by the live cap; archiving is precisely how a gym gets past it.
 *
 *  Now: the live list is bounded by `CLASS_TYPES_MAX`, which is a real cap the
 *  writes enforce; the archived list is its own page of `CLASS_ARCHIVED_PAGE`,
 *  newest first, and `archivedTotal` is the gym's real number so the screen can
 *  say when it is showing a page of a longer list rather than all of it. */
export async function readTimetable(
  sql: Sql,
  gymId: string,
  opts: { now?: Date } = {},
): Promise<TimetableRow | null> {
  const now = opts.now ?? new Date();

  // ONE SHAPE, TWO QUERIES. `archived` decides which half; everything else about
  // the two statements is identical, so a change to the coach join cannot reach
  // one list and miss the other.
  const readTypes = (archived: boolean, limit: number) =>
    sql<
      {
        id: string;
        name: string;
        description: string | null;
        minutes: number;
        places: number | null;
        coach_user_id: string | null;
        coach_name: string | null;
        colour: string;
        open_gym: boolean;
        archived_at: Date | null;
        timezone: string;
        clock_format: string;
      }[]
    >`
      SELECT t.id, t.name, t.description, t.minutes, t.places,
             t.coach_user_id, t.colour, t.open_gym, t.archived_at,
             g.timezone, g.clock_format,
             -- THE COACH'S NAME IS ONLY ANSWERED WHILE THEY ARE STILL THIS GYM'S
             -- STAFF. The join is through gym_staff and not straight to users,
             -- which is the tenancy rule applied to a NAME: a coach who has left
             -- (or a row that outlived a staff change) must read back as "nobody
             -- named" rather than as a person this gym can no longer vouch for.
             cu.display_name AS coach_name
      FROM gym_class_types t
      JOIN gyms g ON g.id = t.gym_id
      LEFT JOIN gym_staff cs ON cs.gym_id = t.gym_id AND cs.user_id = t.coach_user_id
      LEFT JOIN users cu ON cu.id = cs.user_id AND cu.status = 'active'
      WHERE t.gym_id = ${gymId}
        AND (t.archived_at IS NOT NULL) = ${archived}
      -- The LIVE list is the gym's own alphabet: lower() so "abs blast" and
      -- "Abs Blast" do not sit a screen apart, and id last so two classes with
      -- one name never swap places between two reads (:0034's lesson — an
      -- unstable ORDER BY is a list that reorders itself).
      -- The ARCHIVED list is NEWEST FIRST, because what a gym comes to it for is
      -- the class it removed by mistake a minute ago.
      ORDER BY
        CASE WHEN ${archived} THEN t.archived_at END DESC NULLS LAST,
        lower(t.name), t.id
      LIMIT ${limit}`;

  const typeRows = await readTypes(false, CLASS_TYPES_MAX);
  const archivedRows = await readTypes(true, CLASS_ARCHIVED_PAGE);

  // The gym's own row rides on the type rows, so a gym with no classes still
  // needs asking. This is the empty-list branch, and it also answers the
  // archived TOTAL — which is not `archivedRows.length` once a gym passes the
  // page, and is the number the screen prints.
  const [gymRow] = await sql<
    { timezone: string; clock_format: string; archived_total: number }[]
  >`
    SELECT g.timezone, g.clock_format,
           (SELECT count(*)::int FROM gym_class_types a
             WHERE a.gym_id = g.id AND a.archived_at IS NOT NULL) AS archived_total
    FROM gyms g WHERE g.id = ${gymId}`;
  if (gymRow === undefined) return null;

  const scheduleRows = await sql<
    {
      id: string;
      class_type_id: string;
      weekdays: number[];
      local_start_minute: number;
      starts_on: string;
      ends_on: string | null;
      minutes: number;
      places: number | null;
      coach_user_id: string | null;
      coach_name: string | null;
      next_dates: string[] | null;
      sessions_ahead: number;
      dates_complete: boolean;
      finished: boolean;
      started_today: boolean;
    }[]
  >`
    SELECT s.id, s.class_type_id, s.weekdays, s.local_start_minute,
           s.starts_on::text AS starts_on, s.ends_on::text AS ends_on,
           s.minutes, s.places, s.coach_user_id,
           -- THE COACH'S NAME, ANSWERED ONLY WHILE THEY ARE STILL THIS GYM'S
           -- STAFF — the class type read's join, word for word and for the same
           -- reason: a timetable must not print a name the gym cannot vouch for,
           -- and joining straight to users would print one for a coach who
           -- left, or for a person another gym's id happened to name.
           scu.display_name AS coach_name,
           n.next_dates, coalesce(n.sessions_ahead, 0) AS sessions_ahead,
           -- IS sessions_ahead THE WHOLE TRUTH? Only when the repeat ENDS
           -- inside the window, so every date it will ever run on is written.
           -- Round one C/H-3: a repeat ending a year out holds 52 Mondays and
           -- the window holds 8, and the screen printed "8 dates on the
           -- calendar". The SERVER answers it because the server owns both
           -- numbers — the horizon and the gym's own today.
           (s.ends_on IS NOT NULL
            AND s.ends_on <= ((${now}::timestamptz AT TIME ZONE g.timezone)::date
                              + ${CLASS_FILL_HORIZON_DAYS}::int)) AS dates_complete,
           -- HAS IT ALREADY RUN ITS COURSE? Nothing ends a repeat whose end date
           -- passes, so without this the screen said "nothing on the calendar
           -- YET" about something finished months ago (round one, Low-1).
           (s.ends_on IS NOT NULL
            AND s.ends_on < (${now}::timestamptz AT TIME ZONE g.timezone)::date) AS finished,
           -- Has today's class of this time slot started? The screen then offers
           -- tomorrow as the first date a change starts from (round one, L-4).
           EXISTS (
             SELECT 1 FROM gym_class_sessions t
             WHERE t.schedule_id = s.id
               AND t.gym_id = s.gym_id
               AND t.local_date = (${now}::timestamptz AT TIME ZONE g.timezone)::date
               AND t.starts_at <= ${now}) AS started_today
    FROM gym_class_schedules s
    JOIN gyms g ON g.id = s.gym_id
    LEFT JOIN gym_staff scs ON scs.gym_id = s.gym_id AND scs.user_id = s.coach_user_id
    LEFT JOIN users scu ON scu.id = scs.user_id AND scu.status = 'active'
    -- WHAT THE GYM WILL ACTUALLY SEE, READ BACK FROM THE CALENDAR — never
    -- recomputed from the repeat for the screen. A second derivation is a second
    -- answer, and the one shown would be the one nothing books against: if the
    -- fill has not run, or a day was cancelled, THIS is what says so.
    -- From NOW, not from the gym's today: a class that ran this morning is not
    -- one of the next ones (found at 17b-ii-w).
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS sessions_ahead,
             (array_agg(x.local_date::text ORDER BY x.local_date))
               [1:${CLASS_SCHEDULE_PREVIEW_DATES}] AS next_dates
      FROM gym_class_sessions x
      WHERE x.schedule_id = s.id
        AND x.gym_id = s.gym_id
        AND x.starts_at > ${now}
        AND x.status = 'scheduled'
    ) n ON TRUE
    WHERE s.gym_id = ${gymId}
      AND s.ended_at IS NULL
    -- Time slots that have ended come last, newest first, so the LIMIT can only
    -- ever leave out an ended one; a split's two halves sit in date order
    -- (round one, L-1 and L-2). The ones not finished are capped at
    -- CLASS_SCHEDULES_LISTED_PER_TYPE_MAX a class, which is what the LIMIT is sized on.
    ORDER BY (s.ends_on IS NOT NULL
              AND s.ends_on < (${now}::timestamptz AT TIME ZONE g.timezone)::date),
             CASE WHEN s.ends_on < (${now}::timestamptz AT TIME ZONE g.timezone)::date
                  THEN s.ends_on END DESC NULLS FIRST,
             s.local_start_minute, s.starts_on, s.id
    LIMIT ${CLASS_TYPES_MAX * CLASS_SCHEDULES_LISTED_PER_TYPE_MAX}`;

  const toType = (r: {
    id: string;
    name: string;
    description: string | null;
    minutes: number;
    places: number | null;
    coach_user_id: string | null;
    coach_name: string | null;
    colour: string;
    open_gym: boolean;
    archived_at: Date | null;
  }): ClassTypeRow => ({
    id: r.id,
    name: r.name,
    description: r.description,
    minutes: r.minutes,
    places: r.places,
    coachUserId: r.coach_user_id,
    coachName: r.coach_name,
    colour: r.colour,
    openGym: r.open_gym,
    archivedAt: r.archived_at,
  });

  return {
    timezone: gymRow.timezone,
    clockFormat: gymRow.clock_format,
    archivedTotal: gymRow.archived_total,
    archived: archivedRows.map(toType),
    types: typeRows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      minutes: r.minutes,
      places: r.places,
      coachUserId: r.coach_user_id,
      coachName: r.coach_name,
      colour: r.colour,
      openGym: r.open_gym,
      archivedAt: r.archived_at,
    })),
    schedules: scheduleRows.map((r) => ({
      id: r.id,
      classTypeId: r.class_type_id,
      weekdays: r.weekdays,
      startMinute: r.local_start_minute,
      startsOn: r.starts_on,
      endsOn: r.ends_on,
      minutes: r.minutes,
      places: r.places,
      coachUserId: r.coach_user_id,
      coachName: r.coach_name,
      nextDates: r.next_dates ?? [],
      sessionsAhead: r.sessions_ahead,
      datesComplete: r.dates_complete,
      finished: r.finished,
      startedToday: r.started_today,
    })),
  };
}

export interface ClassTypeInput {
  name: string;
  description: string | null;
  minutes: number;
  places: number | null;
  coachUserId: string | null;
  colour: string;
  openGym: boolean;
}

export type ClassWriteOutcome =
  | { kind: "ok" }
  | { kind: "not_found" }
  | { kind: "coach_not_staff" }
  | { kind: "clashes" }
  /** The gym's limit of classes. */
  | { kind: "too_many"; cap: number }
  /** The class's limit of time slots running at once. */
  | { kind: "too_many_slots"; cap: number }
  /** The class's limit of time slots listed; `would` is how many it would list. */
  | { kind: "too_many_listed"; cap: number; would: number };

/** IS THIS PERSON THIS GYM'S STAFF — asked INSIDE the write's transaction, under
 *  the gym's lock, so it cannot be answered against a roster that changes
 *  between the check and the insert. It is the one rule the column's own foreign
 *  key cannot express (`0035`'s statement 1 says why). */
async function coachIsStaff(
  tx: TransactionSql,
  gymId: string,
  coachUserId: string | null,
): Promise<boolean> {
  if (coachUserId === null) return true;
  const rows = await tx<{ ok: number }[]>`
    SELECT 1 AS ok FROM gym_staff s
    JOIN users u ON u.id = s.user_id
    WHERE s.gym_id = ${gymId} AND s.user_id = ${coachUserId} AND u.status = 'active'`;
  return rows.length > 0;
}

export async function createClassType(
  sql: Sql,
  input: ClassTypeInput & { gymId: string; actorUserId: string },
): Promise<ClassWriteOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId);
    const [gym] = await tx<{ id: string }[]>`SELECT id FROM gyms WHERE id = ${input.gymId}`;
    if (gym === undefined) return { kind: "not_found" };
    if (!(await coachIsStaff(tx, input.gymId, input.coachUserId))) {
      return { kind: "coach_not_staff" };
    }

    // THE CAP IS COUNTED UNDER THE LOCK, which is what makes it a cap rather
    // than a suggestion: two staff pressing Add at the same instant would both
    // pass a count taken outside one.
    const [live] = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM gym_class_types
      WHERE gym_id = ${input.gymId} AND archived_at IS NULL`;
    if ((live?.n ?? 0) >= CLASS_TYPES_MAX) return { kind: "too_many", cap: CLASS_TYPES_MAX };

    const [created] = await tx<{ id: string }[]>`
      INSERT INTO gym_class_types
        (gym_id, name, description, minutes, places, coach_user_id, colour, open_gym)
      VALUES (${input.gymId}, ${input.name}, ${input.description}, ${input.minutes},
              ${input.places}, ${input.coachUserId}, ${input.colour}, ${input.openGym})
      RETURNING id`;
    if (created === undefined) throw new Error("class type insert returned no row");

    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.class_type_created",
      targetType: "gym_class_type",
      targetId: created.id,
      // The name and the shape, not the whole row: a reader weeks later wants
      // "who put this class on the timetable and what was it".
      meta: { name: input.name, minutes: String(input.minutes), openGym: String(input.openGym) },
    });
    return { kind: "ok" };
  });
}

export async function updateClassType(
  sql: Sql,
  input: ClassTypeInput & { gymId: string; classTypeId: string; actorUserId: string; now: Date },
): Promise<ClassWriteOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId);
    // THE PAIR IS THE KEY. `id` alone would let a uuid from another gym through.
    const [before] = await tx<{ id: string; name: string }[]>`
      SELECT id, name FROM gym_class_types
      WHERE id = ${input.classTypeId} AND gym_id = ${input.gymId} AND archived_at IS NULL`;
    if (before === undefined) return { kind: "not_found" };
    if (!(await coachIsStaff(tx, input.gymId, input.coachUserId))) {
      return { kind: "coach_not_staff" };
    }

    await tx`
      UPDATE gym_class_types
      SET name = ${input.name}, description = ${input.description},
          minutes = ${input.minutes}, places = ${input.places},
          coach_user_id = ${input.coachUserId}, colour = ${input.colour},
          open_gym = ${input.openGym}, updated_at = ${input.now}
      WHERE id = ${input.classTypeId} AND gym_id = ${input.gymId}`;

    // **NO CALENDAR STATEMENT HERE, AND ITS ABSENCE IS THE CARD** (RULINGS
    // 2026-09-22). 17b-i re-stamped every future session with the type's new
    // numbers, because the type was the only place they lived. Since `0036` the
    // REPEAT is the live answer and this row holds the values a NEW repeat is
    // filled in from — so changing a class must leave every repeat and every
    // date already on the calendar exactly as they are, which is TeamUp's split
    // (a Class Type edits its name, description and visibility; a time slot
    // edits instructor, times and class size limits).
    //
    // The re-stamp moved to `changeSlotFrom` below, where the numbers now live.

    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.class_type_updated",
      targetType: "gym_class_type",
      targetId: input.classTypeId,
      meta: { before: before.name, after: input.name },
    });
    return { kind: "ok" };
  });
}

/** ARCHIVE — the only way a class type leaves the timetable, and never a DELETE
 *  (§13.1's rule for membership types, same reason here: 17c's bookings will
 *  point at sessions of a type, and a type nobody can name again is not a type
 *  that never existed).
 *
 *  **ITS FUTURE DATES GO AND ITS PAST DATES STAY.** Archiving means the class
 *  stops running, so a calendar still offering it next Tuesday would be saying
 *  something false; the days it already ran are the gym's history and are not
 *  this button's business. Its repeats are stopped in the same transaction, so
 *  the nightly fill cannot put the dates back.
 *
 *  **WHEN 17c LANDS THIS BECOMES A DIFFERENT DECISION and the comment is here
 *  so it is made rather than inherited:** a future session with people booked on
 *  it cannot simply vanish — it has to be cancelled and everybody told. Today
 *  nothing can be booked, so nobody is losing anything. */
export async function archiveClassType(
  sql: Sql,
  input: { gymId: string; classTypeId: string; actorUserId: string; now: Date },
): Promise<ClassWriteOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId);
    const [before] = await tx<{ id: string; name: string }[]>`
      SELECT id, name FROM gym_class_types
      WHERE id = ${input.classTypeId} AND gym_id = ${input.gymId} AND archived_at IS NULL`;
    if (before === undefined) return { kind: "not_found" };

    await tx`
      UPDATE gym_class_types SET archived_at = ${input.now}, updated_at = ${input.now}
      WHERE id = ${input.classTypeId} AND gym_id = ${input.gymId}`;
    await tx`
      UPDATE gym_class_schedules SET ended_at = ${input.now}
      WHERE class_type_id = ${input.classTypeId}
        AND gym_id = ${input.gymId}
        AND ended_at IS NULL`;
    const removed = await tx`
      DELETE FROM gym_class_sessions
      WHERE class_type_id = ${input.classTypeId}
        AND gym_id = ${input.gymId}
        AND starts_at > ${input.now}`;

    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.class_type_archived",
      targetType: "gym_class_type",
      targetId: input.classTypeId,
      meta: { name: before.name, sessionsRemoved: String(removed.count) },
    });
    return { kind: "ok" };
  });
}

/** BRING A CLASS BACK — the other side of the archive, and Kd's call on
 *  2026-09-22 after asking what real gym software does.
 *
 *  **THE TWO BIGGEST PRODUCTS DISAGREE AND THAT IS WHY IT IS HIS RULING.**
 *  TeamUp: *"once a Class Type has been archived in TeamUp, you will not be able
 *  to reinstate it"* — one way. Mindbody: deactivate, then "View inactive
 *  service categories" and press **Activate**. He took Mindbody's, on his own
 *  standing rule that nothing is taken away, and because the button that
 *  archives says "Remove", which is not a word a one-way door should carry.
 *
 *  **ITS REPEATS STAY STOPPED, DELIBERATELY.** The archive ended them and
 *  deleted their future dates; un-ending them here would put dates back on a
 *  calendar nobody has asked for, off a window that may be months past. The gym
 *  adds a repeat again — two taps — and its PAST dates were never touched, so
 *  the class comes back with its history attached.
 *
 *  **IT COUNTS AGAINST THE CAP**, because a restored class is a live class. A
 *  gym at its limit is told to archive one first, which is the same sentence
 *  `createClassType` answers. */
export async function restoreClassType(
  sql: Sql,
  input: { gymId: string; classTypeId: string; actorUserId: string; now: Date },
): Promise<ClassWriteOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId);
    // The pair is the key, and `archived_at IS NOT NULL` is part of it: bringing
    // back a class that is already live is a 404, not a silent no-op, because
    // the caller is acting on a list that has moved under them.
    const [before] = await tx<{ id: string; name: string }[]>`
      SELECT id, name FROM gym_class_types
      WHERE id = ${input.classTypeId} AND gym_id = ${input.gymId} AND archived_at IS NOT NULL`;
    if (before === undefined) return { kind: "not_found" };

    const [live] = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM gym_class_types
      WHERE gym_id = ${input.gymId} AND archived_at IS NULL`;
    if ((live?.n ?? 0) >= CLASS_TYPES_MAX) return { kind: "too_many", cap: CLASS_TYPES_MAX };

    await tx`
      UPDATE gym_class_types SET archived_at = NULL, updated_at = ${input.now}
      WHERE id = ${input.classTypeId} AND gym_id = ${input.gymId}`;

    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.class_type_restored",
      targetType: "gym_class_type",
      targetId: input.classTypeId,
      meta: { name: before.name },
    });
    return { kind: "ok" };
  });
}

export interface ClassScheduleInput {
  weekdays: readonly number[];
  startMinute: number;
  startsOn: string;
  endsOn: string | null;
}

/** A repeat's OWN length, places and coach — the live answer for every reader
 *  since `0036`. One shape for the create and the edit, so the two cannot
 *  disagree about what a repeat is allowed to hold. */
export interface ClassScheduleFields {
  minutes: number;
  places: number | null;
  coachUserId: string | null;
}

/** A class's time slots not yet finished (the ones the Classes screen lists),
 *  and the gym's today, for `slotLimitVerdict`. */
async function listedSlots(
  tx: TransactionSql,
  w: { gymId: string; classTypeId: string; now: Date },
): Promise<{ today: string; slots: { id: string; startsOn: string; endsOn: string | null }[] }> {
  const [gym] = await tx<{ today: string }[]>`
    SELECT ((${w.now}::timestamptz AT TIME ZONE timezone)::date)::text AS today
    FROM gyms WHERE id = ${w.gymId}`;
  if (gym === undefined) throw new Error("gym not found under its own lock");
  const rows = await tx<{ id: string; starts_on: string; ends_on: string | null }[]>`
    SELECT id, starts_on::text AS starts_on, ends_on::text AS ends_on
    FROM gym_class_schedules
    WHERE class_type_id = ${w.classTypeId}
      AND gym_id = ${w.gymId}
      AND ended_at IS NULL
      AND (ends_on IS NULL OR ends_on >= ${gym.today}::date)`;
  return {
    today: gym.today,
    slots: rows.map((r) => ({ id: r.id, startsOn: r.starts_on, endsOn: r.ends_on })),
  };
}

/** ADD A REPEAT — **and write its dates in the same transaction.**
 *
 *  That is the one thing this function does that a naive version would not, and
 *  it is not an optimisation: a repeat saved without its calendar is a state a
 *  gym would look straight at ("you added it, where is it?"), and it would last
 *  until the nightly job. The fill is scoped to this gym so one gym's save never
 *  waits on every other gym's calendar. */
export async function createSchedule(
  sql: Sql,
  input: ClassScheduleInput &
    ClassScheduleFields & {
      gymId: string;
      classTypeId: string;
      actorUserId: string;
      now: Date;
    },
): Promise<ClassWriteOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId);
    const [type] = await tx<{ id: string; name: string }[]>`
      SELECT id, name FROM gym_class_types
      WHERE id = ${input.classTypeId} AND gym_id = ${input.gymId} AND archived_at IS NULL`;
    if (type === undefined) return { kind: "not_found" };

    // **THE WORST THING THIS CARD COULD DO, REFUSED HERE.** A repeat now names
    // its own coach, so a request can hand this route any uuid on earth — and
    // the column's FK points at `users`, which would take another gym's trainer
    // without a murmur and print their name on this gym's timetable. Asked
    // INSIDE the transaction, under the gym's lock, so it cannot be answered
    // against a roster that changes between the check and the insert.
    if (!(await coachIsStaff(tx, input.gymId, input.coachUserId))) {
      return { kind: "coach_not_staff" };
    }

    // THE LIMITS (`slotLimitVerdict`): twelve running at once while this one
    // runs, and twenty-four listed. A time slot whose last day has passed counts
    // toward neither.
    const { today, slots } = await listedSlots(tx, input);
    const peak = peakRunning(slots, {
      from: input.startsOn > today ? input.startsOn : today,
      until: input.endsOn,
    });
    switch (slotLimitVerdict({ peak, addsRunning: 1, listed: slots.length, addsListed: 1 })) {
      case "running":
        return { kind: "too_many_slots", cap: CLASS_SCHEDULES_PER_TYPE_MAX };
      case "listed":
        return {
          kind: "too_many_listed",
          cap: CLASS_SCHEDULES_LISTED_PER_TYPE_MAX,
          would: slots.length + 1,
        };
      case "ok":
        break;
    }

    // THE SAME CLASS CANNOT RUN TWICE AT THE SAME MINUTE ON THE SAME DAY —
    // round one, Low-4. Two presses of Save, or two staff, made two repeats and
    // the calendar then held the class twice at 18:30, which 17c would offer as
    // two bookable places in one room. The unique index cannot see it: it is
    // keyed on `schedule_id`, and these are two different repeats.
    //
    // **THE TEST IS AN OVERLAP, NOT AN EQUALITY.** Identical rows are the case
    // that was driven, but "Mon 18:30 from January" and "Mon 18:30 from March,
    // no end" are the same defect with different dates. Weekdays overlap
    // (`&&`), the minute is equal, and the windows overlap — with
    // `'infinity'::date` standing in for an open end, the same way the fill
    // bounds one. 17b-ii's "this day and later" ENDS the old repeat before
    // beginning the new one, so it does not meet this.
    //
    // Asked under the gym's lock beside the cap, which is the one place where
    // two staff pressing Save at the same instant cannot both pass.
    const [clash] = await tx<{ id: string }[]>`
      SELECT id FROM gym_class_schedules
      WHERE class_type_id = ${input.classTypeId}
        AND gym_id = ${input.gymId}
        AND ended_at IS NULL
        AND local_start_minute = ${input.startMinute}
        AND weekdays && ${tx.array([...input.weekdays])}::int[]
        AND starts_on <= coalesce(${input.endsOn}::date, 'infinity'::date)
        AND coalesce(ends_on, 'infinity'::date) >= ${input.startsOn}::date
      LIMIT 1`;
    if (clash !== undefined) return { kind: "clashes" };

    const [created] = await tx<{ id: string }[]>`
      INSERT INTO gym_class_schedules
        (gym_id, class_type_id, weekdays, local_start_minute, starts_on, ends_on,
         minutes, places, coach_user_id)
      -- ::int[] IS NOT DECORATION. postgres.js sends a JS array as text[], and
      -- Postgres refuses it against an integer[] column outright - measured, not
      -- assumed: without this cast every save answers
      -- "column weekdays is of type integer[] but expression is of type text[]".
      --
      -- THE THREE NUMBERS COME FROM THE REQUEST AND NEVER FROM the class type
      -- row above: the console fills the form in from the class type and then
      -- states all three outright, so there is ONE place the default is
      -- decided. A server that reached for t.minutes when a key was missing
      -- would be a second.
      VALUES (${input.gymId}, ${input.classTypeId}, ${tx.array([...input.weekdays])}::int[],
              ${input.startMinute}, ${input.startsOn}::date, ${input.endsOn}::date,
              ${input.minutes}, ${input.places}, ${input.coachUserId})
      RETURNING id`;
    if (created === undefined) throw new Error("class schedule insert returned no row");

    // SCOPED TO THIS ONE REPEAT, not to the gym: the gym's row lock is held for
    // the length of this transaction, and filling by gym makes one new repeat
    // re-walk every repeat the gym already has. `gymIds` rides along anyway so
    // the statement can never reach another gym's rows even if the id were
    // wrong — the pair in the WHERE, as everywhere else in this file.
    const filled = await fillClassSessions(tx, {
      gymIds: [input.gymId],
      scheduleIds: [created.id],
      now: input.now,
    });

    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.class_schedule_created",
      targetType: "gym_class_schedule",
      targetId: created.id,
      meta: {
        classType: type.name,
        weekdays: input.weekdays.map((d) => String(d)),
        startMinute: String(input.startMinute),
        minutes: String(input.minutes),
        places: input.places === null ? "none" : String(input.places),
        sessions: String(filled.sessions),
      },
    });
    return { kind: "ok" };
  });
}

export type SlotChangeOutcome =
  | { kind: "ok"; localDate: string }
  | { kind: "not_found" }
  | { kind: "coach_not_staff" }
  | { kind: "clashes" }
  | { kind: "from_outside"; verdict: Exclude<FromVerdict, "ok"> }
  | { kind: "time_passed" }
  /** A move would replace this many classes changed or cancelled on their own,
   *  and the request did not confirm that number. */
  | { kind: "replaces"; count: number }
  /** The class opened on the Calendar has started. */
  | { kind: "started" }
  /** The class opened on the Calendar is cancelled: un-cancel it first. */
  | { kind: "cancelled" }
  /** The opened class would go back to a time the same class already runs on
   *  its date (round one, H-1). */
  | { kind: "day_clashes" }
  /** The class would run more time slots at once than it may. */
  | { kind: "too_many"; cap: number }
  /** The class would list more time slots than it may; `would` is how many. */
  | { kind: "too_many_listed"; cap: number; would: number };

/** Where the change is made from: a time slot and a date (the Classes list), or
 *  one class on the Calendar ("This and future classes") — its time slot, its
 *  date and its days. */
export type SlotChangeTarget =
  | { by: "slot"; scheduleId: string; updateFrom: string; weekdays: readonly number[] }
  | { by: "session"; sessionId: string };

/** A time slot's classes from `today` on, with what `slotDateFate` needs. */
async function comingClasses(
  tx: TransactionSql,
  w: { gymId: string; scheduleId: string; today: string; now: Date },
) {
  return await tx<
    { id: string; local_date: string; status: string; changed_alone: boolean; started: boolean }[]
  >`
    SELECT id, local_date::text AS local_date, status, changed_alone,
           starts_at <= ${w.now} AS started
    FROM gym_class_sessions
    WHERE schedule_id = ${w.scheduleId} AND gym_id = ${w.gymId}
      AND local_date >= ${w.today}::date`;
}

/** A time slot's second half: it starts on `from` and keeps the old end. */
async function insertSlotFrom(
  tx: TransactionSql,
  w: ClassScheduleFields & {
    gymId: string;
    classTypeId: string;
    weekdays: readonly number[];
    startMinute: number;
    from: string;
    endsOn: string | null;
  },
): Promise<string> {
  const [created] = await tx<{ id: string }[]>`
    INSERT INTO gym_class_schedules
      (gym_id, class_type_id, weekdays, local_start_minute, starts_on, ends_on,
       minutes, places, coach_user_id)
    VALUES (${w.gymId}, ${w.classTypeId}, ${tx.array([...w.weekdays])}::int[],
            ${w.startMinute}, ${w.from}::date, ${w.endsOn}::date,
            ${w.minutes}, ${w.places}, ${w.coachUserId})
    RETURNING id`;
  if (created === undefined) throw new Error("class schedule insert returned no row");
  return created.id;
}

/** The classes in `ids` take a time slot's start, length, size and coach, and
 *  are no longer marked changed on their own. Their status is left alone. */
async function restampClasses(
  tx: TransactionSql,
  w: ClassScheduleFields & {
    gymId: string;
    scheduleId: string;
    startMinute: number;
    ids: readonly string[];
  },
): Promise<number> {
  if (w.ids.length === 0) return 0;
  const done = await tx`
    UPDATE gym_class_sessions x
    SET local_start_minute = ${w.startMinute},
        starts_at = ((x.local_date + make_interval(mins => ${w.startMinute}::int))
                     AT TIME ZONE g.timezone),
        minutes = ${w.minutes}, places = ${w.places},
        coach_user_id = ${w.coachUserId}, changed_alone = false
    FROM gyms g
    WHERE g.id = x.gym_id
      AND x.gym_id = ${w.gymId}
      AND x.schedule_id = ${w.scheduleId}
      AND x.id = ANY(${tx.array([...w.ids])}::uuid[])`;
  return done.count;
}

/** A NEW LENGTH, SIZE OR COACH FROM A DATE, for one time slot, once every check
 *  has passed. When the time slot still runs before the date it is split: it
 *  ends the day before, a new one starts on the date, and its classes from the
 *  date move to the new one with their ids. Otherwise it is changed where it
 *  stands. Then the classes in `restamp` take the values. Shared by a time
 *  slot's own Edit and the bulk edit. */
async function writeFieldsFrom(
  tx: TransactionSql,
  w: ClassScheduleFields & {
    gymId: string;
    scheduleId: string;
    classTypeId: string;
    weekdays: readonly number[];
    startMinute: number;
    from: string;
    endsOn: string | null;
    runsBefore: boolean;
    restamp: readonly string[];
  },
): Promise<{ onSchedule: string; restamped: number }> {
  let onSchedule = w.scheduleId;
  if (w.runsBefore) {
    await tx`
      UPDATE gym_class_schedules SET ends_on = ${w.from}::date - 1
      WHERE id = ${w.scheduleId} AND gym_id = ${w.gymId}`;
    onSchedule = await insertSlotFrom(tx, w);
    // Every class from the date moves to the new time slot as it is, so the
    // unique (time slot, date) keeps the new one's fill from writing a second.
    await tx`
      UPDATE gym_class_sessions SET schedule_id = ${onSchedule}
      WHERE gym_id = ${w.gymId} AND schedule_id = ${w.scheduleId}
        AND local_date >= ${w.from}::date`;
  } else {
    await tx`
      UPDATE gym_class_schedules
      SET minutes = ${w.minutes}, places = ${w.places}, coach_user_id = ${w.coachUserId}
      WHERE id = ${w.scheduleId} AND gym_id = ${w.gymId}`;
  }
  const restamped = await restampClasses(tx, { ...w, scheduleId: onSchedule, ids: w.restamp });
  return { onSchedule, restamped };
}

/** CHANGE A TIME SLOT FROM A DATE — §13.3's "this day and later" (17b-ii-b-ii).
 *
 *  Under the gym's row lock, like every write here, so it cannot interleave
 *  with the nightly fill or another change to the same time slot. Every check
 *  comes before the first write, so a refusal writes nothing.
 *
 *  What happens to each coming class is `slotDateFate`'s (`slotRule.ts`); this
 *  reads the facts and writes by the ids it answers.
 *
 *  **A MOVE** (new days or start time): the time slot ends the day before the
 *  date — or stops outright when it has no class left to run before it — and a
 *  new one starts on the date with the same end, writing its own classes.
 *
 *  **A CHANGE OF LENGTH, SIZE OR COACH**: when the time slot still runs before
 *  the date, it is split the same way and its classes from the date move to the
 *  new one with their ids, status and own changes, so the list shows the old
 *  values until the day before and the new ones from the date. Otherwise it is
 *  changed where it stands. A class changed on its own keeps its values either
 *  way.
 *
 *  **WHEN 17c LANDS** a replaced class may have people booked on it, and they
 *  have to be told (§13.3); today nothing can be booked. */
export async function changeSlotFrom(
  sql: Sql,
  input: ClassScheduleFields & {
    gymId: string;
    target: SlotChangeTarget;
    startMinute: number;
    confirmReplace: number | null;
    actorUserId: string;
    now: Date;
  },
): Promise<SlotChangeOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId);

    // THE DATE AND THE TIME SLOT. The pair is the key at every step: an id from
    // another gym is a 404 here, never a write.
    let scheduleId: string;
    let from: string;
    let openedId: string | null = null;
    let openedMinute: number | null = null;
    if (input.target.by === "session") {
      const [opened] = await tx<
        {
          schedule_id: string | null;
          local_date: string;
          local_start_minute: number;
          status: string;
          started: boolean;
        }[]
      >`
        SELECT schedule_id, local_date::text AS local_date, local_start_minute, status,
               starts_at <= ${input.now} AS started
        FROM gym_class_sessions
        WHERE id = ${input.target.sessionId} AND gym_id = ${input.gymId}`;
      if (opened === undefined || opened.schedule_id === null) return { kind: "not_found" };
      if (opened.started) return { kind: "started" };
      if (opened.status === "cancelled") return { kind: "cancelled" };
      scheduleId = opened.schedule_id;
      from = opened.local_date;
      openedId = input.target.sessionId;
      openedMinute = opened.local_start_minute;
    } else {
      scheduleId = input.target.scheduleId;
      from = input.target.updateFrom;
    }

    const [slot] = await tx<
      {
        class_type_id: string;
        weekdays: number[];
        local_start_minute: number;
        starts_on: string;
        ends_on: string | null;
        minutes: number;
        places: number | null;
        coach_user_id: string | null;
        today: string;
        last_calendar_date: string;
        from_weekday: number;
        new_start_passed: boolean;
      }[]
    >`
      SELECT s.class_type_id, s.weekdays, s.local_start_minute,
             s.starts_on::text AS starts_on, s.ends_on::text AS ends_on,
             s.minutes, s.places, s.coach_user_id,
             t.today::text AS today,
             (t.today + ${CLASS_FILL_HORIZON_DAYS}::int)::text AS last_calendar_date,
             EXTRACT(ISODOW FROM ${from}::date)::int AS from_weekday,
             ((${from}::date + make_interval(mins => ${input.startMinute}::int))
               AT TIME ZONE g.timezone) <= ${input.now} AS new_start_passed
      FROM gym_class_schedules s
      JOIN gyms g ON g.id = s.gym_id
      JOIN gym_class_types c ON c.id = s.class_type_id AND c.gym_id = s.gym_id
      CROSS JOIN LATERAL (
        SELECT (${input.now}::timestamptz AT TIME ZONE g.timezone)::date AS today
      ) t
      WHERE s.id = ${scheduleId} AND s.gym_id = ${input.gymId}
        AND s.ended_at IS NULL AND c.archived_at IS NULL`;
    if (slot === undefined) return { kind: "not_found" };

    const verdict = fromVerdict(from, {
      today: slot.today,
      startsOn: slot.starts_on,
      endsOn: slot.ends_on,
      lastCalendarDate: slot.last_calendar_date,
    });
    if (verdict !== "ok") return { kind: "from_outside", verdict };

    const weekdays = input.target.by === "slot" ? [...input.target.weekdays] : slot.weekdays;
    const change = slotChangeKind(
      { weekdays: slot.weekdays, startMinute: slot.local_start_minute },
      { weekdays, startMinute: input.startMinute },
    );
    const fieldsSame =
      input.minutes === slot.minutes &&
      input.places === slot.places &&
      input.coachUserId === slot.coach_user_id;
    // Nothing to do: the Classes list saved what it already had.
    if (change === "fields" && fieldsSame && openedId === null) {
      return { kind: "ok", localDate: from };
    }

    if (!(await coachIsStaff(tx, input.gymId, input.coachUserId))) {
      return { kind: "coach_not_staff" };
    }

    // A class that would run at the new time on the date itself, when that time
    // has gone: the opened class always runs on it, a moved time slot only on
    // one of its days.
    const runsOnFrom = openedId !== null || (change === "move" && weekdays.includes(slot.from_weekday));
    if (runsOnFrom && slot.new_start_passed) return { kind: "time_passed" };

    if (change === "move") {
      // The new time slot must not overlap another of this class at the same
      // start on a shared day — `createSchedule`'s rule, with this one left out
      // because it ends before the date.
      const [clash] = await tx<{ id: string }[]>`
        SELECT id FROM gym_class_schedules
        WHERE class_type_id = ${slot.class_type_id}
          AND gym_id = ${input.gymId}
          AND ended_at IS NULL
          AND id <> ${scheduleId}
          AND local_start_minute = ${input.startMinute}
          AND weekdays && ${tx.array(weekdays)}::int[]
          AND starts_on <= coalesce(${slot.ends_on}::date, 'infinity'::date)
          AND coalesce(ends_on, 'infinity'::date) >= ${from}::date
        LIMIT 1`;
      if (clash !== undefined) return { kind: "clashes" };
    } else {
      // ONE CLASS, ONE TIME, ONE DATE (round one, H-1). An opened class changed on
      // its own to another time goes back to the time slot's; "This class only"
      // refuses a time the class already runs that day, and so does this.
      if (openedId !== null && openedMinute !== input.startMinute) {
        const [taken] = await tx<{ id: string }[]>`
          SELECT id FROM gym_class_sessions
          WHERE gym_id = ${input.gymId}
            AND class_type_id = ${slot.class_type_id}
            AND local_date = ${from}::date
            AND local_start_minute = ${input.startMinute}
            AND status = 'scheduled'
            AND id <> ${openedId}
          LIMIT 1`;
        if (taken !== undefined) return { kind: "day_clashes" };
      }
      // Every class before the date must be written before the time slot's own
      // values change, or a later fill would write one of them with the new
      // values. The date is inside the window (`beyond_calendar`), so this
      // writes all of them; it is what the nightly job would write anyway.
      await fillClassSessions(tx, { gymIds: [input.gymId], scheduleIds: [scheduleId], now: input.now });
    }

    const coming = await comingClasses(tx, {
      gymId: input.gymId,
      scheduleId,
      today: slot.today,
      now: input.now,
    });

    const restamp: string[] = [];
    const replace: string[] = [];
    let asked = 0;
    let runsBefore = false;
    for (const row of coming) {
      const beforeFrom = row.local_date < from;
      if (beforeFrom && !row.started) runsBefore = true;
      const fate = slotDateFate(change, {
        beforeFrom,
        started: row.started,
        status: row.status === "cancelled" ? "cancelled" : "scheduled",
        changedAlone: row.changed_alone,
        opened: row.id === openedId,
      });
      switch (fate) {
        case "keep":
          break;
        case "restamp":
          restamp.push(row.id);
          break;
        case "replace":
          replace.push(row.id);
          break;
        case "replace_asked":
          replace.push(row.id);
          asked += 1;
          break;
        default: {
          const never: never = fate;
          throw new Error(`unhandled slot date fate: ${String(never)}`);
        }
      }
    }
    if (asked > 0 && input.confirmReplace !== asked) return { kind: "replaces", count: asked };

    // THE CLASS'S LIMITS, as `createSchedule` counts them (round one, L-1). The
    // new time slot starts on the date and the old one ends before it; the old
    // one is still listed while it runs before the date, and a move that leaves
    // nothing before it stops it outright.
    const addsSlot = change === "move" || (!fieldsSame && runsBefore);
    if (addsSlot) {
      const { slots } = await listedSlots(tx, {
        gymId: input.gymId,
        classTypeId: slot.class_type_id,
        now: input.now,
      });
      const peak = peakRunning(
        slots.filter((l) => l.id !== scheduleId),
        { from, until: slot.ends_on },
      );
      switch (
        slotLimitVerdict({ peak, addsRunning: 1, listed: slots.length, addsListed: runsBefore ? 1 : 0 })
      ) {
        case "running":
          return { kind: "too_many", cap: CLASS_SCHEDULES_PER_TYPE_MAX };
        case "listed":
          return {
            kind: "too_many_listed",
            cap: CLASS_SCHEDULES_LISTED_PER_TYPE_MAX,
            would: slots.length + (runsBefore ? 1 : 0),
          };
        case "ok":
          break;
      }
    }
    if (change === "fields" && fieldsSame) {
      // The time slot keeps its values; only an opened class changed on its own
      // differs from it, and goes back to it.
      const opened = coming.find((row) => row.id === openedId);
      if (opened === undefined || !opened.changed_alone) return { kind: "ok", localDate: from };
      restamp.splice(0, restamp.length, opened.id);
    }

    // ── Writes from here on ──

    const places = (p: number | null) => (p === null ? "none" : String(p));
    const meta: Record<string, string> = {
      from,
      minutes: `${String(slot.minutes)} -> ${String(input.minutes)}`,
      places: `${places(slot.places)} -> ${places(input.places)}`,
      // Ids, never a coach's name.
      coach: `${slot.coach_user_id ?? "none"} -> ${input.coachUserId ?? "none"}`,
    };

    // The old time slot: stopped outright when it has no class left to run
    // before the date (the list then leaves it out, as it does a cancelled time
    // slot, and its past classes stay), else ended the day before the date.
    const endOld = async () => {
      if (runsBefore) {
        await tx`
          UPDATE gym_class_schedules SET ends_on = ${from}::date - 1
          WHERE id = ${scheduleId} AND gym_id = ${input.gymId}`;
      } else {
        await tx`
          UPDATE gym_class_schedules SET ended_at = ${input.now}
          WHERE id = ${scheduleId} AND gym_id = ${input.gymId}`;
      }
    };
    if (change === "move") {
      const removed =
        replace.length === 0
          ? 0
          : (
              await tx`
                DELETE FROM gym_class_sessions
                WHERE gym_id = ${input.gymId} AND schedule_id = ${scheduleId}
                  AND id = ANY(${tx.array(replace)}::uuid[])`
            ).count;
      await endOld();
      const newId = await insertSlotFrom(tx, {
        gymId: input.gymId,
        classTypeId: slot.class_type_id,
        weekdays,
        startMinute: input.startMinute,
        from,
        endsOn: slot.ends_on,
        minutes: input.minutes,
        places: input.places,
        coachUserId: input.coachUserId,
      });
      const filled = await fillClassSessions(tx, {
        gymIds: [input.gymId],
        scheduleIds: [newId],
        now: input.now,
      });
      await insertAudit(tx, {
        actorUserId: input.actorUserId,
        gymId: input.gymId,
        action: "org.class_schedule_moved",
        targetType: "gym_class_schedule",
        targetId: scheduleId,
        meta: {
          ...meta,
          newSchedule: newId,
          weekdays: `${slot.weekdays.join(",")} -> ${weekdays.join(",")}`,
          startMinute: `${String(slot.local_start_minute)} -> ${String(input.startMinute)}`,
          sessionsReplaced: String(removed),
          changedAloneReplaced: String(asked),
          sessionsWritten: String(filled.sessions),
        },
      });
      return { kind: "ok", localDate: from };
    }

    if (fieldsSame) {
      const restamped = await restampClasses(tx, {
        gymId: input.gymId,
        scheduleId,
        startMinute: input.startMinute,
        minutes: input.minutes,
        places: input.places,
        coachUserId: input.coachUserId,
        ids: restamp,
      });
      await insertAudit(tx, {
        actorUserId: input.actorUserId,
        gymId: input.gymId,
        action: "org.class_session_changed",
        targetType: "gym_class_session",
        targetId: openedId ?? scheduleId,
        meta: { ...meta, sessionsRestamped: String(restamped) },
      });
      return { kind: "ok", localDate: from };
    }

    const { onSchedule, restamped } = await writeFieldsFrom(tx, {
      gymId: input.gymId,
      scheduleId,
      classTypeId: slot.class_type_id,
      weekdays,
      startMinute: input.startMinute,
      from,
      endsOn: slot.ends_on,
      runsBefore,
      restamp,
      minutes: input.minutes,
      places: input.places,
      coachUserId: input.coachUserId,
    });
    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.class_schedule_updated",
      targetType: "gym_class_schedule",
      targetId: scheduleId,
      meta: {
        ...meta,
        ...(onSchedule === scheduleId ? {} : { newSchedule: onSchedule }),
        sessionsRestamped: String(restamped),
      },
    });
    return { kind: "ok", localDate: from };
  });
}

export type BulkEditOutcome = Extract<
  SlotChangeOutcome,
  { kind: "ok" | "not_found" | "coach_not_staff" | "from_outside" | "too_many_listed" }
>;

/** What a bulk edit sets; a key left out keeps each time slot's own value. */
export interface BulkEditSet {
  minutes?: number | undefined;
  places?: number | null | undefined;
  coachUserId?: string | null | undefined;
}

/** BULK EDIT — several time slots of ONE class, a new length, size or coach
 *  from one date (TeamUp's Bulk Edit; ROADMAP 17b-ii-b-ii-b).
 *
 *  Each time slot is changed exactly as its own Edit changes it
 *  (`writeFieldsFrom`), from `updateFrom` or from its own first day when that is
 *  later: classes before that date, and any that has started, keep what they
 *  have, and so does a class changed on its own; a cancelled class stays
 *  cancelled.
 *
 *  All or nothing, under the gym's lock: every id must be a running time slot
 *  of this class in this gym, and every one must run on its date, or nothing is
 *  written. Each time slot is followed by exactly one, so no more run from the
 *  date than before; only the listed limit is asked. */
export async function bulkChangeSlots(
  sql: Sql,
  input: {
    gymId: string;
    classTypeId: string;
    scheduleIds: readonly string[];
    updateFrom: string;
    set: BulkEditSet;
    actorUserId: string;
    now: Date;
  },
): Promise<BulkEditOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId);

    const [type] = await tx<{ id: string }[]>`
      SELECT id FROM gym_class_types
      WHERE id = ${input.classTypeId} AND gym_id = ${input.gymId} AND archived_at IS NULL`;
    if (type === undefined) return { kind: "not_found" };

    // The class AND the gym in the WHERE: an id of another class, or of another
    // gym's, is simply not found, and one missing id refuses the whole request.
    const slots = await tx<
      {
        id: string;
        weekdays: number[];
        local_start_minute: number;
        starts_on: string;
        ends_on: string | null;
        minutes: number;
        places: number | null;
        coach_user_id: string | null;
        today: string;
        last_calendar_date: string;
      }[]
    >`
      SELECT s.id, s.weekdays, s.local_start_minute,
             s.starts_on::text AS starts_on, s.ends_on::text AS ends_on,
             s.minutes, s.places, s.coach_user_id,
             t.today::text AS today,
             (t.today + ${CLASS_FILL_HORIZON_DAYS}::int)::text AS last_calendar_date
      FROM gym_class_schedules s
      JOIN gyms g ON g.id = s.gym_id
      CROSS JOIN LATERAL (
        SELECT (${input.now}::timestamptz AT TIME ZONE g.timezone)::date AS today
      ) t
      WHERE s.id = ANY(${tx.array([...input.scheduleIds])}::uuid[])
        AND s.gym_id = ${input.gymId}
        AND s.class_type_id = ${input.classTypeId}
        AND s.ended_at IS NULL
      ORDER BY s.starts_on, s.local_start_minute, s.id`;
    if (slots.length !== input.scheduleIds.length) return { kind: "not_found" };

    const { set } = input;
    if (set.coachUserId !== undefined && !(await coachIsStaff(tx, input.gymId, set.coachUserId))) {
      return { kind: "coach_not_staff" };
    }

    // Every check before the first write.
    const plans = [];
    for (const slot of slots) {
      const from = input.updateFrom > slot.starts_on ? input.updateFrom : slot.starts_on;
      const verdict =
        input.updateFrom < slot.today
          ? "past"
          : fromVerdict(from, {
              today: slot.today,
              startsOn: slot.starts_on,
              endsOn: slot.ends_on,
              lastCalendarDate: slot.last_calendar_date,
            });
      if (verdict !== "ok") return { kind: "from_outside", verdict };
      const values: ClassScheduleFields = {
        minutes: set.minutes ?? slot.minutes,
        places: set.places === undefined ? slot.places : set.places,
        coachUserId: set.coachUserId === undefined ? slot.coach_user_id : set.coachUserId,
      };
      const same =
        values.minutes === slot.minutes &&
        values.places === slot.places &&
        values.coachUserId === slot.coach_user_id;
      if (!same) plans.push({ slot, from, values });
    }

    // Every class before its date is written with the old values first, as a
    // single Edit does, so a later fill cannot write one with the new. This is
    // what the nightly job would write anyway, so a refusal below leaves only
    // that behind.
    const work = [];
    for (const plan of plans) {
      await fillClassSessions(tx, {
        gymIds: [input.gymId],
        scheduleIds: [plan.slot.id],
        now: input.now,
      });
      const coming = await comingClasses(tx, {
        gymId: input.gymId,
        scheduleId: plan.slot.id,
        today: plan.slot.today,
        now: input.now,
      });
      const restamp: string[] = [];
      let runsBefore = false;
      for (const row of coming) {
        const beforeFrom = row.local_date < plan.from;
        if (beforeFrom && !row.started) runsBefore = true;
        const fate = slotDateFate("fields", {
          beforeFrom,
          started: row.started,
          status: row.status === "cancelled" ? "cancelled" : "scheduled",
          changedAlone: row.changed_alone,
          opened: false,
        });
        if (fate === "restamp") restamp.push(row.id);
      }
      work.push({ ...plan, restamp, runsBefore });
    }

    // Each split lists one more time slot until its date.
    const splits = work.filter((w) => w.runsBefore).length;
    if (splits > 0) {
      const { slots: listed } = await listedSlots(tx, input);
      if (slotLimitVerdict({ peak: 0, addsRunning: 0, listed: listed.length, addsListed: splits }) !== "ok") {
        return {
          kind: "too_many_listed",
          cap: CLASS_SCHEDULES_LISTED_PER_TYPE_MAX,
          would: listed.length + splits,
        };
      }
    }

    // ── Writes from here on ──

    const places = (p: number | null) => (p === null ? "none" : String(p));
    for (const { slot, from, values, restamp, runsBefore } of work) {
      const { onSchedule, restamped } = await writeFieldsFrom(tx, {
        gymId: input.gymId,
        scheduleId: slot.id,
        classTypeId: input.classTypeId,
        weekdays: slot.weekdays,
        startMinute: slot.local_start_minute,
        from,
        endsOn: slot.ends_on,
        runsBefore,
        restamp,
        ...values,
      });
      await insertAudit(tx, {
        actorUserId: input.actorUserId,
        gymId: input.gymId,
        action: "org.class_schedule_updated",
        targetType: "gym_class_schedule",
        targetId: slot.id,
        meta: {
          bulk: "true",
          from,
          minutes: `${String(slot.minutes)} -> ${String(values.minutes)}`,
          places: `${places(slot.places)} -> ${places(values.places)}`,
          // Ids, never a coach's name.
          coach: `${slot.coach_user_id ?? "none"} -> ${values.coachUserId ?? "none"}`,
          ...(onSchedule === slot.id ? {} : { newSchedule: onSchedule }),
          sessionsRestamped: String(restamped),
        },
      });
    }
    return { kind: "ok", localDate: input.updateFrom };
  });
}

/** STOP A REPEAT. `ended_at` is what the fill reads, so the dates never come
 *  back; the future ones already written go with it, for archive's reason.
 *
 *  **`ends_on` IS DELIBERATELY LEFT AS THE GYM TYPED IT.** It is what was asked
 *  for; `ended_at` is what happened. Overwriting the first with the second would
 *  destroy the only record that the two ever differed. */
export async function endSchedule(
  sql: Sql,
  input: { gymId: string; scheduleId: string; actorUserId: string; now: Date },
): Promise<ClassWriteOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId);
    const [before] = await tx<{ id: string }[]>`
      SELECT id FROM gym_class_schedules
      WHERE id = ${input.scheduleId} AND gym_id = ${input.gymId} AND ended_at IS NULL`;
    if (before === undefined) return { kind: "not_found" };

    await tx`
      UPDATE gym_class_schedules SET ended_at = ${input.now}
      WHERE id = ${input.scheduleId} AND gym_id = ${input.gymId}`;
    const removed = await tx`
      DELETE FROM gym_class_sessions
      WHERE schedule_id = ${input.scheduleId}
        AND gym_id = ${input.gymId}
        AND starts_at > ${input.now}`;

    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.class_schedule_ended",
      targetType: "gym_class_schedule",
      targetId: input.scheduleId,
      meta: { sessionsRemoved: String(removed.count) },
    });
    return { kind: "ok" };
  });
}

// ── ONE WEEK, AND ONE DATE AT A TIME (17b-ii-b-i) ────────────────────────────

export interface ClassSessionRow {
  id: string;
  classTypeId: string;
  scheduleId: string | null;
  name: string;
  colour: string;
  openGym: boolean;
  localDate: string;
  startMinute: number;
  startsAt: Date;
  minutes: number;
  places: number | null;
  coachUserId: string | null;
  coachName: string | null;
  status: string;
  changedAlone: boolean;
  started: boolean;
}

export interface ClassWeekRow {
  timezone: string;
  clockFormat: string;
  today: string;
  weekStart: string;
  lastWeekStart: string;
  sessions: ClassSessionRow[];
}

/** The week holding `week` (the gym's today when null), Monday to Sunday in the
 *  gym's own calendar.
 *
 *  `lastWeekStart` is the last Monday whose Sunday is inside the written window.
 *  The window's far edge is today + 55, not + 56: the nightly fill runs at 05:00
 *  UTC, so for part of each day the 56th date is not written yet.
 *
 *  The `starts_at` bounds are only there so the gym's index can find the week;
 *  `local_date` decides. Two days of slack each side covers any offset, and a
 *  date written before a gym changed its time zone. */
export async function readWeek(
  sql: Sql,
  gymId: string,
  opts: { week: string | null; now: Date },
): Promise<ClassWeekRow | null> {
  const [gym] = await sql<
    {
      timezone: string;
      clock_format: string;
      today: string;
      week_start: string;
      last_week_start: string;
    }[]
  >`
    SELECT g.timezone, g.clock_format, w.today::text AS today,
           (w.wanted - (EXTRACT(ISODOW FROM w.wanted)::int - 1))::text AS week_start,
           (w.edge + 1 - (EXTRACT(ISODOW FROM w.edge + 1)::int - 1) - 7)::text AS last_week_start
    FROM gyms g
    CROSS JOIN LATERAL (
      SELECT (${opts.now}::timestamptz AT TIME ZONE g.timezone)::date AS today
    ) t
    CROSS JOIN LATERAL (
      SELECT t.today,
             coalesce(${opts.week}::date, t.today) AS wanted,
             t.today + ${CLASS_FILL_HORIZON_DAYS - 1}::int AS edge
    ) w
    WHERE g.id = ${gymId}`;
  if (gym === undefined) return null;

  const rows = await sql<
    {
      id: string;
      class_type_id: string;
      schedule_id: string | null;
      name: string;
      colour: string;
      open_gym: boolean;
      local_date: string;
      local_start_minute: number;
      starts_at: Date;
      minutes: number;
      places: number | null;
      coach_user_id: string | null;
      coach_name: string | null;
      status: string;
      changed_alone: boolean;
      started: boolean;
    }[]
  >`
    SELECT x.id, x.class_type_id, x.schedule_id, t.name, t.colour, t.open_gym,
           x.local_date::text AS local_date, x.local_start_minute, x.starts_at,
           x.minutes, x.places, x.coach_user_id,
           -- Named only while still this gym's active staff, as on the timetable.
           cu.display_name AS coach_name,
           x.status, x.changed_alone,
           x.starts_at <= ${opts.now} AS started
    FROM gym_class_sessions x
    JOIN gym_class_types t ON t.id = x.class_type_id AND t.gym_id = x.gym_id
    LEFT JOIN gym_staff cs ON cs.gym_id = x.gym_id AND cs.user_id = x.coach_user_id
    LEFT JOIN users cu ON cu.id = cs.user_id AND cu.status = 'active'
    WHERE x.gym_id = ${gymId}
      AND x.starts_at >= (${gym.week_start}::date::timestamp AT TIME ZONE ${gym.timezone})
                         - interval '2 days'
      AND x.starts_at < ((${gym.week_start}::date + 7)::timestamp AT TIME ZONE ${gym.timezone})
                        + interval '2 days'
      AND x.local_date BETWEEN ${gym.week_start}::date AND ${gym.week_start}::date + 6
    ORDER BY x.local_date, x.local_start_minute, lower(t.name), x.id`;

  return {
    timezone: gym.timezone,
    clockFormat: gym.clock_format,
    today: gym.today,
    weekStart: gym.week_start,
    lastWeekStart: gym.last_week_start,
    sessions: rows.map((r) => ({
      id: r.id,
      classTypeId: r.class_type_id,
      scheduleId: r.schedule_id,
      name: r.name,
      colour: r.colour,
      openGym: r.open_gym,
      localDate: r.local_date,
      startMinute: r.local_start_minute,
      startsAt: r.starts_at,
      minutes: r.minutes,
      places: r.places,
      coachUserId: r.coach_user_id,
      coachName: r.coach_name,
      status: r.status,
      changedAlone: r.changed_alone,
      started: r.started,
    })),
  };
}

export type ClassDayOutcome =
  | { kind: "ok"; localDate: string }
  | { kind: "not_found" }
  | { kind: "coach_not_staff" }
  | { kind: "started" }
  | { kind: "cancelled" }
  | { kind: "time_passed" }
  | { kind: "time_missing" }
  | { kind: "clashes" };

/** A change to one date: `change` carries the new values, the other two none. */
export type ClassDayInput =
  | ({ action: "change"; startMinute: number } & ClassScheduleFields)
  | { action: "cancel" }
  | { action: "restore" };

/** CHANGE, CANCEL OR PUT BACK ONE DATE — under the gym's row lock, like every
 *  other write here, so it cannot interleave with the nightly fill or a repeat
 *  edit re-stamping the same rows.
 *
 *  **Only a CHANGE sets `changed_alone`.** A cancel is a status, and nothing
 *  that writes the calendar touches status: the fill never updates a row, and
 *  holds back from a slot the class has cancelled (`fill.ts`); a repeat edit
 *  re-stamps only length, places and coach. So a cancelled date stays cancelled
 *  while its repeat runs, and when it is put back it runs as the repeat now does.
 *  Stop and Remove clear every coming date, cancelled ones too: a new repeat is
 *  a new timetable, which is TeamUp's model (Kd, RULINGS 2026-09-23).
 *
 *  **One class, one time, one date.** A date moved to a time, or put back at a
 *  time, where the same class already runs that day is refused; `fill.ts`
 *  carries the same rule the other way round. */
export async function changeSession(
  sql: Sql,
  input: ClassDayInput & { gymId: string; sessionId: string; actorUserId: string; now: Date },
): Promise<ClassDayOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId);
    const newMinute = input.action === "change" ? input.startMinute : null;
    // The pair is the key: an id from another gym is a 404 here, not a write.
    const [row] = await tx<
      {
        class_type_id: string;
        local_date: string;
        local_start_minute: number;
        minutes: number;
        places: number | null;
        coach_user_id: string | null;
        status: string;
        started: boolean;
        new_starts_at: Date;
        new_start_passed: boolean;
        new_time_missing: boolean;
      }[]
    >`
      SELECT x.class_type_id, x.local_date::text AS local_date, x.local_start_minute,
             x.minutes, x.places, x.coach_user_id, x.status,
             x.starts_at <= ${input.now} AS started,
             n.at AS new_starts_at,
             n.at <= ${input.now} AS new_start_passed,
             -- The clock time read back from the instant: on the night the clocks
             -- go forward a skipped time comes back an hour later (round one, L-3).
             NOT ((n.at AT TIME ZONE g.timezone)::date = x.local_date
                  AND EXTRACT(HOUR FROM n.at AT TIME ZONE g.timezone)::int * 60
                      + EXTRACT(MINUTE FROM n.at AT TIME ZONE g.timezone)::int
                      = coalesce(${newMinute}::int, x.local_start_minute)) AS new_time_missing
      FROM gym_class_sessions x
      JOIN gyms g ON g.id = x.gym_id
      CROSS JOIN LATERAL (
        SELECT ((x.local_date + make_interval(
                  mins => coalesce(${newMinute}::int, x.local_start_minute)))
                AT TIME ZONE g.timezone) AS at
      ) n
      WHERE x.id = ${input.sessionId} AND x.gym_id = ${input.gymId}`;
    if (row === undefined) return { kind: "not_found" };

    const unchanged =
      input.action === "change" &&
      input.startMinute === row.local_start_minute &&
      input.minutes === row.minutes &&
      input.places === row.places &&
      input.coachUserId === row.coach_user_id;
    const verdict = dayVerdict(input.action, {
      status: row.status === "cancelled" ? "cancelled" : "scheduled",
      started: row.started,
      unchanged,
      newStartPassed: input.action === "change" && row.new_start_passed,
      newTimeMissing:
        input.action === "change" &&
        input.startMinute !== row.local_start_minute &&
        row.new_time_missing,
    });
    switch (verdict) {
      case "nothing":
        return { kind: "ok", localDate: row.local_date };
      case "started":
      case "cancelled":
      case "time_passed":
      case "time_missing":
        return { kind: verdict };
      case "write":
        break;
      default: {
        const never: never = verdict;
        throw new Error(`unhandled day verdict: ${String(never)}`);
      }
    }

    if (input.action === "change" && !(await coachIsStaff(tx, input.gymId, input.coachUserId))) {
      return { kind: "coach_not_staff" };
    }

    if (input.action !== "cancel") {
      const minute = newMinute ?? row.local_start_minute;
      const [clash] = await tx<{ id: string }[]>`
        SELECT id FROM gym_class_sessions
        WHERE gym_id = ${input.gymId}
          AND class_type_id = ${row.class_type_id}
          AND local_date = ${row.local_date}::date
          AND local_start_minute = ${minute}
          AND status = 'scheduled'
          AND id <> ${input.sessionId}
        LIMIT 1`;
      if (clash !== undefined) return { kind: "clashes" };
    }

    let meta: Record<string, string>;
    if (input.action === "change") {
      await tx`
        UPDATE gym_class_sessions
        SET local_start_minute = ${input.startMinute}, starts_at = ${row.new_starts_at},
            minutes = ${input.minutes}, places = ${input.places},
            coach_user_id = ${input.coachUserId}, changed_alone = true
        WHERE id = ${input.sessionId} AND gym_id = ${input.gymId}`;
      const places = (p: number | null) => (p === null ? "none" : String(p));
      // Ids, never a coach's name.
      meta = {
        date: row.local_date,
        startMinute: `${String(row.local_start_minute)} -> ${String(input.startMinute)}`,
        minutes: `${String(row.minutes)} -> ${String(input.minutes)}`,
        places: `${places(row.places)} -> ${places(input.places)}`,
        coach: `${row.coach_user_id ?? "none"} -> ${input.coachUserId ?? "none"}`,
      };
    } else {
      const status = input.action === "cancel" ? "cancelled" : "scheduled";
      await tx`
        UPDATE gym_class_sessions SET status = ${status}
        WHERE id = ${input.sessionId} AND gym_id = ${input.gymId}`;
      meta = { date: row.local_date };
    }

    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action:
        input.action === "change"
          ? "org.class_session_changed"
          : input.action === "cancel"
            ? "org.class_session_cancelled"
            : "org.class_session_restored",
      targetType: "gym_class_session",
      targetId: input.sessionId,
      meta,
    });
    return { kind: "ok", localDate: row.local_date };
  });
}
