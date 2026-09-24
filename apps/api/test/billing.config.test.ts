// Paddle's settings at boot (config.ts). The secret below has the shape of a real
// sandbox notification secret, which carries "/" (Kd's own, 2026-09-24); Paddle's
// documented example has none.
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const base = {
  DATABASE_URL: "postgres://x:y@localhost:5432/z",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "billing-config-secret-0123456789ab", // dummy, gitleaks:allow
};
// Fakes in Paddle's shapes, built at run time so no key-shaped text is in the repository.
const fakePaddleKey = (env: "sdbx" | "live") => ["pdl", env, "apikey", "01" + "a".repeat(24), "AbCdEfGhIjKlMnOpQrStUv", "Xyz"].join("_");
const SANDBOX_KEY = fakePaddleKey("sdbx");
const LIVE_KEY = fakePaddleKey("live");
const TOKEN = ["test", "0".repeat(27)].join("_");

describe("Paddle's settings", () => {
  it("takes a sandbox key, token and a secret carrying / + =", () => {
    const config = loadConfig({
      ...base,
      PADDLE_API_KEY: SANDBOX_KEY,
      PADDLE_CLIENT_TOKEN: TOKEN,
      PADDLE_WEBHOOK_SECRET: ["pdl", "ntfset", "01" + "b".repeat(24), "ab/cd+ef=gh"].join("_"),
    });
    expect(config.PADDLE_ENV).toBe("sandbox");
  });

  it("refuses a live key in sandbox, a token without its key, and a secret of another shape", () => {
    expect(() => loadConfig({ ...base, PADDLE_API_KEY: LIVE_KEY, PADDLE_CLIENT_TOKEN: TOKEN })).toThrow(/other Paddle environment/);
    expect(() => loadConfig({ ...base, PADDLE_CLIENT_TOKEN: TOKEN })).toThrow(/set together/);
    expect(() => loadConfig({ ...base, PADDLE_WEBHOOK_SECRET: "whsec_abc" })).toThrow(/PADDLE_WEBHOOK_SECRET/);
  });
});
