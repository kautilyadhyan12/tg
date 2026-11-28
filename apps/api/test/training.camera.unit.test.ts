// A set counted by the camera in a saved workout (spec Part 2 §13.3 and §13.5, job 64b-i): what a phone may send, how a
// set is written, and the form scores the server works out. No database.
//
// THE WORST THING THIS JOB COULD DO TO A REAL PERSON: keep a form score for a set no camera watched, or keep anything of
// their body on the server. So the first table is that: the camera's facts on a set by hand or by timer, and a picture,
// body points or a free-form field anywhere in a camera set, each refuse the whole save; and a set by hand is written with
// nothing of a camera whatever it carried.
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { setFormScore, workoutFormScore, workoutSaveSchema, WORKOUT_SAVE_LIMITS, type CameraSetFacts, type SavedSet } from "@app/shared";
import { countJsonListItems, countJsonObjectMembers } from "../src/listLimit.js";
import { setColumns, type SetRow } from "../src/modules/training/repo.js";
import { BODY_MOST_BYTES, LIST_ITEMS_FOR_SAVE, OBJECT_MEMBERS_FOR_SAVE } from "../src/modules/training/routes.js";
import { workoutFormScoreOf } from "../src/modules/training/service.js";

const L = WORKOUT_SAVE_LIMITS;

/** The squat's summary as the movement engine makes it (`SetRecord.summary`), less the set's own fields. */
const summary = (over: Record<string, unknown> = {}) => ({
  definitionVersion: 2,
  repScores: [100, 75, 100, 50, 100, 100, 75, 100, 100, 100],
  faultCounts: { knees_cave_in: 2, lean_forward: 1 },
  watchedMs: 38_000,
  tempoMsAvg: 2_100,
  romStats: { depth: 0.42, "knees bent": 96.5 },
  view: "front",
  ...over,
});

const camera = (over: Record<string, unknown> = {}): CameraSetFacts => ({ done: 10, left: null, engineVersion: "2.1.0", summary: summary(), ...over }) as CameraSetFacts;

const set = (over: Partial<SavedSet> = {}): SavedSet => ({
  exercise: "squat",
  position: 0,
  measuredIn: "reps",
  target: 10,
  done: 10,
  weightGrams: null,
  restSeconds: 60,
  durationMs: 40_000,
  counted: "camera",
  camera: camera(),
  ...over,
});
/** A set by hand, built with no camera key at all, as the phone's own sets are. */
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

