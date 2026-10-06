// "I'M COMING" ON A GYM'S EVENT — the routes against real Postgres (DATABASE_URL-gated),
// two apis on one database. Spec Part 3 §15.4; ROADMAP 19c-ii.
//
// The worst thing this job could do to a real person: two people are both told they have
// the last place, and one is turned away at the door. That is the first test below.
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  GYM_EVENT_COMING_WORDS,
  type GymEventPeopleResponse,
  type GymEventsResponse,
  type MemberGymEvent,
  type StaffGymEvent,
  type StaffGymEventsResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDiskPhotoStore } from "../src/modules/orgs/gymPage/photoStore.js";
import { createIoRedis, createMemoryRedis, type RedisLike } from "../src/redis.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "event-coming-routes-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
type Res = Awaited<ReturnType<App["inject"]>>;

const T = 120_000;
const LIVE_PLAN = "zz_evcoming_live";
/** Wednesday 7 October 2026, 07:30 in London: ten days before the event below. */
const MORNING = new Date("2026-10-07T06:30:00Z");
/** Friday 16 October 2026, 13:00 in London: inside the event's last day. */
const DAY_BEFORE = new Date("2026-10-16T12:00:00Z");
/** Saturday 17 October 2026, 10:30 in London: the event has started. */
const STARTED = new Date("2026-10-17T09:30:00Z");
/** Saturday 17 October 2026, 14:00 in London: the event has ended. */
const ENDED = new Date("2026-10-17T13:00:00Z");

