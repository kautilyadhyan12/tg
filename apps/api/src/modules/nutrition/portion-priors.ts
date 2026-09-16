// Part 2B Appendix B — India-first seed. Values are copied, never re-derived.
import { MAX_ITEM_GRAMS, type MealVessel } from "@app/shared";

export const CONTAINER_PRIORS = {
  small_katori: [100, 150], katori_or_small_bowl: [150, 200], standard_katori: [150, 200],
  large_katori: [250, 300], large_bowl: [250, 300], serving_bowl: [300, 400],
  steel_tumbler: [150, 200], chai_cup: [100, 150], thali_section: [100, 150],
  cup: [240, 240], cereal_bowl: [350, 400], mug: [300, 350], tablespoon: [15, 15], teaspoon: [5, 5],
} as const satisfies Record<string, readonly [number, number]>;

export const COUNTABLE_PRIORS = {
  roti: [35, 45], chapati: [35, 45], paratha: [60, 90], puri: [20, 30], idli: [30, 50],
  dosa: [80, 120], medu_vada: [40, 60], samosa: [60, 100], egg: [50, 50],
  bread_slice: [25, 30], banana: [100, 120],
} as const satisfies Record<string, readonly [number, number]>;

export const RICE_MOUND_PRIORS = { small_mound: [100, 100], medium_mound: [150, 150], large_mound: [250, 250] } as const;
export const DENSITY_G_PER_ML = { thin: 0.95, medium: 1, thick: 1.1 } as const;
export const GLOBAL_STARTERS = { dinnerPlateRimCm: [26, 27], cupMl: 240, tablespoonMl: 15, teaspoonMl: 5 } as const;
/** The container this resolver reads for each vessel a scan may name
 *  (`mealVesselSchema`, ROADMAP 7a-iii-b). A vessel Appendix B measures is its
 *  Appendix B name — the katori is the standard katori and the tumbler the steel
 *  tumbler — and every other vessel is its own name, as a container the photo
 *  named in words always was. 7a-iv gives each vessel its volume and replaces this. */
export const VESSEL_CONTAINERS: Readonly<Record<MealVessel, string>> = {
  katori: "standard_katori", bowl: "bowl", "large bowl": "large_bowl", "thali section": "thali_section",
  tumbler: "steel_tumbler", "chai cup": "chai_cup", cup: "cup", mug: "mug", glass: "glass", can: "can",
  bottle: "bottle", pot: "pot", tablespoon: "tablespoon", teaspoon: "teaspoon", plate: "plate",
};
/** The priors as Maps, so a name the photo gives that every object answers to
 *  ("constructor", "toString") is no container, piece or mound. */
const containerPriors: ReadonlyMap<string, readonly [number, number]> = new Map(Object.entries(CONTAINER_PRIORS));
const countablePriors: ReadonlyMap<string, readonly [number, number]> = new Map(Object.entries(COUNTABLE_PRIORS));
const moundPriors: ReadonlyMap<string, readonly [number, number]> = new Map(Object.entries(RICE_MOUND_PRIORS));
/** How many words the longest container name has ("katori_or_small_bowl"). */
const LONGEST_CONTAINER_NAME = Math.max(...[...containerPriors.keys()].map((name) => name.split("_").length));

export type PortionSource = "user_dishware" | "regional_prior" | "default";
export interface PortionEvidence { canonicalHint: string; container: string | null; fillLevel: number | null; sizeClass: string | null; count: number | null; }
export interface SavedDishware { containerClass: string; volumeMl: number; foodHint: string | null; }
/** `pieces` is how many of what the photo counted the grams stand for (six
 *  nuggets, three cans) where the count set them, and null where it did not. */
export interface PortionResult { gramsPoint: number; gramsRange: [number, number]; portionSource: PortionSource; pieces: number | null; }

/** The food's own serving: `grams` of it make one `unit`. */
export interface Serving { grams: number; unit: string; }

const point = ([lo, hi]: readonly [number, number]): number => Math.round((lo + hi) / 2);
const scaled = (range: readonly [number, number], factor: number): [number, number] => [Math.round(range[0] * factor), Math.round(range[1] * factor)];
const density = (hint: string): number => {
  const normalized = hint.toLowerCase();
  if (normalized.includes("rasam") || normalized.includes("thin_dal")) return DENSITY_G_PER_ML.thin;
  if (normalized.includes("sabzi") || normalized.includes("halwa") || normalized.includes("thick_gravy")) return DENSITY_G_PER_ML.thick;
  return DENSITY_G_PER_ML.medium;
};
/** A word's singular: "eggs" an egg, "mugs" a mug, "glasses" a glass, "boxes" a box. */
const singular = (word: string): string => {
  if (word.length > 4 && /(?:ss|sh|ch|x)es$/.test(word)) return word.slice(0, -2);
  return word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
};
const wordsOf = (hint: string): string[] => hint.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w !== "");

