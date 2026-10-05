// THE BAD-WORDS CHECK (spec Part 3 §15.3; ROADMAP 19b-ii-b). A member's post that holds one
// of these words is not posted: the app tells its writer which word, at once, and nothing
// is sent to the gym's staff (Kd, RULINGS 2026-10-05). English only.
//
// A word list catches the words it knows and nothing else: an unkind post in ordinary
// words ("ugly loser") goes straight through, and Report is what answers it. The list is
// the `obscenity` package's English set, plus the slurs and explicit words below that it
// lacks, found by running it over an outside list (`test/fixtures/bad-words/README.md`).
import { DataSet, RegExpMatcher, englishDataset, englishRecommendedTransformers, parseRawPattern } from "obscenity";

/** Whole words and phrases only, so "spice" and "among" are not refused. */
const EXTRA_WORDS = [
  // Slurs about race, nationality, sexuality or disability.
  "beaner", "beaners", "coon", "coons", "darkie", "darkies", "honkey", "jigaboo", "jiggaboo", "jiggerboo", "paki", "pakis", "pikey", "pikeys",
  "raghead", "ragheads", "slanteye", "spic", "spics", "towelhead", "towelheads", "wetback", "wetbacks", "mong", "poof", "poofter",
  "shemale", "carpet muncher", "carpetmuncher", "fudge packer", "fudgepacker", "neonazi", "white power",
  // Telling somebody to hurt themselves.
  "kys", "kill yourself", "kill urself", "hang yourself",
  // Insults.
  "tosser", "tossers", "camwhore", "phuck", "phucking",
  // Sexual words and phrases. Not here on purpose, because a gym says them every day:
  // hard, hump, snatch, butt, strap on, spread legs, nipple, suck, hardcore, squirt, kink.
  "jack off", "jerk off", "jerking off", "jacking off", "milf", "milfs", "clit", "clitoris", "boner", "boners", "hardon", "erection",
  "erections", "horny", "nsfw", "bukkake", "cunnilingus", "anilingus", "masturbation", "pedophile", "paedophile", "pedo", "paedo",
  "pedobear", "jailbait", "jail bait", "barely legal", "daterape", "raping", "rapist", "dry hump", "dry humping", "humping", "threesome",
  "upskirt", "titty", "titties", "butthole", "schlong", "sodomy", "poontang", "punany", "quim", "nympho", "bdsm", "bondage", "dominatrix",
  "femdom", "pegging", "strapon", "gooning", "gooned", "cumming", "cumshot", "cumshots", "doggy style", "doggystyle", "doggie style",
  "missionary position", "golden shower", "wet dream", "booty call", "camel toe", "foot fetish", "fetish", "fetishes", "ball sack",
  "ballsack", "ball gag", "blow your load", "big breasts", "big knockers", "strip club", "nudes", "dick pic", "dick pics", "lovemaking",
  "intercourse", "genitals", "panties", "pubes", "topless", "erotic", "erotica", "autoerotic", "voyeur", "scissoring", "rimming",
  "fingering", "fingered", "busty", "gspot", "g spot", "semen", "smut", "sadism", "kinky", "sexcam", "livesex", "camgirl",
  "camgirls", "hooker", "hookers", "orgy", "orgies", "vibrator", "vibrators", "hentai", "pornhub", "onlyfans",
  "ball licking", "ball sucking", "bunghole", "bung hole", "doggiestyle", "muff diver", "muffdiving", "nymphomania", "panty", "reverse cowgirl",
  "tea bagging", "teabagging", "throating", "twink", "twinks", "homoerotic", "spooge", "vulva", "zoophilia",
] as const;

/** Sexual words refused with their endings too: creampie, creampies, creampied, creampieing. */
const EXTRA_STEMS = [
  "creampie", "blowjob", "blow job", "handjob", "hand job", "rimjob", "footjob", "gangbang", "gang bang", "deepthroat", "deep throat",
  "masturbate", "orgasm", "ejaculate", "fap", "jizz", "sext", "queef", "sodomize", "circlejerk", "splooge",
] as const;

const withEndings = (word: string): string[] =>
  word.endsWith("e") ? [word, `${word}s`, `${word}d`, `${word.slice(0, -1)}ing`, `${word}ing`] : [word, `${word}s`, `${word}ed`, `${word}ing`];

const LISTED: readonly string[] = [...EXTRA_WORDS, ...EXTRA_STEMS.flatMap(withEndings)];

/** The matcher reads a run of one letter as one ("fuuuck"), keeping two of these six. A
 *  listed word is written the same way, or its own double letter would never match. */
const KEPT_DOUBLE = "beolsg";
const collapsed = (word: string): string => word.replace(/(.)\1+/g, (_run, letter: string) => (KEPT_DOUBLE.includes(letter) ? letter + letter : letter));

/** Ordinary words and names that hold a listed word inside them. */
const EXTRA_ALLOWED = ["cockpit", "shiitake", "dick's sporting", "dicks sporting", "spotted dick", "pussy willow", "pussycat", "moby dick", "penistone"] as const;

function build(): RegExpMatcher {
  const dataset = new DataSet<{ originalWord: string }>().addAll(englishDataset);
  for (const word of LISTED) {
    dataset.addPhrase((phrase) => phrase.setMetadata({ originalWord: word }).addPattern(parseRawPattern(`|${collapsed(word)}|`)));
  }
  dataset.addPhrase((phrase) => {
    let next = phrase.setMetadata({ originalWord: "allowed" });
    for (const term of EXTRA_ALLOWED) next = next.addWhitelistedTerm(term);
    return next;
  });
  return new RegExpMatcher({ ...dataset.build(), ...englishRecommendedTransformers });
}

const matcher = build();

/** Whether a post's words hold a listed word. */
export function hasBadWords(text: string): boolean {
  return matcher.hasMatch(text);
}

/** The most words one refusal names. */
export const BAD_WORDS_SHOWN = 5;

/** The listed words a post has, as its writer typed them, each once, in the order they
 *  come: what the writer is told. Empty when it has none. */
export function badWordsIn(text: string): string[] {
  const matches = matcher.getAllMatches(text).sort((a, b) => a.startIndex - b.startIndex || b.endIndex - a.endIndex);
  const found: string[] = [];
  let end = -1;
  for (const match of matches) {
    // "cum" inside "cumming" is the same word, said once.
    if (match.endIndex <= end) continue;
    end = match.endIndex;
    const word = text.slice(match.startIndex, match.endIndex + 1).toLowerCase();
    if (!found.includes(word)) found.push(word);
    if (found.length === BAD_WORDS_SHOWN) break;
  }
  return found;
}