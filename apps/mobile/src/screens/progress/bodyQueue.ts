import {
  BODY_OUTBOX_MOST,
  bodyMeasurementResponseSchema,
  bodyOutboxEntrySchema,
  bodyOutboxRefusedSchema,
  type BodyMeasurement,
  type BodyOutboxEntry,
  type BodyOutboxRefused,
  type WaitingBodyEntry,
} from "@app/shared";
import type { Answer, Shape } from "../../session/calls";
import type { Session } from "../../session/session";
import type { TextStore } from "../food/outbox";

// A body measurement is kept on the phone until the server has it (CLAUDE.md §4; ROADMAP Stage 5
// 35c-ii), as a meal is (food/outbox.ts). Each entry, and each removal, is written to the person's own
// file BEFORE anything is sent, and sent one at a time in the order made, so a removal always follows
// its entry's save. A save carries the entry's own id: sent twice, the server keeps one entry, and an
// entry removed there keeps its id, so a late save of it keeps nothing (0204). An entry removed before
// it was ever sent is dropped and never reaches the server.

export type BodySendResult = { kind: "done"; entry?: BodyMeasurement } | { kind: "later" } | { kind: "refused"; message: string };

export interface BodySender {
  save: (entry: WaitingBodyEntry) => Promise<BodySendResult>;
  remove: (id: string) => Promise<BodySendResult>;
}

export interface BodyOutboxView {
  /** Entries the server does not have yet, and is not to lose, oldest first. */
  waiting: WaitingBodyEntry[];
  /** Entries the server has just taken, as it keeps them, shown until a read of the list holds them. */
  landed: BodyMeasurement[];
  /** Entries removed here that a read of the list may still hold: hidden from it. */
  removing: ReadonlySet<string>;
  refused: BodyOutboxRefused[];
  /** Bumped each time the server took something, so the list is read again. */
  sent: number;
  /** The last write of the file failed: what waits is held in memory only, and written again. */
  unsaved: boolean;
}

export interface BodyOutbox {
  start: () => Promise<void>;
  view: () => BodyOutboxView;
  subscribe: (listener: () => void) => () => void;
  /** false: the file already holds as many as it may, and the entry is not kept. */
  add: (entry: Omit<WaitingBodyEntry, "tried">) => Promise<boolean>;
  remove: (id: string) => Promise<void>;
  send: () => Promise<void>;
  forget: (id: string) => void;
  /** A read of the list came back holding these ids: what landed is in it, what was removed is not. */
  settle: (ids: ReadonlySet<string>) => void;
  stop: () => void;
}

/** The entries and refusals a file holds, each read on its own; `whole` false when anything in it
 *  could not be read. */
