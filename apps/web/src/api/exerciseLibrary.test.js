// Exercise library repoint — the reader's tests.
//
// The first block is the one that matters most and it is the DECISIONS :2912
// lesson made mechanical: "M18 undid the whole repoint and all 46 tests stayed
// GREEN — the render suite must mock the api client, so nothing asserted WHICH
// backend was called. A repoint nothing asserts is one the next edit undoes."
// So the client's URL and its transport are asserted directly, from source.
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG_58, EXERCISE_CONTENT, slugForLegacyName } from '@app/shared';
import {
  CATALOG_MAX_PAGES,
  CATALOG_PAGE_LIMIT,
  buildLibraryRow,
  buildLibraryRows,
  categoryNames,
  fetchAllExercises,
  filterLibrary,
  readCatalogPage,
} from './exerciseLibrary';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientSrc = fs.readFileSync(path.join(here, 'exerciseApi.js'), 'utf8');

const row = (slug) => ({ slug, nameKey: `exercise.${slug}`, family: 'F1', tier: 'T1', tracking: 'pose', met: 6, difficulty: null, equipment: null, muscles: null });
const page = (items, nextCursor = null) => ({ data: { items, nextCursor } });

describe('the repoint itself — which backend is called', () => {
  it('reads the catalog from the NEW /v1 API', () => {
    expect(clientSrc).toMatch(/authApi\.get\('\/v1\/exercises'/);
  });

  it('does not touch the old ML backend at all', () => {
    // The whole point of the card. `mlApi` is the old backend's client; if this
    // string comes back, some call was left behind or reintroduced.
    expect(clientSrc).not.toMatch(/mlApi/);
  });

  it('sends no filter or page parameters — the endpoint is .strict()', () => {
    // An unknown query key is a 400, so a future author adding `search=` here
    // would break the screen rather than filter it. Asserted at the seam that
    // builds the request, not in a comment.
    const captured = [];
    const fetchPage = vi.fn((params) => { captured.push(params); return Promise.resolve(page([row('squat')])); });
    return fetchAllExercises(fetchPage).then(() => {
      expect(captured).toHaveLength(1);
      expect(Object.keys(captured[0]).sort()).toEqual(['limit']);
      expect(captured[0].limit).toBe(CATALOG_PAGE_LIMIT);
    });
  });

  it('quotes the shared schema ceiling rather than choosing one', () => {
    // packages/shared/src/catalog.ts declares .max(100). Asking for more is a 400.
    expect(CATALOG_PAGE_LIMIT).toBe(100);
  });
});

describe('readCatalogPage', () => {
  it('reads a well-formed page', () => {
    expect(readCatalogPage({ items: [row('squat')], nextCursor: 'squat' }))
      .toEqual({ items: [row('squat')], nextCursor: 'squat' });
  });

  it('distinguishes an unreadable payload from an empty one', () => {
    // null vs {items: []} is load-bearing: the caller throws on the first and
    // draws an empty library on the second.
    expect(readCatalogPage(null)).toBeNull();
    expect(readCatalogPage([])).toBeNull();
    expect(readCatalogPage({})).toBeNull();
    expect(readCatalogPage({ items: 'squat' })).toBeNull();
    expect(readCatalogPage({ items: [], nextCursor: null })).toEqual({ items: [], nextCursor: null });
  });

  it('drops rows with no usable slug, keeping the rest', () => {
    const read = readCatalogPage({ items: [row('squat'), null, { slug: '' }, { nameKey: 'x' }, row('plank')], nextCursor: null });
    expect(read.items.map((i) => i.slug)).toEqual(['squat', 'plank']);
  });

  it('treats an empty-string cursor as the end, not as a cursor', () => {
    expect(readCatalogPage({ items: [], nextCursor: '' }).nextCursor).toBeNull();
  });
});

describe('fetchAllExercises', () => {
  it('follows the cursor to the end and concatenates', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce(page([row('a'), row('b')], 'b'))
      .mockResolvedValueOnce(page([row('c')], null));
    const { items, truncated } = await fetchAllExercises(fetchPage);
    expect(items.map((i) => i.slug)).toEqual(['a', 'b', 'c']);
    expect(truncated).toBe(false);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage.mock.calls[1][0]).toEqual({ limit: CATALOG_PAGE_LIMIT, cursor: 'b' });
  });

  it('stops at the page cap and SAYS it was truncated', async () => {
    // A server that never stops handing back a cursor must not spin forever,
    // and must not have its partial answer drawn as the whole library.
    const fetchPage = vi.fn(() => Promise.resolve(page([row('x')], 'x')));
    const { items, truncated } = await fetchAllExercises(fetchPage);
    expect(fetchPage).toHaveBeenCalledTimes(CATALOG_MAX_PAGES);
    expect(items).toHaveLength(CATALOG_MAX_PAGES);
    expect(truncated).toBe(true);
  });

  it('throws on an unreadable page rather than returning a partial catalog', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce(page([row('a')], 'a'))
      .mockResolvedValueOnce({ data: { broken: true } });
    await expect(fetchAllExercises(fetchPage)).rejects.toThrow(/unreadable/);
  });
});

