// OVERVIEW'S "LAST 7 DAYS" BOX, through its route against real Postgres (spec Part 3
// §16.4; ROADMAP 20d-ii). DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: show one gym's figures to another
// gym, or to somebody on the staff who may not open the page a figure comes from. That is
// the first test: two gyms with different figures, read by each one's owner, by a
// trainer, a member, next door's owner, a stranger and nobody.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { atRiskResponseSchema, gymWeekResponseSchema, type GymWeek } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "gym-week-test-secret-0123456789abcdef-xyz", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 120_000;
const LIVE_PLAN = "zz_week_live";

let ipCounter = 0;
const nextIp = () => `10.94.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

const THIRTY_DAYS = {
  name: "Thirty days",
  kind: "one_time",
  priceMinor: 3000,
  termCount: 30,
  termUnit: "day",
  description: null,
  packClasses: null,
  packDays: null,
  access: "all_classes",
  bookingsLimit: null,
  bookingsPeriod: null,
  classTypeIds: null,
  includesPt: false,
  ptLimit: null,
  ptPeriod: null,
};

d("Overview's Last 7 days box: whose figures, to whom, and that each is its own page's (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  const clock = new Date();
  let today = "";
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  /** The gym's calendar day `n` days from today. */
  const day = (n: number): string => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'week-t-%@example.com')`;
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'week-t-%@example.com'`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_attendance WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_checkin_devices WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_payments WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_bills WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM user_fitness_profiles WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM one_time_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM refresh_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM consent_log WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM users WHERE email LIKE 'week-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST", path: string, cookies: Cookies, payload?: unknown, remoteAddress: string = nextIp()) =>
    api().inject({
      method,
      url: path,
      remoteAddress,
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });

  interface Person {
    userId: string;
    cookies: Cookies;
  }
  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `week-t-${uniq()}@example.com`;
    const reg = await inject("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await inject("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };

  interface Gym {
    id: string;
    owner: Person;
    deviceId: string;
  }
  const makeGym = async (name: string): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await inject("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Jorhat", country: "IN", timezone: "Asia/Kolkata" });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    const dev = await sql<{ id: string }[]>`INSERT INTO gym_checkin_devices (gym_id, name) VALUES (${id}, 'Front desk') RETURNING id`;
    const deviceId = dev[0]?.id;
    if (deviceId === undefined) throw new Error("no device");
    return { id, owner, deviceId };
  };
  const onStaff = async (gym: Gym, name: string, role: "manager" | "trainer"): Promise<Person> => {
    const person = await signedIn(name);
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${person.userId}, ${role}, ${null})`;
    return person;
  };

  /** Somebody on the gym's list, put there `listedDaysAgo` days ago on the gym's calendar. */
  const record = async (gym: Gym, fullName: string, listedDaysAgo: number, paymentWord: string | null = null): Promise<string> => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO gym_member_list_entries (gym_id, full_name, email, identity_key, source, payment_status, created_at)
      VALUES (${gym.id}, ${fullName}, ${`week-r-${uniq()}@example.com`}, encode(sha256(${`week-${uniq()}`}::bytea), 'hex'), 'typed', ${paymentWord},
              (${day(-listedDaysAgo)}::date + interval '12 hours') AT TIME ZONE 'Asia/Kolkata')
      RETURNING id`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("no record");
    return id;
  };
  /** Taken off the list on the gym's day `daysAgo` days back. */
  const takeOff = async (entryId: string, daysAgo: number): Promise<void> => {
    await sql`UPDATE gym_member_list_entries SET former_at = (${day(-daysAgo)}::date + interval '12 hours') AT TIME ZONE 'Asia/Kolkata' WHERE id = ${entryId}`;
  };
  /** One check-in at the desk on the gym's day `n` days from today. */
  const visit = async (gym: Gym, entryId: string, n: number): Promise<void> => {
    const on = day(n);
    await sql`
      INSERT INTO gym_attendance (gym_id, user_id, entry_id, marked_by_user_id, device_id, day, method, hours_status, slot_key, marked_at)
      VALUES (${gym.id}, NULL, ${entryId}, NULL, ${gym.deviceId}, ${on}::date, 'pass', 'hours_unset', 'hours_unset', ${`${on}T05:00:00Z`}::timestamptz)`;
  };
  /** The desk in use: one person with no app is checked in on each of these days. */
  const deskOpen = async (gym: Gym, from: number, to: number, listedDaysAgo = 200): Promise<void> => {
    const walkIn = await record(gym, `Desk Regular ${uniq()}`, listedDaysAgo);
    for (let n = from; n <= to; n += 1) await visit(gym, walkIn, n);
  };

  const thirtyDays = async (gym: Gym): Promise<string> => {
    const res = await inject("POST", `/v1/orgs/${gym.id}/membership-types`, gym.owner.cookies, THIRTY_DAYS);
    expect(res.statusCode, res.body).toBe(201);
    const found = (JSON.parse(res.body) as { types: { id: string; name: string }[] }).types.find((t) => t.name === THIRTY_DAYS.name);
    if (found === undefined) throw new Error("no type");
    return found.id;
  };
  /** A thirty-day membership given by the real route, starting `startsIn` days from today. */
  const give = async (gym: Gym, entryId: string, typeId: string, startsIn: number, paid: boolean): Promise<void> => {
    const res = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries/${entryId}/memberships`, gym.owner.cookies, {
      requestKey: randomUUID(),
      typeId,
      startsOn: day(startsIn),
      paid,
      ...(paid ? { method: "cash" } : {}),
    });
    expect(res.statusCode, res.body).toBe(201);
  };

  const weekUrl = (gym: Gym) => `/v1/orgs/${gym.id}/week`;
  const read = async (gym: Gym, who: Person = gym.owner): Promise<GymWeek> => {
    const res = await inject("GET", weekUrl(gym), who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return gymWeekResponseSchema.parse(JSON.parse(res.body)).week;
  };
  /** The Members list's own "Payment due" chip, as that page counts it. */
  const paymentDueChip = async (gym: Gym): Promise<number> => {
    const res = await inject("GET", `/v1/orgs/${gym.id}/member-list`, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    const { list } = JSON.parse(res.body) as { list: { paymentStatuses: { label: string; count: number }[] } };
    return list.paymentStatuses.filter((chip) => chip.label.toLowerCase() === "payment due").reduce((sum, chip) => sum + chip.count, 0);
  };
  /** The At risk page's own count. */
  const atRiskTotal = async (gym: Gym): Promise<number> => {
    const res = await inject("GET", `/v1/orgs/${gym.id}/at-risk`, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return atRiskResponseSchema.parse(JSON.parse(res.body)).total;
  };

  /** A gym with a known week: 2 new, 2 left, 1 at risk, 9 visits against 8, 2 payments due. */
  const busyGym = async (name: string): Promise<Gym> => {
    const gym = await makeGym(name);
    await deskOpen(gym, -60, 0);
    const typeId = await thirtyDays(gym);
    // New: listed 3 and 7 days ago. Not new: today, and 8 days ago.
    await record(gym, "Nina New", 3);
    await record(gym, "Noel New", 7);
    await record(gym, "Tia Today", 0);
    await record(gym, "Eli Eight", 8);
    // Left: taken off 2 days ago; and a membership that ran out inside the week. Not
    // left in the week: taken off 10 days ago, and today.
    await takeOff(await record(gym, "Gus Gone", 200), 2);
    const ran = await record(gym, "Rae Ran Out", 200);
    // Given, then dated back: its thirty days ran out inside the week.
    await give(gym, ran, typeId, -5, true);
    await sql`UPDATE gym_held_memberships SET starts_on = ${day(-34)}::date WHERE gym_id = ${gym.id} AND entry_id = ${ran}`;
    await takeOff(await record(gym, "Olga Older", 200), 10);
    await takeOff(await record(gym, "Tod Today", 200), 0);
    // At risk: three weeks running, last in 20 days ago.
    const stan = await record(gym, "Stan Stopped", 200);
    for (const n of [-20, -27, -34]) await visit(gym, stan, n);
    // Still coming: twice this week, once the week before. Today's visit is in neither.
    const cal = await record(gym, "Cal Coming", 200);
    for (const n of [0, -2, -3, -10, -17]) await visit(gym, cal, n);
    // Payment due: a membership given unpaid, and the gym's own word on somebody the app
    // does not answer for. Paid, and a word that is not that one, are not.
    await give(gym, await record(gym, "Una Unpaid", 200), typeId, -5, false);
    await record(gym, "Wes Word", 200, "PAYMENT DUE");
    await give(gym, await record(gym, "Pia Paid", 200), typeId, -5, true);
    await record(gym, "Opal Other", 200, "Paid");
    return gym;
  };
  const BUSY: Omit<GymWeek, "from" | "to"> = {
    members: { joined: 2, left: 2 },
    atRisk: { count: 1 },
    visits: { thisWeek: 9, weekBefore: 8 },
    paymentDue: { count: 2 },
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    today = (await sql<{ d: string }[]>`SELECT (${clock}::timestamptz AT TIME ZONE 'Asia/Kolkata')::date::text AS d`)[0]?.d ?? "";
    app = await buildApp(loadConfig(baseEnv), { redis, orgs: { now: () => clock } });
    await api().ready();
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, T);

  it(
    "THE WORST THING: each gym reads only its own figures, staff read only the parts whose page they may open, and nobody else reads any",
    async () => {
      const gym = await busyGym("Week Iron House");
      // Next door: a desk in use and one new member; nobody left, at risk or owing.
      const next = await makeGym("Week Next Door");
      await deskOpen(next, -60, 0);
      await record(next, "Ned Next", 4);

      const mine = await read(gym);
      expect(mine).toEqual({ from: day(-7), to: day(-1), ...BUSY });
      const theirs = await read(next);
      expect(theirs).toEqual({ from: day(-7), to: day(-1), members: { joined: 1, left: 0 }, atRisk: { count: 0 }, visits: { thisWeek: 7, weekBefore: 7 }, paymentDue: null });

      // Each figure is its own page's.
      expect(mine.atRisk?.count).toBe(await atRiskTotal(gym));
      expect(mine.paymentDue?.count).toBe(await paymentDueChip(gym));
      const counted = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_attendance WHERE gym_id = ${gym.id} AND day >= ${day(-7)}::date AND day <= ${day(-1)}::date`;
      expect(mine.visits?.thisWeek).toBe(counted[0]?.n);

      // A manager reads all of it. A trainer may open At risk and Attendance, and neither
      // Reports nor the Members list's payments.
      expect(await read(gym, await onStaff(gym, "Week Manager", "manager"))).toEqual(mine);
      const trainer = await read(gym, await onStaff(gym, "Week Trainer", "trainer"));
      expect(trainer).toEqual({ from: day(-7), to: day(-1), members: null, atRisk: BUSY.atRisk, visits: BUSY.visits, paymentDue: null });

      // Staff whose ticks were all taken away read no figure at all.
      const bare = await signedIn("Week Bare");
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${bare.userId}, 'trainer', ${sql.array([] as string[])})`;
      expect(await read(gym, bare)).toEqual({ from: day(-7), to: day(-1), members: null, atRisk: null, visits: null, paymentDue: null });

      // Nobody else: next door's owner, a member of this gym, a stranger, and nobody.
      const member = await signedIn("Week Member");
      await sql`INSERT INTO gym_members (gym_id, user_id, entry_id, joined_at) VALUES (${gym.id}, ${member.userId}, ${await record(gym, "Week Member", 200)}, now() - interval '150 days')`;
      for (const who of [next.owner, member, await signedIn("Week Stranger")]) {
        const res = await inject("GET", weekUrl(gym), who.cookies);
        expect(res.statusCode, res.body).toBe(404);
        expect(res.body).not.toMatch(/joined|thisWeek|paymentDue/);
      }
      expect((await inject("GET", weekUrl(gym), {})).statusCode).toBe(401);
      expect((await inject("GET", "/v1/orgs/not-a-gym/week", gym.owner.cookies)).statusCode).toBe(400);
      expect((await inject("GET", `/v1/orgs/${randomUUID()}/week`, gym.owner.cookies)).statusCode).toBe(404);
    },
    T,
  );

  it(
    "a part the gym does not use is left out, never a nought",
    async () => {
      // A gym made today: no list, no check-in, no bill.
      const fresh = await makeGym("Week Fresh");
      expect(await read(fresh)).toEqual({ from: day(-7), to: day(-1), members: null, atRisk: null, visits: null, paymentDue: null });

      // Its list began inside the week: it has no whole week yet. Its
      // check-in began ten days ago: the week before cannot be compared, and nobody can
      // have come and stopped yet.
      const young = await makeGym("Week Young");
      await record(young, "First One", 3);
      await record(young, "First Two", 2);
      await deskOpen(young, -10, 0, 3);
      const week = await read(young);
      expect(week.members).toBeNull();
      // Five days on, the list began eight days ago: its first people are not new, and the
      // one added a day after them is.
      await sql`UPDATE gym_member_list_entries SET created_at = created_at - interval '5 days' WHERE gym_id = ${young.id}`;
      expect((await read(young)).members).toEqual({ joined: 1, left: 0 });
      expect(week.visits).toEqual({ thisWeek: 7, weekBefore: null });
      expect(week.atRisk).toBeNull();
      expect(week.paymentDue).toBeNull();

      // Check-in that began today has no week yet.
      const began = await makeGym("Week Began Today");
      await deskOpen(began, 0, 0);
      expect((await read(began)).visits).toBeNull();

      // A gym that has billed somebody and is owed nothing reads a true nought.
      const settled = await makeGym("Week Settled");
      await give(settled, await record(settled, "Pat Paid", 200), await thirtyDays(settled), -5, true);
      expect((await read(settled)).paymentDue).toEqual({ count: 0 });
      expect(await paymentDueChip(settled)).toBe(0);
    },
    T,
  );

  it(
    "the limit counts the asker, and a gym's address a gym at a time; a refused ask uses up nobody's",
    async () => {
      const gym = await makeGym("Week Limit");
      const next = await makeGym("Week Limit Next Door");
      const desk = "10.94.200.1";
      const ipKey = (g: Gym): string => `rl:orgs_week:ip:${g.id}:${desk}`;
      // Somebody refused leaves the gym's address alone.
      expect((await inject("GET", weekUrl(gym), (await signedIn("Week Limit Stranger")).cookies, undefined, desk)).statusCode).toBe(404);
      expect(await redis.get(ipKey(gym))).toBeNull();
      expect((await inject("GET", weekUrl(gym), gym.owner.cookies, undefined, desk)).statusCode).toBe(200);
      expect(await redis.get(ipKey(gym))).not.toBeNull();
      // The address used up at one gym still reads next door's.
      for (let i = 0; i < 2400; i += 1) await redis.incrWithTtl(ipKey(gym), 3600);
      expect((await inject("GET", weekUrl(gym), gym.owner.cookies, undefined, desk)).statusCode).toBe(429);
      expect((await inject("GET", weekUrl(next), next.owner.cookies, undefined, desk)).statusCode).toBe(200);
    },
    T,
  );
});
