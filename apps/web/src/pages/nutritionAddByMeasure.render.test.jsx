// ROADMAP 7a-iv-a — adding a food by measure, on the screen (RULINGS 2026-09-16,
// the portion redesign): Add food starts a picked food at the measure the server
// named, the picker steps and switches measures, a saved dish asks how full, what
// is sent is the measure and how many (never grams the browser worked out), and a
// saved meal reads by the measure each food was logged by.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { forgetUnsavedScan } from '../components/nutrition/unsavedScan';

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
const svc = {};
vi.mock('../api/nutritionApi', async (importOriginal) => ({ ...(await importOriginal()), nutritionService: svc }));

const Nutrition = (await import('./Nutrition')).default;
const toast = (await import('react-hot-toast')).default;

const apple = {
  canonical: 'apple', name: 'Apple', kcal: 52, proteinG: 0.26, carbsG: 13.81, fatG: 0.17, fiberG: 2.4, serving: 180, unit: 'apple', source: 'curated',
  measures: [
    { id: 'serving', name: 'apple', grams: 180 },
    { id: 'usda-4', name: 'medium (3" dia)', grams: 182 },
    { id: 'g', name: 'g', grams: 1 },
    { id: 'oz', name: 'oz', grams: 28.349523125 },
  ],
  startsAt: { measure: 'serving', amount: 1 },
};
const bowl = { id: 'd-1', label: 'My blue bowl', containerClass: 'cereal_bowl', volumeMl: 360, foodHint: null, createdAt: '2026-09-16T10:00:00.000Z' };

/** The server's preview: the grams it worked out for what was sent, priced. */
const previewOf = (grams) => ({
  data: {
    items: [{ name: 'Apple', canonical: 'apple', gramsPoint: grams, gramsRange: [grams, grams], portionSource: 'default', nutritionSource: 'curated', kcalPoint: Math.round(grams * 0.52), kcalLow: 0, kcalHigh: 0, proteinG: 0, carbsG: 0, fatG: 0 }],
    totals: { kcalPoint: Math.round(grams * 0.52), kcalLow: 0, kcalHigh: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  },
});

function renderPage({ meals = [], dishware = [] } = {}) {
  svc.listMealsForDay = vi.fn(async () => ({ meals, truncated: false }));
  svc.listDishware = vi.fn(async () => ({ data: { items: dishware, nextCursor: null } }));
  svc.getTargets = vi.fn(async () => ({ data: { targets: null, missing: ['goal'], targetWrongSide: false } }));
  svc.searchFoods = vi.fn(async () => ({ data: { items: [apple] } }));
  svc.previewMeal = vi.fn(async ({ items }) => {
    const [item] = items;
    const grams = item.dishwareId ? Math.round(360 * item.fillLevel) : item.measure === 'usda-4' ? Math.round(item.amount * 182) : Math.round(item.amount * 180);
    return previewOf(grams);
  });
  svc.logManualMeal = vi.fn(async () => ({ data: {} }));
  render(
    <MemoryRouter initialEntries={['/nutrition']}>
      <Nutrition />
    </MemoryRouter>,
  );
}

async function pickApple() {
  fireEvent.click(await screen.findByRole('button', { name: 'Add to Breakfast' }));
  fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'apple' } });
  fireEvent.click((await screen.findByText('Apple')).closest('button'));
  return screen.findByRole('button', { name: 'Measure' });
}

/** The measure the dropdown shows as picked. */
const picked = () => screen.getByRole('button', { name: 'Measure' }).textContent;
/** Every choice the open dropdown lists, closing it again. */
const offered = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Measure' }));
  const labels = screen.getAllByRole('option').map((o) => o.textContent);
  fireEvent.click(screen.getByRole('button', { name: 'Measure' }));
  return labels;
};
/** A measure picked the way a person picks it: open the list, tap the choice. */
const choose = (label) => {
  fireEvent.click(screen.getByRole('button', { name: 'Measure' }));
  fireEvent.click(screen.getByRole('option', { name: label }));
};

afterEach(() => { cleanup(); vi.clearAllMocks(); forgetUnsavedScan(); });

