import {
  MEAL_OUTBOX_MOST,
  mealOutboxEntrySchema,
  mealOutboxRefusedSchema,
  type Meal,
  type MealOutboxEntry,
  type MealOutboxRefused,
  type WaitingChange,
  type WaitingMeal,
} from "@app/shared";

// What the person logs is kept on the phone until the server has it (CLAUDE.md §4; spec Part 6
// §16.3). Each meal, and each removal of one, is written to the phone's own file BEFORE anything is
// sent, and sent one at a time in the order it was made, so a removal always follows its meal's save.
// A save carries the meal's own id: sent twice, the server keeps one meal (32a), and a meal removed
// there keeps its id, so a late save of it keeps nothing (0169). A meal removed before it was ever
// sent is simply dropped and never reaches the server.
// A change to a saved meal (32b-ii-a) is kept the same way, after the meal's save, and carries an id
// of its own: sent twice, the server makes it once (0172).

/** Where the file lives: the phone's own, or a test's. `aside` keeps a copy of a file that could not
 *  all be read, before it is written over. */
export interface TextStore {
  read: () => Promise<string | null>;
  write: (text: string) => Promise<void>;
  aside?: (text: string) => Promise<void>;
}

/** What became of one send. `later`: no answer, or the server cannot take it now; tried again.
 *  `refused`: the server will never take it, and says why. */
export type SendResult = { kind: "done"; meal?: Meal } | { kind: "later" } | { kind: "refused"; message: string };

export interface Sender {
  save: (meal: WaitingMeal) => Promise<SendResult>;
  remove: (id: string) => Promise<SendResult>;
  change: (change: WaitingChange) => Promise<SendResult>;
}


/** A meal the server would not take, said on the Food screen until the person presses OK. */
export type Refused = MealOutboxRefused;

export interface OutboxView {
  /** Meals the server does not have yet, and is not to lose. */
  waiting: WaitingMeal[];
  /** Meals the server has just taken, as it keeps them, shown until a read of the day holds them. */
  landed: Meal[];
  /** Meals removed here that a read of the day may still hold: hidden from the day. */
  removing: ReadonlySet<string>;
  /** Changes to saved meals the server does not have yet, each meal's in the order made. */
  changing: ReadonlyMap<string, readonly WaitingChange[]>;
  refused: Refused[];
  /** Bumped each time the server took something, so the day is read again. */
  sent: number;
  /** The last write of the file failed: what waits is held in memory only, and written again. */
  unsaved: boolean;
}

export interface Outbox {
  /** Reads the file; until it is read nothing is written or sent. */
  start: () => Promise<void>;
  view: () => OutboxView;
  subscribe: (listener: () => void) => () => void;
  /** false: the file already holds as many as it may, and the meal is not kept. */
  add: (meal: WaitingMeal) => Promise<boolean>;
  remove: (id: string) => Promise<void>;
  /** A change to a meal, kept after everything waiting, so after the meal's own save. false: the file
   *  already holds as many as it may, and the change is not kept. */
  change: (change: WaitingChange) => Promise<boolean>;
  /** Sends what is waiting, in order, until the server cannot take more just now. */
  send: () => Promise<void>;
  forget: (id: string) => void;
  /** A read of the day that began when `sent` was `upTo` has come back: what landed or was removed by
   *  then is in it, and no longer needs holding. */
  settle: (upTo: number) => void;
  /** No more sends: the person signed out, or somebody else signed in. */
  stop: () => void;
}

/** The entries and refusals a file holds, each read on its own; `whole` false when anything in it
 *  could not be read. */
export function readOutboxFile(text: string): { entries: MealOutboxEntry[]; refused: Refused[]; whole: boolean } {
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
    const parsed = mealOutboxEntrySchema.safeParse(e);
    return parsed.success ? [parsed.data] : [];
  });
  const refused = refusedList.flatMap((r) => {
    const parsed = mealOutboxRefusedSchema.safeParse(r);
    return parsed.success ? [parsed.data] : [];
  });
  const whole =
    version === 1 &&
    Array.isArray(rawEntries) &&
    (rawRefused === undefined || Array.isArray(rawRefused)) &&
    entries.length === entryList.length &&
    refused.length === refusedList.length;
  return { entries, refused, whole };
}

