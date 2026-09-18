// ROADMAP 7a-iv-g — changing a food already logged, on the screen (RULINGS
// 2026-09-17): a saved meal lists its foods one a line; a tap opens that food's
// box at the amount it was logged by; a new amount is priced by the server before
// it is saved; the person's own numbers are typed for the amount shown and their
// calories come back from the server; own numbers can be taken away; a food is
// removed, and the last one takes the meal. What is sent is the one food changed,
// named by its place, every other food kept as saved.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { forgetUnsavedScan } from '../components/nutrition/unsavedScan';

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
const svc = {};
vi.mock('../api/nutritionApi', async (importOriginal) => ({ ...(await importOriginal()), nutritionService: svc }));

const Nutrition = (await import('./Nutrition')).default;
const toast = (await import('react-hot-toast')).default;

const MEAL_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const CHICKEN_MEASURES = [
  { id: 'usda-1', name: 'cup, chopped or diced', grams: 140 },
  { id: 'g', name: 'g', grams: 1 },
  { id: 'oz', name: 'oz', grams: 28.349523125 },
];
const item = (name, canonical, grams, kcal, macros, extra = {}) => ({
  name, canonical, gramsPoint: grams, gramsRange: [grams, grams], portionSource: 'default', nutritionSource: 'curated',
  kcalPoint: kcal, kcalLow: kcal, kcalHigh: kcal, ...macros, ...extra,
});
const RICE = item('Rice (white, cooked)', 'rice_white', 150, 195, { proteinG: 4, carbsG: 42, fatG: 0.4 });
const CHICKEN = item('Chicken breast (cooked)', 'chicken_breast', 600, 990, { proteinG: 186, carbsG: 0, fatG: 21 });

function mealOf(items, name = 'Lunch plate') {
  const at = new Date();
  at.setHours(12, 30, 0, 0);
  return {
    id: MEAL_ID, takenAt: at.toISOString(), mealType: 'lunch', mealName: name, items,
    totals: { kcalPoint: items.reduce((n, i) => n + i.kcalPoint, 0), kcalLow: 0, kcalHigh: 0, proteinG: 0, carbsG: 0, fatG: 0 },
    confirmed: true, origin: 'manual', portionSource: 'default', nutritionSources: ['curated'], calcVersion: 1,
  };
}

/** The server's preview of an edit: the changed chicken priced at 165 kcal per
 *  100 g by its table, or by own numbers at 4/4/9 kcal a gram; every kept food as
 *  saved. */
function previewOf(meal, edit) {
  const items = edit.map((e) => {
    if (!('canonical' in e)) return meal.items[e.from];
    const grams = e.measure === 'usda-1' ? e.amount * 140 : e.measure === 'oz' ? Math.round(e.amount * 28.35) : e.amount ?? e.grams;
    if (e.own) {
      const kcal = Math.round(4 * e.own.proteinG + 4 * e.own.carbsG + 9 * e.own.fatG);
      return item(meal.items[e.from].name, e.canonical, grams, kcal, e.own, { nutritionSource: 'own' });
    }
    return item(meal.items[e.from].name, e.canonical, grams, Math.round(grams * 1.65), { proteinG: grams * 0.31, carbsG: 0, fatG: grams * 0.035 });
  });
  return { data: { items, totals: { kcalPoint: items.reduce((n, i) => n + i.kcalPoint, 0), kcalLow: 0, kcalHigh: 0, proteinG: 0, carbsG: 0, fatG: 0 } } };
}

function renderPage(meal) {
  svc.listMealsForDay = vi.fn(async () => ({ meals: [meal], truncated: false }));
  svc.listDishware = vi.fn(async () => ({ data: { items: [], nextCursor: null } }));
  svc.getTargets = vi.fn(async () => ({ data: { targets: null, missing: ['goal'], targetWrongSide: false } }));
  svc.getMealMeasures = vi.fn(async () => ({ data: { measures: meal.items.map((i) => (i.canonical === 'chicken_breast' ? CHICKEN_MEASURES : [{ id: 'g', name: 'g', grams: 1 }, { id: 'oz', name: 'oz', grams: 28.349523125 }])) } }));
  svc.previewMealEdit = vi.fn(async (_id, edit) => previewOf(meal, edit));
  svc.updateMeal = vi.fn(async () => ({ data: {} }));
  svc.deleteMeal = vi.fn(async () => ({}));
  render(
    <MemoryRouter initialEntries={['/nutrition']}>
      <Nutrition />
    </MemoryRouter>,
  );
}

