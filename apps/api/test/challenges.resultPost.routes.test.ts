// A CHALLENGE'S RESULT, POSTED TO UPDATES — against real Postgres (spec Part 3 §15.6; ROADMAP
// 19d-ii-b). DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: name somebody who chose Hide me, an
// under-18 or somebody the gym removed as the winner in a post the whole gym reads, or keep
// naming somebody who hid or left after the post went up. That is the first test below.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  GYM_CHALLENGE_RESULT_POST_ENDING,
  type GymChallengesResponse,
  type GymPost,
  type GymPostsResponse,
  type MemberGymChallenge,
  type StaffGymChallenge,
  type StaffGymChallengesResponse,
  type StaffGymPostsResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { postChallengeResults } from "../src/modules/orgs/challenges/resultPosts.js";
import { createMemoryRedis } from "../src/redis.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "gym-challenge-result-test-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 120_000;
const LIVE_PLAN = "zz_chalpost_live";
/** Monday 5 October 2026, noon in Kolkata: the challenges below are made on this day. */
const MONDAY = new Date("2026-10-05T06:30:00Z");
/** Thursday 8 October 2026, noon in Kolkata: two days after their last day. */
const THURSDAY = new Date("2026-10-08T06:30:00Z");

let ipCounter = 0;
const nextIp = () => `10.87.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("a challenge's result posted to Updates (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  let clock = MONDAY;
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'chalpost-t-%@example.com')`;
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'chalpost-t-%@example.com'`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_posts WHERE gym_id IN (${mine})`;
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
    await sql`DELETE FROM users WHERE email LIKE 'chalpost-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, cookies: Cookies, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });

  interface Person {
    userId: string;
    cookies: Cookies;
  }

  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `chalpost-t-${uniq()}@example.com`;
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
      INSERT INTO users (email, display_name) VALUES (${`chalpost-t-${local}-${uniq()}@example.com`}, ${displayName}) RETURNING id`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("no user");
    return { userId: id };
  };

  interface Gym {
    id: string;
    owner: Person;
    deviceId: string;
    timezone: string;
  }

  const livePlan = async (gymId: string) => {
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
  };
  const makeGym = async (name: string, place: { city: string; country: string; timezone: string } = { city: "Jorhat", country: "IN", timezone: "Asia/Kolkata" }): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await inject("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, ...place });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await livePlan(id);
    const dev = await sql<{ id: string }[]>`INSERT INTO gym_checkin_devices (gym_id, name) VALUES (${id}, 'Front desk') RETURNING id`;
    return { id, owner, deviceId: dev[0]?.id ?? "", timezone: place.timezone };
  };

  const record = async (gymId: string, fullName: string, dateOfBirth: string | null = null): Promise<string> => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO gym_member_list_entries (gym_id, full_name, email, identity_key, source, date_of_birth)
      VALUES (${gymId}, ${fullName}, ${`chalpost-r-${uniq()}@example.com`}, encode(sha256(${`chalpost-${uniq()}`}::bytea), 'hex'), 'typed', ${dateOfBirth})
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
                ${day}::date, (${day}::date + time '12:00') AT TIME ZONE ${gym.timezone}, 'pass',
                'in_session', 360, 420, '360-420')`;
    }
  };
  const DAYS = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"];

  const base = (gymId: string) => `/v1/orgs/${gymId}/challenges`;
  /** A gym-days challenge for everyone, 1 to 6 October, people in it alone. */
  const fields = (over: Record<string, unknown> = {}) => ({
    challengeKey: randomUUID(),
    name: "October Six",
    details: "",
    prize: "",
    counts: "gym_days",
    startsOn: "2026-10-01",
    endsOn: "2026-10-06",
    target: null,
    who: "everyone",
    teams: "none",
    teamList: [],
    ...over,
  });
  const add = async (gym: Gym, over: Record<string, unknown> = {}): Promise<StaffGymChallenge> => {
    const res = await inject("POST", base(gym.id), gym.owner.cookies, fields(over));
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { challenge: StaffGymChallenge }).challenge;
  };
  const memberList = async (gym: Gym, who: Person): Promise<GymChallengesResponse> => {
    const res = await inject("GET", base(gym.id), who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as GymChallengesResponse;
  };
  const staffSeen = async (gym: Gym, id: string): Promise<StaffGymChallenge> => {
    const res = await inject("GET", `${base(gym.id)}/staff`, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    const all = JSON.parse(res.body) as StaffGymChallengesResponse;
    const found = [...all.current, ...all.past].find((c) => c.id === id);
    if (found === undefined) throw new Error("the challenge is not on the staff list");
    return found;
  };

  const posts = (gymId: string) => `/v1/orgs/${gymId}/posts`;
  const feed = async (gym: Gym, who: Person): Promise<{ body: string; posts: GymPost[] }> => {
    const res = await inject("GET", posts(gym.id), who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    const read = JSON.parse(res.body) as GymPostsResponse;
    return { body: res.body, posts: [...read.pinned, ...read.posts] };
  };
  const staffFeed = async (gym: Gym): Promise<{ body: string; posts: GymPost[] }> => {
    const res = await inject("GET", `${posts(gym.id)}/staff`, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    const read = JSON.parse(res.body) as StaffGymPostsResponse;
    return { body: res.body, posts: [...read.pinned, ...read.posts] };
  };
  /** The post that announces this challenge's result, as it was read. */
  const postOf = (read: { posts: GymPost[] }, challengeId: string): GymPost => {
    const found = read.posts.find((p) => p.challengeResult?.challenge.id === challengeId);
    if (found === undefined) throw new Error("no post carries this challenge's result");
    return found;
  };
  const resultOf = (read: { posts: GymPost[] }, challengeId: string): MemberGymChallenge => {
    const result = postOf(read, challengeId).challengeResult;
    if (result === null) throw new Error("the post has no result");
    return result.challenge;
  };
  const topOf = (challenge: MemberGymChallenge): [string, number, number][] => challenge.board.top.map((row) => [row.name, row.value, row.place]);

  const log = { info: () => undefined };
  /** The posting step, looking only at these gyms: other tests share the database. */
  const run = (gyms: readonly Gym[], now: Date = clock) => postChallengeResults({ sql, log }, { now, gymIds: gyms.map((g) => g.id) });
  const rows = async (gymId: string): Promise<{ id: string; body: string; challenge_id: string | null; removed: boolean; author: string | null }[]> =>
    await sql`SELECT id, body, challenge_id, removed_at IS NOT NULL AS removed, author_user_id AS author FROM gym_posts WHERE gym_id = ${gymId} ORDER BY body`;
  const audits = async (gymId: string): Promise<number> => {
    const found = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${gymId} AND action = 'org.challenge_result_posted'`;
    return found[0]?.n ?? 0;
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), { redis, orgs: { now: () => clock } });
    await api().ready();
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, T);

  // ===========================================================================
  // THE WORST THING, FIRST
  // ===========================================================================

  it(
    "a hidden member, an under-18, a removed one and a deleted account are never named in a result post, and somebody who hides or leaves after it went up is named no longer",
    async () => {
      clock = MONDAY;
      const gym = await makeGym("Result Hall");
      const vera = await member(gym, "Vera Viewer");
      const asha = await member(gym, "Asha Rao");
      const bilal = await quiet(gym, "Bilal Khan");
      const chen = await quiet(gym, "Chen Wu");

      // Six ways to be hidden, a removed member and a deleted account: every one of them
      // with six gym days, more than anybody shown.
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
      const staffer = await quiet(gym, "Sana Staff");
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${staffer.userId}, 'manager', ${null})`;
      const hidden = [hema, young, youngByRecord, takenOff, nameless, staffer];
      const gone = [removed, deleted];

      for (const h of [...hidden, ...gone]) await visits(gym, h.userId, DAYS);
      await visits(gym, asha.userId, DAYS.slice(0, 3));
      await visits(gym, bilal.userId, DAYS.slice(0, 2));
      await visits(gym, chen.userId, DAYS.slice(0, 2));
      await visits(gym, vera.userId, DAYS.slice(0, 1));

      const most = await add(gym, { name: "Most Days" });
      const reach = await add(gym, { name: "Reach Four", target: 4 });
      const teams = await add(gym, { name: "Team Days", teams: "staff", teamList: [{ id: null, name: "Red Team" }, { id: null, name: "Blue Team" }] });
      const red = teams.teamList.find((t) => t.name === "Red Team")?.id ?? "";
      const blue = teams.teamList.find((t) => t.name === "Blue Team")?.id ?? "";
      const put = await inject("PUT", `${base(gym.id)}/${teams.id}/team-people`, gym.owner.cookies, {
        people: [
          ...[asha, bilal, ...hidden, ...gone].map((p) => ({ userId: p.userId, teamId: red })),
          ...[vera, chen].map((p) => ({ userId: p.userId, teamId: blue })),
        ],
      });
      expect(put.statusCode, put.body).toBe(200);
      await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${gym.id} AND user_id = ${removed.userId}`;
      await sql`UPDATE users SET status = 'deleted' WHERE id = ${deleted.userId}`;

      // Nothing is posted while they run.
      expect(await run([gym])).toEqual({ posted: 0 });
      clock = THURSDAY;
      expect(await run([gym])).toEqual({ posted: 3 });

      const secret = [...hidden, ...gone].map((p) => p.userId);
      const names = ["Hema", "Yuvi", "Rhea", "Tariq", "Rana", "Dev Deleted", "Sana"];
      const nothingOf = (body: string, who: string, but: string[] = []) => {
        for (const id of secret) if (!but.includes(id)) expect(body.includes(id), `${who}: somebody hidden or gone is in the reply: ${id}`).toBe(false);
        for (const name of names) if (!but.includes(name)) expect(body.includes(name), `${who}: the name ${name} is in the reply`).toBe(false);
      };

      // What is kept: the challenge's name and that it ended. No person is in the words.
      const kept = await rows(gym.id);
      expect(kept.map((r) => [r.body, r.author])).toEqual([
        [`Most Days${GYM_CHALLENGE_RESULT_POST_ENDING}`, null],
        [`Reach Four${GYM_CHALLENGE_RESULT_POST_ENDING}`, null],
        [`Team Days${GYM_CHALLENGE_RESULT_POST_ENDING}`, null],
      ]);

      // Vera reads Updates. The winner is Asha with 3, never one of the eight with 6.
      const forVera = await feed(gym, vera);
      nothingOf(forVera.body, "Vera");
      expect(forVera.posts).toHaveLength(3);
      const veras = resultOf(forVera, most.id);
      expect(veras.state).toBe("ended");
      expect(veras.board.status).toBe("shown");
      expect(veras.board.ranked).toBe(4);
      expect(topOf(veras)).toEqual([
        ["Asha R.", 3, 1],
        ["Bilal K.", 2, 2],
        ["Chen W.", 2, 2],
      ]);
      expect([veras.me?.value, veras.me?.place]).toEqual([1, 4]);
      // Nobody members may see reached 4; the eight who did are not counted.
      expect(resultOf(forVera, reach.id).board.reached).toBe(0);
      // Red is Asha's 3 and Bilal's 2: 5, never 41 with the six hidden people's 36.
      expect(resultOf(forVera, teams.id).teamBoard?.rows.map((t) => [t.name, t.people, t.value, t.place])).toEqual([
        ["Red Team", 2, 5, 1],
        ["Blue Team", 2, 3, 2],
      ]);

      // Staff read the post as members do, with no line of their own.
      const forStaff = await staffFeed(gym);
      nothingOf(forStaff.body, "staff");
      const staffs = resultOf(forStaff, most.id);
      expect(topOf(staffs)).toEqual(topOf(veras));
      expect(staffs.me).toBeNull();
      expect(resultOf(forStaff, teams.id).teamBoard?.mine).toBeNull();

      // Hema, hidden, reads her own number and nobody else's hidden one; the winner is still Asha.
      const forHema = await feed(gym, hema);
      nothingOf(forHema.body, "Hema", [hema.userId, "Hema"]);
      const hemas = resultOf(forHema, most.id);
      expect(topOf(hemas)).toEqual(topOf(veras));
      expect([hemas.me?.value, hemas.me?.hidden]).toEqual([6, "hide_me"]);

      // AFTER the post went up, the winner chooses Hide me: she is named no longer.
      await sql`UPDATE users SET leaderboard_opt_out = true WHERE id = ${asha.userId}`;
      const afterHide = await feed(gym, vera);
      expect(afterHide.body.includes("Asha")).toBe(false);
      expect(afterHide.body.includes(asha.userId)).toBe(false);
      expect(topOf(resultOf(afterHide, most.id))).toEqual([
        ["Bilal K.", 2, 1],
        ["Chen W.", 2, 1],
        ["Vera V.", 1, 3],
      ]);
      expect(resultOf(afterHide, teams.id).teamBoard?.rows.map((t) => [t.name, t.people, t.value, t.place])).toEqual([
        ["Red Team", 1, 2, 2],
        ["Blue Team", 2, 3, 1],
      ]);
      expect((await staffFeed(gym)).body.includes("Asha")).toBe(false);

      // Then a joint winner leaves the gym: named no longer, and with two people left no places.
      await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${gym.id} AND user_id = ${bilal.userId}`;
      const afterLeft = await feed(gym, vera);
      expect(afterLeft.body.includes("Bilal")).toBe(false);
      expect(afterLeft.body.includes(bilal.userId)).toBe(false);
      const left = resultOf(afterLeft, most.id);
      expect([left.board.status, left.board.top, left.board.ranked]).toEqual(["too_few", [], 0]);
      expect(resultOf(afterLeft, teams.id).teamBoard?.status).toBe("too_few");

      // It is the hidden rule that holds them out: Hema shown again, she is the winner with 6.
      await sql`UPDATE users SET leaderboard_opt_out = false WHERE id = ${hema.userId}`;
      expect(topOf(resultOf(await feed(gym, vera), most.id))).toEqual([
        ["Hema H.", 6, 1],
        ["Chen W.", 2, 2],
        ["Vera V.", 1, 3],
      ]);
    },
    T,
  );

  // ===========================================================================
  // POSTED ONCE
  // ===========================================================================

  it(
    "a result is posted once: not twice in a row, not by two runs at one instant, and never again after staff remove it",
    async () => {
      clock = MONDAY;
      const gym = await makeGym("Once Hall");
      const vera = await member(gym, "Vera Viewer");
      const challenge = await add(gym);
      expect((await staffSeen(gym, challenge.id)).resultPost).toBeNull();
      clock = THURSDAY;

      const together = await Promise.all([run([gym]), run([gym]), run([gym])]);
      expect(together.map((r) => r.posted).sort()).toEqual([0, 0, 1]);
      expect(await run([gym])).toEqual({ posted: 0 });
      const kept = await rows(gym.id);
      expect(kept).toHaveLength(1);
      expect(await audits(gym.id)).toBe(1);

      const post = postOf(await feed(gym, vera), challenge.id);
      const seen = await staffSeen(gym, challenge.id);
      expect(seen.resultPost).toEqual({ postedAt: THURSDAY.toISOString(), removed: false, hidden: false });
      expect(post.createdAt).toBe(THURSDAY.toISOString());
      // From the gym, by nobody: no member's name on it, and nothing of theirs to remove or block.
      expect([post.author.name, post.fromMember, post.authorId, post.own, post.wrote]).toEqual([null, false, null, false, false]);

      // A member reacts to it; it is not theirs to remove. Staff pin it, then remove it.
      expect((await inject("PUT", `${posts(gym.id)}/${post.id}/reaction`, vera.cookies, { reaction: "fire" })).statusCode).toBe(200);
      expect((await inject("DELETE", `${posts(gym.id)}/mine/${post.id}`, vera.cookies)).statusCode).toBe(404);
      expect((await inject("PUT", `${posts(gym.id)}/${post.id}/pin`, gym.owner.cookies, { pinned: true })).statusCode).toBe(200);
      const pinned = postOf(await feed(gym, vera), challenge.id);
      expect([pinned.pinned, pinned.reactions.fire, pinned.mine]).toEqual([true, 1, "fire"]);
      expect((await inject("DELETE", `${posts(gym.id)}/${post.id}`, gym.owner.cookies)).statusCode).toBe(200);

      expect(await run([gym])).toEqual({ posted: 0 });
      expect((await rows(gym.id)).map((r) => [r.id, r.removed])).toEqual([[post.id, true]]);
      expect((await feed(gym, vera)).posts).toEqual([]);
      expect((await staffSeen(gym, challenge.id)).resultPost).toEqual({ postedAt: THURSDAY.toISOString(), removed: true, hidden: false });
    },
    T,
  );

  it(
    "nothing is posted for a challenge that is running, cancelled, or ended more than 14 days ago, for a closed gym, or for a gym on no plan until its plan is back",
    async () => {
      clock = MONDAY;
      const gym = await makeGym("Rules Hall");
      const running = await add(gym, { name: "Still Running", endsOn: "2026-10-31" });
      const cancelled = await add(gym, { name: "Called Off" });
      expect((await inject("PUT", `${base(gym.id)}/${cancelled.id}/cancelled`, gym.owner.cookies, { cancelled: true })).statusCode).toBe(200);
      const old = await makeGym("Old Hall");
      await add(old, { name: "Long Ago" });
      const lapsed = await makeGym("Lapsed Hall");
      const theirs = await add(lapsed, { name: "No Plan" });
      await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${lapsed.id}`;

      const closed = await makeGym("Closed Hall");
      await add(closed, { name: "Shut" });
      await sql`UPDATE gyms SET status = 'archived' WHERE id = ${closed.id}`;

      clock = THURSDAY;
      expect(await run([gym, lapsed, closed])).toEqual({ posted: 0 });
      expect(await rows(gym.id)).toEqual([]);
      // Open again inside the fortnight, it is posted: the line that held it back is the gym's own state.
      await sql`UPDATE gyms SET status = 'active' WHERE id = ${closed.id}`;
      expect(await run([closed])).toEqual({ posted: 1 });
      expect((await staffSeen(gym, running.id)).resultPost).toBeNull();

      // Its last day was 6 October: the 20th is the 14th day after, the 21st is past it.
      expect(await run([old], new Date("2026-10-21T06:30:00Z"))).toEqual({ posted: 0 });
      expect(await run([old], new Date("2026-10-20T06:30:00Z"))).toEqual({ posted: 1 });

      // The plan comes back inside the fortnight: the result is posted then.
      await livePlan(lapsed.id);
      expect(await run([lapsed])).toEqual({ posted: 1 });
      expect((await rows(lapsed.id)).map((r) => r.challenge_id)).toEqual([theirs.id]);
    },
    T,
  );

  it(
    "a challenge ends at midnight on its own gym's clock: one instant posts Kolkata's and not New York's",
    async () => {
      clock = MONDAY;
      const east = await makeGym("East Hall");
      const west = await makeGym("West Hall", { city: "New York", country: "US", timezone: "America/New_York" });
      await add(east);
      await add(west);
      // 00:29 on the 7th in Kolkata, 14:59 on the 6th in New York.
      expect(await run([east, west], new Date("2026-10-06T18:59:00Z"))).toEqual({ posted: 1 });
      expect([(await rows(east.id)).length, (await rows(west.id)).length]).toEqual([1, 0]);
      // 23:59 on the 6th in New York, then a minute past its midnight.
      expect(await run([east, west], new Date("2026-10-07T03:59:00Z"))).toEqual({ posted: 0 });
      expect(await run([east, west], new Date("2026-10-07T04:01:00Z"))).toEqual({ posted: 1 });
    },
    T,
  );

  it(
    "the run the worker makes, with no gyms named, posts this gym's result once",
    async () => {
      // Every gym in the database is looked at, as in production. The run is made in 2031,
      // where no other test's challenge is inside the fortnight, so no other gym gets a post.
      clock = new Date("2031-03-05T06:30:00Z");
      const gym = await makeGym("Whole Hall");
      await add(gym, { startsOn: "2031-03-01", endsOn: "2031-03-06" });
      const later = new Date("2031-03-08T06:30:00Z");
      clock = later;
      await postChallengeResults({ sql, log }, { now: later });
      expect((await rows(gym.id)).map((r) => r.body)).toEqual([`October Six${GYM_CHALLENGE_RESULT_POST_ENDING}`]);
      await postChallengeResults({ sql, log }, { now: later });
      expect(await rows(gym.id)).toHaveLength(1);
      expect(await audits(gym.id)).toBe(1);
    },
    T,
  );

  it(
    "a gym that moves its clock back after the post went up: the post is in no list while the challenge is running again",
    async () => {
      clock = MONDAY;
      const gym = await makeGym("Zone Hall");
      const vera = await member(gym, "Vera Viewer");
      const challenge = await add(gym, { name: "Zone Run" });
      // 00:30 on the 7th in Kolkata: ended, and posted.
      clock = new Date("2026-10-06T19:00:00Z");
      expect(await run([gym])).toEqual({ posted: 1 });
      expect((await feed(gym, vera)).posts.map((p) => p.body)).toEqual([`Zone Run${GYM_CHALLENGE_RESULT_POST_ENDING}`]);
      // The gym's clock becomes New York's: it is 15:00 on the 6th there, the last day.
      await sql`UPDATE gyms SET timezone = 'America/New_York' WHERE id = ${gym.id}`;
      expect((await memberList(gym, vera)).challenges.map((c) => [c.name, c.state])).toEqual([["Zone Run", "running"]]);
      const during = await feed(gym, vera);
      expect(during.posts).toEqual([]);
      expect(during.body.includes("has ended")).toBe(false);
      expect((await staffFeed(gym)).posts).toEqual([]);
      // Its last day over there too, the post is back with its result, and no second one was made.
      clock = THURSDAY;
      expect(await run([gym])).toEqual({ posted: 0 });
      expect(postOf(await feed(gym, vera), challenge.id).challengeResult?.challenge.state).toBe("ended");
      expect(postOf(await staffFeed(gym), challenge.id).body).toBe(`Zone Run${GYM_CHALLENGE_RESULT_POST_ENDING}`);
    },
    T,
  );

  it(
    "five members report the result post: staff are told it is hidden from members, and members are sent none of it",
    async () => {
      clock = MONDAY;
      const gym = await makeGym("Report Hall");
      const people = [];
      for (const name of ["Ann One", "Ben Two", "Cat Three", "Dan Four", "Eve Five", "Fay Six"]) people.push(await member(gym, name));
      const challenge = await add(gym);
      clock = THURSDAY;
      await run([gym]);
      const [last] = people.slice(-1);
      if (last === undefined) throw new Error("no member");
      const post = postOf(await feed(gym, last), challenge.id);
      for (const who of people.slice(0, 4)) expect((await inject("POST", `${posts(gym.id)}/${post.id}/report`, who.cookies, { reason: "other" })).statusCode).toBe(200);
      expect((await staffSeen(gym, challenge.id)).resultPost?.hidden).toBe(false);
      expect((await feed(gym, last)).posts).toHaveLength(1);
      const fifth = people[4];
      if (fifth === undefined) throw new Error("no fifth member");
      expect((await inject("POST", `${posts(gym.id)}/${post.id}/report`, fifth.cookies, { reason: "other" })).statusCode).toBe(200);
      expect((await feed(gym, last)).posts).toEqual([]);
      expect((await staffSeen(gym, challenge.id)).resultPost).toEqual({ postedAt: THURSDAY.toISOString(), removed: false, hidden: true });
    },
    T,
  );

  // ===========================================================================
  // ONE ANSWER, AND WHOSE IT IS
  // ===========================================================================

  it(
    "the post and the Challenges tab are sent the same challenge; after the tab drops it the post still carries the result and says it cannot be opened",
    async () => {
      clock = MONDAY;
      const gym = await makeGym("Same Hall");
      const vera = await member(gym, "Vera Viewer");
      const asha = await quiet(gym, "Asha Rao");
      const bilal = await quiet(gym, "Bilal Khan");
      await visits(gym, vera.userId, DAYS.slice(0, 4));
      await visits(gym, asha.userId, DAYS.slice(0, 5));
      await visits(gym, bilal.userId, DAYS.slice(0, 2));
      const challenge = await add(gym, { prize: "A month free" });
      clock = THURSDAY;
      await run([gym]);

      const onTab = (await memberList(gym, vera)).challenges.find((c) => c.id === challenge.id);
      const result = postOf(await feed(gym, vera), challenge.id).challengeResult;
      // The same in everything but the days the tab draws as flames, which the post does not carry.
      expect(onTab?.me?.days).toEqual(DAYS.slice(0, 4));
      expect(result?.challenge).toEqual({ ...onTab, me: { ...onTab?.me, days: [] } });
      expect([result?.today, result?.canOpen, result?.challenge.prize]).toEqual(["2026-10-08", true, "A month free"]);
      expect(topOf(result?.challenge ?? resultOf({ posts: [] }, ""))).toEqual([
        ["Asha R.", 5, 1],
        ["Vera V.", 4, 2],
        ["Bilal K.", 2, 3],
      ]);

      // Three weeks on the tab no longer lists it; the post stays, with the same result.
      clock = new Date("2026-10-29T06:30:00Z");
      expect((await memberList(gym, vera)).challenges).toEqual([]);
      const later = postOf(await feed(gym, vera), challenge.id).challengeResult;
      expect([later?.today, later?.canOpen]).toEqual(["2026-10-29", false]);
      expect(later?.challenge.board).toEqual(onTab?.board);
      expect(postOf(await staffFeed(gym), challenge.id).challengeResult?.canOpen).toBe(true);
    },
    T,
  );

  it(
    "the tab lists the newest three that ended: a fourth inside the 14 days keeps its post and its result, and offers no way to open it",
    async () => {
      // Made on the 2nd, so that four can end on the 3rd, 4th, 5th and 6th.
      clock = new Date("2026-10-02T06:30:00Z");
      const gym = await makeGym("Four Hall");
      const vera = await member(gym, "Vera Viewer");
      const made = [];
      for (const day of ["03", "04", "05", "06"]) made.push(await add(gym, { name: `Ends ${day}`, endsOn: `2026-10-${day}` }));
      clock = THURSDAY;
      expect(await run([gym])).toEqual({ posted: 4 });
      expect((await memberList(gym, vera)).challenges.map((c) => c.name)).toEqual(["Ends 06", "Ends 05", "Ends 04"]);
      const read = await feed(gym, vera);
      expect(made.map((c) => [c.name, postOf(read, c.id).challengeResult?.canOpen])).toEqual([
        ["Ends 03", false],
        ["Ends 04", true],
        ["Ends 05", true],
        ["Ends 06", true],
      ]);
      expect(postOf(read, made[0]?.id ?? "").challengeResult?.challenge.state).toBe("ended");
    },
    T,
  );

  it(
    "numbers staff type after the last day show in the post that was already up",
    async () => {
      clock = MONDAY;
      const gym = await makeGym("Own Hall");
      const vera = await member(gym, "Vera Viewer");
      const asha = await quiet(gym, "Asha Rao");
      const bilal = await quiet(gym, "Bilal Khan");
      const challenge = await add(gym, { name: "Push-up Week", counts: "own", unit: "push-ups" });
      clock = THURSDAY;
      expect(await run([gym])).toEqual({ posted: 1 });
      const before = resultOf(await feed(gym, vera), challenge.id);
      expect([before.board.status, before.board.top]).toEqual(["too_few", []]);

      const typed = await inject("PUT", `${base(gym.id)}/${challenge.id}/scores`, gym.owner.cookies, {
        scores: [
          { userId: vera.userId, value: 40 },
          { userId: asha.userId, value: 55 },
          { userId: bilal.userId, value: 31 },
        ],
      });
      expect(typed.statusCode, typed.body).toBe(200);
      const after = resultOf(await feed(gym, vera), challenge.id);
      expect(topOf(after)).toEqual([
        ["Asha R.", 55, 1],
        ["Vera V.", 40, 2],
        ["Bilal K.", 31, 3],
      ]);
      expect((await rows(gym.id)).length).toBe(1);
    },
    T,
  );

  it(
    "a stranger and another gym's people are sent no result post, and another gym's post cannot be reacted to through one's own gym",
    async () => {
      clock = MONDAY;
      const gym = await makeGym("Mine Hall");
      const vera = await member(gym, "Vera Viewer");
      const asha = await quiet(gym, "Asha Rao");
      const bilal = await quiet(gym, "Bilal Khan");
      for (const p of [vera, asha, bilal]) await visits(gym, p.userId, DAYS.slice(0, 2));
      const other = await makeGym("Their Hall");
      const olga = await member(other, "Olga Other");
      const challenge = await add(gym);
      clock = THURSDAY;
      await run([gym, other]);
      const post = postOf(await feed(gym, vera), challenge.id);

      const stranger = await signedIn("Sam Stranger");
      for (const who of [stranger, olga, other.owner]) {
        expect((await inject("GET", posts(gym.id), who.cookies)).statusCode).toBe(404);
        expect((await inject("GET", `${posts(gym.id)}/staff`, who.cookies)).statusCode).toBe(404);
        expect((await inject("PUT", `${posts(gym.id)}/${post.id}/reaction`, who.cookies, { reaction: "like" })).statusCode).toBe(404);
      }
      expect((await inject("GET", posts(gym.id), {})).statusCode).toBe(401);
      // Her own gym's Updates has nothing of it, and its address does not reach the post.
      const hers = await feed(other, olga);
      expect(hers.posts).toEqual([]);
      expect(hers.body.includes(challenge.id)).toBe(false);
      expect((await inject("PUT", `${posts(other.id)}/${post.id}/reaction`, olga.cookies, { reaction: "like" })).statusCode).toBe(404);
      expect((await inject("DELETE", `${posts(other.id)}/${post.id}`, other.owner.cookies)).statusCode).toBe(404);
      expect((await rows(gym.id)).map((r) => r.removed)).toEqual([false]);
    },
    T,
  );
});
