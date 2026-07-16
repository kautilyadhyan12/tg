// App skeleton tests via fastify.inject (no listening socket, no real DB
// needed except for /health, which pings — that case runs when DATABASE_URL
// is set, i.e. locally against Neon and in DB-enabled CI runs).
import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

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

  it("CORS: foreign origin gets no allow-origin", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/health",
      headers: { origin: "https://evil.example", "access-control-request-method": "GET" },
    });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rate limit: 301st request in a minute gets 429", async () => {
    // Dedicated client IP so this test's 301 requests don't drain the
    // default client's bucket for the other tests.
    let last = 0;
    for (let i = 0; i < 301; i++) {
      const res = await app.inject({ method: "GET", url: "/nope", remoteAddress: "10.9.9.9" });
      last = res.statusCode;
    }
    expect(last).toBe(429);
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
