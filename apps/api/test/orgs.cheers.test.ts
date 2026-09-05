// "ON A ROLL" AND THE CHEER — routes + repo against REAL Postgres (R9.2).
// DATABASE_URL-gated. Kd's rulings: :29961 ruling 4 (an emoji plus a ready-made
// line, ONE TAP, no free-text box) and his 2026-09-04 answer at this card's
// gate, *"both weeks and days run"*. **THE CAP IS ONE PER MEMBER PER GYM-DAY
// since :35762** — his own reversal of the "one per week" half, made at the
// screen; Part 3 §4.1's `1/member/7d` is the AT-RISK NUDGE and is untouched.
//
// THE SEVEN THINGS THIS FILE EXISTS TO PIN, because most are guarantees rather
// than features and would pass silently if they broke:
//
//   1. **BOTH STREAK FIGURES, ON A FIXTURE WHERE THEY DISAGREE.** A member who
//      comes once a week for four weeks reads `weeksRunning: 4, daysRunning: 1`;
//      one who came three days running reads 3 and 3. **A fixture where the two
//      move together cannot see one being computed from the other**, which is
//      :30399 §6's C155 — a test whose fixture made the defect and the fix
//      indistinguishable, and which passed under the mutation.
//
//   2. **THE GYM'S FIGURE IS NOT THE MEMBER'S OWN STREAK, AND THE DIVERGENCE IS
//      ASSERTED RATHER THAN ASSUMED.** `getStreakDays` unions workouts from
//      everywhere AND spends Part 7 §3.2 freezes, so it reports days nobody
//      attended. The gapped member below carries a `streaks` row saying 4 while
//      this gym's honest answer is 2. **This is the test that stops a later chat
//      "simplifying" `getGymRegulars` into a call to `replayActivityDays`.**
//
//   3. **THE CAP HAS TWO DIRECTIONS AND BOTH ARE DRIVEN.** A guard whose only
//      tested failure is "it did not fire" is satisfied by a door that is simply
//      shut (:7104's PG1), so a cheer on the NEXT gym-day must SUCCEED beside
//      the second one the same day that is refused.
//
//   3a. **AND THE DAY IS THE GYM'S DAY, PROVEN IN A ZONE WHERE THAT DIFFERS
//      FROM UTC's** — chosen at run time, because in any fixed zone the two
//      agree for most of the day and the mutant would live or die by the clock
//      (:13746). This is trap #8 and the one defect this cap can carry while
//      looking correct in every test written from the server's own timezone.
//
//   4. **TENANCY ON A FIXTURE OF TWO GYMS AND TWO MEMBERSHIPS.** :28221 §3b is
//      this repo's recorded scar: with one membership a missing `gym_id`
//      predicate leaks nothing and the mutant cannot die. The observer here is a
//      member of BOTH gyms — an ordinary user of this product, not an edge case.
//
//   5. **A 404 TEST AND A SCOPING TEST ARE DIFFERENT TESTS** (:28221 §3a). A
//      stranger is refused, AND an authorised owner's own list is checked for
//      the other gym's visits, because a route can refuse the outsider and still
//      leak into the owner.
//
//   6. **THE ALIVENESS BOUND AND THE FLOOR, EACH FROM BOTH SIDES.** A member who
//      stopped three weeks ago is ABSENT; one with a single week is absent by
//      `ON_A_ROLL_MIN_WEEKS`; and somebody who qualifies is PRESENT — a list
//      that excluded everybody would pass every absence assertion here.
//
//   7. **THE WRITE DOOR IS A WRITE DOOR.** A lapsed gym and an archived gym are
//      refused by gates that already existed (:23711), and a live one is not —
//      the third arm being what stops the gate reading as a door that is simply
//      shut.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { GYM_CHEER_PRESETS, ON_A_ROLL_MIN_WEEKS } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import * as orgRepo from "../src/modules/orgs/repo.js";

/** THE ORGS REPO MUST NOT REACH INTO `gamification/`, AND THIS IS THE ONLY
 *  INSTRUMENT THAT CAN SAY SO.
 *
 *  The behavioural test below proves today's answer is right; **it cannot prove
 *  the next author will not "simplify" `getGymRegulars` into a call to
 *  `replayActivityDays`**, which would be right on a fixture with no gaps and
 *  wrong for every member who has ever missed a day and banked a freeze.
 *
 *  This runs OUTSIDE the DATABASE_URL gate deliberately: it is a fact about the
 *  source, so it must not go quiet on a machine with no Postgres — which is
 *  exactly how a guard nobody notices stops running (:5199's class).
 *
 *  It is a source grep and its limit is a source grep's: it sees an import, not
 *  a copy-paste of the freeze arithmetic. What it covers is the shortcut
 *  somebody would actually take. */
describe("the orgs repo does not borrow the member's own streak", () => {
  it("imports nothing from gamification", () => {
    const src = readFileSync(new URL("../src/modules/orgs/repo.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/from\s+["'][^"']*gamification/);
    // A POSITIVE CONTROL, so a rename of the module cannot make this vacuous:
    // the file really does import from SOMEWHERE, and the pattern really does
    // match that shape.
    expect(src).toMatch(/from\s+["'][^"']*@app\/shared["']/);
  });
});

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "orgcheer-test-secret-0123456789ab", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;

const TEST_TIMEOUT_MS = 30_000;
const HOOK_TIMEOUT_MS = 60_000;

