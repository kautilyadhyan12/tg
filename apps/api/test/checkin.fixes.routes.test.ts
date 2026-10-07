// CHECK-IN, the two extra passes' fixes — against real Postgres (spec Part 3 §12).
// DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: a visit written for the wrong
// person, or one person counted as two. Those are the first tests below.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql, type TransactionSql } from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import { checkinPassKey } from "../src/modules/orgs/checkin/routes.js";
import * as checkin from "../src/modules/orgs/checkin/service.js";
import type { DeskDevice } from "../src/modules/orgs/checkin/repo.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "chkx-test-secret-0123456789abcdefgh", // dummy test value, gitleaks:allow
  LOG_LEVEL: "fatal",
  CHECKIN_PASS_SECRET: "chkx-test-pass-secret-0123456789abcdef", // dummy test value, gitleaks:allow
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const TEST_TIMEOUT_MS = 90_000;
const HOOK_TIMEOUT_MS = 60_000;
const LIVE_PLAN = "zz_chkx_live";

let ipCounter = 0;
const nextIp = () => `10.18.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

interface ScanAnswer {
  result: string;
  gymName: string;
  person?: { name: string };
  notice?: { status: string | null; payment: string | null; onList: boolean };
}
interface LogVisit {
  name: string;
  method: string;
  by: string | null;
  status: string | null;
  payment: string | null;
}

d("check-in, the two extra passes' fixes (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  // Read here, not at the top: without a database the suite is skipped and never asks.
  let config: ReturnType<typeof loadConfig>;
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'chkx-t-%@example.com')`;
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'chkx-t-%@example.com'`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_attendance WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_attendance WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM gym_checkin_devices WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM org_daily_stats WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM streaks WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM user_achievements WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM user_xp WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'chkx-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST", path: string, cookies: Cookies, payload?: unknown, ip = nextIp()) =>
    api().inject({
      method,
      url: path,
      remoteAddress: ip,
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const get = (path: string, cookies: Cookies = {}) => inject("GET", path, cookies);
  const post = (path: string, payload: unknown, cookies: Cookies = {}) => inject("POST", path, cookies, payload);

  interface Person {
    userId: string;
    email: string;
    cookies: Cookies;
  }
  interface Desk {
    deviceId: string;
    cookies: Cookies;
  }

  const makeUser = async (local: string, displayName: string, prove = true): Promise<Person> => {
    const email = `chkx-t-${local}-${uniq()}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    if (prove) await proveAddress(sql, email);
    return { userId, email, cookies: cookieMap(login) };
  };

  const makeGym = async (owner: Person, name: string): Promise<string> => {
    const res = await post("/v1/orgs", { trainsHere: false, name, city: "Leeds", country: "GB", timezone: "Europe/London" }, owner.cookies);
    expect(res.statusCode).toBe(201);
    const gymId = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return gymId;
  };

  const addRecord = async (
    gymId: string,
    values: { fullName: string; email?: string; memberNumber?: string; status?: string; payment?: string },
  ): Promise<string> => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO gym_member_list_entries
        (gym_id, full_name, email, phone_e164, member_number, status, payment_status, identity_key, source)
      VALUES (${gymId}, ${values.fullName}, ${values.email ?? null},
              ${values.email === undefined ? `+4477009${String(10000 + (seq++ % 89999))}` : null}, ${values.memberNumber ?? null},
              ${values.status ?? null}, ${values.payment ?? null}, encode(sha256(${`chkx-${uniq()}`}::bytea), 'hex'), 'typed')
      RETURNING id`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("no record");
    return id;
  };

  const join = async (gymId: string, person: Person, entryId: string | null = null): Promise<void> => {
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id) VALUES (${gymId}, ${person.userId}, ${entryId})`;
  };

  const addDevice = (gymId: string, who: Person, name: string) => post(`/v1/orgs/${gymId}/checkin-devices`, { name }, who.cookies);

  const makeDesk = async (gymId: string, who: Person, name = "Front desk", ip = nextIp()): Promise<Desk> => {
    const added = await addDevice(gymId, who, name);
    expect(added.statusCode).toBe(201);
    const body = JSON.parse(added.body) as { device: { id: string }; link: string };
    const claimed = await inject("POST", "/v1/checkin/device/claim", {}, { token: body.link.split("#")[1] ?? "" }, ip);
    expect(claimed.statusCode).toBe(200);
    return { deviceId: body.device.id, cookies: cookieMap(claimed) };
  };

  const passOf = async (person: Person): Promise<string> => {
    const res = await get("/v1/users/me/checkin-pass", person.cookies);
    expect(res.statusCode).toBe(200);
    return (JSON.parse(res.body) as { pass: string }).pass;
  };

  const scanAt = (desk: Desk, code: string, ip = nextIp()) => inject("POST", "/v1/checkin/scan", desk.cookies, { code }, ip);
  const scan = async (desk: Desk, code: string): Promise<ScanAnswer> => {
    const res = await scanAt(desk, code);
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body) as ScanAnswer;
  };

  const visits = (gymId: string) =>
    sql<{ user_id: string | null; entry_id: string | null; method: string; slot_key: string }[]>`
      SELECT user_id, entry_id, method, slot_key FROM gym_attendance WHERE gym_id = ${gymId} ORDER BY marked_at, id`;
  const streakOf = async (person: Person): Promise<number | null> =>
    (await sql<{ current: number }[]>`SELECT current FROM streaks WHERE user_id = ${person.userId}`)[0]?.current ?? null;
  const logOf = async (gymId: string, who: Person): Promise<LogVisit[]> => {
    const res = await get(`/v1/orgs/${gymId}/attendance/log`, who.cookies);
    expect(res.statusCode).toBe(200);
    return (JSON.parse(res.body) as { log: { visits: LogVisit[] } }).log.visits;
  };
  /** A visit earlier today, in another opening period, as a desk's key tag wrote it. */
  const earlierVisit = async (gymId: string, desk: Desk, entryId: string, dayOffset = 0, userId: string | null = null) => {
    await sql`
      INSERT INTO gym_attendance
        (gym_id, user_id, entry_id, device_id, day, method, hours_status, session_opens_minute, session_closes_minute, slot_key, marked_at)
      VALUES (${gymId}, ${userId}, ${entryId}, ${desk.deviceId}, (now() AT TIME ZONE 'Europe/London')::date + ${dayOffset}::int,
              'key_tag', 'in_session', 60, 120, '60-120', now() - interval '1 minute' + make_interval(days => ${dayOffset}::int))`;
  };

  let owner: Person;
  let gym: string;
  let desk: Desk;

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    config = loadConfig(baseEnv);
    app = await buildApp(config, { redis });
    await api().ready();
    owner = await makeUser("owner", "Fix Owner");
    gym = await makeGym(owner, "Fix Gym");
    desk = await makeDesk(gym, owner);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, HOOK_TIMEOUT_MS);

  // ===========================================================================
  // THE WORST THING, FIRST: one person is one person, and never somebody else
  // ===========================================================================

  it("a person on the list with the app is ONE visit and keeps their streak, card first or pass first", async () => {
    // On the gym's list, has the app with that address proved, never joined the gym in it.
    const cardFirst = await makeUser("cardfirst", "Cara First");
    const cardRecord = await addRecord(gym, { fullName: "Cara First", email: cardFirst.email, memberNumber: "8101" });
    expect((await scan(desk, "8101")).result).toBe("checked_in");
    // The card alone names her account, and keeps her streak, before any pass is shown.
    expect(await sql`SELECT user_id FROM gym_attendance WHERE gym_id = ${gym} AND entry_id = ${cardRecord}`).toEqual([
      { user_id: cardFirst.userId },
    ]);
    expect(await streakOf(cardFirst)).toBe(1);
    expect((await scan(desk, await passOf(cardFirst))).result).toBe("already");

    const passFirst = await makeUser("passfirst", "Pat First");
    const passRecord = await addRecord(gym, { fullName: "Pat First", email: passFirst.email, memberNumber: "8102" });
    expect((await scan(desk, await passOf(passFirst))).result).toBe("checked_in");
    expect((await scan(desk, "8102")).result).toBe("already");

    const rows = await sql<{ user_id: string | null; entry_id: string | null }[]>`
      SELECT user_id, entry_id FROM gym_attendance WHERE gym_id = ${gym} AND entry_id IN (${cardRecord}, ${passRecord}) ORDER BY marked_at`;
    expect(rows).toEqual([
      { user_id: cardFirst.userId, entry_id: cardRecord },
      { user_id: passFirst.userId, entry_id: passRecord },
    ]);
    expect(await streakOf(cardFirst)).toBe(1);
    expect(await streakOf(passFirst)).toBe(1);
  }, TEST_TIMEOUT_MS);

  it("a card never gives its visit to somebody else's account: an address not proved, or a relative on a shared address", async () => {
    // Somebody registered the address on the gym's list and never proved it.
    const squatter = await makeUser("squatter", "Sam Squatter", false);
    const victim = await addRecord(gym, { fullName: "Vera Victim", email: squatter.email, memberNumber: "8201" });
    expect((await scan(desk, "8201")).result).toBe("checked_in");

    // A family on one address: the account is Mia's, the card is Leo's.
    const mia = await makeUser("mia", "Mia Park");
    await addRecord(gym, { fullName: "Mia Park", email: mia.email, memberNumber: "8202" });
    const leo = await addRecord(gym, { fullName: "Leo Park", email: mia.email, memberNumber: "8203" });
    expect((await scan(desk, "8203")).person).toEqual({ name: "Leo Park" });

    const rows = await sql<{ user_id: string | null; entry_id: string | null }[]>`
      SELECT user_id, entry_id FROM gym_attendance WHERE gym_id = ${gym} AND entry_id IN (${victim}, ${leo}) ORDER BY marked_at`;
    expect(rows).toEqual([
      { user_id: null, entry_id: victim },
      { user_id: null, entry_id: leo },
    ]);
    expect(await streakOf(squatter)).toBeNull();
    expect(await streakOf(mia)).toBeNull();
  }, TEST_TIMEOUT_MS);

  it("a visit made before the person had the app is joined to them by their next one: one person on the day list, in the totals and on Overview", async () => {
    const own = await makeUser("day", "Day Owner");
    const g = await makeGym(own, "Day Gym");
    const dayDesk = await makeDesk(g, own);
    const nina = await makeUser("nina", "Nina Later");
    const record = await addRecord(g, { fullName: "Nina Later", email: nina.email, memberNumber: "8301" });
    await earlierVisit(g, dayDesk, record);

    expect((await scan(dayDesk, await passOf(nina))).result).toBe("checked_in");
    expect(await visits(g)).toEqual([
      { user_id: nina.userId, entry_id: record, method: "key_tag", slot_key: "60-120" },
      { user_id: nina.userId, entry_id: record, method: "pass", slot_key: "hours_unset" },
    ]);
    expect(await streakOf(nina)).toBe(1);

    const day = JSON.parse((await get(`/v1/orgs/${g}/attendance`, own.cookies)).body) as {
      attendance: { totals: { visits: number; people: number }; people: { displayName: string; visits: unknown[] }[] };
    };
    expect(day.attendance.totals).toEqual({ visits: 2, people: 1 });
    expect(day.attendance.people.map((p) => [p.displayName, p.visits.length])).toEqual([["Nina Later", 2]]);
    const overview = JSON.parse((await get(`/v1/orgs/${g}/overview`, own.cookies)).body) as {
      overview: { tiles: { today: { visits: number; visitors: number } } };
    };
    expect(overview.overview.tiles.today).toEqual({ visits: 2, visitors: 1 });
  }, TEST_TIMEOUT_MS);

  it("last week's card and last week's pass are one visitor, not two", async () => {
    const own = await makeUser("week", "Week Owner");
    const g = await makeGym(own, "Week Gym");
    const weekDesk = await makeDesk(g, own);
    const omar = await makeUser("omar", "Omar Week");
    const record = await addRecord(g, { fullName: "Omar Week", email: omar.email });
    // Monday of last week by card, before he had the app; Tuesday with the app.
    const monday = (await sql<{ days: number }[]>`
      SELECT (date_trunc('week', (now() AT TIME ZONE 'Europe/London')::date)::date - 7
              - (now() AT TIME ZONE 'Europe/London')::date)::int AS days`)[0]?.days ?? 0;
    await earlierVisit(g, weekDesk, record, monday);
    await earlierVisit(g, weekDesk, record, monday + 1, omar.userId);
    const overview = JSON.parse((await get(`/v1/orgs/${g}/overview`, own.cookies)).body) as {
      overview: { tiles: { week: { prevVisits: number; prevVisitors: number } } };
    };
    expect(overview.overview.tiles.week).toMatchObject({ prevVisits: 2, prevVisitors: 1 });
  }, TEST_TIMEOUT_MS);

  // ===========================================================================
  // The desk keeps working
  // ===========================================================================

  it("requests with no key, or a made-up one, from the gym's own address never stop its desk; the address is still held to its ceiling", async () => {
    const own = await makeUser("flood", "Flood Owner");
    const g = await makeGym(own, "Flood Gym");
    const address = "10.99.1.1";
    const floodDesk = await makeDesk(g, own, "Front desk", address);
    await addRecord(g, { fullName: "Real Member", memberNumber: "8401" });

    // In turns of 50, so the app-wide limit lets its 600 through to the route before it refuses.
    const noKey: Awaited<ReturnType<typeof inject>>[] = [];
    for (let turn = 0; turn < 13; turn++) {
      noKey.push(...(await Promise.all(Array.from({ length: 50 }, () => inject("POST", "/v1/checkin/scan", {}, { code: "1" }, address)))));
    }
    expect(noKey.filter((r) => r.statusCode === 401).length).toBeGreaterThan(400);
    expect(noKey.filter((r) => r.statusCode === 429).length).toBeGreaterThan(0);
    expect(noKey.every((r) => r.statusCode === 401 || r.statusCode === 429)).toBe(true);
    const madeUp = { checkinDevice: "A".repeat(43) };
    const unknown = await Promise.all(Array.from({ length: 50 }, () => inject("POST", "/v1/checkin/scan", madeUp, { code: "1" }, address)));
    expect(unknown.every((r) => r.statusCode === 401 || r.statusCode === 429)).toBe(true);

    const real = await scanAt(floodDesk, "8401", address);
    expect(real.statusCode).toBe(200);
    expect((JSON.parse(real.body) as ScanAnswer).result).toBe("checked_in");

    // A desk switched off keeps the server's mark on its cookie, and no allowance of its
    // own: it is counted by the address, which is used up.
    expect((await post(`/v1/orgs/${g}/checkin-devices/${floodDesk.deviceId}/off`, {}, own.cookies)).statusCode).toBe(200);
    const dead = (await Promise.all(Array.from({ length: 100 }, () => scanAt(floodDesk, "8401", address)))).map((r) => r.statusCode);
    expect(dead.every((status) => status === 401 || status === 429)).toBe(true);
    expect(dead.filter((status) => status === 429).length).toBeGreaterThan(0);
    expect((await scanAt(floodDesk, "8401")).statusCode).toBe(401);
  }, TEST_TIMEOUT_MS);

  it("made-up set-up links from an address never stop a real link opened there", async () => {
    const own = await makeUser("claim", "Claim Owner");
    const g = await makeGym(own, "Claim Gym");
    const address = "10.99.2.1";
    for (let i = 0; i < 31; i++) {
      const res = await inject("POST", "/v1/checkin/device/claim", {}, { token: `${"B".repeat(41)}${String(10 + i)}` }, address);
      expect([404, 429]).toContain(res.statusCode);
    }
    const added = await addDevice(g, own, "Front desk");
    const token = (JSON.parse(added.body) as { link: string }).link.split("#")[1] ?? "";
    expect((await inject("POST", "/v1/checkin/device/claim", {}, { token }, address)).statusCode).toBe(200);
    // The made-up ones are still refused.
    expect((await inject("POST", "/v1/checkin/device/claim", {}, { token: "C".repeat(43) }, address)).statusCode).toBe(429);
  }, TEST_TIMEOUT_MS);

  it("a zero byte in a scan, a search or a device's name is refused, not a server error", async () => {
    expect((await scanAt(desk, "9002\u0000")).statusCode).toBe(400);
    expect((await get(`/v1/orgs/${gym}/attendance/people?query=a%00`, owner.cookies)).statusCode).toBe(400);
    expect((await addDevice(gym, owner, "x\u0000y")).statusCode).toBe(400);
  }, TEST_TIMEOUT_MS);

  // ===========================================================================
  // Staff's search and live list
  // ===========================================================================

  it("staff who do not keep the list cannot find a member by an email their row hides", async () => {
    const asha = await makeUser("asha", "Asha Baruah");
    await join(gym, asha, await addRecord(gym, { fullName: "Asha Baruah", email: asha.email }));
    const trainer = await makeUser("trainer", "Tara Trainer");
    await sql`
      INSERT INTO gym_staff (gym_id, user_id, role, privileges)
      VALUES (${gym}, ${trainer.userId}, 'trainer', ${["members.read", "attendance.read", "attendance.mark"]})`;
    const find = async (who: Person, query: string) =>
      (JSON.parse((await get(`/v1/orgs/${gym}/attendance/people?query=${encodeURIComponent(query)}`, who.cookies)).body) as {
        people: { name: string; email: string | null }[];
      }).people;
    const local = asha.email.split("@")[0] ?? "";
    expect(await find(trainer, local)).toEqual([]);
    expect((await find(trainer, "Asha")).map((p) => [p.name, p.email])).toEqual([["Asha Baruah", null]]);
    expect((await find(owner, local)).map((p) => [p.name, p.email])).toEqual([["Asha Baruah", asha.email]]);
  }, TEST_TIMEOUT_MS);

  it("a desk's scan shows in staff's list by itself, with the desk's name; the gym's status and payment words go only to staff who can check people in", async () => {
    const own = await makeUser("log", "Log Owner");
    const g = await makeGym(own, "Log Gym");
    const logDesk = await makeDesk(g, own, "Front desk");
    const priya = await makeUser("priya", "Priya Nair");
    await join(g, priya, await addRecord(g, { fullName: "Priya Nair", email: priya.email, status: "Active", payment: "Overdue" }));
    await addRecord(g, { fullName: "Maya Patel", memberNumber: "8501", status: "Expired", payment: "Unpaid" });
    expect(await logOf(g, own)).toEqual([]);

    expect((await scan(logDesk, await passOf(priya))).result).toBe("checked_in");
    expect((await scan(logDesk, "8501")).result).toBe("checked_in");
    expect((await logOf(g, own)).map((v) => [v.name, v.method, v.by, v.status, v.payment])).toEqual([
      ["Maya Patel", "key_tag", "Front desk", "Expired", "Unpaid"],
      ["Priya Nair", "pass", "Front desk", "Active", "Overdue"],
    ]);

    // A trainer who can read attendance but not check people in: names, never the words.
    const reader = await makeUser("reader", "Rae Reader");
    await sql`
      INSERT INTO gym_staff (gym_id, user_id, role, privileges)
      VALUES (${g}, ${reader.userId}, 'trainer', ${["members.read", "attendance.read"]})`;
    expect((await logOf(g, reader)).map((v) => [v.name, v.status, v.payment])).toEqual([
      ["Maya Patel", null, null],
      ["Priya Nair", null, null],
    ]);
  }, TEST_TIMEOUT_MS);

  // ===========================================================================
  // Twice, at once, and half-finished
  // ===========================================================================

  it("a visit saved without its streak day gets it on the next scan", async () => {
    const zoe = await makeUser("zoe", "Zoe Streak");
    const record = await addRecord(gym, { fullName: "Zoe Streak", email: zoe.email, memberNumber: "8601" });
    await join(gym, zoe, record);
    // The visit as a crash between the write and the streak left it.
    await sql`
      INSERT INTO gym_attendance (gym_id, user_id, entry_id, device_id, day, method, hours_status, slot_key)
      VALUES (${gym}, ${zoe.userId}, ${record}, ${desk.deviceId}, (now() AT TIME ZONE 'Europe/London')::date, 'key_tag', 'hours_unset', 'hours_unset')`;
    expect(await streakOf(zoe)).toBeNull();
    expect((await scan(desk, "8601")).result).toBe("already");
    expect(await streakOf(zoe)).toBe(1);
  }, TEST_TIMEOUT_MS);

  it("forty unknown card numbers sent together are ten looked up and a pause, and the count starts clean after it", async () => {
    const own = await makeUser("tags", "Tags Owner");
    const g = await makeGym(own, "Tags Gym");
    const tagDesk = await makeDesk(g, own);
    const answers = await Promise.all(Array.from({ length: 40 }, (_, i) => scanAt(tagDesk, `99${String(1000 + i)}`)));
    expect(answers.filter((r) => r.statusCode === 200)).toHaveLength(10);
    expect(answers.filter((r) => r.statusCode === 429)).toHaveLength(30);
    const paused = await scanAt(tagDesk, "990001");
    expect(paused.statusCode).toBe(429);
    expect((JSON.parse(paused.body) as { error: string }).error).toBe("key_tags_paused");
    expect(await redis.get(`checkin:tag_misses:${tagDesk.deviceId}`)).toBeNull();
    expect(await redis.get(`checkin:tag_reads:${tagDesk.deviceId}`)).toBeNull();
  }, TEST_TIMEOUT_MS);

  it("real cards never count towards the pause", async () => {
    const own = await makeUser("hits", "Hits Owner");
    const g = await makeGym(own, "Hits Gym");
    const hitDesk = await makeDesk(g, own);
    for (let i = 0; i < 9; i++) expect((await scan(hitDesk, `98${String(1000 + i)}`)).result).toBe("not_a_member");
    for (let i = 0; i < 8; i++) {
      await addRecord(g, { fullName: `Member ${String(i)}`, memberNumber: `87${String(10 + i)}` });
      expect((await scan(hitDesk, `87${String(10 + i)}`)).result).toBe("checked_in");
    }
    expect(await redis.get(`checkin:tag_pause:${hitDesk.deviceId}`)).toBeNull();
    expect(await redis.get(`checkin:tag_misses:${hitDesk.deviceId}`)).toBe("9");
  }, TEST_TIMEOUT_MS);

  it("two devices of one name cannot be added together; a switched-off device's name is free, and it cannot come back on under a name now taken", async () => {
    const own = await makeUser("names", "Names Owner");
    const g = await makeGym(own, "Names Gym");
    const both = await Promise.all([addDevice(g, own, "Front Desk"), addDevice(g, own, "front desk")]);
    expect(both.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    const refused = both.find((r) => r.statusCode === 409);
    expect((JSON.parse(refused?.body ?? "{}") as { error: string }).error).toBe("device_name_taken");

    const first = (JSON.parse(both.find((r) => r.statusCode === 201)?.body ?? "{}") as { device: { id: string } }).device.id;
    expect((await post(`/v1/orgs/${g}/checkin-devices/${first}/off`, {}, own.cookies)).statusCode).toBe(200);
    expect((await addDevice(g, own, "Front desk")).statusCode).toBe(201);
    const back = await post(`/v1/orgs/${g}/checkin-devices/${first}/link`, {}, own.cookies);
    expect(back.statusCode).toBe(409);
    expect(JSON.parse(back.body) as { error: string; message: string }).toMatchObject({
      error: "device_name_taken",
      message: "Another device now has this name. Switch that one off, or add this tablet as a new device.",
    });
  }, TEST_TIMEOUT_MS);

  it("New link pressed twice at once makes one link, and that one works", async () => {
    const own = await makeUser("link", "Link Owner");
    const g = await makeGym(own, "Link Gym");
    const made = await makeDesk(g, own, "Front desk");
    const path = `/v1/orgs/${g}/checkin-devices/${made.deviceId}/link`;
    const both = await Promise.all([post(path, {}, own.cookies), post(path, {}, own.cookies)]);
    expect(both.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect((JSON.parse(both.find((r) => r.statusCode === 409)?.body ?? "{}") as { error: string }).error).toBe("link_just_made");
    const link = (JSON.parse(both.find((r) => r.statusCode === 200)?.body ?? "{}") as { link: string }).link;
    expect((await post("/v1/checkin/device/claim", { token: link.split("#")[1] ?? "" })).statusCode).toBe(200);
    // Once that link is opened, a new one can be made straight away.
    expect((await post(path, {}, own.cookies)).statusCode).toBe(200);
  }, TEST_TIMEOUT_MS);

  it("a card read while its record is being joined into another answers, never a server error", async () => {
    const own = await makeUser("merge", "Merge Owner");
    const g = await makeGym(own, "Merge Gym");
    const mergeDesk = await makeDesk(g, own);
    const gone = await addRecord(g, { fullName: "Dana Double", memberNumber: "8701" });
    const hold = postgres(url ?? "", { prepare: false, max: 1 });
    try {
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let locked: () => void = () => undefined;
      const isLocked = new Promise<void>((resolve) => {
        locked = resolve;
      });
      // The join's own hold on the record, then its delete.
      const merging = hold.begin(async (tx) => {
        await tx`SELECT 1 FROM gym_member_list_entries WHERE gym_id = ${g} AND id = ${gone} FOR UPDATE`;
        locked();
        await released;
        await tx`DELETE FROM gym_member_list_entries WHERE gym_id = ${g} AND id = ${gone}`;
      });
      await isLocked;
      const reading = scanAt(mergeDesk, "8701");
      await new Promise((resolve) => setTimeout(resolve, 400));
      release();
      await merging;
      const res = await reading;
      expect(res.statusCode).toBe(200);
      expect((JSON.parse(res.body) as ScanAnswer).result).toBe("not_a_member");
      expect(await visits(g)).toEqual([]);
    } finally {
      await hold.end({ timeout: 5 });
    }
  }, TEST_TIMEOUT_MS);

  // ===========================================================================
  // A pass is used up only by a visit
  // ===========================================================================

  describe("the scan with a database that fails", () => {
    /** The app's own connection, with the visit's INSERT failing while `failing()` says so. */
    const failingSql = (failing: () => string | null): Sql => {
      const wrap = <T extends Sql | TransactionSql>(target: T): T =>
        new Proxy(target, {
          apply(fn, self, args: unknown[]) {
            const strings = args[0];
            const code = Array.isArray(strings) && strings.join("").includes("INSERT INTO gym_attendance") ? failing() : null;
            if (code !== null) return Promise.reject(Object.assign(new Error("the visit could not be saved"), { code }));
            return Reflect.apply(fn as (...a: unknown[]) => unknown, self, args);
          },
          get(fn, prop, receiver) {
            if (prop === "begin") {
              // Both of postgres's forms: begin(body), and begin(options, body) for a read-only snapshot.
              type Body = (tx: TransactionSql) => Promise<unknown>;
              return (...given: [Body] | [string, Body]) => {
                const [first, second] = given;
                if (typeof first !== "string") return (fn as Sql).begin((tx) => first(wrap(tx)));
                if (second === undefined) throw new Error("begin was given no body");
                return (fn as Sql).begin(first, (tx) => second(wrap(tx)));
              };
            }
            return Reflect.get(fn, prop, receiver) as unknown;
          },
        });
      return wrap(sql);
    };
    const deps = (using: Sql): checkin.CheckinDeps => ({
      sql: using,
      redis,
      now: () => new Date(),
      passKey: checkinPassKey(config),
      webOrigin: config.WEB_ORIGIN,
      log: { warn: () => undefined },
    });
    const deskDevice = async (gymId: string, made: Desk): Promise<DeskDevice> => ({
      deviceId: made.deviceId,
      gymId,
      gymName: (await sql<{ name: string }[]>`SELECT name FROM gyms WHERE id = ${gymId}`)[0]?.name ?? "",
      timezone: "Europe/London",
      clockFormat: "24h",
    });

    it("a pass whose visit could not be saved is not used up: the same pass checks the person in", async () => {
      const ravi = await makeUser("ravi", "Ravi Retry");
      await join(gym, ravi, await addRecord(gym, { fullName: "Ravi Retry", email: ravi.email }));
      const pass = await passOf(ravi);
      const device = await deskDevice(gym, desk);
      await expect(checkin.scan(deps(failingSql(() => "XX000")), device, pass)).rejects.toThrow("the visit could not be saved");
      expect((await scan(desk, pass)).result).toBe("checked_in");
    }, TEST_TIMEOUT_MS);

    it("a visit that lost a race with a join of two records is written on the second try", async () => {
      const device = await deskDevice(gym, desk);
      for (const code of ["40P01", "23503"]) {
        const lena = await makeUser(`lena${code}`, "Lena Again");
        await join(gym, lena, await addRecord(gym, { fullName: "Lena Again", email: lena.email }));
        let failed = false;
        const once = (): string | null => {
          if (failed) return null;
          failed = true;
          return code;
        };
        const answer = await checkin.scan(deps(failingSql(once)), device, await passOf(lena));
        expect(answer.result).toBe("checked_in");
        expect(await streakOf(lena)).toBe(1);
      }
    }, TEST_TIMEOUT_MS);

    it("a pass shown at a desk where the person is not a member is not used up by it", async () => {
      const own = await makeUser("other", "Other Owner");
      const other = await makeGym(own, "Other Gym");
      const otherDesk = await makeDesk(other, own);
      const tess = await makeUser("tess", "Tess Two");
      await join(gym, tess, await addRecord(gym, { fullName: "Tess Two", email: tess.email }));
      const pass = await passOf(tess);
      expect((await scan(otherDesk, pass)).result).toBe("not_a_member");
      expect((await scan(desk, pass)).result).toBe("checked_in");
      // Used now: her screenshot in a friend's hand is grey.
      expect((await scan(desk, pass)).result).toBe("fresh_pass_needed");
    }, TEST_TIMEOUT_MS);
  });
});
