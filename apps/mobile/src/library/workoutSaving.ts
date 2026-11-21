import { WORKOUT_NOT_ENDED, refusedWorkoutSchema, workoutRunSchema, workoutSavedSchema, workoutSaveSchema, type RefusedWorkout, type WorkoutRun, type WorkoutSave } from "@app/shared";
import type { Answer, Request, Shape } from "../session/calls";
import { createWaitingList, type SendAnswer, type WaitingList } from "../session/waitingList";
import type { TextStore } from "../screens/food/outbox";

// A finished workout goes to the person's account (ROADMAP Stage 5 64a-ii; spec Part 2 §13.5, job 61a's route): kept on
// the phone first, then sent under its own id, which is also its Idempotency-Key, so sent twice it is one workout and
// its XP and streak are given once. A workout in progress is kept in a file of its own, written at every step.

export const WORKOUTS_PATH = "/v1/workouts";
export const REFUSED_WORDS = "This workout couldn't be saved.";
/** Finished workouts that may wait on one phone for the server. */
export const WAITING_MOST = 100;

type SignedIn = <T>(request: Omit<Request, "token">, shape: Shape<T>) => Promise<Answer<T>>;

/** What became of one send. Not now: no answer, a sign-in being renewed, too many at once, the server's own fault, an
 *  exercise it does not know (422), or a workout ending past its clock, from a phone whose clock runs fast (400
 *  `not_ended_yet`, round one H1): the phone keeps the workout and sends it again, at most every 5 minutes, so nothing
 *  is dropped. Anything else it refuses, it will refuse again: a broken phone's workout, or an id it does not hold for
 *  this person. */
export function readAnswer(answer: Answer<unknown>): SendAnswer {
  if (answer.kind === "ok") return { kind: "done" };
  if (answer.kind === "no_answer") return { kind: "later" };
  if (answer.status === 401 || answer.status === 422 || answer.status === 429 || answer.status >= 500) return { kind: "later" };
  if (answer.status === 400 && answer.error === WORKOUT_NOT_ENDED) return { kind: "later" };
  // A shape the server would not read is the app's fault, never words for the person.
  return { kind: "refused", message: REFUSED_WORDS };
}

export function workoutSender(signedIn: SignedIn): (save: WorkoutSave) => Promise<SendAnswer> {
  return async (save) => readAnswer(await signedIn({ method: "POST", path: WORKOUTS_PATH, body: save, key: save.workoutId, waitMs: 30_000 }, workoutSavedSchema));
}

export type WorkoutWaiting = WaitingList<WorkoutSave, RefusedWorkout>;

export function workoutWaiting(store: TextStore, send: (save: WorkoutSave) => Promise<SendAnswer>, clock?: () => number): WorkoutWaiting {
  return createWaitingList<WorkoutSave, RefusedWorkout>({
    store,
    send,
    idOf: (w) => w.workoutId,
    read: (raw) => {
      const ok = workoutSaveSchema.safeParse(raw);
      return ok.success ? ok.data : null;
    },
    readRefused: (raw) => {
      const ok = refusedWorkoutSchema.safeParse(raw);
      return ok.success ? ok.data : null;
    },
    refusedOf: (w, message) => ({ workoutId: w.workoutId, name: w.name, endedAt: w.endedAt, message }),
    refusedIdOf: (r) => r.workoutId,
    most: WAITING_MOST,
    ...(clock === undefined ? {} : { clock }),
  });
}

/** The workout in progress read back from its file: null for none, or one that cannot be read. */
export function readRun(text: string | null): WorkoutRun | null {
  if (text === null || text === "") return null;
  try {
    const ok = workoutRunSchema.safeParse(JSON.parse(text));
    return ok.success ? ok.data : null;
  } catch {
    return null;
  }
}
