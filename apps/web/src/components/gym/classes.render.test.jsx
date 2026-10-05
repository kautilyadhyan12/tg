// A GYM'S CLASSES FOR ITS MEMBER, drawn (spec Part 3 §13.6; ROADMAP 17d). Only the network
// is mocked: what a member sees is read off the real component.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const svc = { list: vi.fn(), book: vi.fn(), cancel: vi.fn() };
vi.mock('../../api/classesApi', () => ({ classesService: svc }));
vi.mock('../../api/orgsApi', () => ({
  errorText: (err, fallback) => err?.response?.data?.message ?? fallback,
  errorCode: (err) => err?.response?.data?.error ?? null,
  errorStatus: (err) => err?.response?.status ?? null,
}));

const Classes = (await import('./Classes')).default;

const GYM = { id: 'g1', name: 'Iron House' };
const can = (over = {}) => ({ book: false, joinWaitlist: false, claim: false, cancel: null, why: null, ...over });
const klass = (sessionId, className, over = {}) => ({
  sessionId,
  className,
  localDate: '2026-10-07',
  localStartMinute: 18 * 60,
  timezone: 'Europe/London',
  startsAt: '2026-10-07T17:00:00.000Z',
  minutes: 45,
  cancelled: false,
  places: 10,
  booked: 4,
  waitlisted: 0,
  opensAt: '2026-09-30T17:00:00.000Z',
  freeCancelUntil: '2026-10-07T15:00:00.000Z',
  mine: null,
  can: can({ book: true }),
  ...over,
});
const week = (classes, over = {}) => ({ week: 0, from: '2026-10-07', to: '2026-10-13', timezone: 'Europe/London', classes, ...over });
const refused = (status, error, message, extra = {}) => Object.assign(new Error(error), { response: { status, data: { error, message, ...extra } } });
const rowOf = (name) => screen.getByText(name).closest('li');

