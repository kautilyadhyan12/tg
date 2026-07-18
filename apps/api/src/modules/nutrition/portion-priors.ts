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
export interface PortionResult { gramsPoint: number; gramsRange: [number, number]; portionSource: PortionSource; }

const point = ([lo, hi]: readonly [number, number]): number => Math.round((lo + hi) / 2);
const scaled = (range: readonly [number, number], factor: number): [number, number] => [Math.round(range[0] * factor), Math.round(range[1] * factor)];
const density = (hint: string): number => {
  const normalized = hint.toLowerCase();
  if (normalized.includes("rasam") || normalized.includes("thin_dal")) return DENSITY_G_PER_ML.thin;
  if (normalized.includes("sabzi") || normalized.includes("halwa") || normalized.includes("thick_gravy")) return DENSITY_G_PER_ML.thick;
  return DENSITY_G_PER_ML.medium;
};
const countKey = (hint: string): string | null => {
  const normalized = hint.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_");
  for (const key of Object.keys(COUNTABLE_PRIORS)) if (normalized.includes(key)) return key;
  return null;
};

/** Grams from a saved dish: volume(ml) × fill(0–1) × food density. The ONE
 *  place both the scan-time rung-1 resolver (below) and the confirm-time
 *  dishware arm (service.ts, Card 5c2) compute this, so a bowl measured in the
 *  photo flow and the same bowl chosen at confirm can never disagree. */
export function dishwareGrams(volumeMl: number, fillLevel: number, canonicalHint: string): number {
  return Math.round(volumeMl * fillLevel * density(canonicalHint));
}

/** Stage 2 approved rungs: reliable count, 1, 3, 4. Anchor scaling is deferred. */
export function resolvePortion(e: PortionEvidence, dishware: readonly SavedDishware[], defaultGrams: number): PortionResult {
  const ck = countKey(e.canonicalHint);
  if (e.count !== null && ck !== null) {
    const prior = countablePriors[ck];
    if (prior === undefined) throw new Error("countable prior key missing");
    const range = scaled(prior, e.count);
    return { gramsPoint: point(range), gramsRange: range, portionSource: "regional_prior" };
  }
  if (e.container !== null) {
    const saved = dishware.find((d) => d.containerClass === e.container && (d.foodHint === null || e.canonicalHint.includes(d.foodHint)));
    if (saved !== undefined) {
      const grams = dishwareGrams(saved.volumeMl, e.fillLevel ?? 1, e.canonicalHint);
      return { gramsPoint: grams, gramsRange: [grams, grams], portionSource: "user_dishware" };
    }
    const prior = containerPriors[e.container];
    if (prior !== undefined) {
      const isWeightPrior = e.container === "thali_section";
      const range = scaled(prior, (e.fillLevel ?? 1) * (isWeightPrior ? 1 : density(e.canonicalHint)));
      return { gramsPoint: point(range), gramsRange: range, portionSource: "regional_prior" };
    }
  }
  const mound = e.sizeClass === null ? undefined : moundPriors[e.sizeClass];
  if (mound !== undefined) return { gramsPoint: point(mound), gramsRange: [...mound], portionSource: "regional_prior" };
  // The curated salvage row provides one serving value, not a sourced range;
  // do not invent a ± percentage (R0.2). The UI still receives the range
  // shape, collapsed honestly to the only sourced value.
  return { gramsPoint: defaultGrams, gramsRange: [defaultGrams, defaultGrams], portionSource: "default" };
}
