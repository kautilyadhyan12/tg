import { describe, expect, it } from "vitest";
import { heartSums, workoutRunSchema, workoutSaveSchema, type RunExercise, type WorkoutRun } from "@app/shared";
import { AWAY_MOST_MS, HEART_EVERY_MS, press, startRun, toSave, withHeart, type HeartIn, type Press } from "../src/library/workoutRun";
import { createRunStore, type Finished } from "../src/library/workoutRunStore";
import { workoutWaiting } from "../src/library/workoutSaving";

// A workout's heart rate (64a-vi): the person's own monitor's readings kept with the workout while its clocks run, and
// sent with it. The worst thing first: a heart rate kept as this workout's that was not the person's during it.

const T0 = Date.parse("2026-11-23T10:00:00.000Z");
const ID = "22222222-2222-4222-8222-222222222222";
const reps = (n: number, rest: number | null = 60): RunExercise["sets"][number] => ({ target: n, weightGrams: null, restSeconds: rest });
const curl: RunExercise = { exercise: "barbell_curl", name: "Barbell Curl", kind: "strength", measuredIn: "reps", barbell: true, sets: [reps(10), reps(10), reps(10)] };

function begin(): WorkoutRun {
  const run = startRun({ workoutId: ID, name: "Arms", now: T0, timeZone: "Asia/Kolkata", exercises: [curl] });
  if (run === null) throw new Error("no run");
  return run;
}
/** Readings every second from `from` to `to` seconds after Start, at `bpm`. */
const every = (from: number, to: number, bpm = 140): HeartIn[] => Array.from({ length: to - from }, (_, i) => ({ at: T0 + (from + i + 1) * 1000, bpm }));
/** The workout fed readings and pressed, as the store does: readings first, then the press, at `at` seconds. */
function step(run: WorkoutRun, at: number, p: Press, readings: HeartIn[] = []): WorkoutRun {
  const now = T0 + at * 1000;
  const out = press(withHeart(run, readings, now, p.kind === "back"), p, now);
  if (out.kind === "gone") throw new Error("gone");
  expect(workoutRunSchema.safeParse(out.run).success).toBe(true);
  return out.run;
}
const kept = (r: WorkoutRun) => r.heart ?? [];

describe("the worst thing: only the person's heart rate during the workout is kept", () => {
  it("nothing from before Start: a reading older than the workout is left out", () => {
    const run = step(begin(), 2, { kind: "tick" }, [{ at: T0 - 5000, bpm: 99 }, { at: T0 + 1500, bpm: 120 }]);
    expect(kept(run)).toEqual([[1500, 120]]);
  });

  it("nothing while paused, and nothing that came during the pause after Resume", () => {
    let run = step(begin(), 10, { kind: "pause" }, every(0, 10));
    expect(kept(run)).toHaveLength(10);
    run = step(run, 70, { kind: "tick" }, every(10, 70, 90));
    run = step(run, 130, { kind: "resume" }, every(70, 130, 91));
    // A reading from during the pause, handed over late, is still not kept.
    run = step(run, 131, { kind: "tick" }, [{ at: T0 + 129_000, bpm: 92 }, { at: T0 + 131_000, bpm: 150 }]);
    expect(kept(run).filter(([, bpm]) => bpm < 100)).toEqual([]);
    expect(kept(run)[kept(run).length - 1]).toEqual([131_000, 150]);
  });

  it("nothing from the time away when the workout comes back paused", () => {
    let run = step(begin(), 5, { kind: "tick" }, every(0, 5));
    const away = 5 + AWAY_MOST_MS / 1000 + 60;
    run = step(run, away, { kind: "back" }, every(5, away, 70));
    expect(run.paused).toBe(true);
    expect(kept(run)).toHaveLength(5);
  });

  it("the time away under 10 minutes is trained, and its readings are kept", () => {
    let run = step(begin(), 5, { kind: "tick" }, every(0, 5));
    run = step(run, 125, { kind: "back" }, every(5, 125, 130));
    expect(run.paused).toBe(false);
    expect(kept(run)).toHaveLength(125);
  });

  it("nothing once the workout is done", () => {
    let run = begin();
    for (let s = 0; s < 3; s++) run = step(run, 100 * s + 10, { kind: "main" });
    expect(run.phase).toBe("done");
    expect(withHeart(run, every(310, 320), T0 + 320_000, false)).toBe(run);
  });

  it("a heart rate no heart beats at, or a broken one, is never kept", () => {
    const run = step(begin(), 3, { kind: "tick" }, [{ at: T0 + 1000, bpm: 0 }, { at: T0 + 2000, bpm: 250 }, { at: T0 + 2500, bpm: 120.5 }, { at: Number.NaN, bpm: 120 }]);
    expect(kept(run)).toEqual([]);
  });
});