export function readBodyFile(text: string): { entries: BodyOutboxEntry[]; refused: BodyOutboxRefused[]; whole: boolean } {
  let raw: unknown = null;
  try {
    raw = JSON.parse(text);
  } catch {
    return { entries: [], refused: [], whole: false };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { entries: [], refused: [], whole: false };
  const version: unknown = Reflect.get(raw, "version");
  const rawEntries: unknown = Reflect.get(raw, "entries");
  const rawRefused: unknown = Reflect.get(raw, "refused");
  const entryList: unknown[] = Array.isArray(rawEntries) ? rawEntries : [];
  const refusedList: unknown[] = Array.isArray(rawRefused) ? rawRefused : [];
  const entries = entryList.flatMap((e) => {
    const parsed = bodyOutboxEntrySchema.safeParse(e);
    return parsed.success ? [parsed.data] : [];
  });
  const refused = refusedList.flatMap((r) => {
    const parsed = bodyOutboxRefusedSchema.safeParse(r);
    return parsed.success ? [parsed.data] : [];
  });
  const whole = version === 1 && Array.isArray(rawEntries) && Array.isArray(rawRefused) && entries.length === entryList.length && refused.length === refusedList.length;
  return { entries, refused, whole };
}

/** What a waiting entry's save sends. */
export function bodySaveBody(entry: WaitingBodyEntry): { id: string; measuredAt: string; weightKg?: number; metrics: Record<string, number> } {
  return { id: entry.id, measuredAt: entry.measuredAt, ...(entry.weightKg === null ? {} : { weightKg: entry.weightKg }), metrics: entry.metrics };
}

export function createBodyOutbox(store: TextStore, sender: BodySender): BodyOutbox {
  let entries: BodyOutboxEntry[] = [];
  let refused: BodyOutboxRefused[] = [];
  let landed: BodyMeasurement[] = [];
  let gone = new Set<string>();
  let sent = 0;
  let started = false;
  const flags = { stopped: false, again: false, unsaved: false };
  const stopped = (): boolean => flags.stopped;
  const askedAgain = (): boolean => flags.again;
  let running: Promise<void> | null = null;
  let saving: Promise<void> = Promise.resolve();
  let view: BodyOutboxView = makeView();
  const listeners = new Set<() => void>();

  function makeView(): BodyOutboxView {
    const removing = new Set<string>(gone);
    for (const e of entries) if (e.kind === "remove") removing.add(e.id);
    const waiting = entries.flatMap((e) => (e.kind === "save" && !removing.has(e.entry.id) ? [e.entry] : []));
    return { waiting, landed: landed.filter((l) => !removing.has(l.id)), removing, refused, sent, unsaved: flags.unsaved };
  }

  function changed() {
    view = makeView();
    for (const listener of listeners) listener();
  }

  /** One write at a time, each the whole list as it is now; none before the file is read, which
   *  would write over the entries it holds. A failed write is written again by the next. */
  function keep(): Promise<void> {
    if (!started) return saving;
    saving = saving.then(async () => {
      const text = JSON.stringify({ version: 1, entries, refused });
      let failed = false;
      try {
        await store.write(text);
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

  async function drain(): Promise<void> {
    if (flags.unsaved) await keep();
    for (;;) {
      const head = entries[0];
      if (head === undefined || stopped()) return;
      // Marked before the first wait: a removal made from here on is sent after this save.
      if (head.kind === "save" && !head.entry.tried) {
        head.entry.tried = true;
        await keep();
        if (stopped()) return;
      }
      const result = head.kind === "save" ? await sender.save(head.entry) : await sender.remove(head.id);
      if (stopped() || result.kind === "later") return;
      entries = entries.filter((e) => e !== head);
      // An entry the person removed meanwhile is not theirs to log again.
      const removedSince = head.kind === "save" && entries.some((e) => e.kind === "remove" && e.id === head.entry.id);
      if (result.kind === "refused" && head.kind === "save" && !removedSince) {
        refused = [...refused, { id: head.entry.id, message: result.message.slice(0, 500), measuredAt: head.entry.measuredAt, weightKg: head.entry.weightKg }];
      }
      if (result.kind === "done") {
        sent += 1;
        if (head.kind === "save" && result.entry !== undefined) landed = [...landed.filter((l) => l.id !== head.entry.id), result.entry];
        if (head.kind === "remove") gone = new Set([...gone, head.id]);
      }
      await keep();
      changed();
    }
  }

  function send(): Promise<void> {
    if (!started || stopped()) return Promise.resolve();
    if (running !== null) {
      flags.again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          flags.again = false;
          await drain();
        } while (askedAgain() && !stopped());
      } finally {
        running = null;
      }
    })();
    return running;
  }

  return {
    start: async () => {
      const text = await store.read();
      if (text !== null && text !== "") {
        const file = readBodyFile(text);
        if (!file.whole) await store.aside?.(text);
        entries = [...file.entries, ...entries];
        refused = [...file.refused, ...refused];
      }
      started = true;
      changed();
      await keep();
    },
    view: () => view,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    add: async (entry) => {
      if (entries.length >= BODY_OUTBOX_MOST) return false;
      entries = [...entries, { kind: "save", entry: { ...entry, tried: false } }];
      // The file is not read yet, so nothing can be written: held in memory only until it is.
      if (!started) flags.unsaved = true;
      changed();
      await keep();
      void send();
      return true;
    },
    remove: async (id) => {
      const at = entries.findIndex((e) => e.kind === "save" && e.entry.id === id);
      const save = entries[at];
      // Never sent: the server never heard of it. A removal is always kept, whatever the count.
      if (save?.kind === "save" && !save.entry.tried) entries = entries.filter((_, i) => i !== at);
      else if (!entries.some((e) => e.kind === "remove" && e.id === id)) entries = [...entries, { kind: "remove", id }];
      landed = landed.filter((l) => l.id !== id);
      changed();
      await keep();
      void send();
    },
    send,
    forget: (id) => {
      refused = refused.filter((r) => r.id !== id);
      changed();
      void keep();
    },
    settle: (ids) => {
      const kept = landed.filter((l) => !ids.has(l.id));
      const still = new Set([...gone].filter((id) => ids.has(id)));
      if (kept.length === landed.length && still.size === gone.size) return;
      landed = kept;
      gone = still;
      changed();
    },
    stop: () => {
      flags.stopped = true;
      listeners.clear();
    },
  };
}

/** DELETE answers 204 with no body. */
const nothing: Shape<null> = { safeParse: (raw) => (raw === null ? { success: true, data: null } : { success: false }) };

/** The server cannot take it now: a lost connection, a sign-in being renewed, too many at once, or a
 *  fault of its own. Anything else it refuses, it will refuse again. */
const now = (answer: Answer<unknown>): boolean =>
  answer.kind === "no_answer" || (answer.kind === "refused" && (answer.status === 401 || answer.status === 429 || answer.status >= 500));

export const BODY_REFUSED_WORDS = "These measurements couldn’t be saved. Log them again.";

export function bodySender(session: Session) {
  return {
    save: async (entry: WaitingBodyEntry): Promise<BodySendResult> => {
      const answer = await session.signedIn({ method: "POST", path: "/v1/nutrition/body-measurements", body: bodySaveBody(entry) }, bodyMeasurementResponseSchema);
      if (answer.kind === "ok") return { kind: "done", entry: answer.data.measurement };
      if (now(answer) || answer.kind !== "refused") return { kind: "later" };
      // Removed before this late save arrived: nothing is left to keep.
      if (answer.status === 404) return { kind: "done" };
      return { kind: "refused", message: BODY_REFUSED_WORDS };
    },
    remove: async (id: string): Promise<BodySendResult> => {
      const answer = await session.signedIn({ method: "DELETE", path: `/v1/nutrition/body-measurements/${id}` }, nothing);
      if (answer.kind === "ok") return { kind: "done" };
      // Already gone, or never there: nothing is left to remove.
      return now(answer) ? { kind: "later" } : { kind: "done" };
    },
  };
}
