// THE BOX THAT ASKS BEFORE BOOKINGS END, AND SETTINGS' CLASS BOOKINGS, AT THE SCREEN
// (ROADMAP 17c-ii-a). Only the network is mocked.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';

const api = {
  getEndingBookings: vi.fn(),
  getBookingSettings: vi.fn(),
  updateBookingSettings: vi.fn(),
};
vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: api };
});

const BookingsEndBox = (await import('./BookingsEndBox')).default;
const BookingSettingsPanel = (await import('./BookingSettingsPanel')).default;

const person = (n, over = {}) => ({
  seq: n,
  name: `Person ${String(n)}`,
  initials: 'P',
  waiting: false,
  className: 'Yoga',
  localDate: '2026-10-12',
  localStartMinute: 1080,
  ...over,
});
const page = (from, to, next) => ({
  data: { classes: 2, booked: 150, waiting: 4, people: Array.from({ length: to - from + 1 }, (_, i) => person(from + i)), next },
});

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => cleanup());

describe('the box that asks before bookings end', () => {
  const ENDING = { classes: 2, booked: 150, waiting: 4, people: [person(1), person(2), person(3, { waiting: true })] };
  const draw = (over = {}) => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <BookingsEndBox
        gymId="g1"
        ending={ENDING}
        scope={{ by: 'slot', id: 's1', from: '2026-10-12' }}
        kind="move"
        clockFormat="24h"
        onConfirm={onConfirm}
        onCancel={onCancel}
        {...over}
      />,
    );
    return { onConfirm, onCancel };
  };

  it('names who changes, what happens to them, who does not change, and that nobody is told', () => {
    draw();
    expect(screen.getByText('150 people are booked and 4 are on the waitlist, across 2 classes')).toBeTruthy();
    expect(screen.getByText('Their bookings end. A booking that used a class from a pack puts the class back on the pack.')).toBeTruthy();
    const names = within(screen.getByTestId('ending-people'));
    expect(names.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Person 1Yoga · Mon 12 Oct · 18:00',
      'Person 2Yoga · Mon 12 Oct · 18:00',
      'Person 3Yoga · Mon 12 Oct · 18:00 · On the waitlist',
    ]);
    expect(screen.getByText(/^and 151 more/)).toBeTruthy();
    expect(screen.getByText("Bookings for classes before Mon 12 Oct don't change.")).toBeTruthy();
    expect(screen.getByText("The app doesn't tell them yet. Let them know yourself.")).toBeTruthy();
    expect(api.getEndingBookings).not.toHaveBeenCalled();
  });

  it('nothing happens until its own button is pressed, and Keep it only closes', () => {
    const { onConfirm, onCancel } = draw({ kind: 'cancel', scope: { by: 'session', id: 'x1' } });
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel class and end 154 bookings' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('See all reads the whole list a hundred at a time, for the same classes, until there is no more', async () => {
    api.getEndingBookings.mockResolvedValueOnce(page(1, 100, 100)).mockResolvedValueOnce(page(101, 154, null));
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'See all' }));
    await waitFor(() => expect(within(screen.getByTestId('ending-people')).getAllByRole('listitem')).toHaveLength(100));
    expect(api.getEndingBookings).toHaveBeenCalledWith('g1', { by: 'slot', id: 's1', from: '2026-10-12', after: undefined });
    expect(screen.getByText(/^and 54 more/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(within(screen.getByTestId('ending-people')).getAllByRole('listitem')).toHaveLength(154));
    expect(api.getEndingBookings).toHaveBeenLastCalledWith('g1', { by: 'slot', id: 's1', from: '2026-10-12', after: 100 });
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
    expect(screen.queryByText(/more/)).toBeNull();
  });

  it('says so when the list cannot be read, and keeps the first names', async () => {
    api.getEndingBookings.mockRejectedValue({ response: { status: 500, data: {} } });
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'See all' }));
    expect(await screen.findByText("We couldn't load the list.")).toBeTruthy();
    expect(within(screen.getByTestId('ending-people')).getAllByRole('listitem')).toHaveLength(3);
  });
});

