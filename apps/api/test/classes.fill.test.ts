// THE REPEAT RULE — the eight-week fill, against REAL Postgres (R9.2,
// DATABASE_URL-gated). ROADMAP Stage 2 item 17b-i; Part 3 §13.3.
//
// **THE FIRST BLOCK IS THE WORST THING THIS CARD COULD DO TO A REAL PERSON, and
// it is first because the rulebook says it is** (CLAUDE.md §2.1, RULINGS
// 2026-09-20). A timetable's worst mistake is a class on the calendar at the
// WRONG HOUR: somebody arrives at six for a class that started at five, or turns
// up to a locked room. The one rule that can cause it is the repeat rule, and
// the day it can go wrong is the day the clocks change.
//
// **THE CASES COME FROM OUTSIDE THE CODE** (RULINGS 2026-09-20): the dates are
// real summer-time transitions taken from the zones themselves, not from
// anything this repo computes, and they include zones with rules the code has
// never heard of — a half-hour offset that never changes (Asia/Kolkata), a
// southern-hemisphere zone whose clocks move the OTHER way in the same months
// (Australia/Sydney), and a zone that abolished its own summer time
// (America/Phoenix, and Asia/Kolkata since 1945).
//
// **THE ASSERTIONS ARE UTC INSTANTS, NOT ROUND-TRIPS.** Asserting that the
// stored instant reads back as 18:00 in the gym's zone would be asking the same
// library the same question twice, and would stay green if the rule stored the
// wrong instant consistently. Every expectation below is a literal `+00`
// timestamp worked out from the zone's published offset on that date.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { CLASS_FILL_HORIZON_DAYS } from "@app/shared";
import { fillClassSessions, fillClassSessionsJob } from "../src/modules/orgs/classes/fill.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const TEST_TIMEOUT_MS = 60_000;
const HOOK_TIMEOUT_MS = 60_000;

/** Monday 1 … Sunday 7 — ISO, the column's own numbering. */
const MON = 1;
const TUE = 2;
const WED = 3;
const SUN = 7;

const at = (h: number, m = 0) => h * 60 + m;

/** The job reports what it did (R8.3); nothing here asserts on it. */
const silent = {
  info: () => {
    /* deliberately empty */
  },
};