describe('adding a food by measure', () => {
  it("starts at the measure the server named, steps and switches measures, and sends the measure and how many", async () => {
    renderPage();
    await pickApple();
    const amount = screen.getByRole('spinbutton', { name: 'Amount' });
    expect(picked()).toBe('apple · 180 g');
    expect(amount.value).toBe('1');
    // The app's own dark list, never a native <select>, whose popup Windows draws
    // white with a blue bar (Kd's click-through of this card).
    expect(screen.queryByRole('combobox')).toBeNull();
    // Every measure the food has is offered, by its name and weight.
    expect(offered()).toEqual(['apple · 180 g', 'medium (3" dia) · 182 g', 'grams', 'ounces · 28.35 g', '+ Save a new dish…']);
    // The grams shown are the server's answer for what was sent.
    expect(await screen.findByText('= 180 g')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(amount.value).toBe('1.5');
    expect(await screen.findByText('= 270 g')).toBeTruthy();

    // Another measure starts at one of it.
    choose('medium (3" dia) · 182 g');
    expect(picked()).toBe('medium (3" dia) · 182 g');
    expect(screen.getByRole('spinbutton', { name: 'Amount' }).value).toBe('1');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Amount' }), { target: { value: '1.5' } });
    expect(await screen.findByText('= 273 g')).toBeTruthy();

    // Grams start at what the item weighed.
    choose('grams');
    expect(screen.getByRole('spinbutton', { name: 'Amount' }).value).toBe('273');
    choose('medium (3" dia) · 182 g');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Amount' }), { target: { value: '1.5' } });

    fireEvent.click(screen.getByRole('button', { name: 'Add Apple' }));
    await waitFor(() => expect(svc.logManualMeal).toHaveBeenCalledTimes(1));
    expect(svc.logManualMeal.mock.calls[0][0]).toMatchObject({
      mealName: 'Apple', mealType: 'breakfast', items: [{ canonical: 'apple', measure: 'usda-4', amount: 1.5 }],
    });
  });

  it('asks how full a saved dish was before anything can be added, and sends the dish and its fill', async () => {
    renderPage({ dishware: [bowl] });
    await pickApple();
    await waitFor(() => expect(offered()).toContain('My blue bowl · 360 ml'));

    choose('My blue bowl · 360 ml');
    // No amount box for a dish, and no fill assumed: nothing can be added yet.
    expect(screen.queryByRole('spinbutton', { name: 'Amount' })).toBeNull();
    const add = screen.getByRole('button', { name: 'Pick how full' });
    expect(add.disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '½' }));
    expect(await screen.findByText('= 180 g')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add Apple' }));
    await waitFor(() => expect(svc.logManualMeal).toHaveBeenCalledTimes(1));
    expect(svc.logManualMeal.mock.calls[0][0].items).toEqual([{ canonical: 'apple', dishwareId: 'd-1', fillLevel: 0.5 }]);
  });

  it('saves a new dish from the picker at a size of the global starter set, then asks how full it was', async () => {
    renderPage();
    svc.createDishware = vi.fn(async (input) => ({ data: { dishware: { ...bowl, id: 'd-2', label: input.label, containerClass: input.containerClass, volumeMl: input.volumeMl } } }));
    await pickApple();
    choose('+ Save a new dish…');
    // Appendix B's global starter set: a cup, a mug, a cereal bowl; or any size in ml.
    for (const size of ['Cup240 ml', 'Mug325 ml', 'Bowl375 ml', 'Type ml']) {
      expect(screen.getByRole('button', { name: size })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Bowl375 ml' }));
    // The saved list, as the server answers once the dish exists.
    svc.listDishware = vi.fn(async () => ({ data: { items: [{ ...bowl, id: 'd-2', label: 'My bowl', volumeMl: 375 }], nextCursor: null } }));
    fireEvent.click(screen.getByRole('button', { name: 'Save this dish' }));
    await waitFor(() => expect(svc.createDishware).toHaveBeenCalledWith({ label: 'My bowl', containerClass: 'cereal_bowl', volumeMl: 375 }));
    // The new dish is picked, and nothing can be added until the fill is.
    await waitFor(() => expect(picked()).toBe('My bowl · 375 ml'));
    expect(screen.getByRole('button', { name: 'Pick how full' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Full' })).toBeTruthy();
  });

  it('refuses to add an amount past what one food of a meal may weigh, and says why', async () => {
    renderPage();
    await pickApple();
    choose('medium (3" dia) · 182 g');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Amount' }), { target: { value: '60' } });
    const add = screen.getByRole('button', { name: 'Amount is too large' });
    expect(add.disabled).toBe(true);
    expect(screen.getByText(/That is more than 10,000 g/)).toBeTruthy();
  });

  it('starts a food at the measure the server named when that is not its first', async () => {
    renderPage();
    svc.searchFoods = vi.fn(async () => ({ data: { items: [{ ...apple, startsAt: { measure: 'usda-4', amount: 0.5 } }] } }));
    await pickApple();
    expect(picked()).toBe('medium (3" dia) · 182 g');
    expect(screen.getByRole('spinbutton', { name: 'Amount' }).value).toBe('0.5');
    await waitFor(() => expect(svc.previewMeal).toHaveBeenCalledWith({ items: [{ canonical: 'apple', measure: 'usda-4', amount: 0.5 }] }));
  });

  it('refuses an amount that comes to less than a gram, and says so rather than that the food failed', async () => {
    renderPage();
    await pickApple();
    choose('grams');
    // The amount says what it counts, beside it.
    expect(screen.getByRole('spinbutton', { name: 'Amount' }).nextElementSibling.textContent).toBe('grams');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Amount' }), { target: { value: '0.4' } });
    expect(screen.getByRole('button', { name: 'Amount is too small' }).disabled).toBe(true);
    expect(screen.getByText('That comes to less than 1 g — pick a larger amount.')).toBeTruthy();

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Amount' }), { target: { value: '0.5' } });
    expect(screen.queryByText('That comes to less than 1 g — pick a larger amount.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add Apple' }).disabled).toBe(false);
  });

  it('says what the server refused in the amount it was asked to price, and holds Add until another is picked', async () => {
    renderPage({ dishware: [bowl] });
    // The server weighs a dish by the food's own cup: this one refuses a quarter bowl.
    svc.previewMeal = vi.fn(async ({ items: [item] }) => {
      if (item.fillLevel === 0.25) throw Object.assign(new Error('400'), { response: { status: 400, data: { error: 'portion_out_of_range' } } });
      return previewOf(Math.round(360 * item.fillLevel));
    });
    await pickApple();
    await waitFor(() => expect(offered()).toContain('My blue bowl · 360 ml'));
    choose('My blue bowl · 360 ml');
    fireEvent.click(screen.getByRole('button', { name: '¼' }));
    expect(await screen.findByText('That amount is too small or too large to log — pick another amount.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pick another amount' }).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '½' }));
    expect(await screen.findByText('= 180 g')).toBeTruthy();
    expect(screen.queryByText('That amount is too small or too large to log — pick another amount.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add Apple' }).disabled).toBe(false);
  });

  it('says a refused amount on saving is the amount, not the food', async () => {
    renderPage();
    svc.logManualMeal = vi.fn(async () => {
      throw Object.assign(new Error('400'), { response: { status: 400, data: { error: 'unknown_measure' } } });
    });
    await pickApple();
    await screen.findByText('= 180 g');
    fireEvent.click(screen.getByRole('button', { name: 'Add Apple' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("That measure isn't one of this food's — pick one from the list."));
  });

  it('reads a saved meal by the measure each food was logged by', async () => {
    const at = new Date();
    at.setHours(8, 30, 0, 0);
    const item = (name, canonical, grams, measure) => ({
      name, canonical, gramsPoint: grams, gramsRange: [grams, grams], portionSource: 'default', nutritionSource: 'curated',
      kcalPoint: 10, kcalLow: 10, kcalHigh: 10, proteinG: 1, carbsG: 1, fatG: 1, ...(measure ? { measure } : {}),
    });
    renderPage({
      meals: [{
        id: '0f8fad5b-d9cb-469f-a165-70867728950e', takenAt: at.toISOString(), mealType: 'breakfast', mealName: 'Breakfast bowl',
        items: [
          item('Apple', 'apple', 273, { id: 'usda-4', name: 'medium (3" dia)', amount: 1.5 }),
          item('Oats', 'oats', 40, null),
        ],
        totals: { kcalPoint: 20, kcalLow: 20, kcalHigh: 20, proteinG: 2, carbsG: 2, fatG: 2 },
        confirmed: true, origin: 'manual', portionSource: 'default', nutritionSources: ['curated'], calcVersion: 1,
      }],
    });
    // One line a food, each a tap to change it (7a-iv-g).
    const foods = within(await screen.findByRole('list', { name: 'Foods in Breakfast bowl' }));
    expect(foods.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Apple1.5 × medium (3" dia) · 273 g · 10 kcal',
      'Oats40 g · 10 kcal',
    ]);
  });
});

describe('an ingredient added on the photo sheet', () => {
  // The scanned dal starts at the 132 g the photo saw (ROADMAP 7a-iv-b).
  const dal = {
    name: 'Dal (lentil curry)', canonical: 'dal_lentil_curry', gramsPoint: 132, gramsRange: [132, 132], portionSource: 'default', nutritionSource: 'curated',
    kcalPoint: 191, kcalLow: 191, kcalHigh: 191, proteinG: 9, carbsG: 19, fatG: 4,
    measures: [{ id: 'g', name: 'g', grams: 1 }, { id: 'oz', name: 'oz', grams: 28.349523125 }], startsAt: { measure: 'g', amount: 132 }, portionEstimated: true,
  };
  /** The added apple's own card, which holds its own picker. */
  const appleCard = () => within(screen.getByText('added by you').closest('.rounded-2xl'));

  async function scanAndAddApple() {
    renderPage();
    URL.createObjectURL = vi.fn(() => 'blob:meal');
    svc.analyzePhoto = vi.fn(async () => ({
      data: {
        scanToken: 't'.repeat(40), mealName: 'Dal plate', items: [dal], unknownItems: [], photoQuality: 'good',
        totals: { kcalPoint: 191, kcalLow: 191, kcalHigh: 191, proteinG: 9, carbsG: 19, fatG: 4 }, confirmed: false,
      },
    }));
    svc.previewMeal = vi.fn(async () => ({ data: { items: [dal], totals: dal } }));
    svc.confirmMeal = vi.fn(async () => ({ data: {} }));
    fireEvent.click(await screen.findByRole('button', { name: /Log meal from photo/ }));
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [new File(['x'], 'meal.jpg', { type: 'image/jpeg' })] } });
    await screen.findByText('Dal plate');
    fireEvent.click(screen.getByRole('button', { name: 'Add an ingredient' }));
    fireEvent.change(screen.getByPlaceholderText('e.g. milk, sugar, oil...'), { target: { value: 'apple' } });
    fireEvent.click((await screen.findByText('Apple')).closest('button'));
    return screen.findByText('added by you');
  }
  const chooseIn = (card, label) => {
    fireEvent.click(card.getByRole('button', { name: 'Measure' }));
    fireEvent.click(card.getByRole('option', { name: label }));
  };

  it('is picked by measure and saved as the measure and how many, beside the scanned row sent by its own', async () => {
    await scanAndAddApple();
    expect(appleCard().getByRole('button', { name: 'Measure' }).textContent).toBe('apple · 180 g');
    chooseIn(appleCard(), 'medium (3" dia) · 182 g');
    fireEvent.change(appleCard().getByRole('spinbutton', { name: 'Amount' }), { target: { value: '1.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm & log meal' }));
    await waitFor(() => expect(svc.confirmMeal).toHaveBeenCalledTimes(1));
    expect(svc.confirmMeal.mock.calls[0][0].items).toEqual([
      { canonical: 'dal_lentil_curry', measure: 'g', amount: 132 },
      { canonical: 'apple', measure: 'usda-4', amount: 1.5 },
    ]);
  });

  it('says on its own row when it comes to less than a gram', async () => {
    await scanAndAddApple();
    chooseIn(appleCard(), 'grams');
    fireEvent.change(appleCard().getByRole('spinbutton', { name: 'Amount' }), { target: { value: '0.4' } });
    expect(appleCard().getByText('That comes to less than 1 g — pick a larger amount.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirm & log meal' })).toBeNull();

    fireEvent.change(appleCard().getByRole('spinbutton', { name: 'Amount' }), { target: { value: '1' } });
    expect(screen.queryByText('That comes to less than 1 g — pick a larger amount.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Confirm & log meal' })).toBeTruthy();
  });
});
