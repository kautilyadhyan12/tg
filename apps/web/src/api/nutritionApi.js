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
// STILL OLD-BACKEND UNTIL CARD 5b (manual-entry UI card): searchFood/logMeal
// legacy functions kept for AddMealModal — NO-REMOVAL rule; 5b rewires that
// modal onto searchFoods/logManualMeal below and deletes the legacy pair.
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

/** Clamp confirm items to the .strict() contract: grams positive ≤10000,
 *  rounded to a sane precision. Exported for the unit test (pure). */
export function toChosenItems(items) {
  return items.map(({ canonical, grams }) => ({
    canonical,
    grams: Math.min(10000, Math.max(1, Math.round(Number(grams) || 0))),
  }));
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
   *  N× logMeal loop). Body is confirmMealRequestSchema (.strict()). */
  confirmMeal: ({ scanToken, takenAt, items }) =>
    authApi.post('/v1/nutrition/meals', { scanToken, takenAt, items: toChosenItems(items) }),

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
  logManualMeal: ({ mealName, takenAt, items }) =>
    authApi.post('/v1/nutrition/meals', { mealName, takenAt, items: toChosenItems(items) }),

  /** {items: FoodReference[]} — macros are PER 100 g; camelCase
   *  (proteinG/carbsG/fatG), canonical is the confirm/manual key. limit ≤50. */
  searchFoods: (q, limit = 10) =>
    authApi.get('/v1/nutrition/foods', { params: { q, limit } }),

  /** {items: Meal[], nextCursor} — newest first; each meal carries
   *  SERVER-computed totals {kcalPoint, kcalLow, kcalHigh, proteinG, …}. */
  listMeals: (limit = 100, cursor) =>
    authApi.get('/v1/nutrition/meals', { params: cursor ? { limit, cursor } : { limit } }),

  getMeal: (id) => authApi.get(`/v1/nutrition/meals/${id}`),

  deleteMeal: (id) => authApi.delete(`/v1/nutrition/meals/${id}`), // 204

  /** patchMealRequestSchema (.strict(), ≥1 field). */
  updateMeal: (id, patch) => authApi.patch(`/v1/nutrition/meals/${id}`, patch),

  // ── OLD BACKEND (interim; see header) ─────────────────────────────────────
  /** D2 interim: {success, targets: {kcal, protein_g, carbs_g, fat_g}} from
   *  the legacy Mifflin-St Jeor calculator (backend-ml nutrition.py:98). */
  getTargets: () => mlApi.get('/nutrition/targets'),

  /** Card 5b rewires AddMealModal off these two, then deletes them. */
  searchFood: (query, limit = 10) =>
    mlApi.get('/nutrition/search', { params: { q: query, limit } }),
  logMeal: (meal) => mlApi.post('/nutrition/meals', meal),
};
