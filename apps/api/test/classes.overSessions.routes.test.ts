// A CLASS PUT OVER A PERSONAL TRAINING SESSION — the timetable's routes against real
// Postgres (DATABASE_URL-gated), on two api instances over one database. Spec Part 3 §13.5;
// ROADMAP 17e-iii-a.
//
// The worst thing this job could do to a real person: Maya turns up for a session she paid
// for and Sam is teaching a class, because the app let staff put the class on him without
// a word. So every way a class can land on a trainer asks first, naming the session, and
// writes nothing until staff confirm. That is the first test below.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { ClassOverSessions, GymClassWeekResponse, GymClassesResponse, PtAppointment } from "@app/shared";
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
  JWT_SECRET: "class-over-sessions-routes-secret-012345", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
type Reply = { statusCode: number; body: string };

const T = 240_000;
const LIVE_PLAN = "zz_cos_live";
/** Wednesday 7 October 2026, 07:30 in London (summer time, one hour ahead of UTC). */
const NOW = new Date("2026-10-07T06:30:00Z");
const TODAY = "2026-10-07";
const FRIDAY = "2026-10-09";
const NEXT_FRIDAY = "2026-10-16";
const at = (hour: number, minute = 0): number => hour * 60 + minute;
/** A mark no set of sessions has. */
const WRONG = "0".repeat(64);

