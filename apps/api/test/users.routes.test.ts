// P2.2 — users/profile routes against REAL Postgres (R9.2 — no SQL mocks).
// DATABASE_URL-gated; requires migrations 0001–0004 applied. Covers: full
// profile + derived emailVerified, PATCH (validation, GAP-2 weight history),
// cross-user isolation (R3.2/R9.2 denial proof), DPDP Day-0 delete
// (Part 4 §5.2) incl. the CORRECTION-2 verification that a deleted user's
// still-unexpired access token and refresh token both 401, and the 14-day
// restore flow (window enforced in the DB, not just the token TTL).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { EmailSender } from "../src/modules/auth/email.js";
import type { UsersEmailSender } from "../src/modules/users/email.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "users-test-secret-0123456789abcdef-32", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;

function capturingAuthSender(): EmailSender & { verification: string[] } {
  const verification: string[] = [];
  return {
    verification,
    sendVerificationEmail: (_e, _n, raw) => {
      verification.push(raw);
      return Promise.resolve();
    },
    sendPasswordResetEmail: () => Promise.resolve(),
    sendSignInCodeEmail: () => Promise.resolve(),
  };
}

function capturingUsersSender(): UsersEmailSender & { restore: string[]; codes: string[] } {
  const restore: string[] = [];
  const codes: string[] = [];
  return {
    restore,
    codes,
    sendAccountDeletionEmail: (_e, _n, raw) => {
      restore.push(raw);
      return Promise.resolve();
    },
    sendAccountDeleteCodeEmail: (_e, code) => {
      codes.push(code);
      return Promise.resolve();
    },
  };
}

