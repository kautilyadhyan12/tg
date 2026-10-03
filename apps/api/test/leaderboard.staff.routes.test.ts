// THE LEADERBOARD IN THE CONSOLE — the staff routes against real Postgres (spec Part 3
// §15.5; ROADMAP 19a-iii). DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: another gym's staff, or a member,
// reads this gym's full names and visit times. That is the first test below.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type {
  LeaderboardProfileResponse,
  LeaderboardResponse,
  StaffLeaderboardCountedResponse,
  StaffLeaderboardProfileResponse,
  StaffLeaderboardResponse,
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
  JWT_SECRET: "leaderboard-staff-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 60_000;
const LIVE_PLAN = "zz_lbs_live";
/** Wednesday 7 October 2026, noon in Kolkata. */
const WEDNESDAY = new Date("2026-10-07T06:30:00Z");
const TICKS = ["members.read", "attendance.read", "leaderboard.manage"];

let ipCounter = 0;
const nextIp = () => `10.23.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("the leaderboard in the console (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'lbs-t-%@example.com')`;
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'lbs-t-%@example.com'`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
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
    await sql`DELETE FROM users WHERE email LIKE 'lbs-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST" | "PUT", path: string, cookies: Cookies, payload?: unknown, ip = nextIp()) =>
    api().inject({
      method,
      url: path,
      remoteAddress: ip,
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const get = (path: string, cookies: Cookies = {}) => inject("GET", path, cookies);
  const put = (path: string, cookies: Cookies, payload: unknown) => inject("PUT", path, cookies, payload);

  interface Person {
    userId: string;
    email: string;
    cookies: Cookies;
  }

  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `lbs-t-${uniq()}@example.com`;
    const reg = await inject("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await inject("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, email, cookies: cookieMap(login) };
  };

  const account = async (displayName: string, local?: string): Promise<{ userId: string; email: string }> => {
    const email = `lbs-t-${local ?? "p"}-${uniq()}@example.com`;
    const rows = await sql<{ id: string }[]>`
      INSERT INTO users (email, display_name) VALUES (${email}, ${displayName}) RETURNING id`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("no user");
    return { userId: id, email };
  };

  interface Gym {
    id: string;
    owner: Person;
    deviceId: string;
  }

  const makeGym = async (name: string, live = true): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await inject("POST", "/v1/orgs", owner.cookies, {
      trainsHere: false,
      name,
      city: "Jorhat",
      country: "IN",
      timezone: "Asia/Kolkata",
    });
    expect(res.statusCode).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    if (live) {
      await sql`
        INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
        VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    }
    const dev = await sql<{ id: string }[]>`
      INSERT INTO gym_checkin_devices (gym_id, name) VALUES (${id}, 'Front desk') RETURNING id`;
    return { id, owner, deviceId: dev[0]?.id ?? "" };
  };

  const addStaff = async (gymId: string, userId: string, role: "manager" | "trainer", privileges: string[] | null) => {
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gymId}, ${userId}, ${role}, ${privileges})`;
  };

  const record = async (gymId: string, fullName: string, former = false, email = `lbs-r-${uniq()}@example.com`): Promise<string> => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO gym_member_list_entries (gym_id, full_name, email, identity_key, source, former_at)
      VALUES (${gymId}, ${fullName}, ${email}, encode(sha256(${`lbs-${uniq()}`}::bytea), 'hex'), 'typed',
              ${former ? sql`now()` : null})
      RETURNING id`;
    return rows[0]?.id ?? "";
  };

  const join = async (gymId: string, userId: string, entryId: string | null = null): Promise<void> => {
    await sql`
      INSERT INTO gym_members (gym_id, user_id, entry_id, joined_at)
      VALUES (${gymId}, ${userId}, ${entryId}, '2026-01-01T00:00:00Z')`;
  };

  /** A finished app workout at 07:30 in Kolkata, saved half an hour later. */
  const workout = async (userId: string, day: string): Promise<void> => {
    await sql`
      INSERT INTO workouts (id, user_id, started_at, platform, engine_version, sets_count, total_reps, created_at)
      VALUES (gen_random_uuid(), ${userId}, ${`${day}T02:00:00Z`}, 'web', 'test', 1, 10, ${`${day}T02:30:00Z`})`;
  };

  /** A desk scan at noon on a day of the gym's calendar. */
  const visit = async (gym: Gym, userId: string, day: string, slot = 0): Promise<void> => {
    const opens = 360 + slot * 120;
    await sql`
      INSERT INTO gym_attendance
        (gym_id, user_id, device_id, day, marked_at, method, hours_status, session_opens_minute, session_closes_minute, slot_key)
      VALUES (${gym.id}, ${userId}, ${gym.deviceId}, ${day}::date,
              (${day}::date + time '12:00' + ${slot} * interval '2 hours') AT TIME ZONE 'Asia/Kolkata', 'pass',
              'in_session', ${opens}, ${opens + 60}, ${`${String(opens)}-${String(opens + 60)}`})`;
  };

  const base = (gymId: string) => `/v1/orgs/${gymId}/leaderboard/staff`;
  const staffBoard = async (gym: Gym, who: Person, q = "board=gym_days&period=this_week"): Promise<StaffLeaderboardResponse> => {
    const res = await get(`${base(gym.id)}?${q}`, who.cookies);
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body) as StaffLeaderboardResponse;
  };
  const memberBoard = async (gym: Gym, who: Person, q = "board=gym_days&period=this_week"): Promise<LeaderboardResponse> => {
    const res = await get(`/v1/orgs/${gym.id}/leaderboard?${q}`, who.cookies);
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body) as LeaderboardResponse;
  };
  const audits = async (gymId: string, action: string): Promise<number> => {
    const rows = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${gymId} AND action = ${action}`;
    return rows[0]?.n ?? 0;
  };

  /** A gym with a member who signs in, three more on the board, and visits this week. */
  const busyGym = async (name: string) => {
    const gym = await makeGym(name);
    const viewer = await signedIn("Vera Viewer");
    const asha = await account("Asha Rao");
    const bilal = await account("Bilal Khan");
    const chen = await account("Chen Wu");
    for (const p of [viewer, asha, bilal, chen]) await join(gym.id, p.userId);
    for (const day of ["2026-10-05", "2026-10-06", "2026-10-07"]) await visit(gym, chen.userId, day);
    for (const day of ["2026-10-05", "2026-10-06"]) await visit(gym, bilal.userId, day);
    await visit(gym, asha.userId, "2026-10-05");
    await visit(gym, viewer.userId, "2026-10-06");
    return { gym, viewer, asha, bilal, chen };
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), { redis, orgs: { now: () => WEDNESDAY } });
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
    "nobody but this gym's staff holding the tick reads a name, a number or a visit time, or changes anything",
    async () => {
      const { gym, viewer, asha, chen } = await busyGym("Private House");
      await workout(chen.userId, "2026-10-06");
      // Another gym's owner holds the tick — at their own gym.
      const other = await makeGym("Other House");
      const outsider = await account("Olga Outsider");
      await join(other.id, outsider.userId);
      const stranger = await signedIn("Sam Stranger");
      const trainer = await signedIn("Tara Trainer");
      await addStaff(gym.id, trainer.userId, "trainer", ["members.read", "attendance.read"]);
      const defaultTrainer = await signedIn("Dev Default");
      await addStaff(gym.id, defaultTrainer.userId, "trainer", null);

      const reads = [
        `${base(gym.id)}?board=gym_days&period=this_week`,
        `${base(gym.id)}?board=workout_days&period=all_time`,
        `${base(gym.id)}?board=streak`,
        `${base(gym.id)}/people/${chen.userId}`,
        `${base(gym.id)}/people/${chen.userId}/counted?board=gym_days&period=this_week`,
        `${base(gym.id)}/people/${chen.userId}/counted?board=workout_days&period=this_week`,
        `${base(gym.id)}/people/${chen.userId}/counted?board=streak`,
      ];
      const writes: [string, unknown][] = [
        [`${base(gym.id)}/people/${chen.userId}`, { takenOff: true }],
        [`${base(gym.id)}/boards`, { board: "gym_days", off: true }],
      ];
      const leaks = /Asha|Bilal|Chen|Vera|Rao|Khan|Front desk|"at"|"value"/;
      const refused: [string, Cookies, number][] = [
        ["another gym's owner", other.owner.cookies, 404],
        ["a member of this gym", viewer.cookies, 404],
        ["a stranger", stranger.cookies, 404],
        ["a trainer of this gym without the tick", trainer.cookies, 403],
        ["a trainer on the role's own ticks", defaultTrainer.cookies, 403],
        ["nobody signed in", {}, 401],
      ];
      for (const [who, cookies, status] of refused) {
        for (const path of reads) {
          const res = await get(path, cookies);
          expect(res.statusCode, `${who} GET ${path}`).toBe(status);
          expect(res.body, `${who} GET ${path}`).not.toMatch(leaks);
          expect(res.body).not.toContain(chen.userId);
        }
        for (const [path, body] of writes) {
          const res = await put(path, cookies, body);
          expect(res.statusCode, `${who} PUT ${path}`).toBe(status);
        }
      }
      // Nothing was written by any of them.
      const state = await sql<{ taken: boolean; off: string[] }[]>`
        SELECT m.hidden_from_boards AS taken, g.leaderboard_boards_off AS off
        FROM gym_members m JOIN gyms g ON g.id = m.gym_id
        WHERE m.gym_id = ${gym.id} AND m.user_id = ${chen.userId}`;
      expect(state).toEqual([{ taken: false, off: [] }]);

      // This gym's owner, asking about a person of ANOTHER gym through their own gym: nobody.
      for (const path of [
        `${base(gym.id)}/people/${outsider.userId}`,
        `${base(gym.id)}/people/${outsider.userId}/counted?board=gym_days&period=all_time`,
      ]) {
        const res = await get(path, gym.owner.cookies);
        expect(res.statusCode).toBe(404);
        expect(res.body).not.toMatch(/Olga/);
      }
      const takeOutsider = await put(`${base(gym.id)}/people/${outsider.userId}`, gym.owner.cookies, { takenOff: true });
      expect(takeOutsider.statusCode).toBe(404);
      const untouched = await sql<{ taken: boolean }[]>`
        SELECT hidden_from_boards AS taken FROM gym_members WHERE gym_id = ${other.id} AND user_id = ${outsider.userId}`;
      expect(untouched).toEqual([{ taken: false }]);

      // And the owner does read it: the refusals above are not a route that answers nobody.
      const mine = await staffBoard(gym, gym.owner);
      expect(mine.rows.map((r) => r.name)).toEqual(["Chen Wu", "Bilal Khan", "Asha Rao", "Vera Viewer"]);
      expect(asha.userId).toBe(mine.rows[2]?.userId);
    },
    T,
  );

  // ===========================================================================
  // WHAT STAFF SEE
  // ===========================================================================

  it(
    "staff see everyone by full name; the hidden carry the reason and no place; the places are the members' own",
    async () => {
      const { gym, viewer } = await busyGym("Full House");
      const hideMe = await account("Hema Hidden");
      await sql`UPDATE users SET leaderboard_opt_out = true WHERE id = ${hideMe.userId}`;
      const young = await account("Yuvi Young");
      await sql`INSERT INTO user_fitness_profiles (user_id, age) VALUES (${young.userId}, 16)`;
      const takenOff = await account("Tariq Taken");
      const nameless = await account("x", "nameless");
      await sql`UPDATE users SET display_name = split_part(email::text, '@', 1) WHERE id = ${nameless.userId}`;
      const coach = await account("Cora Coach");
      await addStaff(gym.id, coach.userId, "trainer", null);
      for (const p of [hideMe, young, takenOff, nameless, coach]) await join(gym.id, p.userId);
      await sql`UPDATE gym_members SET hidden_from_boards = true WHERE gym_id = ${gym.id} AND user_id = ${takenOff.userId}`;
      // Each hidden person has MORE gym days than anybody shown.
      for (const p of [hideMe, young, takenOff, nameless, coach]) {
        for (const day of ["2026-10-05", "2026-10-06", "2026-10-07"]) await visit(gym, p.userId, day);
        await visit(gym, p.userId, "2026-10-07", 1);
      }
      // On the list without the app: two current records and one former.
      await record(gym.id, "Nina NoApp");
      await record(gym.id, "Noor NoApp");
      await record(gym.id, "Fred Former", true);
      // A member with a record is in the app: not counted as without it.
      const withRecord = await account("Rita Record");
      await join(gym.id, withRecord.userId, await record(gym.id, "Rita Record"));

      const board = await staffBoard(gym, gym.owner);
      expect(board.rows.map((r) => [r.name, r.place, r.value, r.hidden])).toEqual([
        ["Chen Wu", 1, 3, null],
        ["Cora Coach", null, 3, "staff"],
        ["Hema Hidden", null, 3, "hide_me"],
        ["Tariq Taken", null, 3, "taken_off"],
        ["Yuvi Young", null, 3, "under_18"],
        [null, null, 3, "no_name"],
        ["Bilal Khan", 2, 2, null],
        ["Asha Rao", 3, 1, null],
        ["Vera Viewer", 3, 1, null],
      ]);
      expect(board.total).toBe(9);
      expect(board.ranked).toBe(4);
      expect(board.memberStatus).toBe("shown");
      expect(board.notInApp).toBe(2);
      // Somebody who joined with NO record, whose proved email is on the list, is in the app:
      // Members says so, and this page must not count them as without it.
      const byEmail = await account("Erin Email");
      await sql`
        INSERT INTO one_time_tokens (user_id, purpose, token_hash, expires_at, used_at)
        VALUES (${byEmail.userId}, 'verify_email', md5(random()::text), now(), now())`;
      await join(gym.id, byEmail.userId);
      await record(gym.id, "Erin Email", false, byEmail.email);
      expect((await staffBoard(gym, gym.owner)).notInApp).toBe(2);
      const list = await get(`/v1/orgs/${gym.id}/member-list`, gym.owner.cookies);
      expect(list.statusCode).toBe(200);
      // Members' own totals for the whole list, wherever its answer carries them.
      const totalsIn = (value: unknown): { entries: number; inApp: number } | null => {
        if (typeof value !== "object" || value === null) return null;
        const o = value as Record<string, unknown>;
        if (typeof o["entries"] === "number" && typeof o["inApp"] === "number") return { entries: o["entries"], inApp: o["inApp"] };
        for (const inner of Object.values(o)) {
          const found = totalsIn(inner);
          if (found !== null) return found;
        }
        return null;
      };
      const totals = totalsIn(JSON.parse(list.body));
      expect(totals).toEqual({ entries: 4, inApp: 2 });
      expect(JSON.stringify(board)).not.toContain("@");

      // The places staff see are the ones members see.
      const members = await memberBoard(gym, viewer);
      const seen = board.rows.filter((r) => r.hidden === null).map((r) => [r.userId, r.place, r.value]);
      expect(members.rows.map((r) => [r.userId, r.place, r.value])).toEqual(seen);

      // A hidden person's profile, for staff: the reason, their numbers, no place.
      const res = await get(`${base(gym.id)}/people/${takenOff.userId}`, gym.owner.cookies);
      expect(res.statusCode).toBe(200);
      const profile = JSON.parse(res.body) as StaffLeaderboardProfileResponse;
      expect(profile).toMatchObject({ name: "Tariq Taken", hidden: "taken_off", takenOff: true, hiddenWithoutTakeOff: null, isStaff: false, entryId: null });
      expect(profile.boards).toEqual([
        { board: "gym_days", period: "this_week", place: null, value: 3, memberStatus: "shown" },
        { board: "workout_days", period: "this_week", place: null, value: 0, memberStatus: "too_few" },
        { board: "streak", period: null, place: null, value: 1, memberStatus: "shown" },
      ]);
      // A shown person's panel carries the place members see.
      const chenRow = board.rows[0];
      const chenPanel = JSON.parse((await get(`${base(gym.id)}/people/${chenRow?.userId ?? ""}`, gym.owner.cookies)).body) as StaffLeaderboardProfileResponse;
      expect(chenPanel.boards[0]).toEqual({ board: "gym_days", period: "this_week", place: 1, value: 3, memberStatus: "shown" });
      expect(chenPanel.boards[0]?.place).toBe(members.rows.find((r) => r.userId === chenRow?.userId)?.place);
      // Somebody who chose Hide me AND was taken off: put back, members still would not see them.
      await sql`UPDATE gym_members SET hidden_from_boards = true WHERE gym_id = ${gym.id} AND user_id = ${hideMe.userId}`;
      const both = JSON.parse((await get(`${base(gym.id)}/people/${hideMe.userId}`, gym.owner.cookies)).body) as StaffLeaderboardProfileResponse;
      expect([both.hidden, both.takenOff, both.hiddenWithoutTakeOff]).toEqual(["taken_off", true, "hide_me"]);
      const rita = await get(`${base(gym.id)}/people/${withRecord.userId}`, gym.owner.cookies);
      expect((JSON.parse(rita.body) as StaffLeaderboardProfileResponse).entryId).toMatch(/^[0-9a-f-]{36}$/);
    },
    T,
  );

  it(
    "the page of a hundred: the second page carries on where the first stopped, and a page past the end is the last",
    async () => {
      const gym = await makeGym("Big House");
      const ids: string[] = [];
      for (let i = 0; i < 103; i += 1) {
        const p = await account(`Member ${String(i).padStart(3, "0")}`);
        ids.push(p.userId);
      }
      await sql`
        INSERT INTO gym_members (gym_id, user_id, joined_at)
        SELECT ${gym.id}, u, '2026-01-01T00:00:00Z' FROM unnest(${ids}::uuid[]) u`;
      await sql`
        INSERT INTO gym_attendance
          (gym_id, user_id, device_id, day, marked_at, method, hours_status, session_opens_minute, session_closes_minute, slot_key)
        SELECT ${gym.id}, u, ${gym.deviceId}, '2026-10-06'::date, '2026-10-06T06:30:00Z', 'pass', 'in_session', 360, 420, '360-420'
        FROM unnest(${ids}::uuid[]) u`;
      const first = await staffBoard(gym, gym.owner, "board=gym_days&period=this_week");
      expect([first.total, first.page, first.pages, first.rows.length]).toEqual([103, 1, 2, 100]);
      const second = await staffBoard(gym, gym.owner, "board=gym_days&period=this_week&page=2");
      expect(second.rows.map((r) => r.name)).toEqual(["Member 100", "Member 101", "Member 102"]);
      const past = await staffBoard(gym, gym.owner, "board=gym_days&period=this_week&page=9");
      expect([past.page, past.rows.length]).toEqual([2, 3]);
    },
    T,
  );

  it(
    "what counted for anyone: visits with their time and desk; a workout is a date, never a time; every number equals its list",
    async () => {
      const { gym, chen } = await busyGym("Counting House");
      await visit(gym, chen.userId, "2026-10-07", 1);
      await workout(chen.userId, "2026-10-05");
      await workout(chen.userId, "2026-10-06");
      // Saved nine days late: listed, not counted.
      await sql`
        INSERT INTO workouts (id, user_id, started_at, platform, engine_version, sets_count, total_reps, created_at)
        VALUES (gen_random_uuid(), ${chen.userId}, '2026-09-28T02:00:00Z', 'web', 'test', 1, 10, '2026-10-07T03:00:00Z')`;

      const counted = async (q: string): Promise<{ body: string; data: StaffLeaderboardCountedResponse }> => {
        const res = await get(`${base(gym.id)}/people/${chen.userId}/counted?${q}`, gym.owner.cookies);
        expect(res.statusCode).toBe(200);
        return { body: res.body, data: JSON.parse(res.body) as StaffLeaderboardCountedResponse };
      };

      const days = await counted("board=gym_days&period=this_week");
      expect(days.data.value).toBe(3);
      expect(days.data.days.map((x) => [x.day, x.visits.length])).toEqual([
        ["2026-10-07", 2],
        ["2026-10-06", 1],
        ["2026-10-05", 1],
      ]);
      expect(days.data.days[0]?.visits[0]).toMatchObject({ how: "desk", by: "Front desk" });
      const board = await staffBoard(gym, gym.owner);
      expect(board.rows.find((r) => r.userId === chen.userId)?.value).toBe(days.data.days.length);

      const workouts = await counted("board=workout_days&period=all_time");
      expect(workouts.data.workoutDays).toEqual([
        { day: "2026-10-06", workouts: 1 },
        { day: "2026-10-05", workouts: 1 },
      ]);
      expect(workouts.data.workoutsNotCounted).toEqual([{ day: "2026-09-28", why: "saved_late", daysLate: 9 }]);
      expect(workouts.data.value).toBe(workouts.data.workoutDays.length);
      // No time of day and no word about the workout itself reaches staff.
      expect(workouts.body).not.toMatch(/T\d\d:\d\d|countedBy|camera|"at"/);

      const streak = await counted("board=streak");
      expect(streak.data.value).toBe(1);
      expect(streak.data.weeks[0]).toEqual({ weekStart: "2026-10-05", state: "counted", gymDays: 3 });
    },
    T,
  );

  // ===========================================================================
  // TAKE OFF THE BOARD · PUT BACK
  // ===========================================================================

  it(
    "taken off: members stop seeing the person, with no gap; their own row says why; put back restores it; each is noted once",
    async () => {
      const { gym, viewer, bilal, chen } = await busyGym("Taking House");
      const off = await put(`${base(gym.id)}/people/${chen.userId}`, gym.owner.cookies, { takenOff: true });
      expect(off.statusCode).toBe(200);
      expect(JSON.parse(off.body)).toEqual({ takenOff: true });
      // The same press again changes nothing and notes nothing.
      expect((await put(`${base(gym.id)}/people/${chen.userId}`, gym.owner.cookies, { takenOff: true })).statusCode).toBe(200);
      expect(await audits(gym.id, "leaderboard.taken_off")).toBe(1);

      const after = await memberBoard(gym, viewer);
      expect(after.rows.map((r) => [r.name, r.place])).toEqual([
        ["Bilal K.", 1],
        ["Asha R.", 2],
        ["Vera V.", 2],
      ]);
      expect(JSON.stringify(after)).not.toContain(chen.userId);
      expect((await get(`/v1/orgs/${gym.id}/leaderboard/people/${chen.userId}`, viewer.cookies)).statusCode).toBe(404);
      // Their visits are kept: staff still see the number.
      const staff = await staffBoard(gym, gym.owner);
      expect(staff.rows[0]).toMatchObject({ name: "Chen Wu", value: 3, place: null, hidden: "taken_off" });
      expect(staff.rows[1]).toMatchObject({ userId: bilal.userId, place: 1 });

      // The person themselves is told.
      await sql`UPDATE gym_members SET hidden_from_boards = true WHERE gym_id = ${gym.id} AND user_id = ${viewer.userId}`;
      expect((await memberBoard(gym, viewer)).me.hidden).toBe("taken_off");
      await sql`UPDATE gym_members SET hidden_from_boards = false WHERE gym_id = ${gym.id} AND user_id = ${viewer.userId}`;

      const back = await put(`${base(gym.id)}/people/${chen.userId}`, gym.owner.cookies, { takenOff: false });
      expect(JSON.parse(back.body)).toEqual({ takenOff: false });
      expect((await memberBoard(gym, viewer)).rows[0]).toMatchObject({ name: "Chen W.", place: 1 });
      expect(await audits(gym.id, "leaderboard.put_back")).toBe(1);

      // A trainer the owner gave the tick to can do it too.
      const trainer = await signedIn("Tara Trainer");
      await addStaff(gym.id, trainer.userId, "trainer", TICKS);
      expect((await put(`${base(gym.id)}/people/${chen.userId}`, trainer.cookies, { takenOff: true })).statusCode).toBe(200);

      // Somebody who has left the gym is nobody to take off.
      await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${gym.id} AND user_id = ${bilal.userId}`;
      expect((await put(`${base(gym.id)}/people/${bilal.userId}`, gym.owner.cookies, { takenOff: true })).statusCode).toBe(404);

      // A body that is not the one asked for is refused before anything is read.
      for (const body of [{}, { takenOff: "yes" }, { takenOff: true, extra: 1 }]) {
        expect((await put(`${base(gym.id)}/people/${chen.userId}`, gym.owner.cookies, body)).statusCode).toBe(400);
      }
    },
    T,
  );

  // ===========================================================================
  // WHICH BOARDS MEMBERS SEE
  // ===========================================================================

  it(
    "a board switched off: members get no row, number or profile line from it; staff still see it and why members don't",
    async () => {
      const { gym, viewer, bilal, chen } = await busyGym("Switch House");
      for (const p of [viewer, bilal, chen]) await workout(p.userId, "2026-10-06");
      const before = await memberBoard(gym, viewer);
      expect([before.status, before.boardsOff]).toEqual(["shown", []]);

      const switchBoard = (board: string, off: boolean) => put(`${base(gym.id)}/boards`, gym.owner.cookies, { board, off });
      expect(JSON.parse((await switchBoard("streak", true)).body)).toEqual({ boardsOff: ["streak"] });
      const res = await switchBoard("gym_days", true);
      expect(res.statusCode).toBe(200);
      // The answer is the whole stored list, in the boards' own order.
      expect(JSON.parse(res.body)).toEqual({ boardsOff: ["gym_days", "streak"] });
      // A switch pressed again changes nothing and notes nothing.
      await switchBoard("gym_days", true);
      expect(await audits(gym.id, "leaderboard.boards_changed")).toBe(2);

      for (const q of ["board=gym_days&period=this_week", "board=gym_days&period=all_time", "board=streak"]) {
        const off = await memberBoard(gym, viewer, q);
        expect(off.status).toBe("switched_off");
        expect([off.rows, off.ranked, off.me.place]).toEqual([[], 0, null]);
        expect(off.boardsOff).toEqual(["gym_days", "streak"]);
        expect(JSON.stringify(off)).not.toContain(chen.userId);
      }
      // Workout days is still on, and a profile carries that board only.
      const profile = await get(`/v1/orgs/${gym.id}/leaderboard/people/${chen.userId}`, viewer.cookies);
      expect(profile.statusCode).toBe(200);
      expect((JSON.parse(profile.body) as LeaderboardProfileResponse).boards.map((b) => b.board)).toEqual(["workout_days"]);

      const staff = await staffBoard(gym, gym.owner);
      expect(staff.memberStatus).toBe("switched_off");
      expect(staff.rows.map((r) => r.name)).toEqual(["Chen Wu", "Bilal Khan", "Asha Rao", "Vera Viewer"]);
      expect(staff.boardsOff).toEqual(["gym_days", "streak"]);

      // All three off: a member's profile of anyone is not found.
      await switchBoard("workout_days", true);
      expect((await memberBoard(gym, viewer, "board=workout_days&period=this_week")).status).toBe("switched_off");
      expect((await get(`/v1/orgs/${gym.id}/leaderboard/people/${chen.userId}`, viewer.cookies)).statusCode).toBe(404);

      // Back on, one at a time: the others stay off.
      expect(JSON.parse((await switchBoard("gym_days", false)).body)).toEqual({ boardsOff: ["workout_days", "streak"] });
      expect((await memberBoard(gym, viewer)).status).toBe("shown");
      expect((await memberBoard(gym, viewer, "board=streak")).status).toBe("switched_off");

      for (const body of [{}, { off: ["visits"] }, { board: "visits", off: true }, { board: "streak" }, { board: "streak", off: "yes" }, { board: "streak", off: true, more: 1 }]) {
        expect((await put(`${base(gym.id)}/boards`, gym.owner.cookies, body)).statusCode).toBe(400);
      }
      expect((await get(`${base(gym.id)}?board=visits`, gym.owner.cookies)).statusCode).toBe(400);
    },
    T,
  );

  it(
    "why a board is not showing: fewer than three people, nobody checked in for 30 days, or the plan lapsed",
    async () => {
      // Two people this week: members see no board; staff see both, and are told why.
      const few = await makeGym("Few House");
      const a = await account("Asha Rao");
      const b = await account("Bilal Khan");
      for (const p of [a, b]) {
        await join(few.id, p.userId);
        await visit(few, p.userId, "2026-10-06");
      }
      const fewBoard = await staffBoard(few, few.owner);
      expect([fewBoard.memberStatus, fewBoard.rows.length, fewBoard.live, fewBoard.checkingIn]).toEqual(["too_few", 2, true, true]);
      // Members see no board, so nobody has a place: not on the row, not on the panel.
      expect(fewBoard.rows.map((r) => [r.name, r.place, r.hidden])).toEqual([
        ["Asha Rao", null, null],
        ["Bilal Khan", null, null],
      ]);
      const fewPanel = JSON.parse((await get(`${base(few.id)}/people/${a.userId}`, few.owner.cookies)).body) as StaffLeaderboardProfileResponse;
      expect(fewPanel.boards).toEqual([
        { board: "gym_days", period: "this_week", place: null, value: 1, memberStatus: "too_few" },
        { board: "workout_days", period: "this_week", place: null, value: 0, memberStatus: "too_few" },
        { board: "streak", period: null, place: null, value: 1, memberStatus: "too_few" },
      ]);

      // Nobody checked in for 30 days: Gym days and Streak are not showing, Workout days is.
      const quiet = await makeGym("Quiet House");
      const people = [await account("Asha Rao"), await account("Bilal Khan"), await account("Chen Wu")];
      for (const p of people) {
        await join(quiet.id, p.userId);
        await visit(quiet, p.userId, "2026-08-03");
        await workout(p.userId, "2026-10-06");
      }
      const quietDays = await staffBoard(quiet, quiet.owner, "board=gym_days&period=all_time");
      expect([quietDays.memberStatus, quietDays.checkingIn, quietDays.rows.length]).toEqual(["no_checkins", false, 3]);
      expect(quietDays.rows.map((r) => r.place)).toEqual([null, null, null]);
      const quietStreak = await staffBoard(quiet, quiet.owner, "board=streak");
      expect([quietStreak.memberStatus, quietStreak.rows]).toEqual(["no_checkins", []]);
      expect((await staffBoard(quiet, quiet.owner, "board=workout_days&period=this_week")).memberStatus).toBe("shown");

      // A lapsed gym: staff can still look, and cannot change anything.
      const lapsed = await makeGym("Lapsed House", false);
      const c = await account("Chen Wu");
      await join(lapsed.id, c.userId);
      await visit(lapsed, c.userId, "2026-10-06");
      const lapsedBoard = await staffBoard(lapsed, lapsed.owner);
      expect([lapsedBoard.memberStatus, lapsedBoard.live, lapsedBoard.rows.length, lapsedBoard.rows[0]?.place]).toEqual(["paused", false, 1, null]);
      expect((await put(`${base(lapsed.id)}/people/${c.userId}`, lapsed.owner.cookies, { takenOff: true })).statusCode).toBe(409);
      expect((await put(`${base(lapsed.id)}/boards`, lapsed.owner.cookies, { board: "streak", off: true })).statusCode).toBe(409);
    },
    T,
  );

  // ===========================================================================
  // TWO STAFF AT ONCE, AND THE LIMITS
  // ===========================================================================

  it(
    "two staff pressing different switches at the same instant: both land; ten take-offs at once are one note",
    async () => {
      const { gym, chen } = await busyGym("Racing House");
      const manager = await signedIn("Mona Manager");
      await addStaff(gym.id, manager.userId, "manager", null);
      for (let round = 0; round < 3; round += 1) {
        const [a, b] = await Promise.all([
          put(`${base(gym.id)}/boards`, gym.owner.cookies, { board: "gym_days", off: true }),
          put(`${base(gym.id)}/boards`, manager.cookies, { board: "streak", off: true }),
        ]);
        expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
        const stored = await sql<{ off: string[] }[]>`SELECT leaderboard_boards_off AS off FROM gyms WHERE id = ${gym.id}`;
        expect([...(stored[0]?.off ?? [])].sort()).toEqual(["gym_days", "streak"]);
        // Whoever answered second answered with both.
        const answers = [a, b].map((r) => (JSON.parse(r.body) as { boardsOff: string[] }).boardsOff.length).sort();
        expect(answers).toEqual([1, 2]);
        await Promise.all([
          put(`${base(gym.id)}/boards`, gym.owner.cookies, { board: "gym_days", off: false }),
          put(`${base(gym.id)}/boards`, manager.cookies, { board: "streak", off: false }),
        ]);
        expect((await sql<{ off: string[] }[]>`SELECT leaderboard_boards_off AS off FROM gyms WHERE id = ${gym.id}`)[0]?.off).toEqual([]);
      }
      const many = await Promise.all(
        Array.from({ length: 10 }, (_, i) => put(`${base(gym.id)}/people/${chen.userId}`, (i % 2 === 0 ? gym.owner : manager).cookies, { takenOff: true })),
      );
      expect(many.map((r) => r.statusCode)).toEqual(Array.from({ length: 10 }, () => 200));
      expect(await audits(gym.id, "leaderboard.taken_off")).toBe(1);
    },
    T,
  );

  it(
    "the limits, at one address: a person past their writes is stopped, a colleague is not; a stranger's 404 is never a 429",
    async () => {
      const { gym, chen } = await busyGym("Limit House");
      const manager = await signedIn("Mona Manager");
      await addStaff(gym.id, manager.userId, "manager", null);
      const stranger = await signedIn("Sam Stranger");
      const ip = "10.99.0.7";
      const path = `${base(gym.id)}/people/${chen.userId}`;
      let last = 0;
      let allowed = 0;
      for (let i = 0; i < 301; i += 1) {
        last = (await inject("PUT", path, manager.cookies, { takenOff: i % 2 === 0 }, ip)).statusCode;
        if (last === 200) allowed += 1;
      }
      expect([allowed, last]).toEqual([300, 429]);
      // The owner, at the same address, still writes; the manager still reads.
      expect((await inject("PUT", path, gym.owner.cookies, { takenOff: false }, ip)).statusCode).toBe(200);
      expect((await inject("GET", `${base(gym.id)}?board=streak`, manager.cookies, undefined, ip)).statusCode).toBe(200);
      // Somebody with no standing is refused before any limit is counted, however often.
      for (let i = 0; i < 40; i += 1) {
        expect((await inject("PUT", path, stranger.cookies, { takenOff: true }, ip)).statusCode).toBe(404);
      }
    },
    120_000,
  );
});
