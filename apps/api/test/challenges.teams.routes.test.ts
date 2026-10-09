// TEAMS IN A CHALLENGE — the routes against real Postgres (spec Part 3 §15.6; ROADMAP
// 19d-ii-a). DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: show somebody who chose Hide me, or
// somebody the gym removed, in a team's list of names, count them among its people, or let
// their number be worked out from their team's total. That is the first test below.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  GYM_CHALLENGE_WORDS,
  type GymChallengesResponse,
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
  JWT_SECRET: "gym-challenge-teams-test-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 120_000;
const LIVE_PLAN = "zz_chalteam_live";
/** Wednesday 7 October 2026, noon in Kolkata. */
const WEDNESDAY = new Date("2026-10-07T06:30:00Z");
/** Monday 12 October 2026, noon in Kolkata. */
const NEXT_MONDAY = new Date("2026-10-12T06:30:00Z");

let ipCounter = 0;
const nextIp = () => `10.86.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("teams in a challenge (real Postgres)", () => {
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
  const other = (): App => {
    if (second === undefined) throw new Error("beforeAll did not build the second app");
    return second;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'chalteam-t-%@example.com')`;
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'chalteam-t-%@example.com'`;
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
    await sql`DELETE FROM one_time_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM refresh_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM consent_log WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM users WHERE email LIKE 'chalteam-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, cookies: Cookies, payload?: unknown, target = api()) =>
    target.inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const codeOf = (res: { body: string }): string => (JSON.parse(res.body) as { error: string }).error;
  const wordsOf = (res: { body: string }): string => (JSON.parse(res.body) as { message: string }).message;

  interface Person {
    userId: string;
    cookies: Cookies;
  }

  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `chalteam-t-${uniq()}@example.com`;
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
      INSERT INTO users (email, display_name) VALUES (${`chalteam-t-${local}-${uniq()}@example.com`}, ${displayName}) RETURNING id`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("no user");
    return { userId: id };
  };

  interface Gym {
    id: string;
    owner: Person;
    deviceId: string;
  }

  const makeGym = async (name: string): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await inject("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Jorhat", country: "IN", timezone: "Asia/Kolkata" });
    expect(res.statusCode).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    const dev = await sql<{ id: string }[]>`INSERT INTO gym_checkin_devices (gym_id, name) VALUES (${id}, 'Front desk') RETURNING id`;
    return { id, owner, deviceId: dev[0]?.id ?? "" };
  };

  const record = async (gymId: string, fullName: string, dateOfBirth: string | null = null): Promise<string> => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO gym_member_list_entries (gym_id, full_name, email, identity_key, source, date_of_birth)
      VALUES (${gymId}, ${fullName}, ${`chalteam-r-${uniq()}@example.com`}, encode(sha256(${`chalteam-${uniq()}`}::bytea), 'hex'), 'typed', ${dateOfBirth})
      RETURNING id`;
    return rows[0]?.id ?? "";
  };
  const inGym = async (gymId: string, userId: string, entryId: string | null = null): Promise<void> => {
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id, joined_at) VALUES (${gymId}, ${userId}, ${entryId}, '2026-01-01T00:00:00Z')`;
  };
  const member = async (gym: Gym, name: string): Promise<Person> => {
    const p = await signedIn(name);
    await inGym(gym.id, p.userId);
    return p;
  };
  const quiet = async (gym: Gym, name: string): Promise<{ userId: string }> => {
    const p = await account(name);
    await inGym(gym.id, p.userId);
    return p;
  };

  /** A visit at the front desk at noon on a day of the gym's calendar. */
  const visits = async (gym: Gym, userId: string, days: readonly string[]) => {
    for (const day of days) {
      await sql`
        INSERT INTO gym_attendance
          (gym_id, user_id, entry_id, device_id, marked_by_user_id, day, marked_at, method,
           hours_status, session_opens_minute, session_closes_minute, slot_key)
        VALUES (${gym.id}, ${userId}, ${null}, ${gym.deviceId}, ${null},
                ${day}::date, (${day}::date + time '12:00') AT TIME ZONE 'Asia/Kolkata', 'pass',
                'in_session', 360, 420, '360-420')`;
    }
  };
  const DAYS = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"];

  const base = (gymId: string) => `/v1/orgs/${gymId}/challenges`;
  const two = [
    { id: null, name: "Red Team" },
    { id: null, name: "Blue Team" },
  ];
  /** A gym-days challenge for everyone, 1 to 31 October, in two teams the staff make. */
  const fields = (over: Record<string, unknown> = {}) => ({
    challengeKey: randomUUID(),
    name: "October Teams",
    details: "",
    prize: "",
    counts: "gym_days",
    startsOn: "2026-10-01",
    endsOn: "2026-10-31",
    target: null,
    who: "everyone",
    teams: "staff",
    teamList: two,
    ...over,
  });
  const add = async (gym: Gym, over: Record<string, unknown> = {}): Promise<StaffGymChallenge> => {
    const res = await inject("POST", base(gym.id), gym.owner.cookies, fields(over));
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { challenge: StaffGymChallenge }).challenge;
  };
  const teamId = (challenge: StaffGymChallenge, name: string): string => {
    const found = challenge.teamList.find((team) => team.name === name);
    if (found === undefined) throw new Error(`no team called ${name}`);
    return found.id;
  };
  const list = async (gym: Gym, who: Person): Promise<{ body: string; list: GymChallengesResponse }> => {
    const res = await inject("GET", base(gym.id), who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return { body: res.body, list: JSON.parse(res.body) as GymChallengesResponse };
  };
  const seen = async (gym: Gym, who: Person, id: string): Promise<MemberGymChallenge> => {
    const found = (await list(gym, who)).list.challenges.find((c) => c.id === id);
    if (found === undefined) throw new Error("the challenge is not on this member's list");
    return found;
  };
  const staffList = async (gym: Gym, who: Person = gym.owner): Promise<StaffGymChallengesResponse> => {
    const res = await inject("GET", `${base(gym.id)}/staff`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as StaffGymChallengesResponse;
  };
  const staffSeen = async (gym: Gym, id: string): Promise<StaffGymChallenge> => {
    const all = await staffList(gym);
    const found = [...all.current, ...all.past].find((c) => c.id === id);
    if (found === undefined) throw new Error("the challenge is not on the staff list");
    return found;
  };
  const staffBoard = async (gym: Gym, id: string): Promise<StaffGymChallengeBoardResponse> => {
    const res = await inject("GET", `${base(gym.id)}/${id}/board/staff`, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as StaffGymChallengeBoardResponse;
  };
  const put = (gym: Gym, id: string, people: { userId: string; teamId: string | null }[], who: Person = gym.owner, target = api()) =>
    inject("PUT", `${base(gym.id)}/${id}/team-people`, who.cookies, { people }, target);
  const putOk = async (gym: Gym, id: string, people: { userId: string; teamId: string | null }[]) => {
    const res = await put(gym, id, people);
    expect(res.statusCode, res.body).toBe(200);
  };
  const pick = (gym: Gym, who: Person, id: string, team: string, target = api()) => inject("PUT", `${base(gym.id)}/${id}/team`, who.cookies, { teamId: team }, target);
  const picked = async (gym: Gym, who: Person, id: string, team: string): Promise<MemberGymChallenge> => {
    const res = await pick(gym, who, id, team);
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { challenge: MemberGymChallenge }).challenge;
  };
  const teamRows = async (id: string): Promise<Record<string, string>> => {
    const rows = await sql<{ user_id: string; team_id: string }[]>`SELECT user_id, team_id FROM gym_challenge_team_people WHERE challenge_id = ${id}`;
    return Object.fromEntries(rows.map((row) => [row.user_id, row.team_id]));
  };
  const joinedRows = async (id: string): Promise<string[]> => {
    const rows = await sql<{ user_id: string }[]>`SELECT user_id FROM gym_challenge_people WHERE challenge_id = ${id}`;
    return rows.map((row) => row.user_id);
  };
  const audits = async (gymId: string, action: string): Promise<number> => {
    const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${gymId} AND action = ${action}`;
    return rows[0]?.n ?? 0;
  };
  /** A team's row on a member's card, as [people, number, place]. */
  const rowOf = (challenge: MemberGymChallenge, name: string): [number, number, number | null] => {
    const row = challenge.teamBoard?.rows.find((team) => team.name === name);
    if (row === undefined) throw new Error(`no team called ${name} on the card`);
    return [row.people, row.value, row.place];
  };

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
    "a hidden member, a removed one and a deleted account are in no team's names, not among its people, and their numbers are in no team's total that anybody else reads",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("Team Hall");
      const vera = await member(gym, "Vera Viewer");
      const asha = await member(gym, "Asha Rao");
      const bilal = await quiet(gym, "Bilal Khan");
      const chen = await quiet(gym, "Chen Wu");
      const zed = await quiet(gym, "Zed Zero");

      // Five ways to be hidden, a removed member and a deleted account: every one of them
      // in the Red Team with seven gym days, more than anybody shown.
      const hema = await member(gym, "Hema Hidden");
      await sql`UPDATE users SET leaderboard_opt_out = true WHERE id = ${hema.userId}`;
      const young = await quiet(gym, "Yuvi Young");
      await sql`INSERT INTO user_fitness_profiles (user_id, age) VALUES (${young.userId}, 16)`;
      const youngByRecord = await account("Rhea Record");
      await inGym(gym.id, youngByRecord.userId, await record(gym.id, "Rhea Record", "2010-03-01"));
      const takenOff = await quiet(gym, "Tariq Taken");
      await sql`UPDATE gym_members SET hidden_from_boards = true WHERE gym_id = ${gym.id} AND user_id = ${takenOff.userId}`;
      const nameless = await account("x", "nameless");
      await sql`UPDATE users SET display_name = split_part(email::text, '@', 1) WHERE id = ${nameless.userId}`;
      await inGym(gym.id, nameless.userId);
      const removed = await quiet(gym, "Rana Removed");
      const deleted = await quiet(gym, "Dev Deleted");
      const hidden = [hema, young, youngByRecord, takenOff, nameless];
      const gone = [removed, deleted];

      for (const h of [...hidden, ...gone]) await visits(gym, h.userId, DAYS);
      await visits(gym, asha.userId, DAYS.slice(0, 3));
      await visits(gym, bilal.userId, DAYS.slice(0, 2));
      await visits(gym, chen.userId, DAYS.slice(0, 2));
      await visits(gym, vera.userId, DAYS.slice(0, 1));

      const challenge = await add(gym, { target: 4 });
      const red = teamId(challenge, "Red Team");
      const blue = teamId(challenge, "Blue Team");
      await putOk(gym, challenge.id, [
        ...[asha, bilal, ...hidden, ...gone].map((p) => ({ userId: p.userId, teamId: red })),
        ...[vera, chen, zed].map((p) => ({ userId: p.userId, teamId: blue })),
      ]);
      // Gone after they were put in the team, as a person who leaves the gym is.
      await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${gym.id} AND user_id = ${removed.userId}`;
      await sql`UPDATE users SET status = 'deleted' WHERE id = ${deleted.userId}`;

      const secret = [...hidden, ...gone].map((p) => p.userId);
      const names = ["Hema", "Yuvi", "Rhea", "Tariq", "Rana", "Dev Deleted"];
      const nothingOf = (body: string) => {
        for (const id of secret) expect(body.includes(id), `somebody hidden or gone is in the reply: ${id}`).toBe(false);
        for (const name of names) expect(body.includes(name), `the name ${name} is in the reply`).toBe(false);
      };

      // Vera, in the other team. Red is Asha's 3 and Bilal's 2: 5, never 5 + 5 × 7.
      const forVera = await list(gym, vera);
      nothingOf(forVera.body);
      const veras = forVera.list.challenges.find((c) => c.id === challenge.id);
      if (veras === undefined) throw new Error("no challenge");
      expect(veras.teamBoard?.status).toBe("shown");
      expect(rowOf(veras, "Red Team")).toEqual([2, 5, 1]);
      // Zed has no gym day: counted among Blue's people, and named to nobody.
      expect(rowOf(veras, "Blue Team")).toEqual([3, 3, 2]);
      expect(veras.teamBoard?.rows.map((team) => [team.name, team.reached, team.isMine])).toEqual([
        ["Red Team", true, false],
        ["Blue Team", false, true],
      ]);
      expect(veras.teamBoard?.mine?.people.map((p) => [p.name, p.value, p.isMe])).toEqual([
        ["Chen W.", 2, false],
        ["Vera V.", 1, true],
      ]);
      expect(forVera.body.includes(zed.userId)).toBe(false);
      // The team's target is the team's: no one person is said to have reached it.
      expect(veras.me?.reached).toBe(false);
      expect(veras.board.reached).toBeNull();

      // Asha, in the hidden people's own team, reads the same Red: two people, 5.
      const forAsha = await list(gym, asha);
      nothingOf(forAsha.body);
      const ashas = forAsha.list.challenges.find((c) => c.id === challenge.id);
      if (ashas === undefined) throw new Error("no challenge");
      expect(rowOf(ashas, "Red Team")).toEqual([2, 5, 1]);
      expect(ashas.teamBoard?.mine?.people.map((p) => [p.name, p.value])).toEqual([
        ["Asha R.", 3],
        ["Bilal K.", 2],
      ]);
      expect(ashas.teamBoard?.mine?.counted).toBe(true);

      // Hema, hidden, reads her own line and is counted as one of her team's people for
      // herself alone; the team's number is still 5, and she is told hers is not in it.
      const hemas = await seen(gym, hema, challenge.id);
      expect(rowOf(hemas, "Red Team")).toEqual([3, 5, 1]);
      expect(hemas.teamBoard?.mine?.counted).toBe(false);
      expect(hemas.teamBoard?.mine?.people.map((p) => [p.name, p.value, p.isMe])).toEqual([
        ["Hema H.", 7, true],
        ["Asha R.", 3, false],
        ["Bilal K.", 2, false],
      ]);

      // Staff: everyone in each team now, the hidden too (five) and nobody gone; the number
      // and place as members see them.
      const forStaff = await staffSeen(gym, challenge.id);
      expect(forStaff.teamList.map((team) => [team.name, team.people, team.value, team.place])).toEqual([
        ["Red Team", 7, 5, 1],
        ["Blue Team", 3, 3, 2],
      ]);

      // It is the hidden rule that holds the number at 5: Hema shown again, Red is 12.
      await sql`UPDATE users SET leaderboard_opt_out = false WHERE id = ${hema.userId}`;
      expect(rowOf(await seen(gym, vera, challenge.id), "Red Team")).toEqual([3, 12, 1]);
    },
    T,
  );

  it(
    "while fewer than three people members may see have a number, no team has a number or a place, and no teammate is named",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("Small Hall");
      const vera = await member(gym, "Vera Viewer");
      const chen = await quiet(gym, "Chen Wu");
      const hema = await quiet(gym, "Hema Hidden");
      await sql`UPDATE users SET leaderboard_opt_out = true WHERE id = ${hema.userId}`;
      await visits(gym, vera.userId, DAYS.slice(0, 2));
      await visits(gym, chen.userId, DAYS.slice(0, 5));
      await visits(gym, hema.userId, DAYS);
      const challenge = await add(gym);
      const red = teamId(challenge, "Red Team");
      const blue = teamId(challenge, "Blue Team");
      await putOk(gym, challenge.id, [
        { userId: vera.userId, teamId: red },
        { userId: chen.userId, teamId: red },
        { userId: hema.userId, teamId: blue },
      ]);
      const got = await list(gym, vera);
      const mine = got.list.challenges.find((c) => c.id === challenge.id);
      expect(mine?.teamBoard?.status).toBe("too_few");
      expect(mine?.teamBoard?.rows.map((team) => [team.name, team.people, team.value, team.place])).toEqual([
        ["Red Team", 2, 0, null],
        ["Blue Team", 0, 0, null],
      ]);
      expect(mine?.teamBoard?.mine?.people.map((p) => [p.name, p.value])).toEqual([["Vera V.", 2]]);
      expect(got.body.includes(chen.userId)).toBe(false);
      expect(got.body.includes(hema.userId)).toBe(false);
      const forStaff = await staffSeen(gym, challenge.id);
      expect(forStaff.teamList.map((team) => [team.name, team.people, team.value, team.place])).toEqual([
        ["Red Team", 2, null, null],
        ["Blue Team", 1, null, null],
      ]);
    },
    T,
  );

  it(
    "in a challenge people join, somebody in a team who has not joined is not among its people and their number is not in its total",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("Join Hall");
      const [vera, asha, bilal, chen] = [await member(gym, "Vera Viewer"), await quiet(gym, "Asha Rao"), await quiet(gym, "Bilal Khan"), await quiet(gym, "Chen Wu")];
      const dina = await member(gym, "Dina Left");
      for (const [p, n] of [[vera, 1], [asha, 3], [bilal, 2], [chen, 2], [dina, 6]] as const) await visits(gym, p.userId, DAYS.slice(0, n));
      const challenge = await add(gym, { who: "joined" });
      const red = teamId(challenge, "Red Team");
      const blue = teamId(challenge, "Blue Team");
      for (const p of [vera, asha, bilal, chen, dina]) await sql`INSERT INTO gym_challenge_people (gym_id, challenge_id, user_id) VALUES (${gym.id}, ${challenge.id}, ${p.userId})`;
      await putOk(gym, challenge.id, [
        { userId: asha.userId, teamId: red },
        { userId: dina.userId, teamId: red },
        { userId: vera.userId, teamId: blue },
        { userId: bilal.userId, teamId: blue },
        { userId: chen.userId, teamId: blue },
      ]);
      expect(rowOf(await seen(gym, vera, challenge.id), "Red Team")).toEqual([2, 9, 1]);
      // Dina leaves the challenge. Her place in the team is kept for her, and counts for nothing.
      const left = await inject("DELETE", `${base(gym.id)}/${challenge.id}/joined`, dina.cookies);
      expect(left.statusCode).toBe(200);
      const after = await list(gym, vera);
      const mine = after.list.challenges.find((c) => c.id === challenge.id);
      if (mine === undefined) throw new Error("no challenge");
      expect(rowOf(mine, "Red Team")).toEqual([1, 3, 2]);
      expect(rowOf(mine, "Blue Team")).toEqual([3, 5, 1]);
      expect(after.body.includes(dina.userId)).toBe(false);
      expect((await staffSeen(gym, challenge.id)).teamList.map((team) => team.people)).toEqual([1, 3]);
      // Staff cannot put somebody in a team who is not in the challenge.
      const refused = await put(gym, challenge.id, [{ userId: dina.userId, teamId: blue }]);
      expect([refused.statusCode, codeOf(refused), wordsOf(refused)]).toEqual([409, "challenge_person_not_in", GYM_CHALLENGE_WORDS.team_person]);
      // Dina, not in it, is sent the teams and no team of her own.
      const dinas = await seen(gym, dina, challenge.id);
      expect(dinas.teamBoard?.mine).toBeNull();
      expect(dinas.teamBoard?.rows.every((team) => !team.isMine)).toBe(true);
    },
    T,
  );

  // ===========================================================================
  // A STRANGER
  // ===========================================================================

  it(
    "a stranger, another gym's owner and staff without the tick can neither read a gym's teams nor change them",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("Mine Hall");
      const theirs = await makeGym("Their Hall");
      const maya = await member(gym, "Maya Member");
      const outsider = await member(theirs, "Omar Outsider");
      const trainer = await signedIn("Tara Trainer");
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${trainer.userId}, 'trainer', ${null})`;
      const challenge = await add(gym, { teams: "members" });
      const red = teamId(challenge, "Red Team");
      const theirChallenge = await add(theirs, { teams: "members" });
      const theirRed = teamId(theirChallenge, "Red Team");
      const person = [{ userId: maya.userId, teamId: red }];

      // Reading and picking: 404 for anybody who is not a member of the gym.
      expect((await inject("GET", base(gym.id), outsider.cookies)).statusCode).toBe(404);
      expect((await pick(gym, outsider, challenge.id, red)).statusCode).toBe(404);
      expect((await pick(gym, theirs.owner, challenge.id, red)).statusCode).toBe(404);
      // A member of the other gym, by their own gym's address, with this gym's challenge.
      const crossed = await pick(theirs, outsider, challenge.id, red);
      expect([crossed.statusCode, codeOf(crossed)]).toEqual([404, "challenge_not_found"]);
      // Their own challenge, with this gym's team.
      const borrowed = await pick(theirs, outsider, theirChallenge.id, red);
      expect([borrowed.statusCode, codeOf(borrowed)]).toEqual([409, "challenge_team_gone"]);
      // Staff's write: nobody signed in, a member, another gym's owner, a trainer without the tick.
      expect((await inject("PUT", `${base(gym.id)}/${challenge.id}/team-people`, {}, { people: person })).statusCode).toBe(401);
      expect((await put(gym, challenge.id, person, maya)).statusCode).toBe(404);
      expect((await put(gym, challenge.id, person, theirs.owner)).statusCode).toBe(404);
      expect((await put(gym, challenge.id, person, trainer)).statusCode).toBe(403);
      // The other gym's owner, by their own gym's address: this gym's challenge, then this
      // gym's person, then this gym's team.
      expect((await put(theirs, challenge.id, person, theirs.owner)).statusCode).toBe(404);
      const notTheirs = await put(theirs, theirChallenge.id, [{ userId: maya.userId, teamId: theirRed }], theirs.owner);
      expect([notTheirs.statusCode, codeOf(notTheirs)]).toEqual([409, "challenge_person_not_in"]);
      const otherTeam = await put(theirs, theirChallenge.id, [{ userId: outsider.userId, teamId: red }], theirs.owner);
      expect([otherTeam.statusCode, codeOf(otherTeam)]).toEqual([409, "challenge_team_gone"]);
      expect(await teamRows(challenge.id)).toEqual({});
      expect(await teamRows(theirChallenge.id)).toEqual({});

      // A body that is not one.
      for (const body of [{}, { people: [] }, { people: [{ userId: "x", teamId: red }] }, { people: person, more: 1 }, { people: [{ userId: maya.userId }] }]) {
        expect((await inject("PUT", `${base(gym.id)}/${challenge.id}/team-people`, gym.owner.cookies, body)).statusCode, JSON.stringify(body)).toBe(400);
      }
      for (const body of [{}, { teamId: "x" }, { teamId: red, more: 1 }]) {
        expect((await inject("PUT", `${base(gym.id)}/${challenge.id}/team`, maya.cookies, body)).statusCode, JSON.stringify(body)).toBe(400);
      }
    },
    T,
  );

  // ===========================================================================
  // STAFF MAKE THE TEAMS
  // ===========================================================================

  it(
    "staff put people in teams, move them and take them out; nobody who was not sent is touched, and it is noted once a save",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("Staff Hall");
      const [asha, bilal, chen] = [await member(gym, "Asha Rao"), await quiet(gym, "Bilal Khan"), await quiet(gym, "Chen Wu")];
      const challenge = await add(gym);
      expect(challenge.teams).toBe("staff");
      expect(challenge.teamList.map((team) => [team.name, team.people, team.value, team.place])).toEqual([
        ["Red Team", 0, null, null],
        ["Blue Team", 0, null, null],
      ]);
      const red = teamId(challenge, "Red Team");
      const blue = teamId(challenge, "Blue Team");

      // The board lists everybody in the challenge, so each has a row to be put in a team on.
      const before = await staffBoard(gym, challenge.id);
      expect(before.rows.map((row) => [row.name, row.teamId]).sort()).toEqual([
        ["Asha Rao", null],
        ["Bilal Khan", null],
        ["Chen Wu", null],
      ]);

      await putOk(gym, challenge.id, [
        { userId: asha.userId, teamId: red },
        { userId: bilal.userId, teamId: red },
        { userId: chen.userId, teamId: blue },
      ]);
      expect(await teamRows(challenge.id)).toEqual({ [asha.userId]: red, [bilal.userId]: red, [chen.userId]: blue });
      // Bilal moved, Chen taken out; Asha, not sent, stays. Sent twice, it is the same.
      const move = [
        { userId: bilal.userId, teamId: blue },
        { userId: chen.userId, teamId: null },
      ];
      await putOk(gym, challenge.id, move);
      await putOk(gym, challenge.id, move);
      expect(await teamRows(challenge.id)).toEqual({ [asha.userId]: red, [bilal.userId]: blue });
      expect(await audits(gym.id, "org.challenge_teams_set")).toBe(3);
      const after = await staffBoard(gym, challenge.id);
      expect(Object.fromEntries(after.rows.map((row) => [row.name, row.teamId]))).toMatchObject({ "Asha Rao": red, "Bilal Khan": blue, "Chen Wu": null });
      // A person sent twice in one save: the last team sent is theirs.
      await putOk(gym, challenge.id, [
        { userId: chen.userId, teamId: red },
        { userId: chen.userId, teamId: blue },
      ]);
      expect((await teamRows(challenge.id))[chen.userId]).toBe(blue);

      // Where staff make the teams a member has no Pick button, and a pick is refused.
      const ashas = await seen(gym, asha, challenge.id);
      expect(ashas.can).toEqual({ join: false, leave: false, pick: false });
      expect(ashas.teamBoard?.mine?.teamId).toBe(red);
      const noPick = await pick(gym, asha, challenge.id, blue);
      expect([noPick.statusCode, codeOf(noPick), wordsOf(noPick)]).toEqual([409, "challenge_teams_staff", GYM_CHALLENGE_WORDS.teams_staff]);
      expect((await teamRows(challenge.id))[asha.userId]).toBe(red);

      // A team that is not this challenge's, and a person who is not in the gym.
      const stray = await put(gym, challenge.id, [{ userId: asha.userId, teamId: randomUUID() }]);
      expect([stray.statusCode, codeOf(stray)]).toEqual([409, "challenge_team_gone"]);
      const nobody = await put(gym, challenge.id, [{ userId: randomUUID(), teamId: red }]);
      expect([nobody.statusCode, codeOf(nobody)]).toEqual([409, "challenge_person_not_in"]);
      // One bad line refuses the whole save: Asha is not moved by it.
      const mixed = await put(gym, challenge.id, [
        { userId: asha.userId, teamId: blue },
        { userId: randomUUID(), teamId: red },
      ]);
      expect(mixed.statusCode).toBe(409);
      expect((await teamRows(challenge.id))[asha.userId]).toBe(red);

      // Cancelled: refused. Once its last day has ended: refused.
      const cancel = await inject("PUT", `${base(gym.id)}/${challenge.id}/cancelled`, gym.owner.cookies, { cancelled: true });
      expect(cancel.statusCode).toBe(200);
      expect(codeOf(await put(gym, challenge.id, [{ userId: asha.userId, teamId: blue }]))).toBe("challenge_cancelled");
      await inject("PUT", `${base(gym.id)}/${challenge.id}/cancelled`, gym.owner.cookies, { cancelled: false });
      clock = new Date("2026-11-01T06:30:00Z");
      const late = await put(gym, challenge.id, [{ userId: asha.userId, teamId: blue }]);
      expect([late.statusCode, codeOf(late), wordsOf(late)]).toEqual([409, "challenge_ended", GYM_CHALLENGE_WORDS.team_ended]);
      expect((await teamRows(challenge.id))[asha.userId]).toBe(red);
      clock = WEDNESDAY;

      // A challenge people are in alone has no teams to put anybody in.
      const alone = await add(gym, { name: "Alone", teams: "none", teamList: [] });
      expect(alone.teamList).toEqual([]);
      expect(codeOf(await put(gym, alone.id, [{ userId: asha.userId, teamId: red }]))).toBe("challenge_no_teams");
      expect((await seen(gym, asha, alone.id)).teamBoard).toBeNull();
    },
    T,
  );

  // ===========================================================================
  // MEMBERS PICK
  // ===========================================================================

  it(
    "a member picks a team, which joins them; changes it until the first day; and after it a first pick stands and a change is refused",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("Pick Hall");
      const [maya, noor] = [await member(gym, "Maya Member"), await member(gym, "Noor Late")];
      const challenge = await add(gym, { who: "joined", teams: "members", startsOn: "2026-10-10" });
      const red = teamId(challenge, "Red Team");
      const blue = teamId(challenge, "Blue Team");

      // Not in it yet: the teams, each with nobody, and Pick a team in place of Join.
      const first = await seen(gym, maya, challenge.id);
      expect(first.can).toEqual({ join: false, leave: false, pick: true });
      expect(first.teamBoard?.status).toBe("not_started");
      expect(first.teamBoard?.rows.map((team) => [team.name, team.people])).toEqual([
        ["Red Team", 0],
        ["Blue Team", 0],
      ]);
      expect(first.teamBoard?.mine).toBeNull();

      const inRed = await picked(gym, maya, challenge.id, red);
      expect(inRed.joined).toBe(true);
      expect(inRed.can).toEqual({ join: false, leave: true, pick: true });
      expect(inRed.teamBoard?.mine?.teamId).toBe(red);
      expect(inRed.teamBoard?.rows.map((team) => [team.name, team.people, team.isMine])).toEqual([
        ["Red Team", 1, true],
        ["Blue Team", 0, false],
      ]);
      expect(await joinedRows(challenge.id)).toEqual([maya.userId]);
      // Before the first day she may change, and picking twice is one pick.
      await picked(gym, maya, challenge.id, blue);
      await picked(gym, maya, challenge.id, blue);
      expect(await teamRows(challenge.id)).toEqual({ [maya.userId]: blue });

      // A team that is not this challenge's.
      const stray = await pick(gym, maya, challenge.id, randomUUID());
      expect([stray.statusCode, codeOf(stray), wordsOf(stray)]).toEqual([409, "challenge_team_gone", GYM_CHALLENGE_WORDS.team_gone]);

      // It has started. Maya's team is hers now; the same pick again is still fine.
      clock = NEXT_MONDAY;
      const running = await seen(gym, maya, challenge.id);
      expect(running.can).toEqual({ join: false, leave: true, pick: false });
      const change = await pick(gym, maya, challenge.id, red);
      expect([change.statusCode, codeOf(change), wordsOf(change)]).toEqual([409, "challenge_team_locked", GYM_CHALLENGE_WORDS.team_locked]);
      await picked(gym, maya, challenge.id, blue);
      expect(await teamRows(challenge.id)).toEqual({ [maya.userId]: blue });
      // Leaving and coming back does not open another team: her place is kept.
      expect((await inject("DELETE", `${base(gym.id)}/${challenge.id}/joined`, maya.cookies)).statusCode).toBe(200);
      const away = await seen(gym, maya, challenge.id);
      expect(away.can).toEqual({ join: true, leave: false, pick: false });
      expect(away.teamBoard?.mine).toBeNull();
      expect(codeOf(await pick(gym, maya, challenge.id, red))).toBe("challenge_team_locked");
      expect((await inject("PUT", `${base(gym.id)}/${challenge.id}/joined`, maya.cookies)).statusCode).toBe(200);
      expect((await seen(gym, maya, challenge.id)).teamBoard?.mine?.teamId).toBe(blue);

      // Noor comes late: a first pick is open while it runs.
      expect((await seen(gym, noor, challenge.id)).can).toEqual({ join: false, leave: false, pick: true });
      const late = await picked(gym, noor, challenge.id, red);
      expect(late.joined).toBe(true);
      expect(late.can).toEqual({ join: false, leave: true, pick: false });

      // Staff may still move a member where members pick.
      await putOk(gym, challenge.id, [{ userId: noor.userId, teamId: blue }]);
      expect((await seen(gym, noor, challenge.id)).teamBoard?.mine?.teamId).toBe(blue);

      // Cancelled, then ended: no pick.
      await inject("PUT", `${base(gym.id)}/${challenge.id}/cancelled`, gym.owner.cookies, { cancelled: true });
      const zara = await member(gym, "Zara New");
      expect(codeOf(await pick(gym, zara, challenge.id, red))).toBe("challenge_cancelled");
      await inject("PUT", `${base(gym.id)}/${challenge.id}/cancelled`, gym.owner.cookies, { cancelled: false });
      clock = new Date("2026-11-01T06:30:00Z");
      expect(codeOf(await pick(gym, zara, challenge.id, red))).toBe("challenge_ended");
      clock = WEDNESDAY;
      // A challenge people are in alone.
      const alone = await add(gym, { name: "Alone", teams: "none", teamList: [] });
      expect(codeOf(await pick(gym, zara, alone.id, red))).toBe("challenge_no_teams");
    },
    T,
  );

  it(
    "in everyone's challenge where members pick, a pick puts nobody in a list of who joined",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("Open Hall");
      const maya = await member(gym, "Maya Member");
      const challenge = await add(gym, { teams: "members" });
      const got = await picked(gym, maya, challenge.id, teamId(challenge, "Blue Team"));
      expect(got.joined).toBe(false);
      // It is running: the pick is made, and is hers.
      expect(got.can).toEqual({ join: false, leave: false, pick: false });
      expect(await joinedRows(challenge.id)).toEqual([]);
    },
    T,
  );

  // ===========================================================================
  // THE TEAMS THEMSELVES
  // ===========================================================================

  it(
    "before the first day a team can be renamed, added or removed, and a kept team keeps its people; once it has started the teams cannot change",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("Edit Hall");
      const other_ = await makeGym("Other Edit Hall");
      const [asha, bilal] = [await quiet(gym, "Asha Rao"), await quiet(gym, "Bilal Khan")];
      const challenge = await add(gym, { startsOn: "2026-10-10" });
      const red = teamId(challenge, "Red Team");
      const blue = teamId(challenge, "Blue Team");
      await putOk(gym, challenge.id, [
        { userId: asha.userId, teamId: red },
        { userId: bilal.userId, teamId: blue },
      ]);
      const change = (over: Record<string, unknown>) => {
        const body: Record<string, unknown> = fields({ startsOn: "2026-10-10", ...over });
        delete body["challengeKey"];
        return inject("PUT", `${base(gym.id)}/${challenge.id}`, gym.owner.cookies, body);
      };

      // Red renamed, Blue removed, Green added, in a new order.
      const res = await change({ teamList: [{ id: null, name: "Green Team" }, { id: red, name: "The Reds" }] });
      expect(res.statusCode, res.body).toBe(200);
      const now = (JSON.parse(res.body) as { challenge: StaffGymChallenge }).challenge;
      expect(now.teamList.map((team) => [team.name, team.people])).toEqual([
        ["Green Team", 0],
        ["The Reds", 1],
      ]);
      expect(teamId(now, "The Reds")).toBe(red);
      // Asha is still in her team; Bilal's team went, and he is in none.
      expect(await teamRows(challenge.id)).toEqual({ [asha.userId]: red });

      // A team of another challenge, and of another gym's challenge, is not one of this one's.
      const second_ = await add(gym, { name: "Second", startsOn: "2026-10-10" });
      const theirs = await add(other_, { startsOn: "2026-10-10" });
      for (const foreign of [teamId(second_, "Red Team"), teamId(theirs, "Red Team"), blue]) {
        const refused = await change({ teamList: [{ id: red, name: "The Reds" }, { id: foreign, name: "Taken" }] });
        expect([refused.statusCode, codeOf(refused)]).toEqual([409, "challenge_team_gone"]);
      }
      expect((await staffSeen(gym, second_.id)).teamList.map((team) => team.name)).toEqual(["Red Team", "Blue Team"]);
      expect((await staffSeen(gym, challenge.id)).teamList.map((team) => team.name)).toEqual(["Green Team", "The Reds"]);

      // Members pick in place of staff, before it starts: allowed, and the people stay.
      expect((await change({ teams: "members", teamList: now.teamList.map((team) => ({ id: team.id, name: team.name })) })).statusCode).toBe(200);
      expect(await teamRows(challenge.id)).toEqual({ [asha.userId]: red });

      // It has started: nothing about its teams can change; its last day still can.
      clock = NEXT_MONDAY;
      const kept = now.teamList.map((team) => ({ id: team.id, name: team.name }));
      for (const over of [
        { teamList: [kept[0], { id: red, name: "Renamed" }] },
        { teamList: [...kept, { id: null, name: "Late Team" }] },
        { teamList: [kept[1], kept[0]] },
        { teams: "staff", teamList: kept },
        { teams: "none", teamList: [] },
      ]) {
        const refused = await change({ teams: "members", ...over });
        expect([refused.statusCode, codeOf(refused), wordsOf(refused)], JSON.stringify(over)).toEqual([409, "challenge_started", GYM_CHALLENGE_WORDS.started_locked]);
      }
      expect((await change({ teams: "members", teamList: kept, endsOn: "2026-11-05" })).statusCode).toBe(200);
      expect((await staffSeen(gym, challenge.id)).teamList.map((team) => team.name)).toEqual(["Green Team", "The Reds"]);
      expect(await teamRows(challenge.id)).toEqual({ [asha.userId]: red });
      clock = WEDNESDAY;

      // Made a challenge people are in alone, before it starts: its teams go, with who was in them.
      const third = await add(gym, { name: "Third", startsOn: "2026-10-10" });
      await putOk(gym, third.id, [{ userId: asha.userId, teamId: teamId(third, "Red Team") }]);
      const body: Record<string, unknown> = fields({ name: "Third", startsOn: "2026-10-10", teams: "none", teamList: [] });
      delete body["challengeKey"];
      const alone = await inject("PUT", `${base(gym.id)}/${third.id}`, gym.owner.cookies, body);
      expect(alone.statusCode, alone.body).toBe(200);
      expect((JSON.parse(alone.body) as { challenge: StaffGymChallenge }).challenge.teamList).toEqual([]);
      expect(await teamRows(third.id)).toEqual({});

      // A request the rules refuse: one team, two with one name, alone with teams named.
      for (const over of [{ teamList: [two[0]] }, { teamList: [two[0], { id: null, name: "red team" }] }, { teams: "none" }]) {
        expect((await inject("POST", base(gym.id), gym.owner.cookies, fields(over))).statusCode, JSON.stringify(over)).toBe(400);
      }
    },
    T,
  );

  it(
    "a team's target is the team's to reach, and where the lowest wins the smallest total is first",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("Target Hall");
      const [vera, asha, bilal, chen] = [await member(gym, "Vera Viewer"), await quiet(gym, "Asha Rao"), await quiet(gym, "Bilal Khan"), await quiet(gym, "Chen Wu")];
      // A week of seven days with a team target of 9: more than one person's days.
      const week = await add(gym, { startsOn: "2026-10-01", endsOn: "2026-10-07", target: 9 });
      for (const [p, n] of [[vera, 4], [asha, 6], [bilal, 5], [chen, 2]] as const) await visits(gym, p.userId, DAYS.slice(0, n));
      await putOk(gym, week.id, [
        { userId: asha.userId, teamId: teamId(week, "Red Team") },
        { userId: bilal.userId, teamId: teamId(week, "Red Team") },
        { userId: vera.userId, teamId: teamId(week, "Blue Team") },
        { userId: chen.userId, teamId: teamId(week, "Blue Team") },
      ]);
      const weeks = await seen(gym, vera, week.id);
      expect(weeks.teamBoard?.rows.map((team) => [team.name, team.value, team.place, team.reached])).toEqual([
        ["Red Team", 11, 1, true],
        ["Blue Team", 6, 2, false],
      ]);

      // The gym's own count, the lowest wins: staff type each person's seconds.
      const sprint = await add(gym, { name: "Relay", counts: "own", unit: "seconds", lowestWins: true });
      await putOk(gym, sprint.id, [
        { userId: asha.userId, teamId: teamId(sprint, "Red Team") },
        { userId: bilal.userId, teamId: teamId(sprint, "Red Team") },
        { userId: vera.userId, teamId: teamId(sprint, "Blue Team") },
        { userId: chen.userId, teamId: teamId(sprint, "Blue Team") },
      ]);
      const scores = await inject("PUT", `${base(gym.id)}/${sprint.id}/scores`, gym.owner.cookies, {
        scores: [
          { userId: asha.userId, value: 70 },
          { userId: bilal.userId, value: 65 },
          { userId: vera.userId, value: 58 },
          { userId: chen.userId, value: 61 },
        ],
      });
      expect(scores.statusCode, scores.body).toBe(200);
      const relay = await seen(gym, vera, sprint.id);
      expect(relay.teamBoard?.rows.map((team) => [team.name, team.value, team.place])).toEqual([
        ["Red Team", 135, 2],
        ["Blue Team", 119, 1],
      ]);
      // Her own team's people, the fastest first.
      expect(relay.teamBoard?.mine?.people.map((p) => [p.name, p.value])).toEqual([
        ["Vera V.", 58],
        ["Chen W.", 61],
      ]);
    },
    T,
  );

  // ===========================================================================
  // AT THE SAME INSTANT
  // ===========================================================================

  it(
    "one member pressing two teams at the same instant is in exactly one; many members picking at once are each in theirs",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("Race Hall");
      const maya = await member(gym, "Maya Member");
      // Running: a first pick stands, so of two different picks at once one is refused.
      const running = await add(gym, { who: "joined", teams: "members" });
      const red = teamId(running, "Red Team");
      const blue = teamId(running, "Blue Team");
      for (let run = 0; run < 5; run++) {
        await sql`DELETE FROM gym_challenge_team_people WHERE challenge_id = ${running.id}`;
        await sql`DELETE FROM gym_challenge_people WHERE challenge_id = ${running.id}`;
        const [a, b] = await Promise.all([pick(gym, maya, running.id, red, api()), pick(gym, maya, running.id, blue, other())]);
        expect([a.statusCode, b.statusCode].sort(), `run ${String(run)}`).toEqual([200, 409]);
        const rows = await teamRows(running.id);
        expect(rows[maya.userId]).toBe(a.statusCode === 200 ? red : blue);
        expect(await joinedRows(running.id)).toEqual([maya.userId]);
      }

      // Twelve members pick at one instant, on two servers.
      const crowd: Person[] = [];
      for (let i = 0; i < 12; i++) crowd.push(await member(gym, `Crowd ${String(i)}`));
      await sql`DELETE FROM gym_challenge_team_people WHERE challenge_id = ${running.id}`;
      await sql`DELETE FROM gym_challenge_people WHERE challenge_id = ${running.id}`;
      const answers = await Promise.all(crowd.map((p, i) => pick(gym, p, running.id, i % 2 === 0 ? red : blue, i % 3 === 0 ? other() : api())));
      expect(answers.map((res) => res.statusCode)).toEqual(crowd.map(() => 200));
      const rows = await teamRows(running.id);
      expect(crowd.map((p) => rows[p.userId])).toEqual(crowd.map((_p, i) => (i % 2 === 0 ? red : blue)));
      expect((await joinedRows(running.id)).sort()).toEqual(crowd.map((p) => p.userId).sort());

      // Staff's save and a member's pick of another team at one instant, on two servers:
      // both are answered (neither waits for the other for ever), and she is in one team.
      for (let run = 0; run < 10; run++) {
        await sql`DELETE FROM gym_challenge_team_people WHERE challenge_id = ${running.id} AND user_id = ${maya.userId}`;
        // She has joined, so staff may put her in a team whichever of the two is first.
        await sql`INSERT INTO gym_challenge_people (gym_id, challenge_id, user_id) VALUES (${gym.id}, ${running.id}, ${maya.userId}) ON CONFLICT DO NOTHING`;
        const [byStaff, byMaya] = await Promise.all([put(gym, running.id, [{ userId: maya.userId, teamId: red }], gym.owner, other()), pick(gym, maya, running.id, blue, api())]);
        expect(byStaff.statusCode, byStaff.body).toBe(200);
        expect([200, 409], byMaya.body).toContain(byMaya.statusCode);
        // A pick refused left staff's team; a pick that stood was the first, either before
        // staff's save (which then moved her) or, with no team yet, after it could not be.
        expect((await teamRows(running.id))[maya.userId]).toBe(red);
      }
    },
    T,
  );

  it(
    "a new challenge sent twice under one key has its teams once",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("Twice Hall");
      const body = fields();
      const [a, b] = await Promise.all([inject("POST", base(gym.id), gym.owner.cookies, body, api()), inject("POST", base(gym.id), gym.owner.cookies, body, other())]);
      expect([a.statusCode, b.statusCode]).toEqual([201, 201]);
      const made = (JSON.parse(a.body) as { challenge: StaffGymChallenge }).challenge;
      expect((JSON.parse(b.body) as { challenge: StaffGymChallenge }).challenge.id).toBe(made.id);
      const rows = await sql<{ name: string }[]>`SELECT name FROM gym_challenge_teams WHERE challenge_id = ${made.id} ORDER BY position`;
      expect(rows.map((row) => row.name)).toEqual(["Red Team", "Blue Team"]);
    },
    T,
  );
});