const START = "2026-11-28T08:00:00.000Z";
const at = (ms: number) => new Date(Date.parse(START) + ms).toISOString();
const workout = (sets: unknown[], over: Record<string, unknown> = {}) => ({
  workoutId: randomUUID(),
  name: "Leg day",
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

/** Where the refusal points, or "ok". */
const verdict = (body: unknown): string => {
  const parsed = workoutSaveSchema.safeParse(body);
  return parsed.success ? "ok" : (parsed.error.issues[0]?.path.join(".") ?? "?");
};

const POINTS = Array.from({ length: 33 }, (_, i) => [0.01 * i, 0.02 * i, 0.9]);

describe("the worst thing: a form score for a set no camera watched, or anything of the body, refuses the whole save", () => {
  it.each<[string, unknown, string]>([
    ["a set by hand carrying the camera's facts", workout([{ ...handSet(), camera: camera() }]), "sets.0.camera"],
    ["a set by timer carrying the camera's facts", workout([{ ...handSet({ measuredIn: "time", target: 30, done: 30, counted: "timer" }), camera: camera({ done: 30, summary: null }) }]), "sets.0.camera"],
    ["a set by hand carrying the camera's facts with no summary", workout([{ ...handSet(), camera: camera({ summary: null }) }]), "sets.0.camera"],
    ["a set counted by the camera without them", workout([handSet({ counted: "camera" })]), "sets.0.camera"],
    ["the body's points beside the summary", workout([set({ camera: camera({ summary: { ...summary(), points: POINTS } }) })]), "sets.0.camera.summary"],
    ["the body's points beside the camera's facts", workout([set({ camera: { ...camera(), points: POINTS } as CameraSetFacts })]), "sets.0.camera"],
    ["the body's points on the set", workout([{ ...set(), points: POINTS }]), "sets.0"],
    ["a picture on the set", workout([{ ...set(), picture: "data:image/jpeg;base64,/9j/4AAQSkZJRg==" }]), "sets.0"],
    ["the old summary's free-form calibration", workout([set({ camera: camera({ summary: { ...summary(), calibration: { standing: POINTS } } }) })]), "sets.0.camera.summary"],
    ["a form score of the phone's own, which is the server's to work out", workout([set({ camera: camera({ summary: { ...summary(), avgFormScore: 100 } }) })]), "sets.0.camera.summary"],
    ["33 body points as count readings", workout([set({ camera: camera({ summary: summary({ romStats: Object.fromEntries(POINTS.map((_, i) => [`point ${String(i)}`, i])) }) }) })]), "sets.0.camera.summary.romStats"],
    ["a count reading named as a point is", workout([set({ camera: camera({ summary: summary({ romStats: { left_knee_x: 0.4 } }) }) })]), "sets.0.camera.summary.romStats.left_knee_x"],
    ["a count reading of words", workout([set({ camera: camera({ summary: summary({ romStats: { depth: "0.42,0.43,0.44" } }) }) })]), "sets.0.camera.summary.romStats.depth"],
    ["a mistake named with a capital", workout([set({ camera: camera({ summary: summary({ faultCounts: { Lean: 1 } }) }) })]), "sets.0.camera.summary.faultCounts.Lean"],
    ["a mistake's count of a list", workout([set({ camera: camera({ summary: summary({ faultCounts: { lean_forward: [0.1, 0.2] } }) }) })]), "sets.0.camera.summary.faultCounts.lean_forward"],
  ])("%s", (_name, body, expected) => {
    expect(verdict(body)).toBe(expected);
  });

  it("a set by hand is written with nothing of a camera, whatever it carried", () => {
    const row: SetRow = { ...handSet(), exerciseId: randomUUID(), camera: camera() };
    expect(setColumns(row)).toMatchObject({
      mode: "log_only",
      camera_done: null,
      left_camera: null,
      engine_version: null,
      definition_version: null,
      view: null,
      watched_ms: null,
      avg_form_score: null,
      rep_scores: null,
      fault_counts: {},
      tempo_ms_avg: null,
      rom_stats: null,
    });
  });

  it("a workout's form score is its camera sets' alone, even if a set by hand reached the server carrying camera facts", () => {
    // The schema refuses such a set (above); this is the service's own rule, tested past it.
    const handWithFacts = { ...handSet(), camera: camera({ summary: summary({ repScores: [100, 100] }) }) };
    const judged = set({ position: 1, camera: camera({ done: 2, summary: summary({ repScores: [60, 70], faultCounts: {} }) }) });
    expect(workoutFormScoreOf([handWithFacts, judged])).toBe(65);
    expect(workoutFormScoreOf([handWithFacts])).toBeNull();
    expect(workoutFormScoreOf([set({ camera: camera({ summary: null }) })])).toBeNull();
  });
});

describe("what a phone may send about a set the camera counted", () => {
  it.each<[string, unknown, string]>([
    ["a squat set with its summary", workout([set()]), "ok"],
    ["a set by hand, as before", workout([handSet()]), "ok"],
    ["a set by timer, as before", workout([handSet({ measuredIn: "time", target: 30, done: 30, counted: "timer" })]), "ok"],
    ["a set by hand with no camera key at all, as phones kept them before", workout([handSet()]), "ok"],
    ["an exercise the camera counts but does not judge yet: no summary", workout([set({ exercise: "kettlebell_goblet_squat", camera: camera({ summary: null }) })]), "ok"],
    ["the person took the count over", workout([set({ done: 12, camera: camera({ done: 8, left: "chosen", summary: summary({ repScores: [100, 100, 75, 100, 100, 100, 100, 100] }) }) })]), "ok"],
    ["the camera stopped", workout([set({ camera: camera({ done: 3, left: "camera_stopped", summary: summary({ repScores: [100, 100, 100] }) }) })]), "ok"],
    ["a way of leaving the camera the server does not know", workout([set({ camera: camera({ left: "gave_up" }) })]), "sets.0.camera.left"],
    ["the camera saw nothing", workout([set({ done: 10, camera: camera({ done: 0, left: "chosen", summary: summary({ repScores: [], faultCounts: {}, watchedMs: 0, tempoMsAvg: null, romStats: null, view: "unknown" }) }) })]), "ok"],
    ["a hold the camera timed", workout([set({ exercise: "plank", measuredIn: "time", target: 30, done: 30, durationMs: 31_000, camera: camera({ done: 30, summary: summary({ repScores: [], faultCounts: {}, tempoMsAvg: null, romStats: null, view: "unknown" }) }) })]), "ok"],
    ["a hold the camera timed a second longer than the set", workout([set({ exercise: "plank", measuredIn: "time", target: 30, done: 30, durationMs: 31_000, camera: camera({ done: 32, summary: null }) })]), "ok"],
    ["a hold the camera timed longer than the set lasted", workout([set({ exercise: "plank", measuredIn: "time", target: 30, done: 30, durationMs: 31_000, camera: camera({ done: 33, summary: null }) })]), "sets.0.camera.done"],
    ["a hold the camera timed an hour of in 31 seconds", workout([set({ exercise: "plank", measuredIn: "time", target: 30, done: 30, durationMs: 31_000, camera: camera({ done: 3600, summary: null }) })]), "sets.0.camera.done"],
    ["a hold with rep scores", workout([set({ exercise: "plank", measuredIn: "time", target: 30, done: 30, durationMs: 31_000, camera: camera({ done: 30, summary: summary({ repScores: [100] }) }) })]), "sets.0.camera.summary.repScores"],
    ["more rep scores than reps the camera counted", workout([set({ camera: camera({ done: 2, summary: summary({ repScores: [100, 100, 100] }) }) })]), "sets.0.camera.summary.repScores"],
    ["a rep score of 101", workout([set({ camera: camera({ summary: summary({ repScores: [101] }) }) })]), "sets.0.camera.summary.repScores.0"],
    ["a rep score of half a point", workout([set({ camera: camera({ summary: summary({ repScores: [99.5] }) }) })]), "sets.0.camera.summary.repScores.0"],
    ["the camera counting 1000 reps", workout([set({ target: 1000, done: 1000, camera: camera({ done: 1000, summary: null }) })]), "ok"],
    ["the camera counting 1001 reps", workout([set({ camera: camera({ done: 1001, summary: null }) })]), "sets.0.camera.done"],
    ["the camera counting below nothing", workout([set({ camera: camera({ done: -1 }) })]), "sets.0.camera.done"],
    ["32 mistakes", workout([set({ camera: camera({ summary: summary({ faultCounts: Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`mistake_${String(i)}`, 1])) }) }) })]), "ok"],
    ["33 mistakes", workout([set({ camera: camera({ summary: summary({ faultCounts: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`mistake_${String(i)}`, 1])) }) }) })]), "sets.0.camera.summary.faultCounts"],
    ["a mistake seen in no rep", workout([set({ camera: camera({ summary: summary({ faultCounts: { lean_forward: 0 } }) }) })]), "sets.0.camera.summary.faultCounts.lean_forward"],
    ["8 count readings", workout([set({ camera: camera({ summary: summary({ romStats: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`rule ${String(i)}`, i])) }) }) })]), "ok"],
    ["9 count readings", workout([set({ camera: camera({ summary: summary({ romStats: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`rule ${String(i)}`, i])) }) }) })]), "sets.0.camera.summary.romStats"],
    ["a reading of 1000 degrees", workout([set({ camera: camera({ summary: summary({ romStats: { depth: 1000 } }) }) })]), "ok"],
    ["a reading past 1000", workout([set({ camera: camera({ summary: summary({ romStats: { depth: 1000.5 } }) }) })]), "sets.0.camera.summary.romStats.depth"],
    ["a view the server does not know", workout([set({ camera: camera({ summary: summary({ view: "above" }) }) })]), "sets.0.camera.summary.view"],
    ["an engine version of words", workout([set({ camera: camera({ engineVersion: "latest" }) })]), "sets.0.camera.engineVersion"],
    ["no camera file version", workout([set({ camera: camera({ summary: summary({ definitionVersion: 0 }) }) })]), "sets.0.camera.summary.definitionVersion"],
    ["10,000 rep scores in one workout", workout(Array.from({ length: 200 }, (_, i) => set({ position: i, target: 50, done: 50, durationMs: 1000, restSeconds: null, camera: camera({ done: 50, summary: summary({ repScores: Array.from({ length: 50 }, () => 100), watchedMs: 1000 }) }) })), { endedAt: at(12 * 3_600_000), trainedMs: 12 * 3_600_000 }), "ok"],
    ["10,001 rep scores in one workout", workout(Array.from({ length: 200 }, (_, i) => set({ position: i, target: 51, done: 51, durationMs: 1000, restSeconds: null, camera: camera({ done: 51, summary: summary({ repScores: Array.from({ length: i === 0 ? 51 : 50 }, () => 100), watchedMs: 1000 }) }) })), { endedAt: at(12 * 3_600_000), trainedMs: 12 * 3_600_000 }), "sets"],
  ])("%s", (_name, body, expected) => {
    expect(verdict(body)).toBe(expected);
  });
});