describe("where each reading is kept", () => {
  it("on the workout's whole clock, by when it came, one a second at most", () => {
    const run = step(begin(), 3, { kind: "tick" }, [
      { at: T0 + 1000, bpm: 120 },
      { at: T0 + 1400, bpm: 121 },
      { at: T0 + 2000, bpm: 122 },
    ]);
    expect(kept(run)).toEqual([
      [1000, 120],
      [2000, 122],
    ]);
    expect(HEART_EVERY_MS).toBe(900);
  });

  it("after a pause, on the whole clock, so the save's readings fall inside the workout", () => {
    let run = step(begin(), 10, { kind: "pause" }, every(0, 10));
    run = step(run, 70, { kind: "resume" });
    run = step(run, 72, { kind: "tick" }, every(70, 72));
    expect(kept(run).slice(-2)).toEqual([
      [71_000, 140],
      [72_000, 140],
    ]);
  });

  it("a reading from a phone clock ahead is placed at now, never past it", () => {
    const run = step(begin(), 3, { kind: "tick" }, [{ at: T0 + 60_000, bpm: 130 }]);
    expect(kept(run)).toEqual([[3000, 130]]);
  });
});

describe("the save takes the heart rate, and is never refused for it", () => {
  it("a workout left paused past 12 hours sends no reading past its length, and the server's schema takes it", () => {
    let run = begin();
    run = step(run, 30, { kind: "main" }, every(0, 30));
    run = step(run, 31, { kind: "pause" });
    run = step(run, 13 * 3600, { kind: "resume" });
    run = step(run, 13 * 3600 + 20, { kind: "tick" }, every(13 * 3600, 13 * 3600 + 20));
    run = step(run, 13 * 3600 + 21, { kind: "end" });
    const save = toSave(run, "android", "1.0.0");
    if (save === null) throw new Error("nothing to save");
    const length = Date.parse(save.endedAt) - Date.parse(save.startedAt);
    expect(save.heart.every(([at]) => at <= length)).toBe(true);
    expect(save.heart.length).toBeGreaterThanOrEqual(30);
    expect(workoutSaveSchema.safeParse(save).success).toBe(true);
  });

  it("a workout with no monitor sends none, as before", () => {
    let run = step(begin(), 20, { kind: "main" });
    run = step(run, 21, { kind: "end" });
    expect(toSave(run, "android", "1.0.0")?.heart).toEqual([]);
  });

  it("an hour of readings is kept whole and taken by the server's schema", () => {
    let run = begin();
    for (let s = 1; s <= 3600; s += 60) run = step(run, s + 59, { kind: "tick" }, every(s - 1, s + 59, 130 + (s % 20)));
    run = step(run, 3601, { kind: "main" });
    run = step(run, 3602, { kind: "end" });
    const save = toSave(run, "android", "1.0.0");
    expect(save?.heart.length).toBe(3600);
    expect(save?.heart[3599]).toEqual([3_600_000, 131]);
    expect(workoutSaveSchema.safeParse(save).success).toBe(true);
  });
});

describe("the store: readings from before Start are not this workout's, and the summary's heart rate is the server's rule", () => {
  const files = () => {
    let text: string | null = null;
    return { read: () => Promise.resolve(text), write: (t: string) => ((text = t), Promise.resolve()) };
  };
  const waiting = () => workoutWaiting(files(), () => Promise.resolve({ kind: "done" as const }));

  it("drains the queue at Start, keeps what comes after, and gives the summary its average and highest", async () => {
    const queue: HeartIn[] = [{ at: T0 - 1000, bpm: 99 }];
    let clock = T0;
    const store = createRunStore({ file: files(), waiting: waiting(), platform: "android", appVersion: "1", clock: () => clock, heart: () => queue.splice(0) });
    await store.ready;
    expect(store.start({ workoutId: ID, name: "Arms", now: T0, timeZone: "UTC", exercises: [{ ...curl, sets: [reps(10, null)] }] })).toBe("started");
    // A reading queued before Start is still left out, even handed over in the same queue.
    queue.push({ at: T0 - 500, bpm: 98 });
    for (let s = 1; s <= 90; s++) {
      queue.push({ at: T0 + s * 1000, bpm: s <= 45 ? 120 : 160 });
      clock = T0 + s * 1000;
      store.press({ kind: "tick" }, clock);
    }
    store.press({ kind: "main" }, clock);
    const done: Finished | null = store.finished();
    expect(done?.heart).toEqual(heartSums([...Array.from({ length: 90 }, (_, i): [number, number] => [(i + 1) * 1000, i + 1 <= 45 ? 120 : 160])], [], 90_000));
    expect(done?.heart?.max).toBe(160);
  });
});