/** What a photo's count of a food is a count of, by the unit of the food's serving:
 *  - "piece": a serving is one thing on the plate (a nugget, a roti, a slice of
 *    pizza, an apple), so the count is of those, whatever they sit in;
 *  - "vessel": a serving is what one can, bottle, pot, glass, cup or bowl holds,
 *    so the count is of those, and one weighs what the photo shows it in;
 *  - "none": a serving is a weight or a spoonful, and what a photo counts of such
 *    a food (grapes, almonds, pats of butter) is not that serving. */
export type CountRule = "piece" | "vessel" | "none";

const withRule = (rule: CountRule, units: readonly string[]): [string, CountRule][] => units.map((unit) => [unit, rule]);

/** The count rule of every serving unit on the food list, and of each pack or
 *  piece a packaged product's label serves by ("1 pot (125 g)", "1 biscuit (12 g)";
 *  openfoodfacts.adapter.ts). A unit not here takes no count: a label's "ml" or
 *  "2 biscuits", or a word in another language. */
export const COUNT_RULES: ReadonlyMap<string, CountRule> = new Map([
  ...withRule("piece", [
    "apple", "bagel", "banana", "bar", "brownie", "burger", "cake", "clementine", "cookie", "croissant", "date",
    "donut", "dosa", "egg", "gyro", "half", "hot dog", "idli", "kiwi", "link", "meatball", "muffin", "naan",
    "nugget", "orange", "pancake", "paratha", "patty", "peach", "pear", "pita", "plum", "potato", "quesadilla",
    "roll", "roti", "samosa", "sandwich", "sausage", "scoop", "shot", "slice", "spear", "stick", "taco",
    "tortilla", "waffle", "white",
    // the pieces a label names, beside the list's own
    "biscuit", "piece",
  ]),
  ...withRule("vessel", [
    "bottle", "bowl", "can", "container", "cup", "glass", "half cup", "portion", "small",
    // the packs a label names, beside the list's own
    "bag", "box", "carton", "jar", "pack", "package", "packet", "pot", "pouch", "sachet", "tub",
  ]),
  ...withRule("none", ["g", "oz", "tbsp", "2 tbsp", "tsp"]),
]);

/** The vessel units whose serving is all its container holds, so a photo's fill
 *  scales the serving: a cup of cornflakes, a can, a bottle, a pot, a tub, a pack.
 *  The other vessel units (a glass of wine, a bowl of pho, a small, a portion) are
 *  a pour or a helping served in a container bigger than it, and keep their
 *  weight however full the container looks: Part 2B §3.5 applies fill to a
 *  container's volume, never to a serving. */
export const WHOLE_VOLUME_UNITS: ReadonlySet<string> = new Set([
  "cup", "half cup", "can", "bottle", "container", "pot", "tub",
  "bag", "box", "carton", "jar", "pack", "package", "packet", "pouch", "sachet",
]);

/** Words naming a cut of a food, each with the piece it names. A count beside one
 *  is of cut bits, which have no serving of their own: ten "banana slices" are
 *  not ten bananas, and six "beef stew chunks" not six cups of stew. A count
 *  beside the food's own cut is of that piece ("pizza slices", "bread slices",
 *  "grapefruit halves"). A word that can name either ("cheese squares", "brownie
 *  squares") is read as a cut: ten bits counted as ten wholes is a far larger
 *  error than two wholes counted as one, and the sheet's stepper corrects either. */
export const CUT_WORDS: ReadonlyMap<string, string> = new Map([
  ["slice", "slice"], ["slices", "slice"], ["sliced", "slice"],
  ["segment", "segment"], ["segments", "segment"], ["chunk", "chunk"], ["chunks", "chunk"],
  ["cube", "cube"], ["cubes", "cube"], ["cubed", "cube"], ["wedge", "wedge"], ["wedges", "wedge"],
  ["half", "half"], ["halves", "half"], ["halved", "half"], ["quarter", "quarter"], ["quarters", "quarter"],
  ["quartered", "quarter"], ["strip", "strip"], ["strips", "strip"], ["square", "square"], ["squares", "square"],
  ["floret", "floret"], ["florets", "floret"], ["leaf", "leaf"], ["leaves", "leaf"],
  ["chopped", "chopped"], ["diced", "diced"], ["shredded", "shredded"], ["grated", "grated"],
]);

