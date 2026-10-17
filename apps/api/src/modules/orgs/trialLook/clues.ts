// The "have a look" warnings (ROADMAP Stage 3 item 2e-ii; RULINGS 2026-09-08, layer 3, and
// 2026-10-17): a gym on our free trial with a weaker clue that it is an older gym opening
// again. Never blocks anything and never tells the gym; Kd reads the list and may pause or
// remove. The database fetches the gyms; this decides which ones are alike.

/** Words that say a place is a gym, what kind or for whom, not which one: two names that
 *  share only these are not alike ("The Yoga Studio", "Yoga Centre"). A word the name is
 *  called by is not here, however common ("Iron", "Physique", "Shakti"): two gyms of one
 *  name in one city are the clue. A plural is set aside with its word ("Clubs"). */
const NAME_WORDS_EVERY_GYM_HAS = new Set([
  "a", "an", "and", "the", "of", "for", "by",
  "gym", "gymnasium", "multigym", "fitness", "fit", "studio", "club", "centre", "center",
  "health", "wellness", "academy", "training", "spa", "sport", "sports",
  "yoga", "pilates", "zumba", "dance", "aerobics", "mma", "boxing", "kickboxing", "crossfit",
  "martial", "arts", "gymnastics",
  "unisex", "ladies", "lady", "women", "womens", "men", "mens", "kid", "kids", "family",
  "ltd", "pvt", "private", "limited", "llc", "inc", "co",
]);

/** The short forms an address is typed with, read as the word. */
const ADDRESS_SHORT_FORMS = new Map([
  ["rd", "road"], ["st", "street"], ["ave", "avenue"], ["av", "avenue"], ["ln", "lane"],
  ["blvd", "boulevard"], ["nr", "near"], ["opp", "opposite"], ["no", "number"],
  ["apt", "apartment"], ["fl", "floor"], ["flr", "floor"],
]);

/** An address shorter than this once read is too vague to say two gyms share it. */
const ADDRESS_LEAST_LENGTH = 10;
/** Words whose number names an area, not a building ("Sector 17"). */
const AREA_WORDS = new Set(["sector", "phase", "ward", "zone", "stage"]);
/** A shop, plot or house number: "12", "4b"; never "1st" nor a PIN or ZIP code. */
const PLACE_NUMBER = /^\d{1,4}[a-z]?$/;
/** A PIN (six digits) or ZIP (five) code. */
const POSTCODE = /^\d{5,6}$/;

const LATIN_ACCENTS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g");
const APOSTROPHES = new RegExp(`['\`${String.fromCharCode(0x2019)}]`, "g");

/** Lower case, accents off ("Café" is "cafe"), apostrophes dropped ("Gold's" is "golds"),
 *  split on anything that is not a letter, a mark or a number, in any script. Only the Latin
 *  accents come off: a Devanagari or Tamil vowel sign is part of the word. */
export function words(text: string): string[] {
  // Most names and addresses are plain ASCII, and the list reads every gym's: they skip the
  // accent step, which is most of the cost.
  const plain = /^[\x20-\x7e\r\n\t]*$/.test(text)
    ? text.toLowerCase().replace(APOSTROPHES, "").replace(/&/g, " and ").split(/[^a-z0-9]+/)
    : text
        .normalize("NFKD")
        .replace(LATIN_ACCENTS, "")
        .normalize("NFC")
        .toLowerCase()
        .replace(APOSTROPHES, "")
        .replace(/&/g, " and ")
        .split(/[^\p{L}\p{M}\p{N}]+/u);
  return plain.filter((w) => w !== "");
}

/** "golds" and "gold" are one word, "academies" and "academy"; "boss" stays. */
function singular(word: string): string {
  if (word.length >= 5 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  return word.length >= 4 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
}

export function cityKey(city: string | null): string | null {
  if (city === null) return null;
  const key = words(city).join(" ");
  return key === "" ? null : key;
}

/** The words of a gym's name that tell it apart: not the words every gym has, not its city. */
export function nameCore(name: string, city: string | null): string[] {
  const cityWords = new Set(city === null ? [] : words(city));
  return words(name)
    .filter((w) => !NAME_WORDS_EVERY_GYM_HAS.has(w) && !NAME_WORDS_EVERY_GYM_HAS.has(singular(w)) && !cityWords.has(w))
    .map(singular);
}

/** Two words one typing slip apart: one letter added or dropped, or two neighbours swapped.
 *  A letter changed is not a slip: "Shakti" and "Shanti", "Rajesh" and "Ramesh" are names. */
function oneSlipApart(a: string, b: string): boolean {
  if (a === b) return false;
  if (a.length === b.length) {
    const differ: number[] = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differ.push(i);
    const [i, j] = differ;
    return differ.length === 2 && i !== undefined && j === i + 1 && a[i] === b[j] && a[j] === b[i];
  }
  if (Math.abs(a.length - b.length) !== 1) return false;
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  for (let i = 0; i < long.length; i++) {
    if (long.slice(0, i) + long.slice(i + 1) === short) return true;
  }
  return false;
}

/** A word must be this long before a typing slip in it still reads as the same name. */
const SLIP_WORD_LEAST_LENGTH = 6;

/** Two names are alike when, once the words every gym has are set aside, they are the same
 *  letters ("Iron House Gym", "IronHouse Fitness"), the same words but one long word slipped
 *  ("Musclemania", "Muscelmania"), or one is two or more words that are all in the other
 *  ("Iron House", "Iron House Elite"). One shared word alone is not enough: "Power Gym" and
 *  "Power House" are two gyms. */
export function namesAlike(a: readonly string[], b: readonly string[]): boolean {
  const ja = a.join("");
  const jb = b.join("");
  if (ja.length < 3 || jb.length < 3) return false;
  if (ja === jb) return true;

  if (a.length === b.length) {
    const differ = a.flatMap((w, i) => (w === b[i] ? [] : [i]));
    const at = differ[0];
    const wa = at === undefined ? "" : a[at] ?? "";
    const wb = at === undefined ? "" : b[at] ?? "";
    if (differ.length === 1 && Math.min(wa.length, wb.length) >= SLIP_WORD_LEAST_LENGTH && oneSlipApart(wa, wb)) {
      return true;
    }
  }

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length < 2 || shorter.length === longer.length) return false;
  const inLonger = new Set(longer);
  return shorter.every((w) => inLonger.has(w));
}

