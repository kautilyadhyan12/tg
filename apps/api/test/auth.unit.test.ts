// P2.1 — no-DB unit tests: token crypto (R3.7 mechanics), cookie-flag matrix
// (GAP-2), config fail-fast for JWT_SECRET, timing-equalizer path (spy on the
// injectable hasher — wall-clock assertions would be flaky).
import { describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";
import { loadConfig } from "../src/config.js";
import {
  InvalidAccessTokenError,
  mintOpaqueToken,
  sha256Hex,
  signAccessToken,
  verifyAccessToken,
} from "../src/modules/auth/tokens.js";
import {
  argon2idHasher,
  AuthError,
  DUMMY_HASH,
  login,
  type AuthDeps,
  type PasswordHasher,
} from "../src/modules/auth/service.js";
import type { EmailSender } from "../src/modules/auth/email.js";

const SECRET = "unit-test-secret-0123456789abcdef-32+";
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://user:pw@localhost:5432/db",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: SECRET,
};
const config = loadConfig(baseEnv);
const USER = "33333333-3333-4333-8333-333333333333";

describe("config (P2.1 additions)", () => {
  it("requires JWT_SECRET of >= 32 chars", () => {
    expect(() => loadConfig({ ...baseEnv, JWT_SECRET: undefined })).toThrow(/JWT_SECRET/);
    expect(() => loadConfig({ ...baseEnv, JWT_SECRET: "short" })).toThrow(/JWT_SECRET/);
  });

  it("TTL defaults: access 15 min (v1 §6.1), refresh 30 days (jwtHelper.js:26)", () => {
    expect(config.ACCESS_TTL_MIN).toBe(15);
    expect(config.REFRESH_TTL_DAYS).toBe(30);
  });

  it("SYNC_DEV_USER_ID seam is gone: unknown keys are simply ignored, never honored", () => {
    // The P1.10d seam was deleted this task; loadConfig must not expose it.
    const c = loadConfig({ ...baseEnv, SYNC_DEV_USER_ID: USER });
    expect("SYNC_DEV_USER_ID" in c).toBe(false);
  });
});

describe("access JWT (R3.7)", () => {
  it("round-trips a signed access token", () => {
    const token = signAccessToken(USER, config);
    expect(verifyAccessToken(token, config)).toBe(USER);
  });

  it("pins algorithms to HS256: an HS512 token with the SAME secret is rejected", () => {
    const forged = jwt.sign({ sub: USER, typ: "access" }, SECRET, { algorithm: "HS512" });
    expect(() => verifyAccessToken(forged, config)).toThrow(InvalidAccessTokenError);
  });

  it("rejects alg=none tokens", () => {
    const [h, p] = jwt
      .sign({ sub: USER, typ: "access" }, SECRET, { algorithm: "HS256" })
      .split(".");
    const noneHeader = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
      "base64url",
    );
    expect(() => verifyAccessToken(`${noneHeader}.${p ?? ""}.`, config)).toThrow(
      InvalidAccessTokenError,
    );
    expect(h).toBeDefined();
  });

  it("rejects refresh-typed and untagged tokens on access paths (jwtHelper.js:31-40)", () => {
    const refreshTyped = jwt.sign({ sub: USER, typ: "refresh" }, SECRET, { algorithm: "HS256" });
    const legacyRefresh = jwt.sign({ id: USER, type: "refresh" }, SECRET, { algorithm: "HS256" });
    const untagged = jwt.sign({ sub: USER }, SECRET, { algorithm: "HS256" });
    for (const t of [refreshTyped, legacyRefresh, untagged]) {
      expect(() => verifyAccessToken(t, config)).toThrow(InvalidAccessTokenError);
    }
  });

  it("rejects expired tokens", () => {
    const expired = jwt.sign({ sub: USER, typ: "access" }, SECRET, {
      algorithm: "HS256",
      expiresIn: -10,
    });
    expect(() => verifyAccessToken(expired, config)).toThrow(InvalidAccessTokenError);
  });

  it("rejects tokens signed with a different secret", () => {
    const foreign = jwt.sign({ sub: USER, typ: "access" }, "another-secret-0123456789abcdef!!", {
      algorithm: "HS256",
    });
    expect(() => verifyAccessToken(foreign, config)).toThrow(InvalidAccessTokenError);
  });
});

