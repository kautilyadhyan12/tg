// Kd's click-through of 7a-iv-a (RULINGS 2026-09-16): a scan that is not saved
// already used one of the day's scans, so the photo sheet does not lose it — a
// click outside never closes the sheet, the X asks first, and Photo Log opened
// again while the scan can still be saved brings the same sheet back, with "New
// photo" to start over. And a scanned row taken from a saved dish to another
// measure keeps the dish's grams, with an Undo, as "Change" has one.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { UNSAVED_SCAN_KEPT_MS, forgetUnsavedScan } from '../components/nutrition/unsavedScan';
import { setCurrentUserId } from '../utils/storage';

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
const svc = {};
vi.mock('../api/nutritionApi', async (importOriginal) => ({ ...(await importOriginal()), nutritionService: svc }));

const Nutrition = (await import('./Nutrition')).default;

const item = (name, canonical, gramsPoint) => ({
  name, canonical, gramsPoint, gramsRange: [gramsPoint, gramsPoint], portionSource: 'default', nutritionSource: 'curated',
  kcalPoint: 145, kcalLow: 145, kcalHigh: 145, proteinG: 9, carbsG: 19, fatG: 4,
});
/** Our list's dal as the scan starts it: at the 132 g the photo saw, beside its 240 g cup. */
const CUP = { id: 'usda-1', name: 'cup', grams: 240 };
const scannedDal = () => ({
  ...item('Dal (lentil curry)', 'dal_lentil_curry', 132),
  measures: [CUP, { id: 'g', name: 'g', grams: 1 }, { id: 'oz', name: 'oz', grams: 28.349523125 }],
  startsAt: { measure: 'g', amount: 132 }, portionEstimated: true,
});
const bowl = { id: 'd-1', label: 'My blue bowl', containerClass: 'cereal_bowl', volumeMl: 360, foodHint: null, createdAt: '2026-09-16T10:00:00.000Z' };

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:meal');
  svc.listMealsForDay = vi.fn(async () => ({ meals: [], truncated: false }));
  svc.listDishware = vi.fn(async () => ({ data: { items: [bowl], nextCursor: null } }));
  svc.getTargets = vi.fn(async () => ({ data: { targets: null, missing: ['goal'], targetWrongSide: false } }));
  svc.searchFoods = vi.fn(async () => ({ data: { items: [] } }));
  // The server's preview: the blue bowl half full is 180 g, a cup 240 g, grams as sent.
  svc.previewMeal = vi.fn(async ({ items }) => {
    const priced = items.map((i) => {
      const grams = i.dishwareId ? Math.round(360 * i.fillLevel) : i.measure === 'usda-1' ? Math.round(i.amount * 240) : Math.round(i.amount);
      return { ...item('Dal (lentil curry)', i.canonical, grams), kcalPoint: Math.round(grams * 1.45) };
    });
    return { data: { items: priced, totals: { kcalPoint: priced.reduce((n, i) => n + i.kcalPoint, 0), kcalLow: 0, kcalHigh: 0, proteinG: 0, carbsG: 0, fatG: 0 } } };
  });
  svc.analyzePhoto = vi.fn(async () => scanReply());
});
const scanReply = () => ({
  data: {
    scanToken: 't'.repeat(40), mealName: 'Dal plate', items: [scannedDal()],
    unknownItems: [], photoQuality: 'good',
    totals: { kcalPoint: 191, kcalLow: 191, kcalHigh: 191, proteinG: 9, carbsG: 19, fatG: 4 }, confirmed: false,
  },
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); forgetUnsavedScan(); setCurrentUserId(null); });

const openPhotoLog = async () => fireEvent.click(await screen.findByRole('button', { name: /Log meal from photo/ }));
const renderPage = () => render(
  <MemoryRouter initialEntries={['/nutrition']}>
    <Nutrition />
  </MemoryRouter>,
);
/** Scan a plate. Returns the window the scan came back in: its time is between
 *  `before` and `after`, so a clock set from them is sure of the side it is on. */
