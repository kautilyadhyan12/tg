// The words of a workout looked back on in History (ROADMAP Stage 5 64a-v): a day's workouts in the calendar and a
// workout's own page. Pure, so tested alone.
import type { PhoneLibraryEntry } from "@app/shared";

/** An exercise's name and kind (for its picture), from the Library kept on the phone. */
export type Named = (exercise: string) => { name: string; kind: string };

/** An exercise the Library on the phone does not hold, by its id word made readable: "barbell_curl" → "Barbell curl". */
export function idWords(id: string): string {
  const words = id.replace(/[_-]+/g, " ").trim();
  return words === "" ? id : `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/** Names from a Library copy: its own name and kind for an exercise it holds, a readable id word for one it does not. */
export function namedFrom(entries: readonly PhoneLibraryEntry[] | null): Named {
  const byId = new Map((entries ?? []).map((e) => [e.id, e]));
  return (exercise) => {
    const e = byId.get(exercise);
    return e === undefined ? { name: idWords(exercise), kind: "strength" } : { name: e.text.en.name, kind: e.kind };
  };
}

/** A workout's exercises in one line: "Squat", "Squat and Plank", "Bench Press, Barbell Curl and Plank", and past three
 *  "Bench Press, Barbell Curl and 2 more". */
export function exercisesLine(ids: readonly string[], named: Named): string {
  const names = ids.map((id) => named(id).name);
  if (names.length <= 1) return names[0] ?? "";
  if (names.length <= 3) return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
  return `${names.slice(0, 2).join(", ")} and ${String(names.length - 2)} more`;
}
