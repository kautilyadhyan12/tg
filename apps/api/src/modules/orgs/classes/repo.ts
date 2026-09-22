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
// edit RE-STAMPS the future sessions the type still owns, which must not
// interleave with a fill writing new ones.
import type { Sql, TransactionSql } from "postgres";
import {
  CLASS_SCHEDULES_PER_TYPE_MAX,
  CLASS_SCHEDULE_PREVIEW_DATES,
  CLASS_TYPES_MAX,
} from "@app/shared";
import { insertAudit, lockOrgRow } from "../repo.js";
import { fillClassSessions } from "./fill.js";

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
  nextDates: string[];
  sessionsAhead: number;
}

export interface TimetableRow {
  timezone: string;
  clockFormat: string;
  types: ClassTypeRow[];
  schedules: ClassScheduleRow[];
}

/** The read the console's Classes screen is made of.
 *
 *  **TWO STATEMENTS AND NOT ONE, deliberately.** A single query joining types to
 *  repeats to sessions fans a type out once per repeat per preview date, and the
 *  shaping code would then have to un-fan it — which is where a count comes out
 *  multiplied. The two are independent reads over small per-gym sets, and the
 *  screen needs both whole.
 *
 *  **NEITHER IS PAGED, and the CAPS are what makes that honest**: a gym holds at
 *  most `CLASS_TYPES_MAX` live types and `CLASS_SCHEDULES_PER_TYPE_MAX` repeats
 *  on each. A gym's own timetable is a thing you look at whole; paging it would
 *  be answering a question nobody asked. The archived list is bounded by the
 *  same cap because archiving is the only way out of it. */
export async function readTimetable(
  sql: Sql,
  gymId: string,
  opts: { now?: Date } = {},
): Promise<TimetableRow | null> {
  const now = opts.now ?? new Date();

  const typeRows = await sql<
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
    -- Live first, then archived; inside each, the gym's own alphabet. lower()
    -- so "abs blast" and "Abs Blast" do not sit a screen apart, and id last so
    -- two classes with one name never swap places between two reads (:0034's
    -- lesson — an unstable ORDER BY is a list that reorders itself).
    ORDER BY (t.archived_at IS NOT NULL), lower(t.name), t.id
    LIMIT ${CLASS_TYPES_MAX * 2}`;

  // The gym's own row rides on the type rows, so a gym with no classes still
  // needs asking. One statement either way; this is the empty-list branch.
  const gymRow =
    typeRows[0] ??
    (
      await sql<{ timezone: string; clock_format: string }[]>`
        SELECT timezone, clock_format FROM gyms WHERE id = ${gymId}`
    )[0];
  if (gymRow === undefined) return null;

  const scheduleRows = await sql<
    {
      id: string;
      class_type_id: string;
      weekdays: number[];
      local_start_minute: number;
      starts_on: string;
      ends_on: string | null;
      next_dates: string[] | null;
      sessions_ahead: number;
    }[]
  >`
    SELECT s.id, s.class_type_id, s.weekdays, s.local_start_minute,
           s.starts_on::text AS starts_on, s.ends_on::text AS ends_on,
           n.next_dates, coalesce(n.sessions_ahead, 0) AS sessions_ahead
    FROM gym_class_schedules s
    JOIN gyms g ON g.id = s.gym_id
    -- WHAT THE GYM WILL ACTUALLY SEE, READ BACK FROM THE CALENDAR — never
    -- recomputed from the repeat for the screen. A second derivation is a second
    -- answer, and the one shown would be the one nothing books against: if the
    -- fill has not run, or a day was cancelled, THIS is what says so.
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS sessions_ahead,
             (array_agg(x.local_date::text ORDER BY x.local_date))
               [1:${CLASS_SCHEDULE_PREVIEW_DATES}] AS next_dates
      FROM gym_class_sessions x
      WHERE x.schedule_id = s.id
        AND x.local_date >= (${now}::timestamptz AT TIME ZONE g.timezone)::date
        AND x.status = 'scheduled'
    ) n ON TRUE
    WHERE s.gym_id = ${gymId}
      AND s.ended_at IS NULL
    ORDER BY s.local_start_minute, s.id
    LIMIT ${CLASS_TYPES_MAX * CLASS_SCHEDULES_PER_TYPE_MAX}`;

  return {
    timezone: gymRow.timezone,
    clockFormat: gymRow.clock_format,
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
      nextDates: r.next_dates ?? [],
      sessionsAhead: r.sessions_ahead,
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
  | { kind: "too_many"; cap: number };

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

    // THE CALENDAR FOLLOWS THE EDIT — and this statement is the reason the
    // sessions copy their numbers at all.
    //
    // **FUTURE ONLY.** A session that has already happened is history: changing
    // a class from 45 minutes to 60 must not rewrite last Tuesday.
    //
    // **AND NEVER A DAY THE GYM CHANGED ON PURPOSE** (`changed_alone`, 17b-ii).
    // Nothing sets that flag yet; the condition ships here because this is the
    // statement it exists to restrain, and a condition added later means this
    // one shipped able to undo a deliberate change.
    await tx`
      UPDATE gym_class_sessions
      SET minutes = ${input.minutes}, places = ${input.places},
          coach_user_id = ${input.coachUserId}
      WHERE class_type_id = ${input.classTypeId}
        AND gym_id = ${input.gymId}
        AND starts_at > ${input.now}
        AND changed_alone = false`;

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

export interface ClassScheduleInput {
  weekdays: readonly number[];
  startMinute: number;
  startsOn: string;
  endsOn: string | null;
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
  input: ClassScheduleInput & {
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

    const [live] = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM gym_class_schedules
      WHERE class_type_id = ${input.classTypeId}
        AND gym_id = ${input.gymId}
        AND ended_at IS NULL`;
    if ((live?.n ?? 0) >= CLASS_SCHEDULES_PER_TYPE_MAX) {
      return { kind: "too_many", cap: CLASS_SCHEDULES_PER_TYPE_MAX };
    }

    const [created] = await tx<{ id: string }[]>`
      INSERT INTO gym_class_schedules
        (gym_id, class_type_id, weekdays, local_start_minute, starts_on, ends_on)
      -- ::int[] IS NOT DECORATION. postgres.js sends a JS array as text[], and
      -- Postgres refuses it against an integer[] column outright - measured, not
      -- assumed: without this cast every save answers
      -- "column weekdays is of type integer[] but expression is of type text[]".
      VALUES (${input.gymId}, ${input.classTypeId}, ${tx.array([...input.weekdays])}::int[],
              ${input.startMinute}, ${input.startsOn}::date, ${input.endsOn}::date)
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
        sessions: String(filled.sessions),
      },
    });
    return { kind: "ok" };
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
