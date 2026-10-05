// THE BAD-WORDS CHECK (spec Part 3 §15.3; ROADMAP 19b-ii-b). A member's post that has one
// of these words is not posted: the app tells its writer which word, at once, and nothing
// is sent to the gym's staff (Kd, RULINGS 2026-10-05). English only.
//
// A word list catches the words it knows and nothing else: an unkind post in ordinary
// words ("ugly loser") goes straight through, and Report is what answers it. Two lists are
// read: the `obscenity` package's English set, and the slurs, self-harm phrases and sexual
// words below that it lacks, found by running it over an outside list
// (`test/fixtures/bad-words/README.md`).
//
// The rule that keeps ordinary words out comes before any list of exceptions: a word is
// refused for what it IS, not for what it has inside it. "Cucumber", "cumin", "mishit" and
// "rapeseed" each hold a listed word and are none of them one.
import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from "obscenity";

/** Whole words and phrases only. A space in a phrase is also no space or a hyphen. */
const EXTRA_WORDS = [
  // Slurs about race, nationality, sexuality or disability.
  "beaner", "beaners", "coon", "coons", "darkie", "darkies", "honkey", "jigaboo", "jiggaboo", "jiggerboo", "paki", "pakis", "pikey", "pikeys",
  "rag head", "rag heads", "slanteye", "spic", "spics", "towel head", "towel heads", "wetback", "wetbacks", "mong", "poofter",
  "shemale", "carpet muncher", "fudge packer", "neonazi", "white power",
  // Telling somebody to hurt themselves.
  "kys", "kill yourself", "kill urself", "hang yourself",
  // Insults.
  "tosser", "tossers", "camwhore", "phuck", "phucking", "fuckin", "fucken", "dumbass", "jackass", "smartass", "fatass", "bullshitting",
  "bullshitter",
  // Sexual words and phrases. Not here on purpose, because a gym says them every day:
  // hard, hump, snatch, butt, strap on, spread legs, nipple, suck, hardcore, squirt, kink,
  // pegging, fingering, erection, hooker.
  "jack off", "jerk off", "jerking off", "jacking off", "milf", "milfs", "clit", "clitoris", "boner", "boners", "hardon",
  "horny", "nsfw", "bukkake", "ejaculation", "beastiality", "cunnilingus", "anilingus", "masturbation", "pedophile", "paedophile", "pedo", "paedo",
  "pedobear", "jail bait", "barely legal", "daterape", "raping", "rapist", "dry hump", "dry humping", "humping", "threesome",
  "upskirt", "titty", "titties", "butthole", "schlong", "sodomy", "poontang", "punany", "quim", "nympho", "bdsm", "bondage", "dominatrix",
  "femdom", "strapon", "gooning", "gooned", "cumming", "cumshot", "cumshots", "doggy style", "doggie style",
  "missionary position", "golden shower", "wet dream", "booty call", "camel toe", "foot fetish", "fetish", "fetishes", "ball sack",
  "ball gag", "blow your load", "big breasts", "big knockers", "strip club", "nudes", "dick pic", "dick pics", "lovemaking",
  "intercourse", "genitals", "panties", "pubes", "topless", "erotic", "erotica", "autoerotic", "voyeur", "scissoring", "rimming",
  "busty", "g spot", "semen", "smut", "sadism", "kinky", "sexcam", "livesex", "camgirl", "camgirls", "orgy", "orgies", "vibrator",
  "vibrators", "hentai", "pornhub", "onlyfans", "ball licking", "ball sucking", "bung hole", "muff diver", "muffdiving", "nymphomania",
  "panty", "reverse cowgirl", "tea bagging", "throating", "twink", "twinks", "homoerotic", "spooge", "vulva", "zoophilia",
] as const;

/** Sexual words refused with their endings too: creampie, creampies, creampied, creampieing. */
const EXTRA_STEMS = [
  "creampie", "blow job", "hand job", "rimjob", "footjob", "gang bang", "deep throat",
  "masturbate", "orgasm", "ejaculate", "fap", "jizz", "sext", "queef", "sodomize", "circlejerk", "splooge",
] as const;

