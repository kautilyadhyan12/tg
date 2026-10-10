// The Reports page's members figures, through its route against real Postgres
// (DATABASE_URL-gated). ROADMAP Stage 2 item 21a-i; spec Part 3 §16.5.
//
// The first test is the worst thing this job could do: one gym's numbers shown to another
// gym, or a churn figure that is false. Two gyms in two time zones each hold a dated
// history; each reads only its own, to the person, and nobody outside reads either.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { membersReportResponseSchema, type MembersReport } from "@app/shared";
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
  JWT_SECRET: "reports-members-routes-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  CHECKIN_PASS_SECRET: "reports-members-pass-secret-0123456789ab", // dummy test value, gitleaks:allow
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
const LIVE_PLAN = "zz_reports_members_routes";
/** Saturday 10 October 2026, midday in London. */
const NOON = new Date("2026-10-10T11:00:00Z");

let ipCounter = 0;
const nextIp = () => `10.21.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

d("Reports, members: whose figures, who reads them, and what they count (real Postgres)", () => {
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
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'rep-t-%@example.com')`;
    await sql`DELETE FROM gym_leads WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_uploads WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_fields WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'rep-t-%@example.com'`;
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
    const email = `rep-t-${local}@example.com`;
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
  /** A record written straight into the list with its own dates, as months of use would leave it. */
  const listed = async (gymId: string, name: string, listedAt: string, opts: { joinedOn?: string; leftAt?: string } = {}) => {
    personNo += 1;
    await sql`
      INSERT INTO gym_member_list_entries (gym_id, full_name, email, identity_key, source, created_at, joined_on, former_at)
      VALUES (${gymId}, ${name}, ${`rep-t-listed-${String(personNo)}@example.com`}, ${String(personNo).padStart(64, "0")}, 'typed',
              ${listedAt}::timestamptz, ${opts.joinedOn ?? null}::date, ${opts.leftAt ?? null}::timestamptz)`;
  };
  const lead = async (gymId: string, source: string, status: string) => {
    personNo += 1;
    await sql`
      INSERT INTO gym_leads (gym_id, full_name, email, source, status)
      VALUES (${gymId}, ${`Lead Person ${String(personNo)}`}, ${`rep-t-lead-${String(personNo)}@example.com`}, ${source}, ${status})`;
  };

  const reportUrl = (gymId: string) => `/v1/orgs/${gymId}/reports/members`;
  const read = async (gymId: string, who: User): Promise<MembersReport> => {
    const res = await get(reportUrl(gymId), who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return membersReportResponseSchema.parse(JSON.parse(res.body)).report;
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
    "a gym's figures are its own and true to the person: two gyms in two time zones each read only theirs, and nobody outside reads either",
    async () => {
      const londonOwner = await makeUser("worst-london-owner");
      const delhiOwner = await makeUser("worst-delhi-owner");
      const stranger = await makeUser("worst-stranger");
      const london = await makeGym(londonOwner, "Rep London");
      const delhi = await makeGym(delhiOwner, "Rep Delhi", "Asia/Kolkata");

      // LONDON. Its list began on 10 June 2026 with thirteen people.
      // Ten whose file gave a join date of January 2025: they started then.
      for (let i = 1; i <= 8; i += 1) await listed(london, `Founder Stayer ${String(i)}`, "2026-06-10T09:00:00Z", { joinedOn: "2025-01-15" });
      // Left at 23:30 on 30 September by London's clock: September's leaver.
      await listed(london, "Founder September", "2026-06-10T09:00:00Z", { joinedOn: "2025-01-15", leftAt: "2026-09-30T22:30:00Z" });
      // Left an hour later, 00:30 on 1 October in London though still 30 September in UTC: October's.
      await listed(london, "Founder October", "2026-06-10T09:00:00Z", { joinedOn: "2025-01-15", leftAt: "2026-09-30T23:30:00Z" });
      // No join date: they start the day they went on the list.
      await listed(london, "Nodate Stayer", "2026-06-10T09:00:00Z");
      await listed(london, "Nodate August", "2026-06-10T09:00:00Z", { leftAt: "2026-08-20T10:00:00Z" });
      // A join date after the day they were listed is not believed over that day.
      await listed(london, "Future Dated", "2026-06-10T09:00:00Z", { joinedOn: "2027-01-01" });
      // Joined and left inside July: in Left, never in churn.
      await listed(london, "July Only", "2026-07-05T09:00:00Z", { leftAt: "2026-07-25T09:00:00Z" });
      await listed(london, "October New", "2026-10-03T09:00:00Z");
      await lead(london, "walk_in", "joined");
      await lead(london, "walk_in", "new");
      await lead(london, "walk_in", "lost");
      await lead(london, "friend", "joined");

      // DELHI. The same instants mean other days there: 20:00 UTC on 31 August is 1 September.
      await listed(delhi, "Delhi Stayer", "2026-08-31T20:00:00Z");
      // 19:00 UTC on 30 September is 00:30 on 1 October in Delhi.
      await listed(delhi, "Delhi October", "2026-08-31T20:00:00Z", { leftAt: "2026-09-30T19:00:00Z" });
      await listed(delhi, "Delhi Mid", "2026-09-15T09:00:00Z");
      await lead(delhi, "website", "new");
      await lead(delhi, "website", "contacted");

      clock = NOON;
      try {
        expect(await read(london, londonOwner)).toEqual({
          timezone: "Europe/London",
          today: "2026-10-10",
          listChangedOn: "2026-10-03",
          activeNow: 11,
          everLeft: true,
          fullMonths: 3,
          thisMonth: { month: "2026-10", joined: 1, left: 1 },
          churnMonths: ["2026-07", "2026-08", "2026-09"],
          // Of 13 + 13 + 12 on the list as July, August and September began, 0 + 1 + 1 left.
          churn: { state: "ok", percent: 5.3 },
          retention: { state: "ok", percent: 94.7 },
          // 71 + 20 + 623 + 624 days between the four who left.
          averageStay: { state: "ok", days: 335, leavers: 4 },
          months: [
            { month: "2026-06", full: false, activeAtStart: 10, joined: 3, left: 0, churnPercent: null },
            { month: "2026-07", full: true, activeAtStart: 13, joined: 1, left: 1, churnPercent: 0 },
            { month: "2026-08", full: true, activeAtStart: 13, joined: 0, left: 1, churnPercent: 7.7 },
            { month: "2026-09", full: true, activeAtStart: 12, joined: 0, left: 1, churnPercent: 8.3 },
            { month: "2026-10", full: false, activeAtStart: 11, joined: 1, left: 1, churnPercent: null },
          ],
          leads: {
            total: 4,
            joined: 2,
            percent: 50,
            sources: [
              { source: "walk_in", leads: 3, joined: 1, percent: 33.3 },
              { source: "friend", leads: 1, joined: 1, percent: 100 },
            ],
          },
        });

        expect(await read(delhi, delhiOwner)).toEqual({
          timezone: "Asia/Kolkata",
          today: "2026-10-10",
          listChangedOn: "2026-10-01",
          activeNow: 2,
          everLeft: true,
          // Listed on the 1st by Delhi's clock, so September is a full month: one, not three.
          fullMonths: 1,
          thisMonth: { month: "2026-10", joined: 0, left: 1 },
          churnMonths: [],
          churn: { state: "not_enough_data" },
          retention: { state: "not_enough_data" },
          averageStay: { state: "not_enough_data" },
          months: [
            { month: "2026-09", full: true, activeAtStart: 0, joined: 3, left: 0, churnPercent: null },
            { month: "2026-10", full: false, activeAtStart: 3, joined: 0, left: 1, churnPercent: null },
          ],
          leads: { total: 2, joined: 0, percent: 0, sources: [{ source: "website", leads: 2, joined: 0, percent: 0 }] },
        });

        // Nobody from outside reads either gym, and the refusal carries none of its numbers.
        for (const [who, gymId] of [
          [stranger, london],
          [stranger, delhi],
          [delhiOwner, london],
          [londonOwner, delhi],
        ] as const) {
          const res = await get(reportUrl(gymId), who.cookies);
          expect(res.statusCode, res.body).toBe(404);
          expect(res.body).not.toMatch(/activeNow|churn|months/);
        }
        expect((await get(reportUrl(london))).statusCode).toBe(401);

        // Counts only: no name and no address of anybody on the list or the leads.
        const raw = (await get(reportUrl(london), londonOwner.cookies)).body;
        expect(raw).not.toMatch(/Founder|Nodate|July Only|Lead Person|rep-t-|@example\.com/);
      } finally {
        clock = null;
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the day and the month are the gym's own: half an hour before New York's midnight on the month's last day is still that month",
    async () => {
      const owner = await makeUser("clock-owner");
      const gym = await makeGym(owner, "Rep Clock", "America/New_York");
      await listed(gym, "Clock Stayer", "2026-06-01T12:00:00Z");
      await listed(gym, "Clock Leaver", "2026-06-01T12:00:00Z", { leftAt: "2026-09-10T12:00:00Z" });
      try {
        // 23:30 on 31 October in New York: already 1 November in UTC.
        clock = new Date("2026-11-01T03:30:00Z");
        const before = await read(gym, owner);
        expect([before.today, before.thisMonth.month, before.fullMonths]).toEqual(["2026-10-31", "2026-10", 4]);
        // 00:30 on 1 November in New York.
        clock = new Date("2026-11-01T04:30:00Z");
        const after = await read(gym, owner);
        expect([after.today, after.thisMonth.month, after.fullMonths]).toEqual(["2026-11-01", "2026-11", 5]);
        expect(after.churnMonths).toEqual(["2026-08", "2026-09", "2026-10"]);
        // One of two left in September; two, two and one on the list as the three months began.
        expect(after.churn).toEqual({ state: "ok", percent: 20 });
      } finally {
        clock = null;
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the figures follow what staff do on the Members and Leads pages: add, take off, put back, and a lead marked Joined",
    async () => {
      const owner = await makeUser("wiring-owner");
      const gym = await makeGym(owner, "Rep Wiring");

      const empty = await read(gym, owner);
      expect(empty).toMatchObject({ activeNow: 0, everLeft: false, listChangedOn: null, months: [], fullMonths: 0 });
      expect(empty.churn).toEqual({ state: "nobody_left" });
      expect(empty.leads).toEqual({ total: 0, joined: 0, percent: null, sources: [] });

      const added = await post(`/v1/orgs/${gym}/member-list/entries`, { fullName: "Priya Shah", email: "rep-t-priya@example.com" }, owner.cookies);
      expect([200, 201], added.body).toContain(added.statusCode);
      const [entry] = await sql<{ id: string }[]>`SELECT id FROM gym_member_list_entries WHERE gym_id = ${gym}`;
      if (entry === undefined) throw new Error("the person is not on the list");

      const one = await read(gym, owner);
      expect(one).toMatchObject({ activeNow: 1, everLeft: false, thisMonth: { joined: 1, left: 0 } });
      expect(one.months).toHaveLength(1);
      expect(one.averageStay).toEqual({ state: "nobody_left" });

      const off = await send("DELETE", `/v1/orgs/${gym}/member-list/entries/${entry.id}`, owner.cookies);
      expect(off.statusCode, off.body).toBe(200);
      const gone = await read(gym, owner);
      expect(gone).toMatchObject({ activeNow: 0, everLeft: true, thisMonth: { joined: 1, left: 1 } });
      // Somebody has left, and there are not yet three full months.
      expect(gone.churn).toEqual({ state: "not_enough_data" });

      const back = await post(`/v1/orgs/${gym}/member-list/entries/${entry.id}/restore`, {}, owner.cookies);
      expect(back.statusCode, back.body).toBe(200);
      expect(await read(gym, owner)).toMatchObject({ activeNow: 1, everLeft: false, thisMonth: { joined: 1, left: 0 } });

      const made = await post(`/v1/orgs/${gym}/leads`, { fullName: "Omar Aziz", email: "rep-t-omar@example.com", source: "social" }, owner.cookies);
      expect(made.statusCode, made.body).toBe(201);
      const leadId = (JSON.parse(made.body) as { lead: { id: string } }).lead.id;
      expect((await read(gym, owner)).leads).toEqual({
        total: 1,
        joined: 0,
        percent: 0,
        sources: [{ source: "social", leads: 1, joined: 0, percent: 0 }],
      });
      const joined = await post(`/v1/orgs/${gym}/leads/${leadId}/join`, { asNew: true }, owner.cookies);
      expect(joined.statusCode, joined.body).toBe(200);
      const after = await read(gym, owner);
      expect(after.leads).toEqual({ total: 1, joined: 1, percent: 100, sources: [{ source: "social", leads: 1, joined: 1, percent: 100 }] });
      expect(after).toMatchObject({ activeNow: 2, thisMonth: { joined: 2, left: 0 } });
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
        expect(res.body).not.toMatch(/activeNow|churn|months/);
      }
      expect((await get("/v1/orgs/not-a-gym/reports/members", owner.cookies)).statusCode).toBe(400);

      // A gym on no plan still reads its own figures, as it reads its own list.
      await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gym}`;
      expect((await get(reportUrl(gym), owner.cookies)).statusCode).toBe(200);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "three staff at one address each read their fill, and one person's limit stops only that person",
    async () => {
      const owner = await makeUser("limit-owner");
      const gym = await makeGym(owner, "Rep Limit");
      const second = await makeUser("limit-second");
      const third = await makeUser("limit-third");
      await makeStaff(gym, second, "manager", null);
      await makeStaff(gym, third, "manager", null);
      const desk = "10.21.200.7";
      for (const who of [owner, second, third]) {
        for (let i = 0; i < 5; i += 1) expect((await get(reportUrl(gym), who.cookies, desk)).statusCode).toBe(200);
      }
      // The owner alone goes past a person's 120 an hour.
      let refused = 0;
      for (let i = 0; i < 120; i += 1) if ((await get(reportUrl(gym), owner.cookies, desk)).statusCode === 429) refused += 1;
      expect(refused).toBe(5);
      expect((await get(reportUrl(gym), second.cookies, desk)).statusCode).toBe(200);
      expect((await get(reportUrl(gym), third.cookies, desk)).statusCode).toBe(200);
    },
    TEST_TIMEOUT_MS,
  );
});
