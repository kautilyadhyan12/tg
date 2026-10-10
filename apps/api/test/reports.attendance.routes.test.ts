// The Reports page's attendance figures, through its route against real Postgres
// (DATABASE_URL-gated). ROADMAP Stage 2 item 21a-ii; spec Part 3 §16.5.
//
// The first test is the worst thing this job could do: one gym's visits or class numbers
// shown to another gym, or a busiest hour or a no-show figure that is false. Two gyms in
// two time zones each hold a dated history; each reads only its own, to the visit, and
// nobody outside reads either.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { attendanceReportResponseSchema, orgOverviewResponseSchema, type AttendanceReport } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "reports-attend-routes-secret-01234567890", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  CHECKIN_PASS_SECRET: "reports-attend-pass-secret-0123456789abc", // dummy test value, gitleaks:allow
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
interface User {
  userId: string;
  email: string;
  cookies: Cookies;
}

const TEST_TIMEOUT_MS = 120_000;
const HOOK_TIMEOUT_MS = 90_000;
const LIVE_PLAN = "zz_reports_attendance_routes";
/** Saturday 10 October 2026, midday in London. */
const NOON = new Date("2026-10-10T11:00:00Z");

let ipCounter = 0;
const nextIp = () => `10.22.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

d("Reports, attendance: whose figures, who reads them, and what they count (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  /** The routes' clock: fixed for a dated history, the real one otherwise. */
  let clock: Date | null = null;
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'rep-a-%@example.com')`;
    await sql`DELETE FROM gym_class_bookings WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_attendance WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_uploads WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_fields WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'rep-a-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST" | "DELETE", path: string, cookies: Cookies, payload?: unknown, ip = nextIp()) =>
    api().inject({
      method,
      url: path,
      remoteAddress: ip,
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const get = (path: string, cookies: Cookies = {}, ip?: string) => send("GET", path, cookies, undefined, ip);
  const post = (path: string, payload: unknown, cookies: Cookies = {}) => send("POST", path, cookies, payload);

  const makeUser = async (local: string): Promise<User> => {
    const email = `rep-a-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Rep ${local}` });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, email, cookies: cookieMap(login) };
  };

  const subscribeGym = async (gymId: string) => {
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
  };

  const makeGym = async (owner: User, name: string, timezone = "Europe/London"): Promise<string> => {
    const res = await post("/v1/orgs", { trainsHere: false, name, city: "Leeds", country: "GB", timezone }, owner.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const gymId = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await subscribeGym(gymId);
    return gymId;
  };

  /** Somebody on the gym's staff: holding exactly these ticks, or the role's own with null. */
  const makeStaff = async (gymId: string, who: User, role: "manager" | "trainer", privileges: string[] | null) => {
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gymId}, ${who.userId}, ${role}, ${privileges})`;
  };

  let personNo = 0;
  /** A record written straight into the list; `leftAt` makes it a former one. */
  const listed = async (gymId: string, name: string, opts: { leftAt?: string } = {}): Promise<string> => {
    personNo += 1;
    const rows = await sql<{ id: string }[]>`
      INSERT INTO gym_member_list_entries (gym_id, full_name, email, identity_key, source, created_at, former_at)
      VALUES (${gymId}, ${name}, ${`rep-a-listed-${String(personNo)}@example.com`}, ${String(personNo).padStart(64, "0")}, 'typed',
              '2026-06-01T09:00:00Z'::timestamptz, ${opts.leftAt ?? null}::timestamptz)
      RETURNING id`;
    const row = rows[0];
    if (row === undefined) throw new Error("no record");
    return row.id;
  };

  interface Gym {
    id: string;
    timezone: string;
    ownerId: string;
  }
  /** A visit already in the database, as staff's Check in leaves it at that instant; its
   *  day is the gym's own. `addedFor` is a visit staff added later for that day. */
  const visit = async (gym: Gym, who: { entryId?: string; userId?: string }, at: string, addedFor?: string) => {
    const how = addedFor === undefined ? "hours_unset" : "added_later";
    await sql`
      INSERT INTO gym_attendance (gym_id, user_id, entry_id, marked_by_user_id, day, method, hours_status, slot_key, marked_at)
      VALUES (${gym.id}, ${who.userId ?? null}, ${who.entryId ?? null}, ${gym.ownerId},
              COALESCE(${addedFor ?? null}::date, (${at}::timestamptz AT TIME ZONE ${gym.timezone})::date), 'staff',
              ${how}, ${how}, ${at}::timestamptz)`;
  };

  const classType = async (gymId: string, name: string, places: number | null): Promise<string> => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO gym_class_types (gym_id, name, minutes, places, colour, open_gym)
      VALUES (${gymId}, ${name}, 45, ${places}, 'blue', false) RETURNING id`;
    const row = rows[0];
    if (row === undefined) throw new Error("no class type");
    return row.id;
  };
  /** One class of a type at an instant, with a booking of each status given. */
  const classAt = async (
    gym: Gym,
    typeId: string,
    at: string,
    places: number | null,
    bookings: readonly (readonly [User, string])[],
    status: "scheduled" | "cancelled" = "scheduled",
  ) => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO gym_class_sessions (gym_id, class_type_id, local_date, local_start_minute, starts_at, minutes, places, status)
      SELECT ${gym.id}, ${typeId}, l::date, (EXTRACT(HOUR FROM l) * 60 + EXTRACT(MINUTE FROM l))::int, ${at}::timestamptz, 45, ${places}, ${status}
      FROM (SELECT ${at}::timestamptz AT TIME ZONE ${gym.timezone} AS l) x
      RETURNING id`;
    const row = rows[0];
    if (row === undefined) throw new Error("no class");
    for (const [who, state] of bookings) {
      const cancelled = state === "cancelled" || state === "late_cancelled";
      await sql`
        INSERT INTO gym_class_bookings (gym_id, session_id, user_id, request_key, status, pack_charged, booked_at, cancelled_at)
        VALUES (${gym.id}, ${row.id}, ${who.userId}, gen_random_uuid(), ${state}, false,
                ${state === "waitlisted" ? null : "2026-08-01T09:00:00Z"}::timestamptz, ${cancelled ? "2026-08-02T09:00:00Z" : null}::timestamptz)`;
    }
  };

  const reportUrl = (gymId: string) => `/v1/orgs/${gymId}/reports/attendance`;
  const read = async (gymId: string, who: User): Promise<AttendanceReport> => {
    const res = await get(reportUrl(gymId), who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return attendanceReportResponseSchema.parse(JSON.parse(res.body)).report;
  };
  /** Every day from `from` to `to`, with the visits given and a zero for the rest. */
  const everyDay = (from: string, to: string, visits: Record<string, number>) => {
    const days: { day: string; visits: number }[] = [];
    for (let at = Date.parse(`${from}T00:00:00Z`); at <= Date.parse(`${to}T00:00:00Z`); at += 86_400_000) {
      const day = new Date(at).toISOString().slice(0, 10);
      days.push({ day, visits: visits[day] ?? 0 });
    }
    return days;
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval,
                         seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month',
              100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), {
      redis,
      orgs: { now: () => clock ?? new Date() },
      emailSender: {
        sendVerificationEmail: () => Promise.resolve(),
        sendPasswordResetEmail: () => Promise.resolve(),
        sendSignInCodeEmail: () => Promise.resolve(),
      },
    });
    await api().ready();
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, HOOK_TIMEOUT_MS);

  it(
    "a gym's visits and classes are its own and true to the visit: two gyms in two time zones each read only theirs, and nobody outside reads either",
    async () => {
      const londonOwner = await makeUser("worst-london-owner");
      const delhiOwner = await makeUser("worst-delhi-owner");
      const stranger = await makeUser("worst-stranger");
      const bookers: User[] = [];
      for (let i = 1; i <= 6; i += 1) bookers.push(await makeUser(`worst-booker-${String(i)}`));
      const [u1, u2, u3, u4, u5, u6] = bookers;
      if (u1 === undefined || u2 === undefined || u3 === undefined || u4 === undefined || u5 === undefined || u6 === undefined) throw new Error("no bookers");
      const london: Gym = { id: await makeGym(londonOwner, "Rep London"), timezone: "Europe/London", ownerId: londonOwner.userId };
      const delhi: Gym = { id: await makeGym(delhiOwner, "Rep Delhi", "Asia/Kolkata"), timezone: "Asia/Kolkata", ownerId: delhiOwner.userId };

      // LONDON, on summer time (an hour ahead of UTC). Its first check-in is Monday 31 August.
      const ana = { entryId: await listed(london.id, "Ana Regular") };
      const ben = { entryId: await listed(london.id, "Ben Sometimes") };
      const cat = { entryId: await listed(london.id, "Cat Added") };
      const dan = { entryId: await listed(london.id, "Dan Former", { leftAt: "2026-09-25T09:00:00Z" }) };
      await visit(london, ana, "2026-08-31T17:10:00Z"); // Mon 18:10
      await visit(london, ana, "2026-09-07T17:30:00Z"); // Mon 18:30
      await visit(london, ana, "2026-09-14T17:05:00Z"); // Mon 18:05
      await visit(london, ben, "2026-09-14T17:40:00Z"); // Mon 18:40
      await visit(london, ana, "2026-09-16T06:15:00Z"); // Wed 07:15
      // Added on the 17th for the 15th: a visit of that day with no time.
      await visit(london, cat, "2026-09-17T10:00:00Z", "2026-09-15");
      // Somebody since removed: their visit is a visit, and not a member's.
      await visit(london, dan, "2026-09-21T17:20:00Z"); // Mon 18:20
      // 23:30 on Sunday 4 October in London: the last hour of the last full week.
      await visit(london, ben, "2026-10-04T22:30:00Z");
      // An hour later, 00:30 on Monday 5 October though still Sunday in UTC: this week's.
      await visit(london, ben, "2026-10-04T23:30:00Z");
      await visit(london, ana, "2026-10-08T11:00:00Z"); // Thu 12:00
      // The owner, on no list: counted by their app account.
      await visit(london, { userId: londonOwner.userId }, "2026-10-10T08:00:00Z"); // today, Sat 09:00

      const spin = await classType(london.id, "Spin", 10);
      const open = await classType(london.id, "Open gym", null);
      await classAt(london, spin, "2026-10-06T17:00:00Z", 10, [
        [u1, "attended"],
        [u2, "no_show"],
        [u3, "booked"],
        [u4, "cancelled"],
        [u5, "waitlisted"],
        [u6, "late_cancelled"],
      ]);
      // Its places cut to 2 after three had booked: full, never over.
      await classAt(london, spin, "2026-10-07T17:00:00Z", 2, [
        [u1, "attended"],
        [u2, "attended"],
        [u3, "no_show"],
      ]);
      await classAt(london, spin, "2026-10-08T17:00:00Z", 10, [[u1, "booked"]], "cancelled");
      // Later today, and the day before the eight weeks begin: neither is counted.
      await classAt(london, spin, "2026-10-10T17:00:00Z", 10, [[u1, "booked"]]);
      await classAt(london, spin, "2026-08-15T17:00:00Z", 10, [[u1, "no_show"]]);
      await classAt(london, open, "2026-10-09T09:00:00Z", null, [
        [u1, "attended"],
        [u2, "booked"],
      ]);

      // DELHI, five and a half hours ahead. 20:00 UTC on Sunday 27 September is 01:30 on Monday the 28th there.
      const dev = { entryId: await listed(delhi.id, "Dev Delhi") };
      await visit(delhi, dev, "2026-09-27T20:00:00Z");
      // The instant that is London's Sunday 23:30 is Delhi's Monday 5 October, 04:00.
      await visit(delhi, dev, "2026-10-04T22:30:00Z");
      // A class set up and never run.
      await classType(delhi.id, "Yoga", 12);

      clock = NOON;
      try {
        expect(await read(london.id, londonOwner)).toEqual({
          timezone: "Europe/London",
          today: "2026-10-10",
          firstVisitOn: "2026-08-31",
          fullWeeks: 5,
          days: everyDay("2026-09-13", "2026-10-10", {
            "2026-09-14": 2,
            "2026-09-15": 1,
            "2026-09-16": 1,
            "2026-09-21": 1,
            "2026-10-04": 1,
            "2026-10-05": 1,
            "2026-10-08": 1,
            "2026-10-10": 1,
          }),
          weeks: [
            { weekStart: "2026-08-31", visits: 1, people: 1, full: true },
            { weekStart: "2026-09-07", visits: 1, people: 1, full: true },
            { weekStart: "2026-09-14", visits: 4, people: 3, full: true },
            { weekStart: "2026-09-21", visits: 1, people: 1, full: true },
            { weekStart: "2026-09-28", visits: 1, people: 1, full: true },
            { weekStart: "2026-10-05", visits: 3, people: 3, full: false },
          ],
          // Ana, Ben and Cat are on the list; between them 6 visits in the four weeks to 4 October.
          perMember: { state: "ok", perWeek: 0.5, from: "2026-09-07", to: "2026-10-04", weeks: 4, members: 3, visits: 6, visitors: 3 },
          hours: {
            state: "ok",
            from: "2026-08-31",
            to: "2026-10-04",
            weeks: 5,
            cells: [
              { weekday: 1, hour: 18, visits: 5 },
              { weekday: 3, hour: 7, visits: 1 },
              { weekday: 7, hour: 23, visits: 1 },
            ],
            top: 5,
            busiest: [{ weekday: 1, hour: 18 }],
            tied: 1,
            noTime: 1,
          },
          classes: {
            state: "ok",
            from: "2026-08-16",
            classes: 3,
            bookings: 8,
            // 3 of 10 and 2 of 2; the class with no limit has no share.
            fill: { state: "ok", percent: 41.7, booked: 5, places: 12, classes: 2 },
            noShows: { state: "ok", percent: 33.3, noShows: 2, marked: 6, unmarked: 2 },
            types: [
              { name: "Spin", classes: 2, places: 12, booked: 5, fillPercent: 41.7, attended: 3, noShows: 2, noShowPercent: 40 },
              { name: "Open gym", classes: 1, places: null, booked: 2, fillPercent: null, attended: 1, noShows: 0, noShowPercent: 0 },
            ],
            moreTypes: 0,
          },
        });

        expect(await read(delhi.id, delhiOwner)).toEqual({
          timezone: "Asia/Kolkata",
          today: "2026-10-10",
          firstVisitOn: "2026-09-28",
          // One whole week, where two are needed.
          fullWeeks: 1,
          days: everyDay("2026-09-28", "2026-10-10", { "2026-09-28": 1, "2026-10-05": 1 }),
          weeks: [
            { weekStart: "2026-09-28", visits: 1, people: 1, full: true },
            { weekStart: "2026-10-05", visits: 1, people: 1, full: false },
          ],
          perMember: { state: "not_enough_data" },
          hours: { state: "not_enough_data" },
          classes: { state: "none_recent", from: "2026-08-16" },
        });

        // Nobody from outside reads either gym, and the refusal carries none of its numbers.
        for (const [who, gymId] of [
          [stranger, london.id],
          [stranger, delhi.id],
          [delhiOwner, london.id],
          [londonOwner, delhi.id],
          [u1, london.id],
        ] as const) {
          const res = await get(reportUrl(gymId), who.cookies);
          expect(res.statusCode, res.body).toBe(404);
          expect(res.body).not.toMatch(/visits|weeks|classes|Spin/);
        }
        expect((await get(reportUrl(london.id))).statusCode).toBe(401);

        // Counts only: no name and no address of anybody who came or booked.
        const raw = (await get(reportUrl(london.id), londonOwner.cookies)).body;
        expect(raw).not.toMatch(/Ana|Ben|Cat|Dan|Rep worst|rep-a-|@example\.com/);
      } finally {
        clock = null;
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a gym that uses neither check-in nor classes is told so, never shown a zero",
    async () => {
      const owner = await makeUser("empty-owner");
      const gym = await makeGym(owner, "Rep Empty");
      await listed(gym, "Only Listed");
      expect(await read(gym, owner)).toMatchObject({
        firstVisitOn: null,
        fullWeeks: 0,
        days: [],
        weeks: [],
        perMember: { state: "not_enough_data" },
        hours: { state: "not_enough_data" },
        classes: { state: "none_ever" },
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the figures follow the real Check in, and a week here is the week Overview shows",
    async () => {
      const owner = await makeUser("real-owner");
      const gymId = await makeGym(owner, "Rep Real");
      const first = await listed(gymId, "First Comer");
      const second = await listed(gymId, "Second Comer");
      for (const entryId of [first, second, first]) {
        const res = await post(`/v1/orgs/${gymId}/attendance/check-in`, { entryId }, owner.cookies);
        expect(res.statusCode, res.body).toBe(200);
      }
      const report = await read(gymId, owner);
      const today = report.days[report.days.length - 1];
      const week = report.weeks[report.weeks.length - 1];
      // The second press for the same person the same day is no second visit.
      expect(report.firstVisitOn).toBe(report.today);
      expect(report.days).toHaveLength(1);
      expect(today).toEqual({ day: report.today, visits: 2 });
      expect(week).toMatchObject({ visits: 2, people: 2, full: false });

      const overviewRes = await get(`/v1/orgs/${gymId}/overview`, owner.cookies);
      expect(overviewRes.statusCode, overviewRes.body).toBe(200);
      const { overview } = orgOverviewResponseSchema.parse(JSON.parse(overviewRes.body));
      expect({ visits: overview.tiles.week.visits, people: overview.tiles.week.visitors, today: overview.tiles.today.visits }).toEqual({
        visits: week?.visits,
        people: week?.people,
        today: today?.visits,
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "who may read: the owner and a manager; a trainer and a manager without the tick are refused; a tick gives it to a trainer",
    async () => {
      const owner = await makeUser("ticks-owner");
      const gym = await makeGym(owner, "Rep Ticks");
      const manager = await makeUser("ticks-manager");
      const narrowed = await makeUser("ticks-narrowed");
      const trainer = await makeUser("ticks-trainer");
      const ticked = await makeUser("ticks-ticked");
      await makeStaff(gym, manager, "manager", null);
      await makeStaff(gym, narrowed, "manager", ["members.read", "members.confirm", "attendance.read"]);
      await makeStaff(gym, trainer, "trainer", null);
      await makeStaff(gym, ticked, "trainer", ["members.read", "reports.read"]);

      for (const who of [owner, manager, ticked]) expect((await get(reportUrl(gym), who.cookies)).statusCode).toBe(200);
      for (const who of [narrowed, trainer]) {
        const res = await get(reportUrl(gym), who.cookies);
        expect(res.statusCode, res.body).toBe(403);
        expect(res.body).not.toMatch(/visits|weeks|classes/);
      }
      expect((await get("/v1/orgs/not-a-gym/reports/attendance", owner.cookies)).statusCode).toBe(400);

      // A gym on no plan still reads its own figures, as it reads its own list.
      await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gym}`;
      expect((await get(reportUrl(gym), owner.cookies)).statusCode).toBe(200);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the two reports share one allowance: three staff at one address each read both, and one person's limit stops only that person",
    async () => {
      const owner = await makeUser("limit-owner");
      const gym = await makeGym(owner, "Rep Limit");
      const second = await makeUser("limit-second");
      const third = await makeUser("limit-third");
      await makeStaff(gym, second, "manager", null);
      await makeStaff(gym, third, "manager", null);
      const desk = "10.22.200.7";
      const membersUrl = `/v1/orgs/${gym}/reports/members`;
      // The page asks for both each time it opens.
      for (const who of [owner, second, third]) {
        for (let i = 0; i < 5; i += 1) {
          expect((await get(membersUrl, who.cookies, desk)).statusCode).toBe(200);
          expect((await get(reportUrl(gym), who.cookies, desk)).statusCode).toBe(200);
        }
      }
      // The owner alone goes past a person's 120 an hour, counted over both reports.
      let refused = 0;
      for (let i = 0; i < 115; i += 1) if ((await get(reportUrl(gym), owner.cookies, desk)).statusCode === 429) refused += 1;
      expect(refused).toBe(5);
      expect((await get(membersUrl, owner.cookies, desk)).statusCode).toBe(429);
      expect((await get(reportUrl(gym), second.cookies, desk)).statusCode).toBe(200);
      expect((await get(membersUrl, third.cookies, desk)).statusCode).toBe(200);

      // Somebody refused uses up nobody's allowance.
      const addressKey = `rl:orgs_reports:ip:${gym}:${desk}`;
      const before = await redis.get(addressKey);
      const stranger = await makeUser("limit-stranger");
      const trainer = await makeUser("limit-trainer");
      await makeStaff(gym, trainer, "trainer", null);
      for (let i = 0; i < 20; i += 1) {
        expect((await get(reportUrl(gym), stranger.cookies, desk)).statusCode).toBe(404);
        expect((await get(reportUrl(gym), trainer.cookies, desk)).statusCode).toBe(403);
      }
      expect(await redis.get(addressKey)).toBe(before);
      expect(await redis.get(`rl:orgs_reports:id:${stranger.userId}`)).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );
});
