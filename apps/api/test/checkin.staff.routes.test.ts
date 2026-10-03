// STAFF CHECK-IN AND THE LIVE LOG — the routes against real Postgres (spec Part 3 §12.5;
// ROADMAP 16b-ii). DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: staff at one gym checking in, or
// reading the name of, somebody at another gym — or a former member, or the wrong person,
// shown as checked in. Those are the first tests below.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
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
  JWT_SECRET: "chks-test-secret-0123456789abcdefgh", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  CHECKIN_PASS_SECRET: "chks-test-pass-secret-0123456789abcdef", // dummy test value, gitleaks:allow
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const TEST_TIMEOUT_MS = 60_000;
const HOOK_TIMEOUT_MS = 60_000;
const LIVE_PLAN = "zz_chks_live";

let ipCounter = 0;
const nextIp = () => `10.17.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

interface Found {
  pick: { entryId?: string; userId?: string };
  name: string;
  memberNumber: string | null;
  email: string | null;
  notice: { status: string | null; payment: string | null; onList: boolean };
}
interface LogVisit {
  id: string;
  markedAt: string;
  name: string;
  method: string;
  by: string | null;
}

d("staff check-in and the live log (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'chks-t-%@example.com')`;
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'chks-t-%@example.com'`;
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
    await sql`DELETE FROM users WHERE email LIKE 'chks-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST", path: string, cookies: Cookies, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
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

  const makeUser = async (local: string, displayName: string): Promise<Person> => {
    const email = `chks-t-${local}-${uniq()}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    await proveAddress(sql, email);
    return { userId, email, cookies: cookieMap(login) };
  };

  const makeGym = async (owner: Person, name: string, live = true): Promise<string> => {
    const res = await post("/v1/orgs", { trainsHere: true, name, city: "Jorhat", country: "IN", timezone: "Asia/Kolkata" }, owner.cookies);
    expect(res.statusCode).toBe(201);
    const gymId = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    if (live) {
      await sql`
        INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
        VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    }
    return gymId;
  };

  const addStaff = async (gymId: string, person: Person, role: "manager" | "trainer", privileges: string[] | null) => {
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gymId}, ${person.userId}, ${role}, ${privileges})`;
  };

  const addRecord = async (
    gymId: string,
    values: { fullName: string; email?: string; memberNumber?: string; status?: string; payment?: string; former?: boolean },
  ): Promise<string> => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO gym_member_list_entries
        (gym_id, full_name, email, phone_e164, member_number, status, payment_status, identity_key, source, former_at)
      VALUES (${gymId}, ${values.fullName}, ${values.email ?? null},
              ${values.email === undefined ? `+9198${String(70000000 + (seq++ % 9999999))}` : null}, ${values.memberNumber ?? null},
              ${values.status ?? null}, ${values.payment ?? null}, encode(sha256(${`chks-${uniq()}`}::bytea), 'hex'), 'typed',
              ${values.former === true ? sql`now()` : null})
      RETURNING id`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("no record");
    return id;
  };

  const join = async (gymId: string, person: Person, entryId: string | null = null): Promise<void> => {
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id) VALUES (${gymId}, ${person.userId}, ${entryId})`;
  };

  const search = (gymId: string, query: string, who: Person) =>
    get(`/v1/orgs/${gymId}/attendance/people?query=${encodeURIComponent(query)}`, who.cookies);
  const found = async (gymId: string, query: string, who: Person): Promise<Found[]> => {
    const res = await search(gymId, query, who);
    expect(res.statusCode).toBe(200);
    return (JSON.parse(res.body) as { people: Found[] }).people;
  };
  const checkIn = (gymId: string, pick: unknown, who: Person) => post(`/v1/orgs/${gymId}/attendance/check-in`, pick, who.cookies);
  const logOf = async (gymId: string, who: Person, since?: string): Promise<LogVisit[]> => {
    const res = await get(`/v1/orgs/${gymId}/attendance/log${since === undefined ? "" : `?since=${encodeURIComponent(since)}`}`, who.cookies);
    expect(res.statusCode).toBe(200);
    return (JSON.parse(res.body) as { log: { visits: LogVisit[] } }).log.visits;
  };
  const visits = (gymId: string) =>
    sql<{ user_id: string | null; entry_id: string | null; device_id: string | null; marked_by_user_id: string | null; method: string }[]>`
      SELECT user_id, entry_id, device_id, marked_by_user_id, method FROM gym_attendance WHERE gym_id = ${gymId} ORDER BY marked_at`;

  let owner: Person;
  let ironHouse: string;
  let rival: Person;
  let studio9: string;

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), { redis });
    await api().ready();
    owner = await makeUser("owner", "Iron Owner");
    ironHouse = await makeGym(owner, "Iron House");
    rival = await makeUser("rival", "Studio Owner");
    studio9 = await makeGym(rival, "Studio 9");
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, HOOK_TIMEOUT_MS);

  // ===========================================================================
  // THE WORST THING, FIRST
  // ===========================================================================

  it(
    "staff at one gym can neither find, check in, nor read the log of somebody at another gym",
    async () => {
      const meera = await makeUser("meera", "Meera Iyer");
      const meeraRecord = await addRecord(ironHouse, { fullName: "Meera Iyer", email: meera.email, memberNumber: "7001" });
      await join(ironHouse, meera, meeraRecord);
      const raghu = await addRecord(ironHouse, { fullName: "Raghu Nair", memberNumber: "7002" });
      // Iron House's own staff see them.
      expect((await found(ironHouse, "Meera", owner)).map((p) => p.name)).toEqual(["Meera Iyer"]);
      expect((await checkIn(ironHouse, { entryId: raghu }, owner)).statusCode).toBe(200);

      // Studio 9's owner, at Iron House's address: nothing, and nothing about why.
      for (const res of [
        await search(ironHouse, "Meera", rival),
        await checkIn(ironHouse, { entryId: meeraRecord }, rival),
        await checkIn(ironHouse, { userId: meera.userId }, rival),
        await get(`/v1/orgs/${ironHouse}/attendance/log`, rival.cookies),
      ]) {
        expect(res.statusCode).toBe(404);
        expect(res.body).not.toContain("Meera");
        expect(res.body).not.toContain("Raghu");
      }

      // At their own gym, with Iron House's people's ids: nobody, and nothing written.
      const before = await visits(studio9);
      expect(await found(studio9, "Meera", rival)).toEqual([]);
      expect(await found(studio9, "7002", rival)).toEqual([]);
      for (const pick of [{ entryId: meeraRecord }, { entryId: raghu }, { userId: meera.userId }]) {
        const res = await checkIn(studio9, pick, rival);
        expect(res.statusCode).toBe(404);
        expect(JSON.parse(res.body)).toMatchObject({ error: "person_not_found" });
        expect(res.body).not.toContain("Meera");
      }
      expect(await visits(studio9)).toEqual(before);
      // Studio 9's log has none of Iron House's visits.
      expect((await logOf(studio9, rival)).map((v) => v.name)).not.toContain("Raghu Nair");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a former member is never found and never checked in; the person picked is the person checked in",
    async () => {
      const gone = await addRecord(ironHouse, { fullName: "Farah Left", memberNumber: "7101", former: true });
      const anil = await addRecord(ironHouse, { fullName: "Anil Kumar", memberNumber: "7102" });
      const anita = await addRecord(ironHouse, { fullName: "Anita Kumar", memberNumber: "7103" });
      expect(await found(ironHouse, "Farah", owner)).toEqual([]);
      expect(await found(ironHouse, "7101", owner)).toEqual([]);
      const before = (await visits(ironHouse)).length;
      const res = await checkIn(ironHouse, { entryId: gone }, owner);
      expect(res.statusCode).toBe(404);
      expect(await visits(ironHouse)).toHaveLength(before);

      // Two Kumars: checking in Anita writes Anita, names Anita, and leaves Anil out.
      const kumars = await found(ironHouse, "Kumar", owner);
      expect(kumars.map((p) => [p.name, p.memberNumber])).toEqual([
        ["Anil Kumar", "7102"],
        ["Anita Kumar", "7103"],
      ]);
      const answer = await checkIn(ironHouse, { entryId: anita }, owner);
      expect(JSON.parse(answer.body)).toMatchObject({ result: "checked_in", person: { name: "Anita Kumar" } });
      const rows = (await visits(ironHouse)).slice(before);
      expect(rows).toEqual([{ user_id: null, entry_id: anita, device_id: null, marked_by_user_id: owner.userId, method: "staff" }]);
      expect(rows.some((row) => row.entry_id === anil)).toBe(false);
      const log = await logOf(ironHouse, owner);
      expect(log[0]).toMatchObject({ name: "Anita Kumar", method: "staff", by: "Iron Owner" });
    },
    TEST_TIMEOUT_MS,
  );

  // ===========================================================================
  // WHO MAY
  // ===========================================================================

  it("checking in needs the new tick: a trainer without it is refused, and sees the log", async () => {
    const trainer = await makeUser("trainer", "Tara Trainer");
    await addStaff(ironHouse, trainer, "trainer", null);
    const sana = await addRecord(ironHouse, { fullName: "Sana Shah" });
    expect((await search(ironHouse, "Sana", trainer)).statusCode).toBe(403);
    const refused = await checkIn(ironHouse, { entryId: sana }, trainer);
    expect(refused.statusCode).toBe(403);
    expect(refused.body).not.toContain("Sana");
    expect((await get(`/v1/orgs/${ironHouse}/attendance/log`, trainer.cookies)).statusCode).toBe(200);

    // The owner ticks it for them.
    await sql`UPDATE gym_staff SET privileges = ${["members.read", "codes.invite", "attendance.read", "attendance.mark"]}
              WHERE gym_id = ${ironHouse} AND user_id = ${trainer.userId}`;
    expect((await found(ironHouse, "Sana", trainer)).map((p) => p.name)).toEqual(["Sana Shah"]);
    expect((await checkIn(ironHouse, { entryId: sana }, trainer)).statusCode).toBe(200);
    expect((await logOf(ironHouse, owner))[0]).toMatchObject({ name: "Sana Shah", by: "Tara Trainer" });

    // A manager starts with it; a member who is not staff has nothing.
    const manager = await makeUser("manager", "Manu Manager");
    await addStaff(ironHouse, manager, "manager", null);
    expect((await search(ironHouse, "Sana", manager)).statusCode).toBe(200);
    const member = await makeUser("member", "Plain Member");
    await join(ironHouse, member);
    expect((await search(ironHouse, "Sana", member)).statusCode).toBe(404);
    expect((await checkIn(ironHouse, { entryId: sana }, member)).statusCode).toBe(404);
    expect((await get(`/v1/orgs/${ironHouse}/attendance/log`, member.cookies)).statusCode).toBe(404);
    // Signed out: nothing.
    expect((await search(ironHouse, "Sana", { userId: "", email: "", cookies: {} })).statusCode).toBe(401);
  }, TEST_TIMEOUT_MS);

  it("a gym whose plan has ended cannot check people in by hand", async () => {
    const lapsedOwner = await makeUser("lapsed", "Lapsed Owner");
    const lapsed = await makeGym(lapsedOwner, "Lapsed Gym", false);
    const kim = await addRecord(lapsed, { fullName: "Kim Lee" });
    const res = await checkIn(lapsed, { entryId: kim }, lapsedOwner);
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body)).toMatchObject({ error: "gym_not_on_plan" });
    expect(await visits(lapsed)).toEqual([]);
  }, TEST_TIMEOUT_MS);

  // ===========================================================================
  // THE CHECK-IN
  // ===========================================================================

  it("twice is one visit, a payment word is shown and never blocks, and an app member's record carries their account", async () => {
    const dev = await makeUser("dev", "Dev Patel");
    const devRecord = await addRecord(ironHouse, { fullName: "Dev Patel", email: dev.email, status: "Expired", payment: "Overdue" });
    await join(ironHouse, dev, devRecord);
    const first = await checkIn(ironHouse, { entryId: devRecord }, owner);
    expect(first.statusCode).toBe(200);
    expect(JSON.parse(first.body)).toEqual({
      result: "checked_in",
      person: { name: "Dev Patel" },
      notice: { status: "Expired", payment: "Overdue", onList: true },
    });
    const again = JSON.parse((await checkIn(ironHouse, { userId: dev.userId }, owner)).body) as { result: string; firstAt: string; timezone: string };
    expect(again.result).toBe("already");
    expect(again.timezone).toBe("Asia/Kolkata");
    const rows = (await visits(ironHouse)).filter((row) => row.entry_id === devRecord);
    expect(rows).toEqual([{ user_id: dev.userId, entry_id: devRecord, device_id: null, marked_by_user_id: owner.userId, method: "staff" }]);
    // The visit keeps Dev's streak alive.
    const streak = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM streaks WHERE user_id = ${dev.userId}`;
    expect(streak[0]?.n).toBe(1);
  }, TEST_TIMEOUT_MS);

  it("a member in the app with no record is found once and checked in on their account; one with a record is found as the record", async () => {
    const noRecord = await makeUser("norec", "Zoya Apponly");
    await join(ironHouse, noRecord);
    const withRecord = await makeUser("withrec", "Zubin Listed");
    const zubin = await addRecord(ironHouse, { fullName: "Zubin Listed", email: withRecord.email, memberNumber: "7201" });
    await join(ironHouse, withRecord, zubin);

    const people = await found(ironHouse, "Zo", owner);
    expect(people).toEqual([
      { pick: { userId: noRecord.userId }, name: "Zoya Apponly", memberNumber: null, email: noRecord.email, notice: { status: null, payment: null, onList: false } },
    ]);
    // Found by the app's email, Zubin is his record, once.
    const byEmail = await found(ironHouse, withRecord.email.slice(0, 20), owner);
    expect(byEmail.map((p) => p.pick)).toEqual([{ entryId: zubin }]);

    expect((await checkIn(ironHouse, { userId: noRecord.userId }, owner)).statusCode).toBe(200);
    const rows = (await visits(ironHouse)).filter((row) => row.user_id === noRecord.userId);
    expect(rows).toEqual([{ user_id: noRecord.userId, entry_id: null, device_id: null, marked_by_user_id: owner.userId, method: "staff" }]);
  }, TEST_TIMEOUT_MS);

  it("a search's own characters match only themselves", async () => {
    await addRecord(ironHouse, { fullName: "Percy Plain", memberNumber: "50%" });
    expect((await found(ironHouse, "50%", owner)).map((p) => p.name)).toEqual(["Percy Plain"]);
    // "%" is the one member whose number has it, never everybody.
    expect((await found(ironHouse, "%", owner)).map((p) => p.name)).toEqual(["Percy Plain"]);
    expect(await found(ironHouse, "_", owner)).toEqual([]);
  }, TEST_TIMEOUT_MS);

  it("refuses what it cannot read", async () => {
    const one = await addRecord(ironHouse, { fullName: "Bad Input" });
    for (const res of [
      await checkIn(ironHouse, {}, owner),
      await checkIn(ironHouse, { entryId: "nope" }, owner),
      await checkIn(ironHouse, { entryId: one, userId: owner.userId }, owner),
      await checkIn(ironHouse, { entryId: one, method: "pass" }, owner),
      await search(ironHouse, "   ", owner),
      await search(ironHouse, "x".repeat(101), owner),
      await get(`/v1/orgs/${ironHouse}/attendance/log?since=yesterday`, owner.cookies),
      await get(`/v1/orgs/${ironHouse}/attendance/history?entryId=${one}&userId=${owner.userId}`, owner.cookies),
      await get(`/v1/orgs/not-a-gym/attendance/log`, owner.cookies),
    ]) {
      expect(res.statusCode).toBe(400);
    }
  }, TEST_TIMEOUT_MS);

  // ===========================================================================
  // THE LOG, AND THE PEOPLE WITHOUT THE APP COUNTED
  // ===========================================================================

  it("the log gives what came since, and the day list, a person's visits and Overview count somebody without the app", async () => {
    const gymOwner = await makeUser("count", "Count Owner");
    const gym = await makeGym(gymOwner, "Count Gym");
    const app1 = await makeUser("app1", "Asha App");
    await join(gym, app1, await addRecord(gym, { fullName: "Asha App", email: app1.email }));
    const ravi = await addRecord(gym, { fullName: "Ravi Noapp", email: "ravi-noapp@example.com" });
    const asha = (await found(gym, "Asha", gymOwner))[0]?.pick;

    const empty = await logOf(gym, gymOwner);
    expect(empty).toEqual([]);
    expect((await checkIn(gym, asha, gymOwner)).statusCode).toBe(200);
    const one = await logOf(gym, gymOwner);
    expect(one.map((v) => v.name)).toEqual(["Asha App"]);
    const newest = one[0]?.markedAt ?? "";

    expect((await checkIn(gym, { entryId: ravi }, gymOwner)).statusCode).toBe(200);
    const since = await logOf(gym, gymOwner, newest);
    // Ravi is new; Asha may come again inside the overlap and the screen keeps each id once.
    expect(since.map((v) => v.name)).toContain("Ravi Noapp");
    const later = new Date(Date.parse(since[0]?.markedAt ?? "") + 60_000).toISOString();
    expect(await logOf(gym, gymOwner, later)).toEqual([]);

    // The day list: two people, Ravi with no account and his record named.
    const day = JSON.parse((await get(`/v1/orgs/${gym}/attendance`, gymOwner.cookies)).body) as {
      attendance: { totals: { visits: number; people: number }; people: { userId: string | null; entryId: string | null; displayName: string; email: string }[] };
    };
    expect(day.attendance.totals).toEqual({ visits: 2, people: 2 });
    expect(day.attendance.people.map((p) => [p.displayName, p.userId === null])).toEqual([
      ["Asha App", false],
      ["Ravi Noapp", true],
    ]);
    const raviRow = day.attendance.people[1];
    expect(raviRow).toMatchObject({ entryId: ravi, email: "ravi-noapp@example.com" });

    // His visits, by his record.
    const history = JSON.parse((await get(`/v1/orgs/${gym}/attendance/history?entryId=${ravi}`, gymOwner.cookies)).body) as {
      attendance: { visits: { method: string }[] };
    };
    expect(history.attendance.visits.map((v) => v.method)).toEqual(["staff"]);
    // Another gym's owner cannot read it.
    expect((await get(`/v1/orgs/${gym}/attendance/history?entryId=${ravi}`, rival.cookies)).statusCode).toBe(404);
    expect((await get(`/v1/orgs/${studio9}/attendance/history?entryId=${ravi}`, rival.cookies)).statusCode).toBe(200);
    const foreign = JSON.parse((await get(`/v1/orgs/${studio9}/attendance/history?entryId=${ravi}`, rival.cookies)).body) as {
      attendance: { visits: unknown[] };
    };
    expect(foreign.attendance.visits).toEqual([]);

    // Overview: two visitors today.
    const overview = JSON.parse((await get(`/v1/orgs/${gym}/overview`, gymOwner.cookies)).body) as {
      overview: { tiles: { today: { visits: number; visitors: number } } };
    };
    expect(overview.overview.tiles.today).toEqual({ visits: 2, visitors: 2 });
  }, TEST_TIMEOUT_MS);
});
