// The photo sheet lists every food the scan saw (ROADMAP 7a-iii-b): each row says
// where its numbers come from, a food no table has reads as the scanner's own
// estimate, the total is "about" while one is on it, and "Change" swaps a row's
// food for one the person searches, at the same grams. A saved meal holding an
// estimate, and the day it is in, read "about" too. Each row is measured in the
// measure picker (ROADMAP 7a-iv-b).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { forgetUnsavedScan } from '../components/nutrition/unsavedScan';

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
const svc = {};
vi.mock('../api/nutritionApi', async (importOriginal) => ({ ...(await importOriginal()), nutritionService: svc }));

const Nutrition = (await import('./Nutrition')).default;

const SCAN_TOKEN = 't'.repeat(40);
const GRAMS = { id: 'g', name: 'g', grams: 1 };
const OUNCES = { id: 'oz', name: 'oz', grams: 28.349523125 };
const SLICE = { id: 'usda-1', name: 'slice', grams: 30 };
/** A saved meal's item, or a preview's. */
const item = (name, canonical, nutritionSource, gramsPoint, kcalPoint) => ({
  name, canonical, gramsPoint, gramsRange: [gramsPoint, gramsPoint], portionSource: 'default', nutritionSource,
  kcalPoint, kcalLow: kcalPoint, kcalHigh: kcalPoint, proteinG: 5, carbsG: 5, fatG: 5,
});
/** A scanned row: started at the photo's own grams unless told otherwise. */
const scanned = (name, canonical, nutritionSource, gramsPoint, kcalPoint, start = { measures: [], startsAt: { measure: 'g', amount: gramsPoint }, portionEstimated: true }) => ({
  ...item(name, canonical, nutritionSource, gramsPoint, kcalPoint),
  measures: [...start.measures, GRAMS, OUNCES], startsAt: start.startsAt, portionEstimated: start.portionEstimated,
});
const totals = (kcal) => ({ kcalPoint: kcal, kcalLow: kcal, kcalHigh: kcal, proteinG: 20, carbsG: 20, fatG: 20 });
const TOAST = scanned('avocado toast', 'est_avocado_toast', 'estimate', 120, 280);
const PLATE = [
  scanned('Avocado', 'avocado', 'curated', 100, 160),
  scanned('Pumpkin, cooked', 'usda_fndds_2709692', 'usda', 60, 31),
  scanned('Yakult Original · Yakult', 'off_4901392000034', 'openfoodfacts', 65, 42, { measures: [{ id: 'serving', name: 'bottle', grams: 65 }], startsAt: { measure: 'serving', amount: 1 }, portionEstimated: false }),
  TOAST,
];
/** What each measure the sheet may send weighs, as the server's list has it. */
const WEIGHS = { g: 1, oz: 28.349523125, serving: 65, 'usda-1': 30 };

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
  // The server's price for whatever the sheet sends: 100 kcal an item, at the grams its measure weighs.
  svc.previewMeal = vi.fn(async ({ items }) => ({
    data: { items: items.map((i) => item(i.canonical, i.canonical, 'curated', Math.round(i.amount * WEIGHS[i.measure]), 100)), totals: totals(items.length * 100) },
  }));
  svc.confirmMeal = vi.fn(async () => ({ data: {} }));
  scanReturns(PLATE);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); forgetUnsavedScan(); });

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
  return (name) => screen.getByText(name).closest('.rounded-2xl');
}
/** A row's own line, the button that opens and closes it; the sheet is a short list (RULINGS 2026-09-17). */
const lineOf = (rowEl) => rowEl.querySelector('button[aria-expanded]');
const open = (rowEl) => { if (lineOf(rowEl).getAttribute('aria-expanded') !== 'true') fireEvent.click(lineOf(rowEl)); };
/** What a row's picker holds: the measure it shows as picked, and the amount. */
const pickerOf = (rowEl) => [
  within(rowEl).getByRole('button', { name: 'Measure' }).textContent,
  within(rowEl).getByRole('spinbutton', { name: 'Amount' }).value,
];
const bread = {
  canonical: 'usda_fndds_123', name: 'Bread, toasted', source: 'usda', kcal: 290, proteinG: 9, carbsG: 50, fatG: 4, fiberG: 3, serving: 30, unit: 'slice',
  measures: [SLICE, GRAMS, OUNCES], startsAt: { measure: 'usda-1', amount: 1 },
};

