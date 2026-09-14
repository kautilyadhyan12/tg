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
/** `pieces` is how many counted pieces the grams stand for where the photo's
 *  count set them, and null where it did not (a dish, a weight, a cut of the food). */
export interface PortionResult { gramsPoint: number; gramsRange: [number, number]; portionSource: PortionSource; pieces: number | null; }

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

/** The Appendix B piece a hint names: the key's words must be the hint's last
 *  words, whole ("boiled eggs", "masala dosa", "bread slices"). A hint that only
 *  holds the key inside a word or before its own last word names another food:
 *  "eggplant" and "veggie burger" are no egg, and "banana bread" no banana. */
const countKey = (words: readonly string[]): string | null => {
  const singulars = words.map(singular);
  for (const key of Object.keys(COUNTABLE_PRIORS)) {
    const keyWords = key.split("_");
    const tail = singulars.slice(-keyWords.length);
    if (tail.length === keyWords.length && tail.every((w, i) => w === keyWords[i])) return key;
  }
  return null;
};

/** Words saying a photo counted cut pieces of a food, each with the piece it
 *  names: ten "banana slices" are not ten bananas, and six "orange segments" not
 *  six oranges. A count beside one multiplies only a serving of that same piece
 *  ("pizza slices", "bread slices"). */
export const CUT_WORDS: ReadonlyMap<string, string> = new Map([
  ["piece", "piece"], ["pieces", "piece"], ["slice", "slice"], ["slices", "slice"], ["sliced", "slice"],
  ["segment", "segment"], ["segments", "segment"], ["chunk", "chunk"], ["chunks", "chunk"],
  ["cube", "cube"], ["cubes", "cube"], ["cubed", "cube"], ["wedge", "wedge"], ["wedges", "wedge"],
  ["half", "half"], ["halves", "half"], ["halved", "half"], ["quarter", "quarter"], ["quarters", "quarter"],
  ["quartered", "quarter"], ["strip", "strip"], ["strips", "strip"], ["square", "square"], ["squares", "square"],
  ["floret", "floret"], ["florets", "floret"], ["leaf", "leaf"], ["leaves", "leaf"],
  ["chopped", "chopped"], ["diced", "diced"], ["shredded", "shredded"], ["grated", "grated"],
]);

/** Words naming what a food is served in, each with the vessel it names. Beside
 *  a sealed pack's food they say the photo counted those vessels, not packs: two
 *  glasses of beer are not two cans. Beside a piece they say nothing of the count
 *  ("a plate of nuggets"). */
export const VESSEL_WORDS: ReadonlyMap<string, string> = new Map([
  ["cup", "cup"], ["cups", "cup"], ["glass", "glass"], ["glasses", "glass"], ["mug", "mug"], ["mugs", "mug"],
  ["can", "can"], ["cans", "can"], ["bottle", "bottle"], ["bottles", "bottle"], ["jar", "jar"], ["jars", "jar"],
  ["pot", "pot"], ["pots", "pot"], ["tub", "tub"], ["tubs", "tub"], ["carton", "carton"], ["cartons", "carton"],
  ["bowl", "bowl"], ["bowls", "bowl"], ["plate", "plate"], ["plates", "plate"], ["plateful", "plate"],
]);

/** Whether a hint says its count is of something other than the `counted`
 *  pieces: a cut of the food, or, for a sealed pack, another vessel. */
function countsSomethingElse(words: readonly string[], counted: readonly string[], pack: boolean): boolean {
  return words.some((word) => {
    const named = CUT_WORDS.get(word) ?? (pack ? VESSEL_WORDS.get(word) : undefined);
    return named !== undefined && !counted.includes(named);
  });
}

/** Serving units that are ONE of what a photo counts: a piece of the food or a
 *  sealed can, bottle or pot. A count multiplies only these. A weight, a spoon, a
 *  cup, a glass or a bowl is not one: ten grapes are not ten 100 g servings, and a
 *  vessel's size is the container rung's to measure. */
export const PIECE_UNITS: ReadonlySet<string> = new Set([
  "apple", "banana", "bagel", "bar", "bottle", "brownie", "burger", "cake", "can", "clementine",
  "container", "cookie", "croissant", "date", "donut", "dosa", "egg", "gyro", "hot dog", "idli",
  "kiwi", "link", "meatball", "muffin", "naan", "nugget", "orange", "pancake", "paratha", "patty",
  "peach", "pear", "pita", "plum", "potato", "quesadilla", "roll", "roti", "samosa", "sandwich",
  "sausage", "slice", "spear", "stick", "taco", "tortilla", "waffle", "white",
]);

/** The sealed packs among the piece units. A saved dish the photo shows them in
 *  says how much is there, not the pack (§3.4: a saved dish beats everything). */
export const PACK_UNITS: ReadonlySet<string> = new Set(["can", "bottle", "container"]);

/** The food's own serving: `grams` of it make one `unit`. */
export interface Serving { grams: number; unit: string; }

/** Grams from a saved dish: volume(ml) × fill(0–1) × food density. The ONE
 *  place both the scan-time rung-1 resolver (below) and the confirm-time
 *  dishware arm (service.ts, Card 5c2) compute this, so a bowl measured in the
 *  photo flow and the same bowl chosen at confirm can never disagree. */
export function dishwareGrams(volumeMl: number, fillLevel: number, canonicalHint: string): number {
  return Math.round(volumeMl * fillLevel * density(canonicalHint));
}

/** Stage 2 approved rungs: reliable count, 1, 3, 4. Anchor scaling is deferred.
 *  A count is reliable only where the hint says what it counted. It takes the
 *  Appendix B piece the hint ends in, else the food's own serving times the
 *  count where that serving is one piece; never where the hint names a cut or,
 *  for a sealed pack, another vessel or a saved dish. Otherwise the count cannot
 *  say how much there is and the rungs below decide. */
export function resolvePortion(e: PortionEvidence, dishware: readonly SavedDishware[], serving: Serving): PortionResult {
  const saved = e.container === null
    ? undefined
    : dishware.find((d) => d.containerClass === e.container && (d.foodHint === null || e.canonicalHint.includes(d.foodHint)));
  if (e.count !== null) {
    const words = wordsOf(e.canonicalHint);
    const ck = countKey(words);
    if (ck !== null && !countsSomethingElse(words, ck.split("_"), false)) {
      const prior = countablePriors[ck];
      if (prior === undefined) throw new Error("countable prior key missing");
      const range = scaled(prior, e.count);
      return { gramsPoint: point(range), gramsRange: range, portionSource: "regional_prior", pieces: e.count };
    }
    const pack = PACK_UNITS.has(serving.unit);
    if (ck === null && PIECE_UNITS.has(serving.unit) && !(pack && saved !== undefined) && !countsSomethingElse(words, [serving.unit], pack)) {
      const grams = Math.round(serving.grams * e.count);
      return { gramsPoint: grams, gramsRange: [grams, grams], portionSource: "default", pieces: e.count };
    }
  }
  if (saved !== undefined) {
    const grams = dishwareGrams(saved.volumeMl, e.fillLevel ?? 1, e.canonicalHint);
    return { gramsPoint: grams, gramsRange: [grams, grams], portionSource: "user_dishware", pieces: null };
  }
  const prior = e.container === null ? undefined : containerPriors[e.container];
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
