// A person's workout history and records for each exercise (job 61b): the four reads of
// `training/routes.ts` against REAL Postgres. DATABASE_URL-gated. The first block is the job's worst
// thing: one member reading another's workouts, or told "New record" against somebody else's past.
//
// The dates are worked out from today, because a free plan reads back 90 days of the real clock.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  exerciseRecordsSchema,
  historyDayOutSchema,
  historyMonthOutSchema,
  historyWorkoutSchema,
  type SavedSet,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { seed } from "../src/db/seed.js";
import type { EmailSender } from "../src/modules/auth/email.js";
import { exerciseRecords, newRecordsIn, unitAndDone, type SetFact } from "../src/modules/training/records.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "history-test-secret-0123456789ab-32", // dummy test value, gitleaks:allow
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

const DAY_MS = 86_400_000;
/** Midnight UTC, `n` days before today. */
const daysAgo = (n: number) => new Date(Math.floor(Date.now() / DAY_MS) * DAY_MS - n * DAY_MS);
/** The calendar day of an instant in a zone, "YYYY-MM-DD". */
const dayIn = (instant: Date, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);

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

const workout = (startedAt: Date, sets: SavedSet[], over: Record<string, unknown> = {}) => ({
  workoutId: randomUUID(),
  name: "Leg day",
  startedAt: startedAt.toISOString(),
  endedAt: new Date(startedAt.getTime() + 30 * 60_000).toISOString(),
  timeZone: "Asia/Kolkata",
  startedFrom: "none",
  effort: 3,
  heart: [],
  platform: "android",
  appVersion: "1.0.0",
  sets,
  ...over,
});

