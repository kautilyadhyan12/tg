// THE AT RISK LIST, through its routes against real Postgres (spec Part 3 §16.4; ROADMAP
// 20d-i). DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: name somebody who came in yesterday
// as "stopped coming", or show one gym's member to another gym. That is the first test:
// a check-in of every kind the table can hold (the desk's scan of a pass and of a key tag,
// staff's Check in, a visit staff added later, the member's own tap and the app's code),
// and everybody who must never be named.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { AT_RISK_AWAY_MAX_DAYS, GYM_COME_BACK_WAIT_DAYS, atRiskResponseSchema, type AtRiskResponse, type GymInboxResponse } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "gym-at-risk-test-secret-0123456789abcdef", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 120_000;
const LIVE_PLAN = "zz_at_risk_live";

let ipCounter = 0;
const nextIp = () => `10.93.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

const THIRTY_DAYS = {
  name: "Thirty days",
  kind: "one_time",
  priceMinor: 3000,
  termCount: 30,
  termUnit: "day",
  description: null,
  packClasses: null,
  packDays: null,
  access: "all_classes",
  bookingsLimit: null,
  bookingsPeriod: null,
  classTypeIds: null,
  includesPt: false,
  ptLimit: null,
  ptPeriod: null,
};

type How = "staff" | "pass" | "key_tag" | "manual" | "qr" | "added_later";

d("At risk: who is named, to whom, and what the gym's numbers change (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  const clock = new Date();
  let today = "";
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  /** The gym's calendar day `n` days from today. */
  const day = (n: number): string => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'atrisk-t-%@example.com')`;
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'atrisk-t-%@example.com'`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_nudges WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_messages WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_messages_off WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_group_messages WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_bookings WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_pt_appointments WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_attendance WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_checkin_devices WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_payments WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_bills WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM user_fitness_profiles WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM one_time_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM refresh_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM consent_log WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM users WHERE email LIKE 'atrisk-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST" | "PUT", path: string, cookies: Cookies, payload?: unknown, remoteAddress: string = nextIp()) =>
    api().inject({
      method,
      url: path,
      remoteAddress,
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });

  interface Person {
    userId: string;
    cookies: Cookies;
  }
  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `atrisk-t-${uniq()}@example.com`;
    const reg = await inject("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await inject("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };
  /** Somebody who never signs in during the test. */
  const account = async (displayName: string): Promise<Person> => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO users (email, display_name) VALUES (${`atrisk-t-p-${uniq()}@example.com`}, ${displayName}) RETURNING id`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("no user");
    return { userId: id, cookies: {} };
  };

  interface Gym {
    id: string;
    owner: Person;
    deviceId: string;
  }
  const makeGym = async (name: string, plan = true): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await inject("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Jorhat", country: "IN", timezone: "Asia/Kolkata" });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    if (plan) {
      await sql`
        INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
        VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    }
    const dev = await sql<{ id: string }[]>`INSERT INTO gym_checkin_devices (gym_id, name) VALUES (${id}, 'Front desk') RETURNING id`;
    const deviceId = dev[0]?.id;
    if (deviceId === undefined) throw new Error("no device");
    return { id, owner, deviceId };
  };
  const onStaff = async (gym: Gym, name: string, role: "manager" | "trainer"): Promise<Person> => {
    const person = await signedIn(name);
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${person.userId}, ${role}, ${null})`;
    return person;
  };

  const record = async (gym: Gym, fullName: string): Promise<string> => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO gym_member_list_entries (gym_id, full_name, email, identity_key, source, created_at)
      VALUES (${gym.id}, ${fullName}, ${`atrisk-r-${uniq()}@example.com`}, encode(sha256(${`atrisk-${uniq()}`}::bytea), 'hex'), 'typed', now() - interval '200 days')
      RETURNING id`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("no record");
    return id;
  };
  interface Who {
    entryId: string | null;
    userId: string | null;
  }
  interface Member extends Person {
    entryId: string;
  }
  const join = async (gym: Gym, person: Person, entryId: string | null): Promise<void> => {
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id, joined_at) VALUES (${gym.id}, ${person.userId}, ${entryId}, now() - interval '150 days')`;
  };
  /** Somebody on the gym's list and in its app. */
  const member = async (gym: Gym, name: string, signs = false): Promise<Member> => {
    const entryId = await record(gym, name);
    const person = signs ? await signedIn(name) : await account(name);
    await join(gym, person, entryId);
    return { ...person, entryId };
  };
  /** Somebody on the gym's list with no app. */
  const onPaper = async (gym: Gym, name: string): Promise<Who> => ({ entryId: await record(gym, name), userId: null });

  /** One check-in on the gym's day `n` days from today, as each way of checking in leaves
   *  its row: the desk's scan names the record and its device; staff's Check in names the
   *  record and the account; the member's own tap and the app's code name the account
   *  alone. */
  const visit = async (gym: Gym, who: Who, n: number, how: How = "staff"): Promise<void> => {
    const on = day(n);
    const desk = how === "pass" || how === "key_tag";
    const own = how === "manual" || how === "qr";
    if (own && who.userId === null) throw new Error("only an account can tap");
    const status = how === "added_later" ? "added_later" : "hours_unset";
    await sql`
      INSERT INTO gym_attendance (gym_id, user_id, entry_id, marked_by_user_id, device_id, day, method, hours_status, slot_key, marked_at)
      VALUES (${gym.id}, ${who.userId}, ${own ? null : who.entryId},
              ${desk ? null : own ? who.userId : gym.owner.userId}, ${desk ? gym.deviceId : null},
              ${on}::date, ${how === "added_later" ? "staff" : how}, ${status}, ${status}, ${`${on}T05:00:00Z`}::timestamptz)`;
  };
  /** Came in once a week for three weeks, the last time `last` days ago. */
  const regular = async (gym: Gym, who: Who, last: number, how: How = "staff"): Promise<void> => {
    for (const n of [last, last + 7, last + 14]) await visit(gym, who, -n, how);
  };
  /** The desk in use: somebody with no app is checked in on each of these days. */
  const deskOpen = async (gym: Gym, from: number, to: number): Promise<void> => {
    const walkIn = await onPaper(gym, `Desk Regular ${uniq()}`);
    for (let n = from; n <= to; n += 1) await visit(gym, walkIn, n, "pass");
  };

  /** A class on the gym's day `n` days from today, with one place in the state given, as
   *  the coach's mark on the class list leaves it. */
  const classPlace = async (gym: Gym, who: Member, n: number, status: "attended" | "no_show" | "booked" | "cancelled"): Promise<void> => {
    const types = await sql<{ id: string }[]>`
      INSERT INTO gym_class_types (gym_id, name, minutes, places, colour, open_gym) VALUES (${gym.id}, ${`Class ${uniq()}`}, 45, 20, 'blue', false) RETURNING id`;
    const sessions = await sql<{ id: string }[]>`
      INSERT INTO gym_class_sessions (gym_id, class_type_id, local_date, local_start_minute, starts_at, minutes, places, status)
      VALUES (${gym.id}, ${types[0]?.id ?? ""}, ${day(n)}::date, 600, (${day(n)}::date + interval '10 hours') AT TIME ZONE 'Asia/Kolkata', 45, 20, 'scheduled')
      RETURNING id`;
    await sql`
      INSERT INTO gym_class_bookings (gym_id, session_id, user_id, entry_id, request_key, status, pack_charged, booked_at, cancelled_at)
      VALUES (${gym.id}, ${sessions[0]?.id ?? ""}, ${who.userId}, ${who.entryId}, gen_random_uuid(), ${status}, false, now() - interval '40 days',
              ${status === "cancelled" ? sql`now() - interval '30 days'` : null})`;
  };
  /** A personal training session on that day, in the state given. */
  const ptSession = async (gym: Gym, who: Who, n: number, status: "attended" | "no_show" | "booked"): Promise<void> => {
    await sql`
      INSERT INTO gym_pt_appointments (gym_id, trainer_user_id, entry_id, local_date, local_start_minute, starts_at, ends_at, minutes, status, pack_charged, request_key, booked_by)
      VALUES (${gym.id}, NULL, ${who.entryId}, ${day(n)}::date, 660,
              (${day(n)}::date + interval '11 hours') AT TIME ZONE 'Asia/Kolkata', (${day(n)}::date + interval '12 hours') AT TIME ZONE 'Asia/Kolkata',
              60, ${status}, false, gen_random_uuid(), ${gym.owner.userId})`;
  };

  const listUrl = (gym: Gym) => `/v1/orgs/${gym.id}/at-risk`;
  const read = async (gym: Gym, who: Person = gym.owner): Promise<AtRiskResponse> => {
    const res = await inject("GET", listUrl(gym), who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return atRiskResponseSchema.parse(JSON.parse(res.body));
  };
  const names = async (gym: Gym): Promise<string[]> => (await read(gym)).people.map((p) => p.name).sort();
  const save = async (gym: Gym, body: unknown, who: Person = gym.owner) => await inject("PUT", `${listUrl(gym)}/settings`, who.cookies, body);

  const heldUrl = (gym: Gym, entryId: string) => `/v1/orgs/${gym.id}/member-list/entries/${entryId}/memberships`;
  /** A thirty-day membership given by the real route, starting `startsIn` days from today. */
  const give = async (gym: Gym, entryId: string, typeId: string, startsIn: number): Promise<string> => {
    const res = await inject("POST", heldUrl(gym, entryId), gym.owner.cookies, { requestKey: randomUUID(), typeId, startsOn: day(startsIn), paid: true, method: "cash" });
    expect(res.statusCode, res.body).toBe(201);
    const rows = await sql<{ id: string }[]>`SELECT id FROM gym_held_memberships WHERE gym_id = ${gym.id} AND entry_id = ${entryId}`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("no membership");
    return id;
  };
  const thirtyDays = async (gym: Gym): Promise<string> => {
    const res = await inject("POST", `/v1/orgs/${gym.id}/membership-types`, gym.owner.cookies, THIRTY_DAYS);
    expect(res.statusCode, res.body).toBe(201);
    const found = (JSON.parse(res.body) as { types: { id: string; name: string }[] }).types.find((t) => t.name === THIRTY_DAYS.name);
    if (found === undefined) throw new Error("no type");
    return found.id;
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    today = (await sql<{ d: string }[]>`SELECT (${clock}::timestamptz AT TIME ZONE 'Asia/Kolkata')::date::text AS d`)[0]?.d ?? "";
    app = await buildApp(loadConfig(baseEnv), { redis, orgs: { now: () => clock } });
    await api().ready();
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, T);

  it(
    "THE WORST THING: nobody who came in lately, by any way of checking in, is named; nor anybody who left, is staff, is frozen or is next door's; and only the gym's own staff read the list",
    async () => {
      const gym = await makeGym("Risk Iron House");
      const next = await makeGym("Risk Next Door");
      await deskOpen(gym, -60, 0);
      await deskOpen(next, -60, 0);
      const typeId = await thirtyDays(gym);

      // Named: each came three weeks running and was last in 20 days ago.
      const stan = await member(gym, "Stan Stopped");
      await regular(gym, stan, 20);
      const pat = await onPaper(gym, "Pat Paper");
      await regular(gym, pat, 20, "pass");
      const lou = await account("Lou Loose");
      await join(gym, lou, null);
      await regular(gym, { entryId: null, userId: lou.userId }, 20, "manual");
      const olly = await member(gym, "Olly Off App");
      await regular(gym, olly, 20);
      await sql`UPDATE gym_members SET removed_at = now(), entry_id = NULL, removed_entry_id = ${olly.entryId} WHERE gym_id = ${gym.id} AND user_id = ${olly.userId}`;
      const hal = await member(gym, "Hal Household");
      await join(gym, await account("Hal's Partner"), hal.entryId);
      await regular(gym, hal, 20);
      const amy = await member(gym, "Amy Active");
      await regular(gym, amy, 20);
      await give(gym, amy.entryId, typeId, -25);

      // Never named: each was as regular, and then came in again, a different way each.
      const lately: [string, How, number][] = [
        ["Dee Desk Pass", "pass", -1],
        ["Kay Key Tag", "key_tag", -3],
        ["Sam Staff Check-in", "staff", 0],
        ["Lee Added Later", "added_later", -5],
        ["Tom Own Tap", "manual", -1],
        ["Quin App Code", "qr", -13],
      ];
      for (const [name, how, n] of lately) {
        const who = await member(gym, name);
        await regular(gym, who, 20);
        await visit(gym, who, n, how);
      }

      // Never named: they are not expected, or not this gym's to chase.
      const fay = await member(gym, "Fay Former");
      await regular(gym, fay, 20);
      await sql`UPDATE gym_member_list_entries SET former_at = now() WHERE id = ${fay.entryId}`;
      const fro = await member(gym, "Fro Frozen");
      await regular(gym, fro, 20);
      const froMembership = await give(gym, fro.entryId, typeId, -25);
      const froze = await inject("POST", `${heldUrl(gym, fro.entryId)}/${froMembership}/freeze`, gym.owner.cookies, {});
      expect(froze.statusCode, froze.body).toBe(200);
      const ed = await member(gym, "Ed Ended");
      await regular(gym, ed, 20);
      // Given, then dated back: its thirty days ran out fifteen days ago.
      const edMembership = await give(gym, ed.entryId, typeId, -25);
      await sql`UPDATE gym_held_memberships SET starts_on = ${day(-45)}::date WHERE gym_id = ${gym.id} AND id = ${edMembership}`;
      const cal = await member(gym, "Cal Cancelled");
      await regular(gym, cal, 20);
      const calMembership = await give(gym, cal.entryId, typeId, -25);
      const cancelled = await inject("POST", `${heldUrl(gym, cal.entryId)}/${calMembership}/cancel`, gym.owner.cookies, { when: "today" });
      expect(cancelled.statusCode, cancelled.body).toBe(200);
      const ownerRecord = await record(gym, "Olive Owner");
      await sql`UPDATE gym_members SET entry_id = ${ownerRecord} WHERE gym_id = ${gym.id} AND user_id = ${gym.owner.userId}`;
      await sql`INSERT INTO gym_members (gym_id, user_id, entry_id, joined_at) SELECT ${gym.id}, ${gym.owner.userId}, ${ownerRecord}, now() - interval '150 days'
                WHERE NOT EXISTS (SELECT 1 FROM gym_members WHERE gym_id = ${gym.id} AND user_id = ${gym.owner.userId})`;
      await regular(gym, { entryId: ownerRecord, userId: gym.owner.userId }, 20);
      const trainer = await onStaff(gym, "Tia Trainer", "trainer");
      const trainerRecord = await record(gym, "Tia Trainer");
      await join(gym, trainer, trainerRecord);
      await regular(gym, { entryId: trainerRecord, userId: trainer.userId }, 20);
      await member(gym, "Ned Never Came");
      const olga = await member(gym, "Olga Once");
      await visit(gym, olga, -20);
      const greg = await member(gym, "Greg Long Gone");
      await regular(gym, greg, AT_RISK_AWAY_MAX_DAYS + 1);

      // Next door has its own.
      const nina = await member(next, "Nina Next Door");
      await regular(next, nina, 20);

      const list = await read(gym);
      expect(list.people.map((p) => p.name).sort()).toEqual(["Amy Active", "Hal Household", "Lou Loose", "Olly Off App", "Pat Paper", "Stan Stopped"]);
      expect(list.total).toBe(6);
      expect(list.checkin).toBe("in_use");
      const by = (name: string) => list.people.find((p) => p.name === name);
      expect(by("Stan Stopped")).toEqual({
        entryId: stan.entryId,
        userId: stan.userId,
        app: "one",
        name: "Stan Stopped",
        lastVisitOn: day(-20),
        daysAway: 20,
        weeksCame: 3,
        lastMessage: null,
        messageableAt: null,
      });
      expect(by("Pat Paper")).toMatchObject({ entryId: pat.entryId, userId: null, app: "none" });
      expect(by("Lou Loose")).toMatchObject({ entryId: null, userId: lou.userId, app: "one", daysAway: 20 });
      expect(by("Olly Off App")).toMatchObject({ entryId: olly.entryId, userId: null, app: "none" });
      expect(by("Hal Household")).toMatchObject({ entryId: hal.entryId, userId: null, app: "shared" });

      expect(await names(next)).toEqual(["Nina Next Door"]);

      // Who reads it: this gym's staff with the Members tick, and nobody else.
      expect((await read(gym, trainer)).total).toBe(6);
      expect((await inject("GET", listUrl(gym), {})).statusCode).toBe(401);
      for (const outsider of [next.owner, await signedIn("Sid Stranger")]) {
        const res = await inject("GET", listUrl(gym), outsider.cookies);
        expect(res.statusCode, res.body).toBe(404);
        expect(res.body).not.toContain("Stan");
      }
      const memberOnly = await member(gym, "Mel Member", true);
      expect((await inject("GET", listUrl(gym), memberOnly.cookies)).statusCode).toBe(404);
      expect((await inject("GET", "/v1/orgs/not-a-gym/at-risk", gym.owner.cookies)).statusCode).toBe(400);
    },
    T,
  );

  it(
    "the gym's two numbers decide the day somebody is named and how regular they were; only whoever runs the gym changes them",
    async () => {
      const gym = await makeGym("Risk Numbers");
      const next = await makeGym("Risk Numbers Next Door");
      await deskOpen(gym, -60, 0);
      const fourteen = await member(gym, "Fay Fourteen");
      await regular(gym, fourteen, 14);
      const thirteen = await member(gym, "Theo Thirteen");
      await regular(gym, thirteen, 13);
      const twoWeeks = await member(gym, "Tess Two Weeks");
      await visit(gym, twoWeeks, -25);
      await visit(gym, twoWeeks, -33);

      expect((await read(gym)).settings).toEqual({ quietDays: 14, weeksCame: 2 });
      expect(await names(gym)).toEqual(["Fay Fourteen", "Tess Two Weeks"]);

      const ten = await save(gym, { quietDays: 10, weeksCame: 2 });
      expect(ten.statusCode, ten.body).toBe(200);
      expect(JSON.parse(ten.body)).toEqual({ settings: { quietDays: 10, weeksCame: 2 } });
      expect(await names(gym)).toEqual(["Fay Fourteen", "Tess Two Weeks", "Theo Thirteen"]);

      expect((await save(gym, { quietDays: 21, weeksCame: 2 })).statusCode).toBe(200);
      expect(await names(gym)).toEqual(["Tess Two Weeks"]);

      expect((await save(gym, { quietDays: 14, weeksCame: 3 })).statusCode).toBe(200);
      expect(await names(gym)).toEqual(["Fay Fourteen"]);
      expect((await save(gym, { quietDays: 14, weeksCame: 4 })).statusCode).toBe(200);
      expect(await names(gym)).toEqual([]);

      // Saved twice it is saved once, and a save that changes nothing is not written down.
      expect((await save(gym, { quietDays: 14, weeksCame: 4 })).statusCode).toBe(200);
      const audits = await sql`SELECT 1 FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.at_risk_settings_changed'`;
      expect(audits.length).toBe(4);

      for (const bad of [{ quietDays: 3, weeksCame: 2 }, { quietDays: 14, weeksCame: 5 }, { quietDays: 14 }, { quietDays: "14", weeksCame: 2 }, { quietDays: 14, weeksCame: 2, gymId: next.id }]) {
        const res = await save(gym, bad);
        expect(res.statusCode, JSON.stringify(bad)).toBe(400);
        expect(res.body).not.toContain(next.id);
      }
      const trainer = await onStaff(gym, "Tia Numbers Trainer", "trainer");
      expect((await save(gym, { quietDays: 7, weeksCame: 1 }, trainer)).statusCode).toBe(403);
      expect((await save(gym, { quietDays: 7, weeksCame: 1 }, next.owner)).statusCode).toBe(404);
      expect((await inject("PUT", `${listUrl(gym)}/settings`, {}, { quietDays: 7, weeksCame: 1 })).statusCode).toBe(401);
      expect((await read(gym)).settings).toEqual({ quietDays: 14, weeksCame: 4 });
      expect((await read(next)).settings).toEqual({ quietDays: 14, weeksCame: 2 });

      const lapsed = await makeGym("Risk No Plan", false);
      expect((await save(lapsed, { quietDays: 7, weeksCame: 1 })).statusCode).toBe(409);
    },
    T,
  );

  it(
    "a come-back message is shown on the row with the day another may go, and goes only to the one account that holds the record",
    async () => {
      const gym = await makeGym("Risk Messages");
      await deskOpen(gym, -60, 0);
      const stan = await member(gym, "Stan Sent");
      await regular(gym, stan, 20);
      const old = await member(gym, "Olda Old Message");
      await regular(gym, old, 20);
      await sql`INSERT INTO gym_nudges (gym_id, user_id, sent_by_user_id, preset, created_at) VALUES (${gym.id}, ${old.userId}, ${gym.owner.userId}, 'door_open', now() - interval '84 hours')`;

      const sent = await inject("POST", `/v1/orgs/${gym.id}/members/${stan.userId}/nudge`, gym.owner.cookies, { preset: "miss_you" });
      expect(sent.statusCode, sent.body).toBe(201);

      const list = await read(gym);
      const row = list.people.find((p) => p.name === "Stan Sent");
      expect(row?.lastMessage?.preset).toBe("miss_you");
      const again = Date.parse(row?.messageableAt ?? "");
      expect(GYM_COME_BACK_WAIT_DAYS).toBe(3);
      expect(again - Date.parse(row?.lastMessage?.sentAt ?? "")).toBe(3 * 86_400_000);
      const older = list.people.find((p) => p.name === "Olda Old Message");
      expect(older?.lastMessage?.preset).toBe("door_open");
      expect(older?.messageableAt).toBeNull();

      expect((await inject("POST", `/v1/orgs/${gym.id}/members/${stan.userId}/nudge`, gym.owner.cookies, { preset: "door_open" })).statusCode).toBe(409);
    },
    T,
  );

  it(
    "more written messages and check-ins at one instant than the server has connections all finish",
    async () => {
      const gym = await makeGym("Risk Small Pool");
      await deskOpen(gym, -60, 0);
      const people: Member[] = [];
      for (let i = 0; i < 4; i += 1) {
        const one = await member(gym, `Small Pool ${String(i)}`);
        await regular(gym, one, 20);
        people.push(one);
      }
      const small = await buildApp(loadConfig({ ...baseEnv, DATABASE_POOL_MAX: "2" }), { redis, orgs: { now: () => clock } });
      try {
        await small.ready();
        const post = (path: string, payload: unknown) =>
          small.inject({ method: "POST", url: `/v1/orgs/${gym.id}${path}`, remoteAddress: nextIp(), cookies: gym.owner.cookies, headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) });
        const all = Promise.all([
          ...people.map((p) => post("/at-risk/messages", { userId: p.userId, body: "We saved your spot.", key: randomUUID() })),
          ...people.map((p) => post("/attendance/check-in", { entryId: p.entryId })),
        ]);
        let timer: NodeJS.Timeout | undefined;
        const stuck = new Promise<"stuck">((resolve) => {
          timer = setTimeout(() => {
            resolve("stuck");
          }, 30_000);
        });
        const done = await Promise.race([all, stuck]);
        clearTimeout(timer);
        if (done === "stuck") throw new Error("the requests never finished: a send held the gym's row and waited for a second connection");
        // Each is answered: sent, or refused because the check-in got there first.
        for (const res of done) expect([200, 201, 409], res.body).toContain(res.statusCode);
      } finally {
        await small.close();
      }
    },
    T,
  );

  it(
    "the gym's own words go to the one person named and nobody else, once, inside the same wait as a ready-made line, and never past the rules a message to a group keeps",
    async () => {
      const gym = await makeGym("Risk Own Words");
      const next = await makeGym("Risk Own Words Next Door");
      await deskOpen(gym, -60, 0);
      const stan = await member(gym, "Stan Written", true);
      await regular(gym, stan, 20);
      const omar = await member(gym, "Omar Other", true);
      await regular(gym, omar, 20);
      const nina = await member(next, "Nina Next Door", true);
      const url = (g: Gym) => `${listUrl(g)}/messages`;
      const write = async (g: Gym, userId: string, body: string, who: Person = g.owner, key: string = randomUUID()) => await inject("POST", url(g), who.cookies, { userId, body, key });
      const inboxOf = async (g: Gym, who: Person): Promise<string[]> => {
        const res = await inject("GET", `/v1/orgs/${g.id}/inbox`, who.cookies);
        expect(res.statusCode, res.body).toBe(200);
        return (JSON.parse(res.body) as GymInboxResponse).messages.map((m) => m.body);
      };
      const WORDS = "Hi Stan, we saved your Tuesday spot. Come back when you can.";

      // Refused before anything is written: the words, the person, the asker.
      for (const [body, code] of [["   ", "group_message_empty"], ["See www.example.com", "group_message_link"], ["Write to me @stan", "group_message_at"]] as const) {
        const res = await write(gym, stan.userId, body);
        expect(res.statusCode, body).toBe(400);
        expect((JSON.parse(res.body) as { error: string }).error).toBe(code);
      }
      expect((await write(gym, nina.userId, WORDS)).statusCode).toBe(404);
      expect((await write(gym, randomUUID(), WORDS)).statusCode).toBe(404);
      expect((await write(gym, stan.userId, WORDS, next.owner)).statusCode).toBe(404);
      expect((await write(gym, stan.userId, WORDS, omar)).statusCode).toBe(404);
      expect((await inject("POST", url(gym), {}, { userId: stan.userId, body: WORDS, key: randomUUID() })).statusCode).toBe(401);
      const trainer = await onStaff(gym, "Tia Words Trainer", "trainer");
      expect((await write(gym, stan.userId, WORDS, trainer)).statusCode).toBe(403);
      expect((await inject("POST", url(gym), gym.owner.cookies, { userId: stan.userId, body: WORDS })).statusCode).toBe(400);
      expect((await sql`SELECT 1 FROM gym_group_messages WHERE gym_id IN (${gym.id}, ${next.id})`).length).toBe(0);

      // Sent: Stan reads it, Omar and next door's Nina do not, and the same press again sends nothing more.
      const key = randomUUID();
      const sent = await write(gym, stan.userId, `  ${WORDS}  `, gym.owner, key);
      expect(sent.statusCode, sent.body).toBe(201);
      expect((JSON.parse(sent.body) as { message: { body: string } }).message.body).toBe(WORDS);
      expect((await write(gym, stan.userId, WORDS, gym.owner, key)).statusCode).toBe(201);
      expect(await inboxOf(gym, stan)).toEqual([WORDS]);
      expect(await inboxOf(gym, omar)).toEqual([]);
      expect(await inboxOf(next, nina)).toEqual([]);
      const kept = await sql<{ people: number; one_person: boolean }[]>`SELECT people, one_person FROM gym_group_messages WHERE gym_id = ${gym.id}`;
      expect(kept.map((r) => ({ ...r }))).toEqual([{ people: 1, one_person: true }]);
      // The words are in no audit line.
      const audits = await sql<{ meta: unknown }[]>`SELECT meta FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.at_risk_message_sent'`;
      expect(audits.length).toBe(1);
      expect(JSON.stringify(audits)).not.toContain("Tuesday");

      // The box's key is that box's: for somebody else it answers for nobody and sends nothing.
      const firstSentAt = (JSON.parse(sent.body) as { message: { sentAt: string } }).message.sentAt;
      const again = await write(gym, stan.userId, WORDS, gym.owner, key);
      expect((JSON.parse(again.body) as { message: { sentAt: string } }).message.sentAt).toBe(firstSentAt);
      const otherPerson = await write(gym, omar.userId, WORDS, gym.owner, key);
      expect(otherPerson.statusCode, otherPerson.body).toBe(409);
      expect((JSON.parse(otherPerson.body) as { error: string }).error).toBe("message_key_used");
      expect((await write(gym, nina.userId, WORDS, gym.owner, key)).statusCode).toBe(409);
      expect(await inboxOf(gym, omar)).toEqual([]);

      // Only somebody the list names now: a member who came in today is not written to.
      const kit = await member(gym, "Kit Came Today", true);
      await regular(gym, kit, 20);
      await visit(gym, kit, 0);
      const notListed = await write(gym, kit.userId, "Hi Kit.");
      expect(notListed.statusCode, notListed.body).toBe(409);
      expect((JSON.parse(notListed.body) as { error: string }).error).toBe("member_not_at_risk");
      expect(await inboxOf(gym, kit)).toEqual([]);

      // Two presses at one instant, from two boxes: one message.
      const pia = await member(gym, "Pia Pressed Twice", true);
      await regular(gym, pia, 20);
      const both = await Promise.all([write(gym, pia.userId, "Hi Pia, one."), write(gym, pia.userId, "Hi Pia, two.")]);
      expect(both.map((r) => r.statusCode).sort()).toEqual([201, 409]);
      expect((await inboxOf(gym, pia)).length).toBe(1);
      // A ready-made line and written words at one instant: one of them.
      const rae = await member(gym, "Rae Raced", true);
      await regular(gym, rae, 20);
      const mixed = await Promise.all([
        write(gym, rae.userId, "Hi Rae."),
        inject("POST", `/v1/orgs/${gym.id}/members/${rae.userId}/nudge`, gym.owner.cookies, { preset: "miss_you" }),
      ]);
      expect(mixed.map((r) => r.statusCode).sort()).toEqual([201, 409]);

      // A message to a GROUP an hour ago is not a come-back message: it starts no wait and is not on the row.
      const gus = await member(gym, "Gus Got The News", true);
      await regular(gym, gus, 20);
      const news = await sql<{ id: string }[]>`
        INSERT INTO gym_group_messages (gym_id, sent_by, body, gym_day, sent_at, people, send_key)
        VALUES (${gym.id}, ${gym.owner.userId}, 'We are closed on Friday.', ${today}::date, now() - interval '1 hour', 1, gen_random_uuid()) RETURNING id`;
      await sql`
        INSERT INTO gym_member_messages (gym_id, user_id, kind, occasion, body, gym_day, sent_at, expires_at)
        VALUES (${gym.id}, ${gus.userId}, 'group', ${news[0]?.id ?? ""}, 'We are closed on Friday.', ${today}::date, now() - interval '1 hour', now() + interval '30 days')`;
      const gusRow = (await read(gym)).people.find((p) => p.name === "Gus Got The News");
      expect(gusRow).toMatchObject({ lastMessage: null, messageableAt: null });
      expect((await write(gym, gus.userId, "Hi Gus.")).statusCode).toBe(201);

      // Somebody whose account is deleted is nobody to write to.
      const del = await member(gym, "Del Deleted", true);
      await regular(gym, del, 20);
      await sql`UPDATE users SET deleted_at = now(), status = 'deleted' WHERE id = ${del.userId}`;
      expect((await write(gym, del.userId, "Hi Del.")).statusCode).toBe(404);

      // The row says so, and the wait holds for both kinds of message.
      const row = (await read(gym)).people.find((p) => p.name === "Stan Written");
      expect(row?.lastMessage).toMatchObject({ preset: null, body: WORDS });
      expect(Date.parse(row?.messageableAt ?? "") - Date.parse(row?.lastMessage?.sentAt ?? "")).toBe(3 * 86_400_000);
      expect((await write(gym, stan.userId, "A second one.")).statusCode).toBe(409);
      const line = await inject("POST", `/v1/orgs/${gym.id}/members/${stan.userId}/nudge`, gym.owner.cookies, { preset: "miss_you" });
      expect(line.statusCode).toBe(409);
      // And the other way round: a ready-made line stops the gym's own words.
      expect((await inject("POST", `/v1/orgs/${gym.id}/members/${omar.userId}/nudge`, gym.owner.cookies, { preset: "miss_you" })).statusCode).toBe(201);
      const afterLine = await write(gym, omar.userId, "Hi Omar.");
      expect(afterLine.statusCode).toBe(409);
      expect((JSON.parse(afterLine.body) as { error: string }).error).toBe("nudge_already_sent");

      // Three and a half days on, both may go again; two days on, neither.
      const back = async (days: number) => {
        await sql`UPDATE gym_group_messages SET sent_at = now() - (${days}::numeric * interval '1 day') WHERE gym_id = ${gym.id}`;
        await sql`UPDATE gym_nudges SET created_at = now() - (${days}::numeric * interval '1 day') WHERE gym_id = ${gym.id}`;
      };
      await back(2);
      expect((await write(gym, stan.userId, "Too soon.")).statusCode).toBe(409);
      await back(3.5);
      expect((await write(gym, omar.userId, "Hi Omar, good to have you back any day.")).statusCode).toBe(201);
      expect((await inject("POST", `/v1/orgs/${gym.id}/members/${stan.userId}/nudge`, gym.owner.cookies, { preset: "door_open" })).statusCode).toBe(201);

      // Written to one person, it is not one of the day's three messages to groups.
      expect((await sql`SELECT 1 FROM gym_group_messages WHERE gym_id = ${gym.id} AND one_person`).length).toBeGreaterThanOrEqual(4);
      // The one message to a group above is the only one counted against today's three.
      const sentList = await inject("GET", `/v1/orgs/${gym.id}/member-list/messages`, gym.owner.cookies);
      expect(sentList.statusCode, sentList.body).toBe(200);
      expect((JSON.parse(sentList.body) as { page: { leftToday: number } }).page.leftToday).toBe(2);

      // Somebody who switched the gym's messages off is not written to, and is told why.
      const quiet = await member(gym, "Quinn Switched Off", true);
      await regular(gym, quiet, 20);
      expect((await inject("PUT", `/v1/orgs/${gym.id}/inbox/group-messages`, quiet.cookies, { on: false })).statusCode).toBe(200);
      const off = await write(gym, quiet.userId, "Hi Quinn.");
      expect(off.statusCode).toBe(409);
      expect((JSON.parse(off.body) as { error: string }).error).toBe("member_messages_off");
      expect(await inboxOf(gym, quiet)).toEqual([]);

      // A gym on no plan writes to nobody.
      const lapsed = await makeGym("Risk Words No Plan", false);
      const lee = await member(lapsed, "Lee Lapsed Gym");
      expect((await write(lapsed, lee.userId, WORDS)).statusCode).toBe(409);
    },
    T,
  );

  it(
    "a class place or a training session staff marked as attended is a day the person came; a no-show, a booking and a cancelled place are not",
    async () => {
      const gym = await makeGym("Risk Marked Came");
      await deskOpen(gym, -60, 0);
      const cara = await member(gym, "Cara Class Yesterday");
      await regular(gym, cara, 20);
      await classPlace(gym, cara, -1, "attended");
      const pete = await member(gym, "Pete Training Two Days Ago");
      await regular(gym, pete, 20);
      await ptSession(gym, pete, -2, "attended");
      // A class thirteen days ago is inside fourteen: not yet.
      const tess = await member(gym, "Tess Thirteen Days");
      await regular(gym, tess, 20);
      await classPlace(gym, tess, -13, "attended");
      for (const [name, status] of [["Nora No-show", "no_show"], ["Bo Booked Only", "booked"], ["Cy Cancelled Place", "cancelled"]] as const) {
        const who = await member(gym, name);
        await regular(gym, who, 20);
        await classPlace(gym, who, -1, status);
      }
      const ned = await member(gym, "Ned No-show Training");
      await regular(gym, ned, 20);
      await ptSession(gym, ned, -1, "no_show");
      // Somebody who only ever came to classes, and stopped.
      const olga = await member(gym, "Olga Classes Only");
      for (const n of [-20, -27, -34]) await classPlace(gym, olga, n, "attended");

      const list = await read(gym);
      expect(list.people.map((p) => p.name).sort()).toEqual(["Bo Booked Only", "Cy Cancelled Place", "Ned No-show Training", "Nora No-show", "Olga Classes Only"]);
      expect(list.people.find((p) => p.name === "Olga Classes Only")).toMatchObject({ lastVisitOn: day(-20), daysAway: 20, weeksCame: 3 });

      // A studio that scans nobody and marks its classes, three days a week: in use, by those days.
      const studio = await makeGym("Risk Classes Only Studio");
      const regulars = await member(studio, "Reg The Studio's Regular");
      for (let n = -60; n <= 0; n += 1) if ([1, 3, 5].includes(new Date(`${day(n)}T00:00:00Z`).getUTCDay())) await classPlace(studio, regulars, n, "attended");
      const rita = await member(studio, "Rita Stopped At The Studio");
      const open = Array.from({ length: 61 }, (_, i) => -i).filter((n) => [1, 3, 5].includes(new Date(`${day(n)}T00:00:00Z`).getUTCDay()));
      for (const n of open.filter((d) => d <= -15).slice(0, 4)) await classPlace(studio, rita, n, "attended");
      const there = await read(studio);
      expect(there.checkin).toBe("in_use");
      expect(there.lastCheckinOn).toBe(day(open[0] ?? 0));
      expect(there.people.map((p) => p.name)).toEqual(["Rita Stopped At The Studio"]);
    },
    T,
  );

  it(
    "one person in two gyms is each gym's own: a tap next door hides nobody here and puts no date of next door's on the row; and staff with no record are never named",
    async () => {
      const gym = await makeGym("Risk Two Gyms Here");
      const next = await makeGym("Risk Two Gyms Next Door");
      await deskOpen(gym, -60, 0);
      await deskOpen(next, -60, 0);
      // Tara holds a record here and stopped; next door she is in the app with no record and came yesterday.
      const tara = await member(gym, "Tara Two Gyms");
      await regular(gym, tara, 20);
      await join(next, tara, null);
      await regular(next, { entryId: null, userId: tara.userId }, 8, "manual");
      await visit(next, { entryId: null, userId: tara.userId }, -1, "manual");
      // Uma is in both apps with no record in either, and stopped here only.
      const uma = await account("Uma Both Apps");
      await join(gym, uma, null);
      await join(next, uma, null);
      await regular(gym, { entryId: null, userId: uma.userId }, 20, "manual");
      await visit(next, { entryId: null, userId: uma.userId }, -1, "qr");
      await visit(next, { entryId: null, userId: uma.userId }, -9, "qr");

      const here = await read(gym);
      expect(here.people.map((p) => p.name).sort()).toEqual(["Tara Two Gyms", "Uma Both Apps"]);
      for (const row of here.people) expect(row).toMatchObject({ lastVisitOn: day(-20), daysAway: 20 });
      expect(JSON.stringify(here)).not.toContain(next.id);
      expect(await names(next)).toEqual([]);

      // Staff with no record on the list, who used to tap in: the owner, a trainer.
      await sql`INSERT INTO gym_members (gym_id, user_id, joined_at) SELECT ${gym.id}, ${gym.owner.userId}, now() - interval '150 days'
                WHERE NOT EXISTS (SELECT 1 FROM gym_members WHERE gym_id = ${gym.id} AND user_id = ${gym.owner.userId})`;
      await regular(gym, { entryId: null, userId: gym.owner.userId }, 20, "manual");
      const trainer = await onStaff(gym, "Tim Trainer No Record", "trainer");
      await join(gym, trainer, null);
      await regular(gym, { entryId: null, userId: trainer.userId }, 20, "manual");
      expect(await names(gym)).toEqual(["Tara Two Gyms", "Uma Both Apps"]);
    },
    T,
  );

  it(
    "more than 200 at risk: all are counted and the first 200 listed; and each limit counts an address only for the gym's own staff",
    async () => {
      const gym = await makeGym("Risk Many");
      await deskOpen(gym, -60, 0);
      // 205 people on paper, each in on the same two days three and four weeks ago.
      await sql`
        WITH made AS (
          INSERT INTO gym_member_list_entries (gym_id, full_name, email, identity_key, source, created_at)
          SELECT ${gym.id}, 'Many ' || lpad(n::text, 3, '0'), 'atrisk-many-' || n || '-' || ${uniq()} || '@example.com',
                 encode(sha256(('atrisk-many-' || n || ${uniq()})::bytea), 'hex'), 'typed', now() - interval '200 days'
          FROM generate_series(1, 205) AS n
          RETURNING id
        )
        INSERT INTO gym_attendance (gym_id, entry_id, marked_by_user_id, day, method, hours_status, slot_key, marked_at)
        SELECT ${gym.id}, made.id, ${gym.owner.userId}, d.day, 'staff', 'hours_unset', 'hours_unset', d.day + interval '5 hours'
        FROM made CROSS JOIN (VALUES (${day(-20)}::date), (${day(-28)}::date)) AS d(day)`;
      const list = await read(gym);
      expect(list.total).toBe(205);
      expect(list.people.length).toBe(200);
      expect(list.people[0]?.name).toBe("Many 001");

      // A stranger's refused asks leave the gym's address alone, on all three routes.
      const desk = "10.93.240.7";
      const stranger = await signedIn("Sal Stranger At The Desk");
      const body = { quietDays: 7, weeksCame: 1 };
      expect((await inject("GET", listUrl(gym), stranger.cookies, undefined, desk)).statusCode).toBe(404);
      expect((await inject("PUT", `${listUrl(gym)}/settings`, stranger.cookies, body, desk)).statusCode).toBe(404);
      expect((await inject("POST", `${listUrl(gym)}/messages`, stranger.cookies, { userId: randomUUID(), body: "Hi.", key: randomUUID() }, desk)).statusCode).toBe(404);
      for (const name of ["orgs_at_risk", "orgs_at_risk_settings", "orgs_at_risk_message"]) {
        expect(await redis.get(`rl:${name}:ip:${gym.id}:${desk}`), name).toBeNull();
      }
      // The gym's own staff are counted there, and stopped at the limit with 429.
      expect((await inject("PUT", `${listUrl(gym)}/settings`, gym.owner.cookies, { quietDays: 14, weeksCame: 2 }, desk)).statusCode).toBe(200);
      expect(await redis.get(`rl:orgs_at_risk_settings:ip:${gym.id}:${desk}`)).not.toBeNull();
      for (let i = 0; i < 600; i += 1) await redis.incrWithTtl(`rl:orgs_at_risk_settings:ip:${gym.id}:${desk}`, 3600);
      expect((await inject("PUT", `${listUrl(gym)}/settings`, gym.owner.cookies, { quietDays: 14, weeksCame: 2 }, desk)).statusCode).toBe(429);
      for (let i = 0; i < 2400; i += 1) await redis.incrWithTtl(`rl:orgs_at_risk:ip:${gym.id}:${desk}`, 3600);
      expect((await inject("GET", listUrl(gym), gym.owner.cookies, undefined, desk)).statusCode).toBe(429);
      for (let i = 0; i < 600; i += 1) await redis.incrWithTtl(`rl:orgs_at_risk_message:ip:${gym.id}:${desk}`, 3600);
      expect((await inject("POST", `${listUrl(gym)}/messages`, gym.owner.cookies, { userId: randomUUID(), body: "Hi.", key: randomUUID() }, desk)).statusCode).toBe(429);
      // Another address is not stopped by this one's count.
      expect((await inject("GET", listUrl(gym), gym.owner.cookies)).statusCode).toBe(200);
    },
    T,
  );

  it(
    "a gym that checks nobody in, has only just begun to, or has stopped is told so, and nobody is named for days the gym itself was not checking in",
    async () => {
      const none = await makeGym("Risk No Check-in");
      await member(none, "Nell Nobody Checked");
      expect(await read(none)).toMatchObject({ checkin: "none", firstCheckinOn: null, lastCheckinOn: null, total: 0, people: [] });

      const fresh = await makeGym("Risk New Check-in");
      await deskOpen(fresh, -5, 0);
      expect(await read(fresh)).toMatchObject({ checkin: "new", firstCheckinOn: day(-5), lastCheckinOn: day(0), total: 0 });

      // The desk was used until 20 days ago and not since.
      const shut = await makeGym("Risk Stopped Check-in");
      await deskOpen(shut, -80, -20);
      const early = await member(shut, "Earl Stopped Early");
      await regular(shut, early, 50);
      const late = await member(shut, "Lata Came Till The End");
      await regular(shut, late, 22);
      const list = await read(shut);
      expect(list).toMatchObject({ checkin: "stopped", lastCheckinOn: day(-20), checkinDaysLately: 0 });
      expect(list.people.map((p) => p.name)).toEqual(["Earl Stopped Early"]);
    },
    T,
  );
});
