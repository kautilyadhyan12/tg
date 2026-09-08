// ATTENDANCE — routes + repo against REAL Postgres (R9.2). DATABASE_URL-gated.
// Kd's rulings: :26469 (two ways in, the gym sees which, the owner's switch),
// :26558/:26586 (the whole scan path is phone-app work; the web has ONE way in),
// :27900 (only the member marks · a member sees their own history · attendance
// feeds STREAKS), :27992 (a second visit in a DIFFERENT session counts again ·
// the app never checks whether a member has paid · the owner's screen must not
// pile up), :28055 (a gym with no sessions gets ONE attendance per day) and
// :28107 (`attendance.read`, on for all three roles, untickable by the owner).
//
// THE SIX THINGS THIS FILE EXISTS TO PIN, because most of them are guarantees
// rather than features and would pass silently if they broke:
//
//   1. **RULING 12 HAS TWO DIRECTIONS AND BOTH ARE DRIVEN.** A UNIQUE that only
//      ever REFUSES is satisfied by a door that is simply shut (:19560's O124),
//      so the accepting case — morning session AND evening session, same person,
//      same day, TWO rows — is asserted beside the refusing one. The accepting
//      case is the ruling; the refusing one is R3.5.
//
//   2. **`slot_key` IS THE ONLY LOAD-BEARING COLUMN AND IT FAILS QUIETLY.** A
//      writer that sets it to a constant reverts every gym to one visit a day
//      with no error anywhere — the UNIQUE still holds and every refusal test
//      still passes. The database's `gym_attendance_slot_key_agrees_check` is
//      what turns that into a 23514, and a test drives it directly rather than
//      trusting the constraint exists.
//
//   3. **ALL FIVE `hours_status` VALUES, EACH ON A FIXTURE BUILT TO PRODUCE
//      IT** — including `hours_unset`, which is :26736's third state one level
//      in. "Nobody has answered" is not "outside hours", and a reader that
//      folds them together tells a member something false about a gym that
//      simply has not filled the form in.
//
//   4. **THE GYM'S DAY, NOT THE SERVER'S, ON A PAIR AT OPPOSITE EXTREMES.** One
//      non-UTC gym is NOT enough and this repo has the scar: :26812 §2(a)'s
//      zone-deleting mutant survived a single UTC+14 fixture, because its
//      calendar date differs from UTC's for only fourteen hours of every day.
//      UTC+14 and UTC-12 are 26 hours apart, so their dates ALWAYS differ and
//      the server's can match at most one of them, at every instant.
//
//   5. **RULING 18 FROM BOTH SIDES.** A `trainer` — the narrowest role — reads
//      the list BY DEFAULT with no ticks edited, and a staffer the owner has
//      UNTICKED is refused. A test that only proves the refusal would pass with
//      the default broken, which is the half Kd actually ruled.
//
//   6. **THE STREAK UNION MUST NOT PAY XP.** Kd ruled attendance feeds STREAKS
//      (:27900 §3); he did not rule that it pays XP, and the two read one
//      function until this card. An attendance-only day must extend the streak
//      and leave the lifetime XP total where it was.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "orgatt-test-secret-0123456789abcd", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;

const TEST_TIMEOUT_MS = 30_000;
const HOOK_TIMEOUT_MS = 60_000;