async function scanPlate() {
  const before = Date.now();
  renderPage();
  await openPhotoLog();
  fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [new File(['x'], 'meal.jpg', { type: 'image/jpeg' })] } });
  await screen.findByText('Dal plate');
  return { before, after: Date.now() };
}
/** The X, then the question's own Close. */
const closeWithoutSaving = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Close' }));
};
const sheetOpen = () => screen.queryByText('AI Photo Log') !== null;
/** The dal row opened, as a tap on its line opens it: the sheet is a short list (RULINGS 2026-09-17). */
const openDal = () => fireEvent.click(screen.getByText('Dal (lentil curry)').closest('button'));
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
    fireEvent.click(within(question).getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByText('Dal plate')).toBeTruthy();
  });

  // What the question promises is what is left when the X is pressed, from the
  // scan's own time, whole minutes never rounded up.
  it.each([
    [30_500, 'Open Photo Log again within 8 minutes to pick up where you left off.'],
    [511_000, 'Less than a minute is left to open Photo Log again and pick up where you left off.'],
  ])('%i ms after the scan, says %j', async (elapsed, text) => {
    const { after } = await scanPlate();
    vi.spyOn(Date, 'now').mockReturnValue(after + elapsed);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(within(screen.getByRole('alertdialog')).getByText(text)).toBeTruthy();
  });

  it('says a scan that can no longer be saved will not come back, and its Close lets it go', async () => {
    const { after } = await scanPlate();
    vi.spyOn(Date, 'now').mockReturnValue(after + UNSAVED_SCAN_KEPT_MS);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(within(screen.getByRole('alertdialog')).getByText('It can no longer be saved, so it will not come back.')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Close' }));
    expect(sheetOpen()).toBe(false);
    // Back at the real time, when the scan was only moments ago: it was let go,
    // not merely too old.
    vi.restoreAllMocks();
    await openPhotoLog();
    expect(screen.queryByText('Dal plate')).toBeNull();
    expect(screen.getByText('Snap or upload')).toBeTruthy();
  });

  it('closes without asking when nothing is scanned', async () => {
    renderPage();
    await openPhotoLog();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(sheetOpen()).toBe(false);
  });

  it('brings the same sheet back while the scan can still be saved, with New photo to start over', async () => {
    await scanPlate();
    openDal();
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '150' } });
    closeWithoutSaving();
    expect(sheetOpen()).toBe(false);

    await openPhotoLog();
    expect(screen.getByText('Dal plate')).toBeTruthy();
    // Brought back closed, at the amount it held.
    expect(screen.getByText('Dal (lentil curry)').closest('button').textContent).toContain('150 g');
    openDal();
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

  // Kept for the scan's ten minutes less half a minute, so a sheet brought back
  // can still be saved: at 569 s it comes back, at 571 s (where the server would
  // still take it, but only just) it does not.
  it.each([
    [569_000, true],
    [571_000, false],
  ])('%i ms after the scan, brings it back: %s', async (elapsed, back) => {
    const { before, after } = await scanPlate();
    closeWithoutSaving();
    vi.spyOn(Date, 'now').mockReturnValue(back ? before + elapsed : after + elapsed);
    await openPhotoLog();
    expect(screen.queryByText('Dal plate') !== null).toBe(back);
    expect(screen.queryByText('Snap or upload') !== null).toBe(!back);
  });

  it('brings the sheet back after the Nutrition page was left, and never to another person', async () => {
    await scanPlate();
    openDal();
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '150' } });
    closeWithoutSaving();
    cleanup(); // the page is left

    renderPage();
    await openPhotoLog();
    expect(screen.getByText('Dal plate')).toBeTruthy();
    // Brought back closed, at the amount it held.
    expect(screen.getByText('Dal (lentil curry)').closest('button').textContent).toContain('150 g');
    openDal();
    expect(screen.getByRole('spinbutton').value).toBe('150');
    expect(svc.analyzePhoto).toHaveBeenCalledTimes(1);
    closeWithoutSaving();
    cleanup();

    // Someone else signs in on this tab.
    setCurrentUserId('another-person');
    renderPage();
    await openPhotoLog();
    expect(screen.queryByText('Dal plate')).toBeNull();
    expect(screen.getByText('Snap or upload')).toBeTruthy();
  });

  // The page left while the photo is still being read: the scan still counts, so
  // its reply is kept when it comes back — but only for the person still signed in
  // who took it, never once they signed out and someone else signed in.
  it.each([
    ['still signed in', null, true],
    ['signed out, someone else in when it came back', 'another-person', false],
  ])('a reply that came back after the page was left, its person %s (%s): kept is %s', async (_, signedInWhenBack, back) => {
    let reply;
    svc.analyzePhoto = vi.fn(() => new Promise((resolve) => { reply = resolve; }));
    renderPage();
    await openPhotoLog();
    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [new File(['x'], 'meal.jpg', { type: 'image/jpeg' })] } });
    await waitFor(() => expect(svc.analyzePhoto).toHaveBeenCalledTimes(1));
    cleanup(); // the page is left mid-read
    if (signedInWhenBack) setCurrentUserId(signedInWhenBack);
    reply(scanReply());
    await new Promise((settle) => setTimeout(settle, 0));

    // The one who took the photo, signed in (again).
    setCurrentUserId(null);
    renderPage();
    await openPhotoLog();
    expect(screen.queryByText('Dal plate') !== null).toBe(back);
  });

  it('lets a saved scan go', async () => {
    svc.confirmMeal = vi.fn(async () => ({ data: {} }));
    await scanPlate();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm & log meal' }));
    await waitFor(() => expect(sheetOpen()).toBe(false));
    await openPhotoLog();
    expect(screen.queryByText('Dal plate')).toBeNull();
    expect(screen.getByText('Snap or upload')).toBeTruthy();
  });
});

