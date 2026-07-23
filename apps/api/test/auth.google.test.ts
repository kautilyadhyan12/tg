// google-login card — Google OAuth routes against REAL Postgres (R9.2, no SQL
// mocks). DATABASE_URL-gated like the other db-backed suites; requires
// migrations 0001+ applied. A FAKE GoogleVerifier drives the full flow so no
// test ever calls Google (the emailSender test-seam precedent). Covers: new
// user, returning identity (idempotent), same-email account linking (password
// untouched), state/exchange failures, the redirect + cookie contract, and the
// not-configured guard.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { GoogleIdentity, GoogleVerifier } from "../src/modules/auth/google.js";
import { ACCESS_COOKIE, OAUTH_STATE_COOKIE } from "../src/modules/auth/tokens.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

type App = Awaited<ReturnType<typeof buildApp>>;

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "google-test-secret-0123456789abcdef-32", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

let ipCounter = 0;
const nextIp = () =>
  `10.7.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

// The fake: `code` → identity via a mutable map the tests populate. An unknown
// code rejects, exercising the exchange-failure path.
const identities = new Map<string, GoogleIdentity>();
const fakeVerifier: GoogleVerifier = {
  authUrl: (state) => `https://accounts.google.test/o/oauth2/v2/auth?state=${encodeURIComponent(state)}`,
  exchange: (code) => {
    const id = identities.get(code);
    return id === undefined ? Promise.reject(new Error("unknown code")) : Promise.resolve(id);
  },
};

const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const get = (
  app: App,
  path: string,
  opts: { ip?: string; cookies?: Record<string, string> } = {},
) =>
  app.inject({
    method: "GET",
    url: path,
    remoteAddress: opts.ip ?? nextIp(),
    cookies: opts.cookies ?? {},
  });

const post = (app: App, path: string, body: unknown) =>
  app.inject({
    method: "POST",
    url: path,
    remoteAddress: nextIp(),
    headers: { "content-type": "application/json" },
    payload: JSON.stringify(body),
  });

