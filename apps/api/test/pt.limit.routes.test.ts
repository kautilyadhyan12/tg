// A LIMIT ON PERSONAL TRAINING SESSIONS ON A MEMBERSHIP — the routes against real Postgres
// (DATABASE_URL-gated), on two api instances over one database. Spec Part 3 §13.5;
// ROADMAP 17e-v.
//
// The worst thing this job could do to a real person: refuse a member a session they paid
// for, because somebody else's sessions, or their own freely cancelled ones, were counted
// against them; or the other way, book sessions the gym never sold. That is the first test.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { ptLimitUsedWords, type GymMembershipType, type MemberPtResponse, type MemberPtSession, type PtPeopleResponse, type PtWeekResponse } from "@app/shared";
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
  JWT_SECRET: "personal-training-limit-secret-01234567", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 180_000;
const LIVE_PLAN = "zz_ptl_live";
/** Wednesday 7 October 2026, 07:30 in London (summer time, one hour ahead of UTC). Its
 *  week is Monday 5 to Sunday 11 October. */
const NOW = new Date("2026-10-07T06:30:00Z");
const THU = "2026-10-08";
const FRI = "2026-10-09";
const SAT = "2026-10-10";
const SUN = "2026-10-11";
const NEXT_MON = "2026-10-12";

