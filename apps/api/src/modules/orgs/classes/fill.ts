// THE CALENDAR GETS WRITTEN OUT — Part 3 §13.3, ROADMAP 17b-i.
//
// **WHAT IT DOES, IN ONE SENTENCE:** for every live repeat, it writes one row
// for each date that repeat runs on between the gym's own today and eight weeks
// after it, and writes nothing for a date that already has one.
//
// ── THE RULE THIS FILE IS ────────────────────────────────────────────────────
//
// A repeat is stored as the gym's CLOCK TIME (`local_start_minute`) plus its
// weekdays, and `gyms.timezone` is what turns each date into an instant. The
// whole rule is the one expression below:
//
//     (local_date + make_interval(mins => local_start_minute))
//        AT TIME ZONE gyms.timezone
//
// Postgres's own zone database answers it, per date, which is why a summer-time
// change never moves a six o'clock class. Measured on this Postgres (16.14)
// while this card was written, Europe/London, 18:00 local:
//
//     2026-03-29 → 2026-03-29 17:00+00   (BST)
//     2026-10-25 → 2026-10-25 18:00+00   (GMT)
//
// One hour apart in UTC, six o'clock in both. `classes.fill.test.ts` drives
// exactly those two dates, and the two awkward ones below with them.
//
// **THE TWO AWKWARD LOCAL TIMES, MEASURED RATHER THAN ASSUMED.** A local clock
// time can fail to exist (the hour the clocks jump forward) or happen twice (the
// hour they go back). Postgres answers both without raising, and these are the
// answers it gives, from the same session:
//
//     2026-03-29 01:30 Europe/London → 2026-03-29 01:30+00  (02:30 local — the
//                                      skipped half hour lands after the jump)
//     2026-10-25 01:30 Europe/London → 2026-10-25 01:30+00  (the SECOND 01:30)
//
// Neither is a crash and neither loses a class, which is what matters for a
// gym: the 1:30am class on the one day of the year it cannot exist runs at 2:30
// instead. Nothing here tries to be cleverer than that, because there is no
// cleverer answer — the gym's own clock did not have that minute.
//
// ── SAFE TO RUN TWICE IS NOT SAFE TO RUN BESIDE A CONSOLE WRITE ─────────────
//
// **ROUND ONE'S C/H-1, AND IT IS THE REASON `fillClassSessionsJob` BELOW IS A
// LOOP RATHER THAN ONE STATEMENT.** Every write in `classes/repo.ts` takes
// `lockOrgRow` first; this statement used to take nothing. Postgres reads it
// under one snapshot taken when the statement starts, so a Stop, a Remove or an
// Edit that commits DURING it is invisible to it — and the rows it then writes
// are invisible to that write's own DELETE or UPDATE. Driven by the reviewer on
// ten gyms:
//
//     Stop answered 200 ... its coming dates left on the calendar: 56
//     Remove answered 200 ... its coming dates left on the calendar: 560
//     Edit to 90 min / 4 places ... the calendar holds 560 rows of 45 min / 10
//
// All three screens told the gym the opposite of what the calendar held, for
// ever — nothing re-stamps those rows later, and 17c would book places against
// them. **The statement is still lock-free on purpose** (the save path calls it
// INSIDE `createSchedule`, which already holds the lock); what changed is that
// the JOB now takes the same lock, one gym at a time.
//
// ── SAFE TO RUN TWICE, AND THE DATABASE IS WHAT SAYS SO ──────────────────────
//
// One `INSERT … SELECT … ON CONFLICT DO NOTHING` against
// `gym_class_sessions_schedule_date_uq` (one row per repeat per local date). A
// retry, two workers, or a save landing at the same instant as the nightly job
// all leave the same calendar. There is no read-then-write anywhere in it, so
// there is no window for two of them to pass a check together (R3.5).
//
// **AND IT NEVER TOUCHES A ROW IT DID NOT CREATE.** `DO NOTHING`, never
// `DO UPDATE`: a day the gym has deliberately changed (`changed_alone`, 17b-ii)
// or cancelled must survive every later run of this job. That is the condition
// this card ships with rather than the one 17b-ii would have had to add.
//
// ── WHOSE NUMBERS A NEW DATE IS STAMPED WITH ────────────────────────────────
//
// **THE REPEAT'S**, since `0036` (RULINGS 2026-09-22: the repeat is the live
// answer, the class type is the default a new repeat is filled in from). Until
// then it was the type's, and a gym could not run Monday with twelve places and
// Thursday with twenty. Nothing in this statement reads the type's length,
// places or coach any more — it is joined for `archived_at` alone.
import type { Sql, TransactionSql } from "postgres";

