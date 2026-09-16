// The photo sheet lists every food the scan saw (ROADMAP 7a-iii-b): each row says
// where its numbers come from, a food no table has reads as the scanner's own
// estimate, the total is "about" while one is on it, and "Change" swaps a row's
// food for one the person searches, at the same grams. A saved meal holding an
// estimate, and the day it is in, read "about" too.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
const svc = {};
vi.mock('../api/nutritionApi', async (importOriginal) => ({ ...(await importOriginal()), nutritionService: svc }));

const Nutrition = (await import('./Nutrition')).default;

const SCAN_TOKEN = 't'.repeat(40);
const item = (name, canonical, nutritionSource, gramsPoint, kcalPoint) => ({
  name, canonical, gramsPoint, gramsRange: [gramsPoint, gramsPoint], portionSource: 'default', nutritionSource,
  kcalPoint, kcalLow: kcalPoint, kcalHigh: kcalPoint, proteinG: 5, carbsG: 5, fatG: 5, pieces: null,
});
const totals = (kcal) => ({ kcalPoint: kcal, kcalLow: kcal, kcalHigh: kcal, proteinG: 20, carbsG: 20, fatG: 20 });
const TOAST = item('avocado toast', 'est_avocado_toast', 'estimate', 120, 280);
const PLATE = [
  item('Avocado', 'avocado', 'curated', 100, 160),
  item('Pumpkin, cooked', 'usda_fndds_2709692', 'usda', 60, 31),
  item('Yakult Original · Yakult', 'off_4901392000034', 'openfoodfacts', 65, 42),
  TOAST,
];

function scanReturns(items) {
  svc.analyzePhoto = vi.fn(async () => ({
    data: {
      scanToken: SCAN_TOKEN, mealName: 'Toast plate', items, unknownItems: [], photoQuality: 'good',
      totals: totals(items.reduce((n, i) => n + i.kcalPoint, 0)), confirmed: false,
    },
  }));
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:meal');
  svc.listMealsForDay = vi.fn(async () => ({ meals: [], truncated: false }));
  svc.listDishware = vi.fn(async () => ({ data: { items: [], nextCursor: null } }));
  svc.getTargets = vi.fn(async () => ({ data: { targets: null, missing: ['goal'], targetWrongSide: false } }));
  // The server's price for whatever the sheet sends: 100 kcal an item.
  svc.previewMeal = vi.fn(async ({ items }) => ({
    data: { items: items.map((i) => item(i.canonical, i.canonical, 'curated', i.grams, 100)), totals: totals(items.length * 100) },
  }));
  svc.confirmMeal = vi.fn(async () => ({ data: {} }));
  scanReturns(PLATE);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const draw = () =>
  render(
    <MemoryRouter initialEntries={['/nutrition']}>
      <Nutrition />
    </MemoryRouter>,
  );

async function scanPlate() {
  draw();
  fireEvent.click(await screen.findByRole('button', { name: /Log meal from photo/ }));
  fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [new File(['x'], 'meal.jpg', { type: 'image/jpeg' })] } });
  await screen.findByText('Avocado');
  return (name) => screen.getByText(name).closest('.rounded-xl');
}