describe('buildLibraryRow — the join', () => {
  it('carries the content table\'s words onto the row', () => {
    const built = buildLibraryRow(row('squat'), () => false);
    expect(built.name).toBe('Squats');
    expect(built.primary_category).toBe('Strength Training');
    expect(built.difficulty).toBe('beginner');
    expect(built.instructions.length).toBeGreaterThan(0);
    expect(built.common_mistakes.length).toBeGreaterThan(0);
    expect(built.muscles_primary).toContain('Quadriceps');
    expect(built.id).toBe('squat');
  });

  it('keeps the OLD payload field names, which four other screens read', () => {
    // Renaming these would silently break ExerciseDetail, WorkoutBuilder,
    // PreWorkout and the workout_builder draft in localStorage.
    const built = buildLibraryRow(row('squat'), () => false);
    for (const key of [
      'id', 'name', 'description', 'primary_category', 'difficulty', 'equipment',
      'muscles_primary', 'muscles_secondary', 'calories_per_min', 'reps_default',
      'sets_default', 'duration_seconds', 'instructions', 'common_mistakes', 'ai_supported',
    ]) {
      expect(built).toHaveProperty(key);
    }
  });

  it('fabricates NOTHING for a catalog row it stocks no words for', () => {
    const built = buildLibraryRow(row('brand_new_move'), () => false);
    expect(built.name).toBe('Brand New Move');       // derived from the value
    expect(built.description).toBeNull();
    expect(built.difficulty).toBeNull();             // not "beginner"
    expect(built.calories_per_min).toBeNull();       // not 0
    expect(built.instructions).toEqual([]);
    expect(built.common_mistakes).toEqual([]);
  });

  it('takes the AI badge from the capability, never from stored copy', () => {
    expect(buildLibraryRow(row('squat'), (s) => s === 'squat').ai_supported).toBe(true);
    expect(buildLibraryRow(row('squat'), () => false).ai_supported).toBe(false);
    // A missing or non-function capability is FALSE, never a badge by default.
    expect(buildLibraryRow(row('squat'), undefined).ai_supported).toBe(false);
    // Only an exact `true` counts — a truthy object must not badge.
    expect(buildLibraryRow(row('squat'), () => ({})).ai_supported).toBe(false);
  });

  it('badges exactly the exercises the capability names, not the seed\'s eight', () => {
    // The Mongo seed marks EIGHT ai_supported; the engine ships three. If the
    // flag ever gets copied out of the content table this goes red.
    const all = buildLibraryRows(
      EXERCISE_CONTENT.map((c) => row(c.slug)),
      (s) => ['squat', 'jump_squat', 'chair_squat'].includes(s),
    );
    expect(all.filter((r) => r.ai_supported).map((r) => r.slug).sort())
      .toEqual(['chair_squat', 'jump_squat', 'squat']);
  });

  it('sorts by name', () => {
    const rows = buildLibraryRows([row('squat'), row('bicep_curl'), row('plank')], () => false);
    expect(rows.map((r) => r.name)).toEqual(['Bicep Curls', 'Plank', 'Squats']);
  });
});