let ipCounter = 0;
const nextIp = () =>
  `10.2.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

d("users routes (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const authSender = capturingAuthSender();
  const usersSender = capturingUsersSender();
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const inject = (opts: {
    method: "GET" | "POST" | "PATCH" | "DELETE";
    url: string;
    body?: unknown;
    cookies?: Record<string, string>;
  }) =>
    api().inject({
      method: opts.method,
      url: opts.url,
      remoteAddress: nextIp(),
      // content-type only WITH a body: an empty JSON-typed body is a 400
      // (FST_ERR_CTP_EMPTY_JSON_BODY) — DELETE carries no body.
      headers: opts.body !== undefined ? { "content-type": "application/json" } : {},
      cookies: opts.cookies ?? {},
      ...(opts.body !== undefined ? { payload: JSON.stringify(opts.body) } : {}),
    });

  /** The two-step delete (2026-09-07): ask for the code, then prove it. */
  const deleteMe = async (cookies: Record<string, string>) => {
    const sent = await inject({ method: "POST", url: "/v1/users/me/delete-code", cookies });
    expect(sent.statusCode).toBe(200);
    const code = usersSender.codes[usersSender.codes.length - 1];
    return await inject({ method: "DELETE", url: "/v1/users/me", cookies, body: { code } });
  };

  /** register + login; returns userId and the session cookies. */
  const makeUser = async (email: string, displayName = "P22 Fixture") => {
    const reg = await inject({
      method: "POST",
      url: "/v1/auth/register",
      body: { email, password: PASSWORD, displayName },
    });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await inject({
      method: "POST",
      url: "/v1/auth/login",
      body: { email, password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };

  beforeAll(async () => {
    await sql`DELETE FROM workouts WHERE user_id IN
      (SELECT id FROM users WHERE email LIKE 'p22u-%@example.com')`;
    await sql`DELETE FROM gym_members WHERE user_id IN
      (SELECT id FROM users WHERE email LIKE 'p22u-%@example.com')`;
    await sql`DELETE FROM gyms WHERE slug = 'p22u-test-gym'`;
    await sql`DELETE FROM users WHERE email LIKE 'p22u-%@example.com'`;
    app = await buildApp(loadConfig(baseEnv), {
      emailSender: authSender,
      usersEmailSender: usersSender,
    });
  }, 60_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    await sql.end({ timeout: 5 });
  });

  it("GET /v1/users/me requires authentication", { timeout: 30_000 }, async () => {
    const res = await inject({ method: "GET", url: "/v1/users/me" });
    expect(res.statusCode).toBe(401);
  });

  it("returns the FULL profile; emailVerified derives from the consumed verify token", { timeout: 30_000 }, async () => {
    const { cookies } = await makeUser("p22u-profile@example.com", "Profile Person");
    const before = await inject({ method: "GET", url: "/v1/users/me", cookies });
    expect(before.statusCode).toBe(200);
    const b = JSON.parse(before.body) as { user: Record<string, unknown> };
    expect(b.user).toMatchObject({
      email: "p22u-profile@example.com",
      displayName: "Profile Person",
      emailVerified: false,
      locale: "en",
      units: "metric",
      timezone: null,
      weightKg: null,
      leaderboardOptOut: false,
    });
    expect(typeof b.user["createdAt"]).toBe("string");

    const rawToken = authSender.verification[authSender.verification.length - 1];
    expect(rawToken).toBeTruthy();
    const verify = await inject({
      method: "POST",
      url: "/v1/auth/verify-email",
      body: { token: rawToken },
    });
    expect(verify.statusCode).toBe(200);

    const after = await inject({ method: "GET", url: "/v1/users/me", cookies });
    expect((JSON.parse(after.body) as { user: { emailVerified: boolean } }).user.emailVerified).toBe(true);
  });

  it("PATCH's weight becomes a self-reported measurement; the same number twice writes one row", { timeout: 30_000 }, async () => {
    const { userId, cookies } = await makeUser("p22u-patch@example.com");
    const res = await inject({
      method: "PATCH",
      url: "/v1/users/me",
      cookies,
      body: {
        displayName: "Patched Name",
        locale: "hi",
        units: "imperial",
        timezone: "Asia/Kolkata",
        weightKg: 72.5,
        leaderboardOptOut: true,
      },
    });
    expect(res.statusCode).toBe(200);
    expect((JSON.parse(res.body) as { user: Record<string, unknown> }).user).toMatchObject({
      displayName: "Patched Name",
      locale: "hi",
      units: "imperial",
      timezone: "Asia/Kolkata",
      weightKg: 72.5,
      leaderboardOptOut: true,
    });

    const count = async () =>
      (await sql<{ n: string }[]>`
        SELECT count(*) AS n FROM body_measurements WHERE user_id = ${userId}`)[0]?.n;
    // A typed weight is a measurement of its own (Kd ruling 2026-09-10): the
    // number on the profile is always the latest weighed row, so a deleted
    // mis-entry has something true to fall back to.
    expect(await count()).toBe("1");
    const history = await inject({ method: "GET", url: "/v1/nutrition/body-measurements", cookies });
    expect(history.statusCode).toBe(200);
    expect(
      (JSON.parse(history.body) as { items: { weightKg: number; source: string }[] }).items,
    ).toEqual([expect.objectContaining({ weightKg: 72.5, source: "self_reported" })]);

    // Same weight again → no new history row.
    const same = await inject({ method: "PATCH", url: "/v1/users/me", cookies, body: { weightKg: 72.5 } });
    expect(same.statusCode).toBe(200);
    expect(await count()).toBe("1");

    // Changed weight → appended.
    const changed = await inject({ method: "PATCH", url: "/v1/users/me", cookies, body: { weightKg: 73 } });
    expect(changed.statusCode).toBe(200);
    expect(await count()).toBe("2");

    // Clearing to null → profile null, nothing appended and nothing removed:
    // clearing is about the number on screen, not the history.
    const cleared = await inject({ method: "PATCH", url: "/v1/users/me", cookies, body: { weightKg: null } });
    expect(cleared.statusCode).toBe(200);
    expect((JSON.parse(cleared.body) as { user: { weightKg: null } }).user.weightKg).toBeNull();
    expect(await count()).toBe("2");
  });

  it("PATCH rejects unknown keys, bad enum values, and an empty body", { timeout: 30_000 }, async () => {
    const { cookies } = await makeUser("p22u-badpatch@example.com");
    for (const body of [{ email: "evil@example.com" }, { units: "stone" }, {}]) {
      const res = await inject({ method: "PATCH", url: "/v1/users/me", cookies, body });
      expect(res.statusCode).toBe(400);
    }
  });

  it("cross-user isolation: A's PATCH/DELETE never touches B (R3.2 denial proof)", { timeout: 30_000 }, async () => {
    const a = await makeUser("p22u-alice@example.com");
    const b = await makeUser("p22u-bob@example.com", "Bob Untouched");

    const snapshot = async () =>
      (await sql`SELECT display_name, status, deleted_at FROM users WHERE id = ${b.userId}`)[0];
    const before = await snapshot();

    const patch = await inject({
      method: "PATCH",
      url: "/v1/users/me",
      cookies: a.cookies,
      body: { displayName: "Alice Renamed" },
    });
    expect(patch.statusCode).toBe(200);
    const del = await deleteMe(a.cookies);
    expect(del.statusCode).toBe(200);

    expect(await snapshot()).toEqual(before); // B is byte-identical
    const bMe = await inject({ method: "GET", url: "/v1/users/me", cookies: b.cookies });
    expect(bMe.statusCode).toBe(200);
    expect((JSON.parse(bMe.body) as { user: { displayName: string } }).user.displayName).toBe("Bob Untouched");
  });

  it("DELETE runs the §5.2 Day-0 flow; deleted user 401s on authenticate AND refresh (CORRECTION 2)", { timeout: 30_000 }, async () => {
    const { userId, cookies } = await makeUser("p22u-delete@example.com");
    // Fixtures the Day-0 flow must touch: a membership and a push token.
    const gymRows = await sql<{ id: string }[]>`
      INSERT INTO gyms (slug, name, owner_user_id) VALUES ('p22u-test-gym', 'P22 Gym', ${userId})
      RETURNING id`;
    const gymId = gymRows[0]?.id;
    if (gymId === undefined) throw new Error("gym fixture insert failed");
    await sql`INSERT INTO gym_members (gym_id, user_id) VALUES (${gymId}, ${userId})`;
    await sql`INSERT INTO push_tokens (user_id, token, platform) VALUES (${userId}, 'p22u-push-token', 'android')`;

    // No code, or a wrong one, deletes nothing — the account stays active.
    const bare = await inject({ method: "DELETE", url: "/v1/users/me", cookies });
    expect(bare.statusCode).toBe(400);
    await inject({ method: "POST", url: "/v1/users/me/delete-code", cookies });
    const wrong = await inject({ method: "DELETE", url: "/v1/users/me", cookies, body: { code: "000000" } });
    expect(wrong.statusCode).toBe(400);
    expect((await sql<{ status: string }[]>`SELECT status FROM users WHERE id = ${userId}`)[0]?.status).toBe("active");

    const code = usersSender.codes[usersSender.codes.length - 1];
    const del = await inject({ method: "DELETE", url: "/v1/users/me", cookies, body: { code } });
    expect(del.statusCode).toBe(200);

    const row = (await sql<{ status: string; deleted_at: Date | null }[]>`
      SELECT status, deleted_at FROM users WHERE id = ${userId}`)[0];
    expect(row?.status).toBe("deleted");
    expect(row?.deleted_at).not.toBeNull();
    expect(
      (await sql`SELECT 1 FROM gym_members WHERE user_id = ${userId} AND removed_at IS NULL`).length,
    ).toBe(0);
    expect((await sql`SELECT 1 FROM push_tokens WHERE user_id = ${userId}`).length).toBe(0);
    expect(
      (await sql`SELECT 1 FROM refresh_tokens WHERE user_id = ${userId} AND revoked_at IS NULL`).length,
    ).toBe(0);

    // CORRECTION 2: the still-unexpired ACCESS token must 401 (plugin's
    // status check), and the refresh cookie must 401 (service status check).
    const me = await inject({ method: "GET", url: "/v1/users/me", cookies });
    expect(me.statusCode).toBe(401);
    const refresh = await inject({ method: "POST", url: "/v1/auth/refresh", cookies });
    expect(refresh.statusCode).toBe(401);

    // Login is blocked, uniformly (no deleted-account oracle).
    const login = await inject({
      method: "POST",
      url: "/v1/auth/login",
      body: { email: "p22u-delete@example.com", password: PASSWORD },
    });
    expect(login.statusCode).toBe(401);
  });

  it("restore: emailed token restores within the window; token is single-use; garbage 400s", { timeout: 30_000 }, async () => {
    const { cookies } = await makeUser("p22u-restore@example.com");
    await deleteMe(cookies);
    const raw = usersSender.restore[usersSender.restore.length - 1];
    expect(raw).toBeTruthy();

    const restore = await inject({ method: "POST", url: "/v1/users/me/restore", body: { token: raw } });
    expect(restore.statusCode).toBe(200);

    const login = await inject({
      method: "POST",
      url: "/v1/auth/login",
      body: { email: "p22u-restore@example.com", password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);

    // Single-use + uniform failures.
    const reuse = await inject({ method: "POST", url: "/v1/users/me/restore", body: { token: raw } });
    expect(reuse.statusCode).toBe(400);
    const garbage = await inject({
      method: "POST",
      url: "/v1/users/me/restore",
      body: { token: "0".repeat(64) },
    });
    expect(garbage.statusCode).toBe(400);
  });

  it("restore REJECTS outside the 14-day window even with a live token (DB-side check)", { timeout: 30_000 }, async () => {
    const { userId, cookies } = await makeUser("p22u-latewindow@example.com");
    await deleteMe(cookies);
    const raw = usersSender.restore[usersSender.restore.length - 1];
    expect(raw).toBeTruthy();
    // Age the deletion past the window; the token itself is still unexpired —
    // the repo's deleted_at guard must reject on its own (belt AND braces).
    await sql`UPDATE users SET deleted_at = now() - interval '15 days' WHERE id = ${userId}`;

    const res = await inject({ method: "POST", url: "/v1/users/me/restore", body: { token: raw } });
    expect(res.statusCode).toBe(400);
    const row = (await sql<{ status: string }[]>`SELECT status FROM users WHERE id = ${userId}`)[0];
    expect(row?.status).toBe("deleted");
  });
});
