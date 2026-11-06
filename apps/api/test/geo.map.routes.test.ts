// GET /v1/geo/map (ROADMAP Stage 5 37b-i): the map the phones draw runs on. The same answer for every
// signed-in person, nothing about them in it, and nothing for somebody signed out.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { OPENFREEMAP, mapSourceResponseSchema } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");
const PASSWORD = "p37bi-safe-test-password-1"; // gitleaks:allow
const env = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "p37bi-test-secret-0123456789abcdef-32", // gitleaks:allow
  LOG_LEVEL: "error",
};
type App = Awaited<ReturnType<typeof buildApp>>;

d("the map under a run (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 3 });
  const apps: App[] = [];
  let ann = "";
  let bob = "";

  async function session(app: App, email: string): Promise<string> {
    const reg = await app.inject({ method: "POST", url: "/v1/auth/register", payload: { email, password: PASSWORD, displayName: "P37bi Fixture" } });
    if (reg.statusCode !== 201) throw new Error(reg.body);
    const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email, password: PASSWORD } });
    return login.cookies.find((c) => c.name === "accessToken")?.value ?? "";
  }
  const map = (app: App, access: string) => app.inject({ method: "GET", url: "/v1/geo/map", cookies: access === "" ? {} : { accessToken: access } });

  beforeAll(async () => {
    await sql`DELETE FROM users WHERE email LIKE 'p37bi-%@example.com'`;
    const app = await buildApp(loadConfig(env), { redis: createMemoryRedis() });
    apps.push(app);
    ann = await session(app, "p37bi-ann@example.com");
    bob = await session(app, "p37bi-bob@example.com");
    // Building the app and two sign-ups on a laptop just woken: more than the default ten seconds.
  }, 60_000);

  afterAll(async () => {
    for (const app of apps) await app.close();
    await sql`DELETE FROM users WHERE email LIKE 'p37bi-%@example.com'`;
    await sql.end();
  });

  it("is OpenFreeMap's, the same for two people, with nothing about either", async () => {
    const [app] = apps;
    if (app === undefined) throw new Error("beforeAll did not run");
    const a = await map(app, ann);
    const b = await map(app, bob);
    expect(a.statusCode).toBe(200);
    expect(mapSourceResponseSchema.parse(a.json())).toEqual({ map: OPENFREEMAP });
    expect(b.body).toBe(a.body);
    expect(a.body).not.toMatch(/p37bi|@example\.com|[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });

  it("is refused to somebody signed out", async () => {
    const [app] = apps;
    if (app === undefined) throw new Error("beforeAll did not run");
    const res = await map(app, "");
    expect(res.statusCode).toBe(401);
    expect(res.body).not.toContain("openfreemap");
  });

  it("moves every phone to our own copy once the server is switched", async () => {
    const switched = await buildApp(
      loadConfig({
        ...env,
        MAP_SOURCE: "protomaps",
        MAP_PROTOMAPS_FILE: "https://maps.example.org/world.pmtiles",
        MAP_PROTOMAPS_GLYPHS: "https://maps.example.org/fonts/{fontstack}/{range}.pbf",
      }),
      { redis: createMemoryRedis() },
    );
    apps.push(switched);
    const res = await map(switched, ann);
    expect(res.statusCode).toBe(200);
    expect(mapSourceResponseSchema.parse(res.json()).map).toMatchObject({ maker: "protomaps", tiles: "pmtiles://https://maps.example.org/world.pmtiles", sprite: null });
  });
});
