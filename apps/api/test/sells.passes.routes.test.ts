// THE TWO EXTRA PASSES OVER "WHAT A GYM SELLS, AND ITS TIMETABLE" (ROADMAP item 17): each
// finding as a test, against real Postgres (DATABASE_URL-gated), on two api instances
// over one database.
//
// The worst thing: a person taken off the gym's list keeps a place in a class, and the
// pack that paid for it stays charged. That is the first test.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { ClassBookingView } from "@app/shared";
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
  JWT_SECRET: "sells-fix-routes-secret-0123456789abcde", // dummy test value, gitleaks:allow
  CHECKIN_PASS_SECRET: "sells-fix-pass-secret-0123456789abcdefg", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 240_000;
const LIVE_PLAN = "zz_sellsfix_live";
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = Date.now();

let ipCounter = 0;
const nextIp = () => `10.93.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
const redisUrl = process.env["TEST_REDIS_URL"];
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("the two extra passes over what a gym sells (real Postgres, two api instances)", { timeout: T }, () => {
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
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'sellsfix-t-%@example.com')`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_attendance WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_pt_appointments WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_trainers WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_uploads WHERE gym_id IN (${mine})`;
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
    await sql`DELETE FROM users WHERE email LIKE 'sellsfix-t-%@example.com' OR email LIKE 'sellsfix-b-%@example.com'`;
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
    const email = `sellsfix-t-${uniq()}@example.com`;
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
    const res = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName: name, email: `sellsfix-l-${uniq()}@example.com` });
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
  /** [status, still charged to a pack] of this person's newest booking of the class. */
  const placeOf = async (sessionId: string, who: { userId: string }): Promise<[string, boolean]> => {
    const rows = await sql<{ status: string; pack_charged: boolean }[]>`
      SELECT status, pack_charged FROM gym_class_bookings WHERE session_id = ${sessionId} AND user_id = ${who.userId} ORDER BY seq DESC LIMIT 1`;
    const row = rows[0];
    if (row === undefined) throw new Error("no booking");
    return [row.status, row.pack_charged];
  };
  const statusOf = async (sessionId: string, who: { userId: string }): Promise<string> => (await placeOf(sessionId, who))[0];

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

  const errorOf = (res: { body: string }): string => (JSON.parse(res.body) as { error: string }).error;
  const no = (res: { statusCode: number; body: string }): string => `${String(res.statusCode)} ${errorOf(res)}`;

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    redis = redisUrl === undefined || redisUrl === "" ? createMemoryRedis() : createIoRedis(redisUrl);
    for (let tries = 0; (await redis.incrWithTtl(`sellsfix-ready:${randomUUID()}`, 30)) === null; tries++) {
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

  const formerOf = async (gym: Gym, entryId: string): Promise<boolean> =>
    (await sql<{ former: boolean }[]>`SELECT former_at IS NOT NULL AS former FROM gym_member_list_entries WHERE gym_id = ${gym.id} AND id = ${entryId}`)[0]?.former ?? false;
  const inApp = async (gym: Gym, who: Person): Promise<boolean> =>
    ((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_members WHERE gym_id = ${gym.id} AND user_id = ${who.userId} AND removed_at IS NULL`)[0]?.n ?? 0) === 1;
  /** Staff who train here: a member of the app with a record, and on the staff. */
  const staffWhoTrains = async (gym: Gym, name: string): Promise<Member> => {
    const who = await member(gym, name);
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${who.userId}, 'trainer', ${null})`;
    return who;
  };

  it("a record taken off the list loses its coming class bookings, the pack has its class back and the place goes to whoever waits, though the person's app stays", async () => {
    clock = T0;
    const gym = await makeGym("Leavers House");
    const sam = await staffWhoTrains(gym, "Sam Coach");
    const tia = await staffWhoTrains(gym, "Tia Coach");
    const maya = await member(gym, "Maya Waits");
    const leo = await member(gym, "Leo Stays");
    const packs = await packFor(gym, [sam, tia, maya, leo]);
    const full = await classAt(gym, T0 + 2 * DAY, { places: 1 });
    const open = await classAt(gym, T0 + 3 * DAY);
    const started = await classAt(gym, T0 - 10 * MIN);
    // A place in a class that has already started is history: it stays.
    await sql`
      INSERT INTO gym_class_bookings (gym_id, session_id, user_id, entry_id, held_membership_id, status, pack_charged, request_key, booked_at)
      VALUES (${gym.id}, ${started}, ${sam.userId}, ${sam.entryId}, ${packs.get(sam.userId) ?? ""}, 'booked', true, gen_random_uuid(), now())`;
    await book(gym, sam, full);
    await book(gym, sam, open);
    await book(gym, tia, open);
    await book(gym, leo, open);
    expect((await book(gym, maya, full, true)).mine?.status).toBe("waitlisted");
    expect([await classesLeft(packs.get(sam.userId)), await classesLeft(packs.get(maya.userId))]).toEqual([8, 10]);

    // One record, from the person's page.
    const one = await inject("DELETE", `/v1/orgs/${gym.id}/member-list/entries/${sam.entryId}`, gym.owner.cookies);
    expect(one.statusCode, one.body).toBe(200);
    expect([await formerOf(gym, sam.entryId), await inApp(gym, sam)]).toEqual([true, true]);
    expect([await placeOf(full, sam), await placeOf(open, sam), await placeOf(started, sam)]).toEqual([
      ["cancelled", false],
      ["cancelled", false],
      ["booked", true],
    ]);
    expect(await classesLeft(packs.get(sam.userId))).toBe(10);
    // Maya has the place Sam held, and her pack paid for it; nobody else's booking moved.
    expect([await placeOf(full, maya), await classesLeft(packs.get(maya.userId))]).toEqual([["booked", true], 9]);
    expect([await placeOf(open, tia), await placeOf(open, leo)]).toEqual([
      ["booked", true],
      ["booked", true],
    ]);

    // Several records ticked on the list.
    const selection = { kind: "ticked", entryIds: [tia.entryId] };
    const preview = await inject("POST", `/v1/orgs/${gym.id}/member-list/selected/remove-preview`, gym.owner.cookies, { selection });
    expect(preview.statusCode, preview.body).toBe(200);
    const digest = (JSON.parse(preview.body) as { preview: { digest: string } }).preview.digest;
    const many = await inject("POST", `/v1/orgs/${gym.id}/member-list/selected/remove`, gym.owner.cookies, { selection, digest });
    expect(many.statusCode, many.body).toBe(200);
    expect([await formerOf(gym, tia.entryId), await inApp(gym, tia), await placeOf(open, tia), await classesLeft(packs.get(tia.userId))]).toEqual([true, true, ["cancelled", false], 10]);
    expect([await placeOf(open, leo), await classesLeft(packs.get(leo.userId))]).toEqual([["booked", true], 9]);
  });

  it("people who are not the gym's staff cannot use up the address its staff share, on Classes or on Memberships", async () => {
    clock = T0;
    const gym = await makeGym("Desk House");
    const elsewhere = await makeGym("Next Door");
    // The address's count lasts an hour in Redis, so each run has an address of its own.
    const part = (): string => String(1 + Math.floor(Math.random() * 250));
    const desk = `10.94.${part()}.${part()}`;
    const trainer = await staff(gym, "Tia Desk", "trainer");
    const maya = await member(gym, "Maya Desk");
    // Ten of them, 100 requests each a route: nobody passes their own 300 an hour or the
    // app's 600 a minute, and together they pass the address's 900.
    const strangers = [await member(elsewhere, "Bob Elsewhere"), maya, elsewhere.owner];
    while (strangers.length < 10) strangers.push(await signedIn(`No Gym ${String(strangers.length)}`));
    const urls = [`/v1/orgs/${gym.id}/classes`, `/v1/orgs/${gym.id}/membership-types`];
    const heldUrl = `/v1/orgs/${gym.id}/member-list/entries/${maya.entryId}/memberships`;

    // 1,000 from one address on each limit: every one is the service's own answer.
    for (const who of strangers) {
      for (const path of urls) {
        const answers = await Promise.all(Array.from({ length: 100 }, () => inject("GET", path, who.cookies, undefined, { ip: desk })));
        expect([...new Set(answers.map((res) => res.statusCode))]).toEqual([404]);
      }
      const answers = await Promise.all(Array.from({ length: 100 }, () => inject("POST", heldUrl, who.cookies, {}, { ip: desk })));
      expect([...new Set(answers.map((res) => res.statusCode))]).toEqual([400]);
    }

    // The gym's own staff, at that address, on both servers.
    for (const target of [api(), other()]) {
      for (const path of urls) expect((await inject("GET", path, gym.owner.cookies, undefined, { ip: desk, target })).statusCode).toBe(200);
      expect((await inject("GET", `/v1/orgs/${gym.id}/membership-types`, trainer.cookies, undefined, { ip: desk, target })).statusCode).toBe(200);
      const held = await inject("POST", heldUrl, gym.owner.cookies, {}, { ip: desk, target });
      expect(held.statusCode, held.body).toBe(400);
    }

    // The limit is still asked of staff: one of them past their own 300 is told to wait.
    const own = await Promise.all(Array.from({ length: 310 }, () => inject("GET", `/v1/orgs/${gym.id}/classes`, trainer.cookies, undefined, { ip: `10.95.${part()}.${part()}` })));
    const codes = own.map((res) => res.statusCode);
    expect([codes.filter((code) => code === 429).length > 0, codes.every((code) => code === 429 || code === 403)]).toEqual([true, true]);
  });

  it("the zero character and a day in year 9999 are refused with a 400, never a 500", async () => {
    clock = T0;
    const gym = await makeGym("Edges House");
    const maya = await member(gym, "Maya Edges");
    const zero = String.fromCharCode(0);
    const classBody = { name: "Yoga", minutes: 45, colour: "blue" };
    const asOwner = (method: "GET" | "POST" | "PUT", path: string, body?: unknown) => inject(method, `/v1/orgs/${gym.id}${path}`, gym.owner.cookies, body);
    const answers = [
      await asOwner("POST", "/classes", { ...classBody, name: `Yo${zero}ga` }),
      await asOwner("POST", "/classes", { ...classBody, description: `Slow${zero}` }),
      await asOwner("POST", "/classes", { ...classBody, name: `Yoga ${String.fromCodePoint(0x202e)}gnirpS` }),
      await asOwner("POST", "/membership-words/preview", { word: `Act${zero}ive`, typeId: randomUUID() }),
      await asOwner("POST", "/membership-words/unlink", { word: `Act${zero}ive` }),
      await asOwner("GET", "/pt/people?query=a%00b"),
      await asOwner("GET", "/pt/people?day=9999-12-31"),
      await asOwner("POST", "/pt/appointments", { trainerUserId: randomUUID(), entryId: maya.entryId, localDate: "9999-12-20", startMinute: 600, minutes: 60, requestKey: randomUUID() }),
      await inject("POST", `/v1/orgs/${gym.id}/member-pt/sessions`, maya.cookies, { trainerUserId: randomUUID(), localDate: "9999-12-31", startMinute: 600, minutes: 60, requestKey: randomUUID() }),
    ];
    expect(answers.map((res) => res.statusCode)).toEqual(answers.map(() => 400));
    const made = await asOwner("POST", "/classes", { ...classBody, description: "Slow flow.\nBring a mat." });
    expect(made.statusCode, made.body).toBe(201);
  });

  /** Holds the gym's lock, as another request's write would, until `release` is called. */
  const holdLock = async (gym: Gym): Promise<{ release: () => Promise<void> }> => {
    let open: () => void = () => undefined;
    const until = new Promise<void>((resolve) => {
      open = resolve;
    });
    let held: () => void = () => undefined;
    const locked = new Promise<void>((resolve) => {
      held = resolve;
    });
    const done = sql.begin(async (tx) => {
      await tx`SELECT 1 FROM gyms WHERE id = ${gym.id} FOR UPDATE`;
      held();
      await until;
    });
    await locked;
    return {
      release: async () => {
        open();
        await done;
      },
    };
  };
  const waitingForLock = async (): Promise<void> => {
    for (let tries = 0; tries < 200; tries++) {
      const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%FROM gyms WHERE id%FOR UPDATE%'`;
      if ((row?.n ?? 0) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("no request ever waited for the gym's lock");
  };

  it("a class that starts while staff's request waits for the gym's lock is a started class: nothing is cancelled, removed or given back", async () => {
    clock = T0;
    const gym = await makeGym("Lock House");
    const maya = await member(gym, "Maya Lock");
    const packs = await packFor(gym, [maya]);
    const cls = await classAt(gym, T0 + 2000);
    await sql`
      INSERT INTO gym_class_bookings (gym_id, session_id, user_id, entry_id, held_membership_id, status, pack_charged, request_key, booked_at)
      VALUES (${gym.id}, ${cls}, ${maya.userId}, ${maya.entryId}, ${packs.get(maya.userId) ?? ""}, 'booked', true, gen_random_uuid(), now())`;
    const [type] = await sql<{ class_type_id: string }[]>`SELECT class_type_id FROM gym_class_sessions WHERE id = ${cls}`;
    const typeId = type?.class_type_id ?? "";
    const stillThere = async (): Promise<unknown[]> => {
      const [row] = await sql<{ status: string; archived: boolean }[]>`
        SELECT s.status, t.archived_at IS NOT NULL AS archived
        FROM gym_class_sessions s JOIN gym_class_types t ON t.id = s.class_type_id WHERE s.id = ${cls}`;
      return [row?.status, row?.archived, await placeOf(cls, maya)];
    };

    const cancelUrl = `/v1/orgs/${gym.id}/class-sessions/${cls}/cancel`;
    const asked = await inject("POST", cancelUrl, gym.owner.cookies, {});
    expect(no(asked), asked.body).toBe("409 class_has_bookings");
    const mark = (JSON.parse(asked.body) as { ending: { mark: string } }).ending.mark;
    for (const send of [
      () => inject("POST", cancelUrl, gym.owner.cookies, { confirmBookings: mark }),
      () => inject("DELETE", `/v1/orgs/${gym.id}/classes/${typeId}?confirmBookings=${mark}`, gym.owner.cookies),
    ]) {
      clock = T0;
      const lock = await holdLock(gym);
      const answer = send();
      try {
        await waitingForLock();
        clock = T0 + 5000;
      } finally {
        await lock.release();
      }
      const res = await answer;
      // Removing a class leaves a started date on the calendar and takes no booking with it.
      expect([200, 409]).toContain(res.statusCode);
      expect(await stillThere(), res.body).toEqual(["scheduled", res.statusCode === 200, ["booked", true]]);
    }
    expect(await classesLeft(packs.get(maya.userId))).toBe(10);
  });

  it("Add class arriving twice makes one class, and a name another class has is refused when adding, renaming and bringing back", async () => {
    clock = T0;
    const gym = await makeGym("Names House");
    const body = (name: string) => ({ name, minutes: 45, colour: "blue" });
    const add = (name: string, target = api()) => inject("POST", `/v1/orgs/${gym.id}/classes`, gym.owner.cookies, body(name), { target });
    const twice = await Promise.all([add("Pilates"), add("Pilates", other()), add("pilates"), add("PILATES", other())]);
    expect(twice.map((res) => res.statusCode).sort()).toEqual([201, 409, 409, 409]);
    expect(twice.filter((res) => res.statusCode === 409).map(errorOf)).toEqual(["class_name_taken", "class_name_taken", "class_name_taken"]);
    const live = async (): Promise<string[]> =>
      (await sql<{ name: string }[]>`SELECT name FROM gym_class_types WHERE gym_id = ${gym.id} AND archived_at IS NULL ORDER BY name`).map((r) => r.name);
    expect((await live()).map((name) => name.toLowerCase())).toEqual(["pilates"]);

    expect((await add("Yoga")).statusCode).toBe(201);
    const idOf = async (name: string): Promise<string> =>
      (await sql<{ id: string }[]>`SELECT id FROM gym_class_types WHERE gym_id = ${gym.id} AND lower(name) = lower(${name}) ORDER BY created_at LIMIT 1`)[0]?.id ?? "";
    const yoga = await idOf("Yoga");
    const rename = (name: string) => inject("PUT", `/v1/orgs/${gym.id}/classes/${yoga}`, gym.owner.cookies, body(name));
    expect(no(await rename("PILATES"))).toBe("409 class_name_taken");
    // Its own name in other capitals, and a new one, are its own to take.
    expect((await rename("YOGA")).statusCode).toBe(200);
    expect((await rename("Flow")).statusCode).toBe(200);

    // Archived, its name is free; brought back while another class has it, it is refused.
    expect((await inject("DELETE", `/v1/orgs/${gym.id}/classes/${yoga}`, gym.owner.cookies)).statusCode).toBe(200);
    expect((await add("Flow")).statusCode).toBe(201);
    expect(no(await inject("POST", `/v1/orgs/${gym.id}/classes/${yoga}/restore`, gym.owner.cookies))).toBe("409 class_name_taken");
    expect(await live()).toHaveLength(2);

    // Another gym's class of that name is no business of this one.
    const elsewhere = await makeGym("Names Next Door");
    expect((await inject("POST", `/v1/orgs/${elsewhere.id}/classes`, elsewhere.owner.cookies, body("Pilates"))).statusCode).toBe(201);
  });

  const typeBody = (over: Record<string, unknown>) => ({
    name: "Gold Monthly",
    description: null,
    kind: "recurring",
    priceMinor: 4999,
    termCount: 1,
    termUnit: "month",
    packClasses: null,
    packDays: null,
    access: "all_classes",
    bookingsLimit: null,
    bookingsPeriod: null,
    classTypeIds: null,
    includesPt: false,
    ptLimit: null,
    ptPeriod: null,
    ...over,
  });
  const addType = async (gym: Gym, over: Record<string, unknown> = {}): Promise<string> => {
    const body = typeBody(over);
    const res = await inject("POST", `/v1/orgs/${gym.id}/membership-types`, gym.owner.cookies, body);
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { types: { id: string; name: string }[] }).types.find((t) => t.name === body.name)?.id ?? "";
  };
  const addRecord = async (gym: Gym, fullName: string): Promise<string> => {
    const res = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName, email: `sellsfix-l-${uniq()}@example.com` });
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
  };
  const heldUrl = (gym: Gym, entryId: string) => `/v1/orgs/${gym.id}/member-list/entries/${entryId}/memberships`;
  const todayOf = async (gym: Gym, entryId: string): Promise<string> =>
    (JSON.parse((await inject("GET", heldUrl(gym, entryId), gym.owner.cookies)).body) as { today: string }).today;
  const give = (gym: Gym, entryId: string, typeId: string, startsOn: string, by: Person = gym.owner, target = api()) =>
    inject("POST", heldUrl(gym, entryId), by.cookies, { requestKey: randomUUID(), typeId, startsOn, paid: false }, { target });
  const running = async (gym: Gym, entryId: string, typeId: string): Promise<number> =>
    (await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM gym_held_memberships
      WHERE gym_id = ${gym.id} AND entry_id = ${entryId} AND membership_type_id = ${typeId} AND status IN ('active','frozen')`)[0]?.n ?? 0;
  const plusDays = (day: string, days: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

  it("one person is given a membership once, whoever presses Add and however often; a class pack and a later term are still theirs to buy", async () => {
    clock = T0;
    const gym = await makeGym("Twice House");
    const desk = await staff(gym, "Dee Desk", "manager");
    const gold = await addType(gym);
    const month = await addType(gym, { name: "One month", kind: "one_time" });
    const tenPack = await addType(gym, { name: "10 classes", kind: "pack", termCount: null, termUnit: null, packClasses: 10, packDays: 60 });
    const olivia = await addRecord(gym, "Olivia Twice");
    const noah = await addRecord(gym, "Noah Other");
    const today = await todayOf(gym, olivia);

    // Two staff, two servers, each press with a key of its own.
    const presses = await Promise.all([
      give(gym, olivia, gold, today),
      give(gym, olivia, gold, today, desk, other()),
      give(gym, olivia, gold, today, gym.owner, other()),
      give(gym, olivia, gold, today, desk),
    ]);
    expect(presses.map((res) => res.statusCode).sort()).toEqual([201, 409, 409, 409]);
    expect([...new Set(presses.filter((res) => res.statusCode === 409).map(errorOf))]).toEqual(["membership_already_held"]);
    const later = await give(gym, olivia, gold, plusDays(today, 20));
    expect([later.statusCode, (JSON.parse(later.body) as { message: string }).message]).toEqual([
      409,
      // It renews, so no start date is after it: the sentence offers none.
      "They already have Gold Monthly. Cancel that one first.",
    ]);
    expect(await running(gym, olivia, gold)).toBe(1);
    // Somebody else's Gold Monthly is no reason to refuse Noah his.
    expect((await give(gym, noah, gold, today)).statusCode).toBe(201);

    // A one-month membership: not a second one over the same days, and the next month is fine.
    expect((await give(gym, olivia, month, today)).statusCode).toBe(201);
    const inside = await give(gym, olivia, month, plusDays(today, 10));
    expect([inside.statusCode, (JSON.parse(inside.body) as { message: string }).message]).toEqual([
      409,
      "They already have One month. Cancel that one first, or pick a start date after it ends.",
    ]);
    expect((await give(gym, olivia, month, plusDays(today, 45))).statusCode).toBe(201);
    expect(await running(gym, olivia, month)).toBe(2);

    // A second pack before the first runs out is an ordinary sale.
    expect((await give(gym, olivia, tenPack, today)).statusCode).toBe(201);
    expect((await give(gym, olivia, tenPack, today)).statusCode).toBe(201);

    // Cancelled, the type can be given again.
    const [goldRow] = await sql<{ id: string }[]>`SELECT id FROM gym_held_memberships WHERE gym_id = ${gym.id} AND entry_id = ${olivia} AND membership_type_id = ${gold}`;
    const cancelled = await inject("POST", `${heldUrl(gym, olivia)}/${goldRow?.id ?? ""}/cancel`, gym.owner.cookies, { when: "today" });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect((await give(gym, olivia, gold, today)).statusCode).toBe(201);
    expect(await running(gym, olivia, gold)).toBe(1);
  });

  it("a box that named two people is confirmed for those two bookings and no others: the same number of different people is asked again", async () => {
    clock = T0;
    const gym = await makeGym("Box House");
    const maya = await member(gym, "Maya Box");
    const leo = await member(gym, "Leo Box");
    const tom = await member(gym, "Tom Box");
    const gold = await addType(gym);
    const cls = await classAt(gym, T0 + 2 * DAY);
    const today = await todayOf(gym, maya.entryId);
    for (const who of [maya, leo, tom]) expect((await give(gym, who.entryId, gold, today)).statusCode).toBe(201);
    const cancelUrl = `/v1/orgs/${gym.id}/class-sessions/${cls}/cancel`;
    const ask = async (body: Record<string, unknown>): Promise<{ booked: number; mark: string; names: string[] }> => {
      const res = await inject("POST", cancelUrl, gym.owner.cookies, body);
      expect(no(res), res.body).toBe("409 class_has_bookings");
      const ending = (JSON.parse(res.body) as { ending: { booked: number; mark: string; people: { name: string }[] } }).ending;
      return { booked: ending.booked, mark: ending.mark, names: ending.people.map((p) => p.name).sort() };
    };
    await book(gym, maya, cls);
    await book(gym, leo, cls);
    const first = await ask({});
    expect([first.booked, first.names]).toEqual([2, ["Leo Box", "Maya Box"]]);
    // The same bookings read again have the same mark.
    expect((await ask({})).mark).toBe(first.mark);

    // Between the box and its button Leo cancels and Tom books: still two.
    expect((await cancel(gym, leo, cls)).statusCode).toBe(200);
    await book(gym, tom, cls);
    const second = await ask({ confirmBookings: first.mark });
    expect([second.booked, second.names, second.mark === first.mark]).toEqual([2, ["Maya Box", "Tom Box"], false]);
    expect([await statusOf(cls, tom), await statusOf(cls, maya)]).toEqual(["booked", "booked"]);
    // A count is no longer an answer.
    expect((await inject("POST", cancelUrl, gym.owner.cookies, { confirmBookings: 2 })).statusCode).toBe(400);
    expect(await statusOf(cls, tom)).toBe("booked");

    // The same hole on a membership's cancel: the box named one class, and by the button it is another.
    const [held] = await sql<{ id: string }[]>`SELECT id FROM gym_held_memberships WHERE gym_id = ${gym.id} AND entry_id = ${maya.entryId}`;
    const heldCancel = (body: Record<string, unknown>) => inject("POST", `${heldUrl(gym, maya.entryId)}/${held?.id ?? ""}/cancel`, gym.owner.cookies, { when: "today", ...body });
    const heldAsk = async (body: Record<string, unknown>): Promise<string> => {
      const res = await heldCancel(body);
      expect(no(res), res.body).toBe("409 membership_has_bookings");
      return (JSON.parse(res.body) as { ending: { mark: string } }).ending.mark;
    };
    const one = await heldAsk({});
    const otherClass = await classAt(gym, T0 + 3 * DAY);
    expect((await cancel(gym, maya, cls)).statusCode).toBe(200);
    await book(gym, maya, otherClass);
    const two = await heldAsk({ confirmBookings: one });
    expect(two === one).toBe(false);
    expect(await statusOf(otherClass, maya)).toBe("booked");
    expect((await heldCancel({ confirmBookings: two })).statusCode).toBe(200);
    expect(await statusOf(otherClass, maya)).toBe("cancelled");

    // The right mark ends exactly the bookings it names.
    const done = await inject("POST", cancelUrl, gym.owner.cookies, { confirmBookings: (await ask({})).mark });
    expect(done.statusCode, done.body).toBe(200);
    expect(await statusOf(cls, tom)).toBe("cancelled");
  });

  it("two records are not merged while that would leave one person with a membership twice or with two trainers at one time", async () => {
    clock = T0;
    const gym = await makeGym("Merge House");
    const sam = await staff(gym, "Sam Trainer", "trainer");
    const tia = await staff(gym, "Tia Trainer", "trainer");
    const gold = await addType(gym);
    const first = await addRecord(gym, "Olivia Brown");
    const second = await addRecord(gym, "Liv Brown");
    const today = await todayOf(gym, first);
    const merge = (goneId: string, keepId: string) =>
      inject("POST", `/v1/orgs/${gym.id}/member-list/entries/${goneId}/merge`, gym.owner.cookies, { keepEntryId: keepId, acknowledgeLeavesList: true });
    const session = async (entryId: string, trainer: Person, startsAt: number, status = "booked"): Promise<string> => {
      const at = new Date(startsAt);
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO gym_pt_appointments (gym_id, trainer_user_id, entry_id, local_date, local_start_minute, starts_at, ends_at, minutes, status, request_key, cancelled_at)
        SELECT ${gym.id}, ${trainer.userId}, ${entryId}, l::date, (EXTRACT(HOUR FROM l) * 60 + EXTRACT(MINUTE FROM l))::int, ${at}, ${new Date(startsAt + HOUR)}, 60,
               ${status}, gen_random_uuid(), ${status === "cancelled" ? at : null}
        FROM (SELECT ${at}::timestamptz AT TIME ZONE 'Europe/London' AS l) x
        RETURNING id`;
      return row?.id ?? "";
    };
    const both = async (): Promise<number> =>
      (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_member_list_entries WHERE gym_id = ${gym.id} AND id IN (${first}, ${second})`)[0]?.n ?? 0;

    // The same membership running on both.
    expect((await give(gym, first, gold, today)).statusCode).toBe(201);
    expect((await give(gym, second, gold, today)).statusCode).toBe(201);
    for (const [gone, keep] of [[first, second], [second, first]] as const) {
      const res = await merge(gone, keep);
      expect([res.statusCode, (JSON.parse(res.body) as { message: string }).message]).toEqual([409, "Both records have Gold Monthly. Cancel it on one of them first, then merge."]);
    }
    expect([await both(), await running(gym, first, gold), await running(gym, second, gold)]).toEqual([2, 1, 1]);
    const [held] = await sql<{ id: string }[]>`SELECT id FROM gym_held_memberships WHERE gym_id = ${gym.id} AND entry_id = ${second}`;
    expect((await inject("POST", `${heldUrl(gym, second)}/${held?.id ?? ""}/cancel`, gym.owner.cookies, { when: "today" })).statusCode).toBe(200);

    // Sessions with two trainers that overlap by half an hour.
    const at = T0 + 3 * DAY;
    await session(first, sam, at);
    const clash = await session(second, tia, at + 30 * MIN);
    expect(no(await merge(second, first))).toBe("409 merge_sessions_overlap");
    expect(no(await merge(first, second))).toBe("409 merge_sessions_overlap");
    expect(await both()).toBe(2);

    // That session cancelled, and one straight after the other is no clash: merged, with everything on the kept record.
    await sql`UPDATE gym_pt_appointments SET status = 'cancelled', cancelled_at = now() WHERE id = ${clash}`;
    await session(second, tia, at + HOUR);
    const done = await merge(second, first);
    expect(done.statusCode, done.body).toBe(200);
    const [after] = await sql<{ sessions: number; memberships: number }[]>`
      SELECT (SELECT count(*)::int FROM gym_pt_appointments WHERE gym_id = ${gym.id} AND entry_id = ${first}) AS sessions,
             (SELECT count(*)::int FROM gym_held_memberships WHERE gym_id = ${gym.id} AND entry_id = ${first}) AS memberships`;
    expect([await both(), after?.sessions, after?.memberships, await running(gym, first, gold)]).toEqual([1, 3, 2, 1]);
  });
});
