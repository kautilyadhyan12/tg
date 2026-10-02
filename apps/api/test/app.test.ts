// App skeleton tests via fastify.inject (no listening socket, no real DB
// needed except for /health, which pings — that case runs when DATABASE_URL
// is set, i.e. locally against Neon and in DB-enabled CI runs).
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { ACCESS_COOKIE, signAccessToken } from "../src/modules/auth/tokens.js";

const WEB_ORIGIN = "http://localhost:5173";
const realDbUrl = process.env["DATABASE_URL"];

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_URL: realDbUrl ?? "postgres://nobody:nothing@127.0.0.1:1/void",
  WEB_ORIGIN,
  LOG_LEVEL: "error",
  JWT_SECRET: "app-test-secret-0123456789abcdef-32!", // required since P2.1
});

const app = await buildApp(config);
afterAll(async () => {
  await app.close();
});

describe("api skeleton", () => {
  it("unknown route → 404 with the typed error shape, no internals", async () => {
    const res = await app.inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(404);
    const body = res.json<{ error: string; message: string; requestId: string }>();
    expect(body.error).toBeDefined();
    expect(body.requestId).toBeDefined();
    expect(JSON.stringify(body)).not.toMatch(/stack/i);
  });

  it("CORS: configured origin gets credentialed headers", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/health",
      headers: { origin: WEB_ORIGIN, "access-control-request-method": "GET" },
    });
    expect(res.headers["access-control-allow-origin"]).toBe(WEB_ORIGIN);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("CORS: preflight allows DELETE/PATCH/PUT — the API's own route surface", async () => {
    // Found by the Card 4 browser smoke (2026-07-16): @fastify/cors v11
    // defaults methods to 'GET,HEAD,POST', so every browser DELETE/PATCH/PUT
    // (coach thread delete, PATCH /v1/users/me, measurements CRUD, DPDP
    // DELETE /v1/users/me) failed preflight and never left the browser.
    // inject() bypasses CORS, which is why no route test ever saw it.
    for (const method of ["DELETE", "PATCH", "PUT"]) {
      const res = await app.inject({
        method: "OPTIONS",
        url: "/v1/users/me",
        headers: { origin: WEB_ORIGIN, "access-control-request-method": method },
      });
      expect(
        res.headers["access-control-allow-methods"],
        `preflight must allow ${method}`,
      ).toContain(method);
    }
  });

  it("CORS: Idempotent-Replay is EXPOSED, or browser JS cannot read it", async () => {
    // Same structural blind spot as the Card 4 preflight bug, one layer along:
    // @fastify/cors emits Access-Control-Expose-Headers ONLY when
    // exposedHeaders is set (index.js:232-237) and the default is null, so the
    // coach replay marker would be sent by the server and be invisible to the
    // client. A route test asserting res.headers["idempotent-replay"] passes
    // either way, because inject() bypasses CORS entirely — this assertion is
    // the only kind that can see it.
    const res = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: WEB_ORIGIN },
    });
    expect(res.headers["access-control-expose-headers"]).toContain("Idempotent-Replay");
  });

  it("CORS: foreign origin gets no allow-origin", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/health",
      headers: { origin: "https://evil.example", "access-control-request-method": "GET" },
    });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  // The floor counts a signed-in person against themselves and everyone else against the
  // internet address (ROADMAP Stage 4 item 10: a whole gym on one wi-fi).
  const hit = (ip: string, cookies: Record<string, string> = {}) =>
    app.inject({ method: "GET", url: "/nope", remoteAddress: ip, cookies });
  const hits = async (n: number, ip: string, cookies: Record<string, string> = {}) => {
    const codes: number[] = [];
    for (let i = 0; i < n; i++) codes.push((await hit(ip, cookies)).statusCode);
    return codes;
  };

  it("rate limit: nobody signed in — the address's 1,001st request in a minute gets 429", async () => {
    // Dedicated client IP so this test's requests don't drain the
    // default client's bucket for the other tests.
    const codes = await hits(1001, "10.9.9.9");
    expect(codes.slice(0, 1000).every((c) => c === 404)).toBe(true);
    expect(codes[1000]).toBe(429);
  });

  it("rate limit: two signed-in people at ONE address each get their own 300 a minute, and the address's own count is untouched", async () => {
    const ip = "10.9.9.10";
    const one = { [ACCESS_COOKIE]: signAccessToken(randomUUID(), config, randomUUID()) };
    const two = { [ACCESS_COOKIE]: signAccessToken(randomUUID(), config, randomUUID()) };
    const first = await hits(301, ip, one);
    expect(first.slice(0, 300).every((c) => c === 404)).toBe(true);
    expect(first[300]).toBe(429);
    expect((await hits(300, ip, two)).every((c) => c === 404)).toBe(true);
    expect((await hit(ip)).statusCode).toBe(404);
  });

  it("rate limit: a token that does not check out counts against the address", async () => {
    const ip = "10.9.9.11";
    const forged = { [ACCESS_COOKIE]: signAccessToken(randomUUID(), { ...config, JWT_SECRET: "another-secret-0123456789abcdef-32!!" }, randomUUID()) };
    expect((await hits(1000, ip, forged)).every((c) => c === 404)).toBe(true);
    expect((await hit(ip, { [ACCESS_COOKIE]: "not-a-token" })).statusCode).toBe(429);
    expect((await hit(ip)).statusCode).toBe(429);
  });

  it("CORS: a browser may remember the answer to its pre-check for two hours", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/v1/users/me",
      headers: { origin: WEB_ORIGIN, "access-control-request-method": "PATCH" },
    });
    expect(res.headers["access-control-max-age"]).toBe("7200");
  });

  it("CORS: a browser's pre-checks are answered before the floor, and spend none of the address's", async () => {
    const ip = "10.9.9.12";
    for (let i = 0; i < 1001; i++) {
      const pre = await app.inject({
        method: "OPTIONS",
        url: "/v1/users/me",
        remoteAddress: ip,
        headers: { origin: WEB_ORIGIN, "access-control-request-method": "PATCH" },
      });
      expect(pre.statusCode).toBe(204);
    }
    expect((await hit(ip)).statusCode).toBe(404);
  });

  it.skipIf(realDbUrl === undefined || realDbUrl === "")(
    "/health pings the database and returns ok",
    async () => {
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ status: string }>().status).toBe("ok");
    },
  );
});
