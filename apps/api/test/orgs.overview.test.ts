// THE GYM'S NUMBERS — the nightly rollup and `GET /v1/orgs/:gymId/overview`,
// against REAL Postgres (R9.2). DATABASE_URL-gated.
//
// Kd's rulings: :26469 (the gym's numbers are ATTENDANCE numbers · three tiles ·
// "trained anywhere" is never shown · every figure counts only people who were
// PRESENT), :29961 (the tiles count VISITS not workouts · a workout counts for a
// gym on the SAME GYM-DAY as the visit · the card splits numbers-then-lists),
// :27992 §1 (a second visit in a different session counts again) and §3 (the
// counts come from the SERVER).
//
// THE SEVEN THINGS THIS FILE EXISTS TO PIN, most of them guarantees rather than
// features — they would pass silently if they broke:
//
//   1. **RULING 2 HAS THREE WAYS TO BE WRONG AND ALL THREE ARE DRIVEN.** A
//      workout WITH a same-day visit counts; the SAME workout with the visit on
//      another day does not; and a workout by somebody whose membership had
//      already ended does not. A test that only asserted the first would pass
//      with the whole predicate deleted.
//
//   2. **`visits` AND `visitors` MUST DIVERGE IN THE FIXTURE.** They are equal
//      for every gym where nobody comes twice, so a fixture of one-visit members
//      cannot tell `count(*)` from `count(DISTINCT user_id)` — which is the
//      exact mutant this card is most likely to survive (:29961 §6.2). Somebody
//      attends two sessions in one day, on purpose, in both the rollup's
//      assertions and the route's.
//
//   3. **THE HOUR FILTER IS DRIVEN IN BOTH DIRECTIONS FROM ONE RUN.** A filter
//      that is silently inert passes any test whose fixture can only produce one
//      answer (:28649), so a single run holds a gym at 02:xx local and a gym at
//      20:xx local and asserts one row set and not the other.
//
//   4. **THE GYM'S DAY, NOT THE SERVER'S.** The workout-to-day bucketing is
//      driven on a UTC+14 gym at an instant whose UTC date is the day BEFORE its
//      local one, so a rollup that dropped `AT TIME ZONE` credits the wrong day
//      and the assertion fails. :26812 §2(a)'s scar, applied.
//
//   5. **IDEMPOTENCE IS ASSERTED COLUMN BY COLUMN** (R3.5), not by a row count:
//      a job that doubled `sets` while writing the same number of rows is
//      exactly the failure a count cannot see.
//
//   6. **A LATE-SYNCED WORKOUT IS PICKED UP**, which is the whole reason the
//      window is seven days rather than one. The fixture rolls a day, then
//      inserts a workout dated inside it, then rolls again.
//
//   7. **ADOPTION IS NULL AND NOT ZERO FOR A GYM WITH NO MEMBERS** (:8267's
//      class), and its two halves are counted over the SAME population so the
//      ratio cannot exceed 100%.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { rollUpGymDays } from "../src/modules/orgs/rollup.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "orgovw-test-secret-0123456789abc", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;

const TEST_TIMEOUT_MS = 30_000;
const HOOK_TIMEOUT_MS = 60_000;

