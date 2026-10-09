// A GYM'S MESSAGES TO ITS MEMBERS, AND THE INBOX — against real Postgres (spec Part 3 §16.1,
// §16.2; ROADMAP 20a). DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: a gym's message to somebody the gym
// removed, or the same message many times because the job ran twice. That is the first
// test below; the second is a stranger reading somebody else's inbox.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { welcomeMessage, type GymInboxResponse } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { sendDueMessages } from "../src/modules/orgs/messages/send.js";
import { createMemoryRedis } from "../src/redis.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "gym-inbox-test-secret-0123456789abcdef", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 120_000;
const LIVE_PLAN = "zz_inbox_live";
/** Friday 9 October 2026, noon in Kolkata, and 02:30 at night in New York. */
const NOON = new Date("2026-10-09T06:30:00Z");
const minutes = (from: Date, n: number): Date => new Date(from.getTime() + n * 60_000);
const days = (from: Date, n: number): Date => minutes(from, n * 24 * 60);

let ipCounter = 0;
const nextIp = () => `10.88.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("a gym's messages and the member's inbox (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  let clock = NOON;
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'inbox-t-%@example.com')`;
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'inbox-t-%@example.com'`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_member_messages WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM user_fitness_profiles WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM one_time_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM refresh_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM consent_log WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM users WHERE email LIKE 'inbox-t-%@example.com'`;
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
    const email = `inbox-t-${uniq()}@example.com`;
    const reg = await inject("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await inject("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };
  /** Somebody who never signs in during the test. */
  const account = async (displayName: string): Promise<{ userId: string }> => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO users (email, display_name) VALUES (${`inbox-t-p-${uniq()}@example.com`}, ${displayName}) RETURNING id`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("no user");
    return { userId: id };
  };

  interface Gym {
    id: string;
    name: string;
    owner: Person;
  }
  const livePlan = async (gymId: string) => {
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
  };
  const KOLKATA = { city: "Jorhat", country: "IN", timezone: "Asia/Kolkata" };
  const NEW_YORK = { city: "New York", country: "US", timezone: "America/New_York" };
  const makeGym = async (name: string, place = KOLKATA, plan = true): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await inject("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, ...place });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    if (plan) await livePlan(id);
    return { id, name, owner };
  };

  const record = async (gymId: string, fullName: string, former: boolean): Promise<string> => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO gym_member_list_entries (gym_id, full_name, email, identity_key, source, former_at)
      VALUES (${gymId}, ${fullName}, ${`inbox-r-${uniq()}@example.com`}, encode(sha256(${`inbox-${uniq()}`}::bytea), 'hex'), 'typed', ${former ? NOON : null})
      RETURNING id`;
    return rows[0]?.id ?? "";
  };
  /** Joins the gym at `joinedAt`: a row as the Join step writes it. */
  const inGym = async (gym: Gym, userId: string, joinedAt: Date, entryId: string | null = null): Promise<void> => {
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id, joined_at) VALUES (${gym.id}, ${userId}, ${entryId}, ${joinedAt})`;
  };
  const joins = async (gym: Gym, name: string, joinedAt: Date = minutes(NOON, -30)): Promise<Person> => {
    const p = await signedIn(name);
    await inGym(gym, p.userId, joinedAt);
    return p;
  };
  const remove = async (gym: Gym, userId: string, at: Date = NOON): Promise<void> => {
    await sql`UPDATE gym_members SET removed_at = ${at} WHERE gym_id = ${gym.id} AND user_id = ${userId} AND removed_at IS NULL`;
  };

  const log = { info: () => undefined, error: () => undefined };
  /** The sending step, looking only at these gyms: other tests share the database. */
  const run = (gyms: readonly Gym[], now: Date = clock) => sendDueMessages({ sql, log }, { now, gymIds: gyms.map((g) => g.id) });
  const sentTo = async (gym: Gym): Promise<{ user_id: string; kind: string; occasion: string; body: string; day: string; read: boolean }[]> =>
    await sql`
      SELECT user_id, kind, occasion, body, gym_day::text AS day, read_at IS NOT NULL AS read
      FROM gym_member_messages WHERE gym_id = ${gym.id} ORDER BY sent_at, user_id`;

  const path = (gymId: string) => `/v1/orgs/${gymId}/inbox`;
  const inbox = async (gym: Gym, who: Person): Promise<GymInboxResponse> => {
    const res = await inject("GET", path(gym.id), who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as GymInboxResponse;
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), { redis, orgs: { now: () => clock } });
    await api().ready();
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, T);

  it(
    "THE WORST THING: a removed or former member and a deleted account get nothing, and the job run again and again sends each message once",
    async () => {
      clock = NOON;
      const gym = await makeGym("Inbox Iron House");
      const maya = await joins(gym, "Maya Rao");
      // Removed by the gym after joining this morning.
      const rex = await joins(gym, "Rex Removed");
      await remove(gym, rex.userId, minutes(NOON, -5));
      // Still in the app, and their record on the gym's list is a former one.
      const finn = await signedIn("Finn Former");
      await inGym(gym, finn.userId, minutes(NOON, -20), await record(gym.id, "Finn Former", true));
      // Their account is deleted.
      const dee = await account("Dee Deleted");
      await inGym(gym, dee.userId, minutes(NOON, -10));
      await sql`UPDATE users SET status = 'deleted' WHERE id = ${dee.userId}`;
      // On the list with a current record: sent, as Maya is.
      const cara = await account("Cara Current");
      await inGym(gym, cara.userId, minutes(NOON, -15), await record(gym.id, "Cara Current", false));

      // Three runs at one instant, then two more.
      const together = await Promise.all([run([gym]), run([gym]), run([gym])]);
      expect(together.map((r) => r.sent).sort()).toEqual([0, 0, 2]);
      expect(await run([gym])).toEqual({ gyms: 1, sent: 0 });
      expect(await run([gym], minutes(NOON, 15))).toEqual({ gyms: 1, sent: 0 });

      const rows = await sentTo(gym);
      expect(rows.map((r) => r.user_id).sort()).toEqual([maya.userId, cara.userId].sort());
      for (const who of [rex, finn, dee]) expect(rows.some((r) => r.user_id === who.userId)).toBe(false);
      const hers = rows.find((r) => r.user_id === maya.userId);
      expect(hers).toEqual({ user_id: maya.userId, kind: "welcome", occasion: "joined:2026-10-09", body: welcomeMessage(gym.name, "Maya Rao"), day: "2026-10-09", read: false });
      expect(hers?.body).toBe("Welcome to Inbox Iron House, Maya. We're glad you joined. Messages from us will show up here.");

      // The next day, and the day after: still one each.
      expect((await run([gym], days(NOON, 1))).sent).toBe(0);
      expect((await run([gym], days(NOON, 2))).sent).toBe(0);
      expect(await sentTo(gym)).toHaveLength(2);

      // Maya is removed after her message: it is not hers to read any more.
      expect((await inbox(gym, maya)).messages).toHaveLength(1);
      await remove(gym, maya.userId);
      expect((await inject("GET", path(gym.id), maya.cookies)).statusCode).toBe(404);
      expect((await inject("POST", `${path(gym.id)}/read`, maya.cookies, { upTo: NOON.toISOString() })).statusCode).toBe(404);
      // Rex and Finn: one 404, one empty inbox, and neither a message.
      expect((await inject("GET", path(gym.id), rex.cookies)).statusCode).toBe(404);
      expect((await inbox(gym, finn)).messages).toEqual([]);
    },
    T,
  );

  it(
    "a stranger, another gym's member and somebody not signed in read nobody's inbox, and a member reads only their own",
    async () => {
      clock = NOON;
      const gym = await makeGym("Inbox Own Gym");
      const other = await makeGym("Inbox Other Gym");
      const maya = await joins(gym, "Maya Rao");
      const bo = await joins(gym, "Bo Lee");
      const theirs = await joins(other, "Theo Other");
      const stranger = await signedIn("Sam Stranger");
      expect((await run([gym, other])).sent).toBe(3);
      clock = minutes(NOON, 1);

      for (const who of [stranger, theirs, other.owner]) {
        expect((await inject("GET", path(gym.id), who.cookies)).statusCode).toBe(404);
        expect((await inject("POST", `${path(gym.id)}/read`, who.cookies, { upTo: NOON.toISOString() })).statusCode).toBe(404);
      }
      // The gym's own owner is not a member of it in the app: the inbox is a member's.
      expect((await inject("GET", path(gym.id), gym.owner.cookies)).statusCode).toBe(404);
      expect((await inject("GET", path(gym.id), {})).statusCode).toBe(401);
      expect((await inject("POST", `${path(gym.id)}/read`, {}, { upTo: NOON.toISOString() })).statusCode).toBe(401);
      expect((await inject("GET", path("not-a-gym"), maya.cookies)).statusCode).toBe(400);
      expect((await inject("GET", path("11111111-1111-4111-8111-111111111111"), maya.cookies)).statusCode).toBe(404);

      const mine = await inject("GET", path(gym.id), maya.cookies);
      const read = JSON.parse(mine.body) as GymInboxResponse;
      expect(read.messages.map((m) => m.body)).toEqual([welcomeMessage(gym.name, "Maya Rao")]);
      // Bo's unread message, and a second one written for him, are not in her count.
      await sql`
        INSERT INTO gym_member_messages (gym_id, user_id, kind, occasion, body, gym_day, sent_at, expires_at)
        VALUES (${gym.id}, ${bo.userId}, 'birthday', 'birthday:2026', 'Happy birthday, Bo.', '2026-10-09', ${NOON}, ${days(NOON, 30)})`;
      expect((await inbox(gym, maya)).unread).toBe(1);
      expect((await inbox(gym, bo)).unread).toBe(2);
      expect(mine.body).not.toContain("Bo");
      expect(mine.body).not.toContain(bo.userId);
      expect(mine.body).not.toContain("Theo");

      // Maya marking hers as read marks nobody else's, in her gym or any other.
      expect((await inject("POST", `${path(gym.id)}/read`, maya.cookies, { upTo: minutes(NOON, 1).toISOString() })).statusCode).toBe(200);
      expect((await sentTo(gym)).map((r) => [r.user_id, r.read]).sort()).toEqual([[maya.userId, true], [bo.userId, false], [bo.userId, false]].sort());
      expect((await inbox(gym, maya)).unread).toBe(0);
      expect((await inbox(gym, bo)).unread).toBe(2);
      expect((await sentTo(other)).map((r) => r.read)).toEqual([false]);
    },
    T,
  );

  it(
    "the inbox: new until it is opened, marked read once, and a message that came after the read stays new",
    async () => {
      clock = NOON;
      const gym = await makeGym("Inbox Reading Gym");
      const maya = await joins(gym, "Maya Rao");
      expect((await inbox(gym, maya))).toMatchObject({ gymId: gym.id, gymName: gym.name, status: "shown", messages: [], unread: 0 });
      await run([gym]);

      clock = minutes(NOON, 5);
      const first = await inbox(gym, maya);
      expect(first.unread).toBe(1);
      expect(first.messages).toEqual([{ id: first.messages[0]?.id, kind: "welcome", body: welcomeMessage(gym.name, "Maya Rao"), sentAt: NOON.toISOString(), read: false }]);
      // Reading marks nothing.
      expect((await inbox(gym, maya)).unread).toBe(1);

      // A second message lands after she was shown the first (written as the job writes one).
      await sql`
        INSERT INTO gym_member_messages (gym_id, user_id, kind, occasion, body, gym_day, sent_at, expires_at)
        VALUES (${gym.id}, ${maya.userId}, 'birthday', 'birthday:2026', 'Happy birthday, Maya.', '2026-10-09', ${minutes(NOON, 6)}, ${days(NOON, 30)})`;
      clock = minutes(NOON, 7);
      const mark = await inject("POST", `${path(gym.id)}/read`, maya.cookies, { upTo: first.asOf });
      expect(mark.statusCode).toBe(200);
      expect(JSON.parse(mark.body)).toEqual({ unread: 1 });
      const second = await inbox(gym, maya);
      expect(second.messages.map((m) => [m.kind, m.read])).toEqual([["birthday", false], ["welcome", true]]);

      // Marked again, the first instant is kept; an instant in the future marks only what is there.
      const before = await sql<{ read_at: Date }[]>`SELECT read_at FROM gym_member_messages WHERE gym_id = ${gym.id} AND kind = 'welcome'`;
      clock = minutes(NOON, 9);
      expect(JSON.parse((await inject("POST", `${path(gym.id)}/read`, maya.cookies, { upTo: days(NOON, 400).toISOString() })).body)).toEqual({ unread: 0 });
      const after = await sql<{ read_at: Date }[]>`SELECT read_at FROM gym_member_messages WHERE gym_id = ${gym.id} AND kind = 'welcome'`;
      expect(after[0]?.read_at.toISOString()).toBe(before[0]?.read_at.toISOString());
      expect(before[0]?.read_at.toISOString()).toBe(minutes(NOON, 7).toISOString());

      // A body the route cannot read is refused, and marks nothing.
      for (const bad of [{}, { upTo: "yesterday" }, { upTo: NOON.toISOString(), userId: maya.userId }, { upTo: 5 }]) {
        const res = await inject("POST", `${path(gym.id)}/read`, maya.cookies, bad);
        expect(res.statusCode, JSON.stringify(bad)).toBe(400);
        expect(res.body).not.toContain("yesterday");
      }
    },
    T,
  );

  it(
    "a message leaves the inbox after 30 days, its row stays, and it is never sent again",
    async () => {
      clock = NOON;
      const gym = await makeGym("Inbox Thirty Gym");
      const maya = await joins(gym, "Maya Rao");
      await run([gym]);
      clock = minutes(days(NOON, 30), -1);
      expect((await inbox(gym, maya)).messages).toHaveLength(1);
      clock = days(NOON, 30);
      expect(await inbox(gym, maya)).toMatchObject({ messages: [], unread: 0 });
      expect((await run([gym], clock)).sent).toBe(0);
      expect(await sentTo(gym)).toHaveLength(1);
    },
    T,
  );

  it(
    "night on the gym's own clock waits for morning; a gym on no plan and a closed gym send nothing",
    async () => {
      clock = NOON;
      const night = await makeGym("Inbox Night Gym", NEW_YORK);
      const lapsed = await makeGym("Inbox Lapsed Gym", KOLKATA, false);
      const closed = await makeGym("Inbox Closed Gym");
      const nina = await joins(night, "Nina Night");
      const lara = await joins(lapsed, "Lara Lapsed");
      const cleo = await joins(closed, "Cleo Closed");
      await sql`UPDATE gyms SET status = 'archived' WHERE id = ${closed.id}`;

      // 02:30 in New York.
      expect(await run([night, lapsed, closed])).toEqual({ gyms: 3, sent: 0 });
      // 07:45 there: still night. 08:00: morning, and it goes once, dated the gym's own day.
      expect((await run([night], new Date("2026-10-09T11:45:00Z"))).sent).toBe(0);
      expect((await run([night], new Date("2026-10-09T12:00:00Z"))).sent).toBe(1);
      expect((await run([night], new Date("2026-10-09T12:15:00Z"))).sent).toBe(0);
      expect((await sentTo(night)).map((r) => [r.user_id, r.day])).toEqual([[nina.userId, "2026-10-09"]]);
      // 21:00 there on the 9th is 01:00 on the 10th in UTC: night again.
      const late = await joins(night, "Lou Late", new Date("2026-10-10T00:30:00Z"));
      expect((await run([night], new Date("2026-10-10T01:00:00Z"))).sent).toBe(0);
      expect((await run([night], new Date("2026-10-10T12:00:00Z"))).sent).toBe(1);
      // Joined on the 9th by the gym's own calendar and the 10th in UTC: sent on the gym's
      // 10th, for an occasion named by the UTC day, which no zone change moves.
      expect((await sentTo(night)).find((r) => r.user_id === late.userId)).toMatchObject({ occasion: "joined:2026-10-10", day: "2026-10-10" });

      // The plan comes back within the three days: the Welcome goes then. The closed gym never sends.
      await livePlan(lapsed.id);
      expect((await run([lapsed, closed], days(NOON, 1))).sent).toBe(1);
      expect((await sentTo(lapsed)).map((r) => r.user_id)).toEqual([lara.userId]);
      expect(await sentTo(closed)).toEqual([]);

      // Their members' inboxes: a gym on no plan shows none, and says so.
      await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${lapsed.id}`;
      clock = days(NOON, 1);
      expect(await inbox(lapsed, lara)).toMatchObject({ status: "paused", messages: [], unread: 0 });
      expect(await inbox(closed, cleo)).toMatchObject({ status: "paused", messages: [] });
      expect(JSON.parse((await inject("POST", `${path(lapsed.id)}/read`, lara.cookies, { upTo: clock.toISOString() })).body)).toEqual({ unread: 0 });
      expect((await sentTo(lapsed)).map((r) => r.read)).toEqual([false]);
    },
    T,
  );

  it(
    "who is welcomed: nobody who joined more than three days ago, not the gym's own staff, and somebody removed and back the same day only once",
    async () => {
      clock = NOON;
      const gym = await makeGym("Inbox Who Gym");
      const old = await joins(gym, "Olga Old", days(NOON, -3));
      const recent = await joins(gym, "Ravi Recent", days(NOON, -2));
      // The owner and a trainer, each using the member app through their own gym.
      await inGym(gym, gym.owner.userId, minutes(NOON, -60));
      const trainer = await signedIn("Tara Trainer");
      await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gym.id}, ${trainer.userId}, 'trainer')`;
      await inGym(gym, trainer.userId, minutes(NOON, -50));
      // Welcomed, removed and back within the hour.
      const back = await joins(gym, "Bea Back", minutes(NOON, -40));
      expect((await run([gym])).sent).toBe(2);
      await remove(gym, back.userId, minutes(NOON, 1));
      await inGym(gym, back.userId, minutes(NOON, 2));
      expect((await run([gym], minutes(NOON, 15))).sent).toBe(0);

      const rows = await sentTo(gym);
      expect(rows.map((r) => r.user_id).sort()).toEqual([recent.userId, back.userId].sort());
      expect(rows.find((r) => r.user_id === recent.userId)?.occasion).toBe("joined:2026-10-07");
      for (const who of [old, gym.owner, trainer]) expect(rows.some((r) => r.user_id === who.userId)).toBe(false);

      // Back in the gym, she is shown only what was sent since she came back.
      clock = minutes(NOON, 20);
      expect(await inbox(gym, back)).toMatchObject({ messages: [], unread: 0 });
      // Removed and back the NEXT day is a new join, and is welcomed for it.
      await remove(gym, recent.userId, minutes(NOON, 30));
      await inGym(gym, recent.userId, days(NOON, 1));
      expect((await run([gym], minutes(days(NOON, 1), 15))).sent).toBe(1);
      clock = minutes(days(NOON, 1), 20);
      expect((await inbox(gym, recent)).messages.map((m) => m.sentAt)).toEqual([minutes(days(NOON, 1), 15).toISOString()]);
    },
    T,
  );

  it(
    "the inbox's own limits at one address: a member past 600 reads in the hour is refused, the next member is not, and a stranger's 404 is not counted",
    async () => {
      clock = NOON;
      const gym = await makeGym("Inbox Wifi Gym");
      const maya = await joins(gym, "Maya Rao");
      const bo = await joins(gym, "Bo Lee");
      const stranger = await signedIn("Sam Stranger");
      expect((await run([gym])).sent).toBe(2);
      const ADDRESS = "10.88.249.249";
      const hers = `rl:orgs_inbox_read:id:${maya.userId}`;
      const theAddress = `rl:orgs_inbox_read:ip:${ADDRESS}`;
      const read = (who: Person) => inject("GET", path(gym.id), who.cookies, undefined, ADDRESS);

      // Each read is counted once for her and once for the address.
      for (let i = 0; i < 3; i += 1) expect((await read(maya)).statusCode).toBe(200);
      expect([await redis.get(hers), await redis.get(theAddress)]).toEqual(["3", "3"]);

      // Her 600th read of the hour is answered and her 601st is not, by this route's own
      // limit (the app-wide one says "Too many requests").
      await redis.setex(hers, 3600, "599");
      expect((await read(maya)).statusCode).toBe(200);
      const refused = await read(maya);
      expect(refused.statusCode).toBe(429);
      expect((JSON.parse(refused.body) as { message: string }).message).toBe("Too many attempts. Please try again later.");
      // Her being refused is hers alone: Bo, at the same address, reads his own.
      const his = await read(bo);
      expect(his.statusCode).toBe(200);
      expect((JSON.parse(his.body) as GymInboxResponse).messages.map((m) => m.body)).toEqual([welcomeMessage(gym.name, "Bo Lee")]);

      // A stranger's 404 does not use up the address's reads.
      const before = await redis.get(theAddress);
      expect(before).not.toBeNull();
      for (let i = 0; i < 5; i += 1) expect((await read(stranger)).statusCode).toBe(404);
      expect(await redis.get(theAddress)).toBe(before);

      // The address's own limit is a whole gym's, not one person's: 700 reads there stop
      // nobody, and past 6,000 in the hour everybody there waits.
      await redis.setex(theAddress, 3600, "700");
      expect((await read(bo)).statusCode).toBe(200);
      await redis.setex(theAddress, 3600, "6000");
      expect((await read(bo)).statusCode).toBe(429);
    },
    T,
  );

  it(
    "a removal that lands while a run is waiting for the gym: the run sees it, and sends that person nothing",
    async () => {
      clock = NOON;
      const gym = await makeGym("Inbox Held Gym");
      const maya = await joins(gym, "Maya Rao");
      const rex = await joins(gym, "Rex Removed");
      let running: Promise<{ gyms: number; sent: number }> | undefined;
      // Staff's step holds the gym's row, as every removal does, while the run starts.
      await sql.begin(async (tx) => {
        await tx`SELECT 1 FROM gyms WHERE id = ${gym.id} FOR UPDATE`;
        running = run([gym]);
        await new Promise((resolve) => setTimeout(resolve, 400));
        expect(await sentTo(gym)).toEqual([]);
        await tx`UPDATE gym_members SET removed_at = ${NOON} WHERE gym_id = ${gym.id} AND user_id = ${rex.userId}`;
      });
      expect(await running).toEqual({ gyms: 1, sent: 1 });
      expect((await sentTo(gym)).map((r) => r.user_id)).toEqual([maya.userId]);
    },
    T,
  );

  it(
    "a gym that changes its time zone sends nobody a second Welcome",
    async () => {
      // 19:00 UTC on the 9th: half past midnight on the 10th in Kolkata.
      const joined = new Date("2026-10-09T19:00:00Z");
      const gym = await makeGym("Inbox Moving Gym");
      const maya = await joins(gym, "Maya Rao", joined);
      // 09:30 in Kolkata on the 10th.
      expect((await run([gym], new Date("2026-10-10T04:00:00Z"))).sent).toBe(1);
      await sql`UPDATE gyms SET timezone = 'Europe/London' WHERE id = ${gym.id}`;
      // In London she joined on the 9th. Noon there, the next two days.
      expect((await run([gym], new Date("2026-10-10T11:00:00Z"))).sent).toBe(0);
      expect((await run([gym], new Date("2026-10-11T11:00:00Z"))).sent).toBe(0);
      expect((await sentTo(gym)).map((r) => [r.user_id, r.occasion])).toEqual([[maya.userId, "joined:2026-10-09"]]);
    },
    T,
  );

  it(
    "a gym the run cannot read does not stop the gyms after it: they are sent theirs, and the run still fails",
    async () => {
      clock = NOON;
      const gyms = [await makeGym("Inbox Row One"), await makeGym("Inbox Row Two"), await makeGym("Inbox Row Three")].sort((a, b) => (a.id < b.id ? -1 : 1));
      const people = [];
      for (const gym of gyms) people.push(await joins(gym, "Maya Rao"));
      const [bad, ...good] = gyms;
      if (bad === undefined) throw new Error("no gym");
      // The first gym the run reaches has a zone Postgres does not know.
      await sql`UPDATE gyms SET timezone = 'Not/A_Zone' WHERE id = ${bad.id}`;
      const errors: object[] = [];
      const loud = { info: () => undefined, error: (obj: object) => void errors.push(obj) };
      await expect(sendDueMessages({ sql, log: loud }, { now: NOON, gymIds: gyms.map((g) => g.id) })).rejects.toThrow("member messages failed for 1 of 3 gyms");
      expect(await sentTo(bad)).toEqual([]);
      for (const gym of good) expect(await sentTo(gym)).toHaveLength(1);
      // The log names the gym and the kind of error, and nobody in it.
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ event: "member_messages.gym_failed", gymId: bad.id });
      expect(JSON.stringify(errors)).not.toContain(people[0]?.userId ?? "x");
      expect(JSON.stringify(errors)).not.toContain("Maya");
      // Put right, the gym gets its own on the next run and nobody a second.
      await sql`UPDATE gyms SET timezone = 'Asia/Kolkata' WHERE id = ${bad.id}`;
      expect(await run(gyms, minutes(NOON, 15))).toEqual({ gyms: 1, sent: 1 });
    },
    T,
  );

  it(
    "a gym whose new members all have their Welcome is not looked at again",
    async () => {
      clock = NOON;
      const gym = await makeGym("Inbox Quiet Gym");
      await joins(gym, "Maya Rao");
      const rex = await joins(gym, "Rex Removed");
      await remove(gym, rex.userId, minutes(NOON, -5));
      expect(await run([gym])).toEqual({ gyms: 1, sent: 1 });
      expect(await run([gym], minutes(NOON, 15))).toEqual({ gyms: 0, sent: 0 });
      // Somebody new, and the gym is looked at again.
      await joins(gym, "Bo Lee", minutes(NOON, 20));
      expect(await run([gym], minutes(NOON, 30))).toEqual({ gyms: 1, sent: 1 });
    },
    T,
  );

  it(
    "the run the worker makes, with no gyms named, welcomes this gym's new member once",
    async () => {
      // Made in 2031, so no other test's gym has a joiner in the days it looks at.
      const then = new Date("2031-03-04T06:30:00Z");
      clock = then;
      const gym = await makeGym("Inbox Whole Run Gym");
      const maya = await joins(gym, "Maya Rao", minutes(then, -30));
      const first = await sendDueMessages({ sql, log }, { now: then });
      expect(first.sent).toBe(1);
      expect((await sendDueMessages({ sql, log }, { now: minutes(then, 15) })).sent).toBe(0);
      expect((await sentTo(gym)).map((r) => [r.user_id, r.occasion])).toEqual([[maya.userId, "joined:2031-03-04"]]);
    },
    T,
  );
});
