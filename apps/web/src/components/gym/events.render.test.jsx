// A GYM'S EVENTS FOR ITS MEMBER, drawn (spec Part 3 §15.4; ROADMAP 19c-i). Only the network
// is mocked: what a member sees is read off the real component.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const svc = { list: vi.fn() };
vi.mock('../../api/eventsApi', () => ({
  eventsService: svc,
  eventPosterUrl: ({ gymId, eventId, posterId }) => `http://api.test/v1/orgs/${gymId}/events/${eventId}/poster/${posterId}`,
}));
vi.mock('../../api/orgsApi', () => ({
  errorText: (err, fallback) => err?.response?.data?.message ?? fallback,
  errorStatus: (err) => err?.response?.status ?? null,
}));

const Events = (await import('./Events')).default;

const GYM = { id: 'g1', name: 'Iron House' };
const event = (id, name, over = {}) => ({
  id,
  name,
  details: '',
  place: '',
  startsOn: '2026-10-17',
  startMinute: 600,
  endsOn: '2026-10-17',
  endMinute: 780,
  startsAt: '2099-10-17T09:00:00.000Z',
  endsAt: '2099-10-17T12:00:00.000Z',
  places: null,
  cancelled: false,
  poster: null,
  ...over,
});
const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const listOf = (events, over = {}) => ({ gymId: 'g1', gymName: 'Iron House', timezone: deviceZone, today: '2026-10-07', status: 'shown', events, ...over });
const refused = (status, message) => Object.assign(new Error(message), { response: { status, data: { error: 'x', message } } });
const rowOf = (name) => within(screen.getByText(name).closest('li'));

// In braces: a function a `beforeEach` returns is called again as its tidy-up.
beforeEach(() => {
  svc.list.mockReset();
});
afterEach(() => cleanup());

describe("a member's Events", () => {
  it('lists each coming event with its poster, when, where, places and details', async () => {
    svc.list.mockResolvedValue(
      listOf([
        event('a', 'Saturday Open Day', { place: 'Main hall', places: 40, details: 'Bring a friend.', poster: { id: 'p1', width: 800, height: 1000 } }),
        event('b', 'Winter Social', { startsOn: '2026-12-05', endsOn: '2026-12-06', startMinute: 1140, endMinute: 60 }),
      ]),
    );
    render(<Events gym={GYM} />);
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    expect(svc.list).toHaveBeenCalledWith('g1');
    const first = rowOf('Saturday Open Day');
    expect(first.getByAltText('Poster for Saturday Open Day').getAttribute('src')).toBe('http://api.test/v1/orgs/g1/events/a/poster/p1');
    expect(first.getByText('Sat 17 Oct · 10:00 am – 1:00 pm')).toBeTruthy();
    expect(first.getByText('Main hall')).toBeTruthy();
    expect(first.getByText('40 places')).toBeTruthy();
    expect(first.getByText('Bring a friend.')).toBeTruthy();
    const second = rowOf('Winter Social');
    expect(second.getByText('Sat 5 Dec, 7:00 pm – Sun 6 Dec, 1:00 am')).toBeTruthy();
    expect(second.queryByRole('img')).toBeNull();
    // No limit, no place: neither line is drawn, and nothing reads "0 places".
    expect(second.queryByText(/place/)).toBeNull();
    // No "I'm coming" yet (19c-ii): the list offers no button at all.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('marks a cancelled event and an event that is on now', async () => {
    svc.list.mockResolvedValue(
      listOf([
        event('a', 'On Today', { startsAt: '2020-01-01T00:00:00.000Z', places: 12 }),
        event('b', 'Winter Social', { cancelled: true, places: 30 }),
        event('c', 'Cancelled While On', { cancelled: true, startsAt: '2020-01-01T00:00:00.000Z' }),
      ]),
    );
    render(<Events gym={GYM} />);
    expect(await screen.findByText('On Today')).toBeTruthy();
    expect(rowOf('On Today').getByText('On now')).toBeTruthy();
    expect(rowOf('On Today').queryByText('Cancelled')).toBeNull();
    const cancelled = rowOf('Winter Social');
    expect(cancelled.getByText('Cancelled')).toBeTruthy();
    expect(cancelled.getByText('This event has been cancelled.')).toBeTruthy();
    expect(cancelled.queryByText('On now')).toBeNull();
    // A cancelled event offers no places.
    expect(cancelled.queryByText('30 places')).toBeNull();
    expect(rowOf('Cancelled While On').queryByText('On now')).toBeNull();
  });

  it('says so when nothing is coming, and when the gym’s page is paused', async () => {
    svc.list.mockResolvedValue(listOf([]));
    const { unmount } = render(<Events gym={GYM} />);
    expect(await screen.findByText('Iron House has no events coming up.')).toBeTruthy();
    unmount();
    svc.list.mockResolvedValue(listOf([], { status: 'paused' }));
    render(<Events gym={GYM} />);
    expect(await screen.findByText("Iron House's events aren't available right now.")).toBeTruthy();
    expect(screen.queryByText('Iron House has no events coming up.')).toBeNull();
  });

  it('says the year of an event in another year, and reads the list again when the tab is shown again', async () => {
    svc.list.mockResolvedValue(listOf([event('a', 'New Year Run', { startsOn: '2027-01-01', endsOn: '2027-01-01' }), event('b', 'On Today', { startsAt: '2020-01-01T00:00:00.000Z' })]));
    render(<Events gym={GYM} />);
    expect(await screen.findByText('Fri 1 Jan 2027 · 10:00 am – 1:00 pm')).toBeTruthy();
    expect(rowOf('On Today').getByText('On now')).toBeTruthy();
    // It ended while the tab was hidden.
    svc.list.mockResolvedValue(listOf([event('a', 'New Year Run', { startsOn: '2027-01-01', endsOn: '2027-01-01' })]));
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(screen.queryByText('On Today')).toBeNull());
    expect(svc.list).toHaveBeenCalledTimes(2);
  });

  it('names whose clock the times are on when this device’s differs', async () => {
    const other = deviceZone === 'Pacific/Kiritimati' ? 'Pacific/Niue' : 'Pacific/Kiritimati';
    svc.list.mockResolvedValue(listOf([event('a', 'Saturday Open Day')], { timezone: other }));
    render(<Events gym={GYM} />);
    expect(await screen.findByText(`Times are Iron House time (${other.replaceAll('_', ' ')}), not this device's.`)).toBeTruthy();
    // The times themselves stay the gym's.
    expect(screen.getByText('Sat 17 Oct · 10:00 am – 1:00 pm')).toBeTruthy();
  });

  it('a failed read says so and Try again reads it again', async () => {
    svc.list.mockRejectedValueOnce(refused(500, 'The server had a problem.'));
    render(<Events gym={GYM} />);
    expect(await screen.findByText('The server had a problem.')).toBeTruthy();
    svc.list.mockResolvedValue(listOf([event('a', 'Saturday Open Day')]));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Saturday Open Day')).toBeTruthy();
    expect(svc.list).toHaveBeenCalledTimes(2);
  });

  it('somebody the gym no longer has is told in plain words, not the server’s', async () => {
    svc.list.mockRejectedValue(refused(404, 'Organisation not found.'));
    render(<Events gym={GYM} />);
    expect(await screen.findByText("Iron House's events aren't available right now.")).toBeTruthy();
    expect(screen.queryByText('Organisation not found.')).toBeNull();
  });
});
