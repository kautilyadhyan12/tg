// A GYM'S EVENTS — the routes against real Postgres (DATABASE_URL-gated) and the real disk
// store in a folder of the test's own. Spec Part 3 §15.4; ROADMAP 19c-i.
//
// The worst thing this job could do to a real person: a gym's event or poster read by
// somebody outside that gym (somebody it removed, another gym's member), or a poster kept
// with the place it was photographed. Those are the first two tests below.
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { GYM_EVENTS_COMING_MAX, GYM_EVENT_WORDS, type GymEvent, type GymEventsResponse, type StaffGymEventsResponse } from "@app/shared";
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
  JWT_SECRET: "gym-events-routes-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 120_000;
const LIVE_PLAN = "zz_events_live";
/** Wednesday 7 October 2026, 07:30 in London (summer time). */
const MORNING = new Date("2026-10-07T06:30:00Z");

const photo = (name: string): string => readFileSync(new URL(`./fixtures/photos/${name}`, import.meta.url)).toString("base64");
const IPHONE = photo("iphone16.jpg");
const PNG = photo("iphone16-exif.png");

/** The GPS block's tag, either byte order, anywhere before the picture starts. */
const hasGps = (bytes: Uint8Array): boolean => {
  const s = Buffer.from(bytes).toString("latin1");
  const scan = s.indexOf("\xff\xda", s.indexOf("\xff\xc0"));
  const header = s.slice(0, scan === -1 ? s.length : scan);
  return /\x88\x25|\x25\x88/.test(header) || header.includes("iPhone");
};

