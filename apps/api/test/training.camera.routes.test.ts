// A set counted by the camera, saved from the phone (spec Part 2 §13.3 and §13.5, job 64b-i): POST /v1/workouts against
// REAL Postgres. DATABASE_URL-gated.
//
// THE WORST THING THIS JOB COULD DO TO A REAL PERSON: keep a form score for a set no camera watched, or keep anything of
// their body on the server. The first block is that, through the route and then at the database itself, which refuses
// such a row whoever writes it. Then the save, sent twice, History, the old readers, and the privacy download and delete.
//
// Each person may save ten a minute, so every test makes the people it needs.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { historyWorkoutSchema, type CameraSetFacts, type SavedSet } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { seed } from "../src/db/seed.js";
import type { EmailSender } from "../src/modules/auth/email.js";
import { XP_REWARDS } from "../src/modules/gamification/xp.js";
import { buildUserExport } from "../src/modules/privacy/export.js";
import { deleteUserOwnedRows } from "../src/modules/privacy/repo.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const NOW = new Date("2026-11-28T12:00:00.000Z");

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "camera-set-test-secret-0123456789-32", // dummy test value, gitleaks:allow
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

const START = "2026-11-28T08:00:00.000Z";
const at = (ms: number) => new Date(Date.parse(START) + ms).toISOString();

/** The squat's summary as the movement engine makes it, less the set's own fields: its reps' scores mean 90. */
const summary = (over: Partial<NonNullable<CameraSetFacts["summary"]>> = {}): NonNullable<CameraSetFacts["summary"]> => ({
  definitionVersion: 2,
  repScores: [100, 75, 100, 50, 100, 100, 75, 100, 100, 100],
  faultCounts: { knees_cave_in: 2, lean_forward: 1 },
  watchedMs: 38_000,
  tempoMsAvg: 2_100,
  romStats: { depth: 0.42, "knees bent": 96.5 },
  view: "front",
  ...over,
});

const handSet = (over: Partial<SavedSet> = {}): SavedSet => ({
  exercise: "squat",
  position: 0,
  measuredIn: "reps",
  target: 10,
  done: 10,
  weightGrams: null,
  restSeconds: 60,
  durationMs: 40_000,
  counted: "hand",
  ...over,
});
const cameraSet = (over: Partial<SavedSet> = {}, camera: Partial<CameraSetFacts> = {}): SavedSet => ({
  ...handSet(),
  counted: "camera",
  camera: { done: 10, left: null, engineVersion: "2.1.0", summary: summary(), ...camera },
  ...over,
});

/** A squat set the camera judged, a goblet squat it counted with no file of its own (the person took the last two over),
 *  a plank by timer: 30 minutes. */
const workout = (sets: unknown[] = [cameraSet(), cameraSet({ exercise: "kettlebell_goblet_squat", position: 1, done: 12, weightGrams: 16_000 }, { done: 10, left: "chosen", summary: null }), handSet({ exercise: "plank", position: 2, measuredIn: "time", target: 30, done: 30, restSeconds: null, durationMs: 30_500, counted: "timer" })], over: Record<string, unknown> = {}) => ({
  workoutId: randomUUID(),
  name: "Camera day",
  startedAt: START,
  endedAt: at(30 * 60_000),
  timeZone: "Asia/Kolkata",
  startedFrom: "none",
  effort: null,
  heart: [],
  platform: "android",
  appVersion: "1.0.0",
  sets,
  trainedMs: 30 * 60_000,
  ...over,
});

const POINTS = Array.from({ length: 33 }, (_, i) => [0.0123 * i, 0.0456 * i, 0.987]);

