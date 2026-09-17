// "Remaining today" says how far past a target the day went — "30 g over" —
// instead of 0 (RULINGS 2026-09-17, ROADMAP 7a-iv-b-ii). The rings are not
// this file's: their words are pinned in components/nutrition/MacroRings.render.test.jsx.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
const svc = {};
vi.mock('../api/nutritionApi', async (importOriginal) => ({ ...(await importOriginal()), nutritionService: svc }));

const Nutrition = (await import('./Nutrition')).default;

const item = (source) => ({
  name: 'Oats', canonical: source === 'estimate' ? 'est_oats' : 'oats', gramsPoint: 100, gramsRange: [100, 100],
  portionSource: 'default', nutritionSource: source, kcalPoint: 1, kcalLow: 1, kcalHigh: 1, proteinG: 1, carbsG: 1, fatG: 1,
});

/** Today holds one meal eating `eaten`, against `target`. */
function serve({ eaten, target, source = 'curated' }) {
  svc.listMealsForDay = vi.fn(async () => ({
    meals: [{
      id: '00000000-0000-4000-8000-000000000009', takenAt: new Date().toISOString(), mealType: 'lunch', mealName: 'Lunch',
      items: [item(source)],
      totals: { kcalPoint: eaten.kcal, kcalLow: eaten.kcal, kcalHigh: eaten.kcal, proteinG: eaten.protein, carbsG: eaten.carbs, fatG: eaten.fat },
      confirmed: true, origin: 'manual', portionSource: 'default', nutritionSources: [source], calcVersion: 1,
    }],
    truncated: false,
  }));
  svc.listDishware = vi.fn(async () => ({ data: { items: [], nextCursor: null } }));
  svc.getTargets = vi.fn(async () => ({
    data: {
      targets: { bmr: 1400, tdee: 2200, kcal: target.kcal, proteinG: target.protein, carbsG: target.carbs, fatG: target.fat, noCalorieCut: false },
      missing: [],
      targetWrongSide: false,
    },
  }));
  render(
    <MemoryRouter initialEntries={['/nutrition']}>
      <Nutrition />
    </MemoryRouter>,
  );
}

/** What the card prints beside each of its four labels. */
async function card(heading) {
  const box = (await screen.findByText(heading)).closest('.card-glass');
  const read = (label) => within(box).getByText(label).nextElementSibling.textContent;
  return { Calories: read('Calories'), Protein: read('Protein'), Carbs: read('Carbs'), Fat: read('Fat') };
}

const target = { kcal: 2000, protein: 100, carbs: 200, fat: 60 };

afterEach(() => cleanup());

describe('"Remaining today" under, at and over each target', () => {
  it.each([
    ['under every target', { kcal: 1500, protein: 80, carbs: 150, fat: 40 },
      { Calories: '500 kcal', Protein: '20 g', Carbs: '50 g', Fat: '20 g' }],
    ['exactly at every target', { kcal: 2000, protein: 100, carbs: 200, fat: 60 },
      { Calories: '0 kcal', Protein: '0 g', Carbs: '0 g', Fat: '0 g' }],
    ['over every target', { kcal: 2120, protein: 130, carbs: 260, fat: 75 },
      { Calories: '120 kcal over', Protein: '30 g over', Carbs: '60 g over', Fat: '15 g over' }],
    ['over some and under others', { kcal: 1999, protein: 101, carbs: 200, fat: 61 },
      { Calories: '1 kcal', Protein: '1 g over', Carbs: '0 g', Fat: '1 g over' }],
  ])('%s', async (_name, eaten, expected) => {
    serve({ eaten, target });
    expect(await card('Remaining today')).toEqual(expected);
  });

  it('a target a fraction under what was eaten rounds to 0, never "0 g over"', async () => {
    serve({ eaten: { kcal: 2000, protein: 100, carbs: 200, fat: 60 }, target: { kcal: 1999.6, protein: 99.6, carbs: 199.6, fat: 59.6 } });
    expect(await card('Remaining today')).toEqual({ Calories: '0 kcal', Protein: '0 g', Carbs: '0 g', Fat: '0 g' });
  });

  it('keeps "about" in front of an over row when the day holds an estimate', async () => {
    serve({ eaten: { kcal: 2120, protein: 130, carbs: 150, fat: 40 }, target, source: 'estimate' });
    expect(await card('Remaining today')).toEqual({
      Calories: 'about 120 kcal over', Protein: 'about 30 g over', Carbs: 'about 50 g', Fat: 'about 20 g',
    });
  });

  it('leaves a past day as what was eaten, with no "over"', async () => {
    serve({ eaten: { kcal: 2120, protein: 130, carbs: 260, fat: 75 }, target });
    await screen.findByText('Remaining today');
    fireEvent.click(screen.getByTitle('Previous day'));
    expect(await card('Eaten on this day')).toEqual({ Calories: '2120 kcal', Protein: '130 g', Carbs: '260 g', Fat: '75 g' });
  });
});
