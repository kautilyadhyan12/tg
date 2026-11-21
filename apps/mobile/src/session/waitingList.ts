import { waitingFileSchema } from "@app/shared";
import type { TextStore } from "../screens/food/outbox";

// What a person does is kept on the phone until the server has it (CLAUDE.md §4; spec Part 2 §13.6, "kept until saved,
// built once"): ONE piece for anything sent whole under its own id, so the server keeps one however often it arrives.
// Each thing is written to the person's own file BEFORE it is sent, sent one at a time, oldest first, and taken out
// only when the server has answered for it. The three answers the app knows: saved · refused, with words for the
// person · no answer (or not now), tried again. Built with the workout (64a-ii); the four older copies (meals,
// weigh-ins, runs, minutes) are not rewritten here.

export type SendAnswer = { kind: "done" } | { kind: "later" } | { kind: "refused"; message: string };

export interface WaitingSetup<T, R> {
  store: TextStore;
  send: (thing: T) => Promise<SendAnswer>;
  idOf: (thing: T) => string;
  /** One thing read back from the file; null for one that cannot be read, which is left out, never sent. */
  read: (raw: unknown) => T | null;
  readRefused: (raw: unknown) => R | null;
  refusedOf: (thing: T, message: string) => R;
  refusedIdOf: (refused: R) => string;
  /** How many may wait; past it a new one is not kept. */
  most: number;
  /** The phone's clock, for waiting longer between tries while the server does not answer; a test's own. */
  clock?: () => number;
}

export interface WaitingView<T, R> {
  waiting: readonly T[];
  refused: readonly R[];
  /** Ids the server took since the app opened, newest last. */
  sent: readonly string[];
  /** The last try had no answer, or the server could not take it then: what waits is on the phone only. */
  held: boolean;
  /** The last write of the file failed: what waits is held in memory only, and written again. */
  unsaved: boolean;
}

export interface WaitingList<T, R> {
  /** Reads the file; until it is read nothing is written or sent. */
  start: () => Promise<void>;
  view: () => WaitingView<T, R>;
  subscribe: (listener: () => void) => () => void;
  /** Kept on the phone first, the file read before if it was not yet. false: it is not in the file, as the list is full or the write failed (it is then held in memory and written again). One already kept is kept once. */
  add: (thing: T) => Promise<boolean>;
  /** Sends what waits, in order, until the server cannot take more just now. Unless `now`, a try soon after one the
   *  server did not answer waits its turn: 15 s, then twice as long each time, up to 5 minutes. */
  send: (now?: boolean) => Promise<void>;
  /** A refused one taken off the phone: the person pressed OK. */
  dismiss: (id: string) => void;
  /** No more sends: the person signed out, or somebody else signed in. */
  stop: () => void;
}

export const FIRST_WAIT_MS = 15_000;
export const LONGEST_WAIT_MS = 5 * 60_000;

export function createWaitingList<T, R>(setup: WaitingSetup<T, R>): WaitingList<T, R> {
  const clock = setup.clock ?? Date.now;
  let waiting: T[] = [];
  let refused: R[] = [];
  let sent: string[] = [];
  let view: WaitingView<T, R> = { waiting, refused, sent, held: false, unsaved: false };
  const flags = { started: false, stopped: false, held: false, unsaved: false, again: false };
  let nextTry = 0;
  let wait = FIRST_WAIT_MS;
  let running: Promise<void> | null = null;
  let saving: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();
  // Read through functions: a send that awaits sees what changed meanwhile.
  const stopped = (): boolean => flags.stopped;
  const askedAgain = (): boolean => flags.again;

  function changed() {
    view = { waiting, refused, sent, held: flags.held, unsaved: flags.unsaved };
    for (const l of [...listeners]) l();
  }

  /** One write at a time, in order, each the whole file as it is now; none before it was read. */
  function keep(): Promise<void> {
    if (!flags.started) return saving;
    saving = saving.then(async () => {
      let failed = false;
      try {
        await setup.store.write(JSON.stringify({ version: 1, waiting, refused }));
      } catch {
        failed = true;
      }
      if (failed !== flags.unsaved) {
        flags.unsaved = failed;
        changed();
      }
    });
    return saving;
  }

  let starting: Promise<void> | null = null;
  const start = (): Promise<void> => (starting ??= open());

  async function open(): Promise<void> {
    let text: string | null = null;
    try {
      text = await setup.store.read();
    } catch {
      text = null;
    }
    if (text !== null) {
      let whole = false;
      try {
        const frame = waitingFileSchema.parse(JSON.parse(text));
        const things = frame.waiting.flatMap((raw) => {
          const t = setup.read(raw);
          return t === null ? [] : [t];
        });
        const kept = frame.refused.flatMap((raw) => {
          const r = setup.readRefused(raw);
          return r === null ? [] : [r];
        });
        waiting = things;
        refused = kept;
        whole = things.length === frame.waiting.length && kept.length === frame.refused.length;
      } catch {
        whole = false;
      }
      if (!whole && setup.store.aside !== undefined) await setup.store.aside(text).catch(() => undefined);
    }
    flags.started = true;
    changed();
    if (waiting.length > 0) await keep();
  }

  async function add(thing: T): Promise<boolean> {
    // Never kept in memory alone: the file is read first, so the write that keeps this one holds every other too.
    await start();
    const id = setup.idOf(thing);
    if (waiting.some((t) => setup.idOf(t) === id) || refused.some((r) => setup.refusedIdOf(r) === id) || sent.includes(id)) return true;
    if (waiting.length >= setup.most) return false;
    waiting = [...waiting, thing];
    changed();
    await keep();
    return !flags.unsaved;
  }

  async function drain(): Promise<void> {
    if (flags.unsaved) await keep();
    for (;;) {
      const head = waiting[0];
      if (head === undefined || stopped()) return;
      const answer = await setup.send(head);
      if (stopped()) return;
      if (answer.kind === "later") {
        flags.held = true;
        nextTry = clock() + wait;
        wait = Math.min(LONGEST_WAIT_MS, wait * 2);
        changed();
        return;
      }
      flags.held = false;
      wait = FIRST_WAIT_MS;
      nextTry = 0;
      const id = setup.idOf(head);
      waiting = waiting.filter((t) => setup.idOf(t) !== id);
      if (answer.kind === "done") sent = [...sent.slice(-49), id];
      else refused = [...refused, setup.refusedOf(head, answer.message.slice(0, 500))];
      await keep();
      changed();
    }
  }

  function send(now = false): Promise<void> {
    if (!flags.started || stopped()) return Promise.resolve();
    if (!now && clock() < nextTry) return Promise.resolve();
    if (running !== null) {
      flags.again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          flags.again = false;
          await drain();
        } while (askedAgain() && !stopped() && !flags.held);
      } finally {
        running = null;
      }
    })();
    return running;
  }

  return {
    start,
    view: () => view,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    add,
    send,
    dismiss: (id) => {
      if (!refused.some((r) => setup.refusedIdOf(r) === id)) return;
      refused = refused.filter((r) => setup.refusedIdOf(r) !== id);
      changed();
      void keep();
    },
    stop: () => {
      flags.stopped = true;
    },
  };
}
