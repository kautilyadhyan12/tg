// A failed photo scan says why: a photo the scanner could not read asks for
// another photo, and a scanner that is down says it is busy and lets the same
// photo go again; one that cannot take the photo at all says it is unavailable.
// The free retry the sheet holds rides the next scan, and changes only when the
// server gives a new one, answers a photo, or refuses the one held.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { forgetUnsavedScan } from '../components/nutrition/unsavedScan';

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
const svc = {};
vi.mock('../api/nutritionApi', async (importOriginal) => ({ ...(await importOriginal()), nutritionService: svc }));

const Nutrition = (await import('./Nutrition')).default;

const TOKEN = 'r'.repeat(40);
const failure = (status, data) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data } });
const goodScan = {
  data: {
    scanToken: 't'.repeat(40), mealName: 'Dal and roti',
    items: [{
      name: 'Dal', canonical: 'dal_lentil_curry', gramsPoint: 150, gramsRange: [150, 150], portionSource: 'default', nutritionSource: 'curated',
      kcalPoint: 218, kcalLow: 218, kcalHigh: 218, proteinG: 9, carbsG: 30, fatG: 6,
      measures: [{ id: 'g', name: 'g', grams: 1 }, { id: 'oz', name: 'oz', grams: 28.349523125 }], startsAt: { measure: 'g', amount: 150 }, portionEstimated: true,
    }],
    unknownItems: [], photoQuality: 'good',
    totals: { kcalPoint: 218, kcalLow: 218, kcalHigh: 218, proteinG: 9, carbsG: 30, fatG: 6 }, confirmed: false,
  },
};

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:meal');
  svc.listMealsForDay = vi.fn(async () => ({ meals: [], truncated: false }));
  svc.listDishware = vi.fn(async () => ({ data: { items: [], nextCursor: null } }));
  svc.getTargets = vi.fn(async () => ({ data: { targets: null, missing: ['goal'], targetWrongSide: false } }));
  svc.previewMeal = vi.fn(async () => { throw new Error('no preview in this test'); });
});
afterEach(() => { cleanup(); forgetUnsavedScan(); });

async function openPhotoSheet() {
  render(
    <MemoryRouter initialEntries={['/nutrition']}>
      <Nutrition />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: /Log meal from photo/ }));
}
const pickPhoto = () => {
  const photo = new File(['x'], 'meal.jpg', { type: 'image/jpeg' });
  fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [photo] } });
  return photo;
};

