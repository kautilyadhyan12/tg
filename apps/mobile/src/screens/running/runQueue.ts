// A saved run is kept on the phone until the server has it (CLAUDE.md §4; ROADMAP Stage 5 37a), as a
// meal or a body measurement is. It is written to the person's own file BEFORE it is sent, and sent
// with its own id as the Idempotency-Key: sent twice, the server keeps one run.
import { refusedRunSchema, runOutboxFileSchema, saveRunRequestSchema, saveRunResponseSchema, type RefusedRun, type SaveRunRequest, type SavedRun } from "@app/shared";
import type { Answer } from "../../session/calls";
import type { Session } from "../../session/session";
import type { TextStore } from "../food/outbox";

export type RunSendResult = { kind: "done"; run: SavedRun } | { kind: "later" } | { kind: "refused"; message: string };
export type RunSender = (run: SaveRunRequest) => Promise<RunSendResult>;

export type { RefusedRun };

export interface RunOutboxView {
  /** Runs the server does not have yet, oldest first. */
  waiting: SaveRunRequest[];
  /** Runs the server took since the app opened, as it saved them, newest first. */
  saved: SavedRun[];
  refused: RefusedRun[];
  /** Bumped each time the server took a run, so lists of runs are read again. */
  sent: number;
  /** The last write of the file failed: what waits is held in memory only, and written again. */
  unsaved: boolean;
}

export interface RunOutbox {
  start: () => Promise<void>;
  view: () => RunOutboxView;
  subscribe: (listener: () => void) => () => void;
  /** false: the run is held in memory only, the phone's file could not be written. */
  add: (run: SaveRunRequest) => Promise<boolean>;
  send: () => Promise<void>;
  /** A refused run sent again, from the start of the queue's end. */
  retryRefused: (runId: string) => Promise<void>;
  /** A refused run removed from the phone: the person asked. */
  removeRefused: (runId: string) => void;
  stop: () => void;
}

const REFUSED_WORDS = "This run couldn't be saved.";

/** The server cannot take it now: a lost connection, a sign-in being renewed, too many at once, or a
 *  fault of its own. Anything else it refuses, it will refuse again. */
const notNow = (answer: Answer<unknown>): boolean =>
  answer.kind === "no_answer" || (answer.kind === "refused" && (answer.status === 401 || answer.status === 429 || answer.status >= 500));

export function runSender(session: Session): RunSender {
  return async (run) => {
    const answer = await session.signedIn({ method: "POST", path: "/v1/geo/runs", body: run, key: run.runId, waitMs: 60_000 }, saveRunResponseSchema);
    if (answer.kind === "ok") return { kind: "done", run: answer.data.run };
    if (notNow(answer) || answer.kind !== "refused") return { kind: "later" };
    // A shape the server would not read is the app's fault, never words for the person.
    return { kind: "refused", message: REFUSED_WORDS };
  };
}

/** What a file holds, each run read on its own: one that cannot be read is not sent. */
export function readRunFile(text: string): { waiting: SaveRunRequest[]; refused: RefusedRun[] } {
  try {
    const file = runOutboxFileSchema.parse(JSON.parse(text));
    return {
      waiting: file.waiting.flatMap((r) => {
        const parsed = saveRunRequestSchema.safeParse(r);
        return parsed.success ? [parsed.data] : [];
      }),
      refused: file.refused.flatMap((r) => {
        const parsed = refusedRunSchema.safeParse(r);
        return parsed.success ? [parsed.data] : [];
      }),
    };
  } catch {
    return { waiting: [], refused: [] };
  }
}

export function createRunOutbox(store: TextStore, send: RunSender): RunOutbox {
  let view: RunOutboxView = { waiting: [], saved: [], refused: [], sent: 0, unsaved: false };
  const listeners = new Set<() => void>();
  const life = { stopped: false };
  // Read through a function: the outbox may be stopped while a send is away.
  const isStopped = () => life.stopped;
  let sending: Promise<void> | null = null;
  // Until the file has been read, nothing is written over it: what it holds would be lost.
  let fileRead = false;
  let reading: Promise<void> | null = null;

  const set = (next: RunOutboxView) => {
    view = next;
    for (const l of listeners) l();
  };
  const write = async () => {
    if (!fileRead) {
      set({ ...view, unsaved: true });
      return;
    }
    try {
      await store.write(JSON.stringify({ version: 1, waiting: view.waiting, refused: view.refused }));
      if (view.unsaved) set({ ...view, unsaved: false });
    } catch {
      set({ ...view, unsaved: true });
    }
  };

  const sendAll = async () => {
    while (!life.stopped) {
      const next = view.waiting[0];
      if (next === undefined) return;
      const result = await send(next);
      if (isStopped()) return;
      if (result.kind === "later") return;
      const waiting = view.waiting.filter((r) => r.runId !== next.runId);
      if (result.kind === "done") {
        set({ ...view, waiting, saved: [result.run, ...view.saved.filter((r) => r.id !== result.run.id)], sent: view.sent + 1 });
      } else {
        set({ ...view, waiting, refused: [...view.refused, { runId: next.runId, name: next.name, message: result.message, run: next }] });
      }
      await write();
    }
  };

  return {
    start: async () => {
      if (fileRead) return;
      reading ??= (async () => {
        try {
          const text = await store.read();
          const read = text === null ? { waiting: [], refused: [] } : readRunFile(text);
          // Runs added before the file was read stay, and are not added twice.
          const ids = new Set(view.waiting.map((r) => r.runId));
          set({ ...view, waiting: [...read.waiting.filter((r) => !ids.has(r.runId)), ...view.waiting], refused: read.refused });
          fileRead = true;
          if (view.unsaved) await write();
        } finally {
          reading = null;
        }
      })();
      await reading;
    },
    view: () => view,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    add: async (run) => {
      if (!view.waiting.some((r) => r.runId === run.runId)) set({ ...view, waiting: [...view.waiting, run] });
      await write();
      return !view.unsaved;
    },
    send: async () => {
      if (!fileRead) return;
      if (sending !== null) return sending;
      sending = sendAll().finally(() => {
        sending = null;
      });
      return sending;
    },
    retryRefused: async (runId) => {
      const refused = view.refused.find((r) => r.runId === runId);
      if (refused?.run === undefined) return;
      set({ ...view, refused: view.refused.filter((r) => r.runId !== runId), waiting: [...view.waiting.filter((r) => r.runId !== runId), refused.run] });
      await write();
    },
    removeRefused: (runId) => {
      set({ ...view, refused: view.refused.filter((r) => r.runId !== runId) });
      void write();
    },
    stop: () => {
      life.stopped = true;
    },
  };
}
