// P2.6a — nutrition service: orchestration for Part 2B §3's five-stage
// pipeline. Photos are NEVER persisted or logged (2B §3.4 guarantee — ruled
// precedence over v1 §6.1's R2 path); the image exists only as a request
// value handed to the vision adapter. Reformatted to house style at T3.
import { createHash, randomBytes } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { Sql } from "postgres";
import { z } from "zod";
import type { ChosenItem, Meal, MealItem } from "@app/shared";
import type { RedisLike } from "../../redis.js";
import { onMealLogged } from "../gamification/service.js";
import { getUserPlan, getUserSyncContext } from "../users/service.js";
import { targetsFromPlan } from "./targets.js";
import { CURATED_FOODS, findCurated, searchCurated } from "./foods.js";
import type { FoodReference, FoodSearchProvider } from "./openfoodfacts.adapter.js";
import { dishwareGrams, resolvePortion } from "./portion-priors.js";
import * as repo from "./repo.js";
import type { ConfirmMealRequest, ManualMealRequest, MealPreview, NutritionTargetsResponse, PatchMealRequest, PreviewMealRequest } from "./schemas.js";
import {
  MEAL_VISION_MODELS,
  VisionProviderError,
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

/** §3.5: the route answers 422 with the single-use retake token (null when
 *  this attempt already rode a retake — tokens never chain). */
export class RetakeRequiredError extends NutritionError {
  constructor(
    readonly retakeToken: string | null,
    message: string,
  ) {
    super(422, "retake_required", message);
    this.name = "RetakeRequiredError";
  }
}

export interface NutritionDeps {
  sql: Sql;
  redis: RedisLike;
  /** null = the scanner model's key unset → scanning 503s cleanly, rest of module works. */
  vision: VisionProvider | null;
  /** The configured scanner model: it prices and names every ledger row. */
  visionModel: MealVisionModel;
  foods: FoodSearchProvider;
  log: FastifyBaseLogger;
}

// Internal draft/cache parser consumes the stable nutrition fields and strips
// curated inventory-only provenance such as sourceLine.
const foodSchema = z.object({
  canonical: z.string(),
  name: z.string(),
  // Physical per-100g bounds (T3 manual-off-foods): a cached entry breaching
  // them fails the parse and degrades to a re-search, never into a meal.
  kcal: z.number().min(0).max(1000),
  proteinG: z.number().min(0).max(100),
  carbsG: z.number().min(0).max(100),
  fatG: z.number().min(0).max(100),
  fiberG: z.number().min(0).max(100),
  serving: z.number(),
  unit: z.string(),
  source: z.enum(["curated", "openfoodfacts"]),
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

/** A scan's cost in integer micro-USD at its model's list price; BigInt
 *  end-to-end, rounded half up. */
export function visionCostMicro(model: MealVisionModel, tokensIn: number, tokensOut: number): bigint {
  const price = MEAL_VISION_MODELS[model];
  const raw =
    BigInt(tokensIn) * price.inputMicroUsdPerMillion +
    BigInt(tokensOut) * price.outputMicroUsdPerMillion;
  return (raw + 500_000n) / 1_000_000n; // round-half-up, no float near money
}

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

/** Atomic single-use consume (Lua GET+DEL). Redis down → fail closed. */
export async function consumeRetake(deps: NutritionDeps, userId: string, value: string): Promise<boolean> {
  const taken = await deps.redis.take(retakeKey(userId, value));
  if (taken === null) throw new NutritionError(503, "quota_unavailable", "Meal scanning is temporarily unavailable.");
  if (taken === undefined) throw new NutritionError(400, "invalid_retake", "Invalid or expired retake token.");
  return true;
}

// ── food search (Stage 3 sources: curated → cached OpenFoodFacts) ───────────

const foodRefKey = (canonical: string): string => `food:ref:${digest(canonical.toLowerCase())}`;

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

export async function searchFoods(deps: NutritionDeps, query: string, limit: number): Promise<FoodReference[]> {
  const local = searchCurated(query, limit);
  if (local.length >= limit) return local;
  const external = await cachedExternal(deps, query, limit - local.length);
  return [...local, ...external].slice(0, limit);
}

async function findFood(deps: NutritionDeps, query: string): Promise<FoodReference | null> {
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

// ── Stage-3 arithmetic + §3.3 display standard ───────────────────────────────

const round1 = (v: number): number => Math.round(v * 10) / 10;

function nutritionItem(
  food: FoodReference,
  gramsPoint: number,
  gramsRange: [number, number],
  portionSource: "user_dishware" | "regional_prior" | "default",
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
  };
}

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

export interface ScanDraftResponse {
  scanToken: string;
  mealName: string;
  items: MealItem[];
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
  usedRetake: boolean,
): Promise<ScanDraftResponse> {
  if (deps.vision === null) {
    throw new NutritionError(503, "nutrition_unavailable", "Meal scanning is temporarily unavailable.");
  }

  let result: VisionResult;
  try {
    result = await deps.vision.analyze(imageBase64, mimeType);
  } catch (err) {
    // Money may have been spent even on a malformed reply — ledger it when
    // the provider reported usage. Network/HTTP failures carry no usage: no
    // completion, no ledger row (ruled — DECISIONS).
    if (err instanceof VisionProviderError && err.usage !== undefined) await ledger(deps, userId, err.usage);
    const rt = usedRetake ? null : await issueRetake(deps, userId);
    throw new RetakeRequiredError(rt, "We could not read that photo. Please retake it with the full plate in frame.");
  }

  await ledger(deps, userId, result);
  if (result.evidence.photo_quality === "poor") {
    const rt = usedRetake ? null : await issueRetake(deps, userId);
    throw new RetakeRequiredError(rt, "Please retake the photo in better light with the full plate visible.");
  }

  // Stage 2: resolve each identified item through the approved rungs.
  const dishware = await repo.listDishware(deps.sql, userId, 100, null);
  const savedDishware = dishware.map((d) => ({
    containerClass: d.containerClass,
    volumeMl: d.volumeMl,
    foodHint: d.foodHint,
  }));
  const foods: FoodReference[] = [];
  const draftItems: Draft["items"] = [];
  const items: MealItem[] = [];
  for (const evidence of result.evidence.items) {
    const food = await findFood(deps, evidence.canonical_hint);
    if (food === null) continue; // honest unknown (§3.5) — stays in unknown_items
    const portion = resolvePortion(
      {
        canonicalHint: evidence.canonical_hint,
        container: evidence.container,
        fillLevel: evidence.fill_level,
        sizeClass: evidence.size_class,
        count: evidence.count,
      },
      savedDishware,
      food.serving,
    );
    foods.push(food);
    draftItems.push({ canonical: food.canonical, ...portion });
    items.push(nutritionItem(food, portion.gramsPoint, portion.gramsRange, portion.portionSource));
  }

  const scanToken = token();
  // A good photo the model did not name is "Meal", as a renamed-to-nothing
  // meal is (patchMeal below); a photo with nothing to name is a poor one.
  const mealName = result.evidence.meal_name ?? "Meal";
  const draft: Draft = { userId, mealName, foods, items: draftItems };
  const stored = await deps.redis.setex(scanKey(userId, scanToken), SCAN_TTL_SECONDS, JSON.stringify(draft));
  if (!stored) throw new NutritionError(503, "nutrition_unavailable", "Meal scanning is temporarily unavailable.");

  return {
    scanToken,
    mealName,
    items,
    unknownItems: result.evidence.unknown_items,
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

/** Card 5c2: reduce a chosen item (grams arm OR dishware arm) to concrete
 *  grams. The dishware arm looks its dish up TENANT-SCOPED — a foreign or
 *  missing id 400s, never resolves another user's dish — and computes grams
 *  via the shared `dishwareGrams` helper (the same math the scan-time rung-1
 *  resolver uses), forcing rung 'user_dishware'. The grams arm passes through
 *  with no rung override (dishwareRung null → the caller's own rung applies). */
async function normalizeChosen(
  deps: NutritionDeps,
  userId: string,
  chosen: ChosenItem,
): Promise<{ canonical: string; grams: number; dishwareRung: "user_dishware" | null }> {
  if ("dishwareId" in chosen) {
    const dish = await repo.getDishware(deps.sql, userId, chosen.dishwareId);
    if (dish === null) throw new NutritionError(400, "unknown_dishware", "Dishware not found.");
    const grams = dishwareGrams(dish.volumeMl, chosen.fillLevel, chosen.canonical);
    // Keep the dishware arm SYMMETRIC with the grams arm's bounds
    // (chosenItemsSchema: positive, ≤10_000). A round-to-0 (tiny dish × low
    // fill) would otherwise persist a MealItem the shared contract declares
    // impossible (gramsPoint.positive) — unrenderable on read (T3 F1); an
    // >10_000 result would bypass the cap the grams arm enforces at the schema.
    if (grams < 1 || grams > 10_000) {
      throw new NutritionError(400, "portion_out_of_range", "That portion is too small or too large to log — pick a different fill or enter grams.");
    }
    return { canonical: chosen.canonical, grams, dishwareRung: "user_dishware" };
  }
  return { canonical: chosen.canonical, grams: chosen.grams, dishwareRung: null };
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
  const norm = await normalizeChosen(deps, userId, chosen);
  const food = draft.foods.find((f) => f.canonical === norm.canonical);
  const estimate = draft.items.find((i) => i.canonical === norm.canonical);
  if (food !== undefined && estimate !== undefined) {
    // User-chosen amount collapses the range; a dishware measure overrides the
    // rung to 'user_dishware', otherwise the estimate's rung is preserved.
    const rung = norm.dishwareRung ?? estimate.portionSource;
    return {
      item: nutritionItem(food, norm.grams, [norm.grams, norm.grams], rung),
      original: nutritionItem(food, estimate.gramsPoint, estimate.gramsRange, estimate.portionSource),
    };
  }
  const extra = await findFood(deps, norm.canonical);
  if (extra === null) throw new NutritionError(400, "unknown_food", "Food reference not found.");
  return {
    item: nutritionItem(extra, norm.grams, [norm.grams, norm.grams], norm.dishwareRung ?? "default"),
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
    const norm = await normalizeChosen(deps, userId, chosen);
    const food = await findFood(deps, norm.canonical);
    if (food === null) throw new NutritionError(400, "unknown_food", "Food reference not found.");
    items.push(nutritionItem(food, norm.grams, [norm.grams, norm.grams], norm.dishwareRung ?? "default"));
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
      const norm = await normalizeChosen(deps, userId, chosen);
      const food = await findFood(deps, norm.canonical);
      if (food === null) throw new NutritionError(400, "unknown_food", "Food reference not found.");
      // T3 P2.6a finding 3: a grams edit must PRESERVE the item's existing
      // rung (same rule as confirmMeal) — only items new to the meal are
      // 'default'. 'legacy'/'anchor' rows can't re-enter the item enum; they
      // normalize to 'default'. Card 5c2: re-measuring with a dish overrides
      // the rung to 'user_dishware'.
      const prior = before.items.find((i) => i.canonical === norm.canonical)?.portionSource;
      const preserved = prior === "user_dishware" || prior === "regional_prior" ? prior : "default";
      const rung = norm.dishwareRung ?? preserved;
      items.push(nutritionItem(food, norm.grams, [norm.grams, norm.grams], rung));
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
