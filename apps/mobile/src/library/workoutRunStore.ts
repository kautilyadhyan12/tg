import type { WorkoutRun, WorkoutSave } from "@app/shared";
import type { TextStore } from "../screens/food/outbox";
import { press as pressRun, setsInAll, startRun, toSave, type Press, type Start } from "./workoutRun";
import { readRun, type WorkoutWaiting } from "./workoutSaving";

// The workout a person is doing on this phone (ROADMAP Stage 5 64a-ii): one at a time, written to a file of their own
// at every step (and every 15 s while the clocks run), so a closed app or a dead battery loses nothing: the next open
// carries on where it was, paused if it was away longer than 10 minutes. When it is done it goes to the waiting list
// first, and only once that list holds it is the workout's own file emptied, so a phone that dies between the two
// still holds it, and the next open hands it over again (kept once, by its id).

/** While the clocks run with nothing pressed, the file is written this often. */
export const WRITE_EVERY_MS = 15_000;

/** The workout just done, for its own screen. */
export interface Finished {
  workoutId: string;
  name: string;
  totalMs: number;
  sets: number;
  exercises: number;
}

export interface RunStore {
  /** The file read and anything it held carried on or handed over. */
  ready: Promise<void>;
  /** The workout being done; null for none. */
  run: () => WorkoutRun | null;
  finished: () => Finished | null;
  /** A new workout, written to the file before it is shown; false where one is already going on. */
  start: (s: Start) => boolean;
  press: (p: Press, now: number) => void;
  /** Thrown away: the person said Discard. */
  discard: () => void;
  closeFinished: () => void;
  watch: (told: () => void) => () => void;
}

export interface RunStoreSetup {
  file: TextStore;
  waiting: WorkoutWaiting;
  platform: WorkoutSave["platform"];
  appVersion: string;
  clock: () => number;
}

const placeOf = (r: WorkoutRun): string => `${r.phase}/${String(r.ex)}/${String(r.set)}/${String(r.paused)}/${String(r.done.length)}`;

export function createRunStore(setup: RunStoreSetup): RunStore {
  let run: WorkoutRun | null = null;
  let finished: Finished | null = null;
  let read = false;
  let writtenAt = 0;
  let writtenPlace = "";
  let writing: Promise<void> = Promise.resolve();
  const watchers = new Set<() => void>();
  const tell = () => {
    for (const w of [...watchers]) w();
  };
  const write = (text: string) => {
    writing = writing.then(() => setup.file.write(text)).catch(() => undefined);
    return writing;
  };
  const keep = (r: WorkoutRun) => {
    writtenAt = setup.clock();
    writtenPlace = placeOf(r);
    void write(JSON.stringify(r));
  };

  /** A workout done: kept in the waiting list, then its own file emptied, then sent. */
  const handOver = async (done: WorkoutRun) => {
    const save = toSave(done, setup.platform, setup.appVersion);
    if (save === null) {
      await write("");
      return;
    }
    const kept = await setup.waiting.add(save);
    // Not in the list's file: the workout's own file keeps it, and the next open hands it over again.
    if (!kept) return;
    await write("");
    void setup.waiting.send(true);
  };

  const finish = (done: WorkoutRun) => {
    run = null;
    finished = { workoutId: done.workoutId, name: done.name, totalMs: done.totalMs, sets: done.done.length, exercises: new Set(done.done.map((s) => s.exercise)).size };
    keep(done);
    void handOver(done);
  };

  const ready = setup.file
    .read()
    .then(
      (text) => {
        read = true;
        const kept = readRun(text);
        if (kept === null || run !== null) return;
        if (kept.phase === "done") {
          void handOver(kept);
          return;
        }
        const back = pressRun(kept, { kind: "back" }, setup.clock());
        if (back.kind === "on" && back.run.phase === "done") finish(back.run);
        else if (back.kind === "on") {
          run = back.run;
          keep(back.run);
        } else void write("");
      },
      () => {
        read = true;
      },
    )
    .finally(tell);

  return {
    ready,
    run: () => run,
    finished: () => finished,
    start: (s) => {
      if (run !== null || !read) return false;
      const made = startRun(s);
      if (made === null || setsInAll(made) === 0) return false;
      run = made;
      finished = null;
      keep(made);
      tell();
      return true;
    },
    press: (p, now) => {
      if (run === null) return;
      const out = pressRun(run, p, now);
      if (out.kind === "gone") {
        run = null;
        void write("");
      } else if (out.run.phase === "done") {
        finish(out.run);
      } else {
        const next = out.run;
        const moved = placeOf(next) !== writtenPlace;
        run = next;
        if (p.kind !== "tick" || moved || now - writtenAt >= WRITE_EVERY_MS) keep(next);
        // A tick that changed nothing the screen shows is still told: the clocks moved.
      }
      tell();
    },
    discard: () => {
      if (run === null) return;
      run = null;
      void write("");
      tell();
    },
    closeFinished: () => {
      finished = null;
      tell();
    },
    watch: (told) => {
      watchers.add(told);
      return () => {
        watchers.delete(told);
      };
    },
  };
}
