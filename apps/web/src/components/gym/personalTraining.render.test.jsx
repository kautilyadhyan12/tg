// A GYM'S PERSONAL TRAINING FOR ITS MEMBER, drawn (spec Part 3 §13.5; ROADMAP 17e-ii). Only
// the network is mocked: what a member sees is read off the real component.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { memberPtResponseSchema } from '@app/shared';

const svc = { view: vi.fn(), book: vi.fn(), cancel: vi.fn() };
vi.mock('../../api/memberPtApi', () => ({ memberPtService: svc }));
vi.mock('../../api/orgsApi', () => ({
  errorText: (err, fallback) => err?.response?.data?.message ?? fallback,
  errorCode: (err) => err?.response?.data?.error ?? null,
  errorStatus: (err) => err?.response?.status ?? null,
}));

const PersonalTraining = (await import('./PersonalTraining')).default;

const GYM = { id: 'g1', name: 'Iron House' };
const SAM = '11111111-1111-4111-8111-111111111111';
const ANN = '22222222-2222-4222-8222-222222222222';
const DAYS = ['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'];
const PACK = { membership: 'PT 10', sessionsLeft: 9 };

const trainer = (trainerId, name, free = {}, sessionMinutes = 60) => ({
  trainerId,
  name,
  sessionMinutes,
  days: DAYS.map((localDate) => ({ localDate, free: free[localDate] ?? [] })),
});
const session = (id, over = {}) => ({
  id,
  trainerName: 'Sam Trainer',
  localDate: '2026-10-09',
  localStartMinute: 600,
  minutes: 60,
  startsAt: '2026-10-09T09:00:00.000Z',
  freeCancelUntil: '2026-10-09T07:00:00.000Z',
  status: 'booked',
  packCharged: true,
  cancel: 'free',
  ...over,
});
const S1 = '33333333-3333-4333-8333-333333333333';
const view = (over = {}) => {
  const v = {
    timezone: 'Europe/London',
    today: '2026-10-07',
    from: '2026-10-07',
    to: '2026-10-13',
    lastDay: '2026-10-14',
    freeCancelMinutes: 120,
    onList: true,
    days: DAYS.map((localDate) => ({ localDate, pays: PACK, why: null })),
    trainers: [trainer(SAM, 'Sam Trainer', { '2026-10-09': [540, 600] }), trainer(ANN, 'Ann Coach', { '2026-10-08': [840] }, 45)],
    sessions: [],
    ...over,
  };
  // The fixture is what the server may send, or the test proves nothing.
  return memberPtResponseSchema.parse(v);
};
const refused = (status, error, message, extra = {}) => Object.assign(new Error(error), { response: { status, data: { error, message, ...extra } } });

/** Press a day in the row of days. */
const pickDay = (name) => fireEvent.click(within(screen.getByRole('group', { name: 'Pick a day' })).getByRole('button', { name }));
const FRI = 'Fri 9 Oct';

let server;
const serve = (v) => {
  server = v;
  svc.view.mockImplementation(() => Promise.resolve(server));
};

