// P2.8 web repoint (Card 5a) — nutritionService on the new /v1 API. Pins:
// exact paths/methods/params, the .strict()-safe bodies (retakeToken OMITTED
// when absent; confirm vs manual union discriminates on scanToken/mealName),
// grams clamping to the contract bounds, base64 prefix stripping, and the
// usage guard: no raw fetch / localStorage, and NO mlApi at all — the targets
// card repointed getTargets, the file's last old-backend call.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import authApi from './authApi';
import { shrinkPhoto } from '../utils/shrinkPhoto';
import { bytesToBase64, composeAddIngredient, composeFoodEdit, composeRemoveFood, dataUrlToBase64, missingAnswers, nutritionService, toChosenItems, toDisplayTargets, walkMealsForDay } from './nutritionApi';

// The shrink draws on a canvas, which this node environment has none of; its
// own test hands it a fake window. Here it is a stand-in that returns whatever
// a test says the shrunk photo is.
vi.mock('../utils/shrinkPhoto', () => ({ shrinkPhoto: vi.fn() }));

function recordRequests(api) {
  const seen = [];
  api.defaults.adapter = async (config) => {
    seen.push({ url: config.url, method: config.method, params: config.params, data: config.data });
    return { data: {}, status: 200, statusText: '', headers: {}, config, request: {} };
  };
  return seen;
}

afterEach(() => {
  authApi.defaults.adapter = undefined;
  vi.clearAllMocks();
});