/** Unfolds the meal's foods, beside its Delete, where they are folded. */
async function showFoods() {
  const toggle = await screen.findByRole('button', { name: /the foods in this meal$/ });
  if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
}

/** Opens a food's box by tapping its line, as a person does. */
async function open(name) {
  await showFoods();
  fireEvent.click(await screen.findByRole('button', { name: `Change ${name}` }));
  const box = await screen.findByRole('dialog', { name: `Change ${name}` });
  await within(box).findByRole('button', { name: 'Measure' });
  return within(box);
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); forgetUnsavedScan(); });

describe("a meal's foods", () => {
  it('start folded beside Delete, unfold and fold again, and stay unfolded after a food is changed', async () => {
    renderPage(mealOf([RICE, CHICKEN]));
    const toggle = await screen.findByRole('button', { name: 'Show the foods in this meal' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // Beside Delete, and no food line until it is tapped.
    expect(toggle.previousElementSibling.getAttribute('title')).toBe('Delete this meal');
    expect(screen.queryByRole('list', { name: 'Foods in Lunch plate' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Change Rice (white, cooked)' })).toBeNull();

    fireEvent.click(toggle);
    const hide = screen.getByRole('button', { name: 'Hide the foods in this meal' });
    expect(hide.getAttribute('aria-expanded')).toBe('true');
    expect(within(screen.getByRole('list', { name: 'Foods in Lunch plate' })).getAllByRole('button')).toHaveLength(2);

    fireEvent.click(hide);
    expect(screen.queryByRole('list', { name: 'Foods in Lunch plate' })).toBeNull();

    // Unfolded, a food changed and saved: the day is read again and the foods stay shown.
    const box = await open('Chicken breast (cooked)');
    fireEvent.change(box.getByRole('spinbutton', { name: 'Amount' }), { target: { value: '200' } });
    await box.findByText('330 kcal');
    fireEvent.click(box.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(svc.listMealsForDay).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('list', { name: 'Foods in Lunch plate' })).toBeTruthy();
  });

  it('has no fold for a meal holding no food', async () => {
    renderPage(mealOf([]));
    await screen.findByText('Lunch plate');
    expect(screen.queryByRole('button', { name: /the foods in this meal$/ })).toBeNull();
  });
});

describe('a food already logged', () => {
  it('opens at the amount it was logged by, prices a new amount on the server, and saves only that food', async () => {
    const meal = mealOf([RICE, CHICKEN]);
    renderPage(meal);
    const box = await open('Chicken breast (cooked)');
    expect(within(screen.getByRole('dialog')).getByText('Logged as 600 g · 990 kcal')).toBeTruthy();
    expect(box.getByRole('button', { name: 'Measure' }).textContent).toBe('grams');
    expect(box.getByRole('spinbutton', { name: 'Amount' }).value).toBe('600');
    // Nothing changed, nothing to save, and no preview asked for.
    expect(box.getByRole('button', { name: 'Save' }).disabled).toBe(true);
    expect(box.getByText('990 kcal')).toBeTruthy();
    expect(box.getByText('From the food list')).toBeTruthy();

    fireEvent.change(box.getByRole('spinbutton', { name: 'Amount' }), { target: { value: '200' } });
    await waitFor(() => expect(svc.previewMealEdit).toHaveBeenCalledWith(MEAL_ID, [{ from: 0 }, { canonical: 'chicken_breast', measure: 'g', amount: 200, from: 1 }]));
    expect(await box.findByText('330 kcal')).toBeTruthy();

    fireEvent.click(box.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(svc.updateMeal).toHaveBeenCalledTimes(1));
    expect(svc.updateMeal).toHaveBeenCalledWith(MEAL_ID, { items: [{ from: 0 }, { canonical: 'chicken_breast', measure: 'g', amount: 200, from: 1 }] });
    expect(toast.success).toHaveBeenCalledWith('Changed Chicken breast (cooked)');
    // The day is read again, and the box is gone.
    await waitFor(() => expect(svc.listMealsForDay).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens at the measure it was logged by, where the food still has it', async () => {
    const chicken = { ...CHICKEN, gramsPoint: 280, kcalPoint: 462, measure: { id: 'usda-1', name: 'cup, chopped or diced', amount: 2 } };
    renderPage(mealOf([chicken]));
    const box = await open('Chicken breast (cooked)');
    expect(screen.getByText('Logged as 2 × cup, chopped or diced · 280 g · 462 kcal')).toBeTruthy();
    expect(box.getByRole('button', { name: 'Measure' }).textContent).toBe('cup, chopped or diced · 140 g');
    expect(box.getByRole('spinbutton', { name: 'Amount' }).value).toBe('2');
    fireEvent.click(box.getByRole('button', { name: 'More' }));
    await waitFor(() => expect(svc.previewMealEdit).toHaveBeenCalledWith(MEAL_ID, [{ canonical: 'chicken_breast', measure: 'usda-1', amount: 2.5, from: 0 }]));
  });

  it('never shows the numbers of an amount no longer picked while the new one is priced', async () => {
    const meal = mealOf([RICE, CHICKEN]);
    renderPage(meal);
    const box = await open('Chicken breast (cooked)');
    fireEvent.change(box.getByRole('spinbutton', { name: 'Amount' }), { target: { value: '200' } });
    expect(await box.findByText('330 kcal')).toBeTruthy();
    // The next answer is held until released.
    let release;
    svc.previewMealEdit = vi.fn((_id, edit) => new Promise((resolve) => { release = () => resolve(previewOf(meal, edit)); }));
    fireEvent.change(box.getByRole('spinbutton', { name: 'Amount' }), { target: { value: '300' } });
    await waitFor(() => expect(svc.previewMealEdit).toHaveBeenCalledTimes(1));
    expect(box.queryByText('330 kcal')).toBeNull();
    expect(box.queryByText(/Protein 62 g/)).toBeNull();
    expect(box.getAllByText('…').length).toBeGreaterThan(0);
    release();
    expect(await box.findByText('495 kcal')).toBeTruthy();
  });

  it("opens by the gram where the food's measures cannot be read", async () => {
    const chicken = { ...CHICKEN, gramsPoint: 280, measure: { id: 'usda-1', name: 'cup, chopped or diced', amount: 2 } };
    renderPage(mealOf([chicken]));
    svc.getMealMeasures = vi.fn(async () => { throw new Error('Network Error'); });
    const box = await open('Chicken breast (cooked)');
    expect(box.getByRole('button', { name: 'Measure' }).textContent).toBe('grams');
    expect(box.getByRole('spinbutton', { name: 'Amount' }).value).toBe('280');
  });

  it("takes the person's own numbers for the amount shown, and shows the calories the server worked out", async () => {
    renderPage(mealOf([RICE, CHICKEN]));
    const box = await open('Chicken breast (cooked)');
    fireEvent.change(box.getByRole('spinbutton', { name: 'Amount' }), { target: { value: '200' } });
    await box.findByText('330 kcal');
    fireEvent.click(box.getByRole('button', { name: 'Type my own numbers' }));
    // Filled from the numbers shown for this amount, never blank.
    expect(box.getByRole('spinbutton', { name: 'Protein in grams' }).value).toBe('62');
    expect(box.getByRole('spinbutton', { name: 'Carbs in grams' }).value).toBe('0');
    expect(box.getByRole('spinbutton', { name: 'Fat in grams' }).value).toBe('7');
    expect(box.getByText('For 200 g, as you ate it — from a label or a restaurant.')).toBeTruthy();
    expect(box.getByText(/That leaves out\s+alcohol, so for a drink with alcohol keep the food list's numbers\./)).toBeTruthy();

    fireEvent.change(box.getByRole('spinbutton', { name: 'Protein in grams' }), { target: { value: '50' } });
    fireEvent.change(box.getByRole('spinbutton', { name: 'Fat in grams' }), { target: { value: '10' } });
    const sent = [{ from: 0 }, { canonical: 'chicken_breast', measure: 'g', amount: 200, from: 1, own: { proteinG: 50, carbsG: 0, fatG: 10 } }];
    await waitFor(() => expect(svc.previewMealEdit).toHaveBeenLastCalledWith(MEAL_ID, sent));
    // 200 + 90: the server's answer, shown before saving.
    expect(await box.findByText('Comes to 290 kcal')).toBeTruthy();
    expect(box.getByText('Your numbers')).toBeTruthy();

    // A number left empty is no number: nothing can be saved until it is filled.
    fireEvent.change(box.getByRole('spinbutton', { name: 'Carbs in grams' }), { target: { value: '' } });
    expect(box.getByText('Fill in protein, carbs and fat, in grams.')).toBeTruthy();
    expect(box.getByRole('button', { name: 'Save' }).disabled).toBe(true);
    fireEvent.change(box.getByRole('spinbutton', { name: 'Carbs in grams' }), { target: { value: '0' } });
    await box.findByText('Comes to 290 kcal');

    fireEvent.click(box.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(svc.updateMeal).toHaveBeenCalledWith(MEAL_ID, { items: sent }));
  });

  it("says the server's refusal of numbers heavier than the food, and holds Save", async () => {
    renderPage(mealOf([CHICKEN]));
    svc.previewMealEdit = vi.fn(async () => {
      throw Object.assign(new Error('400'), { response: { status: 400, data: { error: 'own_numbers_too_heavy', message: "Protein, carbs and fat together can't weigh more than the food itself (600 g)." } } });
    });
    const box = await open('Chicken breast (cooked)');
    fireEvent.click(box.getByRole('button', { name: 'Type my own numbers' }));
    fireEvent.change(box.getByRole('spinbutton', { name: 'Protein in grams' }), { target: { value: '700' } });
    expect(await box.findByText("Protein, carbs and fat together can't weigh more than the food itself (600 g).")).toBeTruthy();
    expect(box.getByRole('button', { name: 'Save' }).disabled).toBe(true);
  });

  it('says the meal changed elsewhere rather than saving over it', async () => {
    renderPage(mealOf([RICE, CHICKEN]));
    svc.previewMealEdit = vi.fn(async () => {
      throw Object.assign(new Error('409'), { response: { status: 409, data: { error: 'meal_changed' } } });
    });
    const box = await open('Chicken breast (cooked)');
    fireEvent.change(box.getByRole('spinbutton', { name: 'Amount' }), { target: { value: '200' } });
    expect(await box.findByText('This meal was changed somewhere else. Close this and open it again.')).toBeTruthy();
    expect(box.getByRole('button', { name: 'Save' }).disabled).toBe(true);
  });

  it("gives back the food list's numbers for a food of the person's own, and the scan's estimate for one typed over a scan", async () => {
    const own = { ...CHICKEN, nutritionSource: 'own', kcalPoint: 900, per100g: { kcal: 150, proteinG: 30, carbsG: 0, fatG: 3.33 } };
    renderPage(mealOf([RICE, own]));
    await showFoods();
    const line = await screen.findByRole('button', { name: 'Change Chicken breast (cooked)' });
    expect(line.textContent).toBe('Chicken breast (cooked)600 g · 900 kcal · your numbers');
    const box = await open('Chicken breast (cooked)');
    expect(box.getByText('These are your numbers. Change the amount and they grow or shrink with it.')).toBeTruthy();
    fireEvent.click(box.getByRole('button', { name: "Use the food list's numbers" }));
    expect(box.getByText("Saving puts back the food list's numbers for this amount.")).toBeTruthy();
    await waitFor(() => expect(svc.previewMealEdit).toHaveBeenCalledWith(MEAL_ID, [{ from: 0 }, { canonical: 'chicken_breast', measure: 'g', amount: 600, from: 1, own: null }]));
    await box.findByText('990 kcal');
    // "Keep my numbers" undoes it: nothing is changed, so nothing can be saved.
    fireEvent.click(box.getByRole('button', { name: 'Keep my numbers' }));
    expect(box.getByRole('button', { name: 'Save' }).disabled).toBe(true);
    fireEvent.click(box.getByRole('button', { name: "Use the food list's numbers" }));
    await box.findByText('990 kcal');
    fireEvent.click(box.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(svc.updateMeal).toHaveBeenCalledWith(MEAL_ID, { items: [{ from: 0 }, { canonical: 'chicken_breast', measure: 'g', amount: 600, from: 1, own: null }] }));

    cleanup();
    const scanned = { ...own, name: 'avocado toast', canonical: 'est_avocado_toast', scanEstimate: { kcal: 233, proteinG: 5, carbsG: 18, fatG: 15 } };
    renderPage(mealOf([scanned]));
    const again = await open('avocado toast');
    expect(again.getByRole('button', { name: "Use the scan's estimate" })).toBeTruthy();
    expect(again.queryByRole('button', { name: "Use the food list's numbers" })).toBeNull();
  });

  it('removes one food, keeping every other as saved, after asking', async () => {
    renderPage(mealOf([RICE, CHICKEN]));
    const box = await open('Rice (white, cooked)');
    fireEvent.click(box.getByRole('button', { name: 'Remove from this meal' }));
    expect(box.getByText('Remove Rice (white, cooked) from this meal?')).toBeTruthy();
    fireEvent.click(box.getByRole('button', { name: 'Keep it' }));
    expect(svc.updateMeal).not.toHaveBeenCalled();
    fireEvent.click(box.getByRole('button', { name: 'Remove from this meal' }));
    fireEvent.click(box.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(svc.updateMeal).toHaveBeenCalledWith(MEAL_ID, { items: [{ from: 1 }] }));
    expect(toast.success).toHaveBeenCalledWith('Removed Rice (white, cooked)');
    expect(svc.deleteMeal).not.toHaveBeenCalled();
  });

  it('asks to delete the whole meal when its only food is removed', async () => {
    renderPage(mealOf([CHICKEN]));
    const box = await open('Chicken breast (cooked)');
    fireEvent.click(box.getByRole('button', { name: 'Remove from this meal' }));
    expect(box.getByText('This is the only food in this meal. Delete the whole meal?')).toBeTruthy();
    fireEvent.click(box.getByRole('button', { name: 'Delete the meal' }));
    await waitFor(() => expect(svc.deleteMeal).toHaveBeenCalledWith(MEAL_ID));
    expect(svc.updateMeal).not.toHaveBeenCalled();
  });

  it('tells a food from its twin: the second of two of one food is the one changed', async () => {
    const small = { ...CHICKEN, gramsPoint: 100, kcalPoint: 165 };
    renderPage(mealOf([CHICKEN, small]));
    await showFoods();
    const lines = within(await screen.findByRole('list', { name: 'Foods in Lunch plate' })).getAllByRole('button');
    expect(lines.map((b) => b.textContent)).toEqual(['Chicken breast (cooked)600 g · 990 kcal', 'Chicken breast (cooked)100 g · 165 kcal']);
    fireEvent.click(lines[1]);
    const box = within(await screen.findByRole('dialog'));
    await box.findByRole('button', { name: 'Measure' });
    expect(box.getByRole('spinbutton', { name: 'Amount' }).value).toBe('100');
    fireEvent.change(box.getByRole('spinbutton', { name: 'Amount' }), { target: { value: '150' } });
    await waitFor(() => expect(svc.previewMealEdit).toHaveBeenCalledWith(MEAL_ID, [{ from: 0 }, { canonical: 'chicken_breast', measure: 'g', amount: 150, from: 1 }]));
  });
});