describe('THE NAME IS LOAD-BEARING — a workout must still be able to save', () => {
  // ActiveWorkout hands the name this screen put in the draft to
  // `slugForLegacyName`, an exact-match lookup that returns null rather than
  // guessing; a null PARKS the whole workout unsynced. A "tidied" name in the
  // content table would not fail a type check — it would silently stop hand
  // counted workouts from saving. This is the test that catches that.
  it('every displayed name resolves back to its own slug', () => {
    const misses = [];
    for (const item of EXERCISE_CONTENT) {
      const shown = buildLibraryRow(row(item.slug), () => false).name;
      if (slugForLegacyName(shown) !== item.slug) misses.push([item.slug, shown, slugForLegacyName(shown)]);
    }
    expect(misses).toEqual([]);
  });

  it('covers the whole catalog, in both directions', () => {
    const content = EXERCISE_CONTENT.map((c) => c.slug).sort();
    const catalog = CATALOG_58.map((c) => c.slug).sort();
    expect(content).toEqual(catalog);
    expect(content).toHaveLength(58);
  });
});

describe('filterLibrary', () => {
  const rows = buildLibraryRows(EXERCISE_CONTENT.map((c) => row(c.slug)), () => false);

  it('returns everything when nothing is asked', () => {
    expect(filterLibrary(rows)).toHaveLength(58);
    expect(filterLibrary(rows, { search: '  ', category: 'All', difficulty: 'All' })).toHaveLength(58);
  });

  it('matches a category on the SECONDARY list too, as the old server did', () => {
    // Push-ups are primarily Strength Training and also tagged Upper Body.
    // Tapping Upper Body must find them, or the pill looks broken.
    const pushUp = rows.find((r) => r.slug === 'push_up');
    expect(pushUp.primary_category).toBe('Strength Training');
    expect(pushUp.categories).toContain('Upper Body');
    expect(filterLibrary(rows, { category: 'Upper Body' }).map((r) => r.slug)).toContain('push_up');
  });

  it('filters by difficulty', () => {
    const beginners = filterLibrary(rows, { difficulty: 'beginner' });
    expect(beginners).toHaveLength(35);
    expect(beginners.every((r) => r.difficulty === 'beginner')).toBe(true);
  });

  it('searches name, muscles and equipment, case-insensitively', () => {
    expect(filterLibrary(rows, { search: 'SQUAT' }).map((r) => r.slug)).toContain('squat');
    expect(filterLibrary(rows, { search: 'hamstrings' }).length).toBeGreaterThan(0);
    expect(filterLibrary(rows, { search: 'dumbbells' }).length).toBeGreaterThan(0);
  });

  it('combines filters instead of letting one drop the other', () => {
    // The old server had this exact bug and its own header records the fix:
    // "category and muscle both wrote to query[$or], so combining them silently
    // dropped the category filter".
    const combined = filterLibrary(rows, { category: 'Yoga', difficulty: 'beginner' });
    expect(combined.length).toBeGreaterThan(0);
    expect(combined.every((r) => r.difficulty === 'beginner')).toBe(true);
    expect(combined.every((r) => r.primary_category === 'Yoga' || r.categories.includes('Yoga'))).toBe(true);
    // And it is genuinely narrower than either alone.
    expect(combined.length).toBeLessThan(filterLibrary(rows, { category: 'Yoga' }).length);
  });

  it('returns nothing for a search that matches nothing', () => {
    expect(filterLibrary(rows, { search: 'zzzznotanexercise' })).toEqual([]);
  });
});

describe('categoryNames', () => {
  it('derives the categories from the data, in first-seen order', () => {
    expect(categoryNames([{ primaryCategory: 'B' }, { primaryCategory: 'A' }, { primaryCategory: 'B' }]))
      .toEqual(['B', 'A']);
  });

  it('finds eleven in the content table', () => {
    expect(categoryNames()).toHaveLength(11);
  });
});
