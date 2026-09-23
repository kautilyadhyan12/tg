// P2.4 — entitlements + quotas + history gate against REAL Postgres (R9.2).
// DATABASE_URL-gated; requires migrations 0001–0004 + seed (plans rows).
// Pre-P3, pro/gym paths use provider='pilot' subscription fixtures (GAP-5).
// Redis = the in-memory adapter injected via buildApp overrides, so the
// fail-open/fail-closed and cache/bust paths are driven deterministically.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { seed } from "../src/db/seed.js";
import { createMemoryRedis } from "../src/redis.js";
import { bustEntitlements } from "../src/modules/entitlements/service.js";
import { quotaKey, requireQuota } from "../src/modules/quotas/service.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "entitle-test-secret-0123456789abcd-32", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;

const daysAgoIso = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

d("entitlements + quotas + history gate (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  let app: App | undefined;
  let userA = "";
  let cookieA = "";
  let userB = "";
  let cookieB = "";
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const inject = (opts: {
    method?: "GET" | "POST";
    url: string;
    body?: unknown;
    access?: string;
  }) =>
    api().inject({
      method: opts.method ?? "GET",
      url: opts.url,
      headers: opts.body !== undefined ? { "content-type": "application/json" } : {},
      cookies: opts.access !== undefined && opts.access !== "" ? { accessToken: opts.access } : {},
      ...(opts.body !== undefined ? { payload: JSON.stringify(opts.body) } : {}),
    });

  const session = async (email: string): Promise<{ userId: string; access: string }> => {
    const reg = await inject({
      method: "POST",
      url: "/v1/auth/register",
      body: { email, password: PASSWORD, displayName: "P24 Fixture" },
    });
    if (reg.statusCode !== 201) throw new Error(`register failed: ${reg.body}`);
    const { userId } = reg.json<{ userId: string }>();
    const login = await inject({
      method: "POST",
      url: "/v1/auth/login",
      body: { email, password: PASSWORD },
    });
    const access = login.cookies.find((c) => c.name === "accessToken")?.value ?? "";
    return { userId, access };
  };

  const planId = async (code: string): Promise<string> => {
    const rows = await sql<{ id: string }[]>`SELECT id FROM plans WHERE code = ${code}`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error(`plan ${code} not seeded`);
    return id;
  };

  const giveProSub = async (userId: string) => {
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('user', ${userId}, ${await planId("pro_us_m")}, 'active', 'pilot')`;
  };

  beforeAll(async () => {
    await seed(url ?? "");
    await sql`DELETE FROM subscriptions WHERE owner_id IN
      (SELECT id FROM users WHERE email LIKE 'p24-%@example.com')`;
    await sql`DELETE FROM gym_members WHERE user_id IN
      (SELECT id FROM users WHERE email LIKE 'p24-%@example.com')`;
    await sql`DELETE FROM subscriptions WHERE owner_id IN (SELECT id FROM gyms WHERE slug = 'p24-gym')`;
    await sql`DELETE FROM gyms WHERE slug = 'p24-gym'`;
    await sql`DELETE FROM workouts WHERE user_id IN
      (SELECT id FROM users WHERE email LIKE 'p24-%@example.com')`;
    await sql`DELETE FROM users WHERE email LIKE 'p24-%@example.com'`;

    app = await buildApp(loadConfig(baseEnv), { redis });
    // Scratch metered routes: coach/meal features land in P2.5/P2.6 — the
    // middleware contract is proven here on stand-in handlers (R3.3 order).
    api().get(
      "/test/quota/coach",
      { preHandler: [api().authenticate, requireQuota("coach", { sql, redis })] },
      async (_req, reply) => reply.status(200).send({ ok: true }),
    );
    api().get(
      "/test/quota/meal",
      { preHandler: [api().authenticate, requireQuota("meal_scan", { sql, redis })] },
      async (_req, reply) => reply.status(200).send({ ok: true }),
    );

    const a = await session("p24-alice@example.com");
    const b = await session("p24-bob@example.com");
    userA = a.userId;
    cookieA = a.access;
    userB = b.userId;
    cookieB = b.access;
  }, 120_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    await sql.end({ timeout: 5 });
  });

  it("free user resolves the seed free plan, source 'free'", { timeout: 30_000 }, async () => {
    const res = await inject({ url: "/v1/entitlements/me", access: cookieA });
    expect(res.statusCode).toBe(200);
    const me = res.json<{ entitlements: Record<string, unknown>; source: string }>();
    expect(me.source).toBe("free");
    expect(me.entitlements["coach"]).toEqual({ window: "month", limit: 5 });
    expect(me.entitlements["history_days"]).toBe(90);
    expect(me.entitlements["share_watermark"]).toBe(true);
  });

  it("quota middleware: free coach = 5/month then a friendly 429 with resetsAt (quotas.py port)", { timeout: 30_000 }, async () => {
    for (let i = 0; i < 5; i++) {
      expect((await inject({ url: "/test/quota/coach", access: cookieA })).statusCode).toBe(200);
    }
    const blocked = await inject({ url: "/test/quota/coach", access: cookieA });
    expect(blocked.statusCode).toBe(429);
    const body = blocked.json<{ error: string; resetsAt: string }>();
    expect(body.error).toBe("quota_exceeded");
    expect(new Date(body.resetsAt).getTime()).toBeGreaterThan(Date.now());
    // A refused try takes nothing: however many are refused, the five used stay the count.
    expect((await inject({ url: "/test/quota/coach", access: cookieA })).statusCode).toBe(429);
    expect(await redis.get(quotaKey("coach", userA, "month", new Date()))).toBe("5");
  });

  it("Redis down: coach fails OPEN, meal_scan fails CLOSED 503 (quotas.py:7-11 verbatim)", { timeout: 30_000 }, async () => {
    redis.down = true;
    try {
      // Even the over-limit coach user passes — cannot meter, cheap feature.
      expect((await inject({ url: "/test/quota/coach", access: cookieA })).statusCode).toBe(200);
      const meal = await inject({ url: "/test/quota/meal", access: cookieA });
      expect(meal.statusCode).toBe(503);
      expect(meal.json<{ error: string }>().error).toBe("quota_unavailable");
    } finally {
      redis.down = false;
    }
  });

  it("cache holds for the TTL; bust flips the answer immediately (§4.1/§10)", { timeout: 30_000 }, async () => {
    await inject({ url: "/v1/entitlements/me", access: cookieA }); // warm cache (free)
    await giveProSub(userA);
    const cached = await inject({ url: "/v1/entitlements/me", access: cookieA });
    expect(cached.json<{ source: string }>().source).toBe("free"); // still cached
    await bustEntitlements(redis, userA);
    const fresh = await inject({ url: "/v1/entitlements/me", access: cookieA });
    const me = fresh.json<{ entitlements: Record<string, unknown>; source: string }>();
    expect(me.source).toBe("own_subscription");
    expect(me.entitlements["coach"]).toEqual({ window: "day", limit: 30 });
    expect(me.entitlements["history_days"]).toBe(-1);
  });

  it("A's subscription never leaks into B's entitlements (R3.2)", { timeout: 30_000 }, async () => {
    const res = await inject({ url: "/v1/entitlements/me", access: cookieB });
    expect(res.json<{ source: string }>().source).toBe("free");
  });

  it("gym membership grants member_entitlements, source 'gym_membership'", { timeout: 30_000 }, async () => {
    const gymRows = await sql<{ id: string }[]>`
      INSERT INTO gyms (slug, name, owner_user_id) VALUES ('p24-gym', 'P24 Gym', ${userA})
      RETURNING id`;
    const gymId = gymRows[0]?.id;
    if (gymId === undefined) throw new Error("gym fixture failed");
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, ${await planId("org_b1_in_m")}, 'trialing', 'pilot')`;
    await sql`INSERT INTO gym_members (gym_id, user_id) VALUES (${gymId}, ${userB})`;
    await bustEntitlements(redis, userB);
    const res = await inject({ url: "/v1/entitlements/me", access: cookieB });
    const me = res.json<{ entitlements: Record<string, unknown>; source: string }>();
    expect(me.source).toBe("gym_membership");
    expect(me.entitlements["coach"]).toEqual({ window: "day", limit: 30 }); // Pro block (v1 §9.2)
    // THE ONE NUMBER THAT SEPARATES THE GYM-MEMBER BLOCK FROM THE PAID ONE, and
    // until round 2 nothing outside the seed test observed it. **Every other
    // assertion here — `source`, `coach`, `history_days` — is IDENTICAL in both
    // blocks**, so all of them stay green if 7 becomes 20, which is what round-1
    // claimed this test now covered and round-2 measured false.
    // 7/day is Kd's (RULINGS 2026-09-15; 5 before, :17366 §1, whose §2 measures
    // WHY 20/day for gym members is underwater). This asserts it through the
    // resolver a real member's app reads, not off the plans table.
    expect(me.entitlements["meal_scan"]).toEqual({ window: "day", limit: 7 });
  });

  it("history read-gate: free sees 90 days with limitedToDays; pro sees everything (§0.2, GAP-4)", { timeout: 60_000 }, async () => {
    const fresh = await session("p24-history@example.com");
    const oldId = crypto.randomUUID();
    const newId = crypto.randomUUID();
    for (const [id, when] of [
      [oldId, daysAgoIso(120)],
      [newId, daysAgoIso(1)],
    ] as const) {
      await sql`
        INSERT INTO workouts (id, user_id, started_at, platform, engine_version)
        VALUES (${id}, ${fresh.userId}, ${when}, 'web', '1.0.0')`;
    }

    const gated = await inject({ url: "/v1/workouts?limit=100", access: fresh.access });
    const gatedBody = gated.json<{ items: { id: string }[]; limitedToDays: number | null }>();
    expect(gatedBody.limitedToDays).toBe(90);
    expect(gatedBody.items.map((i) => i.id)).toEqual([newId]); // 120-day-old row invisible

    const gatedRecords = await inject({ url: "/v1/progress/records", access: fresh.access });
    const gr = gatedRecords.json<{ totalWorkouts: number; limitedToDays: number | null }>();
    expect(gr.totalWorkouts).toBe(1);
    expect(gr.limitedToDays).toBe(90);

    await giveProSub(fresh.userId);
    await bustEntitlements(redis, fresh.userId);

    const full = await inject({ url: "/v1/workouts?limit=100", access: fresh.access });
    const fullBody = full.json<{ items: { id: string }[]; limitedToDays: number | null }>();
    expect(fullBody.limitedToDays).toBeNull();
    expect(fullBody.items.map((i) => i.id).sort()).toEqual([newId, oldId].sort());

    const fullRecords = await inject({ url: "/v1/progress/records", access: fresh.access });
    expect(fullRecords.json<{ totalWorkouts: number }>().totalWorkouts).toBe(2);
  });

  it("a CORRUPT cache value self-heals to DB resolution, never 500s (T3 P2.4)", { timeout: 30_000 }, async () => {
    // Poison the cache with non-JSON, then with valid-JSON-wrong-shape.
    await redis.setex("ent:" + userB, 60, "}{ not json");
    const r1 = await inject({ url: "/v1/entitlements/me", access: cookieB });
    expect(r1.statusCode).toBe(200);
    await redis.setex("ent:" + userB, 60, JSON.stringify({ source: "bogus", nope: 1 }));
    const r2 = await inject({ url: "/v1/entitlements/me", access: cookieB });
    expect(r2.statusCode).toBe(200);
    expect(r2.json<{ source: string }>().source).toBe("gym_membership"); // re-resolved from DB
  });

  it("/v1/entitlements/me requires authentication", { timeout: 30_000 }, async () => {
    expect((await inject({ url: "/v1/entitlements/me" })).statusCode).toBe(401);
  });
});
