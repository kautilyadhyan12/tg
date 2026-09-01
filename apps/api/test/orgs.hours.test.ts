// OPENING HOURS — routes + repo against REAL Postgres (R9.2). DATABASE_URL-gated.
// Kd's rulings of 2026-08-31: :26624 (sessions, many per day, or 24 hours),
// :26684 (no session names · members SEE the hours · dated closures) and
// :26736 ("hours not set" is NOT "closed").
//
// THE FOUR THINGS THIS FILE EXISTS TO PIN, because three of them are guarantees
// rather than features and would pass silently if they broke:
//
//   1. **`unset` IS NOT `closed`, AND IT IS PINNED BY A TEST RATHER THAN BY A
//      COMMENT.** A gym that never filled the form in has no `gym_hours` rows —
//      byte-identical to a gym that is genuinely shut every day — so a reader
//      that trusts the rows tells every existing gym's members "Closed" on the
//      day this ships (:5807 Critical/High, :26736's whole subject). Two tests
//      drive it: a gym created a moment ago reads back `unset`, and `unset`
//      cannot be SET (a gym that has answered cannot un-answer).
//
//   2. **THE MODE DECIDES WHAT `week` CONTAINS, not the rows.** `toGymHours`
//      empties `week` unless the mode is `scheduled`, so a stray row can never
//      tell members a 24-hour gym closes at six. The `open_24h` test asserts the
//      rows are GONE as well as that the week is empty — one without the other
//      would pass with either half broken.
//
//   3. **PAST CLOSURES ARE HIDDEN IN THE GYM'S OWN ZONE, AND THE FIXTURE IS A
//      PAIR AT OPPOSITE EXTREMES — one non-UTC gym is NOT enough, which the
//      mutation sweep proved rather than anybody spotting it.** The first
//      version used a single gym at `Pacific/Kiritimati` (UTC+14) and the
//      zone-deleting mutant SURVIVED it: Kiritimati's calendar date differs from
//      UTC's only while UTC is past 10:00, so for the other ten hours of every
//      day `(now() AT TIME ZONE g.timezone)::date` and a bare `now()::date`
//      agree and the test proves nothing — green on CI at some hours, red at
//      others. The fixture is now UTC+14 **and** UTC-12: 26 hours apart, so
//      their two calendar dates ALWAYS differ and the server's can match at most
//      one of them, at every instant, on any machine (:26812 §2(a), trap #8).
//
//   4. **TOUCHING IS LEGAL AND OVERLAP IS NOT.** 10:00–12:00 beside 12:00–14:00
//      is a real timetable; 10:00–12:00 beside 11:00–13:00 has no single answer
//      for "which session did this attendance fall in". The comparison is one
//      strict `<` and the card named it as easy to get backwards, so BOTH sides
//      of the boundary are driven.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
// Called DIRECTLY by the tenancy block at the bottom of this file — see its
// header for why a route test structurally cannot reach those predicates.
import * as orgRepo from "../src/modules/orgs/repo.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "orghours-test-secret-0123456789abc", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;

/** Vitest's default 5 s does not cover a registration (bcrypt cost 10), a login
 *  and a gym. Raised here and not globally (R1.1). */
const TEST_TIMEOUT_MS = 30_000;
const HOOK_TIMEOUT_MS = 60_000;

