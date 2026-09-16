// P2.6a — nutrition service: orchestration for Part 2B §3's five-stage
// pipeline. Photos are NEVER persisted or logged (2B §3.4 guarantee — ruled
// precedence over v1 §6.1's R2 path); the image exists only as a request
// value handed to the vision adapter. Reformatted to house style at T3.
import { createHash, randomBytes } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { Sql } from "postgres";
import { z } from "zod";
import {
  MAX_ITEM_GRAMS,
  isNoValueWord,
  shownFoodName,
  type ChosenItem,
  type FoodMeasure,
  type FoodSearchItem,
  type LoggedMeasure,
  type Meal,
  type MealItem,
  type MealPhotoItem,
  type VisionEvidence,
} from "@app/shared";
import type { RedisLike } from "../../redis.js";
import { onMealLogged } from "../gamification/service.js";
import { refundQuota } from "../quotas/service.js";
import { getUserPlan, getUserSyncContext } from "../users/service.js";
import { targetsFromPlan } from "./targets.js";
import { CURATED_FOODS, curatedUsdaFdcId, findCurated, holdsEveryWord, searchCurated } from "./foods.js";
import { dishwareGrams, foodMeasures, gramsPerMl, measureGrams, startingMeasure } from "./measures.js";
import type { FoodReference, FoodSearchProvider } from "./openfoodfacts.adapter.js";
import { VESSEL_CONTAINERS, resolvePortion, type PortionResult } from "./portion-priors.js";
import * as repo from "./repo.js";
import { ESTIMATE_CANONICAL_PREFIX, estimateFood, priceScannedFood, type ScanLookups, type ScanPrice } from "./scanMatch.js";
import type { ConfirmMealRequest, ManualMealRequest, MealPreview, NutritionTargetsResponse, PatchMealRequest, PreviewMealRequest } from "./schemas.js";
import {
  MEAL_VISION_MODELS,
  VisionProviderError,
  visionCostMicro,
  type MealVisionModel,
  type VisionProvider,
  type VisionResult,
  type VisionUsage,
} from "./vision.adapter.js";

export const RETAKE_TTL_SECONDS = 10 * 60;
const SCAN_TTL_SECONDS = RETAKE_TTL_SECONDS;
const FOOD_CACHE_TTL_SECONDS = 24 * 60 * 60;
const CALC_VERSION = 1;

/** Typed failure for the central mapper (R8.1); messages client-safe. */
export class NutritionError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "NutritionError";
  }
}

/** A scan that failed, with the free retry the person holds next. §3.5: a photo
 *  the scanner could not read answers 422 "retake_required" with a single-use
 *  retake token (null when this attempt already rode one — tokens never chain
 *  for a photo). A scan the scanner failed answers 503, "scanner_unavailable"
 *  (busy) or "nutrition_unavailable", with a new free retry only where the scan
 *  rode one; a scan it counted is given back instead (scanFailed). */
export class ScanFailedError extends NutritionError {
  constructor(
    readonly retakeToken: string | null,
    message: string,
    statusCode: 422 | 503 = 422,
    code: "retake_required" | "scanner_unavailable" | "nutrition_unavailable" = "retake_required",
  ) {
    super(statusCode, code, message);
    this.name = "ScanFailedError";
  }
}

const SCAN_UNAVAILABLE = "Meal scanning is temporarily unavailable.";
const SCAN_BUSY = "Meal scanning is busy right now. Please try again in a minute.";

export interface NutritionDeps {
  sql: Sql;
  redis: RedisLike;
  /** null = the scanner model's key unset → scanning 503s cleanly, rest of module works. */
  vision: VisionProvider | null;
  /** The configured scanner model: it prices and names every ledger row. */
  visionModel: MealVisionModel;
  foods: FoodSearchProvider;
  log: FastifyBaseLogger;
  /** Sends a fault nobody expected to Sentry, with its request id. */
  reportError: (err: unknown, requestId: string) => void;
}

// Internal draft/cache parser consumes the stable nutrition fields and strips
// the curated list's own diet and citation.
const foodSchema = z.object({
  canonical: z.string(),
  name: z.string(),
  // Physical per-100g bounds (T3 manual-off-foods): a cached entry breaching
  // them fails the parse and degrades to a re-search, never into a meal.
  kcal: z.number().min(0).max(1000),
  proteinG: z.number().min(0).max(100),
  carbsG: z.number().min(0).max(100),
  fatG: z.number().min(0).max(100),
  fiberG: z.number().min(0).max(100).nullable(),
  serving: z.number(),
  unit: z.string(),
  source: z.enum(["curated", "openfoodfacts", "usda", "estimate"]),
});

const draftSchema = z
  .object({
    userId: z.string().uuid(),
    mealName: z.string(),
    foods: z.array(foodSchema),
    items: z.array(
      z
        .object({
          canonical: z.string(),
          gramsPoint: z.number(),
          gramsRange: z.tuple([z.number(), z.number()]),
          portionSource: z.enum(["user_dishware", "regional_prior", "default"]),
        })
        .strict(),
    ),
  })
  .strict();
type Draft = z.infer<typeof draftSchema>;

const token = (): string => randomBytes(32).toString("base64url");
const digest = (v: string): string => createHash("sha256").update(v).digest("hex");
const retakeKey = (userId: string, v: string): string => `meal-retake:${userId}:${digest(v)}`;
const scanKey = (userId: string, v: string): string => `meal-scan:${userId}:${digest(v)}`;

/** One ledger row per provider response (v1 §9.3). Standalone insert: a scan
 *  persists no companion rows at spend time (ruled — DECISIONS 2026-07-12). */
async function ledger(deps: NutritionDeps, userId: string, usage: VisionUsage): Promise<void> {
  await repo.insertCostEvent(deps.sql, {
    userId,
    gymId: await repo.getLiveGymId(deps.sql, userId),
    provider: `${MEAL_VISION_MODELS[deps.visionModel].provider}:${deps.visionModel}`,
    tokens: usage.tokensIn + usage.tokensOut,
    costMicro: visionCostMicro(deps.visionModel, usage.tokensIn, usage.tokensOut),
  });
}

async function issueRetake(deps: NutritionDeps, userId: string): Promise<string> {
  const value = token();
  const stored = await deps.redis.setex(retakeKey(userId, value), RETAKE_TTL_SECONDS, "1");
  if (!stored) throw new NutritionError(503, "quota_unavailable", "Meal scanning is temporarily unavailable.");
  return value;
}

