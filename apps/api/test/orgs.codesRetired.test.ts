// JOIN CODES SWITCHED OFF (ROADMAP 3c; spec Part 3 §10.6), against REAL Postgres
// (DATABASE_URL-gated).
//
// The first block is the worst thing this job could do to a real person (CLAUDE.md §2.1):
// a code printed on a poster before the switch, or a request already waiting, still lets
// somebody into a gym. Then every retired route answers 410 to the owner, a member, a
// stranger and somebody signed out; a new gym gets no code; and the same routes with the
// switch on still work, so the 410 is the switch and not a broken route.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { paidPlacesUsed } from "../src/modules/orgs/repo.js";
import { ORGS_SWEEP_JOB, runJoinSweep, scheduleJoinSweep } from "../src/modules/orgs/joinSweepSchedule.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");
const redisUrl = process.env["TEST_REDIS_URL"];

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "codes-retired-secret-0123456789abc", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
const TEST_TIMEOUT_MS = 120_000;
const HOOK_TIMEOUT_MS = 60_000;

const PLAN = "zz_codes3c_live";
const DOMAIN = "codes3c-t.example.com";
const addr = (local: string) => `codes3c-t-${local}@${DOMAIN}`;

interface User {
  userId: string;
  email: string;
  cookies: Record<string, string>;
}

