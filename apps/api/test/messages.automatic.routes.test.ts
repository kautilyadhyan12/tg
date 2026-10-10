// BIRTHDAY, VISIT MILESTONE AND WE MISS YOU, THE GYM'S SETTINGS AND A MEMBER'S SWITCHES —
// against real Postgres (spec Part 3 §16.2; ROADMAP 20b-i). DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: "We miss you" or "Happy birthday"
// reaching somebody the gym removed, somebody who switched it off, or the same person
// twice. That is the first test below.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { GymInboxResponse, GymMessageSettingsRequest, GymMessageSettingsResponse } from "@app/shared";
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
  JWT_SECRET: "gym-automatic-test-secret-0123456789abc", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 120_000;
const LIVE_PLAN = "zz_auto_msg_live";
/** Friday 9 October 2026, noon in Kolkata. */
const NOON = new Date("2026-10-09T06:30:00Z");
const TODAY = "2026-10-09";
const minutes = (from: Date, n: number): Date => new Date(from.getTime() + n * 60_000);
const days = (from: Date, n: number): Date => minutes(from, n * 24 * 60);
/** The gym's calendar day `n` days from today. */
const day = (n: number): string => days(new Date(`${TODAY}T00:00:00Z`), n).toISOString().slice(0, 10);

let ipCounter = 0;
const nextIp = () => `10.89.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("the automatic messages, the gym's settings and a member's switches (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  let clock = NOON;
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'auto-t-%@example.com')`;
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'auto-t-%@example.com'`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_member_messages WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_messages_off WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_message_settings WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_attendance WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM user_fitness_profiles WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM one_time_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM refresh_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM consent_log WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM users WHERE email LIKE 'auto-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST" | "PUT", path: string, cookies: Cookies, payload?: unknown, remoteAddress: string = nextIp()) =>
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
    const email = `auto-t-${uniq()}@example.com`;
    const reg = await inject("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await inject("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };
  /** Somebody who never signs in during the test. */
  const account = async (displayName: string): Promise<Person> => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO users (email, display_name) VALUES (${`auto-t-p-${uniq()}@example.com`}, ${displayName}) RETURNING id`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("no user");
    return { userId: id, cookies: {} };
  };

  interface Gym {
    id: string;
    name: string;
    owner: Person;
  }
  const makeGym = async (name: string, plan = true): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await inject("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Jorhat", country: "IN", timezone: "Asia/Kolkata" });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    if (plan) {
      await sql`
        INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
        VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    }
    return { id, name, owner };
  };
  const onStaff = async (gym: Gym, name: string, role: "manager" | "trainer", privileges: string[] | null = null): Promise<Person> => {
    const person = await signedIn(name);
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${person.userId}, ${role}, ${privileges})`;
    return person;
  };

  const record = async (gym: Gym, fullName: string, born: string | null = null): Promise<string> => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO gym_member_list_entries (gym_id, full_name, email, identity_key, source, date_of_birth)
      VALUES (${gym.id}, ${fullName}, ${`auto-r-${uniq()}@example.com`}, encode(sha256(${`auto-${uniq()}`}::bytea), 'hex'), 'typed', ${born})
      RETURNING id`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("no record");
    return id;
  };
  interface Member extends Person {
    entryId: string;
  }
  /** Somebody on the gym's list and in its app, who joined two months ago. `signs`: they
   *  sign in during the test. */
  const member = async (gym: Gym, name: string, opts: { born?: string | null; signs?: boolean; joinedAt?: Date } = {}): Promise<Member> => {
    const entryId = await record(gym, name, opts.born ?? null);
    const person = opts.signs === true ? await signedIn(name) : await account(name);
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id, joined_at) VALUES (${gym.id}, ${person.userId}, ${entryId}, ${opts.joinedAt ?? days(NOON, -60)})`;
    return { ...person, entryId };
  };
  /** Removed from the app, as the console's Remove leaves the row. */
  const remove = async (gym: Gym, who: Member, at: Date = minutes(NOON, -10)): Promise<void> => {
    await sql`UPDATE gym_members SET removed_at = ${at}, entry_id = NULL, removed_entry_id = ${who.entryId} WHERE gym_id = ${gym.id} AND user_id = ${who.userId} AND removed_at IS NULL`;
  };
  /** A visit staff checked in on that day of the gym's calendar. `who` null: somebody who
   *  is not in the app at all. */
  const visit = async (gym: Gym, who: Member | null, on: string, how: "hours_unset" | "added_later" = "hours_unset"): Promise<void> => {
    const entryId = who === null ? await record(gym, `Walk In ${uniq()}`) : who.entryId;
    await sql`
      INSERT INTO gym_attendance (gym_id, user_id, entry_id, marked_by_user_id, day, method, hours_status, slot_key, marked_at)
      VALUES (${gym.id}, ${who?.userId ?? null}, ${entryId}, ${gym.owner.userId}, ${on}::date, 'staff', ${how}, ${how}, ${`${on}T05:00:00Z`}::timestamptz)`;
  };
  /** The desk in use: somebody not in the app checked in on each of these days. */
  const deskOpen = async (gym: Gym, from: number, to: number): Promise<void> => {
    const desk = await record(gym, `Desk Regular ${uniq()}`);
    for (let n = from; n <= to; n += 1) {
      await sql`
        INSERT INTO gym_attendance (gym_id, user_id, entry_id, marked_by_user_id, day, method, hours_status, slot_key, marked_at)
        VALUES (${gym.id}, NULL, ${desk}, ${gym.owner.userId}, ${day(n)}::date, 'staff', 'hours_unset', 'hours_unset', ${`${day(n)}T04:00:00Z`}::timestamptz)`;
    }
  };

  const log = { info: () => undefined, error: () => undefined };
  /** The sending step as the worker makes it, looking only at these gyms: other tests
   *  share the database. Everybody in a gym is read at its first run of a day only. */
  const workerRun = (gyms: readonly Gym[], now: Date = clock) => sendDueMessages({ sql, log }, { now, gymIds: gyms.map((g) => g.id) });
  /** A run that reads everybody, as the day's first does. */
  const run = async (gyms: readonly Gym[], now: Date = clock) => {
    await sql`DELETE FROM gym_message_days WHERE gym_id = ANY(${gyms.map((g) => g.id)}::uuid[])`;
    return await workerRun(gyms, now);
  };
  const sentTo = async (gym: Gym): Promise<{ user_id: string; kind: string; occasion: string; body: string }[]> =>
    await sql`
      SELECT user_id, kind, occasion, body FROM gym_member_messages WHERE gym_id = ${gym.id} ORDER BY sent_at, kind, user_id`;
  const got = async (gym: Gym): Promise<string[]> => (await sentTo(gym)).map((r) => `${r.user_id} ${r.kind}`).sort();

  const settingsPath = (gym: Gym) => `/v1/orgs/${gym.id}/message-settings`;
  const START: GymMessageSettingsRequest = {
    messages: [
      { kind: "welcome", on: true, ownLine: null },
      { kind: "birthday", on: true, ownLine: null },
      { kind: "milestone", on: true, ownLine: null },
      { kind: "miss_you", on: true, ownLine: null },
    ],
    missYouDays: 10,
    milestones: [50, 100],
  };
  const withKind = (kind: string, change: { on?: boolean; ownLine?: string | null }, over: Partial<GymMessageSettingsRequest> = {}): GymMessageSettingsRequest => ({
    ...START,
    ...over,
    messages: START.messages.map((m) => (m.kind === kind ? { ...m, ...change } : m)),
  });
  const save = async (gym: Gym, body: unknown, who: Person = gym.owner) => await inject("PUT", settingsPath(gym), who.cookies, body);
  const saved = async (gym: Gym, body: GymMessageSettingsRequest): Promise<GymMessageSettingsResponse> => {
    const res = await save(gym, body);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as GymMessageSettingsResponse;
  };
  const switchOff = async (gym: Gym, who: Person, kind: string, on = false) => await inject("PUT", `/v1/orgs/${gym.id}/inbox/switches`, who.cookies, { kind, on });
  const inbox = async (gym: Gym, who: Person): Promise<GymInboxResponse> => {
    const res = await inject("GET", `/v1/orgs/${gym.id}/inbox`, who.cookies);
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
    "THE WORST THING: a birthday and a long absence reach only the live member they are about, never somebody removed, former, deleted, switched off or next door, and never twice",
    async () => {
      clock = NOON;
      const gym = await makeGym("Auto Iron House");
      const next = await makeGym("Auto Next Door");
      await deskOpen(gym, -20, 0);
      await deskOpen(next, -20, 0);

      // Everybody below was born on 9 October, or last came in twelve days ago.
      const maya = await member(gym, "Maya Rao", { born: "1990-10-09" });
      const rex = await member(gym, "Rex Removed", { born: "1991-10-09", joinedAt: days(NOON, -1) });
      await remove(gym, rex);
      const fay = await member(gym, "Fay Former", { born: "1992-10-09" });
      await sql`UPDATE gym_member_list_entries SET former_at = ${NOON} WHERE id = ${fay.entryId}`;
      const del = await member(gym, "Del Deleted", { born: "1993-10-09" });
      await sql`UPDATE users SET deleted_at = ${NOON}, status = 'deleted' WHERE id = ${del.userId}`;
      const omar = await member(gym, "Omar Off", { born: "1994-10-09", signs: true });
      expect((await switchOff(gym, omar, "birthday")).statusCode).toBe(200);
      const ned = await member(next, "Ned Nextdoor", { born: "1995-10-09" });

      const mia = await member(gym, "Mia Missed");
      await visit(gym, mia, day(-12));
      const mo = await member(gym, "Mo Off", { signs: true });
      await visit(gym, mo, day(-12));
      expect((await switchOff(gym, mo, "miss_you")).statusCode).toBe(200);
      const rae = await member(gym, "Rae Removed", { joinedAt: days(NOON, -2) });
      await visit(gym, rae, day(-12));
      await remove(gym, rae);
      // Removed long ago and not in the read at all.
      const old = await member(gym, "Old Removed", { born: "1996-10-09" });
      await visit(gym, old, day(-12));
      await remove(gym, old);

      // Two runs at one instant, then two more.
      const both = await Promise.all([workerRun([gym, next]), workerRun([gym, next])]);
      expect(both.map((r) => r.sent).reduce((a, b) => a + b, 0)).toBe(3);
      expect((await workerRun([gym, next], minutes(NOON, 15))).sent).toBe(0);
      // And with everybody read again, twice.
      expect((await run([gym, next], minutes(NOON, 30))).sent).toBe(0);
      expect((await run([gym, next], minutes(NOON, 45))).sent).toBe(0);

      expect(await got(gym)).toEqual([`${maya.userId} birthday`, `${mia.userId} miss_you`].sort());
      expect(await got(next)).toEqual([`${ned.userId} birthday`]);
      const words = Object.fromEntries((await sentTo(gym)).map((r) => [r.kind, r.body]));
      expect(words).toEqual({
        birthday: "Happy birthday, Maya! From everyone at Auto Iron House.",
        miss_you: "We haven't seen you at Auto Iron House for a while, Mia. We hope to see you soon.",
      });
      expect((await sentTo(next))[0]?.body).toBe("Happy birthday, Ned! From everyone at Auto Next Door.");
      // The next day nobody is sent the same thing again; Omar and Mo still get nothing.
      expect((await run([gym, next], days(NOON, 1))).sent).toBe(0);
      expect((await inbox(gym, omar)).messages).toEqual([]);
      expect((await inbox(gym, mo)).messages).toEqual([]);
    },
    T,
  );

  it(
    "a birthday is read only from a date of birth a person could have: never a stand-in an export wrote, a record two accounts share, or no record",
    async () => {
      clock = NOON;
      const gym = await makeGym("Auto Birthday Gym");
      const real = await member(gym, "Bea Born", { born: "1988-10-09" });
      // Five records with one date of birth: a stand-in for "not known".
      const same = [];
      for (let n = 0; n < 5; n += 1) same.push(await member(gym, `Same Date ${String(n)}`, { born: "2000-10-09" }));
      // Excel's first day and a date not yet reached.
      await member(gym, "Excel Zero", { born: "1900-10-09" });
      await member(gym, "Not Yet Born", { born: "2027-10-09" });
      // Two accounts on one record: it is nobody's.
      const shared = await member(gym, "Shared One", { born: "1985-10-09" });
      const second = await account("Shared Two");
      await sql`INSERT INTO gym_members (gym_id, user_id, entry_id, joined_at) VALUES (${gym.id}, ${second.userId}, ${shared.entryId}, ${days(NOON, -60)})`;
      // In the app on no record.
      const loose = await account("No Record");
      await sql`INSERT INTO gym_members (gym_id, user_id, joined_at) VALUES (${gym.id}, ${loose.userId}, ${days(NOON, -60)})`;
      // Born the day before and the day after.
      await member(gym, "Day Before", { born: "1990-10-08" });
      await member(gym, "Day After", { born: "1990-10-10" });

      expect(await run([gym])).toEqual({ gyms: 1, sent: 1 });
      expect(await got(gym)).toEqual([`${real.userId} birthday`]);

      // Four records with one date are four people; the fifth makes it a stand-in.
      const four = await makeGym("Auto Four Gym");
      const born = [];
      for (let n = 0; n < 4; n += 1) born.push(await member(four, `Four ${String(n)}`, { born: "1999-10-09" }));
      expect((await run([four])).sent).toBe(4);

      // 1 January 1970, the day a computer writes for no date, on 1 January.
      const epoch = await makeGym("Auto Epoch Gym");
      await member(epoch, "Unix Zero", { born: "1970-01-01" });
      const newYear = await member(epoch, "New Year", { born: "1971-01-01" });
      expect((await run([epoch], new Date("2027-01-01T06:30:00Z"))).sent).toBe(1);
      expect(await got(epoch)).toEqual([`${newYear.userId} birthday`]);

      // 29 February, in a year without one, and once only.
      const leap = await makeGym("Auto Leap Gym");
      const leapling = await member(leap, "Lea Leap", { born: "1996-02-29" });
      expect((await run([leap], new Date("2027-02-27T06:30:00Z"))).sent).toBe(0);
      expect((await run([leap], new Date("2027-02-28T06:30:00Z"))).sent).toBe(1);
      expect((await run([leap], new Date("2027-03-01T06:30:00Z"))).sent).toBe(0);
      expect((await run([leap], new Date("2028-02-28T06:30:00Z"))).sent).toBe(0);
      expect((await run([leap], new Date("2028-02-29T06:30:00Z"))).sent).toBe(1);
      expect((await sentTo(leap)).map((r) => [r.user_id, r.occasion])).toEqual([
        [leapling.userId, "birthday:2027"],
        [leapling.userId, "birthday:2028"],
      ]);
    },
    T,
  );

  it(
    "a visit milestone: on the 50th visit day and no other, once, and not stepped over by a visit before the morning's first run",
    async () => {
      clock = NOON;
      const gym = await makeGym("Auto Milestone Gym");
      const maya = await member(gym, "Maya Rao");
      for (let n = 49; n >= 1; n -= 1) await visit(gym, maya, day(-n - 5));
      const bo = await member(gym, "Bo Lee");
      for (let n = 48; n >= 1; n -= 1) await visit(gym, bo, day(-n - 5));
      expect((await run([gym])).sent).toBe(0);

      // Two visits in one day are one visit day.
      await visit(gym, bo, TODAY);
      await sql`
        INSERT INTO gym_attendance (gym_id, user_id, entry_id, marked_by_user_id, day, method, hours_status, slot_key, marked_at)
        VALUES (${gym.id}, ${bo.userId}, ${bo.entryId}, ${gym.owner.userId}, ${TODAY}::date, 'staff', 'open_24h', 'open_24h', ${minutes(NOON, -1)})`;
      await visit(gym, maya, TODAY);
      expect((await run([gym])).sent).toBe(1);
      expect(await sentTo(gym)).toEqual([{ user_id: maya.userId, kind: "milestone", occasion: "visits:50", body: "That's 50 visits to Auto Milestone Gym, Maya. Well done." }]);
      expect((await run([gym], minutes(NOON, 15))).sent).toBe(0);

      // Bo's 50th is late tomorrow night and the 51st before the next morning's first run.
      await visit(gym, bo, day(1));
      expect((await run([gym], new Date(`${day(1)}T16:30:00Z`))).sent).toBe(0); // 22:00 in Kolkata
      await visit(gym, bo, day(2));
      expect((await run([gym], new Date(`${day(2)}T03:00:00Z`))).sent).toBe(1); // 08:30
      expect((await sentTo(gym)).filter((r) => r.user_id === bo.userId).map((r) => r.occasion)).toEqual(["visits:50"]);

      // A visit taken off and put back does not make a second 50th.
      await sql`DELETE FROM gym_attendance WHERE gym_id = ${gym.id} AND user_id = ${maya.userId} AND day = ${TODAY}::date`;
      await visit(gym, maya, day(3));
      expect((await run([gym], days(NOON, 3))).sent).toBe(0);

      // The gym's own numbers: 10 visits, saved by its owner.
      const ten = await makeGym("Auto Ten Gym");
      const tia = await member(ten, "Tia Ten");
      for (let n = 9; n >= 0; n -= 1) await visit(ten, tia, day(-n));
      expect((await run([ten])).sent).toBe(0);
      expect((await saved(ten, { ...START, milestones: [10, 25] })).milestones).toEqual([10, 25]);
      expect((await run([ten])).sent).toBe(1);
      expect((await sentTo(ten))[0]?.body).toBe("That's 10 visits to Auto Ten Gym, Tia. Well done.");
    },
    T,
  );

  it(
    "we miss you: once for each absence, after the gym's days, and never from a gym that stopped checking people in or was shut",
    async () => {
      clock = NOON;
      const gym = await makeGym("Auto Missed Gym");
      await deskOpen(gym, -30, 0);
      const mia = await member(gym, "Mia Missed");
      await visit(gym, mia, day(-10));
      const nine = await member(gym, "Nine Days");
      await visit(gym, nine, day(-9));
      const never = await member(gym, "Never Came");
      const trainer = await onStaff(gym, "Tara Trainer", "trainer");
      const tara = { ...trainer, entryId: await record(gym, "Tara Trainer") };
      await sql`INSERT INTO gym_members (gym_id, user_id, entry_id, joined_at) VALUES (${gym.id}, ${tara.userId}, ${tara.entryId}, ${days(NOON, -60)})`;
      await visit(gym, tara, day(-20));
      const ownerRecord = await record(gym, "The Owner");
      await sql`INSERT INTO gym_members (gym_id, user_id, entry_id, joined_at) VALUES (${gym.id}, ${gym.owner.userId}, ${ownerRecord}, ${days(NOON, -60)})`;
      await visit(gym, { ...gym.owner, entryId: ownerRecord }, day(-20));

      expect((await run([gym])).sent).toBe(1);
      expect(await got(gym)).toEqual([`${mia.userId} miss_you`]);
      expect(never.userId).not.toBe(mia.userId);
      // The same absence a week on: nothing more for Mia; Nine Days has theirs.
      await deskOpen(gym, 1, 7);
      expect((await run([gym], days(NOON, 7))).sent).toBe(1);
      // Mia comes back, then stays away again: a new absence, a new message.
      await visit(gym, mia, day(8));
      await deskOpen(gym, 8, 20);
      expect((await run([gym], days(NOON, 12))).sent).toBe(0);
      expect((await run([gym], days(NOON, 19))).sent).toBe(1);
      expect((await sentTo(gym)).filter((r) => r.user_id === mia.userId).map((r) => r.occasion)).toEqual([`absent:${day(-10)}`, `absent:${day(8)}`]);

      // A gym that stopped using check-in: everybody's last visit is long ago, nobody is told.
      const stopped = await makeGym("Auto Stopped Gym");
      await deskOpen(stopped, -40, -20);
      const sam = await member(stopped, "Sam Still Comes");
      await visit(stopped, sam, day(-20));
      expect((await run([stopped])).sent).toBe(0);
      // A visit staff add later for a past day does not make the desk open on it.
      for (let n = -8; n <= -1; n += 1) await visit(stopped, null, day(n), "added_later");
      expect((await run([stopped])).sent).toBe(0);

      // Shut for twelve days: the first days back, nobody is told they were missed.
      const shut = await makeGym("Auto Shut Gym");
      await deskOpen(shut, -30, -13);
      const hol = await member(shut, "Hol Holiday");
      await visit(shut, hol, day(-13));
      await deskOpen(shut, 0, 0);
      expect((await run([shut])).sent).toBe(0);
      await deskOpen(shut, 1, 4);
      expect((await run([shut], days(NOON, 4))).sent).toBe(1);

      // The gym's own days: 7.
      const seven = await makeGym("Auto Seven Gym");
      await deskOpen(seven, -30, 0);
      const sev = await member(seven, "Sev Seven");
      await visit(seven, sev, day(-7));
      expect((await run([seven])).sent).toBe(0);
      expect((await saved(seven, { ...START, missYouDays: 7 })).missYouDays).toBe(7);
      expect((await run([seven])).sent).toBe(1);
    },
    T,
  );

  it(
    "the gym's settings are its own: a stranger, next door's owner and a member read and save nothing, a trainer is refused, and nobody signed in is 401",
    async () => {
      clock = NOON;
      const gym = await makeGym("Auto Settings Gym");
      const next = await makeGym("Auto Settings Next");
      const stranger = await signedIn("Sid Stranger");
      const maya = await member(gym, "Maya Rao", { signs: true });
      const trainer = await onStaff(gym, "Tara Trainer", "trainer");
      const cutDown = await onStaff(gym, "Mina Manager", "manager", ["members.confirm"]);
      const manager = await onStaff(gym, "Max Manager", "manager", ["org.manage"]);
      const body = withKind("birthday", { on: false, ownLine: "Cake at the desk today" });

      for (const who of [stranger, next.owner, maya]) {
        const read = await inject("GET", settingsPath(gym), who.cookies);
        const write = await save(gym, body, who);
        expect([read.statusCode, write.statusCode]).toEqual([404, 404]);
        expect(read.body + write.body).not.toContain("Auto Settings Gym");
      }
      for (const who of [trainer, cutDown]) {
        expect((await inject("GET", settingsPath(gym), who.cookies)).statusCode).toBe(403);
        expect((await save(gym, body, who)).statusCode).toBe(403);
      }
      expect((await inject("GET", settingsPath(gym), {})).statusCode).toBe(401);
      expect((await save(gym, body, { userId: "", cookies: {} })).statusCode).toBe(401);
      expect(await sql`SELECT 1 FROM gym_message_settings WHERE gym_id IN (${gym.id}, ${next.id})`).toHaveLength(0);

      // The starting values, read by the owner and by a manager who holds the tick.
      const start = JSON.parse((await inject("GET", settingsPath(gym), manager.cookies)).body) as GymMessageSettingsResponse;
      expect(start).toEqual({ ...START, checkIn: false });
      // Saved, it is this gym's and not next door's; saved again it is one audit note.
      expect(await saved(gym, body)).toEqual({ ...body, checkIn: false });
      expect((await save(gym, body, manager)).statusCode).toBe(200);
      const nextNow = JSON.parse((await inject("GET", settingsPath(next), next.owner.cookies)).body) as GymMessageSettingsResponse;
      expect(nextNow).toEqual({ ...START, checkIn: false });
      const notes = await sql<{ meta: unknown }[]>`SELECT meta FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.message_settings_changed'`;
      expect(notes).toHaveLength(1);
      expect(JSON.stringify(notes)).not.toContain("Cake");
      // Check-in in the last 30 days is said.
      await deskOpen(gym, -31, -31);
      expect((JSON.parse((await inject("GET", settingsPath(gym), gym.owner.cookies)).body) as GymMessageSettingsResponse).checkIn).toBe(false);
      await deskOpen(gym, -29, -29);
      expect((JSON.parse((await inject("GET", settingsPath(gym), gym.owner.cookies)).body) as GymMessageSettingsResponse).checkIn).toBe(true);

      // A gym on no plan reads and cannot save.
      const lapsed = await makeGym("Auto Lapsed Gym", false);
      expect((await inject("GET", settingsPath(lapsed), lapsed.owner.cookies)).statusCode).toBe(200);
      expect((await save(lapsed, body)).statusCode).toBe(409);
    },
    T,
  );

  it(
    "what a gym may save: its own line with no link, no @ and no bad word, one of each kind, and only the numbers on offer",
    async () => {
      clock = NOON;
      const gym = await makeGym("Auto Save Gym");
      const refused = async (body: unknown, code: string) => {
        const res = await save(gym, body);
        expect(res.statusCode, res.body).toBe(400);
        expect((JSON.parse(res.body) as { error: string }).error).toBe(code);
      };
      await refused(withKind("welcome", { ownLine: "Book at ironhouse.com" }), "message_line_link");
      await refused(withKind("welcome", { ownLine: "Follow @ironhouse" }), "message_line_at");
      await refused(withKind("welcome", { ownLine: "x".repeat(141) }), "message_line_too_long");
      await refused({ ...START, messages: START.messages.slice(0, 3) }, "validation_error");
      await refused({ ...START, messages: [...START.messages.slice(0, 3), { kind: "welcome", on: true, ownLine: null }] }, "validation_error");
      await refused({ ...START, messages: [...START.messages.slice(0, 3), { kind: "payment_overdue", on: false, ownLine: null }] }, "validation_error");
      await refused({ ...START, missYouDays: 1 }, "validation_error");
      await refused({ ...START, milestones: [] }, "validation_error");
      await refused({ ...START, milestones: [51] }, "validation_error");
      await refused({ ...START, gymId: gym.id }, "validation_error");
      expect(await sql`SELECT 1 FROM gym_message_settings WHERE gym_id = ${gym.id}`).toHaveLength(0);

      // 140 characters, an emoji counted as one, and two lines made one.
      const line = `${"x".repeat(139)}🎂`;
      expect((await saved(gym, withKind("birthday", { ownLine: line }))).messages[1]?.ownLine).toBe(line);
      expect((await saved(gym, withKind("birthday", { ownLine: "  Cake at the desk.\nCome and get it.  " }))).messages[1]?.ownLine).toBe("Cake at the desk. Come and get it.");
      // Emptied, it is no line.
      expect((await saved(gym, withKind("birthday", { ownLine: "   " }))).messages[1]?.ownLine).toBeNull();
    },
    T,
  );

  it(
    "a kind the gym switched off is sent to nobody, and the gym's own line goes under the fixed words of its own kind only",
    async () => {
      clock = NOON;
      const gym = await makeGym("Auto Switch Gym");
      await deskOpen(gym, -20, 0);
      const bea = await member(gym, "Bea Born", { born: "1988-10-09" });
      const mia = await member(gym, "Mia Missed");
      await visit(gym, mia, day(-12));
      const neo = await member(gym, "Neo New", { joinedAt: minutes(NOON, -30) });

      await saved(gym, { ...withKind("birthday", { on: false }), messages: START.messages.map((m) => (m.kind === "birthday" ? { ...m, on: false } : m.kind === "miss_you" ? { ...m, ownLine: "Your first class back is on us." } : m)) });
      expect((await run([gym])).sent).toBe(2);
      const rows = await sentTo(gym);
      expect(rows.map((r) => `${r.user_id} ${r.kind}`).sort()).toEqual([`${mia.userId} miss_you`, `${neo.userId} welcome`].sort());
      expect(rows.find((r) => r.kind === "miss_you")?.body).toBe("We haven't seen you at Auto Switch Gym for a while, Mia. We hope to see you soon.\nYour first class back is on us.");
      expect(rows.find((r) => r.kind === "welcome")?.body).toBe("Welcome to Auto Switch Gym, Neo. We're glad you joined. Messages from us will show up here.");

      // Switched back on the same day, the birthday still goes: a save has the worker's
      // next run read everybody again. Without one it would wait for tomorrow.
      expect((await workerRun([gym], minutes(NOON, 10))).sent).toBe(0);
      await saved(gym, START);
      expect((await workerRun([gym], minutes(NOON, 15))).sent).toBe(1);
      expect((await sentTo(gym)).filter((r) => r.user_id === bea.userId).map((r) => r.kind)).toEqual(["birthday"]);
    },
    T,
  );

  it(
    "everybody is read once a day, at the first run inside the day's hours; later runs that day read only those who just joined",
    async () => {
      const gym = await makeGym("Auto Once Gym");
      await deskOpen(gym, -20, 1);
      const bea = await member(gym, "Bea Born", { born: "1988-10-09" });
      const mia = await member(gym, "Mia Missed");
      await visit(gym, mia, day(-9));
      const read = async () => (await sql<{ day: string }[]>`SELECT day::text AS day FROM gym_message_days WHERE gym_id = ${gym.id}`).map((r) => r.day);

      // 07:30 in Kolkata: asleep, nobody is read and the day is not marked.
      expect((await workerRun([gym], new Date("2026-10-09T02:00:00Z"))).sent).toBe(0);
      expect(await read()).toEqual([]);
      // 08:04: the day's read. Bea's birthday goes.
      const morning = new Date("2026-10-09T02:34:00Z");
      expect((await workerRun([gym], morning)).sent).toBe(1);
      expect(await read()).toEqual([TODAY]);
      // Later that day somebody else's date of birth is typed in: not read again today.
      const late = await member(gym, "Lat Late", { born: "1991-10-09" });
      expect((await workerRun([gym], minutes(morning, 15))).sent).toBe(0);
      // Somebody who joins that afternoon is welcomed the same day.
      const neo = await member(gym, "Neo New", { joinedAt: minutes(NOON, -5) });
      expect((await workerRun([gym], NOON)).sent).toBe(1);
      expect(await got(gym)).toEqual([`${bea.userId} birthday`, `${neo.userId} welcome`].sort());
      // The next morning everybody is read again: Mia has now been away ten days.
      expect((await workerRun([gym], days(morning, 1))).sent).toBe(1);
      expect(await read()).toEqual([day(1)]);
      expect(await got(gym)).toEqual([`${bea.userId} birthday`, `${mia.userId} miss_you`, `${neo.userId} welcome`].sort());
      expect(late.userId).not.toBe(bea.userId);

      // A run that fails does not mark the day: the next one reads everybody again.
      const broken = await makeGym("Auto Broken Gym");
      const bo = await member(broken, "Bo Born", { born: "1989-10-09" });
      // Its name is too long for a message to hold, so the write is refused.
      await sql`UPDATE gyms SET name = repeat('x', 490) WHERE id = ${broken.id}`;
      await expect(workerRun([broken], morning)).rejects.toThrow("member messages failed for 1 of 1 gyms");
      await sql`UPDATE gyms SET name = 'Auto Broken Gym' WHERE id = ${broken.id}`;
      expect(await sql`SELECT 1 FROM gym_message_days WHERE gym_id = ${broken.id}`).toHaveLength(0);
      expect((await workerRun([broken], minutes(morning, 15))).sent).toBe(1);
      expect(await got(broken)).toEqual([`${bo.userId} birthday`]);
    },
    T,
  );

  it(
    "a member's switches are their own, for one gym: nobody else sets them, a kind with no switch is refused, and off holds only that kind there",
    async () => {
      clock = NOON;
      const gym = await makeGym("Auto Member Gym");
      const other = await makeGym("Auto Member Other");
      await deskOpen(gym, -20, 0);
      await deskOpen(other, -20, 0);
      const maya = await member(gym, "Maya Rao", { born: "1990-10-09", signs: true });
      const mayaThere = await record(other, "Maya Rao", "1990-10-09");
      await sql`INSERT INTO gym_members (gym_id, user_id, entry_id, joined_at) VALUES (${other.id}, ${maya.userId}, ${mayaThere}, ${days(NOON, -60)})`;
      const stranger = await signedIn("Sid Stranger");
      const gone = await member(gym, "Rex Removed", { signs: true });
      await remove(gym, gone);

      expect((await inbox(gym, maya)).off).toEqual([]);
      for (const who of [stranger, other.owner, gone]) expect((await switchOff(gym, who, "birthday")).statusCode).toBe(404);
      expect((await switchOff(gym, { userId: "", cookies: {} }, "birthday")).statusCode).toBe(401);
      for (const kind of ["welcome", "payment_overdue", "group", "advert"]) expect((await switchOff(gym, maya, kind)).statusCode).toBe(400);
      expect(await sql`SELECT 1 FROM gym_member_messages_off WHERE gym_id = ${gym.id}`).toHaveLength(0);

      // Off twice is off once; it is said in her inbox for this gym and not the other.
      expect(JSON.parse((await switchOff(gym, maya, "birthday")).body)).toEqual({ off: ["birthday"] });
      expect(JSON.parse((await switchOff(gym, maya, "birthday")).body)).toEqual({ off: ["birthday"] });
      expect(JSON.parse((await switchOff(gym, maya, "miss_you")).body)).toEqual({ off: ["birthday", "miss_you"] });
      expect((await inbox(gym, maya)).off).toEqual(["birthday", "miss_you"]);
      expect((await inbox(other, maya)).off).toEqual([]);
      expect((await inbox(gym, maya)).groupMessages).toBe(true);

      // Her birthday: the other gym's goes, this gym's does not.
      expect((await run([gym, other])).sent).toBe(1);
      expect(await got(gym)).toEqual([]);
      expect(await got(other)).toEqual([`${maya.userId} birthday`]);
      // Back on, it goes.
      expect(JSON.parse((await switchOff(gym, maya, "birthday", true)).body)).toEqual({ off: ["miss_you"] });
      expect((await run([gym, other], minutes(NOON, 15))).sent).toBe(1);
      expect(await got(gym)).toEqual([`${maya.userId} birthday`]);
    },
    T,
  );

  it(
    "the settings' own allowance at one address is counted a gym at a time: one gym's staff cannot use up another's",
    async () => {
      clock = NOON;
      const gym = await makeGym("Auto Limit Gym");
      const next = await makeGym("Auto Limit Next");
      const ip = "10.90.1.1";
      // 600 an hour for one address at one gym: 600 are counted for this gym's.
      for (let i = 0; i < 600; i += 1) await redis.incrWithTtl(`rl:orgs_message_settings:ip:${gym.id}:${ip}`, 3600);
      expect((await inject("GET", settingsPath(gym), gym.owner.cookies, undefined, ip)).statusCode).toBe(429);
      expect((await inject("GET", settingsPath(next), next.owner.cookies, undefined, ip)).statusCode).toBe(200);
      // A stranger's 404 is never a 429.
      expect((await inject("GET", settingsPath(gym), next.owner.cookies, undefined, ip)).statusCode).toBe(404);
    },
    T,
  );
});