/** How many of one person's scans may fail at the scanner within
 *  SCANNER_PAUSE_SECONDS of the first; after that their scans are refused before
 *  they take anything until those seconds are up, so a scanner that keeps
 *  failing is not called for nothing, nor kept at its limit by one person. The
 *  pause is shorter than a free retry lasts, so one given back as it begins
 *  outlives it. */
export const MAX_SCANNER_FAILURES = 3;
export const SCANNER_PAUSE_SECONDS = 5 * 60;
const scannerFailuresKey = (userId: string): string => `meal-scanner-failures:${userId}`;

/** Whether this person's scans are paused. Redis down reads as not paused: the
 *  free retry and the scan count that come next both fail closed. */
export async function scannerPaused(deps: Pick<NutritionDeps, "redis">, userId: string): Promise<boolean> {
  const failures = await deps.redis.get(scannerFailuresKey(userId));
  return failures !== null && Number(failures) >= MAX_SCANNER_FAILURES;
}

/** What a scan took from the person before it ran: the free retry it rode, or
 *  one of their scans, counted under its quota key. */
export type ScanPaidWith = { retake: true } | { quotaKey: string };

/** Gives the person back what a failed scan took: the scan it counted, or, for
 *  a scan that rode a free retry, a new free retry, returned for the response. */
async function giveBack(deps: NutritionDeps, userId: string, paidWith: ScanPaidWith): Promise<string | null> {
  if ("retake" in paidWith) return await issueRetake(deps, userId);
  if (!(await refundQuota(deps.redis, paidWith.quotaKey))) {
    deps.log.warn({ event: "nutrition.scan_refund_failed", userId }, "a failed scan could not be given back");
  }
  return null;
}

/** Atomic single-use consume (Lua GET+DEL). Redis down → fail closed. */
export async function consumeRetake(deps: NutritionDeps, userId: string, value: string): Promise<boolean> {
  const taken = await deps.redis.take(retakeKey(userId, value));
  if (taken === null) throw new NutritionError(503, "quota_unavailable", "Meal scanning is temporarily unavailable.");
  if (taken === undefined) throw new NutritionError(400, "invalid_retake", "Invalid or expired retake token.");
  return true;
}

// ── food search (Stage 3 sources: curated → cached OpenFoodFacts) ───────────

const foodRefKey = (canonical: string): string => `food:ref:${digest(canonical.toLowerCase())}`;

/** What a canonical of the USDA table looks like (`usda_sr_...`, `usda_fndds_...`). */
const USDA_CANONICAL_PREFIX = /^usda_(?:sr|fndds)_/;

/** Card-5b smoke finding: every food a search RETURNS must stay resolvable by
 *  its canonical afterwards — the manual-log/preview path looks foods up by
 *  canonical, and an OFF slug full-text-searched against OFF misses (the
 *  slug is ours, not their product name). So each returned food is also
 *  cached individually under its canonical. */
async function rememberFoods(deps: NutritionDeps, foods: readonly FoodReference[]): Promise<void> {
  // First-wins within a batch: if OFF ever yields same-canonical products
  // (code-less fallback slugs), the entry the user SEES ranked first is the
  // one that must resolve on save (T3 manual-off-foods).
  const seen = new Set<string>();
  await Promise.all(
    foods
      .filter((food) => (seen.has(food.canonical) ? false : (seen.add(food.canonical), true)))
      .map((food) => deps.redis.setex(foodRefKey(food.canonical), FOOD_CACHE_TTL_SECONDS, JSON.stringify(food))),
  );
}