d("the repeat rule: eight weeks of dates, in the gym's own clock (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 4 });

  /** A gym, a class and a repeat, built straight in SQL.
   *
   *  **NOT THROUGH THE ROUTES, DELIBERATELY.** What is under test here is the
   *  rule, and driving it through sign-in, a plan and a privilege would make
   *  every one of the cases below depend on four things that have their own
   *  suites. `classes.routes.test.ts` is where the doors are proved. */
  const owner = async (local: string) => {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash, display_name, status)
      VALUES (${`cfill-t-${local}@example.com`}, 'x', ${`Fill ${local}`}, 'active')
      RETURNING id`;
    if (row === undefined) throw new Error("no user");
    return row.id;
  };

  const gymIn = async (timezone: string, local: string) => {
    const ownerId = await owner(local);
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gyms (slug, name, owner_user_id, timezone)
      VALUES (${`cfill-t-${local}`}, ${`Fill ${local}`}, ${ownerId}, ${timezone})
      RETURNING id`;
    if (row === undefined) throw new Error("no gym");
    return row.id;
  };

  const classIn = async (
    gymId: string,
    opts: { minutes?: number; places?: number | null } = {},
  ) => {
    // `"places" in opts` and NOT `opts.places ?? 20`: null is a MEANING here (no
    // limit), and `??` swallows it — which this helper did until the open-gym
    // case turned red and proved it. A fixture that cannot express the value
    // under test is a fixture that tests something else.
    const places = "places" in opts ? opts.places : 20;
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_class_types (gym_id, name, minutes, places, colour)
      VALUES (${gymId}, 'Yoga', ${opts.minutes ?? 60}, ${places ?? null}, 'blue')
      RETURNING id`;
    if (row === undefined) throw new Error("no class type");
    return row.id;
  };

  /** A REPEAT, AND SINCE 17b-ii-a IT CARRIES ITS OWN LENGTH, PLACES AND COACH.
   *
   *  Left unsaid, they are COPIED FROM THE CLASS TYPE — which is exactly what
   *  the console does when a gym adds a repeat (the class is the default a new
   *  repeat starts from, RULINGS 2026-09-22), so every case written before this
   *  card goes on meaning what it meant. `own` is how a case says the repeat
   *  differs, which is the state this card exists to make possible.
   *
   *  `"places" in own` and NOT `own.places ?? …`, for the class-type helper's
   *  measured reason one function up: null is a MEANING here (no limit) and
   *  `??` swallows it. */
  const repeat = async (
    gymId: string,
    classTypeId: string,
    weekdays: number[],
    startMinute: number,
    startsOn: string,
    endsOn: string | null = null,
    own: { minutes?: number; places?: number | null; coachUserId?: string | null } = {},
  ) => {
    const placesGiven = "places" in own;
    const coachGiven = "coachUserId" in own;
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_class_schedules
        (gym_id, class_type_id, weekdays, local_start_minute, starts_on, ends_on,
         minutes, places, coach_user_id)
      SELECT ${gymId}, ${classTypeId}, ${sql.array(weekdays)}::int[], ${startMinute},
             ${startsOn}::date, ${endsOn}::date,
             coalesce(${own.minutes ?? null}::int, t.minutes),
             CASE WHEN ${placesGiven} THEN ${placesGiven ? (own.places ?? null) : null}::int
                  ELSE t.places END,
             CASE WHEN ${coachGiven} THEN ${coachGiven ? (own.coachUserId ?? null) : null}::uuid
                  ELSE t.coach_user_id END
      FROM gym_class_types t
      WHERE t.id = ${classTypeId} AND t.gym_id = ${gymId}
      RETURNING id`;
    if (row === undefined) throw new Error("no schedule");
    return row.id;
  };

  /** What the calendar actually holds, as strings: the local date the gym wrote
   *  down beside the UTC instant the server derived. Both, every time — a test
   *  that read only one of them could not tell a right date at a wrong hour from
   *  a wrong date at the right hour. */
  const calendar = (gymId: string) => sql<{ local_date: string; starts_at_utc: string }[]>`
    SELECT local_date::text AS local_date,
           to_char(starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS starts_at_utc
    FROM gym_class_sessions WHERE gym_id = ${gymId} ORDER BY starts_at`;

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms WHERE owner_user_id IN
        (SELECT id FROM users WHERE email LIKE 'cfill-t-%@example.com')`;
    await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_schedules WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'cfill-t-%@example.com'`;
  };

  beforeAll(cleanup, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    await cleanup();
    await sql.end();
  }, HOOK_TIMEOUT_MS);

  // ── THE WORST THING: A CLASS AT THE WRONG HOUR ────────────────────────────

  it(
    "the 6pm London class is 6pm on both sides of BOTH clock changes",
    async () => {
      const gymId = await gymIn("Europe/London", "london");
      const typeId = await classIn(gymId);
      // A Sunday repeat, so the class lands ON the two transition days
      // themselves: 29 March 2026 (clocks forward) and 25 October 2026 (back).
      // Starting the week before each and running to the week after.
      await repeat(gymId, typeId, [SUN], at(18), "2026-03-22", "2026-03-29");
      await repeat(gymId, typeId, [SUN], at(18), "2026-10-18", "2026-10-25");

      // The clock is a week before the first repeat, so both windows are inside
      // eight weeks of it? They are not — October is seven months away — so each
      // repeat is filled from its own "today".
      await fillClassSessions(sql, { gymIds: [gymId], now: new Date("2026-03-20T09:00:00Z") });
      await fillClassSessions(sql, { gymIds: [gymId], now: new Date("2026-10-16T09:00:00Z") });

      expect(await calendar(gymId)).toEqual([
        // GMT, UTC+0 — six o'clock is 18:00Z.
        { local_date: "2026-03-22", starts_at_utc: "2026-03-22 18:00" },
        // BST, UTC+1, and this is the transition day itself — six o'clock is
        // 17:00Z. A rule that stored an instant and added 168 hours would have
        // written 18:00Z here, an hour late for every member.
        { local_date: "2026-03-29", starts_at_utc: "2026-03-29 17:00" },
        // Still BST.
        { local_date: "2026-10-18", starts_at_utc: "2026-10-18 17:00" },
        // Back to GMT on the transition day — 18:00Z, an hour later in UTC than
        // the week before, and the same six o'clock on the gym's wall.
        { local_date: "2026-10-25", starts_at_utc: "2026-10-25 18:00" },
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a class is never lost to a clock change, even at the hour that does not exist",
    async () => {
      // 01:30 on 29 March 2026 in London is a local time that never happens —
      // the clocks go 01:00 → 02:00 — and 01:30 on 25 October happens TWICE.
      // Neither may drop a class off the calendar or raise: a gym with a 1:30am
      // slot (a 24-hour gym's open-gym block) must still have its row.
      const gymId = await gymIn("Europe/London", "gap");
      const typeId = await classIn(gymId);
      await repeat(gymId, typeId, [SUN], at(1, 30), "2026-03-29", "2026-03-29");
      await repeat(gymId, typeId, [SUN], at(1, 30), "2026-10-25", "2026-10-25");

      await fillClassSessions(sql, { gymIds: [gymId], now: new Date("2026-03-27T09:00:00Z") });
      await fillClassSessions(sql, { gymIds: [gymId], now: new Date("2026-10-23T09:00:00Z") });

      // MEASURED FROM THIS POSTGRES, not assumed: the skipped half hour lands
      // after the jump (01:30Z is 02:30 local), and the repeated one takes the
      // second occurrence (01:30Z is 01:30 GMT). Both are defined answers and
      // both keep the class.
      expect(await calendar(gymId)).toEqual([
        { local_date: "2026-03-29", starts_at_utc: "2026-03-29 01:30" },
        { local_date: "2026-10-25", starts_at_utc: "2026-10-25 01:30" },
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "zones the code has never heard of: a half hour, a southern winter, and no summer time at all",
    async () => {
      // Asia/Kolkata — UTC+5:30 all year, and no summer time since 1945. An
      // implementation that worked in whole hours would be half an hour out here
      // on every single row.
      const kolkata = await gymIn("Asia/Kolkata", "kolkata");
      const kolkataType = await classIn(kolkata);
      await repeat(kolkata, kolkataType, [SUN], at(18), "2026-03-29", "2026-03-29");
      await fillClassSessions(sql, {
        gymIds: [kolkata],
        now: new Date("2026-03-27T09:00:00Z"),
      });
      expect(await calendar(kolkata)).toEqual([
        { local_date: "2026-03-29", starts_at_utc: "2026-03-29 12:30" },
      ]);

      // Australia/Sydney — the clocks move the OTHER WAY in these months. On 29
      // March 2026 Sydney is on daylight time (UTC+11) and on 25 October it is
      // too (it went forward on 4 October), while London did the opposite on
      // both dates. A rule that had learned "March means forward" is wrong here.
      const sydney = await gymIn("Australia/Sydney", "sydney");
      const sydneyType = await classIn(sydney);
      await repeat(sydney, sydneyType, [SUN], at(18), "2026-03-29", "2026-03-29");
      await repeat(sydney, sydneyType, [SUN], at(18), "2026-04-05", "2026-04-05");
      await fillClassSessions(sql, {
        gymIds: [sydney],
        now: new Date("2026-03-27T09:00:00Z"),
      });
      expect(await calendar(sydney)).toEqual([
        // AEDT, UTC+11.
        { local_date: "2026-03-29", starts_at_utc: "2026-03-29 07:00" },
        // AEST, UTC+10 — Sydney went BACK on 5 April, a week after London went
        // forward.
        { local_date: "2026-04-05", starts_at_utc: "2026-04-05 08:00" },
      ]);

      // America/Phoenix — in the United States and does not observe summer time
      // at all, unlike every other US zone. UTC-7 on both dates.
      const phoenix = await gymIn("America/Phoenix", "phoenix");
      const phoenixType = await classIn(phoenix);
      await repeat(phoenix, phoenixType, [SUN], at(18), "2026-03-01", "2026-03-15");
      await fillClassSessions(sql, {
        gymIds: [phoenix],
        now: new Date("2026-02-27T09:00:00Z"),
      });
      expect(await calendar(phoenix)).toEqual([
        { local_date: "2026-03-01", starts_at_utc: "2026-03-02 01:00" },
        // The US went forward on 8 March 2026. Phoenix did not: still 01:00Z.
        { local_date: "2026-03-08", starts_at_utc: "2026-03-09 01:00" },
        { local_date: "2026-03-15", starts_at_utc: "2026-03-16 01:00" },
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  // ── SAFE TO RUN TWICE ─────────────────────────────────────────────────────

  it(
    "running the fill again writes nothing, and leaves a changed day alone",
    async () => {
      const gymId = await gymIn("Europe/London", "twice");
      const typeId = await classIn(gymId);
      await repeat(gymId, typeId, [MON, WED], at(19), "2026-06-01", "2026-06-30");

      const now = new Date("2026-06-01T06:00:00Z");
      const first = await fillClassSessions(sql, { gymIds: [gymId], now });
      expect(first.sessions).toBe(9); // five Mondays, four Wednesdays in June 2026

      // A day the gym has changed on purpose (17b-ii's flag) and a day it has
      // cancelled. NEITHER may be touched or duplicated by a later run.
      await sql`
        UPDATE gym_class_sessions
        SET local_start_minute = ${at(20)},
            starts_at = starts_at + interval '1 hour',
            changed_alone = true
        WHERE gym_id = ${gymId} AND local_date = '2026-06-03'`;
      await sql`
        UPDATE gym_class_sessions SET status = 'cancelled'
        WHERE gym_id = ${gymId} AND local_date = '2026-06-08'`;

      const again = await fillClassSessions(sql, { gymIds: [gymId], now });
      expect(again.sessions).toBe(0);
      // Three more runs, for the shape a retrying worker actually has.
      await fillClassSessions(sql, { gymIds: [gymId], now });
      await fillClassSessions(sql, { gymIds: [gymId], now });
      await fillClassSessions(sql, { gymIds: [gymId], now });

      const [count] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM gym_class_sessions WHERE gym_id = ${gymId}`;
      expect(count?.n).toBe(9);

      const [changed] = await sql<{ minute: number; changed: boolean }[]>`
        SELECT local_start_minute AS minute, changed_alone AS changed
        FROM gym_class_sessions WHERE gym_id = ${gymId} AND local_date = '2026-06-03'`;
      expect(changed).toEqual({ minute: at(20), changed: true });

      const [cancelled] = await sql<{ status: string }[]>`
        SELECT status FROM gym_class_sessions
        WHERE gym_id = ${gymId} AND local_date = '2026-06-08'`;
      expect(cancelled?.status).toBe("cancelled");
    },
    TEST_TIMEOUT_MS,
  );

  // ── THE WINDOW ────────────────────────────────────────────────────────────

  it(
    "the window is the gym's today to eight weeks after it, both edges",
    async () => {
      const gymId = await gymIn("Europe/London", "window");
      const typeId = await classIn(gymId);
      // Every day, open-ended, starting long ago: the window alone decides.
      await repeat(gymId, typeId, [1, 2, 3, 4, 5, 6, 7], at(9), "2020-01-01", null);

      const now = new Date("2026-06-10T08:00:00Z"); // a Wednesday
      const filled = await fillClassSessions(sql, { gymIds: [gymId], now });
      // Today INCLUDED and the last day INCLUDED: 56 days after today is 57
      // dates in all.
      expect(filled.sessions).toBe(CLASS_FILL_HORIZON_DAYS + 1);

      const rows = await calendar(gymId);
      expect(rows[0]?.local_date).toBe("2026-06-10");
      expect(rows[rows.length - 1]?.local_date).toBe("2026-08-05"); // 10 June + 56
      // NOTHING BEFORE TODAY, though the repeat began in 2020. The calendar is
      // forward-looking; a gym typing an old start date must not write six years
      // of history.
      const [before] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM gym_class_sessions
        WHERE gym_id = ${gymId} AND local_date < '2026-06-10'`;
      expect(before?.n).toBe(0);

      // TODAY IS INCLUDED EVEN AFTER THE CLASS HAS FINISHED. The same fill run
      // at ten at night still holds this morning's nine o'clock.
      await sql`DELETE FROM gym_class_sessions WHERE gym_id = ${gymId}`;
      await fillClassSessions(sql, { gymIds: [gymId], now: new Date("2026-06-10T21:00:00Z") });
      const [today] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM gym_class_sessions
        WHERE gym_id = ${gymId} AND local_date = '2026-06-10'`;
      expect(today?.n).toBe(1);

      // THE HORIZON ROLLS. One day later, exactly one new date — the far edge —
      // and the near edge is not removed by this job (nothing here deletes).
      const rolled = await fillClassSessions(sql, {
        gymIds: [gymId],
        now: new Date("2026-06-11T08:00:00Z"),
      });
      expect(rolled.sessions).toBe(1);
      const [far] = await sql<{ day: string }[]>`
        SELECT max(local_date)::text AS day FROM gym_class_sessions WHERE gym_id = ${gymId}`;
      expect(far?.day).toBe("2026-08-06");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "weekdays, end dates and stopped repeats each decide what is written",
    async () => {
      const gymId = await gymIn("Europe/London", "cases");
      const now = new Date("2026-06-10T08:00:00Z"); // Wednesday 10 June 2026

      // ONE WEEKDAY, and it is the day BEFORE today's: the first date must be
      // next week, not today.
      const monday = await classIn(gymId);
      await repeat(gymId, monday, [MON], at(7), "2026-06-01", "2026-06-30");

      // A repeat whose window ENDS inside the horizon.
      const shortRun = await classIn(gymId);
      await repeat(gymId, shortRun, [TUE], at(7), "2026-06-01", "2026-06-16");

      // A repeat that has not STARTED yet, beginning inside the horizon.
      const later = await classIn(gymId);
      await repeat(gymId, later, [WED], at(7), "2026-07-01", null);

      // A repeat whose window is entirely PAST.
      const over = await classIn(gymId);
      await repeat(gymId, over, [WED], at(7), "2026-01-01", "2026-02-01");

      // A repeat whose window begins AFTER the horizon.
      const distant = await classIn(gymId);
      await repeat(gymId, distant, [WED], at(7), "2027-01-01", null);

      // A STOPPED repeat, and an ARCHIVED class type. Neither writes a thing.
      const stopped = await classIn(gymId);
      const stoppedId = await repeat(gymId, stopped, [WED], at(7), "2026-06-01", null);
      await sql`UPDATE gym_class_schedules SET ended_at = now() WHERE id = ${stoppedId}`;
      const archived = await classIn(gymId);
      await repeat(gymId, archived, [WED], at(7), "2026-06-01", null);
      await sql`UPDATE gym_class_types SET archived_at = now() WHERE id = ${archived}`;

      await fillClassSessions(sql, { gymIds: [gymId], now });

      const byType = await sql<{ class_type_id: string; first: string; last: string; n: number }[]>`
        SELECT class_type_id, min(local_date)::text AS first, max(local_date)::text AS last,
               count(*)::int AS n
        FROM gym_class_sessions WHERE gym_id = ${gymId} GROUP BY class_type_id`;
      const byId = new Map(byType.map((r) => [r.class_type_id, r]));

      // Mondays from the first one AFTER today (10 June is a Wednesday) to the
      // repeat's own end.
      expect(byId.get(monday)).toEqual({
        class_type_id: monday,
        first: "2026-06-15",
        last: "2026-06-29",
        n: 3,
      });
      // Tuesdays, stopping at the gym's own end date and not at the horizon.
      expect(byId.get(shortRun)).toEqual({
        class_type_id: shortRun,
        first: "2026-06-16",
        last: "2026-06-16",
        n: 1,
      });
      // Wednesdays, starting when the gym said and running to the horizon.
      expect(byId.get(later)).toEqual({
        class_type_id: later,
        first: "2026-07-01",
        last: "2026-08-05",
        n: 6,
      });
      for (const none of [over, distant, stopped, archived]) {
        expect(byId.get(none)).toBeUndefined();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "one gym's fill never touches another gym's calendar",
    async () => {
      const a = await gymIn("Europe/London", "scope-a");
      const b = await gymIn("Europe/London", "scope-b");
      const aType = await classIn(a);
      const bType = await classIn(b);
      await repeat(a, aType, [WED], at(9), "2026-06-01", "2026-06-30");
      await repeat(b, bType, [WED], at(9), "2026-06-01", "2026-06-30");

      const now = new Date("2026-06-10T08:00:00Z");
      await fillClassSessions(sql, { gymIds: [a], now });

      const [ofA] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM gym_class_sessions WHERE gym_id = ${a}`;
      const [ofB] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM gym_class_sessions WHERE gym_id = ${b}`;
      expect(ofA?.n).toBe(3);
      expect(ofB?.n).toBe(0);

      // AND `gymIds` ABSENT MEANS EVERY GYM, which is what the nightly worker
      // passes. `= ANY(NULL)` is NULL rather than false, so a null scope that
      // reached the WHERE unguarded would filter EVERY row out and the job would
      // do nothing for ever, silently.
      await fillClassSessions(sql, { now });
      const [bNow] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM gym_class_sessions WHERE gym_id = ${b}`;
      expect(bNow?.n).toBe(3);
    },
    TEST_TIMEOUT_MS,
  );

  // **THE REPEAT'S NUMBERS, NOT THE CLASS'S** (17b-ii-a; RULINGS 2026-09-22) —
  // and the repeat DIFFERS from its class in all three, which is the only way
  // this case can tell which of the two rows the fill read. A repeat that
  // carried its class's own numbers would leave this whole file green with the
  // fill put back to `t.minutes` — measured, so it is not left to chance.
  it(
    "a session copies the REPEAT's numbers at the moment it is written, never its class's",
    async () => {
      const gymId = await gymIn("Europe/London", "copy");
      const [gym] = await sql<{ owner_user_id: string }[]>`
        SELECT owner_user_id FROM gyms WHERE id = ${gymId}`;
      const coach = gym?.owner_user_id ?? null;
      // The CLASS says 45 minutes, no limit, nobody named.
      const typeId = await classIn(gymId, { minutes: 45, places: null });
      // Its WEDNESDAY says 90 minutes, 12 places, a coach — every field changed.
      const wed = await repeat(gymId, typeId, [WED], at(9), "2026-06-01", "2026-06-17", {
        minutes: 90,
        places: 12,
        coachUserId: coach,
      });
      // And a FRIDAY under a capped class that says NO LIMIT: `places` NULL is a
      // meaning and must survive as null — a fill that coalesced it to the
      // class's number would invent a cap for an open-gym slot.
      const cappedType = await classIn(gymId, { minutes: 60, places: 20 });
      const fri = await repeat(gymId, cappedType, [5], at(17), "2026-06-01", "2026-06-19", {
        places: null,
      });

      await fillClassSessions(sql, {
        gymIds: [gymId],
        now: new Date("2026-06-10T08:00:00Z"),
      });
      const rows = await sql<
        { schedule_id: string; minutes: number; places: number | null; coach: string | null }[]
      >`
        SELECT schedule_id, minutes, places, coach_user_id AS coach
        FROM gym_class_sessions WHERE gym_id = ${gymId}`;
      const wedRows = rows.filter((r) => r.schedule_id === wed);
      const friRows = rows.filter((r) => r.schedule_id === fri);
      expect(wedRows).toHaveLength(2);
      expect(friRows).toHaveLength(2);
      for (const r of wedRows) {
        expect(r).toMatchObject({ minutes: 90, places: 12, coach });
      }
      for (const r of friRows) expect(r).toMatchObject({ minutes: 60, places: null, coach: null });
    },
    TEST_TIMEOUT_MS,
  );

  // Round one, C/H-1: the JOB is what takes the lock now, one gym at a time, so
  // it is a different code path from the statement every other case here drives.
  it(
    "the nightly job fills every gym that has a live repeat, and no others",
    async () => {
      const withRepeat = await gymIn("Europe/London", "job-a");
      const alsoWith = await gymIn("Europe/London", "job-b");
      const stoppedOnly = await gymIn("Europe/London", "job-c");
      const archivedOnly = await gymIn("Europe/London", "job-d");
      const emptyGym = await gymIn("Europe/London", "job-e");

      for (const [gymId, kind] of [
        [withRepeat, "live"],
        [alsoWith, "live"],
        [stoppedOnly, "stopped"],
        [archivedOnly, "archived"],
      ] as const) {
        const typeId = await classIn(gymId);
        const scheduleId = await repeat(gymId, typeId, [WED], at(9), "2026-06-01", "2026-06-30");
        if (kind === "stopped") {
          await sql`UPDATE gym_class_schedules SET ended_at = now() WHERE id = ${scheduleId}`;
        }
        if (kind === "archived") {
          await sql`UPDATE gym_class_types SET archived_at = now() WHERE id = ${typeId}`;
        }
      }

      const now = new Date("2026-06-10T08:00:00Z");
      const filled = await fillClassSessionsJob({ sql, log: silent }, { now });
      // Two gyms of three Wednesdays each. A gym with nothing live is never
      // locked, never read and never counted.
      expect(filled.sessions).toBe(6);

      const counts = await sql<{ gym_id: string; n: number }[]>`
        SELECT gym_id, count(*)::int AS n FROM gym_class_sessions
        WHERE gym_id = ANY(${sql.array([withRepeat, alsoWith, stoppedOnly, archivedOnly, emptyGym])}::uuid[])
        GROUP BY gym_id`;
      const byGym = new Map(counts.map((r) => [r.gym_id, r.n]));
      expect(byGym.get(withRepeat)).toBe(3);
      expect(byGym.get(alsoWith)).toBe(3);
      for (const none of [stoppedOnly, archivedOnly, emptyGym]) {
        expect(byGym.get(none)).toBeUndefined();
      }

      // Still safe to run twice, through the job as well as the statement.
      expect((await fillClassSessionsJob({ sql, log: silent }, { now })).sessions).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a horizon that is not a whole number of days is refused rather than guessed at",
    async () => {
      await expect(fillClassSessions(sql, { horizonDays: 1.5 })).rejects.toThrow(
        /whole number of days/,
      );
      await expect(fillClassSessions(sql, { horizonDays: -1 })).rejects.toThrow(
        /whole number of days/,
      );
    },
    TEST_TIMEOUT_MS,
  );
});