/** "Piece" is how people count some whole things ("six-piece nuggets", "three
 *  pieces of roti"), so it is no part of a food's name, and what it counts is
 *  settled by the piece (below). */
const PIECE_WORDS: ReadonlySet<string> = new Set(["piece", "pieces"]);

/** The pieces people count as "pieces", Appendix B's and the serving units': a
 *  nugget ("six-piece nuggets"), a meatball, a slice (a piece of pizza or cake is
 *  a slice, and so is a bread slice), the piece a label names, and the Indian
 *  breads and snacks served several at a time as they come: roti, chapati, puri,
 *  idli, medu vada, samosa. "Pieces" of any other piece are bits cut or torn from
 *  it, as the tie-break above reads a word that can name either: eight "hot dog
 *  pieces" are one hot dog, twelve "tortilla pieces" one tortilla, and ten
 *  "banana pieces" one banana. */
export const WHOLE_PIECES: ReadonlySet<string> = new Set([
  "nugget", "meatball", "slice", "bread_slice", "piece", "roti", "chapati", "puri", "idli", "medu_vada", "samosa",
]);

/** Whether a hint's count is of bits cut from `piece` (an Appendix B key or a
 *  serving unit, "roti", "bread_slice", "cup") rather than of `piece` itself: a
 *  cut other than the piece's own ("beef stew chunks"; not "pizza slices"), or
 *  "pieces" of a piece people cut up. */
function countsCutBits(words: readonly string[], piece: string): boolean {
  const own = piece.split(/[_ ]/).at(-1);
  return words.some((word) => {
    const cut = CUT_WORDS.get(word);
    return cut === undefined ? PIECE_WORDS.has(word) && !WHOLE_PIECES.has(piece) : cut !== own;
  });
}

/** The Appendix B piece a hint names: the key's words must be the hint's last
 *  words, whole, "piece" aside ("boiled eggs", "masala dosa", "roti pieces"). A
 *  hint that only holds the key inside a word or before its own last word names
 *  another food: "eggplant" and "veggie burger" are no egg, and "banana bread" no
 *  banana. */
const countKey = (words: readonly string[]): string | null => {
  const singulars = words.filter((w) => !PIECE_WORDS.has(w)).map(singular);
  for (const key of countablePriors.keys()) {
    const keyWords = key.split("_");
    const tail = singulars.slice(-keyWords.length);
    if (tail.length === keyWords.length && tail.every((w, i) => w === keyWords[i])) return key;
  }
  return null;
};

/** The containers a sealed pack is also called, by the pack's unit: a yogurt
 *  shown in its "cup" is its 170 g pot, not Appendix B's 240 ml cup. */
const PACK_NAMED_AS_CONTAINER: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["container", new Set(["cup"])], ["pot", new Set(["cup"])], ["tub", new Set(["cup"])],
]);

/** Whether a container is the food's own serving: its unit ("a cup" of cornflakes,
 *  served by their 30 g cup) or its pack's other name. */
const isOwnServing = (container: string, serving: Serving): boolean =>
  container === serving.unit || (PACK_NAMED_AS_CONTAINER.get(serving.unit)?.has(container) ?? false);

/** Grams from a saved dish: volume(ml) × fill(0–1) × food density. The ONE
 *  place both the scan-time rung-1 resolver (below) and the confirm-time
 *  dishware arm (service.ts, Card 5c2) compute this, so a bowl measured in the
 *  photo flow and the same bowl chosen at confirm can never disagree. */
export function dishwareGrams(volumeMl: number, fillLevel: number, canonicalHint: string): number {
  return Math.round(volumeMl * fillLevel * density(canonicalHint));
}

/** Whole grams, never under one: a label's "0.25 cup" is still some food. */
const wholeGrams = (grams: number): number => Math.max(1, Math.round(grams));

/** `count` of `one`: its grams and range times the count, from the same rung. */
const times = (one: PortionResult, count: number): PortionResult => ({
  gramsPoint: wholeGrams(one.gramsPoint * count),
  gramsRange: [wholeGrams(one.gramsRange[0] * count), wholeGrams(one.gramsRange[1] * count)],
  portionSource: one.portionSource,
  pieces: count,
});

