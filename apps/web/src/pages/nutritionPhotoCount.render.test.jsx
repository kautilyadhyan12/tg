// ROADMAP 7a-iv-b — the photo sheet by measure (RULINGS 2026-09-16): each scanned
// row starts where the server started it, at one of its food's own measures the
// photo's count agreed with ("6 × nugget") or at the photo's own grams, marked an
// estimate until the person sets an amount; it is corrected in the same measure
// picker Add food has, and sent as the measure and how many.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { forgetUnsavedScan } from '../components/nutrition/unsavedScan';

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
const svc = {};
vi.mock('../api/nutritionApi', async (importOriginal) => ({ ...(await importOriginal()), nutritionService: svc }));

const Nutrition = (await import('./Nutrition')).default;

const GRAMS = { id: 'g', name: 'g', grams: 1 };
const OUNCES = { id: 'oz', name: 'oz', grams: 28.349523125 };
/** A scanned row as the server sends it: its food's measures, and where it starts. */
const item = (name, canonical, gramsPoint, { measures = [], startsAt = { measure: 'g', amount: gramsPoint }, portionEstimated = true } = {}) => ({
  name, canonical, gramsPoint, gramsRange: [gramsPoint, gramsPoint], portionSource: 'default', nutritionSource: 'curated',
  kcalPoint: 120, kcalLow: 120, kcalHigh: 120, proteinG: 5, carbsG: 5, fatG: 5,
  measures: [...measures, GRAMS, OUNCES], startsAt, portionEstimated,
});
const NUGGETS = item('Chicken nuggets', 'chicken_nuggets', 96, {
  measures: [{ id: 'usda-1', name: 'nugget', grams: 16 }, { id: 'usda-2', name: 'cup', grams: 140 }],
  startsAt: { measure: 'usda-1', amount: 6 }, portionEstimated: false,
});
const GRAPES = item('Grapes', 'grapes', 50, { measures: [{ id: 'usda-1', name: 'cup', grams: 151 }] });

function scanReturns(items, unknownItems = ['mango lassi']) {
  svc.analyzePhoto = vi.fn(async () => ({
    data: {
      scanToken: 't'.repeat(40), mealName: 'Counted plate', items, unknownItems, photoQuality: 'good',
      totals: { kcalPoint: 240, kcalLow: 240, kcalHigh: 240, proteinG: 10, carbsG: 10, fatG: 10 }, confirmed: false,
    },
  }));
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:meal');
  svc.listMealsForDay = vi.fn(async () => ({ meals: [], truncated: false }));
  svc.listDishware = vi.fn(async () => ({ data: { items: [], nextCursor: null } }));
  svc.getTargets = vi.fn(async () => ({ data: { targets: null, missing: ['goal'], targetWrongSide: false } }));
  svc.previewMeal = vi.fn(async () => { throw new Error('no preview in this test'); });
  svc.confirmMeal = vi.fn(async () => ({ data: {} }));
  scanReturns([NUGGETS, GRAPES]);
});
afterEach(() => { cleanup(); forgetUnsavedScan(); });

async function scanPlate() {
  render(
    <MemoryRouter initialEntries={['/nutrition']}>
      <Nutrition />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: /Log meal from photo/ }));
  const input = document.querySelector('input[type="file"]');
  fireEvent.change(input, { target: { files: [new File(['x'], 'meal.jpg', { type: 'image/jpeg' })] } });
  await screen.findByText('Counted plate');
  return (name) => screen.getAllByText(name)[0].closest('.rounded-2xl');
}
/** What a row's picker holds: the measure it shows as picked, and the amount. */
const pickerOf = (rowEl) => [
  within(rowEl).getByRole('button', { name: 'Measure' }).textContent,
  within(rowEl).getByRole('spinbutton', { name: 'Amount' }).value,
];

