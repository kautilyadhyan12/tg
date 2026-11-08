// The admin page (ROADMAP Stage 2 item 14a-i) against the local Postgres.
//
// THE WORST THING THIS JOB COULD DO (its plan, Kd's yes 2026-11-08): somebody who is not Kd reads
// everyone's name and email, or gives themselves more scans. So the first test: a signed-out
// visitor, a stranger, a gym owner and a gym's staff each meet the not-found reply at every admin
// address, the same reply as an address that does not exist, and nobody's numbers change.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { seed } from "../src/db/seed.js";
import { createMemoryRedis } from "../src/redis.js";
import { quotaKey, refundUse, requireQuota, type CountedUse } from "../src/modules/quotas/service.js";
import { createDoorPassword } from "../src/modules/admin/repo.js";
import { saveMinutes } from "../src/modules/appMinutes/repo.js";
import { getEntitlements } from "../src/modules/entitlements/service.js";
import type { EmailSender } from "../src/modules/auth/email.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "admin-test-secret-0123456789abcdef-32", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};
const PREFIX = "a14i-";
const BULK = "a14ibulk";

type App = Awaited<ReturnType<typeof buildApp>>;

/** Keeps every sign-in code sent, with its address. */
function capturingSender(): EmailSender & { sent: { email: string; code: string }[] } {
  const sent: { email: string; code: string }[] = [];
  return {
    sent,
    sendVerificationEmail: () => Promise.resolve(),
    sendPasswordResetEmail: () => Promise.resolve(),
    sendSignInCodeEmail: (email, code) => {
      sent.push({ email, code });
      return Promise.resolve();
    },
  };
}
type Person = { userId: string; access: string };

