// The parts of a name, for telling a household's people apart by their own names (§9.7;
// `memberList/samePerson.ts`). Nothing compares the name somebody gives the app with the
// gym's list any more (RULINGS 2026-09-28): the email on the list is the link, as in
// GymMaster, Gym Insight and Gymdesk, and a name proves nothing ("du" can be Daniel Wu).

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