d("history and records for each exercise (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  let people = 0;
  const person = async (): Promise<Person> => {
    const email = `history-${String(people++)}-${randomUUID().slice(0, 8)}@example.com`;
    const inject = (path: string, body: unknown) =>
      api().inject({ method: "POST", url: path, remoteAddress: nextIp(), headers: { "content-type": "application/json" }, payload: JSON.stringify(body) });
    expect((await inject("/v1/auth/register", { email, password: PASSWORD, displayName: "History Fixture" })).statusCode).toBe(201);
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

  const get = (who: Person | null, path: string) =>
    api().inject({ method: "GET", url: path, remoteAddress: nextIp(), ...(who === null ? {} : { cookies: who.cookies }) });

  /** A workout as the old save route kept it: no name, no zone, no unit; by default a plank held 95.5
   *  seconds, or `set` for another set, such as one of reps with no hold. */
  const oldWorkout = async (who: Person, startedAt: Date, set: { slug: string; reps: number; holdMs: number | null } = { slug: "plank", reps: 0, holdMs: 95_500 }) => {
    const id = randomUUID();
    await sql`
      INSERT INTO workouts (id, user_id, started_at, ended_at, platform, engine_version, sets_count, total_reps, duration_ms)
      VALUES (${id}, ${who.id}, ${startedAt}, ${new Date(startedAt.getTime() + 10 * 60_000)}, 'web', 'old', 1, 0, 600000)`;
    await sql`
      INSERT INTO workout_sets (workout_id, user_id, exercise_id, started_at, set_index, mode, reps, hold_ms, duration_ms, engine_version, definition_version)
      VALUES (${id}, ${who.id}, (SELECT id FROM exercises WHERE slug = ${set.slug}), ${startedAt}, 0, 'log_only', ${set.reps}, ${set.holdMs}, ${set.holdMs ?? 30_000}, NULL, NULL)`;
    return id;
  };

  /** The Library's own name for an exercise, read from its file as published. */
  const libraryName = async (slug: string): Promise<string> => {
    const rows = await sql<{ name: string }[]>`
      SELECT l.entry->'text'->'en'->>'name' AS name FROM exercises e JOIN library_exercises l ON l.exercise_id = e.id WHERE e.slug = ${slug}`;
    const name = rows[0]?.name;
    if (name === undefined) throw new Error(`no Library name for ${slug}`);
    return name;
  };

  const mine = sql`SELECT id FROM users WHERE email LIKE 'history-%@example.com'`;
  const clear = async () => {
    await sql`DELETE FROM user_achievements WHERE user_id IN (${mine})`;
    await sql`DELETE FROM user_xp WHERE user_id IN (${mine})`;
    await sql`DELETE FROM streaks WHERE user_id IN (${mine})`;
    await sql`DELETE FROM workouts WHERE user_id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'history-%@example.com'`;
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

  describe("the worst thing: one member's workouts read by, or told against, another", () => {
    it("somebody else's workout is the same 404 as one that does not exist", async () => {
      const [a, b] = [await person(), await person()];
      const id = await save(a, workout(daysAgo(3), [set()]));
      expect((await get(a, `/v1/training/workouts/${id}`)).statusCode).toBe(200);
      const theirs = await get(b, `/v1/training/workouts/${id}`);
      const none = await get(b, `/v1/training/workouts/${randomUUID()}`);
      expect([theirs.statusCode, none.statusCode]).toEqual([404, 404]);
      expect(theirs.json<{ error: string; message: string }>()).toMatchObject({ error: "not_found", message: "workout not found" });
      expect(none.json<{ message: string }>().message).toBe("workout not found");
      expect(theirs.body).not.toContain("Leg day");
    });

    it("a month, a day and an exercise's records hold only the person's own workouts", async () => {
      const [a, b] = [await person(), await person()];
      const when = daysAgo(2);
      await save(b, workout(when, [set({ weightGrams: 200_000, done: 20 })], { name: "Somebody else's" }));
      await save(a, workout(new Date(when.getTime() + 3600_000), [set({ weightGrams: 60_000 })]));
      const day = dayIn(when, "Asia/Kolkata");

      const month = historyMonthOutSchema.parse((await get(a, `/v1/training/month?month=${day.slice(0, 7)}`)).json());
      expect(month.days).toEqual([{ day, workouts: 1 }]);
      const listed = historyDayOutSchema.parse((await get(a, `/v1/training/days/${day}`)).json());
      expect(listed.workouts.map((w) => w.name)).toEqual(["Leg day"]);
      expect(listed.total).toBe(1);
      const records = exerciseRecordsSchema.parse((await get(a, "/v1/training/exercises/squat/records")).json());
      expect(records.reps.heaviest?.weightGrams).toBe(60_000);
      expect(records.reps.mostReps?.done).toBe(5);
    });

    it("'New record' is told against the person's own past only, never somebody else's", async () => {
      const [a, b] = [await person(), await person()];
      // B lifted far more, earlier; A's second squat beats only A's own first.
      await save(b, workout(daysAgo(10), [set({ weightGrams: 300_000 })]));
      await save(a, workout(daysAgo(9), [set({ weightGrams: 80_000 })]));
      const second = await save(a, workout(daysAgo(8), [set({ weightGrams: 90_000 })]));
      const seen = historyWorkoutSchema.parse((await get(a, `/v1/training/workouts/${second}`)).json());
      expect(seen.newRecords).toContainEqual({ exercise: "squat", measuredIn: "reps", kind: "heaviest", position: 0 });
      // And B's own lighter one afterwards is no record of B's.
      const bLater = await save(b, workout(daysAgo(7), [set({ weightGrams: 90_000 })]));
      expect(historyWorkoutSchema.parse((await get(b, `/v1/training/workouts/${bLater}`)).json()).newRecords).toEqual([]);
    });

    it("a set written into somebody else's workout is never read as theirs or as the writer's", async () => {
      const [a, b] = [await person(), await person()];
      const id = await save(a, workout(daysAgo(4), [set({ weightGrams: 50_000 })]));
      // A row the save never writes: B's user id on A's workout. Neither read shows it.
      await sql`
        INSERT INTO workout_sets (workout_id, user_id, exercise_id, started_at, set_index, mode, reps, duration_ms, engine_version, definition_version, weight_grams, measured_in)
        VALUES (${id}, ${b.id}, (SELECT id FROM exercises WHERE slug = 'squat'), ${daysAgo(4)}, 1, 'log_only', 5, 30000, NULL, NULL, 500000, 'reps')`;
      const seen = historyWorkoutSchema.parse((await get(a, `/v1/training/workouts/${id}`)).json());
      expect(seen.sets.map((s) => s.weightGrams)).toEqual([50_000]);
      const bRecords = exerciseRecordsSchema.parse((await get(b, "/v1/training/exercises/squat/records")).json());
      expect(bRecords.reps.heaviest).toBeNull();
    });
  });

  describe("one workout, set by set", () => {
    it("every set as it was done, with its exercise's name and how it was counted", async () => {
      const a = await person();
      const id = await save(
        a,
        workout(daysAgo(5), [
          set({ target: 8, done: 6, weightGrams: 20_000, restSeconds: 90, exercise: "barbell_curl" }),
          set({ position: 1, exercise: "plank", measuredIn: "time", target: 30, done: 30, weightGrams: null, restSeconds: null, durationMs: 30_500, counted: "timer" }),
        ]),
      );
      const seen = historyWorkoutSchema.parse((await get(a, `/v1/training/workouts/${id}`)).json());
      expect(seen).toMatchObject({ workoutId: id, name: "Leg day", timeZone: "Asia/Calcutta", startedFrom: "none", effort: 3, platform: "android" });
      const [curl, plank] = [await libraryName("barbell_curl"), await libraryName("plank")];
      expect(seen.sets).toEqual([
        { position: 0, exercise: "barbell_curl", exerciseName: curl, measuredIn: "reps", target: 8, done: 6, weightGrams: 20_000, restSeconds: 90, durationMs: 30_000, counted: "hand" },
        { position: 1, exercise: "plank", exerciseName: plank, measuredIn: "time", target: 30, done: 30, weightGrams: null, restSeconds: null, durationMs: 30_500, counted: "timer" },
      ]);
      expect(seen.newRecords).toEqual([]);
    });

    it("an old workout reads as it was kept: a hold in whole seconds, by hand, and counts for records", async () => {
      const a = await person();
      const old = await oldWorkout(a, daysAgo(6));
      const seen = historyWorkoutSchema.parse((await get(a, `/v1/training/workouts/${old}`)).json());
      expect(seen).toMatchObject({ name: null, timeZone: null, startedFrom: null, effort: null, platform: "web" });
      expect(seen.sets).toEqual([
        { position: 0, exercise: "plank", exerciseName: await libraryName("plank"), measuredIn: "time", target: null, done: 95, weightGrams: null, restSeconds: null, durationMs: 95_500, counted: "hand" },
      ]);
      // A newer, longer plank beats the old one; a shorter one would not.
      const longer = await save(a, workout(daysAgo(5), [set({ exercise: "plank", measuredIn: "time", target: 96, done: 96, weightGrams: null, durationMs: 96_000, counted: "timer" })]));
      expect(historyWorkoutSchema.parse((await get(a, `/v1/training/workouts/${longer}`)).json()).newRecords).toEqual([
        { exercise: "plank", measuredIn: "time", kind: "longest_hold", position: 0 },
      ]);
    });

    it("an exercise the Library never had is named by nobody: its name is null, its set still shown", async () => {
      const a = await person();
      const slug = (await sql<{ slug: string }[]>`
        SELECT slug FROM exercises WHERE id NOT IN (SELECT exercise_id FROM library_exercises) ORDER BY slug LIMIT 1`)[0]?.slug;
      if (slug === undefined) throw new Error("every exercise has a Library row");
      const id = await oldWorkout(a, daysAgo(6));
      await sql`UPDATE workout_sets SET exercise_id = (SELECT id FROM exercises WHERE slug = ${slug}) WHERE workout_id = ${id}`;
      const seen = historyWorkoutSchema.parse((await get(a, `/v1/training/workouts/${id}`)).json());
      expect(seen.sets.map((s) => [s.exercise, s.exerciseName])).toEqual([[slug, null]]);
    });

    it("of two workouts started at the same instant, the one with the smaller id came first", async () => {
      const a = await person();
      const when = daysAgo(3);
      const [first, second] = [randomUUID(), randomUUID()].sort();
      // The heavier one is the one with the larger id, so it beats the other: never itself, never nothing.
      await save(a, workout(when, [set({ weightGrams: 70_000 })], { workoutId: first }));
      await save(a, workout(when, [set({ weightGrams: 75_000 })], { workoutId: second }));
      const told = await Promise.all(
        [first, second].map(async (id) => historyWorkoutSchema.parse((await get(a, `/v1/training/workouts/${id ?? ""}`)).json()).newRecords.map((r) => r.kind)),
      );
      expect(told).toEqual([[], ["heaviest", "best_estimated_1rm", "most_lifted"]]);
    });
  });

  describe("the database sends only what can be a record, and the records come out the same", () => {
    it("an exercise's records, and a workout's new records, equal the rule read over every set", async () => {
      const a = await person();
      // Workouts as the old route kept them: two planks held 95.5 and 95.9 seconds (both 95 whole
      // seconds, kept apart by their holds), and squats of reps with no hold and no weight.
      // Before them, an old plank with no hold at all: a set of nothing in reps, which must never stand
      // for the holds that were done the same way in every other column.
      await oldWorkout(a, daysAgo(31), { slug: "plank", reps: 0, holdMs: null });
      await oldWorkout(a, daysAgo(30));
      await oldWorkout(a, daysAgo(29), { slug: "plank", reps: 0, holdMs: 95_900 });
      await oldWorkout(a, daysAgo(28), { slug: "squat", reps: 9, holdMs: null });
      // Five workouts of the same few sets again and again, ties included, and a plank in time.
      const ids: string[] = [];
      for (let w = 0; w < 5; w++) {
        const sets = [0, 1, 2, 3, 4].map((i) => set({ position: i, done: 5 + ((w + i) % 3), weightGrams: 60_000 + ((w * i) % 3) * 5_000, durationMs: 20_000, restSeconds: 30 }));
        // The last workout's first set is heavier than anything before it, so it holds a record.
        if (w === 4) sets[0] = set({ position: 0, done: 5, weightGrams: 80_000, durationMs: 20_000, restSeconds: 30 });
        sets.push(set({ position: 5, exercise: "plank", measuredIn: "time", target: 60, done: 40 + (w % 2) * 20, weightGrams: null, durationMs: 60_000, restSeconds: null, counted: "timer" }));
        ids.push(await save(a, workout(daysAgo(20 - w), sets)));
      }
      const rows = await sql<{ workout_id: string; started_at: Date; slug: string; set_index: number; measured_in: string | null; reps: number; hold_ms: number | null; weight_grams: number | null }[]>`
        SELECT s.workout_id, w.started_at, e.slug, s.set_index, s.measured_in, s.reps, s.hold_ms, s.weight_grams
        FROM workout_sets s JOIN workouts w ON w.id = s.workout_id JOIN exercises e ON e.id = s.exercise_id WHERE s.user_id = ${a.id}`;
      const every: SetFact[] = rows.map((r) => ({ workoutId: r.workout_id, startedAt: r.started_at.toISOString(), exercise: r.slug, position: r.set_index, ...unitAndDone(r.measured_in, r.reps, r.hold_ms), weightGrams: r.weight_grams }));

      for (const exercise of ["squat", "plank"]) {
        const got = exerciseRecordsSchema.parse((await get(a, `/v1/training/exercises/${exercise}/records`)).json());
        expect(got).toEqual({ exercise, ...exerciseRecords(every.filter((x) => x.exercise === exercise)), limitedToDays: 90 });
      }
      // The old sets hold records: the first 95-second plank, and the nine squats.
      const plank = exerciseRecordsSchema.parse((await get(a, "/v1/training/exercises/plank/records")).json());
      expect(plank.time.longestHold).toMatchObject({ startedAt: daysAgo(30).toISOString(), done: 95 });
      const squat = exerciseRecordsSchema.parse((await get(a, "/v1/training/exercises/squat/records")).json());
      expect(squat.reps.mostReps).toMatchObject({ startedAt: daysAgo(28).toISOString(), done: 9 });
      const last = ids[4] ?? "";
      const seen = historyWorkoutSchema.parse((await get(a, `/v1/training/workouts/${last}`)).json());
      expect(seen.newRecords).toContainEqual({ exercise: "squat", measuredIn: "reps", kind: "heaviest", position: 0 });
      expect(seen.newRecords).toEqual(newRecordsIn(every.filter((x) => x.workoutId === last), every.filter((x) => x.workoutId !== last)));
    });
  });

  describe("a month and a day", () => {
    it("a day is the day in the zone the workout was done in; an old one in the person's own", async () => {
      const a = await person();
      // 20:00 UTC is 01:30 the next day in Kolkata.
      const evening = new Date(daysAgo(4).getTime() + 20 * 3600_000);
      await save(a, workout(evening, [set()]));
      await oldWorkout(a, new Date(daysAgo(4).getTime() + 2 * 3600_000));
      const kolkataDay = dayIn(evening, "Asia/Kolkata");
      const zone = (await sql<{ timezone: string | null }[]>`SELECT timezone FROM users WHERE id = ${a.id}`)[0]?.timezone ?? "UTC";
      const oldDay = dayIn(new Date(daysAgo(4).getTime() + 2 * 3600_000), zone);
      expect(kolkataDay).not.toBe(oldDay);

      const months = [...new Set([kolkataDay.slice(0, 7), oldDay.slice(0, 7)])];
      const days = (await Promise.all(months.map(async (m) => historyMonthOutSchema.parse((await get(a, `/v1/training/month?month=${m}`)).json()).days))).flat();
      expect(days).toEqual([{ day: oldDay, workouts: 1 }, { day: kolkataDay, workouts: 1 }]);
      const listed = historyDayOutSchema.parse((await get(a, `/v1/training/days/${kolkataDay}`)).json());
      expect(listed.workouts).toHaveLength(1);
      expect(listed.workouts[0]).toMatchObject({ name: "Leg day", setsCount: 1, exercises: ["squat"] });
    });

    it("an old workout's day in a person's own zone kept as an offset is the day in UTC, never west of it", async () => {
      // Postgres reads "+05:30" as five and a half hours WEST: 02:00 UTC would land on the day before.
      const a = await person();
      await sql`UPDATE users SET timezone = '+05:30' WHERE id = ${a.id}`;
      const early = new Date(daysAgo(5).getTime() + 2 * 3600_000);
      await oldWorkout(a, early);
      const day = early.toISOString().slice(0, 10);
      const month = historyMonthOutSchema.parse((await get(a, `/v1/training/month?month=${day.slice(0, 7)}`)).json());
      expect(month.days).toEqual([{ day, workouts: 1 }]);
      expect(historyDayOutSchema.parse((await get(a, `/v1/training/days/${day}`)).json()).total).toBe(1);
    });

    it("a free plan reads back 90 days and says so; a workout's own page still opens", async () => {
      const a = await person();
      const long = await oldWorkout(a, daysAgo(200));
      const month = historyMonthOutSchema.parse((await get(a, `/v1/training/month?month=${daysAgo(200).toISOString().slice(0, 7)}`)).json());
      expect(month).toMatchObject({ days: [], limitedToDays: 90 });
      const day = historyDayOutSchema.parse((await get(a, `/v1/training/days/${daysAgo(200).toISOString().slice(0, 10)}`)).json());
      expect(day).toMatchObject({ workouts: [], total: 0, limitedToDays: 90 });
      const records = exerciseRecordsSchema.parse((await get(a, "/v1/training/exercises/plank/records")).json());
      expect(records).toMatchObject({ limitedToDays: 90, time: { longestHold: null } });
      expect((await get(a, `/v1/training/workouts/${long}`)).statusCode).toBe(200);
    });

    it("a day's workouts list their exercises once each, in the order first done", async () => {
      const a = await person();
      const when = daysAgo(2);
      await save(a, workout(when, [set({ exercise: "plank", measuredIn: "time", target: 30, done: 30, weightGrams: null, durationMs: 30_000 }), set({ position: 1 }), set({ position: 2, exercise: "plank", measuredIn: "time", target: 30, done: 30, weightGrams: null, durationMs: 30_000 })]));
      const listed = historyDayOutSchema.parse((await get(a, `/v1/training/days/${dayIn(when, "Asia/Kolkata")}`)).json());
      expect(listed.workouts[0]?.exercises).toEqual(["plank", "squat"]);
    });
  });

  describe("what is refused", () => {
    it.each([
      ["/v1/training/month?month=2026-13", 400],
      ["/v1/training/month?month=2026-1", 400],
      ["/v1/training/month", 400],
      ["/v1/training/month?month=2026-11&x=1", 400],
      ["/v1/training/days/2026-02-30", 400],
      ["/v1/training/days/today", 400],
      ["/v1/training/workouts/not-an-id", 404],
      ["/v1/training/exercises/no_such_exercise/records", 404],
      ["/v1/training/exercises/Bad%20Word/records", 404],
    ])("%s is %s", async (path, status) => {
      const a = await person();
      expect((await get(a, path)).statusCode).toBe(status);
    });

    it("a person may read 120 times a minute; the 121st is refused, and somebody else at the same address is not", async () => {
      const [a, b] = [await person(), await person()];
      const read = (who: Person) =>
        api().inject({ method: "GET", url: "/v1/training/month?month=2026-11", remoteAddress: "10.62.250.250", cookies: who.cookies });
      for (let i = 0; i < 120; i++) expect((await read(a)).statusCode).toBe(200);
      expect((await read(a)).statusCode).toBe(429);
      expect((await read(b)).statusCode).toBe(200);
    });

    it("nobody signed in reads nothing", async () => {
      for (const path of ["/v1/training/month?month=2026-11", "/v1/training/days/2026-11-18", `/v1/training/workouts/${randomUUID()}`, "/v1/training/exercises/squat/records"]) {
        expect((await get(null, path)).statusCode).toBe(401);
      }
    });
  });
});
