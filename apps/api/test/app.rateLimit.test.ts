// The app-wide floor under every route (the security pass over "getting in",
// 2026-10-02): a gym's front desk and its members on the gym's wi-fi are ONE address,
// so the floor counts a signed-in person on their own and an address only for people
// who are not signed in. No database: the floor reads only the access token's signature,
// and the requests go to a route that does not exist, which is limited like any other.
import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { ACCESS_COOKIE, signAccessToken } from "../src/modules/auth/tokens.js";

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_URL: "postgres://nobody:nothing@127.0.0.1:1/void",
  WEB_ORIGIN: "http://localhost:5173",
  LOG_LEVEL: "error",
  JWT_SECRET: "rate-floor-test-secret-0123456789abcdef!",
});

const app = await buildApp(config);
afterAll(async () => {
  await app.close();
});

const GYM_WIFI = "203.0.113.9";
const person = (n: number): string =>
  signAccessToken(`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, config, `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`);

const ask = (address: string, token: string | null) =>
  app.inject({
    method: "GET",
    url: "/v1/no-such-route",
    remoteAddress: address,
    ...(token === null ? {} : { cookies: { [ACCESS_COOKIE]: token } }),
  });

describe("the app-wide floor", () => {
  it("lets fourteen signed-in people at one gym's wi-fi make 840 requests in a minute", async () => {
    const people = Array.from({ length: 14 }, (_, n) => person(n + 1));
    const codes: number[] = [];
    for (let round = 0; round < 60; round += 1) {
      for (const token of people) codes.push((await ask(GYM_WIFI, token)).statusCode);
    }
    expect(codes.filter((code) => code === 429)).toHaveLength(0);
  });

  it("stops one signed-in person past their own allowance, and says to wait", async () => {
    const token = person(99);
    let last = await ask("198.51.100.20", token);
    for (let n = 1; n < 601 && last.statusCode !== 429; n += 1) last = await ask("198.51.100.20", token);
    expect(last.statusCode).toBe(429);
    const body = last.json<{ error: string; message: string; retryAfterSeconds: number }>();
    expect(body.error).toBe("rate_limited");
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
    expect(body.message).toContain(`${String(body.retryAfterSeconds)} seconds`);
  });

  it("counts a token that does not verify as the address it came from", async () => {
    const forged = `${person(5).slice(0, -4)}AAAA`;
    const address = "198.51.100.77";
    const codes: number[] = [];
    for (let n = 0; n < 700; n += 1) codes.push((await ask(address, n % 2 === 0 ? forged : `${forged}${String(n)}`)).statusCode);
    expect(codes.filter((code) => code === 429).length).toBeGreaterThan(0);
  });
});
