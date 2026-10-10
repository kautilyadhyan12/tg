// CHECK-IN MEETS BOOKINGS — the routes and the run that marks ended classes, against real
// Postgres (DATABASE_URL-gated), on two api instances over one database. Spec Part 3
// §13.6; ROADMAP 17f.
//
// The worst thing this job could do to a real person: a member who came is marked
// No-show, or one person's check-in marks somebody else's booking as Came. That is the
// first test.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { CLASS_LATE_CANCEL_ERROR, type ClassBookingView, type ClassBookingsEnding, type ClassSessionBookingsResponse } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { markEndedClasses } from "../src/modules/orgs/classes/attendance.js";
import { endLeaversBookings } from "../src/modules/orgs/classes/bookingChanges.js";
import { createIoRedis, createMemoryRedis, type RedisLike } from "../src/redis.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "class-attendance-routes-secret-01234567", // dummy test value, gitleaks:allow
  CHECKIN_PASS_SECRET: "class-attendance-pass-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 240_000;
const LIVE_PLAN = "zz_classatt_live";
const MIN = 60_000;
const HOUR = 60 * MIN;
/** A visit is stamped by the database's own clock, so the classes stand around the real
 *  now; the api's clock starts there and is moved by each test. */
const T0 = Date.now();
/** Every class here is 45 minutes long. */
const LENGTH = 45 * MIN;

/** The minute of the day in the gyms' zone. */
const londonMinute = (ms: number): number => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]),
  );
  return Number(parts["hour"]) * 60 + Number(parts["minute"]);
};
/** A class half an hour from now can be moved 100 minutes later and still be today: not
 *  in the two hours before midnight in London, when the test that moves one is skipped. */
const ROOM_TO_MOVE = londonMinute(T0 + 30 * MIN) + 100 < 1440;

