// Health screening, Safe mode and the consent log (ROADMAP Stage 1 item 3b)
// against REAL Postgres. DATABASE_URL-gated; needs migration 0025.
// Covers, per route: the happy path, a validation failure, and the cross-user
// denial (CLAUDE.md §4) — plus the rules that matter: Safe mode and "no
// calorie cut" are DERIVED on the server from the stored answer, the macro
// rings' number stops cutting for a yes, saving again changes everything at
// once, the consent row carries the wording verbatim, and an unknown wording
// version is refused.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { DISCLAIMER_WORDINGS } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { EmailSender } from "../src/modules/auth/email.js";
import type { UsersEmailSender } from "../src/modules/users/email.js";
import { getPlanHealth } from "../src/modules/users/service.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "ofp-test-secret-0123456789abcdef-32", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;

const silentAuthSender = (): EmailSender => ({
  sendVerificationEmail: () => Promise.resolve(),
  sendPasswordResetEmail: () => Promise.resolve(),
  sendSignInCodeEmail: () => Promise.resolve(),
});
const deleteCodes: string[] = [];
const capturingUsersSender = (): UsersEmailSender => ({
  sendAccountDeletionEmail: () => Promise.resolve(),
  sendAccountDeleteCodeEmail: (_e, code) => {
    deleteCodes.push(code);
    return Promise.resolve();
  },
});