describe('a photo scan that fails', () => {
  it('says the scanner is busy, not the photo, and sends the same photo again on its free retry', async () => {
    svc.analyzePhoto = vi.fn()
      .mockRejectedValueOnce(failure(503, { error: 'scanner_unavailable', message: 'Meal scanning is busy right now. Please try again in a minute.', retakeToken: TOKEN }))
      .mockResolvedValueOnce(goodScan);
    await openPhotoSheet();
    pickPhoto();
    expect(await screen.findByText('Meal scanning is busy right now — try again in a minute (free retry).')).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
    expect(screen.queryByText('Try another photo')).toBeNull();
    expect(screen.queryByText(/Couldn't read that photo/)).toBeNull();

    const photo = pickPhoto();
    expect(await screen.findByText('Dal')).toBeTruthy();
    expect(svc.analyzePhoto).toHaveBeenCalledTimes(2);
    expect(svc.analyzePhoto.mock.calls[0][1]).toBeNull();
    expect(svc.analyzePhoto.mock.calls[1]).toEqual([photo, TOKEN]);
  });

  it('says only that the scanner is busy when no free retry came with it, and the next scan rides none', async () => {
    svc.analyzePhoto = vi.fn()
      .mockRejectedValueOnce(failure(503, { error: 'scanner_unavailable', message: 'Meal scanning is busy right now. Please try again in a minute.' }))
      .mockResolvedValueOnce(goodScan);
    await openPhotoSheet();
    pickPhoto();
    expect(await screen.findByText('Meal scanning is busy right now — try again in a minute.')).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
    const photo = pickPhoto();
    expect(await screen.findByText('Dal')).toBeTruthy();
    expect(svc.analyzePhoto.mock.calls[1]).toEqual([photo, null]);
  });

  // Switched off, paused, refused by the provider, a fault, or no way to count
  // scans: none of these is busy, and trying again in a minute would not help.
  for (const [error, message] of [
    ['nutrition_unavailable', 'Meal scanning is temporarily unavailable.'],
    ['quota_unavailable', 'This feature is temporarily unavailable. Please try again in a few minutes.'],
  ]) {
    it(`says scanning is unavailable, never busy, on a 503 ${error}`, async () => {
      svc.analyzePhoto = vi.fn()
        .mockRejectedValueOnce(failure(503, { error, message }))
        .mockResolvedValueOnce(goodScan);
      await openPhotoSheet();
      pickPhoto();
      expect(await screen.findByText('Meal scanning is unavailable right now.')).toBeTruthy();
      expect(screen.getByText('Try again later')).toBeTruthy();
      expect(screen.queryByText(/busy/)).toBeNull();
      expect(screen.queryByText(/free retry/)).toBeNull();
      const photo = pickPhoto();
      expect(await screen.findByText('Dal')).toBeTruthy();
      expect(svc.analyzePhoto.mock.calls[1]).toEqual([photo, null]);
    });
  }

  it('keeps the free retry it holds through a 503 that brings none, so the scan after it is still free', async () => {
    svc.analyzePhoto = vi.fn()
      .mockRejectedValueOnce(failure(422, { error: 'retake_required', message: 'Please retake the photo in better light with the full plate visible.', retakeToken: TOKEN }))
      .mockRejectedValueOnce(failure(503, { error: 'nutrition_unavailable', message: 'Meal scanning is temporarily unavailable.' }))
      .mockResolvedValueOnce(goodScan);
    await openPhotoSheet();
    pickPhoto();
    expect(await screen.findByText("Couldn't read that photo — try again with better lighting (free retry).")).toBeTruthy();
    pickPhoto();
    expect(await screen.findByText('Meal scanning is unavailable right now.')).toBeTruthy();
    const photo = pickPhoto();
    expect(await screen.findByText('Dal')).toBeTruthy();
    expect(svc.analyzePhoto.mock.calls.map((c) => c[1])).toEqual([null, TOKEN, TOKEN]);
    expect(svc.analyzePhoto.mock.calls[2]).toEqual([photo, TOKEN]);
  });

  it('takes the new free retry a failed scan brings back in place of the one it rode, whether busy or unavailable', async () => {
    const BUSY_TOKEN = 'b'.repeat(40);
    const NEXT_TOKEN = 'n'.repeat(40);
    svc.analyzePhoto = vi.fn()
      .mockRejectedValueOnce(failure(422, { error: 'retake_required', message: 'Please retake the photo in better light with the full plate visible.', retakeToken: TOKEN }))
      .mockRejectedValueOnce(failure(503, { error: 'scanner_unavailable', message: 'Meal scanning is busy right now. Please try again in a minute.', retakeToken: BUSY_TOKEN }))
      .mockRejectedValueOnce(failure(503, { error: 'nutrition_unavailable', message: 'Meal scanning is temporarily unavailable.', retakeToken: NEXT_TOKEN }))
      .mockResolvedValueOnce(goodScan);
    await openPhotoSheet();
    pickPhoto();
    expect(await screen.findByText("Couldn't read that photo — try again with better lighting (free retry).")).toBeTruthy();
    pickPhoto();
    expect(await screen.findByText('Meal scanning is busy right now — try again in a minute (free retry).')).toBeTruthy();
    pickPhoto();
    expect(await screen.findByText('Meal scanning is unavailable right now.')).toBeTruthy();
    pickPhoto();
    expect(await screen.findByText('Dal')).toBeTruthy();
    expect(svc.analyzePhoto.mock.calls.map((c) => c[1])).toEqual([null, TOKEN, BUSY_TOKEN, NEXT_TOKEN]);
  });

  it('drops the free retry a photo it could not read spent, when no new one comes with it', async () => {
    svc.analyzePhoto = vi.fn()
      .mockRejectedValueOnce(failure(422, { error: 'retake_required', message: 'Please retake the photo in better light with the full plate visible.', retakeToken: TOKEN }))
      .mockRejectedValueOnce(failure(422, { error: 'retake_required', message: 'Please retake the photo in better light with the full plate visible.' }))
      .mockResolvedValueOnce(goodScan);
    await openPhotoSheet();
    pickPhoto();
    expect(await screen.findByText("Couldn't read that photo — try again with better lighting (free retry).")).toBeTruthy();
    pickPhoto();
    expect(await screen.findByText("Couldn't read that photo — please try another one.")).toBeTruthy();
    pickPhoto();
    expect(await screen.findByText('Dal')).toBeTruthy();
    expect(svc.analyzePhoto.mock.calls.map((c) => c[1])).toEqual([null, TOKEN, null]);
  });

  it('drops a free retry the server refuses as run out, and says so', async () => {
    svc.analyzePhoto = vi.fn()
      .mockRejectedValueOnce(failure(422, { error: 'retake_required', message: 'Please retake the photo in better light with the full plate visible.', retakeToken: TOKEN }))
      .mockRejectedValueOnce(failure(400, { error: 'invalid_retake', message: 'Invalid or expired retake token.' }))
      .mockResolvedValueOnce(goodScan);
    await openPhotoSheet();
    pickPhoto();
    expect(await screen.findByText("Couldn't read that photo — try again with better lighting (free retry).")).toBeTruthy();
    pickPhoto();
    expect(await screen.findByText('That free retry has run out. Pick the photo again.')).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
    pickPhoto();
    expect(await screen.findByText('Dal')).toBeTruthy();
    expect(svc.analyzePhoto.mock.calls.map((c) => c[1])).toEqual([null, TOKEN, null]);
  });

  it('asks for another photo when the photo could not be read, with its free retake', async () => {
    svc.analyzePhoto = vi.fn()
      .mockRejectedValueOnce(failure(422, { error: 'retake_required', message: 'We could not read that photo. Please retake it with the full plate in frame.', retakeToken: TOKEN }))
      .mockResolvedValueOnce(goodScan);
    await openPhotoSheet();
    pickPhoto();
    expect(await screen.findByText("Couldn't read that photo — try again with better lighting (free retry).")).toBeTruthy();
    expect(screen.getByText('Try another photo')).toBeTruthy();
    expect(screen.queryByText(/busy/)).toBeNull();
    const photo = pickPhoto();
    expect(await screen.findByText('Dal')).toBeTruthy();
    expect(svc.analyzePhoto.mock.calls[1]).toEqual([photo, TOKEN]);
  });
});
