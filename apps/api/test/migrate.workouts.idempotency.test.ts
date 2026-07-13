// P2.7c — end-to-end workouts stage against real Postgres: prescription unroll
// persists, the whole stage is idempotent (Part 4 §7), and the gamification
// recompute (onWorkoutSynced) is the reused, idempotent §7:882-884 step.
// DATABASE_URL-gated; fixture prefix p27c-, cleaned before + after.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { seed } from "../src/db/seed.js";
import { insertUser, transformUser } from "../tools/migrate-mongo/collections/users.js";
import { insertWorkout, loadExerciseIds, transformWorkout } from "../tools/migrate-mongo/collections/workouts.js";
import { onWorkoutSynced } from "../src/modules/gamification/service.js";
import { uuidv5 } from "../tools/migrate-mongo/uuid5.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

d("migration workouts stage: unroll + idempotency + recompute (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 2 });
  const userMongoId = "p27c-user-aaaa1111bbbb2222";
  const userId = uuidv5(userMongoId);

  const clean = async (): Promise<void> => {
    await sql`DELETE FROM workouts WHERE user_id = ${userId}`; // cascades workout_sets
    await sql`DELETE FROM users WHERE legacy_mongo_id LIKE 'p27c-%'`; // cascades streaks + user_achievements
  };

  beforeAll(async () => {
    await seed(url ?? ""); // idempotent; provides the 3 exercise rows + achievements (FK targets)
    await clean();
    const u = transformUser({ _id: userMongoId, email: "p27c-w@example.com", fullName: "W User", password: "$2b$10$abcdefghijklmnopqrstuv" });
    expect(u).not.toBeNull();
    if (u !== null) await insertUser(sql, u);
  }, 120_000); // remote Neon seed is many round-trips — default 10s hook timeout is too short
  afterAll(async () => {
    await clean();
    await sql.end({ timeout: 5 });
  }, 30_000);

  it("unrolls resolvable sets, skips unseeded names, and is idempotent on re-run", async () => {
    const idBySlug = await loadExerciseIds(sql);
    expect(idBySlug.has("squat")).toBe(true); // seeded

    const doc = {
      _id: "p27c-workout-cccc3333dddd4444",
      user_id: userMongoId,
      started_at: "2026-05-01T13:21:11.402Z",
      completed_at: "2026-05-01T13:51:11.402Z",
      calories_burned: 120,
      duration_minutes: 30,
      form_accuracy: 90,
      exercises: [
        { id: "x", name: "Squats", sets: 2, reps: 10, rest: 60 },
        { id: "y", name: "1 Leg Box Squat", sets: 3, reps: 12, rest: 60 }, // not in the 58 → skipped
      ],
    };
    const row = transformWorkout(doc, idBySlug);
    expect(row).not.toBeNull();
    if (row === null) return;
    expect(row.setsCount).toBe(2);
    expect(row.skippedSets).toBe(3);
    expect(row.qualityFlags).toEqual(["unknown_exercise"]);

    // first insert writes the workout + 2 sets; re-run is a no-op
    expect(await insertWorkout(sql, row)).toEqual({ workoutInserted: 1, setsInserted: 2 });
    expect(await insertWorkout(sql, row)).toEqual({ workoutInserted: 0, setsInserted: 0 });

    const [wc] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM workouts WHERE id = ${row.id}`;
    const [sc] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM workout_sets WHERE workout_id = ${row.id}`;
    expect(wc?.n).toBe(1);
    expect(sc?.n).toBe(2);

    // persisted contract spot-check: fixed columns + global set_index 0,1
    const [w] = await sql<{ platform: string; engine_version: string; kcal_point: number; duration_ms: number; kcal_calc_version: number }[]>`
      SELECT platform, engine_version, kcal_point, duration_ms, kcal_calc_version FROM workouts WHERE id = ${row.id}`;
    expect(w?.platform).toBe("web");
    expect(w?.engine_version).toBe("legacy-py");
    expect(w?.kcal_point).toBe(120);
    expect(w?.duration_ms).toBe(30 * 60_000);
    expect(w?.kcal_calc_version).toBe(0);
    const sets = await sql<{ set_index: number; duration_ms: number; definition_version: number }[]>`
      SELECT set_index, duration_ms, definition_version FROM workout_sets WHERE workout_id = ${row.id} ORDER BY set_index`;
    expect(sets.map((s) => s.set_index)).toEqual([0, 1]);
    expect(sets.every((s) => s.duration_ms === 0)).toBe(true); // GAP2
    expect(sets.every((s) => s.definition_version === 0)).toBe(true);
  }, 60_000);

  it("recompute (onWorkoutSynced) builds the streak + awards, idempotently", async () => {
    await onWorkoutSynced({ sql }, userId, null);
    await onWorkoutSynced({ sql }, userId, null); // second run must not double-award

    const [streak] = await sql<{ current: number }[]>`SELECT current FROM streaks WHERE user_id = ${userId}`;
    expect(streak?.current).toBe(1); // one activity day

    const [ach] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM user_achievements WHERE user_id = ${userId} AND code = 'first_workout'`;
    expect(ach?.n).toBe(1); // earned exactly once
  }, 60_000);
});
