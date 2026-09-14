// The photo sheet's count stepper: an item the scan counted starts at its count,
// and one step is one piece, so six nuggets read ×6 and + makes seven. An item
// the count did not size starts at ×1, one step its whole estimate.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
const svc = {};
vi.mock('../api/nutritionApi', async (importOriginal) => ({ ...(await importOriginal()), nutritionService: svc }));

const Nutrition = (await import('./Nutrition')).default;

const item = (name, canonical, gramsPoint, pieces) => ({
  name, canonical, gramsPoint, gramsRange: [gramsPoint, gramsPoint], portionSource: 'default', nutritionSource: 'curated',
  kcalPoint: 120, kcalLow: 120, kcalHigh: 120, proteinG: 5, carbsG: 5, fatG: 5, pieces,
});

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:meal');
  svc.listMealsForDay = vi.fn(async () => ({ meals: [], truncated: false }));
  svc.listDishware = vi.fn(async () => ({ data: { items: [], nextCursor: null } }));
  svc.getTargets = vi.fn(async () => ({ data: { targets: null, missing: ['goal'], targetWrongSide: false } }));
  svc.previewMeal = vi.fn(async () => { throw new Error('no preview in this test'); });
  svc.analyzePhoto = vi.fn(async () => ({
    data: {
      scanToken: 't'.repeat(40), mealName: 'Counted plate', cuisineGuess: null,
      items: [item('Chicken nuggets', 'chicken_nuggets', 96, 6), item('Grapes', 'grapes', 100, null), item('Meatballs (in sauce)', 'meatballs_in_sauce', 1720, 40)],
      unknownItems: ['mango lassi'], photoQuality: 'good',
      totals: { kcalPoint: 240, kcalLow: 240, kcalHigh: 240, proteinG: 10, carbsG: 10, fatG: 10 }, confirmed: false,
    },
  }));
});
afterEach(() => cleanup());

async function scanPlate() {
  render(
    <MemoryRouter initialEntries={['/nutrition']}>
      <Nutrition />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: /Log meal from photo/ }));
  const input = document.querySelector('input[type="file"]');
  fireEvent.change(input, { target: { files: [new File(['x'], 'meal.jpg', { type: 'image/jpeg' })] } });
  const row = (name) => screen.getByText(name).closest('.rounded-xl');
  await screen.findByText('Chicken nuggets');
  return row;
}

describe('the photo sheet count stepper', () => {
  it("starts a counted item at its count and steps one piece at a time", async () => {
    const row = await scanPlate();
    const nuggets = row('Chicken nuggets');
    expect(within(nuggets).getByText('×6')).toBeTruthy();
    expect(within(nuggets).getByRole('spinbutton').value).toBe('96');

    fireEvent.click(within(nuggets).getByRole('button', { name: '+' }));
    await waitFor(() => expect(within(nuggets).getByRole('spinbutton').value).toBe('112'));
    expect(within(nuggets).getByText('×7')).toBeTruthy();

    fireEvent.click(within(nuggets).getByRole('button', { name: '−' }));
    fireEvent.click(within(nuggets).getByRole('button', { name: '−' }));
    await waitFor(() => expect(within(nuggets).getByRole('spinbutton').value).toBe('80'));
    expect(within(nuggets).getByText('×5')).toBeTruthy();
    expect(svc.analyzePhoto).toHaveBeenCalledTimes(1);
  });

  it('starts an item the count did not size at ×1, one step its whole estimate', async () => {
    const row = await scanPlate();
    const grapes = row('Grapes');
    expect(within(grapes).getByText('×1')).toBeTruthy();
    expect(within(grapes).getByRole('spinbutton').value).toBe('100');
    fireEvent.click(within(grapes).getByRole('button', { name: '+' }));
    await waitFor(() => expect(within(grapes).getByRole('spinbutton').value).toBe('200'));
    // What matched no food is named, so the person knows to add it.
    expect(screen.getByText(/Couldn't identify: mango lassi/)).toBeTruthy();
  });

  it("never lowers a scan's own count that is above the stepper's cap of 30", async () => {
    const row = await scanPlate();
    const meatballs = row('Meatballs (in sauce)');
    expect(within(meatballs).getByText('×40')).toBeTruthy();
    fireEvent.click(within(meatballs).getByRole('button', { name: '+' }));
    await waitFor(() => expect(within(meatballs).getByText('×40')).toBeTruthy());
    expect(within(meatballs).getByRole('spinbutton').value).toBe('1720');
    fireEvent.click(within(meatballs).getByRole('button', { name: '−' }));
    await waitFor(() => expect(within(meatballs).getByRole('spinbutton').value).toBe('1677'));
  });
});
