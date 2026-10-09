// ONLINE CLASSES, AND STAFF TAKING ONE PERSON OFF A CLASS — the routes against real
// Postgres (DATABASE_URL-gated), on two api instances over one database. Spec Part 3
// §13.3, §13.4; ROADMAP 17g.
//
// The worst thing this job could do to a real person: somebody who is not booked is sent
// the link and walks into a gym's private video class. That is the first test. The
// second worst: staff take one person off a class and somebody else loses their place,
// or the pack never has its class back.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { ClassBookingView, ClassSessionBookingsResponse, GymClassWeekResponse, GymClassesResponse, MemberClassesResponse } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { markEndedClasses } from "../src/modules/orgs/classes/attendance.js";
import { onlineFor } from "../src/modules/orgs/classes/bookingsService.js";
import { fillClassSessions } from "../src/modules/orgs/classes/fill.js";
import { createIoRedis, createMemoryRedis, type RedisLike } from "../src/redis.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "class-online-routes-secret-0123456789ab", // dummy test value, gitleaks:allow
  CHECKIN_PASS_SECRET: "class-online-pass-secret-0123456789abcd", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 240_000;
const LIVE_PLAN = "zz_classonl_live";
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = Date.now();
/** Every class here is 45 minutes long. */
const LENGTH = 45 * MIN;
// Not real rooms. Each test's link is its own, so a body can be searched for it.
const linkFor = (what: string): string => `https://us02web.zoom.us/j/8${String(Date.now())}?pwd=${what}`;