/** The house alias (`orgs/repo.ts`, `memberList/repo.ts`, three more): postgres.js's
 *  `TransactionSql` is NOT assignable to `Sql` — it lacks `END`, `options` and nine
 *  other members — so a function that must run both on its own and inside a
 *  transaction says so in its type rather than being handed a cast. */
type SqlOrTx = Sql | TransactionSql;
import { CLASS_FILL_HORIZON_DAYS } from "@app/shared";
import { lockOrgRow } from "../repo.js";

export interface ClassFillResult {
  /** Rows actually written. A run that finds everything already there is 0 and
   *  is the NORMAL case: the horizon moves one day at a time. */
  sessions: number;
}

export interface ClassFillOptions {
  /** Restrict to these gyms. `null`/absent is every gym, which is what the
   *  nightly worker passes; a save passes its own gym so that a gym's own write
   *  never waits on every other gym's calendar. */
  gymIds?: readonly string[] | null;
  /** Narrower still: just these repeats.
   *
   *  **IT EXISTS BECAUSE IT WAS MEASURED, AND THE MEASUREMENT IS SMALLER THAN
   *  IT LOOKED.** A save holds the gym's row lock while it fills, and filling by
   *  GYM makes one new repeat re-walk every repeat that gym already has — 60 of
   *  them at the size §13.7 names. Scoped to the one repeat, at 20 gyms of 60
   *  classes (`.cost/cost17b.mts`, 2026-09-22, this laptop's Docker Postgres):
   *  a save's whole transaction goes from a median of 91.5 ms to 80.8 ms and a
   *  p95 of 159.9 ms to 93.8 ms — **the TAIL is what it buys, not the median**,
   *  because the median is dominated by the commit rather than by the fill: an
   *  EMPTY transaction on this machine is 8.7 ms and one that merely takes the
   *  gym's row lock is 38.6 ms (`.cost/parts.mts`), which is the WAL fsync of a
   *  Docker volume and not work this card added.
   *
   *  Kept anyway: the tail is what a second member of staff waits behind, and
   *  it changes no outcome — the statement is the same, and what it would have
   *  written for the other repeats is exactly what is already there. */
  scheduleIds?: readonly string[] | null;
  /** The injectable clock (CLAUDE.md §4, Money; `rollup.ts`'s shape). Tests
   *  stand on a summer-time weekend with it. */
  now?: Date;
  /** Eight weeks (`CLASS_FILL_HORIZON_DAYS`). A parameter so a test can prove
   *  the horizon is a boundary rather than a coincidence, never so a caller can
   *  pick its own — every production caller takes the default. */
  horizonDays?: number;
}

/** Write out every date every live repeat runs on, inside the window.
 *
 *  **IT TAKES NO LOCK, AND EVERY CALLER MUST BE HOLDING ONE.** The save path
 *  calls it inside `createSchedule`, which holds `lockOrgRow`; the nightly job
 *  calls it through `fillGymUnderLock` below. A third caller that does neither
 *  re-opens round one's C/H-1 — see this file's header.
 *
 *  Takes `SqlOrTx` so it is callable INSIDE a transaction, which is what the save
 *  path needs: a repeat and the dates it produces are one write, so a gym never
 *  sees a repeat with no calendar behind it.
 *
 *  **WHY THE WINDOW STARTS AT THE GYM'S TODAY AND NOT AT `starts_on`.** The
 *  calendar is forward-looking: a repeat whose `starts_on` is in the past gets
 *  no history written for it, because nothing happened on those days as far as
 *  this app is concerned. `greatest()` is that rule, and it is also what stops a
 *  gym typing 2019 into the form and writing two thousand rows.
 *
 *  **TODAY IS INCLUDED even when the class has already finished today.** A
 *  calendar that hid this morning's class at lunchtime would be answering a
 *  different question from the one staff are asking. */
