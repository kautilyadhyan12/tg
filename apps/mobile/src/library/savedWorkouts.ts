import {
  keptSavedEntrySchema,
  keptSavedFrameSchema,
  PLANNED_WORKOUT_LIMITS,
  refusedSavedChangeSchema,
  SAVED_EDITED_AHEAD,
  savedChangeSchema,
  savedEditedAheadSchema,
  savedWorkoutListSchema,
  savedWorkoutSchema,
  savedWorkoutWrittenSchema,
  type KeptSavedEntry,
  type PhoneLibraryEntry,
  type PlannedExercise,
  type RefusedSavedChange,
  type SavedBase,
  type SavedChange,
  type SavedWorkoutList,
} from "@app/shared";
import type { Answer, Request, Shape } from "../session/calls";
import { createWaitingList, type SendAnswer } from "../session/waitingList";
import type { TextStore } from "../screens/food/outbox";
import { plannedOf, type MyWorkout, type Plan } from "./myWorkout";
import { planOf } from "./workoutSetup";

// A person's saved workouts on the phone (ROADMAP Stage 5 64a-iv; spec Part 2 §13.5, job 61c's routes). Saved from My
// Workout, loaded back into it, deleted with a question first. The phone keeps its copy of the person's list (and the
// whole of each one it saved or loaded), so the list opens with no internet; each save and delete waits in the one shared
// waiting list, written to the phone before it is sent, sent in the order made, and taken out only once the server has
// answered. The server keeps the newest change of each by its `editedAt`, so a late send never undoes a newer one.

export const SAVED_PATH = "/v1/training/saved";
export const savedPath = (id: string): string => `${SAVED_PATH}/${encodeURIComponent(id)}`;
export const SAVED_MOST = PLANNED_WORKOUT_LIMITS.savedMost;
/** Saves and deletes that may wait on one phone for the server. */
export const CHANGES_WAITING_MOST = 200;
export const SAVE_REFUSED_WORDS = "This workout couldn't be saved.";
export const fullWords = (most: number): string => `You can keep ${String(most)} saved workouts. Delete one, then save this one again.`;

type SignedIn = <T>(request: Omit<Request, "token">, shape: Shape<T>) => Promise<Answer<T>>;

/** A 204's empty body. */
const NOTHING: Shape<null> = { safeParse: (raw) => (raw === null ? { success: true, data: null } : { success: false }) };

// ---- The rules, pure ----

/** My Workout as a saved workout would hold it: each exercise the Library still offers, with its sets as set up (the
 *  Library's starting numbers where the person changed none), the same list Start workout does. `left`: exercises no
 *  longer in the Library, which are not saved. */
export interface Planned {
  exercises: PlannedExercise[];
  left: string[];
  sets: number;
}

export function toPlanned(w: MyWorkout, liveOf: (id: string) => PhoneLibraryEntry | null): Planned {
  const exercises: PlannedExercise[] = [];
  const left: string[] = [];
  for (const item of w.items) {
    const entry = liveOf(item.id);
    const plan = entry === null ? null : planOf(item, entry);
    if (entry === null || plan === null) left.push(item.id);
    else exercises.push({ exercise: item.id, measuredIn: plan.measuredIn, sets: plan.sets.map((s) => ({ target: s.target, weightGrams: s.weightGrams, restSeconds: s.restSeconds })) });
  }
  return { exercises, left, sets: exercises.reduce((n, e) => n + e.sets.length, 0) };
}

const plain = (exercises: readonly PlannedExercise[]): string =>
  JSON.stringify(exercises.map((e) => [e.exercise, e.measuredIn, e.sets.map((s) => [s.target, s.weightGrams, s.restSeconds])]));

/** The same workout: the same name, as kept (trimmed), and the same exercises with the same sets in the same order. */
export function sameWorkout(aName: string, a: readonly PlannedExercise[], bName: string, b: readonly PlannedExercise[]): boolean {
  return aName.trim() === bName.trim() && plain(a) === plain(b);
}

/** One saved workout as the screen shows it; `onPhone`: a change to it is still waiting for the server. */
export type ShownSaved = KeptSavedEntry & { onPhone: boolean };

/** Where My Workout stands against the saved workout it holds (round one H1). `same`: it is exactly what it last loaded
 *  or saved, so nothing on this phone would be lost; `newer`: the account holds a later change of that saved workout,
 *  made on another device. Judged against what My Workout last loaded or saved, never against the list alone, so a
 *  change made elsewhere never reads as this phone's own. `startOf`: an exercise's starting numbers in the Library. */
export interface SavedState {
  linked: ShownSaved | null;
  same: boolean;
  newer: boolean;
}

