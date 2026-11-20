import { exerciseIdSchema, PLANNED_WORKOUT_LIMITS } from "@app/shared";

// My Workout (ROADMAP Stage 5 63c): the exercises a person added from the Library, in the order they added them, no
// repeats, kept on this phone in a file of their own (`my-workout-<id>.json`) so it is there with no internet and is
// removed with their account (`forgetPersonFiles`). One store for each person, so the tab's count and every page's
// Add to workout read the same list. Doing the workout comes with job 64a.

/** As many as a saved workout holds. */
export const MY_WORKOUT_MOST = PLANNED_WORKOUT_LIMITS.exercisesMost;

export interface ListFile {
  read: () => Promise<string | null>;
  write: (text: string) => Promise<void>;
}

/** The file's name names its owner: never one shared by two people. */
export function myWorkoutFileName(userId: string): string {
  if (userId === "") throw new Error("My Workout is kept only for somebody signed in");
  return `my-workout-${userId}.json`;
}

/** A kept list as text, read leniently: what cannot be read is left out, never a reason to lose the rest. */
export function readList(text: string | null): string[] {
  if (text === null) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  const ids: unknown[] = typeof raw === "object" && raw !== null && "ids" in raw && Array.isArray(raw.ids) ? raw.ids : [];
  const out: string[] = [];
  for (const id of ids) {
    const ok = exerciseIdSchema.safeParse(id);
    if (ok.success && !out.includes(ok.data) && out.length < MY_WORKOUT_MOST) out.push(ok.data);
  }
  return out;
}

/** Added at the end, once; a full list is left as it is. */
export function added(list: readonly string[], id: string): readonly string[] {
  return list.includes(id) || list.length >= MY_WORKOUT_MOST ? list : [...list, id];
}

export function removed(list: readonly string[], id: string): readonly string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : list;
}

export interface MyWorkoutStore {
  /** Read from the phone once; until then the list is empty. */
  ready: Promise<void>;
  list: () => readonly string[];
  add: (id: string) => void;
  remove: (id: string) => void;
  /** Told after each change; returns the way to stop. */
  watch: (told: () => void) => () => void;
}

function makeStore(file: ListFile): MyWorkoutStore {
  let list: readonly string[] = [];
  let changedBeforeRead = false;
  const watchers = new Set<() => void>();
  // Writes go one after another, so the file always ends as the newest list.
  let writing: Promise<void> = Promise.resolve();
  const tell = () => {
    for (const w of [...watchers]) w();
  };
  const change = (next: readonly string[]) => {
    if (next === list) return;
    list = next;
    changedBeforeRead = true;
    const text = JSON.stringify({ v: 1, ids: next });
    writing = writing.then(() => file.write(text)).catch(() => undefined);
    tell();
  };
  const ready = file
    .read()
    .catch(() => null)
    .then((text) => {
      // A press made before the phone answered is kept over what the file held.
      if (changedBeforeRead) return;
      list = readList(text);
      tell();
    });
  return {
    ready,
    list: () => list,
    add: (id) => {
      change(added(list, id));
    },
    remove: (id) => {
      change(removed(list, id));
    },
    watch: (told) => {
      watchers.add(told);
      return () => {
        watchers.delete(told);
      };
    },
  };
}

const stores = new Map<string, MyWorkoutStore>();

/** The one store of this person on this phone; `file` is used the first time only. */
export function storeFor(userId: string, file: ListFile): MyWorkoutStore {
  const kept = stores.get(userId);
  if (kept !== undefined) return kept;
  const made = makeStore(file);
  stores.set(userId, made);
  return made;
}

/** Every store let go: the app closed, in a test; or a person's account deleted. */
export function forgetStores(userId?: string): void {
  if (userId === undefined) stores.clear();
  else stores.delete(userId);
}
