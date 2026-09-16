// Kd's click-through of 7a-iv-a (RULINGS 2026-09-16): a scan that is not saved
// already used one of the day's scans, so the photo sheet does not lose it — a
// click outside never closes the sheet, the X asks first, and Photo Log opened
// again while the scan can still be saved brings the same sheet back, with "New
// photo" to start over. And "my dish" taken back to grams keeps the dish's grams,
// with an Undo, as "Change" has one.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MEAL_SCAN_TTL_SECONDS } from '@app/shared';

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
const svc = {};
vi.mock('../api/nutritionApi', async (importOriginal) => ({ ...(await importOriginal()), nutritionService: svc }));

const Nutrition = (await import('./Nutrition')).default;

const item = (name, canonical, gramsPoint) => ({
  name, canonical, gramsPoint, gramsRange: [gramsPoint, gramsPoint], portionSource: 'default', nutritionSource: 'curated',
  kcalPoint: 145, kcalLow: 145, kcalHigh: 145, proteinG: 9, carbsG: 19, fatG: 4, pieces: null,
});
const bowl = { id: 'd-1', label: 'My blue bowl', containerClass: 'cereal_bowl', volumeMl: 360, foodHint: null, createdAt: '2026-09-16T10:00:00.000Z' };

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:meal');
  svc.listMealsForDay = vi.fn(async () => ({ meals: [], truncated: false }));
  svc.listDishware = vi.fn(async () => ({ data: { items: [bowl], nextCursor: null } }));
  svc.getTargets = vi.fn(async () => ({ data: { targets: null, missing: ['goal'], targetWrongSide: false } }));
  svc.searchFoods = vi.fn(async () => ({ data: { items: [] } }));
  // The server's preview: a dish half full is 180 g; grams are as sent.
  svc.previewMeal = vi.fn(async ({ items }) => {
    const priced = items.map((i) => {
      const grams = i.dishwareId ? Math.round(360 * i.fillLevel) : i.grams;
      return { ...item('Dal (lentil curry)', i.canonical, grams), kcalPoint: Math.round(grams * 1.45) };
    });
    return { data: { items: priced, totals: { kcalPoint: priced.reduce((n, i) => n + i.kcalPoint, 0), kcalLow: 0, kcalHigh: 0, proteinG: 0, carbsG: 0, fatG: 0 } } };
  });
  svc.analyzePhoto = vi.fn(async () => ({
    data: {
      scanToken: 't'.repeat(40), mealName: 'Dal plate', items: [item('Dal (lentil curry)', 'dal_lentil_curry', 132)],
      unknownItems: [], photoQuality: 'good',
      totals: { kcalPoint: 191, kcalLow: 191, kcalHigh: 191, proteinG: 9, carbsG: 19, fatG: 4 }, confirmed: false,
    },
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const openPhotoLog = async () => fireEvent.click(await screen.findByRole('button', { name: /Log meal from photo/ }));
async function scanPlate() {
  render(
    <MemoryRouter initialEntries={['/nutrition']}>
      <Nutrition />
    </MemoryRouter>,
  );
  await openPhotoLog();
  fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [new File(['x'], 'meal.jpg', { type: 'image/jpeg' })] } });
  await screen.findByText('Dal plate');
}
const sheetOpen = () => screen.queryByText('AI Photo Log') !== null;
/** The dim backdrop around a box, found from the box's own heading — the page has
 *  a fixed decoration of its own before the boxes, which is no backdrop. */
const backdropOf = (heading) => heading.closest('.fixed.inset-0');

