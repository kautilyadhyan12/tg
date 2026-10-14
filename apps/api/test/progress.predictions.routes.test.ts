// Progress's predictions (ROADMAP 35a) against REAL Postgres. DATABASE_URL-gated. The
// first block is the job's worst thing: another person's workouts in somebody's
// predictions. Then nobody signed in, a query refused, the week's goal from setup's own
// answers, the person's own time zone, and the plan's history limit.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { progressOverviewSchema, progressPredictionsSchema, type ProgressPredictions } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { EmailSender } from "../src/modules/auth/email.js";
import { dayInTz } from "../src/modules/gamification/streak.js";
import { addDays } from "../src/modules/workouts/predictions.js";

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
type Cookies = Record<string, string>;

const silentAuthSender = (): EmailSender => ({
  sendVerificationEmail: () => Promise.resolve(),
  sendPasswordResetEmail: () => Promise.resolve(),
  sendSignInCodeEmail: () => Promise.resolve(),
});

let ipCounter = 0;
const nextIp = () => `10.35.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

/** Setup's answers, finished, training 3 days a week (goals.starter.routes.test.ts's person). */
const PLAN_ANSWERS = {
  weightGoal: "maintain", age: 30, gender: "female", heightCm: 165, weightKg: 70,
  dayActivity: "sitting", trainingDays: 3, sessionMinutes: 45,
};
const FINISH = { diet: "non_vegetarian", mealsPerDay: 3, onboardingCompleted: true };

d("progress's predictions (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const inject = (opts: { method: "GET" | "POST" | "PUT" | "PATCH"; url: string; body?: unknown; cookies?: Cookies }) =>
    api().inject({
      method: opts.method,
      url: opts.url,
      remoteAddress: nextIp(),
      headers: opts.body !== undefined ? { "content-type": "application/json" } : {},
      cookies: opts.cookies ?? {},
      ...(opts.body !== undefined ? { payload: JSON.stringify(opts.body) } : {}),
    });

  const makeUser = async (name: string, answers: Record<string, unknown> | null = PLAN_ANSWERS): Promise<{ cookies: Cookies; id: string }> => {
    const email = `predictions-${name}@example.com`;
    const reg = await inject({ method: "POST", url: "/v1/auth/register", body: { email, password: PASSWORD, displayName: "Predictions Fixture" } });
    expect(reg.statusCode).toBe(201);
    const login = await inject({ method: "POST", url: "/v1/auth/login", body: { email, password: PASSWORD } });
    expect(login.statusCode).toBe(200);
    const cookies = cookieMap(login);
    if (answers !== null) {
      expect((await inject({ method: "PATCH", url: "/v1/users/me/onboarding", body: answers, cookies })).statusCode).toBe(200);
      expect((await inject({ method: "PUT", url: "/v1/users/me/health-screening", body: { hasCondition: false }, cookies })).statusCode).toBe(200);
      expect((await inject({ method: "PATCH", url: "/v1/users/me/onboarding", body: FINISH, cookies })).statusCode).toBe(200);
    }
    const rows = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error(`no fixture ${name}`);
    return { cookies, id };
  };

  const read = async (cookies: Cookies): Promise<ProgressPredictions> => {
    const res = await inject({ method: "GET", url: "/v1/progress/predictions", cookies });
    expect(res.statusCode, res.body).toBe(200);
    return progressPredictionsSchema.parse(JSON.parse(res.body));
  };
  /** A workout saved straight into the table, at an exact time. */
  const putWorkout = async (userId: string, startedAt: Date, o: { kcal: number; form: number | null; minutes?: number }) => {
    await sql`
      INSERT INTO workouts (id, user_id, started_at, platform, engine_version, duration_ms, kcal_point, avg_form_score)
      VALUES (${randomUUID()}, ${userId}, ${startedAt}, 'android', 'test', ${(o.minutes ?? 30) * 60_000}, ${o.kcal}, ${o.form})`;
  };
  const todayUtc = () => dayInTz(new Date(), "UTC");
  const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00Z`);

  const mine = sql`SELECT id FROM users WHERE email LIKE 'predictions-%@example.com'`;
  const clear = async () => {
    await sql`DELETE FROM workouts WHERE user_id IN (${mine})`;
    await sql`DELETE FROM user_goals WHERE user_id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'predictions-%@example.com'`;
  };

  beforeAll(async () => {
    await clear();
    app = await buildApp(loadConfig(baseEnv), { emailSender: silentAuthSender() });
  }, 60_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    await clear();
    await sql.end({ timeout: 5 });
  }, 60_000);

  describe("THE WORST THING: another person's workouts in somebody's predictions", () => {
    it("two people training on the same days: each one's predictions are worked out from their own workouts only", async () => {
      const a = await makeUser("worst-a");
      const b = await makeUser("worst-b");
      const today = todayUtc();
      // A: 100 kcal at 07:00 with form 60 on each of the last 35 days. B: 900 kcal at
      // 19:00 with form 95, twice a day on the same days.
      for (let n = 1; n <= 35; n++) {
        const day = addDays(today, -n);
        await putWorkout(a.id, at(day, "07:00"), { kcal: 100, form: 60 });
        await putWorkout(b.id, at(day, "19:00"), { kcal: 900, form: 95 });
        await putWorkout(b.id, at(day, "19:30"), { kcal: 900, form: 95 });
      }
      const pa = await read(a.cookies);
      expect(pa.workouts).toBe(35);
      if (!pa.forecast.available) throw new Error("A's forecast is hidden");
      for (const day of pa.forecast.days) expect(day.kcalPoint).toBe(100);
      expect(pa.bestTime).toEqual({ available: true, best: "morning", slots: [{ slot: "morning", workouts: 35, avgForm: 60 }] });
      expect(pa.steady).toMatchObject({ available: true, kcal: { before: 100, recent: 100 } });

      const pb = await read(b.cookies);
      expect(pb.workouts).toBe(70);
      if (!pb.forecast.available) throw new Error("B's forecast is hidden");
      for (const day of pb.forecast.days) expect(day.kcalPoint).toBe(1800);
      expect(pb.bestTime).toMatchObject({ best: "evening", slots: [{ slot: "evening", workouts: 70, avgForm: 95 }] });
    });

    it("nobody signed in is refused, and no query names a person", async () => {
      expect((await inject({ method: "GET", url: "/v1/progress/predictions" })).statusCode).toBe(401);
      const a = await makeUser("worst-query");
      const res = await inject({ method: "GET", url: `/v1/progress/predictions?userId=${a.id}`, cookies: a.cookies });
      expect(res.statusCode).toBe(400);
    });
  });

  it("a new person: every part hidden, with what each still needs", async () => {
    const { cookies } = await makeUser("new");
    const p = await read(cookies);
    expect(p).toMatchObject({
      workouts: 0,
      forecast: { available: false, workouts: 0, needed: 5 },
      weekGoal: { available: false, reason: "few_weeks", weeks: 0, needed: 3 },
      steady: { available: false, recent: 0, before: 0 },
      bestTime: { available: false, workouts: 0, needed: 6 },
    });
  });

  it("the week's goal is setup's own 3 training days, and with no setup there is none", async () => {
    const { cookies, id } = await makeUser("goal");
    const today = todayUtc();
    // A workout every day for 5 weeks: every finished week met 3 days.
    for (let n = 1; n <= 35; n++) await putWorkout(id, at(addDays(today, -n), "12:00"), { kcal: 200, form: 80 });
    const p = await read(cookies);
    expect(p.weekGoal).toMatchObject({ available: true, target: 3 });
    expect(p.weekGoal.available && ["reached", "on_track"].includes(p.weekGoal.band)).toBe(true);

    const none = await makeUser("goal-none", null);
    for (let n = 1; n <= 35; n++) await putWorkout(none.id, at(addDays(today, -n), "12:00"), { kcal: 200, form: 80 });
    expect((await read(none.cookies)).weekGoal).toEqual({ available: false, reason: "no_goal" });
  });

  it("reads the day and the hour in the person's own time zone", async () => {
    const { cookies, id } = await makeUser("zone");
    await sql`UPDATE users SET timezone = 'Asia/Kolkata' WHERE id = ${id}`;
    const today = dayInTz(new Date(), "Asia/Kolkata");
    // 02:00 UTC is 07:30 in Kolkata: morning there, night in UTC.
    for (let n = 1; n <= 6; n++) await putWorkout(id, at(addDays(today, -n), "02:00"), { kcal: 300, form: 70 });
    // 19:00 UTC the day before today is 00:30 today in Kolkata: today's, so not in the forecast.
    await putWorkout(id, at(addDays(today, -1), "19:00"), { kcal: 5000, form: null });
    const p = await read(cookies);
    expect(p.bestTime).toMatchObject({ available: true, best: "morning", slots: [{ slot: "morning", workouts: 6 }] });
    if (!p.forecast.available) throw new Error("hidden");
    expect(p.forecast.days[0]?.date).toBe(addDays(today, 1));
    expect(Math.max(...p.forecast.days.map((x) => x.kcalHigh))).toBeLessThan(5000);
  });

  it("reads 90 days at most, and says the plan's history limit as the other progress reads do", async () => {
    const { cookies, id } = await makeUser("limit");
    const today = todayUtc();
    for (const n of [1, 2, 3, 89, 95, 200]) await putWorkout(id, at(addDays(today, -n), "12:00"), { kcal: 200, form: 80 });
    const p = await read(cookies);
    expect(p.workouts).toBe(4);
    const overview = await inject({ method: "GET", url: "/v1/progress/overview", cookies });
    expect(p.limitedToDays).toBe(progressOverviewSchema.parse(JSON.parse(overview.body)).limitedToDays);
  });
});