describe('nutritionService repoint (Card 5a)', () => {
  it('meals list/get/delete/patch hit the /v1/nutrition surface', async () => {
    const seen = recordRequests(authApi);
    await nutritionService.listMeals();
    await nutritionService.listMeals(50, 'abc');
    await nutritionService.getMeal('m-1');
    await nutritionService.deleteMeal('m-1');
    await nutritionService.updateMeal('m-1', { mealName: 'Lunch' });
    expect(seen[0]).toMatchObject({ url: '/v1/nutrition/meals', method: 'get', params: { limit: 100 } });
    // cursor OMITTED (not undefined-keyed) when absent — .strict() query.
    expect('cursor' in seen[0].params).toBe(false);
    expect(seen[1]).toMatchObject({ url: '/v1/nutrition/meals', method: 'get', params: { limit: 50, cursor: 'abc' } });
    expect(seen[2]).toMatchObject({ url: '/v1/nutrition/meals/m-1', method: 'get' });
    expect(seen[3]).toMatchObject({ url: '/v1/nutrition/meals/m-1', method: 'delete' });
    expect(seen[4]).toMatchObject({ url: '/v1/nutrition/meals/m-1', method: 'patch' });
    expect(JSON.parse(seen[4].data)).toEqual({ mealName: 'Lunch' });
  });

  it("a logged food's edit is previewed at the meal's own preview, and its measures read from the meal (7a-iv-g)", async () => {
    const seen = recordRequests(authApi);
    await nutritionService.previewMealEdit('m-1', [{ from: 0 }, { canonical: 'apple', grams: 200, from: 1 }], 'items-v1');
    await nutritionService.getMealMeasures('m-1');
    expect(seen[0]).toMatchObject({ url: '/v1/nutrition/meals/m-1/preview', method: 'post' });
    // With the version of the items it was made from, so a meal changed since is refused.
    expect(JSON.parse(seen[0].data)).toEqual({ items: [{ from: 0 }, { canonical: 'apple', grams: 200, from: 1 }], itemsVersion: 'items-v1' });
    expect(seen[1]).toMatchObject({ url: '/v1/nutrition/meals/m-1/measures', method: 'get' });
  });

  it('searchFoods queries /v1/nutrition/foods with q + limit', async () => {
    const seen = recordRequests(authApi);
    await nutritionService.searchFoods('paneer', 15);
    expect(seen[0]).toMatchObject({
      url: '/v1/nutrition/foods', method: 'get', params: { q: 'paneer', limit: 15 },
    });
  });

  it('confirmMeal posts the photo-confirm union arm; grams clamped to the contract', async () => {
    const seen = recordRequests(authApi);
    await nutritionService.confirmMeal({
      scanToken: 's'.repeat(32),
      takenAt: '2026-07-16T12:00:00.000Z',
      items: [
        { canonical: 'rice_cooked', grams: 180.4 },
        { canonical: 'dal', grams: 0 },        // → floor 1 (contract: positive)
        { canonical: 'ghee', grams: 99999 },   // → cap 10000 (contract max)
      ],
    });
    expect(seen[0].url).toBe('/v1/nutrition/meals');
    expect(seen[0].method).toBe('post');
    expect(JSON.parse(seen[0].data)).toEqual({
      scanToken: 's'.repeat(32),
      takenAt: '2026-07-16T12:00:00.000Z',
      items: [
        { canonical: 'rice_cooked', grams: 180 },
        { canonical: 'dal', grams: 1 },
        { canonical: 'ghee', grams: 10000 },
      ],
    });
  });

  it('previewMeal posts to /preview; scanToken omitted when absent, present for the photo flow', async () => {
    const seen = recordRequests(authApi);
    await nutritionService.previewMeal({ items: [{ canonical: 'apple', grams: 540 }] });
    await nutritionService.previewMeal({ scanToken: 't'.repeat(32), items: [{ canonical: 'apple', grams: 540 }] });
    expect(seen[0].url).toBe('/v1/nutrition/meals/preview');
    expect(seen[0].method).toBe('post');
    expect(JSON.parse(seen[0].data)).toEqual({ items: [{ canonical: 'apple', grams: 540 }] });
    expect(JSON.parse(seen[1].data)).toEqual({
      scanToken: 't'.repeat(32),
      items: [{ canonical: 'apple', grams: 540 }],
    });
  });

  it('logManualMeal posts the manual union arm (mealName, no scanToken); mealType present when chosen, omitted when not', async () => {
    const seen = recordRequests(authApi);
    await nutritionService.logManualMeal({
      mealName: 'Evening snack',
      takenAt: '2026-07-16T17:30:00.000Z',
      mealType: 'snack',
      items: [{ canonical: 'apple', grams: 120 }],
    });
    await nutritionService.logManualMeal({
      mealName: 'Unlabeled',
      takenAt: '2026-07-16T17:30:00.000Z',
      mealType: null,
      items: [{ canonical: 'apple', grams: 120 }],
    });
    const body = JSON.parse(seen[0].data);
    expect(body.mealName).toBe('Evening snack');
    expect(body.mealType).toBe('snack');
    expect('scanToken' in body).toBe(false);
    expect(body.items).toEqual([{ canonical: 'apple', grams: 120 }]);
    // .strict(): null label is OMITTED, never sent as null.
    expect('mealType' in JSON.parse(seen[1].data)).toBe(false);
  });

  it('dataUrlToBase64 strips the data-URL prefix and passes bare base64 through', () => {
    expect(dataUrlToBase64('data:image/png;base64,AAAA')).toBe('AAAA');
    expect(dataUrlToBase64('QkJCQg==')).toBe('QkJCQg==');
  });

  it('toChosenItems drops every field except canonical + grams (.strict() body)', () => {
    expect(toChosenItems([{ canonical: 'x', grams: 50, name: 'X', kcalPoint: 80 }]))
      .toEqual([{ canonical: 'x', grams: 50 }]);
  });

  it('analyzePhoto refuses a wrong type before shrinking, and a shrunk photo over 10 MB before any request', async () => {
    const seen = recordRequests(authApi);
    await expect(nutritionService.analyzePhoto({ type: 'image/gif', size: 10 }))
      .rejects.toThrow(/JPEG, PNG, or WebP/);
    expect(shrinkPhoto).not.toHaveBeenCalled();
    shrinkPhoto.mockResolvedValueOnce({ size: 10 * 1024 * 1024 + 1, type: 'image/jpeg' });
    await expect(nutritionService.analyzePhoto({ type: 'image/png', size: 10 }))
      .rejects.toThrow(/10 MB/);
    expect(seen.length).toBe(0);
  });

  it('analyzePhoto sends the SHRUNK photo as base64 JPEG whatever the original was; retakeToken omitted when absent', async () => {
    const seen = recordRequests(authApi);
    const original = { type: 'image/png', size: 40 * 1024 * 1024 }; // a 40 MB phone photo is fine: it is shrunk first
    const jpegStart = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });
    shrinkPhoto.mockResolvedValueOnce(jpegStart());
    await nutritionService.analyzePhoto(original);
    expect(shrinkPhoto).toHaveBeenCalledWith(original);
    expect(seen[0]).toMatchObject({ url: '/v1/nutrition/analyze-photo', method: 'post' });
    expect(JSON.parse(seen[0].data)).toEqual({ imageBase64: '/9j/', mimeType: 'image/jpeg' });
    shrinkPhoto.mockResolvedValueOnce(jpegStart());
    await nutritionService.analyzePhoto(original, 'r'.repeat(40));
    expect(JSON.parse(seen[1].data)).toEqual({ imageBase64: '/9j/', mimeType: 'image/jpeg', retakeToken: 'r'.repeat(40) });
  });

  it('bytesToBase64 encodes bytes the way the server decodes them, past one slice', () => {
    expect(bytesToBase64(new Uint8Array([0xff, 0xd8, 0xff]))).toBe('/9j/');
    const big = new Uint8Array(100_000).map((_, i) => i % 251);
    expect(bytesToBase64(big)).toBe(Buffer.from(big).toString('base64'));
  });

  it('the module has no raw fetch/localStorage; mlApi remains ONLY for the documented interim', () => {
    const src = readFileSync(fileURLToPath(new URL('./nutritionApi.js', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/fetch\s*\(/);
    expect(src).not.toMatch(/localStorage\s*[.[]/);
    expect(src).not.toMatch(/VITE_ML_API_URL/);
    // The targets card repointed getTargets — the file's LAST old-backend
    // call — so nutritionApi now runs entirely on the new /v1 API. Both
    // vectors are pinned: no IMPORT (an unused one would be dead code a
    // later reader might revive) and no CALL. Deliberately not a bare
    // /mlApi/ grep — the header names the retired client to explain the
    // history, and prose is not a dependency.
    expect(src).not.toMatch(/from\s+['"][^'"]*mlApi['"]/);
    expect(src).not.toMatch(/mlApi\s*[.[]/);
  });

  // ── Card 5c: meal composition + change-label ────────────────────────────────
  it('composeAddIngredient keeps EVERY existing item as saved + appends the new one (Card 5c)', () => {
    // This is the real add-ingredient logic — a bug here silently REWRITES a
    // saved meal, so it is tested directly, not via a hand-built array (T3).
    const existing = [
      { canonical: 'oats_dry', gramsPoint: 40, name: 'Oats', kcalPoint: 156 },
      { canonical: 'banana', gramsPoint: 120, name: 'Banana', kcalPoint: 107, nutritionSource: 'own' },
    ];
    const out = composeAddIngredient(existing, { canonical: 'milk_whole', grams: 200 });
    // all originals survive, each named by its place so the server keeps it as
    // saved (its numbers, its measure, the person's own numbers: 7a-iv-g)
    expect(out).toEqual([
      { from: 0 },
      { from: 1 },
      { canonical: 'milk_whole', grams: 200 },
    ]);
    // the new item is always last, and nothing is lost
    expect(out).toHaveLength(existing.length + 1);
    expect(out.at(-1)).toEqual({ canonical: 'milk_whole', grams: 200 });
    // a meal with no items yet (defensive) still yields just the new one
    expect(composeAddIngredient(undefined, { canonical: 'egg_whole_large', grams: 50 }))
      .toEqual([{ canonical: 'egg_whole_large', grams: 50 }]);
  });

  // ── Card 5c2: the dishware arm ({dishwareId, fillLevel}) survives the helpers ──
  it('toChosenItems keeps the dishware arm intact and clamps fill to (0,1]; grams arm unchanged', () => {
    expect(toChosenItems([
      { canonical: 'dal', dishwareId: 'd-1', fillLevel: 0.75 },   // dishware arm passes through
      { canonical: 'rice', grams: 180.4 },                         // grams arm still rounds
      { canonical: 'ghee', dishwareId: 'd-2', fillLevel: 5 },      // fill clamped to 1
      { canonical: 'oil', dishwareId: 'd-3', fillLevel: 0 },       // 0 → floored to 0.01 (contract: >0)
    ])).toEqual([
      { canonical: 'dal', dishwareId: 'd-1', fillLevel: 0.75 },
      { canonical: 'rice', grams: 180 },
      { canonical: 'ghee', dishwareId: 'd-2', fillLevel: 1 },
      { canonical: 'oil', dishwareId: 'd-3', fillLevel: 0.01 },
    ]);
  });

  it('composeAddIngredient appends a dishware-arm ingredient without touching existing items (Card 5c2)', () => {
    const out = composeAddIngredient(
      [{ canonical: 'oats_dry', gramsPoint: 40 }],
      { canonical: 'milk_whole', dishwareId: 'd-9', fillLevel: 0.5 },
    );
    expect(out).toEqual([
      { from: 0 },
      { canonical: 'milk_whole', dishwareId: 'd-9', fillLevel: 0.5 },
    ]);
  });

  // ── 7a-iv-a: the measure arm ({measure, amount}) survives the helpers ─────────
  it('toChosenItems keeps the measure arm as picked, dropping every other field', () => {
    expect(toChosenItems([
      { canonical: 'apple', measure: 'usda-4', amount: 1.5, grams: 999, name: 'Apple' },
      { canonical: 'oats', measure: 'g', amount: '40' }, // typed text is a number on the wire
      { canonical: 'dal', dishwareId: 'd-1', fillLevel: 0.5, measure: 'serving', amount: 2 }, // a dish wins: one arm only
    ])).toEqual([
      { canonical: 'apple', measure: 'usda-4', amount: 1.5 },
      { canonical: 'oats', measure: 'g', amount: 40 },
      { canonical: 'dal', dishwareId: 'd-1', fillLevel: 0.5 },
    ]);
  });

  it('composeAddIngredient appends a measure-arm ingredient, the existing items kept as saved', () => {
    const out = composeAddIngredient(
      [{ canonical: 'apple', gramsPoint: 273, measure: { id: 'usda-4', name: 'medium (3" dia)', amount: 1.5 } }],
      { canonical: 'peanut_butter', measure: 'usda-1', amount: 1, name: 'Peanut butter' },
    );
    expect(out).toEqual([
      { from: 0 },
      { canonical: 'peanut_butter', measure: 'usda-1', amount: 1 },
    ]);
  });

  // ── 7a-iv-g: one logged food changed, or removed ────────────────────────────
  const meal3 = [
    { canonical: 'apple', gramsPoint: 182 },
    { canonical: 'apple', gramsPoint: 91, nutritionSource: 'own' },
    { canonical: 'oats_dry', gramsPoint: 40 },
  ];

  it("composeFoodEdit sends only the changed food's amount, named by its place, and keeps every other as saved", () => {
    expect(composeFoodEdit(meal3, 1, { canonical: 'apple', measure: 'usda-4', amount: 2, name: 'Apple' })).toEqual([
      { from: 0 }, { canonical: 'apple', measure: 'usda-4', amount: 2, from: 1 }, { from: 2 },
    ]);
    expect(composeFoodEdit(meal3, 0, { canonical: 'apple', grams: 150 })).toEqual([
      { canonical: 'apple', grams: 150, from: 0 }, { from: 1 }, { from: 2 },
    ]);
    expect(composeFoodEdit(meal3, 2, { canonical: 'oats_dry', dishwareId: 'd-1', fillLevel: 0.5 })).toEqual([
      { from: 0 }, { from: 1 }, { canonical: 'oats_dry', dishwareId: 'd-1', fillLevel: 0.5, from: 2 },
    ]);
  });

  it("composeFoodEdit carries the person's own numbers: set, taken away, or left out to keep them", () => {
    const own = { proteinG: 1, carbsG: 20, fatG: 0.5 };
    expect(composeFoodEdit(meal3, 0, { canonical: 'apple', grams: 150 }, own)[0]).toEqual({ canonical: 'apple', grams: 150, from: 0, own });
    expect(composeFoodEdit(meal3, 1, { canonical: 'apple', grams: 91 }, null)[1]).toEqual({ canonical: 'apple', grams: 91, from: 1, own: null });
    expect('own' in composeFoodEdit(meal3, 1, { canonical: 'apple', grams: 91 })[1]).toBe(false);
  });

  it('composeRemoveFood leaves out exactly the one food, the twin of a food included', () => {
    expect(composeRemoveFood(meal3, 0)).toEqual([{ from: 1 }, { from: 2 }]);
    expect(composeRemoveFood(meal3, 1)).toEqual([{ from: 0 }, { from: 2 }]);
    expect(composeRemoveFood(meal3, 2)).toEqual([{ from: 0 }, { from: 1 }]);
  });

  it('updateMeal sends the composed items to the meals PATCH (Card 5c wiring)', async () => {
    const seen = recordRequests(authApi);
    await nutritionService.updateMeal('m-1', {
      items: composeAddIngredient(
        [{ canonical: 'oats_dry', gramsPoint: 40 }],
        { canonical: 'milk_whole', grams: 200 },
      ),
    });
    expect(seen[0]).toMatchObject({ url: '/v1/nutrition/meals/m-1', method: 'patch' });
    expect(JSON.parse(seen[0].data)).toEqual({
      items: [
        { from: 0 },
        { canonical: 'milk_whole', grams: 200 },
      ],
    });
  });

  it('mealType relabel PATCHes the label, and null CLEARS it (Card 5c)', async () => {
    const seen = recordRequests(authApi);
    await nutritionService.updateMeal('m-1', { mealType: 'lunch' });
    // null must survive as an explicit null — the contract's clear signal.
    // (patchMealRequestSchema: mealType is .nullable().optional(); the
    // omit-when-falsy trick used for confirm/manual would break clearing.)
    await nutritionService.updateMeal('m-1', { mealType: null });
    expect(JSON.parse(seen[0].data)).toEqual({ mealType: 'lunch' });
    expect(JSON.parse(seen[1].data)).toEqual({ mealType: null });
  });

  // HONEST SCOPE (T3 Card 5c): this pins the client's request SHAPE against a
  // recorder — it says nothing about the server accepting it. Extras beyond the
  // scan draft are 400 `invalid_item` until the `meal-composition` API branch
  // lands (its own route tests prove the server side). Green here + red in a
  // browser is exactly the Card-4 CORS class of gap, so the SMOKE for this card
  // MUST run after that merge.
  it('confirm/preview carry EXTRA items beyond the scan draft (Card 5c)', async () => {
    const seen = recordRequests(authApi);
    // The photo modal sends drafted items AND user-added ones in one array;
    // the server resolves the extras by canonical.
    const items = [
      { canonical: 'oats_dry', grams: 40 },
      { canonical: 'milk_whole', grams: 200 },
    ];
    await nutritionService.previewMeal({ scanToken: 'x'.repeat(40), items });
    await nutritionService.confirmMeal({ scanToken: 'x'.repeat(40), takenAt: '2026-07-17T08:00:00.000Z', items, mealType: 'breakfast' });
    expect(JSON.parse(seen[0].data).items).toEqual(items);
    expect(JSON.parse(seen[1].data)).toMatchObject({ items, mealType: 'breakfast' });
  });

  // ── Card 5d: previous-days page-walk ────────────────────────────────────────
  // Local-day window [start, end) for an arbitrary day; meals are built at
  // explicit LOCAL times so the epoch comparison is TZ-consistent with the
  // window (both derive from the same local midnight).
  describe('walkMealsForDay (Card 5d page-walk)', () => {
    const DAY = new Date(2026, 6, 15);          // Jul 15 2026, local midnight
    const start = DAY.getTime();
    const end = start + 24 * 60 * 60 * 1000;
    const at = (y, mo, d, h, mi = 0) => new Date(y, mo, d, h, mi).toISOString();
    const meal = (id, iso) => ({ id, takenAt: iso });

    it('returns only the day’s meals from a single final page (no next cursor)', async () => {
      let calls = 0;
      const fetchPage = async () => {
        calls += 1;
        return {
          items: [
            meal('a', at(2026, 6, 15, 20)),  // in-day
            meal('b', at(2026, 6, 15, 9)),   // in-day
            meal('c', at(2026, 6, 14, 23)),  // previous day
          ],
          nextCursor: null,
        };
      };
      const { meals, truncated } = await walkMealsForDay(fetchPage, start, end);
      expect(meals.map((m) => m.id)).toEqual(['a', 'b']);
      expect(truncated).toBe(false);
      expect(calls).toBe(1);
    });

    it('stops once a page reaches older-than-day data — never over-fetches', async () => {
      const pages = [
        { items: [meal('n1', at(2026, 6, 16, 10)), meal('d1', at(2026, 6, 15, 12))], nextCursor: 'c1' },
        { items: [meal('d2', at(2026, 6, 15, 8)),  meal('o1', at(2026, 6, 14, 20))], nextCursor: 'c2' },
        { items: [meal('o2', at(2026, 6, 13, 10))], nextCursor: 'c3' }, // must NOT be fetched
      ];
      let calls = 0;
      const fetchPage = async () => pages[calls++];
      const { meals, truncated } = await walkMealsForDay(fetchPage, start, end);
      expect(meals.map((m) => m.id)).toEqual(['d1', 'd2']);
      expect(truncated).toBe(false);
      expect(calls).toBe(2);
    });

    it('day window is [00:00, next 00:00): start included, end excluded', async () => {
      const fetchPage = async () => ({
        items: [
          meal('startEdge', new Date(start).toISOString()),   // exactly 00:00 → in
          meal('endEdge',   new Date(end).toISOString()),     // exactly next 00:00 → out
          meal('lastMs',    new Date(end - 1).toISOString()),  // 23:59:59.999 → in
        ],
        nextCursor: null,
      });
      const { meals } = await walkMealsForDay(fetchPage, start, end);
      expect(meals.map((m) => m.id).sort()).toEqual(['lastMs', 'startEdge']);
    });

    it('hitting the page cap before older data sets truncated', async () => {
      // Every page is newer than the day and keeps a cursor → the walk never
      // reaches older data; the cap is the only thing that stops it.
      let calls = 0;
      const fetchPage = async () => {
        calls += 1;
        return { items: [meal('newer', at(2026, 6, 16, 10))], nextCursor: 'more' };
      };
      const { meals, truncated } = await walkMealsForDay(fetchPage, start, end, 3);
      expect(truncated).toBe(true);
      expect(meals).toEqual([]);   // nothing was in-day
      expect(calls).toBe(3);       // exactly the cap
    });
  });

  it('listMealsForDay walks listMeals pages for the day, passing the cursor through', async () => {
    const today = new Date();
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    const isoAt = (base, h) => { const d = new Date(base); d.setHours(h, 0, 0, 0); return d.toISOString(); };
    const seenCursors = [];
    let call = 0;
    authApi.defaults.adapter = async (config) => {
      call += 1;
      seenCursors.push(config.params?.cursor);
      const data = call === 1
        ? { items: [{ id: 'today', takenAt: isoAt(today, 10) }], nextCursor: 'CUR' }
        : { items: [{ id: 'yest',  takenAt: isoAt(yesterday, 10) }], nextCursor: null };
      return { data, status: 200, statusText: '', headers: {}, config, request: {} };
    };
    const { meals, truncated } = await nutritionService.listMealsForDay(today);
    // page 1's today meal is collected; page 2 is yesterday (older) → stop.
    expect(meals.map((m) => m.id)).toEqual(['today']);
    expect(truncated).toBe(false);
    expect(seenCursors).toEqual([undefined, 'CUR']);
  });

  it('dishware CRUD hits /v1/nutrition/dishware (Card 5b)', async () => {
    const seen = recordRequests(authApi);
    await nutritionService.listDishware();
    await nutritionService.createDishware({ label: 'my dal bowl', containerClass: 'bowl', volumeMl: 250 });
    await nutritionService.updateDishware('d-1', { volumeMl: 300 });
    await nutritionService.deleteDishware('d-1');
    expect(seen[0]).toMatchObject({ url: '/v1/nutrition/dishware', method: 'get', params: { limit: 50 } });
    expect('cursor' in seen[0].params).toBe(false);
    expect(seen[1].method).toBe('post');
    expect(JSON.parse(seen[1].data)).toEqual({ label: 'my dal bowl', containerClass: 'bowl', volumeMl: 250 });
    expect(seen[2]).toMatchObject({ url: '/v1/nutrition/dishware/d-1', method: 'patch' });
    expect(seen[3]).toMatchObject({ url: '/v1/nutrition/dishware/d-1', method: 'delete' });
  });

  // ── Nutrition targets (the web half of the Mifflin-St Jeor card) ──────────
  it('getTargets hits the NEW /v1 endpoint', async () => {
    const seen = recordRequests(authApi);
    await nutritionService.getTargets();
    expect(seen[0]).toMatchObject({ url: '/v1/nutrition/targets', method: 'get' });
  });

  // 7a-iv-e: the switch's own call. Every render test mocks the service
  // wholesale, so this is the one place its verb, path and body are pinned — a
  // POST, or the singular path, would leave the switch dead in the browser.
  it('putTargets PUTs the switch, body as given, to the same /v1 endpoint', async () => {
    const seen = recordRequests(authApi);
    await nutritionService.putTargets({ source: 'own', kcal: 2000, proteinG: 150, carbsG: 200, fatG: 60 });
    await nutritionService.putTargets({ source: 'app' });
    expect(seen[0]).toMatchObject({ url: '/v1/nutrition/targets', method: 'put' });
    expect(JSON.parse(seen[0].data)).toEqual({ source: 'own', kcal: 2000, proteinG: 150, carbsG: 200, fatG: 60 });
    expect(seen[1]).toMatchObject({ url: '/v1/nutrition/targets', method: 'put' });
    expect(JSON.parse(seen[1].data)).toEqual({ source: 'app' });
  });

  // THE SILENT TRAP. The API returns camelCase (proteinG); MacroRings and the
  // Remaining card read snake_case (protein_g). A straight repoint yields
  // undefined, which `|| 150` used to render as a plausible fake number rather
  // than an error — so the bug would look like success. Pinned per macro.
  it('toDisplayTargets renames every macro to the snake_case the cards read', () => {
    const mapped = toDisplayTargets({
      targets: { bmr: 1320, tdee: 2046, kcal: 1646, proteinG: 120, carbsG: 189, fatG: 46 },
      missing: [],
    });
    expect(mapped).toEqual({ kcal: 1646, protein_g: 120, carbs_g: 189, fat_g: 46 });
    for (const key of ['kcal', 'protein_g', 'carbs_g', 'fat_g']) expect(mapped[key]).not.toBeUndefined();
  });

  // Three DISTINCT states. `{}` used to mean both "not loaded yet" and "no
  // targets" — the fabricated defaults hid the difference, and collapsing them
  // again would flash the honest state at every user while targets are still
  // in flight (the targets fetch does not own the page spinner).
  it('toDisplayTargets keeps "no targets" (null) distinct from "not loaded" (undefined)', () => {
    expect(toDisplayTargets({ targets: null, missing: ['age'] })).toBeNull();
    expect(toDisplayTargets(undefined)).toBeUndefined();
    expect(toDisplayTargets(null)).toBeUndefined();
    // A malformed/absent payload must NOT masquerade as "profile incomplete" —
    // that would tell a user to fill in fields they have already filled in.
    expect(toDisplayTargets({})).toBeUndefined();
  });

  // T3 F4: the container was type-checked but the VALUES were not, so a
  // targets object short one macro yielded `fat_g: undefined` → the ring
  // rendered "/ undefinedg" and Remaining rendered NaN, which `|| 0` turned
  // into a confident "0g left" invented from nothing — this card's own thesis,
  // one field short. Not producible by today's .strict() API; defence in depth.
  it('toDisplayTargets rejects a payload missing or corrupting any macro', () => {
    const good = { kcal: 1646, proteinG: 120, carbsG: 189, fatG: 46 };
    expect(toDisplayTargets({ targets: good, missing: [] })).not.toBeUndefined();
    for (const key of ['kcal', 'proteinG', 'carbsG', 'fatG']) {
      const short = { ...good }; delete short[key];
      expect(toDisplayTargets({ targets: short, missing: [] })).toBeUndefined();
      expect(toDisplayTargets({ targets: { ...good, [key]: null }, missing: [] })).toBeUndefined();
      expect(toDisplayTargets({ targets: { ...good, [key]: 'x' }, missing: [] })).toBeUndefined();
      expect(toDisplayTargets({ targets: { ...good, [key]: NaN }, missing: [] })).toBeUndefined();
    }
  });

  // T3 F5: `(missing ?? []).map` threw on a non-array, and the throw landed
  // AFTER setTargets had already stored good targets — so the catch discarded
  // real numbers and showed the prompt instead.
  it('missingAnswers survives a non-array without throwing', () => {
    for (const bad of [null, undefined, 'goal', 42, {}]) {
      expect(() => missingAnswers(bad)).not.toThrow();
      expect(missingAnswers(bad)).toEqual([]);
    }
  });

  it("missingAnswers keeps the server's own question keys, in its order, for the rings to word", () => {
    expect(missingAnswers(['goal', 'dayActivity'])).toEqual(['goal', 'dayActivity']);
    expect(missingAnswers([])).toEqual([]);
    // A key this screen does not know yet is kept, never dropped: naming fewer
    // questions than the plan needs would send the person to the wrong one.
    expect(missingAnswers(['somethingNew'])).toEqual(['somethingNew']);
    expect(missingAnswers(['goal', 7, null])).toEqual(['goal']);
  });
});