describe("opaque tokens", () => {
  it("mints 32-byte hex tokens and hashes deterministically", () => {
    const t = mintOpaqueToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(mintOpaqueToken()).not.toBe(t);
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", // NIST SHA-256 vector
    );
  });
});

describe("argon2idHasher (verify-by-algo, needsRehash — v1 §6.1)", () => {
  // REAL bcrypt hash (bcryptjs cost 10) — the same fixture the routes suite
  // uses; proves argon2idHasher.verify still accepts legacy bcrypt hashes.
  const BCRYPT_HASH = "$2a$10$7RC6CyqeX8NLXY51YsTnvuFry32m77n7UwzWC5ukii0/bwoXmUSVO"; // gitleaks:allow
  const BCRYPT_PASSWORD = "legacy-Correct-Horse-9"; // dummy fixture, gitleaks:allow

  it("produces argon2id hashes with the OWASP params (m=19456,t=2,p=1)", async () => {
    const h = await argon2idHasher.hash("some-Password-1");
    expect(h).toMatch(/^\$argon2id\$/);
    expect(h).toContain("m=19456,t=2,p=1");
  });

  it("DUMMY_HASH is argon2id (timing equalizer)", () => {
    expect(DUMMY_HASH).toMatch(/^\$argon2id\$/);
  });

  it("verifies a REAL bcrypt hash under algo 'bcrypt'; rejects a wrong password", async () => {
    expect(await argon2idHasher.verify(BCRYPT_PASSWORD, BCRYPT_HASH, "bcrypt")).toBe(true);
    expect(await argon2idHasher.verify("wrong-password-x", BCRYPT_HASH, "bcrypt")).toBe(false);
  });

  it("round-trips an argon2id hash under algo 'argon2id'; rejects a wrong password", async () => {
    const h = await argon2idHasher.hash("round-Trip-2");
    expect(await argon2idHasher.verify("round-Trip-2", h, "argon2id")).toBe(true);
    expect(await argon2idHasher.verify("nope-3", h, "argon2id")).toBe(false);
  });

  it("needsRehash: bcrypt/null → upgrade, argon2id → no-op", () => {
    expect(argon2idHasher.needsRehash("bcrypt")).toBe(true);
    expect(argon2idHasher.needsRehash(null)).toBe(true);
    expect(argon2idHasher.needsRehash("argon2id")).toBe(false);
  });
});

describe("login timing equalizer (authController.js:14-18 port)", () => {
  const emailSender: EmailSender = {
    sendVerificationEmail: () => Promise.resolve(),
    sendPasswordResetEmail: () => Promise.resolve(),
  };

  it("unknown email STILL runs one dummy verify, then the uniform 401", async () => {
    const verify = vi.fn<PasswordHasher["verify"]>().mockResolvedValue(true);
    const hasher: PasswordHasher = {
      algo: "argon2id",
      hash: () => Promise.reject(new Error("unused")),
      verify,
      needsRehash: () => false,
    };
    // sql stub: user lookup returns no rows (unknown email). Runtime-guarded
    // narrow (R2.2): login's only sql use on this path is one tagged-template
    // SELECT, which this callable satisfies.
    const sqlStub = Object.assign(() => Promise.resolve([]), {}) as unknown;
    const logStub = { warn: () => undefined } as unknown;
    const deps = { sql: sqlStub, config, emailSender, hasher, log: logStub } as AuthDeps;
    await expect(
      login(deps, { email: "nobody@example.com", password: "wrong-password" }, { ip: null, userAgent: null }),
    ).rejects.toMatchObject({ statusCode: 401, code: "invalid_credentials" });
    expect(verify).toHaveBeenCalledTimes(1); // the dummy-hash verify ran
  });

  it("AuthError carries client-safe fields only", () => {
    const e = new AuthError(401, "invalid_credentials", "Invalid email or password");
    expect(e.statusCode).toBe(401);
    expect(JSON.stringify({ error: e.code, message: e.message })).not.toMatch(/hash|sql|stack/i);
  });
});
