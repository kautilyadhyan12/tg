import { heartSums, type RunExercise, type SavedSet, type WorkoutRun, type WorkoutSave } from "@app/shared";
import type { TextStore } from "../screens/food/outbox";
import { press as pressRun, setsInAll, startRun, toSave, withHeart, type HeartIn, type Press, type Start } from "./workoutRun";
import { soundsOf, type WorkoutSound } from "./workoutSounds";
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
  /** Its time trained: every pause left out, as its screen showed it. */
  activeMs: number;
  sets: number;
  exercises: number;
  /** Every set done, in order, as the save sends it: its summary shows them with no internet (64a-iii). */
  done: readonly SavedSet[];
  /** Its exercises as they were at Start: their names and kinds for the summary. */
  plan: readonly RunExercise[];
  /** Its average and highest heart rate, worked out as the server does from what the save sends (64a-vi); null with
   *  under a minute of it, or no monitor. */
  heart: { avg: number; max: number } | null;
}

export interface RunStore {
  /** The file read and anything it held carried on or handed over. */
  ready: Promise<void>;
  /** The workout being done; null for none. */
  run: () => WorkoutRun | null;
  finished: () => Finished | null;
  /** A new workout, written to the file before it is shown. "busy": one is going on, or the last one finished is not
   *  yet in the waiting list's file and holds this workout's own file, so a new one may not write over it (round one,
   *  H3); "nothing": no set to do. */
  start: (s: Start) => StartResult;
  /** The id of a finished workout kept in this workout's own file alone, until the waiting list's file holds it. */
  keeping: () => string | null;
  /** Hands a finished workout over to the waiting list again, where it could not be the first time. */
  retry: () => void;
  press: (p: Press, now: number) => void;
  /** Thrown away: the person said Discard. */
  discard: () => void;
  closeFinished: () => void;
  watch: (told: () => void) => () => void;
}

export type StartResult = "started" | "busy" | "nothing";

export interface RunStoreSetup {
  file: TextStore;
  waiting: WorkoutWaiting;
  platform: WorkoutSave["platform"];
  appVersion: string;
  clock: () => number;
  /** The person's own monitor's readings since the last take (64a-vi); none without a monitor. */
  heart?: () => readonly HeartIn[];
  /** What a press sounds (64a-vi): the layer plays them, or not where the person turned sound off. */
  sound?: (sounds: readonly WorkoutSound[]) => void;
}

const placeOf = (r: WorkoutRun): string => `${r.phase}/${String(r.ex)}/${String(r.set)}/${String(r.paused)}/${String(r.done.length)}`;

export function createRunStore(setup: RunStoreSetup): RunStore {
  let run: WorkoutRun | null = null;
  // A finished workout not yet in the waiting list's file: this workout's own file keeps it until then.
  let pending: WorkoutRun | null = null;
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

  /** The finished workout handed over: kept in the waiting list, then this workout's own file emptied (only while no new
   *  workout writes it, round one L1), then sent. Where the list could not keep it, this file still does, and no new
   *  workout may start until it is handed over (`retry`, and the next open). */
  let handing = false;
  const handOver = async () => {
    const done = pending;
    if (done === null || handing) return;
    handing = true;
    try {
      const save = toSave(done, setup.platform, setup.appVersion);
      const kept = save === null ? true : await setup.waiting.add(save);
      if (!kept) return;
      if (pending?.workoutId === done.workoutId) pending = null;
      if (run === null) await write("");
      if (save !== null) void setup.waiting.send(true);
    } finally {
      handing = false;
      tell();
    }
  };

  const finish = (done: WorkoutRun) => {
    run = null;
    pending = done;
    const save = toSave(done, setup.platform, setup.appVersion);
    finished = {
      heart: save === null ? null : heartSums(save.heart, [], Date.parse(save.endedAt) - Date.parse(save.startedAt)),
      workoutId: done.workoutId,
      name: done.name,
      activeMs: done.activeMs,
      sets: done.done.length,
      exercises: new Set(done.done.map((s) => s.exercise)).size,
      done: done.done,
      plan: done.exercises,
    };
    keep(done);
    void handOver();
  };

  const ready = setup.file
    .read()
    .then(
      (text) => {
        read = true;
        const kept = readRun(text);
        if (kept === null || run !== null) return;
        if (kept.phase === "done") {
          pending = kept;
          void handOver();
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
      if (run !== null || !read) return "busy";
      if (pending !== null) {
        void handOver();
        return "busy";
      }
      const made = startRun(s);
      if (made === null || setsInAll(made) === 0) return "nothing";
      // Readings from before Start are not this workout's.
      setup.heart?.();
      run = made;
      finished = null;
      keep(made);
      tell();
      return "started";
    },
    keeping: () => pending?.workoutId ?? null,
    retry: () => {
      void handOver();
    },
    press: (p, now) => {
      if (run === null) return;
      const before = run;
      // The readings that came since the last press belong to the workout as it was until now (paused: none).
      const out = pressRun(withHeart(before, setup.heart?.() ?? [], now), p, now);
      const sounds = soundsOf(before, out.kind === "gone" ? null : out.run, p, now);
      if (sounds.length > 0) setup.sound?.(sounds);
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
