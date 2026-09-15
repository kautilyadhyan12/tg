// A failed photo scan says why: a photo the scanner could not read asks for
// another photo, and a scanner that is down says it is busy and lets the same
// photo go again. Either way the free retry's token rides the next scan.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

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
      kcalPoint: 218, kcalLow: 218, kcalHigh: 218, proteinG: 9, carbsG: 30, fatG: 6, pieces: null,
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
afterEach(() => cleanup());

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

  it('says only that the scanner is busy when no free retry came with it', async () => {
    svc.analyzePhoto = vi.fn().mockRejectedValueOnce(failure(503, { error: 'scanner_unavailable', message: 'Meal scanning is busy right now. Please try again in a minute.' }));
    await openPhotoSheet();
    pickPhoto();
    expect(await screen.findByText('Meal scanning is busy right now — try again in a minute.')).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
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
