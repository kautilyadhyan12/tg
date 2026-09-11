// P2.8 web repoint (Card 5a) — nutrition on the NEW /v1 API via the Card-1
// cookie client (httpOnly session; no tokens in JS). Shapes are @app/shared
// nutrition.ts, sent/received as the schema objects directly.
//
// THE FLOW CHANGED BY DESIGN (Part 2B §3, the trust layer):
//   photo → POST analyze-photo (base64 JSON, not multipart) → analysis with a
//   scanToken → the USER confirms grams → ONE POST /v1/nutrition/meals
//   {scanToken, takenAt, items:[{canonical, grams}]} creates the whole meal.
//   The SERVER computes all kcal/macros — the client never does nutrition
//   arithmetic (2B anti-hallucination rule; DECISIONS 2026-07-12 P2.6a).
//
// The D2 interim is CLOSED: getTargets was the file's last old-backend call
// and now rides the new GET /v1/nutrition/targets (PR #42), which since
// ROADMAP 4a-iii answers with the person's own onboarding plan. nutritionApi
// runs entirely on the new API — no mlApi import remains, pinned by the
// usage-guard test.
import authApi from './authApi';

/** The Nutrition page's left column WAITS on the targets request (its spinner
 *  can no longer clear on the meals fetch alone, or the honest prompt would
 *  flash at every user). authApi sets no global timeout, so an unbounded
 *  request here would spin that column forever even though meals returned
 *  (T3 F3). On timeout the request rejects and the column degrades to the
 *  "couldn't load your targets" state. Scoped to this call — changing the
 *  shared client's default is a separate decision. */
const TARGETS_TIMEOUT_MS = 10_000;

/** Contract bounds, quoted from @app/shared nutrition.ts (never invented):
 *  image ≤10 MB decoded, mime ∈ jpeg|png|webp (analyzeMealPhotoRequestSchema);
 *  items grams >0 ≤10000 (chosenItemsSchema); foods limit ≤50. */
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** data:*;base64,XXXX → XXXX. Exported for the unit test (pure). */
export function dataUrlToBase64(dataUrl) {
  const comma = dataUrl.indexOf(',');
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
}

/** Clamp/normalise each item to ONE of the .strict() contract arms
 *  (@app/shared chosenItemsSchema): the grams arm {canonical, grams} (positive
 *  ≤10000, rounded) OR the Card-5c2 dishware arm {canonical, dishwareId,
 *  fillLevel} (measure with a saved dish; the SERVER turns it into grams). An
 *  item carrying a dishwareId takes the dishware arm; anything else takes
 *  grams. Exported for the unit test (pure). */
export function toChosenItems(items) {
  // Clamp fill into the contract's (0,1]. Invalid/missing → the minimum, NEVER
  // "full" — assuming a full bowl would fabricate a portion (Kd's no-invented-
  // default ruling); the UI always supplies a ¼–full preset anyway.
  const clampFill = (v) => {
    const f = Number(v);
    return Number.isFinite(f) && f > 0 ? Math.min(1, f) : 0.01;
  };
  return items.map((it) =>
    it.dishwareId
      ? { canonical: it.canonical, dishwareId: it.dishwareId, fillLevel: clampFill(it.fillLevel) }
      : { canonical: it.canonical, grams: Math.min(10000, Math.max(1, Math.round(Number(it.grams) || 0))) },
  );
}

/** Card 5c add-ingredient: the meals PATCH replaces the WHOLE items array, so
 *  compose the meal's existing items (kept at their stored `gramsPoint`) with
 *  the newly picked one. Pure + unit-tested precisely because a bug here —
 *  dropping or mis-mapping an existing item — would silently REWRITE a saved
 *  meal, not just fail loudly. `existing` is the Meal.items shape from the API
 *  ({canonical, gramsPoint, …}); `added` is {canonical, grams} OR the Card-5c2
 *  dishware arm {canonical, dishwareId, fillLevel}. */
export function composeAddIngredient(existing, added) {
  return [
    ...(existing || []).map((i) => ({ canonical: i.canonical, grams: i.gramsPoint })),
    added.dishwareId
      ? { canonical: added.canonical, dishwareId: added.dishwareId, fillLevel: added.fillLevel }
      : { canonical: added.canonical, grams: added.grams },
  ];
}

// ── Card 5d: previous-days view ───────────────────────────────────────────────
// The meals list has NO server date filter — @app/shared nutritionListQuerySchema
// is {limit, cursor} only, and the cursor is an opaque contract token — so to
// show a past day we walk the newest-first pages until we have passed that day.
// At ~5 meals/day the cap (10 pages × 100) covers ~6 months of history before an
// honest "couldn't load that far back" fallback; a server-side date filter is the
// documented upgrade path (RUNBOOK/cutover.md) if history ever runs deeper.
export const MEAL_PAGE_SIZE = 100;
export const MAX_MEAL_PAGES = 10;

