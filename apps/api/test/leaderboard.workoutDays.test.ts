// WORKOUT DAYS — which workouts count, on real Postgres (spec Part 3 §15.5; ROADMAP
// 19a-ii). DATABASE_URL-gated.
//
// A table over every class of workout. Each case's number is read three ways that must
// agree: the board's own row, "what counted", and the list under it. Calendar days are
// checked against the tz database (Intl), never against the code's own arithmetic.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { LEADERBOARD_PERIODS, type LeaderboardPeriod, type LeaderboardWorkoutNotCounted } from "@app/shared";
import { getLeaderboard, getMyCounted } from "../src/modules/orgs/leaderboard/service.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const T = 120_000;
const LIVE_PLAN = "zz_lb_workouts";
const HOUR = 3_600_000;
const QUARTER = 900_000;
/** Wednesday 7 October 2026, noon in Kolkata. */
const NOW = new Date("2026-10-07T06:30:00Z");
/** Monday 28 September 2026, 05:30 in Kolkata. */
const JOINED = "2026-09-28T00:00:00Z";

/** The calendar day of an instant in a zone, by the tz database. */
const dayIn = (instant: Date, zone: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);

/** The first instant of a calendar day in a zone. Every zone's offset is a whole number of
 *  quarter hours and lies between −12 and +14 hours. */
function firstInstantOf(day: string, zone: string): Date {
  const start = Date.parse(`${day}T00:00:00Z`) - 15 * HOUR;
  for (let t = start; t <= start + 28 * HOUR; t += QUARTER) {
    if (dayIn(new Date(t), zone) === day) return new Date(t);
  }
  throw new Error(`no start of ${day} in ${zone}`);
}
const dayBefore = (day: string): string => new Date(Date.parse(`${day}T00:00:00Z`) - 24 * HOUR).toISOString().slice(0, 10);

