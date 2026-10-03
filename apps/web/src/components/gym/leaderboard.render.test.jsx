// THE GYM'S LEADERBOARD, drawn (spec Part 3 §15.5; ROADMAP 19a). Only the network is
// mocked: what a member sees is read off the real component.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const svc = {
  board: vi.fn(),
  mine: vi.fn(),
  profile: vi.fn(),
  visibility: vi.fn(),
  setHidden: vi.fn(),
};
vi.mock('../../api/leaderboardApi', () => ({ leaderboardService: svc }));
vi.mock('../../api/orgsApi', () => ({ errorText: (_err, fallback) => fallback }));

const Leaderboard = (await import('./Leaderboard')).default;

const GYM = { id: 'g1', name: 'Iron House' };
const WEEK = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];
const circles = (n) => WEEK.map((_, i) => (i < n ? 'yes' : 'no'));
const row = (userId, name, initials, place, value, isMe = false) => ({ userId, name, initials, place, value, circles: circles(value), isMe });

const shown = (over = {}) => ({
  gymId: 'g1',
  gymName: 'Iron House',
  timezone: 'Asia/Kolkata',
  board: 'gym_days',
  period: 'this_week',
  from: '2026-10-05',
  to: '2026-10-11',
  circleDays: WEEK,
  status: 'shown',
  ranked: 4,
  rows: [
    row('u2', 'Chen W.', 'CW', 1, 3),
    row('u3', 'Bilal K.', 'BK', 2, 2),
    row('u4', 'Asha R.', 'AR', 3, 1),
    row('u1', 'Vera V.', 'VV', 3, 1, true),
  ],
  me: { value: 1, place: 3, hidden: null, toNextPlace: 1, nextPlace: 2, circles: circles(1) },
  asOf: '2026-10-07T05:12:00.000Z',
  ...over,
});

