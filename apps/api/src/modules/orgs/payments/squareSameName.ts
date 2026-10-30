// Whether a customer in Square is a record here, by the name (ROADMAP 18d-iii-b-ii-b-ii-a): what following Square's merges
// reads, so a merge of two people is never followed. The rest of the rule Members in Square used went with it
// (18d-iii-b-v, 18d-iii-b-iv-f not built, Kd, 2026-10-30).
//
// "The same name": the same first given name on both sides (after a comma or a slash where the family name
// comes first, "Shah, Priya", a card's "LEE/AMY L"; a title such as Dr or Mrs before it passed over), then
// the words of the shorter name each one of the longer's, at least two of them (or both one word, the same),
// and no generation word (Jr, Sr, III) on one side only. "LEE/AMY L" and "Amy L. Lee" are Amy Lee; "Amy"
// alone, "A Lee", "Bob" for Robert and "Pat Smith" for Sam Smith are not; "John Smith" is not "John Smith
// Jr"; and "Jane Smith" is not "Emma Jane Smith", a daughter given her mother's name as a middle name (round
// one, Critical 1). A customer with no given name has no name.
//
// Pure: the same names in give the same answer out.
import { nameParts } from "../invites/nameCheck.js";

/** Generation words: "John Smith" and "John Smith Jr" are two people, father and son. */
const GENERATIONS = new Set(["jr", "sr", "ii", "iii", "iv", "junior", "senior"]);
/** Titles before a name, passed over: "Dr Amy Lee" is Amy Lee. */
const TITLES = new Set(["mr", "mrs", "ms", "miss", "mx", "dr", "prof"]);

/** A name's words, its first given name first: what follows a comma or a slash comes first ("Shah, Priya",
 *  "LEE/AMY L"), and a title before it is passed over. */
function givenFirst(text: string): string[] {
  const at = text.search(/[,/]/);
  const words = at < 0 ? nameParts(text) : [...nameParts(text.slice(at + 1)), ...nameParts(text.slice(0, at))];
  while (words.length > 0 && TITLES.has(words[0] ?? "")) words.shift();
  return words;
}

/** The same name, as above. */
export function sameNameForSquare(squareName: { givenName: string | null; familyName: string | null }, recordName: string): boolean {
  const given = givenFirst(squareName.givenName ?? "");
  if (given.length === 0) return false;
  const square = [...given, ...nameParts(squareName.familyName ?? "")];
  const record = givenFirst(recordName);
  if (record.length === 0 || square[0] !== record[0]) return false;
  const generation = (words: readonly string[]) => words.filter((w) => GENERATIONS.has(w)).sort().join(" ");
  if (generation(square) !== generation(record)) return false;
  const [shorter, longer] = square.length <= record.length ? [square, record] : [record, square];
  if (shorter.length < 2 && longer.length !== 1) return false;
  const free = [...longer];
  for (const word of shorter) {
    const at = free.indexOf(word);
    if (at < 0) return false;
    free.splice(at, 1);
  }
  return true;
}

/** After Square merged customers into `merged` (ROADMAP 18d-iii-b-ii-b-ii-a): of the records here linked to any of
 *  them, the one that keeps the merged customer, and the rest, separated from it. Only a record whose name is the
 *  merged customer's keeps it, and only where it is the one such record: a merge of two people (Sam, added on his
 *  mum's email, merged into "Pat Smith") is never followed, and two records of one person both lose it, as a
 *  customer two records could be is left out above. Square keeps the older customer's details in a merge ("The
 *  merge operation prioritizes older data", Square's forum, 2025), so the name says whose it now is; its reference
 *  id is one of the old customers' and says nothing. */
export function followMerged(
  records: readonly { entryId: string; fullName: string }[],
  merged: { givenName: string | null; familyName: string | null },
): { keep: string | null; separate: string[] } {
  const same = records.filter((r) => sameNameForSquare(merged, r.fullName));
  const keep = same.length === 1 ? (same[0]?.entryId ?? null) : null;
  return { keep, separate: records.filter((r) => r.entryId !== keep).map((r) => r.entryId) };
}
