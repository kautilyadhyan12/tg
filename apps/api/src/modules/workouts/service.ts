// P1.10d — workouts service: orchestration between route and repo (v1 §6.2).
import type { Sql } from "postgres";
import type { SyncResponse, WorkoutSyncPayload } from "./schemas.js";
import { getExerciseIdsBySlug, syncWorkout } from "./repo.js";

export async function handleWorkoutSync(
  sql: Sql,
  userId: string,
  payload: WorkoutSyncPayload,
): Promise<SyncResponse & { skippedSets: number }> {
  const slugs = [...new Set(payload.sets.map((s) => s.exercise))];
  const exerciseIdBySlug = await getExerciseIdsBySlug(sql, slugs);
  const outcome = await syncWorkout(sql, userId, payload, exerciseIdBySlug);
  return {
    workoutId: payload.workoutId,
    status: outcome.status,
    skippedSets: outcome.skippedSets,
  };
}
