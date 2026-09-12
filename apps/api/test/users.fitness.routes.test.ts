// onboarding-storage card — /v1/users/me/fitness-profile against REAL Postgres
// (R9.2 — no SQL mocks). DATABASE_URL-gated; requires migrations 0001–0006.
// Covers: the empty-profile read (no row is the common case, not a 404), the
// full-document PUT incl. its absent→NULL replace rule, idempotency (R3.5),
// every validation rail (strict body, ported enums, Kd-approved bounds, the
// no-duplicates set rule), the cross-user isolation denial proof (R3.2/R9.2),
// onboardingCompleted surfacing on GET /v1/users/me (the web's onboarding gate,
// inert since web-repoint Card 1 — DECISIONS 2026-07-15), and the active-only
// upsert (a soft-deleted user cannot write, Part 4 §5.2).
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
  JWT_SECRET: "ofp-test-secret-0123456789abcdef-32", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;

const silentAuthSender = (): EmailSender => ({
  sendVerificationEmail: () => Promise.resolve(),
  sendPasswordResetEmail: () => Promise.resolve(),
  sendSignInCodeEmail: () => Promise.resolve(),
});

/** Deleting an account needs the emailed code (2026-09-07); this captures it. */
const deleteCodes: string[] = [];
const capturingUsersSender = (): UsersEmailSender => ({
  sendAccountDeletionEmail: () => Promise.resolve(),
  sendAccountDeleteCodeEmail: (_e, code) => {
    deleteCodes.push(code);
    return Promise.resolve();
  },
});