describe('the photo sheet names where each food’s numbers come from', () => {
  it('tags every row, reads an estimate’s grams as the scanner’s, and makes the total "about"', async () => {
    // No preview answer here: the sheet shows the scan's own numbers.
    svc.previewMeal = vi.fn(async () => { throw new Error('no preview'); });
    const row = await scanPlate();
    expect(within(row('Avocado')).getByText('Our list')).toBeTruthy();
    expect(within(row('Pumpkin, cooked')).getByText('USDA')).toBeTruthy();
    expect(within(row('Yakult Original · Yakult')).getByText('Packaged product')).toBeTruthy();
    expect(within(row('avocado toast')).getByText('~120 g · estimate')).toBeTruthy();
    for (const name of ['Avocado', 'Pumpkin, cooked', 'Yakult Original · Yakult', 'avocado toast']) {
      expect(within(row(name)).getByRole('button', { name: 'Change' })).toBeTruthy();
    }
    expect(screen.getByText('about 513 kcal')).toBeTruthy();
    // The two tables that ask to be credited are, under the sheet.
    expect(screen.getByRole('link', { name: 'USDA FoodData Central' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Food Facts' })).toBeTruthy();

    // Grams the person sets are theirs; the food's figures are still the estimate.
    fireEvent.change(within(row('avocado toast')).getByRole('spinbutton'), { target: { value: '150' } });
    expect(await within(row('avocado toast')).findByText('150 g · estimate')).toBeTruthy();
  });

  it('reads a plain total, and credits no table, where every food is on our own list', async () => {
    svc.previewMeal = vi.fn(async () => { throw new Error('no preview'); });
    scanReturns([item('Avocado', 'avocado', 'curated', 100, 160), item('Eggs (scrambled)', 'eggs_scrambled', 'curated', 50, 75)]);
    await scanPlate();
    expect(screen.getByText('235 kcal')).toBeTruthy();
    expect(screen.queryByText(/about/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'USDA FoodData Central' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open Food Facts' })).toBeNull();
  });
});

describe('Change on a scanned row', () => {
  const bread = { canonical: 'usda_fndds_123', name: 'Bread, toasted', source: 'usda', kcal: 290, proteinG: 9, carbsG: 50, fatG: 4, fiberG: 3, serving: 30, unit: 'slice' };

  it('swaps the food for the one searched, at the same grams, and sends it as that food', async () => {
    // The search also answers with a food already on the sheet, which is never offered twice.
    const avocado = { ...bread, canonical: 'avocado', name: 'Avocado (searched)', source: 'curated' };
    svc.searchFoods = vi.fn(async () => ({ data: { items: [bread, avocado] } }));
    const row = await scanPlate();
    fireEvent.click(within(row('avocado toast')).getByRole('button', { name: 'Change' }));
    const box = await screen.findByPlaceholderText('Search the right food...');
    fireEvent.change(box, { target: { value: 'toast' } });
    const result = await screen.findByText('Bread, toasted');
    expect(screen.queryByText('Avocado (searched)')).toBeNull();
    fireEvent.click(result.closest('button'));

    // Until the server prices it, neither the row nor the total shows the scan's
    // numbers, which were the food it replaced.
    expect(within(row('Bread, toasted')).getByText('…')).toBeTruthy();
    expect(screen.getByText('Adding up your ingredients…')).toBeTruthy();

    // The row is the new food now, from its own table, and can be put back.
    const changed = row('Bread, toasted');
    expect(within(changed).getByText('USDA')).toBeTruthy();
    expect(within(changed).getByRole('spinbutton').value).toBe('120');
    expect(screen.queryByText('avocado toast')).toBeNull();
    expect(screen.queryByPlaceholderText('Search the right food...')).toBeNull();
    expect(svc.searchFoods).toHaveBeenCalledWith('toast', 15);

    // The server prices the new food at the row's grams; nothing is an estimate any more.
    const sent = [
      { canonical: 'avocado', grams: 100 }, { canonical: 'usda_fndds_2709692', grams: 60 },
      { canonical: 'off_4901392000034', grams: 65 }, { canonical: 'usda_fndds_123', grams: 120 },
    ];
    await waitFor(() => expect(svc.previewMeal).toHaveBeenLastCalledWith({ scanToken: SCAN_TOKEN, items: sent }));
    expect(await screen.findByText('400 kcal')).toBeTruthy();
    expect(screen.queryByText(/about \d/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm & log meal' }));
    await waitFor(() => expect(svc.confirmMeal).toHaveBeenCalledTimes(1));
    expect(svc.confirmMeal.mock.calls[0][0]).toMatchObject({ scanToken: SCAN_TOKEN, items: sent });
  });

  it('puts the scanned food back with Undo', async () => {
    svc.searchFoods = vi.fn(async () => ({ data: { items: [bread] } }));
    const row = await scanPlate();
    fireEvent.click(within(row('avocado toast')).getByRole('button', { name: 'Change' }));
    fireEvent.change(await screen.findByPlaceholderText('Search the right food...'), { target: { value: 'toast' } });
    fireEvent.click((await screen.findByText('Bread, toasted')).closest('button'));
    fireEvent.click(within(row('Bread, toasted')).getByRole('button', { name: 'Undo' }));
    expect(within(row('avocado toast')).getByText('~120 g · estimate')).toBeTruthy();
    await waitFor(() => expect(svc.previewMeal).toHaveBeenLastCalledWith({
      scanToken: SCAN_TOKEN,
      items: [{ canonical: 'avocado', grams: 100 }, { canonical: 'usda_fndds_2709692', grams: 60 }, { canonical: 'off_4901392000034', grams: 65 }, { canonical: 'est_avocado_toast', grams: 120 }],
    }));
  });
});

describe('a saved meal holding an estimate', () => {
  it('reads "about", names the estimate, and makes the day\'s line "about"', async () => {
    const saved = {
      id: '00000000-0000-4000-8000-000000000001', takenAt: new Date().toISOString(), mealType: 'breakfast', mealName: 'Toast plate',
      items: [item('Avocado', 'avocado', 'curated', 100, 160), { ...TOAST, per100g: { kcal: 233.3, proteinG: 5, carbsG: 18.3, fatG: 15 } }],
      totals: { kcalPoint: 440, kcalLow: 440, kcalHigh: 440, proteinG: 10, carbsG: 10, fatG: 10 },
      confirmed: true, origin: 'photo', portionSource: 'default', nutritionSources: ['curated', 'estimate'], calcVersion: 1,
    };
    svc.listMealsForDay = vi.fn(async () => ({ meals: [saved], truncated: false }));
    svc.getTargets = vi.fn(async () => ({ data: { targets: { bmr: 1400, tdee: 2000, kcal: 2000, proteinG: 100, carbsG: 200, fatG: 60, noCalorieCut: false }, missing: [], targetWrongSide: false } }));
    draw();
    expect(await screen.findByText(/^about 440 kcal · Protein 10g/)).toBeTruthy();
    expect(screen.getByText('Avocado 100g · avocado toast 120g (estimate)')).toBeTruthy();
    expect(screen.getByText('about 1560kcal')).toBeTruthy();
    expect(screen.getByText('about 90g')).toBeTruthy();
  });

  it('reads plainly where no meal of the day holds one', async () => {
    const saved = {
      id: '00000000-0000-4000-8000-000000000002', takenAt: new Date().toISOString(), mealType: 'breakfast', mealName: 'Avocado',
      items: [item('Avocado', 'avocado', 'curated', 100, 160)],
      totals: { kcalPoint: 160, kcalLow: 160, kcalHigh: 160, proteinG: 2, carbsG: 9, fatG: 15 },
      confirmed: true, origin: 'manual', portionSource: 'default', nutritionSources: ['curated'], calcVersion: 1,
    };
    svc.listMealsForDay = vi.fn(async () => ({ meals: [saved], truncated: false }));
    svc.getTargets = vi.fn(async () => ({ data: { targets: { bmr: 1400, tdee: 2000, kcal: 2000, proteinG: 100, carbsG: 200, fatG: 60, noCalorieCut: false }, missing: [], targetWrongSide: false } }));
    draw();
    expect(await screen.findByText(/^160 kcal · Protein 2g/)).toBeTruthy();
    expect(screen.getByText('1840kcal')).toBeTruthy();
    expect(screen.queryByText(/about/)).toBeNull();
  });
});
