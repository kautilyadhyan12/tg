// THE LEADERBOARD IN THE CONSOLE, drawn (ROADMAP 19a-iii; spec Part 3 §15.5). Only the
// network is mocked: what staff see is read off the real page.
//
// The worst thing the screen could do: take somebody off the board that staff did not pick,
// or do it without the box that names them — so the press is checked against the row opened.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const svc = {
  board: vi.fn(),
  profile: vi.fn(),
  counted: vi.fn(),
  setTakenOff: vi.fn(),
  setBoardOff: vi.fn(),
};
const orgApi = { getMine: vi.fn(), addVisit: vi.fn(), removeVisit: vi.fn() };
const postsSvc = { person: vi.fn(), remove: vi.fn(), setStopped: vi.fn(), reactors: vi.fn() };
vi.mock('../../api/leaderboardApi', () => ({ staffLeaderboardService: svc }));
vi.mock('../../api/postsApi', () => ({ staffPostsService: postsSvc, postPhotoUrl: () => 'http://api.test/photo' }));
vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: orgApi };
});

const Leaderboard = (await import('./Leaderboard')).default;
const { resetConsoleOrgs } = await import('./consoleOrgs');

const ORG = {
  id: 'g1',
  slug: 'iron-house',
  name: 'Iron House',
  staffRole: 'owner',
  privileges: ['members.read', 'leaderboard.manage'],
  timezone: 'Asia/Kolkata',
  orgType: 'gym',
  subscription: { status: 'trialing', trialEndsAt: '2099-01-01T00:00:00.000Z' },
};
const WEEK = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];
const circles = (n) => WEEK.map((_, i) => (i < n ? 'yes' : 'no'));
const row = (userId, name, place, value, hidden = null) => ({
  userId,
  name,
  initials: name === null ? '?' : name.split(' ').map((w) => w[0]).join(''),
  place,
  value,
  circles: circles(value),
  hidden,
});
const CHEN = row('u-chen', 'Chen Wu', 1, 3);
const HEMA = row('u-hema', 'Hema Hidden', null, 3, 'hide_me');
const TARIQ = row('u-tariq', 'Tariq Taken', null, 3, 'taken_off');
const BILAL = row('u-bilal', 'Bilal Khan', 2, 2);

const answer = (over = {}) => ({
  gymId: 'g1',
  gymName: 'Iron House',
  timezone: 'Asia/Kolkata',
  board: 'gym_days',
  period: 'this_week',
  from: '2026-10-05',
  to: '2026-10-11',
  circleDays: WEEK,
  memberStatus: 'shown',
  live: true,
  checkingIn: true,
  boardsOff: [],
  ranked: 4,
  total: 6,
  page: 1,
  pages: 1,
  rows: [CHEN, HEMA, TARIQ, BILAL, row('u-asha', 'Asha Rao', 3, 1), row('u-x', null, null, 1, 'no_name')],
  notInApp: 12,
  asOf: '2026-10-07T05:12:00.000Z',
  ...over,
});
const profile = (r, over = {}) => ({
  userId: r.userId,
  name: r.name,
  initials: r.initials,
  hidden: r.hidden,
  takenOff: r.hidden === 'taken_off',
  hiddenWithoutTakeOff: r.hidden === 'taken_off' || r.hidden === 'staff' ? null : r.hidden,
  isStaff: r.hidden === 'staff',
  entryId: null,
  boards: [
    { board: 'gym_days', period: 'this_week', place: r.place, value: r.value, memberStatus: 'shown' },
    { board: 'workout_days', period: 'this_week', place: null, value: 0, memberStatus: 'too_few' },
    { board: 'streak', period: null, place: r.place, value: 4, memberStatus: 'shown' },
  ],
  ...over,
});

const open = (org = ORG) => {
  orgApi.getMine.mockResolvedValue({ data: { orgs: [org], formerOrgs: [] } });
  render(
    <MemoryRouter initialEntries={['/console/iron-house/leaderboard']}>
      <Routes>
        <Route path="/console/:orgSlug/leaderboard" element={<Leaderboard />} />
      </Routes>
    </MemoryRouter>,
  );
};
const rows = () => screen.getAllByTestId('board-row').map((el) => el.textContent);