let ipCounter = 0;
const nextIp = () =>
  `10.19.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

/** The attendance suite's reasoning: every gym here goes on a live plan because
 *  a gym without one refuses the console writes these fixtures need.
 *  `trial_days = 0` keeps it invisible to `startGymTrial`'s lowest-capped query
 *  so the billing suites' band assertions are undisturbed. */
const LIVE_PLAN = "zz_ovw_live";

const noopLog = { info: () => undefined };

interface CreatedOrg {
  org: { id: string; slug: string; name: string; timezone: string };
  joinCode: { code: string; label: string };
}

interface Overview {
  timezone: string;
  today: string;
  tiles: {
    today: { visits: number; visitors: number };
    week: { visits: number; visitors: number; prevVisits: number; prevVisitors: number };
    month: { visitors: number; members: number; adoptionPct: number | null };
  };
  weeks: { weekStart: string; visits: number; visitors: number }[];
}

interface StatsRow {
  day: string;
  visits: number;
  visitors: number;
  active_members: number;
  workouts: number;
  sets: number;
  total_reps: number;
  minutes: number;
  avg_form_score: string | null;
  scored_sets: number;
  new_members: number;
  removed_members: number;
}

d("gym overview numbers (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'orgovw-t-%@example.com')`;
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'orgovw-t-%@example.com'`;
    // The attendance suite's order and its reason: no cascade on the actor FKs,
    // so a stray child blocks the parent DELETE with a 23503 naming nothing
    // useful (:10726 Low-2).
    await sql`UPDATE gyms SET hours_mode = 'unset' WHERE id IN (${mine})`;
    await sql`DELETE FROM org_daily_stats WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM workout_sets WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM workouts WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM gym_attendance WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_attendance WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM gym_hours WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_closures WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM streaks WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM user_achievements WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM user_xp WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'orgovw-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const post = (path: string, payload: unknown, cookies: Record<string, string> = {}) =>
    api().inject({
      method: "POST",
      url: path,
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      cookies,
      payload: JSON.stringify(payload),
    });

  const get = (path: string, cookies: Record<string, string> = {}) =>
    api().inject({ method: "GET", url: path, remoteAddress: nextIp(), cookies });

  const makeUser = async (local: string) => {
    const email = `orgovw-t-${local}@example.com`;
    const reg = await api().inject({
      method: "POST",
      url: "/v1/auth/register",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email, password: PASSWORD, displayName: `Ovw ${local}` }),
    });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await api().inject({
      method: "POST",
      url: "/v1/auth/login",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email, password: PASSWORD }),
    });
    expect(login.statusCode).toBe(200);
    return { userId, email, cookies: cookieMap(login) };
  };

  const subscribeGym = async (gymId: string) => {
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gymId}`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
  };

  const makeOrg = async (
    cookies: Record<string, string>,
    name: string,
    timezone = "Asia/Kolkata",
  ): Promise<CreatedOrg> => {
    const res = await post("/v1/orgs", { name, city: "Jorhat", country: "IN", timezone }, cookies);
    expect(res.statusCode).toBe(201);
    const created = JSON.parse(res.body) as CreatedOrg;
    await subscribeGym(created.org.id);
    return created;
  };

  const joinAsMember = async (
    memberCookies: Record<string, string>,
    org: CreatedOrg,
    staffCookies: Record<string, string>,
  ) => {
    const applied = await post("/v1/orgs/join", { code: org.joinCode.code }, memberCookies);
    expect(applied.statusCode).toBe(200);
    const body = JSON.parse(applied.body) as { application?: { id: string } };
    const id = body.application?.id;
    if (id === undefined) throw new Error("apply returned no application");
    const confirm = await post(
      `/v1/orgs/${org.org.id}/applications/${id}/confirm`,
      {},
      staffCookies,
    );
    expect(confirm.statusCode).toBe(200);
  };

  /** EVERY INSTANT AND EVERY DATE IN THIS FILE COMES FROM THE DATABASE.
   *
   *  **A literal like `2026-09-20` would be a bomb with a fuse** (:25008's
   *  class): these fixtures create their gyms NOW, the rollup deliberately never
   *  writes a day before a gym existed, and a suite run a year from now against
   *  a hardcoded date would silently roll nothing and report it as a pass. So
   *  the base instant is `now()` plus a fortnight, read from Postgres, and every
   *  day is derived from it in SQL. */
  const dbNow = async (): Promise<Date> => {
    const rows = await sql<{ n: Date }[]>`SELECT now() AS n`;
    const row = rows[0];
    if (row === undefined) throw new Error("no now()");
    return row.n;
  };

  /** The gym's own local date at `at`, minus `back` days — asked of the database
   *  and never computed here, for the attendance suite's recorded reason: a
   *  `new Date()` in this file is the TEST RUNNER's clock, which is the
   *  SERVER's, so an assertion built on it agrees with a broken server-zone
   *  implementation and disagrees with a correct one. */
  const gymDay = async (gymId: string, at: Date, back = 0): Promise<string> => {
    const rows = await sql<{ d: string }[]>`
      SELECT ((${at}::timestamptz AT TIME ZONE timezone)::date - ${back}::int)::text AS d
      FROM gyms WHERE id = ${gymId}`;
    const row = rows[0];
    if (row === undefined) throw new Error("no such gym");
    return row.d;
  };

  /** An instant at which the gym's local clock reads `hour`, on the local day
   *  `back` days after its local date at `from`. Used to drive the 02:00 filter
   *  from both sides in one run. */
  const gymLocalInstant = async (gymId: string, from: Date, hour: number): Promise<Date> => {
    const rows = await sql<{ t: Date }[]>`
      SELECT ((((${from}::timestamptz AT TIME ZONE timezone)::date)::timestamp
               + make_interval(hours => ${hour}::int) + interval '15 minutes')
              AT TIME ZONE timezone) AS t
      FROM gyms WHERE id = ${gymId}`;
    const row = rows[0];
    if (row === undefined) throw new Error("no such gym");
    return row.t;
  };

  /** A VISIT WRITTEN STRAIGHT INTO THE TABLE, because the route can only ever
   *  mark TODAY and every day this file cares about is in the past relative to
   *  the instant the rollup is given. The columns satisfy
   *  `gym_attendance_slot_key_agrees_check` by construction: an `in_session` row
   *  carries its window and a key derived from it, everything else carries the
   *  status name as the key. */
  const visit = async (
    gymId: string,
    userId: string,
    day: string,
    session?: { opens: number; closes: number },
  ) => {
    if (session === undefined) {
      await sql`
        INSERT INTO gym_attendance
          (gym_id, user_id, marked_by_user_id, day, method, hours_status, slot_key)
        VALUES (${gymId}, ${userId}, ${userId}, ${day}::date, 'manual', 'hours_unset',
                'hours_unset')`;
      return;
    }
    const key = `${String(session.opens)}-${String(session.closes)}`;
    await sql`
      INSERT INTO gym_attendance
        (gym_id, user_id, marked_by_user_id, day, method, hours_status,
         session_opens_minute, session_closes_minute, slot_key)
      VALUES (${gymId}, ${userId}, ${userId}, ${day}::date, 'manual', 'in_session',
              ${session.opens}, ${session.closes}, ${key})`;
  };

  /** A workout at an INSTANT, with optional scored sets. `startedAt` is a real
   *  timestamptz so the rollup's `AT TIME ZONE` has something to get wrong. */
  const workout = async (
    userId: string,
    startedAt: Date,
    opts: { sets: number; reps: number; minutes: number; formScores?: number[] },
  ): Promise<string> => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO workouts
        (id, user_id, started_at, platform, engine_version, sets_count, total_reps, duration_ms)
      VALUES (gen_random_uuid(), ${userId}, ${startedAt}, 'web', 'test-1.0',
              ${opts.sets}, ${opts.reps}, ${opts.minutes * 60000})
      RETURNING id`;
    const row = rows[0];
    if (row === undefined) throw new Error("workout insert returned nothing");
    const scores = opts.formScores ?? [];
    for (const [i, score] of scores.entries()) {
      await sql`
        INSERT INTO workout_sets
          (workout_id, user_id, exercise_id, started_at, set_index, reps, duration_ms,
           mode, engine_version, definition_version, avg_form_score)
        VALUES (${row.id}, ${userId}, (SELECT id FROM exercises ORDER BY slug LIMIT 1),
                ${startedAt}, ${i}, 10, 60000,
                -- workout_sets_engine_provenance_check: a set carrying a form
                -- score is one the ENGINE graded, so it must say which engine and
                -- which definition did the grading. A fixture that skipped this
                -- was refused by the database, which is the constraint working.
                'engine', 'test-1.0', 1, ${score})`;
    }
    return row.id;
  };

  const statsFor = async (gymId: string): Promise<StatsRow[]> =>
    await sql<StatsRow[]>`
      SELECT day::text AS day, visits, visitors, active_members, workouts, sets,
             total_reps, minutes, avg_form_score, scored_sets, new_members, removed_members
      FROM org_daily_stats WHERE gym_id = ${gymId} ORDER BY day`;

  const dayRow = (rows: StatsRow[], day: string): StatsRow => {
    const row = rows.find((r) => r.day === day);
    if (row === undefined) {
      throw new Error(`no org_daily_stats row for ${day} (have ${rows.map((r) => r.day).join()})`);
    }
    return row;
  };

  const readOverview = async (
    gymId: string,
    cookies: Record<string, string>,
  ): Promise<Overview> => {
    const res = await get(`/v1/orgs/${gymId}/overview`, cookies);
    expect(res.statusCode).toBe(200);
    return (JSON.parse(res.body) as { overview: Overview }).overview;
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval,
                         seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month',
              100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv));
    await api().ready();
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, HOOK_TIMEOUT_MS);

  // -------------------------------------------------------------------------
  // THE ROLLUP
  // -------------------------------------------------------------------------

  it(
    "writes a finished day: two sessions is TWO visits and ONE visitor",
    async () => {
      const owner = await makeUser("r1-owner");
      const member = await makeUser("r1-member");
      const other = await makeUser("r1-other");
      const org = await makeOrg(owner.cookies, "Rollup Two Sessions");
      await joinAsMember(member.cookies, org, owner.cookies);
      await joinAsMember(other.cookies, org, owner.cookies);

      const at = new Date((await dbNow()).getTime() + 14 * 24 * 3600 * 1000);
      const yesterday = await gymDay(org.org.id, at, 1);

      // THE DIVERGENCE IS THE POINT (header #2): one member comes to two
      // sessions, another comes once. 3 visits, 2 visitors — numbers a fixture
      // of one-visit members could never tell apart.
      await visit(org.org.id, member.userId, yesterday, { opens: 360, closes: 420 });
      await visit(org.org.id, member.userId, yesterday, { opens: 1020, closes: 1200 });
      await visit(org.org.id, other.userId, yesterday, { opens: 360, closes: 420 });

      const result = await rollUpGymDays(
        { sql, log: noopLog },
        { now: at, gymIds: [org.org.id], allHours: true, days: 7 },
      );
      expect(result.gyms).toBe(1);
      expect(result.rows).toBe(7);

      const row = dayRow(await statsFor(org.org.id), yesterday);
      expect(row.visits).toBe(3);
      expect(row.visitors).toBe(2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "counts a workout for the gym ONLY when the member was present that day and a member that day",
    async () => {
      const owner = await makeUser("r2-owner");
      const present = await makeUser("r2-present");
      const elsewhere = await makeUser("r2-elsewhere");
      const gone = await makeUser("r2-gone");
      const org = await makeOrg(owner.cookies, "Rollup Ruling Two");
      await joinAsMember(present.cookies, org, owner.cookies);
      await joinAsMember(elsewhere.cookies, org, owner.cookies);
      await joinAsMember(gone.cookies, org, owner.cookies);

      const at = new Date((await dbNow()).getTime() + 14 * 24 * 3600 * 1000);
      const day = await gymDay(org.org.id, at, 1);
      // Noon in the gym's own zone, so the instant lands squarely inside the
      // local day whichever zone the server is in.
      const noon = await gymLocalInstant(org.org.id, at, 11);
      const noonYesterday = new Date(noon.getTime() - 24 * 3600 * 1000);

      // (a) CAME AND TRAINED — counts.
      await visit(org.org.id, present.userId, day);
      await workout(present.userId, noonYesterday, { sets: 3, reps: 30, minutes: 45 });

      // (b) TRAINED, NEVER CAME IN — does not count. This is the half :26469 §1.3
      //     is about: a gym is never shown what a member did away from it.
      await workout(elsewhere.userId, noonYesterday, { sets: 9, reps: 99, minutes: 99 });

      // (c) CAME AND TRAINED, BUT THE MEMBERSHIP HAD ALREADY ENDED — does not
      //     count. The visit row is written directly because the mark route
      //     could not have produced it, which is exactly why the membership
      //     condition is kept beside the presence one.
      await visit(org.org.id, gone.userId, day);
      await workout(gone.userId, noonYesterday, { sets: 7, reps: 77, minutes: 77 });
      await sql`
        UPDATE gym_members SET removed_at = ${noonYesterday} - interval '2 days'
        WHERE gym_id = ${org.org.id} AND user_id = ${gone.userId}`;

      await rollUpGymDays(
        { sql, log: noopLog },
        { now: at, gymIds: [org.org.id], allHours: true, days: 7 },
      );

      const row = dayRow(await statsFor(org.org.id), day);
      expect(row.visits).toBe(2);
      expect(row.visitors).toBe(2);
      // ONE workout — (a) only. If the attendance join were deleted, (b) would
      // land here; if the membership interval were deleted, (c) would.
      expect(row.workouts).toBe(1);
      expect(row.active_members).toBe(1);
      expect(row.sets).toBe(3);
      expect(row.total_reps).toBe(30);
      expect(row.minutes).toBe(45);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "credits a workout to the GYM's day, not the server's, on a UTC+14 gym",
    async () => {
      const owner = await makeUser("r3-owner");
      const member = await makeUser("r3-member");
      // UTC+14. The attendance suite's finding: a single non-UTC zone is not
      // enough on its own, but the assertion below is built at an instant whose
      // UTC date is deliberately the day BEFORE the gym's, which is what a
      // dropped `AT TIME ZONE` gets wrong.
      const org = await makeOrg(owner.cookies, "Rollup Far East", "Pacific/Kiritimati");
      await joinAsMember(member.cookies, org, owner.cookies);

      const at = new Date((await dbNow()).getTime() + 14 * 24 * 3600 * 1000);
      const day = await gymDay(org.org.id, at, 1);
      // 01:15 LOCAL on that day. In UTC+14 that instant is 11:15 on the PREVIOUS
      // UTC date, so a rollup bucketing by the server's date credits the wrong
      // day and the row below reads zero.
      const localEarly = await gymLocalInstant(org.org.id, at, 1);
      const startedAt = new Date(localEarly.getTime() - 24 * 3600 * 1000);

      const utcDate = startedAt.toISOString().slice(0, 10);
      expect(utcDate).not.toBe(day); // the fixture is only meaningful if these differ

      await visit(org.org.id, member.userId, day);
      await workout(member.userId, startedAt, { sets: 2, reps: 20, minutes: 30 });

      await rollUpGymDays(
        { sql, log: noopLog },
        { now: at, gymIds: [org.org.id], allHours: true, days: 7 },
      );

      const rows = await statsFor(org.org.id);
      expect(dayRow(rows, day).workouts).toBe(1);
      const strayRow = rows.find((r) => r.day === utcDate);
      expect(strayRow?.workouts ?? 0).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "rolls only the gyms whose OWN clock is in the 02:00 hour, in one run",
    async () => {
      const owner = await makeUser("r4-owner");
      // Two zones 5.5 hours apart, so one instant cannot be 02:xx in both.
      const early = await makeOrg(owner.cookies, "Rollup At Two", "Asia/Kolkata");
      const late = await makeOrg(owner.cookies, "Rollup Not At Two", "UTC");

      const at = new Date((await dbNow()).getTime() + 14 * 24 * 3600 * 1000);
      // An instant at which Kolkata reads 02:15. UTC then reads 20:45.
      const atTwoInKolkata = await gymLocalInstant(early.org.id, at, 2);
      const hours = await sql<{ e: number; l: number }[]>`
        SELECT EXTRACT(HOUR FROM (${atTwoInKolkata}::timestamptz AT TIME ZONE 'Asia/Kolkata'))::int AS e,
               EXTRACT(HOUR FROM (${atTwoInKolkata}::timestamptz AT TIME ZONE 'UTC'))::int AS l`;
      // The fixture states its own premise rather than assuming it (:7104's PG1).
      expect(hours[0]?.e).toBe(2);
      expect(hours[0]?.l).not.toBe(2);

      const result = await rollUpGymDays(
        { sql, log: noopLog },
        { now: atTwoInKolkata, gymIds: [early.org.id, late.org.id], days: 3 },
      );
      expect(result.gyms).toBe(1);
      expect(result.rows).toBe(3);

      expect((await statsFor(early.org.id)).length).toBe(3);
      // THE OTHER HALF. Deleting the hour filter makes this 3 and the run above
      // touch two gyms — the direction a one-gym fixture cannot see.
      expect((await statsFor(late.org.id)).length).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "is idempotent COLUMN BY COLUMN, not merely in its row count",
    async () => {
      const owner = await makeUser("r5-owner");
      const member = await makeUser("r5-member");
      const org = await makeOrg(owner.cookies, "Rollup Idempotent");
      await joinAsMember(member.cookies, org, owner.cookies);

      const at = new Date((await dbNow()).getTime() + 14 * 24 * 3600 * 1000);
      const day = await gymDay(org.org.id, at, 1);
      const noon = new Date((await gymLocalInstant(org.org.id, at, 11)).getTime() - 24 * 3600 * 1000);
      await visit(org.org.id, member.userId, day, { opens: 360, closes: 420 });
      await workout(member.userId, noon, { sets: 4, reps: 40, minutes: 20, formScores: [80, 90] });

      const opts = { now: at, gymIds: [org.org.id], allHours: true, days: 7 } as const;
      await rollUpGymDays({ sql, log: noopLog }, opts);
      const first = await statsFor(org.org.id);
      await rollUpGymDays({ sql, log: noopLog }, opts);
      const second = await statsFor(org.org.id);

      // A job that DOUBLED sets while writing the same number of rows passes a
      // row-count assertion and fails this one.
      expect(second).toEqual(first);
      const row = dayRow(second, day);
      expect(row.sets).toBe(4);
      expect(row.scored_sets).toBe(2);
      expect(Number(row.avg_form_score)).toBe(85);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "picks up a workout that synced LATE, which is why the window is seven days",
    async () => {
      const owner = await makeUser("r6-owner");
      const member = await makeUser("r6-member");
      const org = await makeOrg(owner.cookies, "Rollup Late Sync");
      await joinAsMember(member.cookies, org, owner.cookies);

      const at = new Date((await dbNow()).getTime() + 14 * 24 * 3600 * 1000);
      const day = await gymDay(org.org.id, at, 4);
      const noon = new Date(
        (await gymLocalInstant(org.org.id, at, 11)).getTime() - 4 * 24 * 3600 * 1000,
      );
      await visit(org.org.id, member.userId, day);

      const opts = { now: at, gymIds: [org.org.id], allHours: true, days: 7 } as const;
      await rollUpGymDays({ sql, log: noopLog }, opts);
      expect(dayRow(await statsFor(org.org.id), day).workouts).toBe(0);

      // The phone comes back online four days later (R10.3).
      await workout(member.userId, noon, { sets: 5, reps: 50, minutes: 25 });
      await rollUpGymDays({ sql, log: noopLog }, opts);

      const row = dayRow(await statsFor(org.org.id), day);
      expect(row.workouts).toBe(1);
      expect(row.sets).toBe(5);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "never writes a day before the gym existed, and never writes today",
    async () => {
      const owner = await makeUser("r7-owner");
      const org = await makeOrg(owner.cookies, "Rollup Young Gym");

      // TWO days after creation, asking for a SEVEN-day window: only the days
      // the gym has actually lived through may be written. A row of zeros is a
      // positive statement ("recorded, nothing happened"), and making it about a
      // week before the gym was created is simply false.
      const at = new Date((await dbNow()).getTime() + 2 * 24 * 3600 * 1000);
      const today = await gymDay(org.org.id, at, 0);

      const result = await rollUpGymDays(
        { sql, log: noopLog },
        { now: at, gymIds: [org.org.id], allHours: true, days: 7 },
      );
      expect(result.rows).toBeLessThanOrEqual(3);
      expect(result.rows).toBeGreaterThanOrEqual(2);

      const rows = await statsFor(org.org.id);
      // TODAY IS NEVER WRITTEN: it is still being lived in, and a partial day
      // that looks whole is the false number the live reader exists to avoid.
      expect(rows.some((r) => r.day === today)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "records who joined and who left on the day it happened",
    async () => {
      const owner = await makeUser("r8-owner");
      const joiner = await makeUser("r8-joiner");
      const leaver = await makeUser("r8-leaver");
      const org = await makeOrg(owner.cookies, "Rollup Roster Moves");
      await joinAsMember(joiner.cookies, org, owner.cookies);
      await joinAsMember(leaver.cookies, org, owner.cookies);

      const at = new Date((await dbNow()).getTime() + 14 * 24 * 3600 * 1000);
      const day = await gymDay(org.org.id, at, 3);
      const noon = new Date(
        (await gymLocalInstant(org.org.id, at, 11)).getTime() - 3 * 24 * 3600 * 1000,
      );
      await sql`
        UPDATE gym_members SET joined_at = ${noon}
        WHERE gym_id = ${org.org.id} AND user_id = ${joiner.userId}`;
      await sql`
        UPDATE gym_members SET removed_at = ${noon}
        WHERE gym_id = ${org.org.id} AND user_id = ${leaver.userId}`;

      await rollUpGymDays(
        { sql, log: noopLog },
        { now: at, gymIds: [org.org.id], allHours: true, days: 7 },
      );

      const row = dayRow(await statsFor(org.org.id), day);
      expect(row.new_members).toBe(1);
      expect(row.removed_members).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  // -------------------------------------------------------------------------
  // THE ROUTE
  // -------------------------------------------------------------------------

  it(
    "serves the tiles and eight weeks, oldest first, with empty weeks drawn as zero",
    async () => {
      const owner = await makeUser("o1-owner");
      const member = await makeUser("o1-member");
      const other = await makeUser("o1-other");
      const org = await makeOrg(owner.cookies, "Overview Tiles");
      await joinAsMember(member.cookies, org, owner.cookies);
      await joinAsMember(other.cookies, org, owner.cookies);

      const now = await dbNow();
      const today = await gymDay(org.org.id, now, 0);

      // Today: one member twice, one member once — 3 visits, 2 visitors, and the
      // two numbers diverge (header #2).
      await visit(org.org.id, member.userId, today, { opens: 360, closes: 420 });
      await visit(org.org.id, member.userId, today, { opens: 1020, closes: 1200 });
      await visit(org.org.id, other.userId, today, { opens: 360, closes: 420 });

      const overview = await readOverview(org.org.id, owner.cookies);

      expect(overview.today).toBe(today);
      expect(overview.timezone).toBe("Asia/Kolkata");
      expect(overview.tiles.today.visits).toBe(3);
      expect(overview.tiles.today.visitors).toBe(2);
      // The week contains today, so it is at least today's figures.
      expect(overview.tiles.week.visits).toBe(3);
      expect(overview.tiles.week.visitors).toBe(2);
      expect(overview.tiles.month.visitors).toBe(2);
      // Two joined members; the owner's complimentary seat is excluded.
      expect(overview.tiles.month.members).toBe(2);
      expect(overview.tiles.month.adoptionPct).toBe(100);

      // EIGHT WEEKS, ALWAYS, OLDEST FIRST. A week nobody came to must draw a
      // zero bar rather than vanish and shift every other bar left.
      expect(overview.weeks.length).toBe(8);
      const starts = overview.weeks.map((w) => w.weekStart);
      expect([...starts].sort()).toEqual(starts);
      expect(overview.weeks.slice(0, 7).every((w) => w.visits === 0)).toBe(true);
      const current = overview.weeks[7];
      expect(current?.visits).toBe(3);
      expect(current?.visitors).toBe(2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "answers adoption as NULL, never 0%, for a gym nobody has joined",
    async () => {
      const owner = await makeUser("o2-owner");
      const org = await makeOrg(owner.cookies, "Overview Empty Gym");

      const overview = await readOverview(org.org.id, owner.cookies);
      expect(overview.tiles.month.members).toBe(0);
      expect(overview.tiles.month.visitors).toBe(0);
      // NULL and not 0: "no adoption to state" is a different sentence from
      // "nobody is using it", and printing the second on a gym's first day is
      // the :8267 class this card is most likely to ship.
      expect(overview.tiles.month.adoptionPct).toBeNull();
      expect(overview.tiles.today.visits).toBe(0);
      expect(overview.weeks.length).toBe(8);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuses a stranger's gym with 404 and a staffer whose attendance tick is OFF with 403",
    async () => {
      const owner = await makeUser("o3-owner");
      const stranger = await makeUser("o3-stranger");
      const manager = await makeUser("o3-manager");
      const org = await makeOrg(owner.cookies, "Overview Authz");

      // R3.2's cross-tenant denial: a gym this person has nothing to do with.
      const foreign = await get(`/v1/orgs/${org.org.id}/overview`, stranger.cookies);
      expect(foreign.statusCode).toBe(404);

      // STAFF ARE PROMOTED MEMBERS, never strangers: `addStaff` answers
      // `not_a_member` to an email that has not joined (:14401 — requiring a
      // membership wherever authority is decided).
      await joinAsMember(manager.cookies, org, owner.cookies);
      const added = await post(
        `/v1/orgs/${org.org.id}/staff`,
        { email: manager.email, role: "manager" },
        owner.cookies,
      );
      expect(added.statusCode).toBe(201);

      // BOTH DIRECTIONS (:28107 §2's own lesson): by default a manager reads it,
      // and the owner unticking the box is what takes it away. A test that only
      // proved the refusal would pass with the default broken.
      const byDefault = await get(`/v1/orgs/${org.org.id}/overview`, manager.cookies);
      expect(byDefault.statusCode).toBe(200);

      await sql`
        UPDATE gym_staff SET privileges = array_remove(privileges, 'attendance.read')
        WHERE gym_id = ${org.org.id} AND user_id = ${manager.userId}`;
      await sql`
        UPDATE gym_staff
        SET privileges = ARRAY['members.read','codes.invite']::text[]
        WHERE gym_id = ${org.org.id} AND user_id = ${manager.userId}
          AND privileges IS NULL`;

      const unticked = await get(`/v1/orgs/${org.org.id}/overview`, manager.cookies);
      expect(unticked.statusCode).toBe(403);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuses a malformed gym id as a 400 and an anonymous caller as a 401",
    async () => {
      const anon = await get("/v1/orgs/00000000-0000-0000-0000-000000000000/overview");
      expect(anon.statusCode).toBe(401);

      const owner = await makeUser("o4-owner");
      const bad = await get("/v1/orgs/not-a-uuid/overview", owner.cookies);
      // A non-uuid must fail at the boundary as a 400, never as a 500 from
      // Postgres refusing the cast.
      expect(bad.statusCode).toBe(400);
    },
    TEST_TIMEOUT_MS,
  );
});
