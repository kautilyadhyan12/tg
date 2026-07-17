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
import { dataUrlToBase64, nutritionService, toChosenItems } from './nutritionApi';

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
