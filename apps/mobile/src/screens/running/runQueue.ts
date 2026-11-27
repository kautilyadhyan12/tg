// A saved run is kept on the phone until the server has it (CLAUDE.md §4; ROADMAP Stage 5 37a), as a
// meal or a body measurement is. It is written to the person's own file BEFORE it is sent, and sent
// with its own id as the Idempotency-Key: sent twice, the server keeps one run.
//
// One run the server cannot take never holds back the runs saved after it (37m): they are sent past it,
// and a run the server has failed for long enough is moved to the runs that couldn't be saved, with Try
// again and Remove. A file of waiting runs that cannot all be read is kept aside before it is written over,
// and a run in it the app can no longer read is shown as couldn't be saved, never dropped without a word.
import { refusedRunSchema, runOutboxFileSchema, saveRunRequestSchema, saveRunResponseSchema, type RefusedRun, type SaveRunRequest, type SavedRun } from "@app/shared";
import type { Answer, Shape } from "../../session/calls";
import type { Session } from "../../session/session";
import type { TextStore } from "../food/outbox";

/** `later`: nothing can go now (no answer, a sign-in being renewed, too many at once); tried again.
 *  `failed`: the server answered but could not take this run now; this run is tried again, and the runs
 *  after it are sent all the same.
 *  `kept`: the server has it (a 2xx is only answered once the run is stored) in words this copy of the app
 *  cannot read, as when a store build lags behind the server: let go, and lists of runs read again.
 *  `deleted`: the person deleted it, on this phone or another, while it waited to be sent (37c-i). */
export type RunSendResult = { kind: "done"; run: SavedRun } | { kind: "kept" } | { kind: "later" } | { kind: "failed" } | { kind: "refused"; message: string } | { kind: "deleted" };
export type RunSender = (run: SaveRunRequest) => Promise<RunSendResult>;

export type { RefusedRun };

export interface RunOutboxView {
  /** Runs the server does not have yet, oldest first. */
  waiting: SaveRunRequest[];
  /** Of those, the runs the server answered for and could not take: tried again soon. */
  failing: string[];
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

/** A run the server has failed this many times, over at least this long, is moved to the runs that
 *  couldn't be saved: a server down for a few minutes, or restarting, never moves one. Counted from the
 *  first failure since the app opened. */
export const RUN_FAILS_BEFORE_REFUSED = 5;
export const RUN_FAILING_MS = 10 * 60_000;

/** Nothing can go now: a lost connection, a sign-in being renewed or gone, or too many at once. */
const nothingGoes = (answer: Answer<unknown>): boolean =>
  answer.kind === "no_answer" || (answer.kind === "refused" && (answer.status === 401 || answer.status === 429));

/** The server answered and could not take it now: a timeout of its own (408, 425) or a fault of its own. */
const notNow = (answer: Answer<unknown>): boolean => answer.kind === "refused" && (answer.status === 408 || answer.status === 425 || answer.status >= 500);

/** Any reply, read here and not by the call: a reply that is not a saved run is told apart from no reply. */
const anyReply: Shape<unknown> = { safeParse: (raw) => ({ success: true, data: raw }) };

export function runSender(session: Session): RunSender {
  return async (run) => {
    const answer = await session.signedIn({ method: "POST", path: "/v1/geo/runs", body: run, key: run.runId, waitMs: 60_000 }, anyReply);
    if (answer.kind === "ok") {
      const saved = saveRunResponseSchema.safeParse(answer.data);
      return saved.success ? { kind: "done", run: saved.data.run } : { kind: "kept" };
    }
    if (nothingGoes(answer) || answer.kind !== "refused") return { kind: "later" };
    if (notNow(answer)) return { kind: "failed" };
    if (answer.status === 410) return { kind: "deleted" };
    // A shape the server would not read is the app's fault, never words for the person.
    return { kind: "refused", message: REFUSED_WORDS };
  };
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;

/** What a file holds, each run read on its own. A waiting run the app can no longer read is a run that
 *  couldn't be saved, kept whole for Remove; `whole` is false when anything in the file was not read. */
export function readRunFile(text: string): { waiting: SaveRunRequest[]; refused: RefusedRun[]; whole: boolean } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { waiting: [], refused: [], whole: false };
  }
  const read = runOutboxFileSchema.safeParse(raw);
  if (!read.success) return { waiting: [], refused: [], whole: false };
  const file = read.data;
  let whole = true;
  const waiting: SaveRunRequest[] = [];
  const unread: RefusedRun[] = [];
  for (const r of file.waiting) {
    const parsed = saveRunRequestSchema.safeParse(r);
    if (parsed.success) {
      waiting.push(parsed.data);
      continue;
    }
    whole = false;
    if (isRecord(r) && typeof r.runId === "string") unread.push({ runId: r.runId, name: typeof r.name === "string" ? r.name : "Run", message: REFUSED_WORDS, run: r });
  }
  const refused: RefusedRun[] = [];
  for (const r of file.refused) {
    const parsed = refusedRunSchema.safeParse(r);
    if (parsed.success) refused.push(parsed.data);
    else whole = false;
  }
  const ids = new Set(refused.map((r) => r.runId));
  return { waiting, refused: [...refused, ...unread.filter((r) => !ids.has(r.runId))], whole };
}

