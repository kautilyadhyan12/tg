// PERSONAL TRAINING'S OWN BOOKING RULES — the routes against real Postgres
// (DATABASE_URL-gated), on two api instances over one database. Spec Part 3 §13.5;
// ROADMAP 17e-vi.
//
// The worst thing this job could do to a real person: a member loses a session they paid
// for on a cancel the gym's own personal training rule says is free, or is told "free" and
// then charged, because the class number was read where the personal training one should
// be. That is the first test, with the two numbers set apart in both directions.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { PT_MEMBER_WORDS } from "@app/shared";
import type { ClassBookingSettings, ClassBookingView, MemberPtResponse, MemberPtSession, PtAppointment, PtBookingSettings, PtTrainersResponse, PtWeekResponse } from "@app/shared";
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
  JWT_SECRET: "pt-own-booking-rules-secret-01234567", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 180_000;
const LIVE_PLAN = "zz_ptr_live";
/** Wednesday 7 October 2026, 07:30 in London (summer time, one hour ahead of UTC). */
const NOW = new Date("2026-10-07T06:30:00Z");
/** A Friday two days on: far outside the two-hour free-cancel time. */
const FRIDAY = "2026-10-09";

let ipCounter = 0;
const nextIp = () => `10.83.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
const redisUrl = process.env["TEST_REDIS_URL"];
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("personal training's own booking rules (real Postgres, two api instances)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let clock = NOW.getTime();
  let app: App | undefined;
  let second: App | undefined;
  let redis: RedisLike | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const other = (): App => second ?? api();

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'ptr-t-%@example.com')`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_pt_appointments WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_trainer_time_off WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_trainers WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_bookings WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'ptr-t-%@example.com'`;
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
    const email = `ptr-t-${uniq()}@example.com`;
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
  const staff = async (gym: Gym, name: string): Promise<Person> => {
    const person = await signedIn(name);
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${person.userId}, 'trainer', ${null})`;
    return person;
  };
  /** Somebody using the app at this gym, with no record on its list. */
  const appOnly = async (gym: Gym, name: string): Promise<Person> => {
    const person = await signedIn(name);
    await sql`INSERT INTO gym_members (gym_id, user_id, joined_at) VALUES (${gym.id}, ${person.userId}, '2026-01-01T00:00:00Z')`;
    return person;
  };
  type Member = Person & { entryId: string };
  /** A member of the app whose record is on the gym's list: what a session hangs on. */
  const member = async (gym: Gym, name: string): Promise<Member> => {
    const person = await appOnly(gym, name);
    const res = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName: name, email: `ptr-l-${uniq()}@example.com` });
    expect(res.statusCode, res.body).toBe(201);
    const entryId = (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
    await sql`UPDATE gym_members SET entry_id = ${entryId} WHERE gym_id = ${gym.id} AND user_id = ${person.userId}`;
    return { ...person, entryId };
  };

  const typeOf = async (gym: Gym, over: { kind?: "recurring" | "pack"; includesPt?: boolean; name?: string } = {}): Promise<string> => {
    const pack = over.kind === "pack";
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_membership_types
        (gym_id, name, kind, price_minor, currency, term_count, term_unit, pack_classes, pack_days, access, covers_all_classes, includes_pt)
      VALUES (${gym.id}, ${over.name ?? `Type ${uniq()}`}, ${over.kind ?? "recurring"}, 4000, 'GBP', ${pack ? null : 1}, ${pack ? null : "month"},
              ${pack ? 10 : null}, ${pack ? 60 : null}, 'all_classes', true, ${over.includesPt ?? false})
      RETURNING id`;
    if (row === undefined) throw new Error("no type");
    return row.id;
  };
  const hold = async (gym: Gym, entryId: string, typeId: string, over: { pack?: number } = {}): Promise<string> => {
    const pack = over.pack !== undefined;
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_held_memberships
        (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit, pack_classes, pack_days,
         classes_left, starts_on, status, renews)
      VALUES (${gym.id}, ${entryId}, ${typeId}, gen_random_uuid(), ${pack ? "pack" : "recurring"}, 4000, 'GBP', ${pack ? null : 1}, ${pack ? null : "month"},
              ${pack ? 10 : null}, ${pack ? 60 : null}, ${over.pack ?? null}, '2026-10-01'::date, 'active', ${!pack})
      RETURNING id`;
    if (row === undefined) throw new Error("no membership");
    return row.id;
  };
  const left = async (heldId: string): Promise<number | null> => {
    const [row] = await sql<{ classes_left: number | null }[]>`SELECT classes_left FROM gym_held_memberships WHERE id = ${heldId}`;
    if (row === undefined) throw new Error("no membership");
    return row.classes_left;
  };

  /** 06:00 to 22:00 every day, in sessions of an hour. */
  const ALL_DAY = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, fromMinute: 360, toMinute: 1320 }));
  const trainerWith = async (gym: Gym, name: string, hours: object[] = ALL_DAY): Promise<Person> => {
    const person = await staff(gym, name);
    const res = await inject("PUT", `/v1/orgs/${gym.id}/pt/trainers/${person.userId}`, gym.owner.cookies, { offers: true, sessionMinutes: 60, hours });
    expect(res.statusCode, res.body).toBe(200);
    return person;
  };

  // ── The member's three routes ──
  const read = async (gym: Gym, who: Person, week = 0): Promise<MemberPtResponse> => {
    const res = await inject("GET", `/v1/orgs/${gym.id}/member-pt?week=${String(week)}`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as MemberPtResponse;
  };
  interface BookOpts {
    key?: string;
    day?: string;
    minute?: number;
    minutes?: number;
    ip?: string;
    target?: App;
    extra?: Record<string, unknown>;
  }
  const book = (gym: Gym, who: Person, trainer: Person, opts: BookOpts = {}) =>
    inject(
      "POST",
      `/v1/orgs/${gym.id}/member-pt/sessions`,
      who.cookies,
      { requestKey: opts.key ?? randomUUID(), trainerId: trainer.userId, localDate: opts.day ?? FRIDAY, startMinute: opts.minute ?? 600, minutes: opts.minutes ?? 60, ...opts.extra },
      opts.ip ?? nextIp(),
      opts.target ?? api(),
    );
  const cancel = (gym: Gym, who: Person, id: string, lateOk = false, target = api()) =>
    inject("POST", `/v1/orgs/${gym.id}/member-pt/sessions/${id}/cancel`, who.cookies, { lateOk }, nextIp(), target);
  const made = (res: { statusCode: number; body: string }): MemberPtSession => {
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { session: MemberPtSession }).session;
  };
  const errorOf = (res: { body: string }): string => (JSON.parse(res.body) as { error: string }).error;

  // ── Staff, to set the scene ──
  const staffBook = async (gym: Gym, trainer: Person, entryId: string, minute: number, day = FRIDAY): Promise<string> => {
    const res = await inject("POST", `/v1/orgs/${gym.id}/pt/appointments`, gym.owner.cookies, {
      requestKey: randomUUID(),
      trainerId: trainer.userId,
      entryId,
      localDate: day,
      startMinute: minute,
      minutes: 60,
    });
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { appointment: { id: string } }).appointment.id;
  };
  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    redis = redisUrl === undefined || redisUrl === "" ? createMemoryRedis() : createIoRedis(redisUrl);
    for (let tries = 0; (await redis.incrWithTtl(`ptr-ready:${randomUUID()}`, 30)) === null; tries++) {
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
    await cleanup();
    await app?.close();
    await second?.close();
    await redis?.close();
    await sql.end({ timeout: 5 });
  }, T);

  // ── This file's own helpers ──
  const HOUR = 60 * 60_000;
  const MINUTE = 60_000;
  const CLASS_START: ClassBookingSettings = { opensDays: 7, freeCancelMinutes: 120, handoverMinutes: 1440, waitlistMax: 20 };
  const PT_START: PtBookingSettings = { opensDays: 7, freeCancelMinutes: 120 };
  const settingsUrl = (gym: Gym) => `/v1/orgs/${gym.id}/booking-settings`;
  interface Rules {
    settings: ClassBookingSettings;
    pt: PtBookingSettings;
  }
  const rulesOf = async (gym: Gym, who: Person = gym.owner): Promise<Rules> => {
    const res = await inject("GET", settingsUrl(gym), who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as Rules;
  };
  /** The owner saves the gym's rules through the real route: classes' and personal training's. */
  const setRules = async (gym: Gym, classes: Partial<ClassBookingSettings>, pt: Partial<PtBookingSettings>, target = api()): Promise<void> => {
    const res = await inject("PUT", settingsUrl(gym), gym.owner.cookies, { ...CLASS_START, ...classes, pt: { ...PT_START, ...pt } }, nextIp(), target);
    expect(res.statusCode, res.body).toBe(200);
  };
  /** What the database holds, read past every route. */
  const stored = async (gym: Gym) => {
    const [row] = await sql<{ co: number; cf: number; po: number; pf: number }[]>`
      SELECT booking_opens_days AS co, booking_free_cancel_minutes AS cf, pt_opens_days AS po, pt_free_cancel_minutes AS pf FROM gyms WHERE id = ${gym.id}`;
    if (row === undefined) throw new Error("no gym");
    return { classes: [row.co, row.cf], pt: [row.po, row.pf] };
  };
  const statusOf = async (id: string): Promise<string> => {
    const [row] = await sql<{ status: string }[]>`SELECT status FROM gym_pt_appointments WHERE id = ${id}`;
    if (row === undefined) throw new Error("no such session");
    return row.status;
  };
  const startOf = async (id: string): Promise<number> => {
    const [row] = await sql<{ starts_at: Date }[]>`SELECT starts_at FROM gym_pt_appointments WHERE id = ${id}`;
    if (row === undefined) throw new Error("no such session");
    return row.starts_at.getTime();
  };
  const mine = async (gym: Gym, who: Person, id: string): Promise<MemberPtSession> => {
    const found = (await read(gym, who)).sessions.find((s) => s.id === id);
    if (found === undefined) throw new Error("the member does not read that session");
    return found;
  };
  const staffCancel = (gym: Gym, who: Person, id: string, body: { lateOk: boolean; giveBack: boolean }, target = api()) =>
    inject("POST", `/v1/orgs/${gym.id}/pt/appointments/${id}/cancel`, who.cookies, body, nextIp(), target);
  /** One session as staff read it on the trainer's week. */
  const staffSees = async (gym: Gym, who: Person, trainer: Person, day: string, id: string): Promise<PtAppointment> => {
    const res = await inject("GET", `/v1/orgs/${gym.id}/pt/week?trainer=${trainer.userId}&from=${day}`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    const found = (JSON.parse(res.body) as PtWeekResponse).days.flatMap((x) => x.appointments).find((a) => a.id === id);
    if (found === undefined) throw new Error("staff do not read that session");
    return found;
  };
  const trainersPage = async (gym: Gym, who: Person): Promise<PtTrainersResponse> => {
    const res = await inject("GET", `/v1/orgs/${gym.id}/pt/trainers`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as PtTrainersResponse;
  };

  /** A class with no coach that starts at the instant `startsAt`. */
  const classAt = async (gym: Gym, startsAt: number): Promise<string> => {
    const [type] = await sql<{ id: string }[]>`
      INSERT INTO gym_class_types (gym_id, name, minutes, places, colour, open_gym)
      VALUES (${gym.id}, ${`Spin ${uniq()}`}, 45, 10, 'blue', false)
      RETURNING id`;
    if (type === undefined) throw new Error("no class type");
    const at = new Date(startsAt);
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_class_sessions (gym_id, class_type_id, local_date, local_start_minute, starts_at, minutes, places, status)
      SELECT ${gym.id}, ${type.id}, l::date, (EXTRACT(HOUR FROM l) * 60 + EXTRACT(MINUTE FROM l))::int, ${at}, 45, 10, 'scheduled'
      FROM (SELECT ${at}::timestamptz AT TIME ZONE 'Europe/London' AS l) x
      RETURNING id`;
    if (row === undefined) throw new Error("no class");
    return row.id;
  };
  const classUrl = (gym: Gym, sessionId: string) => `/v1/orgs/${gym.id}/class-sessions/${sessionId}/booking`;
  const classView = (res: { statusCode: number; body: string }): ClassBookingView => {
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { booking: ClassBookingView }).booking;
  };
  const classSeen = async (gym: Gym, who: Person, sessionId: string): Promise<ClassBookingView> => classView(await inject("GET", classUrl(gym, sessionId), who.cookies));
  const classBook = (gym: Gym, who: Person, sessionId: string) => inject("POST", classUrl(gym, sessionId), who.cookies, { requestKey: randomUUID(), joinWaitlist: false });
  const classCancel = (gym: Gym, who: Person, sessionId: string, lateOk: boolean) => inject("POST", `${classUrl(gym, sessionId)}/cancel`, who.cookies, { lateOk });

  beforeEach(() => {
    clock = NOW.getTime();
  });

  it(
    "THE WORST THING: a session is free to cancel by the gym's PERSONAL TRAINING time and never by its class time, for a member and for staff, and a pack is charged only when that time has passed",
    async () => {
      // ── Classes strict (a day), personal training easy (an hour) ──
      const easy = await makeGym("Easy Sessions");
      await setRules(easy, { freeCancelMinutes: 1440 }, { freeCancelMinutes: 60 });
      const pack = await typeOf(easy, { kind: "pack", includesPt: true, name: "PT 10" });
      const sam = await trainerWith(easy, "Sam Easy");
      const maya = await member(easy, "Maya Easy");
      const mayaPack = await hold(easy, maya.entryId, pack, { pack: 10 });
      const hers = made(await book(easy, maya, sam, { minute: 600 }));
      const staffs = await staffBook(easy, sam, maya.entryId, 660);
      expect(await left(mayaPack)).toBe(8);
      const start = Date.parse(hers.startsAt);
      // A class at the same instant, which she books: the class number is still its rule.
      const spin = await classAt(easy, start);
      expect(classView(await classBook(easy, maya, spin)).mine?.status).toBe("booked");
      const afterClass = await left(mayaPack);

      // Three hours before: inside the classes' day, outside personal training's hour.
      clock = start - 3 * HOUR;
      const view = await read(easy, maya);
      expect(view.freeCancelMinutes).toBe(60);
      const seen = await mine(easy, maya, hers.id);
      expect([seen.cancel, seen.freeCancelUntil]).toEqual(["free", new Date(start - 60 * MINUTE).toISOString()]);
      // Staff read the same: the owner, and the trainer who runs no timetable.
      expect((await staffSees(easy, easy.owner, sam, FRIDAY, hers.id)).cancel).toBe("free");
      expect((await staffSees(easy, sam, sam, FRIDAY, staffs)).cancel).toBe("free");
      expect([(await trainersPage(easy, easy.owner)).freeCancelMinutes, (await trainersPage(easy, sam)).freeCancelMinutes]).toEqual([60, 60]);
      // Her class at that instant is a late cancel, by the class number.
      const lesson = await classSeen(easy, maya, spin);
      expect([lesson.can.cancel, lesson.freeCancelUntil]).toEqual(["late", new Date(start - 1440 * MINUTE).toISOString()]);
      const lateClass = await classCancel(easy, maya, spin, false);
      expect([lateClass.statusCode, errorOf(lateClass)]).toEqual([409, "late_cancel"]);
      expect(await left(mayaPack)).toBe(afterClass);

      // She cancels her session WITHOUT saying yes to a late cancel: it is free, and the
      // pack has its session back.
      const gone = made(await cancel(easy, maya, hers.id, false));
      expect([gone.status, await statusOf(hers.id), await left(mayaPack)]).toEqual(["cancelled", "cancelled", (afterClass ?? 0) + 1]);
      // Staff cancel the other one, neither late nor given back: free too.
      const called = await staffCancel(easy, easy.owner, staffs, { lateOk: false, giveBack: false });
      expect(called.statusCode, called.body).toBe(200);
      expect([await statusOf(staffs), await left(mayaPack)]).toEqual(["cancelled", (afterClass ?? 0) + 2]);

      // ── The other way round: classes easy (until the start), personal training strict (a day) ──
      clock = NOW.getTime();
      const strict = await makeGym("Strict Sessions");
      await setRules(strict, { freeCancelMinutes: 0 }, { freeCancelMinutes: 1440 });
      const pack2 = await typeOf(strict, { kind: "pack", includesPt: true, name: "PT 10" });
      const ana = await trainerWith(strict, "Ana Strict");
      const noor = await member(strict, "Noor Strict");
      const noorPack = await hold(strict, noor.entryId, pack2, { pack: 10 });
      const noors = made(await book(strict, noor, ana, { minute: 600 }));
      const staffs2 = await staffBook(strict, ana, noor.entryId, 660);
      const spin2 = await classAt(strict, start);
      expect(classView(await classBook(strict, noor, spin2)).mine?.status).toBe("booked");
      const noorAfter = await left(noorPack);

      clock = start - 3 * HOUR;
      expect((await read(strict, noor)).freeCancelMinutes).toBe(1440);
      const late = await mine(strict, noor, noors.id);
      // She is never told "free" and then charged.
      expect([late.cancel, late.freeCancelUntil]).toEqual(["late", new Date(start - 1440 * MINUTE).toISOString()]);
      expect((await staffSees(strict, strict.owner, ana, FRIDAY, noors.id)).cancel).toBe("late");
      expect((await trainersPage(strict, ana)).freeCancelMinutes).toBe(1440);
      const refused = await cancel(strict, noor, noors.id, false);
      expect([refused.statusCode, errorOf(refused)]).toEqual([409, "late_cancel"]);
      expect([await statusOf(noors.id), await left(noorPack)]).toEqual(["booked", noorAfter]);
      const staffRefused = await staffCancel(strict, strict.owner, staffs2, { lateOk: false, giveBack: false });
      expect([staffRefused.statusCode, errorOf(staffRefused)]).toEqual([409, "late_cancel"]);
      expect(await statusOf(staffs2)).toBe("booked");
      // Having said yes, it is a late cancel and the session stays used.
      expect(made(await cancel(strict, noor, noors.id, true)).status).toBe("late_cancelled");
      expect(await left(noorPack)).toBe(noorAfter);
      // Her class at that instant is free to cancel, by the class number.
      expect((await classSeen(strict, noor, spin2)).can.cancel).toBe("free");
      expect(classView(await classCancel(strict, noor, spin2, false)).mine?.status).toBe("cancelled");

      // Neither gym's rule reached the other.
      expect([await stored(easy), await stored(strict)]).toEqual([
        { classes: [7, 1440], pt: [7, 60] },
        { classes: [7, 0], pt: [7, 1440] },
      ]);
    },
    T,
  );

  it(
    "the edge of the free-cancel time, to the minute: on it is free, a minute inside is late, at the start is over; from none to the longest the app allows",
    async () => {
      const gym = await makeGym("Edges");
      const pack = await typeOf(gym, { kind: "pack", includesPt: true, name: "PT 20" });
      const sam = await trainerWith(gym, "Sam Edges");
      const maya = await member(gym, "Maya Edges");
      const held = await hold(gym, maya.entryId, pack, { pack: 10 });
      // Friday the 16th, nine days on, so that seven days before it has not come.
      const DAY = "2026-10-16";
      // [the gym's free-cancel time in minutes, how many minutes before the start, what a cancel is]
      const cases: [number, number, "free" | "late" | "started"][] = [
        [120, 121, "free"],
        [120, 120, "free"],
        [120, 119, "late"],
        [60, 59, "late"],
        [45, 45, "free"],
        [45, 44, "late"],
        [1, 1, "free"],
        [0, 1, "free"],
        [0, 0, "started"],
        [120, 0, "started"],
        [10080, 10081, "free"],
        [10080, 10080, "free"],
        [10080, 10079, "late"],
      ];
      for (const [index, [freeMinutes, before, expected]] of cases.entries()) {
        const label = `${String(freeMinutes)} minutes, ${String(before)} before`;
        clock = NOW.getTime();
        // The class number always says the opposite, wherever the limits let it.
        await setRules(gym, { freeCancelMinutes: expected === "free" ? 10080 : 0 }, { freeCancelMinutes: freeMinutes });
        const id = await staffBook(gym, sam, maya.entryId, 360 + index * 60, DAY);
        const had = await left(held);
        clock = (await startOf(id)) - before * MINUTE;
        if (expected === "started") {
          const res = await cancel(gym, maya, id, true);
          expect([res.statusCode, errorOf(res)], label).toEqual([409, "started"]);
          expect([await statusOf(id), await left(held)], label).toEqual(["booked", had]);
          continue;
        }
        expect((await mine(gym, maya, id)).cancel, label).toBe(expected);
        expect((await staffSees(gym, gym.owner, sam, DAY, id)).cancel, label).toBe(expected);
        const res = await cancel(gym, maya, id, false);
        if (expected === "free") {
          expect(res.statusCode, `${label}: ${res.body}`).toBe(200);
          expect([await statusOf(id), await left(held)], label).toEqual(["cancelled", (had ?? 0) + 1]);
        } else {
          expect([res.statusCode, errorOf(res)], label).toEqual([409, "late_cancel"]);
          expect([await statusOf(id), await left(held)], label).toEqual(["booked", had]);
        }
      }
    },
    T,
  );

  it(
    "how far ahead a member books a session is personal training's own number of days; a class opens by the class number; staff are held to neither",
    async () => {
      const gym = await makeGym("Opens");
      // 07:00 and 08:00 every day. Now is 07:30 on Wednesday the 7th.
      const sam = await trainerWith(gym, "Sam Opens", [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, fromMinute: 420, toMinute: 540 })));
      const maya = await member(gym, "Maya Opens");
      const MONDAY = "2026-10-12";
      const mondayClass = await classAt(gym, Date.parse("2026-10-12T09:00:00Z"));

      // Classes open 14 days ahead, sessions 3.
      await setRules(gym, { opensDays: 14 }, { opensDays: 3 });
      expect((await read(gym, maya)).lastDay).toBe("2026-10-10");
      const tooSoon = await book(gym, maya, sam, { day: MONDAY, minute: 420 });
      expect([tooSoon.statusCode, errorOf(tooSoon)]).toEqual([409, "not_open_yet"]);
      expect((await classSeen(gym, maya, mondayClass)).can.book).toBe(true);
      // Three days on to the minute: 07:00 is open (07:30 has not come round), 08:00 is not.
      made(await book(gym, maya, sam, { day: "2026-10-10", minute: 420 }));
      expect(errorOf(await book(gym, maya, sam, { day: "2026-10-10", minute: 480 }))).toBe("not_open_yet");
      // Staff book her for a day she cannot reach.
      await staffBook(gym, sam, maya.entryId, 480, "2026-11-20");

      // The other way round: classes open 1 day ahead, sessions 14.
      await setRules(gym, { opensDays: 1 }, { opensDays: 14 });
      expect((await read(gym, maya)).lastDay).toBe("2026-10-21");
      made(await book(gym, maya, sam, { day: MONDAY, minute: 420 }));
      const lesson = await classSeen(gym, maya, mondayClass);
      expect([lesson.can.book, lesson.can.why]).toEqual([false, "not_open_yet"]);
    },
    T,
  );

  it(
    "the settings: a new gym's two start at 7 days and 2 hours; the owner changes them alone or with the classes' four, each inside its limits, and what changed is written down",
    async () => {
      const gym = await makeGym("Settings");
      expect(await rulesOf(gym)).toEqual({ settings: CLASS_START, pt: PT_START });

      // Every value outside its limits, a missing part and an extra one are refused whole.
      const whole = { ...CLASS_START, pt: PT_START };
      const bad: unknown[] = [
        CLASS_START,
        { ...CLASS_START, pt: null },
        { ...CLASS_START, pt: {} },
        { ...CLASS_START, pt: { opensDays: 7 } },
        { ...CLASS_START, pt: { freeCancelMinutes: 120 } },
        { ...CLASS_START, pt: { ...PT_START, opensDays: 0 } },
        { ...CLASS_START, pt: { ...PT_START, opensDays: 57 } },
        { ...CLASS_START, pt: { ...PT_START, opensDays: 1.5 } },
        { ...CLASS_START, pt: { ...PT_START, opensDays: "7" } },
        { ...CLASS_START, pt: { ...PT_START, freeCancelMinutes: -1 } },
        { ...CLASS_START, pt: { ...PT_START, freeCancelMinutes: 10081 } },
        { ...CLASS_START, pt: { ...PT_START, handoverMinutes: 60 } },
        { ...CLASS_START, pt: { ...PT_START, gymId: gym.id } },
        { ...whole, ptOpensDays: 3 },
        { pt: PT_START },
      ];
      for (const body of bad) {
        const res = await inject("PUT", settingsUrl(gym), gym.owner.cookies, body);
        expect([res.statusCode, errorOf(res)], JSON.stringify(body)).toEqual([400, "validation_error"]);
      }
      expect(await stored(gym)).toEqual({ classes: [7, 120], pt: [7, 120] });

      // Personal training's two alone: the classes' four are as they were.
      const res = await inject("PUT", settingsUrl(gym), gym.owner.cookies, { ...CLASS_START, pt: { opensDays: 3, freeCancelMinutes: 0 } });
      expect(res.statusCode, res.body).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ settings: CLASS_START, pt: { opensDays: 3, freeCancelMinutes: 0 }, movedIn: 0 });
      expect(await rulesOf(gym)).toEqual({ settings: CLASS_START, pt: { opensDays: 3, freeCancelMinutes: 0 } });
      expect(await stored(gym)).toEqual({ classes: [7, 120], pt: [3, 0] });
      // The classes' alone: personal training's are as they were.
      await setRules(gym, { opensDays: 14, freeCancelMinutes: 60 }, { opensDays: 3, freeCancelMinutes: 0 });
      expect(await stored(gym)).toEqual({ classes: [14, 60], pt: [3, 0] });
      // The same again writes nothing more; the longest each allows is kept.
      await setRules(gym, { opensDays: 14, freeCancelMinutes: 60 }, { opensDays: 3, freeCancelMinutes: 0 });
      await setRules(gym, { opensDays: 14, freeCancelMinutes: 60 }, { opensDays: 56, freeCancelMinutes: 10080 });
      expect(await stored(gym)).toEqual({ classes: [14, 60], pt: [56, 10080] });
      const audit = await sql<{ meta: Record<string, string> }[]>`
        SELECT meta FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.booking_settings_changed' ORDER BY at, id`;
      expect(audit.map((a) => a.meta)).toEqual([
        { "pt.opensDays": "7 -> 3", "pt.freeCancelMinutes": "120 -> 0" },
        { opensDays: "7 -> 14", freeCancelMinutes: "120 -> 60" },
        { "pt.opensDays": "3 -> 56", "pt.freeCancelMinutes": "0 -> 10080" },
      ]);
      // The database refuses what the route would, whoever writes it.
      for (const [column, value] of [["pt_opens_days", 0], ["pt_opens_days", 57], ["pt_free_cancel_minutes", -1], ["pt_free_cancel_minutes", 10081]] as const) {
        const out = await sql`UPDATE gyms SET ${sql({ [column]: value })} WHERE id = ${gym.id}`.then(
          () => "accepted",
          (err: unknown) => (err instanceof postgres.PostgresError ? (err.constraint_name ?? "") : String(err)),
        );
        expect(out, `${column} ${String(value)}`).toBe("gyms_pt_booking_settings_check");
      }
    },
    T,
  );

  it(
    "nobody outside the gym, no member and no staff without the timetable's tick reads or changes personal training's rules; another gym's owner changes only their own",
    async () => {
      const gym = await makeGym("Locked Rules");
      const other = await makeGym("Other Rules");
      const stranger = await signedIn("Stranger");
      const insider = await member(gym, "Insider");
      const trainer = await trainerWith(gym, "Trainer No Tick");
      const body = { ...CLASS_START, pt: { opensDays: 1, freeCancelMinutes: 0 } };

      for (const method of ["GET", "PUT"] as const) {
        expect((await inject(method, settingsUrl(gym), {}, method === "PUT" ? body : undefined)).statusCode, method).toBe(401);
      }
      for (const [who, status] of [[stranger, 404], [other.owner, 404], [insider, 404], [trainer, 403]] as const) {
        const got = await inject("GET", settingsUrl(gym), who.cookies);
        expect(got.statusCode, who.name).toBe(status);
        expect(got.body.includes("opensDays"), who.name).toBe(false);
        expect((await inject("PUT", settingsUrl(gym), who.cookies, body)).statusCode, who.name).toBe(status);
      }
      expect(await stored(gym)).toEqual({ classes: [7, 120], pt: [7, 120] });
      // The other gym's owner saves the same body at home: this gym's numbers do not move.
      expect((await inject("PUT", settingsUrl(other), other.owner.cookies, body)).statusCode).toBe(200);
      expect([await stored(gym), await stored(other)]).toEqual([
        { classes: [7, 120], pt: [7, 120] },
        { classes: [7, 120], pt: [1, 0] },
      ]);
    },
    T,
  );

  it(
    "a changed rule holds for a session already booked; and of a save and a cancel that wait for the gym together, the one that was first is the one the other sees",
    async () => {
      const gym = await makeGym("Change And Cancel");
      const pack = await typeOf(gym, { kind: "pack", includesPt: true, name: "PT 20" });
      const sam = await trainerWith(gym, "Sam Order");
      const maya = await member(gym, "Maya Order");
      const held = await hold(gym, maya.entryId, pack, { pack: 10 });

      // Booked under two hours; the gym then makes it a day, and the same session is late.
      const first = made(await book(gym, maya, sam, { minute: 600 }));
      const start = Date.parse(first.startsAt);
      clock = start - 3 * HOUR;
      expect((await mine(gym, maya, first.id)).cancel).toBe("free");
      await setRules(gym, {}, { freeCancelMinutes: 1440 });
      expect((await mine(gym, maya, first.id)).cancel).toBe("late");
      await setRules(gym, {}, { freeCancelMinutes: 60 });
      expect((await mine(gym, maya, first.id)).cancel).toBe("free");

      // The order is made certain, not raced: the test holds the gym's row, sends one
      // request and waits until the database says it is waiting, sends the other and
      // waits again, then lets go. Whichever was first is first. A save or a cancel that
      // did not take the gym's lock would not wait, and the wait below would never end.
      const lockWaits = async (): Promise<number> => {
        const [row] = await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`;
        return row?.n ?? 0;
      };
      const waitsReach = async (n: number): Promise<void> => {
        for (let tries = 0; (await lockWaits()) < n; tries++) {
          if (tries === 200) throw new Error(`only ${String(await lockWaits())} of ${String(n)} requests are waiting for the gym's lock`);
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      };
      const inOrder = async (firstIs: "save" | "cancel", minute: number) => {
        clock = NOW.getTime();
        await setRules(gym, {}, { freeCancelMinutes: 60 });
        const id = await staffBook(gym, sam, maya.entryId, minute);
        const had = await left(held);
        clock = (await startOf(id)) - 3 * HOUR;
        const base = await lockWaits();
        let letGo: () => void = () => undefined;
        let taken: () => void = () => undefined;
        const isTaken = new Promise<void>((resolve) => (taken = resolve));
        const holding = sql.begin(async (tx) => {
          await tx`SELECT 1 FROM gyms WHERE id = ${gym.id} FOR UPDATE`;
          taken();
          await new Promise<void>((resolve) => (letGo = resolve));
        });
        await isTaken;
        const save = () => setRules(gym, {}, { freeCancelMinutes: 1440 }, other());
        const cut = () => cancel(gym, maya, id, false, api());
        let res: Awaited<ReturnType<typeof cut>>;
        try {
          if (firstIs === "save") {
            const saving = save();
            await waitsReach(base + 1);
            const cutting = cut();
            await waitsReach(base + 2);
            letGo();
            [, res] = await Promise.all([saving, cutting]);
          } else {
            const cutting = cut();
            await waitsReach(base + 1);
            const saving = save();
            await waitsReach(base + 2);
            letGo();
            [res] = await Promise.all([cutting, saving]);
          }
        } finally {
          letGo();
          await holding;
        }
        return { res, status: await statusOf(id), now: await left(held), had };
      };

      // The save was first: the cancel is decided by the new day, so it is late and refused.
      const saveFirst = await inOrder("save", 660);
      expect([saveFirst.res.statusCode, errorOf(saveFirst.res), saveFirst.status, saveFirst.now]).toEqual([409, "late_cancel", "booked", saveFirst.had]);
      // The cancel was first: it is decided by the hour, so it is free and the pack has it back.
      const cancelFirst = await inOrder("cancel", 720);
      expect([cancelFirst.res.statusCode, cancelFirst.status, cancelFirst.now]).toEqual([200, "cancelled", (cancelFirst.had ?? 0) + 1]);
      expect((await stored(gym)).pt).toEqual([7, 1440]);
    },
    T,
  );

  it(
    "the last open day: a time opens that many days before it starts, so its later times are said to open later and the first one opens as the clock reaches it",
    async () => {
      const gym = await makeGym("Last Open Day");
      // 09:00 to 17:00 every day, an hour each. Now is 07:30 on Wednesday the 7th.
      const sam = await trainerWith(gym, "Sam Later", [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, fromMinute: 540, toMinute: 1020 })));
      const maya = await member(gym, "Maya Later");
      await setRules(gym, { opensDays: 14 }, { opensDays: 1 });
      const dayOf = (view: MemberPtResponse, day: string) => {
        const found = view.trainers.find((t) => t.trainerId === sam.userId)?.days.find((x) => x.localDate === day);
        if (found === undefined) throw new Error(`no ${day}`);
        return found;
      };
      const early = await read(gym, maya);
      expect([early.opensDays, early.lastDay]).toEqual([1, "2026-10-08"]);
      // Today is wholly open; tomorrow's eight times are all still to open; Friday is past the last day.
      expect(dayOf(early, "2026-10-07")).toEqual({ localDate: "2026-10-07", free: [540, 600, 660, 720, 780, 840, 900, 960], opensLater: false });
      expect(dayOf(early, "2026-10-08")).toEqual({ localDate: "2026-10-08", free: [], opensLater: true });
      expect(dayOf(early, "2026-10-09")).toEqual({ localDate: "2026-10-09", free: [], opensLater: false });
      const tooSoon = await book(gym, maya, sam, { day: "2026-10-08", minute: 540 });
      expect([tooSoon.statusCode, errorOf(tooSoon), (JSON.parse(tooSoon.body) as { message: string }).message]).toEqual([409, "not_open_yet", PT_MEMBER_WORDS.not_open_yet]);
      expect(PT_MEMBER_WORDS.not_open_yet).toBe("Booking for that time isn't open yet.");
      // At 09:00 tomorrow's 09:00 opens, and the rest are still to come.
      clock = NOW.getTime() + 90 * MINUTE;
      const later = await read(gym, maya);
      expect(dayOf(later, "2026-10-08")).toEqual({ localDate: "2026-10-08", free: [540], opensLater: true });
      made(await book(gym, maya, sam, { day: "2026-10-08", minute: 540 }));
      // A day whose only time she holds has nothing later to say.
      await setRules(gym, { opensDays: 14 }, { opensDays: 7 });
      expect(dayOf(await read(gym, maya), "2026-10-08").opensLater).toBe(false);
      // Staff read the free-cancel time on the week itself, the one its sessions were decided by.
      await setRules(gym, {}, { freeCancelMinutes: 45 });
      const week = await inject("GET", `/v1/orgs/${gym.id}/pt/week?trainer=${sam.userId}`, gym.owner.cookies);
      expect((JSON.parse(week.body) as PtWeekResponse).freeCancelMinutes).toBe(45);
    },
    T,
  );

  it(
    "migration 0085 starts every gym's two at ITS class numbers, on a copy of the table with numbers that are not the starting ones",
    async () => {
      const file = readFileSync(new URL("../drizzle/0085_pt_booking_rules.sql", import.meta.url), "utf8");
      const statements = file
        .split("--> statement-breakpoint")
        .map((chunk) => chunk.split(/\r?\n/).filter((line) => !line.trimStart().startsWith("--")).join("\n").trim())
        .filter((chunk) => chunk !== "");
      expect(statements).toHaveLength(4);
      const rows: [string, number, number][] = [
        ["least", 1, 0],
        ["most", 56, 10080],
        ["own", 14, 45],
        ["other", 3, 1440],
        ["start", 7, 120],
      ];
      // A temporary table named `gyms` is found before the real one, so the file's own
      // statements run on the copy; the real table is never altered, and it is all undone.
      const undone = new Error("undo");
      const seen: unknown[] = [];
      await sql
        .begin(async (tx) => {
          await tx`CREATE TEMP TABLE gyms (LIKE public.gyms INCLUDING DEFAULTS) ON COMMIT DROP`;
          await tx`ALTER TABLE gyms DROP COLUMN pt_opens_days, DROP COLUMN pt_free_cancel_minutes`;
          for (const [name, opens, free] of rows) {
            await tx`
              INSERT INTO gyms (slug, name, timezone, owner_user_id, booking_opens_days, booking_free_cancel_minutes)
              VALUES (${`zz-0085-${name}`}, ${name}, 'Europe/London', gen_random_uuid(), ${opens}, ${free})`;
          }
          for (const statement of statements) await tx.unsafe(statement);
          seen.push(...(await tx`SELECT name, pt_opens_days AS opens, pt_free_cancel_minutes AS free FROM gyms ORDER BY booking_opens_days`));
          // A gym made after it starts at 7 days and 2 hours, and the CHECK is on the copy.
          const [made] = await tx<{ opens: number; free: number }[]>`
            INSERT INTO gyms (slug, name, timezone, owner_user_id) VALUES ('zz-0085-new', 'new', 'Europe/London', gen_random_uuid())
            RETURNING pt_opens_days AS opens, pt_free_cancel_minutes AS free`;
          seen.push(made);
          const refused = await tx
            .savepoint((sp) => sp`UPDATE gyms SET pt_opens_days = 0`)
            .then(() => "accepted", (err: unknown) => (err instanceof postgres.PostgresError ? (err.constraint_name ?? "") : String(err)));
          seen.push(refused);
          throw undone;
        })
        .catch((err: unknown) => {
          if (err !== undone) throw err;
        });
      expect(seen).toEqual([
        { name: "least", opens: 1, free: 0 },
        { name: "other", opens: 3, free: 1440 },
        { name: "start", opens: 7, free: 120 },
        { name: "own", opens: 14, free: 45 },
        { name: "most", opens: 56, free: 10080 },
        { opens: 7, free: 120 },
        "gyms_pt_booking_settings_check",
      ]);
    },
    T,
  );
});
