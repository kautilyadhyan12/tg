import { exerciseIdSchema, keptSavedEntrySchema, PLANNED_WORKOUT_LIMITS, plannedExerciseSchema, savedBaseSchema, type PlannedExercise, type PlannedSet, type SavedBase } from "@app/shared";

// My Workout (ROADMAP Stage 5 63c, 64a-i): the workout a person is putting together from the Library. Its name and its
// exercises in order, no repeats, each with the sets the person set up (64a-i), kept on this phone in a file of their
// own (`my-workout-<id>.json`) so it is there with no internet and is removed with their account
// (`forgetPersonFiles`). One store for each person, so the tab's count and every page's Add to workout read the same
// list. It also names the saved workout it holds (64a-iv), loaded or saved, until Clear or another is loaded.

/** As many as a saved workout holds. */
export const MY_WORKOUT_MOST = PLANNED_WORKOUT_LIMITS.exercisesMost;
/** Sets of one exercise, as many as an exercise's file may start it with. */
export const SETS_MOST = 10;
export const NAME_MOST = PLANNED_WORKOUT_LIMITS.nameMost;

/** An exercise's sets, in the unit the list had when they were set up: reps, or seconds for one measured in time. */
export interface Plan {
  measuredIn: "reps" | "time";
  sets: readonly PlannedSet[];
}

/** One exercise of My Workout. `plan` is null until the person changes one of its numbers: until then it is the
 *  Library's own starting numbers for it, read as it is shown (`planOf`). */
export interface Item {
  id: string;
  plan: Plan | null;
}

export interface MyWorkout {
  /** As typed; empty until the person names it. */
  name: string;
  items: readonly Item[];
  /** The id of the person's saved workout it holds (64a-iv): the one it was loaded from or saved as; null for none. */
  from: string | null;
  /** That saved workout as My Workout last loaded or saved it; null for none (or a file kept before round one). */
  base: SavedBase | null;
}

export const EMPTY: MyWorkout = { name: "", items: [], from: null, base: null };

export interface ListFile {
  read: () => Promise<string | null>;
  write: (text: string) => Promise<void>;
}

/** The file's name names its owner: never one shared by two people. */
export function myWorkoutFileName(userId: string): string {
  if (userId === "") throw new Error("My Workout is kept only for somebody signed in");
  return `my-workout-${userId}.json`;
}

/** A plan read back, or set up: a saved workout's own rules for one exercise (`plannedExerciseSchema`), and at most
 *  `SETS_MOST` sets. */
function planFrom(id: string, raw: unknown): Plan | null {
  if (typeof raw !== "object" || raw === null) return null;
  const ok = plannedExerciseSchema.safeParse({ ...raw, exercise: id });
  if (!ok.success || ok.data.sets.length > SETS_MOST) return null;
  return { measuredIn: ok.data.measuredIn, sets: ok.data.sets };
}

/** A name as it may be kept: no NUL, at most 60 characters. */
export const nameOf = (text: string): string => text.replace(/\u0000/g, "").slice(0, NAME_MOST);

/** A kept workout as text, read leniently: what cannot be read is left out, never a reason to lose the rest. The list
 *  63c kept (`{ v: 1, ids }`) is read too, each exercise on the Library's starting numbers, so nobody's list is lost
 *  when the app is updated; a plan that cannot be read leaves its exercise on those numbers. */
export function readWorkout(text: string | null): MyWorkout {
  if (text === null) return EMPTY;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return EMPTY;
  }
  if (typeof raw !== "object" || raw === null) return EMPTY;
  const entries: unknown[] = "items" in raw && Array.isArray(raw.items) ? raw.items : "ids" in raw && Array.isArray(raw.ids) ? raw.ids : [];
  const items: Item[] = [];
  for (const one of entries) {
    const idRaw = typeof one === "object" && one !== null && "id" in one ? one.id : one;
    const id = exerciseIdSchema.safeParse(idRaw);
    if (!id.success || items.some((i) => i.id === id.data) || items.length >= MY_WORKOUT_MOST) continue;
    const planRaw = typeof one === "object" && one !== null && "plan" in one ? one.plan : null;
    items.push({ id: id.data, plan: planFrom(id.data, planRaw) });
  }
  const name = "name" in raw && typeof raw.name === "string" ? nameOf(raw.name) : "";
  const from = "from" in raw ? keptSavedEntrySchema.shape.id.safeParse(raw.from) : null;
  const base = "base" in raw ? savedBaseSchema.safeParse(raw.base) : null;
  const linkedTo = from?.success === true ? from.data : null;
  return { name, items, from: linkedTo, base: linkedTo !== null && base?.success === true ? base.data : null };
}

