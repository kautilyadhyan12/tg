// THE MEMBER'S TAP SWITCHED OFF (ROADMAP 16c; spec Part 3 §12.7), against REAL Postgres
// (DATABASE_URL-gated).
//
// The first test is the worst thing this job could do to a real person (CLAUDE.md §2.1):
// a member still checks themselves in from home, so the gym's attendance and their streak
// count a visit that never happened. Then the tap answers 410 to everybody; and the same
// tap with the switch on is taken, so the 410 is the switch and not a broken route.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "tap-retired-secret-0123456789abcde", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
const TEST_TIMEOUT_MS = 120_000;
const HOOK_TIMEOUT_MS = 60_000;

const PLAN = "zz_tap16c_live";
const addr = (local: string) => `tap16c-t-${local}@tap16c-t.example.com`;

interface User {
  userId: string;
  cookies: Record<string, string>;
}

let ipCounter = 0;
const nextIp = () => `10.69.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

d("the member's tap switched off (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const signInCodes = new Map<string, string>();
  let off: App | undefined;
  let on: App | undefined;
  const need = (app: App | undefined): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const myUsers = () => sql`SELECT id FROM users WHERE email LIKE 'tap16c-t-%'`;
  const mine = () => sql`SELECT id FROM gyms WHERE owner_user_id IN (${myUsers()})`;
  const cleanup = async () => {
    await sql`DELETE FROM gym_attendance WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_attendance WHERE user_id IN (${myUsers()})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine()})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM streaks WHERE user_id IN (${myUsers()})`;
    await sql`DELETE FROM user_achievements WHERE user_id IN (${myUsers()})`;
    await sql`DELETE FROM user_xp WHERE user_id IN (${myUsers()})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine()})`;
    await sql`DELETE FROM users WHERE email LIKE 'tap16c-t-%'`;
    await sql`DELETE FROM sign_in_codes WHERE email LIKE 'tap16c-t-%'`;
    await sql`DELETE FROM plans WHERE code = ${PLAN}`;
  };

  const send = (app: App, method: "GET" | "POST", path: string, cookies: Record<string, string>, payload?: unknown) =>
    app.inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });

  /** Sign in by a code emailed to the address. */
  const signIn = async (local: string): Promise<User> => {
    const email = addr(local);
    expect((await send(need(off), "POST", "/v1/auth/code/send", {}, { email })).statusCode).toBe(200);
    const code = signInCodes.get(email);
    if (code === undefined) throw new Error(`no sign-in code was sent to ${email}`);
    const res = await send(need(off), "POST", "/v1/auth/code/verify", {}, { email, code });
    expect(res.statusCode, res.body).toBe(200);
    const { user } = JSON.parse(res.body) as { user: { id: string } };
    return { userId: user.id, cookies: cookieMap(res) };
  };

  let gymCount = 0;
  /** A gym on a live plan with one member; its hours are unset and its own switch is on,
   *  so before this job the member's tap was taken at any hour. */
  const makeGym = async () => {
    const owner = await signIn(`owner-${String(++gymCount)}`);
    const res = await send(need(off), "POST", "/v1/orgs", owner.cookies, {
      name: `Tap Gym ${String(gymCount)}`,
      city: "Leeds",
      country: "GB",
      timezone: "Europe/London",
      trainsHere: false,
    });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${PLAN}), 'trialing', 'pilot')`;
    const member = await signIn(`member-${String(gymCount)}`);
    await sql`INSERT INTO gym_members (gym_id, user_id, consent_at) VALUES (${id}, ${member.userId}, now())`;
    return { id, owner, member };
  };

  const visits = async (gymId: string) =>
    (await sql<{ method: string }[]>`SELECT method FROM gym_attendance WHERE gym_id = ${gymId}`).map((row) => row.method);
  const streakRows = async (userId: string) =>
    (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM streaks WHERE user_id = ${userId}`)[0]?.n ?? -1;

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval,
                         seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 0, 'GBP', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)`;
    const overrides = {
      emailSender: {
        sendVerificationEmail: () => Promise.resolve(),
        sendPasswordResetEmail: () => Promise.resolve(),
        sendSignInCodeEmail: (to: string, code: string) => {
          signInCodes.set(to.toLowerCase(), code);
          return Promise.resolve();
        },
      },
    };
    off = await buildApp(loadConfig(baseEnv), overrides);
    on = await buildApp(loadConfig({ ...baseEnv, MEMBER_TAP: "on" }), overrides);
    await need(off).ready();
    await need(on).ready();
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await off?.close();
    await on?.close();
    await sql.end({ timeout: 5 });
  }, HOOK_TIMEOUT_MS);

  it(
    "a member's tap from anywhere is refused: no visit is written and no streak day is made",
    async () => {
      const gym = await makeGym();
      expect((await sql<{ on: boolean }[]>`SELECT manual_attendance_enabled AS on FROM gyms WHERE id = ${gym.id}`)[0]?.on).toBe(true);

      const tapped = await send(need(off), "POST", `/v1/orgs/${gym.id}/attendance`, gym.member.cookies, {});
      expect(tapped.statusCode, tapped.body).toBe(410);
      expect((JSON.parse(tapped.body) as { error: string }).error).toBe("member_tap_retired");

      expect(await visits(gym.id)).toEqual([]);
      expect(await streakRows(gym.member.userId)).toBe(0);
      // And the member's own history says the same.
      const history = await send(need(off), "GET", `/v1/orgs/${gym.id}/attendance/history`, gym.member.cookies);
      expect(history.statusCode, history.body).toBe(200);
      expect((JSON.parse(history.body) as { attendance: { visits: unknown[] } }).attendance.visits).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the tap answers 410 to the member, the owner, a stranger and somebody signed out, with or without a body",
    async () => {
      const gym = await makeGym();
      const stranger = await signIn("stranger");
      const people: [string, Record<string, string>][] = [
        ["member", gym.member.cookies],
        ["owner", gym.owner.cookies],
        ["stranger", stranger.cookies],
        ["signed out", {}],
      ];
      const answers: string[] = [];
      for (const [who, cookies] of people) {
        for (const payload of [{}, undefined, { day: "2026-01-01" }]) {
          const res = await send(need(off), "POST", `/v1/orgs/${gym.id}/attendance`, cookies, payload);
          const error = res.statusCode === 410 ? (JSON.parse(res.body) as { error: string }).error : res.body;
          answers.push(`${who}: ${String(res.statusCode)} ${error}`);
        }
      }
      expect(answers).toEqual(answers.map((line) => line.replace(/: .*$/, ": 410 member_tap_retired")));
      expect(answers).toHaveLength(12);
      expect(await visits(gym.id)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "with the switch on, the same tap is taken and writes one visit",
    async () => {
      const gym = await makeGym();
      const tapped = await send(need(on), "POST", `/v1/orgs/${gym.id}/attendance`, gym.member.cookies, {});
      expect(tapped.statusCode, tapped.body).toBe(200);
      expect(await visits(gym.id)).toEqual(["manual"]);
    },
    TEST_TIMEOUT_MS,
  );
});
