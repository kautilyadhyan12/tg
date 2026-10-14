// Weekly challenges (ROADMAP 35b) against REAL Postgres. DATABASE_URL-gated. The first
// block is the job's worst thing: somebody in Safe mode told to push harder. Then another
// person's workouts, nobody signed in, a query refused, the week kept, two first reads at
// once, the XP paid once, a late workout, the person's own time zone and the families.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { weeklyChallengesSchema, type WeeklyChallengeCode, type WeeklyChallenges } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { EmailSender } from "../src/modules/auth/email.js";
import { getWeeklyChallenges, onWorkoutSynced } from "../src/modules/gamification/service.js";
import { dayInTz } from "../src/modules/gamification/streak.js";
import { pickChallenges, weekOf } from "../src/modules/gamification/challenges.js";

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
const nextIp = () => `10.36.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const PLAN_ANSWERS = {
  weightGoal: "maintain", age: 30, gender: "female", heightCm: 165, weightKg: 70,
  dayActivity: "sitting", trainingDays: 3, sessionMinutes: 45, fitnessLevel: "intermediate",
};
const FINISH = { diet: "non_vegetarian", mealsPerDay: 3, onboardingCompleted: true };
const EFFORT = ["burn_kcal_1500", "burn_kcal_3000", "train_minutes_120", "train_minutes_300", "train_days_5", "train_days_7", "form_80_workouts_3", "form_90_workouts_3", "families_3", "families_5"];

d("weekly challenges (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const inject = (opts: { method: "GET" | "PUT" | "PATCH" | "POST" | "DELETE"; url: string; body?: unknown; cookies?: Cookies }) =>
    api().inject({
      method: opts.method,
      url: opts.url,
      remoteAddress: nextIp(),
      headers: opts.body !== undefined ? { "content-type": "application/json" } : {},
      cookies: opts.cookies ?? {},
      ...(opts.body !== undefined ? { payload: JSON.stringify(opts.body) } : {}),
    });

  const makeUser = async (name: string, health: { hasCondition: boolean; checkFirst?: string } = { hasCondition: false }): Promise<{ cookies: Cookies; id: string }> => {
    const email = `challenges-${name}@example.com`;
    expect((await inject({ method: "POST", url: "/v1/auth/register", body: { email, password: PASSWORD, displayName: "Challenges Fixture" } })).statusCode).toBe(201);
    const login = await inject({ method: "POST", url: "/v1/auth/login", body: { email, password: PASSWORD } });
    expect(login.statusCode).toBe(200);
    const cookies = cookieMap(login);
    expect((await inject({ method: "PATCH", url: "/v1/users/me/onboarding", body: PLAN_ANSWERS, cookies })).statusCode).toBe(200);
    expect((await inject({ method: "PUT", url: "/v1/users/me/health-screening", body: health, cookies })).statusCode).toBe(200);
    const rows = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error(`no fixture ${name}`);
    if (!health.hasCondition) expect((await inject({ method: "PATCH", url: "/v1/users/me/onboarding", body: FINISH, cookies })).statusCode).toBe(200);
    return { cookies, id };
  };

  const read = async (cookies: Cookies): Promise<WeeklyChallenges> => {
    const res = await inject({ method: "GET", url: "/v1/gamification/challenges", cookies });
    expect(res.statusCode, res.body).toBe(200);
    return weeklyChallengesSchema.parse(JSON.parse(res.body));
  };
  const codes = (w: WeeklyChallenges) => w.challenges.map((c) => c.code);
  const one = (w: WeeklyChallenges, code: WeeklyChallengeCode) => {
    const c = w.challenges.find((x) => x.code === code);
    if (c === undefined) throw new Error(`no ${code} in ${codes(w).join(",")}`);
    return c;
  };

  const putWorkout = async (userId: string, startedAt: Date, o: { kcal?: number; minutes?: number; form?: number | null; exerciseIds?: string[] } = {}) => {
    const id = randomUUID();
    await sql`
      INSERT INTO workouts (id, user_id, started_at, platform, engine_version, duration_ms, kcal_point, avg_form_score)
      VALUES (${id}, ${userId}, ${startedAt}, 'android', 'test', ${(o.minutes ?? 30) * 60_000}, ${o.kcal ?? 200}, ${o.form ?? null})`;
    let i = 0;
    for (const exerciseId of o.exerciseIds ?? []) {
      await sql`
        INSERT INTO workout_sets (workout_id, user_id, exercise_id, started_at, set_index, reps, duration_ms)
        VALUES (${id}, ${userId}, ${exerciseId}, ${startedAt}, ${i++}, 10, 30000)`;
    }
  };
  const putMeal = async (userId: string, takenAt: Date): Promise<string> => {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO meal_logs (user_id, taken_at, meal_name, items, kcal_point, kcal_low, kcal_high, portion_source, nutrition_sources, calc_version)
      VALUES (${userId}, ${takenAt}, 'Meal', ${sql.json([])}, 500, 500, 500, 'default', ${sql.array(["curated"])}, 1)
      RETURNING id`;
    if (row === undefined) throw new Error("no meal");
    return row.id;
  };
  const setPicks = async (userId: string, weekStart: string, picks: WeeklyChallengeCode[], timeZone = "UTC") => {
    await sql`
      INSERT INTO weekly_challenges (user_id, week_start, time_zone, codes)
      VALUES (${userId}, ${weekStart}::date, ${timeZone}, ${sql.array(picks)}::text[])
      ON CONFLICT (user_id, week_start) DO UPDATE SET time_zone = EXCLUDED.time_zone, codes = EXCLUDED.codes, held_codes = '{}'`;
  };
  const xpOf = async (userId: string) =>
    (await sql<{ total_xp: number }[]>`SELECT total_xp FROM user_xp WHERE user_id = ${userId}`)[0]?.total_xp ?? 0;
  const thisWeek = () => weekOf(dayInTz(new Date(), "UTC"));
  const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00Z`);
  const plus = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

  const mine = sql`SELECT id FROM users WHERE email LIKE 'challenges-%@example.com'`;
  const clear = async () => {
    await sql`DELETE FROM meal_logs WHERE user_id IN (${mine})`;
    await sql`DELETE FROM workouts WHERE user_id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'challenges-%@example.com'`;
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

  describe("THE WORST THING: somebody in Safe mode is told to push harder", () => {
    it("a person waiting for a professional's clearance gets only training on 3 days and logging food", { timeout: 60_000 }, async () => {
      const p = await makeUser("worst-safe", { hasCondition: true, checkFirst: "not_yet" });
      const { weekStart } = thisWeek();
      for (let n = 0; n < 3; n++) await putWorkout(p.id, at(weekStart, "06:00"), { kcal: 900, minutes: 120 });
      const w = await read(p.cookies);
      expect(codes(w)).toEqual(["train_days_3", "food_days_5"]);
      for (const c of w.challenges) {
        expect(EFFORT).not.toContain(c.code);
        expect(c.held).toBeNull();
      }
    });

    it("Safe mode turned on midweek holds the week's effort challenges and leaves the gentle ones", { timeout: 60_000 }, async () => {
      const p = await makeUser("worst-midweek");
      const { weekStart } = thisWeek();
      await setPicks(p.id, weekStart, ["train_days_3", "burn_kcal_3000", "train_minutes_300"]);
      expect((await read(p.cookies)).challenges.every((c) => c.held === null)).toBe(true);
      expect((await inject({ method: "PUT", url: "/v1/users/me/health-screening", body: { hasCondition: true, checkFirst: "not_yet" }, cookies: p.cookies })).statusCode).toBe(200);
      const w = await read(p.cookies);
      expect(one(w, "train_days_3").held).toBeNull();
      expect(one(w, "burn_kcal_3000").held).toEqual({ code: "safe_mode" });
      expect(one(w, "train_minutes_300").held).toEqual({ code: "safe_mode" });
    });
  });

  describe("only the person's own", () => {
    it("another person's workouts and meals count nothing in somebody's challenges", { timeout: 60_000 }, async () => {
      const a = await makeUser("own-a");
      const b = await makeUser("own-b");
      const { weekStart } = thisWeek();
      const all: WeeklyChallengeCode[] = ["train_days_3", "burn_kcal_1500", "food_days_5"];
      await setPicks(a.id, weekStart, all);
      await setPicks(b.id, weekStart, all);
      for (let n = 0; n < 7; n++) {
        await putWorkout(b.id, at(plus(weekStart, n), "08:00"), { kcal: 900 });
        await putMeal(b.id, at(plus(weekStart, n), "09:00"));
      }
      const wa = await read(a.cookies);
      for (const c of wa.challenges) expect(c.current, c.code).toBe(0);
      expect(wa.xpThisWeek).toBe(0);
      const wb = await read(b.cookies);
      expect(one(wb, "burn_kcal_1500").current).toBeGreaterThanOrEqual(1500);
    });

    it("nobody signed in is refused, and a person cannot be named in the query", { timeout: 60_000 }, async () => {
      expect((await inject({ method: "GET", url: "/v1/gamification/challenges" })).statusCode).toBe(401);
      const a = await makeUser("query-a");
      const b = await makeUser("query-b");
      const res = await inject({ method: "GET", url: `/v1/gamification/challenges?userId=${b.id}`, cookies: a.cookies });
      expect(res.statusCode).toBe(400);
      expect(res.body).not.toContain(b.id);
      expect((await sql`SELECT 1 FROM weekly_challenges WHERE user_id = ${b.id}`).length).toBe(0);
    });
  });

  describe("the week's three", () => {
    it("are kept until Sunday, even when the person changes their fitness level", { timeout: 60_000 }, async () => {
      const p = await makeUser("kept");
      const first = await read(p.cookies);
      expect(first.challenges).toHaveLength(3);
      expect(first.weekStart).toBe(thisWeek().weekStart);
      expect(first.weekEnd).toBe(thisWeek().weekEnd);
      expect((await inject({ method: "PATCH", url: "/v1/users/me/onboarding", body: { fitnessLevel: "advanced" }, cookies: p.cookies })).statusCode).toBe(200);
      expect(codes(await read(p.cookies))).toEqual(codes(first));
      expect((await sql`SELECT 1 FROM weekly_challenges WHERE user_id = ${p.id}`).length).toBe(1);
    });

    it("two first reads at the same moment keep one set, and both answer with it", { timeout: 60_000 }, async () => {
      const p = await makeUser("race");
      const [x, y, z] = await Promise.all([read(p.cookies), read(p.cookies), read(p.cookies)]);
      expect(codes(y)).toEqual(codes(x));
      expect(codes(z)).toEqual(codes(x));
      expect((await sql`SELECT 1 FROM weekly_challenges WHERE user_id = ${p.id}`).length).toBe(1);
    });

    it("no weight, no calorie challenge", { timeout: 60_000 }, async () => {
      const p = await makeUser("no-weight");
      await sql`DELETE FROM body_measurements WHERE user_id = ${p.id}`;
      for (let week = 0; week < 8; week++) {
        const w = await getWeeklyChallenges({ sql }, p.id, at(plus("2026-06-01", week * 7), "12:00"));
        expect(codes(w).some((c) => c.startsWith("burn_kcal")), codes(w).join(",")).toBe(false);
      }
    });
  });

  describe("XP", () => {
    it("a done challenge pays its XP once, however often the XP is worked out again", { timeout: 60_000 }, async () => {
      const p = await makeUser("xp");
      const { weekStart } = thisWeek();
      for (let n = 0; n < 3; n++) await putWorkout(p.id, at(weekStart, `0${String(n + 6)}:00`));
      await onWorkoutSynced({ sql }, p.id, "UTC");
      const before = await xpOf(p.id);
      await setPicks(p.id, weekStart, ["train_days_3"]);
      await onWorkoutSynced({ sql }, p.id, "UTC");
      // Three workouts on ONE day: training on 3 days is not done.
      expect(await xpOf(p.id)).toBe(before);
      expect(one(await read(p.cookies), "train_days_3")).toMatchObject({ current: 1, done: false });
      // Two more days: done, and paid once however often it is worked out again.
      await putWorkout(p.id, at(plus(weekStart, 1), "06:00"));
      await putWorkout(p.id, at(plus(weekStart, 2), "06:00"));
      await onWorkoutSynced({ sql }, p.id, "UTC");
      const withDays = await xpOf(p.id);
      await sql`DELETE FROM weekly_challenges WHERE user_id = ${p.id}`;
      await onWorkoutSynced({ sql }, p.id, "UTC");
      const withoutChallenge = await xpOf(p.id);
      expect(withDays).toBe(withoutChallenge + 200);
      await setPicks(p.id, weekStart, ["train_days_3"]);
      for (let n = 0; n < 3; n++) await onWorkoutSynced({ sql }, p.id, "UTC");
      await read(p.cookies);
      expect(await xpOf(p.id)).toBe(withDays);
      expect(one(await read(p.cookies), "train_days_3")).toMatchObject({ current: 3, done: true });
    });

    it("a week already part done pays when its challenges are first picked, and again never", { timeout: 60_000 }, async () => {
      const p = await makeUser("xp-first");
      const now = at("2026-09-20", "20:00"); // a Sunday
      // Every easy challenge done before the week is first read: an intermediate always gets one.
      const fams = await sql<{ id: string }[]>`SELECT DISTINCT ON (family) id::text AS id FROM exercises ORDER BY family, id LIMIT 3`;
      for (const day of ["2026-09-14", "2026-09-15", "2026-09-16"]) await putWorkout(p.id, at(day, "07:00"), { kcal: 600, minutes: 50, exerciseIds: fams.map((f) => f.id) });
      for (let n = 0; n < 5; n++) await putMeal(p.id, at(plus("2026-09-14", n), "08:00"));
      await onWorkoutSynced({ sql }, p.id, "UTC");
      const before = await xpOf(p.id);
      const w = await getWeeklyChallenges({ sql }, p.id, now);
      expect(w.weekStart).toBe("2026-09-14");
      expect(w.xpThisWeek).toBeGreaterThanOrEqual(200);
      expect(await xpOf(p.id)).toBe(before + w.xpThisWeek);
      await getWeeklyChallenges({ sql }, p.id, now);
      await onWorkoutSynced({ sql }, p.id, "UTC");
      await onWorkoutSynced({ sql }, p.id, "UTC");
      expect(await xpOf(p.id)).toBe(before + w.xpThisWeek);
    });

    it("a late workout from last week completes last week's challenge", { timeout: 60_000 }, async () => {
      const p = await makeUser("late");
      const last = weekOf(plus(thisWeek().weekStart, -7)).weekStart;
      await setPicks(p.id, last, ["train_days_3"]);
      await putWorkout(p.id, at(plus(last, 0), "07:00"));
      await putWorkout(p.id, at(plus(last, 1), "07:00"));
      await onWorkoutSynced({ sql }, p.id, "UTC");
      const twoDays = await xpOf(p.id);
      await sql`DELETE FROM weekly_challenges WHERE user_id = ${p.id}`;
      await putWorkout(p.id, at(plus(last, 4), "07:00")); // arrives this week, done last Friday
      await onWorkoutSynced({ sql }, p.id, "UTC");
      const withoutPicks = await xpOf(p.id);
      await setPicks(p.id, last, ["train_days_3"]);
      await onWorkoutSynced({ sql }, p.id, "UTC");
      expect(await xpOf(p.id)).toBe(withoutPicks + 200);
      expect(withoutPicks).toBeGreaterThan(twoDays);
    });
  });

  describe("the person's own week", () => {
    it("India: Monday 00:30 counts in the new week and Monday 00:15 a week later does not", { timeout: 60_000 }, async () => {
      const p = await makeUser("tz-india");
      await sql`UPDATE users SET timezone = 'Asia/Kolkata' WHERE id = ${p.id}`;
      await setPicks(p.id, "2026-10-12", ["train_days_3", "food_days_5"], "Asia/Kolkata");
      await putWorkout(p.id, at("2026-10-11", "19:00")); // Monday 12 Oct 00:30 in India, Sunday in UTC
      await putWorkout(p.id, at("2026-10-18", "18:45")); // Monday 19 Oct 00:15 in India, Sunday in UTC
      await putMeal(p.id, at("2026-10-11", "18:00")); // Sunday 11 Oct 23:30 in India
      const w = await getWeeklyChallenges({ sql }, p.id, at("2026-10-18", "17:00")); // Sunday 22:30 in India
      expect(w.weekStart).toBe("2026-10-12");
      expect(one(w, "train_days_3").current).toBe(1);
      expect(one(w, "food_days_5").current).toBe(0);
    });

    it("Los Angeles: Sunday 22:00 belongs to the week before, though it is Monday in UTC", { timeout: 60_000 }, async () => {
      const p = await makeUser("tz-la");
      await sql`UPDATE users SET timezone = 'America/Los_Angeles' WHERE id = ${p.id}`;
      await setPicks(p.id, "2026-10-12", ["train_days_3"], "America/Los_Angeles");
      await putWorkout(p.id, at("2026-10-12", "05:00")); // Sunday 11 Oct 22:00 in Los Angeles
      await putWorkout(p.id, at("2026-10-12", "08:00")); // Monday 01:00
      const w = await getWeeklyChallenges({ sql }, p.id, at("2026-10-14", "20:00"));
      expect(w.weekStart).toBe("2026-10-12");
      expect(one(w, "train_days_3").current).toBe(1);
    });
  });

  describe("what counts", () => {
    it("families are the exercise families tried this week; minutes, calories and camera-scored workouts add up", { timeout: 60_000 }, async () => {
      const p = await makeUser("counts");
      const fams = await sql<{ id: string }[]>`
        SELECT DISTINCT ON (family) id::text AS id FROM exercises ORDER BY family, id LIMIT 3`;
      expect(fams).toHaveLength(3);
      const [f1, f2, f3] = fams.map((f) => f.id);
      if (f1 === undefined || f2 === undefined || f3 === undefined) throw new Error("three families");
      await setPicks(p.id, "2026-09-14", ["families_3", "train_minutes_120", "form_80_workouts_3"]);
      await putWorkout(p.id, at("2026-09-14", "07:00"), { minutes: 50, form: 85, exerciseIds: [f1, f1, f2] });
      await putWorkout(p.id, at("2026-09-15", "07:00"), { minutes: 50, form: 79, exerciseIds: [f2] });
      await putWorkout(p.id, at("2026-09-16", "07:00"), { minutes: 19, form: null, exerciseIds: [f3] });
      await putWorkout(p.id, at("2026-09-21", "07:00"), { minutes: 90, form: 95, exerciseIds: [f3] }); // the next week
      const w = await getWeeklyChallenges({ sql }, p.id, at("2026-09-18", "12:00"));
      expect(one(w, "families_3")).toMatchObject({ current: 3, done: true });
      expect(one(w, "train_minutes_120")).toMatchObject({ current: 119, done: false });
      expect(one(w, "form_80_workouts_3")).toMatchObject({ current: 1, done: false });
      expect(w.xpThisWeek).toBe(250);
    });
  });

  describe("Safe mode pauses the week's other challenges", () => {
    it("at once when Safe mode is answered: what is done keeps its XP, what is not pays nothing that week, even after clearance", { timeout: 60_000 }, async () => {
      const p = await makeUser("paused");
      const { weekStart } = thisWeek();
      await setPicks(p.id, weekStart, ["train_days_3", "burn_kcal_1500", "train_minutes_120"]);
      // Before Safe mode: 1,600 kcal (done), 100 minutes on 2 days (not done).
      for (let n = 0; n < 2; n++) await putWorkout(p.id, at(plus(weekStart, n), "07:00"), { minutes: 50, kcal: 800 });
      await onWorkoutSynced({ sql }, p.id, "UTC");
      expect((await read(p.cookies)).xpThisWeek).toBe(250);
      const before = await xpOf(p.id);
      const health = (checkFirst: string) =>
        inject({ method: "PUT", url: "/v1/users/me/health-screening", body: { hasCondition: true, checkFirst }, cookies: p.cookies });

      expect((await health("not_yet")).statusCode).toBe(200);
      expect(await xpOf(p.id)).toBe(before);
      const paused = await read(p.cookies);
      expect(one(paused, "burn_kcal_1500")).toMatchObject({ done: true, held: null });
      expect(one(paused, "train_minutes_120")).toMatchObject({ done: false, held: { code: "safe_mode" } });
      expect(one(paused, "train_days_3")).toMatchObject({ done: false, held: null });

      // A third day in Safe mode: training on 3 days pays; 150 minutes is done but paused.
      await putWorkout(p.id, at(plus(weekStart, 2), "07:00"), { minutes: 50, kcal: 800 });
      await onWorkoutSynced({ sql }, p.id, "UTC");
      const third = await read(p.cookies);
      expect(one(third, "train_minutes_120")).toMatchObject({ done: true, held: { code: "safe_mode" } });
      expect(third.xpThisWeek).toBe(250 + 200);

      // A professional clears them the same week: the paused challenge stays paused until Sunday.
      expect((await health("cleared")).statusCode).toBe(200);
      expect(one(await read(p.cookies), "train_minutes_120").held).toEqual({ code: "safe_mode" });
      const [row] = await sql<{ held_codes: string[] }[]>`
        SELECT held_codes FROM weekly_challenges WHERE user_id = ${p.id} AND week_start = ${weekStart}::date`;
      expect(row?.held_codes).toEqual(["train_minutes_120"]);
      // What the week adds to the total: 450, never the paused 200.
      const withWeek = await xpOf(p.id);
      await sql`DELETE FROM weekly_challenges WHERE user_id = ${p.id}`;
      await onWorkoutSynced({ sql }, p.id, "UTC");
      expect(withWeek - (await xpOf(p.id))).toBe(450);
    });
  });

  describe("a meal deleted or moved", () => {
    it("a deleted meal takes its week's food challenge XP back at once", { timeout: 60_000 }, async () => {
      const p = await makeUser("meal-delete");
      await setPicks(p.id, "2026-09-14", ["food_days_5"]);
      const ids: string[] = [];
      for (let n = 0; n < 5; n++) ids.push(await putMeal(p.id, at(plus("2026-09-14", n), "08:00")));
      await onWorkoutSynced({ sql }, p.id, "UTC");
      const withChallenge = await xpOf(p.id);
      const res = await inject({ method: "DELETE", url: `/v1/nutrition/meals/${ids[0] ?? ""}`, cookies: p.cookies });
      expect(res.statusCode).toBe(204);
      expect(await xpOf(p.id)).toBe(withChallenge - 200);
    });

    it("a meal moved into a week finishes its food challenge at once", { timeout: 60_000 }, async () => {
      const p = await makeUser("meal-move");
      await setPicks(p.id, "2026-09-14", ["food_days_5"]);
      for (let n = 0; n < 4; n++) await putMeal(p.id, at(plus("2026-09-14", n), "08:00"));
      const later = await putMeal(p.id, at("2026-09-22", "08:00"));
      await onWorkoutSynced({ sql }, p.id, "UTC");
      const fourDays = await xpOf(p.id);
      const res = await inject({ method: "PATCH", url: `/v1/nutrition/meals/${later}`, body: { takenAt: "2026-09-18T08:00:00Z" }, cookies: p.cookies });
      expect(res.statusCode, res.body).toBe(200);
      expect(await xpOf(p.id)).toBe(fourDays + 200);
    });
  });

  describe("what a first pick reads", () => {
    it("the fitness level: an advanced person's week holds two hard challenges and a medium, a beginner's two easy and a medium", { timeout: 60_000 }, async () => {
      const level = async (name: string, fitnessLevel: string) => {
        const p = await makeUser(name);
        expect((await inject({ method: "PATCH", url: "/v1/users/me/onboarding", body: { fitnessLevel }, cookies: p.cookies })).statusCode).toBe(200);
        return (await read(p.cookies)).challenges.map((c) => c.difficulty).sort();
      };
      expect(await level("level-advanced", "advanced")).toEqual(["hard", "hard", "medium"]);
      expect(await level("level-beginner", "beginner")).toEqual(["easy", "easy", "medium"]);
    });

    it("the camera: a camera-scored workout 27 days back offers the form challenges, one 29 days back does not", { timeout: 60_000 }, async () => {
      const a = await makeUser("camera-27");
      const b = await makeUser("camera-29");
      const hasForm = (picked: readonly string[]) => picked.some((c) => c.startsWith("form_"));
      // A week in which both would get a form challenge if the camera counted for them.
      const base = { fitnessLevel: "intermediate" as const, safeMode: false, weightKnown: true, usedCamera: true };
      let week: string | undefined;
      for (let k = 0; k < 52 && week === undefined; k++) {
        const w = plus("2026-01-05", 7 * k);
        if (hasForm(pickChallenges({ ...base, userId: a.id, weekStart: w })) && hasForm(pickChallenges({ ...base, userId: b.id, weekStart: w }))) week = w;
      }
      if (week === undefined) throw new Error("no week offers both a form challenge");
      const now = at(plus(week, 2), "12:00");
      await putWorkout(a.id, new Date(now.getTime() - 27 * 86_400_000), { form: 85 });
      await putWorkout(b.id, new Date(now.getTime() - 29 * 86_400_000), { form: 85 });
      expect(hasForm(codes(await getWeeklyChallenges({ sql }, a.id, now)))).toBe(true);
      expect(hasForm(codes(await getWeeklyChallenges({ sql }, b.id, now)))).toBe(false);
    });

    it("a week whose kept challenges the app no longer has gets new ones", { timeout: 60_000 }, async () => {
      const p = await makeUser("retired");
      const { weekStart } = thisWeek();
      await sql`INSERT INTO weekly_challenges (user_id, week_start, time_zone, codes) VALUES (${p.id}, ${weekStart}::date, 'UTC', ARRAY['ask_the_coach'])`;
      const w = await read(p.cookies);
      expect(w.challenges).toHaveLength(3);
      const [row] = await sql<{ codes: string[] }[]>`SELECT codes FROM weekly_challenges WHERE user_id = ${p.id}`;
      expect(row?.codes).toEqual(codes(w));
    });
  });

  describe("the XP is paid in the week's own days", () => {
    it("India: three workouts after midnight on Monday to Wednesday finish training on 3 days, and a later change of zone moves nothing", { timeout: 60_000 }, async () => {
      const p = await makeUser("xp-india");
      await sql`UPDATE users SET timezone = 'Asia/Kolkata' WHERE id = ${p.id}`;
      for (const day of ["2026-09-13", "2026-09-14", "2026-09-15"]) await putWorkout(p.id, at(day, "19:00")); // 00:30 the next day in India
      await onWorkoutSynced({ sql }, p.id, "Asia/Kolkata");
      const without = await xpOf(p.id);
      await setPicks(p.id, "2026-09-14", ["train_days_3"], "Asia/Kolkata");
      await onWorkoutSynced({ sql }, p.id, "Asia/Kolkata");
      expect(await xpOf(p.id)).toBe(without + 200);
      // In Los Angeles the first of them is a Sunday; the week was picked in India and stays India's.
      await sql`UPDATE users SET timezone = 'America/Los_Angeles' WHERE id = ${p.id}`;
      await onWorkoutSynced({ sql }, p.id, "America/Los_Angeles");
      expect(await xpOf(p.id)).toBe(without + 200);
    });

    it("Los Angeles: a workout at 22:00 on the week's last Sunday, Monday in UTC, counts in that week", { timeout: 60_000 }, async () => {
      const p = await makeUser("tz-la-sunday");
      await sql`UPDATE users SET timezone = 'America/Los_Angeles' WHERE id = ${p.id}`;
      await setPicks(p.id, "2026-10-12", ["train_days_3"], "America/Los_Angeles");
      await putWorkout(p.id, at("2026-10-12", "15:00")); // Monday 08:00 there
      await putWorkout(p.id, at("2026-10-13", "15:00")); // Tuesday 08:00 there
      await putWorkout(p.id, at("2026-10-19", "05:00")); // Sunday 18 Oct 22:00 there
      const w = await getWeeklyChallenges({ sql }, p.id, at("2026-10-19", "06:30")); // Sunday 23:30 there
      expect(w.weekStart).toBe("2026-10-12");
      expect(one(w, "train_days_3")).toMatchObject({ current: 3, done: true });
    });
  });
});