describe('the photo sheet names where each food’s numbers come from', () => {
  it('tags every row, reads an estimate’s grams as the scanner’s, and makes the total "about"', async () => {
    // No preview answer here: the sheet shows the scan's own numbers.
    svc.previewMeal = vi.fn(async () => { throw new Error('no preview'); });
    const row = await scanPlate();
    expect(within(row('Avocado')).getByText('Our list')).toBeTruthy();
    expect(within(row('Pumpkin, cooked')).getByText('USDA')).toBeTruthy();
    expect(within(row('Yakult Original · Yakult')).getByText('Packaged product')).toBeTruthy();
    expect(within(row('avocado toast')).getByText('~120 g · estimate')).toBeTruthy();
    // A table food started at the photo's grams says its portion is the scanner's guess;
    // one started at a measure the count agreed with does not.
    expect(within(row('Avocado')).getByText('~100 g · estimate')).toBeTruthy();
    expect(within(row('Yakult Original · Yakult')).queryByText(/estimate/)).toBeNull();
    for (const name of ['Avocado', 'Pumpkin, cooked', 'Yakult Original · Yakult', 'avocado toast']) {
      open(row(name));
      expect(within(row(name)).getByRole('button', { name: 'Change food' })).toBeTruthy();
    }
    expect(screen.getByText('about 513 kcal')).toBeTruthy();
    // Photo scans say they estimate calories and cannot detect allergens (RULINGS 2026-09-09), in these words.
    expect(screen.getByText('Calories from a photo are an estimate. A photo cannot detect allergens.')).toBeTruthy();
    // The two tables that ask to be credited are, under the sheet.
    expect(screen.getByRole('link', { name: 'USDA FoodData Central' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Food Facts' })).toBeTruthy();

    // An amount the person sets is theirs; the food's figures are still the estimate.
    fireEvent.change(within(row('avocado toast')).getByRole('spinbutton', { name: 'Amount' }), { target: { value: '150' } });
    expect(within(row('avocado toast')).queryByText(/~120 g/)).toBeNull();
    expect(within(row('avocado toast')).getByText('Estimate')).toBeTruthy();
    expect(lineOf(row('avocado toast')).textContent).toContain('Estimate · 150 g');
  });

  it('reads "about" while a portion is still the photo’s own guess, and plainly once it is the person’s (the review of PR #76, L1)', async () => {
    svc.previewMeal = vi.fn(async ({ items }) => ({ data: { items: items.map((i) => item(i.canonical, i.canonical, 'curated', i.amount, 100)), totals: totals(items.length * 100) } }));
    scanReturns([scanned('Avocado', 'avocado', 'curated', 100, 160)]);
    const row = await scanPlate();
    expect(screen.getByText('about 160 kcal')).toBeTruthy();
    open(row('Avocado'));
    fireEvent.click(within(row('Avocado')).getByRole('button', { name: 'More' }));
    expect(await screen.findByText('100 kcal', { selector: 'p' })).toBeTruthy();
    expect(screen.queryByText(/about \d/)).toBeNull();
  });

  it('reads a plain total, and credits no table, where every food is on our own list', async () => {
    svc.previewMeal = vi.fn(async () => { throw new Error('no preview'); });
    // Both started at a measure the photo's count agreed with: nothing on the sheet is an estimate.
    const atMeasure = (food, canonical, grams, kcal) => scanned(food, canonical, 'curated', grams, kcal, { measures: [{ id: 'serving', name: 'piece', grams }], startsAt: { measure: 'serving', amount: 1 }, portionEstimated: false });
    scanReturns([atMeasure('Avocado', 'avocado', 100, 160), atMeasure('Eggs (scrambled)', 'eggs_scrambled', 50, 75)]);
    await scanPlate();
    expect(screen.getByText('235 kcal')).toBeTruthy();
    expect(screen.queryByText(/about/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'USDA FoodData Central' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open Food Facts' })).toBeNull();
  });
});

describe('Change on a scanned row', () => {
  it('swaps the food for the one searched, at the same grams, and sends it as that food', async () => {
    // The search also answers with a food already on the sheet, which is never offered twice.
    const avocado = { ...bread, canonical: 'avocado', name: 'Avocado (searched)', source: 'curated' };
    svc.searchFoods = vi.fn(async () => ({ data: { items: [bread, avocado] } }));
    const row = await scanPlate();
    open(row('avocado toast'));
    fireEvent.click(within(row('avocado toast')).getByRole('button', { name: 'Change food' }));
    const box = await screen.findByPlaceholderText('Search the right food...');
    fireEvent.change(box, { target: { value: 'toast' } });
    const result = await screen.findByText('Bread, toasted');
    expect(screen.queryByText('Avocado (searched)')).toBeNull();
    fireEvent.click(result.closest('button'));

    // Until the server prices it, neither the row nor the total shows the scan's
    // numbers, which were the food it replaced.
    expect(within(row('Bread, toasted')).getByText('Calculating…')).toBeTruthy();
    expect(screen.getByText('Adding up your ingredients…')).toBeTruthy();

    // The row is the new food now, from its own table, by the gram at the row's grams, and can be put back.
    const changed = row('Bread, toasted');
    expect(within(changed).getByText('USDA')).toBeTruthy();
    expect(pickerOf(changed)).toEqual(['grams', '120']);
    expect(screen.queryByText('avocado toast')).toBeNull();
    expect(screen.queryByPlaceholderText('Search the right food...')).toBeNull();
    expect(svc.searchFoods).toHaveBeenCalledWith('toast', 15);

    // The server prices the new food at the row's grams; nothing is an estimate any more.
    const sent = [
      { canonical: 'avocado', measure: 'g', amount: 100 }, { canonical: 'usda_fndds_2709692', measure: 'g', amount: 60 },
      { canonical: 'off_4901392000034', measure: 'serving', amount: 1 }, { canonical: 'usda_fndds_123', measure: 'g', amount: 120 },
    ];
    await waitFor(() => expect(svc.previewMeal).toHaveBeenLastCalledWith({ scanToken: SCAN_TOKEN, items: sent }));
    // The toast is no scanner's estimate any more, but the avocado and the pumpkin are still at
    // the photo's own grams, so the total still reads "about" (the review of PR #76, L1).
    expect(await screen.findByText('about 400 kcal')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm & log meal' }));
    await waitFor(() => expect(svc.confirmMeal).toHaveBeenCalledTimes(1));
    expect(svc.confirmMeal.mock.calls[0][0]).toMatchObject({ scanToken: SCAN_TOKEN, items: sent });
  });

  it('puts the scanned food back with Undo', async () => {
    svc.searchFoods = vi.fn(async () => ({ data: { items: [bread] } }));
    const row = await scanPlate();
    open(row('avocado toast'));
    fireEvent.click(within(row('avocado toast')).getByRole('button', { name: 'Change food' }));
    fireEvent.change(await screen.findByPlaceholderText('Search the right food...'), { target: { value: 'toast' } });
    fireEvent.click((await screen.findByText('Bread, toasted')).closest('button'));
    fireEvent.click(within(row('Bread, toasted')).getByRole('button', { name: 'Undo' }));
    expect(within(row('avocado toast')).getByText('~120 g · estimate')).toBeTruthy();
    await waitFor(() => expect(svc.previewMeal).toHaveBeenLastCalledWith({
      scanToken: SCAN_TOKEN,
      items: [
        { canonical: 'avocado', measure: 'g', amount: 100 }, { canonical: 'usda_fndds_2709692', measure: 'g', amount: 60 },
        { canonical: 'off_4901392000034', measure: 'serving', amount: 1 }, { canonical: 'est_avocado_toast', measure: 'g', amount: 120 },
      ],
    }));
  });
});

describe('the measure on a changed row', () => {
  // Two slices the scan counted, at 60 g: its row starts at two of its 30 g slices.
  const TWO_SLICES = scanned('bread', 'est_bread', 'estimate', 60, 160, { measures: [SLICE], startsAt: { measure: 'usda-1', amount: 2 }, portionEstimated: false });
  const changeTo = async (row, from, food) => {
    open(row(from));
    fireEvent.click(within(row(from)).getByRole('button', { name: 'Change food' }));
    fireEvent.change(await screen.findByPlaceholderText('Search the right food...'), { target: { value: 'toast' } });
    fireEvent.click((await screen.findByText(food.name)).closest('button'));
  };
  const plus = (rowEl) => fireEvent.click(within(rowEl).getByRole('button', { name: 'More' }));
  const bagel = { ...bread, canonical: 'usda_fndds_456', name: 'Bagel, toasted', measures: [{ id: 'usda-1', name: 'bagel', grams: 95 }, GRAMS, OUNCES] };

  beforeEach(() => {
    scanReturns([scanned('Avocado', 'avocado', 'curated', 100, 160), TWO_SLICES]);
    svc.searchFoods = vi.fn(async () => ({ data: { items: [bagel] } }));
  });

  it('starts the new food by the gram at the row’s grams, never by the measure of the food it replaced', async () => {
    const row = await scanPlate();
    open(row('bread'));
    expect(pickerOf(row('bread'))).toEqual(['slice · 30 g', '2']);
    await changeTo(row, 'bread', bagel);
    expect(pickerOf(row('Bagel, toasted'))).toEqual(['grams', '60']);
    // Ten grams a step, not another slice.
    plus(row('Bagel, toasted'));
    expect(pickerOf(row('Bagel, toasted'))).toEqual(['grams', '70']);
  });

  it('gives the scanned food back its own measure on Undo while the grams are what Change kept, and those grams otherwise', async () => {
    const row = await scanPlate();
    // Changed and put back untouched: the scan's two slices.
    await changeTo(row, 'bread', bagel);
    fireEvent.click(within(row('Bagel, toasted')).getByRole('button', { name: 'Undo' }));
    expect(pickerOf(row('bread'))).toEqual(['slice · 30 g', '2']);
    // Changed, stepped to other grams the server has priced, and put back: by the gram at those grams.
    await changeTo(row, 'bread', bagel);
    plus(row('Bagel, toasted'));
    // The server has priced the 70 g: the row reads its numbers, no longer "Calculating…".
    await waitFor(() => expect(svc.previewMeal.mock.lastCall?.[0].items[1]).toEqual({ canonical: 'usda_fndds_456', measure: 'g', amount: 70 }));
    await waitFor(() => expect(within(row('Bagel, toasted')).getByText(/^Protein 5g/)).toBeTruthy());
    fireEvent.click(within(row('Bagel, toasted')).getByRole('button', { name: 'Undo' }));
    expect(pickerOf(row('bread'))).toEqual(['grams', '70']);
  });

  // The review of PR #76 (H1): a row moved and not priced yet — the server's answer
  // still to come, or failing — is still the amount its own measure weighs.
  describe('on a row moved before the server has priced it', () => {
    beforeEach(() => {
      svc.previewMeal = vi.fn(async () => { throw new Error('the server has not answered'); });
    });

    it('keeps the grams the row’s own measure weighs, never the scan’s', async () => {
      const row = await scanPlate();
      open(row('bread'));
      fireEvent.change(within(row('bread')).getByRole('spinbutton', { name: 'Amount' }), { target: { value: '4' } });
      expect(lineOf(row('bread')).textContent).toContain('4 × slice');
      await changeTo(row, 'bread', bagel);
      // Four 30 g slices are 120 g, not the scan's 60.
      expect(pickerOf(row('Bagel, toasted'))).toEqual(['grams', '120']);
    });

    it('gives the scanned food back as it stood on Undo while the grams are what Change kept, and by the gram at the grams its measure weighs otherwise', async () => {
      const row = await scanPlate();
      open(row('bread'));
      fireEvent.change(within(row('bread')).getByRole('spinbutton', { name: 'Amount' }), { target: { value: '4' } });
      await changeTo(row, 'bread', bagel);
      fireEvent.click(within(row('Bagel, toasted')).getByRole('button', { name: 'Undo' }));
      expect(pickerOf(row('bread'))).toEqual(['slice · 30 g', '4']);
      // Changed, moved to one 95 g bagel, and put back: by the gram at 95.
      await changeTo(row, 'bread', bagel);
      fireEvent.click(within(row('Bagel, toasted')).getByRole('button', { name: 'Measure' }));
      fireEvent.click(within(row('Bagel, toasted')).getByRole('option', { name: 'bagel · 95 g' }));
      fireEvent.click(within(row('Bagel, toasted')).getByRole('button', { name: 'Undo' }));
      expect(pickerOf(row('bread'))).toEqual(['grams', '95']);
    });

    it('holds "Change food" while the row is a saved dish not weighed yet, and says why', async () => {
      svc.listDishware = vi.fn(async () => ({ data: { items: [{ id: 'd-1', label: 'My blue bowl', containerClass: 'cereal_bowl', volumeMl: 360, foodHint: null, createdAt: '2026-09-16T10:00:00.000Z' }], nextCursor: null } }));
      const row = await scanPlate();
      open(row('bread'));
      fireEvent.click(within(row('bread')).getByRole('button', { name: 'Measure' }));
      fireEvent.click(await within(row('bread')).findByRole('option', { name: 'My blue bowl · 360 ml' }));
      const change = within(row('bread')).getByRole('button', { name: 'Change food' });
      expect(change.disabled).toBe(true);
      expect(within(row('bread')).getByText('Pick how full it was first.')).toBeTruthy();
    });

    // The re-check of PR #76: each way the grams can be unknown says its own reason.
    const blueBowl = { id: 'd-1', label: 'My blue bowl', containerClass: 'cereal_bowl', volumeMl: 360, foodHint: null, createdAt: '2026-09-16T10:00:00.000Z' };
    const halfBowl = async (row) => {
      open(row('bread'));
      fireEvent.click(within(row('bread')).getByRole('button', { name: 'Measure' }));
      fireEvent.click(await within(row('bread')).findByRole('option', { name: 'My blue bowl · 360 ml' }));
      fireEvent.click(within(row('bread')).getByRole('button', { name: '½' }));
    };
    const holdOf = (rowEl) => {
      expect(within(rowEl).getByRole('button', { name: 'Change food' }).disabled).toBe(true);
      return within(rowEl).getByRole('button', { name: 'Change food' }).nextElementSibling?.textContent;
    };

    it('says an amount past what one item may weigh cannot be weighed, not that none is picked', async () => {
      const row = await scanPlate();
      open(row('bread'));
      // 400 slices of 30 g are 12,000 g.
      fireEvent.change(within(row('bread')).getByRole('spinbutton', { name: 'Amount' }), { target: { value: '400' } });
      expect(holdOf(row('bread'))).toBe("This amount can't be weighed — pick another.");
    });

    it('says a weighed dish the server gave no answer for could not be worked out, never that it is still working', async () => {
      svc.listDishware = vi.fn(async () => ({ data: { items: [blueBowl], nextCursor: null } }));
      const row = await scanPlate();
      await halfBowl(row);
      await waitFor(() => expect(svc.previewMeal.mock.lastCall?.[0].items[1]).toEqual({ canonical: 'est_bread', dishwareId: 'd-1', fillLevel: 0.5 }));
      await waitFor(() => expect(holdOf(row('bread'))).toBe("The grams couldn't be worked out just now."));
    });

    it('says a dish amount the server refused cannot be weighed', async () => {
      svc.listDishware = vi.fn(async () => ({ data: { items: [blueBowl], nextCursor: null } }));
      svc.previewMeal = vi.fn(async () => { throw Object.assign(new Error('Request failed with status code 400'), { response: { status: 400, data: { error: 'portion_out_of_range' } } }); });
      const row = await scanPlate();
      await halfBowl(row);
      await waitFor(() => expect(holdOf(row('bread'))).toBe("This amount can't be weighed — pick another."));
    });

    it('says a weighed dish waits for the other amounts while one of them is unusable', async () => {
      svc.listDishware = vi.fn(async () => ({ data: { items: [blueBowl], nextCursor: null } }));
      const row = await scanPlate();
      open(row('Avocado'));
      fireEvent.change(within(row('Avocado')).getByRole('spinbutton', { name: 'Amount' }), { target: { value: '' } });
      await halfBowl(row);
      expect(holdOf(row('bread'))).toBe('Finish the other amounts first.');
    });
  });
});

describe('what a search on the sheet offers', () => {
  const rye = { ...bread, canonical: 'usda_fndds_456', name: 'Rye bread' };
  // Each food already on the sheet, as a search would find it again under another name.
  const pumpkinAgain = { ...bread, canonical: 'usda_fndds_2709692', name: 'Pumpkin, found again' };
  const breadAgain = { ...bread, name: 'Bread, found again' };
  const avocadoAgain = { ...bread, canonical: 'avocado', name: 'Avocado, found again', source: 'curated' };

  it('never offers a scanned food again, for another row or as an added ingredient, even once its own row has changed', async () => {
    svc.searchFoods = vi.fn(async () => ({ data: { items: [bread] } }));
    const row = await scanPlate();
    // The pumpkin row becomes bread.
    open(row('Pumpkin, cooked'));
    fireEvent.click(within(row('Pumpkin, cooked')).getByRole('button', { name: 'Change food' }));
    fireEvent.change(await screen.findByPlaceholderText('Search the right food...'), { target: { value: 'toast' } });
    fireEvent.click((await screen.findByText('Bread, toasted')).closest('button'));

    // The avocado row's search finds the pumpkin the scan saw, the bread now on the sheet, and rye.
    svc.searchFoods = vi.fn(async () => ({ data: { items: [pumpkinAgain, breadAgain, rye] } }));
    open(row('Avocado'));
    fireEvent.click(within(row('Avocado')).getByRole('button', { name: 'Change food' }));
    fireEvent.change(await screen.findByPlaceholderText('Search the right food...'), { target: { value: 'food' } });
    expect(await screen.findByText('Rye bread')).toBeTruthy();
    expect(screen.queryByText('Pumpkin, found again')).toBeNull();
    expect(screen.queryByText('Bread, found again')).toBeNull();
    fireEvent.click(within(row('Avocado')).getByRole('button', { name: 'Change food' }));

    // "Add an ingredient" offers none of them, nor the avocado — while an amount box is empty, too.
    fireEvent.change(within(row('Avocado')).getByRole('spinbutton', { name: 'Amount' }), { target: { value: '' } });
    svc.searchFoods = vi.fn(async () => ({ data: { items: [pumpkinAgain, breadAgain, avocadoAgain, rye] } }));
    fireEvent.click(screen.getByRole('button', { name: /Add an ingredient/ }));
    fireEvent.change(await screen.findByPlaceholderText('e.g. milk, sugar, oil...'), { target: { value: 'food' } });
    expect(await screen.findByText('Rye bread')).toBeTruthy();
    for (const name of ['Pumpkin, found again', 'Bread, found again', 'Avocado, found again']) expect(screen.queryByText(name), name).toBeNull();
  });
});

describe('a saved meal holding an estimate', () => {
  it('reads "about", names the estimate, and makes the day\'s line "about"', async () => {
    const saved = {
      id: '00000000-0000-4000-8000-000000000001', takenAt: new Date().toISOString(), mealType: 'breakfast', mealName: 'Toast plate',
      items: [item('Avocado', 'avocado', 'curated', 100, 160), { ...item('avocado toast', 'est_avocado_toast', 'estimate', 120, 280), per100g: { kcal: 233.3, proteinG: 5, carbsG: 18.3, fatG: 15 } }],
      totals: { kcalPoint: 440, kcalLow: 440, kcalHigh: 440, proteinG: 10, carbsG: 10, fatG: 10 },
      confirmed: true, origin: 'photo', portionSource: 'default', nutritionSources: ['curated', 'estimate'], calcVersion: 1,
    };
    svc.listMealsForDay = vi.fn(async () => ({ meals: [saved], truncated: false }));
    svc.getTargets = vi.fn(async () => ({ data: { targets: { bmr: 1400, tdee: 2000, kcal: 2000, proteinG: 100, carbsG: 200, fatG: 60, noCalorieCut: false }, missing: [], targetWrongSide: false } }));
    draw();
    expect(await screen.findByText(/^about 440 kcal · Protein 10g/)).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Foods in Toast plate' })).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Avocado100 g · 160 kcal',
      'avocado toast120 g · 280 kcal · estimate',
    ]);
    expect(screen.getByText('about 1560 kcal')).toBeTruthy();
    expect(screen.getByText('about 90 g')).toBeTruthy();
  });

  it("reads the person's own numbers as theirs, and never as \"about\" (7a-iv-g)", async () => {
    const saved = {
      id: '00000000-0000-4000-8000-000000000003', takenAt: new Date().toISOString(), mealType: 'breakfast', mealName: 'Toast plate',
      items: [
        item('Avocado', 'avocado', 'curated', 100, 160),
        { ...item('avocado toast', 'est_avocado_toast', 'own', 120, 300), per100g: { kcal: 250, proteinG: 5, carbsG: 30, fatG: 12 }, scanEstimate: { kcal: 233.3, proteinG: 5, carbsG: 18.3, fatG: 15 } },
      ],
      totals: { kcalPoint: 460, kcalLow: 460, kcalHigh: 460, proteinG: 10, carbsG: 10, fatG: 10 },
      confirmed: true, origin: 'photo', portionSource: 'default', nutritionSources: ['curated', 'own'], calcVersion: 1,
    };
    svc.listMealsForDay = vi.fn(async () => ({ meals: [saved], truncated: false }));
    svc.getTargets = vi.fn(async () => ({ data: { targets: { bmr: 1400, tdee: 2000, kcal: 2000, proteinG: 100, carbsG: 200, fatG: 60, noCalorieCut: false }, missing: [], targetWrongSide: false } }));
    draw();
    expect(await screen.findByText(/^460 kcal · Protein 10g/)).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Foods in Toast plate' })).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Avocado100 g · 160 kcal',
      'avocado toast120 g · 300 kcal · your numbers',
    ]);
    expect(screen.getByText('1540 kcal')).toBeTruthy();
    expect(screen.queryByText(/about/)).toBeNull();
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
    expect(screen.getByText('1840 kcal')).toBeTruthy();
    expect(screen.queryByText(/about/)).toBeNull();
  });
});
