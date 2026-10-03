// THE MEMBERS' LEADERBOARD — the routes against real Postgres (spec Part 3 §15.5; ROADMAP
// 19a). DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: show somebody who chose Hide me to
// another member — in a row, a photo, a profile, a count, or a gap in the places. That is
// the first test below.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { LeaderboardCountedResponse, LeaderboardProfileResponse, LeaderboardResponse } from "@app/shared";
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
  JWT_SECRET: "leaderboard-test-secret-0123456789ab", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 60_000;
const LIVE_PLAN = "zz_lb_live";
/** Wednesday 7 October 2026, noon in Kolkata. */
const WEDNESDAY = new Date("2026-10-07T06:30:00Z");

let ipCounter = 0;
const nextIp = () => `10.19.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("the members' leaderboard (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  let clock = WEDNESDAY;
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'lb-t-%@example.com')`;
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'lb-t-%@example.com'`;
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
    await sql`DELETE FROM users WHERE email LIKE 'lb-t-%@example.com'`;
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

  interface Person {
    userId: string;
    email: string;
    cookies: Cookies;
  }

  /** Somebody who signs in: a viewer. */
  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `lb-t-${uniq()}@example.com`;
    const reg = await inject("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await inject("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, email, cookies: cookieMap(login) };
  };

  /** Somebody who never signs in during the test. */
  const account = async (displayName: string, local?: string): Promise<{ userId: string; email: string }> => {
    const email = `lb-t-${local ?? "p"}-${uniq()}@example.com`;
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

  const makeGym = async (name: string, timezone = "Asia/Kolkata", live = true): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await inject("POST", "/v1/orgs", owner.cookies, { trainsHere: true, name, city: "Jorhat", country: "IN", timezone });
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

  const record = async (gymId: string, fullName: string, dateOfBirth: string | null = null): Promise<string> => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO gym_member_list_entries (gym_id, full_name, email, identity_key, source, date_of_birth)
      VALUES (${gymId}, ${fullName}, ${`lb-r-${uniq()}@example.com`}, encode(sha256(${`lb-${uniq()}`}::bytea), 'hex'), 'typed', ${dateOfBirth})
      RETURNING id`;
    return rows[0]?.id ?? "";
  };

  // Joined on a fixed day, long before any workout below: Workout days reads it.
  const join = async (gymId: string, userId: string, entryId: string | null = null): Promise<void> => {
    await sql`
      INSERT INTO gym_members (gym_id, user_id, entry_id, joined_at)
      VALUES (${gymId}, ${userId}, ${entryId}, '2026-01-01T00:00:00Z')`;
  };

  /** A finished app workout at 07:30 on a day of Kolkata's calendar, saved half an hour later. */
  const workout = async (userId: string, day: string): Promise<void> => {
    await sql`
      INSERT INTO workouts (id, user_id, started_at, platform, engine_version, sets_count, created_at)
      VALUES (gen_random_uuid(), ${userId}, ${`${day}T02:00:00Z`}, 'web', 'test', 1, ${`${day}T02:30:00Z`})`;
  };

  /** A visit on a day of the gym's calendar. `who` is an account, or only a record. */
  const visit = async (
    gym: Gym,
    who: { userId?: string; entryId?: string },
    day: string,
    method: "pass" | "key_tag" | "staff" | "manual" | "qr" = "pass",
    slot = 0,
  ): Promise<void> => {
    const desk = method === "pass" || method === "key_tag";
    const opens = 360 + slot * 120;
    await sql`
      INSERT INTO gym_attendance
        (gym_id, user_id, entry_id, device_id, marked_by_user_id, day, marked_at, method,
         hours_status, session_opens_minute, session_closes_minute, slot_key)
      VALUES (${gym.id}, ${who.userId ?? null}, ${who.entryId ?? null},
              ${desk ? gym.deviceId : null}, ${desk ? null : method === "staff" ? gym.owner.userId : (who.userId ?? null)},
              ${day}::date, (${day}::date + time '12:00' + ${slot} * interval '2 hours') AT TIME ZONE 'Asia/Kolkata', ${method},
              'in_session', ${opens}, ${opens + 60}, ${`${String(opens)}-${String(opens + 60)}`})`;
  };

  const board = async (gymId: string, viewer: Person, q = "board=gym_days&period=this_week"): Promise<LeaderboardResponse> => {
    const res = await get(`/v1/orgs/${gymId}/leaderboard?${q}`, viewer.cookies);
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body) as LeaderboardResponse;
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
    "a hidden member shows to nobody else: not in a row, a profile, a count or a gap in the places, on any board or period",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("Hidden House");
      const viewer = await signedIn("Vera Viewer");
      await join(gym.id, viewer.userId);
      const visible = [await account("Asha Rao"), await account("Bilal Khan"), await account("Chen Wu")];
      for (const p of visible) await join(gym.id, p.userId);

      // Five ways to be hidden, each with MORE gym days and workout days than anybody shown.
      const hideMe = await account("Hema Hidden");
      await sql`UPDATE users SET leaderboard_opt_out = true WHERE id = ${hideMe.userId}`;
      const young = await account("Yuvi Young");
      await sql`INSERT INTO user_fitness_profiles (user_id, age) VALUES (${young.userId}, 16)`;
      const youngByRecord = await account("Rhea Record");
      const youngEntry = await record(gym.id, "Rhea Record", "2010-03-01");
      const takenOff = await account("Tariq Taken");
      const nameless = await account("x", "nameless");
      await sql`UPDATE users SET display_name = split_part(email::text, '@', 1) WHERE id = ${nameless.userId}`;
      await join(gym.id, hideMe.userId);
      await join(gym.id, young.userId);
      await join(gym.id, youngByRecord.userId, youngEntry);
      await join(gym.id, takenOff.userId);
      await sql`UPDATE gym_members SET hidden_from_boards = true WHERE gym_id = ${gym.id} AND user_id = ${takenOff.userId}`;
      await join(gym.id, nameless.userId);
      const hidden = [hideMe, young, youngByRecord, takenOff, nameless];

      const days = ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05", "2026-10-06", "2026-10-07"];
      for (const h of hidden) {
        for (const day of days) {
          await visit(gym, { userId: h.userId }, day);
          await workout(h.userId, day);
        }
      }
      // The shown people's workouts run the other way round from their visits, so a
      // workout board that read visits would show.
      for (const [i, p] of visible.entries()) {
        for (const day of days.slice(4, 5 + i)) await visit(gym, { userId: p.userId }, day);
        for (const day of days.slice(4, 7 - i)) await workout(p.userId, day);
      }
      await visit(gym, { userId: viewer.userId }, "2026-10-06");
      await workout(viewer.userId, "2026-10-06");

      const periods = ["this_week", "last_week", "this_month", "last_month", "all_time"];
      const queries = [
        ...periods.map((p) => `board=gym_days&period=${p}`),
        ...periods.map((p) => `board=workout_days&period=${p}`),
        "board=streak",
      ];
      for (const q of queries) {
        const res = await get(`/v1/orgs/${gym.id}/leaderboard?${q}`, viewer.cookies);
        expect(res.statusCode).toBe(200);
        for (const h of hidden) {
          expect(res.body).not.toContain(h.userId);
          expect(res.body).not.toContain(h.email);
        }
        expect(res.body).not.toMatch(/Hema|Yuvi|Rhea|Tariq|nameless/);
        const b = JSON.parse(res.body) as LeaderboardResponse;
        if (b.status !== "shown") continue;
        // Places start at 1 and leave no gap a hidden person would fill.
        expect(b.rows[0]?.place).toBe(1);
        expect(b.ranked).toBe(b.rows.length);
        for (const h of hidden) expect(b.rows.some((r) => r.userId === h.userId)).toBe(false);
      }
      const week = await board(gym.id, viewer);
      expect(week.rows.map((r) => [r.name, r.place, r.value])).toEqual([
        ["Chen W.", 1, 3],
        ["Bilal K.", 2, 2],
        ["Asha R.", 3, 1],
        ["Vera V.", 3, 1],
      ]);
      const workouts = await board(gym.id, viewer, "board=workout_days&period=this_week");
      expect(workouts.rows.map((r) => [r.name, r.place, r.value])).toEqual([
        ["Asha R.", 1, 3],
        ["Bilal K.", 2, 2],
        ["Chen W.", 3, 1],
        ["Vera V.", 3, 1],
      ]);

      // Their profile is the same 404 as somebody who is not in the gym at all.
      const stranger = await account("Sam Stranger");
      const nobody = await get(`/v1/orgs/${gym.id}/leaderboard/people/${stranger.userId}`, viewer.cookies);
      expect(nobody.statusCode).toBe(404);
      for (const h of hidden) {
        const res = await get(`/v1/orgs/${gym.id}/leaderboard/people/${h.userId}`, viewer.cookies);
        expect(res.statusCode).toBe(404);
        expect(res.body.replace(/"requestId":"[^"]*"/, "")).toBe(nobody.body.replace(/"requestId":"[^"]*"/, ""));
      }
      // Nor does somebody else's profile carry them.
      const chen = await get(`/v1/orgs/${gym.id}/leaderboard/people/${visible[2]?.userId ?? ""}`, viewer.cookies);
      expect(chen.statusCode).toBe(200);
      expect((JSON.parse(chen.body) as LeaderboardProfileResponse).boards).toEqual([
        { board: "gym_days", period: "this_week", place: 1, value: 3 },
        { board: "workout_days", period: "this_week", place: 3, value: 1 },
        { board: "streak", period: null, place: 1, value: 1 },
      ]);
    },
    T,
  );

  it(
    "a gym that checks nobody in: Workout days still hides the hidden, and a profile there carries Workout days and nothing else",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("Home Workout Gym");
      const viewer = await signedIn("Vera Viewer");
      const hidden = await signedIn("Hema Hidden");
      await sql`UPDATE users SET leaderboard_opt_out = true WHERE id = ${hidden.userId}`;
      const young = await account("Yuvi Young");
      await sql`INSERT INTO user_fitness_profiles (user_id, age) VALUES (${young.userId}, 16)`;
      const shown = [await account("Asha Rao"), await account("Bilal Khan")];
      for (const p of [viewer, hidden, young, ...shown]) {
        await join(gym.id, p.userId);
        // Desk visits from nine weeks ago: numbers a profile here must never give.
        await visit(gym, { userId: p.userId }, "2026-08-03");
        await visit(gym, { userId: p.userId }, "2026-08-04");
      }
      for (const day of ["2026-10-05", "2026-10-06", "2026-10-07"]) {
        await workout(hidden.userId, day);
        await workout(young.userId, day);
      }
      await workout(shown[0]?.userId ?? "", "2026-10-05");
      await workout(shown[0]?.userId ?? "", "2026-10-06");
      await workout(shown[1]?.userId ?? "", "2026-10-05");
      await workout(viewer.userId, "2026-10-05");

      expect((await board(gym.id, viewer, "board=gym_days&period=all_time")).status).toBe("no_checkins");
      for (const period of ["this_week", "this_month", "all_time"]) {
        const res = await get(`/v1/orgs/${gym.id}/leaderboard?board=workout_days&period=${period}`, viewer.cookies);
        expect(res.body).not.toContain(hidden.userId);
        expect(res.body).not.toContain(young.userId);
        expect(res.body).not.toMatch(/Hema|Yuvi/);
        const b = JSON.parse(res.body) as LeaderboardResponse;
        expect([period, b.status, b.rows.map((r) => [r.name, r.place, r.value])]).toEqual([
          period,
          "shown",
          [
            ["Asha R.", 1, 2],
            ["Bilal K.", 2, 1],
            ["Vera V.", 2, 1],
          ],
        ]);
      }

      const stranger = await account("Sam Stranger");
      const nobody = await get(`/v1/orgs/${gym.id}/leaderboard/people/${stranger.userId}`, viewer.cookies);
      expect(nobody.statusCode).toBe(404);
      for (const h of [hidden, young]) {
        const res = await get(`/v1/orgs/${gym.id}/leaderboard/people/${h.userId}`, viewer.cookies);
        expect(res.statusCode).toBe(404);
        expect(res.body.replace(/"requestId":"[^"]*"/, "")).toBe(nobody.body.replace(/"requestId":"[^"]*"/, ""));
      }
      const asha = await get(`/v1/orgs/${gym.id}/leaderboard/people/${shown[0]?.userId ?? ""}`, viewer.cookies);
      expect(asha.statusCode).toBe(200);
      expect((JSON.parse(asha.body) as LeaderboardProfileResponse).boards).toEqual([
        { board: "workout_days", period: "this_week", place: 1, value: 2 },
      ]);

      // The hidden person sees their own number, the place they would have, and why.
      const own = await board(gym.id, hidden, "board=workout_days&period=this_week");
      expect(own.me).toMatchObject({ value: 3, place: 1, hidden: "hide_me" });
      expect(own.rows.some((r) => r.userId === hidden.userId)).toBe(false);
      const mine = await get(`/v1/orgs/${gym.id}/leaderboard/mine?board=workout_days&period=this_week`, hidden.cookies);
      expect((JSON.parse(mine.body) as LeaderboardCountedResponse).workoutDays.map((x) => x.day)).toEqual(["2026-10-07", "2026-10-06", "2026-10-05"]);
    },
    T,
  );

  it(
    "the hidden person sees their own row greyed with the place they would have, and Show me puts them on",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("Own Row Gym");
      const hidden = await signedIn("Hari Hidden");
      const young = await signedIn("Yash Young");
      await sql`INSERT INTO user_fitness_profiles (user_id, age) VALUES (${young.userId}, 17)`;
      const others = [await account("Ola One"), await account("Tom Two"), await account("Una Three")];
      await join(gym.id, hidden.userId);
      await join(gym.id, young.userId);
      for (const p of others) await join(gym.id, p.userId);
      for (const day of ["2026-10-05", "2026-10-06"]) {
        await visit(gym, { userId: hidden.userId }, day);
        await visit(gym, { userId: young.userId }, day);
        await visit(gym, { userId: others[0]?.userId ?? "" }, day);
      }
      await visit(gym, { userId: others[1]?.userId ?? "" }, "2026-10-05");
      await visit(gym, { userId: others[2]?.userId ?? "" }, "2026-10-05");

      const put = await inject("PUT", "/v1/users/me/leaderboard", hidden.cookies, { hidden: true });
      expect(put.statusCode).toBe(200);
      expect(JSON.parse(put.body)).toEqual({ hidden: true, hideMe: true, under18: false });

      const own = await board(gym.id, hidden);
      expect(own.me).toEqual({ value: 2, place: 1, hidden: "hide_me", toNextPlace: null, nextPlace: null, circles: ["yes", "yes", "no", "no", "no", "no", "no"] });
      expect(own.rows.some((r) => r.userId === hidden.userId)).toBe(false);

      const youngView = await get("/v1/users/me/leaderboard", young.cookies);
      expect(JSON.parse(youngView.body)).toEqual({ hidden: true, hideMe: false, under18: true });
      expect((await board(gym.id, young)).me.hidden).toBe("under_18");

      // Show me: the under-18's own choice puts them on the board.
      const show = await inject("PUT", "/v1/users/me/leaderboard", young.cookies, { hidden: false });
      expect(JSON.parse(show.body)).toEqual({ hidden: false, hideMe: false, under18: false });
      const after = await board(gym.id, young);
      expect(after.me.hidden).toBeNull();
      expect(after.rows.map((r) => [r.name, r.place])).toEqual([
        ["Ola O.", 1],
        ["Yash Y.", 1],
        ["Tom T.", 3],
        ["Una T.", 3],
      ]);
      // The member still hidden sees the same places everybody else does.
      expect((await board(gym.id, hidden)).rows.map((r) => [r.name, r.place])).toEqual(after.rows.map((r) => [r.name, r.place]));

      const bad = await inject("PUT", "/v1/users/me/leaderboard", young.cookies, { hidden: "no" });
      expect(bad.statusCode).toBe(400);
    },
    T,
  );

  // ===========================================================================
  // WHAT COUNTS, AND WHOSE IT IS
  // ===========================================================================

  it(
    "a visit before the app counts by its record; a household's shared record counts for nobody; the old tap and staff never count",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("Record Gym");
      const viewer = await signedIn("Rita Record");
      const entry = await record(gym.id, "Rita Record");
      await join(gym.id, viewer.userId, entry);
      const twinA = await account("Kai Home");
      const twinB = await account("Lea Home");
      const shared = await record(gym.id, "Kai Home");
      await join(gym.id, twinA.userId, shared);
      await join(gym.id, twinB.userId, shared);
      const others = [await account("Max One"), await account("Nia Two"), await account("Oz Three")];
      for (const p of others) {
        await join(gym.id, p.userId);
        await visit(gym, { userId: p.userId }, "2026-10-05");
      }

      // Rita: a key tag before she had the app (record only), a desk scan, staff, and her own old tap.
      await visit(gym, { entryId: entry }, "2026-10-05", "key_tag");
      await visit(gym, { userId: viewer.userId, entryId: entry }, "2026-10-06", "pass");
      await visit(gym, { userId: viewer.userId, entryId: entry }, "2026-10-06", "staff", 1);
      await visit(gym, { userId: viewer.userId }, "2026-10-07", "manual");
      // The household's record, scanned by a key tag: whose it is cannot be said.
      await visit(gym, { entryId: shared }, "2026-10-05", "key_tag");
      await visit(gym, { entryId: shared }, "2026-10-06", "key_tag");
      // The gym's owner trains here too (a member) and is staff: not ranked.
      await visit(gym, { userId: gym.owner.userId }, "2026-10-05");

      const b = await board(gym.id, viewer);
      expect(b.me).toEqual({
        value: 2,
        place: 1,
        hidden: null,
        toNextPlace: null,
        nextPlace: null,
        circles: ["yes", "yes", "no", "no", "no", "no", "no"],
      });
      expect(b.rows.map((r) => r.name)).toEqual(["Rita R.", "Max O.", "Nia T.", "Oz T."]);

      const ownerView = await board(gym.id, gym.owner);
      expect(ownerView.me.hidden).toBe("staff");

      // What counted equals the number, with how; the old tap is listed as not counting.
      const res = await get(`/v1/orgs/${gym.id}/leaderboard/mine?board=gym_days&period=this_week`, viewer.cookies);
      expect(res.statusCode).toBe(200);
      const counted = JSON.parse(res.body) as LeaderboardCountedResponse;
      expect(counted.value).toBe(b.me.value);
      expect(counted.days.map((x) => [x.day, x.visits.map((v) => [v.how, v.by])])).toEqual([
        ["2026-10-06", [["staff", "Record Gym Owner"], ["desk", "Front desk"]]],
        ["2026-10-05", [["desk", "Front desk"]]],
      ]);
      expect(counted.notCounted.map((n) => [n.day, n.why])).toEqual([["2026-10-07", "own_tap"]]);
    },
    T,
  );

  it(
    "equal numbers share a place and are listed by name; fewer than three people is no board",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("Tie Gym");
      const viewer = await signedIn("Zed Last");
      await join(gym.id, viewer.userId);
      const people = [await account("Bea Bee"), await account("Abe Ay")];
      for (const p of people) await join(gym.id, p.userId);
      await visit(gym, { userId: viewer.userId }, "2026-10-05");
      await visit(gym, { userId: people[0]?.userId ?? "" }, "2026-10-05");

      const two = await board(gym.id, viewer);
      expect(two.status).toBe("too_few");
      expect(two.rows).toEqual([]);
      expect(two.ranked).toBe(0);
      expect(two.me.place).toBeNull();

      await visit(gym, { userId: people[1]?.userId ?? "" }, "2026-10-06");
      const three = await board(gym.id, viewer);
      expect(three.status).toBe("shown");
      expect(three.rows.map((r) => [r.name, r.place])).toEqual([
        ["Abe A.", 1],
        ["Bea B.", 1],
        ["Zed L.", 1],
      ]);
    },
    T,
  );

  // ===========================================================================
  // PERIODS AND THE STREAK
  // ===========================================================================

  it(
    "each period counts its own days, in the gym's calendar, and prints its dates",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("Period Gym");
      const viewer = await signedIn("Pia Period");
      await join(gym.id, viewer.userId);
      const fill = [await account("Fay One"), await account("Gus Two"), await account("Hal Three")];
      for (const p of fill) {
        await join(gym.id, p.userId);
        await visit(gym, { userId: p.userId }, "2026-10-05");
        await visit(gym, { userId: p.userId }, "2026-09-29");
        await visit(gym, { userId: p.userId }, "2026-09-02");
      }
      for (const day of ["2026-08-31", "2026-09-02", "2026-09-29", "2026-10-01", "2026-10-02", "2026-10-05", "2026-10-07"]) {
        await visit(gym, { userId: viewer.userId }, day);
      }
      // Two visits on one day are one gym day.
      await visit(gym, { userId: viewer.userId }, "2026-10-07", "staff", 1);

      const expected: Record<string, { value: number; from: string | null; to: string }> = {
        this_week: { value: 2, from: "2026-10-05", to: "2026-10-11" },
        last_week: { value: 3, from: "2026-09-28", to: "2026-10-04" },
        this_month: { value: 4, from: "2026-10-01", to: "2026-10-31" },
        last_month: { value: 2, from: "2026-09-01", to: "2026-09-30" },
        all_time: { value: 7, from: null, to: "2026-10-07" },
      };
      for (const [period, want] of Object.entries(expected)) {
        const b = await board(gym.id, viewer, `board=gym_days&period=${period}`);
        expect([period, b.me.value, b.from, b.to]).toEqual([period, want.value, want.from, want.to]);
        const mine = await get(`/v1/orgs/${gym.id}/leaderboard/mine?board=gym_days&period=${period}`, viewer.cookies);
        expect((JSON.parse(mine.body) as LeaderboardCountedResponse).value).toBe(want.value);
      }
      const lastWeek = await board(gym.id, viewer, "board=gym_days&period=last_week");
      expect(lastWeek.circleDays).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
      expect(lastWeek.me.circles).toEqual(["no", "yes", "no", "yes", "yes", "no", "no"]);
      expect((await board(gym.id, viewer, "board=gym_days&period=this_month")).me.circles).toBeNull();
    },
    T,
  );

  it(
    "the streak: last week keeps it alive, a week the gym recorded nobody is skipped, a missed gym week breaks it",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("Streak Gym");
      const viewer = await signedIn("Sol Streak");
      const keeper = await account("Kim Keeper");
      const breaker = await account("Bo Breaker");
      const today = await account("Ty Today");
      for (const p of [viewer, keeper, breaker, today]) await join(gym.id, p.userId);
      // Weeks (Mondays): 7 Sep, 14 Sep, [21 Sep: nobody at the gym], 28 Sep, this week 5 Oct.
      for (const day of ["2026-09-08", "2026-09-15", "2026-09-29"]) await visit(gym, { userId: viewer.userId }, day);
      for (const day of ["2026-09-08", "2026-09-15", "2026-09-29", "2026-10-06"]) await visit(gym, { userId: keeper.userId }, day);
      for (const day of ["2026-09-08", "2026-10-06"]) await visit(gym, { userId: breaker.userId }, day);
      await visit(gym, { userId: today.userId }, "2026-10-07");
      // Somebody without the app came in the week of 14 Sep only: the gym's week, not a person's.
      const walkIn = await record(gym.id, "Wanda Walkin");
      await visit(gym, { entryId: walkIn }, "2026-09-16", "key_tag");

      const b = await board(gym.id, viewer, "board=streak");
      expect(b.rows.map((r) => [r.name, r.place, r.value])).toEqual([
        ["Kim K.", 1, 4],
        ["Sol S.", 2, 3],
        ["Bo B.", 3, 1],
        ["Ty T.", 3, 1],
      ]);
      expect(b.circleDays).toEqual(["2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05"]);
      expect(b.me.circles).toEqual(["skipped", "skipped", "yes", "yes", "skipped", "yes", "open"]);

      const res = await get(`/v1/orgs/${gym.id}/leaderboard/mine?board=streak`, viewer.cookies);
      const counted = JSON.parse(res.body) as LeaderboardCountedResponse;
      expect(counted.value).toBe(3);
      expect(counted.weeks.map((w) => [w.weekStart, w.state])).toEqual([
        ["2026-10-05", "open"],
        ["2026-09-28", "counted"],
        ["2026-09-21", "skipped"],
        ["2026-09-14", "counted"],
        ["2026-09-07", "counted"],
      ]);

      // Next Monday Sol has missed a whole gym week: the streak is over.
      clock = new Date("2026-10-12T06:30:00Z");
      const later = await board(gym.id, viewer, "board=streak");
      expect(later.me.value).toBe(0);
      // Kim's week of 12 Oct is open, not yet counted.
      expect(later.rows.find((r) => r.name === "Kim K.")?.value).toBe(4);
      const laterMine = JSON.parse((await get(`/v1/orgs/${gym.id}/leaderboard/mine?board=streak`, viewer.cookies)).body) as LeaderboardCountedResponse;
      expect(laterMine.value).toBe(0);
      expect(laterMine.weeks.map((w) => w.state)).toEqual(["open", "missed"]);
      clock = WEDNESDAY;
    },
    T,
  );

  // ===========================================================================
  // WHEN THERE IS NO BOARD
  // ===========================================================================

  it(
    "a gym that checked nobody in for 30 days shows no board, and a lapsed gym's members see none",
    async () => {
      clock = WEDNESDAY;
      const quiet = await makeGym("Quiet Gym");
      const viewer = await signedIn("Quinn Quiet");
      await join(quiet.id, viewer.userId);
      const people = [await account("Ray One"), await account("Sky Two"), await account("Tal Three")];
      for (const p of people) {
        await join(quiet.id, p.userId);
        await visit(quiet, { userId: p.userId }, "2026-09-07");
        await visit(quiet, { userId: p.userId }, "2026-10-06", "manual");
      }
      const q = await board(quiet.id, viewer, "board=gym_days&period=all_time");
      expect(q.status).toBe("no_checkins");
      expect(q.rows).toEqual([]);
      // Nor a profile: the same 404 as a gym that does not exist, whatever the period.
      for (const period of ["this_week", "all_time"]) {
        const res = await get(`/v1/orgs/${quiet.id}/leaderboard/people/${people[0]?.userId ?? ""}?period=${period}`, viewer.cookies);
        expect([period, res.statusCode]).toEqual([period, 404]);
      }

      const lapsed = await makeGym("Lapsed Gym", "Asia/Kolkata", false);
      await join(lapsed.id, viewer.userId);
      for (const p of people) {
        await join(lapsed.id, p.userId);
        await visit(lapsed, { userId: p.userId }, "2026-10-06");
      }
      const l = await board(lapsed.id, viewer);
      expect(l.status).toBe("paused");
      expect(l.rows).toEqual([]);
      expect((await get(`/v1/orgs/${lapsed.id}/leaderboard/people/${people[0]?.userId ?? ""}`, viewer.cookies)).statusCode).toBe(404);
    },
    T,
  );

  it(
    "a gym that stopped checking in: nobody keeps a streak, though its silent weeks are skipped while it is checking in",
    async () => {
      const gym = await makeGym("Stopped Gym");
      const viewer = await signedIn("Stu Stopped");
      const others = [await account("Ari One"), await account("Bex Two"), await account("Cy Three")];
      for (const p of [viewer, ...others]) {
        await join(gym.id, p.userId);
        for (const day of ["2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27"]) await visit(gym, { userId: p.userId }, day);
      }
      // Three weeks later the gym was shut for a fortnight and nobody has come since:
      // inside 30 days the four weeks still stand.
      clock = new Date("2026-08-19T06:30:00Z");
      const during = await board(gym.id, viewer, "board=streak");
      expect([during.status, during.me.value]).toEqual(["shown", 4]);
      // Ten weeks after the last visit there is no board and no streak, on the row or in its list.
      clock = WEDNESDAY;
      const after = await board(gym.id, viewer, "board=streak");
      expect([after.status, after.me.value, after.rows]).toEqual(["no_checkins", 0, []]);
      const mine = JSON.parse((await get(`/v1/orgs/${gym.id}/leaderboard/mine?board=streak`, viewer.cookies)).body) as LeaderboardCountedResponse;
      expect(mine.value).toBe(0);
      expect(mine.weeks.filter((w) => w.state === "counted")).toEqual([]);
    },
    T,
  );

  it(
    "a profile is the 404 of a gym that does not exist while its board has too few people",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("Few Gym");
      const viewer = await signedIn("Fay Few");
      const other = await account("Lona Lane");
      await join(gym.id, viewer.userId);
      await join(gym.id, other.userId);
      await visit(gym, { userId: other.userId }, "2026-10-05");
      await visit(gym, { userId: other.userId }, "2026-10-06");
      expect((await board(gym.id, viewer)).status).toBe("too_few");
      const res = await get(`/v1/orgs/${gym.id}/leaderboard/people/${other.userId}`, viewer.cookies);
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain("Lona");
    },
    T,
  );

  // ===========================================================================
  // UNDER 18, ONE RULE EVERYWHERE
  // ===========================================================================

  it(
    "an under-18 by ONE gym's record is hidden at every gym, as their own switch says; Show me shows them at both",
    async () => {
      clock = WEDNESDAY;
      const gymA = await makeGym("Age Gym A");
      const gymB = await makeGym("Age Gym B");
      const tina = await signedIn("Tina Teen");
      const viewer = await signedIn("Vik Viewer");
      const fill = [await account("Asha Rao"), await account("Bilal Khan")];
      // Her date of birth is on gym B's record only; gym A holds no record of her.
      await join(gymA.id, tina.userId);
      await join(gymB.id, tina.userId, await record(gymB.id, "Tina Teen", "2010-03-01"));
      for (const gym of [gymA, gymB]) {
        await join(gym.id, viewer.userId);
        await visit(gym, { userId: viewer.userId }, "2026-10-05");
        for (const p of fill) {
          await join(gym.id, p.userId);
          await visit(gym, { userId: p.userId }, "2026-10-05");
        }
        await visit(gym, { userId: tina.userId }, "2026-10-05");
        await visit(gym, { userId: tina.userId }, "2026-10-06");
      }
      expect(JSON.parse((await get("/v1/users/me/leaderboard", tina.cookies)).body)).toEqual({ hidden: true, hideMe: false, under18: true });
      for (const gym of [gymA, gymB]) {
        for (const q of ["board=gym_days&period=this_week", "board=gym_days&period=all_time", "board=streak"]) {
          const res = await get(`/v1/orgs/${gym.id}/leaderboard?${q}`, viewer.cookies);
          expect(res.body).not.toContain(tina.userId);
          expect(res.body).not.toContain("Tina");
        }
        expect((await get(`/v1/orgs/${gym.id}/leaderboard/people/${tina.userId}`, viewer.cookies)).statusCode).toBe(404);
        expect((await board(gym.id, tina)).me.hidden).toBe("under_18");
      }
      await inject("PUT", "/v1/users/me/leaderboard", tina.cookies, { hidden: false });
      for (const gym of [gymA, gymB]) {
        expect((await board(gym.id, viewer)).rows[0]).toMatchObject({ name: "Tina T.", place: 1, value: 2 });
      }
    },
    T,
  );

  it(
    "eighteen today is shown; eighteen tomorrow is hidden — by the gym's own date",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("Birthday Gym");
      const viewer = await signedIn("Bo Viewer");
      const today = await account("Eve Eighteen");
      const tomorrow = await account("Sev Seventeen");
      const fill = [await account("Asha Rao"), await account("Bilal Khan")];
      await join(gym.id, viewer.userId);
      await join(gym.id, today.userId, await record(gym.id, "Eve Eighteen", "2008-10-07"));
      await join(gym.id, tomorrow.userId, await record(gym.id, "Sev Seventeen", "2008-10-08"));
      for (const p of fill) await join(gym.id, p.userId);
      for (const p of [viewer, today, tomorrow, ...fill]) await visit(gym, { userId: p.userId }, "2026-10-05");
      expect((await board(gym.id, viewer)).rows.map((r) => r.name)).toEqual(["Asha R.", "Bilal K.", "Bo V.", "Eve E."]);
      // In Kolkata it is already the 8th at 18:30 UTC on the 7th: Sev is eighteen.
      clock = new Date("2026-10-07T18:30:00Z");
      expect((await board(gym.id, viewer)).rows.map((r) => r.name)).toContain("Sev S.");
      clock = WEDNESDAY;
    },
    T,
  );

  it(
    "what counted names staff who typed a name, and says only 'staff' for one who did not",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("Staff Name Gym");
      const viewer = await signedIn("Nia Named");
      await join(gym.id, viewer.userId);
      await visit(gym, { userId: viewer.userId }, "2026-10-05", "staff");
      const read = async () =>
        (JSON.parse((await get(`/v1/orgs/${gym.id}/leaderboard/mine?board=gym_days&period=this_week`, viewer.cookies)).body) as LeaderboardCountedResponse).days[0]?.visits[0];
      expect(await read()).toMatchObject({ how: "staff", by: "Staff Name Gym Owner" });
      await sql`UPDATE users SET display_name = split_part(email::text, '@', 1) WHERE id = ${gym.owner.userId}`;
      const unnamed = await read();
      expect(unnamed).toMatchObject({ how: "staff", by: null });
      expect(JSON.stringify(unnamed)).not.toContain("lb-t-");
    },
    T,
  );

  // ===========================================================================
  // WHO MAY READ
  // ===========================================================================

  it(
    "a stranger, a removed member and another gym's staff get 404 from every route; a bad query is a 400",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("Door Gym");
      const other = await makeGym("Other Gym");
      const member = await signedIn("Mo Member");
      await join(gym.id, member.userId);
      const stranger = await signedIn("Sid Stranger");
      const former = await signedIn("Fern Former");
      await join(gym.id, former.userId);
      await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${gym.id} AND user_id = ${former.userId}`;

      const paths = [
        `/v1/orgs/${gym.id}/leaderboard?board=gym_days`,
        `/v1/orgs/${gym.id}/leaderboard?board=workout_days`,
        `/v1/orgs/${gym.id}/leaderboard?board=streak`,
        `/v1/orgs/${gym.id}/leaderboard/mine?board=gym_days`,
        `/v1/orgs/${gym.id}/leaderboard/mine?board=workout_days`,
        `/v1/orgs/${gym.id}/leaderboard/mine?board=streak`,
        `/v1/orgs/${gym.id}/leaderboard/people/${member.userId}`,
      ];
      for (const who of [stranger, former, other.owner]) {
        for (const path of paths) expect([path, (await get(path, who.cookies)).statusCode]).toEqual([path, 404]);
      }
      for (const path of paths) expect([path, (await get(path)).statusCode]).toEqual([path, 401]);
      expect((await get(`/v1/orgs/${gym.id}/leaderboard?board=visits`, member.cookies)).statusCode).toBe(400);
      expect((await get(`/v1/orgs/${gym.id}/leaderboard?board=gym_days&period=forever`, member.cookies)).statusCode).toBe(400);
      expect((await get(`/v1/orgs/not-a-gym/leaderboard?board=gym_days`, member.cookies)).statusCode).toBe(400);
      expect((await get(`/v1/orgs/${gym.id}/leaderboard?board=gym_days`, member.cookies)).statusCode).toBe(200);
    },
    T,
  );

  it(
    "a gym on one wi-fi: three members at ONE address read the board 651 times between them and nobody is refused",
    async () => {
      clock = WEDNESDAY;
      const gym = await makeGym("Wifi Gym");
      const members = [await signedIn("Wes One"), await signedIn("Xia Two"), await signedIn("Yan Three")];
      for (const m of members) await join(gym.id, m.userId);
      const address = "10.19.250.7";
      const path = `/v1/orgs/${gym.id}/leaderboard?board=gym_days`;
      let refused = 0;
      for (let i = 0; i < 217; i++) {
        const answers = await Promise.all(members.map((m) => inject("GET", path, m.cookies, undefined, address)));
        refused += answers.filter((a) => a.statusCode !== 200).length;
      }
      expect(refused).toBe(0);
    },
    T,
  );
});
