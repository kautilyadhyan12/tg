// What the Library says about an exercise, worked out from its entry (job 63a). Pure: tested as tables.
import {
  EXERCISE_EQUIPMENT_LABELS,
  EXERCISE_KIND_LABELS,
  EXERCISE_LEVEL_LABELS,
  EXERCISE_MUSCLE_LABELS,
  type MuscleLabel,
  type PhoneLibraryEntry,
} from "@app/shared";

const has = <K extends string>(table: Readonly<Record<K, unknown>>, key: string): key is K => Object.prototype.hasOwnProperty.call(table, key);

/** A word the phone does not know yet, shown plainly (§13.1, principle 7): "gluteus_minimus" → "Gluteus minimus". */
export function plainWord(word: string): string {
  const spaced = word.replace(/_/g, " ").trim();
  return spaced === "" ? word : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export const kindWord = (kind: string): string => (has(EXERCISE_KIND_LABELS, kind) ? EXERCISE_KIND_LABELS[kind] : plainWord(kind));
export const levelWord = (level: string): string => (has(EXERCISE_LEVEL_LABELS, level) ? EXERCISE_LEVEL_LABELS[level] : plainWord(level));
export const equipmentWord = (item: string): string => (has(EXERCISE_EQUIPMENT_LABELS, item) ? EXERCISE_EQUIPMENT_LABELS[item] : plainWord(item));

export function muscleLabel(muscle: string): MuscleLabel {
  return has(EXERCISE_MUSCLE_LABELS, muscle) ? EXERCISE_MUSCLE_LABELS[muscle] : { name: plainWord(muscle), detail: null };
}

/** One row of muscles as a person reads it: the muscles that share a name joined under it, in the
 *  file's order. ["rectus_femoris", "vastus_lateralis", "glute_max"] →
 *  "Quadriceps (rectus femoris, vastus lateralis) · Glutes (gluteus maximus)". */
export function muscleLine(muscles: readonly string[]): string {
  const groups = new Map<string, string[]>();
  for (const m of muscles) {
    const { name, detail } = muscleLabel(m);
    const details = groups.get(name) ?? [];
    if (detail !== null && !details.includes(detail)) details.push(detail);
    groups.set(name, details);
  }
  return [...groups].map(([name, details]) => (details.length === 0 ? name : `${name} (${details.join(", ")})`)).join(" · ");
}

/** The plain names alone, for a card: "Quadriceps · Glutes". */
export function muscleNames(muscles: readonly string[]): string {
  return [...new Set(muscles.map((m) => muscleLabel(m).name))].join(" · ");
}

/** 1 to 3 plates on the bar; a level the phone does not know shows none lit. */
export function levelPlates(level: string): 0 | 1 | 2 | 3 {
  return level === "beginner" ? 1 : level === "intermediate" ? 2 : level === "advanced" ? 3 : 0;
}

export type Effort = "light" | "moderate" | "vigorous";

/** The Compendium's own intensity bands (Ainsworth et al., the Adult Compendium of Physical Activities):
 *  light under 3.0 METs, moderate 3.0 to 5.9, vigorous 6.0 and over. No MET, no effort. */
export function effortOf(met: number | null): Effort | null {
  if (met === null || !Number.isFinite(met) || met <= 0) return null;
  return met < 3 ? "light" : met < 6 ? "moderate" : "vigorous";
}

export const EFFORT_FLAMES: Readonly<Record<Effort, 1 | 2 | 3>> = { light: 1, moderate: 2, vigorous: 3 };
export const EFFORT_WORDS: Readonly<Record<Effort, string>> = { light: "Light intensity", moderate: "Moderate intensity", vigorous: "Vigorous intensity" };

/** A set's starting target: "3 × 12 reps", "3 × 30 s"; null when the phone cannot say it. */
export function targetLine(entry: PhoneLibraryEntry, short = true): string | null {
  const { measuredIn, start } = entry.set;
  if (measuredIn === "reps" && start.reps !== undefined) {
    return short ? `${String(start.sets)} × ${String(start.reps)} reps` : `${String(start.sets)} sets of ${String(start.reps)} reps`;
  }
  if (measuredIn === "time" && start.seconds !== undefined) {
    const t = start.seconds >= 60 && start.seconds % 60 === 0 ? `${String(start.seconds / 60)} min` : `${String(start.seconds)} s`;
    return short ? `${String(start.sets)} × ${t}` : `${String(start.sets)} sets of ${t}`;
  }
  return null;
}

/** What it needs, for the strip: "No equipment", "Barbell", "Barbell +1". */
export function equipmentLine(entry: PhoneLibraryEntry): string {
  const [first, ...rest] = entry.equipment;
  if (first === undefined) return "No equipment";
  return rest.length === 0 ? equipmentWord(first) : `${equipmentWord(first)} +${String(rest.length)}`;
}

/** How the exercise is counted (§13.3): read from exercise folder 1's camera data for it. Until its job 52a
 *  publishes that data (and settles its shape) no exercise has any, so every one is counted by hand or timer;
 *  the old three definitions never make an exercise camera-counted on the phone. The job that reads that data
 *  replaces COUNTED_TODAY with the reading. */
export type CountedBy = "camera_coaches" | "camera_counts" | "hand";
export const COUNTED_WORDS: Readonly<Record<CountedBy, string>> = {
  camera_coaches: "Camera counts and coaches",
  camera_counts: "Camera counts",
  hand: "Manual tracking",
};
export const COUNTED_TODAY: CountedBy = "hand";

/** A mistake's words as what goes wrong (its first sentence) and how to put it right (the rest). A sentence ends
 *  at a full stop followed by a space and a capital letter, so "e.g. " or "approx. " inside one never cuts it. */
export function splitMistake(says: string): { wrong: string; fix: string | null } {
  const end = /\. (?=[A-Z])/.exec(says);
  if (end === null) return { wrong: says, fix: null };
  return { wrong: says.slice(0, end.index + 1), fix: says.slice(end.index + 2) };
}