d("google oauth routes (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined; // configured (fake verifier)
  let unconfigured: App | undefined; // no verifier → null
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  beforeAll(async () => {
    // Isolate this suite's fixtures (FK cascades clear identities/tokens).
    await sql`DELETE FROM users WHERE email LIKE 'glogin-%@example.com'`;
    const config = loadConfig(baseEnv);
    app = await buildApp(config, { googleVerifier: fakeVerifier });
    unconfigured = await buildApp(config, {});
  });

  afterAll(async () => {
    await app?.close();
    await unconfigured?.close();
    await sql`DELETE FROM users WHERE email LIKE 'glogin-%@example.com'`;
    await sql.end({ timeout: 5 });
  });

  /** Run the full round-trip for `identity` under `code`; returns the callback
   *  response (302 to /auth/google/success on success). */
  async function googleLogin(identity: GoogleIdentity, code: string) {
    identities.set(code, identity);
    const r1 = await get(api(), "/v1/auth/google");
    const state = cookieMap(r1)[OAUTH_STATE_COOKIE];
    if (state === undefined || state === "") throw new Error("no state cookie issued");
    return get(api(), `/v1/auth/google/callback?code=${code}&state=${encodeURIComponent(state)}`, {
      cookies: { [OAUTH_STATE_COOKIE]: state },
    });
  }

  const meWith = (accessToken: string) => get(api(), "/v1/auth/me", { cookies: { [ACCESS_COOKIE]: accessToken } });

  it("step 1 redirects to Google and sets a state cookie", { timeout: 30_000 }, async () => {
    const res = await get(api(), "/v1/auth/google");
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain("accounts.google.test");
    const state = cookieMap(res)[OAUTH_STATE_COOKIE];
    expect(state).toBeTruthy();
    expect(res.headers.location).toContain(encodeURIComponent(state ?? ""));
  });

  it("new user: creates the account, sets session cookies, email is verified", { timeout: 30_000 }, async () => {
    const identity: GoogleIdentity = { subject: "glogin-sub-new", email: "glogin-new@example.com", name: "New Person" };
    const res = await googleLogin(identity, "code-new");
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${baseEnv.WEB_ORIGIN}/auth/google/success`);

    const access = cookieMap(res)[ACCESS_COOKIE];
    expect(access).toBeTruthy();

    const me = await meWith(access ?? "");
    expect(me.statusCode).toBe(200);
    const body = me.json<{ user: { id: string; email: string; displayName: string; emailVerified: boolean } }>();
    expect(body.user.email).toBe("glogin-new@example.com");
    expect(body.user.displayName).toBe("New Person");
    expect(body.user.emailVerified).toBe(true); // Google-asserted (verified marker)

    const users = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = 'glogin-new@example.com'`;
    expect(users.length).toBe(1);
    const idents = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM auth_identities WHERE provider='google' AND subject='glogin-sub-new'`;
    expect(idents[0]?.n).toBe(1);
  });

  it("returning identity: logs in the same user, no duplicate user or identity", { timeout: 30_000 }, async () => {
    const identity: GoogleIdentity = { subject: "glogin-sub-new", email: "glogin-new@example.com", name: "New Person" };
    const res = await googleLogin(identity, "code-return");
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${baseEnv.WEB_ORIGIN}/auth/google/success`);

    const users = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM users WHERE email = 'glogin-new@example.com'`;
    expect(users[0]?.n).toBe(1);
    const idents = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM auth_identities WHERE provider='google' AND subject='glogin-sub-new'`;
    expect(idents[0]?.n).toBe(1); // link is idempotent (ON CONFLICT DO NOTHING)
  });

  it("existing password account: Google links to it and the password still works", { timeout: 30_000 }, async () => {
    const email = "glogin-link@example.com";
    const reg = await post(api(), "/v1/auth/register", { email, password: PASSWORD, displayName: "Pw Person" });
    expect(reg.statusCode).toBe(201);
    const registeredId = reg.json<{ userId: string }>().userId;

    const res = await googleLogin({ subject: "glogin-sub-link", email, name: "Google Name" }, "code-link");
    expect(res.statusCode).toBe(302);
    const access = cookieMap(res)[ACCESS_COOKIE];
    const me = await meWith(access ?? "");
    expect(me.json<{ user: { id: string } }>().user.id).toBe(registeredId); // same account, linked

    // Password login STILL works — linking never touched the password.
    const pwLogin = await post(api(), "/v1/auth/login", { email, password: PASSWORD });
    expect(pwLogin.statusCode).toBe(200);

    const users = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM users WHERE email = ${email}`;
    expect(users[0]?.n).toBe(1); // linked, not duplicated
  });

  it("exchange failure (bad code) → clean login redirect, no 500", { timeout: 30_000 }, async () => {
    const r1 = await get(api(), "/v1/auth/google");
    const state = cookieMap(r1)[OAUTH_STATE_COOKIE] ?? "";
    const res = await get(api(), `/v1/auth/google/callback?code=nonexistent&state=${encodeURIComponent(state)}`, {
      cookies: { [OAUTH_STATE_COOKIE]: state },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${baseEnv.WEB_ORIGIN}/login?error=google_failed`);
  });

  it("state mismatch → login redirect, exchange never attempted", { timeout: 30_000 }, async () => {
    identities.set("code-state", { subject: "glogin-sub-x", email: "glogin-x@example.com", name: "X" });
    const r1 = await get(api(), "/v1/auth/google");
    const realState = cookieMap(r1)[OAUTH_STATE_COOKIE] ?? "";
    // Query state does NOT match the cookie state.
    const res = await get(api(), `/v1/auth/google/callback?code=code-state&state=tampered`, {
      cookies: { [OAUTH_STATE_COOKIE]: realState },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${baseEnv.WEB_ORIGIN}/login?error=google_failed`);
    // The account was never created (exchange was gated out).
    const users = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM users WHERE email = 'glogin-x@example.com'`;
    expect(users[0]?.n).toBe(0);
  });

  it("callback rate limit: 21st attempt from ONE IP → 429 (R3.7)", { timeout: 30_000 }, async () => {
    const ip = "10.7.99.99"; // dedicated so no other test shares this bucket
    let last: Awaited<ReturnType<typeof get>> | undefined;
    // Bad state → the limiter (preHandler) runs before the handler; no DB work.
    for (let i = 0; i < 21; i++) {
      last = await get(api(), "/v1/auth/google/callback?code=x&state=y", { ip });
    }
    expect(last?.statusCode).toBe(429);
  });

  it("not configured: both routes redirect with google_not_configured", { timeout: 30_000 }, async () => {
    if (unconfigured === undefined) throw new Error("unconfigured app not built");
    const start = await get(unconfigured, "/v1/auth/google");
    expect(start.statusCode).toBe(302);
    expect(start.headers.location).toBe(`${baseEnv.WEB_ORIGIN}/login?error=google_not_configured`);
    const cb = await get(unconfigured, "/v1/auth/google/callback?code=x&state=y");
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toBe(`${baseEnv.WEB_ORIGIN}/login?error=google_not_configured`);
  });
});
