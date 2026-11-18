// Saving a whole workout from the phone (spec Part 2 §13.5, job 61a): POST /v1/workouts against REAL
// Postgres. DATABASE_URL-gated. The first block is the job's worst thing: one member's save landing in,
// or changing, another member's workout. Then the save itself, a save sent twice, an exercise the
// Library does not know, the limits the server holds, and the old readers meeting a new workout.
//
// Each person may save ten a minute, so every test makes the people it needs.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { workoutSaveRefusalSchema, workoutSavedSchema, type SavedSet } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { seed } from "../src/db/seed.js";
import type { EmailSender } from "../src/modules/auth/email.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const NOW = new Date("2026-11-18T12:00:00.000Z");

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "training-test-secret-0123456789ab-32", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
interface Person {
  cookies: Cookies;
  id: string;
}

const silentAuthSender = (): EmailSender => ({
  sendVerificationEmail: () => Promise.resolve(),
  sendPasswordResetEmail: () => Promise.resolve(),
  sendSignInCodeEmail: () => Promise.resolve(),
});

let ipCounter = 0;
const nextIp = () => `10.61.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const START = "2026-11-18T08:00:00.000Z";
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

/** Squat by hand, a Library-only curl with a weight, a plank by timer: 30 minutes. */
const workout = (over: Record<string, unknown> = {}) => ({
  workoutId: randomUUID(),
  name: "Leg day",
  startedAt: START,
  endedAt: at(30 * 60_000),
  timeZone: "Asia/Kolkata",
  startedFrom: "none",
  effort: 4,
  heart: [],
  platform: "android",
  appVersion: "1.0.0",
  sets: [
    set(),
    set({ exercise: "barbell_curl", position: 1, target: 10, done: 8, weightGrams: 20_000, restSeconds: 90, durationMs: 30_000 }),
    set({ exercise: "plank", position: 2, measuredIn: "time", target: 30, done: 30, restSeconds: null, durationMs: 30_500, counted: "timer" }),
  ],
  ...over,
});

d("saving a workout from the phone (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  let people = 0;
  const person = async (): Promise<Person> => {
    const email = `training-${String(people++)}-${randomUUID().slice(0, 8)}@example.com`;
    const inject = (path: string, body: unknown) =>
      api().inject({ method: "POST", url: path, remoteAddress: nextIp(), headers: { "content-type": "application/json" }, payload: JSON.stringify(body) });
    expect((await inject("/v1/auth/register", { email, password: PASSWORD, displayName: "Training Fixture" })).statusCode).toBe(201);
    const login = await inject("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    const id = (await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`)[0]?.id;
    if (id === undefined) throw new Error(`no fixture ${email}`);
    return { cookies: cookieMap(login), id };
  };

  const save = (who: Person | null, body: { workoutId: string } & Record<string, unknown>, key: string = body.workoutId, address: string = nextIp()) =>
    api().inject({
      method: "POST",
      url: "/v1/workouts",
      remoteAddress: address,
      headers: { "content-type": "application/json", "idempotency-key": key },
      ...(who === null ? {} : { cookies: who.cookies }),
      payload: JSON.stringify(body),
    });

  /** Everything kept about one workout and its sets, to compare before and after. */
  const kept = async (workoutId: string) => ({
    workout: await sql<Record<string, unknown>[]>`
      SELECT user_id, name, started_at, ended_at, sets_count, total_reps, duration_ms, kcal_point, kcal_calc_version,
             time_zone, started_from, effort, heart_avg, heart_max, platform, engine_version
      FROM workouts WHERE id = ${workoutId}`,
    sets: await sql<Record<string, unknown>[]>`
      SELECT s.user_id, e.slug, s.set_index, s.mode, s.reps, s.hold_ms, s.duration_ms, s.counted, s.measured_in, s.target,
             s.weight_grams, s.rest_seconds
      FROM workout_sets s JOIN exercises e ON e.id = s.exercise_id WHERE s.workout_id = ${workoutId} ORDER BY s.set_index`,
  });

  const mine = sql`SELECT id FROM users WHERE email LIKE 'training-%@example.com'`;
  const clear = async () => {
    await sql`DELETE FROM user_achievements WHERE user_id IN (${mine})`;
    await sql`DELETE FROM user_xp WHERE user_id IN (${mine})`;
    await sql`DELETE FROM streaks WHERE user_id IN (${mine})`;
    await sql`DELETE FROM workouts WHERE user_id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'training-%@example.com'`;
  };

  beforeAll(async () => {
    await seed(url ?? "");
    await clear();
    app = await buildApp(loadConfig(baseEnv), { emailSender: silentAuthSender(), training: { now: () => NOW } });
  }, 120_000);
  afterAll(async () => {
    await clear();
    await app?.close();
    await sql.end();
  });

  describe("the worst thing: one member's save never lands in or changes another member's workout", () => {
    it("a save under somebody else's workout id is not found, and their workout and its sets are as they were", async () => {
      const [a, b] = [await person(), await person()];
      const theirs = workout();
      expect((await save(a, theirs)).statusCode).toBe(201);
      const before = await kept(theirs.workoutId);

      const intruder = workout({ workoutId: theirs.workoutId, name: "Not yours", sets: [set({ done: 99 }), set({ position: 1, exercise: "plank", measuredIn: "time", target: 30, done: 30, durationMs: 30_000 }), set({ position: 2 }), set({ position: 3 })] });
      const res = await save(b, intruder);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: "not_found" });
      expect(await kept(theirs.workoutId)).toEqual(before);
      expect(before.workout[0]?.["user_id"]).toBe(a.id);
      expect(before.sets.map((s) => s["user_id"])).toEqual([a.id, a.id, a.id]);
      expect((await sql`SELECT count(*)::int AS n FROM workouts WHERE user_id = ${b.id}`)[0]?.["n"]).toBe(0);
    });

    it("two members saving one new id at the same instant: one owns it, the other is not found, and every set is the owner's", async () => {
      for (let round = 0; round < 5; round++) {
        const [a, b] = [await person(), await person()];
        const id = randomUUID();
        const fromA = workout({ workoutId: id, name: "A's" });
        const fromB = workout({ workoutId: id, name: "B's", sets: [set({ done: 5 }), set({ position: 1, done: 6 })] });
        const [ra, rb] = await Promise.all([save(a, fromA), save(b, fromB)]);
        expect([ra.statusCode, rb.statusCode].sort()).toEqual([201, 404]);
        const winner = ra.statusCode === 201 ? a : b;
        const after = await kept(id);
        expect(after.workout[0]?.["user_id"]).toBe(winner.id);
        expect(after.workout[0]?.["name"]).toBe(winner === a ? "A's" : "B's");
        expect(after.sets.map((s) => s["user_id"])).toEqual(winner === a ? [a.id, a.id, a.id] : [b.id, b.id]);
      }
    });
  });

  describe("the save", () => {
    it("keeps the workout and every set as the phone sent them, with the server's own calories", async () => {
      const a = await person();
      const body = workout();
      const res = await save(a, body);
      expect(res.statusCode).toBe(201);
      expect(workoutSavedSchema.parse(res.json())).toEqual({ workoutId: body.workoutId, status: "created" });

      const { workout: [w], sets } = await kept(body.workoutId);
      expect(w).toMatchObject({
        user_id: a.id,
        name: "Leg day",
        sets_count: 3,
        total_reps: 20,
        duration_ms: 1_800_000,
        // 3.0×70×40/3600 + 1.8×70×60/3600 + 3.5×70×30/3600 + 1.8×70×90/3600 + 2.8×70×30.5/3600 = 11.29
        kcal_point: 11,
        kcal_calc_version: 4,
        time_zone: expect.stringMatching(/^Asia\/(Kolkata|Calcutta)$/) as unknown,
        started_from: "none",
        effort: 4,
        heart_avg: null,
        heart_max: null,
        platform: "android",
        engine_version: "1.0.0",
      });
      expect((w?.["ended_at"] as Date).toISOString()).toBe(at(30 * 60_000));
      expect(sets).toEqual([
        { user_id: a.id, slug: "squat", set_index: 0, mode: "log_only", reps: 12, hold_ms: null, duration_ms: 40_000, counted: "hand", measured_in: "reps", target: 12, weight_grams: null, rest_seconds: 60 },
        { user_id: a.id, slug: "barbell_curl", set_index: 1, mode: "log_only", reps: 8, hold_ms: null, duration_ms: 30_000, counted: "hand", measured_in: "reps", target: 10, weight_grams: 20_000, rest_seconds: 90 },
        { user_id: a.id, slug: "plank", set_index: 2, mode: "log_only", reps: 0, hold_ms: 30_000, duration_ms: 30_500, counted: "timer", measured_in: "time", target: 30, weight_grams: null, rest_seconds: null },
      ]);
    });

    it("keeps the sets in their places whatever order they arrive in", async () => {
      const a = await person();
      const body = workout();
      body.sets.reverse();
      expect((await save(a, body)).statusCode).toBe(201);
      expect((await kept(body.workoutId)).sets.map((s) => s["slug"])).toEqual(["squat", "barbell_curl", "plank"]);
    });

    it("keeps the heart rate's average and highest, never the readings", async () => {
      const a = await person();
      // Two minutes: a reading a second, 100 for the first minute and 140 for the second. The last
      // stands 5 seconds (HEART_STANDS_MS), as a run's does: (100×60 + 140×64) / 124 = 120.6.
      const heart = Array.from({ length: 120 }, (_, i) => [i * 1000, i < 60 ? 100 : 140]);
      const body = workout({ heart });
      expect((await save(a, body)).statusCode).toBe(201);
      expect((await kept(body.workoutId)).workout[0]).toMatchObject({ heart_avg: 121, heart_max: 140 });
    });

    it("refuses a signed-out phone", async () => {
      expect((await save(null, workout())).statusCode).toBe(401);
    });
  });

  describe("sent twice, it is one workout", () => {
    it("the second send is answered 'duplicate', and the XP and the streak are given once", async () => {
      const a = await person();
      const body = workout();
      expect((await save(a, body)).statusCode).toBe(201);
      const xp = async () => (await sql<{ total_xp: number }[]>`SELECT total_xp FROM user_xp WHERE user_id = ${a.id}`)[0]?.["total_xp"];
      const streak = async () => (await sql<{ current: number; longest: number }[]>`SELECT current, longest FROM streaks WHERE user_id = ${a.id}`)[0];
      const [xpOnce, streakOnce] = [await xp(), await streak()];
      expect(xpOnce).toBeGreaterThan(0);

      const again = await save(a, body);
      expect(again.statusCode).toBe(200);
      expect(again.json()).toEqual({ workoutId: body.workoutId, status: "duplicate" });
      expect(await xp()).toBe(xpOnce);
      expect(await streak()).toEqual(streakOnce);
      expect((await sql`SELECT count(*)::int AS n FROM workouts WHERE user_id = ${a.id}`)[0]?.["n"]).toBe(1);
      expect((await kept(body.workoutId)).sets).toHaveLength(3);
    });

    it("a second send with other sets adds none of them", async () => {
      const a = await person();
      const body = workout();
      expect((await save(a, body)).statusCode).toBe(201);
      const before = await kept(body.workoutId);
      const more = workout({ workoutId: body.workoutId, name: "Changed", sets: [...body.sets, set({ position: 3 })] });
      expect((await save(a, more)).statusCode).toBe(200);
      expect(await kept(body.workoutId)).toEqual(before);
    });

    it("sent twice at the same instant: one made, one duplicate, three sets", async () => {
      for (let round = 0; round < 5; round++) {
        const a = await person();
        const body = workout();
        const codes = (await Promise.all([save(a, body), save(a, body)])).map((r) => r.statusCode).sort();
        expect(codes).toEqual([200, 201]);
        expect((await kept(body.workoutId)).sets).toHaveLength(3);
      }
    });

    it("an Idempotency-Key that is not the workout's id is refused", async () => {
      const a = await person();
      const res = await save(a, workout(), randomUUID());
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: "idempotency_key_mismatch" });
    });
  });

  describe("an exercise the Library does not know refuses the whole save", () => {
    it("names the exercise, keeps nothing, and the same workout sent again with known exercises is saved", async () => {
      const a = await person();
      const body = workout({ sets: [set(), set({ position: 1, exercise: "not_an_exercise" }), set({ position: 2, exercise: "also_unknown" })] });
      const res = await save(a, body);
      expect(res.statusCode).toBe(422);
      expect(workoutSaveRefusalSchema.parse(res.json())).toMatchObject({ error: "unknown_exercise", exercises: ["also_unknown", "not_an_exercise"] });
      expect(await kept(body.workoutId)).toEqual({ workout: [], sets: [] });
      expect((await sql`SELECT count(*)::int AS n FROM user_xp WHERE user_id = ${a.id}`)[0]?.["n"]).toBe(0);

      expect((await save(a, workout({ workoutId: body.workoutId }))).statusCode).toBe(201);
    });

    it("one of the old exercises that is not in the Library is not known", async () => {
      const a = await person();
      const old = (await sql<{ slug: string }[]>`
        SELECT e.slug FROM exercises e WHERE e.family IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM library_exercises l WHERE l.exercise_id = e.id) ORDER BY e.slug LIMIT 1`)[0]?.slug;
      if (old === undefined) throw new Error("every old exercise is in the Library");
      const res = await save(a, workout({ sets: [set({ exercise: old })] }));
      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({ exercises: [old] });
    });

    it("a workout naming an exercise removed from the Library since is saved, with that exercise", async () => {
      // A row of its own, removed, with no file. While a set names it, the next publish would bring it
      // back as 'hidden' and into a copy (60b's own test proves that half), so this test holds the
      // publish lock shared from the save until its rows are gone: no other test file's seed can
      // publish meanwhile. A shared hold does not stop the save, which takes it shared too.
      const holder = await sql.reserve();
      await holder`BEGIN`;
      await holder`SELECT pg_advisory_xact_lock_shared(hashtext('library:publish'))`;
      const slug = `training_removed_${randomUUID().slice(0, 8)}`;
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO exercises (slug, name_key, family, tier, tracking, status, met) VALUES (${slug}, NULL, NULL, NULL, NULL, 'hidden', 3.0) RETURNING id`;
      const exerciseId = row?.id ?? "";
      const squat = (await sql<{ entry: Record<string, unknown> }[]>`
        SELECT l.entry FROM library_exercises l JOIN exercises e ON e.id = l.exercise_id WHERE e.slug = 'squat'`)[0]?.entry;
      await sql`
        INSERT INTO library_exercises (exercise_id, status, met, compendium, measured_in, weight, each_side, entry)
        VALUES (${exerciseId}, 'removed', 3.0, '02056', 'reps', 'never', false, ${sql.json(JSON.parse(JSON.stringify({ ...squat, id: slug })) as Record<string, string>)})`;
      try {
        const body = workout({ sets: [set({ exercise: slug })] });
        expect((await save(await person(), body)).statusCode).toBe(201);
        expect((await kept(body.workoutId)).sets.map((s) => s["slug"])).toEqual([slug]);
      } finally {
        await sql`DELETE FROM workouts WHERE id IN (SELECT workout_id FROM workout_sets WHERE exercise_id = ${exerciseId})`;
        await sql`DELETE FROM library_exercises WHERE exercise_id = ${exerciseId}`;
        await sql`DELETE FROM exercises WHERE id = ${exerciseId}`;
        await holder`COMMIT`;
        holder.release();
      }
    });

    it("a save waits while the Library is being published, and is saved when the publish ends", async () => {
      // The publish's own lock, held as a publish holds it, in a transaction that is then ended.
      const holder = await sql.reserve();
      await holder`BEGIN`;
      await holder`SELECT pg_advisory_xact_lock(hashtext('library:publish'))`;
      const pid = (await holder<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0]?.pid ?? 0;
      let done = false;
      // Read through a function: TypeScript cannot see the callback set it, and would call the flag always false.
      const isDone = (): boolean => done;
      const pending = save(await person(), workout()).finally(() => {
        done = true;
      });
      try {
        let waiting = 0;
        for (let i = 0; i < 100 && waiting === 0 && !isDone(); i++) {
          waiting = (await sql<{ n: number }[]>`
            SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE wait_event_type = 'Lock' AND wait_event = 'advisory' AND ${pid} = ANY(pg_blocking_pids(pid))`)[0]?.n ?? 0;
          if (waiting === 0 && !isDone()) await new Promise((r) => setTimeout(r, 100));
        }
        expect(waiting).toBe(1);
        expect(isDone()).toBe(false);
      } finally {
        await holder`COMMIT`;
        holder.release();
      }
      expect((await pending).statusCode).toBe(201);
    });
  });

  describe("the limits the server holds", () => {
    it("a broken phone's save is refused with its fields, never its values", async () => {
      const a = await person();
      const res = await save(a, workout({ name: "Secret name that is far too long for a workout's name, kept out of the reply" }));
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: "validation_error" });
      expect(res.body).toContain("name");
      expect(res.body).not.toContain("Secret name");
    });

    it("sets and rests longer than the workout are refused", async () => {
      const a = await person();
      const res = await save(a, workout({ endedAt: at(60_000) }));
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ message: expect.stringContaining("longer than the workout") as unknown });
    });

    it("a workout that ends past the server's clock is refused, and one a few minutes ahead is kept", async () => {
      const a = await person();
      const ahead = (ms: number) => ({ startedAt: new Date(NOW.getTime() + ms - 30 * 60_000).toISOString(), endedAt: new Date(NOW.getTime() + ms).toISOString() });
      const late = await save(a, workout(ahead(5 * 60_000 + 1000)));
      expect(late.statusCode).toBe(400);
      expect(late.json()).toMatchObject({ message: "endedAt: the workout has not ended yet" });
      expect((await save(a, workout(ahead(4 * 60_000)))).statusCode).toBe(201);
    });

    it("a time zone that is not one, or an offset, is refused; one in other letters is kept by its own name", async () => {
      const a = await person();
      for (const timeZone of ["Mars/Olympus", "+05:30", "+0530"]) {
        const res = await save(a, workout({ timeZone }));
        expect(res.statusCode).toBe(400);
        expect(res.json()).toMatchObject({ message: "timeZone: not a time zone" });
      }
      const body = workout({ timeZone: "asia/kolkata" });
      expect((await save(a, body)).statusCode).toBe(201);
      const kept = (await sql<{ time_zone: string }[]>`SELECT time_zone FROM workouts WHERE id = ${body.workoutId}`)[0]?.time_zone ?? "";
      // Node 24's time zone list spells it Asia/Calcutta, a newer one may say Asia/Kolkata; Postgres
      // knows both names as one zone, and the day below is the proof that matters.
      expect(["Asia/Calcutta", "Asia/Kolkata"]).toContain(kept);
      expect((await sql<{ day: string }[]>`SELECT (timestamptz '2026-11-18T20:00:00Z' AT TIME ZONE ${kept})::date::text AS day`)[0]?.day).toBe("2026-11-19");
    });

    it("a workout already saved is answered 'duplicate' before its fields are checked again", async () => {
      const a = await person();
      const body = workout();
      expect((await save(a, body)).statusCode).toBe(201);
      const again = await save(a, { ...body, timeZone: "Mars/Olympus" });
      expect(again.statusCode).toBe(200);
      expect(again.json()).toMatchObject({ status: "duplicate" });
    });

    it("ten saves a minute for a person, never by address: the eleventh refused, and another person at the same address still saves", async () => {
      const [a, b] = [await person(), await person()];
      const address = "10.61.250.7";
      // Ten bodies that are each refused, so nothing is written: each still counts.
      for (let i = 0; i < 10; i++) expect((await save(a, workout({ timeZone: "Mars/Olympus" }), undefined, address)).statusCode).toBe(400);
      expect((await save(a, workout(), undefined, address)).statusCode).toBe(429);
      for (let i = 0; i < 10; i++) expect((await save(b, workout(), undefined, address)).statusCode).toBe(201);
    });

    it("a set is kept in its own unit and weight, as the phone's list had them, whatever the Library says now", async () => {
      // Refusing it would leave a finished workout that can never be saved, after a Library edit.
      const a = await person();
      const body = workout({ sets: [set({ exercise: "plank", measuredIn: "reps", target: 10, done: 10, weightGrams: 10_000 })] });
      expect((await save(a, body)).statusCode).toBe(201);
      expect((await kept(body.workoutId)).sets[0]).toMatchObject({ slug: "plank", measured_in: "reps", reps: 10, hold_ms: null, weight_grams: 10_000 });
    });
  });

  describe("the old readers meet a workout saved from the phone", () => {
    it("the history, the workout's page, its summary and the exercise mix all read it", async () => {
      const a = await person();
      const body = workout();
      expect((await save(a, body)).statusCode).toBe(201);
      const get = (path: string) => api().inject({ method: "GET", url: path, remoteAddress: nextIp(), cookies: a.cookies });

      const list = await get("/v1/workouts");
      expect(list.statusCode).toBe(200);
      expect(list.json<{ items: { id: string }[] }>().items.map((i) => i.id)).toEqual([body.workoutId]);
      const page = await get(`/v1/workouts/${body.workoutId}`);
      expect(page.statusCode).toBe(200);
      expect(page.json<{ sets: { exerciseSlug: string; mode: string }[] }>().sets.map((s) => [s.exerciseSlug, s.mode])).toEqual([
        ["squat", "log_only"],
        ["barbell_curl", "log_only"],
        ["plank", "log_only"],
      ]);
      const summary = await get(`/v1/workouts/${body.workoutId}/summary`);
      expect(summary.statusCode).toBe(200);
      expect(summary.json()).toMatchObject({ workoutId: body.workoutId, exercisesCount: 3, caloriesBurned: 11, activeSeconds: 100, durationSeconds: 1800, formAccuracy: null });

      // The curl is only the Library's and has no old family: the old mix leaves it out, never "null".
      const mix = await get("/v1/progress/distribution?period=all");
      expect(mix.statusCode).toBe(200);
      const families = mix.json<{ families: { family: string | null }[] }>().families.map((f) => f.family);
      expect(families).not.toContain(null);
      expect(families.sort()).toEqual(["F1", "F10"]);
    });

    it("another member's workout is not on a person's pages", async () => {
      const [a, b] = [await person(), await person()];
      const body = workout();
      expect((await save(a, body)).statusCode).toBe(201);
      const res = await api().inject({ method: "GET", url: `/v1/workouts/${body.workoutId}`, remoteAddress: nextIp(), cookies: b.cookies });
      expect(res.statusCode).toBe(404);
    });
  });
});
