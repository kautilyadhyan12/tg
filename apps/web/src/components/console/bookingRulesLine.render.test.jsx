// THE GYM'S BOOKING RULES ON THE PAGES THEY APPLY TO (ROADMAP 17e-ii, from Kd's
// click-through). Only the network is mocked.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = { getBookingSettings: vi.fn() };
vi.mock('../../api/orgsApi', () => ({ orgService: api }));

const BookingRulesLine = (await import('./BookingRulesLine')).default;
const { canOpenPlace, placeTo } = await import('../../pages/console/consolePlaces');

const ORG = { id: 'g1', name: 'Iron House' };
const MANAGER = ['members.read', 'schedule.manage'];
const TRAINER = ['members.read', 'attendance.read'];
const settings = (over = {}) => ({ data: { settings: { opensDays: 7, freeCancelMinutes: 120, handoverMinutes: 1440, waitlistMax: 20, ...over } } });
const draw = (props) =>
  render(
    <MemoryRouter>
      <BookingRulesLine org={ORG} orgSlug="iron-house" {...props} />
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('the booking rules line', () => {
  it('says the gym’s own rules, with a button that opens the box in Settings', async () => {
    api.getBookingSettings.mockResolvedValue(settings());
    draw({ privileges: MANAGER });
    expect(await screen.findByText('Members can book up to 7 days ahead and cancel for free until 2 hours before it starts.')).toBeTruthy();
    expect(api.getBookingSettings).toHaveBeenCalledWith('g1');
    const button = screen.getByRole('link', { name: 'Change booking rules' });
    expect(button.getAttribute('href')).toBe('/console/iron-house/settings#booking-rules');
    expect(placeTo('iron-house', 'bookingRules')).toBe('/console/iron-house/settings#booking-rules');
  });

  it.each([
    [{ opensDays: 1, freeCancelMinutes: 0 }, 'Members can book up to 1 day ahead and cancel for free until it starts.'],
    [{ opensDays: 14, freeCancelMinutes: 1440 }, 'Members can book up to 14 days ahead and cancel for free until 1 day before it starts.'],
    [{ opensDays: 3, freeCancelMinutes: 30 }, 'Members can book up to 3 days ahead and cancel for free until 30 minutes before it starts.'],
  ])('reads the numbers the gym set: %o', async (over, words) => {
    api.getBookingSettings.mockResolvedValue(settings(over));
    draw({ privileges: MANAGER });
    expect(await screen.findByText(words)).toBeTruthy();
  });

  it('a read that fails leaves the button, never a made-up rule', async () => {
    api.getBookingSettings.mockRejectedValue(new Error('network'));
    draw({ privileges: MANAGER });
    await waitFor(() => expect(api.getBookingSettings).toHaveBeenCalled());
    expect(screen.getByRole('link', { name: 'Change booking rules' })).toBeTruthy();
    expect(screen.queryByText(/Members can/)).toBeNull();
  });

  it('staff who may not change the rules read the one they are sent and who can, with no button and no read', () => {
    draw({ privileges: TRAINER, freeCancelMinutes: 120 });
    expect(screen.getByText('Members can cancel for free until 2 hours before it starts. A manager can change the booking rules.')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    expect(api.getBookingSettings).not.toHaveBeenCalled();
    expect(canOpenPlace(TRAINER, 'bookingRules')).toBe(false);
  });

  it('with no rule to say and no right to change them, nothing is drawn', () => {
    const { container } = draw({ privileges: TRAINER });
    expect(container.textContent).toBe('');
  });
});