describe('a saved dish on a scanned row', () => {
  /** A measure picked the way a person picks it: open the list, tap the choice. */
  const choose = async (label) => {
    if (screen.queryByRole('button', { name: 'Measure' }) === null) openDal();
    fireEvent.click(await screen.findByRole('button', { name: 'Measure' }));
    fireEvent.click(await screen.findByRole('option', { name: label }));
  };
  const picked = () => {
    if (screen.queryByRole('button', { name: 'Measure' }) === null) openDal();
    return screen.getByRole('button', { name: 'Measure' }).textContent;
  };
  /** The dish picked, half full, and the server's answer for it. */
  const halfBowl = async () => {
    await choose('My blue bowl · 360 ml');
    fireEvent.click(screen.getByRole('button', { name: 'Half' }));
    await waitFor(() => expect(svc.previewMeal.mock.calls.some(([body]) => body.items[0]?.dishwareId === 'd-1')).toBe(true));
    await waitFor(() => expect(screen.getByText('= 180 g')).toBeTruthy());
  };

  it('is one of the measures, and a scan never picks it for the person', async () => {
    await scanPlate();
    expect(picked()).toBe('grams');
    fireEvent.click(screen.getByRole('button', { name: 'Measure' }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['cup · 240 g', 'grams', 'ounces · 28.35 g', 'My blue bowl · 360 ml', '+ Save a new dish…']);
  });

  it("keeps the grams the server worked out for the dish when another measure is picked, and Undo puts the dish back", async () => {
    await scanPlate();
    await halfBowl();

    await choose('grams');
    expect(screen.getByRole('spinbutton', { name: 'Amount' }).value).toBe('180');
    expect(screen.getByText(/Kept the dish's 180 g/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(picked()).toBe('My blue bowl · 360 ml');
    expect(screen.queryByText(/Kept the dish's/)).toBeNull();
    // Still half full, so the server's grams for the dish come back too.
    await waitFor(() => expect(screen.getByText('= 180 g')).toBeTruthy());

    // To the food's own cup: as many cups as weigh the dish's grams.
    await choose('cup · 240 g');
    expect(screen.getByRole('spinbutton', { name: 'Amount' }).value).toBe('0.75');
    expect(screen.getByText(/Kept the dish's 180 g/)).toBeTruthy();
    await waitFor(() => expect(svc.previewMeal).toHaveBeenLastCalledWith({ scanToken: 't'.repeat(40), items: [{ canonical: 'dal_lentil_curry', measure: 'usda-1', amount: 0.75 }] }));
  });

  it('goes back to what the row held where the dish was never weighed', async () => {
    await scanPlate();
    await choose('My blue bowl · 360 ml');
    await choose('grams');
    expect(screen.getByRole('spinbutton', { name: 'Amount' }).value).toBe('132');
    expect(screen.queryByText(/Kept the dish's/)).toBeNull();
    // And to another measure: the grams it held, as that measure.
    await choose('My blue bowl · 360 ml');
    await choose('cup · 240 g');
    expect(screen.getByRole('spinbutton', { name: 'Amount' }).value).toBe('0.55');
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