beforeEach(() => {
  svc.board.mockResolvedValue(shown());
  svc.visibility.mockResolvedValue({ hidden: false, hideMe: false, under18: false });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the members’ board', () => {
  it('draws places, ties, the dates and when it was updated', async () => {
    render(<Leaderboard gym={GYM} />);
    expect(await screen.findByText('Chen W.')).toBeTruthy();
    const list = screen.getByRole('list', { name: '4 people on the board' });
    const places = within(list).getAllByRole('listitem').map((li) => li.textContent);
    expect(places.map((t) => t.match(/^(\d+\w\w)/)?.[1])).toEqual(['1st', '2nd', '3rd', '3rd']);
    expect(screen.getByText(/Mon 5 Oct – Sun 11 Oct · Iron House's time · Updated 10:42 am/)).toBeTruthy();
    expect(screen.getByText('1 more gym day to reach 2nd')).toBeTruthy();
  });

  it('asks again every minute while open', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      render(<Leaderboard gym={GYM} />);
      await waitFor(() => expect(svc.board).toHaveBeenCalledTimes(1));
      vi.advanceTimersByTime(60_000);
      expect(svc.board).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a hidden member sees their own row greyed, with why, and is not in the list', async () => {
    svc.board.mockResolvedValue(
      shown({
        ranked: 3,
        rows: [row('u2', 'Chen W.', 'CW', 1, 3), row('u3', 'Bilal K.', 'BK', 2, 2), row('u4', 'Asha R.', 'AR', 3, 1)],
        me: { value: 7, place: 1, hidden: 'hide_me', toNextPlace: null, nextPlace: null, circles: circles(7) },
      }),
    );
    svc.visibility.mockResolvedValue({ hidden: true, hideMe: true, under18: false });
    render(<Leaderboard gym={GYM} />);
    expect(await screen.findByText('Hide me is on. Only you see this row.')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Hide me on leaderboards' }).getAttribute('aria-checked')).toBe('true');
  });

  it('Hide me asks the server, then reads the board again', async () => {
    svc.setHidden.mockResolvedValue({ hidden: true, hideMe: true, under18: false });
    render(<Leaderboard gym={GYM} />);
    const toggle = await screen.findByRole('switch', { name: 'Hide me on leaderboards' });
    fireEvent.click(toggle);
    await waitFor(() => expect(svc.setHidden).toHaveBeenCalledWith(true));
    await waitFor(() => expect(svc.board).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('switch', { name: 'Hide me on leaderboards' }).getAttribute('aria-checked')).toBe('true');
  });

  it('an under-18 hidden for their age is told how to show, and switching off is Show me', async () => {
    svc.visibility.mockResolvedValue({ hidden: true, hideMe: false, under18: true });
    svc.setHidden.mockResolvedValue({ hidden: false, hideMe: false, under18: false });
    render(<Leaderboard gym={GYM} />);
    expect(await screen.findByText("You're under 18, so you're hidden until you switch this off.")).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Hide me on leaderboards' }));
    await waitFor(() => expect(svc.setHidden).toHaveBeenCalledWith(false));
  });

  it('says why there is no board instead of drawing an empty one, and draws no row of your own', async () => {
    svc.board.mockResolvedValue(shown({ status: 'no_checkins', rows: [], ranked: 0 }));
    render(<Leaderboard gym={GYM} />);
    expect(await screen.findByText(/hasn't checked anyone in at the front desk in the last 30 days/)).toBeTruthy();
    expect(screen.queryByRole('list', { name: /people on the board/ })).toBeNull();
    expect(screen.queryByText(/What counted/)).toBeNull();
  });

  it('a sheet closes by its X, never by a click outside it', async () => {
    svc.profile.mockResolvedValue({ userId: 'u2', name: 'Chen W.', initials: 'CW', boards: [{ board: 'gym_days', period: 'this_week', place: 1, value: 3 }] });
    render(<Leaderboard gym={GYM} />);
    fireEvent.click(await screen.findByText('Chen W.'));
    const dialog = await screen.findByRole('dialog', { name: 'Chen W.' });
    fireEvent.click(dialog.parentElement);
    expect(screen.getByRole('dialog', { name: 'Chen W.' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not ask again while the tab is hidden, and asks as soon as it is back', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const hidden = vi.spyOn(document, 'hidden', 'get');
    try {
      hidden.mockReturnValue(true);
      render(<Leaderboard gym={GYM} />);
      await waitFor(() => expect(svc.board).toHaveBeenCalledTimes(1));
      vi.advanceTimersByTime(180_000);
      expect(svc.board).toHaveBeenCalledTimes(1);
      hidden.mockReturnValue(false);
      document.dispatchEvent(new Event('visibilitychange'));
      expect(svc.board).toHaveBeenCalledTimes(2);
    } finally {
      hidden.mockRestore();
      vi.useRealTimers();
    }
  });

  it('a failed read says so and offers Try again, never an empty board', async () => {
    svc.board.mockRejectedValue(new Error('offline'));
    render(<Leaderboard gym={GYM} />);
    expect(await screen.findByText("Couldn't load the leaderboard.")).toBeTruthy();
    svc.board.mockResolvedValue(shown());
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Chen W.')).toBeTruthy();
  });

  it('a tap on another member opens their places; a tap on your own opens what counted', async () => {
    svc.profile.mockResolvedValue({
      userId: 'u2',
      name: 'Chen W.',
      initials: 'CW',
      boards: [
        { board: 'gym_days', period: 'this_week', place: 1, value: 3 },
        { board: 'workout_days', period: 'this_week', place: 3, value: 1 },
        { board: 'streak', period: null, place: 2, value: 4 },
      ],
    });
    render(<Leaderboard gym={GYM} />);
    fireEvent.click(await screen.findByText('Chen W.'));
    const dialog = await screen.findByRole('dialog', { name: 'Chen W.' });
    expect(await within(dialog).findByText('1st · 3 gym days')).toBeTruthy();
    expect(within(dialog).getByText('2nd · 4 weeks')).toBeTruthy();
    expect(within(dialog).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Gym days, this week1st · 3 gym days',
      'Workout days, this week3rd · 1 workout day',
      'Streak2nd · 4 weeks',
    ]);
    expect(svc.profile).toHaveBeenCalledWith('g1', 'u2', 'this_week');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

    svc.mine.mockResolvedValue({
      gymName: 'Iron House',
      timezone: 'Asia/Kolkata',
      board: 'gym_days',
      period: 'this_week',
      from: '2026-10-05',
      to: '2026-10-11',
      value: 1,
      days: [{ day: '2026-10-06', visits: [{ at: '2026-10-06T08:30:00.000Z', how: 'staff', by: 'Maya Coach' }, { at: '2026-10-06T06:30:00.000Z', how: 'desk', by: 'Front desk' }] }],
      notCounted: [{ day: '2026-10-07', at: '2026-10-07T06:30:00.000Z', why: 'own_tap' }],
      workoutDays: [],
      workoutsNotCounted: [],
      weeks: [],
    });
    fireEvent.click(screen.getByText('Vera V.'));
    const counted = await screen.findByRole('dialog', { name: 'What counted' });
    expect(await within(counted).findByText('2:00 pm · checked in by Maya Coach')).toBeTruthy();
    expect(within(counted).getByText(/2 visits, 1 day/)).toBeTruthy();
    expect(within(counted).getByText(/Your own "I'm here" tap/)).toBeTruthy();
    expect(svc.profile).toHaveBeenCalledTimes(1);
  });

  it('a slow answer for one board is never drawn under the other board’s tab', async () => {
    let answerGymDays;
    svc.board.mockImplementationOnce(() => new Promise((resolve) => { answerGymDays = resolve; }));
    svc.board.mockResolvedValueOnce(shown({ board: 'streak', period: null, from: null, to: '2026-10-07', rows: [row('u9', 'Sol S.', 'SS', 1, 6)], ranked: 3 }));
    render(<Leaderboard gym={GYM} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Streak' }));
    expect(await screen.findByText('Sol S.')).toBeTruthy();
    answerGymDays(shown());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Chen W.')).toBeNull();
    expect(screen.getByText('Sol S.')).toBeTruthy();
  });

  it('Workout days keeps the period choice, and what counted lists each workout and each one that did not count', async () => {
    render(<Leaderboard gym={GYM} />);
    await screen.findByText('Chen W.');
    svc.board.mockResolvedValue(shown({ board: 'workout_days', period: 'last_week', from: '2026-09-28', to: '2026-10-04' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Workout days' }));
    await waitFor(() => expect(svc.board).toHaveBeenLastCalledWith('g1', 'workout_days', 'this_week'));
    fireEvent.change(screen.getByRole('combobox', { name: 'Period' }), { target: { value: 'last_week' } });
    await waitFor(() => expect(svc.board).toHaveBeenLastCalledWith('g1', 'workout_days', 'last_week'));
    expect(await screen.findByText('1 more workout day to reach 2nd')).toBeTruthy();

    svc.mine.mockResolvedValue({
      gymName: 'Iron House',
      timezone: 'Asia/Kolkata',
      board: 'workout_days',
      period: 'last_week',
      from: '2026-09-28',
      to: '2026-10-04',
      value: 1,
      days: [],
      notCounted: [],
      workoutDays: [
        {
          day: '2026-09-30',
          workouts: [
            { at: '2026-09-30T12:30:00.000Z', countedBy: 'you' },
            { at: '2026-09-30T02:00:00.000Z', countedBy: 'camera' },
          ],
        },
      ],
      workoutsNotCounted: [
        { day: '2026-09-29', at: '2026-09-29T02:00:00.000Z', why: 'saved_late', daysLate: 9 },
        { day: '2026-09-28', at: '2026-09-28T02:00:00.000Z', why: 'before_joining', daysLate: null },
      ],
      weeks: [],
    });
    fireEvent.click(screen.getByText('Vera V.'));
    const counted = await screen.findByRole('dialog', { name: 'What counted' });
    await waitFor(() => expect(svc.mine).toHaveBeenCalledWith('g1', 'workout_days', 'last_week'));
    expect(await within(counted).findByText('1 workout day')).toBeTruthy();
    expect(within(counted).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Wed 30 Sep · 2 workouts, 1 day6:00 pm · counted by you7:30 am · counted by the camera',
      'Tue 29 Sep · 7:30 am · Saved 9 days after the workout — a workout counts when it is saved within 7 days',
      'Mon 28 Sep · 7:30 am · Before you joined Iron House',
    ]);
  });

  it('the Streak has no period and shows weeks', async () => {
    render(<Leaderboard gym={GYM} />);
    await screen.findByText('Chen W.');
    expect(screen.getByRole('combobox', { name: 'Period' })).toBeTruthy();
    svc.board.mockResolvedValue(shown({ board: 'streak', period: null, from: null, to: '2026-10-07' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Streak' }));
    await waitFor(() => expect(svc.board).toHaveBeenLastCalledWith('g1', 'streak', 'this_week'));
    expect(screen.queryByRole('combobox', { name: 'Period' })).toBeNull();
    expect(await screen.findByText(/Weeks in a row, up to this week/)).toBeTruthy();
  });
});
