import { mealOutboxFileSchema, type Meal, type MealOutboxEntry, type WaitingMeal } from "@app/shared";

// What the person logs is kept on the phone until the server has it (CLAUDE.md §4; spec Part 6
// §16.3). Each meal, and each removal of one, is written to the phone's own file BEFORE anything is
// sent, and sent one at a time in the order it was made, so a removal always follows its meal's save.
// A save carries the meal's own id: sent twice, the server keeps one meal (32a). A meal removed
// before it was ever sent is simply dropped and never reaches the server; one that may have reached
// it (sent at least once) is removed there after its save, so a late save never brings it back.

/** Where the file lives: the phone's own, or a test's. */
export interface TextStore {
  read: () => Promise<string | null>;
  write: (text: string) => Promise<void>;
}

/** What became of one send. `later`: no answer, or the server cannot take it now; tried again.
 *  `refused`: the server will never take it, and says why. */
export type SendResult = { kind: "done"; meal?: Meal } | { kind: "later" } | { kind: "refused"; message: string };

export interface Sender {
  save: (meal: WaitingMeal) => Promise<SendResult>;
  remove: (id: string) => Promise<SendResult>;
}

/** A meal the server would not take, said once on the Food screen. */
export interface Refused {
  id: string;
  name: string;
  message: string;
}

export interface OutboxView {
  /** Meals the server does not have yet, and is not to lose. */
  waiting: WaitingMeal[];
  /** Meals removed here whose removal the server has not had yet: hidden from the day. */
  removing: ReadonlySet<string>;
  refused: Refused[];
  /** Bumped each time the server took something, so the day is read again. */
  sent: number;
}

export interface Outbox {
  /** Reads the file; until it is read nothing is sent. */
  start: () => Promise<void>;
  view: () => OutboxView;
  subscribe: (listener: () => void) => () => void;
  add: (meal: WaitingMeal) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Sends what is waiting, in order, until the server cannot take more just now. */
  send: () => Promise<void>;
  forget: (id: string) => void;
  /** No more sends: the person signed out, or somebody else signed in. */
  stop: () => void;
}

export function createOutbox(store: TextStore, sender: Sender): Outbox {
  let entries: MealOutboxEntry[] = [];
  let refused: Refused[] = [];
  let sent = 0;
  let started = false;
  // Read through an object: a send that awaits sees a stop made meanwhile.
  const life = { stopped: false };
  const stopped = (): boolean => life.stopped;
  const askedAgain = (): boolean => asked.again;
  let running: Promise<void> | null = null;
  // Read through a function: a send asked for during a wait sets it.
  const asked = { again: false };
  let saving: Promise<void> = Promise.resolve();
  let view: OutboxView = makeView();
  const listeners = new Set<() => void>();

  function makeView(): OutboxView {
    const removing = new Set<string>();
    for (const e of entries) if (e.kind === "remove") removing.add(e.id);
    const waiting = entries.flatMap((e) => (e.kind === "save" && !removing.has(e.meal.id) ? [e.meal] : []));
    return { waiting, removing, refused, sent };
  }

  function changed() {
    view = makeView();
    for (const listener of listeners) listener();
  }

  /** One write at a time, in order, each the whole list as it is now. None before the file is read,
   *  which would write over the meals it holds. */
  function keep(): Promise<void> {
    if (!started) return saving;
    const text = JSON.stringify({ version: 1, entries });
    saving = saving.then(() => store.write(text));
    return saving;
  }

  /** Sends from the head of the list until it is empty or the server cannot take the next. */
  async function drain(): Promise<void> {
    for (;;) {
      const head = entries[0];
      if (head === undefined || stopped()) return;
      // Marked before the first wait: a removal made from here on is sent after this save.
      if (head.kind === "save" && !head.meal.tried) {
        head.meal.tried = true;
        await keep();
      }
      const result = head.kind === "save" ? await sender.save(head.meal) : await sender.remove(head.id);
      if (stopped() || result.kind === "later") return;
      entries = entries.filter((e) => e !== head);
      if (result.kind === "refused" && head.kind === "save") {
        refused = [...refused, { id: head.meal.id, name: head.meal.body.mealName, message: result.message }];
      }
      if (result.kind === "done") sent += 1;
      await keep();
      changed();
    }
  }

  /** One run at a time; a send asked for during a run waits for it, and the run goes round again. */
  function send(): Promise<void> {
    if (!started || stopped()) return Promise.resolve();
    if (running !== null) {
      asked.again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          asked.again = false;
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
      if (text !== null) {
        let raw: unknown = null;
        try {
          raw = JSON.parse(text);
        } catch {
          raw = null;
        }
        const parsed = mealOutboxFileSchema.safeParse(raw);
        // Entries made before the file was read go after the ones it held.
        if (parsed.success) entries = [...parsed.data.entries, ...entries];
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
    add: async (meal) => {
      entries = [...entries, { kind: "save", meal: { ...meal, tried: false } }];
      changed();
      await keep();
      void send();
    },
    remove: async (id) => {
      const at = entries.findIndex((e) => e.kind === "save" && e.meal.id === id);
      const save = entries[at];
      // Never sent: the server never heard of it.
      const unsent = save?.kind === "save" && !save.meal.tried;
      entries = unsent ? entries.filter((_, i) => i !== at) : [...entries, { kind: "remove", id }];
      changed();
      await keep();
      void send();
    },
    send,
    forget: (id) => {
      refused = refused.filter((r) => r.id !== id);
      changed();
    },
    stop: () => {
      life.stopped = true;
      listeners.clear();
    },
  };
}