export function savedState(w: MyWorkout, list: readonly ShownSaved[], startOf: (id: string) => Plan | null): SavedState {
  const linked = w.from === null ? null : (list.find((e) => e.id === w.from) ?? null);
  if (linked === null) return { linked: null, same: false, newer: false };
  // A file kept before round one has no base: the list's own copy stands in, as before.
  const base = w.base ?? (linked.whole === null ? null : { editedAt: linked.editedAt, name: linked.name, exercises: linked.whole });
  if (base === null) return { linked, same: false, newer: false };
  return {
    linked,
    same: sameWorkout(w.name, plannedOf(w, startOf), base.name, base.exercises),
    newer: Date.parse(linked.editedAt) > Date.parse(base.editedAt),
  };
}

/** My Workout's base moved to the time the account keeps for this phone's own change (re-check, L3): a save stamped again
 *  with the server's time (a phone whose clock runs fast) is kept at an earlier time than the phone stamped, so without
 *  this a later change from another device could still read as older than this phone's. Null where nothing moves: the
 *  change is still on its way, the account holds another change (its content differs), or the times already agree. */
export function rebased(w: MyWorkout, list: readonly ShownSaved[]): SavedBase | null {
  const linked = w.from === null ? null : list.find((e) => e.id === w.from);
  if (w.base === null || linked === undefined || linked === null || linked.onPhone || linked.whole === null) return null;
  if (!(Date.parse(linked.editedAt) < Date.parse(w.base.editedAt))) return null;
  return sameWorkout(linked.name, linked.whole, w.base.name, w.base.exercises) ? { ...w.base, editedAt: linked.editedAt } : null;
}

/** A saved workout as a save leaves it. */
export function entryOf(savedId: string, name: string, editedAt: string, exercises: readonly PlannedExercise[]): KeptSavedEntry {
  const ids: string[] = [];
  for (const e of exercises) if (!ids.includes(e.exercise)) ids.push(e.exercise);
  return { id: savedId, name, editedAt, exercises: ids, setsCount: exercises.reduce((n, e) => n + e.sets.length, 0), whole: [...exercises] };
}

/** The list the person sees: the phone's copy, with every change still waiting laid over it in the order made (a save
 *  takes its workout's place, a delete takes it out), the most recently changed first. */
export function shownList(entries: readonly KeptSavedEntry[], waiting: readonly SavedChange[]): ShownSaved[] {
  let list: ShownSaved[] = entries.map((e) => ({ ...e, onPhone: false }));
  for (const c of waiting) {
    list = list.filter((e) => e.id !== c.savedId);
    if (c.kind === "save") list.push({ ...entryOf(c.savedId, c.name, c.editedAt, c.exercises), onPhone: true });
  }
  return list.sort((x, y) => Date.parse(y.editedAt) - Date.parse(x.editedAt));
}

/** A change's time: the phone's clock, and always after the change the phone last heard of, so a phone whose clock is
 *  behind another's still saves over what that one saved. */
export function editedAtFor(now: number, held: string | null): string {
  const after = held === null ? Number.NaN : Date.parse(held) + 1;
  return new Date(Number.isNaN(after) ? now : Math.max(now, after)).toISOString();
}

/** The server's list taken into the phone's copy: its facts win; the whole of one is kept only where it is the same
 *  change (the same `editedAt`), so a workout changed on another phone is read again before it loads. One that cannot
 *  be read is left out. */
export function mergeList(kept: readonly KeptSavedEntry[], heard: SavedWorkoutList["savedWorkouts"]): KeptSavedEntry[] {
  return heard.flatMap((h) => {
    const old = kept.find((k) => k.id === h.id);
    const whole = old !== undefined && Date.parse(old.editedAt) === Date.parse(h.editedAt) ? old.whole : null;
    const ok = keptSavedEntrySchema.safeParse({ id: h.id, name: h.name, editedAt: h.editedAt, exercises: h.exercises, setsCount: h.setsCount, whole });
    return ok.success ? [ok.data] : [];
  });
}

/** What became of one save. Not now: no answer, a sign-in being renewed, too many at once, the server's own fault, an
 *  exercise it does not know (422, as for a workout), or a change made past its clock from a phone whose clock runs fast
 *  (`edited_ahead`): kept and sent again. Past the limit (409) it says so; anything else it will refuse again. */
export function readSaveRefusal(answer: Exclude<Answer<unknown>, { kind: "ok" }>, most: number): SendAnswer {
  if (answer.kind === "no_answer") return { kind: "later" };
  if (answer.status === 401 || answer.status === 422 || answer.status === 429 || answer.status >= 500) return { kind: "later" };
  if (answer.status === 400 && answer.error === SAVED_EDITED_AHEAD) return { kind: "later" };
  if (answer.status === 409) return { kind: "refused", message: fullWords(most) };
  return { kind: "refused", message: SAVE_REFUSED_WORDS };
}

// ---- The store ----

