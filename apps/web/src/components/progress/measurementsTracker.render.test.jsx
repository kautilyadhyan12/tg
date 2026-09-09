// RENDER test for the measurements history: a weight the person TYPED on a
// form (onboarding screen 2, the profile) is a row of its own and the ruling
// (RULINGS 2026-09-10) says it is marked as such where the history is shown.
// Asserts on the DOM, for the reason `workoutCalendar.render.test.jsx` records.
// Only the network is mocked.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { progressService } from '../../api/progressApi';
import MeasurementsTracker from './MeasurementsTracker';

vi.mock('../../api/progressApi', () => ({
  progressService: { getMeasurements: vi.fn(), logMeasurement: vi.fn(), deleteMeasurement: vi.fn() },
}));

const item = (over) => ({
  id: '11111111-1111-4111-8111-111111111111',
  measuredAt: '2026-09-10T09:00:00.000Z',
  weightKg: null,
  metrics: {},
  source: 'manual',
  createdAt: '2026-09-10T09:00:00.000Z',
  ...over,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('MeasurementsTracker history', () => {
  it('marks a typed weight "typed by me", says when one was a clear, and leaves a weigh-in unmarked', async () => {
    progressService.getMeasurements.mockResolvedValue({
      data: {
        items: [
          item({ id: 'a1a1a1a1-1111-4111-8111-111111111111', source: 'self_reported', weightKg: null }),
          item({ id: 'b2b2b2b2-1111-4111-8111-111111111111', source: 'self_reported', weightKg: 71 }),
          item({ id: 'c3c3c3c3-1111-4111-8111-111111111111', metrics: { waist_cm: 80 } }),
        ],
        nextCursor: null,
      },
    });
    render(<MeasurementsTracker />);
    await waitFor(() => expect(screen.getByText('Recent entries')).toBeTruthy());

    // Two typed rows, one of them the record of a clear; the weigh-in carries no mark.
    expect(screen.getAllByText('typed by me')).toHaveLength(2);
    expect(screen.getByText('Weight cleared')).toBeTruthy();
    expect(screen.getByText('Weight: 71kg')).toBeTruthy();
    expect(screen.getByText('Waist: 80cm')).toBeTruthy();
  });
});
