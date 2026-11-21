// After a workout (job 64a-iii): GET /v1/training/workouts/:id/summary and PUT /v1/training/workouts/:id/effort
// against REAL Postgres. DATABASE_URL-gated. The first block is the job's worst thing: a meal idea shown without
// its allergy warning, or one person's workout summary read, or its stars changed, by another.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { DIET_LABEL_CAUTION, FOOD_ALLERGY_CAUTION, workoutAfterSchema, type SavedSet } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { seed } from "../src/db/seed.js";
import type { EmailSender } from "../src/modules/auth/email.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "after-test-secret-0123456789abcd-32", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
interface Person {
  cookies: Record<string, string>;
  id: string;
}

const silentAuthSender = (): EmailSender => ({
  sendVerificationEmail: () => Promise.resolve(),
  sendPasswordResetEmail: () => Promise.resolve(),
  sendSignInCodeEmail: () => Promise.resolve(),
});

let ipCounter = 0;
const nextIp = () => `10.64.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const DAY_MS = 86_400_000;
/** Ten in the morning UTC, `n` days before today. */
const daysAgo = (n: number) => new Date(Math.floor(Date.now() / DAY_MS) * DAY_MS - n * DAY_MS + 10 * 3_600_000);

const set = (over: Partial<SavedSet> = {}): SavedSet => ({
  exercise: "squat",
  position: 0,
  measuredIn: "reps",
  target: 5,
  done: 5,
  weightGrams: 100_000,
  restSeconds: 60,
  durationMs: 30_000,
  counted: "hand",
  ...over,
});

const workout = (startedAt: Date, sets: SavedSet[]) => ({
  workoutId: randomUUID(),
  name: "Leg day",
  startedAt: startedAt.toISOString(),
  endedAt: new Date(startedAt.getTime() + 30 * 60_000).toISOString(),
  timeZone: "UTC",
  startedFrom: "none",
  effort: null,
  heart: [],
  platform: "android",
  appVersion: "1.0.0",
  sets,
});

d("after a workout: the summary and the effort stars (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  let people = 0;
  const person = async (): Promise<Person> => {
    const email = `after-${String(people++)}-${randomUUID().slice(0, 8)}@example.com`;
    const inject = (path: string, body: unknown) =>
      api().inject({ method: "POST", url: path, remoteAddress: nextIp(), headers: { "content-type": "application/json" }, payload: JSON.stringify(body) });
    expect((await inject("/v1/auth/register", { email, password: PASSWORD, displayName: "After Fixture" })).statusCode).toBe(201);
    const login = await inject("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    const id = (await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`)[0]?.id;
    if (id === undefined) throw new Error(`no fixture ${email}`);
    return { cookies: cookieMap(login), id };
  };

  const save = async (who: Person, body: ReturnType<typeof workout>) => {
    const res = await api().inject({
      method: "POST",
      url: "/v1/workouts",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json", "idempotency-key": body.workoutId },
      cookies: who.cookies,
      payload: JSON.stringify(body),
    });
    expect(res.statusCode, res.body).toBe(201);
    return body.workoutId;
  };

  const summary = (who: Person | null, id: string) =>
    api().inject({ method: "GET", url: `/v1/training/workouts/${id}/summary`, remoteAddress: nextIp(), ...(who === null ? {} : { cookies: who.cookies }) });
  const stars = (who: Person | null, id: string, body: unknown) =>
    api().inject({
      method: "PUT",
      url: `/v1/training/workouts/${id}/effort`,
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      ...(who === null ? {} : { cookies: who.cookies }),
      payload: JSON.stringify(body),
    });
  const effortOf = async (id: string) => (await sql<{ effort: number | null }[]>`SELECT effort FROM workouts WHERE id = ${id}`)[0]?.effort;
  const read = async (who: Person, id: string) => {
    const res = await summary(who, id);
    expect(res.statusCode, res.body).toBe(200);
    return workoutAfterSchema.parse(res.json());
  };

  const mine = sql`SELECT id FROM users WHERE email LIKE 'after-%@example.com'`;
  const clear = async () => {
    await sql`DELETE FROM user_achievements WHERE user_id IN (${mine})`;
    await sql`DELETE FROM user_xp WHERE user_id IN (${mine})`;
    await sql`DELETE FROM streaks WHERE user_id IN (${mine})`;
    await sql`DELETE FROM workouts WHERE user_id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'after-%@example.com'`;
  };

  beforeAll(async () => {
    await seed(url ?? "");
    await clear();
    app = await buildApp(loadConfig(baseEnv), { emailSender: silentAuthSender() });
  }, 120_000);
  afterAll(async () => {
    await clear();
    await app?.close();
    await sql.end();
  });

  describe("the worst thing", () => {
    it("every meal idea comes with the allergy warning; a vegetarian's with the label warning too", async () => {
      const a = await person();
      const id = await save(a, workout(daysAgo(1), [set()]));
      const got = await read(a, id);
      expect(got.food.ideas.length).toBeGreaterThan(0);
      expect(got.food.caution).toBe(FOOD_ALLERGY_CAUTION);
      // No diet answer reads as the strictest diet, whose ideas carry the label warning.
      expect(got.food.labelCaution).toBe(DIET_LABEL_CAUTION);
    });

    it("somebody else's workout is the same 404 as one that does not exist, and tells nothing of it", async () => {
      const [a, b] = [await person(), await person()];
      const id = await save(a, workout(daysAgo(1), [set()]));
      const theirs = await summary(b, id);
      const none = await summary(b, randomUUID());
      expect([theirs.statusCode, none.statusCode]).toEqual([404, 404]);
      expect(theirs.json()).toMatchObject({ error: "not_found" });
      expect(theirs.body).not.toContain(id);
      expect(theirs.body).not.toContain("Leg day");
    });

    it("somebody else's stars cannot be changed: 404, and the stars stay", async () => {
      const [a, b] = [await person(), await person()];
      const id = await save(a, workout(daysAgo(1), [set()]));
      expect((await stars(a, id, { effort: 2 })).statusCode).toBe(200);
      expect((await stars(b, id, { effort: 5 })).statusCode).toBe(404);
      expect(await effortOf(id)).toBe(2);
    });

    it("signed out, both are refused", async () => {
      const a = await person();
      const id = await save(a, workout(daysAgo(1), [set()]));
      expect((await summary(null, id)).statusCode).toBe(401);
      expect((await stars(null, id, { effort: 3 })).statusCode).toBe(401);
      expect(await effortOf(id)).toBeNull();
    });
  });

  describe("the summary", () => {
    it("a first workout: 50 for it and 50 for the First workout badge it unlocked, adding up to the whole total", async () => {
      const a = await person();
      const id = await save(a, workout(daysAgo(1), [set(), set({ position: 1 })]));
      const got = await read(a, id);
      const kcal = (await sql<{ kcal_point: number }[]>`SELECT kcal_point FROM workouts WHERE id = ${id}`)[0]?.kcal_point;
      expect(got).toMatchObject({ workoutId: id, kcalPoint: kcal, weightKg: null, effort: null, records: [] });
      expect(got.xp).toMatchObject({ earned: 100, forWorkout: 50, forStreak: 0, forBadges: 50 });
      // Nothing before it: what this workout earned is the whole total, so the screen's +XP and its level agree.
      expect(got.xp.view.total).toBe(got.xp.earned);
      // Done yesterday and read today: today does not count yet, so training today keeps the streak.
      expect(got.streak).toEqual({ days: 1, today: false });
    });

    it("a workout done today counts today for the streak", async () => {
      const a = await person();
      const id = await save(a, workout(new Date(Date.now() - 40 * 60_000), [set()]));
      expect((await read(a, id)).streak).toEqual({ days: 1, today: true });
    });

    it("the next day: 10 more for the streak, and each new record with what it was", async () => {
      const a = await person();
      await save(a, workout(daysAgo(2), [set({ done: 5, weightGrams: 100_000 })]));
      const id = await save(
        a,
        workout(daysAgo(1), [
          set({ position: 0, done: 8, weightGrams: 100_000 }),
          set({ position: 1, done: 5, weightGrams: 110_000 }),
          set({ position: 2, exercise: "plank", measuredIn: "time", target: 60, done: 45, weightGrams: null, durationMs: 45_000 }),
        ]),
      );
      const before = (await sql<{ total_xp: number }[]>`SELECT total_xp FROM user_xp WHERE user_id = ${a.id}`)[0]?.total_xp ?? 0;
      const got = await read(a, id);
      expect(got.xp).toMatchObject({ earned: 60, forWorkout: 50, forStreak: 10, forBadges: 0 });
      expect(got.streak).toEqual({ days: 2, today: false });
      expect(before).toBeGreaterThan(0);
      const byKind = Object.fromEntries(got.records.map((r) => [`${r.exercise}:${r.kind}`, r]));
      expect(byKind["squat:heaviest"]).toMatchObject({ value: 110_000, position: 1, measuredIn: "reps" });
      expect(byKind["squat:most_reps"]).toMatchObject({ value: 8, position: 0 });
      // Epley: 110 kg × 5 is 128.3 kg, above 100 kg × 8 at 126.7 kg, so the second set holds it.
      expect(byKind["squat:best_estimated_1rm"]).toMatchObject({ position: 1, value: Math.floor((110_000 * 35) / 30) });
      expect(byKind["squat:most_lifted"]).toMatchObject({ position: null, value: 8 * 100_000 + 5 * 110_000 });
      // The plank had nothing before it to beat, so it is no record yet.
      expect(byKind["plank:longest_hold"]).toBeUndefined();
      expect(got.records.every((r) => r.exerciseName !== null)).toBe(true);
    });

    it("a second workout the same day earns no second streak bonus", async () => {
      const a = await person();
      await save(a, workout(daysAgo(2), [set()]));
      await save(a, workout(daysAgo(1), [set()]));
      const later = await save(a, workout(new Date(daysAgo(1).getTime() + 3_600_000), [set()]));
      expect((await read(a, later)).xp).toMatchObject({ earned: 50, forStreak: 0 });
    });

    it("the weight the calories are worked out at is the person's own", async () => {
      const a = await person();
      await sql`INSERT INTO body_measurements (user_id, measured_at, weight_kg, source) VALUES (${a.id}, now(), 82, 'self_reported')`;
      const id = await save(a, workout(daysAgo(1), [set()]));
      expect((await read(a, id)).weightKg).toBe(82);
    });

    it("round one H1: a weight given after the save never stands beside calories worked out before it", async () => {
      const a = await person();
      const id = await save(a, workout(daysAgo(1), [set()]));
      const first = await read(a, id);
      expect(first.weightKg).toBeNull();
      await sql`INSERT INTO body_measurements (user_id, measured_at, weight_kg, source) VALUES (${a.id}, now(), 120, 'self_reported')`;
      const again = await read(a, id);
      expect(again.weightKg).toBeNull();
      expect(again.kcalPoint).toBe(first.kcalPoint);
      // The next workout is worked out at the new weight, and says so.
      const next = await save(a, workout(new Date(daysAgo(1).getTime() + 3_600_000), [set()]));
      expect((await read(a, next)).weightKg).toBe(120);
    });

    it("a broken id is the same 404", async () => {
      const a = await person();
      expect((await summary(a, "not-a-uuid")).statusCode).toBe(404);
    });
  });

  describe("the stars", () => {
    it("are saved, changed, and read back on the summary; sent twice it is the same", async () => {
      const a = await person();
      const id = await save(a, workout(daysAgo(1), [set()]));
      const first = await stars(a, id, { effort: 4 });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toEqual({ workoutId: id, effort: 4 });
      expect((await stars(a, id, { effort: 4 })).statusCode).toBe(200);
      expect((await stars(a, id, { effort: 3 })).statusCode).toBe(200);
      expect(await effortOf(id)).toBe(3);
      expect((await read(a, id)).effort).toBe(3);
    });

    it.each([[{ effort: 0 }], [{ effort: 6 }], [{ effort: 2.5 }], [{ effort: "3" }], [{}], [{ effort: 3, extra: 1 }]])("refuses %j and keeps what was there", async (body) => {
      const a = await person();
      const id = await save(a, workout(daysAgo(1), [set()]));
      const res = await stars(a, id, body);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: "validation_error" });
      expect(await effortOf(id)).toBeNull();
    });

    it("a workout that does not exist, or a broken id, is 404", async () => {
      const a = await person();
      expect((await stars(a, randomUUID(), { effort: 3 })).statusCode).toBe(404);
      expect((await stars(a, "nope", { effort: 3 })).statusCode).toBe(404);
    });

    it("thirty a minute for the person, from any address; somebody else is not held back", async () => {
      const [a, b] = [await person(), await person()];
      const id = await save(a, workout(daysAgo(1), [set()]));
      const theirs = await save(b, workout(daysAgo(1), [set()]));
      for (let i = 0; i < 30; i += 1) expect((await stars(a, id, { effort: (i % 5) + 1 })).statusCode).toBe(200);
      const over = await stars(a, id, { effort: 1 });
      expect(over.statusCode).toBe(429);
      expect(await effortOf(id)).toBe(5);
      expect((await stars(b, theirs, { effort: 2 })).statusCode).toBe(200);
    });
  });
});