describe('the photo sheet keeps a scan that is not saved', () => {
  it('never closes on a click outside it', async () => {
    await scanPlate();
    const backdrop = backdropOf(screen.getByText('AI Photo Log'));
    expect(backdrop.className).toContain('z-50');
    fireEvent.click(backdrop);
    expect(sheetOpen()).toBe(true);
    expect(screen.getByText('Dal plate')).toBeTruthy();
  });

  it('asks before the X closes an unsaved scan, and keeps editing when asked to', async () => {
    await scanPlate();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    const question = screen.getByRole('alertdialog');
    expect(within(question).getByText('Close without saving?')).toBeTruthy();
    expect(within(question).getByText("This photo already used one of today's scans.")).toBeTruthy();
    expect(within(question).getByText(`Open Photo Log again within ${MEAL_SCAN_TTL_SECONDS / 60} minutes to pick up where you left off.`)).toBeTruthy();
    fireEvent.click(within(question).getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByText('Dal plate')).toBeTruthy();
  });

  it('closes without asking when nothing is scanned', async () => {
    render(
      <MemoryRouter initialEntries={['/nutrition']}>
        <Nutrition />
      </MemoryRouter>,
    );
    await openPhotoLog();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(sheetOpen()).toBe(false);
  });

  it('brings the same sheet back while the scan can still be saved, with New photo to start over', async () => {
    await scanPlate();
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '150' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Close' }));
    expect(sheetOpen()).toBe(false);

    await openPhotoLog();
    expect(screen.getByText('Dal plate')).toBeTruthy();
    expect(screen.getByRole('spinbutton').value).toBe('150');
    expect(screen.getByText("Not saved yet. This scan still counts as one of today's scans.")).toBeTruthy();
    expect(svc.analyzePhoto).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'New photo' }));
    expect(screen.queryByText('Dal plate')).toBeNull();
    expect(screen.getByText('Snap or upload')).toBeTruthy();
    // Nothing is left to lose: the X closes at once.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(sheetOpen()).toBe(false);
  });

  it('starts fresh once the scan could no longer be saved', async () => {
    await scanPlate();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Close' }));
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + MEAL_SCAN_TTL_SECONDS * 1000);
    await openPhotoLog();
    expect(screen.queryByText('Dal plate')).toBeNull();
    expect(screen.getByText('Snap or upload')).toBeTruthy();
  });
});

describe('"my dish" back to grams', () => {
  it("keeps the grams the server worked out for the dish, and Undo puts back what the row held", async () => {
    await scanPlate();
    fireEvent.click(screen.getByTitle('Measure with my dish instead of grams'));
    fireEvent.click(await screen.findByRole('button', { name: 'My blue bowl · 360 ml' }));
    fireEvent.click(screen.getByRole('button', { name: '½' }));
    // The server's answer for the dish half full.
    await waitFor(() => expect(svc.previewMeal.mock.calls.some(([body]) => body.items[0]?.dishwareId === 'd-1')).toBe(true));
    await waitFor(() => expect(screen.getAllByText('261 kcal').length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: '← back to grams' }));
    expect(screen.getByRole('spinbutton').value).toBe('180');
    expect(screen.getByText(/Kept the dish's 180 g/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('spinbutton').value).toBe('132');
    expect(screen.queryByText(/Kept the dish's/)).toBeNull();
  });

  it('goes back to the grams it held where no dish and fill were picked', async () => {
    await scanPlate();
    fireEvent.click(screen.getByTitle('Measure with my dish instead of grams'));
    fireEvent.click(screen.getByRole('button', { name: '← back to grams' }));
    expect(screen.getByRole('spinbutton').value).toBe('132');
    expect(screen.queryByText(/Kept the dish's/)).toBeNull();
  });
});

describe('Add food', () => {
  it('never closes on a click outside it', async () => {
    render(
      <MemoryRouter initialEntries={['/nutrition']}>
        <Nutrition />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Add to Breakfast' }));
    const backdrop = backdropOf(screen.getByText('Add to Breakfast', { selector: 'h3' }));
    expect(backdrop.className).toContain('z-50');
    fireEvent.click(backdrop);
    expect(screen.getByText('Add to Breakfast', { selector: 'h3' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('Add to Breakfast', { selector: 'h3' })).toBeNull();
  });
});