/** My Workout's exercises with their sets as a saved workout holds them, each one it holds, the Library's starting
 *  numbers where none were changed; one with neither is left out. */
export function plannedOf(w: MyWorkout, startOf: (id: string) => Plan | null): PlannedExercise[] {
  return w.items.flatMap((i) => {
    const plan = i.plan ?? startOf(i.id);
    return plan === null ? [] : [{ exercise: i.id, measuredIn: plan.measuredIn, sets: plan.sets.map((s) => ({ target: s.target, weightGrams: s.weightGrams, restSeconds: s.restSeconds })) }];
  });
}

/** A saved workout as My Workout holds it (64a-iv): its name, and each exercise once with its sets, its first
 *  `SETS_MOST`; an exercise twice keeps its first place (My Workout holds an exercise once), and one past the most
 *  My Workout holds is left out. */
export function fromSaved(savedId: string, name: string, exercises: readonly PlannedExercise[], editedAt: string): MyWorkout {
  const items: Item[] = [];
  for (const e of exercises) {
    if (items.some((i) => i.id === e.exercise) || items.length >= MY_WORKOUT_MOST) continue;
    items.push({ id: e.exercise, plan: planFrom(e.exercise, { measuredIn: e.measuredIn, sets: e.sets.slice(0, SETS_MOST) }) });
  }
  const w: MyWorkout = { name: nameOf(name), items, from: savedId, base: null };
  const base = savedBaseSchema.safeParse({ editedAt, name: w.name, exercises: plannedOf(w, () => null) });
  return { ...w, base: base.success ? base.data : null };
}

/** The exercises' ids, in order. */
export const idsOf = (w: MyWorkout): string[] => w.items.map((i) => i.id);

/** Added at the end, once, on the Library's starting numbers; a full list is left as it is. */
export function added(w: MyWorkout, id: string): MyWorkout {
  return w.items.some((i) => i.id === id) || w.items.length >= MY_WORKOUT_MOST ? w : { ...w, items: [...w.items, { id, plan: null }] };
}

export function removed(w: MyWorkout, id: string): MyWorkout {
  return w.items.some((i) => i.id === id) ? { ...w, items: w.items.filter((i) => i.id !== id) } : w;
}

/** Moved one place up (-1) or down (1); at the top or the foot it stays. */
export function moved(w: MyWorkout, id: string, by: -1 | 1): MyWorkout {
  const at = w.items.findIndex((i) => i.id === id);
  const to = at + by;
  const a = w.items[at];
  const b = w.items[to];
  if (a === undefined || b === undefined) return w;
  const items = [...w.items];
  items[at] = b;
  items[to] = a;
  return { ...w, items };
}

/** An exercise's sets as the person set them; a plan that breaks the rules is not taken. */
export function planned(w: MyWorkout, id: string, plan: Plan): MyWorkout {
  const ok = planFrom(id, plan);
  if (ok === null || !w.items.some((i) => i.id === id)) return w;
  return { ...w, items: w.items.map((i) => (i.id === id ? { id, plan: ok } : i)) };
}

export const renamed = (w: MyWorkout, name: string): MyWorkout => (nameOf(name) === w.name ? w : { ...w, name: nameOf(name) });

/** Every exercise out; the name kept. It no longer holds a saved workout. */
export const cleared = (w: MyWorkout): MyWorkout => (w.items.length === 0 && w.from === null ? w : { ...w, items: [], from: null, base: null });