beforeEach(() => {
  resetConsoleOrgs();
  svc.board.mockResolvedValue(answer());
  svc.profile.mockImplementation((_gym, userId) => {
    const r = answer().rows.find((x) => x.userId === userId);
    return Promise.resolve(profile(r));
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the board for staff', () => {
  it('lists everyone by full name: a place for people members see, the reason for people they do not', async () => {
    open();
    await screen.findByText('Chen Wu');
    expect(rows()).toEqual([
      '1stChen Wu3On the board',
      '—Hema Hidden3Chose Hide me',
      '—Tariq Taken3Taken off by staff',
      '2ndBilal Khan2On the board',
      '3rdAsha Rao1On the board',
      '—No name yet1No name yet',
    ]);
    expect(screen.getByTestId('board-dates').textContent).toBe(
      "Mon 5 Oct – Sun 11 Oct · Iron House's time · Updated 10:42 am · 6 people have a gym day · 2 are hidden from members",
    );
    expect(screen.getByTestId('not-in-app').textContent).toBe("12 members on your list don't have the app yet, so they aren't on any board.");
    expect(svc.board).toHaveBeenCalledWith('g1', 'gym_days', 'this_week', 1);
  });

  it('a tab or a period asks for that board, from its first page', async () => {
    open();
    await screen.findByText('Chen Wu');
    // A week: seven flames a row, the counted days lit.
    const lit = () => screen.getAllByTestId('board-row').map((r) => r.querySelectorAll('.c-flame-on').length);
    expect(screen.getAllByTestId('board-row').map((r) => r.querySelectorAll('.c-flame').length)).toEqual([7, 7, 7, 7, 7, 7]);
    expect(lit()).toEqual([3, 3, 3, 2, 1, 1]);
    svc.board.mockResolvedValue(answer({ period: 'all_time', from: null }));
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'all_time' } });
    await waitFor(() => expect(svc.board).toHaveBeenLastCalledWith('g1', 'gym_days', 'all_time', 1));
    // All time draws the same row: seven flames each, and the line says which week they are.
    await waitFor(() => expect(screen.getByTestId('board-dates').textContent).toContain('the flames are this week'));
    expect(screen.getAllByTestId('board-row').map((r) => r.querySelectorAll('.c-flame').length)).toEqual([7, 7, 7, 7, 7, 7]);
    fireEvent.click(screen.getByRole('tab', { name: 'Streak' }));
    await waitFor(() => expect(svc.board).toHaveBeenLastCalledWith('g1', 'streak', 'all_time', 1));
    // The Streak has no period.
    expect(screen.queryByLabelText('Period')).toBeNull();
  });

  it('a slow answer for the tab staff left is never drawn under the tab they are on', async () => {
    let releaseOld;
    svc.board.mockImplementation((_g, boardId) =>
      boardId === 'gym_days'
        ? new Promise((resolve) => {
            releaseOld = () => resolve(answer());
          })
        : Promise.resolve(answer({ board: 'workout_days', rows: [row('u-w', 'Wendy Workout', 1, 5)], total: 1, ranked: 1 })),
    );
    open();
    await waitFor(() => expect(svc.board).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('tab', { name: 'Workout days' }));
    await screen.findByText('Wendy Workout');
    releaseOld();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Chen Wu')).toBeNull();
    expect(screen.getByText('Wendy Workout')).toBeTruthy();
  });

  it('pages: Next asks for the next hundred', async () => {
    svc.board.mockResolvedValue(answer({ total: 250, pages: 3 }));
    open();
    await screen.findByText('Page 1 of 3');
    expect(screen.getByRole('button', { name: 'Previous' }).disabled).toBe(true);
    svc.board.mockResolvedValue(answer({ total: 250, pages: 3, page: 2 }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Page 2 of 3');
    expect(svc.board).toHaveBeenLastCalledWith('g1', 'gym_days', 'this_week', 2);
  });

  it('asks again every minute while open', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      open();
      await waitFor(() => expect(svc.board).toHaveBeenCalledTimes(1));
      vi.advanceTimersByTime(60_000);
      expect(svc.board).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a refusal from the server is said, with no table and no switches', async () => {
    const refused = Object.assign(new Error('no'), { response: { status: 403, data: { message: "Your role doesn't allow that." } } });
    svc.board.mockRejectedValue(refused);
    open();
    expect(await screen.findByText("Your role doesn't allow that.")).toBeTruthy();
    expect(screen.queryByTestId('board-row')).toBeNull();
    expect(screen.queryByTestId('board-switches')).toBeNull();
  });

  it('an empty board says so', async () => {
    svc.board.mockResolvedValue(answer({ rows: [], total: 0, ranked: 0, memberStatus: 'too_few', notInApp: 0 }));
    open();
    expect(await screen.findByText('Nobody was checked in during this period.')).toBeTruthy();
    expect(screen.queryByTestId('not-in-app')).toBeNull();
  });
});