let ipCounter = 0;
const nextIp = () => `10.8.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

/** A profile that yields the weight-loss golden of nutrition.unit.test.ts. */
const LOSING_PROFILE = {
  age: 30,
  gender: "female",
  heightCm: 165,
  fitnessGoals: ["weight_loss"],
  exerciseFrequency: 4,
  onboardingCompleted: true,
};

const UNANSWERED = {
  answered: false,
  hasCondition: null,
  checkFirst: null,
  safeMode: false,
  noCalorieCut: false,
  updatedAt: null,
};

d("health screening + consent routes (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const inject = (opts: {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    url: string;
    body?: unknown;
    cookies?: Record<string, string>;
  }) =>
    api().inject({
      method: opts.method,
      url: opts.url,
      remoteAddress: nextIp(),
      headers: opts.body !== undefined ? { "content-type": "application/json" } : {},
      cookies: opts.cookies ?? {},
      ...(opts.body !== undefined ? { payload: JSON.stringify(opts.body) } : {}),
    });

  const makeUser = async (email: string) => {
    const reg = await inject({
      method: "POST",
      url: "/v1/auth/register",
      body: { email, password: PASSWORD, displayName: "HS Fixture" },
    });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await inject({ method: "POST", url: "/v1/auth/login", body: { email, password: PASSWORD } });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };

  const getScreening = async (cookies: Record<string, string>) => {
    const res = await inject({ method: "GET", url: "/v1/users/me/health-screening", cookies });
    expect(res.statusCode).toBe(200);
    return (JSON.parse(res.body) as { healthScreening: Record<string, unknown> }).healthScreening;
  };
  const putScreening = async (cookies: Record<string, string>, body: unknown) =>
    inject({ method: "PUT", url: "/v1/users/me/health-screening", body, cookies });

  beforeAll(async () => {
    // consent_log has NO cascade (kept as proof) — clear it first, then users;
    // user_health_screenings cascades.
    await sql`DELETE FROM consent_log WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'hs-%@example.com')`;
    await sql`DELETE FROM users WHERE email LIKE 'hs-%@example.com'`;
    app = await buildApp(loadConfig(baseEnv), {
      emailSender: silentAuthSender(),
      usersEmailSender: capturingUsersSender(),
    });
  }, 60_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    await sql.end({ timeout: 5 });
  });

  it("every route requires authentication", { timeout: 30_000 }, async () => {
    expect((await inject({ method: "GET", url: "/v1/users/me/health-screening" })).statusCode).toBe(401);
    expect((await putScreening({}, { hasCondition: false })).statusCode).toBe(401);
    expect((await inject({ method: "GET", url: "/v1/users/me/consents" })).statusCode).toBe(401);
    expect(
      (await inject({ method: "POST", url: "/v1/users/me/consents", body: { purpose: "sign_up", wordingVersion: "v1", appVersion: "web-test" } })).statusCode,
    ).toBe(401);
  });

  it("reads the UNANSWERED screening before the health screen — no row is not a 404, and no rule applies", { timeout: 30_000 }, async () => {
    const { userId, cookies } = await makeUser("hs-empty@example.com");
    expect(await getScreening(cookies)).toEqual(UNANSWERED);
    expect(await getPlanHealth(sql, userId)).toBeNull();
  });

  it("a NO stores a no: nothing derived, no calorie cut held, no Safe mode", { timeout: 30_000 }, async () => {
    const { userId, cookies } = await makeUser("hs-no@example.com");
    const res = await putScreening(cookies, { hasCondition: false });
    expect(res.statusCode).toBe(200);
    const s = (JSON.parse(res.body) as { healthScreening: Record<string, unknown> }).healthScreening;
    expect(s).toMatchObject({ answered: true, hasCondition: false, checkFirst: null, safeMode: false, noCalorieCut: false });
    expect(typeof s["updatedAt"]).toBe("string");
    expect(await getScreening(cookies)).toEqual(s);
    expect(await getPlanHealth(sql, userId)).toEqual({ hasCondition: false, safeMode: false });
    // `checkFirst: null` spelled out is the same no.
    expect((await putScreening(cookies, { hasCondition: false, checkFirst: null })).statusCode).toBe(200);
  });

  it("a YES with 'cleared': no calorie cut, but NOT Safe mode; the plan health says so", { timeout: 30_000 }, async () => {
    const { userId, cookies } = await makeUser("hs-cleared@example.com");
    const res = await putScreening(cookies, { hasCondition: true, checkFirst: "cleared" });
    expect(res.statusCode).toBe(200);
    expect(await getScreening(cookies)).toMatchObject({
      answered: true,
      hasCondition: true,
      checkFirst: "cleared",
      safeMode: false,
      noCalorieCut: true,
    });
    expect(await getPlanHealth(sql, userId)).toEqual({ hasCondition: true, safeMode: false });
  });

  it("a YES with 'not yet' is Safe mode AND no calorie cut — derived on the server, whatever the screen sends", { timeout: 30_000 }, async () => {
    const { userId, cookies } = await makeUser("hs-notyet@example.com");
    const res = await putScreening(cookies, { hasCondition: true, checkFirst: "not_yet" });
    expect(res.statusCode).toBe(200);
    expect(await getScreening(cookies)).toMatchObject({ safeMode: true, noCalorieCut: true, checkFirst: "not_yet" });
    expect(await getPlanHealth(sql, userId)).toEqual({ hasCondition: true, safeMode: true });
    // The derived flags are NOT accepted from a client: the body is strict.
    const forged = await putScreening(cookies, { hasCondition: true, checkFirst: "not_yet", safeMode: false });
    expect(forged.statusCode).toBe(400);
    expect(await getScreening(cookies)).toMatchObject({ safeMode: true });
  });

  it("saving again changes the person's settings, and everything reading them updates at once (Kd 2026-09-09)", { timeout: 30_000 }, async () => {
    const { userId, cookies } = await makeUser("hs-change@example.com");
    expect((await putScreening(cookies, { hasCondition: true, checkFirst: "not_yet" })).statusCode).toBe(200);
    expect(await getScreening(cookies)).toMatchObject({ safeMode: true, noCalorieCut: true });
    // Cleared later by a professional.
    expect((await putScreening(cookies, { hasCondition: true, checkFirst: "cleared" })).statusCode).toBe(200);
    expect(await getScreening(cookies)).toMatchObject({ safeMode: false, noCalorieCut: true });
    expect(await getPlanHealth(sql, userId)).toEqual({ hasCondition: true, safeMode: false });
    // The condition is gone.
    expect((await putScreening(cookies, { hasCondition: false })).statusCode).toBe(200);
    expect(await getScreening(cookies)).toMatchObject({ safeMode: false, noCalorieCut: false, checkFirst: null });
    // One row throughout.
    const rows = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM user_health_screenings WHERE user_id = ${userId}`;
    expect(rows[0]?.n).toBe("1");
  });

  it("PUT is idempotent — the same body twice yields the same row", { timeout: 30_000 }, async () => {
    const { cookies } = await makeUser("hs-idem@example.com");
    const body = { hasCondition: true, checkFirst: "cleared" };
    const first = await putScreening(cookies, body);
    const second = await putScreening(cookies, body);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const strip = (raw: string) => {
      const s = { ...(JSON.parse(raw) as { healthScreening: Record<string, unknown> }).healthScreening };
      delete s["updatedAt"];
      return s;
    };
    expect(strip(second.body)).toEqual(strip(first.body));
  });

  it("refuses every contradiction and every stray field, and writes nothing", { timeout: 30_000 }, async () => {
    const { cookies } = await makeUser("hs-invalid@example.com");
    const bad: unknown[] = [
      { hasCondition: true }, // a yes must choose
      { hasCondition: true, checkFirst: null },
      { hasCondition: false, checkFirst: "cleared" }, // nothing to be cleared of
      { hasCondition: false, checkFirst: "not_yet" },
      { hasCondition: true, checkFirst: "maybe" },
      { hasCondition: "yes", checkFirst: "cleared" },
      { hasCondition: true, checkFirst: "cleared", pregnant: true }, // no named condition, ever
      {},
    ];
    for (const body of bad) {
      const res = await putScreening(cookies, body);
      expect(res.statusCode, `expected 400 for ${JSON.stringify(body)}`).toBe(400);
    }
    expect(await getScreening(cookies)).toEqual(UNANSWERED);
  });

  it("the database refuses the contradiction too, for any writer that skips the contract", { timeout: 30_000 }, async () => {
    const { userId } = await makeUser("hs-check@example.com");
    const refused = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ code: "23514" });
    await refused(sql`INSERT INTO user_health_screenings (user_id, has_condition, check_first) VALUES (${userId}, true, NULL)`);
    await refused(sql`INSERT INTO user_health_screenings (user_id, has_condition, check_first) VALUES (${userId}, false, 'cleared')`);
    await refused(sql`INSERT INTO user_health_screenings (user_id, has_condition, check_first) VALUES (${userId}, true, 'maybe')`);
  });

  it("isolates users: A's screening is invisible to B and unaffected by B's writes", { timeout: 30_000 }, async () => {
    const a = await makeUser("hs-tenant-a@example.com");
    const b = await makeUser("hs-tenant-b@example.com");
    expect((await putScreening(a.cookies, { hasCondition: true, checkFirst: "not_yet" })).statusCode).toBe(200);
    expect((await putScreening(b.cookies, { hasCondition: false })).statusCode).toBe(200);
    expect(await getScreening(a.cookies)).toMatchObject({ hasCondition: true, safeMode: true });
    expect(await getScreening(b.cookies)).toMatchObject({ hasCondition: false, safeMode: false });
    const rows = await sql<{ user_id: string; has_condition: boolean }[]>`
      SELECT user_id, has_condition FROM user_health_screenings
      WHERE user_id IN (${a.userId}, ${b.userId}) ORDER BY has_condition`;
    expect(rows).toEqual([
      { user_id: b.userId, has_condition: false },
      { user_id: a.userId, has_condition: true },
    ]);
  });

  it("the macro rings' number stops cutting calories for a yes — the live screen honours the rule today", { timeout: 30_000 }, async () => {
    const { cookies } = await makeUser("hs-targets@example.com");
    expect((await inject({ method: "PUT", url: "/v1/users/me/fitness-profile", body: LOSING_PROFILE, cookies })).statusCode).toBe(200);
    expect((await inject({ method: "PATCH", url: "/v1/users/me", body: { weightKg: 60 }, cookies })).statusCode).toBe(200);
    const targets = async () => {
      const res = await inject({ method: "GET", url: "/v1/nutrition/targets", cookies });
      expect(res.statusCode).toBe(200);
      return (JSON.parse(res.body) as { targets: { tdee: number; kcal: number; noCalorieCut: boolean } }).targets;
    };
    // Before the screen: the ported −400 cut (the unit golden).
    expect(await targets()).toMatchObject({ tdee: 2046, kcal: 1646, noCalorieCut: false });
    // A yes, cleared: no cut — eat the daily burn.
    expect((await putScreening(cookies, { hasCondition: true, checkFirst: "cleared" })).statusCode).toBe(200);
    expect(await targets()).toMatchObject({ tdee: 2046, kcal: 2046, noCalorieCut: true });
    // A yes, not yet: the same.
    expect((await putScreening(cookies, { hasCondition: true, checkFirst: "not_yet" })).statusCode).toBe(200);
    expect(await targets()).toMatchObject({ kcal: 2046, noCalorieCut: true });
    // Back to no: the cut returns.
    expect((await putScreening(cookies, { hasCondition: false })).statusCode).toBe(200);
    expect(await targets()).toMatchObject({ kcal: 1646, noCalorieCut: false });
  });

  it("a soft-deleted user cannot write a screening or a consent (active-only inserts)", { timeout: 30_000 }, async () => {
    const { userId, cookies } = await makeUser("hs-deleted@example.com");
    expect((await inject({ method: "POST", url: "/v1/users/me/delete-code", cookies })).statusCode).toBe(200);
    const code = deleteCodes[deleteCodes.length - 1];
    expect((await inject({ method: "DELETE", url: "/v1/users/me", cookies, body: { code } })).statusCode).toBe(200);
    expect((await putScreening(cookies, { hasCondition: false })).statusCode).toBe(401);
    expect(
      (await inject({ method: "POST", url: "/v1/users/me/consents", body: { purpose: "sign_up", wordingVersion: "v1", appVersion: "web-test" }, cookies })).statusCode,
    ).toBe(401);
    const s = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM user_health_screenings WHERE user_id = ${userId}`;
    const c = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM consent_log WHERE user_id = ${userId}`;
    expect(s[0]?.n).toBe("0");
    expect(c[0]?.n).toBe("0");
  });

  // ── the consent log ───────────────────────────────────────────────────────

  it("records a tap with the wording VERBATIM, the app build and the time, and lists it back newest first", { timeout: 30_000 }, async () => {
    const { userId, cookies } = await makeUser("hs-consent@example.com");
    const post = (purpose: string, appVersion = "web-0.0.1") =>
      inject({ method: "POST", url: "/v1/users/me/consents", body: { purpose, wordingVersion: "v1", appVersion }, cookies });
    const first = await post("sign_up");
    expect(first.statusCode).toBe(201);
    const c1 = (JSON.parse(first.body) as { consent: Record<string, unknown> }).consent;
    expect(c1).toMatchObject({
      purpose: "sign_up",
      wordingVersion: "v1",
      wording: DISCLAIMER_WORDINGS.sign_up["v1"],
      appVersion: "web-0.0.1",
    });
    expect(typeof c1["id"]).toBe("string");
    expect(typeof c1["recordedAt"]).toBe("string");

    expect((await post("health_step")).statusCode).toBe(201);
    expect((await post("plan_screen", "android-12")).statusCode).toBe(201);

    const list = await inject({ method: "GET", url: "/v1/users/me/consents", cookies });
    expect(list.statusCode).toBe(200);
    const consents = (JSON.parse(list.body) as { consents: Record<string, unknown>[] }).consents;
    expect(consents.map((c) => c["purpose"])).toEqual(["plan_screen", "health_step", "sign_up"]);
    expect(consents[0]).toMatchObject({ wording: DISCLAIMER_WORDINGS.plan_screen["v1"], appVersion: "android-12" });

    // The row holds the words, not a pointer to them.
    const rows = await sql<{ wording: string }[]>`
      SELECT wording FROM consent_log WHERE user_id = ${userId} AND purpose = 'health_step'`;
    expect(rows[0]?.wording).toBe(DISCLAIMER_WORDINGS.health_step["v1"]);
  });

  it("refuses an unknown wording version, a bad purpose and a stray field — a consent to words nobody showed is a record of nothing", { timeout: 30_000 }, async () => {
    const { cookies } = await makeUser("hs-consent-bad@example.com");
    const bad: { body: unknown; status: number }[] = [
      { body: { purpose: "sign_up", wordingVersion: "v99", appVersion: "web" }, status: 400 },
      { body: { purpose: "sign_up", wordingVersion: "latest", appVersion: "web" }, status: 400 },
      { body: { purpose: "marketing", wordingVersion: "v1", appVersion: "web" }, status: 400 },
      { body: { purpose: "sign_up", wordingVersion: "v1", appVersion: "" }, status: 400 },
      { body: { purpose: "sign_up", wordingVersion: "v1", appVersion: "web", wording: "my own words" }, status: 400 },
      { body: { purpose: "sign_up", wordingVersion: "v1" }, status: 400 },
    ];
    for (const { body, status } of bad) {
      const res = await inject({ method: "POST", url: "/v1/users/me/consents", body, cookies });
      expect(res.statusCode, `expected ${String(status)} for ${JSON.stringify(body)}`).toBe(status);
    }
    const list = await inject({ method: "GET", url: "/v1/users/me/consents", cookies });
    expect((JSON.parse(list.body) as { consents: unknown[] }).consents).toEqual([]);
  });

  it("isolates users: A's consents are never in B's list, and B cannot write into A's", { timeout: 30_000 }, async () => {
    const a = await makeUser("hs-consent-a@example.com");
    const b = await makeUser("hs-consent-b@example.com");
    expect(
      (await inject({ method: "POST", url: "/v1/users/me/consents", body: { purpose: "sign_up", wordingVersion: "v1", appVersion: "web" }, cookies: a.cookies })).statusCode,
    ).toBe(201);
    const bList = await inject({ method: "GET", url: "/v1/users/me/consents", cookies: b.cookies });
    expect((JSON.parse(bList.body) as { consents: unknown[] }).consents).toEqual([]);
    const aList = await inject({ method: "GET", url: "/v1/users/me/consents", cookies: a.cookies });
    expect((JSON.parse(aList.body) as { consents: unknown[] }).consents).toHaveLength(1);
    const rows = await sql<{ user_id: string }[]>`
      SELECT user_id FROM consent_log WHERE user_id IN (${a.userId}, ${b.userId})`;
    expect(rows).toEqual([{ user_id: a.userId }]);
  });
});