export interface SavedView {
  list: readonly ShownSaved[];
  most: number;
  /** The phone's copy has been read, or the server's list heard: until then the list is not known. */
  known: boolean;
  /** Saves the server would not take, with words for the person, until OK. */
  refused: readonly RefusedSavedChange[];
  /** The last try had no answer: what waits is on this phone only. */
  held: boolean;
}

export type Kept = "kept" | "held" | "lost";
export type WholeAnswer = { kind: "ok"; name: string; editedAt: string; exercises: readonly PlannedExercise[] } | { kind: "gone" } | { kind: "no_answer" };

export interface SavedStore {
  ready: Promise<void>;
  view: () => SavedView;
  watch: (told: () => void) => () => void;
  /** Asks the server for the person's list. */
  refresh: () => Promise<void>;
  /** A new saved workout (`savedId` null) or a change to one. "kept": in the waiting list's file; "held": its file could
   *  not be written, so it waits in memory and is written again; "lost": it is nowhere (the list is full). */
  save: (input: { savedId: string | null; name: string; exercises: readonly PlannedExercise[] }) => Promise<{ kept: Kept; savedId: string; editedAt: string }>;
  remove: (savedId: string) => Promise<Kept>;
  /** The whole of one, to load: from the phone where it holds this change, else read from the server. */
  whole: (savedId: string) => Promise<WholeAnswer>;
  send: (now?: boolean) => Promise<void>;
  dismiss: (changeId: string) => void;
  stop: () => void;
}

export interface SavedSetup {
  /** The phone's copy of the list. */
  copy: TextStore;
  /** The changes waiting for the server. */
  waiting: TextStore;
  signedIn: SignedIn;
  /** A new id from the phone's proper random source. */
  newId: () => string;
  clock?: () => number;
}