export function createOutbox(store: TextStore, sender: Sender): Outbox {
  let entries: MealOutboxEntry[] = [];
  let refused: Refused[] = [];
  let landed: { seq: number; meal: Meal }[] = [];
  let gone: { seq: number; id: string }[] = [];
  let sent = 0;
  let started = false;
  // Read through objects and functions: a send that awaits sees what changed meanwhile.
  const flags = { stopped: false, again: false, unsaved: false };
  const stopped = (): boolean => flags.stopped;
  const askedAgain = (): boolean => flags.again;
  const unsaved = (): boolean => flags.unsaved;
  let running: Promise<void> | null = null;
  let saving: Promise<void> = Promise.resolve();
  let view: OutboxView = makeView();
  const listeners = new Set<() => void>();

  function makeView(): OutboxView {
    const removing = new Set<string>(gone.map((g) => g.id));
    for (const e of entries) if (e.kind === "remove") removing.add(e.id);
    const waiting = entries.flatMap((e) => (e.kind === "save" && !removing.has(e.meal.id) ? [e.meal] : []));
    const shown = landed.filter((l) => !removing.has(l.meal.id)).map((l) => l.meal);
    const changing = new Map<string, WaitingChange[]>();
    for (const e of entries) {
      if (e.kind !== "change" || removing.has(e.change.id)) continue;
      changing.set(e.change.id, [...(changing.get(e.change.id) ?? []), e.change]);
    }
    return { waiting, landed: shown, removing, changing, refused, sent, unsaved: flags.unsaved };
  }

  function changed() {
    view = makeView();
    for (const listener of listeners) listener();
  }

  /** One write at a time, in order, each the whole list as it is now. A failed write never ends the
   *  writing: the next one writes everything again. None before the file is read, which would write
   *  over the meals it holds. */
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

  /** Sends from the head of the list until it is empty or the server cannot take the next. */
  async function drain(): Promise<void> {
    if (unsaved()) await keep();
    for (;;) {
      const head = entries[0];
      if (head === undefined || stopped()) return;
      // Marked before the first wait: a removal made from here on is sent after this save.
      const sending = head.kind === "save" ? head.meal : head.kind === "change" ? head.change : null;
      if (sending !== null && !sending.tried) {
        sending.tried = true;
        await keep();
        if (stopped()) return;
      }
      const result =
        head.kind === "save" ? await sender.save(head.meal) : head.kind === "change" ? await sender.change(head.change) : await sender.remove(head.id);
      if (stopped() || result.kind === "later") return;
      entries = entries.filter((e) => e !== head);
      if (result.kind === "refused" && head.kind === "save") {
        refused = [...refused, { id: head.meal.id, name: head.meal.body.mealName.slice(0, 200), message: result.message.slice(0, 500) }];
      }
      if (result.kind === "refused" && head.kind === "change") {
        // Said as "Your change to Oats wasn't saved." on the Food screen.
        refused = [...refused, { id: head.change.body.changeId, name: `Your change to ${head.change.name}`.slice(0, 200), message: result.message.slice(0, 500) }];
      }
      if (result.kind === "done") {
        sent += 1;
        if (head.kind !== "remove" && result.meal !== undefined) landed = [...landed, { seq: sent, meal: result.meal }];
        if (head.kind === "remove") gone = [...gone, { seq: sent, id: head.id }];
      }
      await keep();
      changed();
    }
  }

  /** One run at a time; a send asked for during a run waits for it, and the run goes round again. */
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
        const file = readOutboxFile(text);
        // A file not all read is kept aside before it is written over.
        if (!file.whole) await store.aside?.(text);
        // Entries made before the file was read go after the ones it held.
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
    add: async (meal) => {
      if (entries.length >= MEAL_OUTBOX_MOST) return false;
      entries = [...entries, { kind: "save", meal: { ...meal, tried: false } }];
      changed();
      await keep();
      void send();
      return true;
    },
    remove: async (id) => {
      const at = entries.findIndex((e) => e.kind === "save" && e.meal.id === id);
      const save = entries[at];
      // Never sent: the server never heard of it. A removal is always kept, whatever the count.
      if (save?.kind === "save" && !save.meal.tried) entries = entries.filter((_, i) => i !== at);
      else entries = [...entries, { kind: "remove", id }];
      // Its changes not yet sent change nothing now.
      entries = entries.filter((e) => e.kind !== "change" || e.change.id !== id || e.change.tried);
      changed();
      await keep();
      void send();
    },
    change: async (change) => {
      if (entries.length >= MEAL_OUTBOX_MOST) return false;
      entries = [...entries, { kind: "change", change: { ...change, tried: false } }];
      changed();
      await keep();
      void send();
      return true;
    },
    send,
    forget: (id) => {
      refused = refused.filter((r) => r.id !== id);
      changed();
      void keep();
    },
    settle: (upTo) => {
      const before = landed.length + gone.length;
      landed = landed.filter((l) => l.seq > upTo);
      gone = gone.filter((g) => g.seq > upTo);
      if (landed.length + gone.length !== before) changed();
    },
    stop: () => {
      flags.stopped = true;
      listeners.clear();
    },
  };
}