async function canonicalCached(deps: NutritionDeps, canonical: string): Promise<FoodReference | null> {
  const raw = await deps.redis.get(foodRefKey(canonical));
  if (raw === null) return null;
  try {
    const parsed = foodSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function cachedExternal(deps: NutritionDeps, query: string, limit: number): Promise<FoodReference[]> {
  const key = `food:off:${digest(`${query.toLowerCase()}:${String(limit)}`)}`;
  const cached = await deps.redis.get(key);
  if (cached !== null) {
    try {
      const parsed = foodSchema.array().safeParse(JSON.parse(cached));
      if (parsed.success) return parsed.data;
    } catch {
      /* corrupt cache degrades to provider */
    }
  }
  const found = await deps.foods.search(query, limit);
  if (found.length > 0) {
    await deps.redis.setex(key, FOOD_CACHE_TTL_SECONDS, JSON.stringify(found));
    await rememberFoods(deps, found);
  }
  return found;
}

/** A curated food as the search box receives it: the fields every food has,
 *  without the list's diet and citation, which no response contract carries. */
const asReference = ({ canonical, name, kcal, proteinG, carbsG, fatG, fiberG, serving, unit, source }: FoodReference): FoodReference =>
  ({ canonical, name, kcal, proteinG, carbsG, fatG, fiberG, serving, unit, source });

/** A USDA table row as the search box receives it. Its name is USDA's own
 *  description; the screen says where it came from, which is what USDA asks in
 *  return for the data (RULINGS 2026-09-16). */
const asUsdaReference = (row: repo.UsdaFoodRow): FoodReference => ({
  canonical: repo.usdaCanonical(row),
  name: row.description,
  kcal: row.kcal,
  proteinG: row.proteinG,
  carbsG: row.carbsG,
  fatG: row.fatG,
  fiberG: row.fiberG,
  serving: row.servingGrams,
  unit: row.servingUnit,
  source: "usda",
});

/** Kd's ruling, 2026-09-16: OUR LIST FIRST, then USDA, then packaged products.
 *  313 of the list's 318 foods copy their numbers from a USDA entry, so the
 *  order costs nothing in accuracy and puts a plain name ("Paneer") ahead of a
 *  technical one; the five that do not are the foods where USDA's own entry is
 *  wrong for how they are made here (its paneer is worked out from milk and
 *  vinegar and keeps the milk's sugar, 22.5 g of carbohydrate per 100 g, against
 *  CoFID's nine analysed samples at 0.9 g), and those must not be outranked by
 *  the entry Kd rejected on 2026-09-14. USDA then fills what the list lacks,
 *  which is 13,225 foods of it.
 *
 *  THE LAST FEW PLACES ARE HELD FOR A PACKAGED PRODUCT. Rank is not room: with
 *  13,225 USDA foods a GENERIC word filled every place and a jar never appeared
 *  at all (measured 2026-09-16 against the loaded table, in a box of 15: "milk"
 *  10 curated + 5 USDA, "peanut butter" 2 + 13, "greek yogurt" 1 + 14 — nought
 *  left over each time), which shrank a rung nobody ruled out. So USDA fills the
 *  page only down to `PACKAGED_RESERVE`, and those places go to Open Food Facts
 *  where it has something to put in them — still last, as Kd ruled. Nothing is
 *  held back from a brand: a query USDA cannot answer ("yakult" 0 rows, "oreo"
 *  2, "nutella" 2) still gives the whole page to packaged products.
 *
 *  The reserve is never more of the box than USDA keeps: at most half of the
 *  places left, so a rung below never outnumbers the one above it when both
 *  could fill the box. Four places left read two USDA foods and two jars, not
 *  one and three; where the curated list has nearly filled the box ("bread"
 *  leaves two places), one goes to USDA and one to a jar; and a single place is
 *  USDA's. */
const PACKAGED_RESERVE = 3;

export async function searchFoods(deps: NutritionDeps, query: string, limit: number): Promise<FoodSearchItem[]> {
  return await withMeasures(deps, await searchFoodReferences(deps, query, limit));
}

async function searchFoodReferences(deps: NutritionDeps, query: string, limit: number): Promise<FoodReference[]> {
  const local = searchCurated(query, limit).map(asReference);
  if (local.length >= limit) return local;
  const room = limit - local.length;
  const usda = (await repo.searchUsdaFoods(deps.sql, query, room)).map(asUsdaReference);
  // What USDA leaves, or the reserve, whichever is larger. The reserve itself is
  // never more than half of what is left.
  const reserve = Math.min(PACKAGED_RESERVE, Math.floor(room / 2));
  const packagedRoom = Math.max(room - usda.length, reserve);
  const external = packagedRoom > 0 ? await cachedExternal(deps, query, packagedRoom) : [];
  const usdaKeeps = Math.max(0, room - external.length);
  return [...local, ...usda.slice(0, usdaKeeps), ...external].slice(0, limit);
}

// ── measures (ROADMAP 7a-iv-a; RULINGS 2026-09-16, the portion redesign) ─────

/** The USDA entry whose household measures a food has: the food itself, for one
 *  of the USDA table's; the entry it cites, for one of our list's; none for a
 *  packaged product or a scan's estimate. */
const measuresEntry = (food: FoodReference): number | null =>
  food.source === "usda" ? repo.usdaFdcId(food.canonical) : food.source === "curated" ? curatedUsdaFdcId(food.canonical) : null;

/** Every food's measures (`measures.ts`), `[i]` for `foods[i]`, with ONE read of
 *  the USDA measures they share. */
async function measuresOf(deps: Pick<NutritionDeps, "sql">, foods: readonly FoodReference[]): Promise<FoodMeasure[][]> {
  const entries = foods.map(measuresEntry);
  const portions = await repo.usdaPortionsFor(deps.sql, entries.filter((id): id is number => id !== null));
  return foods.map((food, at) => {
    const entry = entries[at] ?? null;
    return foodMeasures({ serving: food.serving, unit: food.unit, portions: entry === null ? [] : (portions.get(entry) ?? []) });
  });
}

/** The search box's foods, each with its measures and the one it starts at. */
async function withMeasures(deps: NutritionDeps, foods: readonly FoodReference[]): Promise<FoodSearchItem[]> {
  const measures = await measuresOf(deps, foods);
  return foods.map((food, at) => {
    const own = measures[at] ?? foodMeasures({ serving: food.serving, unit: food.unit, portions: [] });
    return {
      ...asReference(food),
      measures: own,
      startsAt: startingMeasure(food, own),
    };
  });
}

/** What one chosen item comes to for its food: grams as sent · a saved dish of
 *  THIS person's (another's is refused, never priced) × how full, weighed by the
 *  food's own cup · one of the food's own measures × how many, looked up in the
 *  server's list for that food, so a measure the food does not have is refused
 *  and no request says what a measure weighs. The dish and the measure are kept
 *  on the item, by the name the list or the person gave them. */
async function amountOf(
  deps: NutritionDeps,
  userId: string,
  chosen: ChosenItem,
  food: FoodReference,
): Promise<{ grams: number; dishwareRung: "user_dishware" | null; measure: LoggedMeasure | null }> {
  if ("grams" in chosen) return { grams: chosen.grams, dishwareRung: null, measure: null };
  const [measures = []] = await measuresOf(deps, [food]);
  const tooSmallOrLarge = (grams: number): boolean => grams < 1 || grams > MAX_ITEM_GRAMS;
  if ("dishwareId" in chosen) {
    const dish = await repo.getDishware(deps.sql, userId, chosen.dishwareId);
    if (dish === null) throw new NutritionError(400, "unknown_dishware", "Dishware not found.");
    const grams = dishwareGrams(dish.volumeMl, chosen.fillLevel, gramsPerMl(measures));
    // Symmetric with the grams arm's bounds (chosenItemsSchema: positive, ≤10_000):
    // a round-to-0 (tiny dish × low fill) would persist a MealItem the shared
    // contract declares impossible, and more than 10_000 would pass the cap the
    // grams arm enforces at the schema.
    if (tooSmallOrLarge(grams)) {
      throw new NutritionError(400, "portion_out_of_range", "That portion is too small or too large to log — pick a different fill or enter grams.");
    }
    return { grams, dishwareRung: "user_dishware", measure: { id: "dish", name: dish.label, amount: chosen.fillLevel } };
  }
  const measure = measures.find((m) => m.id === chosen.measure);
  if (measure === undefined) throw new NutritionError(400, "unknown_measure", "That measure is not one of this food's.");
  const grams = measureGrams(measure, chosen.amount);
  if (tooSmallOrLarge(grams)) {
    throw new NutritionError(400, "portion_out_of_range", "That portion is too small or too large to log — pick a different amount.");
  }
  return { grams, dishwareRung: null, measure: { id: measure.id, name: measure.name, amount: chosen.amount } };
}

async function findFood(deps: NutritionDeps, query: string): Promise<FoodReference | null> {
  // An est_* canonical is a scan's own estimate, and lives only in that scan's
  // draft and the meal saved from it: nothing may look one up by name, or a
  // request could price a food at figures no table and no scan gave it.
  if (query.startsWith(ESTIMATE_CANONICAL_PREFIX)) return null;
  // A usda_* canonical is one row of our own table and nothing else: it must
  // not reach findCurated's fuzzy match, and one the table does not hold must
  // not be handed to OpenFoodFacts as if it were a food's NAME (searching their
  // index for "usda_sr_167512" can only ever find a wrong food).
  if (USDA_CANONICAL_PREFIX.test(query)) {
    const row = await repo.usdaFoodByCanonical(deps.sql, query);
    return row === null ? null : asUsdaReference(row);
  }
  // T3 (manual-off-foods): an off_* canonical must NEVER resolve through
  // findCurated's fuzzy substring match — off_banana_chips would hijack to
  // curated "banana" and save macros different from what search displayed.
  if (!query.startsWith("off_")) {
    const local = findCurated(query);
    if (local !== null) return local;
  }
  // Canonical-keyed cache (foods a search already returned — the manual-log
  // path); full-text search is the last resort.
  const remembered = await canonicalCached(deps, query);
  if (remembered !== null) return remembered;
  return (await cachedExternal(deps, query, 1))[0] ?? null;
}

/** Where a scanned food's numbers come from (`scanMatch.ts`): our list by whole
 *  words; the USDA table; a packaged product (§3.5) only where the product's name
 *  holds every word of the hint — the search's top product for other words is
 *  another food ("mystery sauce" finds one named "Mystery"). */
const scanLookups = (deps: NutritionDeps): ScanLookups => ({
  ourList: (hint) => {
    const food = findCurated(hint);
    return food === null ? null : asReference(food);
  },
  usda: async (hint, seen) => {
    const found = await repo.usdaFoodForScan(deps.sql, hint, seen);
    return found === null ? null : asUsdaReference(found.food);
  },
  packaged: async (hint) => {
    const [product] = await cachedExternal(deps, hint, 1);
    return product !== undefined && holdsEveryWord(product.name, hint) ? product : null;
  },
});

// ── Stage-3 arithmetic + §3.3 display standard ───────────────────────────────

const round1 = (v: number): number => Math.round(v * 10) / 10;

function nutritionItem(
  food: FoodReference,
  gramsPoint: number,
  gramsRange: [number, number],
  portionSource: "user_dishware" | "regional_prior" | "default",
  measure: LoggedMeasure | null = null,
): MealItem {
  const scale = gramsPoint / 100;
  // Kd DEVIATION ruling 2026-07-16 (supersedes §3.3's round-to-10 display
  // standard): kcal are exact integers — 2 apples read 187, not 190. The
  // point still lives INSIDE its own range (T3 P2.6a finding 1); with whole-
  // kcal rounding the clamp is only reachable on adversarial float edges.
  const kcalLow = Math.max(0, Math.round((food.kcal * gramsRange[0]) / 100));
  const kcalHigh = Math.max(0, Math.round((food.kcal * gramsRange[1]) / 100));
  const kcalPoint = Math.min(Math.max(Math.round(food.kcal * scale), kcalLow), kcalHigh);
  return {
    name: food.name,
    canonical: food.canonical,
    gramsPoint,
    gramsRange,
    portionSource,
    nutritionSource: food.source,
    kcalPoint,
    kcalLow,
    kcalHigh,
    proteinG: round1(food.proteinG * scale),
    carbsG: round1(food.carbsG * scale),
    fatG: round1(food.fatG * scale),
    // An estimate has no table to be priced again from, so its item carries its
    // figures, and the saved meal can change its grams later (patchMeal).
    ...(food.source === "estimate" ? { per100g: { kcal: food.kcal, proteinG: food.proteinG, carbsG: food.carbsG, fatG: food.fatG } } : {}),
    ...(measure === null ? {} : { measure }),
  };
}

/** The food an estimate item of a saved meal stands for, from the figures the
 *  item carries — never from anything a request sends. */
const estimateOf = (item: MealItem): FoodReference | null =>
  item.nutritionSource === "estimate" && item.per100g !== undefined
    ? { canonical: item.canonical, name: item.name, ...item.per100g, fiberG: null, serving: item.gramsPoint, unit: "g", source: "estimate" }
    : null;

const asMeal = (r: repo.MealRow): Meal => ({
  id: r.id,
  takenAt: r.takenAt.toISOString(),
  mealType: r.mealType,
  mealName: r.mealName,
  items: r.items,
  totals: {
    kcalPoint: r.kcalPoint,
    kcalLow: r.kcalLow,
    kcalHigh: r.kcalHigh,
    proteinG: r.proteinG,
    carbsG: r.carbsG,
    fatG: r.fatG,
  },
  confirmed: r.confirmed,
  origin: r.origin,
  portionSource:
    r.portionSource === "legacy"
      ? "legacy"
      : r.portionSource === "default"
        ? "default"
        : r.portionSource === "regional_prior"
          ? "regional_prior"
          : "user_dishware",
  nutritionSources: r.nutritionSources,
  calcVersion: r.calcVersion,
});

const totals = (items: readonly MealItem[]) => ({
  kcalPoint: items.reduce((n, i) => n + i.kcalPoint, 0),
  kcalLow: items.reduce((n, i) => n + i.kcalLow, 0),
  kcalHigh: items.reduce((n, i) => n + i.kcalHigh, 0),
  proteinG: round1(items.reduce((n, i) => n + i.proteinG, 0)),
  carbsG: round1(items.reduce((n, i) => n + i.carbsG, 0)),
  fatG: round1(items.reduce((n, i) => n + i.fatG, 0)),
});

/** Daily calorie + macro targets for the signed-in user (R3.1: derived
 *  server-side from stored profile data, never from anything the client sends).
 *  Returns targets OR the list of details still missing — never a default. */
export async function getTargets(deps: NutritionDeps, userId: string): Promise<NutritionTargetsResponse> {
  // The rings' numbers ARE the plan's (ROADMAP 4a-iii). No time zone is sent:
  // it only dates the finish, which the rings do not show, so the stored zone
  // serves. targetsFromPlan parses through the shared contract, so the
  // null-exactly-when-missing refine() holds for every caller.
  return targetsFromPlan(await getUserPlan(deps.sql, userId, null));
}

/** Shared badge hook: failure degrades with a warn — a meal save must never
 *  break on gamification (event name + id only, R3.10). */
async function awardMealBadges(deps: NutritionDeps, userId: string): Promise<void> {
  const ctx = await getUserSyncContext(deps.sql, userId);
  await onMealLogged({ sql: deps.sql }, userId, ctx.timezone).catch((err: unknown) => {
    deps.log.warn(
      { event: "gamification.meal_award_failed", userId, errName: err instanceof Error ? err.name : typeof err },
      "meal badge evaluation failed",
    );
  });
}

// ── Stage 1+2: analyze ───────────────────────────────────────────────────────

/** The grams the model saw, and its count of whole pieces where it gave one,
 *  which the sheet's stepper steps by. */
const seenPortion = (grams: number, count: number | null): PortionResult =>
  ({ gramsPoint: grams, gramsRange: [grams, grams], portionSource: "default", pieces: count });

/** One of the food's own serving, uncounted. */
const servingOnce = (food: FoodReference): PortionResult =>
  ({ gramsPoint: food.serving, gramsRange: [food.serving, food.serving], portionSource: "default", pieces: null });

/** The photo sheet for what the model saw, once each food is priced (`prices[i]`
 *  is `evidence.items[i]`'s): every food on it, by a table or by its estimate
 *  (ROADMAP 7a-iii-b); the foods and portions the draft keeps for the confirm;
 *  and what stays out of the total. Pure, so the eight plates can be run through
 *  it (test/fixtures/plates).
 *
 *  Honest unknown (§3.5): what the model could not identify, and a food nothing
 *  prices that the model gave no usable number for, stay out of the totals and
 *  are named once each rather than dropped without a word. A name that says there
 *  is none (blank, "none", "N/A", "unknown") is never shown: an item's reads as
 *  its hint. */
export function scanSheet(
  evidence: VisionEvidence,
  prices: readonly ScanPrice[],
): { foods: FoodReference[]; draftItems: Draft["items"]; items: MealPhotoItem[]; unknownItems: string[] } {
  const foods: FoodReference[] = [];
  const draftItems: Draft["items"] = [];
  const items: MealPhotoItem[] = [];
  const unknownItems: string[] = [];
  const nameUnknown = (label: string): void => {
    const shown = label.replaceAll(/[_\s]+/g, " ").trim();
    if (!isNoValueWord(shown) && !unknownItems.some((u) => u.toLowerCase() === shown.toLowerCase())) unknownItems.push(shown);
  };
  for (const label of evidence.unknown_items) nameUnknown(label);
  const taken = new Set<string>();
  for (const [at, item] of evidence.items.entries()) {
    const price = prices[at];
    if (price === undefined || price.kind === "none") {
      nameUnknown(shownFoodName(item));
      continue;
    }
    let food: FoodReference;
    let portion: PortionResult;
    if (price.kind === "estimate") {
      food = estimateFood(shownFoodName(item), price.per100g, price.grams, taken);
      portion = seenPortion(price.grams, item.count);
    } else if (price.food.source === "usda") {
      // A USDA food is served as an estimate is, by the grams the model saw. Its
      // serving is USDA's first household measure ("1 cup, 230 g"), which the rules
      // below were written without: they read a count of two pumpkin pieces as two
      // cups, 460 g where the model saw 60. Where the model gave no grams, USDA's
      // serving once. 7a-iv weighs every food by its USDA piece and cup weights.
      food = price.food;
      portion = item.grams === null ? servingOnce(food) : seenPortion(item.grams, item.count);
    } else {
      food = price.food;
      // Our list's foods and packaged products keep the rule they were scanned by
      // before 7a-iii-b, until 7a-iv-b (Kd, RULINGS 2026-09-16) — with no saved
      // dish: a dish is never chosen for the person, only picked by them as a
      // measure (RULINGS 2026-07-18, and the portion redesign of 2026-09-16).
      portion = resolvePortion(
        {
          canonicalHint: item.canonical_hint,
          container: item.vessel === null ? null : VESSEL_CONTAINERS[item.vessel],
          fillLevel: item.fill_level,
          sizeClass: item.size_class,
          count: item.count,
        },
        [],
        { grams: food.serving, unit: food.unit },
      );
    }
    taken.add(food.canonical);
    foods.push(food);
    // The stored draft keeps its strict shape: the count of pieces is only the
    // sheet's, for its stepper.
    draftItems.push({ canonical: food.canonical, gramsPoint: portion.gramsPoint, gramsRange: portion.gramsRange, portionSource: portion.portionSource });
    items.push({ ...nutritionItem(food, portion.gramsPoint, portion.gramsRange, portion.portionSource), pieces: portion.pieces });
  }
  return { foods, draftItems, items, unknownItems };
}

export interface ScanDraftResponse {
  scanToken: string;
  mealName: string;
  items: MealPhotoItem[];
  unknownItems: string[];
  photoQuality: "good";
  totals: ReturnType<typeof totals>;
  confirmed: false;
}

export async function analyzePhoto(
  deps: NutritionDeps,
  userId: string,
  imageBase64: string,
  mimeType: string,
  paidWith: ScanPaidWith,
  requestId: string,
): Promise<ScanDraftResponse> {
  if (deps.vision === null) {
    throw new NutritionError(503, "nutrition_unavailable", SCAN_UNAVAILABLE);
  }
  try {
    return await readMealPhoto(deps, deps.vision, userId, imageBase64, mimeType, "retake" in paidWith, requestId);
  } catch (err) {
    // A photo that asks for a retake is answered as it is, and so is a store
    // that cannot be reached (its typed 503), where nothing could be given back.
    if (err instanceof NutritionError) throw err;
    throw await scanFailed(deps, userId, paidWith, requestId, err);
  }
}

/** A scan that fails for anything but the photo — the provider down or refusing
 *  it, or a fault anywhere in reading and resolving it — costs the person nothing
 *  (Part 8 §5.3: no quota consumed on failures): what the scan took is given
 *  back, and the failure counts toward this person's pause. They are told the
 *  scanner is busy while a try soon may work (an outage, before the pause), and
 *  that it is unavailable otherwise; never that the photo was bad. */
async function scanFailed(
  deps: NutritionDeps,
  userId: string,
  paidWith: ScanPaidWith,
  requestId: string,
  err: unknown,
): Promise<ScanFailedError> {
  // Anything thrown that is not a VisionProviderError is a fault in our own code or stores.
  const kind = err instanceof VisionProviderError ? err.kind : "fault";
  const failure = {
    event: "nutrition.scan_failed",
    userId,
    model: deps.visionModel,
    kind,
    reason: err instanceof VisionProviderError ? err.message : err instanceof Error ? err.name : typeof err,
    requestId,
  };
  if (kind === "fault") {
    deps.log.error({ ...failure, err }, "meal scanner fault");
    deps.reportError(err, requestId);
  } else {
    deps.log.error(failure, kind === "unavailable" ? "meal scanner unavailable" : "meal scanner request refused");
  }
  const retakeToken = await giveBack(deps, userId, paidWith);
  const failures = await deps.redis.incrWithTtl(scannerFailuresKey(userId), SCANNER_PAUSE_SECONDS);
  return kind === "unavailable" && failures !== null && failures < MAX_SCANNER_FAILURES
    ? new ScanFailedError(retakeToken, SCAN_BUSY, 503, "scanner_unavailable")
    : new ScanFailedError(retakeToken, SCAN_UNAVAILABLE, 503, "nutrition_unavailable");
}

/** Stages 1 and 2: the model reads the photo, and each food it names is resolved
 *  to grams. A photo that cannot be read asks for a retake; any other failure is
 *  thrown for analyzePhoto to answer. */
async function readMealPhoto(
  deps: NutritionDeps,
  vision: VisionProvider,
  userId: string,
  imageBase64: string,
  mimeType: string,
  usedRetake: boolean,
  requestId: string,
): Promise<ScanDraftResponse> {
  let result: VisionResult;
  try {
    result = await vision.analyze(imageBase64, mimeType);
  } catch (err) {
    if (!(err instanceof VisionProviderError) || err.kind !== "unreadable") throw err;
    // The model answered, and its answer cannot be used. Money was spent, so it
    // is ledgered (only the model's answer carries usage: no completion, no
    // ledger row — ruled, DECISIONS), and the photo is asked for again.
    if (err.usage !== undefined) await ledger(deps, userId, err.usage);
    deps.log.warn(
      { event: "nutrition.scan_failed", userId, model: deps.visionModel, kind: err.kind, reason: err.message, requestId },
      "meal scanner reply unusable",
    );
    const rt = usedRetake ? null : await issueRetake(deps, userId);
    throw new ScanFailedError(rt, "We could not read that photo. Please retake it with the full plate in frame.");
  }

  await ledger(deps, userId, result);
  // A reply that identifies no food is a poor photo, whatever it calls itself:
  // a free retake, never a charged draft with nothing on it.
  if (result.evidence.photo_quality === "poor" || result.evidence.items.length === 0) {
    const rt = usedRetake ? null : await issueRetake(deps, userId);
    throw new ScanFailedError(rt, "Please retake the photo in better light with the full plate visible.");
  }

  // Stage 2: price each identified food, then resolve its portion. Each food is
  // priced on its own, so they are asked together: a plate of unlisted foods waits
  // for its slowest packaged-product search, not their sum.
  const lookups = scanLookups(deps);
  const prices = await Promise.all(result.evidence.items.map((evidence) => priceScannedFood(evidence, lookups)));
  const { foods, draftItems, items, unknownItems } = scanSheet(result.evidence, prices);

  const scanToken = token();
  // A good photo the model did not name is "Meal", as a renamed-to-nothing
  // meal is (patchMeal below); a photo with nothing to name is a poor one.
  const mealName = result.evidence.meal_name ?? "Meal";
  const draft: Draft = { userId, mealName, foods, items: draftItems };
  const stored = await deps.redis.setex(scanKey(userId, scanToken), SCAN_TTL_SECONDS, JSON.stringify(draft));
  if (!stored) throw new NutritionError(503, "nutrition_unavailable", SCAN_UNAVAILABLE);

  return {
    scanToken,
    mealName,
    items,
    unknownItems,
    photoQuality: "good",
    totals: totals(items),
    confirmed: false,
  };
}

// ── Stage 4: confirm / manual entry ──────────────────────────────────────────

function parseDraft(raw: string, userId: string): Draft {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new NutritionError(400, "invalid_scan", "Invalid or expired scan token.");
  }
  const parsed = draftSchema.safeParse(json);
  if (!parsed.success || parsed.data.userId !== userId) {
    throw new NutritionError(400, "invalid_scan", "Invalid or expired scan token.");
  }
  return parsed.data;
}

async function takeDraft(deps: NutritionDeps, userId: string, value: string): Promise<Draft> {
  const raw = await deps.redis.take(scanKey(userId, value));
  if (raw === null) {
    throw new NutritionError(503, "nutrition_unavailable", "Meal confirmation is temporarily unavailable.");
  }
  if (raw === undefined) throw new NutritionError(400, "invalid_scan", "Invalid or expired scan token.");
  return parseDraft(raw, userId);
}

/** Non-destructive draft read — get, never take: the single-use confirm draft
 *  must survive previews (and a rejected confirm). RedisLike.get conflates
 *  missing and backend-down as null, so callers that need to tell those apart
 *  fall through to takeDraft, whose Lua GET+DEL does distinguish them. */
async function readDraft(deps: NutritionDeps, userId: string, value: string): Promise<Draft | null> {
  const raw = await deps.redis.get(scanKey(userId, value));
  return raw === null ? null : parseDraft(raw, userId);
}

/** Preview's read: degrades to 400 whether the draft is missing or Redis is
 *  down (the client falls back to the analysis estimates either way). */
async function peekDraft(deps: NutritionDeps, userId: string, value: string): Promise<Draft> {
  const draft = await readDraft(deps, userId, value);
  if (draft === null) throw new NutritionError(400, "invalid_scan", "Invalid or expired scan token.");
  return draft;
}

/** Photo confirm/preview item resolution (Card 5c — meal composition). A
 *  chosen item either belongs to the scan draft (its rung is preserved unless
 *  the user re-measured it with a dish) or is an EXTRA the user added by search
 *  (the oats-with-milk case) — resolved via findFood at rung 'default'; the
 *  canonical cache makes OFF foods loggable here too. `original` is the item's
 *  pre-edit draft estimate, or null for an extra (an extra was never estimated,
 *  so it is EXCLUDED from the Stage-5 correction pair entirely — an addition is
 *  not an estimate error; DECISIONS 2026-07-17). ONE implementation for confirm
 *  and preview so live math cannot diverge from what is saved (T3). */
async function resolveDraftItem(
  deps: NutritionDeps,
  userId: string,
  draft: Draft,
  chosen: ChosenItem,
): Promise<{ item: MealItem; original: MealItem | null }> {
  const food = draft.foods.find((f) => f.canonical === chosen.canonical);
  const estimate = draft.items.find((i) => i.canonical === chosen.canonical);
  if (food !== undefined && estimate !== undefined) {
    // User-chosen amount collapses the range; a dishware measure overrides the
    // rung to 'user_dishware', otherwise the estimate's rung is preserved.
    const amount = await amountOf(deps, userId, chosen, food);
    const rung = amount.dishwareRung ?? estimate.portionSource;
    return {
      item: nutritionItem(food, amount.grams, [amount.grams, amount.grams], rung, amount.measure),
      original: nutritionItem(food, estimate.gramsPoint, estimate.gramsRange, estimate.portionSource),
    };
  }
  const extra = await findFood(deps, chosen.canonical);
  if (extra === null) throw new NutritionError(400, "unknown_food", "Food reference not found.");
  const amount = await amountOf(deps, userId, chosen, extra);
  return {
    item: nutritionItem(extra, amount.grams, [amount.grams, amount.grams], amount.dishwareRung ?? "default", amount.measure),
    original: null,
  };
}

/** Resolve every chosen item against the draft (extras included) into the meal
 *  items plus the estimated-only Stage-5 correction pair. Pure w.r.t. Redis —
 *  it does not consume the draft, so a rejection here never burns the scan. */
async function buildConfirmItems(
  deps: NutritionDeps,
  userId: string,
  draft: Draft,
  input: ConfirmMealRequest,
): Promise<{ items: MealItem[]; originalItems: MealItem[]; correctedItems: MealItem[] }> {
  const items: MealItem[] = [];
  const originalItems: MealItem[] = [];
  const correctedItems: MealItem[] = [];
  for (const chosen of input.items) {
    const { item, original } = await resolveDraftItem(deps, userId, draft, chosen);
    items.push(item);
    // Only ESTIMATED items form the Stage-5 correction pair. An added item was
    // never estimated, so it belongs to the meal but not to the estimate-error
    // signal (T3 Card 5c; DECISIONS 2026-07-12 T3 finding 3).
    if (original !== null) {
      originalItems.push(original);
      correctedItems.push(item);
    }
  }
  return { items, originalItems, correctedItems };
}

async function persistConfirm(
  deps: NutritionDeps,
  userId: string,
  input: ConfirmMealRequest,
  draft: Draft,
  built: { items: MealItem[]; originalItems: MealItem[]; correctedItems: MealItem[] },
): Promise<Meal> {
  const row = await repo.createMeal(deps.sql, userId, {
    correctedItems: built.correctedItems,
    takenAt: new Date(input.takenAt),
    mealType: input.mealType ?? null,
    mealName: draft.mealName,
    items: built.items,
    origin: "photo",
    originalItems: built.originalItems,
  });
  await awardMealBadges(deps, userId);
  return asMeal(row);
}

export async function confirmMeal(deps: NutritionDeps, userId: string, input: ConfirmMealRequest): Promise<Meal> {
  // Resolve EVERYTHING before consuming the single-use draft (T3 Card 5c).
  // takeDraft is destructive, so resolving after it meant one unresolvable
  // item (an added ingredient whose canonical has aged out of the food cache)
  // destroyed the scan: the 400 left the user with a dead scanToken and no way
  // back except another photo — a fresh vision call and another quota unit.
  const peeked = await readDraft(deps, userId, input.scanToken);
  if (peeked !== null) {
    const built = await buildConfirmItems(deps, userId, peeked, input);
    // Everything that could reject has passed — NOW consume the draft. Still
    // the atomic single-use gate: two concurrent confirms both read, but only
    // one take() returns the draft; the loser gets its 400 here.
    await takeDraft(deps, userId, input.scanToken);
    return await persistConfirm(deps, userId, input, peeked, built);
  }
  // get() returned null: the draft is expired, OR Redis was momentarily down.
  // take()'s Lua GET+DEL distinguishes them (undefined → 400, null → 503) and,
  // if Redis flapped back up in the window, returns the LIVE draft — which we
  // must not discard by blindly throwing 400 (T3 F3: that path was added to
  // stop scans being burned, and would itself burn a recovered one). Build
  // from the taken draft (already consumed, so a resolve failure here burns it
  // — accepted only in this rare flap window).
  const recovered = await takeDraft(deps, userId, input.scanToken);
  const built = await buildConfirmItems(deps, userId, recovered, input);
  return await persistConfirm(deps, userId, input, recovered, built);
}

/** Search-resolved items for the manual flow — ONE implementation shared by
 *  createManualMeal and previewMeal (T3: divergence here is a trust bug). */
async function resolveChosenItems(
  deps: NutritionDeps,
  userId: string,
  chosenItems: readonly ChosenItem[],
): Promise<MealItem[]> {
  const items: MealItem[] = [];
  for (const chosen of chosenItems) {
    const food = await findFood(deps, chosen.canonical);
    if (food === null) throw new NutritionError(400, "unknown_food", "Food reference not found.");
    const amount = await amountOf(deps, userId, chosen, food);
    items.push(nutritionItem(food, amount.grams, [amount.grams, amount.grams], amount.dishwareRung ?? "default", amount.measure));
  }
  return items;
}

/** GAP-2 ruling: manual logging — items resolve via food search; grams are
 *  user-chosen so ranges collapse; origin='manual'. */
export async function createManualMeal(deps: NutritionDeps, userId: string, input: ManualMealRequest): Promise<Meal> {
  const items = await resolveChosenItems(deps, userId, input.items);
  const row = await repo.createMeal(deps.sql, userId, {
    takenAt: new Date(input.takenAt),
    mealType: input.mealType ?? null,
    mealName: input.mealName,
    items,
    origin: "manual",
  });
  await awardMealBadges(deps, userId);
  return asMeal(row);
}

/** Kd-approved 2026-07-16 (Card-5a smoke): live preview — NOTHING persists,
 *  NO quota (no AI spend; food lookups are curated/cache-fronted). PREVIEW
 *  MUST EQUAL WHAT CONFIRM WOULD SAVE (T3 finding): with a scanToken, foods
 *  resolve from the SAME draft snapshot confirmMeal will read (peeked, never
 *  taken — the single-use draft survives previews) with the estimate's rung
 *  preserved, mirroring confirmMeal exactly; without one, items resolve via
 *  resolveChosenItems, mirroring createManualMeal exactly. */
export async function previewMeal(
  deps: NutritionDeps,
  userId: string,
  input: PreviewMealRequest,
): Promise<MealPreview> {
  if (input.scanToken === undefined) {
    const items = await resolveChosenItems(deps, userId, input.items);
    return { items, totals: totals(items) };
  }
  const draft = await peekDraft(deps, userId, input.scanToken);
  const items: MealItem[] = [];
  for (const chosen of input.items) {
    // Same resolution as confirmMeal (extras + dishware included) so preview == save.
    const { item } = await resolveDraftItem(deps, userId, draft, chosen);
    items.push(item);
  }
  return { items, totals: totals(items) };
}

// ── reads / edits ────────────────────────────────────────────────────────────

export async function listMeals(
  deps: NutritionDeps,
  userId: string,
  limit: number,
  cursor: { at: Date; id: string } | null,
): Promise<{ items: Meal[]; next: repo.MealRow | null }> {
  const rows = await repo.listMeals(deps.sql, userId, limit, cursor);
  const page = rows.slice(0, limit);
  return { items: page.map(asMeal), next: rows.length > limit ? (page.at(-1) ?? null) : null };
}

export async function getMeal(deps: NutritionDeps, userId: string, id: string): Promise<Meal | null> {
  const row = await repo.getMeal(deps.sql, userId, id);
  return row === null ? null : asMeal(row);
}

export async function patchMeal(
  deps: NutritionDeps,
  userId: string,
  id: string,
  input: PatchMealRequest,
): Promise<Meal | null> {
  const before = await repo.getMeal(deps.sql, userId, id);
  if (before === null) return null;
  let items = before.items;
  if (input.items !== undefined) {
    items = [];
    for (const chosen of input.items) {
      // A food the scan estimated is priced by the figures this meal's own item
      // carries (it has no table); anything else by its table, as it was saved.
      const saved = before.items.find((i) => i.canonical === chosen.canonical);
      const food = (saved === undefined ? null : estimateOf(saved)) ?? (await findFood(deps, chosen.canonical));
      if (food === null) throw new NutritionError(400, "unknown_food", "Food reference not found.");
      const amount = await amountOf(deps, userId, chosen, food);
      // T3 P2.6a finding 3: a grams edit must PRESERVE the item's existing
      // rung (same rule as confirmMeal) — only items new to the meal are
      // 'default'. 'legacy'/'anchor' rows can't re-enter the item enum; they
      // normalize to 'default'. Card 5c2: re-measuring with a dish overrides
      // the rung to 'user_dishware'.
      const prior = saved?.portionSource;
      const preserved = prior === "user_dishware" || prior === "regional_prior" ? prior : "default";
      const rung = amount.dishwareRung ?? preserved;
      // An edit that sends an item back at the grams it holds (the web resends a
      // meal's other items so to add one) keeps the measure it was logged by;
      // any other grams are grams.
      const kept = "grams" in chosen && saved?.measure !== undefined && saved.gramsPoint === chosen.grams ? saved.measure : null;
      items.push(nutritionItem(food, amount.grams, [amount.grams, amount.grams], rung, amount.measure ?? kept));
    }
  }
  const row = await repo.updateMeal(deps.sql, userId, id, {
    takenAt: input.takenAt === undefined ? before.takenAt : new Date(input.takenAt),
    // undefined = keep; explicit null = clear the label.
    mealType: input.mealType === undefined ? before.mealType : input.mealType,
    mealName: input.mealName ?? before.mealName ?? "Meal",
    items,
    origin: before.origin,
  });
  return row === null ? null : asMeal(row);
}

// ── thin service seams (T3 P2.6a finding 4: real functions, not repo
//    re-exports — the module boundary keeps a place for future authz/
//    entitlement hooks) ─────────────────────────────────────────────────────

type ReadDeps = Pick<NutritionDeps, "sql">;

export async function deleteMeal(deps: ReadDeps, userId: string, id: string): Promise<boolean> {
  return await repo.deleteMeal(deps.sql, userId, id);
}
export async function listDishware(
  deps: ReadDeps,
  userId: string,
  limit: number,
  cursor: { at: Date; id: string } | null,
): Promise<repo.DishwareRow[]> {
  return await repo.listDishware(deps.sql, userId, limit, cursor);
}
export async function createDishware(
  deps: ReadDeps,
  userId: string,
  v: Parameters<typeof repo.createDishware>[2],
): Promise<repo.DishwareRow> {
  return await repo.createDishware(deps.sql, userId, v);
}
export async function updateDishware(
  deps: ReadDeps,
  userId: string,
  id: string,
  v: Parameters<typeof repo.updateDishware>[3],
): Promise<repo.DishwareRow | null> {
  return await repo.updateDishware(deps.sql, userId, id, v);
}
export async function deleteDishware(deps: ReadDeps, userId: string, id: string): Promise<boolean> {
  return await repo.deleteDishware(deps.sql, userId, id);
}
export async function listMeasurements(
  deps: ReadDeps,
  userId: string,
  limit: number,
  cursor: { at: Date; id: string } | null,
): Promise<repo.MeasurementRow[]> {
  return await repo.listMeasurements(deps.sql, userId, limit, cursor);
}
/** The three history writes refuse an account that is not active (a request
 *  that passed sign-in and then waited behind the account's deletion) with the
 *  answer sign-in gives every request after a deletion — the same 401 from
 *  all three, whatever the write. */
async function activeOnly<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err: unknown) {
    if (err instanceof repo.AccountNotActiveError) {
      throw new NutritionError(401, "unauthorized", "authentication required");
    }
    throw err;
  }
}
export async function createMeasurement(
  deps: ReadDeps,
  userId: string,
  v: Parameters<typeof repo.createMeasurement>[2],
): Promise<repo.MeasurementRow> {
  return await activeOnly(() => repo.createMeasurement(deps.sql, userId, v));
}
export async function updateMeasurement(
  deps: ReadDeps,
  userId: string,
  id: string,
  v: Parameters<typeof repo.updateMeasurement>[3],
): Promise<repo.MeasurementRow | null> {
  return await activeOnly(() => repo.updateMeasurement(deps.sql, userId, id, v));
}
export async function deleteMeasurement(deps: ReadDeps, userId: string, id: string): Promise<boolean> {
  return await activeOnly(() => repo.deleteMeasurement(deps.sql, userId, id));
}

export const CURATED_COUNT = CURATED_FOODS.length;
export const CALC_VERSION_VALUE = CALC_VERSION;
