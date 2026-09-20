// THE MEMBER LIST'S TWO GATES, ON A REAL REDIS — the one-file-per-gym reader gate and
// the shared-front-desk allowance (spec Part 3 §9.9, §9.10).
//
// **WHY THIS FILE EXISTS** (review of PR #87). Every other member-list suite builds its
// app with the in-memory Redis, so `incrWithTtl` and `decrIfPositive` run as plain
// JavaScript there and never as the Lua production runs. Both gates would stay green
// through a divergence between the two. `redis.scripts.test.ts` proves the scripts
// themselves; this proves the two gates that stand on them, at the door.
//
// It runs where TEST_REDIS_URL is set: `test:local` sets it (the compose Redis) and so
// does CI's database job.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createIoRedis } from "../src/redis.js";

const url = process.env["DATABASE_URL"];
const redisUrl = process.env["TEST_REDIS_URL"];
const d = describe.skipIf(url === undefined || url === "" || redisUrl === undefined || redisUrl === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const LIVE_PLAN = "zz_memberlist_redis";
const TEST_TIMEOUT_MS = 60_000;
/** One person, so the file is read quickly and the gate is what is measured. */
const FILE = Buffer.from(["Full Name,Email,Status", "Redis Person,redis-person@example.com,Active"].join("\r\n"), "utf8");
/** THE SHARED FRONT DESK: every request below comes from this ONE address, which is the
 *  whole point of the second test — and it is a DIFFERENT one every run.
 *
 *  Unlike the in-memory adapter, a real Redis keeps its counters for the window's whole
 *  hour, across runs and across machines. A fixed address meant the second run of the
 *  hour started part-way up the per-address allowance and the third ran out of it, so
 *  this file went red for a reason that had nothing to do with what it tests. The
 *  address is random per run; both members of staff still share it, which is the
 *  property being driven. */
const DESK = (() => {
  const bytes = randomUUID().replaceAll("-", "");
  return `10.88.${String(parseInt(bytes.slice(0, 2), 16))}.${String(parseInt(bytes.slice(2, 4), 16) % 254 + 1)}`;
})();

d("the reader gate and the front desk's allowance, on a real Redis", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 3 });
  type App = Awaited<ReturnType<typeof buildApp>>;
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms WHERE owner_user_id IN
        (SELECT id FROM users WHERE email LIKE 'mredis-t-%@example.com')`;
    await sql`DELETE FROM gym_member_list_uploads WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'mredis-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval,
                         seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month',
              100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    // THE REAL CLIENT, not the in-memory one: this is the whole point of the file.
    const redis = createIoRedis(redisUrl ?? "");
    for (let tries = 0; (await redis.incrWithTtl(`mredis-ready:${randomUUID()}`, 30)) === null; tries++) {
      if (tries === 100) throw new Error("createIoRedis never connected to TEST_REDIS_URL");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    app = await buildApp(
      loadConfig({
        NODE_ENV: "test",
        DATABASE_URL: url ?? "",
        WEB_ORIGIN: "http://localhost:5173",
        JWT_SECRET: "memberlist-redis-secret-01234567", // dummy test value, gitleaks:allow
        LOG_LEVEL: "error",
      }),
      { redis },
    );
    await api().ready();
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, TEST_TIMEOUT_MS);

  const post = (path: string, payload: unknown, cookies: Record<string, string> = {}) =>
    api().inject({
      method: "POST",
      url: path,
      remoteAddress: DESK,
      headers: { "content-type": "application/json" },
      cookies,
      payload: JSON.stringify(payload),
    });

  const makeUser = async (local: string) => {
    const email = `mredis-t-${local}-${randomUUID().slice(0, 8)}@example.com`;
    expect((await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Redis ${local}` })).statusCode).toBe(201);
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { email, cookies: Object.fromEntries(login.cookies.map((c) => [c.name, c.value])) };
  };

  it(
    "one gym's two files at once: one is read, the other waits — and the gate is released afterwards",
    async () => {
      const owner = await makeUser("gate-owner");
      const made = await post("/v1/orgs", { name: "Redis Gate Gym", city: "Leeds", country: "GB", timezone: "Europe/London" }, owner.cookies);
      expect(made.statusCode).toBe(201);
      const gymId = (JSON.parse(made.body) as { org: { id: string } }).org.id;
      await sql`
        INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
        VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;

      const send = () =>
        post(`/v1/orgs/${gymId}/member-list/uploads`, { contentBase64: FILE.toString("base64"), mode: "whole_list" }, owner.cookies);
      const both = await Promise.all([send(), send()]);
      expect(both.map((r) => r.statusCode).sort()).toEqual([201, 429]);
      expect(JSON.parse(both.find((r) => r.statusCode === 429)?.body ?? "{}")).toMatchObject({ error: "busy" });

      // RELEASED, not merely expired: the next file goes straight through rather than
      // waiting out the gate's sixteen-second window. On the in-memory adapter a
      // `decrIfPositive` that never ran would look identical for sixteen seconds.
      expect((await send()).statusCode).toBe(201);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the front desk's allowance is per person, counted by the real Lua",
    async () => {
      const owner = await makeUser("desk-owner");
      const made = await post("/v1/orgs", { name: "Redis Desk Gym", city: "Leeds", country: "GB", timezone: "Europe/London" }, owner.cookies);
      expect(made.statusCode).toBe(201);
      const gymId = (JSON.parse(made.body) as { org: { id: string } }).org.id;
      await sql`
        INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
        VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
      // The colleague joins the gym first: the staff route looks people up on the gym's
      // OWN roster by email, never across every account, so that it cannot be used to
      // ask whether a stranger has one.
      const code = (JSON.parse(made.body) as { joinCode: { code: string } }).joinCode.code;
      const second = await makeUser("desk-second");
      const applied = await post("/v1/orgs/join", { code }, second.cookies);
      expect(applied.statusCode).toBe(200);
      const applicationId = (JSON.parse(applied.body) as { application?: { id: string } }).application?.id;
      if (applicationId === undefined) throw new Error("apply returned no application");
      expect((await post(`/v1/orgs/${gymId}/applications/${applicationId}/confirm`, {}, owner.cookies)).statusCode).toBe(200);
      expect(
        (await post(`/v1/orgs/${gymId}/staff`, { email: second.email, role: "manager" }, owner.cookies)).statusCode,
      ).toBe(201);

      // Bodies that are not files: the limiter sits after the privilege gate and before
      // anything is decoded, so this counts requests without reading a spreadsheet.
      const tap = (cookies: Record<string, string>) =>
        post(`/v1/orgs/${gymId}/member-list/uploads`, { contentBase64: "!!!!", mode: "whole_list" }, cookies);
      const owners: number[] = [];
      for (let n = 0; n < 12; n++) owners.push((await tap(owner.cookies)).statusCode);
      expect(owners).toEqual(Array.from({ length: 12 }, () => 400));
      expect((await tap(owner.cookies)).statusCode).toBe(429);
      // The colleague at the SAME desk still has their own allowance — the ceiling per
      // address is 40, not 12 (§9.9), and this is the class this repo has been caught
      // by before.
      expect((await tap(second.cookies)).statusCode).toBe(400);
    },
    TEST_TIMEOUT_MS,
  );
});
