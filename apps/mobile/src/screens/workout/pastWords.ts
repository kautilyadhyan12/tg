// The words of a workout looked back on in History (ROADMAP Stage 5 64a-v): a day's workouts in the calendar and a
// workout's own page. Pure, so tested alone.
import type { PhoneLibraryEntry } from "@app/shared";

/** An exercise's own picture (62a) and clip (62b), as the Library on the phone holds them. */
type OwnPicture = PhoneLibraryEntry["picture"];
type OwnClip = PhoneLibraryEntry["clip"];

/** An exercise's name, kind, own picture and clip, from the Library kept on the phone. */
export type Named = (exercise: string) => { name: string; kind: string; picture: OwnPicture; clip: OwnClip };

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
    return e === undefined ? { name: idWords(exercise), kind: "strength", picture: null, clip: null } : { name: e.text.en.name, kind: e.kind, picture: e.picture, clip: e.clip };
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

/** The one naming rule of History (64a-v, round one L2), for a day's rows and a workout's page alike: the server's Library
 *  name first (it knows an exercise since removed from the phone's copy), then the phone's copy, then the id word. */
export function serverFirst(named: Named, serverNames: ReadonlyMap<string, string | null>): Named {
  return (exercise) => {
    const own = named(exercise);
    return { ...own, name: serverNames.get(exercise) ?? own.name };
  };
}
