// A GYM'S CHALLENGES — the routes against real Postgres (spec Part 3 §15.6; ROADMAP
// 19d-i). DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: show somebody who chose Hide me, or
// somebody the gym removed, to another member — in a challenge's places, its count of who
// joined, or its count of who reached the target. That is the first test below.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  GYM_CHALLENGES_CURRENT_MAX,
  GYM_CHALLENGE_WORDS,
  type GymChallengeBoardResponse,
  type GymChallengesResponse,
  type LeaderboardResponse,
  type MemberGymChallenge,
  type StaffGymChallenge,
  type StaffGymChallengeBoardResponse,
  type StaffGymChallengesResponse,
} from "@app/shared";
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
  JWT_SECRET: "gym-challenges-test-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 120_000;
const LIVE_PLAN = "zz_chal_live";
/** Wednesday 7 October 2026, noon in Kolkata: its week is Mon 5 to Sun 11 October. */
const WEDNESDAY = new Date("2026-10-07T06:30:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

let ipCounter = 0;
const nextIp = () => `10.81.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;
/** An address of this run's own for a limit test. */
const desk = (): string => {
  const hex = randomUUID().replaceAll("-", "");
  return `10.${String(100 + (parseInt(hex.slice(0, 2), 16) % 100))}.${String(parseInt(hex.slice(2, 4), 16))}.${String((parseInt(hex.slice(4, 6), 16) % 254) + 1)}`;
};

d("a gym's challenges (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  let clock = WEDNESDAY;
  let app: App | undefined;
  /** A second api on the same database and Redis: one api holds one connection, so two
   *  requests race only across two of them. */
  let second: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'chal-t-%@example.com')`;
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'chal-t-%@example.com'`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_challenges WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_attendance WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_checkin_devices WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM user_fitness_profiles WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM workouts WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM one_time_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM refresh_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM consent_log WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM users WHERE email LIKE 'chal-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, cookies: Cookies, payload?: unknown, ip = nextIp(), target = api()) =>
    target.inject({
      method,
      url: path,
      remoteAddress: ip,
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const codeOf = (res: { body: string }): string => (JSON.parse(res.body) as { error: string }).error;

  interface Person {
    userId: string;
    cookies: Cookies;
  }

  /** Somebody who signs in. */
  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `chal-t-${uniq()}@example.com`;
    const reg = await inject("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await inject("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };

  /** Somebody who never signs in during the test. */
  const account = async (displayName: string, local = "p"): Promise<{ userId: string }> => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO users (email, display_name) VALUES (${`chal-t-${local}-${uniq()}@example.com`}, ${displayName}) RETURNING id`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("no user");
    return { userId: id };
  };

  interface Gym {
    id: string;
    owner: Person;
    deviceId: string;
  }

  const makeGym = async (name: string, timezone = "Asia/Kolkata"): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await inject("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Jorhat", country: "IN", timezone });
    expect(res.statusCode).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    const dev = await sql<{ id: string }[]>`INSERT INTO gym_checkin_devices (gym_id, name) VALUES (${id}, 'Front desk') RETURNING id`;
    return { id, owner, deviceId: dev[0]?.id ?? "" };
  };
  const lapse = async (gymId: string) => {
    await sql`UPDATE subscriptions SET status = 'canceled' WHERE owner_type = 'gym' AND owner_id = ${gymId}`;
  };
  const addStaff = async (gymId: string, userId: string, role: "manager" | "trainer") => {
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gymId}, ${userId}, ${role}, ${null})`;
  };

  const record = async (gymId: string, fullName: string, dateOfBirth: string | null = null): Promise<string> => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO gym_member_list_entries (gym_id, full_name, email, identity_key, source, date_of_birth)
      VALUES (${gymId}, ${fullName}, ${`chal-r-${uniq()}@example.com`}, encode(sha256(${`chal-${uniq()}`}::bytea), 'hex'), 'typed', ${dateOfBirth})
      RETURNING id`;
    return rows[0]?.id ?? "";
  };

  // In the gym since a fixed day, long before any workout below: Workout days reads it.
  const inGym = async (gymId: string, userId: string, entryId: string | null = null): Promise<void> => {
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id, joined_at) VALUES (${gymId}, ${userId}, ${entryId}, '2026-01-01T00:00:00Z')`;
  };
  const member = async (gym: Gym, name: string): Promise<Person> => {
    const p = await signedIn(name);
    await inGym(gym.id, p.userId);
    return p;
  };

  /** A finished app workout at 07:30 on a day of Kolkata's calendar, saved half an hour later. */
  const workout = async (userId: string, day: string, savedDaysLater = 0): Promise<void> => {
    await sql`
      INSERT INTO workouts (id, user_id, started_at, platform, engine_version, sets_count, total_reps, created_at)
      VALUES (gen_random_uuid(), ${userId}, ${`${day}T02:00:00Z`}, 'web', 'test', 1, 10, ${`${day}T02:30:00Z`}::timestamptz + make_interval(days => ${savedDaysLater}::int))`;
  };

  /** A visit at noon on a day of the gym's calendar. `who` is an account, or only a record. */
  const visit = async (gym: Gym, who: { userId?: string; entryId?: string }, day: string, method: "pass" | "staff" | "manual" = "pass", slot = 0): Promise<void> => {
    const desk_ = method === "pass";
    const opens = 360 + slot * 120;
    await sql`
      INSERT INTO gym_attendance
        (gym_id, user_id, entry_id, device_id, marked_by_user_id, day, marked_at, method,
         hours_status, session_opens_minute, session_closes_minute, slot_key)
      VALUES (${gym.id}, ${who.userId ?? null}, ${who.entryId ?? null},
              ${desk_ ? gym.deviceId : null}, ${desk_ ? null : method === "staff" ? gym.owner.userId : (who.userId ?? null)},
              ${day}::date, (${day}::date + time '12:00') AT TIME ZONE 'Asia/Kolkata', ${method},
              'in_session', ${opens}, ${opens + 60}, ${`${String(opens)}-${String(opens + 60)}`})`;
  };
  const visits = async (gym: Gym, userId: string, days: readonly string[]) => {
    for (const day of days) await visit(gym, { userId }, day);
  };

  const base = (gymId: string) => `/v1/orgs/${gymId}/challenges`;
  /** This week's gym-days challenge for everyone: Mon 5 to Sun 11 October. */
  const fields = (over: Record<string, unknown> = {}) => ({
    challengeKey: randomUUID(),
    name: "October Week",
    details: "",
    prize: "",
    counts: "gym_days",
    startsOn: "2026-10-05",
    endsOn: "2026-10-11",
    target: null,
    who: "everyone",
    ...over,
  });
  const changed = (over: Record<string, unknown> = {}) => {
    const body: Record<string, unknown> = fields(over);
    delete body["challengeKey"];
    return body;
  };
  const add = async (gym: Gym, over: Record<string, unknown> = {}, who: Person = gym.owner): Promise<StaffGymChallenge> => {
    const res = await inject("POST", base(gym.id), who.cookies, fields(over));
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { challenge: StaffGymChallenge }).challenge;
  };
  const list = async (gym: Gym, who: Person): Promise<GymChallengesResponse> => {
    const res = await inject("GET", base(gym.id), who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as GymChallengesResponse;
  };
  const seen = async (gym: Gym, who: Person, id: string): Promise<MemberGymChallenge> => {
    const found = (await list(gym, who)).challenges.find((c) => c.id === id);
    if (found === undefined) throw new Error("the challenge is not on this member's list");
    return found;
  };
  const boardOf = async (gym: Gym, who: Person, id: string): Promise<GymChallengeBoardResponse> => {
    const res = await inject("GET", `${base(gym.id)}/${id}/board`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as GymChallengeBoardResponse;
  };
  const staffList = async (gym: Gym, who: Person = gym.owner): Promise<StaffGymChallengesResponse> => {
    const res = await inject("GET", `${base(gym.id)}/staff`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as StaffGymChallengesResponse;
  };
  const staffBoard = async (gym: Gym, id: string, who: Person = gym.owner): Promise<StaffGymChallengeBoardResponse> => {
    const res = await inject("GET", `${base(gym.id)}/${id}/board/staff`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as StaffGymChallengeBoardResponse;
  };
  const joinAs = (gym: Gym, who: Person, id: string, target = api()) => inject("PUT", `${base(gym.id)}/${id}/joined`, who.cookies, undefined, nextIp(), target);
  const leaveAs = (gym: Gym, who: Person, id: string) => inject("DELETE", `${base(gym.id)}/${id}/joined`, who.cookies);
  const joinRows = async (id: string): Promise<number> => {
    const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_challenge_people WHERE challenge_id = ${id}`;
    return rows[0]?.n ?? 0;
  };
  const putIn = async (gymId: string, id: string, userIds: readonly string[]) => {
    for (const userId of userIds) await sql`INSERT INTO gym_challenge_people (gym_id, challenge_id, user_id) VALUES (${gymId}, ${id}, ${userId})`;
  };
  const audits = async (gymId: string, action: string): Promise<number> => {
    const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${gymId} AND action = ${action}`;
    return rows[0]?.n ?? 0;
  };
  const places = (rows: readonly { name: string | null; place: number | null; value: number }[]) => rows.map((r) => [r.name, r.place, r.value]);

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    const overrides = { redis, orgs: { now: () => clock } };
    app = await buildApp(loadConfig(baseEnv), overrides);
    await api().ready();
    second = await buildApp(loadConfig(baseEnv), overrides);
    await second.ready();
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await second?.close();
    await sql.end({ timeout: 5 });
  }, T);

  // ===========================================================================
  // THE WORST THING, FIRST
  // ===========================================================================

  it(
    "a hidden member, a removed one and a deleted account show to nobody else: not in a place, the count who joined, the count who reached the target, or a gap",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("Hidden Hall");
      const vera = await member(gym, "Vera Viewer");
      const asha = await account("Asha Rao");
      const bilal = await account("Bilal Khan");
      const chen = await account("Chen Wu");
      for (const p of [asha, bilal, chen]) await inGym(gym.id, p.userId);

      // Five ways to be hidden, a removed member and a deleted account: each with MORE gym
      // days in the challenge than anybody shown, and past its target.
      const hema = await member(gym, "Hema Hidden");
      await sql`UPDATE users SET leaderboard_opt_out = true WHERE id = ${hema.userId}`;
      const young = await account("Yuvi Young");
      await sql`INSERT INTO user_fitness_profiles (user_id, age) VALUES (${young.userId}, 16)`;
      const youngByRecord = await account("Rhea Record");
      const takenOff = await account("Tariq Taken");
      const nameless = await account("x", "nameless");
      await sql`UPDATE users SET display_name = split_part(email::text, '@', 1) WHERE id = ${nameless.userId}`;
      await inGym(gym.id, young.userId);
      await inGym(gym.id, youngByRecord.userId, await record(gym.id, "Rhea Record", "2010-03-01"));
      await inGym(gym.id, takenOff.userId);
      await sql`UPDATE gym_members SET hidden_from_boards = true WHERE gym_id = ${gym.id} AND user_id = ${takenOff.userId}`;
      await inGym(gym.id, nameless.userId);
      const removed = await member(gym, "Rana Removed");
      await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${gym.id} AND user_id = ${removed.userId}`;
      const deleted = await account("Dev Deleted");
      await inGym(gym.id, deleted.userId);
      await sql`UPDATE users SET status = 'deleted' WHERE id = ${deleted.userId}`;
      const hidden = [hema, young, youngByRecord, takenOff, nameless];
      const gone = [removed, deleted];

      const seven = ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05", "2026-10-06", "2026-10-07"];
      for (const h of [...hidden, ...gone]) await visits(gym, h.userId, seven);
      await visits(gym, asha.userId, ["2026-10-05", "2026-10-06", "2026-10-07"]);
      await visits(gym, bilal.userId, ["2026-10-05", "2026-10-06"]);
      await visits(gym, chen.userId, ["2026-10-06", "2026-10-07"]);
      await visits(gym, vera.userId, ["2026-10-07"]);

      const span = { startsOn: "2026-09-07", endsOn: "2026-10-31", target: 3 };
      const open = await add(gym, { name: "Autumn Open", ...span });
      const joiners = await add(gym, { name: "Autumn Joiners", ...span, who: "joined" });
      await putIn(gym.id, joiners.id, [vera, asha, bilal, chen, ...hidden, ...gone].map((p) => p.userId));

      const res = await inject("GET", base(gym.id), vera.cookies);
      expect(res.statusCode).toBe(200);
      // Nothing of theirs anywhere in what another member is sent.
      for (const h of [...hidden, ...gone]) expect(res.body).not.toContain(h.userId);
      for (const name of ["Hema", "Yuvi", "Rhea", "Tariq", "Rana", "Dev"]) expect(res.body).not.toContain(name);

      const sent = JSON.parse(res.body) as GymChallengesResponse;
      for (const id of [open.id, joiners.id]) {
        const c = sent.challenges.find((x) => x.id === id);
        expect(c?.board.status).toBe("shown");
        expect(c?.board.ranked).toBe(4);
        expect(places(c?.board.top ?? [])).toEqual([["Asha R.", 1, 3], ["Bilal K.", 2, 2], ["Chen W.", 2, 2]]);
        // Only Asha: the seven people past the target whom Vera may not see are not counted.
        expect(c?.board.reached).toBe(1);
        // One leader: the hidden seven who are ahead of her make no tie and no gap.
        expect(c?.board.leaders).toBe(1);
        expect([c?.me?.value, c?.me?.place, c?.me?.toNextPlace, c?.me?.nextPlace]).toEqual([1, 4, 1, 2]);

        const board = await boardOf(gym, vera, id);
        expect(places(board.rows)).toEqual([["Asha R.", 1, 3], ["Bilal K.", 2, 2], ["Chen W.", 2, 2], ["Vera V.", 4, 1]]);
        expect(board.ranked).toBe(4);
        for (const h of [...hidden, ...gone]) expect(JSON.stringify(board)).not.toContain(h.userId);
      }
      // Who joined, as Vera may count them: the three she sees and herself.
      expect(sent.challenges.find((x) => x.id === joiners.id)?.joinedCount).toBe(4);
      expect(sent.challenges.find((x) => x.id === open.id)?.joinedCount).toBeNull();

      // The hidden person still has their own line, and is told why nobody else sees it.
      const hers = await seen(gym, hema, joiners.id);
      expect([hers.me?.value, hers.me?.hidden, hers.me?.reached, hers.me?.days]).toEqual([7, "hide_me", true, seven]);
      expect(places(hers.board.top)).toEqual([["Asha R.", 1, 3], ["Bilal K.", 2, 2], ["Chen W.", 2, 2]]);
      expect(hers.board.top.every((r) => !r.isMe)).toBe(true);
      // She counts herself among who joined, and nobody else who is hidden.
      expect(hers.joinedCount).toBe(5);

      // The removed member is sent nothing at all.
      for (const path of [base(gym.id), `${base(gym.id)}/${open.id}/board`]) expect((await inject("GET", path, removed.cookies)).statusCode).toBe(404);

      // Staff see everyone still in the app here, the hidden with the reason; never the removed or deleted.
      const staff = await staffBoard(gym, joiners.id);
      expect([staff.total, staff.ranked, staff.hidden, staff.reached, staff.memberStatus]).toEqual([9, 4, 5, 6, "shown"]);
      expect(staff.rows.filter((r) => r.hidden !== null).map((r) => [r.hidden, r.place, r.value]).sort()).toEqual(
        [["hide_me", null, 7], ["no_name", null, 7], ["taken_off", null, 7], ["under_18", null, 7], ["under_18", null, 7]].sort(),
      );
      for (const g of gone) expect(JSON.stringify(staff)).not.toContain(g.userId);
      // Staff's card: the first three as members see them placed, by full name; nobody
      // hidden among them, though the hidden are in how many have a number.
      const card = (await staffList(gym)).current.find((x) => x.id === joiners.id);
      expect(places(card?.top ?? [])).toEqual([["Asha Rao", 1, 3], ["Bilal Khan", 2, 2], ["Chen Wu", 2, 2]]);
      expect(card?.withNumber).toBe(9);
      for (const h of [...hidden, ...gone]) expect(JSON.stringify(card?.top)).not.toContain(h.userId);
    },
    T,
  );

  // ===========================================================================
  // WHO MAY READ AND WRITE
  // ===========================================================================

  it(
    "a stranger, a removed member, another gym's member and another gym's owner get 404 everywhere; staff without the tick get 403",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("Locked Lifts");
      const other = await makeGym("Other Gym");
      const mine = await member(gym, "Mina Member");
      const theirs = await member(other, "Otto Other");
      const stranger = await signedIn("Sid Stranger");
      const removed = await member(gym, "Rex Removed");
      await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${gym.id} AND user_id = ${removed.userId}`;
      const trainer = await signedIn("Tia Trainer");
      await addStaff(gym.id, trainer.userId, "trainer");
      const c = await add(gym, { who: "joined" });
      const otherC = await add(other, { who: "joined" });

      const memberRoutes: ["GET" | "PUT" | "DELETE", string][] = [
        ["GET", base(gym.id)],
        ["GET", `${base(gym.id)}/${c.id}/board`],
        ["PUT", `${base(gym.id)}/${c.id}/joined`],
        ["DELETE", `${base(gym.id)}/${c.id}/joined`],
      ];
      for (const who of [stranger, removed, theirs, other.owner, trainer, gym.owner]) {
        for (const [method, path] of memberRoutes) expect((await inject(method, path, who.cookies)).statusCode, `${method} ${path}`).toBe(404);
      }
      expect(await joinRows(c.id)).toBe(0);
      for (const [method, path] of memberRoutes) expect((await inject(method, path, {})).statusCode, `${method} ${path} signed out`).toBe(401);

      const staffRoutes: ["GET" | "POST" | "PUT", string, unknown][] = [
        ["GET", `${base(gym.id)}/staff`, undefined],
        ["GET", `${base(gym.id)}/${c.id}/board/staff`, undefined],
        ["POST", base(gym.id), fields()],
        ["PUT", `${base(gym.id)}/${c.id}`, changed({ name: "Taken over" })],
        ["PUT", `${base(gym.id)}/${c.id}/cancelled`, { cancelled: true }],
      ];
      for (const who of [stranger, mine, theirs, other.owner, removed]) {
        for (const [method, path, body] of staffRoutes) expect((await inject(method, path, who.cookies, body)).statusCode, `${method} ${path}`).toBe(404);
      }
      for (const [method, path, body] of staffRoutes) {
        const res = await inject(method, path, trainer.cookies, body);
        expect([res.statusCode, codeOf(res)], `${method} ${path}`).toEqual([403, "forbidden"]);
      }

      // Another gym's challenge under this gym's address is nobody's: not for its member, not for its staff.
      expect((await inject("GET", `${base(gym.id)}/${otherC.id}/board`, mine.cookies)).statusCode).toBe(404);
      expect((await joinAs(gym, mine, otherC.id)).statusCode).toBe(404);
      for (const [method, path, body] of [
        ["GET", `${base(gym.id)}/${otherC.id}/board/staff`, undefined],
        ["PUT", `${base(gym.id)}/${otherC.id}`, changed({ name: "Taken over" })],
        ["PUT", `${base(gym.id)}/${otherC.id}/cancelled`, { cancelled: true }],
      ] as const) {
        const res = await inject(method, path, gym.owner.cookies, body);
        expect([res.statusCode, codeOf(res)], path).toEqual([404, "challenge_not_found"]);
      }
      expect(await joinRows(otherC.id)).toBe(0);
      expect((await staffList(other)).current.map((x) => [x.name, x.cancelled])).toEqual([["October Week", false]]);
      expect((await staffList(gym)).current.map((x) => [x.name, x.cancelled])).toEqual([["October Week", false]]);
      expect((await audits(gym.id, "org.challenge_changed")) + (await audits(gym.id, "org.challenge_cancelled"))).toBe(0);
    },
    T,
  );

  // ===========================================================================
  // THE BOARD IS THE LEADERBOARD'S OWN COUNT
  // ===========================================================================

  it(
    "over the same dates a challenge's places and numbers are the leaderboard's, for gym days and for workout days",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("Same Count");
      const vera = await member(gym, "Vera Viewer");
      const people = [await account("Asha Rao"), await account("Bilal Khan"), await account("Chen Wu"), await account("Dina Das")];
      for (const p of people) await inGym(gym.id, p.userId);
      const [asha, bilal, chen, dina] = people;
      if (asha === undefined || bilal === undefined || chen === undefined || dina === undefined) throw new Error("no people");
      // A record one member holds: its account-less visits are theirs.
      const viaRecord = await account("Esha Entry");
      const entry = await record(gym.id, "Esha Entry");
      await inGym(gym.id, viaRecord.userId, entry);

      await visits(gym, asha.userId, ["2026-10-05", "2026-10-06", "2026-10-07"]);
      await visit(gym, { userId: asha.userId }, "2026-10-07", "staff", 1); // twice in a day is one day
      await visits(gym, bilal.userId, ["2026-10-05", "2026-10-07"]);
      await visits(gym, chen.userId, ["2026-10-06", "2026-10-07"]);
      await visits(gym, dina.userId, ["2026-10-04", "2026-09-30"]); // last week: outside it
      await visit(gym, { userId: dina.userId }, "2026-10-06", "manual", 2); // her own tap never counts
      await visit(gym, { entryId: entry }, "2026-10-06");
      await visits(gym, vera.userId, ["2026-10-05"]);

      for (const day of ["2026-10-05", "2026-10-06", "2026-10-07"]) await workout(bilal.userId, day);
      await workout(bilal.userId, "2026-10-06"); // two on one day is one day
      for (const day of ["2026-10-05", "2026-10-07"]) await workout(chen.userId, day);
      await workout(dina.userId, "2026-10-06");
      await workout(asha.userId, "2026-09-28", 9); // last week, and saved late
      await workout(vera.userId, "2026-10-07");
      await workout(vera.userId, "2026-10-04"); // the day before it starts

      const gymDays = await add(gym, { name: "Week of gym days" });
      const workoutDays = await add(gym, { name: "Week of workouts", counts: "workout_days" });

      for (const [challenge, board] of [[gymDays, "gym_days"], [workoutDays, "workout_days"]] as const) {
        const lb = await inject("GET", `/v1/orgs/${gym.id}/leaderboard?board=${board}&period=this_week`, vera.cookies);
        expect(lb.statusCode).toBe(200);
        const theirs = JSON.parse(lb.body) as LeaderboardResponse;
        expect(theirs.status).toBe("shown");
        const ours = await boardOf(gym, vera, challenge.id);
        const row = (r: { userId: string; name: string; initials: string; place: number; value: number; isMe: boolean }) => [r.userId, r.name, r.initials, r.place, r.value, r.isMe];
        expect(ours.rows.map(row)).toEqual(theirs.rows.map(row));
        expect(ours.ranked).toBe(theirs.ranked);
        expect([ours.me?.value, ours.me?.place, ours.me?.toNextPlace, ours.me?.nextPlace, ours.me?.hidden]).toEqual([
          theirs.me.value,
          theirs.me.place,
          theirs.me.toNextPlace,
          theirs.me.nextPlace,
          theirs.me.hidden,
        ]);
        // The card's top three are the board's first three.
        expect((await seen(gym, vera, challenge.id)).board.top).toEqual(ours.rows.slice(0, 3));
      }
      // And the numbers themselves, written out: not only "the same as".
      expect(places((await boardOf(gym, vera, gymDays.id)).rows)).toEqual([["Asha R.", 1, 3], ["Bilal K.", 2, 2], ["Chen W.", 2, 2], ["Esha E.", 4, 1], ["Vera V.", 4, 1]]);
      expect(places((await boardOf(gym, vera, workoutDays.id)).rows)).toEqual([["Bilal K.", 1, 3], ["Chen W.", 2, 2], ["Dina D.", 3, 1], ["Vera V.", 3, 1]]);
      // A member's own days are the list their number is.
      const mine = await seen(gym, vera, workoutDays.id);
      expect([mine.me?.value, mine.me?.days]).toEqual([1, ["2026-10-07"]]);
    },
    T,
  );

  it(
    "fewer than three people with a number: no place, no count, nobody named; the member still has their own number",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("Two Only");
      const vera = await member(gym, "Vera Viewer");
      const asha = await account("Asha Rao");
      await inGym(gym.id, asha.userId);
      await visits(gym, asha.userId, ["2026-10-05", "2026-10-06"]);
      await visits(gym, vera.userId, ["2026-10-06"]);
      const c = await add(gym, { target: 1 });
      const mine = await seen(gym, vera, c.id);
      expect(mine.board).toEqual({ status: "too_few", ranked: 0, top: [], leaders: 0, reached: null });
      expect([mine.me?.value, mine.me?.place, mine.me?.toNextPlace, mine.me?.reached]).toEqual([1, null, null, true]);
      const board = await boardOf(gym, vera, c.id);
      expect([board.status, board.ranked, board.rows]).toEqual(["too_few", 0, []]);
      expect(JSON.stringify(board)).not.toContain(asha.userId);
      // Staff see both, with no place: members see none.
      const staff = await staffBoard(gym, c.id);
      expect(places(staff.rows)).toEqual([["Asha Rao", null, 2], ["Vera Viewer", null, 1]]);
      expect([staff.memberStatus, staff.ranked, staff.reached]).toEqual(["too_few", 0, 2]);
      // Two people: the card names nobody, and says two have a number.
      const card = (await staffList(gym)).current[0];
      expect([card?.top, card?.withNumber]).toEqual([[], 2]);
    },
    T,
  );

  // ===========================================================================
  // JOINING
  // ===========================================================================

  it(
    "a challenge people join counts only the people who joined; joining late counts their days since its first day; leaving takes them off",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("Join Up");
      const vera = await member(gym, "Vera Viewer");
      const asha = await member(gym, "Asha Rao");
      const bilal = await member(gym, "Bilal Khan");
      const chen = await member(gym, "Chen Wu");
      const dina = await member(gym, "Dina Das");
      for (const p of [vera, asha, bilal, chen, dina]) await visits(gym, p.userId, ["2026-10-05", "2026-10-06"]);
      await visits(gym, asha.userId, ["2026-10-07"]);
      const c = await add(gym, { who: "joined", target: 3 });

      // Nobody has joined: nobody is in it, whatever their gym days.
      const before = await seen(gym, vera, c.id);
      expect([before.joined, before.can, before.joinedCount, before.me, before.board.status]).toEqual([false, { join: true, leave: false, pick: false }, 0, null, "too_few"]);

      for (const p of [asha, bilal, chen]) expect((await joinAs(gym, p, c.id)).statusCode).toBe(200);
      const outside = await seen(gym, vera, c.id);
      expect([outside.joined, outside.joinedCount, outside.me, outside.board.ranked, outside.board.reached]).toEqual([false, 3, null, 3, 1]);
      expect(places(outside.board.top)).toEqual([["Asha R.", 1, 3], ["Bilal K.", 2, 2], ["Chen W.", 2, 2]]);

      // Vera joins on the third day: the two days she already came count.
      const res = await joinAs(gym, vera, c.id);
      expect(res.statusCode).toBe(200);
      const mine = (JSON.parse(res.body) as { challenge: MemberGymChallenge }).challenge;
      expect([mine.joined, mine.can, mine.joinedCount]).toEqual([true, { join: false, leave: true, pick: false }, 4]);
      expect([mine.me?.value, mine.me?.place, mine.me?.days]).toEqual([2, 2, ["2026-10-05", "2026-10-06"]]);
      expect(places((await boardOf(gym, vera, c.id)).rows)).toEqual([["Asha R.", 1, 3], ["Bilal K.", 2, 2], ["Chen W.", 2, 2], ["Vera V.", 2, 2]]);

      // Dina never joined: she is on no line of it, for a member or for staff.
      const staff = await staffBoard(gym, c.id);
      expect(places(staff.rows)).toEqual([["Asha Rao", 1, 3], ["Bilal Khan", 2, 2], ["Chen Wu", 2, 2], ["Vera Viewer", 2, 2]]);
      expect((await staffList(gym)).current[0]?.joinedCount).toBe(4);

      // She leaves: off the board, and asked again it changes nothing.
      for (let i = 0; i < 2; i++) {
        const left = await leaveAs(gym, vera, c.id);
        expect(left.statusCode).toBe(200);
        const now = (JSON.parse(left.body) as { challenge: MemberGymChallenge }).challenge;
        expect([now.joined, now.joinedCount, now.me, now.board.ranked]).toEqual([false, 3, null, 3]);
      }
      expect(await joinRows(c.id)).toBe(3);
    },
    T,
  );

  it(
    "joined at the same instant from two servers, and joined again, a person is in it once; somebody who joined and has nothing yet is on staff's list at 0",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("Join Once");
      const vera = await member(gym, "Vera Viewer");
      const c = await add(gym, { who: "joined", startsOn: "2026-10-12", endsOn: "2026-10-18" });
      const both = await Promise.all([joinAs(gym, vera, c.id), joinAs(gym, vera, c.id, second), joinAs(gym, vera, c.id), joinAs(gym, vera, c.id, second)]);
      expect(both.map((r) => r.statusCode)).toEqual([200, 200, 200, 200]);
      expect((await joinAs(gym, vera, c.id)).statusCode).toBe(200);
      expect(await joinRows(c.id)).toBe(1);

      // It has not started: no board yet, and she has a line at nothing.
      const mine = await seen(gym, vera, c.id);
      expect([mine.state, mine.board.status, mine.me?.value, mine.me?.days, mine.joinedCount]).toEqual(["coming", "not_started", 0, [], 1]);
      const staff = await staffBoard(gym, c.id);
      expect([staff.memberStatus, staff.total, staff.hidden, places(staff.rows)]).toEqual(["not_started", 1, 0, [["Vera Viewer", null, 0]]]);
    },
    T,
  );

  it(
    "nobody joins everyone's challenge, a cancelled one or one that has ended, and each is told why",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("No Join");
      const vera = await member(gym, "Vera Viewer");
      const everyone = await add(gym, { name: "Everyone's" });
      const cancelled = await add(gym, { name: "Called off", who: "joined" });
      const ending = await add(gym, { name: "Ends today", who: "joined", endsOn: "2026-10-07" });
      expect((await inject("PUT", `${base(gym.id)}/${cancelled.id}/cancelled`, gym.owner.cookies, { cancelled: true })).statusCode).toBe(200);

      const refusedJoin = async (id: string) => {
        const res = await joinAs(gym, vera, id);
        return [res.statusCode, codeOf(res), (JSON.parse(res.body) as { message: string }).message];
      };
      expect(await refusedJoin(everyone.id)).toEqual([409, "challenge_everyone", GYM_CHALLENGE_WORDS.join_everyone]);
      expect(await refusedJoin(cancelled.id)).toEqual([409, "challenge_cancelled", GYM_CHALLENGE_WORDS.cancelled]);
      // Its last day is still open for joining, to the gym's own midnight.
      expect((await joinAs(gym, vera, ending.id)).statusCode).toBe(200);
      clock = new Date("2026-10-07T18:29:00Z"); // 23:59 in Kolkata
      expect((await leaveAs(gym, vera, ending.id)).statusCode).toBe(200);
      expect((await joinAs(gym, vera, ending.id)).statusCode).toBe(200);
      clock = new Date("2026-10-07T18:31:00Z"); // 00:01 the next day in Kolkata
      expect(await refusedJoin(ending.id)).toEqual([409, "challenge_ended", GYM_CHALLENGE_WORDS.join_ended]);
      const left = await leaveAs(gym, vera, ending.id);
      expect([left.statusCode, codeOf(left)]).toEqual([409, "challenge_ended"]);
      expect(await joinRows(ending.id)).toBe(1);
      expect((await seen(gym, vera, ending.id)).can).toEqual({ join: false, leave: false, pick: false });
      clock = WEDNESDAY;
    },
    T,
  );

  // ===========================================================================
  // THE GYM'S OWN CALENDAR
  // ===========================================================================

  it(
    "running, coming and ended are the gym's own days: the list's order, a result kept for a fortnight, a cancelled one for a week",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("Calendar Club");
      const vera = await member(gym, "Vera Viewer");
      const others = [await account("Asha Rao"), await account("Bilal Khan")];
      for (const p of others) await inGym(gym.id, p.userId);
      for (const p of [vera, ...others]) await visits(gym, p.userId, ["2026-10-06", "2026-10-07"]);

      await add(gym, { name: "This week" }); // ends Sun 11
      const today = await add(gym, { name: "Ends today", startsOn: "2026-10-01", endsOn: "2026-10-07" });
      const next = await add(gym, { name: "Next week", startsOn: "2026-10-12", endsOn: "2026-10-18" });
      const later = await add(gym, { name: "November", startsOn: "2026-11-01", endsOn: "2026-11-30" });
      const names = async () => (await list(gym, vera)).challenges.map((c) => [c.name, c.state]);
      expect(await names()).toEqual([["Ends today", "running"], ["This week", "running"], ["Next week", "coming"], ["November", "coming"]]);
      // A challenge not started counts nothing, though people have gym days.
      expect((await seen(gym, vera, next.id)).board).toEqual({ status: "not_started", ranked: 0, top: [], leaders: 0, reached: null });

      // 23:59 on its last day in Kolkata it is still running; a minute past midnight it has ended.
      clock = new Date("2026-10-07T18:29:00Z");
      expect((await seen(gym, vera, today.id)).state).toBe("running");
      clock = new Date("2026-10-07T18:31:00Z");
      const ended = await seen(gym, vera, today.id);
      expect([ended.state, ended.board.status, ended.board.leaders, ended.me?.value, places(ended.board.top)]).toEqual([
        "ended",
        "shown",
        3,
        2,
        [["Asha R.", 1, 2], ["Bilal K.", 1, 2], ["Vera V.", 1, 2]],
      ]);
      expect(await names()).toEqual([["This week", "running"], ["Next week", "coming"], ["November", "coming"], ["Ends today", "ended"]]);
      // Staff: it has moved to the past list, and cannot be changed or cancelled.
      const staff = await staffList(gym);
      expect([staff.current.map((c) => c.name), staff.past.map((c) => c.name), staff.pastTotal]).toEqual([["This week", "Next week", "November"], ["Ends today"], 1]);
      const change = await inject("PUT", `${base(gym.id)}/${today.id}`, gym.owner.cookies, changed({ name: "Ends today", startsOn: "2026-10-01", endsOn: "2026-10-20" }));
      expect([change.statusCode, codeOf(change)]).toEqual([409, "challenge_ended"]);
      const cancel = await inject("PUT", `${base(gym.id)}/${today.id}/cancelled`, gym.owner.cookies, { cancelled: true });
      expect([cancel.statusCode, codeOf(cancel)]).toEqual([409, "challenge_ended"]);

      // Its result is on the members' list for fourteen days after its last day, then gone.
      clock = new Date("2026-10-21T06:30:00Z");
      expect((await names()).some(([name]) => name === "Ends today")).toBe(true);
      clock = new Date("2026-10-22T06:30:00Z");
      expect((await names()).some(([name]) => name === "Ends today")).toBe(false);
      expect((await inject("GET", `${base(gym.id)}/${today.id}/board`, vera.cookies)).statusCode).toBe(404);
      // Staff still have it.
      expect((await staffBoard(gym, today.id)).total).toBe(3);

      // A cancelled one stays, marked and with no board, for seven days after it was cancelled.
      clock = new Date("2026-11-02T06:30:00Z");
      expect((await inject("PUT", `${base(gym.id)}/${later.id}/cancelled`, gym.owner.cookies, { cancelled: true })).statusCode).toBe(200);
      const marked = await seen(gym, vera, later.id);
      expect([marked.cancelled, marked.board, marked.me, marked.can]).toEqual([true, { status: "not_started", ranked: 0, top: [], leaders: 0, reached: null }, null, { join: false, leave: false, pick: false }]);
      clock = new Date("2026-11-09T06:29:00Z");
      expect((await names()).some(([name]) => name === "November")).toBe(true);
      clock = new Date("2026-11-09T06:31:00Z");
      expect((await names()).some(([name]) => name === "November")).toBe(false);
      expect((await staffList(gym)).current.map((c) => [c.name, c.cancelled])).toEqual([["November", true]]);
      clock = WEDNESDAY;
    },
    T,
  );

  it(
    "a gym on no plan: its members are sent no challenge, its staff can read and cannot change",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("Lapsed Lifts");
      const vera = await member(gym, "Vera Viewer");
      const c = await add(gym, { who: "joined" });
      await lapse(gym.id);
      const sent = await list(gym, vera);
      expect([sent.status, sent.challenges]).toEqual(["paused", []]);
      expect((await inject("GET", `${base(gym.id)}/${c.id}/board`, vera.cookies)).statusCode).toBe(404);
      expect((await joinAs(gym, vera, c.id)).statusCode).toBe(404);
      expect(await joinRows(c.id)).toBe(0);
      expect((await staffList(gym)).current).toHaveLength(1);
      for (const [method, path, body] of [
        ["POST", base(gym.id), fields()],
        ["PUT", `${base(gym.id)}/${c.id}`, changed({ name: "Renamed", who: "joined" })],
        ["PUT", `${base(gym.id)}/${c.id}/cancelled`, { cancelled: true }],
      ] as const) {
        const res = await inject(method, path, gym.owner.cookies, body);
        expect([res.statusCode, codeOf(res)], path).toEqual([409, "gym_not_on_plan"]);
      }
      expect((await staffList(gym)).current.map((x) => [x.name, x.cancelled])).toEqual([["October Week", false]]);
    },
    T,
  );

  // ===========================================================================
  // STAFF MAKE AND CHANGE THEM
  // ===========================================================================

  it(
    "a challenge is added once under its key, and what cannot be kept is refused in a sentence",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("Maker Gym");
      const body = fields({ name: "  Autumn 20  ", prize: " A shaker ", target: 5, who: "joined" });
      const first = await inject("POST", base(gym.id), gym.owner.cookies, body);
      const again = await inject("POST", base(gym.id), gym.owner.cookies, { ...body, name: "Typed again" });
      expect([first.statusCode, again.statusCode]).toEqual([201, 201]);
      const kept = (JSON.parse(again.body) as { challenge: StaffGymChallenge }).challenge;
      expect(kept).toEqual({
        id: (JSON.parse(first.body) as { challenge: StaffGymChallenge }).challenge.id,
        name: "Autumn 20",
        details: "",
        prize: "A shaker",
        counts: "gym_days",
        startsOn: "2026-10-05",
        endsOn: "2026-10-11",
        target: 5,
        who: "joined",
        unit: "",
        lowestWins: false,
        teams: "none",
        cancelled: false,
        state: "running",
        joinedCount: 0,
        top: [],
        withNumber: null,
        teamList: [],
        resultPost: null,
      });
      expect((await staffList(gym)).current).toHaveLength(1);
      expect(await audits(gym.id, "org.challenge_added")).toBe(1);

      const refusedAdd = async (over: Record<string, unknown>) => {
        const res = await inject("POST", base(gym.id), gym.owner.cookies, fields(over));
        return [res.statusCode, codeOf(res)];
      };
      expect(await refusedAdd({ target: 8 })).toEqual([400, "validation_error"]); // seven days, a target of eight
      expect(await refusedAdd({ endsOn: "2026-10-04" })).toEqual([400, "validation_error"]);
      expect(await refusedAdd({ name: " " })).toEqual([400, "validation_error"]);
      expect(await refusedAdd({ startsOn: "2026-09-05", endsOn: "2026-10-31" })).toEqual([400, "challenge_starts_too_early"]);
      expect(await refusedAdd({ startsOn: "2027-10-08", endsOn: "2027-10-31" })).toEqual([400, "challenge_starts_too_far"]);
      expect(await refusedAdd({ startsOn: "2026-09-20", endsOn: "2026-10-06" })).toEqual([400, "challenge_ends_before_today"]);
      // The gym's own date decides: at 23:59 in Kolkata today is still the 7th.
      clock = new Date("2026-10-07T18:29:00Z");
      expect(await refusedAdd({ startsOn: "2026-10-01", endsOn: "2026-10-07" })).toEqual([201, undefined]);
      clock = new Date("2026-10-07T18:31:00Z");
      expect(await refusedAdd({ startsOn: "2026-10-01", endsOn: "2026-10-07" })).toEqual([400, "challenge_ends_before_today"]);
      clock = WEDNESDAY;
      expect((await staffList(gym)).current).toHaveLength(2);
    },
    T,
  );

  it(
    "a gym keeps six that have not ended: one more is refused, four added at once with room for one leave six, and an ended one frees a place",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("Six Only");
      for (let i = 0; i < GYM_CHALLENGES_CURRENT_MAX - 1; i++) await add(gym, { name: `Challenge ${String(i)}`, endsOn: i === 0 ? "2026-10-07" : "2026-10-11" });
      const four = await Promise.all([0, 1, 2, 3].map((i) => inject("POST", base(gym.id), gym.owner.cookies, fields({ name: `At once ${String(i)}` }), nextIp(), i % 2 === 0 ? api() : second)));
      expect(four.map((r) => r.statusCode).sort()).toEqual([201, 409, 409, 409]);
      expect(four.filter((r) => r.statusCode === 409).map(codeOf)).toEqual(["challenges_full", "challenges_full", "challenges_full"]);
      expect((await staffList(gym)).current).toHaveLength(GYM_CHALLENGES_CURRENT_MAX);
      // Tomorrow the one that ended today is past, and there is room for one more.
      clock = new Date(WEDNESDAY.getTime() + DAY_MS);
      expect((await inject("POST", base(gym.id), gym.owner.cookies, fields({ name: "Room now" }))).statusCode).toBe(201);
      const after = await staffList(gym);
      expect([after.current.length, after.pastTotal]).toEqual([GYM_CHALLENGES_CURRENT_MAX, 1]);
      clock = WEDNESDAY;
    },
    T,
  );

  it(
    "before it starts everything can change; once it has started what is counted, its first day, who is in it and its target cannot",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("Change Gym");
      const coming = await add(gym, { name: "Next week", startsOn: "2026-10-12", endsOn: "2026-10-18" });
      const put = (id: string, body: Record<string, unknown>) => inject("PUT", `${base(gym.id)}/${id}`, gym.owner.cookies, body);
      const all = await put(coming.id, changed({ name: "Next fortnight", details: "Bring a friend", prize: "A towel", counts: "workout_days", startsOn: "2026-10-13", endsOn: "2026-10-26", target: 10, who: "joined" }));
      expect(all.statusCode).toBe(200);
      expect((JSON.parse(all.body) as { challenge: StaffGymChallenge }).challenge).toMatchObject({
        name: "Next fortnight",
        details: "Bring a friend",
        prize: "A towel",
        counts: "workout_days",
        startsOn: "2026-10-13",
        endsOn: "2026-10-26",
        target: 10,
        who: "joined",
        state: "coming",
      });

      const running = await add(gym, { name: "Running", target: 2, who: "joined" });
      const kept = { name: "Running", target: 2, who: "joined" };
      for (const over of [{ counts: "workout_days" }, { startsOn: "2026-10-06" }, { who: "everyone" }, { target: 5 }, { target: null }]) {
        const res = await put(running.id, changed({ ...kept, ...over }));
        expect([res.statusCode, codeOf(res), (JSON.parse(res.body) as { message: string }).message], JSON.stringify(over)).toEqual([409, "challenge_started", GYM_CHALLENGE_WORDS.started_locked]);
      }
      const early = await put(running.id, changed({ ...kept, endsOn: "2026-10-06" }));
      expect([early.statusCode, codeOf(early)]).toEqual([400, "challenge_ends_before_today"]);
      const allowed = await put(running.id, changed({ ...kept, name: "Running on", details: "Longer now", prize: "A shaker", endsOn: "2026-10-18" }));
      expect(allowed.statusCode).toBe(200);
      expect((await staffList(gym)).current.find((c) => c.id === running.id)).toMatchObject({ name: "Running on", details: "Longer now", prize: "A shaker", endsOn: "2026-10-18", counts: "gym_days", target: 2 });
      expect(await audits(gym.id, "org.challenge_changed")).toBe(2);
      expect((await put(randomUUID(), changed())).statusCode).toBe(404);
    },
    T,
  );

  it(
    "cancel and un-cancel are each done once however often they are asked, and everybody who joined is still in it when it comes back",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("Cancel Gym");
      const vera = await member(gym, "Vera Viewer");
      const c = await add(gym, { who: "joined" });
      expect((await joinAs(gym, vera, c.id)).statusCode).toBe(200);
      const set = (cancelled: boolean, target = api()) => inject("PUT", `${base(gym.id)}/${c.id}/cancelled`, gym.owner.cookies, { cancelled }, nextIp(), target);
      const twice = await Promise.all([set(true), set(true, second)]);
      expect(twice.map((r) => r.statusCode)).toEqual([200, 200]);
      expect((await set(true)).statusCode).toBe(200);
      expect(await audits(gym.id, "org.challenge_cancelled")).toBe(1);
      expect((await seen(gym, vera, c.id)).cancelled).toBe(true);
      expect((await set(false)).statusCode).toBe(200);
      expect((await set(false)).statusCode).toBe(200);
      expect(await audits(gym.id, "org.challenge_uncancelled")).toBe(1);
      const back = await seen(gym, vera, c.id);
      expect([back.cancelled, back.joined, back.joinedCount, back.me?.value]).toEqual([false, true, 1, 0]);
    },
    T,
  );

  // ===========================================================================
  // THE GYM'S OWN COUNT: NUMBERS STAFF TYPE
  // ===========================================================================

  const setScores = (gym: Gym, id: string, scores: { userId: string; value: number | null }[], who: Person = gym.owner, target = api()) =>
    inject("PUT", `${base(gym.id)}/${id}/scores`, who.cookies, { scores }, nextIp(), target);
  const scoreRows = async (id: string): Promise<[string, number][]> => {
    const rows = await sql<{ user_id: string; value: number }[]>`SELECT user_id, value FROM gym_challenge_scores WHERE challenge_id = ${id} ORDER BY value DESC, user_id`;
    return rows.map((r) => [r.user_id, r.value]);
  };

  it(
    "the gym's own count: staff type each person's number; a hidden person still shows to nobody; a number typed again replaces the one before",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("Push-up Place");
      const other = await makeGym("Next Door");
      const vera = await member(gym, "Vera Viewer");
      const asha = await account("Asha Rao");
      const bilal = await account("Bilal Khan");
      const chen = await account("Chen Wu");
      for (const p of [asha, bilal, chen]) await inGym(gym.id, p.userId);
      const hema = await member(gym, "Hema Hidden");
      await sql`UPDATE users SET leaderboard_opt_out = true WHERE id = ${hema.userId}`;
      const outsider = await member(other, "Otto Other");
      const trainer = await signedIn("Tia Trainer");
      await addStaff(gym.id, trainer.userId, "trainer");

      const c = await add(gym, { name: "Push-up Day", counts: "own", unit: "push-ups", target: 50 });
      expect([c.counts, c.unit, c.target, c.lowestWins]).toEqual(["own", "push-ups", 50, false]);
      // Nothing typed yet: staff are sent everybody in it, each at 0, to type beside.
      const empty = await staffBoard(gym, c.id);
      expect([empty.total, empty.rows.every((r) => r.value === 0 && r.place === null)]).toEqual([5, true]);

      const first = await setScores(gym, c.id, [
        { userId: asha.userId, value: 60 },
        { userId: bilal.userId, value: 40 },
        { userId: chen.userId, value: 40 },
        { userId: vera.userId, value: 10 },
        { userId: hema.userId, value: 99 },
      ]);
      expect([first.statusCode, JSON.parse(first.body)]).toEqual([200, { saved: 5 }]);
      // Noted once, with how many people and nobody's name.
      const noted = await sql<{ meta: Record<string, string> }[]>`SELECT meta FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.challenge_scores_set'`;
      expect(noted.map((n) => n.meta)).toEqual([{ people: "5" }]);

      const res = await inject("GET", base(gym.id), vera.cookies);
      expect(res.body).not.toContain(hema.userId);
      expect(res.body).not.toContain("Hema");
      const mine = (JSON.parse(res.body) as GymChallengesResponse).challenges.find((x) => x.id === c.id);
      expect(mine?.board).toEqual({
        status: "shown",
        ranked: 4,
        top: [
          { userId: asha.userId, name: "Asha R.", initials: "AR", place: 1, value: 60, reached: true, isMe: false },
          { userId: bilal.userId, name: "Bilal K.", initials: "BK", place: 2, value: 40, reached: false, isMe: false },
          { userId: chen.userId, name: "Chen W.", initials: "CW", place: 2, value: 40, reached: false, isMe: false },
        ],
        leaders: 1,
        reached: 1,
      });
      expect(mine?.me).toEqual({ value: 10, place: 4, hidden: null, toNextPlace: 30, nextPlace: 2, reached: false, days: [] });
      // Staff see her, with the reason, and no place.
      const staff = await staffBoard(gym, c.id);
      expect(places(staff.rows)).toEqual([["Hema Hidden", null, 99], ["Asha Rao", 1, 60], ["Bilal Khan", 2, 40], ["Chen Wu", 2, 40], ["Vera Viewer", 4, 10]]);
      expect([staff.reached, staff.rows[0]?.hidden, staff.hidden, staff.total]).toEqual([2, "hide_me", 1, 5]);

      // Typed again, a number replaces the one before; sent twice it is the same; null and 0 take one off.
      const again = [{ userId: asha.userId, value: 45 }, { userId: chen.userId, value: null }, { userId: hema.userId, value: 0 }];
      const twice = await Promise.all([setScores(gym, c.id, again), setScores(gym, c.id, again, gym.owner, second)]);
      expect(twice.map((r) => r.statusCode)).toEqual([200, 200]);
      expect(await scoreRows(c.id)).toEqual([[asha.userId, 45], [bilal.userId, 40], [vera.userId, 10]]);
      const after = await seen(gym, vera, c.id);
      expect([places(after.board.top), after.board.reached, after.me?.place]).toEqual([[["Asha R.", 1, 45], ["Bilal K.", 2, 40], ["Vera V.", 3, 10]], 0, 3]);

      // Who may not, and for whom not: nothing of a refused save is kept.
      const refusedSave = async (res: ReturnType<typeof setScores>) => {
        const r = await res;
        return [r.statusCode, codeOf(r)];
      };
      const one = [{ userId: asha.userId, value: 999 }];
      expect(await refusedSave(setScores(gym, c.id, [...one, { userId: outsider.userId, value: 5 }]))).toEqual([409, "challenge_person_not_in"]);
      expect(await refusedSave(setScores(gym, c.id, one, trainer))).toEqual([403, "forbidden"]);
      for (const who of [vera, outsider, other.owner]) expect(await refusedSave(setScores(gym, c.id, one, who))).toEqual([404, "org_not_found"]);
      expect(await refusedSave(setScores(other, c.id, one, other.owner))).toEqual([404, "challenge_not_found"]);
      expect(await refusedSave(setScores(gym, c.id, [{ userId: asha.userId, value: 1_000_001 }]))).toEqual([400, "validation_error"]);
      expect(await refusedSave(setScores(gym, c.id, []))).toEqual([400, "validation_error"]);
      const counted = await add(gym, { name: "Gym days" });
      expect(await refusedSave(setScores(gym, counted.id, one))).toEqual([409, "challenge_not_own"]);
      const coming = await add(gym, { name: "Next week", counts: "own", unit: "laps", startsOn: "2026-10-12", endsOn: "2026-10-18" });
      expect(await refusedSave(setScores(gym, coming.id, one))).toEqual([409, "challenge_not_started"]);
      // One people join: a number only for somebody who joined.
      const joiners = await add(gym, { name: "Joiners", counts: "own", unit: "laps", who: "joined" });
      expect(await refusedSave(setScores(gym, joiners.id, one))).toEqual([409, "challenge_person_not_in"]);
      expect((await joinAs(gym, vera, joiners.id)).statusCode).toBe(200);
      expect((await setScores(gym, joiners.id, [{ userId: vera.userId, value: 7 }])).statusCode).toBe(200);
      expect(await scoreRows(c.id)).toEqual([[asha.userId, 45], [bilal.userId, 40], [vera.userId, 10]]);
      expect(await scoreRows(joiners.id)).toEqual([[vera.userId, 7]]);
      // A removed member's number is nobody's to see, and cannot be typed.
      await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${gym.id} AND user_id = ${bilal.userId}`;
      expect(places((await seen(gym, vera, c.id)).board.top)).toEqual([]);
      expect(places((await staffBoard(gym, c.id)).rows).map(([name]) => name)).not.toContain("Bilal Khan");
      expect(await refusedSave(setScores(gym, c.id, [{ userId: bilal.userId, value: 3 }]))).toEqual([409, "challenge_person_not_in"]);
    },
    T,
  );

  it(
    "lowest wins: the smallest number is first, for members and for staff; and what cannot be asked for is refused",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("Fast Lane");
      const vera = await member(gym, "Vera Viewer");
      const asha = await account("Asha Rao");
      const bilal = await account("Bilal Khan");
      const chen = await account("Chen Wu");
      for (const p of [asha, bilal, chen]) await inGym(gym.id, p.userId);
      const c = await add(gym, { name: "Row 500 m", counts: "own", unit: "seconds", lowestWins: true });
      expect((await setScores(gym, c.id, [{ userId: asha.userId, value: 95 }, { userId: bilal.userId, value: 110 }, { userId: chen.userId, value: 110 }, { userId: vera.userId, value: 130 }])).statusCode).toBe(200);
      const mine = await seen(gym, vera, c.id);
      expect(places(mine.board.top)).toEqual([["Asha R.", 1, 95], ["Bilal K.", 2, 110], ["Chen W.", 2, 110]]);
      expect([mine.board.ranked, mine.board.leaders, mine.board.reached]).toEqual([4, 1, null]);
      // Twenty seconds less would reach second.
      expect(mine.me).toEqual({ value: 130, place: 4, hidden: null, toNextPlace: 20, nextPlace: 2, reached: false, days: [] });
      expect(places((await boardOf(gym, vera, c.id)).rows)).toEqual([["Asha R.", 1, 95], ["Bilal K.", 2, 110], ["Chen W.", 2, 110], ["Vera V.", 4, 130]]);
      expect(places((await staffBoard(gym, c.id)).rows)).toEqual([["Asha Rao", 1, 95], ["Bilal Khan", 2, 110], ["Chen Wu", 2, 110], ["Vera Viewer", 4, 130]]);
      const card = (await staffList(gym)).current.find((x) => x.id === c.id);
      expect([places(card?.top ?? []), card?.withNumber]).toEqual([[["Asha Rao", 1, 95], ["Bilal Khan", 2, 110], ["Chen Wu", 2, 110]], 4]);

      const refusedAdd = async (over: Record<string, unknown>) => (await inject("POST", base(gym.id), gym.owner.cookies, fields(over))).statusCode;
      expect(await refusedAdd({ lowestWins: true })).toBe(400); // the app's counts are never lowest-wins
      expect(await refusedAdd({ counts: "own", unit: "seconds", lowestWins: true, target: 60 })).toBe(400);
      expect(await refusedAdd({ counts: "own" })).toBe(400); // no word for what is counted
      expect(await refusedAdd({ counts: "own", unit: "  " })).toBe(400);
      expect(await refusedAdd({ unit: "push-ups" })).toBe(400); // a word on the app's own count
      expect(await refusedAdd({ counts: "own", unit: "u".repeat(31) })).toBe(400);
      // The gym's own count may aim past the challenge's days.
      expect(await refusedAdd({ counts: "own", unit: "kilometres", target: 500 })).toBe(201);
      // Once started, lowest-wins cannot be switched.
      const put = await inject("PUT", `${base(gym.id)}/${c.id}`, gym.owner.cookies, changed({ name: "Row 500 m", counts: "own", unit: "seconds", lowestWins: false }));
      expect([put.statusCode, codeOf(put)]).toEqual([409, "challenge_started"]);
      // Its word can still be corrected.
      expect((await inject("PUT", `${base(gym.id)}/${c.id}`, gym.owner.cookies, changed({ name: "Row 500 m", counts: "own", unit: "secs", lowestWins: true }))).statusCode).toBe(200);
    },
    T,
  );

  it(
    "staff's board counts the hidden as hidden, and nobody else: people who joined with nothing yet are not called hidden",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("Six Joined");
      const people = [];
      for (const name of ["Asha Rao", "Bilal Khan", "Chen Wu", "Dina Das", "Esha Entry", "Farid Fox"]) {
        const p = await account(name);
        await inGym(gym.id, p.userId);
        people.push(p);
      }
      const c = await add(gym, { who: "joined" });
      await putIn(gym.id, c.id, people.map((p) => p.userId));
      for (const p of people.slice(0, 4)) await visits(gym, p.userId, ["2026-10-06"]);
      const open = await staffBoard(gym, c.id);
      expect([open.total, open.ranked, open.hidden]).toEqual([6, 4, 0]);
      // One of the two with nothing yet chooses Hide me: one hidden, though she has no number.
      await sql`UPDATE users SET leaderboard_opt_out = true WHERE id = ${people[5]?.userId ?? ""}`;
      const after = await staffBoard(gym, c.id);
      expect([after.total, after.ranked, after.hidden]).toEqual([6, 4, 1]);
    },
    T,
  );

  it(
    "a board longer than a page is read a hundred at a time, each person once; numbers can be typed for a fortnight after it ends and no longer",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("Big Board");
      const c = await add(gym, { name: "Push-up Day", counts: "own", unit: "push-ups", endsOn: "2026-10-07" });
      // 105 people, each with a number of their own, put in the database directly.
      const made = await sql<{ id: string }[]>`
        INSERT INTO users (email, display_name)
        SELECT 'chal-t-big-' || n || '-' || ${uniq()} || '@example.com', 'Person ' || lpad(n::text, 3, '0') || ' Test' FROM generate_series(1, 105) AS n
        RETURNING id`;
      const ids = made.map((m) => m.id);
      await sql`INSERT INTO gym_members (gym_id, user_id, joined_at) SELECT ${gym.id}, u, '2026-01-01T00:00:00Z' FROM unnest(${ids}::uuid[]) AS u`;
      await sql`INSERT INTO gym_challenge_scores (gym_id, challenge_id, user_id, value) SELECT ${gym.id}, ${c.id}, u, n FROM unnest(${ids}::uuid[]) WITH ORDINALITY AS t(u, n)`;
      const pageOf = async (page: number) => {
        const res = await inject("GET", `${base(gym.id)}/${c.id}/board/staff?page=${String(page)}`, gym.owner.cookies);
        expect(res.statusCode).toBe(200);
        return JSON.parse(res.body) as StaffGymChallengeBoardResponse;
      };
      const one = await pageOf(1);
      const two = await pageOf(2);
      expect([one.page, one.pages, one.total, one.rows.length, two.page, two.rows.length]).toEqual([1, 2, 105, 100, 2, 5]);
      expect(new Set([...one.rows, ...two.rows].map((r) => r.userId)).size).toBe(105);
      expect([one.rows[0]?.value, one.rows[99]?.value, two.rows[0]?.value, two.rows[4]?.value]).toEqual([105, 6, 5, 1]);
      // Past the last page: the last page.
      expect((await pageOf(99)).page).toBe(2);

      // It ended on the 7th: numbers can still be typed on the 21st, and not on the 22nd.
      const someone = ids[0] ?? "";
      clock = new Date("2026-10-21T06:30:00Z");
      expect((await setScores(gym, c.id, [{ userId: someone, value: 500 }])).statusCode).toBe(200);
      clock = new Date("2026-10-22T06:30:00Z");
      const late = await setScores(gym, c.id, [{ userId: someone, value: 600 }]);
      expect([late.statusCode, codeOf(late), (JSON.parse(late.body) as { message: string }).message]).toEqual([409, "challenge_numbers_closed", GYM_CHALLENGE_WORDS.scores_closed]);
      expect((await scoreRows(c.id))[0]).toEqual([someone, 500]);
      clock = WEDNESDAY;
    },
    T,
  );

  it(
    "a member is sent the newest three that ended, and a gym west of Greenwich ends its day at its own midnight",
    async () => {
      const gym = await makeGym("West Coast", "America/Los_Angeles");
      const vera = await member(gym, "Vera Viewer");
      // 22:00 on Wednesday 7 October in Los Angeles; it is already the 8th in Greenwich.
      clock = new Date("2026-10-08T05:00:00Z");
      const today = await add(gym, { name: "Ends tonight", who: "joined", endsOn: "2026-10-07" });
      expect((await seen(gym, vera, today.id)).state).toBe("running");
      expect((await joinAs(gym, vera, today.id)).statusCode).toBe(200);
      await visit(gym, { userId: vera.userId }, "2026-10-07");
      expect((await seen(gym, vera, today.id)).me?.value).toBe(1);
      // A minute past its own midnight.
      clock = new Date("2026-10-08T07:01:00Z");
      expect((await seen(gym, vera, today.id)).state).toBe("ended");
      const left = await leaveAs(gym, vera, today.id);
      expect([left.statusCode, codeOf(left)]).toEqual([409, "challenge_ended"]);
      const yesterday = await inject("POST", base(gym.id), gym.owner.cookies, fields({ name: "Too late", startsOn: "2026-10-05", endsOn: "2026-10-07" }));
      expect([yesterday.statusCode, codeOf(yesterday)]).toEqual([400, "challenge_ends_before_today"]);

      // Three more that ended earlier: of the four, the newest three are sent.
      for (const [name, ends] of [["Ended 6th", "2026-10-06"], ["Ended 5th", "2026-10-05"], ["Ended 4th", "2026-10-04"]] as const) {
        await sql`
          INSERT INTO gym_challenges (gym_id, challenge_key, name, counts, starts_on, ends_on, who)
          VALUES (${gym.id}, ${randomUUID()}, ${name}, 'gym_days', '2026-09-28', ${ends}::date, 'everyone')`;
      }
      expect((await list(gym, vera)).challenges.map((x) => [x.name, x.state])).toEqual([["Ends tonight", "ended"], ["Ended 6th", "ended"], ["Ended 5th", "ended"]]);
      clock = WEDNESDAY;
    },
    T,
  );

  // ===========================================================================
  // ONE ADDRESS, MANY PEOPLE
  // ===========================================================================

  it(
    "a whole gym on one wi-fi: one person's 120 joins an hour are theirs alone, and a stranger's 404 is never a 429",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("One Wifi");
      const wifi = desk();
      const busy = await member(gym, "Busy Bee");
      const others = [await member(gym, "Asha Rao"), await member(gym, "Bilal Khan"), await member(gym, "Chen Wu")];
      const stranger = await signedIn("Sid Stranger");
      const c = await add(gym, { who: "joined" });
      const path = `${base(gym.id)}/${c.id}/joined`;
      for (let i = 0; i < 120; i++) expect((await inject(i % 2 === 0 ? "PUT" : "DELETE", path, busy.cookies, undefined, wifi)).statusCode).toBe(200);
      expect((await inject("PUT", path, busy.cookies, undefined, wifi)).statusCode).toBe(429);
      // The others at the same address are not held up by it.
      for (const p of others) expect((await inject("PUT", path, p.cookies, undefined, wifi)).statusCode).toBe(200);
      for (const p of others) expect((await inject("GET", base(gym.id), p.cookies, undefined, wifi)).statusCode).toBe(200);
      // A stranger is told 404 however often they ask, and uses up nobody's hour.
      for (let i = 0; i < 125; i++) expect((await inject("PUT", path, stranger.cookies, undefined, wifi)).statusCode).toBe(404);
      expect(await joinRows(c.id)).toBe(3);
    },
    T,
  );
});
