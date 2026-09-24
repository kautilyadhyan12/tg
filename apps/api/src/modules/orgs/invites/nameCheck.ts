// "Check this is them" (RULINGS 2026-09-23, gap A): does the name somebody signed up
// with plausibly belong to the person the gym's list holds at that address? A gym that
// mistyped a member's address has invited a stranger, and the stranger's own name is
// the one clue staff get.
//
// The structural rule, not a word list: the name with fewer parts must be found, part
// by part, in the other. A part is found when it is the same word, the start of it (at
// least three letters: "Rob" in "Robert"), or its initial ("J." for "Jimenez"), and at
// least one part must be a whole word or its start, never initials alone. Order is
// ignored (family name first or last), as are case, accents and punctuation. Shown
// beside both names, it can only ever ASK staff to look: a nickname ("Maew" for
// Thaksin), another script or a first name alone that a stranger shares is not caught,
// which is why staff always see both names.

export type NameCheck = "matches" | "differs";

/** Letters the Unicode decomposition does not fold to plain Latin. */
const FOLDS: Readonly<Record<string, string>> = {
  ð: "d",
  đ: "d",
  þ: "th",
  æ: "ae",
  œ: "oe",
  ø: "o",
  ł: "l",
  ß: "ss",
  ı: "i",
};

/** The parts of a name: lower case, accents off, split on anything not a letter or a
 *  digit ("Smith-Jones" and "al-Jamil" are two parts). */
export function nameParts(name: string): string[] {
  const folded = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[ðđþæœøłßı]/g, (ch) => FOLDS[ch] ?? ch);
  return folded.split(/[^\p{L}\p{N}]+/u).filter((part) => part.length > 0);
}

/** How well two parts match, best first: the same word, one the start of the other,
 *  one the other's initial; null when they do not. */
function partRank(a: string, b: string): 0 | 1 | 2 | null {
  if (a === b) return 0;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (!long.startsWith(short)) return null;
  if (short.length === 1) return 2;
  return short.length >= 3 ? 1 : null;
}

/** Does the signed-up name plausibly name the person on the gym's list? */
export function checkName(listName: string, accountName: string): NameCheck {
  const list = nameParts(listName);
  const account = nameParts(accountName);
  if (list.length === 0 || account.length === 0) return "differs";
  const [fewer, more] = account.length <= list.length ? [account, list] : [list, account];
  // Each part takes the best free part of the other name, the closest pairs first, so
  // an initial never takes the word another part is the same as.
  const pairs = fewer
    .flatMap((part, i) => more.flatMap((other, j) => {
      const rank = partRank(part, other);
      return rank === null ? [] : [{ i, j, rank }];
    }))
    .sort((x, y) => x.rank - y.rank);
  const pairedFewer = new Set<number>();
  const pairedMore = new Set<number>();
  let wholeWord = false;
  for (const pair of pairs) {
    if (pairedFewer.has(pair.i) || pairedMore.has(pair.j)) continue;
    pairedFewer.add(pair.i);
    pairedMore.add(pair.j);
    if (pair.rank < 2) wholeWord = true;
  }
  return pairedFewer.size === fewer.length && wholeWord ? "matches" : "differs";
}
