// P2.6b — geo routes + geocode-cache integration (real Postgres, fake ORS).
// DATABASE_URL-gated; fixture prefix p26b-, children-before-users cleanup. No
// test calls the real OpenRouteService — the route provider is injected via
// overrides.geo (buildApp seam).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import { quotaKey } from "../src/modules/quotas/service.js";
import { geocode, geoRedisKey, type GeocodeResolver } from "../src/modules/geo/geocode.js";
import type { RouteProvider } from "../src/modules/geo/ors.adapter.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");
const PASSWORD = "p26b-safe-test-password-1"; // gitleaks:allow
const env = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "p26b-test-secret-0123456789abcdef-32", // gitleaks:allow
  LOG_LEVEL: "error",
};
type App = Awaited<ReturnType<typeof buildApp>>;

const candidate = {
  coords: [
    [12.9, 77.5],
    [12.91, 77.51],
    [12.9, 77.5],
  ] as [number, number][],
  distanceM: 5000,
  elevationGainM: 20,
  safeFraction: 0.5,
  busyFraction: 0.2,
  greenFraction: 0.3,
  isLoop: true,
  source: "ors" as const,
};

function fakeRouteProvider(): RouteProvider & { seeds: number[]; calls: number } {
  const seeds: number[] = [];
  return {
    seeds,
    calls: 0,
    generate(input) {
      this.calls++;
      seeds.push(input.seed);
      return Promise.resolve(candidate);
    },
  };
}

