// P2.7c — pure transform tests for the workouts stage (no DB/Mongo).
import { describe, expect, it } from "vitest";
import { transformWorkout } from "../tools/migrate-mongo/collections/workouts.js";
import { uuidv5 } from "../tools/migrate-mongo/uuid5.js";

// squat + jump_squat are "seeded"; bench_press is NOT (a P4 name → skipped).
const SQUAT = "11111111-1111-1111-1111-111111111111";
const JUMP = "22222222-2222-2222-2222-222222222222";
const idBySlug = new Map<string, string>([
  ["squat", SQUAT],
  ["jump_squat", JUMP],
]);

const sid = "69f4a8c7db4a4a90775cfb86";
const uid = "69f3a923978e79f3d884bbcb";

function session(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: sid,
    user_id: uid,
    started_at: "2026-05-01T13:21:11.402Z",
    completed_at: null,
    calories_burned: 0,
    duration_minutes: 0,
    form_accuracy: 0,
    exercises: [],
    ...over,
  };
}

describe("transformWorkout — unroll", () => {
  it("expands each resolvable item's `sets` into global-indexed rows; skips unseeded names", () => {
    const row = transformWorkout(
      session({
        exercises: [
          { id: "a", name: "Squats", sets: 3, reps: 10, rest: 60 },
          { id: "b", name: "Jump Squats", sets: 2, reps: 8, rest: 60 },
          { id: "c", name: "Bench Press", sets: 4, reps: 5, rest: 60 }, // not seeded → skip
        ],
      }),
      idBySlug,
    );
    expect(row).not.toBeNull();
    if (row === null) return;

    expect(row.id).toBe(uuidv5(sid));
    expect(row.userId).toBe(uuidv5(uid));
    expect(row.setsCount).toBe(5);
    expect(row.totalReps).toBe(3 * 10 + 2 * 8);
    expect(row.skippedSets).toBe(4); // the 4 Bench Press sets
    expect(row.qualityFlags).toEqual(["unknown_exercise"]);

    // global set_index 0..4; first 3 = squat, next 2 = jump; deterministic ids
    expect(row.sets.map((s) => s.setIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(row.sets.map((s) => s.exerciseId)).toEqual([SQUAT, SQUAT, SQUAT, JUMP, JUMP]);
    expect(row.sets.map((s) => s.reps)).toEqual([10, 10, 10, 8, 8]);
    expect(row.sets[0]?.id).toBe(uuidv5(`${sid}:0`));
    expect(row.sets[4]?.id).toBe(uuidv5(`${sid}:4`));
  });

  it("all-unresolvable session → 0 sets but the workout still migrates, flagged", () => {
    const row = transformWorkout(
      session({
        exercises: [
          { name: "1 Leg Box Squat", sets: 3, reps: 12 },
          { name: "1-Arm Half-Kneeling Lat Pulldown", sets: 3, reps: 12 },
        ],
      }),
      idBySlug,
    );
    expect(row).not.toBeNull();
    expect(row?.sets).toEqual([]);
    expect(row?.setsCount).toBe(0);
    expect(row?.skippedSets).toBe(6);
    expect(row?.qualityFlags).toEqual(["unknown_exercise"]);
  });

  it("fully-resolvable session → no quality flag", () => {
    const row = transformWorkout(
      session({ exercises: [{ name: "Squats", sets: 2, reps: 10 }] }),
      idBySlug,
    );
    expect(row?.qualityFlags).toEqual([]);
    expect(row?.skippedSets).toBe(0);
    expect(row?.setsCount).toBe(2);
  });
});

describe("transformWorkout — field mapping & guards", () => {
  it("maps kcal (round), duration ×60000, form (round); keep-stored calc_version 0", () => {
    const row = transformWorkout(
      session({ calories_burned: 250.4, duration_minutes: 30, form_accuracy: 87.6, completed_at: "2026-05-01T14:00:00Z" }),
      idBySlug,
    );
    expect(row?.kcalPoint).toBe(250);
    expect(row?.kcalCalcVersion).toBe(0);
    expect(row?.durationMs).toBe(30 * 60_000);
    expect(row?.avgFormScore).toBe(88);
    expect(row?.endedAt).toBeInstanceOf(Date);
  });

  it("absent numeric fields → null (never fabricated)", () => {
    const row = transformWorkout(
      { _id: sid, user_id: uid, started_at: "2026-05-01T13:21:11Z" },
      idBySlug,
    );
    expect(row?.kcalPoint).toBeNull();
    expect(row?.durationMs).toBeNull();
    expect(row?.avgFormScore).toBeNull();
    expect(row?.endedAt).toBeNull();
    expect(row?.sets).toEqual([]);
  });

  it("missing/invalid started_at → null (NOT NULL column); zero/negative/float sets guarded", () => {
    expect(transformWorkout(session({ started_at: null }), idBySlug)).toBeNull();
    expect(transformWorkout(session({ started_at: "not-a-date" }), idBySlug)).toBeNull();
    const row = transformWorkout(
      session({ exercises: [{ name: "Squats", sets: 0, reps: 10 }, { name: "Squats", sets: 2.9, reps: -3 }] }),
      idBySlug,
    );
    expect(row?.setsCount).toBe(2); // 0 → none; 2.9 → 2 rows
    expect(row?.sets.map((s) => s.reps)).toEqual([0, 0]); // -3 → 0
  });

  it("is deterministic: same doc → identical ids on every run", () => {
    const a = transformWorkout(session({ exercises: [{ name: "Squats", sets: 1, reps: 5 }] }), idBySlug);
    const b = transformWorkout(session({ exercises: [{ name: "Squats", sets: 1, reps: 5 }] }), idBySlug);
    expect(a?.id).toBe(b?.id);
    expect(a?.sets[0]?.id).toBe(b?.sets[0]?.id);
  });
});