describe("how a set the camera counted is written", () => {
  const row = (over: Partial<SavedSet> = {}): SetRow => ({ ...set(over), exerciseId: "00000000-0000-4000-8000-000000000001" });

  it("with its summary: the engine's, its form score the server's own, the time watched no longer than the set", () => {
    expect(setColumns(row({ durationMs: 30_000 }))).toEqual({
      exercise_id: "00000000-0000-4000-8000-000000000001",
      set_index: 0,
      reps: 10,
      hold_ms: null,
      duration_ms: 30_000,
      counted: "camera",
      measured_in: "reps",
      target: 10,
      weight_grams: null,
      rest_seconds: 60,
      mode: "engine",
      camera_done: 10,
      left_camera: null,
      engine_version: "2.1.0",
      definition_version: 2,
      view: "front",
      watched_ms: 30_000,
      // (100 + 75 + 100 + 50 + 100 + 100 + 75 + 100 + 100 + 100) / 10 = 90
      avg_form_score: 90,
      rep_scores: [100, 75, 100, 50, 100, 100, 75, 100, 100, 100],
      fault_counts: { knees_cave_in: 2, lean_forward: 1 },
      tempo_ms_avg: 2_100,
      rom_stats: { depth: 0.42, "knees bent": 96.5 },
    });
  });

  it("with no summary: the engine's, counted, never judged", () => {
    expect(setColumns(row({ exercise: "kettlebell_goblet_squat", done: 12, camera: camera({ done: 11, left: "chosen", summary: null }) }))).toMatchObject({
      reps: 12,
      mode: "engine",
      camera_done: 11,
      left_camera: "chosen",
      engine_version: "2.1.0",
      definition_version: null,
      view: null,
      watched_ms: null,
      avg_form_score: null,
      rep_scores: null,
      fault_counts: {},
      tempo_ms_avg: null,
      rom_stats: null,
    });
  });

  it("a hold: its time in hold_ms, the camera's own in whole seconds", () => {
    expect(
      setColumns(row({ exercise: "plank", measuredIn: "time", target: 30, done: 28, camera: camera({ done: 27, summary: summary({ repScores: [], faultCounts: {}, tempoMsAvg: null, romStats: null, view: "unknown" }) }) })),
    ).toMatchObject({ reps: 0, hold_ms: 28_000, camera_done: 27, avg_form_score: null, rep_scores: [] });
  });
});