/** The address as one run of letters and numbers, short forms read as words, so "12, M.G.
 *  Rd, Pune-411001" and "12 MG Road Pune 411001" are one; two numbers side by side stay
 *  apart ("Shop 1, 23" is not "Shop 12, 3"). Null when it names no shop, plot or house by
 *  number, which "Baner, Pune 411045", "1st Floor, Main Road" and "Sector 17" do not. */
export function addressKey(address: string | null): string | null {
  if (address === null) return null;
  const tokens = words(address).map((w) => ADDRESS_SHORT_FORMS.get(w) ?? w);
  const placed = tokens.some((w, i) => PLACE_NUMBER.test(w) && !AREA_WORDS.has(tokens[i - 1] ?? ""));
  let key = "";
  for (const [i, w] of tokens.entries()) {
    const before = tokens[i - 1];
    key += before !== undefined && /\d$/.test(before) && /^\d/.test(w) ? ` ${w}` : w;
  }
  return placed && key.length >= ADDRESS_LEAST_LENGTH ? key : null;
}

/** The address's PIN or ZIP code, if it has one. */
export function postcodeOf(address: string | null): string | null {
  return address === null ? null : words(address).find((w) => POSTCODE.test(w)) ?? null;
}

export interface LookGym {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
  /** The owner as one person: their trial key (any spelling of the address), else their id. */
  owner: string;
  createdAt: Date;
}

export interface TrialGym extends LookGym {
  /** The gym 2d's first-people check put this one on the list for, or null. */
  firstPeopleGymId: string | null;
}

export type ClueKind = "first_people" | "address" | "name_city";
export interface Clue {
  kind: ClueKind;
  gymId: string;
}

const KIND_ORDER: readonly ClueKind[] = ["first_people", "address", "name_city"];

/** Two gyms at the same address in the same town: the same city, or, where either has none,
 *  the same PIN or ZIP code. Every town has a "Shop 3, Station Road". */
function sameTown(a: LookGym, b: LookGym): boolean {
  const ca = cityKey(a.city);
  const cb = cityKey(b.city);
  if (ca !== null && cb !== null) return ca === cb;
  const pa = postcodeOf(a.address);
  return pa !== null && pa === postcodeOf(b.address);
}

/** Each trial gym's clues against the older gyms of other owners. The owner's own other gyms
 *  are left out: one free trial per person, and Kd's second-trial code, already cover them. */
export function trialClues(trials: readonly TrialGym[], others: readonly LookGym[]): Map<string, Clue[]> {
  // Only the trials' own cities and addresses are kept from the others.
  const trialCities = new Set(trials.map((t) => cityKey(t.city)));
  const trialAddresses = new Set(trials.map((t) => addressKey(t.address)));
  const byCity = new Map<string, { gym: LookGym; core: string[] }[]>();
  const byAddress = new Map<string, LookGym[]>();
  for (const gym of others) {
    const city = cityKey(gym.city);
    if (city !== null && trialCities.has(city)) {
      const list = byCity.get(city) ?? [];
      list.push({ gym, core: nameCore(gym.name, gym.city) });
      byCity.set(city, list);
    }
    const address = addressKey(gym.address);
    if (address !== null && trialAddresses.has(address)) {
      const list = byAddress.get(address) ?? [];
      list.push(gym);
      byAddress.set(address, list);
    }
  }

  const result = new Map<string, Clue[]>();
  for (const trial of trials) {
    const older = (gym: LookGym) =>
      gym.id !== trial.id && gym.owner !== trial.owner && gym.createdAt < trial.createdAt;
    const clues: Clue[] = [];
    if (trial.firstPeopleGymId !== null) clues.push({ kind: "first_people", gymId: trial.firstPeopleGymId });

    const address = addressKey(trial.address);
    for (const gym of address === null ? [] : byAddress.get(address) ?? []) {
      if (older(gym) && sameTown(trial, gym)) clues.push({ kind: "address", gymId: gym.id });
    }
    const city = cityKey(trial.city);
    const core = nameCore(trial.name, trial.city);
    for (const other of city === null ? [] : byCity.get(city) ?? []) {
      if (older(other.gym) && namesAlike(core, other.core)) clues.push({ kind: "name_city", gymId: other.gym.id });
    }

    clues.sort((x, y) =>
      KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind) || (x.gymId < y.gymId ? -1 : x.gymId > y.gymId ? 1 : 0),
    );
    if (clues.length > 0) result.set(trial.id, clues);
  }
  return result;
}
