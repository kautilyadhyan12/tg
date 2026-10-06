// A GYM'S EVENTS FOR ITS MEMBER, drawn (spec Part 3 §15.4; ROADMAP 19c-i). Only the network
// is mocked: what a member sees is read off the real component.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const svc = { list: vi.fn(), come: vi.fn(), notComing: vi.fn() };
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
/** What a member not down for an open event reads; `can` is merged, the rest replaced. */
const going = ({ can = {}, ...over } = {}) => ({
  coming: 0,
  waiting: 0,
  mine: null,
  can: { come: true, joinWaitlist: false, claim: false, cancel: false, why: null, ...can },
  ...over,
});
const NO = { come: false, joinWaitlist: false, claim: false, cancel: false, why: null };
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
  going: going(),
  ...over,
});
const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const listOf = (events, over = {}) => ({ gymId: 'g1', gymName: 'Iron House', timezone: deviceZone, today: '2026-10-07', status: 'shown', events, ...over });
const refused = (status, message) => Object.assign(new Error(message), { response: { status, data: { error: 'x', message } } });
const rowOf = (name) => within(screen.getByText(name).closest('li'));

// In braces: a function a `beforeEach` returns is called again as its tidy-up.
beforeEach(() => {
  svc.list.mockReset();
  svc.come.mockReset();
  svc.notComing.mockReset();
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
    expect(first.getByText('40 of 40 places left')).toBeTruthy();
    expect(first.getByText('Bring a friend.')).toBeTruthy();
    const second = rowOf('Winter Social');
    expect(second.getByText('Sat 5 Dec, 7:00 pm – Sun 6 Dec, 1:00 am')).toBeTruthy();
    expect(second.queryByRole('img')).toBeNull();
    // No limit, no place: neither line is drawn, and nothing reads "0 places".
    expect(second.queryByText(/place/)).toBeNull();
    // Each open event offers "I'm coming", named for its event.
    expect(first.getByRole('button', { name: "I'm coming: Saturday Open Day" })).toBeTruthy();
    expect(second.getByRole('button', { name: "I'm coming: Winter Social" })).toBeTruthy();
  });

  it("\"I'm coming\" sends that event under one key and shows what the server answers", async () => {
    const open = event('a', 'Saturday Open Day', { places: 30, going: going({ coming: 18 }) });
    svc.list.mockResolvedValue(listOf([open, event('b', 'Winter Social')]));
    svc.come.mockResolvedValue({ ...open, going: going({ coming: 19, mine: { status: 'coming', waitlistPlace: null }, can: { ...NO, cancel: true } }) });
    render(<Events gym={GYM} />);
    const row = () => rowOf('Saturday Open Day');
    expect(await screen.findByText('12 of 30 places left')).toBeTruthy();
    fireEvent.click(row().getByRole('button', { name: "I'm coming: Saturday Open Day" }));
    await waitFor(() => expect(row().getByText("You're coming")).toBeTruthy());
    expect(svc.come).toHaveBeenCalledTimes(1);
    const [gymId, eventId, key, joinWaitlist] = svc.come.mock.calls[0];
    expect([gymId, eventId, joinWaitlist]).toEqual(['g1', 'a', false]);
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(row().getByText('11 of 30 places left')).toBeTruthy();
    // The other event is as it was.
    expect(rowOf('Winter Social').queryByText("You're coming")).toBeNull();

    // Not full: "Can't come" needs no box.
    svc.notComing.mockResolvedValue(open);
    fireEvent.click(row().getByRole('button', { name: "Can't come: Saturday Open Day" }));
    await waitFor(() => expect(row().queryByText("You're coming")).toBeNull());
    expect(svc.notComing).toHaveBeenCalledWith('g1', 'a');
    expect(row().getByRole('button', { name: "I'm coming: Saturday Open Day" })).toBeTruthy();
  });

  it('a full event offers the waitlist, says the place in line, and asks before a place is given up', async () => {
    const full = event('a', 'Saturday Open Day', { places: 30, going: going({ coming: 30, waiting: 2, can: { ...NO, joinWaitlist: true } }) });
    const mineFull = event('b', 'Winter Social', { places: 10, going: going({ coming: 10, waiting: 1, mine: { status: 'coming', waitlistPlace: null }, can: { ...NO, cancel: true } }) });
    svc.list.mockResolvedValue(listOf([full, mineFull]));
    svc.come.mockResolvedValue({ ...full, going: going({ coming: 30, waiting: 3, mine: { status: 'waitlisted', waitlistPlace: 3 }, can: { ...NO, cancel: true } }) });
    render(<Events gym={GYM} />);
    const row = () => rowOf('Saturday Open Day');
    expect(await screen.findByText('Full · 2 on the waitlist')).toBeTruthy();
    expect(row().queryByRole('button', { name: /I'm coming/ })).toBeNull();
    fireEvent.click(row().getByRole('button', { name: 'Join the waitlist: Saturday Open Day' }));
    await waitFor(() => expect(row().getByText("You're 3rd on the waitlist")).toBeTruthy());
    expect(svc.come.mock.calls[0][3]).toBe(true);
    expect(row().getByText("If a place comes free it can go to you. The app doesn't tell you yet, so check back here.")).toBeTruthy();
    expect(row().getByRole('button', { name: 'Leave the waitlist: Saturday Open Day' })).toBeTruthy();

    // A place at a full event: the tap asks first, and Keep sends nothing.
    const social = () => rowOf('Winter Social');
    fireEvent.click(social().getByRole('button', { name: "Can't come: Winter Social" }));
    const box = within(social().getByRole('group', { name: 'Give up your place at Winter Social?' }));
    expect(box.getByText('This event is full, so somebody else can take your place straight away.')).toBeTruthy();
    fireEvent.click(box.getByRole('button', { name: 'Keep my place' }));
    expect(svc.notComing).not.toHaveBeenCalled();
    expect(social().getByText("You're coming")).toBeTruthy();
    fireEvent.click(social().getByRole('button', { name: "Can't come: Winter Social" }));
    svc.notComing.mockResolvedValue({ ...mineFull, going: going({ coming: 10, can: { ...NO, joinWaitlist: true } }) });
    fireEvent.click(within(social().getByRole('group', { name: 'Give up your place at Winter Social?' })).getByRole('button', { name: 'Give up my place' }));
    await waitFor(() => expect(social().queryByText("You're coming")).toBeNull());
    expect(svc.notComing).toHaveBeenCalledWith('g1', 'b');
  });

  it("a refused tap says the server's words and reads the list again; a tap with no answer keeps its key", async () => {
    const open = event('a', 'Saturday Open Day', { places: 30, going: going({ coming: 29 }) });
    svc.list.mockResolvedValue(listOf([open]));
    render(<Events gym={GYM} />);
    const row = () => rowOf('Saturday Open Day');
    const tap = () => fireEvent.click(row().getByRole('button', { name: "I'm coming: Saturday Open Day" }));
    await screen.findByText('1 of 30 places left');
    // No answer at all: the same key goes again.
    svc.come.mockRejectedValueOnce(new Error('Network Error'));
    tap();
    expect(await row().findByText("That didn't go through. Try again.")).toBeTruthy();
    expect(svc.list).toHaveBeenCalledTimes(1);
    // The last place went to somebody else meanwhile.
    svc.come.mockRejectedValueOnce(refused(409, 'This event is full.'));
    svc.list.mockResolvedValue(listOf([{ ...open, going: going({ coming: 30, can: { ...NO, joinWaitlist: true } }) }]));
    tap();
    expect(await row().findByText('This event is full.')).toBeTruthy();
    await waitFor(() => expect(row().getByRole('button', { name: 'Join the waitlist: Saturday Open Day' })).toBeTruthy());
    expect(svc.come.mock.calls[0][2]).toBe(svc.come.mock.calls[1][2]);
    expect(svc.list).toHaveBeenCalledTimes(2);
    // An answer ended that tap: the next one is a new key.
    svc.come.mockRejectedValueOnce(refused(409, 'This event and its waitlist are full.'));
    fireEvent.click(row().getByRole('button', { name: 'Join the waitlist: Saturday Open Day' }));
    await row().findByText('This event and its waitlist are full.');
    expect(svc.come.mock.calls[2][2]).not.toBe(svc.come.mock.calls[1][2]);
  });

  it('a started, a full-up and a cancelled event offer nothing false', async () => {
    svc.list.mockResolvedValue(
      listOf([
        event('a', 'On Today', { startsAt: '2020-01-01T00:00:00.000Z', places: 12, going: going({ coming: 3, can: { ...NO, why: 'event_started' } }) }),
        event('b', 'Packed Out', { places: 5, going: going({ coming: 5, waiting: 20, can: { ...NO, why: 'waitlist_full' } }) }),
        event('c', 'Called Off', { cancelled: true, places: 30, going: going({ coming: 4, mine: { status: 'coming', waitlistPlace: null }, can: { ...NO, cancel: true } }) }),
        event('d', 'My Turn', { places: 5, going: going({ coming: 4, waiting: 1, mine: { status: 'waitlisted', waitlistPlace: 1 }, can: { ...NO, claim: true, cancel: true } }) }),
      ]),
    );
    render(<Events gym={GYM} />);
    expect(await screen.findByText('On Today')).toBeTruthy();
    expect(rowOf('On Today').getByText("This event has started, so it's too late to say you're coming.")).toBeTruthy();
    expect(rowOf('On Today').queryByRole('button')).toBeNull();
    expect(rowOf('Packed Out').getByText('This event and its waitlist are full.')).toBeTruthy();
    expect(rowOf('Packed Out').queryByRole('button')).toBeNull();
    // Cancelled: no places line, and the member can still take themselves off.
    expect(rowOf('Called Off').queryByText(/places left/)).toBeNull();
    expect(rowOf('Called Off').getByRole('button', { name: "Can't come: Called Off" })).toBeTruthy();
    // A freed place that is theirs to take.
    expect(rowOf('My Turn').getByText('A place is free for you. Take it before somebody else does.')).toBeTruthy();
    expect(rowOf('My Turn').getByRole('button', { name: 'Take the place: My Turn' })).toBeTruthy();
    expect(rowOf('My Turn').queryByText(/check back here/)).toBeNull();
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
    expect(cancelled.queryByText(/places/)).toBeNull();
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
