// THE BAD-WORDS CHECK (spec Part 3 §15.3; ROADMAP 19b-ii-b). A member's post that holds one
// of these words is not posted: the app tells its writer which word, at once, and nothing
// is sent to the gym's staff (Kd, RULINGS 2026-10-05). English only.
//
// A word list catches the words it knows and nothing else: an unkind post in ordinary
// words ("ugly loser") goes straight through, and Report is what answers it. The list is
// the `obscenity` package's English set, plus the slurs and explicit words below that it
// lacks, found by running it over an outside list (`test/fixtures/bad-words/README.md`).
import { DataSet, RegExpMatcher, englishDataset, englishRecommendedTransformers, parseRawPattern } from "obscenity";

/** Whole words and phrases only, so "spice" and "among" are not held. */
const EXTRA_WORDS = [
  // Slurs about race, nationality, sexuality or disability.
  "beaner", "beaners", "coon", "coons", "darkie", "darkies", "honkey", "jigaboo", "jiggaboo", "jiggerboo", "paki", "pakis", "pikey", "pikeys",
  "raghead", "ragheads", "slanteye", "spic", "spics", "towelhead", "towelheads", "wetback", "wetbacks", "mong", "poof", "poofter",
  "shemale", "carpet muncher", "carpetmuncher", "fudge packer", "fudgepacker", "neonazi", "white power",
  // Telling somebody to hurt themselves.
  "kys", "kill yourself", "kill urself", "hang yourself",
  // Insults and explicit words.
  "tosser", "camwhore", "blow job", "blowjob", "hand job", "handjob", "rimjob", "footjob", "gang bang", "gangbang", "circlejerk",
  "jack off", "jerk off", "jizz", "splooge", "milf", "clit", "boner", "horny", "nsfw", "bukkake", "creampie", "cunnilingus",
  "masturbate", "masturbating", "masturbation", "pedophile", "paedophile", "pedo", "paedo", "jailbait", "jail bait", "daterape",
  "raping", "rapist", "dry hump", "threesome", "upskirt", "titty", "titties", "butthole", "schlong", "queef", "sodomy", "sodomize",
  "phuck", "phucking", "poontang", "punany", "nympho", "bdsm", "quim", "pedobear",
] as const;

/** The matcher reads a run of one letter as one ("fuuuck"), keeping two of these six. A
 *  listed word is written the same way, or its own double letter would never match. */
const KEPT_DOUBLE = "beolsg";
const collapsed = (word: string): string => word.replace(/(.)\1+/g, (_run, letter: string) => (KEPT_DOUBLE.includes(letter) ? letter + letter : letter));

/** Ordinary words and names that hold a listed word inside them. */
const EXTRA_ALLOWED = ["cockpit", "shiitake", "dick's sporting", "dicks sporting", "spotted dick", "pussy willow", "pussycat", "moby dick", "penistone"] as const;

function build(): { matcher: RegExpMatcher; dataset: DataSet<{ originalWord: string }> } {
  const dataset = new DataSet<{ originalWord: string }>().addAll(englishDataset);
  for (const word of EXTRA_WORDS) {
    dataset.addPhrase((phrase) => phrase.setMetadata({ originalWord: word }).addPattern(parseRawPattern(`|${collapsed(word)}|`)));
  }
  dataset.addPhrase((phrase) => {
    let next = phrase.setMetadata({ originalWord: "allowed" });
    for (const term of EXTRA_ALLOWED) next = next.addWhitelistedTerm(term);
    return next;
  });
  return { matcher: new RegExpMatcher({ ...dataset.build(), ...englishRecommendedTransformers }), dataset };
}

const { matcher, dataset } = build();

/** Whether a post's words hold a listed word. */
export function hasBadWords(text: string): boolean {
  return matcher.hasMatch(text);
}

/** The most words one refusal names. */
export const BAD_WORDS_SHOWN = 5;

/** The listed words a post holds, each once, in the order they come: what its writer
 *  is told. Empty when it holds none. */
export function badWordsIn(text: string): string[] {
  const found: string[] = [];
  for (const match of matcher.getAllMatches(text, true)) {
    const word = dataset.getPayloadWithPhraseMetadata(match).phraseMetadata?.originalWord;
    if (word !== undefined && !found.includes(word)) found.push(word);
    if (found.length === BAD_WORDS_SHOWN) break;
  }
  return found;
}