let ipCounter = 0;
const nextIp = () =>
  `10.7.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

/** A complete, valid profile — the shape the wizard submits. */
const FULL_PROFILE = {
  age: 34,
  gender: "female",
  heightCm: 165.5,
  targetWeightKg: 61.25,
  fitnessLevel: "intermediate",
  fitnessGoals: ["muscle_gain", "endurance"],
  weightGoal: "maintain",
  exerciseFrequency: 4,
  availableEquipment: ["dumbbells", "resistance_bands"],
  sessionDurationMin: 45,
  preferredWorkoutTime: "morning",
  // Screen 9's two answers (4b-ii). Settings asks them, so this route writes
  // them, and a body that omits them clears them like any other field here.
  diet: "vegetarian_eggs",
  mealsPerDay: 4,
  onboardingCompleted: true,
};

d("users fitness-profile routes (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const inject = (opts: {
    method: "GET" | "POST" | "PUT" | "DELETE";
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
      body: { email, password: PASSWORD, displayName: "OFP Fixture" },
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

  const getProfile = async (cookies: Record<string, string>) => {
    const res = await inject({ method: "GET", url: "/v1/users/me/fitness-profile", cookies });
    expect(res.statusCode).toBe(200);
    return (JSON.parse(res.body) as { fitnessProfile: Record<string, unknown> }).fitnessProfile;
  };

  beforeAll(async () => {
    // ON DELETE CASCADE clears user_fitness_profiles with its user.
    await sql`DELETE FROM users WHERE email LIKE 'ofp-%@example.com'`;
    app = await buildApp(loadConfig(baseEnv), {
      emailSender: silentAuthSender(),
      usersEmailSender: capturingUsersSender(),
    });
  }, 60_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    await sql.end({ timeout: 5 });
  });

  it("both routes require authentication", { timeout: 30_000 }, async () => {
    const get = await inject({ method: "GET", url: "/v1/users/me/fitness-profile" });
    expect(get.statusCode).toBe(401);
    const put = await inject({
      method: "PUT",
      url: "/v1/users/me/fitness-profile",
      body: FULL_PROFILE,
    });
    expect(put.statusCode).toBe(401);
  });

  it("reads the EMPTY profile before onboarding — no row is not a 404", { timeout: 30_000 }, async () => {
    const { cookies } = await makeUser("ofp-empty@example.com");
    expect(await getProfile(cookies)).toEqual({
      age: null,
      gender: null,
      heightCm: null,
      targetWeightKg: null,
      fitnessLevel: null, // NULL until answered — deliberately not 'beginner'
      fitnessGoals: [],
      weightGoal: null, // the weight choice that sets the calories: none yet
      exerciseFrequency: null,
      availableEquipment: [],
      sessionDurationMin: null,
      preferredWorkoutTime: null,
      diet: null, // screen 9's two, never guessed: a diet nobody gave is no diet
      mealsPerDay: null,
      onboardingCompleted: false,
      updatedAt: null, // never written — a synthesized timestamp would be a lie
    });
  });

  it("PUT stores the full profile and GET reads it back verbatim", { timeout: 30_000 }, async () => {
    const { cookies } = await makeUser("ofp-store@example.com");
    const put = await inject({
      method: "PUT",
      url: "/v1/users/me/fitness-profile",
      body: FULL_PROFILE,
      cookies,
    });
    expect(put.statusCode).toBe(200);
    const written = (JSON.parse(put.body) as { fitnessProfile: Record<string, unknown> })
      .fitnessProfile;
    expect(written).toMatchObject(FULL_PROFILE);
    expect(typeof written["updatedAt"]).toBe("string");

    // numeric(5,2) round-trips as a number, not a string (repo Number() cast)
    expect(written["heightCm"]).toBe(165.5);
    expect(written["targetWeightKg"]).toBe(61.25);

    const read = await getProfile(cookies);
    expect(read).toMatchObject(FULL_PROFILE);
  });

  it("stores the weight choice and the goals beside it as two answers, each as sent (4a-iv)", { timeout: 30_000 }, async () => {
    const { cookies } = await makeUser("ofp-two-answers@example.com");
    // Building muscle while losing weight is allowed: building muscle is not
    // gaining weight (RULINGS 2026-09-11).
    const body = { ...FULL_PROFILE, weightGoal: "lose", fitnessGoals: ["muscle_gain", "balance", "strength"] };
    expect((await inject({ method: "PUT", url: "/v1/users/me/fitness-profile", body, cookies })).statusCode).toBe(200);
    expect(await getProfile(cookies)).toMatchObject({ weightGoal: "lose", fitnessGoals: ["muscle_gain", "balance", "strength"] });
    // No weight choice sent is none stored, as for every field this form carries.
    const without = { ...FULL_PROFILE, weightGoal: undefined };
    expect((await inject({ method: "PUT", url: "/v1/users/me/fitness-profile", body: without, cookies })).statusCode).toBe(200);
    expect(await getProfile(cookies)).toMatchObject({ weightGoal: null, fitnessGoals: FULL_PROFILE.fitnessGoals });
  });

  it("PUT is idempotent — the same body twice yields the same row (R3.5)", { timeout: 30_000 }, async () => {
    const { userId, cookies } = await makeUser("ofp-idem@example.com");
    const body = { method: "PUT" as const, url: "/v1/users/me/fitness-profile", body: FULL_PROFILE, cookies };
    const first = await inject(body);
    const second = await inject(body);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    // Exactly one row, and its content is identical after the replay.
    const rows = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM user_fitness_profiles WHERE user_id = ${userId}`;
    expect(rows[0]?.n).toBe("1");

    // Content is identical across the replay; only updated_at (now()) moves.
    const contentOf = (raw: string): Record<string, unknown> => {
      const p = { ...(JSON.parse(raw) as { fitnessProfile: Record<string, unknown> }).fitnessProfile };
      delete p["updatedAt"];
      return p;
    };
    expect(contentOf(second.body)).toEqual(contentOf(first.body));
  });

  it("PUT is a full-document REPLACE — an omitted field is cleared to NULL", { timeout: 30_000 }, async () => {
    const { cookies } = await makeUser("ofp-replace@example.com");
    await inject({ method: "PUT", url: "/v1/users/me/fitness-profile", body: FULL_PROFILE, cookies });

    // A second PUT carrying only age: everything else must clear.
    const res = await inject({
      method: "PUT",
      url: "/v1/users/me/fitness-profile",
      body: { age: 40 },
      cookies,
    });
    expect(res.statusCode).toBe(200);
    expect(await getProfile(cookies)).toMatchObject({
      age: 40,
      gender: null,
      heightCm: null,
      fitnessLevel: null,
      fitnessGoals: [],
      availableEquipment: [],
      onboardingCompleted: false, // omitted → false: a partial save cannot satisfy the gate
    });
  });

  it("PUT {} is the extreme replace — the whole profile clears, gate flips to false", { timeout: 30_000 }, async () => {
    // The exact shape a buggy client sends. Pins the DECISIONS-recorded PUT
    // semantics (2026-07-15): an empty body is a legal full-document replace,
    // NOT a no-op — every field NULLs and onboarding_completed → false, so a
    // completed onboarding is undone. Accepted; asserted here so it can never
    // silently become a no-op (T3 finding, R9.2).
    const { cookies } = await makeUser("ofp-empty-put@example.com");
    await inject({ method: "PUT", url: "/v1/users/me/fitness-profile", body: FULL_PROFILE, cookies });

    const res = await inject({ method: "PUT", url: "/v1/users/me/fitness-profile", body: {}, cookies });
    expect(res.statusCode).toBe(200);
    const cleared = await getProfile(cookies);
    // The row still EXISTS (updatedAt is a string) — it was replaced, not deleted.
    expect(typeof cleared["updatedAt"]).toBe("string");
    const content = { ...cleared };
    delete content["updatedAt"];
    expect(content).toEqual({
      age: null,
      gender: null,
      heightCm: null,
      targetWeightKg: null,
      fitnessLevel: null,
      fitnessGoals: [],
      weightGoal: null, // no weight choice sent, so none is stored
      exerciseFrequency: null,
      availableEquipment: [],
      sessionDurationMin: null,
      preferredWorkoutTime: null,
      diet: null,
      mealsPerDay: null,
      onboardingCompleted: false,
    });
  });

  it("rejects every invalid body: unknown key, bad enum, out-of-bounds, duplicates", { timeout: 30_000 }, async () => {
    const { cookies } = await makeUser("ofp-invalid@example.com");
    const bad: Record<string, unknown>[] = [
      { ...FULL_PROFILE, favouriteColour: "blue" }, // .strict() — unknown keys rejected, not carried
      { gender: "yes" }, // outside the ported enum
      { fitnessLevel: "expert" }, // outside the ported enum
      { preferredWorkoutTime: "midnight" }, // outside the ported enum
      { fitnessGoals: ["posture", "posture"] }, // set rule: no duplicates
      { fitnessGoals: ["weight_loss"] }, // a weight choice since 4a-iv, never a goal beside one
      { weightGoal: "keep" }, // the screen's word; the stored value is "maintain"
      { mainGoal: "posture" }, // the old one-goal field is gone
      { availableEquipment: ["barbell"] }, // outside the enum
      { availableEquipment: ["none", "gym"] }, // "no equipment" stands alone
      { age: 15 }, // below the floor of 16 (RULINGS 2026-09-07: the app is for 16 and over)
      { age: 121 }, // above the ceiling of 120
      { exerciseFrequency: 8 }, // > 7 days in a week
      { sessionDurationMin: 4 }, // below the 5-minute floor
      { heightCm: 301 }, // above the 300 ceiling
      { medicalConditions: "knee injury" }, // the free-text notes box is gone (0029); .strict() refuses it
      { diet: "pescatarian" }, // outside the four Kd ruled (RULINGS 2026-09-10)
      { cuisine: "indian" }, // there is no cuisine question anywhere (RULINGS 2026-09-12)
      { mealsPerDay: 1 }, // below the floor of 2
      { mealsPerDay: 7 }, // above the ceiling of 6
    ];
    for (const body of bad) {
      const res = await inject({ method: "PUT", url: "/v1/users/me/fitness-profile", body, cookies });
      expect(res.statusCode, `expected 400 for ${JSON.stringify(body).slice(0, 60)}`).toBe(400);
    }
    // ...and none of them created a row.
    expect(await getProfile(cookies)).toMatchObject({ age: null, onboardingCompleted: false });
  });

  it("isolates users: A's profile is invisible and unaffected by B's writes (R3.2)", { timeout: 30_000 }, async () => {
    const a = await makeUser("ofp-tenant-a@example.com");
    const b = await makeUser("ofp-tenant-b@example.com");

    await inject({
      method: "PUT",
      url: "/v1/users/me/fitness-profile",
      body: { ...FULL_PROFILE, age: 30, preferredWorkoutTime: "evening" },
      cookies: a.cookies,
    });
    await inject({
      method: "PUT",
      url: "/v1/users/me/fitness-profile",
      body: { ...FULL_PROFILE, age: 55, preferredWorkoutTime: null },
      cookies: b.cookies,
    });

    // Each reads only their own row; B's write never reached A's.
    expect(await getProfile(a.cookies)).toMatchObject({
      age: 30,
      preferredWorkoutTime: "evening",
    });
    expect(await getProfile(b.cookies)).toMatchObject({ age: 55, preferredWorkoutTime: null });

    // And the rows are keyed to the right owners in the DB.
    const rows = await sql<{ user_id: string; age: number }[]>`
      SELECT user_id, age FROM user_fitness_profiles
      WHERE user_id IN (${a.userId}, ${b.userId}) ORDER BY age`;
    expect(rows).toEqual([
      { user_id: a.userId, age: 30 },
      { user_id: b.userId, age: 55 },
    ]);
  });

  it("surfaces onboardingCompleted on GET /v1/users/me — the web's onboarding gate", { timeout: 30_000 }, async () => {
    const { cookies } = await makeUser("ofp-gate@example.com");

    const before = await inject({ method: "GET", url: "/v1/users/me", cookies });
    expect(before.statusCode).toBe(200);
    // No profile row yet → COALESCEs to false rather than vanishing.
    expect((JSON.parse(before.body) as { user: { onboardingCompleted: boolean } }).user
      .onboardingCompleted).toBe(false);

    await inject({
      method: "PUT",
      url: "/v1/users/me/fitness-profile",
      body: FULL_PROFILE,
      cookies,
    });

    const after = await inject({ method: "GET", url: "/v1/users/me", cookies });
    expect((JSON.parse(after.body) as { user: { onboardingCompleted: boolean } }).user
      .onboardingCompleted).toBe(true);
  });

  it("a soft-deleted user cannot write a profile (active-only upsert, Part 4 §5.2)", { timeout: 30_000 }, async () => {
    const { userId, cookies } = await makeUser("ofp-deleted@example.com");
    const sent = await inject({ method: "POST", url: "/v1/users/me/delete-code", cookies });
    expect(sent.statusCode).toBe(200);
    const code = deleteCodes[deleteCodes.length - 1];
    const del = await inject({ method: "DELETE", url: "/v1/users/me", cookies, body: { code } });
    expect(del.statusCode).toBe(200);

    const res = await inject({
      method: "PUT",
      url: "/v1/users/me/fitness-profile",
      body: FULL_PROFILE,
      cookies,
    });
    expect(res.statusCode).toBe(401); // authenticate rejects the deleted user first

    // Belt and braces: nothing was written even though the FK would have allowed
    // it — §5.2 soft-deletes, so the row still exists and the FK is satisfied.
    const rows = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM user_fitness_profiles WHERE user_id = ${userId}`;
    expect(rows[0]?.n).toBe("0");
  });
});