let ipCounter = 0;
const nextIp = () => `10.68.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

d("join codes switched off (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const signInCodes = new Map<string, string>();
  let off: App | undefined;
  let on: App | undefined;
  const need = (app: App | undefined): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const mine = () => sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'codes3c%')`;
  const cleanup = async () => {
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine()})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_codes WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine()})`;
    await sql`DELETE FROM gym_join_applications WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'codes3c%')`;
    await sql`DELETE FROM gym_members WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'codes3c%')`;
    await sql`DELETE FROM users WHERE email LIKE 'codes3c%'`;
    await sql`DELETE FROM sign_in_codes WHERE email LIKE 'codes3c%'`;
    await sql`DELETE FROM plans WHERE code = ${PLAN}`;
  };

  type Method = "GET" | "POST" | "PATCH" | "DELETE";
  const send = (app: App, method: Method, path: string, cookies: Record<string, string>, payload?: unknown) =>
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
    return { userId: user.id, email, cookies: cookieMap(res) };
  };

  let gymCount = 0;
  /** A gym on a live plan, created through the route on `app`. */
  const makeGym = async (app: App) => {
    const owner = await signIn(`owner-${String(++gymCount)}`);
    const res = await send(app, "POST", "/v1/orgs", owner.cookies, {
      name: `Codes Gym ${String(gymCount)}`,
      city: "Leeds",
      country: "GB",
      timezone: "Europe/London",
      trainsHere: false,
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = JSON.parse(res.body) as { org: { id: string }; joinCode: { code: string } | null };
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${body.org.id}, (SELECT id FROM plans WHERE code = ${PLAN}), 'trialing', 'pilot')`;
    return { id: body.org.id, owner, joinCode: body.joinCode };
  };

  /** A code a gym printed on a poster before the switch, still live in its table. */
  const oldPosterCode = async (gymId: string, code: string) => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO gym_codes (gym_id, code, label) VALUES (${gymId}, ${code}, 'Front Desk') RETURNING id`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("no code row");
    return id;
  };
  /** A request somebody sent with that code before the switch, still waiting. */
  const waitingRequest = async (gymId: string, codeId: string, who: User) => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO gym_join_applications (gym_id, user_id, code_id, status, expires_at)
      VALUES (${gymId}, ${who.userId}, ${codeId}, 'pending', now() + interval '14 days') RETURNING id`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("no application row");
    return id;
  };
  const memberships = async (gymId: string) =>
    (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_members WHERE gym_id = ${gymId}`)[0]?.n ?? -1;
  const requests = async (gymId: string) =>
    (await sql<{ status: string }[]>`SELECT status FROM gym_join_applications WHERE gym_id = ${gymId} ORDER BY applied_at`).map(
      (row) => row.status,
    );

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
    on = await buildApp(loadConfig({ ...baseEnv, JOIN_CODES: "on" }), overrides);
    await need(off).ready();
    await need(on).ready();
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await off?.close();
    await on?.close();
    await sql.end({ timeout: 5 });
  }, HOOK_TIMEOUT_MS);

  // =========================================================================
  // THE WORST THING: AN OLD POSTER CODE, OR A REQUEST ALREADY WAITING, LETS SOMEBODY IN
  // =========================================================================

  it(
    "a stranger with a code from an old poster is not let in, and staff cannot approve a request that was already waiting",
    async () => {
      const gym = await makeGym(need(off));
      const codeId = await oldPosterCode(gym.id, "QWE7RT");
      const waiting = await signIn("waiting");
      const requestId = await waitingRequest(gym.id, codeId, waiting);
      const stranger = await signIn("poster-stranger");

      const joined = await send(need(off), "POST", "/v1/orgs/join", stranger.cookies, { code: "QWE7RT", consent: true });
      expect(joined.statusCode, joined.body).toBe(410);
      expect((JSON.parse(joined.body) as { error: string }).error).toBe("join_codes_retired");

      const approved = await send(need(off), "POST", `/v1/orgs/${gym.id}/applications/${requestId}/confirm`, gym.owner.cookies);
      expect(approved.statusCode, approved.body).toBe(410);

      // Nobody became a member, nothing new is waiting, and no place was taken.
      expect(await memberships(gym.id)).toBe(0);
      expect(await requests(gym.id)).toEqual(["pending"]);
      expect(await paidPlacesUsed(sql, gym.id)).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // EVERY RETIRED ROUTE, TO EVERYBODY
  // =========================================================================

  it(
    "all eleven code and waiting-room routes answer 410 to the owner, a member, a stranger and somebody signed out",
    async () => {
      const gym = await makeGym(need(off));
      const codeId = await oldPosterCode(gym.id, "ZXC4VB");
      const member = await signIn("member");
      await sql`INSERT INTO gym_members (gym_id, user_id, consent_at) VALUES (${gym.id}, ${member.userId}, now())`;
      const stranger = await signIn("stranger");
      const requestId = await waitingRequest(gym.id, codeId, stranger);

      const routes: [Method, string, unknown][] = [
        ["POST", "/v1/orgs/join", { code: "ZXC4VB", consent: true }],
        ["GET", "/v1/orgs/applications/mine", undefined],
        ["POST", `/v1/orgs/applications/${requestId}/nudge`, {}],
        ["GET", `/v1/orgs/${gym.id}/applications`, undefined],
        ["POST", `/v1/orgs/${gym.id}/applications/${requestId}/confirm`, {}],
        ["POST", `/v1/orgs/${gym.id}/applications/${requestId}/reject`, {}],
        ["GET", `/v1/orgs/${gym.id}/codes`, undefined],
        ["POST", `/v1/orgs/${gym.id}/codes`, {}],
        ["PATCH", `/v1/orgs/${gym.id}/codes/ZXC4VB`, { paused: true }],
        ["POST", `/v1/orgs/${gym.id}/codes/ZXC4VB/rotate`, {}],
        ["DELETE", `/v1/orgs/${gym.id}/codes/ZXC4VB`, undefined],
      ];
      const people: [string, Record<string, string>][] = [
        ["owner", gym.owner.cookies],
        ["member", member.cookies],
        ["stranger", stranger.cookies],
        ["signed out", {}],
      ];
      const answers: string[] = [];
      for (const [method, path, payload] of routes) {
        for (const [who, cookies] of people) {
          const res = await send(need(off), method, path, cookies, payload);
          const error = res.statusCode === 410 ? (JSON.parse(res.body) as { error: string }).error : res.body;
          answers.push(`${method} ${path} as ${who}: ${String(res.statusCode)} ${error}`);
        }
      }
      expect(answers).toEqual(answers.map((line) => line.replace(/: .*$/, ": 410 join_codes_retired")));
      expect(answers).toHaveLength(44);

      // Nothing any of them did changed anything.
      expect(await memberships(gym.id)).toBe(1);
      expect(await requests(gym.id)).toEqual(["pending"]);
      const codes = await sql<{ code: string; paused: boolean; removed: boolean }[]>`
        SELECT code, paused, removed_at IS NOT NULL AS removed FROM gym_codes WHERE gym_id = ${gym.id}`;
      expect(codes).toEqual([{ code: "ZXC4VB", paused: false, removed: false }]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a new gym gets no code",
    async () => {
      const gym = await makeGym(need(off));
      expect(gym.joinCode).toBeNull();
      expect(await sql`SELECT 1 FROM gym_codes WHERE gym_id = ${gym.id}`).toHaveLength(0);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // THE SWITCH ON: THE SAME ROUTES WORK, SO THE 410 ABOVE IS THE SWITCH
  // =========================================================================

  it(
    "with the switch on, a new gym gets its code, the code's owner reads it, and a person can ask to join with it",
    async () => {
      const gym = await makeGym(need(on));
      const code = gym.joinCode?.code;
      if (code === undefined) throw new Error("a gym made with the switch on has no code");
      const read = await send(need(on), "GET", `/v1/orgs/${gym.id}/codes`, gym.owner.cookies);
      expect(read.statusCode, read.body).toBe(200);
      const asker = await signIn("asker");
      const joined = await send(need(on), "POST", "/v1/orgs/join", asker.cookies, { code });
      expect(joined.statusCode, joined.body).toBe(200);
      expect(await requests(gym.id)).toEqual(["pending"]);
    },
    TEST_TIMEOUT_MS,
  );
  // =========================================================================
  // THE WORKER: THE WAITING ROOM IS NEITHER CHASED NOR EXPIRED
  // =========================================================================

  it.skipIf(redisUrl === undefined || redisUrl === "")(
    "with the switch off, the sweep's schedule is taken out of a real Redis, and taking it out twice is fine",
    async () => {
      // A throwaway queue on Redis number 15, so the worker's own queue is never touched.
      const connection = new Redis(redisUrl ?? "", { db: 15, maxRetriesPerRequest: null });
      const queue = new Queue(`codes3c-sweep-${String(Date.now())}`, { connection });
      try {
        await scheduleJoinSweep(queue, true);
        expect((await queue.getJobSchedulers()).map((scheduler) => scheduler.key)).toEqual([ORGS_SWEEP_JOB]);
        expect(await queue.getDelayedCount()).toBe(1);

        await scheduleJoinSweep(queue, false);
        expect(await queue.getJobSchedulers()).toEqual([]);
        expect(await queue.getDelayedCount()).toBe(0);
        await expect(scheduleJoinSweep(queue, false)).resolves.toBeUndefined();
      } finally {
        await queue.obliterate({ force: true });
        await queue.close();
        await connection.quit();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "with the switch off, a sweep already queued leaves a request past its deadline waiting; with it on, the same request expires",
    async () => {
      const gym = await makeGym(need(off));
      const codeId = await oldPosterCode(gym.id, "SWP3CC");
      const waiting = await signIn("sweep-waiting");
      const requestId = await waitingRequest(gym.id, codeId, waiting);
      // Past its deadline, and the gym was told long enough ago: the sweep would expire it.
      await sql`
        UPDATE gym_join_applications
           SET expires_at = now() - interval '1 day', gym_notified_at = now() - interval '10 days'
         WHERE id = ${requestId}`;
      const log = { info: () => undefined };

      expect(await runJoinSweep({ sql, log }, false, { gymIds: [gym.id] })).toBeNull();
      expect(await requests(gym.id)).toEqual(["pending"]);

      const swept = await runJoinSweep({ sql, log }, true, { gymIds: [gym.id] });
      expect(swept?.expired).toBe(1);
      expect(await requests(gym.id)).toEqual(["expired"]);
    },
    TEST_TIMEOUT_MS,
  );
});