let ipCounter = 0;
const nextIp = () => `10.91.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
const redisUrl = process.env["TEST_REDIS_URL"];
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("check-in meets bookings (real Postgres, two api instances)", { timeout: T }, () => {
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
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'classatt-t-%@example.com')`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_attendance WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_checkin_devices WHERE gym_id IN (${mine})`;
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
    await sql`DELETE FROM users WHERE email LIKE 'classatt-t-%@example.com'`;
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
    const email = `classatt-t-${uniq()}@example.com`;
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
  const staff = async (gym: Gym, name: string, role: "trainer" | "manager", privileges: string[] | null = null): Promise<Person> => {
    const person = await signedIn(name);
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${person.userId}, ${role}, ${privileges})`;
    return person;
  };
  const record = async (gym: Gym, name: string, memberNumber: string | null = null): Promise<string> => {
    const res = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName: name, email: `classatt-l-${uniq()}@example.com` });
    expect(res.statusCode, res.body).toBe(201);
    const entryId = (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
    if (memberNumber !== null) await sql`UPDATE gym_member_list_entries SET member_number = ${memberNumber} WHERE id = ${entryId}`;
    return entryId;
  };
  const joinGym = async (gym: Gym, person: Person, entryId: string | null): Promise<void> => {
    await sql`INSERT INTO gym_members (gym_id, user_id, joined_at, entry_id) VALUES (${gym.id}, ${person.userId}, '2026-01-01T00:00:00Z', ${entryId})`;
  };
  type Member = Person & { entryId: string };
  /** A member of the app with a record of their own on the gym's list. */
  const member = async (gym: Gym, name: string, memberNumber: string | null = null): Promise<Member> => {
    const person = await signedIn(name);
    const entryId = await record(gym, name, memberNumber);
    await joinGym(gym, person, entryId);
    return { ...person, entryId };
  };

  /** A 45-minute class that starts at `startsAt`, in a class type of its own. */
  const classAt = async (gym: Gym, startsAt: number, over: { places?: number | null; coach?: string; cancelled?: boolean } = {}): Promise<string> => {
    const [type] = await sql<{ id: string }[]>`
      INSERT INTO gym_class_types (gym_id, name, minutes, places, colour, open_gym)
      VALUES (${gym.id}, ${`Spin ${uniq()}`}, 45, ${over.places ?? null}, 'blue', false)
      RETURNING id`;
    if (type === undefined) throw new Error("no class type");
    const at = new Date(startsAt);
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_class_sessions (gym_id, class_type_id, local_date, local_start_minute, starts_at, minutes, places, coach_user_id, status)
      SELECT ${gym.id}, ${type.id}, l::date, (EXTRACT(HOUR FROM l) * 60 + EXTRACT(MINUTE FROM l))::int, ${at}, 45, ${over.places ?? null},
             ${over.coach ?? null}, ${over.cancelled === true ? "cancelled" : "scheduled"}
      FROM (SELECT ${at}::timestamptz AT TIME ZONE 'Europe/London' AS l) x
      RETURNING id`;
    if (row === undefined) throw new Error("no class");
    return row.id;
  };

  const bookingUrl = (gym: Gym, sessionId: string) => `/v1/orgs/${gym.id}/class-sessions/${sessionId}/booking`;
  const bookRaw = (gym: Gym, who: Person, sessionId: string, joinWaitlist = false) =>
    inject("POST", bookingUrl(gym, sessionId), who.cookies, { requestKey: randomUUID(), joinWaitlist });
  const book = async (gym: Gym, who: Person, sessionId: string, joinWaitlist = false): Promise<ClassBookingView> => {
    const res = await bookRaw(gym, who, sessionId, joinWaitlist);
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { booking: ClassBookingView }).booking;
  };
  const cancel = (gym: Gym, who: Person, sessionId: string, lateOk = false, target = api()) =>
    inject("POST", `${bookingUrl(gym, sessionId)}/cancel`, who.cookies, { lateOk }, { target });
  const seen = async (gym: Gym, who: Person, sessionId: string): Promise<ClassBookingView> => {
    const res = await inject("GET", bookingUrl(gym, sessionId), who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { booking: ClassBookingView }).booking;
  };
  /** [status, still charged to a pack] of this person's newest booking of the class. */
  const placeOf = async (sessionId: string, who: Person): Promise<[string, boolean]> => {
    const rows = await sql<{ status: string; pack_charged: boolean }[]>`
      SELECT status, pack_charged FROM gym_class_bookings WHERE session_id = ${sessionId} AND user_id = ${who.userId} ORDER BY seq DESC LIMIT 1`;
    const row = rows[0];
    if (row === undefined) throw new Error(`${who.name} has no booking`);
    return [row.status, row.pack_charged];
  };
  const statusOf = async (sessionId: string, who: Person): Promise<string> => (await placeOf(sessionId, who))[0];
  const bookingId = async (sessionId: string, who: Person): Promise<string> => {
    const rows = await sql<{ id: string }[]>`SELECT id FROM gym_class_bookings WHERE session_id = ${sessionId} AND user_id = ${who.userId} ORDER BY seq DESC LIMIT 1`;
    const row = rows[0];
    if (row === undefined) throw new Error(`${who.name} has no booking`);
    return row.id;
  };

  /** A 10-class pack on the gym's price list. */
  const packType = async (gym: Gym): Promise<string> => {
    const [type] = await sql<{ id: string }[]>`
      INSERT INTO gym_membership_types
        (gym_id, name, kind, price_minor, currency, term_count, term_unit, pack_classes, pack_days, access, covers_all_classes)
      VALUES (${gym.id}, '10 classes', 'pack', 9000, 'GBP', NULL, NULL, 10, 60, 'all_classes', true)
      RETURNING id`;
    if (type === undefined) throw new Error("no type");
    return type.id;
  };
  const holdPackOf = async (gym: Gym, typeId: string, who: Member): Promise<string> => {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_held_memberships
        (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit, pack_classes, pack_days,
         classes_left, starts_on, status, renews)
      VALUES (${gym.id}, ${who.entryId}, ${typeId}, gen_random_uuid(), 'pack', 9000, 'GBP', NULL, NULL, 10, 60, 10,
              (now() AT TIME ZONE 'Europe/London')::date - 1, 'active', false)
      RETURNING id`;
    if (row === undefined) throw new Error("no pack");
    return row.id;
  };
  const classesLeft = async (heldId: string): Promise<number | null> =>
    (await sql<{ classes_left: number | null }[]>`SELECT classes_left FROM gym_held_memberships WHERE id = ${heldId}`)[0]?.classes_left ?? null;

  // ── CHECKING IN ──

  interface Desk {
    cookies: Cookies;
  }
  /** A desk device, set up the way a gym does it: added in Settings, its link opened. */
  const makeDesk = async (gym: Gym): Promise<Desk> => {
    const added = await inject("POST", `/v1/orgs/${gym.id}/checkin-devices`, gym.owner.cookies, { name: "Front desk" });
    expect(added.statusCode, added.body).toBe(201);
    const token = (JSON.parse(added.body) as { link: string }).link.split("#")[1] ?? "";
    const claimed = await inject("POST", "/v1/checkin/device/claim", {}, { token });
    expect(claimed.statusCode, claimed.body).toBe(200);
    return { cookies: cookieMap(claimed) };
  };
  const scanRaw = (desk: Desk, code: string, target = api()) => inject("POST", "/v1/checkin/scan", desk.cookies, { code }, { target });
  /** A key tag, or a pass, read at the desk: the answer's `result`. */
  const scan = async (desk: Desk, code: string): Promise<string> => {
    const res = await scanRaw(desk, code);
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { result: string }).result;
  };
  const passOf = async (who: Person): Promise<string> => {
    const res = await inject("GET", "/v1/users/me/checkin-pass", who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { pass: string }).pass;
  };
  /** Staff check a person in from the console. */
  const staffCheckInRaw = (gym: Gym, who: Person, by: Person = gym.owner, target = api()) =>
    inject("POST", `/v1/orgs/${gym.id}/attendance/check-in`, by.cookies, { userId: who.userId }, { target });
  const staffCheckIn = async (gym: Gym, who: Person): Promise<string> => {
    const res = await staffCheckInRaw(gym, who);
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { result: string }).result;
  };
  /** A check-in already in the database, stamped `at`: one whose mark never reached the
   *  booking, or one in a class's window the test has no other way to stand in. */
  const visitAt = async (gym: Gym, who: { userId: string | null; entryId: string | null }, at: number, method: "staff" | "manual" = "staff"): Promise<void> => {
    await sql`
      INSERT INTO gym_attendance (gym_id, user_id, entry_id, marked_by_user_id, day, method, hours_status, slot_key, marked_at)
      VALUES (${gym.id}, ${who.userId}, ${who.entryId}, ${method === "staff" ? gym.owner.userId : who.userId},
              (${new Date(at)}::timestamptz AT TIME ZONE 'Europe/London')::date, ${method}, 'hours_unset', 'hours_unset', ${new Date(at)})`;
  };

  /** The id of this person's one check-in at the gym that staff or a desk made. */
  const checkInOf = async (gym: Gym, who: Person): Promise<string> => {
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM gym_attendance WHERE gym_id = ${gym.id} AND user_id = ${who.userId} AND slot_key <> 'added_later'`;
    const row = rows[0];
    if (row === undefined || rows.length !== 1) throw new Error(`${who.name} has ${String(rows.length)} check-ins`);
    return row.id;
  };
  const removeVisit = (gym: Gym, visitId: string) => inject("DELETE", `/v1/orgs/${gym.id}/attendance/visits/${visitId}`, gym.owner.cookies);

  const warned: object[] = [];
  /** The run that marks ended classes, as the worker calls it, for these gyms alone: the
   *  database is shared with every other test file. */
  const run = (at: number, gyms: readonly Gym[]) => markEndedClasses({ sql, log: { warn: (obj) => warned.push(obj) } }, new Date(at), gyms.map((g) => g.id));

  // ── STAFF'S OWN MARK ──

  const markRaw = (gym: Gym, sessionId: string, booking: string, status: unknown, by: Person = gym.owner, opts: { ip?: string; target?: App } = {}) =>
    inject("POST", `/v1/orgs/${gym.id}/class-sessions/${sessionId}/bookings/${booking}/mark`, by.cookies, { status }, opts);
  const errorOf = (res: { body: string }): string => (JSON.parse(res.body) as { error: string }).error;
  const no = (res: { statusCode: number; body: string }): string => `${String(res.statusCode)} ${errorOf(res)}`;
  const listOf = async (gym: Gym, sessionId: string, by: Person = gym.owner): Promise<ClassSessionBookingsResponse> => {
    const res = await inject("GET", `/v1/orgs/${gym.id}/class-sessions/${sessionId}/bookings`, by.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as ClassSessionBookingsResponse;
  };
  const audits = async (gym: Gym, booking: string): Promise<Record<string, string>[]> =>
    (await sql<{ meta: Record<string, string> }[]>`
      SELECT meta FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.class_booking_marked' AND target_id = ${booking} ORDER BY at, id`).map((r) => r.meta);

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    redis = redisUrl === undefined || redisUrl === "" ? createMemoryRedis() : createIoRedis(redisUrl);
    for (let tries = 0; (await redis.incrWithTtl(`classatt-ready:${randomUUID()}`, 30)) === null; tries++) {
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

  it("a check-in marks that person's own booking and nobody else's, and nobody who came is a no-show", async () => {
    clock = T0;
    const iron = await makeGym("Iron House");
    const desk = await makeDesk(iron);
    const asha = await member(iron, "Asha Rao", "9001");
    const bina = await member(iron, "Bina Shah", "9002");
    const chloe = await member(iron, "Chloe Park", "9003");
    // Two accounts on ONE record: its key tag cannot say which of them is at the desk.
    const shared = await record(iron, "The Mehtas", "9100");
    const dev = await signedIn("Dev Mehta");
    const esha = await signedIn("Esha Mehta");
    await joinGym(iron, dev, shared);
    await joinGym(iron, esha, shared);
    // Somebody with a tag and no app: they can hold no booking, and their scan is a visit.
    await record(iron, "Walk-in Wendy", "9200");

    const spin = await classAt(iron, T0 + 30 * MIN);
    const tomorrow = await classAt(iron, T0 + 26 * HOUR);
    for (const who of [asha, bina, chloe, dev, esha]) await book(iron, who, spin);
    await book(iron, asha, tomorrow);

    // Asha is a member of a second gym too, booked on its class at the same hour.
    const rival = await makeGym("Rival Gym");
    await joinGym(rival, asha, null);
    const rivalSpin = await classAt(rival, T0 + 30 * MIN);
    await book(rival, asha, rivalSpin);
    // A gym that checks nobody in: it has classes and bookings, and no desk.
    const quiet = await makeGym("Quiet Studio");
    const farah = await member(quiet, "Farah Khan");
    const quietSpin = await classAt(quiet, T0 + 30 * MIN);
    await book(quiet, farah, quietSpin);

    // Asha shows her pass at Iron House's desk, half an hour before the class.
    expect(await scan(desk, await passOf(asha))).toBe("checked_in");
    expect(await statusOf(spin, asha)).toBe("attended");
    for (const who of [bina, chloe, dev, esha]) expect(await statusOf(spin, who), who.name).toBe("booked");
    expect(await statusOf(tomorrow, asha)).toBe("booked");
    expect(await statusOf(rivalSpin, asha)).toBe("booked");

    // The Mehtas' tag and Wendy's: each a visit, and no booking is anybody's by a record.
    expect(await scan(desk, "9100")).toBe("checked_in");
    expect(await scan(desk, "9200")).toBe("checked_in");
    for (const who of [bina, chloe, dev, esha]) expect(await statusOf(spin, who), who.name).toBe("booked");

    // Chloe checked in, and the mark never reached her booking (the server stopped between the two).
    await visitAt(iron, chloe, T0);

    const end = T0 + 30 * MIN + LENGTH;
    const gyms = [iron, rival, quiet];
    // A minute short of 15 after the end, nothing is decided.
    expect(await run(end + 14 * MIN, gyms)).toEqual({ gyms: 0, attended: 0, noShows: 0, left: 0 });
    expect(await statusOf(spin, bina)).toBe("booked");

    expect(await run(end + 15 * MIN, gyms)).toEqual({ gyms: 3, attended: 1, noShows: 1, left: 4 });
    expect(await statusOf(spin, asha)).toBe("attended");
    expect(await statusOf(spin, chloe)).toBe("attended");
    // Bina never checked in, at a gym that was checking people in.
    expect(await statusOf(spin, bina)).toBe("no_show");
    // One of the Mehtas came, and nothing says which: neither is called a no-show.
    expect(await statusOf(spin, dev)).toBe("booked");
    expect(await statusOf(spin, esha)).toBe("booked");
    // Asha's check-in at Iron House says nothing about Rival, which checked nobody in.
    expect(await statusOf(rivalSpin, asha)).toBe("booked");
    expect(await statusOf(quietSpin, farah)).toBe("booked");
    expect(await statusOf(tomorrow, asha)).toBe("booked");

    // The run again, at once and later: nothing more is marked.
    expect(await run(end + 15 * MIN, gyms)).toEqual({ gyms: 3, attended: 0, noShows: 0, left: 4 });
    expect(await run(end + 2 * HOUR, gyms)).toEqual({ gyms: 3, attended: 0, noShows: 0, left: 4 });
    expect(await statusOf(spin, bina)).toBe("no_show");
    expect(await statusOf(spin, asha)).toBe("attended");

    // After the class Dev shows his own pass. It is written onto the earlier tag visit,
    // which still cannot say which of the two was at the class: neither is marked came.
    clock = end + 20 * MIN;
    expect(await scan(desk, await passOf(dev))).toBe("already");
    clock = T0;
    expect((await sql`SELECT 1 FROM gym_attendance WHERE gym_id = ${iron.id} AND user_id = ${dev.userId} AND method = 'key_tag'`).length).toBe(1);
    expect(await run(end + 3 * HOUR, gyms)).toEqual({ gyms: 3, attended: 0, noShows: 0, left: 4 });
    expect(await statusOf(spin, dev)).toBe("booked");
    expect(await statusOf(spin, esha)).toBe("booked");
    expect(warned).toEqual([]);
  });

  it("the run reads the window itself: a check-in outside it is neither came nor a no-show, one inside it is came, none at all is a no-show", async () => {
    clock = T0;
    const gym = await makeGym("Run Gym");
    const start = T0 + 3 * HOUR;
    const end = start + LENGTH;
    const spin = await classAt(gym, start);
    const [before, onTheHour, atTheEnd, after, absent, dayBefore, bookedAfter] = await Promise.all(
      ["Before Bo", "Hour Hy", "End Eli", "After Al", "Absent Abe", "Yesterday Yu", "Booked After Bea"].map((name) => member(gym, name)),
    );
    if (
      before === undefined ||
      onTheHour === undefined ||
      atTheEnd === undefined ||
      after === undefined ||
      absent === undefined ||
      dayBefore === undefined ||
      bookedAfter === undefined
    ) {
      throw new Error("no members");
    }
    for (const who of [before, onTheHour, atTheEnd, after, absent, dayBefore]) await book(gym, who, spin);
    // Each a check-in whose mark never reached the booking, a millisecond either side of the window's ends.
    await visitAt(gym, before, start - HOUR - 1);
    await visitAt(gym, onTheHour, start - HOUR);
    await visitAt(gym, atTheEnd, end);
    await visitAt(gym, after, end + 1);
    await visitAt(gym, dayBefore, start - 26 * HOUR);
    // Checked in, and booked the class afterwards: no check-in followed the booking, so only the run can mark it.
    await visitAt(gym, bookedAfter, start - 10 * MIN);
    await book(gym, bookedAfter, spin);
    expect(await statusOf(spin, bookedAfter)).toBe("booked");

    expect(await run(end + 15 * MIN, [gym])).toEqual({ gyms: 1, attended: 3, noShows: 2, left: 2 });
    for (const who of [onTheHour, atTheEnd, bookedAfter]) expect(await statusOf(spin, who), who.name).toBe("attended");
    // At the gym that day, outside the window: nothing says they missed the class.
    for (const who of [before, after]) expect(await statusOf(spin, who), who.name).toBe("booked");
    for (const who of [absent, dayBefore]) expect(await statusOf(spin, who), who.name).toBe("no_show");
    expect((await seen(gym, before, spin)).mine?.status).toBe("booked");
  });

  it("the window is one hour before the start until the end, to the millisecond, and a second check-in that day counts", async () => {
    clock = T0;
    const gym = await makeGym("Edge Gym");
    const start = T0 + 3 * HOUR;
    const spin = await classAt(gym, start);
    const [early, onTheHour, atTheEnd, late, twice] = await Promise.all(["Early Eve", "Hour Hal", "End Edie", "Late Lou", "Twice Tom"].map((name) => member(gym, name)));
    if (early === undefined || onTheHour === undefined || atTheEnd === undefined || late === undefined || twice === undefined) throw new Error("no members");
    for (const who of [early, onTheHour, atTheEnd, late, twice]) await book(gym, who, spin);

    // Three hours before: here for the gym, not for the class.
    expect(await staffCheckIn(gym, twice)).toBe("checked_in");
    expect(await statusOf(spin, twice)).toBe("booked");

    clock = start - HOUR - 1;
    expect(await staffCheckIn(gym, early)).toBe("checked_in");
    expect(await statusOf(spin, early)).toBe("booked");

    clock = start - HOUR;
    expect(await staffCheckIn(gym, onTheHour)).toBe("checked_in");
    expect(await statusOf(spin, onTheHour)).toBe("attended");

    // Back at the desk ten minutes before the class: no new visit, and they are here now.
    clock = start - 10 * MIN;
    expect(await staffCheckIn(gym, twice)).toBe("already");
    expect(await statusOf(spin, twice)).toBe("attended");

    clock = start + LENGTH;
    expect(await staffCheckIn(gym, atTheEnd)).toBe("checked_in");
    expect(await statusOf(spin, atTheEnd)).toBe("attended");

    clock = start + LENGTH + 1;
    expect(await staffCheckIn(gym, late)).toBe("checked_in");
    expect(await statusOf(spin, late)).toBe("booked");
    clock = T0;
  });

  it("a check-in marks only a place still booked in a class that runs; a member's own tap and a visit added later are no check-in", async () => {
    clock = T0;
    const gym = await makeGym("Guard Gym");
    const start = T0 + 30 * MIN;
    const one = await classAt(gym, start, { places: 1 });
    const off = await classAt(gym, start, { cancelled: true });
    const spin = await classAt(gym, start);
    const [holder, waiter, lateCanceller, canceller, inCancelled, tapper, addedLater, checker, absent] = await Promise.all(
      ["Holder Hana", "Waiter Will", "Late Lena", "Gone Gus", "Off Olga", "Tap Tia", "Added Adi", "Check Cy", "Absent Abe"].map((name) => member(gym, name)),
    );
    if (
      holder === undefined ||
      waiter === undefined ||
      lateCanceller === undefined ||
      canceller === undefined ||
      inCancelled === undefined ||
      tapper === undefined ||
      addedLater === undefined ||
      checker === undefined ||
      absent === undefined
    ) {
      throw new Error("no members");
    }
    await book(gym, holder, one);
    expect((await book(gym, waiter, one, true)).mine?.status).toBe("waitlisted");
    await book(gym, lateCanceller, spin);
    expect((await cancel(gym, lateCanceller, spin, true)).statusCode).toBe(200);
    await book(gym, canceller, spin);
    await sql`UPDATE gym_class_bookings SET status = 'cancelled', cancelled_at = now() WHERE session_id = ${spin} AND user_id = ${canceller.userId}`;
    await sql`INSERT INTO gym_class_bookings (gym_id, session_id, user_id, entry_id, request_key, status, pack_charged, created_at, booked_at)
              VALUES (${gym.id}, ${off}, ${inCancelled.userId}, ${inCancelled.entryId}, gen_random_uuid(), 'booked', false, now(), now())`;
    await book(gym, tapper, spin);
    await book(gym, addedLater, spin);
    await book(gym, absent, spin);

    for (const who of [holder, waiter, lateCanceller, canceller, inCancelled]) expect(await staffCheckIn(gym, who), who.name).toBe("checked_in");
    expect(await statusOf(one, holder)).toBe("attended");
    expect(await statusOf(one, waiter)).toBe("waitlisted");
    expect(await statusOf(spin, lateCanceller)).toBe("late_cancelled");
    expect(await statusOf(spin, canceller)).toBe("cancelled");
    expect(await statusOf(off, inCancelled)).toBe("booked");

    // The member's own tap in the window, and a visit staff added afterwards for that day.
    await visitAt(gym, tapper, T0, "manual");
    await sql`
      INSERT INTO gym_attendance (gym_id, user_id, entry_id, marked_by_user_id, day, method, hours_status, slot_key, marked_at)
      VALUES (${gym.id}, ${addedLater.userId}, ${addedLater.entryId}, ${gym.owner.userId},
              (${new Date(T0)}::timestamptz AT TIME ZONE 'Europe/London')::date, 'staff', 'added_later', 'added_later', ${new Date(T0)})`;
    // Somebody else checked in, so the gym was checking people in.
    await visitAt(gym, checker, T0);

    const done = await run(start + LENGTH + 15 * MIN, [gym]);
    expect(done).toEqual({ gyms: 1, attended: 0, noShows: 1, left: 2 });
    // Neither is a check-in, so neither is marked came; each says they were at the gym, so neither is a no-show.
    expect(await statusOf(spin, tapper)).toBe("booked");
    expect(await statusOf(spin, addedLater)).toBe("booked");
    expect(await statusOf(spin, absent)).toBe("no_show");
    // The run touched nothing else: not the waitlist, a cancel, or a cancelled class.
    expect(await statusOf(one, waiter)).toBe("waitlisted");
    expect(await statusOf(spin, lateCanceller)).toBe("late_cancelled");
    expect(await statusOf(spin, canceller)).toBe("cancelled");
    expect(await statusOf(off, inCancelled)).toBe("booked");
  });

  it("a class that ended more than two days ago is left for staff", async () => {
    clock = T0;
    const gym = await makeGym("Old Gym");
    const start = T0 + 30 * MIN;
    const spin = await classAt(gym, start);
    const absent = await member(gym, "Absent Abe");
    const present = await member(gym, "Present Pia");
    await book(gym, absent, spin);
    await visitAt(gym, present, T0);
    const end = start + LENGTH;
    expect(await run(end + 48 * HOUR + 1, [gym])).toEqual({ gyms: 1, attended: 0, noShows: 0, left: 1 });
    expect(await statusOf(spin, absent)).toBe("booked");
    expect(await run(end + 48 * HOUR, [gym])).toEqual({ gyms: 1, attended: 0, noShows: 1, left: 0 });
    expect(await statusOf(spin, absent)).toBe("no_show");
  });

  it("a no-show keeps the class used on a pack, and staff changing the mark moves no pack", async () => {
    clock = T0;
    const gym = await makeGym("Pack Gym");
    const type = await packType(gym);
    const holdPack = (who: Member) => holdPackOf(gym, type, who);
    const left = classesLeft;
    const start = T0 + 30 * MIN;
    const spin = await classAt(gym, start);
    const came = await member(gym, "Came Cara");
    const missed = await member(gym, "Missed Mo");
    const camePack = await holdPack(came);
    const missedPack = await holdPack(missed);
    expect((await book(gym, came, spin)).mine?.packCharged).toBe(true);
    expect((await book(gym, missed, spin)).mine?.packCharged).toBe(true);
    expect(await staffCheckIn(gym, came)).toBe("checked_in");

    expect(await run(start + LENGTH + 15 * MIN, [gym])).toEqual({ gyms: 1, attended: 0, noShows: 1, left: 0 });
    expect(await placeOf(spin, came)).toEqual(["attended", true]);
    expect(await placeOf(spin, missed)).toEqual(["no_show", true]);
    expect([await left(camePack), await left(missedPack)]).toEqual([9, 9]);

    clock = start + LENGTH + 20 * MIN;
    expect((await markRaw(gym, spin, await bookingId(spin, missed), "attended")).statusCode).toBe(200);
    expect((await markRaw(gym, spin, await bookingId(spin, came), "no_show")).statusCode).toBe(200);
    expect(await placeOf(spin, missed)).toEqual(["attended", true]);
    expect(await placeOf(spin, came)).toEqual(["no_show", true]);
    expect([await left(camePack), await left(missedPack)]).toEqual([9, 9]);
    clock = T0;
  });

  it("somebody who checked in before the class reads that, cannot book it twice, and cancels it as any booked place: free, then late, never once it has started", async () => {
    clock = T0;
    const gym = await makeGym("Member Gym");
    await sql`UPDATE gyms SET booking_free_cancel_minutes = 30 WHERE id = ${gym.id}`;
    const type = await packType(gym);
    const start = T0 + 50 * MIN;
    const spin = await classAt(gym, start);
    const [free, late, stays] = await Promise.all(["Free Fay", "Late Lee", "Stays Sol"].map((name) => member(gym, name)));
    if (free === undefined || late === undefined || stays === undefined) throw new Error("no members");
    const packs = { free: await holdPackOf(gym, type, free), late: await holdPackOf(gym, type, late), stays: await holdPackOf(gym, type, stays) };
    for (const who of [free, late, stays]) {
      expect((await book(gym, who, spin)).mine?.packCharged).toBe(true);
      expect(await staffCheckIn(gym, who)).toBe("checked_in");
      expect(await placeOf(spin, who)).toEqual(["attended", true]);
    }

    const view = await seen(gym, free, spin);
    expect(view.mine?.status).toBe("attended");
    expect(view.can).toEqual({ book: false, joinWaitlist: false, claim: false, cancel: "free", why: null });
    expect(view.booked).toBe(3);
    expect((await book(gym, free, spin)).mine?.status).toBe("attended");
    expect((await sql`SELECT 1 FROM gym_class_bookings WHERE session_id = ${spin}`).length).toBe(3);

    // Fifty minutes before, with half an hour's notice asked: free, and the pack has its class back.
    const freed = await cancel(gym, free, spin);
    expect(freed.statusCode, freed.body).toBe(200);
    expect(await placeOf(spin, free)).toEqual(["cancelled", false]);
    expect(await classesLeft(packs.free)).toBe(10);

    // Twenty minutes before: a late cancel, asked first, and the pack keeps the class.
    clock = start - 20 * MIN;
    expect((await seen(gym, late, spin)).can.cancel).toBe("late");
    expect(no(await cancel(gym, late, spin, false))).toBe(`409 ${CLASS_LATE_CANCEL_ERROR}`);
    expect(await placeOf(spin, late)).toEqual(["attended", true]);
    expect((await cancel(gym, late, spin, true)).statusCode).toBe(200);
    expect(await placeOf(spin, late)).toEqual(["late_cancelled", true]);
    expect(await classesLeft(packs.late)).toBe(9);

    // Once it has started the answer is the one any started class gives.
    clock = start + MIN;
    expect((await seen(gym, stays, spin)).can.cancel).toBeNull();
    expect(no(await cancel(gym, stays, spin, true))).toBe("409 class_started");
    expect(await placeOf(spin, stays)).toEqual(["attended", true]);
    expect(await classesLeft(packs.stays)).toBe(9);
    // A cancel gives up the class, not the visit to the gym.
    expect((await sql`SELECT 1 FROM gym_attendance WHERE gym_id = ${gym.id}`).length).toBe(3);
    clock = T0;
  });

  it("staff remove a wrong check-in: the class it marked came, still to start, is booked again; another visit that day, or a class that has started, keeps the mark", async () => {
    clock = T0;
    const gym = await makeGym("Fix Gym");
    const start = T0 + 30 * MIN;
    const spin = await classAt(gym, start);
    const [wrong, twice, begun, bystander] = await Promise.all(["Wrong Wes", "Twice Tess", "Begun Bo", "Bystander Bee"].map((name) => member(gym, name)));
    if (wrong === undefined || twice === undefined || begun === undefined || bystander === undefined) throw new Error("no members");
    for (const who of [wrong, twice, begun, bystander]) {
      await book(gym, who, spin);
      expect(await staffCheckIn(gym, who)).toBe("checked_in");
      expect(await statusOf(spin, who)).toBe("attended");
    }
    // Twice has a second visit that day, one staff added.
    await sql`
      INSERT INTO gym_attendance (gym_id, user_id, entry_id, marked_by_user_id, day, method, hours_status, slot_key, marked_at)
      VALUES (${gym.id}, ${twice.userId}, ${twice.entryId}, ${gym.owner.userId},
              (now() AT TIME ZONE 'Europe/London')::date, 'staff', 'added_later', 'added_later', now())`;

    const gone = await removeVisit(gym, await checkInOf(gym, wrong));
    expect(gone.statusCode, gone.body).toBe(200);
    expect(await statusOf(spin, wrong)).toBe("booked");
    expect((await seen(gym, wrong, spin)).mine?.status).toBe("booked");
    expect((await listOf(gym, spin)).booked.map((b) => [b.name, b.status])).toEqual([
      ["Wrong Wes", "booked"],
      ["Twice Tess", "attended"],
      ["Begun Bo", "attended"],
      ["Bystander Bee", "attended"],
    ]);
    // Removed again: the same answer, and nothing more changes.
    expect((await removeVisit(gym, (await sql<{ id: string }[]>`SELECT id FROM gym_attendance_removed WHERE gym_id = ${gym.id} AND user_id = ${wrong.userId}`)[0]?.id ?? "")).statusCode).toBe(200);

    expect((await removeVisit(gym, await checkInOf(gym, twice))).statusCode).toBe(200);
    expect(await statusOf(spin, twice)).toBe("attended");

    // Once the class has started staff have their own buttons, and the mark is history.
    clock = start + MIN;
    expect((await removeVisit(gym, await checkInOf(gym, begun))).statusCode).toBe(200);
    expect(await statusOf(spin, begun)).toBe("attended");
    expect(await statusOf(spin, bystander)).toBe("attended");

    // Wrong Wes never came: with the gym checking people in, the run says so.
    expect(await run(start + LENGTH + 15 * MIN, [gym])).toEqual({ gyms: 1, attended: 0, noShows: 1, left: 0 });
    expect(await statusOf(spin, wrong)).toBe("no_show");
    clock = T0;
  });

  it.skipIf(!ROOM_TO_MOVE)("staff move a class after a check-in: still within the hour the mark stays, more than an hour away the place is booked again", async () => {
    clock = T0;
    const gym = await makeGym("Move Gym");
    const start = T0 + 30 * MIN;
    const spin = await classAt(gym, start);
    const [early, booked] = await Promise.all(["Early Eve", "Booked Bo"].map((name) => member(gym, name)));
    if (early === undefined || booked === undefined) throw new Error("no members");
    await book(gym, early, spin);
    await book(gym, booked, spin);
    expect(await staffCheckIn(gym, early)).toBe("checked_in");
    expect(await statusOf(spin, early)).toBe("attended");
    const minute = londonMinute(start);
    const move = (by: number) =>
      inject("PUT", `/v1/orgs/${gym.id}/class-sessions/${spin}`, gym.owner.cookies, { scope: "this", startMinute: minute + by, minutes: 45, places: null, coachUserId: null });

    const little = await move(10);
    expect(little.statusCode, little.body).toBe(200);
    expect(await statusOf(spin, early)).toBe("attended");

    const far = await move(100);
    expect(far.statusCode, far.body).toBe(200);
    expect(await statusOf(spin, early)).toBe("booked");
    expect(await statusOf(spin, booked)).toBe("booked");
    const view = await seen(gym, early, spin);
    expect(view.mine?.status).toBe("booked");
    expect(view.can.cancel).not.toBeNull();
    expect(view.booked).toBe(2);
    expect((await listOf(gym, spin)).booked.map((b) => b.status)).toEqual(["booked", "booked"]);
  });

  it("somebody checked in before a class who leaves the gym, or whose membership staff cancel, gives the place up and the pack has its class back", async () => {
    clock = T0;
    const gym = await makeGym("Leave Gym");
    const type = await packType(gym);
    const start = T0 + 30 * MIN;
    const spin = await classAt(gym, start);
    const [leaver, ended] = await Promise.all(["Leaver Lux", "Ended Ed"].map((name) => member(gym, name)));
    if (leaver === undefined || ended === undefined) throw new Error("no members");
    const packs = { leaver: await holdPackOf(gym, type, leaver), ended: await holdPackOf(gym, type, ended) };
    for (const who of [leaver, ended]) {
      await book(gym, who, spin);
      expect(await staffCheckIn(gym, who)).toBe("checked_in");
      expect(await placeOf(spin, who)).toEqual(["attended", true]);
    }

    expect(await sql.begin((tx) => endLeaversBookings(tx, gym.id, [leaver.userId], new Date(clock)))).toEqual({ booked: 1, waiting: 0, packClasses: 1 });
    expect(await placeOf(spin, leaver)).toEqual(["cancelled", false]);
    expect(await classesLeft(packs.leaver)).toBe(10);

    const cancelHeld = (body: Record<string, unknown>) =>
      inject("POST", `/v1/orgs/${gym.id}/member-list/entries/${ended.entryId}/memberships/${packs.ended}/cancel`, gym.owner.cookies, body);
    const asked = await cancelHeld({ when: "today" });
    expect(no(asked), asked.body).toBe("409 membership_has_bookings");
    const ending = (JSON.parse(asked.body) as { ending: ClassBookingsEnding }).ending;
    expect(ending.booked).toBe(1);
    const done = await cancelHeld({ when: "today", confirmBookings: ending.mark });
    expect(done.statusCode, done.body).toBe(200);
    expect(await placeOf(spin, ended)).toEqual(["cancelled", false]);
    expect((await seen(gym, ended, spin)).booked).toBe(0);
  });

  it("staff mark came or no-show: who may, when, and what is refused", async () => {
    clock = T0;
    const gym = await makeGym("Mark Gym");
    const theirs = await makeGym("Their Gym");
    const coach = await staff(gym, "Coach Kit", "trainer");
    const otherTrainer = await staff(gym, "Trainer Tad", "trainer");
    const manager = await staff(gym, "Manager May", "manager");
    const start = T0 + 30 * MIN;
    const spin = await classAt(gym, start, { coach: coach.userId, places: 2 });
    const off = await classAt(gym, start, { cancelled: true });
    const [ana, ben, cat] = await Promise.all(["Ana Diaz", "Ben Ode", "Cat Lund"].map((name) => member(gym, name)));
    if (ana === undefined || ben === undefined || cat === undefined) throw new Error("no members");
    await book(gym, ana, spin);
    await book(gym, ben, spin);
    expect((await book(gym, cat, spin, true)).mine?.status).toBe("waitlisted");
    const anaBooking = await bookingId(spin, ana);
    const benBooking = await bookingId(spin, ben);
    const catBooking = await bookingId(spin, cat);
    // Another gym's class and booking, at the same hour.
    const stranger = await member(theirs, "Stranger Sy");
    const theirSpin = await classAt(theirs, start);
    await book(theirs, stranger, theirSpin);
    const theirBooking = await bookingId(theirSpin, stranger);
    await sql`INSERT INTO gym_class_bookings (gym_id, session_id, user_id, entry_id, request_key, status, pack_charged, created_at, booked_at)
              VALUES (${gym.id}, ${off}, ${ana.userId}, ${ana.entryId}, gen_random_uuid(), 'booked', false, now(), now())`;
    const offBooking = await bookingId(off, ana);

    // Before the start nobody is marked, and the list says so.
    expect((await listOf(gym, spin)).canMark).toBe(false);
    expect(no(await markRaw(gym, spin, anaBooking, "attended"))).toBe("409 not_started");

    clock = start;
    expect((await listOf(gym, spin)).canMark).toBe(true);
    expect((await listOf(gym, off)).canMark).toBe(false);

    // Who may.
    expect((await inject("POST", `/v1/orgs/${gym.id}/class-sessions/${spin}/bookings/${anaBooking}/mark`, {}, { status: "attended" })).statusCode).toBe(401);
    expect(no(await markRaw(gym, spin, anaBooking, "attended", theirs.owner))).toBe("404 org_not_found");
    expect(no(await markRaw(gym, spin, anaBooking, "attended", ana))).toBe("404 org_not_found");
    expect(no(await markRaw(gym, spin, anaBooking, "attended", otherTrainer))).toBe("403 forbidden");
    expect(await statusOf(spin, ana)).toBe("booked");

    // What is refused.
    expect((await markRaw(gym, spin, anaBooking, "booked")).statusCode).toBe(400);
    expect((await markRaw(gym, spin, anaBooking, "cancelled")).statusCode).toBe(400);
    expect((await inject("POST", `/v1/orgs/${gym.id}/class-sessions/${spin}/bookings/not-an-id/mark`, gym.owner.cookies, { status: "attended" })).statusCode).toBe(400);
    expect(no(await markRaw(gym, spin, randomUUID(), "attended"))).toBe("404 booking_not_found");
    // Another gym's booking, by its id, under this gym's class; and under its own class from here.
    expect(no(await markRaw(gym, spin, theirBooking, "no_show"))).toBe("404 booking_not_found");
    expect(no(await markRaw(gym, theirSpin, theirBooking, "no_show"))).toBe("404 class_not_found");
    // This gym's booking of another class.
    expect(no(await markRaw(gym, spin, offBooking, "attended"))).toBe("404 booking_not_found");
    expect(no(await markRaw(gym, off, offBooking, "attended"))).toBe("409 mark_cancelled");
    expect(no(await markRaw(gym, spin, catBooking, "attended"))).toBe("409 mark_not_booked");
    expect(await statusOf(theirSpin, stranger)).toBe("booked");
    expect(await statusOf(spin, cat)).toBe("waitlisted");

    // The class's own coach marks, and reads the list back with no membership on it.
    const byCoach = await markRaw(gym, spin, anaBooking, "attended", coach);
    expect(byCoach.statusCode, byCoach.body).toBe(200);
    const coachList = JSON.parse(byCoach.body) as ClassSessionBookingsResponse;
    expect(coachList.booked.map((b) => [b.name, b.status, b.membership])).toEqual([
      ["Ana Diaz", "attended", null],
      ["Ben Ode", "booked", null],
    ]);
    // A manager changes it, and marks the other; the same mark again changes nothing.
    expect((await markRaw(gym, spin, anaBooking, "no_show", manager)).statusCode).toBe(200);
    expect((await markRaw(gym, spin, anaBooking, "no_show", manager, { target: other() })).statusCode).toBe(200);
    expect((await markRaw(gym, spin, benBooking, "attended", manager)).statusCode).toBe(200);
    const list = await listOf(gym, spin);
    expect(list.booked.map((b) => [b.name, b.status])).toEqual([
      ["Ana Diaz", "no_show"],
      ["Ben Ode", "attended"],
    ]);
    // A marked place is still a place: the class is as full as it was.
    expect((await seen(gym, cat, spin)).booked).toBe(2);
    expect(await audits(gym, anaBooking)).toEqual([
      { status: "attended", was: "booked" },
      { status: "no_show", was: "attended" },
    ]);
    expect(await audits(gym, benBooking)).toEqual([{ status: "attended", was: "booked" }]);

    // A gym whose plan has lapsed changes nothing.
    await sql`UPDATE subscriptions SET status = 'expired' WHERE owner_type = 'gym' AND owner_id = ${gym.id}`;
    expect(no(await markRaw(gym, spin, benBooking, "no_show"))).toBe("409 gym_not_on_plan");
    expect(await statusOf(spin, ben)).toBe("attended");
    await sql`UPDATE subscriptions SET status = 'trialing' WHERE owner_type = 'gym' AND owner_id = ${gym.id}`;
    clock = T0;
  });

  it("three staff at one front desk mark a whole class from one address", async () => {
    clock = T0;
    const gym = await makeGym("Desk Gym");
    const start = T0 + 30 * MIN;
    const spin = await classAt(gym, start);
    const people = await Promise.all(Array.from({ length: 8 }, (_, n) => member(gym, `Person ${String(n)}`)));
    for (const who of people) await book(gym, who, spin);
    const ids = await Promise.all(people.map((who) => bookingId(spin, who)));
    const team = [gym.owner, await staff(gym, "Manager One", "manager"), await staff(gym, "Manager Two", "manager")];
    clock = start;
    // Its own address each run: the real Redis keeps an hour's count.
    const address = `10.92.${String(Math.floor(Math.random() * 250))}.${String(1 + Math.floor(Math.random() * 250))}`;
    const answers: number[] = [];
    for (let round = 0; round < 15; round++) {
      for (const [n, id] of ids.entries()) {
        const by = team[(round + n) % team.length] ?? gym.owner;
        answers.push((await markRaw(gym, spin, id, round % 2 === 0 ? "attended" : "no_show", by, { ip: address })).statusCode);
      }
    }
    expect(answers.length).toBe(120);
    expect(answers.filter((code) => code !== 200)).toEqual([]);
    for (const who of people) expect(await statusOf(spin, who)).toBe("attended");
    clock = T0;
  });

  it("a check-in and a cancel at one instant, on two servers, in whichever order they land: the place is given up once and the visit is kept", async () => {
    clock = T0;
    const gym = await makeGym("Race Gym");
    const start = T0 + 30 * MIN;
    const spin = await classAt(gym, start);
    for (let round = 0; round < 8; round++) {
      const who = await member(gym, `Racer ${String(round)}`);
      await book(gym, who, spin);
      const [checkedIn, cancelled] = await Promise.all(
        round % 2 === 0
          ? [staffCheckInRaw(gym, who, gym.owner, api()), cancel(gym, who, spin, true, other())]
          : [staffCheckInRaw(gym, who, gym.owner, other()), cancel(gym, who, spin, true, api())],
      );
      expect(checkedIn.statusCode, checkedIn.body).toBe(200);
      // Cancel first, and the check-in finds no place to mark; check-in first, and the
      // cancel gives up the place it marked. Either way the cancel stands.
      expect(cancelled.statusCode, cancelled.body).toBe(200);
      expect(["cancelled", "late_cancelled"]).toContain(await statusOf(spin, who));
      expect((await sql`SELECT 1 FROM gym_class_bookings WHERE session_id = ${spin} AND user_id = ${who.userId}`).length).toBe(1);
      expect((await sql`SELECT 1 FROM gym_attendance WHERE gym_id = ${gym.id} AND user_id = ${who.userId}`).length).toBe(1);
    }
    expect((await listOf(gym, spin)).booked).toEqual([]);
  });

  it("two runs and staff's mark at one instant: staff's mark stands, and nobody is marked twice", async () => {
    clock = T0;
    const gym = await makeGym("Sweep Gym");
    const start = T0 + 30 * MIN;
    const end = start + LENGTH;
    for (let round = 0; round < 4; round++) {
      const spin = await classAt(gym, start);
      const [first, second_, third, checker] = await Promise.all(
        ["One", "Two", "Three", "Checker"].map((name) => member(gym, `${name} ${String(round)}`)),
      );
      if (first === undefined || second_ === undefined || third === undefined || checker === undefined) throw new Error("no members");
      for (const who of [first, second_, third]) await book(gym, who, spin);
      await visitAt(gym, checker, T0);
      clock = end + 15 * MIN;
      const [a, b, marked] = await Promise.all([
        run(end + 15 * MIN, [gym]),
        run(end + 15 * MIN, [gym]),
        markRaw(gym, spin, await bookingId(spin, first), "attended", gym.owner, { target: round % 2 === 0 ? api() : other() }),
      ]);
      expect(marked.statusCode, marked.body).toBe(200);
      // Staff saw them: whichever came first, that is what stands.
      expect(await statusOf(spin, first)).toBe("attended");
      expect(await statusOf(spin, second_)).toBe("no_show");
      expect(await statusOf(spin, third)).toBe("no_show");
      // Two or three no-shows between the two runs, never one place by both.
      expect([2, 3]).toContain(a.noShows + b.noShows);
      expect(a.attended + b.attended).toBe(0);
      clock = T0;
    }
    expect(warned).toEqual([]);
  });
});