let ipCounter = 0;
const nextIp = () => `10.79.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
const redisUrl = process.env["TEST_REDIS_URL"];
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;
/** An address of this run's own for a limit test: a real Redis keeps its counters for the hour. */
const desk = (): string => {
  const hex = randomUUID().replaceAll("-", "");
  return `10.${String(100 + (parseInt(hex.slice(0, 2), 16) % 100))}.${String(parseInt(hex.slice(2, 4), 16))}.${String((parseInt(hex.slice(4, 6), 16) % 254) + 1)}`;
};
const codeOf = (res: Res): string => (JSON.parse(res.body) as { error?: string }).error ?? "";

d("\"I'm coming\" on a gym's event (real Postgres, two apis)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let folder = "";
  let clock = MORNING.getTime();
  let app: App | undefined;
  /** A second api on the same database and Redis: one api holds one line of place writes,
   *  so two requests race only across two of them. */
  let second: App | undefined;
  let redis: RedisLike | undefined;
  /** The codes "delete my account" would have emailed, by address. */
  const deleteCodes = new Map<string, string>();
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const other = (): App => {
    if (second === undefined) throw new Error("beforeAll did not build the second app");
    return second;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'evcoming-t-%@example.com')`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_events WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'evcoming-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, cookies: Cookies, payload?: unknown, ip = nextIp(), target = api()) =>
    target.inject({
      method,
      url: path,
      remoteAddress: ip,
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });

  interface Person {
    userId: string;
    cookies: Cookies;
    name: string;
    email: string;
  }

  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `evcoming-t-${uniq()}@example.com`;
    const reg = await inject("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await inject("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login), name: displayName, email };
  };

  interface Gym {
    id: string;
    owner: Person;
  }

  const makeGym = async (name: string): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await inject("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Leeds", country: "GB", timezone: "Europe/London" });
    expect(res.statusCode).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return { id, owner };
  };
  const addStaff = async (gymId: string, userId: string, privileges: string[] | null) => {
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gymId}, ${userId}, 'trainer', ${privileges})`;
  };
  const member = async (gym: Gym, name: string): Promise<Person> => {
    const person = await signedIn(name);
    await sql`INSERT INTO gym_members (gym_id, user_id, joined_at) VALUES (${gym.id}, ${person.userId}, '2026-01-01T00:00:00Z')`;
    return person;
  };
  const members = async (gym: Gym, names: readonly string[]): Promise<Person[]> => {
    const people: Person[] = [];
    for (const name of names) people.push(await member(gym, name));
    return people;
  };

  const events = (gymId: string) => `/v1/orgs/${gymId}/events`;
  /** Saturday 17 October 2026, 10:00 to 13:00 in London. */
  const openDay = (places: number | null, over: Record<string, unknown> = {}) => ({
    eventKey: randomUUID(),
    name: "Saturday Open Day",
    details: "Bring a friend.",
    place: "Main hall",
    startsOn: "2026-10-17",
    startMinute: 600,
    endsOn: "2026-10-17",
    endMinute: 780,
    places,
    ...over,
  });
  const add = async (gym: Gym, places: number | null, over: Record<string, unknown> = {}): Promise<StaffGymEvent> => {
    const res = await inject("POST", events(gym.id), gym.owner.cookies, openDay(places, over));
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { event: StaffGymEvent }).event;
  };
  const change = (gym: Gym, eventId: string, places: number | null, over: Record<string, unknown> = {}) => {
    const fields: Record<string, unknown> = openDay(places, over);
    delete fields["eventKey"];
    return inject("PUT", `${events(gym.id)}/${eventId}`, gym.owner.cookies, fields);
  };
  const comePath = (gym: Gym, eventId: string) => `${events(gym.id)}/${eventId}/coming`;
  const come = (gym: Gym, eventId: string, who: Person, joinWaitlist = false, requestKey: string = randomUUID(), target = api(), ip = nextIp()) =>
    inject("POST", comePath(gym, eventId), who.cookies, { requestKey, joinWaitlist }, ip, target);
  const cantCome = (gym: Gym, eventId: string, who: Person) => inject("DELETE", comePath(gym, eventId), who.cookies);
  const eventOf = (res: Res): MemberGymEvent => {
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { event: MemberGymEvent }).event;
  };
  const seenBy = async (gym: Gym, who: Person, eventId: string): Promise<MemberGymEvent> => {
    const res = await inject("GET", events(gym.id), who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    const found = (JSON.parse(res.body) as GymEventsResponse).events.find((e) => e.id === eventId);
    if (found === undefined) throw new Error("the member was not sent the event");
    return found;
  };
  const people = async (gym: Gym, eventId: string, who: Person = gym.owner): Promise<GymEventPeopleResponse> => {
    const res = await inject("GET", `${events(gym.id)}/${eventId}/people`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as GymEventPeopleResponse;
  };
  const names = (list: GymEventPeopleResponse["coming"]): (string | null)[] => list.map((p) => p.name);
  /** The places in the database, whatever any route says. */
  const stored = async (eventId: string): Promise<Record<string, number>> => {
    const rows = await sql<{ status: string; n: number }[]>`SELECT status, count(*)::int AS n FROM gym_event_places WHERE event_id = ${eventId} GROUP BY status`;
    return Object.fromEntries(rows.map((r) => [r.status, r.n]));
  };
  const audits = async (gymId: string, action: string): Promise<number> => {
    const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${gymId} AND action = ${action}`;
    return rows[0]?.n ?? 0;
  };

  beforeAll(async () => {
    await cleanup();
    folder = await mkdtemp(join(tmpdir(), "aihg-evcoming-test-"));
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    redis = redisUrl === undefined || redisUrl === "" ? createMemoryRedis() : createIoRedis(redisUrl);
    for (let tries = 0; (await redis.incrWithTtl(`evcoming-ready:${randomUUID()}`, 30)) === null; tries++) {
      if (tries === 100) throw new Error("the Redis at TEST_REDIS_URL never connected");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const overrides = {
      redis,
      photoStore: createDiskPhotoStore(folder),
      orgs: { now: () => new Date(clock) },
      usersEmailSender: {
        sendAccountDeleteCodeEmail: (to: string, code: string) => {
          deleteCodes.set(to.toLowerCase(), code);
          return Promise.resolve();
        },
        sendAccountDeletionEmail: () => Promise.resolve(),
      },
    };
    app = await buildApp(loadConfig(baseEnv), overrides);
    await api().ready();
    second = await buildApp(loadConfig(baseEnv), overrides);
    await second.ready();
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await second?.close();
    await redis?.close();
    await sql.end({ timeout: 5 });
    await rm(folder, { recursive: true, force: true });
  }, T);

  beforeEach(() => {
    clock = MORNING.getTime();
  });

  // ===========================================================================
  // THE WORST THING, FIRST
  // ===========================================================================

  it(
    "the last place is never given to two people, however many tap at the same instant on two servers",
    async () => {
      const gym = await makeGym("Last Place House");
      const event = await add(gym, 3);
      const crowd = await members(gym, ["Ann A", "Bea B", "Cal C", "Dee D", "Eve E", "Fay F", "Gus G", "Hal H"]);

      // Eight people, three places, no waitlist asked for: half on each server.
      const taps = await Promise.all(crowd.map((who, i) => come(gym, event.id, who, false, randomUUID(), i % 2 === 0 ? api() : other())));
      const told = taps.map((res) => (res.statusCode === 200 ? eventOf(res).going.mine?.status : codeOf(res)));
      expect(told.filter((t) => t === "coming")).toHaveLength(3);
      expect(told.filter((t) => t === "event_full")).toHaveLength(5);
      expect(await stored(event.id)).toEqual({ coming: 3 });
      const list = await people(gym, event.id);
      expect(list.comingTotal).toBe(3);
      expect(list.coming).toHaveLength(3);
      // Everybody told "coming" is on staff's list, and nobody else.
      const winners = crowd.filter((_, i) => told[i] === "coming").map((p) => p.name).sort();
      expect(names(list.coming).sort()).toEqual(winners);

      // The same crowd again, each asking for the waitlist: nobody new gets a place.
      const again = await Promise.all(crowd.map((who, i) => come(gym, event.id, who, true, randomUUID(), i % 2 === 0 ? other() : api())));
      for (const res of again) expect(res.statusCode, res.body).toBe(200);
      expect(await stored(event.id)).toEqual({ coming: 3, waitlisted: 5 });
      const lined = again.map((res) => eventOf(res).going.mine);
      expect(lined.filter((m) => m?.status === "coming")).toHaveLength(3);
      // Five people waiting hold the five places in line, one each.
      const line = await Promise.all(crowd.map((who) => seenBy(gym, who, event.id)));
      expect(line.flatMap((e) => (e.going.mine?.status === "waitlisted" ? [e.going.mine.waitlistPlace] : [])).sort()).toEqual([1, 2, 3, 4, 5]);

      // Two of the three give up their place at the same instant as two outsiders to the
      // line tap: the freed places go to the first two in line, never to anybody twice.
      const late = await members(gym, ["Ian I", "Jon J"]);
      const holders = crowd.filter((_, i) => told[i] === "coming");
      const [first, secondHolder] = holders;
      if (first === undefined || secondHolder === undefined) throw new Error("no holders");
      await Promise.all([
        inject("DELETE", comePath(gym, event.id), first.cookies, undefined, nextIp(), api()),
        inject("DELETE", comePath(gym, event.id), secondHolder.cookies, undefined, nextIp(), other()),
        come(gym, event.id, late[0] ?? first, false, randomUUID(), other()),
        come(gym, event.id, late[1] ?? first, false, randomUUID(), api()),
      ]);
      const after = await stored(event.id);
      expect(after["coming"]).toBe(3);
      expect(after["waitlisted"]).toBe(3);
      expect((await people(gym, event.id)).coming).toHaveLength(3);
      // The database itself holds one place in use a person.
      const twice = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM (
          SELECT user_id FROM gym_event_places WHERE event_id = ${event.id} AND status IN ('coming','waitlisted') GROUP BY user_id HAVING count(*) > 1
        ) x`;
      expect(twice[0]?.n).toBe(0);
    },
    T,
  );

  it(
    "one place and a crowd asking for the waitlist: one is coming, the rest wait in one line",
    async () => {
      const gym = await makeGym("One Place House");
      const event = await add(gym, 1);
      const crowd = await members(gym, ["Kim K", "Lee L", "Max M", "Ned N", "Oli O", "Pat P"]);
      const taps = await Promise.all(crowd.map((who, i) => come(gym, event.id, who, true, randomUUID(), i % 2 === 0 ? api() : other())));
      const mine = taps.map((res) => eventOf(res).going.mine?.status);
      expect(mine.filter((s) => s === "coming")).toHaveLength(1);
      expect(mine.filter((s) => s === "waitlisted")).toHaveLength(5);
      expect(await stored(event.id)).toEqual({ coming: 1, waitlisted: 5 });
    },
    T,
  );

  // ===========================================================================
  // WHO MAY
  // ===========================================================================

  it(
    "nobody outside the gym takes a place, reads who is coming, or takes a person off",
    async () => {
      const gym = await makeGym("Private Coming House");
      const event = await add(gym, 5);
      const inside = await member(gym, "Vera Viewer");
      eventOf(await come(gym, event.id, inside));
      const place = (await people(gym, event.id)).coming[0];
      if (place === undefined) throw new Error("nobody coming");
      const elsewhere = await makeGym("Other Coming House");
      const outsider = await member(elsewhere, "Olga Outsider");
      const stranger = await signedIn("Sam Stranger");
      const removed = await member(gym, "Rita Removed");
      await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${gym.id} AND user_id = ${removed.userId}`;
      const trainer = await signedIn("Tara Trainer");
      await addStaff(gym.id, trainer.userId, ["members.read", "attendance.read"]);
      const poster = await signedIn("Pia Poster");
      await addStaff(gym.id, poster.userId, ["posts.manage"]);

      // who, cookies, then the status of: I'm coming and Can't come, staff's list and removal.
      const refused: [string, Cookies, number, number][] = [
        ["another gym's owner", elsewhere.owner.cookies, 404, 404],
        ["another gym's member", outsider.cookies, 404, 404],
        ["a stranger", stranger.cookies, 404, 404],
        ["somebody the gym removed", removed.cookies, 404, 404],
        ["a trainer without the tick", trainer.cookies, 404, 403],
        ["nobody signed in", {}, 401, 401],
      ];
      for (const [who, cookies, memberStatus, staffStatus] of refused) {
        const taps = [await inject("POST", comePath(gym, event.id), cookies, { requestKey: randomUUID(), joinWaitlist: true }), await inject("DELETE", comePath(gym, event.id), cookies)];
        for (const res of taps) expect(res.statusCode, `${who} member tap`).toBe(memberStatus);
        const staff = [
          await inject("GET", `${events(gym.id)}/${event.id}/people`, cookies),
          await inject("DELETE", `${events(gym.id)}/${event.id}/people/${place.id}`, cookies),
        ];
        for (const res of staff) {
          expect(res.statusCode, `${who} staff`).toBe(staffStatus);
          expect(res.body, `${who} staff`).not.toMatch(/Vera/);
        }
      }
      // This gym's own owner and staff are not its members: no place for them by the member's door.
      expect((await come(gym, event.id, gym.owner)).statusCode).toBe(404);
      // A member is not staff.
      expect((await inject("GET", `${events(gym.id)}/${event.id}/people`, inside.cookies)).statusCode).toBe(404);
      // Another gym's staff cannot reach this event, or this person, through their own gym's address.
      const through = `${events(elsewhere.id)}/${event.id}`;
      expect((await inject("GET", `${through}/people`, elsewhere.owner.cookies)).statusCode).toBe(404);
      expect((await inject("DELETE", `${through}/people/${place.id}`, elsewhere.owner.cookies)).statusCode).toBe(404);
      expect((await inject("POST", `${through}/coming`, outsider.cookies, { requestKey: randomUUID(), joinWaitlist: false })).statusCode).toBe(404);
      // Nor a person of this gym's OTHER event through this one.
      const otherEvent = await add(gym, 5, { name: "Second Event" });
      expect((await inject("DELETE", `${events(gym.id)}/${otherEvent.id}/people/${place.id}`, gym.owner.cookies)).statusCode).toBe(404);

      // Nothing changed: one person coming, and nothing noted as removed.
      expect(await stored(event.id)).toEqual({ coming: 1 });
      expect(await audits(gym.id, "org.event_person_removed")).toBe(0);
      // Staff holding "Post updates" read the list.
      expect(names((await people(gym, event.id, poster)).coming)).toEqual(["Vera Viewer"]);
      // A gym whose plan has lapsed: its members are sent nothing and take no place.
      await sql`UPDATE subscriptions SET status = 'canceled' WHERE owner_type = 'gym' AND owner_id = ${gym.id}`;
      expect((await come(gym, otherEvent.id, inside)).statusCode).toBe(404);
      expect((await cantCome(gym, event.id, inside)).statusCode).toBe(404);
      expect(await stored(event.id)).toEqual({ coming: 1 });
    },
    T,
  );

  // ===========================================================================
  // THE SAME REQUEST TWICE
  // ===========================================================================

  it(
    "the same tap sent twice is one place, on one server or two at once, and a key is one person's",
    async () => {
      const gym = await makeGym("Twice House");
      const event = await add(gym, 2);
      const [ann, bea, cal] = await members(gym, ["Ann Again", "Bea Again", "Cal Again"]);
      if (ann === undefined || bea === undefined || cal === undefined) throw new Error("no members");
      const key = randomUUID();
      const both = await Promise.all([come(gym, event.id, ann, false, key, api()), come(gym, event.id, ann, false, key, other())]);
      for (const res of both) expect(eventOf(res).going.mine?.status).toBe("coming");
      expect(eventOf(await come(gym, event.id, ann, false, key)).going.coming).toBe(1);
      // A second tap under a new key: they are coming already.
      expect(eventOf(await come(gym, event.id, ann)).going.coming).toBe(1);
      expect(await stored(event.id)).toEqual({ coming: 1 });
      // Somebody else's request under Ann's key takes nothing.
      const reused = await come(gym, event.id, bea, false, key);
      expect(reused.statusCode).toBe(409);
      expect(codeOf(reused)).toBe("request_reused");
      expect(await stored(event.id)).toEqual({ coming: 1 });

      // The reply to Ann's tap was lost; she gave up her place since; the old tap arriving
      // again does not put her back.
      eventOf(await cantCome(gym, event.id, ann));
      expect(eventOf(await come(gym, event.id, ann, false, key)).going.mine).toBeNull();
      expect(await stored(event.id)).toEqual({ cancelled: 1 });
      // A body that is not a tap.
      for (const body of [{}, { requestKey: "nope", joinWaitlist: false }, { requestKey: randomUUID() }, { requestKey: randomUUID(), joinWaitlist: false, places: 9 }]) {
        expect((await inject("POST", comePath(gym, event.id), cal.cookies, body)).statusCode).toBe(400);
      }
      expect((await inject("POST", `${events(gym.id)}/not-an-id/coming`, cal.cookies, { requestKey: randomUUID(), joinWaitlist: false })).statusCode).toBe(400);
      expect((await come(gym, randomUUID(), cal)).statusCode).toBe(404);
    },
    T,
  );

  // ===========================================================================
  // CAN'T COME, AND THE WAITLIST
  // ===========================================================================

  it(
    "a freed place goes to the first in line; inside the last day it waits for the first to claim it",
    async () => {
      const gym = await makeGym("Waitlist House");
      const event = await add(gym, 2);
      const [ann, bea, cal, dee, eve] = await members(gym, ["Ann Line", "Bea Line", "Cal Line", "Dee Line", "Eve Line"]);
      if (ann === undefined || bea === undefined || cal === undefined || dee === undefined || eve === undefined) throw new Error("no members");
      eventOf(await come(gym, event.id, ann));
      eventOf(await come(gym, event.id, bea));
      // Full: a plain tap is told so, with what they can do.
      const full = await come(gym, event.id, cal);
      expect([full.statusCode, codeOf(full)]).toEqual([409, "event_full"]);
      expect((JSON.parse(full.body) as { message: string }).message).toBe(GYM_EVENT_COMING_WORDS.event_full);
      const before = await seenBy(gym, cal, event.id);
      expect(before.going).toEqual({ coming: 2, waiting: 0, mine: null, can: { come: false, joinWaitlist: true, claim: false, cancel: false, why: null } });
      expect(eventOf(await come(gym, event.id, cal, true)).going.mine).toEqual({ status: "waitlisted", waitlistPlace: 1 });
      expect(eventOf(await come(gym, event.id, dee, true)).going.mine).toEqual({ status: "waitlisted", waitlistPlace: 2 });

      // Ten days out: Ann can't come, and the place is Cal's by itself.
      const gone = eventOf(await cantCome(gym, event.id, ann));
      expect(gone.going.mine).toBeNull();
      expect(gone.going.coming).toBe(2);
      expect((await seenBy(gym, cal, event.id)).going.mine).toEqual({ status: "coming", waitlistPlace: null });
      expect((await seenBy(gym, dee, event.id)).going.mine).toEqual({ status: "waitlisted", waitlistPlace: 1 });
      // Sent again, it is done already; somebody never down for it is told so.
      expect(eventOf(await cantCome(gym, event.id, ann)).going.mine).toBeNull();
      const never = await cantCome(gym, event.id, eve);
      expect([never.statusCode, codeOf(never)]).toEqual([404, "not_coming"]);
      expect(names((await people(gym, event.id)).coming)).toEqual(["Bea Line", "Cal Line"]);

      // Inside the last day: Bea can't come, and nobody is moved in.
      clock = DAY_BEFORE.getTime();
      eventOf(await cantCome(gym, event.id, bea));
      expect(await stored(event.id)).toEqual({ coming: 1, waitlisted: 1, cancelled: 2 });
      // Dee, waiting, is offered the claim; Eve, not in line, may take it too: the first to tap has it.
      expect((await seenBy(gym, dee, event.id)).going.can).toEqual({ come: false, joinWaitlist: false, claim: true, cancel: true, why: null });
      expect((await seenBy(gym, eve, event.id)).going.can.come).toBe(true);
      const race = await Promise.all([come(gym, event.id, dee, true, randomUUID(), api()), come(gym, event.id, eve, false, randomUUID(), other())]);
      const got = race.map((res) => (res.statusCode === 200 ? eventOf(res).going.mine?.status : codeOf(res)));
      expect(got.filter((g) => g === "coming")).toHaveLength(1);
      expect((await stored(event.id))["coming"]).toBe(2);
    },
    T,
  );

  it(
    "a claim's tap sent again after the place was given up does not put the person back",
    async () => {
      const gym = await makeGym("Claim Key House");
      const event = await add(gym, 1);
      const [ann, bea] = await members(gym, ["Ann Claim", "Bea Claim"]);
      if (ann === undefined || bea === undefined) throw new Error("no members");
      eventOf(await come(gym, event.id, ann));
      const waitKey = randomUUID();
      eventOf(await come(gym, event.id, bea, true, waitKey));
      // Inside the last day Ann gives up her place; Bea claims it under a key of its own.
      clock = DAY_BEFORE.getTime();
      eventOf(await cantCome(gym, event.id, ann));
      const claimKey = randomUUID();
      expect(eventOf(await come(gym, event.id, bea, false, claimKey)).going.mine?.status).toBe("coming");
      const [row] = await sql<{ request_key: string; claim_key: string | null }[]>`SELECT request_key, claim_key FROM gym_event_places WHERE event_id = ${event.id} AND user_id = ${bea.userId}`;
      expect(row).toEqual({ request_key: waitKey, claim_key: claimKey });
      // She gives it up; the claim's reply had been lost and the tap arrives again, and so
      // does the first one: neither puts her back.
      eventOf(await cantCome(gym, event.id, bea));
      for (const key of [claimKey, waitKey, claimKey]) expect(eventOf(await come(gym, event.id, bea, false, key)).going.mine).toBeNull();
      expect(await stored(event.id)).toEqual({ cancelled: 2 });
      // Somebody else's tap under her claim's key takes nothing.
      const reused = await come(gym, event.id, ann, false, claimKey);
      expect([reused.statusCode, codeOf(reused)]).toEqual([409, "request_reused"]);
    },
    T,
  );

  it(
    "somebody waiting who is no longer a member is passed over and keeps their place in line",
    async () => {
      const gym = await makeGym("Passed Over House");
      const event = await add(gym, 1);
      const [ann, bea, cal] = await members(gym, ["Ann Passed", "Bea Passed", "Cal Passed"]);
      if (ann === undefined || bea === undefined || cal === undefined) throw new Error("no members");
      eventOf(await come(gym, event.id, ann));
      eventOf(await come(gym, event.id, bea, true));
      eventOf(await come(gym, event.id, cal, true));
      // Bea's membership closed without her places being ended: only this statement does that.
      await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${gym.id} AND user_id = ${bea.userId}`;
      eventOf(await cantCome(gym, event.id, ann));
      const list = await people(gym, event.id);
      expect([names(list.coming), names(list.waiting)]).toEqual([["Cal Passed"], ["Bea Passed"]]);
    },
    T,
  );

  it(
    "the gym's own waitlist size and hand-over time are the ones used",
    async () => {
      const gym = await makeGym("Settings House");
      await sql`UPDATE gyms SET waitlist_max = 1 WHERE id = ${gym.id}`;
      const event = await add(gym, 1);
      const [ann, bea, cal] = await members(gym, ["Ann Set", "Bea Set", "Cal Set"]);
      if (ann === undefined || bea === undefined || cal === undefined) throw new Error("no members");
      eventOf(await come(gym, event.id, ann));
      eventOf(await come(gym, event.id, bea, true));
      const third = await come(gym, event.id, cal, true);
      expect([third.statusCode, codeOf(third)]).toEqual([409, "waitlist_full"]);
      expect((await seenBy(gym, cal, event.id)).going.can).toEqual({ come: false, joinWaitlist: false, claim: false, cancel: false, why: "waitlist_full" });

      // This gym hands a place over only while an event is more than 7 days away: at five
      // days out nobody is moved in.
      await sql`UPDATE gyms SET waitlist_handover_minutes = ${7 * 24 * 60} WHERE id = ${gym.id}`;
      const far = await add(gym, 1, { name: "Far Event", startsOn: "2026-10-12", endsOn: "2026-10-12" });
      eventOf(await come(gym, far.id, ann));
      eventOf(await come(gym, far.id, bea, true));
      eventOf(await cantCome(gym, far.id, ann));
      expect(await stored(far.id)).toEqual({ waitlisted: 1, cancelled: 1 });
      // The owner makes the hand-over time shorter: the free place is Bea's at once.
      const saved = await inject("PUT", `/v1/orgs/${gym.id}/booking-settings`, gym.owner.cookies, { opensDays: 7, freeCancelMinutes: 120, handoverMinutes: 60, waitlistMax: 1 });
      expect(saved.statusCode, saved.body).toBe(200);
      expect(await stored(far.id)).toEqual({ coming: 1, cancelled: 1 });
      // The settings screen is told somebody moved in.
      expect((JSON.parse(saved.body) as { movedIn: number }).movedIn).toBe(1);

      // A gym with no waitlist: its full event is full, and nothing is said of a waitlist.
      await sql`UPDATE gyms SET waitlist_max = 0 WHERE id = ${gym.id}`;
      const none = await add(gym, 1, { name: "No Line" });
      eventOf(await come(gym, none.id, ann));
      const told = await come(gym, none.id, cal, true);
      expect([told.statusCode, codeOf(told)]).toEqual([409, "event_full"]);
      expect((await seenBy(gym, cal, none.id)).going.can).toEqual({ come: false, joinWaitlist: false, claim: false, cancel: false, why: "event_full" });
    },
    T,
  );

  // ===========================================================================
  // WHEN THE EVENT CHANGES
  // ===========================================================================

  it(
    "started, ended and cancelled events; a cancel keeps everybody's place and an un-cancel hands over what was freed",
    async () => {
      const gym = await makeGym("Changes House");
      const event = await add(gym, 1);
      const [ann, bea, cal] = await members(gym, ["Ann Change", "Bea Change", "Cal Change"]);
      if (ann === undefined || bea === undefined || cal === undefined) throw new Error("no members");
      eventOf(await come(gym, event.id, ann));
      eventOf(await come(gym, event.id, bea, true));

      // Staff cancel it: everybody is still down for it, and nobody new can be.
      expect((await inject("PUT", `${events(gym.id)}/${event.id}/cancelled`, gym.owner.cookies, { cancelled: true })).statusCode).toBe(200);
      expect(await stored(event.id)).toEqual({ coming: 1, waitlisted: 1 });
      const no = await come(gym, event.id, cal, true);
      expect([no.statusCode, codeOf(no)]).toEqual([409, "event_cancelled"]);
      expect((await seenBy(gym, cal, event.id)).going.can).toEqual({ come: false, joinWaitlist: false, claim: false, cancel: false, why: "event_cancelled" });
      // Ann gives up her place while it is cancelled: nobody is moved in to a cancelled event.
      eventOf(await cantCome(gym, event.id, ann));
      expect(await stored(event.id)).toEqual({ waitlisted: 1, cancelled: 1 });
      // Brought back: the place Ann gave up is Bea's.
      const back = await inject("PUT", `${events(gym.id)}/${event.id}/cancelled`, gym.owner.cookies, { cancelled: false });
      expect((JSON.parse(back.body) as { event: StaffGymEvent }).event).toMatchObject({ coming: 1, waiting: 0, cancelled: false });
      expect((await seenBy(gym, bea, event.id)).going.mine?.status).toBe("coming");

      // Started: no new place, and no giving one up.
      clock = STARTED.getTime();
      const late = await come(gym, event.id, cal, true);
      expect([late.statusCode, codeOf(late)]).toEqual([409, "event_started"]);
      const stuck = await cantCome(gym, event.id, bea);
      expect([stuck.statusCode, codeOf(stuck)]).toEqual([409, "event_started"]);
      expect((await seenBy(gym, bea, event.id)).going.can.cancel).toBe(false);
      // Ended: a member is not sent it, and it is not there to tap.
      clock = ENDED.getTime();
      expect((await come(gym, event.id, cal)).statusCode).toBe(404);
      expect((await cantCome(gym, event.id, bea)).statusCode).toBe(404);
      expect(await stored(event.id)).toEqual({ coming: 1, cancelled: 1 });
      // Staff still read who came down for it, and can no longer take anybody off.
      const list = await people(gym, event.id);
      expect(names(list.coming)).toEqual(["Bea Change"]);
      const off = await inject("DELETE", `${events(gym.id)}/${event.id}/people/${list.coming[0]?.id ?? ""}`, gym.owner.cookies);
      expect([off.statusCode, codeOf(off)]).toEqual([409, "event_ended"]);
      const past = JSON.parse((await inject("GET", `${events(gym.id)}/staff`, gym.owner.cookies)).body) as StaffGymEventsResponse;
      expect(past.past.map((e) => [e.name, e.coming, e.waiting])).toEqual([["Saturday Open Day", 1, 0]]);
    },
    T,
  );

  it(
    "places cannot be cut below the people coming; more places, or no limit, go to the waitlist",
    async () => {
      const gym = await makeGym("Places House");
      const event = await add(gym, 2);
      const [ann, bea, cal, dee] = await members(gym, ["Ann Place", "Bea Place", "Cal Place", "Dee Place"]);
      if (ann === undefined || bea === undefined || cal === undefined || dee === undefined) throw new Error("no members");
      eventOf(await come(gym, event.id, ann));
      eventOf(await come(gym, event.id, bea));
      eventOf(await come(gym, event.id, cal, true));
      eventOf(await come(gym, event.id, dee, true));

      const cut = await change(gym, event.id, 1);
      expect([cut.statusCode, codeOf(cut)]).toEqual([409, "event_places_below_coming"]);
      expect((JSON.parse(cut.body) as { message: string }).message).toBe("2 people are coming, so the places can't be fewer than 2.");
      // Refused whole: not its places, and not the name sent with them.
      const kept = await change(gym, event.id, 1, { name: "Renamed" });
      expect(kept.statusCode).toBe(409);
      const staff = JSON.parse((await inject("GET", `${events(gym.id)}/staff`, gym.owner.cookies)).body) as StaffGymEventsResponse;
      expect(staff.coming.map((e) => [e.name, e.places, e.coming, e.waiting])).toEqual([["Saturday Open Day", 2, 2, 2]]);
      // The same number is fine.
      expect((await change(gym, event.id, 2)).statusCode).toBe(200);

      // One more place: the first in line has it.
      const three = await change(gym, event.id, 3);
      expect((JSON.parse(three.body) as { event: StaffGymEvent }).event).toMatchObject({ places: 3, coming: 3, waiting: 1 });
      expect((await seenBy(gym, cal, event.id)).going.mine?.status).toBe("coming");
      // No limit: everybody waiting is in.
      const open = await change(gym, event.id, null);
      expect((JSON.parse(open.body) as { event: StaffGymEvent }).event).toMatchObject({ places: null, coming: 4, waiting: 0 });
      // Back to a limit under the four coming: refused.
      expect((await change(gym, event.id, 3)).statusCode).toBe(409);
      expect((await change(gym, event.id, 4)).statusCode).toBe(200);
    },
    T,
  );

  // ===========================================================================
  // STAFF, AND PEOPLE WHO LEAVE
  // ===========================================================================

  it(
    "staff read who is coming and waiting by name, and take a person off; their place goes to the first in line",
    async () => {
      const gym = await makeGym("Staff List House");
      const event = await add(gym, 2);
      const [ann, bea, cal, dee] = await members(gym, ["Ann Staffed", "Bea Staffed", "Cal Staffed", "Dee Staffed"]);
      if (ann === undefined || bea === undefined || cal === undefined || dee === undefined) throw new Error("no members");
      eventOf(await come(gym, event.id, ann));
      eventOf(await come(gym, event.id, bea));
      eventOf(await come(gym, event.id, cal, true));
      eventOf(await come(gym, event.id, dee, true));
      const list = await people(gym, event.id);
      expect(list).toMatchObject({ eventId: event.id, places: 2, comingTotal: 2, waitingTotal: 2 });
      expect(list.coming.map((p) => [p.name, p.initials])).toEqual([["Ann Staffed", "AS"], ["Bea Staffed", "BS"]]);
      expect(names(list.waiting)).toEqual(["Cal Staffed", "Dee Staffed"]);
      // No address, no account id.
      expect(JSON.stringify(list)).not.toMatch(/@example\.com/);
      for (const who of [ann, bea, cal, dee]) expect(JSON.stringify(list)).not.toContain(who.userId);

      const annPlace = list.coming[0]?.id ?? "";
      const off = await inject("DELETE", `${events(gym.id)}/${event.id}/people/${annPlace}`, gym.owner.cookies);
      expect(off.statusCode, off.body).toBe(200);
      const after = JSON.parse(off.body) as GymEventPeopleResponse;
      expect(names(after.coming)).toEqual(["Bea Staffed", "Cal Staffed"]);
      expect(names(after.waiting)).toEqual(["Dee Staffed"]);
      expect(await audits(gym.id, "org.event_person_removed")).toBe(1);
      // Asked again it is already so, and noted once.
      expect((await inject("DELETE", `${events(gym.id)}/${event.id}/people/${annPlace}`, gym.owner.cookies)).statusCode).toBe(200);
      expect(await audits(gym.id, "org.event_person_removed")).toBe(1);
      const none = await inject("DELETE", `${events(gym.id)}/${event.id}/people/${randomUUID()}`, gym.owner.cookies);
      expect([none.statusCode, codeOf(none)]).toEqual([404, "person_not_found"]);
      // Ann reads that she is not down for it, and may say she is coming again: she waits.
      expect((await seenBy(gym, ann, event.id)).going.mine).toBeNull();
      expect(eventOf(await come(gym, event.id, ann, true)).going.mine).toEqual({ status: "waitlisted", waitlistPlace: 2 });
      // Somebody waiting taken off: nobody moves.
      const deePlace = after.waiting[0]?.id ?? "";
      const waitOff = JSON.parse((await inject("DELETE", `${events(gym.id)}/${event.id}/people/${deePlace}`, gym.owner.cookies)).body) as GymEventPeopleResponse;
      expect([names(waitOff.coming), names(waitOff.waiting)]).toEqual([["Bea Staffed", "Cal Staffed"], ["Ann Staffed"]]);
      // Ten days out the list says a freed place is handed over.
      expect([waitOff.handsOver, waitOff.started]).toEqual([true, false]);

      // Inside the last day it says it is not, and a removal moves nobody in: the place is
      // free, and Ann, waiting, is offered it.
      clock = DAY_BEFORE.getTime();
      expect((await people(gym, event.id)).handsOver).toBe(false);
      const late = JSON.parse((await inject("DELETE", `${events(gym.id)}/${event.id}/people/${waitOff.coming[0]?.id ?? ""}`, gym.owner.cookies)).body) as GymEventPeopleResponse;
      expect([names(late.coming), names(late.waiting), late.handsOver]).toEqual([["Cal Staffed"], ["Ann Staffed"], false]);
      expect((await seenBy(gym, ann, event.id)).going.can.claim).toBe(true);
      // Started: the list says so, and staff may still take somebody off.
      clock = STARTED.getTime();
      expect(await people(gym, event.id)).toMatchObject({ handsOver: false, started: true });
      // A cancelled event hands nothing over either.
      clock = MORNING.getTime();
      expect((await inject("PUT", `${events(gym.id)}/${event.id}/cancelled`, gym.owner.cookies, { cancelled: true })).statusCode).toBe(200);
      expect(await people(gym, event.id)).toMatchObject({ handsOver: false, started: false });
    },
    T,
  );

  it(
    "somebody the gym removes loses their place, and it goes to the first in line",
    async () => {
      const gym = await makeGym("Leavers House");
      const event = await add(gym, 1);
      // A removal is stamped by the database's own clock, so this one started on a day that
      // has passed for it too.
      const started = await add(gym, 5, { name: "Already Running", startsOn: "2026-10-05", startMinute: 360, endsOn: "2026-10-20", endMinute: 1200 });
      const [ann, bea, cal] = await members(gym, ["Ann Leaver", "Bea Leaver", "Cal Leaver"]);
      if (ann === undefined || bea === undefined || cal === undefined) throw new Error("no members");
      // Ann said she was coming to it the day before it started.
      clock = new Date("2026-10-04T12:00:00Z").getTime();
      eventOf(await come(gym, started.id, ann));
      clock = MORNING.getTime();
      eventOf(await come(gym, event.id, ann));
      eventOf(await come(gym, event.id, bea, true));
      eventOf(await come(gym, event.id, cal, true));

      const out = await inject("DELETE", `/v1/orgs/${gym.id}/members/${ann.userId}`, gym.owner.cookies);
      expect(out.statusCode, out.body).toBe(200);
      expect(names((await people(gym, event.id)).coming)).toEqual(["Bea Leaver"]);
      expect(names((await people(gym, event.id)).waiting)).toEqual(["Cal Leaver"]);
      // An event that had started is history and keeps her.
      expect(await stored(started.id)).toEqual({ coming: 1 });
      // Removed, she takes no place.
      expect((await come(gym, event.id, ann, true)).statusCode).toBe(404);
      // Somebody waiting who is removed just leaves the line.
      expect((await inject("DELETE", `/v1/orgs/${gym.id}/members/${cal.userId}`, gym.owner.cookies)).statusCode).toBe(200);
      expect(await stored(event.id)).toEqual({ coming: 1, cancelled: 2 });

      // Bea, coming, deletes her own account: her place ends and goes to Dee, waiting.
      const dee = await member(gym, "Dee Leaver");
      eventOf(await come(gym, event.id, dee, true));
      expect((await inject("POST", "/v1/users/me/delete-code", bea.cookies, {})).statusCode).toBe(200);
      const code = deleteCodes.get(bea.email);
      if (code === undefined) throw new Error("no delete code");
      const gone = await inject("DELETE", "/v1/users/me", bea.cookies, { code });
      expect(gone.statusCode, gone.body).toBe(200);
      const after = await people(gym, event.id);
      expect([names(after.coming), names(after.waiting)]).toEqual([["Dee Leaver"], []]);
      expect(await stored(event.id)).toEqual({ coming: 1, cancelled: 3 });
    },
    T,
  );

  it(
    "two records of one person joined: their place follows the record that is kept, and staff read the record's name",
    async () => {
      const gym = await makeGym("Joined House");
      const event = await add(gym, 5);
      // Her app name is the first part of her address, so staff read the list's name for her.
      const who = await member(gym, "Dana Double");
      const [account] = await sql<{ email: string }[]>`SELECT email::text AS email FROM users WHERE id = ${who.userId}`;
      await sql`UPDATE users SET display_name = ${(account?.email ?? "").split("@")[0] ?? ""} WHERE id = ${who.userId}`;
      const entry = async (fullName: string): Promise<string> => {
        const res = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName, email: `evcoming-l-${uniq()}@example.com` });
        expect(res.statusCode, res.body).toBe(201);
        return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
      };
      const first = await entry("Dana Dubble");
      await sql`UPDATE gym_members SET entry_id = ${first} WHERE gym_id = ${gym.id} AND user_id = ${who.userId}`;
      eventOf(await come(gym, event.id, who));
      expect(names((await people(gym, event.id)).coming)).toEqual(["Dana Dubble"]);

      const keep = await entry("Dana Double");
      const joined = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries/${first}/merge`, gym.owner.cookies, { keepEntryId: keep, acknowledgeLeavesList: true });
      expect(joined.statusCode, joined.body).toBe(200);
      const rows = await sql<{ entry_id: string | null; status: string }[]>`SELECT entry_id, status FROM gym_event_places WHERE event_id = ${event.id}`;
      expect(rows.map((r) => [r.entry_id, r.status])).toEqual([[keep, "coming"]]);
      expect(names((await people(gym, event.id)).coming)).toEqual(["Dana Double"]);
      // Still hers to give up.
      expect(eventOf(await cantCome(gym, event.id, who)).going.mine).toBeNull();
    },
    T,
  );

  // ===========================================================================
  // THE LIMITS
  // ===========================================================================

  it(
    "a whole gym on one address can all say they are coming; one person's taps are limited",
    async () => {
      const gym = await makeGym("Wifi House");
      const event = await add(gym, null);
      const crowd = await members(gym, ["Ann Wifi", "Bea Wifi", "Cal Wifi", "Dee Wifi", "Eve Wifi", "Fay Wifi"]);
      const wifi = desk();
      for (const who of crowd) expect((await come(gym, event.id, who, false, randomUUID(), api(), wifi)).statusCode).toBe(200);
      expect(await stored(event.id)).toEqual({ coming: 6 });
      // One person tapping without end is stopped; the others on the address are not.
      const [ann, bea] = crowd;
      if (ann === undefined || bea === undefined) throw new Error("no members");
      let last = 200;
      for (let i = 0; i < 125 && last !== 429; i++) last = (await come(gym, event.id, ann, false, randomUUID(), api(), wifi)).statusCode;
      expect(last).toBe(429);
      expect((await come(gym, event.id, bea, false, randomUUID(), api(), wifi)).statusCode).toBe(200);
      // A stranger's taps are 404s that use up nothing of the gym's address.
      const stranger = await signedIn("Sam Wifi");
      for (let i = 0; i < 5; i++) expect((await come(gym, event.id, stranger, false, randomUUID(), api(), wifi)).statusCode).toBe(404);
    },
    T,
  );
});
