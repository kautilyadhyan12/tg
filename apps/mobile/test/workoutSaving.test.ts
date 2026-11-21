import { describe, expect, it } from "vitest";
import { workoutSaveSchema, type RunExercise, type WorkoutSave } from "@app/shared";
import type { TextStore } from "../src/screens/food/outbox";
import type { Answer } from "../src/session/calls";
import type { SendAnswer } from "../src/session/waitingList";
import { press, startRun } from "../src/library/workoutRun";
import { createRunStore, type RunStore } from "../src/library/workoutRunStore";
import { readAnswer, readRun, REFUSED_WORDS, workoutWaiting, type WorkoutWaiting } from "../src/library/workoutSaving";

// The worst thing this job could do to a real person (64a-ii's plan): lose a workout they finished, or save it twice and
// give its XP twice. So: the phone is "closed" at every step and opened again from its files alone, the server does not
// answer, and the phone dies between the two files. The workout must be there each time, and reach the server as one.

const ID = "11111111-1111-4111-8111-111111111111";
const T0 = Date.parse("2026-11-21T10:00:00.000Z");

const curl: RunExercise = {
  exercise: "barbell_curl",
  name: "Barbell Curl",
  kind: "strength",
  measuredIn: "reps",
  barbell: true,
  sets: [
    { target: 10, weightGrams: 20_000, restSeconds: 60 },
    { target: 10, weightGrams: 20_000, restSeconds: 60 },
  ],
};
const plank: RunExercise = { exercise: "plank", name: "Plank", kind: "strength", measuredIn: "time", barbell: false, sets: [{ target: 30, weightGrams: null, restSeconds: 30 }] };

/** A phone file, which outlives the app. */
function file(text: string | null = null): TextStore & { text: string | null } {
  const store = {
    text,
    read: () => Promise.resolve(store.text),
    write: (next: string) => {
      store.text = next;
      return Promise.resolve();
    },
  };
  return store;
}

/** The server as 61a built it: one workout for an id, however often it is sent; `answering` false is no signal. */
function server() {
  const saved = new Map<string, WorkoutSave>();
  const calls: string[] = [];
  const s = {
    answering: true,
    saved,
    calls,
    send: (w: WorkoutSave): Promise<SendAnswer> => {
      calls.push(w.workoutId);
      if (!s.answering) return Promise.resolve({ kind: "later" });
      expect(workoutSaveSchema.safeParse(w).success).toBe(true);
      saved.set(w.workoutId, w);
      return Promise.resolve({ kind: "done" });
    },
  };
  return s;
}

const settle = () => new Promise((r) => setTimeout(r, 5));

/** The app opened on the phone's two files. */
function openApp(runFile: TextStore, waitingFile: TextStore, send: (w: WorkoutSave) => Promise<SendAnswer>, now: { t: number }): { store: RunStore; waiting: WorkoutWaiting } {
  const waiting = workoutWaiting(waitingFile, send, () => now.t);
  void waiting.start();
  const store = createRunStore({ file: runFile, waiting, platform: "android", appVersion: "phone 1.0.0", clock: () => now.t });
  return { store, waiting };
}

