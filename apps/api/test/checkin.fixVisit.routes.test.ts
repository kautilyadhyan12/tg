// FIXING A VISIT — staff add a missed visit for an earlier day, or remove a wrong one,
// against real Postgres (spec Part 3 §12.5, §15.5; ROADMAP 19a-iv). DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: a real visit taken off somebody, or
// a false one added, by someone with no right to, or with no trace of who did it. That is
// the first test below.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type {
  AddVisitResponse,
  LeaderboardCountedResponse,
  LeaderboardResponse,
  StaffLeaderboardCountedResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { deleteEntry, deleteListForGym, moveVisitLinks } from "../src/modules/orgs/memberList/repo.js";
import { createMemoryRedis } from "../src/redis.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "fix-a-visit-secret-0123456789abcdef", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 60_000;
const LIVE_PLAN = "zz_vfx_live";
const ZONE = "Asia/Kolkata";

let ipCounter = 0;
const nextIp = () => `10.29.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("fixing a visit (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 8 });
  const redis = createMemoryRedis();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  /** The gym's own dates, newest first: `days[0]` is its today, `days[1]` yesterday. */
  let days: string[] = [];
  const ago = (n: number): string => {
    const day = days[n];
    if (day === undefined) throw new Error("no such day");
    return day;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'vfx-t-%@example.com')`;
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'vfx-t-%@example.com'`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_attendance_removed WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_attendance WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_checkin_devices WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM streaks WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM user_achievements WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM user_fitness_profiles WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM one_time_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM refresh_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM consent_log WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM users WHERE email LIKE 'vfx-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST" | "DELETE", path: string, cookies: Cookies, payload?: unknown, ip = nextIp()) =>
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

  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `vfx-t-${uniq()}@example.com`;
    const reg = await inject("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await inject("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, email, cookies: cookieMap(login) };
  };

  const account = async (displayName: string): Promise<{ userId: string; email: string }> => {
    const email = `vfx-t-p-${uniq()}@example.com`;
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
      timezone: ZONE,
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

  const record = async (gymId: string, fullName: string, former = false): Promise<string> => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO gym_member_list_entries (gym_id, full_name, email, identity_key, source, former_at)
      VALUES (${gymId}, ${fullName}, ${`vfx-r-${uniq()}@example.com`}, encode(sha256(${`vfx-${uniq()}`}::bytea), 'hex'), 'typed',
              ${former ? sql`now()` : null})
      RETURNING id`;
    return rows[0]?.id ?? "";
  };

  const join = async (gymId: string, userId: string, entryId: string | null = null): Promise<void> => {
    await sql`
      INSERT INTO gym_members (gym_id, user_id, entry_id, joined_at)
      VALUES (${gymId}, ${userId}, ${entryId}, now() - interval '200 days')`;
  };

  /** A desk scan at noon on a day of the gym's calendar; answers the visit's id. */
  const visit = async (gym: Gym, who: { userId?: string; entryId?: string }, day: string, slot = 0): Promise<string> => {
    const opens = 360 + slot * 120;
    const rows = await sql<{ id: string }[]>`
      INSERT INTO gym_attendance
        (gym_id, user_id, entry_id, device_id, day, marked_at, method, hours_status, session_opens_minute, session_closes_minute, slot_key)
      VALUES (${gym.id}, ${who.userId ?? null}, ${who.entryId ?? null}, ${gym.deviceId}, ${day}::date,
              (${day}::date + time '12:00' + ${slot} * interval '2 hours') AT TIME ZONE ${ZONE}, 'pass',
              'in_session', ${opens}, ${opens + 60}, ${`${String(opens)}-${String(opens + 60)}`})
      RETURNING id`;
    return rows[0]?.id ?? "";
  };

  const add = (gym: Gym, cookies: Cookies, pick: { userId: string } | { entryId: string }, day: string) =>
    inject("POST", `/v1/orgs/${gym.id}/attendance/visits`, cookies, { pick, day });
  const remove = (gymId: string, cookies: Cookies, visitId: string) =>
    inject("DELETE", `/v1/orgs/${gymId}/attendance/visits/${visitId}`, cookies);

  const visitsOf = async (gymId: string): Promise<number> =>
    (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_attendance WHERE gym_id = ${gymId}`)[0]?.n ?? 0;
  const removedOf = async (gymId: string): Promise<number> =>
    (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_attendance_removed WHERE gym_id = ${gymId}`)[0]?.n ?? 0;
  const audits = async (gymId: string, action: string): Promise<{ actor: string | null; target: string }[]> =>
    await sql<{ actor: string | null; target: string }[]>`
      SELECT actor_user_id AS actor, target_id AS target FROM audit_log WHERE gym_id = ${gymId} AND action = ${action}`;

  const mine = async (gym: Gym, who: Person, period = "all_time"): Promise<LeaderboardCountedResponse> => {
    const res = await get(`/v1/orgs/${gym.id}/leaderboard/mine?board=gym_days&period=${period}`, who.cookies);
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body) as LeaderboardCountedResponse;
  };
  const staffCounted = async (gym: Gym, userId: string): Promise<StaffLeaderboardCountedResponse> => {
    const res = await get(
      `/v1/orgs/${gym.id}/leaderboard/staff/people/${userId}/counted?board=gym_days&period=all_time`,
      gym.owner.cookies,
    );
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body) as StaffLeaderboardCountedResponse;
  };
  const board = async (gym: Gym, who: Person): Promise<LeaderboardResponse> => {
    const res = await get(`/v1/orgs/${gym.id}/leaderboard?board=gym_days&period=all_time`, who.cookies);
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body) as LeaderboardResponse;
  };

  /** A gym with a signed-in member who has a desk visit two days ago. */
  const gymWithMember = async (name: string) => {
    const gym = await makeGym(name);
    const member = await signedIn("Maya Patel");
    await join(gym.id, member.userId);
    const visitId = await visit(gym, { userId: member.userId }, ago(2));
    return { gym, member, visitId };
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    const rows = await sql<{ day: string }[]>`
      SELECT ((now() AT TIME ZONE ${ZONE})::date - n)::text AS day FROM generate_series(0, 70) n ORDER BY n`;
    days = rows.map((r) => r.day);
    app = await buildApp(loadConfig(baseEnv), { redis });
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
    "nobody but this gym's staff holding the tick adds or removes a visit, and what they do names them",
    async () => {
      const { gym, member, visitId } = await gymWithMember("Private House");
      const entryId = await record(gym.id, "Noor NoApp");
      const other = await makeGym("Other House");
      const outsider = await account("Olga Outsider");
      await join(other.id, outsider.userId);
      const otherEntry = await record(other.id, "Oscar Elsewhere");
      const otherVisit = await visit(other, { userId: outsider.userId }, ago(2));
      const stranger = await signedIn("Sam Stranger");
      const trainer = await signedIn("Tara Trainer");
      await addStaff(gym.id, trainer.userId, "trainer", ["members.read", "attendance.read", "leaderboard.manage"]);
      const defaultTrainer = await signedIn("Dev Default");
      await addStaff(gym.id, defaultTrainer.userId, "trainer", null);

      const refused: [string, Cookies, number][] = [
        ["another gym's owner", other.owner.cookies, 404],
        ["a member of this gym", member.cookies, 404],
        ["a stranger", stranger.cookies, 404],
        ["a trainer of this gym without the tick", trainer.cookies, 403],
        ["a trainer on the role's own ticks", defaultTrainer.cookies, 403],
        ["nobody signed in", {}, 401],
      ];
      for (const [who, cookies, status] of refused) {
        for (const pick of [{ userId: member.userId }, { entryId }]) {
          const res = await add(gym, cookies, pick, ago(1));
          expect(res.statusCode, `${who} adds`).toBe(status);
          expect(res.body, `${who} adds`).not.toMatch(/Maya|Noor/);
        }
        const res = await remove(gym.id, cookies, visitId);
        expect(res.statusCode, `${who} removes`).toBe(status);
      }
      // Nothing was written by any of them.
      expect(await visitsOf(gym.id)).toBe(1);
      expect(await removedOf(gym.id)).toBe(0);
      expect(await audits(gym.id, "attendance.visit_added")).toEqual([]);
      expect(await audits(gym.id, "attendance.visit_removed")).toEqual([]);

      // This gym's owner, through their OWN gym, reaching for another gym's visit or people.
      expect((await remove(gym.id, gym.owner.cookies, otherVisit)).statusCode).toBe(404);
      for (const pick of [{ userId: outsider.userId }, { entryId: otherEntry }]) {
        const res = await add(gym, gym.owner.cookies, pick, ago(1));
        expect(res.statusCode).toBe(404);
        expect(res.body).not.toMatch(/Olga|Oscar/);
      }
      expect(await visitsOf(other.id)).toBe(1);
      expect(await removedOf(other.id)).toBe(0);
      expect(await visitsOf(gym.id)).toBe(1);
      // Once that gym has removed its own visit, this gym still learns nothing of it.
      expect((await remove(other.id, other.owner.cookies, otherVisit)).statusCode).toBe(200);
      expect((await remove(gym.id, gym.owner.cookies, otherVisit)).statusCode).toBe(404);

      // A gym whose plan has lapsed changes nothing.
      const lapsed = await makeGym("Lapsed House", false);
      const lapsedMember = await account("Lena Lapsed");
      await join(lapsed.id, lapsedMember.userId);
      const lapsedVisit = await visit(lapsed, { userId: lapsedMember.userId }, ago(2));
      expect((await add(lapsed, lapsed.owner.cookies, { userId: lapsedMember.userId }, ago(1))).statusCode).toBe(409);
      expect((await remove(lapsed.id, lapsed.owner.cookies, lapsedVisit)).statusCode).toBe(409);
      expect(await visitsOf(lapsed.id)).toBe(1);

      // And the owner does both: the refusals above are not routes that answer nobody.
      const added = await add(gym, gym.owner.cookies, { userId: member.userId }, ago(1));
      expect(added.statusCode).toBe(200);
      expect((JSON.parse(added.body) as AddVisitResponse).result).toBe("added");
      const removed = await remove(gym.id, gym.owner.cookies, visitId);
      expect(removed.statusCode).toBe(200);
      // Each names who did it, in the visit itself and in the gym's log.
      const kept = await sql<{ id: string; by: string | null; method: string; hours_status: string }[]>`
        SELECT id, marked_by_user_id AS by, method, hours_status FROM gym_attendance WHERE gym_id = ${gym.id}`;
      expect(kept).toEqual([{ id: kept[0]?.id, by: gym.owner.userId, method: "staff", hours_status: "added_later" }]);
      const gone = await sql<{ id: string; by: string; user_id: string | null }[]>`
        SELECT id, removed_by_user_id AS by, user_id FROM gym_attendance_removed WHERE gym_id = ${gym.id}`;
      expect(gone).toEqual([{ id: visitId, by: gym.owner.userId, user_id: member.userId }]);
      expect(await audits(gym.id, "attendance.visit_added")).toEqual([{ actor: gym.owner.userId, target: kept[0]?.id }]);
      expect(await audits(gym.id, "attendance.visit_removed")).toEqual([{ actor: gym.owner.userId, target: visitId }]);
    },
    T,
  );

  // ===========================================================================
  // ADDING A VISIT
  // ===========================================================================

  it(
    "an added visit counts as a gym day, and the person and staff both see who added it and when",
    async () => {
      const { gym, member } = await gymWithMember("Add House");
      // Three on the board, so members see places.
      for (const name of ["Asha Rao", "Bilal Khan"]) {
        const p = await account(name);
        await join(gym.id, p.userId);
        await visit(gym, { userId: p.userId }, ago(3));
      }
      expect((await mine(gym, member)).value).toBe(1);

      const res = await add(gym, gym.owner.cookies, { userId: member.userId }, ago(5));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ result: "added", person: { name: "Maya Patel" }, day: ago(5) });

      const own = await mine(gym, member);
      expect(own.value).toBe(2);
      // The number is its own list.
      expect(own.days.map((x) => x.day)).toEqual([ago(2), ago(5)]);
      expect(own.days[1]?.visits).toEqual([
        { at: own.days[1]?.visits[0]?.at, how: "staff", by: "Add House Owner", addedOn: ago(0) },
      ]);
      expect(own.days[0]?.visits[0]).toMatchObject({ how: "desk", by: "Front desk", addedOn: null });
      // The person's own list carries no visit id; staff's does.
      expect(JSON.stringify(own.days)).not.toContain('"id"');
      const forStaff = await staffCounted(gym, member.userId);
      expect(forStaff.value).toBe(2);
      expect(forStaff.days[1]?.visits[0]).toMatchObject({ how: "staff", by: "Add House Owner", addedOn: ago(0) });
      expect(forStaff.days.flatMap((x) => x.visits).every((v) => /^[0-9a-f-]{36}$/.test(v.id))).toBe(true);
      // And the board everybody sees.
      expect((await board(gym, member)).me.value).toBe(2);

      // The day list of that day reads it, marked as added later.
      const dayList = await get(`/v1/orgs/${gym.id}/attendance?day=${ago(5)}`, gym.owner.cookies);
      expect(dayList.statusCode).toBe(200);
      expect(dayList.body).toContain('"hoursStatus":"added_later"');

      // The person's app streak has the day.
      const streak = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM streaks WHERE user_id = ${member.userId} AND last_activity_date >= ${ago(5)}::date`;
      expect(streak[0]?.n).toBe(1);
    },
    T,
  );

  it(
    "a visit added in a week the gym checked nobody in breaks nobody else's streak",
    async () => {
      const gym = await makeGym("Silent Week House");
      const asha = await signedIn("Asha Rao");
      const bilal = await signedIn("Bilal Khan");
      for (const p of [asha, bilal]) await join(gym.id, p.userId);
      const mondays = (
        await sql<{ day: string }[]>`
          SELECT (date_trunc('week', (now() AT TIME ZONE ${ZONE})::date)::date - 7 * n)::text AS day
          FROM generate_series(0, 3) n ORDER BY n`
      ).map((r) => r.day);
      const [, lastWeek, silentWeek, earlier] = mondays as [string, string, string, string];
      // Both came three weeks ago and last week; the desk recorded nobody in between.
      for (const p of [asha, bilal]) {
        await visit(gym, { userId: p.userId }, earlier);
        await visit(gym, { userId: p.userId }, lastWeek);
      }
      const streakOf = async (who: Person) => {
        const list = await get(`/v1/orgs/${gym.id}/leaderboard/mine?board=streak`, who.cookies);
        const row = await get(`/v1/orgs/${gym.id}/leaderboard?board=streak`, who.cookies);
        expect([list.statusCode, row.statusCode]).toEqual([200, 200]);
        const counted = JSON.parse(list.body) as LeaderboardCountedResponse;
        // The number is its own list, and the board's.
        expect(counted.weeks.filter((w) => w.state === "counted").length).toBe(counted.value);
        expect((JSON.parse(row.body) as LeaderboardResponse).me.value).toBe(counted.value);
        return counted;
      };
      expect((await streakOf(bilal)).value).toBe(2);

      expect((await add(gym, gym.owner.cookies, { userId: asha.userId }, silentWeek)).statusCode).toBe(200);
      // Bilal's streak is as it was: the week is still not one the gym checked people in.
      expect((await streakOf(bilal)).value).toBe(2);
      // Asha's gym day counts, and her streak neither grows nor breaks on it.
      expect((await mine(gym, asha)).value).toBe(3);
      const hers = await streakOf(asha);
      expect(hers.value).toBe(2);
      expect(hers.weeks.find((w) => w.weekStart === silentWeek)).toEqual({ weekStart: silentWeek, state: "skipped", gymDays: 1 });
    },
    T,
  );

  it(
    "the same request twice adds once; a day with a counted visit adds nothing; a day with only the old tap does",
    async () => {
      const { gym, member } = await gymWithMember("Twice House");
      const pick = { userId: member.userId };
      const first = await add(gym, gym.owner.cookies, pick, ago(4));
      const second = await add(gym, gym.owner.cookies, pick, ago(4));
      expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
      expect((JSON.parse(first.body) as AddVisitResponse).result).toBe("added");
      expect((JSON.parse(second.body) as AddVisitResponse).result).toBe("already");
      // The desk already counted two days ago.
      const counted = await add(gym, gym.owner.cookies, pick, ago(2));
      expect((JSON.parse(counted.body) as AddVisitResponse).result).toBe("already");
      expect(await visitsOf(gym.id)).toBe(2);
      expect((await audits(gym.id, "attendance.visit_added")).length).toBe(1);

      // The member's own old tap never counted, so staff can still add that day.
      await sql`
        INSERT INTO gym_attendance (gym_id, user_id, marked_by_user_id, day, method, hours_status, slot_key)
        VALUES (${gym.id}, ${member.userId}, ${member.userId}, ${ago(6)}::date, 'manual', 'hours_unset', 'hours_unset')`;
      const tapped = await add(gym, gym.owner.cookies, pick, ago(6));
      expect((JSON.parse(tapped.body) as AddVisitResponse).result).toBe("added");
      expect((await mine(gym, member)).value).toBe(3);
    },
    T,
  );

  it(
    "five staff requests at the same instant add one visit and one note",
    async () => {
      const { gym, member } = await gymWithMember("Race House");
      const all = await Promise.all([1, 2, 3, 4, 5].map(() => add(gym, gym.owner.cookies, { userId: member.userId }, ago(3))));
      expect(all.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200]);
      const results = all.map((r) => (JSON.parse(r.body) as AddVisitResponse).result).sort();
      expect(results).toEqual(["added", "already", "already", "already", "already"]);
      expect(await visitsOf(gym.id)).toBe(2);
      expect((await audits(gym.id, "attendance.visit_added")).length).toBe(1);
    },
    T,
  );

  it(
    "only an earlier day within 62 days, and a real date",
    async () => {
      const { gym, member } = await gymWithMember("Window House");
      const pick = { userId: member.userId };
      const tomorrow = (await sql<{ day: string }[]>`SELECT ((now() AT TIME ZONE ${ZONE})::date + 1)::text AS day`)[0]?.day ?? "";
      for (const [day, status] of [
        [ago(0), 400],
        [tomorrow, 400],
        [ago(63), 400],
        ["2026-02-31", 400],
        ["yesterday", 400],
        [ago(62), 200],
        [ago(1), 200],
      ] as const) {
        const res = await add(gym, gym.owner.cookies, pick, day);
        expect(res.statusCode, day).toBe(status);
      }
      expect(await visitsOf(gym.id)).toBe(3);
      const bad = await inject("POST", `/v1/orgs/${gym.id}/attendance/visits`, gym.owner.cookies, { pick, day: ago(1), extra: 1 });
      expect(bad.statusCode).toBe(400);
    },
    T,
  );

  it(
    "a person without the app is added by their record; a former record is nobody",
    async () => {
      const gym = await makeGym("Record House");
      const entryId = await record(gym.id, "Noor NoApp");
      const former = await record(gym.id, "Fay Former", true);
      const res = await add(gym, gym.owner.cookies, { entryId }, ago(1));
      expect(JSON.parse(res.body)).toEqual({ result: "added", person: { name: "Noor NoApp" }, day: ago(1) });
      const rows = await sql<{ user_id: string | null; entry_id: string | null }[]>`
        SELECT user_id, entry_id FROM gym_attendance WHERE gym_id = ${gym.id}`;
      expect(rows).toEqual([{ user_id: null, entry_id: entryId }]);
      expect((await add(gym, gym.owner.cookies, { entryId: former }, ago(1))).statusCode).toBe(404);
      expect(await visitsOf(gym.id)).toBe(1);
    },
    T,
  );

  // ===========================================================================
  // REMOVING A VISIT
  // ===========================================================================

  it(
    "a removed visit counts for nothing, and stays on the person's list with who removed it",
    async () => {
      const { gym, member, visitId } = await gymWithMember("Remove House");
      // A second visit the same day, and one on another day.
      const sameDay = await visit(gym, { userId: member.userId }, ago(2), 1);
      await visit(gym, { userId: member.userId }, ago(4));
      expect((await mine(gym, member)).value).toBe(2);

      // One of two on a day: the day still counts.
      expect((await remove(gym.id, gym.owner.cookies, sameDay)).statusCode).toBe(200);
      expect((await mine(gym, member)).value).toBe(2);

      const res = await remove(gym.id, gym.owner.cookies, visitId);
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ removed: true, day: ago(2) });

      const own = await mine(gym, member);
      expect(own.value).toBe(1);
      expect(own.days.map((x) => x.day)).toEqual([ago(4)]);
      expect(own.notCounted.map((n) => ({ day: n.day, why: n.why, by: n.by, removedOn: n.removedOn }))).toEqual([
        { day: ago(2), why: "removed", by: "Remove House Owner", removedOn: ago(0) },
        { day: ago(2), why: "removed", by: "Remove House Owner", removedOn: ago(0) },
      ]);
      const forStaff = await staffCounted(gym, member.userId);
      expect(forStaff.value).toBe(1);
      expect(forStaff.notCounted.length).toBe(2);
      expect(await visitsOf(gym.id)).toBe(1);
      expect(await removedOf(gym.id)).toBe(2);
    },
    T,
  );

  it(
    "removing the same visit again answers the same and writes nothing more; an unknown visit is 404",
    async () => {
      const { gym, visitId } = await gymWithMember("Again House");
      const all = await Promise.all([1, 2, 3, 4, 5].map(() => remove(gym.id, gym.owner.cookies, visitId)));
      expect(all.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200]);
      const later = await remove(gym.id, gym.owner.cookies, visitId);
      expect(JSON.parse(later.body)).toEqual({ removed: true, day: ago(2) });
      expect(await removedOf(gym.id)).toBe(1);
      expect((await audits(gym.id, "attendance.visit_removed")).length).toBe(1);
      expect((await remove(gym.id, gym.owner.cookies, "00000000-0000-4000-8000-000000000000")).statusCode).toBe(404);
      expect((await remove(gym.id, gym.owner.cookies, "not-a-visit")).statusCode).toBe(400);
    },
    T,
  );

  it(
    "a trainer the owner gave the tick to adds and removes; it is the tick, not the role",
    async () => {
      const { gym, member, visitId } = await gymWithMember("Tick House");
      const trainer = await signedIn("Tara Trainer");
      await addStaff(gym.id, trainer.userId, "trainer", ["attendance.read", "attendance.mark"]);
      const added = await add(gym, trainer.cookies, { userId: member.userId }, ago(1));
      expect(added.statusCode).toBe(200);
      expect((JSON.parse(added.body) as AddVisitResponse).result).toBe("added");
      expect((await remove(gym.id, trainer.cookies, visitId)).statusCode).toBe(200);
      expect(await audits(gym.id, "attendance.visit_removed")).toEqual([{ actor: trainer.userId, target: visitId }]);
    },
    T,
  );

  it(
    "one member of staff past 300 fixes an hour is told to wait; a colleague at the same address is not",
    async () => {
      const { gym, member } = await gymWithMember("Limit House");
      const colleague = await signedIn("Cara Colleague");
      await addStaff(gym.id, colleague.userId, "manager", null);
      const address = "10.99.0.1";
      const nobody = "00000000-0000-4000-8000-000000000000";
      const ask = (cookies: Cookies) => inject("DELETE", `/v1/orgs/${gym.id}/attendance/visits/${nobody}`, cookies, undefined, address);
      const answers = new Map<number, number>();
      for (let i = 0; i < 300; i++) {
        const status = (await ask(gym.owner.cookies)).statusCode;
        answers.set(status, (answers.get(status) ?? 0) + 1);
      }
      expect([...answers]).toEqual([[404, 300]]);
      expect((await ask(gym.owner.cookies)).statusCode).toBe(429);
      // Adding is held to the same count.
      expect((await inject("POST", `/v1/orgs/${gym.id}/attendance/visits`, gym.owner.cookies, { pick: { userId: member.userId }, day: ago(1) }, address)).statusCode).toBe(429);
      expect(await visitsOf(gym.id)).toBe(1);
      expect((await ask(colleague.cookies)).statusCode).toBe(404);
    },
    120_000,
  );

  it(
    "a removed visit that names only a record shows to the one member holding that record, and only in its own period",
    async () => {
      const gym = await makeGym("Period House");
      const member = await signedIn("Rina Record");
      const entryId = await record(gym.id, "Rina Record");
      await join(gym.id, member.userId, entryId);
      // From before the app: the visit names her record and no account. Forty days ago is
      // in no week or month that holds today or last week.
      const old = await visit(gym, { entryId }, ago(40));
      expect((await mine(gym, member)).value).toBe(1);
      expect((await remove(gym.id, gym.owner.cookies, old)).statusCode).toBe(200);

      const allTime = await mine(gym, member);
      expect(allTime.value).toBe(0);
      expect(allTime.notCounted.map((n) => ({ day: n.day, why: n.why }))).toEqual([{ day: ago(40), why: "removed" }]);
      for (const period of ["this_week", "last_week"]) {
        expect((await mine(gym, member, period)).notCounted, period).toEqual([]);
      }
    },
    T,
  );

  it(
    "Remove pressed at the same moment as a join of the person's two records, or a delete of their record, never answers a server error",
    async () => {
      const gym = await makeGym("Same Moment House");
      for (let round = 0; round < 8; round++) {
        const from = await record(gym.id, `Ravi Old ${String(round)}`);
        const to = await record(gym.id, `Ravi Kept ${String(round)}`);
        const visitId = await visit(gym, { entryId: from }, ago(3));
        const [removed, merged] = await Promise.all([
          remove(gym.id, gym.owner.cookies, visitId),
          inject("POST", `/v1/orgs/${gym.id}/member-list/entries/${from}/merge`, gym.owner.cookies, { keepEntryId: to }),
        ]);
        expect(merged.statusCode, `join, round ${String(round)}`).toBe(200);
        // Whichever went first, the visit is there to remove: on its record, or the kept one.
        expect(removed.statusCode, `remove beside a join, round ${String(round)}`).toBe(200);
        const kept = await sql<{ entry_id: string | null }[]>`
          SELECT entry_id FROM gym_attendance_removed WHERE gym_id = ${gym.id} AND id = ${visitId}`;
        expect(kept).toEqual([{ entry_id: to }]);
      }
      for (let round = 0; round < 8; round++) {
        const former = await record(gym.id, `Fay Former ${String(round)}`, true);
        const visitId = await visit(gym, { entryId: former }, ago(3));
        const [removed, deleted] = await Promise.all([
          remove(gym.id, gym.owner.cookies, visitId),
          inject("DELETE", `/v1/orgs/${gym.id}/member-list/former/${former}`, gym.owner.cookies),
        ]);
        expect(deleted.statusCode, `delete, round ${String(round)}`).toBe(200);
        // Removed first, or gone with its record: never a 500.
        expect([200, 404], `remove beside a delete, round ${String(round)}`).toContain(removed.statusCode);
      }
      expect(await visitsOf(gym.id)).toBe(0);
    },
    120_000,
  );

  it(
    "the person's app streak loses a removed day",
    async () => {
      const gym = await makeGym("Streak House");
      const member = await signedIn("Sana Streak");
      await join(gym.id, member.userId);
      const has = async (day: string): Promise<boolean> =>
        ((await sql`SELECT 1 FROM streaks WHERE user_id = ${member.userId} AND last_activity_date >= ${day}::date`).length) > 0;
      expect((await add(gym, gym.owner.cookies, { userId: member.userId }, ago(1))).statusCode).toBe(200);
      expect(await has(ago(1))).toBe(true);
      const row = await sql<{ id: string }[]>`SELECT id FROM gym_attendance WHERE gym_id = ${gym.id}`;
      expect((await remove(gym.id, gym.owner.cookies, row[0]?.id ?? "")).statusCode).toBe(200);
      expect(await has(ago(1))).toBe(false);
    },
    T,
  );

  // ===========================================================================
  // A REMOVED VISIT FOLLOWS ITS RECORD
  // ===========================================================================

  it(
    "a removed visit moves with a joined record, stays with an account when its record is deleted, and goes with a record only it named",
    async () => {
      const gym = await makeGym("Follow House");
      const from = await record(gym.id, "Ravi Old");
      const to = await record(gym.id, "Ravi Kept");
      const withAccount = await account("Ravi Account");
      const a = await visit(gym, { entryId: from }, ago(3));
      const b = await visit(gym, { entryId: from, userId: withAccount.userId }, ago(4));
      for (const id of [a, b]) expect((await remove(gym.id, gym.owner.cookies, id)).statusCode).toBe(200);

      await sql.begin(async (tx) => {
        await moveVisitLinks(tx, gym.id, from, to);
      });
      const moved = await sql<{ entry_id: string | null }[]>`
        SELECT entry_id FROM gym_attendance_removed WHERE gym_id = ${gym.id}`;
      expect(moved).toEqual([{ entry_id: to }, { entry_id: to }]);

      await sql.begin(async (tx) => {
        await deleteEntry(tx, gym.id, to);
      });
      const left = await sql<{ id: string; entry_id: string | null; user_id: string | null }[]>`
        SELECT id, entry_id, user_id FROM gym_attendance_removed WHERE gym_id = ${gym.id}`;
      expect(left).toEqual([{ id: b, entry_id: null, user_id: withAccount.userId }]);
    },
    T,
  );

  it(
    "a gym's whole list deleted keeps the removed visits that name an account, and takes the rest",
    async () => {
      const gym = await makeGym("Whole List House");
      const entryId = await record(gym.id, "Lila Listed");
      const withAccount = await account("Lila Account");
      const a = await visit(gym, { entryId }, ago(3));
      const b = await visit(gym, { entryId, userId: withAccount.userId }, ago(4));
      for (const id of [a, b]) expect((await remove(gym.id, gym.owner.cookies, id)).statusCode).toBe(200);
      await sql.begin(async (tx) => {
        await deleteListForGym(tx, gym.id);
      });
      const left = await sql<{ id: string; entry_id: string | null; user_id: string | null }[]>`
        SELECT id, entry_id, user_id FROM gym_attendance_removed WHERE gym_id = ${gym.id}`;
      expect(left).toEqual([{ id: b, entry_id: null, user_id: withAccount.userId }]);
    },
    T,
  );
});
