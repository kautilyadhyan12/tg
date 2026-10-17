// How fast, and how many, gyms one person can create (ROADMAP Stage 3 item 2g; Kd, 2026-10-17),
// against real Postgres. Five an hour per account and twenty an hour per address; ten gyms that
// never paid per owner, a paid gym never counting.
//
// THE WORST THING THIS JOB COULD DO: refuse a real owner their gym. The first test is that.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { UNPAID_GYMS_PER_OWNER } from "../src/modules/orgs/service.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const SUPPORT = "help@gmail.com";
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "gymlimits-test-secret-0123456789ab", // dummy test value, gitleaks:allow
  SUPPORT_EMAIL: SUPPORT,
};
const TIMEOUT_MS = 60_000;

type App = Awaited<ReturnType<typeof buildApp>>;
type Account = { userId: string; cookies: Record<string, string> };
type Res = Awaited<ReturnType<App["inject"]>>;

let ipCounter = 0;
const nextIp = () => `10.31.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const TAG = "gymlimits";
const run = String(Date.now() % 1_000_000);
const TOO_FAST = "Too many gyms or studios have been created from here in the last hour. Please try again in an hour.";
const AT_LIMIT = `You already have 10 gyms or studios with no paid plan. Choose a plan for one of them to create another. To add more without a plan, write to us at ${SUPPORT}.`;

d("creating gyms: how fast and how many (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const people = sql`SELECT id FROM users WHERE email ILIKE ${`${TAG}%`}`;
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (${people})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_codes WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE id IN (${people})`;
  };

  beforeAll(async () => {
    await cleanup();
    app = await buildApp(loadConfig(baseEnv));
  }, TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end();
  }, TIMEOUT_MS);

  let personSeq = 0;
  /** A person with a confirmed address, signed in. */
  const makeOwner = async (): Promise<Account> => {
    const email = `${TAG}${run}p${String(personSeq++)}@gmail.com`;
    const reg = await api().inject({
      method: "POST",
      url: "/v1/auth/register",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email, password: PASSWORD, displayName: "Gym Limits" }),
    });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await sql`
      INSERT INTO one_time_tokens (user_id, purpose, token_hash, expires_at, used_at)
      VALUES (${userId}, 'verify_email', md5(random()::text) || md5(random()::text), now(), now())`;
    const login = await api().inject({
      method: "POST",
      url: "/v1/auth/login",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email, password: PASSWORD }),
    });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: Object.fromEntries(login.cookies.map((c) => [c.name, c.value])) };
  };

  let gymSeq = 0;
  /** The New gym page's Create, from `ip` (a fresh address unless one is given). */
  const create = (owner: Account, ip?: string): Promise<Res> =>
    api().inject({
      method: "POST",
      url: "/v1/orgs",
      remoteAddress: ip ?? nextIp(),
      headers: { "content-type": "application/json" },
      cookies: owner.cookies,
      payload: JSON.stringify({
        trainsHere: false,
        name: `Gym Limits ${run} ${String(gymSeq++)}`,
        city: "Pune",
        country: "IN",
        timezone: "Asia/Kolkata",
      }),
    });
  const body = (res: Res) => JSON.parse(res.body) as { error?: string; message?: string };
  const gymsOf = async (owner: Account) =>
    (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gyms WHERE owner_user_id = ${owner.userId}`)[0]?.n ?? 0;
  /** Gyms the owner made earlier, written straight in, so the hourly limit is not spent on them. */
  const earlierGyms = async (owner: Account, n: number): Promise<string[]> => {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const rows = await sql<{ id: string }[]>`
        INSERT INTO gyms (slug, name, city, country, owner_user_id)
        VALUES (${`${TAG}-${run}-${String(gymSeq)}`}, ${`Gym Limits ${run} ${String(gymSeq)}`}, 'Pune', 'IN', ${owner.userId})
        RETURNING id`;
      gymSeq++;
      const row = rows[0];
      if (row === undefined) throw new Error("no gym row");
      ids.push(row.id);
    }
    return ids;
  };
  let subSeq = 0;
  /** A gym paid through Paddle: the database's trigger stamps `paid_at`. */
  const paid = async (gymId: string) => {
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider, provider_ref, current_period_end)
      SELECT 'gym', ${gymId}, id, 'active', 'paddle', ${`sub_${TAG}_${run}_${String(subSeq++)}`}, now() + INTERVAL '20 days'
      FROM plans WHERE trial_days > 0 ORDER BY code LIMIT 1`;
    const stamped = await sql<{ paid: boolean }[]>`
      SELECT paid_at IS NOT NULL AS paid FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gymId} AND provider = 'paddle'`;
    expect(stamped[0]?.paid).toBe(true);
  };

  it(
    "WORST THING: a real owner's first gym is created, at an address many others have used this hour, and with paid gyms of their own",
    async () => {
      // Nineteen gyms from one address this hour, by four other owners.
      const shared = nextIp();
      for (let i = 0; i < 4; i++) {
        const other = await makeOwner();
        for (let k = 0; k < (i === 3 ? 4 : 5); k++) expect((await create(other, shared)).statusCode).toBe(201);
      }
      const owner = await makeOwner();
      const first = await create(owner, shared);
      expect(first.statusCode, first.body).toBe(201);

      // An owner of many paid gyms and nine unpaid ones still creates the tenth.
      const chain = await makeOwner();
      for (const gym of await earlierGyms(chain, 15)) await paid(gym);
      await earlierGyms(chain, UNPAID_GYMS_PER_OWNER - 1);
      const tenth = await create(chain);
      expect(tenth.statusCode, tenth.body).toBe(201);
      expect(await gymsOf(chain)).toBe(15 + UNPAID_GYMS_PER_OWNER);
    },
    TIMEOUT_MS,
  );

  it(
    "an account's sixth gym in an hour is refused with what to do, and another account at that address is not",
    async () => {
      const owner = await makeOwner();
      const ip = nextIp();
      for (let i = 0; i < 5; i++) expect((await create(owner, ip)).statusCode).toBe(201);
      // From a new address too: the account's own count is what refuses it.
      const sixth = await create(owner);
      expect(sixth.statusCode).toBe(429);
      expect(body(sixth)).toMatchObject({ error: "rate_limited", message: TOO_FAST });
      expect(await gymsOf(owner)).toBe(5);

      const neighbour = await makeOwner();
      expect((await create(neighbour, ip)).statusCode).toBe(201);
    },
    TIMEOUT_MS,
  );

  it(
    "forms refused for a mistake do not use up the hour: only gyms created count",
    async () => {
      const owner = await makeOwner();
      const ip = nextIp();
      const press = (payload: object) =>
        api().inject({
          method: "POST",
          url: "/v1/orgs",
          remoteAddress: ip,
          headers: { "content-type": "application/json" },
          cookies: owner.cookies,
          payload: JSON.stringify({ trainsHere: false, city: "Pune", timezone: "Asia/Kolkata", ...payload }),
        });
      for (let i = 0; i < 25; i++) {
        // A blank name, a mistyped mobile, a country we are not open in: each refused, none counted.
        const bad = [{ name: "", country: "IN" }, { name: "Gym Limits Typo", country: "IN", billingMobile: "12345" }, { name: "Gym Limits Typo", country: "AU" }][i % 3];
        expect((await press(bad ?? {})).statusCode).toBe(400);
      }
      for (let i = 0; i < 5; i++) expect((await create(owner, ip)).statusCode).toBe(201);
      expect((await create(owner, ip)).statusCode).toBe(429);
    },
    TIMEOUT_MS,
  );

  it(
    "an address's twenty-first gym in an hour is refused, whoever creates it, and another address is not",
    async () => {
      const ip = nextIp();
      for (let i = 0; i < 4; i++) {
        const owner = await makeOwner();
        for (let k = 0; k < 5; k++) expect((await create(owner, ip)).statusCode).toBe(201);
      }
      const fifth = await makeOwner();
      const refused = await create(fifth, ip);
      expect(refused.statusCode).toBe(429);
      expect(body(refused).message).toBe(TOO_FAST);
      expect(await gymsOf(fifth)).toBe(0);
      expect((await create(fifth)).statusCode).toBe(201);
    },
    TIMEOUT_MS,
  );

  it(
    "an owner's eleventh gym with no paid plan is refused with what to do; once one of them pays, it is created",
    async () => {
      const owner = await makeOwner();
      const gyms = await earlierGyms(owner, UNPAID_GYMS_PER_OWNER);
      const refused = await create(owner);
      expect(refused.statusCode).toBe(403);
      expect(body(refused)).toMatchObject({ error: "unpaid_gym_limit", message: AT_LIMIT });
      expect(await gymsOf(owner)).toBe(UNPAID_GYMS_PER_OWNER);

      // A gym on its free trial, or whose plan never took a payment, still counts as unpaid.
      await sql`
        INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider, trial_ends_at)
        SELECT 'gym', ${gyms[0] ?? ""}, id, 'trialing', 'none', now() + INTERVAL '10 days'
        FROM plans WHERE trial_days > 0 ORDER BY code LIMIT 1`;
      expect((await create(owner)).statusCode).toBe(403);

      await paid(gyms[1] ?? "");
      const created = await create(owner);
      expect(created.statusCode, created.body).toBe(201);
      expect(await gymsOf(owner)).toBe(UNPAID_GYMS_PER_OWNER + 1);
      // And it is the eleventh gym, ten of them unpaid again: the next is refused.
      expect((await create(owner)).statusCode).toBe(403);
    },
    TIMEOUT_MS,
  );

  it(
    "two presses at once at nine unpaid gyms create one gym, not two",
    async () => {
      const owner = await makeOwner();
      await earlierGyms(owner, UNPAID_GYMS_PER_OWNER - 1);
      const both = await Promise.all([create(owner), create(owner), create(owner)]);
      expect(both.map((r) => r.statusCode).sort()).toEqual([201, 403, 403]);
      expect(await gymsOf(owner)).toBe(UNPAID_GYMS_PER_OWNER);
    },
    TIMEOUT_MS,
  );

  it(
    "an owner whose ten unpaid gyms belong to them is not stopped by somebody else's",
    async () => {
      const full = await makeOwner();
      await earlierGyms(full, UNPAID_GYMS_PER_OWNER);
      expect((await create(full)).statusCode).toBe(403);
      const stranger = await makeOwner();
      expect((await create(stranger)).statusCode).toBe(201);
    },
    TIMEOUT_MS,
  );
});