describe('where a scanned row starts', () => {
  it("starts a row at the measure the photo's count agreed with, and one at the photo's own grams marked an estimate", async () => {
    const row = await scanPlate();
    expect(pickerOf(row('Chicken nuggets'))).toEqual(['nugget · 16 g', '6']);
    expect(within(row('Chicken nuggets')).queryByText(/estimate/)).toBeNull();
    expect(pickerOf(row('Grapes'))).toEqual(['g', '50']);
    expect(within(row('Grapes')).getByText('~50 g · estimate')).toBeTruthy();
    // Every row lists its food's own measures, as Add food does.
    fireEvent.click(within(row('Grapes')).getByRole('button', { name: 'Measure' }));
    expect(within(row('Grapes')).getAllByRole('option').map((o) => o.textContent)).toEqual(['cup · 151 g', 'g', 'oz · 28.35 g', '+ Save a new dish…']);
    expect(svc.analyzePhoto).toHaveBeenCalledTimes(1);
  });

  it('steps a counted row by half its measure and a row in grams by ten, and the estimate mark goes once the amount is the person’s', async () => {
    const row = await scanPlate();
    fireEvent.click(within(row('Chicken nuggets')).getByRole('button', { name: 'More' }));
    expect(pickerOf(row('Chicken nuggets'))).toEqual(['nugget · 16 g', '6.5']);
    fireEvent.click(within(row('Grapes')).getByRole('button', { name: 'More' }));
    expect(pickerOf(row('Grapes'))).toEqual(['g', '60']);
    expect(within(row('Grapes')).queryByText(/estimate/)).toBeNull();
    // Back at the start, it is the scanner's guess again.
    fireEvent.click(within(row('Grapes')).getByRole('button', { name: 'Less' }));
    expect(within(row('Grapes')).getByText('~50 g · estimate')).toBeTruthy();
  });

  it('sends every row as the measure and how many it shows, never grams the browser worked out', async () => {
    const row = await scanPlate();
    fireEvent.change(within(row('Chicken nuggets')).getByRole('spinbutton', { name: 'Amount' }), { target: { value: '8' } });
    fireEvent.click(within(row('Grapes')).getByRole('button', { name: 'Measure' }));
    fireEvent.click(within(row('Grapes')).getByRole('option', { name: 'cup · 151 g' }));
    expect(pickerOf(row('Grapes'))).toEqual(['cup · 151 g', '1']);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm & log meal' }));
    await waitFor(() => expect(svc.confirmMeal).toHaveBeenCalledTimes(1));
    expect(svc.confirmMeal.mock.calls[0][0].items).toEqual([
      { canonical: 'chicken_nuggets', measure: 'usda-1', amount: 8 },
      { canonical: 'grapes', measure: 'usda-1', amount: 1 },
    ]);
  });

  it('says on its own row when an amount weighs more than one item of a meal may, or less than a gram', async () => {
    const row = await scanPlate();
    fireEvent.change(within(row('Grapes')).getByRole('spinbutton', { name: 'Amount' }), { target: { value: '20000' } });
    expect(within(row('Grapes')).getByText('That is more than 10,000 g — pick a smaller amount.')).toBeTruthy();
    // Nothing can be saved while an amount is unusable, and the row says why.
    expect(screen.queryByRole('button', { name: /Confirm/ })).toBeNull();
    fireEvent.change(within(row('Grapes')).getByRole('spinbutton', { name: 'Amount' }), { target: { value: '0.4' } });
    expect(within(row('Grapes')).getByText('That comes to less than 1 g — pick a larger amount.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Confirm/ })).toBeNull();
    fireEvent.change(within(row('Grapes')).getByRole('spinbutton', { name: 'Amount' }), { target: { value: '40' } });
    expect(within(row('Grapes')).queryByText(/pick a (larger|smaller) amount/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Confirm & log meal' })).toBeTruthy();
  });

  it('shows the scan’s own numbers only while every row is as the scan started it', async () => {
    const row = await scanPlate();
    expect(within(row('Chicken nuggets')).getByText('120 kcal')).toBeTruthy();
    expect(screen.getByText('240 kcal')).toBeTruthy();
    // One row moved and no server answer: neither it, the other row nor the total is the scan's any more.
    fireEvent.click(within(row('Grapes')).getByRole('button', { name: 'More' }));
    expect(within(row('Chicken nuggets')).queryByText('120 kcal')).toBeNull();
    expect(within(row('Chicken nuggets')).getByText('Calculating…')).toBeTruthy();
    expect(screen.queryByText('240 kcal')).toBeNull();
    expect(screen.getByText('Adding up your ingredients…')).toBeTruthy();
  });
});

describe('what is left out of the total', () => {
  it('is named, with the button above that adds it', async () => {
    await scanPlate();
    expect(screen.getByText('Not in the total: mango lassi — add it with “Add an ingredient” above if needed.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add an ingredient' })).toBeTruthy();
  });

  it('points at "Add an ingredient" only while it is there', async () => {
    // Two left out: "them".
    scanReturns([NUGGETS], ['mango lassi', 'black garlic relish']);
    await scanPlate();
    expect(screen.getByText('Not in the total: mango lassi, black garlic relish — add them with “Add an ingredient” above if needed.')).toBeTruthy();
    cleanup();
    forgetUnsavedScan(); // or Photo Log brings the unsaved scan above back
    // A meal holding the most items has no "Add an ingredient" to point at.
    const many = Array.from({ length: 29 }, (_, i) => item(`Food ${i + 1}`, `food_${i + 1}`, 100));
    scanReturns([NUGGETS, ...many], ['mango lassi']);
    await scanPlate();
    expect(screen.queryByRole('button', { name: 'Add an ingredient' })).toBeNull();
    expect(screen.getByText("That's the most items one meal can hold (30).")).toBeTruthy();
    expect(screen.getByText('Not in the total: mango lassi.')).toBeTruthy();
  });
});