d("a set counted by the camera, saved from the phone (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  let people = 0;
  const person = async (): Promise<Person> => {
    const email = `camera-set-${String(people++)}-${randomUUID().slice(0, 8)}@example.com`;
    const inject = (path: string, body: unknown) =>
      api().inject({ method: "POST", url: path, remoteAddress: nextIp(), headers: { "content-type": "application/json" }, payload: JSON.stringify(body) });
    expect((await inject("/v1/auth/register", { email, password: PASSWORD, displayName: "Camera Fixture" })).statusCode).toBe(201);
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
  const get = (who: Person, path: string) => api().inject({ method: "GET", url: path, remoteAddress: nextIp(), cookies: who.cookies });

  /** Every set column a camera set fills, in place order. */
  const setsOf = (workoutId: string) => sql<Record<string, unknown>[]>`
    SELECT e.slug, s.set_index, s.mode, s.counted, s.reps, s.hold_ms, s.camera_done, s.left_camera, s.engine_version,
           s.definition_version, s.view, s.watched_ms, s.avg_form_score, s.rep_scores, s.fault_counts, s.tempo_ms_avg,
           s.rom_stats, s.calibration
    FROM workout_sets s JOIN exercises e ON e.id = s.exercise_id WHERE s.workout_id = ${workoutId} ORDER BY s.set_index`;
  const formOf = async (workoutId: string) => (await sql<{ avg_form_score: number | null }[]>`SELECT avg_form_score FROM workouts WHERE id = ${workoutId}`)[0]?.avg_form_score;
  const workoutsOf = async (who: Person) => (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM workouts WHERE user_id = ${who.id}`)[0]?.n;

  const mine = sql`SELECT id FROM users WHERE email LIKE 'camera-set-%@example.com'`;
  const clear = async () => {
    await sql`DELETE FROM user_achievements WHERE user_id IN (${mine})`;
    await sql`DELETE FROM user_xp WHERE user_id IN (${mine})`;
    await sql`DELETE FROM streaks WHERE user_id IN (${mine})`;
    await sql`DELETE FROM workouts WHERE user_id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'camera-set-%@example.com'`;
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

  describe("the worst thing: no form score for a set no camera watched, and nothing of the body, ever kept", () => {
    it("a set by hand carrying the camera's facts refuses the whole save, and nothing is kept", async () => {
      const a = await person();
      const body = workout([cameraSet(), { ...handSet({ position: 1 }), camera: { done: 10, left: null, engineVersion: "2.1.0", summary: summary({ repScores: [100] }) } }]);
      const res = await save(a, body);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: "validation_error", message: expect.stringContaining("sets.1.camera") as unknown });
      expect(await workoutsOf(a)).toBe(0);
    });

    it("body points anywhere in a camera set refuse the whole save; the reply names the field, never a point", async () => {
      const a = await person();
      const smuggled: unknown[] = [
        { ...cameraSet(), points: POINTS },
        cameraSet({}, { summary: { ...summary(), points: POINTS } as NonNullable<CameraSetFacts["summary"]> }),
        cameraSet({}, { summary: { ...summary(), calibration: { standing: POINTS } } as NonNullable<CameraSetFacts["summary"]> }),
        cameraSet({}, { summary: summary({ romStats: Object.fromEntries(POINTS.map(([x], i) => [`point ${String(i)}`, x ?? 0])) }) }),
      ];
      for (const s of smuggled) {
        const res = await save(a, workout([s]));
        expect(res.statusCode).toBe(400);
        expect(res.body).not.toContain("0.0123");
        expect(res.body).not.toContain("0.987");
      }
      expect(await workoutsOf(a)).toBe(0);
    });

    it("beside a camera set, a set by hand and one by timer keep no form score, and the workout's is the camera's alone", async () => {
      const a = await person();
      const body = workout([handSet(), cameraSet({ position: 1 }, { summary: summary({ repScores: [60, 70] , faultCounts: {} }), done: 2 }), handSet({ exercise: "plank", position: 2, measuredIn: "time", target: 30, done: 30, restSeconds: null, durationMs: 30_500, counted: "timer" })]);
      expect((await save(a, body)).statusCode).toBe(201);
      const sets = await setsOf(body.workoutId);
      for (const i of [0, 2]) {
        expect(sets[i]).toMatchObject({ mode: "log_only", camera_done: null, left_camera: null, avg_form_score: null, rep_scores: null, fault_counts: {}, engine_version: null, definition_version: null, view: null, watched_ms: null, rom_stats: null });
      }
      expect(sets[1]).toMatchObject({ mode: "engine", avg_form_score: 65 });
      expect(await formOf(body.workoutId)).toBe(65);
    });

    it("nothing of the body is in a kept camera set: only its numbers and the movement files' own words", async () => {
      const a = await person();
      const body = workout();
      expect((await save(a, body)).statusCode).toBe(201);
      const [row] = await sql<{ rom_stats: Record<string, number> | null; fault_counts: Record<string, number>; calibration: unknown }[]>`
        SELECT rom_stats, fault_counts, calibration FROM workout_sets WHERE workout_id = ${body.workoutId} AND set_index = 0`;
      expect(row?.calibration).toBeNull();
      expect(Object.keys(row?.rom_stats ?? {}).sort()).toEqual(["depth", "knees bent"]);
      expect(Object.keys(row?.fault_counts ?? {}).sort()).toEqual(["knees_cave_in", "lean_forward"]);
    });

    describe("the database itself refuses such a row, whoever writes it", () => {
      let workoutId = "";
      let exerciseId = "";
      let userId = "";
      beforeAll(async () => {
        const a = await person();
        userId = a.id;
        const body = workout([handSet()]);
        expect((await save(a, body)).statusCode).toBe(201);
        workoutId = body.workoutId;
        exerciseId = (await sql<{ id: string }[]>`SELECT id FROM exercises WHERE slug = 'squat'`)[0]?.id ?? "";
      });

      /** One set row at place 9, its columns named. */
      const insert = (c: { counted: string | null; mode: string | null; cameraDone?: number | null; left?: string | null; avg?: number | null; scores?: number[] | null; faults?: Record<string, number>; engine?: string | null; definition?: number | null }) => sql`
        INSERT INTO workout_sets (workout_id, user_id, exercise_id, started_at, set_index, mode, reps, duration_ms, counted,
                                  camera_done, left_camera, avg_form_score, rep_scores, fault_counts, engine_version, definition_version)
        VALUES (${workoutId}, ${userId}, ${exerciseId}, now(), 9, ${c.mode}, 10, 1000, ${c.counted},
                ${c.cameraDone ?? null}, ${c.left ?? null}, ${c.avg ?? null}, ${c.scores ?? null}::smallint[], ${sql.json(c.faults ?? {})},
                ${c.engine ?? null}, ${c.definition ?? null})`;
      const rejects = (p: Promise<unknown>, constraint: string) => expect(p).rejects.toMatchObject({ code: "23514", constraint_name: constraint });

      it.each<[string, Parameters<typeof insert>[0], string]>([
        ["a set by hand marked the engine's, with a form score", { counted: "hand", mode: "engine", avg: 90, scores: [90], engine: "2.1.0", definition: 2 }, "workout_sets_hand_is_log_only_check"],
        ["a set by timer marked the engine's", { counted: "timer", mode: "engine", engine: "2.1.0", definition: 2 }, "workout_sets_hand_is_log_only_check"],
        ["a set by hand with the camera's own count", { counted: "hand", mode: "log_only", cameraDone: 10 }, "workout_sets_camera_facts_check"],
        ["a set by hand left by the camera", { counted: "hand", mode: "log_only", left: "chosen" }, "workout_sets_camera_facts_check"],
        ["a camera set marked counted by hand's mode", { counted: "camera", mode: "log_only", cameraDone: 10 }, "workout_sets_camera_facts_check"],
        ["a camera set with no count of its own", { counted: "camera", mode: "engine", engine: "2.1.0" }, "workout_sets_camera_facts_check"],
        ["a camera set naming no engine", { counted: "camera", mode: "engine", cameraDone: 10 }, "workout_sets_camera_facts_check"],
        ["a camera set with no camera file, carrying a form score", { counted: "camera", mode: "engine", cameraDone: 10, engine: "2.1.0", avg: 90 }, "workout_sets_engine_provenance_check"],
        ["a camera set with no camera file, carrying faults", { counted: "camera", mode: "engine", cameraDone: 10, engine: "2.1.0", faults: { lean_forward: 1 } }, "workout_sets_engine_provenance_check"],
        ["a way of leaving the camera the database does not know", { counted: "camera", mode: "engine", cameraDone: 10, engine: "2.1.0", left: "gave_up" }, "workout_sets_left_camera_check"],
        ["the camera counting below nothing", { counted: "camera", mode: "engine", cameraDone: -1, engine: "2.1.0" }, "workout_sets_camera_done_check"],
      ])("%s", async (_name, c, constraint) => {
        await rejects(insert(c), constraint);
      });

      it("and takes the two camera sets the save writes", async () => {
        await insert({ counted: "camera", mode: "engine", cameraDone: 10, engine: "2.1.0" });
        await sql`DELETE FROM workout_sets WHERE workout_id = ${workoutId} AND set_index = 9`;
        await insert({ counted: "camera", mode: "engine", cameraDone: 10, left: "camera_stopped", avg: 90, scores: [90], faults: { lean_forward: 1 }, engine: "2.1.0", definition: 2 });
        await sql`DELETE FROM workout_sets WHERE workout_id = ${workoutId} AND set_index = 9`;
      });
    });
  });

  describe("the save", () => {
    it("keeps each camera set's facts, its form score worked out by the server, and the workout's", async () => {
      const a = await person();
      const body = workout();
      const res = await save(a, body);
      expect(res.statusCode).toBe(201);
      expect(await setsOf(body.workoutId)).toEqual([
        {
          slug: "squat", set_index: 0, mode: "engine", counted: "camera", reps: 10, hold_ms: null, camera_done: 10, left_camera: null,
          engine_version: "2.1.0", definition_version: 2, view: "front", watched_ms: 38_000, avg_form_score: 90,
          rep_scores: [100, 75, 100, 50, 100, 100, 75, 100, 100, 100], fault_counts: { knees_cave_in: 2, lean_forward: 1 },
          tempo_ms_avg: 2_100, rom_stats: { depth: 0.42, "knees bent": 96.5 }, calibration: null,
        },
        {
          slug: "kettlebell_goblet_squat", set_index: 1, mode: "engine", counted: "camera", reps: 12, hold_ms: null, camera_done: 10, left_camera: "chosen",
          engine_version: "2.1.0", definition_version: null, view: null, watched_ms: null, avg_form_score: null,
          rep_scores: null, fault_counts: {}, tempo_ms_avg: null, rom_stats: null, calibration: null,
        },
        {
          slug: "plank", set_index: 2, mode: "log_only", counted: "timer", reps: 0, hold_ms: 30_000, camera_done: null, left_camera: null,
          engine_version: null, definition_version: null, view: null, watched_ms: null, avg_form_score: null,
          rep_scores: null, fault_counts: {}, tempo_ms_avg: null, rom_stats: null, calibration: null,
        },
      ]);
      // The goblet squat was counted, not judged: the workout's form score is the squat's alone.
      expect(await formOf(body.workoutId)).toBe(90);
    });

    it("keeps the time the camera watched no longer than the set lasted", async () => {
      const a = await person();
      const body = workout([cameraSet({ durationMs: 30_000 }, { summary: summary({ watchedMs: 31_500 }) })]);
      expect((await save(a, body)).statusCode).toBe(201);
      expect((await setsOf(body.workoutId))[0]).toMatchObject({ watched_ms: 30_000 });
    });

    it("a hold the camera timed keeps its time held and the camera's own seconds", async () => {
      const a = await person();
      const body = workout([cameraSet({ exercise: "plank", measuredIn: "time", target: 30, done: 30, durationMs: 31_000 }, { done: 28, left: "camera_stopped", summary: summary({ repScores: [], faultCounts: {}, tempoMsAvg: null, romStats: null, view: "unknown" }) })]);
      expect((await save(a, body)).statusCode).toBe(201);
      expect((await setsOf(body.workoutId))[0]).toMatchObject({ counted: "camera", reps: 0, hold_ms: 30_000, camera_done: 28, left_camera: "camera_stopped", avg_form_score: null, rep_scores: [] });
      expect(await formOf(body.workoutId)).toBeNull();
    });

    it("sent twice it is one workout, its camera sets as first kept", async () => {
      const a = await person();
      const body = workout();
      expect((await save(a, body)).statusCode).toBe(201);
      const before = await setsOf(body.workoutId);
      const again = workout([cameraSet({}, { summary: summary({ repScores: [0] , faultCounts: {} }), done: 1 })], { workoutId: body.workoutId });
      expect((await save(a, again)).statusCode).toBe(200);
      expect(await setsOf(body.workoutId)).toEqual(before);
      expect(await formOf(body.workoutId)).toBe(90);
    });

    it("a camera workout's form earns the form bonus a web camera workout always has", async () => {
      const a = await person();
      const body = workout();
      expect((await save(a, body)).statusCode).toBe(201);
      const res = await get(a, `/v1/training/workouts/${body.workoutId}/summary`);
      expect(res.statusCode).toBe(200);
      // 90 is excellent form (80 to 99).
      expect(res.json<{ xp: { forWorkout: number } }>().xp.forWorkout).toBe(XP_REWARDS.workout_completed + XP_REWARDS.form_excellent_bonus);
    });
  });

  describe("History reads each set's form score", () => {
    it("the camera's for a set it judged, none for any other, and the workout's", async () => {
      const a = await person();
      const body = workout();
      expect((await save(a, body)).statusCode).toBe(201);
      const res = await get(a, `/v1/training/workouts/${body.workoutId}`);
      expect(res.statusCode).toBe(200);
      const w = historyWorkoutSchema.parse(res.json());
      expect(w.formScore).toBe(90);
      expect(w.sets.map((s) => [s.exercise, s.counted, s.done, s.formScore])).toEqual([
        ["squat", "camera", 10, 90],
        ["kettlebell_goblet_squat", "camera", 12, null],
        ["plank", "timer", 30, null],
      ]);
    });

    it("another member's camera workout is not found", async () => {
      const [a, b] = [await person(), await person()];
      const body = workout();
      expect((await save(a, body)).statusCode).toBe(201);
      expect((await get(b, `/v1/training/workouts/${body.workoutId}`)).statusCode).toBe(404);
      expect((await get(b, `/v1/training/workouts/${body.workoutId}/summary`)).statusCode).toBe(404);
    });
  });

  describe("the old readers meet a camera set", () => {
    it("the web's workout page reads it as the engine's, with its form score", async () => {
      const a = await person();
      const body = workout();
      expect((await save(a, body)).statusCode).toBe(201);
      const res = await get(a, `/v1/workouts/${body.workoutId}`);
      expect(res.statusCode).toBe(200);
      expect(res.json<{ sets: { exerciseSlug: string; mode: string; avgFormScore: number | null }[] }>().sets.map((s) => [s.exerciseSlug, s.mode, s.avgFormScore])).toEqual([
        ["squat", "engine", 90],
        ["kettlebell_goblet_squat", "engine", null],
        ["plank", "log_only", null],
      ]);
    });
  });

  describe("a body of many keys costs the server nothing (round one, H1)", () => {
    it("the reviewer's 131,594 keys in one record are refused before the body is read: 413, never a 500, nothing kept", async () => {
      const a = await person();
      const faultCounts = Object.fromEntries(Array.from({ length: 131_594 }, (_, i) => [`B${String(i)}`, 1]));
      const res = await save(a, workout([cameraSet({}, { summary: summary({ faultCounts }) })]));
      expect(res.statusCode).toBe(413);
      expect(res.json()).toMatchObject({ error: "too_many_items" });
      expect(await workoutsOf(a)).toBe(0);
    });

    it("unknown keys alike in their first 40 letters are named once each, cut and marked", async () => {
      const a = await person();
      const long = "x".repeat(45);
      const res = await save(a, workout([{ ...cameraSet(), [`${long}1`]: 1, [`${long}2`]: 1, short: 1 }]));
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toContain(`3 unknown keys, such as "${"x".repeat(40)}…", "short"`);
    });

    it("thousands of unknown keys within the count: 400, and the reply names a few of them, never all", async () => {
      const a = await person();
      const extra = Object.fromEntries(Array.from({ length: 5_000 }, (_, i) => [`unknown_field_${String(i)}`, 1]));
      const res = await save(a, workout([{ ...cameraSet(), ...extra }]));
      expect(res.statusCode).toBe(400);
      expect(res.body.length).toBeLessThan(2_000);
      expect(res.body).toContain("unknown_field_0");
      expect(res.body).not.toContain("unknown_field_4999");
      expect(res.body).toContain("5000 unknown keys");
      expect(await workoutsOf(a)).toBe(0);
    });
  });

  describe("History never sends a form score a phone would refuse (round one, L2)", () => {
    it("a stored score outside 0 to 100, as an imported workout might hold, reads as none and the workout still opens", async () => {
      const a = await person();
      const body = workout();
      expect((await save(a, body)).statusCode).toBe(201);
      await sql`UPDATE workouts SET avg_form_score = 150 WHERE id = ${body.workoutId}`;
      await sql`UPDATE workout_sets SET avg_form_score = -3 WHERE workout_id = ${body.workoutId} AND set_index = 0`;
      const res = await get(a, `/v1/training/workouts/${body.workoutId}`);
      expect(res.statusCode).toBe(200);
      const w = historyWorkoutSchema.parse(res.json());
      expect(w.formScore).toBeNull();
      expect(w.sets[0]?.formScore).toBeNull();
    });
  });

  describe("the person's own data", () => {
    it("the privacy download holds the camera's facts of their sets, and nobody else's", async () => {
      const [a, b] = [await person(), await person()];
      const body = workout();
      expect((await save(a, body)).statusCode).toBe(201);
      expect((await save(b, workout())).statusCode).toBe(201);
      const out = await buildUserExport({ sql }, a.id);
      const sets = out.data["workout_sets"] ?? [];
      expect(sets).toHaveLength(3);
      expect(sets.map((s) => [s["set_index"], s["camera_done"], s["left_camera"], s["avg_form_score"]]).sort()).toEqual([
        [0, 10, null, 90],
        [1, 10, "chosen", null],
        [2, null, null, null],
      ]);
      expect(JSON.stringify(out)).not.toContain(b.id);
    });

    it("deleting the account removes every camera set with the workout", async () => {
      const a = await person();
      const body = workout();
      expect((await save(a, body)).statusCode).toBe(201);
      await sql.begin((tx) => deleteUserOwnedRows(tx, a.id));
      expect((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM workout_sets WHERE workout_id = ${body.workoutId} OR user_id = ${a.id}`)[0]?.n).toBe(0);
    });
  });
});
