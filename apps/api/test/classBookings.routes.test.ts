// BOOKING A CLASS, AND ITS WAITLIST — the routes against real Postgres (DATABASE_URL-gated),
// on two api instances over one database. Spec Part 3 §13.4; ROADMAP 17c-i.
//
// The worst thing this job could do to a real person: tell two people "You're booked" for
// the last place, or take a class off somebody's pack for a booking they never got. Those
// are the first two tests below.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { ClassBookingView, ClassSessionBookingsResponse } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createIoRedis, createMemoryRedis, type RedisLike } from "../src/redis.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "class-bookings-routes-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 180_000;
const LIVE_PLAN = "zz_classb_live";
/** Wednesday 7 October 2026, 07:30 in London. Its week is Monday 5 to Sunday 11 October. */
const NOW = new Date("2026-10-07T06:30:00Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24;

let ipCounter = 0;
const nextIp = () => `10.74.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
const desk = (): string => {
  const hex = randomUUID().replaceAll("-", "");
  return `10.${String(100 + (parseInt(hex.slice(0, 2), 16) % 100))}.${String(parseInt(hex.slice(2, 4), 16))}.${String((parseInt(hex.slice(4, 6), 16) % 254) + 1)}`;
};
const redisUrl = process.env["TEST_REDIS_URL"];
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("booking a class, and its waitlist (real Postgres, two api instances)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let clock = NOW.getTime();
  let app: App | undefined;
  let second: App | undefined;
  let redis: RedisLike | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const either = (n: number): App => (n % 2 === 0 ? api() : (second ?? api()));

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'classb-t-%@example.com')`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_class_bookings WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'classb-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST" | "DELETE", path: string, cookies: Cookies, payload?: unknown, ip = nextIp(), target = api()) =>
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
  }
  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `classb-t-${uniq()}@example.com`;
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
  const member = async (gym: Gym, name: string): Promise<Person> => {
    const person = await signedIn(name);
    await sql`INSERT INTO gym_members (gym_id, user_id, joined_at) VALUES (${gym.id}, ${person.userId}, '2026-01-01T00:00:00Z')`;
    return person;
  };
  /** A member who is on the gym's list: the record their memberships hang on. */
  const listed = async (gym: Gym, name: string): Promise<Person & { entryId: string }> => {
    const person = await member(gym, name);
    const res = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName: name, email: `classb-l-${uniq()}@example.com` });
    expect(res.statusCode, res.body).toBe(201);
    const entryId = (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
    await sql`UPDATE gym_members SET entry_id = ${entryId} WHERE gym_id = ${gym.id} AND user_id = ${person.userId}`;
    return { ...person, entryId };
  };

  /** A class `hours` from now, in a class type of its own unless one is named. */
  const classAt = async (gym: Gym, hours: number, places: number | null, over: { typeId?: string; openGym?: boolean; coach?: string; cancelled?: boolean } = {}) => {
    let typeId = over.typeId;
    if (typeId === undefined) {
      const [type] = await sql<{ id: string }[]>`
        INSERT INTO gym_class_types (gym_id, name, minutes, places, colour, open_gym)
        VALUES (${gym.id}, ${`Spin ${uniq()}`}, 45, ${places}, 'blue', ${over.openGym ?? false})
        RETURNING id`;
      typeId = type?.id;
    }
    if (typeId === undefined) throw new Error("no class type");
    const startsAt = new Date(clock + hours * HOUR);
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_class_sessions (gym_id, class_type_id, local_date, local_start_minute, starts_at, minutes, places, coach_user_id, status)
      SELECT ${gym.id}, ${typeId}, l::date, (EXTRACT(HOUR FROM l) * 60 + EXTRACT(MINUTE FROM l))::int, ${startsAt}, 45, ${places},
             ${over.coach ?? null}, ${over.cancelled === true ? "cancelled" : "scheduled"}
      FROM (SELECT ${startsAt}::timestamptz AT TIME ZONE 'Europe/London' AS l) x
      RETURNING id`;
    if (row === undefined) throw new Error("no class");
    return { id: row.id, typeId };
  };

  const typeOf = async (gym: Gym, over: { kind?: string; access?: string; limit?: number; period?: string; coversAll?: boolean } = {}): Promise<string> => {
    const pack = over.kind === "pack";
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_membership_types
        (gym_id, name, kind, price_minor, currency, term_count, term_unit, pack_classes, pack_days, access, bookings_limit, bookings_period, covers_all_classes)
      VALUES (${gym.id}, ${`Type ${uniq()}`}, ${over.kind ?? "recurring"}, 4000, 'GBP', ${pack ? null : 1}, ${pack ? null : "month"},
              ${pack ? 10 : null}, ${pack ? 60 : null}, ${over.access ?? "all_classes"}, ${over.limit ?? null}, ${over.period ?? null}, ${over.coversAll ?? true})
      RETURNING id`;
    if (row === undefined) throw new Error("no type");
    return row.id;
  };
  const hold = async (gym: Gym, entryId: string, typeId: string, over: { pack?: number; frozen?: boolean; startsOn?: string } = {}): Promise<string> => {
    const pack = over.pack !== undefined;
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_held_memberships
        (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit, pack_classes, pack_days,
         classes_left, starts_on, status, frozen_on, renews)
      VALUES (${gym.id}, ${entryId}, ${typeId}, gen_random_uuid(), ${pack ? "pack" : "recurring"}, 4000, 'GBP', ${pack ? null : 1}, ${pack ? null : "month"},
              ${pack ? 10 : null}, ${pack ? 60 : null}, ${over.pack ?? null}, ${over.startsOn ?? "2026-10-01"}::date,
              ${over.frozen === true ? "frozen" : "active"}, ${over.frozen === true ? "2026-10-05" : null}, ${!pack})
      RETURNING id`;
    if (row === undefined) throw new Error("no membership");
    return row.id;
  };
  const classesLeft = async (heldId: string): Promise<{ left: number | null; status: string }> => {
    const [row] = await sql<{ classes_left: number | null; status: string }[]>`SELECT classes_left, status FROM gym_held_memberships WHERE id = ${heldId}`;
    if (row === undefined) throw new Error("no membership");
    return { left: row.classes_left, status: row.status };
  };

  const bookingUrl = (gym: Gym, sessionId: string) => `/v1/orgs/${gym.id}/class-sessions/${sessionId}/booking`;
  const book = (gym: Gym, who: Person, sessionId: string, opts: { joinWaitlist?: boolean; key?: string; ip?: string; target?: App } = {}) =>
    inject("POST", bookingUrl(gym, sessionId), who.cookies, { requestKey: opts.key ?? randomUUID(), joinWaitlist: opts.joinWaitlist ?? false }, opts.ip ?? nextIp(), opts.target ?? api());
  const cancel = (gym: Gym, who: Person, sessionId: string, lateOk = false, target = api()) =>
    inject("POST", `${bookingUrl(gym, sessionId)}/cancel`, who.cookies, { lateOk }, nextIp(), target);
  const view = (res: { statusCode: number; body: string }): ClassBookingView => {
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { booking: ClassBookingView }).booking;
  };
  const seen = async (gym: Gym, who: Person, sessionId: string): Promise<ClassBookingView> => view(await inject("GET", bookingUrl(gym, sessionId), who.cookies));
  const staffList = async (gym: Gym, who: Person, sessionId: string): Promise<ClassSessionBookingsResponse> => {
    const res = await inject("GET", `/v1/orgs/${gym.id}/class-sessions/${sessionId}/bookings`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as ClassSessionBookingsResponse;
  };
  const errorOf = (res: { body: string }): string => (JSON.parse(res.body) as { error: string }).error;
  const tally = async (sessionId: string): Promise<Record<string, number>> => {
    const rows = await sql<{ status: string; n: number }[]>`SELECT status, count(*)::int AS n FROM gym_class_bookings WHERE session_id = ${sessionId} GROUP BY status`;
    return Object.fromEntries(rows.map((r) => [r.status, r.n]));
  };

  /** A gym with no membership types and fifty members, and one with types. */
  let open: Gym;
  const crowd: Person[] = [];
  let sells: Gym;

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    redis = redisUrl === undefined || redisUrl === "" ? createMemoryRedis() : createIoRedis(redisUrl);
    for (let tries = 0; (await redis.incrWithTtl(`classb-ready:${randomUUID()}`, 30)) === null; tries++) {
      if (tries === 100) throw new Error("the Redis at TEST_REDIS_URL never connected");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const overrides = { redis, orgs: { now: () => new Date(clock) } };
    app = await buildApp(loadConfig(baseEnv), overrides);
    await api().ready();
    second = await buildApp(loadConfig(baseEnv), overrides);
    await second.ready();

    open = await makeGym("Open Door");
    for (let n = 0; n < 50; n++) crowd.push(await member(open, `Member ${String(n)}`));
    sells = await makeGym("Price List");
    // The gym sells memberships: one type on its list is enough to make it so.
    await typeOf(sells);
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await second?.close();
    await redis?.close();
    await sql.end({ timeout: 5 });
  }, T);

  const person = (n: number): Person => {
    const p = crowd[n];
    if (p === undefined) throw new Error("no such member");
    return p;
  };

  it(
    "fifty people tap Book at the same instant on a class with one place: exactly one has it, twenty wait, the rest are told",
    async () => {
      const spin = await classAt(open, 3 * DAY, 1);
      const answers = await Promise.all(crowd.map((who, n) => book(open, who, spin.id, { joinWaitlist: true, target: either(n) })));
      const booked = answers.filter((r) => r.statusCode === 200 && view(r).mine?.status === "booked");
      const waiting = answers.filter((r) => r.statusCode === 200 && view(r).mine?.status === "waitlisted");
      const refused = answers.filter((r) => r.statusCode !== 200);
      expect(booked).toHaveLength(1);
      expect(waiting).toHaveLength(20);
      expect(refused).toHaveLength(29);
      expect(new Set(refused.map((r) => `${String(r.statusCode)} ${errorOf(r)}`))).toEqual(new Set(["409 waitlist_full"]));
      expect(await tally(spin.id)).toEqual({ booked: 1, waitlisted: 20 });
      // Every place in line is taken once, 1 to 20.
      const places = await Promise.all(
        crowd.map(async (who) => (await seen(open, who, spin.id)).mine?.waitlistPlace ?? null),
      );
      expect(places.filter((p) => p !== null).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));

      // Without asking for the waitlist, everybody but the one is told the class is full.
      const second = await classAt(open, 3 * DAY, 1);
      const plain = await Promise.all(crowd.map((who, n) => book(open, who, second.id, { target: either(n) })));
      expect(plain.filter((r) => r.statusCode === 200)).toHaveLength(1);
      expect(new Set(plain.filter((r) => r.statusCode !== 200).map(errorOf))).toEqual(new Set(["class_full"]));
      expect(await tally(second.id)).toEqual({ booked: 1 });
    },
    T,
  );

  it(
    "a pack is charged exactly once however often the request arrives, and gets the class back on a free cancel",
    async () => {
      const packType = await typeOf(sells, { kind: "pack" });
      const who = await listed(sells, "Pia Pack");
      const pack = await hold(sells, who.entryId, packType, { pack: 10 });
      const yoga = await classAt(sells, 3 * DAY, 12);

      // The same request ten times at once, on two servers.
      const key = randomUUID();
      const same = await Promise.all(Array.from({ length: 10 }, (_, n) => book(sells, who, yoga.id, { key, target: either(n) })));
      expect(same.map((r) => r.statusCode)).toEqual(Array.from({ length: 10 }, () => 200));
      expect(await tally(yoga.id)).toEqual({ booked: 1 });
      expect((await classesLeft(pack)).left).toBe(9);
      // And five more taps, each a request of its own.
      const more = await Promise.all(Array.from({ length: 5 }, (_, n) => book(sells, who, yoga.id, { target: either(n) })));
      expect(more.map((r) => view(r).mine?.status)).toEqual(Array.from({ length: 5 }, () => "booked"));
      expect(await tally(yoga.id)).toEqual({ booked: 1 });
      expect((await classesLeft(pack)).left).toBe(9);
      expect((await seen(sells, who, yoga.id)).mine).toEqual({ status: "booked", waitlistPlace: null, packCharged: true });

      // A free cancel, five times at once: the class comes back once.
      const cancels = await Promise.all(Array.from({ length: 5 }, (_, n) => cancel(sells, who, yoga.id, false, either(n))));
      expect(cancels.map((r) => view(r).mine?.status)).toEqual(Array.from({ length: 5 }, () => "cancelled"));
      expect((await classesLeft(pack)).left).toBe(10);
      expect(await tally(yoga.id)).toEqual({ cancelled: 1 });

      // The first request arriving late, after the cancel: it books nothing and charges nothing.
      const late = view(await book(sells, who, yoga.id, { key }));
      expect(late.mine?.status).toBe("cancelled");
      expect(await tally(yoga.id)).toEqual({ cancelled: 1 });
      expect((await classesLeft(pack)).left).toBe(10);
      // A new tap books again and charges once.
      expect(view(await book(sells, who, yoga.id)).mine?.status).toBe("booked");
      expect((await classesLeft(pack)).left).toBe(9);
      // Somebody else's key is not theirs to use.
      const other = await listed(sells, "Otto Other");
      await hold(sells, other.entryId, packType, { pack: 10 });
      const stolen = await book(sells, other, yoga.id, { key });
      expect([stolen.statusCode, errorOf(stolen)]).toEqual([409, "request_reused"]);
    },
    T,
  );

  it(
    "a pack's last class: the pack ends when it is used and runs again when a free cancel gives it back",
    async () => {
      const packType = await typeOf(sells, { kind: "pack" });
      const who = await listed(sells, "Lena Last");
      const pack = await hold(sells, who.entryId, packType, { pack: 1 });
      const first = await classAt(sells, 3 * DAY, 12);
      const other = await classAt(sells, 4 * DAY, 12);
      expect(view(await book(sells, who, first.id)).mine?.status).toBe("booked");
      expect((await classesLeft(pack)).left).toBe(0);
      const refused = await book(sells, who, other.id);
      expect([refused.statusCode, errorOf(refused)]).toEqual([403, "no_membership"]);
      // A write on the record marks the used-up pack ended, as the person's page does.
      await sql`UPDATE gym_held_memberships SET status = 'ended' WHERE id = ${pack}`;
      expect(view(await cancel(sells, who, first.id)).mine?.status).toBe("cancelled");
      expect(await classesLeft(pack)).toEqual({ left: 1, status: "active" });
      expect(view(await book(sells, who, other.id)).mine?.status).toBe("booked");
    },
    T,
  );

  it(
    "nobody outside the gym reads or changes a booking, and only staff who run the timetable or coach the class read its list",
    async () => {
      const coach = await signedIn("Cora Coach");
      const trainer = await signedIn("Tom Trainer");
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${open.id}, ${coach.userId}, 'trainer', NULL), (${open.id}, ${trainer.userId}, 'trainer', NULL)`;
      const spin = await classAt(open, 3 * DAY, 5, { coach: coach.userId });
      const inside = person(0);
      expect(view(await book(open, inside, spin.id)).mine?.status).toBe("booked");

      const stranger = await signedIn("Sam Stranger");
      const elsewhere = await makeGym("Other Gym");
      const theirMember = await member(elsewhere, "Theo Theirs");
      const theirClass = await classAt(elsewhere, 3 * DAY, 5);
      const gone = await member(open, "Gina Gone");
      await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${open.id} AND user_id = ${gone.userId}`;

      for (const who of [stranger, theirMember, elsewhere.owner, gone, trainer]) {
        const answers = [
          await inject("GET", bookingUrl(open, spin.id), who.cookies),
          await book(open, who, spin.id),
          await cancel(open, who, spin.id),
        ];
        expect(answers.map((r) => `${String(r.statusCode)} ${errorOf(r)}`), who.name).toEqual(Array.from({ length: 3 }, () => "404 org_not_found"));
      }
      for (const who of [stranger, theirMember, elsewhere.owner, gone, inside]) {
        const res = await inject("GET", `/v1/orgs/${open.id}/class-sessions/${spin.id}/bookings`, who.cookies);
        expect(`${String(res.statusCode)} ${errorOf(res)}`, who.name).toBe("404 org_not_found");
      }
      // Nobody signed in.
      expect((await inject("GET", bookingUrl(open, spin.id), {})).statusCode).toBe(401);
      expect((await inject("POST", bookingUrl(open, spin.id), {}, { requestKey: randomUUID(), joinWaitlist: false })).statusCode).toBe(401);
      expect((await inject("POST", `${bookingUrl(open, spin.id)}/cancel`, {}, { lateOk: false })).statusCode).toBe(401);
      expect((await inject("GET", `/v1/orgs/${open.id}/class-sessions/${spin.id}/bookings`, {})).statusCode).toBe(401);
      // Another gym's class named under this gym is no class of this gym, for a member and for its owner.
      const crossed = await book(open, inside, theirClass.id);
      expect([crossed.statusCode, errorOf(crossed)]).toEqual([404, "class_not_found"]);
      expect((await inject("GET", bookingUrl(open, theirClass.id), inside.cookies)).statusCode).toBe(404);
      expect((await inject("GET", `/v1/orgs/${open.id}/class-sessions/${theirClass.id}/bookings`, open.owner.cookies)).statusCode).toBe(404);
      expect(await tally(spin.id)).toEqual({ booked: 1 });
      expect(await tally(theirClass.id)).toEqual({});

      // The list: the owner and the class's coach read it; another trainer does not.
      const list = await staffList(open, open.owner, spin.id);
      expect(list.booked.map((b) => [b.name, b.status, b.membership, b.packCharged])).toEqual([[inside.name, "booked", null, false]]);
      expect((await staffList(open, coach, spin.id)).booked).toHaveLength(1);
      const other = await inject("GET", `/v1/orgs/${open.id}/class-sessions/${spin.id}/bookings`, trainer.cookies);
      expect([other.statusCode, errorOf(other)]).toEqual([403, "forbidden"]);

      // A gym whose plan has lapsed: its members book nothing.
      const lapsed = await makeGym("Lapsed Gym");
      const theirs = await member(lapsed, "Lara Lapsed");
      const lapsedClass = await classAt(lapsed, 3 * DAY, 5);
      await sql`UPDATE subscriptions SET status = 'canceled' WHERE owner_type = 'gym' AND owner_id = ${lapsed.id}`;
      expect((await book(lapsed, theirs, lapsedClass.id)).statusCode).toBe(404);
      expect(await tally(lapsedClass.id)).toEqual({});
    },
    T,
  );

  it(
    "a request that is not a booking request is refused before anything is read",
    async () => {
      const spin = await classAt(open, 3 * DAY, 5);
      const who = person(1);
      for (const body of [{}, { requestKey: "nope", joinWaitlist: false }, { requestKey: randomUUID() }, { requestKey: randomUUID(), joinWaitlist: false, extra: 1 }]) {
        expect((await inject("POST", bookingUrl(open, spin.id), who.cookies, body)).statusCode).toBe(400);
      }
      expect((await inject("POST", `${bookingUrl(open, spin.id)}/cancel`, who.cookies, {})).statusCode).toBe(400);
      expect((await inject("GET", `/v1/orgs/${open.id}/class-sessions/not-an-id/booking`, who.cookies)).statusCode).toBe(400);
      expect(await tally(spin.id)).toEqual({});
    },
    T,
  );

  it(
    "booking opens 7 days before and closes at the start, and a cancelled class takes none",
    async () => {
      const who = person(2);
      const far = await classAt(open, 7 * DAY + 1, 5);
      const early = await book(open, who, far.id);
      expect([early.statusCode, errorOf(early)]).toEqual([409, "not_open_yet"]);
      expect((await seen(open, who, far.id)).can).toEqual({ book: false, joinWaitlist: false, claim: false, cancel: null, why: "not_open_yet" });
      const edge = await classAt(open, 7 * DAY, 5);
      expect(view(await book(open, who, edge.id)).mine?.status).toBe("booked");

      const begun = await classAt(open, -0.25, 5);
      const late = await book(open, who, begun.id);
      expect([late.statusCode, errorOf(late)]).toEqual([409, "class_started"]);
      const off = await classAt(open, 3 * DAY, 5, { cancelled: true });
      const none = await book(open, who, off.id);
      expect([none.statusCode, errorOf(none)]).toEqual([409, "class_cancelled"]);

      const soon = await classAt(open, 3 * DAY, 5);
      const before = await seen(open, who, soon.id);
      expect(before.can).toEqual({ book: true, joinWaitlist: false, claim: false, cancel: null, why: null });
      expect([before.places, before.booked, before.waitlisted, before.timezone, before.cancelled]).toEqual([5, 0, 0, "Europe/London", false]);
      expect(before.opensAt).toBe(new Date(clock + 3 * DAY * HOUR - 7 * DAY * HOUR).toISOString());
      expect(before.freeCancelUntil).toBe(new Date(clock + 3 * DAY * HOUR - 2 * HOUR).toISOString());
      // 07:30 in London on Saturday 10 October.
      expect([before.localDate, before.localStartMinute]).toEqual(["2026-10-10", 7 * 60 + 30]);
    },
    T,
  );

  it(
    "who may book where the gym sells memberships: the right membership, within its bookings a week",
    async () => {
      const yoga = await classAt(sells, 2 * DAY, 12);
      const pilates = await classAt(sells, 2 * DAY, 12);
      const openGym = await classAt(sells, 2 * DAY, null, { openGym: true });
      const no = (res: { statusCode: number; body: string }) => `${String(res.statusCode)} ${errorOf(res)}`;

      // On the app but not on the gym's list, and on the list with no membership.
      const unlisted = await member(sells, "Una Unlisted");
      expect(no(await book(sells, unlisted, yoga.id))).toBe("403 no_membership");
      const bare = await listed(sells, "Ben Bare");
      expect(no(await book(sells, bare, yoga.id))).toBe("403 no_membership");
      expect((await seen(sells, bare, yoga.id)).can.why).toBe("no_membership");

      // Frozen, and one that starts after the class.
      const frozen = await listed(sells, "Freya Frozen");
      await hold(sells, frozen.entryId, await typeOf(sells), { frozen: true });
      expect(no(await book(sells, frozen, yoga.id))).toBe("403 no_membership");
      const later = await listed(sells, "Lars Later");
      await hold(sells, later.entryId, await typeOf(sells), { startsOn: "2026-10-12" });
      expect(no(await book(sells, later, yoga.id))).toBe("403 no_membership");

      // A membership that names its classes covers those and no other.
      const yogaOnly = await typeOf(sells, { coversAll: false });
      await sql`INSERT INTO gym_membership_type_classes (membership_type_id, class_type_id, gym_id) VALUES (${yogaOnly}, ${yoga.typeId}, ${sells.id})`;
      const yogi = await listed(sells, "Yara Yogi");
      await hold(sells, yogi.entryId, yogaOnly);
      expect(view(await book(sells, yogi, yoga.id)).mine?.status).toBe("booked");
      expect(no(await book(sells, yogi, pilates.id))).toBe("403 not_covered");

      // Gym only: the open-gym slot, and no class.
      const gymOnly = await listed(sells, "Gus Gym");
      await hold(sells, gymOnly.entryId, await typeOf(sells, { access: "gym_only" }));
      expect(no(await book(sells, gymOnly, yoga.id))).toBe("403 not_covered");
      expect(view(await book(sells, gymOnly, openGym.id)).mine?.status).toBe("booked");

      // Two bookings a week. Thursday and Friday use them; Saturday is refused; next Tuesday is a new week.
      const twice = await listed(sells, "Tess Twice");
      await hold(sells, twice.entryId, await typeOf(sells, { access: "limited", limit: 2, period: "week" }));
      const thu = await classAt(sells, 1 * DAY, 12);
      const fri = await classAt(sells, 2 * DAY, 12);
      const sat = await classAt(sells, 3 * DAY, 12);
      const sun = await classAt(sells, 4 * DAY, 12);
      const tue = await classAt(sells, 6 * DAY, 12);
      expect(view(await book(sells, twice, thu.id)).mine?.status).toBe("booked");
      expect(view(await book(sells, twice, fri.id)).mine?.status).toBe("booked");
      expect(no(await book(sells, twice, sat.id))).toBe("409 limit_week");
      expect(no(await book(sells, twice, sun.id))).toBe("409 limit_week");
      expect((await seen(sells, twice, sat.id)).can.why).toBe("limit_week");
      expect(view(await book(sells, twice, tue.id)).mine?.status).toBe("booked");
      // A free cancel gives the booking back to the week.
      expect(view(await cancel(sells, twice, fri.id)).mine?.status).toBe("cancelled");
      expect(view(await book(sells, twice, sat.id)).mine?.status).toBe("booked");
      expect(no(await book(sells, twice, fri.id))).toBe("409 limit_week");
      // A late cancel does not: the class still counts.
      const tonight = await classAt(sells, 1, 12);
      const nightly = await listed(sells, "Nina Nightly");
      await hold(sells, nightly.entryId, await typeOf(sells, { access: "limited", limit: 1, period: "week" }));
      expect(view(await book(sells, nightly, tonight.id)).mine?.status).toBe("booked");
      expect(view(await cancel(sells, nightly, tonight.id, true)).mine?.status).toBe("late_cancelled");
      expect(no(await book(sells, nightly, sat.id))).toBe("409 limit_week");

      // The limit is the person's, on two servers at once: one booking a week, two classes tapped together.
      for (let round = 0; round < 10; round++) {
        const racer = await listed(sells, `Rae Racer ${String(round)}`);
        await hold(sells, racer.entryId, await typeOf(sells, { access: "limited", limit: 1, period: "week" }));
        const both = await Promise.all([book(sells, racer, thu.id, { target: api() }), book(sells, racer, sat.id, { target: second ?? api() })]);
        expect(both.map((r) => r.statusCode).sort(), `round ${String(round)}`).toEqual([200, 409]);
      }

      // The staff list names the membership each booking is on.
      const [yogaOnlyType] = await sql<{ name: string }[]>`SELECT name FROM gym_membership_types WHERE id = ${yogaOnly}`;
      const list = await staffList(sells, sells.owner, yoga.id);
      expect(list.booked.map((b) => [b.name, b.packCharged, b.membership])).toEqual([["Yara Yogi", false, yogaOnlyType?.name]]);

      // Two bookings a MONTH: Thursday 8 and Tuesday 13 October use them, in two different
      // weeks; Saturday 10 October is refused for the month.
      const monthly = await listed(sells, "Mona Monthly");
      await hold(sells, monthly.entryId, await typeOf(sells, { access: "limited", limit: 2, period: "month" }));
      expect(view(await book(sells, monthly, thu.id)).mine?.status).toBe("booked");
      expect(view(await book(sells, monthly, tue.id)).mine?.status).toBe("booked");
      expect(no(await book(sells, monthly, sat.id))).toBe("409 limit_month");

      // A class staff cancelled does not use up the week.
      const once = await listed(sells, "Olive Once");
      await hold(sells, once.entryId, await typeOf(sells, { access: "limited", limit: 1, period: "week" }));
      const called = await classAt(sells, 1 * DAY, 12);
      expect(view(await book(sells, once, called.id)).mine?.status).toBe("booked");
      expect(no(await book(sells, once, sat.id))).toBe("409 limit_week");
      await sql`UPDATE gym_class_sessions SET status = 'cancelled' WHERE id = ${called.id}`;
      expect(view(await book(sells, once, sat.id)).mine?.status).toBe("booked");
    },
    T,
  );

  it(
    "a freed place more than a day before the class goes to the first in line who may book, and their pack is charged then",
    async () => {
      const packType = await typeOf(sells, { kind: "pack" });
      const unlimited = await typeOf(sells);
      const [holder, first, secondInLine, third] = await Promise.all(["Hal Holder", "Fay First", "Sid Second", "Thea Third"].map((n) => listed(sells, n)));
      if (holder === undefined || first === undefined || secondInLine === undefined || third === undefined) throw new Error("no people");
      await hold(sells, holder.entryId, unlimited);
      // The first in line has a pack with nothing left by the time the place is free.
      const emptied = await hold(sells, first.entryId, packType, { pack: 1 });
      const pack = await hold(sells, secondInLine.entryId, packType, { pack: 10 });
      await hold(sells, third.entryId, unlimited);
      const coach = await signedIn("Cleo Coach");
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${sells.id}, ${coach.userId}, 'trainer', NULL)`;
      const spin = await classAt(sells, 3 * DAY, 1, { coach: coach.userId });

      expect(view(await book(sells, holder, spin.id)).mine?.status).toBe("booked");
      for (const who of [first, secondInLine, third]) {
        expect(view(await book(sells, who, spin.id, { joinWaitlist: true })).mine?.status).toBe("waitlisted");
      }
      // Waiting has charged nobody.
      expect((await classesLeft(pack)).left).toBe(10);
      expect((await seen(sells, secondInLine, spin.id)).mine).toEqual({ status: "waitlisted", waitlistPlace: 2, packCharged: false });
      await sql`UPDATE gym_held_memberships SET classes_left = 0 WHERE id = ${emptied}`;

      expect(view(await cancel(sells, holder, spin.id)).mine?.status).toBe("cancelled");
      // The first cannot be covered and stays first in line; the second has the place and is charged once.
      expect((await seen(sells, first, spin.id)).mine).toEqual({ status: "waitlisted", waitlistPlace: 1, packCharged: false });
      expect((await seen(sells, secondInLine, spin.id)).mine).toEqual({ status: "booked", waitlistPlace: null, packCharged: true });
      expect((await seen(sells, third, spin.id)).mine).toEqual({ status: "waitlisted", waitlistPlace: 2, packCharged: false });
      expect((await classesLeft(pack)).left).toBe(9);
      expect(await tally(spin.id)).toEqual({ booked: 1, waitlisted: 2, cancelled: 1 });
      const list = await staffList(sells, sells.owner, spin.id);
      expect(list.booked.map((b) => [b.name, b.packCharged])).toEqual([["Sid Second", true]]);
      expect(list.waitlisted.map((b) => b.name)).toEqual(["Fay First", "Thea Third"]);
      expect(typeof list.booked[0]?.membership).toBe("string");
      // The class's coach reads who is coming, and not what they pay with.
      const coachList = await staffList(sells, coach, spin.id);
      expect(coachList.booked.map((b) => [b.name, b.membership, b.packCharged])).toEqual([["Sid Second", null, null]]);
      expect(coachList.waitlisted.map((b) => [b.name, b.membership, b.packCharged])).toEqual([["Fay First", null, null], ["Thea Third", null, null]]);

      // Leaving the waitlist frees no place and moves nobody.
      expect(view(await cancel(sells, third, spin.id)).mine?.status).toBe("cancelled");
      expect(await tally(spin.id)).toEqual({ booked: 1, waitlisted: 1, cancelled: 2 });
      // The one who cancelled may book again: with the class full they are told so.
      const back = await book(sells, holder, spin.id);
      expect([back.statusCode, errorOf(back)]).toEqual([409, "class_full"]);
    },
    T,
  );

  it(
    "inside the last day a freed place is not handed over: the first to claim it has it",
    async () => {
      const [holder, first, later, walkUp] = [person(3), person(4), person(5), person(6)];
      const spin = await classAt(open, 5, 1);
      expect(view(await book(open, holder, spin.id)).mine?.status).toBe("booked");
      expect(view(await book(open, first, spin.id, { joinWaitlist: true })).mine?.waitlistPlace).toBe(1);
      expect(view(await book(open, later, spin.id, { joinWaitlist: true })).mine?.waitlistPlace).toBe(2);
      expect((await seen(open, later, spin.id)).can).toEqual({ book: false, joinWaitlist: false, claim: false, cancel: "free", why: null });

      expect(view(await cancel(open, holder, spin.id)).mine?.status).toBe("cancelled");
      expect(await tally(spin.id)).toEqual({ waitlisted: 2, cancelled: 1 });
      expect((await seen(open, later, spin.id)).can.claim).toBe(true);
      // The second in line taps first and has it.
      expect(view(await book(open, later, spin.id)).mine).toEqual({ status: "booked", waitlistPlace: null, packCharged: false });
      const tooLate = view(await book(open, first, spin.id));
      expect(tooLate.mine).toEqual({ status: "waitlisted", waitlistPlace: 1, packCharged: false });
      expect(tooLate.can.claim).toBe(false);
      const full = await book(open, walkUp, spin.id);
      expect([full.statusCode, errorOf(full)]).toEqual([409, "class_full"]);
      expect(await tally(spin.id)).toEqual({ booked: 1, waitlisted: 1, cancelled: 1 });
    },
    T,
  );

  it(
    "a cancel inside the last 2 hours is a late cancel: it asks first, keeps the pack's charge and frees the place",
    async () => {
      const packType = await typeOf(sells, { kind: "pack" });
      const who = await listed(sells, "Lottie Late");
      const pack = await hold(sells, who.entryId, packType, { pack: 10 });
      const spin = await classAt(sells, 1.5, 1);
      expect(view(await book(sells, who, spin.id)).can.cancel).toBe("late");
      expect((await classesLeft(pack)).left).toBe(9);

      const asked = await cancel(sells, who, spin.id);
      expect(asked.statusCode).toBe(409);
      expect(JSON.parse(asked.body)).toMatchObject({ error: "late_cancel", packCharged: true });
      expect(await tally(spin.id)).toEqual({ booked: 1 });

      const done = view(await cancel(sells, who, spin.id, true));
      expect(done.mine).toEqual({ status: "late_cancelled", waitlistPlace: null, packCharged: true });
      expect((await classesLeft(pack)).left).toBe(9);
      expect([done.booked, done.can.book]).toEqual([0, true]);
      const list = await staffList(sells, sells.owner, spin.id);
      expect([list.booked.length, list.lateCancelled.map((b) => b.name), list.lateCancelledTotal]).toEqual([0, ["Lottie Late"], 1]);

      // At exactly 2 hours it is still free; once the class has started it cannot be cancelled.
      const edge = await classAt(sells, 2, 5);
      expect(view(await book(sells, who, edge.id)).can.cancel).toBe("free");
      expect(view(await cancel(sells, who, edge.id)).mine?.status).toBe("cancelled");
      expect((await classesLeft(pack)).left).toBe(8 + 1);
      const begun = await classAt(sells, 1, 5);
      expect(view(await book(sells, who, begun.id)).mine?.status).toBe("booked");
      clock += 2 * HOUR;
      try {
        const over = await cancel(sells, who, begun.id, true);
        expect([over.statusCode, errorOf(over)]).toEqual([409, "class_started"]);
        const never = await cancel(sells, who, (await classAt(sells, 3 * DAY, 5)).id, true);
        expect([never.statusCode, errorOf(never)]).toEqual([404, "no_booking"]);
      } finally {
        clock -= 2 * HOUR;
      }
    },
    T,
  );

  it(
    "a cancel and a booking at the same instant on two servers never leave two people in one place, nor a pack out of step",
    async () => {
      const packType = await typeOf(sells, { kind: "pack" });
      const [a, b] = await Promise.all([listed(sells, "Ava At-once"), listed(sells, "Bo At-once")]);
      const packA = await hold(sells, a.entryId, packType, { pack: 10 });
      const packB = await hold(sells, b.entryId, packType, { pack: 10 });
      for (let round = 0; round < 25; round++) {
        const spin = await classAt(sells, 5, 1);
        expect(view(await book(sells, a, spin.id)).mine?.status).toBe("booked");
        const [gone, taken] = await Promise.all([cancel(sells, a, spin.id, false, api()), book(sells, b, spin.id, { target: second ?? api() })]);
        expect(gone.statusCode, `round ${String(round)}`).toBe(200);
        const t = await tally(spin.id);
        expect(t["booked"] ?? 0, `round ${String(round)}`).toBeLessThanOrEqual(1);
        // B either had the place or was told it was full; the pack says which.
        const bBooked = taken.statusCode === 200;
        if (!bBooked) expect(errorOf(taken)).toBe("class_full");
        expect(t).toEqual(bBooked ? { booked: 1, cancelled: 1 } : { cancelled: 1 });
        if (bBooked) expect(view(await cancel(sells, b, spin.id)).mine?.status).toBe("cancelled");
        expect([(await classesLeft(packA)).left, (await classesLeft(packB)).left], `round ${String(round)}`).toEqual([10, 10]);
      }
    },
    T,
  );

  it(
    "two records of one person joined: their bookings follow the record that is kept",
    async () => {
      const who = await listed(sells, "Dana Double");
      await hold(sells, who.entryId, await typeOf(sells));
      const spin = await classAt(sells, 3 * DAY, 5);
      expect(view(await book(sells, who, spin.id)).mine?.status).toBe("booked");
      const res = await inject("POST", `/v1/orgs/${sells.id}/member-list/entries`, sells.owner.cookies, { fullName: "Dana Dubble", email: `classb-l-${uniq()}@example.com` });
      expect(res.statusCode, res.body).toBe(201);
      const keep = (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
      const joined = await inject("POST", `/v1/orgs/${sells.id}/member-list/entries/${who.entryId}/merge`, sells.owner.cookies, { keepEntryId: keep, acknowledgeLeavesList: true });
      expect(joined.statusCode, joined.body).toBe(200);
      const rows = await sql<{ entry_id: string | null; status: string }[]>`SELECT entry_id, status FROM gym_class_bookings WHERE session_id = ${spin.id}`;
      expect(rows.map((r) => [r.entry_id, r.status])).toEqual([[keep, "booked"]]);
      // Still theirs to cancel, and their membership moved with them.
      expect(view(await cancel(sells, who, spin.id)).mine?.status).toBe("cancelled");
      expect(view(await book(sells, who, spin.id)).mine?.status).toBe("booked");
    },
    T,
  );

  it(
    "one person's taps are limited, and a gym's members on one wi-fi address are not held up by each other",
    async () => {
      const address = desk();
      const spin = await classAt(open, 3 * DAY, null);
      // Somebody who has tapped nothing yet this hour.
      const busy = await member(open, "Bea Busy");
      const codes: number[] = [];
      for (let n = 0; n < 125; n++) codes.push((await book(open, busy, spin.id, { ip: address })).statusCode);
      expect(codes.slice(0, 120).every((c) => c === 200)).toBe(true);
      expect(codes.slice(120)).toEqual([429, 429, 429, 429, 429]);
      for (const other of [person(8), person(9), person(10)]) {
        expect((await book(open, other, spin.id, { ip: address })).statusCode).toBe(200);
      }
      // A stranger at that address gets the 404, not the limit's answer.
      const stranger = await signedIn("Sol Stranger");
      for (let n = 0; n < 3; n++) expect((await book(open, stranger, spin.id, { ip: address })).statusCode).toBe(404);
    },
    T,
  );
  it(
    "a Claim sent again after its booking was cancelled books nothing and charges nothing",
    async () => {
      const packType = await typeOf(sells, { kind: "pack" });
      const [holder, waiter] = await Promise.all([listed(sells, "Hana Holder"), listed(sells, "Wes Waiter")]);
      await hold(sells, holder.entryId, await typeOf(sells));
      const pack = await hold(sells, waiter.entryId, packType, { pack: 10 });
      const spin = await classAt(sells, 5, 1);
      expect(view(await book(sells, holder, spin.id)).mine?.status).toBe("booked");
      const joined = randomUUID();
      expect(view(await book(sells, waiter, spin.id, { joinWaitlist: true, key: joined })).mine?.status).toBe("waitlisted");
      expect(view(await cancel(sells, holder, spin.id)).mine?.status).toBe("cancelled");

      const claim = randomUUID();
      expect(view(await book(sells, waiter, spin.id, { key: claim })).mine).toEqual({ status: "booked", waitlistPlace: null, packCharged: true });
      expect((await classesLeft(pack)).left).toBe(9);
      // The Claim again while it stands: the same booking.
      expect(view(await book(sells, waiter, spin.id, { key: claim, target: second ?? api() })).mine?.status).toBe("booked");
      expect((await classesLeft(pack)).left).toBe(9);

      expect(view(await cancel(sells, waiter, spin.id)).mine?.status).toBe("cancelled");
      expect((await classesLeft(pack)).left).toBe(10);
      // The Claim arriving again, and the Join waitlist request that made the row: neither books.
      for (const key of [claim, joined, claim]) {
        expect(view(await book(sells, waiter, spin.id, { key, joinWaitlist: key === joined })).mine?.status).toBe("cancelled");
      }
      expect(await tally(spin.id)).toEqual({ cancelled: 2 });
      expect((await classesLeft(pack)).left).toBe(10);
      // Somebody else cannot use the Claim's key either.
      const stolen = await book(sells, holder, spin.id, { key: claim });
      expect([stolen.statusCode, errorOf(stolen)]).toEqual([409, "request_reused"]);
      // A new tap books again, once.
      expect(view(await book(sells, waiter, spin.id)).mine?.status).toBe("booked");
      expect((await classesLeft(pack)).left).toBe(9);
    },
    T,
  );

  it(
    "outside the last day a place that comes free without a cancel is the first in line's: Book hands it over before it decides, and the screen says so",
    async () => {
      const [holder, waiter, walkUp] = [person(11), person(12), person(13)];
      const spin = await classAt(open, 3 * DAY, 1);
      expect(view(await book(open, holder, spin.id)).mine?.status).toBe("booked");
      expect(view(await book(open, waiter, spin.id, { joinWaitlist: true })).mine?.status).toBe("waitlisted");
      const behind = person(15);
      expect(view(await book(open, behind, spin.id, { joinWaitlist: true })).mine?.waitlistPlace).toBe(2);
      // Staff make the class bigger.
      await sql`UPDATE gym_class_sessions SET places = 2 WHERE id = ${spin.id}`;

      // The place is the first in line's to claim, and not the second's.
      expect((await seen(open, waiter, spin.id)).can.claim).toBe(true);
      expect((await seen(open, behind, spin.id)).can).toEqual({ book: false, joinWaitlist: false, claim: false, cancel: "free", why: null });
      // Somebody not waiting sees a class they cannot book, though one place reads free.
      const before = await seen(open, walkUp, spin.id);
      expect([before.booked, before.places, before.waitlisted]).toEqual([1, 2, 2]);
      expect(before.can).toEqual({ book: false, joinWaitlist: true, claim: false, cancel: null, why: null });
      const refused = await book(open, walkUp, spin.id);
      expect([refused.statusCode, errorOf(refused)]).toEqual([409, "class_full"]);
      // Their tap gave the place to the one who was waiting.
      expect((await seen(open, waiter, spin.id)).mine).toEqual({ status: "booked", waitlistPlace: null, packCharged: false });
      expect(await tally(spin.id)).toEqual({ booked: 2, waitlisted: 1 });

      // Two app accounts on ONE record, one booking a week between them, both waiting, two
      // places free: the first has the week's booking and the second is passed over.
      const [keeper, one] = await Promise.all([listed(sells, "Kit Keeper"), listed(sells, "Uma One")]);
      await hold(sells, keeper.entryId, await typeOf(sells));
      await hold(sells, one.entryId, await typeOf(sells, { access: "limited", limit: 1, period: "week" }));
      const twin = await member(sells, "Uma Two");
      await sql`UPDATE gym_members SET entry_id = ${one.entryId} WHERE gym_id = ${sells.id} AND user_id = ${twin.userId}`;
      const shared = await classAt(sells, 3 * DAY, 1);
      expect(view(await book(sells, keeper, shared.id)).mine?.status).toBe("booked");
      for (const who of [one, twin]) expect(view(await book(sells, who, shared.id, { joinWaitlist: true })).mine?.status).toBe("waitlisted");
      await sql`UPDATE gym_class_sessions SET places = 3 WHERE id = ${shared.id}`;
      // The second's screen does not offer them a place they would not get.
      expect((await seen(sells, twin, shared.id)).can.claim).toBe(false);
      expect(view(await cancel(sells, keeper, shared.id)).mine?.status).toBe("cancelled");
      expect((await seen(sells, one, shared.id)).mine?.status).toBe("booked");
      expect((await seen(sells, twin, shared.id)).mine).toEqual({ status: "waitlisted", waitlistPlace: 1, packCharged: false });
      expect(await tally(shared.id)).toEqual({ booked: 1, waitlisted: 1, cancelled: 1 });

      // Where the one waiting may not book, the place is anybody's: the screen says Book, and Book gives it.
      const unlimited = await typeOf(sells);
      const [has, stuck, free] = await Promise.all([listed(sells, "Hugo Has"), listed(sells, "Stu Stuck"), listed(sells, "Fran Free")]);
      await hold(sells, has.entryId, unlimited);
      const emptied = await hold(sells, stuck.entryId, await typeOf(sells, { kind: "pack" }), { pack: 1 });
      await hold(sells, free.entryId, unlimited);
      const yoga = await classAt(sells, 3 * DAY, 1);
      expect(view(await book(sells, has, yoga.id)).mine?.status).toBe("booked");
      expect(view(await book(sells, stuck, yoga.id, { joinWaitlist: true })).mine?.status).toBe("waitlisted");
      await sql`UPDATE gym_held_memberships SET classes_left = 0 WHERE id = ${emptied}`;
      await sql`UPDATE gym_class_sessions SET places = 2 WHERE id = ${yoga.id}`;
      expect((await seen(sells, free, yoga.id)).can).toEqual({ book: true, joinWaitlist: false, claim: false, cancel: null, why: null });
      expect(view(await book(sells, free, yoga.id)).mine?.status).toBe("booked");
      expect((await seen(sells, stuck, yoga.id)).mine).toEqual({ status: "waitlisted", waitlistPlace: 1, packCharged: false });
    },
    T,
  );

  it(
    "a request's key is the gym's own, and a deleted account's name is not on the staff list",
    async () => {
      const other = await makeGym("Second Gym");
      const both = await member(open, "Bella Both");
      await sql`INSERT INTO gym_members (gym_id, user_id, joined_at) VALUES (${other.id}, ${both.userId}, '2026-01-01T00:00:00Z')`;
      const here = await classAt(open, 3 * DAY, 5);
      const there = await classAt(other, 3 * DAY, 5);
      const key = randomUUID();
      expect(view(await book(open, both, here.id, { key })).mine?.status).toBe("booked");
      expect(view(await book(other, both, there.id, { key })).mine?.status).toBe("booked");
      expect([await tally(here.id), await tally(there.id)]).toEqual([{ booked: 1 }, { booked: 1 }]);

      expect((await staffList(open, open.owner, here.id)).booked.map((b) => b.name)).toEqual(["Bella Both"]);
      await sql`UPDATE users SET status = 'deleted' WHERE id = ${both.userId}`;
      expect((await staffList(open, open.owner, here.id)).booked.map((b) => [b.name, b.initials, b.status])).toEqual([[null, "", "booked"]]);
    },
    T,
  );

  it(
    "a class somebody has booked is not deleted from under them: staff are told why, in words",
    async () => {
      // The timetable's routes read the real clock, so this class is three days from today.
      const kept = clock;
      clock = Date.now();
      try {
        const who = person(14);
        const booked = await classAt(open, 3 * DAY, 5);
        const empty = await classAt(open, 3 * DAY, 5);
        const [slot] = await sql<{ id: string }[]>`
          INSERT INTO gym_class_schedules (gym_id, class_type_id, weekdays, local_start_minute, starts_on, minutes, places)
          VALUES (${open.id}, ${booked.typeId}, ARRAY[1,2,3,4,5,6,7], 600, current_date, 45, 5) RETURNING id`;
        if (slot === undefined) throw new Error("no time slot");
        await sql`UPDATE gym_class_sessions SET schedule_id = ${slot.id} WHERE id = ${booked.id}`;
        expect(view(await book(open, who, booked.id)).mine?.status).toBe("booked");

        const stop = await inject("DELETE", `/v1/orgs/${open.id}/class-repeats/${slot.id}`, open.owner.cookies);
        expect([stop.statusCode, JSON.parse(stop.body)]).toEqual([409, expect.objectContaining({ error: "class_has_bookings", message: "People have booked some of these classes, so this can't be done yet." })]);
        const archive = await inject("DELETE", `/v1/orgs/${open.id}/classes/${booked.typeId}`, open.owner.cookies);
        expect([archive.statusCode, errorOf(archive)]).toEqual([409, "class_has_bookings"]);
        // Nothing was half done: the class, its time slot and the booking stand.
        expect(await tally(booked.id)).toEqual({ booked: 1 });
        const [still] = await sql<{ archived: boolean; ended: boolean }[]>`
          SELECT t.archived_at IS NOT NULL AS archived, s.ended_at IS NOT NULL AS ended
          FROM gym_class_types t JOIN gym_class_schedules s ON s.class_type_id = t.id WHERE t.id = ${booked.typeId}`;
        expect(still).toEqual({ archived: false, ended: false });
        // A class nobody has booked is archived as before.
        expect((await inject("DELETE", `/v1/orgs/${open.id}/classes/${empty.typeId}`, open.owner.cookies)).statusCode).toBe(200);
      } finally {
        clock = kept;
      }
    },
    T,
  );
});