const withEndings = (word: string): string[] =>
  word.endsWith("e") ? [word, `${word}s`, `${word}d`, `${word.slice(0, -1)}ing`, `${word}ing`] : [word, `${word}s`, `${word}ed`, `${word}ing`];

/** Ordinary phrases that hold a listed word: read as if the phrase were not there. */
const ALLOWED = [
  "cockpit", "shiitake", "dick's sporting", "dicks sporting", "spotted dick", "moby dick", "pussy willow", "pussycat", "penistone",
  "cock up", "kick ass", "bad ass", "ass to grass", "mixed sex", "single sex", "same sex", "pissed off", "pin prick", "blue tit",
  "great tit", "maine coon", "cum laude", "fire retardant", "flame retardant", "hooker", "hookers",
] as const;

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A listed phrase as a pattern: each letter once or more ("tossser"), and between its
 *  words a space, a line break, a hyphen, or nothing. */
const phrasePattern = (phrase: string): string =>
  phrase
    .split(" ")
    .map((word) => Array.from(word, (letter) => `${escaped(letter)}+`).join(""))
    .join("[\\s\\-_.]*");

/** Whole words only: a letter on either side is another word. A digit or a mark is not. */
const wholeWords = (phrases: readonly string[]): RegExp =>
  new RegExp(`(?<![a-z])(?:${[...phrases].sort((a, b) => b.length - a.length).map(phrasePattern).join("|")})(?![a-z])`, "g");

const EXTRA = wholeWords([...EXTRA_WORDS, ...EXTRA_STEMS.flatMap(withEndings)]);
const ALLOWED_PHRASES = wholeWords(ALLOWED);
const PACKAGE = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });

/** What may stand before and after one of the package's words inside a typed word for the
 *  typed word still to be that word: "bullshit", "dickhead", "fucking". Anything else
 *  around it is another word ("cucumber", "mishit", "retardant"). */
const BEFORE = new Set(["", "bull", "horse", "dumb", "jack", "mother", "mutha", "dip", "ape", "bat", "dog", "smart", "fat", "lard", "bad", "wise", "half", "cock", "dick", "ass", "arse", "god", "mc", "cam", "cluster"]);
const AFTER = new Set([
  "", "s", "es", "ed", "d", "ing", "er", "ers", "y", "ey", "ty", "ted", "ter", "ters", "ting", "tier", "head", "heads", "hole", "holes", "face",
  "faces", "wit", "wits", "bag", "bags", "wad", "wads", "tard", "tards", "hat", "hats", "o", "os", "a", "z", "wipe", "wipes", "sucker", "suckers",
  "sucking", "fucker", "fuckers", "fucking", "load", "loads", "show", "storm", "house", "licker", "lickers", "ish", "ery", "ton", "tastic", "ot", "ots", "otry", "ography", "ographic", "ographer", "star", "stars", "hub", "munch",
  "muncher",
]);

const LETTER = /\p{L}/u;
/** Marks that end a sentence or close a bracket, not part of a word as typed. */
const TRAILING = /[!?.,;:)\]"']+$/;

/** The text the checks read: characters nobody sees (a zero-width space, a soft hyphen, a
 *  combining stroke) taken out, so a word drawn as a listed word is read as one. */
function cleaned(text: string): string {
  return text.normalize("NFKC").replace(/[\p{Cf}\p{M}]/gu, "");
}

const LETTER_FOR: Record<string, string> = { "0": "o", "3": "e", "4": "a", "5": "s", "@": "a", $: "s", "7": "t" };

/** Lower case, with the digits and marks people write letters with turned back into them.
 *  Every swap keeps the length, so a place in this text is the same place in the cleaned one.
 *  "1" and "!" are an "i" only between letters: at a word's end they are a digit and a mark. */
function plain(text: string): string {
  return text
    .toLowerCase()
    .replace(/[0345@$7]/g, (c) => LETTER_FOR[c] ?? c)
    .replace(/(?<=[a-z])[1!](?=[a-z])/g, "i");
}

interface Span {
  start: number;
  /** One past the last character. */
  end: number;
  word: string;
}