/** What a hint measures its food by, where it has an "of": the container its
 *  words before the "of" name, as the longest Appendix B name they end in ("a
 *  large bowl of dal" is the large bowl), else the last of them ("two mugs of
 *  coffee" is a mug); that last word, singular; and whether it is a plural that
 *  names no cut and no "pieces" (the count rule in `resolvePortion`). A hint with
 *  no "of" names no container: "cup noodles" is a food, not a cup. */
interface HintMeasure { container: string; word: string; plural: boolean }
function hintMeasure(words: readonly string[]): HintMeasure | null {
  const at = words.indexOf("of");
  const last = words[at - 1];
  if (at < 1 || last === undefined) return null;
  const word = singular(last);
  const plural = word !== last && !CUT_WORDS.has(last) && !PIECE_WORDS.has(last);
  const named = [...words.slice(Math.max(0, at - LONGEST_CONTAINER_NAME), at - 1), word];
  for (let from = 0; from < named.length - 1; from++) {
    const name = named.slice(from).join("_");
    if (containerPriors.has(name)) return { container: name, word, plural };
  }
  return { container: word, word, plural };
}

/** The last word of a container's name, or of each name an "or" joins
 *  ("katori_or_small_bowl" is a katori or a bowl), singular. */
const containerHeads = (name: string): string[] =>
  wordsOf(name).filter((word, at, words) => word !== "or" && (at === words.length - 1 || words[at + 1] === "or")).map(singular);

/** The words that name a food's own serving, whatever its unit: two "servings of
 *  rice" are two of rice's servings. */
const SERVING_WORDS: ReadonlySet<string> = new Set(["serving", "portion", "helping"]);

/** Sizes, which no container is named by. */
const SIZE_WORDS: ReadonlySet<string> = new Set(["small", "medium", "large"]);

/** The containers a plural before a hint's "of" can count where the photo shows
 *  none: what each Appendix B container is, the vessel and pack units that name a
 *  container (one word, no size: not "half cup" or "small"), a plate, a tray, and
 *  the serving words. Any other plural ("stacks of roti", "piles of nuggets") says
 *  how the food lies, not what it sits in, and its count is read as its
 *  singular's is. */
export const CONTAINER_WORDS: ReadonlySet<string> = new Set([
  ...[...containerPriors.keys()].flatMap(containerHeads),
  ...[...COUNT_RULES].filter(([unit, rule]) => rule === "vessel" && !unit.includes(" ") && !SIZE_WORDS.has(unit)).map(([unit]) => unit),
  "plate", "tray", ...SERVING_WORDS,
]);

/** What a photo's container is, singular: the words of its name that name a
 *  container, wherever they stand ("bowl with lid", "cup and saucer" and "steel
 *  plate (thali)" are a bowl, a cup and a plate), and never a serving word where
 *  another word does ("serving bowl" and "bowl (1 serving)" are bowls, not
 *  servings); a name with none is its last word, or each an "or" joins ("steel
 *  flask" is a flask). The other words say which kind: a chai cup is no chai, and
 *  a thali section no thali. */
const containerKinds = (name: string): string[] => {
  const named = wordsOf(name).map(singular).filter((word) => CONTAINER_WORDS.has(word) && !SERVING_WORDS.has(word));
  return named.length > 0 ? named : containerHeads(name);
};

/** Whether a photo's count is of the things a hint names in the plural before its
 *  "of" rather than of the food: two "bowls of beef stew chunks" are two bowls,
 *  and two "plates of nuggets" two plates. It is where the photo shows the food
 *  in nothing and the plural names a container, or a dish the person saved
 *  ("flasks of coffee"); or where the plural names what the photo's own container
 *  is (above: "bowls" in a large bowl or a bowl with lid). Two "scoops of ice
 *  cream" in a cup, or three "servings" in a serving bowl, are counted as the same
 *  food shown in that container is. A count beside one container ("a plate of
 *  nuggets", six) is of what it holds, as a count of the same food shown in that
 *  container is, and one beside "slices of" or "pieces of" is of the slices or
 *  the pieces. */
const countsWhatHintNames = (measure: HintMeasure | null, photoContainer: string | null, dishware: readonly SavedDishware[]): boolean => {
  if (measure === null || !measure.plural) return false;
  if (photoContainer !== null) return containerKinds(photoContainer).includes(measure.word);
  return CONTAINER_WORDS.has(measure.word) || dishware.some((d) => d.containerClass === measure.container);
};

/** Rung 4, the food's serving. The curated salvage row provides one serving value,
 *  not a sourced range; do not invent a ± percentage (R0.2). The UI still receives
 *  the range shape, collapsed honestly to the only sourced value. */
