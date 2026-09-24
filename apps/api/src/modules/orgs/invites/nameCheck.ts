// "Check this is them" (RULINGS 2026-09-23, gap A): does the name somebody signed up
// with plausibly belong to the person the gym's list holds at that address? A gym that
// mistyped a member's address has invited a stranger, and the stranger's own name is
// the one clue staff get. A wrong "differs" only asks staff to look; a wrong "matches"
// hides a stranger, so every doubt answers "differs".
//
// The structural rules, not a word list:
// - A name the account was given from its own address (an email-code sign-up starts as
//   the part before the @) is no name at all: a mistyped address is usually built from
//   the member's own name, so it would read as theirs.
// - Every part of the signed-up name must be found in the list's name, each in a part
//   of its own: the same word, a shortening of it of three letters or more ("Rob" for
//   "Robert", never "Shahani" for "Shah"), or an initial ("J." for "Jimenez", or the
//   list's "V." for "Velikkakathu").
// - At least two of the list's parts (its only part, if it has one) must be matched by
//   whole words or shortenings, one of them the same word: a first name alone, or
//   initials, name nobody.
// Order, case, accents and punctuation are ignored; an apostrophe joins a name
// ("O'Neill"). A nickname, another script, a middle name the list lacks or a first name
// alone are asked about, which is why staff always see both names.

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

/** The parts of a name: lower case, accents off, apostrophes joining, split on anything
 *  else that is not a letter or a digit ("Smith-Jones" and "al-Jamil" are two parts). */
export function nameParts(name: string): string[] {
  const folded = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[ðđþæœøłßı]/g, (ch) => FOLDS[ch] ?? ch)
    .replace(/['’ʼ`]/g, "");
  return folded.split(/[^\p{L}\p{N}]+/u).filter((part) => part.length > 0);
}

/** How a signed-up part stands for a list part, best first: the same word, a shortening
 *  of it, an initial either way; null when it does not. */
function partRank(signed: string, listed: string): 0 | 1 | 2 | null {
  if (signed === listed) return 0;
  if (signed.length === 1 && listed.startsWith(signed)) return 2;
  if (listed.length === 1 && signed.startsWith(listed)) return 2;
  if (signed.length >= 3 && listed.startsWith(signed)) return 1;
  return null;
}

/** Does the signed-up name plausibly name the person on the gym's list?
 *  `madeFromAddress` is the name the account was given from its own address. */
export function checkName(listName: string, accountName: string, madeFromAddress: string | null = null): NameCheck {
  if (madeFromAddress !== null && accountName.trim().toLowerCase() === madeFromAddress.trim().toLowerCase()) return "differs";
  const list = nameParts(listName);
  const account = nameParts(accountName);
  if (list.length === 0 || account.length === 0) return "differs";
  // Each signed-up part takes the best free list part, the closest pairs first, so an
  // initial never takes the word another part is the same as.
  const pairs = account
    .flatMap((part, i) =>
      list.flatMap((other, j) => {
        const rank = partRank(part, other);
        return rank === null ? [] : [{ i, j, rank }];
      }),
    )
    .sort((x, y) => x.rank - y.rank);
  const pairedAccount = new Set<number>();
  const pairedList = new Set<number>();
  let words = 0;
  let same = 0;
  for (const pair of pairs) {
    if (pairedAccount.has(pair.i) || pairedList.has(pair.j)) continue;
    pairedAccount.add(pair.i);
    pairedList.add(pair.j);
    if (pair.rank < 2) words += 1;
    if (pair.rank === 0) same += 1;
  }
  const allFound = pairedAccount.size === account.length;
  return allFound && same >= 1 && words >= Math.min(2, list.length) ? "matches" : "differs";
}