export async function fillClassSessions(
  sql: SqlOrTx,
  opts: ClassFillOptions = {},
): Promise<ClassFillResult> {
  const now = opts.now ?? new Date();
  const horizonDays = opts.horizonDays ?? CLASS_FILL_HORIZON_DAYS;
  // `null` means every gym: `id = ANY(NULL)` is NULL rather than false, which
  // would filter every row out, so the IS NULL test comes first — `rollup.ts`'s
  // `scope` verbatim in shape, and :12227's L-2 in origin.
  const scope = opts.gymIds ?? null;
  const only = opts.scheduleIds ?? null;

  if (!Number.isInteger(horizonDays) || horizonDays < 0) {
    throw new Error(
      `fillClassSessions: horizonDays must be a whole number of days, got ${String(horizonDays)}`,
    );
  }

  const written = await sql`
    INSERT INTO gym_class_sessions
      (gym_id, class_type_id, schedule_id, local_date, local_start_minute,
       starts_at, minutes, places, coach_user_id)
    SELECT s.gym_id,
           s.class_type_id,
           s.id,
           d::date,
           s.local_start_minute,
           -- THE RULE. The gym's clock time, turned into an instant by the
           -- gym's own zone, one date at a time.
           ((d::date + make_interval(mins => s.local_start_minute)) AT TIME ZONE g.timezone),
           -- **THE REPEAT'S NUMBERS, NOT THE CLASS TYPE'S** (0036, RULINGS
           -- 2026-09-22). The repeat is the live answer; the type holds only
           -- what a new repeat was filled in from. gym_class_types is still
           -- joined, for t.archived_at alone - a removed class writes no more
           -- dates however live its repeats look.
           s.minutes,
           s.places,
           s.coach_user_id
    FROM gym_class_schedules s
    JOIN gyms g ON g.id = s.gym_id
    JOIN gym_class_types t ON t.id = s.class_type_id
    -- THE WINDOW, IN THE GYM'S OWN CALENDAR. greatest keeps it forward-only;
    -- least with 'infinity'::date is how an open-ended repeat is bounded
    -- without a second branch — a repeat with no end date is the normal one,
    -- and a CASE here would be two code paths for one rule.
    CROSS JOIN LATERAL generate_series(
      greatest(s.starts_on, (${now}::timestamptz AT TIME ZONE g.timezone)::date)::timestamp,
      least(coalesce(s.ends_on, 'infinity'::date),
            ((${now}::timestamptz AT TIME ZONE g.timezone)::date + ${horizonDays}::int))::timestamp,
      interval '1 day') AS d
    WHERE (${scope}::uuid[] IS NULL OR s.gym_id = ANY(${scope}::uuid[]))
      AND (${only}::uuid[] IS NULL OR s.id = ANY(${only}::uuid[]))
      -- A STOPPED REPEAT WRITES NOTHING MORE. One condition, not a date
      -- comparison against the clock: ended_at is the staff action, ends_on
      -- is what the gym typed, and only the first can stop a repeat mid-window.
      AND s.ended_at IS NULL
      AND t.archived_at IS NULL
      -- ISO weekdays, Monday 1 — EXTRACT(ISODOW …) answers in exactly the
      -- numbers the column stores, which is why there is no lookup table.
      AND EXTRACT(ISODOW FROM d)::int = ANY(s.weekdays)
      -- A date this repeat already holds is skipped here, through the unique
      -- index, before the wider check below: most nights that is every date but
      -- one, and without it the wider check made a normal night 54 % slower
      -- (measured, .cost/fillVariants.mts). ON CONFLICT below still guards it.
      AND NOT EXISTS (
        SELECT 1 FROM gym_class_sessions own
        WHERE own.schedule_id = s.id AND own.local_date = d::date)
      -- ONE CLASS, ONE TIME, ONE DATE (17b-ii-b-i). Another repeat's date moved
      -- to this time on its own already holds the slot — the repeat clash check
      -- in createSchedule compares repeats and cannot see it — and a CANCELLED
      -- one holds it too, or the class the gym cancelled at that time would come
      -- back the next night (round one, H-1).
      AND NOT EXISTS (
        SELECT 1 FROM gym_class_sessions o
        WHERE o.gym_id = s.gym_id
          AND o.class_type_id = s.class_type_id
          -- Bounds for the (class_type_id, starts_at) index, so the check does
          -- not walk the class's whole history; local_date decides.
          AND o.starts_at >= ((d::date)::timestamp AT TIME ZONE g.timezone) - interval '2 days'
          AND o.starts_at < ((d::date)::timestamp AT TIME ZONE g.timezone) + interval '3 days'
          AND o.local_date = d::date
          AND o.schedule_id IS DISTINCT FROM s.id
          AND o.local_start_minute = s.local_start_minute)
    ON CONFLICT (schedule_id, local_date) DO NOTHING`;

  return { sessions: written.count };
}