describe("the form scores the server works out", () => {
  it.each<[string, number[], number | null]>([
    ["no rep judged: none, never a good one", [], null],
    ["one rep", [75], 75],
    ["the mean", [100, 50], 75],
    ["half a point rounds up", [85, 86], 86],
    ["below half rounds down", [80, 80, 81], 80],
  ])("a set: %s", (_name, scores, expected) => {
    expect(setFormScore(scores)).toBe(expected);
  });

  it.each<[string, (number | null)[], number | null]>([
    ["no camera set", [], null],
    ["camera sets not judged", [null, null], null],
    ["the mean of the judged sets, as the old route's", [null, 80, null, 91], 86],
    ["one set", [64], 64],
  ])("a workout: %s", (_name, scores, expected) => {
    expect(workoutFormScore(scores)).toBe(expected);
  });
});

describe("a body of many keys is refused at its count, before anything reads them (round one, H1)", () => {
  /** One camera set whose record holds `n` keys the id rule refuses. */
  const manyKeys = (field: "faultCounts" | "romStats", n: number) =>
    workout([set({ camera: camera({ summary: summary({ [field]: Object.fromEntries(Array.from({ length: n }, (_, i) => [`B${String(i)}`, 1])) }) }) })]);

  it.each(["faultCounts", "romStats"] as const)("%s of 100,000 keys: refused at its count, in a few milliseconds", (field) => {
    const body = manyKeys(field, 100_000);
    const t0 = performance.now();
    expect(verdict(body)).toBe(`sets.0.camera.summary.${field}`);
    expect(performance.now() - t0).toBeLessThan(100);
  });

  it("the route refuses the reviewer's body of 131,594 keys before parsing it, and takes the biggest save it should", () => {
    const attack = JSON.stringify(manyKeys("faultCounts", 131_594));
    expect(countJsonObjectMembers(attack, Number.MAX_SAFE_INTEGER)).toBeGreaterThan(OBJECT_MEMBERS_FOR_SAVE);
    // Unknown keys on a strict object are counted the same way.
    const strict = JSON.stringify(workout([{ ...set(), ...Object.fromEntries(Array.from({ length: 50_000 }, (_, i) => [`k${String(i)}`, 1])) }]));
    expect(countJsonObjectMembers(strict, Number.MAX_SAFE_INTEGER)).toBeGreaterThan(OBJECT_MEMBERS_FOR_SAVE);
  });
});