let ipCounter = 0;
const nextIp = () => `10.78.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
const redisUrl = process.env["TEST_REDIS_URL"];
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;
/** An address of this run's own for a limit test: a real Redis keeps its counters for the
 *  hour, across runs. */
const desk = (): string => {
  const hex = randomUUID().replaceAll("-", "");
  return `10.${String(100 + (parseInt(hex.slice(0, 2), 16) % 100))}.${String(parseInt(hex.slice(2, 4), 16))}.${String((parseInt(hex.slice(4, 6), 16) % 254) + 1)}`;
};

d("a gym's events (real Postgres, real disk)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let folder = "";
  let clock = MORNING.getTime();
  let app: App | undefined;
  /** A second api on the same database, folder and Redis: one api holds one connection, so
   *  two requests race only across two of them. */
  let second: App | undefined;
  let redis: RedisLike | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'events-t-%@example.com')`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_events WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'events-t-%@example.com'`;
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
  }

  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `events-t-${uniq()}@example.com`;
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
  }

  const makeGym = async (name: string, timezone = "Europe/London"): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await inject("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Leeds", country: "GB", timezone });
    expect(res.statusCode).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return { id, owner };
  };
  const lapse = async (gymId: string) => {
    await sql`UPDATE subscriptions SET status = 'canceled' WHERE owner_type = 'gym' AND owner_id = ${gymId}`;
  };
  const addStaff = async (gymId: string, userId: string, role: "manager" | "trainer", privileges: string[] | null) => {
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gymId}, ${userId}, ${role}, ${privileges})`;
  };
  const member = async (gym: Gym, name: string): Promise<Person> => {
    const person = await signedIn(name);
    await sql`INSERT INTO gym_members (gym_id, user_id, joined_at) VALUES (${gym.id}, ${person.userId}, '2026-01-01T00:00:00Z')`;
    return person;
  };

  const events = (gymId: string) => `/v1/orgs/${gymId}/events`;
  /** Saturday 17 October 2026, 10:00 to 13:00, 40 places. */
  const openDay = (over: Record<string, unknown> = {}) => ({
    eventKey: randomUUID(),
    name: "Saturday Open Day",
    details: "Bring a friend. Free taster classes all morning.",
    place: "Main hall",
    startsOn: "2026-10-17",
    startMinute: 600,
    endsOn: "2026-10-17",
    endMinute: 780,
    places: 40,
    ...over,
  });
  /** The same fields as a change sends them: no key. */
  const changed = (over: Record<string, unknown> = {}) => {
    const fields: Record<string, unknown> = openDay(over);
    delete fields["eventKey"];
    return fields;
  };
  const add = async (gym: Gym, who: Person, over: Record<string, unknown> = {}): Promise<GymEvent> => {
    const res = await inject("POST", events(gym.id), who.cookies, openDay(over));
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { event: GymEvent }).event;
  };
  const coming = async (gym: Gym, who: Person): Promise<GymEventsResponse> => {
    const res = await inject("GET", events(gym.id), who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as GymEventsResponse;
  };
  const staffList = async (gym: Gym, who: Person): Promise<StaffGymEventsResponse> => {
    const res = await inject("GET", `${events(gym.id)}/staff`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as StaffGymEventsResponse;
  };
  const posterPath = (gym: Gym, event: GymEvent): string => `${events(gym.id)}/${event.id}/poster/${event.poster?.id ?? "none"}`;
  const filesOf = async (gymId: string): Promise<string[]> => {
    try {
      return (await readdir(join(folder, "gym-event", gymId))).sort();
    } catch {
      return [];
    }
  };
  const queued = async (gymId: string): Promise<number> => {
    const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM photo_files_to_remove WHERE storage_key LIKE ${`gym-event/${gymId}/%`}`;
    return rows[0]?.n ?? 0;
  };
  const audits = async (gymId: string, action: string): Promise<number> => {
    const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${gymId} AND action = ${action}`;
    return rows[0]?.n ?? 0;
  };

  beforeAll(async () => {
    await cleanup();
    folder = await mkdtemp(join(tmpdir(), "aihg-events-test-"));
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    redis = redisUrl === undefined || redisUrl === "" ? createMemoryRedis() : createIoRedis(redisUrl);
    for (let tries = 0; (await redis.incrWithTtl(`events-ready:${randomUUID()}`, 30)) === null; tries++) {
      if (tries === 100) throw new Error("the Redis at TEST_REDIS_URL never connected");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const overrides = { redis, photoStore: createDiskPhotoStore(folder), orgs: { now: () => new Date(clock) } };
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

  // ===========================================================================
  // THE WORST THING, FIRST
  // ===========================================================================

  it(
    "nobody outside the gym reads an event or its poster, or changes anything",
    async () => {
      const gym = await makeGym("Private House");
      const event = await add(gym, gym.owner, { poster: IPHONE });
      const inside = await member(gym, "Vera Viewer");
      const other = await makeGym("Other House");
      const outsider = await member(other, "Olga Outsider");
      const stranger = await signedIn("Sam Stranger");
      // Somebody the gym removed.
      const removed = await member(gym, "Rita Removed");
      await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${gym.id} AND user_id = ${removed.userId}`;
      const trainer = await signedIn("Tara Trainer");
      await addStaff(gym.id, trainer.userId, "trainer", ["members.read", "attendance.read"]);
      const defaultTrainer = await signedIn("Dev Default");
      await addStaff(gym.id, defaultTrainer.userId, "trainer", null);

      const memberList = events(gym.id);
      const staffRead = `${events(gym.id)}/staff`;
      const poster = posterPath(gym, event);
      const leaks = /Saturday Open Day|Bring a friend|Main hall|Private House/;

      // who, cookies, then the status of: the members' list, the staff list, the poster, a staff write.
      const refused: [string, Cookies, number, number, number, number][] = [
        ["another gym's owner", other.owner.cookies, 404, 404, 404, 404],
        ["another gym's member", outsider.cookies, 404, 404, 404, 404],
        ["a stranger", stranger.cookies, 404, 404, 404, 404],
        ["somebody the gym removed", removed.cookies, 404, 404, 404, 404],
        ["a trainer without the tick", trainer.cookies, 404, 403, 404, 403],
        ["a trainer on the role's own ticks", defaultTrainer.cookies, 404, 403, 404, 403],
        ["nobody signed in", {}, 401, 401, 401, 401],
      ];
      for (const [who, cookies, listStatus, staffStatus, posterStatus, writeStatus] of refused) {
        const reads: [string, number][] = [
          [memberList, listStatus],
          [staffRead, staffStatus],
          [poster, posterStatus],
        ];
        for (const [path, status] of reads) {
          const res = await inject("GET", path, cookies);
          expect(res.statusCode, `${who} GET ${path}`).toBe(status);
          expect(res.body, `${who} GET ${path}`).not.toMatch(leaks);
          expect(res.headers["content-type"], `${who} GET ${path}`).not.toMatch(/^image\//);
        }
        // A browser that says it already holds the poster is asked the same question.
        const again = await api().inject({ method: "GET", url: poster, remoteAddress: nextIp(), cookies, headers: { "if-none-match": `"${event.poster?.id ?? ""}"` } });
        expect(again.statusCode, `${who} asking again`).toBe(posterStatus);
        const writes = [
          await inject("POST", events(gym.id), cookies, openDay({ name: "Written by an outsider" })),
          await inject("PUT", `${events(gym.id)}/${event.id}`, cookies, changed({ name: "Changed by an outsider" })),
          await inject("PUT", `${events(gym.id)}/${event.id}/cancelled`, cookies, { cancelled: true }),
        ];
        for (const res of writes) {
          expect(res.statusCode, `${who} staff write`).toBe(writeStatus);
          expect(res.body, `${who} staff write`).not.toMatch(leaks);
        }
      }
      // Another gym's staff cannot reach this event through their own gym's address.
      const through = `${events(other.id)}/${event.id}`;
      expect((await inject("PUT", through, other.owner.cookies, changed({ name: "Moved across" }))).statusCode).toBe(404);
      expect((await inject("PUT", `${through}/cancelled`, other.owner.cookies, { cancelled: true })).statusCode).toBe(404);
      expect((await inject("GET", `${through}/poster/${event.poster?.id ?? ""}`, other.owner.cookies)).statusCode).toBe(404);
      expect((await inject("GET", `${through}/poster/${event.poster?.id ?? ""}`, outsider.cookies)).statusCode).toBe(404);
      // And leaves no note of having changed it in either gym's record.
      for (const id of [gym.id, other.id]) expect((await audits(id, "org.event_changed")) + (await audits(id, "org.event_cancelled"))).toBe(0);
      // A member of this gym is not its staff.
      expect((await inject("GET", staffRead, inside.cookies)).statusCode).toBe(404);
      expect((await inject("POST", events(gym.id), inside.cookies, openDay())).statusCode).toBe(404);

      // Nothing changed, and the people inside still read it.
      const list = await coming(gym, inside);
      expect(list.events.map((e) => [e.name, e.cancelled])).toEqual([["Saturday Open Day", false]]);
      const picture = await inject("GET", poster, inside.cookies);
      expect(picture.statusCode).toBe(200);
      expect(picture.headers["content-type"]).toBe("image/jpeg");
      expect(picture.headers["x-content-type-options"]).toBe("nosniff");
      // Kept by one person's browser alone and asked for again each time; never run as a page.
      expect(picture.headers["cache-control"]).toBe("private, no-cache");
      expect(picture.headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
      expect((await staffList(gym, gym.owner)).coming).toHaveLength(1);
      expect((await staffList(other, other.owner)).coming).toHaveLength(0);
    },
    T,
  );

  it(
    "a poster is kept without the place it was photographed, and only a picture is taken",
    async () => {
      const gym = await makeGym("Poster House");
      expect(hasGps(Buffer.from(IPHONE, "base64"))).toBe(true);
      const event = await add(gym, gym.owner, { poster: IPHONE });
      const files = await filesOf(gym.id);
      expect(files).toEqual([`${event.poster?.id ?? ""}.jpg`]);
      const kept = await readFile(join(folder, "gym-event", gym.id, files[0] ?? ""));
      expect(hasGps(kept)).toBe(false);
      const sent = await inject("GET", posterPath(gym, event), gym.owner.cookies);
      expect(sent.statusCode).toBe(200);
      expect(hasGps(sent.rawPayload)).toBe(false);
      expect(await queued(gym.id)).toBe(0);

      // Not a picture, and a picture cut short: refused in words, nothing kept.
      const notPhoto = await inject("POST", events(gym.id), gym.owner.cookies, openDay({ poster: Buffer.from("<html><script>alert(1)</script></html>").toString("base64") }));
      expect(notPhoto.statusCode).toBe(400);
      expect((JSON.parse(notPhoto.body) as { message: string }).message).toMatch(/^Poster: /);
      const cut = await inject("POST", events(gym.id), gym.owner.cookies, openDay({ poster: IPHONE.slice(0, 4000) }));
      expect(cut.statusCode).toBe(400);
      expect(await filesOf(gym.id)).toEqual(files);
      expect(await queued(gym.id)).toBe(0);
      expect((await staffList(gym, gym.owner)).coming).toHaveLength(1);
    },
    T,
  );

  // ===========================================================================
  // MAKING, CHANGING AND CANCELLING
  // ===========================================================================

  it(
    "staff add an event and members read it on the gym's own clock, soonest first",
    async () => {
      const gym = await makeGym("Clock House");
      const reader = await member(gym, "Maya Member");
      const later = await add(gym, gym.owner, { name: "Winter Social", startsOn: "2026-12-05", startMinute: 1140, endsOn: "2026-12-05", endMinute: 1320, places: null, place: "", details: "" });
      const sooner = await add(gym, gym.owner);

      const list = await coming(gym, reader);
      expect(list.status).toBe("shown");
      expect(list.timezone).toBe("Europe/London");
      expect(list.events.map((e) => e.name)).toEqual(["Saturday Open Day", "Winter Social"]);
      // 10:00 in London on 17 October is summer time, 09:00 UTC; 19:00 on 5 December is not.
      expect(list.events[0]).toEqual({
        id: sooner.id,
        name: "Saturday Open Day",
        details: "Bring a friend. Free taster classes all morning.",
        place: "Main hall",
        startsOn: "2026-10-17",
        startMinute: 600,
        endsOn: "2026-10-17",
        endMinute: 780,
        startsAt: "2026-10-17T09:00:00.000Z",
        endsAt: "2026-10-17T12:00:00.000Z",
        places: 40,
        cancelled: false,
        poster: null,
        // Nobody is down for it yet, and this member may say they are coming (19c-ii).
        going: { coming: 0, waiting: 0, mine: null, can: { come: true, joinWaitlist: false, claim: false, cancel: false, why: null } },
      });
      expect(list.events[1]?.startsAt).toBe("2026-12-05T19:00:00.000Z");
      expect(list.events[1]?.places).toBeNull();
      expect(list.events[1]?.id).toBe(later.id);

      const staff = await staffList(gym, gym.owner);
      expect(staff.today).toBe("2026-10-07");
      expect(staff.coming.map((e) => e.id)).toEqual([sooner.id, later.id]);
      expect(staff.past).toEqual([]);
      expect(await audits(gym.id, "org.event_added")).toBe(2);

      // A gym in another zone reads its own clock: 10:00 in New York is 14:00 UTC.
      const abroad = await makeGym("Hudson House", "America/New_York");
      expect((await add(abroad, abroad.owner)).startsAt).toBe("2026-10-17T14:00:00.000Z");
    },
    T,
  );

  it(
    "an event sent twice under one key is one event, and two at the same moment too",
    async () => {
      const gym = await makeGym("Twice House");
      const body = openDay({ poster: PNG });
      const first = await inject("POST", events(gym.id), gym.owner.cookies, body);
      const again = await inject("POST", events(gym.id), gym.owner.cookies, { ...body, name: "A second try" });
      expect(first.statusCode).toBe(201);
      expect(again.statusCode).toBe(201);
      expect((JSON.parse(again.body) as { event: GymEvent }).event).toEqual((JSON.parse(first.body) as { event: GymEvent }).event);

      const raced = openDay({ name: "Raced", poster: IPHONE });
      const both = await Promise.all([
        inject("POST", events(gym.id), gym.owner.cookies, raced, nextIp(), api()),
        inject("POST", events(gym.id), gym.owner.cookies, raced, nextIp(), second ?? api()),
      ]);
      expect(both.map((r) => r.statusCode)).toEqual([201, 201]);
      const ids = both.map((r) => (JSON.parse(r.body) as { event: GymEvent }).event.id);
      expect(ids[0]).toBe(ids[1]);

      const list = await staffList(gym, gym.owner);
      expect(list.coming.map((e) => e.name).sort()).toEqual(["Raced", "Saturday Open Day"]);
      // One file an event: the loser's poster is not left behind.
      expect(await filesOf(gym.id)).toHaveLength(2);
      expect(await queued(gym.id)).toBe(0);
    },
    T,
  );

  it(
    "an event that cannot be is refused, with nothing kept",
    async () => {
      const gym = await makeGym("Strict House");
      const refused: [string, Record<string, unknown>][] = [
        ["no name", { name: "   " }],
        ["a name too long", { name: "x".repeat(81) }],
        ["an end before the start", { endMinute: 540 }],
        ["an end at the start", { endMinute: 600 }],
        ["an end on an earlier day", { endsOn: "2026-10-16" }],
        ["a day that is no day", { startsOn: "2026-02-31", endsOn: "2026-03-01" }],
        ["more than a month long", { endsOn: "2026-11-30" }],
        ["no places", { places: 0 }],
        ["half a place", { places: 2.5 }],
        ["a minute past midnight's last", { startMinute: 1440 }],
        ["a field nobody asked for", { colour: "red" }],
        ["details too long", { details: "x".repeat(1001) }],
        ["a name nobody can see", { name: String.fromCodePoint(0x200b, 0x200b) }],
        ["a name of a filler character", { name: String.fromCodePoint(0x3164) }],
        ["a day in the year 0000", { startsOn: "0000-01-01", endsOn: "0000-01-01" }],
        ["a day in the year 9999", { startsOn: "9999-12-30", endsOn: "9999-12-30" }],
        ["a place too long", { place: "x".repeat(121) }],
      ];
      for (const [why, over] of refused) {
        const res = await inject("POST", events(gym.id), gym.owner.cookies, openDay(over));
        expect(res.statusCode, why).toBe(400);
      }
      // An end that has already passed, on the gym's clock (it is 07:30 on 7 October there).
      const gone = await inject("POST", events(gym.id), gym.owner.cookies, openDay({ startsOn: "2026-10-07", startMinute: 360, endsOn: "2026-10-07", endMinute: 420 }));
      expect(gone.statusCode).toBe(400);
      expect(JSON.parse(gone.body)).toMatchObject({ error: "event_already_ended", message: GYM_EVENT_WORDS.already_ended });
      // A start more than two years from the gym's today (7 October 2026).
      const far = await inject("POST", events(gym.id), gym.owner.cookies, openDay({ startsOn: "2028-10-07", endsOn: "2028-10-07" }));
      expect(far.statusCode).toBe(400);
      expect(JSON.parse(far.body)).toMatchObject({ error: "event_too_far", message: GYM_EVENT_WORDS.too_far });
      expect((await inject("POST", events(gym.id), gym.owner.cookies, openDay({ name: "Two years on", startsOn: "2028-10-06", endsOn: "2028-10-06" }))).statusCode).toBe(201);
      // One that has started and not ended is taken.
      expect((await inject("POST", events(gym.id), gym.owner.cookies, openDay({ name: "On now", startsOn: "2026-10-07", startMinute: 360, endsOn: "2026-10-07", endMinute: 480 }))).statusCode).toBe(201);
      // The night the clocks go back in London, 01:30 comes twice; 01:10 to 01:50 is in order.
      expect((await inject("POST", events(gym.id), gym.owner.cookies, openDay({ name: "Clocks back", startsOn: "2026-10-25", startMinute: 70, endsOn: "2026-10-25", endMinute: 110 }))).statusCode).toBe(201);
      // The night they go forward London has no 01:00 to 01:59: a time in it reads as the
      // hour after. 00:40 to 01:10 is 00:40 to 02:10 on the clock, thirty minutes apart.
      const skipped = await inject("POST", events(gym.id), gym.owner.cookies, openDay({ name: "Clocks forward", startsOn: "2027-03-28", startMinute: 40, endsOn: "2027-03-28", endMinute: 70 }));
      expect(skipped.statusCode, skipped.body).toBe(201);
      expect((JSON.parse(skipped.body) as { event: GymEvent }).event).toMatchObject({ startsAt: "2027-03-28T00:40:00.000Z", endsAt: "2027-03-28T01:10:00.000Z" });
      // 01:40 to 02:10 reads in order and is not: 01:40 is 02:40 on that night's clock.
      const backwards = await inject("POST", events(gym.id), gym.owner.cookies, openDay({ name: "Out of order", startsOn: "2027-03-28", startMinute: 100, endsOn: "2027-03-28", endMinute: 130 }));
      expect(backwards.statusCode).toBe(400);
      expect(JSON.parse(backwards.body)).toMatchObject({ error: "event_ends_before_start", message: GYM_EVENT_WORDS.ends_before_start });
      const names = (await staffList(gym, gym.owner)).coming.map((e) => e.name);
      expect(names).toEqual(["On now", "Clocks back", "Clocks forward", "Two years on"]);
      for (const e of (await staffList(gym, gym.owner)).coming) expect(Date.parse(e.endsAt)).toBeGreaterThan(Date.parse(e.startsAt));
    },
    T,
  );

  it(
    "staff change an event and its poster; the old poster's file goes",
    async () => {
      const gym = await makeGym("Change House");
      const reader = await member(gym, "Maya Member");
      const event = await add(gym, gym.owner, { poster: IPHONE });
      const firstFile = await filesOf(gym.id);

      // Words and times changed, the poster left as it is.
      const moved = await inject("PUT", `${events(gym.id)}/${event.id}`, gym.owner.cookies, changed({ name: "Sunday Open Day", startsOn: "2026-10-18", endsOn: "2026-10-18", places: null }));
      expect(moved.statusCode, moved.body).toBe(200);
      const after = (JSON.parse(moved.body) as { event: GymEvent }).event;
      expect(after).toMatchObject({ id: event.id, name: "Sunday Open Day", startsOn: "2026-10-18", startsAt: "2026-10-18T09:00:00.000Z", places: null, poster: event.poster });
      expect(await filesOf(gym.id)).toEqual(firstFile);

      // A new poster: a new address, the old file gone, the old address answering nobody.
      const swapped = await inject("PUT", `${events(gym.id)}/${event.id}`, gym.owner.cookies, changed({ poster: PNG }));
      expect(swapped.statusCode, swapped.body).toBe(200);
      const withNew = (JSON.parse(swapped.body) as { event: GymEvent }).event;
      expect(withNew.poster?.id).not.toBe(event.poster?.id);
      expect(await filesOf(gym.id)).toEqual([`${withNew.poster?.id ?? ""}.png`]);
      expect((await inject("GET", posterPath(gym, event), reader.cookies)).statusCode).toBe(404);
      const fresh = await inject("GET", posterPath(gym, withNew), reader.cookies);
      expect(fresh.statusCode).toBe(200);
      expect(fresh.headers["content-type"]).toBe("image/png");
      // Held already: "the one you have", for somebody who may still see it.
      const held = await api().inject({ method: "GET", url: posterPath(gym, withNew), remoteAddress: nextIp(), cookies: reader.cookies, headers: { "if-none-match": `"${withNew.poster?.id ?? ""}"` } });
      expect(held.statusCode).toBe(304);

      // A poster that is refused leaves the event and its poster as they were.
      const bad = await inject("PUT", `${events(gym.id)}/${event.id}`, gym.owner.cookies, changed({ name: "Never saved", poster: Buffer.from("not a picture at all").toString("base64") }));
      expect(bad.statusCode).toBe(400);
      expect((await coming(gym, reader)).events[0]).toMatchObject({ name: "Saturday Open Day", poster: withNew.poster });

      // Taken off: no poster, no file.
      const bare = await inject("PUT", `${events(gym.id)}/${event.id}`, gym.owner.cookies, changed({ poster: null }));
      expect((JSON.parse(bare.body) as { event: GymEvent }).event.poster).toBeNull();
      expect(await filesOf(gym.id)).toEqual([]);
      expect(await queued(gym.id)).toBe(0);
      expect((await inject("GET", posterPath(gym, withNew), reader.cookies)).statusCode).toBe(404);
      expect((await inject("PUT", `${events(gym.id)}/${randomUUID()}`, gym.owner.cookies, changed())).statusCode).toBe(404);
      expect(await audits(gym.id, "org.event_changed")).toBe(3);
    },
    T,
  );

  it(
    "a cancelled event stays on the members' list, marked, and can be un-cancelled",
    async () => {
      const gym = await makeGym("Cancel House");
      const reader = await member(gym, "Maya Member");
      const event = await add(gym, gym.owner);
      const cancel = (cancelled: boolean) => inject("PUT", `${events(gym.id)}/${event.id}/cancelled`, gym.owner.cookies, { cancelled });

      expect((await cancel(true)).statusCode).toBe(200);
      expect((await cancel(true)).statusCode).toBe(200);
      expect((await coming(gym, reader)).events.map((e) => [e.name, e.cancelled])).toEqual([["Saturday Open Day", true]]);
      expect(await audits(gym.id, "org.event_cancelled")).toBe(1);

      const back = await cancel(false);
      expect((JSON.parse(back.body) as { event: GymEvent }).event.cancelled).toBe(false);
      expect((await coming(gym, reader)).events[0]?.cancelled).toBe(false);
      expect(await audits(gym.id, "org.event_uncancelled")).toBe(1);
      expect((await inject("PUT", `${events(gym.id)}/${event.id}/cancelled`, gym.owner.cookies, { cancelled: "yes" })).statusCode).toBe(400);
      expect((await inject("PUT", `${events(gym.id)}/${randomUUID()}/cancelled`, gym.owner.cookies, { cancelled: true })).statusCode).toBe(404);
    },
    T,
  );

  it(
    "an event that has ended leaves the members' list, stays with staff, and cannot be changed",
    async () => {
      const gym = await makeGym("Ended House");
      const reader = await member(gym, "Maya Member");
      const event = await add(gym, gym.owner, { poster: IPHONE });
      const started = clock;
      try {
        // 12:59 on the day: still on the list. 13:00: ended.
        clock = Date.parse("2026-10-17T11:59:00Z");
        expect((await coming(gym, reader)).events).toHaveLength(1);
        clock = Date.parse("2026-10-17T12:00:00Z");
        expect((await coming(gym, reader)).events).toEqual([]);
        expect((await inject("GET", posterPath(gym, event), reader.cookies)).statusCode).toBe(404);

        const staff = await staffList(gym, gym.owner);
        expect(staff.coming).toEqual([]);
        expect(staff.past.map((e) => e.id)).toEqual([event.id]);
        expect(staff.pastTotal).toBe(1);
        expect((await inject("GET", posterPath(gym, event), gym.owner.cookies)).statusCode).toBe(200);

        const change = await inject("PUT", `${events(gym.id)}/${event.id}`, gym.owner.cookies, changed({ name: "Rewritten", startsOn: "2026-11-01", endsOn: "2026-11-01" }));
        expect(change.statusCode).toBe(409);
        expect(JSON.parse(change.body)).toMatchObject({ error: "event_ended", message: GYM_EVENT_WORDS.ended });
        // Saved with its own times, which have passed, it is told the same thing: that it
        // has ended, never to choose a later end.
        const asItWas = await inject("PUT", `${events(gym.id)}/${event.id}`, gym.owner.cookies, changed({ name: "Rewritten" }));
        expect(asItWas.statusCode).toBe(409);
        expect((JSON.parse(asItWas.body) as { error: string }).error).toBe("event_ended");
        expect((await inject("PUT", `${events(gym.id)}/${event.id}/cancelled`, gym.owner.cookies, { cancelled: true })).statusCode).toBe(409);
        expect((await staffList(gym, gym.owner)).past[0]).toMatchObject({ name: "Saturday Open Day", cancelled: false });
        // Its poster can still be taken off (a person in it may ask), and nothing else with it.
        expect(await filesOf(gym.id)).toHaveLength(1);
        const bare = await inject("PUT", `${events(gym.id)}/${event.id}`, gym.owner.cookies, changed({ name: "Rewritten with the poster", places: 3, poster: null }));
        expect(bare.statusCode, bare.body).toBe(200);
        expect((JSON.parse(bare.body) as { event: GymEvent }).event).toMatchObject({ name: "Saturday Open Day", places: 40, poster: null });
        expect(await filesOf(gym.id)).toEqual([]);
        expect(await queued(gym.id)).toBe(0);
        expect((await inject("GET", posterPath(gym, event), gym.owner.cookies)).statusCode).toBe(404);
        // Asked again, there is none to take off.
        expect((await inject("PUT", `${events(gym.id)}/${event.id}`, gym.owner.cookies, changed({ poster: null }))).statusCode).toBe(200);
        expect(await audits(gym.id, "org.event_changed")).toBe(1);
      } finally {
        clock = started;
      }
    },
    T,
  );

  it(
    "only staff holding Post updates make events, and a gym off its plan is read-only",
    async () => {
      const gym = await makeGym("Tick House");
      const reader = await member(gym, "Maya Member");
      const poster = await signedIn("Pia Poster");
      await addStaff(gym.id, poster.userId, "trainer", ["posts.manage"]);
      const manager = await signedIn("Mo Manager");
      await addStaff(gym.id, manager.userId, "manager", null);
      const event = await add(gym, poster, { name: "By a trainer with the tick", poster: IPHONE });
      expect((await inject("POST", events(gym.id), manager.cookies, openDay({ name: "By a manager" }))).statusCode).toBe(201);
      expect((await staffList(gym, poster)).coming).toHaveLength(2);

      await lapse(gym.id);
      const refused = [
        await inject("POST", events(gym.id), gym.owner.cookies, openDay()),
        await inject("PUT", `${events(gym.id)}/${event.id}`, gym.owner.cookies, changed()),
        await inject("PUT", `${events(gym.id)}/${event.id}/cancelled`, gym.owner.cookies, { cancelled: true }),
      ];
      for (const res of refused) {
        expect(res.statusCode).toBe(409);
        expect((JSON.parse(res.body) as { error: string }).error).toBe("gym_not_on_plan");
      }
      // Staff still read their events; members are told the gym's page is paused and sent none.
      expect((await staffList(gym, gym.owner)).coming).toHaveLength(2);
      const paused = await coming(gym, reader);
      expect(paused.status).toBe("paused");
      expect(paused.events).toEqual([]);
      // Nor a poster, to a member whose browser holds it either; staff still see it.
      expect((await inject("GET", posterPath(gym, event), reader.cookies)).statusCode).toBe(404);
      const held = await api().inject({ method: "GET", url: posterPath(gym, event), remoteAddress: nextIp(), cookies: reader.cookies, headers: { "if-none-match": `"${event.poster?.id ?? ""}"` } });
      expect(held.statusCode).toBe(404);
      expect((await inject("GET", posterPath(gym, event), gym.owner.cookies)).statusCode).toBe(200);
    },
    T,
  );

  it(
    "a gym keeps at most its limit of coming events",
    async () => {
      const gym = await makeGym("Full House");
      await sql`
        INSERT INTO gym_events (gym_id, event_key, name, starts_on, start_minute, ends_on, end_minute, starts_at, ends_at)
        SELECT ${gym.id}, gen_random_uuid(), 'Event ' || n, '2026-11-01', 600, '2026-11-01', 660,
               '2026-11-01T10:00:00Z'::timestamptz + make_interval(mins => n), '2026-11-01T11:00:00Z'::timestamptz + make_interval(mins => n)
        FROM generate_series(1, ${GYM_EVENTS_COMING_MAX - 1}) AS n`;
      // Four at the same moment through two apis: the one place left goes to one of them.
      const rush = await Promise.all(
        [0, 1, 2, 3].map((n) => inject("POST", events(gym.id), gym.owner.cookies, openDay({ name: `The last one ${String(n)}`, poster: IPHONE }), nextIp(), n % 2 === 0 ? api() : (second ?? api()))),
      );
      expect(rush.map((r) => r.statusCode).sort()).toEqual([201, 409, 409, 409]);
      expect(await filesOf(gym.id)).toHaveLength(1);
      const over = await inject("POST", events(gym.id), gym.owner.cookies, openDay({ name: "One too many", poster: IPHONE }));
      expect(over.statusCode).toBe(409);
      expect(JSON.parse(over.body)).toMatchObject({ error: "events_full", message: GYM_EVENT_WORDS.full });
      expect(await filesOf(gym.id)).toHaveLength(1);
      expect(await queued(gym.id)).toBe(0);
      const reader = await member(gym, "Maya Member");
      expect((await coming(gym, reader)).events).toHaveLength(GYM_EVENTS_COMING_MAX);
      expect((await staffList(gym, gym.owner)).coming).toHaveLength(GYM_EVENTS_COMING_MAX);
    },
    T,
  );

  it(
    "a gym that changes its time zone keeps its events on its own clock",
    async () => {
      const gym = await makeGym("Moving House");
      const reader = await member(gym, "Maya Member");
      // 09:00 to 10:00 today on the gym's clock; it is 07:30 in London.
      const event = await add(gym, gym.owner, { name: "Breakfast", startsOn: "2026-10-07", startMinute: 540, endsOn: "2026-10-07", endMinute: 600 });
      expect(event.startsAt).toBe("2026-10-07T08:00:00.000Z");
      const started = clock;
      try {
        // The gym is in Los Angeles after all, where it is 23:30 the evening before.
        const moved = await api().inject({ method: "PATCH", url: `/v1/orgs/${gym.id}`, remoteAddress: nextIp(), cookies: gym.owner.cookies, headers: { "content-type": "application/json" }, payload: JSON.stringify({ timezone: "America/Los_Angeles" }) });
        expect(moved.statusCode, moved.body).toBe(200);
        const there = await coming(gym, reader);
        expect(there.timezone).toBe("America/Los_Angeles");
        expect(there.today).toBe("2026-10-06");
        expect(there.events.map((e) => [e.startsOn, e.startMinute, e.startsAt, e.endsAt])).toEqual([["2026-10-07", 540, "2026-10-07T16:00:00.000Z", "2026-10-07T17:00:00.000Z"]]);
        // 09:30 on the gym's own clock: on, and still listed. 10:00 there: ended.
        clock = Date.parse("2026-10-07T16:30:00Z");
        expect((await coming(gym, reader)).events).toHaveLength(1);
        clock = Date.parse("2026-10-07T17:00:00Z");
        expect((await coming(gym, reader)).events).toEqual([]);
        expect((await staffList(gym, gym.owner)).past.map((e) => e.id)).toEqual([event.id]);
        // Another gym's events did not move with it.
      } finally {
        clock = started;
      }
      const other = await makeGym("Staying House");
      const stays = await add(other, other.owner);
      await api().inject({ method: "PATCH", url: `/v1/orgs/${gym.id}`, remoteAddress: nextIp(), cookies: gym.owner.cookies, headers: { "content-type": "application/json" }, payload: JSON.stringify({ timezone: "Asia/Kolkata" }) });
      expect((await staffList(other, other.owner)).coming[0]?.startsAt).toBe(stays.startsAt);
    },
    T,
  );

  it(
    "two changes of one event at the same moment leave one poster and its one file",
    async () => {
      const gym = await makeGym("Race House");
      const event = await add(gym, gym.owner, { poster: IPHONE });
      for (let round = 0; round < 3; round++) {
        const both = await Promise.all(
          [IPHONE, PNG].map((poster, n) => inject("PUT", `${events(gym.id)}/${event.id}`, gym.owner.cookies, changed({ poster }), nextIp(), n === 0 ? api() : (second ?? api()))),
        );
        expect(both.map((r) => r.statusCode)).toEqual([200, 200]);
        const now = (await staffList(gym, gym.owner)).coming[0];
        const files = await filesOf(gym.id);
        expect(files).toHaveLength(1);
        expect(files[0]?.startsWith(now?.poster?.id ?? "none")).toBe(true);
        expect(await queued(gym.id)).toBe(0);
      }
    },
    T,
  );

  it(
    "a gym's people at one address all read; one member of staff's saves are limited, alone",
    async () => {
      const gym = await makeGym("Wifi House");
      const event = await add(gym, gym.owner, { poster: IPHONE });
      const wifi = desk();
      const people = [];
      for (let n = 0; n < 6; n++) people.push(await member(gym, `Member ${String(n)}`));
      for (let round = 0; round < 5; round++) {
        for (const person of people) {
          expect((await inject("GET", events(gym.id), person.cookies, undefined, wifi)).statusCode).toBe(200);
          expect((await inject("GET", posterPath(gym, event), person.cookies, undefined, wifi)).statusCode).toBe(200);
        }
      }
      // A stranger's tries at that address are 404 and count against nobody.
      const stranger = await signedIn("Sam Stranger");
      for (let n = 0; n < 30; n++) expect((await inject("POST", events(gym.id), stranger.cookies, openDay(), wifi)).statusCode).toBe(404);
      // One member of staff: 120 saves an hour (the add above was the first), then 429.
      const manager = await signedIn("Mo Manager");
      await addStaff(gym.id, manager.userId, "manager", null);
      for (let n = 0; n < 120; n++) expect((await inject("POST", events(gym.id), manager.cookies, openDay({ name: "" }), wifi)).statusCode, `save ${String(n + 1)}`).toBe(400);
      expect((await inject("POST", events(gym.id), manager.cookies, openDay(), wifi)).statusCode).toBe(429);
      // The owner at the same address still saves; the manager is limited from another too.
      expect((await inject("POST", events(gym.id), gym.owner.cookies, openDay({ name: "Still saved" }), wifi)).statusCode).toBe(201);
      expect((await inject("POST", events(gym.id), manager.cookies, openDay())).statusCode).toBe(429);
      expect((await inject("GET", events(gym.id), people[0]?.cookies ?? {}, undefined, wifi)).statusCode).toBe(200);
    },
    T,
  );

  it(
    "a body from somebody who may not save is answered without being read",
    async () => {
      const gym = await makeGym("Gate House");
      const stranger = await signedIn("Sam Stranger");
      // Not JSON at all: read, it would be a 400.
      const junk = (cookies: Cookies, path: string, method: "POST" | "PUT") =>
        api().inject({ method, url: path, remoteAddress: nextIp(), cookies, headers: { "content-type": "application/json" }, payload: "{".repeat(5000) });
      expect((await junk(stranger.cookies, events(gym.id), "POST")).statusCode).toBe(404);
      expect((await junk(stranger.cookies, `${events(gym.id)}/${randomUUID()}`, "PUT")).statusCode).toBe(404);
      expect((await junk({}, events(gym.id), "POST")).statusCode).toBe(401);
      expect((await junk(gym.owner.cookies, events(gym.id), "POST")).statusCode).toBe(400);
    },
    T,
  );
});
