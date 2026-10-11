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
import { AT_RISK_AWAY_MAX_DAYS, atRiskResponseSchema, type AtRiskResponse } from "@app/shared";
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
      await sql`INSERT INTO gym_nudges (gym_id, user_id, sent_by_user_id, preset, created_at) VALUES (${gym.id}, ${old.userId}, ${gym.owner.userId}, 'door_open', now() - interval '9 days')`;

      const sent = await inject("POST", `/v1/orgs/${gym.id}/members/${stan.userId}/nudge`, gym.owner.cookies, { preset: "miss_you" });
      expect(sent.statusCode, sent.body).toBe(201);

      const list = await read(gym);
      const row = list.people.find((p) => p.name === "Stan Sent");
      expect(row?.lastMessage?.preset).toBe("miss_you");
      const again = Date.parse(row?.messageableAt ?? "");
      expect(again - Date.parse(row?.lastMessage?.sentAt ?? "")).toBe(7 * 86_400_000);
      const older = list.people.find((p) => p.name === "Olda Old Message");
      expect(older?.lastMessage?.preset).toBe("door_open");
      expect(older?.messageableAt).toBeNull();

      expect((await inject("POST", `/v1/orgs/${gym.id}/members/${stan.userId}/nudge`, gym.owner.cookies, { preset: "door_open" })).statusCode).toBe(409);
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
      await regular(shut, early, 30);
      const late = await member(shut, "Lata Came Till The End");
      await regular(shut, late, 22);
      const list = await read(shut);
      expect(list).toMatchObject({ checkin: "stopped", lastCheckinOn: day(-20) });
      expect(list.people.map((p) => p.name)).toEqual(["Earl Stopped Early"]);
    },
    T,
  );
});