describe("the biggest save the schema takes fits the route's own limits", () => {
  it("200 camera sets, 10,000 rep scores, 12 hours of heart rate, every field at its longest", () => {
    const longest = (i: number) =>
      set({
        exercise: `a${"b".repeat(58)}${String(i % 10)}`,
        position: i,
        target: 50,
        done: 50,
        weightGrams: L.weightGramsMost,
        restSeconds: null,
        durationMs: 1000,
        camera: camera({
          done: 50,
          left: "camera_stopped",
          engineVersion: "9999.9999.9999",
          summary: summary({
            definitionVersion: 2_147_483_647,
            repScores: Array.from({ length: 50 }, () => 100),
            faultCounts: Object.fromEntries(Array.from({ length: L.faultsMost }, (_, k) => [`m${"x".repeat(35)}${String(k).padStart(4, "0")}`, L.repsMost])),
            watchedMs: 1000,
            tempoMsAvg: L.lengthMostMs,
            romStats: Object.fromEntries(Array.from({ length: L.romStatsMost }, (_, k) => [`R${"x".repeat(57)}${String(k).padStart(2, "0")}`, -999.123456789])),
          }),
        }),
      });
    const body = workout(
      Array.from({ length: L.setsMost }, (_, i) => longest(i)),
      {
        name: "x".repeat(L.nameMost),
        endedAt: at(L.lengthMostMs),
        trainedMs: L.lengthMostMs,
        timeZone: "America/Argentina/ComodRivadavia",
        appVersion: "9".repeat(40),
        heart: Array.from({ length: L.heartMost }, (_, i): [number, number] => [i * 1000, 240]),
      },
    );
    expect(verdict(body)).toBe("ok");
    const text = JSON.stringify(body);
    expect(Buffer.byteLength(text)).toBeLessThan(BODY_MOST_BYTES);
    expect(countJsonListItems(text, Number.MAX_SAFE_INTEGER)).toBeLessThanOrEqual(LIST_ITEMS_FOR_SAVE);
    expect(countJsonObjectMembers(text, Number.MAX_SAFE_INTEGER)).toBeLessThanOrEqual(OBJECT_MEMBERS_FOR_SAVE);
  });
});