describe('Settings → Class bookings', () => {
  const ORG = { id: 'g1', orgType: 'gym' };
  const START = { opensDays: 7, freeCancelMinutes: 120, handoverMinutes: 1440, waitlistMax: 20 };
  const open = async (props = {}) => {
    render(<BookingSettingsPanel org={ORG} readOnly={false} {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: /Class bookings/ }));
    await screen.findByLabelText('Days before a class that booking opens');
  };

  beforeEach(() => {
    api.getBookingSettings.mockResolvedValue({ data: { settings: START } });
  });

  it('shows the gym’s four settings, summed up while closed, and Save waits for a change', async () => {
    render(<BookingSettingsPanel org={ORG} readOnly={false} />);
    expect(await screen.findByText('Opens 7 days before · free to cancel until 2 hours before · waitlist of 20')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Class bookings/ }));
    expect(screen.getByLabelText('Days before a class that booking opens').value).toBe('7');
    expect(screen.getByLabelText('How long before a class cancelling is free').value).toBe('2');
    expect(screen.getByLabelText('Free cancelling, in').value).toBe('hours');
    expect(screen.getByLabelText('How long before a class a free place goes to the waitlist automatically').value).toBe('1');
    expect(screen.getByLabelText('The waitlist time, in').value).toBe('days');
    expect(screen.getByLabelText('How many people a waitlist holds').value).toBe('20');
    expect(screen.getByRole('button', { name: 'Save changes' }).disabled).toBe(true);
  });

  it('nothing is saved until Save, which sends all four in minutes and shows what the server kept', async () => {
    const next = { opensDays: 14, freeCancelMinutes: 90, handoverMinutes: 180, waitlistMax: 5 };
    api.updateBookingSettings.mockResolvedValue({ data: { settings: next } });
    await open();
    fireEvent.change(screen.getByLabelText('Days before a class that booking opens'), { target: { value: '14' } });
    fireEvent.change(screen.getByLabelText('How long before a class cancelling is free'), { target: { value: '90' } });
    fireEvent.change(screen.getByLabelText('Free cancelling, in'), { target: { value: 'minutes' } });
    fireEvent.change(screen.getByLabelText('How long before a class a free place goes to the waitlist automatically'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('The waitlist time, in'), { target: { value: 'hours' } });
    fireEvent.change(screen.getByLabelText('How many people a waitlist holds'), { target: { value: '5' } });
    expect(api.updateBookingSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.updateBookingSettings).toHaveBeenCalledWith('g1', next));
    expect(await screen.findByText('Saved.')).toBeTruthy();
    expect(screen.getByText('Opens 14 days before · free to cancel until 90 minutes before · waitlist of 5')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save changes' }).disabled).toBe(true);
  });

  it('a number outside its range is said in words and cannot be saved', async () => {
    await open();
    fireEvent.change(screen.getByLabelText('Days before a class that booking opens'), { target: { value: '90' } });
    expect(screen.getByText('When booking opens: pick 1 to 56 days.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save changes' }).disabled).toBe(true);
    fireEvent.submit(screen.getByRole('button', { name: 'Save changes' }).closest('form'));
    expect(api.updateBookingSettings).not.toHaveBeenCalled();
  });

  it('a refused save says so and keeps what was typed', async () => {
    api.updateBookingSettings.mockRejectedValue({ response: { status: 500, data: {} } });
    await open();
    fireEvent.change(screen.getByLabelText('How many people a waitlist holds'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText("We couldn't save your booking settings.")).toBeTruthy();
    expect(screen.getByLabelText('How many people a waitlist holds').value).toBe('8');
    expect(screen.queryByText('Saved.')).toBeNull();
  });

  it('a gym on no plan reads its settings and cannot change them', async () => {
    await open({ readOnly: true });
    expect(screen.getByLabelText('Days before a class that booking opens').disabled).toBe(true);
    expect(screen.getByLabelText('Free cancelling, in').disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Save changes' }).disabled).toBe(true);
  });

  it('settings that cannot be read are said so, never drawn as empty boxes', async () => {
    api.getBookingSettings.mockRejectedValue({ response: { status: 500, data: {} } });
    render(<BookingSettingsPanel org={ORG} readOnly={false} />);
    expect(await screen.findByText("We couldn't load your booking settings.")).toBeTruthy();
    expect(screen.queryByLabelText('Days before a class that booking opens')).toBeNull();
  });
});