let ipCounter = 0;
const nextIp = () =>
  `10.9.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

/** The plan every fixture gym goes on, because since Kd's read-only ruling
 *  (2026-08-29) a gym with no live plan refuses every write — including all
 *  three writes on this surface. Huge cap so it can never be what makes a test
 *  pass or fail, INR to match the fixture country, `trial_days = 0` so it stays
 *  invisible to `startGymTrial`'s lowest-capped-with-a-trial query and cannot
 *  disturb the sibling suites' band assertions. */
const LIVE_PLAN = "zz_hours_live";

interface CreatedOrg {
  org: { id: string; slug: string; name: string; timezone: string };
  joinCode: { code: string; label: string };
}

interface Session {
  opensMinute: number;
  closesMinute: number;
}
interface DaySchedule {
  weekday: number;
  sessions: Session[];
}
interface Hours {
  mode: "unset" | "open_24h" | "scheduled";
  timezone: string;
  clockFormat: "12h" | "24h";
  week: DaySchedule[];
  closures: { day: string; note: string | null }[];
}

d("gym opening hours (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'orghours-t-%@example.com')`;
    // Order and reason are the sibling suites': the FKs have no cascade, so a
    // stray child blocks the parent DELETE with a 23503 naming nothing useful
    // (:10726 Low-2). `gym_hours` and `gym_closures` DO cascade off `gyms` and
    // are deleted anyway — a cleanup that relies on a cascade is a cleanup that
    // silently stops working the day somebody changes the FK.
    // **`hours_mode` IS RESET BEFORE ANYTHING IS DELETED, and that ordering is
    // load-bearing for a SIBLING suite.** `db.migration.test.ts` asserts that no
    // gym holds a non-`unset` mode without an `org.hours_set` audit row — the
    // "0017 invented nothing" guarantee (T3 round 1's Low-3). Deleting this
    // suite's audit rows while its gyms still carried a mode would open a window
    // in which that assertion is false through no fault of the migration, and
    // the two suites share one database (:23128's shape). Resetting first means
    // the invariant holds at every instant of the teardown.
    await sql`UPDATE gyms SET hours_mode = 'unset' WHERE id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_hours WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_closures WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'orghours-t-%@example.com'`;
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

  const get = (path: string, cookies: Record<string, string> = {}) =>
    api().inject({ method: "GET", url: path, remoteAddress: nextIp(), cookies });

  const del = (path: string, cookies: Record<string, string> = {}) =>
    api().inject({ method: "DELETE", url: path, remoteAddress: nextIp(), cookies });

  const makeUser = async (local: string) => {
    const email = `orghours-t-${local}@example.com`;
    const reg = await api().inject({
      method: "POST",
      url: "/v1/auth/register",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email, password: PASSWORD, displayName: `Hours ${local}` }),
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
    const res = await post(
      "/v1/orgs",
      { name, city: "Jorhat", country: "IN", timezone },
      cookies,
    );
    expect(res.statusCode).toBe(201);
    const created = JSON.parse(res.body) as CreatedOrg;
    await subscribeGym(created.org.id);
    return created;
  };

  /** The whole door, both halves — apply with the code, front desk confirms —
   *  so nothing here can accidentally assert the pre-:11072 behaviour where
   *  typing a code was enough to be a member. */
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

  const readHours = async (gymId: string, cookies: Record<string, string>): Promise<Hours> => {
    const res = await get(`/v1/orgs/${gymId}/hours`, cookies);
    expect(res.statusCode).toBe(200);
    return (JSON.parse(res.body) as { hours: Hours }).hours;
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
  // :26736 — "NOBODY HAS SET HOURS YET" IS ITS OWN STATE
  // -------------------------------------------------------------------------

  it(
    "a brand-new gym reads back `unset`, with no week and no invented default",
    async () => {
      const owner = await makeUser("unset-owner");
      const org = await makeOrg(owner.cookies, "Hours Unset Gym");

      const hours = await readHours(org.org.id, owner.cookies);
      expect(hours.mode).toBe("unset");
      expect(hours.week).toEqual([]);
      expect(hours.closures).toEqual([]);

      // The MIGRATION's half of the same guarantee: no rows were invented for a
      // gym that has said nothing. A default in the DDL would satisfy the API
      // assertion above and still be the defect :26736 names.
      const rows = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM gym_hours WHERE gym_id = ${org.org.id}`;
      expect(rows[0]?.n).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "`unset` cannot be set — a gym that has answered cannot un-answer",
    async () => {
      const owner = await makeUser("unset-set");
      const org = await makeOrg(owner.cookies, "Hours Unset Set Gym");

      const res = await put(`/v1/orgs/${org.org.id}/hours`, { mode: "unset" }, owner.cookies);
      expect(res.statusCode).toBe(400);
      expect(await readHours(org.org.id, owner.cookies)).toMatchObject({ mode: "unset" });
    },
    TEST_TIMEOUT_MS,
  );

  // -------------------------------------------------------------------------
  // THE HAPPY PATHS
  // -------------------------------------------------------------------------

  it(
    "a gym sets three sessions on one day and reads them back in order",
    async () => {
      const owner = await makeUser("week-owner");
      const org = await makeOrg(owner.cookies, "Hours Week Gym");

      // Kd's own example, and deliberately sent OUT OF ORDER: the server sorts,
      // because a screen that lets an owner add a 6am session after a 2pm one is
      // a screen we want to keep working.
      const res = await put(
        `/v1/orgs/${org.org.id}/hours`,
        {
          mode: "scheduled",
          week: [
            {
              weekday: 2,
              sessions: [
                { opensMinute: 16 * 60, closesMinute: 21 * 60 },
                { opensMinute: 6 * 60, closesMinute: 7 * 60 },
                { opensMinute: 14 * 60, closesMinute: 15 * 60 },
              ],
            },
          ],
        },
        owner.cookies,
      );
      expect(res.statusCode).toBe(200);

      const hours = await readHours(org.org.id, owner.cookies);
      expect(hours.mode).toBe("scheduled");
      expect(hours.week).toEqual([
        {
          weekday: 2,
          sessions: [
            { opensMinute: 360, closesMinute: 420 },
            { opensMinute: 840, closesMinute: 900 },
            { opensMinute: 960, closesMinute: 1260 },
          ],
        },
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a weekday with no sessions is simply absent — that is how `closed every Sunday` is said",
    async () => {
      const owner = await makeUser("sparse-owner");
      const org = await makeOrg(owner.cookies, "Hours Sparse Gym");

      // Monday and SUNDAY open, the rest of the week absent. Sunday is here on
      // purpose: :26736 — no weekday is special, and a gym may open on one.
      await put(
        `/v1/orgs/${org.org.id}/hours`,
        {
          mode: "scheduled",
          week: [
            { weekday: 1, sessions: [{ opensMinute: 360, closesMinute: 1320 }] },
            { weekday: 7, sessions: [{ opensMinute: 480, closesMinute: 720 }] },
            { weekday: 3, sessions: [] },
          ],
        },
        owner.cookies,
      );

      const hours = await readHours(org.org.id, owner.cookies);
      expect(hours.week.map((d) => d.weekday)).toEqual([1, 7]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "midnight closes as 1440, so a gym open till midnight loses no minute",
    async () => {
      const owner = await makeUser("midnight-owner");
      const org = await makeOrg(owner.cookies, "Hours Midnight Gym");

      const res = await put(
        `/v1/orgs/${org.org.id}/hours`,
        { mode: "scheduled", week: [{ weekday: 5, sessions: [{ opensMinute: 1320, closesMinute: 1440 }] }] },
        owner.cookies,
      );
      expect(res.statusCode).toBe(200);
      const hours = await readHours(org.org.id, owner.cookies);
      expect(hours.week[0]?.sessions[0]).toEqual({ opensMinute: 1320, closesMinute: 1440 });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "switching to `open_24h` empties the week AND deletes the rows behind it",
    async () => {
      const owner = await makeUser("all-day-owner");
      const org = await makeOrg(owner.cookies, "Hours All Day Gym");

      await put(
        `/v1/orgs/${org.org.id}/hours`,
        { mode: "scheduled", week: [{ weekday: 4, sessions: [{ opensMinute: 360, closesMinute: 720 }] }] },
        owner.cookies,
      );
      const before = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM gym_hours WHERE gym_id = ${org.org.id}`;
      expect(before[0]?.n).toBe(1);

      const res = await put(`/v1/orgs/${org.org.id}/hours`, { mode: "open_24h" }, owner.cookies);
      expect(res.statusCode).toBe(200);

      const hours = await readHours(org.org.id, owner.cookies);
      expect(hours.mode).toBe("open_24h");
      expect(hours.week).toEqual([]);

      // **BOTH HALVES, and this is the point of the test.** The API answer is
      // emptied by the MODE in `toGymHours`; the rows are deleted by the WRITER.
      // Asserting only the response would pass with a stale week sitting in the
      // table, waiting to reappear the moment the gym goes back to `scheduled`.
      const after = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM gym_hours WHERE gym_id = ${org.org.id}`;
      expect(after[0]?.n).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the MODE decides what the week contains, even with rows left behind",
    async () => {
      const owner = await makeUser("mode-decides");
      const org = await makeOrg(owner.cookies, "Hours Mode Decides Gym");

      await put(
        `/v1/orgs/${org.org.id}/hours`,
        { mode: "scheduled", week: [{ weekday: 4, sessions: [{ opensMinute: 360, closesMinute: 720 }] }] },
        owner.cookies,
      );

      // THE STATE IS FORCED IN SQL BECAUSE NO ROUTE CAN PRODUCE IT, and that is
      // the point rather than a shortcut: the writer deletes the rows whenever
      // the mode leaves `scheduled`, so a reader that trusted the ROWS instead
      // of the MODE is invisible to every test that goes through the door. This
      // is the same defect from the other side — one stray row, from a future
      // writer, a partial restore, or a hand-edit — and a reader that branches
      // on the mode is unmoved by it.
      for (const mode of ["unset", "open_24h"] as const) {
        await sql`UPDATE gyms SET hours_mode = ${mode} WHERE id = ${org.org.id}`;
        const hours = await readHours(org.org.id, owner.cookies);
        expect(hours.mode).toBe(mode);
        expect(hours.week).toEqual([]);
      }

      // The control: the row is still there throughout, so "the week is empty"
      // is a statement about the READER and not about an empty table.
      const rows = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM gym_hours WHERE gym_id = ${org.org.id}`;
      expect(rows[0]?.n).toBe(1);

      // And back: the same rows, now with a mode that admits them.
      await sql`UPDATE gyms SET hours_mode = 'scheduled' WHERE id = ${org.org.id}`;
      expect((await readHours(org.org.id, owner.cookies)).week).toEqual([
        { weekday: 4, sessions: [{ opensMinute: 360, closesMinute: 720 }] },
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a second PUT replaces the week — the old sessions are gone, not merged",
    async () => {
      const owner = await makeUser("replace-owner");
      const org = await makeOrg(owner.cookies, "Hours Replace Gym");

      await put(
        `/v1/orgs/${org.org.id}/hours`,
        {
          mode: "scheduled",
          week: [
            { weekday: 1, sessions: [{ opensMinute: 360, closesMinute: 420 }] },
            { weekday: 2, sessions: [{ opensMinute: 360, closesMinute: 420 }] },
          ],
        },
        owner.cookies,
      );
      await put(
        `/v1/orgs/${org.org.id}/hours`,
        { mode: "scheduled", week: [{ weekday: 6, sessions: [{ opensMinute: 600, closesMinute: 660 }] }] },
        owner.cookies,
      );

      const hours = await readHours(org.org.id, owner.cookies);
      expect(hours.week).toEqual([
        { weekday: 6, sessions: [{ opensMinute: 600, closesMinute: 660 }] },
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  // -------------------------------------------------------------------------
  // VALIDATION — every one of these is a 400 the client can explain, never a
  // 500 the database produced.
  // -------------------------------------------------------------------------

  it(
    "refuses a session that ends before it starts, a bad weekday, and a minute past midnight",
    async () => {
      const owner = await makeUser("validate-owner");
      const org = await makeOrg(owner.cookies, "Hours Validate Gym");
      const path = `/v1/orgs/${org.org.id}/hours`;

      const backwards = await put(
        path,
        { mode: "scheduled", week: [{ weekday: 1, sessions: [{ opensMinute: 720, closesMinute: 600 }] }] },
        owner.cookies,
      );
      expect(backwards.statusCode).toBe(400);

      // Equal is refused too: a zero-length session is a row that can never
      // contain an attendance, and the CHECK behind it is strict `>`.
      const zeroLength = await put(
        path,
        { mode: "scheduled", week: [{ weekday: 1, sessions: [{ opensMinute: 600, closesMinute: 600 }] }] },
        owner.cookies,
      );
      expect(zeroLength.statusCode).toBe(400);

      // 0 is JS's Sunday and is the single most likely wrong value to arrive
      // here — the ISO-vs-getDay confusion this card names as risk 2.
      for (const weekday of [0, 8]) {
        const res = await put(
          path,
          { mode: "scheduled", week: [{ weekday, sessions: [{ opensMinute: 600, closesMinute: 660 }] }] },
          owner.cookies,
        );
        expect(res.statusCode).toBe(400);
      }

      const past = await put(
        path,
        { mode: "scheduled", week: [{ weekday: 1, sessions: [{ opensMinute: 600, closesMinute: 1441 }] }] },
        owner.cookies,
      );
      expect(past.statusCode).toBe(400);

      // 1440 as an OPENING is a zero-length session on the wrong day.
      const opensAtMidnight = await put(
        path,
        { mode: "scheduled", week: [{ weekday: 1, sessions: [{ opensMinute: 1440, closesMinute: 1440 }] }] },
        owner.cookies,
      );
      expect(opensAtMidnight.statusCode).toBe(400);

      // Nothing above was allowed to land.
      expect(await readHours(org.org.id, owner.cookies)).toMatchObject({ mode: "unset" });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the union refuses `open_24h` carrying a week, and `scheduled` with no week",
    async () => {
      const owner = await makeUser("union-owner");
      const org = await makeOrg(owner.cookies, "Hours Union Gym");
      const path = `/v1/orgs/${org.org.id}/hours`;

      // "24 hours, and here is Tuesday" must not be a representable state — the
      // whole reason the request is a discriminated union rather than one object
      // with an optional `week`.
      const both = await put(
        path,
        { mode: "open_24h", week: [{ weekday: 2, sessions: [] }] },
        owner.cookies,
      );
      expect(both.statusCode).toBe(400);

      const neither = await put(path, { mode: "scheduled" }, owner.cookies);
      expect(neither.statusCode).toBe(400);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuses overlapping sessions and ACCEPTS touching ones — both sides of the boundary",
    async () => {
      const owner = await makeUser("overlap-owner");
      const org = await makeOrg(owner.cookies, "Hours Overlap Gym");
      const path = `/v1/orgs/${org.org.id}/hours`;

      const overlapping = await put(
        path,
        {
          mode: "scheduled",
          week: [
            {
              weekday: 3,
              sessions: [
                { opensMinute: 600, closesMinute: 720 },
                { opensMinute: 660, closesMinute: 780 },
              ],
            },
          ],
        },
        owner.cookies,
      );
      expect(overlapping.statusCode).toBe(400);
      // The message names BOTH sessions that clash and the day, because
      // "invalid week" is a refusal an owner cannot act on — they need to know
      // which two rows to look at.
      const refusal = JSON.parse(overlapping.body) as { message: string };
      expect(refusal.message).toContain("Wednesday");
      expect(refusal.message).toContain("10:00");
      expect(refusal.message).toContain("11:00");

      // 10:00–12:00 then 12:00–14:00: a gym with a break in its numbering, not
      // an error. If the comparison is ever loosened to `<=` this goes red.
      const touching = await put(
        path,
        {
          mode: "scheduled",
          week: [
            {
              weekday: 3,
              sessions: [
                { opensMinute: 600, closesMinute: 720 },
                { opensMinute: 720, closesMinute: 840 },
              ],
            },
          ],
        },
        owner.cookies,
      );
      expect(touching.statusCode).toBe(200);
    },
    TEST_TIMEOUT_MS,
  );

  /** A DESCENDING PAIR THAT GENUINELY OVERLAPS IS STILL REFUSED.
   *
   *  **This test does NOT observe the sort, and the name it first carried said
   *  it did.** It was called "catches an overlap even when the client sends the
   *  sessions out of order", and the mutation sweep found the sort could be
   *  deleted with this test still green — because a neighbour check on unsorted
   *  input fires on ANY descending pair, so it rejects this input too, for the
   *  wrong reason. What the sort actually protects is the opposite case: a VALID
   *  week sent out of order must be ACCEPTED, which is the happy-path test
   *  "sets three sessions on one day and reads them back in order" (its three
   *  sessions are deliberately sent 16:00, 06:00, 14:00). That test is where the
   *  sort's mutant is aimed.
   *
   *  Kept, renamed to what it proves. :5348 rule 4's own subject — a test whose
   *  claim is wider than its coverage is a test that will be cited for something
   *  it never checked. */
  it(
    "refuses a descending pair that overlaps",
    async () => {
      const owner = await makeUser("overlap-sort");
      const org = await makeOrg(owner.cookies, "Hours Overlap Sort Gym");

      const res = await put(
        `/v1/orgs/${org.org.id}/hours`,
        {
          mode: "scheduled",
          week: [
            {
              weekday: 3,
              sessions: [
                { opensMinute: 660, closesMinute: 840 },
                { opensMinute: 600, closesMinute: 720 },
              ],
            },
          ],
        },
        owner.cookies,
      );
      expect(res.statusCode).toBe(400);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuses the same weekday listed twice rather than silently concatenating it",
    async () => {
      const owner = await makeUser("dupe-day");
      const org = await makeOrg(owner.cookies, "Hours Dupe Day Gym");

      // Two entries that do not overlap WITHIN themselves but do across them —
      // exactly what a per-entry overlap check would wave through.
      const res = await put(
        `/v1/orgs/${org.org.id}/hours`,
        {
          mode: "scheduled",
          week: [
            { weekday: 3, sessions: [{ opensMinute: 600, closesMinute: 720 }] },
            { weekday: 3, sessions: [{ opensMinute: 660, closesMinute: 780 }] },
          ],
        },
        owner.cookies,
      );
      expect(res.statusCode).toBe(400);
    },
    TEST_TIMEOUT_MS,
  );

  // -------------------------------------------------------------------------
  // CLOSURES — the DATED override (:26684 §3)
  // -------------------------------------------------------------------------

  it(
    "closes one day with a note, and re-closing it EDITS the note without stacking a row",
    async () => {
      const owner = await makeUser("closure-owner");
      const org = await makeOrg(owner.cookies, "Hours Closure Gym");
      const day = futureDay(30);

      const first = await post(
        `/v1/orgs/${org.org.id}/closures`,
        { day, note: "Holi" },
        owner.cookies,
      );
      expect(first.statusCode).toBe(200);
      expect((JSON.parse(first.body) as { hours: Hours }).hours.closures).toEqual([
        { day, note: "Holi" },
      ]);

      const second = await post(
        `/v1/orgs/${org.org.id}/closures`,
        { day, note: "Staff training" },
        owner.cookies,
      );
      expect(second.statusCode).toBe(200);

      const hours = await readHours(org.org.id, owner.cookies);
      expect(hours.closures).toEqual([{ day, note: "Staff training" }]);

      // The UNIQUE is what makes the double-tap idempotent, so the ROW COUNT is
      // the assertion that would catch it breaking — the response above would
      // look identical if a second row existed and the reader took the first.
      const rows = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM gym_closures WHERE gym_id = ${org.org.id}`;
      expect(rows[0]?.n).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a closure with no note is allowed, and an empty note is stored as none",
    async () => {
      const owner = await makeUser("closure-nonote");
      const org = await makeOrg(owner.cookies, "Hours Closure NoNote Gym");
      const day = futureDay(31);

      const bare = await post(`/v1/orgs/${org.org.id}/closures`, { day }, owner.cookies);
      expect(bare.statusCode).toBe(200);
      expect((JSON.parse(bare.body) as { hours: Hours }).hours.closures).toEqual([
        { day, note: null },
      ]);

      // An owner who empties the reason box sends "" — stored as nothing, so no
      // screen renders a dash with nothing after it.
      const blanked = await post(
        `/v1/orgs/${org.org.id}/closures`,
        { day, note: "   " },
        owner.cookies,
      );
      expect(blanked.statusCode).toBe(200);
      expect((JSON.parse(blanked.body) as { hours: Hours }).hours.closures).toEqual([
        { day, note: null },
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "un-closing restores the pattern, and un-closing a day that was never closed still answers `removed`",
    async () => {
      const owner = await makeUser("closure-remove");
      const org = await makeOrg(owner.cookies, "Hours Closure Remove Gym");
      const day = futureDay(32);

      await post(`/v1/orgs/${org.org.id}/closures`, { day, note: "Holi" }, owner.cookies);
      const removed = await del(`/v1/orgs/${org.org.id}/closures/${day}`, owner.cookies);
      expect(removed.statusCode).toBe(200);
      expect(JSON.parse(removed.body)).toMatchObject({ status: "removed" });
      expect((await readHours(org.org.id, owner.cookies)).closures).toEqual([]);

      // `removed` names the STATE, not this request: a double-tap and a stale
      // screen must both answer the same way rather than 404.
      const again = await del(`/v1/orgs/${org.org.id}/closures/${day}`, owner.cookies);
      expect(again.statusCode).toBe(200);
      expect(JSON.parse(again.body)).toMatchObject({ status: "removed" });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "hides closures that have passed, measured in the GYM's zone and not the server's",
    async () => {
      const owner = await makeUser("closure-zone");

      // TWO GYMS AT THE OPPOSITE ENDS OF THE WORLD, AND THE PAIR IS THE WHOLE
      // POINT OF THE FIXTURE.
      //
      // A single UTC+14 gym was the first version of this test and it PASSED
      // WITH THE ZONE DELETED — caught by the mutation sweep, not by reading it.
      // Kiritimati's calendar date differs from UTC's only while UTC is past
      // 10:00, so for the other TEN hours of every day `(now() AT TIME ZONE
      // g.timezone)` and a bare `now()` agree and the test proves nothing. It
      // would have gone green on CI at those hours and red at the rest — worse
      // than no test. (Corrected direction: they DIFFER for 14 hours and AGREE
      // for 10; the first write-up had the two numbers swapped — T3 Low-4.)
      //
      // UTC+14 and UTC-12 are 26 hours apart, so THEIR two calendar dates ALWAYS
      // differ, at every instant. The server's date can therefore match at most
      // one of them, and a filter that uses the server's date is wrong for the
      // other one — whatever the hour, on any machine, in CI.
      const east = await makeOrg(owner.cookies, "Hours Zone East Gym", "Pacific/Kiritimati");
      const west = await makeOrg(owner.cookies, "Hours Zone West Gym", "Etc/GMT+12");

      // The fixture's own premise, asserted rather than assumed: if these two
      // ever agreed, the test above would be back to proving nothing.
      const eastToday = await gymDay(east.org.id, 0);
      const westToday = await gymDay(west.org.id, 0);
      expect(eastToday).not.toBe(westToday);

      for (const org of [east, west]) {
        const yesterday = await gymDay(org.org.id, -1);
        const today = await gymDay(org.org.id, 0);
        const tomorrow = await gymDay(org.org.id, 1);

        for (const day of [yesterday, today, tomorrow]) {
          const res = await post(`/v1/orgs/${org.org.id}/closures`, { day }, owner.cookies);
          expect(res.statusCode).toBe(200);
        }

        const hours = await readHours(org.org.id, owner.cookies);
        // TODAY IS STILL SHOWN — a gym closed today is exactly what a member
        // needs to be told, so the filter is `>=` and a `>` would be the defect.
        // The zone is in the failure message: with two gyms in one loop, "which
        // one broke" is the first thing a reader needs and the assertion cannot
        // otherwise say it.
        expect(hours.closures.map((c) => c.day), org.org.timezone).toEqual([today, tomorrow]);

        // All three rows are still THERE: the read filters, it does not delete.
        const rows = await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM gym_closures WHERE gym_id = ${org.org.id}`;
        expect(rows[0]?.n).toBe(3);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuses a date that is well-shaped and does not exist",
    async () => {
      const owner = await makeUser("closure-badday");
      const org = await makeOrg(owner.cookies, "Hours Bad Day Gym");

      // `2027-02-31` matches YYYY-MM-DD and is not a day. Without the calendar
      // check this reaches Postgres and returns a 500 the client cannot act on.
      const res = await post(`/v1/orgs/${org.org.id}/closures`, { day: "2027-02-31" }, owner.cookies);
      expect(res.statusCode).toBe(400);

      const removed = await del(`/v1/orgs/${org.org.id}/closures/2027-02-31`, owner.cookies);
      expect(removed.statusCode).toBe(400);

      const shape = await post(`/v1/orgs/${org.org.id}/closures`, { day: "25-12-2027" }, owner.cookies);
      expect(shape.statusCode).toBe(400);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a note longer than the cap is refused",
    async () => {
      const owner = await makeUser("closure-longnote");
      const org = await makeOrg(owner.cookies, "Hours Long Note Gym");
      const res = await post(
        `/v1/orgs/${org.org.id}/closures`,
        { day: futureDay(33), note: "x".repeat(121) },
        owner.cookies,
      );
      expect(res.statusCode).toBe(400);
    },
    TEST_TIMEOUT_MS,
  );

  // -------------------------------------------------------------------------
  // AUTHORIZATION — the cross-tenant denial case on all four routes (R9.2)
  // -------------------------------------------------------------------------

  it(
    "a live MEMBER can read the hours — Kd ruled they see them",
    async () => {
      const owner = await makeUser("member-read-owner");
      const member = await makeUser("member-read-member");
      const org = await makeOrg(owner.cookies, "Hours Member Read Gym");
      await joinAsMember(member.cookies, org, owner.cookies);

      await put(
        `/v1/orgs/${org.org.id}/hours`,
        { mode: "scheduled", week: [{ weekday: 1, sessions: [{ opensMinute: 360, closesMinute: 1320 }] }] },
        owner.cookies,
      );

      const hours = await readHours(org.org.id, member.cookies);
      expect(hours.mode).toBe("scheduled");
      expect(hours.week).toEqual([
        { weekday: 1, sessions: [{ opensMinute: 360, closesMinute: 1320 }] },
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  /** A REMOVED MEMBER LOSES THE READ — T3 round 1's Low-2, and it is the
   *  ownership column, so it is the one class that must never go unwatched.
   *
   *  `isLiveMember`'s `removed_at IS NULL` had NO observer: the reviewer mutated
   *  it to `(m.removed_at IS NULL OR true)` and this file stayed 32/32 green. The
   *  code was right; the guard was missing. Without one, a person the gym removed
   *  goes on reading that gym's timetable for ever, and nothing would say so. */
  it(
    "a member REMOVED from the gym stops being able to read its hours",
    async () => {
      const owner = await makeUser("removed-owner");
      const member = await makeUser("removed-member");
      const org = await makeOrg(owner.cookies, "Hours Removed Member Gym");
      await joinAsMember(member.cookies, org, owner.cookies);

      // The positive control FIRST, so "404 afterwards" is a statement about the
      // removal and not about a member who never had access.
      expect((await get(`/v1/orgs/${org.org.id}/hours`, member.cookies)).statusCode).toBe(200);

      const removed = await del(
        `/v1/orgs/${org.org.id}/members/${member.userId}`,
        owner.cookies,
      );
      expect(removed.statusCode).toBe(200);

      // 404, not 403: they are not staff either, so they get exactly what a
      // stranger gets and learn nothing about the gym.
      expect((await get(`/v1/orgs/${org.org.id}/hours`, member.cookies)).statusCode).toBe(404);
      // The owner is unaffected — the removal scoped to one person.
      expect((await get(`/v1/orgs/${org.org.id}/hours`, owner.cookies)).statusCode).toBe(200);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a member cannot WRITE — reading the hours is not permission to set them",
    async () => {
      const owner = await makeUser("member-write-owner");
      const member = await makeUser("member-write-member");
      const org = await makeOrg(owner.cookies, "Hours Member Write Gym");
      await joinAsMember(member.cookies, org, owner.cookies);

      // 404 and not 403: this person is not STAFF here, and `requirePrivilege`
      // must not confirm the gym exists to somebody who only holds a uuid.
      const set = await put(
        `/v1/orgs/${org.org.id}/hours`,
        { mode: "open_24h" },
        member.cookies,
      );
      expect(set.statusCode).toBe(404);

      const closed = await post(
        `/v1/orgs/${org.org.id}/closures`,
        { day: futureDay(34) },
        member.cookies,
      );
      expect(closed.statusCode).toBe(404);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a TRAINER is refused all three writes with a 403 — they are staff, so the gym's existence is not a secret from them",
    async () => {
      const owner = await makeUser("trainer-owner");
      const trainer = await makeUser("trainer-staff");
      const org = await makeOrg(owner.cookies, "Hours Trainer Gym");
      await joinAsMember(trainer.cookies, org, owner.cookies);

      // BY EMAIL, and scoped to the gym's own roster — the staff route's own
      // shape (:14262: looking a stranger up across `users` would turn it into
      // an oracle). The join above is what puts this person on that roster.
      const added = await post(
        `/v1/orgs/${org.org.id}/staff`,
        { email: trainer.email, role: "trainer" },
        owner.cookies,
      );
      expect(added.statusCode).toBe(201);

      // `org.manage` is not in a trainer's template, so all three writes 403 —
      // and the READ still works, because §2.2 gives every staff role the
      // console's read side.
      expect(
        (await put(`/v1/orgs/${org.org.id}/hours`, { mode: "open_24h" }, trainer.cookies))
          .statusCode,
      ).toBe(403);
      expect(
        (await post(`/v1/orgs/${org.org.id}/closures`, { day: futureDay(35) }, trainer.cookies))
          .statusCode,
      ).toBe(403);
      expect(
        (await del(`/v1/orgs/${org.org.id}/closures/${futureDay(35)}`, trainer.cookies))
          .statusCode,
      ).toBe(403);

      expect((await readHours(org.org.id, trainer.cookies)).mode).toBe("unset");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "CROSS-TENANT: the owner of gym B gets 404 on every one of gym A's four routes",
    async () => {
      const ownerA = await makeUser("tenant-a");
      const ownerB = await makeUser("tenant-b");
      const gymA = await makeOrg(ownerA.cookies, "Hours Tenant A Gym");
      await makeOrg(ownerB.cookies, "Hours Tenant B Gym");

      await put(
        `/v1/orgs/${gymA.org.id}/hours`,
        { mode: "scheduled", week: [{ weekday: 1, sessions: [{ opensMinute: 360, closesMinute: 420 }] }] },
        ownerA.cookies,
      );

      const day = futureDay(36);
      expect((await get(`/v1/orgs/${gymA.org.id}/hours`, ownerB.cookies)).statusCode).toBe(404);
      expect(
        (await put(`/v1/orgs/${gymA.org.id}/hours`, { mode: "open_24h" }, ownerB.cookies))
          .statusCode,
      ).toBe(404);
      expect(
        (await post(`/v1/orgs/${gymA.org.id}/closures`, { day }, ownerB.cookies)).statusCode,
      ).toBe(404);
      expect(
        (await del(`/v1/orgs/${gymA.org.id}/closures/${day}`, ownerB.cookies)).statusCode,
      ).toBe(404);

      // AND NOTHING LEAKED THROUGH THE REFUSALS. A 404 that still wrote is the
      // shape a tenancy predicate deleted from one statement produces, and the
      // status code alone cannot see it.
      const hours = await readHours(gymA.org.id, ownerA.cookies);
      expect(hours.mode).toBe("scheduled");
      expect(hours.closures).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a MEMBER of gym B gets 404 on gym A's read — belonging to some gym is not belonging to this one",
    async () => {
      const ownerA = await makeUser("mtenant-a");
      const ownerB = await makeUser("mtenant-b");
      const memberB = await makeUser("mtenant-mb");
      const gymA = await makeOrg(ownerA.cookies, "Hours MTenant A Gym");
      const gymB = await makeOrg(ownerB.cookies, "Hours MTenant B Gym");
      await joinAsMember(memberB.cookies, gymB, ownerB.cookies);

      expect((await get(`/v1/orgs/${gymA.org.id}/hours`, memberB.cookies)).statusCode).toBe(404);
      // The control: the same person, the same request, their OWN gym.
      expect((await get(`/v1/orgs/${gymB.org.id}/hours`, memberB.cookies)).statusCode).toBe(200);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a signed-in stranger gets 404 on the read, never a 200 and never a 403",
    async () => {
      const owner = await makeUser("stranger-owner");
      const stranger = await makeUser("stranger");
      const org = await makeOrg(owner.cookies, "Hours Stranger Gym");

      const res = await get(`/v1/orgs/${org.org.id}/hours`, stranger.cookies);
      expect(res.statusCode).toBe(404);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "all four routes require authentication",
    async () => {
      const owner = await makeUser("anon-owner");
      const org = await makeOrg(owner.cookies, "Hours Anon Gym");
      const day = futureDay(37);

      // Written out per route rather than looped over a shared list: a
      // "requires authentication" test that iterates a list somebody has to
      // remember to extend covers exactly the routes that existed when it was
      // written (:12227's finding).
      expect((await get(`/v1/orgs/${org.org.id}/hours`)).statusCode).toBe(401);
      expect((await put(`/v1/orgs/${org.org.id}/hours`, { mode: "open_24h" })).statusCode).toBe(401);
      expect((await post(`/v1/orgs/${org.org.id}/closures`, { day })).statusCode).toBe(401);
      expect((await del(`/v1/orgs/${org.org.id}/closures/${day}`)).statusCode).toBe(401);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a gym with no live plan can still be READ but not written — §4.2's read-only console",
    async () => {
      const owner = await makeUser("lapsed-owner");
      const org = await makeOrg(owner.cookies, "Hours Lapsed Gym");
      await put(
        `/v1/orgs/${org.org.id}/hours`,
        { mode: "scheduled", week: [{ weekday: 1, sessions: [{ opensMinute: 360, closesMinute: 420 }] }] },
        owner.cookies,
      );

      await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${org.org.id}`;

      // Nothing is HIDDEN from a gym because it stopped paying — what stops is
      // changing things (:23711). Hiding the hours would also tell its members
      // something false about the gym rather than about the bill.
      const hours = await readHours(org.org.id, owner.cookies);
      expect(hours.mode).toBe("scheduled");

      expect(
        (await put(`/v1/orgs/${org.org.id}/hours`, { mode: "open_24h" }, owner.cookies)).statusCode,
      ).toBe(409);
      expect(
        (await post(`/v1/orgs/${org.org.id}/closures`, { day: futureDay(38) }, owner.cookies))
          .statusCode,
      ).toBe(409);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a non-uuid gym id is a 400 at the boundary on ALL FOUR routes, not a 500 from Postgres",
    async () => {
      const owner = await makeUser("baduuid");
      // ALL FOUR, and the two closure routes are the point — T3 round 1's Low-7.
      // `DELETE /closures/:day` is the only route on a DIFFERENT params schema
      // (`closureParamsSchema`), so it is the one most likely to drift, and it
      // was the one this test's name covered and its body did not.
      expect((await get("/v1/orgs/not-a-uuid/hours", owner.cookies)).statusCode).toBe(400);
      expect(
        (await put("/v1/orgs/not-a-uuid/hours", { mode: "open_24h" }, owner.cookies)).statusCode,
      ).toBe(400);
      expect(
        (await post("/v1/orgs/not-a-uuid/closures", { day: futureDay(70) }, owner.cookies))
          .statusCode,
      ).toBe(400);
      expect(
        (await del(`/v1/orgs/not-a-uuid/closures/${futureDay(70)}`, owner.cookies)).statusCode,
      ).toBe(400);
    },
    TEST_TIMEOUT_MS,
  );

  /** YEAR ZERO — T3 round 1's Low-1, and it is `requireCalendarDate`'s own
   *  failure mode rather than a curiosity. `0000-01-01` matches `YYYY-MM-DD` AND
   *  round-trips through `Date` identically (JS has a year 0; the Gregorian
   *  calendar does not), so the guard passed it to Postgres, which answers
   *  `date/time field value out of range` — a 500 for the exact input class this
   *  function exists to turn into a 400. */
  it(
    "refuses year zero, which is well-shaped, round-trips, and is not a date",
    async () => {
      const owner = await makeUser("year-zero");
      const org = await makeOrg(owner.cookies, "Hours Year Zero Gym");

      expect(
        (await post(`/v1/orgs/${org.org.id}/closures`, { day: "0000-01-01" }, owner.cookies))
          .statusCode,
      ).toBe(400);
      expect(
        (await del(`/v1/orgs/${org.org.id}/closures/0000-01-01`, owner.cookies)).statusCode,
      ).toBe(400);

      // THE POSITIVE CONTROL IS THE YEAR NEXT DOOR, deliberately: `0001-01-01`
      // IS a date Postgres accepts, so a fix that simply refused old years would
      // fail here rather than looking correct.
      expect(
        (await post(`/v1/orgs/${org.org.id}/closures`, { day: "0001-01-01" }, owner.cookies))
          .statusCode,
      ).toBe(200);
    },
    TEST_TIMEOUT_MS,
  );

  /** THE CLOSURE LIST IS BOUNDED AT BOTH ENDS — T3 round 1's Low-5, which found
   *  the reader's own comment claiming a bound it did not have. Trimming only the
   *  past bounds nothing when `day` reaches `9999-12-31`. */
  it(
    "does not carry a closure past the one-year horizon onto a member's card",
    async () => {
      const owner = await makeUser("horizon-owner");
      const org = await makeOrg(owner.cookies, "Hours Horizon Gym");

      const near = await gymDay(org.org.id, 300);
      const far = await gymDay(org.org.id, 400);
      for (const day of [near, far]) {
        expect(
          (await post(`/v1/orgs/${org.org.id}/closures`, { day }, owner.cookies)).statusCode,
        ).toBe(200);
      }

      const hours = await readHours(org.org.id, owner.cookies);
      expect(hours.closures.map((c) => c.day)).toEqual([near]);

      // BOTH ROWS ARE STILL THERE: the horizon is a READ bound, not a refusal.
      // A gym may type a closure years ahead; it simply does not ride on every
      // member's payload until it is within a year.
      const rows = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM gym_closures WHERE gym_id = ${org.org.id}`;
      expect(rows[0]?.n).toBe(2);
    },
    TEST_TIMEOUT_MS,
  );

  /** RE-CLOSING A DAY WITH THE SAME NOTE IS NOT AN EVENT — T3 round 1's Low-6.
   *  `removeGymClosure` already refused to log a non-event and said why;
   *  `closeGymDay` was writing `org.day_closed` on every call, so a double-tap
   *  left two rows claiming two changes for one state. */
  it(
    "audits a closure once, not once per tap — and audits a CHANGED note again",
    async () => {
      const owner = await makeUser("audit-noop");
      const org = await makeOrg(owner.cookies, "Hours Audit NoOp Gym");
      const day = futureDay(80);

      const auditCount = async () => {
        const rows = await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM audit_log
          WHERE gym_id = ${org.org.id} AND action = 'org.day_closed'`;
        return rows[0]?.n ?? -1;
      };

      await post(`/v1/orgs/${org.org.id}/closures`, { day, note: "Holi" }, owner.cookies);
      expect(await auditCount()).toBe(1);

      // The same request again — the state does not move, so the log does not.
      await post(`/v1/orgs/${org.org.id}/closures`, { day, note: "Holi" }, owner.cookies);
      expect(await auditCount()).toBe(1);

      // A CHANGED reason IS an event, and the control is what stops the fix
      // above being satisfied by a function that logs nothing at all.
      await post(`/v1/orgs/${org.org.id}/closures`, { day, note: "Staff training" }, owner.cookies);
      expect(await auditCount()).toBe(2);
    },
    TEST_TIMEOUT_MS,
  );

  /** THE GYM'S CHOSEN CLOCK — Kd at the screen, 2026-09-01: *"for time both
   *  format shpuld be ther gym can choose format like it will be 4 or 16"*.
   *
   *  It is stored on the GYM and returned on the HOURS read, so the owner's
   *  console and every member's card draw the same Monday the same way. The two
   *  assertions are a pair on purpose: either alone passes with the field
   *  hard-coded.
   *
   *  **It rides on `PATCH /v1/orgs/:gymId` and not on `PUT /hours`, and this
   *  test drives that**: the gym here is `unset`, so it could not send a hours
   *  request at all — and that is precisely the gym about to type its first
   *  timetable, which must be able to pick a clock first. */
  it(
    "a gym picks its own clock, and it reaches the hours read",
    async () => {
      const owner = await makeUser("clock-owner");
      const org = await makeOrg(owner.cookies, "Hours Clock Gym");

      // Every gym starts on the clock its screens already drew, so nothing is
      // invented for the gyms that existed before this column did.
      expect((await readHours(org.org.id, owner.cookies)).clockFormat).toBe("24h");

      const patched = await api().inject({
        method: "PATCH",
        url: `/v1/orgs/${org.org.id}`,
        remoteAddress: nextIp(),
        headers: { "content-type": "application/json" },
        cookies: owner.cookies,
        payload: JSON.stringify({ clockFormat: "12h" }),
      });
      expect(patched.statusCode).toBe(200);

      // The gym has NOT set hours, so this whole exchange happened on a gym that
      // cannot use `PUT /hours` — the reason the field lives on the org patch.
      const hours = await readHours(org.org.id, owner.cookies);
      expect(hours.mode).toBe("unset");
      expect(hours.clockFormat).toBe("12h");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuses a clock nobody defined, and a member of the gym reads the gym's choice",
    async () => {
      const owner = await makeUser("clock-bad-owner");
      const member = await makeUser("clock-bad-member");
      const org = await makeOrg(owner.cookies, "Hours Clock Bad Gym");
      await joinAsMember(member.cookies, org, owner.cookies);

      const refused = await api().inject({
        method: "PATCH",
        url: `/v1/orgs/${org.org.id}`,
        remoteAddress: nextIp(),
        headers: { "content-type": "application/json" },
        cookies: owner.cookies,
        payload: JSON.stringify({ clockFormat: "am_pm" }),
      });
      expect(refused.statusCode).toBe(400);

      const accepted = await api().inject({
        method: "PATCH",
        url: `/v1/orgs/${org.org.id}`,
        remoteAddress: nextIp(),
        headers: { "content-type": "application/json" },
        cookies: owner.cookies,
        payload: JSON.stringify({ clockFormat: "12h" }),
      });
      expect(accepted.statusCode).toBe(200);

      // ONE GYM, ONE CLOCK. A member reading a different one from their own
      // gym's console is what putting this on the gym row exists to prevent.
      expect((await readHours(org.org.id, member.cookies)).clockFormat).toBe("12h");
    },
    TEST_TIMEOUT_MS,
  );

  // -------------------------------------------------------------------------
  // THE REPO'S OWN TENANCY, driven DIRECTLY — and it has to be, which is the
  // point of this block.
  //
  // The service always hands the repo the gym id it just authorised, so from a
  // route there is no way to reach the repo holding a mismatched pair: deleting
  // `gym_id` from a repo predicate is INVISIBLE to every route test in this
  // file, including the cross-tenant ones, because those are refused at the
  // privilege gate before a query runs. R3.2's rule is about the repo, so the
  // proof has to be too (`orgs.routes.test.ts` calls the repo directly for the
  // same reason).
  // -------------------------------------------------------------------------

  it(
    "repo: reading one gym's hours never returns another gym's sessions or closures",
    async () => {
      const ownerA = await makeUser("repo-a");
      const ownerB = await makeUser("repo-b");
      const gymA = await makeOrg(ownerA.cookies, "Hours Repo A Gym");
      const gymB = await makeOrg(ownerB.cookies, "Hours Repo B Gym");
      const dayA = futureDay(60);
      const dayB = futureDay(61);

      await put(
        `/v1/orgs/${gymA.org.id}/hours`,
        { mode: "scheduled", week: [{ weekday: 1, sessions: [{ opensMinute: 360, closesMinute: 420 }] }] },
        ownerA.cookies,
      );
      await put(
        `/v1/orgs/${gymB.org.id}/hours`,
        { mode: "scheduled", week: [{ weekday: 5, sessions: [{ opensMinute: 900, closesMinute: 960 }] }] },
        ownerB.cookies,
      );
      await post(`/v1/orgs/${gymA.org.id}/closures`, { day: dayA }, ownerA.cookies);
      await post(`/v1/orgs/${gymB.org.id}/closures`, { day: dayB }, ownerB.cookies);

      const a = await orgRepo.getGymHours(sql, gymA.org.id);
      expect(a?.sessions).toEqual([{ weekday: 1, opensMinute: 360, closesMinute: 420 }]);
      expect(a?.closures).toEqual([{ day: dayA, note: null }]);

      // The control: B's rows exist and are DIFFERENT, so "A saw only A's" is a
      // statement about scoping rather than about an empty table.
      const b = await orgRepo.getGymHours(sql, gymB.org.id);
      expect(b?.sessions).toEqual([{ weekday: 5, opensMinute: 900, closesMinute: 960 }]);
      expect(b?.closures).toEqual([{ day: dayB, note: null }]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "repo: replacing one gym's week leaves every other gym's sessions untouched",
    async () => {
      const ownerA = await makeUser("repo-set-a");
      const ownerB = await makeUser("repo-set-b");
      const gymA = await makeOrg(ownerA.cookies, "Hours Repo Set A Gym");
      const gymB = await makeOrg(ownerB.cookies, "Hours Repo Set B Gym");

      await put(
        `/v1/orgs/${gymB.org.id}/hours`,
        { mode: "scheduled", week: [{ weekday: 5, sessions: [{ opensMinute: 900, closesMinute: 960 }] }] },
        ownerB.cookies,
      );

      // A's write goes through the REPO with A's id — the DELETE inside it is
      // the statement whose `gym_id` predicate this test exists to watch.
      const outcome = await orgRepo.setGymHours(sql, {
        gymId: gymA.org.id,
        mode: "scheduled",
        sessions: [{ weekday: 2, opensMinute: 60, closesMinute: 120 }],
        actorUserId: ownerA.userId,
      });
      expect(outcome.kind).toBe("set");

      const b = await orgRepo.getGymHours(sql, gymB.org.id);
      expect(b?.sessions).toEqual([{ weekday: 5, opensMinute: 900, closesMinute: 960 }]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "repo: un-closing a day in one gym leaves the same day closed in another",
    async () => {
      const ownerA = await makeUser("repo-del-a");
      const ownerB = await makeUser("repo-del-b");
      const gymA = await makeOrg(ownerA.cookies, "Hours Repo Del A Gym");
      const gymB = await makeOrg(ownerB.cookies, "Hours Repo Del B Gym");
      // THE SAME DATE IN BOTH GYMS, which is what makes the `gym_id` predicate
      // the only thing standing between them. A different date per gym would be
      // scoped by the `day` clause and the test would pass with tenancy gone.
      const day = futureDay(62);

      await post(`/v1/orgs/${gymA.org.id}/closures`, { day, note: "A" }, ownerA.cookies);
      await post(`/v1/orgs/${gymB.org.id}/closures`, { day, note: "B" }, ownerB.cookies);

      const outcome = await orgRepo.removeGymClosure(sql, {
        gymId: gymA.org.id,
        day,
        actorUserId: ownerA.userId,
      });
      expect(outcome.kind).toBe("removed");

      const b = await orgRepo.getGymHours(sql, gymB.org.id);
      expect(b?.closures).toEqual([{ day, note: "B" }]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "repo: closing a day writes it to the named gym and to no other",
    async () => {
      const ownerA = await makeUser("repo-close-a");
      const ownerB = await makeUser("repo-close-b");
      const gymA = await makeOrg(ownerA.cookies, "Hours Repo Close A Gym");
      const gymB = await makeOrg(ownerB.cookies, "Hours Repo Close B Gym");
      const day = futureDay(63);

      await orgRepo.closeGymDay(sql, {
        gymId: gymA.org.id,
        day,
        note: "A only",
        actorUserId: ownerA.userId,
      });

      expect((await orgRepo.getGymHours(sql, gymA.org.id))?.closures).toEqual([
        { day, note: "A only" },
      ]);
      expect((await orgRepo.getGymHours(sql, gymB.org.id))?.closures).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  // -------------------------------------------------------------------------
  // HELPERS that need the database, kept at the bottom so the tests read first
  // -------------------------------------------------------------------------

  /** A date far enough out that no test's "today" can collide with it, in UTC.
   *  Deliberately NOT the gym's zone: these are closures whose only requirement
   *  is being in the future for every gym in the suite, and the one test that
   *  genuinely turns on the gym's calendar uses `gymDay` below instead. */
  function futureDay(offsetDays: number): string {
    const d0 = new Date();
    d0.setUTCDate(d0.getUTCDate() + offsetDays);
    return d0.toISOString().slice(0, 10);
  }

  /** THE GYM'S OWN CALENDAR DATE, asked of Postgres rather than computed here.
   *
   *  Computing it in JS would need a second implementation of the zone maths the
   *  code under test uses, and a test that re-implements its subject passes when
   *  both are wrong the same way (:6386's shape). This asks the database the
   *  same question the reader asks. */
  async function gymDay(gymId: string, offsetDays: number): Promise<string> {
    // `::int` on the parameter is load-bearing: `postgres` sends an untyped
    // parameter and `date + unknown` is ambiguous in Postgres (there are several
    // `+` operators on `date`), which fails as `operator is not unique` rather
    // than as anything a reader would connect to this line.
    const rows = await sql<{ day: string }[]>`
      SELECT (((now() AT TIME ZONE g.timezone)::date) + ${offsetDays}::int)::text AS day
      FROM gyms g WHERE g.id = ${gymId}`;
    const day = rows[0]?.day;
    if (day === undefined) throw new Error("gym not found while computing its day");
    return day;
  }
});
