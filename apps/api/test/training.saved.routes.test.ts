// A person's saved workouts (spec Part 2 §13.5, job 61c), against REAL Postgres. DATABASE_URL-gated. The
// first block is the job's worst thing: one member reading, changing or deleting another member's saved
// workout. Then a save and its read-back, a save sent twice, a change, a late change, a delete, an
// exercise the Library does not know, the limit of 50 (two at the same instant included), the broken
// requests, and the write limit.
//
// Each person may write thirty a minute, so every test makes the people it needs.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  PLANNED_WORKOUT_LIMITS,
  savedWorkoutListSchema,
  savedWorkoutSchema,
  savedWorkoutWrittenSchema,
  savedWorkoutsFullSchema,
  workoutSaveRefusalSchema,
  type PlannedExercise,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { seed } from "../src/db/seed.js";
import type { EmailSender } from "../src/modules/auth/email.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const NOW = new Date("2026-11-19T12:00:00.000Z");

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
const nextIp = () => `10.62.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const edited = (minutesBeforeNow: number) => new Date(NOW.getTime() - minutesBeforeNow * 60_000).toISOString();

/** Squat 3 × 12 with rest, a Library-only curl with a weight, a plank of 30 seconds, and squat again. */
const exercises = (): PlannedExercise[] => [
  { exercise: "squat", measuredIn: "reps", sets: [{ target: 12, weightGrams: null, restSeconds: 60 }, { target: 12, weightGrams: null, restSeconds: 60 }, { target: 10, weightGrams: null, restSeconds: 90 }] },
  { exercise: "barbell_curl", measuredIn: "reps", sets: [{ target: 10, weightGrams: 20_000, restSeconds: 90 }, { target: 8, weightGrams: 22_500, restSeconds: null }] },
  { exercise: "plank", measuredIn: "time", sets: [{ target: 30, weightGrams: null, restSeconds: 30 }] },
  { exercise: "squat", measuredIn: "reps", sets: [{ target: 20, weightGrams: null, restSeconds: null }] },
];
const body = (over: Record<string, unknown> = {}) => ({ name: "Leg day", editedAt: edited(10), exercises: exercises(), ...over });

d("saved workouts (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  let people = 0;
  const person = async (): Promise<Person> => {
    const email = `saved-${String(people++)}-${randomUUID().slice(0, 8)}@example.com`;
    const inject = (path: string, b: unknown) =>
      api().inject({ method: "POST", url: path, remoteAddress: nextIp(), headers: { "content-type": "application/json" }, payload: JSON.stringify(b) });
    expect((await inject("/v1/auth/register", { email, password: PASSWORD, displayName: "Saved Fixture" })).statusCode).toBe(201);
    const login = await inject("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    const id = (await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`)[0]?.id;
    if (id === undefined) throw new Error(`no fixture ${email}`);
    return { cookies: cookieMap(login), id };
  };

  const call = (method: "GET" | "PUT" | "DELETE", who: Person | null, path: string, payload?: unknown, address: string = nextIp()) =>
    api().inject({
      method,
      url: path,
      remoteAddress: address,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
      ...(who === null ? {} : { cookies: who.cookies }),
    });
  const put = (who: Person | null, id: string, b: unknown = body(), address?: string) => call("PUT", who, `/v1/training/saved/${id}`, b, address);
  const read = (who: Person | null, id: string) => call("GET", who, `/v1/training/saved/${id}`);
  const list = (who: Person | null) => call("GET", who, "/v1/training/saved");
  const remove = (who: Person | null, id: string, address?: string) => call("DELETE", who, `/v1/training/saved/${id}`, undefined, address);

  /** Everything kept about one saved workout and its sets, to compare before and after. */
  const kept = async (id: string) => ({
    row: await sql<Record<string, unknown>[]>`SELECT user_id, name, edited_at FROM saved_workouts WHERE id = ${id}`,
    sets: await sql<Record<string, unknown>[]>`
      SELECT s.exercise_place, s.set_place, e.slug, s.measured_in, s.target, s.weight_grams, s.rest_seconds
      FROM saved_workout_sets s JOIN exercises e ON e.id = s.exercise_id
      WHERE s.saved_workout_id = ${id} ORDER BY s.exercise_place, s.set_place`,
  });
  const countOf = async (who: Person) =>
    (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM saved_workouts WHERE user_id = ${who.id}`)[0]?.n ?? -1;
  /** Fills the person's saved workouts up to `n` straight in the table, each with one set. */
  const fill = async (who: Person, n: number) => {
    const squat = (await sql<{ id: string }[]>`SELECT id FROM exercises WHERE slug = 'squat'`)[0]?.id ?? "";
    await sql`
      WITH made AS (
        INSERT INTO saved_workouts (id, user_id, name, edited_at)
        SELECT gen_random_uuid(), ${who.id}, 'Filled ' || g, now() - make_interval(mins => g) FROM generate_series(1, ${n}) g
        RETURNING id)
      INSERT INTO saved_workout_sets (saved_workout_id, exercise_place, set_place, exercise_id, measured_in, target)
      SELECT id, 0, 0, ${squat}, 'reps', 10 FROM made`;
  };

  const mine = sql`SELECT id FROM users WHERE email LIKE 'saved-%@example.com'`;
  const clear = async () => {
    await sql`DELETE FROM saved_workouts WHERE user_id IN (${mine})`;
    await sql`DELETE FROM saved_workout_removed_ids WHERE user_id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'saved-%@example.com'`;
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

  describe("the worst thing: one member never reads, changes or deletes another member's saved workout", () => {
    it("somebody else's saved workout is not found to a read, a change or a delete, and is kept as it was", async () => {
      const [a, b] = [await person(), await person()];
      const id = randomUUID();
      expect((await put(a, id)).statusCode).toBe(201);
      const before = await kept(id);
      expect(before.row[0]?.["user_id"]).toBe(a.id);
      expect(before.sets).toHaveLength(7);

      expect((await read(b, id)).statusCode).toBe(404);
      const listed = savedWorkoutListSchema.parse((await list(b)).json());
      expect(listed.savedWorkouts).toEqual([]);

      // A change, even a newer one, and a delete.
      const change = await put(b, id, body({ name: "Not yours", editedAt: edited(1), exercises: [{ exercise: "plank", measuredIn: "time", sets: [{ target: 600, weightGrams: null, restSeconds: null }] }] }));
      expect(change.statusCode).toBe(404);
      expect(change.json()).toMatchObject({ error: "not_found" });
      expect((await remove(b, id)).statusCode).toBe(404);

      expect(await kept(id)).toEqual(before);
      expect(await countOf(b)).toBe(0);
      expect((await sql`SELECT 1 FROM saved_workout_removed_ids WHERE id = ${id}`).length).toBe(0);
      expect((await read(a, id)).statusCode).toBe(200);
    });

    it("an id somebody else deleted stays theirs: a save or a delete of it by another member is not found", async () => {
      const [a, b] = [await person(), await person()];
      const id = randomUUID();
      expect((await put(a, id)).statusCode).toBe(201);
      expect((await remove(a, id)).statusCode).toBe(204);

      expect((await put(b, id, body({ editedAt: edited(1) }))).statusCode).toBe(404);
      expect((await remove(b, id)).statusCode).toBe(404);
      expect(await countOf(b)).toBe(0);
      expect((await sql<{ user_id: string }[]>`SELECT user_id FROM saved_workout_removed_ids WHERE id = ${id}`).map((r) => r.user_id)).toEqual([a.id]);
    });

    it("two members saving one new id at the same instant: one owns it, the other is not found, and every set is the owner's", async () => {
      for (let round = 0; round < 5; round++) {
        const [a, b] = [await person(), await person()];
        const id = randomUUID();
        const fromB = body({ name: "B's", exercises: [{ exercise: "plank", measuredIn: "time", sets: [{ target: 45, weightGrams: null, restSeconds: null }] }] });
        const [ra, rb] = await Promise.all([put(a, id, body({ name: "A's" })), put(b, id, fromB)]);
        expect([ra.statusCode, rb.statusCode].sort()).toEqual([201, 404]);
        const winner = ra.statusCode === 201 ? a : b;
        const after = await kept(id);
        expect(after.row[0]?.["user_id"]).toBe(winner.id);
        expect(after.row[0]?.["name"]).toBe(winner === a ? "A's" : "B's");
        expect(after.sets.map((s) => s["slug"])).toEqual(winner === a ? ["squat", "squat", "squat", "barbell_curl", "barbell_curl", "plank", "squat"] : ["plank"]);
      }
    });
  });

  describe("saving, reading back and listing", () => {
    it("a new saved workout is 201 and reads back exactly as sent, in its order, repeats included", async () => {
      const a = await person();
      const id = randomUUID();
      const sent = body();
      const res = await put(a, id, sent);
      expect(res.statusCode).toBe(201);
      expect(savedWorkoutWrittenSchema.parse(res.json())).toEqual({ id, status: "created" });

      const back = await read(a, id);
      expect(back.statusCode).toBe(200);
      expect(savedWorkoutSchema.parse(back.json())).toEqual({ id, name: "Leg day", editedAt: sent.editedAt, exercises: sent.exercises });
    });

    it("the list holds each one's exercises in order, each once, and its sets, the most recently changed first", async () => {
      const a = await person();
      const [older, newer] = [randomUUID(), randomUUID()];
      expect((await put(a, older, body({ name: "Older", editedAt: edited(30) }))).statusCode).toBe(201);
      expect((await put(a, newer, body({ name: "Newer", editedAt: edited(5), exercises: [exercises()[2]] }))).statusCode).toBe(201);
      const res = await list(a);
      expect(res.statusCode).toBe(200);
      expect(savedWorkoutListSchema.parse(res.json())).toEqual({
        savedWorkouts: [
          { id: newer, name: "Newer", editedAt: edited(5), exercises: ["plank"], setsCount: 1 },
          { id: older, name: "Older", editedAt: edited(30), exercises: ["squat", "barbell_curl", "plank"], setsCount: 7 },
        ],
        most: PLANNED_WORKOUT_LIMITS.savedMost,
      });
    });

    it("sent twice it is one saved workout: the second is answered unchanged", async () => {
      const a = await person();
      const id = randomUUID();
      const sent = body();
      expect((await put(a, id, sent)).statusCode).toBe(201);
      const again = await put(a, id, sent);
      expect(again.statusCode).toBe(200);
      expect(again.json()).toEqual({ id, status: "unchanged" });
      expect(await countOf(a)).toBe(1);
      expect((await kept(id)).sets).toHaveLength(7);
    });

    it("a newer change replaces the name and every set; an older one that arrives late keeps nothing", async () => {
      const a = await person();
      const id = randomUUID();
      expect((await put(a, id, body({ editedAt: edited(30) }))).statusCode).toBe(201);
      const changed = body({ name: "Arms", editedAt: edited(10), exercises: [exercises()[1]] });
      const res = await put(a, id, changed);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ id, status: "updated" });
      expect(savedWorkoutSchema.parse((await read(a, id)).json())).toEqual({ id, name: "Arms", editedAt: changed.editedAt, exercises: changed.exercises });

      // The phone's earlier send, held up on the way.
      const late = await put(a, id, body({ name: "Leg day", editedAt: edited(20) }));
      expect(late.json()).toEqual({ id, status: "unchanged" });
      expect((await kept(id)).row[0]?.["name"]).toBe("Arms");
      expect((await kept(id)).sets.map((s) => s["slug"])).toEqual(["barbell_curl", "barbell_curl"]);
    });
  });

  describe("deleting", () => {
    it("a delete is 204, sent twice still 204, and a save of it arriving later keeps nothing", async () => {
      const a = await person();
      const id = randomUUID();
      expect((await put(a, id)).statusCode).toBe(201);
      expect((await remove(a, id)).statusCode).toBe(204);
      expect((await remove(a, id)).statusCode).toBe(204);
      expect((await read(a, id)).statusCode).toBe(404);
      expect(savedWorkoutListSchema.parse((await list(a)).json()).savedWorkouts).toEqual([]);
      expect((await kept(id)).sets).toEqual([]);

      const late = await put(a, id, body({ editedAt: edited(1) }));
      expect(late.statusCode).toBe(200);
      expect(late.json()).toEqual({ id, status: "removed" });
      expect(await countOf(a)).toBe(0);
    });

    it("a delete that arrives before its save: the save that follows keeps nothing", async () => {
      const a = await person();
      const id = randomUUID();
      expect((await remove(a, id)).statusCode).toBe(204);
      expect((await put(a, id)).json()).toEqual({ id, status: "removed" });
      expect(await countOf(a)).toBe(0);
    });
  });

  describe("an exercise the Library does not know", () => {
    it("refuses the whole save with the id words, and keeps nothing", async () => {
      const a = await person();
      const id = randomUUID();
      const res = await put(a, id, body({ exercises: [...exercises(), { exercise: "zz_never_had", measuredIn: "reps", sets: [{ target: 5, weightGrams: null, restSeconds: null }] }] }));
      expect(res.statusCode).toBe(422);
      expect(workoutSaveRefusalSchema.parse(res.json()).exercises).toEqual(["zz_never_had"]);
      expect(await kept(id)).toEqual({ row: [], sets: [] });
    });

    it("a change naming one refuses the change and keeps the saved workout as it was", async () => {
      const a = await person();
      const id = randomUUID();
      expect((await put(a, id, body({ editedAt: edited(30) }))).statusCode).toBe(201);
      const before = await kept(id);
      const res = await put(a, id, body({ name: "Broken", editedAt: edited(5), exercises: [{ exercise: "zz_never_had", measuredIn: "reps", sets: [{ target: 5, weightGrams: null, restSeconds: null }] }] }));
      expect(res.statusCode).toBe(422);
      expect(await kept(id)).toEqual(before);
    });
  });

  describe("the limit of 50 for each person", () => {
    it("the 50th is saved, the 51st is refused with the limit; a change at 50 is saved; after a delete a new one is saved", async () => {
      const a = await person();
      await fill(a, PLANNED_WORKOUT_LIMITS.savedMost - 1);
      const fiftieth = randomUUID();
      expect((await put(a, fiftieth)).statusCode).toBe(201);

      const over = randomUUID();
      const refused = await put(a, over);
      expect(refused.statusCode).toBe(409);
      expect(savedWorkoutsFullSchema.parse(refused.json())).toMatchObject({ error: "saved_workouts_full", most: 50 });
      expect(await kept(over)).toEqual({ row: [], sets: [] });

      expect((await put(a, fiftieth, body({ name: "Changed", editedAt: edited(1) }))).json()).toEqual({ id: fiftieth, status: "updated" });
      expect((await remove(a, fiftieth)).statusCode).toBe(204);
      expect((await put(a, over)).statusCode).toBe(201);
      expect(await countOf(a)).toBe(50);
      expect(savedWorkoutListSchema.parse((await list(a)).json()).savedWorkouts).toHaveLength(50);
    });

    it("another person's saved workouts never count towards it", async () => {
      const [a, b] = [await person(), await person()];
      await fill(a, PLANNED_WORKOUT_LIMITS.savedMost);
      expect((await put(b, randomUUID())).statusCode).toBe(201);
    });

    it("two new ones at the same instant with one place left: one is saved, the other refused, and 50 are kept", async () => {
      for (let round = 0; round < 5; round++) {
        const a = await person();
        await fill(a, PLANNED_WORKOUT_LIMITS.savedMost - 1);
        const [r1, r2] = await Promise.all([put(a, randomUUID()), put(a, randomUUID())]);
        expect([r1.statusCode, r2.statusCode].sort()).toEqual([201, 409]);
        expect(await countOf(a)).toBe(50);
      }
    });
  });

  describe("broken requests and who may ask", () => {
    it("a body the shape refuses is 400, naming its fields, and keeps nothing", async () => {
      const a = await person();
      const oneSet = { target: 10, weightGrams: null, restSeconds: null };
      const broken: Record<string, unknown>[] = [
        { exercises: exercises() }, // no name
        body({ name: "   " }),
        body({ name: "x".repeat(61) }),
        body({ name: "Leg\u0000day" }),
        body({ exercises: [] }),
        body({ exercises: Array.from({ length: 51 }, () => ({ exercise: "squat", measuredIn: "reps", sets: [oneSet] })) }),
        body({ exercises: [{ exercise: "squat", measuredIn: "reps", sets: Array.from({ length: 101 }, () => oneSet) }, { exercise: "plank", measuredIn: "time", sets: Array.from({ length: 100 }, () => oneSet) }] }),
        body({ exercises: [{ exercise: "squat", measuredIn: "reps", sets: [{ target: 1001, weightGrams: null, restSeconds: null }] }] }),
        body({ exercises: [{ exercise: "squat", measuredIn: "reps", sets: [{ target: 10, weightGrams: 1_000_001, restSeconds: null }] }] }),
        body({ exercises: [{ exercise: "squat", measuredIn: "reps", sets: [{ target: 10, weightGrams: null, restSeconds: 3601 }] }] }),
        body({ exercises: [{ exercise: "squat", measuredIn: "reps", sets: [] }] }),
        body({ exercises: [{ exercise: "Squat!", measuredIn: "reps", sets: [oneSet] }] }),
        body({ editedAt: "yesterday" }),
        body({ owner: "someone" }),
      ];
      for (const b of broken) {
        const id = randomUUID();
        const res = await put(a, id, b);
        expect({ b, status: res.statusCode }).toEqual({ b, status: 400 });
        expect(res.json()).toMatchObject({ error: "validation_error" });
        expect(await kept(id)).toEqual({ row: [], sets: [] });
      }
    });

    it("a time done of 4 hours is a set; 1,000 reps is a set: the edges are kept", async () => {
      const a = await person();
      const id = randomUUID();
      const edges = body({ exercises: [{ exercise: "plank", measuredIn: "time", sets: [{ target: 14_400, weightGrams: null, restSeconds: 3600 }] }, { exercise: "squat", measuredIn: "reps", sets: [{ target: 1000, weightGrams: 1_000_000, restSeconds: 0 }] }] });
      expect((await put(a, id, edges)).statusCode).toBe(201);
    });

    it("a change made later than the server's clock is refused: kept, it would outrank every later change", async () => {
      const a = await person();
      const id = randomUUID();
      expect((await put(a, id, body({ editedAt: new Date(NOW.getTime() + 5 * 60_000 + 1000).toISOString() }))).statusCode).toBe(400);
      expect((await put(a, id, body({ editedAt: new Date(NOW.getTime() + 4 * 60_000).toISOString() }))).statusCode).toBe(201);
    });

    it("an id that is not a UUID is 400 to a save and 404 to a read or a delete", async () => {
      const a = await person();
      expect((await put(a, "not-an-id")).statusCode).toBe(400);
      expect((await read(a, "not-an-id")).statusCode).toBe(404);
      expect((await remove(a, "not-an-id")).statusCode).toBe(404);
      expect((await read(a, randomUUID())).statusCode).toBe(404);
    });

    it("nobody signed in gets 401 from every route", async () => {
      const id = randomUUID();
      for (const res of [await list(null), await read(null, id), await put(null, id), await remove(null, id)]) expect(res.statusCode).toBe(401);
      expect((await sql`SELECT 1 FROM saved_workout_removed_ids WHERE id = ${id}`).length).toBe(0);
    });

    it("thirty saves or deletes a minute for a person, never counted by address", async () => {
      const [a, b] = [await person(), await person()];
      const address = "10.62.250.1";
      for (let i = 0; i < 30; i++) expect((await remove(a, randomUUID(), address)).statusCode).toBe(204);
      expect((await remove(a, randomUUID(), address)).statusCode).toBe(429);
      expect((await put(a, randomUUID(), body(), address)).statusCode).toBe(429);
      // Somebody else at the same address is not held back, and the person may still read.
      expect((await put(b, randomUUID(), body(), address)).statusCode).toBe(201);
      expect((await list(a)).statusCode).toBe(200);
    });
  });
});
