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
import { requireQuota } from "../src/modules/quotas/service.js";

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
type Person = { userId: string; access: string };

d("the admin page (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
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
  const call = (a: App, opts: { method?: "GET" | "PUT" | "POST"; url: string; body?: unknown; access?: string; door?: string }) =>
    a.inject({
      method: opts.method ?? "GET",
      url: opts.url,
      headers: opts.body !== undefined ? { "content-type": "application/json" } : {},
      cookies: {
        ...(opts.access !== undefined && opts.access !== "" ? { accessToken: opts.access } : {}),
        ...(opts.door !== undefined && opts.door !== "" ? { adminDoor: opts.door } : {}),
      },
      ...(opts.body !== undefined ? { payload: JSON.stringify(opts.body) } : {}),
    });
  const asAdmin = (opts: { method?: "GET" | "PUT" | "POST"; url: string; body?: unknown }) => call(must(app), { ...opts, access: admin.access, door: adminDoor });

  const session = async (email: string, name: string): Promise<Person> => {
    const a = must(setup);
    const reg = await call(a, { method: "POST", url: "/v1/auth/register", body: { email, password: PASSWORD, displayName: name } });
    if (reg.statusCode !== 201) throw new Error(`register failed: ${reg.body}`);
    const { userId } = reg.json<{ userId: string }>();
    const login = await call(a, { method: "POST", url: "/v1/auth/login", body: { email, password: PASSWORD } });
    return { userId, access: login.cookies.find((c) => c.name === "accessToken")?.value ?? "" };
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
    await sql`DELETE FROM users WHERE email LIKE ${`${PREFIX}%`} OR email LIKE ${`${BULK}%`}`;
  };

  beforeAll(async () => {
    await seed(url ?? "");
    await clean();
    setup = await buildApp(loadConfig(baseEnv), { redis });
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
    app = await buildApp(loadConfig({ ...baseEnv, ADMIN_USER_ID: admin.userId }), { redis });
    const a = must(app);
    a.get("/test/a14i/meal", { preHandler: [a.authenticate, requireQuota("meal_scan", { sql, redis })] }, async (_q, r) => r.send({ ok: true }));
    a.get("/test/a14i/route", { preHandler: [a.authenticate, requireQuota("route_gen", { sql, redis })] }, async (_q, r) => r.send({ ok: true }));
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
  ];

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
        const unknown = await call(must(app), { method: address.method, url: address.url.replace("/v1/admin/", "/v1/admin-none/"), access: p.access, ...(address.body === undefined ? {} : { body: address.body }) });
        expect({ who, url: address.url, status: res.statusCode }).toEqual({ who, url: address.url, status: 404 });
        expect(res.json<{ error: string }>().error).toBe("not_found");
        expect(res.json<{ message: string }>().message).toBe(`Route ${address.method}:${address.url} not found`);
        expect(Object.keys(res.json<object>()).sort()).toEqual(Object.keys(unknown.json<object>()).sort());
        expect(res.body).not.toContain("@example.com");
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
    const login = await call(must(app), { method: "POST", url: "/v1/auth/login", body: { email: `${PREFIX}admin@example.com`, password: PASSWORD } });
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
  });

  it("THE DOOR: another sign-in of the admin cannot use this one's door; a sign-in older than a few minutes needs a new code; Lock closes it", { timeout: 60_000 }, async () => {
    await redis.del(`rl:admin_door:id:${admin.userId}`);
    const login = await call(must(app), { method: "POST", url: "/v1/auth/login", body: { email: `${PREFIX}admin@example.com`, password: PASSWORD } });
    const access = login.cookies.find((c) => c.name === "accessToken")?.value ?? "";
    expect((await call(must(app), { url: "/v1/admin/people", access, door: adminDoor })).statusCode).toBe(403);
    const opened = await call(must(app), { method: "POST", url: "/v1/admin/door/open", access, body: { password: ADMIN_PASSWORD } });
    const door = opened.cookies.find((c) => c.name === "adminDoor")?.value ?? "";
    expect((await call(must(app), { url: "/v1/admin/people", access, door })).statusCode).toBe(200);
    // Made eleven minutes old, this sign-in is not fresh: the password alone opens nothing.
    await sql`UPDATE refresh_tokens SET created_at = now() - interval '11 minutes' WHERE user_id = ${admin.userId}
      AND family_id = (SELECT family_id FROM refresh_tokens WHERE user_id = ${admin.userId} ORDER BY created_at DESC LIMIT 1)`;
    const stale = await call(must(app), { method: "POST", url: "/v1/admin/door/open", access, body: { password: ADMIN_PASSWORD } });
    expect(stale.statusCode).toBe(403);
    expect(stale.json<{ error: string }>().error).toBe("fresh_code_needed");
    expect((await call(must(app), { url: "/v1/admin/door", access })).json<{ fresh: boolean }>().fresh).toBe(false);
    expect((await call(must(app), { method: "POST", url: "/v1/admin/door/lock", access, door })).statusCode).toBe(200);
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
      expect((await call(must(app), { method: "POST", url: "/v1/admin/door/open", access: admin.access, body: { password: ADMIN_PASSWORD } })).statusCode).toBe(200);
      expect((await call(must(app), { method: "POST", url: "/v1/admin/door/open", access: admin.access, body: { password: "short" } })).statusCode).toBe(400);
    }
    // Four wrong ones, then the right one still opens.
    for (let n = 1; n <= 4; n++) {
      expect((await call(must(app), { method: "POST", url: "/v1/admin/door/open", access: admin.access, body: { password: "guess-number-" + String(n) + "-xx" } })).statusCode).toBe(403);
    }
    expect((await call(must(app), { method: "POST", url: "/v1/admin/door/open", access: admin.access, body: { password: ADMIN_PASSWORD } })).statusCode).toBe(200);
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
});
