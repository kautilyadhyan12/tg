// Searching the Library on the phone (spec Part 2 §13.6): it reads names, other names, muscles and
// equipment, with name matches first. Pure, and tested as a table of every class of match.
import { EXERCISE_MUSCLE_LABELS, type PhoneLibraryEntry } from "@app/shared";
import { equipmentWord, kindWord, muscleLabel } from "./words";

/** Lower case, accents and marks off, every run of other characters one space: "Press-up" → "press up". */
export function normalise(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const squash = (s: string): string => s.replace(/ /g, "");

/** The words of the muscles' plain names ("biceps", "quadriceps", "glutes"). A search made only of these
 *  is read against plain names alone: "biceps" is the arm's, never the hamstring's anatomical "biceps femoris"
 *  (which a search for "biceps femoris" or "femoris" still finds). */
const PLAIN_MUSCLE_WORDS: readonly string[] = [...new Set(Object.values(EXERCISE_MUSCLE_LABELS).flatMap((l) => normalise(l.name).split(" ")))];

/** How well one name matches, best first; null for none.
 *  0 the whole name · 1 the name starts with it · 2 every word of the search starts a word of the name ·
 *  3 the name holds it, spaces and marks aside ("pushup" in "Incline Push-up"). Spaces and marks aside, the
 *  whole name is still 0 and its start still 1: "pushup" is Push-up's own name. */
function nameTier(name: string, query: string, words: readonly string[]): number | null {
  const n = normalise(name);
  if (n === query || squash(n) === squash(query)) return 0;
  if (n.startsWith(query) || squash(n).startsWith(squash(query))) return 1;
  const nameWords = n.split(" ");
  if (words.every((w) => nameWords.some((nw) => nw.startsWith(w)))) return 2;
  if (squash(n).includes(squash(query))) return 3;
  return null;
}

/** Ranks the exercises for a search: the exercise's own name (tiers 0 to 3), then another of its names
 *  (4 to 7), then the muscles it works (main and also), its equipment or kind (8, every word of the search found there). Within a tier,
 *  A to Z. An empty search is every exercise A to Z. */
export function searchExercises(list: readonly PhoneLibraryEntry[], search: string): PhoneLibraryEntry[] {
  const query = normalise(search);
  const byName = (a: PhoneLibraryEntry, b: PhoneLibraryEntry) => a.text.en.name.localeCompare(b.text.en.name, "en");
  if (query === "") return [...list].sort(byName);
  const words = query.split(" ");
  const plainMuscle = words.every((w) => PLAIN_MUSCLE_WORDS.some((p) => p.startsWith(w)));
  const ranked: { entry: PhoneLibraryEntry; tier: number }[] = [];
  for (const entry of list) {
    const own = nameTier(entry.text.en.name, query, words);
    const other = entry.text.en.otherNames.map((o) => nameTier(o, query, words)).filter((t): t is number => t !== null);
    let tier: number | null = own ?? (other.length > 0 ? 4 + Math.min(...other) : null);
    if (tier === null) {
      const about = [
        // The muscles it works; the ones that only keep the body steady would put a squat under "abs".
        ...[...entry.muscles.main, ...entry.muscles.also].flatMap((m) => {
          const { name, detail } = muscleLabel(m);
          return plainMuscle ? [name] : [name, detail ?? ""];
        }),
        ...entry.equipment.map(equipmentWord),
        kindWord(entry.kind),
      ]
        .map(normalise)
        .join(" ")
        .split(" ");
      if (words.every((w) => about.some((a) => a.startsWith(w)))) tier = 8;
    }
    if (tier !== null) ranked.push({ entry, tier });
  }
  return ranked.sort((a, b) => a.tier - b.tier || byName(a.entry, b.entry)).map((r) => r.entry);
}