d("workout days: which workouts count (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let exerciseId = "";

  const cleanup = async () => {
    const gyms = sql`SELECT id FROM gyms WHERE slug LIKE 'lb-w-%'`;
    const users = sql`SELECT id FROM users WHERE email LIKE 'lb-w-%@example.com'`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${gyms})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
    await sql`DELETE FROM gyms WHERE slug LIKE 'lb-w-%'`;
    await sql`DELETE FROM workouts WHERE user_id IN (${users})`;
    await sql`DELETE FROM users WHERE email LIKE 'lb-w-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const person = async (name: string, status: "active" | "deleted" = "active"): Promise<string> => {
    const id = randomUUID();
    await sql`INSERT INTO users (id, email, display_name, status) VALUES (${id}, ${`lb-w-${id}@example.com`}, ${name}, ${status})`;
    return id;
  };

  const gym = async (zone: string, live = true): Promise<{ id: string; ownerId: string }> => {
    const id = randomUUID();
    const ownerId = await person("Olga Owner");
    await sql`INSERT INTO gyms (id, slug, name, timezone, owner_user_id) VALUES (${id}, ${`lb-w-${id}`}, 'Workout Gym', ${zone}, ${ownerId})`;
    await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${id}, ${ownerId}, 'owner')`;
    if (live) {
      await sql`
        INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
        VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'active', 'pilot')`;
    }
    return { id, ownerId };
  };

  const join = async (gymId: string, userId: string, joinedAt = JOINED, removedAt: string | null = null): Promise<void> => {
    await sql`INSERT INTO gym_members (gym_id, user_id, joined_at, removed_at) VALUES (${gymId}, ${userId}, ${joinedAt}, ${removedAt})`;
  };

  interface WorkoutOptions {
    /** Who counted each set; one set the camera counted when left out. */
    sets?: ("engine" | "log_only" | null)[];
    /** How long after its start it reached the server. */
    savedAfterMs?: number;
  }
  const workout = async (userId: string, startedAt: Date | string, o: WorkoutOptions = {}): Promise<void> => {
    const id = randomUUID();
    const started = new Date(startedAt);
    const sets = o.sets ?? ["engine"];
    await sql`
      INSERT INTO workouts (id, user_id, started_at, platform, engine_version, sets_count, created_at)
      VALUES (${id}, ${userId}, ${started}, 'web', 'test', ${sets.length}, ${new Date(started.getTime() + (o.savedAfterMs ?? HOUR / 2))})`;
    for (const [i, mode] of sets.entries()) {
      const scored = mode !== "log_only";
      await sql`
        INSERT INTO workout_sets (workout_id, user_id, exercise_id, started_at, set_index, mode, reps, duration_ms, engine_version, definition_version)
        VALUES (${id}, ${userId}, ${exerciseId}, ${started}, ${i}, ${mode}, 10, 60000, ${scored ? "test" : null}, ${scored ? 1 : null})`;
    }
  };

  /** One person's number on a period, read three ways that must agree. */
  const read = async (gymId: string, userId: string, period: LeaderboardPeriod, now = NOW) => {
    const deps = { sql, now: () => now };
    const board = await getLeaderboard(deps, userId, gymId, { board: "workout_days", period });
    const mine = await getMyCounted(deps, userId, gymId, { board: "workout_days", period });
    expect(mine.value).toBe(board.me.value);
    expect(mine.workoutDays.length).toBe(mine.value);
    return {
      board,
      mine,
      value: mine.value,
      days: mine.workoutDays.map((x) => x.day),
      not: mine.workoutsNotCounted.map((n) => [n.day, n.why, n.daysLate]),
    };
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    exerciseId = (await sql<{ id: string }[]>`SELECT id FROM exercises ORDER BY slug LIMIT 1`)[0]?.id ?? "";
  }, T);

  afterAll(async () => {
    await cleanup();
    await sql.end({ timeout: 5 });
  }, T);

  // ===========================================================================
  // ONE WORKOUT: COUNTED, OR WHY NOT
  // ===========================================================================

  interface Case {
    name: string;
    startedAt: string;
    period: LeaderboardPeriod;
    options?: WorkoutOptions;
    want: "counted" | LeaderboardWorkoutNotCounted;
    /** The gym's day it falls on, in Kolkata. */
    day: string;
    daysLate?: number;
  }
  const cases: Case[] = [
    { name: "one set, saved as it ended", startedAt: "2026-10-06T02:00:00Z", period: "this_week", want: "counted", day: "2026-10-06" },
    { name: "counted by the person, not the camera", startedAt: "2026-10-06T02:00:00Z", period: "this_week", options: { sets: ["log_only"] }, want: "counted", day: "2026-10-06" },
    { name: "no set saved", startedAt: "2026-10-06T02:00:00Z", period: "this_week", options: { sets: [] }, want: "no_sets", day: "2026-10-06" },
    { name: "started the second before joining", startedAt: "2026-09-27T23:59:59Z", period: "last_week", want: "before_joining", day: "2026-09-28" },
    { name: "started the instant of joining", startedAt: JOINED, period: "last_week", want: "counted", day: "2026-09-28" },
    { name: "starts the second after now", startedAt: "2026-10-07T06:30:01Z", period: "this_week", options: { savedAfterMs: -HOUR }, want: "future", day: "2026-10-07" },
    { name: "started now", startedAt: "2026-10-07T06:30:00Z", period: "this_week", options: { savedAfterMs: 0 }, want: "counted", day: "2026-10-07" },
    { name: "dated tomorrow", startedAt: "2026-10-08T02:00:00Z", period: "this_week", options: { savedAfterMs: -30 * HOUR }, want: "future", day: "2026-10-08" },
    { name: "saved by a phone whose clock runs ten minutes fast", startedAt: "2026-10-06T02:00:00Z", period: "this_week", options: { savedAfterMs: -HOUR / 6 }, want: "counted", day: "2026-10-06" },
    { name: "saved exactly seven days after it started", startedAt: "2026-09-29T02:00:00Z", period: "last_week", options: { savedAfterMs: 168 * HOUR }, want: "counted", day: "2026-09-29" },
    { name: "saved seven days and a second after", startedAt: "2026-09-29T02:00:00Z", period: "last_week", options: { savedAfterMs: 168 * HOUR + 1000 }, want: "saved_late", day: "2026-09-29", daysLate: 8 },
    { name: "saved nine days after", startedAt: "2026-09-28T02:00:00Z", period: "last_week", options: { savedAfterMs: 216 * HOUR }, want: "saved_late", day: "2026-09-28", daysLate: 9 },
    { name: "no set AND saved late: the first reason is given", startedAt: "2026-09-28T02:00:00Z", period: "last_week", options: { sets: [], savedAfterMs: 216 * HOUR }, want: "no_sets", day: "2026-09-28" },
  ];

  it(
    "one workout of every kind: counted, or listed with why it is not",
    async () => {
      const g = await gym("Asia/Kolkata");
      for (const c of cases) {
        expect([c.name, dayIn(new Date(c.startedAt), "Asia/Kolkata")]).toEqual([c.name, c.day]);
        const who = await person("Tess Table");
        await join(g.id, who);
        await workout(who, c.startedAt, c.options);
        const got = await read(g.id, who, c.period);
        const want =
          c.want === "counted"
            ? { value: 1, days: [c.day], not: [] }
            : { value: 0, days: [], not: [[c.day, c.want, c.daysLate ?? null]] };
        expect({ name: c.name, value: got.value, days: got.days, not: got.not }).toEqual({ name: c.name, ...want });
      }
    },
    T,
  );

  it(
    "two workouts on one day are one workout day, each listed with who counted its reps",
    async () => {
      const g = await gym("Asia/Kolkata");
      const who = await person("Dana Double");
      await join(g.id, who);
      await workout(who, "2026-10-05T02:00:00Z", { sets: ["engine", "engine"] });
      await workout(who, "2026-10-05T12:00:00Z", { sets: ["log_only"] });
      await workout(who, "2026-10-06T02:00:00Z", { sets: ["engine", "log_only"] });
      // Sets saved before the app recorded who counted them.
      await workout(who, "2026-10-06T12:00:00Z", { sets: [null] });
      const got = await read(g.id, who, "this_week");
      expect(got.value).toBe(2);
      expect(got.mine.workoutDays).toEqual([
        {
          day: "2026-10-06",
          workouts: [
            { at: "2026-10-06T12:00:00.000Z", countedBy: null },
            { at: "2026-10-06T02:00:00.000Z", countedBy: "both" },
          ],
        },
        {
          day: "2026-10-05",
          workouts: [
            { at: "2026-10-05T12:00:00.000Z", countedBy: "you" },
            { at: "2026-10-05T02:00:00.000Z", countedBy: "camera" },
          ],
        },
      ]);
      expect(got.board.me.circles).toEqual(["yes", "yes", "no", "no", "no", "no", "no"]);
    },
    T,
  );

  // ===========================================================================
  // THE GYM'S OWN DAY
  // ===========================================================================

  // Each zone on an ordinary day, and the days its clocks change (tz database 2026a):
  // Santiago skips midnight itself on 6 September; Lord Howe moves half an hour.
  const edges: [string, string][] = [
    ["Asia/Kolkata", "2026-10-07"],
    ["America/New_York", "2026-10-07"],
    ["Europe/London", "2026-10-07"],
    ["Asia/Kathmandu", "2026-10-07"],
    ["Australia/Lord_Howe", "2026-10-07"],
    ["America/Santiago", "2026-10-07"],
    ["America/Santiago", "2026-09-06"],
    ["America/Santiago", "2026-04-05"],
    ["Australia/Lord_Howe", "2026-10-04"],
    ["Australia/Lord_Howe", "2026-04-05"],
    ["America/New_York", "2026-11-01"],
    ["America/New_York", "2026-03-08"],
    ["Europe/London", "2026-10-25"],
    ["Europe/London", "2026-03-29"],
    ["Asia/Kolkata", "2028-02-29"],
    ["America/New_York", "2028-03-01"],
  ];

  it(
    "the last second of a day and the first instant of the next are two workout days, by the gym's own clock",
    async () => {
      for (const [zone, day] of edges) {
        const g = await gym(zone);
        const who = await person("Mina Midnight");
        await join(g.id, who, "2020-01-01T00:00:00Z");
        const first = firstInstantOf(day, zone);
        const lastOfDayBefore = new Date(first.getTime() - 1000);
        expect([zone, dayIn(lastOfDayBefore, zone)]).toEqual([zone, dayBefore(day)]);
        await workout(who, first);
        await workout(who, lastOfDayBefore);
        const got = await read(g.id, who, "all_time", new Date(first.getTime() + 36 * HOUR));
        expect({ zone, day, days: got.days }).toEqual({ zone, day, days: [day, dayBefore(day)] });
      }
    },
    T,
  );

  it(
    "each period counts the workouts on its own days: the week turns on Monday and the month on the 1st, in the gym's zone",
    async () => {
      // Wednesday 7 October in Kolkata and New York, Thursday morning on Lord Howe: one week.
      const now = new Date("2026-10-07T16:00:00Z");
      for (const zone of ["Asia/Kolkata", "America/New_York", "Australia/Lord_Howe"]) {
        const g = await gym(zone);
        const who = await person("Pat Period");
        await join(g.id, who, "2020-01-01T00:00:00Z");
        for (const day of ["2026-09-01", "2026-10-01", "2026-10-05"]) {
          const first = firstInstantOf(day, zone);
          await workout(who, first);
          await workout(who, new Date(first.getTime() - 1000));
        }
        const want: Record<LeaderboardPeriod, string[]> = {
          this_week: ["2026-10-05"],
          last_week: ["2026-10-04", "2026-10-01", "2026-09-30"],
          this_month: ["2026-10-05", "2026-10-04", "2026-10-01"],
          last_month: ["2026-09-30", "2026-09-01"],
          all_time: ["2026-10-05", "2026-10-04", "2026-10-01", "2026-09-30", "2026-09-01", "2026-08-31"],
        };
        for (const period of LEADERBOARD_PERIODS) {
          const got = await read(g.id, who, period, now);
          expect({ zone, period, days: got.days }).toEqual({ zone, period, days: want[period] });
        }
        const lastWeek = await read(g.id, who, "last_week", now);
        expect(lastWeek.board.circleDays).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
        expect(lastWeek.board.me.circles).toEqual(["no", "no", "yes", "yes", "no", "no", "yes"]);
        expect((await read(g.id, who, "this_month", now)).board.me.circles).toBeNull();
      }
    },
    T,
  );

  // ===========================================================================
  // WHOSE WORKOUT, AT WHICH GYM
  // ===========================================================================

  it(
    "a home workout counts at each of the person's gyms, on each gym's own day",
    async () => {
      const kolkata = await gym("Asia/Kolkata");
      const newYork = await gym("America/New_York");
      const who = await person("Tara Two");
      await join(kolkata.id, who);
      await join(newYork.id, who);
      // 01:30 on Wednesday in Kolkata, 16:00 on Tuesday in New York.
      await workout(who, "2026-10-06T20:00:00Z");
      const k = await read(kolkata.id, who, "this_week");
      const n = await read(newYork.id, who, "this_week");
      expect([k.days, k.board.me.circles]).toEqual([["2026-10-07"], ["no", "no", "yes", "no", "no", "no", "no"]]);
      expect([n.days, n.board.me.circles]).toEqual([["2026-10-06"], ["no", "yes", "no", "no", "no", "no", "no"]]);
    },
    T,
  );

  it(
    "someone who left and rejoined: only workouts since they rejoined count, and all time leaves the earlier ones out",
    async () => {
      const g = await gym("Asia/Kolkata");
      const who = await person("Rae Rejoin");
      await join(g.id, who, "2026-01-01T00:00:00Z", "2026-09-01T00:00:00Z");
      await join(g.id, who, "2026-10-05T12:00:00Z");
      await workout(who, "2026-08-15T02:00:00Z"); // while a member the first time
      await workout(who, "2026-09-15T02:00:00Z"); // while not a member
      await workout(who, "2026-10-05T06:00:00Z"); // this week, before rejoining
      await workout(who, "2026-10-06T02:00:00Z"); // this week, after
      const week = await read(g.id, who, "this_week");
      expect([week.days, week.not]).toEqual([["2026-10-06"], [["2026-10-05", "before_joining", null]]]);
      const lastMonth = await read(g.id, who, "last_month");
      expect([lastMonth.days, lastMonth.not]).toEqual([[], [["2026-09-15", "before_joining", null]]]);
      const all = await read(g.id, who, "all_time");
      expect([all.days, all.not]).toEqual([["2026-10-06"], []]);
    },
    T,
  );

  it(
    "the board: ties share a place by name; staff, a removed member, a deleted account and another gym's member are not on it",
    async () => {
      const g = await gym("Asia/Kolkata");
      const other = await gym("Asia/Kolkata");
      const days = ["2026-10-05T02:00:00Z", "2026-10-06T02:00:00Z", "2026-10-07T02:00:00Z"];
      const add = async (name: string, count: number, status: "active" | "deleted" = "active"): Promise<string> => {
        const id = await person(name, status);
        for (const at of days.slice(0, count)) await workout(id, at);
        return id;
      };
      const viewer = await add("Vera Viewer", 1);
      const top = await add("Chen Wu", 3);
      const tieB = await add("Bilal Khan", 2);
      const tieA = await add("Asha Rao", 2);
      for (const id of [viewer, top, tieB, tieA]) await join(g.id, id);
      const removed = await add("Rex Removed", 3);
      await join(g.id, removed, JOINED, "2026-10-06T00:00:00Z");
      const deleted = await add("Dee Deleted", 3, "deleted");
      await join(g.id, deleted);
      const elsewhere = await add("Eli Elsewhere", 3);
      await join(other.id, elsewhere);
      // The owner trains here too.
      await join(g.id, g.ownerId);
      for (const at of days) await workout(g.ownerId, at);

      const got = await read(g.id, viewer, "this_week");
      expect(got.board.status).toBe("shown");
      expect(got.board.rows.map((r) => [r.name, r.place, r.value])).toEqual([
        ["Chen W.", 1, 3],
        ["Asha R.", 2, 2],
        ["Bilal K.", 2, 2],
        ["Vera V.", 4, 1],
      ]);
      expect(got.board.ranked).toBe(4);
      expect(got.board.me).toMatchObject({ value: 1, place: 4, toNextPlace: 1, nextPlace: 2, hidden: null });
      expect((await read(g.id, g.ownerId, "this_week")).board.me).toMatchObject({ value: 3, hidden: "staff" });
      // Other members' rows carry days, never a time.
      expect(JSON.stringify(got.board.rows)).not.toMatch(/T\d\d:\d\d/);
    },
    T,
  );

  it(
    "fewer than three people is no board; a gym that checks nobody in still has this one; a lapsed gym has none",
    async () => {
      const g = await gym("Asia/Kolkata");
      const people = [await person("Ann One"), await person("Bob Two"), await person("Cy Three")];
      for (const id of people) await join(g.id, id);
      const viewer = people[0] ?? "";
      await workout(people[0] ?? "", "2026-10-06T02:00:00Z");
      await workout(people[1] ?? "", "2026-10-06T02:00:00Z");
      const two = await read(g.id, viewer, "this_week");
      expect([two.board.status, two.board.rows, two.board.ranked, two.board.me.place]).toEqual(["too_few", [], 0, null]);

      // The gym has never checked anybody in: Gym days says so, Workout days shows.
      await workout(people[2] ?? "", "2026-10-06T02:00:00Z");
      const deps = { sql, now: () => NOW };
      expect((await read(g.id, viewer, "this_week")).board.status).toBe("shown");
      expect((await getLeaderboard(deps, viewer, g.id, { board: "gym_days", period: "this_week" })).status).toBe("no_checkins");

      const lapsed = await gym("Asia/Kolkata", false);
      for (const id of people) await join(lapsed.id, id);
      const none = await read(lapsed.id, viewer, "this_week");
      expect([none.board.status, none.board.rows, none.board.me.place]).toEqual(["paused", [], null]);
    },
    T,
  );
});