export function createRunOutbox(store: TextStore, send: RunSender, now: () => number = Date.now): RunOutbox {
  let view: RunOutboxView = { waiting: [], failing: [], saved: [], refused: [], sent: 0, unsaved: false };
  const listeners = new Set<() => void>();
  const life = { stopped: false };
  // Read through a function: the outbox may be stopped while a send is away.
  const isStopped = () => life.stopped;
  let sending: Promise<void> | null = null;
  // Until the file has been read, nothing is written over it: what it holds would be lost.
  let fileRead = false;
  let reading: Promise<void> | null = null;
  // Each failing run's failures since the app opened, and when the first was.
  const fails = new Map<string, { count: number; since: number }>();

  const set = (next: RunOutboxView) => {
    view = next;
    for (const l of listeners) l();
  };
  /** The view with `runId` no longer failing. */
  const notFailing = (runId: string): string[] => {
    fails.delete(runId);
    return view.failing.filter((id) => id !== runId);
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
    // Each run once a round, oldest first: one the server fails is passed, and the next is sent.
    const tried = new Set<string>();
    while (!life.stopped) {
      const next = view.waiting.find((r) => !tried.has(r.runId));
      if (next === undefined) return;
      tried.add(next.runId);
      const result = await send(next);
      if (isStopped()) return;
      if (result.kind === "later") {
        // Nothing can go now: every run's spell of failures ends, so only an unbroken spell counts and a time
        // with no signal between two short outages starts each count again.
        fails.clear();
        if (view.failing.length > 0) set({ ...view, failing: [] });
        return;
      }
      if (result.kind === "failed") {
        const was = fails.get(next.runId);
        const failed = { count: (was?.count ?? 0) + 1, since: was?.since ?? now() };
        if (failed.count < RUN_FAILS_BEFORE_REFUSED || now() - failed.since < RUN_FAILING_MS) {
          fails.set(next.runId, failed);
          if (!view.failing.includes(next.runId)) set({ ...view, failing: [...view.failing, next.runId] });
          continue;
        }
      }
      const waiting = view.waiting.filter((r) => r.runId !== next.runId);
      const failing = notFailing(next.runId);
      if (result.kind === "done") {
        set({ ...view, waiting, failing, saved: [result.run, ...view.saved.filter((r) => r.id !== result.run.id)], sent: view.sent + 1 });
      } else if (result.kind === "deleted" || result.kind === "kept") {
        // Deleted while it waited, or on the server in words the app cannot read: let go, never said to be
        // refused; lists of runs read again.
        set({ ...view, waiting, failing, saved: view.saved.filter((r) => r.id !== next.runId), sent: view.sent + 1 });
      } else {
        const message = result.kind === "refused" ? result.message : REFUSED_WORDS;
        set({ ...view, waiting, failing, refused: [...view.refused, { runId: next.runId, name: next.name, message, run: next }] });
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
          const read = text === null ? { waiting: [], refused: [], whole: true } : readRunFile(text);
          // A file not all read is kept aside before anything is written over it.
          if (!read.whole && text !== null) await store.aside?.(text);
          // Runs added before the file was read stay, and are not added twice.
          const ids = new Set(view.waiting.map((r) => r.runId));
          set({ ...view, waiting: [...read.waiting.filter((r) => !ids.has(r.runId)), ...view.waiting], refused: read.refused });
          fileRead = true;
          // A run the file held that the app could not read is written back as couldn't be saved.
          if (view.unsaved || !read.whole) await write();
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
      // Read only now: one the server could never take stays where it is, kept, for Remove.
      const run = saveRunRequestSchema.safeParse(refused?.run);
      if (!run.success) return;
      set({ ...view, refused: view.refused.filter((r) => r.runId !== runId), waiting: [...view.waiting.filter((r) => r.runId !== runId), run.data], failing: notFailing(runId) });
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
