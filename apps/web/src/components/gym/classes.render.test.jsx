// A GYM'S CLASSES FOR ITS MEMBER, drawn (spec Part 3 §13.6; ROADMAP 17d). Only the network
// is mocked: what a member sees is read off the real component.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

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
const mine = (status, over = {}) => ({ status, waitlistPlace: null, packCharged: false, ...over });
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
const week = (classes, over = {}) => ({ week: 0, from: '2026-10-07', to: '2026-10-13', timezone: 'Europe/London', classes, more: false, ...over });
const refused = (status, error, message, extra = {}) => Object.assign(new Error(error), { response: { status, data: { error, message, ...extra } } });
const rowOf = (name) => screen.getByText(name).closest('li');

// THE SERVER, as far as this screen can tell: the week it would answer now. A Book or a
// Cancel answers one class and may change what the week says about the others.
let server = [];
const serve = (classes) => {
  server = classes;
  svc.list.mockImplementation(() => Promise.resolve(week(server)));
};
/** The next call answers `answer`, and from then on the week reads `after` (the answer alone by default). */
const answers = (fn, answer, after) =>
  fn.mockImplementationOnce(() => {
    server = after ?? server.map((c) => (c.sessionId === answer.sessionId ? answer : c));
    return Promise.resolve(answer);
  });