d("the admin page (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  const sender = capturingSender();
  let setup: App | undefined; // no admin named: signs the fixtures in
  let app: App | undefined; // ADMIN_USER_ID = the admin fixture
  let admin: Person = { userId: "", access: "" };
  let stranger: Person = { userId: "", access: "" };
  let owner: Person = { userId: "", access: "" };
  let staff: Person = { userId: "", access: "" };
  let member: Person = { userId: "", access: "" };
  let payer: Person = { userId: "", access: "" };
  let gone = "";
  let adminDoor = "";
  const ADMIN_PASSWORD = "a-long-admin-door-pw-1"; // dummy fixture, gitleaks:allow

  const must = (a: App | undefined): App => {
    if (a === undefined) throw new Error("beforeAll did not build the app");
    return a;
  };
  const call = (a: App, opts: { method?: "GET" | "PUT" | "POST"; url: string; body?: unknown; access?: string; door?: string; ip?: string }) =>
    a.inject({
      method: opts.method ?? "GET",
      url: opts.url,
      ...(opts.ip === undefined ? {} : { remoteAddress: opts.ip }),
      headers: opts.body !== undefined ? { "content-type": "application/json" } : {},
      cookies: {
        ...(opts.access !== undefined && opts.access !== "" ? { accessToken: opts.access } : {}),
        ...(opts.door !== undefined && opts.door !== "" ? { adminDoor: opts.door } : {}),
      },
      ...(opts.body !== undefined ? { payload: JSON.stringify(opts.body) } : {}),
    });
  const asAdmin = (opts: { method?: "GET" | "PUT" | "POST"; url: string; body?: unknown }) => call(must(app), { ...opts, access: admin.access, door: adminDoor });
  const doorOf = (res: { cookies: { name: string; value: string }[] }): string => res.cookies.find((c) => c.name === "adminDoor")?.value ?? "";

  /** Each fixture person signs up from an address of their own: sign-up's per-address limit is not what is tested. */
  let signUps = 0;
  const session = async (email: string, name: string): Promise<Person> => {
    const a = must(setup);
    signUps += 1;
    const ip = `10.14.2.${String(signUps)}`;
    const reg = await call(a, { method: "POST", url: "/v1/auth/register", body: { email, password: PASSWORD, displayName: name }, ip });
    if (reg.statusCode !== 201) throw new Error(`register failed: ${reg.body}`);
    const { userId } = reg.json<{ userId: string }>();
    const login = await call(a, { method: "POST", url: "/v1/auth/login", body: { email, password: PASSWORD }, ip });
    return { userId, access: login.cookies.find((c) => c.name === "accessToken")?.value ?? "" };
  };
  /** A second sign-in of the admin with an account password, as an old account might still have:
   *  the code sign-in ended the first one, so the stranger's hash of the same fixture password is
   *  put back first. */
  const passwordLogin = async () => {
    await sql`UPDATE users SET (password_hash, hash_algo) = (SELECT password_hash, hash_algo FROM users WHERE id = ${stranger.userId}) WHERE id = ${admin.userId}`;
    return await call(must(app), { method: "POST", url: "/v1/auth/login", body: { email: `${PREFIX}admin@example.com`, password: PASSWORD } });
  };
  const planId = async (code: string): Promise<string> => {
    const rows = await sql<{ id: string }[]>`SELECT id FROM plans WHERE code = ${code}`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error(`plan ${code} not seeded`);
    return id;
  };
  const mealScan = async (p: Person) =>
    (await call(must(app), { url: "/v1/entitlements/me", access: p.access })).json<{ entitlements: { meal_scan: unknown; route_gen: unknown } }>().entitlements;
  const limitsRows = async () =>
    await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM usage_limits l JOIN users u ON u.id = l.user_id WHERE u.email LIKE ${`${PREFIX}%`}`;
  const audits = async (target: string) =>
    await sql<{ actor_user_id: string; meta: { feature: string; from: number | null; to: number | null } }[]>`
      SELECT actor_user_id, meta FROM audit_log WHERE action = 'admin.usage_limit_set' AND target_id = ${target} ORDER BY id`;

  const clean = async () => {
    const mine = sql`SELECT id FROM users WHERE email LIKE ${`${PREFIX}%`} OR email LIKE ${`${BULK}%`}`;
    await sql`DELETE FROM audit_log WHERE action LIKE 'admin.%' AND target_id IN (SELECT id::text FROM users WHERE email LIKE ${`${PREFIX}%`})`;
    await sql`DELETE FROM subscriptions WHERE owner_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_id IN (SELECT id FROM gyms WHERE slug = 'a14i-gym')`;
    await sql`DELETE FROM subscriptions WHERE owner_id IN (SELECT id FROM gyms WHERE slug = 'a14i-gym-old')`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (SELECT id FROM gyms WHERE slug IN ('a14i-gym', 'a14i-gym-old'))`;
    await sql`DELETE FROM gyms WHERE slug = 'a14i-gym-old'`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (SELECT id FROM gyms WHERE slug = 'a14i-gym')`;
    await sql`DELETE FROM gyms WHERE slug = 'a14i-gym'`;
    await sql`DELETE FROM refresh_tokens WHERE user_id IN (${mine})`;
    await sql`DELETE FROM api_cost_events WHERE user_id IN (${mine})`;
    await sql`DELETE FROM sign_in_codes WHERE email LIKE ${`${PREFIX}%`}`;
    await sql`DELETE FROM users WHERE email LIKE ${`${PREFIX}%`} OR email LIKE ${`${BULK}%`}`;
  };

  beforeAll(async () => {
    await seed(url ?? "");
    await clean();
    setup = await buildApp(loadConfig(baseEnv), { redis, emailSender: sender });
    admin = await session(`${PREFIX}admin@example.com`, "A14i Admin");
    stranger = await session(`${PREFIX}stranger@example.com`, "A14i Stranger");
    owner = await session(`${PREFIX}owner@example.com`, "A14i Owner");
    staff = await session(`${PREFIX}staff@example.com`, "A14i Staff");
    member = await session(`${PREFIX}member@example.com`, "A14i Member");
    payer = await session(`${PREFIX}payer@example.com`, "A14i Payer");
    const goneRows = await sql<{ id: string }[]>`
      INSERT INTO users (email, display_name, status, deleted_at) VALUES (${`${PREFIX}gone@example.com`}, 'A14i Gone', 'deleted', now()) RETURNING id`;
    gone = goneRows[0]?.id ?? "";
    const gymRows = await sql<{ id: string }[]>`INSERT INTO gyms (slug, name, owner_user_id) VALUES ('a14i-gym', 'A14i Gym', ${owner.userId}) RETURNING id`;
    const gymId = gymRows[0]?.id ?? "";
    await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gymId}, ${owner.userId}, 'owner'), (${gymId}, ${staff.userId}, 'manager')`;
    await sql`INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider) VALUES ('gym', ${gymId}, ${await planId("org_b1_us_m")}, 'trialing', 'pilot')`;
    await sql`INSERT INTO gym_members (gym_id, user_id) VALUES (${gymId}, ${member.userId})`;
    await sql`INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider) VALUES ('user', ${payer.userId}, ${await planId("pro_us_m")}, 'active', 'pilot')`;
    app = await buildApp(loadConfig({ ...baseEnv, ADMIN_USER_ID: admin.userId }), { redis, emailSender: sender });
    const a = must(app);
    a.get("/test/a14i/meal", { preHandler: [a.authenticate, requireQuota("meal_scan", { sql, redis })] }, async (_q, r) => r.send({ ok: true }));
    a.get("/test/a14i/route", { preHandler: [a.authenticate, requireQuota("route_gen", { sql, redis })] }, async (_q, r) => r.send({ ok: true }));
    // A scan that fails through no fault of the person's, as the scanner's own refusals do: its use is given back.
    const failed = new Map<string, CountedUse>();
    a.get("/test/a14ii/meal-fails", { preHandler: [a.authenticate, requireQuota("meal_scan", { sql, redis }, (q, use) => failed.set(q.id, use))] }, async (q, r) => {
      const use = failed.get(q.id);
      const userId = q.authUser?.id;
      if (use === undefined || userId === undefined) throw new Error("the meter did not run");
      return r.status(503).send({ given: await refundUse({ sql, redis, log: q.log }, userId, use) });
    });
    // A use counted for somebody whose use cannot be written down (no account row).
    const nobodyIn = async (q: { authUser?: { id: string; familyId: string | null } }) => {
      q.authUser = { id: "00000000-0000-4000-8000-0000000014a2", familyId: null };
      await Promise.resolve();
    };
    a.get("/test/a14ii/meal-nobody", { preHandler: [nobodyIn, requireQuota("meal_scan", { sql, redis })] }, async (_q, r) => r.send({ ok: true }));
    // The admin signs in as the door asks: an emailed code (the password sign-in above opens nothing).
    const adminEmail = `${PREFIX}admin@example.com`;
    const sent = await call(a, { method: "POST", url: "/v1/auth/code/send", body: { email: adminEmail } });
    if (sent.statusCode !== 200) throw new Error("code send: " + sent.body);
    const code = [...sender.sent].reverse().find((c) => c.email === adminEmail)?.code ?? "";
    const verified = await call(a, { method: "POST", url: "/v1/auth/code/verify", body: { email: adminEmail, code } });
    admin = { userId: admin.userId, access: verified.cookies.find((c) => c.name === "accessToken")?.value ?? "" };
    // The admin's first password, from a sign-in a moment old: the door opens.
    const made = await call(a, { method: "POST", url: "/v1/admin/door/password", body: { password: ADMIN_PASSWORD }, access: admin.access });
    if (made.statusCode !== 200) throw new Error("door password: " + made.body);
    adminDoor = made.cookies.find((c) => c.name === "adminDoor")?.value ?? "";
  }, 180_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    if (setup !== undefined) await setup.close();
    await clean();
    await sql.end({ timeout: 5 });
  });

  const ADDRESSES = (target: string) => [
    { method: "GET" as const, url: "/v1/admin/door" },
    { method: "POST" as const, url: "/v1/admin/door/password", body: { password: "a-stranger-s-password" } },
    { method: "POST" as const, url: "/v1/admin/door/open", body: { password: "a-stranger-s-password" } },
    { method: "POST" as const, url: "/v1/admin/door/lock" },
    { method: "GET" as const, url: "/v1/admin/people" },
    { method: "GET" as const, url: `/v1/admin/people?search=${PREFIX}` },
    { method: "PUT" as const, url: "/v1/admin/limits", body: { userIds: [target], feature: "meal_scan", perDay: 100 } },
    { method: "PUT" as const, url: "/v1/admin/limits", body: { userIds: [target], feature: "route_gen", perDay: 100 } },
    { method: "GET" as const, url: `/v1/admin/people/${target}/days?zone=UTC` },
    { method: "GET" as const, url: `/v1/admin/people/${target}/days?zone=UTC&before=2026-11-01` },
    { method: "GET" as const, url: "/v1/admin/days/2026-11-08?zone=UTC" },
    { method: "GET" as const, url: "/v1/admin/days/2026-11-08?zone=UTC&from=50" },
  ];

  /** What a caller can tell apart: the status, the body with its address taken out, and which headers came. */
  const seen = (res: { statusCode: number; body: string; headers: Record<string, unknown> }, url: string) => {
    const unknownUrl = url.replace("/v1/admin/", "/v1/admin/none/");
    const read = (body: string) => body.replaceAll(unknownUrl, "<url>").replaceAll(url, "<url>").replace(/"requestId":"[^"]*"/, "");
    return { status: res.statusCode, body: read(res.body), headers: Object.keys(res.headers).sort() };
  };

  it("WORST THING: nobody but the admin reads or changes anything; each meets the not-found reply", { timeout: 60_000 }, async () => {
    const callers = [
      { who: "signed out", p: { userId: stranger.userId, access: "" } },
      { who: "a stranger", p: stranger },
      { who: "a gym owner", p: owner },
      { who: "a gym's staff", p: staff },
      { who: "a gym member", p: member },
    ];
    for (const { who, p } of callers) {
      for (const address of ADDRESSES(p.userId)) {
        // Even holding the admin's own open door, nobody else gets in.
        const res = await call(must(app), { ...address, access: p.access, door: adminDoor });
        const unknown = await call(must(app), { method: address.method, url: address.url.replace("/v1/admin/", "/v1/admin/none/"), access: p.access, ...(address.body === undefined ? {} : { body: address.body }) });
        expect({ who, url: address.url, status: res.statusCode }).toEqual({ who, url: address.url, status: 404 });
        expect(res.json<{ error: string }>().error).toBe("not_found");
        expect(res.json<{ message: string }>().message).toBe(`Route ${address.method}:${address.url} not found`);
        expect(seen(res, address.url)).toEqual(seen(unknown, address.url));
        expect(res.body).not.toContain("@example.com");
      }
      // Sent as a form, or with a body that does not read: still exactly an address that does not exist.
      for (const raw of [
        { headers: { "content-type": "application/x-www-form-urlencoded" }, payload: "password=a-stranger-s-password" },
        { headers: { "content-type": "application/json" }, payload: "{not json" },
      ]) {
        for (const path of ["/v1/admin/door/open", "/v1/admin/door/password"]) {
          const send = (url: string) => must(app).inject({ method: "POST", url, ...raw, cookies: p.access === "" ? {} : { accessToken: p.access } });
          const res = await send(path);
          const unknown = await send(path.replace("/v1/admin/", "/v1/admin/none/"));
          expect({ who, path, type: raw.headers["content-type"], got: seen(res, path) }).toEqual({ who, path, type: raw.headers["content-type"], got: seen(unknown, path) });
        }
      }
    }
    expect((await limitsRows())[0]?.n).toBe(0);
    // Nothing behind the check ran for them: their Lock presses, holding the admin's door, did not close it.
    expect((await asAdmin({ url: "/v1/admin/door" })).json<{ open: boolean }>().open).toBe(true);
    expect(await sql`SELECT 1 FROM admin_passwords WHERE user_id <> ${admin.userId} AND user_id IN (SELECT id FROM users WHERE email LIKE ${`${PREFIX}%`})`).toHaveLength(0);
    expect((await mealScan(stranger)).meal_scan).toEqual({ window: "month", limit: 3 });
    expect((await mealScan(staff)).meal_scan).toEqual({ window: "month", limit: 3 });
  });

  it("WORST THING: with no admin named, even the would-be admin meets not-found; a signed-out session of the admin does too", { timeout: 60_000 }, async () => {
    const unnamed = await buildApp(loadConfig(baseEnv), { redis: createMemoryRedis() }); // its own: closing it empties its memory
    try {
      for (const address of ADDRESSES(admin.userId)) {
        expect((await call(unnamed, { ...address, access: admin.access, door: adminDoor })).statusCode).toBe(404);
      }
    } finally {
      await unnamed.close();
    }
    // A second sign-in of the admin, then signed out: its token still verifies, its session is over.
    const login = await passwordLogin();
    const access = login.cookies.find((c) => c.name === "accessToken")?.value ?? "";
    const refresh = login.cookies.find((c) => c.name === "refreshToken")?.value ?? "";
    expect((await call(must(app), { url: "/v1/admin/door", access })).statusCode).toBe(200);
    await must(app).inject({ method: "POST", url: "/v1/auth/logout", cookies: { accessToken: access, refreshToken: refresh } });
    expect((await call(must(app), { url: "/v1/admin/door", access })).statusCode).toBe(404);
    expect((await limitsRows())[0]?.n).toBe(0);
  });

  it("THE DOOR: the page is locked without the admin's own open door; only the hash is kept; 12 hours", { timeout: 60_000 }, async () => {
    const locked = await call(must(app), { url: "/v1/admin/people", access: admin.access });
    expect(locked.statusCode).toBe(403);
    expect(locked.json<{ error: string }>().error).toBe("admin_locked");
    expect(locked.body).not.toContain("@example.com");
    expect((await call(must(app), { method: "PUT", url: "/v1/admin/limits", access: admin.access, body: { userIds: [admin.userId], feature: "meal_scan", perDay: 100 } })).statusCode).toBe(403);
    expect((await call(must(app), { url: "/v1/admin/people", access: admin.access, door: "made-up-door" })).statusCode).toBe(403);
    expect((await limitsRows())[0]?.n).toBe(0);
    const state = await asAdmin({ url: "/v1/admin/door" });
    expect(state.headers["cache-control"]).toBe("no-store");
    const body = state.json<{ passwordSet: boolean; open: boolean; openUntil: string; fresh: boolean }>();
    expect(body).toMatchObject({ passwordSet: true, open: true, fresh: true });
    const hours = (new Date(body.openUntil).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(11.9);
    expect(hours).toBeLessThanOrEqual(12);
    const kept = await sql<{ password_hash: string }[]>`SELECT password_hash FROM admin_passwords WHERE user_id = ${admin.userId}`;
    expect(kept[0]?.password_hash).not.toContain(ADMIN_PASSWORD);
    expect((await asAdmin({ method: "POST", url: "/v1/admin/door/password", body: { password: "another-long-password" } })).statusCode).toBe(409);
  });

  it("THE DOOR: a short password is refused; a wrong one is refused and written down; the right one from a fresh sign-in opens it", { timeout: 60_000 }, async () => {
    await redis.del(`rl:admin_door:id:${admin.userId}`);
    expect((await call(must(app), { method: "POST", url: "/v1/admin/door/open", access: admin.access, body: { password: "short" } })).statusCode).toBe(400);
    const wrong = await call(must(app), { method: "POST", url: "/v1/admin/door/open", access: admin.access, body: { password: "not-the-admin-password" } });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json<{ error: string }>().error).toBe("wrong_password");
    expect(wrong.cookies.find((c) => c.name === "adminDoor")).toBeUndefined();
    expect(await sql`SELECT 1 FROM audit_log WHERE action = 'admin.door_wrong_password' AND actor_user_id = ${admin.userId}`).toHaveLength(1);
    const right = await call(must(app), { method: "POST", url: "/v1/admin/door/open", access: admin.access, body: { password: ADMIN_PASSWORD } });
    expect(right.statusCode).toBe(200);
    const cookie = right.cookies.find((c) => c.name === "adminDoor");
    expect(cookie).toMatchObject({ httpOnly: true, path: "/v1/admin", maxAge: 43_200 });
    expect((await call(must(app), { url: "/v1/admin/people", access: admin.access, door: cookie?.value ?? "" })).statusCode).toBe(200);
    // Opened again in the same session: the earlier key no longer opens it.
    expect((await asAdmin({ url: "/v1/admin/people" })).statusCode).toBe(403);
    adminDoor = cookie?.value ?? "";
  });

  it("THE DOOR: only a sign-in made with an emailed code is fresh: the account's password, however new, opens nothing", { timeout: 60_000 }, async () => {
    await redis.del(`rl:admin_door:id:${admin.userId}`);
    const login = await passwordLogin();
    const access = login.cookies.find((c) => c.name === "accessToken")?.value ?? "";
    expect((await call(must(app), { url: "/v1/admin/door", access })).json<{ fresh: boolean }>().fresh).toBe(false);
    const refused = await call(must(app), { method: "POST", url: "/v1/admin/door/open", access, body: { password: ADMIN_PASSWORD } });
    expect(refused.statusCode).toBe(403);
    expect(refused.json<{ error: string }>().error).toBe("fresh_code_needed");
    expect(refused.cookies.find((c) => c.name === "adminDoor")).toBeUndefined();
  });

  it("THE DOOR: another sign-in of the admin cannot use this one's door; 9 minutes old still opens, 11 does not; Lock clears its cookie", { timeout: 60_000 }, async () => {
    await redis.del(`rl:admin_door:id:${admin.userId}`);
    // A second sign-in, made fresh as a code sign-in is: a used code at the moment it began.
    const login = await passwordLogin();
    const access = login.cookies.find((c) => c.name === "accessToken")?.value ?? "";
    const family = (await sql<{ family_id: string; began: Date }[]>`
      SELECT family_id, min(created_at) AS began FROM refresh_tokens WHERE user_id = ${admin.userId} GROUP BY family_id ORDER BY began DESC LIMIT 1`)[0];
    if (family === undefined) throw new Error("no session");
    await sql`INSERT INTO sign_in_codes (email, purpose, code_hash, expires_at, used_at)
      VALUES (${`${PREFIX}admin@example.com`}, 'sign_in', 'not-a-real-hash', now() + interval '10 minutes', ${family.began})`;
    expect((await call(must(app), { url: "/v1/admin/people", access, door: adminDoor })).statusCode).toBe(403);
    const age = async (minutes: number) => {
      await sql`UPDATE refresh_tokens SET created_at = created_at - make_interval(mins => ${minutes}) WHERE user_id = ${admin.userId} AND family_id = ${family.family_id}`;
      await sql`UPDATE sign_in_codes SET used_at = used_at - make_interval(mins => ${minutes}) WHERE email = ${`${PREFIX}admin@example.com`} AND code_hash = 'not-a-real-hash'`;
    };
    await age(9);
    const opened = await call(must(app), { method: "POST", url: "/v1/admin/door/open", access, body: { password: ADMIN_PASSWORD } });
    expect(opened.statusCode).toBe(200);
    const door = opened.cookies.find((c) => c.name === "adminDoor")?.value ?? "";
    expect((await call(must(app), { url: "/v1/admin/people", access, door })).statusCode).toBe(200);
    await age(2);
    const stale = await call(must(app), { method: "POST", url: "/v1/admin/door/open", access, body: { password: ADMIN_PASSWORD } });
    expect(stale.statusCode).toBe(403);
    expect(stale.json<{ error: string }>().error).toBe("fresh_code_needed");
    // A cross-site page cannot press Lock (the site check every change meets).
    const crossSite = await must(app).inject({
      method: "POST",
      url: "/v1/admin/door/lock",
      headers: { origin: "https://elsewhere.example", "sec-fetch-site": "cross-site", "content-type": "text/plain" },
      cookies: { accessToken: access, adminDoor: door },
      payload: "x",
    });
    expect(crossSite.statusCode).toBe(403);
    expect((await call(must(app), { url: "/v1/admin/people", access, door })).statusCode).toBe(200);
    const locked = await call(must(app), { method: "POST", url: "/v1/admin/door/lock", access, door });
    expect(locked.statusCode).toBe(200);
    expect(locked.cookies.find((c) => c.name === "adminDoor")).toMatchObject({ value: "", path: "/v1/admin", maxAge: 0 });
    expect((await call(must(app), { url: "/v1/admin/people", access, door })).statusCode).toBe(403);
  });

  it("THE DOOR: five tries in 15 minutes, then even the right password waits", { timeout: 60_000 }, async () => {
    await redis.del(`rl:admin_door:id:${admin.userId}`);
    for (let n = 1; n <= 5; n++) {
      expect((await call(must(app), { method: "POST", url: "/v1/admin/door/open", access: admin.access, body: { password: "guess-number-" + String(n) + "-xx" } })).statusCode).toBe(403);
    }
    expect((await call(must(app), { method: "POST", url: "/v1/admin/door/open", access: admin.access, body: { password: ADMIN_PASSWORD } })).statusCode).toBe(429);
    await redis.del(`rl:admin_door:id:${admin.userId}`);
  });

  it("THE DOOR: only a wrong password uses a try: the right one, a short one, and Lock then open again never run out", { timeout: 60_000 }, async () => {
    await redis.del(`rl:admin_door:id:${admin.userId}`);
    for (let n = 1; n <= 7; n++) {
      const opened = await call(must(app), { method: "POST", url: "/v1/admin/door/open", access: admin.access, body: { password: ADMIN_PASSWORD } });
      expect(opened.statusCode).toBe(200);
      adminDoor = doorOf(opened);
      expect((await call(must(app), { method: "POST", url: "/v1/admin/door/open", access: admin.access, body: { password: "short" } })).statusCode).toBe(400);
    }
    // Four wrong ones, then the right one still opens.
    for (let n = 1; n <= 4; n++) {
      expect((await call(must(app), { method: "POST", url: "/v1/admin/door/open", access: admin.access, body: { password: "guess-number-" + String(n) + "-xx" } })).statusCode).toBe(403);
    }
    const last = await call(must(app), { method: "POST", url: "/v1/admin/door/open", access: admin.access, body: { password: ADMIN_PASSWORD } });
    expect(last.statusCode).toBe(200);
    adminDoor = doorOf(last);
    await redis.del(`rl:admin_door:id:${admin.userId}`);
  });

  it("lists the people using the app with their plan and what they get; a deleted account is not one", { timeout: 30_000 }, async () => {
    const res = await asAdmin({ url: `/v1/admin/people?search=${PREFIX}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const body = res.json<{ people: { id: string; email: string; ownPlan: string | null; gyms: string[]; mealScans: unknown; routePlans: unknown; signedUpAt: string }[]; next: string | null }>();
    const byId = new Map(body.people.map((p) => [p.id, p]));
    expect(byId.has(gone)).toBe(false);
    expect(byId.get(stranger.userId)).toMatchObject({ email: `${PREFIX}stranger@example.com`, ownPlan: null, gyms: [], mealScans: { window: "month", limit: 3, yours: false }, routePlans: { window: "month", limit: 2, yours: false } });
    expect(byId.get(member.userId)).toMatchObject({ ownPlan: null, gyms: ["A14i Gym"], mealScans: { window: "day", limit: 7, yours: false } });
    expect(byId.get(payer.userId)).toMatchObject({ ownPlan: "month", gyms: [], mealScans: { window: "day", limit: 15, yours: false } });
    // Newest sign-up first.
    const times = body.people.map((p) => p.signedUpAt);
    expect([...times].sort().reverse()).toEqual(times);
    expect(body.next).toBeNull();
  });

  it("TWIN CHECK: the list's numbers are the plan check's own, person by person, in every kind of plan", { timeout: 60_000 }, async () => {
    // Two more kinds: a member of a gym whose plan has ended, and a person whose own plan was cancelled.
    const lapsed = await sql<{ id: string }[]>`INSERT INTO users (email, display_name) VALUES (${`${PREFIX}lapsed@example.com`}, 'A14i Lapsed') RETURNING id`;
    const lapsedId = lapsed[0]?.id ?? "";
    const oldGym = await sql<{ id: string }[]>`INSERT INTO gyms (slug, name, owner_user_id) VALUES ('a14i-gym-old', 'A14i Old Gym', ${owner.userId}) RETURNING id`;
    const oldGymId = oldGym[0]?.id ?? "";
    await sql`INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider) VALUES ('gym', ${oldGymId}, ${await planId("org_b1_us_m")}, 'expired', 'pilot')`;
    await sql`INSERT INTO gym_members (gym_id, user_id) VALUES (${oldGymId}, ${lapsedId})`;
    await sql`INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider) VALUES ('user', ${staff.userId}, ${await planId("pro_us_y")}, 'canceled', 'pilot')`;
    try {
      const listed = (await asAdmin({ url: `/v1/admin/people?search=${PREFIX}` })).json<{ people: { id: string; gyms: string[]; ownPlan: string | null; mealScans: { window: string; limit: number }; routePlans: { window: string; limit: number } }[] }>().people;
      const byId = new Map(listed.map((p) => [p.id, p]));
      expect(byId.get(lapsedId)).toMatchObject({ gyms: [], mealScans: { window: "month", limit: 3 } });
      expect(byId.get(staff.userId)).toMatchObject({ ownPlan: null, mealScans: { window: "month", limit: 3 } });
      for (const p of [stranger, owner, staff, member, payer]) {
        const one = await mealScan(p);
        const row = byId.get(p.userId);
        expect({ meal: { window: row?.mealScans.window, limit: row?.mealScans.limit }, route: { window: row?.routePlans.window, limit: row?.routePlans.limit } }).toEqual({ meal: one.meal_scan, route: one.route_gen });
      }
    } finally {
      await sql`DELETE FROM subscriptions WHERE owner_id IN (${oldGymId}, ${staff.userId})`;
      await sql`DELETE FROM gym_members WHERE gym_id = ${oldGymId}`;
      await sql`DELETE FROM gyms WHERE id = ${oldGymId}`;
    }
  });

  it("search takes % and _ as themselves, and matches a name or an email in any case", { timeout: 30_000 }, async () => {
    await sql`INSERT INTO users (email, display_name) VALUES (${`${PREFIX}under_score@example.com`}, 'Under Score'), (${`${PREFIX}underxscore@example.com`}, 'Under X')`;
    const under = await asAdmin({ url: `/v1/admin/people?search=${encodeURIComponent("under_s")}` });
    expect(under.json<{ people: { email: string }[] }>().people.map((p) => p.email)).toEqual([`${PREFIX}under_score@example.com`]);
    const percent = await asAdmin({ url: `/v1/admin/people?search=${encodeURIComponent("a14i-%")}` });
    expect(percent.json<{ people: unknown[] }>().people).toEqual([]);
    const name = await asAdmin({ url: `/v1/admin/people?search=${encodeURIComponent("UNDER x")}` });
    expect(name.json<{ people: { email: string }[] }>().people.map((p) => p.email)).toEqual([`${PREFIX}underxscore@example.com`]);
    for (const bad of ["", "%20%20", "x".repeat(101)]) {
      expect((await asAdmin({ url: `/v1/admin/people?search=${bad}` })).statusCode).toBe(400);
    }
    expect((await asAdmin({ url: "/v1/admin/people?after=nope" })).statusCode).toBe(400);
    expect((await asAdmin({ url: "/v1/admin/people?other=1" })).statusCode).toBe(400);
  });

  it("Show more: 50 a page, newest first, nobody twice or missed, ties on the sign-up instant included", { timeout: 60_000 }, async () => {
    // 53 people; the four oldest signed up in the same microsecond, so the page ends inside a tie.
    await sql`
      INSERT INTO users (email, display_name, created_at)
      SELECT ${BULK} || n || '@example.com', 'Bulk ' || n, timestamptz '2026-01-01T00:00:00Z' + GREATEST(n, 4) * interval '1 minute'
      FROM generate_series(1, 53) AS n`;
    const first = (await asAdmin({ url: `/v1/admin/people?search=${BULK}` })).json<{ people: { email: string }[]; next: string | null }>();
    expect(first.people).toHaveLength(50);
    expect(first.next).not.toBeNull();
    const second = (await asAdmin({ url: `/v1/admin/people?search=${BULK}&after=${first.next ?? ""}` })).json<{ people: { email: string }[]; next: string | null }>();
    expect(second.people).toHaveLength(3);
    expect(second.next).toBeNull();
    const all = [...first.people, ...second.people].map((p) => p.email);
    expect(new Set(all).size).toBe(53);
    expect(second.people.every((p) => /^a14ibulk[1-4]@/.test(p.email))).toBe(true);
  });

  it("sets a person's meal scans higher than their plan: the plan check, the scan count and the record all follow at once", { timeout: 60_000 }, async () => {
    const res = await asAdmin({ method: "PUT", url: "/v1/admin/limits", body: { userIds: [stranger.userId], feature: "meal_scan", perDay: 15 } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ changed: 1, unchanged: 0, notFound: 0 });
    expect((await mealScan(stranger)).meal_scan).toEqual({ window: "day", limit: 15 });
    const left = await call(must(app), { url: "/v1/nutrition/photo-scans", access: stranger.access });
    expect(left.json()).toEqual({ window: "day", limit: 15, left: 15 });
    for (let n = 1; n <= 15; n++) expect((await call(must(app), { url: "/test/a14i/meal", access: stranger.access })).statusCode).toBe(200);
    expect((await call(must(app), { url: "/test/a14i/meal", access: stranger.access })).statusCode).toBe(429);
    expect(await audits(stranger.userId)).toEqual([{ actor_user_id: admin.userId, meta: { feature: "meal_scan", from: null, to: 15 } }]);
    // The same press again changes nothing and writes nothing.
    const again = await asAdmin({ method: "PUT", url: "/v1/admin/limits", body: { userIds: [stranger.userId], feature: "meal_scan", perDay: 15 } });
    expect(again.json()).toEqual({ changed: 0, unchanged: 1, notFound: 0 });
    expect(await audits(stranger.userId)).toHaveLength(1);
    const listed = (await asAdmin({ url: `/v1/admin/people?search=${encodeURIComponent(`${PREFIX}stranger`)}` })).json<{ people: { mealScans: unknown }[] }>();
    expect(listed.people[0]?.mealScans).toEqual({ window: "day", limit: 15, yours: true });
  });

  it("sets a gym member lower than their gym's 7, and route plans to 0; taking one back keeps the other", { timeout: 60_000 }, async () => {
    expect((await asAdmin({ method: "PUT", url: "/v1/admin/limits", body: { userIds: [member.userId], feature: "meal_scan", perDay: 3 } })).json()).toEqual({ changed: 1, unchanged: 0, notFound: 0 });
    expect((await asAdmin({ method: "PUT", url: "/v1/admin/limits", body: { userIds: [member.userId], feature: "route_gen", perDay: 0 } })).json()).toEqual({ changed: 1, unchanged: 0, notFound: 0 });
    expect(await mealScan(member)).toMatchObject({ meal_scan: { window: "day", limit: 3 }, route_gen: { window: "day", limit: 0 } });
    expect((await call(must(app), { url: "/test/a14i/route", access: member.access })).statusCode).toBe(429);
    expect((await asAdmin({ method: "PUT", url: "/v1/admin/limits", body: { userIds: [member.userId], feature: "meal_scan", perDay: null } })).json()).toEqual({ changed: 1, unchanged: 0, notFound: 0 });
    expect(await mealScan(member)).toMatchObject({ meal_scan: { window: "day", limit: 7 }, route_gen: { window: "day", limit: 0 } });
    expect((await asAdmin({ method: "PUT", url: "/v1/admin/limits", body: { userIds: [member.userId], feature: "route_gen", perDay: null } })).json()).toEqual({ changed: 1, unchanged: 0, notFound: 0 });
    expect(await mealScan(member)).toMatchObject({ meal_scan: { window: "day", limit: 7 }, route_gen: { window: "day", limit: 2 } });
    const rows = await sql`SELECT 1 FROM usage_limits WHERE user_id = ${member.userId}`;
    expect(rows).toHaveLength(0);
    expect((await audits(member.userId)).map((a) => a.meta)).toEqual([
      { feature: "meal_scan", from: null, to: 3 },
      { feature: "route_gen", from: null, to: 0 },
      { feature: "meal_scan", from: 3, to: null },
      { feature: "route_gen", from: 0, to: null },
    ]);
  });

  it("several people at once: each changed once, the already-so left alone, an unknown or deleted account counted apart", { timeout: 30_000 }, async () => {
    await asAdmin({ method: "PUT", url: "/v1/admin/limits", body: { userIds: [payer.userId], feature: "route_gen", perDay: 5 } });
    const res = await asAdmin({
      method: "PUT",
      url: "/v1/admin/limits",
      body: { userIds: [payer.userId, owner.userId, gone, "00000000-0000-4000-8000-000000000000"], feature: "route_gen", perDay: 5 },
    });
    expect(res.json()).toEqual({ changed: 1, unchanged: 1, notFound: 2 });
    expect((await mealScan(owner)).route_gen).toEqual({ window: "day", limit: 5 });
    expect(await sql`SELECT 1 FROM usage_limits WHERE user_id = ${gone}`).toHaveLength(0);
  });

  it("refuses what is not a setting: over 100, below 0, a fraction, the same person twice, none, over 100 people, another feature, another key", async () => {
    const bodies = [
      { userIds: [stranger.userId], feature: "meal_scan", perDay: 101 },
      { userIds: [stranger.userId], feature: "meal_scan", perDay: -1 },
      { userIds: [stranger.userId], feature: "meal_scan", perDay: 1.5 },
      { userIds: [stranger.userId, stranger.userId], feature: "meal_scan", perDay: 4 },
      { userIds: [], feature: "meal_scan", perDay: 4 },
      { userIds: Array.from({ length: 101 }, (_x, n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`), feature: "meal_scan", perDay: 4 },
      { userIds: [stranger.userId], feature: "coach", perDay: 4 },
      { userIds: [stranger.userId], feature: "meal_scan", perDay: 4, window: "month" },
      { userIds: ["not-an-id"], feature: "meal_scan", perDay: 4 },
    ];
    for (const body of bodies) expect((await asAdmin({ method: "PUT", url: "/v1/admin/limits", body })).statusCode).toBe(400);
    expect((await mealScan(stranger)).meal_scan).toEqual({ window: "day", limit: 15 });
  });
  // ── 14a-ii: each person's days ─────────────────────────────────────────────
  // THE WORST THING (14a-ii's plan, Kd's go 2026-11-08): somebody other than Kd sees a person's days
  // (the addresses above), or one person's minutes or scans are shown under another person's name.

  const todayIn = (zone: string, at = new Date()): string =>
    new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  const addDays = (day: string, n: number): string => {
    const [y, m, dd] = day.split("-").map(Number);
    return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (dd ?? 1) + n)).toISOString().slice(0, 10);
  };
  /** The instant a clock in `zone` reads `hhmm` on `day`, from Postgres's own zone rules. Sent as
   *  text: a value the driver sees as a timestamp it reads in this computer's own zone first. */
  const instant = async (day: string, hhmm: string, zone: string): Promise<Date> => {
    const rows = await sql<{ at: Date }[]>`SELECT (${`${day} ${hhmm}`}::text::timestamp AT TIME ZONE ${zone}::text) AS at`;
    const at = rows[0]?.at;
    if (at === undefined) throw new Error("no instant");
    return at;
  };
  const idOf = async (email: string): Promise<Person> => ({
    userId: (await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`)[0]?.id ?? "",
    access: "",
  });
  const sendMinutes = (p: Person, body: unknown) => call(must(app), { method: "POST", url: "/v1/me/app-minutes", access: p.access, body });
  type Numbers = { minutes: number | null; mealScans: number; routePlans: number; costMicro: number };
  type Days = { person: { id: string; name: string }; zone: string; zoneFromPhone: boolean; today: string; days: (Numbers & { day: string })[]; next: string | null };
  type DayPage = { day: string; totals: { people: number; minutes: number; mealScans: number; routePlans: number; costMicro: number }; people: (Numbers & { id: string; name: string })[]; next: number | null };
  const daysOf = async (p: Person, query = "zone=Europe/London") => (await asAdmin({ url: `/v1/admin/people/${p.userId}/days?${query}` })).json<Days>();
  const dayPage = async (day: string, query = "zone=Europe/London") => (await asAdmin({ url: `/v1/admin/days/${day}?${query}` })).json<DayPage>();
  const use = async (p: Person, feature: "meal_scan" | "route_gen", at: Date) => sql`INSERT INTO metered_uses (user_id, feature, at) VALUES (${p.userId}, ${feature}, ${at})`;
  const cost = async (p: Person, micro: number, at: Date) =>
    sql`INSERT INTO api_cost_events (at, user_id, feature, provider, units, unit_type, cost_micro) VALUES (${at}, ${p.userId}, 'meal_scan', 'test', 1, 'tokens', ${micro})`;

  it("WORST THING (14a-ii): each person's minutes, scans and cost are their own, on their own row, under their own name", { timeout: 90_000 }, async () => {
    const ria = await session(`${PREFIX}days-ria@example.com`, "A14i Ria");
    const ben = await session(`${PREFIX}days-ben@example.com`, "A14i Ben");
    const riaToday = todayIn("Asia/Kolkata");
    const benToday = todayIn("America/Los_Angeles");
    expect((await sendMinutes(ria, { days: [{ day: riaToday, minutes: 34, zone: "Asia/Kolkata" }] })).json()).toEqual({ kept: 1, ignored: 0 });
    expect((await sendMinutes(ben, { days: [{ day: benToday, minutes: 7, zone: "America/Los_Angeles" }] })).json()).toEqual({ kept: 1, ignored: 0 });
    // A body naming somebody else is refused: a person writes only their own days.
    expect((await sendMinutes(ria, { userId: ben.userId, days: [{ day: benToday, minutes: 900, zone: "America/Los_Angeles" }] })).statusCode).toBe(400);
    expect((await sendMinutes(ria, { days: [{ day: benToday, minutes: 900, zone: "America/Los_Angeles", userId: ben.userId }] })).statusCode).toBe(400);
    const now = new Date();
    await use(ria, "meal_scan", now);
    await use(ria, "meal_scan", now);
    await use(ria, "meal_scan", now);
    await use(ben, "route_gen", now);
    await cost(ria, 176, now);
    await cost(ria, 50, now);

    const riaDays = await daysOf(ria);
    expect(riaDays).toMatchObject({ person: { id: ria.userId, name: "A14i Ria" }, zone: "Asia/Kolkata", zoneFromPhone: true, today: riaToday });
    expect(riaDays.days[0]).toEqual({ day: riaToday, minutes: 34, mealScans: 3, routePlans: 0, costMicro: 226 });
    const benDays = await daysOf(ben);
    expect(benDays).toMatchObject({ person: { id: ben.userId, name: "A14i Ben" }, zone: "America/Los_Angeles", today: benToday });
    expect(benDays.days[0]).toEqual({ day: benToday, minutes: 7, mealScans: 0, routePlans: 1, costMicro: 0 });

    const riaRow = (await dayPage(riaToday)).people.find((p) => p.id === ria.userId);
    expect(riaRow).toEqual({ id: ria.userId, name: "A14i Ria", email: `${PREFIX}days-ria@example.com`, minutes: 34, mealScans: 3, routePlans: 0, costMicro: 226 });
    const benRow = (await dayPage(benToday)).people.find((p) => p.id === ben.userId);
    expect(benRow).toEqual({ id: ben.userId, name: "A14i Ben", email: `${PREFIX}days-ben@example.com`, minutes: 7, mealScans: 0, routePlans: 1, costMicro: 0 });
    // Nobody else's row took any of it.
    expect(await sql`SELECT user_id, minutes FROM app_minutes WHERE user_id IN (${ria.userId}, ${ben.userId}) ORDER BY minutes`).toEqual([
      { user_id: ben.userId, minutes: 7 },
      { user_id: ria.userId, minutes: 34 },
    ]);
  });

  it("minutes: signed out is refused; a day sent twice, or a lower total, changes nothing; too old or too far ahead is ignored", { timeout: 60_000 }, async () => {
    const sam = await session(`${PREFIX}days-sam@example.com`, "A14i Sam");
    const today = todayIn("Asia/Kolkata");
    const day = (d: string, minutes: number, zone = "Asia/Kolkata") => ({ day: d, minutes, zone });
    expect((await call(must(app), { method: "POST", url: "/v1/me/app-minutes", body: { days: [day(today, 5)] } })).statusCode).toBe(401);
    expect((await sendMinutes(sam, { days: [day(today, 20), day(addDays(today, -1), 45)] })).json()).toEqual({ kept: 2, ignored: 0 });
    const before = await sql<{ updated_at: Date }[]>`SELECT updated_at FROM app_minutes WHERE user_id = ${sam.userId} ORDER BY day`;
    // The same again, and a phone that lost count: kept as they are, nothing rewritten.
    expect((await sendMinutes(sam, { days: [day(today, 20), day(addDays(today, -1), 10)] })).json()).toEqual({ kept: 2, ignored: 0 });
    expect(await sql`SELECT updated_at FROM app_minutes WHERE user_id = ${sam.userId} ORDER BY day`).toEqual(before);
    expect((await sendMinutes(sam, { days: [day(today, 31)] })).json()).toEqual({ kept: 1, ignored: 0 });
    expect(await sql`SELECT minutes FROM app_minutes WHERE user_id = ${sam.userId} ORDER BY day DESC`).toEqual([{ minutes: 31 }, { minutes: 45 }]);
    // Older than 40 days or two days ahead: settled as ignored. Tomorrow (a phone's clock a little ahead) is kept.
    expect((await sendMinutes(sam, { days: [day(addDays(today, -40), 9), day(addDays(today, 2), 9)] })).json()).toEqual({ kept: 0, ignored: 2 });
    expect((await sendMinutes(sam, { days: [day(addDays(today, 1), 3)] })).json()).toEqual({ kept: 1, ignored: 0 });
    // Not a zone, not a day, too many minutes, the same day twice, nothing, too many days: refused.
    for (const bad of [
      { days: [day(today, 5, "Mars/Base")] },
      { days: [day("2026-02-30", 5)] },
      { days: [day(today, 1441)] },
      { days: [day(today, 1.5)] },
      { days: [day(today, 5), day(today, 6)] },
      { days: [] },
      { days: Array.from({ length: 61 }, (_x, n) => day(addDays(today, -n), 1)) },
    ]) {
      expect((await sendMinutes(sam, bad)).statusCode).toBe(400);
    }
    expect(await sql`SELECT 1 FROM app_minutes WHERE user_id = ${sam.userId}`).toHaveLength(3);
    await sql`DELETE FROM app_minutes WHERE user_id = ${sam.userId} AND day > ${today}::date`;
  });

  it("days are the person's own: their phone's zone, else the admin's; a scan just after their midnight is on that day", { timeout: 60_000 }, async () => {
    const ria = await idOf(`${PREFIX}days-ria@example.com`);
    const cat = await session(`${PREFIX}days-cat@example.com`, "A14i Cat");
    const riaToday = todayIn("Asia/Kolkata");
    const riaYesterday = addDays(riaToday, -1);
    await sql`UPDATE users SET created_at = now() - interval '3 days' WHERE id IN (${ria.userId}, ${cat.userId})`;
    // Ten minutes into Ria's yesterday in India is still the day before in UTC.
    await use(ria, "meal_scan", await instant(riaYesterday, "00:10", "Asia/Kolkata"));
    await use(ria, "meal_scan", await instant(riaYesterday, "23:50", "Asia/Kolkata"));
    const days = await daysOf(ria);
    expect(days.days.find((d) => d.day === riaYesterday)?.mealScans).toBe(2);
    expect(days.days.find((d) => d.day === addDays(riaYesterday, -1))?.mealScans).toBe(0);
    // Before the first day her phone counted, time in the app is not recorded.
    expect(days.days.find((d) => d.day === riaYesterday)?.minutes).toBeNull();
    expect((await dayPage(riaYesterday)).people.find((p) => p.id === ria.userId)).toMatchObject({ minutes: null, mealScans: 2 });
    // Cat's phone has sent nothing: read in the admin's zone, which the page sends.
    const catDay = todayIn("Europe/London");
    await use(cat, "route_gen", await instant(catDay, "00:30", "Europe/London"));
    const inLondon = await daysOf(cat);
    expect(inLondon).toMatchObject({ zone: "Europe/London", zoneFromPhone: false, today: catDay });
    expect(inLondon.days.find((d) => d.day === catDay)).toMatchObject({ routePlans: 1, minutes: null });
    const inLa = await daysOf(cat, "zone=America/Los_Angeles");
    expect(inLa.days.find((d) => d.day === addDays(catDay, -1))?.routePlans).toBe(1);
    expect((await dayPage(catDay)).people.find((p) => p.id === cat.userId)).toMatchObject({ routePlans: 1, minutes: null });
    // Sam's phone sent today and two days ago: the day between, not sent, is 0; the day before them is not recorded.
    const sam = await idOf(`${PREFIX}days-sam@example.com`);
    await sql`UPDATE users SET created_at = now() - interval '5 days' WHERE id = ${sam.userId}`;
    await sql`DELETE FROM app_minutes WHERE user_id = ${sam.userId} AND day = ${riaYesterday}::date`;
    await sql`INSERT INTO app_minutes (user_id, day, minutes, zone) VALUES (${sam.userId}, ${addDays(riaToday, -2)}::date, 4, 'Asia/Kolkata')`;
    const samDays = await daysOf(sam);
    expect(samDays.days.slice(0, 4).map((d) => [d.day, d.minutes])).toEqual([
      [riaToday, 31],
      [riaYesterday, 0],
      [addDays(riaToday, -2), 4],
      [addDays(riaToday, -3), null],
    ]);
    expect((await dayPage(riaYesterday)).people.find((p) => p.id === sam.userId)).toBeUndefined();
  });

  it("a person's days: 30 a page back to the day they signed up; an unknown person is not found; bad asks refused", { timeout: 60_000 }, async () => {
    const ria = await idOf(`${PREFIX}days-ria@example.com`);
    const today = todayIn("Asia/Kolkata");
    await sql`UPDATE users SET created_at = ${await instant(addDays(today, -40), "12:00", "Asia/Kolkata")} WHERE id = ${ria.userId}`;
    const first = await daysOf(ria);
    expect(first.days.map((d) => d.day)).toEqual(Array.from({ length: 30 }, (_x, n) => addDays(today, -n)));
    expect(first.next).toBe(addDays(today, -29));
    const second = await daysOf(ria, `zone=Europe/London&before=${first.next ?? ""}`);
    expect(second.days.map((d) => d.day)).toEqual(Array.from({ length: 11 }, (_x, n) => addDays(today, -30 - n)));
    expect(second.next).toBeNull();
    expect((await asAdmin({ url: "/v1/admin/people/00000000-0000-4000-8000-000000000000/days?zone=UTC" })).statusCode).toBe(404);
    expect((await asAdmin({ url: `/v1/admin/people/${gone}/days?zone=UTC` })).statusCode).toBe(404);
    expect((await asAdmin({ url: "/v1/admin/people/not-an-id/days?zone=UTC" })).statusCode).toBe(404);
    for (const q of ["", "zone=Mars/Base", "zone=UTC&before=2026-13-01", "zone=UTC&other=1"]) {
      expect((await asAdmin({ url: `/v1/admin/people/${ria.userId}/days?${q}` })).statusCode).toBe(400);
    }
    for (const u of ["/v1/admin/days/2026-02-30?zone=UTC", "/v1/admin/days/2026-11-08", "/v1/admin/days/2026-11-08?zone=UTC&from=-1", "/v1/admin/days/2026-11-08?zone=Mars/Base"]) {
      expect((await asAdmin({ url: u })).statusCode).toBe(400);
    }
    // Without the open door, the days are locked too.
    expect((await call(must(app), { url: `/v1/admin/people/${ria.userId}/days?zone=UTC`, access: admin.access })).statusCode).toBe(403);
    expect((await call(must(app), { url: "/v1/admin/days/2026-11-08?zone=UTC", access: admin.access })).statusCode).toBe(403);
  });

  it("a day for everyone: totals over all of them, 50 a page, most time first, nobody twice or missed", { timeout: 90_000 }, async () => {
    // A day nobody else's rows can be on.
    const day = "2001-02-03";
    const bulk = await sql<{ id: string }[]>`SELECT id FROM users WHERE email LIKE ${`${BULK}%`} ORDER BY email`;
    expect(bulk.length).toBe(53);
    await sql`INSERT INTO app_minutes (user_id, day, minutes, zone)
      SELECT x.id, ${day}::date, x.n::int, 'UTC' FROM unnest(${bulk.map((b) => b.id)}::uuid[]) WITH ORDINALITY AS x(id, n)`;
    const scanner = bulk[0]?.id ?? "";
    await sql`INSERT INTO metered_uses (user_id, feature, at) VALUES (${scanner}, 'meal_scan', '2001-02-03 10:00Z'), (${scanner}, 'meal_scan', '2001-02-03 23:59Z'), (${scanner}, 'meal_scan', '2001-02-04 00:00Z')`;
    await sql`INSERT INTO api_cost_events (at, user_id, feature, provider, units, unit_type, cost_micro) VALUES ('2001-02-03 10:00Z', ${scanner}, 'meal_scan', 'test', 1, 'tokens', 9000000000)`;
    const first = await dayPage(day, "zone=UTC");
    expect(first.totals).toEqual({ people: 53, minutes: (53 * 54) / 2, mealScans: 2, routePlans: 0, costMicro: 9000000000 });
    expect(first.people).toHaveLength(50);
    expect(first.people.slice(0, 2).map((p) => p.minutes)).toEqual([53, 52]);
    expect(first.next).toBe(50);
    const second = await dayPage(day, "zone=UTC&from=50");
    expect(second.people.map((p) => p.minutes)).toEqual([3, 2, 1]);
    expect(second.people[2]).toMatchObject({ id: scanner, mealScans: 2, costMicro: 9000000000 });
    expect(second.next).toBeNull();
    expect(new Set([...first.people, ...second.people].map((p) => p.id)).size).toBe(53);
    expect(second.totals).toEqual(first.totals);
    expect(await dayPage("2001-02-01", "zone=UTC")).toEqual({ day: "2001-02-01", totals: { people: 0, minutes: 0, mealScans: 0, routePlans: 0, costMicro: 0 }, people: [], next: null });
  });

  it("a scan counted is kept with when; one refused over the limit or given back is not", { timeout: 60_000 }, async () => {
    const lee = await session(`${PREFIX}days-lee@example.com`, "A14i Lee");
    const uses = async () => (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM metered_uses WHERE user_id = ${lee.userId} AND feature = 'meal_scan'`)[0]?.n;
    // Free: 3 a month. Two counted, one given back, one more, and the next refused.
    expect((await call(must(app), { url: "/test/a14i/meal", access: lee.access })).statusCode).toBe(200);
    expect((await call(must(app), { url: "/test/a14i/meal", access: lee.access })).statusCode).toBe(200);
    expect((await call(must(app), { url: "/test/a14ii/meal-fails", access: lee.access })).json()).toEqual({ given: true });
    expect(await uses()).toBe(2);
    expect((await call(must(app), { url: "/test/a14i/meal", access: lee.access })).statusCode).toBe(200);
    expect((await call(must(app), { url: "/test/a14i/meal", access: lee.access })).statusCode).toBe(429);
    expect(await uses()).toBe(3);
    expect((await daysOf(lee)).days[0]?.mealScans).toBe(3);
  });
  it("the zone of a person's days is the one their phone sent last, not the one of their latest day", { timeout: 60_000 }, async () => {
    const tia = await session(`${PREFIX}days-tia@example.com`, "A14i Tia");
    const ahead = todayIn("Etc/GMT-14");
    expect((await sendMinutes(tia, { days: [{ day: ahead, minutes: 3, zone: "Etc/GMT-14" }] })).json()).toEqual({ kept: 1, ignored: 0 });
    expect((await daysOf(tia)).zone).toBe("Etc/GMT-14");
    // Her phone's next send, back home: her days are read in India again, though the day sent is earlier.
    await sql`UPDATE app_minutes SET updated_at = now() - interval '1 minute' WHERE user_id = ${tia.userId}`;
    expect((await sendMinutes(tia, { days: [{ day: todayIn("Asia/Kolkata"), minutes: 9, zone: "Asia/Kolkata" }] })).json()).toEqual({ kept: 1, ignored: 0 });
    expect((await daysOf(tia)).zone).toBe("Asia/Kolkata");
  });

  it("the admin's own zone, when the database cannot read days in it, is read as UTC and the answer says so", { timeout: 30_000 }, async () => {
    const ben = await idOf(`${PREFIX}days-ben@example.com`);
    await sql`DELETE FROM app_minutes WHERE user_id = ${ben.userId}`;
    const res = await asAdmin({ url: `/v1/admin/people/${ben.userId}/days?zone=${encodeURIComponent("+05:30")}` });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<Days>()).toMatchObject({ zone: "UTC", zoneFromPhone: false });
    const day = await asAdmin({ url: `/v1/admin/days/${todayIn("UTC")}?zone=${encodeURIComponent("+05:30")}` });
    expect(day.statusCode, day.body).toBe(200);
  });

  it("a use that cannot be written down is not counted either", { timeout: 30_000 }, async () => {
    // Somebody with no account row: writing their use fails (its person must exist), and the count is put back.
    const nobody = "00000000-0000-4000-8000-0000000014a2";
    const key = quotaKey("meal_scan", nobody, "month", new Date());
    const res = await must(app).inject({ method: "GET", url: "/test/a14ii/meal-nobody" });
    expect(res.statusCode).toBe(500);
    expect(await redis.get(key)).toBe("0");
    expect(await sql`SELECT 1 FROM metered_uses WHERE user_id = ${nobody}`).toHaveLength(0);
  });

  it("the minutes limit is by person: a whole gym at one address sends its members' minutes", { timeout: 30_000 }, async () => {
    const one = await session(`${PREFIX}days-one@example.com`, "A14i One");
    const ip = "10.14.9.9";
    // The address already far past any limit: a person sending from it is still let through.
    for (const dimension of ["ip", "ip:app_minutes"]) await redis.setex(`rl:app_minutes:${dimension}:${ip}`, 60, "1000");
    const res = await call(must(app), { method: "POST", url: "/v1/me/app-minutes", access: one.access, ip, body: { days: [{ day: todayIn("Asia/Kolkata"), minutes: 2, zone: "Asia/Kolkata" }] } });
    expect(res.statusCode, res.body).toBe(200);
    // The person's own: the 31st in a minute waits.
    await redis.setex(`rl:app_minutes:id:${one.userId}`, 60, "30");
    expect((await call(must(app), { method: "POST", url: "/v1/me/app-minutes", access: one.access, ip, body: { days: [{ day: todayIn("Asia/Kolkata"), minutes: 3, zone: "Asia/Kolkata" }] } })).statusCode).toBe(429);
  });

  // ── The two extra passes over 14a ──────────────────────────────────────────

  it("THE DOOR (security H1): opening again ends the earlier key; Lock ends the session's key whichever cookie it carries; two opens at once leave one", { timeout: 60_000 }, async () => {
    await redis.del(`rl:admin_door:id:${admin.userId}`);
    await redis.del(`rl:admin_write:id:${admin.userId}`);
    await redis.del(`rl:admin_read:id:${admin.userId}`);
    const openNow = () => call(must(app), { method: "POST", url: "/v1/admin/door/open", access: admin.access, body: { password: ADMIN_PASSWORD } });
    const people = async (door: string) => (await call(must(app), { url: "/v1/admin/people", access: admin.access, door })).statusCode;
    const lockWith = async (door: string) => (await call(must(app), { method: "POST", url: "/v1/admin/door/lock", access: admin.access, door })).statusCode;
    const first = doorOf(await openNow());
    const second = doorOf(await openNow());
    expect([await people(first), await people(second)]).toEqual([403, 200]);
    // Lock pressed from a page still holding the earlier key closes the open one too.
    expect(await lockWith(first)).toBe(200);
    expect([await people(first), await people(second)]).toEqual([403, 403]);
    // Two tabs pressing Open together: one key opens; Lock from the other closes it.
    const both = await Promise.all([openNow(), openNow()]);
    expect(both.map((r) => r.statusCode)).toEqual([200, 200]);
    const opens = [await people(doorOf(both[0])), await people(doorOf(both[1]))];
    expect([...opens].sort()).toEqual([200, 403]);
    const closedBy = opens[0] === 200 ? both[1] : both[0];
    expect(await lockWith(doorOf(closedBy))).toBe(200);
    for (const r of both) expect(await people(doorOf(r))).toBe(403);
    // Each open is written down before the door opens.
    expect((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE action = 'admin.door_opened' AND actor_user_id = ${admin.userId} AND at > now() - interval '1 minute'`)[0]?.n).toBeGreaterThanOrEqual(4);
    adminDoor = doorOf(await openNow());
    expect(await people(adminDoor)).toBe(200);
  });

  it("THE DOOR (security L3): with Redis down no password is checked: right or wrong, the page cannot open now", { timeout: 60_000 }, async () => {
    const down = createMemoryRedis();
    down.down = true;
    const cut = await buildApp(loadConfig({ ...baseEnv, ADMIN_USER_ID: admin.userId }), { redis: down });
    try {
      const wrongs = async () => (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE action = 'admin.door_wrong_password' AND actor_user_id = ${admin.userId}`)[0]?.n;
      const before = await wrongs();
      for (const password of ["not-the-admin-password", ADMIN_PASSWORD]) {
        const res = await call(cut, { method: "POST", url: "/v1/admin/door/open", access: admin.access, body: { password } });
        expect({ password, status: res.statusCode, error: res.json<{ error: string }>().error }).toEqual({ password, status: 503, error: "admin_unavailable" });
        expect(res.cookies.find((c) => c.name === "adminDoor")).toBeUndefined();
      }
      expect(await wrongs()).toBe(before);
    } finally {
      await cut.close();
    }
  });

  it("year 0000 is not a day (security L1): refused, never a fault", { timeout: 30_000 }, async () => {
    const zed = await session(`${PREFIX}days-zed@example.com`, "A14i Zed");
    expect((await sendMinutes(zed, { days: [{ day: "0000-01-01", minutes: 5, zone: "UTC" }] })).statusCode).toBe(400);
    expect((await asAdmin({ url: "/v1/admin/days/0000-01-01?zone=UTC" })).statusCode).toBe(400);
    expect((await sendMinutes(zed, { days: [{ day: "0001-01-01", minutes: 5, zone: "UTC" }] })).json()).toEqual({ kept: 0, ignored: 1 });
  });

  it("a day holds no more minutes than have passed of it, and an hour more (security L4); two phones sending at once keep the highest", { timeout: 60_000 }, async () => {
    const cap = await session(`${PREFIX}days-cap@example.com`, "A14i Cap");
    // 12:09 UTC is 17:39 in India: 1,059 minutes of the day have passed.
    const now = new Date("2026-11-08T12:09:00Z");
    const kept = await saveMinutes(sql, cap.userId, [
      { day: "2026-11-07", minutes: 1440, zone: "Asia/Kolkata" },
      { day: "2026-11-08", minutes: 1440, zone: "Asia/Kolkata" },
      { day: "2026-11-09", minutes: 500, zone: "Asia/Kolkata" },
    ], now);
    expect(kept).toBe(3);
    expect(await sql`SELECT day::text, minutes FROM app_minutes WHERE user_id = ${cap.userId} ORDER BY day`).toEqual([
      { day: "2026-11-07", minutes: 1440 },
      { day: "2026-11-08", minutes: 1059 + 60 },
      { day: "2026-11-09", minutes: 0 },
    ]);
    // Five minutes before midnight in India, tomorrow already holds what a clock five minutes fast would count.
    await saveMinutes(sql, cap.userId, [{ day: "2026-11-09", minutes: 30, zone: "Asia/Kolkata" }], new Date("2026-11-08T18:25:00Z"));
    expect(await sql`SELECT minutes FROM app_minutes WHERE user_id = ${cap.userId} AND day = '2026-11-09'`).toEqual([{ minutes: 30 }]);
    // Twenty sends of one day at once, from two phones in two zones: one row, the highest.
    await sql`DELETE FROM app_minutes WHERE user_id = ${cap.userId}`;
    const today = todayIn("UTC");
    const sends = Array.from({ length: 20 }, (_x, n) => saveMinutes(sql, cap.userId, [{ day: today, minutes: n + 1, zone: n % 2 === 0 ? "UTC" : "Europe/London" }], new Date()));
    await Promise.all(sends);
    expect(await sql`SELECT minutes FROM app_minutes WHERE user_id = ${cap.userId} AND day = ${today}::date`).toEqual([{ minutes: 20 }]);
  });

  it("limits pressed at once (integrity L1): each person's record reads in the order the number changed", { timeout: 60_000 }, async () => {
    await redis.del(`rl:admin_write:id:${admin.userId}`);
    const one = await session(`${PREFIX}race-one@example.com`, "A14i Race One");
    const two = await session(`${PREFIX}race-two@example.com`, "A14i Race Two");
    const numbers = [3, 5, null, 7, 9];
    const presses = Array.from({ length: 20 }, (_x, n) =>
      asAdmin({ method: "PUT", url: "/v1/admin/limits", body: { userIds: n % 3 === 0 ? [one.userId] : n % 3 === 1 ? [two.userId, one.userId] : [two.userId], feature: "meal_scan", perDay: numbers[n % numbers.length] ?? null } }),
    );
    expect((await Promise.all(presses)).map((r) => r.statusCode)).toEqual(Array.from({ length: 20 }, () => 200));
    for (const p of [one, two]) {
      const rows = await sql<{ meta: { from: number | null; to: number | null } }[]>`
        SELECT meta FROM audit_log WHERE action = 'admin.usage_limit_set' AND target_id = ${p.userId} ORDER BY at, id`;
      expect(rows.length).toBeGreaterThan(1);
      const held = await sql<{ n: number | null }[]>`SELECT meal_scans_a_day AS n FROM usage_limits WHERE user_id = ${p.userId}`;
      let was: number | null = null;
      for (const r of rows) {
        expect(r.meta.from).toBe(was);
        was = r.meta.to;
      }
      expect(was).toBe(held[0]?.n ?? null);
    }
    for (const p of [one, two]) await asAdmin({ method: "PUT", url: "/v1/admin/limits", body: { userIds: [p.userId], feature: "meal_scan", perDay: null } });
  });

  it("a plan check that read the old number just before a save cannot keep it (integrity L2)", { timeout: 60_000 }, async () => {
    await redis.del(`rl:admin_write:id:${admin.userId}`);
    const pat = await session(`${PREFIX}race-pat@example.com`, "A14i Race Pat");
    await redis.del(`ent:${pat.userId}`);
    let atWrite: () => void = () => undefined;
    let release: () => void = () => undefined;
    const reached = new Promise<void>((r) => (atWrite = r));
    const gate = new Promise<void>((r) => (release = r));
    // A plan check that has read the database, and stalls before it keeps its answer.
    const stalling = {
      ...redis,
      setex: async (key: string, ttl: number, value: string) => {
        if (key.startsWith(`ent:${pat.userId}`)) {
          atWrite();
          await gate;
        }
        return await redis.setex(key, ttl, value);
      },
    };
    const stalled = getEntitlements({ sql, redis: stalling }, pat.userId);
    await reached;
    expect((await asAdmin({ method: "PUT", url: "/v1/admin/limits", body: { userIds: [pat.userId], feature: "meal_scan", perDay: 10 } })).statusCode).toBe(200);
    release();
    expect((await stalled).entitlements.meal_scan).toEqual({ window: "month", limit: 3 });
    expect((await getEntitlements({ sql, redis }, pat.userId)).entitlements.meal_scan).toEqual({ window: "day", limit: 10 });
    expect((await mealScan(pat)).meal_scan).toEqual({ window: "day", limit: 10 });
    await asAdmin({ method: "PUT", url: "/v1/admin/limits", body: { userIds: [pat.userId], feature: "meal_scan", perDay: null } });
  });

  it("one use given back twice at once gives back one, and the page's count stays the limit's (integrity L3)", { timeout: 60_000 }, async () => {
    const kim = await session(`${PREFIX}race-kim@example.com`, "A14i Race Kim");
    for (let n = 0; n < 2; n++) expect((await call(must(app), { url: "/test/a14i/meal", access: kim.access })).statusCode).toBe(200);
    const key = quotaKey("meal_scan", kim.userId, "month", new Date());
    const useId = (await sql<{ id: string }[]>`SELECT id FROM metered_uses WHERE user_id = ${kim.userId} ORDER BY at DESC LIMIT 1`)[0]?.id ?? "";
    const log = { warn: () => undefined };
    const given = await Promise.all([refundUse({ sql, redis, log }, kim.userId, { key, useId }), refundUse({ sql, redis, log }, kim.userId, { key, useId })]);
    expect([...given].sort()).toEqual([false, true]);
    expect(await redis.get(key)).toBe("1");
    expect(await sql`SELECT 1 FROM metered_uses WHERE user_id = ${kim.userId}`).toHaveLength(1);
    expect((await daysOf(kim)).days[0]?.mealScans).toBe(1);
  });

  it("earlier days are cut in the first page's zone though the phone has since sent from another (integrity L4)", { timeout: 60_000 }, async () => {
    await redis.del(`rl:admin_read:id:${admin.userId}`);
    const uma = await session(`${PREFIX}race-uma@example.com`, "A14i Race Uma");
    expect((await sendMinutes(uma, { days: [{ day: todayIn("Asia/Kolkata"), minutes: 4, zone: "Asia/Kolkata" }] })).statusCode).toBe(200);
    const first = await daysOf(uma);
    expect(first.zone).toBe("Asia/Kolkata");
    await sql`UPDATE app_minutes SET updated_at = now() - interval '1 minute' WHERE user_id = ${uma.userId}`;
    expect((await sendMinutes(uma, { days: [{ day: todayIn("UTC"), minutes: 9, zone: "UTC" }] })).statusCode).toBe(200);
    expect((await daysOf(uma)).zone).toBe("UTC");
    expect((await daysOf(uma, `zone=Europe/London&before=${first.today}&dayZone=Asia/Kolkata`)).zone).toBe("Asia/Kolkata");
    // A zone the database cannot read days in is not used.
    expect((await daysOf(uma, `zone=Europe/London&dayZone=${encodeURIComponent("+05:30")}`)).zone).toBe("UTC");
  });

  it("the first password pressed four times at once is made once, written down once", { timeout: 30_000 }, async () => {
    const made = await Promise.all(Array.from({ length: 4 }, () => createDoorPassword(sql, owner.userId, "not-a-real-hash", "argon2id")));
    expect([...made].sort()).toEqual([false, false, false, true]);
    expect(await sql`SELECT 1 FROM admin_passwords WHERE user_id = ${owner.userId}`).toHaveLength(1);
    expect(await sql`SELECT 1 FROM audit_log WHERE action = 'admin.door_password_made' AND actor_user_id = ${owner.userId}`).toHaveLength(1);
    await sql`DELETE FROM admin_passwords WHERE user_id = ${owner.userId}`;
  });
});