/** Collect the meals whose takenAt is in [dayStartMs, dayEndMs) by walking
 *  newest-first pages via the injected `fetchPage(cursor) → {items, nextCursor}`.
 *  Stops as soon as a page reaches data older than the day (newest-first means
 *  every later page is older still), when the cursor is exhausted, or when the
 *  page cap is hit — the last of which sets `truncated`. Pure w.r.t. the
 *  fetcher; unit-tested directly. */
export async function walkMealsForDay(fetchPage, dayStartMs, dayEndMs, maxPages = MAX_MEAL_PAGES) {
  const meals = [];
  let cursor;
  let pages = 0;
  for (;;) {
    if (pages >= maxPages) return { meals, truncated: true };
    const page = await fetchPage(cursor);
    const items = page?.items || [];
    pages += 1;
    let reachedOlder = false;
    for (const m of items) {
      const t = new Date(m.takenAt).getTime();
      if (t >= dayStartMs && t < dayEndMs) meals.push(m);
      if (t < dayStartMs) reachedOlder = true;
    }
    if (reachedOlder || !page?.nextCursor) return { meals, truncated: false };
    cursor = page.nextCursor;
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(dataUrlToBase64(reader.result));
    reader.onerror = () => reject(new Error('Could not read the image file'));
    reader.readAsDataURL(file);
  });
}

export const nutritionService = {
  /** POST /v1/nutrition/analyze-photo → mealPhotoAnalysisSchema
   *  ({scanToken, mealName, items, unknownItems, photoQuality, totals,
   *  retakeToken?}). A poor photo is a 422 whose body may carry a retakeToken
   *  — pass it back here to retry without burning a second quota slot. */
  analyzePhoto: async (file, retakeToken) => {
    if (!ALLOWED_MIME.includes(file.type)) {
      throw new Error('Please use a JPEG, PNG, or WebP image.');
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error('Image must be 10 MB or smaller.');
    }
    const imageBase64 = await fileToBase64(file);
    const body = { imageBase64, mimeType: file.type };
    if (retakeToken) body.retakeToken = retakeToken; // .strict(): omit, never null
    return authApi.post('/v1/nutrition/analyze-photo', body);
  },

  /** Photo confirm — ONE request creates the whole meal (replaces the old
   *  N× logMeal loop). Body is confirmMealRequestSchema (.strict()).
   *  mealType = the user-chosen label (Kd ruling 2026-07-17); omit = unlabeled. */
  confirmMeal: ({ scanToken, takenAt, items, mealType }) =>
    authApi.post('/v1/nutrition/meals', {
      scanToken, takenAt, items: toChosenItems(items),
      ...(mealType ? { mealType } : {}), // .strict(): omit, never null
    }),

  /** Live preview (Kd-approved 2026-07-16): the SERVER computes nutrition for
   *  proposed grams without saving — the client never does nutrition math.
   *  With scanToken (photo flow) the server reads the same scan snapshot the
   *  confirm will use, so preview always equals what gets saved. Free: no AI
   *  call, no quota. */
  previewMeal: ({ scanToken, items }) =>
    authApi.post('/v1/nutrition/meals/preview', {
      items: toChosenItems(items),
      ...(scanToken ? { scanToken } : {}), // .strict(): omit, never null
    }),

  /** Manual entry (Card 5b UI) — manualMealRequestSchema (.strict()).
   *  Server resolves canonicals via food search and computes all macros. */
  logManualMeal: ({ mealName, takenAt, items, mealType }) =>
    authApi.post('/v1/nutrition/meals', {
      mealName, takenAt, items: toChosenItems(items),
      ...(mealType ? { mealType } : {}),
    }),

  /** {items: FoodReference[]} — macros are PER 100 g; camelCase
   *  (proteinG/carbsG/fatG), canonical is the confirm/manual key. limit ≤50. */
  searchFoods: (q, limit = 10) =>
    authApi.get('/v1/nutrition/foods', { params: { q, limit } }),

  /** {items: Meal[], nextCursor} — newest first; each meal carries
   *  SERVER-computed totals {kcalPoint, kcalLow, kcalHigh, proteinG, …}. */
  listMeals: (limit = 100, cursor) =>
    authApi.get('/v1/nutrition/meals', { params: cursor ? { limit, cursor } : { limit } }),

  /** Card 5d: meals logged on the LOCAL day containing `date`. Walks the
   *  newest-first list (no server date filter exists) and returns
   *  {meals, truncated}; truncated = the page cap was hit before older data,
   *  i.e. this day is deeper in history than the walk loads. */
  listMealsForDay: async (date, maxPages = MAX_MEAL_PAGES) => {
    const start = new Date(date); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    return walkMealsForDay(
      async (cursor) => {
        const res = await nutritionService.listMeals(MEAL_PAGE_SIZE, cursor);
        return { items: res.data.items || [], nextCursor: res.data.nextCursor };
      },
      start.getTime(), end.getTime(), maxPages,
    );
  },

  getMeal: (id) => authApi.get(`/v1/nutrition/meals/${id}`),

  deleteMeal: (id) => authApi.delete(`/v1/nutrition/meals/${id}`), // 204

  /** patchMealRequestSchema (.strict(), ≥1 field). */
  updateMeal: (id, patch) => authApi.patch(`/v1/nutrition/meals/${id}`, patch),

  // ── Dishware (Part 2B §3.2 rung 1; Card 5b UI) — once registered, the
  //    photo pipeline's portion resolver uses these server-side. ────────────
  /** {items: [{id, label, containerClass, volumeMl, foodHint, createdAt}], nextCursor} */
  listDishware: (limit = 50, cursor) =>
    authApi.get('/v1/nutrition/dishware', { params: cursor ? { limit, cursor } : { limit } }),
  /** dishwareInputSchema (.strict()): {label ≤100, containerClass ≤80,
   *  volumeMl int ≤10000, foodHint? ≤120}. */
  createDishware: (input) => authApi.post('/v1/nutrition/dishware', input),
  updateDishware: (id, patch) => authApi.patch(`/v1/nutrition/dishware/${id}`, patch),
  deleteDishware: (id) => authApi.delete(`/v1/nutrition/dishware/${id}`), // 204

  /** The macro rings' daily calories and macros: the person's own plan, worked
   *  out SERVER-side from their onboarding answers — the number the onboarding
   *  screens show. Bounded by TARGETS_TIMEOUT_MS. Returns {targets, missing[]}
   *  — `targets` is null exactly when `missing` names a question the plan still
   *  needs, because the server refuses to invent a goal (Kd ruling). Map with
   *  toDisplayTargets below. */
  getTargets: () => authApi.get('/v1/nutrition/targets', { timeout: TARGETS_TIMEOUT_MS }),
};