let ipCounter = 0;
const nextIp = () =>
  `10.11.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

/** Same reasoning as the hours suite's: every gym here goes on a live plan
 *  because a gym without one refuses the console writes these fixtures need.
 *  `trial_days = 0` keeps it invisible to `startGymTrial`'s lowest-capped query
 *  so the billing suites' band assertions are undisturbed. */
const LIVE_PLAN = "zz_att_live";

interface CreatedOrg {
  org: { id: string; slug: string; name: string; timezone: string };
  joinCode: { code: string; label: string };
}

interface Visit {
  day: string;
  markedAt: string;
  method: "manual" | "qr";
  hoursStatus: "in_session" | "open_24h" | "outside_hours" | "closed_day" | "hours_unset";
  session: { opensMinute: number; closesMinute: number } | null;
}

interface AttendanceHistory {
  timezone: string;
  clockFormat: "12h" | "24h";
  visits: Visit[];
  nextCursor: string | null;
}

interface AttendanceDay {
  day: string;
  timezone: string;
  clockFormat: "12h" | "24h";
  totals: { visits: number; people: number };
  summary: {
    hoursStatus: Visit["hoursStatus"];
    session: { opensMinute: number; closesMinute: number } | null;
    visits: number;
    people: number;
  }[];
  people: { userId: string; displayName: string; email: string; visits: Visit[] }[];
  nextCursor: string | null;
}

d("gym attendance (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'orgatt-t-%@example.com')`;
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'orgatt-t-%@example.com'`;
    // The hours suite's order and the hours suite's reason: no cascade on the
    // actor FKs, so a stray child blocks the parent DELETE with a 23503 naming
    // nothing useful (:10726 Low-2). `hours_mode` is reset FIRST for the sibling
    // guarantee `db.migration.test.ts` asserts — no gym holds a non-`unset` mode
    // without an `org.hours_set` audit row — which would otherwise be false for
    // the window between deleting this suite's audit rows and its gyms.
    await sql`UPDATE gyms SET hours_mode = 'unset' WHERE id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    // Attendance rows are deleted by BOTH keys: a member of one of these gyms
    // may be a user this suite did not create, and a user this suite created may
    // have marked at a gym it did not create. Either alone leaves a row.
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
    await sql`DELETE FROM users WHERE email LIKE 'orgatt-t-%@example.com'`;
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

  const put = (path: string, payload: unknown, cookies: Record<string, string> = {}) =>
    api().inject({
      method: "PUT",
      url: path,
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      cookies,
      payload: JSON.stringify(payload),
    });

  const patch = (path: string, payload: unknown, cookies: Record<string, string> = {}) =>
    api().inject({
      method: "PATCH",
      url: path,
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      cookies,
      payload: JSON.stringify(payload),
    });

  const get = (path: string, cookies: Record<string, string> = {}) =>
    api().inject({ method: "GET", url: path, remoteAddress: nextIp(), cookies });

  const makeUser = async (local: string) => {
    const email = `orgatt-t-${local}@example.com`;
    const reg = await api().inject({
      method: "POST",
      url: "/v1/auth/register",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email, password: PASSWORD, displayName: `Att ${local}` }),
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

  const mark = (gymId: string, cookies: Record<string, string>) =>
    post(`/v1/orgs/${gymId}/attendance`, {}, cookies);

  const readDay = async (
    gymId: string,
    cookies: Record<string, string>,
    query = "",
  ): Promise<AttendanceDay> => {
    const res = await get(`/v1/orgs/${gymId}/attendance${query}`, cookies);
    expect(res.statusCode).toBe(200);
    return (JSON.parse(res.body) as { attendance: AttendanceDay }).attendance;
  };

  const readHistory = async (
    gymId: string,
    cookies: Record<string, string>,
    query = "",
  ): Promise<AttendanceHistory> => {
    const res = await get(`/v1/orgs/${gymId}/attendance/history${query}`, cookies);
    expect(res.statusCode).toBe(200);
    return (JSON.parse(res.body) as { attendance: AttendanceHistory }).attendance;
  };

  /** The days a history read came back with, newest first — which is the order
   *  the route promises, so asserting the ARRAY rather than a set is deliberate:
   *  a window that returned the right rows in the wrong order would still be a
   *  calendar drawn out of sequence. */
  const daysOf = (page: { visits: Visit[] }) => page.visits.map((v) => v.day);

  /** THE GYM'S OWN TODAY, ASKED OF THE DATABASE AND NEVER COMPUTED HERE.
   *
   *  A `new Date()` in this file would be the TEST RUNNER's clock, which is the
   *  server's — so an assertion built on it would agree with a broken
   *  server-zone implementation and disagree with a correct one, for exactly the
   *  hours the two zones differ. That is :26812 §2(a)'s defect written into the
   *  oracle instead of the code, which is worse: it cannot be caught by a mutant
   *  aimed at the code. */
  const gymToday = async (gymId: string): Promise<string> => {
    const rows = await sql<{ day: string }[]>`
      SELECT (now() AT TIME ZONE timezone)::date::text AS day FROM gyms WHERE id = ${gymId}`;
    const row = rows[0];
    if (row === undefined) throw new Error("no such gym");
    return row.day;
  };

  /** A whole week of sessions that certainly contains this instant, so a fixture
   *  can produce `in_session` without the suite knowing what time it is. Every
   *  weekday carries the same pair, and the SECOND session is the one that makes
   *  ruling 12 testable — two slots the same day, on any day of the week. */
  const allDaySessions = (
    first: { opensMinute: number; closesMinute: number },
    second: { opensMinute: number; closesMinute: number },
  ) =>
    [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, sessions: [first, second] }));

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
  // THE HAPPY PATH, AND THE GYM SEEING WHO CAME
  // -------------------------------------------------------------------------

  it(
    "a member marks themselves present and the gym sees them by name",
    async () => {
      const owner = await makeUser("h1-owner");
      const member = await makeUser("h1-member");
      const org = await makeOrg(owner.cookies, "Happy Path Gym");
      await joinAsMember(member.cookies, org, owner.cookies);

      const marked = await mark(org.org.id, member.cookies);
      expect(marked.statusCode).toBe(200);
      const body = JSON.parse(marked.body) as {
        status: string;
        alreadyMarked: boolean;
        visit: Visit;
      };
      expect(body.status).toBe("created");
      expect(body.alreadyMarked).toBe(false);
      expect(body.visit.method).toBe("manual");
      expect(body.visit.day).toBe(await gymToday(org.org.id));

      const day = await readDay(org.org.id, owner.cookies);
      expect(day.people).toHaveLength(1);
      expect(day.people[0]?.userId).toBe(member.userId);
      expect(day.people[0]?.displayName).toBe("Att h1-member");
      // **THE EMAIL IS A KD RULING OF 2026-09-03 AND A KNOWING DEVIATION FROM
      // Part 3 §2.4** (*"gym can see email also"*), whose join-door disclosure
      // changed in the same commit. Asserted against the address this member
      // actually registered with, so a field wired to the WRONG user — the
      // caller's own, say — fails here rather than looking plausible.
      expect(day.people[0]?.email).toBe(member.email);
      expect(day.people[0]?.visits).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );

  // -------------------------------------------------------------------------
  // KD RULING 12 (:27992) — BOTH DIRECTIONS, WHICH IS THE POINT
  // -------------------------------------------------------------------------

  it(
    "a second visit in a DIFFERENT session counts again, and the owner sees two times",
    async () => {
      const owner = await makeUser("r12-owner");
      const member = await makeUser("r12-member");
      const org = await makeOrg(owner.cookies, "Two Slots Gym");
      await joinAsMember(member.cookies, org, owner.cookies);

      // A week whose every day holds two sessions covering the whole clock, so
      // whatever time this suite runs, the member is inside the FIRST one.
      const morning = { opensMinute: 0, closesMinute: 720 };
      const evening = { opensMinute: 720, closesMinute: 1440 };
      const set = await put(
        `/v1/orgs/${org.org.id}/hours`,
        { mode: "scheduled", week: allDaySessions(morning, evening) },
        owner.cookies,
      );
      expect(set.statusCode).toBe(200);

      const first = await mark(org.org.id, member.cookies);
      expect(first.statusCode).toBe(200);
      const firstVisit = (JSON.parse(first.body) as { visit: Visit }).visit;
      expect(firstVisit.hoursStatus).toBe("in_session");
      expect(firstVisit.session).not.toBeNull();

      // THE SECOND SESSION, forced rather than waited for: the row is written
      // directly with the OTHER slot's key, which is what a member returning in
      // the evening produces. Driving it through the route would need the suite
      // to run twice, twelve hours apart.
      const otherSlot =
        firstVisit.session?.opensMinute === morning.opensMinute ? evening : morning;
      await sql`
        INSERT INTO gym_attendance
          (gym_id, user_id, marked_by_user_id, day, method, hours_status,
           session_opens_minute, session_closes_minute, slot_key)
        VALUES (${org.org.id}, ${member.userId}, ${member.userId},
                ${firstVisit.day}::date, 'manual', 'in_session',
                ${otherSlot.opensMinute}, ${otherSlot.closesMinute},
                ${`${String(otherSlot.opensMinute)}-${String(otherSlot.closesMinute)}`})`;

      const day = await readDay(org.org.id, owner.cookies);
      // ONE PERSON, TWO TIMES — Kd's own words, and the shape ruling 14 needs.
      expect(day.people).toHaveLength(1);
      expect(day.people[0]?.visits).toHaveLength(2);
      // AND THE TWO SUMMARY NUMBERS DIFFER, which is the only fixture that can
      // tell them apart: two visits, one person.
      const inSession = day.summary.filter((s) => s.hoursStatus === "in_session");
      expect(inSession).toHaveLength(2);
      expect(inSession.every((s) => s.people === 1)).toBe(true);
      // **THE DAY'S TOTALS ARE WHERE THE TWO NUMBERS DIVERGE, AND THIS FIXTURE
      // IS THE ONLY ONE THAT CAN TELL THEM APART.** Two visits, ONE person — a
      // screen summing the per-slot `people` would print 2 and claim this gym
      // had two members through the door. Per slot they are provably equal (the
      // UNIQUE admits one visit per person per slot), which the mutation sweep
      // proved by surviving a swap of one for the other.
      expect(day.totals.visits).toBe(2);
      expect(day.totals.people).toBe(1);
      expect(day.summary.reduce((n, s) => n + s.people, 0)).toBe(2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the SAME session tapped twice produces ONE row and answers with the first visit",
    async () => {
      const owner = await makeUser("r12b-owner");
      const member = await makeUser("r12b-member");
      const org = await makeOrg(owner.cookies, "Double Tap Gym");
      await joinAsMember(member.cookies, org, owner.cookies);

      const first = await mark(org.org.id, member.cookies);
      const second = await mark(org.org.id, member.cookies);
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);

      const a = JSON.parse(first.body) as { alreadyMarked: boolean; visit: Visit };
      const b = JSON.parse(second.body) as { alreadyMarked: boolean; visit: Visit };
      expect(a.alreadyMarked).toBe(false);
      expect(b.alreadyMarked).toBe(true);
      // The SAME visit, not merely an equal-looking one — the instant is what a
      // second row would move.
      expect(b.visit.markedAt).toBe(a.visit.markedAt);

      const rows = await sql<{ n: string }[]>`
        SELECT count(*) AS n FROM gym_attendance
        WHERE gym_id = ${org.org.id} AND user_id = ${member.userId}`;
      expect(Number(rows[0]?.n)).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a gym with NO sessions gets one attendance per day, however many times somebody taps",
    async () => {
      const owner = await makeUser("r15-owner");
      const member = await makeUser("r15-member");
      const org = await makeOrg(owner.cookies, "Open All Hours Gym");
      await joinAsMember(member.cookies, org, owner.cookies);
      const set = await put(`/v1/orgs/${org.org.id}/hours`, { mode: "open_24h" }, owner.cookies);
      expect(set.statusCode).toBe(200);

      await mark(org.org.id, member.cookies);
      await mark(org.org.id, member.cookies);
      await mark(org.org.id, member.cookies);

      const rows = await sql<{ n: string }[]>`
        SELECT count(*) AS n FROM gym_attendance
        WHERE gym_id = ${org.org.id} AND user_id = ${member.userId}`;
      // KD: *"only one time attandance"* (:28055). There is nothing to tell two
      // taps apart at a gym with no sessions, and the remedy is the gym
      // declaring its sessions — never an invented time window (R0.2).
      expect(Number(rows[0]?.n)).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  // -------------------------------------------------------------------------
  // THE COLUMN THAT FAILS QUIETLY
  // -------------------------------------------------------------------------

  it(
    "the database REFUSES a slot key that does not agree with the session it claims",
    async () => {
      const owner = await makeUser("slot-owner");
      const member = await makeUser("slot-member");
      const org = await makeOrg(owner.cookies, "Slot Guard Gym");
      await joinAsMember(member.cookies, org, owner.cookies);
      const today = await gymToday(org.org.id);

      // A CONSTANT KEY — what a future writer "simplifying" this would produce.
      // Without the CHECK it inserts happily and every gym silently reverts to
      // one visit a day, with no error anywhere and every refusal test still
      // green.
      await expect(
        sql`
          INSERT INTO gym_attendance
            (gym_id, user_id, marked_by_user_id, day, method, hours_status,
             session_opens_minute, session_closes_minute, slot_key)
          VALUES (${org.org.id}, ${member.userId}, ${member.userId}, ${today}::date,
                  'manual', 'in_session', 360, 420, 'attended')`,
      ).rejects.toThrow(/gym_attendance_slot_key_agrees_check/);

      // AND THE OTHER DIRECTION: a window kept on a row that is not in a
      // session. Both are the pairing the reader depends on.
      await expect(
        sql`
          INSERT INTO gym_attendance
            (gym_id, user_id, marked_by_user_id, day, method, hours_status,
             session_opens_minute, session_closes_minute, slot_key)
          VALUES (${org.org.id}, ${member.userId}, ${member.userId}, ${today}::date,
                  'manual', 'outside_hours', 360, 420, 'outside_hours')`,
      ).rejects.toThrow(/gym_attendance_session_pairing_check/);
    },
    TEST_TIMEOUT_MS,
  );

  // -------------------------------------------------------------------------
  // ALL FIVE hours_status VALUES
  // -------------------------------------------------------------------------

  it(
    "a gym that has never set hours records `hours_unset`, not `outside_hours`",
    async () => {
      const owner = await makeUser("s1-owner");
      const member = await makeUser("s1-member");
      const org = await makeOrg(owner.cookies, "Never Answered Gym");
      await joinAsMember(member.cookies, org, owner.cookies);

      const res = await mark(org.org.id, member.cookies);
      const visit = (JSON.parse(res.body) as { visit: Visit }).visit;
      // :26736 ONE LEVEL IN. "Nobody has answered" is not "outside hours", and a
      // reader that folds them together tells a member something FALSE about a
      // gym that has simply not filled the form in (:5807).
      expect(visit.hoursStatus).toBe("hours_unset");
      expect(visit.session).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a 24-hour gym records `open_24h`, and a dated closure BEATS it",
    async () => {
      const owner = await makeUser("s2-owner");
      const member = await makeUser("s2-member");
      const other = await makeUser("s2-other");
      const org = await makeOrg(owner.cookies, "Round The Clock Gym");
      await joinAsMember(member.cookies, org, owner.cookies);
      await joinAsMember(other.cookies, org, owner.cookies);
      const set = await put(`/v1/orgs/${org.org.id}/hours`, { mode: "open_24h" }, owner.cookies);
      expect(set.statusCode).toBe(200);

      const open = await mark(org.org.id, member.cookies);
      expect((JSON.parse(open.body) as { visit: Visit }).visit.hoursStatus).toBe("open_24h");

      // THE CLOSURE WINS OVER THE PATTERN (:26684 §3) — including over a
      // 24-hour flag, which is a pattern like any other.
      const today = await gymToday(org.org.id);
      const closed = await post(
        `/v1/orgs/${org.org.id}/closures`,
        { day: today, note: "Holi" },
        owner.cookies,
      );
      expect(closed.statusCode).toBe(200);

      const afterClose = await mark(org.org.id, other.cookies);
      // AND IT IS NOW REFUSED — KD'S RULING OF 2026-09-03, which REVERSES the
      // chat's call at :26624 §4.4 (*"recorded and marked, never refused"*).
      // His words: *"if a gym has set certain times not 24 hour then if a member
      // comes outside of time should not be able to press i am here"*, and a
      // dated closure is the same question answered by the gym itself.
      //
      // **THE MESSAGE DOES NOT LIST THE WEEKDAY'S USUAL HOURS**, because a dated
      // closure WINS over the weekly pattern (:26684) — telling a member to come
      // at six on a day the gym has said it is shut is the false sentence this
      // refusal exists to avoid.
      expect(afterClose.statusCode).toBe(409);
      const closedBody = JSON.parse(afterClose.body) as { error: string; message: string };
      expect(closedBody.error).toBe("gym_closed_now");
      expect(closedBody.message).toBe("Your gym is closed today, so attendance isn't open.");

      // AND NOTHING WAS WRITTEN. A refusal that still records the visit would be
      // the worst of both: the member is told no and the owner's numbers count
      // them anyway.
      const afterRows = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM gym_attendance
        WHERE gym_id = ${org.org.id} AND user_id = ${other.userId}`;
      expect(afterRows[0]?.n).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a scheduled gym records `in_session` inside its hours and `outside_hours` outside them",
    async () => {
      const owner = await makeUser("s3-owner");
      const inside = await makeUser("s3-in");
      const outside = await makeUser("s3-out");
      const org = await makeOrg(owner.cookies, "Timetable Gym");
      await joinAsMember(inside.cookies, org, owner.cookies);
      await joinAsMember(outside.cookies, org, owner.cookies);

      // WHOLE-CLOCK SESSIONS: whatever time this runs, the tap is inside one.
      const setOpen = await put(
        `/v1/orgs/${org.org.id}/hours`,
        {
          mode: "scheduled",
          week: allDaySessions({ opensMinute: 0, closesMinute: 720 }, { opensMinute: 720, closesMinute: 1440 }),
        },
        owner.cookies,
      );
      expect(setOpen.statusCode).toBe(200);
      const hit = await mark(org.org.id, inside.cookies);
      const hitVisit = (JSON.parse(hit.body) as { visit: Visit }).visit;
      expect(hitVisit.hoursStatus).toBe("in_session");
      expect(hitVisit.session).not.toBeNull();

      // A WEEK THAT CANNOT CONTAIN NOW: one minute, on every weekday, at the
      // instant of midnight — `opensMinute: 0, closesMinute: 1` is inside only
      // during the first minute of a gym's day. That is a 1-in-1440 flake, so
      // the fixture ALSO asserts the minute it is refusing.
      const nowMinuteRows = await sql<{ m: number }[]>`
        SELECT (EXTRACT(HOUR FROM (now() AT TIME ZONE g.timezone))::int * 60
                + EXTRACT(MINUTE FROM (now() AT TIME ZONE g.timezone))::int) AS m
        FROM gyms g WHERE g.id = ${org.org.id}`;
      const nowMinute = nowMinuteRows[0]?.m ?? 0;
      // A one-minute window a full twelve hours from now, so it cannot contain
      // this instant whatever the hour — the fixture's own premise, asserted.
      const far = (nowMinute + 720) % 1440;
      expect(far).not.toBe(nowMinute);
      const setShut = await put(
        `/v1/orgs/${org.org.id}/hours`,
        {
          mode: "scheduled",
          week: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
            weekday,
            sessions: [{ opensMinute: far, closesMinute: far + 1 }],
          })),
        },
        owner.cookies,
      );
      expect(setShut.statusCode).toBe(200);
      const miss = await mark(org.org.id, outside.cookies);
      // REFUSED, per Kd's 2026-09-03 ruling — see the closed-day case above.
      expect(miss.statusCode).toBe(409);
      const missBody = JSON.parse(miss.body) as { error: string; message: string };
      expect(missBody.error).toBe("gym_closed_now");
      // **AND IT SAYS WHEN THE GYM IS OPEN.** A bare "no" leaves a member at a
      // door with no idea when to come back, so the refusal carries the day's
      // real window — computed here from the fixture's own `far`, not copied
      // from the implementation.
      const hh = String(Math.floor(far / 60)).padStart(2, "0");
      const mm = String(far % 60).padStart(2, "0");
      expect(missBody.message).toContain(`${hh}:${mm}`);
      expect(missBody.message).toContain("attendance opens then");

      // NOTHING WAS WRITTEN.
      const missRows = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM gym_attendance
        WHERE gym_id = ${org.org.id} AND user_id = ${outside.userId}`;
      expect(missRows[0]?.n).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the window a visit carries survives the whole timetable being replaced",
    async () => {
      const owner = await makeUser("frz-owner");
      const member = await makeUser("frz-member");
      const org = await makeOrg(owner.cookies, "Frozen Window Gym");
      await joinAsMember(member.cookies, org, owner.cookies);
      const set = await put(
        `/v1/orgs/${org.org.id}/hours`,
        {
          mode: "scheduled",
          week: allDaySessions({ opensMinute: 0, closesMinute: 1439 }, { opensMinute: 1439, closesMinute: 1440 }),
        },
        owner.cookies,
      );
      expect(set.statusCode).toBe(200);
      const before = (JSON.parse((await mark(org.org.id, member.cookies)).body) as { visit: Visit })
        .visit;
      expect(before.session).not.toBeNull();

      // REPLACE THE WEEK ENTIRELY — `PUT /hours` deletes and re-inserts every
      // row, which is exactly why the window is COPIED onto the attendance and
      // not joined at read time. An FK here would dangle or cascade.
      const replaced = await put(
        `/v1/orgs/${org.org.id}/hours`,
        {
          mode: "scheduled",
          week: [{ weekday: 1, sessions: [{ opensMinute: 600, closesMinute: 660 }] }],
        },
        owner.cookies,
      );
      expect(replaced.statusCode).toBe(200);

      const day = await readDay(org.org.id, owner.cookies);
      expect(day.people[0]?.visits[0]?.session).toEqual(before.session);
    },
    TEST_TIMEOUT_MS,
  );

  // -------------------------------------------------------------------------
  // THE GYM'S DAY, ON A PAIR AT OPPOSITE EXTREMES (:26812 §2(a))
  // -------------------------------------------------------------------------

  it(
    "the day stored is the GYM's day — proven on a pair 26 hours apart",
    async () => {
      const owner = await makeUser("tz-owner");
      const east = await makeUser("tz-east");
      const west = await makeUser("tz-west");
      const eastOrg = await makeOrg(owner.cookies, "East Gym", "Pacific/Kiritimati"); // UTC+14
      const westOrg = await makeOrg(owner.cookies, "West Gym", "Etc/GMT+12"); // UTC-12
      await joinAsMember(east.cookies, eastOrg, owner.cookies);
      await joinAsMember(west.cookies, westOrg, owner.cookies);

      const eastToday = await gymToday(eastOrg.org.id);
      const westToday = await gymToday(westOrg.org.id);
      // THE FIXTURE'S OWN PREMISE, ASSERTED RATHER THAN ASSUMED. 26 hours apart
      // means these two calendar dates ALWAYS differ, so a server-zone
      // implementation must be wrong for at least one of them at every instant —
      // which a single non-UTC gym cannot guarantee (:26812 §2(a)).
      expect(eastToday).not.toBe(westToday);

      const e = (JSON.parse((await mark(eastOrg.org.id, east.cookies)).body) as { visit: Visit })
        .visit;
      const w = (JSON.parse((await mark(westOrg.org.id, west.cookies)).body) as { visit: Visit })
        .visit;
      expect(e.day).toBe(eastToday);
      expect(w.day).toBe(westToday);
      expect(e.day).not.toBe(w.day);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "editing the gym's time zone afterwards does not move a visit that already happened",
    async () => {
      const owner = await makeUser("tzmove-owner");
      const member = await makeUser("tzmove-member");
      const org = await makeOrg(owner.cookies, "Moving Zone Gym", "Pacific/Kiritimati");
      await joinAsMember(member.cookies, org, owner.cookies);
      const before = (JSON.parse((await mark(org.org.id, member.cookies)).body) as { visit: Visit })
        .visit;

      const moved = await patch(
        `/v1/orgs/${org.org.id}`,
        { timezone: "Etc/GMT+12" },
        owner.cookies,
      );
      expect(moved.statusCode).toBe(200);
      expect(await gymToday(org.org.id)).not.toBe(before.day);

      // THE STORED DAY IS THE DAY BOTH THE MEMBER AND THE GYM SAW ON SCREEN. A
      // reader that re-derived it would silently move every past visit the day
      // an owner corrected their zone.
      const rows = await sql<{ day: string }[]>`
        SELECT day::text AS day FROM gym_attendance
        WHERE gym_id = ${org.org.id} AND user_id = ${member.userId}`;
      expect(rows[0]?.day).toBe(before.day);
    },
    TEST_TIMEOUT_MS,
  );

  // -------------------------------------------------------------------------
  // THE OWNER'S SWITCH (:26469 §1.4)
  // -------------------------------------------------------------------------

  it(
    "the owner can switch manual marking off, and it is per-gym",
    async () => {
      const owner = await makeUser("sw-owner");
      const member = await makeUser("sw-member");
      const orgA = await makeOrg(owner.cookies, "Switch A Gym");
      const orgB = await makeOrg(owner.cookies, "Switch B Gym");
      await joinAsMember(member.cookies, orgA, owner.cookies);
      await joinAsMember(member.cookies, orgB, owner.cookies);

      // ON BY DEFAULT — Kd's ruling, and the reason is that turning it off today
      // would leave a gym with no way to record anybody at all (:26586).
      const before = await get("/v1/orgs/mine", owner.cookies);
      const mineBefore = JSON.parse(before.body) as {
        orgs: { id: string; manualAttendanceEnabled: boolean }[];
      };
      expect(mineBefore.orgs.every((o) => o.manualAttendanceEnabled)).toBe(true);

      const off = await patch(
        `/v1/orgs/${orgA.org.id}`,
        { manualAttendanceEnabled: false },
        owner.cookies,
      );
      expect(off.statusCode).toBe(200);

      const refused = await mark(orgA.org.id, member.cookies);
      expect(refused.statusCode).toBe(409);
      expect((JSON.parse(refused.body) as { error: string }).error).toBe("manual_attendance_off");

      // PER-GYM: the second gym is untouched, which a single-gym fixture cannot
      // tell from a global switch.
      const stillWorks = await mark(orgB.org.id, member.cookies);
      expect(stillWorks.statusCode).toBe(200);
    },
    TEST_TIMEOUT_MS,
  );

  // -------------------------------------------------------------------------
  // WHO MAY MARK, AND WHO MAY READ (R9.2 + rulings 13 and 18)
  // -------------------------------------------------------------------------

  it(
    "a stranger and a REMOVED member cannot mark; the cross-tenant case is a 404",
    async () => {
      const owner = await makeUser("z-owner");
      const member = await makeUser("z-member");
      const stranger = await makeUser("z-stranger");
      const otherOwner = await makeUser("z-other-owner");
      const org = await makeOrg(owner.cookies, "Guarded Gym");
      const otherOrg = await makeOrg(otherOwner.cookies, "Other Gym");
      await joinAsMember(member.cookies, org, owner.cookies);

      const byStranger = await mark(org.org.id, stranger.cookies);
      expect(byStranger.statusCode).toBe(404);

      // CROSS-TENANT (R9.2): the OTHER gym's owner — staff of a real gym,
      // holding a real uuid — gets 404 on this one, on the mark AND on both
      // reads. A 403 would confirm the gym exists.
      expect((await mark(org.org.id, otherOwner.cookies)).statusCode).toBe(404);
      expect((await get(`/v1/orgs/${org.org.id}/attendance`, otherOwner.cookies)).statusCode).toBe(
        404,
      );
      expect(
        (await get(`/v1/orgs/${org.org.id}/attendance/history`, otherOwner.cookies)).statusCode,
      ).toBe(404);
      // And the same in the other direction, so the test is not passing because
      // one of the two gyms is special.
      expect((await get(`/v1/orgs/${otherOrg.org.id}/attendance`, owner.cookies)).statusCode).toBe(
        404,
      );

      // A REMOVED MEMBER, driven through a real removal rather than an absent
      // row — those are different states and only one of them is this rule.
      expect((await mark(org.org.id, member.cookies)).statusCode).toBe(200);
      await sql`
        UPDATE gym_members SET removed_at = now()
        WHERE gym_id = ${org.org.id} AND user_id = ${member.userId}`;
      expect((await mark(org.org.id, member.cookies)).statusCode).toBe(404);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a TRAINER reads the day by default, and an untoggled staffer is refused",
    async () => {
      const owner = await makeUser("p-owner");
      const trainer = await makeUser("p-trainer");
      const member = await makeUser("p-member");
      const org = await makeOrg(owner.cookies, "Privilege Gym");
      await joinAsMember(member.cookies, org, owner.cookies);
      await mark(org.org.id, member.cookies);

      // A STAFFER MUST BE A MEMBER FIRST — the module's own rule (`not_a_member`
      // is a 404 on the add), and a fixture that skipped it would be testing a
      // journey the product does not have.
      await joinAsMember(trainer.cookies, org, owner.cookies);
      const added = await post(
        `/v1/orgs/${org.org.id}/staff`,
        { email: trainer.email, role: "trainer" },
        owner.cookies,
      );
      expect(added.statusCode).toBe(201);

      // THE HALF KD ACTUALLY RULED: the narrowest role, no ticks edited, reads
      // the list. A test that only proved the refusal below would pass with this
      // default broken (:19560's O124 — a rule has two failure directions).
      const byTrainer = await get(`/v1/orgs/${org.org.id}/attendance`, trainer.cookies);
      expect(byTrainer.statusCode).toBe(200);

      // AND THE OTHER HALF: "the owner can change it".
      const ticked = await put(
        `/v1/orgs/${org.org.id}/staff/${trainer.userId}/privileges`,
        { privileges: ["members.read", "codes.invite"] },
        owner.cookies,
      );
      expect(ticked.statusCode).toBe(200);
      const refused = await get(`/v1/orgs/${org.org.id}/attendance`, trainer.cookies);
      expect(refused.statusCode).toBe(403);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "`attendance.read` round-trips through the DATABASE, not merely the type system",
    async () => {
      const owner = await makeUser("db-owner");
      const staff = await makeUser("db-staff");
      const org = await makeOrg(owner.cookies, "Round Trip Gym");
      await joinAsMember(staff.cookies, org, owner.cookies); // staff must be a member first
      const added = await post(
        `/v1/orgs/${org.org.id}/staff`,
        { email: staff.email, role: "manager" },
        owner.cookies,
      );
      expect(added.statusCode).toBe(201);

      // WITHOUT the widened CHECK in migration `0019` this is where the card
      // fails — everything compiles, every unit test passes, and Postgres
      // refuses the array. The failure belongs here and not on a screen.
      const saved = await put(
        `/v1/orgs/${org.org.id}/staff/${staff.userId}/privileges`,
        { privileges: ["members.read", "attendance.read"] },
        owner.cookies,
      );
      expect(saved.statusCode).toBe(200);
      const rows = await sql<{ privileges: string[] }[]>`
        SELECT privileges FROM gym_staff
        WHERE gym_id = ${org.org.id} AND user_id = ${staff.userId}`;
      expect(rows[0]?.privileges).toContain("attendance.read");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a member of a LAPSED gym can still mark; an ARCHIVED gym refuses",
    async () => {
      const owner = await makeUser("lapse-owner");
      const member = await makeUser("lapse-member");
      const org = await makeOrg(owner.cookies, "Lapsing Gym");
      await joinAsMember(member.cookies, org, owner.cookies);

      // LAPSED — Kd's answer at the plan gate, and :22215's arm A: a lapsed
      // gym's members fall back to the free app, never locked out. The gym still
      // exists and the member still walked in.
      await sql`
        UPDATE subscriptions SET status = 'canceled'
        WHERE owner_type = 'gym' AND owner_id = ${org.org.id}`;
      const lapsed = await mark(org.org.id, member.cookies);
      expect(lapsed.statusCode).toBe(200);

      // ARCHIVED is a different state and DOES refuse: nothing new happens at a
      // gym the product has finished with (:25771).
      await sql`UPDATE gyms SET status = 'archived', archived_at = now() WHERE id = ${org.org.id}`;
      const archived = await mark(org.org.id, member.cookies);
      expect(archived.statusCode).toBe(409);
      const refusal = JSON.parse(archived.body) as { error: string; message: string };
      expect(refusal.error).toBe("org_archived");
      // ROADMAP 2b, review round 1 finding 2: this is the MEMBER's door, so the
      // sentence is the member's word — never the staff's "This business is
      // archived." at a personal trainer's client. A gym reads "gym".
      expect(refusal.message).toBe("This gym is no longer active.");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "nothing on the path asks whether the member has paid the gym",
    async () => {
      // KD, 2026-09-01: *"if a memebr is not part of the gym or have not paid
      // then gym memebr can remove them thas gym responsibility"*. The ONLY
      // condition is a live membership row — this test is the guard against a
      // later chat "improving" the check by adding a dues condition, because
      // there is no such column to add one from and this asserts the door stays
      // open to a member the gym has not been paid by.
      const owner = await makeUser("dues-owner");
      const member = await makeUser("dues-member");
      const org = await makeOrg(owner.cookies, "No Dues Gym");
      await joinAsMember(member.cookies, org, owner.cookies);
      expect((await mark(org.org.id, member.cookies)).statusCode).toBe(200);

      // The gym's remedy for somebody it does not want is `members.remove`, the
      // door it already has — and the SAME live-membership check refuses them.
      const removed = await api().inject({
        method: "DELETE",
        url: `/v1/orgs/${org.org.id}/members/${member.userId}`,
        remoteAddress: nextIp(),
        cookies: owner.cookies,
      });
      expect(removed.statusCode).toBe(200);
      expect((await mark(org.org.id, member.cookies)).statusCode).toBe(404);
    },
    TEST_TIMEOUT_MS,
  );

  // -------------------------------------------------------------------------
  // ONE PERSON'S OWN HISTORY (:27900, :28055)
  // -------------------------------------------------------------------------

  it(
    "a member reads their own history, and the ?userId= filter serves only that person",
    async () => {
      const owner = await makeUser("hist-owner");
      const one = await makeUser("hist-one");
      const two = await makeUser("hist-two");
      const org = await makeOrg(owner.cookies, "History Gym");
      await joinAsMember(one.cookies, org, owner.cookies);
      await joinAsMember(two.cookies, org, owner.cookies);
      await mark(org.org.id, one.cookies);
      await mark(org.org.id, two.cookies);

      const mine = await get(`/v1/orgs/${org.org.id}/attendance/history`, one.cookies);
      expect(mine.statusCode).toBe(200);
      const mineBody = JSON.parse(mine.body) as { attendance: { visits: Visit[] } };
      expect(mineBody.attendance.visits).toHaveLength(1);

      // THE FILTER MUST EXCLUDE, and this is the assertion a silently-inert
      // filter passes without: the OTHER member also attended, so a filter that
      // does nothing returns two.
      const filtered = await get(
        `/v1/orgs/${org.org.id}/attendance/history?userId=${one.userId}`,
        owner.cookies,
      );
      expect(filtered.statusCode).toBe(200);
      const filteredBody = JSON.parse(filtered.body) as { attendance: { visits: Visit[] } };
      expect(filteredBody.attendance.visits).toHaveLength(1);

      // A MEMBER CANNOT READ SOMEBODY ELSE'S by naming them — the fork in the
      // service is authorisation, not convenience.
      //
      // **404 AND NOT 403, which is this module's standing convention rather
      // than this route's choice**: `requirePrivilege` answers 404 for a caller
      // with no staff row at all, so a signed-in stranger holding a uuid learns
      // nothing about the gym (:23711 §2(a)'s ordering). A plain member is on
      // that path — they hold a membership, not authority — so naming somebody
      // else gets the same answer a stranger gets.
      const peeked = await get(
        `/v1/orgs/${org.org.id}/attendance/history?userId=${two.userId}`,
        one.cookies,
      );
      expect(peeked.statusCode).toBe(404);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "one gym's day counts only that gym — the summary is scoped, not just the page",
    async () => {
      // O208 SURVIVED ITS FIRST RUN AND THIS TEST IS WHY IT NOW DIES. The
      // cross-tenant test above proves an OUTSIDER gets 404; it says nothing
      // about what an AUTHORISED owner is shown, and the summary's `WHERE` is a
      // separate query from the page's. Deleting the gym id from it leaks every
      // gym's counts into every console — an IDOR that a 404 test structurally
      // cannot see (:10182's shape: a cross-tenant test that builds ONE tenant).
      const ownerA = await makeUser("scope-a-owner");
      const ownerB = await makeUser("scope-b-owner");
      const memberA = await makeUser("scope-a-member");
      const memberB1 = await makeUser("scope-b-1");
      const memberB2 = await makeUser("scope-b-2");
      const orgA = await makeOrg(ownerA.cookies, "Scope A Gym");
      const orgB = await makeOrg(ownerB.cookies, "Scope B Gym");
      await joinAsMember(memberA.cookies, orgA, ownerA.cookies);
      await joinAsMember(memberB1.cookies, orgB, ownerB.cookies);
      await joinAsMember(memberB2.cookies, orgB, ownerB.cookies);

      await mark(orgA.org.id, memberA.cookies);
      await mark(orgB.org.id, memberB1.cookies);
      await mark(orgB.org.id, memberB2.cookies);

      // The gyms share a timezone, so they share a `day` — which is what makes
      // the unscoped query able to see across them at all.
      const day = await readDay(orgA.org.id, ownerA.cookies);
      expect(day.people).toHaveLength(1);
      const visits = day.summary.reduce((n, s) => n + s.visits, 0);
      const people = day.summary.reduce((n, s) => n + s.people, 0);
      expect(visits).toBe(1);
      expect(people).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a member's history at one gym does not include their visits to another",
    async () => {
      // O209 SURVIVED ITS FIRST RUN AND THIS TEST IS WHY IT NOW DIES. Every
      // history assertion above used a member of ONE gym, so deleting the gym id
      // from the predicate changed nothing any of them could see. The person who
      // exposes it is one who belongs to TWO — and that person is ordinary, not
      // an edge case: a member of two gyms is exactly who this app is for.
      const ownerA = await makeUser("hist2-a-owner");
      const ownerB = await makeUser("hist2-b-owner");
      const both = await makeUser("hist2-both");
      const orgA = await makeOrg(ownerA.cookies, "Hist A Gym");
      const orgB = await makeOrg(ownerB.cookies, "Hist B Gym");
      await joinAsMember(both.cookies, orgA, ownerA.cookies);
      await joinAsMember(both.cookies, orgB, ownerB.cookies);
      await mark(orgA.org.id, both.cookies);
      await mark(orgB.org.id, both.cookies);

      const atA = await get(`/v1/orgs/${orgA.org.id}/attendance/history`, both.cookies);
      expect(atA.statusCode).toBe(200);
      const bodyA = JSON.parse(atA.body) as { attendance: { visits: Visit[] } };
      expect(bodyA.attendance.visits).toHaveLength(1);

      // AND THE OTHER GYM ANSWERS ITS OWN, so the test is not passing because
      // one of the two reads is broken in a compensating direction.
      const atB = await get(`/v1/orgs/${orgB.org.id}/attendance/history`, both.cookies);
      const bodyB = JSON.parse(atB.body) as { attendance: { visits: Visit[] } };
      expect(bodyB.attendance.visits).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a visit at the instant a session ENDS belongs to the session that is STARTING",
    async () => {
      // O205 SURVIVED ITS FIRST RUN. Every other `in_session` fixture uses
      // whole-clock windows, so the half-open boundary (`closes > now`, not
      // `>=`) is never exercised: loosen it and the tap is inside BOTH the
      // session that just ended and the one starting, `ORDER BY opens_minute
      // LIMIT 1` silently picks the EARLIER, and the visit is filed against a
      // session the member was not in. Touching sessions are legal
      // (`flattenWeek`'s rule), so this is reachable rather than theoretical.
      //
      // **THE FIXTURE HAS TO LAND ON THE BOUNDARY MINUTE, WHICH IS THE WHOLE
      // DIFFICULTY, AND THE WAIT BELOW IS WHAT MAKES IT DETERMINISTIC RATHER
      // THAN A ONE-IN-1440 FLAKE.** The window is built FROM the gym's current
      // minute, so if that minute ticks between building it and marking, the
      // fixture is no longer about a boundary and would fail for a reason that
      // is not the code's. Starting only when at least fifteen seconds of the
      // minute remain removes that: the two calls between here and the mark take
      // milliseconds. It is a real wait and it is bounded by one minute.
      // The gym's zone is chosen so the boundary minute is INSIDE the day. At the
      // gym's midnight `start` clamps to 0 and the premise below (0 > 0) fails
      // before the code is even exercised — CI hit that at 18:30 UTC, which is
      // 00:00 in Kolkata. When Kolkata is on its last or first minute the gym
      // lives in Kathmandu instead, fifteen minutes later, whose day is well
      // under way (00:14 / 00:15) — and whose own midnight is 23:45 Kolkata,
      // where Kolkata is fine. The wait below can roll one minute forward,
      // hence the last minute counts too.
      const kolkata = await sql<{ m: number }[]>`
        SELECT (EXTRACT(HOUR FROM (now() AT TIME ZONE 'Asia/Kolkata'))::int * 60
                + EXTRACT(MINUTE FROM (now() AT TIME ZONE 'Asia/Kolkata'))::int) AS m`;
      const kolkataMinute = kolkata[0]?.m ?? 0;
      const timezone = kolkataMinute === 0 || kolkataMinute === 1439 ? "Asia/Kathmandu" : "Asia/Kolkata";

      const owner = await makeUser("bnd-owner");
      const member = await makeUser("bnd-member");
      const org = await makeOrg(owner.cookies, "Boundary Gym", timezone);
      await joinAsMember(member.cookies, org, owner.cookies);

      const secondsIn = async () => {
        const rows = await sql<{ s: number }[]>`
          SELECT EXTRACT(SECOND FROM (now() AT TIME ZONE g.timezone))::int AS s
          FROM gyms g WHERE g.id = ${org.org.id}`;
        return rows[0]?.s ?? 0;
      };
      // Wait ONLY when fewer than fifteen seconds of the gym's minute remain,
      // and then only long enough to reach the next one — at most fifteen
      // seconds. The first version computed this backwards and slept almost a
      // full minute to gain fourteen seconds, which blew the timeout: it is the
      // sleep's LENGTH that is derived from the clock, not its threshold.
      const secs = await secondsIn();
      if (secs > 45) await new Promise((r) => setTimeout(r, (61 - secs) * 1000));

      const rows = await sql<{ m: number; d: number }[]>`
        SELECT (EXTRACT(HOUR FROM (now() AT TIME ZONE g.timezone))::int * 60
                + EXTRACT(MINUTE FROM (now() AT TIME ZONE g.timezone))::int) AS m,
               EXTRACT(ISODOW FROM (now() AT TIME ZONE g.timezone))::int AS d
        FROM gyms g WHERE g.id = ${org.org.id}`;
      const nowMinute = rows[0]?.m ?? 0;
      const weekday = rows[0]?.d ?? 1;
      // Clamped so the pair stays inside the day at either end; the boundary is
      // what matters, not the widths.
      const start = Math.max(0, nowMinute - 60);
      const end = Math.min(1440, nowMinute + 60);
      // The premise: the boundary IS the current minute, and both sides are real
      // windows. Asserted rather than assumed (:26812 §2(a)).
      expect(nowMinute).toBeGreaterThan(start);
      expect(end).toBeGreaterThan(nowMinute);

      const set = await put(
        `/v1/orgs/${org.org.id}/hours`,
        {
          mode: "scheduled",
          week: [
            {
              weekday,
              sessions: [
                { opensMinute: start, closesMinute: nowMinute },
                { opensMinute: nowMinute, closesMinute: end },
              ],
            },
          ],
        },
        owner.cookies,
      );
      expect(set.statusCode).toBe(200);

      const visit = (JSON.parse((await mark(org.org.id, member.cookies)).body) as { visit: Visit })
        .visit;
      expect(visit.hoursStatus).toBe("in_session");
      // THE SESSION THAT IS STARTING, never the one that just ended. Under `>=`
      // this reads `start` instead.
      expect(visit.session?.opensMinute).toBe(nowMinute);
      expect(visit.session?.closesMinute).toBe(end);
    },
    60_000,
  );

  it(
    "an unreadable page marker is a 400, never a silent page one",
    async () => {
      const owner = await makeUser("cur-owner");
      const org = await makeOrg(owner.cookies, "Cursor Gym");
      const res = await get(`/v1/orgs/${org.org.id}/attendance?cursor=nonsense`, owner.cookies);
      expect(res.statusCode).toBe(400);
      expect((JSON.parse(res.body) as { error: string }).error).toBe("bad_cursor");
    },
    TEST_TIMEOUT_MS,
  );

  // -------------------------------------------------------------------------
  // T3 ROUND 1 REGRESSIONS (2026-09-02) — each of these went RED before its fix
  // -------------------------------------------------------------------------

  /** THE SHAPE THE ROUND-1 CURSOR TEST ABOVE COULD NOT SEE. `cursor=nonsense`
   *  has no `|`, so it dies at the FIRST check and says nothing about the
   *  second. This one is well-formed enough to get past that and reach the
   *  `::uuid` cast, which is where a stale marker in a real client's hands
   *  lands — a 500 and a Sentry event for something the caller can do nothing
   *  about. The test above stayed GREEN through the whole defect. */
  it(
    "a page marker whose id is not a uuid is a 400 on BOTH reads, never a 500",
    async () => {
      const owner = await makeUser("cur2-owner");
      const org = await makeOrg(owner.cookies, "Cursor Cast Gym");
      const marker = `${new Date().toISOString()}|not-a-uuid`;
      for (const path of ["attendance", "attendance/history"]) {
        const res = await get(
          `/v1/orgs/${org.org.id}/${path}?cursor=${encodeURIComponent(marker)}`,
          owner.cookies,
        );
        expect(res.statusCode).toBe(400);
        expect((JSON.parse(res.body) as { error: string }).error).toBe("bad_cursor");
      }
    },
    TEST_TIMEOUT_MS,
  );

  /** THE FILTER HAD NO TEST AT ALL, WHICH IS WHY IT COULD SHIP DEAD. The schema
   *  emitted `status` while the service read `query.statuses`, so it parsed,
   *  validated and was thrown away: an owner asking for the exceptions saw every
   *  visit of the day (:5807). 23 green tests, a green typecheck and a 23-mutant
   *  sweep all passed over it, because none of them sent the parameter.
   *
   *  **BOTH DIRECTIONS, and the second is the one a lazy fix breaks:** a filter
   *  that excludes must also INCLUDE, and an EMPTY filter must mean "no filter"
   *  rather than `= ANY('{}')`, which matches nobody.
   *
   *  **THE FIXTURE IS TWO PEOPLE AND THREE VISITS BECAUSE THE FIRST VERSION OF
   *  IT COULD NOT SEE WHAT THE FILTER DOES.** It used one member of a gym that
   *  had never set hours, so every row was `hours_unset` and every question had
   *  the same answer: "narrows the PEOPLE" and "narrows the VISITS" are
   *  indistinguishable when nobody holds two statuses. `getGymAttendanceDay`
   *  narrows the PAGE — the inner `page` CTE picks WHO, and the outer join then
   *  fetches **every** visit those people made — so a member who set off the
   *  filter with one visit is shown with ALL of theirs, which is the point of an
   *  exceptions filter and is not derivable from a one-status day. Adding the
   *  predicate to the outer join left the old fixture green (measured). */
  it(
    "the day filter narrows the PEOPLE, keeps all of their visits, and clearing it shows everybody",
    async () => {
      const owner = await makeUser("filt-owner");
      const member = await makeUser("filt-member");
      const other = await makeUser("filt-other");
      const org = await makeOrg(owner.cookies, "Filter Gym");
      await joinAsMember(member.cookies, org, owner.cookies);
      await joinAsMember(other.cookies, org, owner.cookies);

      // A gym that has never set hours, so a REAL mark produces `hours_unset`
      // for both of them — and the order they arrive in is the order the page
      // returns them in.
      const marked = await mark(org.org.id, member.cookies);
      expect(marked.statusCode).toBe(200);
      expect((JSON.parse(marked.body) as { visit: Visit }).visit.hoursStatus).toBe("hours_unset");
      expect((await mark(org.org.id, other.cookies)).statusCode).toBe(200);

      // THE SECOND STATUS IS WRITTEN DIRECTLY, for the bound test's reason: the
      // route decides the status from the gym's own clock, so producing a
      // second one through the API would mean rewriting the timetable and
      // waiting — the fixture would be measuring the clock, not the filter.
      const today = await gymToday(org.org.id);
      await sql`
        INSERT INTO gym_attendance
          (gym_id, user_id, marked_by_user_id, day, method, hours_status,
           session_opens_minute, session_closes_minute, slot_key)
        VALUES (${org.org.id}, ${member.userId}, ${member.userId}, ${today}::date,
                'manual', 'outside_hours', null, null, 'outside_hours')`;

      const all = await readDay(org.org.id, owner.cookies);
      expect(all.people.map((p) => p.userId)).toEqual([member.userId, other.userId]);

      // NARROWS THE PEOPLE: only the member with an out-of-hours visit is on the
      // page, and the one who came in normally is gone.
      const exceptions = await readDay(org.org.id, owner.cookies, "?statuses=outside_hours");
      expect(exceptions.people.map((p) => p.userId)).toEqual([member.userId]);

      // AND KEEPS ALL OF THEIR VISITS. This is the assertion the old fixture
      // could not make: two visits come back, only ONE of which matches the
      // filter. Adding the predicate to the outer join turns this red.
      expect(exceptions.people[0]?.visits.map((v) => v.hoursStatus).sort()).toEqual([
        "hours_unset",
        "outside_hours",
      ]);

      // MATCHES NOBODY: no visit that day was inside a session.
      const inSession = await readDay(org.org.id, owner.cookies, "?statuses=in_session");
      expect(inSession.people).toHaveLength(0);

      // TWO AT ONCE is the useful case Kd's ruling names, and a comma-separated
      // list is why the parameter is shaped this way at all.
      const both = await readDay(
        org.org.id,
        owner.cookies,
        "?statuses=outside_hours,hours_unset",
      );
      expect(both.people.map((p) => p.userId)).toEqual([member.userId, other.userId]);

      // CLEARED. The schema's own promise is that empty and absent are the same
      // thing; without the empty→undefined mapping this returns nobody.
      const cleared = await readDay(org.org.id, owner.cookies, "?statuses=");
      expect(cleared.people.map((p) => p.userId)).toEqual([member.userId, other.userId]);

      // AND THE DAY'S SHAPE IS DELIBERATELY NOT FILTERED — it describes the
      // whole day, so an owner's totals and per-slot lines must not move when a
      // filter is applied. **This asserts `summary`.** The line here used to
      // read `totals` under a comment about the summary: a different query,
      // separately scoped, so the sentence and the assertion were about two
      // different things and the summary's own claim had no observer.
      expect(inSession.summary).toEqual(all.summary);
      expect(exceptions.summary).toEqual(all.summary);
      expect(inSession.totals).toEqual({ visits: 3, people: 2 });
      expect(inSession.totals).toEqual(all.totals);
    },
    TEST_TIMEOUT_MS,
  );

  /** A LIST PARAMETER HAS TWO HONEST SPELLINGS AND ONE OF THEM WAS A 400.
   *
   *  `?statuses=a&statuses=b` is how a great many clients send a list — and
   *  Fastify's parser turns it into an ARRAY, which `z.string()` refused. The
   *  same shape refused `?statuses=a,a`: `.max(5)` counted repeats, so asking
   *  twice for one thing looked like asking for six. Both were unreachable
   *  while the parameter itself was dead, and both became live the moment it
   *  started working — which is why they are pinned before a screen exists. */
  it(
    "the filter accepts the repeated-key spelling and a repeated value",
    async () => {
      const owner = await makeUser("filtsp-owner");
      const member = await makeUser("filtsp-member");
      const org = await makeOrg(owner.cookies, "Filter Spelling Gym");
      await joinAsMember(member.cookies, org, owner.cookies);
      expect((await mark(org.org.id, member.cookies)).statusCode).toBe(200);

      const repeatedKey = await readDay(
        org.org.id,
        owner.cookies,
        "?statuses=outside_hours&statuses=hours_unset",
      );
      expect(repeatedKey.people.map((p) => p.userId)).toEqual([member.userId]);

      // SIX ITEMS, ONE DISTINCT VALUE. Counted before the dedupe this is over
      // the ceiling and answers 400 to a request that asks for one thing.
      const repeatedValue = await readDay(
        org.org.id,
        owner.cookies,
        `?statuses=${new Array(6).fill("hours_unset").join(",")}`,
      );
      expect(repeatedValue.people.map((p) => p.userId)).toEqual([member.userId]);

      // AND THE CEILING STILL REFUSES SOMETHING: a value that is not a status
      // is a 400 whichever spelling it arrives in.
      const nonsense = await get(`/v1/orgs/${org.org.id}/attendance?statuses=nope`, owner.cookies);
      expect(nonsense.statusCode).toBe(400);
    },
    TEST_TIMEOUT_MS,
  );

  /** THE LIMITERS SHIPPED WITH NO OBSERVER, WHICH IS HOW A WRONG CEILING GOES
   *  UNNOTICED. They were added as a fix, in a round that could not see them —
   *  and one of the two numbers turned out to be sized for the wrong shape of
   *  traffic (`routes.ts`, the per-IP ceiling on the mark).
   *
   *  **THE PER-USER DIMENSION IS THE ONE A TEST CAN DRIVE HERE, and it is clean
   *  because `nextIp()` gives every inject its own address** — so nothing in
   *  this suite accumulates against the IP bucket and this cannot pass or fail
   *  for the other dimension's reasons.
   *
   *  **WHAT IS STILL NOT OBSERVED, stated rather than implied: the reads'
   *  600/hour.** Driving it is 601 requests, which is a benchmark rather than a
   *  test. What IS driven is that the two limiters are two buckets — the claim
   *  the split was made for — so a member who has spent the write allowance can
   *  still read. */
  it(
    "the mark limit refuses the 31st tap in an hour, and the reads keep their own bucket",
    async () => {
      const owner = await makeUser("rl-owner");
      const member = await makeUser("rl-member");
      const org = await makeOrg(owner.cookies, "Rate Limit Gym");
      await joinAsMember(member.cookies, org, owner.cookies);

      // THIRTY IS THE CEILING AND EVERY ONE OF THEM IS A 200. The same slot
      // tapped again is idempotent (R3.5), so this drives the limiter and
      // nothing else — and the single row it leaves behind is asserted below,
      // which makes the loop a second observer of that idempotency.
      for (let i = 0; i < 30; i += 1) {
        expect((await mark(org.org.id, member.cookies)).statusCode).toBe(200);
      }
      const refused = await mark(org.org.id, member.cookies);
      expect(refused.statusCode).toBe(429);
      expect((JSON.parse(refused.body) as { error: string }).error).toBe("rate_limited");

      // THE SPLIT IS REAL: the member who has spent the write bucket can still
      // read their own history, and the owner's day read is untouched.
      const own = await get(`/v1/orgs/${org.org.id}/attendance/history`, member.cookies);
      expect(own.statusCode).toBe(200);
      expect((await readDay(org.org.id, owner.cookies)).totals).toEqual({ visits: 1, people: 1 });
    },
    TEST_TIMEOUT_MS,
  );

  /** A BOUND DERIVED FROM AN INVARIANT THE WRITER DOES NOT ENFORCE IS NOT A
   *  BOUND. Both ceilings were computed from "the finest timetable is 24 slots",
   *  which is true of ONE timetable — and a visit stores a FROZEN COPY of its
   *  window, so a gym replacing its hours during the day makes more distinct
   *  windows than any timetable has slots. Past the ceiling the server's own
   *  response failed its own schema: a 500 on that date, for ever, since nothing
   *  in this product deletes an attendance row.
   *
   *  One member with 40 distinct windows drives BOTH halves at once — 40 summary
   *  groups (was `.max(29)`) and 40 visits on one person (was `.max(24)`). */
  it(
    "a day with more distinct session windows than any timetable has slots still reads",
    async () => {
      const owner = await makeUser("bound-owner");
      const member = await makeUser("bound-member");
      const org = await makeOrg(owner.cookies, "Bound Gym");
      await joinAsMember(member.cookies, org, owner.cookies);
      const today = await gymToday(org.org.id);

      // WRITTEN DIRECTLY, because reaching 40 windows through the API would mean
      // 40 timetable edits and 40 taps at 40 different minutes — the fixture
      // would be measuring the clock rather than the bound.
      const windows = Array.from({ length: 40 }, (_, i) => ({
        opens: i * 10,
        closes: i * 10 + 5,
      }));
      for (const w of windows) {
        await sql`
          INSERT INTO gym_attendance
            (gym_id, user_id, marked_by_user_id, day, method, hours_status,
             session_opens_minute, session_closes_minute, slot_key)
          VALUES (${org.org.id}, ${member.userId}, ${member.userId}, ${today}::date,
                  'manual', 'in_session', ${w.opens}, ${w.closes},
                  ${`${String(w.opens)}-${String(w.closes)}`})`;
      }

      const res = await get(`/v1/orgs/${org.org.id}/attendance`, owner.cookies);
      expect(res.statusCode).toBe(200);

      const day = (JSON.parse(res.body) as { attendance: AttendanceDay }).attendance;
      expect(day.summary).toHaveLength(windows.length);
      expect(day.people[0]?.visits).toHaveLength(windows.length);
      // ONE PERSON, forty visits — the number Kd's ruling 12 exists to make
      // visible, and the totals must say so.
      expect(day.totals).toEqual({ visits: windows.length, people: 1 });
    },
    TEST_TIMEOUT_MS,
  );

  /** THE BODY IS EMPTY BY DESIGN AND NOW BY ENFORCEMENT. The route's own comment
   *  calls the empty body a security decision — the server picks the day, the
   *  method and the slot — but nothing parsed it, so `.strict()` was a promise
   *  no code kept. */
  it(
    "the mark route refuses a body that tries to name anything",
    async () => {
      const owner = await makeUser("body-owner");
      const member = await makeUser("body-member");
      const org = await makeOrg(owner.cookies, "Body Gym");
      await joinAsMember(member.cookies, org, owner.cookies);

      const res = await post(
        `/v1/orgs/${org.org.id}/attendance`,
        { day: "2020-01-01", method: "qr" },
        member.cookies,
      );
      expect(res.statusCode).toBe(400);

      // AND THE ORDINARY CALL IS UNTOUCHED — a POST with no keys is the normal
      // case and must stay a 200.
      expect((await mark(org.org.id, member.cookies)).statusCode).toBe(200);
    },
    TEST_TIMEOUT_MS,
  );

  // -------------------------------------------------------------------------
  // THE DATE WINDOW (Kd's calendar, 2026-09-03) — `?from=`/`?to=` on the
  // history read, so a screen can ask for a MONTH instead of paging backwards
  // from today. The walk this replaces is what drew EMPTY MONTHS on the workout
  // calendar for anyone whose history was deeper than the cap (:4434).
  // -------------------------------------------------------------------------

  /** ONE VISIT ON A NAMED GYM DAY, with `marked_at` set FROM that day instead of
   *  defaulting to `now()`.
   *
   *  **THE DEFAULT WOULD QUIETLY DESTROY THE ORDER THESE TESTS REST ON.** Every
   *  row a fixture writes in one run takes the same `now()`, so `ORDER BY
   *  marked_at DESC, id DESC` falls through to a random uuid and "the older rows
   *  come last" stops being true — which is exactly the property the paging test
   *  needs in order to SEE a filter that was dropped after page one. Noon UTC is
   *  17:30 in `Asia/Kolkata`, so `day` and `marked_at` agree the way a real gym
   *  writes them rather than being two unrelated fixtures.
   *
   *  `hours_unset` because these gyms never set hours, which is what a real mark
   *  would store — and `slot_key` must equal it or
   *  `gym_attendance_slot_key_agrees_check` raises 23514 (:28221 §2). */
  const visitOn = (gymId: string, userId: string, day: string) => sql`
    INSERT INTO gym_attendance
      (gym_id, user_id, marked_by_user_id, day, marked_at, method, hours_status, slot_key)
    VALUES (${gymId}, ${userId}, ${userId}, ${day}::date,
            ${`${day}T12:00:00Z`}::timestamptz, 'manual', 'hours_unset', 'hours_unset')`;

  /** THE WHOLE POINT OF THE CARD, AND THE TILING IS THE HALF THAT IS EASY TO GET
   *  WRONG.
   *
   *  A calendar asks for one month at a time, so the months must PARTITION the
   *  history: every visit in exactly one of them, none in two and none in
   *  neither. A CLOSED window cannot promise that — `to` inclusive counts the
   *  first of the month twice if the next request starts there, and skips it if
   *  the next request starts a day later. **So the four fixture days sit on the
   *  two boundaries that can go wrong** (the last day of a month and the first of
   *  the next), and the three windows are asserted to reconstruct the unwindowed
   *  read exactly.
   *
   *  **EACH BOUND ALSO WORKS ALONE**, which is not decoration: "everything since
   *  I joined" sends only `from`, and a schema that required them in pairs would
   *  refuse it. :4483's F3 is the reason this is asserted rather than assumed —
   *  the ordering refine only fires when BOTH are present, so a one-bound request
   *  travels a path no two-bound test covers. */
  it(
    "a month window answers that month and neither of its neighbours, and adjacent months tile",
    async () => {
      const owner = await makeUser("win-owner");
      const member = await makeUser("win-member");
      const org = await makeOrg(owner.cookies, "Window Gym");
      await joinAsMember(member.cookies, org, owner.cookies);

      // THE TWO BOUNDARIES THAT CAN GO WRONG, twice over: the last day of a
      // month and the first day of the next.
      for (const day of ["2026-08-31", "2026-09-01", "2026-09-30", "2026-10-01"]) {
        await visitOn(org.org.id, member.userId, day);
      }

      const all = await readHistory(org.org.id, member.cookies);
      expect(daysOf(all)).toEqual(["2026-10-01", "2026-09-30", "2026-09-01", "2026-08-31"]);

      // SEPTEMBER — half-open, so it holds the 1st and the 30th and neither
      // neighbour. A `to` read as INCLUSIVE puts 2026-10-01 in here too.
      const september = await readHistory(
        org.org.id,
        member.cookies,
        "?from=2026-09-01&to=2026-10-01",
      );
      expect(daysOf(september)).toEqual(["2026-09-30", "2026-09-01"]);

      const august = await readHistory(
        org.org.id,
        member.cookies,
        "?from=2026-08-01&to=2026-09-01",
      );
      expect(daysOf(august)).toEqual(["2026-08-31"]);

      const october = await readHistory(
        org.org.id,
        member.cookies,
        "?from=2026-10-01&to=2026-11-01",
      );
      expect(daysOf(october)).toEqual(["2026-10-01"]);

      // THE TILING ITSELF, asserted rather than inferred from the three lines
      // above: August's `to` IS September's `from` and September's `to` IS
      // October's `from`, so stepping month by month reconstructs the whole
      // history with nothing counted twice and nothing lost between two
      // requests. Sorted because the union of three descending pages is not
      // itself descending.
      const tiled = [...daysOf(august), ...daysOf(september), ...daysOf(october)].sort();
      expect(tiled).toEqual([...daysOf(all)].sort());
      expect(new Set(tiled).size).toBe(tiled.length);

      // EACH BOUND ALONE. `from` is "everything since"; `to` is "everything
      // before". Neither reaches the ordering refine, which only runs on a pair.
      const since = await readHistory(org.org.id, member.cookies, "?from=2026-09-01");
      expect(daysOf(since)).toEqual(["2026-10-01", "2026-09-30", "2026-09-01"]);

      const before = await readHistory(org.org.id, member.cookies, "?to=2026-09-01");
      expect(daysOf(before)).toEqual(["2026-08-31"]);
    },
    TEST_TIMEOUT_MS,
  );

  /** THE CARD'S ONE DECISION, AND UNTIL T3 ROUND 1 IT WAS HELD BY PROSE ALONE.
   *
   *  The window filters `day` — the GYM's calendar date, frozen at write time —
   *  and NOT `marked_at`, the instant. The whole argument is on
   *  `attendanceHistoryQuerySchema`, `DECISIONS-TRIGGERS.md` carries a phrase
   *  warning against "correcting" it to instants for consistency with
   *  `/v1/workouts`, and **the reviewer made exactly that edit and all 34 tests
   *  stayed green.**
   *
   *  **WHY EVERY OTHER FIXTURE IS BLIND TO IT, and it is the reusable part:**
   *  they all write `marked_at` at noon UTC on the row's own day, so `day` and
   *  any instant-derived date agree in every row the suite creates. **The
   *  fixture that makes the paging property observable is the same fixture that
   *  erases this one** — a fixture can be well built for one guarantee and be
   *  the reason a neighbouring guarantee has no observer at all.
   *
   *  **SO THE ROW HAS TO BE ONE WHERE THE TWO DISAGREE, and it is an ordinary
   *  row rather than a contrived one**: a member tapping in at 01:30 on 1
   *  October at a gym in `Asia/Kolkata` is stamped `day = 2026-10-01` while the
   *  instant is still `2026-09-30T20:00:00Z`. Filing by the instant puts that
   *  visit in SEPTEMBER — a square in the wrong month, which is the defect §1
   *  of the entry describes and could not previously prove.
   *
   *  **BOTH DIRECTIONS ARE ASSERTED because the mutant moves it BOTH ways**: it
   *  is added to September AND removed from October, and a test checking only
   *  one of those would still pass under half of the edit. */
  it(
    "a visit whose GYM day and UTC date differ is filed by the gym's day",
    async () => {
      const owner = await makeUser("winunit-owner");
      const member = await makeUser("winunit-member");
      // `Asia/Kolkata` is UTC+5:30, so any gym-local instant before 05:30 falls
      // on the PREVIOUS UTC date — which is the disagreement this test needs.
      const org = await makeOrg(owner.cookies, "Window Unit Gym");
      await joinAsMember(member.cookies, org, owner.cookies);

      // 01:30 ON 1 OCTOBER, GYM TIME. `day` is what the mark route would stamp
      // for that instant, so this is a row the product really produces.
      await sql`
        INSERT INTO gym_attendance
          (gym_id, user_id, marked_by_user_id, day, marked_at, method, hours_status, slot_key)
        VALUES (${org.org.id}, ${member.userId}, ${member.userId}, '2026-10-01'::date,
                '2026-09-30T20:00:00Z'::timestamptz, 'manual', 'hours_unset', 'hours_unset')`;

      // A CONTROL ROW WHOSE TWO DATES AGREE, so neither assertion below can pass
      // by the window being broken in some wholesale way.
      await visitOn(org.org.id, member.userId, "2026-09-15");

      // SEPTEMBER HOLDS ONLY THE SEPTEMBER VISIT. Filed by `marked_at`, the
      // 1 October visit lands here too — the wrong square.
      expect(
        daysOf(await readHistory(org.org.id, member.cookies, "?from=2026-09-01&to=2026-10-01")),
      ).toEqual(["2026-09-15"]);

      // AND OCTOBER STILL HAS IT. This is the half that a `from`-only correction
      // breaks: by the instant, the visit is before October begins and vanishes
      // from both months.
      expect(
        daysOf(await readHistory(org.org.id, member.cookies, "?from=2026-10-01&to=2026-11-01")),
      ).toEqual(["2026-10-01"]);
    },
    TEST_TIMEOUT_MS,
  );

  /** THE WINDOW MUST NOT LOOSEN THE TENANCY CLAUSE IT SITS BESIDE.
   *
   *  A date predicate is added to the same `WHERE` that carries `gym_id` and
   *  `user_id`, and the edit that replaces a clause instead of extending it is
   *  ordinary rather than exotic. **The observer has to be a member of TWO gyms
   *  who came to both in the SAME month** — with one membership there is nothing
   *  to leak, which is the gap O209 sat in for a whole card (:28221 §3b), and
   *  with visits in different months a broken window looks correct. */
  it(
    "a windowed read is still scoped to ONE gym, for a member of two",
    async () => {
      const ownerA = await makeUser("win2-a-owner");
      const ownerB = await makeUser("win2-b-owner");
      const both = await makeUser("win2-both");
      const orgA = await makeOrg(ownerA.cookies, "Window A Gym");
      const orgB = await makeOrg(ownerB.cookies, "Window B Gym");
      await joinAsMember(both.cookies, orgA, ownerA.cookies);
      await joinAsMember(both.cookies, orgB, ownerB.cookies);

      // THE SAME MONTH AT BOTH GYMS, and deliberately not the same DAY: two
      // rows on one day would also be told apart by the UNIQUE, so distinct
      // days keep the fixture about the window rather than about the constraint.
      await visitOn(orgA.org.id, both.userId, "2026-09-10");
      await visitOn(orgB.org.id, both.userId, "2026-09-11");

      const september = "?from=2026-09-01&to=2026-10-01";
      expect(daysOf(await readHistory(orgA.org.id, both.cookies, september))).toEqual([
        "2026-09-10",
      ]);
      // AND THE OTHER GYM ANSWERS ITS OWN, so this cannot pass because one of
      // the two reads is broken in a compensating direction.
      expect(daysOf(await readHistory(orgB.org.id, both.cookies, september))).toEqual([
        "2026-09-11",
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  /** THE FILTER HAS TO BE ON EVERY PAGE, AND THE SECOND PAGE IS WHERE IT GETS
   *  LOST.
   *
   *  This is the web calendar's own M33 one layer down (:4622): a window applied
   *  to the first read and forgotten on the next serves a neighbouring month's
   *  visits the moment somebody presses for more — and a screen would draw them
   *  onto squares of a month they did not happen in, which to a user is the app
   *  inventing visits.
   *
   *  **THE FIXTURE IS BUILT SO THE MISSING FILTER IS VISIBLE**: the
   *  out-of-window rows are OLDER than every in-window row, so they sort last
   *  and can only surface on page two. Page one is full at
   *  `ATTENDANCE_PAGE_LIMIT`, so the second page holds exactly one row when the
   *  window holds and six when it does not. */
  it(
    "the window still holds on the SECOND page",
    async () => {
      const owner = await makeUser("winpg-owner");
      const member = await makeUser("winpg-member");
      const org = await makeOrg(owner.cookies, "Window Paging Gym");
      await joinAsMember(member.cookies, org, owner.cookies);

      /** 101 CONSECUTIVE DAYS INSIDE THE WINDOW plus five OLDER days outside it,
       *  written in two statements because 106 round trips is a minute of test
       *  time for nothing.
       *
       *  **`AT TIME ZONE 'UTC'` IS EXPLICIT AND :26220 §3 IS WHY.** A naive
       *  timestamp cast to `timestamptz` is resolved in the session's `TimeZone`
       *  GUC, which nothing in this repo sets — so the same fixture would carry
       *  different instants on a differently-configured database, and only the
       *  ORDER matters here. */
      const fill = (fromDay: string, toDay: string) => sql`
        INSERT INTO gym_attendance
          (gym_id, user_id, marked_by_user_id, day, marked_at, method, hours_status, slot_key)
        SELECT ${org.org.id}, ${member.userId}, ${member.userId}, d::date,
               ((d::date)::timestamp + interval '12 hours') AT TIME ZONE 'UTC',
               'manual', 'hours_unset', 'hours_unset'
        FROM generate_series(${fromDay}::date, ${toDay}::date, interval '1 day') AS d`;

      // 2026-01-01 … 2026-04-11 is 101 days: one more than a full page.
      await fill("2026-01-01", "2026-04-11");
      // FIVE OLDER DAYS OUTSIDE IT — the rows a dropped filter would hand back.
      await fill("2025-12-27", "2025-12-31");

      const window = "from=2026-01-01&to=2026-05-01";
      const page1 = await readHistory(org.org.id, member.cookies, `?${window}`);
      expect(page1.visits).toHaveLength(100);
      expect(page1.visits[0]?.day).toBe("2026-04-11");
      expect(page1.visits[99]?.day).toBe("2026-01-02");
      expect(page1.nextCursor).not.toBeNull();

      const page2 = await readHistory(
        org.org.id,
        member.cookies,
        `?${window}&cursor=${encodeURIComponent(page1.nextCursor ?? "")}`,
      );
      // ONE ROW, NOT SIX. Without the window on this read the five December days
      // follow it, because they are older than everything on page one.
      expect(daysOf(page2)).toEqual(["2026-01-01"]);
      expect(page2.nextCursor).toBeNull();

      // THE POSITIVE CONTROL: those December rows DO exist and ARE reachable, so
      // the assertion above cannot be passing because the fixture never wrote
      // them. Same cursor, no window — the five come back.
      const unwindowed = await readHistory(
        org.org.id,
        member.cookies,
        `?cursor=${encodeURIComponent(page1.nextCursor ?? "")}`,
      );
      expect(daysOf(unwindowed)).toEqual([
        "2026-01-01",
        "2025-12-31",
        "2025-12-30",
        "2025-12-29",
        "2025-12-28",
        "2025-12-27",
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  /** A FULL PAGE WITH NOTHING BEHIND IT IS THE END, AND THE OLD TEST FOR THIS
   *  COULD NOT SEE THE DIFFERENCE.
   *
   *  The paging test above writes 101 days precisely so a second page EXISTS, so
   *  it is satisfied by any rule that hands out a cursor on a full page —
   *  including `rows.length === limit`, which cannot tell "full, and there is
   *  more" from "full, and that was everything". **Exactly
   *  `ATTENDANCE_PAGE_LIMIT` visits is the one input where the two rules
   *  disagree**, and it is the input nobody writes a fixture for.
   *
   *  **WHAT THE MEMBER SAW: a calendar captioned *"This month has more visits
   *  than this view can show, so some days may be missing"* over a grid on which
   *  every single day was drawn** — the app calling its own complete answer
   *  incomplete (:5807). It needs 100 visits in one month, which the 24-sessions
   *  cap makes reachable at 3–4 a day; *rare* is not a reason to print something
   *  false, which is :4355's own correction.
   *
   *  The control matters as much as the assertion: 100 in the window must still
   *  RETURN 100. A fix that made the cursor honest by serving 99 would pass a
   *  bare `nextCursor === null`. */
  it(
    "a month holding exactly one page of visits says there is no second page",
    async () => {
      const owner = await makeUser("winexact-owner");
      const member = await makeUser("winexact-member");
      const org = await makeOrg(owner.cookies, "Exact Page Gym");
      await joinAsMember(member.cookies, org, owner.cookies);

      // 2026-01-01 … 2026-04-10 is 100 days: a page with nothing behind it.
      // `AT TIME ZONE 'UTC'` for the reason the paging fixture states — only the
      // ORDER matters and a naive cast would resolve in the session's GUC.
      await sql`
        INSERT INTO gym_attendance
          (gym_id, user_id, marked_by_user_id, day, marked_at, method, hours_status, slot_key)
        SELECT ${org.org.id}, ${member.userId}, ${member.userId}, d::date,
               ((d::date)::timestamp + interval '12 hours') AT TIME ZONE 'UTC',
               'manual', 'hours_unset', 'hours_unset'
        FROM generate_series('2026-01-01'::date, '2026-04-10'::date, interval '1 day') AS d`;

      const page = await readHistory(org.org.id, member.cookies, "?from=2026-01-01&to=2026-05-01");
      expect(page.visits).toHaveLength(100);
      expect(page.nextCursor).toBeNull();

      // AND THE OTHER DIRECTION, so this cannot pass on a route that never
      // pages: one more visit in the same window and the cursor comes back.
      await visitOn(org.org.id, member.userId, "2026-04-11");
      const full = await readHistory(org.org.id, member.cookies, "?from=2026-01-01&to=2026-05-01");
      expect(full.visits).toHaveLength(100);
      expect(full.nextCursor).not.toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  /** THE SAME DEFECT ON THE OWNER'S SCREEN, WHERE IT IS EASIER TO REACH AND
   *  WORSE WHEN IT LANDS.
   *
   *  A day with exactly `ATTENDANCE_PAGE_LIMIT` people — an ordinary Monday at a
   *  300-member gym — handed the console a cursor to nowhere. That drew a *Show
   *  more people* button which added nobody, and made `searchCoversEverybody`
   *  answer NO, so a name that had not come back *"Nobody by that name in the
   *  people loaded so far — load the rest to search them too"* while the rest
   *  were already on screen: an owner sent hunting for a member who never came
   *  (:5807).
   *
   *  **THE USERS ARE WRITTEN DIRECTLY AND THE EMAIL PATTERN IS LOAD-BEARING.**
   *  A hundred `register` + `login` round trips is a minute of test time for a
   *  property this test does not depend on — and `orgatt-t-…@example.com` is
   *  what this suite's own `cleanup` deletes by, so a bulk insert under any other
   *  pattern would leave a hundred rows behind for every later run.
   *
   *  Membership is deliberately not created: the day read joins `gym_attendance`
   *  to `users` and asks nothing of `gym_members`, so adding rows this query
   *  never touches would make the fixture describe a query that does not exist. */
  it(
    "a day holding exactly one page of people says there is no second page",
    async () => {
      const owner = await makeUser("dayexact-owner");
      const org = await makeOrg(owner.cookies, "Exact Day Gym");
      const day = await gymToday(org.org.id);

      /** **THE ARRIVAL MINUTE IS DERIVED FROM `n` AND THAT IS NOT DECORATION.**
       *  The page orders by `(min(marked_at), user_id)`, so people sharing one
       *  instant fall through to a random uuid and "the 101st sorts last" stops
       *  being true — :31921 §3's own lesson, which is why that fixture sets
       *  `marked_at` rather than defaulting it. Ordering by `n` keeps the extra
       *  person at the END across both calls, so the page of 100 is the same
       *  hundred before and after. */
      const fillPeople = async (from: number, to: number) => {
        await sql`
          INSERT INTO users (email, display_name)
          SELECT 'orgatt-t-dayexact-' || n || '@example.com', 'Att Day ' || n
          FROM generate_series(${from}::int, ${to}::int) AS n`;
        await sql`
          INSERT INTO gym_attendance
            (gym_id, user_id, marked_by_user_id, day, marked_at, method, hours_status, slot_key)
          SELECT ${org.org.id}, u.id, u.id, ${day}::date,
                 (${day}::timestamp + interval '6 hours' + n * interval '1 minute')
                   AT TIME ZONE 'UTC',
                 'manual', 'hours_unset', 'hours_unset'
          FROM generate_series(${from}::int, ${to}::int) AS n
          JOIN users u ON u.email = 'orgatt-t-dayexact-' || n || '@example.com'`;
      };

      await fillPeople(1, 100);
      const page = await readDay(org.org.id, owner.cookies);
      expect(page.people).toHaveLength(100);
      expect(page.totals.people).toBe(100);
      expect(page.nextCursor).toBeNull();

      // ONE MORE PERSON AND THE BUTTON IS HONEST AGAIN — the direction a fix
      // that simply never paged would fail.
      await fillPeople(101, 101);
      const full = await readDay(org.org.id, owner.cookies);
      expect(full.people).toHaveLength(100);
      expect(full.totals.people).toBe(101);
      expect(full.nextCursor).not.toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  /** AN INVERTED WINDOW IS A 400, NEVER AN EMPTY PAGE — :4434's ruling, and on
   *  this route the reason is sharper than it was there. Zero visits on a
   *  member's own gym card reads as *"you have never been to your gym"*, which
   *  is the confusion the calendar exists to remove; answering a caller bug with
   *  that sentence would ship the defect through the fix.
   *
   *  **EQUAL BOUNDS ARE REFUSED TOO**, and that follows from half-openness
   *  rather than being an extra rule: a window that starts where it ends holds
   *  nothing, so it can only ever be a mistake.
   *
   *  `validation_error` and not `invalid_date` is asserted deliberately — it
   *  names WHICH layer refused. The ordering is the schema's; the calendar check
   *  below it is the service's. */
  it(
    "an inverted window is a 400, and so is one that starts where it ends",
    async () => {
      const owner = await makeUser("wininv-owner");
      const member = await makeUser("wininv-member");
      const org = await makeOrg(owner.cookies, "Inverted Window Gym");
      await joinAsMember(member.cookies, org, owner.cookies);
      await visitOn(org.org.id, member.userId, "2026-09-15");

      for (const query of [
        "?from=2026-10-01&to=2026-09-01",
        "?from=2026-09-01&to=2026-09-01",
      ]) {
        const res = await get(`/v1/orgs/${org.org.id}/attendance/history${query}`, member.cookies);
        expect(res.statusCode).toBe(400);
        expect((JSON.parse(res.body) as { error: string }).error).toBe("validation_error");
      }

      // THE CONTROL, so this cannot pass on a route that refuses everything: the
      // same gym, the same member, the bounds the right way round.
      expect(
        daysOf(await readHistory(org.org.id, member.cookies, "?from=2026-09-01&to=2026-10-01")),
      ).toEqual(["2026-09-15"]);
    },
    TEST_TIMEOUT_MS,
  );

  /** A SHAPE THAT IS NOT A DATE IS A 400 ON EITHER BOUND ALONE, NEVER A 500.
   *
   *  `2026-02-31` matches `YYYY-MM-DD` and is not a day; Postgres refuses the
   *  `::date` cast and the caller gets a 500 they can do nothing about. The
   *  module already carries this rule for `day` and for `closureParamsSchema`,
   *  and :26947 §5's lesson is that **a rule a file states in one place is not a
   *  rule the file keeps** — so it is asserted here rather than assumed from
   *  there.
   *
   *  **EACH BOUND IS SENT ALONE, WHICH IS :4483's F3 EXACTLY.** With both bounds
   *  present the ordering refine can refuse the request for an unrelated reason
   *  and the hole looks covered from every angle a test happened to be written
   *  from. `0000-01-01` is the year-zero hole (:26947 Low-1) — it matches the
   *  pattern AND round-trips through `Date`, and Postgres still refuses it. */
  it(
    "a shape-valid non-date is a 400 on either bound alone, never a 500",
    async () => {
      const owner = await makeUser("windt-owner");
      const member = await makeUser("windt-member");
      const org = await makeOrg(owner.cookies, "Window Date Gym");
      await joinAsMember(member.cookies, org, owner.cookies);

      for (const query of [
        "?from=2026-02-31",
        "?to=2026-02-31",
        "?from=0000-01-01",
        "?to=0000-01-01",
      ]) {
        const res = await get(`/v1/orgs/${org.org.id}/attendance/history${query}`, member.cookies);
        expect(res.statusCode).toBe(400);
        expect((JSON.parse(res.body) as { error: string }).error).toBe("invalid_date");
      }

      // AND A MALFORMED SHAPE IS STILL THE SCHEMA'S 400, not the service's — the
      // two refusals are different layers and stay told apart.
      const malformed = await get(
        `/v1/orgs/${org.org.id}/attendance/history?from=last-tuesday`,
        member.cookies,
      );
      expect(malformed.statusCode).toBe(400);
      expect((JSON.parse(malformed.body) as { error: string }).error).toBe("validation_error");
    },
    TEST_TIMEOUT_MS,
  );

  // -------------------------------------------------------------------------
  // KD RULING 9 (:27900 §3) — STREAKS YES, XP NO
  // -------------------------------------------------------------------------

  it(
    "an attendance-only day extends the STREAK and leaves the XP total alone",
    async () => {
      const owner = await makeUser("st-owner");
      const member = await makeUser("st-member");
      const org = await makeOrg(owner.cookies, "Streak Gym");
      await joinAsMember(member.cookies, org, owner.cookies);

      const xpBefore = await sql<{ total_xp: number }[]>`
        SELECT total_xp FROM user_xp WHERE user_id = ${member.userId}`;
      const streakBefore = await sql<{ current: number }[]>`
        SELECT current FROM streaks WHERE user_id = ${member.userId}`;
      expect(streakBefore[0]?.current ?? 0).toBe(0);

      /** YESTERDAY'S VISIT, WRITTEN DIRECTLY, AND THE FIXTURE DOES NOT WORK
       *  WITHOUT IT — the mutation sweep proved that rather than anybody
       *  spotting it.
       *
       *  The first version marked ONCE and asserted the XP total had not moved.
       *  **The mutant that unions attendance into the XP list SURVIVED it**,
       *  because XP is not paid per activity day: `countStreakContinuationDays`
       *  counts ADJACENT PAIRS, and one day in isolation is no pair. So the
       *  broken and the correct code both computed zero and the assertion was
       *  green for a reason that had nothing to do with the guarantee.
       *
       *  **A SECOND, CONSECUTIVE DAY IS WHAT MAKES THE TWO ANSWERS DIFFER**:
       *  yesterday plus today is one adjacent pair, so a leaked union pays
       *  continuation XP and this test goes red. :26812 §2(b)'s lesson, arriving
       *  again — aim the fixture at the case the code would get WRONG. */
      const gymDay = await gymToday(org.org.id);
      await sql`
        INSERT INTO gym_attendance
          (gym_id, user_id, marked_by_user_id, day, method, hours_status, slot_key)
        VALUES (${org.org.id}, ${member.userId}, ${member.userId},
                (${gymDay}::date - 1), 'manual', 'hours_unset', 'hours_unset')`;

      expect((await mark(org.org.id, member.cookies)).statusCode).toBe(200);

      const streakAfter = await sql<{ current: number; last_activity_date: string | null }[]>`
        SELECT current, last_activity_date::text AS last_activity_date
        FROM streaks WHERE user_id = ${member.userId}`;
      // THE RULING: going to the gym keeps a streak alive — and two consecutive
      // gym days are a streak of two, which no workout produced.
      expect(streakAfter[0]?.current).toBe(2);
      expect(streakAfter[0]?.last_activity_date).toBe(gymDay);

      const xpAfter = await sql<{ total_xp: number }[]>`
        SELECT total_xp FROM user_xp WHERE user_id = ${member.userId}`;
      // AND THE LINE KD DID NOT MOVE. `recomputeXp` reads `getActivityDays`
      // (workouts alone) while the streak reads `getStreakDays` (workouts ∪
      // attendance). Collapse them into one function and this goes red — which
      // is the whole reason it exists, because a single union would pay XP for a
      // button tap, silently, to everybody.
      expect(xpAfter[0]?.total_xp ?? 0).toBe(xpBefore[0]?.total_xp ?? 0);
    },
    TEST_TIMEOUT_MS,
  );
});