/** The package's words in this text, each kept only where the typed word IS that word. */
/** A run of one letter read as one, as the package reads it: "fuuuck" is "fuck". */
const squeezed = (word: string): string => word.replace(/(.)\1+/g, "$1");

/** The package reads "!" and "1" as an "i" and "(" as a "c" wherever they stand, so "cock!"
 *  is "cocki" to it and "(anal)" is "canal". Here they are a letter only between letters
 *  ("b!tch", "sh1t"); anywhere else they are blanked, which keeps every place. */
const forPackage = (text: string): string => text.replace(/(?<!\p{L})[!(1|]|[!(1|](?!\p{L})/gu, " ");

function packageSpans(typedText: string): Span[] {
  const spans: Span[] = [];
  const text = forPackage(typedText);
  for (const match of PACKAGE.getAllMatches(text)) {
    let start = match.startIndex;
    let end = match.endIndex + 1;
    while (start > 0 && LETTER.test(text[start - 1] ?? "")) start--;
    while (end < text.length && LETTER.test(text[end] ?? "")) end++;
    if (!BEFORE.has(text.slice(start, match.startIndex).toLowerCase())) continue;
    // From where the listed word starts to the end of the typed word: the listed word (the
    // package matches some by their first letters only: "fellat", "bestial") and an ending.
    const typed = squeezed(plain(text.slice(match.startIndex, end)));
    const listed = [englishDataset.getPayloadWithPhraseMetadata(match).phraseMetadata?.originalWord ?? "", text.slice(match.startIndex, match.endIndex + 1)]
      .filter((word) => word !== "")
      .map((word) => squeezed(plain(word)));
    if (!listed.some((word) => typed.startsWith(word) && AFTER.has(typed.slice(word.length)))) continue;
    spans.push({ start, end, word: text.slice(start, end).replace(TRAILING, "").toLowerCase() });
  }
  return spans;
}

/** This job's own words in this text. */
function extraSpans(text: string): Span[] {
  return Array.from(plain(text).matchAll(EXTRA), (match) => {
    const start = match.index;
    const end = start + match[0].length;
    return { start, end, word: text.slice(start, end).replace(/\s+/g, " ").toLowerCase() };
  });
}

/** Letters typed one at a time ("f u c k", "f.u.c.k"): refused where, joined, they are a
 *  listed word and nothing else. */
const SPACED = /(?<![a-z])(?:[a-z][ .*_-]){2,}[a-z](?![a-z])/g;

function spacedSpans(text: string): Span[] {
  const spans: Span[] = [];
  for (const match of plain(text).matchAll(SPACED)) {
    const joined = match[0].replace(/[^a-z]/g, "");
    const whole = [...packageSpans(joined), ...extraSpans(joined)].some((span) => span.start === 0 && span.end === joined.length);
    if (whole) spans.push({ start: match.index, end: match.index + match[0].length, word: joined });
  }
  return spans;
}

/** The text with every allowed phrase blanked, not cut: every other word keeps its place. */
function withoutAllowed(text: string): string {
  let out = text;
  for (const match of plain(text).matchAll(ALLOWED_PHRASES)) {
    out = out.slice(0, match.index) + " ".repeat(match[0].length) + out.slice(match.index + match[0].length);
  }
  return out;
}

/** The most words one refusal names. */
export const BAD_WORDS_SHOWN = 5;

/** The listed words a post has, as its writer typed them, each once, in the order they
 *  come: what the writer is told. Empty when it has none. */
export function badWordsIn(text: string): string[] {
  const read = withoutAllowed(cleaned(text));
  const spans = [...packageSpans(read), ...extraSpans(read), ...spacedSpans(read)].sort((a, b) => a.start - b.start || b.end - a.end);
  const found: string[] = [];
  let end = -1;
  for (const span of spans) {
    // "cum" inside "cumming" is the same word, said once.
    if (span.end <= end) continue;
    end = span.end;
    if (span.word !== "" && !found.includes(span.word)) found.push(span.word);
    if (found.length === BAD_WORDS_SHOWN) break;
  }
  return found;
}

/** Whether a post's words have a listed word. */
export function hasBadWords(text: string): boolean {
  return badWordsIn(text).length > 0;
}