beforeEach(() => {
  let n = 0;
  vi.stubGlobal('crypto', { randomUUID: () => `key-${++n}` });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe('a member’s classes', () => {
  it('lists the coming classes by day, on the gym’s clock, each saying what the member has', async () => {
    serve([
      klass('s1', 'Spin'),
      klass('s2', 'Yoga', { booked: 10, waitlisted: 3, mine: mine('waitlisted', { waitlistPlace: 2 }), can: can({ cancel: 'free' }) }),
      klass('s3', 'Boxing', { localDate: '2026-10-08', mine: mine('booked', { packCharged: true }), can: can({ cancel: 'free' }) }),
      klass('s4', 'Pilates', { localDate: '2026-10-08', can: can({ why: 'not_covered' }) }),
    ]);
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
    expect(screen.queryByText(/more classes than this page shows/)).toBeNull();
  });

  it('Book sends one keyed request, the row becomes what the server answered, and the week is read again', async () => {
    const booked = klass('s1', 'Spin', { booked: 5, mine: mine('booked'), can: can({ cancel: 'free' }) });
    serve([klass('s1', 'Spin'), klass('s2', 'Yoga')]);
    // On one booking a week, the booking takes Book off the other class.
    answers(svc.book, booked, [booked, klass('s2', 'Yoga', { can: can({ why: 'limit_week' }) })]);
    render(<Classes gym={GYM} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Book: Spin/ }));
    await waitFor(() => expect(rowOf('Spin').textContent).toContain("You're booked"));
    expect(svc.book).toHaveBeenCalledTimes(1);
    expect(svc.book).toHaveBeenCalledWith('g1', 's1', 'key-1', false);
    expect(rowOf('Spin').textContent).toContain('5 of 10 places left');
    expect(within(rowOf('Spin')).getByRole('button', { name: /^Cancel booking/ })).toBeTruthy();
    await waitFor(() => expect(rowOf('Yoga').textContent).toContain("You've used all the bookings your membership includes for that week."));
    expect(within(rowOf('Yoga')).queryByRole('button', { name: /^Book/ })).toBeNull();
    expect(svc.list).toHaveBeenCalledTimes(2);
  });

  it('a cancel gives the week’s booking back to the other classes, without leaving the tab', async () => {
    const monday = klass('s1', 'Spin', { mine: mine('booked'), can: can({ cancel: 'free' }) });
    serve([monday, klass('s2', 'Yoga', { can: can({ why: 'limit_week' }) })]);
    render(<Classes gym={GYM} />);
    expect((await screen.findByText('Yoga')).closest('li').textContent).toContain("You've used all the bookings");
    const cancelled = klass('s1', 'Spin', { booked: 3, mine: mine('cancelled') });
    answers(svc.cancel, cancelled, [cancelled, klass('s2', 'Yoga')]);
    fireEvent.click(screen.getByRole('button', { name: /^Cancel booking: Spin/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel booking' }));
    expect(await screen.findByText('Cancelled.')).toBeTruthy();
    await waitFor(() => expect(within(rowOf('Yoga')).getByRole('button', { name: /^Book: Yoga/ })).toBeTruthy());
    expect(rowOf('Yoga').textContent).not.toContain("You've used all the bookings");
    // What the tap did is still said after the week was read again.
    expect(screen.getByText('Cancelled.')).toBeTruthy();
  });

  it('a Book that found the class full and waited says waitlist, not booked', async () => {
    serve([klass('s1', 'Spin', { booked: 10, can: can({ joinWaitlist: true }) })]);
    answers(svc.book, klass('s1', 'Spin', { booked: 10, waitlisted: 1, mine: mine('waitlisted', { waitlistPlace: 1 }), can: can({ cancel: 'free' }) }));
    render(<Classes gym={GYM} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Join waitlist: Spin/ }));
    // A Book that waited is not a booking, and the row never says it is.
    expect(await screen.findByText('On the waitlist, not booked · 1st in line')).toBeTruthy();
    expect(svc.book).toHaveBeenCalledWith('g1', 's1', 'key-1', true);
    expect(rowOf('Spin').textContent).not.toContain("You're booked");
  });

  it('a tap that got no answer is sent again under the same key; an answered one gets a new key', async () => {
    serve([klass('s1', 'Spin')]);
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
    answers(svc.book, klass('s1', 'Spin', { mine: mine('booked'), can: can({ cancel: 'free' }) }));
    fireEvent.click(screen.getByRole('button', { name: /^Book: Spin/ }));
    await waitFor(() => expect(svc.book).toHaveBeenCalledTimes(3));
    expect(svc.book.mock.calls[2][2]).toBe('key-2');
  });

  it('a Book that reached the server with its answer lost leaves no key behind for a later Book', async () => {
    const booked = klass('s1', 'Spin', { mine: mine('booked'), can: can({ cancel: 'free' }) });
    serve([klass('s1', 'Spin')]);
    // The booking is made; the answer never arrives.
    svc.book.mockImplementationOnce(() => {
      server = [booked];
      return Promise.reject(new Error('Network Error'));
    });
    render(<Classes gym={GYM} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Book: Spin/ }));
    expect(await screen.findByText("That didn't go through. Try again.")).toBeTruthy();
    // They look again (Later, then Earlier) and see it booked; then cancel it.
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    await waitFor(() => expect(svc.list).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Earlier' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Cancel booking: Spin/ }));
    answers(svc.cancel, klass('s1', 'Spin', { mine: mine('cancelled') }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel booking' }));
    expect(await screen.findByText('Cancelled.')).toBeTruthy();
    // Book again: a new request, not the old key the server already holds a cancelled booking under.
    answers(svc.book, booked);
    fireEvent.click(await screen.findByRole('button', { name: /^Book: Spin/ }));
    await waitFor(() => expect(svc.book).toHaveBeenCalledTimes(2));
    expect(svc.book.mock.calls.map((c) => c[2])).toEqual(['key-1', 'key-2']);
  });

  it('Cancel asks first, and Keep it changes nothing', async () => {
    serve([klass('s1', 'Spin', { mine: mine('booked', { packCharged: true }), can: can({ cancel: 'free' }) })]);
    render(<Classes gym={GYM} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Cancel booking: Spin/ }));
    const box = screen.getByRole('dialog', { name: 'Cancel your booking?' });
    expect(box.textContent).toContain('Spin, Wed 7 Oct at 6:00 pm');
    expect(box.textContent).toContain('Free to cancel until Wed 7 Oct, 4:00 pm. Your pack gets the class back.');
    fireEvent.click(within(box).getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(svc.cancel).not.toHaveBeenCalled();
    expect(svc.list).toHaveBeenCalledTimes(1);

    answers(svc.cancel, klass('s1', 'Spin', { booked: 3, mine: mine('cancelled') }));
    fireEvent.click(screen.getByRole('button', { name: /^Cancel booking: Spin/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel booking' }));
    expect(await screen.findByText('Cancelled.')).toBeTruthy();
    expect(svc.cancel).toHaveBeenCalledWith('g1', 's1', false);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByRole('button', { name: /^Book: Spin/ })).toBeTruthy();
  });

  it('a late cancel says the pack keeps the class before it is sent, and one that turned late asks again', async () => {
    const late = klass('s1', 'Spin', { mine: mine('booked', { packCharged: true }), can: can({ cancel: 'late' }) });
    const free = klass('s2', 'Yoga', { mine: mine('booked'), can: can({ cancel: 'free' }) });
    serve([late, free]);
    render(<Classes gym={GYM} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Cancel booking: Spin/ }));
    const box = screen.getByRole('dialog', { name: 'Cancel late?' });
    expect(box.textContent).toContain('the class stays used on your pack');
    expect(svc.cancel).not.toHaveBeenCalled();
    answers(svc.cancel, { ...late, mine: mine('late_cancelled', { packCharged: true }), can: can({ book: true }) });
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
    answers(svc.cancel, { ...free, mine: mine('late_cancelled'), can: can({ book: true }) });
    fireEvent.click(within(again).getByRole('button', { name: 'Cancel booking' }));
    await waitFor(() => expect(svc.cancel).toHaveBeenLastCalledWith('g1', 's2', true));
  });

  it('Claim place is offered to somebody waiting when a place is free', async () => {
    serve([klass('s1', 'Spin', { booked: 9, waitlisted: 2, mine: mine('waitlisted', { waitlistPlace: 1 }), can: can({ claim: true, cancel: 'free' }) })]);
    answers(svc.book, klass('s1', 'Spin', { booked: 10, waitlisted: 1, mine: mine('booked'), can: can({ cancel: 'free' }) }));
    render(<Classes gym={GYM} />);
    expect(await screen.findByText('A place is free. The first person on the waitlist to claim it has it.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Claim place: Spin/ }));
    expect(await screen.findByText("You're booked")).toBeTruthy();
    expect(svc.book).toHaveBeenCalledWith('g1', 's1', 'key-1', false);
  });

  it('a free place that is the first in line’s is not shown as a place left to anybody else', async () => {
    serve([klass('s1', 'Spin', { places: 2, booked: 1, waitlisted: 2, can: can({ joinWaitlist: true }) })]);
    render(<Classes gym={GYM} />);
    expect((await screen.findByText('Spin')).closest('li').textContent).toContain('Full · 2 on the waitlist · a free place is going to the first in line');
    expect(rowOf('Spin').textContent).not.toContain('place left');
    expect(within(rowOf('Spin')).getByRole('button', { name: /^Join waitlist/ })).toBeTruthy();
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

  it('a week the server cut short says the later classes are not listed', async () => {
    svc.list.mockResolvedValue(week([klass('s1', 'Spin')], { more: true }));
    render(<Classes gym={GYM} />);
    expect(await screen.findByText('These 7 days have more classes than this page shows. The later ones are not listed.')).toBeTruthy();
  });

  it('says whose clock the times are on when this device is in another zone', async () => {
    serve([klass('s1', 'Spin', { timezone: 'Pacific/Kiritimati' })]);
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

// ONLINE CLASSES FOR A MEMBER (17g). The worst this screen could do: draw a way into the
// class for somebody the server sent no link to.
describe('an online class, for a member', () => {
  const LINK = 'https://us02web.zoom.us/j/81234567890?pwd=abc';
  const online = (state, link = null) => ({ state, opensAt: '2026-10-07T16:30:00.000Z', link });

  it('says what each person must do to get the link, and offers Join class only with the server’s link', async () => {
    serve([
      klass('s1', 'Online Yoga', { online: online('not_booked') }),
      klass('s2', 'Online Spin', { mine: mine('waitlisted', { waitlistPlace: 1 }), can: can({ cancel: 'free' }), online: online('waiting') }),
      klass('s3', 'Online Pilates', { mine: mine('booked'), can: can({ cancel: 'free' }), online: online('early') }),
      klass('s4', 'Online Boxing', { mine: mine('booked'), can: can(), online: online('open', LINK) }),
      klass('s5', 'Online Core', { mine: mine('booked'), can: can({ cancel: 'free' }), online: online('no_link') }),
      klass('s6', 'Floor Spin'),
    ]);
    render(<Classes gym={GYM} />);
    await screen.findByText('Online Yoga');
    const line = (name) => within(rowOf(name)).queryByTestId('class-online')?.textContent ?? null;
    expect(line('Online Yoga')).toBe('Online class. Book it to get the link.');
    expect(line('Online Spin')).toBe('Online class. You get the link once you have a place.');
    expect(line('Online Pilates')).toBe('Online class. The link shows here 30 minutes before it starts.');
    expect(line('Online Boxing')).toBe('Online class. Your link is ready.');
    expect(line('Online Core')).toBe("Online class. Your gym hasn't added the link yet. Ask the front desk.");
    expect(line('Floor Spin')).toBeNull();

    // One way in on the whole page, and it is the booked class's own link.
    const joins = screen.getAllByRole('link');
    expect(joins).toHaveLength(1);
    expect(within(rowOf('Online Boxing')).getByRole('link', { name: /^Join class: Online Boxing/ }).getAttribute('href')).toBe(LINK);
    expect(joins[0].getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('draws no way in from a link that is not https, or that came with any state but open', async () => {
    serve([
      klass('s1', 'Bad Scheme', { mine: mine('booked'), can: can(), online: online('open', 'javascript:alert(1)') }),
      klass('s2', 'Wrong State', { mine: mine('booked'), can: can(), online: online('early', LINK) }),
      klass('s3', 'Cancelled Online', { cancelled: true, online: online('closed') }),
    ]);
    render(<Classes gym={GYM} />);
    await screen.findByText('Bad Scheme');
    expect(screen.queryByRole('link')).toBeNull();
    expect(within(rowOf('Cancelled Online')).queryByTestId('class-online')).toBeNull();
  });

  it('a device whose clock runs fast keeps reading until the server sends the link, and reads once more when the class ends', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      // The link is due at 16:30:00 by the server. This device says 16:29:58 when the
      // server's clock says 16:29:53: five seconds fast.
      vi.setSystemTime(new Date('2026-10-07T16:29:58.000Z'));
      const early = klass('s1', 'Online Pilates', { mine: mine('booked'), can: can({ cancel: 'free' }), online: online('early') });
      serve([early]);
      render(<Classes gym={GYM} />);
      await vi.waitFor(() => expect(screen.getByText('Online Pilates')).toBeTruthy());
      expect(svc.list).toHaveBeenCalledTimes(1);

      // Its own 16:30:01: the server still says early. It must not give up.
      // `act`: the screen is drawn from each read before the clock moves on, as on a real device.
      await act(() => vi.advanceTimersByTimeAsync(3_500));
      expect(svc.list).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole('link')).toBeNull();
      // Twenty seconds on the server has passed its moment: the link is sent, and drawn.
      serve([{ ...early, online: online('open', LINK) }]);
      await act(() => vi.advanceTimersByTimeAsync(20_500));
      expect(screen.getByRole('link', { name: /^Join class/ }).getAttribute('href')).toBe(LINK);
      const reads = svc.list.mock.calls.length;

      // The class ends at 17:45: the list is read again and the way in goes.
      serve([]);
      await act(() => vi.advanceTimersByTimeAsync(74 * 60_000));
      expect(svc.list.mock.calls.length).toBe(reads);
      await act(() => vi.advanceTimersByTimeAsync(60_000));
      expect(svc.list.mock.calls.length).toBe(reads + 1);
      expect(screen.queryByRole('link')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a class whose link the gym has not added yet is read again until it is there', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-07T16:40:00.000Z'));
      const waiting = klass('s1', 'Online Core', { mine: mine('booked'), can: can({ cancel: 'free' }), online: online('no_link') });
      serve([waiting]);
      render(<Classes gym={GYM} />);
      await vi.waitFor(() => expect(screen.getByText('Online Core')).toBeTruthy());
      serve([{ ...waiting, online: online('open', LINK) }]);
      await act(() => vi.advanceTimersByTimeAsync(21_000));
      expect(screen.getByRole('link', { name: /^Join class/ }).getAttribute('href')).toBe(LINK);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads the list again by itself the moment a booked class’s link is due', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-07T16:29:30.000Z'));
      const early = klass('s1', 'Online Pilates', { mine: mine('booked'), can: can({ cancel: 'free' }), online: online('early') });
      serve([early]);
      render(<Classes gym={GYM} />);
      await vi.waitFor(() => expect(screen.getByText('Online Pilates')).toBeTruthy());
      expect(svc.list).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('link')).toBeNull();

      serve([{ ...early, online: online('open', LINK) }]);
      await vi.advanceTimersByTimeAsync(29_000);
      expect(svc.list).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(3_000);
      await vi.waitFor(() => expect(screen.getByRole('link', { name: /^Join class/ }).getAttribute('href')).toBe(LINK));
      expect(svc.list).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