let ipCounter = 0;
const nextIp = () => `10.92.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
const redisUrl = process.env["TEST_REDIS_URL"];
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("online classes, and staff taking a person off a class (real Postgres, two api instances)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 6 });
  let clock = T0;
  let app: App | undefined;
  let second: App | undefined;
  let redis: RedisLike | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const other = (): App => second ?? api();

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'classonl-t-%@example.com')`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_attendance WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_bookings WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_schedules WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'classonl-t-%@example.com' OR email LIKE 'classonl-b-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, cookies: Cookies, payload?: unknown, opts: { ip?: string; target?: App } = {}) =>
    (opts.target ?? api()).inject({
      method,
      url: path,
      remoteAddress: opts.ip ?? nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });

  interface Person {
    userId: string;
    cookies: Cookies;
    name: string;
  }
  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `classonl-t-${uniq()}@example.com`;
    const reg = await inject("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await inject("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login), name: displayName };
  };

  interface Gym {
    id: string;
    owner: Person;
  }
  const makeGym = async (name: string): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await inject("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Leeds", country: "GB", timezone: "Europe/London" });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return { id, owner };
  };
  const staff = async (gym: Gym, name: string, role: "trainer" | "manager"): Promise<Person> => {
    const person = await signedIn(name);
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${person.userId}, ${role}, ${null})`;
    return person;
  };
  type Member = Person & { entryId: string };
  /** A member of the app with a record of their own on the gym's list. */
  const member = async (gym: Gym, name: string): Promise<Member> => {
    const person = await signedIn(name);
    const res = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName: name, email: `classonl-l-${uniq()}@example.com` });
    expect(res.statusCode, res.body).toBe(201);
    const entryId = (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
    await sql`INSERT INTO gym_members (gym_id, user_id, joined_at, entry_id) VALUES (${gym.id}, ${person.userId}, '2026-01-01T00:00:00Z', ${entryId})`;
    return { ...person, entryId };
  };

  /** A 45-minute class that starts at `startsAt`, in a class type of its own. */
  const classAt = async (gym: Gym, startsAt: number, over: { places?: number | null; coach?: string; link?: string | null; online?: boolean } = {}): Promise<string> => {
    const [type] = await sql<{ id: string }[]>`
      INSERT INTO gym_class_types (gym_id, name, minutes, places, colour, open_gym)
      VALUES (${gym.id}, ${`Yoga ${uniq()}`}, 45, ${over.places ?? null}, 'blue', false)
      RETURNING id`;
    if (type === undefined) throw new Error("no class type");
    const at = new Date(startsAt);
    const online = over.online ?? over.link !== undefined;
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_class_sessions (gym_id, class_type_id, local_date, local_start_minute, starts_at, minutes, places, coach_user_id, status, online, online_link)
      SELECT ${gym.id}, ${type.id}, l::date, (EXTRACT(HOUR FROM l) * 60 + EXTRACT(MINUTE FROM l))::int, ${at}, 45, ${over.places ?? null},
             ${over.coach ?? null}, 'scheduled', ${online}, ${over.link ?? null}
      FROM (SELECT ${at}::timestamptz AT TIME ZONE 'Europe/London' AS l) x
      RETURNING id`;
    if (row === undefined) throw new Error("no class");
    return row.id;
  };

  const bookingUrl = (gym: Gym, sessionId: string) => `/v1/orgs/${gym.id}/class-sessions/${sessionId}/booking`;
  const bookRaw = (gym: Gym, who: Person, sessionId: string, joinWaitlist = false, target = api()) =>
    inject("POST", bookingUrl(gym, sessionId), who.cookies, { requestKey: randomUUID(), joinWaitlist }, { target });
  const book = async (gym: Gym, who: Person, sessionId: string, joinWaitlist = false): Promise<ClassBookingView> => {
    const res = await bookRaw(gym, who, sessionId, joinWaitlist);
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { booking: ClassBookingView }).booking;
  };
  const cancel = (gym: Gym, who: Person, sessionId: string, lateOk = false, target = api()) =>
    inject("POST", `${bookingUrl(gym, sessionId)}/cancel`, who.cookies, { lateOk }, { target });
  const seenRaw = (gym: Gym, who: Person, sessionId: string, target = api()) => inject("GET", bookingUrl(gym, sessionId), who.cookies, undefined, { target });
  const seen = async (gym: Gym, who: Person, sessionId: string): Promise<ClassBookingView> => {
    const res = await seenRaw(gym, who, sessionId);
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { booking: ClassBookingView }).booking;
  };
  const weekRaw = (gym: Gym, who: Person, target = api()) => inject("GET", `/v1/orgs/${gym.id}/member-classes`, who.cookies, undefined, { target });
  /** [status, still charged to a pack] of this person's newest booking of the class. */
  const placeOf = async (sessionId: string, who: { userId: string }): Promise<[string, boolean]> => {
    const rows = await sql<{ status: string; pack_charged: boolean }[]>`
      SELECT status, pack_charged FROM gym_class_bookings WHERE session_id = ${sessionId} AND user_id = ${who.userId} ORDER BY seq DESC LIMIT 1`;
    const row = rows[0];
    if (row === undefined) throw new Error("no booking");
    return [row.status, row.pack_charged];
  };
  const statusOf = async (sessionId: string, who: { userId: string }): Promise<string> => (await placeOf(sessionId, who))[0];
  const bookingId = async (sessionId: string, who: { userId: string }): Promise<string> => {
    const rows = await sql<{ id: string }[]>`SELECT id FROM gym_class_bookings WHERE session_id = ${sessionId} AND user_id = ${who.userId} ORDER BY seq DESC LIMIT 1`;
    const row = rows[0];
    if (row === undefined) throw new Error("no booking");
    return row.id;
  };

  /** A 10-class pack on the gym's price list, held by these people. */
  const packFor = async (gym: Gym, people: readonly Member[]): Promise<Map<string, string>> => {
    const [type] = await sql<{ id: string }[]>`
      INSERT INTO gym_membership_types
        (gym_id, name, kind, price_minor, currency, term_count, term_unit, pack_classes, pack_days, access, covers_all_classes)
      VALUES (${gym.id}, '10 classes', 'pack', 9000, 'GBP', NULL, NULL, 10, 60, 'all_classes', true)
      RETURNING id`;
    if (type === undefined) throw new Error("no type");
    const held = new Map<string, string>();
    for (const who of people) {
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO gym_held_memberships
          (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit, pack_classes, pack_days,
           classes_left, starts_on, status, renews)
        VALUES (${gym.id}, ${who.entryId}, ${type.id}, gen_random_uuid(), 'pack', 9000, 'GBP', NULL, NULL, 10, 60, 10,
                (now() AT TIME ZONE 'Europe/London')::date - 1, 'active', false)
        RETURNING id`;
      if (row === undefined) throw new Error("no pack");
      held.set(who.userId, row.id);
    }
    return held;
  };
  const classesLeft = async (heldId: string | undefined): Promise<number | null> =>
    heldId === undefined ? null : ((await sql<{ classes_left: number | null }[]>`SELECT classes_left FROM gym_held_memberships WHERE id = ${heldId}`)[0]?.classes_left ?? null);

  const removeRaw = (gym: Gym, sessionId: string, booking: string, by: Person = gym.owner, opts: { ip?: string; target?: App } = {}) =>
    inject("POST", `/v1/orgs/${gym.id}/class-sessions/${sessionId}/bookings/${booking}/remove`, by.cookies, undefined, opts);
  const errorOf = (res: { body: string }): string => (JSON.parse(res.body) as { error: string }).error;
  const no = (res: { statusCode: number; body: string }): string => `${String(res.statusCode)} ${errorOf(res)}`;
  const listRaw = (gym: Gym, sessionId: string, by: Person = gym.owner) => inject("GET", `/v1/orgs/${gym.id}/class-sessions/${sessionId}/bookings`, by.cookies);
  const listOf = async (gym: Gym, sessionId: string, by: Person = gym.owner): Promise<ClassSessionBookingsResponse> => {
    const res = await listRaw(gym, sessionId, by);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as ClassSessionBookingsResponse;
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    redis = redisUrl === undefined || redisUrl === "" ? createMemoryRedis() : createIoRedis(redisUrl);
    for (let tries = 0; (await redis.incrWithTtl(`classonl-ready:${randomUUID()}`, 30)) === null; tries++) {
      if (tries === 100) throw new Error("the Redis at TEST_REDIS_URL never connected");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const overrides = { redis, orgs: { now: () => new Date(clock) } };
    app = await buildApp(loadConfig(baseEnv), overrides);
    await api().ready();
    second = await buildApp(loadConfig(baseEnv), overrides);
    await second.ready();
  }, T);

  afterAll(async () => {
    await app?.close();
    await second?.close();
    await cleanup();
    await sql.end();
  }, T);

  it("only somebody who holds a place is sent the link, and only from 30 minutes before the class until it ends", async () => {
    clock = T0;
    const LINK = linkFor("worst");
    const gym = await makeGym("Link House");
    const elsewhere = await makeGym("Other House");
    const lapsed = await makeGym("Lapsed House");
    const start = T0 + 3 * HOUR;
    const opens = start - 30 * MIN;
    const end = start + LENGTH;
    const cls = await classAt(gym, start, { places: 4, link: LINK });
    // A class at another gym and one at a gym on no plan, each online with the same link.
    const theirs = await classAt(elsewhere, start, { link: LINK });
    const lapsedClass = await classAt(lapsed, start, { link: LINK });

    const booked = await member(gym, "Bea Booked");
    const came = await member(gym, "Cam Came");
    const missed = await member(gym, "Mona Missed");
    const left = await member(gym, "Liam Left");
    const gaveUp = await member(gym, "Cara Cancelled");
    const waiting = await member(gym, "Wes Waiting");
    const never = await member(gym, "Nia Never");
    const outsider = await member(elsewhere, "Otto Other");
    const stranger = await signedIn("Sam Stranger");
    const onNoPlan = await member(lapsed, "Lena Lapsed");
    await sql`INSERT INTO gym_class_bookings (gym_id, session_id, user_id, entry_id, request_key, status, created_at, booked_at)
              VALUES (${lapsed.id}, ${lapsedClass}, ${onNoPlan.userId}, ${onNoPlan.entryId}, gen_random_uuid(), 'booked', now(), now())`;

    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${lapsed.id}`;

    await book(gym, gaveUp, cls);
    expect((await cancel(gym, gaveUp, cls)).statusCode).toBe(200);
    await book(gym, booked, cls);
    await book(gym, left, cls);
    // Two places already marked: came (a check-in before the class) and no-show (staff, during it).
    await book(gym, came, cls);
    await book(gym, missed, cls);
    await sql`UPDATE gym_class_bookings SET status = 'attended' WHERE session_id = ${cls} AND user_id = ${came.userId}`;
    await sql`UPDATE gym_class_bookings SET status = 'no_show' WHERE session_id = ${cls} AND user_id = ${missed.userId}`;
    expect((await book(gym, waiting, cls, true)).mine?.status).toBe("waitlisted");
    // Liam's membership of the gym ends with his place still on the class's row.
    await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${gym.id} AND user_id = ${left.userId}`;
    expect(await statusOf(cls, left)).toBe("booked");

    const everyone: [Person, Gym, string][] = [
      [booked, gym, cls],
      [came, gym, cls],
      [missed, gym, cls],
      [left, gym, cls],
      [gaveUp, gym, cls],
      [waiting, gym, cls],
      [never, gym, cls],
      [outsider, gym, cls],
      [stranger, gym, cls],
      [outsider, elsewhere, theirs],
      [onNoPlan, lapsed, lapsedClass],
    ];
    const times: [string, number][] = [
      ["three hours before", T0],
      ["a millisecond before it shows", opens - 1],
      ["the moment it shows", opens],
      ["at the start", start],
      ["the last millisecond", end - 1],
      ["the moment it ends", end],
      ["a day after", end + DAY],
    ];
    for (const [when, at] of times) {
      clock = at;
      const inside = at >= opens && at < end;
      for (const target of [api(), other()]) {
        for (const [who, where, session] of everyone) {
          const one = await seenRaw(where, who, session, target);
          const week = await weekRaw(where, who, target);
          // The three who hold a place. Otto is booked on nothing, in his own gym or this one.
          const theirOwn = who === booked || who === came || who === missed;
          for (const res of [one, week]) {
            expect(res.body.includes(LINK), `${who.name} at ${where.id === gym.id ? "the gym" : "another gym"}, ${when}`).toBe(theirOwn && inside);
          }
          // Not a member of that gym, or the gym is on no plan: the gym is not there at all.
          if (who === left || who === stranger || where === lapsed || (who === outsider && where === gym)) {
            expect(one.statusCode).toBe(404);
            expect(week.statusCode).toBe(404);
          }
        }
      }
      const mine = (await seen(gym, booked, cls)).online;
      expect(mine, when).toEqual({ state: at >= end ? "closed" : inside ? "open" : "early", opensAt: new Date(opens).toISOString(), link: inside ? LINK : null });
      expect((await seen(gym, waiting, cls)).online?.state, when).toBe(at >= end ? "closed" : "waiting");
      expect((await seen(gym, gaveUp, cls)).online?.state, when).toBe(at >= end ? "closed" : "not_booked");
      expect((await seen(gym, never, cls)).online?.state, when).toBe(at >= end ? "closed" : "not_booked");
    }

    // The rule's own guard, on what the read would hold for somebody who stopped being a
    // member a moment after the gate let them through: a place still booked, and no link.
    const session = { id: cls, classTypeId: cls, className: "x", openGym: false, localDate: "2026-01-01", localStartMinute: 0, startsAt: new Date(start), minutes: 45, places: 4, cancelled: false, coachUserId: null, online: true, onlineLink: LINK };
    const kept = { id: cls, seq: 1, sessionId: cls, userId: left.userId, status: "booked" as const, heldMembershipId: null, packCharged: false };
    expect(onlineFor({ session, booker: { entryId: null }, latest: kept }, new Date(start))).toMatchObject({ state: "open", link: LINK });
    expect(onlineFor({ session, booker: null, latest: kept }, new Date(start))).toMatchObject({ state: "not_booked", link: null });

    // Under way, the class is still on Bea's list, with her link; it is on nobody else's.
    clock = start + 10 * MIN;
    const onList = async (who: Person): Promise<boolean> =>
      (JSON.parse((await weekRaw(gym, who)).body) as MemberClassesResponse).classes.some((c) => c.sessionId === cls);
    expect(await onList(booked)).toBe(true);
    expect(await onList(waiting)).toBe(false);
    expect(await onList(never)).toBe(false);
    // Staff cancel it while it runs: it is on no list, and the link is nobody's.
    await sql`UPDATE gym_class_sessions SET status = 'cancelled' WHERE id = ${cls}`;
    expect(await onList(booked)).toBe(false);
    expect((await seenRaw(gym, booked, cls)).body).not.toContain(LINK);
    await sql`UPDATE gym_class_sessions SET status = 'scheduled' WHERE id = ${cls}`;
    expect(await onList(booked)).toBe(true);
    clock = end;
    expect(await onList(booked)).toBe(false);
  });

  it("an online class that runs over the gym's midnight stays on its member's list, with the link, until it ends", async () => {
    const LINK = linkFor("midnight");
    const gym = await makeGym("Midnight House");
    // Tomorrow, 23:30 to 00:15 on the gym's own clock.
    const [at] = await sql<{ start: Date }[]>`
      SELECT (((now() AT TIME ZONE 'Europe/London')::date + 1 + time '23:30') AT TIME ZONE 'Europe/London') AS start`;
    if (at === undefined) throw new Error("no start");
    const start = at.start.getTime();
    clock = start - HOUR;
    const cls = await classAt(gym, start, { link: LINK });
    const who = await member(gym, "Nell Night");
    const other = await member(gym, "Ola Other");
    await book(gym, who, cls);
    const onList = async (p: Person): Promise<boolean> => {
      const res = await weekRaw(gym, p);
      const has = (JSON.parse(res.body) as MemberClassesResponse).classes.some((c) => c.sessionId === cls);
      expect(res.body.includes(LINK)).toBe(has && p === who && clock >= start - 30 * MIN);
      return has;
    };
    for (const [minute, mine] of [
      [-60, true],
      [20, true],
      [29, true],
      // Past midnight: the gym's today is the day after the class's own.
      [31, true],
      [44, true],
      [45, false],
    ] as const) {
      clock = start + minute * MIN;
      expect(await onList(who), String(minute)).toBe(mine);
      // Somebody not booked sees it only while it can still be booked.
      expect(await onList(other), String(minute)).toBe(minute < 0);
    }
  });

  it("the place staff take away, and the place the waitlist is handed, each change who is sent the link", async () => {
    clock = T0;
    const LINK = linkFor("moves");
    const gym = await makeGym("Moves House");
    const start = T0 + 3 * HOUR;
    const cls = await classAt(gym, start, { places: 1, link: LINK });
    const first = await member(gym, "Fay First");
    const next = await member(gym, "Ned Next");
    await book(gym, first, cls);
    await book(gym, next, cls, true);

    clock = start - 20 * MIN;
    expect((await seen(gym, first, cls)).online?.link).toBe(LINK);
    expect((await seen(gym, next, cls)).online).toMatchObject({ state: "waiting", link: null });

    // Staff take Fay off: her next read has no link. Inside a day of the start the free
    // place is claimed, not handed over, and the link is Ned's once he has claimed it.
    expect((await removeRaw(gym, cls, await bookingId(cls, first))).statusCode).toBe(200);
    expect((await seen(gym, first, cls)).online).toMatchObject({ state: "not_booked", link: null });
    expect((await seenRaw(gym, first, cls)).body).not.toContain(LINK);
    expect((await seen(gym, next, cls)).online?.link).toBeNull();
    expect((await book(gym, next, cls)).online).toMatchObject({ state: "open", link: LINK });
  });

  it("no link yet: a booked person is told so, and staff's change of one class's link reaches them at once", async () => {
    clock = T0;
    const gym = await makeGym("Later House");
    const start = T0 + 2 * HOUR;
    const cls = await classAt(gym, start, { online: true, link: null });
    const who = await member(gym, "Mo Member");
    await book(gym, who, cls);
    clock = start - 5 * MIN;
    expect((await seen(gym, who, cls)).online).toMatchObject({ state: "no_link", link: null });

    const LINK = linkFor("late");
    const set = (body: unknown, by: Person = gym.owner, session = cls) => inject("PUT", `/v1/orgs/${gym.id}/class-sessions/${session}/online`, by.cookies, body);
    const saved = await set({ online: true, onlineLink: LINK.replace("https://", "Https://") });
    expect(saved.statusCode, saved.body).toBe(200);
    const week = JSON.parse(saved.body) as GymClassWeekResponse;
    expect(week.sessions.find((s) => s.id === cls)).toMatchObject({ online: true, onlineLink: LINK, onlineAlone: true, ended: false });
    expect((await seen(gym, who, cls)).online).toMatchObject({ state: "open", link: LINK });

    // During the class the link can still be changed (a room that failed); once it is over, no.
    clock = start + 10 * MIN;
    const NEW = linkFor("again");
    expect((await set({ online: true, onlineLink: NEW })).statusCode).toBe(200);
    expect((await seen(gym, who, cls)).online?.link).toBe(NEW);
    // Switched off: it is a class at the gym, with no link kept.
    expect((await set({ online: false, onlineLink: null })).statusCode).toBe(200);
    expect((await seen(gym, who, cls)).online).toBeNull();
    expect((await sql<{ online_link: string | null }[]>`SELECT online_link FROM gym_class_sessions WHERE id = ${cls}`)[0]?.online_link).toBeNull();
    clock = start + LENGTH;
    expect(no(await set({ online: true, onlineLink: NEW }))).toBe("409 class_ended");

    // What is refused, and who may.
    clock = T0;
    const fresh = await classAt(gym, T0 + DAY, {});
    const bad: unknown[] = [
      { online: true, onlineLink: "http://zoom.us/j/1" },
      { online: true, onlineLink: "zoom.us/j/1" },
      { online: true, onlineLink: "javascript:alert(1)" },
      { online: false, onlineLink: LINK },
      { online: true },
      { onlineLink: LINK },
      { online: true, onlineLink: LINK, startMinute: 600 },
      {},
    ];
    for (const body of bad) {
      const res = await set(body, gym.owner, fresh);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      // The refusal never repeats what was sent.
      expect(res.body).not.toContain("zoom.us");
    }
    const trainer = await staff(gym, "Tia Trainer", "trainer");
    const manager = await staff(gym, "Max Manager", "manager");
    const rival = await makeGym("Rival House");
    expect(no(await set({ online: true, onlineLink: LINK }, trainer, fresh))).toBe("403 forbidden");
    expect((await set({ online: true, onlineLink: LINK }, rival.owner, fresh)).statusCode).toBe(404);
    expect((await set({ online: true, onlineLink: LINK }, who, fresh)).statusCode).toBe(404);
    expect((await inject("PUT", `/v1/orgs/${rival.id}/class-sessions/${fresh}/online`, rival.owner.cookies, { online: true, onlineLink: LINK })).statusCode).toBe(404);
    expect((await inject("PUT", `/v1/orgs/${gym.id}/class-sessions/${fresh}/online`, {}, { online: true, onlineLink: LINK })).statusCode).toBe(401);
    expect((await sql<{ online: boolean }[]>`SELECT online FROM gym_class_sessions WHERE id = ${fresh}`)[0]?.online).toBe(false);
    expect((await set({ online: true, onlineLink: LINK }, manager, fresh)).statusCode).toBe(200);
    await sql`UPDATE gym_class_sessions SET status = 'cancelled' WHERE id = ${fresh}`;
    expect(no(await set({ online: true, onlineLink: NEW }, manager, fresh))).toBe("409 class_day_cancelled");

    // Who a change would reach, for the box that asks: this class's people who hold a place.
    const reach = await classAt(gym, T0 + 2 * DAY, { places: 1, link: LINK });
    const waits = await member(gym, "Wim Waits");
    await book(gym, who, reach);
    await book(gym, waits, reach, true);
    const affected = (by: Person, session = reach, at = gym) => inject("GET", `/v1/orgs/${at.id}/class-sessions/${session}/online`, by.cookies);
    expect(JSON.parse((await affected(gym.owner)).body)).toEqual({ classes: 1, booked: 1 });
    expect(JSON.parse((await affected(manager)).body)).toEqual({ classes: 1, booked: 1 });
    expect(no(await affected(trainer))).toBe("403 forbidden");
    expect((await affected(rival.owner)).statusCode).toBe(404);
    expect((await affected(rival.owner, reach, rival)).statusCode).toBe(404);
    expect((await affected(who)).statusCode).toBe(404);
    expect((await inject("GET", `/v1/orgs/${gym.id}/class-sessions/${reach}/online`, {})).statusCode).toBe(401);
    // Over, it changes nothing and reaches nobody.
    clock = T0 + 2 * DAY + LENGTH;
    expect(JSON.parse((await affected(gym.owner)).body)).toEqual({ classes: 0, booked: 0 });
    clock = T0;

    // The link is in no audit row.
    const logged = await sql<{ meta: unknown }[]>`SELECT meta FROM audit_log WHERE gym_id = ${gym.id}`;
    expect(logged.length).toBeGreaterThan(0);
    expect(JSON.stringify(logged)).not.toContain("zoom.us");
  });

  it("a time slot marked online: its classes carry the link, as do the ones written later and the time slot that carries on from it", async () => {
    clock = T0;
    const gym = await makeGym("Slot House");
    const LINK = linkFor("slot");
    const post = (path: string, body: unknown, by: Person = gym.owner) => inject("POST", `/v1/orgs/${gym.id}${path}`, by.cookies, body);
    const put = (path: string, body: unknown, by: Person = gym.owner) => inject("PUT", `/v1/orgs/${gym.id}${path}`, by.cookies, body);
    const made = await post("/classes", { name: "Online yoga", minutes: 45, places: 12, colour: "blue" });
    expect(made.statusCode, made.body).toBe(201);
    const typeId = (JSON.parse(made.body) as GymClassesResponse).entries[0]?.type.id ?? "";
    const today = (await sql<{ d: string }[]>`SELECT ((${new Date(clock)}::timestamptz AT TIME ZONE 'Europe/London')::date)::text AS d`)[0]?.d ?? "";
    const slotBody = { weekdays: [1, 2, 3, 4, 5, 6, 7], startMinute: 600, startsOn: today, minutes: 45, places: 12, coachUserId: null };

    // A link with no tick, and a bad link, write nothing.
    expect((await post(`/classes/${typeId}/repeats`, { ...slotBody, onlineLink: LINK })).statusCode).toBe(400);
    expect((await post(`/classes/${typeId}/repeats`, { ...slotBody, online: true, onlineLink: "http://zoom.us/j/1" })).statusCode).toBe(400);
    const added = await post(`/classes/${typeId}/repeats`, { ...slotBody, online: true, onlineLink: LINK });
    expect([200, 201], added.body).toContain(added.statusCode);
    const slot = (JSON.parse(added.body) as GymClassesResponse).entries[0]?.schedules[0];
    expect(slot).toMatchObject({ online: true, onlineLink: LINK });
    const slotId = slot?.id ?? "";

    const classes = () =>
      sql<{ id: string; local_date: string; online: boolean; online_link: string | null; online_alone: boolean; schedule_id: string; starts_at: Date }[]>`
        SELECT id, local_date::text AS local_date, online, online_link, online_alone, schedule_id, starts_at
        FROM gym_class_sessions WHERE gym_id = ${gym.id} ORDER BY starts_at`;
    const written = await classes();
    expect(written.length).toBeGreaterThan(50);
    expect(written.every((c) => c.online && c.online_link === LINK && !c.online_alone)).toBe(true);

    // The clock moves to just after the second class has ended. One later class has a link of its own.
    const [, done, , own] = written;
    if (done === undefined || own === undefined) throw new Error("too few classes");
    clock = done.starts_at.getTime() + LENGTH;
    const OWN = linkFor("own");
    expect((await put(`/class-sessions/${own.id}/online`, { online: true, onlineLink: OWN })).statusCode).toBe(200);

    // The time slot's link changes: every class still to end takes it, except the one with its own; the ended ones keep theirs.
    const NEW = linkFor("new");
    const trainer = await staff(gym, "Tom Trainer", "trainer");
    const rival = await makeGym("Rival Slots");
    expect(no(await put(`/class-repeats/${slotId}/online`, { online: true, onlineLink: NEW }, trainer))).toBe("403 forbidden");
    expect((await put(`/class-repeats/${slotId}/online`, { online: true, onlineLink: NEW }, rival.owner)).statusCode).toBe(404);
    expect((await inject("PUT", `/v1/orgs/${rival.id}/class-repeats/${slotId}/online`, rival.owner.cookies, { online: true, onlineLink: NEW })).statusCode).toBe(404);
    expect((await put(`/class-repeats/${slotId}/online`, { online: false, onlineLink: NEW })).statusCode).toBe(400);
    expect((await classes()).filter((c) => c.online_link === NEW)).toHaveLength(0);
    // Who that change would reach: every class of the time slot still to end, but the one
    // with its own link, and the bookings held on them (one person on two classes is two).
    const fan = await member(gym, "Fay Fan");
    const coming = written.filter((c) => c.starts_at.getTime() + LENGTH > clock && c.id !== own.id);
    for (const c of coming.slice(0, 2)) await book(gym, fan, c.id);
    await sql`INSERT INTO gym_class_bookings (gym_id, session_id, user_id, entry_id, request_key, status, created_at, booked_at)
              VALUES (${gym.id}, ${own.id}, ${fan.userId}, ${fan.entryId}, gen_random_uuid(), 'booked', now(), now())`;
    const reach = (by: Person, at = gym) => inject("GET", `/v1/orgs/${at.id}/class-repeats/${slotId}/online`, by.cookies);
    expect(JSON.parse((await reach(gym.owner)).body)).toEqual({ classes: coming.length, booked: 2 });
    expect(no(await reach(trainer))).toBe("403 forbidden");
    expect((await reach(rival.owner)).statusCode).toBe(404);
    expect((await reach(rival.owner, rival)).statusCode).toBe(404);
    const changed = await put(`/class-repeats/${slotId}/online`, { online: true, onlineLink: NEW });
    expect(changed.statusCode, changed.body).toBe(200);
    expect((JSON.parse(changed.body) as GymClassesResponse).entries[0]?.schedules[0]).toMatchObject({ online: true, onlineLink: NEW });
    for (const c of await classes()) {
      const ended = c.starts_at.getTime() + LENGTH <= clock;
      expect(c.online_link, c.local_date).toBe(c.id === own.id ? OWN : ended ? LINK : NEW);
    }

    // The nightly fill, the next day, writes one more class: online, with the time slot's link.
    const before = (await classes()).length;
    await fillClassSessions(sql, { gymIds: [gym.id], now: new Date(clock) });
    const after = await classes();
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1]).toMatchObject({ online: true, online_link: NEW });

    // A new length from a date splits the time slot: the one that carries on is online too, with the link.
    const fromSplit = after[10]?.local_date ?? "";
    const split = await put(`/class-repeats/${slotId}`, { updateFrom: fromSplit, weekdays: slotBody.weekdays, startMinute: 600, minutes: 60, places: 12, coachUserId: null });
    expect(split.statusCode, split.body).toBe(200);
    const slots = (JSON.parse(split.body) as GymClassesResponse).entries[0]?.schedules ?? [];
    expect(slots).toHaveLength(2);
    expect(slots.every((s) => s.online && s.onlineLink === NEW)).toBe(true);
    const later = slots.find((s) => s.id !== slotId)?.id ?? "";

    // A new start time from a date replaces the classes: the new ones are online, with the
    // link, and a class staff gave a link of its own keeps it on the class written for its date.
    const fromMove = after[20]?.local_date ?? "";
    const guest = after[25];
    if (guest === undefined) throw new Error("too few classes");
    const GUEST = linkFor("guest");
    expect((await put(`/class-sessions/${guest.id}/online`, { online: true, onlineLink: GUEST })).statusCode).toBe(200);
    const moved = await put(`/class-repeats/${later}`, { updateFrom: fromMove, weekdays: slotBody.weekdays, startMinute: 660, minutes: 60, places: 12, coachUserId: null });
    expect(moved.statusCode, moved.body).toBe(200);
    const all = await classes();
    const atEleven = all.filter((c) => c.local_date >= fromMove);
    expect(atEleven.length).toBeGreaterThan(20);
    expect(atEleven.every((c) => c.online && c.schedule_id !== later && c.schedule_id !== slotId && !written.some((w) => w.id === c.id))).toBe(true);
    for (const c of atEleven) {
      expect([c.online_link, c.online_alone], c.local_date).toEqual(c.local_date === guest.local_date ? [GUEST, true] : [NEW, false]);
    }
    expect(atEleven.some((c) => c.local_date === guest.local_date)).toBe(true);
    expect((JSON.parse(moved.body) as GymClassesResponse).entries[0]?.schedules.every((s) => s.online && s.onlineLink === NEW)).toBe(true);

    // Switched off for the first time slot: its coming classes are at the gym again, with no link kept, and the one with its own is left.
    expect((await put(`/class-repeats/${slotId}/online`, { online: false, onlineLink: null })).statusCode).toBe(200);
    for (const c of (await classes()).filter((x) => x.schedule_id === slotId && x.starts_at.getTime() + LENGTH > clock)) {
      expect([c.online, c.online_link], c.local_date).toEqual(c.id === own.id ? [true, OWN] : [false, null]);
    }
    const logged = await sql<{ meta: unknown }[]>`SELECT meta FROM audit_log WHERE gym_id = ${gym.id}`;
    expect(JSON.stringify(logged)).not.toContain("zoom.us");
  });

  it("the staff who run an online class read its link; other staff and members never do from the staff list", async () => {
    clock = T0;
    const LINK = linkFor("staff");
    const gym = await makeGym("Coach House");
    const coach = await staff(gym, "Cody Coach", "trainer");
    const otherTrainer = await staff(gym, "Tess Trainer", "trainer");
    const who = await member(gym, "Mia Member");
    const cls = await classAt(gym, T0 + DAY, { coach: coach.userId, link: LINK });
    expect(await listOf(gym, cls)).toMatchObject({ online: true, onlineLink: LINK, canRemove: true, canMark: false });
    expect(await listOf(gym, cls, coach)).toMatchObject({ online: true, onlineLink: LINK });
    for (const nobody of [otherTrainer, who]) {
      const res = await listRaw(gym, cls, nobody);
      expect([403, 404]).toContain(res.statusCode);
      expect(res.body).not.toContain(LINK);
    }
    const week = await inject("GET", `/v1/orgs/${gym.id}/class-sessions`, otherTrainer.cookies);
    expect(week.statusCode).toBe(403);
    expect(week.body).not.toContain(LINK);
  });

  it("staff take one person off a class: only that place goes, the pack has its class back, and the waitlist moves by the usual rule", async () => {
    clock = T0;
    const gym = await makeGym("Remove House");
    const rival = await makeGym("Rival Remove");
    const start = T0 + 3 * DAY;
    const cls = await classAt(gym, start, { places: 2 });
    const elsewhere = await classAt(gym, start + HOUR, { places: 2 });
    const [ann, ben, wyn, zoe] = [await member(gym, "Ann A"), await member(gym, "Ben B"), await member(gym, "Wyn W"), await member(gym, "Zoe Z")];
    const packs = await packFor(gym, [ann, ben, wyn, zoe]);
    await book(gym, ann, cls);
    await book(gym, ben, cls);
    await book(gym, wyn, cls, true);
    await book(gym, zoe, cls, true);
    await book(gym, ann, elsewhere);
    expect(await Promise.all([ann, ben, wyn, zoe].map((p) => classesLeft(packs.get(p.userId))))).toEqual([8, 9, 10, 10]);
    const annsPlace = await bookingId(cls, ann);

    // Who may not, and what is not there. Nothing moves.
    const trainer = await staff(gym, "Tyra Trainer", "trainer");
    expect(no(await removeRaw(gym, cls, annsPlace, trainer))).toBe("403 forbidden");
    expect((await removeRaw(gym, cls, annsPlace, rival.owner)).statusCode).toBe(404);
    expect((await removeRaw(gym, cls, annsPlace, ben)).statusCode).toBe(404);
    expect((await inject("POST", `/v1/orgs/${rival.id}/class-sessions/${cls}/bookings/${annsPlace}/remove`, rival.owner.cookies)).statusCode).toBe(404);
    expect((await inject("POST", `/v1/orgs/${gym.id}/class-sessions/${cls}/bookings/${annsPlace}/remove`, {})).statusCode).toBe(401);
    // Ann's place in the OTHER class, asked for under this class: not found, and it stays.
    expect(no(await removeRaw(gym, cls, await bookingId(elsewhere, ann)))).toBe("404 booking_not_found");
    expect(no(await removeRaw(gym, cls, randomUUID()))).toBe("404 booking_not_found");
    expect((await removeRaw(gym, cls, "not-an-id")).statusCode).toBe(400);
    expect(await Promise.all([ann, ben, wyn, zoe].map((p) => statusOf(cls, p)))).toEqual(["booked", "booked", "waitlisted", "waitlisted"]);

    // Ann is taken off. Her pack has the class back; three days out, the first in line has her place.
    const removed = await removeRaw(gym, cls, annsPlace);
    expect(removed.statusCode, removed.body).toBe(200);
    const list = JSON.parse(removed.body) as ClassSessionBookingsResponse;
    expect(list.booked.map((b) => b.name)).toEqual(["Ben B", "Wyn W"]);
    expect(list.waitlisted.map((b) => b.name)).toEqual(["Zoe Z"]);
    expect(list.lateCancelledTotal).toBe(0);
    expect(await placeOf(cls, ann)).toEqual(["cancelled", false]);
    expect(await Promise.all([ben, wyn, zoe].map((p) => statusOf(cls, p)))).toEqual(["booked", "booked", "waitlisted"]);
    // Ann 9 (her other class still booked), Ben 9, Wyn charged for the place handed over, Zoe untouched.
    expect(await Promise.all([ann, ben, wyn, zoe].map((p) => classesLeft(packs.get(p.userId))))).toEqual([9, 9, 9, 10]);
    expect(await statusOf(elsewhere, ann)).toBe("booked");

    // The same removal again, on either server: nothing more happens.
    for (const target of [api(), other()]) expect((await removeRaw(gym, cls, annsPlace, gym.owner, { target })).statusCode).toBe(200);
    expect(await Promise.all([ann, ben, wyn, zoe].map((p) => classesLeft(packs.get(p.userId))))).toEqual([9, 9, 9, 10]);
    expect(await Promise.all([ben, wyn, zoe].map((p) => statusOf(cls, p)))).toEqual(["booked", "booked", "waitlisted"]);

    // Somebody waiting is taken off: nobody else moves and no pack changes.
    expect((await removeRaw(gym, cls, await bookingId(cls, zoe))).statusCode).toBe(200);
    expect(await placeOf(cls, zoe)).toEqual(["cancelled", false]);
    expect(await Promise.all([ben, wyn].map((p) => statusOf(cls, p)))).toEqual(["booked", "booked"]);
    expect(await Promise.all([ann, ben, wyn, zoe].map((p) => classesLeft(packs.get(p.userId))))).toEqual([9, 9, 9, 10]);

    // One audit row a removal that happened, naming the booking and nobody's name.
    const audits = await sql<{ target_id: string; meta: Record<string, string> }[]>`
      SELECT target_id, meta FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.class_booking_removed' ORDER BY at, id`;
    expect(audits.map((a) => a.meta)).toEqual([
      { was: "booked", packGivenBack: "true" },
      { was: "waitlisted", packGivenBack: "false" },
    ]);
    expect(audits[0]?.target_id).toBe(annsPlace);

    // Ann can book again like anybody: the class is full, so she can wait.
    expect((await book(gym, ann, cls, true)).mine?.status).toBe("waitlisted");
  });

  it("a removal close to the class is never a late cancel; a place a check-in marked came is removed as booked; a started class is marked, not removed", async () => {
    clock = T0;
    const gym = await makeGym("Late House");
    const start = T0 + HOUR;
    const cls = await classAt(gym, start, { places: 5 });
    const [ann, ben, cat] = [await member(gym, "Ann Late"), await member(gym, "Ben Came"), await member(gym, "Cat Stays")];
    const packs = await packFor(gym, [ann, ben, cat]);
    for (const p of [ann, ben, cat]) await book(gym, p, cls);
    // Inside the two free hours a member's own cancel would be late and keep the pack's charge.
    expect(no(await cancel(gym, ann, cls))).toBe("409 late_cancel");
    expect((await removeRaw(gym, cls, await bookingId(cls, ann))).statusCode).toBe(200);
    expect(await placeOf(cls, ann)).toEqual(["cancelled", false]);
    expect(await classesLeft(packs.get(ann.userId))).toBe(10);

    // Ben was checked in at the gym before the class: his place reads came, and is still his to lose.
    await sql`UPDATE gym_class_bookings SET status = 'attended' WHERE id = ${await bookingId(cls, ben)}`;
    expect((await removeRaw(gym, cls, await bookingId(cls, ben))).statusCode).toBe(200);
    expect(await placeOf(cls, ben)).toEqual(["cancelled", false]);
    expect(await classesLeft(packs.get(ben.userId))).toBe(10);

    // To the millisecond: the last one before the start is removed, the start is not.
    const cats = await bookingId(cls, cat);
    clock = start;
    expect(no(await removeRaw(gym, cls, cats))).toBe("409 class_started");
    expect(await placeOf(cls, cat)).toEqual(["booked", true]);
    expect(await listOf(gym, cls)).toMatchObject({ canRemove: false, canMark: true });
    clock = start - 1;
    expect(await listOf(gym, cls)).toMatchObject({ canRemove: true, canMark: false });
    expect((await removeRaw(gym, cls, cats)).statusCode).toBe(200);
    expect(await placeOf(cls, cat)).toEqual(["cancelled", false]);
    expect(await classesLeft(packs.get(cat.userId))).toBe(10);

    // The class's own coach may; a gym on no plan may not write.
    clock = T0;
    const coach = await staff(gym, "Cy Coach", "trainer");
    const coached = await classAt(gym, T0 + DAY, { coach: coach.userId });
    await book(gym, cat, coached);
    expect(await classesLeft(packs.get(cat.userId))).toBe(9);
    // The coach is not sent what a person paid with, and the pack still has its class back.
    expect((await listOf(gym, coached, coach)).booked[0]).toMatchObject({ packCharged: null, membership: null });
    expect((await removeRaw(gym, coached, await bookingId(coached, cat), coach)).statusCode).toBe(200);
    expect(await placeOf(coached, cat)).toEqual(["cancelled", false]);
    expect(await classesLeft(packs.get(cat.userId))).toBe(10);
    // A coach taken off the class may no longer remove anybody from it.
    await book(gym, cat, coached);
    await sql`UPDATE gym_class_sessions SET coach_user_id = NULL WHERE id = ${coached}`;
    expect(no(await removeRaw(gym, coached, await bookingId(coached, cat), coach))).toBe("403 forbidden");
    expect(await statusOf(coached, cat)).toBe("booked");
    await sql`UPDATE gym_class_sessions SET coach_user_id = ${coach.userId} WHERE id = ${coached}`;
    expect((await removeRaw(gym, coached, await bookingId(coached, cat), coach)).statusCode).toBe(200);
    await book(gym, cat, coached);
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gym.id}`;
    const refused = await removeRaw(gym, coached, await bookingId(coached, cat));
    expect(refused.statusCode).toBeGreaterThanOrEqual(400);
    expect(await statusOf(coached, cat)).toBe("booked");
  });

  it("three staff at one front desk take a whole class off from one address", async () => {
    clock = T0;
    const gym = await makeGym("Desk House");
    const cls = await classAt(gym, T0 + DAY, {});
    const helpers = [gym.owner, await staff(gym, "Mel Manager", "manager"), await staff(gym, "Mo Manager", "manager")];
    const people = await sql<{ id: string }[]>`
      INSERT INTO users (display_name, email)
      SELECT 'Desk ' || n, 'classonl-b-' || ${uniq()}::text || '-' || n || '@example.com' FROM generate_series(1, 90) n
      RETURNING id`;
    const places = await sql<{ id: string }[]>`
      INSERT INTO gym_class_bookings (gym_id, session_id, user_id, request_key, status, created_at, booked_at)
      SELECT ${gym.id}, ${cls}, u, gen_random_uuid(), 'booked', now(), now() FROM unnest(${people.map((p) => p.id)}::uuid[]) u
      RETURNING id`;
    const ip = `10.93.${String(Math.floor(Math.random() * 250))}.${String(Math.floor(Math.random() * 250) + 1)}`;
    const answers: number[] = [];
    for (const [i, place] of places.entries()) {
      const by = helpers[i % helpers.length] ?? gym.owner;
      answers.push((await removeRaw(gym, cls, place.id, by, { ip, target: i % 2 === 0 ? api() : other() })).statusCode);
    }
    expect(answers.filter((s) => s !== 200)).toEqual([]);
    expect((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_class_bookings WHERE session_id = ${cls} AND status = 'cancelled'`)[0]?.n).toBe(90);
  });

  it("at one instant on two servers: staff's removal and the member's own cancel, and two removals, each give the pack its class back once", async () => {
    clock = T0;
    const gym = await makeGym("Race House");
    const [ann, wyn, zoe] = [await member(gym, "Ann Race"), await member(gym, "Wyn Race"), await member(gym, "Zoe Race")];
    const packs = await packFor(gym, [ann, wyn, zoe]);
    for (let round = 0; round < 6; round++) {
      const cls = await classAt(gym, T0 + 3 * DAY + round * HOUR, { places: 1 });
      await book(gym, ann, cls);
      await book(gym, wyn, cls, true);
      await book(gym, zoe, cls, true);
      const place = await bookingId(cls, ann);
      const both =
        round % 2 === 0
          ? [removeRaw(gym, cls, place, gym.owner, { target: api() }), cancel(gym, ann, cls, false, other())]
          : [removeRaw(gym, cls, place, gym.owner, { target: api() }), removeRaw(gym, cls, place, gym.owner, { target: other() })];
      const done = await Promise.all(both);
      expect(done.map((r) => r.statusCode), String(round)).toEqual([200, 200]);
      expect(await placeOf(cls, ann)).toEqual(["cancelled", false]);
      // One place freed, so one person moved in: the first in line, charged once.
      expect(await Promise.all([wyn, zoe].map((p) => statusOf(cls, p))), String(round)).toEqual(["booked", "waitlisted"]);
      expect(await classesLeft(packs.get(ann.userId)), String(round)).toBe(10);
      expect(await classesLeft(packs.get(wyn.userId)), String(round)).toBe(10 - (round + 1));
      expect(await classesLeft(packs.get(zoe.userId)), String(round)).toBe(10);
    }
  });

  it("an online class is never marked by a check-in at the gym, or by the run after it ends", async () => {
    clock = T0;
    const gym = await makeGym("Mark House");
    const start = T0 + 30 * MIN;
    const online = await classAt(gym, start, { link: linkFor("mark") });
    const atGym = await classAt(gym, start, {});
    const [home, here, away] = [await member(gym, "Hal Home"), await member(gym, "Hana Here"), await member(gym, "Abe Away")];
    await book(gym, home, online);
    await book(gym, here, online);
    await book(gym, here, atGym);
    await book(gym, away, atGym);
    // Hana is checked in at the gym inside both classes' hour.
    const checkedIn = await inject("POST", `/v1/orgs/${gym.id}/attendance/check-in`, gym.owner.cookies, { userId: here.userId });
    expect(checkedIn.statusCode, checkedIn.body).toBe(200);
    expect(await statusOf(atGym, here)).toBe("attended");
    expect(await statusOf(online, here)).toBe("booked");

    // The run, 15 minutes after both end, at a gym that was checking people in.
    const run = await markEndedClasses({ sql, log: { warn: () => undefined } }, new Date(start + LENGTH + 15 * MIN), [gym.id]);
    expect(run).toMatchObject({ noShows: 1 });
    expect(await statusOf(atGym, away)).toBe("no_show");
    expect(await statusOf(online, home)).toBe("booked");
    expect(await statusOf(online, here)).toBe("booked");

    // Staff mark it themselves.
    clock = start + 5 * MIN;
    const marked = await inject("POST", `/v1/orgs/${gym.id}/class-sessions/${online}/bookings/${await bookingId(online, home)}/mark`, gym.owner.cookies, { status: "attended" });
    expect(marked.statusCode, marked.body).toBe(200);
    expect(await statusOf(online, home)).toBe("attended");
  });
});
