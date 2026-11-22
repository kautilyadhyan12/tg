// Time trained, never time paused (ROADMAP Stage 5 64a-ii-b; spec Part 2 §13.5): POST /v1/workouts against REAL
// Postgres. DATABASE_URL-gated. The first block is the job's worst thing: a person's paused hours counted as
// training, on Hours Trained, a minutes challenge, a goal and the gym's numbers (all four read the workout's kept
// length), or a workout they really did refused because of the new number. Then the check the server holds on it, and
// a workout kept on a phone from before the phone sent its time trained.
//
// The workouts start a few hours before the real clock, so the overview's 30 days always hold them.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { SavedSet } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { seed } from "../src/db/seed.js";
import type { EmailSender } from "../src/modules/auth/email.js";
import { weekFacts } from "../src/modules/gamification/repo.js";
import { workoutDays } from "../src/modules/goals/repo.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "training-test-secret-0123456789ab-32", // dummy test value, gitleaks:allow
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
const nextIp = () => `10.62.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const MIN = 60_000;
const HOUR = 60 * MIN;
/** Six hours before the real clock, to the second: a 5½-hour workout has ended by now. */
const START = new Date(Math.floor((Date.now() - 6 * HOUR) / 1000) * 1000).toISOString();
const at = (ms: number) => new Date(Date.parse(START) + ms).toISOString();

const set = (over: Partial<SavedSet> = {}): SavedSet => ({
  exercise: "squat",
  position: 0,
  measuredIn: "reps",
  target: 12,
  done: 12,
  weightGrams: null,
  restSeconds: 60,
  durationMs: 40_000,
  counted: "hand",
  ...over,
});

/** Three sets and two rests: 3 min 40 s in all. */
const SETS: SavedSet[] = [
  set(),
  set({ exercise: "barbell_curl", position: 1, target: 10, done: 8, weightGrams: 20_000, restSeconds: 90, durationMs: 30_000 }),
  set({ exercise: "plank", position: 2, measuredIn: "time", target: 30, done: 30, restSeconds: null, durationMs: 30_000, counted: "timer" }),
];
const SETS_AND_RESTS_MS = 40_000 + 60_000 + 30_000 + 90_000 + 30_000;

const workout = (over: Record<string, unknown> = {}) => ({
  workoutId: randomUUID(),
  name: "Leg day",
  startedAt: START,
  endedAt: at(30 * MIN),
  timeZone: "UTC",
  startedFrom: "none",
  effort: null,
  heart: [],
  platform: "android",
  appVersion: "1.0.0",
  sets: SETS,
  trainedMs: 30 * MIN,
  ...over,
});

d("time trained, never time paused (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  let people = 0;
  const person = async (): Promise<Person> => {
    const email = `trained-${String(people++)}-${randomUUID().slice(0, 8)}@example.com`;
    const inject = (path: string, body: unknown) =>
      api().inject({ method: "POST", url: path, remoteAddress: nextIp(), headers: { "content-type": "application/json" }, payload: JSON.stringify(body) });
    expect((await inject("/v1/auth/register", { email, password: PASSWORD, displayName: "Trained Fixture" })).statusCode).toBe(201);
    const login = await inject("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    const id = (await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`)[0]?.id;
    if (id === undefined) throw new Error(`no fixture ${email}`);
    return { cookies: cookieMap(login), id };
  };

  const save = (who: Person, body: { workoutId: string } & Record<string, unknown>) =>
    api().inject({
      method: "POST",
      url: "/v1/workouts",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json", "idempotency-key": body.workoutId },
      cookies: who.cookies,
      payload: JSON.stringify(body),
    });

  const keptMs = async (workoutId: string): Promise<number | null> =>
    (await sql<{ duration_ms: number | null }[]>`SELECT duration_ms FROM workouts WHERE id = ${workoutId}`)[0]?.duration_ms ?? null;

  /** What each reader of the workout's length counts for the person: Hours Trained (the Dashboard's overview), this
   *  week's training minutes (the minutes challenges) and the day's minutes (goals). The gym's day (orgs/rollup.ts)
   *  sums the same kept `duration_ms`, which the first test reads. */
  const counted = async (who: Person) => {
    const overview = await api().inject({ method: "GET", url: "/v1/progress/overview?period=30d", remoteAddress: nextIp(), cookies: who.cookies });
    expect(overview.statusCode).toBe(200);
    const week = (await sql<{ w: string }[]>`SELECT date_trunc('week', ${START}::timestamptz AT TIME ZONE 'UTC')::date::text AS w`)[0]?.w ?? "";
    const day = START.slice(0, 10);
    const [facts] = await weekFacts(sql, who.id, "UTC", [week]);
    const [goalDay] = await workoutDays(sql, who.id, "UTC", day, day);
    const body: { totalDurationMs: number } = overview.json();
    return {
      hoursTrainedMs: body.totalDurationMs,
      challengeMinutes: facts?.trainingMinutes ?? 0,
      goalMs: goalDay?.ms ?? 0,
    };
  };

  const mine = sql`SELECT id FROM users WHERE email LIKE 'trained-%@example.com'`;
  const clear = async () => {
    await sql`DELETE FROM user_achievements WHERE user_id IN (${mine})`;
    await sql`DELETE FROM user_xp WHERE user_id IN (${mine})`;
    await sql`DELETE FROM streaks WHERE user_id IN (${mine})`;
    await sql`DELETE FROM workouts WHERE user_id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'trained-%@example.com'`;
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

  describe("the worst thing: paused hours are never counted as training, and the workout is never refused for them", () => {
    it("30 minutes trained and 5 hours paused is saved, and counts 30 minutes on Hours Trained, the challenge and the goal", async () => {
      const a = await person();
      const w = workout({ endedAt: at(5.5 * HOUR) });
      const res = await save(a, w);
      expect(res.statusCode).toBe(201);
      expect(await keptMs(w.workoutId)).toBe(30 * MIN);
      expect(await counted(a)).toEqual({ hoursTrainedMs: 30 * MIN, challengeMinutes: 30, goalMs: 30 * MIN });
      // Its start and end stay the workout's own.
      const [row] = await sql<{ started_at: Date; ended_at: Date }[]>`SELECT started_at, ended_at FROM workouts WHERE id = ${w.workoutId}`;
      expect(row?.started_at.toISOString()).toBe(START);
      expect(row?.ended_at.toISOString()).toBe(at(5.5 * HOUR));
    });

    it("two workouts, one paused for hours: the challenge's minutes are the 60 trained, so a 120-minute challenge is not paid", async () => {
      const a = await person();
      expect((await save(a, workout({ endedAt: at(5.5 * HOUR) }))).statusCode).toBe(201);
      expect((await save(a, workout({ startedAt: at(5.5 * HOUR + MIN), endedAt: at(5.5 * HOUR + 31 * MIN) }))).statusCode).toBe(201);
      const c = await counted(a);
      expect(c.challengeMinutes).toBe(60);
      expect(c.challengeMinutes).toBeLessThan(120);
    });

    it("a workout with no pause counts its whole length, as before", async () => {
      const a = await person();
      const w = workout({ endedAt: at(45 * MIN), trainedMs: 45 * MIN });
      expect((await save(a, w)).statusCode).toBe(201);
      expect(await keptMs(w.workoutId)).toBe(45 * MIN);
    });

    it("time trained just covering its sets and rests is saved", async () => {
      const a = await person();
      const w = workout({ endedAt: at(3 * HOUR), trainedMs: SETS_AND_RESTS_MS });
      expect((await save(a, w)).statusCode).toBe(201);
      expect(await keptMs(w.workoutId)).toBe(SETS_AND_RESTS_MS);
    });

    it("a workout kept on a phone before it sent its time trained counts its sets and rests, never its pauses", async () => {
      const a = await person();
      const old: Record<string, unknown> & { workoutId: string } = workout({ endedAt: at(5.5 * HOUR) });
      delete old["trainedMs"];
      const res = await save(a, old);
      expect(res.statusCode).toBe(201);
      expect(await keptMs(old.workoutId)).toBe(SETS_AND_RESTS_MS);
    });
  });

  describe("the check the server holds on the time trained", () => {
    it("longer than the workout is refused, naming the field, and nothing is kept", async () => {
      const a = await person();
      const w = workout({ endedAt: at(30 * MIN), trainedMs: 30 * MIN + 1 });
      const res = await save(a, w);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ message: expect.stringContaining("trainedMs") as unknown });
      expect(await keptMs(w.workoutId)).toBeNull();
    });

    it("shorter than its sets and rests is refused", async () => {
      const a = await person();
      const res = await save(a, workout({ trainedMs: SETS_AND_RESTS_MS - 4000 }));
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ message: expect.stringContaining("longer than the time trained") as unknown });
    });

    it("past 12 hours, below none, or not a whole number is refused", async () => {
      const a = await person();
      for (const trainedMs of [12 * HOUR + 1, -1, 1.5, "1800000"]) {
        expect((await save(a, workout({ trainedMs }))).statusCode).toBe(400);
      }
    });
  });
});
