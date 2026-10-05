// A MEMBER'S LIST OF CLASSES — the route against real Postgres (DATABASE_URL-gated). Spec
// Part 3 §13.6; ROADMAP 17d.
//
// The worst thing this job could do to a real person: show a member "Booked" when they
// are only waiting, or the wrong time, so they turn up to a class with no place for them.
// The first test below reads every kind of class through the list and through the class's
// own read, for every kind of person, and the two must say the same.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { ClassBookingView, MemberClassesResponse } from "@app/shared";
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
  JWT_SECRET: "member-classes-routes-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 180_000;
const LIVE_PLAN = "zz_classm_live";
/** Wednesday 7 October 2026, 07:30 in London. Its week is Monday 5 to Sunday 11 October. */
const NOW = new Date("2026-10-07T06:30:00Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24;

let ipCounter = 0;
const nextIp = () => `10.75.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
const redisUrl = process.env["TEST_REDIS_URL"];
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("a member's list of classes (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const clock = NOW.getTime();
  let app: App | undefined;
  let redis: RedisLike | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'classm-t-%@example.com')`;
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
    await sql`DELETE FROM users WHERE email LIKE 'classm-t-%@example.com'`;
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
    const email = `classm-t-${uniq()}@example.com`;
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
    const res = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName: name, email: `classm-l-${uniq()}@example.com` });
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
  const errorOf = (res: { body: string }): string => (JSON.parse(res.body) as { error: string }).error;

  const listOf = async (gym: Gym, who: Person, week?: number): Promise<MemberClassesResponse> => {
    const res = await inject("GET", `/v1/orgs/${gym.id}/member-classes${week === undefined ? "" : `?week=${String(week)}`}`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as MemberClassesResponse;
  };
  const rowOf = (list: MemberClassesResponse, sessionId: string): ClassBookingView => {
    const row = list.classes.find((c) => c.sessionId === sessionId);
    if (row === undefined) throw new Error("the class is not on the list");
    return row;
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    redis = redisUrl === undefined || redisUrl === "" ? createMemoryRedis() : createIoRedis(redisUrl);
    for (let tries = 0; (await redis.incrWithTtl(`classm-ready:${randomUUID()}`, 30)) === null; tries++) {
      if (tries === 100) throw new Error("the Redis at TEST_REDIS_URL never connected");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    app = await buildApp(loadConfig(baseEnv), { redis, orgs: { now: () => new Date(clock) } });
    await api().ready();
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await redis?.close();
    await sql.end({ timeout: 5 });
  }, T);

  it(
    "every class reads on the list exactly as its own read answers it, for every kind of person",
    async () => {
      const gym = await makeGym("Price List");
      const all = await typeOf(gym);
      const packType = await typeOf(gym, { kind: "pack" });
      const limitedType = await typeOf(gym, { access: "limited", limit: 1, period: "week" });
      const filler = async (name: string) => {
        const who = await listed(gym, name);
        await hold(gym, who.entryId, all);
        return who;
      };
      const [f1, f2, f3] = [await filler("Fay One"), await filler("Fay Two"), await filler("Fay Three")];
      const pat = await listed(gym, "Pat Pack");
      await hold(gym, pat.entryId, packType, { pack: 5 });
      const lim = await listed(gym, "Lim Once");
      await hold(gym, lim.entryId, limitedType);
      const nom = await listed(gym, "Nom None");
      const unlisted = await member(gym, "Una Unlisted");
      const ok = async (res: Promise<{ statusCode: number; body: string }>) => view(await res);

      // Thursday 8 October, 13:30 in London (12:30 UTC).
      const free = await classAt(gym, 30, 5);
      const second = await classAt(gym, 30, 1);
      await ok(book(gym, f1, second.id));
      await ok(book(gym, f2, second.id, { joinWaitlist: true }));
      await ok(book(gym, pat, second.id, { joinWaitlist: true }));
      const mine = await classAt(gym, 31, 1);
      await ok(book(gym, pat, mine.id));
      await ok(book(gym, lim, (await classAt(gym, 32, 3)).id));
      // Inside the last day: a cancel frees the place and hands it to nobody.
      const claim = await classAt(gym, 5, 1);
      await ok(book(gym, f1, claim.id));
      await ok(book(gym, pat, claim.id, { joinWaitlist: true }));
      await ok(cancel(gym, f1, claim.id));
      // A place that came free without a cancel, more than a day ahead: the first in line's.
      const promised = await classAt(gym, 72, 1);
      await ok(book(gym, f1, promised.id));
      await ok(book(gym, f2, promised.id, { joinWaitlist: true }));
      await ok(book(gym, f3, promised.id, { joinWaitlist: true }));
      await sql`UPDATE gym_class_sessions SET places = 2 WHERE id = ${promised.id}`;
      const off = await classAt(gym, 40, 4);
      await ok(book(gym, pat, off.id));
      await sql`UPDATE gym_class_sessions SET status = 'cancelled' WHERE id = ${off.id}`;
      const unlimited = await classAt(gym, 50, null);
      // Monday 12 October: the next of the gym's weeks, inside the same seven days.
      const monday = await classAt(gym, 5 * DAY, 5);
      // A membership that includes one kind of class and no other.
      const onlyType = await typeOf(gym, { coversAll: false });
      await sql`INSERT INTO gym_membership_type_classes (gym_id, membership_type_id, class_type_id) VALUES (${gym.id}, ${onlyType}, ${unlimited.typeId})`;
      const ona = await listed(gym, "Ona Only");
      await hold(gym, ona.entryId, onlyType);
      const sessions = [free, second, mine, claim, promised, off, unlimited, monday].map((c) => c.id);

      for (const who of [pat, lim, nom, unlisted, ona, f1, f2, f3]) {
        const list = await listOf(gym, who);
        expect(list).toMatchObject({ week: 0, from: "2026-10-07", to: "2026-10-13", timezone: "Europe/London" });
        expect(list.classes.map((c) => c.sessionId)).toEqual(expect.arrayContaining(sessions));
        for (const row of list.classes) expect(row, `${who.name} · ${row.className}`).toEqual(await seen(gym, who, row.sessionId));
        expect(list.classes.map((c) => c.startsAt)).toEqual(list.classes.map((c) => c.startsAt).sort());
      }

      const pats = await listOf(gym, pat);
      // The gym's own day and clock, whatever the reader's.
      expect(rowOf(pats, free.id)).toMatchObject({
        localDate: "2026-10-08",
        localStartMinute: 13 * 60 + 30,
        timezone: "Europe/London",
        startsAt: "2026-10-08T12:30:00.000Z",
        places: 5,
        booked: 0,
        mine: null,
        can: { book: true, joinWaitlist: false, claim: false, cancel: null, why: null },
      });
      // Waiting is never read as booked.
      expect(rowOf(pats, second.id)).toMatchObject({
        booked: 1,
        waitlisted: 2,
        mine: { status: "waitlisted", waitlistPlace: 2, packCharged: false },
        can: { book: false, claim: false, cancel: "free" },
      });
      expect(rowOf(pats, mine.id)).toMatchObject({ mine: { status: "booked", waitlistPlace: null, packCharged: true }, can: { book: false, cancel: "free" } });
      expect(rowOf(pats, claim.id)).toMatchObject({ booked: 0, mine: { status: "waitlisted", waitlistPlace: 1 }, can: { book: false, claim: true } });
      // The free place is the first in line's: full for anybody else, and not the second's to claim.
      expect(rowOf(pats, promised.id)).toMatchObject({ places: 2, booked: 1, mine: null, can: { book: false, joinWaitlist: true } });
      expect(rowOf(await listOf(gym, f2), promised.id).can).toMatchObject({ claim: true });
      expect(rowOf(await listOf(gym, f3), promised.id)).toMatchObject({ mine: { status: "waitlisted", waitlistPlace: 2 }, can: { claim: false } });
      expect(rowOf(pats, off.id)).toMatchObject({ cancelled: true, mine: { status: "booked" }, can: { book: false, joinWaitlist: false } });
      expect(rowOf(pats, unlimited.id)).toMatchObject({ places: null, can: { book: true } });

      // Why not: one booking a week used, no membership, not on the gym's list.
      expect(rowOf(await listOf(gym, lim), free.id).can).toEqual({ book: false, joinWaitlist: false, claim: false, cancel: null, why: "limit_week" });
      // The week's one booking is counted in the class's own week, and a membership covers
      // the kind of class it names: neither is read once and used for every class.
      expect(rowOf(await listOf(gym, lim), monday.id).can).toMatchObject({ book: true, why: null });
      const onas = await listOf(gym, ona);
      expect(rowOf(onas, unlimited.id).can).toMatchObject({ book: true, why: null });
      expect(rowOf(onas, free.id).can).toMatchObject({ book: false, why: "not_covered" });
      expect(rowOf(onas, monday.id).can).toMatchObject({ book: false, why: "not_covered" });
      expect(rowOf(await listOf(gym, nom), free.id).can).toMatchObject({ book: false, why: "no_membership" });
      expect(rowOf(await listOf(gym, unlisted), free.id).can).toMatchObject({ book: false, why: "no_membership" });
    },
    T,
  );

  it(
    "the list is the gym's next seven days: nothing started, nothing later, nothing of another gym, the soonest first",
    async () => {
      const gym = await makeGym("Open Door");
      const other = await makeGym("Next Door");
      const who = await member(gym, "Wes Week");
      const started = await classAt(gym, -1, 5);
      const soon = await classAt(gym, 1, 5);
      // Tuesday 13 October 23:30 in London is the seventh day's last hour; 00:30 is the eighth day.
      const lastDay = await classAt(gym, 6 * DAY + 16, 5);
      const nextWeek = await classAt(gym, 6 * DAY + 17, 5);
      // Eight days ahead: booking opens seven days before.
      const notOpen = await classAt(gym, 8 * DAY, 5);
      const far = await classAt(gym, 20 * DAY, 5);
      const theirs = await classAt(other, 2, 5);

      const first = await listOf(gym, who);
      expect(first.classes.map((c) => c.sessionId)).toEqual([soon.id, lastDay.id]);
      expect(first.classes.map((c) => c.localDate)).toEqual(["2026-10-07", "2026-10-13"]);
      // A gym with no membership types: any member may book.
      expect(rowOf(first, soon.id).can).toMatchObject({ book: true, why: null });
      const next = await listOf(gym, who, 1);
      expect(next).toMatchObject({ week: 1, from: "2026-10-14", to: "2026-10-20" });
      expect(next.classes.map((c) => c.sessionId)).toEqual([nextWeek.id, notOpen.id]);
      expect(rowOf(next, nextWeek.id)).toMatchObject({ localDate: "2026-10-14", can: { book: true } });
      expect(rowOf(next, notOpen.id)).toMatchObject({ opensAt: "2026-10-08T06:30:00.000Z", can: { book: false, joinWaitlist: false, why: "not_open_yet" } });
      expect((await listOf(gym, who, 2)).classes.map((c) => c.sessionId)).toEqual([far.id]);
      for (const week of [0, 1, 2, 7]) {
        const ids = (await listOf(gym, who, week)).classes.map((c) => c.sessionId);
        expect(ids).not.toContain(started.id);
        expect(ids).not.toContain(theirs.id);
      }
    },
    T,
  );

  it(
    "nobody but a member of that gym, on a live plan, reads its classes",
    async () => {
      const gym = await makeGym("Members Only");
      const other = await makeGym("Other Gym");
      await classAt(gym, 3, 5);
      const who = await member(gym, "Mel Member");
      const path = `/v1/orgs/${gym.id}/member-classes`;
      expect((await inject("GET", path, who.cookies)).statusCode).toBe(200);

      expect((await inject("GET", path, {})).statusCode).toBe(401);
      const stranger = await signedIn("Sam Stranger");
      const theirs = await member(other, "Olly Other");
      const left = await member(gym, "Lee Left");
      await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${gym.id} AND user_id = ${left.userId}`;
      // The owner did not say they train here, so they are staff and not a member.
      for (const nobody of [stranger, theirs, other.owner, left, gym.owner]) {
        const res = await inject("GET", path, nobody.cookies);
        expect(res.statusCode, `${nobody.name}: ${res.body}`).toBe(404);
        expect(errorOf(res)).toBe("org_not_found");
        expect(res.body).not.toContain("Spin");
      }
      expect((await inject("GET", `/v1/orgs/${randomUUID()}/member-classes`, who.cookies)).statusCode).toBe(404);

      // The gym's plan lapses: its members read nothing.
      await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gym.id}`;
      expect((await inject("GET", path, who.cookies)).statusCode).toBe(404);
    },
    T,
  );

  it(
    "a week that is not one of the eight, or anything else in the address, is refused",
    async () => {
      const gym = await makeGym("Strict");
      const who = await member(gym, "Val Valid");
      const path = `/v1/orgs/${gym.id}/member-classes`;
      for (const query of ["?week=8", "?week=-1", "?week=one", "?week=1.5", "?week=0&gymId=x"]) {
        const res = await inject("GET", `${path}${query}`, who.cookies);
        expect(res.statusCode, query).toBe(400);
        expect(errorOf(res)).toBe("validation_error");
      }
      expect((await inject("GET", "/v1/orgs/not-a-gym/member-classes", who.cookies)).statusCode).toBe(400);
      expect((await inject("GET", `${path}?week=7`, who.cookies)).statusCode).toBe(200);
    },
    T,
  );
});
