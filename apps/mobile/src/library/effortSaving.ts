import { waitingEffortSchema, workoutEffortGivenSchema, type WaitingEffort } from "@app/shared";
import type { Answer, Request, Shape } from "../session/calls";
import { createWaitingList, type SendAnswer, type WaitingList } from "../session/waitingList";
import type { TextStore } from "../screens/food/outbox";

// How hard a workout was, given on its last screen (ROADMAP Stage 5 64a-iii): kept on the phone first, in the one shared
// waiting list, then sent to the workout the server holds. Each press waits under its own id and they go in the order
// pressed, so the stars last pressed are the ones kept. They wait while their workout is still on its way: the server
// cannot hold the stars of a workout it does not have yet.

export const effortPath = (workoutId: string): string => `/v1/training/workouts/${encodeURIComponent(workoutId)}/effort`;
/** Presses that may wait on one phone. */
export const EFFORT_WAITING_MOST = 200;

type SignedIn = <T>(request: Omit<Request, "token">, shape: Shape<T>) => Promise<Answer<T>>;

/** What became of one send. Not now: no answer, a sign-in being renewed, too many presses at once, the server's own fault.
 *  Anything else (404: no such workout of theirs; 400) it will answer the same way again, and there is nothing the person
 *  could do about it, so the press is let go with no words. */
export function readEffortAnswer(answer: Answer<unknown>): SendAnswer {
  if (answer.kind === "ok") return { kind: "done" };
  if (answer.kind === "no_answer") return { kind: "later" };
  if (answer.status === 401 || answer.status === 429 || answer.status >= 500) return { kind: "later" };
  return { kind: "done" };
}

/** `waitsFor`: whether the workout itself is still on the phone, not yet on the server. */
export function effortSender(signedIn: SignedIn, waitsFor: (workoutId: string) => boolean): (e: WaitingEffort) => Promise<SendAnswer> {
  return async (e) => {
    if (waitsFor(e.workoutId)) return { kind: "later" };
    return readEffortAnswer(await signedIn({ method: "PUT", path: effortPath(e.workoutId), body: { effort: e.effort } }, workoutEffortGivenSchema));
  };
}

export type EffortWaiting = WaitingList<WaitingEffort, WaitingEffort>;

export function effortWaiting(store: TextStore, send: (e: WaitingEffort) => Promise<SendAnswer>, clock?: () => number): EffortWaiting {
  const read = (raw: unknown): WaitingEffort | null => {
    const ok = waitingEffortSchema.safeParse(raw);
    return ok.success ? ok.data : null;
  };
  return createWaitingList<WaitingEffort, WaitingEffort>({
    store,
    send,
    idOf: (e) => e.id,
    read,
    readRefused: read,
    refusedOf: (e) => e,
    refusedIdOf: (e) => e.id,
    most: EFFORT_WAITING_MOST,
    ...(clock === undefined ? {} : { clock }),
  });
}