const servingPortion = (serving: Serving): PortionResult =>
  ({ gramsPoint: serving.grams, gramsRange: [serving.grams, serving.grams], portionSource: "default", pieces: null });

/** Rungs 1 and 3, where they know how much of the food its container holds: a
 *  saved dish; the food's serving where the container is a serving word; the
 *  food's own serving where the container is it (its table weighs a cup of
 *  cornflakes at 30 g, where Appendix B's cup is 240 ml of water), as full as the
 *  photo shows only where the serving is all the container holds; a known
 *  container; a rice mound. Null where none of them does. */
function measured(e: PortionEvidence, dishware: readonly SavedDishware[], serving: Serving): PortionResult | null {
  const saved = e.container === null
    ? undefined
    : dishware.find((d) => d.containerClass === e.container && (d.foodHint === null || e.canonicalHint.includes(d.foodHint)));
  if (saved !== undefined) {
    const grams = dishwareGrams(saved.volumeMl, e.fillLevel ?? 1, e.canonicalHint);
    return { gramsPoint: grams, gramsRange: [grams, grams], portionSource: "user_dishware", pieces: null };
  }
  if (e.container !== null && SERVING_WORDS.has(e.container)) return servingPortion(serving);
  if (e.container !== null && isOwnServing(e.container, serving)) {
    const fill = WHOLE_VOLUME_UNITS.has(serving.unit) ? (e.fillLevel ?? 1) : 1;
    const grams = wholeGrams(serving.grams * fill);
    return { gramsPoint: grams, gramsRange: [grams, grams], portionSource: "default", pieces: null };
  }
  const prior = e.container === null ? undefined : containerPriors.get(e.container);
  if (prior !== undefined) {
    const isWeightPrior = e.container === "thali_section";
    const range = scaled(prior, (e.fillLevel ?? 1) * (isWeightPrior ? 1 : density(e.canonicalHint)));
    return { gramsPoint: point(range), gramsRange: range, portionSource: "regional_prior", pieces: null };
  }
  const mound = e.sizeClass === null ? undefined : moundPriors.get(e.sizeClass);
  if (mound !== undefined) return { gramsPoint: point(mound), gramsRange: [...mound], portionSource: "regional_prior", pieces: null };
  return null;
}

/** A count of servings, where the count is not of containers: never of bits cut
 *  from one, whatever the food's rule (above); then the Appendix B piece a hint
 *  ends in; then the food's count rule: pieces times the food's serving, whatever
 *  they sit in; cans, glasses or bowls times `one` of what the photo shows them
 *  in; and no count for a serving by weight or spoonful. */
function countedServings(words: readonly string[], count: number, one: PortionResult, serving: Serving): PortionResult {
  const key = countKey(words);
  if (countsCutBits(words, key ?? serving.unit)) return one;
  if (key !== null) {
    const prior = countablePriors.get(key);
    if (prior === undefined) throw new Error("countable prior key missing");
    const range = scaled(prior, count);
    return { gramsPoint: point(range), gramsRange: range, portionSource: "regional_prior", pieces: count };
  }
  const rule = COUNT_RULES.get(serving.unit) ?? "none";
  if (rule === "piece") return times(servingPortion(serving), count);
  if (rule === "vessel") return times(one, count);
  return one;
}

/** Stage 2 approved rungs: reliable count, 1, 3, 4. Anchor scaling is deferred.
 *  The container a hint measures its food by stands for an empty container, so
 *  "mugs of coffee" weigh as coffee shown in mugs. A count of what a hint names
 *  (above) is that many of one container, whatever cut or pieces fill them, where
 *  the rungs know what one holds or the food is served by a vessel; for any other
 *  food it is not used, and the food's own pieces are never counted in its place.
 *  Any other count is a count of servings (above). A count whose range would
 *  reach past what one item of a meal may weigh is no count of servings on a
 *  plate, and is not used. */
export function resolvePortion(e: PortionEvidence, dishware: readonly SavedDishware[], serving: Serving): PortionResult {
  const words = wordsOf(e.canonicalHint);
  const measure = hintMeasure(words);
  const seen = e.container === null && measure !== null ? { ...e, container: measure.container } : e;
  const sized = measured(seen, dishware, serving);
  const one = sized ?? servingPortion(serving);
  if (e.count === null) return one;
  const counted = countsWhatHintNames(measure, e.container, dishware)
    ? (sized !== null || COUNT_RULES.get(serving.unit) === "vessel" ? times(one, e.count) : one)
    : countedServings(words, e.count, one, serving);
  return counted.gramsRange[1] > MAX_ITEM_GRAMS ? one : counted;
}
