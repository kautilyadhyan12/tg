// P2.8 web repoint (Card 5a) — nutritionService on the new /v1 API. Pins:
// exact paths/methods/params, the .strict()-safe bodies (retakeToken OMITTED
// when absent; confirm vs manual union discriminates on scanToken/mealName),
// grams clamping to the contract bounds, base64 prefix stripping, and the
// usage guard: no raw fetch / localStorage; mlApi survives ONLY for the D2
// interim (getTargets) + the Card-5b legacy pair (searchFood/logMeal).
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import authApi from './authApi';
import { composeAddIngredient, dataUrlToBase64, nutritionService, toChosenItems, walkMealsForDay } from './nutritionApi';

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

  it('analyzePhoto rejects wrong type / oversize before any request', async () => {
    const seen = recordRequests(authApi);
    await expect(nutritionService.analyzePhoto({ type: 'image/gif', size: 10 }))
      .rejects.toThrow(/JPEG, PNG, or WebP/);
    await expect(nutritionService.analyzePhoto({ type: 'image/png', size: 10 * 1024 * 1024 + 1 }))
      .rejects.toThrow(/10 MB/);
    expect(seen.length).toBe(0);
  });

  it('the module has no raw fetch/localStorage; mlApi remains ONLY for the documented interim', () => {
    const src = readFileSync(fileURLToPath(new URL('./nutritionApi.js', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/fetch\s*\(/);
    expect(src).not.toMatch(/localStorage\s*[.[]/);
    expect(src).not.toMatch(/VITE_ML_API_URL/);
    // Card 5b: the legacy searchFood/logMeal pair is DELETED — the only
    // remaining mlApi call is the D2 targets interim.
    expect(src.match(/mlApi\.(get|post|patch|delete)/g)).toEqual(['mlApi.get']);
  });

  // ── Card 5c: meal composition + change-label ────────────────────────────────
  it('composeAddIngredient keeps EVERY existing item (at stored grams) + appends the new one (Card 5c)', () => {
    // This is the real add-ingredient logic — a bug here silently REWRITES a
    // saved meal, so it is tested directly, not via a hand-built array (T3).
    const existing = [
      { canonical: 'oats_dry', gramsPoint: 40, name: 'Oats', kcalPoint: 156 },
      { canonical: 'banana', gramsPoint: 120, name: 'Banana', kcalPoint: 107 },
    ];
    const out = composeAddIngredient(existing, { canonical: 'milk_whole', grams: 200 });
    // all originals survive, mapped to {canonical, grams:gramsPoint}, extra fields dropped
    expect(out).toEqual([
      { canonical: 'oats_dry', grams: 40 },
      { canonical: 'banana', grams: 120 },
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
      { canonical: 'oats_dry', grams: 40 },
      { canonical: 'milk_whole', dishwareId: 'd-9', fillLevel: 0.5 },
    ]);
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
        { canonical: 'oats_dry', grams: 40 },
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
});