describe('which boards members see', () => {
  it('each board has a switch and a line saying whether members see it, and why not', async () => {
    svc.board.mockResolvedValue(answer({ boardsOff: ['streak'] }));
    open();
    await screen.findByText('Chen Wu');
    const days = within(screen.getByTestId('switch-gym_days'));
    expect(days.getByRole('switch', { name: 'Members see Gym days' }).getAttribute('aria-checked')).toBe('true');
    expect(days.getByText('Members see this board.')).toBeTruthy();
    const streak = within(screen.getByTestId('switch-streak'));
    expect(streak.getByRole('switch', { name: 'Members see Streak' }).getAttribute('aria-checked')).toBe('false');
    expect(streak.getByText("Switched off. Members don't see this board.")).toBeTruthy();
  });

  it('pressing a switch sends that ONE board and nothing about the others, then reads the board again', async () => {
    svc.board.mockResolvedValue(answer({ boardsOff: ['streak'] }));
    svc.setBoardOff.mockResolvedValue({ boardsOff: ['gym_days', 'streak'] });
    open();
    await screen.findByText('Chen Wu');
    svc.board.mockResolvedValue(answer({ boardsOff: ['gym_days', 'streak'], memberStatus: 'switched_off' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Members see Gym days' }));
    await waitFor(() => expect(svc.setBoardOff).toHaveBeenCalledWith('g1', 'gym_days', true));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Members see Gym days' }).getAttribute('aria-checked')).toBe('false'));
    // Staff still see the people.
    expect(screen.getByText('Chen Wu')).toBeTruthy();
  });

  it('a switch that could not be saved says so and stays as it was', async () => {
    svc.setBoardOff.mockRejectedValue(Object.assign(new Error('down'), { response: { status: 500, data: {} } }));
    open();
    await screen.findByText('Chen Wu');
    fireEvent.click(screen.getByRole('switch', { name: 'Members see Streak' }));
    expect(await screen.findByText("We couldn't change that. Please try again.")).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Members see Streak' }).getAttribute('aria-checked')).toBe('true');
  });

  it("a gym with no plan: the switches can't be pressed, and the page says why", async () => {
    svc.board.mockResolvedValue(answer({ live: false, memberStatus: 'paused' }));
    open({ ...ORG, subscription: null, consoleReadOnly: true });
    await screen.findByText('Chen Wu');
    expect(screen.getByRole('switch', { name: 'Members see Gym days' }).disabled).toBe(true);
    expect(screen.getAllByText('Not showing to members: this gym has no plan right now.').length).toBe(3);
  });
});

describe('a person’s panel', () => {
  it('shows their place on all three boards, and what counted when asked — a workout as a date only', async () => {
    svc.counted.mockResolvedValue({
      userId: 'u-chen',
      gymName: 'Iron House',
      timezone: 'Asia/Kolkata',
      board: 'workout_days',
      period: 'this_week',
      from: '2026-10-05',
      to: '2026-10-11',
      value: 1,
      days: [],
      notCounted: [],
      workoutDays: [{ day: '2026-10-06', workouts: 2 }],
      workoutsNotCounted: [{ day: '2026-09-28', why: 'saved_late', daysLate: 9 }],
      weeks: [],
    });
    open();
    fireEvent.click((await screen.findAllByTestId('board-row'))[0]);
    const box = within(await screen.findByTestId('person-box'));
    expect(await box.findByText('Gym days, this week')).toBeTruthy();
    expect(box.getByTestId('person-gym_days').textContent).toContain('1st · 3 gym days');
    expect(box.getByTestId('person-workout_days').textContent).toContain('No place · 0 workout days');
    expect(box.getByTestId('person-streak').textContent).toContain('1st · 4 weeks');
    expect(svc.profile).toHaveBeenCalledWith('g1', 'u-chen', 'this_week');

    fireEvent.click(within(box.getByTestId('person-workout_days')).getByRole('button', { name: 'What counted' }));
    const counted = await box.findByTestId('counted-workout_days');
    expect(svc.counted).toHaveBeenCalledWith('g1', 'u-chen', 'workout_days', 'this_week');
    expect(counted.textContent).toContain('Tue 6 Oct · 2 workouts, 1 day');
    expect(counted.textContent).toContain('Mon 28 Sep · Saved more than 9 days after the workout');
    // Never a time of day for a workout.
    expect(counted.textContent).not.toMatch(/\d\s?[ap]m|\d\d:\d\d/);
  });

  it('a hidden person opens too, with the reason in words', async () => {
    open();
    fireEvent.click((await screen.findAllByTestId('board-row'))[1]);
    const box = within(await screen.findByTestId('person-box'));
    expect(await box.findByText(/They switched on Hide me in their app/)).toBeTruthy();
    expect(box.getByText('Chose Hide me')).toBeTruthy();
  });

  it('Take off the board: a box names the person and what is kept; the press is for that person; the list is read again', async () => {
    svc.setTakenOff.mockResolvedValue({ takenOff: true });
    open();
    fireEvent.click((await screen.findAllByTestId('board-row'))[3]);
    const box = within(await screen.findByTestId('person-box'));
    fireEvent.click(await box.findByTestId('take-off-open'));
    // Nothing is sent by opening the box.
    expect(svc.setTakenOff).not.toHaveBeenCalled();
    const ask = within(box.getByTestId('take-off-box'));
    expect(screen.getByRole('dialog', { name: 'Take Bilal Khan off the board?' })).toBeTruthy();
    expect(ask.getByText('Bilal Khan — members will not see them on any board at Iron House.')).toBeTruthy();
    expect(ask.getByText('Their visits and workouts are kept.')).toBeTruthy();
    expect(ask.getByText('Nobody else is removed. People below them move up.')).toBeTruthy();

    const before = svc.board.mock.calls.length;
    fireEvent.click(box.getByTestId('take-off-press'));
    await waitFor(() => expect(svc.setTakenOff).toHaveBeenCalledTimes(1));
    expect(svc.setTakenOff).toHaveBeenCalledWith('g1', 'u-bilal', true);
    await waitFor(() => expect(svc.board.mock.calls.length).toBe(before + 1));
    expect(await screen.findByText('Bilal Khan is off the board.')).toBeTruthy();
  });

  it('Cancel sends nothing', async () => {
    open();
    fireEvent.click((await screen.findAllByTestId('board-row'))[3]);
    const box = within(await screen.findByTestId('person-box'));
    fireEvent.click(await box.findByTestId('take-off-open'));
    fireEvent.click(box.getByRole('button', { name: 'Cancel' }));
    expect(svc.setTakenOff).not.toHaveBeenCalled();
    expect(box.getByTestId('take-off-open').textContent).toBe('Take off the board');
  });

  it('somebody already taken off is offered Put back, and it sends false', async () => {
    svc.setTakenOff.mockResolvedValue({ takenOff: false });
    open();
    fireEvent.click((await screen.findAllByTestId('board-row'))[2]);
    const box = within(await screen.findByTestId('person-box'));
    const button = await box.findByTestId('take-off-open');
    expect(button.textContent).toBe('Put back on the board');
    fireEvent.click(button);
    expect(screen.getByRole('dialog', { name: 'Put Tariq Taken back on the board?' })).toBeTruthy();
    fireEvent.click(box.getByTestId('take-off-press'));
    await waitFor(() => expect(svc.setTakenOff).toHaveBeenCalledWith('g1', 'u-tariq', false));
  });

  it('a failed press says so, keeps the box, and takes nobody off', async () => {
    svc.setTakenOff.mockRejectedValue(Object.assign(new Error('down'), { response: { status: 500, data: {} } }));
    open();
    fireEvent.click((await screen.findAllByTestId('board-row'))[3]);
    const box = within(await screen.findByTestId('person-box'));
    fireEvent.click(await box.findByTestId('take-off-open'));
    fireEvent.click(box.getByTestId('take-off-press'));
    expect(await box.findByText("We couldn't change that. Please try again.")).toBeTruthy();
    expect(box.getByTestId('take-off-box')).toBeTruthy();
    expect(screen.queryByText('Bilal Khan is off the board.')).toBeNull();
  });

  it('staff are never ranked, so there is no Take off for them; nor at a gym with no plan', async () => {
    const coach = row('u-coach', 'Cora Coach', null, 3, 'staff');
    svc.board.mockResolvedValue(answer({ rows: [coach, CHEN] }));
    svc.profile.mockImplementation((_g, userId) => Promise.resolve(profile(userId === 'u-coach' ? coach : CHEN)));
    open();
    fireEvent.click((await screen.findAllByTestId('board-row'))[0]);
    const box = within(await screen.findByTestId('person-box'));
    await box.findByText('Staff, not ranked');
    expect(box.queryByTestId('take-off-open')).toBeNull();
    cleanup();

    resetConsoleOrgs();
    open({ ...ORG, subscription: null, consoleReadOnly: true });
    fireEvent.click((await screen.findAllByTestId('board-row'))[1]);
    const lapsed = within(await screen.findByTestId('person-box'));
    await lapsed.findByText('Gym days, this week');
    expect(lapsed.queryByTestId('take-off-open')).toBeNull();
  });

  it('somebody taken off who also chose Hide me: Put back never says members will see them again', async () => {
    svc.setTakenOff.mockResolvedValue({ takenOff: false });
    svc.profile.mockResolvedValue(profile(TARIQ, { hiddenWithoutTakeOff: 'hide_me' }));
    open();
    fireEvent.click((await screen.findAllByTestId('board-row'))[2]);
    const box = within(await screen.findByTestId('person-box'));
    fireEvent.click(await box.findByTestId('take-off-open'));
    const ask = box.getByTestId('take-off-box');
    expect(ask.textContent).toContain('Tariq Taken will no longer be taken off by your staff.');
    expect(ask.textContent).toContain("Members still won't see them. They switched on Hide me in their app.");
    expect(ask.textContent).not.toMatch(/see them again/);
    fireEvent.click(box.getByTestId('take-off-press'));
    expect(await screen.findByText('Tariq Taken is no longer taken off, and is still hidden (Chose Hide me).')).toBeTruthy();
    expect(screen.queryByText(/is back on the board/)).toBeNull();
  });
});

describe('a board members do not see', () => {
  it('gives nobody a place or "On the board", on the row or on the panel', async () => {
    const few = [row('u-chen', 'Chen Wu', null, 3), row('u-bilal', 'Bilal Khan', null, 2)];
    svc.board.mockResolvedValue(answer({ memberStatus: 'too_few', rows: few, total: 2, ranked: 2 }));
    svc.profile.mockResolvedValue(
      profile(few[0], {
        boards: [
          { board: 'gym_days', period: 'this_week', place: null, value: 3, memberStatus: 'too_few' },
          { board: 'workout_days', period: 'this_week', place: null, value: 0, memberStatus: 'too_few' },
          { board: 'streak', period: null, place: null, value: 2, memberStatus: 'too_few' },
        ],
      }),
    );
    open();
    await screen.findByText('Chen Wu');
    expect(rows()).toEqual(['—Chen Wu3Board not showing', '—Bilal Khan2Board not showing']);
    fireEvent.click(screen.getAllByTestId('board-row')[0]);
    const box = within(await screen.findByTestId('person-box'));
    expect((await box.findByTestId('person-gym_days')).textContent).toContain("No place — members don't see this board now · 3 gym days");
    expect(box.getByTestId('person-workout_days').textContent).toContain('No place · 0 workout days');
    expect(box.queryByText('On the board')).toBeNull();
  });
});

// The worst thing the screen could do here: remove a visit staff did not pick, or do it
// without the box that names the person and the visit.
describe('fixing a visit from a person’s panel', () => {
  const FIXER = { ...ORG, privileges: ['members.read', 'leaderboard.manage', 'attendance.mark'] };
  const gymDays = () => ({
    userId: 'u-chen',
    gymName: 'Iron House',
    timezone: 'Asia/Kolkata',
    board: 'gym_days',
    period: 'this_week',
    from: '2026-10-05',
    to: '2026-10-11',
    value: 2,
    days: [
      { day: '2026-10-06', visits: [{ id: 'v-tue', at: '2026-10-06T06:30:00.000Z', how: 'desk', by: 'Front desk', addedOn: null }] },
      { day: '2026-10-05', visits: [{ id: 'v-mon', at: '2026-10-05T06:30:00.000Z', how: 'staff', by: 'Sam Desk', addedOn: '2026-10-06' }] },
    ],
    notCounted: [{ day: '2026-10-07', at: '2026-10-07T06:30:00.000Z', why: 'removed', by: 'Sam Desk', removedOn: '2026-10-07' }],
    workoutDays: [],
    workoutsNotCounted: [],
    weeks: [],
  });
  const openCounted = async (org) => {
    svc.counted.mockResolvedValue(gymDays());
    open(org);
    fireEvent.click((await screen.findAllByTestId('board-row'))[0]);
    const box = within(await screen.findByTestId('person-box'));
    fireEvent.click(within(await box.findByTestId('person-gym_days')).getByRole('button', { name: 'What counted' }));
    await box.findByTestId('counted-gym_days');
    return box;
  };

  it('says who added a visit and who removed one, and offers nothing to staff without the tick', async () => {
    const box = await openCounted(ORG);
    const counted = box.getByTestId('counted-gym_days');
    expect(counted.textContent).toContain('Added by Sam Desk (staff) on 6 Oct');
    expect(counted.textContent).toContain('Wed 7 Oct · Visit removed by Sam Desk (staff) on 7 Oct');
    expect(box.queryByRole('button', { name: /^Remove the visit/ })).toBeNull();
    expect(box.queryByTestId('add-visit-open')).toBeNull();
  });

  it('nor at a gym with no plan', async () => {
    const box = await openCounted({ ...FIXER, subscription: null, consoleReadOnly: true });
    expect(box.queryByRole('button', { name: /^Remove the visit/ })).toBeNull();
    expect(box.queryByTestId('add-visit-open')).toBeNull();
  });

  it('Remove: a box names the person, the visit and the new number; the press is for THAT visit; what counted is read again', async () => {
    orgApi.removeVisit.mockResolvedValue({ data: { removed: true, day: '2026-10-06' } });
    const box = await openCounted(FIXER);
    fireEvent.click(box.getByRole('button', { name: 'Remove the visit on Tue 6 Oct: 12:00 pm · scanned at Front desk' }));
    const asked = await box.findByTestId('visit-box');
    expect(screen.getByRole('dialog', { name: 'Remove this visit of Chen Wu?' })).toBeTruthy();
    expect(asked.textContent).toContain('Chen Wu — the 12:00 pm visit on Tue 6 Oct is removed.');
    expect(asked.textContent).toContain('Their Gym days, this week, go from 2 to 1.');
    expect(orgApi.removeVisit).not.toHaveBeenCalled();

    const before = svc.counted.mock.calls.length;
    fireEvent.click(box.getByTestId('visit-press'));
    await waitFor(() => expect(orgApi.removeVisit).toHaveBeenCalledTimes(1));
    expect(orgApi.removeVisit).toHaveBeenCalledWith('g1', 'v-tue');
    await waitFor(() => expect(svc.counted.mock.calls.length).toBeGreaterThan(before));
    expect(await screen.findByText('Visit removed for Chen Wu.')).toBeTruthy();
  });

  it('Cancel removes nothing; a failed press says so and keeps the box', async () => {
    orgApi.removeVisit.mockRejectedValue({ response: { status: 404, data: { message: "That visit isn't there any more." } } });
    const box = await openCounted(FIXER);
    fireEvent.click(box.getByRole('button', { name: /^Remove the visit on Tue 6 Oct/ }));
    fireEvent.click(box.getByRole('button', { name: 'Cancel' }));
    expect(orgApi.removeVisit).not.toHaveBeenCalled();
    await box.findByTestId('counted-gym_days');

    fireEvent.click(box.getByRole('button', { name: /^Remove the visit on Tue 6 Oct/ }));
    fireEvent.click(box.getByTestId('visit-press'));
    expect((await box.findByRole('alert')).textContent).toBe("That visit isn't there any more.");
    expect(box.getByTestId('visit-box')).toBeTruthy();
  });

  it('Add a visit: nothing is sent until a day is picked; the press sends that person and that day', async () => {
    orgApi.addVisit.mockResolvedValue({ data: { result: 'added', person: { name: 'Chen Wu' }, day: '2026-10-07' } });
    const box = await openCounted(FIXER);
    fireEvent.click(box.getByTestId('add-visit-open'));
    const asked = await box.findByTestId('visit-box');
    expect(asked.textContent).toContain('Pick the day they came.');
    expect(box.getByTestId('visit-press').disabled).toBe(true);
    // A press on the box opens the calendar: the day is picked, not typed.
    const dayBox = box.getByTestId('add-visit-day');
    dayBox.showPicker = vi.fn();
    fireEvent.click(dayBox);
    expect(dayBox.showPicker).toHaveBeenCalledTimes(1);

    // A day that already counts cannot be pressed either.
    fireEvent.change(box.getByTestId('add-visit-day'), { target: { value: '2026-10-06' } });
    expect(asked.textContent).toContain('Chen Wu already has a visit that counts on Tue 6 Oct. Nothing will be added.');
    expect(box.getByTestId('visit-press').disabled).toBe(true);

    fireEvent.change(box.getByTestId('add-visit-day'), { target: { value: '2026-10-07' } });
    expect(asked.textContent).toContain('Chen Wu — a visit is added for Wed 7 Oct.');
    expect(asked.textContent).toContain('Their Gym days, this week, go from 2 to 3.');
    fireEvent.click(box.getByTestId('visit-press'));
    await waitFor(() => expect(orgApi.addVisit).toHaveBeenCalledTimes(1));
    expect(orgApi.addVisit).toHaveBeenCalledWith('g1', { userId: 'u-chen' }, '2026-10-07');
    expect(await screen.findByText('Visit added for Chen Wu on Wed 7 Oct.')).toBeTruthy();
  });

  it('says so when the server found a visit already there', async () => {
    orgApi.addVisit.mockResolvedValue({ data: { result: 'already', person: { name: 'Chen Wu' }, day: '2026-09-30' } });
    const box = await openCounted(FIXER);
    fireEvent.click(box.getByTestId('add-visit-open'));
    fireEvent.change(await box.findByTestId('add-visit-day'), { target: { value: '2026-09-30' } });
    fireEvent.click(box.getByTestId('visit-press'));
    expect(await screen.findByText('Chen Wu already had a visit that counts on that day. Nothing was added.')).toBeTruthy();
  });
});

describe('a person’s posts on their panel', () => {
  const theirPost = {
    id: 'p1',
    author: { name: 'Chen Wu', initials: 'CW' },
    body: 'First 5k done',
    photos: [],
    pinned: false,
    createdAt: '2026-10-07T06:30:00.000Z',
    reactions: { like: 0, love: 0, strong: 0, fire: 0 },
    mine: null,
    fromMember: true,
    own: false,
    wrote: false,
    reported: false,
    authorId: 'u-chen',
    authorStopped: false,
  };

  it('staff who hold “Post updates” read the person’s posts under their boards', async () => {
    postsSvc.person.mockReset();
    postsSvc.person.mockResolvedValue({ posts: [theirPost], next: null, total: 1 });
    open({ ...ORG, privileges: [...ORG.privileges, 'posts.manage'] });
    fireEvent.click(await screen.findByText('Chen Wu'));
    const box = within(await screen.findByTestId('person-box'));
    expect(await box.findByRole('heading', { name: "Chen Wu's posts" })).toBeTruthy();
    expect(await box.findByText('First 5k done')).toBeTruthy();
    expect(postsSvc.person).toHaveBeenCalledWith('g1', 'u-chen');
  });

  it('staff without it are shown no posts, and none are asked for', async () => {
    postsSvc.person.mockReset();
    open();
    fireEvent.click(await screen.findByText('Chen Wu'));
    const box = within(await screen.findByTestId('person-box'));
    await waitFor(() => expect(box.getByTestId('person-gym_days')).toBeTruthy());
    expect(box.queryByTestId('person-posts')).toBeNull();
    expect(postsSvc.person).not.toHaveBeenCalled();
  });
});