beforeEach(() => {
  let n = 0;
  vi.stubGlobal('crypto', { randomUUID: () => `key-${++n}` });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('a member’s classes', () => {
  it('lists the coming classes by day, on the gym’s clock, each saying what the member has', async () => {
    svc.list.mockResolvedValue(
      week([
        klass('s1', 'Spin'),
        klass('s2', 'Yoga', { booked: 10, waitlisted: 3, mine: { status: 'waitlisted', waitlistPlace: 2, packCharged: false }, can: can({ cancel: 'free' }) }),
        klass('s3', 'Boxing', { localDate: '2026-10-08', mine: { status: 'booked', waitlistPlace: null, packCharged: true }, can: can({ cancel: 'free' }) }),
        klass('s4', 'Pilates', { localDate: '2026-10-08', can: can({ why: 'not_covered' }) }),
      ]),
    );
    render(<Classes gym={GYM} />);
    expect(await screen.findByText('Spin')).toBeTruthy();
    expect(svc.list).toHaveBeenCalledWith('g1', 0);
    expect(screen.getByText('Next 7 days · Wed 7 Oct – Tue 13 Oct')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Today · Wed 7 Oct' })).getAllByRole('listitem')).toHaveLength(2);
    expect(within(screen.getByRole('list', { name: 'Tomorrow · Thu 8 Oct' })).getAllByRole('listitem')).toHaveLength(2);

    expect(rowOf('Spin').textContent).toContain('6:00 pm · 45 min · 6 of 10 places left');
    expect(within(rowOf('Spin')).getByRole('button', { name: /^Book: Spin/ })).toBeTruthy();
    // Waiting is said as waiting, and is never offered as, or worded as, a booking.
    const yoga = rowOf('Yoga');
    expect(yoga.textContent).toContain('On the waitlist, not booked · 2nd in line');
    expect(yoga.textContent).not.toContain("You're booked");
    expect(within(yoga).getByRole('button', { name: /^Leave waitlist/ })).toBeTruthy();
    expect(within(yoga).queryByRole('button', { name: /^Book/ })).toBeNull();
    expect(rowOf('Boxing').textContent).toContain("You're booked · 1 class used from your pack");
    const pilates = rowOf('Pilates');
    expect(pilates.textContent).toContain("Your membership doesn't include this class. Ask at the front desk.");
    expect(within(pilates).queryAllByRole('button')).toHaveLength(0);
  });

  it('Book sends one keyed request and the row becomes what the server answered', async () => {
    svc.list.mockResolvedValue(week([klass('s1', 'Spin'), klass('s2', 'Yoga')]));
    svc.book.mockResolvedValue(klass('s1', 'Spin', { booked: 5, mine: { status: 'booked', waitlistPlace: null, packCharged: false }, can: can({ cancel: 'free' }) }));
    render(<Classes gym={GYM} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Book: Spin/ }));
    await waitFor(() => expect(rowOf('Spin').textContent).toContain("You're booked"));
    expect(svc.book).toHaveBeenCalledTimes(1);
    expect(svc.book).toHaveBeenCalledWith('g1', 's1', 'key-1', false);
    expect(rowOf('Spin').textContent).toContain('5 of 10 places left');
    expect(within(rowOf('Spin')).getByRole('button', { name: /^Cancel booking/ })).toBeTruthy();
    // Nobody else's row moved.
    expect(within(rowOf('Yoga')).getByRole('button', { name: /^Book: Yoga/ })).toBeTruthy();
  });

  it('a Book that found the class full and waited says waitlist, not booked', async () => {
    svc.list.mockResolvedValue(week([klass('s1', 'Spin', { booked: 10, can: can({ joinWaitlist: true }) })]));
    svc.book.mockResolvedValue(
      klass('s1', 'Spin', { booked: 10, waitlisted: 1, mine: { status: 'waitlisted', waitlistPlace: 1, packCharged: false }, can: can({ cancel: 'free' }) }),
    );
    render(<Classes gym={GYM} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Join waitlist: Spin/ }));
    // A Book that waited is not a booking, and the row never says it is.
    expect(await screen.findByText('On the waitlist, not booked · 1st in line')).toBeTruthy();
    expect(svc.book).toHaveBeenCalledWith('g1', 's1', 'key-1', true);
    expect(rowOf('Spin').textContent).not.toContain("You're booked");
  });

  it('a tap that got no answer is sent again under the same key; an answered one gets a new key', async () => {
    svc.list.mockResolvedValue(week([klass('s1', 'Spin')]));
    svc.book.mockRejectedValueOnce(new Error('Network Error'));
    render(<Classes gym={GYM} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Book: Spin/ }));
    expect(await screen.findByText("That didn't go through. Try again.")).toBeTruthy();
    // No answer: the list is not read again, and the row still offers Book.
    expect(svc.list).toHaveBeenCalledTimes(1);
    svc.book.mockRejectedValueOnce(refused(409, 'class_full', 'This class is full.'));
    fireEvent.click(screen.getByRole('button', { name: /^Book: Spin/ }));
    await waitFor(() => expect(svc.book).toHaveBeenCalledTimes(2));
    expect(svc.book.mock.calls.map((c) => c[2])).toEqual(['key-1', 'key-1']);
    // The server said no: its words are shown and the week is read again.
    expect(await screen.findByText('This class is full.')).toBeTruthy();
    await waitFor(() => expect(svc.list).toHaveBeenCalledTimes(2));
    svc.book.mockResolvedValue(klass('s1', 'Spin', { mine: { status: 'booked', waitlistPlace: null, packCharged: false }, can: can({ cancel: 'free' }) }));
    fireEvent.click(screen.getByRole('button', { name: /^Book: Spin/ }));
    await waitFor(() => expect(svc.book).toHaveBeenCalledTimes(3));
    expect(svc.book.mock.calls[2][2]).toBe('key-2');
  });

  it('Cancel asks first, and Keep it changes nothing', async () => {
    const booked = klass('s1', 'Spin', { mine: { status: 'booked', waitlistPlace: null, packCharged: true }, can: can({ cancel: 'free' }) });
    svc.list.mockResolvedValue(week([booked]));
    svc.cancel.mockResolvedValue(klass('s1', 'Spin', { booked: 3, mine: { status: 'cancelled', waitlistPlace: null, packCharged: false } }));
    render(<Classes gym={GYM} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Cancel booking: Spin/ }));
    const box = screen.getByRole('dialog', { name: 'Cancel your booking?' });
    expect(box.textContent).toContain('Spin, Wed 7 Oct at 6:00 pm');
    expect(box.textContent).toContain('Free to cancel until Wed 7 Oct, 4:00 pm. Your pack gets the class back.');
    fireEvent.click(within(box).getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(svc.cancel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^Cancel booking: Spin/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel booking' }));
    expect(await screen.findByText('Cancelled.')).toBeTruthy();
    expect(svc.cancel).toHaveBeenCalledWith('g1', 's1', false);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: /^Book: Spin/ })).toBeTruthy();
  });

  it('a late cancel says the pack keeps the class before it is sent, and one that turned late asks again', async () => {
    const late = klass('s1', 'Spin', { mine: { status: 'booked', waitlistPlace: null, packCharged: true }, can: can({ cancel: 'late' }) });
    const free = klass('s2', 'Yoga', { mine: { status: 'booked', waitlistPlace: null, packCharged: false }, can: can({ cancel: 'free' }) });
    svc.list.mockResolvedValue(week([late, free]));
    render(<Classes gym={GYM} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Cancel booking: Spin/ }));
    const box = screen.getByRole('dialog', { name: 'Cancel late?' });
    expect(box.textContent).toContain('the class stays used on your pack');
    expect(svc.cancel).not.toHaveBeenCalled();
    svc.cancel.mockResolvedValueOnce({ ...late, mine: { status: 'late_cancelled', waitlistPlace: null, packCharged: true }, can: can({ book: true }) });
    fireEvent.click(within(box).getByRole('button', { name: 'Cancel booking' }));
    expect(await screen.findByText('Cancelled late.')).toBeTruthy();
    expect(svc.cancel).toHaveBeenLastCalledWith('g1', 's1', true);

    // The free time ran out while the box was open: nothing is cancelled until they say yes again.
    svc.cancel.mockRejectedValueOnce(refused(409, 'late_cancel', 'too late', { packCharged: false }));
    fireEvent.click(screen.getByRole('button', { name: /^Cancel booking: Yoga/ }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Cancel your booking?' })).getByRole('button', { name: 'Cancel booking' }));
    const again = await screen.findByRole('dialog', { name: 'Cancel late?' });
    expect(svc.cancel).toHaveBeenLastCalledWith('g1', 's2', false);
    expect(rowOf('Yoga').textContent).toContain("You're booked");
    svc.cancel.mockResolvedValueOnce({ ...free, mine: { status: 'late_cancelled', waitlistPlace: null, packCharged: false }, can: can({ book: true }) });
    fireEvent.click(within(again).getByRole('button', { name: 'Cancel booking' }));
    await waitFor(() => expect(svc.cancel).toHaveBeenLastCalledWith('g1', 's2', true));
  });

  it('Claim place is offered to somebody waiting when a place is free', async () => {
    svc.list.mockResolvedValue(
      week([klass('s1', 'Spin', { booked: 9, waitlisted: 2, mine: { status: 'waitlisted', waitlistPlace: 1, packCharged: false }, can: can({ claim: true, cancel: 'free' }) })]),
    );
    svc.book.mockResolvedValue(klass('s1', 'Spin', { booked: 10, waitlisted: 1, mine: { status: 'booked', waitlistPlace: null, packCharged: false }, can: can({ cancel: 'free' }) }));
    render(<Classes gym={GYM} />);
    expect(await screen.findByText('A place is free. The first person on the waitlist to claim it has it.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Claim place: Spin/ }));
    expect(await screen.findByText("You're booked")).toBeTruthy();
    expect(svc.book).toHaveBeenCalledWith('g1', 's1', 'key-1', false);
  });

  it('Later and Earlier read another week; a week with no classes says so', async () => {
    svc.list.mockImplementation((_gym, w) =>
      Promise.resolve(w === 0 ? week([klass('s1', 'Spin')]) : week([], { week: 1, from: '2026-10-14', to: '2026-10-20' })),
    );
    render(<Classes gym={GYM} />);
    await screen.findByText('Spin');
    expect(screen.getByRole('button', { name: 'Earlier' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(await screen.findByText('Iron House has no classes in these 7 days.')).toBeTruthy();
    expect(svc.list).toHaveBeenLastCalledWith('g1', 1);
    expect(screen.getByText('Wed 14 Oct – Tue 20 Oct')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Earlier' }));
    expect(await screen.findByText('Spin')).toBeTruthy();
  });

  it('says whose clock the times are on when this device is in another zone', async () => {
    svc.list.mockResolvedValue(week([klass('s1', 'Spin', { timezone: 'Pacific/Kiritimati' })]));
    render(<Classes gym={GYM} />);
    expect(await screen.findByText("Times are Iron House time (Pacific/Kiritimati), not this device's.")).toBeTruthy();
    // The row still prints the gym's clock.
    expect(rowOf('Spin').textContent).toContain('6:00 pm');
  });

  it('a list that cannot be read says so, with Try again; a gym whose classes are closed to them says that', async () => {
    svc.list.mockRejectedValueOnce(new Error('Network Error'));
    render(<Classes gym={GYM} />);
    expect(await screen.findByText("Couldn't load the classes.")).toBeTruthy();
    svc.list.mockResolvedValueOnce(week([klass('s1', 'Spin')]));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Spin')).toBeTruthy();
    cleanup();
    svc.list.mockRejectedValueOnce(refused(404, 'org_not_found', 'Organisation not found.'));
    render(<Classes gym={GYM} />);
    expect(await screen.findByText("Iron House's classes aren't available right now.")).toBeTruthy();
    expect(screen.queryByText('Organisation not found.')).toBeNull();
  });
});
