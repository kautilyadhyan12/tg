// Part 2B Appendix B — India-first seed. Values are copied, never re-derived.
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
const containerPriors: Readonly<Record<string, readonly [number, number]>> = CONTAINER_PRIORS;
const countablePriors: Readonly<Record<string, readonly [number, number]>> = COUNTABLE_PRIORS;
const moundPriors: Readonly<Record<string, readonly [number, number]>> = RICE_MOUND_PRIORS;

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
const singular = (word: string): string => (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word);
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

/** The count rule of every serving unit on the food list. A unit not here, such
 *  as a packaged product's "ml", takes no count. */
export const COUNT_RULES: ReadonlyMap<string, CountRule> = new Map([
  ...withRule("piece", [
    "apple", "bagel", "banana", "bar", "brownie", "burger", "cake", "clementine", "cookie", "croissant", "date",
    "donut", "dosa", "egg", "gyro", "half", "hot dog", "idli", "kiwi", "link", "meatball", "muffin", "naan",
    "nugget", "orange", "pancake", "paratha", "patty", "peach", "pear", "pita", "plum", "potato", "quesadilla",
    "roll", "roti", "samosa", "sandwich", "sausage", "scoop", "shot", "slice", "spear", "stick", "taco",
    "tortilla", "waffle", "white",
  ]),
  ...withRule("vessel", ["bottle", "bowl", "can", "container", "cup", "glass", "half cup", "portion", "small"]),
  ...withRule("none", ["g", "oz", "tbsp", "2 tbsp", "tsp"]),
]);

/** Words naming a cut of a food, each with the piece it names. A count beside one
 *  is of cut bits, which have no serving of their own: ten "banana slices" are
 *  not ten bananas, and six "orange segments" not six oranges. A count beside the
 *  food's own cut is of that piece ("pizza slices", "bread slices"). A word that
 *  can name either ("cheese squares", "brownie squares") is read as a cut: ten
 *  bits counted as ten wholes is a far larger error than two wholes counted as
 *  one, and the sheet's stepper corrects either. */
export const CUT_WORDS: ReadonlyMap<string, string> = new Map([
  ["slice", "slice"], ["slices", "slice"], ["sliced", "slice"],
  ["segment", "segment"], ["segments", "segment"], ["chunk", "chunk"], ["chunks", "chunk"],
  ["cube", "cube"], ["cubes", "cube"], ["cubed", "cube"], ["wedge", "wedge"], ["wedges", "wedge"],
  ["half", "half"], ["halves", "half"], ["halved", "half"], ["quarter", "quarter"], ["quarters", "quarter"],
  ["quartered", "quarter"], ["strip", "strip"], ["strips", "strip"], ["square", "square"], ["squares", "square"],
  ["floret", "floret"], ["florets", "floret"], ["leaf", "leaf"], ["leaves", "leaf"],
  ["chopped", "chopped"], ["diced", "diced"], ["shredded", "shredded"], ["grated", "grated"],
]);

/** "Piece" is how people count whole things ("six-piece nuggets", "three pieces
 *  of roti"), so it is no part of a food's name, and it names a cut only of the
 *  pieces people cut up (below). */
const PIECE_WORDS: ReadonlySet<string> = new Set(["piece", "pieces"]);

/** The pieces that are one whole fruit, vegetable or egg, which people cut up
 *  rather than count by the piece: "banana pieces" are bits of a banana. */
export const CUT_UP_PIECES: ReadonlySet<string> = new Set([
  "apple", "banana", "clementine", "date", "egg", "half", "kiwi", "orange", "peach", "pear", "plum", "potato", "spear", "white",
]);

/** Whether a hint's count is of cut bits of `piece` rather than of `piece`
 *  itself ("roti", "bread_slice", "hot dog"). */
function countsCutBits(words: readonly string[], piece: string): boolean {
  const own = piece.split(/[_ ]/);
  return words.some((word) => {
    const cut = CUT_WORDS.get(word) ?? (PIECE_WORDS.has(word) && CUT_UP_PIECES.has(piece) ? "piece" : undefined);
    return cut !== undefined && !own.includes(cut);
  });
}