/** Which saved workout it holds, and as what: the one just saved, or none after that one was deleted. */
export function linked(w: MyWorkout, from: string | null, base: SavedBase | null): MyWorkout {
  if (from === null) return w.from === null && w.base === null ? w : { ...w, from: null, base: null };
  const ok = base === null ? null : savedBaseSchema.safeParse(base);
  return { ...w, from, base: ok?.success === true ? ok.data : null };
}

export interface MyWorkoutStore {
  /** Read from the phone once; until then the workout is empty. */
  ready: Promise<void>;
  workout: () => MyWorkout;
  /** The exercises' ids, in order: the same array until they change. */
  list: () => readonly string[];
  add: (id: string) => void;
  remove: (id: string) => void;
  move: (id: string, by: -1 | 1) => void;
  plan: (id: string, plan: Plan) => void;
  rename: (name: string) => void;
  clear: () => void;
  /** Takes the place of the whole workout: a saved workout loaded (64a-iv). */
  load: (w: MyWorkout) => void;
  link: (from: string | null, base: SavedBase | null) => void;
  /** Told after each change; returns the way to stop. */
  watch: (told: () => void) => () => void;
}

type Step =
  | { add: string }
  | { remove: string }
  | { move: string; by: -1 | 1 }
  | { plan: string; to: Plan }
  | { rename: string }
  | { clear: true }
  | { load: MyWorkout }
  | { link: string | null; base: SavedBase | null };

function take(w: MyWorkout, step: Step): MyWorkout {
  if ("add" in step) return added(w, step.add);
  if ("remove" in step) return removed(w, step.remove);
  if ("move" in step) return moved(w, step.move, step.by);
  if ("plan" in step) return planned(w, step.plan, step.to);
  if ("rename" in step) return renamed(w, step.rename);
  if ("load" in step) return step.load;
  if ("link" in step) return linked(w, step.link, step.base);
  return cleared(w);
}

function makeStore(file: ListFile): MyWorkoutStore {
  let workout: MyWorkout = EMPTY;
  let ids: readonly string[] = [];
  // Presses made before the file was read are kept as steps and made again on the workout it held, so a press never
  // writes over the saved one. A read that failed writes nothing for the rest of this run: the file may still hold it.
  let read: "waiting" | "done" | "failed" = "waiting";
  const early: Step[] = [];
  const watchers = new Set<() => void>();
  // Writes go one after another, so the file always ends as the newest workout.
  let writing: Promise<void> = Promise.resolve();
  const set = (next: MyWorkout) => {
    workout = next;
    const nextIds = idsOf(next);
    if (nextIds.length !== ids.length || nextIds.some((id, i) => id !== ids[i])) ids = nextIds;
  };
  const tell = () => {
    for (const w of [...watchers]) w();
  };
  const write = () => {
    if (read !== "done") return;
    const text = JSON.stringify({ v: 2, name: workout.name, items: workout.items, from: workout.from, base: workout.base });
    writing = writing.then(() => file.write(text)).catch(() => undefined);
  };
  const step = (s: Step) => {
    // Before the read every step is kept, even one that changes nothing yet: removing a saved exercise.
    if (read === "waiting") early.push(s);
    const next = take(workout, s);
    if (next === workout) return;
    set(next);
    write();
    tell();
  };
  const ready = file.read().then(
    (text) => {
      set(early.reduce(take, readWorkout(text)));
      read = "done";
      if (early.length > 0) write();
      tell();
    },
    () => {
      read = "failed";
    },
  );
  return {
    ready,
    workout: () => workout,
    list: () => ids,
    add: (id) => {
      step({ add: id });
    },
    remove: (id) => {
      step({ remove: id });
    },
    move: (id, by) => {
      step({ move: id, by });
    },
    plan: (id, to) => {
      step({ plan: id, to });
    },
    rename: (name) => {
      step({ rename: name });
    },
    clear: () => {
      step({ clear: true });
    },
    load: (w) => {
      step({ load: w });
    },
    link: (from, base) => {
      step({ link: from, base });
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
