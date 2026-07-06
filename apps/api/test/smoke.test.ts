// Config fail-fast proof (R2.3): bad env = no boot, never a partial boot.
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const validEnv = {
  DATABASE_URL: "postgres://user:pw@localhost:5432/db",
  WEB_ORIGIN: "http://localhost:5173",
};

describe("loadConfig", () => {
  it("parses a valid env with defaults", () => {
    const c = loadConfig(validEnv);
    expect(c.PORT).toBe(3000);
    expect(c.NODE_ENV).toBe("development");
    expect(c.LOG_LEVEL).toBe("info");
  });

  it("coerces PORT from string", () => {
    expect(loadConfig({ ...validEnv, PORT: "8080" }).PORT).toBe(8080);
  });

  it("fails fast on missing DATABASE_URL", () => {
    expect(() => loadConfig({ WEB_ORIGIN: validEnv.WEB_ORIGIN })).toThrow(/DATABASE_URL/);
  });

  it("fails fast on a non-URL WEB_ORIGIN", () => {
    expect(() => loadConfig({ ...validEnv, WEB_ORIGIN: "not a url" })).toThrow(/WEB_ORIGIN/);
  });

  it("rejects unknown NODE_ENV", () => {
    expect(() => loadConfig({ ...validEnv, NODE_ENV: "staging" })).toThrow(/NODE_ENV/);
  });
});