let ipCounter = 0;
const nextIp = () => `10.80.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
const redisUrl = process.env["TEST_REDIS_URL"];
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("a limit on personal training sessions (real Postgres, two api instances)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let clock = NOW.getTime();
  let app: App | undefined;
  let second: App | undefined;
  let redis: RedisLike | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'ptl-t-%@example.com')`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_pt_appointments WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_trainers WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'ptl-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST" | "PUT", path: string, cookies: Cookies, payload?: unknown, target = api()) =>
    target.inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });

  interface Person {
    userId: string;
    cookies: Cookies;
    name: string;
  }
  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `ptl-t-${uniq()}@example.com`;
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
  const makeGym = async (name: string, timezone = "Europe/London"): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await inject("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Leeds", country: "GB", timezone });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return { id, owner };
  };
  type Member = Person & { entryId: string };
  /** A member of the app whose record is on the gym's list: what a session hangs on. */
  const member = async (gym: Gym, name: string): Promise<Member> => {
    const person = await signedIn(name);
    await sql`INSERT INTO gym_members (gym_id, user_id, joined_at) VALUES (${gym.id}, ${person.userId}, '2026-01-01T00:00:00Z')`;
    const res = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName: name, email: `ptl-l-${uniq()}@example.com` });
    expect(res.statusCode, res.body).toBe(201);
    const entryId = (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
    await sql`UPDATE gym_members SET entry_id = ${entryId} WHERE gym_id = ${gym.id} AND user_id = ${person.userId}`;
    return { ...person, entryId };
  };

  /** Somebody on the gym's list with no app: their record's id. */
  const listedOnly = async (gym: Gym, name: string): Promise<string> => {
    const res = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName: name, email: `ptl-l-${uniq()}@example.com` });
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
  };

  /** 09:00 to 13:00 every day, in sessions of an hour: 09:00, 10:00, 11:00 and 12:00. */
  const EVERY_MORNING = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, fromMinute: 540, toMinute: 780 }));
  const trainerWith = async (gym: Gym, name: string, hours: object[] = EVERY_MORNING): Promise<Person> => {
    const person = await signedIn(name);
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${person.userId}, 'trainer', ${null})`;
    const res = await inject("PUT", `/v1/orgs/${gym.id}/pt/trainers/${person.userId}`, gym.owner.cookies, { offers: true, sessionMinutes: 60, hours });
    expect(res.statusCode, res.body).toBe(200);
    return person;
  };

  // ── The price list, through its own routes: the limit is set the way a gym sets it ──
  type Limit = { ptLimit: number; ptPeriod: "week" | "month" } | { ptLimit: null; ptPeriod: null };
  const NO_LIMIT: Limit = { ptLimit: null, ptPeriod: null };
  const typesUrl = (gym: Gym) => `/v1/orgs/${gym.id}/membership-types`;
  const monthlyBody = (name: string, limit: Limit) => ({
    name,
    description: null,
    kind: "recurring",
    priceMinor: 4000,
    termCount: 1,
    termUnit: "month",
    packClasses: null,
    packDays: null,
    access: "all_classes",
    bookingsLimit: null,
    bookingsPeriod: null,
    classTypeIds: null,
    includesPt: true,
    ...limit,
  });
  const typeNamed = async (gym: Gym, name: string, by = gym.owner): Promise<GymMembershipType> => {
    const res = await inject("GET", typesUrl(gym), by.cookies);
    expect(res.statusCode, res.body).toBe(200);
    const type = (JSON.parse(res.body) as { types: GymMembershipType[] }).types.find((t) => t.name === name);
    if (type === undefined) throw new Error(`no type named ${name}`);
    return type;
  };
  /** A monthly membership that includes personal training, with this limit. */
  const sell = async (gym: Gym, name: string, limit: Limit): Promise<string> => {
    const res = await inject("POST", typesUrl(gym), gym.owner.cookies, monthlyBody(name, limit));
    expect(res.statusCode, res.body).toBe(201);
    return (await typeNamed(gym, name)).id;
  };
  const sellPack = async (gym: Gym, name: string): Promise<string> => {
    const res = await inject("POST", typesUrl(gym), gym.owner.cookies, {
      ...monthlyBody(name, NO_LIMIT),
      kind: "pack",
      termCount: null,
      termUnit: null,
      packClasses: 10,
      packDays: 60,
    });
    expect(res.statusCode, res.body).toBe(201);
    return (await typeNamed(gym, name)).id;
  };
  const changeLimit = async (gym: Gym, name: string, limit: Limit, by = gym.owner) => {
    const type = await typeNamed(gym, name);
    return await inject("PUT", `${typesUrl(gym)}/${type.id}`, by.cookies, { ...monthlyBody(name, limit), updatedAt: type.updatedAt });
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
  const packLeft = async (heldId: string): Promise<number | null> => {
    const [row] = await sql<{ classes_left: number | null }[]>`SELECT classes_left FROM gym_held_memberships WHERE id = ${heldId}`;
    if (row === undefined) throw new Error("no membership");
    return row.classes_left;
  };

  // ── The member's routes ──
  const read = async (gym: Gym, who: Person): Promise<MemberPtResponse> => {
    const res = await inject("GET", `/v1/orgs/${gym.id}/member-pt?week=0`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as MemberPtResponse;
  };
  const dayOf = async (gym: Gym, who: Person, day: string) => {
    const found = (await read(gym, who)).days.find((x) => x.localDate === day);
    if (found === undefined) throw new Error(`no ${day} in the read`);
    return found;
  };
  const book = (gym: Gym, who: Person, trainer: Person, day: string, minute: number, opts: { key?: string; target?: App } = {}) =>
    inject(
      "POST",
      `/v1/orgs/${gym.id}/member-pt/sessions`,
      who.cookies,
      { requestKey: opts.key ?? randomUUID(), trainerId: trainer.userId, localDate: day, startMinute: minute, minutes: 60 },
      opts.target ?? api(),
    );
  const cancel = (gym: Gym, who: Person, id: string, lateOk = false) =>
    inject("POST", `/v1/orgs/${gym.id}/member-pt/sessions/${id}/cancel`, who.cookies, { lateOk });
  const made = (res: { statusCode: number; body: string }): MemberPtSession => {
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { session: MemberPtSession }).session;
  };
  const said = (res: { statusCode: number; body: string }): [number, string, string] => {
    const body = JSON.parse(res.body) as { error: string; message: string };
    return [res.statusCode, body.error, body.message];
  };

  // ── Staff ──
  const staffBook = (gym: Gym, trainer: Person, entryId: string, day: string, minute: number, target = api()) =>
    inject(
      "POST",
      `/v1/orgs/${gym.id}/pt/appointments`,
      gym.owner.cookies,
      { requestKey: randomUUID(), trainerId: trainer.userId, entryId, localDate: day, startMinute: minute, minutes: 60 },
      target,
    );
  /** One session as the console's week draws it. */
  const onWeek = async (gym: Gym, trainer: Person, day: string, id: string) => {
    const res = await inject("GET", `/v1/orgs/${gym.id}/pt/week?trainer=${trainer.userId}&from=${day}`, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    const found = (JSON.parse(res.body) as PtWeekResponse).days.flatMap((d) => d.appointments).find((a) => a.id === id);
    if (found === undefined) throw new Error("the session is not on the week");
    return found;
  };
  const staffMade = (res: { statusCode: number; body: string }): string => {
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { appointment: { id: string } }).appointment.id;
  };
  const staffCancel = (gym: Gym, id: string, over: { lateOk?: boolean; giveBack?: boolean } = {}) =>
    inject("POST", `/v1/orgs/${gym.id}/pt/appointments/${id}/cancel`, gym.owner.cookies, { lateOk: over.lateOk ?? false, giveBack: over.giveBack ?? false });
  const picker = async (gym: Gym, name: string, day: string) => {
    const res = await inject("GET", `/v1/orgs/${gym.id}/pt/people?query=${encodeURIComponent(name)}&day=${day}`, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    const person = (JSON.parse(res.body) as PtPeopleResponse).people.find((p) => p.name === name);
    if (person === undefined) throw new Error(`no ${name} in the picker`);
    return person;
  };
  /** What is left for everybody the picker lists on a day, by name. */
  const pickerLeft = async (gym: Gym, day: string): Promise<Record<string, number | null>> => {
    const res = await inject("GET", `/v1/orgs/${gym.id}/pt/people?day=${day}`, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return Object.fromEntries((JSON.parse(res.body) as PtPeopleResponse).people.map((p) => [p.name, p.limit?.left ?? null]));
  };
  const sessionsOf = (gym: Gym, entryId: string) => sql<{ id: string; status: string; day: string; held_membership_id: string | null; pack_charged: boolean }[]>`
    SELECT id, status, local_date::text AS day, held_membership_id, pack_charged FROM gym_pt_appointments
    WHERE gym_id = ${gym.id} AND entry_id = ${entryId} ORDER BY starts_at, id`;
  const statuses = async (gym: Gym, entryId: string): Promise<string[]> => (await sessionsOf(gym, entryId)).map((r) => `${r.day} ${r.status}`);

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    redis = redisUrl === undefined || redisUrl === "" ? createMemoryRedis() : createIoRedis(redisUrl);
    for (let tries = 0; (await redis.incrWithTtl(`ptl-ready:${randomUUID()}`, 30)) === null; tries++) {
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

  it(
    "THE WORST THING: only a member's own sessions that were not freely cancelled, in the session's own week, count against their limit; and past it nothing is booked",
    async () => {
      const gym = await makeGym("Worst Limit Gym");
      const gold = await sell(gym, "Gold 2 a week", { ptLimit: 2, ptPeriod: "week" });
      const sam = await trainerWith(gym, "Sam Trainer");
      const maya = await member(gym, "Maya Member");
      const noor = await member(gym, "Noor Other");
      await hold(gym, maya.entryId, gold);
      await hold(gym, noor.entryId, gold);
      const full = { membership: "Gold 2 a week", limit: 2, period: "week" };

      try {
        // Noor uses both of HER sessions this week. They are not Maya's.
        made(await book(gym, noor, sam, THU, 600));
        made(await book(gym, noor, sam, FRI, 600));
        expect(await dayOf(gym, noor, SAT)).toMatchObject({ pays: null, why: "limit_week", limit: { ...full, left: 0 } });
        expect(await dayOf(gym, maya, FRI)).toMatchObject({ pays: { membership: "Gold 2 a week", sessionsLeft: null }, why: null, limit: { ...full, left: 2 } });
        // The picker reads both of them at once, and keeps each to their own.
        expect(await pickerLeft(gym, FRI)).toEqual({ "Maya Member": 2, "Noor Other": 0 });

        // Maya's own two, and each is counted once.
        const thursday = made(await book(gym, maya, sam, THU, 540));
        expect((await dayOf(gym, maya, FRI)).limit).toEqual({ ...full, left: 1 });
        const friday = made(await book(gym, maya, sam, FRI, 660));
        expect(await dayOf(gym, maya, SAT)).toMatchObject({ pays: null, why: "limit_week", limit: { ...full, left: 0 } });

        // Past the limit nothing is booked: not by her, and not by staff for her.
        // The refusal names the membership and its number.
        expect(said(await book(gym, maya, sam, SAT, 540))).toEqual([409, "limit_week", "You've used all 2 personal training sessions Gold 2 a week includes for that week."]);
        expect(said(await staffBook(gym, sam, maya.entryId, SUN, 540))).toEqual([409, "limit_week", ptLimitUsedWords({ ...full, period: "week", left: 0 }, false)]);
        expect(await statuses(gym, maya.entryId)).toEqual([`${THU} booked`, `${FRI} booked`]);
        expect((await picker(gym, "Maya Member", SAT)).pt).toBeNull();
        expect((await picker(gym, "Maya Member", SAT)).limit).toEqual({ ...full, left: 0 });

        // Next week is another week: its Monday is hers to book, with both sessions left.
        expect((await dayOf(gym, maya, NEXT_MON)).limit).toEqual({ ...full, left: 2 });
        made(await book(gym, maya, sam, NEXT_MON, 540));
        expect((await dayOf(gym, maya, SAT)).limit).toEqual({ ...full, left: 0 });

        // A free cancel gives the session back to the week.
        expect(made(await cancel(gym, maya, friday.id)).status).toBe("cancelled");
        expect((await dayOf(gym, maya, SAT)).limit).toEqual({ ...full, left: 1 });
        const saturday = made(await book(gym, maya, sam, SAT, 540));
        expect(said(await book(gym, maya, sam, SUN, 540))[1]).toBe("limit_week");

        // A late cancel keeps it used. Thursday 08:00: her 09:00 is inside the two hours.
        clock = new Date("2026-10-08T07:00:00Z").getTime();
        expect((await cancel(gym, maya, thursday.id)).statusCode).toBe(409);
        expect(made(await cancel(gym, maya, thursday.id, true)).status).toBe("late_cancelled");
        expect(await dayOf(gym, maya, SUN)).toMatchObject({ pays: null, why: "limit_week", limit: { ...full, left: 0 } });
        expect(said(await book(gym, maya, sam, SUN, 540))[1]).toBe("limit_week");

        // A session staff call off and give back is not counted.
        expect((await staffCancel(gym, saturday.id, { lateOk: true, giveBack: true })).statusCode).toBe(200);
        expect((await dayOf(gym, maya, SUN)).limit).toEqual({ ...full, left: 1 });
        made(await book(gym, maya, sam, SUN, 540));

        expect(await statuses(gym, maya.entryId)).toEqual([
          `${THU} late_cancelled`,
          `${FRI} cancelled`,
          `${SAT} cancelled`,
          `${SUN} booked`,
          `${NEXT_MON} booked`,
        ]);
        // Nothing of Maya's touched Noor's.
        expect(await statuses(gym, noor.entryId)).toEqual([`${THU} booked`, `${FRI} booked`]);
      } finally {
        clock = NOW.getTime();
      }
    },
    T,
  );

  it("past the limit a pack pays and is charged; with a session back on the membership, the pack is kept", async () => {
    const gym = await makeGym("Pack After Limit");
    const gold = await sell(gym, "Gold 1 a week", { ptLimit: 1, ptPeriod: "week" });
    const pack = await sellPack(gym, "PT 10");
    const sam = await trainerWith(gym, "Sam Trainer");
    const maya = await member(gym, "Maya Member");
    const goldHeld = await hold(gym, maya.entryId, gold);
    const packHeld = await hold(gym, maya.entryId, pack, { pack: 10 });

    const first = made(await book(gym, maya, sam, THU, 540));
    expect(first.packCharged).toBe(false);
    expect(await packLeft(packHeld)).toBe(10);
    // The membership's one session is used: the pack is what pays now, and the page says so.
    // ... and why: the membership's sessions for the week are used.
    const usedUp = { membership: "Gold 1 a week", limit: 1, period: "week", left: 0 };
    expect(await dayOf(gym, maya, FRI)).toMatchObject({ pays: { membership: "PT 10", sessionsLeft: 10 }, why: null, limit: usedUp });
    expect(await picker(gym, "Maya Member", FRI)).toMatchObject({ pt: { membership: "PT 10", sessionsLeft: 10 }, limit: usedUp });
    // Next week the membership pays again, and nothing is said of a pack.
    expect(await dayOf(gym, maya, NEXT_MON)).toMatchObject({ pays: { membership: "Gold 1 a week" }, limit: { ...usedUp, left: 1 } });
    const second = made(await book(gym, maya, sam, FRI, 540));
    expect(second.packCharged).toBe(true);
    expect(await packLeft(packHeld)).toBe(9);
    expect((await sessionsOf(gym, maya.entryId)).map((r) => r.held_membership_id)).toEqual([goldHeld, packHeld]);

    // The membership's session comes back: the next booking is on it, and the pack keeps its 9.
    expect(made(await cancel(gym, maya, first.id)).status).toBe("cancelled");
    expect(made(await book(gym, maya, sam, SAT, 540)).packCharged).toBe(false);
    expect(await packLeft(packHeld)).toBe(9);
  });

  it("a month's limit is the calendar month's, and a week's limit is Monday to Sunday, over a month's end", async () => {
    const gym = await makeGym("Month End Gym");
    const monthly = await sell(gym, "Two a month", { ptLimit: 2, ptPeriod: "month" });
    const weekly = await sell(gym, "One a week", { ptLimit: 1, ptPeriod: "week" });
    const sam = await trainerWith(gym, "Sam Trainer");
    const maya = await member(gym, "Maya Month");
    const walt = await member(gym, "Walt Week");
    await hold(gym, maya.entryId, monthly);
    await hold(gym, walt.entryId, weekly);

    // Saturday 31 October and Sunday 1 November 2026 are one week and two months.
    staffMade(await staffBook(gym, sam, maya.entryId, "2026-10-30", 540));
    staffMade(await staffBook(gym, sam, maya.entryId, "2026-10-31", 540));
    expect(said(await staffBook(gym, sam, maya.entryId, "2026-10-29", 540))).toEqual([
      409,
      "limit_month",
      "This person has used all 2 personal training sessions Two a month includes for that month.",
    ]);
    expect((await picker(gym, "Maya Month", "2026-10-29")).limit).toEqual({ membership: "Two a month", limit: 2, period: "month", left: 0 });
    expect((await picker(gym, "Maya Month", "2026-11-01")).limit).toEqual({ membership: "Two a month", limit: 2, period: "month", left: 2 });
    staffMade(await staffBook(gym, sam, maya.entryId, "2026-11-01", 540));

    staffMade(await staffBook(gym, sam, walt.entryId, "2026-10-31", 600));
    expect(said(await staffBook(gym, sam, walt.entryId, "2026-11-01", 600))[1]).toBe("limit_week");
    expect(said(await staffBook(gym, sam, walt.entryId, "2026-10-26", 600))[1]).toBe("limit_week");
    staffMade(await staffBook(gym, sam, walt.entryId, "2026-11-02", 600));
    staffMade(await staffBook(gym, sam, walt.entryId, "2026-10-25", 600));
  });

  it(
    "a late cancel by staff: the console is told the session counts against a limit, and staff choose whether it stays used or is given back",
    async () => {
      const gym = await makeGym("Late Cancel Gym");
      const gold = await sell(gym, "Gold 1 a week", { ptLimit: 1, ptPeriod: "week" });
      const plain = await sell(gym, "Platinum", NO_LIMIT);
      const sam = await trainerWith(gym, "Sam Trainer");
      const maya = await member(gym, "Maya Member");
      const noor = await member(gym, "Noor Other");
      const pat = await member(gym, "Pat Plain");
      await hold(gym, maya.entryId, gold);
      await hold(gym, noor.entryId, gold);
      await hold(gym, pat.entryId, plain);
      try {
        const mayas = staffMade(await staffBook(gym, sam, maya.entryId, THU, 540));
        const noors = staffMade(await staffBook(gym, sam, noor.entryId, THU, 600));
        const pats = staffMade(await staffBook(gym, sam, pat.entryId, THU, 660));
        // Thursday 08:30: the 09:00 and the 10:00 are inside the two hours.
        clock = new Date("2026-10-08T07:30:00Z").getTime();
        expect(await onWeek(gym, sam, THU, mayas)).toMatchObject({ cancel: "late", packCharged: false, usesLimit: true });
        expect(await onWeek(gym, sam, THU, noors)).toMatchObject({ cancel: "late", packCharged: false, usesLimit: true });
        // A membership with no limit has nothing to keep used.
        expect(await onWeek(gym, sam, THU, pats)).toMatchObject({ packCharged: false, usesLimit: false });
        // The member's own read says the same of hers.
        expect((await read(gym, maya)).sessions[0]).toMatchObject({ id: mayas, cancel: "late", usesLimit: true });

        // "Late cancel: the session stays used": it still counts, and no more is booked that week.
        expect((await staffCancel(gym, mayas, { lateOk: true, giveBack: false })).statusCode).toBe(200);
        expect((await picker(gym, "Maya Member", FRI)).limit).toMatchObject({ left: 0 });
        expect(said(await staffBook(gym, sam, maya.entryId, FRI, 540))[1]).toBe("limit_week");
        // "Cancel and give the session back": the gym called it off, and the week has it again.
        expect((await staffCancel(gym, noors, { lateOk: true, giveBack: true })).statusCode).toBe(200);
        expect((await picker(gym, "Noor Other", FRI)).limit).toMatchObject({ left: 1 });
        staffMade(await staffBook(gym, sam, noor.entryId, FRI, 600));
      } finally {
        clock = NOW.getTime();
      }
    },
    T,
  );

  it("the week and the month are the GYM'S days: a Sunday afternoon in Honolulu is Monday in UTC, and still that Sunday's week", async () => {
    // 07 Oct 06:30 UTC is Tuesday 6 October, 20:30 in Honolulu (ten hours behind, no summer time).
    const gym = await makeGym("Honolulu Gym", "Pacific/Honolulu");
    const gold = await sell(gym, "Gold 1 a week", { ptLimit: 1, ptPeriod: "week" });
    const afternoons = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, fromMinute: 900, toMinute: 1020 }));
    const sam = await trainerWith(gym, "Sam Trainer", afternoons);
    const kai = await listedOnly(gym, "Kai Member");
    await hold(gym, kai, gold);

    // Sunday 11 October 15:00 there is Monday 12 October 01:00 UTC.
    const sunday = staffMade(await staffBook(gym, sam, kai, SUN, 900));
    const [row] = await sql<{ starts_at: Date; day: string }[]>`SELECT starts_at, local_date::text AS day FROM gym_pt_appointments WHERE id = ${sunday}`;
    expect([row?.starts_at.toISOString(), row?.day]).toEqual(["2026-10-12T01:00:00.000Z", SUN]);
    // It is counted in the week of the gym's Sunday: Saturday is refused, Monday is another week.
    expect(said(await staffBook(gym, sam, kai, SAT, 900))[1]).toBe("limit_week");
    expect((await picker(gym, "Kai Member", SAT)).limit).toMatchObject({ left: 0 });
    expect((await picker(gym, "Kai Member", NEXT_MON)).limit).toMatchObject({ left: 1 });
    staffMade(await staffBook(gym, sam, kai, NEXT_MON, 900));
  });

  it("staff and the member pressing at one instant on two servers, for a limit of one: exactly one session in the week", async () => {
    const gym = await makeGym("Staff And Member");
    const gold = await sell(gym, "Gold 1 a week", { ptLimit: 1, ptPeriod: "week" });
    const sam = await trainerWith(gym, "Sam Trainer");
    for (let round = 0; round < 3; round++) {
      const who = await member(gym, `Rae Round ${String(round)}`);
      await hold(gym, who.entryId, gold);
      const answers = await Promise.all([
        book(gym, who, sam, FRI, 540 + round * 60, { target: second ?? api() }),
        staffBook(gym, sam, who.entryId, SAT, 540 + round * 60),
        book(gym, who, sam, SUN, 540 + round * 60),
        staffBook(gym, sam, who.entryId, THU, 540 + round * 60, second ?? api()),
      ]);
      expect(answers.map((r) => r.statusCode).sort(), `round ${String(round)}`).toEqual([200, 409, 409, 409]);
      expect((await sessionsOf(gym, who.entryId)).map((r) => r.status)).toEqual(["booked"]);
    }
  });

  it("six presses at one instant on two servers book exactly the two the limit allows, and the same press twice is one session", async () => {
    const gym = await makeGym("Rush Gym");
    const gold = await sell(gym, "Gold 2 a week", { ptLimit: 2, ptPeriod: "week" });
    const sam = await trainerWith(gym, "Sam Trainer");
    const rio = await member(gym, "Rio Rush");
    await hold(gym, rio.entryId, gold);

    const times: [string, number][] = [[FRI, 540], [FRI, 600], [FRI, 660], [SAT, 540], [SAT, 600], [SUN, 540]];
    const answers = await Promise.all(times.map(([day, minute], n) => book(gym, rio, sam, day, minute, { target: n % 2 === 0 ? api() : (second ?? api()) })));
    expect(answers.map((r) => r.statusCode).sort()).toEqual([200, 200, 409, 409, 409, 409]);
    for (const refused of answers.filter((r) => r.statusCode === 409)) expect(said(refused)[1]).toBe("limit_week");
    expect((await sessionsOf(gym, rio.entryId)).map((r) => r.status)).toEqual(["booked", "booked"]);

    // The same press again finds its session: nothing more is counted.
    const tess = await member(gym, "Tess Twice");
    await hold(gym, tess.entryId, gold);
    const key = randomUUID();
    const [one, two] = await Promise.all([book(gym, tess, sam, THU, 540, { key }), book(gym, tess, sam, THU, 540, { key, target: second ?? api() })]);
    expect(made(one).id).toBe(made(two).id);
    expect((await dayOf(gym, tess, FRI)).limit).toMatchObject({ limit: 2, left: 1 });
  });

  it("a limit changed on the price list holds from the next booking, and sessions already booked stay", async () => {
    const gym = await makeGym("Change Limit Gym");
    const gold = await sell(gym, "Gold", { ptLimit: 1, ptPeriod: "week" });
    const sam = await trainerWith(gym, "Sam Trainer");
    const maya = await member(gym, "Maya Member");
    await hold(gym, maya.entryId, gold);

    made(await book(gym, maya, sam, THU, 540));
    expect(said(await book(gym, maya, sam, FRI, 540))[1]).toBe("limit_week");
    // Raised to 3 a week: two more.
    expect((await changeLimit(gym, "Gold", { ptLimit: 3, ptPeriod: "week" })).statusCode).toBe(200);
    made(await book(gym, maya, sam, FRI, 540));
    made(await book(gym, maya, sam, SAT, 540));
    expect(said(await book(gym, maya, sam, SUN, 540))[1]).toBe("limit_week");
    // Lowered under what is booked: nothing booked is taken away, and nothing more is booked.
    expect((await changeLimit(gym, "Gold", { ptLimit: 2, ptPeriod: "week" })).statusCode).toBe(200);
    expect((await sessionsOf(gym, maya.entryId)).map((r) => r.status)).toEqual(["booked", "booked", "booked"]);
    expect((await dayOf(gym, maya, SUN)).limit).toEqual({ membership: "Gold", limit: 2, period: "week", left: 0 });
    expect(said(await book(gym, maya, sam, SUN, 540))[1]).toBe("limit_week");
    // No limit, as every type was before: booked.
    expect((await changeLimit(gym, "Gold", NO_LIMIT)).statusCode).toBe(200);
    expect(await dayOf(gym, maya, SUN)).toMatchObject({ pays: { membership: "Gold" }, why: null, limit: null });
    made(await book(gym, maya, sam, SUN, 540));
    expect((await typeNamed(gym, "Gold")).ptLimit).toBeNull();
  });

  it("only this gym's staff who may change the price list set a limit, and what is refused is never saved", async () => {
    const gym = await makeGym("Whose Limit Gym");
    const other = await makeGym("Other Gym");
    await sell(gym, "Gold", { ptLimit: 4, ptPeriod: "month" });
    const sam = await trainerWith(gym, "Sam Trainer");
    const type = await typeNamed(gym, "Gold");
    const body = { ...monthlyBody("Gold", NO_LIMIT), updatedAt: type.updatedAt };
    const put = (cookies: Cookies, payload: unknown) => inject("PUT", `${typesUrl(gym)}/${type.id}`, cookies, payload);

    // A stranger, another gym's owner (through this gym's address and their own), a trainer.
    const stranger = await signedIn("Stranger");
    expect((await put({}, body)).statusCode).toBe(401);
    expect((await put(stranger.cookies, body)).statusCode).toBe(404);
    expect((await put(other.owner.cookies, body)).statusCode).toBe(404);
    expect((await inject("PUT", `${typesUrl(other)}/${type.id}`, other.owner.cookies, body)).statusCode).toBe(404);
    expect((await put(sam.cookies, body)).statusCode).toBe(403);
    expect((await typeNamed(gym, "Gold")).ptLimit).toBe(4);

    // What a body may not say.
    for (const bad of [
      { ptLimit: 4, ptPeriod: null },
      { ptLimit: null, ptPeriod: "week" },
      { ptLimit: 0, ptPeriod: "week" },
      { ptLimit: 201, ptPeriod: "week" },
      { ptLimit: 4, ptPeriod: "year" },
      { ptLimit: 4, ptPeriod: "week", includesPt: false },
    ]) {
      expect((await put(gym.owner.cookies, { ...body, ...bad })).statusCode, JSON.stringify(bad)).toBe(400);
    }
    // A change that leaves the limit out is refused: it would take the limit off.
    const without: Record<string, unknown> = { ...body };
    delete without["ptLimit"];
    delete without["ptPeriod"];
    expect((await put(gym.owner.cookies, without)).statusCode).toBe(400);
    expect(await typeNamed(gym, "Gold")).toMatchObject({ ptLimit: 4, ptPeriod: "month", updatedAt: type.updatedAt });

    // The table itself refuses a limit on a pack, and on a type without personal training.
    const pack = await sellPack(gym, "PT 10");
    await expect(sql`UPDATE gym_membership_types SET pt_limit = 4, pt_period = 'week' WHERE id = ${pack}`).rejects.toThrow(/gym_membership_types_pt_limit_check/);
    await expect(sql`UPDATE gym_membership_types SET includes_pt = false WHERE id = ${type.id}`).rejects.toThrow(/gym_membership_types_pt_limit_check/);
    await expect(sql`UPDATE gym_membership_types SET pt_period = NULL WHERE id = ${type.id}`).rejects.toThrow(/gym_membership_types_pt_limit_check/);
  });
});
