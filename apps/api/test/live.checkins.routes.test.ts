// LIVE UPDATES for the check-in log and the Leaderboard (ROADMAP Stage 4 item 18-ii), against REAL
// Postgres on a real listening server, with real open lines (DATABASE_URL-gated).
//
// The first test is the worst thing this job could do to a real person (CLAUDE.md §2.1): another
// gym's staff, or a member, learning the moment somebody checks in here. Then each change that
// tells, and each that must not.
import { randomUUID } from "node:crypto";
import type { ReadableStreamReadResult } from "node:stream/web";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const SECRET = "live-checkins-secret-0123456789abcdef"; // dummy test value, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: SECRET,
  LOG_LEVEL: "error",
  JOIN_CODES: "on",
  MEMBER_TAP: "on",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
interface CreatedOrg {
  org: { id: string };
  joinCode: { code: string };
}

const T = 180_000;
const PLAN = "zz_live_checkins";

let ipCounter = 0;
const nextIp = () => `10.97.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
const cookieHeader = (cookies: Cookies) =>
  Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, ms = 5_000): Promise<void> {
  const by = Date.now() + ms;
  while (!check()) {
    if (Date.now() > by) throw new Error("waited too long");
    await pause(20);
  }
}

/** One open line, read as a browser reads it. */
interface Line {
  status: number;
  messages: unknown[];
  raw: string;
  close: () => void;
}

async function openLine(base: string, gymId: string, cookies: Cookies): Promise<Line> {
  const controller = new AbortController();
  const res = await fetch(`${base}/v1/orgs/${gymId}/live`, {
    headers: { accept: "text/event-stream", "x-forwarded-for": nextIp(), cookie: cookieHeader(cookies), origin: baseEnv.WEB_ORIGIN },
    signal: controller.signal,
  });
  const line: Line = { status: res.status, messages: [], raw: "", close: () => {
      controller.abort();
    } };
  if (res.status !== 200 || res.body === null) return line;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  void (async () => {
    try {
      for (;;) {
        const read: ReadableStreamReadResult<Uint8Array> = await reader.read();
        if (read.done) break;
        const text = decoder.decode(read.value, { stream: true });
        line.raw += text;
        buffer += text;
        let at = buffer.indexOf("\n\n");
        while (at >= 0) {
          const block = buffer.slice(0, at);
          buffer = buffer.slice(at + 2);
          if (block.startsWith("data: ")) line.messages.push(JSON.parse(block.slice("data: ".length)));
          at = buffer.indexOf("\n\n");
        }
      }
    } catch {
      // Closed by the test.
    }
  })();
  await until(() => line.messages.length > 0);
  return line;
}

const READY = { what: "ready" };
const ADDED = { what: "visits", change: "added" };
const REMOVED = { what: "visits", change: "removed" };
const BOARD = { what: "leaderboard", change: "counted" };
const SWITCHED = { what: "leaderboard", change: "switched" };
const PEOPLE = { what: "people" };

d("live updates: the check-in log and the Leaderboard (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  let base = "";
  /** The server's limits, so a test can use one up. */
  const appRedis = createMemoryRedis();
  /** The code each account deletion emailed, by address. */
  const deleteCodes = new Map<string, string>();
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const mine = () => sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'livec-t-%@example.com')`;
  const cleanup = async () => {
    await sql`DELETE FROM gym_attendance_removed WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_attendance WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_checkin_devices WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_member_list_fields WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine()})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine()})`;
    await sql`DELETE FROM workout_sets WHERE workout_id IN (SELECT id FROM workouts WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'livec-t-%@example.com'))`;
    await sql`DELETE FROM workouts WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'livec-t-%@example.com')`;
    await sql`DELETE FROM sign_in_codes WHERE email LIKE 'livec-t-%@example.com'`;
    await sql`DELETE FROM users WHERE email LIKE 'livec-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${PLAN}`;
  };

  const send = (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, cookies: Cookies, payload?: unknown, headers: Record<string, string> = {}) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? { headers } : { headers: { "content-type": "application/json", ...headers }, payload: JSON.stringify(payload) }),
    });
  const get = (path: string, cookies: Cookies = {}) => send("GET", path, cookies);
  const post = (path: string, payload: unknown, cookies: Cookies = {}) => send("POST", path, cookies, payload);
  const put = (path: string, payload: unknown, cookies: Cookies = {}) => send("PUT", path, cookies, payload);

  interface Person {
    userId: string;
    email: string;
    cookies: Cookies;
  }
  let userCount = 0;
  const makeUser = async (local: string): Promise<Person> => {
    const email = `livec-t-${local}-${String(++userCount)}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Live ${local}` });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode, login.body).toBe(200);
    return { userId, email, cookies: cookieMap(login) };
  };
  const makeGym = async (owner: Person, name: string): Promise<CreatedOrg> => {
    const res = await post("/v1/orgs", { trainsHere: true, name, city: "Austin", country: "US", timezone: "America/Chicago" }, owner.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const created = JSON.parse(res.body) as CreatedOrg;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${created.org.id}`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${created.org.id}, (SELECT id FROM plans WHERE code = ${PLAN}), 'trialing', 'pilot')`;
    return created;
  };
  const makeMember = async (org: CreatedOrg, owner: Person, person: Person) => {
    const applied = await post("/v1/orgs/join", { code: org.joinCode.code }, person.cookies);
    expect(applied.statusCode, applied.body).toBe(200);
    const id = (JSON.parse(applied.body) as { application?: { id: string } }).application?.id;
    if (id === undefined) throw new Error("apply returned no application");
    expect((await post(`/v1/orgs/${org.org.id}/applications/${id}/confirm`, {}, owner.cookies)).statusCode).toBe(200);
  };
  const makeStaff = async (org: CreatedOrg, owner: Person, person: Person) => {
    await makeMember(org, owner, person);
    await proveAddress(sql, person.email);
    expect((await post(`/v1/orgs/${org.org.id}/staff`, { email: person.email, role: "manager" }, owner.cookies)).statusCode).toBe(201);
    const ticks = await put(`/v1/orgs/${org.org.id}/staff/${person.userId}/privileges`, { privileges: ["attendance.mark"] }, owner.cookies);
    expect(ticks.statusCode, ticks.body).toBe(200);
  };
  interface Gym {
    gymId: string;
    org: CreatedOrg;
    owner: Person;
  }
  let gymCount = 0;
  const makeBusiness = async (name: string): Promise<Gym> => {
    const owner = await makeUser(`owner${String(++gymCount)}`);
    const org = await makeGym(owner, name);
    return { gymId: org.org.id, org, owner };
  };
  const checkIn = (gym: Gym, person: Person, cookies: Cookies = gym.owner.cookies) =>
    post(`/v1/orgs/${gym.gymId}/attendance/check-in`, { userId: person.userId }, cookies);
  const workout = (person: Person, workoutId = randomUUID()) =>
    send(
      "POST",
      "/v1/workouts/sync",
      person.cookies,
      {
        workoutId,
        startedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        platform: "web",
        engineVersion: "1.0.0",
        defsVersion: 1,
        traceSample: null,
        sets: [
          {
            exercise: "squat",
            setIndex: 1,
            reps: 10,
            durationMs: 30000,
            mode: "log_only",
            avgFormScore: null,
            repScores: null,
            faultCounts: {},
            tempoMsAvg: null,
            romStats: null,
            view: "unknown",
            holdMs: null,
            calibration: null,
            engineVersion: null,
            definitionVersion: null,
          },
        ],
      },
      { "idempotency-key": workoutId },
    );
  /** What a line heard after its `ready`. */
  const heard = (line: Line) => line.messages.slice(1);
  /** Long enough for news sent after a response to have reached every line. */
  const settle = () => pause(250);

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    const quietEmail = {
      sendVerificationEmail: () => Promise.resolve(),
      sendPasswordResetEmail: () => Promise.resolve(),
      sendSignInCodeEmail: () => Promise.resolve(),
    };
    const usersEmailSender = {
      sendAccountDeleteCodeEmail: (to: string, code: string) => {
        deleteCodes.set(to.toLowerCase(), code);
        return Promise.resolve();
      },
      sendAccountDeletionEmail: () => Promise.resolve(),
    };
    app = await buildApp(loadConfig(baseEnv), { redis: appRedis, emailSender: quietEmail, usersEmailSender, live: { heartbeatMs: 60_000 } });
    base = await app.listen({ port: 0, host: "127.0.0.1" });
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, T);

  it(
    "a check-in, a workout and Hide me reach this gym's staff only, and say nothing about the person",
    async () => {
      const a = await makeBusiness("Live Checkins A");
      const b = await makeBusiness("Live Checkins B");
      const manager = await makeUser("manager");
      await makeStaff(a.org, a.owner, manager);
      const maya = await makeUser("maya");
      await makeMember(a.org, a.owner, maya);
      const onlyB = await makeUser("onlyb");
      await makeMember(b.org, b.owner, onlyB);

      // A member of the gym, or another gym's owner, never has a line of its own here.
      for (const cookies of [maya.cookies, b.owner.cookies]) {
        const refused = await openLine(base, a.gymId, cookies);
        expect(refused.status).toBe(404);
        refused.close();
      }

      const ownerA = await openLine(base, a.gymId, a.owner.cookies);
      const managerA = await openLine(base, a.gymId, manager.cookies);
      const ownerB = await openLine(base, b.gymId, b.owner.cookies);
      // Maya, staff of nowhere, holds B's line? She cannot: she is not B's staff either.
      const mayaB = await openLine(base, b.gymId, maya.cookies);
      expect(mayaB.status).toBe(404);
      for (const line of [ownerA, managerA, ownerB]) expect(line.messages).toEqual([READY]);

      expect((await checkIn(a, maya)).statusCode).toBe(200);
      expect((await workout(maya)).statusCode).toBe(201);
      expect((await put("/v1/users/me/leaderboard", { hidden: true }, maya.cookies)).statusCode).toBe(200);
      await until(() => heard(ownerA).length >= 3 && heard(managerA).length >= 3);
      await settle();

      expect(heard(ownerA)).toEqual([ADDED, BOARD, BOARD]);
      expect(heard(managerA)).toEqual([ADDED, BOARD, BOARD]);
      // Gym B heard nothing of Maya, who is not one of its members.
      expect(heard(ownerB)).toEqual([]);
      // Nothing that names her, her account or the visit went down any line.
      for (const line of [ownerA, managerA, ownerB]) {
        expect(line.raw).not.toContain(maya.userId);
        expect(line.raw).not.toContain("maya");
        expect(line.raw).not.toContain("Live");
      }

      // A member of B alone: only B hears of their workout.
      expect((await workout(onlyB)).statusCode).toBe(201);
      await until(() => heard(ownerB).length >= 1);
      await settle();
      expect(heard(ownerB)).toEqual([BOARD]);
      expect(heard(ownerA)).toEqual([ADDED, BOARD, BOARD]);

      for (const line of [ownerA, managerA, ownerB]) line.close();
    },
    T,
  );

  it(
    "staff check-ins, a visit added for an earlier day and a visit removed each tell; a second check-in or the same day added again does not",
    async () => {
      const gym = await makeBusiness("Live Checkins Desk");
      const manager = await makeUser("deskmanager");
      await makeStaff(gym.org, gym.owner, manager);
      const ben = await makeUser("ben");
      await makeMember(gym.org, gym.owner, ben);
      const line = await openLine(base, gym.gymId, gym.owner.cookies);

      // Checked in by the manager in another window: the owner's line hears it.
      const first = await checkIn(gym, ben, manager.cookies);
      expect(first.statusCode, first.body).toBe(200);
      expect(JSON.parse(first.body)).toMatchObject({ result: "checked_in" });
      await until(() => heard(line).length >= 1);
      // Already here: nothing new on the log.
      const again = await checkIn(gym, ben, manager.cookies);
      expect(JSON.parse(again.body)).toMatchObject({ result: "already" });
      await settle();
      expect(heard(line)).toEqual([ADDED]);

      // A visit for yesterday.
      const [today] = await sql<{ day: string }[]>`SELECT ((now() AT TIME ZONE 'America/Chicago')::date - 1)::text AS day`;
      const added = await post(`/v1/orgs/${gym.gymId}/attendance/visits`, { pick: { userId: ben.userId }, day: today?.day }, manager.cookies);
      expect(added.statusCode, added.body).toBe(200);
      expect(JSON.parse(added.body)).toMatchObject({ result: "added" });
      await until(() => heard(line).length >= 2);
      // The same again is `already`: nothing is told.
      const twice = await post(`/v1/orgs/${gym.gymId}/attendance/visits`, { pick: { userId: ben.userId }, day: today?.day }, manager.cookies);
      expect(JSON.parse(twice.body)).toMatchObject({ result: "already" });
      await settle();
      expect(heard(line)).toEqual([ADDED, ADDED]);

      // Removed in another window: the log reads the whole day again.
      const [visit] = await sql<{ id: string }[]>`SELECT id FROM gym_attendance WHERE gym_id = ${gym.gymId} ORDER BY marked_at DESC LIMIT 1`;
      const removed = await send("DELETE", `/v1/orgs/${gym.gymId}/attendance/visits/${visit?.id ?? ""}`, manager.cookies);
      expect(removed.statusCode, removed.body).toBe(200);
      await until(() => heard(line).length >= 3);
      await settle();
      expect(heard(line)).toEqual([ADDED, ADDED, REMOVED]);

      // Refused check-ins tell nothing: a member of another gym, and a person who is not staff.
      const stranger = await makeUser("deskstranger");
      expect((await checkIn(gym, stranger, manager.cookies)).statusCode).not.toBe(200);
      expect((await checkIn(gym, ben, ben.cookies)).statusCode).not.toBe(200);
      await settle();
      expect(heard(line)).toEqual([ADDED, ADDED, REMOVED]);
      line.close();
    },
    T,
  );

  it(
    "a scan at the desk and the member's own tap tell; a scan the desk does not know does not",
    async () => {
      const gym = await makeBusiness("Live Checkins Scan");
      const cara = await makeUser("cara");
      await makeMember(gym.org, gym.owner, cara);
      const dan = await makeUser("dan");
      await makeMember(gym.org, gym.owner, dan);
      const line = await openLine(base, gym.gymId, gym.owner.cookies);

      const device = await post(`/v1/orgs/${gym.gymId}/checkin-devices`, { name: "Front desk" }, gym.owner.cookies);
      expect(device.statusCode).toBe(201);
      const token = (JSON.parse(device.body) as { link: string }).link.split("#")[1] ?? "";
      const claimed = await post("/v1/checkin/device/claim", { token });
      expect(claimed.statusCode).toBe(200);
      const desk = cookieMap(claimed);

      const unknown = await post("/v1/checkin/scan", { code: "not-a-pass-or-tag" }, desk);
      expect(unknown.statusCode).toBe(200);
      expect(JSON.parse(unknown.body)).not.toMatchObject({ result: "checked_in" });
      await settle();
      expect(heard(line)).toEqual([]);

      const pass = await get("/v1/users/me/checkin-pass", cara.cookies);
      expect(pass.statusCode, pass.body).toBe(200);
      const scanned = await post("/v1/checkin/scan", { code: (JSON.parse(pass.body) as { pass: string }).pass }, desk);
      expect(JSON.parse(scanned.body)).toMatchObject({ result: "checked_in" });
      await until(() => heard(line).length >= 1);

      const tapped = await post(`/v1/orgs/${gym.gymId}/attendance`, {}, dan.cookies);
      expect(tapped.statusCode, tapped.body).toBe(200);
      await until(() => heard(line).length >= 2);
      // Tapped again: already marked, nothing new.
      expect((await post(`/v1/orgs/${gym.gymId}/attendance`, {}, dan.cookies)).statusCode).toBe(200);
      await settle();
      expect(heard(line)).toEqual([ADDED, ADDED]);
      line.close();
    },
    T,
  );

  it(
    "staff switching a board or taking a person off tell the gym's other windows; a workout sent twice tells once",
    async () => {
      const gym = await makeBusiness("Live Checkins Board");
      const eli = await makeUser("eli");
      await makeMember(gym.org, gym.owner, eli);
      const line = await openLine(base, gym.gymId, gym.owner.cookies);

      const switched = await put(`/v1/orgs/${gym.gymId}/leaderboard/staff/boards`, { board: "streak", off: true }, gym.owner.cookies);
      expect(switched.statusCode, switched.body).toBe(200);
      await until(() => heard(line).length >= 1);
      const off = await put(`/v1/orgs/${gym.gymId}/leaderboard/staff/people/${eli.userId}`, { takenOff: true }, gym.owner.cookies);
      expect(off.statusCode, off.body).toBe(200);
      await until(() => heard(line).length >= 2);

      const id = randomUUID();
      expect((await workout(eli, id)).statusCode).toBe(201);
      await until(() => heard(line).length >= 3);
      expect((await workout(eli, id)).statusCode).toBe(200);
      // A member who has left the gym is on no board of it.
      await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${gym.gymId} AND user_id = ${eli.userId}`;
      expect((await workout(eli)).statusCode).toBe(201);
      // Refused by the server: a member switching a board.
      expect((await put(`/v1/orgs/${gym.gymId}/leaderboard/staff/boards`, { board: "streak", off: false }, eli.cookies)).statusCode).toBe(404);
      await settle();
      expect(heard(line)).toEqual([SWITCHED, SWITCHED, BOARD]);
      line.close();
    },
    T,
  );

  it(
    "a visit fix the server refuses tells nothing: a member, another gym's visit, and staff over their limit",
    async () => {
      const gym = await makeBusiness("Live Checkins Refused");
      const other = await makeBusiness("Live Checkins Refused B");
      const dee = await makeUser("dee");
      await makeMember(gym.org, gym.owner, dee);
      expect((await checkIn(gym, dee)).statusCode).toBe(200);
      const theirs = await makeUser("theirs");
      await makeMember(other.org, other.owner, theirs);
      expect((await checkIn(other, theirs)).statusCode).toBe(200);
      const [visit] = await sql<{ id: string }[]>`SELECT id FROM gym_attendance WHERE gym_id = ${gym.gymId}`;
      const [otherVisit] = await sql<{ id: string }[]>`SELECT id FROM gym_attendance WHERE gym_id = ${other.gymId}`;
      const line = await openLine(base, gym.gymId, gym.owner.cookies);
      const [yesterday] = await sql<{ day: string }[]>`SELECT ((now() AT TIME ZONE 'America/Chicago')::date - 1)::text AS day`;

      // A member of the gym, without the tick.
      expect((await post(`/v1/orgs/${gym.gymId}/attendance/visits`, { pick: { userId: dee.userId }, day: yesterday?.day }, dee.cookies)).statusCode).not.toBe(200);
      expect((await send("DELETE", `/v1/orgs/${gym.gymId}/attendance/visits/${visit?.id ?? ""}`, dee.cookies)).statusCode).not.toBe(200);
      // Another gym's visit, through this gym's address.
      expect((await send("DELETE", `/v1/orgs/${gym.gymId}/attendance/visits/${otherVisit?.id ?? ""}`, gym.owner.cookies)).statusCode).toBe(404);
      // The owner over the hour's limit of fixes.
      for (let i = 0; i < 300; i += 1) await appRedis.incrWithTtl(`rl:checkin_visit_fix:id:${gym.owner.userId}`, 3600);
      expect((await send("DELETE", `/v1/orgs/${gym.gymId}/attendance/visits/${visit?.id ?? ""}`, gym.owner.cookies)).statusCode).toBe(429);
      expect((await post(`/v1/orgs/${gym.gymId}/attendance/visits`, { pick: { userId: dee.userId }, day: yesterday?.day }, gym.owner.cookies)).statusCode).toBe(429);
      await settle();
      expect(heard(line)).toEqual([]);
      // The visit is still there.
      expect((await sql`SELECT 1 FROM gym_attendance WHERE id = ${visit?.id ?? ""}`).length).toBe(1);
      line.close();
    },
    T,
  );

  it(
    "a person changed tells the gym's people news: on its list, joining, removed, and their own name; to that gym only, and never for a refused change",
    async () => {
      const gym = await makeBusiness("Live People A");
      const elsewhere = await makeBusiness("Live People B");
      const line = await openLine(base, gym.gymId, gym.owner.cookies);
      const lineB = await openLine(base, elsewhere.gymId, elsewhere.owner.cookies);

      // Added to the list, renamed, and taken off it.
      const added = await post(`/v1/orgs/${gym.gymId}/member-list/entries`, { fullName: "Rita Record", email: "livec-p-rita@example.com" }, gym.owner.cookies);
      expect([200, 201], added.body).toContain(added.statusCode);
      const entryId = (JSON.parse(added.body) as { entry: { entryId: string } }).entry.entryId;
      await until(() => heard(line).length >= 1);
      const renamed = await send("PATCH", `/v1/orgs/${gym.gymId}/member-list/entries/${entryId}`, gym.owner.cookies, { fullName: "Rita Renamed" });
      expect(renamed.statusCode, renamed.body).toBe(200);
      await until(() => heard(line).length >= 2);
      // A member of the gym cannot rename anybody: refused, nothing told.
      const fern = await makeUser("fern");
      await makeMember(gym.org, gym.owner, fern);
      await until(() => heard(line).length >= 3);
      expect((await send("PATCH", `/v1/orgs/${gym.gymId}/member-list/entries/${entryId}`, fern.cookies, { fullName: "Not Allowed" })).statusCode).not.toBe(200);
      await settle();
      expect(heard(line)).toEqual([PEOPLE, PEOPLE, PEOPLE]);
      const off = await send("DELETE", `/v1/orgs/${gym.gymId}/member-list/entries/${entryId}`, gym.owner.cookies);
      expect(off.statusCode, off.body).toBe(200);
      await until(() => heard(line).length >= 4);

      // Their own name: the gym they belong to hears it, the other does not.
      expect((await send("PATCH", "/v1/users/me", fern.cookies, { displayName: "Fern Renamed" })).statusCode).toBe(200);
      await until(() => heard(line).length >= 5);
      // Removed from the gym by staff.
      const removed = await send("DELETE", `/v1/orgs/${gym.gymId}/members/${fern.userId}`, gym.owner.cookies);
      expect(removed.statusCode, removed.body).toBe(200);
      await until(() => heard(line).length >= 6);
      // A name changed after they left reaches no gym of theirs.
      expect((await send("PATCH", "/v1/users/me", fern.cookies, { displayName: "Fern Left" })).statusCode).toBe(200);
      await settle();
      expect(heard(line)).toEqual([PEOPLE, PEOPLE, PEOPLE, PEOPLE, PEOPLE, PEOPLE]);
      expect(heard(lineB)).toEqual([]);
      expect(line.raw).not.toContain("Rita");
      expect(line.raw).not.toContain(fern.userId);
      line.close();
      lineB.close();
    },
    T,
  );

  it(
    "a member saving their profile is news only when what a gym shows changed: a new name or a new age, never the same again or their units",
    async () => {
      const gym = await makeBusiness("Live People Saves");
      const gus = await makeUser("gus");
      await makeMember(gym.org, gym.owner, gus);
      const line = await openLine(base, gym.gymId, gym.owner.cookies);
      const me = (payload: unknown) => send("PATCH", "/v1/users/me", gus.cookies, payload);
      const body = (payload: unknown) => send("PUT", "/v1/users/me/fitness-profile", gus.cookies, payload);

      // Saved over and over with nothing a gym shows changed: nothing told.
      for (let i = 0; i < 20; i += 1) expect((await me({ displayName: "Live gus" })).statusCode).toBe(200);
      expect((await me({ units: "imperial" })).statusCode).toBe(200);
      expect((await body({ heightCm: 180 })).statusCode).toBe(200);
      await settle();
      expect(heard(line)).toEqual([]);
      // A new name, then a new age: each told once; the same age again is not.
      expect((await me({ displayName: "Gus Renamed" })).statusCode).toBe(200);
      await until(() => heard(line).length >= 1);
      expect((await body({ age: 30 })).statusCode).toBe(200);
      await until(() => heard(line).length >= 2);
      expect((await body({ age: 30 })).statusCode).toBe(200);
      await settle();
      expect(heard(line)).toEqual([PEOPLE, PEOPLE]);
      // A save that leaves the age out takes it away: that is a change too.
      expect((await body({ heightCm: 181 })).statusCode).toBe(200);
      await until(() => heard(line).length >= 3);
      // Hide me through the profile: the board is told; the same again is not.
      expect((await me({ leaderboardOptOut: true })).statusCode).toBe(200);
      await until(() => heard(line).length >= 4);
      expect((await me({ leaderboardOptOut: true })).statusCode).toBe(200);
      await settle();
      expect(heard(line)).toEqual([PEOPLE, PEOPLE, PEOPLE, BOARD]);
      line.close();
    },
    T,
  );

  it(
    "a member may change what a gym shows of them 30 times an hour; a save that changes nothing is not counted",
    async () => {
      const gym = await makeBusiness("Live People Limit");
      const hal = await makeUser("hal");
      await makeMember(gym.org, gym.owner, hal);
      const line = await openLine(base, gym.gymId, gym.owner.cookies);
      const me = (payload: unknown) => send("PATCH", "/v1/users/me", hal.cookies, payload);
      const body = (payload: unknown) => send("PUT", "/v1/users/me/fitness-profile", hal.cookies, payload);
      const key = `rl:users_shown_changes:id:${hal.userId}`;
      // 29 changes already this hour.
      await appRedis.setex(key, 3600, "29");
      // Saves that change nothing a gym shows are given back, however many.
      for (let i = 0; i < 5; i += 1) expect((await me({ displayName: "Live hal" })).statusCode).toBe(200);
      expect((await body({ heightCm: 175 })).statusCode).toBe(200);
      expect(await appRedis.get(key)).toBe("29");
      // The 30th change is taken and told.
      expect((await me({ displayName: "Hal One" })).statusCode).toBe(200);
      await until(() => heard(line).length >= 1);
      // Past it: a new name, Hide me and a new age are refused, in words, and nothing is told.
      for (const refused of [await me({ displayName: "Hal Two" }), await me({ leaderboardOptOut: true }), await body({ age: 40 })]) {
        expect([refused.statusCode, (JSON.parse(refused.body) as { message: string }).message]).toEqual([
          429,
          "You've changed your name or profile many times in the last hour. Please try again later.",
        ]);
      }
      // A save that sends nothing a gym shows is not stopped, nor a height with the age as saved.
      expect((await me({ units: "imperial" })).statusCode).toBe(200);
      expect((await body({ heightCm: 176 })).statusCode).toBe(200);
      await settle();
      expect(heard(line)).toEqual([PEOPLE]);
      // 30, and the 3 refused: the height took none.
      expect(await appRedis.get(key)).toBe("33");
      const [row] = await sql<{ display_name: string; leaderboard_opt_out: boolean }[]>`SELECT display_name, leaderboard_opt_out FROM users WHERE id = ${hal.userId}`;
      expect(row).toEqual({ display_name: "Hal One", leaderboard_opt_out: false });
      line.close();
    },
    T,
  );

  it(
    "an account deleted tells the gyms it left, a gym it joined just before too",
    async () => {
      const first = await makeBusiness("Live Deleted A");
      const second = await makeBusiness("Live Deleted B");
      const ivy = await makeUser("ivy");
      await makeMember(first.org, first.owner, ivy);
      await makeMember(second.org, second.owner, ivy);
      const lineA = await openLine(base, first.gymId, first.owner.cookies);
      const lineB = await openLine(base, second.gymId, second.owner.cookies);
      expect((await post("/v1/users/me/delete-code", {}, ivy.cookies)).statusCode).toBe(200);
      const code = deleteCodes.get(ivy.email.toLowerCase());
      if (code === undefined) throw new Error("no delete code was emailed");
      const deleted = await send("DELETE", "/v1/users/me", ivy.cookies, { code });
      expect(deleted.statusCode, deleted.body).toBe(200);
      await until(() => heard(lineA).length >= 1 && heard(lineB).length >= 1);
      expect([heard(lineA), heard(lineB)]).toEqual([[PEOPLE], [PEOPLE]]);
      lineA.close();
      lineB.close();
    },
    T,
  );
});
