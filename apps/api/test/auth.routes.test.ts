// P2.1 — auth routes against REAL Postgres (R9.2 — no SQL mocks).
// DATABASE_URL-gated like workouts.sync.test.ts; requires migrations
// 0001–0003 applied. Covers the R3.7 checklist end-to-end, the legacy-hash
// fixture (Part IV #11), rotation/reuse, one-time-token hashing, and the
// dual-keyed rate limits.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { EmailSender } from "../src/modules/auth/email.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

// REAL legacy hash, generated with the OLD repo's own dependency
// (backend-auth/node_modules/bcryptjs@2.4.3, hashSync cost 10) — proves the
// bcryptjs→bcryptjs@3 format compatibility with a fixture, not an assumption
// (Part IV #11). Password: 'legacy-Correct-Horse-9'. gitleaks:allow
const LEGACY_HASH = "$2a$10$7RC6CyqeX8NLXY51YsTnvuFry32m77n7UwzWC5ukii0/bwoXmUSVO"; // gitleaks:allow
const LEGACY_PASSWORD = "legacy-Correct-Horse-9"; // dummy fixture, gitleaks:allow
const LEGACY_EMAIL = "p21-legacy@example.com";

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

type App = Awaited<ReturnType<typeof buildApp>>;

/** Captures raw one-time tokens (stored only as SHA-256 — the DB cannot give
 *  them back; GAP-5 test seam via buildApp overrides). */
function capturingSender(): EmailSender & { verification: string[]; reset: string[] } {
  const verification: string[] = [];
  const reset: string[] = [];
  return {
    verification,
    reset,
    sendVerificationEmail: (_e, _n, raw) => {
      verification.push(raw);
      return Promise.resolve();
    },
    sendPasswordResetEmail: (_e, _n, raw) => {
      reset.push(raw);
      return Promise.resolve();
    },
  };
}

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "routes-test-secret-0123456789abcdef-32", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