export function createSavedStore(setup: SavedSetup): SavedStore {
  const clock = setup.clock ?? Date.now;
  let entries: KeptSavedEntry[] = [];
  let most: number = SAVED_MOST;
  const flags = { copyRead: false, heard: false, stopped: false };
  // Moves on with every answer the copy takes, so a list asked for before it is never laid over what came after.
  let gen = 0;
  const listeners = new Set<() => void>();
  let writing: Promise<void> = Promise.resolve();
  const isStopped = (): boolean => flags.stopped;
  const genNow = (): number => gen;

  const keepCopy = () => {
    if (!flags.copyRead) return;
    const text = JSON.stringify({ v: 1, most, entries });
    writing = writing.then(() => setup.copy.write(text)).catch(() => undefined);
  };
  const upsert = (e: KeptSavedEntry) => {
    entries = [...entries.filter((x) => x.id !== e.id), e];
    gen += 1;
    keepCopy();
  };
  const drop = (id: string) => {
    entries = entries.filter((x) => x.id !== id);
    gen += 1;
    keepCopy();
  };

  async function send(c: SavedChange): Promise<SendAnswer> {
    if (c.kind === "delete") {
      const answer = await setup.signedIn({ method: "DELETE", path: savedPath(c.savedId) }, NOTHING);
      if (answer.kind === "no_answer") return { kind: "later" };
      if (answer.kind === "refused" && (answer.status === 401 || answer.status === 429 || answer.status >= 500)) return { kind: "later" };
      // 204, or 404 (none of theirs by that id): either way it is gone.
      drop(c.savedId);
      return { kind: "done" };
    }
    return sendSave(c, true);
  }

  /** `again`: a change answered edited_ahead is stamped with the server's own time (still after the change the phone
   *  last heard of) and sent once more at once, so a phone whose clock runs fast holds nothing back (round one L2). */
  async function sendSave(c: Extract<SavedChange, { kind: "save" }>, again: boolean): Promise<SendAnswer> {
    const answer = await setup.signedIn({ method: "PUT", path: savedPath(c.savedId), body: { name: c.name, editedAt: c.editedAt, exercises: c.exercises } }, savedWorkoutWrittenSchema);
    if (answer.kind !== "ok") {
      const ahead = answer.kind === "refused" && answer.error === SAVED_EDITED_AHEAD ? savedEditedAheadSchema.safeParse(answer.body) : null;
      if (again && ahead?.success === true) {
        const held = entries.find((e) => e.id === c.savedId)?.editedAt ?? null;
        return sendSave({ ...c, editedAt: editedAtFor(Date.parse(ahead.data.serverTime), held) }, false);
      }
      return readSaveRefusal(answer, most);
    }
    const said = answer.data;
    if (said.status === "removed") drop(c.savedId);
    else if (said.status === "unchanged" && (said.editedAt === null || Date.parse(said.editedAt) !== Date.parse(c.editedAt))) {
      // The server holds a newer change, made on another phone: read again.
      const old = entries.find((e) => e.id === c.savedId);
      if (old !== undefined) upsert({ ...old, whole: null });
      void refresh();
    } else upsert(entryOf(c.savedId, c.name, said.editedAt ?? c.editedAt, c.exercises));
    return { kind: "done" };
  }

  const waiting = createWaitingList<SavedChange, RefusedSavedChange>({
    store: setup.waiting,
    send,
    idOf: (c) => c.id,
    read: (raw) => {
      const ok = savedChangeSchema.safeParse(raw);
      return ok.success ? ok.data : null;
    },
    readRefused: (raw) => {
      const ok = refusedSavedChangeSchema.safeParse(raw);
      return ok.success ? ok.data : null;
    },
    refusedOf: (c, message) => ({ id: c.id, savedId: c.savedId, name: c.kind === "save" ? c.name : "", message }),
    refusedIdOf: (r) => r.id,
    most: CHANGES_WAITING_MOST,
    clock,
  });

  let view: SavedView = { list: [], most, known: false, refused: [], held: false };
  const changed = () => {
    const w = waiting.view();
    view = { list: shownList(entries, w.waiting), most, known: flags.copyRead || flags.heard, refused: w.refused, held: w.held };
    for (const l of [...listeners]) l();
  };
  waiting.subscribe(changed);

  async function readCopy(): Promise<void> {
    let text: string | null;
    try {
      text = await setup.copy.read();
    } catch {
      // Unread: the copy is not written over for the rest of this run, as it may still hold the list.
      return;
    }
    if (text !== null) {
      try {
        const frame = keptSavedFrameSchema.parse(JSON.parse(text));
        most = frame.most;
        entries = frame.entries.flatMap((raw) => {
          const ok = keptSavedEntrySchema.safeParse(raw);
          return ok.success ? [ok.data] : [];
        });
      } catch {
        entries = [];
      }
    }
    flags.copyRead = true;
  }

  const ready = Promise.all([readCopy(), waiting.start()]).then(() => {
    changed();
  });

  let refreshing: Promise<void> | null = null;
  function refresh(): Promise<void> {
    refreshing ??= (async () => {
      try {
        await ready;
        // A list asked for before an answer came is asked for again, a few times at most.
        for (let tries = 0; tries < 3; tries += 1) {
          const asked = genNow();
          const answer = await setup.signedIn({ method: "GET", path: SAVED_PATH }, savedWorkoutListSchema);
          if (isStopped() || answer.kind !== "ok") return;
          if (asked !== genNow()) continue;
          entries = mergeList(entries, answer.data.savedWorkouts);
          most = answer.data.most;
          flags.heard = true;
          keepCopy();
          changed();
          return;
        }
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  async function whole(savedId: string): Promise<WholeAnswer> {
    await ready;
    const shown = view.list.find((e) => e.id === savedId);
    if (shown !== undefined && shown.whole !== null) return { kind: "ok", name: shown.name, editedAt: shown.editedAt, exercises: shown.whole };
    const answer = await setup.signedIn({ method: "GET", path: savedPath(savedId) }, savedWorkoutSchema);
    if (answer.kind === "ok") {
      const got = answer.data;
      const ok = keptSavedEntrySchema.safeParse(entryOf(got.id, got.name, got.editedAt, got.exercises));
      if (ok.success && !isStopped()) {
        upsert(ok.data);
        changed();
      }
      return { kind: "ok", name: got.name, editedAt: got.editedAt, exercises: got.exercises };
    }
    if (answer.kind === "refused" && answer.status === 404) {
      if (!isStopped()) {
        drop(savedId);
        changed();
      }
      return { kind: "gone" };
    }
    return { kind: "no_answer" };
  }

  async function add(change: SavedChange): Promise<Kept> {
    const kept = await waiting.add(change);
    void waiting.send(true);
    if (kept) return "kept";
    return waiting.view().waiting.some((c) => c.id === change.id) ? "held" : "lost";
  }

  return {
    ready,
    view: () => view,
    watch: (told) => {
      listeners.add(told);
      return () => {
        listeners.delete(told);
      };
    },
    refresh,
    save: async ({ savedId, name, exercises }) => {
      await ready;
      const id = savedId ?? setup.newId();
      const held = view.list.find((e) => e.id === id)?.editedAt ?? null;
      const editedAt = editedAtFor(clock(), held);
      const ok = savedChangeSchema.safeParse({ id: setup.newId(), kind: "save", savedId: id, name, editedAt, exercises });
      if (!ok.success) return { kept: "lost", savedId: id, editedAt };
      return { kept: await add(ok.data), savedId: id, editedAt };
    },
    remove: async (savedId) => {
      await ready;
      return add({ id: setup.newId(), kind: "delete", savedId });
    },
    whole,
    send: (now) => waiting.send(now),
    dismiss: (changeId) => {
      waiting.dismiss(changeId);
    },
    stop: () => {
      flags.stopped = true;
      waiting.stop();
    },
  };
}