let ipCounter = 0;
const nextIp = () =>
  `10.31.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

/** The attendance suite's reasoning: every gym here goes on a live plan because
 *  a gym without one refuses the console WRITE this card adds. `trial_days = 0`
 *  keeps it invisible to `startGymTrial`'s lowest-capped query so the billing
 *  suites' band assertions are undisturbed. */
const LIVE_PLAN = "zz_cheer_live";

interface CreatedOrg {
  org: { id: string; slug: string; name: string; timezone: string };
  joinCode: { code: string; label: string };
}

interface Regular {
  userId: string;
  displayName: string;
  weeksRunning: number;
  daysRunning: number;
  visits: number;
  cheerableAt: string | null;
}

interface Overview {
  timezone: string;
  today: string;
  onARoll: Regular[];
}

d("gym cheers and the on-a-roll list (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'orgcheer-t-%@example.com')`;
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'orgcheer-t-%@example.com'`;
    // The attendance suite's order and its reason: no cascade on the actor FKs,
    // so a stray child blocks the parent DELETE with a 23503 naming nothing
    // useful (:10726 Low-2). Cheers are deleted by BOTH keys for the same reason
    // attendance rows are — either alone leaves a row when a suite's user acted
    // at a gym it did not create, or a suite's gym was acted on by a user it did
    // not create.
    await sql`DELETE FROM gym_cheers WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_cheers WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM gym_cheers WHERE sent_by_user_id IN (${myUsers})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_attendance WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_attendance WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM streaks WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM user_achievements WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM user_xp WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'orgcheer-t-%@example.com'`;
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
    const email = `orgcheer-t-${local}@example.com`;
    // RETURNED, NOT RE-TYPED BY THE CALLER. The leak assertion below asserts on
    // this exact string; a caller spelling it out again is a copy that a rename
    // makes vacuous with nothing going red (T3 round 2, `:28976`'s class — an
    // absence assertion whose subject has quietly stopped existing).
    const displayName = `Cheer ${local}`;
    const reg = await api().inject({
      method: "POST",
      url: "/v1/auth/register",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email, password: PASSWORD, displayName }),
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
    return { userId, email, displayName, cookies: cookieMap(login) };
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

  /** A VISIT `daysAgo` BEFORE THE GYM'S OWN TODAY, with the offset done in SQL.
   *
   *  **No `new Date()` anywhere in this file.** That would be the test runner's
   *  clock, i.e. the server's, so a fixture built on it agrees with a
   *  server-zone implementation and disagrees with a correct one for exactly the
   *  hours the two differ — :26812 §2(a)'s defect written into the ORACLE, where
   *  no mutant aimed at the code can reach it. */
  const visit = async (gymId: string, userId: string, daysAgo: number) => {
    await sql`
      INSERT INTO gym_attendance
        (gym_id, user_id, marked_by_user_id, day, method, hours_status, slot_key)
      SELECT ${gymId}, ${userId}, ${userId},
             (now() AT TIME ZONE g.timezone)::date - ${daysAgo}::int,
             'manual', 'hours_unset', 'hours_unset'
      FROM gyms g WHERE g.id = ${gymId}`;
  };

  /** THE GYM'S OWN ISO WEEKDAY — Monday 1 … Sunday 7, read from the same
   *  expression `visit` offsets from.
   *
   *  **A FIXTURE OF "TODAY AND YESTERDAY" IS NOT WEEKDAY-INDEPENDENT, which is
   *  what this exists to fix.** `date_trunc('week', …)` is a Monday, so two
   *  consecutive days sit in ONE bucket most of the week and in TWO across a
   *  Sunday/Monday boundary. A test that wants "inside one week" — or, below,
   *  "two buckets as close together as the calendar allows" — has to ask the
   *  gym which day it is. Doing it in SQL rather than with `new Date()` keeps
   *  this file's rule: the clock is the GYM's, never the test runner's. */
  const gymDow = async (gymId: string): Promise<number> => {
    const rows = await sql<{ dow: number }[]>`
      SELECT extract(isodow FROM (now() AT TIME ZONE g.timezone)::date)::int AS dow
      FROM gyms g WHERE g.id = ${gymId}`;
    const dow = rows[0]?.dow;
    if (dow === undefined) throw new Error("no such gym");
    return dow;
  };

  /** The cheer's own audit rows, filtered by ACTION — joining a member writes
   *  its own rows into the same gym, so an unfiltered count would pass on
   *  somebody else's evidence. */
  const cheerAudits = (gymId: string) =>
    sql<{ actor_user_id: string; target_id: string; meta: { preset?: string } }[]>`
      SELECT actor_user_id, target_id, meta FROM audit_log
      WHERE gym_id = ${gymId} AND action = 'org.member_cheered'
      ORDER BY at ASC`;

  const readOverview = async (
    gymId: string,
    cookies: Record<string, string>,
  ): Promise<Overview> => {
    const res = await get(`/v1/orgs/${gymId}/overview`, cookies);
    expect(res.statusCode).toBe(200);
    return (JSON.parse(res.body) as { overview: Overview }).overview;
  };

  const cheer = (
    gymId: string,
    userId: string,
    cookies: Record<string, string>,
    preset: string = GYM_CHEER_PRESETS[0],
  ) => post(`/v1/orgs/${gymId}/members/${userId}/cheer`, { preset }, cookies);

  const rollFor = (overview: Overview, userId: string): Regular | undefined =>
    overview.onARoll.find((r) => r.userId === userId);

  /** WHAT `cheerableAt` DECOMPOSES INTO IN THE GYM'S OWN ZONE — its wall-clock
   *  time, and how many of the gym's days ahead of today it falls.
   *
   *  **THE ORACLE IS DELIBERATELY THE INVERSE OF THE CODE, NOT A COPY OF IT.**
   *  `getGymRegulars` builds the instant by ADDING a day to the gym's date and
   *  pushing it back through the zone; this pulls the answer back OUT through
   *  the zone and asks two questions of the result. **Re-running the code's own
   *  expression would move both sides together on any change** — the trap the
   *  seven-day helper this replaces was written to avoid, kept word for word in
   *  a new shape.
   *
   *  **AND IT IS WHAT CATCHES A UTC ANSWER, with no dependence on when the
   *  suite runs.** Midnight UTC read in Kolkata is `05:30:00`, in Kiritimati
   *  `14:00:00` — never `00:00:00`. So a `cheerable_at` computed without the
   *  gym's zone fails the time half whatever the hour. */
  const cheerableParts = async (
    gymId: string,
    instant: string,
  ): Promise<{ localTime: string; daysAhead: number }> => {
    const rows = await sql<{ local_time: string; days_ahead: number }[]>`
      SELECT to_char(${instant}::timestamptz AT TIME ZONE g.timezone, 'HH24:MI:SS') AS local_time,
             ((${instant}::timestamptz AT TIME ZONE g.timezone)::date
               - (now() AT TIME ZONE g.timezone)::date)::int AS days_ahead
      FROM gyms g WHERE g.id = ${gymId}`;
    const row = rows[0];
    if (row === undefined) throw new Error("no such gym");
    return { localTime: row.local_time, daysAhead: row.days_ahead };
  };

  /** Move every cheer this gym sent this member onto a chosen GYM-day, at
   *  midday local so no fixture ever stands on a boundary by accident.
   *
   *  **GYM-DAYS AND NOT `now() - interval`**, for `visit`'s own recorded reason:
   *  an offset in hours agrees with a server-zone implementation and disagrees
   *  with a correct one for exactly the hours the two differ, which would put
   *  :26812 §2(a)'s defect into the ORACLE where no mutant can reach it. */
  const moveCheerToGymDay = async (gymId: string, userId: string, daysAgo: number) => {
    await sql`
      UPDATE gym_cheers SET created_at = (
        SELECT (((now() AT TIME ZONE g.timezone)::date - ${daysAgo}::int)::timestamp
                 + interval '12 hours') AT TIME ZONE g.timezone
        FROM gyms g WHERE g.id = ${gymId})
      WHERE gym_id = ${gymId} AND user_id = ${userId}`;
  };

  /** A TIMEZONE IN WHICH TODAY IS NOT UTC'S TODAY — chosen at run time, and
   *  guaranteed to exist at every hour of every day.
   *
   *  **THIS IS THE FIXTURE THAT MAKES A UTC-BUCKETED GUARD DIE, and picking a
   *  fixed zone could not do it.** The disagreement between a gym's date and
   *  UTC's is real for only part of the day in any one zone, so a hardcoded
   *  `Asia/Kolkata` would make the mutant survive for nineteen hours out of
   *  twenty-four and the suite would pass or fail by the clock (:13746 — a
   *  number from one run is a coin toss).
   *
   *  **WHY TWO ZONES ARE ENOUGH, and it is arithmetic rather than luck.**
   *  Kiritimati is UTC+14 and Midway UTC−11: at UTC hour `h`, Kiritimati's date
   *  runs ahead whenever `h ≥ 10`, and Midway's runs behind whenever `h < 11`.
   *  The two conditions overlap and together cover all 24 hours, so **at least
   *  one of them always differs.** The assertion below states that rather than
   *  trusting it. */
  const zoneOffsetFromUtcToday = async (): Promise<string> => {
    const rows = await sql<{ zone: string }[]>`
      SELECT z AS zone
      FROM unnest(ARRAY['Pacific/Kiritimati', 'Pacific/Midway']) AS z
      WHERE (now() AT TIME ZONE z)::date <> (now() AT TIME ZONE 'UTC')::date
      LIMIT 1`;
    const zone = rows[0]?.zone;
    if (zone === undefined) {
      throw new Error("no zone disagrees with UTC today, which the arithmetic says cannot happen");
    }
    return zone;
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
  // THE LIST — both units, and the fixture where they disagree
  // -------------------------------------------------------------------------

  it(
    "reports weeks AND days running, and the two are different numbers",
    async () => {
      const owner = await makeUser("l1-owner");
      const org = await makeOrg(owner.cookies, "Roll Gym One");

      // FOUR WEEKS, ONE VISIT EACH — `weeksRunning` 4, `daysRunning` 1.
      // "7 days ago" is always the previous week bucket, whatever weekday it is
      // today: date_trunc('week', d - 7) is date_trunc('week', d) - 7, always.
      const weekly = await makeUser("l1-weekly");
      await joinAsMember(weekly.cookies, org, owner.cookies);
      // The visit at 60 days is OUTSIDE the streak and must not be counted by
      // it — without it, a `visits` figure scoped to the whole lookback window
      // and one scoped to the streak are the same number, and the fixture
      // cannot tell the two apart (:30399 §6's C155 shape).
      for (const daysAgo of [0, 7, 14, 21, 60]) await visit(org.org.id, weekly.userId, daysAgo);

      // THREE DAYS RUNNING, INSIDE THREE WEEK BUCKETS — 3 and 3.
      const daily = await makeUser("l1-daily");
      await joinAsMember(daily.cookies, org, owner.cookies);
      for (const daysAgo of [0, 1, 2, 7, 14]) await visit(org.org.id, daily.userId, daysAgo);

      const overview = await readOverview(org.org.id, owner.cookies);

      const w = rollFor(overview, weekly.userId);
      const dy = rollFor(overview, daily.userId);
      expect(w, "the once-a-week member is on the list").toBeDefined();
      expect(dy, "the three-days-running member is on the list").toBeDefined();

      // THE POINT OF THE FIXTURE: one row's two figures are 4 and 1, the
      // other's are 3 and 3. Neither number can be derived from the other, so a
      // reader that served one field twice fails here.
      expect(w?.weeksRunning).toBe(4);
      expect(w?.daysRunning).toBe(1);
      expect(dy?.weeksRunning).toBe(3);
      expect(dy?.daysRunning).toBe(3);

      // ORDERED BY WEEKS FIRST — the question the panel answers is "who keeps
      // turning up", and days is the detail beside it.
      expect(overview.onARoll.map((r) => r.userId).slice(0, 2)).toEqual([
        weekly.userId,
        daily.userId,
      ]);

      // `visits` COVERS THE WEEK-STREAK'S OWN SPAN, so the row describes one
      // stretch of time (:30624 — two true figures must not make a false
      // sentence). The weekly member's streak starts 21 days back and holds all
      // four of their visits; the daily member's starts 14 back and holds five.
      expect(w?.visits).toBe(4);
      expect(dy?.visits).toBe(5);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "does not bridge a gap the member's own streak would have frozen over",
    async () => {
      const owner = await makeUser("l2-owner");
      const org = await makeOrg(owner.cookies, "Roll Gym Two");

      // A GAP AT DAY 2: visits today, yesterday, and three days ago.
      const gapped = await makeUser("l2-gapped");
      await joinAsMember(gapped.cookies, org, owner.cookies);
      for (const daysAgo of [0, 1, 3, 8, 15]) await visit(org.org.id, gapped.userId, daysAgo);

      // AND A GAMIFICATION STREAK THAT SAYS OTHERWISE. Part 7 §3.2's freezes
      // advance `last_activity_date` across missed days, so the member's own app
      // can legitimately show a longer run than they physically attended.
      // **The gym's figure must be the attendance, not this.**
      await sql`
        INSERT INTO streaks (user_id, current, longest, last_activity_date, freezes_available)
        SELECT ${gapped.userId}, 4, 9, (now() AT TIME ZONE g.timezone)::date, 3
        FROM gyms g WHERE g.id = ${org.org.id}
        ON CONFLICT (user_id) DO UPDATE SET current = 4, freezes_available = 3`;

      const overview = await readOverview(org.org.id, owner.cookies);
      const row = rollFor(overview, gapped.userId);

      // TWO, NOT FOUR. The run is today and yesterday; day 2 was missed and no
      // freeze may pay for it here.
      expect(row?.daysRunning).toBe(2);
      // And the stored streak really does disagree — asserted so this test
      // cannot go vacuous if the fixture stops writing that row.
      const stored = await sql<{ current: number }[]>`
        SELECT current FROM streaks WHERE user_id = ${gapped.userId}`;
      expect(stored[0]?.current).toBe(4);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "leaves out members whose streak has died, and members with only one week",
    async () => {
      const owner = await makeUser("l3-owner");
      const org = await makeOrg(owner.cookies, "Roll Gym Three");

      // STOPPED THREE WEEKS AGO — the last week bucket with a visit is further
      // back than `this_week - 7`, so the streak is not alive.
      const lapsed = await makeUser("l3-lapsed");
      await joinAsMember(lapsed.cookies, org, owner.cookies);
      for (const daysAgo of [21, 22, 28]) await visit(org.org.id, lapsed.userId, daysAgo);

      // ONE WEEK ONLY — alive, and below `ON_A_ROLL_MIN_WEEKS`.
      //
      // **THE OFFSETS ARE PINNED TO THE GYM'S WEEKDAY, AND THE MEMBER SITS IN
      // LAST WEEK RATHER THAN THIS ONE. Both halves are load-bearing.**
      //
      // It read `[0, 1]`, which lands in ONE week bucket six days a week and in
      // TWO across a Sunday/Monday — so `weeksRunning` was 2, this member
      // appeared, and the assertion below went red every Monday.
      //
      // **`[dow+5, dow+6]` is two days inside the PREVIOUS ISO week on every
      // weekday** (last week is `dow … dow+6` days back), so it is one bucket
      // always — and its span from today is `dow+6`, i.e. at least 7 days.
      // **That span is what keeps O265 lethal.** Were this member recent, the
      // new span floor would exclude them by itself, O265 could relax
      // `ON_A_ROLL_MIN_WEEKS` to 1 with this test still green, and a fix would
      // have quietly un-covered a guarantee it never touched (:15673).
      const dow = await gymDow(org.org.id);
      const newcomer = await makeUser("l3-new");
      await joinAsMember(newcomer.cookies, org, owner.cookies);
      for (const daysAgo of [dow + 5, dow + 6]) {
        await visit(org.org.id, newcomer.userId, daysAgo);
      }

      // QUALIFIES — the positive control, without which every assertion below
      // would pass on a list that returned nobody at all.
      const keeper = await makeUser("l3-keeper");
      await joinAsMember(keeper.cookies, org, owner.cookies);
      for (const daysAgo of [0, 7]) await visit(org.org.id, keeper.userId, daysAgo);

      const overview = await readOverview(org.org.id, owner.cookies);
      const ids = overview.onARoll.map((r) => r.userId);

      expect(ids, "a live streak of two weeks is on the list").toContain(keeper.userId);
      expect(ids, "a streak that died three weeks ago is not").not.toContain(lapsed.userId);
      expect(ids, "a single week is below the floor").not.toContain(newcomer.userId);
      expect(rollFor(overview, keeper.userId)?.weeksRunning).toBe(ON_A_ROLL_MIN_WEEKS);
    },
    TEST_TIMEOUT_MS,
  );

  /** T3 ROUND 1, C/H-1 — **WEEK BUCKETS ARE NOT WEEKS.**
   *
   *  `date_trunc('week', …)` is a Monday, so a Sunday visit and a Monday visit
   *  are two buckets ONE DAY apart. Somebody whose entire history was yesterday
   *  and today therefore cleared `ON_A_ROLL_MIN_WEEKS` and was drawn on the
   *  owner's home screen as **"2 weeks running"** — the brand-new member that
   *  constant's own docblock says it exists to keep off a list headed *"on a
   *  roll"*, arriving through the calendar instead of through the floor.
   *
   *  **THE FIXTURE HAS TO ASK THE GYM WHAT DAY IT IS, and there is no
   *  weekday-independent version of it.** The nearest day in the previous ISO
   *  week is `dow` days back: 1 on a Monday, 6 on a Saturday — and exactly 7 on
   *  a Sunday, where the same two visits are a genuine week apart and the
   *  member BELONGS on the list. Both arms are asserted rather than one being
   *  skipped, so the seventh day is not a hole (:7104's PG1). Six days in seven
   *  this test goes red without the span floor. */
  it(
    "a streak that only straddled a Monday is not two weeks running",
    async () => {
      const owner = await makeUser("l7-owner");
      const org = await makeOrg(owner.cookies, "Roll Gym Seven");
      const dow = await gymDow(org.org.id);

      const justArrived = await makeUser("l7-new");
      await joinAsMember(justArrived.cookies, org, owner.cookies);
      for (const daysAgo of [0, dow]) await visit(org.org.id, justArrived.userId, daysAgo);

      // THE POSITIVE CONTROL. Three buckets on every weekday, and fourteen days
      // of elapsed time — without it every absence below passes on an empty
      // list, which is how the span floor could ship as "reject everybody".
      const keeper = await makeUser("l7-keeper");
      await joinAsMember(keeper.cookies, org, owner.cookies);
      for (const daysAgo of [0, 7, 14]) await visit(org.org.id, keeper.userId, daysAgo);

      const overview = await readOverview(org.org.id, owner.cookies);
      const ids = overview.onARoll.map((r) => r.userId);
      expect(ids, "three weeks of visits is still on the list").toContain(keeper.userId);
      expect(rollFor(overview, keeper.userId)?.weeksRunning).toBe(3);

      if (dow < 7) {
        expect(
          ids,
          `${String(dow)} day(s) of history is not "${String(ON_A_ROLL_MIN_WEEKS)} weeks running"`,
        ).not.toContain(justArrived.userId);
      } else {
        expect(ids, "a genuine week apart still qualifies").toContain(justArrived.userId);
        expect(rollFor(overview, justArrived.userId)?.weeksRunning).toBe(ON_A_ROLL_MIN_WEEKS);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "counts only this gym's visits, for a member of two gyms",
    async () => {
      const owner = await makeUser("l4-owner");
      const orgA = await makeOrg(owner.cookies, "Roll Gym A");
      const orgB = await makeOrg(owner.cookies, "Roll Gym B");

      // ONE PERSON, TWO MEMBERSHIPS — :28221 §3b's lesson. With one membership a
      // missing gym predicate leaks nothing and the mutant cannot die.
      const both = await makeUser("l4-both");
      await joinAsMember(both.cookies, orgA, owner.cookies);
      await joinAsMember(both.cookies, orgB, owner.cookies);

      // TWO weeks at A, FOUR at B. If the gym predicate went, A would report B's.
      for (const daysAgo of [0, 7]) await visit(orgA.org.id, both.userId, daysAgo);
      for (const daysAgo of [0, 7, 14, 21]) await visit(orgB.org.id, both.userId, daysAgo);

      const a = await readOverview(orgA.org.id, owner.cookies);
      const b = await readOverview(orgB.org.id, owner.cookies);

      expect(rollFor(a, both.userId)?.weeksRunning).toBe(2);
      expect(rollFor(b, both.userId)?.weeksRunning).toBe(4);
      // AND THE VISIT COUNT IS SCOPED TOO — a gym predicate can be dropped from
      // the streak query and kept in the count, or the other way round.
      expect(rollFor(a, both.userId)?.visits).toBe(2);
      expect(rollFor(b, both.userId)?.visits).toBe(4);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "leaves out somebody the gym has removed, whose visits are still on file",
    async () => {
      const owner = await makeUser("l5-owner");
      const org = await makeOrg(owner.cookies, "Roll Gym Five");

      const gone = await makeUser("l5-gone");
      await joinAsMember(gone.cookies, org, owner.cookies);
      for (const daysAgo of [0, 7, 14]) await visit(org.org.id, gone.userId, daysAgo);

      const before = await readOverview(org.org.id, owner.cookies);
      expect(before.onARoll.map((r) => r.userId)).toContain(gone.userId);

      const removed = await api().inject({
        method: "DELETE",
        url: `/v1/orgs/${org.org.id}/members/${gone.userId}`,
        remoteAddress: nextIp(),
        cookies: owner.cookies,
      });
      expect(removed.statusCode).toBe(200);

      // THE VISITS SURVIVE — nothing deletes attendance — so a query keyed on
      // the attendance table alone would keep drawing a ghost on the owner's
      // home screen.
      const after = await readOverview(org.org.id, owner.cookies);
      expect(after.onARoll.map((r) => r.userId)).not.toContain(gone.userId);
      const stillThere = await sql<{ n: string }[]>`
        SELECT count(*) AS n FROM gym_attendance
        WHERE gym_id = ${org.org.id} AND user_id = ${gone.userId}`;
      expect(Number(stillThere[0]?.n)).toBe(3);

      // AND THEY CANNOT BE CHEERED EITHER. The list is one guard and the write
      // door is another; a member removed while somebody had the panel open
      // must not still be reachable by the button they are still looking at.
      const afterRemoval = await cheer(org.org.id, gone.userId, owner.cookies);
      expect(afterRemoval.statusCode).toBe(404);
    },
    TEST_TIMEOUT_MS,
  );

  // -------------------------------------------------------------------------
  // THE CHEER
  // -------------------------------------------------------------------------

  it(
    "sends one, and the member sees it on their own gym card",
    async () => {
      const owner = await makeUser("c1-owner");
      const org = await makeOrg(owner.cookies, "Cheer Gym One");
      const member = await makeUser("c1-member");
      await joinAsMember(member.cookies, org, owner.cookies);
      for (const daysAgo of [0, 7]) await visit(org.org.id, member.userId, daysAgo);

      const sent = await cheer(org.org.id, member.userId, owner.cookies, "on_a_roll");
      expect(sent.statusCode).toBe(201);
      const body = JSON.parse(sent.body) as { cheer: { preset: string; sentAt: string } };
      expect(body.cheer.preset).toBe("on_a_roll");

      // THE MEMBER'S SIDE — the whole of the delivery. Nothing sends anything in
      // this product (:29961 §4), so the cheer waits on `/v1/orgs/mine`.
      const mine = await get("/v1/orgs/mine", member.cookies);
      expect(mine.statusCode).toBe(200);
      const orgs = (
        JSON.parse(mine.body) as {
          orgs: { id: string; latestCheer: { preset: string; sentAt: string } | null }[];
        }
      ).orgs;
      const card = orgs.find((o) => o.id === org.org.id);
      expect(card?.latestCheer?.preset).toBe("on_a_roll");

      // AND THE SENDER IS NOT ON IT — §2.4's mirror. A member learns their gym
      // cheered them, never which member of staff was on the desk.
      //
      // **ALL THREE IDENTIFIERS, not just the uuid** (T3 round 1, rule 4): the
      // id alone left the assertion green if the sender's NAME or EMAIL leaked,
      // which is the shape a `sentBy` field would actually take.
      const serialised = JSON.stringify(card);
      expect(serialised).not.toContain(owner.userId);
      expect(serialised).not.toContain(owner.email);
      expect(serialised).not.toContain(owner.displayName);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuses a second cheer on the same gym-day and allows one the next day",
    async () => {
      const owner = await makeUser("c2-owner");
      const org = await makeOrg(owner.cookies, "Cheer Gym Two");
      const member = await makeUser("c2-member");
      await joinAsMember(member.cookies, org, owner.cookies);
      for (const daysAgo of [0, 7]) await visit(org.org.id, member.userId, daysAgo);

      expect((await cheer(org.org.id, member.userId, owner.cookies)).statusCode).toBe(201);

      // THE SAME DAY — refused, and the list says when it opens again. Kd's
      // :35762, replacing his own rolling seven days at :29961 ruling 4.
      const tooSoon = await cheer(org.org.id, member.userId, owner.cookies);
      expect(tooSoon.statusCode).toBe(409);
      expect((JSON.parse(tooSoon.body) as { error: string }).error).toBe("cheer_already_sent");
      // THE SENTENCE IS THE SERVER'S AND THE CONSOLE ECHOES IT, so it is
      // asserted here rather than left to the screen (:20587 — one rule, and
      // every copy of it moves together).
      expect((JSON.parse(tooSoon.body) as { message: string }).message).toBe(
        "This member has already been cheered today.",
      );

      // **NOT `?.cheerableAt).not.toBeNull()`, WHICH IS WHAT THIS WAS.** When
      // the member is absent from the list `rollFor` returns `undefined`, and
      // `expect(undefined).not.toBeNull()` PASSES — so that assertion could not
      // fail on a missing row, a wrong instant, or another gym's cheer. The row
      // is asserted first, then the instant itself (T3 round 1, rule 4).
      const blocked = await readOverview(org.org.id, owner.cookies);
      const blockedRow = rollFor(blocked, member.userId);
      expect(blockedRow, "a blocked member is still on the list").toBeDefined();

      // **THE INSTANT IS THE GYM'S NEXT MIDNIGHT — BOTH HALVES, BECAUSE THEY
      // FAIL SEPARATELY.** A UTC answer lands on the right DAY at the wrong
      // TIME (05:30 in Kolkata), and an off-by-one lands at the right time on
      // the wrong day; asserting only one of the two accepts the other.
      const parts = await cheerableParts(org.org.id, blockedRow?.cheerableAt ?? "");
      expect(parts.localTime, "midnight in the gym's own zone, not UTC's").toBe("00:00:00");
      expect(parts.daysAhead, "the gym's TOMORROW").toBe(1);

      // THE NEXT DAY — allowed. **The other direction, without which a gate
      // that simply never opens passes the test above** (:7104's PG1).
      await moveCheerToGymDay(org.org.id, member.userId, 1);

      // **AND THE PANEL SAYS SO BEFORE THE SEND PROVES IT — the reader's day
      // has to be exactly TODAY, and nothing in this file could see its WIDTH**
      // (T3 C/H-2, measured: O283 was ALIVE).
      //
      // This is the one instant where it is observable. Exactly one cheer
      // exists and it is now dated YESTERDAY, so a reader widened to
      // `>= today - 1` names a midnight while the guard three lines below
      // honours the send — **the console greys a button the server would
      // accept, and quietly reinstates the wait Kd threw out** (:35762).
      //
      // **EVERY OTHER `toBeNull` HERE IS A MEMBER THIS GYM HAS NEVER CHEERED**,
      // which a widened window answers identically. And the assertions on
      // either side stand on rows that include TODAY, where :35822 §2 applies
      // one line over: the sub-select's value stopped depending on the row it
      // matched, so every row in a wider window yields the SAME midnight and
      // the defect and the fix are indistinguishable (:20712).
      const reopened = rollFor(await readOverview(org.org.id, owner.cookies), member.userId);
      expect(reopened, "still on the list with yesterday's cheer on the clock").toBeDefined();
      expect(
        reopened?.cheerableAt,
        "only TODAY's cheer may block: yesterday's must leave the window open",
      ).toBeNull();

      expect((await cheer(org.org.id, member.userId, owner.cookies)).statusCode).toBe(201);

      // **AND YESTERDAY'S CHEER DOES NOT MOVE THE ANSWER.** Two rows exist now,
      // one on each of two gym-days, and only today's may decide the instant —
      // the predicate that keeps the old rolling window from creeping back in
      // through a wider comparison.
      const ids = await sql<{ id: string }[]>`
        SELECT id FROM gym_cheers
        WHERE gym_id = ${org.org.id} AND user_id = ${member.userId}
        ORDER BY created_at ASC`;
      expect(ids, "two cheers have been sent by now").toHaveLength(2);

      const open = await readOverview(org.org.id, owner.cookies);
      const openRow = rollFor(open, member.userId);
      expect(openRow, "still on the list with two cheers on the clock").toBeDefined();
      const openParts = await cheerableParts(org.org.id, openRow?.cheerableAt ?? "");
      expect(openParts.localTime).toBe("00:00:00");
      expect(openParts.daysAhead).toBe(1);

      // AND IT IS THIS GYM'S ANSWER. A cheer from a DIFFERENT gym must not move
      // it — the subquery's `c.gym_id` predicate, which nothing else drives.
      // **AND IT IS THIS GYM'S ANSWER — MEASURED ON A MEMBER GYM A HAS NOT
      // CHEERED, WHICH IS THE ONLY WAY TO SEE IT NOW.**
      //
      // **O276 SURVIVED THE OBVIOUS VERSION OF THIS AND THE REASON IS THE RULE
      // CHANGE ITSELF.** Under the old rolling window the subquery RETURNED the
      // matched row's own `created_at + 7 days`, so another gym's cheer moved
      // the instant and any member would do. It now returns the same midnight
      // whichever row matched — so on a member gym A HAS cheered today, the
      // predicate makes no difference to the value and the mutant is invisible.
      // The predicate's whole remaining job is to keep gym A's button LIVE for
      // somebody only gym B has cheered, so that is what is asserted (:7104's
      // PG1 — a guard needs the arm where it must NOT fire).
      const orgB = await makeOrg(owner.cookies, "Cheer Gym Two-B");
      const shared = await makeUser("c2-shared");
      await joinAsMember(shared.cookies, org, owner.cookies);
      await joinAsMember(shared.cookies, orgB, owner.cookies);
      for (const daysAgo of [0, 7]) {
        await visit(org.org.id, shared.userId, daysAgo);
        await visit(orgB.org.id, shared.userId, daysAgo);
      }

      // Gym A has NOT cheered this member, so its button is live and its
      // instant is null — asserted BEFORE gym B acts, so the change below is
      // attributable to gym B and not to the fixture.
      const beforeB = rollFor(await readOverview(org.org.id, owner.cookies), shared.userId);
      expect(beforeB, "the shared member is on gym A's list").toBeDefined();
      expect(beforeB?.cheerableAt, "gym A has not cheered them, so nothing blocks it").toBeNull();

      expect((await cheer(orgB.org.id, shared.userId, owner.cookies)).statusCode).toBe(201);

      // **STILL NULL.** Gym B's cheer must not grey gym A's button, nor name a
      // date gym A never earned.
      const afterB = rollFor(await readOverview(org.org.id, owner.cookies), shared.userId);
      expect(afterB, "still on gym A's list after gym B cheered them").toBeDefined();
      expect(afterB?.cheerableAt, "another gym's cheer must not block this one").toBeNull();

      // AND GYM B'S OWN ANSWER DID CHANGE, so the null above is a real refusal
      // to be affected rather than a reader that never reports anything.
      const atB = rollFor(await readOverview(orgB.org.id, owner.cookies), shared.userId);
      expect(atB?.cheerableAt, "gym B, which did cheer, is blocked").not.toBeNull();
      const bParts = await cheerableParts(orgB.org.id, atB?.cheerableAt ?? "");
      expect(bParts.localTime).toBe("00:00:00");
      expect(bParts.daysAhead).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  // **THE DAY IS THE GYM'S DAY AND NOT THE SERVER'S**, which is trap #8 in this
  // playbook and the one defect this cap can carry without ever looking wrong.
  //
  // **THE GYM IS BUILT IN A ZONE WHOSE TODAY IS NOT UTC'S TODAY, CHOSEN AT RUN
  // TIME** — see `zoneOffsetFromUtcToday`. A cheer sent *now* is therefore
  // stamped with one date in the gym's calendar and a DIFFERENT one in UTC, so
  // a guard that buckets either side in UTC stops seeing it and lets a second
  // cheer through. In `Asia/Kolkata` that gap is real for five and a half hours
  // a day and the mutant would survive the other nineteen.
  it(
    "counts the gym's day and not the server's, at every hour of the day",
    async () => {
      const zone = await zoneOffsetFromUtcToday();
      const differsRows = await sql<{ differs: boolean }[]>`
        SELECT ((now() AT TIME ZONE ${zone})::date <> (now() AT TIME ZONE 'UTC')::date) AS differs`;
      expect(
        differsRows[0]?.differs,
        `${zone} must disagree with UTC's date for this fixture to bite`,
      ).toBe(true);

      const owner = await makeUser("c2tz-owner");
      const org = await makeOrg(owner.cookies, "Cheer Gym Zone", zone);
      const member = await makeUser("c2tz-member");
      await joinAsMember(member.cookies, org, owner.cookies);
      for (const daysAgo of [0, 7]) await visit(org.org.id, member.userId, daysAgo);

      expect((await cheer(org.org.id, member.userId, owner.cookies)).statusCode).toBe(201);

      // THE SECOND ONE IS REFUSED **because the gym says it is still the same
      // day**, though UTC has already turned the page or not yet reached it.
      const again = await cheer(org.org.id, member.userId, owner.cookies);
      expect(again.statusCode, "a UTC-bucketed guard lets this through").toBe(409);

      // AND THE REOPENING INSTANT IS MIDNIGHT WHERE THE GYM IS. At UTC+14 a UTC
      // midnight reads 14:00 local, so this assertion cannot be satisfied by an
      // answer computed in the wrong zone.
      const row = rollFor(await readOverview(org.org.id, owner.cookies), member.userId);
      expect(row, "the blocked member is still listed").toBeDefined();
      const parts = await cheerableParts(org.org.id, row?.cheerableAt ?? "");
      expect(parts.localTime).toBe("00:00:00");
      expect(parts.daysAhead).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "will not cheer somebody who is not this gym's member",
    async () => {
      const ownerA = await makeUser("c3-owner-a");
      const ownerB = await makeUser("c3-owner-b");
      const orgA = await makeOrg(ownerA.cookies, "Cheer Gym A");
      const orgB = await makeOrg(ownerB.cookies, "Cheer Gym B");

      const theirs = await makeUser("c3-theirs");
      await joinAsMember(theirs.cookies, orgB, ownerB.cookies);

      // A's OWNER, A's GYM, B's MEMBER — authorised for the gym in the URL and
      // still refused, because the member is somebody else's.
      const wrongMember = await cheer(orgA.org.id, theirs.userId, ownerA.cookies);
      expect(wrongMember.statusCode).toBe(404);
      expect((JSON.parse(wrongMember.body) as { error: string }).error).toBe("member_not_found");

      // A's OWNER AT B's GYM — the tenancy refusal, which is a DIFFERENT test
      // from the one above (:28221 §3a) and answers before the membership is
      // ever consulted, so a stranger learns nothing about B's roster.
      const wrongGym = await cheer(orgB.org.id, theirs.userId, ownerA.cookies);
      expect(wrongGym.statusCode).toBe(404);

      // NOTHING WAS WRITTEN BY EITHER — the refusals are refusals, not silent
      // successes with a 404 on the way out.
      const rows = await sql<{ n: string }[]>`
        SELECT count(*) AS n FROM gym_cheers WHERE user_id = ${theirs.userId}`;
      expect(Number(rows[0]?.n)).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "puts one gym's cheer on that gym's card and nobody else's",
    async () => {
      const owner = await makeUser("c4-owner");
      const orgA = await makeOrg(owner.cookies, "Cheer Card A");
      const orgB = await makeOrg(owner.cookies, "Cheer Card B");

      const member = await makeUser("c4-member");
      await joinAsMember(member.cookies, orgA, owner.cookies);
      await joinAsMember(member.cookies, orgB, owner.cookies);

      const other = await makeUser("c4-other");
      await joinAsMember(other.cookies, orgA, owner.cookies);

      expect((await cheer(orgA.org.id, member.userId, owner.cookies, "consistency")).statusCode)
        .toBe(201);

      // AND B CAN CHEER THE SAME PERSON THE SAME DAY. The cap is per GYM, not
      // per person: two gyms are two relationships, and one gym's encouragement
      // must not spend the other's. Dropping `gym_id` from the cap's own lookup
      // refuses this with a 409.
      expect((await cheer(orgB.org.id, member.userId, owner.cookies, "strong_streak")).statusCode)
        .toBe(201);

      const mine = await get("/v1/orgs/mine", member.cookies);
      const orgs = (
        JSON.parse(mine.body) as {
          orgs: { id: string; latestCheer: { preset: string } | null }[];
        }
      ).orgs;
      // THE GYM PREDICATE: A has it, B does not. Dropping `gym_id` from the
      // lateral puts A's cheer on B's card, for a gym that never sent one.
      expect(orgs.find((o) => o.id === orgA.org.id)?.latestCheer?.preset).toBe("consistency");
      expect(orgs.find((o) => o.id === orgB.org.id)?.latestCheer?.preset).toBe("strong_streak");

      // THE USER PREDICATE: the other member of the SAME gym has nothing.
      // Dropping `user_id` hands them somebody else's message.
      const theirs = await get("/v1/orgs/mine", other.cookies);
      const theirOrgs = (
        JSON.parse(theirs.body) as { orgs: { id: string; latestCheer: unknown }[] }
      ).orgs;
      expect(theirOrgs.find((o) => o.id === orgA.org.id)?.latestCheer).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuses a typed message, and refuses a preset nobody defined",
    async () => {
      const owner = await makeUser("c5-owner");
      const org = await makeOrg(owner.cookies, "Cheer Gym Five");
      const member = await makeUser("c5-member");
      await joinAsMember(member.cookies, org, owner.cookies);

      // KD'S RULING IS THE ENUM. A free-text body is a 400 at the boundary
      // rather than a row, which is what makes "no free-text box" a property of
      // the server and not of the screen.
      const typed = await post(
        `/v1/orgs/${org.org.id}/members/${member.userId}/cheer`,
        { preset: "you are doing great, keep it up!" },
        owner.cookies,
      );
      expect(typed.statusCode).toBe(400);

      // AND `.strict()` REFUSES A SMUGGLED EXTRA FIELD, which is how a "message"
      // would arrive if somebody added one to the client first.
      const smuggled = await post(
        `/v1/orgs/${org.org.id}/members/${member.userId}/cheer`,
        { preset: GYM_CHEER_PRESETS[0], message: "hello" },
        owner.cookies,
      );
      expect(smuggled.statusCode).toBe(400);

      const rows = await sql<{ n: string }[]>`
        SELECT count(*) AS n FROM gym_cheers WHERE gym_id = ${org.org.id}`;
      expect(Number(rows[0]?.n)).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "is a console write door: a gym with no live plan is refused, one with a plan is not",
    async () => {
      const owner = await makeUser("c6-owner");
      const org = await makeOrg(owner.cookies, "Cheer Gym Six");
      const member = await makeUser("c6-member");
      await joinAsMember(member.cookies, org, owner.cookies);

      // THE LIVE ARM FIRST — the third arm :23711 §3 requires, without which a
      // gate that refuses everybody passes the refusal assertions below.
      expect((await cheer(org.org.id, member.userId, owner.cookies)).statusCode).toBe(201);
      await sql`DELETE FROM gym_cheers WHERE gym_id = ${org.org.id}`;

      // EXPIRED, WHICH IS THE STATE KD'S RULING IS ABOUT — the sweep ran. A
      // fixture that DELETED the row would reach "no plan" a different way and
      // could not see a widened status set (:23711 §3's O155).
      await sql`
        UPDATE subscriptions SET status = 'expired'
        WHERE owner_type = 'gym' AND owner_id = ${org.org.id}`;
      const lapsed = await cheer(org.org.id, member.userId, owner.cookies);
      expect(lapsed.statusCode).toBe(409);
      expect((JSON.parse(lapsed.body) as { error: string }).error).toBe("gym_not_on_plan");

      // ARCHIVED — refused by the second gate, on a gym whose plan is live.
      await subscribeGym(org.org.id);
      await sql`UPDATE gyms SET status = 'archived' WHERE id = ${org.org.id}`;
      const archived = await cheer(org.org.id, member.userId, owner.cookies);
      expect(archived.statusCode).toBe(409);
      expect((JSON.parse(archived.body) as { error: string }).error).toBe("org_archived");

      await sql`UPDATE gyms SET status = 'active' WHERE id = ${org.org.id}`;
      const rows = await sql<{ n: string }[]>`
        SELECT count(*) AS n FROM gym_cheers WHERE gym_id = ${org.org.id}`;
      expect(Number(rows[0]?.n)).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuses a signed-in stranger, and tells them nothing about the gym",
    async () => {
      const owner = await makeUser("c7-owner");
      const org = await makeOrg(owner.cookies, "Cheer Gym Seven");
      const member = await makeUser("c7-member");
      await joinAsMember(member.cookies, org, owner.cookies);
      const stranger = await makeUser("c7-stranger");

      // 404 AND NOT 403 — `requirePrivilege`'s own answer, so holding a gym's
      // uuid tells a stranger nothing about whether it exists.
      const refused = await cheer(org.org.id, member.userId, stranger.cookies);
      expect(refused.statusCode).toBe(404);

      // AND THE MEMBER CANNOT CHEER THEMSELVES: a plain member holds no
      // `members.read`, so the button is a staff door and not a member one.
      const selfCheer = await cheer(org.org.id, member.userId, member.cookies);
      expect(selfCheer.statusCode).toBe(404);

      const rows = await sql<{ n: string }[]>`
        SELECT count(*) AS n FROM gym_cheers WHERE gym_id = ${org.org.id}`;
      expect(Number(rows[0]?.n)).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  /** T3 ROUND 1, C/H-3 — **Part 3 §3.3: *"every mutating call writes
   *  `audit_log`"*.** This was the only one of the sixteen console write doors
   *  that did not, on a citation of `:28221` §7 that says the opposite: that
   *  exemption is for a MEMBER tapping "I'm here" several hundred times a day,
   *  and `markGymAttendance`'s own docblock draws the line — *"every other
   *  writer in this module is a console action behind a privilege"*. */
  it(
    "writes an audit row naming the staffer who cheered, and none for a refusal",
    async () => {
      const owner = await makeUser("c8-owner");
      const org = await makeOrg(owner.cookies, "Cheer Gym Eight");
      const member = await makeUser("c8-member");
      await joinAsMember(member.cookies, org, owner.cookies);

      expect(await cheerAudits(org.org.id)).toHaveLength(0);
      expect(
        (await cheer(org.org.id, member.userId, owner.cookies, "consistency")).statusCode,
      ).toBe(201);

      const rows = await cheerAudits(org.org.id);
      expect(rows).toHaveLength(1);
      // THE ACTOR IS THE SENDER AND THE TARGET IS THE RECIPIENT — the row is the
      // only record of which staffer sent it, since the member is deliberately
      // never told (§2.4). Swapping the two would still be one row.
      expect(rows[0]?.actor_user_id).toBe(owner.userId);
      expect(rows[0]?.target_id).toBe(member.userId);
      expect(rows[0]?.meta.preset).toBe("consistency");

      // A REFUSAL WRITES NOTHING. The audit row shares the insert's transaction,
      // so a 409 that logged would be a record of something that never happened.
      const again = await cheer(org.org.id, member.userId, owner.cookies);
      expect(again.statusCode).toBe(409);
      expect(await cheerAudits(org.org.id)).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );

  /** T3 ROUND 1, C/H-4 — **the refusal told the wrong person they had done it.**
   *  The cap is per GYM (the lookup filters `gym_id` and `user_id` and nothing
   *  else), so *"You've already cheered this member this week"* is false for the
   *  second staffer on the desk — `:5807`, a sentence a user can see that is
   *  not true. "This week" was wrong twice over: the window was a rolling seven
   *  days when this was written, and since Kd's `:35762` it is the gym's
   *  calendar DAY. The assertion below bans the pronoun and the week; the
   *  sentence it now guards is *"already been cheered today."* */
  it(
    "tells a second staffer what happened, not that they did it",
    async () => {
      const owner = await makeUser("c9-owner");
      const org = await makeOrg(owner.cookies, "Cheer Gym Nine");

      const trainer = await makeUser("c9-trainer");
      await joinAsMember(trainer.cookies, org, owner.cookies);
      const hired = await post(
        `/v1/orgs/${org.org.id}/staff`,
        { email: "orgcheer-t-c9-trainer@example.com", role: "trainer" },
        owner.cookies,
      );
      expect(hired.statusCode).toBe(201);

      const member = await makeUser("c9-member");
      await joinAsMember(member.cookies, org, owner.cookies);

      expect((await cheer(org.org.id, member.userId, owner.cookies)).statusCode).toBe(201);

      // THE TRAINER HAS PRESSED NOTHING. They hold `members.read`, so they reach
      // the cap rather than a privilege refusal — and must not be accused of it.
      const refused = await cheer(org.org.id, member.userId, trainer.cookies);
      expect(refused.statusCode).toBe(409);
      const { error, message } = JSON.parse(refused.body) as { error: string; message: string };
      expect(error).toBe("cheer_already_sent");
      expect(message, "the refusal must not tell the reader they did it").not.toMatch(/\byou/i);
      expect(message, "and must not call a rolling week a calendar one").not.toMatch(/this week/i);
      expect(message).toContain("already been cheered");
    },
    TEST_TIMEOUT_MS,
  );

  /** T3 ROUND 1, "no observer" 1 — **`lockOrgRow` was holding the cap up and
   *  nothing was holding IT up.** Deleting that one line left all thirteen tests
   *  and all twelve mutants green, because the suite never fired two cheers at
   *  once. The migration argues at length that a rolling window cannot be a
   *  constraint, which makes the lock the whole of the guarantee.
   *
   *  TWO SEPARATE postgres clients, for `:21157`'s recorded reason: `buildApp`
   *  pools at `max: 1`, so two `inject` calls are serialised by the CLIENT and
   *  would pass with the lock deleted — a test that cannot fail. */
  it(
    "two staff pressing at the same moment send exactly one cheer",
    async () => {
      const owner = await makeUser("c10-owner");
      const org = await makeOrg(owner.cookies, "Cheer Gym Ten");
      const member = await makeUser("c10-member");
      await joinAsMember(member.cookies, org, owner.cookies);

      const a = postgres(url ?? "", { prepare: false, max: 1 });
      const b = postgres(url ?? "", { prepare: false, max: 1 });
      const args = {
        gymId: org.org.id,
        userId: member.userId,
        sentByUserId: owner.userId,
        preset: GYM_CHEER_PRESETS[0],
      };
      try {
        const [one, two] = await Promise.all([
          orgRepo.sendGymCheer(a, args),
          orgRepo.sendGymCheer(b, args),
        ]);
        // Without the lock BOTH read "nothing recent" and BOTH insert: there is
        // no unique index to raise, so the failure is silent and the member gets
        // two messages. The kinds are sorted because either client may win.
        expect([one.kind, two.kind].sort()).toEqual(["sent", "too_soon"]);
      } finally {
        await a.end({ timeout: 5 });
        await b.end({ timeout: 5 });
      }

      const rows = await sql<{ n: string }[]>`
        SELECT count(*) AS n FROM gym_cheers
        WHERE gym_id = ${org.org.id} AND user_id = ${member.userId}`;
      expect(Number(rows[0]?.n), "exactly one cheer survived the race").toBe(1);
      expect(await cheerAudits(org.org.id)).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );

  /** T3 ROUND 1, L-1 — **the door and the panel used different populations.**
   *  `getGymRegulars` excludes complimentary members; the write door did not, so
   *  a comped member could never be drawn with a Cheer button and could still be
   *  cheered by a hand-made request. The card names both halves. */
  it(
    "will not cheer a complimentary member, who is not on the panel either",
    async () => {
      const owner = await makeUser("c11-owner");
      const org = await makeOrg(owner.cookies, "Cheer Gym Eleven");
      const member = await makeUser("c11-member");
      await joinAsMember(member.cookies, org, owner.cookies);
      for (const daysAgo of [0, 7, 14]) await visit(org.org.id, member.userId, daysAgo);

      // THE POSITIVE CONTROL: before the flip they ARE on the panel and CAN be
      // cheered, so the assertions below cannot pass on a member who was simply
      // never eligible.
      const before = await readOverview(org.org.id, owner.cookies);
      expect(before.onARoll.map((r) => r.userId)).toContain(member.userId);

      await sql`
        UPDATE gym_members SET complimentary = true
        WHERE gym_id = ${org.org.id} AND user_id = ${member.userId}`;

      const refused = await cheer(org.org.id, member.userId, owner.cookies);
      expect(refused.statusCode).toBe(404);
      const after = await readOverview(org.org.id, owner.cookies);
      expect(after.onARoll.map((r) => r.userId)).not.toContain(member.userId);

      const rows = await sql<{ n: string }[]>`
        SELECT count(*) AS n FROM gym_cheers WHERE gym_id = ${org.org.id}`;
      expect(Number(rows[0]?.n)).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );
});
