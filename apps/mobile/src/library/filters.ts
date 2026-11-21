// Find exercises (job 63b, spec Part 2 §13.6): the Library narrowed by muscle, equipment, level, how it is counted
// and kind, each choice with its count. Pure, and tested as a table: a choice's count is always exactly what the
// list then shows.
import { EXERCISE_EQUIPMENT, EXERCISE_KINDS, EXERCISE_LEVELS, type PhoneLibraryEntry } from "@app/shared";
import { DEEP_UNDER, type Lit } from "./figure";
import { COUNTED_TODAY, type CountedBy } from "./words";

/** The five groups of choices. Two choices in one group mean either; choices in different groups mean both. */
export type FilterGroup = "muscle" | "equipment" | "level" | "counted" | "kind";
export type Filters = Readonly<Record<FilterGroup, readonly string[]>>;

export const NO_FILTERS: Filters = { muscle: [], equipment: [], level: [], counted: [], kind: [] };
export const FILTER_GROUPS: readonly FilterGroup[] = ["muscle", "equipment", "level", "counted", "kind"];

/** The equipment choice for an exercise that needs none. Never a word of the list: a word is at least one letter. */
export const NO_EQUIPMENT = "";

/** The muscle a person taps is that exact muscle (Kd at 63b's click-through: *"taping a muscle selcts whole area"*):
 *  the vastus lateralis, not the whole quadriceps. A deep muscle belongs to the drawn one over it (the deep core to
 *  the abs), since it cannot be tapped itself. */
export function drawnMuscle(muscle: string): string {
  return DEEP_UNDER[muscle] ?? muscle;
}

/** The picked muscles, lit on the figure. */
export function pickedShapes(filters: Filters): Map<string, Lit> {
  return new Map(filters.muscle.map((m): [string, Lit] => [m, "main"]));
}

/** Whether an exercise lists a muscle as one it mainly works ("Primary") or also works ("Secondary"). */
export function roleOf(entry: PhoneLibraryEntry, muscle: string): "Primary" | "Secondary" {
  return entry.muscles.main.some((m) => drawnMuscle(m) === muscle) ? "Primary" : "Secondary";
}

/** How an exercise is counted (§13.3). Until exercise folder 1's 52a publishes camera data, every one by hand. */
export function countedBy(entry: PhoneLibraryEntry): CountedBy {
  void entry;
  return COUNTED_TODAY;
}

/** The values an exercise has in one group. Muscles are those it works (main and also), never the steadying row,
 *  as search reads them: a squat is not an "Abs" exercise. */
export function valuesOf(entry: PhoneLibraryEntry, group: FilterGroup): string[] {
  switch (group) {
    case "muscle":
      return [...new Set([...entry.muscles.main, ...entry.muscles.also].map(drawnMuscle))];
    case "equipment":
      return entry.equipment.length === 0 ? [NO_EQUIPMENT] : [...entry.equipment];
    case "level":
      return [entry.level];
    case "counted":
      return [countedBy(entry)];
    case "kind":
      return [entry.kind];
  }
}

/** Whether an exercise passes every group's choices, leaving out `skip`'s. */
function passes(entry: PhoneLibraryEntry, filters: Filters, skip?: FilterGroup): boolean {
  return FILTER_GROUPS.every((g) => {
    const picked = filters[g];
    if (g === skip || picked.length === 0) return true;
    const has = valuesOf(entry, g);
    return picked.some((p) => has.includes(p));
  });
}

export function applyFilters(list: readonly PhoneLibraryEntry[], filters: Filters): PhoneLibraryEntry[] {
  return list.filter((e) => passes(e, filters));
}

/** The exercises that have this choice, with every other group's choices kept and this group's other choices set
 *  aside, as a filter count is in any shop's. With no other choice on in its group, it is the list the choice gives. */
export function countWith(list: readonly PhoneLibraryEntry[], filters: Filters, group: FilterGroup, value: string): number {
  return list.filter((e) => passes(e, filters, group) && valuesOf(e, group).includes(value)).length;
}

/** The choices a group offers: the values the Library holds, and every choice already on (`picked`) even where the
 *  list no longer holds it (a search took it away), so it is seen and can be let go. In the word list's order, then any
 *  word this phone does not know, A to Z. No equipment comes first. Muscles by their words, A to Z. */
export function choicesOf(list: readonly PhoneLibraryEntry[], group: FilterGroup, picked: readonly string[] = []): string[] {
  const present = new Set([...list.flatMap((e) => valuesOf(e, group)), ...picked]);
  const order: readonly string[] =
    group === "equipment" ? [NO_EQUIPMENT, ...EXERCISE_EQUIPMENT] : group === "level" ? EXERCISE_LEVELS : group === "kind" ? EXERCISE_KINDS : group === "counted" ? ["camera_coaches", "camera_counts", "hand"] : [];
  const known = order.filter((v) => present.has(v));
  const rest = [...present].filter((v) => !order.includes(v)).sort((a, b) => a.localeCompare(b, "en"));
  return [...known, ...rest];
}

/** Picks a choice, or lets it go if it was picked. */
export function toggle(filters: Filters, group: FilterGroup, value: string): Filters {
  const now = filters[group];
  return { ...filters, [group]: now.includes(value) ? now.filter((v) => v !== value) : [...now, value] };
}

/** How many choices are picked, for the filter button's badge. */
export function pickedCount(filters: Filters): number {
  return FILTER_GROUPS.reduce((n, g) => n + filters[g].length, 0);
}