/** The Appendix B piece a hint names: the key's words must be the hint's last
 *  words, whole, "piece" aside ("boiled eggs", "masala dosa", "roti pieces"). A
 *  hint that only holds the key inside a word or before its own last word names
 *  another food: "eggplant" and "veggie burger" are no egg, and "banana bread" no
 *  banana. */
const countKey = (words: readonly string[]): string | null => {
  const singulars = words.filter((w) => !PIECE_WORDS.has(w)).map(singular);
  for (const key of Object.keys(COUNTABLE_PRIORS)) {
    const keyWords = key.split("_");
    const tail = singulars.slice(-keyWords.length);
    if (tail.length === keyWords.length && tail.every((w, i) => w === keyWords[i])) return key;
  }
  return null;
};

/** A container rung's name that is a sealed pack's own, by the pack's unit: a
 *  yogurt shown in its "cup" is its 170 g pot, not Appendix B's 240 ml cup. */
const PACK_NAMED_AS_CONTAINER: ReadonlyMap<string, ReadonlySet<string>> = new Map([["container", new Set(["cup"])]]);

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

/** Rungs 1, 3 and 4, for no count: a saved dish, a known container (never where
 *  the container is the food's own pack), a rice mound, the food's serving. */
function uncounted(e: PortionEvidence, dishware: readonly SavedDishware[], serving: Serving): PortionResult {
  const saved = e.container === null
    ? undefined
    : dishware.find((d) => d.containerClass === e.container && (d.foodHint === null || e.canonicalHint.includes(d.foodHint)));
  if (saved !== undefined) {
    const grams = dishwareGrams(saved.volumeMl, e.fillLevel ?? 1, e.canonicalHint);
    return { gramsPoint: grams, gramsRange: [grams, grams], portionSource: "user_dishware", pieces: null };
  }
  const ownPack = e.container !== null && (PACK_NAMED_AS_CONTAINER.get(serving.unit)?.has(e.container) ?? false);
  const prior = e.container === null || ownPack ? undefined : containerPriors[e.container];
  if (prior !== undefined) {
    const isWeightPrior = e.container === "thali_section";
    const range = scaled(prior, (e.fillLevel ?? 1) * (isWeightPrior ? 1 : density(e.canonicalHint)));
    return { gramsPoint: point(range), gramsRange: range, portionSource: "regional_prior", pieces: null };
  }
  const mound = e.sizeClass === null ? undefined : moundPriors[e.sizeClass];
  if (mound !== undefined) return { gramsPoint: point(mound), gramsRange: [...mound], portionSource: "regional_prior", pieces: null };
  // The curated salvage row provides one serving value, not a sourced range;
  // do not invent a ± percentage (R0.2). The UI still receives the range
  // shape, collapsed honestly to the only sourced value.
  return { gramsPoint: serving.grams, gramsRange: [serving.grams, serving.grams], portionSource: "default", pieces: null };
}

/** Stage 2 approved rungs: reliable count, 1, 3, 4. Anchor scaling is deferred.
 *  A count is used only where it is a count of servings. The Appendix B piece a
 *  hint ends in comes first; then the food's count rule: pieces times the food's
 *  serving, whatever they sit in; cans, glasses or bowls times one of what the
 *  photo shows them in, weighed by the rungs below; and no count for a serving
 *  by weight or spoonful. A count of cut bits is never used. */
export function resolvePortion(e: PortionEvidence, dishware: readonly SavedDishware[], serving: Serving): PortionResult {
  if (e.count === null) return uncounted(e, dishware, serving);
  const words = wordsOf(e.canonicalHint);
  const key = countKey(words);
  if (key !== null) {
    if (countsCutBits(words, key)) return uncounted(e, dishware, serving);
    const prior = countablePriors[key];
    if (prior === undefined) throw new Error("countable prior key missing");
    const range = scaled(prior, e.count);
    return { gramsPoint: point(range), gramsRange: range, portionSource: "regional_prior", pieces: e.count };
  }
  const rule = COUNT_RULES.get(serving.unit) ?? "none";
  if (rule === "piece" && !countsCutBits(words, serving.unit)) {
    return times({ gramsPoint: serving.grams, gramsRange: [serving.grams, serving.grams], portionSource: "default", pieces: null }, e.count);
  }
  if (rule === "vessel") return times(uncounted(e, dishware, serving), e.count);
  return uncounted(e, dishware, serving);
}
