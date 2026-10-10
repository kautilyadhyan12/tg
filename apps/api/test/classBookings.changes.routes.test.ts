// BOOKINGS WHEN THINGS CHANGE — the routes against real Postgres (DATABASE_URL-gated), on
// two api instances over one database. Spec Part 3 §13.4; ROADMAP 17c-ii-a.
//
// The worst thing this job could do to a real person: somebody paid for a pack of ten
// classes, staff cancel a class they had booked, and the class is never given back to the
// pack, or is given back twice. That is the first test below.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { ClassBookingSettings, ClassBookingView, ClassBookingsEnding, ClassBookingsEndingResponse } from "@app/shared";
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
  JWT_SECRET: "class-booking-changes-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
type Method = "GET" | "POST" | "PUT" | "DELETE";

const T = 180_000;
const LIVE_PLAN = "zz_classc_live";
const HOUR = 60 * 60 * 1000;
const DAY = 24;

let ipCounter = 0;
const nextIp = () => `10.75.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
const redisUrl = process.env["TEST_REDIS_URL"];
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;
/** The day in London `days` after the instant `ms`. */
const londonDay = (ms: number, days: number): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(ms + days * DAY * HOUR));

d("bookings when a class or a person goes (real Postgres, two api instances)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  // The real time: a member's removal and an account's deletion are stamped by the
  // database's clock, and a class must be still to come by both.
  const clock = Date.now();
  let app: App | undefined;
  let second: App | undefined;
  let redis: RedisLike | undefined;
  const deleteCodes = new Map<string, string>();
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const either = (n: number): App => (n % 2 === 0 ? api() : (second ?? api()));

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'classc-t-%@example.com')`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
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
    await sql`DELETE FROM sign_in_codes WHERE email LIKE 'classc-t-%@example.com'`;
    await sql`DELETE FROM users WHERE email LIKE 'classc-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: Method, path: string, cookies: Cookies, payload?: unknown, target = api()) =>
    target.inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });

  interface Person {
    userId: string;
    email: string;
    cookies: Cookies;
    name: string;
  }
  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `classc-t-${uniq()}@example.com`;
    const reg = await inject("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await inject("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, email, cookies: cookieMap(login), name: displayName };
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
    const res = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName: name, email: `classc-l-${uniq()}@example.com` });
    expect(res.statusCode, res.body).toBe(201);
    const entryId = (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
    await sql`UPDATE gym_members SET entry_id = ${entryId} WHERE gym_id = ${gym.id} AND user_id = ${person.userId}`;
    return { ...person, entryId };
  };

  /** A class `hours` from now, in a class type of its own. */
  const classAt = async (gym: Gym, hours: number, places: number | null) => {
    const [type] = await sql<{ id: string }[]>`
      INSERT INTO gym_class_types (gym_id, name, minutes, places, colour, open_gym)
      VALUES (${gym.id}, ${`Spin ${uniq()}`}, 45, ${places}, 'blue', false)
      RETURNING id`;
    if (type === undefined) throw new Error("no class type");
    const startsAt = new Date(clock + hours * HOUR);
    const [row] = await sql<{ id: string; minute: number }[]>`
      INSERT INTO gym_class_sessions (gym_id, class_type_id, local_date, local_start_minute, starts_at, minutes, places, status)
      SELECT ${gym.id}, ${type.id}, l::date, (EXTRACT(HOUR FROM l) * 60 + EXTRACT(MINUTE FROM l))::int, ${startsAt}, 45, ${places}, 'scheduled'
      FROM (SELECT ${startsAt}::timestamptz AT TIME ZONE 'Europe/London' AS l) x
      RETURNING id, local_start_minute AS minute`;
    if (row === undefined) throw new Error("no class");
    return { id: row.id, typeId: type.id, minute: row.minute };
  };

  /** A class of the gym's timetable that runs every day at `startMinute` from tomorrow:
   *  its id, its time slot's, and its coming classes by day. */
  const daily = async (gym: Gym, startMinute: number, places: number | null) => {
    const made = await inject("POST", `/v1/orgs/${gym.id}/classes`, gym.owner.cookies, { name: `Yoga ${uniq()}`, minutes: 45, places, colour: "blue" });
    expect(made.statusCode, made.body).toBe(201);
    const [type] = await sql<{ id: string }[]>`SELECT id FROM gym_class_types WHERE gym_id = ${gym.id} ORDER BY created_at DESC, id DESC LIMIT 1`;
    if (type === undefined) throw new Error("no class type");
    const slot = await inject("POST", `/v1/orgs/${gym.id}/classes/${type.id}/repeats`, gym.owner.cookies, {
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      startMinute,
      startsOn: londonDay(clock, 1),
      minutes: 45,
      places,
      coachUserId: null,
    });
    expect(slot.statusCode, slot.body).toBe(201);
    const [schedule] = await sql<{ id: string }[]>`SELECT id FROM gym_class_schedules WHERE gym_id = ${gym.id} AND class_type_id = ${type.id}`;
    if (schedule === undefined) throw new Error("no time slot");
    return { typeId: type.id, scheduleId: schedule.id };
  };
  const classesOf = async (gym: Gym, typeId: string): Promise<{ id: string; day: string; minute: number; scheduleId: string }[]> =>
    (
      await sql<{ id: string; day: string; minute: number; schedule_id: string }[]>`
        SELECT id, local_date::text AS day, local_start_minute AS minute, schedule_id
        FROM gym_class_sessions WHERE gym_id = ${gym.id} AND class_type_id = ${typeId} ORDER BY local_date`
    ).map((r) => ({ id: r.id, day: r.day, minute: r.minute, scheduleId: r.schedule_id }));
  const onDay = (classes: { id: string; day: string }[], days: number): string => {
    const found = classes.find((c) => c.day === londonDay(clock, days));
    if (found === undefined) throw new Error(`no class ${String(days)} days on`);
    return found.id;
  };

  const packTypeOf = async (gym: Gym): Promise<string> => {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_membership_types
        (gym_id, name, kind, price_minor, currency, term_count, term_unit, pack_classes, pack_days, access, bookings_limit, bookings_period, covers_all_classes)
      VALUES (${gym.id}, ${`Pack ${uniq()}`}, 'pack', 4000, 'GBP', NULL, NULL, 10, 60, 'all_classes', NULL, NULL, true)
      RETURNING id`;
    if (row === undefined) throw new Error("no type");
    return row.id;
  };
  const holdPack = async (gym: Gym, entryId: string, typeId: string, left = 10): Promise<string> => {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_held_memberships
        (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, pack_classes, pack_days, classes_left, starts_on, status, renews)
      VALUES (${gym.id}, ${entryId}, ${typeId}, gen_random_uuid(), 'pack', 4000, 'GBP', 10, 60, ${left}, (now() - interval '5 days')::date, 'active', false)
      RETURNING id`;
    if (row === undefined) throw new Error("no membership");
    return row.id;
  };
  const left = async (heldId: string): Promise<number | null> => {
    const [row] = await sql<{ classes_left: number | null }[]>`SELECT classes_left FROM gym_held_memberships WHERE id = ${heldId}`;
    if (row === undefined) throw new Error("no membership");
    return row.classes_left;
  };
  /** A member on the list with a pack of ten, `classes` of them left. */
  const packed = async (gym: Gym, packType: string, name: string, classes = 10) => {
    const who = await listed(gym, name);
    return { ...who, pack: await holdPack(gym, who.entryId, packType, classes) };
  };

  const bookingUrl = (gym: Gym, sessionId: string) => `/v1/orgs/${gym.id}/class-sessions/${sessionId}/booking`;
  const book = (gym: Gym, who: Person, sessionId: string, joinWaitlist = false) =>
    inject("POST", bookingUrl(gym, sessionId), who.cookies, { requestKey: randomUUID(), joinWaitlist });
  const cancel = (gym: Gym, who: Person, sessionId: string, target = api()) =>
    inject("POST", `${bookingUrl(gym, sessionId)}/cancel`, who.cookies, { lateOk: true }, target);
  const view = (res: { statusCode: number; body: string }): ClassBookingView => {
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { booking: ClassBookingView }).booking;
  };
  const booked = async (gym: Gym, who: Person, sessionId: string, joinWaitlist = false): Promise<string | undefined> =>
    view(await book(gym, who, sessionId, joinWaitlist)).mine?.status;
  const seen = async (gym: Gym, who: Person, sessionId: string): Promise<ClassBookingView> => view(await inject("GET", bookingUrl(gym, sessionId), who.cookies));
  const errorOf = (res: { body: string }): string => (JSON.parse(res.body) as { error: string }).error;
  /** The 409 that asks before bookings end: who they are. */
  const asked = (res: { statusCode: number; body: string }): ClassBookingsEnding => {
    expect([res.statusCode, errorOf(res)], res.body).toEqual([409, "class_has_bookings"]);
    return (JSON.parse(res.body) as { ending: ClassBookingsEnding }).ending;
  };
  const tally = async (sessionId: string): Promise<Record<string, number>> => {
    const rows = await sql<{ status: string; n: number }[]>`SELECT status, count(*)::int AS n FROM gym_class_bookings WHERE session_id = ${sessionId} GROUP BY status`;
    return Object.fromEntries(rows.map((r) => [r.status, r.n]));
  };
  /** A mark of the right shape that is no booking's. */
  const NOT_THEIRS = "a".repeat(64);
  const cancelClass = (gym: Gym, sessionId: string, confirmBookings?: string, target = api()) =>
    inject("POST", `/v1/orgs/${gym.id}/class-sessions/${sessionId}/cancel`, gym.owner.cookies, confirmBookings === undefined ? {} : { confirmBookings }, target);
  const settingsUrl = (gym: Gym) => `/v1/orgs/${gym.id}/booking-settings`;

  /** A gym with no membership types, and one that sells packs. */
  let open: Gym;
  let sells: Gym;
  let packType: string;

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    redis = redisUrl === undefined || redisUrl === "" ? createMemoryRedis() : createIoRedis(redisUrl);
    for (let tries = 0; (await redis.incrWithTtl(`classc-ready:${randomUUID()}`, 30)) === null; tries++) {
      if (tries === 100) throw new Error("the Redis at TEST_REDIS_URL never connected");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const overrides = {
      redis,
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

    open = await makeGym("Open Door");
    sells = await makeGym("Price List");
    packType = await packTypeOf(sells);
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await second?.close();
    await redis?.close();
    await sql.end({ timeout: 5 });
  }, T);

  it(
    "staff cancel a class people booked on packs: it asks first, then every pack has exactly one class back, however often the cancel arrives and whoever cancels at the same instant",
    async () => {
      const spin = await classAt(sells, 3 * DAY, 12);
      const people = [];
      // Five of ten left: a class given back twice would show as six, not hide at the pack's size.
      for (let n = 0; n < 12; n++) people.push(await packed(sells, packType, `Pack Person ${String(n)}`, 5));
      for (const who of people) expect(await booked(sells, who, spin.id)).toBe("booked");
      const waiting = [];
      for (let n = 0; n < 3; n++) waiting.push(await packed(sells, packType, `Waiting Person ${String(n)}`, 5));
      for (const who of waiting) expect(await booked(sells, who, spin.id, true)).toBe("waitlisted");
      // One of the twelve cancelled late, and the pack kept the charge.
      const late = people[11];
      if (late === undefined) throw new Error("no twelfth person");
      await sql`
        UPDATE gym_class_bookings SET status = 'late_cancelled', cancelled_at = now()
        WHERE session_id = ${spin.id} AND user_id = ${late.userId}`;
      expect(await Promise.all(people.map((p) => left(p.pack)))).toEqual(people.map(() => 4));
      expect(await Promise.all(waiting.map((p) => left(p.pack)))).toEqual(waiting.map(() => 5));

      // Without the mark it only asks, naming the first few, and changes nothing.
      const ask = asked(await cancelClass(sells, spin.id));
      expect({ classes: ask.classes, booked: ask.booked, waiting: ask.waiting }).toEqual({ classes: 1, booked: 11, waiting: 3 });
      expect(ask.people.map((p) => [p.name, p.waiting])).toEqual([
        ["Pack Person 0", false],
        ["Pack Person 1", false],
        ["Pack Person 2", false],
      ]);
      // A mark that is not theirs is asked again.
      expect(asked(await cancelClass(sells, spin.id, NOT_THEIRS)).booked).toBe(11);
      expect(await tally(spin.id)).toEqual({ booked: 11, waitlisted: 3, late_cancelled: 1 });
      expect(await Promise.all(people.map((p) => left(p.pack)))).toEqual(people.map(() => 4));

      // Five people cancel for themselves at the same instant as two staff cancels, on two
      // servers. A staff cancel that lost the race is told the new mark and sends it.
      const own = people.slice(0, 5).map((who, n) => cancel(sells, who, spin.id, either(n)));
      const staffCancel = async (n: number): Promise<number> => {
        let confirm = ask.mark;
        for (let tries = 0; tries < 20; tries++) {
          const res = await cancelClass(sells, spin.id, confirm, either(n));
          if (res.statusCode === 200) return tries;
          confirm = asked(res).mark;
        }
        throw new Error("the class was never cancelled");
      };
      await Promise.all([...own, staffCancel(0), staffCancel(1)]);
      const [session] = await sql<{ status: string }[]>`SELECT status FROM gym_class_sessions WHERE id = ${spin.id}`;
      expect(session?.status).toBe("cancelled");
      // Every pack has its five again, no more: the eleven booked, the late cancel's, and
      // the three who only waited and were never charged.
      expect(await Promise.all(people.map((p) => left(p.pack)))).toEqual(people.map(() => 5));
      expect(await Promise.all(waiting.map((p) => left(p.pack)))).toEqual(waiting.map(() => 5));
      expect(await tally(spin.id)).toEqual({ cancelled: 14, late_cancelled: 1 });
      const [charged] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_class_bookings WHERE session_id = ${spin.id} AND pack_charged`;
      expect(charged?.n).toBe(0);

      // Cancelled again, and by the members again: nothing comes back twice.
      expect((await cancelClass(sells, spin.id)).statusCode).toBe(200);
      await Promise.all(people.map((who, n) => cancel(sells, who, spin.id, either(n))));
      expect(await Promise.all(people.map((p) => left(p.pack)))).toEqual(people.map(() => 5));

      // The class put back runs with nobody booked; a person books again and is charged once.
      const back = await inject("POST", `/v1/orgs/${sells.id}/class-sessions/${spin.id}/restore`, sells.owner.cookies, {});
      expect(back.statusCode, back.body).toBe(200);
      expect((await seen(sells, late, spin.id)).booked).toBe(0);
      const first = people[0];
      if (first === undefined) throw new Error("no first person");
      expect(await booked(sells, first, spin.id)).toBe("booked");
      expect(await left(first.pack)).toBe(4);
    },
    T,
  );

  it(
    "a time slot cancelled, a time slot moved and a class removed: each asks first, ends the bookings from then on and gives the packs their classes back",
    async () => {
      const yoga = await daily(sells, 18 * 60, 10);
      let classes = await classesOf(sells, yoga.typeId);
      const amy = await packed(sells, packType, "Amy Adams");
      const ben = await packed(sells, packType, "Ben Brown");
      // Amy: tomorrow, three days on and four days on. Ben: three days on.
      for (const days of [1, 3, 4]) expect(await booked(sells, amy, onDay(classes, days))).toBe("booked");
      expect(await booked(sells, ben, onDay(classes, 3))).toBe("booked");
      expect([await left(amy.pack), await left(ben.pack)]).toEqual([7, 9]);

      // MOVED to 7 pm from three days on: tomorrow's booking stays, the three later ones end.
      const move = {
        updateFrom: londonDay(clock, 3),
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        startMinute: 19 * 60,
        minutes: 45,
        places: 10,
        coachUserId: null,
      };
      const slotUrl = `/v1/orgs/${sells.id}/class-repeats/${yoga.scheduleId}`;
      const moveAsk = asked(await inject("PUT", slotUrl, sells.owner.cookies, move));
      expect({ classes: moveAsk.classes, booked: moveAsk.booked, waiting: moveAsk.waiting }).toEqual({ classes: 2, booked: 3, waiting: 0 });
      expect([await left(amy.pack), await left(ben.pack)]).toEqual([7, 9]);
      // The whole list behind "See all" is the same people.
      const all = await inject("GET", `/v1/orgs/${sells.id}/class-bookings/ending?by=slot&id=${yoga.scheduleId}&from=${londonDay(clock, 3)}`, sells.owner.cookies);
      expect(all.statusCode, all.body).toBe(200);
      const list = JSON.parse(all.body) as ClassBookingsEndingResponse;
      expect([list.classes, list.booked, list.waiting, list.next]).toEqual([2, 3, 0, null]);
      expect(list.people.map((p) => [p.name, p.localDate, p.localStartMinute])).toEqual([
        ["Amy Adams", londonDay(clock, 3), 18 * 60],
        ["Amy Adams", londonDay(clock, 4), 18 * 60],
        ["Ben Brown", londonDay(clock, 3), 18 * 60],
      ]);
      const moved = await inject("PUT", slotUrl, sells.owner.cookies, { ...move, confirmBookings: moveAsk.mark });
      expect(moved.statusCode, moved.body).toBe(200);
      expect([await left(amy.pack), await left(ben.pack)]).toEqual([9, 10]);
      classes = await classesOf(sells, yoga.typeId);
      expect(classes.find((c) => c.day === londonDay(clock, 3))?.minute).toBe(19 * 60);
      expect((await seen(sells, amy, onDay(classes, 1))).mine?.status).toBe("booked");
      expect((await seen(sells, amy, onDay(classes, 3))).mine).toBeNull();
      const [kept] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_class_bookings WHERE gym_id = ${sells.id} AND user_id IN (${amy.userId}, ${ben.userId})`;
      expect(kept?.n).toBe(1);

      // The new time slot CANCELLED: Ben books it, and it asks about him alone.
      const later = classes.find((c) => c.day === londonDay(clock, 3));
      if (later === undefined) throw new Error("no moved class");
      expect(await booked(sells, ben, later.id)).toBe("booked");
      expect(await left(ben.pack)).toBe(9);
      const stopUrl = `/v1/orgs/${sells.id}/class-repeats/${later.scheduleId}`;
      const stopAsk = asked(await inject("DELETE", stopUrl, sells.owner.cookies));
      expect(stopAsk.booked).toBe(1);
      expect(await left(ben.pack)).toBe(9);
      const stopped = await inject("DELETE", `${stopUrl}?confirmBookings=${stopAsk.mark}`, sells.owner.cookies);
      expect(stopped.statusCode, stopped.body).toBe(200);
      expect(await left(ben.pack)).toBe(10);
      // The same request again finds the time slot gone, and gives nothing back twice.
      expect((await inject("DELETE", `${stopUrl}?confirmBookings=${stopAsk.mark}`, sells.owner.cookies)).statusCode).toBe(404);
      expect(await left(ben.pack)).toBe(10);

      // The class REMOVED: Amy's booking of tomorrow, on the first time slot, ends with it.
      const typeUrl = `/v1/orgs/${sells.id}/classes/${yoga.typeId}`;
      const removeAsk = asked(await inject("DELETE", typeUrl, sells.owner.cookies));
      expect([removeAsk.classes, removeAsk.booked, removeAsk.people.map((p) => p.name)]).toEqual([1, 1, ["Amy Adams"]]);
      const removed = await inject("DELETE", `${typeUrl}?confirmBookings=${removeAsk.mark}`, sells.owner.cookies);
      expect(removed.statusCode, removed.body).toBe(200);
      expect(await left(amy.pack)).toBe(10);
      expect(await classesOf(sells, yoga.typeId)).toEqual([]);
      const [gone] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_class_bookings WHERE gym_id = ${sells.id} AND user_id IN (${amy.userId}, ${ben.userId})`;
      expect(gone?.n).toBe(0);
      // The audit line counts and names nobody.
      const [audit] = await sql<{ meta: Record<string, string> }[]>`
        SELECT meta FROM audit_log WHERE gym_id = ${sells.id} AND action = 'org.class_type_archived' AND target_id = ${yoga.typeId}`;
      expect(audit?.meta).toMatchObject({ bookingsEnded: "1", waitlistEnded: "0", packClassesBack: "1" });
    },
    T,
  );

  it(
    "a class made bigger hands its new places to the waitlist in order and charges each pack once; made smaller it takes nobody out; moved to another time it keeps its bookings",
    async () => {
      const spin = await classAt(sells, 3 * DAY, 1);
      const [a, b, c, late] = await Promise.all(["Ana", "Bea", "Cy", "Dee"].map((n) => packed(sells, packType, `${n} Size`)));
      if (a === undefined || b === undefined || c === undefined || late === undefined) throw new Error("no people");
      expect(await booked(sells, a, spin.id)).toBe("booked");
      expect(await booked(sells, b, spin.id, true)).toBe("waitlisted");
      expect(await booked(sells, c, spin.id, true)).toBe("waitlisted");
      const change = (places: number | null, startMinute = spin.minute) =>
        inject("PUT", `/v1/orgs/${sells.id}/class-sessions/${spin.id}`, sells.owner.cookies, { scope: "this", startMinute, minutes: 45, places, coachUserId: null });

      // Two places: the first in line has the second, and is charged for it now.
      expect((await change(2)).statusCode).toBe(200);
      expect((await seen(sells, b, spin.id)).mine).toEqual({ status: "booked", waitlistPlace: null, packCharged: true });
      expect((await seen(sells, c, spin.id)).mine).toEqual({ status: "waitlisted", waitlistPlace: 1, packCharged: false });
      expect([await left(a.pack), await left(b.pack), await left(c.pack)]).toEqual([9, 9, 10]);
      // The same change again moves nobody and charges nothing.
      expect((await change(2)).statusCode).toBe(200);
      expect([await left(b.pack), await left(c.pack)]).toEqual([9, 10]);
      // No limit: the last in line is in.
      expect((await change(null)).statusCode).toBe(200);
      expect((await seen(sells, c, spin.id)).mine?.status).toBe("booked");
      expect(await left(c.pack)).toBe(9);

      // One place again: all three keep theirs, and the class reads full to the next person.
      expect((await change(1)).statusCode).toBe(200);
      expect(await tally(spin.id)).toEqual({ booked: 3 });
      expect([await left(a.pack), await left(b.pack), await left(c.pack)]).toEqual([9, 9, 9]);
      const full = await book(sells, late, spin.id);
      expect([full.statusCode, errorOf(full)]).toEqual([409, "class_full"]);

      // An hour later on the same day: nobody is asked about and nobody loses their booking.
      const moved = await change(1, spin.minute < 23 * 60 ? spin.minute + 60 : spin.minute - 60);
      expect(moved.statusCode, moved.body).toBe(200);
      expect(await tally(spin.id)).toEqual({ booked: 3 });
      expect([await left(a.pack), await left(b.pack), await left(c.pack)]).toEqual([9, 9, 9]);
    },
    T,
  );

  it(
    "somebody staff remove, somebody taken off the list and somebody who deletes their account each lose their coming bookings, get their pack's class back, and the next in line has the place",
    async () => {
      const removed = await packed(sells, packType, "Rae Removed");
      const offList = await packed(sells, packType, "Oli Offlist");
      const deleted = await packed(sells, packType, "Del Deleted");
      const next = await Promise.all(["One", "Two", "Three"].map((n) => packed(sells, packType, `Next ${n}`)));
      const leavers = [removed, offList, deleted];
      // Each leaver holds the one place of a class of their own, with one person waiting,
      // and waits for a fourth class; each also came to a class that has started.
      const classes = [];
      for (const who of leavers) {
        const spin = await classAt(sells, 3 * DAY, 1);
        expect(await booked(sells, who, spin.id)).toBe("booked");
        classes.push(spin);
      }
      for (const [n, who] of next.entries()) {
        const spin = classes[n];
        if (spin === undefined) throw new Error("no class");
        expect(await booked(sells, who, spin.id, true)).toBe("waitlisted");
      }
      const shared = await classAt(sells, 4 * DAY, 1);
      const holder = next[0];
      if (holder === undefined) throw new Error("no holder");
      expect(await booked(sells, holder, shared.id)).toBe("booked");
      for (const who of leavers) expect(await booked(sells, who, shared.id, true)).toBe("waitlisted");
      const past = await classAt(sells, 3 * DAY, 5);
      for (const who of leavers) expect(await booked(sells, who, past.id)).toBe("booked");
      await sql`UPDATE gym_class_sessions SET starts_at = now() - interval '2 hours' WHERE id = ${past.id}`;
      expect(await Promise.all(leavers.map((p) => left(p.pack)))).toEqual([8, 8, 8]);

      // Staff remove one from the app.
      const out = await inject("DELETE", `/v1/orgs/${sells.id}/members/${removed.userId}`, sells.owner.cookies);
      expect(out.statusCode, out.body).toBe(200);
      // Staff take one off the list by hand, which ends their app too.
      const off = await inject("DELETE", `/v1/orgs/${sells.id}/member-list/entries/${offList.entryId}`, sells.owner.cookies);
      expect(off.statusCode, off.body).toBe(200);
      // One deletes their own account.
      expect((await inject("POST", "/v1/users/me/delete-code", deleted.cookies, {})).statusCode).toBe(200);
      const code = deleteCodes.get(deleted.email);
      if (code === undefined) throw new Error("no delete code");
      const gone = await inject("DELETE", "/v1/users/me", deleted.cookies, { code });
      expect(gone.statusCode, gone.body).toBe(200);

      for (const [n, who] of leavers.entries()) {
        const spin = classes[n];
        const after = next[n];
        if (spin === undefined || after === undefined) throw new Error("no class");
        // Their place is the next person's, who is charged for it now.
        expect(await tally(spin.id), who.name).toEqual({ booked: 1, cancelled: 1 });
        expect((await seen(sells, after, spin.id)).mine, who.name).toEqual({ status: "booked", waitlistPlace: null, packCharged: true });
        // The class that started is history: its booking and its charge stay.
        const [old] = await sql<{ status: string; pack_charged: boolean }[]>`
          SELECT status, pack_charged FROM gym_class_bookings WHERE session_id = ${past.id} AND user_id = ${who.userId}`;
        expect(old, who.name).toEqual({ status: "booked", pack_charged: true });
      }
      // Each pack has the coming class back and not the past one.
      expect([await left(removed.pack), await left(offList.pack), await left(deleted.pack)]).toEqual([9, 9, 9]);
      // None of them waits for the fourth class any more.
      expect(await tally(shared.id)).toEqual({ booked: 1, cancelled: 3 });
      expect([await left(holder.pack)]).toEqual([8]);

      // Removed a second time: nothing more comes back.
      expect((await inject("DELETE", `/v1/orgs/${sells.id}/members/${removed.userId}`, sells.owner.cookies)).statusCode).toBe(200);
      expect(await left(removed.pack)).toBe(9);
    },
    T,
  );

  it(
    "the four booking settings: the owner reads and changes them, each inside its limits, and a shorter hand-over time gives a waiting person a free place at once",
    async () => {
      const read = async (): Promise<ClassBookingSettings> => {
        const res = await inject("GET", settingsUrl(open), open.owner.cookies);
        expect(res.statusCode, res.body).toBe(200);
        return (JSON.parse(res.body) as { settings: ClassBookingSettings }).settings;
      };
      const start: ClassBookingSettings = { opensDays: 7, freeCancelMinutes: 120, handoverMinutes: 1440, waitlistMax: 20 };
      // Personal training's two ride on every save (17e-vi); its own file is `pt.rules.routes.test.ts`.
      const pt = { opensDays: 7, freeCancelMinutes: 120 };
      expect(await read()).toEqual(start);

      // A class 12 hours away is inside the 1-day hand-over time: the place a cancel frees
      // waits for a claim.
      const spin = await classAt(open, 12, 1);
      const [first, waiter, third] = await Promise.all(["First", "Waiter", "Third"].map((n) => member(open, `Settings ${n}`)));
      if (first === undefined || waiter === undefined || third === undefined) throw new Error("no people");
      expect(await booked(open, first, spin.id)).toBe("booked");
      expect(await booked(open, waiter, spin.id, true)).toBe("waitlisted");
      expect(view(await cancel(open, first, spin.id)).mine?.status).toBe("cancelled");
      expect((await seen(open, waiter, spin.id)).can.claim).toBe(true);
      expect(await tally(spin.id)).toEqual({ cancelled: 1, waitlisted: 1 });

      // A full class with two people waiting, three days away: nothing a save may touch.
      const kept = await classAt(open, 3 * DAY, 1);
      const [holder, wait1, wait2] = await Promise.all(["Holder", "Wait One", "Wait Two"].map((n) => member(open, `Settings ${n}`)));
      if (holder === undefined || wait1 === undefined || wait2 === undefined) throw new Error("no people");
      expect(await booked(open, holder, kept.id)).toBe("booked");
      expect(await booked(open, wait1, kept.id, true)).toBe("waitlisted");
      expect(await booked(open, wait2, kept.id, true)).toBe("waitlisted");

      // Every value outside its limits, a missing one and an extra one are refused whole.
      const bad: unknown[] = [
        { ...start, opensDays: 0 },
        { ...start, opensDays: 57 },
        { ...start, freeCancelMinutes: -1 },
        { ...start, freeCancelMinutes: 10081 },
        { ...start, handoverMinutes: 10081 },
        { ...start, waitlistMax: 101 },
        { ...start, waitlistMax: 1.5 },
        { opensDays: 7, freeCancelMinutes: 120, handoverMinutes: 1440 },
        { ...start, gymId: sells.id },
      ];
      for (const body of bad) {
        const res = await inject("PUT", settingsUrl(open), open.owner.cookies, { ...(body as object), pt });
        expect([res.statusCode, errorOf(res)], JSON.stringify(body)).toEqual([400, "validation_error"]);
      }
      expect(await read()).toEqual(start);

      // The hand-over time cut to an hour: the free place is the waiting person's now.
      const next: ClassBookingSettings = { opensDays: 14, freeCancelMinutes: 60, handoverMinutes: 60, waitlistMax: 0 };
      const saved = await inject("PUT", settingsUrl(open), open.owner.cookies, { ...next, pt });
      expect(saved.statusCode, saved.body).toBe(200);
      // The save says how many waiting people it moved in.
      expect((JSON.parse(saved.body) as { movedIn: number }).movedIn).toBe(1);
      expect(await read()).toEqual(next);
      // Nobody booked loses their place, and a waitlist longer than the new limit of none
      // keeps everybody on it, in their order.
      expect(await tally(kept.id)).toEqual({ booked: 1, waitlisted: 2 });
      expect((await seen(open, wait2, kept.id)).mine).toEqual({ status: "waitlisted", waitlistPlace: 2, packCharged: false });
      expect(await tally(spin.id)).toEqual({ cancelled: 1, booked: 1 });
      expect((await seen(open, waiter, spin.id)).mine?.status).toBe("booked");
      // A waitlist of none: the full class offers no waitlist.
      const full = await book(open, third, spin.id, true);
      expect([full.statusCode, errorOf(full)]).toEqual([409, "waitlist_full"]);
      // Booking opens 14 days before now: a class 10 days away can be booked.
      const far = await classAt(open, 10 * DAY, 5);
      expect(await booked(open, third, far.id)).toBe("booked");
      // What changed is written down, numbers only.
      const [audit] = await sql<{ meta: Record<string, string> }[]>`
        SELECT meta FROM audit_log WHERE gym_id = ${open.id} AND action = 'org.booking_settings_changed'`;
      expect(audit?.meta).toEqual({ opensDays: "7 -> 14", freeCancelMinutes: "120 -> 60", handoverMinutes: "1440 -> 60", waitlistMax: "20 -> 0" });
      // The same four again write nothing more.
      expect((await inject("PUT", settingsUrl(open), open.owner.cookies, { ...next, pt })).statusCode).toBe(200);
      const [lines] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${open.id} AND action = 'org.booking_settings_changed'`;
      expect(lines?.n).toBe(1);
      expect((await inject("PUT", settingsUrl(open), open.owner.cookies, { ...start, pt })).statusCode).toBe(200);
    },
    T,
  );

  it(
    "nobody outside the gym, no member and no staff without the timetable's tick reads or changes its settings, ends its bookings or reads who is booked",
    async () => {
      const stranger = await signedIn("Stranger");
      const insider = await member(open, "Insider");
      const trainer = await member(open, "Trainer");
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${open.id}, ${trainer.userId}, 'trainer', NULL)`;
      const spin = await classAt(open, 3 * DAY, 5);
      // The class is on a time slot, so each of the four doors has something to end.
      const [slot] = await sql<{ id: string }[]>`
        INSERT INTO gym_class_schedules (gym_id, class_type_id, weekdays, local_start_minute, starts_on, minutes, places)
        VALUES (${open.id}, ${spin.typeId}, ARRAY[1,2,3,4,5,6,7], ${spin.minute}, current_date, 45, 5) RETURNING id`;
      if (slot === undefined) throw new Error("no time slot");
      await sql`UPDATE gym_class_sessions SET schedule_id = ${slot.id} WHERE id = ${spin.id}`;
      expect(await booked(open, insider, spin.id)).toBe("booked");
      const body = { opensDays: 3, freeCancelMinutes: 30, handoverMinutes: 30, waitlistMax: 5, pt: { opensDays: 3, freeCancelMinutes: 30 } };
      const endingUrl = `/v1/orgs/${open.id}/class-bookings/ending?by=session&id=${spin.id}`;
      const cancelUrl = `/v1/orgs/${open.id}/class-sessions/${spin.id}/cancel`;

      // No sign-in at all.
      for (const [method, path] of [["GET", settingsUrl(open)], ["PUT", settingsUrl(open)], ["GET", endingUrl]] as const) {
        expect((await inject(method, path, {}, method === "PUT" ? body : undefined)).statusCode, path).toBe(401);
      }
      // A stranger, another gym's owner and a plain member are answered as if the gym were
      // not there; a trainer is told their role does not allow it.
      for (const [who, status] of [[stranger, 404], [sells.owner, 404], [insider, 404], [trainer, 403]] as const) {
        expect((await inject("GET", settingsUrl(open), who.cookies)).statusCode, who.name).toBe(status);
        expect((await inject("PUT", settingsUrl(open), who.cookies, body)).statusCode, who.name).toBe(status);
        expect((await inject("GET", endingUrl, who.cookies)).statusCode, who.name).toBe(status);
        expect((await inject("POST", cancelUrl, who.cookies, { confirmBookings: NOT_THEIRS })).statusCode, who.name).toBe(status);
        // The other three doors that end bookings: a time slot cancelled, a class archived,
        // a time slot moved.
        expect((await inject("DELETE", `/v1/orgs/${open.id}/class-repeats/${slot.id}?confirmBookings=${NOT_THEIRS}`, who.cookies)).statusCode, who.name).toBe(status);
        expect((await inject("DELETE", `/v1/orgs/${open.id}/classes/${spin.typeId}?confirmBookings=${NOT_THEIRS}`, who.cookies)).statusCode, who.name).toBe(status);
        const move = { updateFrom: londonDay(clock, 1), weekdays: [1, 2, 3, 4, 5, 6, 7], startMinute: 60, minutes: 45, places: 5, coachUserId: null, confirmBookings: NOT_THEIRS };
        expect((await inject("PUT", `/v1/orgs/${open.id}/class-repeats/${slot.id}`, who.cookies, move)).statusCode, who.name).toBe(status);
      }
      const [standing] = await sql<{ archived: boolean; ended: boolean; minute: number }[]>`
        SELECT t.archived_at IS NOT NULL AS archived, s.ended_at IS NOT NULL AS ended, s.local_start_minute AS minute
        FROM gym_class_types t JOIN gym_class_schedules s ON s.class_type_id = t.id WHERE s.id = ${slot.id}`;
      expect(standing).toEqual({ archived: false, ended: false, minute: spin.minute });
      // Another gym's owner cannot read this gym's people through their own gym's address.
      const cross = await inject("GET", `/v1/orgs/${sells.id}/class-bookings/ending?by=session&id=${spin.id}`, sells.owner.cookies);
      expect(cross.statusCode, cross.body).toBe(200);
      expect(JSON.parse(cross.body)).toMatchObject({ classes: 0, booked: 0, waiting: 0, people: [] });
      // Nor cancel its class with the right mark, the one this class's own gym is given.
      const theirs = asked(await inject("POST", cancelUrl, open.owner.cookies, {})).mark;
      expect((await inject("POST", `/v1/orgs/${sells.id}/class-sessions/${spin.id}/cancel`, sells.owner.cookies, { confirmBookings: theirs })).statusCode).toBe(404);
      expect(await tally(spin.id)).toEqual({ booked: 1 });
      const [row] = await sql<{ booking_opens_days: number }[]>`SELECT booking_opens_days FROM gyms WHERE id = ${open.id}`;
      expect(row?.booking_opens_days).toBe(7);

      // The owner reads the whole list, a page at a time.
      const owner = await inject("GET", endingUrl, open.owner.cookies);
      expect(JSON.parse(owner.body)).toMatchObject({ classes: 1, booked: 1, waiting: 0, next: null, people: [{ name: "Insider", waiting: false }] });
      expect((await inject("GET", `${endingUrl}&by=nothing`, open.owner.cookies)).statusCode).toBe(400);
      // The list never carries the bookings' counter, which is one for every gym.
      expect(owner.body).not.toContain("seq");
      // A page after a booking this gym does not have is empty, never another gym's.
      const after = await inject("GET", `${endingUrl}&after=${randomUUID()}`, open.owner.cookies);
      expect(JSON.parse(after.body)).toMatchObject({ booked: 1, people: [], next: null });
      expect((await inject("GET", `${endingUrl}&after=17`, open.owner.cookies)).statusCode).toBe(400);

      // A gym whose plan has lapsed still reads its settings and cannot change them.
      const lapsed = await makeGym("Lapsed");
      await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${lapsed.id}`;
      expect((await inject("GET", settingsUrl(lapsed), lapsed.owner.cookies)).statusCode).toBe(200);
      const refused = await inject("PUT", settingsUrl(lapsed), lapsed.owner.cookies, body);
      expect([refused.statusCode, errorOf(refused)]).toEqual([409, "gym_not_on_plan"]);
    },
    T,
  );

  // ── A MEMBERSHIP STAFF CANCEL (ROADMAP 17c-iii) ──
  //
  // The worst thing this job could do to a real person: staff cancel somebody's monthly
  // membership and the class they booked with the pack they paid for goes with it.

  /** A monthly membership type that includes every class without counting. */
  const monthlyTypeOf = async (gym: Gym): Promise<string> => {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_membership_types
        (gym_id, name, kind, price_minor, currency, term_count, term_unit, pack_classes, pack_days, access, bookings_limit, bookings_period, covers_all_classes)
      VALUES (${gym.id}, ${`Gold ${uniq()}`}, 'recurring', 4999, 'GBP', 1, 'month', NULL, NULL, 'all_classes', NULL, NULL, true)
      RETURNING id`;
    if (row === undefined) throw new Error("no type");
    return row.id;
  };
  /** That membership held from `daysAgo`, its first month paid. */
  const holdMonthly = async (gym: Gym, entryId: string, typeId: string, daysAgo = 5): Promise<string> => {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_held_memberships
        (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit, starts_on, status, paid_periods, renews)
      VALUES (${gym.id}, ${entryId}, ${typeId}, gen_random_uuid(), 'recurring', 4999, 'GBP', 1, 'month',
              ((now() AT TIME ZONE 'Europe/London')::date - ${daysAgo}::int), 'active', 1, true)
      RETURNING id`;
    if (row === undefined) throw new Error("no membership");
    return row.id;
  };
  const cancelHeld = (gym: Gym, entryId: string, heldId: string, body: Record<string, unknown>, who: Person = gym.owner, target = api()) =>
    inject("POST", `/v1/orgs/${gym.id}/member-list/entries/${entryId}/memberships/${heldId}/cancel`, who.cookies, body, target);
  const askedHeld = (res: { statusCode: number; body: string }): ClassBookingsEnding => {
    expect([res.statusCode, errorOf(res)], res.body).toEqual([409, "membership_has_bookings"]);
    return (JSON.parse(res.body) as { ending: ClassBookingsEnding }).ending;
  };
  /** One person's booking of one class, as the table has it. */
  const bookingOf = async (who: Person, sessionId: string) => {
    const rows = await sql<{ status: string; held: string | null; charged: boolean }[]>`
      SELECT status, held_membership_id AS held, pack_charged AS charged FROM gym_class_bookings
      WHERE session_id = ${sessionId} AND user_id = ${who.userId} ORDER BY seq`;
    return rows.map((r) => ({ status: r.status, held: r.held, charged: r.charged }));
  };
  const heldStatus = async (heldId: string) => {
    const [row] = await sql<{ status: string; renews: boolean }[]>`SELECT status, renews FROM gym_held_memberships WHERE id = ${heldId}`;
    return row;
  };

  it(
    "staff cancel a monthly membership: it asks first, then only the classes booked on IT end, each once, and a class booked on the person's pack stays",
    async () => {
      const gold = await monthlyTypeOf(sells);
      const maya = await packed(sells, packType, "Maya Pack", 5);
      const onPack = await classAt(sells, 3 * DAY, 10);
      const full = await classAt(sells, 4 * DAY, 1);
      const later = await classAt(sells, 5 * DAY, 10);
      const begun = await classAt(sells, -1, 10);
      // Six hours away, inside the gym's waitlist time (a day): a freed place waits for a claim.
      const near = await classAt(sells, 6, 1);

      // Booked while the pack is all she holds: this class is the pack's.
      expect(await booked(sells, maya, onPack.id)).toBe("booked");
      expect(await left(maya.pack)).toBe(4);
      // Then a monthly membership, which pays for a class before a pack does.
      const mayaGold = await holdMonthly(sells, maya.entryId, gold);
      expect(await booked(sells, maya, full.id)).toBe("booked");
      expect(await booked(sells, maya, later.id)).toBe("booked");
      expect(await left(maya.pack)).toBe(4);
      expect((await bookingOf(maya, onPack.id))[0]).toEqual({ status: "booked", held: maya.pack, charged: true });
      expect((await bookingOf(maya, full.id))[0]).toEqual({ status: "booked", held: mayaGold, charged: false });
      // A class that has started, booked on the same membership: history.
      await sql`
        INSERT INTO gym_class_bookings (gym_id, session_id, user_id, entry_id, request_key, status, held_membership_id, pack_charged, created_at, booked_at)
        VALUES (${sells.id}, ${begun.id}, ${maya.userId}, ${maya.entryId}, gen_random_uuid(), 'booked', ${mayaGold}, false, now(), now())`;
      // Tom waits for the full class; Zoe holds the same kind of membership and a place.
      const tom = await packed(sells, packType, "Tom Waiting", 5);
      expect(await booked(sells, tom, full.id, true)).toBe("waitlisted");
      const zoe = await listed(sells, "Zoe Gold");
      const zoeGold = await holdMonthly(sells, zoe.entryId, gold);
      expect(await booked(sells, zoe, later.id)).toBe("booked");
      expect(await booked(sells, maya, near.id)).toBe("booked");
      const uma = await packed(sells, packType, "Uma Near", 5);
      expect(await booked(sells, uma, near.id, true)).toBe("waitlisted");

      // The class's list for staff: the owner's carries each person's record on the list,
      // the way to their page; the class's own coach, who may not open that page, gets none.
      const coach = await member(sells, "Cleo Coach");
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${sells.id}, ${coach.userId}, 'trainer', NULL)`;
      await sql`UPDATE gym_class_sessions SET coach_user_id = ${coach.userId} WHERE id = ${later.id}`;
      const listOf = async (who: Person) => {
        const res = await inject("GET", `/v1/orgs/${sells.id}/class-sessions/${later.id}/bookings`, who.cookies);
        expect(res.statusCode, res.body).toBe(200);
        return (JSON.parse(res.body) as { booked: { name: string; entryId: string | null; membership: string | null }[] }).booked;
      };
      expect((await listOf(sells.owner)).map((b) => [b.name, b.entryId, b.membership !== null])).toEqual([
        ["Maya Pack", maya.entryId, true],
        ["Zoe Gold", zoe.entryId, true],
      ]);
      expect((await listOf(coach)).map((b) => [b.name, b.entryId, b.membership])).toEqual([
        ["Maya Pack", null, null],
        ["Zoe Gold", null, null],
      ]);
      // One tick each: the timetable's tick shows what was paid with and no record; the
      // members' tick, on the class this person coaches, shows the record and not what was paid with.
      const timetabler = await member(sells, "Tia Timetable");
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${sells.id}, ${timetabler.userId}, 'trainer', ${["members.read", "schedule.manage"]})`;
      expect((await listOf(timetabler)).map((b) => [b.name, b.entryId, b.membership !== null])).toEqual([
        ["Maya Pack", null, true],
        ["Zoe Gold", null, true],
      ]);
      const desk = await member(sells, "Dee Desk");
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${sells.id}, ${desk.userId}, 'trainer', ${["members.read", "members.confirm"]})`;
      expect((await inject("GET", `/v1/orgs/${sells.id}/class-sessions/${later.id}/bookings`, desk.cookies)).statusCode).toBe(403);
      await sql`UPDATE gym_class_sessions SET coach_user_id = ${desk.userId} WHERE id = ${later.id}`;
      expect((await listOf(desk)).map((b) => [b.name, b.entryId, b.membership])).toEqual([
        ["Maya Pack", maya.entryId, null],
        ["Zoe Gold", zoe.entryId, null],
      ]);

      // Without the mark it only asks, naming the classes, and changes nothing.
      const ask = askedHeld(await cancelHeld(sells, maya.entryId, mayaGold, { when: "today" }));
      expect({ classes: ask.classes, booked: ask.booked, waiting: ask.waiting }).toEqual({ classes: 3, booked: 3, waiting: 0 });
      expect(ask.people.map((p) => [p.name, p.waiting, p.localStartMinute])).toEqual([
        ["Maya Pack", false, full.minute],
        ["Maya Pack", false, later.minute],
        ["Maya Pack", false, near.minute],
      ]);
      // A mark that is not theirs is asked again.
      expect(askedHeld(await cancelHeld(sells, maya.entryId, mayaGold, { when: "today", confirmBookings: NOT_THEIRS })).booked).toBe(3);
      expect((await heldStatus(mayaGold))?.status).toBe("active");
      expect(await tally(full.id)).toEqual({ booked: 1, waitlisted: 1 });

      // Nobody outside the gym's staff cancels it, with the right mark or without.
      const stranger = await signedIn("Stranger");
      for (const who of [stranger, open.owner, zoe]) {
        const res = await cancelHeld(sells, maya.entryId, mayaGold, { when: "today", confirmBookings: ask.mark }, who);
        expect([403, 404], who.name).toContain(res.statusCode);
      }
      expect((await inject("POST", `/v1/orgs/${sells.id}/member-list/entries/${maya.entryId}/memberships/${mayaGold}/cancel`, {}, { when: "today" })).statusCode).toBe(401);
      // Another gym's owner, through their own gym's address, finds no such membership.
      expect((await inject("POST", `/v1/orgs/${open.id}/member-list/entries/${maya.entryId}/memberships/${mayaGold}/cancel`, open.owner.cookies, { when: "today", confirmBookings: ask.mark })).statusCode).toBe(404);
      expect((await heldStatus(mayaGold))?.status).toBe("active");
      expect(await tally(later.id)).toEqual({ booked: 2 });

      // Two staff cancels on two servers, at the instant Maya cancels one class herself. A
      // cancel that lost the race is told the new mark and sends it.
      const staffCancel = async (n: number): Promise<void> => {
        let confirm = ask.mark;
        for (let tries = 0; tries < 20; tries++) {
          const res = await cancelHeld(sells, maya.entryId, mayaGold, { when: "today", confirmBookings: confirm }, sells.owner, either(n));
          if (res.statusCode === 200) return;
          confirm = askedHeld(res).mark;
        }
        throw new Error("the membership was never cancelled");
      };
      await Promise.all([staffCancel(0), staffCancel(1), cancel(sells, maya, later.id, either(1))]);

      expect(await heldStatus(mayaGold)).toEqual({ status: "cancelled", renews: true });
      // The pack's class is hers still, and the pack was neither charged again nor given a class.
      expect(await bookingOf(maya, onPack.id)).toEqual([{ status: "booked", held: maya.pack, charged: true }]);
      expect(await left(maya.pack)).toBe(4);
      // The two on the membership ended, and the full class's place went to Tom, charged once.
      expect((await bookingOf(maya, full.id)).map((b) => b.status)).toEqual(["cancelled"]);
      expect((await bookingOf(maya, later.id)).map((b) => b.status)).toEqual(["cancelled"]);
      expect(await bookingOf(tom, full.id)).toEqual([{ status: "booked", held: tom.pack, charged: true }]);
      expect(await left(tom.pack)).toBe(4);
      // Inside the waitlist time the place is free and nobody is moved in: Uma still waits, uncharged.
      expect((await bookingOf(maya, near.id)).map((b) => b.status)).toEqual(["cancelled"]);
      expect(await bookingOf(uma, near.id)).toEqual([{ status: "waitlisted", held: null, charged: false }]);
      expect(await left(uma.pack)).toBe(5);
      // The class that had started keeps its row, and Zoe's membership and place are hers.
      expect((await bookingOf(maya, begun.id)).map((b) => b.status)).toEqual(["booked"]);
      expect(await bookingOf(zoe, later.id)).toEqual([{ status: "booked", held: zoeGold, charged: false }]);
      expect((await heldStatus(zoeGold))?.status).toBe("active");

      // The cancel arriving again changes nothing.
      expect((await cancelHeld(sells, maya.entryId, mayaGold, { when: "today", confirmBookings: NOT_THEIRS })).statusCode).toBe(200);
      expect(await left(tom.pack)).toBe(4);
      expect(await left(maya.pack)).toBe(4);
      expect(await tally(full.id)).toEqual({ booked: 1, cancelled: 1 });
    },
    T,
  );

  it(
    "a membership cancelled on its last paid day keeps the classes up to that day and ends the ones after it; a cancelled pack ends its classes and nobody is asked where nothing is booked",
    async () => {
      const gold = await monthlyTypeOf(sells);
      const ana = await listed(sells, "Ana Monthly");
      // Twenty days into a paid month: its last day is some ten days on.
      const anaGold = await holdMonthly(sells, ana.entryId, gold, 20);
      const soon = await classAt(sells, 3 * DAY, 10);
      const after = await classAt(sells, 15 * DAY, 10);
      expect(await booked(sells, ana, soon.id)).toBe("booked");
      // Booked when the membership still renewed (booking opens seven days ahead, so by hand).
      await sql`
        INSERT INTO gym_class_bookings (gym_id, session_id, user_id, entry_id, request_key, status, held_membership_id, pack_charged, created_at, booked_at)
        VALUES (${sells.id}, ${after.id}, ${ana.userId}, ${ana.entryId}, gen_random_uuid(), 'booked', ${anaGold}, false, now(), now())`;

      // The edge: a class late ON the last paid day stays, one early the day after ends.
      const read = await inject("GET", `/v1/orgs/${sells.id}/member-list/entries/${ana.entryId}/memberships`, sells.owner.cookies);
      const lastDay = (JSON.parse(read.body) as { memberships: { id: string; view: { can: { cancelAtPeriodEnd: string | null } } }[] }).memberships.find((m) => m.id === anaGold)?.view.can.cancelAtPeriodEnd;
      if (typeof lastDay !== "string") throw new Error("no last paid day");
      const onDayAt = async (day: string, plusDays: number, minute: number): Promise<string> => {
        const [type] = await sql<{ id: string }[]>`
          INSERT INTO gym_class_types (gym_id, name, minutes, places, colour, open_gym) VALUES (${sells.id}, ${`Edge ${uniq()}`}, 30, 10, 'blue', false) RETURNING id`;
        if (type === undefined) throw new Error("no class type");
        const [row] = await sql<{ id: string }[]>`
          INSERT INTO gym_class_sessions (gym_id, class_type_id, local_date, local_start_minute, starts_at, minutes, places, status)
          SELECT ${sells.id}, ${type.id}, d, ${minute}, (d + make_interval(mins => ${minute})) AT TIME ZONE 'Europe/London', 30, 10, 'scheduled'
          FROM (SELECT ${day}::date + ${plusDays}::int AS d) x
          RETURNING id`;
        if (row === undefined) throw new Error("no class");
        await sql`
          INSERT INTO gym_class_bookings (gym_id, session_id, user_id, entry_id, request_key, status, held_membership_id, pack_charged, created_at, booked_at)
          VALUES (${sells.id}, ${row.id}, ${ana.userId}, ${ana.entryId}, gen_random_uuid(), 'booked', ${anaGold}, false, now(), now())`;
        return row.id;
      };
      const lastNight = await onDayAt(lastDay, 0, 23 * 60 + 30);
      const nextMorning = await onDayAt(lastDay, 1, 15);

      const ask = askedHeld(await cancelHeld(sells, ana.entryId, anaGold, { when: "period_end" }));
      expect({ classes: ask.classes, booked: ask.booked }).toEqual({ classes: 2, booked: 2 });
      expect(ask.people.map((p) => p.localStartMinute).sort((a, b) => a - b)).toEqual([15, after.minute].sort((a, b) => a - b));
      expect(await heldStatus(anaGold)).toEqual({ status: "active", renews: true });
      expect((await cancelHeld(sells, ana.entryId, anaGold, { when: "period_end", confirmBookings: ask.mark })).statusCode).toBe(200);
      expect((await bookingOf(ana, lastNight)).map((b) => b.status)).toEqual(["booked"]);
      expect((await bookingOf(ana, nextMorning)).map((b) => b.status)).toEqual(["cancelled"]);
      expect(await heldStatus(anaGold)).toEqual({ status: "active", renews: false });
      expect((await bookingOf(ana, soon.id)).map((b) => b.status)).toEqual(["booked"]);
      expect((await bookingOf(ana, after.id)).map((b) => b.status)).toEqual(["cancelled"]);

      // A pack cancelled: its class ends, is no longer charged, and is back on the pack's count.
      const pat = await packed(sells, packType, "Pat Pack", 5);
      expect(await booked(sells, pat, soon.id)).toBe("booked");
      expect(await left(pat.pack)).toBe(4);
      const patAsk = askedHeld(await cancelHeld(sells, pat.entryId, pat.pack, { when: "today" }));
      expect(patAsk.booked).toBe(1);
      expect((await cancelHeld(sells, pat.entryId, pat.pack, { when: "today", confirmBookings: patAsk.mark })).statusCode).toBe(200);
      expect(await bookingOf(pat, soon.id)).toEqual([{ status: "cancelled", held: pat.pack, charged: false }]);
      expect([(await heldStatus(pat.pack))?.status, await left(pat.pack)]).toEqual(["cancelled", 5]);

      // Nothing booked on it: cancelled at once, and a mark sent anyway does not stop it.
      const sam = await listed(sells, "Sam Monthly");
      const samGold = await holdMonthly(sells, sam.entryId, gold);
      expect((await cancelHeld(sells, sam.entryId, samGold, { when: "today", confirmBookings: NOT_THEIRS })).statusCode).toBe(200);
      expect((await heldStatus(samGold))?.status).toBe("cancelled");
    },
    T,
  );
});