describe("a finished workout is never lost, and reaches the server once", () => {
  it("the app closed and opened again at every step, with no signal until the end", async () => {
    const runFile = file();
    const waitingFile = file();
    const srv = server();
    srv.answering = false;
    const now = { t: T0 };
    let app = openApp(runFile, waitingFile, srv.send, now);
    await app.store.ready;
    expect(app.store.start({ workoutId: ID, name: "Full body", now: now.t, timeZone: "Asia/Kolkata", exercises: [curl, plank] })).toBe("started");
    await settle();
    // Each press, then the app closed and opened from the files alone: what it reads back is what was on the screen.
    const presses: [number, Parameters<RunStore["press"]>[0]][] = [
      [5_000, { kind: "count", by: 1 }],
      [9_000, { kind: "count", by: 1 }],
      [30_000, { kind: "main" }],
      [50_000, { kind: "main" }],
      [80_000, { kind: "count", by: 1 }],
      [95_000, { kind: "main" }],
      [125_000, { kind: "tick" }],
      [140_000, { kind: "pause" }],
      [200_000, { kind: "resume" }],
    ];
    for (const [at, p] of presses) {
      now.t = T0 + at;
      app.store.press(p, now.t);
      await settle();
      const shown = app.store.run();
      app.waiting.stop();
      app = openApp(runFile, waitingFile, srv.send, now);
      await app.store.ready;
      expect(app.store.run()).toEqual(shown);
    }
    // The plank's 30 s run out; the workout is done and handed over, still with no signal.
    now.t = T0 + 260_000;
    app.store.press({ kind: "tick" }, now.t);
    await settle();
    expect(app.store.run()).toBeNull();
    expect(app.store.finished()).toMatchObject({ workoutId: ID, sets: 3, exercises: 2 });
    expect(readRun(runFile.text)).toBeNull();
    expect(app.waiting.view().waiting.map((w) => w.workoutId)).toEqual([ID]);
    expect(app.waiting.view().held).toBe(true);
    expect(srv.saved.size).toBe(0);
    // Closed again with it waiting; opened with signal: it is sent and taken out.
    app.waiting.stop();
    srv.answering = true;
    app = openApp(runFile, waitingFile, srv.send, now);
    await app.store.ready;
    await app.waiting.start();
    await app.waiting.send(true);
    expect(srv.saved.size).toBe(1);
    expect(app.waiting.view().waiting).toEqual([]);
    expect(app.waiting.view().sent).toEqual([ID]);
    // Sent again by anything, it is not sent: nothing waits (round one: counted before and after).
    const calls = srv.calls.length;
    await app.waiting.send(true);
    await app.waiting.send();
    expect(srv.calls.length).toBe(calls);
    const save = srv.saved.get(ID);
    expect(save?.sets.map((s) => [s.exercise, s.done, s.restSeconds])).toEqual([
      ["barbell_curl", 2, 20],
      ["barbell_curl", 1, 60],
      ["plank", 30, null],
    ]);
  });

  it("the phone dies after the waiting list kept it and before the workout's own file was emptied", async () => {
    const run = startRun({ workoutId: ID, name: "", now: T0, timeZone: "UTC", exercises: [plank] });
    if (run === null) throw new Error("no run");
    const out = press(run, { kind: "end" }, T0 + 1000);
    // Nothing done: ending it keeps nothing.
    expect(out.kind).toBe("gone");
    // Get ready, Start now, then Set done 5 s in: done.
    const going = press(run, { kind: "main" }, T0 + 2000);
    if (going.kind !== "on") throw new Error("gone");
    const timed = press(going.run, { kind: "main" }, T0 + 7000);
    if (timed.kind !== "on") throw new Error("gone");
    expect(timed.run.phase).toBe("done");
    const runFile = file(JSON.stringify(timed.run));
    const srv = server();
    srv.answering = false;
    const now = { t: T0 + 60_000 };
    // First open: handed over to the list, which writes its own file; then the phone dies before the workout's own file
    // is emptied (round one: the list's file as the first list wrote it).
    const waitingFile = file();
    const first = openApp(runFile, waitingFile, srv.send, now);
    await first.store.ready;
    await settle();
    expect((JSON.parse(waitingFile.text ?? "{}") as { waiting: { workoutId: string }[] }).waiting.map((w) => w.workoutId)).toEqual([ID]);
    first.waiting.stop();
    runFile.text = JSON.stringify(timed.run);
    // Opened again: the done workout is handed over again, and the list keeps it once.
    const second = openApp(runFile, waitingFile, srv.send, now);
    await second.store.ready;
    await settle();
    expect(second.waiting.view().waiting.map((w) => w.workoutId)).toEqual([ID]);
    expect(readRun(runFile.text)).toBeNull();
    srv.answering = true;
    await second.waiting.send(true);
    expect([...srv.saved.keys()]).toEqual([ID]);
  });

  it("a write of the waiting list that fails keeps the workout's own file, so nothing is lost", async () => {
    const run = startRun({ workoutId: ID, name: "Legs", now: T0, timeZone: "UTC", exercises: [{ ...curl, sets: [{ target: 1, weightGrams: null, restSeconds: null }] }] });
    if (run === null) throw new Error("no run");
    const runFile = file(JSON.stringify(run));
    const broken: TextStore = { read: () => Promise.resolve(null), write: () => Promise.reject(new Error("disk full")) };
    const srv = server();
    const now = { t: T0 + 1000 };
    const app = openApp(runFile, broken, srv.send, now);
    await app.store.ready;
    app.store.press({ kind: "count", by: 1 }, now.t);
    await settle();
    expect(app.store.finished()).toMatchObject({ workoutId: ID, sets: 1 });
    // The list could not write: the workout's own file still holds it, done, for the next open.
    expect(readRun(runFile.text)?.phase).toBe("done");
  });

  it("a finished workout the waiting list could not keep is never written over by the next Start workout (round one, H3)", async () => {
    const run = startRun({ workoutId: ID, name: "Legs", now: T0, timeZone: "UTC", exercises: [{ ...curl, sets: [{ target: 1, weightGrams: null, restSeconds: null }] }] });
    if (run === null) throw new Error("no run");
    const runFile = file(JSON.stringify(run));
    const disk = { full: true, text: null as string | null };
    const flaky: TextStore = {
      read: () => Promise.resolve(disk.text),
      write: (t) => {
        if (disk.full) return Promise.reject(new Error("disk full"));
        disk.text = t;
        return Promise.resolve();
      },
    };
    const srv = server();
    srv.answering = false;
    const now = { t: T0 + 1000 };
    const app = openApp(runFile, flaky, srv.send, now);
    await app.store.ready;
    app.store.press({ kind: "count", by: 1 }, now.t);
    await settle();
    expect(app.store.keeping()).toBe(ID);
    // Start workout again: refused while the last one is kept in this file alone; the file still holds it.
    const next = { workoutId: "22222222-2222-4222-8222-222222222222", name: "", now: now.t, timeZone: "UTC", exercises: [curl] };
    expect(app.store.start(next)).toBe("busy");
    expect(readRun(runFile.text)?.workoutId).toBe(ID);
    // Room again: handed over, its file emptied, and the next workout may start, the first one kept once.
    disk.full = false;
    app.store.retry();
    await settle();
    expect(app.store.keeping()).toBeNull();
    expect((JSON.parse(disk.text ?? "{}") as { waiting: { workoutId: string }[] }).waiting.map((w) => w.workoutId)).toEqual([ID]);
    expect(app.store.start(next)).toBe("started");
    await settle();
    expect(readRun(runFile.text)?.workoutId).toBe(next.workoutId);
  });
});