let ipCounter = 0;
const nextIp = () => `10.78.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
const redisUrl = process.env["TEST_REDIS_URL"];
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("a class put over a personal training session (real Postgres, two api instances)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  let second: App | undefined;
  let redis: RedisLike | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'cos-t-%@example.com')`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_pt_appointments WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_trainers WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_bookings WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_schedules WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'cos-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST" | "PUT", path: string, cookies: Cookies, payload?: unknown, ip = nextIp(), target = api()) =>
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
    const email = `cos-t-${uniq()}@example.com`;
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
  const staff = async (gym: Gym, name: string, privileges: string[] | null = null): Promise<Person> => {
    const person = await signedIn(name);
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${person.userId}, 'trainer', ${privileges})`;
    return person;
  };
  /** A trainer free 09:00 to 13:00 every day, in sessions of an hour. */
  const trainer = async (gym: Gym, name: string): Promise<Person> => {
    const person = await staff(gym, name);
    const res = await inject("PUT", `/v1/orgs/${gym.id}/pt/trainers/${person.userId}`, gym.owner.cookies, {
      offers: true,
      sessionMinutes: 60,
      hours: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, fromMinute: 540, toMinute: 780 })),
    });
    expect(res.statusCode, res.body).toBe(200);
    return person;
  };
  const listed = async (gym: Gym, name: string): Promise<string> => {
    const res = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName: name, email: `cos-l-${uniq()}@example.com` });
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
  };
  /** A pack of ten sessions of personal training, held by this person. */
  const pack = async (gym: Gym, entryId: string): Promise<string> => {
    const [type] = await sql<{ id: string }[]>`
      INSERT INTO gym_membership_types
        (gym_id, name, kind, price_minor, currency, pack_classes, pack_days, access, covers_all_classes, includes_pt)
      VALUES (${gym.id}, ${`PT 10 ${uniq()}`}, 'pack', 4000, 'GBP', 10, 60, 'all_classes', true, true)
      RETURNING id`;
    if (type === undefined) throw new Error("no type");
    const [held] = await sql<{ id: string }[]>`
      INSERT INTO gym_held_memberships
        (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, pack_classes, pack_days, classes_left, starts_on, status, renews)
      VALUES (${gym.id}, ${entryId}, ${type.id}, gen_random_uuid(), 'pack', 4000, 'GBP', 10, 60, 10, '2026-10-01'::date, 'active', false)
      RETURNING id`;
    if (held === undefined) throw new Error("no membership");
    return held.id;
  };
  const packLeft = async (heldId: string): Promise<number | null> => {
    const [row] = await sql<{ classes_left: number | null }[]>`SELECT classes_left FROM gym_held_memberships WHERE id = ${heldId}`;
    return row?.classes_left ?? null;
  };

  const book = (gym: Gym, who: Person, entryId: string, over: { day?: string; minute?: number; target?: App } = {}) =>
    inject(
      "POST",
      `/v1/orgs/${gym.id}/pt/appointments`,
      gym.owner.cookies,
      { requestKey: randomUUID(), trainerId: who.userId, entryId, localDate: over.day ?? FRIDAY, startMinute: over.minute ?? at(10), minutes: 60 },
      nextIp(),
      over.target ?? api(),
    );
  const booked = async (gym: Gym, who: Person, entryId: string, over: { day?: string; minute?: number } = {}): Promise<PtAppointment> => {
    const res = await book(gym, who, entryId, over);
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { appointment: PtAppointment }).appointment;
  };
  const appointments = (gym: Gym) => sql<{ id: string; status: string; pack_charged: boolean }[]>`
    SELECT id, status, pack_charged FROM gym_pt_appointments WHERE gym_id = ${gym.id} ORDER BY starts_at, id`;

  // ── The timetable's own routes ──
  const timetable = (res: Reply): GymClassesResponse => JSON.parse(res.body) as GymClassesResponse;
  const makeType = async (gym: Gym, name: string, over: { openGym?: boolean } = {}): Promise<string> => {
    const res = await inject("POST", `/v1/orgs/${gym.id}/classes`, gym.owner.cookies, { name, minutes: 45, places: 10, colour: "blue", ...over });
    expect(res.statusCode, res.body).toBe(201);
    const id = timetable(res).entries.find((e) => e.type.name === name)?.type.id;
    if (id === undefined) throw new Error("create answered no class");
    return id;
  };
  interface SlotBody {
    weekdays?: number[];
    startMinute?: number;
    minutes?: number;
    coachUserId?: string | null;
  }
  const slotBody = (over: SlotBody) => ({
    weekdays: over.weekdays ?? [5],
    startMinute: over.startMinute ?? at(10, 30),
    minutes: over.minutes ?? 45,
    places: 10,
    coachUserId: over.coachUserId ?? null,
  });
  const addSlot = (gym: Gym, typeId: string, over: SlotBody, confirm?: string, by: Person = gym.owner, target = api()) =>
    inject(
      "POST",
      `/v1/orgs/${gym.id}/classes/${typeId}/repeats`,
      by.cookies,
      { ...slotBody(over), startsOn: TODAY, ...(confirm === undefined ? {} : { confirmTrainerSessions: confirm }) },
      nextIp(),
      target,
    );
  /** A time slot added, and its id. */
  const slot = async (gym: Gym, typeId: string, over: SlotBody): Promise<string> => {
    const res = await addSlot(gym, typeId, over);
    expect(res.statusCode, res.body).toBe(201);
    const want = slotBody(over);
    const found = timetable(res)
      .entries.find((e) => e.type.id === typeId)
      ?.schedules.find((s) => s.startMinute === want.startMinute && s.weekdays.join() === want.weekdays.join());
    if (found === undefined) throw new Error("the time slot was not answered");
    return found.id;
  };
  const editSlot = (gym: Gym, scheduleId: string, over: SlotBody, confirm?: string, more: Record<string, string> = {}) =>
    inject("PUT", `/v1/orgs/${gym.id}/class-repeats/${scheduleId}`, gym.owner.cookies, {
      ...slotBody(over),
      updateFrom: TODAY,
      ...more,
      ...(confirm === undefined ? {} : { confirmTrainerSessions: confirm }),
    });
  /** The class of one kind on a day of the calendar. */
  const classOn = async (gym: Gym, typeId: string, day: string): Promise<string> => {
    const res = await inject("GET", `/v1/orgs/${gym.id}/class-sessions?week=${day}`, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    const found = (JSON.parse(res.body) as GymClassWeekResponse).sessions.find((s) => s.classTypeId === typeId && s.localDate === day);
    if (found === undefined) throw new Error(`no class on ${day}`);
    return found.id;
  };
  const changeClass = (gym: Gym, sessionId: string, scope: "this" | "future", over: SlotBody, confirm?: string) => {
    const fields = slotBody(over);
    return inject("PUT", `/v1/orgs/${gym.id}/class-sessions/${sessionId}`, gym.owner.cookies, {
      scope,
      startMinute: fields.startMinute,
      minutes: fields.minutes,
      places: fields.places,
      coachUserId: fields.coachUserId,
      ...(confirm === undefined ? {} : { confirmTrainerSessions: confirm }),
    });
  };

  const asked = (res: Reply): ClassOverSessions => {
    expect(res.statusCode, res.body).toBe(409);
    const body = JSON.parse(res.body) as { error: string; sessions: ClassOverSessions };
    expect(body.error).toBe("class_over_pt_sessions");
    return body.sessions;
  };
  const errorOf = (res: Reply): string => (JSON.parse(res.body) as { error: string }).error;

  /** Everything a change to the timetable could have written, as one string. */
  const written = async (gym: Gym): Promise<string> => {
    const types = await sql`SELECT id, name, open_gym, coach_user_id, minutes, places FROM gym_class_types WHERE gym_id = ${gym.id} ORDER BY id`;
    const slots = await sql`
      SELECT id, weekdays, local_start_minute, starts_on::text, ends_on::text, ended_at, minutes, places, coach_user_id
      FROM gym_class_schedules WHERE gym_id = ${gym.id} ORDER BY id`;
    const classes = await sql`
      SELECT id, schedule_id, local_date::text, local_start_minute, starts_at, minutes, places, coach_user_id, status, changed_alone
      FROM gym_class_sessions WHERE gym_id = ${gym.id} ORDER BY id`;
    const bookings = await sql`SELECT id, session_id, status, pack_charged, cancelled_at FROM gym_class_bookings WHERE gym_id = ${gym.id} ORDER BY id`;
    const packs = await sql`SELECT id, status, classes_left FROM gym_held_memberships WHERE gym_id = ${gym.id} ORDER BY id`;
    const sessions = await sql`SELECT id, status, pack_charged FROM gym_pt_appointments WHERE gym_id = ${gym.id} ORDER BY id`;
    const [audit] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${gym.id}`;
    return JSON.stringify({ types, slots, classes, bookings, packs, sessions, audit: audit?.n });
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    redis = redisUrl === undefined || redisUrl === "" ? createMemoryRedis() : createIoRedis(redisUrl);
    for (let tries = 0; (await redis.incrWithTtl(`cos-ready:${randomUUID()}`, 30)) === null; tries++) {
      if (tries === 100) throw new Error("the Redis at TEST_REDIS_URL never connected");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const overrides = { redis, orgs: { now: () => NOW } };
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
  }, T);

  // Maya is booked with Sam on Friday from 10:00 to 11:00, on her pack of ten. Each row is
  // one way staff can then put a class Sam coaches over that hour. `arrange` sets the
  // timetable up (before or after the booking, as the way needs) and answers the request.
  interface Way {
    name: string;
    /** What is on the timetable before Maya books. */
    before?: (gym: Gym, sam: Person) => Promise<Record<string, string>>;
    /** The change itself; `made` is what `before` answered. */
    act: (gym: Gym, sam: Person, made: Record<string, string>, confirm?: string) => Promise<Reply>;
    ok: number;
    /** What the same change answers once it is saved: its status, and its error if refused. */
    again: [number, string | null];
    className: string;
  }
  const WAYS: Way[] = [
    {
      name: "a new time slot",
      before: async (gym) => ({ type: await makeType(gym, "Spin") }),
      act: (gym, sam, made, confirm) => addSlot(gym, made["type"] ?? "", { coachUserId: sam.userId }, confirm),
      ok: 201,
      again: [409, "repeat_clashes"],
      className: "Spin",
    },
    {
      name: "a time slot given to the trainer",
      before: async (gym) => {
        const type = await makeType(gym, "Spin");
        return { slot: await slot(gym, type, {}) };
      },
      act: (gym, sam, made, confirm) => editSlot(gym, made["slot"] ?? "", { coachUserId: sam.userId }, confirm),
      ok: 200,
      again: [200, null],
      className: "Spin",
    },
    {
      name: "a time slot moved to that time",
      before: async (gym, sam) => {
        const type = await makeType(gym, "Spin");
        return { slot: await slot(gym, type, { startMinute: at(15), coachUserId: sam.userId }) };
      },
      act: (gym, sam, made, confirm) => editSlot(gym, made["slot"] ?? "", { coachUserId: sam.userId }, confirm),
      ok: 200,
      // A move ends the time slot and starts another: the old one is no longer there.
      again: [404, "class_not_found"],
      className: "Spin",
    },
    {
      name: "a time slot made longer",
      before: async (gym, sam) => {
        const type = await makeType(gym, "Spin");
        return { slot: await slot(gym, type, { startMinute: at(9), minutes: 60, coachUserId: sam.userId }) };
      },
      act: (gym, sam, made, confirm) => editSlot(gym, made["slot"] ?? "", { startMinute: at(9), minutes: 90, coachUserId: sam.userId }, confirm),
      ok: 200,
      again: [200, null],
      className: "Spin",
    },
    {
      name: "this and future classes, from the Calendar",
      before: async (gym) => {
        const type = await makeType(gym, "Spin");
        await slot(gym, type, {});
        return { session: await classOn(gym, type, FRIDAY) };
      },
      act: (gym, sam, made, confirm) => changeClass(gym, made["session"] ?? "", "future", { coachUserId: sam.userId }, confirm),
      ok: 200,
      again: [200, null],
      className: "Spin",
    },
    {
      name: "every time slot of a class at once",
      before: async (gym) => {
        const type = await makeType(gym, "Spin");
        const a = await slot(gym, type, {});
        const b = await slot(gym, type, { weekdays: [1], startMinute: at(18) });
        return { type, a, b };
      },
      act: (gym, sam, made, confirm) =>
        inject("POST", `/v1/orgs/${gym.id}/classes/${made["type"] ?? ""}/bulk-edit`, gym.owner.cookies, {
          scheduleIds: [made["a"], made["b"]],
          updateFrom: TODAY,
          set: { coachUserId: sam.userId },
          ...(confirm === undefined ? {} : { confirmTrainerSessions: confirm }),
        }),
      ok: 200,
      again: [200, null],
      className: "Spin",
    },
    {
      name: "one class given to the trainer",
      before: async (gym) => {
        const type = await makeType(gym, "Spin");
        await slot(gym, type, {});
        return { session: await classOn(gym, type, FRIDAY) };
      },
      act: (gym, sam, made, confirm) => changeClass(gym, made["session"] ?? "", "this", { coachUserId: sam.userId }, confirm),
      ok: 200,
      again: [200, null],
      className: "Spin",
    },
    {
      name: "one class moved to that time",
      before: async (gym, sam) => {
        const type = await makeType(gym, "Spin");
        await slot(gym, type, { startMinute: at(15), coachUserId: sam.userId });
        return { session: await classOn(gym, type, FRIDAY) };
      },
      act: (gym, sam, made, confirm) => changeClass(gym, made["session"] ?? "", "this", { startMinute: at(10, 45), coachUserId: sam.userId }, confirm),
      ok: 200,
      again: [200, null],
      className: "Spin",
    },
    {
      name: "a cancelled class put back",
      before: async (gym, sam) => {
        const type = await makeType(gym, "Spin");
        await slot(gym, type, { coachUserId: sam.userId });
        const session = await classOn(gym, type, FRIDAY);
        const res = await inject("POST", `/v1/orgs/${gym.id}/class-sessions/${session}/cancel`, gym.owner.cookies, {});
        expect(res.statusCode, res.body).toBe(200);
        return { session };
      },
      act: (gym, _sam, made, confirm) =>
        inject(
          "POST",
          `/v1/orgs/${gym.id}/class-sessions/${made["session"] ?? ""}/restore`,
          gym.owner.cookies,
          confirm === undefined ? {} : { confirmTrainerSessions: confirm },
        ),
      ok: 200,
      again: [200, null],
      className: "Spin",
    },
    {
      name: "an open-gym slot made a taught class",
      before: async (gym, sam) => {
        const type = await makeType(gym, "Open floor", { openGym: true });
        await slot(gym, type, { coachUserId: sam.userId });
        return { type };
      },
      act: (gym, _sam, made, confirm) =>
        inject("PUT", `/v1/orgs/${gym.id}/classes/${made["type"] ?? ""}`, gym.owner.cookies, {
          name: "Open floor",
          minutes: 45,
          places: 10,
          colour: "blue",
          openGym: false,
          ...(confirm === undefined ? {} : { confirmTrainerSessions: confirm }),
        }),
      ok: 200,
      again: [200, null],
      className: "Open floor",
    },
  ];

  it.each(WAYS)(
    "$name over a booked session asks first, naming it, writes nothing until confirmed, and then leaves the session booked",
    async (way) => {
      const gym = await makeGym(`Ask ${uniq()}`);
      const sam = await trainer(gym, "Sam Reed");
      const maya = await listed(gym, "Maya Lopez");
      const held = await pack(gym, maya);
      const made = way.before === undefined ? {} : await way.before(gym, sam);
      const session = await booked(gym, sam, maya);
      expect(await packLeft(held)).toBe(9);
      const stood = await written(gym);

      // No confirm, and a confirm that is not these sessions' mark: asked, and nothing written.
      let mark = "";
      for (const confirm of [undefined, WRONG]) {
        const ask = asked(await way.act(gym, sam, made, confirm));
        mark = ask.mark;
        expect(ask.count).toBe(1);
        expect(ask.shown).toEqual([
          { id: session.id, trainerName: "Sam Reed", name: "Maya Lopez", className: way.className, localDate: FRIDAY, localStartMinute: at(10), minutes: 60 },
        ]);
        expect(await written(gym)).toBe(stood);
      }

      // Confirmed: the class is on the timetable, and Maya's session and her pack are as they were.
      const res = await way.act(gym, sam, made, mark);
      expect(res.statusCode, res.body).toBe(way.ok);
      expect(await written(gym)).not.toBe(stood);
      const [over] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM gym_class_sessions s JOIN gym_class_types t ON t.id = s.class_type_id
        WHERE s.gym_id = ${gym.id} AND s.coach_user_id = ${sam.userId} AND s.status = 'scheduled' AND NOT t.open_gym
          AND s.local_date = ${FRIDAY}::date AND s.local_start_minute < ${at(11)} AND s.local_start_minute + s.minutes > ${at(10)}`;
      expect(over?.n).toBe(1);
      expect(await appointments(gym)).toEqual([{ id: session.id, status: "booked", pack_charged: true }]);
      expect(await packLeft(held)).toBe(9);

      // The same change again has nothing new to ask about, and answers as it would have
      // with no session there.
      const again = await way.act(gym, sam, made);
      expect([again.statusCode, again.statusCode === 200 ? null : errorOf(again)], again.body).toEqual(way.again);
    },
  );

  it("names every session, the earliest first, with their whole number, and a session booked while the box is open asks again", async () => {
    const gym = await makeGym(`Many ${uniq()}`);
    const sam = await trainer(gym, "Sam Reed");
    const maya = await listed(gym, "Maya Lopez");
    const leo = await listed(gym, "Leo Park");
    const type = await makeType(gym, "Spin");
    const later = await booked(gym, sam, leo, { day: NEXT_FRIDAY, minute: at(10) });
    const first = await booked(gym, sam, maya);
    // Thursday at the same hour is not a Friday class's business.
    await booked(gym, sam, leo, { day: "2026-10-08", minute: at(10) });

    const ask = asked(await addSlot(gym, type, { coachUserId: sam.userId }));
    expect(ask.count).toBe(2);
    expect(ask.mark).toMatch(/^[0-9a-f]{64}$/);
    expect(ask.shown.map((s) => [s.id, s.name, s.localDate])).toEqual([
      [first.id, "Maya Lopez", FRIDAY],
      [later.id, "Leo Park", NEXT_FRIDAY],
    ]);

    // A third is booked before staff press the button: the number they were shown is no longer it.
    const third = await booked(gym, sam, maya, { day: "2026-10-23", minute: at(10) });
    const stood = await written(gym);
    const stale = asked(await addSlot(gym, type, { coachUserId: sam.userId }, ask.mark));
    expect([stale.count, stale.shown.map((s) => s.id)]).toEqual([3, [first.id, later.id, third.id]]);
    expect(stale.mark).not.toBe(ask.mark);
    expect(await written(gym)).toBe(stood);
    expect((await addSlot(gym, type, { coachUserId: sam.userId }, stale.mark)).statusCode).toBe(201);
  });

  it("one session cancelled and another booked while the box is open: the number is the same, and the new person is still asked about", async () => {
    const gym = await makeGym(`Swap ${uniq()}`);
    const sam = await trainer(gym, "Sam Reed");
    const maya = await listed(gym, "Maya Lopez");
    const leo = await listed(gym, "Leo Park");
    const type = await makeType(gym, "Spin");
    const mayas = await booked(gym, sam, maya);
    const shown = asked(await addSlot(gym, type, { coachUserId: sam.userId }));
    expect([shown.count, shown.shown.map((s) => s.name)]).toEqual([1, ["Maya Lopez"]]);

    const cancel = await inject("POST", `/v1/orgs/${gym.id}/pt/appointments/${mayas.id}/cancel`, gym.owner.cookies, { lateOk: false, giveBack: false });
    expect(cancel.statusCode, cancel.body).toBe(200);
    await booked(gym, sam, leo);
    const stood = await written(gym);
    // Staff press the button under Maya's name. Leo was never shown to them.
    const swapped = asked(await addSlot(gym, type, { coachUserId: sam.userId }, shown.mark));
    expect([swapped.count, swapped.shown.map((s) => s.name)]).toEqual([1, ["Leo Park"]]);
    expect(swapped.mark).not.toBe(shown.mark);
    expect(await written(gym)).toBe(stood);
    expect((await addSlot(gym, type, { coachUserId: sam.userId }, swapped.mark)).statusCode).toBe(201);
  });

  it("a move that ends people's class bookings and is then stopped by the sessions question ends nobody's booking", async () => {
    const gym = await makeGym(`Both ${uniq()}`);
    const sam = await trainer(gym, "Sam Reed");
    const maya = await listed(gym, "Maya Lopez");
    const leo = await listed(gym, "Leo Park");
    await pack(gym, maya);
    const leosPack = await pack(gym, leo);
    const type = await makeType(gym, "Spin");
    const slotId = await slot(gym, type, { startMinute: at(15), coachUserId: sam.userId });
    const friday = await classOn(gym, type, FRIDAY);
    // Leo holds a place on Friday's 15:00 class, paid with a class off his pack.
    await sql`UPDATE gym_held_memberships SET classes_left = 9 WHERE id = ${leosPack}`;
    await sql`
      INSERT INTO gym_class_bookings (gym_id, session_id, user_id, entry_id, held_membership_id, status, pack_charged, request_key, booked_at)
      VALUES (${gym.id}, ${friday}, ${gym.owner.userId}, ${leo}, ${leosPack}, 'booked', true, gen_random_uuid(), now())`;
    await booked(gym, sam, maya);
    const stood = await written(gym);

    // The move to 10:30 first asks about Leo's booking, which the move would end.
    const first = await editSlot(gym, slotId, { coachUserId: sam.userId });
    expect([first.statusCode, errorOf(first)]).toEqual([409, "class_has_bookings"]);
    const leos = (JSON.parse(first.body) as { ending: { mark: string } }).ending.mark;
    // Staff say yes to that. Now it asks about Maya's session, and Leo's booking and pack are as they were.
    const second = asked(await editSlot(gym, slotId, { coachUserId: sam.userId }, undefined, { confirmBookings: leos }));
    expect(second.shown.map((s) => s.name)).toEqual(["Maya Lopez"]);
    expect(await written(gym)).toBe(stood);
    expect(await packLeft(leosPack)).toBe(9);

    // Both answered: the time slot moves, Leo's booking ends and his pack has its class back.
    const done = await editSlot(gym, slotId, { coachUserId: sam.userId }, second.mark, { confirmBookings: leos });
    expect(done.statusCode, done.body).toBe(200);
    const [left] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_class_bookings WHERE gym_id = ${gym.id} AND status = 'booked'`;
    expect([left?.n, await packLeft(leosPack)]).toEqual([0, 10]);
  });

  it("a day at the far edge of the calendar whose classes were not written yet is written before a session is booked on it", async () => {
    const gym = await makeGym(`Edge ${uniq()}`);
    const sam = await trainer(gym, "Sam Reed");
    const maya = await listed(gym, "Maya Lopez");
    const type = await makeType(gym, "Spin");
    await slot(gym, type, { coachUserId: sam.userId });
    // Friday 27 November is in the last week sessions can be booked for. The nightly job
    // missed it: its class is not on the calendar.
    const far = "2026-11-27";
    const gone = await sql`DELETE FROM gym_class_sessions WHERE gym_id = ${gym.id} AND local_date = ${far}::date`;
    expect(gone.count).toBe(1);
    const res = await book(gym, sam, maya, { day: far, minute: at(10) });
    expect([res.statusCode, errorOf(res)]).toEqual([409, "trainer_in_class"]);
    const [back] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_class_sessions WHERE gym_id = ${gym.id} AND local_date = ${far}::date`;
    expect(back?.n).toBe(1);
    expect(await appointments(gym)).toEqual([]);
    // The hour before the class is still his to give.
    expect((await book(gym, sam, maya, { day: far, minute: at(9) })).statusCode).toBe(200);
  });

  it("does not ask where no session is run into: another coach, nobody, an open-gym slot, the hour before and after, a cancelled session", async () => {
    const gym = await makeGym(`Quiet ${uniq()}`);
    const sam = await trainer(gym, "Sam Reed");
    const ana = await trainer(gym, "Ana Diaz");
    const maya = await listed(gym, "Maya Lopez");
    const leo = await listed(gym, "Leo Park");
    await booked(gym, sam, maya);
    const gone = await booked(gym, sam, leo, { minute: at(12) });
    const cancel = await inject("POST", `/v1/orgs/${gym.id}/pt/appointments/${gone.id}/cancel`, gym.owner.cookies, { lateOk: false, giveBack: false });
    expect(cancel.statusCode, cancel.body).toBe(200);

    const spin = await makeType(gym, "Spin");
    const open = await makeType(gym, "Open floor", { openGym: true });
    const cases: [string, string, SlotBody][] = [
      ["another coach at that hour", spin, { coachUserId: ana.userId }],
      ["nobody named as coach", spin, { startMinute: at(10, 15) }],
      ["an open-gym slot with the trainer named", open, { coachUserId: sam.userId }],
      ["a class that ends as the session starts", spin, { startMinute: at(9), minutes: 60, coachUserId: sam.userId }],
      ["a class that starts as the session ends", spin, { startMinute: at(11), minutes: 60, coachUserId: sam.userId }],
      ["a class over a session that was cancelled", spin, { startMinute: at(12, 15), coachUserId: sam.userId }],
      ["the same hour on another day", spin, { weekdays: [4], startMinute: at(10, 5), coachUserId: sam.userId }],
    ];
    for (const [name, type, body] of cases) {
      const res = await addSlot(gym, type, body);
      expect(res.statusCode, `${name}: ${res.body}`).toBe(201);
    }
  });

  it("a session already under a class staff confirmed is not asked about again by a change to that class, and is by every other class put over it", async () => {
    const gym = await makeGym(`Again ${uniq()}`);
    const sam = await trainer(gym, "Sam Reed");
    const maya = await listed(gym, "Maya Lopez");
    const leo = await listed(gym, "Leo Park");
    const type = await makeType(gym, "Spin");
    await booked(gym, sam, maya);
    const yes = asked(await addSlot(gym, type, { coachUserId: sam.userId }));
    expect((await addSlot(gym, type, { coachUserId: sam.userId }, yes.mark)).statusCode).toBe(201);
    const slotId = timetable(await inject("GET", `/v1/orgs/${gym.id}/classes`, gym.owner.cookies)).entries.find((e) => e.type.id === type)?.schedules[0]?.id;
    if (slotId === undefined) throw new Error("no time slot");

    // More places, the same hour: Maya's session is where it was, and nobody is asked.
    const places = await inject("PUT", `/v1/orgs/${gym.id}/class-repeats/${slotId}`, gym.owner.cookies, {
      ...slotBody({ coachUserId: sam.userId }),
      places: 20,
      updateFrom: TODAY,
    });
    expect(places.statusCode, places.body).toBe(200);

    // Made two hours long, it reaches Leo's 12:00 as well: only Leo's is new.
    await booked(gym, sam, leo, { minute: at(12) });
    const longer = asked(await editSlot(gym, slotId, { minutes: 120, coachUserId: sam.userId }));
    expect([longer.count, longer.shown.map((s) => s.name)]).toEqual([1, ["Leo Park"]]);

    // Another kind of class put on Sam over Maya's hour is a new thing to say yes to.
    const yoga = await makeType(gym, "Yoga");
    const second = asked(await addSlot(gym, yoga, { startMinute: at(10, 15), coachUserId: sam.userId }));
    expect([second.count, second.shown.map((s) => [s.name, s.className])]).toEqual([1, [["Maya Lopez", "Yoga"]]]);

    // And so is a SECOND Spin class over her hour: staff said yes to the 10:30 one only.
    const ana = await trainer(gym, "Ana Diaz");
    const named = (res: Reply) => {
      const ask = asked(res);
      return [ask.count, ask.shown.map((s) => [s.name, s.className])];
    };
    const maya1 = [1, [["Maya Lopez", "Spin"]]];
    // By a new time slot of the same class.
    expect(named(await addSlot(gym, type, { startMinute: at(10), coachUserId: sam.userId }))).toEqual(maya1);
    // By one class of Ana's given to Sam, this class only.
    await slot(gym, type, { startMinute: at(9, 45), coachUserId: ana.userId });
    const anas = (await sql<{ id: string }[]>`
      SELECT id FROM gym_class_sessions WHERE gym_id = ${gym.id} AND local_date = ${FRIDAY}::date AND local_start_minute = ${at(9, 45)}`)[0]?.id;
    if (anas === undefined) throw new Error("no 9:45 class");
    expect(named(await changeClass(gym, anas, "this", { startMinute: at(9, 45), coachUserId: sam.userId }))).toEqual(maya1);
    // By a bulk edit that gives Ana's time slot to Sam.
    const anaSlot = timetable(await inject("GET", `/v1/orgs/${gym.id}/classes`, gym.owner.cookies))
      .entries.find((e) => e.type.id === type)
      ?.schedules.find((x) => x.startMinute === at(9, 45))?.id;
    if (anaSlot === undefined) throw new Error("no 9:45 time slot");
    const bulk = await inject("POST", `/v1/orgs/${gym.id}/classes/${type}/bulk-edit`, gym.owner.cookies, {
      scheduleIds: [anaSlot],
      updateFrom: TODAY,
      set: { coachUserId: sam.userId },
    });
    expect(named(bulk)).toEqual(maya1);
  });

  it("the sessions of one gym are never named to another, to a stranger, or to staff who do not run the timetable", async () => {
    const gym = await makeGym(`Mine ${uniq()}`);
    const other = await makeGym(`Theirs ${uniq()}`);
    const sam = await trainer(gym, "Sam Reed");
    const maya = await listed(gym, "Maya Lopez");
    const type = await makeType(gym, "Spin");
    await booked(gym, sam, maya);
    const stood = await written(gym);

    // Sam also works at the other gym. A class on him there at that hour has no session of
    // THAT gym under it, so it is saved without a question and Maya is not named.
    await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${other.id}, ${sam.userId}, 'trainer')`;
    const theirs = await makeType(other, "Away Spin");
    const away = await addSlot(other, theirs, { coachUserId: sam.userId });
    expect(away.statusCode, away.body).toBe(201);
    expect(away.body).not.toContain("Maya");

    // The other gym's owner, a stranger and a trainer on the usual ticks, each sending
    // this gym's own change: refused before anything is read, and nothing named.
    const stranger = await signedIn("Nobody Here");
    const desk = await staff(gym, "Desk Only", ["members.confirm"]);
    for (const [who, status] of [
      [other.owner, 404],
      [stranger, 404],
      [desk, 403],
      [sam, 403],
    ] as const) {
      const res = await addSlot(gym, type, { coachUserId: sam.userId }, undefined, who);
      expect(res.statusCode, res.body).toBe(status);
      expect(res.body).not.toContain("Maya");
      expect(res.body).not.toContain("sessions");
    }
    const none = await inject("POST", `/v1/orgs/${gym.id}/classes/${type}/repeats`, {}, { ...slotBody({ coachUserId: sam.userId }), startsOn: TODAY });
    expect(none.statusCode).toBe(401);
    expect(await written(gym)).toBe(stood);
  });

  it("a confirm that is not a mark is refused before anything is read", async () => {
    const gym = await makeGym(`Bad ${uniq()}`);
    const type = await makeType(gym, "Spin");
    for (const confirm of [0, 1, "1", "A".repeat(64), "a".repeat(63), null]) {
      const res = await inject("POST", `/v1/orgs/${gym.id}/classes/${type}/repeats`, gym.owner.cookies, {
        ...slotBody({}),
        startsOn: TODAY,
        confirmTrainerSessions: confirm,
      });
      expect([res.statusCode, errorOf(res)], String(confirm)).toEqual([400, "validation_error"]);
    }
  });

  it(
    "a class saved with its confirm at the same instant as a new booking under it: never both without a question",
    async () => {
      const gym = await makeGym(`Race ${uniq()}`);
      const sam = await trainer(gym, "Sam Reed");
      const maya = await listed(gym, "Maya Lopez");
      const leo = await listed(gym, "Leo Park");
      // Each round has its own class, an hour apart from the last, and its own Friday.
      for (let round = 0; round < 6; round++) {
        const day = ["2026-10-09", "2026-10-16", "2026-10-23", "2026-10-30", "2026-11-06", "2026-11-13"][round] ?? FRIDAY;
        const type = await makeType(gym, `Race class ${String(round)}`);
        await sql`DELETE FROM gym_pt_appointments WHERE gym_id = ${gym.id}`;
        await sql`DELETE FROM gym_class_schedules WHERE gym_id = ${gym.id}`;
        await booked(gym, sam, maya, { day, minute: at(10) });
        // The class runs 10:30 to 12:30: over Maya's 10:00, and over the 11:00 Leo is booking now.
        const body: SlotBody = { minutes: 120, coachUserId: sam.userId };
        const { mark } = asked(await addSlot(gym, type, body));
        const [save, booking] = await Promise.all([
          addSlot(gym, type, body, mark, gym.owner, round % 2 === 0 ? api() : (second ?? api())),
          book(gym, sam, leo, { day, minute: at(11), target: round % 2 === 0 ? (second ?? api()) : api() }),
        ]);
        const saved = save.statusCode === 201;
        const leoIn = booking.statusCode === 200;
        // Either the class went first and Leo was told Sam is in a class, or Leo went first
        // and the class asked again about two sessions and wrote nothing.
        expect([saved, leoIn], `${save.body} ${booking.body}`).not.toEqual([true, true]);
        expect(saved || leoIn).toBe(true);
        if (saved) expect(errorOf(booking)).toBe("trainer_in_class");
        else expect(asked(save).count).toBe(2);
      }
    },
    T,
  );

  it("the same new time slot saved twice at once with its confirm: one is added", async () => {
    const gym = await makeGym(`Twice ${uniq()}`);
    const sam = await trainer(gym, "Sam Reed");
    const maya = await listed(gym, "Maya Lopez");
    const type = await makeType(gym, "Spin");
    await booked(gym, sam, maya);
    const { mark } = asked(await addSlot(gym, type, { coachUserId: sam.userId }));
    const both = await Promise.all([
      addSlot(gym, type, { coachUserId: sam.userId }, mark, gym.owner, api()),
      addSlot(gym, type, { coachUserId: sam.userId }, mark, gym.owner, second ?? api()),
    ]);
    expect(both.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(both.map((r) => (r.statusCode === 409 ? errorOf(r) : "saved")).sort()).toEqual(["repeat_clashes", "saved"]);
    const [slots] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_class_schedules WHERE gym_id = ${gym.id}`;
    expect(slots?.n).toBe(1);
  });
});