d("geo routes + geocode cache (real Postgres, fake ORS)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  const provider = fakeRouteProvider();
  let app: App | undefined;
  let cookieA = "",
    cookieB = "",
    userA = "";
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not run");
    return app;
  };
  const inject = (method: "GET" | "POST" | "PATCH" | "DELETE", path: string, access: string, body?: unknown) =>
    api().inject({
      method,
      url: path,
      cookies: access === "" ? {} : { accessToken: access },
      headers: body === undefined ? {} : { "content-type": "application/json" },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    });
  async function session(email: string) {
    const reg = await inject("POST", "/v1/auth/register", "", { email, password: PASSWORD, displayName: "P26b Fixture" });
    if (reg.statusCode !== 201) throw new Error(reg.body);
    const userId = reg.json<{ userId: string }>().userId;
    const login = await inject("POST", "/v1/auth/login", "", { email, password: PASSWORD });
    return { userId, access: login.cookies.find((c) => c.name === "accessToken")?.value ?? "" };
  }

  beforeAll(async () => {
    await sql`DELETE FROM runs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'p26b-%@example.com')`;
    await sql`DELETE FROM saved_routes WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'p26b-%@example.com')`;
    await sql`DELETE FROM api_cost_events WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'p26b-%@example.com')`;
    await sql`DELETE FROM users WHERE email LIKE 'p26b-%@example.com'`;
    await sql`DELETE FROM geo_cache WHERE lat3 = 1.234 AND lng3 = 5.678`;
    app = await buildApp(loadConfig(env), { redis, geo: { routeProvider: provider } });
    const a = await session("p26b-alice@example.com");
    userA = a.userId;
    cookieA = a.access;
    cookieB = (await session("p26b-bob@example.com")).access;
  }, 60_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    await sql.end({ timeout: 5 });
  });

  it("authn and validation run before the route_gen meter (a 400 burns no quota)", async () => {
    expect((await inject("POST", "/v1/geo/routes/generate", "", { lat: 12.9, lng: 77.5 })).statusCode).toBe(401);
    // Missing lat → 400 in validateGenerate; the quota preHandler never runs.
    expect((await inject("POST", "/v1/geo/routes/generate", cookieA, { lng: 77.5 })).statusCode).toBe(400);
    expect(await redis.get(quotaKey("route_gen", userA, "month", new Date()))).toBeNull();
  }, 30_000);

  it("count=3 → one quota slot, three cost rows, seeds ported [11,48,85] (v1 §9.3, CORRECTION 2)", async () => {
    const r = await session("p26b-router@example.com");
    provider.seeds.length = 0;
    const res = await inject("POST", "/v1/geo/routes/generate", r.access, { lat: 12.9, lng: 77.5, targetKm: 5, count: 3 });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<{ routes: unknown[] }>().routes).toHaveLength(3);
    expect(provider.seeds).toEqual([11, 48, 85]); // routing_provider.py:239
    expect(await redis.get(quotaKey("route_gen", r.userId, "month", new Date()))).toBe("1");
    const [row] = await sql<{ n: string }[]>`
      SELECT count(*) AS n FROM api_cost_events
      WHERE user_id = ${r.userId} AND feature = 'route_gen' AND provider = 'ors'`;
    expect(row?.n).toBe("3");
    const [cost] = await sql<{ cost_micro: string; units: string }[]>`
      SELECT cost_micro, units FROM api_cost_events WHERE user_id = ${r.userId} AND feature = 'route_gen' LIMIT 1`;
    expect(cost?.cost_micro).toBe("0");
    expect(Number(cost?.units)).toBe(1);
  }, 30_000);

  it("route_gen fails CLOSED when ORS_API_KEY is unset (no provider): 503", async () => {
    const app2 = await buildApp(loadConfig(env), { redis: createMemoryRedis() }); // no geo override, no ORS key
    try {
      const login = await app2.inject({
        method: "POST",
        url: "/v1/auth/login",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ email: "p26b-alice@example.com", password: PASSWORD }),
      });
      const access = login.cookies.find((c) => c.name === "accessToken")?.value ?? "";
      const res = await app2.inject({
        method: "POST",
        url: "/v1/geo/routes/generate",
        headers: { "content-type": "application/json" },
        cookies: { accessToken: access },
        payload: JSON.stringify({ lat: 12.9, lng: 77.5 }),
      });
      expect(res.statusCode).toBe(503);
    } finally {
      await app2.close();
    }
  }, 30_000);

  it("route_gen exhausts at the free monthly limit (2): 3rd request 429 (seed.ts:40)", async () => {
    const q = await session("p26b-quota@example.com");
    for (let i = 0; i < 2; i++) {
      expect((await inject("POST", "/v1/geo/routes/generate", q.access, { lat: 12.9, lng: 77.5, count: 1 })).statusCode).toBe(200);
    }
    const denied = await inject("POST", "/v1/geo/routes/generate", q.access, { lat: 12.9, lng: 77.5, count: 1 });
    expect(denied.statusCode).toBe(429);
    expect(denied.json<{ error: string }>().error).toBe("quota_exceeded");
  }, 30_000);

  it("Redis down: route_gen fails CLOSED with 503 and the provider is never called", async () => {
    const downRedis = createMemoryRedis();
    const p2 = fakeRouteProvider();
    const app2 = await buildApp(loadConfig(env), { redis: downRedis, geo: { routeProvider: p2 } });
    try {
      const login = await app2.inject({
        method: "POST",
        url: "/v1/auth/login",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ email: "p26b-alice@example.com", password: PASSWORD }),
      });
      const access = login.cookies.find((c) => c.name === "accessToken")?.value ?? "";
      downRedis.down = true;
      const res = await app2.inject({
        method: "POST",
        url: "/v1/geo/routes/generate",
        headers: { "content-type": "application/json" },
        cookies: { accessToken: access },
        payload: JSON.stringify({ lat: 12.9, lng: 77.5 }),
      });
      expect(res.statusCode).toBe(503);
      expect(p2.calls).toBe(0);
    } finally {
      await app2.close();
    }
  }, 30_000);

  it("saved_routes CRUD round-trip; a foreign user cannot read or delete another's route", async () => {
    const created = await inject("POST", "/v1/geo/saved-routes", cookieA, {
      name: "Morning loop",
      polyline: "abc_encoded_polyline_xyz",
      distanceM: 5200,
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json<{ savedRoute: { id: string } }>().savedRoute.id;

    const list = await inject("GET", "/v1/geo/saved-routes", cookieA);
    expect(list.statusCode).toBe(200);
    expect(list.json<{ items: { id: string }[] }>().items.some((r) => r.id === id)).toBe(true);

    expect((await inject("GET", `/v1/geo/saved-routes/${id}`, cookieA)).statusCode).toBe(200);
    // Cross-tenant: B is denied A's route on GET and DELETE (IDOR guard, R3.2).
    expect((await inject("GET", `/v1/geo/saved-routes/${id}`, cookieB)).statusCode).toBe(404);
    expect((await inject("DELETE", `/v1/geo/saved-routes/${id}`, cookieB)).statusCode).toBe(404);

    expect((await inject("DELETE", `/v1/geo/saved-routes/${id}`, cookieA)).statusCode).toBe(204);
    expect((await inject("GET", `/v1/geo/saved-routes/${id}`, cookieA)).statusCode).toBe(404);
  }, 30_000);

  it("saved_routes pagination: page 2 via nextCursor returns the remainder with no dupes (T3 finding 2)", async () => {
    // Locks geo's own nextCursor → cursorDecode → (created_at, id) row-comparison
    // round-trip (the house idiom is proven elsewhere; this covers it here).
    const p = await session("p26b-pager@example.com");
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await inject("POST", "/v1/geo/saved-routes", p.access, {
        name: `Route ${String(i)}`,
        polyline: `poly_${String(i)}`,
        distanceM: 1000 + i,
      });
      expect(res.statusCode, res.body).toBe(201);
      ids.push(res.json<{ savedRoute: { id: string } }>().savedRoute.id);
    }

    const page1 = await inject("GET", "/v1/geo/saved-routes?limit=2", p.access);
    expect(page1.statusCode).toBe(200);
    const b1 = page1.json<{ items: { id: string }[]; nextCursor: string | null }>();
    expect(b1.items).toHaveLength(2);
    expect(b1.nextCursor).not.toBeNull();

    const page2 = await inject(
      "GET",
      `/v1/geo/saved-routes?limit=2&cursor=${encodeURIComponent(b1.nextCursor ?? "")}`,
      p.access,
    );
    expect(page2.statusCode).toBe(200);
    const b2 = page2.json<{ items: { id: string }[]; nextCursor: string | null }>();
    expect(b2.items).toHaveLength(1);
    expect(b2.nextCursor).toBeNull(); // exhausted — no phantom next page

    const seen = [...b1.items, ...b2.items].map((r) => r.id);
    expect(new Set(seen).size).toBe(3); // no dupes across the page boundary
    expect(seen.slice().sort()).toEqual(ids.slice().sort()); // every route, exactly once
  }, 30_000);

  it("runs are read-only and own-user-only; polyline is detail-only and never leaks cross-tenant", async () => {
    // No record endpoint here (record/sync = P5) — seed a run directly.
    const [seeded] = await sql<{ id: string }[]>`
      INSERT INTO runs (id, user_id, started_at, duration_s, distance_m, polyline, route_name, source)
      VALUES (gen_random_uuid(), ${userA}, now(), 1800, 5000, 'secret_home_polyline', 'Evening run', 'mobile')
      RETURNING id`;
    const runId = seeded?.id ?? "";

    const list = await inject("GET", "/v1/geo/runs", cookieA);
    expect(list.statusCode).toBe(200);
    const listed = list.json<{ items: { id: string; routeName: string; polyline?: string }[] }>().items;
    const mine = listed.find((r) => r.id === runId);
    expect(mine?.routeName).toBe("Evening run");
    expect(mine?.polyline).toBeUndefined(); // summary carries no polyline

    const detail = await inject("GET", `/v1/geo/runs/${runId}`, cookieA);
    expect(detail.statusCode).toBe(200);
    expect(detail.json<{ run: { polyline: string } }>().run.polyline).toBe("secret_home_polyline");

    // Foreign user gets 404 for both the detail and thus the polyline.
    expect((await inject("GET", `/v1/geo/runs/${runId}`, cookieB)).statusCode).toBe(404);
  }, 30_000);

  it("two-layer geocode cache seam: miss→resolver→backfill Redis+Postgres; hits skip the resolver (G1)", async () => {
    let resolverCalls = 0;
    const resolver: GeocodeResolver = {
      provider: "test-geocoder",
      resolve: () => {
        resolverCalls++;
        return Promise.resolve("Jorhat, Assam");
      },
    };
    const lat = 1.2341;
    const lng = 5.6779; // round3 → 1.234 / 5.678

    // 1) Cold: resolver runs once, both layers populated.
    expect(await geocode({ sql, redis }, lat, lng, resolver)).toBe("Jorhat, Assam");
    expect(resolverCalls).toBe(1);
    expect(await redis.get(geoRedisKey(1.234, 5.678))).toBe("Jorhat, Assam");
    const [stored] = await sql<{ name: string; provider: string }[]>`
      SELECT name, provider FROM geo_cache WHERE lat3 = 1.234 AND lng3 = 5.678`;
    expect(stored?.name).toBe("Jorhat, Assam");
    expect(stored?.provider).toBe("test-geocoder");

    // 2) Warm Redis hit: resolver NOT called again.
    expect(await geocode({ sql, redis }, lat, lng, resolver)).toBe("Jorhat, Assam");
    expect(resolverCalls).toBe(1);

    // 3) Redis evicted but the Postgres floor holds: still no resolver call, Redis re-warmed.
    await redis.del(geoRedisKey(1.234, 5.678));
    expect(await geocode({ sql, redis }, lat, lng, resolver)).toBe("Jorhat, Assam");
    expect(resolverCalls).toBe(1);
    expect(await redis.get(geoRedisKey(1.234, 5.678))).toBe("Jorhat, Assam");
  }, 30_000);
});
