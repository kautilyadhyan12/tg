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
// INTERIM ON OLD BACKEND (D2, Kd-ruled Card 5a; the gamification pattern —
// broken on this branch, owed a "nutrition targets" card in
// RUNBOOK/cutover.md): getTargets below still rides mlApi. It feeds from
// user_fitness_profiles once its new-API card lands (exists since PR #30).
//
// Card 5b: AddMealModal now rides searchFoods/logManualMeal below — the
// legacy mlApi searchFood/logMeal pair is deleted as promised at 5a. The one
// remaining mlApi call is getTargets (D2 interim).
import authApi from './authApi';
import mlApi from './mlApi';

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

  // ── OLD BACKEND (interim; see header) ─────────────────────────────────────
  /** D2 interim: {success, targets: {kcal, protein_g, carbs_g, fat_g}} from
   *  the legacy Mifflin-St Jeor calculator (backend-ml nutrition.py:98). */
  getTargets: () => mlApi.get('/nutrition/targets'),
};