describe("what each answer from the server does", () => {
  const refused = (status: number): Answer<unknown> => ({ kind: "refused", status, error: "x", message: "x", retryAfterSeconds: null, robotCheckKey: null, body: null });
  it.each<[string, Answer<unknown>, SendAnswer["kind"]]>([
    ["saved", { kind: "ok", data: { workoutId: ID, status: "created" } }, "done"],
    ["no answer", { kind: "no_answer" }, "later"],
    ["sign-in being renewed (401)", refused(401), "later"],
    ["an exercise it does not know yet (422)", refused(422), "later"],
    ["too many at once (429)", refused(429), "later"],
    ["its own fault (500)", refused(500), "later"],
    ["a broken phone's workout (400)", refused(400), "refused"],
    ["a workout ending past the server's clock: a phone whose clock runs fast (400 not_ended_yet)", { ...refused(400), error: "not_ended_yet" } as Answer<unknown>, "later"],
    ["an id it holds for somebody else (404)", refused(404), "refused"],
  ])("%s", (_name, answer, kind) => {
    const read = readAnswer(answer);
    expect(read.kind).toBe(kind);
    if (read.kind === "refused") expect(read.message).toBe(REFUSED_WORDS);
  });

  it("a refused workout is said, and goes when the person presses OK", async () => {
    const waitingFile = file();
    const waiting = workoutWaiting(waitingFile, () => Promise.resolve({ kind: "refused", message: REFUSED_WORDS }), () => T0);
    const run = startRun({ workoutId: ID, name: "Legs", now: T0, timeZone: "UTC", exercises: [plank] });
    if (run === null) throw new Error("no run");
    const save: WorkoutSave = { workoutId: ID, name: "Legs", startedAt: run.startedAt, endedAt: run.startedAt, timeZone: "UTC", startedFrom: "none", effort: null, heart: [], platform: "android", appVersion: "phone 1", sets: [{ exercise: "plank", position: 0, measuredIn: "time", target: 30, done: 0, weightGrams: null, restSeconds: null, durationMs: 0, counted: "timer" }] };
    expect(await waiting.add(save)).toBe(true);
    await waiting.send(true);
    expect(waiting.view().waiting).toEqual([]);
    expect(waiting.view().refused).toEqual([{ workoutId: ID, name: "Legs", endedAt: run.startedAt, message: REFUSED_WORDS }]);
    // Added again (the same workout handed over again), it is not sent again.
    expect(await waiting.add(save)).toBe(true);
    expect(waiting.view().waiting).toEqual([]);
    waiting.dismiss(ID);
    expect(waiting.view().refused).toEqual([]);
    await settle();
    expect(JSON.parse(waitingFile.text ?? "{}")).toEqual({ version: 1, waiting: [], refused: [] });
  });

  it("with no answer it waits longer between tries, and tries at once when the app comes back", async () => {
    const now = { t: T0 };
    const calls: number[] = [];
    const waiting = workoutWaiting(file(), () => {
      calls.push(now.t);
      return Promise.resolve({ kind: "later" });
    }, () => now.t);
    const run = startRun({ workoutId: ID, name: "", now: T0, timeZone: "UTC", exercises: [plank] });
    if (run === null) throw new Error("no run");
    const save: WorkoutSave = { workoutId: ID, name: null, startedAt: run.startedAt, endedAt: run.startedAt, timeZone: "UTC", startedFrom: "none", effort: null, heart: [], platform: "android", appVersion: "phone 1", sets: [{ exercise: "plank", position: 0, measuredIn: "time", target: 30, done: 0, weightGrams: null, restSeconds: null, durationMs: 0, counted: "timer" }] };
    await waiting.add(save);
    await waiting.send();
    now.t += 10_000;
    await waiting.send();
    now.t += 6_000;
    await waiting.send();
    now.t += 20_000;
    await waiting.send();
    now.t += 1_000;
    await waiting.send(true);
    expect(calls.map((t) => t - T0)).toEqual([0, 16_000, 37_000]);
  });
});
