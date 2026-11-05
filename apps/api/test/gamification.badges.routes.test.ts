// Every badge, earned or not (ROADMAP 35c-iii), against REAL Postgres. DATABASE_URL-gated.
// The first block is the job's worst thing: another member's workouts counted toward
// somebody's badge, or a badge shown as earned that was not. Then the list agreeing with
// the Dashboard's Latest Badges, a badge reached before the list was read, Macro Master
// from the days' own protein targets, nobody signed in and a query refused.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { badgeListSchema, foodWeekResponseSchema, gamificationMeSchema, nutritionTargetsResponseSchema, type Badge, type BadgeList } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { EmailSender } from "../src/modules/auth/email.js";
import { onMealLogged, onWorkoutSynced } from "../src/modules/gamification/service.js";
import { dayInTz } from "../src/modules/gamification/streak.js";

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
const nextIp = () => `10.37.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

d("every badge (real Postgres)", () => {
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

  const makeUser = async (name: string): Promise<{ cookies: Cookies; id: string }> => {
    const email = `badges-${name}@example.com`;
    expect((await inject({ method: "POST", url: "/v1/auth/register", body: { email, password: PASSWORD, displayName: "Badges Fixture" } })).statusCode).toBe(201);
    const login = await inject({ method: "POST", url: "/v1/auth/login", body: { email, password: PASSWORD } });
    expect(login.statusCode).toBe(200);
    const rows = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error(`no fixture ${name}`);
    return { cookies: cookieMap(login), id };
  };

  const putWorkouts = async (userId: string, n: number) => {
    for (let i = 0; i < n; i++) {
      await sql`
        INSERT INTO workouts (id, user_id, started_at, platform, engine_version, duration_ms, kcal_point, avg_form_score)
        VALUES (${randomUUID()}, ${userId}, ${new Date(Date.UTC(2026, 9, 1 + i, 12))}, 'android', 'test', 1800000, 150, 80)`;
    }
  };
  const putMeal = async (userId: string, takenAt: Date, proteinG: number) => {
    await sql`
      INSERT INTO meal_logs (user_id, taken_at, items, kcal_point, kcal_low, kcal_high, protein_g, portion_source, nutrition_sources, calc_version)
      VALUES (${userId}, ${takenAt}, ${sql.json([])}, 500, 500, 500, ${proteinG}, 'default', ${sql.array(["curated"])}, 1)`;
  };
  const keepTarget = async (userId: string, day: string, proteinG: number) => {
    await sql`
      INSERT INTO food_day_targets (user_id, day, kcal, protein_g, carbs_g, fat_g)
      VALUES (${userId}, ${day}::date, 2000, ${proteinG}, 200, 60)
      ON CONFLICT (user_id, day) DO UPDATE SET protein_g = EXCLUDED.protein_g`;
  };
  const read = async (cookies: Cookies): Promise<BadgeList> => {
    const res = await inject({ method: "GET", url: "/v1/gamification/badges", cookies });
    expect(res.statusCode, res.body).toBe(200);
    return badgeListSchema.parse(JSON.parse(res.body));
  };
  const one = (list: BadgeList, code: string): Badge => {
    const b = list.badges.find((x) => x.code === code);
    if (b === undefined) throw new Error(`no ${code}`);
    return b;
  };
  const makePlanned = async (name: string): Promise<{ cookies: Cookies; id: string }> => {
    const person = await makeUser(name);
    const answers = {
      weightGoal: "maintain", age: 30, gender: "female", heightCm: 165, weightKg: 70,
      dayActivity: "sitting", trainingDays: 3, sessionMinutes: 45, fitnessLevel: "intermediate",
    };
    expect((await inject({ method: "PATCH", url: "/v1/users/me/onboarding", body: answers, cookies: person.cookies })).statusCode).toBe(200);
    expect((await inject({ method: "PUT", url: "/v1/users/me/health-screening", body: { hasCondition: false }, cookies: person.cookies })).statusCode).toBe(200);
    expect((await inject({ method: "PATCH", url: "/v1/users/me/onboarding", body: { diet: "non_vegetarian", mealsPerDay: 3, onboardingCompleted: true }, cookies: person.cookies })).statusCode).toBe(200);
    return person;
  };
  const proteinTarget = async (cookies: Cookies): Promise<number> => {
    const res = await inject({ method: "GET", url: "/v1/nutrition/targets", cookies });
    const targets = nutritionTargetsResponseSchema.parse(JSON.parse(res.body)).targets;
    if (targets === null) throw new Error("the planned fixture has no targets");
    return Math.round(targets.proteinG);
  };
  const meRead = async (cookies: Cookies) =>
    gamificationMeSchema.parse(JSON.parse((await inject({ method: "GET", url: "/v1/gamification/me", cookies })).body)).achievements;
  /** A moment of `today` (UTC) at most `ago` ms before now, never before the day began. */
  const inToday = (today: string, ago: number) => new Date(Math.max(Date.parse(`${today}T00:00:01Z`), Date.now() - ago));
  const xpOf = async (userId: string) => (await sql<{ total_xp: number }[]>`SELECT total_xp FROM user_xp WHERE user_id = ${userId}`)[0]?.total_xp ?? 0;
  const plus = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

  const mine = sql`SELECT id FROM users WHERE email LIKE 'badges-%@example.com'`;
  const clear = async () => {
    await sql`DELETE FROM user_achievements WHERE user_id IN (${mine})`;
    await sql`DELETE FROM meal_logs WHERE user_id IN (${mine})`;
    await sql`DELETE FROM food_day_targets WHERE user_id IN (${mine})`;
    await sql`DELETE FROM workouts WHERE user_id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'badges-%@example.com'`;
  };

  beforeAll(async () => {
    await clear();
    app = await buildApp(loadConfig(baseEnv), { emailSender: silentAuthSender() });
  });
  afterAll(async () => {
    await clear();
    await app?.close();
    await sql.end();
  });

  describe("the worst thing: somebody else's workouts, or a badge not earned", () => {
    it("ten workouts of one member earn nothing and count nothing for another", async () => {
      const busy = await makeUser("busy");
      const other = await makeUser("other");
      await putWorkouts(busy.id, 10);

      const theirs = await read(other.cookies);
      expect(theirs.badges.filter((b) => b.earnedAt !== null)).toEqual([]);
      expect(theirs.badges.every((b) => b.current === 0)).toBe(true);
      expect(one(theirs, "ten_workouts")).toMatchObject({ current: 0, target: 10, earnedAt: null });

      const own = await read(busy.cookies);
      expect(one(own, "first_workout").earnedAt).not.toBeNull();
      expect(one(own, "ten_workouts").earnedAt).not.toBeNull();
      expect(one(own, "fifty_workouts")).toMatchObject({ current: 10, target: 50, earnedAt: null });
    });

    it("nine workouts are 9 of 10, not earned", async () => {
      const nine = await makeUser("nine");
      await putWorkouts(nine.id, 9);
      expect(one(await read(nine.cookies), "ten_workouts")).toMatchObject({ current: 9, target: 10, earnedAt: null });
    });
  });

  it("agrees with the Dashboard's Latest Badges, day for day", async () => {
    const agree = await makeUser("agree");
    await putWorkouts(agree.id, 3);
    const list = await read(agree.cookies);
    const me = await inject({ method: "GET", url: "/v1/gamification/me", cookies: agree.cookies });
    const earned = gamificationMeSchema.parse(JSON.parse(me.body)).achievements;
    const fromList = list.badges.filter((b) => b.earnedAt !== null).map((b) => ({ code: b.code, earnedAt: b.earnedAt }));
    expect(fromList.sort((a, b) => a.code.localeCompare(b.code))).toEqual([...earned].sort((a, b) => a.code.localeCompare(b.code)));
  });

  it("a badge reached before the list is read is awarded once, with its XP, and the Dashboard's read then agrees", async () => {
    const late = await makeUser("late");
    await putWorkouts(late.id, 1); // straight into the table: no sync hook has awarded First Workout
    expect(await sql`SELECT 1 FROM user_achievements WHERE user_id = ${late.id}`).toHaveLength(0);
    expect(await meRead(late.cookies)).toEqual([]);
    const before = await xpOf(late.id);
    const [a, b] = await Promise.all([read(late.cookies), read(late.cookies)]);
    expect(one(a, "first_workout").earnedAt).not.toBeNull();
    expect(one(b, "first_workout").earnedAt).toBe(one(a, "first_workout").earnedAt);
    expect(await sql`SELECT 1 FROM user_achievements WHERE user_id = ${late.id} AND code = 'first_workout'`).toHaveLength(1);
    expect(await xpOf(late.id)).toBeGreaterThan(before);
    expect(await meRead(late.cookies)).toEqual([{ code: "first_workout", earnedAt: one(a, "first_workout").earnedAt }]);
  });

  describe("Macro Master reads each day as Your week in food does", () => {
    it("a day whose meals reached the server later, with no target kept, counts as Your week in food counts it", async () => {
      const eater = await makePlanned("late-meals");
      const target = await proteinTarget(eater.cookies);
      const today = dayInTz(new Date(), "UTC");
      // Six days up to yesterday, each saved afterwards: no target was kept on any of them.
      for (let back = 6; back >= 1; back--) await putMeal(eater.id, new Date(`${plus(today, -back)}T12:00:00Z`), target + 5);
      expect(await sql`SELECT 1 FROM food_day_targets WHERE user_id = ${eater.id}`).toHaveLength(0);
      const week = foodWeekResponseSchema.parse(JSON.parse((await inject({ method: "GET", url: "/v1/nutrition/food-week?days=7", cookies: eater.cookies })).body));
      const onInWeek = week.days.filter((d) => !d.today && d.bands?.proteinG !== undefined && d.bands.proteinG !== "under").length;
      expect(onInWeek).toBe(6);
      expect(one(await read(eater.cookies), "macro_master")).toMatchObject({ current: 6, target: 7, earnedAt: null });

      // Today under the target: still six. A second meal of today takes it over, and the badge is earned.
      await putMeal(eater.id, inToday(today, 120_000), Math.floor(target / 3));
      expect(one(await read(eater.cookies), "macro_master")).toMatchObject({ current: 6, earnedAt: null });
      await putMeal(eater.id, inToday(today, 60_000), target);
      expect(one(await read(eater.cookies), "macro_master").earnedAt).not.toBeNull();
    });

    it("each day against its own kept target, never another day's or today's", async () => {
      const eater = await makePlanned("own-target");
      const target = await proteinTarget(eater.cookies);
      const today = dayInTz(new Date(), "UTC");
      // Two days back: kept high, eaten under it, though over today's target.
      const high = Math.round(target * 1.3);
      await keepTarget(eater.id, plus(today, -2), high);
      await putMeal(eater.id, new Date(`${plus(today, -2)}T12:00:00Z`), Math.round(target * 1.1));
      // Yesterday: kept low, eaten over it, though under today's target.
      const low = Math.max(Math.round(target * 0.5), 1);
      await keepTarget(eater.id, plus(today, -1), low);
      await putMeal(eater.id, new Date(`${plus(today, -1)}T12:00:00Z`), Math.round(target * 0.6));
      expect(one(await read(eater.cookies), "macro_master").current).toBe(1);
    });

    it("days are the person's own: a meal at 1 am in Kolkata is that day's, not the day before in UTC", async () => {
      const eater = await makePlanned("kolkata");
      await sql`UPDATE users SET timezone = 'Asia/Kolkata' WHERE id = ${eater.id}`;
      const target = await proteinTarget(eater.cookies);
      const yesterday = plus(dayInTz(new Date(), "Asia/Kolkata"), -1);
      // 01:00 in Kolkata is 19:30 UTC of the day before.
      await putMeal(eater.id, new Date(Date.parse(`${yesterday}T01:00:00+05:30`)), target + 5);
      expect(one(await read(eater.cookies), "macro_master").current).toBe(1);
    });

    it("a person with no protein target and no day kept has no run, whoever else kept one that day", async () => {
      const noTarget = await makeUser("notarget");
      const other = await makePlanned("other-kept");
      const yesterday = plus(dayInTz(new Date(), "UTC"), -1);
      await keepTarget(other.id, yesterday, 50);
      await putMeal(noTarget.id, new Date(`${yesterday}T12:00:00Z`), 300);
      expect(one(await read(noTarget.cookies), "macro_master").current).toBe(0);
    });

    it("the meal hook awards it with no read of the list", async () => {
      const eater = await makePlanned("hook");
      const target = await proteinTarget(eater.cookies);
      const today = dayInTz(new Date(), "UTC");
      for (let back = 7; back >= 1; back--) await putMeal(eater.id, new Date(`${plus(today, -back)}T12:00:00Z`), target + 5);
      await onMealLogged({ sql }, eater.id, null);
      expect(await sql`SELECT 1 FROM user_achievements WHERE user_id = ${eater.id} AND code = 'macro_master'`).toHaveLength(1);
    });
  });

  it("a workout's save never fails on Your week in food: the other badges still come, and the list says it could not load", async () => {
    const broken = await makePlanned("broken-plan");
    // A plan no longer passes its own check (a height past 300 cm), so Your week in food cannot be read.
    await sql`UPDATE user_fitness_profiles SET height_cm = 999 WHERE user_id = ${broken.id}`;
    expect((await inject({ method: "GET", url: "/v1/nutrition/food-week?days=7", cookies: broken.cookies })).statusCode).toBe(500);
    await putWorkouts(broken.id, 1);
    await expect(onWorkoutSynced({ sql }, broken.id, null)).resolves.toBeDefined();
    expect(await sql`SELECT 1 FROM user_achievements WHERE user_id = ${broken.id} AND code = 'first_workout'`).toHaveLength(1);
    expect((await inject({ method: "GET", url: "/v1/gamification/badges", cookies: broken.cookies })).statusCode).toBe(500);
  });

  it("refuses nobody signed in, and a query", async () => {
    expect((await inject({ method: "GET", url: "/v1/gamification/badges" })).statusCode).toBe(401);
    const q = await makeUser("query");
    const res = await inject({ method: "GET", url: "/v1/gamification/badges?userId=someone", cookies: q.cookies });
    expect(res.statusCode).toBe(400);
  });
});