// ── targets display mapping ─────────────────────────────────────────────────
// The API speaks camelCase (proteinG); MacroRings and the Remaining card read
// snake_case (protein_g). Renaming HERE, once, keeps that seam in one place —
// and it is the card's silent trap: a missed rename yields `undefined`, which
// the old `|| 150` fallbacks rendered as a plausible fake number instead of an
// error, so the bug would have looked like success.

/** THREE distinct states, deliberately (the fabricated defaults used to hide
 *  the difference):
 *    undefined → not loaded yet, or an unreadable response  → show nothing yet
 *    null      → loaded; the profile cannot produce a target → honest prompt
 *    object    → real, server-computed targets                → render them
 *  A malformed payload maps to `undefined`, NEVER null: telling a user their
 *  profile is incomplete when we simply failed to read the response would be
 *  a fabricated claim of its own. */
export function toDisplayTargets(response) {
  if (response === null || typeof response !== 'object') return undefined;
  if (!('targets' in response)) return undefined;
  const t = response.targets;
  if (t === null) return null;
  if (t === undefined || typeof t !== 'object') return undefined;
  // Validate the VALUES, not just the container (T3 F4): a payload short one
  // macro used to yield `fat_g: undefined`, which rendered as "/ undefinedg"
  // on the ring and as a confident "0g left" in Remaining — a number invented
  // from nothing, i.e. this card's own thesis one field short. Today's API
  // cannot produce it (.strict() + z.number().int()); this is defence in depth,
  // and an unusable payload degrades to `undefined` (unavailable), never
  // `null` (which would blame the user's profile).
  const mapped = { kcal: t.kcal, protein_g: t.proteinG, carbs_g: t.carbsG, fat_g: t.fatG };
  return Object.values(mapped).every((v) => typeof v === 'number' && Number.isFinite(v))
    ? mapped
    : undefined;
}

/** The questions the SERVER says the plan still needs, as it sent them (the
 *  plan's own keys: goal, dayActivity, …); MacroRings says them in words and
 *  opens onboarding on them. */
export function missingAnswers(missing) {
  // Array.isArray, not `?? []` (T3 F5): a non-array threw, and the throw landed
  // AFTER the caller had already stored good targets — so the catch discarded
  // real numbers and showed the prompt instead.
  return Array.isArray(missing) ? missing.filter((key) => typeof key === 'string') : [];
}