/** ONE GYM'S CALENDAR, UNDER THAT GYM'S ROW LOCK — the shape every console write
 *  in this module already has, and the fix for round one's C/H-1.
 *
 *  **PER GYM AND NOT PER RUN.** Locking every gym at once would serialise the
 *  whole product behind a nightly job; locking one gym at a time serialises only
 *  that gym's console writes, for the length of one gym's insert. It also fixes
 *  Low-5 by construction: the old single statement held a lock on every gym row
 *  it wrote under for the whole run (a rename measured at 2,726 ms against a
 *  quiet-server 122 ms), and a gym now waits only for its own share. */
export async function fillGymUnderLock(
  sql: Sql,
  gymId: string,
  opts: Omit<ClassFillOptions, "gymIds"> = {},
): Promise<ClassFillResult> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, gymId);
    return await fillClassSessions(tx, { ...opts, gymIds: [gymId] });
  });
}

export interface ClassFillJobDeps {
  sql: Sql;
  log: { info: (obj: Record<string, unknown>, msg?: string) => void };
}

/** The nightly job's entry point — the shape `worker.ts` calls and the shape
 *  every other sweep in this module already has (R8.3: a background job says
 *  what it did).
 *
 *  **ONE RUN COVERS EVERY GYM IN EVERY ZONE, and — unlike the rollup — it does
 *  NOT need an hourly cadence to do it.** `rollUpGymDays` runs hourly because it
 *  closes a day at 02:00 in the gym's own clock and no single UTC hour is 02:00
 *  everywhere. A HORIZON has no such instant: "eight weeks ahead of this gym's
 *  today" is computed per gym inside the statement, and a gym whose local date
 *  has not yet rolled over simply gets the same answer it already has. So the
 *  worst a daily run costs is that one gym's far edge sits at 55 days for part
 *  of a day, which nothing can see: the console shows four dates a repeat and
 *  17c's booking window opens 7 days out.
 *
 *  A run that writes nothing is the normal case, and it is not a failure: the
 *  horizon moves one day forward at a time, so a run writes one new date per
 *  repeat per matching weekday and nothing else. */
export async function fillClassSessionsJob(
  deps: ClassFillJobDeps,
  opts: ClassFillOptions = {},
): Promise<ClassFillResult> {
  const scope = opts.gymIds ?? null;
  // ONLY THE GYMS THAT COULD HAVE A DATE TO WRITE. A gym with no live repeat is
  // not locked, not read and not counted — which on a product where most gyms
  // have not typed a timetable yet is most of them.
  const gyms = await deps.sql<{ gym_id: string }[]>`
    SELECT DISTINCT s.gym_id
    FROM gym_class_schedules s
    JOIN gym_class_types t ON t.id = s.class_type_id
    WHERE s.ended_at IS NULL
      AND t.archived_at IS NULL
      AND (${scope}::uuid[] IS NULL OR s.gym_id = ANY(${scope}::uuid[]))
    ORDER BY s.gym_id`;

  // The per-gym options, with `gymIds` deliberately NOT carried through: the
  // loop below decides the gym, one at a time, and a scope left in here would be
  // a second answer to "which gym is this".
  const perGym: Omit<ClassFillOptions, "gymIds"> = {};
  if (opts.now !== undefined) perGym.now = opts.now;
  if (opts.horizonDays !== undefined) perGym.horizonDays = opts.horizonDays;

  let sessions = 0;
  for (const gym of gyms) {
    const written = await fillGymUnderLock(deps.sql, gym.gym_id, perGym);
    sessions += written.sessions;
  }

  const result: ClassFillResult = { sessions };
  deps.log.info(
    { ...result, gyms: gyms.length, event: "orgs.class_fill.finished" },
    "gym class calendar fill finished",
  );
  return result;
}