beforeEach(() => {
  let n = 0;
  vi.stubGlobal('crypto', { randomUUID: () => `key-${++n}` });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe('a member’s personal training', () => {
  it('opens on the first day with a time, lists that day’s times as buttons that read the whole session, and says what a booking uses', async () => {
    serve(view());
    render(<PersonalTraining gym={GYM} />);
    const ann = await screen.findByRole('group', { name: 'Ann Coach' });
    expect(svc.view).toHaveBeenCalledWith('g1', 0);
    expect(screen.getByText('Next 7 days · Wed 7 Oct – Tue 13 Oct')).toBeTruthy();
    expect(screen.getByText('A booking uses 1 session from your pack: PT 10 · 9 sessions left.')).toBeTruthy();
    expect(screen.getByText('Available times. Press one to book it.')).toBeTruthy();
    // Seven days to pick from; today has no time, so tomorrow is the one open.
    const days = within(screen.getByRole('group', { name: 'Pick a day' })).getAllByRole('button');
    expect(days.map((b) => `${b.textContent}${b.getAttribute('aria-pressed') === 'true' ? ' (open)' : ''}`)).toEqual([
      'Today · Wed 7 Oct',
      'Tomorrow · Thu 8 Oct (open)',
      'Fri 9 Oct',
      'Sat 10 Oct',
      'Sun 11 Oct',
      'Mon 12 Oct',
      'Tue 13 Oct',
    ]);
    expect(ann.textContent).toContain('45 min sessions');
    expect(within(ann).getByRole('button', { name: 'Book 2:00 pm – 2:45 pm with Ann Coach, Tomorrow · Thu 8 Oct' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Sam Trainer' }).textContent).toContain('No available times on this day.');

    pickDay(FRI);
    const sam = screen.getByRole('group', { name: 'Sam Trainer' });
    expect(within(sam).getAllByRole('button').map((b) => b.textContent)).toEqual(['+9:00 am – 10:00 am', '+10:00 am – 11:00 am']);
    expect(within(sam).getByRole('list', { name: 'Sam Trainer, Fri 9 Oct' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Ann Coach' }).textContent).toContain('No available times on this day.');
    // Nobody else is on the page: no session list with none of their own.
    expect(screen.queryByRole('list', { name: 'Your sessions' })).toBeNull();
  });

  it('one press books that time with its own key, says so, and reads the times again', async () => {
    serve(view());
    render(<PersonalTraining gym={GYM} />);
    await screen.findByRole('group', { name: 'Sam Trainer' });
    pickDay(FRI);
    const sam = screen.getByRole('group', { name: 'Sam Trainer' });
    svc.book.mockImplementationOnce(() => {
      server = view({ trainers: [trainer(SAM, 'Sam Trainer', { '2026-10-09': [540] })], sessions: [session(S1)], days: DAYS.map((localDate) => ({ localDate, pays: { ...PACK, sessionsLeft: 8 }, why: null })) });
      return Promise.resolve(session(S1));
    });
    fireEvent.click(within(sam).getByRole('button', { name: /^Book 10:00 am – 11:00 am with Sam Trainer/ }));
    expect(svc.book).toHaveBeenCalledWith('g1', 'key-1', { trainerId: SAM, localDate: '2026-10-09', startMinute: 600, minutes: 60 });
    expect((await screen.findByRole('status')).textContent).toBe('Booked: Fri 9 Oct · 10:00 am – 11:00 am · with Sam Trainer.');
    const mine = await screen.findByRole('list', { name: 'Your sessions' });
    expect(mine.textContent).toContain('Fri 9 Oct · 10:00 am – 11:00 am · with Sam Trainer');
    expect(mine.textContent).toContain('1 session used from your pack');
    expect(screen.getByText('A booking uses 1 session from your pack: PT 10 · 8 sessions left.')).toBeTruthy();
    // The day she picked is still the one open, with one time fewer.
    expect(within(screen.getByRole('group', { name: 'Sam Trainer' })).getAllByRole('button')).toHaveLength(1);
    expect(svc.view).toHaveBeenCalledTimes(2);
  });

  it('a time somebody else took first says so in the server’s words and reads the times again; no answer keeps the key for the retry', async () => {
    serve(view());
    render(<PersonalTraining gym={GYM} />);
    await screen.findByRole('group', { name: 'Sam Trainer' });
    pickDay(FRI);
    const press = async () => fireEvent.click(within(await screen.findByRole('group', { name: 'Sam Trainer' })).getByRole('button', { name: /^Book 10:00 am/ }));
    // The network drops: nothing is known, so the same key goes again.
    svc.book.mockRejectedValueOnce(new Error('network'));
    await press();
    expect((await screen.findByRole('status')).textContent).toBe("That didn't go through. Try again.");
    expect(svc.view).toHaveBeenCalledTimes(1);
    svc.book.mockRejectedValueOnce(refused(409, 'time_taken', 'That time has just been booked. Pick another time.'));
    await press();
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('That time has just been booked. Pick another time.'));
    expect(svc.book.mock.calls.map((c) => c[1])).toEqual(['key-1', 'key-1']);
    await waitFor(() => expect(svc.view).toHaveBeenCalledTimes(2));
    // The server answered, so the next press is a new one.
    svc.book.mockRejectedValueOnce(refused(409, 'time_taken', 'x'));
    await press();
    await waitFor(() => expect(svc.book).toHaveBeenCalledTimes(3));
    expect(svc.book.mock.calls[2][1]).toBe('key-2');
  });

  it.each([
    ['not_covered', "Your membership doesn't include personal training. Ask at the front desk."],
    ['no_membership', 'You have no membership in use on that day. Ask at the front desk.'],
    ['pack_used', 'Your pack has no sessions left. Ask at the front desk for another.'],
  ])('with nothing that pays (%s) the times still show, none of them a button, with who to ask', async (why, words) => {
    serve(view({ days: DAYS.map((localDate) => ({ localDate, pays: null, why })) }));
    render(<PersonalTraining gym={GYM} />);
    await screen.findByRole('group', { name: 'Sam Trainer' });
    pickDay(FRI);
    const sam = screen.getByRole('group', { name: 'Sam Trainer' });
    expect(screen.getByText(words)).toBeTruthy();
    expect(sam.textContent).toContain('9:00 am – 10:00 am');
    expect(within(sam).queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText('Available times.')).toBeTruthy();
    expect(screen.queryByText('Available times. Press one to book it.')).toBeNull();
  });

  it('somebody with no record on the gym’s list is told so, and has no button', async () => {
    serve(view({ onList: false, days: DAYS.map((localDate) => ({ localDate, pays: null, why: null })) }));
    render(<PersonalTraining gym={GYM} />);
    await screen.findByRole('group', { name: 'Sam Trainer' });
    expect(screen.getByText("Your gym hasn't added you to its member list yet. Ask at the front desk.")).toBeTruthy();
    expect(screen.queryAllByRole('button', { name: /^Book/ })).toHaveLength(0);
  });

  it('what pays is said for the day picked: a pack that ends mid-week has buttons before it ends and none after', async () => {
    const days = DAYS.map((localDate) => (localDate >= '2026-10-09' ? { localDate, pays: null, why: 'no_membership' } : { localDate, pays: PACK, why: null }));
    serve(view({ days }));
    render(<PersonalTraining gym={GYM} />);
    // Thursday is still inside the pack.
    const ann = await screen.findByRole('group', { name: 'Ann Coach' });
    expect(screen.getByText('A booking uses 1 session from your pack: PT 10 · 9 sessions left.')).toBeTruthy();
    expect(within(ann).getAllByRole('button')).toHaveLength(1);
    pickDay(FRI);
    expect(screen.getByText('You have no membership in use on that day. Ask at the front desk.')).toBeTruthy();
    expect(screen.queryByText(/A booking uses/)).toBeNull();
    const sam = screen.getByRole('group', { name: 'Sam Trainer' });
    expect(sam.textContent).toContain('9:00 am – 10:00 am');
    expect(within(sam).queryAllByRole('button')).toHaveLength(0);
  });

  it('a gym that sells no memberships says nothing about paying, and every time is a button', async () => {
    serve(view({ days: DAYS.map((localDate) => ({ localDate, pays: { membership: null, sessionsLeft: null }, why: null })) }));
    render(<PersonalTraining gym={GYM} />);
    await screen.findByRole('group', { name: 'Sam Trainer' });
    pickDay(FRI);
    expect(within(screen.getByRole('group', { name: 'Sam Trainer' })).getAllByRole('button')).toHaveLength(2);
    expect(screen.queryByText(/pack|membership/i)).toBeNull();
  });

  it('a free cancel asks first, saying until when it is free and that the pack gets the session back', async () => {
    serve(view({ sessions: [session(S1)] }));
    render(<PersonalTraining gym={GYM} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Cancel session: Fri 9 Oct/ }));
    const box = screen.getByRole('dialog', { name: 'Cancel your session?' });
    expect(box.textContent).toContain('Fri 9 Oct · 10:00 am – 11:00 am · with Sam Trainer');
    expect(box.textContent).toContain('Free to cancel until Fri 9 Oct, 8:00 am. Your pack gets the session back.');
    expect(svc.cancel).not.toHaveBeenCalled();
    // Keep it changes nothing.
    fireEvent.click(within(box).getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(svc.cancel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^Cancel session: Fri 9 Oct/ }));
    svc.cancel.mockImplementationOnce(() => {
      server = view();
      return Promise.resolve(session(S1, { status: 'cancelled', packCharged: false, cancel: null }));
    });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel session' }));
    expect(svc.cancel).toHaveBeenCalledWith('g1', S1, false);
    expect((await screen.findByRole('status')).textContent).toBe('Cancelled.');
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Your sessions' })).toBeNull());
  });

  it('a late cancel says what it costs BEFORE it is sent, and then that the session stays used', async () => {
    serve(view({ sessions: [session(S1, { cancel: 'late' })] }));
    render(<PersonalTraining gym={GYM} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Cancel session/ }));
    const box = screen.getByRole('dialog', { name: 'Cancel late?' });
    expect(box.textContent).toContain("It's too late to cancel for free. Cancelling now counts as a late cancel, and the session stays used on your pack.");
    svc.cancel.mockResolvedValueOnce(session(S1, { status: 'late_cancelled', cancel: null }));
    fireEvent.click(within(box).getByRole('button', { name: 'Cancel session' }));
    expect(svc.cancel).toHaveBeenCalledWith('g1', S1, true);
    expect((await screen.findByRole('status')).textContent).toBe('Cancelled late. The session stays used on your pack.');
  });

  it('the free time running out while the box is open asks again as a late cancel, and sends nothing late unasked', async () => {
    serve(view({ sessions: [session(S1)] }));
    render(<PersonalTraining gym={GYM} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Cancel session/ }));
    svc.cancel.mockRejectedValueOnce(refused(409, 'late_cancel', "It's too late to cancel for free.", { packCharged: true }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Cancel your session?' })).getByRole('button', { name: 'Cancel session' }));
    const late = await screen.findByRole('dialog', { name: 'Cancel late?' });
    expect(late.textContent).toContain('the session stays used on your pack');
    expect(svc.cancel.mock.calls).toEqual([['g1', S1, false]]);
    fireEvent.click(within(late).getByRole('button', { name: 'Keep it' }));
    expect(svc.cancel).toHaveBeenCalledTimes(1);
  });

  it('a session that has started has no Cancel; a trainer with no name reads "a trainer"', async () => {
    serve(view({ sessions: [session(S1, { cancel: null, trainerName: null, packCharged: false })] }));
    render(<PersonalTraining gym={GYM} />);
    const mine = await screen.findByRole('list', { name: 'Your sessions' });
    expect(mine.textContent).toContain('with a trainer');
    expect(mine.textContent).not.toContain('pack');
    expect(within(mine).queryByRole('button')).toBeNull();
  });

  it('Later turns the page and stops at the last day that can be booked; Earlier comes back', async () => {
    serve(view());
    render(<PersonalTraining gym={GYM} />);
    await screen.findByRole('group', { name: 'Sam Trainer' });
    expect(screen.getByRole('button', { name: /Earlier/ }).disabled).toBe(true);
    server = view({ from: '2026-10-14', to: '2026-10-20', trainers: [trainer(SAM, 'Sam Trainer')].map((t) => ({ ...t, days: t.days.map((d, n) => ({ ...d, localDate: `2026-10-${14 + n}` })) })), days: DAYS.map((_, n) => ({ localDate: `2026-10-${14 + n}`, pays: PACK, why: null })) });
    fireEvent.click(screen.getByRole('button', { name: /Later/ }));
    await waitFor(() => expect(svc.view).toHaveBeenLastCalledWith('g1', 1));
    expect(await screen.findByText('Wed 14 Oct – Tue 20 Oct')).toBeTruthy();
    expect(screen.getByText('No available times on this day.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Later/ }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Earlier/ }));
    await waitFor(() => expect(svc.view).toHaveBeenLastCalledWith('g1', 0));
  });

  it('a gym with no trainer taking sessions says so; a gym that is not theirs says it is not available; a failure offers Try again', async () => {
    serve(view({ trainers: [] }));
    const first = render(<PersonalTraining gym={GYM} />);
    expect(await screen.findByText('Iron House has no trainers taking personal training sessions yet.')).toBeTruthy();
    first.unmount();

    svc.view.mockRejectedValueOnce(refused(404, 'org_not_found', 'Organisation not found.'));
    const second = render(<PersonalTraining gym={GYM} />);
    expect(await screen.findByText("Iron House's personal training isn't available right now.")).toBeTruthy();
    second.unmount();

    svc.view.mockRejectedValueOnce(new Error('network'));
    render(<PersonalTraining gym={GYM} />);
    expect(await screen.findByText("Couldn't load personal training.")).toBeTruthy();
    serve(view());
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('group', { name: 'Sam Trainer' })).toBeTruthy();
  });
});