let ipCounter = 0;
/** Unique client IP per call so per-IP limits never bleed across tests. */
const nextIp = () =>
  `10.1.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const post = (
  app: App,
  path: string,
  body: unknown,
  opts: { ip?: string; cookies?: Record<string, string>; headers?: Record<string, string> } = {},
) =>
  app.inject({
    method: "POST",
    url: path,
    remoteAddress: opts.ip ?? nextIp(),
    headers: { "content-type": "application/json", ...(opts.headers ?? {}) },
    cookies: opts.cookies ?? {},
    payload: JSON.stringify(body),
  });

const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

d("auth routes (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  let sender = capturingSender();
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  beforeAll(async () => {
    // Clean slate for this suite's fixtures (FK cascades clear tokens; the
    // workouts FK is RESTRICT, so a prior run's workouts go first — the
    // pattern also matches the sync suite's p21-sync-% users).
    await sql`DELETE FROM workouts WHERE user_id IN
      (SELECT id FROM users WHERE email LIKE 'p21-%@example.com')`;
    await sql`DELETE FROM users WHERE email LIKE 'p21-%@example.com'`;
    await sql`
      INSERT INTO users (email, password_hash, hash_algo, display_name)
      VALUES (${LEGACY_EMAIL}, ${LEGACY_HASH}, 'bcrypt', 'Legacy Fixture')`;
    sender = capturingSender();
    app = await buildApp(loadConfig(baseEnv), { emailSender: sender });
  }, 60_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    await sql.end({ timeout: 5 });
  });

  // ── legacy hash fixture + rehash-on-login (Part IV #11; v1 §6.1) ──────────
  it("verifies a REAL legacy bcryptjs hash on login, then rehashes it to argon2id", { timeout: 30_000 }, async () => {
    // Pre-state: the fixture was inserted as bcrypt.
    const [before] = await sql<{ hash_algo: string; password_hash: string }[]>`
      SELECT hash_algo, password_hash FROM users WHERE email = ${LEGACY_EMAIL}`;
    expect(before?.hash_algo).toBe("bcrypt");

    const res = await post(api(), "/v1/auth/login", {
      email: LEGACY_EMAIL,
      password: LEGACY_PASSWORD,
    });
    expect(res.statusCode).toBe(200);
    const cookies = cookieMap(res);
    expect(cookies["accessToken"]).toBeTruthy();
    expect(cookies["refreshToken"]).toBeTruthy();

    // Rehash-on-login upgraded the stored hash to argon2id (awaited before the
    // response, so it is observable now).
    const [after] = await sql<{ hash_algo: string; password_hash: string }[]>`
      SELECT hash_algo, password_hash FROM users WHERE email = ${LEGACY_EMAIL}`;
    expect(after?.hash_algo).toBe("argon2id");
    expect(after?.password_hash).toMatch(/^\$argon2id\$/);
    const upgraded = after?.password_hash;

    // Second login with the SAME password still works AND is a no-op: the hash
    // is byte-identical (needsRehash false → no re-write).
    const res2 = await post(api(), "/v1/auth/login", {
      email: LEGACY_EMAIL,
      password: LEGACY_PASSWORD,
    });
    expect(res2.statusCode).toBe(200);
    const [after2] = await sql<{ hash_algo: string; password_hash: string }[]>`
      SELECT hash_algo, password_hash FROM users WHERE email = ${LEGACY_EMAIL}`;
    expect(after2?.hash_algo).toBe("argon2id");
    expect(after2?.password_hash).toBe(upgraded);
  });

  // ── register ──────────────────────────────────────────────────────────────
  it("register: 201, argon2id hash stored, verification token hashed in DB", { timeout: 30_000 }, async () => {
    const res = await post(api(), "/v1/auth/register", {
      email: "p21-alice@example.com",
      password: PASSWORD,
      displayName: "Alice",
    });
    expect(res.statusCode).toBe(201);
    const { userId } = res.json<{ userId: string }>();

    const [u] = await sql<
      { password_hash: string; hash_algo: string }[]
    >`SELECT password_hash, hash_algo FROM users WHERE id = ${userId}`;
    expect(u?.hash_algo).toBe("argon2id");
    expect(u?.password_hash).toMatch(/^\$argon2id\$/); // v1 §6.1: new users are argon2id
    expect(u?.password_hash).not.toContain(PASSWORD);

    // One-time token stored as SHA-256 of the mailed raw token, never raw.
    const raw = sender.verification.at(-1);
    expect(raw).toMatch(/^[0-9a-f]{64}$/);
    const rows = await sql<
      { token_hash: string }[]
    >`SELECT token_hash FROM one_time_tokens WHERE user_id = ${userId} AND purpose = 'verify_email'`;
    expect(rows.length).toBe(1);
    expect(rows[0]?.token_hash).not.toBe(raw);
    expect(rows[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    // No body ever carries a token (DECISIONS 2026-07-11).
    expect(res.body).not.toContain(raw ?? "unreachable");
  });

  it("register: duplicate email (case-insensitive, citext) → 400", { timeout: 30_000 }, async () => {
    const res = await post(api(), "/v1/auth/register", {
      email: "P21-ALICE@EXAMPLE.COM",
      password: PASSWORD,
      displayName: "Alice Again",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe("email_taken");
  });

  it("register: validation 400 on unknown key / short password", async () => {
    const bad = [
      { email: "p21-v@example.com", password: PASSWORD, displayName: "V", extra: 1 },
      { email: "p21-v@example.com", password: "short", displayName: "V" },
    ];
    for (const b of bad) {
      const res = await post(api(), "/v1/auth/register", b);
      expect(res.statusCode).toBe(400);
      expect(res.json<{ error: string }>().error).toBe("validation_error");
    }
  });

  // ── login semantics (R3.7) ────────────────────────────────────────────────
  it("login: wrong password and unknown email are byte-identical 401s", { timeout: 30_000 }, async () => {
    const wrongPw = await post(api(), "/v1/auth/login", {
      email: "p21-alice@example.com",
      password: "wrong-password-123",
    });
    const noUser = await post(api(), "/v1/auth/login", {
      email: "p21-ghost@example.com",
      password: "wrong-password-123",
    });
    expect(wrongPw.statusCode).toBe(401);
    expect(noUser.statusCode).toBe(401);
    const a = wrongPw.json<Record<string, unknown>>();
    const b = noUser.json<Record<string, unknown>>();
    delete a["requestId"];
    delete b["requestId"];
    expect(a).toEqual(b); // never distinguishes no-user from wrong-password
  });

  it("login: cookie flags per GAP-2 (dev/test: httpOnly, lax, not secure)", { timeout: 30_000 }, async () => {
    const res = await post(api(), "/v1/auth/login", {
      email: "p21-alice@example.com",
      password: PASSWORD,
    });
    expect(res.statusCode).toBe(200);
    for (const c of res.cookies) {
      expect(c).toMatchObject({ httpOnly: true, sameSite: "Lax" });
      expect(c).not.toHaveProperty("secure", true);
    }
    // Access cookie expires with the 15-min token; refresh with the 30-day
    // one, and the refresh cookie travels only to /v1/auth (T3 DECISIONS).
    const access = res.cookies.find((c) => c.name === "accessToken");
    const refresh = res.cookies.find((c) => c.name === "refreshToken");
    expect(access?.maxAge).toBe(15 * 60);
    expect(access?.path).toBe("/");
    expect(refresh?.maxAge).toBe(30 * 24 * 60 * 60);
    expect(refresh?.path).toBe("/v1/auth");
  });

  // ── refresh rotation + reuse detection (v1 §6.1 / Part 4 §3.1) ───────────
  it("refresh: rotates (replaced_by set); REUSE of the old token kills the family", { timeout: 30_000 }, async () => {
    const login = await post(api(), "/v1/auth/login", {
      email: "p21-alice@example.com",
      password: PASSWORD,
    });
    const first = cookieMap(login)["refreshToken"] ?? "";

    const r1 = await post(api(), "/v1/auth/refresh", {}, { cookies: { refreshToken: first } });
    expect(r1.statusCode).toBe(204);
    const second = cookieMap(r1)["refreshToken"] ?? "";
    expect(second).not.toBe(first);

    // Rotation recorded: the old row is revoked and points at its successor.
    const rows = await sql<
      { revoked_at: Date | null; replaced_by: string | null }[]
    >`SELECT rt.revoked_at, rt.replaced_by FROM refresh_tokens rt
      JOIN users u ON u.id = rt.user_id
      WHERE u.email = 'p21-alice@example.com' AND rt.replaced_by IS NOT NULL`;
    expect(rows.length).toBeGreaterThan(0);

    // Reuse of the rotated-out token → 401 AND the family dies: the freshly
    // issued token stops working too.
    const reuse = await post(api(), "/v1/auth/refresh", {}, { cookies: { refreshToken: first } });
    expect(reuse.statusCode).toBe(401);
    const afterKill = await post(api(), "/v1/auth/refresh", {}, { cookies: { refreshToken: second } });
    expect(afterKill.statusCode).toBe(401);
  });

  it("refresh: CONCURRENT duplicate presentations → at most one 204, family fully dead after (T3 rotation race)", { timeout: 30_000 }, async () => {
    const login = await post(api(), "/v1/auth/login", {
      email: "p21-alice@example.com",
      password: PASSWORD,
    });
    const token = cookieMap(login)["refreshToken"] ?? "";
    // Same token presented twice in parallel: the transaction is the arbiter.
    const [r1, r2] = await Promise.all([
      post(api(), "/v1/auth/refresh", {}, { cookies: { refreshToken: token } }),
      post(api(), "/v1/auth/refresh", {}, { cookies: { refreshToken: token } }),
    ]);
    const successes = [r1, r2].filter((r) => r.statusCode === 204);
    expect(successes.length).toBeLessThanOrEqual(1);
    // Reuse was detected (the loser's 401 killed the family), so EVERY
    // surviving token — including the winner's fresh successor — is dead.
    for (const s of successes) {
      const fresh = cookieMap(s)["refreshToken"] ?? "";
      const after = await post(api(), "/v1/auth/refresh", {}, { cookies: { refreshToken: fresh } });
      expect(after.statusCode).toBe(401);
    }
    const original = await post(api(), "/v1/auth/refresh", {}, { cookies: { refreshToken: token } });
    expect(original.statusCode).toBe(401);
  });

  it("superseded one-time token is EXPIRED, not consumed: re-request invalidates the old link without faking verification (T3)", { timeout: 30_000 }, async () => {
    await post(api(), "/v1/auth/register", {
      email: "p21-supersede@example.com",
      password: PASSWORD,
      displayName: "Supersede",
    });
    const firstToken = sender.verification.at(-1) ?? "";
    // Issue a SECOND verification token directly (no resend route yet —
    // this is the repo-level contract the future resend feature will hit).
    const { createOneTimeToken } = await import("../src/modules/auth/repo.js");
    const { sha256Hex, mintOpaqueToken } = await import("../src/modules/auth/tokens.js");
    const [u] = await sql<{ id: string }[]>`
      SELECT id FROM users WHERE email = 'p21-supersede@example.com'`;
    const userId = u?.id ?? "";
    const secondRaw = mintOpaqueToken();
    await createOneTimeToken(sql, {
      userId,
      purpose: "verify_email",
      tokenHash: sha256Hex(secondRaw),
      expiresAt: new Date(Date.now() + 60_000),
    });
    // The superseded first token must NOT count as a consumed verification…
    const rows = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM one_time_tokens
      WHERE user_id = ${userId} AND purpose = 'verify_email' AND used_at IS NOT NULL`;
    expect(rows[0]?.n).toBe(0);
    // …and it no longer verifies; the fresh one does.
    expect((await post(api(), "/v1/auth/verify-email", { token: firstToken })).statusCode).toBe(400);
    const ok = await post(api(), "/v1/auth/verify-email", { token: secondRaw });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ user: { emailVerified: boolean } }>().user.emailVerified).toBe(true);
  });

  it("refresh: missing/garbage cookie → 401", async () => {
    expect((await post(api(), "/v1/auth/refresh", {})).statusCode).toBe(401);
    const garbage = await post(api(), "/v1/auth/refresh", {}, { cookies: { refreshToken: "ff".repeat(32) } });
    expect(garbage.statusCode).toBe(401);
  });

  it("access paths reject a refresh cookie value (R3.7 type separation)", { timeout: 30_000 }, async () => {
    const login = await post(api(), "/v1/auth/login", {
      email: "p21-alice@example.com",
      password: PASSWORD,
    });
    const refresh = cookieMap(login)["refreshToken"] ?? "";
    const res = await api().inject({
      method: "GET",
      url: "/v1/auth/me",
      remoteAddress: nextIp(),
      cookies: { accessToken: refresh }, // opaque refresh where a JWT belongs
    });
    expect(res.statusCode).toBe(401);
  });

  // ── me / authenticate plugin ──────────────────────────────────────────────
  it("GET /v1/auth/me: 401 dark without cookie; 200 with; Bearer works too", { timeout: 30_000 }, async () => {
    const anon = await api().inject({ method: "GET", url: "/v1/auth/me", remoteAddress: nextIp() });
    expect(anon.statusCode).toBe(401);

    const login = await post(api(), "/v1/auth/login", {
      email: "p21-alice@example.com",
      password: PASSWORD,
    });
    const access = cookieMap(login)["accessToken"] ?? "";
    const viaCookie = await api().inject({
      method: "GET",
      url: "/v1/auth/me",
      remoteAddress: nextIp(),
      cookies: { accessToken: access },
    });
    expect(viaCookie.statusCode).toBe(200);
    const user = viaCookie.json<{ user: { email: string; displayName: string } }>().user;
    expect(user.email).toBe("p21-alice@example.com");
    expect(user.displayName).toBe("Alice");

    const viaBearer = await api().inject({
      method: "GET",
      url: "/v1/auth/me",
      remoteAddress: nextIp(),
      headers: { authorization: `Bearer ${access}` },
    });
    expect(viaBearer.statusCode).toBe(200);
  });

  // ── verify-email ──────────────────────────────────────────────────────────
  it("verify-email: consumes the hashed token once, logs the user in, flips /me emailVerified", { timeout: 30_000 }, async () => {
    await post(api(), "/v1/auth/register", {
      email: "p21-vera@example.com",
      password: PASSWORD,
      displayName: "Vera",
    });
    const raw = sender.verification.at(-1) ?? "";
    const ok = await post(api(), "/v1/auth/verify-email", { token: raw });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ user: { emailVerified: boolean } }>().user.emailVerified).toBe(true);
    // Single-use: replay → 400.
    const replay = await post(api(), "/v1/auth/verify-email", { token: raw });
    expect(replay.statusCode).toBe(400);
  });

  // ── forgot / reset ────────────────────────────────────────────────────────
  it("forgot-password: identical 200 for known and unknown emails", { timeout: 30_000 }, async () => {
    const known = await post(api(), "/v1/auth/forgot-password", { email: "p21-alice@example.com" });
    const unknown = await post(api(), "/v1/auth/forgot-password", { email: "p21-nobody@example.com" });
    expect(known.statusCode).toBe(200);
    expect(unknown.statusCode).toBe(200);
    const a = known.json<Record<string, unknown>>();
    const b = unknown.json<Record<string, unknown>>();
    expect(a).toEqual(b);
  });

  it("reset-password: hashed single-use token, new pw works, ALL sessions revoked", { timeout: 30_000 }, async () => {
    const login = await post(api(), "/v1/auth/login", {
      email: "p21-alice@example.com",
      password: PASSWORD,
    });
    const oldRefresh = cookieMap(login)["refreshToken"] ?? "";

    await post(api(), "/v1/auth/forgot-password", { email: "p21-alice@example.com" });
    const raw = sender.reset.at(-1) ?? "";
    expect(raw).toMatch(/^[0-9a-f]{64}$/);
    // Stored hashed, never raw. Exactly one LIVE token: earlier ones are
    // superseded via expires_at=now() (not used_at — T3), so filter on expiry.
    const rows = await sql<{ token_hash: string }[]>`
      SELECT token_hash FROM one_time_tokens ot JOIN users u ON u.id = ot.user_id
      WHERE u.email = 'p21-alice@example.com' AND ot.purpose = 'password_reset'
        AND ot.used_at IS NULL AND ot.expires_at > now()`;
    expect(rows.length).toBe(1);
    expect(rows[0]?.token_hash).not.toBe(raw);

    const newPw = "brand-New-password-22";
    const reset = await post(api(), "/v1/auth/reset-password", { token: raw, password: newPw });
    expect(reset.statusCode).toBe(200);
    // Replay → 400 (single-use).
    const replay = await post(api(), "/v1/auth/reset-password", { token: raw, password: newPw });
    expect(replay.statusCode).toBe(400);
    // Old refresh session is dead ("log out everywhere").
    const dead = await post(api(), "/v1/auth/refresh", {}, { cookies: { refreshToken: oldRefresh } });
    expect(dead.statusCode).toBe(401);
    // New password logs in; old one doesn't.
    expect(
      (await post(api(), "/v1/auth/login", { email: "p21-alice@example.com", password: newPw }))
        .statusCode,
    ).toBe(200);
    expect(
      (await post(api(), "/v1/auth/login", { email: "p21-alice@example.com", password: PASSWORD }))
        .statusCode,
    ).toBe(401);
  });

  // ── change-password ───────────────────────────────────────────────────────
  it("change-password: requires authn + current pw; revokes other sessions", { timeout: 30_000 }, async () => {
    const pw = "brand-New-password-22"; // set by the reset test above
    const s1 = await post(api(), "/v1/auth/login", { email: "p21-alice@example.com", password: pw });
    const s2 = await post(api(), "/v1/auth/login", { email: "p21-alice@example.com", password: pw });
    const s1c = cookieMap(s1);
    const s2c = cookieMap(s2);

    const anon = await post(api(), "/v1/auth/change-password", {
      currentPassword: pw,
      newPassword: "yet-Another-password-33",
    });
    expect(anon.statusCode).toBe(401);

    const wrong = await post(
      api(),
      "/v1/auth/change-password",
      { currentPassword: "not-the-password-1", newPassword: "yet-Another-password-33" },
      { cookies: { accessToken: s1c["accessToken"] ?? "" } },
    );
    expect(wrong.statusCode).toBe(401);

    const ok = await post(
      api(),
      "/v1/auth/change-password",
      { currentPassword: pw, newPassword: "yet-Another-password-33" },
      { cookies: { accessToken: s1c["accessToken"] ?? "" } },
    );
    expect(ok.statusCode).toBe(200);
    // Session 2's refresh family was revoked; the fresh cookies from the
    // change-password response still work.
    const s2dead = await post(api(), "/v1/auth/refresh", {}, { cookies: { refreshToken: s2c["refreshToken"] ?? "" } });
    expect(s2dead.statusCode).toBe(401);
    const fresh = cookieMap(ok)["refreshToken"] ?? "";
    const freshWorks = await post(api(), "/v1/auth/refresh", {}, { cookies: { refreshToken: fresh } });
    expect(freshWorks.statusCode).toBe(204);
  });

  // ── logout ────────────────────────────────────────────────────────────────
  it("logout: clears cookies, revokes the family, and is idempotent", { timeout: 30_000 }, async () => {
    const pw = "yet-Another-password-33";
    const login = await post(api(), "/v1/auth/login", { email: "p21-alice@example.com", password: pw });
    const refresh = cookieMap(login)["refreshToken"] ?? "";
    const out = await post(api(), "/v1/auth/logout", {}, { cookies: { refreshToken: refresh } });
    expect(out.statusCode).toBe(200);
    for (const c of out.cookies) expect(c.value).toBe("");
    const dead = await post(api(), "/v1/auth/refresh", {}, { cookies: { refreshToken: refresh } });
    expect(dead.statusCode).toBe(401);
    // Idempotent — logging out again (or with no cookie) still 200s.
    expect((await post(api(), "/v1/auth/logout", {})).statusCode).toBe(200);
  });

  // ── rate limits (R3.7: per-IP AND per-identifier) ─────────────────────────
  it("login rate limit: 21st attempt from ONE IP → 429", { timeout: 60_000 }, async () => {
    const limited = await buildApp(loadConfig(baseEnv)); // fresh in-memory store
    const ip = "10.99.0.1";
    let last = 0;
    for (let i = 0; i < 21; i++) {
      const res = await post(limited, "/v1/auth/login", {
        email: `p21-ip-${String(i)}@example.com`, // distinct emails: only the IP key accumulates
        password: "wrong-password-123",
      }, { ip });
      last = res.statusCode;
    }
    expect(last).toBe(429);
    await limited.close();
  });

  it("login rate limit: 21st attempt on ONE email across MANY IPs → 429", { timeout: 60_000 }, async () => {
    const limited = await buildApp(loadConfig(baseEnv));
    let last = 0;
    for (let i = 0; i < 21; i++) {
      const res = await post(limited, "/v1/auth/login", {
        email: "p21-victim@example.com",
        password: "wrong-password-123",
      }, { ip: `10.98.${String(Math.floor(i / 250))}.${String((i % 250) + 1)}` });
      last = res.statusCode;
    }
    expect(last).toBe(429);
    await limited.close();
  });

  it("forgot-password rate limit: 6th request for ONE email across IPs → 429", { timeout: 30_000 }, async () => {
    const limited = await buildApp(loadConfig(baseEnv));
    let last = 0;
    for (let i = 0; i < 6; i++) {
      const res = await post(limited, "/v1/auth/forgot-password", {
        email: "p21-victim@example.com",
      }, { ip: `10.97.0.${String(i + 1)}` });
      last = res.statusCode;
    }
    expect(last).toBe(429);
    await limited.close();
  });
});
